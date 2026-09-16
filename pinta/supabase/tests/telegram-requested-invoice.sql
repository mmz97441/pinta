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

SELECT invoice_assert(NOT has_function_privilege('anon','register_requested_invoice(uuid,text)','EXECUTE'),'anonymous cannot invoke explicit invoice reply registration');
SELECT invoice_assert(NOT has_function_privilege('authenticated','register_requested_invoice(uuid,text)','EXECUTE'),'staff and clients cannot invent Telegram reply context');
SELECT invoice_assert(has_function_privilege('service_role','register_requested_invoice(uuid,text)','EXECUTE'),'Telegram service can transmit the authenticated reply context');

DO $$
DECLARE message_id uuid; dossier_id uuid; request_id uuid; second_id uuid; third_id uuid; other_message_id uuid; result jsonb; invoice factures; original_id uuid; replacement_id uuid;
BEGIN
 message_id:=invoice_fixture(NULL);
 SELECT colis_id INTO dossier_id FROM messages WHERE id=message_id;
 UPDATE clients SET telegram_chat_id='fictitious-chat' WHERE id=(SELECT client_id FROM colis WHERE id=dossier_id);
 result:=queue_message(dossier_id,'Réception et accord, merci de joindre vos factures.','demande_feu_vert','combined-missing');
 request_id:=(result->'message'->>'id')::uuid;
 PERFORM invoice_assert(result->'message'->'request_snapshot'->'invoice_requested'='true'::jsonb,'combined request snapshots the missing invoice intent on the server');
 PERFORM invoice_assert(result->'message'->'request_snapshot'->>'nb_colis'='1','combined invoice intent preserves the carton approval snapshot');
 PERFORM invoice_assert((register_requested_invoice(message_id,'combined-request')).id IS NULL,'combined request queued but not delivered cannot classify documents');
 UPDATE messages SET statut='envoye',telegram_msg_id='combined-request' WHERE id=request_id;
 UPDATE notification_outbox delivery SET status='sent',sent_at=now() WHERE delivery.message_id=request_id;
 invoice:=register_requested_invoice(message_id,'combined-request');
 PERFORM invoice_assert(invoice.id IS NOT NULL AND NOT invoice.valide,'an explicit reply to the combined delivered request appears for staff verification');
 second_id:=gen_random_uuid();
 INSERT INTO messages(id,colis_id,type,canal,texte,attachment_path,attachment_type)
 VALUES(second_id,dossier_id,'client','telegram','Deuxième facture',dossier_id||'/second.pdf','application/pdf');
 PERFORM invoice_assert((register_requested_invoice(second_id,'combined-request')).id IS NOT NULL,'second invoice explicitly replying to the same request is not lost');
 PERFORM invoice_assert((SELECT count(*)=2 FROM factures WHERE colis_id=dossier_id),'explicit multiple invoices remain separate and unvalidated');
 PERFORM invoice_assert((SELECT count(*)=2 FROM audit_actions WHERE colis_id=dossier_id AND action='telegram_requested_invoice'),'each explicit attachment records its request relationship');
 PERFORM register_requested_invoice(second_id,'combined-request');
 PERFORM invoice_assert((SELECT count(*)=2 FROM factures WHERE colis_id=dossier_id),'retrying the second invoice does not duplicate it');
 third_id:=gen_random_uuid();
 INSERT INTO messages(id,colis_id,type,canal,texte,attachment_path,attachment_type)
 VALUES(third_id,dossier_id,'client','telegram','Photo sans intention précise',dossier_id||'/third.jpg','image/jpeg');
 PERFORM invoice_assert((register_requested_invoice(third_id)).id IS NULL,'later unrelated photos keep the conservative conversation-only rule');
 PERFORM invoice_assert((register_requested_invoice(third_id,'unknown-message')).id IS NULL,'an unknown explicit reply never falls back to another invoice request');
 result:=queue_message(dossier_id,'Réception et accord, factures déjà reçues.','demande_feu_vert','combined-present');
 PERFORM invoice_assert(result->'message'->'request_snapshot'->'invoice_requested'='false'::jsonb,'received unvalidated invoices prevent a repeated missing-invoice request');
 UPDATE messages SET statut='envoye',telegram_msg_id='combined-present' WHERE id=(result->'message'->>'id')::uuid;
 PERFORM invoice_assert((register_requested_invoice(third_id,'combined-present')).id IS NULL,'reply to a combined message without invoice request remains conversation only');
 result:=queue_message(dossier_id,'Idempotent retry text','demande_feu_vert','combined-missing');
 PERFORM invoice_assert((result->'message'->>'id')::uuid=request_id AND result->'message'->'request_snapshot'->'invoice_requested'='true'::jsonb,'idempotent send preserves the original request snapshot after invoices arrive');

 message_id:=invoice_fixture(NULL);
 SELECT colis_id INTO dossier_id FROM messages WHERE id=message_id;
 UPDATE clients SET telegram_chat_id='fictitious-chat' WHERE id=(SELECT client_id FROM colis WHERE id=dossier_id);
 INSERT INTO factures(colis_id,vendeur,montant,valide) VALUES(dossier_id,'Facture enregistrée historique',0,false) RETURNING id INTO original_id;
 result:=queue_message(dossier_id,'Réception confirmée','demande_feu_vert','combined-legacy');
 PERFORM invoice_assert(result->'message'->'request_snapshot'->'invoice_requested'='false'::jsonb,'a legacy recorded invoice is not automatically requested again');
 UPDATE factures SET rejet_motif='Page manquante' WHERE id=original_id;
 result:=queue_message(dossier_id,'Merci de corriger la facture','demande_feu_vert','combined-rejected');
 PERFORM invoice_assert(result->'message'->'request_snapshot'->'invoice_requested'='true'::jsonb,'an active correction request retains invoice intent');
 INSERT INTO factures(colis_id,vendeur,montant,valide,replaces_facture_id)
 VALUES(dossier_id,'Correction reçue',0,false,original_id) RETURNING id INTO replacement_id;
 INSERT INTO factures(colis_id,vendeur,montant,valide,rejet_motif,duplicate_of_facture_id)
 VALUES(dossier_id,'Copie retirée',0,false,'Ancien problème',replacement_id);
 result:=queue_message(dossier_id,'Facture corrigée reçue','demande_feu_vert','combined-replaced');
 PERFORM invoice_assert(result->'message'->'request_snapshot'->'invoice_requested'='false'::jsonb,'replaced rejection and retired duplicate do not trigger another invoice request');

 other_message_id:=invoice_fixture();
 UPDATE messages SET telegram_msg_id='other-dossier-request' WHERE colis_id=(SELECT colis_id FROM messages WHERE id=other_message_id) AND type='staff';
 PERFORM invoice_assert((register_requested_invoice(message_id,'other-dossier-request')).id IS NULL,'a reply cannot import an invoice under a request from another dossier');
 message_id:=invoice_fixture('demande_feu_vert');
 UPDATE messages SET telegram_msg_id='legacy-preparation' WHERE colis_id=(SELECT colis_id FROM messages WHERE id=message_id) AND type='staff';
 PERFORM invoice_assert((register_requested_invoice(message_id,'legacy-preparation')).id IS NULL,'old approval requests without a server invoice flag remain ineligible even for explicit replies');
 message_id:=invoice_fixture(request_age=>interval '8 days');
 UPDATE messages SET telegram_msg_id='expired-request' WHERE colis_id=(SELECT colis_id FROM messages WHERE id=message_id) AND type='staff';
 PERFORM invoice_assert((register_requested_invoice(message_id,'expired-request')).id IS NULL,'explicit invoice intent also expires after seven days');
END; $$;
ROLLBACK;
