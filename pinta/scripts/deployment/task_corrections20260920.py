"""Scoped, reviewable release: back up, rehearse, apply, verify. Never log credentials.

Uses the existing CLI login through management.py. Private backups are gitignored.
No client messages, account creation, provider settings or historical records removed.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request

ROOT = Path(__file__).resolve().parents[3]
FOLDER = ROOT / '.deployment-backups/2026-09-20-task-corrections'
FILES = [ROOT / 'pinta/supabase/migrations/20260920000001_task_corrections.sql']
FUNCTIONS = ['correct_colis_task', 'queue_message', 'telegram_client_decision',
             'client_decision', 'confirm_payplug_payment', 'revert_colis',
             'save_preparation_measurements', 'invalidate_preparation_composition',
             'guard_legacy_payplug_snapshot', 'record_payplug_cancellation', 'stamp_colis_revision']


def query(sql, readonly=True):
    return request('/database/query', 'POST', {'query': sql, 'read_only': readonly})


def save(name, value):
    FOLDER.mkdir(mode=0o700, parents=True, exist_ok=True)
    FOLDER.chmod(0o700)
    path = FOLDER / name
    path.write_text(json.dumps(value, indent=2))
    path.chmod(0o600)


def hashes():
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in FILES}


def check_hashes(filename):
    previous = json.loads((FOLDER / filename).read_text())
    if previous['hashes'] != hashes():
        raise RuntimeError('Migration changed since preparation; repeat preflight and rehearsal.')


def preflight():
    if (FOLDER / 'applied.json').exists():
        raise RuntimeError('Release already applied; use verify, do not overwrite backup.')
    quoted = ','.join("'" + name + "'" for name in FUNCTIONS)
    result = query("""SELECT
      (SELECT jsonb_agg(x) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8) x) migrations,
      (SELECT jsonb_agg(x) FROM (SELECT p.proname,pg_get_userbyid(p.proowner) owner,pg_get_functiondef(p.oid) definition,p.proacl acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (""" + quoted + """)) x) functions,
      (SELECT pg_get_viewdef('public.client_colis'::regclass,true)) client_projection,
      (SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid))) FROM pg_trigger t WHERE t.tgrelid='public.colis'::regclass AND t.tgname='trg_colis_updated') version_trigger,
      (SELECT jsonb_object_agg(t,c) FROM (SELECT 'colis' t,count(*) c FROM colis UNION ALL SELECT 'factures',count(*) FROM factures UNION ALL SELECT 'clients',count(*) FROM clients UNION ALL SELECT 'lignes',count(*) FROM lignes) x) counts,
      (SELECT jsonb_agg(e.enumlabel) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='type_abonnement') subscription_values
    """)
    save('before.json', {'at': datetime.now(timezone.utc).isoformat(), 'hashes': hashes(), 'database': result})
    print(json.dumps({'backup': 'private before.json', 'migrations': result[0]['migrations'], 'counts': result[0]['counts']}))


def rehearse():
    check_hashes('before.json')
    query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n" + '\n'.join(p.read_text() for p in FILES) + '\nROLLBACK;', False)
    save('rehearsed.json', {'hashes': hashes(), 'success': True, 'rolled_back': True})
    print('Task correction migration rehearsed and rolled back.')


def apply():
    check_hashes('before.json')
    check_hashes('rehearsed.json')
    for p in FILES:
        version, name = p.stem.split('_', 1)
        existing = query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + version + "'")
        if existing:
            raise RuntimeError('Migration already registered: ' + version)
    # DDL and command replacements are applied together; user dossiers are not edited.
    statements = ["BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';"]
    for p in FILES:
        version, name = p.stem.split('_', 1)
        sql = p.read_text()
        statements.extend([sql, "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + version + "','" + name + "',ARRAY['" + sql.replace("'", "''") + "']);"])
    statements.append("NOTIFY pgrst,'reload schema'; COMMIT;")
    query('\n'.join(statements), False)
    save('applied.json', {'at': datetime.now(timezone.utc).isoformat(), 'hashes': hashes(), 'success': True})
    print('Task correction migration committed and registered; API schema reload requested.')


def verify():
    result = query("""SELECT
      (SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations WHERE version='20260920000001') registered,
      (SELECT jsonb_agg(jsonb_build_object('name',p.proname,'security_definer',p.prosecdef,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('correct_colis_task','queue_message','client_decision')) functions,
      (SELECT jsonb_object_agg(t,c) FROM (SELECT 'colis' t,count(*) c FROM colis UNION ALL SELECT 'factures',count(*) FROM factures UNION ALL SELECT 'clients',count(*) FROM clients UNION ALL SELECT 'lignes',count(*) FROM lignes) x) counts,
      (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND ((table_name='colis' AND column_name='consent_request_version') OR (table_name IN ('payment_intents','legacy_payplug_payments') AND column_name='provider_cancelled_at'))) new_columns
    """)
    save('verified.json', result)
    row = result[0]
    assert row['registered'] == ['20260920000001'], 'Missing migration'
    assert len(row['functions'] or []) == 3, 'Missing or unexpected command overload'
    assert all(f['security_definer'] and not f['anon_execute'] and f['authenticated_execute'] for f in row['functions']), 'Unexpected function privileges'
    assert row['new_columns'] == 3, 'Missing correction safeguards'
    print(json.dumps(row))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    args = parser.parse_args()
    globals()[args.operation]()
