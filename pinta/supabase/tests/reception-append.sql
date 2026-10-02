BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE FUNCTION append_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF;RAISE NOTICE 'PASS: %',label;END; $$;
CREATE FUNCTION append_reject(command text,label text,expected text DEFAULT '22023') RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE command;EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>expected THEN RAISE EXCEPTION 'FAIL wrong error % for %: %',SQLSTATE,label,SQLERRM;END IF;RAISE NOTICE 'PASS rejected: %',label;RETURN;END;RAISE EXCEPTION 'FAIL accepted: %',label;END; $$;
CREATE FUNCTION append_carton(tracking text DEFAULT '') RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_array(jsonb_build_object('dimL',20,'dimW',15,'dimH',10,'poids',1.25,'tracking',tracking,'fournisseur','Nouveau fournisseur')) $$;
INSERT INTO auth.users(id,email) VALUES
 ('ec100000-0000-4000-8000-000000000001','append-alex@example.test'),('ec100000-0000-4000-8000-000000000002','append-sam@example.test'),
 ('ec100000-0000-4000-8000-000000000003','append-client@example.test'),('ec100000-0000-4000-8000-000000000004','append-no-right@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('ec200000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001','Alex','append-alex@example.test','directeur',false),
 ('ec200000-0000-4000-8000-000000000002','ec100000-0000-4000-8000-000000000002','Sam','append-sam@example.test','directeur',false),
 ('ec200000-0000-4000-8000-000000000004','ec100000-0000-4000-8000-000000000004','Read only','append-no-right@example.test','preparateur',false);
INSERT INTO staff_permissions(staff_id,perm_colis_receptionner,perm_comm_message_libre) VALUES('ec200000-0000-4000-8000-000000000004',false,true) ON CONFLICT(staff_id) DO UPDATE SET perm_colis_receptionner=false,perm_colis_demander_feuvert=false,perm_comm_message_libre=true;
INSERT INTO clients(id,user_id,nom,cp,type) VALUES('ec300000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000003','Append client','97400','pro');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,nb_colis,dims_par_colis,trackings_detail,notes_reception,final_packages,fin_l,fin_w,fin_h,fin_p,outgoing_parcel_count,final_measurements_version) VALUES
 ('ec400000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','EXP-APPEND-A','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"number":"OLD-A","fournisseur":"Ancien fournisseur"}]','Ancienne note',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
 ('ec400000-0000-4000-8000-000000000002','ec300000-0000-4000-8000-000000000001','EXP-APPEND-B','en_preparation','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"number":"OLD-B"}]',NULL,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0),
 ('ec400000-0000-4000-8000-000000000003','ec300000-0000-4000-8000-000000000001','EXP-APPEND-C','attente_feu_vert','en_attente',2,'[{"dimL":7},null]','[{"number":"OLD-C1"},{"number":"OLD-C2"}]',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
 ('ec400000-0000-4000-8000-000000000004','ec300000-0000-4000-8000-000000000001','EXP-APPEND-D','devis_envoye','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"number":"OLD-D"}]',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
 ('ec400000-0000-4000-8000-000000000005','ec300000-0000-4000-8000-000000000001','EXP-APPEND-E','mesure','en_attente',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"number":"OLD-E"}]',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES('ec500000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000002','Existing invoice',100,'append/source.pdf',true);
UPDATE colis SET devis_total=20,devis_transport=20,devis_snapshot='{"inputs":{"marker":"saved-before-append"}}',devis_brouillon=true WHERE id='ec400000-0000-4000-8000-000000000002';
INSERT INTO payment_intents(colis_id,quote_version,provider_id,payment_url,amount_cents,status,provider_is_live) SELECT id,quote_version,'pay_appendPending','https://secure.payplug.com/append',2000,'pending',false FROM colis WHERE id='ec400000-0000-4000-8000-000000000004';
UPDATE staff_work_actions SET assignee_id='ec100000-0000-4000-8000-000000000002' WHERE colis_id='ec400000-0000-4000-8000-000000000005' AND kind='reception';
-- Historical completed reception must not silently reclaim newly arrived work.
INSERT INTO staff_work_actions(colis_id,kind,state,assignee_id,completed_at) VALUES('ec400000-0000-4000-8000-000000000002','reception','done','ec100000-0000-4000-8000-000000000002',now())
 ON CONFLICT(colis_id,kind) DO UPDATE SET state='done',assignee_id=excluded.assignee_id,completed_at=now();
SELECT append_assert(NOT has_function_privilege('anon','append_reception_cartons(uuid,jsonb,timestamptz,text,text,text[],uuid)','EXECUTE') AND has_function_privilege('authenticated','append_reception_cartons(uuid,jsonb,timestamptz,text,text,text[],uuid)','EXECUTE'),'append is an authenticated command');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','ec100000-0000-4000-8000-000000000004',true);
SELECT append_reject($q$SELECT append_reception_cartons(id,append_carton(),updated_at) FROM colis WHERE ref='EXP-APPEND-A'$q$,'employee without receipt permission cannot append','42501');
SELECT append_reject($q$SELECT queue_message('ec400000-0000-4000-8000-000000000005','Demande non permise','demande_feu_vert','no-right',NULL,'portal',0)$q$,'communication permission alone cannot request client consent','42501');
SELECT set_config('request.jwt.claim.sub','ec100000-0000-4000-8000-000000000001',true);
SELECT append_reject($q$SELECT append_reception_cartons(id,append_carton(),NULL) FROM colis WHERE ref='EXP-APPEND-A'$q$,'missing revision rejected','40001');
SELECT append_reject($q$SELECT append_reception_cartons(id,append_carton(),'2000-01-01') FROM colis WHERE ref='EXP-APPEND-A'$q$,'stale revision rejected without lost cartons','40001');
SELECT append_reject($q$SELECT append_reception_cartons(id,'[{"poids":1}]',updated_at) FROM colis WHERE ref='EXP-APPEND-A'$q$,'new carton must have all reception measurements');
SELECT append_reject($q$SELECT append_reception_cartons(id,append_carton(' old-a '),updated_at) FROM colis WHERE ref='EXP-APPEND-A'$q$,'existing scanned carton cannot be added twice');
SELECT append_reject($q$SELECT append_reception_cartons(id,append_carton('DUP')||append_carton('dup'),updated_at) FROM colis WHERE ref='EXP-APPEND-A'$q$,'duplicate scans inside one submission roll back all cartons');
SELECT append_reject($q$SELECT append_reception_cartons(id,append_carton('OLD-E'),updated_at) FROM colis WHERE ref='EXP-APPEND-A'$q$,'known tracking from another dossier cannot be attached');
SELECT append_reject($q$SELECT append_reception_cartons(id,append_carton(),updated_at) FROM colis WHERE ref='EXP-APPEND-E'$q$,'another active reception owner requires a relay','40001');
SELECT append_reject($q$SELECT queue_message('ec400000-0000-4000-8000-000000000005','Demande collègue','demande_feu_vert','wrong-owner',NULL,'portal',0)$q$,'stale task owner cannot send an agreement request','40001');
SELECT append_reject($q$SELECT append_reception_cartons(id,append_carton(),updated_at) FROM colis WHERE ref='EXP-APPEND-D'$q$,'active PayPlug link blocks append without provider cancellation');
SELECT append_reject($q$SELECT queue_message('ec400000-0000-4000-8000-000000000003','Demande incomplète','demande_feu_vert','unmeasured',NULL,'portal',0)$q$,'unknown old measurements cannot be sent for client agreement');
SELECT append_assert(NOT EXISTS(SELECT 1 FROM notification_outbox WHERE colis_id::text LIKE 'ec400000%'),'rejected receipt and request operations create no notifications');
SELECT set_config('test.append_revision',(SELECT updated_at::text FROM colis WHERE ref='EXP-APPEND-A'),true);
SELECT append_reception_cartons(id,append_carton('NEW-A'),updated_at,'B2','Nouvelle note',NULL,'ec700000-0000-4000-8000-000000000001') FROM colis WHERE ref='EXP-APPEND-A';
SELECT append_assert((SELECT ref='EXP-APPEND-A' AND nb_colis=2 AND statut='mesure' AND feu_vert='en_attente' AND consent_request_version=1 AND preparation_composition_version=1 AND final_measurements_version IS NULL AND (dims_par_colis->0->>'poids')::numeric=4 AND (dims_par_colis->1->>'poids')::numeric=1.25 AND poids=5.25 AND casier='B2' AND notes_reception=E'Ancienne note\nNouvelle note' FROM colis WHERE ref='EXP-APPEND-A'),'same EXP keeps original carton 1 and appends measured carton 2 with renewed consent');
SELECT append_assert(NOT EXISTS(SELECT 1 FROM notification_outbox WHERE colis_id::text LIKE 'ec400000%'),'successful append sends no request or notification');
SELECT append_assert((append_reception_cartons('ec400000-0000-4000-8000-000000000001',append_carton('NEW-A'),current_setting('test.append_revision')::timestamptz,'B2','Nouvelle note',NULL,'ec700000-0000-4000-8000-000000000001')->>'reused')::boolean AND (SELECT nb_colis=2 FROM colis WHERE ref='EXP-APPEND-A'),'lost-response retry with stable request id never adds a second carton');
SELECT append_reject($q$SELECT append_reception_cartons(id,append_carton('OTHER'),updated_at,'B2','Nouvelle note',NULL,'ec700000-0000-4000-8000-000000000001') FROM colis WHERE ref='EXP-APPEND-A'$q$,'changing payload cannot reuse a committed reception identity','40001');
SELECT append_reception_cartons(id,append_carton('NEW-B'),updated_at) FROM colis WHERE ref='EXP-APPEND-B';
SELECT append_assert(EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='ec400000-0000-4000-8000-000000000002' AND kind='reception' AND state='ready' AND assignee_id IS NULL),'a finished historical reception reopens free instead of assigning its previous owner silently');
SELECT append_assert((SELECT devis_total IS NULL AND devis_brouillon AND final_packages='[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]'::jsonb AND fin_p=2 AND final_measurements_version IS NULL AND NOT preparation_measurements_ready(c) AND outgoing_parcel_count IS NULL AND statut='mesure' AND feu_vert='en_attente' FROM colis c WHERE ref='EXP-APPEND-B'),'append after saved quote keeps optimisation draft but invalidates its certificate and amount');
SELECT append_assert(EXISTS(SELECT 1 FROM quote_versions WHERE colis_id='ec400000-0000-4000-8000-000000000002' AND total=20 AND snapshot#>>'{inputs,marker}'='saved-before-append') AND EXISTS(SELECT 1 FROM factures WHERE id='ec500000-0000-4000-8000-000000000001' AND valide AND montant=100),'previous commercial evidence and verified purchase invoices remain intact');
SELECT append_reception_cartons(id,append_carton('NEW-C'),updated_at) FROM colis WHERE ref='EXP-APPEND-C';
SELECT append_assert((SELECT nb_colis=3 AND statut='receptionne' AND (dims_par_colis->0->>'dimL')::numeric=7 AND dims_par_colis->1='null'::jsonb AND (dims_par_colis->2->>'poids')::numeric=1.25 AND poids IS NULL FROM colis WHERE ref='EXP-APPEND-C'),'legacy gaps remain explicit and new carton is numbered 3');
SELECT append_reject($q$SELECT save_preparation_measurements(id,append_carton(),updated_at,preparation_composition_version) FROM colis WHERE ref='EXP-APPEND-B'$q$,'stale prior optimisation cannot bypass renewed consent','P0001');
SELECT queue_message('ec400000-0000-4000-8000-000000000001','Vos cartons sont reçus. Donnez votre accord et joignez vos factures.','demande_feu_vert','append-consent',NULL,'portal',1);
SELECT append_assert((SELECT statut='attente_feu_vert' AND feu_vert='en_attente' FROM colis WHERE ref='EXP-APPEND-A') AND EXISTS(SELECT 1 FROM messages WHERE colis_id='ec400000-0000-4000-8000-000000000001' AND request_snapshot->>'invoice_requested'='true' AND request_snapshot->>'consent_request_version'='1'),'explicit request atomically records waiting state and combined missing-invoice request');
SELECT queue_message('ec400000-0000-4000-8000-000000000001','Identical retry','demande_feu_vert','append-consent',NULL,'portal',1);
SELECT append_assert((SELECT count(*)=1 FROM notification_outbox WHERE idempotency_key='append-consent'),'retry reuses existing request instead of spamming');
SELECT set_config('request.jwt.claim.sub','ec100000-0000-4000-8000-000000000003',true);
SELECT client_decision(id,'approve',updated_at) FROM client_colis WHERE ref='EXP-APPEND-A';
RESET ROLE;
SELECT append_assert((SELECT statut='autorise' AND feu_vert='autorise' FROM colis WHERE ref='EXP-APPEND-A') AND EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='ec400000-0000-4000-8000-000000000001' AND kind='preparation' AND state='ready'),'client approval immediately exposes a ready optimisation task');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ec100000-0000-4000-8000-000000000002',true);
SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM colis WHERE ref='EXP-APPEND-A';
SELECT append_assert((SELECT statut='en_preparation' AND preparation_measurements_ready(c) AND poids=5.25 AND fin_p=2 FROM colis c WHERE ref='EXP-APPEND-A'),'another operator saves independent optimisation and moves to amount preparation without overwriting received weight');
SELECT append_assert(EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='ec400000-0000-4000-8000-000000000001' AND kind='quote' AND state='ready'),'confirmed optimisation makes the pro amount task ready');
SELECT append_reject($q$SELECT queue_message('ec400000-0000-4000-8000-000000000001','Nouvelle demande périmée','demande_feu_vert','outdated-stage',NULL,'portal',1)$q$,'new agreement request cannot be sent after work has progressed without explicit correction','40001');
RESET ROLE;
UPDATE payment_intents SET provider_cancelled_at=now() WHERE colis_id='ec400000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT append_reception_cartons(id,append_carton('NEW-D'),updated_at) FROM colis WHERE ref='EXP-APPEND-D';
SELECT append_assert((SELECT nb_colis=2 AND statut='mesure' FROM colis WHERE ref='EXP-APPEND-D'),'append is allowed after external cancellation was explicitly recorded');
RESET ROLE;
UPDATE colis SET archive=true WHERE ref='EXP-APPEND-E';
SET LOCAL ROLE authenticated;
SELECT append_reject($q$SELECT append_reception_cartons(id,append_carton(),updated_at) FROM colis WHERE ref='EXP-APPEND-E'$q$,'archived dossier cannot accept new receipt');
ROLLBACK;
