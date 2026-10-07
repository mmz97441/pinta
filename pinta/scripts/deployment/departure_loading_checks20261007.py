"""Release of the mandatory loading control of a departure (2026-10-07) without rewriting any business row.

The migration creates the private table departure_loading_checks, four staff commands (record_loading_check,
record_loading_count, clear_loading_checks, get_loading_checks), four private helpers, and replaces confirm_departure whole
(copy of 2026-09-17 plus the control: each loaded dossier needs all its outgoing parcels checked; the manifest keeps the
checks). From the release on, a departure is confirmed only once its parcels are scanned or counted: ship the loading
screen with it.
Operations, each run separately by the lead and only with the user's explicit go-ahead:
  preflight  read-only, plain SELECTs with every predicate written in the query (the read-only role of the Management API
             cannot EXECUTE application functions): refuses when the version is registered, when an object of the release
             exists, when confirm_departure differs from the reviewed repository baseline (md5 of pg_get_functiondef, local
             replay up to 20261007000003 on PostgreSQL 17), or when a column, enum value or relied function is missing.
             REPORTS, without changing them, the open departures that will need the control (dossiers, parcels to check,
             legacy single parcels, dossiers not prepared yet), first those leaving today (Paris). Departure and dossier
             references only go to the private backup (folder 0700, files 0600); counts on screen.
  rehearse   write transaction rolled back: migration, post checks (table private under RLS, grants, owners, the reviewed
             confirmation body, a call under the API role without permission refused as reviewed), then the invariants
             (business data unchanged, confirm_departure keeps its owner, grants and configuration).
  apply      same transaction, registered in schema_migrations, schema reload requested, committed.
  verify     read-only checks, run in BEGIN … ROLLBACK because the read-only mode rejects DO blocks, and a fresh report.
The migration SHA-256 is recorded at every step. Credentials stay in memory (management.py); nothing runs at import and no
secret is printed. No Edge function changes in this lot.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import TABLES

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261007000004_departure_loading_checks.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-07-departure-loading-checks'
VERSION = '20261007000004'
NAME = 'departure_loading_checks'
CONFIRM = 'confirm_departure(uuid,jsonb,timestamptz,text)'
# Replaced whole by the migration: production must run the reviewed source (local replay up to 20261007000003, PostgreSQL 17).
EXPECTED_SOURCE = {
    CONFIRM: 'c6dd19d1055cbd98cf517dc173600849',
}
# Substrings proving the new body: the control and its evidence, and two guards of the former body.
MARKERS = ["HINT='loading_check:incomplete'", "'loading_checks',checks", 'La confirmation doit avoir lieu à la date prévue du départ',
           "'departure_confirmed'"]
# Relied on unchanged; a difference is only reported (their contracts, not their text, matter here).
REPORTED = {
    'has_permission(text)': 'a02569518d6a13a8277b5304e34699ba',
    'get_departure_manifest(uuid)': 'a9977a084bb9bdd3a05db36db152e0d2',
}
COMMANDS = ['record_loading_check(uuid,uuid,integer,integer,text)', 'record_loading_count(uuid,uuid,integer)',
            'clear_loading_checks(uuid,uuid)', 'get_loading_checks(uuid)']
HELPERS = ['_loading_expected_parcels(colis)', '_loading_checker_name(uuid)', '_loading_check_json(departure_loading_checks)',
           '_loading_check_target(uuid,uuid,boolean)']
NEW_NAMES = ['record_loading_check', 'record_loading_count', 'clear_loading_checks', 'get_loading_checks',
             '_loading_expected_parcels', '_loading_checker_name', '_loading_check_json', '_loading_check_target']
RELIED = ','.join("'" + signature + "'" for signature in sorted({**EXPECTED_SOURCE, **REPORTED}))
CREATED = ','.join("'" + name + "'" for name in NEW_NAMES)
# The answer to a call under the API role without permission (post check).
API_MESSAGE = 'Permission d’expédition requise pour contrôler le chargement'
OPEN = "('planifie','prochain','en_cours','en_preparation','pret')"
CLOSED_DOSSIER = "('expedie','transit','dedouanement','arrive','livraison','livre','annule')"
# _loading_expected_parcels, written in the query.
EXPECTED_PARCELS = ("CASE WHEN jsonb_typeof(c.final_packages)='array' AND jsonb_array_length(c.final_packages)>0 THEN c.outgoing_parcel_count"
                    " WHEN coalesce(c.fin_l>0 AND c.fin_w>0 AND c.fin_h>0 AND c.fin_p>0,false) THEN coalesce(c.outgoing_parcel_count,1) END")

PREFLIGHT_SQL = r"""WITH loading AS (
 SELECT e.id envoi_id,e.ref envoi_ref,e.date_depart,e.date_depart=(now() AT TIME ZONE 'Europe/Paris')::date AS today,c.ref colis_ref,c.statut::text statut,
  """ + EXPECTED_PARCELS + r""" AS expected,
  NOT coalesce(jsonb_typeof(c.final_packages)='array' AND jsonb_array_length(c.final_packages)>0,false) AND coalesce(c.fin_l>0 AND c.fin_w>0 AND c.fin_h>0 AND c.fin_p>0,false) AS legacy_single
 FROM public.envois e JOIN public.colis c ON c.envoi_id=e.id
 WHERE e.departed_at IS NULL AND e.statut IN """ + OPEN + r""" AND NOT coalesce(c.archive,false) AND c.date_expedition IS NULL AND c.statut NOT IN """ + CLOSED_DOSSIER + r""")
SELECT jsonb_build_object(
 'registered',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='""" + VERSION + r"""'),
 'latest_registered',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'existing_new_objects',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM (
   SELECT 'function '||p.oid::regprocedure::text x FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN (""" + CREATED + r""")
   UNION ALL SELECT 'table departure_loading_checks' WHERE to_regclass('public.departure_loading_checks') IS NOT NULL
   UNION ALL SELECT 'index '||indexname FROM pg_indexes WHERE schemaname='public' AND indexname='departure_loading_checks_colis') s),
 'relied',(SELECT jsonb_agg(jsonb_build_object('signature',s.signature,'present',p.oid IS NOT NULL,'md5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl,
   'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig,
   'anon',CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('anon',p.oid,'EXECUTE') END,
   'authenticated',CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('authenticated',p.oid,'EXECUTE') END,
   'service',CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('service_role',p.oid,'EXECUTE') END) ORDER BY s.signature)
   FROM unnest(ARRAY[""" + RELIED + r"""]) s(signature) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||s.signature)),
 'dependencies',jsonb_build_object(
  'auth_uid',to_regprocedure('auth.uid()') IS NOT NULL,
  'departure_manifests',to_regclass('public.departure_manifests') IS NOT NULL,
  'colis_columns',(SELECT count(*)=13 FROM pg_attribute WHERE attrelid='public.colis'::regclass AND NOT attisdropped AND attname IN
    ('id','ref','statut','archive','envoi_id','date_expedition','final_packages','outgoing_parcel_count','fin_l','fin_w','fin_h','fin_p','updated_at')),
  'envois_columns',(SELECT count(*)=5 FROM pg_attribute WHERE attrelid='public.envois'::regclass AND NOT attisdropped AND attname IN ('id','statut','departed_at','date_depart','updated_at')),
  'staff_names',(SELECT count(*)=4 FROM pg_attribute WHERE NOT attisdropped AND ((attrelid='public.staff_users'::regclass AND attname IN ('auth_id','prenom','nom'))
    OR (attrelid='public.profiles'::regclass AND attname='prenom'))),
  'permissions',(SELECT count(*)=4 FROM pg_attribute WHERE attrelid='public.staff_permissions'::regclass AND NOT attisdropped
    AND attname IN ('perm_colis_expedier','perm_envois_voir','perm_envois_modifier','perm_envois_reaffecter')),
  'audit_before_data',EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.audit_actions'::regclass AND attname='before_data' AND atttypid='jsonb'::regtype AND NOT attisdropped),
  'envoi_statuses',(SELECT count(*)=5 FROM pg_enum WHERE enumtypid='public.statut_envoi'::regtype AND enumlabel IN """ + OPEN + r"""),
  'colis_statuses',(SELECT count(*)=7 FROM pg_enum WHERE enumtypid='public.statut_colis'::regtype AND enumlabel IN """ + CLOSED_DOSSIER + r""")),
 'reports',jsonb_build_object(
  'open_departures_with_dossiers',(SELECT count(DISTINCT envoi_id) FROM loading),
  'dossiers_to_check',(SELECT count(*) FROM loading WHERE expected IS NOT NULL),
  'parcels_to_check',(SELECT coalesce(sum(expected),0) FROM loading),
  'legacy_single_parcel_dossiers',(SELECT count(*) FROM loading WHERE legacy_single),
  'dossiers_not_prepared',(SELECT count(*) FROM loading WHERE expected IS NULL),
  'departures_today',(SELECT coalesce(jsonb_agg(jsonb_build_object('ref',envoi_ref,'dossiers',n,'parcels',parcels,'paid',paid) ORDER BY envoi_ref),'[]')
    FROM (SELECT envoi_ref,count(*) n,coalesce(sum(expected),0) parcels,count(*) FILTER (WHERE statut='paye') paid FROM loading WHERE today GROUP BY envoi_ref) t)),
 'departures',(SELECT coalesce(jsonb_agg(jsonb_build_object('ref',envoi_ref,'date',date_depart,'dossiers',dossiers) ORDER BY date_depart,envoi_ref),'[]')
   FROM (SELECT envoi_ref,date_depart,jsonb_agg(jsonb_build_object('ref',colis_ref,'statut',statut,'expected',expected,'legacy_single',legacy_single) ORDER BY colis_ref) dossiers
   FROM loading GROUP BY envoi_ref,date_depart) d)
) AS state;"""

BEFORE_SQL = r"""CREATE TEMP TABLE dlc_confirm_before ON COMMIT DROP AS SELECT oid,proacl acl,proowner owner,proconfig config
 FROM pg_proc WHERE oid='public.""" + CONFIRM + r"""'::regprocedure;"""

INVARIANTS_SQL = r"""DO $$
DECLARE old record;
BEGIN
 IF EXISTS ((SELECT * FROM dlc_before EXCEPT SELECT * FROM dlc_after) UNION ALL (SELECT * FROM dlc_after EXCEPT SELECT * FROM dlc_before)) THEN
  RAISE EXCEPTION 'Loading control release modified existing business data'; END IF;
 SELECT * INTO old FROM dlc_confirm_before;
 IF (SELECT (proacl,proowner,proconfig) IS DISTINCT FROM (old.acl,old.owner,old.config) OR NOT prosecdef FROM pg_proc WHERE oid=old.oid) THEN
  RAISE EXCEPTION 'confirm_departure lost its owner, grants, configuration or definer security'; END IF;
END $$;"""

POST_CHECKS_SQL = r"""DO $$
DECLARE fn text; owner oid:=(SELECT proowner FROM pg_proc WHERE oid='public.""" + CONFIRM + r"""'::regprocedure); definition text;
 previous_role text:=current_setting('role'); previous_sub text:=coalesce(current_setting('request.jwt.claim.sub',true),''); state text; message text;
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.departure_loading_checks'::regclass)
  OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.departure_loading_checks'::regclass)
  OR has_table_privilege('anon','public.departure_loading_checks','SELECT') OR has_table_privilege('authenticated','public.departure_loading_checks','SELECT')
  OR has_table_privilege('anon','public.departure_loading_checks','INSERT') OR has_table_privilege('authenticated','public.departure_loading_checks','INSERT')
  OR has_table_privilege('authenticated','public.departure_loading_checks','UPDATE') OR has_table_privilege('authenticated','public.departure_loading_checks','DELETE') THEN
  RAISE EXCEPTION 'The checks table must stay private: RLS without policy, no privilege for the API roles'; END IF;
 IF (SELECT array_agg(a.attname ORDER BY a.attnum) FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
   WHERE i.indrelid='public.departure_loading_checks'::regclass AND i.indisprimary)<>ARRAY['envoi_id','colis_id','parcel_index']::name[]
  OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.departure_loading_checks'::regclass AND contype='f' AND confdeltype='c')<>3
  OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.departure_loading_checks'::regclass AND contype='c')<>2
  OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='departure_loading_checks' AND indexname='departure_loading_checks_colis') THEN
  RAISE EXCEPTION 'Unexpected key, foreign keys, checks or index of departure_loading_checks'; END IF;
 IF EXISTS(SELECT 1 FROM public.departure_loading_checks) THEN RAISE EXCEPTION 'The release must not record any check'; END IF;
 FOREACH fn IN ARRAY ARRAY[""" + ','.join("'" + signature + "'" for signature in COMMANDS) + r"""] LOOP
  IF has_function_privilege('anon','public.'||fn,'EXECUTE') OR has_function_privilege('service_role','public.'||fn,'EXECUTE') OR NOT has_function_privilege('authenticated','public.'||fn,'EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=('public.'||fn)::regprocedure AND a.grantee=0)
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner FROM pg_proc WHERE oid=('public.'||fn)::regprocedure) THEN
   RAISE EXCEPTION 'Unexpected staff command security: %',fn; END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY[""" + ','.join("'" + signature + "'" for signature in HELPERS) + r"""] LOOP
  IF has_function_privilege('anon','public.'||fn,'EXECUTE') OR has_function_privilege('authenticated','public.'||fn,'EXECUTE') OR has_function_privilege('service_role','public.'||fn,'EXECUTE')
   OR NOT (SELECT proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner FROM pg_proc WHERE oid=('public.'||fn)::regprocedure) THEN
   RAISE EXCEPTION 'Unexpected private helper security: %',fn; END IF;
 END LOOP;
 definition:=pg_get_functiondef('public.""" + CONFIRM + r"""'::regprocedure);
 IF """ + ' OR '.join("position('" + marker.replace("'", "''") + "' IN definition)=0" for marker in MARKERS) + r""" THEN
  RAISE EXCEPTION 'confirm_departure does not carry the reviewed body'; END IF;
 IF has_function_privilege('anon','public.""" + CONFIRM + r"""','EXECUTE') OR NOT has_function_privilege('authenticated','public.""" + CONFIRM + r"""','EXECUTE') THEN
  RAISE EXCEPTION 'confirm_departure changed grants'; END IF;
 -- A call under the API role (as PostgREST sets it) without permission is refused before reading anything; role restored at once.
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
 PERFORM set_config('role','authenticated',true);
 BEGIN
  PERFORM public.record_loading_check(gen_random_uuid(),gen_random_uuid(),1,1,'scan');
  state:='accepted';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
 END;
 PERFORM set_config('role',previous_role,true);
 PERFORM set_config('request.jwt.claim.sub',previous_sub,true);
 IF state IS DISTINCT FROM '42501' OR message IS DISTINCT FROM '""" + API_MESSAGE + r"""' THEN
  RAISE EXCEPTION 'A call without permission was not refused as reviewed: % %',state,message; END IF;
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
    # The business tables of the previous releases (departure manifests included): row count plus an md5 over the sorted
    # row hashes, before and after.
    parts = []
    for table in TABLES:
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
    for signature, expected in EXPECTED_SOURCE.items():
        if not relied[signature]['present'] or relied[signature]['md5'] != expected:
            problems.append('production source differs from the reviewed baseline: ' + signature)
    for signature in REPORTED:
        if not relied[signature]['present']:
            problems.append('relied-on function missing: ' + signature)
    missing = [name for name, present in current['dependencies'].items() if not present]
    if missing:
        problems.append('missing dependencies: ' + ', '.join(missing))
    return problems


def relied_report(current):
    relied = {f['signature']: f for f in current['relied']}
    return {signature: ('as reviewed' if relied[signature]['md5'] == expected else 'differs from the reviewed source (reported only)')
            for signature, expected in REPORTED.items()}


def summary(current):
    # Counts only on screen; departure and dossier references stay in the private backup.
    reports = current['reports']
    return {**{key: value for key, value in reports.items() if key != 'departures_today'},
            'departures_today': len(reports['departures_today']),
            'parcels_to_check_today': sum(item['parcels'] for item in reports['departures_today'])}


def preflight():
    if (FOLDER / 'applied.json').exists():
        raise RuntimeError('Already applied; preserve the original backup and verify.')
    current = state()
    problems = baseline_problems(current)
    if problems:
        raise RuntimeError('Preflight refused: ' + '; '.join(problems) + '. Compare with the repository before any rehearsal.')
    save('before.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current,
                         'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'private_backup': str(FOLDER / 'before.json'), 'sha256': digest(), 'tables_protected': len(TABLES),
                      'latest_registered': current['latest_registered'], 'relied': relied_report(current),
                      'reports': summary(current)}, indent=2, ensure_ascii=False))
    if current['reports']['departures_today']:
        print('NOTE: ' + str(len(current['reports']['departures_today'])) + ' open departures leave today: once applied, their '
              'confirmation needs every parcel scanned or counted. Apply with the loading screen, or after these departures.')


def transaction_sql(register=False):
    migration = FILE.read_text()
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    sql += 'CREATE TEMP TABLE dlc_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += BEFORE_SQL + '\n'
    sql += migration + '\n'
    # Post checks first: the after fingerprints also prove that their refused call left nothing.
    sql += POST_CHECKS_SQL + '\n'
    sql += 'CREATE TEMP TABLE dlc_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
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
    return (current['relied'] == before['relied'] and current['dependencies'] == before['dependencies']
            and not current['existing_new_objects'] and not current['registered'])


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
    previous = {f['signature']: f for f in before['relied']}
    relied = {f['signature']: f for f in current['relied']}
    for key in ['acl', 'owner', 'security_definer', 'config', 'anon', 'authenticated', 'service']:
        assert relied[CONFIRM][key] == previous[CONFIRM][key], CONFIRM + ' ' + key
    assert relied[CONFIRM]['md5'] != EXPECTED_SOURCE[CONFIRM], 'confirm_departure was not replaced'
    for signature in REPORTED:
        assert relied[signature] == previous[signature], signature + ' changed'
    assert sorted(name.split(' ', 1)[0] for name in current['existing_new_objects']) == sorted(['function'] * len(NEW_NAMES) + ['index', 'table'])
    # The Management API read-only mode rejects DO blocks: run the read-only checks in a rolled-back transaction.
    query('BEGIN;\n' + POST_CHECKS_SQL + '\nROLLBACK;', False)
    save('verified.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current, 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'registered': VERSION, 'sha256': digest(), 'table': 'private, RLS without policy', 'commands': len(COMMANDS),
                      'helpers': len(HELPERS), 'confirm_departure': 'replaced, grants unchanged', 'relied': relied_report(current),
                      'reports': summary(current)}, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
