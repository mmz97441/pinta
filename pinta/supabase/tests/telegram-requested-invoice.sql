BEGIN;
GRANT USAGE ON SCHEMA public,auth TO service_role,authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE FUNCTION invoice_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END; $$;
CREATE FUNCTION invoice_fixture(
 template_name text DEFAULT 'facture_manquante',
 dossier_status statut_colis DEFAULT 'autorise',
 media_type text DEFAULT 'application/pdf',
 request_age interval DEFAULT interval '3 hours',
 request_status statut_message DEFAULT 'envoye'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE customer_id uuid;dossier_id uuid;message_id uuid;
BEGIN
 INSERT INTO clients(nom,prenom,cp,type) VALUES('Facture test','Camille','97400','particulier') RETURNING id INTO customer_id;
 INSERT INTO colis(client_id,statut,nb_colis,feu_vert)
 VALUES(customer_id,dossier_status,1,'autorise') RETURNING id INTO dossier_id;
 IF template_name IS NOT NULL THEN
  INSERT INTO messages(colis_id,type,canal,template,statut,texte,created_at)
  VALUES(dossier_id,'staff','telegram',template_name,request_status,'Merci de transmettre la facture',now()-request_age);
 END IF;
 message_id:=gen_random_uuid();
 INSERT INTO messages(id,colis_id,type,canal,texte,attachment_path,attachment_name,attachment_type,telegram_event_key,created_at)
 VALUES(message_id,dossier_id,'client','telegram','Document reçu',dossier_id||'/document.pdf','achat.pdf',media_type,'fixture:'||message_id,now());
 RETURN message_id;
END; $$;

SELECT invoice_assert(NOT has_function_privilege('anon','register_requested_invoice(uuid)','EXECUTE'),'anonymous cannot register requested invoices');
SELECT invoice_assert(NOT has_function_privilege('authenticated','register_requested_invoice(uuid)','EXECUTE'),'staff and clients cannot invoke the service registration RPC');
SELECT invoice_assert(has_function_privilege('service_role','register_requested_invoice(uuid)','EXECUTE'),'Telegram service can register requested invoices');
DO $$ BEGIN
 BEGIN
  PERFORM register_requested_invoice(gen_random_uuid());
  RAISE EXCEPTION 'FAIL: missing service claim accepted';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: actual service role claim is required even for the function owner';
 END;
END; $$;
SELECT set_config('request.jwt.claim.role','service_role',true);

DO $$
DECLARE message_id uuid;dossier_id uuid;invoice factures;second_id uuid;state statut_colis;media text;before_dossier jsonb;
BEGIN
 message_id:=invoice_fixture();
 SELECT colis_id INTO dossier_id FROM messages WHERE id=message_id;
 invoice:=register_requested_invoice(message_id);
 PERFORM invoice_assert(invoice.id IS NOT NULL AND NOT invoice.valide AND invoice.montant=0,'requested PDF appears as an unvalidated invoice with no invented amount');
 PERFORM invoice_assert(invoice.fichier_url=dossier_id||'/document.pdf' AND invoice.fichier_nom='achat.pdf','invoice preserves the exact conversation storage path and original filename');
 PERFORM invoice_assert((SELECT attachment_path=invoice.fichier_url FROM messages WHERE id=message_id),'invoice import keeps the conversation attachment readable');
 PERFORM invoice_assert((SELECT status='pending' FROM ocr_jobs WHERE facture_id=invoice.id),'existing OCR trigger queues extraction');
 PERFORM invoice_assert((SELECT ocr_status='pending' AND NOT valide FROM factures WHERE id=invoice.id),'OCR remains pending staff review');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id=invoice.id,'same message is idempotent');
 PERFORM invoice_assert((SELECT count(*)=1 FROM audit_actions WHERE colis_id=dossier_id AND action='telegram_requested_invoice'),'one traceable audit is recorded despite retry');

 second_id:=gen_random_uuid();
 INSERT INTO messages(id,colis_id,type,canal,texte,attachment_path,attachment_type)
 VALUES(second_id,dossier_id,'client','telegram','Photo complémentaire',dossier_id||'/photo.jpg','image/jpeg');
 PERFORM invoice_assert((register_requested_invoice(second_id)).id IS NULL,'once a document is received, subsequent photos are not classified as invoices automatically');
 PERFORM invoice_assert((SELECT count(*)=1 FROM factures WHERE colis_id=dossier_id),'one missing-invoice request does not create extra invoices');

 FOREACH media IN ARRAY ARRAY['image/jpeg','image/png','image/webp'] LOOP
  message_id:=invoice_fixture(media_type=>media);
  PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NOT NULL,'requested invoice photo accepted: '||media);
 END LOOP;
 message_id:=invoice_fixture('demande_facture');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NOT NULL,'historical invoice-request template alias is supported');
 message_id:=invoice_fixture(request_status=>'lu');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NOT NULL,'read delivery status remains a delivered request');

 message_id:=invoice_fixture(NULL);
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'generic PDF without an invoice request remains conversation only');
 message_id:=invoice_fixture('demande_feu_vert');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'preparation request cannot be mistaken for invoice intent');
 message_id:=invoice_fixture(request_status=>'echec');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'failed invoice request does not classify a later document');
 message_id:=invoice_fixture(request_status=>'envoi');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'queued invoice request does not classify a document');
 message_id:=invoice_fixture(request_age=>interval '8 days');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'invoice intent expires after seven days');
 message_id:=invoice_fixture(request_age=>interval '-1 hour');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'a document received before the request cannot fulfil it retrospectively');
 message_id:=invoice_fixture();
 SELECT colis_id INTO dossier_id FROM messages WHERE id=message_id;
 INSERT INTO notification_outbox(message_id,colis_id,client_id,canal,status,sent_at)
 SELECT m.id,m.colis_id,c.client_id,'telegram','sent',now()+interval '1 hour'
 FROM messages m JOIN colis c ON c.id=m.colis_id WHERE m.colis_id=dossier_id AND m.type='staff';
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'actual provider delivery time takes precedence over the earlier queued request timestamp');
 message_id:=invoice_fixture(media_type=>'application/zip');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'unsupported file type is never registered as invoice');
 message_id:=invoice_fixture(media_type=>NULL);
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'unknown media type requires explicit staff review');
 message_id:=invoice_fixture();
 UPDATE messages SET canal='email' WHERE id=message_id;
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'non Telegram message cannot use Telegram invoice intent');
 message_id:=invoice_fixture();
 UPDATE messages SET type='staff' WHERE id=message_id;
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'staff attachments are not customer invoices');

 FOREACH state IN ARRAY ARRAY['paye','expedie','transit','dedouanement','arrive','livraison','livre','annule']::statut_colis[] LOOP
  message_id:=invoice_fixture(dossier_status=>state);
  SELECT colis_id INTO dossier_id FROM messages WHERE id=message_id;
  SELECT to_jsonb(c) INTO before_dossier FROM colis c WHERE id=dossier_id;
  PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'immutable dossier rejects invoice import: '||state);
  PERFORM invoice_assert((SELECT to_jsonb(c)=before_dossier FROM colis c WHERE id=dossier_id),'dossier and paid quote remain unchanged: '||state);
 END LOOP;
 message_id:=invoice_fixture();
 SELECT colis_id INTO dossier_id FROM messages WHERE id=message_id;
 UPDATE colis SET paiement_date=now() WHERE id=dossier_id;
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'payment timestamp blocks import even when status is inconsistent');
 message_id:=invoice_fixture();
 SELECT colis_id INTO dossier_id FROM messages WHERE id=message_id;
 UPDATE colis SET conversation_statut='termine',archive=true WHERE id=dossier_id;
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NULL,'archived dossier cannot receive an automatic invoice');

 -- Reconciliation of a manually imported attachment must reuse its invoice.
 message_id:=invoice_fixture();
 SELECT colis_id INTO dossier_id FROM messages WHERE id=message_id;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom)
 VALUES(dossier_id,'Facture déjà importée',12,false,dossier_id||'/document.pdf','achat.pdf') RETURNING * INTO invoice;
 PERFORM invoice_assert((register_requested_invoice(message_id)).id=invoice.id,'an existing manual invoice for the same attachment is reused');
 PERFORM invoice_assert((SELECT count(*)=1 FROM factures WHERE colis_id=dossier_id),'manual import and automatic retry do not duplicate the document');

 message_id:=invoice_fixture();
 SELECT colis_id INTO dossier_id FROM messages WHERE id=message_id;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,created_at)
 VALUES(dossier_id,'Facture du premier carton',12,false,dossier_id||'/premier.pdf',now()-interval '4 hours');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NOT NULL,'a new explicit request after an earlier invoice accepts the invoice missing for another carton');
 PERFORM invoice_assert((SELECT count(*)=2 FROM factures WHERE colis_id=dossier_id),'both invoices remain visible for the shared dossier');

 message_id:=invoice_fixture();
 SELECT colis_id INTO dossier_id FROM messages WHERE id=message_id;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,rejet_motif,created_at)
 VALUES(dossier_id,'Ancienne facture illisible',0,false,dossier_id||'/illisible.pdf','Document illisible',now()-interval '1 hour');
 PERFORM invoice_assert((register_requested_invoice(message_id)).id IS NOT NULL,'a rejected invoice does not falsely satisfy the missing-invoice request');
END; $$;
ROLLBACK;
