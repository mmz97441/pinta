-- Retention of payments and of the audit trail (20261010000001_history_retention.sql). Run by run-retention.sh on the
-- production-like schema: the API roles hold Supabase's default table privileges until the release revokes some, an
-- audit key cascaded and an inbox key was missing before it. Checked here: the shape of the release (triggers, private
-- functions, keys, privileges); every refusal with its SQLSTATE, message and HINT, leaving the history unchanged; the
-- cascades a deletion would trigger, refused; every current writer still succeeding through the real commands (for an
-- Edge function, the exact statement it sends with the service key); corrections recorded as new rows.
BEGIN;

CREATE FUNCTION ret_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
-- Every history row and its parents, whatever the caller may read.
CREATE FUNCTION ret_history() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM paiements t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM payment_intents t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY provider_id) FROM legacy_payplug_payments t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM quote_versions t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM quote_withdrawals t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM audit_actions t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM logs_statut t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM messages t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM notification_outbox t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM client_inbox t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM com_log t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY request_id) FROM reception_append_receipts t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY envoi_id) FROM departure_manifests t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY envoi_id,colis_id,parcel_index) FROM departure_loading_checks t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM colis t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM clients t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM envois t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM profiles t))
$$;
-- A refusal: SQLSTATE, and message and HINT when given; nothing written.
CREATE FUNCTION ret_reject(command text,label text,code text,message text DEFAULT NULL,hint text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_data jsonb:=ret_history(); got_hint text;
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS got_hint=PG_EXCEPTION_HINT;
  IF SQLSTATE<>code THEN RAISE EXCEPTION 'FAIL wrong code % for %: %',SQLSTATE,label,SQLERRM; END IF;
  IF message IS NOT NULL AND SQLERRM<>message THEN RAISE EXCEPTION 'FAIL wrong message for %: %',label,SQLERRM; END IF;
  IF hint IS NOT NULL AND nullif(got_hint,'') IS DISTINCT FROM hint THEN RAISE EXCEPTION 'FAIL wrong hint % for %',got_hint,label; END IF;
  IF ret_history()<>before_data THEN RAISE EXCEPTION 'FAIL % changed the history',label; END IF;
  RAISE NOTICE 'PASS rejected: % [%]',label,SQLSTATE; RETURN;
 END;
 RAISE EXCEPTION 'FAIL accepted: %',label;
END $$;
-- Who acts: the owner (migrations, SQL editor), a staff session or the client (PostgREST, authenticated), the Edge
-- functions (service key).
CREATE FUNCTION ret_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role',CASE who WHEN 'postgres' THEN '' WHEN 'service' THEN 'service_role' ELSE 'authenticated' END,true);
 PERFORM set_config('request.jwt.claim.sub',CASE who WHEN 'director' THEN 'b8000000-0000-4000-8000-000000000001' WHEN 'shipper' THEN 'b8000000-0000-4000-8000-000000000002'
  WHEN 'checker' THEN 'b8000000-0000-4000-8000-000000000004' ELSE '' END,true);
 IF who<>'postgres' THEN EXECUTE format('SET LOCAL ROLE %I',CASE who WHEN 'service' THEN 'service_role' ELSE 'authenticated' END); END IF;
END $$;
CREATE FUNCTION ret_version(p_colis uuid) RETURNS timestamptz LANGUAGE sql SECURITY DEFINER AS $$ SELECT updated_at FROM colis WHERE id=p_colis $$;
CREATE FUNCTION ret_outbox(p_key text) RETURNS notification_outbox LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM notification_outbox WHERE idempotency_key=p_key $$;

-- ── R1. Shape: triggers, private functions, keys, privileges ──
DO $$
DECLARE fn text; owner oid:=(SELECT proowner FROM pg_proc WHERE oid='confirm_departure(uuid,jsonb,timestamptz,text)'::regprocedure); spec record; tbl text; r text;
BEGIN
 -- BEFORE UPDATE OR DELETE row triggers (27) on the history, BEFORE DELETE (11) on its parents, BEFORE TRUNCATE (34).
 IF (SELECT array_agg(tgrelid::regclass::text||':'||tgtype ORDER BY tgrelid::regclass::text COLLATE "C") FROM pg_trigger
     WHERE tgname='retention_guard' AND NOT tgisinternal AND tgenabled='O' AND cardinality(tgattr::int2[])=0 AND tgqual IS NULL)
  IS DISTINCT FROM ARRAY['audit_actions:27','client_inbox:27','clients:11','colis:11','com_log:27','departure_loading_checks:27','departure_manifests:27',
   'envois:11','logs_statut:27','messages:27','notification_outbox:27','paiements:27','payment_intents:27','quote_versions:27','quote_withdrawals:27',
   'reception_append_receipts:27'] THEN RAISE EXCEPTION 'FAIL: row guards'; END IF;
 IF (SELECT array_agg(tgrelid::regclass::text ORDER BY tgrelid::regclass::text COLLATE "C") FROM pg_trigger
     WHERE tgname='retention_truncate' AND NOT tgisinternal AND tgenabled='O' AND tgtype=34 AND tgfoid='_retention_truncate()'::regprocedure)
  IS DISTINCT FROM ARRAY['audit_actions','client_inbox','com_log','departure_loading_checks','departure_manifests','legacy_payplug_payments','logs_statut',
   'messages','notification_outbox','paiements','payment_intents','quote_versions','quote_withdrawals','reception_append_receipts'] THEN RAISE EXCEPTION 'FAIL: truncate guards'; END IF;
 -- z_guard_client_required_fields stays the last BEFORE row trigger of clients (20261007000003).
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='clients'::regclass AND NOT tgisinternal AND tgtype&3=3 AND tgname>'z_guard_client_required_fields') THEN
  RAISE EXCEPTION 'FAIL: a retention trigger sorts after the required-fields guard'; END IF;
 FOREACH fn IN ARRAY ARRAY['_retention_append_only()','_retention_payment_intent()','_retention_message()','_retention_outbox()','_retention_quote_withdrawal()',
  '_retention_client_inbox()','_retention_loading_check()','_retention_colis_delete()','_retention_client_delete()','_retention_departure_delete()','_retention_truncate()'] LOOP
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE')
   OR (SELECT proacl IS NULL OR EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0) FROM pg_proc WHERE oid=fn::regprocedure)
   OR NOT (SELECT proconfig @> ARRAY['search_path=public, pg_temp'] AND prorettype='trigger'::regtype AND proowner=owner FROM pg_proc WHERE oid=fn::regprocedure)
   OR (SELECT prosecdef FROM pg_proc WHERE oid=fn::regprocedure) IS DISTINCT FROM
    (fn IN ('_retention_loading_check()','_retention_colis_delete()','_retention_client_delete()','_retention_departure_delete()')) THEN
   RAISE EXCEPTION 'FAIL: trigger function security %',fn; END IF;
 END LOOP;
 -- One RESTRICT or NO ACTION key per history column; the formerly cascading, nulling or missing ones are RESTRICT.
 FOR spec IN SELECT * FROM (VALUES ('paiements','colis_id','colis'),('paiements','client_id','clients'),('payment_intents','colis_id','colis'),
   ('legacy_payplug_payments','colis_id','colis'),('legacy_payplug_payments','client_id','clients'),('quote_versions','colis_id','colis'),
   ('quote_withdrawals','colis_id','colis'),('quote_withdrawals','message_id','messages'),('audit_actions','colis_id','colis'),('logs_statut','colis_id','colis'),
   ('messages','colis_id','colis'),('notification_outbox','message_id','messages'),('notification_outbox','client_id','clients'),
   ('notification_outbox','colis_id','colis'),('client_inbox','client_id','clients'),('client_inbox','colis_id','colis'),('com_log','colis_id','colis'),
   ('com_log','client_id','clients'),('reception_append_receipts','colis_id','colis'),('departure_manifests','envoi_id','envois')) s(tbl,col,parent) LOOP
  IF (SELECT array_agg(c.confdeltype::text) FROM pg_constraint c WHERE c.contype='f' AND c.conrelid=spec.tbl::regclass AND c.confrelid=spec.parent::regclass
      AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=spec.tbl::regclass AND attname=spec.col)]) IS DISTINCT FROM ARRAY[
     CASE WHEN spec.tbl IN ('paiements','logs_statut','messages','reception_append_receipts','com_log','audit_actions','departure_manifests') AND spec.col IN ('colis_id','envoi_id')
       OR (spec.tbl,spec.col)=('client_inbox','colis_id') THEN 'r' ELSE 'a' END] THEN
   RAISE EXCEPTION 'FAIL: key %.% → %',spec.tbl,spec.col,spec.parent; END IF;
 END LOOP;
 -- The loading checks keep their three cascading keys: before the confirmation they are working state.
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='departure_loading_checks'::regclass AND contype='f' AND confdeltype='c')<>3 THEN
  RAISE EXCEPTION 'FAIL: the loading checks lost a cascading key'; END IF;
 -- The API roles held every table privilege (Supabase defaults): UPDATE, DELETE and TRUNCATE are gone from the
 -- append-only tables, DELETE and TRUNCATE from the others; the reads, inserts and updates the writers use stay.
 FOREACH tbl IN ARRAY ARRAY['paiements','quote_versions','audit_actions','logs_statut','departure_manifests','com_log','reception_append_receipts','legacy_payplug_payments'] LOOP
  FOREACH r IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
   IF has_table_privilege(r,tbl,'UPDATE') OR has_table_privilege(r,tbl,'DELETE') OR has_table_privilege(r,tbl,'TRUNCATE') THEN RAISE EXCEPTION 'FAIL: % may still rewrite %',r,tbl; END IF;
  END LOOP;
 END LOOP;
 FOREACH tbl IN ARRAY ARRAY['payment_intents','quote_withdrawals','messages','notification_outbox','client_inbox','departure_loading_checks'] LOOP
  FOREACH r IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
   IF has_table_privilege(r,tbl,'DELETE') OR has_table_privilege(r,tbl,'TRUNCATE') THEN RAISE EXCEPTION 'FAIL: % may still erase %',r,tbl; END IF;
  END LOOP;
 END LOOP;
 IF NOT (has_table_privilege('service_role','payment_intents','SELECT,INSERT,UPDATE') AND has_table_privilege('service_role','messages','SELECT,INSERT,UPDATE')
   AND has_table_privilege('service_role','notification_outbox','SELECT,INSERT,UPDATE') AND has_table_privilege('service_role','client_inbox','SELECT,INSERT,UPDATE')
   AND has_table_privilege('service_role','audit_actions','SELECT,INSERT') AND has_table_privilege('service_role','paiements','SELECT,INSERT')
   AND has_table_privilege('authenticated','messages','SELECT,INSERT,UPDATE') AND has_table_privilege('authenticated','audit_actions','SELECT,INSERT')
   AND has_table_privilege('authenticated','com_log','SELECT,INSERT') AND has_table_privilege('authenticated','paiements','SELECT')
   AND has_table_privilege('service_role','legacy_payplug_payments','SELECT')) THEN
  RAISE EXCEPTION 'FAIL: a privilege the writers use was revoked'; END IF;
 RAISE NOTICE 'PASS: R1 sixteen row guards and fourteen TRUNCATE guards, private trigger functions with a fixed search_path, one RESTRICT or NO ACTION key per history column, privileges';
END $$;

-- ── Fixtures ──
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('b8000000-0000-4000-8000-000000000001','ret-director@example.test','{"nom":"Direction rétention"}'),
 ('b8000000-0000-4000-8000-000000000002','ret-shipper@example.test','{"nom":"Expédition rétention"}'),
 ('b8000000-0000-4000-8000-000000000003','ret-client@example.test','{"nom":"Flavie Payet"}'),
 ('b8000000-0000-4000-8000-000000000004','ret-checker@example.test','{"nom":"Contrôle rétention"}');
INSERT INTO staff_users(id,auth_id,nom,prenom,email,role,must_change_password) VALUES
 ('b8100000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001','Hoarau','Camille','ret-director@example.test','directeur',false),
 ('b8100000-0000-4000-8000-000000000002','b8000000-0000-4000-8000-000000000002','Grondin','Marc','ret-shipper@example.test','logisticien',false),
 ('b8100000-0000-4000-8000-000000000004','b8000000-0000-4000-8000-000000000004','Técher','Lina','ret-checker@example.test','preparateur',false);
-- Expédition: confirms departures; Contrôle: scans parcels only.
INSERT INTO staff_permissions(staff_id,perm_colis_expedier,perm_envois_voir,perm_envois_modifier,perm_envois_reaffecter) VALUES
 ('b8100000-0000-4000-8000-000000000002',true,true,true,true),('b8100000-0000-4000-8000-000000000004',true,false,false,false)
 ON CONFLICT(staff_id) DO UPDATE SET perm_colis_expedier=true,perm_envois_voir=excluded.perm_envois_voir,perm_envois_modifier=excluded.perm_envois_modifier,
  perm_envois_reaffecter=excluded.perm_envois_reaffecter;
INSERT INTO clients(id,user_id,nom,prenom,cp,email,type,telegram_chat_id) VALUES
 ('b8200000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000003','Payet','Flavie','97400','ret-client@example.test','particulier','CHAT-RET-1'),
 ('b8200000-0000-4000-8000-000000000002',NULL,'Sans historique',NULL,'97400','ret-empty@example.test','particulier',NULL),
 ('b8200000-0000-4000-8000-000000000003',NULL,'Message seul',NULL,'97400','ret-inbox@example.test','particulier','CHAT-RET-3'),
 ('b8200000-0000-4000-8000-000000000004',NULL,'Invitation seule',NULL,'97400','ret-invite@example.test','particulier',NULL),
 ('b8200000-0000-4000-8000-000000000005',NULL,'Sans historique bis',NULL,'97400','ret-empty-bis@example.test','particulier',NULL);
INSERT INTO envois(id,ref,destination_code,date_depart,statut) VALUES
 ('b8400000-0000-4000-8000-000000000001','RET-ENV-TODAY','974',(now() AT TIME ZONE 'Europe/Paris')::date,'planifie'),
 ('b8400000-0000-4000-8000-000000000003','RET-ENV-LEGACY','974',(now() AT TIME ZONE 'Europe/Paris')::date-30,'planifie'),
 ('b8400000-0000-4000-8000-000000000004','RET-ENV-EMPTY','974',(now() AT TIME ZONE 'Europe/Paris')::date+14,'planifie'),
 ('b8400000-0000-4000-8000-000000000005','RET-ENV-LOADED','974',(now() AT TIME ZONE 'Europe/Paris')::date+14,'planifie');
-- A departure that left before the manifests existed (2026-09-12): « parti », no departed_at.
SELECT set_config('expedile.confirm_departure','allowed',true);
UPDATE envois SET statut='parti' WHERE id='b8400000-0000-4000-8000-000000000003';
SELECT set_config('expedile.confirm_departure','',true);
-- Prepared dossiers with an unsent quote (RET-PAY, RET-LINK, RET-RACE); a sent quote (RET-MANUAL); a dossier for the
-- conversation (RET-MSG); a sent quote that receives a late invoice (RET-WITHDRAW); a paid dossier leaving today
-- (RET-LOAD); a dossier just received (RET-NEW); a dossier receiving more cartons (RET-RECEPT); a dossier on a planned
-- departure (RET-PLANNED).
INSERT INTO colis(id,client_id,ref,statut,feu_vert,devis_total,devis_transport,quote_version,final_packages,fin_l,fin_w,fin_h,fin_p,outgoing_parcel_count,final_measurements_version,final_measurements_at) VALUES
 ('b8300000-0000-4000-8000-000000000001','b8200000-0000-4000-8000-000000000001','RET-PAY','en_preparation','autorise',40,40,2,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now()),
 ('b8300000-0000-4000-8000-000000000002','b8200000-0000-4000-8000-000000000001','RET-LINK','en_preparation','autorise',30,30,1,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now()),
 ('b8300000-0000-4000-8000-000000000003','b8200000-0000-4000-8000-000000000001','RET-RACE','en_preparation','autorise',20,20,1,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now()),
 ('b8300000-0000-4000-8000-000000000005','b8200000-0000-4000-8000-000000000001','RET-WITHDRAW','en_preparation','autorise',NULL,NULL,0,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now()),
 ('b8300000-0000-4000-8000-00000000000a','b8200000-0000-4000-8000-000000000001','RET-MANUAL','en_preparation','autorise',25,25,1,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now());
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES
 ('b8500000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000005','Boutique',30,'b8300000-0000-4000-8000-000000000005/facture.pdf',false);
-- The document first, then the quote (a document invalidates a quote): version_quote records version 1.
UPDATE colis SET devis_total=30,devis_transport=30 WHERE id='b8300000-0000-4000-8000-000000000005';
UPDATE colis SET statut='devis_envoye',devis_brouillon=false WHERE id IN ('b8300000-0000-4000-8000-000000000005','b8300000-0000-4000-8000-00000000000a');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,nb_colis,dims_par_colis,trackings_detail) VALUES
 ('b8300000-0000-4000-8000-000000000004','b8200000-0000-4000-8000-000000000001','RET-MSG','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"number":"RET-MSG-1"}]'),
 ('b8300000-0000-4000-8000-000000000008','b8200000-0000-4000-8000-000000000001','RET-RECEPT','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"number":"RET-OLD-1"}]');
INSERT INTO colis(id,client_id,ref,statut) VALUES('b8300000-0000-4000-8000-000000000007','b8200000-0000-4000-8000-000000000001','RET-NEW','receptionne');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id) VALUES
 ('b8300000-0000-4000-8000-000000000009','b8200000-0000-4000-8000-000000000001','RET-PLANNED','autorise','autorise','b8400000-0000-4000-8000-000000000005');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,fin_l,fin_w,fin_h,fin_p,final_packages,outgoing_parcel_count,preparation_composition_version,final_measurements_version,devis_total,devis_snapshot,paiement_montant,paiement_date) VALUES
 ('b8300000-0000-4000-8000-000000000006','b8200000-0000-4000-8000-000000000001','RET-LOAD','paye','autorise','b8400000-0000-4000-8000-000000000001',20,20,20,2,
  '[{"dimL":20,"dimW":20,"dimH":20,"poids":2}]',1,1,1,20,'{"inputs":{"destination":{"code":"974"}}}',20,now());

-- ── R2. A PayPlug payment: reservation, link, webhook (twice), then the ledger is final; a correction is a new row ──
SELECT ret_as('service');
SELECT ret_assert((reserve_payplug_intent('b8300000-0000-4000-8000-000000000001',2,4000,false,repeat('a',64),now()+interval '90 days')).status='creating','R2 reserve_payplug_intent opens the link of the quote');
-- payplug-create once PayPlug created the payment: its conditional updates, with the service key.
UPDATE payment_intents SET provider_id='pay_retentionPaid',payment_url='https://secure.payplug.com/pay/retention-paid',status='pending',updated_at=now()
 WHERE colis_id='b8300000-0000-4000-8000-000000000001' AND status='creating';
UPDATE colis SET payplug_payment_id='pay_retentionPaid',payplug_payment_url='https://secure.payplug.com/pay/retention-paid' WHERE id='b8300000-0000-4000-8000-000000000001' AND quote_version=2;
SELECT ret_assert((SELECT status='pending' AND provider_id='pay_retentionPaid' FROM payment_intents WHERE colis_id='b8300000-0000-4000-8000-000000000001'),'R2 payplug-create records the PayPlug reference: creating → pending');
SELECT ret_as('postgres');
UPDATE colis SET statut='devis_envoye',devis_brouillon=false WHERE id='b8300000-0000-4000-8000-000000000001';   -- the quote is sent
SELECT ret_as('service');
-- (A statement does not see the writes of the commands it calls: each check reads in a statement of its own.)
SELECT ret_assert((confirm_payplug_payment('pay_retentionPaid','b8300000-0000-4000-8000-000000000001',2,4000,'EUR')).statut='paye','R2 confirm_payplug_payment records the payment');
SELECT ret_assert((SELECT status='paid' FROM payment_intents WHERE colis_id='b8300000-0000-4000-8000-000000000001')
 AND (SELECT count(*)=1 AND bool_and(montant=40 AND statut='confirme') FROM paiements WHERE colis_id='b8300000-0000-4000-8000-000000000001'),'R2 pending → paid, one ledger row');
SELECT ret_assert((confirm_payplug_payment('pay_retentionPaid','b8300000-0000-4000-8000-000000000001',2,4000,'EUR')).statut='paye','R2 a repeated webhook is accepted');
SELECT ret_assert((SELECT count(*)=1 FROM paiements WHERE colis_id='b8300000-0000-4000-8000-000000000001'),'R2 it records nothing new: the paid link only refreshes its date');
SELECT ret_as('postgres');
SELECT set_config('ret.payment',(SELECT to_jsonb(p)::text FROM paiements p WHERE colis_id='b8300000-0000-4000-8000-000000000001'),true);
SELECT ret_reject($q$UPDATE paiements SET montant=39 WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R2 a recorded payment keeps its amount, even for the owner','23001',
 'Un paiement enregistré ne se modifie pas et ne se supprime pas : une correction s’enregistre comme une nouvelle écriture, de signe opposé.','retention:paiements');
SELECT ret_reject($q$UPDATE paiements SET notes='Annoté après coup' WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R2 any column of a payment is final','23001',NULL,'retention:paiements');
SELECT ret_reject($q$DELETE FROM paiements WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R2 a payment is never deleted','23001',
 'Un paiement enregistré ne se modifie pas et ne se supprime pas : une correction s’enregistre comme une nouvelle écriture, de signe opposé.','retention:paiements');
SELECT ret_reject($q$UPDATE payment_intents SET status='superseded' WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R2 a paid link stays paid','23001',
 'Un paiement confirmé par PayPlug est définitif : son lien ne se modifie plus.','retention:payment_intents');
SELECT ret_reject($q$UPDATE payment_intents SET amount_cents=3900 WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R2 the amount of a link is frozen','23001',
 'Le dossier, la version du devis, le montant, la devise et le mode d’un lien de paiement ne se modifient pas.','retention:payment_intents');
SELECT ret_reject($q$DELETE FROM payment_intents WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R2 a link is never deleted','23001',
 'Un lien de paiement est conservé dans l’historique des paiements : il ne se supprime pas.','retention:payment_intents');
SELECT ret_as('service');
SELECT ret_reject($q$UPDATE paiements SET montant=39 WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R2 the service key holds no UPDATE on the ledger','42501');
SELECT ret_reject($q$DELETE FROM paiements WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R2 the service key holds no DELETE on the ledger','42501');
SELECT ret_reject($q$DELETE FROM payment_intents WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R2 the service key holds no DELETE on the links','42501');
SELECT ret_reject($q$TRUNCATE paiements$q$,'R2 the service key holds no TRUNCATE','42501');
SELECT ret_as('director');
SELECT ret_reject($q$UPDATE paiements SET montant=39 WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R2 a staff session holds no UPDATE on the ledger','42501');
-- A correction, as C14 requires: a « moins » that cancels the recorded payment, a « plus » that records it again.
SELECT ret_as('postgres');
INSERT INTO paiements(colis_id,client_id,montant,methode,reference,statut,notes)
 SELECT colis_id,client_id,-montant,'correction','Correction du paiement '||id,'rembourse','Écriture « moins » : annule le règlement enregistré par carte' FROM paiements WHERE colis_id='b8300000-0000-4000-8000-000000000001';
INSERT INTO paiements(colis_id,client_id,montant,methode,reference,statut,notes)
 SELECT colis_id,client_id,montant,'virement','Correction du paiement '||id,'confirme','Écriture « plus » : le même règlement, reçu par virement' FROM paiements WHERE colis_id='b8300000-0000-4000-8000-000000000001' AND methode='payplug';
SELECT ret_assert((SELECT count(*)=3 AND sum(montant)=40 FROM paiements WHERE colis_id='b8300000-0000-4000-8000-000000000001')
 AND (SELECT to_jsonb(p) FROM paiements p WHERE colis_id='b8300000-0000-4000-8000-000000000001' AND methode='payplug')=current_setting('ret.payment')::jsonb,'R2 a correction adds a « moins » and a « plus », the original row unchanged');

-- ── R3. A link refused by PayPlug, retried, cancelled, then withdrawn by a correction: each move its writer's ──
SELECT ret_as('service');
SELECT reserve_payplug_intent('b8300000-0000-4000-8000-000000000002',1,3000,false,repeat('b',64),now()+interval '90 days');
-- payplug-create: PayPlug refused the creation (400, 401, 403, 422): update({status:'failed'}).eq('id', …).
UPDATE payment_intents SET status='failed' WHERE colis_id='b8300000-0000-4000-8000-000000000002';
SELECT ret_assert((reserve_payplug_intent('b8300000-0000-4000-8000-000000000002',1,3000,false,repeat('c',64),now()+interval '90 days')).return_token_hash=repeat('c',64),'R3 a refused creation is retried with a new return token');
SELECT ret_assert((SELECT count(*)=1 AND bool_and(status='creating' AND amount_cents=3000) FROM payment_intents WHERE colis_id='b8300000-0000-4000-8000-000000000002'),'R3 on the same link, same amount: failed → creating');
UPDATE payment_intents SET provider_id='pay_retentionLink',payment_url='https://secure.payplug.com/pay/retention-link',status='pending',updated_at=now()
 WHERE colis_id='b8300000-0000-4000-8000-000000000002' AND status='creating';
UPDATE colis SET payplug_payment_id='pay_retentionLink',payplug_payment_url='https://secure.payplug.com/pay/retention-link' WHERE id='b8300000-0000-4000-8000-000000000002' AND quote_version=1;
-- payplugCancel aborted the link at PayPlug: the proof is recorded once.
SELECT record_payplug_cancellation(colis_id,provider_id,jsonb_build_object('object','payment','id',provider_id,'is_paid',false,'failure',jsonb_build_object('code','aborted'),
 'currency','EUR','amount',amount_cents,'is_live',false,'metadata',jsonb_build_object('colis_id',colis_id,'intent_id',id,'quote_version',quote_version::text)))
 FROM payment_intents WHERE colis_id='b8300000-0000-4000-8000-000000000002';
SELECT ret_assert((SELECT provider_cancelled_at IS NOT NULL AND status='pending' FROM payment_intents WHERE colis_id='b8300000-0000-4000-8000-000000000002'),'R3 record_payplug_cancellation stamps the cancellation proof');
SELECT ret_as('director');
SELECT correct_colis_task(id,'devis','{}',updated_at,'Corriger le devis après annulation du lien') FROM colis WHERE id='b8300000-0000-4000-8000-000000000002';
SELECT ret_as('postgres');
SELECT ret_assert((SELECT status='superseded' AND provider_cancelled_at IS NOT NULL FROM payment_intents WHERE colis_id='b8300000-0000-4000-8000-000000000002')
 AND (SELECT count(*)=1 AND bool_and(version=1 AND total=30) FROM quote_versions WHERE colis_id='b8300000-0000-4000-8000-000000000002'),
 'R3 correct_colis_task withdraws the quote: pending → superseded, the withdrawn quote kept as a version');
SELECT ret_reject($q$UPDATE payment_intents SET status='pending' WHERE colis_id='b8300000-0000-4000-8000-000000000002'$q$,'R3 a superseded link never comes back','23001',
 'Changement d’état du lien de paiement refusé : superseded → pending.','retention:payment_intents');
SELECT ret_reject($q$UPDATE payment_intents SET provider_cancelled_at=NULL WHERE colis_id='b8300000-0000-4000-8000-000000000002'$q$,'R3 the cancellation proof is final','23001',
 'La preuve d’annulation PayPlug d’un lien est définitive.','retention:payment_intents');
SELECT ret_reject($q$UPDATE payment_intents SET provider_id='pay_otherLink' WHERE colis_id='b8300000-0000-4000-8000-000000000002'$q$,'R3 the PayPlug reference is final','23001',
 'La référence PayPlug d’un lien de paiement ne se modifie pas.','retention:payment_intents');
SELECT ret_reject($q$UPDATE payment_intents SET return_token_hash=repeat('d',64) WHERE colis_id='b8300000-0000-4000-8000-000000000002'$q$,'R3 the return token is renewed only by a new creation attempt','23001',
 'Le jeton de retour d’un lien de paiement ne se renouvelle qu’à une nouvelle tentative de création.','retention:payment_intents');

-- ── R4. A quote saved while its link was being created, then PayPlug's refusal: creating → superseded → failed ──
SELECT ret_as('service');
SELECT reserve_payplug_intent('b8300000-0000-4000-8000-000000000003',1,2000,false,repeat('e',64),now()+interval '90 days');
SELECT ret_as('postgres');
UPDATE colis SET devis_total=21,devis_transport=21 WHERE id='b8300000-0000-4000-8000-000000000003';   -- version_quote: a new version
SELECT ret_assert((SELECT status='superseded' FROM payment_intents WHERE colis_id='b8300000-0000-4000-8000-000000000003')
 AND (SELECT quote_version=2 FROM colis WHERE id='b8300000-0000-4000-8000-000000000003')
 AND (SELECT count(*)=1 AND bool_and(version=2 AND total=21) FROM quote_versions WHERE colis_id='b8300000-0000-4000-8000-000000000003'),'R4 version_quote supersedes the link being created and records the new version');
SELECT ret_as('service');
UPDATE payment_intents SET status='failed' WHERE colis_id='b8300000-0000-4000-8000-000000000003';
SELECT ret_assert((SELECT status='failed' FROM payment_intents WHERE colis_id='b8300000-0000-4000-8000-000000000003'),'R4 payplug-create may still mark that reservation failed: superseded → failed, without a PayPlug reference');
-- A new calculation is a new version; the former version stays as it was.
SELECT ret_as('postgres');
UPDATE colis SET devis_total=22,devis_transport=22 WHERE id='b8300000-0000-4000-8000-000000000003';
SELECT ret_assert((SELECT array_agg(version||':'||total ORDER BY version)=ARRAY['2:21.00','3:22.00'] FROM quote_versions WHERE colis_id='b8300000-0000-4000-8000-000000000003'),'R4 each calculation adds a version');
SELECT ret_reject($q$UPDATE quote_versions SET total=1 WHERE colis_id='b8300000-0000-4000-8000-000000000003'$q$,'R4 a quote version is final','23001',
 'Une version de devis enregistrée est conservée telle quelle : un nouveau calcul crée une nouvelle version.','retention:quote_versions');
SELECT ret_reject($q$DELETE FROM quote_versions WHERE colis_id='b8300000-0000-4000-8000-000000000003'$q$,'R4 a quote version is never deleted','23001',NULL,'retention:quote_versions');

-- ── R5. A manual payment ──
SELECT ret_as('director');
SELECT ret_assert((mark_manual_payment('b8300000-0000-4000-8000-00000000000a',25)).statut='paye','R5 mark_manual_payment records the payment');
SELECT ret_assert((SELECT count(*)=1 AND bool_and(montant=25 AND statut='confirme') FROM paiements WHERE colis_id='b8300000-0000-4000-8000-00000000000a'),'R5 one ledger row');

-- ── R6. Messages and their deliveries: only the delivery state and the reading move; sent and cancelled are final ──
SELECT ret_as('director');
SELECT queue_message('b8300000-0000-4000-8000-000000000004','Bonjour Flavie, vos cartons sont bien arrivés à Paris.',NULL,'ret-m1',NULL,'telegram');
SELECT queue_message('b8300000-0000-4000-8000-000000000004','Bonjour Flavie, pouvez-vous nous transmettre votre facture ?',NULL,'ret-m2',NULL,'telegram');
SELECT ret_as('service');
-- dispatchOutbox, delivered: claim, then the message and the delivery recorded.
UPDATE notification_outbox SET status='sending',locked_at=now() WHERE id=(ret_outbox('ret-m1')).id AND status IN ('pending','blocked');
UPDATE messages SET statut='envoye',telegram_msg_id='5001' WHERE id=(ret_outbox('ret-m1')).message_id;
UPDATE notification_outbox SET status='sent',sent_at=now(),attempts=attempts+1,last_error=NULL WHERE id=(ret_outbox('ret-m1')).id;
-- dispatchOutbox, not confirmed: failed and « echec »; send-telegram's confirmed retry; a reminder held while the client
-- talks (reopen_customer_conversation, set_conversation_state); then cancelled because the dossier changed.
UPDATE notification_outbox SET status='sending',locked_at=now() WHERE id=(ret_outbox('ret-m2')).id AND status IN ('pending','blocked');
UPDATE notification_outbox SET status='failed',attempts=attempts+1,last_error='Telegram n’a pas confirmé la livraison du message' WHERE id=(ret_outbox('ret-m2')).id;
UPDATE messages SET statut='echec' WHERE id=(ret_outbox('ret-m2')).message_id;
UPDATE notification_outbox SET status='pending',available_at=now(),last_error=NULL WHERE id=(ret_outbox('ret-m2')).id AND status='failed';
UPDATE notification_outbox SET status='blocked',last_error='Conversation client à traiter avant toute relance' WHERE id=(ret_outbox('ret-m2')).id AND status='pending';
UPDATE notification_outbox SET status='pending',available_at=now(),last_error=NULL WHERE id=(ret_outbox('ret-m2')).id AND status='blocked';
UPDATE notification_outbox SET status='sending',locked_at=now() WHERE id=(ret_outbox('ret-m2')).id AND status IN ('pending','blocked');
UPDATE notification_outbox SET status='cancelled',last_error='Le dossier ou la demande a changé. Préparez un nouveau message avant de l’envoyer.' WHERE id=(ret_outbox('ret-m2')).id;
UPDATE messages SET statut='echec' WHERE id=(ret_outbox('ret-m2')).message_id;
SELECT ret_as('director');
UPDATE messages SET lu=true WHERE id=(ret_outbox('ret-m1')).message_id;   -- the team reads it (updateMessageLu)
SELECT ret_as('postgres');
SELECT ret_assert((SELECT o.status='sent' AND o.sent_at IS NOT NULL AND o.attempts=1 AND m.statut='envoye' AND m.telegram_msg_id='5001' AND m.lu FROM notification_outbox o JOIN messages m ON m.id=o.message_id WHERE o.idempotency_key='ret-m1')
 AND (SELECT o.status='cancelled' AND o.attempts=1 AND m.statut='echec' FROM notification_outbox o JOIN messages m ON m.id=o.message_id WHERE o.idempotency_key='ret-m2'),
 'R6 queue_message, the delivery, the retry, the reminder hold, the cancellation and the reading all go through');
SELECT ret_as('director');
SELECT ret_reject($q$UPDATE messages SET texte='Message réécrit' WHERE id=(ret_outbox('ret-m1')).message_id$q$,'R6 the text of a recorded message is final, for the team too','23001',
 'Le contenu d’un message enregistré ne se modifie pas : seuls son état d’envoi et sa lecture évoluent.','retention:messages');
SELECT ret_reject($q$DELETE FROM messages WHERE id=(ret_outbox('ret-m1')).message_id$q$,'R6 a staff session holds no DELETE on messages','42501');
SELECT ret_as('service');
SELECT ret_reject($q$UPDATE messages SET created_at=now()-interval '1 day' WHERE id=(ret_outbox('ret-m2')).message_id$q$,'R6 the date of a message is final, for the service key too','23001',NULL,'retention:messages');
SELECT ret_reject($q$DELETE FROM notification_outbox WHERE id=(ret_outbox('ret-m1')).id$q$,'R6 the service key holds no DELETE on deliveries','42501');
SELECT ret_as('postgres');
SELECT ret_reject($q$DELETE FROM messages WHERE id=(ret_outbox('ret-m1')).message_id$q$,'R6 a message is never deleted','23001',
 'Un message est conservé dans l’historique du dossier : il ne se supprime pas.','retention:messages');
SELECT ret_reject($q$UPDATE notification_outbox SET sent_at=now()-interval '1 day' WHERE id=(ret_outbox('ret-m1')).id$q$,'R6 a confirmed delivery is final','23001',
 'Un envoi confirmé ou annulé est définitif : sa sortie ne se modifie plus.','retention:notification_outbox');
SELECT ret_reject($q$UPDATE notification_outbox SET status='pending' WHERE id=(ret_outbox('ret-m2')).id$q$,'R6 a cancelled delivery is final','23001',
 'Un envoi confirmé ou annulé est définitif : sa sortie ne se modifie plus.','retention:notification_outbox');
SELECT ret_reject($q$UPDATE notification_outbox SET colis_id='b8300000-0000-4000-8000-000000000001' WHERE id=(ret_outbox('ret-m2')).id$q$,'R6 a delivery keeps its dossier','23001',
 'Le message, le destinataire, le dossier et le canal d’une sortie de message ne se modifient pas.','retention:notification_outbox');
SELECT ret_reject($q$DELETE FROM notification_outbox WHERE id=(ret_outbox('ret-m2')).id$q$,'R6 a delivery is never deleted','23001',
 'Une sortie de message est conservée dans l’historique des envois : elle ne se supprime pas.','retention:notification_outbox');
-- The team's UPDATE policy on messages covers the reading only: the delivery state is the dispatcher's (service key).
SELECT ret_as('director');
SELECT ret_reject($q$UPDATE messages SET statut='envoye' WHERE id=(ret_outbox('ret-m2')).message_id$q$,'R6 a team session cannot mark a failed message as sent','23001',
 'L’état d’envoi d’un message est enregistré par l’envoi lui-même : l’équipe peut seulement le marquer comme lu.','retention:messages');
SELECT ret_reject($q$UPDATE messages SET telegram_msg_id='5999' WHERE id=(ret_outbox('ret-m1')).message_id$q$,'R6 nor rewrite the Telegram reference of a delivery','23001',
 'L’état d’envoi d’un message est enregistré par l’envoi lui-même : l’équipe peut seulement le marquer comme lu.','retention:messages');
-- dispatchOutbox's catch after a send Telegram confirmed (a later write failed): the message stays sent, as its outbox
-- row does, and never shows the « Réessayer » of a failed delivery.
SELECT ret_as('service');
SELECT ret_reject($q$UPDATE messages SET statut='echec' WHERE id=(ret_outbox('ret-m1')).message_id$q$,'R6 a delivery Telegram confirmed never turns into a failure, for the service key too','23001',
 'Un message dont l’envoi est confirmé le reste : son état ne revient ni à « en cours » ni à « échec ».','retention:messages');
SELECT ret_reject($q$UPDATE notification_outbox SET status='failed' WHERE id=(ret_outbox('ret-m1')).id$q$,'R6 nor does its outbox row','23001',
 'Un envoi confirmé ou annulé est définitif : sa sortie ne se modifie plus.','retention:notification_outbox');

-- ── R7. A client message without a dossier: kept, then attached once ──
SELECT ret_as('service');
-- telegram-webhook (upsert, ignoreDuplicates): one row per Telegram event; a repeated event changes nothing.
INSERT INTO client_inbox(client_id,texte,telegram_update_id,payload) VALUES('b8200000-0000-4000-8000-000000000001','Voici ma facture',880001,'{"message_id":71,"text":"Voici ma facture"}')
 ON CONFLICT (telegram_update_id) DO NOTHING;
INSERT INTO client_inbox(client_id,texte,telegram_update_id,payload) VALUES('b8200000-0000-4000-8000-000000000003','Bonjour',880002,'{"message_id":72,"text":"Bonjour"}')
 ON CONFLICT (telegram_update_id) DO NOTHING;
INSERT INTO client_inbox(client_id,texte,telegram_update_id,payload) VALUES('b8200000-0000-4000-8000-000000000001','Autre texte',880001,'{"message_id":71,"text":"Autre texte"}')
 ON CONFLICT (telegram_update_id) DO NOTHING;
SELECT set_config('ret.inbox',(SELECT id::text FROM client_inbox WHERE telegram_update_id=880001),true);
SELECT claim_inbox_assignment(current_setting('ret.inbox')::uuid,'b8300000-0000-4000-8000-000000000004');
-- The document could not be taken in (unsupported file): back to the team with its error, the chosen dossier kept.
UPDATE client_inbox SET status='unassigned',payload=payload||jsonb_build_object('intake_error','Format de fichier non pris en charge'),texte='RET-MSG — Format de fichier non pris en charge'
 WHERE id=current_setting('ret.inbox')::uuid;
SELECT claim_inbox_assignment(current_setting('ret.inbox')::uuid,'b8300000-0000-4000-8000-000000000004');
UPDATE client_inbox SET colis_id='b8300000-0000-4000-8000-000000000004',status='assigned' WHERE id=current_setting('ret.inbox')::uuid AND status='assigning';
SELECT ret_assert((SELECT status='assigned' AND colis_id='b8300000-0000-4000-8000-000000000004' AND payload->>'text'='Voici ma facture' AND payload ? 'intake_error' FROM client_inbox WHERE id=current_setting('ret.inbox')::uuid),
 'R7 the webhook, the assignment, an intake error and the final assignment all go through; a repeated event changes nothing');
SELECT ret_reject($q$DELETE FROM client_inbox WHERE id=current_setting('ret.inbox')::uuid$q$,'R7 the service key holds no DELETE on the inbox','42501');
SELECT ret_as('postgres');
SELECT ret_reject($q$UPDATE client_inbox SET colis_id='b8300000-0000-4000-8000-000000000001' WHERE id=current_setting('ret.inbox')::uuid$q$,'R7 an attached message stays in its dossier','23001',
 'Un message reçu rattaché à un dossier y reste.','retention:client_inbox');
SELECT ret_reject($q$UPDATE client_inbox SET payload=jsonb_set(payload,'{text}','"Texte modifié"') WHERE id=current_setting('ret.inbox')::uuid$q$,'R7 what the client sent is final','23001',
 'Un message reçu (client, événement Telegram, contenu d’origine) ne se modifie pas.','retention:client_inbox');
SELECT ret_reject($q$UPDATE client_inbox SET client_id='b8200000-0000-4000-8000-000000000003' WHERE id=current_setting('ret.inbox')::uuid$q$,'R7 its sender is final','23001',NULL,'retention:client_inbox');
SELECT ret_reject($q$DELETE FROM client_inbox WHERE id=current_setting('ret.inbox')::uuid$q$,'R7 a client message is never deleted','23001',
 'Un message reçu d’un client est conservé : il ne se supprime pas.','retention:client_inbox');

-- ── R8. A late invoice withdraws a sent quote: the request and the withdrawal are a record ──
SELECT ret_as('postgres');
-- register_late_invoice_from_message and deposit_client_invoice open the request through this writer.
SELECT set_config('ret.withdrawal',(SELECT _open_late_invoice_request(c,'b8500000-0000-4000-8000-000000000001','telegram')::text FROM colis c WHERE c.id='b8300000-0000-4000-8000-000000000005'),true);
SELECT ret_as('service');
SELECT ret_assert((claim_quote_withdrawal(current_setting('ret.withdrawal')::uuid))->>'status'='processing','R8 claim_quote_withdrawal takes the request');
SELECT ret_assert((release_quote_withdrawal(current_setting('ret.withdrawal')::uuid,'retry','PayPlug indisponible'))->>'status'='pending','R8 release_quote_withdrawal schedules a retry');
SELECT claim_quote_withdrawal(current_setting('ret.withdrawal')::uuid);
SELECT ret_assert((complete_quote_withdrawal(current_setting('ret.withdrawal')::uuid))->>'status'='withdrawn','R8 complete_quote_withdrawal withdraws the quote');
SELECT mark_quote_withdrawal_message('b8300000-0000-4000-8000-000000000005',1,'manual');   -- the team informs the client by hand
SELECT ret_as('postgres');
SELECT ret_assert((SELECT status='withdrawn' AND withdrawn_at IS NOT NULL AND withdrawn_quote_version=1 AND previous_statut='devis_envoye' AND client_message_status='manual'
   AND facture_ids=ARRAY['b8500000-0000-4000-8000-000000000001']::uuid[] FROM quote_withdrawals WHERE id=current_setting('ret.withdrawal')::uuid)
 AND EXISTS(SELECT 1 FROM quote_versions WHERE colis_id='b8300000-0000-4000-8000-000000000005' AND version=1 AND total=30),'R8 the withdrawal and the withdrawn quote are recorded');
SELECT ret_reject($q$UPDATE quote_withdrawals SET reason='Motif réécrit' WHERE id=current_setting('ret.withdrawal')::uuid$q$,'R8 the request is final','23001',
 'Une demande de retrait de devis (dossier, version, origine, motif, auteur, factures concernées) ne se réécrit pas.','retention:quote_withdrawals');
SELECT ret_reject($q$UPDATE quote_withdrawals SET facture_ids='{}' WHERE id=current_setting('ret.withdrawal')::uuid$q$,'R8 its invoices are never removed','23001',NULL,'retention:quote_withdrawals');
SELECT ret_reject($q$UPDATE quote_withdrawals SET withdrawn_at=now()-interval '1 day' WHERE id=current_setting('ret.withdrawal')::uuid$q$,'R8 the effective withdrawal is final','23001',
 'Le retrait effectif d’un devis (date, version, étape précédente) est définitif.','retention:quote_withdrawals');
SELECT ret_reject($q$DELETE FROM quote_withdrawals WHERE id=current_setting('ret.withdrawal')::uuid$q$,'R8 a request is never deleted','23001',
 'Une demande de retrait de devis est conservée dans l’historique du dossier : elle ne se supprime pas.','retention:quote_withdrawals');
SELECT ret_as('service');
SELECT ret_reject($q$DELETE FROM quote_withdrawals WHERE id=current_setting('ret.withdrawal')::uuid$q$,'R8 the service key holds no DELETE on the requests','42501');

-- ── R9. Loading control, confirmation, manifest: the checks of a confirmed departure are final ──
SELECT ret_as('checker');
SELECT ret_assert((record_loading_check('b8400000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000006',1,1,'scan'))->>'status'='recorded','R9 record_loading_check records a scan');
SELECT ret_as('shipper');
SELECT ret_assert((clear_loading_checks('b8400000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000006'))->>'cleared'='1','R9 before the confirmation, clear_loading_checks still removes a check');
SELECT ret_as('checker');
SELECT record_loading_check('b8400000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000006',1,1,'camera');
SELECT ret_as('shipper');
SELECT ret_assert((confirm_departure(e.id,jsonb_build_array(jsonb_build_object('id','b8300000-0000-4000-8000-000000000006','updated_at',ret_version('b8300000-0000-4000-8000-000000000006'),'outgoing_parcel_count',1)),e.updated_at)).statut='parti',
 'R9 confirm_departure records the manifest') FROM envois e WHERE e.id='b8400000-0000-4000-8000-000000000001';
SELECT ret_as('postgres');
SELECT ret_assert((SELECT snapshot#>>'{items,0,loading_checks,0,method}'='camera' FROM departure_manifests WHERE envoi_id='b8400000-0000-4000-8000-000000000001')
 AND (SELECT count(*)=1 FROM departure_loading_checks WHERE envoi_id='b8400000-0000-4000-8000-000000000001'),'R9 the manifest holds the check, still stored');
SELECT ret_reject($q$UPDATE departure_loading_checks SET checked_at=now()-interval '1 hour' WHERE envoi_id='b8400000-0000-4000-8000-000000000001'$q$,'R9 the check of a confirmed departure is final','23001',
 'Le contrôle de chargement d’un départ confirmé est conservé tel quel : il figure au manifeste du départ.','retention:departure_loading_checks');
SELECT ret_reject($q$DELETE FROM departure_loading_checks WHERE envoi_id='b8400000-0000-4000-8000-000000000001'$q$,'R9 and never deleted','23001',
 'Le contrôle de chargement d’un départ confirmé est conservé tel quel : il figure au manifeste du départ.','retention:departure_loading_checks');
-- Through the cascade of a staff profile: Contrôle recorded this check and nothing else (Expédition cleared the first one).
SELECT ret_reject($q$DELETE FROM profiles WHERE id='b8000000-0000-4000-8000-000000000004'$q$,'R9 deleting the person who scanned does not erase the check','23001',
 'Le contrôle de chargement d’un départ confirmé est conservé tel quel : il figure au manifeste du départ.','retention:departure_loading_checks');
SELECT ret_reject($q$UPDATE departure_manifests SET snapshot='{}' WHERE envoi_id='b8400000-0000-4000-8000-000000000001'$q$,'R9 the manifest is final','23001',
 'Le manifeste d’un départ confirmé est conservé tel quel : il ne se modifie pas et ne se supprime pas.','retention:departure_manifests');
SELECT ret_reject($q$DELETE FROM departure_manifests WHERE envoi_id='b8400000-0000-4000-8000-000000000001'$q$,'R9 and never deleted','23001',NULL,'retention:departure_manifests');
SELECT ret_reject($q$DELETE FROM envois WHERE id='b8400000-0000-4000-8000-000000000001'$q$,'R9 a confirmed departure stays (guard_departure_changes)','22023','Un départ confirmé doit rester dans l’historique');
SELECT ret_as('shipper');
SELECT ret_reject($q$SELECT clear_loading_checks('b8400000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000006')$q$,'R9 clear_loading_checks refuses a departure that left','22023');
-- The controlled correction of a shipped dossier (revert_colis) keeps the loading evidence.
SELECT ret_as('director');
SELECT ret_assert((revert_colis('b8300000-0000-4000-8000-000000000006',ret_version('b8300000-0000-4000-8000-000000000006'))).statut='paye','R9 revert_colis takes a shipped dossier back');
SELECT ret_as('postgres');
SELECT ret_assert((SELECT count(*)=1 FROM departure_loading_checks WHERE envoi_id='b8400000-0000-4000-8000-000000000001'),'R9 its loading check is kept');

-- ── R10. A reception receipt ──
SELECT ret_as('director');
SELECT append_reception_cartons(id,'[{"dimL":20,"dimW":15,"dimH":10,"poids":1.25,"tracking":"RET-NEW-1","fournisseur":"Boutique"}]',updated_at,'C3','Nouveau carton reçu',NULL,
 'b8700000-0000-4000-8000-000000000001') FROM colis WHERE id='b8300000-0000-4000-8000-000000000008';
SELECT ret_as('postgres');
SELECT ret_assert((SELECT count(*)=1 FROM reception_append_receipts WHERE colis_id='b8300000-0000-4000-8000-000000000008'),'R10 append_reception_cartons records its receipt');
SELECT ret_reject($q$UPDATE reception_append_receipts SET added=2 WHERE colis_id='b8300000-0000-4000-8000-000000000008'$q$,'R10 a receipt is final','23001',
 'Le reçu d’un ajout de cartons est conservé tel quel : il ne se modifie pas et ne se supprime pas.','retention:reception_append_receipts');
SELECT ret_reject($q$DELETE FROM reception_append_receipts WHERE colis_id='b8300000-0000-4000-8000-000000000008'$q$,'R10 and never deleted','23001',NULL,'retention:reception_append_receipts');

-- ── R11. Journals: an entry is added, never rewritten; a correction is a new entry ──
SELECT ret_as('director');
INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail) VALUES('b8300000-0000-4000-8000-000000000004','b8000000-0000-4000-8000-000000000001','Camille Hoarau','note_dossier','Carton abîmé à réception');
SELECT set_config('ret.audit',(SELECT id::text FROM audit_actions WHERE action='note_dossier' AND colis_id='b8300000-0000-4000-8000-000000000004'),true);
INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail) VALUES('b8300000-0000-4000-8000-000000000004','b8000000-0000-4000-8000-000000000001','Camille Hoarau','note_dossier_correction',
 'Correction de l’entrée '||current_setting('ret.audit')||' : le carton est intact, seul l’emballage est abîmé');
INSERT INTO com_log(colis_id,client_id,canal,template,msg,user_id,user_nom,statut) VALUES('b8300000-0000-4000-8000-000000000004','b8200000-0000-4000-8000-000000000001','telegram','note','Appel du client',
 'b8000000-0000-4000-8000-000000000001','Camille Hoarau','envoye');
SELECT ret_assert((SELECT count(*)=2 FROM audit_actions WHERE colis_id='b8300000-0000-4000-8000-000000000004' AND action LIKE 'note_dossier%')
 AND (SELECT count(*)=1 FROM com_log WHERE colis_id='b8300000-0000-4000-8000-000000000004'),'R11 the team adds an entry and its correction, and a communication');
SELECT ret_reject($q$UPDATE audit_actions SET detail='Réécrit' WHERE id=current_setting('ret.audit')::uuid$q$,'R11 a staff session holds no UPDATE on the journal','42501');
SELECT ret_as('service');
SELECT ret_reject($q$DELETE FROM audit_actions WHERE id=current_setting('ret.audit')::uuid$q$,'R11 the service key holds no DELETE on the journal','42501');
SELECT ret_as('postgres');
SELECT ret_reject($q$UPDATE audit_actions SET detail='Réécrit' WHERE id=current_setting('ret.audit')::uuid$q$,'R11 a journal entry is final, even for the owner','23001',
 'Le journal des actions est conservé dix ans : une entrée ne se modifie pas et ne se supprime pas ; une correction s’ajoute comme une nouvelle entrée.','retention:audit_actions');
SELECT ret_reject($q$DELETE FROM audit_actions WHERE id=current_setting('ret.audit')::uuid$q$,'R11 and never deleted','23001',NULL,'retention:audit_actions');
SELECT ret_assert((SELECT count(*)>=2 FROM logs_statut WHERE colis_id='b8300000-0000-4000-8000-000000000001'),'R11 the status journal of RET-PAY holds its changes');
SELECT ret_reject($q$UPDATE logs_statut SET nouveau_statut='livre' WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R11 a status change is final','23001',
 'L’historique des statuts est conservé dix ans : une entrée ne se modifie pas et ne se supprime pas.','retention:logs_statut');
SELECT ret_reject($q$DELETE FROM logs_statut WHERE colis_id='b8300000-0000-4000-8000-000000000001'$q$,'R11 and never deleted','23001',NULL,'retention:logs_statut');
SELECT ret_reject($q$UPDATE com_log SET msg='Réécrit' WHERE colis_id='b8300000-0000-4000-8000-000000000004'$q$,'R11 a communication is final','23001',
 'Le journal des communications est conservé dix ans : une entrée ne se modifie pas et ne se supprime pas.','retention:com_log');
SELECT ret_reject($q$DELETE FROM com_log WHERE colis_id='b8300000-0000-4000-8000-000000000004'$q$,'R11 and never deleted','23001',NULL,'retention:com_log');

-- ── R12. Dossiers, clients and departures that carry history are kept; the keys hold without the guards ──
SELECT ret_reject($q$DELETE FROM colis WHERE id='b8300000-0000-4000-8000-000000000001'$q$,'R12 a dossier with payments is kept','23001',
 'Ce dossier a un historique conservé dix ans (devis, paiement, messages, documents ou journal) : il ne peut pas être supprimé. Annulez-le ou archivez-le.','retention:colis');
SELECT ret_reject($q$DELETE FROM colis WHERE id='b8300000-0000-4000-8000-000000000004'$q$,'R12 a dossier with a conversation is kept','23001',NULL,'retention:colis');
SELECT ret_reject($q$DELETE FROM colis WHERE id='b8300000-0000-4000-8000-000000000005'$q$,'R12 a dossier with a document and a withdrawn quote is kept','23001',NULL,'retention:colis');
-- Even without the dossier guard, no key cascades into the history any more.
DO $$
DECLARE before_data jsonb:=ret_history(); target uuid;
BEGIN
 FOREACH target IN ARRAY ARRAY['b8300000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000004','b8300000-0000-4000-8000-000000000008']::uuid[] LOOP
  BEGIN
   ALTER TABLE colis DISABLE TRIGGER retention_guard;
   DELETE FROM colis WHERE id=target;
   RAISE EXCEPTION 'FAIL: dossier % deleted with its history',target;
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
 END LOOP;
 IF ret_history()<>before_data OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='colis'::regclass AND tgname='retention_guard' AND tgenabled='O') THEN
  RAISE EXCEPTION 'FAIL: a refused deletion changed the history or left the guard off'; END IF;
 RAISE NOTICE 'PASS rejected: R12 without the guard, the RESTRICT keys refuse to delete a dossier with payments, a conversation or a reception receipt';
END $$;
SELECT ret_reject($q$TRUNCATE colis CASCADE$q$,'R12 a cascading TRUNCATE is refused','23001');
DELETE FROM colis WHERE id='b8300000-0000-4000-8000-000000000007';
SELECT ret_assert(NOT EXISTS(SELECT 1 FROM colis WHERE id='b8300000-0000-4000-8000-000000000007'),'R12 a dossier without any history can still be deleted');
-- Clients.
SELECT ret_reject($q$DELETE FROM clients WHERE id='b8200000-0000-4000-8000-000000000001'$q$,'R12 a client with dossiers is kept (guard_client_history_delete)','P0001',
 'Ce client possède un historique de dossiers. Conservez sa fiche.');
SELECT ret_reject($q$DELETE FROM clients WHERE id='b8200000-0000-4000-8000-000000000003'$q$,'R12 a client whose only history is a message is kept','23001',
 'Ce client a un historique conservé dix ans (dossiers, échanges, invitation Telegram ou paiements) : sa fiche ne peut pas être supprimée.','retention:clients');
DO $$
BEGIN
 BEGIN
  ALTER TABLE clients DISABLE TRIGGER retention_guard;
  DELETE FROM clients WHERE id='b8200000-0000-4000-8000-000000000003';
  RAISE EXCEPTION 'FAIL: client deleted with its message';
 EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASS rejected: R12 without the guard, the key of the inbox still refuses (in English: hence the guard)';
 END;
END $$;
SELECT ret_as('director');
SELECT create_telegram_invitation('b8200000-0000-4000-8000-000000000004');
SELECT ret_reject($q$DELETE FROM clients WHERE id='b8200000-0000-4000-8000-000000000004'$q$,'R12 the direction cannot delete a client invited to Telegram: French message through the API','23001',
 'Ce client a un historique conservé dix ans (dossiers, échanges, invitation Telegram ou paiements) : sa fiche ne peut pas être supprimée.','retention:clients');
DELETE FROM clients WHERE id='b8200000-0000-4000-8000-000000000002';
SELECT ret_as('postgres');
SELECT ret_assert(NOT EXISTS(SELECT 1 FROM clients WHERE id='b8200000-0000-4000-8000-000000000002'),'R12 the direction still deletes a client without history');
SELECT ret_as('shipper');
DELETE FROM clients WHERE id='b8200000-0000-4000-8000-000000000005';   -- not the direction: RLS hides the row, no error
SELECT ret_as('postgres');
SELECT ret_assert(EXISTS(SELECT 1 FROM clients WHERE id='b8200000-0000-4000-8000-000000000005'),'R12 outside the direction, RLS deletes nothing and raises nothing: the screen must check the deleted row');
-- Departures.
SELECT ret_reject($q$DELETE FROM envois WHERE id='b8400000-0000-4000-8000-000000000005'$q$,'R12 a departure that still carries a dossier is kept','23001',
 'Ce départ contient encore des dossiers : retirez-les du départ avant de le supprimer.','retention:envois');
SELECT ret_reject($q$DELETE FROM envois WHERE id='b8400000-0000-4000-8000-000000000003'$q$,'R12 a departure that left before the manifests is kept','23001',
 'Un départ parti reste dans l’historique : il ne peut pas être supprimé.','retention:envois');
SELECT ret_as('shipper');
DELETE FROM envois WHERE id='b8400000-0000-4000-8000-000000000005';   -- RLS: only a planned departure without dossier
SELECT ret_as('postgres');
SELECT ret_assert(EXISTS(SELECT 1 FROM envois WHERE id='b8400000-0000-4000-8000-000000000005'),'R12 RLS keeps the loaded departure from the API without an error: the screen must check the deleted row');
SELECT ret_as('shipper');
DELETE FROM envois WHERE id='b8400000-0000-4000-8000-000000000004';
SELECT ret_as('postgres');
SELECT ret_assert(NOT EXISTS(SELECT 1 FROM envois WHERE id='b8400000-0000-4000-8000-000000000004'),'R12 a planned departure without dossier is still deleted');

-- ── R13. TRUNCATE: no history can be emptied ──
DO $$
DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['paiements','payment_intents','legacy_payplug_payments','quote_versions','quote_withdrawals','audit_actions','logs_statut',
  'notification_outbox','client_inbox','com_log','reception_append_receipts','departure_manifests','departure_loading_checks'] LOOP
  PERFORM ret_reject(format('TRUNCATE %I',tbl),'R13 TRUNCATE '||tbl,'23001',format('L’historique « %s » est conservé dix ans : il ne peut pas être vidé.',tbl),'retention:'||tbl);
 END LOOP;
END $$;
-- messages is referenced by the deliveries and the withdrawals: PostgreSQL itself refuses a plain TRUNCATE, the guard a cascading one.
SELECT ret_reject($q$TRUNCATE messages$q$,'R13 TRUNCATE messages','0A000');
SELECT ret_reject($q$TRUNCATE messages CASCADE$q$,'R13 TRUNCATE messages CASCADE','23001');
ROLLBACK;
