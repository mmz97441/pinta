import { throwDb } from './http.ts';
import { DEFAULT_BODIES } from './messageDefaults.ts';
import { renderMessage } from './messageTemplate.ts';
import { cancelPayplugLinks, compensateCancelledLinks, linksUpToVersion, loadPaymentLinks, PayplugCancelError } from './payplugCancel.ts';
import { dispatchOutbox } from './telegram.ts';

// Late client invoice (D3). The quote stays payable until PayPlug confirms the
// abort of its old link; only then does the database withdraw it. The client is
// told once per withdrawn version, after that commit. Nothing here retries blindly:
// every new attempt starts with a PayPlug read, and an uncertain send is never resent.
export type WithdrawalOutcome = { id: string; status: 'withdrawn'|'pending'|'processing'|'needs_review'|'paid'|'superseded'|'busy';
  linkCancelled?: boolean; message?: { canal: string; status: string }; error?: string };
type Release = 'retry'|'review'|'paid'|'superseded';
type Delivery = { canal: string; status: string };

const RELEASE: Record<string, Release> = { unreachable:'retry', uncertain:'retry', proof:'retry', creating:'retry', config:'retry',
  paid:'paid', mismatch:'review', failed:'review', unknown_link:'review', bad_reference:'review', manual_review:'review' };
const RELEASED: Record<Release, WithdrawalOutcome['status']> = { retry:'pending', review:'needs_review', paid:'paid', superseded:'superseded' };
const STATUSES = ['withdrawn','pending','processing','needs_review','paid','superseded'];
// A refusal of queue_message is final (shown to the team); anything else is retried with the same key.
const FINAL_QUEUE_ERRORS = ['P0001','22023','42501','23514'];
const reason = (error: unknown) => String((error as any)?.message || error || 'Traitement interrompu').slice(0, 500);

async function release(db: any, row: any, outcome: Release, error: string): Promise<WithdrawalOutcome> {
  const released = await db.rpc('release_quote_withdrawal', { p_id: row.id, p_outcome: outcome, p_error: error }); throwDb(released);
  return { id: row.id, status: STATUSES.includes(released.data?.status) ? released.data.status : RELEASED[outcome], error };
}

async function mark(db: any, colisId: string, version: number, canal: string, status: string, messageId: string | null, error: string | null): Promise<Delivery> {
  throwDb(await db.rpc('mark_quote_withdrawal_message', { p_colis_id: colisId, p_version: version, p_status: status, p_message_id: messageId, p_error: error }));
  return { canal, status };
}

async function deliverVersion(db: any, colis: any, client: any, destination: any, canal: string, version: number, linked: boolean): Promise<Delivery> {
  const key = linked ? 'facture_apres_devis' : 'facture_apres_devis_sans_lien';
  const templateCanal = canal === 'email' ? 'email' : 'telegram';  // the portal reuses the Telegram body
  const saved = await db.from('message_templates').select('body').eq('key', key).eq('canal', templateCanal).maybeSingle(); throwDb(saved);
  let text: string;
  // The saved body is the one validated by the team; an unknown variable is reported, never replaced silently.
  try { text = renderMessage(saved.data?.body || DEFAULT_BODIES[`${key}_${templateCanal}`], client, colis, destination, {}); }
  catch (error) { return await mark(db, colis.id, version, canal, 'failed', null, `Modèle de message invalide : ${reason(error)}`); }
  const queued = await db.rpc('queue_message', { p_colis_id: colis.id, p_text: text, p_template: key, p_idempotency_key: `late-invoice:${colis.id}:${version}`, p_canal: canal });
  if (queued.error) {
    if (!FINAL_QUEUE_ERRORS.includes(queued.error.code)) { console.error('Late-invoice message not queued', reason(queued.error)); return { canal, status: 'pending' }; }
    return await mark(db, colis.id, version, canal, 'failed', null, reason(queued.error));
  }
  const messageId = queued.data?.message?.id || null;
  if (canal !== 'telegram') return await mark(db, colis.id, version, canal, canal === 'portal' ? 'portal' : 'manual', messageId, null);
  let status = 'failed'; let error: string | null = null;
  try {
    const sent = await dispatchOutbox(db, queued.data.outbox.id);
    // Being sent elsewhere: relances-auto marks a stuck send failed later; it is never resent.
    if (sent.status === 'sending') return { canal, status: 'pending' };
    if (sent.ok && sent.status === 'sent') status = 'sent'; else error = (sent as any).error || 'Envoi Telegram non confirmé : vérifiez la conversation avant tout renvoi.';
  } catch (failure) {
    error = reason(failure);
    // The outbox decides: a row still pending, blocked or sending is delivered by relances-auto, never marked failed here.
    const outbox = await db.from('notification_outbox').select('status').eq('id', queued.data.outbox.id).maybeSingle();
    if (outbox.error || !outbox.data || ['pending','blocked','sending'].includes(outbox.data.status)) return { canal, status: 'pending' };
    if (outbox.data.status === 'sent') status = 'sent';
  }
  return await mark(db, colis.id, version, canal, status, messageId, status === 'sent' ? null : error);
}

/** Sends the D3 message for every open withdrawal of the dossier whose message is still pending. Never throws. */
export async function deliverWithdrawalMessages(db: any, colisId: string): Promise<Delivery | null> {
  try {
    const rows = await db.from('quote_withdrawals').select('withdrawn_quote_version,link_cancelled')
      .eq('colis_id', colisId).is('closed_at', null).eq('client_message_status', 'pending'); throwDb(rows);
    const versions = new Map<number, boolean>();
    for (const row of rows.data || []) if (Number.isInteger(row.withdrawn_quote_version))
      versions.set(row.withdrawn_quote_version, versions.get(row.withdrawn_quote_version) === true || row.link_cancelled === true);
    if (!versions.size) return null;
    const colis = await db.from('colis').select('*').eq('id', colisId).single(); throwDb(colis);
    const client = await db.from('clients').select('id,prenom,nom,type,telegram_chat_id,user_id,cp').eq('id', colis.data.client_id).single(); throwDb(client);
    const destination = await db.from('destinations').select('*').eq('code', String(client.data.cp || '').slice(0, 3)).maybeSingle(); throwDb(destination);
    const canal = client.data.telegram_chat_id ? 'telegram' : client.data.user_id ? 'portal' : 'email';
    let outcome: Delivery | null = null;
    for (const [version, linked] of [...versions].sort((a, b) => a[0] - b[0])) outcome = await deliverVersion(db, colis.data, client.data, destination.data, canal, version, linked);
    return outcome;
  } catch (error) {
    console.error('Late-invoice message not delivered', reason(error));
    return null;
  }
}

async function currentOutcome(db: any, id: string): Promise<WithdrawalOutcome> {
  const found = await db.from('quote_withdrawals').select('id,colis_id,status,link_cancelled,client_message_status,closed_at,last_error').eq('id', id).maybeSingle(); throwDb(found);
  const row = found.data;
  if (!row) return { id, status: 'busy', error: 'Demande de retrait introuvable' };
  if (row.status !== 'withdrawn') return { id, status: STATUSES.includes(row.status) && !['pending','processing'].includes(row.status) ? row.status : 'busy', ...(row.last_error ? { error: row.last_error } : {}) };
  const message = !row.closed_at && row.client_message_status === 'pending' ? await deliverWithdrawalMessages(db, row.colis_id)
    : ['sent','portal','manual','failed'].includes(row.client_message_status) ? { canal: ({ portal:'portal', manual:'email' } as Record<string, string>)[row.client_message_status] || 'telegram', status: row.client_message_status } : null;
  return { id, status: 'withdrawn', linkCancelled: row.link_cancelled === true, ...(message ? { message } : {}) };
}

async function processClaimed(db: any, row: any, deadline?: number): Promise<WithdrawalOutcome> {
  const cancelledIds: string[] = [];
  try {
    // Only the quote this request locked: a frozen, already withdrawn or newer quote is never touched at PayPlug.
    const state = await db.rpc('invoice_lock_state', { p_colis_id: row.colis_id }); throwDb(state);
    const lock = state.data || {};
    if (!lock.frozenReason && lock.quoteLocked && Number(lock.quoteVersion) === Number(row.quote_version)) {
      const colis = await db.from('colis').select('id,quote_version,payplug_payment_id,payplug_payment_url').eq('id', row.colis_id).single(); throwDb(colis);
      if (Number(colis.data.quote_version) === Number(row.quote_version)) await cancelPayplugLinks(db, colis.data,
        linksUpToVersion(await loadPaymentLinks(db, row.colis_id), row.quote_version), { context: 'withdrawal', deadline, cancelledIds });
    }
  } catch (error) {
    if (cancelledIds.length) await compensateCancelledLinks(db, row.colis_id, cancelledIds);
    return await release(db, row, error instanceof PayplugCancelError ? RELEASE[error.kind] || 'retry' : 'retry', reason(error));
  }
  const completed = await db.rpc('complete_quote_withdrawal', { p_id: row.id });
  if (completed.error) {
    if (cancelledIds.length) await compensateCancelledLinks(db, row.colis_id, cancelledIds);
    return await release(db, row, 'retry', reason(completed.error));
  }
  const result = completed.data || {};
  if (result.status !== 'withdrawn') return { id: row.id, status: STATUSES.includes(result.status) ? result.status : 'superseded' };
  if (!result.withdrawal) return await currentOutcome(db, row.id);
  const message = await deliverWithdrawalMessages(db, row.colis_id);
  return { id: row.id, status: 'withdrawn', linkCancelled: result.withdrawal.link_cancelled === true, ...(message ? { message } : {}) };
}

/** Claims one request (any time; `rearm` reopens a request left for review), then processes it. Never throws. */
export async function processQuoteWithdrawal(db: any, id: string, opts: { rearm?: boolean; deadline?: number } = {}): Promise<WithdrawalOutcome> {
  try {
    const claimed = await db.rpc('claim_quote_withdrawal', { p_id: id, p_rearm: opts.rearm === true }); throwDb(claimed);
    if (!claimed.data) return await currentOutcome(db, id);
    return await processClaimed(db, claimed.data, opts.deadline);
  } catch (error) {
    console.error('Quote withdrawal not processed', reason(error));
    return { id, status: 'busy', error: reason(error) };
  }
}

/** relances-auto: due requests (and stuck ones), then D3 messages not delivered inline. Bounded by the deadline. */
export async function processDueQuoteWithdrawals(db: any, opts: { deadline: number; limit?: number }): Promise<{ processed: number; messages: number }> {
  const limit = opts.limit ?? 5; let processed = 0; let messages = 0; const handled = new Set<string>();
  try {
    while (processed < limit && Date.now() < opts.deadline) {
      const claimed = await db.rpc('claim_quote_withdrawal', { p_id: null, p_rearm: false }); throwDb(claimed);
      if (!claimed.data) break;
      processed++; handled.add(claimed.data.colis_id);
      const outcome = await processClaimed(db, claimed.data, opts.deadline)
        .catch((error): WithdrawalOutcome => ({ id: claimed.data.id, status: 'busy', error: reason(error) }));
      if (outcome.message) messages++;
    }
    if (Date.now() < opts.deadline) {
      const due = await db.from('quote_withdrawals').select('colis_id').eq('status', 'withdrawn').is('closed_at', null)
        .eq('client_message_status', 'pending').order('withdrawn_at').limit(limit); throwDb(due);
      for (const colisId of new Set<string>((due.data || []).map((row: any) => row.colis_id))) {
        if (Date.now() >= opts.deadline) break;
        if (!handled.has(colisId) && await deliverWithdrawalMessages(db, colisId)) messages++;
      }
    }
  } catch (error) { console.error('Quote withdrawal sweep interrupted', reason(error)); }
  return { processed, messages };
}
