-- Consent relance follow-up (2026-10-07, refined after the final verification review): the latest staff request or
-- relance is followed up until it reaches the client, then for 24 hours (from notification_outbox.sent_at; from its
-- creation for an e-mail draft or a portal message), never when its delivery failed or was cancelled; a client's
-- message never counts. Also: the hints of a consent still to ask, the closing of a desired day with a planned
-- departure, no closing for a departure that is closed or has left, the triggers that re-sync at once, the refresh
-- that brings the relance back, the outbox index and the grants.
-- Every check runs on the transaction clock (now() is fixed inside it): time passing is simulated by moving the saved
-- instants (messages.created_at and notification_outbox.sent_at), as the lot 3a test does.
BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
-- Function privileges of the release (this database has no default privileges, like production after the REVOKEs).
DO $$
DECLARE fn text;
BEGIN
 FOREACH fn IN ARRAY ARRAY['_consent_followup_until(colis)','trigger_sync_consent_followup()','_reception_work_hint(colis)','_colis_departure_closing(colis)','sync_staff_work_actions(uuid)'] LOOP
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE') THEN RAISE EXCEPTION 'FAIL: private function executable %',fn; END IF;
  IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid=fn::regprocedure) THEN RAISE EXCEPTION 'FAIL: definer security or search_path %',fn; END IF;
 END LOOP;
 IF has_function_privilege('anon','refresh_staff_work_actions()','EXECUTE') OR NOT has_function_privilege('authenticated','refresh_staff_work_actions()','EXECUTE')
  OR NOT (SELECT provolatile='s' FROM pg_proc WHERE oid='_consent_followup_until(colis)'::regprocedure) THEN RAISE EXCEPTION 'FAIL: refresh grants or helper volatility'; END IF;
 -- The four triggers: after the row is written, on the staff consent messages, their outbox rows and the delivery
 -- states that change the follow-up only.
 IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled='O' AND (
   (t.tgname='z_sync_consent_request_work' AND t.tgrelid='public.messages'::regclass AND pg_get_triggerdef(t.oid)='CREATE TRIGGER z_sync_consent_request_work AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.type = ''staff''::type_message) AND (new.template = ANY (ARRAY[''demande_feu_vert''::text, ''relance_feu_vert''::text])))) EXECUTE FUNCTION trigger_sync_consent_followup()')
   OR (t.tgname='z_sync_consent_request_failure' AND t.tgrelid='public.messages'::regclass AND pg_get_triggerdef(t.oid)='CREATE TRIGGER z_sync_consent_request_failure AFTER UPDATE OF statut ON public.messages FOR EACH ROW WHEN (((new.type = ''staff''::type_message) AND (new.template = ANY (ARRAY[''demande_feu_vert''::text, ''relance_feu_vert''::text])) AND (old.statut IS DISTINCT FROM new.statut) AND ((old.statut = ''echec''::statut_message) OR (new.statut = ''echec''::statut_message)))) EXECUTE FUNCTION trigger_sync_consent_followup()')
   OR (t.tgname='z_sync_consent_delivery_queued' AND t.tgrelid='public.notification_outbox'::regclass AND pg_get_triggerdef(t.oid)='CREATE TRIGGER z_sync_consent_delivery_queued AFTER INSERT ON public.notification_outbox FOR EACH ROW WHEN ((new.status <> ''manual''::text)) EXECUTE FUNCTION trigger_sync_consent_followup()')
   OR (t.tgname='z_sync_consent_delivery_work' AND t.tgrelid='public.notification_outbox'::regclass AND pg_get_triggerdef(t.oid)='CREATE TRIGGER z_sync_consent_delivery_work AFTER UPDATE OF status ON public.notification_outbox FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) AND (NOT ((old.status = ANY (ARRAY[''pending''::text, ''blocked''::text, ''sending''::text])) AND (new.status = ANY (ARRAY[''pending''::text, ''blocked''::text, ''sending''::text])))))) EXECUTE FUNCTION trigger_sync_consent_followup()')))<>4
  OR (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'z_sync_consent%')<>4
  THEN RAISE EXCEPTION 'FAIL: consent follow-up triggers'; END IF;
 -- The outbox is indexed on its message (the follow-up and send-telegram read the rows of one message).
 IF (SELECT pg_get_indexdef(to_regclass('public.notification_outbox_message_id'))) IS DISTINCT FROM 'CREATE INDEX notification_outbox_message_id ON public.notification_outbox USING btree (message_id)'
  THEN RAISE EXCEPTION 'FAIL: outbox message index'; END IF;
 RAISE NOTICE 'PASS: S1 private helpers, unchanged grants of the replaced functions, the four triggers and the outbox index';
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;

CREATE FUNCTION crf_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
CREATE FUNCTION crf_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role',CASE who WHEN 'postgres' THEN '' ELSE 'authenticated' END,true);
 PERFORM set_config('request.jwt.claim.sub',CASE who WHEN 'director' THEN 'cf000000-0000-4000-8000-000000000001' WHEN 'preparateur' THEN 'cf000000-0000-4000-8000-000000000002'
  WHEN 'client' THEN 'cf000000-0000-4000-8000-000000000004' ELSE '' END,true);
 IF who<>'postgres' THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
END $$;
-- Paris calendar day relative to the transaction clock.
CREATE FUNCTION crf_day(n integer) RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Europe/Paris')::date+n $$;
CREATE FUNCTION crf_reception(p_colis uuid) RETURNS staff_work_actions LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM staff_work_actions WHERE colis_id=p_colis AND kind='reception' $$;
CREATE FUNCTION crf_colis(p_colis uuid) RETURNS colis LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM colis WHERE id=p_colis $$;
CREATE FUNCTION crf_version(p_colis uuid) RETURNS timestamptz LANGUAGE sql SECURITY DEFINER AS $$ SELECT updated_at FROM colis WHERE id=p_colis $$;
CREATE FUNCTION crf_until(p_colis uuid) RETURNS timestamptz LANGUAGE sql SECURITY DEFINER AS $$ SELECT _consent_followup_until(c) FROM colis c WHERE c.id=p_colis $$;
-- A staff consent message saved at a given instant, with its outbox row written « pending » and then moved to the
-- given status, as the delivery does (the triggers see that move); « sent » is dated p_sent_at (else p_at). A NULL
-- status writes no outbox row (a portal or older message).
CREATE FUNCTION crf_message(p_colis uuid,p_template text,p_at timestamptz,p_statut statut_message,p_outbox text,p_sent_at timestamptz DEFAULT NULL,p_canal text DEFAULT 'telegram') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE message uuid;
BEGIN
 INSERT INTO messages(colis_id,type,auteur_nom,texte,statut,canal,template,created_at)
 VALUES(p_colis,'staff','Équipe','Bonjour, pouvons-nous préparer vos cartons ?',p_statut,p_canal,p_template,p_at) RETURNING id INTO message;
 IF p_outbox IS NOT NULL THEN
  INSERT INTO notification_outbox(message_id,client_id,colis_id,canal,status) SELECT message,client_id,id,p_canal,'pending' FROM colis WHERE id=p_colis;
  IF p_outbox<>'pending' THEN UPDATE notification_outbox SET status=p_outbox,sent_at=CASE WHEN p_outbox='sent' THEN coalesce(p_sent_at,p_at) END WHERE message_id=message; END IF;
 END IF;
 RETURN message;
END $$;

-- ── Fixtures ──
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('cf000000-0000-4000-8000-000000000001','crf-director@example.test','{"nom":"Direction CRF"}'),('cf000000-0000-4000-8000-000000000002','crf-preparateur@example.test','{"nom":"Préparation CRF"}'),
 ('cf000000-0000-4000-8000-000000000003','crf-client@example.test','{"nom":"Flavie Payet"}'),('cf000000-0000-4000-8000-000000000004','crf-nadia@example.test','{"nom":"Nadia Jacoby"}');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('cf100000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','Direction CRF','crf-director@example.test','directeur',false),
 ('cf100000-0000-4000-8000-000000000002','cf000000-0000-4000-8000-000000000002','Préparation CRF','crf-preparateur@example.test','preparateur',false);
INSERT INTO staff_permissions(staff_id,perm_colis_receptionner,perm_colis_mesurer) VALUES('cf100000-0000-4000-8000-000000000002',true,true);
INSERT INTO clients(id,user_id,nom,prenom,cp,email,telegram_chat_id,type) VALUES
 ('cf200000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000003','Payet','Flavie','97400','crf-client@example.test','9001','particulier'),
 ('cf200000-0000-4000-8000-000000000002',NULL,'Hoarau','Lucas','97400','crf-lucas@example.test','9002','particulier'),
 -- Guadeloupe, with a client space: the portal client of S4 and the other destination of S6.
 ('cf200000-0000-4000-8000-000000000003','cf000000-0000-4000-8000-000000000004','Jacoby','Nadia','97110','crf-nadia@example.test','9003','particulier');
-- Departures with a loading closing of their own place the closing on the transaction clock: inside the 48-hour window
-- (E10, E36, EG36), before it (E60 opens in 12 hours, E72 in 24 hours). « pret » keeps them out of the automatic pick.
INSERT INTO envois(id,destination_code,date_depart,statut,loading_closes_at) VALUES
 ('cf400000-0000-4000-8000-000000000010','974',crf_day(4),'pret',now()+interval '10 hours'),
 ('cf400000-0000-4000-8000-000000000036','974',crf_day(5),'pret',now()+interval '36 hours'),
 ('cf400000-0000-4000-8000-000000000037','971',crf_day(5),'pret',now()+interval '36 hours'),
 ('cf400000-0000-4000-8000-000000000060','974',crf_day(6),'pret',now()+interval '60 hours'),
 ('cf400000-0000-4000-8000-000000000072','974',crf_day(7),'pret',now()+interval '72 hours'),
 -- Departures that will be archived or leave while dossiers are assigned to them (S6).
 ('cf400000-0000-4000-8000-000000000126','974',crf_day(8),'pret',now()+interval '30 hours'),
 ('cf400000-0000-4000-8000-000000000127','974',crf_day(9),'pret',now()+interval '30 hours'),
 -- Desired days: a Réunion departure planned on day 20 closing in 30 hours, a Guadeloupe one on day 21, a Réunion one
 -- on day 22 whose loading closed an hour ago, a Réunion one on day 24 that will have left, an archived one on day 25.
 ('cf400000-0000-4000-8000-000000000120','974',crf_day(20),'planifie',now()+interval '30 hours'),
 ('cf400000-0000-4000-8000-000000000121','971',crf_day(21),'planifie',now()+interval '30 hours'),
 ('cf400000-0000-4000-8000-000000000122','974',crf_day(22),'planifie',now()-interval '1 hour'),
 ('cf400000-0000-4000-8000-000000000124','974',crf_day(24),'planifie',NULL),
 ('cf400000-0000-4000-8000-000000000125','974',crf_day(25),'planifie',NULL);
SELECT set_config('expedile.confirm_departure','allowed',true);
UPDATE envois SET statut='parti',departed_at=now()-interval '1 hour',manifest_version=1 WHERE id='cf400000-0000-4000-8000-000000000124';
SELECT set_config('expedile.confirm_departure','',true);
UPDATE envois SET statut='archive' WHERE id='cf400000-0000-4000-8000-000000000125';
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,depart_souhaite,nb_colis,dim_l,dim_w,dim_h,poids) VALUES
 -- S2: a consent still to ask
 ('cf300000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001','CRF-R1','receptionne',NULL,'cf400000-0000-4000-8000-000000000036',NULL,1,NULL,NULL,NULL,NULL),
 ('cf300000-0000-4000-8000-000000000002','cf200000-0000-4000-8000-000000000001','CRF-R2','mesure',NULL,'cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000003','cf200000-0000-4000-8000-000000000001','CRF-R3','receptionne',NULL,'cf400000-0000-4000-8000-000000000060',NULL,1,NULL,NULL,NULL,NULL),
 ('cf300000-0000-4000-8000-000000000004','cf200000-0000-4000-8000-000000000001','CRF-R4','mesure',NULL,'cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000005','cf200000-0000-4000-8000-000000000001','CRF-R5','receptionne',NULL,'cf400000-0000-4000-8000-000000000036',NULL,1,NULL,NULL,NULL,NULL),
 -- S3: the real commands
 ('cf300000-0000-4000-8000-000000000011','cf200000-0000-4000-8000-000000000001','CRF-Q1','mesure',NULL,'cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000012','cf200000-0000-4000-8000-000000000001','CRF-Q2','mesure',NULL,'cf400000-0000-4000-8000-000000000010',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000013','cf200000-0000-4000-8000-000000000001','CRF-Q3','mesure',NULL,'cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000014','cf200000-0000-4000-8000-000000000001','CRF-Q4','mesure',NULL,'cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 -- S6: desired days and closed departures
 ('cf300000-0000-4000-8000-000000000041','cf200000-0000-4000-8000-000000000002','CRF-W1','mesure',NULL,NULL,crf_day(20),1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000042','cf200000-0000-4000-8000-000000000002','CRF-W2','mesure',NULL,NULL,crf_day(21),1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000044','cf200000-0000-4000-8000-000000000002','CRF-W4','mesure',NULL,NULL,crf_day(22),1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000045','cf200000-0000-4000-8000-000000000002','CRF-W5','receptionne',NULL,NULL,crf_day(20),1,NULL,NULL,NULL,NULL),
 ('cf300000-0000-4000-8000-000000000046','cf200000-0000-4000-8000-000000000002','CRF-W6','mesure',NULL,NULL,crf_day(23),1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000047','cf200000-0000-4000-8000-000000000002','CRF-W7','mesure',NULL,NULL,crf_day(24),1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000048','cf200000-0000-4000-8000-000000000002','CRF-W8','mesure',NULL,NULL,crf_day(25),1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000049','cf200000-0000-4000-8000-000000000002','CRF-W9','mesure',NULL,'cf400000-0000-4000-8000-000000000126',NULL,1,40,30,20,5);
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,depart_souhaite,nb_colis,dim_l,dim_w,dim_h,poids) VALUES
 -- S4: an awaited consent and its messages
 ('cf300000-0000-4000-8000-000000000021','cf200000-0000-4000-8000-000000000001','CRF-A1','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000022','cf200000-0000-4000-8000-000000000001','CRF-A2','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000010',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000023','cf200000-0000-4000-8000-000000000001','CRF-A3','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000024','cf200000-0000-4000-8000-000000000001','CRF-A4','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000025','cf200000-0000-4000-8000-000000000001','CRF-A5','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000026','cf200000-0000-4000-8000-000000000001','CRF-A6','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000027','cf200000-0000-4000-8000-000000000001','CRF-A7','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000028','cf200000-0000-4000-8000-000000000001','CRF-A8','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000029','cf200000-0000-4000-8000-000000000001','CRF-A9','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000030','cf200000-0000-4000-8000-000000000001','CRF-A10','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000060',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000031','cf200000-0000-4000-8000-000000000001','CRF-A11','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000072',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000032','cf200000-0000-4000-8000-000000000001','CRF-A12','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000033','cf200000-0000-4000-8000-000000000001','CRF-A13','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000034','cf200000-0000-4000-8000-000000000001','CRF-A14','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000035','cf200000-0000-4000-8000-000000000001','CRF-A15','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000036','cf200000-0000-4000-8000-000000000001','CRF-A16','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000037','cf200000-0000-4000-8000-000000000001','CRF-A17','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000038','cf200000-0000-4000-8000-000000000001','CRF-A18','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000039','cf200000-0000-4000-8000-000000000001','CRF-A19','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000050','cf200000-0000-4000-8000-000000000001','CRF-A20','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000051','cf200000-0000-4000-8000-000000000001','CRF-A21','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000052','cf200000-0000-4000-8000-000000000001','CRF-A22','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000053','cf200000-0000-4000-8000-000000000003','CRF-A23','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000037',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000054','cf200000-0000-4000-8000-000000000001','CRF-A24','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000036',NULL,1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000043','cf200000-0000-4000-8000-000000000002','CRF-W3','attente_feu_vert','en_attente',NULL,crf_day(20),1,40,30,20,5),
 ('cf300000-0000-4000-8000-000000000055','cf200000-0000-4000-8000-000000000002','CRF-W10','attente_feu_vert','en_attente','cf400000-0000-4000-8000-000000000127',NULL,1,40,30,20,5);
-- Voluntary waits are recorded after the receipts: a new receipt of the same client resumes them.
UPDATE colis SET attente_client_motif='Attend d’autres colis',attente_client_date=now()-interval '1 day',attente_client_until=now()+interval '5 days' WHERE id='cf300000-0000-4000-8000-000000000028';
UPDATE colis SET attente_client_motif='Attend d’autres colis',attente_client_date=now()-interval '2 days',attente_client_until=now()-interval '1 day' WHERE id='cf300000-0000-4000-8000-000000000029';

-- ── S2. A consent still to ask: receptionne measures first, mesure asks; the follow-up never applies to them ──
SELECT crf_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Mesurer puis demander l’accord avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000001')),'S2 receptionne inside the window: measure then ask consent, due at the closing');
SELECT crf_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Demander l’accord avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000002')),'S2 mesure inside the window: ask consent (wording unchanged)');
SELECT crf_assert((SELECT state='ready' AND action_hint IS NULL AND due_at IS NULL FROM crf_reception('cf300000-0000-4000-8000-000000000003')),'S2 receptionne before the window: no hint');
-- A request of an earlier set of cartons (a carton was added since) never makes the measure or the new request wait.
SELECT crf_message('cf300000-0000-4000-8000-000000000004','demande_feu_vert',now()-interval '1 hour','envoye','sent');
SELECT crf_message('cf300000-0000-4000-8000-000000000005','relance_feu_vert',now()-interval '1 hour','envoi','pending');
SELECT crf_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Demander l’accord avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000004'))
  AND (SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Mesurer puis demander l’accord avant la clôture du départ' FROM crf_reception('cf300000-0000-4000-8000-000000000005')),'S2 a recent or queued message of an earlier request leaves the consent to ask actionable');

-- ── S3. The real commands: a request, its delivery, a failure, a confirmed retry, a relance, a cancelled one ──
SELECT crf_as('director');
SELECT queue_message('cf300000-0000-4000-8000-000000000011','Bonjour Flavie, pouvons-nous préparer vos cartons ?','demande_feu_vert','crf-q1-request',NULL,'telegram');
SELECT crf_as('postgres');
SELECT crf_assert((SELECT statut='attente_feu_vert' FROM crf_colis('cf300000-0000-4000-8000-000000000011'))
  AND (SELECT status='pending' FROM notification_outbox WHERE idempotency_key='crf-q1-request')
  AND (SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000011'))
  AND crf_until('cf300000-0000-4000-8000-000000000011')='infinity' AND _reception_work_hint(crf_colis('cf300000-0000-4000-8000-000000000011')) IS NULL,
  'S3 the request just queued is followed up until its delivery: the task waits, due at the closing, no relance hint');
-- The delivery is claimed (nothing changes), then fails: the relance is due again at the closing.
UPDATE notification_outbox SET status='sending',locked_at=now() WHERE idempotency_key='crf-q1-request';
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000011')),'S3 a delivery in progress keeps the follow-up');
UPDATE notification_outbox SET status='failed',last_error='Telegram n’a pas confirmé la livraison du message' WHERE idempotency_key='crf-q1-request';
SELECT crf_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000011')),'S3 a failed delivery ends the follow-up at once: relance due at the closing');
UPDATE messages SET statut='echec' WHERE id=(SELECT message_id FROM notification_outbox WHERE idempotency_key='crf-q1-request');
SELECT crf_assert((SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' FROM crf_reception('cf300000-0000-4000-8000-000000000011')),'S3 the failed message keeps the relance');
-- A confirmed retry (send-telegram: failed → pending) is a delivery to come again: the follow-up holds until it lands,
-- even while the message still reads « echec » from the first attempt.
UPDATE notification_outbox SET status='pending',available_at=now(),last_error=NULL WHERE idempotency_key='crf-q1-request' AND status='failed';
SELECT crf_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000011'))
  AND (SELECT statut='echec' FROM messages WHERE id=(SELECT message_id FROM notification_outbox WHERE idempotency_key='crf-q1-request')),'S3 a retry to deliver holds the relance, over the « echec » of the first attempt');
UPDATE notification_outbox SET status='sending',locked_at=now() WHERE idempotency_key='crf-q1-request';
UPDATE messages SET statut='envoye' WHERE id=(SELECT message_id FROM notification_outbox WHERE idempotency_key='crf-q1-request');
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000011')),'S3 the retry being sent still holds');
UPDATE notification_outbox SET status='sent',sent_at=now() WHERE idempotency_key='crf-q1-request';
SELECT crf_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=now()+interval '24 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000011'))
  AND crf_until('cf300000-0000-4000-8000-000000000011')=now()+interval '24 hours','S3 once delivered, the follow-up lasts 24 hours from the delivery');
-- Two hours later (simulated), the team sends a relance: it is followed up in turn, held until it is delivered.
-- Simulated time: a recorded message and a confirmed delivery are final since 20261010000001, so they are moved back
-- with triggers off.
SET LOCAL session_replication_role='replica';
UPDATE messages SET created_at=now()-interval '2 hours' WHERE id=(SELECT message_id FROM notification_outbox WHERE idempotency_key='crf-q1-request');
UPDATE notification_outbox SET sent_at=now()-interval '2 hours' WHERE idempotency_key='crf-q1-request';
SET LOCAL session_replication_role='origin';
SELECT crf_as('director');
SELECT queue_message('cf300000-0000-4000-8000-000000000011','Bonjour Flavie, votre accord est toujours attendu.','relance_feu_vert','crf-q1-relance',NULL,'telegram');
SELECT crf_as('postgres');
SELECT crf_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000011')),'S3 the relance just queued is followed up until its delivery: due at the closing');
-- dispatchOutbox claims it, then reschedules it after the last relance of this client + 24 hours: still to deliver.
UPDATE notification_outbox SET status='sending',locked_at=now() WHERE idempotency_key='crf-q1-relance';
UPDATE notification_outbox SET status='pending',available_at=now()+interval '22 hours',last_error='Un rappel a déjà été envoyé à ce client dans les dernières 24 heures' WHERE idempotency_key='crf-q1-relance';
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000011'))
  AND crf_until('cf300000-0000-4000-8000-000000000011')='infinity','S3 a relance rescheduled by the 24-hour client rule holds the relance');
-- Cancelled before delivery (its message stays « envoi »): the relance is due again.
UPDATE notification_outbox SET status='cancelled',last_error='Le dossier ou la demande a changé.' WHERE idempotency_key='crf-q1-relance';
SELECT crf_assert((SELECT statut='envoi' FROM messages WHERE id=(SELECT message_id FROM notification_outbox WHERE idempotency_key='crf-q1-relance'))
  AND (SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000011')),'S3 a cancelled relance (message still « envoi ») ends the follow-up');
-- The client chooses to wait: never relanced.
SELECT _apply_client_decision('cf300000-0000-4000-8000-000000000011','wait',NULL,NULL,'Attend d’autres colis','Client (Telegram)');
SELECT crf_assert((SELECT state='waiting' AND blocked_reason='Attente volontaire du client' AND action_hint IS NULL FROM crf_reception('cf300000-0000-4000-8000-000000000011')),'S3 a voluntary wait is never relanced');
-- A request whose departure closes within 10 hours waits until the closing only.
SELECT crf_as('director');
SELECT queue_message('cf300000-0000-4000-8000-000000000012','Bonjour Flavie, pouvons-nous préparer vos cartons ?','demande_feu_vert','crf-q2-request',NULL,'telegram');
-- An e-mail request is a manual draft the team wrote, a portal request a message of the client space: the team acted,
-- they are followed up 24 hours from their creation (no delivery is claimed).
SELECT queue_message('cf300000-0000-4000-8000-000000000013','Bonjour Flavie, pouvons-nous préparer vos cartons ?','demande_feu_vert','crf-q3-request',NULL,'email');
SELECT queue_message('cf300000-0000-4000-8000-000000000014','Bonjour Flavie, pouvons-nous préparer vos cartons ?','demande_feu_vert','crf-q4-request',NULL,'portal');
SELECT crf_as('postgres');
SELECT crf_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=now()+interval '10 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000012')),'S3 the follow-up is due at the closing when the closing comes first');
SELECT crf_assert((SELECT o.status='manual' AND m.statut='envoi' FROM notification_outbox o JOIN messages m ON m.id=o.message_id WHERE o.idempotency_key='crf-q3-request')
  AND (SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '24 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000013'))
  AND crf_until('cf300000-0000-4000-8000-000000000013')=now()+interval '24 hours','S3 an e-mail draft request is followed up 24 hours from its creation');
SELECT crf_assert((SELECT o.status='sent' AND o.sent_at IS NULL AND m.statut='envoye' FROM notification_outbox o JOIN messages m ON m.id=o.message_id WHERE o.idempotency_key='crf-q4-request')
  AND (SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '24 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000014')),'S3 a portal request is followed up 24 hours from its creation');

-- ── S4. The latest staff request or relance decides, from its delivery ──
SELECT crf_message('cf300000-0000-4000-8000-000000000021','demande_feu_vert',now()-interval '2 hours','envoye','sent');
SELECT crf_message('cf300000-0000-4000-8000-000000000022','relance_feu_vert',now()-interval '1 hour','envoye','sent');
SELECT crf_message('cf300000-0000-4000-8000-000000000023','demande_feu_vert',now()-interval '3 hours','envoye','sent');
SELECT crf_message('cf300000-0000-4000-8000-000000000023','relance_feu_vert',now()-interval '1 hour','echec','failed');
SELECT crf_message('cf300000-0000-4000-8000-000000000024','relance_feu_vert',now()-interval '1 hour','envoi','cancelled');
SELECT crf_message('cf300000-0000-4000-8000-000000000025','relance_feu_vert',now()-interval '1 hour','echec',NULL);
SELECT crf_message('cf300000-0000-4000-8000-000000000026','demande_feu_vert',now()-interval '24 hours','envoye','sent');
SELECT crf_message('cf300000-0000-4000-8000-000000000027','demande_feu_vert',now()-interval '23 hours 59 minutes','envoye','sent');
SELECT crf_message('cf300000-0000-4000-8000-000000000028','demande_feu_vert',now()-interval '30 hours','envoye','sent');
SELECT crf_message('cf300000-0000-4000-8000-000000000029','demande_feu_vert',now()-interval '1 hour','envoye','sent');
SELECT crf_message('cf300000-0000-4000-8000-000000000030','demande_feu_vert',now()-interval '1 hour','envoye','sent');
SELECT crf_message('cf300000-0000-4000-8000-000000000031','demande_feu_vert',now()-interval '1 hour','envoye','sent');
-- Another message, or another dossier's request, is no request of this dossier.
INSERT INTO messages(colis_id,type,auteur_nom,texte,statut,canal,template,created_at) VALUES('cf300000-0000-4000-8000-000000000032','staff','Équipe','Bonjour Flavie, une question sur vos cartons.','envoye','telegram',NULL,now()-interval '1 hour');
SELECT crf_message('cf300000-0000-4000-8000-000000000001','demande_feu_vert',now()-interval '1 hour','envoye','sent');
-- Queued 30 hours ago, delivered 2 hours ago: the 24 hours count from the delivery.
SELECT crf_message('cf300000-0000-4000-8000-000000000034','demande_feu_vert',now()-interval '30 hours','envoye','sent',now()-interval '2 hours');
-- Queued 23 hours ago and rescheduled by the 24-hour client rule (dispatchOutbox): not delivered yet.
SELECT crf_message('cf300000-0000-4000-8000-000000000035','relance_feu_vert',now()-interval '23 hours','envoi','pending');
UPDATE notification_outbox SET available_at=now()+interval '90 minutes',last_error='Un rappel a déjà été envoyé à ce client dans les dernières 24 heures' WHERE colis_id='cf300000-0000-4000-8000-000000000035';
-- Blocked by a conversation to handle, 30 hours ago; being sent, an hour ago.
SELECT crf_message('cf300000-0000-4000-8000-000000000036','relance_feu_vert',now()-interval '30 hours','envoi','blocked');
SELECT crf_message('cf300000-0000-4000-8000-000000000037','relance_feu_vert',now()-interval '1 hour','envoi','sending');
-- E-mail drafts written 25 and 2 hours ago (outbox manual), portal messages of 2 and 25 hours ago without outbox row.
SELECT crf_message('cf300000-0000-4000-8000-000000000038','relance_feu_vert',now()-interval '25 hours','envoi','manual',NULL,'email');
SELECT crf_message('cf300000-0000-4000-8000-000000000039','relance_feu_vert',now()-interval '2 hours','envoi','manual',NULL,'email');
SELECT crf_message('cf300000-0000-4000-8000-000000000050','demande_feu_vert',now()-interval '2 hours','envoye',NULL,NULL,'portal');
SELECT crf_message('cf300000-0000-4000-8000-000000000051','demande_feu_vert',now()-interval '25 hours','envoye',NULL,NULL,'portal');
-- A retry to deliver after a failure: the outbox is pending again, the message still « echec ».
SELECT crf_message('cf300000-0000-4000-8000-000000000052','relance_feu_vert',now()-interval '5 hours','echec','failed');
UPDATE notification_outbox SET status='pending',available_at=now(),last_error=NULL WHERE colis_id='cf300000-0000-4000-8000-000000000052';
-- Two delivery rows of one message: a failed or cancelled one wins.
SELECT crf_message('cf300000-0000-4000-8000-000000000054','relance_feu_vert',now()-interval '1 hour','envoye','sent');
INSERT INTO notification_outbox(message_id,client_id,colis_id,canal,status) SELECT m.id,c.client_id,c.id,'telegram','pending' FROM messages m JOIN colis c ON c.id=m.colis_id WHERE c.id='cf300000-0000-4000-8000-000000000054';
UPDATE notification_outbox SET status='failed' WHERE colis_id='cf300000-0000-4000-8000-000000000054' AND status='pending';
SELECT crf_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=now()+interval '22 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000021')),'S4 a request delivered 2 hours ago: the task waits until its 24 hours end');
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '10 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000022')),'S4 a relance: due at the closing when it comes first');
SELECT crf_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000023')),'S4 the latest relance failed: relance due, whatever the earlier delivered request');
SELECT crf_assert((SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' FROM crf_reception('cf300000-0000-4000-8000-000000000024')),'S4 the latest relance was cancelled: relance due');
SELECT crf_assert((SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' FROM crf_reception('cf300000-0000-4000-8000-000000000025')),'S4 a failed message without outbox row: relance due');
SELECT crf_assert((SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000026'))
  AND (SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '1 minute' FROM crf_reception('cf300000-0000-4000-8000-000000000027')),'S4 the follow-up lasts 24 hours after the delivery, end excluded');
SELECT crf_assert((SELECT state='waiting' AND blocked_reason='Attente volontaire du client' AND action_hint IS NULL AND due_at=now()+interval '5 days' FROM crf_reception('cf300000-0000-4000-8000-000000000028')),'S4 a voluntary client wait is still never relanced');
SELECT crf_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Réexaminer l’attente client' FROM crf_reception('cf300000-0000-4000-8000-000000000029')),'S4 an expired wait still wins over a followed-up request');
SELECT crf_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=now()+interval '23 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000030')),'S4 before the window: due when the follow-up ends, the window being open by then');
SELECT crf_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=now()+interval '24 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000031')),'S4 before the window: due when the window opens, the follow-up ending earlier');
SELECT crf_assert((SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' FROM crf_reception('cf300000-0000-4000-8000-000000000032'))
  AND (SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' FROM crf_reception('cf300000-0000-4000-8000-000000000033')),'S4 a free message, or a request of another dossier, is no follow-up');
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '22 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000034'))
  AND crf_until('cf300000-0000-4000-8000-000000000034')=now()+interval '22 hours','S4 anchored on the delivery: queued 30 hours ago, delivered 2 hours ago, followed up 22 hours more');
SELECT crf_assert((SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000035'))
  AND crf_until('cf300000-0000-4000-8000-000000000035')='infinity','S4 a relance rescheduled by the 24-hour client rule holds past the 24 hours of its creation, due at the closing');
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000036'))
  AND (SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000037')),'S4 a relance blocked by a conversation to handle, or being sent, holds');
SELECT crf_assert((SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' FROM crf_reception('cf300000-0000-4000-8000-000000000038'))
  AND (SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '22 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000039'))
  AND crf_until('cf300000-0000-4000-8000-000000000038') IS NULL,'S4 an e-mail draft is followed up 24 hours from its creation, never held');
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '22 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000050'))
  AND (SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' FROM crf_reception('cf300000-0000-4000-8000-000000000051')),'S4 a portal message without outbox row: 24 hours from its creation');
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000052'))
  AND crf_until('cf300000-0000-4000-8000-000000000052')='infinity','S4 a retry to deliver holds, over the « echec » of its first attempt');
SELECT crf_assert((SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' FROM crf_reception('cf300000-0000-4000-8000-000000000054'))
  AND crf_until('cf300000-0000-4000-8000-000000000054') IS NULL,'S4 a failed delivery row wins over a sent one of the same message');
SELECT crf_assert(crf_until('cf300000-0000-4000-8000-000000000021')=now()+interval '22 hours' AND crf_until('cf300000-0000-4000-8000-000000000023') IS NULL
  AND crf_until('cf300000-0000-4000-8000-000000000026') IS NULL AND crf_until('cf300000-0000-4000-8000-000000000033') IS NULL,'S4 the follow-up helper returns the end of the 24 hours, or NULL');
-- A client's message never counts, even with a consent template (the client space writes straight to messages):
-- Nadia's request was delivered 30 hours ago, the relance is due and stays due.
SELECT crf_message('cf300000-0000-4000-8000-000000000053','demande_feu_vert',now()-interval '30 hours','envoye','sent');
SELECT crf_assert((SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000053')),'S4 Nadia: relance due 30 hours after the delivered request');
CREATE TEMP TABLE crf_task_before ON COMMIT DROP AS SELECT version FROM staff_work_actions WHERE colis_id='cf300000-0000-4000-8000-000000000053' AND kind='reception';
SELECT crf_as('client');
INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,template) VALUES('cf300000-0000-4000-8000-000000000053','client','cf000000-0000-4000-8000-000000000004','Nadia','ok','relance_feu_vert');
INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,template) VALUES('cf300000-0000-4000-8000-000000000053','client','cf000000-0000-4000-8000-000000000004','Nadia','ok','demande_feu_vert');
SELECT crf_as('postgres');
SELECT crf_assert((SELECT count(*)=2 FROM messages WHERE colis_id='cf300000-0000-4000-8000-000000000053' AND type='client' AND template IN ('demande_feu_vert','relance_feu_vert'))
  AND (SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000053'))
  AND crf_until('cf300000-0000-4000-8000-000000000053') IS NULL AND _reception_work_hint(crf_colis('cf300000-0000-4000-8000-000000000053'))='Relancer le client avant la clôture du départ'
  AND (SELECT version FROM staff_work_actions WHERE colis_id='cf300000-0000-4000-8000-000000000053' AND kind='reception')=(SELECT version FROM crf_task_before),
  'S4 a client message carrying a consent template is no request: the relance stays due, its task untouched');

-- ── S6. The closing of the consent: the departure planned on the desired day; none for a closed departure ──
SELECT crf_assert(_colis_departure_closing(crf_colis('cf300000-0000-4000-8000-000000000041'))=now()+interval '30 hours'
  AND (SELECT state='ready' AND action_hint='Demander l’accord avant la clôture du départ' AND due_at=now()+interval '30 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000041')),'S6 the open departure planned on the desired day closes it (its loading closing)');
SELECT crf_assert(_colis_departure_closing(crf_colis('cf300000-0000-4000-8000-000000000042'))=departure_default_closing(crf_day(21))
  AND (SELECT action_hint IS NULL AND due_at IS NULL FROM crf_reception('cf300000-0000-4000-8000-000000000042')),'S6 a departure of another destination that day does not count: the Wednesday rule');
SELECT crf_assert(_colis_departure_closing(crf_colis('cf300000-0000-4000-8000-000000000044')) IS NULL
  AND (SELECT action_hint IS NULL AND due_at IS NULL FROM crf_reception('cf300000-0000-4000-8000-000000000044'))
  AND _reception_work_hint(crf_colis('cf300000-0000-4000-8000-000000000044')) IS NULL,'S6 the desired day''s departure whose loading closed gives no closing: no consent hint nor due date');
SELECT crf_assert(_colis_departure_closing(crf_colis('cf300000-0000-4000-8000-000000000047')) IS NULL
  AND (SELECT action_hint IS NULL AND due_at IS NULL FROM crf_reception('cf300000-0000-4000-8000-000000000047')),'S6 the desired day''s departure has left: no closing');
SELECT crf_assert(_colis_departure_closing(crf_colis('cf300000-0000-4000-8000-000000000048'))=departure_default_closing(crf_day(25)),'S6 an archived departure that day does not count: the Wednesday rule (a departure can be created)');
SELECT crf_assert((SELECT state='ready' AND action_hint='Mesurer puis demander l’accord avant la clôture du départ' AND due_at=now()+interval '30 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000045'))
  AND (SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '30 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000043')),'S6 the same closing for every step of the consent');
SELECT crf_message('cf300000-0000-4000-8000-000000000043','demande_feu_vert',now()-interval '1 hour','envoye','sent');
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '23 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000043')),'S6 a followed-up request waits within that closing');
SELECT crf_assert(_colis_departure_closing(crf_colis('cf300000-0000-4000-8000-000000000001'))=now()+interval '36 hours','S6 an assigned departure keeps its own closing');
-- An assigned departure archived, or that has left, gives no closing either (its dossiers are re-synced at once).
SELECT crf_assert((SELECT state='ready' AND action_hint='Demander l’accord avant la clôture du départ' AND due_at=now()+interval '30 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000049'))
  AND (SELECT state='ready' AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '30 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000055')),'S6 two dossiers assigned to open departures closing in 30 hours');
UPDATE envois SET statut='archive' WHERE id='cf400000-0000-4000-8000-000000000126';
SELECT set_config('expedile.confirm_departure','allowed',true);
UPDATE envois SET statut='parti',departed_at=now(),manifest_version=1 WHERE id='cf400000-0000-4000-8000-000000000127';
SELECT set_config('expedile.confirm_departure','',true);
SELECT crf_assert(_colis_departure_closing(crf_colis('cf300000-0000-4000-8000-000000000049')) IS NULL
  AND (SELECT state='ready' AND action_hint IS NULL AND due_at IS NULL FROM crf_reception('cf300000-0000-4000-8000-000000000049'))
  AND (SELECT state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at IS NULL FROM crf_reception('cf300000-0000-4000-8000-000000000055')),'S6 an assigned departure archived or gone gives no closing: no consent hint, no relance');
-- The Wednesday 17 h of a desired day inside the window (when the calendar has one within nine days): a closed departure
-- that day removes it, while the same day of another destination without departure keeps it.
DO $$
DECLARE day date; inside boolean;
BEGIN
 SELECT d::date INTO day FROM generate_series(crf_day(1),crf_day(9),interval '1 day') d WHERE _consent_relance_open(departure_default_closing(d::date))
  AND NOT EXISTS(SELECT 1 FROM envois e WHERE e.date_depart=d::date) ORDER BY d LIMIT 1;
 inside:=day IS NOT NULL;
 day:=coalesce(day,crf_day(10));
 INSERT INTO envois(id,destination_code,date_depart,statut,loading_closes_at) VALUES('cf400000-0000-4000-8000-000000000130','974',day,'planifie',now()-interval '1 hour');
 INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,depart_souhaite,nb_colis,dim_l,dim_w,dim_h,poids) VALUES
  ('cf300000-0000-4000-8000-000000000056','cf200000-0000-4000-8000-000000000002','CRF-W11','mesure',NULL,NULL,day,1,40,30,20,5),
  ('cf300000-0000-4000-8000-000000000057','cf200000-0000-4000-8000-000000000003','CRF-W12','mesure',NULL,NULL,day,1,40,30,20,5);
 PERFORM crf_assert(_colis_departure_closing(crf_colis('cf300000-0000-4000-8000-000000000056')) IS NULL
  AND (SELECT action_hint IS NULL AND due_at IS NULL FROM crf_reception('cf300000-0000-4000-8000-000000000056'))
  AND _colis_departure_closing(crf_colis('cf300000-0000-4000-8000-000000000057'))=departure_default_closing(day)
  AND (SELECT action_hint IS NOT DISTINCT FROM CASE WHEN inside THEN 'Demander l’accord avant la clôture du départ' END FROM crf_reception('cf300000-0000-4000-8000-000000000057')),
  'S6 a closed departure on the desired day removes its Wednesday closing'||CASE WHEN inside THEN ' (inside the window today)' ELSE ' (no Wednesday closing inside the window today)' END);
END $$;

-- ── S5. Time passes (simulated): the refresh brings the relance back, then stays stable ──
-- CRF-A1: 25 hours after the delivered request (its saved row still waits until its old due date): the stored hint differs.
SET LOCAL session_replication_role='replica';
UPDATE messages SET created_at=now()-interval '25 hours' WHERE colis_id='cf300000-0000-4000-8000-000000000021';
UPDATE notification_outbox SET sent_at=now()-interval '25 hours' WHERE colis_id='cf300000-0000-4000-8000-000000000021';
SET LOCAL session_replication_role='origin';
-- CRF-A7: the due date has come: the waiting row is re-synced by its date.
SET LOCAL session_replication_role='replica';
UPDATE messages SET created_at=now()-interval '24 hours 1 minute' WHERE colis_id='cf300000-0000-4000-8000-000000000027';
UPDATE notification_outbox SET sent_at=now()-interval '24 hours 1 minute' WHERE colis_id='cf300000-0000-4000-8000-000000000027';
SET LOCAL session_replication_role='origin';
UPDATE staff_work_actions SET due_at=now()-interval '1 minute' WHERE colis_id='cf300000-0000-4000-8000-000000000027' AND kind='reception';
-- CRF-W6: a departure is planned on its desired day after the dossier was synced (no trigger re-syncs a desired day).
SELECT crf_assert((SELECT action_hint IS NULL AND due_at IS NULL FROM crf_reception('cf300000-0000-4000-8000-000000000046')),'S5 a desired day without departure: no hint yet');
INSERT INTO envois(id,destination_code,date_depart,statut,loading_closes_at) VALUES('cf400000-0000-4000-8000-000000000123','974',crf_day(23),'planifie',now()+interval '20 hours');
-- CRF-W11: its task as the deployed rules computed it (the Wednesday closing of a day whose departure closed).
UPDATE staff_work_actions w SET action_hint='Demander l’accord avant la clôture du départ',due_at=departure_default_closing(c.depart_souhaite) FROM colis c WHERE c.id=w.colis_id AND w.colis_id='cf300000-0000-4000-8000-000000000056' AND w.kind='reception';
SELECT crf_as('director');
SELECT refresh_staff_work_actions();
SELECT crf_as('postgres');
SELECT crf_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000021')),'S5 24 hours after the delivery without answer, before the closing: the relance is back after the refresh (hint differs)');
SELECT crf_assert((SELECT state='ready' AND blocked_reason IS NULL AND action_hint='Relancer le client avant la clôture du départ' AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000027')),'S5 the relance is back after the refresh (due date passed)');
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '10 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000022'))
  AND (SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '22 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000034')),'S5 a request still followed up keeps waiting (the delivery, not the creation, counts)');
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '36 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000035')),'S5 a relance still to deliver keeps holding after the refresh');
SELECT crf_assert((SELECT state='ready' AND action_hint='Demander l’accord avant la clôture du départ' AND due_at=now()+interval '20 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000046')),'S5 the refresh applies the closing of a departure planned since on the desired day');
SELECT crf_assert((SELECT action_hint IS NULL AND due_at IS NULL FROM crf_reception('cf300000-0000-4000-8000-000000000056')),'S5 the refresh removes the hint and due date of a closing that cannot be met');
-- CRF-A15's rescheduled relance is delivered an hour ago: re-synced at once, followed up 23 hours more.
UPDATE notification_outbox SET status='sending',locked_at=now() WHERE colis_id='cf300000-0000-4000-8000-000000000035';
UPDATE messages SET statut='envoye' WHERE colis_id='cf300000-0000-4000-8000-000000000035';
UPDATE notification_outbox SET status='sent',sent_at=now()-interval '1 hour',last_error=NULL WHERE colis_id='cf300000-0000-4000-8000-000000000035';
SELECT crf_assert((SELECT state='waiting' AND action_hint IS NULL AND due_at=now()+interval '23 hours' FROM crf_reception('cf300000-0000-4000-8000-000000000035')),'S5 the delivery re-syncs at once: due 24 hours after it');
CREATE TEMP TABLE crf_rows ON COMMIT DROP AS SELECT to_jsonb(w) AS data FROM staff_work_actions w;
SELECT crf_as('director');
SELECT refresh_staff_work_actions();
SELECT crf_as('postgres');
SELECT crf_assert(NOT EXISTS((SELECT to_jsonb(w) FROM staff_work_actions w EXCEPT SELECT data FROM crf_rows) UNION ALL (SELECT data FROM crf_rows EXCEPT SELECT to_jsonb(w) FROM staff_work_actions w)),'S5 a second refresh changes nothing');
SELECT crf_assert(NOT EXISTS(SELECT 1 FROM staff_work_actions w JOIN colis c ON c.id=w.colis_id WHERE w.kind='reception' AND w.state<>'done' AND w.action_hint IS DISTINCT FROM _reception_work_hint(c)),'S5 every open reception task carries its computed hint');
SELECT crf_assert(NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE NOT isfinite(due_at)),'S5 no due date is ever infinite (a held follow-up is due at the closing)');
-- The team reads the hints; a preparer measures from the hint without any write to the message history.
SELECT crf_as('preparateur');
SELECT crf_assert((SELECT count(*)>0 FROM staff_work_actions WHERE action_hint='Mesurer puis demander l’accord avant la clôture du départ'),'S5 the team reads the new hint');
SELECT crf_as('postgres');

-- ── S7. The outbox rows of one message are read through the index ──
DO $$
DECLARE plan json;
BEGIN
 PERFORM set_config('enable_seqscan','off',true);
 EXECUTE 'EXPLAIN (FORMAT JSON) SELECT status,sent_at FROM notification_outbox WHERE message_id=(SELECT id FROM messages WHERE colis_id=''cf300000-0000-4000-8000-000000000021'' LIMIT 1)' INTO plan;
 PERFORM set_config('enable_seqscan','on',true);
 PERFORM crf_assert(plan::text LIKE '%"Index Name": "notification_outbox_message_id"%','S7 the delivery rows of a message are found through notification_outbox_message_id');
END $$;
ROLLBACK;
