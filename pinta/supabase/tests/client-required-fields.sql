-- Mandatory client information (2026-10-07).
-- Through the API (roles authenticated and anon, also inside the SECURITY DEFINER commands they call) a client is created
-- complete and a mandatory field never becomes blank or invalid; a legacy incomplete row is completed field by field; the
-- phone is the mobile (tel) or the landline (tel_fixe). The database owner, fixtures written after RESET ROLE and the
-- service role are never blocked. Every refusal asserts its SQLSTATE, the exact message and hint, and leaves the clients
-- unchanged.
BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
-- Security and shape of the guard (this database has no default privileges; checked before the test grants below).
DO $$
DECLARE fn regprocedure:='guard_client_required_fields()'::regprocedure; t record;
BEGIN
 IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE')
  OR (SELECT proacl IS NULL OR EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0) FROM pg_proc WHERE oid=fn)
  OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND prorettype='trigger'::regtype FROM pg_proc WHERE oid=fn) THEN
  RAISE EXCEPTION 'FAIL: the guard must be a private SECURITY DEFINER trigger function with a fixed search_path'; END IF;
 SELECT * INTO t FROM pg_trigger WHERE tgrelid='clients'::regclass AND tgname='z_guard_client_required_fields' AND NOT tgisinternal;
 IF NOT FOUND OR t.tgfoid<>fn OR t.tgenabled<>'O' OR t.tgtype<>23 OR cardinality(t.tgattr::int2[])<>0 THEN
  RAISE EXCEPTION 'FAIL: expected an enabled BEFORE INSERT OR UPDATE row trigger, whatever the columns written'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='clients'::regclass AND NOT tgisinternal AND tgtype&3=3 AND tgname>'z_guard_client_required_fields')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='clients'::regclass AND tgname='client_delivery_address_consistency' AND tgenabled='O') THEN
  RAISE EXCEPTION 'FAIL: the guard must fire after every other BEFORE row trigger, the address synchronisation included'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='clients'::regclass AND attname IN ('prenom','email','tel','tel_fixe','adresse','adresse_ligne1','ville') AND attnotnull)
  OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='clients'::regclass AND contype='c') THEN
  RAISE EXCEPTION 'FAIL: no NOT NULL nor CHECK constraint may be added'; END IF;
 RAISE NOTICE 'PASS: private SECURITY DEFINER guard, last BEFORE INSERT OR UPDATE row trigger of clients, no NOT NULL nor CHECK added';
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;
-- Supabase's default privileges also grant the tables to anon; RLS keeps it out.
GRANT INSERT ON clients TO anon;

CREATE FUNCTION rqf_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION rqf_accept(command text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE command; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION rqf_clients() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM clients c $$;
CREATE FUNCTION rqf_client(p_id uuid) RETURNS clients LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM clients WHERE id=p_id $$;
-- Refused with this SQLSTATE (and this message and hint when given); no client row changed.
CREATE FUNCTION rqf_reject(command text,label text,expected_message text,expected_hint text,expected_state text DEFAULT '23514') RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_rows jsonb:=rqf_clients(); state text; message text; hint text;
BEGIN
 BEGIN
  EXECUTE command;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT,hint=PG_EXCEPTION_HINT;
 END;
 IF state IS NULL THEN RAISE EXCEPTION 'FAIL accepted: %',label; END IF;
 IF state<>expected_state THEN RAISE EXCEPTION 'FAIL wrong code % for %: %',state,label,message; END IF;
 IF expected_message IS NOT NULL AND message IS DISTINCT FROM expected_message THEN RAISE EXCEPTION 'FAIL wrong message for %: %',label,message; END IF;
 IF expected_hint IS NOT NULL AND hint IS DISTINCT FROM expected_hint THEN RAISE EXCEPTION 'FAIL wrong hint for %: %',label,hint; END IF;
 IF rqf_clients() IS DISTINCT FROM before_rows THEN RAISE EXCEPTION 'FAIL % changed a client',label; END IF;
 RAISE NOTICE 'PASS rejected: % [%]',label,state;
END $$;
-- INSERT of a complete client with some columns replaced (JSON null: the column is NULL).
CREATE FUNCTION rqf_insert(overrides jsonb DEFAULT '{}') RETURNS text LANGUAGE sql AS $$
 SELECT format('INSERT INTO clients(%s) SELECT %s FROM jsonb_populate_record(NULL::clients,%L) r',
  string_agg(quote_ident(k),',' ORDER BY k),string_agg('r.'||quote_ident(k),',' ORDER BY k),payload)
 FROM (SELECT jsonb_build_object('id',gen_random_uuid(),'nom','Payet','prenom','Flavie','email','flavie.payet@example.test','tel','0692 12 34 56',
  'adresse','12 rue des Lilas','cp','97400','ville','Saint-Denis','type','particulier')||overrides AS payload) p,jsonb_object_keys(p.payload) k
 GROUP BY payload
$$;
-- The exact texts of the contract.
CREATE FUNCTION rqf_missing(labels text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Fiche client incomplète : il manque '||labels||'.' $$;
CREATE FUNCTION rqf_email() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Email invalide : il doit être de la forme nom@domaine.fr.'::text $$;
CREATE FUNCTION rqf_phone() RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT 'Téléphone invalide : renseignez un mobile ou un fixe d’au moins 9 chiffres (espaces, points, tirets, parenthèses et + initial acceptés).'::text $$;
CREATE FUNCTION rqf_cp_format() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Code postal invalide : il doit comporter 5 chiffres.'::text $$;
CREATE FUNCTION rqf_cp_destination() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Code postal invalide : il doit correspondre à une destination desservie.'::text $$;
-- Request identities: owner (no role, no claims), owner_with_claims (role reset, claims of a request still set: the fixture
-- pattern of the existing suites), staff and portal clients (authenticated), anon, service (Edge functions).
CREATE FUNCTION rqf_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role',CASE who WHEN 'owner' THEN '' WHEN 'anon' THEN 'anon' WHEN 'service' THEN 'service_role' ELSE 'authenticated' END,true);
 PERFORM set_config('request.jwt.claim.sub',CASE who WHEN 'director' THEN '7c000000-0000-4000-8000-000000000001' WHEN 'owner_with_claims' THEN '7c000000-0000-4000-8000-000000000001'
  WHEN 'preparateur' THEN '7c000000-0000-4000-8000-000000000002' WHEN 'client' THEN '7c000000-0000-4000-8000-000000000003'
  WHEN 'legacy_client' THEN '7c000000-0000-4000-8000-000000000004' ELSE '' END,true);
 IF who IN ('director','preparateur','client','legacy_client') THEN EXECUTE 'SET LOCAL ROLE authenticated';
 ELSIF who='anon' THEN EXECUTE 'SET LOCAL ROLE anon';
 ELSIF who='service' THEN EXECUTE 'SET LOCAL ROLE service_role';
 END IF;
END $$;

-- ── Fixtures (database owner: never checked) ──
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('7c000000-0000-4000-8000-000000000001','rqf-direction@example.test','{"nom":"Direction"}'),
 ('7c000000-0000-4000-8000-000000000002','rqf-preparation@example.test','{"nom":"Préparation"}'),
 ('7c000000-0000-4000-8000-000000000003','flavie.payet@example.test','{"nom":"Flavie Payet"}'),
 ('7c000000-0000-4000-8000-000000000004','ancien.portail@example.test','{"nom":"Client ancien"}');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('7c100000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000001','Direction','rqf-direction@example.test','directeur',false),
 ('7c100000-0000-4000-8000-000000000002','7c000000-0000-4000-8000-000000000002','Préparation','rqf-preparation@example.test','preparateur',false);
INSERT INTO staff_permissions(staff_id,perm_clients_creer,perm_clients_modifier) VALUES('7c100000-0000-4000-8000-000000000002',true,true);
-- 01 complete, with a portal account.
INSERT INTO clients(id,user_id,nom,prenom,email,tel,adresse,cp,ville,type) VALUES
 ('7c200000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000003','Payet','Flavie','flavie.payet@example.test','0692 12 34 56','12 rue des Lilas','97400','Saint-Denis','particulier');
-- Legacy rows created before the rule: 02 incomplete, 03 invalid, 04 landline only, 05 incomplete with a portal account.
INSERT INTO clients(id,nom,cp) VALUES('7c200000-0000-4000-8000-000000000002','Ancien','97400');
INSERT INTO clients(id,nom,prenom,email,tel,adresse,cp,ville) VALUES('7c200000-0000-4000-8000-000000000003','Hoarau','Léa','lea-sans-arobase','0692','Chemin des Roses','75011','Paris');
INSERT INTO clients(id,nom,prenom,email,tel_fixe,adresse,cp,ville,type) VALUES
 ('7c200000-0000-4000-8000-000000000004','Grondin','Marc','marc.grondin@example.test','0262 41 00 00','5 chemin Bœuf Mort','97410','Saint-Pierre','pro');
INSERT INTO clients(id,user_id,nom,cp) VALUES('7c200000-0000-4000-8000-000000000005','7c000000-0000-4000-8000-000000000004','Ancien portail','97600');

-- ── C. Creation through the API ──
SELECT rqf_as('director');
-- C1 the front's creation payload (insertClient): every mandatory field, optional fields NULL.
INSERT INTO clients(id,ref,nom,prenom,genre,date_naissance,ville,adresse,adresse_ligne1,adresse_ligne2,commune,infos_livraison,cp,tel,tel_fixe,email,canal,type,
 mode_paiement,points,onboarded,notes,telegram_username,abonnement_debut,abonnement_fin,raison_sociale,siret,interlocuteur)
VALUES('7c200000-0000-4000-8000-000000000010','CLI-RQF10','Payet','Jean',NULL,NULL,'Le Port','8 rue du Port','8 rue du Port',NULL,'Le Port',NULL,'97420',
 '+262 (0)692-12.34.56',NULL,'jean.payet@example.test','telegram','particulier','colis',0,false,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
SELECT rqf_assert((SELECT nom='Payet' AND prenom='Jean' AND adresse='8 rue du Port' AND cp='97420' FROM rqf_client('7c200000-0000-4000-8000-000000000010')),
 'C1 a complete client is created through the API with the front payload');
-- C2 each mandatory field missing (NULL, '' or spaces) is refused, named alone in the message and the hint.
SELECT rqf_reject(rqf_insert(o::jsonb),'C2 creation without '||h,rqf_missing(l),'client_required_fields:'||h)
 FROM (VALUES ('{"prenom":null}','le prénom','prenom'),('{"nom":""}','le nom','nom'),('{"email":"   "}','l’email','email'),
  ('{"tel":null,"tel_fixe":" "}','le téléphone','tel'),('{"adresse":null,"adresse_ligne1":""}','l’adresse','adresse'),
  ('{"cp":""}','le code postal','cp'),('{"ville":"  "}','la ville','ville')) x(o,l,h);
-- C3 the decision's example, and nothing filled at all.
SELECT rqf_reject(rqf_insert('{"tel":null,"adresse":null}'),'C3 creation without phone nor address',
 'Fiche client incomplète : il manque le téléphone et l’adresse.','client_required_fields:tel,adresse');
SELECT rqf_reject($q$INSERT INTO clients(nom,cp) VALUES('','')$q$,'C3 creation with nothing filled',
 'Fiche client incomplète : il manque le prénom, le nom, l’email, le téléphone, l’adresse, le code postal et la ville.','client_required_fields:prenom,nom,email,tel,adresse,cp,ville');
-- C4 email shape.
SELECT rqf_reject(rqf_insert(jsonb_build_object('email',e)),'C4 email «'||e||'»','Email invalide : il doit être de la forme nom@domaine.fr.','client_required_fields:email')
 FROM unnest(ARRAY['flavie.payet','flavie@gmail','fla vie@gmail.com','flavie@@gmail.com','@gmail.com','flavie@gmail.']) e;
SELECT rqf_accept(rqf_insert(jsonb_build_object('email',e)),'C4 email «'||e||'» accepted')
 FROM unnest(ARRAY['flavie.payet@example.test','f.payet+colis@mail.example.re',' flavie@example.test ']) e;
-- C5 phone: digits, spaces, dots, dashes, parentheses and a leading +, at least 9 digits.
SELECT rqf_reject(rqf_insert(jsonb_build_object('tel',t)),'C5 phone «'||t||'»',
 'Téléphone invalide : renseignez un mobile ou un fixe d’au moins 9 chiffres (espaces, points, tirets, parenthèses et + initial acceptés).','client_required_fields:tel')
 FROM unnest(ARRAY['0692 12 34','0692 12 34 5x','0692123456 ou 0262','06+92123456','..........','++262692123456']) t;
SELECT rqf_accept(rqf_insert(jsonb_build_object('tel',t)),'C5 phone «'||t||'» accepted')
 FROM unnest(ARRAY['0692123456','+262 (0)692-12.34.56','0692.12.34.56','(0262) 41-00-00','+33 6 12 34 56 78','692123456']) t;
-- C6 one phone is enough, the mobile or the landline; a malformed second phone does not block.
SELECT rqf_accept(rqf_insert('{"tel":null,"tel_fixe":"0262 41 00 00"}'),'C6 a landline alone satisfies the phone');
SELECT rqf_accept(rqf_insert('{"tel":"12","tel_fixe":"0262410000"}'),'C6 a valid landline next to a malformed mobile');
SELECT rqf_accept(rqf_insert('{"tel_fixe":"bureau"}'),'C6 a valid mobile next to a malformed landline');
SELECT rqf_reject(rqf_insert('{"tel":"","tel_fixe":"12"}'),'C6 a malformed landline alone',rqf_phone(),'client_required_fields:tel');
-- C7 postcode: 5 digits (no space: the destination is read as left(cp,3)) of a served destination.
SELECT rqf_reject(rqf_insert(jsonb_build_object('cp',p)),'C7 postcode «'||p||'»','Code postal invalide : il doit comporter 5 chiffres.','client_required_fields:cp')
 FROM unnest(ARRAY['9740','974000',' 97400','97400 ','97 400','ABCDE']) p;
SELECT rqf_reject(rqf_insert('{"cp":"75011"}'),'C7 a metropolitan postcode','Code postal invalide : il doit correspondre à une destination desservie.','client_required_fields:cp');
SELECT rqf_reject(rqf_insert('{"cp":"97300"}'),'C7 a postcode without destination',rqf_cp_destination(),'client_required_fields:cp');
SELECT rqf_accept(rqf_insert(jsonb_build_object('cp',p)),'C7 served postcode '||p) FROM unnest(ARRAY['97100','97200','97400','97600']) p;
-- C8 several problems in one message: what is missing first, then what is invalid, in the order of the form.
SELECT rqf_reject(rqf_insert('{"tel":null,"email":"flavie@gmail","cp":"75011","prenom":" "}'),'C8 several problems at once',
 'Fiche client incomplète : il manque le prénom et le téléphone. Email invalide : il doit être de la forme nom@domaine.fr. Code postal invalide : il doit correspondre à une destination desservie.',
 'client_required_fields:prenom,email,tel,cp');
-- C9 the address may come from adresse_ligne1 alone: the synchronisation trigger runs first.
SELECT rqf_accept(rqf_insert('{"id":"7c200000-0000-4000-8000-000000000011","adresse":null,"adresse_ligne1":"3 impasse des Goyaviers"}'),'C9 creation with adresse_ligne1 only');
SELECT rqf_assert((SELECT adresse='3 impasse des Goyaviers' FROM rqf_client('7c200000-0000-4000-8000-000000000011')),'C9 the address checked is the synchronised one');
-- C10 every staff member is held to the rule, not only the direction.
SELECT rqf_as('preparateur');
SELECT rqf_reject(rqf_insert('{"tel":null}'),'C10 a preparer cannot create an incomplete client',rqf_missing('le téléphone'),'client_required_fields:tel');
SELECT rqf_accept(rqf_insert(),'C10 a preparer creates a complete client');

-- ── U. Update through the API (staff) ──
SELECT rqf_as('director');
-- U1 a filled mandatory field cannot be blanked (NULL, '' or spaces), adresse_ligne1 included.
SELECT rqf_reject(format('UPDATE clients SET %I=%L WHERE id=%L',c,v,'7c200000-0000-4000-8000-000000000001'),'U1 blanking '||c,rqf_missing(l),'client_required_fields:'||h)
 FROM (VALUES ('prenom','','le prénom','prenom'),('nom','  ','le nom','nom'),('email',NULL,'l’email','email'),('tel','','le téléphone','tel'),
  ('adresse',NULL,'l’adresse','adresse'),('adresse_ligne1','','l’adresse','adresse'),('cp','','le code postal','cp'),('ville',' ','la ville','ville')) x(c,v,l,h);
-- U2 a changed mandatory field must be valid.
SELECT rqf_reject(format('UPDATE clients SET %I=%L WHERE id=%L',c,v,'7c200000-0000-4000-8000-000000000001'),'U2 '||c||' «'||v||'»',m,'client_required_fields:'||h)
 FROM (VALUES ('email','pas-un-email',rqf_email(),'email'),('tel','12 34',rqf_phone(),'tel'),('cp','75011',rqf_cp_destination(),'cp'),
  ('cp',' 97400',rqf_cp_format(),'cp')) x(c,v,m,h);
-- U3 valid changes, then the staff form saving every field as it is.
UPDATE clients SET tel='+262 692 00 11 22',email='flavie.p@example.test',cp='97600',ville='Mamoudzou',adresse_ligne1='3 rue Neuve' WHERE id='7c200000-0000-4000-8000-000000000001';
SELECT rqf_assert((SELECT tel='+262 692 00 11 22' AND cp='97600' AND adresse='3 rue Neuve' FROM rqf_client('7c200000-0000-4000-8000-000000000001')),'U3 valid changes are saved, adresse follows adresse_ligne1');
UPDATE clients SET nom='Payet',prenom='Flavie',tel='+262 692 00 11 22',email='flavie.p@example.test',ville='Mamoudzou',cp='97600',adresse_ligne1='3 rue Neuve',adresse_ligne2='',
 commune='Mamoudzou',infos_livraison='',telegram_username='',canal='telegram',type='particulier',adresse='3 rue Neuve' WHERE id='7c200000-0000-4000-8000-000000000001';
SELECT rqf_assert(true,'U3 the staff form saving a complete client unchanged is accepted');
-- U4 a write that leaves the mandatory fields alone is not checked, even on a row with invalid values.
UPDATE clients SET notes='Client fidèle',points=points+5 WHERE id='7c200000-0000-4000-8000-000000000003';
SELECT rqf_assert((SELECT notes='Client fidèle' AND points=5 FROM rqf_client('7c200000-0000-4000-8000-000000000003')),'U4 other fields of a legacy invalid row are editable');
-- U5 phone at row level: once the row has a valid phone, one valid phone must remain.
SELECT rqf_reject($q$UPDATE clients SET tel_fixe=NULL WHERE id='7c200000-0000-4000-8000-000000000004'$q$,'U5 the only phone (landline) cannot be removed',rqf_missing('le téléphone'),'client_required_fields:tel');
SELECT rqf_reject($q$UPDATE clients SET tel_fixe='0262' WHERE id='7c200000-0000-4000-8000-000000000004'$q$,'U5 the only phone cannot become malformed',rqf_phone(),'client_required_fields:tel');
UPDATE clients SET tel='0692 00 00 01' WHERE id='7c200000-0000-4000-8000-000000000004';
UPDATE clients SET tel_fixe=NULL WHERE id='7c200000-0000-4000-8000-000000000004';
SELECT rqf_assert((SELECT tel='0692 00 00 01' AND tel_fixe IS NULL FROM rqf_client('7c200000-0000-4000-8000-000000000004')),'U5 one of two phones can be removed while the other stays valid');
UPDATE clients SET tel='',tel_fixe='0262 41 00 00' WHERE id='7c200000-0000-4000-8000-000000000004';
SELECT rqf_assert((SELECT tel='' AND tel_fixe='0262 41 00 00' FROM rqf_client('7c200000-0000-4000-8000-000000000004')),'U5 the mobile is replaced by a landline in one save');
UPDATE clients SET tel='bureau' WHERE id='7c200000-0000-4000-8000-000000000004';
SELECT rqf_assert((SELECT tel='bureau' FROM rqf_client('7c200000-0000-4000-8000-000000000004')),'U5 a malformed second phone does not block while a valid phone remains');
-- U6 legacy incomplete row: editable without completing everything; a completed field must be valid and stays filled.
UPDATE clients SET notes='Ancien client' WHERE id='7c200000-0000-4000-8000-000000000002';
-- The staff form sends '' for every empty field: still blank, so not a change.
UPDATE clients SET nom='Ancien',prenom='',tel='',email='',ville='',cp='97400',adresse_ligne1='',adresse_ligne2='',commune='',infos_livraison='',telegram_username='',
 canal='telegram',type='particulier',adresse='' WHERE id='7c200000-0000-4000-8000-000000000002';
SELECT rqf_assert((SELECT prenom='' AND email='' AND tel='' AND adresse='' FROM rqf_client('7c200000-0000-4000-8000-000000000002')),'U6 the staff form saves a legacy incomplete client as it is');
UPDATE clients SET email='ancien@example.test' WHERE id='7c200000-0000-4000-8000-000000000002';
UPDATE clients SET prenom='Paul',ville='Saint-Paul' WHERE id='7c200000-0000-4000-8000-000000000002';
SELECT rqf_assert((SELECT email='ancien@example.test' AND prenom='Paul' AND tel='' AND adresse='' FROM rqf_client('7c200000-0000-4000-8000-000000000002')),'U6 a legacy client is completed field by field');
SELECT rqf_reject($q$UPDATE clients SET email='ancien' WHERE id='7c200000-0000-4000-8000-000000000002'$q$,'U6 a field being completed must be valid',rqf_email(),'client_required_fields:email');
SELECT rqf_reject($q$UPDATE clients SET tel='0692' WHERE id='7c200000-0000-4000-8000-000000000002'$q$,'U6 a phone being entered must be valid',rqf_phone(),'client_required_fields:tel');
SELECT rqf_reject($q$UPDATE clients SET cp='75011' WHERE id='7c200000-0000-4000-8000-000000000002'$q$,'U6 the postcode stays in a served destination',rqf_cp_destination(),'client_required_fields:cp');
SELECT rqf_reject($q$UPDATE clients SET email='' WHERE id='7c200000-0000-4000-8000-000000000002'$q$,'U6 a field completed earlier cannot be blanked again',rqf_missing('l’email'),'client_required_fields:email');
UPDATE clients SET tel='0692 33 44 55' WHERE id='7c200000-0000-4000-8000-000000000002';
SELECT rqf_reject($q$UPDATE clients SET tel=NULL WHERE id='7c200000-0000-4000-8000-000000000002'$q$,'U6 a phone completed earlier cannot be removed',rqf_missing('le téléphone'),'client_required_fields:tel');
-- U7 legacy invalid values left as they are do not block; a value changed must become valid.
UPDATE clients SET ville='Saint-Paul' WHERE id='7c200000-0000-4000-8000-000000000003';
SELECT rqf_reject($q$UPDATE clients SET email='lea@' WHERE id='7c200000-0000-4000-8000-000000000003'$q$,'U7 an invalid email is only replaced by a valid one',rqf_email(),'client_required_fields:email');
SELECT rqf_reject($q$UPDATE clients SET email=NULL WHERE id='7c200000-0000-4000-8000-000000000003'$q$,'U7 a filled email, even invalid, cannot be blanked',rqf_missing('l’email'),'client_required_fields:email');
UPDATE clients SET tel=NULL WHERE id='7c200000-0000-4000-8000-000000000003';
SELECT rqf_assert((SELECT tel IS NULL FROM rqf_client('7c200000-0000-4000-8000-000000000003')),'U7 without any valid phone before, a malformed phone can be removed');
UPDATE clients SET cp='97400',email='lea.hoarau@example.test' WHERE id='7c200000-0000-4000-8000-000000000003';
SELECT rqf_assert((SELECT cp='97400' AND email='lea.hoarau@example.test' FROM rqf_client('7c200000-0000-4000-8000-000000000003')),'U7 invalid values are corrected');

-- ── P. Portal: the client's own profile through update_client_profile (SECURITY DEFINER) ──
SELECT rqf_as('client');
SELECT rqf_assert(current_user='authenticated' AND (SELECT count(*) FROM clients)=0,'P0 the client reads no raw client row: the profile goes through the command');
SELECT rqf_reject($q$SELECT update_client_profile('{"tel":""}')$q$,'P1 the client cannot remove their phone',rqf_missing('le téléphone'),'client_required_fields:tel');
SELECT rqf_reject($q$SELECT update_client_profile('{"email":null}')$q$,'P1 the client cannot remove their email',rqf_missing('l’email'),'client_required_fields:email');
SELECT rqf_reject($q$SELECT update_client_profile('{"adresse_ligne1":""}')$q$,'P1 the client cannot remove their address',rqf_missing('l’adresse'),'client_required_fields:adresse');
SELECT rqf_reject($q$SELECT update_client_profile('{"cp":"75011"}')$q$,'P1 the client cannot leave the served destinations',rqf_cp_destination(),'client_required_fields:cp');
SELECT rqf_reject($q$SELECT update_client_profile('{"email":"flavie"}')$q$,'P1 the client cannot save a malformed email',rqf_email(),'client_required_fields:email');
SELECT rqf_assert(update_client_profile('{"tel":"0693 11 22 33","tel_fixe":"0262 00 00 00"}')->>'tel'='0693 11 22 33','P2 the client updates their phones');
-- The eight fields of the portal form (ClientProfil).
SELECT rqf_assert(update_client_profile('{"nom":"Payet","prenom":"Flavie","email":"flavie.p@example.test","tel":"0693 11 22 33","cp":"97600","ville":"Mamoudzou","adresse_ligne1":"3 rue Neuve","adresse_ligne2":"Appartement 4"}')->>'adresse'='3 rue Neuve',
 'P2 the portal form saves a complete profile');
SELECT rqf_assert(update_client_profile('{"tel":""}')->>'tel_fixe'='0262 00 00 00','P2 the client can drop the mobile while a valid landline remains');
SELECT rqf_as('legacy_client');
SELECT rqf_assert((update_client_profile('{"onboarded":true}')->>'onboarded')::boolean,'P3 a legacy incomplete client still completes the onboarding');
SELECT rqf_assert(update_client_profile('{"nom":"Ancien portail","prenom":"","email":"","tel":"0639 00 11 22","cp":"97600","ville":"","adresse_ligne1":"","adresse_ligne2":""}')->>'tel'='0639 00 11 22',
 'P3 the portal form completes a legacy profile partially, blank fields staying blank');
SELECT rqf_reject($q$SELECT update_client_profile('{"tel":"0639"}')$q$,'P3 the phone just completed cannot become malformed',rqf_phone(),'client_required_fields:tel');

-- ── S. Never blocked: the database owner, fixtures written after RESET ROLE, the service role, commands on other fields ──
SELECT rqf_as('owner');
INSERT INTO clients(id,nom,cp) VALUES('7c200000-0000-4000-8000-000000000020','Fixture propriétaire','97400');
UPDATE clients SET tel=NULL,email=NULL WHERE id='7c200000-0000-4000-8000-000000000010';
SELECT rqf_assert((SELECT tel IS NULL AND email IS NULL FROM rqf_client('7c200000-0000-4000-8000-000000000010')),'S1 the database owner (migrations, maintenance) creates and empties clients');
SELECT rqf_as('owner_with_claims');
SELECT rqf_assert(auth.role()='authenticated' AND current_setting('role')='none','S2 the claims of a request are still set after RESET ROLE');
INSERT INTO clients(id,nom,cp) VALUES('7c200000-0000-4000-8000-000000000021','Fixture après RESET ROLE','97400');
SELECT rqf_assert(EXISTS(SELECT 1 FROM clients WHERE id='7c200000-0000-4000-8000-000000000021'),'S2 a fixture written by the owner with request claims still set is not checked');
SELECT rqf_as('service');
INSERT INTO clients(id,nom,cp) VALUES('7c200000-0000-4000-8000-000000000022','Service','97400');
UPDATE clients SET prenom=NULL WHERE id='7c200000-0000-4000-8000-000000000010';
SELECT rqf_assert((SELECT prenom IS NULL FROM rqf_client('7c200000-0000-4000-8000-000000000010')) AND EXISTS(SELECT 1 FROM clients WHERE id='7c200000-0000-4000-8000-000000000022'),
 'S3 the service role (Edge functions) is not checked');
-- S4 API commands writing other fields of clients keep working on incomplete rows.
SELECT rqf_as('director');
SELECT rqf_assert(save_client_subscription('7c200000-0000-4000-8000-000000000020','{"abonnement":"premium","abonnementDebut":"2026-10-07","abonnementFin":"2027-10-06"}',
 '{"abonnement":"freemium","abonnementDebut":null,"abonnementFin":null}')->>'abonnement'='premium','S4 a subscription is saved on an incomplete client (SECURITY DEFINER command)');
UPDATE clients SET points=points+10 WHERE id='7c200000-0000-4000-8000-000000000020';
SELECT set_config('rqf.token',create_telegram_invitation('7c200000-0000-4000-8000-000000000020')->>'token',true);
SELECT rqf_as('service');
SELECT consume_telegram_invitation(current_setting('rqf.token'),'rqf-chat');
SELECT rqf_assert((SELECT points=10 AND abonnement::text='premium' AND telegram_chat_id='rqf-chat' FROM rqf_client('7c200000-0000-4000-8000-000000000020')),
 'S4 points, subscription and Telegram link are written on an incomplete client');

-- ── A. Anonymous requests ──
SELECT rqf_as('anon');
SELECT rqf_reject($q$INSERT INTO clients(nom,cp) VALUES('Anonyme','97400')$q$,'A1 an anonymous incomplete creation is refused by the guard',
 'Fiche client incomplète : il manque le prénom, l’email, le téléphone, l’adresse et la ville.','client_required_fields:prenom,email,tel,adresse,ville');
SELECT rqf_reject(rqf_insert(),'A1 an anonymous complete creation is still refused by RLS',NULL,NULL,'42501');

-- ── G. The trigger function is not an API entry point ──
SELECT rqf_as('director');
SELECT rqf_reject('SELECT guard_client_required_fields()','G1 the trigger function cannot be called through the API',NULL,NULL,'42501');
SELECT rqf_as('owner');
ROLLBACK;
