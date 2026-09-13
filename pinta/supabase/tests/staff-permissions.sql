BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE FUNCTION public.staff_test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END;
$$;
CREATE FUNCTION public.staff_test_reject(command text,expected_code text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=expected_code THEN RAISE NOTICE 'PASS rejected: % [%]',label,SQLSTATE; RETURN; END IF;
  RAISE EXCEPTION 'FAIL wrong rejection for %: % %',label,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'FAIL accepted: %',label;
END; $$;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('f1000000-0000-4000-8000-000000000001','qa-permission-director@example.test','{}'),
 ('f1000000-0000-4000-8000-000000000002','qa-permission-vice@example.test','{}'),
 ('f1000000-0000-4000-8000-000000000003','qa-permission-prep@example.test','{}'),
 ('f1000000-0000-4000-8000-000000000004','qa-permission-logistic@example.test','{}'),
 ('f1000000-0000-4000-8000-000000000005','qa-permission-client@example.test','{"role":"directeur"}'),
 ('f1000000-0000-4000-8000-000000000006','qa-permission-missing@example.test','{}'),
 ('f1000000-0000-4000-8000-000000000007','qa-permission-empty@example.test','{}');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','QA direction','qa-permission-director@example.test','directeur',false),
 ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002','QA vice','qa-permission-vice@example.test','vice_directeur',false),
 ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000003','QA préparation','qa-permission-prep@example.test','preparateur',false),
 ('f2000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000004','QA logistique','qa-permission-logistic@example.test','logisticien',false),
 ('f2000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000006','QA sans droits','qa-permission-missing@example.test','preparateur',false),
 ('f2000000-0000-4000-8000-000000000007','f1000000-0000-4000-8000-000000000007','QA vide','qa-permission-empty@example.test','logisticien',false);
INSERT INTO staff_permissions(staff_id,perm_colis_mesurer,perm_comm_telegram,perm_admin_utilisateurs) VALUES
 ('f2000000-0000-4000-8000-000000000003',true,true,false),
 ('f2000000-0000-4000-8000-000000000004',true,true,true);

SELECT staff_test_assert(NOT has_function_privilege('anon','save_staff_permissions(uuid,jsonb,jsonb)','EXECUTE'),'Anonymous cannot call permission save');
SELECT staff_test_assert(NOT has_function_privilege('service_role','save_staff_permissions(uuid,jsonb,jsonb)','EXECUTE'),'RPC does not add service-role authority');
SELECT staff_test_assert((SELECT pg_get_userbyid(proowner)='supabase_admin' FROM pg_proc WHERE oid='save_staff_permissions(uuid,jsonb,jsonb)'::regprocedure),'RPC works with the actual Supabase migration owner');
SELECT staff_test_assert((SELECT count(*)=2 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename IN ('staff_users','staff_permissions')),'Both canonical staff tables publish realtime changes');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000005',true);
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_colis_mesurer":false}','{"perm_colis_mesurer":true}')$q$,'42501','Forged metadata cannot make a client an administrator');
SELECT staff_test_assert((SELECT count(*)=0 FROM staff_permissions),'Client RLS cannot read team permissions');
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_admin_parametres":true}','{"perm_admin_parametres":false}')$q$,'42501','Preparateur cannot grant themselves permissions');
WITH changed AS (UPDATE staff_permissions SET perm_admin_parametres=true WHERE staff_id='f2000000-0000-4000-8000-000000000003' RETURNING id)
 SELECT staff_test_assert((SELECT count(*)=0 FROM changed),'Direct RLS write remains denied to preparateur');
SELECT staff_test_reject($q$INSERT INTO staff_permissions(staff_id) VALUES('f2000000-0000-4000-8000-000000000006')$q$,'42501','Preparateur cannot bypass RPC by creating a permission row');
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000004',true);
SELECT staff_test_assert(has_permission('perm_admin_utilisateurs'),'Fixture has custom user-management permission');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{}','{}')$q$,'42501','Custom flag does not widen existing direction-only permission management');

SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000001','{}',NULL)$q$,'42501','Director target cannot be presented as restricted');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000002','{}',NULL)$q$,'42501','Vice-director target also keeps explicit full access');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000099','{}',NULL)$q$,'P0002','Unknown staff never produces a false success');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_invented":true}','{}')$q$,'22023','Unknown permission key rejected');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"staff_id":"f2000000-0000-4000-8000-000000000004"}','{}')$q$,'22023','Identifiers cannot be reassigned through a permission patch');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_colis_mesurer":"false"}','{"perm_colis_mesurer":true}')$q$,'22023','Boolean strings rejected');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_colis_mesurer":0}','{"perm_colis_mesurer":true}')$q$,'22023','Numeric flags rejected');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_colis_mesurer":null}','{"perm_colis_mesurer":true}')$q$,'22023','Null flags rejected');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','[]','{}')$q$,'22023','Non-object patch rejected');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{}','[]')$q$,'22023','Non-object baseline rejected');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_colis_mesurer":false}','{}')$q$,'22023','Missing baseline for edited key rejected');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{}',NULL)$q$,'40001','Null baseline cannot overwrite an existing row');

SELECT staff_test_assert((save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_colis_mesurer":false}','{"perm_colis_mesurer":true}')).perm_colis_mesurer=false,'Explicit false is saved and returned');
SELECT staff_test_assert((SELECT perm_comm_telegram FROM staff_permissions WHERE staff_id='f2000000-0000-4000-8000-000000000003'),'Saving one flag preserves unrelated true permissions');
SELECT set_config('qa.permissions.baseline',(SELECT to_jsonb(p)::text FROM staff_permissions p WHERE staff_id='f2000000-0000-4000-8000-000000000003'),true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
SELECT staff_test_assert((save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_comm_telegram":false}','{"perm_comm_telegram":true}')).perm_comm_telegram=false,'Vice-director can save an independent concurrent change');
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
SELECT staff_test_assert((save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_colis_mesurer":true}',current_setting('qa.permissions.baseline')::jsonb)).perm_comm_telegram=false,'Old full baseline merges disjoint edits without restoring another admin flag');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_comm_telegram":true}','{"perm_comm_telegram":true}')$q$,'40001','Same-key stale baseline cannot overwrite a colleague');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{"perm_colis_mesurer":false,"perm_comm_telegram":true}','{"perm_colis_mesurer":true,"perm_comm_telegram":true}')$q$,'40001','One conflict rejects the entire multi-key patch');
SELECT staff_test_assert((SELECT perm_colis_mesurer AND NOT perm_comm_telegram FROM staff_permissions WHERE staff_id='f2000000-0000-4000-8000-000000000003'),'Rejected multi-key patch leaves all flags unchanged');

SELECT staff_test_assert((save_staff_permissions('f2000000-0000-4000-8000-000000000006','{"perm_factures_ocr":true,"perm_comm_email":false}',NULL)).staff_id='f2000000-0000-4000-8000-000000000006','Missing row is created and canonical identity returned');
SELECT staff_test_assert((SELECT perm_factures_ocr AND NOT perm_comm_email AND NOT EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(p)) e WHERE left(e.key,5)='perm_' AND e.key<>'perm_factures_ocr' AND e.value IS DISTINCT FROM 'false'::jsonb) FROM staff_permissions p WHERE staff_id='f2000000-0000-4000-8000-000000000006'),'Missing-row repair grants only explicit true flags and keeps every other permission false');
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000006','{"perm_factures_ocr":false}',NULL)$q$,'40001','Concurrent second repair must refetch the newly created row');
SELECT staff_test_assert((save_staff_permissions('f2000000-0000-4000-8000-000000000007','{}',NULL)).id IS NOT NULL,'Empty patch can repair a row without granting permissions');
SELECT staff_test_assert((SELECT NOT EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(p)) e WHERE left(e.key,5)='perm_' AND e.value IS DISTINCT FROM 'false'::jsonb) FROM staff_permissions p WHERE staff_id='f2000000-0000-4000-8000-000000000007'),'Even logisticien repair does not infer broad role defaults');
SELECT staff_test_assert((fn_default_permissions('preparateur')->>'perm_colis_mesurer')::boolean,'Initial account creation retains its existing explicit role defaults');
SELECT staff_test_assert(EXISTS(SELECT 1 FROM audit_actions WHERE action='staff_permissions_saved' AND detail::jsonb->>'staff_id'='f2000000-0000-4000-8000-000000000003' AND detail::jsonb->'before'->'perm_colis_mesurer'='true'::jsonb AND detail::jsonb->'after'->'perm_colis_mesurer'='false'::jsonb),'Audit records exact before/after values and target staff');
SELECT staff_test_assert(EXISTS(SELECT 1 FROM audit_actions WHERE action='staff_permissions_saved' AND detail::jsonb->>'staff_id'='f2000000-0000-4000-8000-000000000006' AND detail::jsonb->>'created'='true'),'Repair is distinguished from an ordinary change in audit');

DELETE FROM staff_permissions WHERE staff_id='f2000000-0000-4000-8000-000000000007';
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000007','{}','{}')$q$,'40001','Disappeared row requires explicit reload rather than silent recreation');
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
SELECT staff_test_assert(has_permission('perm_colis_mesurer') AND NOT has_permission('perm_comm_telegram'),'Canonical permission checks observe saved values without a new login');
RESET ROLE;
-- Some historical schemas still allow NULL flags. The UI and has_permission
-- interpret these as false; the same baseline must be accepted by the command.
ALTER TABLE staff_permissions ALTER COLUMN perm_colis_mesurer DROP NOT NULL;
UPDATE staff_permissions SET perm_colis_mesurer=NULL WHERE staff_id='f2000000-0000-4000-8000-000000000006';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
SELECT staff_test_assert((save_staff_permissions('f2000000-0000-4000-8000-000000000006','{"perm_colis_mesurer":true}','{"perm_colis_mesurer":false}')).perm_colis_mesurer,'Historical NULL flag accepts its effective false baseline');
RESET ROLE;
UPDATE staff_users SET actif=false WHERE id='f2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
SELECT staff_test_reject($q$SELECT save_staff_permissions('f2000000-0000-4000-8000-000000000003','{}','{}')$q$,'42501','Inactive director cannot save permissions');
RESET ROLE;
ROLLBACK;
