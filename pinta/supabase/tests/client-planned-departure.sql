-- Client planned departure (2026-10-07): client_planned_departures returns the day of the assigned departure for the
-- caller's own dossiers only, at the steps the shared tracking page shows it, for a non-archived dossier and departure;
-- a past or unconfirmed day is never presented as planned; nothing for another client, a staff member, an inactive
-- profile or an anonymous caller. The departure row and the staff-only desired day stay private.
BEGIN;
CREATE FUNCTION cpd_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
CREATE FUNCTION cpd_day(n integer) RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Europe/Paris')::date+n $$;
-- Calls the function as a given caller and returns the rows as a jsonb object { colis_id: date_depart } (or NULL).
CREATE FUNCTION cpd_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role',CASE who WHEN 'anon' THEN 'anon' ELSE 'authenticated' END,true);
 PERFORM set_config('request.jwt.claim.sub',CASE who WHEN 'one' THEN 'cd100000-0000-4000-8000-000000000001' WHEN 'two' THEN 'cd100000-0000-4000-8000-000000000002'
  WHEN 'staff' THEN 'cd100000-0000-4000-8000-000000000003' WHEN 'stranger' THEN 'cd100000-0000-4000-8000-0000000000ff' ELSE '' END,true);
 EXECUTE format('SET LOCAL ROLE %I',CASE who WHEN 'anon' THEN 'anon' ELSE 'authenticated' END);
END $$;
GRANT EXECUTE ON FUNCTION cpd_as(text) TO authenticated,anon;
GRANT EXECUTE ON FUNCTION cpd_assert(boolean,text) TO authenticated,anon;

-- ── 1. The function itself ──
SELECT cpd_assert(pg_get_function_result('public.client_planned_departures(uuid[])'::regprocedure)='TABLE(colis_id uuid, date_depart date)','1 returns the dossier and the departure day, nothing else');
SELECT cpd_assert((SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid='public.client_planned_departures(uuid[])'::regprocedure),'1 security definer, stable, fixed search_path');
SELECT cpd_assert(NOT has_function_privilege('anon','public.client_planned_departures(uuid[])','EXECUTE'),'1 anonymous callers have no EXECUTE');
SELECT cpd_assert(has_function_privilege('authenticated','public.client_planned_departures(uuid[])','EXECUTE'),'1 signed-in callers have EXECUTE');
SELECT cpd_assert(NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.client_planned_departures(uuid[])'::regprocedure AND a.grantee=0),'1 no PUBLIC grant');
SELECT cpd_assert((SELECT p.proowner=r.proowner AND p.proacl::text=r.proacl::text FROM pg_proc p,pg_proc r
  WHERE p.oid='public.client_planned_departures(uuid[])'::regprocedure AND r.oid='public.client_outgoing_tracking(uuid[])'::regprocedure),'1 same owner and grants as client_outgoing_tracking');
SELECT cpd_assert(NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.client_colis'::regclass AND attname IN ('depart_souhaite','date_depart') AND NOT attisdropped),'1 client_colis exposes neither the desired day nor a departure day');

-- ── Fixtures: two clients, a staff member; departures planned, archived, past, departed, today ──
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('cd100000-0000-4000-8000-000000000001','planned-one@example.test','{}'),
 ('cd100000-0000-4000-8000-000000000002','planned-two@example.test','{}'),
 ('cd100000-0000-4000-8000-000000000003','planned-staff@example.test','{"nom":"Direction départ"}');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('cd150000-0000-4000-8000-000000000003','cd100000-0000-4000-8000-000000000003','Direction départ','planned-staff@example.test','directeur',false);
INSERT INTO clients(id,user_id,nom,cp,type) VALUES
 ('cd200000-0000-4000-8000-000000000001','cd100000-0000-4000-8000-000000000001','Départ Un','97400','particulier'),
 ('cd200000-0000-4000-8000-000000000002','cd100000-0000-4000-8000-000000000002','Départ Deux','97400','particulier');
INSERT INTO envois(id,ref,date_depart,statut,destination_code,tracking_principal) VALUES
 ('cd400000-0000-4000-8000-000000000001','CPD-PLANNED',cpd_day(10),'planifie','974','PRIVATE-CARRIER'),
 ('cd400000-0000-4000-8000-000000000002','CPD-ARCHIVED',cpd_day(12),'planifie','974',NULL),
 ('cd400000-0000-4000-8000-000000000003','CPD-PAST',cpd_day(5),'planifie','974',NULL),
 ('cd400000-0000-4000-8000-000000000004','CPD-DEPARTED',cpd_day(0),'planifie','974',NULL),
 ('cd400000-0000-4000-8000-000000000005','CPD-TODAY',cpd_day(0),'planifie','974',NULL);
-- The assignment happens while each departure is valid; the departure then changes as in production.
INSERT INTO colis(id,client_id,ref,statut,envoi_id,archive,depart_souhaite) VALUES
 ('cd300000-0000-4000-8000-000000000001','cd200000-0000-4000-8000-000000000001','CPD-AUTORISE','autorise','cd400000-0000-4000-8000-000000000001',false,NULL),
 ('cd300000-0000-4000-8000-000000000002','cd200000-0000-4000-8000-000000000001','CPD-PREPARATION','en_preparation','cd400000-0000-4000-8000-000000000001',false,NULL),
 ('cd300000-0000-4000-8000-000000000003','cd200000-0000-4000-8000-000000000001','CPD-DEVIS','devis_envoye','cd400000-0000-4000-8000-000000000001',false,NULL),
 ('cd300000-0000-4000-8000-000000000004','cd200000-0000-4000-8000-000000000001','CPD-PAIEMENT','attente_paiement','cd400000-0000-4000-8000-000000000001',false,NULL),
 ('cd300000-0000-4000-8000-000000000005','cd200000-0000-4000-8000-000000000001','CPD-PAYE','paye','cd400000-0000-4000-8000-000000000001',false,NULL),
 ('cd300000-0000-4000-8000-000000000006','cd200000-0000-4000-8000-000000000001','CPD-MESURE','mesure','cd400000-0000-4000-8000-000000000001',false,NULL),
 ('cd300000-0000-4000-8000-000000000007','cd200000-0000-4000-8000-000000000001','CPD-ACCORD','attente_feu_vert','cd400000-0000-4000-8000-000000000001',false,NULL),
 ('cd300000-0000-4000-8000-000000000008','cd200000-0000-4000-8000-000000000001','CPD-REFUS','refuse_client','cd400000-0000-4000-8000-000000000001',false,NULL),
 ('cd300000-0000-4000-8000-000000000009','cd200000-0000-4000-8000-000000000001','CPD-TRANSIT','transit','cd400000-0000-4000-8000-000000000004',false,NULL),
 ('cd300000-0000-4000-8000-000000000010','cd200000-0000-4000-8000-000000000001','CPD-ARCHIVE-DOSSIER','paye','cd400000-0000-4000-8000-000000000001',true,NULL),
 ('cd300000-0000-4000-8000-000000000011','cd200000-0000-4000-8000-000000000001','CPD-DEPART-ARCHIVE','autorise','cd400000-0000-4000-8000-000000000002',false,NULL),
 ('cd300000-0000-4000-8000-000000000012','cd200000-0000-4000-8000-000000000001','CPD-DEPART-PASSE','paye','cd400000-0000-4000-8000-000000000003',false,NULL),
 ('cd300000-0000-4000-8000-000000000013','cd200000-0000-4000-8000-000000000001','CPD-EXPEDIE','expedie','cd400000-0000-4000-8000-000000000004',false,NULL),
 ('cd300000-0000-4000-8000-000000000014','cd200000-0000-4000-8000-000000000001','CPD-EXPEDIE-NON-CONFIRME','expedie','cd400000-0000-4000-8000-000000000001',false,NULL),
 ('cd300000-0000-4000-8000-000000000015','cd200000-0000-4000-8000-000000000001','CPD-AUJOURDHUI','en_preparation','cd400000-0000-4000-8000-000000000005',false,NULL),
 ('cd300000-0000-4000-8000-000000000016','cd200000-0000-4000-8000-000000000001','CPD-SANS-DEPART','paye',NULL,false,cpd_day(20)),
 ('cd300000-0000-4000-8000-000000000017','cd200000-0000-4000-8000-000000000001','CPD-ANNULE','annule','cd400000-0000-4000-8000-000000000001',false,NULL),
 ('cd300000-0000-4000-8000-000000000020','cd200000-0000-4000-8000-000000000002','CPD-AUTRE-CLIENT','paye','cd400000-0000-4000-8000-000000000001',false,NULL);
-- The desired day is staff-only even on a dossier that has a departure.
UPDATE colis SET depart_souhaite=cpd_day(30) WHERE id='cd300000-0000-4000-8000-000000000005';
UPDATE envois SET statut='archive' WHERE id='cd400000-0000-4000-8000-000000000002';
UPDATE envois SET date_depart=cpd_day(-3) WHERE id='cd400000-0000-4000-8000-000000000003';
SELECT set_config('expedile.confirm_departure','allowed',true);
UPDATE envois SET statut='parti',departed_at=now() WHERE id='cd400000-0000-4000-8000-000000000004';
SELECT set_config('expedile.confirm_departure','',true);
CREATE TEMP TABLE cpd_all AS SELECT array_agg(id ORDER BY id) ids FROM colis WHERE id::text LIKE 'cd30%';
GRANT SELECT ON cpd_all TO authenticated,anon;
GRANT SELECT ON envois TO authenticated; -- fixture: exercise row visibility independently of table grants
CREATE TEMP TABLE cpd_result(who text,colis_id uuid,date_depart date);
GRANT INSERT,SELECT ON cpd_result TO authenticated,anon;

-- ── 2. The client's own dossiers ──
SELECT cpd_as('one');
INSERT INTO cpd_result SELECT 'one',r.colis_id,r.date_depart FROM client_planned_departures((SELECT ids FROM cpd_all)) r;
SELECT cpd_assert((SELECT count(*) FROM envois WHERE id::text LIKE 'cd40%')=0,'2 the departures themselves remain inaccessible to the client');
RESET ROLE;
SELECT cpd_assert((SELECT array_agg(c.ref ORDER BY c.ref) FROM cpd_result r JOIN colis c ON c.id=r.colis_id WHERE r.who='one')
  =ARRAY['CPD-AUJOURDHUI','CPD-AUTORISE','CPD-DEVIS','CPD-EXPEDIE','CPD-PAIEMENT','CPD-PAYE','CPD-PREPARATION'],'2 exactly the own dossiers at a listed step with a valid departure');
SELECT cpd_assert((SELECT bool_and(r.date_depart=cpd_day(10)) FROM cpd_result r WHERE r.who='one' AND r.colis_id IN ('cd300000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000002','cd300000-0000-4000-8000-000000000003','cd300000-0000-4000-8000-000000000004','cd300000-0000-4000-8000-000000000005')),'2 autorise, en_preparation, devis_envoye, attente_paiement and paye read the planned day');
SELECT cpd_assert((SELECT date_depart FROM cpd_result WHERE who='one' AND colis_id='cd300000-0000-4000-8000-000000000005')=cpd_day(10),'2 the departure day, never the staff-only desired day');
SELECT cpd_assert((SELECT date_depart FROM cpd_result WHERE who='one' AND colis_id='cd300000-0000-4000-8000-000000000015')=cpd_day(0),'2 a departure of today is still to come');
SELECT cpd_assert((SELECT date_depart FROM cpd_result WHERE who='one' AND colis_id='cd300000-0000-4000-8000-000000000013')=cpd_day(0),'2 a departed dossier reads its confirmed departure');
SELECT cpd_assert(NOT EXISTS(SELECT 1 FROM cpd_result WHERE who='one' AND colis_id IN ('cd300000-0000-4000-8000-000000000006','cd300000-0000-4000-8000-000000000007','cd300000-0000-4000-8000-000000000008','cd300000-0000-4000-8000-000000000009','cd300000-0000-4000-8000-000000000017')),'2 mesure, attente_feu_vert, refuse_client, transit and annule return nothing');
SELECT cpd_assert(NOT EXISTS(SELECT 1 FROM cpd_result WHERE who='one' AND colis_id='cd300000-0000-4000-8000-000000000010'),'2 an archived dossier returns nothing');
SELECT cpd_assert(NOT EXISTS(SELECT 1 FROM cpd_result WHERE who='one' AND colis_id='cd300000-0000-4000-8000-000000000011'),'2 an archived departure returns nothing');
SELECT cpd_assert(NOT EXISTS(SELECT 1 FROM cpd_result WHERE who='one' AND colis_id='cd300000-0000-4000-8000-000000000012'),'2 a past departure that has not left is never presented as planned');
SELECT cpd_assert(NOT EXISTS(SELECT 1 FROM cpd_result WHERE who='one' AND colis_id='cd300000-0000-4000-8000-000000000014'),'2 a shipped dossier on an unconfirmed departure returns nothing');
SELECT cpd_assert(NOT EXISTS(SELECT 1 FROM cpd_result WHERE who='one' AND colis_id='cd300000-0000-4000-8000-000000000016'),'2 a desired day without a departure is never returned');
SELECT cpd_assert(NOT EXISTS(SELECT 1 FROM cpd_result WHERE who='one' AND colis_id='cd300000-0000-4000-8000-000000000020'),'2 another client''s dossier is refused, even when its id is passed');

-- ── 3. Other callers ──
SELECT cpd_as('two');
INSERT INTO cpd_result SELECT 'two',r.colis_id,r.date_depart FROM client_planned_departures((SELECT ids FROM cpd_all)) r;
RESET ROLE;
SELECT cpd_assert((SELECT array_agg(colis_id) FROM cpd_result WHERE who='two')=ARRAY['cd300000-0000-4000-8000-000000000020'::uuid],'3 the other client reads only its own dossier');
SELECT cpd_as('staff');
INSERT INTO cpd_result SELECT 'staff',r.colis_id,r.date_depart FROM client_planned_departures((SELECT ids FROM cpd_all)) r;
SELECT cpd_as('stranger');
INSERT INTO cpd_result SELECT 'stranger',r.colis_id,r.date_depart FROM client_planned_departures((SELECT ids FROM cpd_all)) r;
RESET ROLE;
SELECT cpd_assert(NOT EXISTS(SELECT 1 FROM cpd_result WHERE who IN ('staff','stranger')),'3 a staff member or an unknown account reads nothing');
SELECT cpd_as('one');
SELECT cpd_assert((SELECT count(*) FROM client_planned_departures(NULL))=0 AND (SELECT count(*) FROM client_planned_departures(ARRAY[]::uuid[]))=0,'3 no identifier, no row');
RESET ROLE;
UPDATE profiles SET actif=false WHERE id='cd100000-0000-4000-8000-000000000001';
SELECT cpd_as('one');
SELECT cpd_assert((SELECT count(*) FROM client_planned_departures((SELECT ids FROM cpd_all)))=0,'3 an inactive profile reads nothing');
RESET ROLE;
UPDATE profiles SET actif=true WHERE id='cd100000-0000-4000-8000-000000000001';
SELECT cpd_as('anon');
DO $$ BEGIN
 PERFORM * FROM client_planned_departures(ARRAY['cd300000-0000-4000-8000-000000000001']::uuid[]);
 RAISE EXCEPTION 'FAIL: an anonymous caller executed client_planned_departures';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: 3 an anonymous caller is refused [%]',SQLSTATE;
END $$;
RESET ROLE;

-- ── 4. Reading never changes a business row ──
SELECT cpd_assert((SELECT count(*) FROM colis WHERE id::text LIKE 'cd30%' AND depart_souhaite IS NOT NULL)=2
  AND (SELECT statut FROM envois WHERE id='cd400000-0000-4000-8000-000000000002')='archive'
  AND (SELECT date_depart FROM envois WHERE id='cd400000-0000-4000-8000-000000000003')=cpd_day(-3),'4 fixtures unchanged by the reads');
ROLLBACK;
