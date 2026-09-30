"""Scoped additive customer payment-return release; no remote work at import.

Uses the existing project-specific management helper without exporting credentials.
The migration never populates capabilities or modifies existing payments/dossiers.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request

ROOT = Path(__file__).resolve().parents[3]
FOLDER = ROOT / '.deployment-backups/2026-09-30-payment-return'
FILE = ROOT / 'pinta/supabase/migrations/20260930000001_payment_return.sql'
VERSION = '20260930000001'
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
        row = "(to_jsonb(t)-ARRAY['return_token_hash','return_token_expires_at'])" if table == 'payment_intents' else 'to_jsonb(t)'
        parts.append("SELECT '" + table + "'::text table_name,count(*) row_count,"
                     "md5(coalesce(string_agg(md5(" + row + "::text),'' ORDER BY md5(" + row + "::text)),'')) fingerprint FROM public." + table + ' t')
    return '\nUNION ALL\n'.join(parts)


def schema_sql():
    return """SELECT
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.attnum) FROM (
        SELECT a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,
          pg_get_expr(d.adbin,d.adrelid) default_value,col_description(a.attrelid,a.attnum) comment
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid='public.payment_intents'::regclass AND a.attnum>0 AND NOT a.attisdropped
      ) x) columns,
      (SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname)
        FROM pg_constraint WHERE conrelid='public.payment_intents'::regclass) constraints,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.indexname) FROM (SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='payment_intents') x) indexes,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.policyname) FROM (SELECT * FROM pg_policies WHERE schemaname='public' AND tablename='payment_intents') x) policies,
      (SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'acl',relacl) FROM pg_class WHERE oid='public.payment_intents'::regclass) table_access
    """


def functions_sql():
    return """SELECT p.proname,pg_get_userbyid(p.proowner) owner,
      pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,
      p.proacl acl,p.prosecdef security_definer,p.proconfig config,p.provolatile volatility,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='get_payment_return' ORDER BY p.proname"""


def preflight():
    if (FOLDER / 'applied.json').exists():
        raise RuntimeError('Already applied; preserve original backup and use verify.')
    if query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'"):
        raise RuntimeError('Migration already registered; do not replace its backup.')
    functions = query(functions_sql())
    schema = query(schema_sql())
    if functions or any(c['attname'].startswith('return_token_') for c in schema[0]['columns']):
        raise RuntimeError('Return function or columns already exist without registration.')
    value = {'at': datetime.now(timezone.utc).isoformat(), 'sha256': digest(),
             'functions': functions, 'schema': schema, 'fingerprints': query(fingerprints_sql())}
    save('before.json', value)
    print(json.dumps({'backup': 'private before.json', 'sha256': digest(), 'tables': len(value['fingerprints'])}))


def invariant_sql():
    return """DO $$ DECLARE f record; BEGIN
      IF EXISTS ((SELECT * FROM deployment_return_before EXCEPT SELECT * FROM deployment_return_after)
                 UNION ALL (SELECT * FROM deployment_return_after EXCEPT SELECT * FROM deployment_return_before)) THEN
        RAISE EXCEPTION 'Return migration unexpectedly modified existing business or notification data';
      END IF;
      IF EXISTS(SELECT 1 FROM payment_intents WHERE return_token_hash IS NOT NULL OR return_token_expires_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Return migration must not create or rotate existing payment capabilities';
      END IF;
      SELECT p.* INTO STRICT f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='get_payment_return';
      IF NOT f.prosecdef OR f.provolatile<>'s' OR NOT f.proconfig @> ARRAY['search_path=public, pg_temp']
        OR has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE')
        OR NOT has_function_privilege('service_role',f.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'Unsafe customer receipt function grants or execution mode';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='payment_intents'::regclass AND conname='payment_intents_return_token_pair')
       OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='payment_intents_return_token_unique') THEN
        RAISE EXCEPTION 'Missing capability constraint or unique index';
      END IF;
    END; $$;"""


def transaction_sql(register=False):
    sql = FILE.read_text()
    result = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    result += 'CREATE TEMP TABLE deployment_return_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    result += sql + '\n'
    result += 'CREATE TEMP TABLE deployment_return_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    result += invariant_sql() + '\n'
    if register:
        result += "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + VERSION + "','payment_return',ARRAY['" + sql.replace("'", "''") + "']);\n"
        result += "NOTIFY pgrst,'reload schema'; COMMIT;"
    else:
        result += 'ROLLBACK;'
    return result


def rehearse():
    check_hash('before.json')
    before = json.loads((FOLDER / 'before.json').read_text())
    query(transaction_sql(), False)
    if query(schema_sql()) != before['schema'] or query(functions_sql()) != before['functions']:
        raise RuntimeError('Schema or functions differ after rollback rehearsal.')
    save('rehearsed.json', {'sha256': digest(), 'success': True, 'rolled_back': True,
                           'business_data_unchanged_in_transaction': True})
    print('Return migration rehearsed; data preserved and schema rollback verified.')


def apply():
    check_hash('before.json')
    check_hash('rehearsed.json')
    if query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'"):
        raise RuntimeError('Already applied; use verify.')
    before = json.loads((FOLDER / 'before.json').read_text())
    if query(schema_sql()) != before['schema'] or query(functions_sql()) != before['functions']:
        raise RuntimeError('Source schema changed since preflight; repeat preparation.')
    query(transaction_sql(True), False)
    save('applied.json', {'at': datetime.now(timezone.utc).isoformat(), 'sha256': digest(),
                         'success': True, 'business_data_unchanged_in_transaction': True})
    print('Return migration committed and registered; original payment data preserved.')


def verify():
    check_hash('applied.json')
    registered = query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'")
    functions = query(functions_sql())
    schema = query(schema_sql())
    assert registered == [{'version': VERSION}], 'Migration registration missing'
    assert len(functions) == 1, 'Unexpected function overloads'
    function = functions[0]
    assert function['security_definer'] and function['volatility'] == 's', 'Receipt must remain read-only'
    assert not function['anon_execute'] and not function['authenticated_execute'] and function['service_execute'], 'Unexpected receipt access'
    assert 'search_path=public, pg_temp' in function['config'], 'Unsafe function search path'
    before = json.loads((FOLDER / 'before.json').read_text())['schema'][0]
    after = schema[0]
    assert after['policies'] == before['policies'] and after['table_access'] == before['table_access'], 'Existing table access changed'
    assert [c for c in after['columns'] if not c['attname'].startswith('return_token_')] == before['columns'], 'Existing payment columns changed'
    assert len(after['columns']) == len(before['columns']) + 2, 'Missing capability columns'
    assert [c for c in after['constraints'] if c['name'] != 'payment_intents_return_token_pair'] == before['constraints'], 'Existing constraints changed'
    assert [i for i in after['indexes'] if i['indexname'] != 'payment_intents_return_token_unique'] == before['indexes'], 'Existing indexes changed'
    save('verified.json', {'at': datetime.now(timezone.utc).isoformat(), 'sha256': digest(),
         'functions': functions, 'schema': schema, 'fingerprints': query(fingerprints_sql()),
         'business_data_unchanged_during_apply': True})
    print(json.dumps({'registered': VERSION, 'service_only_readonly_rpc': True, 'columns_added': 2,
                      'business_data_unchanged_during_apply': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
