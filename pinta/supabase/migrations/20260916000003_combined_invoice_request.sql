-- The combined receipt/approval message asks for invoices only when the
-- dossier still needs them. This fact belongs to the durable server snapshot,
-- never to a guess from arbitrary client text or an old template name.
CREATE OR REPLACE FUNCTION queue_message(p_colis_id uuid,p_text text,p_template text DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_reply_markup jsonb DEFAULT NULL,p_canal text DEFAULT 'telegram') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; cl clients; m messages; ob notification_outbox; snap jsonb; invoice_requested boolean;
BEGIN
 IF auth.role()<>'service_role' AND NOT has_permission(CASE WHEN p_canal='email' THEN 'perm_comm_email' WHEN p_canal='portal' THEN 'perm_comm_message_libre' ELSE 'perm_comm_telegram' END) THEN RAISE EXCEPTION 'Permission communication requise'; END IF;
 IF p_canal NOT IN ('telegram','email','portal') OR length(trim(p_text))=0 OR length(p_text)>4096 THEN RAISE EXCEPTION 'Message invalide (1 à 4096 caractères)'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Colis introuvable'; END IF;
 SELECT * INTO cl FROM clients WHERE id=c.client_id;
 IF p_canal='portal' AND cl.user_id IS NULL THEN RAISE EXCEPTION 'Activez l’accès client avant d’envoyer un message dans son espace' USING ERRCODE='22023'; END IF;
 IF p_canal='telegram' AND cl.telegram_chat_id IS NULL THEN RAISE EXCEPTION 'Telegram doit être lié au compte client'; END IF;
 IF p_idempotency_key IS NOT NULL THEN
  SELECT * INTO ob FROM notification_outbox WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN SELECT * INTO m FROM messages WHERE id=ob.message_id; RETURN jsonb_build_object('message',to_jsonb(m),'outbox',to_jsonb(ob)); END IF;
 END IF;
 IF p_template IN ('demande_feu_vert','relance_feu_vert') THEN
  snap:=jsonb_build_object('trackings',c.trackings,'trackings_detail',c.trackings_detail,'nb_colis',c.nb_colis);
  IF p_template='demande_feu_vert' THEN
   WITH current_invoices AS (
    SELECT f.* FROM factures f WHERE f.colis_id=c.id AND f.duplicate_of_facture_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)
   )
   SELECT NOT EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NULL)
     OR EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NOT NULL)
   INTO invoice_requested;
   snap:=snap||jsonb_build_object('invoice_requested',invoice_requested);
  END IF;
 END IF;
 INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,statut,canal,template,request_snapshot)
 VALUES(c.id,'staff',auth.uid(),coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),'Expedîle'),p_text,
 CASE WHEN p_canal='portal' THEN 'envoye'::statut_message ELSE 'envoi'::statut_message END,p_canal,p_template,snap) RETURNING * INTO m;
 INSERT INTO notification_outbox(message_id,client_id,colis_id,quote_version,canal,reply_markup,idempotency_key,status)
 VALUES(m.id,cl.id,c.id,c.quote_version,p_canal,p_reply_markup,p_idempotency_key,CASE p_canal WHEN 'email' THEN 'manual' WHEN 'portal' THEN 'sent' ELSE 'pending' END) RETURNING * INTO ob;
 IF cl.user_id IS NOT NULL THEN INSERT INTO notifications(user_id,titre,msg,colis_id,type) VALUES(cl.user_id,'Un message pour '||c.ref,p_text,c.id,'message'); END IF;
 RETURN jsonb_build_object('message',to_jsonb(m),'outbox',to_jsonb(ob));
END; $$;

-- The second argument comes exclusively from Telegram's reply_to_message in
-- its authenticated webhook payload (including later inbox assignment).
-- Replying explicitly to the same invoice request can supply several invoices.
-- An unthreaded later photograph keeps the conservative one-document guard.
CREATE OR REPLACE FUNCTION register_requested_invoice(p_message_id uuid,p_reply_message_id text)
RETURNS factures LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE incoming messages; dossier colis; invoice factures; request_id uuid; request_sent_at timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Service Telegram requis' USING ERRCODE='42501';
 END IF;
 SELECT * INTO incoming FROM messages WHERE id=p_message_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Message introuvable' USING ERRCODE='22023'; END IF;
 IF incoming.type<>'client' OR incoming.canal<>'telegram' OR incoming.attachment_path IS NULL
    OR incoming.attachment_type IS NULL OR incoming.attachment_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp') THEN RETURN NULL; END IF;
 SELECT * INTO dossier FROM colis WHERE id=incoming.colis_id FOR UPDATE;
 SELECT * INTO invoice FROM factures WHERE colis_id=dossier.id AND fichier_url=incoming.attachment_path LIMIT 1;
 IF FOUND THEN RETURN invoice; END IF;
 IF dossier.archive OR dossier.paiement_date IS NOT NULL
    OR dossier.statut IN ('paye','expedie','transit','dedouanement','arrive','livraison','livre','annule') THEN RETURN NULL; END IF;
 p_reply_message_id:=nullif(trim(p_reply_message_id),'');
 SELECT request.id,coalesce(delivery.sent_at,request.created_at) INTO request_id,request_sent_at
 FROM messages request LEFT JOIN notification_outbox delivery ON delivery.message_id=request.id
 WHERE request.colis_id=dossier.id AND request.type='staff' AND request.canal='telegram'
  AND (request.template IN ('facture_manquante','demande_facture')
    OR (request.template='demande_feu_vert' AND request.request_snapshot->'invoice_requested'='true'::jsonb))
  AND request.statut IN ('envoye','distribue','lu')
  AND (p_reply_message_id IS NULL OR request.telegram_msg_id=p_reply_message_id)
  AND coalesce(delivery.sent_at,request.created_at)<=incoming.created_at
  AND coalesce(delivery.sent_at,request.created_at)>=incoming.created_at-interval '7 days'
 ORDER BY coalesce(delivery.sent_at,request.created_at) DESC LIMIT 1;
 IF request_id IS NULL THEN RETURN NULL; END IF;
 IF p_reply_message_id IS NULL AND EXISTS(
  SELECT 1 FROM factures f WHERE f.colis_id=dossier.id AND f.rejet_motif IS NULL
   AND f.duplicate_of_facture_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)
   AND f.created_at>=request_sent_at
 ) THEN RETURN NULL; END IF;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom,telegram_event_key)
 VALUES(dossier.id,'Document à vérifier',0,false,incoming.attachment_path,incoming.attachment_name,incoming.telegram_event_key)
 RETURNING * INTO invoice;
 INSERT INTO audit_actions(colis_id,user_id,action,detail)
 VALUES(dossier.id,NULL,'telegram_requested_invoice',jsonb_build_object('message_id',incoming.id,
  'request_message_id',request_id,'facture_id',invoice.id,'reply_to_telegram_message_id',p_reply_message_id)::text);
 RETURN invoice;
END; $$;

-- Existing deployed webhooks and unthreaded attachments keep the same API.
CREATE OR REPLACE FUNCTION register_requested_invoice(p_message_id uuid)
RETURNS factures LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.register_requested_invoice(p_message_id,NULL::text);
$$;
REVOKE ALL ON FUNCTION register_requested_invoice(uuid,text),register_requested_invoice(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION register_requested_invoice(uuid,text),register_requested_invoice(uuid) TO service_role;
