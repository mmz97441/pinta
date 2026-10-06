-- Departure at any step (lot 3a, 2026-10-06): Wednesday 17 h closing, desired day, explicit departure creation,
-- consent precedence, relance window on the reception task, grants and client privacy.
-- Every refusal asserts its SQLSTATE (and message when the contract fixes it) and leaves the business rows unchanged.
BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
-- Function privileges of the release (this database has no default privileges, like production after the REVOKEs).
DO $$
DECLARE fn text;
BEGIN
 IF has_function_privilege('anon','departure_default_closing(date)','EXECUTE') OR NOT has_function_privilege('authenticated','departure_default_closing(date)','EXECUTE')
  OR (SELECT prosecdef OR provolatile<>'s' FROM pg_proc WHERE oid='departure_default_closing(date)'::regprocedure) THEN RAISE EXCEPTION 'FAIL: closing helper grants or volatility'; END IF;
 FOREACH fn IN ARRAY ARRAY['set_colis_departure_wish(uuid,date,timestamptz)','create_departure_for_colis(uuid,date,timestamptz)'] LOOP
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE') OR NOT has_function_privilege('authenticated',fn,'EXECUTE')
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid=fn::regprocedure) THEN RAISE EXCEPTION 'FAIL: staff command security %',fn; END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['_colis_destination(colis)','_departure_for_day(colis,date)','_colis_departure_closing(colis)','_consent_relance_open(timestamptz)','_reception_work_hint(colis)','guard_colis_departure_wish()'] LOOP
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE') THEN RAISE EXCEPTION 'FAIL: private helper executable %',fn; END IF;
 END LOOP;
 IF has_function_privilege('anon','assign_colis_departure(uuid,uuid,timestamptz)','EXECUTE') OR NOT has_function_privilege('authenticated','assign_colis_departure(uuid,uuid,timestamptz)','EXECUTE')
  OR has_function_privilege('anon','refresh_staff_work_actions()','EXECUTE') OR NOT has_function_privilege('authenticated','refresh_staff_work_actions()','EXECUTE')
  OR has_function_privilege('authenticated','_apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','sync_staff_work_actions(uuid)','EXECUTE') THEN RAISE EXCEPTION 'FAIL: replaced functions changed grants'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.colis'::regclass AND attname='depart_souhaite' AND atttypid='date'::regtype AND NOT attnotnull AND NOT attisdropped)
  OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='colis_depart_souhaite' AND indexdef LIKE '%(depart_souhaite)%WHERE (depart_souhaite IS NOT NULL)%')
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.client_colis'::regclass AND attname='depart_souhaite') THEN RAISE EXCEPTION 'FAIL: desired day column, index or client view'; END IF;
 RAISE NOTICE 'PASS: grants, private helpers, column, partial index and staff-only desired day';
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;

CREATE FUNCTION das_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
CREATE FUNCTION das_fingerprint() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM colis c),(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM envois e),
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_actions a),(SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM staff_work_actions w))
$$;
CREATE FUNCTION das_reject(command text,label text,code text DEFAULT '42501',expected_message text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_data jsonb:=das_fingerprint();
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>code THEN RAISE EXCEPTION 'FAIL wrong code % for %: %',SQLSTATE,label,SQLERRM; END IF;
  IF expected_message IS NOT NULL AND SQLERRM<>expected_message THEN RAISE EXCEPTION 'FAIL wrong message for %: %',label,SQLERRM; END IF;
  IF das_fingerprint()<>before_data THEN RAISE EXCEPTION 'FAIL % changed data',label; END IF;
  RAISE NOTICE 'PASS rejected: % [%]',label,SQLSTATE; RETURN;
 END;
 RAISE EXCEPTION 'FAIL accepted: %',label;
END $$;
CREATE FUNCTION das_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role',CASE who WHEN 'postgres' THEN '' WHEN 'anon' THEN 'anon' ELSE 'authenticated' END,true);
 PERFORM set_config('request.jwt.claim.sub',CASE who WHEN 'director' THEN 'da000000-0000-4000-8000-000000000001' WHEN 'affecteur' THEN 'da000000-0000-4000-8000-000000000002'
  WHEN 'reaffecteur' THEN 'da000000-0000-4000-8000-000000000003' WHEN 'createur' THEN 'da000000-0000-4000-8000-000000000004' WHEN 'logisticien' THEN 'da000000-0000-4000-8000-000000000005'
  WHEN 'preparateur' THEN 'da000000-0000-4000-8000-000000000006' WHEN 'client' THEN 'da000000-0000-4000-8000-000000000007' WHEN 'creation_seule' THEN 'da000000-0000-4000-8000-000000000008' ELSE '' END,true);
 IF who<>'postgres' THEN EXECUTE format('SET LOCAL ROLE %I',CASE who WHEN 'anon' THEN 'anon' ELSE 'authenticated' END); END IF;
END $$;
-- Paris calendar day relative to the transaction clock (now() is fixed inside this transaction).
CREATE FUNCTION das_day(n integer) RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Europe/Paris')::date+n $$;
CREATE FUNCTION das_reception(p_colis uuid) RETURNS staff_work_actions LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM staff_work_actions WHERE colis_id=p_colis AND kind='reception' $$;
CREATE FUNCTION das_version(p_colis uuid) RETURNS timestamptz LANGUAGE sql SECURITY DEFINER AS $$ SELECT updated_at FROM colis WHERE id=p_colis $$;
CREATE FUNCTION das_colis(p_colis uuid) RETURNS colis LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM colis WHERE id=p_colis $$;

-- ── S2. « Clôture mercredi 17 h », fixed dates including both daylight-saving weeks ──
SELECT das_assert(departure_default_closing('2026-10-22')='2026-10-21 15:00:00+00','S2 a Thursday departure closes the day before at 17:00 Paris (summer time)');
SELECT das_assert(departure_default_closing('2026-10-23')='2026-10-21 15:00:00+00','S2 a Friday departure closes two days before');
SELECT das_assert(departure_default_closing('2026-10-28')='2026-10-21 15:00:00+00','S2 a Wednesday departure closes seven days before');
SELECT das_assert(departure_default_closing('2026-10-25')='2026-10-21 15:00:00+00','S2 the autumn change Sunday closes on the summer-time Wednesday');
SELECT das_assert(departure_default_closing('2026-10-26')='2026-10-21 15:00:00+00','S2 the Monday after the autumn change keeps the summer-time Wednesday');
SELECT das_assert(departure_default_closing('2026-10-29')='2026-10-28 16:00:00+00','S2 after the autumn change, 17:00 Paris is 16:00 UTC');
SELECT das_assert(departure_default_closing('2026-03-26')='2026-03-25 16:00:00+00','S2 a Thursday in winter time closes at 16:00 UTC');
SELECT das_assert(departure_default_closing('2026-03-29')='2026-03-25 16:00:00+00','S2 the spring change Sunday closes on the winter-time Wednesday');
SELECT das_assert(departure_default_closing('2026-03-31')='2026-03-25 16:00:00+00','S2 the Tuesday after the spring change keeps the winter-time Wednesday');
SELECT das_assert(departure_default_closing('2026-04-02')='2026-04-01 15:00:00+00','S2 after the spring change, 17:00 Paris is 15:00 UTC');
SELECT das_assert(departure_default_closing(NULL) IS NULL,'S2 no day, no closing');
SELECT das_assert(bool_and(extract(isodow FROM departure_default_closing(d::date) AT TIME ZONE 'Europe/Paris')=3
  AND (departure_default_closing(d::date) AT TIME ZONE 'Europe/Paris')::time=time '17:00'
  AND d::date-(departure_default_closing(d::date) AT TIME ZONE 'Europe/Paris')::date BETWEEN 1 AND 7),'S2 every day of 2026-2027 closes on a Wednesday at 17:00 Paris, one to seven days before')
 FROM generate_series('2026-01-01'::date,'2027-12-31'::date,interval '1 day') d;

-- ── Fixtures ──
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('da000000-0000-4000-8000-000000000001','das-director@example.test','{"nom":"Direction DAS"}'),('da000000-0000-4000-8000-000000000002','das-affecteur@example.test','{"nom":"Affectation"}'),
 ('da000000-0000-4000-8000-000000000003','das-reaffecteur@example.test','{"nom":"Réaffectation"}'),('da000000-0000-4000-8000-000000000004','das-createur@example.test','{"nom":"Création et affectation"}'),
 ('da000000-0000-4000-8000-000000000005','das-logisticien@example.test','{"nom":"Logistique"}'),('da000000-0000-4000-8000-000000000006','das-preparateur@example.test','{"nom":"Préparation"}'),
 ('da000000-0000-4000-8000-000000000007','das-client@example.test','{"nom":"Flavie Payet"}'),('da000000-0000-4000-8000-000000000008','das-creation@example.test','{"nom":"Création seule"}');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('da100000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000001','Direction DAS','das-director@example.test','directeur',false),
 ('da100000-0000-4000-8000-000000000002','da000000-0000-4000-8000-000000000002','Affectation','das-affecteur@example.test','logisticien',false),
 ('da100000-0000-4000-8000-000000000003','da000000-0000-4000-8000-000000000003','Réaffectation','das-reaffecteur@example.test','logisticien',false),
 ('da100000-0000-4000-8000-000000000004','da000000-0000-4000-8000-000000000004','Création et affectation','das-createur@example.test','logisticien',false),
 ('da100000-0000-4000-8000-000000000005','da000000-0000-4000-8000-000000000005','Logistique','das-logisticien@example.test','logisticien',false),
 ('da100000-0000-4000-8000-000000000006','da000000-0000-4000-8000-000000000006','Préparation','das-preparateur@example.test','preparateur',false),
 ('da100000-0000-4000-8000-000000000008','da000000-0000-4000-8000-000000000008','Création seule','das-creation@example.test','logisticien',false);
INSERT INTO staff_permissions(staff_id,perm_envois_voir,perm_colis_affecter_envoi,perm_envois_reaffecter,perm_envois_creer,perm_colis_receptionner) VALUES
 ('da100000-0000-4000-8000-000000000002',true,true,false,false,false),('da100000-0000-4000-8000-000000000003',true,false,true,false,false),
 ('da100000-0000-4000-8000-000000000004',true,true,false,true,false),('da100000-0000-4000-8000-000000000005',true,true,true,true,true),
 ('da100000-0000-4000-8000-000000000006',true,false,false,false,true),('da100000-0000-4000-8000-000000000008',true,false,false,true,false);
INSERT INTO clients(id,user_id,nom,cp,email,type) VALUES
 ('da200000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000007','Flavie Payet','97400','das-client@example.test','particulier'),
 ('da200000-0000-4000-8000-000000000002',NULL,'Client Mayotte','97600','das-mayotte@example.test','particulier'),
 ('da200000-0000-4000-8000-000000000003',NULL,'Client métropole','75011','das-paris@example.test','particulier'),
 ('da200000-0000-4000-8000-000000000004',NULL,'Client déménagé','97100','das-moved@example.test','particulier');
-- Planned departures: E20/E30 planifie (the automatic pick takes E20); window departures are « pret » so the automatic pick ignores them.
INSERT INTO envois(id,destination_code,date_depart,statut,loading_closes_at) VALUES
 ('da400000-0000-4000-8000-000000000020','974',das_day(20),'planifie',NULL),
 ('da400000-0000-4000-8000-000000000030','974',das_day(30),'planifie',NULL),
 ('da400000-0000-4000-8000-000000000031','976',das_day(30),'planifie',NULL),
 ('da400000-0000-4000-8000-000000000035','974',das_day(35),'planifie',now()-interval '1 hour'),
 ('da400000-0000-4000-8000-000000000036','974',das_day(36),'planifie',NULL),
 ('da400000-0000-4000-8000-000000000040','974',das_day(40),'planifie',NULL),
 ('da400000-0000-4000-8000-000000000471','974',das_day(47),'planifie',now()-interval '1 hour'),
 ('da400000-0000-4000-8000-000000000472','974',das_day(47),'planifie',NULL),
 ('da400000-0000-4000-8000-000000000124','974',das_day(5),'pret',now()+interval '24 hours'),
 ('da400000-0000-4000-8000-000000000172','974',das_day(6),'pret',now()+interval '72 hours'),
 ('da400000-0000-4000-8000-000000000173','974',das_day(7),'pret',now()+interval '72 hours'),
 ('da400000-0000-4000-8000-000000000100','974',das_day(0),'pret',NULL),
 ('da400000-0000-4000-8000-000000000136','974',das_day(9),'pret',now()+interval '36 hours'),
 ('da400000-0000-4000-8000-000000000148','974',das_day(10),'pret',now()+interval '48 hours'),
 ('da400000-0000-4000-8000-000000000149','974',das_day(11),'pret',now()+interval '48 hours 1 minute');
UPDATE envois SET statut='archive' WHERE id='da400000-0000-4000-8000-000000000040';
-- E36 has left (its loading was confirmed): it takes no dossier any more, whatever its day.
SELECT set_config('expedile.confirm_departure','allowed',true);
UPDATE envois SET statut='parti',departed_at=now()-interval '1 hour',manifest_version=1 WHERE id='da400000-0000-4000-8000-000000000036';
SELECT set_config('expedile.confirm_departure','',true);
INSERT INTO colis(id,client_id,ref,statut) VALUES
 ('da300000-0000-4000-8000-000000000001','da200000-0000-4000-8000-000000000001','DAS-WISH','receptionne'),
 ('da300000-0000-4000-8000-000000000002','da200000-0000-4000-8000-000000000001','DAS-ASSIGN','mesure'),
 ('da300000-0000-4000-8000-000000000003','da200000-0000-4000-8000-000000000001','DAS-KEEP-WISH','mesure'),
 ('da300000-0000-4000-8000-000000000011','da200000-0000-4000-8000-000000000001','DAS-CREATE','receptionne'),
 ('da300000-0000-4000-8000-000000000012','da200000-0000-4000-8000-000000000001','DAS-CREATE-WISH','mesure'),
 ('da300000-0000-4000-8000-000000000013','da200000-0000-4000-8000-000000000001','DAS-REUSE','receptionne'),
 ('da300000-0000-4000-8000-000000000014','da200000-0000-4000-8000-000000000003','DAS-NO-DEST','receptionne'),
 ('da300000-0000-4000-8000-000000000015','da200000-0000-4000-8000-000000000001','DAS-ARCHIVED-DAY','receptionne'),
 ('da300000-0000-4000-8000-000000000017','da200000-0000-4000-8000-000000000001','DAS-DUPLICATE-DAY','receptionne'),
 ('da300000-0000-4000-8000-000000000061','da200000-0000-4000-8000-000000000001','DAS-WISH-TODAY','receptionne'),
 ('da300000-0000-4000-8000-000000000062','da200000-0000-4000-8000-000000000001','DAS-WISH-DEPARTED','mesure'),
 ('da300000-0000-4000-8000-000000000064','da200000-0000-4000-8000-000000000001','DAS-CLOSED-DAY','receptionne'),
 ('da300000-0000-4000-8000-000000000065','da200000-0000-4000-8000-000000000001','DAS-DEPARTED-DAY','receptionne'),
 ('da300000-0000-4000-8000-000000000066','da200000-0000-4000-8000-000000000002','DAS-MAYOTTE-TODAY','receptionne'),
 ('da300000-0000-4000-8000-000000000067','da200000-0000-4000-8000-000000000001','DAS-REUSE-TODAY','receptionne');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,archive) VALUES
 ('da300000-0000-4000-8000-000000000004','da200000-0000-4000-8000-000000000001','DAS-AFV','attente_feu_vert','en_attente',false),
 ('da300000-0000-4000-8000-000000000005','da200000-0000-4000-8000-000000000001','DAS-PREP','en_preparation','autorise',false),
 ('da300000-0000-4000-8000-000000000007','da200000-0000-4000-8000-000000000001','DAS-SHIPPED','expedie','autorise',false),
 ('da300000-0000-4000-8000-000000000008','da200000-0000-4000-8000-000000000001','DAS-CANCELLED','annule',NULL,false),
 ('da300000-0000-4000-8000-000000000009','da200000-0000-4000-8000-000000000001','DAS-ARCHIVED','receptionne',NULL,true);
INSERT INTO colis(id,client_id,ref,statut,feu_vert,fin_l,fin_w,fin_h,fin_p,outgoing_parcel_count,devis_total,devis_snapshot,paiement_montant,paiement_date) VALUES
 ('da300000-0000-4000-8000-000000000006','da200000-0000-4000-8000-000000000001','DAS-PAID','paye','autorise',20,20,20,2,1,20,'{"inputs":{"destination":{"code":"974"}}}',20,now()),
 ('da300000-0000-4000-8000-000000000016','da200000-0000-4000-8000-000000000004','DAS-PAID-MOVED','paye','autorise',20,20,20,2,1,20,'{"inputs":{"destination":{"code":"974"}}}',20,now()),
 ('da300000-0000-4000-8000-000000000063','da200000-0000-4000-8000-000000000004','DAS-PAID-MOVED-WISH','paye','autorise',20,20,20,2,1,20,'{"inputs":{"destination":{"code":"974"}}}',20,now());

-- ── S4. Desired day: permissions, version, statuses, dates, matching, unassignment, clearing ──
SELECT das_as('preparateur');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(25),das_version('da300000-0000-4000-8000-000000000001'))$q$,'S4 without the assignment permission','42501');
SELECT das_as('reaffecteur');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(25),das_version('da300000-0000-4000-8000-000000000001'))$q$,'S4 an unassigned dossier needs perm_colis_affecter_envoi','42501');
SELECT das_as('client');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(25),'2000-01-01')$q$,'S4 a client cannot choose the departure','42501');
SELECT das_as('anon');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(25),'2000-01-01')$q$,'S4 anonymous calls are refused','42501');
SELECT das_as('affecteur');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(25),'2000-01-01')$q$,'S4 stale version','40001','Le dossier a changé. Actualisez avant de réessayer.');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(25),NULL)$q$,'S4 the version is mandatory','40001');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(-1),das_version('da300000-0000-4000-8000-000000000001'))$q$,'S4 a past day is refused','22023','Choisissez une date à venir.');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000007',das_day(25),das_version('da300000-0000-4000-8000-000000000007'))$q$,'S4 a shipped dossier keeps its departure','22023');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000008',das_day(25),das_version('da300000-0000-4000-8000-000000000008'))$q$,'S4 a cancelled dossier is refused','22023');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000009',das_day(25),das_version('da300000-0000-4000-8000-000000000009'))$q$,'S4 an archived dossier is refused','22023');
SELECT das_reject($q$SELECT set_colis_departure_wish('da3fffff-0000-4000-8000-000000000001',das_day(25),now())$q$,'S4 unknown dossier','P0002');
SELECT das_assert((SELECT envoi_id IS NULL AND depart_souhaite=das_day(25) FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(25),das_version('da300000-0000-4000-8000-000000000001'))),'S4 a day without departure is kept on the dossier (« Départ à créer »)');
SELECT das_as('postgres');
SELECT das_assert((SELECT user_nom='Affectation' AND detail=to_char(das_day(25),'YYYY-MM-DD') AND before_data=jsonb_build_object('envoi_id',NULL,'depart_souhaite',NULL)
  AND after_data=jsonb_build_object('envoi_id',NULL,'depart_souhaite',das_day(25)) FROM audit_actions WHERE colis_id='da300000-0000-4000-8000-000000000001' AND action='departure_wish'),'S4 audit departure_wish keeps before and after');
SELECT das_as('affecteur');
SELECT das_assert((SELECT envoi_id='da400000-0000-4000-8000-000000000030' AND depart_souhaite IS NULL FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(30),das_version('da300000-0000-4000-8000-000000000001'))),'S4 the departure planned that day for the destination is assigned and the wish cleared');
SELECT das_reject($q$SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(25),das_version('da300000-0000-4000-8000-000000000001'))$q$,'S4 changing an assigned departure needs perm_envois_reaffecter','42501');
SELECT das_as('reaffecteur');
SELECT das_assert((SELECT envoi_id IS NULL AND depart_souhaite=das_day(25) FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000001',das_day(25),das_version('da300000-0000-4000-8000-000000000001'))),'S4 a wish without departure unassigns the dossier (perm_envois_reaffecter)');
SELECT das_as('affecteur');
SELECT das_assert((SELECT envoi_id IS NULL AND depart_souhaite IS NULL FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000001',NULL,das_version('da300000-0000-4000-8000-000000000001'))),'S4 a NULL day clears the wish');
SELECT das_assert((SELECT envoi_id='da400000-0000-4000-8000-000000000030' FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000004',das_day(30),das_version('da300000-0000-4000-8000-000000000004'))),'S4 works while the client is asked for consent');
SELECT das_assert((SELECT envoi_id IS NULL AND depart_souhaite=das_day(25) FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000005',das_day(25),das_version('da300000-0000-4000-8000-000000000005'))),'S4 works during preparation');
SELECT das_assert((SELECT envoi_id='da400000-0000-4000-8000-000000000030' FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000006',das_day(30),das_version('da300000-0000-4000-8000-000000000006'))),'S4 works once paid, with the quote destination');
SELECT das_assert((SELECT envoi_id IS NULL AND depart_souhaite=das_day(35) FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000002',das_day(35),das_version('da300000-0000-4000-8000-000000000002'))),'S4 a closed departure that day is not assigned: the day stays a wish');
-- One validity rule, guard_colis_departure's: a departure without loading closing stays open until its day; the
-- Wednesday 17 h is only its habitual closing. A departure that has left is never assigned.
SELECT das_assert((SELECT envoi_id='da400000-0000-4000-8000-000000000100' AND depart_souhaite IS NULL FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000061',das_day(0),das_version('da300000-0000-4000-8000-000000000061'))),'S4 a departure without loading closing is assigned until its day, after its habitual Wednesday too');
SELECT das_assert((SELECT envoi_id IS NULL AND depart_souhaite=das_day(36) FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000062',das_day(36),das_version('da300000-0000-4000-8000-000000000062'))),'S4 a departure that has left is not assigned: the day stays a wish');
SELECT das_assert((SELECT envoi_id='da400000-0000-4000-8000-000000000030' AND depart_souhaite IS NULL FROM set_colis_departure_wish('da300000-0000-4000-8000-000000000063',das_day(30),das_version('da300000-0000-4000-8000-000000000063'))),'S4 once paid, the quote destination finds the departure of that day (client postcode changed since), as the guard checks it');
-- Direct writes bypass the permission, version and audit: refused even for the direction.
SELECT das_as('director');
SELECT das_reject($q$UPDATE colis SET depart_souhaite=das_day(26) WHERE id='da300000-0000-4000-8000-000000000002'$q$,'S1 a direct update of the desired day is refused','42501','Utilisez la commande de départ du dossier');
SELECT das_reject($q$INSERT INTO colis(client_id,statut,depart_souhaite) VALUES('da200000-0000-4000-8000-000000000001','receptionne',das_day(26))$q$,'S1 a direct insert with a desired day is refused','42501','Utilisez la commande de départ du dossier');
SELECT das_as('postgres');
UPDATE colis SET casier='DAS-1' WHERE id='da300000-0000-4000-8000-000000000002';
SELECT das_assert((SELECT depart_souhaite=das_day(35) AND casier='DAS-1' FROM colis WHERE id='da300000-0000-4000-8000-000000000002'),'S1 other updates keep the desired day');

-- ── S3. Assignment clears the wish; removing a departure keeps it ──
SELECT das_as('affecteur');
SELECT das_assert((SELECT envoi_id='da400000-0000-4000-8000-000000000030' AND depart_souhaite IS NULL FROM assign_colis_departure('da300000-0000-4000-8000-000000000002','da400000-0000-4000-8000-000000000030',das_version('da300000-0000-4000-8000-000000000002'))),'S3 assigning a departure clears the desired day');
SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000003',das_day(25),das_version('da300000-0000-4000-8000-000000000003'));
SELECT das_assert((SELECT envoi_id IS NULL AND depart_souhaite=das_day(25) FROM assign_colis_departure('da300000-0000-4000-8000-000000000003',NULL,das_version('da300000-0000-4000-8000-000000000003'))),'S3 a NULL assignment keeps the desired day');
SELECT das_reject($q$SELECT assign_colis_departure('da300000-0000-4000-8000-000000000002',NULL,das_version('da300000-0000-4000-8000-000000000002'))$q$,'S3 unchanged: removing a departure needs perm_envois_reaffecter','42501');
SELECT das_reject($q$SELECT assign_colis_departure('da300000-0000-4000-8000-000000000003','da400000-0000-4000-8000-000000000030','2000-01-01')$q$,'S3 unchanged: stale version','40001','Le dossier a changé. Rechargez-le.');
SELECT das_as('postgres');
SELECT das_assert((SELECT count(*)=1 AND bool_and(detail::jsonb->>'after'='da400000-0000-4000-8000-000000000030') FROM audit_actions WHERE colis_id='da300000-0000-4000-8000-000000000002' AND action='departure_assignment'),'S3 unchanged audit departure_assignment');

-- ── S5. Explicit departure creation ──
SELECT das_as('affecteur');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000011',das_day(45),das_version('da300000-0000-4000-8000-000000000011'))$q$,'S5 perm_envois_creer is required','42501');
SELECT das_as('creation_seule');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000011',das_day(45),das_version('da300000-0000-4000-8000-000000000011'))$q$,'S5 the assignment permission is required too','42501');
SELECT das_as('logisticien');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000011',das_day(45),'2000-01-01')$q$,'S5 stale version','40001','Le dossier a changé. Actualisez avant de réessayer.');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000007',das_day(45),das_version('da300000-0000-4000-8000-000000000007'))$q$,'S5 a shipped dossier is refused','22023');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000009',das_day(45),das_version('da300000-0000-4000-8000-000000000009'))$q$,'S5 an archived dossier is refused','22023');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000011',das_day(-3),das_version('da300000-0000-4000-8000-000000000011'))$q$,'S5 a past day is refused','22023','Choisissez une date à venir.');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000011',NULL,das_version('da300000-0000-4000-8000-000000000011'))$q$,'S5 a day is required','22023','Choisissez une date à venir.');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000066',das_day(0),das_version('da300000-0000-4000-8000-000000000066'))$q$,'S5 a new departure of today would already be closed (today is always after its Wednesday closing)','22023','La clôture de ce départ est déjà passée.');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000064',das_day(35),das_version('da300000-0000-4000-8000-000000000064'))$q$,'S5 the only departure of that day has its loading closed: refused, never reused nor duplicated','22023','Le départ de ce jour est clôturé : choisissez un autre jour.');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000065',das_day(36),das_version('da300000-0000-4000-8000-000000000065'))$q$,'S5 the only departure of that day has left: refused, never reused nor duplicated','22023','Le départ de ce jour est clôturé : choisissez un autre jour.');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000014',das_day(45),das_version('da300000-0000-4000-8000-000000000014'))$q$,'S5 unknown destination','22023','Destination du client inconnue : complétez son code postal.');
SELECT das_as('postgres');
SELECT das_assert(NOT EXISTS(SELECT 1 FROM envois WHERE date_depart=das_day(45)) AND NOT EXISTS(SELECT 1 FROM envois WHERE destination_code='976' AND date_depart=das_day(0))
  AND (SELECT count(*)=1 FROM envois WHERE date_depart=das_day(35)) AND (SELECT count(*)=1 FROM envois WHERE date_depart=das_day(36))
  AND (SELECT envoi_id IS NULL FROM colis WHERE id='da300000-0000-4000-8000-000000000064') AND (SELECT envoi_id IS NULL FROM colis WHERE id='da300000-0000-4000-8000-000000000065'),'S5 refusals create no departure and assign nothing');
SELECT das_as('logisticien');
CREATE TEMP TABLE das_reused_today ON COMMIT DROP AS SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000067',das_day(0),das_version('da300000-0000-4000-8000-000000000067')) AS result;
SELECT das_as('postgres');
SELECT das_assert((SELECT result->'envoi'->>'id'='da400000-0000-4000-8000-000000000100' AND result->'colis'->>'envoi_id'='da400000-0000-4000-8000-000000000100' FROM das_reused_today)
  AND (SELECT count(*)=1 FROM envois WHERE destination_code='974' AND date_depart=das_day(0))
  AND (SELECT NOT (detail::jsonb->>'created')::boolean FROM audit_actions WHERE colis_id='da300000-0000-4000-8000-000000000067' AND action='departure_create'),'S5 the open departure of that day is reused after its habitual Wednesday: one validity rule, no duplicate');
SELECT das_as('logisticien');
CREATE TEMP TABLE das_created ON COMMIT DROP AS SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000011',das_day(45),das_version('da300000-0000-4000-8000-000000000011')) AS result;
SELECT das_as('postgres');
SELECT das_assert((SELECT e.destination_code='974' AND e.date_depart=das_day(45) AND e.statut='planifie' AND e.mode_transport='aerien' AND e.loading_closes_at=departure_default_closing(das_day(45))
  AND e.cree_par='da000000-0000-4000-8000-000000000005' AND e.ref LIKE 'ENV-%' AND e.departed_at IS NULL FROM envois e WHERE e.date_depart=das_day(45)),'S5 creates an aérien planned departure closing on the Wednesday 17:00 Paris before it');
SELECT das_assert((SELECT c.envoi_id=e.id AND c.depart_souhaite IS NULL FROM colis c JOIN envois e ON e.date_depart=das_day(45) WHERE c.id='da300000-0000-4000-8000-000000000011'),'S5 assigns the dossier to the created departure');
SELECT das_assert((SELECT (result->'colis'->>'envoi_id')=(result->'envoi'->>'id') AND (result->'envoi'->>'nb_colis')::integer=1 AND result->'colis'->>'updated_at' IS NOT NULL
  AND (result->'colis'->>'updated_at')::timestamptz=das_version('da300000-0000-4000-8000-000000000011') FROM das_created),'S5 returns the saved dossier and the departure with its totals');
SELECT das_assert((SELECT user_nom='Logistique' AND (detail::jsonb->>'created')::boolean AND detail::jsonb->>'destination'='974' AND detail::jsonb->>'date'=to_char(das_day(45),'YYYY-MM-DD')
  AND before_data=jsonb_build_object('envoi_id',NULL,'depart_souhaite',NULL) AND after_data->>'envoi_id'=(SELECT id::text FROM envois WHERE date_depart=das_day(45))
  FROM audit_actions WHERE colis_id='da300000-0000-4000-8000-000000000011' AND action='departure_create'),'S5 audit departure_create');
SELECT das_as('createur');
SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000012',das_day(50),das_version('da300000-0000-4000-8000-000000000012'));
SELECT das_assert((SELECT (create_departure_for_colis('da300000-0000-4000-8000-000000000012',das_day(50),das_version('da300000-0000-4000-8000-000000000012'))->'colis'->>'depart_souhaite') IS NULL),'S5 the created departure replaces the desired day');
SELECT das_reject($q$SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000012',das_day(55),das_version('da300000-0000-4000-8000-000000000012'))$q$,'S5 an assigned dossier needs perm_envois_reaffecter','42501');
SELECT das_assert((SELECT (create_departure_for_colis('da300000-0000-4000-8000-000000000013',das_day(45),das_version('da300000-0000-4000-8000-000000000013'))->'envoi'->>'nb_colis')::integer=2),'S5 a second dossier reuses the departure of that day');
SELECT das_as('postgres');
SELECT das_assert((SELECT count(*)=1 FROM envois WHERE destination_code='974' AND date_depart=das_day(45)),'S5 never duplicates a departure for the same destination and day');
SELECT das_assert((SELECT NOT (detail::jsonb->>'created')::boolean FROM audit_actions WHERE colis_id='da300000-0000-4000-8000-000000000013' AND action='departure_create'),'S5 the audit tells a reuse from a creation');
SELECT das_as('logisticien');
SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000015',das_day(40),das_version('da300000-0000-4000-8000-000000000015'));
SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000016',das_day(45),das_version('da300000-0000-4000-8000-000000000016'));
SELECT create_departure_for_colis('da300000-0000-4000-8000-000000000017',das_day(47),das_version('da300000-0000-4000-8000-000000000017'));
SELECT das_as('postgres');
SELECT das_assert((SELECT c.envoi_id<>'da400000-0000-4000-8000-000000000040' AND e.statut='planifie' AND e.date_depart=das_day(40) FROM colis c JOIN envois e ON e.id=c.envoi_id WHERE c.id='da300000-0000-4000-8000-000000000015'),'S5 an archived departure that day is not reused');
SELECT das_assert((SELECT e.destination_code='974' AND e.date_depart=das_day(45) FROM colis c JOIN envois e ON e.id=c.envoi_id WHERE c.id='da300000-0000-4000-8000-000000000016'),'S5 once paid, the quote destination is used (client postcode changed since)');
SELECT das_assert((SELECT envoi_id='da400000-0000-4000-8000-000000000472' FROM colis WHERE id='da300000-0000-4000-8000-000000000017')
  AND (SELECT count(*)=2 FROM envois WHERE destination_code='974' AND date_depart=das_day(47)),'S5 among duplicates already planned that day, the open departure is reused');

-- ── S6. Consent precedence; the consent never fails because of the desired day ──
INSERT INTO envois(id,destination_code,date_depart,statut,loading_closes_at) VALUES('da400000-0000-4000-8000-000000000022','974',das_day(22),'planifie',now()+interval '1 hour');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,depart_souhaite) VALUES
 ('da300000-0000-4000-8000-000000000021','da200000-0000-4000-8000-000000000001','DAS-P1-KEEP','attente_feu_vert','en_attente','da400000-0000-4000-8000-000000000030',das_day(25)),
 ('da300000-0000-4000-8000-000000000022','da200000-0000-4000-8000-000000000001','DAS-P2-DAY','attente_feu_vert','en_attente',NULL,das_day(30)),
 ('da300000-0000-4000-8000-000000000023','da200000-0000-4000-8000-000000000001','DAS-P3-TO-CREATE','attente_feu_vert','en_attente',NULL,das_day(25)),
 ('da300000-0000-4000-8000-000000000024','da200000-0000-4000-8000-000000000001','DAS-P3-CLOSED','attente_feu_vert','en_attente',NULL,das_day(35)),
 ('da300000-0000-4000-8000-000000000025','da200000-0000-4000-8000-000000000002','DAS-P2-MAYOTTE','attente_feu_vert','en_attente',NULL,das_day(30)),
 ('da300000-0000-4000-8000-000000000026','da200000-0000-4000-8000-000000000001','DAS-P4-AUTO','attente_feu_vert','en_attente',NULL,NULL),
 ('da300000-0000-4000-8000-000000000027','da200000-0000-4000-8000-000000000001','DAS-P4-INVALID','attente_feu_vert','en_attente','da400000-0000-4000-8000-000000000022',NULL),
 ('da300000-0000-4000-8000-000000000028','da200000-0000-4000-8000-000000000001','DAS-P2-INVALID','attente_feu_vert','en_attente','da400000-0000-4000-8000-000000000022',das_day(30)),
 ('da300000-0000-4000-8000-000000000029','da200000-0000-4000-8000-000000000001','DAS-PORTAL','attente_feu_vert','en_attente',NULL,das_day(30)),
 ('da300000-0000-4000-8000-000000000068','da200000-0000-4000-8000-000000000001','DAS-P2-TODAY','attente_feu_vert','en_attente',NULL,das_day(0)),
 ('da300000-0000-4000-8000-000000000069','da200000-0000-4000-8000-000000000001','DAS-P3-DEPARTED','attente_feu_vert','en_attente',NULL,das_day(36));
UPDATE envois SET loading_closes_at=now()-interval '1 minute' WHERE id='da400000-0000-4000-8000-000000000022';
SELECT das_assert((SELECT statut='autorise' AND envoi_id='da400000-0000-4000-8000-000000000030' AND depart_souhaite IS NULL FROM _apply_client_decision('da300000-0000-4000-8000-000000000021','approve',NULL,NULL,NULL,'test')),'S6 (1) a still valid assigned departure is kept and the wish cleared');
SELECT das_assert((SELECT statut='autorise' AND envoi_id='da400000-0000-4000-8000-000000000030' AND depart_souhaite IS NULL FROM _apply_client_decision('da300000-0000-4000-8000-000000000022','approve',NULL,NULL,NULL,'test')),'S6 (2) the departure of the desired day wins over the earlier automatic pick');
SELECT das_assert((SELECT statut='autorise' AND envoi_id='da400000-0000-4000-8000-000000000031' FROM _apply_client_decision('da300000-0000-4000-8000-000000000025','approve',NULL,NULL,NULL,'test')),'S6 (2) the desired day uses the client destination');
SELECT das_assert((SELECT statut='autorise' AND feu_vert='autorise' AND envoi_id IS NULL AND depart_souhaite=das_day(25) FROM _apply_client_decision('da300000-0000-4000-8000-000000000023','approve',NULL,NULL,NULL,'test')),'S6 (3) no departure that day: consent recorded, the day stays « à créer », no other day picked');
SELECT das_assert((SELECT statut='autorise' AND envoi_id IS NULL AND depart_souhaite=das_day(35) FROM _apply_client_decision('da300000-0000-4000-8000-000000000024','approve',NULL,NULL,NULL,'test')),'S6 (3) a closed departure that day is never written: the consent still succeeds');
SELECT das_assert((SELECT statut='autorise' AND envoi_id='da400000-0000-4000-8000-000000000020' FROM _apply_client_decision('da300000-0000-4000-8000-000000000026','approve',NULL,NULL,NULL,'test')),'S6 (4) without a wish, the automatic pick is unchanged');
SELECT das_assert((SELECT statut='autorise' AND envoi_id='da400000-0000-4000-8000-000000000020' FROM _apply_client_decision('da300000-0000-4000-8000-000000000027','approve',NULL,NULL,NULL,'test')),'S6 (4) an assigned departure closed since is replaced by the automatic pick, as before');
SELECT das_assert((SELECT statut='autorise' AND envoi_id='da400000-0000-4000-8000-000000000030' AND depart_souhaite IS NULL FROM _apply_client_decision('da300000-0000-4000-8000-000000000028','approve',NULL,NULL,NULL,'test')),'S6 (2) a closed assigned departure gives way to the desired day');
SELECT das_assert((SELECT statut='autorise' AND envoi_id='da400000-0000-4000-8000-000000000100' AND depart_souhaite IS NULL FROM _apply_client_decision('da300000-0000-4000-8000-000000000068','approve',NULL,NULL,NULL,'test')),'S6 (2) the desired day''s departure without loading closing stays open until its day (one validity rule)');
SELECT das_assert((SELECT statut='autorise' AND feu_vert='autorise' AND envoi_id IS NULL AND depart_souhaite=das_day(36) FROM _apply_client_decision('da300000-0000-4000-8000-000000000069','approve',NULL,NULL,NULL,'test')),'S6 (3) the departure of the desired day has left: never written, the consent still succeeds');
SELECT das_as('client');
CREATE TEMP TABLE das_portal ON COMMIT DROP AS SELECT client_decision(id,'approve',updated_at) AS result FROM client_colis WHERE id='da300000-0000-4000-8000-000000000029';
SELECT das_assert((SELECT result->>'statut'='autorise' AND result->>'envoi_id'='da400000-0000-4000-8000-000000000030' AND NOT result ? 'depart_souhaite' FROM das_portal),'S6 portal consent assigns the desired day without exposing it to the client');
SELECT das_assert((SELECT count(*)>0 AND bool_and(NOT to_jsonb(v) ? 'depart_souhaite') FROM client_colis v),'S1 client_colis never exposes the desired day');
SELECT das_as('postgres');
SELECT das_assert((SELECT count(*)=0 FROM colis WHERE id::text LIKE 'da3000%' AND statut='attente_feu_vert' AND ref LIKE 'DAS-P%'),'S6 every consent above succeeded');

-- ── S7. Reception task around the departure closing ──
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,depart_souhaite,attente_client_motif,attente_client_date,attente_client_until,next_action,next_action_at,next_action_source,archive) VALUES
 ('da300000-0000-4000-8000-000000000031','da200000-0000-4000-8000-000000000001','DAS-R1','receptionne',NULL,'da400000-0000-4000-8000-000000000124',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000032','da200000-0000-4000-8000-000000000001','DAS-R2','mesure',NULL,'da400000-0000-4000-8000-000000000172',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000033','da200000-0000-4000-8000-000000000001','DAS-R3','receptionne',NULL,'da400000-0000-4000-8000-000000000124',NULL,NULL,NULL,NULL,'Rappeler le client',now()+interval '2 hours','manual',false),
 ('da300000-0000-4000-8000-000000000034','da200000-0000-4000-8000-000000000001','DAS-R4','mesure',NULL,NULL,das_day(60),NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000035','da200000-0000-4000-8000-000000000001','DAS-R5','receptionne',NULL,'da400000-0000-4000-8000-000000000136',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000036','da200000-0000-4000-8000-000000000001','DAS-R6','mesure',NULL,'da400000-0000-4000-8000-000000000148',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000037','da200000-0000-4000-8000-000000000001','DAS-R7','receptionne',NULL,'da400000-0000-4000-8000-000000000149',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000041','da200000-0000-4000-8000-000000000001','DAS-A1','attente_feu_vert','en_attente','da400000-0000-4000-8000-000000000124',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000042','da200000-0000-4000-8000-000000000001','DAS-A2','attente_feu_vert','en_attente','da400000-0000-4000-8000-000000000172',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000043','da200000-0000-4000-8000-000000000001','DAS-A3','attente_feu_vert','en_attente','da400000-0000-4000-8000-000000000124',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000044','da200000-0000-4000-8000-000000000001','DAS-A4','attente_feu_vert','en_attente','da400000-0000-4000-8000-000000000124',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000045','da200000-0000-4000-8000-000000000001','DAS-A5','attente_feu_vert','en_attente','da400000-0000-4000-8000-000000000100',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000046','da200000-0000-4000-8000-000000000001','DAS-A6','attente_feu_vert','en_attente',NULL,das_day(60),NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000047','da200000-0000-4000-8000-000000000001','DAS-A7','attente_feu_vert','en_attente',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000048','da200000-0000-4000-8000-000000000001','DAS-A8','attente_feu_vert','en_attente','da400000-0000-4000-8000-000000000173',NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000051','da200000-0000-4000-8000-000000000001','DAS-N1','attente_feu_vert','en_attente',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000052','da200000-0000-4000-8000-000000000001','DAS-N2','receptionne',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'system',false),
 ('da300000-0000-4000-8000-000000000053','da200000-0000-4000-8000-000000000001','DAS-X1','receptionne',NULL,'da400000-0000-4000-8000-000000000124',NULL,NULL,NULL,NULL,NULL,NULL,'system',true);
-- Voluntary waits are recorded after the receipts: a new receipt of the same client resumes them (resume_wait_on_receipt).
UPDATE colis SET attente_client_motif='Attend d’autres colis',attente_client_date=now()-interval '1 day',attente_client_until=now()+interval '5 days' WHERE id='da300000-0000-4000-8000-000000000043';
UPDATE colis SET attente_client_motif='Attend d’autres colis',attente_client_date=now()-interval '2 days',attente_client_until=now()-interval '1 day' WHERE id='da300000-0000-4000-8000-000000000044';
SELECT das_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Demander l’accord avant la clôture du départ' AND due_at=now()+interval '24 hours' FROM das_reception('da300000-0000-4000-8000-000000000031')),'S7 receptionne inside the window: ask consent before the closing, due at the closing');
SELECT das_assert((SELECT state='ready' AND action_hint IS NULL AND due_at IS NULL FROM das_reception('da300000-0000-4000-8000-000000000032')),'S7 mesure outside the window: unchanged');
SELECT das_assert((SELECT action_hint='Demander l’accord avant la clôture du départ' AND due_at=now()+interval '2 hours' FROM das_reception('da300000-0000-4000-8000-000000000033')),'S7 an earlier manual date stays the due date');
SELECT das_assert((SELECT state='ready' AND action_hint IS NULL AND due_at IS NULL FROM das_reception('da300000-0000-4000-8000-000000000034')),'S7 mesure with a far desired day: unchanged');
SELECT das_assert((SELECT action_hint='Demander l’accord avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM das_reception('da300000-0000-4000-8000-000000000035'))
  AND (SELECT action_hint='Demander l’accord avant la clôture du départ' AND due_at=now()+interval '48 hours' FROM das_reception('da300000-0000-4000-8000-000000000036'))
  AND (SELECT action_hint IS NULL AND due_at IS NULL FROM das_reception('da300000-0000-4000-8000-000000000037')),'S7 the window is the 48 hours before the closing, both ends included');
SELECT das_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '24 hours' FROM das_reception('da300000-0000-4000-8000-000000000041')),'S7 awaited consent inside the window: not blocked, relance due at the closing');
SELECT das_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=now()+interval '24 hours' FROM das_reception('da300000-0000-4000-8000-000000000042')),'S7 awaited consent before the window: blocked, due when the window opens');
SELECT das_assert((SELECT state='waiting' AND blocked_reason='Attente volontaire du client' AND action_hint IS NULL AND due_at=now()+interval '5 days' FROM das_reception('da300000-0000-4000-8000-000000000043')),'S7 a voluntary client wait is never relanced');
SELECT das_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Réexaminer l’attente client' AND due_at=now()-interval '1 day' FROM das_reception('da300000-0000-4000-8000-000000000044')),'S7 an expired wait still wins over the relance');
SELECT das_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at IS NULL FROM das_reception('da300000-0000-4000-8000-000000000045')),'S7 after the closing: back to the plain awaited consent');
SELECT das_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=departure_default_closing(das_day(60))-interval '48 hours' FROM das_reception('da300000-0000-4000-8000-000000000046')),'S7 a desired day without departure uses its Wednesday closing');
SELECT das_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at IS NULL FROM das_reception('da300000-0000-4000-8000-000000000051'))
  AND (SELECT state='ready' AND blocked_reason IS NULL AND action_hint IS NULL AND due_at IS NULL FROM das_reception('da300000-0000-4000-8000-000000000052')),'S7 no change for dossiers without departure or desired day');
SELECT das_assert(NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='da300000-0000-4000-8000-000000000053' AND kind='reception' AND state<>'done')
  AND _reception_work_hint(das_colis('da300000-0000-4000-8000-000000000053')) IS NULL,'S7 an archived dossier has no relance');
SELECT das_as('affecteur');
SELECT set_colis_departure_wish('da300000-0000-4000-8000-000000000047',das_day(60),das_version('da300000-0000-4000-8000-000000000047'));
SELECT das_assert((SELECT due_at=departure_default_closing(das_day(60))-interval '48 hours' FROM das_reception('da300000-0000-4000-8000-000000000047')),'S7 a new desired day re-syncs the task at once');
SELECT das_as('postgres');
UPDATE envois SET loading_closes_at=now()+interval '12 hours' WHERE id='da400000-0000-4000-8000-000000000173';
SELECT das_assert((SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '12 hours' FROM das_reception('da300000-0000-4000-8000-000000000048')),'S7 an earlier loading closing re-syncs the assigned dossiers');
-- Time passes (simulated): rows computed before the window opened or closed are refreshed, then stay stable.
UPDATE staff_work_actions SET action_hint=NULL,due_at=NULL WHERE colis_id='da300000-0000-4000-8000-000000000031' AND kind='reception';
UPDATE staff_work_actions SET state='waiting',blocked_reason='Accord client attendu',action_hint=NULL,due_at=now()-interval '24 hours' WHERE colis_id='da300000-0000-4000-8000-000000000041' AND kind='reception';
UPDATE staff_work_actions SET state='ready',blocked_reason=NULL,action_hint='Relancer le client avant la clôture du départ',due_at=now()-interval '1 day' WHERE colis_id='da300000-0000-4000-8000-000000000045' AND kind='reception';
SELECT das_as('director');
SELECT refresh_staff_work_actions();
SELECT das_assert((SELECT state='ready' AND action_hint='Demander l’accord avant la clôture du départ' AND due_at=now()+interval '24 hours' FROM das_reception('da300000-0000-4000-8000-000000000031')),'S7 refresh: the window opened on a ready reception task');
SELECT das_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '24 hours' FROM das_reception('da300000-0000-4000-8000-000000000041')),'S7 refresh: the window opened on a blocked consent');
SELECT das_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at IS NULL FROM das_reception('da300000-0000-4000-8000-000000000045')),'S7 refresh: the closing passed');
SELECT das_as('postgres');
CREATE TEMP TABLE das_rows ON COMMIT DROP AS SELECT to_jsonb(w) AS data FROM staff_work_actions w;
SELECT das_as('director');
SELECT refresh_staff_work_actions();
SELECT das_as('postgres');
SELECT das_assert(NOT EXISTS((SELECT to_jsonb(w) FROM staff_work_actions w EXCEPT SELECT data FROM das_rows) UNION ALL (SELECT data FROM das_rows EXCEPT SELECT to_jsonb(w) FROM staff_work_actions w)),'S7 a second refresh changes nothing');
SELECT das_assert(NOT EXISTS(SELECT 1 FROM staff_work_actions w JOIN colis c ON c.id=w.colis_id WHERE w.kind='reception' AND w.state<>'done' AND w.action_hint IS DISTINCT FROM _reception_work_hint(c)),'S7 every open reception task carries its computed hint');
SELECT das_as('preparateur');
SELECT das_assert((SELECT count(*)>0 FROM staff_work_actions WHERE action_hint='Demander l’accord avant la clôture du départ'),'S7 the team reads the hint');
SELECT das_as('postgres');
ROLLBACK;
