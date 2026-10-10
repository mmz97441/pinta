// Deleting a client or a departure (20261010000001_history_retention.sql): the server's French refusal reaches the
// screen as it is, and a deletion that RLS silently skips is never reported as done.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

async function service(mock) {
  const result = await build({
    entryPoints: ['src/expedile/lib/supabaseData.js'],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    plugins: [{
      name: 'mock-client',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'mock', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const supabase=globalThis.testClient;' }));
      },
    }],
  });
  const context = { module: { exports: {} }, exports: {}, testClient: mock, Date, console, URL, crypto: globalThis.crypto };
  vm.runInNewContext(result.outputFiles[0].text, context);
  return context.module.exports;
}

// A PostgREST client answering one DELETE with the given result, recording what was asked.
function deleting(result) {
  const calls = [];
  const query = {
    delete() { calls.push(['delete']); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    select(columns) { calls.push(['select', columns]); return Promise.resolve(result); },
  };
  return { calls, from(table) { calls.push(['from', table]); return query; } };
}

const CLIENT_KEPT = 'Ce client a un historique conservé dix ans (dossiers, échanges, invitation Telegram ou paiements) : sa fiche ne peut pas être supprimée.';
const DEPARTURE_KEPT = 'Ce départ contient encore des dossiers : retirez-les du départ avant de le supprimer.';

test('a client kept for its history: the server message is shown as it is', async () => {
  const client = deleting({ data: null, error: { code: '23001', message: CLIENT_KEPT, hint: 'retention:clients' } });
  const sb = await service(client);
  await assert.rejects(() => sb.deleteClient('c1'), (error) => error.message === CLIENT_KEPT && error.code === '23001');
});

test('a client deletion that RLS skips is a refusal, never a silent success', async () => {
  const sb = await service(deleting({ data: [], error: null }));
  await assert.rejects(() => sb.deleteClient('c1'), /^Error: Fiche non supprimée : seule la direction peut supprimer un client/);
});

test('a client deletion reads the deleted row back', async () => {
  const client = deleting({ data: [{ id: 'c1' }], error: null });
  const sb = await service(client);
  await sb.deleteClient('c1');
  assert.deepEqual(client.calls, [['from', 'clients'], ['delete'], ['eq', 'id', 'c1'], ['select', 'id']]);
});

test('a departure kept for its dossiers or its history: the server message is shown as it is', async () => {
  const sb = await service(deleting({ data: null, error: { code: '23001', message: DEPARTURE_KEPT, hint: 'retention:envois' } }));
  await assert.rejects(() => sb.deleteEnvoi('e1'), (error) => error.message === DEPARTURE_KEPT);
});

test('a departure deletion that RLS skips is a refusal; a deleted departure is read back', async () => {
  await assert.rejects(() => service(deleting({ data: [], error: null })).then((sb) => sb.deleteEnvoi('e1')),
    /^Error: Départ non supprimé : seul un départ planifié, sans dossier/);
  const client = deleting({ data: [{ id: 'e1' }], error: null });
  await (await service(client)).deleteEnvoi('e1');
  assert.deepEqual(client.calls, [['from', 'envois'], ['delete'], ['eq', 'id', 'e1'], ['select', 'id']]);
});
