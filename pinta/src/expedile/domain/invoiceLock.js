// Invoice lock rules (D1–D4). The server is authoritative: these helpers only
// decide what the screen offers and how a server refusal is explained.

export const UI_INVOICE_STATUSES = ['receptionne','mesure','attente_feu_vert','autorise','en_preparation','devis_envoye','attente_paiement']; // unchanged UI list minus the non-existent 'pret'
const TRANSPORT = ['expedie','transit','dedouanement','arrive','livraison','livre'];
export const paymentRecorded = c => Boolean(c?.paiementDate || c?.paiement_date) || (c?.paiementMontant ?? c?.paiement_montant) != null || c?.statut === 'paye';
export function invoicesFrozenReason(c, serverReason) {   // server reason (review context) wins
  if (serverReason) return serverReason;
  if (!c) return 'closed';
  if (paymentRecorded(c)) return 'payment';
  if (c.dateExpedition || c.date_expedition || TRANSPORT.includes(c.statut)) return 'departure';
  if (c.archive || c.statut === 'annule') return 'closed';
  return null;
}
export const invoicesEditable = (c, serverReason) => !invoicesFrozenReason(c, serverReason) && UI_INVOICE_STATUSES.includes(c?.statut);
export const quoteSent = c => ['devis_envoye','attente_paiement'].includes(c?.statut);
export const quoteLocked = (c, server) => typeof server === 'boolean' ? server : quoteSent(c) || Boolean(c?.payplugPaymentId || c?.payplugPaymentUrl);
export const isQuoteWithdrawalError = e => e?.hint === 'quote_withdrawal_required';
export const frozenReasonOf = e => typeof e?.hint === 'string' && e.hint.startsWith('invoices_frozen:') ? e.hint.slice(16) : null;
export const FROZEN_TEXT = {
  payment: 'Paiement enregistré : factures, articles et analyses sont figés. Ils restent consultables.',
  departure: 'Le dossier est parti : factures, articles et analyses restent consultables.',
  closed: 'Dossier clos : factures, articles et analyses restent consultables.',
};
// Read-only notice for any non-editable dossier, including a status the UI
// does not edit although no freezing proof exists (e.g. refused by the client).
export const frozenText = (c, serverReason) => FROZEN_TEXT[invoicesFrozenReason(c, serverReason)] || FROZEN_TEXT.closed;

// D2 dialog (spec §6.5) and default reasons (spec §6.6), per withdrawal action.
export const WITHDRAWAL_ACTIONS = {
  open_modification: { title: 'Modifier une facture du devis envoyé ?', button: 'Retirer le devis et modifier', verbe: 'modifier la vérification de la facture', reason: 'Modification d’une facture validée après l’envoi du devis' },
  replace_document: { title: 'Remplacer un document du devis envoyé ?', button: 'Retirer le devis et remplacer le document', verbe: 'remplacer le document', reason: 'Remplacement d’un document après l’envoi du devis' },
  add_document: { title: 'Ajouter une facture au devis envoyé ?', button: 'Retirer le devis et ajouter la facture', verbe: 'ajouter la facture', reason: 'Ajout d’une facture après l’envoi du devis' },
  classify_duplicate: { title: 'Retirer cette copie du devis envoyé ?', button: 'Retirer le devis et retirer la copie', verbe: 'retirer la copie', reason: 'Retrait d’un doublon après l’envoi du devis' },
  restore_duplicate: { title: 'Remettre cette facture à vérifier ?', button: 'Retirer le devis et remettre à vérifier', verbe: 'remettre la facture à vérifier', reason: 'Remise à vérifier d’une facture après l’envoi du devis' },
  request_correction: { title: 'Demander une correction au client ?', button: 'Retirer le devis et demander la correction', verbe: 'demander la correction au client', reason: 'Demande de correction d’une facture après l’envoi du devis' },
  manual_articles: { title: 'Modifier les achats du devis envoyé ?', button: 'Retirer le devis et modifier l’achat', verbe: 'modifier l’achat', reason: 'Modification d’un achat sans facture après l’envoi du devis' },
  import_attachment: { title: 'Ajouter cette facture au devis envoyé ?', button: 'Retirer le devis et ajouter la facture', verbe: 'ajouter la facture', reason: 'Facture reçue dans la conversation après l’envoi du devis' },
};
// These two actions are completed by the withdrawal command itself.
export const ATOMIC_WITHDRAWAL_ACTIONS = new Set(['open_modification', 'import_attachment']);
const OPEN_REQUEST = ['pending', 'processing', 'needs_review'];
export const NO_WITHDRAWAL_PERMISSION_TEXT = 'Le devis envoyé couvre ces factures. Une personne autorisée à modifier les articles doit d’abord le retirer.';
export const CLIENT_MESSAGE_SENTENCE = 'Le client recevra un message : facture bien reçue, devis mis à jour avec cet achat, ancien lien de paiement plus valable.';
const NO_MESSAGE_SENTENCE = 'Aucun message n’est envoyé au client par cette action.';
export const UNKNOWN_MESSAGE_SENTENCE = 'Si une facture envoyée par le client attend la mise à jour du devis, il recevra un message de mise à jour ; sinon, aucun message n’est envoyé.';

/** Dialog body. formatTotal formats sel.devisTotal (eur) when positive. lock undefined = server lock not loaded yet. */
export function withdrawalDialogText(action, sel, lock, formatTotal = value => String(value)) {
  const { verbe } = WITHDRAWAL_ACTIONS[action];
  const total = Number(sel?.devisTotal) > 0 ? ` (${formatTotal(Number(sel.devisTotal))})` : '';
  const sent = quoteSent(sel);
  // The client is told only when a sent quote is withdrawn for a client
  // document: a conversation import, or an open late-invoice request absorbed.
  // Without the server lock, an open request cannot be ruled out: never deny a send.
  const announce = sent && (action === 'import_attachment' || OPEN_REQUEST.includes(lock?.withdrawal?.status));
  const last = announce ? CLIENT_MESSAGE_SENTENCE : sent && lock === undefined ? UNKNOWN_MESSAGE_SENTENCE : NO_MESSAGE_SENTENCE;
  if (!sent) return `Un lien de paiement est encore actif pour ce dossier. Il sera d’abord annulé chez PayPlug. Vous pourrez ensuite ${verbe}. ${last}`;
  if (sel?.payplugPaymentUrl || sel?.payplugPaymentId) return `Le devis envoyé au client${total} va être retiré. Son lien de paiement sera d’abord annulé chez PayPlug : le client ne pourra plus régler l’ancien montant.\nVous pourrez ensuite ${verbe}, puis vérifier et envoyer un nouveau devis avec un nouveau lien.\n${last}`;
  return `Le devis envoyé au client${total} va être retiré. Vous pourrez ensuite ${verbe}, puis vérifier et envoyer un nouveau devis. ${last}`;
}

const PAYPLUG_REVIEW = 'Ce lien de paiement doit être vérifié dans PayPlug avant toute modification. Rien n’a été modifié.';
const PAYPLUG_ERRORS = {
  payplug_uncertain: 'PayPlug n’a pas confirmé l’annulation de l’ancien lien. Rien n’a été modifié. Vérifiez dans PayPlug si le client a payé, puis réessayez.',
  payplug_unreachable: 'PayPlug ne répond pas : l’ancien lien n’a pas pu être vérifié. Rien n’a été modifié ; réessayez dans un instant.',
  payplug_paid: 'Un paiement est signalé chez PayPlug pour ce devis. Le devis est conservé et ne peut plus être modifié. Actualisez le dossier dans un instant.',
  payplug_mismatch: PAYPLUG_REVIEW, payplug_failed: PAYPLUG_REVIEW, payplug_unknown_link: PAYPLUG_REVIEW, payplug_bad_reference: PAYPLUG_REVIEW, payplug_manual_review: PAYPLUG_REVIEW,
  payplug_config: 'PayPlug n’est pas configuré : l’ancien lien ne peut pas être annulé. Prévenez la direction.',
};
export const WITHDRAWAL_PARTIAL_FAILURE = 'L’ancien lien de paiement est annulé, mais le retrait du devis n’est pas enregistré. Le dossier a été actualisé : réessayez.';
// A new click cannot succeed: payment seen at PayPlug, no permission, PayPlug not configured, frozen dossier.
const FINAL_CODES = ['payplug_paid', 'payplug_config', '42501'];
export const withdrawalErrorIsFinal = error => !(error?.paymentLinkCancelled && error?.withdrawalSaved === false)
  && (FINAL_CODES.includes(error?.code) || error?.status === 403 || Boolean(frozenReasonOf(error)));

/** Inline dialog error from the Edge body ({ code, hint, paymentLinkCancelled, withdrawalSaved }) and HTTP status. */
export function withdrawalErrorMessage(error, fallback = 'Le retrait du devis n’a pas été confirmé. Rien n’a été modifié ; réessayez.') {
  if (error?.paymentLinkCancelled && error?.withdrawalSaved === false) return WITHDRAWAL_PARTIAL_FAILURE;
  if (PAYPLUG_ERRORS[error?.code]) return PAYPLUG_ERRORS[error.code];
  if (error?.hint === 'payment_link_creating' || error?.code === 'payplug_creating') return 'Un lien de paiement est en cours de création. Réessayez dans un instant ; si cela persiste, faites vérifier ce lien dans PayPlug.';
  const frozen = frozenReasonOf(error);
  if (frozen) return FROZEN_TEXT[frozen] || FROZEN_TEXT.closed;
  if (error?.status === 403 || error?.code === '42501') return 'Votre rôle ne permet pas de retirer un devis envoyé. Une personne autorisée à modifier les articles peut le faire.';
  if (error?.code === '40001') return 'Le dossier a changé. Actualisez puis réessayez.';
  return error?.serverMessage || fallback;
}

/** Feedback after a withdrawal whose follow-up action failed. */
export const withdrawnActionFailure = message => `Le devis est retiré. L’action n’a pas abouti : ${message} Réessayez.`;

const CLIENT_MESSAGE_TEXT = {
  sent: 'Client prévenu.',
  portal: 'Client prévenu dans son espace.',
  manual: 'Message au client à envoyer par email.',
  failed: 'Le message au client n’a pas été confirmé : vérifiez la conversation.',
  pending: 'Message au client en cours d’envoi.',
};

/** Banner for lock.withdrawal (spec §6.3), or null. formatDate formats an ISO date. */
export function withdrawalBanner(withdrawal, invoiceIds = [], formatDate = value => value) {
  if (!withdrawal) return null;
  const { status } = withdrawal;
  if (status === 'pending' || status === 'processing') return { status, tone: 'progress', retry: true, text: 'Facture reçue du client après l’envoi du devis. L’ancien lien de paiement est en cours d’annulation : le devis sera retiré automatiquement.' };
  if (status === 'needs_review') return { status, tone: 'warning', retry: true, text: `L’ancien lien de paiement n’a pas pu être annulé automatiquement : ${withdrawal.lastError || 'vérification nécessaire'}. Vérifiez-le dans PayPlug, puis réessayez.` };
  if (status === 'withdrawn' && withdrawal.source && withdrawal.source !== 'staff') {
    const message = CLIENT_MESSAGE_TEXT[withdrawal.clientMessageStatus] || '';
    return { status, tone: 'done', retry: false, text: `Devis retiré le ${formatDate(withdrawal.withdrawnAt)} : facture reçue du client après l’envoi. ${withdrawal.linkCancelled ? 'Ancien lien de paiement annulé. ' : ''}${message ? `${message} ` : ''}Vérifiez la nouvelle facture puis envoyez le nouveau devis.` };
  }
  if (status === 'paid' && (withdrawal.factureIds || []).some(id => invoiceIds.includes(id))) return { status, tone: 'warning', retry: false, text: 'Facture reçue après le paiement : conservée, non ajoutée au devis payé.' };
  return null;
}

// Client portal deposit (spec §6.5). Priority when a batch mixes outcomes.
export const DEPOSIT_PRIORITY = ['received_pending', 'quote_withdrawn', 'paid', 'frozen', 'added', 'duplicate'];
export function clientDepositNotice(results = []) {
  const statuses = results.map(result => result?.status).filter(Boolean);
  const top = DEPOSIT_PRIORITY.find(status => statuses.includes(status));
  if (!top) return '';
  const count = status => statuses.filter(value => value === status).length;
  if (top === 'received_pending') return 'Merci, votre facture est bien reçue ! Notre équipe met à jour votre devis avec cet achat. Merci d’attendre le nouveau devis avant tout paiement : vous serez prévenu(e) dès qu’il sera prêt.';
  if (top === 'quote_withdrawn') return results.some(result => result?.status === 'quote_withdrawn' && result.linkCancelled)
    ? 'Merci, votre facture est bien reçue ! Votre devis va être mis à jour avec cet achat : l’ancien lien de paiement n’est plus valable. Vous recevrez le nouveau devis dès qu’il sera prêt.'
    : 'Merci, votre facture est bien reçue ! Votre devis va être mis à jour avec cet achat. Vous recevrez le nouveau devis dès qu’il sera prêt.';
  if (top === 'paid') return 'Votre paiement est en cours d’enregistrement : ce document est conservé dans votre dossier et notre équipe revient vers vous si nécessaire.';
  if (top === 'frozen') {
    // « Payé » only for a recorded payment: a departure or a closed dossier says so.
    const reason = results.find(result => result?.status === 'frozen')?.reason;
    return `${reason === 'payment' ? 'Votre paiement est déjà enregistré' : reason === 'departure' ? 'Votre colis est déjà parti' : 'Votre dossier ne reçoit plus de facture'} : ce document est conservé dans votre dossier et notre équipe revient vers vous si nécessaire.`;
  }
  if (top === 'duplicate') return results.find(result => result?.status === 'duplicate')?.quoteSent === false
    ? 'Nous avions déjà ce document dans votre dossier, merci ! Notre équipe poursuit la préparation.'
    : 'Nous avions déjà ce document : rien ne change pour votre devis.';
  const added = count('added'), duplicates = count('duplicate');
  const text = added === 1 ? 'Facture reçue et enregistrée. Notre équipe la vérifie.' : `${added} factures reçues et enregistrées. Notre équipe les vérifie.`;
  return duplicates ? `${text} ${duplicates === 1 ? '1 document était déjà dans votre dossier.' : `${duplicates} documents étaient déjà dans votre dossier.`}` : text;
}
export function clientDepositInformation(sel) {
  if (!quoteSent(sel) || sel?.quoteUpdatePending) return '';
  return sel.payplugPaymentUrl
    ? 'Votre devis vous a déjà été envoyé. Si vous ajoutez une facture, il sera mis à jour avec cet achat : l’ancien lien de paiement sera annulé et vous recevrez un nouveau devis.'
    : 'Votre devis vous a déjà été envoyé. Si vous ajoutez une facture, il sera mis à jour avec cet achat et vous recevrez un nouveau devis.';
}

/** Staff toast after an inbox assignment, from telegram-inbox-assign's document. */
export function inboxAssignmentMessage(document, ref) {
  if (!document) return '';
  const label = document.ref || ref || 'ce dossier';
  if (document.status === 'ask_client') return `Message rattaché à ${label}. S’il s’agit d’une facture d’achat, ajoutez-la depuis la conversation avec « Utiliser comme facture » : le devis envoyé sera retiré.`;
  if (document.status === 'identical') return `Ce document était déjà dans le dossier ${label} : rien ne change pour le devis.`;
  const outcome = document.withdrawal?.status;
  if (outcome === 'withdrawn') return ['sent', 'portal'].includes(document.withdrawal.message?.status) ? `Facture ajoutée à ${label} : devis retiré, client prévenu.` : `Facture ajoutée à ${label} : devis retiré, message au client à envoyer depuis la conversation.`;
  if (['pending', 'processing', 'busy', 'needs_review'].includes(outcome)) return `Facture ajoutée à ${label} : annulation de l’ancien lien de paiement en cours.`;
  return '';
}
