import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_COLUMNS, buildDossierTableModel as model, buildDossierTableExportRows, dossierTableExportColumns, formatDossierTableDate, dossierTableMissingAmountLabel } from './dossierTable.js';
import { actionWaiting, workActionUrl } from './personalWork.js';

const now = Date.parse('2026-10-02T12:00:00Z');
const dossier = { id: 'parcel', ref: 'EXP-QA', statut: 'autorise', feuVert: 'autorise', responsibleStaffId: 'referent', nbColis: 3 };
const base = { me: 'worker', can: () => true, now, teamUsers: [{ authId: 'other', prenom: 'Marie', nom: 'Test' }, { authId: 'referent', nom: 'Référent du dossier' }] };
const action = (kind, changes = {}) => ({ id: `task-${kind}`, colis_id: dossier.id, kind, state: 'ready', assignee_id: null, version: 8, ...changes });
const prepared = { ...dossier, statut: 'en_preparation', preparationCompositionVersion: 2, finalMeasurementsVersion: 2, outgoingParcelCount: 1, finalPackages: [{ dimL: 10, dimW: 20, dimH: 30, poids: 2 }] };
const quoted = { ...prepared, statut: 'devis_envoye', devisTotal: 100, devisEnvoyeLe: '2026-10-01T12:00:00Z', devisBrouillon: false, quoteVersion: 1 };
const paid = { ...quoted, statut: 'paye', paiementMontant: 100, paiementDate: '2026-10-02T09:00:00Z' };

test('one dossier selects my parallel task instead of its referent or a colleague’s task', () => {
  const actions = [action('preparation', { assignee_id: 'other', state: 'in_progress' }), action('documents', { assignee_id: 'worker' })];
  const row = model(dossier, { ...base, actions, scope: 'mine' });
  assert.equal(row.action.kind, 'documents'); assert.equal(row.ownerName, 'Vous');
  assert.equal(row.matchesScope, true); assert.equal(row.otherActionsCount, 1);
  assert.equal(model(dossier, { ...base, actions, assigneeFilter: 'other' }).ownerName, 'Marie Test');
  assert.equal(model(dossier, { ...base, actions, assigneeFilter: 'referent' }).matchesScope, false);
  assert.equal(model(dossier, { ...base, actions, scope: 'mine', assigneeFilter: 'other' }).matchesScope, false);
});

test('all prefers work I can perform, retaining a colleague’s concurrent task in the count', () => {
  const row = model(dossier, { ...base, actions: [action('preparation', { assignee_id: 'other' }), action('documents')] });
  assert.equal(row.action.kind, 'documents'); assert.equal(row.otherActionsCount, 1);
  assert.equal(row.ownerName, 'Non attribué');
});

test('the current physical stage precedes independent equally executable documents', () => {
  const actions = [action('documents', { created_at: '2026-09-01' }), action('preparation', { created_at: '2026-10-01' })];
  assert.equal(model(dossier, { ...base, actions }).action.kind, 'preparation');
});

test('waiting is visible in my scope, explains its reason and never enters the pool', () => {
  const actions = [action('preparation', { assignee_id: 'worker', state: 'waiting', waiting_reason: 'Matériel attendu', blocked_reason: '' })];
  const row = model(dossier, { ...base, actions, scope: 'mine' });
  assert.equal(row.matchesScope, true); assert.equal(row.detail, 'Matériel attendu');
  assert.equal(model(dossier, { ...base, actions: [{ ...actions[0], assignee_id: null }], scope: 'pool' }).matchesScope, false);
});

test('pool requires a free ready task, permission, authenticated identity and availability', () => {
  const actions = [action('preparation')];
  assert.equal(model(dossier, { ...base, actions, scope: 'pool' }).matchesScope, true);
  for (const patch of [{ can: () => false }, { available: false }, { me: undefined }, { actions: [action('preparation', { assignee_id: 'other' })] }, { actions: [action('preparation', { state: 'in_progress' })] }, { actions: [action('preparation', { blocked_reason: 'Accord à vérifier' })] }])
    assert.equal(model(dossier, { ...base, actions, scope: 'pool', ...patch }).matchesScope, false);
});

test('assigned work remains visible when I am unavailable or my permission is withdrawn', () => {
  const actions = [action('preparation', { assignee_id: 'worker' })];
  assert.equal(model(dossier, { ...base, actions, scope: 'mine', available: false }).matchesScope, true);
  const row = model(dossier, { ...base, actions, scope: 'mine', can: () => false });
  assert.equal(row.matchesScope, true); assert.match(row.detail, /personne autorisée/);
});

test('handoff does not transfer responsibility before acceptance', () => {
  const actions = [action('preparation', { assignee_id: 'other', handoff_to: 'worker' })];
  assert.equal(model(dossier, { ...base, actions, scope: 'mine' }).matchesScope, false);
  assert.equal(model(dossier, { ...base, actions }).ownerName, 'Marie Test');
});

test('all keeps dossiers without tasks and presets never change scope membership', () => {
  for (const view of ['daily', 'payments', 'departures']) {
    assert.equal(model(dossier, { ...base, view }).matchesScope, true);
    assert.equal(model(dossier, { ...base, view }).action, null);
    assert.equal(model(dossier, { ...base, view, scope: 'mine' }).matchesScope, false);
    assert.equal(model(dossier, { ...base, view, assigneeFilter: 'unassigned' }).matchesScope, false);
  }
});

test('unavailable work data creates no action, owner or pool opportunity', () => {
  const options = { ...base, actions: [action('preparation')], workReady: false };
  assert.equal(model(dossier, options).title, 'Tâches à actualiser');
  assert.equal(model(dossier, options).action, null); assert.equal(model(dossier, options).ownerName, '—');
  assert.equal(model(dossier, options).matchesScope, true);
  for (const patch of [{ scope: 'mine' }, { scope: 'pool' }, { assigneeFilter: 'unassigned' }, { assigneeFilter: 'other' }])
    assert.equal(model(dossier, { ...options, ...patch }).matchesScope, false);
});

test('completed, unrelated and archived tasks cannot become opportunities', () => {
  const actions = [action('preparation', { state: 'done' }), action('documents', { colis_id: 'another' })];
  assert.equal(model(dossier, { ...base, actions }).action, null);
  assert.equal(model({ ...dossier, archive: true }, { ...base, actions: [action('preparation')] }).action, null);
  assert.equal(model({ ...dossier, archive: true }, base).title, 'Dossier archivé');
});

test('stale quote readiness never offers calculation before independent optimisation is saved', () => {
  const waitingQuote = action('quote', { assignee_id: 'worker' });
  const result = model(dossier, { ...base, actions: [waitingQuote], scope: 'mine' });
  assert.equal(result.action.id, waitingQuote.id); assert.equal(result.action.version, 8);
  assert.equal(actionWaiting(result.action), true); assert.match(result.detail, /Optimisation à terminer/);
  assert.equal(waitingQuote.blocked_reason, undefined);
  assert.equal(model(dossier, { ...base, actions: [action('quote')], scope: 'pool' }).matchesScope, false);
});

test('a receipt awaiting consent cannot be offered as executable, unless its scheduled review is due', () => {
  const waiting = { ...dossier, statut: 'attente_feu_vert', feuVert: 'en_attente' };
  assert.equal(model(waiting, { ...base, actions: [action('reception')], scope: 'pool' }).matchesScope, false);
  const due = model({ ...waiting, attenteClientUntil: '2026-10-01T12:00:00Z' }, { ...base, actions: [action('reception', { action_hint: 'Réexaminer l’attente client' })], scope: 'pool' });
  assert.equal(due.matchesScope, true); assert.equal(due.title, 'Réexaminer l’attente client');
});

test('presets may prioritize a coherent quote without losing task routing or versions', () => {
  const actions = [action('conversation'), action('quote')];
  const row = model(prepared, { ...base, actions, view: 'payments' });
  assert.equal(row.action.kind, 'quote');
  const target = new URL(workActionUrl(row.action, '/colis?scope=mine', prepared), 'https://example.test');
  assert.equal(target.searchParams.get('section'), 'devis'); assert.equal(target.searchParams.get('action'), 'task-quote');
  assert.equal(row.action.version, 8);
});

test('zero placeholders and incomplete quotes never display a payment request', () => {
  for (const current of [{ ...dossier, devisTotal: 0, quoteVersion: 0 }, { ...quoted, devisTotal: 0, quoteVersion: 0 }, { ...dossier, devisTotal: null }, { ...quoted, devisTotal: Infinity }]) {
    assert.equal(model(current, base).payment.requested, null);
    assert.equal(model(current, base).payment.remaining, null);
  }
  assert.equal(model({ ...dossier, devisTotal: 0, quoteVersion: 0 }, base).payment.stateLabel, 'À calculer');
});

test('a current unpaid request has an exact outstanding amount and only its saved sent date', () => {
  const payment = model(quoted, base).payment;
  assert.deepEqual(payment, { requested: 100, paid: 0, remaining: 100, sentAt: quoted.devisEnvoyeLe, stateLabel: 'Paiement attendu' });
  assert.equal(model({ ...quoted, devisEnvoyeLe: null }, base).payment.sentAt, null);
  assert.equal(model({ ...quoted, devisEnvoyeLe: '2099-01-01' }, base).payment.sentAt, null);
});

test('a partial capture does not become paid because its status says paye', () => {
  const current = { ...paid, paiementMontant: 30 };
  const row = model(current, { ...base, actions: [action('departure')] });
  assert.deepEqual(row.payment, { requested: 100, paid: 30, remaining: 70, sentAt: quoted.devisEnvoyeLe, stateLabel: 'Paiement partiel' });
  assert.equal(row.departure.readinessLabel, 'Paiement à compléter');
  assert.equal(actionWaiting(row.action), true);
  assert.equal(model(current, { ...base, actions: [action('departure')], scope: 'pool' }).matchesScope, false);
});

test('payment links and statuses alone never count as recorded cash', () => {
  for (const current of [{ ...quoted, payplugPaymentUrl: 'https://example.invalid' }, { ...quoted, statut: 'paye' }, { ...paid, paiementDate: null }, { ...paid, paiementDate: '2099-01-01' }, { ...paid, paiementMontant: null }]) {
    const row = model(current, base);
    assert.notEqual(row.payment.stateLabel, 'Payé');
    assert.notEqual(row.departure.readinessLabel, 'Prêt à affecter');
  }
});

test('reopening consent, withdrawing a quote or conflicting amounts removes the payment request', () => {
  for (const patch of [{ statut: 'mesure' }, { devisBrouillon: true }, { quoteNeedsReview: true }, { devisSnapshot: { amounts: { total: 120 } } }]) {
    const payment = model({ ...quoted, ...patch }, base).payment;
    assert.equal(payment.requested, null); assert.equal(payment.remaining, null); assert.equal(payment.sentAt, null);
  }
});

test('money remains finite numbers and subtraction is rounded to cents', () => {
  const payment = model({ ...paid, devisTotal: '100.10', paiementMontant: '30.05' }, base).payment;
  assert.equal(payment.requested, 100.1); assert.equal(payment.paid, 30.05); assert.equal(payment.remaining, 70.05);
  assert.equal(model({ ...paid, paiementMontant: 110 }, base).payment.remaining, 0);
  assert.equal(model({ ...paid, paiementMontant: 110 }, base).payment.stateLabel, 'Trop-perçu à vérifier');
});

test('optimisation is true only for complete saved packages with a current composition certificate', () => {
  assert.equal(model(prepared, base).optimized, true);
  for (const patch of [{ finalMeasurementsVersion: 1 }, { finalMeasurementsVersion: null }, { finalPackages: [] }, { outgoingParcelCount: 2 }, { finalPackages: [{ dimL: 10, dimW: 20, dimH: 30, poids: 0 }] }]) {
    const row = model({ ...prepared, ...patch }, base);
    assert.equal(row.optimized, false); assert.match(row.departure.packagesLabel, /à confirmer/);
  }
});

test('no assignment invents neither next departure nor a destination from another shipment', () => {
  const row = model(paid, { ...base, envois: [{ id: 'unrelated', date: '2026-10-10', destinationCode: '974' }] });
  assert.equal(row.departure.label, 'À planifier'); assert.equal(row.departure.destination, 'Destination à préciser');
  assert.equal(row.departure.readinessLabel, 'Prêt à affecter');
  assert.equal(row.departure.packagesLabel, '1 colis après optimisation');
});

test('an actually assigned future departure retains its date after the loading cutoff', () => {
  const envois = [{ id: 'departure', date: '2026-10-10', destinationCode: '974', loadingClosesAt: '2026-10-01T12:00:00Z', statut: 'planifie' }];
  const row = model({ ...paid, envoi: 'departure' }, { ...base, envois });
  assert.equal(row.departure.label, 'Prévu le 10/10/2026');
  assert.equal(row.departure.destination, 'Réunion'); assert.equal(row.departure.readinessLabel, 'Prêt pour ce départ');
});

test('destination falls back to the actual client address without a default Réunion assignment', () => {
  assert.equal(model(dossier, { ...base, client: { cp: '97600' } }).departure.destination, 'Mayotte');
  assert.equal(model(dossier, { ...base, client: {} }).departure.destination, 'Destination à préciser');
});

test('departure preparation names the real next prerequisite before asking for payment', () => {
  assert.equal(model({ ...dossier, statut: 'receptionne' }, base).departure.readinessLabel, 'Réception à compléter');
  assert.equal(model({ ...dossier, statut: 'mesure' }, base).departure.readinessLabel, 'Accord client à demander');
  assert.equal(model({ ...dossier, statut: 'attente_feu_vert' }, base).departure.readinessLabel, 'Accord client attendu');
  assert.equal(model(dossier, base).departure.readinessLabel, 'Optimisation à terminer');
  assert.equal(model(prepared, base).departure.readinessLabel, 'Factures à vérifier');
  assert.equal(model(prepared, { ...base, client: { type: 'pro' } }).departure.readinessLabel, 'Devis à envoyer');
});

test('an explicit valid zero quote is not mistaken for an initial placeholder or a permission to ship', () => {
  const zero = { ...quoted, devisTotal: 0, devisSnapshot: { amounts: { total: 0 } }, quoteVersion: 1 };
  const row = model(zero, base);
  assert.equal(row.payment.requested, 0); assert.equal(row.payment.stateLabel, 'Aucun règlement demandé');
  assert.match(row.departure.readinessLabel, /Montant nul.*responsable/);
});

test('past or cancelled planning never promises a future departure', () => {
  for (const departure of [{ id: 'departure', date: '2026-09-01', statut: 'planifie' }, { id: 'departure', date: '2026-10-10', statut: 'annule' }, { id: 'departure', date: '2026-10-10', statut: 'archive' }]) {
    const row = model({ ...paid, envoi: 'departure' }, { ...base, envois: [departure] });
    assert.doesNotMatch(row.departure.label, /^Prévu/); assert.equal(row.departure.readinessLabel, 'Planning à vérifier');
  }
});

test('a real recorded expedition without a remaining planning reference stays recorded', () => {
  const row = model({ ...paid, statut: 'expedie', dateExpedition: '2026-10-02T10:00:00Z' }, base);
  assert.equal(row.departure.label, 'Expédition enregistrée'); assert.equal(row.departure.readinessLabel, 'Expédition enregistrée');
});

test('the model is pure and never rewrites action version, owner or dossier business facts', () => {
  const actions = [Object.freeze(action('quote'))];
  const current = Object.freeze({ ...dossier, devisTotal: 0 });
  const snapshot = JSON.stringify({ current, actions });
  const result = model(current, { ...base, actions: Object.freeze(actions) });
  assert.equal(JSON.stringify({ current, actions }), snapshot);
  assert.equal(result.action.version, 8); assert.equal(result.action.assignee_id, null);
});

test('export uses the selected task owner and preserves visible column and dossier order', () => {
  const first = { ...dossier, id: 'first', clientId: 'client', ref: 'EXP-FIRST' };
  const second = { ...dossier, id: 'second', clientId: 'client', ref: 'EXP-SECOND' };
  const models = new Map([[first.id, { ownerName: 'Marie Test', title: 'Optimiser les colis', detail: 'En cours' }], [second.id, { ownerName: 'Vous', title: 'Vérifier les factures', detail: 'Facture à vérifier' }]]);
  const columns = [{ key: 'owner', label: 'Qui s’en occupe' }, { key: 'ref', label: 'Référence' }, { key: 'statut', label: 'Travail à faire' }];
  const rows = buildDossierTableExportRows([second, first], [], models, 'daily', columns);
  assert.deepEqual(Object.keys(rows[0]), columns.map(column => column.label));
  assert.deepEqual(rows.map(row => row['Qui s’en occupe']), ['Vous', 'Marie Test']);
  assert.deepEqual(rows.map(row => row.Référence), ['EXP-SECOND', 'EXP-FIRST']);
  assert.match(rows[0]['Travail à faire'], /Facture à vérifier/);
  assert.doesNotMatch(JSON.stringify(rows), /referent/);
});

test('export never substitutes raw dossier money when the current model withdraws a request', () => {
  const withdrawn = { ...quoted, devisTotal: 900, devisBrouillon: true };
  const models = new Map([[withdrawn.id, model(withdrawn, base)]]);
  const columns = [{ key: 'requested', label: 'Demandé' }, { key: 'paid', label: 'Payé' }, { key: 'remaining', label: 'Reste à payer' }];
  const [row] = buildDossierTableExportRows([withdrawn], [], models, 'payments', columns);
  assert.deepEqual(row, { Demandé: 'À calculer', Payé: 0, 'Reste à payer': 'À calculer' });
  const uncertain = { ...paid, paiementDate: null };
  models.set(uncertain.id, model(uncertain, base));
  const [pending] = buildDossierTableExportRows([uncertain], [], models, 'payments', columns);
  assert.deepEqual(pending, { Demandé: 100, Payé: 'À vérifier', 'Reste à payer': 'À vérifier' });
});

test('export preserves an explicit valid zero and a real partial payment as numbers', () => {
  const zero = { ...quoted, id: 'zero', devisTotal: 0, devisSnapshot: { amounts: { total: 0 } } };
  const partial = { ...paid, id: 'partial', paiementMontant: 30.05 };
  const models = new Map([zero, partial].map(dossier => [dossier.id, model(dossier, base)]));
  const columns = [{ key: 'requested', label: 'Demandé' }, { key: 'paid', label: 'Payé' }, { key: 'remaining', label: 'Reste à payer' }];
  assert.deepEqual(buildDossierTableExportRows([zero, partial], [], models, 'payments', columns), [
    { Demandé: 0, Payé: 0, 'Reste à payer': 0 }, { Demandé: 100, Payé: 30.05, 'Reste à payer': 69.95 },
  ]);
});

test('only active view columns are exported: no contacts, hidden finances, button or duplicate row', () => {
  const current = { ...dossier, clientId: 'client', devisTotal: 999 };
  const clients = [{ id: 'client', nom: 'Camille Test', email: 'private@example.test', tel: '0600000000', adresse: 'Rue privée' }];
  const columns = [{ key: 'client', label: 'Client' }, { key: 'ref', label: 'Référence' }, { key: 'email', label: 'Email' }, { key: 'tel', label: 'Téléphone' }, { key: 'requested', label: 'Demandé' }, { key: 'action', label: 'Action' }, { key: 'ref', label: 'Référence répétée' }];
  const rows = buildDossierTableExportRows([current, { ...current }], clients, new Map(), 'daily', columns);
  assert.deepEqual(rows, [{ Client: 'Camille Test', Référence: dossier.ref }]);
  assert.doesNotMatch(JSON.stringify(rows), /private|060000|999|Action|répétée/);
});

test('export without a loaded model never invents an owner or a total and validates column configuration', () => {
  const [row] = buildDossierTableExportRows([paid], [], new Map(), 'payments', [{ key: 'requested', label: 'Demandé' }, { key: 'sentAt', label: 'Devis envoyé le' }]);
  assert.deepEqual(row, { Demandé: 'À calculer', 'Devis envoyé le': 'Non renseigné' });
  assert.throws(() => dossierTableExportColumns('unknown', []), /vue et ses colonnes/);
  assert.throws(() => dossierTableExportColumns('payments', undefined), /vue et ses colonnes/);
  assert.throws(() => dossierTableExportColumns('payments', [{ key: 'paid', label: 'Montant' }, { key: 'remaining', label: 'Montant' }]), /même nom/);
});

test('screen and export share stable dates and explicit unknown amount wording', () => {
  assert.equal(formatDossierTableDate('2026-10-01T22:30:00Z'), '02/10/2026');
  assert.equal(formatDossierTableDate('2026-10-02T00:30:00+02:00'), '02/10/2026');
  assert.equal(formatDossierTableDate(null), 'Non renseigné');
  assert.equal(formatDossierTableDate('not a date'), 'Non renseigné');
  assert.equal(dossierTableMissingAmountLabel({ stateLabel: 'Paiement à vérifier' }, 'remaining'), 'À vérifier');
  assert.equal(dossierTableMissingAmountLabel({ stateLabel: 'À calculer' }, 'requested'), 'À calculer');
});

test('an active priority explains the displayed task while an expired priority does not persist', () => {
  const urgent = action('preparation', { priority_reason: 'Départ rapproché', priority_until: '2026-10-03T12:00:00Z' });
  assert.equal(model(dossier, { ...base, actions: [urgent] }).detail, 'Départ rapproché');
  assert.equal(model(dossier, { ...base, actions: [{ ...urgent, priority_until: '2026-10-01T12:00:00Z' }] }).detail, 'Disponible');
  assert.equal(model(dossier, { ...base, actions: [action('preparation', { due_at: '2026-10-01T12:00:00Z' })] }).detail, 'Échéance dépassée');
  assert.match(model(dossier, { ...base, actions: [{ ...urgent, assignee_id: 'other' }] }).detail, /Départ rapproché.*collègue/);
  assert.equal(model(dossier, { ...base, actions: [{ ...urgent, blocked_reason: 'Matériel attendu' }] }).detail, 'Matériel attendu');
});

test('final weight sums only certified physical packages and does not use an old aggregate', () => {
  const multi = { ...prepared, outgoingParcelCount: 2, finP: 999, finalPackages: [
    { dimL: 10, dimW: 20, dimH: 30, poids: '1.25' }, { dimL: 40, dimW: 50, dimH: 60, poids: 2.1 },
  ] };
  assert.equal(model(multi, base).optimizedWeight, 3.35);
  assert.deepEqual(model(multi, base).optimizedDimensions, ['Colis 1 : 10 × 20 × 30 cm', 'Colis 2 : 40 × 50 × 60 cm']);
  for (const patch of [{ finalPackages: [] }, { finalMeasurementsVersion: 99 }, { outgoingParcelCount: 3 }]) {
    const result = model({ ...multi, ...patch }, base);
    assert.equal(result.optimizedWeight, null); assert.deepEqual(result.optimizedDimensions, []);
  }
  assert.equal(model({ ...prepared, finalPackages: null, finL: 10, finW: 20, finH: 30, finP: 1.5 }, base).optimizedWeight, 1.5);
});

test('a known draft price stays separate from a payment request and uses stored amounts without tax recalculation', () => {
  const draft = { ...prepared, devisTotal: 83.47, devisBrouillon: true, quoteVersion: 3, devisSnapshot: { version: 3, amounts: { total: 83.47 } } };
  const result = model(draft, base);
  assert.deepEqual(result.quotePrice, { amount: 83.47, stateLabel: 'Brouillon' });
  assert.equal(result.payment.requested, null); assert.equal(result.payment.remaining, null);
  assert.equal(model({ ...draft, devisTotal: null }, base).quotePrice.amount, 83.47);
  assert.deepEqual(model({ ...draft, statut: 'autorise' }, base).quotePrice, { amount: 83.47, stateLabel: 'Brouillon' });
  assert.equal(model({ ...draft, statut: 'autorise', finalMeasurementsVersion: 99 }, base).quotePrice.amount, null);
  for (const patch of [{ quoteNeedsReview: true }, { devisTotal: 91 }, { devisSnapshot: { version: 2, amounts: { total: 83.47 } } }, { statut: 'mesure' }])
    assert.deepEqual(model({ ...draft, ...patch }, base).quotePrice, { amount: null, stateLabel: 'À revoir' });
});

test('recorded payment keeps the frozen quote price even when a raw draft total diverges', () => {
  const result = model({ ...paid, devisTotal: 999, devisBrouillon: true, devisSnapshot: { version: 1, amounts: { total: 100 } } }, base);
  assert.deepEqual(result.quotePrice, { amount: 100, stateLabel: 'À revoir' });
  assert.equal(result.payment.requested, null); // Existing payment consistency remains strict.
  assert.equal(model({ ...quoted, devisTotal: 999, devisSnapshot: { version: 1, amounts: { total: 100 } } }, base).quotePrice.amount, null);
});

test('a real zero quote price needs a versioned frozen zero and cannot come from initial defaults', () => {
  assert.deepEqual(model({ ...prepared, devisTotal: 0, devisBrouillon: true, quoteVersion: 0 }, base).quotePrice, { amount: null, stateLabel: 'À calculer' });
  assert.deepEqual(model({ ...quoted, devisTotal: null, devisSnapshot: { amounts: { total: 0 } } }, base).quotePrice, { amount: 0, stateLabel: '' });
  assert.equal(model({ ...quoted, devisTotal: 0, quoteVersion: 0, devisSnapshot: { amounts: { total: 0 } } }, base).quotePrice.amount, null);
});

test('quote price columns are financial and preserve draft and review labels in exports', () => {
  const draft = { ...prepared, id: 'draft', devisTotal: 83.47, devisBrouillon: true, quoteVersion: 3, devisSnapshot: { version: 3, amounts: { total: 83.47 } } };
  const paidMismatch = { ...paid, id: 'paid', devisTotal: 999, devisSnapshot: { version: 1, amounts: { total: 100 } } };
  const zero = { ...quoted, id: 'zero', devisTotal: null, devisSnapshot: { amounts: { total: 0 } } };
  const items = [draft, paidMismatch, zero], models = new Map(items.map(row => [row.id, model(row, base)]));
  for (const view of ['daily', 'departures']) {
    const columns = TABLE_COLUMNS[view].filter(column => ['optimizedWeight', 'requested'].includes(column.key));
    assert.equal(columns.find(column => column.key === 'requested').financial, true);
    assert.equal(columns.find(column => column.key === 'requested').priceKind, 'quote');
    const rows = buildDossierTableExportRows(items, [], models, view, columns);
    assert.equal(rows[0]['Prix du devis'], '83,47 € · Brouillon');
    assert.equal(rows[1]['Prix du devis'], '100,00 € · À revoir');
    assert.equal(rows[2]['Prix du devis'], 0);
    assert.equal(rows[0]['Poids final (kg)'], 2);
  }
  for (const key of ['requested', 'paid', 'remaining']) assert.equal(TABLE_COLUMNS.payments.find(column => column.key === key).financial, true);
});
