BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;
CREATE FUNCTION public.test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label;END IF;RAISE NOTICE 'PASS: %',label;END; $$;
CREATE FUNCTION public.test_reject(command text,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS rejected: % [%]',label,SQLERRM;RETURN;END;RAISE EXCEPTION 'FAIL accepted: %',label;END; $$;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('10000000-0000-4000-8000-000000000001','director@example.test','{"role":"directeur","nom":"Direction"}'),
 ('10000000-0000-4000-8000-000000000002','client@example.test','{"role":"directeur","nom":"Client"}'),
 ('10000000-0000-4000-8000-000000000003','other@example.test','{"nom":"Autre"}'),
 ('10000000-0000-4000-8000-000000000004','staff@example.test','{"nom":"Préparation"}');
SELECT test_assert((SELECT role='client' FROM profiles WHERE id='10000000-0000-4000-8000-000000000002'),'Signup ignores mutable role metadata');
INSERT INTO staff_users(auth_id,nom,email,role,must_change_password) VALUES
 ('10000000-0000-4000-8000-000000000001','Direction','director@example.test','directeur',false),
 ('10000000-0000-4000-8000-000000000004','Préparation','staff@example.test','preparateur',false);
INSERT INTO staff_permissions SELECT (jsonb_populate_record(NULL::staff_permissions,fn_default_permissions(s.role::text)||jsonb_build_object('id',gen_random_uuid(),'staff_id',s.id))).* FROM staff_users s ON CONFLICT(staff_id) DO NOTHING;
INSERT INTO clients(id,user_id,nom,cp,email,type,telegram_chat_id) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Client','97400','client@example.test','pro','123'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','Autre','97600','other@example.test','particulier','456');
INSERT INTO colis(id,client_id,statut,trackings,nb_colis,fin_l,fin_w,fin_h,fin_p) VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','attente_feu_vert',ARRAY['BOX-1'],1,10,10,10,2),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','attente_feu_vert',ARRAY['OTHER-1'],1,10,10,10,2),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','en_preparation',ARRAY['QUOTE'],1,10,10,10,2),
 ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','en_preparation',ARRAY['OCR'],1,10,10,10,2);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT test_reject($q$UPDATE profiles SET role='directeur' WHERE id=auth.uid()$q$,'Client cannot self-promote');
SELECT test_assert((SELECT count(*)=2 FROM client_colis),'Client only sees own dossiers');
SELECT test_reject($q$SELECT update_client_profile('{"points":999}')$q$,'Client cannot change loyalty balance');
SELECT test_assert((SELECT count(*)=0 FROM colis),'Client raw parcel table is inaccessible');
SELECT test_assert((SELECT count(*)=0 FROM clients),'Client raw customer table is inaccessible');
SELECT test_assert(NOT (SELECT to_jsonb(c) ? 'notes_internes' FROM client_colis c LIMIT 1),'Client view never exposes internal notes');
SELECT test_assert(update_client_profile('{"tel":"0692000000"}')->>'tel'='0692000000','Client can update allowed contact fields');
SELECT test_reject($q$SELECT client_decision('30000000-0000-4000-8000-000000000002','approve')$q$,'Client cannot approve another client dossier');
SELECT test_assert((create_telegram_invitation('20000000-0000-4000-8000-000000000001')->>'token') ~ '^[0-9a-f]{64}$','Private invitation is random and opaque');
SELECT test_reject($q$SELECT consume_telegram_invitation('x','123')$q$,'Browser cannot consume privileged Telegram invitation');
SELECT test_assert((client_decision('30000000-0000-4000-8000-000000000001','wait'))->>'attente_client_date' IS NOT NULL,'Wait decision is durable');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT test_assert((acquire_colis_lock('30000000-0000-4000-8000-000000000001')).staff_id=auth.uid(),'First staff owns edit lock');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
SELECT test_assert((acquire_colis_lock('30000000-0000-4000-8000-000000000001')).staff_id<>auth.uid(),'Second staff cannot steal edit lock');
SELECT test_reject($q$INSERT INTO colis(client_id,statut) VALUES('20000000-0000-4000-8000-000000000001','paye')$q$,'Staff cannot insert an already-paid dossier');
SELECT test_reject($q$INSERT INTO paiements(colis_id,client_id,montant,statut) VALUES('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',1,'confirme')$q$,'Preparateur cannot forge a payment ledger entry');
SELECT test_reject($q$SELECT save_quote('30000000-0000-4000-8000-000000000003','{}')$q$,'Preparateur cannot bypass quote permission');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
UPDATE colis SET trackings=ARRAY['BOX-1','BOX-2'],trackings_detail='[{"number":"BOX-1"},{"number":"BOX-2"}]',nb_colis=2,statut='mesure',feu_vert='en_attente',dims_par_colis='[{"dimL":10,"dimW":10,"dimH":10,"poids":2},{"dimL":10,"dimW":10,"dimH":10,"poids":1}]' WHERE id='30000000-0000-4000-8000-000000000001';
SELECT test_assert((SELECT attente_client_date IS NULL AND statut='mesure' FROM colis WHERE id='30000000-0000-4000-8000-000000000001'),'New receipt resumes request without granting consent');
UPDATE colis SET statut='attente_feu_vert' WHERE id='30000000-0000-4000-8000-000000000001';
SELECT queue_message('30000000-0000-4000-8000-000000000001','Bonjour, préparez ou attendez.','demande_feu_vert','test-request',NULL,'telegram');
SELECT queue_message('30000000-0000-4000-8000-000000000001','Bonjour, préparez ou attendez.','demande_feu_vert','test-request',NULL,'telegram');
SELECT test_assert((SELECT count(*)=1 FROM notification_outbox WHERE idempotency_key='test-request'),'Outbound idempotency avoids duplicate requests');
RESET ROLE;
UPDATE messages SET telegram_msg_id='99' WHERE template='demande_feu_vert';
SELECT test_reject($q$SELECT telegram_client_decision('30000000-0000-4000-8000-000000000001','approve','456','99')$q$,'Telegram chat cannot decide another client dossier');
UPDATE colis SET trackings=ARRAY['BOX-1','BOX-2','BOX-3'] WHERE id='30000000-0000-4000-8000-000000000001';
SELECT test_reject($q$SELECT telegram_client_decision('30000000-0000-4000-8000-000000000001','approve','123','99')$q$,'Old Telegram button cannot authorize new cartons');
SELECT test_assert(consume_telegram_invitation((SELECT token FROM telegram_invitations LIMIT 1),'123')->>'id'='20000000-0000-4000-8000-000000000001','Invitation links only its intended client');
SELECT test_reject($q$SELECT consume_telegram_invitation((SELECT token FROM telegram_invitations LIMIT 1),'123')$q$,'Invitation cannot be used twice');
SELECT test_reject($q$SELECT _apply_client_decision('30000000-0000-4000-8000-000000000001','invented',NULL,NULL,NULL,'test')$q$,'Unknown action never means refusal');
INSERT INTO envois(id,destination_code,date_depart,statut) VALUES('60000000-0000-4000-8000-000000000001','976',current_date+15,'planifie'),('60000000-0000-4000-8000-000000000002','974',current_date+20,'planifie');
SELECT test_assert((_apply_client_decision('30000000-0000-4000-8000-000000000001','approve',NULL,NULL,NULL,'test')).envoi_id='60000000-0000-4000-8000-000000000002','Consent assigns an eligible departure for the correct destination');
SELECT test_assert((SELECT statut='en_preparation' FROM colis WHERE id='30000000-0000-4000-8000-000000000003'),'Consent does not change other client dossiers');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT test_reject($q$SELECT save_quote('30000000-0000-4000-8000-000000000003','{"devisTotal":1,"devisTransport":-1,"devisOM":2,"devisOMR":0,"devisTVA":0}')$q$,'Negative/falsified quote components rejected');
SELECT save_quote('30000000-0000-4000-8000-000000000003',jsonb_build_object('devisTotal',base+2*par_kg,'devisTransport',base+2*par_kg,'devisOM',0,'devisOMR',0,'devisTVA',0,'finL',10,'finW',10,'finH',10,'finP',2,'modePaiementPro','virement','amounts',jsonb_build_object('total',999),'fraisDivers','[]'::jsonb)) FROM tarifs WHERE destination_code='974' AND actif;
SELECT test_assert((SELECT quote_version=1 AND devis_snapshot->>'createdAt' IS NOT NULL FROM colis WHERE id='30000000-0000-4000-8000-000000000003'),'Quote persists an immutable dated version');
SELECT test_assert((SELECT (devis_snapshot->'amounts'->>'total')::numeric=devis_total FROM colis WHERE id='30000000-0000-4000-8000-000000000003'),'PDF snapshot total is normalized to server amount');
SELECT test_reject($q$UPDATE colis SET devis_total=999 WHERE id='30000000-0000-4000-8000-000000000003'$q$,'Even direction cannot bypass save_quote with direct patch');
SELECT test_reject($q$SELECT save_quote('30000000-0000-4000-8000-000000000003','{}','2000-01-01')$q$,'Stale editor cannot replace new quote');
UPDATE colis SET statut='devis_envoye' WHERE id='30000000-0000-4000-8000-000000000003';
SELECT test_reject($q$SELECT mark_manual_payment('30000000-0000-4000-8000-000000000003',0.01)$q$,'Partial/wrong manual payment rejected');
SELECT test_reject($q$UPDATE colis SET statut='paye',paiement_montant=1,paiement_date=now() WHERE id='30000000-0000-4000-8000-000000000003'$q$,'Direct paid status cannot bypass ledger command');
SELECT mark_manual_payment(id,devis_total) FROM colis WHERE id='30000000-0000-4000-8000-000000000003';
SELECT mark_manual_payment(id,devis_total) FROM colis WHERE id='30000000-0000-4000-8000-000000000003';
SELECT test_assert((SELECT count(*)=1 FROM paiements WHERE colis_id='30000000-0000-4000-8000-000000000003'),'Repeated payment confirmation records once');
SELECT test_assert((SELECT statut='paye' AND paiement_date IS NOT NULL FROM colis WHERE id='30000000-0000-4000-8000-000000000003'),'Quote to paid transition is supported');
SELECT test_reject($q$UPDATE colis SET fin_p=20 WHERE id='30000000-0000-4000-8000-000000000003'$q$,'Paid quote inputs are immutable');
RESET ROLE;
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url) VALUES('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004','Invoice',100,'30000000-0000-4000-8000-000000000004/facture.pdf');
INSERT INTO ocr_extractions(id,facture_id,document_hash,document_file_url,total,lines) SELECT '50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','hash','30000000-0000-4000-8000-000000000004/facture.pdf',100,jsonb_build_array(jsonb_build_object('desc','Produit','qte',1,'prix',100,'cat',id)) FROM categories LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT confirm_ocr_extraction_current('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004/facture.pdf','hash');
SELECT confirm_ocr_extraction_current('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004/facture.pdf','hash');
SELECT test_assert((SELECT count(*)=1 FROM lignes WHERE facture_id='40000000-0000-4000-8000-000000000001'),'OCR confirmation cannot duplicate invoice articles');
SELECT test_assert((SELECT valide FROM factures WHERE id='40000000-0000-4000-8000-000000000001'),'OCR validation persists invoice approval');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
SELECT test_reject($q$INSERT INTO factures(colis_id,vendeur,montant,fichier_url,valide) VALUES('30000000-0000-4000-8000-000000000004','Forged',100,'30000000-0000-4000-8000-000000000004/forged.pdf',true)$q$,'Adding a document cannot bypass invoice validation permission');
UPDATE factures SET montant=110 WHERE id='40000000-0000-4000-8000-000000000001';
SELECT test_assert((SELECT NOT valide AND valide_par IS NULL FROM factures WHERE id='40000000-0000-4000-8000-000000000001'),'Non-validator edit clears previous invoice approval');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
UPDATE factures SET montant=100,valide=true WHERE id='40000000-0000-4000-8000-000000000001';
UPDATE tarifs SET base=12.34,par_kg=8.76 WHERE destination_code='976' AND actif;
SELECT save_quote('30000000-0000-4000-8000-000000000004','{"devisTotal":44.97,"devisTransport":33.10,"devisOM":6.66,"devisOMR":0,"devisTVA":3.98,"finL":10,"finW":10,"finH":10,"finP":2.37,"fraisDivers":[{"libelle":"Emballage","montant":1.23}]}');
SELECT test_assert((SELECT devis_total=44.97 AND devis_om=6.66 AND devis_tva=3.98 AND poids_facturable=2.37 FROM colis WHERE id='30000000-0000-4000-8000-000000000004'),'Server quote rounding matches canonical decimal fixture');
UPDATE lignes SET prix_unitaire=110 WHERE colis_id='30000000-0000-4000-8000-000000000004';
SELECT test_assert((SELECT devis_total IS NULL AND payplug_payment_url IS NULL AND quote_version=2 FROM colis WHERE id='30000000-0000-4000-8000-000000000004'),'Changing articles invalidates quote and payment link');
SELECT test_assert((SELECT count(*)=1 FROM quote_versions WHERE colis_id='30000000-0000-4000-8000-000000000004'),'Invalidation preserves previous immutable quote');
RESET ROLE;
SELECT test_assert((SELECT status='review' OR status='pending' FROM ocr_jobs WHERE facture_id='40000000-0000-4000-8000-000000000001'),'Invoice upload schedules automatic OCR');
SELECT test_assert((SELECT bool_and(NOT public) FROM storage.buckets WHERE id IN ('factures','photos-colis')),'Documents and parcel photos are private');
ROLLBACK;
