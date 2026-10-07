"""Release of the mandatory client information guard (2026-10-07) without rewriting any client.

Operations, each run separately by the lead and only with the user's explicit go-ahead:
  preflight  read-only: refuses when already registered, when an object of the release exists, when the address
             synchronisation the guard fires after (sync_client_delivery_address and its trigger) differs from the
             reviewed repository baseline (md5 of pg_get_functiondef, local replay up to 20261006000001 on PostgreSQL 17),
             when a BEFORE row trigger of clients would fire after the guard, or when a column, auth.role(), the portal
             command or a served destination is missing. REPORTS, without changing them, how many existing clients are
             incomplete per field (missing: prénom, nom, email, telephone (neither tel nor tel_fixe filled), adresse, cp,
             ville; invalid: email, telephone (filled but neither valid), postcode format, postcode destination), by type,
             with a portal account, the clients whose only valid phone is the landline and the addresses still only in
             the legacy column (the portal form shows adresse_ligne1). The per-client list (id, ref, type, flags; no
             personal data) only goes to the private backup. Plain SELECTs with every predicate written in the query: the
             read-only role of the Management API cannot EXECUTE application functions. Saves everything privately
             (folder 0700, files 0600).
  rehearse   write transaction rolled back: migration, post checks (an incomplete creation under the API role is refused
             with the reviewed message and hint; one under the service role goes through; both inside rolled-back blocks),
             then the invariants (business data unchanged, clients columns, constraints, policies, other triggers and the
             relied functions unchanged).
  apply      same transaction, registered in schema_migrations, schema reload requested, committed.
  verify     read-only checks, run in BEGIN … ROLLBACK because the read-only mode rejects DO blocks, and a fresh report.
The migration SHA-256 is recorded at every step. Credentials stay in memory (management.py); nothing runs at import and
no secret is printed. No Edge function changes in this lot. The existing incomplete clients stay as they are: the team
completes them field by field (an update that leaves the other fields incomplete is never refused).
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import TABLES

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261007000003_client_required_fields.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-07-client-required-fields'
VERSION = '20261007000003'
NAME = 'client_required_fields'
# The guard fires after this synchronisation (adresse follows adresse_ligne1): same baseline required, never touched.
EXPECTED_DEPENDENCIES = {
    'sync_client_delivery_address()': 'fb25c8bd3ece9f864dc4188437661bbd',
}
# The portal command the guard also checks; its body does not change the guard, so a difference is only reported.
REPORTED = {
    'update_client_profile(jsonb)': '9a8d9d4344a1c9e0fa28f405e1dde1d9',
}
RELIED = ','.join("'" + signature + "'" for signature in sorted({**EXPECTED_DEPENDENCIES, **REPORTED}))
# The 17 business tables of the previous releases, plus the served destinations the guard reads.
PROTECTED = TABLES + ['destinations']
# The answer to an incomplete creation under the API role (post check).
API_MESSAGE = 'Fiche client incomplète : il manque le prénom, l’email, le téléphone, l’adresse et la ville.'
API_HINT = 'client_required_fields:prenom,email,tel,adresse,ville'

# The clients table as the release must leave it, except the new trigger; the relied functions included.
SHAPE_SQL = r"""jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
   FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.clients'::regclass AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname),'[]')
   FROM pg_constraint WHERE conrelid='public.clients'::regclass),
 'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',polname,'command',polcmd::text,'permissive',polpermissive,'roles',polroles::regrole[]::text[],
   'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) ORDER BY polname),'[]') FROM pg_policy WHERE polrelid='public.clients'::regclass),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled::text,'type',tgtype,'function',tgfoid::regprocedure::text,'columns',tgattr::int2[]) ORDER BY tgname),'[]')
   FROM pg_trigger WHERE tgrelid='public.clients'::regclass AND NOT tgisinternal AND tgname<>'z_guard_client_required_fields'),
 'table',(SELECT jsonb_build_object('acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity,'owner',pg_get_userbyid(relowner)) FROM pg_class WHERE oid='public.clients'::regclass),
 'functions',(SELECT jsonb_agg(jsonb_build_object('signature',s.signature,'md5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl,'owner',pg_get_userbyid(p.proowner),
   'security_definer',p.prosecdef,'config',p.proconfig) ORDER BY s.signature)
   FROM unnest(ARRAY[""" + RELIED + r"""]) s(signature) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||s.signature)))"""

# Same rules as guard_client_required_fields, written in the query (the read-only role cannot EXECUTE it).
PREFLIGHT_SQL = r"""WITH checked AS (
 SELECT cl.id,cl.ref,cl.type::text AS type,cl.user_id IS NOT NULL AS portal,
  nullif(btrim(cl.prenom),'') IS NULL AS prenom_missing,
  nullif(btrim(cl.nom),'') IS NULL AS nom_missing,
  nullif(btrim(cl.email),'') IS NULL AS email_missing,
  nullif(btrim(cl.email),'') IS NOT NULL AND btrim(cl.email)!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AS email_invalid,
  nullif(btrim(cl.tel),'') IS NULL AND nullif(btrim(cl.tel_fixe),'') IS NULL AS phone_missing,
  coalesce(btrim(cl.tel)~'^\+?[0-9 .()-]+$' AND length(regexp_replace(cl.tel,'[^0-9]','','g'))>=9,false) AS mobile_valid,
  coalesce(btrim(cl.tel_fixe)~'^\+?[0-9 .()-]+$' AND length(regexp_replace(cl.tel_fixe,'[^0-9]','','g'))>=9,false) AS landline_valid,
  nullif(btrim(cl.adresse),'') IS NULL AS adresse_missing,
  nullif(btrim(cl.adresse),'') IS NOT NULL AND nullif(btrim(cl.adresse_ligne1),'') IS NULL AS address_legacy_only,
  nullif(btrim(cl.cp),'') IS NULL AS cp_missing,
  nullif(btrim(cl.cp),'') IS NOT NULL AND cl.cp!~'^[0-9]{5}$' AS cp_format_invalid,
  cl.cp~'^[0-9]{5}$' AND NOT EXISTS(SELECT 1 FROM public.destinations d WHERE d.code=left(cl.cp,3)) AS cp_destination_invalid,
  nullif(btrim(cl.ville),'') IS NULL AS ville_missing
 FROM public.clients cl),
flagged AS (
 SELECT c.*,NOT phone_missing AND NOT mobile_valid AND NOT landline_valid AS phone_invalid,
  array_remove(ARRAY[CASE WHEN prenom_missing THEN 'prenom' END,CASE WHEN nom_missing THEN 'nom' END,CASE WHEN email_missing THEN 'email' END,
   CASE WHEN phone_missing THEN 'telephone' END,CASE WHEN adresse_missing THEN 'adresse' END,CASE WHEN cp_missing THEN 'cp' END,
   CASE WHEN ville_missing THEN 'ville' END],NULL) AS missing,
  array_remove(ARRAY[CASE WHEN email_invalid THEN 'email' END,CASE WHEN NOT phone_missing AND NOT mobile_valid AND NOT landline_valid THEN 'telephone' END,
   CASE WHEN cp_format_invalid THEN 'cp_format' END,CASE WHEN cp_destination_invalid THEN 'cp_destination' END],NULL) AS invalid
 FROM checked c)
SELECT jsonb_build_object(
 'registered',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='""" + VERSION + r"""'),
 'latest_registered',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'existing_new_objects',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM (
   SELECT 'function '||p.oid::regprocedure::text x FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='guard_client_required_fields'
   UNION ALL SELECT 'trigger '||tgname FROM pg_trigger WHERE tgrelid='public.clients'::regclass AND NOT tgisinternal AND tgname='z_guard_client_required_fields') s),
 'relied',(SELECT jsonb_agg(jsonb_build_object('signature',s.signature,'present',p.oid IS NOT NULL,'md5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl,
   'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig) ORDER BY s.signature)
   FROM unnest(ARRAY[""" + RELIED + r"""]) s(signature) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||s.signature)),
 'shape',""" + SHAPE_SQL + r""",
 'before_triggers_after_guard',(SELECT coalesce(jsonb_agg(tgname ORDER BY tgname),'[]') FROM pg_trigger
   WHERE tgrelid='public.clients'::regclass AND NOT tgisinternal AND tgtype&3=3 AND tgname>'z_guard_client_required_fields'),
 'dependencies',jsonb_build_object(
  'auth_role',to_regprocedure('auth.role()') IS NOT NULL,
  'address_sync_trigger',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.clients'::regclass AND tgname='client_delivery_address_consistency'
    AND tgenabled='O' AND tgtype&3=3 AND tgfoid=to_regprocedure('public.sync_client_delivery_address()')),
  'clients_columns',(SELECT count(*)=9 FROM pg_attribute WHERE attrelid='public.clients'::regclass AND NOT attisdropped AND atttypid='text'::regtype
    AND attname IN ('prenom','nom','email','tel','tel_fixe','adresse','adresse_ligne1','cp','ville')),
  'destinations',(SELECT coalesce(jsonb_agg(code ORDER BY code),'[]') FROM public.destinations)),
 'reports',(SELECT jsonb_build_object(
  'clients',count(*),
  'complete',count(*) FILTER (WHERE cardinality(missing)+cardinality(invalid)=0),
  'incomplete',count(*) FILTER (WHERE cardinality(missing)+cardinality(invalid)>0),
  'incomplete_with_portal_account',count(*) FILTER (WHERE cardinality(missing)+cardinality(invalid)>0 AND portal),
  'incomplete_by_type',(SELECT coalesce(jsonb_object_agg(type,n),'{}') FROM (SELECT type,count(*) n FROM flagged WHERE cardinality(missing)+cardinality(invalid)>0 GROUP BY type) t),
  'missing',jsonb_build_object('prenom',count(*) FILTER (WHERE prenom_missing),'nom',count(*) FILTER (WHERE nom_missing),'email',count(*) FILTER (WHERE email_missing),
   'telephone',count(*) FILTER (WHERE phone_missing),'adresse',count(*) FILTER (WHERE adresse_missing),'cp',count(*) FILTER (WHERE cp_missing),
   'ville',count(*) FILTER (WHERE ville_missing)),
  'invalid',jsonb_build_object('email',count(*) FILTER (WHERE email_invalid),'telephone',count(*) FILTER (WHERE phone_invalid),
   'cp_format',count(*) FILTER (WHERE cp_format_invalid),'cp_destination',count(*) FILTER (WHERE cp_destination_invalid)),
  'landline_only',count(*) FILTER (WHERE landline_valid AND NOT mobile_valid),
  'address_only_in_legacy_column',count(*) FILTER (WHERE address_legacy_only)) FROM flagged),
 'incomplete_clients',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'ref',ref,'type',type,'portal',portal,'missing',missing,'invalid',invalid)
   ORDER BY ref NULLS LAST,id),'[]') FROM flagged WHERE cardinality(missing)+cardinality(invalid)>0)
) AS state;"""

POST_CHECKS_SQL = r"""DO $$
DECLARE fn regprocedure:='public.guard_client_required_fields()'::regprocedure; t record; previous_role text:=current_setting('role');
 owner oid:=(SELECT proowner FROM pg_proc WHERE oid='public.sync_client_delivery_address()'::regprocedure); state text; message text; hint text;
BEGIN
 IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE')
  OR (SELECT proacl IS NULL OR EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0) FROM pg_proc WHERE oid=fn)
  OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner AND prorettype='trigger'::regtype FROM pg_proc WHERE oid=fn) THEN
  RAISE EXCEPTION 'Unexpected security of guard_client_required_fields'; END IF;
 SELECT * INTO t FROM pg_trigger WHERE tgrelid='public.clients'::regclass AND tgname='z_guard_client_required_fields' AND NOT tgisinternal;
 IF NOT FOUND OR t.tgfoid<>fn OR t.tgenabled<>'O' OR t.tgtype<>23 OR cardinality(t.tgattr::int2[])<>0 THEN
  RAISE EXCEPTION 'The guard must be an enabled BEFORE INSERT OR UPDATE row trigger of clients, whatever the columns written'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.clients'::regclass AND NOT tgisinternal AND tgtype&3=3 AND tgname>'z_guard_client_required_fields')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.clients'::regclass AND tgname='client_delivery_address_consistency' AND tgenabled='O') THEN
  RAISE EXCEPTION 'The guard must fire after every other BEFORE row trigger of clients, the address synchronisation included'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.clients'::regclass AND attname IN ('prenom','email','tel','tel_fixe','adresse','adresse_ligne1','ville') AND attnotnull) THEN
  RAISE EXCEPTION 'No NOT NULL constraint may be added on clients'; END IF;
 -- An incomplete creation under the API role (as PostgREST sets it) is refused before RLS; the role is restored at once.
 PERFORM set_config('role','authenticated',true);
 BEGIN
  INSERT INTO public.clients(nom,cp) VALUES('Contrôle de mise en production','97400');
  state:='accepted';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT,hint=PG_EXCEPTION_HINT;
 END;
 PERFORM set_config('role',previous_role,true);
 IF state IS DISTINCT FROM '23514' OR message IS DISTINCT FROM '""" + API_MESSAGE + r"""' OR hint IS DISTINCT FROM '""" + API_HINT + r"""' THEN
  RAISE EXCEPTION 'An incomplete creation under the API role was not refused as reviewed: % %',state,message; END IF;
 -- The service role (Edge functions) still writes any client: the row is rolled back with its block.
 IF has_table_privilege('service_role','public.clients','INSERT') THEN
  state:=NULL; message:=NULL;
  PERFORM set_config('role','service_role',true);
  BEGIN
   INSERT INTO public.clients(nom,cp) VALUES('Contrôle de mise en production','97400');
   RAISE EXCEPTION 'client-required-fields-check';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
  END;
  PERFORM set_config('role',previous_role,true);
  IF message IS DISTINCT FROM 'client-required-fields-check' THEN RAISE EXCEPTION 'The service role can no longer write a client: % %',state,message; END IF;
 END IF;
END $$;"""

INVARIANTS_SQL = r"""DO $$
BEGIN
 IF EXISTS ((SELECT * FROM rqf_before EXCEPT SELECT * FROM rqf_after) UNION ALL (SELECT * FROM rqf_after EXCEPT SELECT * FROM rqf_before)) THEN
  RAISE EXCEPTION 'Client guard release modified existing business data'; END IF;
 IF (SELECT shape FROM rqf_shape_before) IS DISTINCT FROM """ + SHAPE_SQL + r""" THEN
  RAISE EXCEPTION 'Client guard release changed the clients table, its policies, its other triggers or a relied function'; END IF;
END $$;"""


def query(sql, readonly=True):
    return request('/database/query', 'POST', {'query': sql, 'read_only': readonly})


def digest():
    return hashlib.sha256(FILE.read_bytes()).hexdigest()


def save(name, value):
    FOLDER.mkdir(mode=0o700, parents=True, exist_ok=True)
    FOLDER.chmod(0o700)
    path = FOLDER / name
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False))
    path.chmod(0o600)


def load(name):
    return json.loads((FOLDER / name).read_text())


def check_hash(name):
    if load(name)['sha256'] != digest():
        raise RuntimeError('Migration changed: repeat preflight and rehearsal.')


def fingerprints_sql():
    # Business tables and served destinations: row count plus an md5 over the sorted row hashes, before and after.
    parts = []
    for table in PROTECTED:
        parts.append("SELECT '" + table + "'::text table_name,count(*) row_count,"
                     "md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) fingerprint FROM public." + table + ' t')
    return '\nUNION ALL\n'.join(parts)


def state():
    return query(PREFLIGHT_SQL)[0]['state']


def baseline_problems(current):
    problems = []
    if current['registered']:
        problems.append('version already registered')
    if current['existing_new_objects']:
        problems.append('objects of this release already exist: ' + ', '.join(current['existing_new_objects']))
    relied = {f['signature']: f for f in current['relied']}
    for signature, expected in EXPECTED_DEPENDENCIES.items():
        if not relied[signature]['present'] or relied[signature]['md5'] != expected:
            problems.append('relied-on function differs from the reviewed baseline: ' + signature)
    for signature in REPORTED:
        if not relied[signature]['present']:
            problems.append('portal command missing: ' + signature)
    missing = [name for name, present in current['dependencies'].items() if name != 'destinations' and not present]
    if missing:
        problems.append('missing dependencies: ' + ', '.join(missing))
    if not {'971', '972', '974', '976'} <= set(current['dependencies']['destinations']):
        problems.append('unexpected destinations')
    if current['before_triggers_after_guard']:
        problems.append('BEFORE triggers of clients would fire after the guard: ' + ', '.join(current['before_triggers_after_guard']))
    return problems


def portal_command(current):
    relied = {f['signature']: f for f in current['relied']}
    return {signature: ('as reviewed' if relied[signature]['md5'] == expected else 'differs from the reviewed source (reported only)')
            for signature, expected in REPORTED.items()}


def preflight():
    if (FOLDER / 'applied.json').exists():
        raise RuntimeError('Already applied; preserve the original backup and verify.')
    current = state()
    problems = baseline_problems(current)
    if problems:
        raise RuntimeError('Preflight refused: ' + '; '.join(problems) + '. Compare with the repository before any rehearsal.')
    save('before.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current,
                         'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'private_backup': str(FOLDER / 'before.json'), 'sha256': digest(), 'tables_protected': len(PROTECTED),
                      'latest_registered': current['latest_registered'], 'portal_command': portal_command(current),
                      'reports': current['reports']}, indent=2, ensure_ascii=False))
    if current['reports']['incomplete']:
        print('NOTE: ' + str(current['reports']['incomplete']) + ' existing clients are incomplete or invalid. The release keeps them as they '
              'are (list without personal data in the private backup); the team completes them field by field.')


def transaction_sql(register=False):
    migration = FILE.read_text()
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    sql += 'CREATE TEMP TABLE rqf_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += 'CREATE TEMP TABLE rqf_shape_before ON COMMIT DROP AS SELECT ' + SHAPE_SQL + ' AS shape;\n'
    sql += migration + '\n'
    # Post checks first: the after fingerprints also prove that their rolled-back blocks left nothing.
    sql += POST_CHECKS_SQL + '\n'
    sql += 'CREATE TEMP TABLE rqf_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += INVARIANTS_SQL + '\n'
    if register:
        sql += ("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + VERSION + "','" + NAME
                + "',ARRAY['" + migration.replace("'", "''") + "']);\nNOTIFY pgrst,'reload schema'; COMMIT;")
    else:
        sql += 'ROLLBACK;'
    return sql


def unchanged_since_preflight():
    before = load('before.json')['state']
    current = state()
    return (current['relied'] == before['relied'] and current['shape'] == before['shape']
            and not current['existing_new_objects'] and not current['registered'] and not current['before_triggers_after_guard'])


def rehearse():
    check_hash('before.json')
    if not unchanged_since_preflight():
        raise RuntimeError('Production changed since preflight: repeat preflight.')
    query(transaction_sql(), False)
    if not unchanged_since_preflight():
        raise RuntimeError('Rollback did not restore the baseline.')
    save('rehearsed.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'rolled_back': True, 'business_data_unchanged': True})
    print(json.dumps({'rehearsed': VERSION, 'sha256': digest(), 'business_data_unchanged': True, 'rolled_back': True}))


def apply():
    check_hash('before.json')
    check_hash('rehearsed.json')
    if not unchanged_since_preflight():
        raise RuntimeError('Production changed after rehearsal: repeat preflight and rehearsal.')
    query(transaction_sql(True), False)
    save('applied.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'business_data_unchanged_during_apply': True})
    print(json.dumps({'applied': VERSION, 'sha256': digest(), 'schema_reload_requested': True}))


def verify():
    check_hash('applied.json')
    assert query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'") == [{'version': VERSION}]
    before = load('before.json')['state']
    current = state()
    assert current['relied'] == before['relied'], 'a relied function changed'
    assert current['shape'] == before['shape'], 'the clients table, its policies or its other triggers changed'
    assert sorted(name.split(' ', 1)[0] for name in current['existing_new_objects']) == ['function', 'trigger']
    assert not current['before_triggers_after_guard']
    # The Management API read-only mode rejects DO blocks: run the checks in a rolled-back transaction.
    query('BEGIN;\n' + POST_CHECKS_SQL + '\nROLLBACK;', False)
    save('verified.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current, 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'registered': VERSION, 'sha256': digest(), 'guard': 'private, last BEFORE INSERT OR UPDATE trigger of clients',
                      'incomplete_api_creation': 'refused as reviewed', 'portal_command': portal_command(current),
                      'reports': current['reports']}, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
