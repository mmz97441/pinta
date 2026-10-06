import { throwDb } from './http.ts';
import { currentInvoices, invoiceRequested } from './invoiceRequest.ts';
import { DEFAULT_BODIES } from './messageDefaults.ts';
import { renderMessage } from './messageTemplate.ts';
import { dispatchOutbox } from './telegram.ts';

// Confirmation of a choice made with the Telegram buttons of a preparation request (lot 3b, 2026-10-06).
// The choice is recorded and the Telegram update marked done before anything here runs: a failure only logs,
// it never replays or undoes the decision. The confirmation is one stored staff message (author « Expedîle »)
// sent through the outbox, so a reply to it (an invoice, a question) resolves to its dossier.
export type ConsentAction = 'approve' | 'wait' | 'refuse';
export type ConsentDecision = { colis: any; action: ConsentAction };
export type ConsentReply = { template: string | null; status: 'sent' | 'pending' | 'failed'; error?: string };

export const DECISION_FAILED = 'Votre réponse n’a pas pu être enregistrée. Réessayez depuis votre espace client ou écrivez-nous ici.';
// Refusals written by the decision commands (« Cette demande a été remplacée… », « Cette demande ne peut plus être
// modifiée », « Ce dossier ne correspond pas à votre compte »…) are French texts raised with these codes. PostgreSQL's
// own errors under the same codes, timeouts, PostgREST and network failures are never shown to the client.
const BUSINESS_CODES = ['P0001', '22023', '42501', '40001', 'P0002'];
const FRENCH = /[àâäçéèêëîïôöùûüÿœæ’«»]/i;
const reason = (error: unknown) => String((error as any)?.message || error || 'Traitement interrompu').slice(0, 500);

/** The text sent to the client when the decision command refused or failed; the original is logged. */
export function decisionErrorText(error: any): string {
  const message = String(error?.message ?? '');
  if (BUSINESS_CODES.includes(String(error?.code ?? '')) && FRENCH.test(message)) return message;
  console.error('Consent decision not recorded', String(error?.code ?? ''), message.slice(0, 300));
  return DECISION_FAILED;
}

/** Template of the confirmation: an approval also asks for the purchase invoice while the dossier still requests
 * one (same rule as queue_message), except for a professional client. */
export function consentReplyTemplate(action: ConsentAction, client: any, invoices: any[]): string {
  if (action === 'wait') return 'choix_attente_recu';
  if (action === 'refuse') return 'refus_recu';
  return client?.type !== 'pro' && invoiceRequested(invoices) ? 'feu_vert_recu_facture' : 'feu_vert_recu';
}

// Nothing was stored for the client: the team finds the reason in the dossier history.
async function unsent(db: any, colisId: string | null, template: string | null, error: string): Promise<ConsentReply> {
  console.error('Consent confirmation not sent', template || 'template', error);
  try {
    if (colisId) throwDb(await db.from('audit_actions').insert({ colis_id: colisId, user_id: null, user_nom: 'Expedîle', action: 'consent_reply_failed',
      detail: `Confirmation Telegram du choix du client non envoyée${template ? ` (${template})` : ''} : ${error}`.slice(0, 1000) }));
  } catch (failure) { console.error('Consent confirmation failure not recorded', reason(failure)); }
  return { template, status: 'failed', error };
}

/** Stores, then sends, the confirmation of a recorded choice. Never throws. */
export async function deliverConsentReply(db: any, decision: ConsentDecision): Promise<ConsentReply> {
  const colis = decision?.colis || {};
  const colisId = typeof colis.id === 'string' ? colis.id : null;
  let template: string | null = null;
  let outboxId: string | null = null;
  try {
    const [client, invoices] = await Promise.all([
      db.from('clients').select('id,prenom,nom,type,cp').eq('id', colis.client_id).single(),
      db.from('factures').select('id,duplicate_of_facture_id,replaces_facture_id,rejet_motif,valide').eq('colis_id', colisId),
    ]); throwDb(client); throwDb(invoices);
    template = consentReplyTemplate(decision.action, client.data, invoices.data || []);
    const [saved, destination] = await Promise.all([
      db.from('message_templates').select('body').eq('key', template).eq('canal', 'telegram').maybeSingle(),
      db.from('destinations').select('*').eq('code', String(client.data.cp || '').slice(0, 3)).maybeSingle(),
    ]); throwDb(saved); throwDb(destination);
    let text: string;
    // The saved body is the one validated by the team; an unknown variable is reported, never replaced by another text.
    try { text = renderMessage(saved.data?.body || DEFAULT_BODIES[`${template}_telegram`], client.data, colis, destination.data, {}, [], currentInvoices(invoices.data || [])); }
    catch (error) { return await unsent(db, colisId, template, `Modèle de message invalide : ${reason(error)}`); }
    // One confirmation per request version and choice: a repeated delivery returns the stored message.
    const queued = await db.rpc('queue_message', { p_colis_id: colisId, p_text: text, p_template: template,
      p_idempotency_key: `consent-reply:${colisId}:${colis.consent_request_version ?? 0}:${decision.action}`, p_canal: 'telegram' });
    if (queued.error) return await unsent(db, colisId, template, reason(queued.error));
    outboxId = queued.data?.outbox?.id || null;
    if (!outboxId) return await unsent(db, colisId, template, 'Message non mis en file');
  } catch (error) {
    return await unsent(db, colisId, template, reason(error));
  }
  try {
    const sent = await dispatchOutbox(db, outboxId);
    if (sent.ok && sent.status === 'sent') return { template, status: 'sent' };
    // Being sent elsewhere, or still pending: relances-auto delivers it. Nothing is resent here.
    return { template, status: ['sending', 'pending', 'blocked', 'scheduled'].includes(sent.status) ? 'pending' : 'failed', ...((sent as any).error ? { error: (sent as any).error } : {}) };
  } catch (error) {
    // A provider failure is marked failed on the stored message (the team checks Telegram before any manual resend).
    console.error('Consent confirmation not confirmed by Telegram', reason(error));
    try {
      const outbox = await db.from('notification_outbox').select('status').eq('id', outboxId).maybeSingle();
      if (!outbox.error && outbox.data?.status === 'sent') return { template, status: 'sent' };
      if (!outbox.error && outbox.data && !['pending', 'blocked', 'sending'].includes(outbox.data.status)) return { template, status: 'failed', error: reason(error) };
    } catch { /* The outbox decides; an unknown state stays with the worker. */ }
    return { template, status: 'pending', error: reason(error) };
  }
}
