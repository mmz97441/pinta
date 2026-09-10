DO $$
BEGIN
 IF (SELECT role FROM profiles WHERE id='90000000-0000-4000-8000-000000000001')<>'logisticien' THEN RAISE EXCEPTION 'Historical TEXT role did not synchronize'; END IF;
 IF NOT (SELECT perm_colis_mesurer FROM staff_permissions WHERE id='90000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'Existing permission changed'; END IF;
 IF (SELECT count(*) FROM audit_actions WHERE action='Synthetic historical entry')<>1 THEN RAISE EXCEPTION 'Historical audit lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_actions' AND column_name='user_id') THEN RAISE EXCEPTION 'Audit actor missing'; END IF;
 IF (SELECT count(*) FROM message_templates_legacy WHERE id='90000000-0000-4000-8000-000000000004' AND corps='Synthetic historical body')<>1 THEN RAISE EXCEPTION 'Historical template lost'; END IF;
 IF (SELECT count(*) FROM message_templates_versions WHERE template_id='90000000-0000-4000-8000-000000000004')<>1 THEN RAISE EXCEPTION 'Historical template versions lost'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE policyname IN ('audit_staff_crud','locks_staff_all','anon_read_templates','anon_read_templates_v')) THEN RAISE EXCEPTION 'Legacy permissive policy survived'; END IF;
 IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='colis' AND column_name='tags_preparation')<>'ARRAY' THEN RAISE EXCEPTION 'Historical preparation tag type rewritten'; END IF;
 IF (SELECT udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='clients' AND column_name='abonnement')<>'type_abonnement' THEN RAISE EXCEPTION 'Historical subscription enum rewritten'; END IF;
 RAISE NOTICE 'PASS: nine historical schema preservation assertions';
END;
$$;
-- This new upsert previously failed against the historical cle/corps contract.
BEGIN;
INSERT INTO message_templates(key,canal,body) VALUES('test_contract','portal','Synthetic reviewed text') ON CONFLICT(key,canal) DO UPDATE SET body=EXCLUDED.body;
ROLLBACK;
