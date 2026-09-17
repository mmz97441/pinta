BEGIN;
CREATE FUNCTION tracking_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
INSERT INTO auth.users(id,email) VALUES
 ('dd100000-0000-4000-8000-000000000001','tracking-one@example.test'),
 ('dd100000-0000-4000-8000-000000000002','tracking-two@example.test');
INSERT INTO clients(id,user_id,nom,cp,type) VALUES
 ('dd200000-0000-4000-8000-000000000001','dd100000-0000-4000-8000-000000000001','Tracking One','97400','particulier'),
 ('dd200000-0000-4000-8000-000000000002','dd100000-0000-4000-8000-000000000002','Tracking Two','97400','particulier');
INSERT INTO envois(id,ref,date_depart,statut,destination_code,tracking_principal) VALUES
 ('dd400000-0000-4000-8000-000000000001','TEST-TRACKING','2026-09-17','planifie','974','OUTBOUND-ONLY');
INSERT INTO colis(id,client_id,statut,envoi_id,trackings) VALUES
 ('dd300000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000001','expedie','dd400000-0000-4000-8000-000000000001',ARRAY['SUPPLIER-INBOUND']),
 ('dd300000-0000-4000-8000-000000000002','dd200000-0000-4000-8000-000000000002','expedie','dd400000-0000-4000-8000-000000000001',ARRAY['PRIVATE-SUPPLIER']),
 ('dd300000-0000-4000-8000-000000000003','dd200000-0000-4000-8000-000000000001','mesure','dd400000-0000-4000-8000-000000000001',ARRAY['NOT-DEPARTED']);
SELECT tracking_assert(NOT has_function_privilege('anon','public.client_outgoing_tracking(uuid[])','EXECUTE'),'anonymous cannot call customer tracking RPC');
GRANT SELECT ON envois TO authenticated; -- fixture: exercise row visibility independently of table grants
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','dd100000-0000-4000-8000-000000000001',true);
SELECT tracking_assert((SELECT count(*)=1 AND min(tracking_principal)='OUTBOUND-ONLY' FROM client_outgoing_tracking(ARRAY['dd300000-0000-4000-8000-000000000001','dd300000-0000-4000-8000-000000000002','dd300000-0000-4000-8000-000000000003']::uuid[])),'only own departed parcel receives outbound tracking');
SELECT tracking_assert((SELECT count(*)=0 FROM envois WHERE id='dd400000-0000-4000-8000-000000000001'),'departure manifest remains inaccessible to customer');
RESET ROLE;
UPDATE profiles SET actif=false WHERE id='dd100000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT tracking_assert((SELECT count(*)=0 FROM client_outgoing_tracking(ARRAY['dd300000-0000-4000-8000-000000000001']::uuid[])),'inactive profile cannot read outgoing tracking');
RESET ROLE;
ROLLBACK;
