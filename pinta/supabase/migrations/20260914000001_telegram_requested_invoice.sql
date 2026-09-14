-- A reply to a recently delivered invoice request belongs in both the
-- conversation and the invoice review queue. Other attachments remain messages.
CREATE OR REPLACE FUNCTION register_requested_invoice(p_message_id uuid)
RETURNS factures
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 incoming messages;
 dossier colis;
 invoice factures;
 request_id uuid;
 request_sent_at timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Service Telegram requis' USING ERRCODE='42501';
 END IF;

 SELECT * INTO incoming FROM messages WHERE id=p_message_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Message introuvable' USING ERRCODE='22023';
 END IF;
 IF incoming.type<>'client' OR incoming.canal<>'telegram'
    OR incoming.attachment_path IS NULL
    OR incoming.attachment_type IS NULL
    OR incoming.attachment_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp') THEN
  RETURN NULL;
 END IF;

 -- Serialize concurrent documents, manual imports and payment against this
 -- dossier. A retry returns the same invoice without invalidating its review.
 SELECT * INTO dossier FROM colis WHERE id=incoming.colis_id FOR UPDATE;
 SELECT * INTO invoice FROM factures
  WHERE colis_id=dossier.id AND fichier_url=incoming.attachment_path LIMIT 1;
 IF FOUND THEN RETURN invoice; END IF;

 IF dossier.archive OR dossier.paiement_date IS NOT NULL
    OR dossier.statut IN ('paye','expedie','transit','dedouanement','arrive','livraison','livre','annule') THEN
  RETURN NULL;
 END IF;

 SELECT request.id,coalesce(delivery.sent_at,request.created_at) INTO request_id,request_sent_at FROM messages request
  LEFT JOIN notification_outbox delivery ON delivery.message_id=request.id
  WHERE request.colis_id=dossier.id AND request.type='staff'
   AND request.canal='telegram' AND request.template IN ('facture_manquante','demande_facture')
   AND request.statut IN ('envoye','distribue','lu')
   AND coalesce(delivery.sent_at,request.created_at)<=incoming.created_at
   AND coalesce(delivery.sent_at,request.created_at)>=incoming.created_at-interval '7 days'
 ORDER BY coalesce(delivery.sent_at,request.created_at) DESC LIMIT 1;
 IF request_id IS NULL THEN RETURN NULL; END IF;

 -- The first document fulfils this request, including an unreviewed invoice.
 -- Existing invoices from before a new explicit request do not prevent the
 -- customer from supplying a missing invoice for another carton.
 IF EXISTS(SELECT 1 FROM factures WHERE colis_id=dossier.id
           AND rejet_motif IS NULL AND created_at>=request_sent_at) THEN
  RETURN NULL;
 END IF;

 -- Existing document triggers queue OCR and invalidate any unpaid quote. OCR
 -- proposes fields only: the invoice remains unvalidated until staff review.
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom,telegram_event_key)
 VALUES(dossier.id,'Document à vérifier',0,false,incoming.attachment_path,
        incoming.attachment_name,incoming.telegram_event_key)
 RETURNING * INTO invoice;
 INSERT INTO audit_actions(colis_id,user_id,action,detail)
 VALUES(dossier.id,NULL,'telegram_requested_invoice',jsonb_build_object(
  'message_id',incoming.id,'request_message_id',request_id,'facture_id',invoice.id)::text);
 RETURN invoice;
END;
$$;
REVOKE ALL ON FUNCTION register_requested_invoice(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION register_requested_invoice(uuid) TO service_role;
