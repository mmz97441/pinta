import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs';
import * as XLSX from 'xlsx';
import { exportDossierTableExcel } from '../src/expedile/utils/exportExcel.js';
import { buildDossierTableModel, TABLE_COLUMNS } from '../src/expedile/domain/dossierTable.js';

XLSX.set_fs(fs);
async function workbook(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'expedile-table-export-'));
  try { await run(path.join(directory, 'dossiers.xlsx')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('downloaded workbook contains precisely current columns with genuine numeric payment cells', () => workbook(async filename => {
  const dossiers = [{ id: 'partial', ref: 'EXP-PARTIAL', clientId: 'client', devisTotal: 999 }, { id: 'initial', ref: 'EXP-INITIAL', clientId: 'client', devisTotal: 0 }];
  const clients = [{ id: 'client', nom: 'Camille Test', tel: '0600000000', email: 'private@example.test', adresse: 'Adresse masquée' }];
  const models = new Map([['partial', { payment: { requested: 100, paid: 30, remaining: 70, sentAt: '2026-10-01T22:30:00Z' } }], ['initial', { payment: { requested: null, paid: 0, remaining: null, sentAt: null, stateLabel: 'À calculer' } }]]);
  const columns = [{ key: 'ref', label: 'Référence' }, { key: 'requested', label: 'Demandé' }, { key: 'paid', label: 'Payé' }, { key: 'remaining', label: 'Reste à payer' }, { key: 'sentAt', label: 'Devis envoyé le' }, { key: 'email', label: 'Email' }];
  exportDossierTableExcel([...dossiers, dossiers[0]], clients, models, 'payments', columns, filename);
  const book = XLSX.readFile(filename, { cellNF: true });
  assert.deepEqual(book.SheetNames, ['Dossiers']);
  const sheet = book.Sheets.Dossiers;
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet), [
    { Référence: 'EXP-PARTIAL', Demandé: 100, Payé: 30, 'Reste à payer': 70, 'Devis envoyé le': '02/10/2026' },
    { Référence: 'EXP-INITIAL', Demandé: 'À calculer', Payé: 0, 'Reste à payer': 'À calculer', 'Devis envoyé le': 'Non renseigné' },
    // After one empty row, the total of each amount column: what the cells add up.
    { Référence: 'Total', Demandé: 100, Payé: 30, 'Reste à payer': 70 },
  ]);
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 })[3], [], 'One empty row between the dossiers and their total.');
  assert.deepEqual(['B5', 'C5', 'D5'].map(ref => [sheet[ref].t, sheet[ref].f, sheet[ref].v]), [['n', 'SUBTOTAL(9,B2:B3)', 100], ['n', 'SUBTOTAL(9,C2:C3)', 30], ['n', 'SUBTOTAL(9,D2:D3)', 70]]);
  assert.equal(sheet.E5, undefined, 'No total for a date.');
  assert.equal(sheet.B2.t, 'n'); assert.match(sheet.B2.z, /€/);
  assert.equal(sheet.B3.t, 's'); assert.equal(sheet.C3.v, 0); assert.equal(sheet.C3.t, 'n');
  assert.doesNotMatch(JSON.stringify(XLSX.utils.sheet_to_json(sheet)), /private|060000|masquée|999/);
}));

test('empty selection retains only visible headers without creating a fake dossier', () => workbook(async filename => {
  exportDossierTableExcel([], [], new Map(), 'daily', [{ key: 'ref', label: 'Référence' }, { key: 'owner', label: 'Qui s’en occupe' }], filename);
  const book = XLSX.readFile(filename);
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets.Dossiers, { header: 1 }), [['Référence', 'Qui s’en occupe']]);
}));

test('export keeps client text as text, without interpreting a formula or including other view fields', () => workbook(async filename => {
  const dossier = { id: 'one', ref: 'EXP-ONE', clientId: 'client', responsibleStaffId: 'wrong-referent' };
  exportDossierTableExcel([dossier], [{ id: 'client', nom: '=1+1' }], new Map([['one', { ownerName: 'Marie Test' }]]), 'daily', [{ key: 'client', label: 'Client' }, { key: 'owner', label: 'Qui s’en occupe' }, { key: 'paid', label: 'Payé' }], filename);
  const sheet = XLSX.readFile(filename).Sheets.Dossiers;
  assert.equal(sheet.A2.v, '=1+1'); assert.equal(sheet.A2.t, 's'); assert.equal(sheet.A2.f, undefined);
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet), [{ Client: '=1+1', 'Qui s’en occupe': 'Marie Test' }]);
}));

test('« Accords clients » exports its visible columns as text, with the consent wording of the screen', () => workbook(async filename => {
  const dossiers = [
    // The wait ends in 2099: without a model, the export reads the consent on the current clock.
    { id: 'waiting', ref: 'EXP-WAIT', clientId: 'client', statut: 'attente_feu_vert', attenteClientDate: '2026-10-03T08:00:00Z', attenteClientUntil: '2099-10-25T08:00:00Z', demandeFeuVertEnvoyeeAt: '2026-10-01T22:30:00Z', casier: 'C-4', nbColis: 2,
      messages: [{ template: 'demande_feu_vert', statut: 'envoye', createdAt: '2026-10-01T22:30:00Z' }, { template: 'relance_feu_vert', statut: 'envoi', canal: 'telegram', createdAt: '2026-10-02T09:00:00Z' }] },
    { id: 'pending', ref: 'EXP-PEND', clientId: 'client', statut: 'attente_feu_vert', demandeFeuVertEnvoyeeAt: '2026-10-01T22:30:00Z', casier: 'C-5', nbColis: 1,
      messages: [{ template: 'demande_feu_vert', statut: 'envoye', createdAt: '2026-10-01T22:30:00Z' }, { template: 'relance_feu_vert', statut: 'envoi', canal: 'telegram', createdAt: '2026-10-02T09:00:00Z' }] },
    { id: 'submit', ref: 'EXP-SUBMIT', clientId: 'client', statut: 'receptionne', devisTotal: 999 },
  ];
  const models = new Map([['waiting', { departure: { label: 'Prévu le 08/10/2026' } }], ['pending', { departure: { label: 'À choisir' } }], ['submit', { departure: { label: 'Souhaité le 19/11/2026 · à créer' } }]]);
  const columns = [{ key: 'ref', label: 'Référence' }, { key: 'consentState', label: 'Accord' }, { key: 'consentRequestedAt', label: 'Demande envoyée le' }, { key: 'lastRelanceAt', label: 'Dernière relance' }, { key: 'casier', label: 'Casier' }, { key: 'departure', label: 'Départ prévu' }, { key: 'requested', label: 'Prix du devis', priceKind: 'quote' }, { key: 'statusLabel', label: 'Statut du dossier' }];
  exportDossierTableExcel(dossiers, [{ id: 'client', nom: 'Payet Flavie', email: 'private@example.test' }], models, 'accords', columns, filename);
  const sheet = XLSX.readFile(filename).Sheets.Dossiers;
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet), [
    // The request of 1 October 22:30 UTC is on 2 October in Réunion. The relance still queued when the
    // client chose to wait (3 October) was cancelled by the server: it never reads as awaiting delivery.
    { Référence: 'EXP-WAIT', Accord: 'Le client attend · jusqu’au 25/10', 'Demande envoyée le': '02/10/2026', 'Dernière relance': '02/10/2026 · Annulée · attente du client', Casier: 'C-4', 'Départ prévu': 'Prévu le 08/10/2026' },
    // Without a wait, a relance still pending says so.
    { Référence: 'EXP-PEND', Accord: 'Réponse attendue', 'Demande envoyée le': '02/10/2026', 'Dernière relance': '02/10/2026 · En attente de livraison', Casier: 'C-5', 'Départ prévu': 'À choisir' },
    { Référence: 'EXP-SUBMIT', Accord: 'À soumettre', 'Demande envoyée le': 'Pas encore envoyée', 'Dernière relance': 'Aucune relance', Casier: 'À renseigner', 'Départ prévu': 'Souhaité le 19/11/2026 · à créer' },
  ], 'No price or status column of another view reaches this export.');
  assert.equal(sheet.C2.t, 's');assert.doesNotMatch(JSON.stringify(XLSX.utils.sheet_to_json(sheet)), /private|999/);
}));

test('« Dimensions finales » exports the volumetric lines of the cell, its column as wide as the longest line', () => workbook(async filename => {
  const dossier = { id: 'two', ref: 'EXP-2YE537', clientId: 'client', statut: 'en_preparation', preparationCompositionVersion: 1, finalMeasurementsVersion: 1, outgoingParcelCount: 2,
    finalPackages: [{ dimL: 31, dimW: 22, dimH: 13, poids: 2 }, { dimL: 19.5, dimW: 17, dimH: 11, poids: 1 }] };
  const models = new Map([['two', buildDossierTableModel(dossier, { settings: { diviseurVolumetrique: 5000 } })]]);
  exportDossierTableExcel([dossier], [], models, 'daily', [{ key: 'ref', label: 'Référence' }, { key: 'optimizedDimensions', label: 'Dimensions finales' }, { key: 'optimizedWeight', label: 'Poids final (kg)' }], filename);
  const sheet = XLSX.readFile(filename, { cellStyles: true }).Sheets.Dossiers;
  const lines = ['Colis 1 : 31 × 22 × 13 cm · 1,77\u00a0kg vol.', 'Colis 2 : 19,5 × 17 × 11 cm · 0,73\u00a0kg vol.', 'Total : 2,5\u00a0kg vol.'];
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet), [{ Référence: 'EXP-2YE537', 'Dimensions finales': lines.join('\n'), 'Poids final (kg)': 3 }, { Référence: 'Total', 'Poids final (kg)': 3 }]);
  assert.equal(sheet.B4, undefined, 'The volumetric total of « Dimensions finales » stays on screen: the sheet has its text.');
  assert.equal(sheet.C4.f, 'SUBTOTAL(9,C2:C2)');
  assert.equal(sheet['!cols'][1].wch, lines[1].length + 2, 'The longest line, not the three lines end to end.');
}));

// ── « Transport », « Taxes à l’importation estimées », numbers and the « Total » row ───────
const quote = (amounts, client = 'particulier', version = 1) => ({ version, amounts: { transport: 50, fees: 0, ...amounts }, inputs: { client: { type: client } } });
const ready = { clientId: 'client', statut: 'devis_envoye', feuVert: 'autorise', devisBrouillon: false, quoteVersion: 1, devisEnvoyeLe: '2026-10-01T08:00:00Z', preparationCompositionVersion: 1, finalMeasurementsVersion: 1, outgoingParcelCount: 1, finalPackages: [{ dimL: 30, dimW: 20, dimH: 20, poids: 3 }] };
// Transport + taxes = each saved total: a sent quote, a draft, a dossier received only, a former quote, a professional quote.
const LIST = [
  { ...ready, id: 'a', ref: 'EXP-A', nbColis: 2, devisTotal: 100, devisSnapshot: quote({ transport: 80, om: 10, omr: 5, tva: 5, total: 100 }) },
  { ...ready, id: 'b', ref: 'EXP-B', nbColis: 1, statut: 'en_preparation', outgoingParcelCount: 2, finalPackages: [{ dimL: 30, dimW: 20, dimH: 10, poids: 1.25 }, { dimL: 50, dimW: 40, dimH: 30, poids: 2.5 }], devisTotal: 83.47, devisBrouillon: true, quoteVersion: 3, devisSnapshot: quote({ transport: 70.8, om: 4.1, omr: 1.2, tva: 7.37, total: 83.47 }, 'particulier', 3) },
  { id: 'c', ref: 'EXP-C', clientId: 'client', statut: 'mesure', nbColis: 3 },
  { ...ready, id: 'd', ref: 'EXP-D', nbColis: 1, devisTotal: 50 },
  { ...ready, id: 'e', ref: 'EXP-E', nbColis: 1, devisTotal: 40, devisSnapshot: quote({ transport: 40, om: 0, omr: 0, tva: 0, total: 40 }, 'pro') },
];
const LIST_MODELS = new Map(LIST.map(dossier => [dossier.id, buildDossierTableModel(dossier, { now: Date.parse('2026-10-03T12:00:00Z') })]));

test('« Transport », « Taxes à l’importation estimées » and every column that adds up are numbers in their format; unknown values keep their wording', () => workbook(async filename => {
  exportDossierTableExcel(LIST, [], LIST_MODELS, 'departures', TABLE_COLUMNS.departures, filename);
  const sheet = XLSX.readFile(filename, { cellNF: true, cellStyles: true }).Sheets.Dossiers;
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const header = data[0], at = label => header.indexOf(label);
  assert.deepEqual(header.slice(-7), ['Colis à expédier', 'Prêt à partir ?', 'Dimensions finales', 'Poids final (kg)', 'Prix du devis', 'Transport', 'Taxes à l’importation estimées']);
  const column = label => data.slice(1, 6).map(line => line[at(label)]);
  assert.deepEqual(column('Transport'), [80, 70.8, 'À calculer', 'À vérifier', 40]);
  assert.deepEqual(column('Taxes à l’importation estimées'), [20, 12.67, 'À calculer', 'À vérifier', 0]);
  assert.deepEqual(column('Prix du devis'), [100, 83.47, 'À calculer', 50, 40]);
  assert.deepEqual(column('Colis à expédier'), [1, 2, 'Colis après optimisation à confirmer', 1, 1]);
  assert.deepEqual(column('Poids final (kg)'), [3, 3.75, '', 3, 3], 'Not optimised yet: the empty cell of the screen.');
  // What Excel shows: the format writes the cell's state and the professional quote's « Sans taxes (pro) ».
  const shown = (row, label) => sheet[XLSX.utils.encode_cell({ r: row, c: at(label) })];
  assert.deepEqual([1, 2, 5].map(row => [shown(row, 'Taxes à l’importation estimées').t, shown(row, 'Taxes à l’importation estimées').w]), [['n', '20.00 €'], ['n', '12.67 € · Brouillon'], ['n', 'Sans taxes (pro)']]);
  assert.equal(shown(2, 'Prix du devis').w, '83.47 € · Brouillon');
  assert.equal(shown(3, 'Taxes à l’importation estimées').t, 's');
  // The transport: a number in the euro format, the draft's state in its format; a professional quote's like any other.
  assert.deepEqual([1, 2, 5].map(row => [shown(row, 'Transport').t, shown(row, 'Transport').z, shown(row, 'Transport').w]), [['n', '#,##0.00 "€"', '80.00 €'], ['n', '#,##0.00 "€ · Brouillon"', '70.80 € · Brouillon'], ['n', '#,##0.00 "€"', '40.00 €']]);
  assert.deepEqual([3, 4].map(row => [shown(row, 'Transport').t, shown(row, 'Transport').v]), [['s', 'À calculer'], ['s', 'À vérifier']]);
  assert.ok(sheet['!cols'][at('Transport')].wch >= '70.80 € · Brouillon'.length + 2);
  assert.deepEqual([shown(1, 'Colis à expédier').z, shown(2, 'Poids final (kg)').z, shown(1, 'Prix du devis').z], ['0', '#,##0.00', '#,##0.00 "€"']);
  // A column is as wide as its numbers as Excel writes them, never « ### ».
  assert.ok(sheet['!cols'][at('Prix du devis')].wch >= '83.47 € · Brouillon'.length + 2);
  assert.ok(sheet['!cols'][at('Taxes à l’importation estimées')].wch >= 'Sans taxes (pro)'.length + 2);
}));

test('after one empty row, « Total » adds up each numeric column with SUBTOTAL(9, …), its value cached, under a filtered header row', () => workbook(async filename => {
  exportDossierTableExcel(LIST, [], LIST_MODELS, 'daily', TABLE_COLUMNS.daily, filename);
  const sheet = XLSX.readFile(filename, { cellNF: true }).Sheets.Dossiers;
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const header = data[0], at = label => header.indexOf(label);
  // The dossiers, one empty row, the total: no group row among the dossiers, so the sheet sorts as it is.
  assert.deepEqual(data.slice(1, 6).map(line => line[0]), ['EXP-A', 'EXP-B', 'EXP-C', 'EXP-D', 'EXP-E']);
  assert.equal(data.length, 8);
  assert.ok(data[6].every(value => value === null), 'One empty row.');
  assert.equal(data[7][0], 'Total');
  assert.deepEqual(sheet['!autofilter'], { ref: `A1:${XLSX.utils.encode_col(header.length - 1)}6` }, 'The filter covers the header and the dossiers, not the total.');
  const total = label => sheet[XLSX.utils.encode_cell({ r: 7, c: at(label) })];
  const range = label => { const name = XLSX.utils.encode_col(at(label)); return `SUBTOTAL(9,${name}2:${name}6)`; };
  for (const [label, value, format] of [['Cartons reçus', 8, '0'], ['Poids final (kg)', 12.75, '#,##0.00'], ['Prix du devis', 273.47, '#,##0.00 "€"'], ['Transport', 190.8, '#,##0.00 "€"'], ['Taxes à l’importation estimées', 32.67, '#,##0.00 "€"']]) {
    assert.deepEqual([total(label).t, total(label).f, total(label).v, total(label).z], ['n', range(label), value, format], label);
  }
  // Text, dates and « Dimensions finales » (text in the sheet) have no total.
  for (const label of ['Client', 'Dernière réception', 'Casier', 'Dimensions finales']) assert.equal(total(label), undefined, label);
  // The cached value is what Excel computes over the numbers above it: the drafts count, the wording does not.
  const numbers = label => data.slice(1, 6).map(line => line[at(label)]).filter(value => typeof value === 'number');
  for (const label of ['Cartons reçus', 'Poids final (kg)', 'Prix du devis', 'Transport', 'Taxes à l’importation estimées']) assert.equal(Math.round(numbers(label).reduce((sum, value) => sum + value * 100, 0)) / 100, total(label).v, label);
  // « Transport » sits between the price and the taxes, its total in the same « Total » row.
  assert.deepEqual([header[at('Prix du devis') + 1], header[at('Transport') + 1]], ['Transport', 'Taxes à l’importation estimées']);
}));

test('a column without any value totals « Non renseigné », never 0; no dossier, no total row', () => workbook(async filename => {
  const received = LIST.filter(dossier => dossier.id === 'c');
  exportDossierTableExcel(received, [], LIST_MODELS, 'daily', TABLE_COLUMNS.daily.filter(column => ['ref', 'cartons', 'optimizedWeight', 'requested', 'transport', 'taxes'].includes(column.key)), filename);
  const data = XLSX.utils.sheet_to_json(XLSX.readFile(filename).Sheets.Dossiers, { header: 1, defval: null });
  assert.deepEqual(data, [['Référence', 'Cartons reçus', 'Poids final (kg)', 'Prix du devis', 'Transport', 'Taxes à l’importation estimées'], ['EXP-C', 3, '', 'À calculer', 'À calculer', 'À calculer'], [null, null, null, null, null, null], ['Total', 3, 'Non renseigné', 'Non renseigné', 'Non renseigné', 'Non renseigné']]);
  exportDossierTableExcel([], [], LIST_MODELS, 'daily', TABLE_COLUMNS.daily, filename);
  assert.deepEqual(XLSX.utils.sheet_to_json(XLSX.readFile(filename).Sheets.Dossiers, { header: 1 }).length, 1, 'The header alone.');
}));

test('without the right to export amounts, the sheet has neither the transport, the taxes nor a financial total', () => workbook(async filename => {
  // The screen passes its visible columns minus the financial ones (perm_finances_exporter).
  exportDossierTableExcel(LIST, [], LIST_MODELS, 'daily', TABLE_COLUMNS.daily.filter(column => !column.financial), filename);
  const data = XLSX.utils.sheet_to_json(XLSX.readFile(filename).Sheets.Dossiers, { header: 1, defval: null });
  assert.equal(data[0].includes('Taxes à l’importation estimées'), false); assert.equal(data[0].includes('Prix du devis'), false); assert.equal(data[0].includes('Transport'), false);
  assert.doesNotMatch(JSON.stringify(data), /273\.47|32\.67|83\.47|190\.8|70\.8/);
  assert.equal(data.at(-1)[0], 'Total');
}));
