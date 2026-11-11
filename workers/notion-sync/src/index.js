const NOTION_API = 'https://api.notion.com/v1';
const MAX_BIKES_PER_REQUEST = 25;

function jsonResponse(body, status, origin) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function configuredOrigins(env) {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function notionRequest(path, env, options = {}) {
  const response = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': env.NOTION_VERSION ?? '2025-09-03',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.message === 'string'
      ? payload.message
      : `Notion API returned HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function pauseBetweenRequests() {
  await new Promise((resolve) => setTimeout(resolve, 350));
}

function validateBikes(value) {
  if (!Array.isArray(value) || value.length > MAX_BIKES_PER_REQUEST) return false;
  return value.every((bike) =>
    bike &&
    typeof bike.id === 'string' &&
    bike.id.length > 0 &&
    bike.id.length <= 100 &&
    typeof bike.name === 'string' &&
    bike.name.trim().length > 0 &&
    bike.name.length <= 100 &&
    Number.isInteger(bike.year) &&
    bike.year >= 1900 &&
    bike.year <= 2200 &&
    typeof bike.status === 'string' &&
    bike.status.length <= 50,
  );
}

function notionProperties(bike) {
  return {
    Name: { title: [{ text: { content: bike.name.trim() } }] },
    'App ID': { rich_text: [{ text: { content: bike.id } }] },
    Year: { number: bike.year },
    Status: { rich_text: [{ text: { content: bike.status } }] },
  };
}

function validateDataSourceProperties(properties) {
  const required = {
    Name: 'title',
    'App ID': 'rich_text',
    Year: 'number',
    Status: 'rich_text',
  };
  return Object.entries(required)
    .filter(([name, type]) => properties?.[name]?.type !== type)
    .map(([name, type]) => `${name} (${type})`);
}

async function syncBikes(bikes, env, dataSourceId) {
  let created = 0;
  let updated = 0;
  let requestCount = 0;

  for (const bike of bikes) {
    if (requestCount > 0) await pauseBetweenRequests();
    const query = await notionRequest(
      `/data_sources/${encodeURIComponent(dataSourceId)}/query`,
      env,
      {
        method: 'POST',
        body: JSON.stringify({
          page_size: 2,
          filter: {
            property: 'App ID',
            rich_text: { equals: bike.id },
          },
        }),
      },
    );
    requestCount += 1;
    const matches = query.results ?? [];
    if (matches.length > 1) {
      throw new Error(`More than one Notion row has App ID "${bike.id}". Remove the duplicate row and retry.`);
    }

    if (requestCount > 0) await pauseBetweenRequests();
    const properties = notionProperties(bike);
    if (matches.length === 1) {
      await notionRequest(`/pages/${encodeURIComponent(matches[0].id)}`, env, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
      updated += 1;
    } else {
      await notionRequest('/pages', env, {
        method: 'POST',
        body: JSON.stringify({
          parent: { data_source_id: dataSourceId },
          properties,
        }),
      });
      created += 1;
    }
    requestCount += 1;
  }

  return { created, updated };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = configuredOrigins(env);
    if (!origin || !allowedOrigins.includes(origin)) {
      return jsonResponse({ error: 'Origin is not allowed.' }, 403, null);
    }

    if (request.method === 'OPTIONS') return jsonResponse({}, 204, origin);
    if (new URL(request.url).pathname !== '/sync' || request.method !== 'POST') {
      return jsonResponse({ error: 'Not found.' }, 404, origin);
    }

    if (!env.NOTION_TOKEN || !env.NOTION_DATABASE_ID || !env.SYNC_TOKEN || env.SYNC_TOKEN.length < 32) {
      return jsonResponse({ error: 'Worker secrets are not configured.' }, 503, origin);
    }

    if (request.headers.get('Authorization') !== `Bearer ${env.SYNC_TOKEN}`) {
      return jsonResponse({ error: 'Invalid sync token.' }, 401, origin);
    }

    let rawBody;
    try {
      rawBody = await request.text();
    } catch {
      return jsonResponse({ error: 'Request body could not be read.' }, 400, origin);
    }
    if (rawBody.length > 100_000) return jsonResponse({ error: 'Request is too large.' }, 413, origin);
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON.' }, 400, origin);
    }
    if (!validateBikes(body?.bikes)) {
      return jsonResponse({
        error: `Expected up to ${MAX_BIKES_PER_REQUEST} valid motorcycle records.`,
      }, 400, origin);
    }

    try {
      const database = await notionRequest(
        `/databases/${encodeURIComponent(env.NOTION_DATABASE_ID)}`,
        env,
      );
      const dataSources = database.data_sources ?? [];
      if (dataSources.length !== 1 || !dataSources[0]?.id) {
        return jsonResponse({
          error: 'The selected Notion database must have exactly one accessible data source.',
        }, 422, origin);
      }
      const dataSource = await notionRequest(
        `/data_sources/${encodeURIComponent(dataSources[0].id)}`,
        env,
      );
      const invalidProperties = validateDataSourceProperties(dataSource.properties);
      if (invalidProperties.length) {
        return jsonResponse({
          error: `Invalid Notion database properties: ${invalidProperties.join(', ')}.`,
        }, 422, origin);
      }

      const result = await syncBikes(body.bikes, env, dataSources[0].id);
      return jsonResponse({ ...result, total: body.bikes.length }, 200, origin);
    } catch (error) {
      console.error('Notion motorcycle sync failed:', error);
      return jsonResponse({
        error: error instanceof Error ? error.message : 'Notion synchronization failed.',
      }, 502, origin);
    }
  },
};
