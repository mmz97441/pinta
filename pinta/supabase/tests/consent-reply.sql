-- Confirmation after the client's consent (lot 3b, 2026-10-06): a document sent in explicit reply to the stored
-- feu_vert_recu_facture confirmation counts as the requested invoice while the dossier still requests one (the rule of
-- queue_message's invoice_requested), within the existing seven-day rule; otherwise the previous behaviour is kept.
-- The existing cases of telegram-requested-invoice.sql are replayed unchanged by run-consent-reply.sh.
BEGIN;
GRANT USAGE ON SCHEMA public,auth TO service_role,authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE FUNCTION cr_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END; $$;

-- The replaced command keeps its signature, owner, grants and security; the decision rules and templates are untouched.
DO $$
DECLARE fn regprocedure:='register_telegram_document(uuid,text,text)'::regprocedure; definition text:=pg_get_functiondef('register_telegram_document(uuid,text,text)'::regprocedure);
BEGIN
 PERFORM cr_assert(NOT has_function_privilege('anon',fn,'EXECUTE') AND NOT has_function_privilege('authenticated',fn,'EXECUTE')
  AND has_function_privilege('service_role',fn,'EXECUTE'),'register_telegram_document stays a service-only command');
 PERFORM cr_assert((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid=fn),'register_telegram_document keeps definer security and its search path');
 PERFORM cr_assert(position('request.template=''feu_vert_recu_facture'' AND p_reply_message_id IS NOT NULL' IN definition)>0
  AND position('request.template IN (''facture_manquante'',''demande_facture'')' IN definition)>0
  AND position('request.request_snapshot->''invoice_requested''=''true''::jsonb' IN definition)>0,'the filter adds the confirmation case and keeps the previous request templates');
 PERFORM cr_assert(position('departure:=_departure_for_day(c,c.depart_souhaite)' IN pg_get_functiondef('_apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)'::regprocedure))>0
  AND position('feu_vert_recu' IN pg_get_functiondef('_apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)'::regprocedure))=0,'the client decision rules of lot 3a are untouched');
 PERFORM cr_assert(NOT EXISTS(SELECT 1 FROM message_templates WHERE key IN ('feu_vert_recu','feu_vert_recu_facture','choix_attente_recu','refus_recu')),'the migration writes no message template');
END $$;

-- A Telegram dossier with a staff message of the given template, sent request_age ago, and a client document received now.
CREATE FUNCTION cr_fixture(
 template_name text DEFAULT 'feu_vert_recu_facture',
 request_age interval DEFAULT interval '2 hours',
 request_status statut_message DEFAULT 'envoye',
 client_type text DEFAULT 'particulier'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE customer uuid; dossier uuid; document uuid:=gen_random_uuid();
BEGIN
 INSERT INTO clients(nom,prenom,cp,type,telegram_chat_id) VALUES('Confirmation test','Flavie','97400',client_type::type_client,'cr-chat-'||document) RETURNING id INTO customer;
 INSERT INTO colis(client_id,statut,nb_colis,feu_vert,dims_par_colis)
 VALUES(customer,'autorise',1,'autorise','[{"dimL":20,"dimW":20,"dimH":20,"poids":2}]') RETURNING id INTO dossier;
 INSERT INTO messages(colis_id,type,canal,template,statut,texte,auteur_nom,telegram_msg_id,created_at)
 VALUES(dossier,'staff','telegram',template_name,request_status,'Bonjour Flavie, votre accord est bien enregistré.','Expedîle','cr-reply-'||dossier,now()-request_age);
 INSERT INTO messages(id,colis_id,type,canal,texte,attachment_path,attachment_name,attachment_type,telegram_event_key,created_at)
 VALUES(document,dossier,'client','telegram','Document reçu',dossier||'/document.pdf','achat.pdf','application/pdf','cr-fixture:'||document,now());
 RETURN document;
END; $$;
CREATE FUNCTION cr_dossier(document uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT colis_id FROM messages WHERE id=document $$;
CREATE FUNCTION cr_reply(document uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'cr-reply-'||colis_id FROM messages WHERE id=document $$;
CREATE FUNCTION cr_register(document uuid,reply text DEFAULT 'same') RETURNS jsonb LANGUAGE sql AS $$
 SELECT register_telegram_document(document,CASE WHEN reply='same' THEN cr_reply(document) ELSE reply END,NULL) $$;
-- The previous behaviour of a reply, measured on an identical dossier whose staff message is not an invoice request.
CREATE FUNCTION cr_previous(document uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 UPDATE messages SET template='feu_vert_recu' WHERE colis_id=cr_dossier(document) AND type='staff';
 result:=cr_register(document);
 UPDATE messages SET template='feu_vert_recu_facture' WHERE colis_id=cr_dossier(document) AND type='staff';
 RETURN result->>'status';
END; $$;

SELECT set_config('request.jwt.claim.role','service_role',true);

DO $$
DECLARE document uuid; dossier uuid; result jsonb; again jsonb; invoice factures; state statut_message; original uuid; status_before text;
BEGIN
 -- The main case: an explicit reply to the delivered confirmation while no invoice was received.
 document:=cr_fixture(); dossier:=cr_dossier(document);
 result:=cr_register(document);
 PERFORM cr_assert(result->>'status'='registered' AND result->>'ref' IS NOT NULL AND result->>'prenom'='Flavie','a reply to the invoice confirmation registers the document as the requested invoice');
 SELECT * INTO invoice FROM factures WHERE id=(result->>'factureId')::uuid;
 PERFORM cr_assert(NOT invoice.valide AND invoice.montant=0 AND invoice.vendeur='Document à vérifier' AND invoice.fichier_url=dossier||'/document.pdf'
  AND invoice.fichier_nom='achat.pdf' AND invoice.telegram_event_key='cr-fixture:'||document,'the invoice stays to verify, with the stored file and no invented amount');
 PERFORM cr_assert((SELECT count(*)=1 FROM audit_actions WHERE colis_id=dossier AND action='telegram_requested_invoice'
  AND detail::jsonb->>'request_message_id'=(SELECT id::text FROM messages WHERE colis_id=dossier AND type='staff')
  AND detail::jsonb->>'reply_to_telegram_message_id'='cr-reply-'||dossier),'the audit links the invoice to the confirmation it answers');
 again:=cr_register(document);
 PERFORM cr_assert(again->>'status'='registered' AND again->>'factureId'=result->>'factureId' AND (SELECT count(*)=1 FROM factures WHERE colis_id=dossier),'a repeated registration is idempotent');
 document:=cr_fixture();
 PERFORM cr_assert((register_requested_invoice(document,cr_reply(document))).id IS NOT NULL,'the compatibility wrapper registers the same reply');

 -- Delivered statuses only.
 FOREACH state IN ARRAY ARRAY['distribue','lu']::statut_message[] LOOP
  document:=cr_fixture(request_status=>state);
  PERFORM cr_assert(cr_register(document)->>'status'='registered','a confirmation '||state||' counts as delivered');
 END LOOP;
 FOREACH state IN ARRAY ARRAY['envoi','echec']::statut_message[] LOOP
  document:=cr_fixture(request_status=>state);
  PERFORM cr_assert(cr_register(document)->>'status'='not_invoice' AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=cr_dossier(document)),'a confirmation '||state||' was never confirmed by Telegram: no invoice');
 END LOOP;

 -- The seven-day limit, and no retrospective match.
 document:=cr_fixture(request_age=>interval '6 days 23 hours');
 PERFORM cr_assert(cr_register(document)->>'status'='registered','a reply within seven days counts');
 document:=cr_fixture(request_age=>interval '7 days 1 hour');
 PERFORM cr_assert(cr_register(document)->>'status'='not_invoice' AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=cr_dossier(document)),'a reply after seven days keeps the previous behaviour');
 document:=cr_fixture(request_age=>interval '8 days');
 dossier:=cr_dossier(document);
 INSERT INTO notification_outbox(message_id,colis_id,client_id,canal,status,sent_at)
 SELECT m.id,m.colis_id,c.client_id,'telegram','sent',now()-interval '1 day' FROM messages m JOIN colis c ON c.id=m.colis_id WHERE m.colis_id=dossier AND m.type='staff';
 PERFORM cr_assert(cr_register(document)->>'status'='registered','the seven days run from the Telegram delivery, not from the queueing');
 document:=cr_fixture(request_age=>interval '-1 hour');
 PERFORM cr_assert(cr_register(document)->>'status'='not_invoice','a document received before the confirmation cannot answer it');

 -- No invoice requested any more: the previous behaviour.
 document:=cr_fixture(); dossier:=cr_dossier(document);
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,created_at) VALUES(dossier,'Déposée dans l’espace client',0,false,dossier||'/portail.pdf',now()-interval '1 hour');
 status_before:=cr_previous(document);
 result:=cr_register(document);
 PERFORM cr_assert(result->>'status'='not_invoice' AND result->>'status'=status_before AND (SELECT count(*)=1 FROM factures WHERE colis_id=dossier),'an invoice received meanwhile (to verify) ends the request: previous behaviour');
 document:=cr_fixture(); dossier:=cr_dossier(document);
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url) VALUES(dossier,'Facture validée',40,true,dossier||'/valide.pdf');
 UPDATE colis SET statut='en_preparation' WHERE id=dossier;
 UPDATE colis SET devis_total=40,devis_transport=20,devis_snapshot='{"inputs":{"marker":"quote"}}',devis_brouillon=false WHERE id=dossier;
 UPDATE colis SET statut='devis_envoye' WHERE id=dossier;
 status_before:=cr_previous(document);
 result:=cr_register(document);
 PERFORM cr_assert(result->>'status'='ask_client' AND result->>'status'=status_before AND (SELECT count(*)=1 FROM factures WHERE colis_id=dossier),'on a sent quote without a requested invoice the client is asked, as before');
 document:=cr_fixture(); dossier:=cr_dossier(document);
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,rejet_motif) VALUES(dossier,'Illisible',0,false,dossier||'/illisible.pdf','Document illisible') RETURNING id INTO original;
 PERFORM cr_assert(cr_register(document)->>'status'='registered','a rejected invoice keeps the request open');
 document:=cr_fixture(); dossier:=cr_dossier(document);
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url) VALUES(dossier,'Boutique A',40,true,dossier||'/a.pdf');
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,rejet_motif) VALUES(dossier,'Boutique B',0,false,dossier||'/b.pdf','Page manquante');
 PERFORM cr_assert(cr_register(document)->>'status'='registered','a current rejected invoice next to a valid one keeps the request open');
 document:=cr_fixture(); dossier:=cr_dossier(document);
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,rejet_motif) VALUES(dossier,'Illisible',0,false,dossier||'/illisible.pdf','Document illisible') RETURNING id INTO original;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,replaces_facture_id) VALUES(dossier,'Correction',0,false,dossier||'/correction.pdf',original);
 PERFORM cr_assert(cr_register(document)->>'status'='not_invoice','a rejected invoice replaced by its correction no longer requests an invoice');
 document:=cr_fixture(); dossier:=cr_dossier(document);
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url) VALUES(dossier,'Boutique A',40,true,dossier||'/a.pdf') RETURNING id INTO original;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,rejet_motif,duplicate_of_facture_id) VALUES(dossier,'Copie',0,false,dossier||'/copie.pdf','Copie en double',original);
 PERFORM cr_assert(cr_register(document)->>'status'='not_invoice','a retired rejected copy does not reopen the request');

 -- Only an explicit reply to this confirmation, on this dossier.
 document:=cr_fixture();
 PERFORM cr_assert(cr_register(document,NULL)->>'status'='not_invoice' AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=cr_dossier(document)),'a document sent without replying is not taken as the invoice by this case');
 document:=cr_fixture('feu_vert_recu');
 PERFORM cr_assert(cr_register(document)->>'status'='not_invoice','a reply to the confirmation without invoice line stays a conversation document');
 document:=cr_fixture();
 PERFORM cr_assert(cr_register(document,'cr-unknown-message')->>'status'='not_invoice','a reply to another message never falls back to the confirmation');
 PERFORM cr_assert(cr_register(document,cr_reply(cr_fixture()))->>'status'='not_invoice','a confirmation of another dossier never registers this document');

 -- A frozen dossier keeps its answer.
 document:=cr_fixture(); dossier:=cr_dossier(document);
 UPDATE colis SET paiement_date=now() WHERE id=dossier;
 PERFORM cr_assert(cr_register(document)->>'status'='frozen' AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=dossier),'a paid dossier receives no invoice');
END $$;

-- The real path: queue_message stores the confirmation (author « Expedîle », no consent snapshot); once Telegram confirmed
-- it, a reply resolves to its dossier and the document registers as the invoice.
DO $$
DECLARE customer uuid; dossier uuid; other uuid; queued jsonb; again jsonb; document uuid:=gen_random_uuid(); message messages;
BEGIN
 INSERT INTO clients(nom,prenom,cp,type,telegram_chat_id) VALUES('Confirmation réelle','Flavie','97400','particulier','cr-real-chat') RETURNING id INTO customer;
 INSERT INTO colis(client_id,statut,nb_colis,feu_vert) VALUES(customer,'autorise',1,'autorise') RETURNING id INTO dossier;
 INSERT INTO colis(client_id,statut,nb_colis,feu_vert) VALUES(customer,'en_preparation',1,'autorise') RETURNING id INTO other;
 queued:=queue_message(dossier,'Bonjour Flavie 👋 Merci, votre accord est bien enregistré.','feu_vert_recu_facture','consent-reply:'||dossier||':0:approve',NULL,'telegram');
 SELECT * INTO message FROM messages WHERE id=(queued->'message'->>'id')::uuid;
 PERFORM cr_assert(message.type='staff' AND message.canal='telegram' AND message.auteur_nom='Expedîle' AND message.statut='envoi' AND message.request_snapshot IS NULL
  AND message.template='feu_vert_recu_facture','the confirmation is a stored staff message from Expedîle, without consent snapshot');
 PERFORM cr_assert(queued->'outbox'->>'status'='pending' AND queued->'outbox'->>'idempotency_key'='consent-reply:'||dossier||':0:approve','the confirmation waits in the outbox under its deterministic key');
 again:=queue_message(dossier,'Autre texte','feu_vert_recu_facture','consent-reply:'||dossier||':0:approve',NULL,'telegram');
 PERFORM cr_assert(again->'message'->>'id'=queued->'message'->>'id' AND (SELECT count(*)=1 FROM messages WHERE colis_id=dossier AND type='staff'),'a repeated confirmation returns the stored message');
 UPDATE messages SET statut='envoye',telegram_msg_id='cr-real-confirmation' WHERE id=message.id;
 UPDATE notification_outbox SET status='sent',sent_at=now() WHERE id=(queued->'outbox'->>'id')::uuid;
 PERFORM cr_assert(resolve_telegram_message_colis(customer,'cr-real-confirmation',NULL)->>'id'=dossier::text,'a reply to the confirmation resolves to its dossier although the client has two');
 INSERT INTO messages(id,colis_id,type,canal,texte,attachment_path,attachment_name,attachment_type,telegram_event_key)
 VALUES(document,dossier,'client','telegram','Document reçu',dossier||'/telegram_1.pdf','facture.pdf','application/pdf','cr-real:'||document);
 PERFORM cr_assert(register_telegram_document(document,'cr-real-confirmation',repeat('c',64))->>'status'='registered','the document replying to the delivered confirmation is the requested invoice');
END $$;
ROLLBACK;
