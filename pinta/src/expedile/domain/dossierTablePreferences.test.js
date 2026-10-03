import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_COLUMNS, buildDossierTableModel, buildDossierTableExportRows, sortDossierTableRows } from './dossierTable.js';
import { clampColumnWidth, columnWidthsStorageKey, columnVisibilityStorageKey, sanitizeHiddenColumns, readColumnFilters, filterDossierTableRows, sanitizeColumnFilter, sanitizeColumnWidths, dossierColumnSuggestions } from './dossierTablePreferences.js';

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
  assert.equal(exported[0]['Dimensions optimisées'], '');
  assert.equal(exported[2]['Dimensions optimisées'], '');
  assert.match(exported[1]['Dimensions optimisées'], /Colis 2 : 40 × 50 × 60 cm/);
  for (const direction of ['asc', 'desc']) assert.equal(sortDossierTableRows(data, { column: column('optimizedDimensions'), direction, models })[0].id, 'prepared');
});

test('status and payment are distinct from the selected task and never call partial cash paid', () => {
  const dossier = { ...prepared, statut: 'paye', devisTotal: 100, devisBrouillon: false, quoteVersion: 1, paiementMontant: 30, paiementDate: '2026-10-02T10:00:00Z' };
  const row = buildDossierTableModel(dossier, { now });
  assert.equal(row.payment.stateLabel, 'Paiement partiel');
  assert.equal(row.statusLabel, 'Paiement partiel');
  const zero = buildDossierTableModel({ ...dossier, statut: 'devis_envoye', paiementMontant: 0, paiementDate: null }, { now });
  assert.equal(zero.payment.stateLabel, 'Paiement à vérifier');
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
  assert.deepEqual(readColumnFilters(params, columns), { casier: filter('contains', 'A1') });
  assert.deepEqual(apply({ requested: filter('min', '100'), action: filter('contains', 'Non attribué') }), ['received', 'prepared', 'stale']);
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
  assert.equal(clampColumnWidth(column('ref'), -5), 140);
  assert.equal(clampColumnWidth(column('ref'), 'invalid'), 160);
  assert.equal(clampColumnWidth(column('action'), 600), 280);
  const values = sanitizeColumnWidths(columns, { ref: 220, requested: 400, action: 20, client: Infinity });
  assert.equal(values.ref, 220); assert.equal(values.client, 200); assert.equal(values.action, 175);
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
  for (const label of ['Client', 'Action', 'Paiement', 'Dimensions optimisées']) assert.equal(Object.hasOwn(exported[0], label), false);
});
