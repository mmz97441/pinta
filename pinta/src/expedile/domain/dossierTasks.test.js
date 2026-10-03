import test from 'node:test';
import assert from 'node:assert/strict';
import { DOSSIER_TASKS, dossierTaskUrl, previousDossierTask, nextDossierTask, resolveDossierTask, hasCurrentPreparation, dossierNextTask } from './dossierTasks.js';

const prepared = { id: 'dossier-a', statut: 'en_preparation', preparationCompositionVersion: 2, finalMeasurementsVersion: 2, outgoingParcelCount: 1, finalPackages: [{ dimL: 20, dimW: 30, dimH: 10, poids: 2 }], factures: [{ id: 'invoice-a', valide: true }] };

test('new consent reuses certified preparation and opens useful work without changing the dossier', () => {
  const dossier = { ...prepared, statut: 'autorise', feuVert: 'autorise', devisTotal: null, devisBrouillon: false, devisEnvoyeLe: '2026-09-17' };
  const before = structuredClone(dossier);
  assert.equal(resolveDossierTask(dossier), 'devis');
  assert.equal(dossierNextTask(dossier, permission => permission === 'perm_colis_calculer_devis'), 'devis');
  assert.equal(dossierNextTask({ ...dossier, finalMeasurementsVersion: 1 }), 'preparation');
  assert.equal(dossierNextTask({ ...dossier, factures: [] }), 'documents');
  assert.equal(dossierNextTask({ ...dossier, factures: [] }, undefined, { type: 'pro' }), 'devis');
  assert.equal(dossierNextTask({ ...dossier, feuVert: 'en_attente' }), 'accord');
  assert.equal(resolveDossierTask(dossier, '?section=preparation'), 'preparation');
  assert.deepEqual(dossier, before);
});

test('preparation certificate requires current versions and the exact physical package count', () => {
  assert.equal(hasCurrentPreparation(prepared), true);
  for (const patch of [{ outgoingParcelCount: null }, { outgoingParcelCount: 2 }, { outgoingParcelCount: '1' }, { finalMeasurementsVersion: null }, { preparationCompositionVersion: null }, { finalMeasurementsVersion: 1 }, { finalPackages: [] }, { finalPackages: {} }, { finalPackages: [{ ...prepared.finalPackages[0], poids: 0 }] }, { finalPackages: [{ ...prepared.finalPackages[0], dimL: true }] }]) {
    assert.equal(hasCurrentPreparation({ ...prepared, ...patch }), false, JSON.stringify(patch));
    assert.equal(dossierNextTask({ ...prepared, ...patch }), 'preparation');
  }
  const legacy = { ...prepared, finalPackages: null, finL: 20, finW: 30, finH: 10, finP: 2 };
  assert.equal(hasCurrentPreparation(legacy), true);
  assert.equal(hasCurrentPreparation({ ...legacy, finalPackages: [] }), false);
  assert.equal(hasCurrentPreparation({ ...legacy, outgoingParcelCount: null }), false);
});

test('next screen restores forward navigation after going back without wrapping the final task', () => {
  assert.equal(nextDossierTask('reception'), 'accord');
  assert.equal(nextDossierTask('preparation'), 'documents');
  assert.equal(nextDossierTask('documents'), 'devis');
  assert.equal(nextDossierTask(previousDossierTask('devis')), 'devis');
  assert.equal(nextDossierTask('livraison'), null);
  assert.equal(nextDossierTask('unknown'), null);
});

test('both directions skip invoice and quote screens not accessible to the operator', () => {
  const quoteOnly = permission => permission === 'perm_colis_calculer_devis';
  assert.equal(nextDossierTask('preparation', quoteOnly), 'devis');
  assert.equal(nextDossierTask(previousDossierTask('devis', quoteOnly), quoteOnly), 'devis');
  assert.equal(nextDossierTask('preparation', () => false), 'paiement');
  assert.equal(nextDossierTask('preparation', permission => permission === 'perm_factures_refuser'), 'documents');
  assert.equal(nextDossierTask('documents', permission => permission === 'perm_factures_refuser'), 'paiement');
});

test('previous screen follows the flow, skips inaccessible work and never wraps the first task', () => {
  assert.equal(previousDossierTask('devis'), 'documents');
  assert.equal(previousDossierTask('documents'), 'preparation');
  assert.equal(previousDossierTask('preparation'), 'accord');
  assert.equal(previousDossierTask('reception'), null);
  assert.equal(previousDossierTask('unknown'), null);
  const quoteOnly = permission => permission === 'perm_colis_calculer_devis';
  assert.equal(previousDossierTask('devis', quoteOnly), 'preparation');
  assert.equal(previousDossierTask('paiement', () => false), 'preparation');
  assert.equal(previousDossierTask('devis', permission => permission === 'perm_factures_refuser'), 'documents');
});

test('deep invoice links and legacy document actions always open verification, never quote', () => {
  const actions = [{ id: 'documents-action', colis_id: prepared.id, kind: 'documents' }, { id: 'quote-action', colis_id: prepared.id, kind: 'quote' }];
  assert.equal(resolveDossierTask(prepared, '?section=devis&action=documents-action', actions), 'documents');
  assert.equal(resolveDossierTask(prepared, '?action=quote-action', actions), 'devis');
  assert.equal(resolveDossierTask(prepared, '?section=documents&action=quote-action', actions), 'documents');
  assert.equal(resolveDossierTask(prepared, '?section=devis&action=quote-action&invoice=invoice-a', actions), 'documents');
  assert.equal(resolveDossierTask(prepared, '?action=documents-action', actions.map(action => ({ ...action, colis_id: 'other-dossier' }))), 'devis');
});

test('prepared dossiers open pending invoices or quote, without reopening completed preparation', () => {
  assert.equal(resolveDossierTask(prepared), 'devis');
  assert.equal(resolveDossierTask({ ...prepared, factures: [] }), 'documents');
  assert.equal(resolveDossierTask({ ...prepared, factures: [{ id: 'pending', valide: false }] }), 'documents');
  assert.equal(resolveDossierTask({ ...prepared, factures: [{ id: 'rejected', valide: true, rejetMotif: 'Page manquante' }] }), 'documents');
  assert.equal(resolveDossierTask({ ...prepared, factures: [...prepared.factures, { id: 'rejected', valide: false, rejetMotif: 'Document non pertinent' }] }), 'devis');
  assert.equal(resolveDossierTask({ ...prepared, factures: [...prepared.factures, { id: 'pending', valide: false }] }), 'documents');
  assert.equal(resolveDossierTask({ ...prepared, factures: [...prepared.factures, { id: 'copy', duplicateOfId: 'invoice-a', valide: false }, { id: 'old', valide: false }, { id: 'replacement', replacesFactureId: 'old', valide: true }] }), 'devis');
});

test('uncertified, incomplete or superseded measurements keep the task in preparation', () => {
  assert.equal(resolveDossierTask({ ...prepared, finalMeasurementsVersion: 1 }), 'preparation');
  assert.equal(resolveDossierTask({ ...prepared, preparationCompositionVersion: null, finalMeasurementsVersion: null }), 'preparation');
  assert.equal(resolveDossierTask({ ...prepared, finalPackages: [{ dimL: 20, dimW: 30, dimH: 10, poids: 0 }] }), 'preparation');
});

test('explicit task remains stable after a colleague completes it', () => {
  assert.equal(resolveDossierTask(prepared, '?section=preparation'), 'preparation');
  assert.equal(resolveDossierTask({ ...prepared, statut: 'paye' }, '?section=documents'), 'documents');
  assert.equal(resolveDossierTask(prepared, '?section=unknown'), 'devis');
});

test('pinned receipt remains on its confirmation after measures or action removal', () => {
  const action = { id: 'receipt-action', colis_id: prepared.id, kind: 'reception' };
  const received = { ...prepared, statut: 'receptionne' };
  assert.equal(resolveDossierTask(received, '?action=receipt-action', [action]), 'reception');
  const pinned = '?section=reception&action=receipt-action';
  assert.equal(resolveDossierTask({ ...received, statut: 'mesure' }, pinned, [action]), 'reception');
  assert.equal(resolveDossierTask({ ...received, statut: 'mesure' }, pinned, []), 'reception');
  assert.equal(resolveDossierTask({ ...received, statut: 'mesure' }, '?action=receipt-action', [action]), 'accord');
});

test('canonical document section survives a completed action disappearing', () => {
  const action = { id: 'document-action', colis_id: prepared.id, kind: 'documents' };
  const params = new URLSearchParams({ section: 'devis', action: action.id, returnTo: '/?mission=documents' });
  params.set('section', resolveDossierTask(prepared, params, [action]));
  assert.equal(resolveDossierTask(prepared, params, []), 'documents');
  assert.equal(params.get('action'), action.id);
  assert.equal(params.get('returnTo'), '/?mission=documents');
  params.set('invoice', 'invoice-a'); params.set('section', 'preparation');
  assert.equal(resolveDossierTask(prepared, params, []), 'documents');
});

test('default respects the operator document and financial visibility', () => {
  const preparer = permission => permission === 'perm_colis_preparer';
  const documents = permission => permission === 'perm_factures_voir';
  assert.equal(resolveDossierTask(prepared, '', [], preparer), 'preparation');
  assert.equal(resolveDossierTask(prepared, '', [], documents), 'documents');
  assert.equal(resolveDossierTask({ ...prepared, factures: [] }, '', [], preparer), 'preparation');
});

test('payment state requiring a revised quote routes back to the actual prerequisite', () => {
  const revised = { ...prepared, statut: 'devis_envoye', devisTotal: 100, devisBrouillon: true };
  assert.equal(resolveDossierTask(revised), 'devis');
  assert.equal(resolveDossierTask({ ...revised, finalMeasurementsVersion: 1 }), 'preparation');
  assert.equal(resolveDossierTask({ ...revised, devisBrouillon: false }), 'paiement');
});

test('every supported business stage has a task', () => {
  const stages = { receptionne: 'reception', mesure: 'accord', attente_feu_vert: 'accord', refuse_client: 'accord', autorise: 'preparation', paye: 'expedition', expedie: 'expedition', transit: 'expedition', dedouanement: 'expedition', arrive: 'livraison', livraison: 'livraison', livre: 'livraison' };
  for (const [statut, expected] of Object.entries(stages)) {
    assert.equal(resolveDossierTask({ statut }), expected);
    assert.ok(DOSSIER_TASKS[expected].label);
  }
});

test('navigation preserves return path, removes stale action/invoice and uses coherent target', () => {
  const result = new URL(dossierTaskUrl('dossier/a', 'preparation', '?returnTo=%2F%3Fmission%3Ddocuments&action=old&invoice=copy&section=devis&view=compact', { hash: '#preparation-workspace' }), 'https://example.test');
  assert.equal(result.pathname, '/colis/dossier%2Fa');
  assert.equal(result.searchParams.get('returnTo'), '/?mission=documents');
  assert.equal(result.searchParams.get('view'), 'compact');
  assert.equal(result.searchParams.get('section'), 'preparation');
  assert.equal(result.searchParams.has('invoice'), false);
  assert.equal(result.searchParams.has('action'), false);
  assert.equal(result.hash, '#preparation-workspace');
  const document = new URL(dossierTaskUrl('a', 'devis', '', { invoiceId: 'invoice-a' }), result.origin);
  assert.equal(document.searchParams.get('section'), 'documents');
  assert.equal(document.searchParams.get('invoice'), 'invoice-a');
});

test('explicit edit links open a draft and ordinary navigation drops that intent', () => {
  const origin = 'https://example.test';
  const edit = new URL(dossierTaskUrl('a', 'preparation', '?returnTo=%2Fcolis&action=old', { edit: true }), origin);
  assert.equal(edit.searchParams.get('modifier'), 'preparation');
  assert.equal(edit.searchParams.get('section'), 'preparation');
  assert.equal(edit.searchParams.has('action'), false);
  for (const task of ['preparation', 'devis', 'documents', 'paiement']) {
    const next = new URL(dossierTaskUrl('a', task, edit.search), origin);
    assert.equal(next.searchParams.has('modifier'), false);
    assert.equal(next.searchParams.get('returnTo'), '/colis');
  }
  const documents = new URL(dossierTaskUrl('a', 'devis', edit.search, { edit: true, invoiceId: 'invoice' }), origin);
  assert.equal(documents.searchParams.has('modifier'), false);
});
