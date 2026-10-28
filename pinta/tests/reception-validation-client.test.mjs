// Validated reception and grouped arrival notice, browser side (src/expedile/lib/receptionValidation.js): the calls
// sent to the three server commands, the arguments refused before any call, the answers shaped for the screens, the
// server's refusals passed on as they are. The server contract itself is tested by supabase/tests/reception-validation.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/expedile/lib/receptionValidation.js'], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'mock-client', setup(builder) {
    builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'mock', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const supabase=globalThis.testClient;' }));
  } }],
});
// A client answering every RPC with `answer(name, args)`, recording the calls.
function service(answer = () => ({ data: null, error: null })) {
  const calls = [];
  const testClient = { rpc(name, args) { calls.push({ name, args }); return Promise.resolve(answer(name, args)); } };
  const context = { module: { exports: {} }, exports: {}, testClient, console, crypto: globalThis.crypto };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  return { api: context.module.exports, calls };
}
const { api } = service();
// Objects built in the module's context: compared by value.
const plain = (value) => JSON.parse(JSON.stringify(value));

const CLIENT = 'f1200000-0000-4000-8000-000000000001';
const NEW = 'f1300000-0000-4000-8000-000000000002';
const OLD = 'f1300000-0000-4000-8000-000000000001';
const REQUEST = 'f1500000-0000-4000-8000-000000000002';
const STAMP = '2026-10-28T14:13:47.30143+00:00';
const pendingRows = [
  { colisId: NEW, ref: 'EXP-NEW', clientId: CLIENT, statut: 'mesure', casier: 'A2', firstCarton: 1, lastCarton: 2, cartonCount: 2, receivedFrom: STAMP, receivedTo: STAMP,
    cartons: [{ carton: 2, number: null, fournisseur: null, dimL: 20, dimW: 20, dimH: 20, poids: 1, receivedAt: STAMP },
      { carton: 1, number: 'NEW-1', fournisseur: 'Cdiscount', dimL: 30, dimW: 20, dimH: 10, poids: 2.5, receivedAt: STAMP }] },
  { colisId: OLD, ref: 'EXP-OLD', clientId: CLIENT, statut: 'mesure', casier: 'A1', firstCarton: 2, lastCarton: 2, cartonCount: 1, receivedFrom: STAMP, receivedTo: STAMP,
    cartons: [{ carton: 2, number: 'OLD-2', fournisseur: 'Zalando', dimL: '25', dimW: 25, dimH: 25, poids: 3, receivedAt: STAMP }] },
];
const rejected = (code, message) => (error) => error.code === code && (!message || error.message === message);

test('pending receptions keep the server order and fields; measures become numbers, blanks and unreadable dates unknown', () => {
  const rows = plain(api.normalizePendingReceptions([...pendingRows, { colisId: 'x', ref: 'EXP-X', casier: '  ', cartonCount: 'n', receivedFrom: 'hier',
    cartons: [{ carton: '3', number: '  ', dimL: 'abc', dimW: '  ', poids: true, receivedAt: '2026-10-28 09:00:00+02' }] }]));
  assert.deepEqual(rows.map((row) => row.ref), ['EXP-NEW', 'EXP-OLD', 'EXP-X']);
  assert.deepEqual(rows[0], { ...pendingRows[0] });
  assert.equal(rows[1].cartons[0].dimL, 25);
  assert.deepEqual(rows[2], { colisId: 'x', ref: 'EXP-X', clientId: null, statut: null, casier: null, firstCarton: null, lastCarton: null, cartonCount: 0,
    receivedFrom: null, receivedTo: null, cartons: [{ carton: 3, number: null, fournisseur: null, dimL: null, dimW: null, dimH: null, poids: null, receivedAt: '2026-10-28 09:00:00+02' }] });
  assert.deepEqual(plain(api.normalizePendingReceptions([])), []);
  for (const answer of [null, undefined, {}, 'oops']) assert.throws(() => api.normalizePendingReceptions(answer), /n’a pas pu être lue/);
});

test('the validation request sends the server parameters; without notice, no channel, template nor text', () => {
  const items = [{ colisId: NEW, throughCarton: 2 }, { colisId: OLD, throughCarton: 2 }];
  assert.deepEqual(plain(api.validationRequest({ clientId: CLIENT, items, notify: true, canal: 'telegram', template: 'arrivee_colis', text: 'Bonjour Flavie', requestId: REQUEST })),
    { p_client_id: CLIENT, p_items: items, p_notify: true, p_canal: 'telegram', p_template: 'arrivee_colis', p_text: 'Bonjour Flavie', p_request_id: REQUEST });
  assert.deepEqual(plain(api.validationRequest({ clientId: CLIENT, items, notify: false, canal: 'telegram', template: 'arrivee_colis', text: 'ignoré', requestId: REQUEST })),
    { p_client_id: CLIENT, p_items: items, p_notify: false, p_canal: null, p_template: null, p_text: null, p_request_id: REQUEST });
  const generated = api.validationRequest({ clientId: CLIENT, items, notify: false }).p_request_id;
  assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // 4096 characters as the server counts them: an emoji is one character.
  assert.equal(api.validationRequest({ clientId: CLIENT, items, notify: true, canal: 'email', template: 'arrivee_colis_facture', text: '📦'.repeat(4096) }).p_canal, 'email');
});

test('an argument the server would refuse is refused before any call, with code 22023', () => {
  const item = { colisId: NEW, throughCarton: 2 };
  const base = { clientId: CLIENT, items: [item], notify: true, canal: 'telegram', template: 'arrivee_colis', text: 'Bonjour' };
  const cases = [
    [{ clientId: 'EXP-1' }, 'Choisissez le client de la réception.'],
    [{ notify: 'oui' }, 'Indiquez si le client doit être prévenu.'],
    [{ requestId: 'retry-1' }, 'Identifiant de validation invalide.'],
    [{ items: [] }, 'Validez de 1 à 20 dossiers à la fois.'],
    [{ items: Array.from({ length: 21 }, (_, n) => ({ colisId: `f1300000-0000-4000-8000-${String(n).padStart(12, '0')}`, throughCarton: 1 })) }, 'Validez de 1 à 20 dossiers à la fois.'],
    [{ items: { colisId: NEW, throughCarton: 2 } }, 'Validez de 1 à 20 dossiers à la fois.'],
    [{ items: [item, { colisId: NEW.toUpperCase(), throughCarton: 1 }] }, 'Un dossier ne figure qu’une fois dans une validation.'],
    [{ items: [{ colisId: NEW, throughCarton: 0 }] }, 'Chaque dossier indique son identifiant et le numéro du dernier carton à valider.'],
    [{ items: [{ colisId: NEW, throughCarton: '2' }] }, 'Chaque dossier indique son identifiant et le numéro du dernier carton à valider.'],
    [{ items: [{ colisId: NEW, throughCarton: 1.5 }] }, 'Chaque dossier indique son identifiant et le numéro du dernier carton à valider.'],
    [{ items: [{ colisId: 'EXP-NEW', throughCarton: 1 }] }, 'Chaque dossier indique son identifiant et le numéro du dernier carton à valider.'],
    [{ canal: 'sms' }, 'Précisez le canal de l’avis d’arrivée : telegram ou email.'],
    [{ canal: null }, 'Précisez le canal de l’avis d’arrivée : telegram ou email.'],
    [{ template: 'demande_feu_vert' }, 'Choisissez le modèle de l’avis d’arrivée : arrivee_colis ou arrivee_colis_facture.'],
    [{ text: '   ' }, 'Le texte de l’avis d’arrivée doit contenir de 1 à 4096 caractères.'],
    [{ text: 'x'.repeat(4097) }, 'Le texte de l’avis d’arrivée doit contenir de 1 à 4096 caractères.'],
  ];
  for (const [change, message] of cases) assert.throws(() => api.validationRequest({ ...base, ...change }), rejected('22023', message), JSON.stringify(change).slice(0, 80));
});

test('the cartons a validation announces, in the order of its dossiers then by number, up to throughCarton', () => {
  const pending = api.normalizePendingReceptions(pendingRows);
  assert.deepEqual(plain(api.pendingValidationItems(pending)), [{ colisId: NEW, throughCarton: 2 }, { colisId: OLD, throughCarton: 2 }]);
  assert.deepEqual(plain(api.receptionCartonsFor(pending, [{ colisId: OLD, throughCarton: 2 }, { colisId: NEW, throughCarton: 2 }])).map((c) => [c.ref, c.carton, c.number]),
    [['EXP-OLD', 2, 'OLD-2'], ['EXP-NEW', 1, 'NEW-1'], ['EXP-NEW', 2, null]]);
  const partial = plain(api.receptionCartonsFor(pending, [{ colisId: NEW, throughCarton: 1 }]));
  assert.deepEqual(partial, [{ colisId: NEW, ref: 'EXP-NEW', carton: 1, number: 'NEW-1', fournisseur: 'Cdiscount', dimL: 30, dimW: 20, dimH: 10, poids: 2.5, receivedAt: STAMP }]);
  assert.deepEqual(plain(api.receptionCartonsFor(pending, [{ colisId: 'f1300000-0000-4000-8000-000000000099', throughCarton: 1 }])), []);
});

test('a validation answer is shaped for the screens: the delivery to follow, or nothing without notice', () => {
  const message = { id: 'm1', colis_id: NEW, type: 'staff', statut: 'envoi', canal: 'telegram', template: 'arrivee_colis', texte: 'Bonjour Flavie', created_at: STAMP, auteur_id: 'a1' };
  const outbox = { id: 'o1', message_id: 'm1', client_id: CLIENT, colis_id: NEW, canal: 'telegram', status: 'pending', attempts: 0, sent_at: null, last_error: null, idempotency_key: 'arrival:v1' };
  const validation = { id: 'v1', requestId: REQUEST, clientId: CLIENT, notify: true, canal: 'telegram', template: 'arrivee_colis', createdAt: STAMP,
    items: [{ colisId: NEW, ref: 'EXP-NEW', firstCarton: 1, lastCarton: 2 }], cartons: [{ colisId: NEW, ref: 'EXP-NEW', ...pendingRows[0].cartons[1] }] };
  assert.deepEqual(plain(api.normalizeValidationResult({ validation, message, outbox, reused: false })), {
    validation: { ...validation, cartons: [{ colisId: NEW, ref: 'EXP-NEW', ...pendingRows[0].cartons[1] }] },
    message: { id: 'm1', colisId: NEW, statut: 'envoi', canal: 'telegram', template: 'arrivee_colis', texte: 'Bonjour Flavie', createdAt: STAMP },
    outbox: { id: 'o1', messageId: 'm1', colisId: NEW, canal: 'telegram', status: 'pending', attempts: 0, sentAt: null, lastError: null, idempotencyKey: 'arrival:v1' },
    reused: false,
  });
  const silent = plain(api.normalizeValidationResult({ validation: { ...validation, notify: false, canal: null, template: null }, message: null, outbox: null, reused: true }));
  assert.equal(silent.message, null);
  assert.equal(silent.outbox, null);
  assert.equal(silent.reused, true);
  assert.equal(silent.validation.notify, false);
  for (const answer of [null, {}, { validation: {} }]) assert.throws(() => api.normalizeValidationResult(answer), /n’a pas été confirmée/);
});

test('arrival notices keep the server order with their delivery state, or none for a validation without notice', () => {
  const notices = plain(api.normalizeArrivalNotices([
    { id: 'v2', createdAt: STAMP, clientId: CLIENT, client: { nom: 'Payet', prenom: 'Flavie' }, actor: { nom: 'Alex Martin' }, notify: true, canal: 'telegram',
      template: 'arrivee_colis', items: [{ colisId: NEW, ref: 'EXP-NEW', firstCarton: 1, lastCarton: 2 }], cartons: [],
      message: { id: 'm2', statut: 'echec', texte: 'Bonjour', createdAt: STAMP }, outbox: { id: 'o2', status: 'failed', attempts: 1, sentAt: null, lastError: 'Telegram : chat introuvable' } },
    { id: 'v1', createdAt: STAMP, clientId: CLIENT, client: { nom: 'Payet' }, actor: {}, notify: false, canal: null, template: null, items: [], cartons: [], message: null, outbox: null },
  ]));
  assert.deepEqual(notices.map((notice) => notice.id), ['v2', 'v1']);
  assert.deepEqual(notices[0].outbox, { id: 'o2', messageId: null, colisId: null, canal: null, status: 'failed', attempts: 1, sentAt: null, lastError: 'Telegram : chat introuvable', idempotencyKey: null });
  assert.deepEqual(notices[0].message, { id: 'm2', colisId: null, statut: 'echec', canal: null, template: null, texte: 'Bonjour', createdAt: STAMP });
  assert.deepEqual(notices[0].actor, { nom: 'Alex Martin' });
  assert.deepEqual([notices[1].notify, notices[1].message, notices[1].outbox, notices[1].client.prenom, notices[1].actor.nom], [false, null, null, null, null]);
  assert.throws(() => api.normalizeArrivalNotices(null), /n’ont pas pu être lus/);
});

test('the three commands are called with their exact parameters; a refusal of the server is passed on as it is', async () => {
  const refusal = { code: '40001', message: 'Le contact du client a changé : l’avis partira par Telegram. Actualisez avant de valider.', hint: null, details: null };
  const answers = {
    list_pending_receptions: { data: pendingRows, error: null },
    validate_reception: { data: null, error: refusal },
    list_arrival_notices: { data: [], error: null },
  };
  const { api: calls, calls: log } = service((name) => answers[name]);
  assert.deepEqual(plain(await calls.fetchPendingReceptions({ clientId: CLIENT })).map((row) => row.colisId), [NEW, OLD]);
  await calls.fetchPendingReceptions();
  await assert.rejects(calls.validateReception({ clientId: CLIENT, items: [{ colisId: NEW, throughCarton: 2 }], notify: true, canal: 'email', template: 'arrivee_colis', text: 'Bonjour', requestId: REQUEST }),
    (error) => error === refusal);
  assert.deepEqual(plain(await calls.fetchArrivalNotices({ colisId: NEW })), []);
  await calls.fetchArrivalNotices({ clientId: CLIENT, limit: 200 });
  assert.deepEqual(plain(log), [
    { name: 'list_pending_receptions', args: { p_client_id: CLIENT } },
    { name: 'list_pending_receptions', args: { p_client_id: null } },
    { name: 'validate_reception', args: { p_client_id: CLIENT, p_items: [{ colisId: NEW, throughCarton: 2 }], p_notify: true, p_canal: 'email', p_template: 'arrivee_colis', p_text: 'Bonjour', p_request_id: REQUEST } },
    { name: 'list_arrival_notices', args: { p_client_id: null, p_colis_id: NEW, p_limit: 50 } },
    { name: 'list_arrival_notices', args: { p_client_id: CLIENT, p_colis_id: null, p_limit: 200 } },
  ]);
});

test('a confirmed validation is returned shaped; an invalid request or limit makes no call', async () => {
  const recorded = { validation: { id: 'v1', requestId: REQUEST, clientId: CLIENT, notify: false, canal: null, template: null, createdAt: STAMP, items: [], cartons: [] },
    message: null, outbox: null, reused: true };
  const { api: calls, calls: log } = service((name) => (name === 'validate_reception' ? { data: recorded, error: null } : { data: [], error: null }));
  const saved = plain(await calls.validateReception({ clientId: CLIENT, items: [{ colisId: OLD, throughCarton: 2 }], notify: false, requestId: REQUEST }));
  assert.equal(saved.validation.id, 'v1');
  assert.equal(saved.reused, true);
  await assert.rejects(calls.validateReception({ clientId: CLIENT, items: [], notify: false }), rejected('22023'));
  await assert.rejects(calls.fetchArrivalNotices({ limit: 0 }), rejected('22023', 'Demandez de 1 à 200 avis d’arrivée.'));
  await assert.rejects(calls.fetchArrivalNotices({ limit: 201 }), rejected('22023'));
  assert.equal(log.length, 1);
  // A server answer without a validation is never shown as a success.
  const { api: empty } = service(() => ({ data: null, error: null }));
  await assert.rejects(empty.validateReception({ clientId: CLIENT, items: [{ colisId: OLD, throughCarton: 2 }], notify: false }), /n’a pas été confirmée/);
  await assert.rejects(empty.fetchPendingReceptions(), /n’a pas pu être lue/);
});
