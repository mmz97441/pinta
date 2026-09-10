import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { calculateQuote } from '../src/expedile/domain/quote.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const bundled = await build({ entryPoints: [path.join(directory, '../src/expedile/lib/supabaseData.js')], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolated-supabase', setup(builder) {
  builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase', namespace: 'test' }));
  builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const supabase = globalThis.testSupabase;', loader: 'js' }));
} }] });
function service(database, failure = null) {
  const calls = [];
  const supabase = { from(table) {
    let mode = 'read'; let changes = {}; let filters = []; let limit = Infinity; let singleton = false;
    const query = {
      select() { return this; }, order() { return this; }, limit(value) { limit = value; return this; },
      eq(key, value) { filters.push((row) => row[key] === value); return this; }, gt(key, value) { filters.push((row) => row[key] > value); return this; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return this; },
      update(value) { changes = value; mode = 'update'; return this; }, insert(value) { changes = value; mode = 'insert'; return this; },
      maybeSingle() { singleton = true; return this; }, single() { singleton = true; return this; },
      then(resolve, reject) {
        calls.push({ table, mode, changes });
        if (failure) return Promise.resolve({ data: null, error: { message: failure } }).then(resolve, reject);
        const rows = (database[table] || []).filter((row) => filters.every((filter) => filter(row))).sort((left, right) => left.id.localeCompare(right.id)).slice(0, limit);
        const result = mode === 'update' ? rows.map((row) => ({ ...row, ...changes })) : rows;
        return Promise.resolve({ data: singleton ? result[0] || null : result, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const module = { exports: {} };
  vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, testSupabase: supabase, console, URL, setTimeout });
  return { api: module.exports, calls };
}

test('quote and invoice writes reject database failures without inventing persisted objects', async () => {
  const { api } = service({}, 'Network unavailable');
  await assert.rejects(api.updateColis('parcel', { finP: 5 }), { message: 'Network unavailable' });
  await assert.rejects(api.insertFacture('parcel', { vendeur: 'Amazon', montant: 100 }), { message: 'Network unavailable' });
});

test('a stale quote measure save is rejected; the returned row is canonical on success', async () => {
  const { api } = service({ colis: [{ id: 'parcel', updated_at: 'server-version', fin_p: 3 }] });
  await assert.rejects(api.updateColis('parcel', { finP: 5 }, 'old-version'), /collègue/);
  const saved = await api.updateColis('parcel', { finP: 5 }, 'server-version');
  assert.equal(saved.finP, 5); assert.equal(saved.updatedAt, 'server-version');
});

test('more than 1,000 dossiers and their actual mapped documents remain available to the quote calculation', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({ id: String(index).padStart(5, '0'), client_id: 'client', archive: false, statut: 'en_preparation', fin_l: 40, fin_w: 30, fin_h: 20, fin_p: 3, dim_l: 40, dim_w: 30, dim_h: 20, poids: 3 }));
  const { api, calls } = service({ colis: rows, factures: [{ id: 'invoice', colis_id: '01000', vendeur: 'Amazon', montant: 100, valide: true, fichier_url: '01000/facture.pdf' }], lignes: [{ id: 'line', colis_id: '01000', facture_id: 'invoice', description: 'Vêtement', qte: 2, prix_unitaire: 50, categorie_id: 'clothes' }], messages: [] });
  const loaded = await api.fetchColis();
  assert.equal(loaded.length, 1001); assert.equal(calls.filter((call) => call.table === 'colis').length, 3);
  const quote = calculateQuote({ colis: loaded.find((parcel) => parcel.id === '01000'), client: { type: 'particulier' }, destination: { code: '974', nom: 'La Réunion', tva: 8.5 }, tarif: { base: 10, parKg: 5 }, categories: [{ id: 'clothes', taux: { '974': { om: 10, omr: 2.5 } } }] });
  assert.equal(quote.ok, true); assert.equal(quote.amounts.total, 55.06); assert.equal(quote.snapshot.inputs.lines[0].factureId, 'invoice');
});

test('PDF reproduces the saved quote version when live customer, parcel, fees and totals have changed', async () => {
  const pdfBundle = await build({ entryPoints: [path.join(directory, '../src/expedile/utils/exportDevisPDF.js')], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'capture-pdf', setup(builder) {
    builder.onResolve({ filter: /^(jspdf|jspdf-autotable)$/ }, (args) => ({ path: args.path, namespace: 'test-pdf' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-pdf' }, (args) => ({ contents: args.path === 'jspdf' ? 'export default globalThis.MockPDF;' : 'export default (doc, options) => { globalThis.tables.push(options.body); doc.lastAutoTable = { finalY: 120 }; };', loader: 'js' }));
  } }] });
  const captured = { texts: [], tables: [], filename: '' };
  class MockPDF {
    setFontSize() {} setFont() {} setDrawColor() {} setLineWidth() {} line() {} setTextColor() {}
    text(value) { captured.texts.push(value); } save(filename) { captured.filename = filename; }
  }
  const module = { exports: {} };
  vm.runInNewContext(pdfBundle.outputFiles[0].text, { module, exports: module.exports, MockPDF, tables: captured.tables });
  const quote = calculateQuote({ colis: { ref: 'EXP-SAVED', finL: 40, finW: 30, finH: 20, finP: 3, factures: [{ id: 'invoice', montant: 100, valide: true, fichier: 'invoice.pdf' }], lignes: [{ desc: 'Article vérifié', qte: 1, prix: 100, cat: 'clothes' }] }, client: { type: 'particulier', nom: 'Nom au devis', email: 'old@example.test' }, destination: { code: '974', nom: 'La Réunion', tva: 8.5 }, tarif: { base: 10, parKg: 5 }, categories: [{ id: 'clothes', taux: { '974': { om: 10, omr: 2.5 } } }] });
  module.exports.exportDevisPDF({ ref: 'EXP-CHANGED', devisTotal: 999, fraisDivers: [{ libelle: 'Nouveau frais', montant: 999 }], devisSnapshot: { ...quote.snapshot, version: 2, createdAt: '2026-09-10T00:00:00Z' } }, { nom: 'Nouveau nom', type: 'pro' }, { nom: 'Nouvelle destination', tva: 99 });
  assert.ok(captured.texts.includes('TOTAL : 55.06 €'));
  assert.ok(captured.texts.includes('Nom au devis'));
  assert.ok(captured.texts.includes('Version : 2'));
  assert.ok(!captured.texts.includes('Nouveau nom'));
  assert.equal(captured.filename, 'devis-EXP-SAVED-v2.pdf');
  assert.ok(!JSON.stringify(captured.tables).includes('Nouveau frais'));
});
