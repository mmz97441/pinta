// Decision of the direction, 10 October 2026 (docs/facturation-conformite.md T16, D3, I7, I16): on every
// client-facing quote output, the amounts the engine computes as octroi de mer, OMR and « TVA » read as an
// estimate of the import taxes due at destination, paid on arrival and included in the price. This test
// FAILS as soon as one of these outputs writes « TVA ( » or a line labelled « Octroi de mer », « OM »,
// « OMR » or « TVA » as an amount of Expedîle's price: the quote PDF, the portal's quote, the quote
// messages (defaults in both renderers, fallback templates), the prospect estimate and the professional
// recap. The amounts themselves are unchanged (domain/quote.js, save_quote).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as XLSX from 'xlsx';
import { calculateQuote } from '../src/expedile/domain/quote.js';
import { estimateMessage, estimateMessageText } from '../src/expedile/domain/prospectEstimate.js';
import { buildProRecapWorkbook } from '../src/expedile/utils/exportRecapPro.js';
import { DESTINATIONS } from '../src/expedile/constants/index.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(directory, '..');
const require = createRequire(import.meta.url);

/** The lines of a client-facing text that present a tax as an amount of Expedîle's price ([] when none). */
export function taxesOfThePrice(text) {
  return String(text).split('\n').map(line => line.replace(/[\u00a0\u202f]/g, ' ').trim()).filter(Boolean).filter(line => {
    if (/TVA\s*\(/.test(line)) return true;
    const label = line.replace(/^[^\p{L}]+/u, '');
    return /^(?:Octroi de mer|OMR?|TVA|Taxes douanières)(?![\p{L}\d])/iu.test(label);
  });
}

test('the guard catches the wording used until 10 October 2026', () => {
  for (const former of ['Octroi de mer (OM)', 'Octroi de mer régional (OMR)', 'TVA (8,5 %)', 'TVA (taux historique non documenté)', '📊 TVA (8.5%) : 6.96 €', 'OM : 30.20 €', 'OMR : 15.40 €',
    'Octroi de mer : 16,90 €', 'TVA (8,5 %) : 5,96 €', '🏛️ Taxes douanières : *45.60 €*', '   _(Octroi de Mer + Octroi de Mer Régional, calculés sur la valeur de vos articles)_'])
    assert.deepEqual(taxesOfThePrice(`Transport : 36.25 €\n${former}\nTOTAL : 93.81 €`), [former.trim()], former);
  for (const current of ['Estimation des taxes à l’importation à La Réunion (payées à l’arrivée, comprises dans le prix) : 52.56 €', '• dont estimation octroi de mer de La Réunion : 30.20 €',
    'dont estimation TVA à l’importation de la Martinique', 'Taux retenus pour l’estimation de l’octroi de mer (OM) et de l’octroi de mer régional (OMR) à l’importation à La Réunion.', 'Optimisation de l’emballage'])
    assert.deepEqual(taxesOfThePrice(current), [], current);
});

// ── One particulier quote with the three taxes, and the same for a professional ──
const snapshot = ({ type = 'particulier', destination = { code: '974', nom: 'La Réunion', tva: 8.5 }, amounts = { transport: 36.25, om: 30.2, omr: 15.4, tva: 6.96, total: 93.81 }, mode = 'payplug' } = {}) => ({
  schemaVersion: 1, currency: 'EUR', mode: 'final', version: 3, createdAt: '2026-10-10T09:00:00Z',
  inputs: { reference: 'EXP-TAX-001', description: 'Casque et chargeurs', client: { type, nom: 'Payet Flavie', email: 'flavie@example.test' }, destination, paymentTerms: { mode },
    finalBox: { dimL: 40, dimW: 30, dimH: 20, poids: 3 }, finalPackages: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3 }], originalBoxes: [], trackings: ['TRACK-1'],
    lines: [{ description: 'Casque audio', quantity: 1, unitPrice: 120, rates: { om: 10, omr: 2.5 }, customDuty: { code: '85183000', label: 'Casques d’écoute', rates: { om: 10, omr: 2.5 }, baseRates: { om: 10, omr: 2.5 }, source: { label: 'Référentiel (essai)', page: 12 } } }],
    fees: [{ libelle: 'Emballage renforcé', montant: 5 }] },
  amounts: { ...amounts, billableWeight: 4.8 }, before: null, savings: 0,
});
const dossier = quote => ({ id: 'parcel', ref: 'EXP-TAX-001', statut: 'attente_paiement', devisBrouillon: false, quoteVersion: quote.version, devisTotal: quote.amounts.total, devisTransport: quote.amounts.transport,
  devisOM: quote.amounts.om, devisOMR: quote.amounts.omr, devisTVA: quote.amounts.tva, devisSnapshot: quote, payplugPaymentUrl: 'https://secure.payplug.com/test', factures: [], lignes: [], trackings: ['TRACK-1'] });

test('the quote PDF: an estimate of the destination’s import taxes, never a tax line of the price', async () => {
  const bundle = await build({ entryPoints: [path.join(root, 'src/expedile/utils/exportDevisPDF.js')], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'node-pdf-builds', setup(builder) {
    builder.onResolve({ filter: /^jspdf(-autotable)?$/ }, (args) => args.namespace === 'node-pdf' ? { path: args.path, external: true } : { path: args.path, namespace: 'node-pdf' });
    builder.onLoad({ filter: /.*/, namespace: 'node-pdf' }, (args) => ({ contents: args.path === 'jspdf' ? "import * as pdf from 'jspdf'; export default pdf.jsPDF;" : "import * as table from 'jspdf-autotable'; export default table.autoTable || table.default;", loader: 'js' }));
  } }] });
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fonts = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
  const pages = async doc => {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: fonts }).promise;
    const result = [];
    for (let number = 1; number <= pdf.numPages; number++) result.push((await (await pdf.getPage(number)).getTextContent()).items.map(item => item.str.replace(/\u00a0/g, ' ')).filter(text => text.trim()));
    return result;
  };
  for (const [destination, at] of [[DESTINATIONS['974'], 'à La Réunion'], [DESTINATIONS['972'], 'en Martinique']]) {
    const quote = snapshot({ destination: { code: destination.code, nom: destination.nom, tva: destination.tva } });
    const [first, second] = await pages(loaded.exports.buildDevisPDF(dossier(quote), { type: 'particulier' }, destination).doc);
    assert.deepEqual(taxesOfThePrice(first.join('\n')), [], `page 1 (${destination.nom})`);
    assert.ok(first.includes(`Estimation des taxes à l’importation ${at}`) && first.includes('(payées à l’arrivée, comprises dans le prix)'), first.join(' | '));
    assert.equal(first.filter(text => text.startsWith('dont estimation ')).length, 3);
    // The customs classification page names the rates of the estimate; its OM / OMR column headers are rates, not amounts.
    assert.ok(second.includes(`Taux retenus pour l’estimation de l’octroi de mer (OM) et de l’octroi de mer régional (OMR) à l’importation ${at}.`), second.join(' | '));
    assert.ok(!second.some(text => /TVA\s*\(/.test(text)));
  }
  const pro = await pages(loaded.exports.buildDevisPDF(dossier(snapshot({ type: 'pro', mode: 'virement', amounts: { transport: 60, om: 0, omr: 0, tva: 0, total: 65 } })), { type: 'pro' }, DESTINATIONS['974']).doc);
  assert.ok(!pro[0].some(text => /TVA|[Oo]ctroi|Estimation des taxes/.test(text)), 'The professional quote is unchanged: no taxes.');
});

test('the portal’s quote: the estimate block and its detail, never « TVA ( » nor an « Octroi de mer » line', async () => {
  const bundle = await build({
    stdin: { contents: "import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Detail from '../src/expedile/components/client/ClientDetailView.jsx'; export const render = () => renderToStaticMarkup(React.createElement(Detail));", resolveDir: directory, loader: 'jsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['react', 'react-dom/server'],
    plugins: [{ name: 'isolated-client-detail', setup(builder) {
      builder.onResolve({ filter: /\/context\/AppContext$/ }, () => ({ path: 'context', namespace: 'test' }));
      builder.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: 'router', namespace: 'test' }));
      builder.onResolve({ filter: /\/ui\/SecureFile$/ }, () => ({ path: 'files', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: name }) => ({ contents: name === 'context' ? 'export const useApp=()=>globalThis.testApp;' : name === 'router' ? 'export const useNavigate=()=>()=>{}; export const useSearchParams=()=>[null,()=>{}];' : 'export const SecureImage=()=>null;', loader: 'js' }));
    } }],
  });
  const module = { exports: {} };
  const app = { authCl: { type: 'particulier', cp: '97400' }, selDest: DESTINATIONS['974'], isStaff: false, settings: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, testApp: app, console, URL, setTimeout, clearTimeout, TextEncoder });
  // The static markup as lines of text: each element its own line.
  const lines = html => html.replace(/<[^>]+>/g, '\n').replace(/&#x27;|&#39;/g, '’').replace(/&amp;/g, '&');
  app.sel = dossier(snapshot());
  const text = lines(module.exports.render());
  assert.deepEqual(taxesOfThePrice(text), []);
  assert.match(text, /Estimation des taxes à l’importation à La Réunion\n\(payées à l’arrivée, comprises dans le prix\)/);
  for (const line of ['dont estimation octroi de mer de La Réunion', 'dont estimation octroi de mer régional de La Réunion', 'dont estimation TVA à l’importation de La Réunion']) assert.match(text, new RegExp(`\\n${line}\\n`));
  // A former quote without snapshot (no rate saved) reads the same way, from its saved amounts.
  app.sel = { ...dossier(snapshot()), devisSnapshot: null, quoteVersion: 1 };
  const legacy = lines(module.exports.render());
  assert.deepEqual(taxesOfThePrice(legacy), []);
  assert.match(legacy, /dont estimation TVA à l’importation de La Réunion/);
  app.authCl = { type: 'pro', cp: '97400' };
  app.sel = dossier(snapshot({ type: 'pro', mode: 'virement', amounts: { transport: 60, om: 0, omr: 0, tva: 0, total: 65 } }));
  assert.doesNotMatch(lines(module.exports.render()), /TVA|[Oo]ctroi de mer|Estimation des taxes/);
});

test('the quote messages (defaults in both renderers, fallback templates) and the prospect estimate', async () => {
  const bundle = await build({
    stdin: { contents: [
      "export { renderTemplate } from './src/expedile/services/messageTemplates.js';",
      "export { renderMessage } from './supabase/functions/_shared/messageTemplate.ts';",
      "export { DEFAULT_BODIES } from './src/expedile/services/messageDefaults.js';",
      "export { DEFAULT_BODIES as SERVER_DEFAULTS } from './supabase/functions/_shared/messageDefaults.ts';",
      "export { MSG_TEMPLATES } from './src/expedile/constants/templates.js';",
    ].join('\n'), resolveDir: root },
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'isolated-http', setup(builder) {
      builder.onResolve({ filter: /^\.\/http\.ts$/ }, () => ({ path: 'http', namespace: 'message-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'message-test' }, () => ({ contents: 'export class HttpError extends Error { constructor(status,message) { super(message);this.status=status; } }', loader: 'js' }));
    } }],
  });
  const loaded = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: loaded, exports: loaded.exports, require, Deno: { env: { get: () => 'https://example.test' } } });
  const { renderTemplate, renderMessage, DEFAULT_BODIES, SERVER_DEFAULTS, MSG_TEMPLATES } = loaded.exports;
  const client = { prenom: 'Flavie', nom: 'Payet', type: 'particulier', cp: '97400' };
  const colis = dossier(snapshot());
  const row = { ref: colis.ref, devis_transport: colis.devisTransport, devis_om: colis.devisOM, devis_omr: colis.devisOMR, devis_tva: colis.devisTVA, devis_total: colis.devisTotal };
  for (const key of ['devis_final_telegram', 'devis_final_email']) {
    for (const [name, text] of [['preview', renderTemplate(DEFAULT_BODIES[key], { client, colis, destination: DESTINATIONS['974'] })], ['delivery', renderMessage(SERVER_DEFAULTS[key], client, row, { code: '974', nom: 'La Réunion', flag: '🇷🇪', tva: 8.5 }, {})]]) {
      assert.deepEqual(taxesOfThePrice(text), [], `${key} (${name})`);
      assert.match(text, /Estimation des taxes à l’importation à La Réunion \(payées à l’arrivée, comprises dans le prix\) : 52\.56 €/, `${key} (${name})`);
    }
  }
  // The former hard-coded templates, used only when no default exists: the same wording.
  for (const canal of ['telegram', 'email']) {
    const text = MSG_TEMPLATES.devis_final[canal](client, colis);
    assert.deepEqual(taxesOfThePrice(text), [], `fallback ${canal}`);
    assert.match(text, /Estimation des taxes à l’importation à La Réunion/);
  }
  // « Estimation rapide » for a prospect: 40 × 30 × 20 cm, 3 kg, 120 € of « Divers » (OM 10 %, OMR 2,5 %) to La Réunion.
  const quote = calculateQuote({ colis: { ref: 'ESTIMATION', finL: 40, finW: 30, finH: 20, finP: 3, lignes: [{ desc: 'Marchandise déclarée', qte: 1, prix: 120, cat: 'cat' }] }, client: { type: 'particulier' }, destination: DESTINATIONS['974'], tarif: { base: 25, parKg: 5 }, categories: [{ id: 'cat', label: 'Divers', taux: { 974: { om: 10, omr: 2.5 } } }], mode: 'estimate' });
  assert.equal(quote.ok, true);
  const form = { prenom: 'Marie', nom: 'Martin', dimL: '40', dimW: '30', dimH: '20', poids: '3' };
  const shared = estimateMessageText(estimateMessage({ form, quote, destination: DESTINATIONS['974'], isPro: false })).replace(/[\u00a0\u202f]/g, ' ');
  assert.deepEqual(taxesOfThePrice(shared), []);
  assert.match(shared, /Transport : 49,00 €\nEstimation des taxes à l’importation à La Réunion \(payées à l’arrivée, comprises dans le prix\) : 27,08 €\n• dont estimation octroi de mer de La Réunion : 16,90 €\n• dont estimation octroi de mer régional de La Réunion : 4,22 €\n• dont estimation TVA à l’importation de La Réunion : 5,96 €\nTotal estimatif : 76,08 €/);
  const pro = estimateMessageText(estimateMessage({ form, quote: calculateQuote({ colis: { ref: 'ESTIMATION', finL: 40, finW: 30, finH: 20, finP: 3 }, client: { type: 'pro' }, destination: DESTINATIONS['974'], tarif: { base: 25, parKg: 5 }, mode: 'estimate' }), destination: DESTINATIONS['974'], isPro: true }));
  assert.doesNotMatch(pro, /TVA|[Oo]ctroi|Estimation des taxes/);
});

test('the professional recap handed to the client: no tax column of the price', () => {
  const client = { id: 'c', nom: 'Hoarau', prenom: 'Marc', cp: '97400', modePaiement: '30j' };
  const former = { id: 'p', ref: 'EXP-PRO', clientId: 'c', statut: 'paye', paiementDate: '2026-09-17T12:00:00Z', dateReception: '2026-09-15', finP: 3, devisTotal: 17.77, devisTransport: 10.01, devisOM: 5.01, devisOMR: 0, devisTVA: 2.75, lignes: [{ desc: 'Article', qte: 1, prix: 10 }], factures: [] };
  const workbook = buildProRecapWorkbook(client, [former], 8, 2026).workbook;
  const labels = Object.values(workbook.Sheets).flatMap(sheet => XLSX.utils.sheet_to_json(sheet, { header: 1 }).flatMap(row => row.filter(cell => typeof cell === 'string')));
  assert.deepEqual(taxesOfThePrice(labels.join('\n')), []);
  assert.ok(!labels.some(label => /TTC|TVA/.test(label)), labels.join(' | '));
});
