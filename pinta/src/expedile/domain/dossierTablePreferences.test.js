import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_COLUMNS, buildDossierTableModel, buildDossierTableExportRows, sortDossierTableRows } from './dossierTable.js';
import { clampColumnWidth, columnWidthBounds, columnWidthsStorageKey, columnVisibilityStorageKey, dossierTextSizeStorageKey, dossierLayoutStorageKey, sanitizeDossierTextSize, sanitizeDossierTableLayout, DOSSIER_TEXT_SIZE_BOUNDS, DOSSIER_TOUCH_TEXT_SIZE, sanitizeHiddenColumns, readColumnFilters, filterDossierTableRows, sanitizeColumnFilter, columnFilterModes, sanitizeColumnWidths, dossierColumnSuggestions, requiredTableColumn, tableTextSizeInitial, DOSSIER_GROUPINGS, defaultDossierGrouping, sanitizeDossierGrouping, resolveDossierGrouping, dossierGroupingStorageKey, sanitizeNoDeparturePlacement, noDeparturePlacementStorageKey, HEADING_CHROME, headingWidthFloors, flooredColumnWidths, visibleTableColumnKeys } from './dossierTablePreferences.js';
import { WORK_TABLE_CHOICES } from './workTable.js';

const columns = TABLE_COLUMNS.daily;
const column = key => columns.find(item => item.key === key);
const filter = (mode, value = '') => ({ mode, value });
const now = Date.parse('2026-10-03T12:00:00Z');
const received = { id: 'received', clientId: 'c', ref: 'EXP-RECU', statut: 'mesure', nbColis: 1, cartonsReception: [{ dimL: 99, dimW: 98, dimH: 97, poids: 8 }], casier: 'A1' };
const prepared = { ...received, id: 'prepared', ref: 'EXP-PREP', statut: 'en_preparation', feuVert: 'autorise', outgoingParcelCount: 2, preparationCompositionVersion: 3, finalMeasurementsVersion: 3, finalPackages: [{ dimL: 10.5, dimW: 20, dimH: 30, poids: 2 }, { dimL: 40, dimW: 50, dimH: 60, poids: 3 }], casier: '' };
const stale = { ...prepared, id: 'stale', ref: 'EXP-STALE', preparationCompositionVersion: 4, casier: 'B2' };
const data = [received, prepared, stale];
const models = new Map(data.map(dossier => [dossier.id, buildDossierTableModel(dossier, { now })]));
const apply = filters => filterDossierTableRows(data, { columns, filters, models }).map(item => item.id);

test('optimized dimensions show every certified outgoing box, never received or stale dimensions', () => {
  assert.deepEqual(models.get('prepared').optimizedDimensions, ['Colis 1 : 10,5 × 20 × 30 cm', 'Colis 2 : 40 × 50 × 60 cm']);
  for (const id of ['received', 'stale']) assert.deepEqual(models.get(id).optimizedDimensions, []);
  const exported = buildDossierTableExportRows(data, [], models, 'daily', columns);
  assert.equal(exported[0]['Dimensions finales'], '');
  assert.equal(exported[2]['Dimensions finales'], '');
  assert.match(exported[1]['Dimensions finales'], /Colis 2 : 40 × 50 × 60 cm/);
  // The export carries the cell's volumetric weights (divisor 5000 by default) and their total.
  assert.equal(exported[1]['Dimensions finales'], 'Colis 1 : 10,5 × 20 × 30 cm · 1,26\u00a0kg vol.\nColis 2 : 40 × 50 × 60 cm · 24\u00a0kg vol.\nTotal : 25,26\u00a0kg vol.');
  // « Contient » finds the volumetric text shown in the cell.
  assert.deepEqual(apply({ optimizedDimensions: filter('contains', '25,26 kg vol') }), ['prepared']);
  for (const direction of ['asc', 'desc']) assert.equal(sortDossierTableRows(data, { column: column('optimizedDimensions'), direction, models })[0].id, 'prepared');
});

test('« Paiement » is filtered on one exact value: « Payé » never keeps « Non payé »', () => {
  const quoted = { ...prepared, statut: 'devis_envoye', devisTotal: 100, devisBrouillon: false, quoteVersion: 1, devisEnvoyeLe: '2026-10-01T10:00:00Z' };
  const rows = [
    { ...quoted, id: 'paid', statut: 'paye', paiementMontant: 100, paiementDate: '2026-10-02T10:00:00Z' },
    { ...quoted, id: 'unpaid' },
    { ...quoted, id: 'partial', statut: 'paye', paiementMontant: 30, paiementDate: '2026-10-02T10:00:00Z' },
  ];
  const projection = new Map(rows.map(dossier => [dossier.id, buildDossierTableModel(dossier, { now })]));
  const payment = column('paymentState');
  const run = value => filterDossierTableRows(rows, { columns, filters: { paymentState: { mode: 'is', value } }, models: projection }).map(item => item.id);
  assert.deepEqual(columnFilterModes(payment).map(mode => mode.key), ['is', 'empty', 'filled']);
  assert.deepEqual(sanitizeColumnFilter(payment, filter('filled')), { mode: 'filled', value: '' });
  assert.deepEqual(run('Payé'), ['paid']);
  assert.deepEqual(run('Non payé'), ['unpaid', 'partial']);
  // An older shared link keeps its meaning only when it names one value exactly.
  assert.deepEqual(sanitizeColumnFilter(payment, filter('contains', 'payé')), { mode: 'is', value: 'Payé' });
  assert.equal(sanitizeColumnFilter(payment, filter('contains', 'partiel')), null);
  assert.equal(sanitizeColumnFilter(payment, filter('is', 'Remboursé')), null);
});

test('status and payment are distinct from the selected task and never call partial cash paid', () => {
  const dossier = { ...prepared, statut: 'paye', devisTotal: 100, devisBrouillon: false, quoteVersion: 1, paiementMontant: 30, paiementDate: '2026-10-02T10:00:00Z' };
  const row = buildDossierTableModel(dossier, { now });
  assert.equal(row.payment.stateLabel, 'Non payé'); assert.equal(row.payment.detailLabel, 'Paiement partiel');
  assert.equal(row.statusLabel, 'Paiement partiel');
  const zero = buildDossierTableModel({ ...dossier, statut: 'devis_envoye', paiementMontant: 0, paiementDate: null }, { now });
  assert.equal(zero.payment.stateLabel, 'À vérifier'); assert.equal(zero.payment.detailLabel, 'Paiement à vérifier');
  assert.equal(zero.payment.paid, null);
});

test('column filters combine with AND without changing the source scope or models', () => {
  const before = JSON.stringify([data, [...models]]);
  assert.deepEqual(apply({ statusLabel: filter('contains', 'PREPARATION'), casier: filter('contains', 'B2') }), ['stale']);
  assert.deepEqual(apply({ optimizedDimensions: filter('filled'), ref: filter('contains', 'prep') }), ['prepared']);
  assert.deepEqual(apply({ optimizedDimensions: filter('empty') }), ['received', 'stale']);
  assert.deepEqual(apply({ casier: filter('contains', 'a renseigner') }), ['prepared']);
  assert.deepEqual(apply({ casier: filter('empty') }), ['prepared']);
  assert.equal(JSON.stringify([data, [...models]]), before);
});

test('unknown, hidden finance, action and malformed filters never hide rows', () => {
  const params = new URLSearchParams({ 'col.requested': JSON.stringify(filter('min', '100')), 'col.action': JSON.stringify(filter('contains', 'Consulter')), 'col.ref': '{broken', 'col.casier': JSON.stringify(filter('contains', 'A1')) });
  const authorizedColumns = columns.filter(item => !item.financial);
  assert.deepEqual(readColumnFilters(params, authorizedColumns), { casier: filter('contains', 'A1') });
  assert.deepEqual(filterDossierTableRows(data, { columns: authorizedColumns, models, filters: { requested: filter('min', '100'), action: filter('contains', 'Non attribué') } }).map(item => item.id), ['received', 'prepared', 'stale']);
  assert.equal(sanitizeColumnFilter(column('cartons'), filter('min', 'invalid')), null);
  assert.equal(sanitizeColumnFilter(TABLE_COLUMNS.payments.find(item => item.key === 'sentAt'), filter('min', '2026-02-30')), null);
});

test('numeric bounds support French decimals and real zero; date bounds use Réunion calendar day', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const projection = new Map([['a', { payment: { paid: 0, sentAt: '2026-10-02T22:30:00Z' } }], ['b', { payment: { paid: 10.5, sentAt: '2026-10-02T10:00:00Z' } }], ['c', { payment: { paid: null, sentAt: null } }]]);
  const run = filters => filterDossierTableRows(rows, { columns: TABLE_COLUMNS.payments, filters, models: projection }).map(item => item.id);
  assert.deepEqual(run({ paid: filter('max', '0') }), ['a']);
  assert.deepEqual(run({ paid: filter('min', '10,5') }), ['b']);
  assert.deepEqual(run({ paid: filter('empty') }), ['c']);
  assert.deepEqual(run({ sentAt: filter('min', '2026-10-03') }), ['a']);
  assert.deepEqual(run({ sentAt: filter('contains', '03/10/2026') }), ['a']);
});

test('suggestions use only supplied authorized scope, preserving displayed missing-owner wording', () => {
  const projection = new Map([['received', { ownerName: 'Non attribué' }], ['prepared', { ownerName: 'Vous' }], ['stale', { ownerName: 'Colleague secret' }]]);
  assert.deepEqual(dossierColumnSuggestions(data.slice(0, 2), column('owner'), { models: projection }), ['Non attribué', 'Vous']);
  assert.deepEqual(filterDossierTableRows(data, { columns, filters: { owner: filter('contains', 'non attribue') }, models: projection }).map(item => item.id), ['received']);
});

test('width preferences isolate user/view and bound corrupt or unsupported values', () => {
  assert.notEqual(columnWidthsStorageKey('one', 'daily'), columnWidthsStorageKey('two', 'daily'));
  assert.notEqual(columnWidthsStorageKey('one', 'daily'), columnWidthsStorageKey('one', 'payments'));
  assert.equal(columnWidthsStorageKey(null, 'daily'), null);
  assert.equal(columnWidthsStorageKey('one', 'unknown'), null);
  assert.equal(clampColumnWidth(column('ref'), 999999), 600);
  assert.equal(clampColumnWidth(column('ref'), -5), 96);
  assert.equal(clampColumnWidth(column('ref'), 'invalid'), 140);
  assert.equal(clampColumnWidth(column('action'), 600), 280);
  assert.equal(clampColumnWidth(column('optimizedDimensions'), 5), 110);
  assert.equal(clampColumnWidth(column('cartons'), 5), 64);
  assert.equal(clampColumnWidth(column('client'), 5), 96);
  const values = sanitizeColumnWidths(columns.filter(item => !item.financial), { ref: 220, requested: 400, action: 20, client: Infinity });
  assert.equal(values.ref, 220); assert.equal(values.client, 180); assert.equal(values.action, 132);
  assert.equal(values.requested, undefined);
});

test('visibility isolates user and view, keeps only reference mandatory and admits future columns by default', () => {
  assert.notEqual(columnVisibilityStorageKey('one', 'daily'), columnVisibilityStorageKey('two', 'daily'));
  assert.notEqual(columnVisibilityStorageKey('one', 'daily'), columnVisibilityStorageKey('one', 'departures'));
  assert.notEqual(columnVisibilityStorageKey('one', 'daily'), columnWidthsStorageKey('one', 'daily'));
  assert.equal(columnVisibilityStorageKey(null, 'daily'), null);
  const hidden = sanitizeHiddenColumns(columns, ['ref', 'client', 'action', 'client', 'unknown', 'paid']);
  assert.deepEqual(hidden, ['client', 'action']);
  assert.deepEqual(sanitizeHiddenColumns(columns, 'invalid'), []);
  const future = { key: 'future', label: 'Future' };
  assert.equal(sanitizeHiddenColumns([...columns, future], hidden).includes('future'), false);
  assert.deepEqual(sanitizeHiddenColumns(columns, columns.map(item => item.key)), columns.filter(item => item.key !== 'ref').map(item => item.key));
});

test('hidden columns cannot filter or export values, while visible columns retain combined filters', () => {
  const hidden = sanitizeHiddenColumns(columns, ['client', 'action', 'paymentState', 'optimizedDimensions']);
  const visible = columns.filter(item => !hidden.includes(item.key));
  const params = new URLSearchParams({ 'col.paymentState': JSON.stringify(filter('contains', 'Payé')), 'col.casier': JSON.stringify(filter('contains', 'A1')) });
  const filters = readColumnFilters(params, visible);
  assert.deepEqual(filters, { casier: filter('contains', 'A1') });
  const selected = filterDossierTableRows(data, { columns: visible, filters, models });
  assert.deepEqual(selected.map(item => item.id), ['received']);
  const exported = buildDossierTableExportRows(selected, [], models, 'daily', visible);
  assert.equal(exported[0].Référence, 'EXP-RECU');
  for (const label of ['Client', 'Action', 'Paiement', 'Dimensions finales']) assert.equal(Object.hasOwn(exported[0], label), false);
});

test('text size accepts every integer from 11 to 20, preserves legacy choices, and isolates each preference', () => {
  assert.deepEqual(DOSSIER_TEXT_SIZE_BOUNDS, { min: 11, max: 20, initial: 12 });
  for (let size = 11; size <= 20; size += 1) assert.equal(sanitizeDossierTextSize(size), size);
  for (const previous of [14, 16, 18]) assert.equal(sanitizeDossierTextSize(previous), previous);
  // A size saved under the former 5px minimum now reads at 11px.
  for (const tiny of [0, 5, 9, 10]) assert.equal(sanitizeDossierTextSize(tiny), 11);
  assert.equal(sanitizeDossierTextSize(100), 20);
  assert.equal(sanitizeDossierTextSize(12.2), 12);
  for (const invalid of [null, undefined, '', '18', {}, Infinity, NaN]) assert.equal(sanitizeDossierTextSize(invalid), 12);
  const key = dossierTextSizeStorageKey('one', 'daily');
  assert.notEqual(key, dossierTextSizeStorageKey('two', 'daily'));
  assert.notEqual(key, dossierTextSizeStorageKey('one', 'payments'));
  assert.notEqual(key, columnWidthsStorageKey('one', 'daily'));
  assert.notEqual(key, columnVisibilityStorageKey('one', 'daily'));
  assert.equal(dossierTextSizeStorageKey(null, 'daily'), null);
  assert.equal(dossierTextSizeStorageKey('one', 'unknown'), null);
});

test('cards or table is one choice for the whole dossier list, per person, and safely defaults to automatic', () => {
  for (const layout of ['auto', 'table', 'cards']) assert.equal(sanitizeDossierTableLayout(layout), layout);
  for (const invalid of ['grid', '', null, undefined, {}, 0]) assert.equal(sanitizeDossierTableLayout(invalid), 'auto');
  const key = dossierLayoutStorageKey('one', 'daily');
  assert.notEqual(key, dossierLayoutStorageKey('two', 'daily'));
  // The four tabs share it; it is the key « Travail quotidien » always used, so an earlier choice stays.
  for (const view of ['payments', 'departures', 'accords']) assert.equal(dossierLayoutStorageKey('one', view), key, view);
  assert.equal(key, 'expedile:table-layout:v1:one:daily');
  assert.notEqual(dossierLayoutStorageKey('one', 'work'), key, 'Mon travail keeps its own.');
  for (const other of [columnWidthsStorageKey, columnVisibilityStorageKey, dossierTextSizeStorageKey]) assert.notEqual(key, other('one', 'daily'));
  assert.equal(dossierLayoutStorageKey(null, 'daily'), null);
  assert.equal(dossierLayoutStorageKey('one', 'unknown'), null);
});

test('Mon travail keeps its own preferences, its task column required and a 15px reading size', () => {
  for (const key of [dossierTextSizeStorageKey, dossierLayoutStorageKey, columnWidthsStorageKey, columnVisibilityStorageKey]) {
    assert.match(key('one', 'work'), /:work$/);
    assert.notEqual(key('one', 'work'), key('two', 'work'));
    for (const view of ['daily', 'payments', 'departures', 'accords']) assert.notEqual(key('one', 'work'), key('one', view));
    assert.equal(key(null, 'work'), null);
    assert.equal(key('one', 'unknown'), null);
  }
  // « Accords clients » keeps its own widths, columns and text size (the layout is one choice for the list).
  for (const key of [dossierTextSizeStorageKey, columnWidthsStorageKey, columnVisibilityStorageKey]) { assert.match(key('one', 'accords'), /:accords$/);assert.notEqual(key('one', 'accords'), key('one', 'daily')); }
  assert.equal(requiredTableColumn('work'), 'task');
  for (const view of ['daily', 'payments', 'departures', 'unknown']) assert.equal(requiredTableColumn(view), 'ref');
  assert.deepEqual(sanitizeHiddenColumns(WORK_TABLE_CHOICES, ['task', 'casier', 'action', 'ref'], 'task'), ['ref', 'casier']);
  assert.deepEqual(sanitizeHiddenColumns(WORK_TABLE_CHOICES, WORK_TABLE_CHOICES.map(item => item.key), 'task'), ['due', 'ref', 'client', 'casier', 'cartons']);
  assert.deepEqual(sanitizeHiddenColumns(columns, ['ref', 'client']), ['client'], 'The dossier reference stays the default requirement.');
  assert.equal(tableTextSizeInitial('work'), 15);
  // Without a browser (no touch, no narrow window) the computer size applies.
  for (const view of ['daily', 'payments', 'departures', 'accords']) assert.equal(tableTextSizeInitial(view), DOSSIER_TEXT_SIZE_BOUNDS.initial);
  // A touch screen or a window under 1024px opens the dossier list at 14px; Mon travail keeps 15px.
  for (const view of ['daily', 'payments', 'departures', 'accords']) assert.equal(tableTextSizeInitial(view, { touch: true }), DOSSIER_TOUCH_TEXT_SIZE);
  assert.equal(DOSSIER_TOUCH_TEXT_SIZE, 14);assert.equal(tableTextSizeInitial('work', { touch: true }), 15);
  assert.equal(sanitizeDossierTextSize(undefined, tableTextSizeInitial('daily', { touch: true })), 14);
  assert.equal(sanitizeDossierTextSize(9, tableTextSizeInitial('daily', { touch: true })), 11, 'A saved size wins over the default, within the bounds.');
  assert.equal(sanitizeDossierTextSize(undefined, tableTextSizeInitial('work')), 15);
  assert.equal(sanitizeDossierTextSize(18, tableTextSizeInitial('work')), 18);
  assert.equal(sanitizeDossierTextSize(40, tableTextSizeInitial('work')), 20);
  assert.equal(sanitizeDossierTextSize('15'), 12);
});

test('grouping opens by departure in « Départs », by client in « Accords clients », and an explicit URL view wins over the stored choice', () => {
  assert.deepEqual(DOSSIER_GROUPINGS, ['none', 'statut', 'envoi', 'client']);
  assert.equal(defaultDossierGrouping('departures'), 'envoi');
  assert.equal(defaultDossierGrouping('accords'), 'client');
  for (const view of ['daily', 'payments', 'work', 'unknown']) assert.equal(defaultDossierGrouping(view), 'none');
  for (const grouping of DOSSIER_GROUPINGS) assert.equal(sanitizeDossierGrouping(grouping, 'daily'), grouping);
  for (const invalid of ['priority', '', null, undefined, {}, 'ENVOI', 'CLIENT']) {
    assert.equal(sanitizeDossierGrouping(invalid, 'departures'), 'envoi');
    assert.equal(sanitizeDossierGrouping(invalid, 'accords'), 'client');
    assert.equal(sanitizeDossierGrouping(invalid, 'daily'), 'none');
  }
  assert.equal(resolveDossierGrouping(null, null, 'accords'), 'client');
  assert.equal(resolveDossierGrouping('none', 'client', 'accords'), 'none', 'A shared link without grouping keeps it.');
  assert.equal(resolveDossierGrouping('client', null, 'daily'), 'client', '« Par client » is offered in every tab.');
  assert.equal(resolveDossierGrouping('statut', 'envoi', 'departures'), 'statut', 'A shared link keeps its grouping.');
  assert.equal(resolveDossierGrouping('none', 'envoi', 'daily'), 'none');
  assert.equal(resolveDossierGrouping(null, 'envoi', 'daily'), 'envoi', 'Without a URL view, the stored choice applies.');
  assert.equal(resolveDossierGrouping(null, null, 'departures'), 'envoi');
  assert.equal(resolveDossierGrouping('priority', null, 'payments'), 'none', 'An unknown URL value never forces a grouping.');
});

test('grouping and « Dossiers sans départ » are stored per person and per list tab, apart from other preferences', () => {
  for (const key of [dossierGroupingStorageKey, noDeparturePlacementStorageKey]) {
    assert.notEqual(key('one', 'daily'), key('two', 'daily'));
    assert.notEqual(key('one', 'daily'), key('one', 'departures'));
    assert.notEqual(key('one', 'daily'), key('one', 'payments'));
    assert.match(key('one', 'accords'), /:accords$/);assert.notEqual(key('one', 'accords'), key('one', 'departures'));
    for (const other of [columnWidthsStorageKey, columnVisibilityStorageKey, dossierTextSizeStorageKey, dossierLayoutStorageKey]) assert.notEqual(key('one', 'daily'), other('one', 'daily'));
    assert.equal(key(null, 'daily'), null);
    assert.equal(key('one', 'work'), null, 'Mon travail has no grouping.');
    assert.equal(key('one', 'unknown'), null);
  }
  assert.notEqual(dossierGroupingStorageKey('one', 'daily'), noDeparturePlacementStorageKey('one', 'daily'));
  assert.equal(sanitizeNoDeparturePlacement('top'), 'top');
  for (const value of ['bottom', 'TOP', '', null, undefined, 1]) assert.equal(sanitizeNoDeparturePlacement(value), 'bottom');
});

test('« Accord » is filtered on one exact state, and the consent dates on their real days', () => {
  const rows = [
    { id: 'waiting', statut: 'attente_feu_vert', attenteClientDate: '2026-10-01T08:00:00Z', demandeFeuVertEnvoyeeAt: '2026-09-30T08:00:00Z' },
    { id: 'submit', statut: 'mesure' },
    { id: 'awaited', statut: 'attente_feu_vert', demandeFeuVertEnvoyeeAt: '2026-10-02T21:30:00Z', messages: [{ template: 'relance_feu_vert', statut: 'envoye', createdAt: '2026-10-03T09:00:00Z' }] },
  ];
  const accords = TABLE_COLUMNS.accords, consent = accords.find(item => item.key === 'consentState');
  const run = filters => filterDossierTableRows(rows, { columns: accords, filters, models: new Map() }).map(item => item.id);
  assert.deepEqual(columnFilterModes(consent).map(mode => mode.key), ['is', 'empty', 'filled']);
  assert.deepEqual(run({ consentState: filter('is', 'Le client attend') }), ['waiting']);
  assert.deepEqual(run({ consentState: filter('is', 'Réponse attendue') }), ['awaited']);
  assert.deepEqual(run({ consentState: filter('is', 'À soumettre') }), ['submit']);
  assert.deepEqual(sanitizeColumnFilter(consent, filter('contains', 'le client attend')), filter('is', 'Le client attend'));
  assert.equal(sanitizeColumnFilter(consent, filter('is', 'Accord donné')), null, 'Only the three states can be chosen.');
  assert.deepEqual(run({ consentRequestedAt: filter('min', '2026-10-03') }), ['awaited'], 'The request of 2 October 21:30 UTC is on 3 October in Réunion.');
  assert.deepEqual(run({ consentRequestedAt: filter('empty') }), ['submit']);
  assert.deepEqual(run({ lastRelanceAt: filter('filled') }), ['awaited']);
  assert.deepEqual(run({ lastRelanceAt: filter('contains', '03/10/2026') }), ['awaited']);
  assert.deepEqual(dossierColumnSuggestions(rows, consent, { models: new Map() }), ['À soumettre', 'Le client attend', 'Réponse attendue']);
});

test('the default widths keep every heading whole with a wide fallback font, a few pixels to spare', () => {
  // Verdana at 12px measured 106, 70, 89 and 78px; a heading keeps 43px for its padding and filter button.
  const room = key => columnWidthBounds({ key }).initial - 43;
  for (const [key, text] of [['owner', 106], ['optimizedWeight', 70], ['sentAt', 89], ['destination', 78]]) assert.ok(room(key) >= text + 6, `${key}: ${room(key)} >= ${text + 6}`);
});

test('a column is never drawn narrower than its heading: the words, the sort arrow and the filter', () => {
  // A fixed-width fake font: 7 px per character.
  const measure = text => text.length * 7;
  // A touch screen shows every idle sort arrow: « Casier » (6 characters) sorts and filters, 42 px of words and 58 px around them.
  const touch = headingWidthFloors(columns, measure);
  assert.equal(touch.casier, 42 + HEADING_CHROME.sortable);
  // « Cartons reçus » shows its short label, « Cartons ».
  assert.equal(touch.cartons, 7 * 7 + HEADING_CHROME.sortable);
  // « Action » has neither sort nor filter: its padding and border only.
  assert.equal(touch.action, 6 * 7 + HEADING_CHROME.plain);
  assert.deepEqual(Object.keys(touch), columns.map(item => item.key));
  // With a mouse an idle arrow shows on hover only: at rest the heading needs 15 px less, except the sorted column's.
  const mouse = headingWidthFloors(columns, measure, { arrows: false, sortedKey: 'cartons' });
  assert.equal(mouse.casier, 42 + HEADING_CHROME.sortable - HEADING_CHROME.arrow);
  assert.equal(mouse.cartons, touch.cartons);
  assert.equal(mouse.action, touch.action);
  // The default widths stay as designed at 12 px with a mouse: no floor above them with a 7 px font.
  assert.ok(columns.every(item => mouse[item.key] <= columnWidthBounds(item).initial || item.key === 'cartons'));
  // A fractional measure rounds up: the heading never loses its last pixel.
  assert.equal(headingWidthFloors([column('casier')], () => 37.2).casier, 38 + HEADING_CHROME.sortable);
  // An unusable measure (no canvas, no font) leaves the saved widths alone.
  for (const value of [0, NaN, undefined, -3]) assert.equal(headingWidthFloors([column('casier')], () => value).casier, 0);
  assert.deepEqual(headingWidthFloors(null, measure), {});
  // Saved widths apply above the floors, never under them; a column without a floor keeps its width.
  const saved = sanitizeColumnWidths(columns, { casier: 64, owner: 300 });
  const drawn = flooredColumnWidths(saved, { casier: 100, owner: 120 });
  assert.equal(drawn.casier, 100); assert.equal(drawn.owner, 300); assert.equal(drawn.client, saved.client);
  assert.deepEqual(flooredColumnWidths(saved), saved);
  assert.equal(saved.casier, 64, 'The saved preference itself is unchanged.');
});

test('choices saved before « Taxes à l’importation estimées » existed show it in its place until the person hides it', () => {
  // What a person stored on 7 October: two hidden columns, their widths, no « taxes » anywhere.
  const before = { daily: ['casier', 'owner'], payments: ['sentAt'], departures: ['destination', 'readiness'] };
  const savedWidths = { ref: 200, requested: 160, cartons: 90 };
  for (const [view, stored] of Object.entries(before)) {
    const viewColumns = TABLE_COLUMNS[view];
    const hidden = sanitizeHiddenColumns(viewColumns, JSON.parse(JSON.stringify(stored)));
    assert.deepEqual([...hidden].sort(), [...stored].sort(), `${view}: the saved choices are kept.`);
    const shown = visibleTableColumnKeys(viewColumns, hidden);
    // After « Prix du devis » and its transport, or after « Demandé » and its transport in « Paiements ».
    assert.deepEqual(shown.slice(shown.indexOf('requested'), shown.indexOf('requested') + 3), ['requested', 'transport', 'taxes'], `${view}: right after the price and its transport.`);
    assert.deepEqual(shown, viewColumns.map(column => column.key).filter(key => !stored.includes(key)), `${view}: every other column keeps its order.`);
    // Hidden afterwards, it stays hidden; shown again, it comes back in its place.
    const hiddenAfter = sanitizeHiddenColumns(viewColumns, [...hidden, 'taxes']);
    assert.equal(visibleTableColumnKeys(viewColumns, hiddenAfter).includes('taxes'), false);
    assert.deepEqual(visibleTableColumnKeys(viewColumns, hiddenAfter.filter(key => key !== 'taxes')), shown);
    // Saved widths are kept; the new column opens at its own width.
    const widthsAfter = sanitizeColumnWidths(viewColumns, savedWidths);
    assert.equal(widthsAfter.ref, 200); assert.equal(widthsAfter.requested, 160);
    assert.equal(widthsAfter.taxes, columnWidthBounds({ key: 'taxes' }).initial);
    assert.equal(widthsAfter.taxes, 130);
  }
  assert.equal(visibleTableColumnKeys(TABLE_COLUMNS.accords, []).includes('taxes'), false);
  assert.deepEqual(visibleTableColumnKeys(null, null), []);
});

test('choices saved before « Transport » existed show it in its place, between the price and the taxes, until the person hides it', () => {
  // What a person stored on 8 October: hidden columns (« Taxes à l’importation estimées » among them in one view), widths, no « transport » anywhere.
  const before = { daily: ['casier', 'owner'], payments: ['sentAt', 'taxes'], departures: ['destination', 'readiness'] };
  const savedWidths = { ref: 200, requested: 160, taxes: 150, cartons: 90 };
  for (const [view, stored] of Object.entries(before)) {
    const viewColumns = TABLE_COLUMNS[view];
    const hidden = sanitizeHiddenColumns(viewColumns, JSON.parse(JSON.stringify(stored)));
    assert.deepEqual([...hidden].sort(), [...stored].sort(), `${view}: the saved choices are kept.`);
    const shown = visibleTableColumnKeys(viewColumns, hidden);
    assert.equal(shown[shown.indexOf('requested') + 1], 'transport', `${view}: right after the price.`);
    assert.equal(shown.includes('taxes'), !stored.includes('taxes'), `${view}: hidden taxes stay hidden.`);
    assert.deepEqual(shown, viewColumns.map(column => column.key).filter(key => !stored.includes(key)), `${view}: every other column keeps its order.`);
    // Hidden afterwards, it stays hidden; shown again, it comes back in its place.
    const hiddenAfter = sanitizeHiddenColumns(viewColumns, [...hidden, 'transport']);
    assert.equal(visibleTableColumnKeys(viewColumns, hiddenAfter).includes('transport'), false);
    assert.deepEqual(visibleTableColumnKeys(viewColumns, hiddenAfter.filter(key => key !== 'transport')), shown);
    // Saved widths are kept; the new column opens at its own width.
    const widthsAfter = sanitizeColumnWidths(viewColumns, savedWidths);
    assert.deepEqual([widthsAfter.ref, widthsAfter.requested, widthsAfter.taxes], [200, 160, 150]);
    assert.equal(widthsAfter.transport, columnWidthBounds({ key: 'transport' }).initial);
    assert.equal(widthsAfter.transport, 130);
  }
  assert.equal(visibleTableColumnKeys(TABLE_COLUMNS.accords, []).includes('transport'), false);
});
