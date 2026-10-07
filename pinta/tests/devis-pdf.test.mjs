// The client quote PDF, built with the real jsPDF and read back with pdf.js: French amounts, no zero rows for a
// particulier, a readable footer (the standard font cannot draw « → »), and client text that cannot corrupt a line.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The application imports the ES builds; Node loads the CommonJS ones, whose default export is mapped here.
const bundle = await build({ entryPoints: [path.join(directory, '../src/expedile/utils/exportDevisPDF.js')], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'node-pdf-builds', setup(builder) {
  builder.onResolve({ filter: /^jspdf(-autotable)?$/ }, (args) => args.namespace === 'node-pdf' ? { path: args.path, external: true } : { path: args.path, namespace: 'node-pdf' });
  builder.onLoad({ filter: /.*/, namespace: 'node-pdf' }, (args) => ({ contents: args.path === 'jspdf' ? "import * as pdf from 'jspdf'; export default pdf.jsPDF;" : "import * as table from 'jspdf-autotable'; export default table.autoTable || table.default;", loader: 'js' }));
} }] });
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const { buildDevisPDF, pdfText } = loaded.exports;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const STANDARD_FONTS = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;

/** Every text item of every page, no-break spaces read as spaces. */
async function pdfTextItems(doc) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const items = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const content = await (await pdf.getPage(number)).getTextContent();
    items.push(...content.items.map(item => item.str.replace(/\u00a0/g, ' ')).filter(text => text.trim()));
  }
  return items;
}

function snapshot({ type = 'particulier', mode = 'payplug', amounts = {}, savings = 41.9, description = 'Deux achats à regrouper', fees = [] } = {}) {
  return {
    schemaVersion: 2, currency: 'EUR', mode: 'final', version: 2, createdAt: '2026-10-02T09:30:00Z',
    inputs: {
      reference: 'EXP-TEST-001', description, client: { type, nom: 'Exemple Camille', email: 'camille@example.test' },
      destination: { code: '974', nom: 'La Réunion', tva: 0 }, paymentTerms: { mode },
      finalBox: { dimL: 40, dimW: 30, dimH: 25, poids: 6.2 }, finalPackages: [{ dimL: 40, dimW: 30, dimH: 25, poids: 6.2 }],
      originalBoxes: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3.4 }, { dimL: 35, dimW: 25, dimH: 25, poids: 2.8 }],
      trackings: ['1Z999AA10123456784', 'TEMU-55120983'], lines: [], fees,
    },
    amounts: { transport: 60, om: 8.2, omr: 0, tva: 0, total: 87.5, billableWeight: 7, ...amounts },
    before: { transport: 96, total: 129.4 }, savings,
  };
}
const dossier = (quote) => ({ id: 'p', ref: 'EXP-TEST-001', statut: 'attente_paiement', devisTotal: quote.amounts.total, devisSnapshot: quote });

test('a particulier quote reads in French, without zero rows, with a readable footer', async () => {
  const { doc, filename } = buildDevisPDF(dossier(snapshot()), { type: 'particulier' }, { nom: 'La Réunion', tva: 0 });
  assert.equal(filename, 'devis-EXP-TEST-001-v2.pdf');
  const items = await pdfTextItems(doc);
  const all = items.join('\n');
  assert.ok(items.includes('Expedîle — Service de réexpédition Paris – DOM-TOM'), 'the footer is drawn as text, not as spaced glyphs');
  assert.ok(items.includes('Transport') && items.includes('60,00 €'));
  assert.ok(items.includes('Octroi de mer (OM)') && items.includes('8,20 €'));
  assert.ok(items.includes('TOTAL : 87,50 €'));
  assert.ok(items.includes('Économie réalisée grâce à l’optimisation : 41,90 €'));
  assert.ok(items.includes('40 × 30 × 25 cm · 6,2 kg'), 'French decimals in measures');
  assert.ok(items.includes('Référence : EXP-TEST-001') && items.includes('Version : 2'));
  for (const absent of ['TVA', 'Octroi de mer régional', '→', '\u0000', 'undefined', 'NaN']) assert.ok(!all.includes(absent), `no « ${absent} »`);
  assert.ok(!items.some(text => /(^|\s)0[,.]00 €/.test(text)), 'no « 0,00 € » amount');
  assert.ok(!items.some(text => /\d\.\d/.test(text) && !/^Généré le/.test(text)), 'no decimal point');
});

test('real taxes, fees and large amounts keep their French format; a missing saving is never invented', async () => {
  const quote = snapshot({ amounts: { transport: 1200, om: 20.5, omr: 5.25, tva: 8.75, total: 1234.5 }, savings: 0, fees: [{ libelle: 'Emballage renforcé', montant: 4 }, { libelle: 'Frais offert', montant: 0 }] });
  const { doc } = buildDevisPDF(dossier(quote), { type: 'particulier' }, { nom: 'La Réunion' });
  const items = await pdfTextItems(doc);
  const all = items.join('\n');
  assert.ok(items.includes('1 200,00 €') && items.includes('TOTAL : 1 234,50 €'), 'thousands separated by a drawable space');
  assert.ok(items.includes('Octroi de mer régional (OMR)') && items.includes('5,25 €'));
  assert.ok(items.includes('TVA (taux historique non documenté)') || items.some(text => /^TVA \(\d/.test(text)), 'a positive VAT is listed');
  assert.ok(items.includes('Emballage renforcé') && items.includes('4,00 €'));
  assert.ok(!all.includes('Frais offert'), 'a zero fee is not listed');
  assert.ok(!all.includes('Économie réalisée'), 'no saving line without a saved saving');
});

test('a professional quote lists transport and explicit fees only, with its payment terms', async () => {
  const quote = snapshot({ type: 'pro', mode: 'virement', amounts: { transport: 60, om: 8.2, omr: 2.05, tva: 3, total: 64 }, savings: 0, fees: [{ libelle: 'Préparation', montant: 4 }] });
  const { doc } = buildDevisPDF(dossier(quote), { type: 'pro' }, { nom: 'La Réunion', tva: 8.5 });
  const items = await pdfTextItems(doc);
  const all = items.join('\n');
  assert.ok(items.includes('Virement bancaire') && items.includes('Préparation') && items.includes('TOTAL : 64,00 €'));
  for (const absent of ['Octroi de mer', 'TVA']) assert.ok(!all.includes(absent), `no « ${absent} » for a professional`);
});

test('client text outside the font never corrupts its line', async () => {
  const quote = snapshot({ description: 'Chaussures 👟 → Saint\u2011Denis, \u0151\u202f2 paires' });
  const { doc } = buildDevisPDF(dossier(quote), { type: 'particulier' }, { nom: 'La Réunion' });
  const items = await pdfTextItems(doc);
  // The pictograph is dropped and the line stays whole (pdf.js reads the doubled space as one).
  assert.ok(items.some(text => text.replace(/\s+/g, ' ') === 'Chaussures – Saint-Denis, o 2 paires'), items.find(text => text.startsWith('Chaussures')));
  assert.ok(items.includes('Expedîle — Service de réexpédition Paris – DOM-TOM'));
  assert.equal(pdfText('Paris → DOM-TOM'), 'Paris – DOM-TOM');
  assert.equal(pdfText('1\u202f234,50\u00a0€'), '1\u00a0234,50\u00a0€');
  assert.equal(pdfText('Œuvre « été » ’ … €'), 'Œuvre « été » ’ … €', 'WinAnsi characters are kept');
  assert.equal(pdfText('Ligne 1\r\nLigne 2'), 'Ligne 1\nLigne 2');
});

test('no quote, no document', () => {
  assert.throws(() => buildDevisPDF({ ref: 'EXP-X', devisTotal: 0 }, {}, {}), /Aucun devis valide/);
});
