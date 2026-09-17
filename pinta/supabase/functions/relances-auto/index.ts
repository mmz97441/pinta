import { admin, fail, HttpError, json, postOnly, requireStaff, throwDb } from '../_shared/http.ts';
import { processOcrQueue } from '../_shared/ocrQueue.ts';
import { dispatchOutbox } from '../_shared/telegram.ts';

Deno.serve(async (req: Request) => {
  const early = postOnly(req); if (early) return early;
  try {
    const db = admin();
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cronKey = Deno.env.get('RELANCES_CRON_SECRET')?.trim();
    const trustedCron = Boolean(cronKey && token === cronKey);
    if (!trustedCron && (!serviceKey || token !== serviceKey)) await requireStaff(req,'perm_admin_parametres',db);
    let scanned = 0, queued = 0, sent = 0;
    // Cursor pagination: no truncation after Supabase's 1,000-row response cap.
    let cursor = '';
    while (true) {
      let query = db.from('colis').select('*').eq('archive',false).in('statut',['attente_feu_vert','devis_envoye','attente_paiement']).order('id').limit(200);
      if (cursor) query=query.gt('id',cursor);
      const batch = await query; throwDb(batch);
      if (!batch.data.length) break;
      for (const c of batch.data) {
        scanned++;
        if (c.attente_client_date) {
          if (!c.attente_client_until || new Date(c.attente_client_until).getTime()>Date.now()) continue;
          throwDb(await db.from('colis').update({ attente_client_date:null,attente_client_motif:null,attente_client_until:null,demande_feu_vert_envoyee_at:null,next_action_source:'system',next_action:'Demande de préparation à renouveler',next_action_at:null }).eq('id',c.id));
          continue;
        }
        // Client reminders are decided and sent by the responsible operator.
        // The existing staff work queue exposes due dates; this worker never
        // generates a customer notification, even for previously activated rules.

      }
      cursor=batch.data[batch.data.length-1].id;
    }
    // Failed/ambiguous sends require operator review. Never silently resend them.
    const stale = await db.from('notification_outbox').update({status:'failed',last_error:'Envoi interrompu : vérifier Telegram avant de renvoyer'}).eq('status','sending').lt('locked_at',new Date(Date.now()-300000).toISOString()); throwDb(stale);
    const pending = await db.from('notification_outbox').select('id').in('status',['pending','blocked']).lte('available_at',new Date().toISOString()).order('created_at').limit(100); throwDb(pending);
    const dispatchStarted=Date.now();
    for (const row of pending.data) { if (!Deno.env.get('TELEGRAM_BOT_TOKEN') || Date.now()-dispatchStarted>40000) break; try { const result=await dispatchOutbox(db,row.id); if(result.ok) sent++; } catch { /* failure is durable in outbox, continue other clients */ } }
    const ocr = await processOcrQueue(db);
    return json({scanned,queued,sent,ocr,remindersMode:'manual'});
  } catch (error) { return fail(error); }
});
