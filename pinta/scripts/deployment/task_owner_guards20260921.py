"""Scoped task-owner guard release with private backup and rollback rehearsal.

No remote call runs at import time. The migration adds a private guard and updates only explicit staff commands; its transaction verifies that existing work,
business data, drafts, payments and notifications remain byte-for-byte equivalent.
Credentials remain in memory through the existing project-scoped management helper.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request

ROOT = Path(__file__).resolve().parents[3]
FOLDER = ROOT / '.deployment-backups/2026-09-21-task-owner-guards'
FILE = ROOT / 'pinta/supabase/migrations/20260921000003_task_owner_guards.sql'
VERSION = '20260921000003'
FUNCTIONS = ['_assert_staff_task_owner', 'mutate_staff_work_action',
             'save_preparation_measurements', 'save_quote', 'save_quote_customs',
             'save_invoice_review', 'classify_invoice_duplicate', 'restore_invoice_duplicate',
             'correct_colis_task', 'confirm_ocr_extraction_current']
QUOTED = ','.join("'" + name + "'" for name in FUNCTIONS)
TABLES = ['colis', 'factures', 'lignes', 'clients', 'envois', 'departure_manifests',
          'invoice_review_drafts', 'quote_versions', 'paiements', 'payment_intents',
          'legacy_payplug_payments', 'messages', 'notifications', 'notification_outbox',
          'staff_work_actions', 'staff_work_preferences', 'audit_actions']


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


def fingerprints_sql():
    parts = []
    for table in TABLES:
        row = 'to_jsonb(t)'
        parts.append("SELECT '" + table + "'::text table_name,count(*) row_count,"
                     "md5(coalesce(string_agg(md5(" + row + "::text),'' ORDER BY md5(" + row + "::text)),'')) fingerprint FROM public." + table + ' t')
    return '\nUNION ALL\n'.join(parts)


def schema_sql():
    return """SELECT
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.attnum) FROM (
        SELECT a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,
          pg_get_expr(d.adbin,d.adrelid) default_value,col_description(a.attrelid,a.attnum) comment
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid='public.staff_work_actions'::regclass AND a.attnum>0 AND NOT a.attisdropped
      ) x) columns,
      (SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname)
        FROM pg_constraint WHERE conrelid='public.staff_work_actions'::regclass) constraints,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.indexname) FROM (SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='staff_work_actions') x) indexes,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.policyname) FROM (SELECT * FROM pg_policies WHERE schemaname='public' AND tablename='staff_work_actions') x) policies,
      (SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'acl',relacl) FROM pg_class WHERE oid='public.staff_work_actions'::regclass) table_access
    """


def functions_sql():
    return """SELECT p.proname,pg_get_userbyid(p.proowner) owner,
      pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,
      p.proacl acl,p.prosecdef security_definer,p.proconfig config,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN (""" + QUOTED + ') ORDER BY p.proname'


def preflight():
    if (FOLDER / 'applied.json').exists():
        raise RuntimeError('Already applied; preserve the original backup and use verify.')
    registered = query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'")
    if registered:
        raise RuntimeError('Migration already registered; do not replace its backup.')
    functions = query(functions_sql())
    schema = query(schema_sql())
    if len(functions) != 9:
        raise RuntimeError('Unexpected source command overloads.')
    if any(function['proname'] == '_assert_staff_task_owner' for function in functions):
        raise RuntimeError('Ownership guard already exists without this registration.')
    if not query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='20260921000002'"):
        raise RuntimeError('Deploy and verify team_task_start (00002) first.')
    value = {'at': datetime.now(timezone.utc).isoformat(), 'sha256': digest(),
             'functions': functions, 'schema': schema, 'fingerprints': query(fingerprints_sql())}
    save('before.json', value)
    print(json.dumps({'backup': 'private before.json', 'sha256': digest(),
                      'tables': len(value['fingerprints']), 'commands': len(functions)}))


def invariant_sql():
    return """DO $$ DECLARE f record; BEGIN
      IF EXISTS ((SELECT * FROM deployment_team_before EXCEPT SELECT * FROM deployment_team_after)
                 UNION ALL (SELECT * FROM deployment_team_after EXCEPT SELECT * FROM deployment_team_before)) THEN
        RAISE EXCEPTION 'Owner-guard migration unexpectedly modified business, task, draft or notification data';
      END IF;
      IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname IN (""" + QUOTED + """))<>10 THEN
        RAISE EXCEPTION 'Unexpected owner guard function set';
      END IF;
      FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN (""" + QUOTED + """) LOOP
        IF NOT f.prosecdef OR NOT f.proconfig @> ARRAY['search_path=public, pg_temp']
          OR has_function_privilege('anon',f.oid,'EXECUTE')
          OR has_function_privilege('authenticated',f.oid,'EXECUTE')<>(f.proname<>'_assert_staff_task_owner') THEN
          RAISE EXCEPTION 'Unexpected owner guard security for %',f.proname;
        END IF;
        IF f.proname NOT IN ('_assert_staff_task_owner','mutate_staff_work_action')
           AND position('_assert_staff_task_owner(' in pg_get_functiondef(f.oid))=0 THEN
          RAISE EXCEPTION 'Missing ownership check for %',f.proname;
        END IF;
      END LOOP;
      IF position('FOR KEY SHARE' in pg_get_functiondef('public.mutate_staff_work_action(uuid,text,integer,jsonb)'::regprocedure))=0 THEN
        RAISE EXCEPTION 'Assignment lock order was not corrected';
      END IF;
    END; $$;"""


def transaction_sql(register=False):
    sql = FILE.read_text()
    # One stable snapshot avoids confusing live staff/client activity with changes
    # made by this migration; PostgreSQL still sees all of this transaction's writes.
    result = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    result += 'CREATE TEMP TABLE deployment_team_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    result += sql + '\n'
    result += 'CREATE TEMP TABLE deployment_team_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    result += invariant_sql() + '\n'
    if register:
        result += "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + VERSION + "','task_owner_guards',ARRAY['" + sql.replace("'", "''") + "']);\n"
        result += "NOTIFY pgrst,'reload schema'; COMMIT;"
    else:
        result += 'ROLLBACK;'
    return result


def rehearse():
    check_hash('before.json')
    before = json.loads((FOLDER / 'before.json').read_text())
    query(transaction_sql(), False)
    # Rehearsal must leave the original schema and all protected commands intact.
    if query(schema_sql()) != before['schema'] or query(functions_sql()) != before['functions']:
        raise RuntimeError('Schema or command definitions differ after rollback rehearsal.')
    save('rehearsed.json', {'sha256': digest(), 'success': True, 'rolled_back': True,
                           'business_data_unchanged_in_transaction': True})
    print('Task-owner guard migration rehearsed, data invariants checked, schema rollback verified.')


def apply():
    check_hash('before.json')
    check_hash('rehearsed.json')
    if query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'"):
        raise RuntimeError('Already applied; use verify.')
    before = json.loads((FOLDER / 'before.json').read_text())
    if query(schema_sql()) != before['schema'] or query(functions_sql()) != before['functions']:
        raise RuntimeError('Source schema changed since preflight; inspect and repeat preparation.')
    query(transaction_sql(True), False)
    save('applied.json', {'at': datetime.now(timezone.utc).isoformat(), 'sha256': digest(),
                         'success': True, 'business_data_unchanged_in_transaction': True})
    print('Task-owner guard migration committed and registered; original data preserved; API reload requested.')


def verify():
    check_hash('applied.json')
    registered = query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'")
    functions = query(functions_sql(), False)
    schema = query(schema_sql())
    assert registered == [{'version': VERSION}], 'Migration registration missing'
    assert len(functions) == 10, 'Unexpected function set'
    for function in functions:
        assert function['security_definer'], 'Unexpected security mode'
        assert not function['anon_execute'], 'Unexpected anonymous access'
        assert function['authenticated_execute'] == (function['proname'] != '_assert_staff_task_owner'), 'Unexpected command access'
        assert 'search_path=public, pg_temp' in function['config'], 'Unsafe function search path'
    before = json.loads((FOLDER / 'before.json').read_text())
    assert schema == before['schema'], 'Unexpected task table schema change'
    for function in functions:
        if function['proname'] not in ['_assert_staff_task_owner', 'mutate_staff_work_action']:
            assert '_assert_staff_task_owner(' in function['definition'], 'Guard missing in ' + function['proname']
        elif function['proname'] == 'mutate_staff_work_action':
            assert 'FOR KEY SHARE' in function['definition'], 'Lock ordering guard missing'
    # This is a post-release snapshot, not an equality assertion: legitimate live
    # operators may have continued work since the migration committed.
    result = {'at': datetime.now(timezone.utc).isoformat(), 'sha256': digest(),
              'registered': registered, 'functions': functions, 'schema': schema,
              'fingerprints': query(fingerprints_sql()), 'business_data_unchanged_during_apply': True}
    save('verified.json', result)
    print(json.dumps({'registered': VERSION, 'commands': len(functions), 'protected_business_commands': 8,
                      'grants_verified': True, 'business_data_unchanged_during_apply': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
