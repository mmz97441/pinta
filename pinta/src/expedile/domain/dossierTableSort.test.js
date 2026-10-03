import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_COLUMNS, defineDossierTableColumn, isDossierTableColumnSortable, sortDossierTableRows, dossierTableSortDirectionLabel, buildDossierTableModel, buildDossierTableExportRows } from './dossierTable.js';

const columns = new Map([...Object.values(TABLE_COLUMNS).flat(), ...TABLE_COLUMNS.payments].map(column => [column.key, column]));
const ids = rows => rows.map(row => row.id);
const ordered = (rows, key, direction = 'asc', options = {}) => sortDossierTableRows(rows, { ...options, column: columns.get(key), direction });
const models = values => new Map(Object.entries(values));

test('every displayed data column declares a typed accessor, while actions have no sorting contract', () => {
  const data = [...columns.values()].filter(column => column.kind === 'data');
  assert.equal(data.length, 19);
  for (const column of data) {
    assert.equal(isDossierTableColumnSortable(column), true, column.key);
    assert.ok(['text', 'number', 'date'].includes(column.sort.type));
  }
  for (const view of Object.values(TABLE_COLUMNS)) {
    assert.equal(view.filter(column => !isDossierTableColumnSortable(column)).length, 1);
    assert.equal(view.at(-1).kind, 'action');
  }
});

test('a future data column gets numeric sorting without a header whitelist or comparator case', () => {
  const column = defineDossierTableColumn({ key: 'pallets', label: 'Palettes', sort: { type: 'number', value: ({ dossier }) => dossier.palletCount } });
  const rows = [{ id: '12', palletCount: 12 }, { id: 'unknown' }, { id: '2', palletCount: 2 }];
  assert.equal(isDossierTableColumnSortable(column), true);
  assert.deepEqual(ids(sortDossierTableRows(rows, { column })), ['2', '12', 'unknown']);
  assert.deepEqual(ids(sortDossierTableRows(rows, { column, direction: 'desc' })), ['12', '2', 'unknown']);
  for (const sort of [undefined, { type: 'number' }, { type: 'currency', value: () => 1 }])
    assert.throws(() => defineDossierTableColumn({ key: 'new', label: 'Nouvelle colonne', sort }), /sort.type et sort.value/);
});

test('references and lockers use natural French order with unknowns last in either direction', () => {
  for (const [key, field] of [['ref', 'ref'], ['casier', 'casier']]) {
    const rows = [{ id: '10', [field]: 'A10' }, { id: 'empty', [field]: '  ' }, { id: '2', [field]: 'A2' }, { id: 'missing' }];
    assert.deepEqual(ids(ordered(rows, key)), ['2', '10', 'empty', 'missing']);
    assert.deepEqual(ids(ordered(rows, key, 'desc')), ['10', '2', 'empty', 'missing']);
  }
});

test('client sorting uses the same surname-first displayed identity and ignores accents and case', () => {
  const clients = { a: { nom: 'Wrong Z', nomFamille: 'Émile', prenom: 'Zoé' }, b: { nom: 'favier' }, c: { prenom: 'Alain' }, d: {} };
  const rows = ['b', 'd', 'a', 'c'].map(id => ({ id, clientId: id }));
  assert.deepEqual(ids(ordered(rows, 'client', 'asc', { getClient: id => clients[id] })), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids(ordered(rows, 'client', 'desc', { getClient: id => clients[id] })), ['b', 'a', 'c', 'd']);
});

test('work sorting follows the displayed parallel task title rather than the dossier status', () => {
  const rows = [{ id: 'a', statut: 'mesure' }, { id: 'b', statut: 'autorise' }, { id: 'unknown', statut: 'paye' }];
  const options = { models: models({ a: { title: 'Vérifier les factures' }, b: { title: 'Demander l’accord du client' }, unknown: { title: 'Tâches à actualiser' } }) };
  assert.deepEqual(ids(ordered(rows, 'statut', 'asc', options)), ['b', 'a', 'unknown']);
  assert.deepEqual(ids(ordered(rows, 'statut', 'desc', options)), ['a', 'b', 'unknown']);
});

test('owner sorting follows the selected task owner, with unassigned and unavailable attribution last', () => {
  const rows = [{ id: 'z', responsibleStaffId: 'a' }, { id: 'free', responsibleStaffId: 'first' }, { id: 'a', responsibleStaffId: 'z' }, { id: 'none' }, { id: 'missing-user' }];
  const options = { models: models({ z: { ownerName: 'Zoé' }, a: { ownerName: 'Alice' }, free: { ownerName: 'Non attribué' }, none: { ownerName: '—' }, 'missing-user': { ownerName: 'Membre de l’équipe' } }) };
  assert.deepEqual(ids(ordered(rows, 'owner', 'asc', options)), ['a', 'z', 'free', 'none', 'missing-user']);
  assert.deepEqual(ids(ordered(rows, 'owner', 'desc', options)), ['z', 'a', 'free', 'none', 'missing-user']);
});

test('carton sorting uses the actual received manifest count and numeric order', () => {
  const rows = [{ id: '10', nbColis: 10 }, { id: '3', nbColis: 1, dimsParColis: [{}, {}, {}] }, { id: '2', nbColis: 2 }];
  assert.deepEqual(ids(ordered(rows, 'cartons')), ['2', '3', '10']);
  assert.deepEqual(ids(ordered(rows, 'cartons', 'desc')), ['10', '3', '2']);
});

test('all payment columns sort exact finite model amounts, preserving real zero and unknowns', () => {
  for (const key of ['requested', 'paid', 'remaining']) {
    const rows = ['10', 'unknown', '0', '2', 'invalid'].map(id => ({ id, devisTotal: id === 'unknown' ? 999999 : 0 }));
    const options = { models: models(Object.fromEntries(rows.map(row => [row.id, { payment: { [key]: row.id === 'unknown' ? null : row.id === 'invalid' ? Infinity : Number(row.id) } }]))) };
    assert.deepEqual(ids(ordered(rows, key, 'asc', options)), ['0', '2', '10', 'unknown', 'invalid']);
    assert.deepEqual(ids(ordered(rows, key, 'desc', options)), ['10', '2', '0', 'unknown', 'invalid']);
  }
});

test('an invalidated quote sorts as unknown instead of using the withdrawn raw amount', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const rows = [{ id: 'old', statut: 'mesure', devisTotal: 500, quoteNeedsReview: true }, { id: 'live', statut: 'devis_envoye', devisTotal: 100, quoteVersion: 1 }];
  const options = { models: new Map(rows.map(row => [row.id, buildDossierTableModel(row, { now })])) };
  assert.deepEqual(ids(ordered(rows, 'requested', 'desc', options)), ['live', 'old']);
  assert.equal(options.models.get('old').payment.requested, null);
});

test('quote dates sort chronologically across month boundaries and timezone offsets, unknown dates last', () => {
  const dates = { later: '2026-10-01T00:00:00Z', earlier: '2026-09-30T20:00:00+04:00', missing: null, invalid: '2026-02-30', notDate: '2' };
  const rows = Object.keys(dates).map(id => ({ id }));
  const options = { models: models(Object.fromEntries(Object.entries(dates).map(([id, sentAt]) => [id, { payment: { sentAt } }]))) };
  assert.deepEqual(ids(ordered(rows, 'sentAt', 'asc', options)), ['earlier', 'later', 'missing', 'invalid', 'notDate']);
  assert.deepEqual(ids(ordered(rows, 'sentAt', 'desc', options)), ['later', 'earlier', 'missing', 'invalid', 'notDate']);
});

test('departure dates come from actual assigned planning, never a formatted French label or an unrelated shipment', () => {
  const rows = [{ id: 'oct', envoi: 'oct' }, { id: 'unknown' }, { id: 'sep', envoiId: 'sep' }, { id: 'cancelled', envoi: 'cancelled' }];
  const options = { envois: [{ id: 'oct', date: '2026-10-02' }, { id: 'sep', date: '2026-09-30' }, { id: 'cancelled', date: '2026-01-01', statut: 'annule' }, { id: 'other', date: '2020-01-01' }],
    models: models({ oct: { departure: { label: 'Prévu le 02/10/2026' } }, sep: { departure: { label: 'Date dépassée · 30/09/2026' } }, unknown: { departure: { label: 'À planifier' } }, cancelled: { departure: { label: 'Départ annulé' } } }) };
  assert.deepEqual(ids(ordered(rows, 'departure', 'asc', options)), ['sep', 'oct', 'unknown', 'cancelled']);
  assert.deepEqual(ids(ordered(rows, 'departure', 'desc', options)), ['oct', 'sep', 'unknown', 'cancelled']);
});

test('destination and readiness sort their displayed meaning without changing any task priority', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'unknown' }];
  const options = { models: models({ a: { departure: { destination: 'Réunion', readinessLabel: 'Prêt à affecter' } }, b: { departure: { destination: 'Guadeloupe', readinessLabel: 'Accord client attendu' } }, unknown: { departure: { destination: 'Destination à préciser' } } }) };
  for (const key of ['destination', 'readiness']) {
    assert.deepEqual(ids(ordered(rows, key, 'asc', options)), ['b', 'a', 'unknown']);
    assert.deepEqual(ids(ordered(rows, key, 'desc', options)), ['a', 'b', 'unknown']);
  }
});

test('outgoing package counts sort numerically only when optimization remains certified', () => {
  const rows = [{ id: '10', outgoingParcelCount: 10 }, { id: 'stale', outgoingParcelCount: 100 }, { id: '2', outgoingParcelCount: 2 }];
  const options = { models: models({ 10: { optimized: true }, 2: { optimized: true }, stale: { optimized: false } }) };
  assert.deepEqual(ids(ordered(rows, 'packages', 'asc', options)), ['2', '10', 'stale']);
  assert.deepEqual(ids(ordered(rows, 'packages', 'desc', options)), ['10', '2', 'stale']);
});

test('equal values and equal instants stay stable, accessors run once per row and sorting never mutates input', () => {
  let calls = 0;
  const column = defineDossierTableColumn({ key: 'future', label: 'Future date', sort: { type: 'date', value: ({ dossier }) => { calls++; return dossier.date; } } });
  const rows = Object.freeze([
    Object.freeze({ id: 'a', date: '2026-10-02T12:00:00+04:00' }),
    Object.freeze({ id: 'b', date: '2026-10-02T08:00:00Z' }),
    Object.freeze({ id: 'null', date: null }),
  ]);
  const sorted = sortDossierTableRows(rows, { column, direction: 'desc' });
  assert.deepEqual(ids(sorted), ['a', 'b', 'null']); assert.equal(calls, rows.length);
  assert.notEqual(sorted, rows); assert.equal(sorted[0], rows[0]);
  assert.deepEqual(ids(sortDossierTableRows(rows, { column: columns.get('action') })), ids(rows));
  assert.deepEqual(ids(sortDossierTableRows(rows, { column: { key: '__proto__' } })), ids(rows));
});

test('the shared direction wording describes text, numbers and dates without exposing implementation terms', () => {
  assert.equal(dossierTableSortDirectionLabel(columns.get('casier')), 'A → Z');
  assert.equal(dossierTableSortDirectionLabel(columns.get('owner'), 'desc'), 'Z → A');
  assert.equal(dossierTableSortDirectionLabel(columns.get('cartons')), 'du plus petit au plus grand');
  assert.equal(dossierTableSortDirectionLabel(columns.get('requested'), 'desc'), 'du plus grand au plus petit');
  assert.equal(dossierTableSortDirectionLabel(columns.get('sentAt')), 'plus ancien d’abord');
  assert.equal(dossierTableSortDirectionLabel(columns.get('departure'), 'desc'), 'plus récent d’abord');
});

test('export keeps the sorted dossier order, selected columns and actual task owner without hidden contacts', () => {
  const rows = [{ id: 'a', ref: 'EXP-A', clientId: 'client', responsibleStaffId: 'z' }, { id: 'b', ref: 'EXP-B', clientId: 'client', responsibleStaffId: 'a' }];
  const sharedModels = models({ a: { ownerName: 'Zoé' }, b: { ownerName: 'Alice' } });
  const sorted = ordered(rows, 'owner', 'asc', { models: sharedModels });
  const result = buildDossierTableExportRows(sorted, [{ id: 'client', nom: 'Client', email: 'hidden@example.invalid' }], sharedModels, 'daily', TABLE_COLUMNS.daily.filter(column => ['ref', 'owner'].includes(column.key)));
  assert.deepEqual(result, [{ 'Référence': 'EXP-B', 'Qui s’en occupe': 'Alice' }, { 'Référence': 'EXP-A', 'Qui s’en occupe': 'Zoé' }]);
});

test('latest reception sorts by proven carton arrivals, exports Réunion date and preserves missing evidence', () => {
  const rows = [
    { id: 'unknown', nbColis: 2, dateReception: '2026-01-01T00:00:00Z' },
    { id: 'later', nbColis: 2, receptionDates: [{ receivedAt: '2026-09-28T10:00:00Z', source: 'server' }, { receivedAt: '2026-10-02T00:00:00Z', source: 'append_receipt' }] },
    { id: 'partial', nbColis: 2, receptionDates: [{ receivedAt: '2026-09-30T21:30:00Z', source: 'server' }, null] },
  ];
  const options = { models: new Map(rows.map(row => [row.id, buildDossierTableModel(row, { now: Date.parse('2026-10-03T00:00:00Z') })])) };
  assert.deepEqual(ids(ordered(rows, 'receivedAt', 'asc', options)), ['partial', 'later', 'unknown']);
  assert.deepEqual(ids(ordered(rows, 'receivedAt', 'desc', options)), ['later', 'partial', 'unknown']);
  const exported = buildDossierTableExportRows(rows, [], options.models, 'daily', [columns.get('receivedAt')]);
  assert.equal(exported[0]['Dernière réception'], 'Non renseigné');
  assert.equal(exported[2]['Dernière réception'], '01/10/2026 · 1/2 cartons datés');
});

test('final weights and known quote prices sort numerically with unknowns last, using their own source', () => {
  const weightColumn = TABLE_COLUMNS.daily.find(column => column.key === 'optimizedWeight');
  const priceColumn = TABLE_COLUMNS.daily.find(column => column.key === 'requested');
  const rows = ['ten', 'unknown', 'zero', 'two'].map(id => ({ id }));
  const data = models({ ten: { optimizedWeight: 10, quotePrice: { amount: 100 }, payment: { requested: 1 } }, unknown: { optimizedWeight: null, quotePrice: { amount: null }, payment: { requested: 0 } }, zero: { optimizedWeight: 1, quotePrice: { amount: 0 }, payment: { requested: 999 } }, two: { optimizedWeight: 2.5, quotePrice: { amount: 20 }, payment: { requested: 500 } } });
  for (const column of [weightColumn, priceColumn]) {
    assert.deepEqual(ids(sortDossierTableRows(rows, { column, models: data })), ['zero', 'two', 'ten', 'unknown']);
    assert.deepEqual(ids(sortDossierTableRows(rows, { column, models: data, direction: 'desc' })), ['ten', 'two', 'zero', 'unknown']);
  }
});
