// The outgoing parcel labels: one label per prepared parcel, the dossiers left out and why, and the PDF itself,
// built with the real jsPDF and read back with pdf.js: its pages, its text, the QR code sampled from the drawn
// modules (it holds the parcel code and nothing else) and the barcode decoded from its bars.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import QRCode from 'qrcode';
import { CODE128_PATTERNS } from '../src/expedile/utils/code128.js';
import { parseParcelCode } from '../src/expedile/domain/parcelCode.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The application imports the ES builds; Node loads the CommonJS ones, whose default export is mapped here.
const bundle = await build({ entryPoints: [path.join(directory, '../src/expedile/utils/exportParcelLabels.js')], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'node-pdf-builds', setup(builder) {
  builder.onResolve({ filter: /^jspdf(-autotable)?$/ }, (args) => args.namespace === 'node-pdf' ? { path: args.path, external: true } : { path: args.path, namespace: 'node-pdf' });
  builder.onLoad({ filter: /.*/, namespace: 'node-pdf' }, (args) => ({ contents: args.path === 'jspdf' ? "import * as pdf from 'jspdf'; export default pdf.jsPDF;" : "import * as table from 'jspdf-autotable'; export default table.autoTable || table.default;", loader: 'js' }));
} }] });
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const { parcelLabels, buildParcelLabelsPdf, printParcelLabels, skippedLabelLines, LABEL_SKIP_MESSAGES } = loaded.exports;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const STANDARD_FONTS = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
const MM = 72 / 25.4;

const client = {
  id: 'client-1', nomFamille: 'Payet', prenom: 'Flavie', nom: 'Payet Flavie', type: 'particulier',
  adresseLigne1: '12 rue des Lilas', adresseLigne2: 'Résidence Les Flamboyants', cp: '97400', ville: 'Saint-Denis', commune: '',
  tel: '0692 12 34 56', telFixe: '', email: 'flavie@example.test', infosLivraison: 'Sonner deux fois',
};
const boxes = [{ dimL: 40, dimW: 20, dimH: 10, poids: 2.5 }, { dimL: 25, dimW: 20, dimH: 15, poids: 1.25 }];
const prepared = (overrides = {}) => ({
  id: 'dossier-1', ref: 'EXP-2YE537', clientId: 'client-1', statut: 'en_preparation', casier: 'A-03', archive: false,
  finalPackages: boxes, outgoingParcelCount: 2, preparationCompositionVersion: 3, finalMeasurementsVersion: 3, ...overrides,
});
const getClient = id => (id === client.id ? client : null);

async function readPdf(doc) {
  return pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
}
/** The outline of each subpath of a pdf.js path (moveTo 0, lineTo 1, curveTo 2, quadraticCurveTo 3, closePath 4). */
function subpaths(data) {
  const shapes = [];
  let points = [];
  for (let index = 0; index < data.length;) {
    const op = data[index++];
    if (op === 0 && points.length) { shapes.push(points); points = []; }
    if (op === 0 || op === 1) { points.push([data[index], data[index + 1]]); index += 2; }
    else if (op === 2) { points.push([data[index + 4], data[index + 5]]); index += 6; }
    else if (op === 3) { points.push([data[index + 2], data[index + 3]]); index += 4; }
    else if (op === 4 && points.length) { shapes.push(points); points = []; }
  }
  if (points.length) shapes.push(points);
  return shapes;
}
/** The page's text items (no-break spaces read as spaces) and each filled subpath as a rectangle, in millimetres from the top left. */
async function readPage(pdf, number) {
  const page = await pdf.getPage(number);
  const text = (await page.getTextContent()).items.map(item => item.str.replace(/\u00a0/g, ' ')).filter(item => item.trim());
  const operators = await page.getOperatorList();
  const height = page.view[3];
  const rects = [];
  operators.fnArray.forEach((fn, index) => {
    if (fn !== pdfjs.OPS.constructPath) return;
    const [paint, [path]] = operators.argsArray[index];
    if (paint !== pdfjs.OPS.fill && paint !== pdfjs.OPS.eoFill) return;
    for (const points of subpaths(Array.from(path))) {
      const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
      rects.push({ left: Math.min(...xs) / MM, right: Math.max(...xs) / MM, top: (height - Math.max(...ys)) / MM, bottom: (height - Math.min(...ys)) / MM });
    }
  });
  return { view: page.view, text, rects };
}
/** The QR code's dark modules, sampled at each module's centre from the rectangles drawn in its area. */
function sampleQr(rects, size) {
  const area = rects.filter(rect => rect.left > 56 && rect.top > 20 && rect.bottom < 62);
  const left = Math.min(...area.map(rect => rect.left)), right = Math.max(...area.map(rect => rect.right));
  const top = Math.min(...area.map(rect => rect.top));
  const module = (right - left) / size;
  const matrix = [];
  for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) {
    const x = left + (column + 0.5) * module, y = top + (row + 0.5) * module;
    matrix.push(area.some(rect => rect.left <= x && x <= rect.right && rect.top <= y && y <= rect.bottom) ? 1 : 0);
  }
  return { matrix, width: right - left };
}
/** The barcode's text, decoded from the bars drawn under the recipient (an independent reading of the widths). */
function decodeBars(rects) {
  const bars = rects.filter(rect => rect.top > 114 && rect.bottom < 140).sort((a, b) => a.left - b.left);
  const unit = Math.min(...bars.map(bar => bar.right - bar.left));
  const widths = [];
  bars.forEach((bar, index) => {
    widths.push(Math.round((bar.right - bar.left) / unit));
    if (bars[index + 1]) widths.push(Math.round((bars[index + 1].left - bar.right) / unit));
  });
  const byPattern = new Map(CODE128_PATTERNS.map((pattern, value) => [pattern, value]));
  const values = [];
  for (let index = 0; index < widths.length - 7; index += 6) values.push(byPattern.get(widths.slice(index, index + 6).join('')));
  assert.equal(widths.slice(-7).join(''), CODE128_PATTERNS[106], 'stop pattern');
  const check = values.pop();
  assert.equal(check, values.reduce((sum, value, position) => sum + value * Math.max(position, 1), 0) % 103, 'check symbol');
  assert.equal(values[0], 104, 'start B');
  return { text: values.slice(1).map(value => String.fromCharCode(value + 32)).join(''), unit, left: bars[0].left, right: bars[bars.length - 1].right };
}

test('one label per outgoing parcel: its code, its measures, the casier and the recipient for the driver', () => {
  const { labels, skipped } = parcelLabels([prepared()], { getClient });
  assert.deepEqual(skipped, []);
  assert.deepEqual(labels.map(label => [label.index, label.count, label.code, label.codeText]), [
    [1, 2, 'EXP-2YE537-1-2', 'EXP-2YE537 · Colis 1/2'],
    [2, 2, 'EXP-2YE537-2-2', 'EXP-2YE537 · Colis 2/2'],
  ]);
  assert.deepEqual(labels.map(label => label.parcel), boxes);
  assert.equal(labels[0].casier, 'A-03');
  assert.deepEqual(labels[0].recipient, {
    name: 'PAYET Flavie', company: '', lines: ['12 RUE DES LILAS', 'RÉSIDENCE LES FLAMBOYANTS'], postcode: '97400', town: 'SAINT-DENIS',
    destination: 'LA RÉUNION', phones: ['0692 12 34 56'], instructions: 'Sonner deux fois', sector: 'NORD', missing: [],
  });
  // The codes carry the parcel only: the scanners read them back, and no personal data is inside.
  for (const label of labels) {
    assert.deepEqual(parseParcelCode(label.code), { ok: true, ref: 'EXP-2YE537', index: label.index, count: 2, layoutCorrected: false });
    for (const personal of ['Payet', 'PAYET', 'Flavie', '0692', '97400', 'Lilas', 'A-03']) assert.ok(!label.code.includes(personal));
  }
  // A legacy preparation (finalPackages NULL) is one parcel with the scalar measures; strings from the database are numbers.
  const legacy = parcelLabels([prepared({ finalPackages: null, outgoingParcelCount: 1, finL: '30', finW: '20', finH: '20', finP: '3' })], { getClient });
  assert.deepEqual(legacy.labels.map(label => [label.code, label.parcel]), [['EXP-2YE537-1-1', { dimL: 30, dimW: 20, dimH: 20, poids: 3 }]]);
});

test('dossiers without labels are returned with their reason, never printed', () => {
  const dossiers = [
    prepared({ id: 'a', ref: 'EXP-AAAAA1', finalPackages: [], outgoingParcelCount: null }),
    prepared({ id: 'b', ref: 'EXP-BBBBB2', finalMeasurementsVersion: 2 }), // composition changed since the measures
    prepared({ id: 'c', ref: 'EXP-CCCCC3', outgoingParcelCount: 3 }),
    prepared({ id: 'd', ref: 'EXP-DDDDD4', statut: 'annule' }),
    prepared({ id: 'e', ref: 'EXP-EEEEE5', archive: true }),
    prepared({ id: 'f', ref: 'EXP-FFFFF6', clientId: 'unknown' }),
    prepared({ id: 'g', ref: 'Dossier 7' }),
    prepared({ id: 'h', ref: 'EXP-HHHHH8' }),
  ];
  const incomplete = { ...client, id: 'client-2', adresseLigne1: '', adresse: '', ville: '' };
  dossiers[7].clientId = incomplete.id;
  const { labels, skipped } = parcelLabels(dossiers, { getClient: id => ({ [client.id]: client, [incomplete.id]: incomplete })[id] || null });
  assert.deepEqual(labels, []);
  assert.deepEqual(skipped.map(item => [item.ref, item.reason]), [
    ['EXP-AAAAA1', 'not-prepared'], ['EXP-BBBBB2', 'not-prepared'], ['EXP-CCCCC3', 'not-prepared'], ['EXP-DDDDD4', 'cancelled'],
    ['EXP-EEEEE5', 'archived'], ['EXP-FFFFF6', 'client'], ['Dossier 7', 'reference'], ['EXP-HHHHH8', 'address'],
  ]);
  assert.equal(skipped[0].message, 'étiquettes disponibles après l’optimisation des colis');
  assert.deepEqual([skipped[7].missing, skipped[7].complete, skipped[7].clientId], [['adresse', 'ville'], 'adresse', 'client-2']);
  assert.deepEqual(skippedLabelLines(skipped).slice(0, 2), [
    'EXP-AAAAA1, EXP-BBBBB2, EXP-CCCCC3 : étiquettes disponibles après l’optimisation des colis',
    'EXP-DDDDD4 : expédition annulée, aucune étiquette à imprimer',
  ]);
  assert.equal(skippedLabelLines(skipped)[5], `EXP-HHHHH8 : ${LABEL_SKIP_MESSAGES.address} (adresse, ville)`);
  // Mixed with a prepared dossier: its labels are made, the others are listed.
  const mixed = parcelLabels([dossiers[0], prepared()], { getClient });
  assert.deepEqual([mixed.labels.length, mixed.skipped.map(item => item.ref)], [2, ['EXP-AAAAA1']]);
});

test('the destination of the saved quote comes first, then the postcode; an unserved postcode asks for the record', () => {
  const quoted = prepared({ devisSnapshot: { inputs: { destination: { code: '972', nom: 'Martinique' } } } });
  assert.equal(parcelLabels([quoted], { getClient }).labels[0].recipient.destination, 'MARTINIQUE');
  const guadeloupe = { ...client, cp: '97110', ville: 'Pointe-à-Pitre', commune: 'Abymes' };
  const label = parcelLabels([prepared()], { getClient: () => guadeloupe }).labels[0];
  assert.deepEqual([label.recipient.destination, label.recipient.town, label.recipient.sector], ['GUADELOUPE', 'ABYMES', null]);
  const paris = parcelLabels([prepared()], { getClient: () => ({ ...client, cp: '75001' }) });
  assert.deepEqual([paris.skipped[0].reason, paris.skipped[0].missing, paris.skipped[0].complete], ['address', ['destination'], 'cp']);
  // A company is printed above the person; both phones are kept.
  const pro = parcelLabels([prepared()], { getClient: () => ({ ...client, type: 'pro', raisonSociale: 'Ti Boutik SARL', telFixe: '0262 41 22 33' }) }).labels[0];
  assert.deepEqual([pro.recipient.company, pro.recipient.name, pro.recipient.phones], ['Ti Boutik SARL', 'PAYET Flavie', ['0692 12 34 56', '0262 41 22 33']]);
});

test('the PDF: a 100 × 150 mm page per parcel, its text, a QR code of the code only and the same code in Code 128', async () => {
  const { labels } = parcelLabels([prepared()], { getClient });
  const { doc, filename } = buildParcelLabelsPdf(labels);
  assert.equal(filename, 'etiquettes-EXP-2YE537.pdf');
  const pdf = await readPdf(doc);
  assert.equal(pdf.numPages, 2);
  for (const label of labels) {
    const page = await readPage(pdf, label.index);
    assert.ok(Math.abs(page.view[2] - 100 * MM) < 0.01 && Math.abs(page.view[3] - 150 * MM) < 0.01, 'a 100 × 150 mm page');
    for (const text of [label.codeText, 'EXP-2YE537', `Colis ${label.index}/2`, 'CASIER A-03', 'PAYET Flavie', '12 RUE DES LILAS', '97400 SAINT-DENIS', 'LA RÉUNION', 'Tél. 0692 12 34 56', 'EXPÉDITEUR', 'DESTINATAIRE', 'NORD'])
      assert.ok(page.text.includes(text), `page ${label.index}: « ${text} » in ${JSON.stringify(page.text)}`);
    const parcel = label.index === 1 ? ['40 × 20 × 10 cm', 'Poids réel 2,5 kg'] : ['25 × 20 × 15 cm', 'Poids réel 1,25 kg'];
    for (const text of parcel) assert.ok(page.text.includes(text), `page ${label.index}: « ${text} »`);
    assert.ok(!page.text.some(text => /undefined|NaN|null/.test(text)));
    // The QR code: its modules are exactly those of the parcel code at error correction M, and it is at least 30 mm wide.
    const expected = QRCode.create(label.code, { errorCorrectionLevel: 'M' }).modules;
    const qr = sampleQr(page.rects, expected.size);
    assert.deepEqual(qr.matrix, Array.from(expected.data, Number), `page ${label.index}: the QR code holds « ${label.code} »`);
    assert.ok(qr.width >= 30, `QR code ${qr.width.toFixed(1)} mm wide`);
    // The barcode: the same code, bars of at least 0.3 mm, and ten modules of clear space on each side.
    const bars = decodeBars(page.rects);
    assert.equal(bars.text, label.code);
    assert.ok(bars.unit >= 0.3, `module ${bars.unit.toFixed(3)} mm`);
    assert.ok(bars.left >= 10 * bars.unit && 100 - bars.right >= 10 * bars.unit, 'quiet zones');
  }
});

test('long addresses, a company and a long name stay on the label, above the barcode', async () => {
  const crowded = { ...client, type: 'pro', raisonSociale: 'Société de distribution des produits tropicaux de l’océan Indien', nomFamille: 'Grondin-Hoarau de la Grande Montagne', prenom: 'Marie-Josée',
    adresseLigne1: 'Résidence Les Flamboyants, bâtiment C, appartement 12, troisième étage\nChemin des Barbadines prolongé', adresseLigne2: 'Lieu-dit Bois de Nèfles, après la boulangerie Le Bon Pain', telFixe: '0262 41 22 33',
    infosLivraison: 'Sonner deux fois, le portail bleu reste fermé le matin, appeler le gardien avant de monter' };
  const { labels } = parcelLabels([prepared({ casier: 'B-12-HAUT' })], { getClient: () => crowded });
  const pdf = await readPdf(buildParcelLabelsPdf(labels).doc);
  const page = await readPage(pdf, 1);
  assert.ok(page.text.includes('97400 SAINT-DENIS') && page.text.includes('LA RÉUNION') && page.text.includes('Tél. 0692 12 34 56 · 0262 41 22 33'), JSON.stringify(page.text));
  assert.equal(decodeBars(page.rects).text, 'EXP-2YE537-1-2');
  // Every text of the recipient stays above the barcode's separator (113,5 mm).
  const content = await (await pdf.getPage(1)).getTextContent();
  const lowest = Math.max(...content.items.filter(item => item.str.trim() && item.str !== labels[0].codeText).map(item => (150 * MM - item.transform[5]) / MM));
  assert.ok(lowest < 113.5, `lowest recipient line at ${lowest.toFixed(1)} mm`);
});

test('printing opens the document in the window of the click, else in a new one, else downloads it; nothing printable opens nothing', () => {
  const saved = { window: globalThis.window, document: globalThis.document, setTimeout: globalThis.setTimeout };
  const timers = [];
  const opened = [];
  const clicked = [];
  try {
    globalThis.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
    let allowPopup = true;
    globalThis.window = { open: (url, name) => { opened.push([url, name]); return allowPopup ? {} : null; } };
    globalThis.document = { body: { appendChild() {} }, createElement: () => ({ click() { clicked.push({ href: this.href, download: this.download }); }, remove() {} }) };
    // The window opened by the click receives the PDF.
    const target = { closed: false, location: { replace(url) { this.url = url; } }, close() { this.closed = true; } };
    const first = printParcelLabels([prepared()], { getClient, target });
    assert.deepEqual([first.count, first.dossiers, first.method, first.filename, first.lines], [2, 1, 'window', 'etiquettes-EXP-2YE537.pdf', []]);
    assert.match(target.location.url, /^blob:/);
    assert.deepEqual(opened, []);
    // Without one, a new window; refused, a download of the same file.
    assert.equal(printParcelLabels([prepared()], { getClient }).method, 'window');
    assert.match(opened[0][0], /^blob:/);
    allowPopup = false;
    const downloaded = printParcelLabels([prepared()], { getClient });
    assert.equal(downloaded.method, 'download');
    assert.deepEqual(clicked.map(link => link.download), ['etiquettes-EXP-2YE537.pdf']);
    // Each address is released later, once the document has surely loaded.
    assert.equal(timers.length, 3);
    assert.ok(timers.every(timer => timer.delay >= 60000));
    // Nothing printable: no window, the waiting one is closed, the reasons are returned.
    const waiting = { closed: false, close() { this.closed = true; } };
    const none = printParcelLabels([prepared({ finalPackages: [], outgoingParcelCount: null })], { getClient, target: waiting });
    assert.deepEqual([none.count, none.method, none.lines, waiting.closed], [0, null, ['EXP-2YE537 : étiquettes disponibles après l’optimisation des colis'], true]);
    assert.equal(opened.length, 2);
  } finally {
    timers.forEach(timer => timer.callback());
    Object.assign(globalThis, saved);
    if (saved.window === undefined) delete globalThis.window;
    if (saved.document === undefined) delete globalThis.document;
  }
});
