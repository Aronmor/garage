const NOTION_API = 'https://api.notion.com/v1';
const MASTER_APP_ID = '__muhelygarazs_master_state_v1__';
const MAX_BIKES = 25;
const MAX_STATE_BYTES = 160_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_MARKER = 'MGFILEv1|';
const STATE_FILE_MARKER = 'MGSTATEFILEv1|';

function jsonResponse(body, status, origin, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...extraHeaders,
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Garage-File-Id, X-Garage-Bike-Id, X-Garage-File-Name, X-Garage-File-Kind');
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('Access-Control-Expose-Headers', 'Content-Disposition');
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function configuredOrigins(env) {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
}

function safeErrorCode(error) {
  if (Number.isInteger(error?.status)) return `HTTP ${error.status}`;
  return error instanceof Error ? error.name : 'UnknownError';
}

async function notionRequest(path, env, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${env.NOTION_TOKEN}`);
  headers.set('Notion-Version', env.NOTION_VERSION ?? '2026-03-11');
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(`${NOTION_API}${path}`, { ...options, headers });
    if (response.status !== 429 || attempt === 2) break;
    const retryAfter = Number(response.headers.get('Retry-After'));
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 2_000)
      : 500));
  }
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

function propertyValue(property) {
  if (!property) return null;
  if (property.type === 'title' || property.type === 'rich_text') {
    return (property[property.type] ?? []).map((part) => part.plain_text ?? part.text?.content ?? '').join('');
  }
  if (property.type === 'number') return property.number;
  return null;
}

function motorcycleProperties(bike) {
  return {
    Name: { title: [{ text: { content: bike.name.trim().slice(0, 100) } }] },
    'App ID': { rich_text: [{ text: { content: bike.id } }] },
    Year: { number: bike.year },
    Status: { rich_text: [{ text: { content: bike.status } }] },
  };
}

function requiredProperties(properties) {
  const required = { Name: 'title', 'App ID': 'rich_text', Year: 'number', Status: 'rich_text' };
  return Object.entries(required)
    .filter(([name, type]) => properties?.[name]?.type !== type)
    .map(([name, type]) => `${name} (${type})`);
}

function validGarage(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.bikes) || value.bikes.length > MAX_BIKES) return false;
  if (!value.bikes.every((bike) =>
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
    bike.status.length <= 50 &&
    Array.isArray(bike.tasks) &&
    Array.isArray(bike.guides),
  )) return false;
  return typeof value.activeBikeId === 'string' &&
    Array.isArray(value.shoppingItems) &&
    Array.isArray(value.planningPeriods) &&
    typeof value.workshopTempC === 'number' &&
    Array.isArray(value.workshopTimers) &&
    Array.isArray(value.workshopChemicals) &&
    Array.isArray(value.documents);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function equal(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function mergeValue(base, local, remote) {
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    if ([...base, ...local, ...remote].every((item) => item && typeof item === 'object' && typeof item.id === 'string')) {
      const baseById = new Map(base.map((item) => [item.id, item]));
      const localById = new Map(local.map((item) => [item.id, item]));
      const remoteById = new Map(remote.map((item) => [item.id, item]));
      const ids = [...new Set([...remote, ...local].map((item) => item.id))];
      return ids.flatMap((id) => {
        const merged = mergeValue(baseById.get(id), localById.get(id), remoteById.get(id));
        return merged === undefined ? [] : [merged];
      });
    }
    return remote;
  }
  if (base && local && remote &&
      typeof base === 'object' && typeof local === 'object' && typeof remote === 'object' &&
      !Array.isArray(base) && !Array.isArray(local) && !Array.isArray(remote)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    const merged = {};
    for (const key of keys) {
      const value = mergeValue(base[key], local[key], remote[key]);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  return remote;
}

async function listDatabasePages(env, dataSourceId) {
  const pages = [];
  let startCursor;
  do {
    const result = await notionRequest(
      `/data_sources/${encodeURIComponent(dataSourceId)}/query`,
      env,
      {
        method: 'POST',
        body: JSON.stringify({ page_size: 100, ...(startCursor ? { start_cursor: startCursor } : {}) }),
      },
    );
    pages.push(...(result.results ?? []));
    startCursor = result.has_more ? result.next_cursor : null;
  } while (startCursor && pages.length <= 10_000);
  if (startCursor) throw new Error('Notion database is too large to synchronize safely.');
  return pages;
}

function pageBike(page) {
  const properties = page.properties ?? {};
  const id = propertyValue(properties['App ID']);
  const name = propertyValue(properties.Name);
  const year = propertyValue(properties.Year);
  const status = propertyValue(properties.Status);
  if (id === MASTER_APP_ID || !name || !Number.isInteger(year) || typeof status !== 'string') return null;
  return { id: id || page.id, pageId: page.id, name, year, status };
}

function stateBlockText(block) {
  if (block?.type !== 'file') return null;
  const caption = (block.file?.caption ?? []).map((part) => part.plain_text ?? part.text?.content ?? '').join('');
  if (!caption.startsWith(STATE_FILE_MARKER)) return null;
  const [, generation] = caption.split('|');
  return generation && block.file?.file?.url ? { generation, url: block.file.file.url, block } : null;
}

function decodedMarkerPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function fileBlockInfo(block) {
  const type = block?.type;
  if (type !== 'file' && type !== 'image') return null;
  const item = block[type];
  const caption = (item.caption ?? []).map((part) => part.plain_text ?? part.text?.content ?? '').join('');
  if (!caption.startsWith(FILE_MARKER)) return null;
  const [, encodedId, encodedBikeId, kind, encodedName] = caption.split('|');
  const id = decodedMarkerPart(encodedId ?? '');
  const bikeId = decodedMarkerPart(encodedBikeId ?? '');
  const name = decodedMarkerPart(encodedName ?? '');
  if (!id || !bikeId || !name || !['photo', 'document'].includes(kind)) return null;
  const file = item.file;
  return {
    id,
    bikeId,
    kind,
    name,
    url: file?.url ?? null,
    mimeType: file?.mime_type ?? null,
  };
}

async function listChildren(env, blockId) {
  const blocks = [];
  let startCursor;
  do {
    const result = await notionRequest(
      `/blocks/${encodeURIComponent(blockId)}/children?page_size=100${startCursor ? `&start_cursor=${encodeURIComponent(startCursor)}` : ''}`,
      env,
    );
    blocks.push(...(result.results ?? []));
    startCursor = result.has_more ? result.next_cursor : null;
  } while (startCursor && blocks.length <= 10_000);
  if (startCursor) throw new Error('Notion sync page has too many blocks to process safely.');
  return blocks;
}

async function findMasterPage(env, dataSourceId, pages) {
  const existing = pages.filter((page) => propertyValue(page.properties?.['App ID']) === MASTER_APP_ID);
  if (existing.length > 1) throw new Error('More than one MűhelyGarázs sync page exists. Remove the duplicate row in Notion.');
  if (existing.length === 1) return existing[0];
  return notionRequest('/pages', env, {
    method: 'POST',
    body: JSON.stringify({
      parent: { data_source_id: dataSourceId },
      properties: motorcycleProperties({
        id: MASTER_APP_ID,
        name: 'MűhelyGarázs — privát synchronizálási adatok',
        year: 1900,
        status: 'SYNC_STATE',
      }),
    }),
  });
}

async function readState(env, masterPageId, blocks) {
  const stateFiles = blocks.map(stateBlockText).filter(Boolean).sort((left, right) =>
    right.generation.localeCompare(left.generation),
  );
  if (!stateFiles.length) return null;
  for (const stateFile of stateFiles) {
    try {
      const response = await fetch(stateFile.url);
      if (!response.ok) continue;
      const state = await response.json();
      if (validGarage(state)) return state;
    } catch (error) {
      console.error('Unable to read a Notion garage state file:', safeErrorCode(error));
    }
  }
  throw new Error('The saved Notion sync data is incomplete or invalid. No data was changed.');
}

async function writeState(env, pageId, blocks, garage) {
  const json = JSON.stringify(garage);
  const generation = `${Date.now()}-${crypto.randomUUID()}`;
  const upload = await createNotionUpload(env, `muhelygarazs-state-${generation}.txt`, 'text/plain', new TextEncoder().encode(json));
  const caption = [{ type: 'text', text: { content: `${STATE_FILE_MARKER}${generation}` } }];
  const result = await notionRequest(`/blocks/${encodeURIComponent(pageId)}/children`, env, {
    method: 'PATCH',
    body: JSON.stringify({
      children: [{
        object: 'block',
        type: 'file',
        file: {
          type: 'file_upload',
          file_upload: { id: upload.id },
          caption,
        },
      }],
    }),
  });
  if (!result.results?.length) throw new Error('Notion did not confirm the new garage snapshot attachment.');
  const verified = await readState(env, pageId, result.results);
  if (!equal(verified, garage)) throw new Error('The new Notion garage snapshot could not be verified; the previous copy was preserved.');
  for (const block of blocks) {
    if (stateBlockText(block)) {
      await notionRequest(`/blocks/${encodeURIComponent(block.id)}`, env, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      });
    }
  }
}

async function ensureDatabase(env) {
  let dataSourceId = env.NOTION_DATABASE_ID;
  try {
    const database = await notionRequest(`/databases/${encodeURIComponent(env.NOTION_DATABASE_ID)}`, env);
    const dataSources = database.data_sources ?? [];
    if (dataSources.length !== 1 || !dataSources[0]?.id) {
      throw new Error('The Notion motorcycle database must have exactly one accessible data source.');
    }
    dataSourceId = dataSources[0].id;
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
  const dataSource = await notionRequest(`/data_sources/${encodeURIComponent(dataSourceId)}`, env);
  const invalid = requiredProperties(dataSource.properties);
  if (invalid.length) throw new Error(`Invalid Notion database properties: ${invalid.join(', ')}.`);
  return dataSourceId;
}

function initializeFromNotion(localGarage, pages) {
  const notionBikes = pages.map(pageBike).filter(Boolean);
  const matchedIds = new Set();
  const bikes = localGarage.bikes.map((bike) => {
    const match = notionBikes.find((candidate) =>
      candidate.id === bike.id ||
      (!matchedIds.has(candidate.id) &&
        candidate.name.trim().toLocaleLowerCase() === bike.name.trim().toLocaleLowerCase() &&
        candidate.year === bike.year),
    );
    if (!match) return bike;
    matchedIds.add(match.id);
    return { ...bike, name: match.name, year: match.year, status: match.status };
  });
  for (const bike of notionBikes) {
    if (matchedIds.has(bike.id)) continue;
    if (bikes.some((candidate) => candidate.name.trim().toLocaleLowerCase() === bike.name.trim().toLocaleLowerCase() && candidate.year === bike.year)) continue;
    bikes.push({
      ...bike,
      frameNumber: '',
      engineNumber: '',
      specifications: [],
      photos: [],
      tasks: [],
      guides: [],
    });
  }
  return {
    ...localGarage,
    bikes,
    activeBikeId: bikes.some((bike) => bike.id === localGarage.activeBikeId)
      ? localGarage.activeBikeId
      : bikes[0]?.id ?? '',
  };
}

function applyNotionBikeRows(garage, pages) {
  const rows = pages.map(pageBike).filter(Boolean);
  const usedIds = new Set();
  const bikes = garage.bikes.flatMap((bike) => {
    const row = rows.find((candidate) => candidate.id === bike.id);
    if (!row) return [];
    usedIds.add(row.id);
    return [{ ...bike, name: row.name, year: row.year, status: row.status }];
  });
  for (const row of rows) {
    if (usedIds.has(row.id)) continue;
    bikes.push({
      ...row,
      frameNumber: '',
      engineNumber: '',
      specifications: [],
      photos: [],
      tasks: [],
      guides: [],
    });
  }
  return {
    ...garage,
    bikes,
    activeBikeId: bikes.some((bike) => bike.id === garage.activeBikeId)
      ? garage.activeBikeId
      : bikes[0]?.id ?? '',
  };
}

async function upsertBikes(env, dataSourceId, pages, bikes) {
  const createdIds = new Set();
  const updatedIds = new Set();
  const availablePages = [...pages];
  for (const bike of bikes) {
    const matches = availablePages.filter((page) =>
      propertyValue(page.properties?.['App ID']) === bike.id ||
      (!propertyValue(page.properties?.['App ID']) &&
        propertyValue(page.properties?.Name)?.trim().toLocaleLowerCase() === bike.name.trim().toLocaleLowerCase() &&
        propertyValue(page.properties?.Year) === bike.year),
    );
    if (matches.length > 1) throw new Error(`More than one Notion row matches motorcycle "${bike.name}". Resolve the duplicate before syncing.`);
    const properties = motorcycleProperties(bike);
    if (matches.length === 1) {
      await notionRequest(`/pages/${encodeURIComponent(matches[0].id)}`, env, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
      availablePages.splice(availablePages.indexOf(matches[0]), 1);
      updatedIds.add(bike.id);
    } else {
      const created = await notionRequest('/pages', env, {
        method: 'POST',
        body: JSON.stringify({ parent: { data_source_id: dataSourceId }, properties }),
      });
      availablePages.push(created);
      createdIds.add(bike.id);
    }
  }
  return { created: createdIds.size, updated: updatedIds.size };
}

async function archiveRemovedBikes(env, pages, bikes) {
  const currentIds = new Set(bikes.map((bike) => bike.id));
  for (const page of pages) {
    const id = propertyValue(page.properties?.['App ID']);
    if (!id || id === MASTER_APP_ID || currentIds.has(id)) continue;
    await notionRequest(`/pages/${encodeURIComponent(page.id)}`, env, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    });
  }
}

async function handleSync(request, env, origin) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 400_000) return jsonResponse({ error: 'Request is too large.' }, 413, origin);
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400, origin);
  }
  if (!validGarage(body?.localGarage) || (body.baseGarage !== null && body.baseGarage !== undefined && !validGarage(body.baseGarage))) {
    return jsonResponse({ error: 'Expected valid garage data with at most 25 motorcycles.' }, 400, origin);
  }

  const stateBytes = new TextEncoder().encode(JSON.stringify(body.localGarage)).byteLength;
  if (stateBytes > MAX_STATE_BYTES) return jsonResponse({ error: 'Garage data exceeds the 160 KB Notion sync limit.' }, 413, origin);
  if (body.baseGarage && new TextEncoder().encode(JSON.stringify(body.baseGarage)).byteLength > MAX_STATE_BYTES) {
    return jsonResponse({ error: 'Saved sync baseline exceeds the 160 KB limit. Export a backup and reset this device’s sync baseline.' }, 413, origin);
  }

  try {
    const dataSourceId = await ensureDatabase(env);
    const pages = await listDatabasePages(env, dataSourceId);
    const masterPage = await findMasterPage(env, dataSourceId, pages);
    const blocks = await listChildren(env, masterPage.id);
    const remoteGarage = await readState(env, masterPage.id, blocks);
    let garage;
    if (!remoteGarage) {
      garage = initializeFromNotion(body.localGarage, pages);
    } else {
      const currentNotionGarage = applyNotionBikeRows(remoteGarage, pages);
      garage = body.baseGarage
        ? mergeValue(body.baseGarage, body.localGarage, currentNotionGarage)
        : currentNotionGarage;
      if (!validGarage(garage)) throw new Error('The merge produced invalid garage data. No data was changed.');
    }

    if (new TextEncoder().encode(JSON.stringify(garage)).byteLength > MAX_STATE_BYTES) {
      return jsonResponse({ error: 'Merged garage data exceeds the 160 KB Notion sync limit.' }, 413, origin);
    }
    await upsertBikes(env, dataSourceId, pages, garage.bikes);
    await archiveRemovedBikes(env, pages, garage.bikes);
    const refreshedBlocks = await listChildren(env, masterPage.id);
    await writeState(env, masterPage.id, refreshedBlocks, garage);
    const finalBlocks = await listChildren(env, masterPage.id);
    const files = finalBlocks.map(fileBlockInfo).filter((file) => file && file.url).map(({ url: _url, ...file }) => file);
    return jsonResponse({ garage, files }, 200, origin);
  } catch (error) {
    console.error('Notion garage sync failed:', safeErrorCode(error));
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Notion synchronization failed.',
    }, 502, origin);
  }
}

function safeFilename(value) {
  const filename = value?.replace(/[/\\|\r\n"]/g, '_').trim();
  return filename && filename.length <= 180 ? filename : null;
}

function decodedHeader(request, name) {
  const value = request.headers.get(name);
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function createNotionUpload(env, filename, mimeType, content) {
  const upload = await notionRequest('/file_uploads', env, {
    method: 'POST',
    body: JSON.stringify({ mode: 'single_part', filename, content_type: mimeType }),
  });
  const multipart = new FormData();
  multipart.append('file', new Blob([content], { type: mimeType }), filename);
  await notionRequest(`/file_uploads/${encodeURIComponent(upload.id)}/send`, env, {
    method: 'POST',
    body: multipart,
  });
  return upload;
}

async function fileBlockExists(env, pageId, fileId) {
  const blocks = await listChildren(env, pageId);
  return blocks.some((block) => fileBlockInfo(block)?.id === fileId);
}

async function handleFileUpload(request, env, origin) {
  const fileId = decodedHeader(request, 'X-Garage-File-Id');
  const bikeId = decodedHeader(request, 'X-Garage-Bike-Id');
  const filename = safeFilename(decodedHeader(request, 'X-Garage-File-Name'));
  const kind = request.headers.get('X-Garage-File-Kind');
  if (!fileId || fileId.length > 100 || !bikeId || bikeId.length > 100 || !filename || !['photo', 'document'].includes(kind)) {
    return jsonResponse({ error: 'File metadata is invalid.' }, 400, origin);
  }
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
  if (declaredLength > MAX_FILE_BYTES) return jsonResponse({ error: 'Notion Free supports files up to 5 MB.' }, 413, origin);

  try {
    const content = await request.arrayBuffer();
    if (!content.byteLength || content.byteLength > MAX_FILE_BYTES) {
      return jsonResponse({ error: 'Files must be non-empty and 5 MB or smaller for Notion Free.' }, 413, origin);
    }
    const dataSourceId = await ensureDatabase(env);
    const pages = await listDatabasePages(env, dataSourceId);
    const masterPage = await findMasterPage(env, dataSourceId, pages);
    if (await fileBlockExists(env, masterPage.id, fileId)) return jsonResponse({ uploaded: false, alreadyPresent: true }, 200, origin);

    const mimeType = request.headers.get('Content-Type') ?? 'application/octet-stream';
    const validMimeType = kind === 'photo'
      ? mimeType.startsWith('image/')
      : ['application/pdf', 'text/plain', 'text/markdown'].includes(mimeType);
    if (!validMimeType) return jsonResponse({ error: 'This file type is not supported for Notion sync.' }, 415, origin);
    const upload = await createNotionUpload(env, filename, mimeType, content);

    const caption = [{ type: 'text', text: { content: `${FILE_MARKER}${encodeURIComponent(fileId)}|${encodeURIComponent(bikeId)}|${kind}|${encodeURIComponent(filename)}` } }];
    const blockType = kind === 'photo' ? 'image' : 'file';
    const block = {
      object: 'block',
      type: blockType,
      [blockType]: {
        type: 'file_upload',
        file_upload: { id: upload.id },
        caption,
      },
    };
    await notionRequest(`/blocks/${encodeURIComponent(masterPage.id)}/children`, env, {
      method: 'PATCH',
      body: JSON.stringify({ children: [block] }),
    });
    return jsonResponse({ uploaded: true }, 200, origin);
  } catch (error) {
    console.error('Notion file upload failed:', safeErrorCode(error));
    return jsonResponse({
      error: error instanceof Error ? error.message : 'The file could not be uploaded to Notion.',
    }, 502, origin);
  }
}

async function handleFileDownload(fileId, env, origin) {
  if (!fileId || fileId.length > 100) return jsonResponse({ error: 'File ID is invalid.' }, 400, origin);
  try {
    const dataSourceId = await ensureDatabase(env);
    const pages = await listDatabasePages(env, dataSourceId);
    const masterPage = pages.find((page) => propertyValue(page.properties?.['App ID']) === MASTER_APP_ID);
    if (!masterPage) return jsonResponse({ error: 'The Notion file was not found.' }, 404, origin);
    const blocks = await listChildren(env, masterPage.id);
    const match = blocks.find((block) => fileBlockInfo(block)?.id === fileId);
    const info = fileBlockInfo(match);
    if (!info?.url) return jsonResponse({ error: 'The Notion file was not found.' }, 404, origin);
    const response = await fetch(info.url);
    if (!response.ok) throw new Error(`Notion file download returned HTTP ${response.status}.`);
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': response.headers.get('Content-Type') ?? info.mimeType ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(info.name)}"`,
      Vary: 'Origin',
    });
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Content-Disposition');
    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    console.error('Notion file download failed:', safeErrorCode(error));
    return jsonResponse({
      error: error instanceof Error ? error.message : 'The file could not be downloaded from Notion.',
    }, 502, origin);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (!origin || !configuredOrigins(env).includes(origin)) {
      return jsonResponse({ error: 'Origin is not allowed.' }, 403, null);
    }
    if (request.method === 'OPTIONS') return jsonResponse({}, 204, origin);

    const url = new URL(request.url);
    if (!['/sync', '/files', /^\/files\/[^/]+$/].some((route) =>
      typeof route === 'string' ? route === url.pathname : route.test(url.pathname),
    )) return jsonResponse({ error: 'Not found.' }, 404, origin);
    if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'Method not allowed.' }, 405, origin);

    if (!env.NOTION_TOKEN || !env.NOTION_DATABASE_ID || !env.SYNC_TOKEN || env.SYNC_TOKEN.length < 32) {
      return jsonResponse({ error: 'Worker secrets are not configured.' }, 503, origin);
    }
    if (request.headers.get('Authorization') !== `Bearer ${env.SYNC_TOKEN}`) {
      return jsonResponse({ error: 'Invalid sync token.' }, 401, origin);
    }
    if (url.pathname === '/sync' && request.method === 'POST') return handleSync(request, env, origin);
    if (url.pathname === '/files' && request.method === 'POST') return handleFileUpload(request, env, origin);
    if (url.pathname.startsWith('/files/') && request.method === 'GET') {
      let fileId;
      try {
        fileId = decodeURIComponent(url.pathname.slice('/files/'.length));
      } catch {
        return jsonResponse({ error: 'File ID is invalid.' }, 400, origin);
      }
      return handleFileDownload(fileId, env, origin);
    }
    return jsonResponse({ error: 'Method not allowed.' }, 405, origin);
  },
};
