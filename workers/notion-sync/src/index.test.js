import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const origin = 'https://aronmor.github.io';
const env = {
  ALLOWED_ORIGINS: origin,
  NOTION_TOKEN: 'notion-test-token',
  NOTION_DATABASE_ID: 'database-id',
  NOTION_VERSION: '2026-03-11',
  SYNC_TOKEN: 'local-test-token-that-is-at-least-thirty-two-characters',
};

function garage(overrides = {}) {
  return {
    bikes: [{
      id: 'bike-1',
      name: 'Jawa 350',
      year: 1982,
      status: 'Folyamatban',
      frameNumber: '',
      engineNumber: '',
      tasks: [{ id: 'task-1', title: 'Carburetor', category: 'Engine', done: false }],
      guides: [],
      photos: [],
    }],
    documents: [],
    activeBikeId: 'bike-1',
    shoppingItems: [],
    planningPeriods: ['Spring', 'Winter'],
    workshopTempC: 18,
    workshopTimers: [],
    workshopChemicals: [],
    ...overrides,
  };
}

function request(path, body, {
  method = 'POST',
  authorization = `Bearer ${env.SYNC_TOKEN}`,
  requestOrigin = origin,
  headers = {},
} = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: {
      Origin: requestOrigin,
      Authorization: authorization,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function notionPropertyValues(properties) {
  const output = {};
  for (const [name, property] of Object.entries(properties)) {
    if ('title' in property || 'rich_text' in property) {
      const type = 'title' in property ? 'title' : 'rich_text';
      output[name] = property[type].map((part) => ({ plain_text: part.text.content }));
    } else {
      output[name] = property.number;
    }
  }
  return output;
}

function mockNotion(t, { initialPages = [], fileUrl = null } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const pages = [...initialPages];
  const children = new Map();
  const fileContents = new Map();
  let pageNumber = 0;
  let blockNumber = 0;
  let uploadNumber = 0;
  let masterPageId = null;
  if (fileUrl) fileContents.set(fileUrl, new Uint8Array([1, 2, 3]));

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ pathname: url.pathname, method, body, headers: new Headers(init.headers) });

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
    if (url.pathname === '/v1/data_sources/data-source-id/query' && method === 'POST') {
      return Response.json({ results: pages, has_more: false, next_cursor: null });
    }
    if (url.pathname === '/v1/file_uploads' && method === 'POST') {
      uploadNumber += 1;
      return Response.json({ id: `upload-${uploadNumber}` });
    }
    if (/^\/v1\/file_uploads\/[^/]+\/send$/.test(url.pathname) && method === 'POST') {
      assert.ok(init.body instanceof FormData);
      const file = init.body.get('file');
      const uploadId = url.pathname.split('/').at(-2);
      fileContents.set(`https://files.notionusercontent.com/${uploadId}`, new Uint8Array(await file.arrayBuffer()));
      return Response.json({ status: 'uploaded' });
    }
    if (url.pathname === '/v1/pages' && method === 'POST') {
      pageNumber += 1;
      const page = {
        id: `page-${pageNumber}`,
        properties: Object.fromEntries(
          Object.entries(notionPropertyValues(body.properties)).map(([name, value]) => {
            const type = name === 'Name' ? 'title' : name === 'Year' ? 'number' : 'rich_text';
            const valueProperty = type === 'number' ? { number: value } : {
              [type]: value.map((part) => ({ plain_text: part.plain_text })),
            };
            return [name, { type, ...valueProperty }];
          }),
        ),
      };
      pages.push(page);
      if (notionPropertyValues(body.properties)['App ID']?.[0]?.plain_text === '__muhelygarazs_master_state_v1__') {
        masterPageId = page.id;
      }
      return Response.json(page);
    }
    if (url.pathname.startsWith('/v1/pages/') && method === 'PATCH') {
      const pageId = url.pathname.split('/').at(-1);
      const page = pages.find((candidate) => candidate.id === pageId);
      if (!page) return Response.json({ message: 'missing page' }, { status: 404 });
      page.properties = Object.fromEntries(
        Object.entries(notionPropertyValues(body.properties)).map(([name, value]) => {
          const type = name === 'Name' ? 'title' : name === 'Year' ? 'number' : 'rich_text';
          const valueProperty = type === 'number' ? { number: value } : {
            [type]: value.map((part) => ({ plain_text: part.plain_text })),
          };
          return [name, { type, ...valueProperty }];
        }),
      );
      return Response.json(page);
    }
    if (/^\/v1\/blocks\/[^/]+\/children$/.test(url.pathname) && method === 'GET') {
      const pageId = url.pathname.split('/').at(-2);
      return Response.json({ results: children.get(pageId) ?? [], has_more: false });
    }
    if (url.pathname.startsWith('/v1/blocks/') && url.pathname.endsWith('/children') && method === 'PATCH') {
      const pageId = url.pathname.split('/').at(-2);
      if (!children.has(pageId)) children.set(pageId, []);
      const result = body.children.map((block) => {
        blockNumber += 1;
        const created = structuredClone(block);
        created.id = `block-${blockNumber}`;
        if (created.type === 'code') {
          created.code.rich_text = created.code.rich_text.map((part) => ({
            ...part,
            plain_text: part.text.content,
          }));
        }
        if (created.type === 'file') {
          const uploadId = created.file.file_upload.id;
          const url = `https://files.notionusercontent.com/${uploadId}`;
          created.file = {
            caption: created.file.caption.map((part) => ({ plain_text: part.text.content })),
            file: { url, mime_type: uploadId.includes('state') ? 'text/plain' : 'application/pdf' },
          };
          fileContents.set(url, fileContents.get(url) ?? new Uint8Array());
        }
        children.get(pageId).push(created);
        return created;
      });
      return Response.json({ results: result });
    }
    if (url.pathname.startsWith('/v1/blocks/') && method === 'PATCH') {
      const blockId = url.pathname.split('/').at(-1);
      for (const blocks of children.values()) {
        const block = blocks.find((candidate) => candidate.id === blockId);
        if (block) block.archived = body.archived;
      }
      return Response.json({ id: blockId, archived: body.archived });
    }
    if (fileContents.has(url.href)) {
      const bytes = fileContents.get(url.href);
      return new Response(bytes, { headers: { 'Content-Type': url.pathname.includes('state') ? 'text/plain' : 'application/pdf' } });
    }
    throw new Error(`Unexpected Notion endpoint ${method} ${url.pathname}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return { calls, pages, children, fileContents, get masterPageId() { return masterPageId; } };
}

function masterPage() {
  return {
    id: 'master-page',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'MűhelyGarázs — privát synchronizálási adatok' }] },
      'App ID': { type: 'rich_text', rich_text: [{ plain_text: '__muhelygarazs_master_state_v1__' }] },
      Year: { type: 'number', number: 1900 },
      Status: { type: 'rich_text', rich_text: [{ plain_text: 'SYNC_STATE' }] },
    },
  };
}

test('rejects disallowed origins and invalid sync tokens', async () => {
  const wrongOrigin = await worker.fetch(request('/sync', { localGarage: garage(), baseGarage: null }, {
    requestOrigin: 'https://attacker.example',
  }), env);
  assert.equal(wrongOrigin.status, 403);

  const wrongToken = await worker.fetch(request('/sync', { localGarage: garage(), baseGarage: null }, {
    authorization: 'Bearer wrong-token',
  }), env);
  assert.equal(wrongToken.status, 401);
});

test('answers valid preflight requests with the file headers required by the app', async () => {
  const response = await worker.fetch(request('/sync', undefined, { method: 'OPTIONS' }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /X-Garage-File-Id/);
});

test('validates full garage payloads before contacting Notion', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Notion must not be called for invalid input.'); };
  try {
    const response = await worker.fetch(request('/sync', { bikes: [{ id: 'bike-1' }] }), env);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valid garage data/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('creates the private master row, saves complete garage state, and mirrors motorcycles', async (t) => {
  const mock = mockNotion(t);
  const response = await worker.fetch(request('/sync', { localGarage: garage(), baseGarage: null }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.garage, garage());
  assert.deepEqual(payload.files, []);
  assert.equal(mock.pages.length, 2);
  assert.ok(mock.pages.some((page) =>
    page.properties['App ID'].rich_text[0].plain_text === '__muhelygarazs_master_state_v1__',
  ));
  assert.ok(mock.calls.some((call) =>
    call.pathname === `/v1/blocks/${mock.masterPageId}/children` && call.method === 'PATCH',
  ));
});

test('merges independent app edits while Notion wins conflicting edits', async (t) => {
  const mock = mockNotion(t, { initialPages: [masterPage()] });
  const original = garage();
  const first = await worker.fetch(request('/sync', { localGarage: original, baseGarage: null }), env);
  assert.equal(first.status, 200);
  const baseGarage = (await first.json()).garage;

  const bikePage = mock.pages.find((page) =>
    page.properties?.['App ID']?.rich_text?.[0]?.plain_text === 'bike-1',
  );
  bikePage.properties.Name.title[0].plain_text = 'Notion table name';

  const stateBlock = mock.children.get('master-page').find((block) =>
    block.file?.caption?.[0]?.plain_text?.startsWith('MGSTATEFILEv1|'),
  );
  const oldText = stateBlock.file.file.url;
  const storedState = JSON.parse(new TextDecoder().decode(mock.fileContents.get(oldText)));
  storedState.bikes[0].tasks[0].title = 'Notion task';
  mock.fileContents.set(oldText, new TextEncoder().encode(JSON.stringify(storedState)));
  assert.equal(JSON.parse(new TextDecoder().decode(mock.fileContents.get(oldText))).bikes[0].tasks[0].title, 'Notion task');

  const localGarage = structuredClone(baseGarage);
  localGarage.bikes[0].name = 'Local conflicting name';
  localGarage.bikes[0].tasks[0].title = 'Local conflicting task';
  localGarage.shoppingItems.push({
    id: 'item-1',
    name: 'Oil',
    quantity: '1',
    category: 'Műhelyanyag',
    bikeId: null,
    status: 'Beszerzendő',
  });
  const second = await worker.fetch(request('/sync', { localGarage, baseGarage }), env);
  assert.equal(second.status, 200);
  const merged = (await second.json()).garage;
  assert.equal(merged.bikes[0].name, 'Notion table name');
  assert.equal(merged.bikes[0].tasks[0].title, 'Notion task');
  assert.equal(merged.shoppingItems[0].name, 'Oil');
});

test('downloads private Notion file bytes only for an authorized request', async (t) => {
  const fileUrl = 'https://files.notionusercontent.com/private.pdf';
  const filePage = masterPage();
  const mock = mockNotion(t, { initialPages: [filePage], fileUrl });
  mock.children.set('master-page', [{
    id: 'file-block',
    type: 'file',
    file: {
      caption: [{
        plain_text: 'MGFILEv1|document-1|bike-1|document|manual.pdf',
      }],
      file: { url: fileUrl, mime_type: 'application/pdf' },
    },
  }]);

  const unauthorized = await worker.fetch(request('/files/document-1', undefined, {
    method: 'GET',
    authorization: 'Bearer wrong-token',
  }), env);
  assert.equal(unauthorized.status, 401);

  const response = await worker.fetch(request('/files/document-1', undefined, { method: 'GET' }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
});

test('uploads a private file once and associates it with its stable app ID', async (t) => {
  const mock = mockNotion(t, { initialPages: [masterPage()] });
  const uploadRequest = () => new Request('https://worker.example/files', {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: `Bearer ${env.SYNC_TOKEN}`,
      'Content-Type': 'application/pdf',
      'X-Garage-File-Id': encodeURIComponent('document-1'),
      'X-Garage-Bike-Id': encodeURIComponent('bike-1'),
      'X-Garage-File-Name': encodeURIComponent('műhely kézikönyv.pdf'),
      'X-Garage-File-Kind': 'document',
    },
    body: new Uint8Array([5, 6, 7]),
  });

  const response = await worker.fetch(uploadRequest(), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { uploaded: true });
  assert.deepEqual([...mock.children.get('master-page')[0].file.caption.map((part) => part.plain_text)], [
    'MGFILEv1|document-1|bike-1|document|m%C5%B1hely%20k%C3%A9zik%C3%B6nyv.pdf',
  ]);
  assert.deepEqual([...mock.fileContents.get('https://files.notionusercontent.com/upload-1')], [5, 6, 7]);

  const duplicate = await worker.fetch(uploadRequest(), env);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { uploaded: false, alreadyPresent: true });
  assert.equal(mock.calls.filter((call) => call.pathname === '/v1/file_uploads').length, 1);
});
