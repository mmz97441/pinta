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
  return (await pdfPositionedItems(doc)).map(item => item.text);
}
/** The same items with their page and their height on it (pdf.js measures y from the bottom of the page). */
async function pdfPositionedItems(doc) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const items = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const content = await (await pdf.getPage(number)).getTextContent();
    items.push(...content.items.map(item => ({ page: number, y: item.transform[5], x: item.transform[4], text: item.str.replace(/\u00a0/g, ' ') })).filter(item => item.text.trim()));
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
  // The octroi de mer of the engine reads as an estimate of La Réunion's import taxes, part of the price.
  assert.ok(items.includes('Estimation des taxes à l’importation à La Réunion') && items.includes('(payées à l’arrivée, comprises dans le prix)'));
  assert.ok(items.includes('dont estimation octroi de mer de La Réunion') && items.filter(text => text === '8,20 €').length === 2, 'the estimate and its only line');
  assert.ok(!items.includes('Octroi de mer (OM)'), 'never a line « Octroi de mer » of the price');
  assert.ok(items.includes('TOTAL : 87,50 €'));
  assert.ok(items.includes('Économie réalisée grâce à l’optimisation : 41,90 €'));
  assert.ok(items.includes('40 × 30 × 25 cm · 6,2 kg'), 'French decimals in measures');
  assert.ok(items.includes('Référence : EXP-TEST-001') && items.includes('Version : 2'));
  for (const absent of ['TVA', 'octroi de mer régional', 'Octroi de mer', '→', '\u0000', 'undefined', 'NaN']) assert.ok(!all.includes(absent), `no « ${absent} »`);
  assert.ok(!items.some(text => /(^|\s)0[,.]00 €/.test(text)), 'no « 0,00 € » amount');
  assert.ok(!items.some(text => /\d\.\d/.test(text) && !/^Généré le/.test(text)), 'no decimal point');
});

test('real taxes, fees and large amounts keep their French format; a missing saving is never invented', async () => {
  const quote = snapshot({ amounts: { transport: 1200, om: 20.5, omr: 5.25, tva: 8.75, total: 1234.5 }, savings: 0, fees: [{ libelle: 'Emballage renforcé', montant: 4 }, { libelle: 'Frais offert', montant: 0 }] });
  const { doc } = buildDevisPDF(dossier(quote), { type: 'particulier' }, { nom: 'La Réunion' });
  const items = await pdfTextItems(doc);
  const all = items.join('\n');
  assert.ok(items.includes('1 200,00 €') && items.includes('TOTAL : 1 234,50 €'), 'thousands separated by a drawable space');
  // 20,50 + 5,25 + 8,75: the estimate, then each estimated tax of the destination, never a « TVA (8,5 %) » of the price.
  const at = text => items.indexOf(text);
  assert.ok(at('Estimation des taxes à l’importation à La Réunion') >= 0 && items[at('(payées à l’arrivée, comprises dans le prix)') + 1] === '34,50 €', items.join(' | '));
  for (const [label, amount] of [['dont estimation octroi de mer de La Réunion', '20,50 €'], ['dont estimation octroi de mer régional de La Réunion', '5,25 €'], ['dont estimation TVA à l’importation de La Réunion', '8,75 €']]) assert.equal(items[at(label) + 1], amount, label);
  assert.ok(!items.some(text => /^TVA|^Octroi de mer|TVA \(/.test(text)), 'no tax line of Expedîle’s price');
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
  for (const absent of ['Octroi de mer', 'octroi de mer', 'TVA', 'Estimation des taxes']) assert.ok(!all.includes(absent), `no « ${absent} » for a professional`);
});

// ── The issuer's legal identity (F10, decision of 10 October 2026) ─────────
const LEGAL = { nom: 'Expedîle France (essai)', formeJuridique: 'SAS', capital: '10000', adresse: '10 allée de l’Essai', codePostal: '95700', ville: 'Roissy-en-France', pays: 'France', siret: '12345678900012', rcsVille: 'Pontoise', tva: 'FR00123456789', eori: 'FR12345678900012' };
const IDENTITY_LINES = ['Expedîle France (essai), SAS au capital de 10 000 €', 'Siège social : 10 allée de l’Essai, 95700 Roissy-en-France', 'RCS Pontoise 123 456 789 · SIRET 123 456 789 00012', 'N° de TVA intracommunautaire : FR00123456789'];
const business = expediteur => ({ fraisStockage: '1.50', factureCommerciale: { expediteur } });

test('a complete identity is printed under the brand, before the client, on the quote and on a professional quote', async () => {
  for (const type of ['particulier', 'pro']) {
    const { doc } = buildDevisPDF(dossier(snapshot({ type, mode: type === 'pro' ? 'virement' : 'payplug' })), { type }, { nom: 'La Réunion' }, { business: business(LEGAL) });
    const items = await pdfPositionedItems(doc);
    const lines = IDENTITY_LINES.map(line => items.find(item => item.page === 1 && item.text.replace(/\s+/g, ' ') === line));
    assert.ok(lines.every(Boolean), `${type}: ${items.filter(item => item.page === 1).map(item => item.text).join(' | ')}`);
    const client = items.find(item => item.text === 'Client'), brand = items.find(item => item.text === 'EXPEDÎLE');
    assert.ok(lines.every(line => line.y < brand.y && line.y > client.y + 5), `${type}: the identity sits between the brand and the client block`);
    assert.ok(lines.every((line, index) => !index || line.y < lines[index - 1].y), `${type}: one mention per line, in order`);
    assert.ok(!items.some(item => /Paris, France|à compléter|Paramètres/.test(item.text)), `${type}: no placeholder and no instruction`);
  }
});

test('an incomplete identity is never invented: the client’s quote keeps its former header, the team’s estimate says what to complete', async () => {
  const partial = { nom: 'Expedîle', adresse: '10 allée de l’Essai', codePostal: '95700', ville: 'Roissy-en-France', pays: 'France', siret: '12345678900012' };
  for (const settings of [null, business({}), business(partial), business({ ...LEGAL, capital: 'beaucoup' })]) {
    const items = await pdfTextItems(buildDevisPDF(dossier(snapshot()), { type: 'particulier' }, { nom: 'La Réunion' }, { business: settings, audience: 'client' }).doc);
    assert.ok(items.includes('Paris, France'), 'the client’s quote keeps its former header');
    assert.ok(!items.some(text => /SIRET|RCS|capital|Siège|Paramètres|compléter/.test(text)), items.join(' | '));
  }
  const estimate = { ...snapshot(), mode: 'estimate', version: null };
  const staff = (await pdfTextItems(buildDevisPDF({ ref: 'ESTIMATION', devisTotal: 87.5, quoteSnapshot: estimate }, { type: 'particulier' }, { nom: 'La Réunion' }, { business: business(partial), audience: 'staff' }).doc)).join(' ').replace(/\s+/g, ' ');
  assert.match(staff, /Identité légale à compléter dans Paramètres › Facture commerciale : forme juridique, capital social, ville du greffe \(RCS\), numéro de TVA\./);
  assert.doesNotMatch(staff, /Paris, France|RCS Pontoise/);
  // Complete, the team's estimate prints the identity like the client's quote.
  const complete = (await pdfTextItems(buildDevisPDF({ ref: 'ESTIMATION', devisTotal: 87.5, quoteSnapshot: estimate }, { type: 'particulier' }, { nom: 'La Réunion' }, { business: business(LEGAL), audience: 'staff' }).doc)).map(text => text.replace(/\s+/g, ' '));
  for (const line of IDENTITY_LINES) assert.ok(complete.includes(line), line);
  assert.ok(!complete.some(text => /compléter/.test(text)));
});

test('a long registered office wraps inside the header column and pushes the client block down', async () => {
  const office = { ...LEGAL, adresse: 'Zone logistique des Entrepôts du Nord, bâtiment C, quai 12, porte 4', complement: 'Accès par la rue des Transitaires' };
  const items = await pdfPositionedItems(buildDevisPDF(dossier(snapshot()), { type: 'particulier' }, { nom: 'La Réunion' }, { business: business(office) }).doc);
  const header = items.filter(item => item.page === 1 && item.x < 100 && item.y > items.find(other => other.text === 'Client').y);
  const office1 = header.findIndex(item => item.text.startsWith('Siège social'));
  assert.ok(office1 >= 0 && header[office1 + 1] && !header[office1 + 1].text.startsWith('RCS'), 'the office takes two lines');
  const quoteInfo = items.find(item => item.text.startsWith('Référence'));
  assert.ok(header.every(item => item.x < quoteInfo.x), 'nothing runs into the quote reference column');
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
