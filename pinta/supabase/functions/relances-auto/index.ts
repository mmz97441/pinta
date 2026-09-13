import { admin, fail, HttpError, json, postOnly, requireStaff, throwDb } from '../_shared/http.ts';
import { renderMessage } from '../_shared/messageTemplate.ts';
import { processOcrQueue } from '../_shared/ocrQueue.ts';
import { dispatchOutbox } from '../_shared/telegram.ts';
import { isReminderInActiveWindow, reminderTimestamp } from '../_shared/reminderWindow.ts';

function milestones(value: unknown): number[] {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').map((v) => Number(v.trim().replace(/^J\+/i,''))).filter((v) => Number.isFinite(v) && v > 0 && v <= 90))].sort((a,b)=>a-b);
}
Deno.serve(async (req: Request) => {
  const early = postOnly(req); if (early) return early;
  try {
    const db = admin();
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cronKey = Deno.env.get('RELANCES_CRON_SECRET')?.trim();
    const trustedCron = Boolean(cronKey && token === cronKey);
    if (!trustedCron && (!serviceKey || token !== serviceKey)) await requireStaff(req,'perm_admin_parametres',db);
    const settings = await db.from('app_settings').select('value').eq('key','business').maybeSingle(); throwDb(settings);
    const params = settings.data?.value || {};
    let scanned = 0, queued = 0, sent = 0;
    const remindedClients = new Set<string>();
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
        if (remindedClients.has(c.client_id)) continue;
        const feuVert = c.statut==='attente_feu_vert';
        const since = feuVert ? c.demande_feu_vert_envoyee_at : c.devis_envoye_le;
        // A deployment must never trigger a batch of reminders for historical
        // requests. Missing/invalid activation dates disable only generation;
        // explicit messages in the outbox and OCR still run below.
        if (!isReminderInActiveWindow(since,params.relancesActivesDepuis)) continue;
        // A read flag is not a resolution. Any unresolved conversation or
        // unassigned incoming message for this client suspends follow-ups.
        const open = await db.rpc('client_has_open_conversation',{p_client_id:c.client_id}); throwDb(open);
        if (open.data) continue;
        const outstanding = await db.from('notification_outbox').select('id,messages!inner(template)').eq('client_id',c.client_id).in('messages.template',['relance_feu_vert','relance_paiement']).in('status',['pending','sending','blocked']).limit(1); throwDb(outstanding);
        if (outstanding.data.length) { remindedClients.add(c.client_id); continue; }
        const previous = await db.from('notification_outbox').select('id,messages!inner(template)').eq('client_id',c.client_id).in('messages.template',['relance_feu_vert','relance_paiement']).gte('created_at',new Date(Date.now()-86400000).toISOString()).limit(1); throwDb(previous);
        if (previous.data.length) { remindedClients.add(c.client_id); continue; }
        const days = (Date.now()-new Date(since).getTime())/86400000;
        const due = milestones(feuVert ? params.relancesFeuVert : params.relancesPaiement).filter((d)=>d<=days);
        if (!due.length) continue;
        const client = await db.from('clients').select('id,prenom,nom,cp,telegram_chat_id,type').eq('id',c.client_id).single(); throwDb(client);
        if (!client.data.telegram_chat_id || (!feuVert && (client.data.type==='pro' || !c.payplug_payment_url))) continue;
        // Queue only the most recent due stage after downtime; never burst all missed reminders.
        const stage = due[due.length-1];
        const key = `reminder:${c.id}:${feuVert ? since : c.quote_version}:${stage}`;
        const old = await db.from('notification_outbox').select('id').eq('idempotency_key',key).maybeSingle(); throwDb(old); if (old.data) continue;
        const prenom = client.data.prenom || client.data.nom;
        const template = feuVert ? 'relance_feu_vert' : 'relance_paiement';
        const fallback = feuVert ? renderMessage('Bonjour {{prenom}},\n\nVotre dossier {{ref}} contient {{nb_cartons}} carton(s) :\n{{liste_cartons}}\n\nNous attendons votre choix pour préparer ces cartons, continuer à attendre ou échanger avec notre équipe.\n\nLa préparation commencera après votre accord. Les documents d’achat peuvent être ajoutés dans votre espace ou en réponse à ce message.\n\nL’équipe Expedîle',client.data,c,null,params) : `Bonjour ${prenom},\n\nLe devis de votre dossier ${c.ref} est prêt. Vous pouvez consulter votre espace et régler le montant indiqué : ${c.payplug_payment_url}\n\nSi vous avez une question sur le devis, répondez à ce message. Notre équipe vous accompagne.\n\nL’équipe Expedîle`;
        const tpl = await db.from('message_templates').select('body').eq('key',template).eq('canal','telegram').maybeSingle(); throwDb(tpl);
        let text=fallback;
        if (tpl.data?.body) {
          const [destination,lines,invoices]=await Promise.all([
            db.from('destinations').select('*').eq('code',client.data.cp.slice(0,3)).single(),
            db.from('lignes').select('*').eq('colis_id',c.id),db.from('factures').select('*').eq('colis_id',c.id),
          ]);[destination,lines,invoices].forEach(throwDb);
          try { text=renderMessage(tpl.data.body,client.data,c,destination.data,params,lines.data,invoices.data); }
          catch(error) {
            throwDb(await db.from('colis').update({next_action_source:'system',next_action:error instanceof Error?error.message:'Modèle de relance à corriger',next_action_at:null}).eq('id',c.id));
            continue;
          }
        }
        const markup = feuVert ? { inline_keyboard:[[{text:'Autoriser la préparation',callback_data:`fv_oui_${c.id}`}],[{text:'Attendre d’autres colis',callback_data:`fv_wait_${c.id}`}],[{text:'Refuser',callback_data:`fv_non_${c.id}`}]] } : null;
        const created = await db.rpc('queue_message',{p_colis_id:c.id,p_text:text,p_template:template,p_idempotency_key:key,p_reply_markup:markup,p_canal:'telegram'}); throwDb(created); queued++; remindedClients.add(c.client_id);
      }
      cursor=batch.data[batch.data.length-1].id;
    }
    // Failed/ambiguous sends require operator review. Never silently resend them.
    const stale = await db.from('notification_outbox').update({status:'failed',last_error:'Envoi interrompu : vérifier Telegram avant de renvoyer'}).eq('status','sending').lt('locked_at',new Date(Date.now()-300000).toISOString()); throwDb(stale);
    const pending = await db.from('notification_outbox').select('id').in('status',['pending','blocked']).lte('available_at',new Date().toISOString()).order('created_at').limit(100); throwDb(pending);
    const dispatchStarted=Date.now();
    for (const row of pending.data) { if (!Deno.env.get('TELEGRAM_BOT_TOKEN') || Date.now()-dispatchStarted>40000) break; try { const result=await dispatchOutbox(db,row.id); if(result.ok) sent++; } catch { /* failure is durable in outbox, continue other clients */ } }
    const ocr = await processOcrQueue(db);
    return json({scanned,queued,sent,ocr,remindersActivationValid:reminderTimestamp(params.relancesActivesDepuis)!==null});
  } catch (error) { return fail(error); }
});
