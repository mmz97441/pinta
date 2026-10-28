-- Validated reception and grouped arrival notice (20261028000001_reception_validation.sql). Run by
-- run-reception-validation.sh after every migration, with Supabase's default privileges: the API roles hold every
-- table and function privilege a migration does not revoke. Checked: the shape (tables, guards, grants); the pending
-- cartons (start point, new dossier, appended carton, partial validation); every refusal with its SQLSTATE; a
-- validation without notice, with a Telegram notice and with an e-mail notice; the replay of a request; the arrival
-- notices with their delivery state; the append-only record; a document sent in explicit reply to the notice that asks
-- for the purchase invoice (register_telegram_document). Concurrent validations of one carton: in the runner.
BEGIN;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE FUNCTION rv_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
-- A refusal: SQLSTATE, and message and HINT when given.
CREATE FUNCTION rv_reject(command text,label text,code text,message text DEFAULT NULL,hint text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got_hint text;
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS got_hint=PG_EXCEPTION_HINT;
  IF SQLSTATE<>code THEN RAISE EXCEPTION 'FAIL wrong code % for %: %',SQLSTATE,label,SQLERRM; END IF;
  IF message IS NOT NULL AND SQLERRM<>message THEN RAISE EXCEPTION 'FAIL wrong message for %: %',label,SQLERRM; END IF;
  IF hint IS NOT NULL AND nullif(got_hint,'') IS DISTINCT FROM hint THEN RAISE EXCEPTION 'FAIL wrong hint % for %',got_hint,label; END IF;
  RAISE NOTICE 'PASS rejected: % [%]',label,SQLSTATE; RETURN;
 END;
 RAISE EXCEPTION 'FAIL accepted: %',label;
END $$;
CREATE FUNCTION rv_id(name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT (CASE name
 WHEN 'director' THEN 'f1000000-0000-4000-8000-000000000001' WHEN 'receiver' THEN 'f1000000-0000-4000-8000-000000000002'
 WHEN 'viewer' THEN 'f1000000-0000-4000-8000-000000000003' WHEN 'client' THEN 'f1000000-0000-4000-8000-000000000004'
 WHEN 'telegram' THEN 'f1000000-0000-4000-8000-000000000005'
 WHEN 'A' THEN 'f1200000-0000-4000-8000-000000000001' WHEN 'B' THEN 'f1200000-0000-4000-8000-000000000002'
 WHEN 'C' THEN 'f1200000-0000-4000-8000-000000000003' WHEN 'D' THEN 'f1200000-0000-4000-8000-000000000004'
 WHEN 'A_OLD' THEN 'f1300000-0000-4000-8000-000000000001' WHEN 'A_NEW' THEN 'f1300000-0000-4000-8000-000000000002'
 WHEN 'B1' THEN 'f1300000-0000-4000-8000-000000000003' WHEN 'C1' THEN 'f1300000-0000-4000-8000-000000000004'
 WHEN 'D1' THEN 'f1300000-0000-4000-8000-000000000005' WHEN 'A_ARCH' THEN 'f1300000-0000-4000-8000-000000000006'
 WHEN 'A_CANC' THEN 'f1300000-0000-4000-8000-000000000007' WHEN 'LEGACY' THEN 'f1300000-0000-4000-8000-000000000008'
 WHEN 'B2' THEN 'f1300000-0000-4000-8000-000000000009' WHEN 'PARTIAL' THEN 'f1300000-0000-4000-8000-000000000010'
 WHEN 'E' THEN 'f1200000-0000-4000-8000-000000000005' WHEN 'E1' THEN 'f1300000-0000-4000-8000-000000000011'
 WHEN 'E2' THEN 'f1300000-0000-4000-8000-000000000012' END)::uuid $$;
CREATE FUNCTION rv_item(name text,through integer) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('colisId',rv_id(name),'throughCarton',through) $$;
-- Who acts: the owner (migrations, SQL editor), a team member or the client (PostgREST, authenticated), anon, the
-- Edge functions (service key).
CREATE FUNCTION rv_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role',CASE who WHEN 'owner' THEN '' WHEN 'service' THEN 'service_role' WHEN 'anon' THEN 'anon' ELSE 'authenticated' END,true);
 PERFORM set_config('request.jwt.claim.sub',CASE WHEN who IN ('owner','service','anon') THEN '' ELSE rv_id(who)::text END,true);
 IF who<>'owner' THEN EXECUTE format('SET LOCAL ROLE %I',CASE who WHEN 'service' THEN 'service_role' WHEN 'anon' THEN 'anon' ELSE 'authenticated' END); END IF;
END $$;
-- The references the pending list shows, in its order.
CREATE FUNCTION rv_pending_refs(p_client uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT coalesce(jsonb_agg(x.e->>'ref' ORDER BY x.n),'[]'::jsonb) FROM jsonb_array_elements(list_pending_receptions(p_client)) WITH ORDINALITY x(e,n) $$;
CREATE FUNCTION rv_pending(p_ref text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT e FROM jsonb_array_elements(list_pending_receptions()) e WHERE e->>'ref'=p_ref $$;
-- Every dossier revision, whoever reads: a validation never writes a dossier.
CREATE FUNCTION rv_revisions() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_object_agg(id,updated_at) FROM colis WHERE ref LIKE 'EXP-RV-%' $$;
CREATE FUNCTION rv_count(p_sql text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result bigint; BEGIN EXECUTE p_sql INTO result; RETURN result; END $$;

-- ── R1. Shape: tables, guards, grants; nothing existing changed ──
DO $$
DECLARE fn text; tbl text; r text;
BEGIN
 IF NOT has_table_privilege('authenticated','colis','INSERT') THEN RAISE EXCEPTION 'FAIL: run with Supabase default privileges (run-reception-validation.sh)'; END IF;
 FOREACH tbl IN ARRAY ARRAY['reception_validation_settings','reception_validations','reception_validation_items'] LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=tbl::regclass) THEN RAISE EXCEPTION 'FAIL: RLS off on %',tbl; END IF;
  FOREACH r IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
   IF has_table_privilege(r,tbl,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'FAIL: % holds a privilege on %',r,tbl; END IF;
  END LOOP;
  IF (SELECT array_agg(tgname||':'||tgtype ORDER BY tgname) FROM pg_trigger WHERE tgrelid=tbl::regclass AND NOT tgisinternal AND tgenabled='O')
   IS DISTINCT FROM ARRAY['reception_validation_guard:27','reception_validation_truncate:34'] THEN RAISE EXCEPTION 'FAIL: guards of %',tbl; END IF;
 END LOOP;
 -- RESTRICT keys to the client, the team member, the message, the validation and the dossier; none to
 -- notification_outbox, whose plain TRUNCATE must keep reaching its retention guard (retention.sql, R13).
 IF (SELECT array_agg(confrelid::regclass::text ORDER BY confrelid::regclass::text) FROM pg_constraint
     WHERE contype='f' AND conrelid IN ('reception_validations'::regclass,'reception_validation_items'::regclass))
   IS DISTINCT FROM ARRAY['clients','colis','messages','profiles','reception_validations']
  OR EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND conrelid IN ('reception_validations'::regclass,'reception_validation_items'::regclass) AND confdeltype<>'r') THEN
  RAISE EXCEPTION 'FAIL: five RESTRICT keys expected'; END IF;
 FOREACH fn IN ARRAY ARRAY['list_pending_receptions(uuid)','validate_reception(uuid,jsonb,boolean,text,text,text,uuid)','list_arrival_notices(uuid,uuid,integer)'] LOOP
  IF NOT has_function_privilege('authenticated',fn,'EXECUTE') OR has_function_privilege('anon',fn,'EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid=fn::regprocedure AND a.grantee=0)
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid=fn::regprocedure) THEN
   RAISE EXCEPTION 'FAIL: command grants or security %',fn; END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['_reception_validation_append_only()','_reception_validation_truncate()','_reception_validation_number(jsonb)',
  '_reception_validation_received_at(jsonb)','_reception_validation_carton(colis,integer)','_reception_validation_pending(colis)',
  '_reception_validation_items(reception_validations)','_reception_validation_result(reception_validations,boolean)'] LOOP
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE')
   OR (SELECT proacl IS NULL OR EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0) FROM pg_proc WHERE oid=fn::regprocedure)
   OR NOT (SELECT proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid=fn::regprocedure) THEN RAISE EXCEPTION 'FAIL: private helper %',fn; END IF;
 END LOOP;
 -- The retention release counts these exactly; nothing is added on messages nor notification_outbox.
 IF (SELECT count(*) FROM pg_trigger WHERE tgname='retention_guard' AND NOT tgisinternal)<>16
  OR (SELECT count(*) FROM pg_trigger WHERE tgname='retention_truncate' AND NOT tgisinternal)<>14 THEN RAISE EXCEPTION 'FAIL: retention trigger counts'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid IN ('messages'::regclass,'notification_outbox'::regclass)
   AND (p.proname LIKE '%reception_validation%' OR t.tgname LIKE '%reception_validation%')) THEN RAISE EXCEPTION 'FAIL: trigger on messages or outbox'; END IF;
 IF (SELECT count(*) FROM reception_validation_settings)<>1 OR NOT (SELECT started_at<=now() FROM reception_validation_settings) THEN
  RAISE EXCEPTION 'FAIL: one start point, set when the migration ran'; END IF;
 RAISE NOTICE 'PASS: R1 three append-only tables (RLS, no API privilege, RESTRICT keys), commands for authenticated only, private helpers, retention counts and message triggers unchanged, start point set';
END $$;

-- ── Fixtures: auth.users → staff_users → staff_permissions → clients → colis ──
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (rv_id('director'),'rv-director@example.test','{"nom":"Martin","prenom":"Alex"}'),
 (rv_id('receiver'),'rv-receiver@example.test','{"nom":"Réception seule"}'),
 (rv_id('viewer'),'rv-viewer@example.test','{"nom":"Sans réception"}'),
 (rv_id('client'),'rv-client@example.test','{"nom":"Payet","prenom":"Flavie"}'),
 (rv_id('telegram'),'rv-telegram@example.test','{"nom":"Telegram seul"}');
INSERT INTO staff_users(id,auth_id,nom,prenom,email,role,must_change_password) VALUES
 ('f1100000-0000-4000-8000-000000000001',rv_id('director'),'Martin','Alex','rv-director@example.test','directeur',false),
 ('f1100000-0000-4000-8000-000000000002',rv_id('receiver'),'Réception seule',NULL,'rv-receiver@example.test','preparateur',false),
 ('f1100000-0000-4000-8000-000000000003',rv_id('viewer'),'Sans réception',NULL,'rv-viewer@example.test','preparateur',false),
 ('f1100000-0000-4000-8000-000000000005',rv_id('telegram'),'Telegram seul',NULL,'rv-telegram@example.test','preparateur',false);
INSERT INTO staff_permissions(staff_id,perm_colis_receptionner,perm_comm_telegram,perm_comm_email) VALUES
 ('f1100000-0000-4000-8000-000000000002',true,false,false),
 ('f1100000-0000-4000-8000-000000000003',false,true,true),
 ('f1100000-0000-4000-8000-000000000005',true,true,false);
-- A: Telegram linked (and an e-mail); B: e-mail only; C: no contact (a blank chat is not a link); D: Telegram.
INSERT INTO clients(id,user_id,nom,prenom,cp,type,email,telegram_chat_id) VALUES
 (rv_id('A'),rv_id('client'),'Payet','Flavie','97400','particulier','flavie@example.test','CHAT-RV-A'),
 (rv_id('B'),NULL,'Hoarau','Marc','97400','particulier','marc@example.test',NULL),
 (rv_id('C'),NULL,'Grondin','Lucie','97400','particulier','  ','  '),
 (rv_id('D'),NULL,'Técher','Paul','97600','pro',NULL,'CHAT-RV-D');
-- A dossier entered as the team enters it, then dated ten days before the start point (fixture only: a stamped date is
-- otherwise never rewritten, so it is set with triggers off). Its carton is history.
SELECT rv_as('director');
INSERT INTO colis(id,client_id,ref,statut,nb_colis,trackings_detail,dims_par_colis,casier) VALUES
 (rv_id('A_OLD'),rv_id('A'),'EXP-RV-A-OLD','mesure',1,'[{"number":"OLD-1","fournisseur":"Amazon"}]','[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','A1');
SELECT rv_as('owner');
SET LOCAL session_replication_role='replica';
UPDATE colis SET reception_dates=jsonb_build_array(jsonb_build_object('receivedAt',now()-interval '10 days','source','server')) WHERE id=rv_id('A_OLD');
SET LOCAL session_replication_role='origin';
SELECT rv_as('director');
INSERT INTO colis(id,client_id,ref,statut,nb_colis,trackings_detail,dims_par_colis,casier) VALUES
 (rv_id('A_NEW'),rv_id('A'),'EXP-RV-A-NEW','mesure',2,'[{"number":"NEW-1","fournisseur":"Cdiscount"},{"number":"","fournisseur":""}]',
  '[{"dimL":30,"dimW":20,"dimH":10,"poids":2.5},{"dimL":20,"dimW":20,"dimH":20,"poids":1}]','A2'),
 (rv_id('B1'),rv_id('B'),'EXP-RV-B1','mesure',1,'[{"number":"B1-1","fournisseur":"Fnac"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','B1'),
 (rv_id('C1'),rv_id('C'),'EXP-RV-C1','mesure',1,'[{"number":"C1-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','C1'),
 (rv_id('D1'),rv_id('D'),'EXP-RV-D1','mesure',1,'[{"number":"D1-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','D1'),
 (rv_id('A_ARCH'),rv_id('A'),'EXP-RV-A-ARCH','mesure',1,'[{"number":"ARCH-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','A3'),
 (rv_id('A_CANC'),rv_id('A'),'EXP-RV-A-CANC','mesure',1,'[{"number":"CANC-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','A4'),
 (rv_id('B2'),rv_id('B'),'EXP-RV-B2','mesure',1,'[{"number":"B2-1","fournisseur":"Darty"}]','[{"dimL":12,"dimW":12,"dimH":12,"poids":2}]','B2'),
 (rv_id('PARTIAL'),rv_id('D'),'EXP-RV-PARTIAL','mesure',3,'[{"number":"P-1"},{"number":"P-2"},{"number":"P-3"}]',
  '[{"dimL":10,"dimW":10,"dimH":10,"poids":1},{"dimL":11,"dimW":11,"dimH":11,"poids":1},{"dimL":12,"dimW":12,"dimH":12,"poids":1}]','D2');
-- A dossier inserted by the owner (an import): no stamped arrival date. Its reception date, rebuilt at reading, falls
-- after the start point; it is never pending all the same.
SELECT rv_as('owner');
INSERT INTO colis(id,client_id,ref,statut,nb_colis,trackings_detail,dims_par_colis,date_reception) VALUES
 (rv_id('LEGACY'),rv_id('A'),'EXP-RV-LEGACY','mesure',1,'[{"number":"LEG-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]',now());
UPDATE colis SET archive=true WHERE id=rv_id('A_ARCH');
UPDATE colis SET statut='annule' WHERE id=rv_id('A_CANC');
-- A second carton for the historical dossier, through the existing command.
SELECT rv_as('director');
SELECT append_reception_cartons(id,'[{"tracking":"OLD-2","fournisseur":"Zalando","dimL":25,"dimW":25,"dimH":25,"poids":3}]',updated_at,NULL,NULL,NULL,'f1400000-0000-4000-8000-000000000001')
 FROM colis WHERE id=rv_id('A_OLD');

-- ── R2. Pending cartons ──
SELECT rv_assert(rv_pending_refs(rv_id('A'))='["EXP-RV-A-NEW","EXP-RV-A-OLD"]','client A: the new dossier and the appended carton, the longest waiting first; archived, cancelled and imported dossiers never pending');
SELECT rv_assert((SELECT (e->>'firstCarton')::integer=2 AND (e->>'lastCarton')::integer=2 AND (e->>'cartonCount')::integer=1
  AND jsonb_array_length(e->'cartons')=1 AND e->'cartons'->0->>'number'='OLD-2' AND e->'cartons'->0->>'fournisseur'='Zalando'
  AND (e->'cartons'->0->>'poids')::numeric=3 AND e->'cartons'->0->'receivedAt'=c.reception_dates->1->'receivedAt'
  FROM rv_pending('EXP-RV-A-OLD') e JOIN colis c ON c.id=rv_id('A_OLD')),
 'a carton received before the start point is never pending; the carton appended by append_reception_cartons is');
SELECT rv_assert((SELECT e->>'colisId'=rv_id('A_NEW')::text AND e->>'clientId'=rv_id('A')::text AND e->>'statut'='mesure' AND e->>'casier'='A2'
  AND (e->>'firstCarton')::integer=1 AND (e->>'lastCarton')::integer=2 AND (e->>'cartonCount')::integer=2
  AND e->'cartons'->0=jsonb_build_object('carton',1,'number','NEW-1','fournisseur','Cdiscount','dimL',30,'dimW',20,'dimH',10,'poids',2.5,'receivedAt',c.reception_dates->0->'receivedAt')
  AND e->'cartons'->1=jsonb_build_object('carton',2,'number',NULL,'fournisseur',NULL,'dimL',20,'dimW',20,'dimH',20,'poids',1,'receivedAt',c.reception_dates->1->'receivedAt')
  AND e->'receivedFrom'=c.reception_dates->0->'receivedAt' AND e->'receivedTo'=c.reception_dates->1->'receivedAt'
  FROM rv_pending('EXP-RV-A-NEW') e JOIN colis c ON c.id=rv_id('A_NEW')),
 'a new dossier entered by the team is pending: every carton with its number, vendor, measures and stamped arrival');
SELECT rv_assert((SELECT reception_dates#>>'{0,source}'='initial_receipt' AND (reception_dates#>>'{0,receivedAt}')::timestamptz=now()
  FROM get_reception_dates(ARRAY[rv_id('LEGACY')])) AND rv_pending('EXP-RV-LEGACY') IS NULL,
 'a date only rebuilt at reading, even after the start point, never makes a carton pending');
SELECT rv_assert((SELECT jsonb_agg(r ORDER BY r) FROM jsonb_array_elements_text(rv_pending_refs()) r)
  ='["EXP-RV-A-NEW","EXP-RV-A-OLD","EXP-RV-B1","EXP-RV-B2","EXP-RV-C1","EXP-RV-D1","EXP-RV-PARTIAL"]','without a client, every pending dossier');
SELECT rv_as('viewer');
SELECT rv_assert(rv_pending_refs(rv_id('B'))='["EXP-RV-B1","EXP-RV-B2"]','any team member reads the pending receptions');

-- ── R3. Refusals (nothing is recorded) ──
SELECT rv_reject($q$SELECT validate_reception(rv_id('B'),jsonb_build_array(rv_item('B1',1)),false)$q$,'team member without the reception permission','42501','Permission réception requise pour valider une réception.');
SELECT rv_as('client');
SELECT rv_reject($q$SELECT list_pending_receptions()$q$,'client: pending receptions','42501');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),false)$q$,'client: validation','42501');
SELECT rv_reject($q$SELECT list_arrival_notices(rv_id('A'))$q$,'client: arrival notices','42501');
SELECT rv_as('service');
SELECT rv_reject($q$SELECT list_pending_receptions()$q$,'service key without a team member: pending receptions','42501');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),false)$q$,'service key: validation','42501');
SELECT rv_reject($q$SELECT list_arrival_notices()$q$,'service key: arrival notices','42501');
SELECT rv_as('anon');
SELECT rv_reject($q$SELECT list_pending_receptions()$q$,'anonymous: pending receptions','42501');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),false)$q$,'anonymous: validation','42501');
SELECT rv_reject($q$SELECT list_arrival_notices()$q$,'anonymous: arrival notices','42501');
SELECT rv_as('director');
SELECT rv_reject($q$SELECT * FROM reception_validations$q$,'validations are not readable directly','42501');
SELECT rv_reject($q$SELECT * FROM reception_validation_items$q$,'validated cartons are not readable directly','42501');
SELECT rv_reject($q$SELECT * FROM reception_validation_settings$q$,'the start point is not readable directly','42501');
SELECT rv_reject($q$INSERT INTO reception_validations(request_id,client_id,actor_id,notify,cartons,request_payload) VALUES(gen_random_uuid(),rv_id('A'),rv_id('director'),false,'[{}]','{}')$q$,'a validation is not written directly','42501');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),false,NULL,NULL,NULL,NULL)$q$,'request identifier required','22023');
SELECT rv_reject($q$SELECT validate_reception(NULL,jsonb_build_array(rv_item('A_NEW',2)),false)$q$,'client required','22023');
SELECT rv_reject($q$SELECT validate_reception(gen_random_uuid(),jsonb_build_array(rv_item('A_NEW',2)),false)$q$,'unknown client','22023','Client introuvable.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),NULL)$q$,'notify must be stated','22023');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),'[]',false)$q$,'at least one dossier','22023','Validez de 1 à 20 dossiers à la fois.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),(SELECT jsonb_agg(jsonb_build_object('colisId',gen_random_uuid(),'throughCarton',1)) FROM generate_series(1,21)),false)$q$,'at most 20 dossiers','22023','Validez de 1 à 20 dossiers à la fois.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),rv_item('A_NEW',2),false)$q$,'items form an array','22023');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2),rv_item('A_NEW',1)),false)$q$,'a dossier appears once','22023','Un dossier ne figure qu’une fois dans une validation.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(jsonb_build_object('colisId',rv_id('A_NEW'),'throughCarton','2')),false)$q$,'throughCarton is a number','22023');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',0)),false)$q$,'throughCarton is positive','22023');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),'[{"colisId":"EXP-RV-A-NEW","throughCarton":2}]',false)$q$,'colisId is an identifier','22023');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('D1',1)),false)$q$,'dossier of another client','22023','Le dossier EXP-RV-D1 n’appartient pas à ce client.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_ARCH',1)),false)$q$,'archived dossier','22023','Le dossier EXP-RV-A-ARCH est archivé : sa réception ne se valide plus.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_CANC',1)),false)$q$,'cancelled dossier','22023','Le dossier EXP-RV-A-CANC est annulé : sa réception ne se valide plus.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('LEGACY',1)),false)$q$,'nothing pending','22023','Le dossier EXP-RV-LEGACY n’a aucun carton en attente de validation : actualisez la liste.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',3)),false)$q$,'throughCarton beyond the cartons','22023','Le carton n° 3 du dossier EXP-RV-A-NEW n’est pas en attente de validation : actualisez la liste.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_OLD',1)),false)$q$,'throughCarton before the start point','22023','Le carton n° 1 du dossier EXP-RV-A-OLD est déjà validé : actualisez la liste.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('C'),jsonb_build_array(rv_item('C1',1)),true,'email','arrivee_colis','Bonjour Lucie')$q$,'client without Telegram nor e-mail','22023','Ce client n’a ni Telegram ni e-mail : validez sans prévenir.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),true,'email','arrivee_colis','Bonjour Flavie')$q$,'channel no longer the server''s decision','40001','Le contact du client a changé : l’avis partira par Telegram. Actualisez avant de valider.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('B'),jsonb_build_array(rv_item('B1',1)),true,'telegram','arrivee_colis','Bonjour Marc')$q$,'Telegram unlinked: the e-mail is the channel','40001');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),true,'sms','arrivee_colis','Bonjour Flavie')$q$,'unknown channel','22023');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),true,NULL,'arrivee_colis','Bonjour Flavie')$q$,'a notice states its channel','22023');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),true,'telegram',NULL,'Bonjour Flavie')$q$,'a notice needs its template','22023');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),true,'telegram','demande_feu_vert','Bonjour Flavie')$q$,'only the arrival templates','22023');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),true,'telegram','arrivee_colis','   ')$q$,'a notice needs a text','22023','Le texte de l’avis d’arrivée doit contenir de 1 à 4096 caractères.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),true,'telegram','arrivee_colis',repeat('x',4097))$q$,'at most 4096 characters','22023');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),false,'telegram',NULL,NULL)$q$,'no channel, template nor text without notice','22023','Sans avis, ne transmettez ni canal, ni modèle, ni texte.');
SELECT rv_as('receiver');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),true,'telegram','arrivee_colis','Bonjour Flavie')$q$,'Telegram notice without the Telegram permission','42501','Permission communication requise pour prévenir le client par Telegram : validez sans prévenir ou confiez l’avis à un collègue.');
SELECT rv_as('telegram');
SELECT rv_reject($q$SELECT validate_reception(rv_id('B'),jsonb_build_array(rv_item('B1',1)),true,'email','arrivee_colis','Bonjour Marc')$q$,'e-mail notice without the e-mail permission','42501');
SELECT rv_assert(rv_count('SELECT count(*) FROM reception_validations')=0 AND rv_count('SELECT count(*) FROM reception_validation_items')=0
  AND rv_count($c$SELECT count(*) FROM messages WHERE template LIKE 'arrivee%'$c$)=0 AND rv_count($c$SELECT count(*) FROM audit_actions WHERE action='reception_validated'$c$)=0,
 'every refusal leaves no validation, message or journal entry');

-- ── R4. Validation without notice (reception permission only) ──
SELECT rv_as('receiver');
SELECT set_config('rv.revisions',rv_revisions()::text,true);
SELECT set_config('rv.silent',validate_reception(rv_id('B'),jsonb_build_array(rv_item('B1',1)),false,NULL,NULL,NULL,'f1500000-0000-4000-8000-000000000001')::text,true);
SELECT rv_assert((SELECT r->'validation'->>'clientId'=rv_id('B')::text AND r->'validation'->>'requestId'='f1500000-0000-4000-8000-000000000001'
  AND r->'validation'->'notify'='false' AND r->'validation'->'canal'='null' AND r->'validation'->'template'='null'
  AND r->'validation'->'items'=jsonb_build_array(jsonb_build_object('colisId',rv_id('B1'),'ref','EXP-RV-B1','firstCarton',1,'lastCarton',1))
  AND r->'validation'->'cartons'=jsonb_build_array(jsonb_build_object('colisId',rv_id('B1'),'ref','EXP-RV-B1','carton',1,'number','B1-1','fournisseur','Fnac',
   'dimL',10,'dimW',10,'dimH',10,'poids',1,'receivedAt',(SELECT reception_dates->0->'receivedAt' FROM colis WHERE id=rv_id('B1'))))
  AND r->'message'='null' AND r->'outbox'='null' AND r->'reused'='false' AND r->'validation'->>'createdAt' IS NOT NULL
  FROM (SELECT current_setting('rv.silent')::jsonb r) x),'validation without notice: recorded with its cartons, no message, no delivery');
SELECT rv_assert(rv_revisions()=current_setting('rv.revisions')::jsonb,'a validation writes no dossier: every revision unchanged');
SELECT rv_assert(rv_pending_refs(rv_id('B'))='["EXP-RV-B2"]','the validated dossier is no longer pending');
SELECT rv_assert(rv_count($c$SELECT count(*) FROM reception_validations WHERE NOT notify AND canal IS NULL AND message_id IS NULL AND outbox_id IS NULL AND actor_id='f1000000-0000-4000-8000-000000000002'$c$)=1
  AND rv_count($c$SELECT count(*) FROM reception_validation_items WHERE colis_id='f1300000-0000-4000-8000-000000000003' AND first_carton=1 AND last_carton=1$c$)=1
  AND rv_count($c$SELECT count(*) FROM audit_actions WHERE colis_id='f1300000-0000-4000-8000-000000000003' AND action='reception_validated' AND user_id='f1000000-0000-4000-8000-000000000002'
   AND user_nom='Réception seule' AND (detail::jsonb->>'lastCarton')::integer=1 AND (detail::jsonb->>'notify')::boolean=false AND jsonb_array_length(after_data->'cartons')=1$c$)=1
  AND rv_count($c$SELECT count(*) FROM messages WHERE colis_id='f1300000-0000-4000-8000-000000000003'$c$)=0,
 'the record, its carton range and one journal entry per dossier (reception_validated)');

-- ── R5. Telegram notice for two dossiers of one client, one message ──
SELECT rv_as('director');
SELECT set_config('rv.revisions',rv_revisions()::text,true);
SELECT set_config('rv.text',E'Bonjour Flavie 👋\nVos 3 colis sont arrivés à notre entrepôt.\nL’équipe Expedîle',true);
SELECT set_config('rv.telegram',validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2),rv_item('A_OLD',2)),true,'telegram','arrivee_colis',
 current_setting('rv.text'),'f1500000-0000-4000-8000-000000000002')::text,true);
SELECT rv_assert((SELECT r->'validation'->>'canal'='telegram' AND r->'validation'->>'template'='arrivee_colis' AND r->'validation'->'notify'='true' AND r->'reused'='false'
  AND r->'validation'->'items'=jsonb_build_array(jsonb_build_object('colisId',rv_id('A_NEW'),'ref','EXP-RV-A-NEW','firstCarton',1,'lastCarton',2),
   jsonb_build_object('colisId',rv_id('A_OLD'),'ref','EXP-RV-A-OLD','firstCarton',2,'lastCarton',2))
  AND (SELECT jsonb_agg(jsonb_build_array(c->>'ref',c->'carton')) FROM jsonb_array_elements(r->'validation'->'cartons') c)
   ='[["EXP-RV-A-NEW",1],["EXP-RV-A-NEW",2],["EXP-RV-A-OLD",2]]'::jsonb
  FROM (SELECT current_setting('rv.telegram')::jsonb r) x),'one validation covers both dossiers, cartons in the order of the request');
SELECT rv_assert((SELECT r->'message'->>'colis_id'=rv_id('A_NEW')::text AND r->'message'->>'template'='arrivee_colis' AND r->'message'->>'canal'='telegram'
  AND r->'message'->>'statut'='envoi' AND r->'message'->>'type'='staff' AND r->'message'->>'texte'=current_setting('rv.text') AND r->'message'->>'auteur_id'=rv_id('director')::text
  AND r->'outbox'->>'status'='pending' AND r->'outbox'->>'canal'='telegram' AND r->'outbox'->>'idempotency_key'='arrival:'||(r->'validation'->>'id')
  AND r->'outbox'->>'message_id'=r->'message'->>'id' AND r->'outbox'->>'client_id'=rv_id('A')::text AND r->'outbox'->>'colis_id'=rv_id('A_NEW')::text
  FROM (SELECT current_setting('rv.telegram')::jsonb r) x),'the notice is queued by queue_message on the first dossier: Telegram pending, template and key arrival:<id>');
SELECT rv_assert(rv_count($c$SELECT count(*) FROM messages WHERE template='arrivee_colis'$c$)=1 AND rv_count($c$SELECT count(*) FROM notification_outbox WHERE idempotency_key LIKE 'arrival:%'$c$)=1
  AND rv_count(format($c$SELECT count(*) FROM reception_validations v JOIN messages m ON m.id=v.message_id JOIN notification_outbox o ON o.id=v.outbox_id WHERE v.id=%L$c$,
   current_setting('rv.telegram')::jsonb->'validation'->>'id'))=1
  AND rv_count($c$SELECT count(*) FROM audit_actions WHERE action='reception_validated' AND colis_id IN ('f1300000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000002') AND user_nom='Alex Martin'$c$)=2
  AND rv_count($c$SELECT count(*) FROM notifications WHERE user_id='f1000000-0000-4000-8000-000000000004' AND titre='Un message pour EXP-RV-A-NEW' AND type='message'$c$)=1,
 'one message and one delivery for the whole reception, linked to the record; one journal entry per dossier; the client''s portal notification');
SELECT rv_assert(rv_revisions()=current_setting('rv.revisions')::jsonb,'a notice writes no dossier either: every revision unchanged');
SELECT rv_assert(rv_pending_refs(rv_id('A'))='[]','client A has nothing left to validate');
-- The replay of a lost response: the recorded result, the message and delivery as they are now; nothing added.
SELECT rv_assert((SELECT r->'reused'='true' AND r->'validation'=t->'validation' AND r->'message'=t->'message' AND r->'outbox'=t->'outbox'
  FROM (SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2),rv_item('A_OLD',2)),true,'telegram','arrivee_colis',current_setting('rv.text'),
   'f1500000-0000-4000-8000-000000000002') r,current_setting('rv.telegram')::jsonb t) x)
  AND rv_count($c$SELECT count(*) FROM messages WHERE template='arrivee_colis'$c$)=1 AND rv_count('SELECT count(*) FROM reception_validations')=2,
 'the same request again returns the recorded validation (reused) and sends nothing more');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2),rv_item('A_OLD',2)),true,'telegram','arrivee_colis','Un autre texte','f1500000-0000-4000-8000-000000000002')$q$,
 'the same request identifier with another content','40001','Cette validation a déjà été enregistrée avec un autre contenu. Actualisez la liste avant de continuer.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('B'),jsonb_build_array(rv_item('B2',1)),false,NULL,NULL,NULL,'f1500000-0000-4000-8000-000000000002')$q$,'the same request identifier for other dossiers','40001');
SELECT rv_as('telegram');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2),rv_item('A_OLD',2)),true,'telegram','arrivee_colis',current_setting('rv.text'),'f1500000-0000-4000-8000-000000000002')$q$,
 'the same request replayed by a colleague','40001');

-- ── R6. E-mail notice: kept to send by hand until an e-mail provider is connected ──
SELECT rv_as('director');
SELECT set_config('rv.email',validate_reception(rv_id('B'),jsonb_build_array(rv_item('B2',1)),true,'email','arrivee_colis_facture',
 E'Bonjour Marc,\nvotre colis est arrivé. Envoyez-nous sa facture d’achat.\nL’équipe Expedîle','f1500000-0000-4000-8000-000000000003')::text,true);
SELECT rv_assert((SELECT r->'validation'->>'canal'='email' AND r->'validation'->>'template'='arrivee_colis_facture' AND r->'message'->>'canal'='email'
  AND r->'message'->>'template'='arrivee_colis_facture' AND r->'message'->>'colis_id'=rv_id('B2')::text AND r->'outbox'->>'status'='manual'
  AND r->'outbox'->>'idempotency_key'='arrival:'||(r->'validation'->>'id')
  FROM (SELECT current_setting('rv.email')::jsonb r) x),'e-mail notice: queued manual, with the invoice variant');

-- ── R7. Partial validation; a carton added meanwhile by a colleague stays pending ──
SELECT validate_reception(rv_id('D'),jsonb_build_array(rv_item('PARTIAL',1)),false,NULL,NULL,NULL,'f1500000-0000-4000-8000-000000000004');
SELECT rv_assert((SELECT (e->>'firstCarton')::integer=2 AND (e->>'lastCarton')::integer=3 AND (e->>'cartonCount')::integer=2 FROM rv_pending('EXP-RV-PARTIAL') e),
 'validating through carton 1 leaves cartons 2 and 3 pending');
-- The screen still shows cartons 2 and 3 while a colleague adds carton 4.
SELECT append_reception_cartons(id,'[{"tracking":"P-4","dimL":13,"dimW":13,"dimH":13,"poids":2}]',updated_at,NULL,NULL,NULL,'f1400000-0000-4000-8000-000000000002')
 FROM colis WHERE id=rv_id('PARTIAL');
SELECT set_config('rv.partial',validate_reception(rv_id('D'),jsonb_build_array(rv_item('PARTIAL',3)),true,'telegram','arrivee_colis','Bonjour Paul, 2 colis sont arrivés.',
 'f1500000-0000-4000-8000-000000000005')::text,true);
SELECT rv_assert((SELECT r->'validation'->'items'=jsonb_build_array(jsonb_build_object('colisId',rv_id('PARTIAL'),'ref','EXP-RV-PARTIAL','firstCarton',2,'lastCarton',3))
  AND jsonb_array_length(r->'validation'->'cartons')=2 FROM (SELECT current_setting('rv.partial')::jsonb r) x)
  AND (SELECT (e->>'firstCarton')::integer=4 AND (e->>'lastCarton')::integer=4 AND e->'cartons'->0->>'number'='P-4' FROM rv_pending('EXP-RV-PARTIAL') e)
  AND rv_pending_refs(rv_id('D'))='["EXP-RV-D1","EXP-RV-PARTIAL"]',
 'the next validation starts after the last validated carton; the carton added meanwhile stays pending');
SELECT rv_reject($q$SELECT validate_reception(rv_id('D'),jsonb_build_array(rv_item('PARTIAL',3)),false)$q$,'a carton already validated','22023','Le carton n° 3 du dossier EXP-RV-PARTIAL est déjà validé : actualisez la liste.');
SELECT rv_reject($q$SELECT validate_reception(rv_id('D'),jsonb_build_array(rv_item('PARTIAL',5)),false)$q$,'a carton not received','22023');
SELECT rv_assert(rv_count($c$SELECT count(*) FROM reception_validation_items WHERE colis_id='f1300000-0000-4000-8000-000000000010'$c$)=2
  AND rv_count($c$SELECT count(*) FROM reception_validation_items WHERE colis_id='f1300000-0000-4000-8000-000000000010' AND (first_carton,last_carton) IN ((1,1),(2,3))$c$)=2,
 'two disjoint ranges recorded for the dossier');
-- A carton added after a full validation: only the new one waits.
SELECT append_reception_cartons(id,'[{"tracking":"NEW-3","fournisseur":"Shein","dimL":15,"dimW":15,"dimH":15,"poids":1}]',updated_at,NULL,NULL,NULL,'f1400000-0000-4000-8000-000000000003')
 FROM colis WHERE id=rv_id('A_NEW');
SELECT rv_assert(rv_pending_refs(rv_id('A'))='["EXP-RV-A-NEW"]' AND (SELECT (e->>'firstCarton')::integer=3 AND (e->>'cartonCount')::integer=1 AND e->'cartons'->0->>'fournisseur'='Shein'
  FROM rv_pending('EXP-RV-A-NEW') e),'after a validation, a carton appended by append_reception_cartons is the only one pending');
SELECT rv_reject($q$SELECT validate_reception(rv_id('A'),jsonb_build_array(rv_item('A_NEW',2)),false)$q$,'the cartons of the previous reception are validated','22023','Le carton n° 2 du dossier EXP-RV-A-NEW est déjà validé : actualisez la liste.');

-- ── R8. Arrival notices with their delivery state ──
SELECT set_config('rv.notices',list_arrival_notices(rv_id('A'))::text,true);
SELECT rv_assert((SELECT jsonb_array_length(n)=1 AND n->0->>'id'=t->'validation'->>'id' AND n->0->>'clientId'=rv_id('A')::text
  AND n->0->'client'='{"nom":"Payet","prenom":"Flavie"}' AND n->0->'actor'='{"nom":"Alex Martin"}' AND n->0->'notify'='true'
  AND n->0->>'canal'='telegram' AND n->0->>'template'='arrivee_colis' AND n->0->'items'=t->'validation'->'items' AND n->0->'cartons'=t->'validation'->'cartons'
  AND n->0->'message'=jsonb_build_object('id',t->'message'->'id','statut','envoi','texte',current_setting('rv.text'),'createdAt',t->'message'->'created_at')
  AND n->0->'outbox'=jsonb_build_object('id',t->'outbox'->'id','status','pending','attempts',0,'sentAt',NULL,'lastError',NULL)
  AND n->0->>'createdAt'=t->'validation'->>'createdAt'
  FROM (SELECT current_setting('rv.notices')::jsonb n,current_setting('rv.telegram')::jsonb t) x),'the notice, its text and its delivery waiting to be sent');
-- Telegram confirms the first notice, the second one fails (the delivery state is written by the sending itself).
SELECT rv_as('owner');
UPDATE notification_outbox SET status='sent',sent_at=now(),attempts=1 WHERE id=(current_setting('rv.telegram')::jsonb->'outbox'->>'id')::uuid;
UPDATE messages SET statut='envoye',telegram_msg_id='42' WHERE id=(current_setting('rv.telegram')::jsonb->'message'->>'id')::uuid;
UPDATE notification_outbox SET status='failed',attempts=1,last_error='Telegram : chat introuvable' WHERE id=(current_setting('rv.partial')::jsonb->'outbox'->>'id')::uuid;
UPDATE messages SET statut='echec' WHERE id=(current_setting('rv.partial')::jsonb->'message'->>'id')::uuid;
SELECT rv_as('viewer');
SELECT rv_assert((SELECT n->0->'outbox'->>'status'='sent' AND (n->0->'outbox'->>'attempts')::integer=1 AND n->0->'outbox'->>'sentAt' IS NOT NULL
  AND n->0->'message'->>'statut'='envoye' FROM (SELECT list_arrival_notices(rv_id('A')) n) x),'a confirmed delivery reads as sent, with its date');
SELECT rv_assert((SELECT jsonb_array_length(n)=2 AND n->0->'outbox'->>'status'='failed' AND n->0->'outbox'->>'lastError'='Telegram : chat introuvable'
  AND n->0->'message'->>'statut'='echec' AND n->1->'notify'='false' AND n->1->'message'='null' AND n->1->'outbox'='null'
  FROM (SELECT list_arrival_notices(rv_id('D')) n) x),'a failed delivery keeps its reason; a validation without notice reads as such, newest first');
SELECT rv_assert((SELECT jsonb_array_length(n)=1 AND n->0->>'id'=(current_setting('rv.silent')::jsonb->'validation'->>'id') FROM (SELECT list_arrival_notices(NULL,rv_id('B1')) n) x)
  AND (SELECT jsonb_array_length(n)=1 AND n->0->'outbox'->>'status'='manual' FROM (SELECT list_arrival_notices(NULL,rv_id('B2')) n) x)
  AND (SELECT jsonb_array_length(n)=2 FROM (SELECT list_arrival_notices(NULL,rv_id('PARTIAL')) n) x)
  AND (SELECT jsonb_array_length(n)=0 FROM (SELECT list_arrival_notices(rv_id('C')) n) x),'filtered by dossier or by client');
SELECT rv_assert((SELECT jsonb_array_length(n)=5 AND (SELECT bool_and((n->(i-1)->>'createdAt')::timestamptz>=(n->i->>'createdAt')::timestamptz) FROM generate_series(1,4) i)
  AND n->0->>'id'=(current_setting('rv.partial')::jsonb->'validation'->>'id') FROM (SELECT list_arrival_notices() n) x)
  AND jsonb_array_length(list_arrival_notices(NULL,NULL,1))=1,'every notice, most recent first, within the limit');
SELECT rv_reject($q$SELECT list_arrival_notices(NULL,NULL,0)$q$,'limit below 1','22023','Demandez de 1 à 200 avis d’arrivée.');
SELECT rv_reject($q$SELECT list_arrival_notices(NULL,NULL,201)$q$,'limit above 200','22023');

-- ── R9. Append-only record, for every role (the owner and SECURITY DEFINER commands included) ──
SELECT rv_as('owner');
SELECT rv_reject($q$UPDATE reception_validations SET notify=notify$q$,'a validation is not rewritten','23001',
 'Une réception validée est conservée telle quelle : elle ne se modifie pas et ne se supprime pas.','retention:reception_validations');
SELECT rv_reject($q$DELETE FROM reception_validations$q$,'a validation is not deleted','23001',NULL,'retention:reception_validations');
SELECT rv_reject($q$UPDATE reception_validation_items SET last_carton=last_carton$q$,'a validated range is not rewritten','23001',
 'Les cartons d’une réception validée sont conservés tels quels : ils ne se modifient pas et ne se suppriment pas.','retention:reception_validation_items');
SELECT rv_reject($q$DELETE FROM reception_validation_items$q$,'a validated range is not deleted','23001',NULL,'retention:reception_validation_items');
SELECT rv_reject($q$UPDATE reception_validation_settings SET started_at=now()$q$,'the start point is not moved','23001',
 'Le point de départ des réceptions à valider est fixé à la mise en service : il ne se modifie pas et ne se supprime pas.','retention:reception_validation_settings');
SELECT rv_reject($q$DELETE FROM reception_validation_settings$q$,'the start point is not deleted','23001',NULL,'retention:reception_validation_settings');
SELECT rv_reject($q$INSERT INTO reception_validation_settings(started_at) VALUES(now())$q$,'one start point only','23505');
SELECT rv_reject($q$TRUNCATE reception_validation_items$q$,'validated ranges are not emptied','23001',
 'L’historique « reception_validation_items » des réceptions validées est conservé : il ne peut pas être vidé.','retention:reception_validation_items');
SELECT rv_reject($q$TRUNCATE reception_validations CASCADE$q$,'validations are not emptied','23001');
SELECT rv_reject($q$TRUNCATE reception_validation_settings$q$,'the start point is not emptied','23001',NULL,'retention:reception_validation_settings');
SELECT rv_reject($q$DELETE FROM colis WHERE id=rv_id('B1')$q$,'a dossier with a validated reception keeps its history','23001',NULL,'retention:colis');
SELECT rv_assert(rv_count('SELECT count(*) FROM reception_validations')=5 AND rv_count('SELECT count(*) FROM reception_validation_items')=6,'the record is intact');

-- ── R10. A document sent in explicit reply to the notice that asks for the purchase invoice ──
-- register_telegram_document, redefined with one more case: an explicit reply to a delivered arrivee_colis_facture
-- notice while the dossier still requests an invoice (the condition of the feu_vert_recu_facture case).
DO $$
DECLARE fn regprocedure:='register_telegram_document(uuid,text,text)'::regprocedure; definition text:=pg_get_functiondef('register_telegram_document(uuid,text,text)'::regprocedure);
 marker text:='OR (request.template=''feu_vert_recu_facture'' AND p_reply_message_id IS NOT NULL AND (';
BEGIN
 PERFORM rv_assert(NOT has_function_privilege('anon',fn,'EXECUTE') AND NOT has_function_privilege('authenticated',fn,'EXECUTE') AND has_function_privilege('service_role',fn,'EXECUTE')
  AND (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
   AND proowner=(SELECT proowner FROM pg_proc WHERE oid='queue_message(uuid,text,text,text,jsonb,text,integer)'::regprocedure) FROM pg_proc WHERE oid=fn),
  'register_telegram_document keeps its owner, definer security, search path and service-only grant');
 PERFORM rv_assert((length(definition)-length(replace(definition,marker,'')))/length(marker)=1
  AND position('OR (request.template=''arrivee_colis_facture'' AND p_reply_message_id IS NOT NULL AND (' IN definition)>0
  AND position('request.template IN (''facture_manquante'',''demande_facture'')' IN definition)>0
  AND position('request.template=''demande_feu_vert'' AND request.request_snapshot->''invoice_requested''=''true''::jsonb' IN definition)>0
  AND position('AND coalesce(delivery.sent_at,request.created_at)>=incoming.created_at-interval ''7 days''' IN definition)>0,
  'one case added; the previous request cases, the marker lot 3b verifies and the seven-day rule are kept');
END $$;
-- A Telegram dossier whose notice (the given template and state) was sent two hours ago, and a client document
-- received now; returns the document message.
CREATE FUNCTION rv_notice_fixture(template_name text DEFAULT 'arrivee_colis_facture',request_status statut_message DEFAULT 'envoye') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE customer uuid; dossier uuid; document uuid:=gen_random_uuid();
BEGIN
 INSERT INTO clients(nom,prenom,cp,type,telegram_chat_id) VALUES('Avis test','Flavie','97400','particulier','rv-chat-'||document) RETURNING id INTO customer;
 INSERT INTO colis(client_id,ref,statut,nb_colis,trackings_detail,dims_par_colis)
 VALUES(customer,'EXP-RVN-'||left(document::text,8),'mesure',1,'[{"number":""}]','[{"dimL":20,"dimW":20,"dimH":20,"poids":2}]') RETURNING id INTO dossier;
 INSERT INTO messages(colis_id,type,canal,template,statut,texte,auteur_nom,telegram_msg_id,created_at)
 VALUES(dossier,'staff','telegram',template_name,request_status,'Bonjour Flavie, vos colis sont arrivés.','Martin','rv-notice-'||dossier,now()-interval '2 hours');
 INSERT INTO messages(id,colis_id,type,canal,texte,attachment_path,attachment_name,attachment_type,telegram_event_key,created_at)
 VALUES(document,dossier,'client','telegram','Document reçu',dossier||'/document.pdf','achat.pdf','application/pdf','rv-fixture:'||document,now());
 RETURN document;
END $$;
CREATE FUNCTION rv_document_dossier(document uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT colis_id FROM messages WHERE id=document $$;
CREATE FUNCTION rv_register(document uuid,reply text DEFAULT 'same') RETURNS jsonb LANGUAGE sql AS $$
 SELECT register_telegram_document(document,CASE WHEN reply='same' THEN 'rv-notice-'||rv_document_dossier(document) ELSE reply END,NULL) $$;
SELECT rv_as('owner');
SELECT set_config('request.jwt.claim.role','service_role',true);
-- Each registration is its own statement: the checks that follow see what it wrote.
DO $$
DECLARE document uuid; dossier uuid; other uuid; result jsonb; invoice factures;
BEGIN
 -- An explicit reply to the delivered notice while no invoice was received.
 document:=rv_notice_fixture(); dossier:=rv_document_dossier(document);
 result:=rv_register(document);
 SELECT * INTO invoice FROM factures WHERE id=(result->>'factureId')::uuid;
 PERFORM rv_assert(result->>'status'='registered' AND invoice.colis_id=dossier AND NOT invoice.valide AND invoice.montant=0 AND invoice.vendeur='Document à vérifier'
  AND invoice.fichier_url=dossier||'/document.pdf' AND invoice.fichier_nom='achat.pdf' AND invoice.telegram_event_key='rv-fixture:'||document,
  'a document replying to the notice that asks for the invoice is the requested invoice, to verify');
 PERFORM rv_assert((SELECT count(*)=1 FROM audit_actions WHERE colis_id=dossier AND action='telegram_requested_invoice'
  AND detail::jsonb->>'request_message_id'=(SELECT id::text FROM messages WHERE colis_id=dossier AND type='staff')
  AND detail::jsonb->>'reply_to_telegram_message_id'='rv-notice-'||dossier),'the journal links the invoice to the notice it answers');
 result:=rv_register(document);
 PERFORM rv_assert(result->>'factureId'=invoice.id::text AND (SELECT count(*)=1 FROM factures WHERE colis_id=dossier),'a repeated registration is idempotent');
 -- Not an explicit reply to this notice.
 document:=rv_notice_fixture();
 result:=rv_register(document,NULL);
 PERFORM rv_assert(result->>'status'='not_invoice' AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=rv_document_dossier(document)),
  'a document sent without replying to the notice is not taken as the invoice');
 document:=rv_notice_fixture(); other:=rv_document_dossier(rv_notice_fixture());
 result:=rv_register(document,'rv-unknown-message');
 PERFORM rv_assert(result->>'status'='not_invoice','a reply to another message is not the invoice');
 result:=rv_register(document,'rv-notice-'||other);
 PERFORM rv_assert(result->>'status'='not_invoice' AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=rv_document_dossier(document)),
  'a reply to the notice of another dossier is not the invoice');
 -- The dossier no longer requests an invoice.
 document:=rv_notice_fixture(); dossier:=rv_document_dossier(document);
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,created_at) VALUES(dossier,'Déposée dans l’espace client',0,false,dossier||'/portail.pdf',now()-interval '1 hour');
 result:=rv_register(document);
 PERFORM rv_assert(result->>'status'='not_invoice' AND (SELECT count(*)=1 FROM factures WHERE colis_id=dossier),
  'once an invoice is on file (even to verify), a reply to the notice is no longer the invoice');
 document:=rv_notice_fixture(); dossier:=rv_document_dossier(document);
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url) VALUES(dossier,'Facture validée',40,true,dossier||'/valide.pdf');
 result:=rv_register(document);
 PERFORM rv_assert(result->>'status'='not_invoice' AND (SELECT count(*)=1 FROM factures WHERE colis_id=dossier),'nor once a valid invoice is on file');
 document:=rv_notice_fixture(); dossier:=rv_document_dossier(document);
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,rejet_motif) VALUES(dossier,'Illisible',0,false,dossier||'/illisible.pdf','Document illisible');
 result:=rv_register(document);
 PERFORM rv_assert(result->>'status'='registered' AND (SELECT count(*)=2 FROM factures WHERE colis_id=dossier),'a rejected invoice keeps the request open');
 -- The notice without invoice line, and a notice Telegram never confirmed.
 document:=rv_notice_fixture('arrivee_colis');
 result:=rv_register(document);
 PERFORM rv_assert(result->>'status'='not_invoice' AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=rv_document_dossier(document)),
  'a reply to the notice without invoice line (arrivee_colis) stays a conversation document');
 document:=rv_notice_fixture(request_status=>'envoi');
 result:=rv_register(document);
 PERFORM rv_assert(result->>'status'='not_invoice' AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=rv_document_dossier(document)),
  'a notice not confirmed by Telegram is never answered');
END $$;
-- The real path: validate_reception stores the notice on the first dossier of the reception; once Telegram confirmed it,
-- a reply resolves to that dossier and the document registers there as the invoice.
INSERT INTO clients(id,nom,prenom,cp,type,telegram_chat_id) VALUES(rv_id('E'),'Lebon','Emma','97400','particulier','CHAT-RV-E');
SELECT rv_as('director');
INSERT INTO colis(id,client_id,ref,statut,nb_colis,trackings_detail,dims_par_colis) VALUES
 (rv_id('E1'),rv_id('E'),'EXP-RV-E1','mesure',1,'[{"number":"E1-1","fournisseur":"Amazon"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]'),
 (rv_id('E2'),rv_id('E'),'EXP-RV-E2','mesure',1,'[{"number":"E2-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]');
SELECT set_config('rv.invoice_notice',validate_reception(rv_id('E'),jsonb_build_array(rv_item('E1',1),rv_item('E2',1)),true,'telegram','arrivee_colis_facture',
 E'Bonjour Emma 👋\nVos 2 colis sont arrivés. Répondez à ce message avec leurs factures d’achat.\nL’équipe Expedîle','f1500000-0000-4000-8000-000000000007')::text,true);
SELECT rv_as('owner');
UPDATE messages SET statut='envoye',telegram_msg_id='rv-real-notice' WHERE id=(current_setting('rv.invoice_notice')::jsonb->'message'->>'id')::uuid;
UPDATE notification_outbox SET status='sent',sent_at=now(),attempts=1 WHERE id=(current_setting('rv.invoice_notice')::jsonb->'outbox'->>'id')::uuid;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT rv_assert(resolve_telegram_message_colis(rv_id('E'),'rv-real-notice',NULL)->>'id'=rv_id('E1')::text,'a reply to the notice resolves to the first dossier of the reception');
INSERT INTO messages(id,colis_id,type,canal,texte,attachment_path,attachment_name,attachment_type,telegram_event_key)
 VALUES('f1600000-0000-4000-8000-000000000001',rv_id('E1'),'client','telegram','Document reçu',rv_id('E1')||'/telegram_1.pdf','facture.pdf','application/pdf','rv-real:1');
SELECT set_config('rv.real_reply',register_telegram_document('f1600000-0000-4000-8000-000000000001','rv-real-notice',repeat('c',64))::text,true);
SELECT rv_assert((SELECT r->>'status'='registered' AND (SELECT colis_id=rv_id('E1') AND vendeur='Document à vérifier' AND NOT valide FROM factures WHERE id=(r->>'factureId')::uuid)
  FROM (SELECT current_setting('rv.real_reply')::jsonb r) x),
 'the document replying to the delivered notice is the requested invoice of that dossier');
ROLLBACK;
