"""Publish read-only customs suggestions after an identical rolled-back rehearsal."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from management import request

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / 'pinta/supabase/migrations/20260917000006_customs_suggestions.sql'
FOLDER = ROOT / '.deployment-backups/2026-09-17-customs-suggestions'
VERSION, NAME = MIGRATION.stem.split('_', 1)


def query(sql, readonly=True):
    return request('/database/query', 'POST', {'query': sql, 'read_only': readonly})


def digest():
    return hashlib.sha256(MIGRATION.read_bytes()).hexdigest()


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def record(name, data):
    FOLDER.mkdir(mode=0o700, parents=True, exist_ok=True)
    FOLDER.chmod(0o700)
    path = FOLDER / name
    path.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'hash': digest(), **data}, indent=2))
    path.chmod(0o600)


def checked(name):
    if json.loads((FOLDER / name).read_text())['hash'] != digest():
        raise RuntimeError('Migration changed: repeat the backup and rehearsal.')


def registered():
    return query('SELECT version FROM supabase_migrations.schema_migrations WHERE version=' + literal(VERSION))


def preflight():
    if registered() or (FOLDER / 'applied.json').exists():
        raise RuntimeError('Already registered: use verify.')
    data = query("""SELECT
      (SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'customs_%' OR p.proname='suggest_customs_tariffs')) functions,
      (SELECT count(*) FROM customs_tariffs) catalogue_count,
      (SELECT count(*) FROM lignes WHERE custom_duty IS NOT NULL) classifications
    """)
    if data[0]['catalogue_count'] < 10000:
        raise RuntimeError('Customs reference prerequisite missing.')
    record('before.json', {'database': data})
    print('Private preflight backup saved; reference prerequisite present.')


def transaction(commit):
    sql = MIGRATION.read_text()
    return '\n'.join([
        "BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='40s';",
        sql,
        'INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (' + literal(VERSION) + ',' + literal(NAME) + ',ARRAY[' + literal(sql) + ']);',
        "DO $verify$ BEGIN IF to_regprocedure('public.suggest_customs_tariffs(jsonb,text)') IS NULL THEN RAISE EXCEPTION 'Suggestion command missing'; END IF; END $verify$;",
        "NOTIFY pgrst,'reload schema';", 'COMMIT;' if commit else 'ROLLBACK;',
    ])


def rehearse():
    checked('before.json')
    if registered():
        raise RuntimeError('Already registered: use verify.')
    query(transaction(False), False)
    record('rehearsed.json', {'rolled_back': True})
    print('Suggestions migration and journal rehearsed, then rolled back.')


def apply():
    checked('before.json'); checked('rehearsed.json')
    if registered():
        raise RuntimeError('Already registered: inspect before retrying.')
    query(transaction(True), False)
    record('applied.json', {'committed': True})
    print('Suggestions migration committed; schema reload requested.')


def verify():
    checked('applied.json'); checked('rehearsed.json')
    row = query("""SELECT p.prosecdef security_definer,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
      FROM pg_proc p WHERE p.oid='public.suggest_customs_tariffs(jsonb,text)'::regprocedure
    """)[0]
    assert registered() and row == {'security_definer': True, 'anon_execute': False, 'authenticated_execute': True}
    record('verified.json', {'permissions': row})
    print(json.dumps({'registered': VERSION, 'permissions': row}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
