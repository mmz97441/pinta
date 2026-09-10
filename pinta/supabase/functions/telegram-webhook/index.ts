import { admin, fail, HttpError, json, throwDb, uuid } from '../_shared/http.ts';
import { telegram } from '../_shared/telegram.ts';
import { saveIncoming } from '../_shared/telegramIncoming.ts';

const db = admin();
const reply = (chatId: number, text: string, replyMarkup?: unknown) => telegram('sendMessage', { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
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
    const assignment = cb.data.match(/^in_([0-9a-f-]{36})_(\d+)$/);
    if (assignment && uuid(assignment[1])) {
      const client = await db.from('clients').select('id,nom,prenom').eq('telegram_chat_id', String(chatId)).single(); throwDb(client);
      const pending = await db.from('client_inbox').select('*').eq('telegram_update_id', Number(assignment[2])).eq('client_id', client.data.id).single(); throwDb(pending);
      const colis = await db.from('colis').select('id,ref').eq('id', assignment[1]).eq('client_id', client.data.id).single(); throwDb(colis);
      if (pending.data.status === 'assigned') return { chatId, callbackId: cb.id, text: 'Ce message a déjà été rattaché à son dossier.' };
      const claim = await db.rpc('claim_inbox_assignment',{p_inbox_id:pending.data.id,p_colis_id:colis.data.id}); throwDb(claim);
      if (claim.data.status !== 'assigned') await saveIncoming(db, client.data, colis.data, pending.data.payload, pending.data.telegram_update_id);
      throwDb(await db.from('client_inbox').update({ colis_id: colis.data.id, status: 'assigned' }).eq('id', pending.data.id));
      return { chatId, callbackId: cb.id, text: `Votre message est enregistré dans ${colis.data.ref}. Notre équipe le retrouvera dans ce dossier.` };
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
  const active = await db.from('colis').select('id,ref,statut').eq('client_id', client.id).not('statut','in','(livre,annule)').order('created_at', { ascending: false }); throwDb(active);
  if (text === '/statut') return { chatId, text: `Bonjour ${client.prenom || client.nom},\n\n${active.data.map((c: any) => `${c.ref} : ${c.statut.replaceAll('_',' ')}`).join('\n') || 'Aucun dossier actif.'}\n\nL’équipe Expedîle` };
  if (text === '/aide') return { chatId, text: 'Pour envoyer une facture ou un message, répondez à un message du dossier ou indiquez sa référence EXP. Si plusieurs dossiers sont ouverts, nous vous proposerons de choisir. /statut affiche vos dossiers.\n\nL’équipe Expedîle' };
  let chosen = active.data.length === 1 ? active.data[0] : null;
  const ref = `${text} ${msg.caption || ''}`.match(/\bEXP-[A-Z0-9]+\b/i)?.[0];
  if (ref) chosen = active.data.find((c: any) => c.ref.toUpperCase() === ref.toUpperCase()) || null;
  if (!chosen && msg.reply_to_message && active.data.length) {
    const original = await db.from('messages').select('colis_id').eq('telegram_msg_id', String(msg.reply_to_message.message_id)).in('colis_id', active.data.map((c: any) => c.id)).limit(1).maybeSingle(); throwDb(original);
    chosen = active.data.find((c: any) => c.id === original.data?.colis_id);
  }
  if (!chosen) {
    throwDb(await db.from('client_inbox').upsert({ client_id: client.id, texte: text || msg.caption || 'Document reçu', telegram_update_id: update.update_id, payload: msg }, { onConflict: 'telegram_update_id', ignoreDuplicates: true }));
    return { chatId, text: active.data.length ? 'À quel dossier correspond ce message ou document ? Choisissez ci-dessous pour que notre équipe puisse le traiter.' : 'Votre message est enregistré pour notre équipe. Aucun dossier actif ne permet encore de le rattacher.', markup: { inline_keyboard: active.data.slice(0,10).map((c: any) => [{ text: c.ref, callback_data: `in_${c.id}_${update.update_id}` }]) } };
  }
  await saveIncoming(db, client, chosen, msg, update.update_id);
  return { chatId, text: `Bonjour ${client.prenom || client.nom}, votre ${msg.document || msg.photo ? 'document' : 'message'} est enregistré pour ${chosen.ref}. Notre équipe le retrouvera dans ce dossier.\n\nL’équipe Expedîle` };
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
