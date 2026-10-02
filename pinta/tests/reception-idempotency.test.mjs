import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [new URL('../src/expedile/lib/supabaseData.js', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolated-storage', setup(builder) {
  builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase', namespace: 'test' }));
  builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const supabase = globalThis.testSupabase;', loader: 'js' }));
} }] });
const createId = 'eb400000-0000-4000-8000-000000000001';
const input = { clientId: 'client', desc: 'Carton', dateReception: '2026-10-01T09:00:00.000Z', casier: 'A1', nbColis: 1, statut: 'mesure', dimL: 10, dimW: 20, dimH: 30, poids: 2, dimsParColis: [{ dimL: 10, dimW: 20, dimH: 30, poids: 2 }] };

function storage({ loseResponse = false, readUnavailable = false, collision = false } = {}) {
  const rows = [], calls = [], state = { readUnavailable: false, loseResponse, collision };
  const testSupabase = { from(table) {
    let insert, single = false, conditions = [];
    const query = {
      select() { return this; }, order() { return this; }, limit() { return this; }, in() { return this; },
      eq(key, value) { conditions.push([key, value]); return this; },
      maybeSingle() { single = true; return this; }, single() { single = true; return this; },
      insert(value) { insert = structuredClone(value); return this; },
      then(resolve, reject) {
        calls.push({ table, operation: insert ? 'insert' : 'select' });
        let result;
        if (insert) {
          if (state.collision) { state.collision = false; result = { error: { code: '23505', message: 'reference collision' } }; }
          else {
            assert.equal(rows.some(row => row.id === insert.id), false, 'stable UUID cannot be inserted twice');
            rows.push(insert);
            if (state.loseResponse) { state.loseResponse = false; state.readUnavailable = readUnavailable; result = { error: { message: 'network response lost' } }; }
            else result = { data: insert };
          }
        } else if (state.readUnavailable) result = { error: { message: 'offline' } };
        else {
          const selected = table === 'colis' ? rows.filter(row => conditions.every(([key, value]) => row[key] === value))
            : table === 'factures' ? [{ id: 'invoice-existing', colis_id: createId, vendeur: 'Boutique', montant: 20 }] : [];
          result = { data: single ? selected[0] || null : selected };
        }
        return Promise.resolve(structuredClone(result)).then(resolve, reject);
      },
    };
    return query;
  } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, testSupabase, console, URL });
  return { api: module.exports, rows, calls, state };
}

test('lost creation response recovers the existing UUID and preserves documents with no second insertion', async () => {
  const { api, calls, rows } = storage({ loseResponse: true });
  const saved = await api.insertColis(input, { createId });
  assert.equal(saved.id, createId);
  assert.equal(saved.factures[0].id, 'invoice-existing');
  assert.equal(rows.length, 1);
  assert.equal(calls.filter(call => call.operation === 'insert').length, 1);
});

test('retry after an outage reuses the receipt after workflow advancement', async () => {
  const { api, calls, rows, state } = storage({ loseResponse: true, readUnavailable: true });
  await assert.rejects(api.insertColis(input, { createId }), error => error.message === 'offline');
  state.readUnavailable = false;
  rows[0].statut = 'autorise'; rows[0].date_reception = '2026-10-01T09:00:00+00:00';
  rows[0].poids = '2.00';
  const saved = await api.insertColis(input, { createId });
  assert.equal(saved.statut, 'autorise');
  assert.equal(calls.filter(call => call.operation === 'insert').length, 1);
});

test('reusing a draft UUID for another client or changed physical measurements is rejected', async () => {
  const { api, calls } = storage();
  await api.insertColis(input, { createId });
  for (const changed of [{ ...input, clientId: 'another-client' }, { ...input, poids: 3 }, { ...input, casier: 'B2' }])
    await assert.rejects(api.insertColis(changed, { createId }), error => error.code === '40001');
  assert.equal(calls.filter(call => call.operation === 'insert').length, 1);
});

test('an EXP reference collision retries a new reference with the same receipt UUID', async () => {
  const { api, rows, calls } = storage({ collision: true });
  assert.equal((await api.insertColis(input, { createId })).id, createId);
  assert.equal(rows.length, 1);
  assert.equal(calls.filter(call => call.operation === 'insert').length, 2);
});
