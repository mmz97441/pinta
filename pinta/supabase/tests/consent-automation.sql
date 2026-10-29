-- Automatic client consent (20261029000001_consent_automation.sql). Run by run-consent-automation.sh after every
-- migration, with Supabase's default privileges. Checked: the shape (settings, private helpers, grants); the notice
-- that asks the agreement (one message, the buttons of its dossier, the consent machinery of « Demander l’accord »);
-- its replay; every case where the plain notice leaves instead (several dossiers, e-mail, no permission, the reception
-- task followed by a colleague, a dossier not measured, a carton of the dossier left for a next validation); the refusals; the reminders due (48 hours, then 24 hours, two
-- at most, a relance of the team counting, nothing for the history, a voluntary wait, a delivery in progress or
-- failed, an open conversation, an e-mail client, a replaced request, settings off or unreadable).
BEGIN;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE FUNCTION ca_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION ca_reject(command text,label text,code text,message text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>code THEN RAISE EXCEPTION 'FAIL wrong code % for %: %',SQLSTATE,label,SQLERRM; END IF;
  IF message IS NOT NULL AND SQLERRM<>message THEN RAISE EXCEPTION 'FAIL wrong message for %: %',label,SQLERRM; END IF;
  RAISE NOTICE 'PASS rejected: % [%]',label,SQLSTATE; RETURN;
 END;
 RAISE EXCEPTION 'FAIL accepted: %',label;
END $$;
CREATE FUNCTION ca_id(name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT (CASE name
 WHEN 'director' THEN 'c1000000-0000-4000-8000-000000000001' WHEN 'receiver' THEN 'c1000000-0000-4000-8000-000000000002'
 WHEN 'colleague' THEN 'c1000000-0000-4000-8000-000000000003'
 WHEN 'A' THEN 'c1200000-0000-4000-8000-000000000001' WHEN 'B' THEN 'c1200000-0000-4000-8000-000000000002'
 WHEN 'C' THEN 'c1200000-0000-4000-8000-000000000003' WHEN 'D' THEN 'c1200000-0000-4000-8000-000000000004'
 WHEN 'E' THEN 'c1200000-0000-4000-8000-000000000005' WHEN 'F' THEN 'c1200000-0000-4000-8000-000000000006'
 WHEN 'G' THEN 'c1200000-0000-4000-8000-000000000007'
 WHEN 'A1' THEN 'c1300000-0000-4000-8000-000000000001' WHEN 'B1' THEN 'c1300000-0000-4000-8000-000000000002'
 WHEN 'C1' THEN 'c1300000-0000-4000-8000-000000000003' WHEN 'C2' THEN 'c1300000-0000-4000-8000-000000000004'
 WHEN 'D1' THEN 'c1300000-0000-4000-8000-000000000005' WHEN 'E1' THEN 'c1300000-0000-4000-8000-000000000006'
 WHEN 'F1' THEN 'c1300000-0000-4000-8000-000000000007' WHEN 'G1' THEN 'c1300000-0000-4000-8000-000000000008' END)::uuid $$;
CREATE FUNCTION ca_item(name text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('colisId',ca_id(name),'fromCarton',1,'throughCarton',1) $$;
CREATE FUNCTION ca_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role',CASE who WHEN 'owner' THEN '' WHEN 'service' THEN 'service_role' WHEN 'anon' THEN 'anon' ELSE 'authenticated' END,true);
 PERFORM set_config('request.jwt.claim.sub',CASE WHEN who IN ('owner','service','anon') THEN '' ELSE ca_id(who)::text END,true);
 IF who<>'owner' THEN EXECUTE format('SET LOCAL ROLE %I',CASE who WHEN 'service' THEN 'service_role' WHEN 'anon' THEN 'anon' ELSE 'authenticated' END); END IF;
END $$;
CREATE FUNCTION ca_statut(p_colis uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT statut::text FROM colis WHERE id=p_colis $$;
-- Delivery confirmed by Telegram at a given instant (as dispatchOutbox writes it).
CREATE FUNCTION ca_deliver(p_message uuid,p_at timestamptz) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 UPDATE messages SET statut='envoye',telegram_msg_id='tg-'||left(p_message::text,8) WHERE id=p_message;
 UPDATE notification_outbox SET status='sent',sent_at=p_at,attempts=attempts+1 WHERE message_id=p_message;
 UPDATE colis SET demande_feu_vert_envoyee_at=coalesce(demande_feu_vert_envoyee_at,p_at) WHERE id=(SELECT colis_id FROM messages WHERE id=p_message);
$$;
-- The buttons the worker sends (a private helper: read by the owner).
CREATE FUNCTION ca_buttons(p_colis uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT _consent_buttons(p_colis) $$;
GRANT EXECUTE ON FUNCTION ca_buttons(uuid) TO authenticated,service_role;
CREATE FUNCTION ca_due(p_at timestamptz) RETURNS jsonb LANGUAGE sql AS $$ SELECT consent_reminders_due(p_at) $$;

-- ── C1. Shape ──
DO $$
DECLARE fn text;
BEGIN
 IF (SELECT value->'relancesAccordAuto' FROM app_settings WHERE key='business')-'depuis'
   IS DISTINCT FROM '{"actif":true,"premiereApresHeures":48,"suivanteApresHeures":24,"nombreMax":2}'::jsonb
  OR NOT (SELECT (value#>>'{relancesAccordAuto,depuis}')::timestamptz BETWEEN now()-interval '1 hour' AND now() FROM app_settings WHERE key='business') THEN
  RAISE EXCEPTION 'FAIL: settings of the automatic reminders'; END IF;
 FOREACH fn IN ARRAY ARRAY['_consent_cartons_measured(colis)','_consent_task_free(uuid)','_consent_buttons(uuid)'] LOOP
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE')
   OR (SELECT prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR prosecdef OR proconfig IS NOT NULL FROM pg_proc WHERE oid=fn::regprocedure) THEN
   RAISE EXCEPTION 'FAIL: private helper %',fn; END IF;
 END LOOP;
 IF NOT has_function_privilege('service_role','consent_reminders_due(timestamptz)','EXECUTE')
  OR has_function_privilege('authenticated','consent_reminders_due(timestamptz)','EXECUTE') OR has_function_privilege('anon','consent_reminders_due(timestamptz)','EXECUTE')
  OR NOT has_function_privilege('authenticated','validate_reception(uuid,jsonb,boolean,text,text,text,uuid,text)','EXECUTE')
  OR has_function_privilege('anon','validate_reception(uuid,jsonb,boolean,text,text,text,uuid,text)','EXECUTE')
  OR to_regprocedure('validate_reception(uuid,jsonb,boolean,text,text,text,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'FAIL: grants of the commands'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid IN ('messages'::regclass,'notification_outbox'::regclass,'colis'::regclass) AND t.tgname LIKE '%consent_automation%') THEN
  RAISE EXCEPTION 'FAIL: no trigger added'; END IF;
 RAISE NOTICE 'PASS: C1 settings on (48 h, 24 h, two reminders, from now), private helpers, the reminders for the scheduled worker only, validate_reception with p_consent_text';
END $$;

-- ── Fixtures ──
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (ca_id('director'),'ca-director@example.test','{"nom":"Martin","prenom":"Alex"}'),
 (ca_id('receiver'),'ca-receiver@example.test','{"nom":"Réception Telegram"}'),
 (ca_id('colleague'),'ca-colleague@example.test','{"nom":"Collègue","prenom":"Sam"}');
INSERT INTO staff_users(id,auth_id,nom,prenom,email,role,must_change_password) VALUES
 ('c1100000-0000-4000-8000-000000000001',ca_id('director'),'Martin','Alex','ca-director@example.test','directeur',false),
 ('c1100000-0000-4000-8000-000000000002',ca_id('receiver'),'Réception Telegram',NULL,'ca-receiver@example.test','preparateur',false),
 ('c1100000-0000-4000-8000-000000000003',ca_id('colleague'),'Collègue','Sam','ca-colleague@example.test','directeur',false);
-- The receiver validates and writes on Telegram, but does not ask the agreement.
INSERT INTO staff_permissions(staff_id,perm_colis_receptionner,perm_comm_telegram,perm_comm_email) VALUES
 ('c1100000-0000-4000-8000-000000000002',true,true,false);
-- A, C, D, E, F, G: Telegram; B: e-mail only.
INSERT INTO clients(id,nom,prenom,cp,type,email,telegram_chat_id) VALUES
 (ca_id('A'),'Payet','Flavie','97410','particulier','flavie@example.test','CHAT-CA-A'),
 (ca_id('B'),'Hoarau','Marc','97400','particulier','marc@example.test',NULL),
 (ca_id('C'),'Grondin','Lucie','97460','particulier',NULL,'CHAT-CA-C'),
 (ca_id('D'),'Técher','Paul','97430','particulier',NULL,'CHAT-CA-D'),
 (ca_id('E'),'Boyer','Sandrine','97420','particulier',NULL,'CHAT-CA-E'),
 (ca_id('F'),'Fontaine','Lucas','97411','particulier',NULL,'CHAT-CA-F'),
 (ca_id('G'),'Lebon','Inès','97470','particulier',NULL,'CHAT-CA-G');
SELECT ca_as('director');
INSERT INTO colis(id,client_id,ref,statut,nb_colis,trackings_detail,dims_par_colis,casier) VALUES
 (ca_id('A1'),ca_id('A'),'EXP-CA-A1','mesure',2,'[{"number":"A1-1","fournisseur":"Shein"},{"number":"A1-2","fournisseur":"Amazon"}]',
  '[{"dimL":45,"dimW":32,"dimH":20,"poids":2.4},{"dimL":30,"dimW":25,"dimH":15,"poids":1.1}]','B-07'),
 (ca_id('B1'),ca_id('B'),'EXP-CA-B1','mesure',1,'[{"number":"B1-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','B-01'),
 (ca_id('C1'),ca_id('C'),'EXP-CA-C1','mesure',1,'[{"number":"C1-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','C-01'),
 (ca_id('C2'),ca_id('C'),'EXP-CA-C2','mesure',1,'[{"number":"C2-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','C-02'),
 (ca_id('D1'),ca_id('D'),'EXP-CA-D1','mesure',1,'[{"number":"D1-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','D-01'),
 (ca_id('E1'),ca_id('E'),'EXP-CA-E1','mesure',1,'[{"number":"E1-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','E-01'),
 (ca_id('G1'),ca_id('G'),'EXP-CA-G1','mesure',2,'[{"number":"G1-1"},{"number":"G1-2"}]',
  '[{"dimL":10,"dimW":10,"dimH":10,"poids":1},{"dimL":20,"dimW":20,"dimH":20,"poids":2}]','G-01');
-- A carton without its measures, as the former screen entered them (no team member can since 2026-09-10): its
-- arrival stamped as the server stamps it (fixture: triggers off). Not ready for the agreement.
SELECT ca_as('owner');
INSERT INTO colis(id,client_id,ref,statut,nb_colis,trackings_detail,dims_par_colis,casier) VALUES
 (ca_id('F1'),ca_id('F'),'EXP-CA-F1','receptionne',1,'[{"number":"F1-1"}]','[]','F-01');
SET LOCAL session_replication_role='replica';
UPDATE colis SET reception_dates=jsonb_build_array(jsonb_build_object('receivedAt',now(),'source','server')) WHERE id=ca_id('F1');
SET LOCAL session_replication_role='origin';
-- The reception task of E1 is followed by a colleague.
UPDATE staff_work_actions SET assignee_id=ca_id('colleague'),state='in_progress' WHERE colis_id=ca_id('E1') AND kind='reception';
SELECT ca_assert((SELECT count(*)=1 FROM staff_work_actions WHERE colis_id=ca_id('E1') AND kind='reception' AND assignee_id=ca_id('colleague')),'fixture: the reception task of E1 is followed by a colleague');

-- ── C2. The notice that asks the agreement ──
SELECT ca_as('director');
DO $$
DECLARE r jsonb; m messages; o notification_outbox; v reception_validations;
BEGIN
 r:=validate_reception(ca_id('A'),jsonb_build_array(jsonb_build_object('colisId',ca_id('A1'),'fromCarton',1,'throughCarton',2)),true,'telegram','arrivee_colis_facture',
  'Bonjour Flavie, vos 2 colis sont arrivés.','c1400000-0000-4000-8000-000000000001',
  'Bonjour Flavie, vos 2 colis sont arrivés. Souhaitez-vous que nous préparions votre envoi ?');
 PERFORM set_config('ca.validation',r::text,true);
 IF (r->>'consentAsked')::boolean IS NOT TRUE OR (r->>'reused')::boolean THEN RAISE EXCEPTION 'FAIL: consentAsked %',r; END IF;
 IF r->'message'->>'template'<>'demande_feu_vert' OR r->'message'->>'texte'<>'Bonjour Flavie, vos 2 colis sont arrivés. Souhaitez-vous que nous préparions votre envoi ?'
  OR r->'message'->>'colis_id'<>ca_id('A1')::text OR r->'message'->>'canal'<>'telegram' OR r->'message'->>'type'<>'staff' THEN
  RAISE EXCEPTION 'FAIL: the notice is the consent request: %',r->'message'; END IF;
 IF r->'validation'->>'template'<>'arrivee_colis_facture' OR r->'validation'->>'canal'<>'telegram' THEN RAISE EXCEPTION 'FAIL: the validation keeps its notice variant'; END IF;
 IF r->'outbox'->>'status'<>'pending' OR r->'outbox'->>'idempotency_key'<>'arrival:'||(r->'validation'->>'id')
  OR r->'outbox'->'reply_markup'<>jsonb_build_object('inline_keyboard',jsonb_build_array(
   jsonb_build_array(jsonb_build_object('text','Autoriser la préparation','callback_data','fv_oui_'||ca_id('A1')::text)),
   jsonb_build_array(jsonb_build_object('text','Attendre mes autres colis','callback_data','fv_wait_'||ca_id('A1')::text),
    jsonb_build_object('text','Refuser','callback_data','fv_non_'||ca_id('A1')::text)))) THEN
  RAISE EXCEPTION 'FAIL: delivery with the buttons of its dossier: %',r->'outbox'; END IF;
 IF (r->'message'->'request_snapshot'->>'consent_request_version') IS NULL OR r->'message'->'request_snapshot'->>'invoice_requested'<>'true'
  OR r->'message'->'request_snapshot'->'nb_colis'<>'2'::jsonb THEN RAISE EXCEPTION 'FAIL: snapshot of the request: %',r->'message'->'request_snapshot'; END IF;
END $$;
SELECT ca_assert(ca_statut(ca_id('A1'))='attente_feu_vert','the dossier waits for its client (attente_feu_vert), as after « Demander l’accord »');
SELECT ca_assert((SELECT count(*)=1 FROM jsonb_array_elements(list_arrival_notices(ca_id('A'))) n WHERE n->'message'->>'template'='demande_feu_vert' AND n->>'template'='arrivee_colis_facture'),
 'the arrival notices say the notice also asked the agreement');
SELECT ca_assert((SELECT count(*)=1 FROM messages WHERE colis_id=ca_id('A1')) AND (SELECT count(*)=1 FROM notification_outbox WHERE colis_id=ca_id('A1')),'one message, one delivery');
SELECT ca_assert((SELECT after_data IS NOT NULL AND (detail::jsonb->>'consentAsked')::boolean FROM audit_actions WHERE colis_id=ca_id('A1') AND action='reception_validated'),'the journal says the agreement was asked');
-- The replay of the same request: the recorded result, nothing more.
DO $$
DECLARE r jsonb;
BEGIN
 r:=validate_reception(ca_id('A'),jsonb_build_array(jsonb_build_object('colisId',ca_id('A1'),'fromCarton',1,'throughCarton',2)),true,'telegram','arrivee_colis_facture',
  'Bonjour Flavie, vos 2 colis sont arrivés.','c1400000-0000-4000-8000-000000000001',
  'Bonjour Flavie, vos 2 colis sont arrivés. Souhaitez-vous que nous préparions votre envoi ?');
 IF NOT (r->>'reused')::boolean OR NOT (r->>'consentAsked')::boolean OR r->'message'->>'id'<>(current_setting('ca.validation')::jsonb)->'message'->>'id' THEN RAISE EXCEPTION 'FAIL: replay %',r; END IF;
END $$;
SELECT ca_assert((SELECT count(*)=1 FROM messages WHERE colis_id=ca_id('A1')),'a replayed request sends nothing more');
SELECT ca_reject($q$SELECT validate_reception(ca_id('A'),jsonb_build_array(jsonb_build_object('colisId',ca_id('A1'),'fromCarton',1,'throughCarton',2)),true,'telegram','arrivee_colis_facture',
  'Bonjour Flavie, vos 2 colis sont arrivés.','c1400000-0000-4000-8000-000000000001',NULL)$q$,'the same request without its consent text: another content','40001');
-- The client's decision on the buttons of that notice: the consent of « Demander l’accord ».
SELECT ca_as('owner');
SELECT ca_deliver(((current_setting('ca.validation')::jsonb)->'message'->>'id')::uuid,now());
SELECT ca_as('service');
SELECT ca_assert((telegram_client_decision(ca_id('A1'),'approve','CHAT-CA-A','tg-'||left((current_setting('ca.validation')::jsonb)->'message'->>'id',8))).statut='autorise',
 'the client authorises from the notice: the dossier is to prepare');

-- ── C3. The plain notice, whenever the agreement cannot be asked with it ──
SELECT ca_as('director');
DO $$
DECLARE r jsonb;
BEGIN
 -- Several dossiers: one notice for all, no buttons (a decision applies to one dossier).
 r:=validate_reception(ca_id('C'),jsonb_build_array(ca_item('C1'),ca_item('C2')),true,'telegram','arrivee_colis','Bonjour Lucie, vos 2 colis sont arrivés.',
  'c1400000-0000-4000-8000-000000000002','Bonjour Lucie… préparons-nous ?');
 IF (r->>'consentAsked')::boolean OR r->'message'->>'template'<>'arrivee_colis' OR r->'message'->>'texte'<>'Bonjour Lucie, vos 2 colis sont arrivés.' OR r->'outbox'->'reply_markup'<>'null'::jsonb THEN
  RAISE EXCEPTION 'FAIL: several dossiers: %',r; END IF;
 -- E-mail: the notice is a draft to send by hand, without buttons.
 r:=validate_reception(ca_id('B'),jsonb_build_array(ca_item('B1')),true,'email','arrivee_colis','Bonjour Marc, votre colis est arrivé.',
  'c1400000-0000-4000-8000-000000000003','Bonjour Marc… préparons-nous ?');
 IF (r->>'consentAsked')::boolean OR r->'message'->>'template'<>'arrivee_colis' OR r->'outbox'->>'status'<>'manual' THEN RAISE EXCEPTION 'FAIL: e-mail: %',r; END IF;
 -- The reception task followed by a colleague: the agreement stays with that colleague.
 r:=validate_reception(ca_id('E'),jsonb_build_array(ca_item('E1')),true,'telegram','arrivee_colis','Bonjour Sandrine, votre colis est arrivé.',
  'c1400000-0000-4000-8000-000000000004','Bonjour Sandrine… préparons-nous ?');
 IF (r->>'consentAsked')::boolean OR r->'message'->>'template'<>'arrivee_colis' THEN RAISE EXCEPTION 'FAIL: task followed by a colleague: %',r; END IF;
 -- A carton without its measures: nothing to agree on yet.
 r:=validate_reception(ca_id('F'),jsonb_build_array(ca_item('F1')),true,'telegram','arrivee_colis','Bonjour Lucas, votre colis est arrivé.',
  'c1400000-0000-4000-8000-000000000005','Bonjour Lucas… préparons-nous ?');
 IF (r->>'consentAsked')::boolean OR r->'message'->>'template'<>'arrivee_colis' THEN RAISE EXCEPTION 'FAIL: not measured: %',r; END IF;
 -- Carton n° 1 of two: the second waits for a next validation, the agreement (for the whole dossier) is not asked yet.
 r:=validate_reception(ca_id('G'),jsonb_build_array(ca_item('G1')),true,'telegram','arrivee_colis','Bonjour Inès, votre colis est arrivé.',
  'c1400000-0000-4000-8000-000000000007','Bonjour Inès… préparons-nous ?');
 IF (r->>'consentAsked')::boolean OR r->'message'->>'template'<>'arrivee_colis' OR r->'outbox'->'reply_markup'<>'null'::jsonb THEN
  RAISE EXCEPTION 'FAIL: a carton left for a next validation: %',r; END IF;
END $$;
SELECT ca_assert(ca_statut(ca_id('C1'))='mesure' AND ca_statut(ca_id('C2'))='mesure' AND ca_statut(ca_id('B1'))='mesure' AND ca_statut(ca_id('E1'))='mesure'
 AND ca_statut(ca_id('F1'))='receptionne' AND ca_statut(ca_id('G1'))='mesure','with the plain notice, the dossiers keep their step (the agreement stays to ask)');
SELECT ca_as('receiver');
DO $$
DECLARE r jsonb;
BEGIN
 -- A member allowed to validate and to write, not to ask the agreement.
 r:=validate_reception(ca_id('D'),jsonb_build_array(ca_item('D1')),true,'telegram','arrivee_colis','Bonjour Paul, votre colis est arrivé.',
  'c1400000-0000-4000-8000-000000000006','Bonjour Paul… préparons-nous ?');
 IF (r->>'consentAsked')::boolean OR r->'message'->>'template'<>'arrivee_colis' THEN RAISE EXCEPTION 'FAIL: without perm_colis_demander_feuvert: %',r; END IF;
END $$;
SELECT ca_assert(ca_statut(ca_id('D1'))='mesure','without the permission to ask the agreement, the plain notice');

-- ── C4. Refusals ──
SELECT ca_as('director');
SELECT ca_reject($q$SELECT validate_reception(ca_id('D'),jsonb_build_array(ca_item('D1')),false,NULL,NULL,NULL,gen_random_uuid(),'Préparons-nous ?')$q$,
 'a consent text without notice','22023','Sans avis, ne transmettez ni canal, ni modèle, ni texte.');
SELECT ca_reject($q$SELECT validate_reception(ca_id('D'),jsonb_build_array(ca_item('D1')),true,'telegram','arrivee_colis','Bonjour',gen_random_uuid(),'   ')$q$,
 'a blank consent text','22023','Le texte de l’avis avec la demande d’accord doit contenir de 1 à 4096 caractères.');
SELECT ca_reject($q$SELECT validate_reception(ca_id('D'),jsonb_build_array(ca_item('D1')),true,'telegram','arrivee_colis','Bonjour',gen_random_uuid(),repeat('x',4097))$q$,
 'a consent text over 4096 characters','22023');

-- ── C5. The reminders due ──
SELECT ca_reject($q$SELECT consent_reminders_due()$q$,'a team member does not list the reminders','42501');
SELECT ca_as('anon');
SELECT ca_reject($q$SELECT consent_reminders_due()$q$,'anonymous','42501');
-- A2: a second dossier of A, asked by « Demander l’accord » and delivered now.
SELECT ca_as('director');
INSERT INTO colis(id,client_id,ref,statut,nb_colis,trackings_detail,dims_par_colis,casier) VALUES
 ('c1300000-0000-4000-8000-000000000101',ca_id('A'),'EXP-CA-A2','mesure',1,'[{"number":"A2-1"}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":1}]','A-02');
SELECT ca_as('owner');
DO $$
DECLARE q jsonb;
BEGIN
 PERFORM ca_as('service');
 q:=queue_message('c1300000-0000-4000-8000-000000000101','Bonjour Flavie, autorisez-vous la préparation ?','demande_feu_vert','ca-request-a2',
  ca_buttons('c1300000-0000-4000-8000-000000000101'),'telegram',0);
 PERFORM ca_as('owner');
 PERFORM ca_deliver((q->'message'->>'id')::uuid,now());
END $$;
SELECT ca_as('service');
SELECT ca_assert(ca_due(now()+interval '47 hours 59 minutes')='[]'::jsonb,'nothing before 48 hours');
SELECT ca_assert((SELECT jsonb_array_length(d)=1 AND d->0->>'colisId'='c1300000-0000-4000-8000-000000000101' AND d->0->>'ref'='EXP-CA-A2'
  AND (d->0->>'number')::integer=1 AND d->0->>'clientId'=ca_id('A')::text AND d->0->>'destinationCode'='974' AND (d->0->>'consentVersion')::integer=0
  FROM ca_due(now()+interval '48 hours 1 minute') d),'reminder n° 1 is due 48 hours after the request reached the client');
-- The worker queues it (consent-reminder key), Telegram delivers it 48 h after the request.
SELECT ca_as('owner');
DO $$
DECLARE q jsonb;
BEGIN
 PERFORM ca_as('service');
 q:=queue_message('c1300000-0000-4000-8000-000000000101','Rappel : votre accord est attendu.','relance_feu_vert','consent-reminder:c1300000-0000-4000-8000-000000000101:0:1',
  ca_buttons('c1300000-0000-4000-8000-000000000101'),'telegram',0);
 PERFORM set_config('ca.reminder',q->'message'->>'id',true);
 PERFORM ca_as('service');
 IF ca_due(now()+interval '49 hours')<>'[]'::jsonb THEN RAISE EXCEPTION 'FAIL: a reminder to deliver is a delivery in progress'; END IF;
 PERFORM ca_as('owner');
 PERFORM ca_deliver((q->'message'->>'id')::uuid,now()+interval '48 hours');
END $$;
SELECT ca_as('service');
SELECT ca_assert(ca_due(now()+interval '71 hours 59 minutes')='[]'::jsonb,'nothing within 24 hours of the first reminder');
SELECT ca_assert((SELECT jsonb_array_length(d)=1 AND (d->0->>'number')::integer=2 FROM ca_due(now()+interval '72 hours 1 minute') d),'reminder n° 2 is due 24 hours after the first');
-- A relance sent by the team counts: two reminders, then nothing more.
SELECT ca_as('owner');
DO $$
DECLARE q jsonb;
BEGIN
 PERFORM ca_as('director');
 q:=queue_message('c1300000-0000-4000-8000-000000000101','Bonjour Flavie, un petit rappel.','relance_feu_vert','ca-team-relance',
  ca_buttons('c1300000-0000-4000-8000-000000000101'),'telegram',0);
 PERFORM ca_as('owner');
 PERFORM ca_deliver((q->'message'->>'id')::uuid,now()+interval '73 hours');
END $$;
SELECT ca_as('service');
SELECT ca_assert(ca_due(now()+interval '30 days')='[]'::jsonb,'two reminders sent (one by the team): no third');

-- E1 (plain notice): asked later by the team, then each case where nothing is due.
SELECT ca_as('owner');
UPDATE staff_work_actions SET assignee_id=NULL,state='ready' WHERE colis_id=ca_id('E1') AND kind='reception';
DO $$
DECLARE q jsonb;
BEGIN
 PERFORM ca_as('director');
 q:=queue_message(ca_id('E1'),'Bonjour Sandrine, autorisez-vous la préparation ?','demande_feu_vert','ca-request-e1',ca_buttons(ca_id('E1')),'telegram',0);
 PERFORM set_config('ca.request_e1',q->'message'->>'id',true);
 PERFORM ca_as('owner');
 PERFORM ca_deliver((q->'message'->>'id')::uuid,now());
END $$;
SELECT ca_as('service');
SELECT ca_assert((SELECT count(*)=1 FROM jsonb_array_elements(ca_due(now()+interval '49 hours')) d WHERE d->>'colisId'=ca_id('E1')::text),'E1: reminder n° 1 due');
-- The client writes: his conversation waits for the team, no reminder.
SELECT ca_as('owner');
UPDATE colis SET conversation_statut='a_traiter' WHERE id=ca_id('E1');
SELECT ca_as('service');
SELECT ca_assert(ca_due(now()+interval '49 hours')='[]'::jsonb,'an open conversation suspends the reminders');
SELECT ca_as('owner');
UPDATE colis SET conversation_statut='termine' WHERE id=ca_id('E1');
-- The client chose to wait: respected.
UPDATE colis SET attente_client_date=now() WHERE id=ca_id('E1');
SELECT ca_as('service');
SELECT ca_assert(ca_due(now()+interval '49 hours')='[]'::jsonb,'a wait chosen by the client is never relanced');
SELECT ca_as('owner');
UPDATE colis SET attente_client_date=NULL WHERE id=ca_id('E1');
-- A history: the settings start after the request.
UPDATE app_settings SET value=jsonb_set(value,'{relancesAccordAuto,depuis}',to_jsonb(to_char((now()+interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))) WHERE key='business';
SELECT ca_as('service');
SELECT ca_assert(ca_due(now()+interval '49 hours')='[]'::jsonb,'a request delivered before the start of the automatic reminders is never relanced');
SELECT ca_as('owner');
UPDATE app_settings SET value=jsonb_set(value,'{relancesAccordAuto,depuis}','"2026-01-01T00:00:00Z"') WHERE key='business';
-- Off, or unreadable: nothing.
UPDATE app_settings SET value=jsonb_set(value,'{relancesAccordAuto,actif}','false') WHERE key='business';
SELECT ca_as('service');
SELECT ca_assert(ca_due(now()+interval '49 hours')='[]'::jsonb,'settings off: nothing');
SELECT ca_as('owner');
UPDATE app_settings SET value=jsonb_set(jsonb_set(value,'{relancesAccordAuto,actif}','true'),'{relancesAccordAuto,depuis}','"hier"') WHERE key='business';
SELECT ca_as('service');
SELECT ca_assert(ca_due(now()+interval '49 hours')='[]'::jsonb,'an unreadable start: nothing (never the history)');
SELECT ca_as('owner');
UPDATE app_settings SET value=jsonb_set(value,'{relancesAccordAuto,depuis}','"2026-01-01T00:00:00Z"') WHERE key='business';
SELECT ca_as('service');
SELECT ca_assert((SELECT count(*)=1 FROM jsonb_array_elements(ca_due(now()+interval '49 hours')) d WHERE d->>'colisId'=ca_id('E1')::text),'E1: due again once the settings are back');
-- A reminder whose delivery failed: the team checks it, nothing more leaves on its own.
SELECT ca_as('owner');
DO $$
DECLARE q jsonb;
BEGIN
 PERFORM ca_as('service');
 q:=queue_message(ca_id('E1'),'Rappel.','relance_feu_vert','consent-reminder:'||ca_id('E1')::text||':0:1',ca_buttons(ca_id('E1')),'telegram',0);
 PERFORM ca_as('owner');
 UPDATE notification_outbox SET status='failed',last_error='Telegram n’a pas confirmé la livraison du message',attempts=1 WHERE message_id=(q->'message'->>'id')::uuid;
 UPDATE messages SET statut='echec' WHERE id=(q->'message'->>'id')::uuid;
END $$;
SELECT ca_as('service');
SELECT ca_assert(ca_due(now()+interval '30 days')='[]'::jsonb,'a failed reminder stops the automatic ones (the team checks the send)');
-- A new carton: a new consent version; the old request no longer counts.
SELECT ca_as('director');
SELECT append_reception_cartons(c.id,'[{"tracking":"A2-2","fournisseur":"Zara","dimL":20,"dimW":20,"dimH":20,"poids":1}]',c.updated_at,NULL,NULL,NULL,'c1500000-0000-4000-8000-000000000001')
 FROM colis c WHERE c.id='c1300000-0000-4000-8000-000000000101';
SELECT ca_as('service');
SELECT ca_assert(ca_due(now()+interval '30 days')='[]'::jsonb,'a request of an older consent version (a carton added since) is never relanced');
-- An e-mail client, asked by e-mail (a draft sent by hand): never relanced on its own.
SELECT ca_as('director');
SELECT (queue_message(ca_id('B1'),'Bonjour Marc, autorisez-vous la préparation ?','demande_feu_vert','ca-request-b1',NULL,'email',0))->'outbox'->>'status';
SELECT ca_assert(ca_statut(ca_id('B1'))='attente_feu_vert','fixture: B1 waits for its client (asked by e-mail)');
SELECT ca_as('service');
SELECT ca_assert((SELECT count(*)=0 FROM jsonb_array_elements(ca_due(now()+interval '30 days')) d WHERE d->>'clientId'=ca_id('B')::text),'an e-mail client: no automatic reminder');

ROLLBACK;
