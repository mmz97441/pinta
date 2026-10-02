"""Scoped reception release: private backup, rollback rehearsal and data checks.

No remote operation at import. Uses existing scoped management authentication;
does not create shipments, send notifications or change the PayPlug environment.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import fingerprints_sql

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261001000001_reception_append.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-01-reception-append'
VERSION = '20261001000001'


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


def check_hash(name):
    if json.loads((FOLDER / name).read_text())['sha256'] != digest():
        raise RuntimeError('Migration changed: repeat preflight and rehearsal.')


def functions_sql():
    return """SELECT p.proname,pg_get_userbyid(p.proowner) owner,
      pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,
      p.proacl acl,p.prosecdef security_definer,p.proconfig config,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('queue_message','append_reception_cartons') ORDER BY p.proname"""


def private_table_sql():
    return """SELECT c.relname,c.relrowsecurity,pg_get_userbyid(c.relowner) owner,c.relacl,
      has_table_privilege('anon',c.oid,'SELECT') anon_read,
      has_table_privilege('authenticated',c.oid,'SELECT') authenticated_read,
      has_table_privilege('authenticated',c.oid,'INSERT') authenticated_insert,
      (SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname)
       FROM pg_constraint WHERE conrelid=c.oid) constraints
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='reception_append_receipts'"""


def preflight():
    if (FOLDER / 'applied.json').exists() or query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'"):
        raise RuntimeError('Already applied; preserve backup and use verify.')
    functions = query(functions_sql())
    if len(functions) != 1 or functions[0]['proname'] != 'queue_message' or query(private_table_sql()):
        raise RuntimeError('Unexpected source function or existing private receipt table.')
    save('before.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(),
        'functions': functions, 'private_table': [], 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'private_backup': 'before.json', 'sha256': digest(), 'tables_protected': 17}))


def invariant_sql():
    return """DO $$ DECLARE f record; BEGIN
      IF EXISTS ((SELECT * FROM reception_deploy_before EXCEPT SELECT * FROM reception_deploy_after)
                 UNION ALL (SELECT * FROM reception_deploy_after EXCEPT SELECT * FROM reception_deploy_before)) THEN
        RAISE EXCEPTION 'Reception release modified existing business data';
      END IF;
      IF EXISTS(SELECT 1 FROM reception_append_receipts) THEN RAISE EXCEPTION 'Migration must not create receipt records'; END IF;
      IF has_table_privilege('anon','reception_append_receipts','SELECT') OR has_table_privilege('authenticated','reception_append_receipts','SELECT')
       OR has_table_privilege('authenticated','reception_append_receipts','INSERT') OR has_table_privilege('service_role','reception_append_receipts','SELECT')
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='reception_append_receipts'::regclass) THEN
        RAISE EXCEPTION 'Receipt registry is not private';
      END IF;
      IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('queue_message','append_reception_cartons'))<>2 THEN RAISE EXCEPTION 'Unexpected command overload'; END IF;
      FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('queue_message','append_reception_cartons') LOOP
       IF NOT f.prosecdef OR NOT f.proconfig @> ARRAY['search_path=public, pg_temp'] OR has_function_privilege('anon',f.oid,'EXECUTE')
        OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
        OR has_function_privilege('service_role',f.oid,'EXECUTE')<>(f.proname='queue_message') THEN RAISE EXCEPTION 'Unexpected command security: %',f.proname; END IF;
      END LOOP;
    END; $$;"""


def transaction_sql(register=False):
    sql = FILE.read_text()
    result = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    result += 'CREATE TEMP TABLE reception_deploy_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    result += sql + '\n'
    result += 'CREATE TEMP TABLE reception_deploy_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n' + invariant_sql() + '\n'
    if register:
        result += "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + VERSION + "','reception_append',ARRAY['" + sql.replace("'", "''") + "']);\nNOTIFY pgrst,'reload schema';COMMIT;"
    else:
        result += 'ROLLBACK;'
    return result


def rehearse():
    check_hash('before.json')
    before = json.loads((FOLDER / 'before.json').read_text())
    query(transaction_sql(), False)
    if query(functions_sql()) != before['functions'] or query(private_table_sql()):
        raise RuntimeError('Rollback did not restore function/schema baseline.')
    save('rehearsed.json', {'sha256': digest(), 'success': True, 'rolled_back': True, 'business_data_unchanged': True})
    print('Reception migration rehearsed; 17 table fingerprints unchanged and rollback verified.')


def apply():
    check_hash('before.json'); check_hash('rehearsed.json')
    before = json.loads((FOLDER / 'before.json').read_text())
    if query(functions_sql()) != before['functions'] or query(private_table_sql()):
        raise RuntimeError('Source changed since rehearsal or release already exists.')
    query(transaction_sql(True), False)
    save('applied.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'business_data_unchanged_during_apply': True})
    print('Reception commands committed; existing data unchanged, schema reload requested.')


def verify():
    check_hash('applied.json')
    assert query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'") == [{'version': VERSION}], 'Registration missing'
    functions = query(functions_sql()); table = query(private_table_sql())
    assert len(functions) == 2 and len(table) == 1, 'Unexpected release object set'
    for f in functions:
        assert f['security_definer'] and 'search_path=public, pg_temp' in f['config'], 'Unsafe security mode'
        assert not f['anon_execute'] and f['authenticated_execute'] and f['service_execute'] == (f['proname'] == 'queue_message'), 'Unexpected grants'
        assert '_assert_staff_task_owner' in f['definition'], 'Missing task owner guard'
    assert table[0]['relrowsecurity'] and not table[0]['anon_read'] and not table[0]['authenticated_read'] and not table[0]['authenticated_insert'], 'Registry is exposed'
    save('verified.json', {'sha256': digest(), 'functions': functions, 'private_table': table,
        'fingerprints': query(fingerprints_sql()), 'business_data_unchanged_during_apply': True})
    print(json.dumps({'registered': VERSION, 'commands': 2, 'private_registry': True, 'business_data_preserved': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
