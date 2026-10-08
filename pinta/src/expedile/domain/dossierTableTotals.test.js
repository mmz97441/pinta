import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_COLUMNS, buildDossierTableModel, buildDossierTableExport, sortDossierTableRows, dossierTableNumber } from './dossierTable.js';
import { filterDossierTableRows } from './dossierTablePreferences.js';
import { dossierTableTotals, hasDossierTableTotals, formatDossierTableTotal, dossierTableTotalLabel, dossierTableSubtotalLabel, dossierCardTotalLabel, dossierTableTotalSummary, TOTAL_UNKNOWN_LABEL } from './dossierTableTotals.js';

const now = Date.parse('2026-10-03T12:00:00Z');
const nb = text => text.replace(/ (?=kg|€)/g, '\u00a0').replace(/(\d) (?=\d{3}\b)/g, '$1\u202f');
const savedQuote = (amounts, client = 'particulier', version = 1) => ({ version, amounts: { transport: 50, fees: 0, ...amounts }, inputs: { client: { type: client } } });
const prepared = { clientId: 'c', statut: 'en_preparation', feuVert: 'autorise', preparationCompositionVersion: 1, finalMeasurementsVersion: 1, outgoingParcelCount: 1, finalPackages: [{ dimL: 30, dimW: 20, dimH: 20, poids: 3 }] };
const quoted = { ...prepared, statut: 'devis_envoye', devisBrouillon: false, quoteVersion: 1, devisEnvoyeLe: '2026-10-01T08:00:00Z' };
// Six dossiers of the list: what each cell shows is in the comment.
const ROWS = [
  // Prix 100,00 € · Taxes 20,00 € · Poids 3 · 1 colis · 2,4 kg vol. · 2 cartons
  { ...quoted, id: 'A', ref: 'EXP-A', nbColis: 2, devisTotal: 100, devisSnapshot: savedQuote({ om: 10, omr: 5, tva: 5, total: 100 }) },
  // Prix 83,47 € Brouillon · Taxes 12,67 € Brouillon · Poids 3,75 · 2 colis · 1,2 + 12 kg vol. · 1 carton
  { ...prepared, id: 'B', ref: 'EXP-B', nbColis: 1, outgoingParcelCount: 2, finalPackages: [{ dimL: 30, dimW: 20, dimH: 10, poids: 1.25 }, { dimL: 50, dimW: 40, dimH: 30, poids: 2.5 }], devisTotal: 83.47, devisBrouillon: true, quoteVersion: 3, devisSnapshot: savedQuote({ om: 4.1, omr: 1.2, tva: 7.37, total: 83.47 }, 'particulier', 3) },
  // Received only: À calculer, nothing measured · 3 cartons
  { clientId: 'c', id: 'C', ref: 'EXP-C', statut: 'mesure', nbColis: 3 },
  // A former quoted dossier: Prix 50,00 € · Taxes À vérifier · 1 carton
  { ...quoted, id: 'D', ref: 'EXP-D', nbColis: 1, devisTotal: 50 },
  // Professional: Prix 40,00 € · Sans taxes (pro) · 1 carton
  { ...quoted, id: 'E', ref: 'EXP-E', nbColis: 1, devisTotal: 40, devisSnapshot: savedQuote({ om: 0, omr: 0, tva: 0, total: 40 }, 'pro') },
  // Paid 100,00 €: Prix 100,00 € · Taxes 0,10 + 0,20 + 0,30 · 4 cartons
  { ...quoted, id: 'F', ref: 'EXP-F', nbColis: 4, statut: 'paye', devisTotal: 100, devisSnapshot: savedQuote({ om: 0.1, omr: 0.2, tva: 0.3, total: 100 }), paiementMontant: 100, paiementDate: '2026-10-02T08:00:00Z' },
];
const models = new Map(ROWS.map(row => [row.id, buildDossierTableModel(row, { now })]));
const daily = TABLE_COLUMNS.daily, payments = TABLE_COLUMNS.payments;
const pick = (totals, key) => { const { value, known, missing, count, text, note, description } = totals.columns[key]; return { value, known, missing, count, text, note, description }; };

test('the totals add up what the cells show, and say how many dossiers have no value', () => {
  const totals = dossierTableTotals(ROWS, daily, models);
  assert.equal(totals.count, 6);
  assert.deepEqual(Object.keys(totals.columns), ['cartons', 'optimizedDimensions', 'optimizedWeight', 'requested', 'taxes'], 'Text and date columns have no total.');
  assert.deepEqual(pick(totals, 'cartons'), { value: 12, known: 6, missing: 0, count: 6, text: '12', note: '', description: '' });
  // The price: 100 + 83,47 (a draft is shown, so it counts) + 50 + 40 + 100; « À calculer » is left out and counted.
  assert.deepEqual(pick(totals, 'requested'), { value: 373.47, known: 5, missing: 1, count: 6, text: nb('373,47 €'), note: '5 sur 6 dossiers', description: 'Total de 5 dossiers sur 6 ; 1 sans valeur.' });
  // The taxes: 20 + 12,67 + 0 (pro) + 0,60; « À vérifier » and « À calculer » left out.
  assert.deepEqual(pick(totals, 'taxes'), { value: 33.27, known: 4, missing: 2, count: 6, text: nb('33,27 €'), note: '4 sur 6 dossiers', description: 'Total de 4 dossiers sur 6 ; 2 sans valeur.' });
  // Final weight: only the optimised dossiers (all but C), in hundredths as the cells round them.
  assert.deepEqual(pick(totals, 'optimizedWeight'), { value: 15.75, known: 5, missing: 1, count: 6, text: '15,75', note: '5 sur 6 dossiers', description: 'Total de 5 dossiers sur 6 ; 1 sans valeur.' });
  // « Dimensions finales »: the volumetric weight of the parcels counted (L × l × h ÷ 5000), as « … kg vol. »:
  // 2,4 + (1,2 + 12) + 2,4 × 3 is exactly 22,8 (added up in floating point: 22.799999999999997).
  assert.notEqual(2.4 + 1.2 + 12 + 2.4 * 3, 22.8);
  assert.deepEqual(pick(totals, 'optimizedDimensions'), { value: 22.8, known: 5, missing: 1, count: 6, text: nb('22,8 kg vol.'), note: '5 sur 6 dossiers', description: 'Total de 5 dossiers sur 6 ; 1 sans valeur.' });
});

test('totals follow the displayed dossiers: a column filter or a search changes them, a sort never does', () => {
  const all = dossierTableTotals(ROWS, daily, models);
  for (const direction of ['asc', 'desc']) for (const key of ['ref', 'requested', 'taxes', 'optimizedWeight']) {
    const sorted = sortDossierTableRows(ROWS, { column: daily.find(column => column.key === key), direction, models });
    assert.deepEqual(dossierTableTotals(sorted, daily, models), all, `${key} ${direction}`);
  }
  // « Prix du devis » at least 60 €: A, B, F.
  const filtered = filterDossierTableRows(ROWS, { columns: daily, filters: { requested: { mode: 'min', value: '60' } }, models });
  assert.deepEqual(filtered.map(row => row.id), ['A', 'B', 'F']);
  const totals = dossierTableTotals(filtered, daily, models);
  assert.deepEqual([totals.count, totals.columns.requested.value, totals.columns.requested.note, totals.columns.taxes.value, totals.columns.cartons.value], [3, 283.47, '', 33.27, 7]);
  // A search keeps EXP-C and EXP-D: nothing to add up in « Taxes », « Non renseigné », never 0.
  const searched = dossierTableTotals(ROWS.filter(row => ['EXP-C', 'EXP-D'].includes(row.ref)), daily, models);
  assert.deepEqual(pick(searched, 'taxes'), { value: null, known: 0, missing: 2, count: 2, text: TOTAL_UNKNOWN_LABEL, note: '', description: '' });
  assert.equal(TOTAL_UNKNOWN_LABEL, 'Non renseigné');
  assert.deepEqual([searched.columns.requested.value, searched.columns.requested.note], [50, '1 sur 2 dossiers']);
  // A dossier updated in real time: its new model changes the total.
  const updated = new Map(models).set('D', buildDossierTableModel({ ...ROWS[3], devisTotal: 50, devisSnapshot: savedQuote({ om: 2, omr: 1, tva: 1.5, total: 50 }) }, { now }));
  assert.equal(dossierTableTotals(ROWS, daily, updated).columns.taxes.value, 37.77);
});

test('money adds up in cents and weights in hundredths, never drifting', () => {
  const cents = Array.from({ length: 10 }, (_, index) => ({ ...quoted, id: `c${index}`, devisTotal: 0.1, devisSnapshot: savedQuote({ om: 0.01, omr: 0.02, tva: 0.07, total: 0.1 }) }));
  const centModels = new Map(cents.map(row => [row.id, buildDossierTableModel(row, { now })]));
  const totals = dossierTableTotals(cents, daily, centModels);
  assert.equal(totals.columns.requested.value, 1, 'Ten times 0,10 € is 1,00 €.');
  assert.equal(totals.columns.taxes.value, 1);
  const weights = [1.1, 2.2].map((poids, index) => ({ ...prepared, id: `w${index}`, finalPackages: [{ dimL: 10, dimW: 10, dimH: 10, poids }] }));
  const weightTotals = dossierTableTotals(weights, daily, new Map(weights.map(row => [row.id, buildDossierTableModel(row, { now })])));
  assert.equal(weightTotals.columns.optimizedWeight.value, 3.3);
  assert.equal(weightTotals.columns.optimizedWeight.text, '3,3');
  assert.equal(formatDossierTableTotal('money', 1234567.8), nb('1 234 567,80 €'));
  assert.equal(formatDossierTableTotal('count', 1234), nb('1 234'));
});

test('« Dimensions finales » adds each dossier’s volumetric weight with its own divisor, as its cell shows it', () => {
  // The saved quote priced exactly these parcels with 4000; the other dossier uses the settings (6000).
  const quotedParcels = { ...prepared, id: 'q', finalPackages: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3 }], devisSnapshot: { inputs: { volumetricDivisor: 4000, finalPackages: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3 }] }, amounts: { total: 10 } } };
  const plain = { ...prepared, id: 'p', finalPackages: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3 }] };
  const divisors = new Map([quotedParcels, plain].map(row => [row.id, buildDossierTableModel(row, { now, settings: { diviseurVolumetrique: 6000 } })]));
  assert.deepEqual([divisors.get('q').optimizedVolumetricDivisor, divisors.get('p').optimizedVolumetricDivisor], [4000, 6000]);
  const totals = dossierTableTotals([quotedParcels, plain], daily, divisors);
  assert.equal(totals.columns.optimizedDimensions.value, 6 + 4);
  assert.equal(totals.columns.optimizedDimensions.text, nb('10 kg vol.'));
  // Without a valid divisor the cells show the dimensions alone: no volumetric total either.
  const none = new Map([plain].map(row => [row.id, buildDossierTableModel(row, { now, settings: { diviseurVolumetrique: 0 } })]));
  assert.equal(dossierTableTotals([plain], daily, none).columns.optimizedDimensions.text, TOTAL_UNKNOWN_LABEL);
});

test('a role without the amounts gets no financial total: the totals cover the columns shown', () => {
  const shown = daily.filter(column => !column.financial);
  const totals = dossierTableTotals(ROWS, shown, models);
  assert.deepEqual(Object.keys(totals.columns), ['cartons', 'optimizedDimensions', 'optimizedWeight']);
  // A column hidden by the person has no total either.
  assert.deepEqual(Object.keys(dossierTableTotals(ROWS, daily.filter(column => column.key !== 'cartons'), models).columns), ['optimizedDimensions', 'optimizedWeight', 'requested', 'taxes']);
  // « Paiements »: requested, taxes, paid and left to pay.
  const paymentTotals = dossierTableTotals(ROWS, payments, models);
  assert.deepEqual(Object.keys(paymentTotals.columns), ['requested', 'taxes', 'paid', 'remaining']);
  // Requested: the sent quotes A, D, E and the paid F; paid: F's 100 € and nothing recorded elsewhere.
  assert.deepEqual([paymentTotals.columns.requested.value, paymentTotals.columns.requested.known, paymentTotals.columns.paid.value, paymentTotals.columns.remaining.value], [290, 4, 100, 190]);
  // No dossier, or no column that adds up: nothing to show.
  assert.equal(hasDossierTableTotals(dossierTableTotals([], daily, models)), false);
  assert.equal(hasDossierTableTotals(dossierTableTotals(ROWS, daily.filter(column => !['cartons', 'optimizedDimensions', 'optimizedWeight', 'requested', 'taxes'].includes(column.key)), models)), false);
  assert.equal(hasDossierTableTotals(totalsOf(ROWS)), true);
});
const totalsOf = rows => dossierTableTotals(rows, daily, models);

test('the labels: « Total · 12 dossiers », filtered, a subtotal, and the cards', () => {
  assert.equal(dossierTableTotalLabel(12), 'Total · 12 dossiers');
  assert.equal(dossierTableTotalLabel(1), 'Total · 1 dossier');
  assert.equal(dossierTableTotalLabel(12, { filtered: true }), 'Total des 12 dossiers filtrés');
  assert.equal(dossierTableTotalLabel(1, { filtered: true }), 'Total du dossier filtré');
  assert.equal(dossierTableTotalLabel(1234), nb('Total · 1 234 dossiers'));
  assert.equal(dossierTableSubtotalLabel(3), 'Sous-total · 3 dossiers');
  assert.equal(dossierTableSubtotalLabel(1), 'Sous-total · 1 dossier');
  assert.equal(dossierCardTotalLabel(12), 'Total des 12 dossiers');
  assert.equal(dossierCardTotalLabel(12, { filtered: true }), 'Total des 12 dossiers filtrés');
  assert.equal(dossierCardTotalLabel(1), 'Total du dossier');
});

test('the cards’ group subtotal: short labels in column order, the weight with its unit, the same notes', () => {
  const items = dossierTableTotalSummary(totalsOf(ROWS), daily);
  assert.deepEqual(items.map(item => [item.label, item.text, item.note]), [
    ['Cartons', '12', ''], ['Dimensions', nb('22,8 kg vol.'), '5 sur 6 dossiers'], ['Poids', nb('15,75 kg'), '5 sur 6 dossiers'],
    ['Prix', nb('373,47 €'), '5 sur 6 dossiers'], ['Taxes', nb('33,27 €'), '4 sur 6 dossiers'],
  ]);
  const none = dossierTableTotalSummary(dossierTableTotals([ROWS[2]], daily, models), daily);
  assert.deepEqual(none.filter(item => !item.known).map(item => [item.label, item.text]), [['Dimensions', TOTAL_UNKNOWN_LABEL], ['Poids', TOTAL_UNKNOWN_LABEL], ['Prix', TOTAL_UNKNOWN_LABEL], ['Taxes', TOTAL_UNKNOWN_LABEL]]);
});

test('the spreadsheet writes a number exactly where the totals count one', () => {
  for (const view of ['daily', 'payments', 'departures']) {
    const { rows, columns } = buildDossierTableExport(ROWS, [], models, view, TABLE_COLUMNS[view]);
    const totals = dossierTableTotals(ROWS, TABLE_COLUMNS[view], models);
    for (const column of columns.filter(item => totals.columns[item.key] && item.key !== 'optimizedDimensions')) {
      const numbers = rows.map(row => row[column.label]).filter(value => typeof value === 'number');
      assert.equal(numbers.length, totals.columns[column.key].known, `${view} ${column.key}`);
      assert.equal(Math.round(numbers.reduce((sum, value) => sum + value * 100, 0)) / 100, totals.columns[column.key].value ?? 0, `${view} ${column.key}`);
      ROWS.forEach((row, index) => assert.equal(typeof rows[index][column.label] === 'number', dossierTableNumber(column, { dossier: row, model: models.get(row.id) }) !== null));
    }
  }
});
