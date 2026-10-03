"""Scoped release of quote edit/payment guards, without changing business data.

Credentials stay in memory. Backups contain function definitions and aggregate
fingerprints only, live privately outside tracked files. No operation at import.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import fingerprints_sql

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261003000001_quote_edit_guards.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-03-quote-edit-guards'
VERSION = '20261003000001'
EXISTING = ['save_preparation_measurements', 'save_quote_customs', 'save_quote']
PRIVATE = ['_assert_unpaid_dossier', '_assert_quote_editable']
RESERVE = 'reserve_payplug_intent'
FUNCTIONS = EXISTING + PRIVATE + [RESERVE]
QUOTED = ','.join("'" + name + "'" for name in FUNCTIONS)


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
      WHERE n.nspname='public' AND p.proname IN (""" + QUOTED + ') ORDER BY p.proname'


def preflight():
    if (FOLDER / 'applied.json').exists() or query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'"):
        raise RuntimeError('Already applied; preserve the original backup and verify.')
    functions = query(functions_sql())
    if sorted(f['proname'] for f in functions) != sorted(EXISTING):
        raise RuntimeError('Unexpected baseline command set.')
    save('before.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(),
                        'functions': functions, 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'private_backup': 'before.json', 'sha256': digest(), 'tables_protected': 17}))


def invariant_sql():
    before = json.loads((FOLDER / 'before.json').read_text())
    # Existing RPC grants are preserved, not replaced by assumptions about a
    # fresh installation. Only the new reservation is service-only.
    service_allowed = [f['proname'] for f in before['functions'] if f['service_execute']] + [RESERVE]
    service_names = ','.join("'" + name + "'" for name in service_allowed)
    return """DO $$ DECLARE f record; BEGIN
      IF EXISTS ((SELECT * FROM quote_edit_before EXCEPT SELECT * FROM quote_edit_after)
        UNION ALL (SELECT * FROM quote_edit_after EXCEPT SELECT * FROM quote_edit_before)) THEN
        RAISE EXCEPTION 'Guard release modified existing business data';
      END IF;
      IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname IN (""" + QUOTED + """))<>6 THEN
        RAISE EXCEPTION 'Unexpected guard command set';
      END IF;
      FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN (""" + QUOTED + """) LOOP
        IF NOT f.prosecdef OR NOT f.proconfig @> ARRAY['search_path=public, pg_temp']
          OR has_function_privilege('anon',f.oid,'EXECUTE')
          OR has_function_privilege('authenticated',f.oid,'EXECUTE') <>
            (f.proname IN ('save_preparation_measurements','save_quote_customs','save_quote'))
          OR has_function_privilege('service_role',f.oid,'EXECUTE') <> (f.proname IN (""" + service_names + """)) THEN
          RAISE EXCEPTION 'Unexpected guard security: %',f.proname;
        END IF;
        IF NOT has_function_privilege(f.proowner,'public._assert_quote_editable(uuid)'::regprocedure,'EXECUTE')
          OR NOT has_function_privilege(f.proowner,'public._assert_unpaid_dossier(uuid)'::regprocedure,'EXECUTE') THEN
          RAISE EXCEPTION 'Command owner cannot call private financial guards: %',f.proname;
        END IF;
      END LOOP;
    END $$;"""


def transaction_sql(register=False):
    migration = FILE.read_text()
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    sql += 'CREATE TEMP TABLE quote_edit_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += migration + '\n'
    sql += 'CREATE TEMP TABLE quote_edit_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += invariant_sql() + '\n'
    if register:
        sql += "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + VERSION + "','quote_edit_guards',ARRAY['" + migration.replace("'", "''") + "']);\nNOTIFY pgrst,'reload schema'; COMMIT;"
    else:
        sql += 'ROLLBACK;'
    return sql


def rehearse():
    check_hash('before.json')
    before = json.loads((FOLDER / 'before.json').read_text())
    query(transaction_sql(), False)
    if query(functions_sql()) != before['functions']:
        raise RuntimeError('Rollback did not restore baseline commands.')
    save('rehearsed.json', {'sha256': digest(), 'success': True, 'rolled_back': True, 'business_data_unchanged': True})
    print('Guard migration rehearsed, business data unchanged, rollback verified.')


def apply():
    check_hash('before.json'); check_hash('rehearsed.json')
    if query(functions_sql()) != json.loads((FOLDER / 'before.json').read_text())['functions']:
        raise RuntimeError('Source changed after rehearsal.')
    query(transaction_sql(True), False)
    save('applied.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'business_data_unchanged_during_apply': True})
    print('Guards committed, business data unchanged, schema reload requested.')


def verify():
    check_hash('applied.json')
    assert query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'") == [{'version': VERSION}]
    functions = query(functions_sql())
    before = {f['proname']: f for f in json.loads((FOLDER / 'before.json').read_text())['functions']}
    assert sorted(f['proname'] for f in functions) == sorted(FUNCTIONS)
    for f in functions:
        assert f['security_definer'] and 'search_path=public, pg_temp' in f['config']
        assert not f['anon_execute'] and f['authenticated_execute'] == (f['proname'] in EXISTING)
        assert f['service_execute'] == (before[f['proname']]['service_execute'] if f['proname'] in before else f['proname'] == RESERVE)
        if f['proname'] in EXISTING:
            assert f['acl'] == before[f['proname']]['acl'] and f['owner'] == before[f['proname']]['owner']
            assert '_assert_staff_task_owner' in f['definition']
            assert '_assert_quote_editable' in f['definition']
    save('verified.json', {'sha256': digest(), 'functions': functions, 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'registered': VERSION, 'functions': len(functions), 'private_guards': True, 'reservation_service_only': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
