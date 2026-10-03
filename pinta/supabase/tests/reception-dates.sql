BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE FUNCTION arrival_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label;END IF;RAISE NOTICE 'PASS: %',label;END;$$;
CREATE FUNCTION arrival_reject(command text,label text,code text DEFAULT '42501') RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE command;EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>code THEN RAISE EXCEPTION 'FAIL wrong code % for %: %',SQLSTATE,label,SQLERRM;END IF;RAISE NOTICE 'PASS rejected: %',label;RETURN;END;RAISE EXCEPTION 'FAIL accepted: %',label;END;$$;
INSERT INTO auth.users(id,email) VALUES('ed000000-0000-4000-8000-000000000001','arrival-staff@example.test'),('ed000000-0000-4000-8000-000000000002','arrival-client@example.test'),('ed000000-0000-4000-8000-000000000003','arrival-other@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES('ed100000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','Direction test','arrival-staff@example.test','directeur',false);
INSERT INTO clients(id,user_id,nom,cp,type) VALUES('ed200000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000002','Client dates','97400','particulier'),('ed200000-0000-4000-8000-000000000002','ed000000-0000-4000-8000-000000000003','Autre client','97400','particulier');
-- Historical-like records deliberately inserted without staff receipt identity.
INSERT INTO colis(id,client_id,ref,statut,feu_vert,nb_colis,trackings_detail,dims_par_colis,date_reception)
 VALUES('ed300000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','EXP-OLD-DATES','mesure','en_attente',3,'[{"number":"FIRST"},{"number":""},{"number":"LAST"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1},{"dimL":20,"dimW":20,"dimH":20,"poids":2},{"dimL":30,"dimW":30,"dimH":30,"poids":3}]',now()-interval '10 days'),
 ('ed300000-0000-4000-8000-000000000002','ed200000-0000-4000-8000-000000000002','EXP-OTHER-DATES','mesure','en_attente',1,'[{"number":"OTHER"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]',now()-interval '5 days');
INSERT INTO reception_append_receipts(request_id,colis_id,actor_id,request_payload,first_carton,added,created_at)
 VALUES('ed400000-0000-4000-8000-000000000001','ed300000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','{"cartons":[{"tracking":"LAST","dimL":30,"dimW":30,"dimH":30,"poids":3}]}',3,1,now()-interval '2 days');
-- A malformed historical audit must neither manufacture an initial lot nor break the batch.
INSERT INTO audit_actions(colis_id,action,before_data,after_data,created_at) VALUES('ed300000-0000-4000-8000-000000000001','reception_cartons_added','{"nb_colis":"unknown","trackings_detail":null,"dims_par_colis":null}','{}',now()-interval '2 days');
CREATE TEMP TABLE arrival_before AS SELECT to_jsonb(c) data FROM colis c;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT arrival_assert((SELECT reception_dates->0='null'::jsonb AND reception_dates->1='null'::jsonb AND reception_dates#>>'{2,source}'='append_receipt' FROM get_reception_dates(ARRAY['ed300000-0000-4000-8000-000000000001'::uuid])),'historical append gets its actual receipt date while unknown initial slots remain unknown');
RESET ROLE;
SELECT arrival_assert(NOT EXISTS((SELECT to_jsonb(c) FROM colis c EXCEPT SELECT data FROM arrival_before)),'reading history leaves every dossier field and revision unchanged');
SELECT arrival_assert(NOT has_function_privilege('authenticated','_reception_dates_from_evidence(colis)','EXECUTE') AND NOT has_function_privilege('anon','get_reception_dates(uuid[])','EXECUTE'),'private evidence and anonymous access denied');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000002',true);
SELECT arrival_assert((SELECT count(*)=1 AND bool_and(colis_id='ed300000-0000-4000-8000-000000000001') FROM get_reception_dates(ARRAY['ed300000-0000-4000-8000-000000000001'::uuid,'ed300000-0000-4000-8000-000000000002'::uuid,'ed300000-0000-4000-8000-000000000099'::uuid])),'client sees only owned identifiers and no other dossier existence');
SELECT arrival_assert((SELECT count(*)=0 FROM reception_append_receipts),'private ledger exposes no rows even with legacy broad table grants');
SELECT arrival_reject('SELECT * FROM get_reception_dates(array_fill(gen_random_uuid(),ARRAY[101]))','batch size is bounded','22023');
SELECT set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000001',true);
INSERT INTO colis(id,client_id,ref,statut,nb_colis,trackings_detail,dims_par_colis,date_reception,reception_dates)
 VALUES('ed300000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000001','EXP-NEW-DATES','mesure',2,'[{"number":"NEW1"},{"number":""}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1},{"dimL":20,"dimW":20,"dimH":20,"poids":2}]','2000-01-01','[{"receivedAt":"2000-01-01T00:00:00Z","source":"server"}]');
SELECT arrival_assert((SELECT jsonb_array_length(reception_dates)=2 AND reception_dates#>>'{0,source}'='server' AND reception_dates->0=reception_dates->1 AND (reception_dates#>>'{0,receivedAt}')::timestamptz>=now() FROM colis WHERE ref='EXP-NEW-DATES'),'new receipt dates every physical carton from server time, ignoring forged input dates');
SELECT arrival_reject($q$UPDATE colis SET reception_dates='[]' WHERE ref='EXP-NEW-DATES'$q$,'stored arrival dates cannot be forged or erased');
RESET ROLE;
CREATE TEMP TABLE arrival_original AS SELECT to_jsonb(c) data FROM colis c WHERE ref='EXP-NEW-DATES';GRANT SELECT ON arrival_original TO authenticated;
SET LOCAL ROLE authenticated;
SELECT append_reception_cartons(id,'[{"tracking":"LATER","fournisseur":"Later","dimL":30,"dimW":20,"dimH":10,"poids":3}]',updated_at,NULL,NULL,NULL,'ed400000-0000-4000-8000-000000000002') FROM colis WHERE ref='EXP-NEW-DATES';
SELECT arrival_assert((SELECT reception_dates->0=b.data->'reception_dates'->0 AND reception_dates->1=b.data->'reception_dates'->1 AND reception_dates#>>'{2,source}'='server' AND (reception_dates#>>'{2,receivedAt}')::timestamptz>(reception_dates#>>'{0,receivedAt}')::timestamptz FROM colis c,arrival_original b WHERE c.ref='EXP-NEW-DATES'),'later append timestamps only the new carton and preserves both original times');
RESET ROLE;
CREATE TEMP TABLE arrival_appended AS SELECT to_jsonb(c) data FROM colis c WHERE ref='EXP-NEW-DATES';GRANT SELECT ON arrival_appended TO authenticated;
SET LOCAL ROLE authenticated;
SELECT append_reception_cartons('ed300000-0000-4000-8000-000000000003','[{"tracking":"LATER","fournisseur":"Later","dimL":30,"dimW":20,"dimH":10,"poids":3}]','2000-01-01',NULL,NULL,NULL,'ed400000-0000-4000-8000-000000000002');
SELECT arrival_assert((SELECT to_jsonb(c)=b.data FROM colis c,arrival_appended b WHERE c.ref='EXP-NEW-DATES'),'lost-response retry returns exact dossier with original timestamps and no added carton');
SELECT correct_colis_task(id,'reception','{"boxes":[{"dimL":10,"dimW":10,"dimH":10,"poids":2},{"dimL":20,"dimW":20,"dimH":20,"poids":2},{"dimL":30,"dimW":20,"dimH":10,"poids":3}]}',updated_at,'Corriger le poids reçu') FROM colis WHERE ref='EXP-NEW-DATES';
SELECT arrival_assert((SELECT reception_dates=b.data->'reception_dates' AND trackings_detail=b.data->'trackings_detail' AND consent_request_version=(b.data->>'consent_request_version')::integer FROM colis c,arrival_appended b WHERE c.ref='EXP-NEW-DATES'),'measure correction preserves arrival evidence, carton identity and approval generation');
-- Saving/consulting date metadata cannot obsolete a client approval snapshot.
RESET ROLE;
SAVEPOINT approval_dates;
SET LOCAL ROLE authenticated;
SELECT queue_message(id,'Accord explicite test','demande_feu_vert','DATE-SNAPSHOT',NULL,'portal',consent_request_version) FROM colis WHERE ref='EXP-NEW-DATES';
SELECT arrival_assert((SELECT NOT request_snapshot ? 'reception_dates' AND request_snapshot->'trackings_detail'=c.trackings_detail FROM messages m JOIN colis c ON c.id=m.colis_id WHERE m.texte='Accord explicite test'),'approval snapshot continues to use carton identity, not arrival metadata');
UPDATE colis SET casier='CHECK-DATES' WHERE ref='EXP-NEW-DATES';
SELECT set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000002',true);
SELECT client_decision(id,'approve',updated_at) FROM client_colis WHERE ref='EXP-NEW-DATES';
SELECT arrival_assert((SELECT feu_vert='autorise' AND reception_dates#>>'{2,source}'='server' FROM client_colis WHERE ref='EXP-NEW-DATES'),'current approval still succeeds after a date-preserving save');
ROLLBACK TO SAVEPOINT approval_dates;
SET LOCAL ROLE authenticated;
-- A real later save carries historical evidence in its result; consultation alone does not.
UPDATE colis SET casier='NEW-SHELF' WHERE ref='EXP-OLD-DATES';
SELECT arrival_assert((SELECT reception_dates->0='null'::jsonb AND reception_dates#>>'{2,source}'='append_receipt' FROM colis WHERE ref='EXP-OLD-DATES'),'ordinary save returns proven history instead of erasing read-only enrichment');
SELECT set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000002',true);
SELECT arrival_assert((SELECT jsonb_array_length(reception_dates)=3 FROM client_colis WHERE ref='EXP-NEW-DATES'),'client safe projection includes only owned carton dates');
RESET ROLE;
-- Trusted append range + matching before-image can prove an initial one-carton lot.
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO colis(id,client_id,ref,statut,nb_colis,trackings_detail,date_reception) VALUES('ed300000-0000-4000-8000-000000000004','ed200000-0000-4000-8000-000000000001','EXP-PROVEN-INITIAL','mesure',2,'[{"number":"BASE"},{"number":"ADDED"}]',now()-interval '15 days');
INSERT INTO reception_append_receipts(request_id,colis_id,actor_id,request_payload,first_carton,added,created_at) VALUES('ed400000-0000-4000-8000-000000000004','ed300000-0000-4000-8000-000000000004','ed000000-0000-4000-8000-000000000001','{"cartons":[{"tracking":"ADDED"}]}',2,1,now()-interval '3 days');
INSERT INTO audit_actions(colis_id,action,before_data,after_data,created_at) SELECT id,'reception_cartons_added',jsonb_build_object('nb_colis',1,'trackings_detail',NULL,'dims_par_colis',NULL,'date_reception',date_reception),'{}',now()-interval '3 days' FROM colis WHERE ref='EXP-PROVEN-INITIAL';
SELECT set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT arrival_assert((SELECT reception_dates#>>'{0,source}'='initial_receipt' AND (reception_dates#>>'{0,receivedAt}')::timestamptz=now()-interval '15 days' AND reception_dates#>>'{1,source}'='append_receipt' FROM get_reception_dates(ARRAY['ed300000-0000-4000-8000-000000000004'::uuid])),'proven initial single carton retains its recorded arrival, not creation or later append date');
RESET ROLE;
SELECT arrival_assert(NOT EXISTS(SELECT 1 FROM messages WHERE colis_id::text LIKE 'ed300000%') AND NOT EXISTS(SELECT 1 FROM notifications WHERE colis_id::text LIKE 'ed300000%'),'arrival metadata sends no client notification');
ROLLBACK;
