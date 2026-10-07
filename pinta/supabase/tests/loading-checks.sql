-- Loading control of a departure (2026-10-07): grants, every refusal with its SQLSTATE, HINT and message, idempotence,
-- stale labels, counts, clearing, the reading shared between devices, the mandatory control at confirmation and the
-- manifest evidence. Every refusal leaves the checks, dossiers, departures, manifests and audit unchanged.
BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;

-- ── Grants and shape of the release (this database has no default privileges, like production after the REVOKEs) ──
DO $$
DECLARE fn text; owner oid:=(SELECT proowner FROM pg_proc WHERE oid='confirm_departure(uuid,jsonb,timestamptz,text)'::regprocedure);
BEGIN
 FOREACH fn IN ARRAY ARRAY['record_loading_check(uuid,uuid,integer,integer,text)','record_loading_count(uuid,uuid,integer)','clear_loading_checks(uuid,uuid)','get_loading_checks(uuid)'] LOOP
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE') OR NOT has_function_privilege('authenticated',fn,'EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=fn::regprocedure AND a.grantee=0)
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner FROM pg_proc WHERE oid=fn::regprocedure) THEN
   RAISE EXCEPTION 'FAIL: command security %',fn; END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['_loading_expected_parcels(colis)','_loading_checker_name(uuid)','_loading_check_json(departure_loading_checks)','_loading_checks_forget()','_loading_check_target(uuid,uuid,boolean)'] LOOP
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE')
   OR NOT (SELECT proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner FROM pg_proc WHERE oid=fn::regprocedure) THEN
   RAISE EXCEPTION 'FAIL: private helper executable or without fixed search_path %',fn; END IF;
 END LOOP;
 IF has_function_privilege('anon','confirm_departure(uuid,jsonb,timestamptz,text)','EXECUTE') OR NOT has_function_privilege('authenticated','confirm_departure(uuid,jsonb,timestamptz,text)','EXECUTE')
  OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid='confirm_departure(uuid,jsonb,timestamptz,text)'::regprocedure) THEN
  RAISE EXCEPTION 'FAIL: confirm_departure lost its grants or security'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='departure_loading_checks'::regclass)
  OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='departure_loading_checks'::regclass)
  OR has_table_privilege('anon','departure_loading_checks','SELECT') OR has_table_privilege('authenticated','departure_loading_checks','SELECT')
  OR has_table_privilege('authenticated','departure_loading_checks','INSERT') OR has_table_privilege('authenticated','departure_loading_checks','UPDATE')
  OR has_table_privilege('authenticated','departure_loading_checks','DELETE') THEN
  RAISE EXCEPTION 'FAIL: the checks table must stay private (RLS, no policy, no API privilege)'; END IF;
 IF (SELECT array_agg(a.attname ORDER BY a.attnum) FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid='departure_loading_checks'::regclass AND i.indisprimary)<>ARRAY['envoi_id','colis_id','parcel_index']::name[]
  OR (SELECT count(*) FROM pg_constraint WHERE conrelid='departure_loading_checks'::regclass AND contype='f' AND confdeltype='c')<>3
  OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='departure_loading_checks'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%parcel_index >= 1%parcel_index <= parcel_count%')
  OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='departure_loading_checks'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%scan%camera%count%')
  OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='departure_loading_checks_colis') THEN
  RAISE EXCEPTION 'FAIL: primary key, cascading foreign keys, checks or dossier index'; END IF;
 RAISE NOTICE 'PASS: command and helper grants, private table under RLS, key, cascades and checks';
END $$;
-- Even the broad legacy grants never open the table: no policy, so RLS refuses every direct row.
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;

CREATE FUNCTION lc_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
CREATE FUNCTION lc_fingerprint() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(k) ORDER BY envoi_id,colis_id,parcel_index) FROM departure_loading_checks k),
  (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM colis c),(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM envois e),
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY envoi_id) FROM departure_manifests m),(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_actions a))
$$;
-- A refusal: SQLSTATE, HINT, message and DETAIL when the contract fixes them, and nothing written.
CREATE FUNCTION lc_reject(command text,label text,code text,hint text DEFAULT NULL,message text DEFAULT NULL,detail jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_data jsonb:=lc_fingerprint(); got_hint text; got_detail text;
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS got_hint=PG_EXCEPTION_HINT,got_detail=PG_EXCEPTION_DETAIL;
  IF SQLSTATE<>code THEN RAISE EXCEPTION 'FAIL wrong code % for %: %',SQLSTATE,label,SQLERRM; END IF;
  IF hint IS NOT NULL AND nullif(got_hint,'') IS DISTINCT FROM hint THEN RAISE EXCEPTION 'FAIL wrong hint % for %: %',got_hint,label,SQLERRM; END IF;
  IF message IS NOT NULL AND SQLERRM<>message THEN RAISE EXCEPTION 'FAIL wrong message for %: %',label,SQLERRM; END IF;
  IF detail IS NOT NULL AND nullif(got_detail,'')::jsonb IS DISTINCT FROM detail THEN RAISE EXCEPTION 'FAIL wrong detail % for %',got_detail,label; END IF;
  IF lc_fingerprint()<>before_data THEN RAISE EXCEPTION 'FAIL % changed data',label; END IF;
  RAISE NOTICE 'PASS rejected: % [%]',label,SQLSTATE; RETURN;
 END;
 RAISE EXCEPTION 'FAIL accepted: %',label;
END $$;
CREATE FUNCTION lc_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role',CASE who WHEN 'postgres' THEN '' WHEN 'anon' THEN 'anon' ELSE 'authenticated' END,true);
 PERFORM set_config('request.jwt.claim.sub',CASE who WHEN 'director' THEN '1c000000-0000-4000-8000-000000000001' WHEN 'expediteur' THEN '1c000000-0000-4000-8000-000000000002'
  WHEN 'lecteur' THEN '1c000000-0000-4000-8000-000000000003' WHEN 'preparateur' THEN '1c000000-0000-4000-8000-000000000004' WHEN 'inactif' THEN '1c000000-0000-4000-8000-000000000005'
  WHEN 'client' THEN '1c000000-0000-4000-8000-000000000006' WHEN 'confirmeur' THEN '1c000000-0000-4000-8000-000000000007' ELSE '' END,true);
 IF who<>'postgres' THEN EXECUTE format('SET LOCAL ROLE %I',CASE who WHEN 'anon' THEN 'anon' ELSE 'authenticated' END); END IF;
END $$;
CREATE FUNCTION lc_version(p_colis uuid) RETURNS timestamptz LANGUAGE sql SECURITY DEFINER AS $$ SELECT updated_at FROM colis WHERE id=p_colis $$;
CREATE FUNCTION lc_departure_version(p_envoi uuid) RETURNS timestamptz LANGUAGE sql SECURITY DEFINER AS $$ SELECT updated_at FROM envois WHERE id=p_envoi $$;
CREATE FUNCTION lc_rows(p_envoi uuid,p_colis uuid) RETURNS SETOF departure_loading_checks LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM departure_loading_checks WHERE envoi_id=p_envoi AND colis_id=p_colis ORDER BY parcel_index $$;
-- The loaded list confirm_departure expects, built from the current rows.
CREATE FUNCTION lc_loaded(VARIADIC p_colis uuid[]) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_agg(jsonb_build_object('id',c.id,'updated_at',c.updated_at,'outgoing_parcel_count',coalesce(c.outgoing_parcel_count,1)) ORDER BY x.n)
 FROM unnest(p_colis) WITH ORDINALITY x(id,n) JOIN colis c ON c.id=x.id
$$;

-- ── Fixtures ──
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('1c000000-0000-4000-8000-000000000001','lc-director@example.test','{"nom":"Direction LC"}'),('1c000000-0000-4000-8000-000000000002','lc-expediteur@example.test','{"nom":"Expédition"}'),
 ('1c000000-0000-4000-8000-000000000003','lc-lecteur@example.test','{"nom":"Lecture"}'),('1c000000-0000-4000-8000-000000000004','lc-preparateur@example.test','{"nom":"Préparation"}'),
 ('1c000000-0000-4000-8000-000000000005','lc-inactif@example.test','{"nom":"Ancien"}'),('1c000000-0000-4000-8000-000000000006','lc-client@example.test','{"nom":"Flavie Payet"}'),
 ('1c000000-0000-4000-8000-000000000007','lc-confirmeur@example.test','{"nom":"Confirmation"}');
INSERT INTO staff_users(id,auth_id,nom,prenom,email,role,actif,must_change_password) VALUES
 ('1c100000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','Hoarau','Camille','lc-director@example.test','directeur',true,false),
 ('1c100000-0000-4000-8000-000000000002','1c000000-0000-4000-8000-000000000002','Grondin','Marc','lc-expediteur@example.test','logisticien',true,false),
 ('1c100000-0000-4000-8000-000000000003','1c000000-0000-4000-8000-000000000003','Lecture',NULL,'lc-lecteur@example.test','logisticien',true,false),
 ('1c100000-0000-4000-8000-000000000004','1c000000-0000-4000-8000-000000000004','Préparation',NULL,'lc-preparateur@example.test','preparateur',true,false),
 ('1c100000-0000-4000-8000-000000000005','1c000000-0000-4000-8000-000000000005','Ancien',NULL,'lc-inactif@example.test','logisticien',false,false),
 ('1c100000-0000-4000-8000-000000000007','1c000000-0000-4000-8000-000000000007','Confirmation',NULL,'lc-confirmeur@example.test','logisticien',true,false);
-- Expédition: the shipping right only (no departure reading); Lecture: reading only; Confirmation: the confirmation rights.
INSERT INTO staff_permissions(staff_id,perm_colis_expedier,perm_envois_voir,perm_envois_modifier,perm_envois_reaffecter) VALUES
 ('1c100000-0000-4000-8000-000000000002',true,false,false,false),('1c100000-0000-4000-8000-000000000003',false,true,false,false),
 ('1c100000-0000-4000-8000-000000000004',false,false,false,false),('1c100000-0000-4000-8000-000000000005',true,true,true,true),
 ('1c100000-0000-4000-8000-000000000007',true,true,true,false);
INSERT INTO clients(id,user_id,nom,cp,email,type) VALUES
 ('1c200000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000006','Payet','97400','lc-client@example.test','particulier');
-- E1, E3, E4 and E5 leave today (Paris), E2 later; E3 then leaves and E4 arrives (below, once their dossiers are set).
INSERT INTO envois(id,ref,destination_code,date_depart,statut) VALUES
 ('1c400000-0000-4000-8000-000000000001','LC-ENV-1','974',(now() AT TIME ZONE 'Europe/Paris')::date,'planifie'),
 ('1c400000-0000-4000-8000-000000000002','LC-ENV-2','974',(now() AT TIME ZONE 'Europe/Paris')::date+7,'planifie'),
 ('1c400000-0000-4000-8000-000000000003','LC-ENV-3','974',(now() AT TIME ZONE 'Europe/Paris')::date,'planifie'),
 ('1c400000-0000-4000-8000-000000000004','LC-ENV-4','974',(now() AT TIME ZONE 'Europe/Paris')::date,'planifie'),
 ('1c400000-0000-4000-8000-000000000005','LC-ENV-5','974',(now() AT TIME ZONE 'Europe/Paris')::date,'pret');
-- Paid and prepared: two outgoing parcels (current preparation) and a legacy single measure; an unpaid prepared parcel;
-- not prepared; on another departure; cancelled, archived and shipped dossiers still pointing at the departure.
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,fin_l,fin_w,fin_h,fin_p,final_packages,outgoing_parcel_count,preparation_composition_version,final_measurements_version,devis_total,devis_snapshot,paiement_montant,paiement_date) VALUES
 ('1c300000-0000-4000-8000-000000000001','1c200000-0000-4000-8000-000000000001','LC-TWO','paye','autorise','1c400000-0000-4000-8000-000000000001',40,30,30,19.5,
  '[{"dimL":40,"dimW":30,"dimH":30,"poids":12},{"dimL":30,"dimW":30,"dimH":20,"poids":7.5}]',2,1,1,140,'{"inputs":{"destination":{"code":"974"}}}',140,now()),
 ('1c300000-0000-4000-8000-000000000002','1c200000-0000-4000-8000-000000000001','LC-LEGACY','paye','autorise','1c400000-0000-4000-8000-000000000001',20,20,20,2,
  NULL,NULL,0,0,20,'{"destination":{"code":"974"}}',20,now()),
 ('1c300000-0000-4000-8000-000000000008','1c200000-0000-4000-8000-000000000001','LC-UNPAID','en_preparation','autorise','1c400000-0000-4000-8000-000000000001',20,20,20,2,
  '[{"dimL":20,"dimW":20,"dimH":20,"poids":2}]',1,1,1,NULL,NULL,NULL,NULL);
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id) VALUES
 ('1c300000-0000-4000-8000-000000000003','1c200000-0000-4000-8000-000000000001','LC-UNPREPARED','autorise','autorise','1c400000-0000-4000-8000-000000000001'),
 ('1c300000-0000-4000-8000-000000000004','1c200000-0000-4000-8000-000000000001','LC-OTHER','autorise','autorise','1c400000-0000-4000-8000-000000000002'),
 ('1c300000-0000-4000-8000-000000000005','1c200000-0000-4000-8000-000000000001','LC-CANCELLED','annule',NULL,'1c400000-0000-4000-8000-000000000001');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,archive) VALUES
 ('1c300000-0000-4000-8000-000000000006','1c200000-0000-4000-8000-000000000001','LC-ARCHIVED','autorise','autorise','1c400000-0000-4000-8000-000000000001',true);
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,date_expedition) VALUES
 ('1c300000-0000-4000-8000-000000000007','1c200000-0000-4000-8000-000000000001','LC-SHIPPED','expedie','autorise','1c400000-0000-4000-8000-000000000001',now());
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,fin_l,fin_w,fin_h,fin_p,final_packages,outgoing_parcel_count,preparation_composition_version,final_measurements_version,devis_total,devis_snapshot,paiement_montant,paiement_date) VALUES
 ('1c300000-0000-4000-8000-000000000009','1c200000-0000-4000-8000-000000000001','LC-LEFT','paye','autorise','1c400000-0000-4000-8000-000000000003',20,20,20,2,
  '[{"dimL":20,"dimW":20,"dimH":20,"poids":2}]',1,1,1,20,'{"inputs":{"destination":{"code":"974"}}}',20,now());
SELECT set_config('expedile.confirm_departure','allowed',true);
UPDATE envois SET statut='parti',departed_at=now()-interval '1 hour',manifest_version=1 WHERE id='1c400000-0000-4000-8000-000000000003';
UPDATE envois SET statut='parti',departed_at=now()-interval '2 days',manifest_version=1 WHERE id='1c400000-0000-4000-8000-000000000004';
UPDATE envois SET statut='arrive' WHERE id='1c400000-0000-4000-8000-000000000004';
SELECT set_config('expedile.confirm_departure','',true);

-- ── C1. Permissions ──
SELECT lc_as('anon');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,'scan')$q$,'C1 anonymous calls cannot execute the command','42501');
SELECT lc_reject($q$SELECT * FROM get_loading_checks('1c400000-0000-4000-8000-000000000001')$q$,'C1 anonymous calls cannot read the checks','42501');
SELECT lc_as('client');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,'scan')$q$,'C1 a client cannot check a loading','42501','loading_check:permission','Permission d’expédition requise pour contrôler le chargement');
SELECT lc_reject($q$SELECT * FROM get_loading_checks('1c400000-0000-4000-8000-000000000001')$q$,'C1 a client cannot read the checks','42501','loading_check:permission','Permission de consultation des envois requise');
SELECT lc_as('preparateur');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,'scan')$q$,'C1 a scan needs perm_colis_expedier','42501','loading_check:permission','Permission d’expédition requise pour contrôler le chargement');
SELECT lc_reject($q$SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',2)$q$,'C1 a count needs perm_colis_expedier','42501','loading_check:permission','Permission d’expédition requise pour contrôler le chargement');
SELECT lc_reject($q$SELECT clear_loading_checks('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001')$q$,'C1 clearing needs perm_colis_expedier','42501','loading_check:permission','Permission d’expédition requise pour contrôler le chargement');
SELECT lc_as('lecteur');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,'scan')$q$,'C1 reading the departures does not allow checking','42501');
SELECT lc_assert((SELECT count(*)=0 FROM get_loading_checks('1c400000-0000-4000-8000-000000000001')),'C1 perm_envois_voir reads the checks (none yet)');
SELECT lc_as('inactif');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,'scan')$q$,'C1 an inactive account keeps no right','42501');
SELECT lc_as('expediteur');
SELECT lc_reject($q$SELECT * FROM get_loading_checks('1c400000-0000-4000-8000-000000000001')$q$,'C1 reading needs perm_envois_voir','42501','loading_check:permission','Permission de consultation des envois requise');
SELECT lc_reject($q$INSERT INTO departure_loading_checks(envoi_id,colis_id,parcel_index,parcel_count,method,checked_by) VALUES('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,'scan',auth.uid())$q$,'C1 no direct write, even with broad legacy grants','42501');

-- ── C2. Refusals, each with its HINT ──
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,'count')$q$,'C2 a count goes through record_loading_count','22023','loading_check:invalid_method','Contrôle inconnu : scannez l’étiquette, ou comptez les colis du dossier.');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,NULL)$q$,'C2 the method is required','22023','loading_check:invalid_method');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',0,2,'scan')$q$,'C2 a parcel position starts at 1','22023','loading_check:invalid_label','Étiquette illisible : numéro de colis invalide. Scannez-la à nouveau.');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',3,2,'scan')$q$,'C2 a position beyond the count is unreadable','22023','loading_check:invalid_label');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,NULL,'camera')$q$,'C2 the count is required','22023','loading_check:invalid_label');
SELECT lc_reject($q$SELECT record_loading_check('1c4fffff-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,'scan')$q$,'C2 unknown departure','P0002','loading_check:departure_not_found','Départ introuvable');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000003','1c300000-0000-4000-8000-000000000009',1,1,'scan')$q$,'C2 a departure that has left','22023','loading_check:departure_closed','Ce départ est déjà confirmé ou clos : son contrôle du chargement ne peut plus changer.');
SELECT lc_reject($q$SELECT record_loading_count('1c400000-0000-4000-8000-000000000004','1c300000-0000-4000-8000-000000000009',1)$q$,'C2 an arrived departure','22023','loading_check:departure_closed');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c3fffff-0000-4000-8000-000000000001',1,2,'scan')$q$,'C2 unknown dossier','P0002','loading_check:dossier_not_found','Dossier introuvable');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000004',1,1,'scan')$q$,'C2 a dossier of another departure','40001','loading_check:not_assigned','LC-OTHER n’est pas affecté à ce départ : ne chargez pas ses colis. Actualisez le chargement.');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000005',1,1,'scan')$q$,'C2 a cancelled dossier','22023','loading_check:dossier_closed','LC-CANCELLED est déjà expédié, annulé ou archivé : il ne fait plus partie de ce chargement.');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000006',1,1,'scan')$q$,'C2 an archived dossier','22023','loading_check:dossier_closed');
SELECT lc_reject($q$SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000007',1)$q$,'C2 a shipped dossier','22023','loading_check:dossier_closed');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000003',1,1,'scan')$q$,'C2 a dossier whose outgoing parcels are not prepared','22023','loading_check:not_prepared','LC-UNPREPARED : ses colis sortants ne sont pas encore préparés. Terminez sa préparation avant de contrôler son chargement.');
SELECT lc_reject($q$SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000003',0)$q$,'C2 nothing to count before the preparation','22023','loading_check:not_prepared');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,3,'scan')$q$,'C2 a label printed for another count is stale','22023','loading_check:stale_label','Étiquette périmée : ce dossier compte maintenant 2 colis. Réimprimez ses étiquettes.');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000002',1,2,'scan')$q$,'C2 a legacy single measure counts one parcel','22023','loading_check:stale_label','Étiquette périmée : ce dossier compte maintenant 1 colis. Réimprimez ses étiquettes.');
SELECT lc_reject($q$SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1)$q$,'C2 a count must match the outgoing parcels','22023','loading_check:count_mismatch','Comptage différent : LC-TWO compte 2 colis, vous en avez compté 1. Recomptez ses colis, ou reportez-le.');
SELECT lc_reject($q$SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',3)$q$,'C2 counting too many parcels is refused too','22023','loading_check:count_mismatch');
SELECT lc_reject($q$SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',NULL)$q$,'C2 the count is required','22023','loading_check:invalid_count','Indiquez le nombre de colis comptés.');
SELECT lc_reject($q$SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',-1)$q$,'C2 a negative count is refused','22023','loading_check:invalid_count');
SELECT lc_reject($q$SELECT clear_loading_checks('1c400000-0000-4000-8000-000000000003','1c300000-0000-4000-8000-000000000009')$q$,'C2 the checks of a departure that has left are frozen','22023','loading_check:departure_closed');
SELECT lc_reject($q$SELECT clear_loading_checks('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000004')$q$,'C2 clearing a dossier of another departure','40001','loading_check:not_assigned');
SELECT lc_as('lecteur');
SELECT lc_reject($q$SELECT * FROM get_loading_checks('1c4fffff-0000-4000-8000-000000000001')$q$,'C2 reading an unknown departure','P0002','loading_check:departure_not_found','Départ introuvable');

-- ── C3. A scan is recorded once, with who and when; scanning again keeps the first check ──
SELECT lc_as('postgres');
SELECT set_config('lc.colis_version',lc_version('1c300000-0000-4000-8000-000000000001')::text,true),set_config('lc.departure_version',lc_departure_version('1c400000-0000-4000-8000-000000000001')::text,true);
SELECT lc_as('expediteur');
CREATE TEMP TABLE lc_first ON COMMIT DROP AS SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,'scan') AS result;
SELECT lc_assert((SELECT result->>'status'='recorded' AND (result->>'checked')::integer=1 AND (result->>'expected')::integer=2
  AND result#>>'{check,colis_id}'='1c300000-0000-4000-8000-000000000001' AND (result#>>'{check,parcel_index}')::integer=1 AND (result#>>'{check,parcel_count}')::integer=2
  AND result#>>'{check,method}'='scan' AND result#>>'{check,checked_by}'='1c000000-0000-4000-8000-000000000002' AND result#>>'{check,checked_by_name}'='Marc Grondin'
  AND (result#>>'{check,checked_at}')::timestamptz=now() FROM lc_first),'C3 a scanned label is recorded with the parcel, the method, who and when');
SELECT lc_as('postgres');
SELECT lc_assert(lc_version('1c300000-0000-4000-8000-000000000001')=current_setting('lc.colis_version')::timestamptz
  AND lc_departure_version('1c400000-0000-4000-8000-000000000001')=current_setting('lc.departure_version')::timestamptz,'C3 a check changes neither the dossier nor the departure version');
SELECT lc_assert(NOT EXISTS(SELECT 1 FROM audit_actions WHERE action LIKE 'loading%'),'C3 the check itself is the record: no audit row per scan');
SELECT lc_as('expediteur');
SELECT lc_assert(NOT EXISTS(SELECT 1 FROM departure_loading_checks),'C3 even with broad legacy grants, RLS hides every stored check from the API role');
WITH removed AS (DELETE FROM departure_loading_checks RETURNING 1) SELECT lc_assert((SELECT count(*)=0 FROM removed),'C3 and a direct delete reaches no check');
SELECT lc_as('postgres');
SELECT lc_assert((SELECT count(*)=1 FROM lc_rows('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001')),'C3 the check is still stored');
-- An earlier scan, so that « when » can be compared.
UPDATE departure_loading_checks SET checked_at=now()-interval '1 hour' WHERE colis_id='1c300000-0000-4000-8000-000000000001' AND parcel_index=1;
SELECT lc_as('director');
SELECT lc_assert((SELECT result->>'status'='already' AND (result->>'checked')::integer=1 AND result#>>'{check,checked_by}'='1c000000-0000-4000-8000-000000000002'
  AND result#>>'{check,method}'='scan' AND (result#>>'{check,checked_at}')::timestamptz=now()-interval '1 hour'
  FROM (SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',1,2,'camera') AS result) r),'C3 the same label scanned again on another device is already checked: who, when and method kept');
SELECT lc_as('postgres');
SELECT lc_assert((SELECT count(*)=1 AND bool_and(checked_by='1c000000-0000-4000-8000-000000000002' AND method='scan' AND checked_at=now()-interval '1 hour') FROM lc_rows('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001')),'C3 one row per parcel, unchanged by the repeated scan');
SELECT lc_as('director');
SELECT lc_assert((SELECT result->>'status'='recorded' AND (result->>'checked')::integer=2 AND result#>>'{check,method}'='camera' AND result#>>'{check,checked_by_name}'='Camille Hoarau'
  FROM (SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',2,2,'camera') AS result) r),'C3 the second parcel scanned with the tablet camera completes the dossier');
SELECT lc_as('lecteur');
SELECT lc_assert((SELECT jsonb_agg(jsonb_build_object('colis',colis_id,'index',parcel_index,'count',parcel_count,'method',method,'by',checked_by,'name',checked_by_name) ORDER BY parcel_index)
  =jsonb_build_array(jsonb_build_object('colis','1c300000-0000-4000-8000-000000000001','index',1,'count',2,'method','scan','by','1c000000-0000-4000-8000-000000000002','name','Marc Grondin'),
   jsonb_build_object('colis','1c300000-0000-4000-8000-000000000001','index',2,'count',2,'method','camera','by','1c000000-0000-4000-8000-000000000001','name','Camille Hoarau'))
  FROM get_loading_checks('1c400000-0000-4000-8000-000000000001')),'C3 every device reads the same checks: parcel, count, method, who (id and name) and when');

-- ── C4. Counting by hand ──
SELECT lc_as('expediteur');
SELECT lc_assert((SELECT result->>'status'='recorded' AND (result->>'checked')::integer=1 AND (result->>'expected')::integer=1 AND (result->>'added')::integer=1
  FROM (SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000002',1) AS result) r),'C4 a legacy single measure is counted as one parcel');
SELECT lc_assert((SELECT result->>'status'='already' AND (result->>'checked')::integer=1 AND (result->>'added')::integer=0
  FROM (SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000002',1) AS result) r),'C4 counting again changes nothing');
SELECT lc_as('postgres');
SELECT lc_assert((SELECT count(*)=1 AND bool_and(method='count' AND parcel_index=1 AND parcel_count=1 AND checked_by='1c000000-0000-4000-8000-000000000002') FROM lc_rows('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000002')),'C4 the count is recorded per parcel with the method count');
-- Unpaid but prepared: its parcels can be checked before the payment (the confirmation still requires it).
SELECT lc_as('expediteur');
SELECT lc_assert((record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000008',1,1,'scan'))->>'status'='recorded','C4 a prepared dossier is checked before its payment is confirmed');

-- ── C5. Stale labels: a new preparation replaces the checks of the former count ──
SELECT lc_as('postgres');
UPDATE colis SET final_packages='[{"dimL":40,"dimW":30,"dimH":30,"poids":8},{"dimL":30,"dimW":30,"dimH":20,"poids":6},{"dimL":20,"dimW":20,"dimH":20,"poids":5.5}]',outgoing_parcel_count=3 WHERE id='1c300000-0000-4000-8000-000000000001';
SELECT lc_as('lecteur');
SELECT lc_assert((SELECT count(*)=2 AND bool_and(parcel_count=2) FROM get_loading_checks('1c400000-0000-4000-8000-000000000001') WHERE colis_id='1c300000-0000-4000-8000-000000000001'),'C5 the checks of the former labels stay visible with their count');
SELECT lc_as('expediteur');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',2,2,'scan')$q$,'C5 an old label is refused once the dossier has three parcels','22023','loading_check:stale_label','Étiquette périmée : ce dossier compte maintenant 3 colis. Réimprimez ses étiquettes.');
SELECT lc_assert((SELECT result->>'status'='recorded' AND (result->>'checked')::integer=1 AND (result->>'expected')::integer=3
  FROM (SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',2,3,'scan') AS result) r),'C5 a new label is recorded and the former checks no longer count');
SELECT lc_as('postgres');
SELECT lc_assert((SELECT count(*)=1 AND bool_and(parcel_index=2 AND parcel_count=3) FROM lc_rows('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001')),'C5 the checks of the former count are replaced by the current labels');
SELECT lc_as('expediteur');
SELECT lc_assert((SELECT result->>'status'='recorded' AND (result->>'checked')::integer=3 AND (result->>'added')::integer=2
  FROM (SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001',3) AS result) r),'C5 a count completes the parcels not scanned yet');
SELECT lc_as('postgres');
SELECT lc_assert((SELECT jsonb_agg(method ORDER BY parcel_index)=jsonb_build_array('count','scan','count') FROM lc_rows('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001')),'C5 a scanned parcel keeps its scan; the counted ones say count');

-- ── C6. Clearing a dossier's control, audited ──
UPDATE departure_loading_checks SET checked_at=now()-interval '10 minutes' WHERE colis_id='1c300000-0000-4000-8000-000000000001';
SELECT lc_as('director');
SELECT lc_assert((SELECT result=jsonb_build_object('status','cleared','cleared',3,'checked',0,'expected',3)
  FROM (SELECT clear_loading_checks('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001') AS result) r),'C6 clearing removes the dossier''s checks for this departure');
SELECT lc_as('postgres');
SELECT lc_assert(NOT EXISTS(SELECT 1 FROM lc_rows('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001'))
  AND EXISTS(SELECT 1 FROM lc_rows('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000002')),'C6 only that dossier is cleared');
SELECT lc_assert((SELECT count(*)=1 AND bool_and(user_id='1c000000-0000-4000-8000-000000000001' AND user_nom='Camille Hoarau' AND detail::jsonb=jsonb_build_object('envoi_id','1c400000-0000-4000-8000-000000000001','cleared',3)
  AND jsonb_array_length(before_data)=3 AND before_data#>>'{1,method}'='scan' AND before_data#>>'{1,checked_by_name}'='Marc Grondin' AND (before_data#>>'{1,checked_at}')::timestamptz=now()-interval '10 minutes')
  FROM audit_actions WHERE colis_id='1c300000-0000-4000-8000-000000000001' AND action='loading_checks_cleared'),'C6 the audit keeps who cleared what: each removed check with its method, who and when');
SELECT lc_as('director');
SELECT lc_assert((clear_loading_checks('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000001'))=jsonb_build_object('status','none','cleared',0,'checked',0,'expected',3),'C6 clearing again changes nothing');
SELECT lc_assert((clear_loading_checks('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000003'))->>'status'='none','C6 a dossier not prepared yet can still be cleared');
SELECT lc_as('postgres');
SELECT lc_assert((SELECT count(*)=1 FROM audit_actions WHERE action='loading_checks_cleared'),'C6 an empty clearing is not audited');

-- ── C7. The reading follows the dossiers currently on the departure ──
UPDATE colis SET envoi_id='1c400000-0000-4000-8000-000000000002' WHERE id='1c300000-0000-4000-8000-000000000002';
SELECT lc_as('lecteur');
SELECT lc_assert(NOT EXISTS(SELECT 1 FROM get_loading_checks('1c400000-0000-4000-8000-000000000001') WHERE colis_id='1c300000-0000-4000-8000-000000000002')
  AND NOT EXISTS(SELECT 1 FROM get_loading_checks('1c400000-0000-4000-8000-000000000002')),'C7 a dossier moved to another departure leaves the reading of both departures');
SELECT lc_as('expediteur');
SELECT lc_reject($q$SELECT record_loading_count('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000002',1)$q$,'C7 the moved dossier is no longer checked here','40001','loading_check:not_assigned');
SELECT lc_as('postgres');
UPDATE colis SET envoi_id='1c400000-0000-4000-8000-000000000001' WHERE id='1c300000-0000-4000-8000-000000000002';
-- Removing a dossier removes its checks.
DELETE FROM colis WHERE id='1c300000-0000-4000-8000-000000000008';
SELECT lc_assert(NOT EXISTS(SELECT 1 FROM departure_loading_checks WHERE colis_id='1c300000-0000-4000-8000-000000000008'),'C7 the checks follow their dossier when it is deleted');

-- ── C8. The control is mandatory at confirmation, and the manifest keeps it ──
-- E5 leaves today: LC-P1 (2 parcels), LC-P2 (legacy single measure), LC-P3 unpaid (to defer), LC-P4 cancelled (excluded),
-- LC-P5 checked on another departure before joining this one.
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,fin_l,fin_w,fin_h,fin_p,final_packages,outgoing_parcel_count,preparation_composition_version,final_measurements_version,devis_total,devis_snapshot,paiement_montant,paiement_date) VALUES
 ('1c300000-0000-4000-8000-000000000011','1c200000-0000-4000-8000-000000000001','LC-P1','paye','autorise','1c400000-0000-4000-8000-000000000005',40,30,30,19.5,
  '[{"dimL":40,"dimW":30,"dimH":30,"poids":12},{"dimL":30,"dimW":30,"dimH":20,"poids":7.5}]',2,1,1,140,'{"inputs":{"destination":{"code":"974"}}}',140,now()),
 ('1c300000-0000-4000-8000-000000000012','1c200000-0000-4000-8000-000000000001','LC-P2','paye','autorise','1c400000-0000-4000-8000-000000000005',20,20,20,2,
  NULL,NULL,0,0,20,'{"inputs":{"destination":{"code":"974"}}}',20,now()),
 ('1c300000-0000-4000-8000-000000000013','1c200000-0000-4000-8000-000000000001','LC-P3','en_preparation','autorise','1c400000-0000-4000-8000-000000000005',20,20,20,2,
  '[{"dimL":20,"dimW":20,"dimH":20,"poids":2}]',1,1,1,NULL,NULL,NULL,NULL),
 ('1c300000-0000-4000-8000-000000000015','1c200000-0000-4000-8000-000000000001','LC-P5','paye','autorise','1c400000-0000-4000-8000-000000000001',20,20,20,2,
  '[{"dimL":20,"dimW":20,"dimH":20,"poids":2}]',1,1,1,20,'{"inputs":{"destination":{"code":"974"}}}',20,now());
INSERT INTO colis(id,client_id,ref,statut,envoi_id) VALUES('1c300000-0000-4000-8000-000000000014','1c200000-0000-4000-8000-000000000001','LC-P4','annule','1c400000-0000-4000-8000-000000000005');
SELECT lc_as('expediteur');
SELECT record_loading_check('1c400000-0000-4000-8000-000000000001','1c300000-0000-4000-8000-000000000015',1,1,'scan');
SELECT record_loading_check('1c400000-0000-4000-8000-000000000005','1c300000-0000-4000-8000-000000000013',1,1,'camera');
SELECT lc_as('postgres');
UPDATE colis SET envoi_id='1c400000-0000-4000-8000-000000000005' WHERE id='1c300000-0000-4000-8000-000000000015';
SELECT lc_as('confirmeur');
SELECT lc_reject($q$SELECT confirm_departure('1c400000-0000-4000-8000-000000000005',lc_loaded('1c300000-0000-4000-8000-000000000011','1c300000-0000-4000-8000-000000000012'),lc_departure_version('1c400000-0000-4000-8000-000000000005'),'Paiement attendu')$q$,
 'C8 deferring the other dossiers still needs perm_envois_reaffecter, before any control','42501',NULL,'Permission de réaffectation requise pour reporter les autres dossiers');
SELECT lc_as('director');
SELECT lc_reject($q$SELECT confirm_departure('1c400000-0000-4000-8000-000000000005',lc_loaded('1c300000-0000-4000-8000-000000000011','1c300000-0000-4000-8000-000000000012'),lc_departure_version('1c400000-0000-4000-8000-000000000005'),'Paiement attendu')$q$,
 'C8 a dossier without any check cannot be confirmed','22023','loading_check:incomplete','Contrôle incomplet : LC-P1 (0/2 colis vérifiés). Scannez ou comptez ses colis, ou reportez-le.',
 '{"colis_id":"1c300000-0000-4000-8000-000000000011","ref":"LC-P1","checked":0,"expected":2}');
SELECT lc_as('expediteur');
SELECT record_loading_check('1c400000-0000-4000-8000-000000000005','1c300000-0000-4000-8000-000000000011',2,2,'scan');
SELECT lc_as('director');
SELECT lc_reject($q$SELECT confirm_departure('1c400000-0000-4000-8000-000000000005',lc_loaded('1c300000-0000-4000-8000-000000000011','1c300000-0000-4000-8000-000000000012'),lc_departure_version('1c400000-0000-4000-8000-000000000005'),'Paiement attendu')$q$,
 'C8 one parcel of two is not enough','22023','loading_check:incomplete','Contrôle incomplet : LC-P1 (1/2 colis vérifiés). Scannez ou comptez ses colis, ou reportez-le.',
 '{"colis_id":"1c300000-0000-4000-8000-000000000011","ref":"LC-P1","checked":1,"expected":2}');
SELECT lc_as('expediteur');
SELECT record_loading_check('1c400000-0000-4000-8000-000000000005','1c300000-0000-4000-8000-000000000011',1,2,'camera');
SELECT lc_as('director');
SELECT lc_reject($q$SELECT confirm_departure('1c400000-0000-4000-8000-000000000005',lc_loaded('1c300000-0000-4000-8000-000000000011','1c300000-0000-4000-8000-000000000012'),lc_departure_version('1c400000-0000-4000-8000-000000000005'),'Paiement attendu')$q$,
 'C8 every loaded dossier is controlled, the legacy single parcel too','22023','loading_check:incomplete','Contrôle incomplet : LC-P2 (0/1 colis vérifié). Scannez ou comptez ses colis, ou reportez-le.');
SELECT lc_reject($q$SELECT confirm_departure('1c400000-0000-4000-8000-000000000005',lc_loaded('1c300000-0000-4000-8000-000000000011','1c300000-0000-4000-8000-000000000015'),lc_departure_version('1c400000-0000-4000-8000-000000000005'),'Paiement attendu')$q$,
 'C8 a check made for another departure does not count','22023','loading_check:incomplete','Contrôle incomplet : LC-P5 (0/1 colis vérifié). Scannez ou comptez ses colis, ou reportez-le.');
-- The former guards still come first: an unpaid dossier is refused for its payment, whatever its checks.
SELECT lc_reject($q$SELECT confirm_departure('1c400000-0000-4000-8000-000000000005',lc_loaded('1c300000-0000-4000-8000-000000000013'),lc_departure_version('1c400000-0000-4000-8000-000000000005'),'Paiement attendu')$q$,
 'C8 unchanged: payment before the control','22023',NULL,'LC-P3 : paiement confirmé et complet requis avant départ');
SELECT lc_reject($q$SELECT confirm_departure('1c400000-0000-4000-8000-000000000005',lc_loaded('1c300000-0000-4000-8000-000000000011'),'2000-01-01','Paiement attendu')$q$,'C8 unchanged: the departure version','40001',NULL,'Le départ a changé. Rechargez le chargement.');
SELECT lc_as('expediteur');
SELECT record_loading_count('1c400000-0000-4000-8000-000000000005','1c300000-0000-4000-8000-000000000012',1);
SELECT lc_as('postgres');
UPDATE departure_loading_checks SET checked_at=now()-interval '20 minutes' WHERE colis_id='1c300000-0000-4000-8000-000000000011' AND parcel_index=2;
SELECT lc_as('director');
SELECT lc_assert((confirm_departure('1c400000-0000-4000-8000-000000000005',lc_loaded('1c300000-0000-4000-8000-000000000011','1c300000-0000-4000-8000-000000000012'),lc_departure_version('1c400000-0000-4000-8000-000000000005'),'Paiement attendu')).statut='parti','C8 fully controlled dossiers are confirmed; the others are deferred with the reason');
SELECT lc_as('postgres');
SELECT lc_assert((SELECT statut='expedie' AND date_expedition IS NOT NULL FROM colis WHERE id='1c300000-0000-4000-8000-000000000011') AND (SELECT statut='expedie' AND outgoing_parcel_count=1 FROM colis WHERE id='1c300000-0000-4000-8000-000000000012')
  AND (SELECT envoi_id IS NULL FROM colis WHERE id='1c300000-0000-4000-8000-000000000013') AND (SELECT envoi_id IS NULL FROM colis WHERE id='1c300000-0000-4000-8000-000000000015')
  AND (SELECT envoi_id='1c400000-0000-4000-8000-000000000005' FROM colis WHERE id='1c300000-0000-4000-8000-000000000014'),'C8 unchanged writes: loaded shipped, others deferred, the cancelled dossier kept as history');
SELECT lc_as('lecteur');
CREATE TEMP TABLE lc_manifest ON COMMIT DROP AS SELECT get_departure_manifest('1c400000-0000-4000-8000-000000000005') AS snapshot;
SELECT lc_assert((SELECT jsonb_array_length(snapshot->'items')=2 AND jsonb_array_length(snapshot->'deferred')=2 AND jsonb_array_length(snapshot->'excluded')=1
  AND snapshot#>>'{items,0,colis,ref}'='LC-P1' AND jsonb_typeof(snapshot#>'{items,0,lignes}')='array' AND jsonb_typeof(snapshot#>'{items,0,client}')='object'
  AND (snapshot#>>'{items,1,legacy_measurements_confirmed}')::boolean FROM lc_manifest),'C8 unchanged manifest: loaded items with dossier, client and articles, deferred and excluded lists');
SELECT lc_assert((SELECT snapshot#>'{items,0,loading_checks}'=jsonb_build_array(
   jsonb_build_object('colis_id','1c300000-0000-4000-8000-000000000011','parcel_index',1,'parcel_count',2,'method','camera','checked_by','1c000000-0000-4000-8000-000000000002','checked_by_name','Marc Grondin','checked_at',now()),
   jsonb_build_object('colis_id','1c300000-0000-4000-8000-000000000011','parcel_index',2,'parcel_count',2,'method','scan','checked_by','1c000000-0000-4000-8000-000000000002','checked_by_name','Marc Grondin','checked_at',now()-interval '20 minutes'))
  AND snapshot#>'{items,1,loading_checks}'=jsonb_build_array(
   jsonb_build_object('colis_id','1c300000-0000-4000-8000-000000000012','parcel_index',1,'parcel_count',1,'method','count','checked_by','1c000000-0000-4000-8000-000000000002','checked_by_name','Marc Grondin','checked_at',now()))
  FROM lc_manifest),'C8 the manifest keeps each loaded dossier''s checks: parcel, method, who and when');
SELECT lc_assert((SELECT count(*)=3 AND bool_and(colis_id IN ('1c300000-0000-4000-8000-000000000011','1c300000-0000-4000-8000-000000000012')) FROM get_loading_checks('1c400000-0000-4000-8000-000000000005')),'C8 after the departure, the reading keeps the loaded dossiers'' checks only');
SELECT lc_as('postgres');
SELECT lc_assert(NOT EXISTS(SELECT 1 FROM departure_loading_checks WHERE colis_id='1c300000-0000-4000-8000-000000000013'),'C8 a deferred dossier leaves the departure with no check left: the next departure checks its parcels again');
SELECT lc_as('expediteur');
SELECT lc_reject($q$SELECT record_loading_check('1c400000-0000-4000-8000-000000000005','1c300000-0000-4000-8000-000000000011',1,2,'scan')$q$,'C8 once confirmed, nothing more is checked','22023','loading_check:departure_closed');
SELECT lc_reject($q$SELECT clear_loading_checks('1c400000-0000-4000-8000-000000000005','1c300000-0000-4000-8000-000000000011')$q$,'C8 once confirmed, the evidence cannot be cleared','22023','loading_check:departure_closed');
SELECT lc_as('postgres');
SELECT lc_assert((SELECT detail::jsonb->'loaded_ids'=jsonb_build_array('1c300000-0000-4000-8000-000000000011','1c300000-0000-4000-8000-000000000012') AND (detail::jsonb->>'physical_parcels')::integer=3
  FROM audit_actions WHERE action='departure_confirmed' AND detail::jsonb->>'envoi_id'='1c400000-0000-4000-8000-000000000005'),'C8 unchanged audit of the confirmation');
-- ── C9. A check vouches for the current preparation on this departure only ──
INSERT INTO envois(id,ref,destination_code,date_depart,statut) VALUES('1c400000-0000-4000-8000-000000000007','LC-ENV-7','974',(now() AT TIME ZONE 'Europe/Paris')::date+21,'planifie');
UPDATE colis SET envoi_id='1c400000-0000-4000-8000-000000000007' WHERE id='1c300000-0000-4000-8000-000000000015';
SELECT lc_as('expediteur');
SELECT record_loading_check('1c400000-0000-4000-8000-000000000007','1c300000-0000-4000-8000-000000000015',1,1,'scan');
SELECT lc_as('postgres');
UPDATE colis SET final_measurements_version=final_measurements_version+1,preparation_composition_version=preparation_composition_version+1 WHERE id='1c300000-0000-4000-8000-000000000015';
SELECT lc_assert(NOT EXISTS(SELECT 1 FROM departure_loading_checks WHERE colis_id='1c300000-0000-4000-8000-000000000015'),'C9 a dossier prepared again loses its checks: its new boxes are checked again');
SELECT lc_as('expediteur');
SELECT record_loading_check('1c400000-0000-4000-8000-000000000007','1c300000-0000-4000-8000-000000000015',1,1,'scan');
SELECT lc_as('postgres');
UPDATE colis SET statut=statut WHERE id='1c300000-0000-4000-8000-000000000015';
SELECT lc_assert(EXISTS(SELECT 1 FROM departure_loading_checks WHERE colis_id='1c300000-0000-4000-8000-000000000015'),'C9 any other change of the dossier keeps its checks');
UPDATE colis SET envoi_id='1c400000-0000-4000-8000-000000000002' WHERE id='1c300000-0000-4000-8000-000000000015';
UPDATE colis SET envoi_id='1c400000-0000-4000-8000-000000000007' WHERE id='1c300000-0000-4000-8000-000000000015';
SELECT lc_assert(NOT EXISTS(SELECT 1 FROM departure_loading_checks WHERE colis_id='1c300000-0000-4000-8000-000000000015'),'C9 a dossier moved off its departure and back is checked again');
DELETE FROM envois WHERE id='1c400000-0000-4000-8000-000000000007' AND NOT EXISTS(SELECT 1 FROM colis WHERE envoi_id='1c400000-0000-4000-8000-000000000007');
UPDATE colis SET envoi_id=NULL WHERE id='1c300000-0000-4000-8000-000000000015';
DELETE FROM envois WHERE id='1c400000-0000-4000-8000-000000000007';

-- Deleting a departure that never left removes its checks with it.
INSERT INTO envois(id,ref,destination_code,date_depart,statut) VALUES('1c400000-0000-4000-8000-000000000006','LC-ENV-6','974',(now() AT TIME ZONE 'Europe/Paris')::date+14,'planifie');
UPDATE colis SET envoi_id='1c400000-0000-4000-8000-000000000006' WHERE id='1c300000-0000-4000-8000-000000000015';
SELECT lc_as('expediteur');
SELECT record_loading_check('1c400000-0000-4000-8000-000000000006','1c300000-0000-4000-8000-000000000015',1,1,'scan');
SELECT lc_as('postgres');
UPDATE colis SET envoi_id=NULL WHERE id='1c300000-0000-4000-8000-000000000015';
DELETE FROM envois WHERE id='1c400000-0000-4000-8000-000000000006';
SELECT lc_assert(NOT EXISTS(SELECT 1 FROM departure_loading_checks WHERE envoi_id='1c400000-0000-4000-8000-000000000006'),'C8 the checks follow their departure when it is deleted');
ROLLBACK;
