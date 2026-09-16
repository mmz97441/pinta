import test from 'node:test';
import assert from 'node:assert/strict';
import { DOSSIER_TASKS, dossierTaskUrl, resolveDossierTask } from './dossierTasks.js';

const prepared = { id: 'dossier-a', statut: 'en_preparation', preparationCompositionVersion: 2, finalMeasurementsVersion: 2, finalPackages: [{ dimL: 20, dimW: 30, dimH: 10, poids: 2 }], factures: [{ id: 'invoice-a', valide: true }] };

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
