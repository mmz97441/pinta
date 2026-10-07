import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// The service runs against a recorded Supabase double: no network, nothing persisted.
const entry = new URL('../src/expedile/services/loadingChecks.js', import.meta.url).pathname;
const bundle = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolated-supabase', setup(builder) {
  builder.onResolve({ filter: /\/lib\/supabase$/ }, () => ({ path: 'supabase', namespace: 'test' }));
  builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const supabase = globalThis.testSupabase;', loader: 'js' }));
} }] });
function service(answer) {
  const calls = [];
  const testSupabase = { rpc(name, args) { calls.push({ name, args }); return Promise.resolve(answer(name, args)); } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, testSupabase, console });
  return { api: module.exports, calls };
}
const { api } = service(() => ({ data: null, error: null }));
// Values built in the service's own context compare by structure.
const plain = value => JSON.parse(JSON.stringify(value));
const migration = readFileSync(new URL('../supabase/migrations/20261007000004_departure_loading_checks.sql', import.meta.url), 'utf8');

const ENVOI = '1c400000-0000-4000-8000-000000000001', COLIS = '1c300000-0000-4000-8000-000000000001';
const CHECK = { colis_id: COLIS, parcel_index: 1, parcel_count: 2, method: 'scan', checked_by: 'staff-1', checked_by_name: 'Marc Grondin', checked_at: '2026-10-07T08:15:00+00:00' };

test('every refusal reason the server raises is known to the screen, and none is invented', () => {
  const raised = [...new Set([...migration.matchAll(/HINT='loading_check:([a-z_]+)'/g)].map(match => match[1]))].sort();
  assert.deepEqual(raised, Object.keys(api.LOADING_CHECK_REASONS).sort());
  assert.deepEqual(plain(api.LOADING_CHECK_METHODS), ['scan', 'camera', 'count']);
  assert.match(migration, /method text NOT NULL CHECK\(method IN \('scan','camera','count'\)\)/);
});

test('a refusal of the loading control is shown as the server wrote it, with what happened', () => {
  const stale = { code: '22023', hint: 'loading_check:stale_label', message: 'Étiquette périmée : ce dossier compte maintenant 3 colis. Réimprimez ses étiquettes.', details: null };
  assert.deepEqual(plain(api.loadingCheckError(stale)), { reason: 'stale_label', message: stale.message, refresh: true, code: '22023', details: null });
  const moved = { code: '40001', hint: 'loading_check:not_assigned', message: 'EXP-2YE537 n’est pas affecté à ce départ : ne chargez pas ses colis. Actualisez le chargement.' };
  assert.deepEqual(plain(api.loadingCheckError(moved)), { reason: 'not_assigned', message: moved.message, refresh: true, code: '40001', details: null }, 'The HINT wins over the conflict code.');
  const counted = { code: '22023', hint: 'loading_check:count_mismatch', message: 'Comptage différent : EXP-2YE537 compte 2 colis, vous en avez compté 1. Recomptez ses colis, ou reportez-le.' };
  assert.equal(api.loadingCheckError(counted).refresh, false, 'A wrong count is recounted, the data are current.');
  const role = { code: '42501', hint: 'loading_check:permission', message: 'Permission d’expédition requise pour contrôler le chargement' };
  assert.deepEqual(plain(api.loadingCheckError(role, 'read')), { reason: 'permission', message: role.message, refresh: false, code: '42501', details: null });
});

test('« Contrôle incomplet » names the dossier to scan, count or defer', () => {
  const incomplete = { code: '22023', hint: 'loading_check:incomplete', message: 'Contrôle incomplet : EXP-2YE537 (1/2 colis vérifiés). Scannez ou comptez ses colis, ou reportez-le.',
    details: '{"colis_id": "1c300000-0000-4000-8000-000000000001", "ref": "EXP-2YE537", "checked": 1, "expected": 2}' };
  assert.deepEqual(plain(api.loadingCheckError(incomplete)), { reason: 'incomplete', message: incomplete.message, refresh: false, code: '22023',
    details: { colisId: COLIS, ref: 'EXP-2YE537', checked: 1, expected: 2 } });
  assert.equal(api.loadingCheckError({ ...incomplete, details: 'pas du JSON' }).details, null, 'An unreadable detail never hides the message.');
  assert.equal(api.loadingCheckError({ ...incomplete, details: '[1,2]' }).details, null);
});

test('any other failure gets a French sentence for the operation, never a technical one', () => {
  const network = { message: 'TypeError: Failed to fetch', details: 'TypeError: Failed to fetch\n    at fetch', hint: '', code: '' };
  assert.deepEqual(plain(api.loadingCheckError(network)), { reason: 'network', refresh: false, code: '', details: null,
    message: 'Connexion impossible : ce contrôle n’est pas confirmé. Vérifiez le réseau puis recommencez ; un colis déjà contrôlé n’est jamais compté deux fois.' });
  assert.match(api.loadingCheckError(network, 'clear').message, /^Connexion impossible : l’effacement n’est pas confirmé/);
  assert.match(api.loadingCheckError(network, 'read').message, /^Connexion impossible : le contrôle du chargement n’a pas pu être lu/);
  // An expired session reaches PostgreSQL as anon: its English refusal is never shown.
  const anonymous = { code: '42501', message: 'permission denied for function record_loading_check', hint: null };
  assert.equal(api.loadingCheckError(anonymous).reason, 'permission');
  assert.equal(api.loadingCheckError(anonymous).message, 'Accès refusé : reconnectez-vous, ou demandez à la direction la permission d’expédier les colis.');
  assert.equal(api.loadingCheckError(anonymous, 'read').message, 'Accès refusé : reconnectez-vous, ou demandez à la direction l’accès aux départs.');
  // Before the release is applied, the API does not know the function.
  const missing = { code: 'PGRST202', message: 'Could not find the function public.record_loading_check(...) in the schema cache', hint: 'Perhaps you meant ...' };
  assert.deepEqual(plain(api.loadingCheckError(missing)), { reason: 'unavailable', refresh: false, code: 'PGRST202', details: null,
    message: 'Le contrôle du chargement n’est pas encore disponible sur le serveur. Prévenez la direction.' });
  assert.deepEqual(plain(api.loadingCheckError({ code: '40001', message: 'could not serialize access' })), { reason: 'conflict', refresh: true, code: '40001', details: null,
    message: 'Le chargement a changé sur un autre appareil. Actualisez-le puis recommencez.' });
  const unknown = api.loadingCheckError({ code: '23505', message: 'duplicate key value violates unique constraint' });
  assert.equal(unknown.reason, 'unknown');
  assert.equal(unknown.message, 'Le contrôle n’a pas pu être enregistré. Réessayez.');
  assert.equal(api.loadingCheckError(null).reason, 'network');
  // A HINT of another feature is not a loading-control sentence.
  assert.equal(api.loadingCheckError({ code: '22023', hint: 'invoices_frozen:payment', message: 'Paiement enregistré.' }).reason, 'unknown');
});

test('a scan sends the label read and returns the stored check', async () => {
  const { api: scan, calls } = service(() => ({ data: { status: 'recorded', checked: 1, expected: 2, check: CHECK }, error: null }));
  const result = await scan.recordLoadingCheck(ENVOI, COLIS, 1, 2, 'camera');
  assert.deepEqual(plain(calls), [{ name: 'record_loading_check', args: { p_envoi_id: ENVOI, p_colis_id: COLIS, p_parcel_index: 1, p_parcel_count: 2, p_method: 'camera' } }]);
  assert.deepEqual(plain(result), { status: 'recorded', checked: 1, expected: 2,
    check: { colisId: COLIS, parcelIndex: 1, parcelCount: 2, method: 'scan', checkedBy: 'staff-1', checkedByName: 'Marc Grondin', checkedAt: '2026-10-07T08:15:00+00:00' } });
});

test('a count, a clearing and the shared reading call their command', async () => {
  const answers = {
    record_loading_count: { status: 'already', checked: 2, expected: 2, added: 0 },
    clear_loading_checks: { status: 'cleared', cleared: 2, checked: 0, expected: 2 },
    get_loading_checks: [CHECK, { ...CHECK, parcel_index: 2, method: 'count', checked_by_name: 'Camille Hoarau' }],
  };
  const { api: control, calls } = service(name => ({ data: answers[name], error: null }));
  assert.deepEqual(plain(await control.recordLoadingCount(ENVOI, COLIS, 2)), { status: 'already', checked: 2, expected: 2, added: 0 });
  assert.deepEqual(plain(await control.clearLoadingChecks(ENVOI, COLIS)), { status: 'cleared', checked: 0, expected: 2, cleared: 2 });
  const rows = await control.fetchLoadingChecks(ENVOI);
  assert.deepEqual(plain(rows.map(row => [row.parcelIndex, row.method, row.checkedByName])), [[1, 'scan', 'Marc Grondin'], [2, 'count', 'Camille Hoarau']]);
  assert.deepEqual(plain(calls), [
    { name: 'record_loading_count', args: { p_envoi_id: ENVOI, p_colis_id: COLIS, p_counted: 2 } },
    { name: 'clear_loading_checks', args: { p_envoi_id: ENVOI, p_colis_id: COLIS } },
    { name: 'get_loading_checks', args: { p_envoi_id: ENVOI } },
  ]);
  const { api: empty } = service(() => ({ data: null, error: null }));
  assert.deepEqual(plain(await empty.fetchLoadingChecks(ENVOI)), []);
});

test('a refused command rejects with the explained error and keeps its cause', async () => {
  const refusal = { code: '22023', hint: 'loading_check:stale_label', message: 'Étiquette périmée : ce dossier compte maintenant 3 colis. Réimprimez ses étiquettes.', details: null };
  const { api: refused } = service(() => ({ data: null, error: refusal }));
  await assert.rejects(refused.recordLoadingCheck(ENVOI, COLIS, 1, 2, 'scan'), error => error.message === refusal.message && error.reason === 'stale_label' && error.refresh === true && error.cause === refusal);
  const { api: offline } = service(() => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }));
  await assert.rejects(offline.fetchLoadingChecks(ENVOI), error => error.reason === 'network' && /n’a pas pu être lu/.test(error.message));
  await assert.rejects(offline.clearLoadingChecks(ENVOI, COLIS), error => error.reason === 'network' && /effacement/.test(error.message));
  await assert.rejects(offline.recordLoadingCount(ENVOI, COLIS, 2), error => error.reason === 'network' && /jamais compté deux fois/.test(error.message));
});
