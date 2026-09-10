import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { receptionCartons, receptionMeasurements, mergeReceptionCartons, hasCompleteReceptionMeasurements } from '../src/expedile/domain/reception.js';
import { calculateQuote, measureShipment } from '../src/expedile/domain/quote.js';

const entry = new URL('../src/expedile/lib/supabaseData.js', import.meta.url).pathname;
const bundle = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolated-storage', setup(builder) {
  builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase', namespace: 'test' }));
  builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const supabase = globalThis.testSupabase;', loader: 'js' }));
} }] });

function persistence(initial = []) {
  const rows = structuredClone(initial), calls = [];
  let version = 0;
  const testSupabase = { from(table) {
    assert.equal(table, 'colis');
    let operation, values, conditions = [];
    const query = {
      insert(value) { operation = 'insert'; values = value; return this; },
      update(value) { operation = 'update'; values = value; return this; },
      select() { return this; }, single() { return this; }, maybeSingle() { return this; },
      eq(key, value) { conditions.push([key, value]); return this; },
      then(resolve, reject) {
        calls.push({ operation, values: structuredClone(values), conditions });
        let row;
        if (operation === 'insert') {
          row = { ...structuredClone(values), id: `parcel-${rows.length + 1}`, updated_at: `version-${++version}` };
          rows.push(row);
        } else {
          row = rows.find(candidate => conditions.every(([key, value]) => candidate[key] === value));
          if (row) Object.assign(row, structuredClone(values), { updated_at: `version-${++version}` });
        }
        return Promise.resolve({ data: row ? structuredClone(row) : null, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, testSupabase, console, URL });
  return { api: module.exports, rows, calls };
}

const first = { dimL: 80, dimW: 10, dimH: 10, poids: 1 };
const second = { dimL: 10, dimW: 80, dimH: 10, poids: 1 };
const lines = [{ fournisseur: 'Boutique A', tracking: 'TRACK-A' }, { fournisseur: '', tracking: '' }];
const input = (colis, settings = {}) => ({ colis, settings, client: { type: 'pro', cp: '97400' }, destination: { code: '974', nom: 'La Réunion', tva: 8.5 }, tarif: { base: 10, parKg: 5 } });
const final = { finL: 40, finW: 20, finH: 10, finP: 2 };
const plain = value => JSON.parse(JSON.stringify(value));

test('single reception survives insert/map with individual measurements and never pre-fills optimised measurements', async () => {
  const { api, rows } = persistence();
  const measured = receptionMeasurements([lines[0]], { 0: first });
  const saved = await api.insertColis({ clientId: 'client', statut: 'mesure', trackings: ['TRACK-A'], trackingsDetail: [{ number: 'TRACK-A', fournisseur: 'Boutique A' }], nbColis: 1, ...measured });
  assert.deepEqual(plain(rows[0].dims_par_colis), [first]);
  assert.deepEqual(plain(saved.dimsParColis), [first]);
  for (const key of ['fin_l', 'fin_w', 'fin_h', 'fin_p']) assert.equal(rows[0][key], undefined);
  const quote = calculateQuote(input(saved));
  assert.equal(quote.ok, false);
  assert.equal(quote.errors.filter(error => error.field.startsWith('dimensions.')).length, 4);
});

test('two physical cartons including one without tracking retain order and use the sum of volumes, not the product of maximum dimensions', async () => {
  const { api, rows } = persistence();
  const dimensions = { 0: first, 1: second };
  const cartons = receptionCartons(lines, dimensions);
  assert.equal(cartons.length, 2);
  const measured = receptionMeasurements(lines, dimensions);
  const saved = await api.insertColis({ clientId: 'client', statut: 'mesure', nbColis: 2, trackings: ['TRACK-A'], trackingsDetail: cartons.map(carton => ({ number: carton.tracking, fournisseur: carton.fournisseur })), ...measured });
  assert.deepEqual(plain(rows[0].dims_par_colis), [first, second]);
  assert.equal(saved.trackings.length, 1);
  assert.equal(saved.trackingsDetail.length, 2);
  const quote = calculateQuote(input({ ...saved, ...final }));
  assert.equal(quote.ok, true);
  assert.equal(quote.before.volumetricWeight, 3.2);
  assert.equal(quote.before.transport, 26);
  assert.equal(quote.amounts.transport, 20);
  assert.equal(quote.patch.economie, 6);
  assert.equal(saved.dimL * saved.dimW * saved.dimH / 5000, 12.8, 'scalar summary would overstate the real volume fourfold');
  assert.deepEqual(plain(quote.snapshot.inputs.originalBoxes), [first, second]);
});

test('configured divisor applies to both original cartons and independently measured final package', () => {
  const measured = receptionMeasurements(lines, { 0: first, 1: second });
  const quote = calculateQuote(input({ ...measured, ...final, nbColis: 2 }, { diviseurVolumetrique: '6000' }));
  assert.equal(quote.ok, true);
  assert.equal(quote.before.transport, 23.33);
  assert.equal(quote.amounts.transport, 20);
  assert.equal(quote.before.volumetricWeight, 16000 / 6000);
  assert.equal(quote.amounts.volumetricWeight, 8000 / 6000);
});

test('reception and final measurements affect distinct sides of the comparison', () => {
  const parcel = { ...receptionMeasurements([lines[0]], { 0: first }), ...final };
  const baseline = calculateQuote(input(parcel));
  const changedReception = calculateQuote(input({ ...parcel, dimsParColis: [{ ...first, poids: 20 }] }));
  assert.deepEqual(changedReception.amounts, baseline.amounts);
  assert.notEqual(changedReception.before.transport, baseline.before.transport);
  const changedFinal = calculateQuote(input({ ...parcel, finP: 30 }));
  assert.deepEqual(changedFinal.before, baseline.before);
  assert.notEqual(changedFinal.amounts.transport, baseline.amounts.transport);
  for (const key of Object.keys(final)) {
    const missing = calculateQuote(input({ ...parcel, [key]: null }));
    assert.equal(missing.ok, false, `${key} must never fall back to reception`);
  }
});

test('append to a measured legacy singleton preserves its original carton and only adds measured new cartons', async () => {
  const legacy = { id: 'legacy', client_id: 'client', updated_at: 'loaded-version', statut: 'mesure', nb_colis: 1, trackings: ['OLD'], trackings_detail: [], dims_par_colis: [], dim_l: first.dimL, dim_w: first.dimW, dim_h: first.dimH, poids: first.poids };
  const { api, rows } = persistence([legacy]);
  const current = api.mapColis(legacy);
  const changes = mergeReceptionCartons(current, [{ fournisseur: 'Nouvelle boutique', tracking: 'NEW' }], { 0: second });
  const saved = await api.updateColis(current.id, changes, current.updatedAt);
  assert.deepEqual(plain(saved.dimsParColis), [first, second]);
  assert.deepEqual(plain(saved.trackingsDetail), [{ number: 'OLD', fournisseur: '' }, { number: 'NEW', fournisseur: 'Nouvelle boutique' }]);
  assert.equal(saved.nbColis, 2);
  assert.equal(hasCompleteReceptionMeasurements(saved), true);
  assert.equal(rows[0].fin_p, undefined);
  assert.equal(calculateQuote(input(saved)).ok, false);
  await assert.rejects(api.updateColis(current.id, changes, current.updatedAt), /collègue/);
  assert.equal(rows[0].dims_par_colis.length, 2, 'stale append cannot duplicate cartons or erase measurements');
});

test('append to incomplete historical multi-carton data preserves explicit gaps and cannot invent an optimisation saving', () => {
  const existing = { nbColis: 3, trackings: ['OLD'], trackingsDetail: [{ number: 'OLD' }, {}, {}], dimsParColis: [first], dimL: 80, dimW: 80, dimH: 10, poids: 10 };
  const changes = mergeReceptionCartons(existing, [{ fournisseur: 'New', tracking: '' }], { 0: second });
  assert.equal(changes.nbColis, 4);
  assert.deepEqual(changes.dimsParColis[0], first);
  assert.deepEqual(changes.dimsParColis[3], second);
  assert.equal(changes.dimsParColis[1].poids, null);
  assert.equal(changes.poids, null);
  assert.equal(hasCompleteReceptionMeasurements(changes), false);
  const quote = calculateQuote(input({ ...changes, ...final }));
  assert.equal(quote.ok, true, 'historical missing reception does not replace independently measured final data');
  assert.equal(quote.before, null);
  assert.equal(quote.patch.economie, 0);
  assert.deepEqual(quote.snapshot.inputs.originalBoxes, []);
});

test('no known measure is erased when appending a carton without a tracking number', () => {
  const existing = { nbColis: 2, trackings: ['OLD'], trackingsDetail: [{ number: 'OLD' }, {}], dimsParColis: [first, second], ...final };
  const frozen = structuredClone(existing);
  const changes = mergeReceptionCartons(existing, [{ fournisseur: '', tracking: '' }], { 0: { dimL: 10, dimW: 10, dimH: 10, poids: 3 } });
  assert.deepEqual(existing, frozen);
  assert.deepEqual(changes.dimsParColis.slice(0, 2), [first, second]);
  assert.equal(changes.nbColis, 3);
  assert.equal(changes.trackings.length, 1);
  assert.equal(changes.poids, 5);
  for (const key of Object.keys(final)) assert.equal(changes[key], undefined);
});

test('an explicit missing singleton measurement and incomplete multi arrays never use stale scalar dimensions', () => {
  for (const parcel of [{ ...first, dimsParColis: [null] }, { ...first, nbColis: 2, dimsParColis: [] }, { ...first, nbColis: 2, dimsParColis: [first] }]) {
    assert.equal(hasCompleteReceptionMeasurements(parcel), false);
    const quote = calculateQuote(input({ ...parcel, ...final }));
    assert.equal(quote.before, null);
    assert.equal(quote.patch.economie, 0);
  }
  assert.equal(measureShipment([null]), null);
});

test('new incomplete cartons cannot be merged even when every old carton was measured', () => {
  for (const invalid of [undefined, '', null, 0, -1, Infinity, '12foo']) {
    const changed = mergeReceptionCartons({ ...first }, [lines[0]], { 0: { ...second, poids: invalid } });
    assert.equal(changed, null);
  }
});

test('browser preview and server delivery show identical real carton totals and configured volumetric weights', async () => {
  const messages = await build({ stdin: { contents: "export {renderTemplate} from './src/expedile/services/messageTemplates.js'; export {renderMessage} from './supabase/functions/_shared/messageTemplate.ts';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolated-http', setup(builder) {
    builder.onResolve({ filter: /^\.\/http\.ts$/ }, () => ({ path: 'http', namespace: 'message-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'message-test' }, () => ({ contents: 'export class HttpError extends Error { constructor(status,message) { super(message);this.status=status; } }', loader: 'js' }));
  } }] });
  const module = { exports: {} };
  vm.runInNewContext(messages.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), Deno: { env: { get: () => 'https://example.test' } } });
  const body = '{{nb_cartons}}\n{{liste_cartons}}\n{{dims_brutes}}\n{{poids_brut}}\n{{poids_vol_avant}}\n{{dims_finales}}\n{{poids_vol_apres}}';
  const parcel = { ...receptionMeasurements(lines, { 0: first, 1: second }), ...final, nbColis: 2, trackings: ['TRACK-A'], trackingsDetail: [{ number: 'TRACK-A', fournisseur: 'Boutique A' }, {}] };
  for (const current of [parcel, { ...parcel, nbColis: 3 }, { ...parcel, dimsParColis: [null, second] }]) {
    const args = { client: { nom: 'Test', type: 'pro' }, colis: current, settings: { diviseurVolumetrique: 6000 } };
    const row = { nb_colis: current.nbColis, trackings: current.trackings, trackings_detail: current.trackingsDetail, dims_par_colis: current.dimsParColis, dim_l: current.dimL, dim_w: current.dimW, dim_h: current.dimH, poids: current.poids, fin_l: current.finL, fin_w: current.finW, fin_h: current.finH, fin_p: current.finP };
    const preview = module.exports.renderTemplate(body, args);
    const server = module.exports.renderMessage(body, args.client, row, {}, args.settings);
    assert.equal(preview, server);
    if (current === parcel) { assert.match(preview, /2\.67 kg/); assert.match(preview, /2\. Sans numéro de suivi/); }
    else assert.match(preview, /À mesurer/);
  }
});
