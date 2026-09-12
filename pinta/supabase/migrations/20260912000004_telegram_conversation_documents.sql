-- A conversation attachment remains readable without mutating a paid quote.
ALTER TABLE messages ADD COLUMN attachment_path text,ADD COLUMN attachment_name text,ADD COLUMN attachment_type text;
ALTER TABLE messages ADD CONSTRAINT message_attachment_path CHECK(attachment_path IS NULL OR (attachment_path LIKE colis_id::text||'/%' AND position('..' in attachment_path)=0));
CREATE FUNCTION resolve_telegram_message_colis(p_client_id uuid,p_reply_message_id text DEFAULT NULL,p_ref text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reply_target colis;explicit_target colis;result colis;matches integer;
BEGIN
 IF p_reply_message_id IS NOT NULL THEN
  SELECT count(DISTINCT c.id) INTO matches FROM colis c JOIN messages m ON m.colis_id=c.id WHERE c.client_id=p_client_id AND m.telegram_msg_id=p_reply_message_id;
  IF matches<>1 THEN RETURN NULL; END IF;
  SELECT c.* INTO reply_target FROM colis c JOIN messages m ON m.colis_id=c.id WHERE c.client_id=p_client_id AND m.telegram_msg_id=p_reply_message_id LIMIT 1;
 END IF;
 IF p_ref IS NOT NULL THEN
  SELECT * INTO explicit_target FROM colis WHERE client_id=p_client_id AND upper(ref)=upper(p_ref);
  IF NOT FOUND THEN RETURN NULL; END IF;
 END IF;
 IF reply_target.id IS NOT NULL AND explicit_target.id IS NOT NULL AND reply_target.id<>explicit_target.id THEN RETURN NULL; END IF;
 IF reply_target.id IS NOT NULL THEN result:=reply_target;
 ELSIF explicit_target.id IS NOT NULL THEN result:=explicit_target;
 ELSE
  SELECT count(*) INTO matches FROM colis WHERE client_id=p_client_id AND statut NOT IN ('livre','annule') AND NOT archive;
  IF matches<>1 THEN RETURN NULL; END IF;
  SELECT * INTO result FROM colis WHERE client_id=p_client_id AND statut NOT IN ('livre','annule') AND NOT archive;
 END IF;
 RETURN jsonb_build_object('id',result.id,'ref',result.ref,'statut',result.statut,'paiement_date',result.paiement_date);
END; $$;
REVOKE ALL ON FUNCTION resolve_telegram_message_colis(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION resolve_telegram_message_colis(uuid,text,text) TO service_role;
CREATE FUNCTION import_conversation_invoice(p_message_id uuid) RETURNS factures LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m messages;c colis;f factures;
BEGIN
 IF NOT has_permission('perm_factures_ajouter') THEN RAISE EXCEPTION 'Permission d’ajout de facture requise' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM messages WHERE id=p_message_id;
 IF NOT FOUND OR m.attachment_path IS NULL THEN RAISE EXCEPTION 'Ce message ne contient pas de document importable' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM colis WHERE id=m.colis_id FOR UPDATE;
 IF c.paiement_date IS NOT NULL OR c.statut IN ('paye','expedie','transit','dedouanement','arrive','livraison','livre','annule') THEN RAISE EXCEPTION 'Ce document reste disponible dans la conversation ; le devis payé ne peut plus recevoir de facture' USING ERRCODE='22023'; END IF;
 SELECT * INTO f FROM factures WHERE colis_id=c.id AND fichier_url=m.attachment_path LIMIT 1;
 IF FOUND THEN RETURN f; END IF;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom) VALUES(c.id,'Document à vérifier',0,false,m.attachment_path,m.attachment_name) RETURNING * INTO f;
 INSERT INTO audit_actions(colis_id,user_id,action,detail) VALUES(c.id,auth.uid(),'conversation_invoice_import',jsonb_build_object('message_id',m.id,'facture_id',f.id)::text);
 RETURN f;
END; $$;
REVOKE ALL ON FUNCTION import_conversation_invoice(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION import_conversation_invoice(uuid) TO authenticated;

-- A portal write is not a delivery without an accessible customer account.
CREATE OR REPLACE FUNCTION queue_message(p_colis_id uuid,p_text text,p_template text DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_reply_markup jsonb DEFAULT NULL,p_canal text DEFAULT 'telegram') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; cl clients; m messages; ob notification_outbox;
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
 INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,statut,canal,template,request_snapshot)
 VALUES(c.id,'staff',auth.uid(),coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),'Expedîle'),p_text,
 CASE WHEN p_canal='portal' THEN 'envoye'::statut_message ELSE 'envoi'::statut_message END,p_canal,p_template,
 CASE WHEN p_template IN ('demande_feu_vert','relance_feu_vert') THEN jsonb_build_object('trackings',c.trackings,'trackings_detail',c.trackings_detail,'nb_colis',c.nb_colis) ELSE NULL END) RETURNING * INTO m;
 INSERT INTO notification_outbox(message_id,client_id,colis_id,quote_version,canal,reply_markup,idempotency_key,status)
 VALUES(m.id,cl.id,c.id,c.quote_version,p_canal,p_reply_markup,p_idempotency_key,CASE p_canal WHEN 'email' THEN 'manual' WHEN 'portal' THEN 'sent' ELSE 'pending' END) RETURNING * INTO ob;
 IF cl.user_id IS NOT NULL THEN INSERT INTO notifications(user_id,titre,msg,colis_id,type) VALUES(cl.user_id,'Un message pour '||c.ref,p_text,c.id,'message'); END IF;
 RETURN jsonb_build_object('message',to_jsonb(m),'outbox',to_jsonb(ob));
END; $$;
