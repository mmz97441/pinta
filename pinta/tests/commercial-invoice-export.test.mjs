// The commercial invoice of a departure, built with the real jsPDF and SheetJS and read back: the PDF with pdf.js
// (A4 landscape, French amounts, every column, the transport of each article, the allocation rule and the
// customs footer), the Excel sheet with SheetJS (numbers in euros, HS codes as text, totals as sums). Its two
// editions (before the departure, from the manifest) say under their header what they were established from
// and when, and never share a file name.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as XLSX from 'xlsx';
import { calculateQuote } from '../src/expedile/domain/quote.js';
import { buildCommercialInvoice, COMMERCIAL_INVOICE_COLUMNS } from '../src/expedile/domain/commercialInvoice.js';
import { buildCommercialInvoiceWorkbook, COMMERCIAL_INVOICE_SHEET } from '../src/expedile/utils/exportFactureCommerciale.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The application imports the ES builds; Node loads the CommonJS ones, whose default export is mapped here.
const bundle = await build({ entryPoints: [path.join(directory, '../src/expedile/utils/exportFactureCommerciPDF.js')], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'node-pdf-builds', setup(builder) {
  builder.onResolve({ filter: /^jspdf(-autotable)?$/ }, (args) => args.namespace === 'node-pdf' ? { path: args.path, external: true } : { path: args.path, namespace: 'node-pdf' });
  builder.onLoad({ filter: /.*/, namespace: 'node-pdf' }, (args) => ({ contents: args.path === 'jspdf' ? "import * as pdf from 'jspdf'; export default pdf.jsPDF;" : "import * as table from 'jspdf-autotable'; export default table.autoTable || table.default;", loader: 'js' }));
} }] });
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const { buildCommercialInvoicePDF } = loaded.exports;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const STANDARD_FONTS = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;

/** The pages of the PDF: their size and every text item, no-break spaces read as spaces. */
async function readPdf(doc) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    pages.push({ view: page.view, items: content.items.map(item => item.str.replace(/\u00a0/g, ' ')).filter(text => text.trim()) });
  }
  return pages;
}

const categories = [
  { id: 'cat-cuir', label: 'Cuir', codeHs: '4205', taux: { 974: { om: 5, omr: 2.5 } } },
  { id: 'cat-plastique', label: 'Vaisselle plastique', codeHs: '39241000', taux: { 974: { om: 5, omr: 2.5 } } },
  { id: 'cat-cafe', label: 'Café', codeHs: '0901210000', taux: { 974: { om: 0, omr: 0 } } },
  { id: 'cat-machine', label: 'Électroménager', codeHs: '8516710000', taux: { 974: { om: 10, omr: 2.5 } } },
];
const flavie = { id: 'c-flavie', type: 'particulier', nom: 'Hoarau Flavie', nomFamille: 'Hoarau', prenom: 'Flavie', cp: '97400' };
const lagon = { id: 'c-lagon', type: 'pro', nom: 'Payet Jean', nomFamille: 'Payet', prenom: 'Jean', raisonSociale: 'Lagon Services SARL', cp: '97410', methodePaiement: 'virement' };
const line = (id, desc, qte, prix, cat) => ({ id, factureId: 'f1', desc, qte, prix, cat });
function paid(fields, client, tarif) {
  const colis = { statut: 'en_preparation', fraisDivers: [], preparationCompositionVersion: 1, finalMeasurementsVersion: 1, factures: [{ id: 'f1', montant: 1, valide: true, fichierUrl: 'f1.pdf' }], ...fields };
  colis.outgoingParcelCount = colis.finalPackages.length;
  const quote = calculateQuote({ colis, client, destination: { code: '974', nom: 'La Réunion', tva: 8.5 }, tarif, categories, settings: { diviseurVolumetrique: 5000 }, mode: 'final' });
  assert.equal(quote.ok, true, JSON.stringify(quote.errors));
  return { ...colis, statut: 'paye', devisTotal: quote.amounts.total, devisSnapshot: quote.snapshot };
}
// Before the departure by default (the dossiers ready to load at 14 h 32 in Paris); `manifest`: the confirmed
// manifest at 16 h 05 the same day.
function invoice({ manifest = false } = {}) {
  const scelleuse = paid({ id: 'p1', ref: 'EXP-2YE537', finalPackages: [{ dimL: 40, dimW: 35, dimH: 10, poids: 1.9 }], lignes: [line('l-1', 'Mini scelleuse', 1, 16.64, 'cat-cuir'), line('l-2', 'Organisateur évier', 1, 9.92, 'cat-plastique')] }, flavie, { base: 25, parKg: 5 });
  scelleuse.devisSnapshot.amounts.taxLines[0].customDuty = { code: '42050090', label: 'Ouvrages en cuir', overrideReason: null };
  const pro = paid({ id: 'p3', ref: 'EXP-PRO001', finalPackages: [{ dimL: 40, dimW: 30, dimH: 30, poids: 12 }, { dimL: 30, dimW: 30, dimH: 20, poids: 7.5 }], lignes: [line('lp-1', 'Café torréfié 1 kg', 4, 15, 'cat-cafe'), line('lp-2', 'Machine à expresso', 1, 1189.5, 'cat-machine')] }, lagon, { base: 20, parKg: 5 });
  const result = buildCommercialInvoice({ envoi: { id: 'env', ref: 'ENV-2026-036', date: '2026-10-15', destinationCode: '974', modeTransport: 'aerien' }, items: [{ colis: pro, client: lagon }, { colis: scelleuse, client: flavie }], categories,
    ...(manifest ? { issuedAt: '2026-10-07T14:05:00Z', confirmed: true } : { issuedAt: '2026-10-07T12:32:00Z' }) });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result;
}
const BEFORE_DEPARTURE = 'Établie avant la confirmation du départ, d’après les dossiers prêts à charger le 07/10/2026 à 14 h 32 (heure de Paris).';
const FROM_MANIFEST = 'Établie d’après le manifeste du départ confirmé le 07/10/2026 à 16 h 05 (heure de Paris).';

test('the model: transport per article to the cent, the professional by its company name', () => {
  const { rows, totals } = invoice();
  assert.deepEqual(rows.map(row => [row.ref, row.clientName, row.hsCode, row.value, row.transport, row.total]), [
    ['EXP-2YE537', 'Hoarau Flavie', '42050090', 16.64, 24.43, 41.07],
    ['EXP-2YE537', 'Hoarau Flavie', '39241000', 9.92, 14.57, 24.49],
    ['EXP-PRO001', 'Lagon Services SARL', '0901210000', 60, 5.64, 65.64],
    ['EXP-PRO001', 'Lagon Services SARL', '8516710000', 1189.5, 111.86, 1301.36],
  ]);
  assert.deepEqual(totals, { value: 1276.06, transport: 156.5, total: 1432.56 });
});

test('the PDF: A4 landscape, every column, French amounts, the allocation rule and the customs footer', async () => {
  const { doc, filename } = buildCommercialInvoicePDF(invoice());
  assert.equal(filename, 'facture-commerciale-ENV-2026-036-avant-depart.pdf');
  const pages = await readPdf(doc);
  assert.equal(pages.length, 1);
  const [, , pageWidth, pageHeight] = pages[0].view;
  assert.ok(pageWidth > pageHeight, `landscape (${pageWidth} × ${pageHeight})`);
  assert.equal(Math.round(pageWidth), 842, 'A4: 297 mm wide');
  const items = pages[0].items;
  const all = items.join('\n');
  for (const expected of ['EXPEDÎLE', 'FACTURE COMMERCIALE', BEFORE_DEPARTURE, 'GROUPE DELIVREX', '95731 ROISSY CH DE GAULLE', 'N° de facture', 'ENV-2026-036', '07/10/2026', '15/10/2026', 'La Réunion', 'Aérien', 'Nombre de colis', '3', '21,4 kg'])
    assert.ok(items.includes(expected), `« ${expected} » in the header`);
  // The edition line sits under the header, above the articles.
  assert.ok(items.indexOf(BEFORE_DEPARTURE) > items.indexOf('21,4 kg') && items.indexOf(BEFORE_DEPARTURE) < items.indexOf('N° expédition'), 'under the header');
  for (const column of ['N° expédition', 'Destinataire', 'Code SH', 'Description', 'Qté', 'P.U. HT', 'Valeur HT', 'Total']) assert.ok(items.includes(column), `column « ${column} »`);
  assert.ok(all.includes('Transport') && all.includes('affecté'), 'column « Transport affecté »');
  for (const expected of ['EXP-2YE537', 'Hoarau Flavie', '42050090', 'Mini scelleuse', '24,43 €', '41,07 €', 'EXP-PRO001', 'Lagon Services SARL', '0901210000', 'Machine à expresso', '1 189,50 €', '111,86 €', '1 301,36 €'])
    assert.ok(items.includes(expected), `« ${expected} » in the articles`);
  assert.ok(items.includes('1 276,06 €') && items.includes('156,50 €') && items.includes('1 432,56 €'), 'the totals');
  assert.ok(items.includes('Transport réparti au prorata de la valeur des articles (quantité × prix unitaire HT). Valeurs en euros.'));
  assert.ok(items.includes('Document généré par Expedîle — usage douanier uniquement'), 'the footer is drawn as text');
  assert.ok(items.includes('ENV-2026-036 · Page 1/1'));
  for (const absent of ['undefined', 'NaN', 'null', '\u0000', '?', 'rovisoire']) assert.ok(!all.includes(absent), `no « ${absent} »`);
  assert.ok(!items.some(text => /\d\.\d/.test(text)), 'no decimal point');
});

test('the PDF from the manifest: the same title and number, its own basis line and file name', async () => {
  const { doc, filename } = buildCommercialInvoicePDF(invoice({ manifest: true }));
  assert.equal(filename, 'facture-commerciale-ENV-2026-036.pdf');
  const items = (await readPdf(doc)).flatMap(page => page.items);
  for (const expected of ['FACTURE COMMERCIALE', FROM_MANIFEST, 'ENV-2026-036', '07/10/2026', 'ENV-2026-036 · Page 1/1']) assert.ok(items.includes(expected), `« ${expected} »`);
  assert.ok(!items.includes(BEFORE_DEPARTURE) && !items.join('\n').includes('rovisoire'));
});

test('a long invoice keeps its basis line once, under the header of its first page', async () => {
  const many = invoice();
  const rows = Array.from({ length: 60 }, (_, index) => ({ ...many.rows[0], description: `Article ${index + 1}` }));
  const { doc } = buildCommercialInvoicePDF({ ...many, rows });
  const pages = await readPdf(doc);
  assert.ok(pages.length > 1, `${pages.length} pages`);
  assert.deepEqual(pages.map(page => page.items.includes(BEFORE_DEPARTURE)), pages.map((page, index) => index === 0));
  assert.ok(pages.at(-1).items.includes(`ENV-2026-036 · Page ${pages.length}/${pages.length}`));
});

test('the Excel sheet: numbers in euros, HS codes as text, totals as sums of the rows', () => {
  const model = invoice();
  const { book, filename } = buildCommercialInvoiceWorkbook(model);
  assert.equal(filename, 'facture-commerciale-ENV-2026-036-avant-depart.xlsx');
  const read = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { cellNF: true, cellFormula: true });
  assert.deepEqual(read.SheetNames, [COMMERCIAL_INVOICE_SHEET]);
  assert.equal(COMMERCIAL_INVOICE_SHEET, 'Facture commerciale');
  const sheet = read.Sheets[COMMERCIAL_INVOICE_SHEET];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  assert.deepEqual(rows.slice(0, 11).map(row => row.slice(0, 2)), [
    ['FACTURE COMMERCIALE', null], [BEFORE_DEPARTURE, null], ['N° de facture', 'ENV-2026-036'], ['Date', '07/10/2026'], ['Départ prévu', '15/10/2026'], ['Destination', 'La Réunion'],
    ['Mode de transport', 'Aérien'], ['Expéditions', 2], ['Nombre de colis', 3], ['Poids brut total (kg)', 21.4], ['Exportateur', 'GROUPE DELIVREX, 5 RUE DE COPENHAGUE, ROISSY POLE BAT AERONEF CS 13918, 95731 ROISSY CH DE GAULLE'],
  ]);
  const head = rows.findIndex(row => row[0] === 'N° expédition');
  assert.deepEqual(rows[head], [...COMMERCIAL_INVOICE_COLUMNS]);
  assert.deepEqual(rows.slice(head + 1, head + 5), model.rows.map(row => [row.ref, row.clientName, row.hsCode, row.description, row.quantity, row.unitPrice, row.value, row.transport, row.total]));
  const at = (r, c) => sheet[XLSX.utils.encode_cell({ r, c })];
  const cafe = head + 3;
  assert.deepEqual([at(cafe, 2).t, at(cafe, 2).v], ['s', '0901210000'], 'The HS code keeps its leading zero, as text.');
  for (const c of [5, 6, 7, 8]) assert.deepEqual([at(cafe, c).t, at(cafe, c).z], ['n', '#,##0.00 "€"'], `amount column ${c} is a number in euros`);
  assert.equal(at(cafe, 4).t, 'n', 'the quantity is a number');
  const total = head + 5;
  assert.deepEqual(rows[total], ['Total', null, null, null, null, null, 1276.06, 156.5, 1432.56]);
  assert.deepEqual([7, 8].map(c => at(total, c).f), [`SUM(H${head + 2}:H${head + 5})`, `SUM(I${head + 2}:I${head + 5})`]);
  assert.deepEqual(rows.slice(total + 1).filter(row => row.some(value => value !== null)).map(row => row[0]), [
    'Transport réparti au prorata de la valeur des articles (quantité × prix unitaire HT). Valeurs en euros.',
    'Document généré par Expedîle — usage douanier uniquement',
  ]);
});

test('the Excel sheet from the manifest: the same header, its own basis line and file name', () => {
  const { book, filename } = buildCommercialInvoiceWorkbook(invoice({ manifest: true }));
  assert.equal(filename, 'facture-commerciale-ENV-2026-036.xlsx');
  const rows = XLSX.utils.sheet_to_json(book.Sheets[COMMERCIAL_INVOICE_SHEET], { header: 1, raw: true, defval: null });
  assert.deepEqual(rows.slice(0, 4).map(row => row.slice(0, 2)), [['FACTURE COMMERCIALE', null], [FROM_MANIFEST, null], ['N° de facture', 'ENV-2026-036'], ['Date', '07/10/2026']]);
});

test('a blocked invoice is never exported', () => {
  const blocked = { ...invoice(), ok: false };
  assert.throws(() => buildCommercialInvoicePDF(blocked), /points à corriger/);
  assert.throws(() => buildCommercialInvoiceWorkbook(blocked), /points à corriger/);
});
