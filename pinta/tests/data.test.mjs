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
    plugins: [
      {
        name: 'mock-client',
        setup(builder) {
          builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({
            path: 'mock',
            namespace: 'test',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
            contents: 'export const supabase=globalThis.testClient;',
          }));
        },
      },
    ],
  });
  const context = {
    module: { exports: {} },
    exports: {},
    testClient: mock,
    Date,
    console,
    URL,
    crypto: globalThis.crypto,
  };
  vm.runInNewContext(result.outputFiles[0].text, context);
  return context.module.exports;
}
function client(tables, failTable) {
  const calls = [];
  return {
    calls,
    from(table) {
      let after = null,
        ids = null,
        id = null,
        archive = null,
        limit = Infinity;
      const query = {
        select() {
          return this;
        },
        order() {
          return this;
        },
        limit(n) {
          limit = n;
          return this;
        },
        gt(k, v) {
          after = v;
          return this;
        },
        in(k, v) {
          ids = v;
          return this;
        },
        eq(k, v) {
          if (k === 'id') id = v;
          if (k === 'archive') archive = v;
          return this;
        },
        then(resolve, reject) {
          calls.push({ table, after, limit, ids });
          let rows = (tables[table] || [])
            .filter(
              (r) =>
                (!after || r.id > after) &&
                (!ids || ids.includes(r.colis_id)) &&
                (!id || r.id === id) &&
                (archive === null || r.archive === archive),
            )
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, limit);
          return Promise.resolve(
            table === failTable
              ? { data: null, error: new Error('Database unavailable') }
              : { data: rows, error: null },
          ).then(resolve, reject);
        },
      };
      return query;
    },
  };
}
test('loads more than the PostgREST row cap without losing the last client', async () => {
  const rows = Array.from({ length: 1207 }, (_, i) => ({
    id: String(i).padStart(6, '0'),
    nom: 'Client ' + i,
    created_at: '2026-09-10',
  }));
  const mock = client({ clients: rows });
  const sb = await service(mock);
  const result = await sb.fetchClients();
  assert.equal(result.length, 1207);
  assert.ok(result.some((r) => r.id === '001206'));
  assert.deepEqual(
    mock.calls.map((c) => c.after),
    [null, '000499', '000999'],
  );
});
test('related-table failure rejects a dossier load instead of pretending no invoice exists', async () => {
  const sb = await service(
    client(
      { colis: [{ id: 'p1', archive: false }], factures: [{ id: 'f1', colis_id: 'p1' }] },
      'factures',
    ),
  );
  await assert.rejects(() => sb.fetchColis(), /Database unavailable/);
});
test('archived dossiers are loaded only when explicitly requested', async () => {
  const mock = client({
    colis: [
      { id: 'p1', archive: false },
      { id: 'p2', archive: true },
    ],
  });
  const sb = await service(mock);
  assert.deepEqual(Array.from((await sb.fetchColis()).map((c) => c.id)), ['p1']);
  assert.deepEqual(Array.from((await sb.fetchColis(null, { archived: true })).map((c) => c.id)), [
    'p2',
  ]);
});
test('a concurrently changed dossier cannot be reported as saved', async () => {
  const query = {
    update() {
      return this;
    },
    eq() {
      return this;
    },
    select() {
      return this;
    },
    async maybeSingle() {
      return { data: null, error: null };
    },
  };
  const sb = await service({ from: () => query });
  await assert.rejects(
    () => sb.updateColis('p', { casier: 'A' }, 'old'),
    /modifié par un collègue/,
  );
});
test('unknown fields fail before sending a database mutation', async () => {
  let called = false;
  const sb = await service({
    from() {
      called = true;
      throw new Error('unexpected');
    },
  });
  await assert.rejects(() => sb.updateColis('p', { factures: [] }), /non pris en charge/);
  assert.equal(called, false);
});
test('signed documents cannot point to an arbitrary external host', async () => {
  const sb = await service({ supabaseUrl: 'https://project.supabase.co' });
  await assert.rejects(
    () => sb.signedFileUrl('factures', 'https://example.com/file.pdf'),
    /non autorisé/,
  );
});
test('clients cannot become staff through user-editable auth metadata', async () => {
  const profileQuery = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async single() {
      return { data: { id: 'u', role: 'client', actif: true }, error: null };
    },
  };
  const clientQuery = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async single() {
      return { data: { id: 'c', user_id: 'u', nom: 'Client' }, error: null };
    },
  };
  const sb = await service({
    from: (table) => (table === 'profiles' ? profileQuery : clientQuery),
  });
  const identity = await sb.resolveIdentity({
    user: { id: 'u', user_metadata: { role: 'directeur' } },
  });
  assert.equal(identity.type, 'client');
  assert.equal(identity.cl.id, 'c');
});
