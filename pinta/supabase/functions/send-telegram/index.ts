import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { admin, fail, HttpError, json, postOnly, requireStaff, throwDb, uuid } from '../_shared/http.ts';
import { dispatchOutbox } from '../_shared/telegram.ts';

Deno.serve(async (req: Request) => {
  const early = postOnly(req); if (early) return early;
  try {
    const db = admin(); const user = await requireStaff(req, 'perm_comm_telegram', db);
    const body = await req.json();
    let outboxId = body.outboxId;
    if (!outboxId && !body.messageId && body.chatId && body.text) {
      const clients = await db.from('clients').select('id').eq('telegram_chat_id', String(body.chatId)); throwDb(clients);
      if (clients.data.length !== 1) throw new HttpError(400, 'Ce chat doit être lié à un seul client');
      let query = db.from('colis').select('id').eq('client_id', clients.data[0].id);
      if (body.colisId) query = query.eq('id',body.colisId);
      else query = query.not('statut','in','(livre,annule)');
      const colis = await query.limit(2); throwDb(colis);
      if (colis.data.length !== 1) throw new HttpError(400,'Précisez le dossier du message');
      const scoped = createClient(Deno.env.get('SUPABASE_URL') || '',Deno.env.get('SUPABASE_ANON_KEY') || '',{global:{headers:{Authorization:`Bearer ${user.token}`}},auth:{persistSession:false}});
      const queued=await scoped.rpc('queue_message',{p_colis_id:colis.data[0].id,p_text:body.text,p_template:body.template || null,p_idempotency_key:body.idempotencyKey || null,p_reply_markup:body.replyMarkup || null,p_canal:'telegram'}); throwDb(queued);
      outboxId=queued.data.outbox.id;
    }
    if (!outboxId && body.messageId) {
      const row = await db.from('notification_outbox').select('id').eq('message_id', body.messageId).single(); throwDb(row); outboxId = row.data.id;
    }
    if (!uuid(outboxId)) throw new HttpError(400, 'Un message enregistré dans la file d’envoi est requis');
    const row = await db.from('notification_outbox').select('colis_id,canal').eq('id', outboxId).single(); throwDb(row);
    if (row.data.canal !== 'telegram' || (body.colisId && body.colisId !== row.data.colis_id)) throw new HttpError(400, 'Message et dossier incompatibles');
    if (body.retryConfirmed === true) {
      const retry = await db.from('notification_outbox').update({ status:'pending',available_at:new Date().toISOString(),last_error:null }).eq('id',outboxId).eq('status','failed').select('id').maybeSingle(); throwDb(retry);
      if (retry.data) throwDb(await db.from('audit_actions').insert({ colis_id:row.data.colis_id,user_id:user.id,user_nom:user.nom,action:'retry_message',detail:'Renvoi manuel après vérification de la réception dans Telegram' }));
    }
    return json(await dispatchOutbox(db, outboxId));
  } catch (error) { return fail(error); }
});
