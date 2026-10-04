import test from 'node:test';
import assert from 'node:assert/strict';
import {
  invoicesFrozenReason, invoicesEditable, quoteSent, quoteLocked, isQuoteWithdrawalError, frozenReasonOf, FROZEN_TEXT, frozenText,
  paymentRecorded, WITHDRAWAL_ACTIONS, withdrawalDialogText, withdrawalErrorMessage, WITHDRAWAL_PARTIAL_FAILURE, withdrawalBanner,
  clientDepositNotice, clientDepositInformation, inboxAssignmentMessage, withdrawnActionFailure, CLIENT_MESSAGE_SENTENCE, withdrawalErrorIsFinal,
} from './invoiceLock.js';

const open = { id: 'c1', statut: 'en_preparation', archive: false };

test('D4: every payment, departure or closing proof freezes the invoices', () => {
  assert.equal(invoicesFrozenReason(open), null);
  assert.equal(invoicesFrozenReason({ ...open, paiementMontant: 0 }), 'payment', 'An amount without a date is a payment proof.');
  assert.equal(invoicesFrozenReason({ ...open, paiement_montant: 12 }), 'payment');
  assert.equal(invoicesFrozenReason({ ...open, paiementDate: '2026-10-01' }), 'payment', 'A date only is a payment proof.');
  assert.equal(invoicesFrozenReason({ ...open, statut: 'paye' }), 'payment');
  assert.equal(invoicesFrozenReason({ ...open, statut: 'transit' }), 'departure');
  assert.equal(invoicesFrozenReason({ ...open, dateExpedition: '2026-10-02' }), 'departure');
  assert.equal(invoicesFrozenReason({ ...open, archive: true }), 'closed');
  assert.equal(invoicesFrozenReason({ ...open, statut: 'annule' }), 'closed');
  assert.equal(invoicesFrozenReason(null), 'closed');
  assert.equal(paymentRecorded({ paiementMontant: null }), false);
});

test('UI editability: refused dossiers and server reasons', () => {
  assert.equal(invoicesEditable(open), true);
  assert.equal(invoicesEditable({ ...open, statut: 'devis_envoye' }), true);
  assert.equal(invoicesEditable({ ...open, statut: 'refuse_client' }), false, 'refuse_client is not edited in the UI.');
  assert.equal(invoicesFrozenReason({ ...open, statut: 'refuse_client' }), null);
  assert.equal(frozenText({ ...open, statut: 'refuse_client' }), FROZEN_TEXT.closed);
  assert.equal(invoicesEditable({ ...open, statut: 'pret' }), false, 'pret does not exist.');
  assert.equal(invoicesFrozenReason(open, 'payment'), 'payment', 'The review context reason wins.');
  assert.equal(invoicesEditable(open, 'departure'), false);
  assert.equal(frozenText(open, 'payment'), FROZEN_TEXT.payment);
});

test('quote lock: sent statuses, links, and the server boolean', () => {
  assert.equal(quoteSent({ statut: 'attente_paiement' }), true);
  assert.equal(quoteSent(open), false);
  assert.equal(quoteLocked(open), false);
  assert.equal(quoteLocked({ ...open, statut: 'devis_envoye' }), true);
  assert.equal(quoteLocked({ ...open, payplugPaymentUrl: 'https://pay' }), true, 'A live link without a sent quote still locks.');
  assert.equal(quoteLocked({ ...open, payplugPaymentId: 'pay_1' }), true);
  assert.equal(quoteLocked({ ...open, statut: 'devis_envoye' }, false), false, 'The server boolean wins.');
  assert.equal(quoteLocked(open, true), true);
  assert.equal(quoteLocked(open, null), false, 'Only a boolean overrides.');
});

test('HINT parsing', () => {
  assert.equal(isQuoteWithdrawalError({ code: '22023', hint: 'quote_withdrawal_required' }), true);
  assert.equal(isQuoteWithdrawalError({ hint: 'invoices_frozen:payment' }), false);
  assert.equal(isQuoteWithdrawalError(null), false);
  assert.equal(frozenReasonOf({ hint: 'invoices_frozen:departure' }), 'departure');
  assert.equal(frozenReasonOf({ hint: 'quote_withdrawal_required' }), null);
  assert.equal(frozenReasonOf({}), null);
});

test('D2 dialog: exact wording per case', () => {
  const eur = value => `${value.toFixed(2)} €`;
  assert.equal(Object.keys(WITHDRAWAL_ACTIONS).length, 8);
  const linked = { statut: 'devis_envoye', devisTotal: 120, payplugPaymentUrl: 'https://pay' };
  assert.equal(withdrawalDialogText('open_modification', linked, null, eur), 'Le devis envoyé au client (120.00 €) va être retiré. Son lien de paiement sera d’abord annulé chez PayPlug : le client ne pourra plus régler l’ancien montant.\nVous pourrez ensuite modifier la vérification de la facture, puis vérifier et envoyer un nouveau devis avec un nouveau lien.\nAucun message n’est envoyé au client par cette action.');
  assert.equal(withdrawalDialogText('manual_articles', { statut: 'devis_envoye', devisTotal: 0 }, null, eur), 'Le devis envoyé au client va être retiré. Vous pourrez ensuite modifier l’achat, puis vérifier et envoyer un nouveau devis. Aucun message n’est envoyé au client par cette action.');
  assert.equal(withdrawalDialogText('add_document', { statut: 'en_preparation', payplugPaymentId: 'pay_1' }, null, eur), 'Un lien de paiement est encore actif pour ce dossier. Il sera d’abord annulé chez PayPlug. Vous pourrez ensuite ajouter la facture. Aucun message n’est envoyé au client par cette action.');
  assert.ok(withdrawalDialogText('import_attachment', linked, null, eur).endsWith(CLIENT_MESSAGE_SENTENCE));
  assert.ok(withdrawalDialogText('replace_document', linked, { withdrawal: { status: 'pending' } }, eur).endsWith(CLIENT_MESSAGE_SENTENCE), 'An open client request is answered.');
  assert.ok(!withdrawalDialogText('replace_document', linked, { withdrawal: { status: 'withdrawn' } }, eur).includes('recevra'));
});

test('D2 dialog errors map code and hint', () => {
  assert.match(withdrawalErrorMessage({ code: 'payplug_uncertain' }), /n’a pas confirmé l’annulation/);
  assert.match(withdrawalErrorMessage({ code: 'payplug_unknown_link' }), /doit être vérifié dans PayPlug/);
  assert.match(withdrawalErrorMessage({ code: '40001', hint: 'payment_link_creating' }), /en cours de création/);
  assert.equal(withdrawalErrorMessage({ code: '40001' }), 'Le dossier a changé. Actualisez puis réessayez.');
  assert.equal(withdrawalErrorMessage({ code: '22023', hint: 'invoices_frozen:payment' }), FROZEN_TEXT.payment);
  assert.match(withdrawalErrorMessage({ status: 403 }), /Votre rôle ne permet pas/);
  assert.equal(withdrawalErrorMessage({ code: '40001', paymentLinkCancelled: true, withdrawalSaved: false }), WITHDRAWAL_PARTIAL_FAILURE);
  assert.equal(withdrawalErrorMessage({ serverMessage: 'Autre refus.' }), 'Autre refus.');
  assert.equal(withdrawnActionFailure('Fichier refusé.'), 'Le devis est retiré. L’action n’a pas abouti : Fichier refusé. Réessayez.');
});

test('withdrawal banners', () => {
  assert.equal(withdrawalBanner(null), null);
  assert.equal(withdrawalBanner({ status: 'processing' }).retry, true);
  assert.match(withdrawalBanner({ status: 'needs_review', lastError: 'Lien inconnu' }).text, /annulé automatiquement : Lien inconnu\./);
  assert.equal(withdrawalBanner({ status: 'withdrawn', source: 'portal', withdrawnAt: '4 oct.', linkCancelled: true, clientMessageStatus: 'sent' }).text, 'Devis retiré le 4 oct. : facture reçue du client après l’envoi. Ancien lien de paiement annulé. Client prévenu. Vérifiez la nouvelle facture puis envoyez le nouveau devis.');
  assert.equal(withdrawalBanner({ status: 'withdrawn', source: 'staff' }), null);
  assert.equal(withdrawalBanner({ status: 'paid', factureIds: ['f1'] }, ['f2']), null);
  assert.match(withdrawalBanner({ status: 'paid', factureIds: ['f1'] }, ['f1']).text, /après le paiement/);
});

test('client deposit notices and information', () => {
  assert.equal(clientDepositNotice([]), '');
  assert.match(clientDepositNotice([{ status: 'added' }, { status: 'received_pending' }, { status: 'quote_withdrawn' }]), /Merci d’attendre le nouveau devis/);
  assert.match(clientDepositNotice([{ status: 'quote_withdrawn', linkCancelled: true }]), /n’est plus valable/);
  assert.doesNotMatch(clientDepositNotice([{ status: 'quote_withdrawn' }]), /lien/);
  assert.equal(clientDepositNotice([{ status: 'added' }, { status: 'duplicate' }]), 'Facture reçue et enregistrée. Notre équipe la vérifie. 1 document était déjà dans votre dossier.');
  assert.equal(clientDepositNotice([{ status: 'duplicate' }]), 'Nous avions déjà ce document : rien ne change pour votre devis.');
  assert.equal(clientDepositNotice([{ status: 'duplicate', quoteSent: false }]), 'Nous avions déjà ce document dans votre dossier, merci ! Notre équipe poursuit la préparation.');
  assert.match(clientDepositNotice([{ status: 'frozen', reason: 'payment' }, { status: 'added' }]), /^Votre paiement est déjà enregistré/);
  assert.match(clientDepositNotice([{ status: 'frozen', reason: 'departure' }]), /^Votre colis est déjà parti/);
  for (const reason of ['closed', undefined]) assert.doesNotMatch(clientDepositNotice([{ status: 'frozen', reason }]), /paiement|payé/, 'Never « paid » without a recorded payment');
  assert.equal(clientDepositInformation({ statut: 'en_preparation' }), '');
  assert.equal(clientDepositInformation({ statut: 'devis_envoye', quoteUpdatePending: true }), '');
  assert.match(clientDepositInformation({ statut: 'devis_envoye', payplugPaymentUrl: 'https://pay' }), /ancien lien de paiement sera annulé/);
  assert.doesNotMatch(clientDepositInformation({ statut: 'devis_envoye' }), /lien/);
});

test('inbox assignment toast', () => {
  assert.equal(inboxAssignmentMessage(null, 'EXP-1'), '');
  assert.match(inboxAssignmentMessage({ status: 'ask_client' }, 'EXP-1'), /^Message rattaché à EXP-1\./);
  assert.equal(inboxAssignmentMessage({ status: 'registered', ref: 'EXP-2', withdrawal: { status: 'withdrawn', message: { status: 'sent' } } }), 'Facture ajoutée à EXP-2 : devis retiré, client prévenu.');
  assert.match(inboxAssignmentMessage({ status: 'registered', withdrawal: { status: 'withdrawn', message: { status: 'manual' } } }, 'EXP-1'), /message au client à envoyer depuis la conversation\.$/);
  assert.match(inboxAssignmentMessage({ status: 'registered', withdrawal: { status: 'pending' } }, 'EXP-1'), /annulation de l’ancien lien/);
  assert.match(inboxAssignmentMessage({ status: 'identical' }, 'EXP-1'), /était déjà/);
  assert.equal(inboxAssignmentMessage({ status: 'not_invoice' }, 'EXP-1'), '');
});

test('final withdrawal errors close the action; retryable ones keep it', () => {
  for (const error of [{ code: 'payplug_paid' }, { code: 'payplug_config' }, { code: '42501' }, { status: 403 }, { code: '22023', hint: 'invoices_frozen:departure' }])
    assert.equal(withdrawalErrorIsFinal(error), true, JSON.stringify(error));
  for (const error of [{ code: 'payplug_uncertain' }, { code: 'payplug_unreachable' }, { code: '40001' }, { code: '40001', hint: 'payment_link_creating' }, { code: 'payplug_mismatch' },
    { code: '42501', paymentLinkCancelled: true, withdrawalSaved: false }, {}])
    assert.equal(withdrawalErrorIsFinal(error), false, JSON.stringify(error));
});

test('without the server lock, the dialog never denies a client message', () => {
  const sent = { statut: 'devis_envoye', devisTotal: 0 };
  assert.match(withdrawalDialogText('manual_articles', sent, undefined), /il recevra un message de mise à jour ; sinon, aucun message n’est envoyé\.$/);
  assert.match(withdrawalDialogText('manual_articles', sent, null), /Aucun message n’est envoyé au client par cette action\.$/);
  assert.match(withdrawalDialogText('manual_articles', sent, { withdrawal: { status: 'needs_review' } }), new RegExp(`${CLIENT_MESSAGE_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert.match(withdrawalDialogText('add_document', { statut: 'en_preparation', payplugPaymentId: 'pay_1' }, undefined), /Aucun message n’est envoyé/);
});
