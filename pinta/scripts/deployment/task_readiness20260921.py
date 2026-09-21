"""Scoped release of task readiness; private backup, rollback rehearsal, verification.

Preserves client records, consent, payments and notifications. The migration only
reprojects existing work in authorized/preparation dossiers after replacing commands.
The account credential stays in memory through management.py.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request

ROOT = Path(__file__).resolve().parents[3]
FOLDER = ROOT / '.deployment-backups/2026-09-21-task-readiness'
FILE = ROOT / 'pinta/supabase/migrations/20260921000001_task_readiness.sql'
VERSION = '20260921000001'
FUNCTIONS = ['save_quote', 'save_quote_customs', 'save_preparation_measurements',
             'sync_staff_work_actions', 'preparation_measurements_ready']
QUOTED = ','.join("'" + name + "'" for name in FUNCTIONS)


def query(sql, readonly=True):
    return request('/database/query', 'POST', {'query': sql, 'read_only': readonly})


def save(name, value):
    FOLDER.mkdir(mode=0o700, parents=True, exist_ok=True)
    FOLDER.chmod(0o700)
    path = FOLDER / name
    path.write_text(json.dumps(value, indent=2))
    path.chmod(0o600)


def digest():
    return hashlib.sha256(FILE.read_bytes()).hexdigest()


def check_hash(name):
    if json.loads((FOLDER / name).read_text())['sha256'] != digest():
        raise RuntimeError('Migration changed: repeat preflight and rehearsal.')


def preflight():
    if (FOLDER / 'applied.json').exists():
        raise RuntimeError('Already applied; use verify, preserve the original backup.')
    result = query("""SELECT
      (SELECT jsonb_agg(x) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5) x) migrations,
      (SELECT jsonb_agg(x) FROM (SELECT p.proname,pg_get_userbyid(p.proowner) owner,pg_get_functiondef(p.oid) definition,p.proacl acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (""" + QUOTED + """)) x) functions,
      (SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM staff_work_actions a JOIN colis c ON c.id=a.colis_id WHERE NOT c.archive AND c.statut IN ('autorise','en_preparation')) affected_work_before,
      (SELECT jsonb_object_agg(t,c) FROM (SELECT 'colis' t,count(*) c FROM colis UNION ALL SELECT 'factures',count(*) FROM factures UNION ALL SELECT 'clients',count(*) FROM clients UNION ALL SELECT 'lignes',count(*) FROM lignes) x) counts
    """)
    row = result[0]
    assert VERSION not in [m['version'] for m in row['migrations']], 'Migration already applied'
    assert len(row['functions'] or []) == 4, 'Unexpected source command set'
    save('before.json', {'at': datetime.now(timezone.utc).isoformat(), 'sha256': digest(), 'database': result})
    print(json.dumps({'backup': 'private before.json', 'sha256': digest(), 'counts': row['counts']}))


def rehearse():
    check_hash('before.json')
    query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n" + FILE.read_text() + '\nROLLBACK;', False)
    save('rehearsed.json', {'sha256': digest(), 'success': True, 'rolled_back': True})
    print('Task readiness migration rehearsed and rolled back.')


def apply():
    check_hash('before.json')
    check_hash('rehearsed.json')
    if query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'"):
        raise RuntimeError('Already applied; use verify.')
    sql = FILE.read_text()
    registration = "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + VERSION + "','task_readiness',ARRAY['" + sql.replace("'", "''") + "']);"
    query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n" + sql + '\n' + registration + "\nNOTIFY pgrst,'reload schema'; COMMIT;", False)
    save('applied.json', {'at': datetime.now(timezone.utc).isoformat(), 'sha256': digest(), 'success': True})
    print('Task readiness committed and registered; API schema reload requested.')


def verify():
    # The API's generic read-only role deliberately cannot execute application
    # helpers. Use the deployment connection for this SELECT, without any write.
    result = query("""SELECT
      (SELECT jsonb_agg(version) FROM supabase_migrations.schema_migrations WHERE version='""" + VERSION + """') registered,
      (SELECT jsonb_agg(jsonb_build_object('name',p.proname,'security_definer',p.prosecdef,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (""" + QUOTED + """)) functions,
      (SELECT count(*) FROM staff_work_actions a JOIN colis c ON c.id=a.colis_id WHERE NOT c.archive AND c.statut IN ('autorise','en_preparation') AND a.kind='quote' AND a.state='ready' AND NOT preparation_measurements_ready(c)) ready_quotes_without_preparation,
      (SELECT jsonb_object_agg(t,c) FROM (SELECT 'colis' t,count(*) c FROM colis UNION ALL SELECT 'factures',count(*) FROM factures UNION ALL SELECT 'clients',count(*) FROM clients UNION ALL SELECT 'lignes',count(*) FROM lignes) x) counts
    """, False)
    save('verified.json', result)
    row = result[0]
    assert row['registered'] == [VERSION], 'Missing migration registration'
    assert len(row['functions'] or []) == 5, 'Missing or unexpected command overload'
    for function in row['functions']:
        assert not function['anon_execute'], 'Unexpected anonymous access'
        assert function['authenticated_execute'] == (function['name'] != 'sync_staff_work_actions'), 'Unexpected command access'
        assert function['security_definer'] == (function['name'] != 'preparation_measurements_ready'), 'Unexpected security mode'
    assert row['ready_quotes_without_preparation'] == 0, 'Inconsistent task projection'
    print(json.dumps(row))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
