import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Bundle the real adapter. Only the Supabase transport is replaced; no copied
// fetch/pagination logic is exercised by these tests.
const bundle = await build({
  entryPoints: [new URL('../src/expedile/lib/supabaseData.js', import.meta.url).pathname],
  bundle: true, write: false, format: 'cjs', platform: 'node',
  plugins: [{ name: 'isolated-workspace-client', setup(builder) {
    builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'client', namespace: 'workspace-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'workspace-test' }, () => ({ contents: 'export const supabase=globalThis.testClient;' }));
  } }],
});
function adapter(client) {
  const context = { module: { exports: {} }, exports: {}, testClient: client, Date, URL, crypto: globalThis.crypto };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  return context.module.exports;
}

// The query double rejects unknown columns from the actual table declarations,
// including the absence of an "id" column on staff_work_preferences.
const migration = await readFile(new URL('../supabase/migrations/20260912000002_staff_work_actions.sql', import.meta.url), 'utf8');
function columnsOf(table) {
  const definition = migration.match(new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`))?.[1];
  assert.ok(definition, `${table} declaration must exist`);
  const segments = [];
  let start = 0, depth = 0, quoted = false;
  for (let index = 0; index < definition.length; index++) {
    const char = definition[index];
    if (char === "'") {
      if (quoted && definition[index + 1] === "'") { index++; continue; }
      quoted = !quoted;
    }
    if (quoted) continue;
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) { segments.push(definition.slice(start, index)); start = index + 1; }
  }
  segments.push(definition.slice(start));
  return new Set(segments.map(segment => segment.trim().match(/^([a-z_][a-z_0-9]*)\s/i)?.[1]).filter(column => column && !/^(UNIQUE|CHECK|CONSTRAINT|PRIMARY|FOREIGN)$/i.test(column)));
}
const schema = Object.fromEntries(['staff_work_actions', 'staff_work_preferences'].map(table => [table, columnsOf(table)]));
const executedSchemaProof = await readFile(new URL('../../docs/verification-organisation-backend-2026-09-12/work-table-columns.txt', import.meta.url), 'utf8');
const executedSchema = JSON.parse(executedSchemaProof.split('\n').find(line => line.trim().startsWith('{')));
const uuid = (number, prefix = '10000000') => `${prefix}-0000-4000-8000-${String(number).padStart(12, '0')}`;
const preference = number => ({ staff_id: uuid(number), missions: ['preparation'], active_mission: null, density: 'compact', available: number % 2 === 0, absent_until: null, version: 3, updated_at: '2026-09-12T10:00:00Z' });
const action = (number, state = 'ready') => ({ id: uuid(number, '20000000'), colis_id: uuid(number, '30000000'), kind: 'preparation', state, assignee_id: null, version: 2, created_at: '2026-09-12T10:00:00Z' });

function transport(tables = {}, { refreshError = null, failTable = null, failAfter = null } = {}) {
  const calls = [];
  let refreshCompleted = false;
  return {
    calls,
    async rpc(name) {
      calls.push({ type: 'rpc', name });
      assert.equal(name, 'refresh_staff_work_actions', 'Read path must only refresh elapsed work waits');
      await Promise.resolve();
      refreshCompleted = !refreshError;
      return { data: null, error: refreshError };
    },
    from(table) {
      assert.ok(schema[table], `Unexpected workspace table: ${table}`);
      let orderKey = null, limit = null, cursor = null, queryError = null;
      const filters = [];
      const column = key => {
        if (!schema[table].has(key)) queryError ||= { code: '42703', message: `column ${table}.${key} does not exist` };
      };
      const query = {
        select(value) { assert.equal(value, '*'); return this; },
        order(key) { column(key); orderKey = key; return this; },
        limit(value) { assert.ok(Number.isInteger(value) && value > 0 && value <= 500, 'Requests obey the 500-row page size'); limit = value; return this; },
        gt(key, value) { column(key); cursor = { key, value }; return this; },
        neq(key, value) { column(key); filters.push({ key, value }); return this; },
        then(resolve, reject) {
          calls.push({ type: 'select', table, orderKey, cursor, limit, filters: structuredClone(filters), refreshCompleted });
          assert.ok(orderKey, 'Pagination must request a deterministic order');
          let result;
          if (queryError) result = { data: null, error: queryError };
          else if (table === failTable && (!failAfter || cursor?.value === failAfter)) result = { data: null, error: { code: '503', message: `Unavailable: ${table}` } };
          else {
            const rows = (tables[table] || []).filter(row => filters.every(filter => row[filter.key] !== filter.value))
              .filter(row => !cursor || row[cursor.key] > cursor.value)
              .sort((a, b) => a[orderKey].localeCompare(b[orderKey]))
              .slice(0, limit);
            result = { data: rows, error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test('schema-strict preference transport rejects the nonexistent id column', async () => {
  assert.equal(schema.staff_work_preferences.has('id'), false);
  assert.equal(schema.staff_work_preferences.has('staff_id'), true);
  const client = transport({ staff_work_preferences: [preference(1)] });
  const result = await client.from('staff_work_preferences').select('*').order('id').limit(500);
  assert.equal(result.error.code, '42703');
  assert.match(result.error.message, /staff_work_preferences.id/);
});

test('strict transport columns match the schema actually executed on isolated PostgreSQL 17', () => {
  for (const table of Object.keys(schema)) assert.deepEqual([...schema[table]].sort(), executedSchema[table].toSorted(), table);
});

test('real workspace adapter loads 1207 preferences using staff_id keyset pagination', async () => {
  const rows = Array.from({ length: 1207 }, (_, index) => preference(index)).reverse();
  const client = transport({ staff_work_preferences: rows, staff_work_actions: [action(1)] });
  const result = await adapter(client).fetchStaffWork();
  assert.equal(result.preferences.length, 1207);
  assert.equal(new Set(result.preferences.map(row => row.staff_id)).size, 1207);
  assert.equal(result.preferences[0].staff_id, uuid(0));
  assert.equal(result.preferences.at(-1).staff_id, uuid(1206));
  assert.equal(result.preferences[1].available, false, 'False availability must survive the adapter');
  assert.equal(result.preferences[1].version, 3);
  assert.equal(result.preferences[1].active_mission, null);
  const pages = client.calls.filter(call => call.table === 'staff_work_preferences');
  assert.deepEqual(pages.map(page => page.orderKey), ['staff_id', 'staff_id', 'staff_id']);
  assert.deepEqual(pages.map(page => page.cursor), [null, { key: 'staff_id', value: uuid(499) }, { key: 'staff_id', value: uuid(999) }]);
  assert.ok(client.calls.filter(call => call.type === 'select').every(call => call.refreshCompleted), 'Refreshing waits must finish before table reads');
});

test('a complete 500-row preference page terminates using a second empty staff_id page', async () => {
  const client = transport({ staff_work_preferences: Array.from({ length: 500 }, (_, index) => preference(index)) });
  assert.equal((await adapter(client).fetchStaffWork()).preferences.length, 500);
  const pages = client.calls.filter(call => call.table === 'staff_work_preferences');
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[1].cursor, { key: 'staff_id', value: uuid(499) });
});

test('completed actions are excluded in every paginated server query', async () => {
  const rows = Array.from({ length: 1210 }, (_, index) => action(index, index % 3 === 0 ? 'done' : index % 3 === 1 ? 'ready' : 'waiting'));
  const client = transport({ staff_work_actions: rows });
  const result = await adapter(client).fetchStaffWork();
  assert.equal(result.actions.length, 806);
  assert.equal(result.actions.some(row => row.state === 'done'), false);
  assert.equal(new Set(result.actions.map(row => row.id)).size, 806);
  const pages = client.calls.filter(call => call.table === 'staff_work_actions');
  assert.equal(pages.length, 2);
  assert.ok(pages.every(page => page.orderKey === 'id'));
  assert.ok(pages.every(page => page.filters.some(filter => filter.key === 'state' && filter.value === 'done')), 'Filtering must occur before each 500-row page, not after download');
});

test('failure to refresh elapsed waits rejects without reading stale tables as a successful load', async () => {
  const error = { code: '42501', message: 'Accès équipe requis' };
  const client = transport({}, { refreshError: error });
  await assert.rejects(adapter(client).fetchStaffWork(), thrown => thrown === error);
  assert.deepEqual(client.calls, [{ type: 'rpc', name: 'refresh_staff_work_actions' }]);
});

for (const table of ['staff_work_preferences', 'staff_work_actions']) {
  test(`failure reading ${table} rejects the whole workspace load`, async () => {
    const client = transport({ staff_work_actions: [action(1)], staff_work_preferences: [preference(1)] }, { failTable: table });
    await assert.rejects(adapter(client).fetchStaffWork(), error => error.message === `Unavailable: ${table}`);
  });
}

test('a later preference page failure never returns a misleading partial list', async () => {
  const client = transport({ staff_work_preferences: Array.from({ length: 700 }, (_, index) => preference(index)) }, { failTable: 'staff_work_preferences', failAfter: uuid(499) });
  await assert.rejects(adapter(client).fetchStaffWork(), error => error.message === 'Unavailable: staff_work_preferences');
  assert.equal(client.calls.filter(call => call.table === 'staff_work_preferences').length, 2);
});
