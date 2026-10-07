import test from 'node:test';
import assert from 'node:assert/strict';
import { WORK_TABLE_COLUMNS, WORK_TABLE_CHOICES, cartonCount, resolveWorkLayout, visibleWorkColumns, workRowModel } from './workTable.js';
import { workDate } from './personalWork.js';

const now = Date.parse('2026-10-05T10:00:00Z');
const dossier = { id: 'parcel', clientId: 'client', ref: 'EXP-2026-0398', casier: 'B-12', nbColis: 3 };
const client = { id: 'client', prenom: 'Jean-Marc', nomFamille: 'Hoarau', nom: 'Hoarau Jean-Marc' };
const action = (changes = {}) => ({ id: 'task', colis_id: 'parcel', kind: 'quote', state: 'ready', assignee_id: 'me', version: 1, ...changes });
const model = (changes, options = {}) => workRowModel(action(changes), dossier, client, { now, meId: 'me', ...options });

test('one task per row: task first and required, action fixed and never offered as a choice', () => {
  assert.deepEqual(WORK_TABLE_COLUMNS.map(column => [column.key, column.label]), [['task', 'Tâche'], ['due', 'Échéance'], ['ref', 'Dossier'], ['client', 'Client'], ['casier', 'Casier'], ['cartons', 'Cartons'], ['action', 'Action']]);
  assert.equal(WORK_TABLE_COLUMNS.find(column => column.key === 'cartons').align, 'right');
  assert.deepEqual(WORK_TABLE_CHOICES.map(column => column.key), ['task', 'due', 'ref', 'client', 'casier', 'cartons']);
  assert.deepEqual(visibleWorkColumns(['casier', 'due', 'unknown']).map(column => column.key), ['task', 'due', 'casier', 'action'], 'The column order never follows the saved list.');
  assert.deepEqual(visibleWorkColumns([]).map(column => column.key), ['task', 'action']);
  assert.deepEqual(visibleWorkColumns().map(column => column.key), ['task', 'action']);
});

test('automatic layout is a table from 1280px and cards below; a forced choice wins', () => {
  assert.equal(resolveWorkLayout('auto', true), 'table');
  assert.equal(resolveWorkLayout('auto', false), 'cards');
  for (const wide of [true, false]) {
    assert.equal(resolveWorkLayout('table', wide), 'table');
    assert.equal(resolveWorkLayout('cards', wide), 'cards');
    for (const invalid of [undefined, null, '', 'grid']) assert.equal(resolveWorkLayout(invalid, wide), wide ? 'table' : 'cards');
  }
});

test('title, state pill, identity and physical facts', () => {
  assert.equal(model({ action_hint: 'Accès client à activer' }).title, 'Accès client à activer');
  assert.equal(model().title, 'Établir le devis');
  assert.equal(model({ kind: 'unknown' }).title, 'Action à préciser');
  assert.equal(model().state, null, '« À faire » is never repeated on its own section.');
  assert.deepEqual(model({ state: 'in_progress' }).state, { label: 'En cours', tone: 'current' });
  assert.deepEqual(model({ state: 'waiting' }).state, { label: 'En attente', tone: 'waiting' });
  const row = model();
  assert.equal(row.ref, 'EXP-2026-0398');
  assert.equal(row.client, 'Jean-Marc Hoarau');
  assert.equal(row.casier, 'B-12');
  assert.equal(row.cartons, 3);
  assert.equal(workRowModel(action(), { ...dossier, casier: '' }, { nom: 'Boutique Kréol SARL' }, { now }).client, 'Boutique Kréol SARL');
  assert.equal(workRowModel(action(), { ...dossier, casier: '' }, null, { now }).casier, null);
  assert.equal(workRowModel(action(), { ...dossier, casier: '' }, null, { now }).client, 'Client');
  const missing = workRowModel(action(), undefined, undefined, { now });
  assert.equal(missing.ref, 'Dossier à consulter');
  assert.equal(missing.cartons, null);
  assert.equal(workRowModel(action(), { ...dossier, nbColis: 1, trackings: ['A', 'B'] }, client, { now }).cartons, 2, 'Cartons follow the reception manifest.');
  assert.equal(cartonCount(1), '1 carton');
  assert.equal(cartonCount(3), '3 cartons');
  assert.equal(cartonCount(0), '0 carton', 'French counts: 0 takes the singular (plural.js).');
});

test('the deadline reuses the priority wording; the table cell drops « Échéance »', () => {
  const overdue = '2026-10-03T10:00:00Z', planned = '2026-10-06T10:27:00Z';
  // status and date are the two halves of the cell, each kept whole on its line.
  assert.deepEqual(model({ due_at: overdue }).due, { text: `Dépassée · ${workDate(overdue, { now })}`, label: `Échéance dépassée · ${workDate(overdue, { now })}`, status: 'Dépassée', date: workDate(overdue, { now }), urgent: true });
  assert.equal(model({ due_at: overdue }).due.date, 'samedi 3 octobre, 12 h', 'The deadline reads like the Départ labels, on Paris time.');
  assert.equal(model({ due_at: overdue }).urgent, true);
  assert.deepEqual(model({ due_at: planned }).due, { text: `Prévue · ${workDate(planned, { now })}`, label: `Échéance prévue · ${workDate(planned, { now })}`, status: 'Prévue', date: workDate(planned, { now }), urgent: false });
  assert.equal(model({ due_at: planned, state: 'in_progress' }).due.text, `Prévue · ${workDate(planned, { now })}`, 'The « En cours » pill already says the work started.');
  assert.equal(model().due, null);
  assert.equal(model({ state: 'in_progress' }).due, null);
  const priority = { priority_reason: 'Client en partance', priority_until: '2026-10-06T00:00:00Z' };
  assert.deepEqual(model(priority).due, { text: 'Client en partance', label: 'Client en partance', status: 'Client en partance', date: null, urgent: true });
  assert.equal(model({ ...priority, due_at: planned }).due.text, `Client en partance · ${workDate(planned, { now })}`);
  assert.deepEqual(model({ state: 'waiting', review_at: '2026-10-04T10:00:00Z' }).due, { text: 'Attente à réexaminer', label: 'Attente à réexaminer', status: 'Attente à réexaminer', date: null, urgent: true });
  assert.equal(model({ blocked_reason: 'Facture manquante', due_at: planned }).due.text, `Prévue · ${workDate(planned, { now })}`, 'A blocker is the waiting line, not the deadline.');
});

test('waiting, handoff and note lines; the current person is never named on their own task', () => {
  assert.equal(model({ state: 'waiting', waiting_reason: 'Vérification fournisseur', review_at: '2026-10-09T08:00:00Z' }).waiting, `Vérification fournisseur · À revoir le ${workDate('2026-10-09T08:00:00Z', { now })}`);
  assert.equal(model({ blocked_reason: 'Accord client attendu', waiting_reason: 'Autre' }).waiting, 'Accord client attendu');
  assert.equal(model().waiting, null);
  assert.deepEqual(model({ handoff_to: 'colleague', handoff_note: 'Carton fragile' }).handoff, { to: 'colleague', note: 'Carton fragile' });
  assert.equal(model({ handoff_to: 'colleague', handoff_note: 'Carton fragile' }).note, null, 'A pending handoff carries its own note.');
  assert.equal(model({ handoff_note: 'Reprendre après le carton 2' }).note, 'Reprendre après le carton 2');
  assert.equal(model().handoff, null);
  assert.equal(model().assigneeId, null);
  assert.equal(model({ assignee_id: 'colleague' }).assigneeId, 'colleague');
  assert.equal(model({ assignee_id: null }).assigneeId, null);
});

test('beside an « En attente » pill the waiting line gives the reason, never « En attente » twice', () => {
  const waiting = model({ state: 'waiting', waiting_reason: 'Vérification fournisseur' });
  assert.deepEqual([waiting.state.label, waiting.waitingLabel, waiting.waiting], ['En attente', 'Raison', 'Vérification fournisseur']);
  // A blocker on a task still « À faire » or « En cours » has no such pill: its line says the wait.
  assert.equal(model({ blocked_reason: 'Facture manquante' }).waitingLabel, 'En attente');
  assert.equal(model({ state: 'in_progress', blocked_reason: 'Facture manquante' }).waitingLabel, 'En attente');
});
