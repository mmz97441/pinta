BEGIN;
GRANT USAGE ON SCHEMA public TO service_role,authenticated,anon;
CREATE FUNCTION return_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label;END IF;RAISE NOTICE 'PASS: %',label;END; $$;
CREATE FUNCTION return_reject(command text,label text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE command;EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>expected THEN RAISE EXCEPTION 'FAIL wrong error % for %: %',SQLSTATE,label,SQLERRM;END IF;RAISE NOTICE 'PASS rejected: %',label;RETURN;END;RAISE EXCEPTION 'FAIL accepted: %',label;END; $$;
INSERT INTO auth.users(id,email) VALUES
 ('ed100000-0000-4000-8000-000000000001','return-owner@example.test'),
 ('ed100000-0000-4000-8000-000000000002','return-other@example.test'),
 ('ed100000-0000-4000-8000-000000000003','return-director@example.test'),
 ('ed100000-0000-4000-8000-000000000004','return-no-finance@example.test'),
 ('ed100000-0000-4000-8000-000000000005','return-finance@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('ed200000-0000-4000-8000-000000000003','ed100000-0000-4000-8000-000000000003','Direction','return-director@example.test','directeur',false),
 ('ed200000-0000-4000-8000-000000000004','ed100000-0000-4000-8000-000000000004','Preparation','return-no-finance@example.test','preparateur',false),
 ('ed200000-0000-4000-8000-000000000005','ed100000-0000-4000-8000-000000000005','Comptabilite','return-finance@example.test','preparateur',false);
INSERT INTO staff_permissions(staff_id) VALUES('ed200000-0000-4000-8000-000000000004'),('ed200000-0000-4000-8000-000000000005') ON CONFLICT(staff_id) DO NOTHING;
UPDATE staff_permissions SET perm_finances_voir_total=false,perm_colis_envoyer_devis=false,perm_colis_confirmer_paiement=false WHERE staff_id='ed200000-0000-4000-8000-000000000004';
UPDATE staff_permissions SET perm_finances_voir_total=true WHERE staff_id='ed200000-0000-4000-8000-000000000005';
INSERT INTO clients(id,user_id,nom,cp,type) VALUES
 ('ed300000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','Owner private name','97400','particulier');
INSERT INTO colis(id,client_id,ref,statut,quote_version,devis_total,devis_transport,devis_brouillon) VALUES
 ('ed400000-0000-4000-8000-000000000001','ed300000-0000-4000-8000-000000000001','EXP-RETURN','devis_envoye',1,40,40,false),
 ('ed400000-0000-4000-8000-000000000002','ed300000-0000-4000-8000-000000000001','EXP-NONE','receptionne',0,NULL,NULL,true);
INSERT INTO payment_intents(id,colis_id,quote_version,provider_id,amount_cents,status,provider_is_live,return_token_hash,return_token_expires_at) VALUES
 ('ed500000-0000-4000-8000-000000000001','ed400000-0000-4000-8000-000000000001',1,'pay_returnFixture',4000,'pending',false,repeat('a',64),now()+interval '90 days');
SELECT return_assert(NOT has_function_privilege('anon','get_payment_return(text,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','get_payment_return(text,uuid,uuid)','EXECUTE') AND has_function_privilege('service_role','get_payment_return(text,uuid,uuid)','EXECUTE'),'receipt RPC can only be called by verified Edge service');
SELECT return_assert((SELECT provolatile='s' AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid='get_payment_return(text,uuid,uuid)'::regprocedure),'receipt RPC is STABLE with hardened search path');
SELECT return_reject($q$UPDATE payment_intents SET return_token_hash=NULL WHERE id='ed500000-0000-4000-8000-000000000001'$q$,'expiry without hash rejected','23514');
SELECT return_reject($q$UPDATE payment_intents SET return_token_expires_at=NULL WHERE id='ed500000-0000-4000-8000-000000000001'$q$,'hash without expiry rejected','23514');
SELECT return_reject($q$UPDATE payment_intents SET return_token_hash='short' WHERE id='ed500000-0000-4000-8000-000000000001'$q$,'weak malformed hash rejected','23514');
SELECT set_config('test.return_before',(SELECT jsonb_build_object('colis',(SELECT jsonb_agg(to_jsonb(c)) FROM colis c),'intents',(SELECT jsonb_agg(to_jsonb(i)) FROM payment_intents i),'payments',(SELECT jsonb_agg(to_jsonb(p)) FROM paiements p),'notifications',(SELECT jsonb_agg(to_jsonb(n)) FROM notifications n),'outbox',(SELECT jsonb_agg(to_jsonb(n)) FROM notification_outbox n))::text),true);
SET LOCAL ROLE anon;
SELECT return_reject($q$SELECT get_payment_return(repeat('a',64),NULL,NULL)$q$,'anonymous cannot call database receipt directly','42501');
SET LOCAL ROLE authenticated;
SELECT return_reject($q$SELECT get_payment_return(NULL,'ed400000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000003')$q$,'browser cannot forge actor by calling RPC directly','42501');
SET LOCAL ROLE service_role;
SELECT return_assert(get_payment_return(repeat('a',64))->>'status'='pending','unpaid checkout remains pending after browser return');
SELECT return_assert(get_payment_return(NULL,'ed400000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001')=get_payment_return(repeat('a',64)),'legacy owner receives identical minimal projection');
SELECT return_assert(get_payment_return(NULL,'ed400000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000003')=get_payment_return(repeat('a',64)),'director receives customer receipt not staff data');
SELECT return_assert(get_payment_return(NULL,'ed400000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000005')=get_payment_return(repeat('a',64)),'financially authorized staff can read legacy receipt');
SELECT return_reject($q$SELECT get_payment_return(NULL,'ed400000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000004')$q$,'active staff without financial permissions denied','P0403');
SELECT return_reject($q$SELECT get_payment_return(NULL,'ed400000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000002')$q$,'another client cannot read known dossier UUID','P0403');
SELECT return_reject($q$SELECT get_payment_return(NULL,'ed400000-0000-4000-8000-000000000009','ed100000-0000-4000-8000-000000000002')$q$,'missing dossier gives same authorization error','P0403');
SELECT return_reject($q$SELECT get_payment_return(NULL,'ed400000-0000-4000-8000-000000000001',NULL)$q$,'dossier UUID without verified actor is not a capability','P0401');
SELECT return_reject($q$SELECT get_payment_return(repeat('b',64),'ed400000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000003')$q$,'invalid supplied token never falls back to authorized actor','P0404');
SELECT return_assert(NOT (get_payment_return(repeat('a',64))::text LIKE '%Owner private name%') AND (SELECT array_agg(key ORDER BY key)=ARRAY['amountCents','currency','isLive','ok','paidAt','reference','shipment','status'] FROM jsonb_object_keys(get_payment_return(repeat('a',64))) key),'receipt exposes no customer name, contact, staff, identifiers, token or provider URL');
SELECT return_assert(get_payment_return(NULL,'ed400000-0000-4000-8000-000000000002','ed100000-0000-4000-8000-000000000001')->>'status'='unavailable','dossier without PayPlug evidence is not declared paid');
RESET ROLE;
SELECT return_assert(current_setting('test.return_before')::jsonb=(SELECT jsonb_build_object('colis',(SELECT jsonb_agg(to_jsonb(c)) FROM colis c),'intents',(SELECT jsonb_agg(to_jsonb(i)) FROM payment_intents i),'payments',(SELECT jsonb_agg(to_jsonb(p)) FROM paiements p),'notifications',(SELECT jsonb_agg(to_jsonb(n)) FROM notifications n),'outbox',(SELECT jsonb_agg(to_jsonb(n)) FROM notification_outbox n))),'receipt and unauthorized reads do not mutate business data or notify anyone');
UPDATE payment_intents SET return_token_expires_at=now()-interval '1 second' WHERE id='ed500000-0000-4000-8000-000000000001';
SELECT return_reject($q$SELECT get_payment_return(repeat('a',64))$q$,'expired capability denied','P0410');
UPDATE payment_intents SET return_token_expires_at=now()+interval '90 days' WHERE id='ed500000-0000-4000-8000-000000000001';
UPDATE profiles SET actif=false WHERE id='ed100000-0000-4000-8000-000000000001';
SELECT return_reject($q$SELECT get_payment_return(NULL,'ed400000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001')$q$,'inactive client session rejected','P0403');
UPDATE profiles SET actif=true WHERE id='ed100000-0000-4000-8000-000000000001';

-- The same capability sees a late webhook result; no browser action confirms it.
SELECT confirm_payplug_payment('pay_returnFixture','ed400000-0000-4000-8000-000000000001',1,4000,'EUR');
SELECT return_assert(get_payment_return(repeat('a',64))->>'status'='paid' AND get_payment_return(repeat('a',64))->'isLive'='false'::jsonb AND get_payment_return(repeat('a',64))->>'paidAt' IS NOT NULL,'authoritative webhook resolves pending as a simulated payment');
SELECT return_assert(get_payment_return(repeat('a',64))#>>'{shipment,departureDate}' IS NULL,'paid without assigned departure never promises a date');
UPDATE payment_intents SET provider_is_live=NULL WHERE id='ed500000-0000-4000-8000-000000000001';
SELECT return_assert(get_payment_return(repeat('a',64))->>'status'='unavailable','unknown payment mode never becomes a real receipt');
UPDATE payment_intents SET provider_is_live=true WHERE id='ed500000-0000-4000-8000-000000000001';
SELECT return_assert(get_payment_return(repeat('a',64))->>'status'='paid' AND get_payment_return(repeat('a',64))->'isLive'='true'::jsonb,'recorded live mode is returned explicitly');
UPDATE paiements SET montant=39 WHERE provider_id='pay_returnFixture';
SELECT return_assert(get_payment_return(repeat('a',64))->>'status'='unavailable','mismatched ledger amount is not a paid receipt');
UPDATE paiements SET montant=40 WHERE provider_id='pay_returnFixture';
INSERT INTO envois(id,ref,destination_code,statut,date_depart) VALUES('ed600000-0000-4000-8000-000000000001','DEP-RETURN','974','planifie',(now() AT TIME ZONE 'Europe/Paris')::date+1);
UPDATE colis SET envoi_id='ed600000-0000-4000-8000-000000000001' WHERE id='ed400000-0000-4000-8000-000000000001';
SELECT return_assert(get_payment_return(repeat('a',64))#>>'{shipment,departureDate}'=((now() AT TIME ZONE 'Europe/Paris')::date+1)::text,'only the actual assigned future departure is shown');
UPDATE envois SET date_depart=(now() AT TIME ZONE 'Europe/Paris')::date-1 WHERE id='ed600000-0000-4000-8000-000000000001';
SELECT return_assert(get_payment_return(repeat('a',64))#>>'{shipment,departureDate}' IS NULL,'past planned departure is not promised');
SAVEPOINT before_archive;
UPDATE envois SET date_depart=(now() AT TIME ZONE 'Europe/Paris')::date+1,statut='archive' WHERE id='ed600000-0000-4000-8000-000000000001';
SELECT return_assert(get_payment_return(repeat('a',64))#>>'{shipment,departureDate}' IS NULL,'archived departure is not promised');
ROLLBACK TO before_archive;
UPDATE envois SET date_depart=(now() AT TIME ZONE 'Europe/Paris')::date+1,statut='planifie',loading_closes_at=now()-interval '1 second' WHERE id='ed600000-0000-4000-8000-000000000001';
SELECT return_assert(get_payment_return(repeat('a',64))#>>'{shipment,departureDate}'=((now() AT TIME ZONE 'Europe/Paris')::date+1)::text,'loading closure does not erase the future departure of an already assigned parcel');
UPDATE payment_intents SET status='superseded' WHERE id='ed500000-0000-4000-8000-000000000001';
SELECT return_assert(get_payment_return(repeat('a',64))->>'status'='superseded' AND get_payment_return(repeat('a',64))#>>'{shipment,status}'='unavailable' AND get_payment_return(repeat('a',64))->>'paidAt' IS NULL,'obsolete token cannot claim a newer quote payment or shipment');
UPDATE payment_intents SET status='failed' WHERE id='ed500000-0000-4000-8000-000000000001';
SELECT return_assert(get_payment_return(repeat('a',64))->>'status'='unavailable','failed creation is not treated as payment or browser cancellation');
UPDATE payment_intents SET provider_cancelled_at=now() WHERE id='ed500000-0000-4000-8000-000000000001';
SELECT return_assert(get_payment_return(repeat('a',64))->>'status'='cancelled','recorded provider cancellation is explicit');
UPDATE payment_intents SET status='paid' WHERE id='ed500000-0000-4000-8000-000000000001';
SELECT return_assert(get_payment_return(repeat('a',64))->>'status'='paid','a confirmed receipt takes precedence over a cancellation marker');
-- Read-only projection of historical completed shipment facts; this is not a
-- test of departure validation, which has its own full manifest suite.
SET LOCAL session_replication_role='replica';
UPDATE envois SET statut='parti',date_depart='2026-09-29',departed_at='2026-09-29T12:00:00Z' WHERE id='ed600000-0000-4000-8000-000000000001';
UPDATE colis SET statut='livre',date_expedition='2026-09-29T12:00:00Z',date_livraison='2026-09-30T08:00:00Z' WHERE id='ed400000-0000-4000-8000-000000000001';
SET LOCAL session_replication_role='origin';
SELECT return_assert(get_payment_return(repeat('a',64))#>>'{shipment,status}'='livre' AND get_payment_return(repeat('a',64))#>>'{shipment,departureDate}'='2026-09-29' AND (get_payment_return(repeat('a',64))#>>'{shipment,departedAt}')::timestamptz='2026-09-29T12:00:00Z' AND (get_payment_return(repeat('a',64))#>>'{shipment,deliveredAt}')::timestamptz='2026-09-30T08:00:00Z','confirmed historical departure and delivery keep their actual dates');
SELECT set_config('test.return_quote_version',(SELECT quote_version::text FROM colis WHERE id='ed400000-0000-4000-8000-000000000001'),true);
SET LOCAL session_replication_role='replica';
UPDATE colis SET quote_version=2 WHERE id='ed400000-0000-4000-8000-000000000001';
SET LOCAL session_replication_role='origin';
SELECT return_assert(get_payment_return(repeat('a',64))->>'status'='superseded' AND get_payment_return(repeat('a',64))#>>'{shipment,deliveredAt}' IS NULL,'even an old paid intent cannot attest the replacement quote or its shipment');
ROLLBACK;
