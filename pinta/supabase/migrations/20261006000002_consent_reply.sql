-- Confirmation after the client's consent (lot 3b, 2026-10-06).
-- The Telegram confirmation of a choice is now a stored staff message sent through the outbox (Edge, telegram-webhook);
-- after an approval it also asks for the purchase invoice while the dossier still requests one (template
-- feu_vert_recu_facture). A document sent in explicit reply to that confirmation counts as the requested invoice, with
-- the existing seven-day rule, while the dossier still requests an invoice (the rule of queue_message's invoice_requested).
-- register_telegram_document (copy of 2026-10-04) plus that case in its request filter; same signature, owner and grants.
-- The decision rules (_apply_client_decision), message_templates and business rows are untouched.

CREATE OR REPLACE FUNCTION register_telegram_document(p_message_id uuid,p_reply_message_id text,p_document_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE incoming messages; dossier colis; invoice factures; w quote_withdrawals; request_id uuid; request_sent_at timestamptz; reason text; original uuid; base jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Service Telegram requis' USING ERRCODE='42501';
 END IF;
 SELECT * INTO incoming FROM messages WHERE id=p_message_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Message introuvable' USING ERRCODE='22023'; END IF;
 IF p_document_sha256 IS NOT NULL AND p_document_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Empreinte du document invalide.' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('colisId',x.id,'ref',x.ref,'prenom',cl.prenom) INTO base FROM colis x LEFT JOIN clients cl ON cl.id=x.client_id WHERE x.id=incoming.colis_id;
 IF incoming.type<>'client' OR incoming.canal<>'telegram' OR incoming.attachment_path IS NULL
    OR incoming.attachment_type IS NULL OR incoming.attachment_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp') THEN
  RETURN base||jsonb_build_object('status','not_invoice');
 END IF;
 SELECT * INTO dossier FROM colis WHERE id=incoming.colis_id FOR UPDATE;
 SELECT * INTO invoice FROM factures WHERE colis_id=dossier.id AND fichier_url=incoming.attachment_path LIMIT 1;
 IF FOUND THEN
  w:=_late_invoice_withdrawal(invoice);
  RETURN base||jsonb_build_object('status','registered','factureId',invoice.id,'withdrawalId',w.id,'withdrawalStatus',w.status);
 END IF;
 reason:=_dossier_frozen_reason(dossier);
 IF reason IS NOT NULL THEN RETURN base||jsonb_build_object('status','frozen','reason',reason); END IF;
 IF p_document_sha256 IS NOT NULL THEN
  original:=_identical_validated_invoice(dossier.id,p_document_sha256);
  IF original IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM audit_actions WHERE colis_id=dossier.id AND action='client_invoice_identical_ignored' AND after_data->>'path'=incoming.attachment_path) THEN
    INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,after_data)
    VALUES(dossier.id,NULL,'Client (Telegram)','client_invoice_identical_ignored','Document identique à une facture validée : rien ne change pour le devis',
     jsonb_build_object('path',incoming.attachment_path,'originalId',original,'sha256',p_document_sha256,'source','telegram','messageId',incoming.id));
   END IF;
   RETURN base||jsonb_build_object('status','identical','originalId',original,'quoteSent',dossier.statut IN ('devis_envoye','attente_paiement'));
  END IF;
 END IF;
 -- Existing seven-day request rule and one-document rule (2026-09-16), unchanged.
 p_reply_message_id:=nullif(trim(p_reply_message_id),'');
 SELECT request.id,coalesce(delivery.sent_at,request.created_at) INTO request_id,request_sent_at
 FROM messages request LEFT JOIN notification_outbox delivery ON delivery.message_id=request.id
 WHERE request.colis_id=dossier.id AND request.type='staff' AND request.canal='telegram'
  AND (request.template IN ('facture_manquante','demande_facture')
    OR (request.template='demande_feu_vert' AND request.request_snapshot->'invoice_requested'='true'::jsonb)
    -- 2026-10-06: an explicit reply to the consent confirmation that asked for the invoice, while the dossier still
    -- requests one (queue_message's invoice_requested: no current invoice free of a rejection, or a current one rejected).
    OR (request.template='feu_vert_recu_facture' AND p_reply_message_id IS NOT NULL AND (
     WITH current_invoices AS (
      SELECT f.* FROM factures f WHERE f.colis_id=dossier.id AND f.duplicate_of_facture_id IS NULL
       AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)
     )
     SELECT NOT EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NULL)
       OR EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NOT NULL))))
  AND request.statut IN ('envoye','distribue','lu')
  AND (p_reply_message_id IS NULL OR request.telegram_msg_id=p_reply_message_id)
  AND coalesce(delivery.sent_at,request.created_at)<=incoming.created_at
  AND coalesce(delivery.sent_at,request.created_at)>=incoming.created_at-interval '7 days'
 ORDER BY coalesce(delivery.sent_at,request.created_at) DESC LIMIT 1;
 IF request_id IS NOT NULL AND NOT (p_reply_message_id IS NULL AND EXISTS(
  SELECT 1 FROM factures f WHERE f.colis_id=dossier.id AND f.rejet_motif IS NULL
   AND f.duplicate_of_facture_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)
   AND f.created_at>=request_sent_at
 )) THEN
  INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom,telegram_event_key)
  VALUES(dossier.id,'Document à vérifier',0,false,incoming.attachment_path,incoming.attachment_name,incoming.telegram_event_key)
  RETURNING * INTO invoice;
  INSERT INTO audit_actions(colis_id,user_id,action,detail)
  VALUES(dossier.id,NULL,'telegram_requested_invoice',jsonb_build_object('message_id',incoming.id,
   'request_message_id',request_id,'facture_id',invoice.id,'reply_to_telegram_message_id',p_reply_message_id)::text);
  w:=_late_invoice_withdrawal(invoice);
  RETURN base||jsonb_build_object('status','registered','factureId',invoice.id,'withdrawalId',w.id,'withdrawalStatus',w.status);
 END IF;
 RETURN base||jsonb_build_object('status',CASE WHEN _quote_locked(dossier) OR _late_invoice_open(dossier.id) THEN 'ask_client' ELSE 'not_invoice' END);
END; $$;
