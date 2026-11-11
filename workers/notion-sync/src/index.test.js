import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const origin = 'https://aronmor.github.io';
const env = {
  ALLOWED_ORIGINS: origin,
  NOTION_TOKEN: 'notion-test-token',
  NOTION_DATABASE_ID: 'database-id',
  NOTION_VERSION: '2025-09-03',
  SYNC_TOKEN: 'local-test-token-that-is-at-least-thirty-two-characters',
};

function request(body, {
  authorization = `Bearer ${env.SYNC_TOKEN}`,
  requestOrigin = origin,
} = {}) {
  return new Request('https://worker.example/sync', {
    method: 'POST',
    headers: {
      Origin: requestOrigin,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('rejects disallowed origins and invalid sync tokens', async () => {
  const wrongOrigin = await worker.fetch(request({ bikes: [] }, { requestOrigin: 'https://attacker.example' }), env);
  assert.equal(wrongOrigin.status, 403);

  const wrongToken = await worker.fetch(request({ bikes: [] }, { authorization: 'Bearer wrong' }), env);
  assert.equal(wrongToken.status, 401);
});

test('answers valid preflight requests without exposing configuration', async () => {
  const response = await worker.fetch(new Request('https://worker.example/sync', {
    method: 'OPTIONS',
    headers: { Origin: origin },
  }), env);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type');
});

test('validates motorcycle payloads before calling Notion', async () => {
  const response = await worker.fetch(request({ bikes: [{ id: 'bike-1' }] }), env);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid motorcycle records/);
});

test('creates Notion records for the supplied bikes', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === '/v1/databases/database-id') {
      return Response.json({ data_sources: [{ id: 'data-source-id' }] });
    }
    if (url.pathname === '/v1/data_sources/data-source-id') {
      return Response.json({
        properties: {
          Name: { type: 'title' },
          'App ID': { type: 'rich_text' },
          Year: { type: 'number' },
          Status: { type: 'rich_text' },
        },
      });
    }
    if (url.pathname === '/v1/data_sources/data-source-id/query') {
      return Response.json({ results: [] });
    }
    if (url.pathname === '/v1/pages') {
      return Response.json({ id: 'created-page-id' });
    }
    throw new Error(`Unexpected Notion endpoint ${url.pathname}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(request({
    bikes: [{ id: 'bike-1', name: 'Jawa 350', year: 1982, status: 'Folyamatban' }],
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { created: 1, updated: 0, total: 1 });
  assert.equal(calls.length, 4);
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    parent: { data_source_id: 'data-source-id' },
    properties: {
      Name: { title: [{ text: { content: 'Jawa 350' } }] },
      'App ID': { rich_text: [{ text: { content: 'bike-1' } }] },
      Year: { number: 1982 },
      Status: { rich_text: [{ text: { content: 'Folyamatban' } }] },
    },
  });
});

test('updates the matching Notion page instead of creating duplicates', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === '/v1/databases/database-id') {
      return Response.json({ data_sources: [{ id: 'data-source-id' }] });
    }
    if (url.pathname === '/v1/data_sources/data-source-id') {
      return Response.json({
        properties: {
          Name: { type: 'title' },
          'App ID': { type: 'rich_text' },
          Year: { type: 'number' },
          Status: { type: 'rich_text' },
        },
      });
    }
    if (url.pathname === '/v1/data_sources/data-source-id/query') {
      return Response.json({ results: [{ id: 'existing-page-id' }] });
    }
    if (url.pathname === '/v1/pages/existing-page-id') {
      return Response.json({ id: 'existing-page-id' });
    }
    throw new Error(`Unexpected Notion endpoint ${url.pathname}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(request({
    bikes: [{ id: 'bike-1', name: 'Jawa 350 updated', year: 1982, status: 'Kész' }],
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { created: 0, updated: 1, total: 1 });
  assert.equal(calls.at(-1).url.pathname, '/v1/pages/existing-page-id');
  assert.equal(calls.at(-1).init.method, 'PATCH');
});
