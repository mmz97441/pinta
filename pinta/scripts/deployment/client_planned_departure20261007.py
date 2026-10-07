"""Release of the client's planned departure (2026-10-07): one new function, no business data written.

The migration only creates client_planned_departures(uuid[]) (same security model as client_outgoing_tracking).
Operations, each run separately by the lead and only with the user's explicit go-ahead:
  preflight  read-only, plain SELECTs only (the read-only Management API role cannot EXECUTE application functions):
             refuses when the version is registered, when a function named client_planned_departures already exists,
             when the reference client_outgoing_tracking(uuid[]) is missing, or when a column, enum value or helper the
             function reads is missing. Reports how many open dossiers will show a planned day, how many will show the
             « not fixed yet » version and how many stale assignments (past or archived departure) stay hidden.
             Saves everything privately (folder 0700, files 0600).
  rehearse   write transaction rolled back: migration plus invariants (business data, client_colis and the reference
             function unchanged) and the post checks.
  apply      same transaction, registered in schema_migrations, schema reload requested, committed.
  verify     read-only checks, run in BEGIN … ROLLBACK because the read-only mode rejects DO blocks.
The migration SHA-256 is recorded at every step. Credentials stay in memory (management.py); nothing runs at import and
no secret is printed. Apply before shipping the front: until then the portal shows « La date de départ n’a pas pu être
chargée » on the dossiers concerned, never a wrong day.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import TABLES

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261007000002_client_planned_departure.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-07-client-planned-departure'
VERSION = '20261007000002'
NAME = 'client_planned_departure'
FUNCTION = 'client_planned_departures(uuid[])'
REFERENCE = 'client_outgoing_tracking(uuid[])'
SHOWN = "'autorise','en_preparation','devis_envoye','attente_paiement','paye','expedie'"
BEFORE_DEPARTURE = "'autorise','en_preparation','devis_envoye','attente_paiement','paye'"
# The function's predicate without the caller filter, written in the query for the reports.
DAY_SHOWN = ("NOT coalesce(c.archive,false) AND e.statut<>'archive' AND e.date_depart IS NOT NULL"
             " AND CASE WHEN c.statut='expedie' THEN e.departed_at IS NOT NULL"
             " ELSE e.departed_at IS NULL AND e.date_depart>=(now() AT TIME ZONE 'Europe/Paris')::date END")

PREFLIGHT_SQL = r"""SELECT jsonb_build_object(
 'registered',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='""" + VERSION + r"""'),
 'existing_functions',(SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text),'[]')
   FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='client_planned_departures'),
 'reference',(SELECT jsonb_build_object('md5',md5(pg_get_functiondef(oid)),'owner',pg_get_userbyid(proowner),'acl',proacl,
   'security_definer',prosecdef,'config',proconfig,'anon',has_function_privilege('anon',oid,'EXECUTE'),
   'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE'))
   FROM pg_proc WHERE oid=to_regprocedure('public.""" + REFERENCE + r"""')),
 'view',(SELECT jsonb_build_object('definition',pg_get_viewdef(c.oid,true),'acl',c.relacl,'owner',pg_get_userbyid(c.relowner),'options',c.reloptions)
   FROM pg_class c WHERE c.oid='public.client_colis'::regclass),
 'dependencies',jsonb_build_object(
  'auth_client_id',to_regprocedure('public.auth_client_id()') IS NOT NULL,
  'auth_uid',to_regprocedure('auth.uid()') IS NOT NULL,
  'colis_columns',(SELECT count(*)=5 FROM pg_attribute WHERE attrelid='public.colis'::regclass AND NOT attisdropped
    AND attname IN ('id','client_id','statut','archive','envoi_id')),
  'envois_columns',(SELECT count(*)=4 FROM pg_attribute WHERE attrelid='public.envois'::regclass AND NOT attisdropped
    AND attname IN ('id','statut','date_depart','departed_at')),
  'profiles_actif',EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.profiles'::regclass AND attname='actif' AND NOT attisdropped),
  'envoi_archive_status',EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.statut_envoi'::regtype AND enumlabel='archive'),
  'colis_statuses',(SELECT count(*)=6 FROM pg_enum WHERE enumtypid='public.statut_colis'::regtype AND enumlabel IN (""" + SHOWN + r"""))),
 'reports',jsonb_build_object(
  'dossiers_with_a_day',(SELECT count(*) FROM public.colis c JOIN public.envois e ON e.id=c.envoi_id
    WHERE c.statut IN (""" + SHOWN + r""") AND """ + DAY_SHOWN + r"""),
  'dossiers_waiting_for_a_day',(SELECT count(*) FROM public.colis c WHERE c.statut IN (""" + BEFORE_DEPARTURE + r""") AND NOT coalesce(c.archive,false)
    AND NOT EXISTS(SELECT 1 FROM public.envois e WHERE e.id=c.envoi_id AND """ + DAY_SHOWN + r""")),
  'stale_assignments_hidden',(SELECT coalesce(jsonb_agg(jsonb_build_object('ref',c.ref,'statut',c.statut,'envoi',e.ref,'date_depart',e.date_depart,'envoi_statut',e.statut) ORDER BY c.ref),'[]')
    FROM public.colis c JOIN public.envois e ON e.id=c.envoi_id WHERE c.statut IN (""" + SHOWN + r""") AND NOT coalesce(c.archive,false)
    AND NOT (""" + DAY_SHOWN + r""")))
) AS state;"""

BEFORE_SQL = r"""CREATE TEMP TABLE cpd_reference_before ON COMMIT DROP AS SELECT oid,md5(pg_get_functiondef(oid)) md5,proacl acl,proowner owner,proconfig config,prosecdef secdef
 FROM pg_proc WHERE oid='public.""" + REFERENCE + r"""'::regprocedure;
CREATE TEMP TABLE cpd_view_before ON COMMIT DROP AS SELECT pg_get_viewdef('public.client_colis'::regclass,true) definition,relacl,relowner,reloptions
 FROM pg_class WHERE oid='public.client_colis'::regclass;"""

INVARIANTS_SQL = r"""DO $$
DECLARE old record; ref record;
BEGIN
 IF EXISTS ((SELECT * FROM cpd_before EXCEPT SELECT * FROM cpd_after) UNION ALL (SELECT * FROM cpd_after EXCEPT SELECT * FROM cpd_before)) THEN
  RAISE EXCEPTION 'Planned departure release modified business data'; END IF;
 SELECT * INTO old FROM cpd_view_before;
 IF pg_get_viewdef('public.client_colis'::regclass,true)<>old.definition
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid='public.client_colis'::regclass AND (relacl,relowner,reloptions) IS DISTINCT FROM (old.relacl,old.relowner,old.reloptions)) THEN
  RAISE EXCEPTION 'Client projection changed: client_colis must stay as reviewed'; END IF;
 SELECT * INTO ref FROM cpd_reference_before;
 IF (SELECT (md5(pg_get_functiondef(oid)),proacl,proowner,proconfig,prosecdef) IS DISTINCT FROM (ref.md5,ref.acl,ref.owner,ref.config,ref.secdef) FROM pg_proc WHERE oid=ref.oid) THEN
  RAISE EXCEPTION 'The reference client_outgoing_tracking changed'; END IF;
END $$;"""

POST_CHECKS_SQL = r"""DO $$
DECLARE fn regprocedure:='public.""" + FUNCTION + r"""'::regprocedure; ref regprocedure:='public.""" + REFERENCE + r"""'::regprocedure; definition text;
BEGIN
 definition:=pg_get_functiondef(fn);
 IF pg_get_function_result(fn)<>'TABLE(colis_id uuid, date_depart date)'
  OR NOT (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid=fn) THEN
  RAISE EXCEPTION 'Unexpected signature or security of client_planned_departures'; END IF;
 IF position('c.client_id=public.auth_client_id()' IN definition)=0 OR position('p.actif=true' IN definition)=0
  OR position('e.statut<>''archive''' IN definition)=0 OR position('NOT coalesce(c.archive,false)' IN definition)=0
  OR position('depart_souhaite' IN definition)>0 THEN
  RAISE EXCEPTION 'client_planned_departures does not carry the reviewed body'; END IF;
 IF has_function_privilege('anon',fn,'EXECUTE') OR NOT has_function_privilege('authenticated',fn,'EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=fn AND a.grantee=0)
  OR has_function_privilege('service_role',fn,'EXECUTE')<>has_function_privilege('service_role',ref,'EXECUTE')
  OR (SELECT proowner FROM pg_proc WHERE oid=fn)<>(SELECT proowner FROM pg_proc WHERE oid=ref) THEN
  RAISE EXCEPTION 'Unexpected grants or owner of client_planned_departures'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.client_colis'::regclass AND attname IN ('depart_souhaite','date_depart') AND NOT attisdropped) THEN
  RAISE EXCEPTION 'The client view exposes a departure field'; END IF;
 -- The rows depend on the caller only: an unknown account and a caller without identity read nothing.
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
 IF EXISTS(SELECT 1 FROM public.client_planned_departures(ARRAY(SELECT id FROM public.colis ORDER BY id LIMIT 500))) THEN
  RAISE EXCEPTION 'An unknown account reads planned departures'; END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 IF EXISTS(SELECT 1 FROM public.client_planned_departures(ARRAY(SELECT id FROM public.colis ORDER BY id LIMIT 500))) THEN
  RAISE EXCEPTION 'A caller without identity reads planned departures'; END IF;
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
    # The business tables of the previous releases: row count plus an md5 over the sorted row hashes, before and after.
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
    if current['existing_functions']:
        problems.append('the function already exists: ' + ', '.join(current['existing_functions']))
    if not current['reference']:
        problems.append('the reference client_outgoing_tracking(uuid[]) is missing')
    elif current['reference']['anon'] or not current['reference']['authenticated'] or not current['reference']['security_definer']:
        problems.append('the reference client_outgoing_tracking(uuid[]) does not have the reviewed security')
    if not current['view']:
        problems.append('the client view client_colis is missing')
    missing = [name for name, present in current['dependencies'].items() if not present]
    if missing:
        problems.append('missing dependencies: ' + ', '.join(missing))
    return problems


def summary(current):
    # Counts only on screen; the dossier references stay in the private backup.
    reports = current['reports']
    return {'dossiers_with_a_day': reports['dossiers_with_a_day'], 'dossiers_waiting_for_a_day': reports['dossiers_waiting_for_a_day'],
            'stale_assignments_hidden': len(reports['stale_assignments_hidden'])}


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
                      'reports': summary(current)}, indent=2, ensure_ascii=False))


def transaction_sql(register=False):
    migration = FILE.read_text()
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    sql += 'CREATE TEMP TABLE cpd_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += BEFORE_SQL + '\n'
    sql += migration + '\n'
    sql += 'CREATE TEMP TABLE cpd_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += INVARIANTS_SQL + '\n' + POST_CHECKS_SQL + '\n'
    if register:
        sql += ("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + VERSION + "','" + NAME
                + "',ARRAY['" + migration.replace("'", "''") + "']);\nNOTIFY pgrst,'reload schema'; COMMIT;")
    else:
        sql += 'ROLLBACK;'
    return sql


def unchanged_since_preflight():
    before = load('before.json')['state']
    current = state()
    return (current['reference'] == before['reference'] and current['view'] == before['view']
            and not current['existing_functions'] and not current['registered'])


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
    assert current['existing_functions'] == ['client_planned_departures(uuid[])'], current['existing_functions']
    assert current['reference'] == before['reference'], 'client_outgoing_tracking changed'
    assert current['view'] == before['view'], 'client_colis changed'
    # The Management API read-only mode rejects DO blocks: run the read-only checks in a rolled-back transaction.
    query('BEGIN;\n' + POST_CHECKS_SQL + '\nROLLBACK;', False)
    save('verified.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current, 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'registered': VERSION, 'sha256': digest(), 'function': FUNCTION, 'client_view': 'unchanged',
                      'reference_function': 'unchanged', 'grants': 'as reviewed', 'reports': summary(current)}, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
