BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON factures,colis,staff_permissions TO authenticated;
GRANT UPDATE ON factures TO authenticated;

CREATE FUNCTION context_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END; $$;
CREATE FUNCTION context_forbidden(command text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  EXECUTE command;
 EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS rejected by permission: %',label;
  RETURN;
 END;
 RAISE EXCEPTION 'FAIL accepted: %',label;
END; $$;

CREATE TEMP TABLE invoice_context_actors(index integer,auth_id uuid,staff_id uuid,permission text);
INSERT INTO invoice_context_actors
SELECT n,('ed100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('ed110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 (ARRAY['perm_factures_voir','perm_factures_ajouter','perm_factures_valider',
 'perm_factures_refuser','perm_factures_ocr','perm_factures_modifier_articles',NULL,NULL])[n]
FROM generate_series(1,8) n;
INSERT INTO auth.users(id,email) SELECT auth_id,'invoice-context-'||index||'@example.test' FROM invoice_context_actors;
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password)
SELECT staff_id,auth_id,'Invoice context '||index,'invoice-context-'||index||'@example.test','preparateur',false
FROM invoice_context_actors WHERE index<=7;
INSERT INTO staff_permissions(staff_id) SELECT staff_id FROM invoice_context_actors WHERE index<=7;
DO $$ DECLARE actor record; BEGIN
 FOR actor IN SELECT * FROM invoice_context_actors WHERE permission IS NOT NULL LOOP
  EXECUTE format('UPDATE staff_permissions SET %I=true WHERE staff_id=$1',actor.permission) USING actor.staff_id;
 END LOOP;
END; $$;
INSERT INTO clients(id,user_id,nom,cp,type) VALUES
 ('ed200000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000008','Context client','97400','particulier');
INSERT INTO colis(id,client_id,statut,nb_colis,feu_vert) VALUES
 ('ed300000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','en_preparation',1,'autorise');
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url) VALUES
 ('ed500000-0000-4000-8000-000000000001','ed300000-0000-4000-8000-000000000001','Context invoice',0,'ed300000-0000-4000-8000-000000000001/invoice.pdf');
GRANT SELECT ON invoice_context_actors TO authenticated;

SELECT context_assert(
 (SELECT pg_get_userbyid(proowner)='supabase_admin' AND prosecdef AND provolatile='s'
  FROM pg_proc WHERE oid='get_invoice_review_context(uuid)'::regprocedure),
 'read-context replacement preserves owner, security definer and stable contract');
SELECT context_assert(has_function_privilege('authenticated','get_invoice_review_context(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','get_invoice_review_context(uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','get_invoice_review_context(uuid)','EXECUTE')
 AND NOT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a
  WHERE p.oid='get_invoice_review_context(uuid)'::regprocedure AND a.grantee=0),
 'read-context replacement preserves authenticated-only EXECUTE grants');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$ DECLARE actor record; context jsonb; granted integer; BEGIN
 FOR actor IN SELECT * FROM invoice_context_actors WHERE permission IS NOT NULL ORDER BY index LOOP
  PERFORM set_config('request.jwt.claim.sub',actor.auth_id::text,true);
  SELECT count(*) INTO granted FROM unnest(ARRAY['perm_factures_voir','perm_factures_ajouter',
   'perm_factures_valider','perm_factures_refuser','perm_factures_ocr','perm_factures_modifier_articles']) p
   WHERE has_permission(p);
  PERFORM context_assert(granted=1 AND has_permission(actor.permission),'isolated real staff permission: '||actor.permission);
  context:=get_invoice_review_context('ed300000-0000-4000-8000-000000000001');
  PERFORM context_assert(jsonb_array_length(context->'invoices')=1
   AND context->'invoices'->0->>'factureId'='ed500000-0000-4000-8000-000000000001'
   AND nullif(context->'invoices'->0->>'reviewToken','') IS NOT NULL,
   'read invoice context with only '||actor.permission);
  PERFORM context_forbidden(format(
   'SELECT save_invoice_review(%L,%L,%L,%L::jsonb,100,%L,NULL,true)',
   'ed500000-0000-4000-8000-000000000001',context->'invoices'->0->>'reviewToken',
   'ed300000-0000-4000-8000-000000000001/invoice.pdf','[]','Context invoice'),
   'context access does not grant atomic validation with only '||actor.permission);
  IF actor.permission='perm_factures_voir' THEN
   PERFORM context_forbidden(format(
    'SELECT save_invoice_review(%L,%L,%L,%L::jsonb,NULL,%L,NULL,false)',
    'ed500000-0000-4000-8000-000000000001',context->'invoices'->0->>'reviewToken',
    'ed300000-0000-4000-8000-000000000001/invoice.pdf','[]','Context invoice'),
    'read-only permission does not grant draft writes');
  END IF;
  IF actor.permission='perm_factures_refuser' THEN
   UPDATE factures SET rejet_motif='Document illisible' WHERE id='ed500000-0000-4000-8000-000000000001';
   PERFORM context_assert((SELECT rejet_motif='Document illisible' AND NOT valide FROM factures
    WHERE id='ed500000-0000-4000-8000-000000000001'),'refuse-only operator can read context then request correction');
  END IF;
 END LOOP;
END; $$;
SELECT set_config('request.jwt.claim.sub','ed100000-0000-4000-8000-000000000007',true);
SELECT context_assert(is_staff(),'no-permission scenario uses a real staff account');
SELECT context_forbidden($q$SELECT get_invoice_review_context('ed300000-0000-4000-8000-000000000001')$q$,
 'staff without invoice permission cannot read review context');
SELECT set_config('request.jwt.claim.sub','ed100000-0000-4000-8000-000000000008',true);
SELECT context_forbidden($q$SELECT get_invoice_review_context('ed300000-0000-4000-8000-000000000001')$q$,
 'customer cannot read staff review context even for their own dossier');
RESET ROLE;
SELECT context_assert(NOT EXISTS(SELECT 1 FROM invoice_review_drafts WHERE facture_id='ed500000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM lignes WHERE facture_id='ed500000-0000-4000-8000-000000000001')
 AND (SELECT NOT valide FROM factures WHERE id='ed500000-0000-4000-8000-000000000001'),
 'permission-denied writes leave no draft, article or validation');
ROLLBACK;
