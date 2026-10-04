import { admin, fail, HttpError, json, throwDb, uuid } from '../_shared/http.ts';
import { processQuoteWithdrawal, type WithdrawalOutcome } from '../_shared/quoteWithdrawal.ts';
import { telegram } from '../_shared/telegram.ts';
import { type IncomingDocument, saveIncoming } from '../_shared/telegramIncoming.ts';

const db = admin();
const reply = (chatId: number, text: string, replyMarkup?: unknown) => telegram('sendMessage', { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
const SIGNATURE = '\n\nL’équipe Expedîle';
// A late invoice is being processed: the old link is cancelled or about to be.
const UPDATING = ['withdrawn', 'pending', 'processing', 'busy', 'needs_review'];
const delivered = (withdrawal?: WithdrawalOutcome) => withdrawal?.status === 'withdrawn' && withdrawal.message?.canal === 'telegram' && withdrawal.message.status === 'sent';
const pendingText = (prenom: string, ref: string) => `Bonjour ${prenom}, votre facture pour ${ref} est bien reçue, merci ! Notre équipe met à jour votre devis avec cet achat. Merci d’attendre notre prochain message avant tout paiement : nous revenons vers vous très vite.${SIGNATURE}`;
/** Acknowledgement of a received document. No text when the D3 message itself was delivered. */
function documentReply(document: IncomingDocument | undefined, messageId: string | null, fallback: string, name: string): { text?: string; markup?: unknown } {
  if (!document) return { text: fallback };
  const prenom = document.prenom || name; const ref = document.ref || '';
  if (document.status === 'registered' && document.withdrawal) {
    if (delivered(document.withdrawal)) return {};
    if (UPDATING.includes(document.withdrawal.status)) return { text: pendingText(prenom, ref) };
  }
  if (document.status === 'identical') return { text: document.quoteSent === false
    ? `Bonjour ${prenom}, nous avions déjà ce document dans votre dossier ${ref}, merci ! Notre équipe poursuit la préparation.${SIGNATURE}`
    : `Bonjour ${prenom}, nous avions déjà ce document pour ${ref} : rien ne change pour votre devis. Merci !${SIGNATURE}` };
  if (document.status === 'ask_client' && uuid(messageId)) return {
    text: `Bonjour ${prenom}, votre document pour ${ref} est bien reçu. S’agit-il d’une facture d’achat à ajouter à ce dossier ? Si oui, votre devis sera mis à jour avec cet achat et nous vous enverrons le nouveau devis.${SIGNATURE}`,
    markup: { inline_keyboard: [[{ text: 'Oui, c’est une facture d’achat', callback_data: `lf_oui_${messageId}` }], [{ text: 'Non, autre document', callback_data: `lf_non_${messageId}` }]] },
  };
  return { text: fallback };
}
// The client answers the question about a document: only their own Telegram document qualifies.
async function lateInvoiceAnswer(chatId: number, answer: string, messageId: string): Promise<{ text?: string }> {
  const client = await db.from('clients').select('id,prenom,nom').eq('telegram_chat_id', String(chatId)).maybeSingle(); throwDb(client);
  if (!client.data) return { text: 'Ce document ne correspond pas à votre compte.' };
  if (answer === 'non') {
    // Nothing changes: the document stays in the conversation for the team.
    const message = await db.from('messages').select('colis_id').eq('id', messageId).eq('type', 'client').eq('canal', 'telegram').maybeSingle(); throwDb(message);
    const colis = message.data ? await db.from('colis').select('ref').eq('id', message.data.colis_id).eq('client_id', client.data.id).maybeSingle() : { data: null, error: null }; throwDb(colis);
    if (!colis.data) return { text: 'Ce document ne correspond pas à votre compte.' };
    return { text: `C’est noté, merci ! Votre document reste dans le dossier ${colis.data.ref} et notre équipe le consulte.${SIGNATURE}` };
  }
  const registered = await db.rpc('register_late_invoice_from_message', { p_message_id: messageId, p_chat_id: String(chatId) });
  // A refusal of the command itself is the answer (wrong account, document no longer usable); any other failure
  // (a trigger, a timeout) is retried by Telegram and never shown to the client.
  if (registered.error) { if (['42501', '22023'].includes(registered.error.code)) return { text: registered.error.message }; throw registered.error; }
  const result = registered.data || {}; const ref = result.ref || '';
  // Payment wording only for a recorded payment (never « payé » for a departure or a closed dossier).
  if (result.status === 'frozen') return { text: `${result.reason === 'departure' ? `Votre colis ${ref} est déjà parti` : result.reason === 'closed' ? `Votre dossier ${ref} est clôturé` : `Votre paiement pour ${ref} est déjà enregistré`} : nous conservons ce document et notre équipe revient vers vous si nécessaire.${SIGNATURE}` };
  // The question was about an earlier quote: the button no longer applies, nothing changes.
  if (result.status === 'stale') return { text: `Merci ! Votre document reste dans le dossier ${ref} et notre équipe le consulte. Elle revient vers vous si nécessaire.${SIGNATURE}` };
  let withdrawal: WithdrawalOutcome | undefined;
  if (uuid(result.withdrawalId)) {
    try { withdrawal = await processQuoteWithdrawal(db, result.withdrawalId, { deadline: Date.now() + 15000 }); }
    catch (error) { console.error('Late invoice processing deferred', error instanceof Error ? error.message : 'error'); }
    if (delivered(withdrawal)) return {};
    if (!withdrawal || UPDATING.includes(withdrawal.status)) return { text: pendingText(result.prenom || client.data.prenom || client.data.nom, ref) };
  }
  return { text: `Merci ! Votre facture est ajoutée au dossier ${ref}. Notre équipe la vérifie.${SIGNATURE}` };
}
async function processUpdate(update: any): Promise<{ chatId?: number; text?: string; markup?: unknown; callbackId?: string }> {
  const cb = update.callback_query;
  if (cb) {
    const chatId = cb.message?.chat?.id;
    if (!chatId || cb.message?.chat?.type !== 'private' || cb.from?.id !== chatId) throw new HttpError(403, 'Conversation privée requise');
    if (typeof cb.data !== 'string') throw new HttpError(400, 'Action invalide');
    const match = cb.data.match(/^fv_(oui|non|wait)_([0-9a-f-]{36})$/);
    if (match && uuid(match[2])) {
      const result = await db.rpc('telegram_client_decision', { p_colis_id: match[2], p_action: ({ oui:'approve',non:'refuse',wait:'wait' } as any)[match[1]], p_chat_id: String(chatId), p_message_id: String(cb.message.message_id) });
      if (result.error) return { chatId, callbackId: cb.id, text: result.error.message };
      return { chatId, callbackId: cb.id, text: match[1] === 'oui' ? `Votre accord pour ${result.data.ref} est enregistré. Notre équipe peut préparer les cartons de ce dossier. Vous recevrez votre devis dès sa finalisation.\n\nL’équipe Expedîle` : match[1] === 'wait' ? 'Votre attente est enregistrée. Les relances sont suspendues jusqu’à une nouvelle réception ou votre décision dans l’application.\n\nL’équipe Expedîle' : 'Votre refus est enregistré. Notre équipe vous contactera pour organiser la suite.\n\nL’équipe Expedîle' };
    }
    const late = cb.data.match(/^lf_(oui|non)_([0-9a-f-]{36})$/);
    if (late && uuid(late[2])) return { chatId, callbackId: cb.id, ...await lateInvoiceAnswer(chatId, late[1], late[2]) };
    const assignment = cb.data.match(/^in_([0-9a-f-]{36})_(\d+)$/);
    if (assignment && uuid(assignment[1])) {
      const client = await db.from('clients').select('id,nom,prenom').eq('telegram_chat_id', String(chatId)).single(); throwDb(client);
      const pending = await db.from('client_inbox').select('*').eq('telegram_update_id', Number(assignment[2])).eq('client_id', client.data.id).single(); throwDb(pending);
      const colis = await db.from('colis').select('id,ref,statut,paiement_date').eq('id', assignment[1]).eq('client_id', client.data.id).single(); throwDb(colis);
      if (pending.data.status === 'assigned') return { chatId, callbackId: cb.id, text: 'Ce message a déjà été rattaché à son dossier.' };
      const claim = await db.rpc('claim_inbox_assignment',{p_inbox_id:pending.data.id,p_colis_id:colis.data.id}); throwDb(claim);
      let saved: Awaited<ReturnType<typeof saveIncoming>> | undefined;
      if (claim.data.status !== 'assigned') {
        try { saved = await saveIncoming(db, client.data, colis.data, pending.data.payload, pending.data.telegram_update_id); }
        catch (error) {
          if (!(error instanceof HttpError) || error.status !== 400) throw error;
          throwDb(await db.from('client_inbox').update({ status: 'unassigned', payload: { ...pending.data.payload, intake_error: error.message }, texte: `${colis.data.ref} — ${error.message}` }).eq('id', pending.data.id));
          return { chatId, callbackId: cb.id, text: `${error.message}. Notre équipe conserve votre demande. Envoyez un fichier compatible.` };
        }
      }
      throwDb(await db.from('client_inbox').update({ colis_id: colis.data.id, status: 'assigned' }).eq('id', pending.data.id));
      return { chatId, callbackId: cb.id, ...documentReply(saved?.document, saved?.messageId ?? null, `Votre message est enregistré dans ${colis.data.ref}. Notre équipe le retrouvera dans ce dossier.`, client.data.prenom || client.data.nom) };
    }
    return { chatId, callbackId: cb.id, text: 'Ce bouton n’est pas une décision reconnue. Ouvrez le dossier dans l’application.' };
  }
  const msg = update.message;
  if (!msg || msg.chat?.type !== 'private' || msg.from?.id !== msg.chat.id) return {};
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (/^\/start(?:\s|$)/.test(text)) {
    const token = text.split(/\s+/)[1];
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return { chatId, text: 'Bonjour ! Ouvrez votre profil Expedîle et utilisez « Lier Telegram » pour obtenir votre invitation personnelle valable 24 heures.\n\nL’équipe Expedîle' };
    const result = await db.rpc('consume_telegram_invitation', { p_token: token, p_chat_id: String(chatId) });
    return { chatId, text: result.error ? result.error.message : `Bonjour ${result.data.prenom || result.data.nom}, votre compte Telegram est lié. Utilisez /statut pour retrouver vos dossiers.\n\nL’équipe Expedîle` };
  }
  const customer = await db.from('clients').select('id,nom,prenom').eq('telegram_chat_id', String(chatId)).maybeSingle(); throwDb(customer);
  if (!customer.data) return { chatId, text: 'Liez d’abord votre compte depuis votre profil Expedîle pour recevoir vos informations personnelles.' };
  const client = customer.data;
  const active = await db.from('colis').select('id,ref,statut').eq('client_id', client.id).not('statut','in','(livre,annule)').eq('archive', false).order('created_at', { ascending: false }); throwDb(active);
  if (text === '/statut') return { chatId, text: `Bonjour ${client.prenom || client.nom},\n\n${active.data.map((c: any) => `${c.ref} : ${c.statut.replaceAll('_',' ')}`).join('\n') || 'Aucun dossier actif.'}\n\nL’équipe Expedîle` };
  if (text === '/aide') return { chatId, text: 'Pour envoyer une facture ou un message, répondez à un message du dossier ou indiquez sa référence EXP. Si plusieurs dossiers sont ouverts, nous vous proposerons de choisir. /statut affiche vos dossiers.\n\nL’équipe Expedîle' };
  const ref = `${text} ${msg.caption || ''}`.match(/\bEXP-[A-Z0-9]+\b/i)?.[0];
  const resolved = await db.rpc('resolve_telegram_message_colis', { p_client_id: client.id, p_reply_message_id: msg.reply_to_message ? String(msg.reply_to_message.message_id) : null, p_ref: ref || null }); throwDb(resolved);
  const chosen = resolved.data;
  if (!chosen) {
    throwDb(await db.from('client_inbox').upsert({ client_id: client.id, texte: text || msg.caption || 'Document reçu', telegram_update_id: update.update_id, payload: msg }, { onConflict: 'telegram_update_id', ignoreDuplicates: true }));
    return { chatId, text: active.data.length ? 'À quel dossier correspond ce message ou document ? Choisissez ci-dessous pour que notre équipe puisse le traiter.' : 'Votre message est enregistré pour notre équipe. Aucun dossier actif ne permet encore de le rattacher.', markup: { inline_keyboard: active.data.slice(0,10).map((c: any) => [{ text: c.ref, callback_data: `in_${c.id}_${update.update_id}` }]) } };
  }
  let saved: Awaited<ReturnType<typeof saveIncoming>>;
  try {
    saved = await saveIncoming(db, client, chosen, msg, update.update_id);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 400) throw error;
    // Unsupported documents are a durable team request, not endless webhook retries.
    throwDb(await db.from('client_inbox').upsert({ client_id: client.id, texte: `${chosen.ref} — ${error.message}`, telegram_update_id: update.update_id, payload: { ...msg, intake_error: error.message } }, { onConflict: 'telegram_update_id', ignoreDuplicates: true }));
    return { chatId, text: `${error.message}. Votre demande pour ${chosen.ref} a été transmise à notre équipe. Vous pouvez envoyer un document PDF, JPEG, PNG ou WebP de moins de 10 Mo.` };
  }
  return { chatId, ...documentReply(saved.document, saved.messageId, `Bonjour ${client.prenom || client.nom}, votre ${msg.document || msg.photo ? 'document' : 'message'} est enregistré pour ${chosen.ref}. Notre équipe le retrouvera dans ce dossier.\n\nL’équipe Expedîle`, client.prenom || client.nom) };
}
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'Webhook non configuré' }, 503);
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) return json({ error: 'Unauthorized' }, 401);
  let updateId: number | undefined;
  try {
    const update = await req.json(); updateId = update.update_id;
    if (!Number.isSafeInteger(updateId)) throw new HttpError(400, 'Update invalide');
    const claimed = await db.rpc('claim_telegram_update', { p_update_id: updateId }); throwDb(claimed);
    if (claimed.data === 'done') return json({ ok: true, duplicate: true });
    if (claimed.data === 'busy') return json({ error: 'Update en cours' }, 503);
    const result = await processUpdate(update);
    throwDb(await db.from('telegram_updates').update({ status: 'done', processed_at: new Date().toISOString() }).eq('update_id', updateId));
    // Persistence is complete. A failure in the acknowledgement must not replay a decision.
    try {
      if (result.callbackId) await telegram('answerCallbackQuery', { callback_query_id: result.callbackId, text: 'Réponse traitée' });
      if (result.chatId && result.text) await reply(result.chatId, result.text, result.markup);
    } catch (error) { console.error('Telegram acknowledgement unavailable', error instanceof Error ? error.message : 'error'); }
    return json({ ok: true });
  } catch (error) {
    if (updateId !== undefined) await db.from('telegram_updates').update({ status: 'failed' }).eq('update_id', updateId);
    return fail(error);
  }
});
