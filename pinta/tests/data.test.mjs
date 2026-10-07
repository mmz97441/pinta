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

test('payment mapping preserves recorded zero and partial amounts instead of making them editable', async () => {
  const sb = await service(client({ colis: [
    { id: 'a', archive: false, paiement_montant: 0 },
    { id: 'b', archive: false, paiement_montant: '12.50' },
    { id: 'c', archive: false, paiement_montant: null },
    { id: 'd', archive: false },
  ] }));
  const rows = await sb.fetchColis();
  assert.equal(rows.find(row => row.id === 'a').paiementMontant, 0);
  assert.equal(rows.find(row => row.id === 'b').paiementMontant, 12.5);
  assert.equal(rows.find(row => row.id === 'c').paiementMontant, null);
  assert.equal(rows.find(row => row.id === 'd').paiementMontant, null);
});
test('loaded messages keep their channel, template and author', async () => {
  const sb = await service(client({
    colis: [{ id: 'p1', archive: false }],
    messages: [
      { id: 'm1', colis_id: 'p1', type: 'staff', auteur_id: 'staff-1', auteur_nom: 'Camille', texte: 'Bonjour', statut: 'echec', canal: 'telegram', template: 'demande_feu_vert', created_at: '2026-10-05T06:00:00Z' },
      { id: 'm2', colis_id: 'p1', type: 'client', texte: 'Merci', created_at: '2026-10-05T07:00:00Z' },
    ],
  }));
  const [dossier] = await sb.fetchColis();
  const [sent, received] = dossier.messages;
  assert.equal(sent.canal, 'telegram'); assert.equal(sent.template, 'demande_feu_vert'); assert.equal(sent.auteurId, 'staff-1');
  assert.equal(received.canal, null); assert.equal(received.template, null); assert.equal(received.auteurId, null);
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
test('the desired departure day and the transport mode are mapped; the day is never written as an ordinary field', async () => {
  const sb = await service(client({
    colis: [{ id: 'a', archive: false, depart_souhaite: '2026-11-19' }, { id: 'b', archive: false }],
    envois: [
      { id: 'e1', date_depart: '2026-10-08', mode_transport: 'aerien', loading_closes_at: null },
      { id: 'e2', date_depart: '2026-10-15', mode_transport: null, loading_closes_at: '2026-10-14T13:30:00Z' },
      { id: 'e3', date_depart: null },
    ],
  }));
  const rows = await sb.fetchColis();
  assert.equal(rows.find(row => row.id === 'a').departSouhaite, '2026-11-19');
  assert.equal(rows.find(row => row.id === 'b').departSouhaite, null);
  const envois = await sb.fetchEnvois();
  assert.deepEqual(Array.from(envois, envoi => [envoi.id, envoi.modeTransport, envoi.loadingClosesAt, envoi.closesAt]), [
    ['e3', null, null, null],
    ['e1', 'aerien', null, '2026-10-07T15:00:00.000Z'],
    ['e2', null, '2026-10-14T13:30:00Z', '2026-10-14T13:30:00.000Z'],
  ], 'The closing is the loading closing, else Wednesday 17:00 Paris before the departure.');
  let called = false;
  const guarded = await service({ from() { called = true; throw new Error('unexpected'); } });
  await assert.rejects(() => guarded.updateColis('a', { departSouhaite: '2026-11-20' }), /non pris en charge/);
  assert.equal(called, false, 'Only the departure commands write the desired day.');
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
    async maybeSingle() {
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
    async maybeSingle() {
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

/** profiles, staff_users and client_clients, each answering { data, error } (maybeSingle). */
function identityClient(answers) {
  const reads = [];
  const query = table => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { reads.push(table); return answers[table] || { data: null, error: null }; } });
  return { reads, from: query };
}
test('a failed read of the account is never reported as an account problem', async () => {
  const unavailable = { data: null, error: { code: '', message: 'TypeError: Failed to fetch', status: 0 } };
  const profile = { data: { id: 'u', role: 'client', actif: true }, error: null };
  const session = { user: { id: 'u' } };
  for (const answers of [{ profiles: unavailable }, { profiles: profile, client_clients: unavailable }, { profiles: { data: { id: 'u', role: 'preparateur', actif: true }, error: null }, staff_users: { data: null, error: { code: '503', message: 'Service unavailable' } } }]) {
    const sb = await service(identityClient(answers));
    await assert.rejects(() => sb.resolveIdentity(session), error => error.code === sb.IDENTITY_UNAVAILABLE && /réessayez/.test(error.message) && !/rattaché|inaccessible/.test(error.message), JSON.stringify(answers));
  }
  // Only an answer without the row is an account problem.
  const notLinked = await service(identityClient({ profiles: profile, client_clients: { data: null, error: null } }));
  await assert.rejects(() => notLinked.resolveIdentity(session), error => error.code !== notLinked.IDENTITY_UNAVAILABLE && /pas encore rattaché à un dossier client/.test(error.message));
  const noProfile = await service(identityClient({ profiles: { data: null, error: null } }));
  await assert.rejects(() => noProfile.resolveIdentity(session), /Profil inaccessible/);
  const disabled = await service(identityClient({ profiles: { data: { id: 'u', role: 'client', actif: false }, error: null } }));
  await assert.rejects(() => disabled.resolveIdentity(session), /désactivé/);
});

test('client portal: a malformed expedition link is an expedition that does not exist', async () => {
  const db = client({ client_colis: [{ id: '33333333-3333-4333-8333-333333333333', archive: false, statut: 'attente_feu_vert' }] });
  const sb = await service(db);
  sb.setDataScope('client');
  assert.deepEqual([...await sb.fetchColis('33333333-3333-4333-8333-33333333333')], [], 'one character missing');
  assert.deepEqual([...await sb.fetchColis('pas-un-identifiant')], []);
  assert.equal(db.calls.length, 0, 'no request for a link that names no expedition');
  assert.equal((await sb.fetchColis('33333333-3333-4333-8333-333333333333')).length, 1);
  // A uuid refused by the server (22P02) reads the same way.
  const refusing = client({});
  refusing.from = () => ({ select() { return this; }, order() { return this; }, limit() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } }).then(resolve); } });
  const other = await service(refusing); other.setDataScope('client');
  assert.deepEqual([...await other.fetchColis('aaaaaaaa-0000-4000-8000-000000000999')], []);
});

test('client portal: a failed carrier tracking read keeps every expedition and marks only the shipped ones', async () => {
  const rows = [{ id: 'a1', archive: false, statut: 'attente_feu_vert' }, { id: 'b2', archive: false, statut: 'transit' }, { id: 'c3', archive: false, statut: 'paye' }];
  const db = client({ client_colis: rows }); const asked = [];
  db.rpc = async (name, args) => {
    if (name === 'client_outgoing_tracking') { asked.push(args.p_colis_ids); return { data: null, error: { code: '503', message: 'unavailable' } }; }
    return { data: [], error: null };
  };
  const sb = await service(db); sb.setDataScope('client');
  const result = await sb.fetchColis();
  assert.deepEqual([...result.map(row => row.id)].sort(), ['a1', 'b2', 'c3'], 'every expedition stays displayed');
  assert.deepEqual(asked.map(ids => [...ids]), [['b2']], 'only the shipped expeditions are asked for a carrier number');
  assert.deepEqual({ ...Object.fromEntries([...result].map(row => [row.id, row.outgoingTrackingError])) }, { a1: false, b2: true, c3: false });
  // Nothing shipped: no request at all; once read, the number is kept.
  const quiet = client({ client_colis: [rows[0]] }); let calls = 0; quiet.rpc = async (name) => { if (name === 'client_outgoing_tracking') calls++; return { data: [], error: null }; };
  const portal = await service(quiet); portal.setDataScope('client'); await portal.fetchColis();
  assert.equal(calls, 0);
  const read = client({ client_colis: [rows[1]] }); read.rpc = async (name) => ({ data: name === 'client_outgoing_tracking' ? [{ colis_id: 'b2', tracking_principal: 'SORTANT-1' }] : [], error: null });
  const shipped = await service(read); shipped.setDataScope('client');
  const [row] = await shipped.fetchColis();
  assert.equal(row.outgoingTracking, 'SORTANT-1'); assert.equal(row.outgoingTrackingError, false);
});

test('carton date evidence loads in bounded batches without leaking a ledger or replacing supplied server dates', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ id: String(i).padStart(4, '0'), archive: false, nb_colis: 2, reception_dates: null }));
  const db = client({ colis: rows }); const batches = [];
  db.rpc = async (name, args) => {
    assert.equal(name, 'get_reception_dates'); batches.push(args.p_colis_ids);
    return { data: args.p_colis_ids.map(id => ({ colis_id: id, reception_dates: [null, { receivedAt: '2026-10-02T10:00:00Z', source: 'append_receipt' }] })), error: null };
  };
  const data = await service(db); const result = await data.fetchColis();
  assert.equal(result.length, 205); assert.deepEqual(batches.map(ids => ids.length), [100, 100, 5]);
  assert.equal(result[0].receptionDates[0], null); assert.equal(result[0].receptionDates[1].source, 'append_receipt');
  assert.equal(result[0].receptionDatesError, false);
  assert.equal(db.calls.some(call => call.table === 'reception_append_receipts'), false);
});
test('a failed date evidence request keeps the dossier and marks only its date evidence unavailable', async () => {
  const db = client({ colis: [{ id: 'date-error', archive: false, nb_colis: 2, reception_dates: null }] });
  db.rpc = async () => ({ data: null, error: { code: '503', message: 'unavailable' } });
  const data = await service(db); const result = await data.fetchColis();
  assert.equal(result.length, 1); assert.equal(result[0].id, 'date-error');
  assert.equal(result[0].receptionDatesError, true); assert.equal(result[0].receptionDates, null);
});
test('invoice arrival and validation dates are read but never written back', async () => {
  const sent = [];
  const row = { id: 'f1', colis_id: 'p1', vendeur: 'Fnac', montant: '10.50', valide: true, fichier_url: 'p1/a.pdf', fichier_nom: 'a.pdf', created_at: '2026-09-01T08:00:00+00:00', valide_le: '2026-09-02T09:00:00+00:00' };
  const query = {
    insert(payload) { sent.push(['insert', payload]); return this; },
    update(payload) { sent.push(['update', payload]); return this; },
    eq() { return this; },
    select() { return this; },
    async single() { return { data: row, error: null }; },
  };
  const sb = await service({ from: () => query });
  const mapped = sb.mapFact(row);
  assert.equal(mapped.createdAt, '2026-09-01T08:00:00+00:00');
  assert.equal(mapped.valideLe, '2026-09-02T09:00:00+00:00');
  assert.equal(sb.mapFact({ id: 'f2' }).createdAt, null);
  assert.equal(sb.mapFact({ id: 'f2' }).valideLe, null);
  const saved = await sb.updateFacture('f1', { ...mapped, fichierUrl: 'p1/b.pdf', rejetMotif: null });
  assert.equal(saved.createdAt, row.created_at, 'A saved row keeps its arrival date for ordering.');
  await sb.insertFacture('p1', { ...mapped, fichierUrl: 'p1/c.pdf' });
  for (const [, payload] of sent) {
    for (const key of ['created_at', 'createdAt', 'valide_le', 'valideLe']) assert.equal(key in payload, false, `${key} must stay server-owned`);
  }
});
test('the Telegram username is written without @ by every client write, and read without @', async () => {
  const sent = [];
  const query = {
    insert(payload) { sent.push(['insert', payload]); this.row = { id: 'c-new', ...payload }; return this; },
    update(payload) { sent.push(['update', payload]); this.row = { id: 'c1', nom: 'Payet', ...payload }; return this; },
    eq() { return this; },
    select() { return this; },
    async single() { return { data: this.row, error: null }; },
  };
  const sb = await service({ from: () => query });
  const created = await sb.insertClient({ nom: 'Payet', cp: '97400', telegramUsername: '  @flaviep ' });
  assert.equal(sent[0][1].telegram_username, 'flaviep');
  assert.equal(created.telegramUsername, 'flaviep');
  await sb.insertClient({ nom: 'Sans Telegram', cp: '97400', telegramUsername: '@' });
  assert.equal(sent[1][1].telegram_username, null, 'An empty handle is stored as no username.');
  const updated = await sb.updateClient('c1', { telegramUsername: '@@jmhoarau' });
  assert.deepEqual({ ...sent[2][1] }, { telegram_username: 'jmhoarau' }, 'Only the changed field is sent, normalised.');
  assert.equal(updated.telegramUsername, 'jmhoarau');
  await sb.updateClient('c1', { telegramUsername: '' });
  assert.deepEqual({ ...sent[3][1] }, { telegram_username: null });
  await sb.updateClient('c1', { notes: 'Sans identifiant' });
  assert.equal('telegram_username' in sent[4][1], false, 'A write without the username leaves it untouched.');
  // Older rows saved with an @ read like the others.
  assert.equal(sb.mapClient({ id: 'old', telegram_username: '@ancien' }).telegramUsername, 'ancien');
  assert.equal(sb.mapClient({ id: 'none', telegram_username: null }).telegramUsername, null);
  assert.equal(sb.mapClient({ id: 'blank', telegram_username: ' @ ' }).telegramUsername, null);
});
