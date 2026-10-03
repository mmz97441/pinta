"""Release arrival metadata without rewriting existing dossiers or their dates.

Uses scoped management credentials in memory and private, untracked backups.
An explicit transaction rehearses and compares every existing business field.
"""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import TABLES

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261003000002_reception_dates.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-03-reception-dates'
VERSION = '20261003000002'
FUNCTIONS = ['_reception_dates_from_evidence', 'stamp_reception_dates', 'get_reception_dates']


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


def fingerprints_sql():
    parts = []
    for table in TABLES:
        row = "(to_jsonb(t)-'reception_dates')" if table == 'colis' else 'to_jsonb(t)'
        parts.append("SELECT '" + table + "'::text table_name,count(*) row_count,"
                     "md5(coalesce(string_agg(md5(" + row + "::text),'' ORDER BY md5(" + row + "::text)),'')) fingerprint FROM public." + table + ' t')
    return '\nUNION ALL\n'.join(parts)


def schema():
    return query("""SELECT
      (SELECT jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),
        'definition',pg_get_functiondef(p.oid),'config',p.proconfig,'definer',p.prosecdef,
        'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
        'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
        'service',has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY p.proname)
        FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
        AND p.proname IN ('_reception_dates_from_evidence','stamp_reception_dates','get_reception_dates')) functions,
      (SELECT jsonb_build_object('definition',pg_get_viewdef(c.oid,true),'acl',c.relacl,
        'owner',pg_get_userbyid(c.relowner),'options',c.reloptions) FROM pg_class c WHERE c.oid='public.client_colis'::regclass) view,
      (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull)) FROM pg_attribute a
        WHERE a.attrelid='public.colis'::regclass AND a.attname='reception_dates' AND NOT a.attisdropped) columns,
      (SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)) FROM pg_trigger t
        WHERE t.tgrelid='public.colis'::regclass AND t.tgname='ab_stamp_reception_dates') triggers""")[0]


def preflight():
    if (FOLDER / 'applied.json').exists() or query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'"):
        raise RuntimeError('Already applied; preserve backup and verify.')
    state = schema()
    if state['functions'] or state['columns'] or state['triggers']:
        raise RuntimeError('Unexpected existing arrival metadata objects.')
    save('before.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(),
                        'schema': state, 'fingerprints': query(fingerprints_sql())})
    print('Private baseline saved; 17 business tables protected.')


def check_hash(name):
    if json.loads((FOLDER / name).read_text())['sha256'] != digest():
        raise RuntimeError('Migration changed: repeat preflight and rehearsal.')


def transaction_sql(register=False):
    migration = FILE.read_text()
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    sql += 'CREATE TEMP TABLE arrival_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += "CREATE TEMP TABLE arrival_view_before ON COMMIT DROP AS SELECT pg_get_viewdef('client_colis'::regclass,true) definition,relacl,relowner,reloptions FROM pg_class WHERE oid='client_colis'::regclass;\n"
    sql += migration + '\n'
    sql += 'CREATE TEMP TABLE arrival_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += """DO $$ DECLARE f record; old_view record; BEGIN
      IF EXISTS ((SELECT * FROM arrival_before EXCEPT SELECT * FROM arrival_after)
         UNION ALL (SELECT * FROM arrival_after EXCEPT SELECT * FROM arrival_before)) THEN
        RAISE EXCEPTION 'Arrival metadata release changed existing business data'; END IF;
      IF EXISTS(SELECT 1 FROM colis WHERE reception_dates IS NOT NULL) THEN
        RAISE EXCEPTION 'Migration must not assign historical arrival dates'; END IF;
      SELECT * INTO old_view FROM arrival_view_before;
      IF regexp_replace(pg_get_viewdef('client_colis'::regclass,true),',\\n    (?:colis\\.)?reception_dates(?=\\n   FROM colis)','','g') <> old_view.definition
        OR EXISTS(SELECT 1 FROM pg_class WHERE oid='client_colis'::regclass
          AND (relacl,relowner,reloptions) IS DISTINCT FROM (old_view.relacl,old_view.relowner,old_view.reloptions)) THEN
        RAISE EXCEPTION 'Client projection changed beyond arrival metadata'; END IF;
      FOR f IN SELECT p.* FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
        AND p.proname IN ('_reception_dates_from_evidence','stamp_reception_dates','get_reception_dates') LOOP
        IF NOT f.prosecdef OR NOT f.proconfig @> ARRAY['search_path=public, pg_temp']
          OR has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('service_role',f.oid,'EXECUTE')
          OR has_function_privilege('authenticated',f.oid,'EXECUTE') <> (f.proname='get_reception_dates') THEN
          RAISE EXCEPTION 'Unexpected arrival function security: %',f.proname; END IF;
      END LOOP;
    END $$;
"""
    if register:
        sql += "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + VERSION + "','reception_dates',ARRAY['" + migration.replace("'", "''") + "']);\nNOTIFY pgrst,'reload schema'; COMMIT;"
    else:
        sql += 'ROLLBACK;'
    return sql


def rehearse():
    check_hash('before.json')
    before = json.loads((FOLDER / 'before.json').read_text())
    query(transaction_sql(), False)
    if schema() != before['schema']:
        raise RuntimeError('Rollback did not restore the baseline schema.')
    save('rehearsed.json', {'sha256': digest(), 'rolled_back': True, 'business_data_unchanged': True})
    print('Arrival metadata rehearsed; business data unchanged; rollback verified.')


def apply():
    check_hash('before.json'); check_hash('rehearsed.json')
    if schema() != json.loads((FOLDER / 'before.json').read_text())['schema']:
        raise RuntimeError('Source schema changed after rehearsal.')
    query(transaction_sql(True), False)
    save('applied.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'business_data_unchanged': True})
    print('Arrival metadata committed without rewriting dossiers; schema reload requested.')


def verify():
    check_hash('applied.json')
    assert query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'") == [{'version': VERSION}]
    state = schema()
    assert sorted(f['name'] for f in state['functions']) == sorted(FUNCTIONS)
    assert state['columns'] == [{'name': 'reception_dates', 'type': 'jsonb', 'notnull': False}]
    assert len(state['triggers']) == 1 and state['triggers'][0]['enabled'] == 'O'
    for f in state['functions']:
        assert f['definer'] and 'search_path=public, pg_temp' in f['config']
        assert not f['anon'] and not f['service'] and f['authenticated'] == (f['name'] == 'get_reception_dates')
    previous_view = json.loads((FOLDER / 'before.json').read_text())['schema']['view']
    current_view = dict(state['view'])
    current_view['definition'] = re.sub(r',\n    (?:colis\.)?reception_dates(?=\n   FROM colis)', '', current_view['definition'])
    assert current_view == previous_view
    save('verified.json', {'sha256': digest(), 'schema': state})
    print(json.dumps({'registered': VERSION, 'functions': 3, 'arrival_metadata': True, 'client_projection_preserved': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
