import { HttpError, throwDb } from './http.ts';
const supersededConsentDelivery = (messageId: string) => ({ ok: false, status: 'superseded', messageId,
  error: 'Message livré à Telegram pour une ancienne demande. La nouvelle demande reste à envoyer.' });
export async function telegram(method: string, body: Record<string, unknown>) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) throw new HttpError(503, 'Telegram n’est pas configuré');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new HttpError(502, 'Telegram n’a pas confirmé la livraison du message');
  return data.result;
}
export async function dispatchOutbox(db: any, outboxId: string) {
  const claimed = await db.from('notification_outbox').update({ status: 'sending', locked_at: new Date().toISOString() }).eq('id', outboxId).in('status', ['pending','blocked']).select('*').maybeSingle();
  throwDb(claimed);
  if (!claimed.data) {
    const current = await db.from('notification_outbox').select('status,message_id,colis_id').eq('id', outboxId).single(); throwDb(current);
    if (current.data.status === 'sent') {
      const message = await db.from('messages').select('template,request_snapshot').eq('id', current.data.message_id).single(); throwDb(message);
      if (['demande_feu_vert','relance_feu_vert'].includes(message.data.template)) {
        const dossier = await db.from('colis').select('consent_request_version').eq('id', current.data.colis_id).single(); throwDb(dossier);
        if ((message.data.request_snapshot?.consent_request_version ?? 0) !== (dossier.data.consent_request_version ?? 0)) return supersededConsentDelivery(current.data.message_id);
      }
    }
    return { ok: current.data.status === 'sent', status: current.data.status, messageId: current.data.message_id };
  }
  const outbox = claimed.data;
  try {
    if (String(outbox.idempotency_key || '').startsWith('reminder:')) {
      throwDb(await db.from('notification_outbox').update({ status: 'cancelled', last_error: 'Rappel automatique arrêté : l’équipe décide de l’envoi.' }).eq('id', outbox.id));
      throwDb(await db.from('messages').update({ statut: 'echec' }).eq('id', outbox.message_id));
      return { ok: false, status: 'cancelled', messageId: outbox.message_id };
    }
    const [message, client, colis] = await Promise.all([
      db.from('messages').select('*').eq('id', outbox.message_id).single(),
      db.from('clients').select('telegram_chat_id').eq('id', outbox.client_id).single(),
      db.from('colis').select('statut,archive,attente_client_date,quote_version,trackings,trackings_detail,nb_colis,demande_feu_vert_envoyee_at,consent_request_version').eq('id', outbox.colis_id).single(),
    ]); [message, client, colis].forEach(throwDb);
    const preparationRequest = ['demande_feu_vert','relance_feu_vert'].includes(message.data.template);
    const currentSnapshot = { trackings:colis.data.trackings,trackings_detail:colis.data.trackings_detail,nb_colis:colis.data.nb_colis };
    const consentVersion = colis.data.consent_request_version ?? 0;
    const requestVersion = message.data.request_snapshot?.consent_request_version ?? 0;
    const snapshotMatches = message.data.request_snapshot && Number.isInteger(requestVersion) && requestVersion === consentVersion
      && Object.keys(currentSnapshot).every((key) => JSON.stringify(currentSnapshot[key as keyof typeof currentSnapshot]) === JSON.stringify(message.data.request_snapshot[key]));
    const outdatedPreparation = preparationRequest && (colis.data.statut !== 'attente_feu_vert' || colis.data.attente_client_date || !snapshotMatches);
    const outdatedPayment = message.data.template === 'relance_paiement' && (!['devis_envoye','attente_paiement'].includes(colis.data.statut) || outbox.quote_version !== colis.data.quote_version);
    // A quote withdrawn or replaced after queueing must never reach the client with its old amount or link.
    const quoteMessage = ['devis_final','devis_final_pro'].includes(message.data.template);
    const outdatedQuote = quoteMessage && (outbox.quote_version !== colis.data.quote_version || !['devis_envoye','attente_paiement'].includes(colis.data.statut));
    const archivedRequest = colis.data.archive && (preparationRequest || quoteMessage || message.data.template === 'relance_paiement');
    if (outdatedPreparation || outdatedPayment || outdatedQuote || archivedRequest) {
      const error = 'Le dossier ou la demande a changé. Préparez un nouveau message avant de l’envoyer.';
      throwDb(await db.from('notification_outbox').update({ status: 'cancelled', last_error: error }).eq('id', outbox.id));
      throwDb(await db.from('messages').update({ statut:'echec' }).eq('id',outbox.message_id));
      return { ok: false, status: 'cancelled', error, messageId: outbox.message_id };
    }
    if (['relance_feu_vert','relance_paiement'].includes(message.data.template)) {
      // Recheck immediately before the provider call: a client may have replied
      // after this reminder was queued, including on another of their dossiers.
      const open = await db.rpc('client_has_open_conversation',{p_client_id:outbox.client_id}); throwDb(open);
      if (open.data) {
        throwDb(await db.from('notification_outbox').update({status:'blocked',last_error:'Conversation client à traiter avant toute relance',available_at:new Date(Date.now()+300000).toISOString()}).eq('id',outbox.id));
        return {ok:false,status:'blocked',messageId:outbox.message_id};
      }
      const recent = await db.from('notification_outbox').select('sent_at,messages!inner(template)').eq('client_id',outbox.client_id).eq('status','sent').in('messages.template',['relance_feu_vert','relance_paiement']).gte('sent_at',new Date(Date.now()-86400000).toISOString()).order('sent_at',{ascending:false}).limit(1).maybeSingle(); throwDb(recent);
      if (recent.data?.sent_at) {
        throwDb(await db.from('notification_outbox').update({status:'pending',available_at:new Date(Date.parse(recent.data.sent_at)+86400000).toISOString(),last_error:'Un rappel a déjà été envoyé à ce client dans les dernières 24 heures'}).eq('id',outbox.id));
        return {ok:false,status:'scheduled',messageId:outbox.message_id};
      }
    }
    const result = await telegram('sendMessage', { chat_id: client.data.telegram_chat_id, text: message.data.texte, ...(outbox.reply_markup ? { reply_markup: outbox.reply_markup } : {}) });
    // A provider timeout or a failure AFTER send may have delivered a message. Never auto-retry
    // these ambiguous sends: retain failed for operator review, so clients are not spammed.
    throwDb(await db.from('messages').update({ statut: 'envoye', telegram_msg_id: String(result.message_id) }).eq('id', outbox.message_id));
    throwDb(await db.from('notification_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), attempts: outbox.attempts + 1, last_error: null }).eq('id', outbox.id));
    if (preparationRequest) {
      // A colleague may reopen the agreement while Telegram is receiving this
      // message. Keep the delivery in history, but never date the new request
      // with the delivery of an old one. A reminder preserves the original date.
      const recordDelivery = message.data.template === 'demande_feu_vert' || !colis.data.demande_feu_vert_envoyee_at;
      let currentRequest = recordDelivery
        ? db.from('colis').update({ demande_feu_vert_envoyee_at: new Date().toISOString() })
        : db.from('colis').select('consent_request_version');
      currentRequest = currentRequest.eq('id', outbox.colis_id).eq('consent_request_version', consentVersion);
      if (recordDelivery && message.data.template === 'relance_feu_vert') currentRequest = currentRequest.is('demande_feu_vert_envoyee_at', null);
      if (recordDelivery) currentRequest = currentRequest.select('consent_request_version');
      const confirmation = await currentRequest.maybeSingle(); throwDb(confirmation);
      let stillCurrent = !!confirmation.data;
      if (!stillCurrent && recordDelivery && message.data.template === 'relance_feu_vert') {
        const concurrentDelivery = await db.from('colis').select('consent_request_version').eq('id', outbox.colis_id).eq('consent_request_version', consentVersion).maybeSingle(); throwDb(concurrentDelivery);
        stillCurrent = !!concurrentDelivery.data;
      }
      if (!stillCurrent) return supersededConsentDelivery(outbox.message_id);
    }
    return { ok: true, status: 'sent', messageId: result.message_id };
  } catch (error) {
    await db.from('notification_outbox').update({ status: 'failed', attempts: outbox.attempts + 1, last_error: error instanceof Error ? error.message : 'Delivery not confirmed' }).eq('id', outbox.id);
    await db.from('messages').update({ statut: 'echec' }).eq('id', outbox.message_id);
    throw error;
  }
}
