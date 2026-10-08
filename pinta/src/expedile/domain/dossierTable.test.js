import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_COLUMNS, buildDossierTableModel as model, buildDossierTableExport, buildDossierTableExportRows, dossierTableExportColumns, formatDossierTableDate, dossierTableMissingAmountLabel, sortDossierTableRows, BULK_STATUS_STEPS, BULK_STATUS_REASONS, bulkStatusPlan, bulkRefusalReason, dossierFactHasValue, countLabel, countWord, parallelTasksLabel, STALE_TASK_REASON, consentRequestLabel, dossierDimensionsLines, volumetricWeightLabel, TAXES_PRO_LABEL, TAXES_UNVERIFIED_LABEL, dossierTableNumber, DOSSIER_TOTAL_KINDS } from './dossierTable.js';
import { actionWaiting, workActionUrl } from './personalWork.js';
import { STATUTS } from '../constants/index.js';

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

test('all keeps dossiers without tasks and the model never changes scope membership in any view', () => {
  // « Accords clients » lists fewer dossiers through consentQueueFilter, before the model: never here.
  for (const view of ['daily', 'payments', 'departures', 'accords']) {
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
  const placeholder = model({ ...dossier, devisTotal: 0, quoteVersion: 0 }, base).payment;
  assert.equal(placeholder.stateLabel, 'Non payé'); assert.equal(placeholder.detailLabel, 'À calculer');
});

test('a current unpaid request has an exact outstanding amount and only its saved sent date', () => {
  const payment = model(quoted, base).payment;
  assert.deepEqual(payment, { requested: 100, paid: 0, remaining: 100, sentAt: quoted.devisEnvoyeLe, stateLabel: 'Non payé', detailLabel: 'Paiement attendu' });
  assert.equal(model({ ...quoted, devisEnvoyeLe: null }, base).payment.sentAt, null);
  assert.equal(model({ ...quoted, devisEnvoyeLe: '2099-01-01' }, base).payment.sentAt, null);
});

test('« Paiement » says Payé only for a complete recorded payment; contradictions ask for a check', () => {
  const sent = { id: 'p', ref: 'EXP-PAY', statut: 'devis_envoye', devisTotal: 100, devisBrouillon: false, quoteVersion: 1, devisEnvoyeLe: '2026-10-01T08:00:00Z' };
  const at = { now: Date.parse('2026-10-03T12:00:00Z') };
  const label = fields => { const { stateLabel, detailLabel } = model({ ...sent, ...fields }, at).payment; return [stateLabel, detailLabel]; };
  assert.deepEqual(label({}), ['Non payé', 'Paiement attendu']);
  assert.deepEqual(label({ devisBrouillon: true }), ['Non payé', 'À recalculer'], 'A revised quote is not a payment anomaly.');
  assert.deepEqual(label({ statut: 'en_preparation', devisEnvoyeLe: null }), ['Non payé', 'Devis à envoyer']);
  assert.deepEqual(label({ statut: 'paye', paiementMontant: 100, paiementDate: '2026-10-02T08:00:00Z' }), ['Payé', 'Payé']);
  assert.deepEqual(label({ statut: 'paye', paiementMontant: null, paiementDate: null }), ['À vérifier', 'Paiement à vérifier'], 'A paid status without a recorded payment is never shown as paid.');
  assert.deepEqual(label({ devisSnapshot: { amounts: { total: 90 } } }), ['À vérifier', 'Paiement à vérifier'], 'Conflicting amounts ask for a check.');
});

test('a partial capture does not become paid because its status says paye', () => {
  const current = { ...paid, paiementMontant: 30 };
  const row = model(current, { ...base, actions: [action('departure')] });
  assert.deepEqual(row.payment, { requested: 100, paid: 30, remaining: 70, sentAt: quoted.devisEnvoyeLe, stateLabel: 'Non payé', detailLabel: 'Paiement partiel' });
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
  const overpaid = model({ ...paid, paiementMontant: 110 }, base).payment;
  assert.equal(overpaid.stateLabel, 'À vérifier'); assert.equal(overpaid.detailLabel, 'Trop-perçu à vérifier');
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
  // Like the dossier's own Départ field (« Départ : à choisir »).
  assert.equal(row.departure.label, 'À choisir'); assert.equal(row.departure.destination, 'Destination à préciser');
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
  assert.equal(row.payment.requested, 0); assert.equal(row.payment.stateLabel, 'Non payé'); assert.equal(row.payment.detailLabel, 'Aucun règlement demandé');
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

// The list of 7 October: EXP-2YE537, two outgoing parcels, the divisor of the app (5000).
const twoParcels = { ...prepared, outgoingParcelCount: 2, finalPackages: [{ dimL: 31, dimW: 22, dimH: 13, poids: 2 }, { dimL: 19.5, dimW: 17, dimH: 11, poids: 1 }] };
const nbsp = text => text.replace(/ kg/g, '\u00a0kg');

test('each outgoing parcel shows its volumetric weight and several parcels add their total', () => {
  const row = model(twoParcels, base);
  assert.deepEqual(row.optimizedParcels.map(parcel => [parcel.label, parcel.sides, parcel.dimensions]), [['Colis 1', ['31', '22', '13'], '31 × 22 × 13 cm'], ['Colis 2', ['19,5', '17', '11'], '19,5 × 17 × 11 cm']]);
  assert.deepEqual(row.optimizedParcels.map(parcel => parcel.volumetricWeight), [8866 / 5000, 3646.5 / 5000], 'Unrounded L × l × h ÷ divisor.');
  assert.equal(row.optimizedVolumetricTotal, 8866 / 5000 + 3646.5 / 5000);
  assert.deepEqual([row.optimizedVolumetricDivisor, row.optimizedVolumetricSource], [5000, 'settings']);
  assert.deepEqual(dossierDimensionsLines(row), [nbsp('Colis 1 : 31 × 22 × 13 cm · 1,77 kg vol.'), nbsp('Colis 2 : 19,5 × 17 × 11 cm · 0,73 kg vol.'), nbsp('Total : 2,5 kg vol.')]);
  assert.deepEqual(row.optimizedDimensions, ['Colis 1 : 31 × 22 × 13 cm', 'Colis 2 : 19,5 × 17 × 11 cm'], 'The geometric lines stay available.');
  assert.equal(row.optimizedWeight, 3, '« Poids (kg) » keeps the real weight.');
  // One parcel keeps no « Colis 1 : » and no total line.
  const one = model({ ...twoParcels, outgoingParcelCount: 1, finalPackages: [twoParcels.finalPackages[0]] }, base);
  assert.deepEqual(dossierDimensionsLines(one), [nbsp('31 × 22 × 13 cm · 1,77 kg vol.')]);
  assert.equal(volumetricWeightLabel(8866 / 5000), nbsp('1,77 kg vol.'));
  for (const value of [null, undefined, NaN, Infinity, -1, '2']) assert.equal(volumetricWeightLabel(value), null);
});

test('the volumetric divisor comes from the settings, or from the saved quote of exactly these parcels', () => {
  assert.deepEqual(dossierDimensionsLines(model(twoParcels, { ...base, settings: { diviseurVolumetrique: 6000 } })), [nbsp('Colis 1 : 31 × 22 × 13 cm · 1,48 kg vol.'), nbsp('Colis 2 : 19,5 × 17 × 11 cm · 0,61 kg vol.'), nbsp('Total : 2,09 kg vol.')]);
  assert.equal(model(twoParcels, { ...base, settings: { volumetricDivisor: '4000' } }).optimizedVolumetricDivisor, 4000);
  // What was billed: the saved quote's divisor, while its parcels are the current ones.
  const savedQuote = { inputs: { volumetricDivisor: 4000, finalPackages: [{ dimL: 31, dimW: 22, dimH: 13, poids: 2 }, { dimL: 19.5, dimW: 17, dimH: 11, poids: 1 }] }, amounts: { total: 50 } };
  const quoted = model({ ...twoParcels, devisSnapshot: savedQuote }, { ...base, settings: { diviseurVolumetrique: 6000 } });
  assert.deepEqual([quoted.optimizedVolumetricDivisor, quoted.optimizedVolumetricSource], [4000, 'quote']);
  assert.deepEqual(dossierDimensionsLines(quoted), [nbsp('Colis 1 : 31 × 22 × 13 cm · 2,22 kg vol.'), nbsp('Colis 2 : 19,5 × 17 × 11 cm · 0,91 kg vol.'), nbsp('Total : 3,13 kg vol.')]);
  // Stored as strings by an older version: same parcels.
  assert.equal(model({ ...twoParcels, finalPackages: twoParcels.finalPackages.map(box => ({ ...box, dimL: String(box.dimL) })), devisSnapshot: savedQuote }, base).optimizedVolumetricSource, 'quote');
  // Another parcel, another weight, another order or an invalid saved divisor: the settings apply.
  for (const finalPackages of [[savedQuote.inputs.finalPackages[0], { dimL: 19.5, dimW: 17, dimH: 12, poids: 1 }], [savedQuote.inputs.finalPackages[0], { dimL: 19.5, dimW: 17, dimH: 11, poids: 1.5 }], [...savedQuote.inputs.finalPackages].reverse()])
    assert.equal(model({ ...twoParcels, finalPackages, devisSnapshot: savedQuote }, { ...base, settings: { diviseurVolumetrique: 6000 } }).optimizedVolumetricDivisor, 6000);
  assert.equal(model({ ...twoParcels, outgoingParcelCount: 1, finalPackages: [twoParcels.finalPackages[0]], devisSnapshot: savedQuote }, base).optimizedVolumetricSource, 'settings', 'One parcel left: the quote no longer matches.');
  for (const volumetricDivisor of [0, -5000, 'x', null]) assert.equal(model({ ...twoParcels, devisSnapshot: { inputs: { ...savedQuote.inputs, volumetricDivisor } } }, base).optimizedVolumetricSource, 'settings');
});

test('an invalid divisor leaves the dimensions alone, never « NaN »', () => {
  for (const settings of [{ diviseurVolumetrique: 0 }, { diviseurVolumetrique: -1 }, { diviseurVolumetrique: 'abc' }, { diviseurVolumetrique: '' }, { volumetricDivisor: null, diviseurVolumetrique: Infinity }]) {
    const row = model(twoParcels, { ...base, settings });
    assert.deepEqual(row.optimizedParcels.map(parcel => parcel.volumetricWeight), [null, null]);
    assert.equal(row.optimizedVolumetricTotal, null); assert.equal(row.optimizedVolumetricDivisor, null);
    assert.deepEqual(dossierDimensionsLines(row), ['Colis 1 : 31 × 22 × 13 cm', 'Colis 2 : 19,5 × 17 × 11 cm']);
    assert.doesNotMatch(JSON.stringify(buildDossierTableExportRows([twoParcels], [], new Map([[twoParcels.id, row]]), 'daily', TABLE_COLUMNS.daily)), /NaN|undefined|null|vol\./);
  }
  // Before the optimisation: nothing, whatever the divisor.
  const before = model(dossier, base);
  assert.deepEqual([before.optimizedParcels, before.optimizedVolumetricTotal, before.optimizedVolumetricDivisor, dossierDimensionsLines(before)], [[], null, null, []]);
});

test('the export and the column filter carry the volumetric text of the cell', () => {
  const row = model(twoParcels, base);
  const [exported] = buildDossierTableExportRows([twoParcels], [], new Map([[twoParcels.id, row]]), 'daily', TABLE_COLUMNS.daily);
  assert.equal(exported['Dimensions finales'], nbsp('Colis 1 : 31 × 22 × 13 cm · 1,77 kg vol.\nColis 2 : 19,5 × 17 × 11 cm · 0,73 kg vol.\nTotal : 2,5 kg vol.'));
  assert.equal(exported['Poids final (kg)'], 3);
  const column = TABLE_COLUMNS.daily.find(item => item.key === 'optimizedDimensions');
  assert.match(column.filter.text({ model: row }), /0,73\u00a0kg vol\. · Total : 2,5\u00a0kg vol\.$/);
  assert.equal(column.filter.text({ model: model(dossier, base) }), null);
  assert.equal(column.sort.value({ model: row }), 'Colis 1 : 31 × 22 × 13 cm · Colis 2 : 19,5 × 17 × 11 cm', 'The sort order is unchanged.');
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
    const { rows, formats } = buildDossierTableExport(items, [], models, view, columns);
    // A shown amount stays a number the spreadsheet adds up; its format writes its state after it.
    assert.deepEqual(rows.map(row => row['Prix du devis']), [83.47, 100, 0]);
    assert.deepEqual(formats.map(format => format['Prix du devis']), ['#,##0.00 "€ · Brouillon"', '#,##0.00 "€ · À revoir"', '#,##0.00 "€"']);
    assert.equal(rows[0]['Poids final (kg)'], 2); assert.equal(formats[0]['Poids final (kg)'], '#,##0.00');
    assert.deepEqual(buildDossierTableExportRows(items, [], models, view, columns), rows);
  }
  for (const key of ['requested', 'taxes', 'paid', 'remaining']) assert.equal(TABLE_COLUMNS.payments.find(column => column.key === key).financial, true);
  for (const view of ['daily', 'departures']) assert.equal(TABLE_COLUMNS[view].find(column => column.key === 'taxes').financial, true);
});

test('short header labels keep the words of their full label, in order, and never reach exports', () => {
  const words = text => text.toLocaleLowerCase('fr').split(/\s+/).filter(Boolean);
  const shortened = new Map();
  for (const [view, columns] of Object.entries(TABLE_COLUMNS)) for (const column of columns) {
    if (!column.shortLabel) continue;
    // WCAG 2.5.3: the visible short text must be findable inside the accessible full label.
    let cursor = 0;
    const full = words(column.label);
    for (const word of words(column.shortLabel)) {
      const index = full.indexOf(word, cursor);
      assert.ok(index >= 0, `${view}/${column.key}: “${column.shortLabel}” is not contained in “${column.label}”.`);
      cursor = index + 1;
    }
    assert.notEqual(column.shortLabel, column.label);
    shortened.set(`${view}/${column.key}`, column.shortLabel);
  }
  assert.equal(shortened.get('daily/requested'), 'Prix');
  assert.equal(shortened.has('payments/requested'), false, 'The payment “Demandé” column keeps its own label.');
  assert.deepEqual(Object.fromEntries([...shortened].map(([key, value]) => [key.split('/')[1], value])), {
    receivedAt: 'Réception', statusLabel: 'Statut', statut: 'Travail', cartons: 'Cartons', optimizedDimensions: 'Dimensions', optimizedWeight: 'Poids (kg)',
    requested: 'Prix', taxes: 'Taxes', remaining: 'Reste', sentAt: 'Devis envoyé', departure: 'Départ', packages: 'Colis', consentRequestedAt: 'Demande envoyée',
  });
  for (const view of Object.keys(TABLE_COLUMNS)) {
    const exported = dossierTableExportColumns(view, TABLE_COLUMNS[view]);
    assert.deepEqual(exported.map(column => column.label), TABLE_COLUMNS[view].filter(column => exported.some(item => item.key === column.key)).map(column => column.label));
    assert.ok(exported.every(column => !('shortLabel' in column)));
  }
  assert.deepEqual(dossierTableExportColumns('daily', TABLE_COLUMNS.daily).map(column => column.label), ['Référence', 'Client', 'Dernière réception', 'Statut du dossier', 'Paiement', 'Travail à faire', 'Qui s’en occupe', 'Casier', 'Cartons reçus', 'Dimensions finales', 'Poids final (kg)', 'Prix du devis', 'Taxes calculées']);
});

test('the server relance before the departure closing is work to do, not an awaited consent', () => {
  const waiting = { ...dossier, statut: 'attente_feu_vert', feuVert: 'en_attente' };
  for (const hint of ['Relancer le client avant la clôture du départ', 'Demander l’accord avant la clôture du départ', "Demander l'accord avant la clôture du départ"]) {
    const row = model(waiting, { ...base, actions: [action('reception', { action_hint: hint, due_at: '2026-10-03T15:00:00Z' })], scope: 'pool' });
    assert.equal(row.matchesScope, true, hint); assert.equal(actionWaiting(row.action), false);
    assert.equal(row.action.blocked_reason, undefined); assert.equal(row.title, hint);
  }
  // Any other hint, or none, keeps the awaited consent blocked.
  for (const changes of [{}, { action_hint: 'Relancer le client' }, { action_hint: 'Préparer une relance avant la clôture du départ' }]) {
    assert.equal(model(waiting, { ...base, actions: [action('reception', changes)], scope: 'pool' }).matchesScope, false, JSON.stringify(changes));
    assert.equal(model(waiting, { ...base, actions: [action('reception', changes)] }).action.blocked_reason, 'Accord client attendu');
  }
  const wait = model({ ...waiting, attenteClientDate: '2026-10-01T08:00:00Z' }, { ...base, actions: [action('reception')] });
  assert.equal(wait.action.blocked_reason, 'Attente demandée par le client', 'A voluntary wait stays blocked.');
});

test('a desired day without a departure reads « Souhaité le … · à créer » and sorts on that day', () => {
  const wish = model({ ...dossier, departSouhaite: '2026-11-19' }, base);
  assert.equal(wish.departure.label, 'Souhaité le 19/11/2026 · à créer');
  assert.equal(model({ ...dossier, departSouhaite: '2026-11-19', envoi: 'missing' }, base).departure.label, 'Départ à vérifier', 'An assigned departure wins over the wish.');
  const column = TABLE_COLUMNS.departures.find(item => item.key === 'departure');
  const rows = [
    { ...dossier, id: 'late', departSouhaite: '2026-11-19' },
    { ...dossier, id: 'none' },
    { ...dossier, id: 'planned', envoi: 'departure' },
    { ...dossier, id: 'early', departSouhaite: '2026-10-08' },
  ];
  const envois = [{ id: 'departure', date: '2026-10-15', destinationCode: '974', statut: 'planifie' }];
  const models = new Map(rows.map(row => [row.id, model(row, { ...base, envois })]));
  assert.deepEqual(sortDossierTableRows(rows, { column, direction: 'asc', models, envois }).map(row => row.id), ['early', 'planned', 'late', 'none']);
  assert.deepEqual(sortDossierTableRows(rows, { column, direction: 'desc', models, envois }).map(row => row.id), ['late', 'planned', 'early', 'none']);
  const [exported] = buildDossierTableExportRows([rows[0]], [], models, 'departures', [{ key: 'departure', label: 'Départ prévu' }]);
  assert.deepEqual(exported, { 'Départ prévu': 'Souhaité le 19/11/2026 · à créer' });
});

test('a desired day reads « départ prévu, à affecter » once its day has a departure, « date passée » once gone', () => {
  const client = { cp: '97400' };
  const nov19 = { id: 'nov19', date: '2026-11-19', destinationCode: '974', statut: 'planifie' };
  assert.equal(model({ ...dossier, departSouhaite: '2026-11-19' }, { ...base, client, envois: [nov19] }).departure.label, 'Souhaité le 19/11/2026 · départ prévu, à affecter');
  assert.equal(model({ ...dossier, departSouhaite: '2026-11-19' }, { ...base, client, envois: [{ ...nov19, statut: 'parti' }] }).departure.label, 'Souhaité le 19/11/2026 · départ clôturé');
  assert.equal(model({ ...dossier, departSouhaite: '2026-11-19' }, { ...base, client, envois: [{ ...nov19, destinationCode: '976' }] }).departure.label, 'Souhaité le 19/11/2026 · à créer', 'Another destination does not count.');
  assert.equal(model({ ...dossier, departSouhaite: '2026-10-01' }, { ...base, client }).departure.label, 'Souhaité le 01/10/2026 · date passée');
});

test('a departure of today is not past: days are read on Paris time', () => {
  // 23:30 UTC on 1 October is already 2 October in Paris.
  const envois = [{ id: 'departure', date: '2026-10-02', destinationCode: '974', statut: 'planifie' }];
  assert.equal(model({ ...paid, envoi: 'departure' }, { ...base, envois, now: Date.parse('2026-10-01T22:30:00Z') }).departure.label, 'Prévu le 02/10/2026');
  assert.equal(model({ ...paid, envoi: 'departure' }, { ...base, envois, now: Date.parse('2026-10-02T22:30:00Z') }).departure.label, 'Date dépassée · 02/10/2026');
});

test('« Accords clients » shows the consent, its request and last relance, without status or payment columns', () => {
  assert.deepEqual(TABLE_COLUMNS.accords.map(column => [column.key, column.label]), [
    ['ref', 'Référence'], ['client', 'Client'], ['receivedAt', 'Dernière réception'], ['consentState', 'Accord'],
    ['consentRequestedAt', 'Demande envoyée le'], ['lastRelanceAt', 'Dernière relance'], ['cartons', 'Cartons reçus'],
    ['casier', 'Casier'], ['departure', 'Départ prévu'], ['action', 'Action'],
  ]);
  assert.equal(TABLE_COLUMNS.accords.some(column => column.financial || ['statusLabel', 'paymentState'].includes(column.key)), false);
  // Cartons, Casier and Départ are the very columns of the other views.
  for (const key of ['casier', 'cartons']) assert.equal(TABLE_COLUMNS.accords.find(column => column.key === key), TABLE_COLUMNS.daily.find(column => column.key === key));
  assert.equal(TABLE_COLUMNS.accords.find(column => column.key === 'departure'), TABLE_COLUMNS.departures.find(column => column.key === 'departure'));
  assert.deepEqual(TABLE_COLUMNS.accords.find(column => column.key === 'consentState').filter.choices, ['À soumettre', 'Réponse attendue', 'Le client attend', 'Attente terminée']);
  // Its dossiers are worked through their reception and consent task.
  const measured = { ...dossier, statut: 'mesure', feuVert: 'en_attente' };
  assert.equal(model(measured, { ...base, actions: [action('documents'), action('reception')], view: 'accords' }).action.kind, 'reception');
});

const consentRows = [
  { ...dossier, id: 'waiting', ref: 'EXP-WAIT', statut: 'attente_feu_vert', feuVert: 'en_attente', attenteClientDate: '2026-10-01T08:00:00Z', attenteClientUntil: '2026-10-25T08:00:00Z', demandeFeuVertEnvoyeeAt: '2026-09-30T08:00:00Z', messages: [] },
  { ...dossier, id: 'submit', ref: 'EXP-SUBMIT', statut: 'mesure', feuVert: 'en_attente', casier: 'B-2' },
  { ...dossier, id: 'awaited', ref: 'EXP-AWAIT', statut: 'attente_feu_vert', feuVert: 'en_attente', demandeFeuVertEnvoyeeAt: '2026-10-01T09:00:00Z', departSouhaite: '2026-11-19',
    messages: [{ template: 'demande_feu_vert', statut: 'envoye', createdAt: '2026-10-01T09:00:00Z' }, { template: 'relance_feu_vert', statut: 'envoye', createdAt: '2026-10-01T15:00:00Z' }, { template: 'relance_feu_vert', statut: 'echec', canal: 'telegram', createdAt: '2026-10-02T09:00:00Z' }] },
];

test('the consent columns sort on their real values, unknowns last in either direction', () => {
  const column = key => TABLE_COLUMNS.accords.find(item => item.key === key);
  const order = (key, direction) => sortDossierTableRows(consentRows, { column: column(key), direction }).map(row => row.id);
  // « À soumettre », « Le client attend », « Réponse attendue ».
  assert.deepEqual(order('consentState', 'asc'), ['submit', 'waiting', 'awaited']);
  assert.deepEqual(order('consentState', 'desc'), ['awaited', 'waiting', 'submit']);
  assert.deepEqual(order('consentRequestedAt', 'asc'), ['waiting', 'awaited', 'submit']);
  assert.deepEqual(order('consentRequestedAt', 'desc'), ['awaited', 'waiting', 'submit']);
  assert.deepEqual(order('lastRelanceAt', 'asc'), ['awaited', 'waiting', 'submit']);
  assert.deepEqual(order('lastRelanceAt', 'desc'), ['awaited', 'waiting', 'submit']);
});

test('the accords export uses the screen wording and only the columns of this view', () => {
  const models = new Map(consentRows.map(row => [row.id, model(row, base)]));
  const exported = buildDossierTableExportRows(consentRows, [], models, 'accords', TABLE_COLUMNS.accords);
  assert.deepEqual(Object.keys(exported[0]), ['Référence', 'Client', 'Dernière réception', 'Accord', 'Demande envoyée le', 'Dernière relance', 'Cartons reçus', 'Casier', 'Départ prévu']);
  assert.deepEqual(exported.map(row => [row.Référence, row.Accord, row['Demande envoyée le'], row['Dernière relance'], row['Départ prévu']]), [
    ['EXP-WAIT', 'Le client attend · jusqu’au 25/10', '30/09/2026', 'Aucune relance', 'À choisir'],
    ['EXP-SUBMIT', 'À soumettre', 'Pas encore envoyée', 'Aucune relance', 'À choisir'],
    // The last relance failed: its date never reads as a sent relance.
    ['EXP-AWAIT', 'Réponse attendue', '01/10/2026', '02/10/2026 · Envoi non confirmé', 'Souhaité le 19/11/2026 · à créer'],
  ]);
  assert.equal(exported[1].Casier, 'B-2');
  // A column of another view never reaches this export.
  assert.deepEqual(dossierTableExportColumns('accords', TABLE_COLUMNS.daily).map(column => column.key), ['ref', 'client', 'receivedAt', 'casier', 'cartons']);
  assert.deepEqual(dossierTableExportColumns('daily', TABLE_COLUMNS.accords).map(column => column.key), ['ref', 'client', 'receivedAt', 'cartons', 'casier']);
});

test('an ended wait reads « Attente terminée », to re-examine, on screen and in the export, on the model’s clock', () => {
  const after = Date.parse('2026-10-26T08:00:00Z');
  const ended = model(consentRows[0], { ...base, now: after });
  assert.deepEqual(ended.consent, { stage: 'client_waiting', label: 'Attente terminée', until: '2026-10-25T08:00:00Z', over: true });
  assert.deepEqual(model(consentRows[0], base).consent.over, false, 'On 2 October the wait still runs.');
  const exported = buildDossierTableExportRows([consentRows[0]], [], new Map([[consentRows[0].id, ended]]), 'accords', TABLE_COLUMNS.accords);
  assert.equal(exported[0].Accord, 'Attente terminée le 25/10 · à réexaminer');
  // The « Accord » column sorts and filters on that same wording.
  const column = TABLE_COLUMNS.accords.find(item => item.key === 'consentState');
  assert.equal(column.sort.value({ dossier: consentRows[0], model: ended }), 'Attente terminée');
  assert.equal(column.sort.value({ dossier: consentRows[0] }), 'Le client attend', 'Without a model, the current clock decides.');
  // Neither the request nor the relance is ever an empty « Non renseigné ».
  assert.equal(consentRequestLabel(consentRows[1]), 'Pas encore envoyée');
  assert.equal(consentRequestLabel(consentRows[0]), '30/09/2026');
});

test('a task the dossier has outgrown offers to refresh the tasks right in its cell', () => {
  // A preparation task while the dossier is already paid: « Le dossier a changé. Actualisez les tâches. »
  const stale = model(paid, { ...base, actions: [action('preparation')] });
  assert.equal(stale.action.blocked_reason, STALE_TASK_REASON);
  assert.equal(stale.refreshable, true);
  assert.equal(model(dossier, { ...base, actions: [action('preparation')] }).refreshable, false, 'A task that still fits its dossier has nothing to refresh.');
  assert.equal(model(paid, { ...base, actions: [action('preparation', { blocked_reason: 'Raison du serveur' })] }).refreshable, false, 'A reason given by the server stays as it is.');
  assert.equal(model(paid, { ...base, workReady: false }).refreshable, undefined);
});

test('French counts: 0 and 1 in the singular, then the plural', () => {
  assert.deepEqual([0, 1, 2, 12].map(count => countLabel(count, 'dossier')), ['0 dossier', '1 dossier', '2 dossiers', '12 dossiers']);
  assert.equal(countLabel(1234, 'dossier'), `${new Intl.NumberFormat('fr-FR').format(1234)} dossiers`);assert.match(countLabel(1234, 'dossier'), /^1\D234 dossiers$/);
  assert.equal(countWord(1, 'sélectionné', 'sélectionnés'), 'sélectionné');assert.equal(countWord(3, 'sélectionné', 'sélectionnés'), 'sélectionnés');
  assert.equal(parallelTasksLabel(1), '1 autre tâche en parallèle');assert.equal(parallelTasksLabel(2), '2 autres tâches en parallèle');
  const row = model(dossier, { ...base, actions: [action('preparation'), action('documents'), action('quote', { assignee_id: 'other' })] });
  const exported = buildDossierTableExportRows([dossier], [], new Map([[dossier.id, row]]), 'daily', TABLE_COLUMNS.daily);
  assert.match(exported[0]['Travail à faire'], /2 autres tâches en parallèle$/);
  assert.doesNotMatch(JSON.stringify(exported), /\(s\)/);
});

test('a card leaves out the facts that have nothing to say yet', () => {
  const weight = TABLE_COLUMNS.daily.find(column => column.key === 'optimizedWeight'), dimensions = TABLE_COLUMNS.daily.find(column => column.key === 'optimizedDimensions');
  const before = model(dossier, base), after = model(prepared, base);
  assert.equal(dossierFactHasValue(weight, before), false);assert.equal(dossierFactHasValue(dimensions, before), false);
  assert.equal(dossierFactHasValue(weight, after), true);assert.equal(dossierFactHasValue(dimensions, after), true);
  for (const column of TABLE_COLUMNS.daily.filter(item => !['optimizedWeight', 'optimizedDimensions'].includes(item.key))) assert.equal(dossierFactHasValue(column, before), true, column.key);
});

test('a bulk status change offers only the next steps valid for every selected dossier, in the order of the chain', () => {
  const at = (...statuts) => statuts.map((statut, index) => ({ id: `d${index}`, statut }));
  const offered = (...statuts) => bulkStatusPlan(at(...statuts)).choices.map(step => step.label);
  // The order of the journey; « Expédié » first, but only ever through the departure.
  // The labels of the status pills (STATUTS), so the bar, its dialogs and the rows read the same.
  assert.deepEqual(BULK_STATUS_STEPS.map(step => step.label), ['Expédié', 'En vol', 'En dédouanement', 'Arrivé destination', 'En cours de livraison', 'Livré']);
  for (const step of BULK_STATUS_STEPS) assert.equal(step.label, STATUTS[step.statut].label, step.statut);
  // fn_valider_transition_statut: expedie → transit, transit → dedouanement | arrive, dedouanement → arrive, arrive → livraison, livraison → livre.
  assert.deepEqual(offered('expedie', 'expedie'), ['En vol']);
  assert.deepEqual(offered('transit'), ['En dédouanement', 'Arrivé destination']);
  assert.deepEqual(offered('transit', 'dedouanement'), ['Arrivé destination'], 'Arrivé follows both steps.');
  assert.deepEqual(offered('arrive'), ['En cours de livraison']);
  assert.deepEqual(offered('livraison', 'livraison'), ['Livré']);
  // guard_colis_departure refuses a direct « Expédié »: the departure confirms it.
  assert.deepEqual(bulkStatusPlan(at('paye', 'paye')), { choices: [], reason: BULK_STATUS_REASONS.departure, departure: true });
  assert.deepEqual(bulkStatusPlan(at('expedie', 'transit')), { choices: [], reason: BULK_STATUS_REASONS.mixed, departure: false });
  assert.deepEqual(bulkStatusPlan(at('paye', 'expedie')), { choices: [], reason: BULK_STATUS_REASONS.mixed, departure: false });
  for (const statut of ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement', 'refuse_client', 'annule'])
    assert.deepEqual(bulkStatusPlan(at(statut, 'transit')), { choices: [], reason: BULK_STATUS_REASONS.beforeDeparture, departure: false }, statut);
  assert.deepEqual(bulkStatusPlan(at('livre', 'livre')), { choices: [], reason: BULK_STATUS_REASONS.delivered, departure: false });
  assert.deepEqual(bulkStatusPlan([]), { choices: [], reason: null, departure: false });
  // Every offered step is one the database accepts from each dossier.
  const allowed = { paye: ['expedie'], expedie: ['transit'], transit: ['dedouanement', 'arrive'], dedouanement: ['arrive'], arrive: ['livraison'], livraison: ['livre'] };
  for (const first of Object.keys(allowed)) for (const second of Object.keys(allowed))
    for (const step of bulkStatusPlan(at(first, second)).choices) assert.ok(allowed[first].includes(step.statut) && allowed[second].includes(step.statut), `${first} + ${second} → ${step.statut}`);
  assert.ok(BULK_STATUS_STEPS.filter(step => !step.viaDeparture).every(step => step.permission === 'perm_colis_changer_statut_expedition'));
});

test('a refused bulk change keeps the server’s reason, in plain words', () => {
  assert.equal(bulkRefusalReason({ message: 'Transition invalide : livre → transit' }), 'Passage de « Livré » à « En vol » refusé par le serveur.');
  assert.equal(bulkRefusalReason(new Error('Permission insuffisante pour ce changement de statut')), 'Permission insuffisante pour ce changement de statut');
  assert.equal(bulkRefusalReason({ message: 'Ce dossier a été modifié par un collègue. Rechargez-le avant de réessayer.' }), 'Ce dossier a été modifié par un collègue. Rechargez-le avant de réessayer.');
  for (const empty of [null, {}, { message: '  ' }]) assert.equal(bulkRefusalReason(empty), 'Refusé par le serveur, sans motif précisé.');
});

test('the client column sorts on the name the rows show, family name first', () => {
  const column = TABLE_COLUMNS.daily.find(item => item.key === 'client');
  assert.equal(column.sort.value({ client: { nom: 'Payet Flavie', nomFamille: 'Payet', prenom: 'Flavie' } }), 'Payet Flavie');
  assert.equal(column.sort.value({ client: undefined }), null);
});

// ── « Taxes calculées » ─────────────────────────────────────────────────────
// The saved quote of 1 October: OM 10, OMR 5, TVA 5 on a total of 100.
const savedQuote = (amounts, extra = {}) => ({ version: 1, amounts: { transport: 80, fees: 0, ...amounts }, inputs: { client: { type: 'particulier' } }, ...extra });
const taxed = { ...quoted, devisSnapshot: savedQuote({ om: 10, omr: 5, tva: 5, total: 100 }) };
const taxesOf = dossier => model(dossier, base).quoteTaxes;

test('« Taxes calculées » adds OM, OMR and TVA of the saved quote whose price the list shows, in cents', () => {
  assert.deepEqual(taxesOf(taxed), { amount: 20, stateLabel: '', pro: false });
  assert.equal(model(taxed, base).quotePrice.amount, 100, 'The same quote gives the price.');
  // 0,10 + 0,20 + 0,30 is 0,60, never 0.6000000000000001.
  assert.equal(taxesOf({ ...taxed, devisTotal: 80.6, devisSnapshot: savedQuote({ om: 0.1, omr: 0.2, tva: 0.3, total: 80.6 }) }).amount, 0.6);
  // Amounts stored as text by an older version are still the saved quote's.
  assert.equal(taxesOf({ ...taxed, devisSnapshot: savedQuote({ om: '10', omr: '5', tva: '5.00', total: 100 }) }).amount, 20);
  // Never the raw columns, never a recalculation: the frozen amounts only.
  assert.equal(taxesOf({ ...taxed, devisOM: 99, devisOMR: 99, devisTVA: 99 }).amount, 20);
});

test('without a price the taxes repeat its state; a price with a state gives its taxes the same state', () => {
  // No quote yet, or a quote to review: the taxes say what the price says.
  assert.deepEqual(taxesOf(dossier), { amount: null, stateLabel: 'À calculer', pro: false });
  assert.deepEqual(taxesOf({ ...taxed, quoteNeedsReview: true }), { amount: null, stateLabel: 'À revoir', pro: false });
  assert.deepEqual(taxesOf({ ...taxed, statut: 'mesure' }), { amount: null, stateLabel: 'À revoir', pro: false });
  // Another version of the quote: the price is to review, so are its taxes.
  assert.deepEqual(taxesOf({ ...taxed, devisSnapshot: savedQuote({ om: 10, omr: 5, tva: 5, total: 100 }, { version: 2 }) }), { amount: null, stateLabel: 'À revoir', pro: false });
  // A draft: its taxes are a draft too.
  const draft = { ...prepared, devisTotal: 83.47, devisBrouillon: true, quoteVersion: 3, devisSnapshot: savedQuote({ om: 4.1, omr: 1.2, tva: 7.37, total: 83.47 }, { version: 3 }) };
  assert.deepEqual(model(draft, base).quotePrice, { amount: 83.47, stateLabel: 'Brouillon' });
  assert.deepEqual(taxesOf(draft), { amount: 12.67, stateLabel: 'Brouillon', pro: false });
  // A paid quote whose raw total disagrees keeps its frozen price « À revoir »: its taxes too.
  const disputed = { ...paid, devisTotal: 999, devisSnapshot: savedQuote({ om: 10, omr: 5, tva: 5, total: 100 }) };
  assert.deepEqual(model(disputed, base).quotePrice, { amount: 100, stateLabel: 'À revoir' });
  assert.deepEqual(taxesOf(disputed), { amount: 20, stateLabel: 'À revoir', pro: false });
});

test('a price without a usable saved quote behind it reads « À vérifier », never an invented amount', () => {
  assert.equal(TAXES_UNVERIFIED_LABEL, 'À vérifier');
  const unverified = { amount: null, stateLabel: TAXES_UNVERIFIED_LABEL, pro: false };
  // A former dossier: a price, raw tax columns, no saved quote.
  assert.deepEqual(taxesOf({ ...quoted, devisOM: 10, devisOMR: 5, devisTVA: 5 }), unverified);
  assert.equal(model({ ...quoted, devisOM: 10, devisOMR: 5, devisTVA: 5 }, base).quotePrice.amount, 100);
  for (const amounts of [{ om: 10, omr: 5, total: 100 }, { om: 10, omr: 5, tva: null, total: 100 }, { om: 10, omr: 5, tva: 'abc', total: 100 }, { om: 10, omr: 5, tva: Infinity, total: 100 },
    { om: NaN, omr: 5, tva: 5, total: 100 }, { om: -10, omr: 5, tva: 5, total: 100 }, { om: 10, omr: '', tva: 5, total: 100 }])
    assert.deepEqual(taxesOf({ ...taxed, devisSnapshot: savedQuote(amounts) }), unverified, JSON.stringify(amounts));
  // A saved quote without its total cannot be told to be the one priced.
  assert.deepEqual(taxesOf({ ...taxed, devisSnapshot: savedQuote({ om: 10, omr: 5, tva: 5, total: undefined }) }), unverified);
  assert.deepEqual(taxesOf({ ...taxed, devisSnapshot: { version: 1 } }), unverified);
});

test('a professional quote without tax reads « Sans taxes (pro) »; a private quote with taxes proven zero reads 0,00 €', () => {
  assert.equal(TAXES_PRO_LABEL, 'Sans taxes (pro)');
  const pro = { ...taxed, devisTotal: 80, devisSnapshot: savedQuote({ om: 0, omr: 0, tva: 0, total: 80 }, { inputs: { client: { type: 'pro' } } }) };
  assert.deepEqual(taxesOf(pro), { amount: 0, stateLabel: '', pro: true });
  assert.deepEqual(taxesOf({ ...pro, devisSnapshot: savedQuote({ om: 0, omr: 0, tva: 0, total: 80 }) }), { amount: 0, stateLabel: '', pro: false });
  // A professional quote that does carry taxes shows them.
  assert.deepEqual(taxesOf({ ...pro, devisTotal: 100, devisSnapshot: savedQuote({ om: 10, omr: 5, tva: 5, total: 100 }, { inputs: { client: { type: 'pro' } } }) }), { amount: 20, stateLabel: '', pro: false });
});

test('in « Paiements » the taxes go with « Demandé »: a draft or a quote to verify asks nothing, so neither do its taxes', () => {
  const payments = { ...base, view: 'payments' };
  const demanded = row => { const result = model(row, payments); return result.payment.requested ?? dossierTableMissingAmountLabel(result.payment, 'requested'); };
  // A sent quote: « Demandé » is its price, the taxes are its own.
  assert.equal(demanded(taxed), 100);
  assert.deepEqual(model(taxed, payments).quoteTaxes, { amount: 20, stateLabel: '', pro: false });
  // A draft: its price shows in « Travail quotidien » with its taxes; nothing is asked yet, so « Paiements » says « À calculer » twice.
  const draft = { ...prepared, devisTotal: 83.47, devisBrouillon: true, quoteVersion: 3, devisSnapshot: savedQuote({ om: 4.1, omr: 1.2, tva: 7.37, total: 83.47 }, { version: 3 }) };
  assert.deepEqual(taxesOf(draft), { amount: 12.67, stateLabel: 'Brouillon', pro: false });
  assert.equal(demanded(draft), 'À calculer');
  assert.deepEqual(model(draft, payments).quoteTaxes, { amount: null, stateLabel: 'À calculer', pro: false });
  // A paid quote whose records disagree: « Demandé » reads « À vérifier », so do its taxes.
  const disputed = { ...paid, devisTotal: 999, devisSnapshot: savedQuote({ om: 10, omr: 5, tva: 5, total: 100 }) };
  assert.equal(demanded(disputed), 'À vérifier');
  assert.deepEqual(model(disputed, payments).quoteTaxes, { amount: null, stateLabel: 'À vérifier', pro: false });
  // The other rules hold beside « Demandé »: a former quote « À vérifier », a professional one « Sans taxes (pro) ».
  assert.deepEqual(model({ ...quoted, devisOM: 10 }, payments).quoteTaxes, { amount: null, stateLabel: TAXES_UNVERIFIED_LABEL, pro: false });
  const pro = { ...taxed, devisTotal: 80, devisSnapshot: savedQuote({ om: 0, omr: 0, tva: 0, total: 80 }, { inputs: { client: { type: 'pro' } } }) };
  assert.deepEqual(model(pro, payments).quoteTaxes, { amount: 0, stateLabel: '', pro: true });
  // The two columns add up the same dossiers: a tax amount only beside a requested amount.
  const rows = [{ ...taxed, id: 'sent' }, { ...draft, id: 'draft' }, { ...disputed, id: 'disputed' }, { ...pro, id: 'pro' }, { ...dossier, id: 'new' }];
  const models = new Map(rows.map(row => [row.id, model(row, payments)]));
  const [requested, taxes] = ['requested', 'taxes'].map(key => TABLE_COLUMNS.payments.find(column => column.key === key));
  const counted = column => rows.filter(row => dossierTableNumber(column, { dossier: row, model: models.get(row.id) }) !== null).map(row => row.id);
  assert.deepEqual(counted(taxes), ['sent', 'pro']);
  assert.ok(counted(taxes).every(id => counted(requested).includes(id)));
  // The spreadsheet of « Paiements » says the same.
  const { rows: exported } = buildDossierTableExport(rows, [], models, 'payments', TABLE_COLUMNS.payments);
  assert.deepEqual(exported.map(row => [row['Demandé'], row['Taxes calculées']]), [[100, 20], ['À calculer', 'À calculer'], ['À vérifier', 'À vérifier'], [80, 0], ['À calculer', 'À calculer']]);
});

test('the taxes column is financial, sorts as a number and sits after the price (after « Demandé » in « Paiements »)', () => {
  const keys = view => TABLE_COLUMNS[view].map(column => column.key);
  for (const view of ['daily', 'departures']) assert.equal(keys(view)[keys(view).indexOf('requested') + 1], 'taxes', view);
  assert.equal(keys('payments')[keys('payments').indexOf('requested') + 1], 'taxes');
  assert.equal(keys('accords').includes('taxes'), false);
  const column = TABLE_COLUMNS.daily.find(item => item.key === 'taxes');
  assert.deepEqual([column.label, column.shortLabel, column.align, column.financial, column.sort.type], ['Taxes calculées', 'Taxes', 'right', true, 'number']);
  const rows = [{ ...taxed, id: 'twenty' }, { ...dossier, id: 'unknown' }, { ...taxed, id: 'six', devisTotal: 86, devisSnapshot: savedQuote({ om: 3, omr: 1, tva: 2, total: 86 }) }];
  const models = new Map(rows.map(row => [row.id, model(row, base)]));
  assert.deepEqual(sortDossierTableRows(rows, { column, models }).map(row => row.id), ['six', 'twenty', 'unknown']);
  assert.deepEqual(sortDossierTableRows(rows, { column, models, direction: 'desc' }).map(row => row.id), ['twenty', 'six', 'unknown']);
});

test('the export writes the taxes as a number in its format, or the cell’s wording', () => {
  const pro = { ...taxed, id: 'pro', devisTotal: 80, devisSnapshot: savedQuote({ om: 0, omr: 0, tva: 0, total: 80 }, { inputs: { client: { type: 'pro' } } }) };
  const draft = { ...prepared, id: 'draft', devisTotal: 83.47, devisBrouillon: true, quoteVersion: 3, devisSnapshot: savedQuote({ om: 4.1, omr: 1.2, tva: 7.37, total: 83.47 }, { version: 3 }) };
  const items = [{ ...taxed, id: 'taxed' }, pro, draft, { ...quoted, id: 'legacy' }, { ...dossier, id: 'new' }];
  for (const view of ['daily', 'payments', 'departures']) {
    // Each view exports the models of its screen: in « Paiements » the draft asks nothing yet (« Demandé »).
    const models = new Map(items.map(row => [row.id, model(row, { ...base, view })]));
    const { rows, formats } = buildDossierTableExport(items, [], models, view, TABLE_COLUMNS[view].filter(column => ['ref', 'taxes'].includes(column.key)));
    const payments = view === 'payments';
    assert.deepEqual(rows.map(row => row['Taxes calculées']), [20, 0, payments ? 'À calculer' : 12.67, 'À vérifier', 'À calculer'], view);
    assert.deepEqual(formats.map(format => format['Taxes calculées']), ['#,##0.00 "€"', '#,##0.00 "€";-#,##0.00 "€";"Sans taxes (pro)"', payments ? undefined : '#,##0.00 "€ · Brouillon"', undefined, undefined], view);
  }
  assert.equal(dossierTableExportColumns('accords', TABLE_COLUMNS.daily).some(column => column.key === 'taxes'), false, 'No taxes in « Accords clients ».');
});

test('each column that adds up reads the number of its cell, null when the cell shows none', () => {
  assert.deepEqual(Object.keys(DOSSIER_TOTAL_KINDS), ['cartons', 'packages', 'optimizedWeight', 'optimizedDimensions', 'requested', 'taxes', 'paid', 'remaining']);
  const column = key => [...TABLE_COLUMNS.daily, ...TABLE_COLUMNS.payments, ...TABLE_COLUMNS.departures].find(item => item.key === key && (key !== 'requested' || item.priceKind === 'quote'));
  const numbers = (row, keys) => keys.map(key => dossierTableNumber(column(key), { dossier: row, model: model(row, base) }));
  const keys = ['cartons', 'packages', 'optimizedWeight', 'optimizedDimensions', 'requested', 'taxes'];
  assert.deepEqual(numbers(taxed, keys), [3, 1, 2, 6000 / 5000, 100, 20]);
  // Before the optimisation: the cartons received only, the rest to come.
  assert.deepEqual(numbers(dossier, keys), [3, null, null, null, null, null]);
  const payments = TABLE_COLUMNS.payments.filter(item => ['requested', 'paid', 'remaining'].includes(item.key));
  assert.deepEqual(payments.map(item => dossierTableNumber(item, { dossier: paid, model: model({ ...paid, paiementMontant: 30 }, base) })), [100, 30, 70]);
  assert.deepEqual(payments.map(item => dossierTableNumber(item, { dossier: paid, model: model({ ...paid, paiementDate: null }, base) })), [100, null, null], 'A payment to verify has no amount paid nor left.');
  for (const key of ['ref', 'casier', 'receivedAt', 'statusLabel']) assert.equal(dossierTableNumber(column(key), { dossier: taxed, model: model(taxed, base) }), undefined, `${key} has no total.`);
});
