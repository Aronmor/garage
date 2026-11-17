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

function mockNotion(t, { initialPages = [], initialChildren = {}, fileUrl = null, directDataSource = false } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const pages = [...initialPages];
  const children = new Map();
  for (const [pageId, blocks] of Object.entries(initialChildren)) children.set(pageId, structuredClone(blocks));
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

    if (url.pathname.startsWith('/v1/databases/')) {
      if (directDataSource && url.pathname === '/v1/databases/data-source-id') {
        return Response.json({ message: 'Could not find database' }, { status: 404 });
      }
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
    if (/^\/v1\/blocks\/[^/]+$/.test(url.pathname) && method === 'PATCH') {
      const blockId = url.pathname.split('/').at(-1);
      for (const blocks of children.values()) {
        const block = blocks.find((candidate) => candidate.id === blockId);
        if (block && body.type === 'to_do') {
          block.to_do = body.to_do;
          block.type = 'to_do';
        }
      }
      return Response.json({ id: blockId });
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
          assert.equal(typeof created.file.name, 'string');
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
    if (url.pathname.startsWith('/v1/blocks/') && method === 'DELETE') {
      const blockId = url.pathname.split('/').at(-1);
      for (const blocks of children.values()) {
        const block = blocks.find((candidate) => candidate.id === blockId);
        if (block) block.in_trash = true;
      }
      return Response.json({ id: blockId, in_trash: true });
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

test('accepts a Notion data source ID when a database ID is not configured', async (t) => {
  const mock = mockNotion(t, { directDataSource: true });
  const response = await worker.fetch(
    request('/sync', { localGarage: garage(), baseGarage: null }),
    { ...env, NOTION_DATABASE_ID: 'data-source-id' },
  );
  assert.equal(response.status, 200);
  assert.ok(mock.calls.some((call) => call.pathname === '/v1/databases/data-source-id'));
  assert.ok(mock.calls.some((call) => call.pathname === '/v1/data_sources/data-source-id'));
});

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

test('syncs motorcycle page checklists into tasks and shopping items', async (t) => {
  const bikePage = {
    id: 'bike-page-1',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Jawa 350' }] },
      'App ID': { type: 'rich_text', rich_text: [{ plain_text: 'bike-1' }] },
      Year: { type: 'number', number: 1982 },
      Status: { type: 'rich_text', rich_text: [{ plain_text: 'Folyamatban' }] },
    },
  };
  const mock = mockNotion(t, {
    initialPages: [bikePage],
    initialChildren: {
      'bike-page-1': [
        {
          id: 'heading-tasks',
          type: 'heading_2',
          heading_2: { rich_text: [{ plain_text: 'Aufgaben' }] },
        },
        {
          id: 'todo-oil',
          type: 'to_do',
          to_do: { rich_text: [{ plain_text: 'Check oil' }], checked: true },
        },
        {
          id: 'heading-shopping',
          type: 'heading_2',
          heading_2: { rich_text: [{ plain_text: 'Einkaufsliste' }] },
        },
        {
          id: 'shopping-filter',
          type: 'to_do',
          to_do: { rich_text: [{ plain_text: 'Ölfilter — 1 Stück' }], checked: false },
        },
      ],
    },
  });
  const response = await worker.fetch(request('/sync', { localGarage: garage(), baseGarage: null }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.garage.bikes[0].tasks.some((task) => task.title === 'Check oil' && task.done));
  assert.ok(payload.garage.shoppingItems.some((item) =>
    item.name === 'Ölfilter' && item.quantity === '1 Stück' && item.bikeId === 'bike-1',
  ));
  assert.ok(mock.calls.some((call) =>
    call.pathname === '/v1/blocks/bike-page-1/children' &&
    call.method === 'PATCH' &&
    call.body.children.some((block) => block.to_do?.rich_text?.[0]?.text?.content === 'Carburetor'),
  ));
});

test('syncs checklists from a child page below the motorcycle page', async (t) => {
  const bikePage = {
    id: 'bike-page-1',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Jawa 350' }] },
      'App ID': { type: 'rich_text', rich_text: [{ plain_text: 'bike-1' }] },
      Year: { type: 'number', number: 1982 },
      Status: { type: 'rich_text', rich_text: [{ plain_text: 'Folyamatban' }] },
    },
  };
  const mock = mockNotion(t, {
    initialPages: [bikePage],
    initialChildren: {
      'bike-page-1': [{ id: 'bike-details-page', type: 'child_page', child_page: { title: 'Werkstattdaten' } }],
      'bike-details-page': [
        {
          id: 'nested-heading',
          type: 'paragraph',
          paragraph: { rich_text: [{ plain_text: 'Feladatok' }] },
        },
        {
          id: 'nested-task',
          type: 'to_do',
          to_do: { rich_text: [{ plain_text: 'Ventilspiel prüfen' }], checked: false },
        },
      ],
    },
  });
  const response = await worker.fetch(request('/sync', { localGarage: garage(), baseGarage: null }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.garage.bikes[0].tasks.some((task) => task.title === 'Ventilspiel prüfen'));
  assert.ok(mock.calls.some((call) =>
    call.pathname === '/v1/blocks/bike-details-page/children' && call.method === 'PATCH',
  ));
});

test('aggregates checklist blocks from multiple page columns', async (t) => {
  const bikePage = {
    id: 'bike-page-1',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Jawa 350' }] },
      'App ID': { type: 'rich_text', rich_text: [{ plain_text: 'bike-1' }] },
      Year: { type: 'number', number: 1982 },
      Status: { type: 'rich_text', rich_text: [{ plain_text: 'Folyamatban' }] },
    },
  };
  const mock = mockNotion(t, {
    initialPages: [bikePage],
    initialChildren: {
      'bike-page-1': [{ id: 'details-page', type: 'child_page', child_page: { title: 'Details' } }],
      'details-page': [{ id: 'columns', type: 'column_list', has_children: true }],
      columns: [
        { id: 'shopping-column', type: 'column', has_children: true },
        { id: 'tasks-column', type: 'column', has_children: true },
      ],
      'shopping-column': [
        { id: 'shopping-heading', type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Bevásárló lista' }] } },
        { id: 'shopping-item', type: 'to_do', to_do: { rich_text: [{ plain_text: 'Gyertya' }], checked: false } },
      ],
      'tasks-column': [
        { id: 'tasks-heading', type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Aufgaben' }] } },
        { id: 'planning-heading', type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Ütemterv' }] } },
        { id: 'task-item', type: 'to_do', to_do: { rich_text: [{ plain_text: 'Motor szétszedése' }], checked: false } },
      ],
    },
  });
  const response = await worker.fetch(request('/sync', {
    localGarage: garage({
      shoppingItems: [{
        id: 'notion-shopping-task-item',
        name: 'Motor szétszedése',
        quantity: '',
        category: 'Motoralkatrész',
        bikeId: 'bike-1',
        status: 'Beszerzendő',
      }],
    }),
    baseGarage: null,
  }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.garage.bikes[0].tasks.some((task) => task.title === 'Motor szétszedése'));
  assert.ok(payload.garage.shoppingItems.some((item) => item.name === 'Gyertya' && item.bikeId === 'bike-1'));
  assert.equal(payload.garage.shoppingItems.some((item) => item.name === 'Motor szétszedése'), false);
  assert.equal(mock.calls.some((call) => call.pathname === '/v1/blocks/tasks-column/children'), true);
});

test('keeps checklist items under Hungarian shopping and planning subheadings', async (t) => {
  const bikePage = {
    id: 'bike-page-1',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Jawa 350' }] },
      'App ID': { type: 'rich_text', rich_text: [{ plain_text: 'bike-1' }] },
      Year: { type: 'number', number: 1982 },
      Status: { type: 'rich_text', rich_text: [{ plain_text: 'Folyamatban' }] },
    },
  };
  mockNotion(t, {
    initialPages: [bikePage],
    initialChildren: {
      'bike-page-1': [
        { id: 'shopping-heading', type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Bevásárló lista' }] } },
        { id: 'supplies-heading', type: 'heading_3', heading_3: { rich_text: [{ plain_text: 'Kellékek' }] } },
        { id: 'shopping-item', type: 'to_do', to_do: { rich_text: [{ plain_text: 'Fékfolyadék' }], checked: false } },
        { id: 'summer-parts-heading', type: 'heading_3', heading_3: { rich_text: [{ plain_text: 'Alkatrészek Nyárra' }] } },
        { id: 'summer-part', type: 'to_do', to_do: { rich_text: [{ plain_text: 'Luftfilter' }], checked: false } },
        { id: 'planning-heading', type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Ütemterv' }] } },
        { id: 'summer-heading', type: 'heading_3', heading_3: { rich_text: [{ plain_text: 'Nyár' }] } },
        { id: 'planning-item', type: 'to_do', to_do: { rich_text: [{ plain_text: 'Probefahrt' }], checked: false } },
      ],
    },
  });
  const response = await worker.fetch(request('/sync', {
    localGarage: garage({
      bikes: [{
        ...garage().bikes[0],
        tasks: [
          ...garage().bikes[0].tasks,
          { id: 'notion-task-summer-part', title: 'Luftfilter', category: 'Aufgabe', done: false },
        ],
      }],
    }),
    baseGarage: null,
  }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.garage.shoppingItems.some((item) => item.name === 'Fékfolyadék'));
  assert.ok(payload.garage.shoppingItems.some((item) => item.name === 'Luftfilter'));
  assert.ok(payload.garage.bikes[0].tasks.some((task) => task.title === 'Probefahrt' && task.category === 'Planung'));
  assert.equal(payload.garage.bikes[0].tasks.some((task) => task.id === 'notion-task-summer-part'), false);
});

test('normalizes legacy garage bikes and Notion rows with empty status', async (t) => {
  const notionBike = {
    id: 'notion-bike-page',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'MZ 125' }] },
      'App ID': { type: 'rich_text', rich_text: [{ plain_text: 'bike-2' }] },
      Year: { type: 'number', number: 1985 },
      Status: { type: 'rich_text', rich_text: [] },
    },
  };
  const mock = mockNotion(t, { initialPages: [masterPage(), notionBike] });
  const first = await worker.fetch(request('/sync', { localGarage: garage(), baseGarage: null }), env);
  assert.equal(first.status, 200);
  const firstResult = await first.json();
  assert.equal(firstResult.garage.bikes.find((bike) => bike.id === 'bike-2').status, 'Tervezett');

  const stateBlock = mock.children.get('master-page').find((block) =>
    block.file?.caption?.[0]?.plain_text?.startsWith('MGSTATEFILEv1|'),
  );
  const stateUrl = stateBlock.file.file.url;
  const savedState = JSON.parse(new TextDecoder().decode(mock.fileContents.get(stateUrl)));
  delete savedState.bikes[0].frameNumber;
  delete savedState.bikes[0].engineNumber;
  savedState.bikes[0].status = '';
  savedState.bikes[0].tasks[0] = { id: 'legacy-task', title: 'Legacy task' };
  mock.fileContents.set(stateUrl, new TextEncoder().encode(JSON.stringify(savedState)));

  const second = await worker.fetch(request('/sync', {
    localGarage: firstResult.garage,
    baseGarage: firstResult.garage,
  }), env);
  assert.equal(second.status, 200);
  const secondResult = await second.json();
  assert.equal(secondResult.garage.bikes[0].frameNumber, '');
  assert.equal(secondResult.garage.bikes[0].engineNumber, '');
  assert.equal(secondResult.garage.bikes[0].status, 'Folyamatban');
  assert.deepEqual(secondResult.garage.bikes[0].tasks[0], {
    id: 'legacy-task',
    title: 'Legacy task',
    category: 'Notion',
    done: false,
  });
  assert.equal(secondResult.garage.bikes.some((bike) => bike.id === 'bike-2'), true);
});

test('imports older Notion rows without a year as planned motorcycles', async (t) => {
  const legacyBike = {
    id: 'legacy-bike-page',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Simson S51' }] },
      'App ID': { type: 'rich_text', rich_text: [] },
      Year: { type: 'number', number: null },
      Status: { type: 'rich_text', rich_text: [] },
    },
  };
  const mock = mockNotion(t, { initialPages: [legacyBike] });
  const response = await worker.fetch(request('/sync', { localGarage: garage(), baseGarage: null }), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  const imported = result.garage.bikes.find((bike) => bike.name === 'Simson S51');
  assert.equal(imported.year, 1900);
  assert.equal(imported.status, 'Tervezett');
  assert.equal(mock.pages.some((page) => page.id === 'legacy-bike-page'), true);
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
  assert.equal(mock.calls.filter((call) => call.pathname.startsWith('/v1/blocks/block-') && call.method === 'DELETE').length, 1);
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
  assert.equal(mock.calls.find((call) => call.pathname.includes('/children') && call.method === 'PATCH')
    .body.children[0].file.name, 'műhely kézikönyv.pdf');
  assert.deepEqual([...mock.children.get('master-page')[0].file.caption.map((part) => part.plain_text)], [
    'MGFILEv1|document-1|bike-1|document|m%C5%B1hely%20k%C3%A9zik%C3%B6nyv.pdf',
  ]);
  assert.deepEqual([...mock.fileContents.get('https://files.notionusercontent.com/upload-1')], [5, 6, 7]);

  const duplicate = await worker.fetch(uploadRequest(), env);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { uploaded: false, alreadyPresent: true });
  assert.equal(mock.calls.filter((call) => call.pathname === '/v1/file_uploads').length, 1);
});
