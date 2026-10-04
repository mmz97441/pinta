import { HttpError, throwDb } from './http.ts';
import { requirePayplugCreationMode } from './payplugMode.ts';

// Cancels payable PayPlug links before the database withdraws their quote.
// Read first: a PATCH {aborted:true} is sent only to an unpaid, unrefunded,
// verified resource, and every confirmed abort is attested by the service.
export type CancelKind = 'creating'|'unknown_link'|'config'|'manual_review'|'bad_reference'|'unreachable'|'mismatch'|'paid'|'failed'|'uncertain'|'proof';
export type CancelContext = 'correction' | 'withdrawal';
export type PaymentLinks = { intents: any[]; legacy: any[] };
export class PayplugCancelError extends HttpError { constructor(status: number, message: string, public kind: CancelKind) { super(status, message); } }

// A correction keeps its historical wording; a quote withdrawal uses the dialog texts.
const REVIEW = 'Ce lien de paiement doit être vérifié dans PayPlug avant toute modification. Rien n’a été modifié.';
const WITHDRAWAL: Record<CancelKind, string> = {
  creating: 'Un lien de paiement est en cours de création. Réessayez dans un instant ; si cela persiste, faites vérifier ce lien dans PayPlug.',
  unknown_link: REVIEW, manual_review: REVIEW, bad_reference: REVIEW, mismatch: REVIEW, failed: REVIEW,
  config: 'PayPlug n’est pas configuré : l’ancien lien ne peut pas être annulé. Prévenez la direction.',
  unreachable: 'PayPlug ne répond pas : l’ancien lien n’a pas pu être vérifié. Rien n’a été modifié ; réessayez dans un instant.',
  paid: 'Un paiement est signalé chez PayPlug pour ce devis. Le devis est conservé et ne peut plus être modifié. Actualisez le dossier dans un instant.',
  uncertain: 'PayPlug n’a pas confirmé l’annulation de l’ancien lien. Rien n’a été modifié. Vérifiez dans PayPlug si le client a payé, puis réessayez.',
  proof: 'L’ancien lien de paiement est annulé, mais le retrait du devis n’est pas enregistré. Le dossier a été actualisé : réessayez.',
};
const stop = (context: CancelContext, status: number, kind: CancelKind, correction: string) =>
  new PayplugCancelError(status, context === 'withdrawal' ? WITHDRAWAL[kind] : correction, kind);

export async function loadPaymentLinks(db: any, colisId: string): Promise<PaymentLinks> {
  const [intents, legacy] = await Promise.all([
    db.from('payment_intents').select('*').eq('colis_id', colisId),
    db.from('legacy_payplug_payments').select('*').eq('colis_id', colisId),
  ]); [intents, legacy].forEach(throwDb);
  return { intents: intents.data || [], legacy: legacy.data || [] };
}

/** Links of this quote version and older ones: a request never cancels the link of a newer quote. */
export function linksUpToVersion(links: PaymentLinks, quoteVersion: unknown): PaymentLinks {
  const version = Number(quoteVersion);
  if (!Number.isInteger(version)) return links;
  return { intents: links.intents.filter((intent: any) => !(Number(intent.quote_version) > version)), legacy: links.legacy };
}

export function verifyPayment(payment: any, link: any, colis: any, expectedLive: boolean, context: CancelContext = 'correction') {
  if (!payment || typeof payment !== 'object' || payment.id !== link.provider_id || payment.object !== 'payment' || payment.is_live !== expectedLive
    || payment.currency !== 'EUR' || !Number.isInteger(payment.amount) || payment.amount !== link.amount_cents
    || payment.metadata?.colis_id !== colis.id) throw stop(context, 409, 'mismatch', 'Le paiement fournisseur ne correspond pas à ce dossier, à son montant ou au mode attendu.');
  if (payment.is_paid !== false || (payment.amount_refunded ?? 0) !== 0) throw stop(context, 409, 'paid', 'Un paiement reçu ou remboursé est signalé. La correction est bloquée ; aucun remboursement ne sera effectué.');
  if (link.kind === 'modern') {
    if (link.provider_is_live !== expectedLive || payment.metadata?.intent_id !== link.id
      || String(payment.metadata?.quote_version) !== String(link.quote_version)) throw stop(context, 409, 'mismatch', 'Le paiement ne correspond pas à la version du devis enregistrée.');
  } else if (payment.metadata?.colis_ref !== link.colis_ref || Object.hasOwn(payment.metadata, 'quote_version')
    || Object.hasOwn(payment.metadata, 'intent_id') || typeof payment.billing?.email !== 'string'
    || payment.metadata?.client_id != null && payment.metadata.client_id !== link.client_id
    || payment.billing.email.trim().toLowerCase() !== link.billing_email.trim().toLowerCase()) {
    throw stop(context, 409, 'mismatch', 'L’identité du paiement historique doit être vérifiée avant de retirer son lien.');
  }
}

/**
 * Aborts every payable link of the dossier and records its proof. `cancelledIds`
 * (when given) is filled as links are attested, so a caller still knows them
 * after an error; `abortedIds` only receives the links attested by this call
 * (not those already attested earlier). No new link is started after `deadline`;
 * an abort already sent always runs to completion or times out.
 */
export async function cancelPayplugLinks(db: any, colis: any, links: PaymentLinks,
  opts: { beforePatch?: () => Promise<void>; deadline?: number; context?: CancelContext; cancelledIds?: string[]; abortedIds?: string[] } = {}): Promise<{ cancelledIds: string[] }> {
  const context = opts.context || 'correction'; const cancelledIds = opts.cancelledIds || []; const abortedIds = opts.abortedIds || [];
  if (links.intents.some((intent: any) => intent.status === 'creating')) throw stop(context, 409, 'creating', 'Un lien de paiement est en cours de création. Attendez sa confirmation avant de corriger le dossier.');
  const list = [...links.intents.filter((intent: any) => intent.provider_id).map((intent: any) => ({...intent,kind:'modern'})),
    ...links.legacy.map((link: any) => ({...link,kind:'legacy'}))];
  if (colis.payplug_payment_id && !list.some(link => link.provider_id === colis.payplug_payment_id)
    || colis.payplug_payment_url && !colis.payplug_payment_id) throw stop(context, 409, 'unknown_link', 'Le lien de paiement actuel n’a pas de référence vérifiable. Faites vérifier ce lien avant de corriger.');
  for (const link of list) {
    if (link.provider_cancelled_at) { cancelledIds.push(link.provider_id); continue; }
    if (opts.deadline && Date.now() > opts.deadline) throw new PayplugCancelError(503, 'Délai de traitement atteint avant l’annulation de tous les anciens liens : nouvelle tentative automatique.', 'unreachable');
    const key = Deno.env.get('PAYPLUG_SECRET_KEY')?.trim();
    if (!key) throw stop(context, 503, 'config', 'PayPlug doit être configuré pour retirer l’ancien lien de paiement.');
    let expectedLive: boolean;
    try { expectedLive = requirePayplugCreationMode(key); }
    catch (error) { if (error instanceof HttpError) throw stop(context, error.status, 'config', error.message); throw error; }
    if (link.kind === 'legacy' && !expectedLive) throw stop(context, 409, 'manual_review', 'Ce lien historique doit être rapproché manuellement avant de corriger le dossier dans cet environnement de test.');
    if (!/^pay_[a-zA-Z0-9]+$/.test(link.provider_id)) throw stop(context, 409, 'bad_reference', 'Référence PayPlug non reconnue.');
    const url = `https://api.payplug.com/v1/payments/${encodeURIComponent(link.provider_id)}`;
    const headers = { Authorization:`Bearer ${key}`,'PayPlug-Version':'2019-08-06','Content-Type':'application/json' };
    let response: Response;
    try { response = await fetch(url,{headers,signal:AbortSignal.timeout(15000)}); }
    catch { throw stop(context, 502, 'unreachable', 'PayPlug n’a pas confirmé l’état de l’ancien lien. La correction n’est pas enregistrée ; réessayez.'); }
    if (!response.ok) throw stop(context, 502, 'unreachable', 'Impossible de vérifier l’ancien paiement auprès de PayPlug.');
    let payment = await response.json(); verifyPayment(payment,link,colis,expectedLive,context);
    if (payment.failure?.code !== 'aborted') {
      if (payment.failure) throw stop(context, 409, 'failed', 'Ce paiement fournisseur est déjà en échec. Faites vérifier sa clôture avant de corriger le dossier.');
      await opts.beforePatch?.();
      try { response = await fetch(url,{method:'PATCH',headers,body:JSON.stringify({aborted:true}),signal:AbortSignal.timeout(15000)}); }
      catch { throw stop(context, 502, 'uncertain', 'L’annulation PayPlug n’a pas été confirmée. Votre correction n’est pas enregistrée ; réessayez pour vérifier le lien.'); }
      if (!response.ok) throw stop(context, 502, 'uncertain', 'PayPlug n’a pas confirmé l’annulation. Vérifiez si le client a payé, puis réessayez.');
      payment = await response.json(); verifyPayment(payment,link,colis,expectedLive,context);
      if (payment.failure?.code !== 'aborted') throw stop(context, 502, 'uncertain', 'PayPlug n’a pas confirmé que l’ancien lien est annulé. La correction n’est pas enregistrée.');
    }
    cancelledIds.push(link.provider_id); abortedIds.push(link.provider_id);
    const proof = await db.rpc('record_payplug_cancellation', { p_colis_id:colis.id,p_provider_id:link.provider_id,p_payment:payment });
    if (proof.error) {
      // PayPlug confirmed the abort: the next attempt reads it and records the proof without a second PATCH.
      const error: any = stop(context, 500, 'proof', 'Réessayez après avoir actualisé le dossier.');
      error.code = proof.error.code; throw error;
    }
  }
  return { cancelledIds };
}

/** The provider link is gone even if the dossier change failed. Never clear a replacement link or other fields. */
export async function compensateCancelledLinks(db: any, colisId: string, cancelledIds: string[]): Promise<{ cleanupFailed: boolean }> {
  let cleanupFailed = false;
  try {
    const cleaned = await db.from('colis').update({payplug_payment_url:null}).eq('id',colisId).in('payplug_payment_id',cancelledIds).select('id');
    cleanupFailed = Boolean(cleaned.error);
  } catch { cleanupFailed = true; }
  return { cleanupFailed };
}
