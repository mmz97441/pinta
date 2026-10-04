import { PAYMENT_STATE_LABELS as PAYMENT } from './dossierTable.js';

/** Colour family of a status or payment pill in the dossier table and cards.
 * The text always carries the meaning; the tone only helps scanning a column.
 * Unknown values never turn green: they stay neutral or ask for a review. */
export const DOSSIER_TABLE_TONES = Object.freeze(['done', 'current', 'waiting', 'review', 'neutral']);

const PAYMENT_TONES = new Map([
  [PAYMENT.paid, 'done'],
  [PAYMENT.expected, 'waiting'], [PAYMENT.partial, 'waiting'],
  [PAYMENT.toVerify, 'review'], [PAYMENT.overpaid, 'review'], [PAYMENT.toRecalculate, 'review'],
  [PAYMENT.toCalculate, 'neutral'], [PAYMENT.quoteToSend, 'neutral'], [PAYMENT.noneRequested, 'neutral'],
]);

const STATUS_TONES = new Map([
  ['livre', 'done'],
  ['attente_feu_vert', 'waiting'], ['devis_envoye', 'waiting'], ['attente_paiement', 'waiting'],
  ['refuse_client', 'review'],
  ['expedie', 'current'], ['transit', 'current'], ['dedouanement', 'current'], ['arrive', 'current'], ['livraison', 'current'],
  ['receptionne', 'neutral'], ['mesure', 'neutral'], ['autorise', 'neutral'], ['en_preparation', 'neutral'], ['annule', 'neutral'],
]);

export function paymentTone(model) {
  const label = model?.payment?.stateLabel;
  if (typeof label !== 'string') return 'neutral';
  return PAYMENT_TONES.get(label) || (label.includes('vérifier') ? 'review' : 'neutral');
}

/** A legacy “paye” status shows the payment colour unless the payment is
 * complete, so a partial or uncertain payment never looks settled. */
export function statusTone(dossier, model) {
  const status = dossier?.statut;
  if (status === 'paye') return model?.payment?.stateLabel === PAYMENT.paid ? 'done' : paymentTone(model);
  return STATUS_TONES.get(status) || 'review';
}
