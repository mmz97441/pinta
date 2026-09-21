BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE FUNCTION owner_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label;END IF;RAISE NOTICE 'PASS: %',label;END; $$;
CREATE FUNCTION owner_reject(command text,label text,expected text DEFAULT '40001') RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE command;EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>expected THEN RAISE EXCEPTION 'FAIL wrong error % for %: %',SQLSTATE,label,SQLERRM;END IF;RAISE NOTICE 'PASS rejected: % (%)',label,SQLERRM;RETURN;END;RAISE EXCEPTION 'FAIL accepted: %',label;END; $$;
CREATE FUNCTION owner_token(f uuid) RETURNS text LANGUAGE sql AS $$ SELECT value->>'reviewToken' FROM jsonb_array_elements(get_invoice_review_context((SELECT colis_id FROM factures WHERE id=f))->'invoices') WHERE value->>'factureId'=f::text $$;
INSERT INTO auth.users(id,email) VALUES('de100000-0000-4000-8000-000000000001','owner-alex@example.test'),('de100000-0000-4000-8000-000000000002','owner-sam@example.test'),('de100000-0000-4000-8000-000000000003','owner-client@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('de200000-0000-4000-8000-000000000001','de100000-0000-4000-8000-000000000001','Alex','owner-alex@example.test','directeur',false),
 ('de200000-0000-4000-8000-000000000002','de100000-0000-4000-8000-000000000002','Sam','owner-sam@example.test','directeur',false);
INSERT INTO clients(id,user_id,nom,cp,type) VALUES
 ('de300000-0000-4000-8000-000000000001',NULL,'Professionnel propriétaire','97400','pro'),
 ('de300000-0000-4000-8000-000000000002','de100000-0000-4000-8000-000000000003','Particulier propriétaire','97400','particulier');
INSERT INTO colis(id,client_id,statut,feu_vert,nb_colis,dims_par_colis) VALUES
 ('de400000-0000-4000-8000-000000000001','de300000-0000-4000-8000-000000000001','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]'),
 ('de400000-0000-4000-8000-000000000003','de300000-0000-4000-8000-000000000002','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]'),
 ('de400000-0000-4000-8000-000000000004','de300000-0000-4000-8000-000000000002','mesure',NULL,1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]'),
 ('de400000-0000-4000-8000-000000000005','de300000-0000-4000-8000-000000000002','attente_feu_vert','en_attente',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]');
INSERT INTO colis(id,client_id,statut,feu_vert,nb_colis,dims_par_colis,final_packages,fin_l,fin_w,fin_h,fin_p,outgoing_parcel_count,final_measurements_version,final_measurements_at) VALUES
 ('de400000-0000-4000-8000-000000000002','de300000-0000-4000-8000-000000000001','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now());
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES
 ('de500000-0000-4000-8000-000000000001','de400000-0000-4000-8000-000000000003','Vendeur',20,'de400000-0000-4000-8000-000000000003/original.pdf',false),
 ('de500000-0000-4000-8000-000000000002','de400000-0000-4000-8000-000000000003','Vendeur',20,'de400000-0000-4000-8000-000000000003/copy.pdf',false);
INSERT INTO storage.objects(bucket_id,name) VALUES('factures','de400000-0000-4000-8000-000000000003/original.pdf'),('factures','de400000-0000-4000-8000-000000000003/copy.pdf');
INSERT INTO ocr_extractions(id,facture_id,status,document_file_url,document_hash,lines,total,vendeur) VALUES('de600000-0000-4000-8000-000000000001','de500000-0000-4000-8000-000000000001','review','de400000-0000-4000-8000-000000000003/original.pdf','owner-hash','[]',20,'Vendeur');
UPDATE tarifs SET base=10,par_kg=5 WHERE destination_code='974';
UPDATE staff_work_actions SET assignee_id='de100000-0000-4000-8000-000000000002' WHERE (colis_id,kind) IN (
 ('de400000-0000-4000-8000-000000000001'::uuid,'preparation'),('de400000-0000-4000-8000-000000000002'::uuid,'quote'),
 ('de400000-0000-4000-8000-000000000003'::uuid,'documents'),('de400000-0000-4000-8000-000000000004'::uuid,'reception'),
 ('de400000-0000-4000-8000-000000000005'::uuid,'reception'));
SELECT set_config('test.owner_colis',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id)::text FROM colis c WHERE id::text LIKE 'de400000%'),true);
SELECT set_config('test.owner_factures',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id)::text FROM factures f WHERE id::text LIKE 'de500000%'),true);
SELECT owner_assert(NOT has_function_privilege('authenticated','_assert_staff_task_owner(uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','_assert_staff_task_owner(uuid,text)','EXECUTE') AND NOT has_function_privilege('service_role','_assert_staff_task_owner(uuid,text)','EXECUTE'),'ownership helper cannot be invoked directly by API roles');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','de100000-0000-4000-8000-000000000001',true);
SELECT owner_reject($q$SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM colis WHERE id='de400000-0000-4000-8000-000000000001'$q$,'old editor cannot save preparation after reassignment even with current dossier version');
SELECT owner_reject($q$SELECT save_quote(id,'{"devisTransport":20,"devisOM":0,"devisOMR":0,"devisTVA":0,"devisTotal":20,"modePaiementPro":"virement"}',updated_at) FROM colis WHERE id='de400000-0000-4000-8000-000000000002'$q$,'direction cannot edit another assigned quote without explicit reassignment');
SELECT owner_reject($q$SELECT save_quote_customs(id,'[]',updated_at) FROM colis WHERE id='de400000-0000-4000-8000-000000000002'$q$,'customs editor checks quote owner before changing articles');
SELECT owner_reject($q$SELECT save_invoice_review('de500000-0000-4000-8000-000000000001',owner_token('de500000-0000-4000-8000-000000000001'),'de400000-0000-4000-8000-000000000003/original.pdf','[]',20,'Vendeur',NULL,false)$q$,'old invoice editor cannot save its draft after reassignment');
SELECT owner_reject($q$SELECT save_invoice_review('de500000-0000-4000-8000-000000000001',owner_token('de500000-0000-4000-8000-000000000001'),'de400000-0000-4000-8000-000000000003/original.pdf','[]',20,'Vendeur',NULL,true)$q$,'invoice validation also checks current owner');
SELECT owner_reject($q$SELECT classify_invoice_duplicate('de500000-0000-4000-8000-000000000002','de500000-0000-4000-8000-000000000001',owner_token('de500000-0000-4000-8000-000000000002'),owner_token('de500000-0000-4000-8000-000000000001'))$q$,'duplicate removal respects active document owner');
SELECT owner_reject($q$SELECT restore_invoice_duplicate('de500000-0000-4000-8000-000000000002',owner_token('de500000-0000-4000-8000-000000000002'))$q$,'duplicate restore respects active document owner');
SELECT owner_reject($q$SELECT confirm_ocr_extraction_current('de600000-0000-4000-8000-000000000001','de400000-0000-4000-8000-000000000003/original.pdf','owner-hash','[]',20,'Vendeur')$q$,'legacy OCR confirmation cannot bypass current document owner');
SELECT owner_reject($q$SELECT correct_colis_task(id,'preparation','{"boxes":[{"dimL":20,"dimW":20,"dimH":20,"poids":3}]}',updated_at,'Correction après reprise') FROM colis WHERE id='de400000-0000-4000-8000-000000000001'$q$,'targeted preparation correction checks its own task');
SELECT owner_reject($q$SELECT correct_colis_task(id,'devis','{}',updated_at,'Correction après reprise') FROM colis WHERE id='de400000-0000-4000-8000-000000000002'$q$,'targeted quote correction checks its own task');
SELECT owner_reject($q$SELECT correct_colis_task(id,'reception','{"boxes":[{"dimL":40,"dimW":30,"dimH":20,"poids":5}]}',updated_at,'Correction à réception') FROM colis WHERE id='de400000-0000-4000-8000-000000000004'$q$,'reception correction checks reception owner');
SELECT owner_reject($q$SELECT correct_colis_task(id,'accord','{}',updated_at,'Redemander accord client') FROM colis WHERE id='de400000-0000-4000-8000-000000000004'$q$,'renewing consent checks reception/agreement owner');
RESET ROLE;
SELECT owner_assert((SELECT jsonb_agg(to_jsonb(c) ORDER BY id)=current_setting('test.owner_colis')::jsonb FROM colis c WHERE id::text LIKE 'de400000%'),'all rejected stale-owner commands preserve dossiers, weights, agreement and quotes');
SELECT owner_assert((SELECT jsonb_agg(to_jsonb(f) ORDER BY id)=current_setting('test.owner_factures')::jsonb FROM factures f WHERE id::text LIKE 'de500000%'),'all rejected stale-owner commands preserve invoices');
SELECT owner_assert(NOT EXISTS(SELECT 1 FROM invoice_review_drafts WHERE facture_id::text LIKE 'de500000%'),'rejected draft save creates no partial draft');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','de100000-0000-4000-8000-000000000002',true);
SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM colis WHERE id='de400000-0000-4000-8000-000000000001';
SELECT owner_assert((SELECT state='done' AND assignee_id=auth.uid() FROM staff_work_actions WHERE colis_id='de400000-0000-4000-8000-000000000001' AND kind='preparation'),'current owner can save and complete physical preparation');
SELECT save_invoice_review('de500000-0000-4000-8000-000000000001',owner_token('de500000-0000-4000-8000-000000000001'),'de400000-0000-4000-8000-000000000003/original.pdf','[]',20,'Vendeur',NULL,false);
RESET ROLE;
SELECT owner_assert(EXISTS(SELECT 1 FROM invoice_review_drafts WHERE facture_id='de500000-0000-4000-8000-000000000001' AND saved_by='de100000-0000-4000-8000-000000000002'),'current document owner can save a draft');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','de100000-0000-4000-8000-000000000001',true);
-- A separate preparation operation remains available while Sam verifies invoices.
SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM colis WHERE id='de400000-0000-4000-8000-000000000003';
SELECT owner_assert((SELECT fin_p=2 FROM colis WHERE id='de400000-0000-4000-8000-000000000003'),'free preparation is not blocked by a colleague owning documents');
SELECT owner_assert((SELECT assignee_id='de100000-0000-4000-8000-000000000002' AND state<>'done' FROM staff_work_actions WHERE colis_id='de400000-0000-4000-8000-000000000003' AND kind='documents'),'saving preparation does not take or complete colleague invoice work');
SELECT save_quote(id,'{"devisTransport":20,"devisOM":0,"devisOMR":0,"devisTVA":0,"devisTotal":20,"modePaiementPro":"virement"}',updated_at) FROM colis WHERE id='de400000-0000-4000-8000-000000000001';
SELECT owner_assert((SELECT devis_total=20 FROM colis WHERE id='de400000-0000-4000-8000-000000000001'),'free quote can follow preparation completed by another colleague');
SELECT correct_colis_task(id,'preparation','{"boxes":[{"dimL":10,"dimW":10,"dimH":10,"poids":3}]}',updated_at,'Corriger mesures terminées') FROM colis WHERE id='de400000-0000-4000-8000-000000000001';
SELECT owner_assert((SELECT fin_p=3 FROM colis WHERE id='de400000-0000-4000-8000-000000000001'),'finished historical task ownership does not block explicit permitted correction');
-- Customer approval is a client event, never a staff ownership operation.
SELECT set_config('request.jwt.claim.sub','de100000-0000-4000-8000-000000000003',true);
SELECT client_decision(id,'approve',updated_at) FROM client_colis WHERE id='de400000-0000-4000-8000-000000000005';
RESET ROLE;
SELECT owner_assert((SELECT statut='autorise' AND feu_vert='autorise' FROM colis WHERE id='de400000-0000-4000-8000-000000000005'),'client approval remains possible while an employee owns agreement follow-up');
SELECT owner_assert(NOT EXISTS(SELECT 1 FROM notification_outbox WHERE colis_id::text LIKE 'de400000%'),'owner checks and business saves send no external notification');
ROLLBACK;
