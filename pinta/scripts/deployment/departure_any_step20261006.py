"""Release of « départ à toute étape » (lot 3a, 2026-10-06) without rewriting business data.

Operations, each run separately by the lead and only with the user's explicit go-ahead:
  preflight  read-only: refuses when already registered, when an object of the release exists, or when one of the four
             replaced functions differs from the reviewed repository baseline (md5 of pg_get_functiondef); reports the
             duplicate departures (destination, day), the open dossiers whose departure is no longer valid and the
             departure reference counter. Saves everything privately (folder 0700, files 0600).
  rehearse   write transaction rolled back: migration plus invariants (business data unchanged, no desired day written,
             client view unchanged, replaced functions keep owner/grants/configuration) and the post checks.
  apply      same transaction, registered in schema_migrations, schema reload requested, committed.
  verify     read-only checks, run in BEGIN … ROLLBACK because the read-only mode rejects DO blocks.
The migration SHA-256 is recorded at every step. Credentials stay in memory (management.py); nothing runs at import and
no secret is printed. No Edge function changes in this lot; the front that calls the new commands ships after apply.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import TABLES

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261006000001_departure_any_step.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-06-departure-any-step'
VERSION = '20261006000001'
NAME = 'departure_any_step'
# Replaced whole by the migration: production must run the reviewed source (local replay up to 20261004000001, PostgreSQL 17).
EXPECTED_SOURCE = {
    '_apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)': '99490e3b3c2c4b8e7173bc1d15fe7680',
    'assign_colis_departure(uuid,uuid,timestamptz)': 'b83436fc3f3779382a6625f3ac9f2a35',
    'refresh_staff_work_actions()': '1372ca861a4d7e2fa5b342d064a7607d',
    'sync_staff_work_actions(uuid)': 'd09b6d520d082b7824b671919735eb29',
}
# A substring that proves the new body of each replaced function.
MARKERS = {
    '_apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)': 'departure:=_departure_for_day(c,c.depart_souhaite)',
    'assign_colis_departure(uuid,uuid,timestamptz)': 'depart_souhaite=CASE WHEN p_envoi_id IS NULL THEN depart_souhaite END',
    'refresh_staff_work_actions()': 'w.action_hint IS DISTINCT FROM _reception_work_hint(c)',
    'sync_staff_work_actions(uuid)': 'reception_hint:=_reception_work_hint(c)',
}
NEW_FUNCTIONS = ['departure_default_closing', 'set_colis_departure_wish', 'create_departure_for_colis', '_colis_destination',
                 '_departure_for_day', '_colis_departure_closing', '_consent_relance_open', '_reception_work_hint',
                 'guard_colis_departure_wish']
REPLACED = ','.join("'" + signature + "'" for signature in sorted(EXPECTED_SOURCE))
CREATED = ','.join("'" + name + "'" for name in NEW_FUNCTIONS)

PREFLIGHT_SQL = r"""WITH replaced AS (
 SELECT s.signature,p.oid,pg_get_functiondef(p.oid) definition FROM unnest(ARRAY[""" + REPLACED + r"""]) s(signature)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||s.signature)),
open_dossiers AS (SELECT c.* FROM public.colis c WHERE NOT coalesce(c.archive,false)
 AND c.statut NOT IN ('expedie','transit','dedouanement','arrive','livraison','livre','annule'))
SELECT jsonb_build_object(
 'registered',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='""" + VERSION + r"""'),
 'existing_new_objects',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM (
   SELECT 'function '||p.oid::regprocedure::text x FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN (""" + CREATED + r""")
   UNION ALL SELECT 'column colis.depart_souhaite' FROM pg_attribute WHERE attrelid='public.colis'::regclass AND attname='depart_souhaite' AND NOT attisdropped
   UNION ALL SELECT 'index '||indexname FROM pg_indexes WHERE schemaname='public' AND indexname='colis_depart_souhaite'
   UNION ALL SELECT 'trigger '||tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname='guard_colis_departure_wish') s),
 'replaced',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'present',oid IS NOT NULL,'md5',md5(definition),'definition',definition,
   'owner',(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=replaced.oid),'acl',(SELECT proacl FROM pg_proc WHERE oid=replaced.oid),
   'security_definer',(SELECT prosecdef FROM pg_proc WHERE oid=replaced.oid),'config',(SELECT proconfig FROM pg_proc WHERE oid=replaced.oid),
   'anon',CASE WHEN oid IS NOT NULL THEN has_function_privilege('anon',oid,'EXECUTE') END,
   'authenticated',CASE WHEN oid IS NOT NULL THEN has_function_privilege('authenticated',oid,'EXECUTE') END,
   'service',CASE WHEN oid IS NOT NULL THEN has_function_privilege('service_role',oid,'EXECUTE') END) ORDER BY signature) FROM replaced),
 'view',(SELECT jsonb_build_object('definition',pg_get_viewdef(c.oid,true),'acl',c.relacl,'owner',pg_get_userbyid(c.relowner),'options',c.reloptions)
   FROM pg_class c WHERE c.oid='public.client_colis'::regclass),
 'dependencies',jsonb_build_object(
  'valid_departure_for_colis',to_regprocedure('public.valid_departure_for_colis(uuid,uuid)') IS NOT NULL,
  'guard_colis_departure',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.colis'::regclass AND tgname='guard_colis_departure' AND tgenabled='O'),
  'z_sync_staff_work',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.colis'::regclass AND tgname='z_sync_staff_work' AND tgenabled='O'),
  'z_sync_departure_work_deadline',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.envois'::regclass AND tgname='z_sync_departure_work_deadline' AND tgenabled='O'),
  'mode_transport_check',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.envois'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%mode_transport%aerien%'),
  'destinations',(SELECT coalesce(jsonb_agg(code ORDER BY code),'[]') FROM public.destinations)),
 'reports',jsonb_build_object(
  'duplicate_departures',(SELECT coalesce(jsonb_agg(jsonb_build_object('destination',destination_code,'date',date_depart,'count',n,'refs',refs) ORDER BY date_depart,destination_code),'[]')
    FROM (SELECT destination_code,date_depart,count(*) n,jsonb_agg(ref ORDER BY ref) refs FROM public.envois WHERE statut<>'archive' GROUP BY destination_code,date_depart HAVING count(*)>1) d),
  'invalid_assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'ref',c.ref,'statut',c.statut,'envoi_id',c.envoi_id) ORDER BY c.ref),'[]')
    -- Same predicate as valid_departure_for_colis, inlined: the read-only API role cannot EXECUTE that function.
    FROM open_dossiers c WHERE c.envoi_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.envois e JOIN public.clients cl ON cl.id=c.client_id WHERE e.id=c.envoi_id
     AND e.destination_code=left(cl.cp,3) AND e.statut IN ('planifie','prochain','en_cours','en_preparation','pret') AND e.departed_at IS NULL
     AND e.date_depart>=(now() AT TIME ZONE 'Europe/Paris')::date AND (e.loading_closes_at IS NULL OR e.loading_closes_at>now()))),
  'envoi_reference_counter',(SELECT last_value FROM public.seq_envoi_ref),
  'open_reception_actions',(SELECT count(*) FROM public.staff_work_actions WHERE kind='reception' AND state<>'done'))
) AS state;"""

BEFORE_SQL = r"""CREATE TEMP TABLE das_replaced_before ON COMMIT DROP AS SELECT s.signature,p.oid,p.proacl acl,p.proowner owner,p.proconfig config
 FROM unnest(ARRAY[""" + REPLACED + r"""]) s(signature) JOIN pg_proc p ON p.oid=('public.'||s.signature)::regprocedure;
CREATE TEMP TABLE das_view_before ON COMMIT DROP AS SELECT pg_get_viewdef('public.client_colis'::regclass,true) definition,relacl,relowner,reloptions
 FROM pg_class WHERE oid='public.client_colis'::regclass;"""

INVARIANTS_SQL = r"""DO $$
DECLARE item record; old record;
BEGIN
 IF EXISTS ((SELECT * FROM das_before EXCEPT SELECT * FROM das_after) UNION ALL (SELECT * FROM das_after EXCEPT SELECT * FROM das_before)) THEN
  RAISE EXCEPTION 'Departure release modified existing business data'; END IF;
 IF EXISTS(SELECT 1 FROM public.colis WHERE depart_souhaite IS NOT NULL) THEN RAISE EXCEPTION 'The release must not write any desired day'; END IF;
 SELECT * INTO old FROM das_view_before;
 IF pg_get_viewdef('public.client_colis'::regclass,true)<>old.definition OR position('depart_souhaite' IN pg_get_viewdef('public.client_colis'::regclass,true))>0
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid='public.client_colis'::regclass AND (relacl,relowner,reloptions) IS DISTINCT FROM (old.relacl,old.relowner,old.reloptions)) THEN
  RAISE EXCEPTION 'Client projection changed: the desired day must stay staff-only'; END IF;
 FOR item IN SELECT * FROM das_replaced_before LOOP
  IF (SELECT (proacl,proowner,proconfig) IS DISTINCT FROM (item.acl,item.owner,item.config) OR NOT prosecdef FROM pg_proc WHERE oid=item.oid) THEN
   RAISE EXCEPTION 'Replaced function lost its owner, grants, configuration or definer security: %',item.signature; END IF;
 END LOOP;
END $$;"""

POST_CHECKS_SQL = r"""DO $$
DECLARE fn text; owner oid:=(SELECT proowner FROM pg_proc WHERE oid='public.assign_colis_departure(uuid,uuid,timestamptz)'::regprocedure);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.colis'::regclass AND attname='depart_souhaite' AND atttypid='date'::regtype AND NOT attnotnull AND NOT attisdropped)
  OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='colis' AND indexname='colis_depart_souhaite' AND indexdef LIKE '%(depart_souhaite)%WHERE (depart_souhaite IS NOT NULL)%')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.colis'::regclass AND tgname='guard_colis_departure_wish' AND tgenabled='O' AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'Desired day column, partial index or write guard missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.client_colis'::regclass AND attname='depart_souhaite') THEN RAISE EXCEPTION 'The client view exposes the desired day'; END IF;
 IF has_function_privilege('anon','public.departure_default_closing(date)','EXECUTE') OR NOT has_function_privilege('authenticated','public.departure_default_closing(date)','EXECUTE')
  OR (SELECT prosecdef OR provolatile<>'s' OR proowner<>owner OR NOT proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid='public.departure_default_closing(date)'::regprocedure) THEN
  RAISE EXCEPTION 'Unexpected closing helper security'; END IF;
 FOREACH fn IN ARRAY ARRAY['set_colis_departure_wish(uuid,date,timestamptz)','create_departure_for_colis(uuid,date,timestamptz)'] LOOP
  IF has_function_privilege('anon','public.'||fn,'EXECUTE') OR has_function_privilege('service_role','public.'||fn,'EXECUTE') OR NOT has_function_privilege('authenticated','public.'||fn,'EXECUTE')
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner FROM pg_proc WHERE oid=('public.'||fn)::regprocedure) THEN
   RAISE EXCEPTION 'Unexpected staff command security: %',fn; END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['_colis_destination(colis)','_departure_for_day(colis,date)','_colis_departure_closing(colis)','_consent_relance_open(timestamptz)',
  '_reception_work_hint(colis)','guard_colis_departure_wish()'] LOOP
  IF has_function_privilege('anon','public.'||fn,'EXECUTE') OR has_function_privilege('authenticated','public.'||fn,'EXECUTE') OR has_function_privilege('service_role','public.'||fn,'EXECUTE')
   OR NOT (SELECT proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner FROM pg_proc WHERE oid=('public.'||fn)::regprocedure) THEN
   RAISE EXCEPTION 'Unexpected private helper security: %',fn; END IF;
 END LOOP;
 IF position('depart_souhaite=CASE WHEN p_envoi_id IS NULL THEN depart_souhaite END' IN pg_get_functiondef('public.assign_colis_departure(uuid,uuid,timestamptz)'::regprocedure))=0
  OR position('departure:=_departure_for_day(c,c.depart_souhaite)' IN pg_get_functiondef('public._apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)'::regprocedure))=0
  OR position('reception_hint:=_reception_work_hint(c)' IN pg_get_functiondef('public.sync_staff_work_actions(uuid)'::regprocedure))=0
  OR position('w.action_hint IS DISTINCT FROM _reception_work_hint(c)' IN pg_get_functiondef('public.refresh_staff_work_actions()'::regprocedure))=0 THEN
  RAISE EXCEPTION 'A replaced function does not carry the reviewed body'; END IF;
 IF has_function_privilege('authenticated','public._apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.sync_staff_work_actions(uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.assign_colis_departure(uuid,uuid,timestamptz)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.refresh_staff_work_actions()','EXECUTE') THEN RAISE EXCEPTION 'Replaced functions changed grants'; END IF;
 -- The documented « clôture mercredi 17 h » on fixed dates, both daylight-saving weeks.
 IF public.departure_default_closing('2026-10-22')<>'2026-10-21 15:00:00+00' OR public.departure_default_closing('2026-10-29')<>'2026-10-28 16:00:00+00'
  OR public.departure_default_closing('2026-03-26')<>'2026-03-25 16:00:00+00' OR public.departure_default_closing('2026-04-02')<>'2026-04-01 15:00:00+00' THEN
  RAISE EXCEPTION 'Unexpected Wednesday 17:00 Paris closing'; END IF;
 -- Every open reception task gets a computable hint (read only).
 PERFORM public._reception_work_hint(c) FROM public.colis c WHERE NOT coalesce(c.archive,false) AND c.statut IN ('receptionne','mesure','attente_feu_vert');
END $$;"""


def query(sql, readonly=True):
    return request('/database/query', 'POST', {'query': sql, 'read_only': readonly})


def digest():
    return hashlib.sha256(FILE.read_bytes()).hexdigest()


def save(name, value):
    FOLDER.mkdir(mode=0o700, parents=True, exist_ok=True)
    FOLDER.chmod(0o700)
    path = FOLDER / name
    path.write_text(json.dumps(value, indent=2))
    path.chmod(0o600)


def load(name):
    return json.loads((FOLDER / name).read_text())


def check_hash(name):
    if load(name)['sha256'] != digest():
        raise RuntimeError('Migration changed: repeat preflight and rehearsal.')


def fingerprints_sql():
    # The 17 business tables of the previous releases; the new nullable colis column is excluded on both sides.
    parts = []
    for table in TABLES:
        row = "(to_jsonb(t)-'depart_souhaite')" if table == 'colis' else 'to_jsonb(t)'
        parts.append("SELECT '" + table + "'::text table_name,count(*) row_count,"
                     "md5(coalesce(string_agg(md5(" + row + "::text),'' ORDER BY md5(" + row + "::text)),'')) fingerprint FROM public." + table + ' t')
    return '\nUNION ALL\n'.join(parts)


def state():
    return query(PREFLIGHT_SQL)[0]['state']


def baseline_problems(current):
    problems = []
    if current['registered']:
        problems.append('version already registered')
    if current['existing_new_objects']:
        problems.append('objects of this release already exist: ' + ', '.join(current['existing_new_objects']))
    replaced = {f['signature']: f for f in current['replaced']}
    for signature, expected in EXPECTED_SOURCE.items():
        if not replaced[signature]['present'] or replaced[signature]['md5'] != expected:
            problems.append('production source differs from the reviewed baseline: ' + signature)
    missing = [name for name, present in current['dependencies'].items() if name != 'destinations' and not present]
    if missing:
        problems.append('missing dependencies: ' + ', '.join(missing))
    if not {'971', '972', '974', '976'} <= set(current['dependencies']['destinations']):
        problems.append('unexpected destinations')
    return problems


def summary(current):
    reports = current['reports']
    return {'duplicate_departures': len(reports['duplicate_departures']), 'invalid_assignments': len(reports['invalid_assignments']),
            'envoi_reference_counter': reports['envoi_reference_counter'], 'open_reception_actions': reports['open_reception_actions']}


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
                      'reports': summary(current)}, indent=2))


def transaction_sql(register=False):
    migration = FILE.read_text()
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    sql += 'CREATE TEMP TABLE das_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += BEFORE_SQL + '\n'
    sql += migration + '\n'
    sql += 'CREATE TEMP TABLE das_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
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
    return (current['replaced'] == before['replaced'] and current['view'] == before['view']
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
    previous = {f['signature']: f for f in before['replaced']}
    replaced = {f['signature']: f for f in current['replaced']}
    for signature, marker in MARKERS.items():
        function = replaced[signature]
        assert marker in function['definition'], signature
        for key in ['acl', 'owner', 'security_definer', 'config', 'anon', 'authenticated', 'service']:
            assert function[key] == previous[signature][key], signature + ' ' + key
    assert current['view'] == before['view']
    assert sorted(name.split(' ', 1)[0] for name in current['existing_new_objects']) == sorted(
        ['column', 'index', 'trigger'] + ['function'] * len(NEW_FUNCTIONS))
    # The Management API read-only mode rejects DO blocks: run the read-only checks in a rolled-back transaction.
    query('BEGIN;\n' + POST_CHECKS_SQL + '\nROLLBACK;', False)
    save('verified.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current, 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'registered': VERSION, 'sha256': digest(), 'replaced_functions': len(MARKERS), 'new_functions': len(NEW_FUNCTIONS),
                      'client_view': 'unchanged', 'grants_and_triggers': 'as reviewed'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
