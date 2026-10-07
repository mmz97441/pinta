"""Release of the consent relance follow-up (final review of lot 3a, 2026-10-07) without rewriting business data.

Operations, each run separately by the lead and only with the user's explicit go-ahead:
  preflight  read-only: refuses when already registered, when an object of the release exists, when one of the three
             replaced functions differs from the reviewed repository baseline (md5 of pg_get_functiondef), or when a
             function the new bodies and triggers rely on differs from it; reports the awaited consents a recent
             request or relance now follows up, the reception hints that change at the next refresh and the desired
             days with a planned departure. Saves everything privately (folder 0700, files 0600). The read-only
             Management API role cannot EXECUTE application functions: every report inlines its predicate.
  rehearse   write transaction rolled back: migration plus invariants (business data unchanged, replaced functions keep
             owner/grants/configuration, the functions they rely on and the other triggers unchanged) and the post checks.
  apply      same transaction, registered in schema_migrations, schema reload requested, committed.
  verify     read-only checks, run in BEGIN … ROLLBACK because the read-only mode rejects DO blocks.
The migration SHA-256 is recorded at every step. Credentials stay in memory (management.py); nothing runs at import and
no secret is printed. No Edge function changes; the front ships its matching rules after apply. Lot 3b (20261006000002,
register_telegram_document only) may be registered before this release: it touches none of these functions. Open
reception tasks take the new rules at their next synchronisation or refresh (refresh_staff_work_actions, called by the
team's work list), never by a rewrite here.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import TABLES

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261007000001_consent_relance_followup.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-07-consent-relance-followup'
VERSION = '20261007000001'
NAME = 'consent_relance_followup'
# Replaced whole by the migration: production must run the reviewed source (local replay up to 20261006000001,
# PostgreSQL 17, the method that reproduces the four baselines of departure_any_step20261006.py).
EXPECTED_SOURCE = {
    '_colis_departure_closing(colis)': '354c10a7c1820e4f199019c612b3594a',
    '_reception_work_hint(colis)': 'dcc050a8d8b3f356cbba4f85819d0fc9',
    'sync_staff_work_actions(uuid)': '8f4d875a50513c561c0ed8d1306efdf8',
}
# Called by the new bodies, or relied upon to bring the relance back (refresh): kept as reviewed.
UNCHANGED_SOURCE = {
    '_consent_relance_open(timestamptz)': '47c4a5b291db158d25b54bb4de8e2f03',
    '_departure_for_day(colis,date)': 'f0b001515f8f80fed2075cd818e3ec75',
    'departure_default_closing(date)': '771ff104c23ee77cd353f65e81354a75',
    'refresh_staff_work_actions()': '0c22357b2f05fa6155af2d9e35d509b9',
}
# A substring that proves the new body of each replaced function.
MARKERS = {
    '_colis_departure_closing(colis)': 'e.id=_departure_for_day(c,c.depart_souhaite)',
    '_reception_work_hint(colis)': 'Mesurer puis demander l’accord avant la clôture du départ',
    'sync_staff_work_actions(uuid)': 'AND NOT (c.attente_client_date IS NULL AND relance_open AND followup IS NULL)',
}
NEW_FUNCTIONS = ['_consent_followup_until', 'trigger_sync_consent_followup']
# The deparsed definition of each new trigger (pg_get_triggerdef, PostgreSQL 17).
TRIGGERS = {
    'z_sync_consent_request_work': "CREATE TRIGGER z_sync_consent_request_work AFTER INSERT ON public.messages FOR EACH ROW WHEN ((new.template = ANY (ARRAY['demande_feu_vert'::text, 'relance_feu_vert'::text]))) EXECUTE FUNCTION trigger_sync_consent_followup()",
    'z_sync_consent_request_failure': "CREATE TRIGGER z_sync_consent_request_failure AFTER UPDATE OF statut ON public.messages FOR EACH ROW WHEN (((new.template = ANY (ARRAY['demande_feu_vert'::text, 'relance_feu_vert'::text])) AND (old.statut IS DISTINCT FROM new.statut) AND ((old.statut = 'echec'::statut_message) OR (new.statut = 'echec'::statut_message)))) EXECUTE FUNCTION trigger_sync_consent_followup()",
    'z_sync_consent_delivery_work': "CREATE TRIGGER z_sync_consent_delivery_work AFTER UPDATE OF status ON public.notification_outbox FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) AND ((old.status = ANY (ARRAY['failed'::text, 'cancelled'::text])) OR (new.status = ANY (ARRAY['failed'::text, 'cancelled'::text]))))) EXECUTE FUNCTION trigger_sync_consent_followup()",
}
REPLACED = ','.join("'" + signature + "'" for signature in sorted(EXPECTED_SOURCE))
DEPENDED = ','.join("'" + signature + "'" for signature in sorted(UNCHANGED_SOURCE))
CREATED = ','.join("'" + name + "'" for name in NEW_FUNCTIONS)
TRIGGER_NAMES = ','.join("'" + name + "'" for name in sorted(TRIGGERS))
QUOTE = "'"

# The predicates below are those of _consent_followup_until, _departure_for_day and _colis_destination, inlined.
PREFLIGHT_SQL = r"""WITH replaced AS (
 SELECT s.signature,p.oid,pg_get_functiondef(p.oid) definition FROM unnest(ARRAY[""" + REPLACED + r"""]) s(signature)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||s.signature)),
depended AS (
 SELECT s.signature,p.oid,pg_get_functiondef(p.oid) definition FROM unnest(ARRAY[""" + DEPENDED + r"""]) s(signature)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||s.signature)),
open_dossiers AS (SELECT c.* FROM public.colis c WHERE NOT coalesce(c.archive,false)
 AND c.statut NOT IN ('expedie','transit','dedouanement','arrive','livraison','livre','annule')),
latest_requests AS (SELECT c.id colis_id,c.ref,c.statut,c.attente_client_date,l.id message_id,l.created_at,l.template,l.statut message_statut,
  EXISTS(SELECT 1 FROM public.notification_outbox o WHERE o.message_id=l.id AND o.status IN ('failed','cancelled')) undelivered
 FROM open_dossiers c CROSS JOIN LATERAL (SELECT m.id,m.created_at,m.template,m.statut FROM public.messages m
  WHERE m.colis_id=c.id AND m.template IN ('demande_feu_vert','relance_feu_vert') ORDER BY m.created_at DESC,m.id DESC LIMIT 1) l),
followed AS (SELECT r.*,w.state task_state,w.action_hint FROM latest_requests r LEFT JOIN public.staff_work_actions w ON w.colis_id=r.colis_id AND w.kind='reception'
 WHERE r.statut='attente_feu_vert' AND r.attente_client_date IS NULL AND r.created_at+interval '24 hours'>now()
  AND r.message_statut IS DISTINCT FROM 'echec' AND NOT r.undelivered),
wishes AS (SELECT c.ref,c.statut,c.depart_souhaite,e.ref envoi_ref,e.loading_closes_at,
  ((e.date_depart-((extract(isodow FROM e.date_depart)::integer+3)%7+1))+time '17:00') AT TIME ZONE 'Europe/Paris' wednesday_closing
 FROM open_dossiers c JOIN public.clients cl ON cl.id=c.client_id
 CROSS JOIN LATERAL (SELECT e.* FROM public.envois e WHERE e.date_depart=c.depart_souhaite
  AND e.destination_code=CASE WHEN c.paiement_date IS NOT NULL THEN coalesce(c.devis_snapshot#>>'{inputs,destination,code}',c.devis_snapshot->'destination'->>'code',left(cl.cp,3)) ELSE left(cl.cp,3) END
  AND e.statut IN ('planifie','prochain','en_cours','en_preparation','pret') AND e.date_depart>=(now() AT TIME ZONE 'Europe/Paris')::date
  AND e.departed_at IS NULL AND (e.loading_closes_at IS NULL OR e.loading_closes_at>now()) ORDER BY e.id LIMIT 1) e
 WHERE c.envoi_id IS NULL AND c.depart_souhaite IS NOT NULL)
SELECT jsonb_build_object(
 'registered',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='""" + VERSION + r"""'),
 'existing_new_objects',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM (
   SELECT 'function '||p.oid::regprocedure::text x FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN (""" + CREATED + r""")
   UNION ALL SELECT 'trigger '||tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (""" + TRIGGER_NAMES + r""")) s),
 'replaced',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'present',oid IS NOT NULL,'md5',md5(definition),'definition',definition,
   'owner',(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=replaced.oid),'acl',(SELECT proacl FROM pg_proc WHERE oid=replaced.oid),
   'security_definer',(SELECT prosecdef FROM pg_proc WHERE oid=replaced.oid),'config',(SELECT proconfig FROM pg_proc WHERE oid=replaced.oid),
   'anon',CASE WHEN oid IS NOT NULL THEN has_function_privilege('anon',oid,'EXECUTE') END,
   'authenticated',CASE WHEN oid IS NOT NULL THEN has_function_privilege('authenticated',oid,'EXECUTE') END,
   'service',CASE WHEN oid IS NOT NULL THEN has_function_privilege('service_role',oid,'EXECUTE') END) ORDER BY signature) FROM replaced),
 'depended',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'present',oid IS NOT NULL,'md5',md5(definition)) ORDER BY signature) FROM depended),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'definition',pg_get_triggerdef(oid),'enabled',tgenabled) ORDER BY tgrelid::regclass::text,tgname),'[]')
   FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.messages'::regclass,'public.notification_outbox'::regclass)),
 'dependencies',jsonb_build_object(
  'z_sync_staff_work',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.colis'::regclass AND tgname='z_sync_staff_work' AND tgenabled='O'),
  'stamp_consent_request_version',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.messages'::regclass AND tgname='stamp_consent_request_version' AND tgenabled='O'),
  'outbox_message_key',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.notification_outbox'::regclass AND contype='f' AND confrelid='public.messages'::regclass),
  'outbox_statuses',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.notification_outbox'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%failed%cancelled%'),
  'message_echec',EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.statut_message'::regtype AND enumlabel='echec')),
 'reports',jsonb_build_object(
  'followed_up_consents',(SELECT coalesce(jsonb_agg(jsonb_build_object('ref',ref,'request_at',created_at,'template',template,'task_state',task_state,'hint',action_hint) ORDER BY ref),'[]') FROM followed),
  'relance_hints_to_wait',(SELECT coalesce(jsonb_agg(ref ORDER BY ref),'[]') FROM followed WHERE action_hint='Relancer le client avant la clôture du départ'),
  'receptionne_hints_to_reword',(SELECT coalesce(jsonb_agg(c.ref ORDER BY c.ref),'[]') FROM open_dossiers c JOIN public.staff_work_actions w ON w.colis_id=c.id AND w.kind='reception'
    WHERE w.state<>'done' AND c.statut='receptionne' AND w.action_hint='Demander l’accord avant la clôture du départ'),
  'wish_days_with_planned_departure',(SELECT coalesce(jsonb_agg(jsonb_build_object('ref',ref,'statut',statut,'day',depart_souhaite,'departure',envoi_ref,
    'own_loading_closing',loading_closes_at IS NOT NULL AND loading_closes_at<>wednesday_closing) ORDER BY depart_souhaite,ref),'[]') FROM wishes),
  'open_reception_actions',(SELECT count(*) FROM public.staff_work_actions WHERE kind='reception' AND state<>'done'))
) AS state;"""

BEFORE_SQL = r"""CREATE TEMP TABLE crf_replaced_before ON COMMIT DROP AS SELECT s.signature,p.oid,p.proacl acl,p.proowner owner,p.proconfig config
 FROM unnest(ARRAY[""" + REPLACED + r"""]) s(signature) JOIN pg_proc p ON p.oid=('public.'||s.signature)::regprocedure;
CREATE TEMP TABLE crf_depended_before ON COMMIT DROP AS SELECT s.signature,p.oid,md5(pg_get_functiondef(p.oid)) source,p.proacl acl,p.proowner owner,p.proconfig config
 FROM unnest(ARRAY[""" + DEPENDED + r"""]) s(signature) JOIN pg_proc p ON p.oid=('public.'||s.signature)::regprocedure;
CREATE TEMP TABLE crf_triggers_before ON COMMIT DROP AS SELECT tgrelid,tgname,pg_get_triggerdef(oid) definition,tgenabled FROM pg_trigger WHERE NOT tgisinternal;"""

INVARIANTS_SQL = r"""DO $$
DECLARE item record;
BEGIN
 IF EXISTS ((SELECT * FROM crf_before EXCEPT SELECT * FROM crf_after) UNION ALL (SELECT * FROM crf_after EXCEPT SELECT * FROM crf_before)) THEN
  RAISE EXCEPTION 'Consent follow-up release modified existing business data'; END IF;
 FOR item IN SELECT * FROM crf_replaced_before LOOP
  IF (SELECT (proacl,proowner,proconfig) IS DISTINCT FROM (item.acl,item.owner,item.config) OR NOT prosecdef FROM pg_proc WHERE oid=item.oid) THEN
   RAISE EXCEPTION 'Replaced function lost its owner, grants, configuration or definer security: %',item.signature; END IF;
 END LOOP;
 FOR item IN SELECT * FROM crf_depended_before LOOP
  IF (SELECT (md5(pg_get_functiondef(oid)),proacl,proowner,proconfig) IS DISTINCT FROM (item.source,item.acl,item.owner,item.config) FROM pg_proc WHERE oid=item.oid) THEN
   RAISE EXCEPTION 'A function the release relies on changed: %',item.signature; END IF;
 END LOOP;
 -- Only the three new triggers appear; every other trigger keeps its definition and state.
 IF EXISTS ((SELECT tgrelid,tgname,pg_get_triggerdef(oid),tgenabled FROM pg_trigger WHERE NOT tgisinternal AND tgname NOT IN (""" + TRIGGER_NAMES + r""")
   EXCEPT SELECT * FROM crf_triggers_before) UNION ALL (SELECT * FROM crf_triggers_before
   EXCEPT SELECT tgrelid,tgname,pg_get_triggerdef(oid),tgenabled FROM pg_trigger WHERE NOT tgisinternal)) THEN
  RAISE EXCEPTION 'An existing trigger changed'; END IF;
END $$;"""

POST_CHECKS_SQL = r"""DO $$
DECLARE fn text; owner oid:=(SELECT proowner FROM pg_proc WHERE oid='public.sync_staff_work_actions(uuid)'::regprocedure); trigger_name text;
BEGIN
 FOREACH fn IN ARRAY ARRAY['_consent_followup_until(colis)','trigger_sync_consent_followup()'] LOOP
  IF has_function_privilege('anon','public.'||fn,'EXECUTE') OR has_function_privilege('authenticated','public.'||fn,'EXECUTE') OR has_function_privilege('service_role','public.'||fn,'EXECUTE')
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner FROM pg_proc WHERE oid=('public.'||fn)::regprocedure) THEN
   RAISE EXCEPTION 'Unexpected private function security: %',fn; END IF;
 END LOOP;
 IF (SELECT provolatile<>'s' FROM pg_proc WHERE oid='public._consent_followup_until(colis)'::regprocedure) THEN RAISE EXCEPTION 'The follow-up helper must stay STABLE'; END IF;
 FOR trigger_name IN SELECT unnest(ARRAY[""" + TRIGGER_NAMES + r"""]) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=trigger_name AND NOT tgisinternal AND tgenabled='O' AND pg_get_triggerdef(oid)=CASE trigger_name
   """ + '\n   '.join('WHEN ' + QUOTE + name + QUOTE + ' THEN ' + QUOTE + definition.replace(QUOTE, QUOTE * 2) + QUOTE for name, definition in sorted(TRIGGERS.items())) + r""" END) THEN
   RAISE EXCEPTION 'Consent follow-up trigger missing, disabled or different: %',trigger_name; END IF;
 END LOOP;
 IF position('e.id=_departure_for_day(c,c.depart_souhaite)' IN pg_get_functiondef('public._colis_departure_closing(colis)'::regprocedure))=0
  OR position('Mesurer puis demander l’accord avant la clôture du départ' IN pg_get_functiondef('public._reception_work_hint(colis)'::regprocedure))=0
  OR position('_consent_followup_until(c) IS NULL THEN ''Relancer le client avant la clôture du départ''' IN pg_get_functiondef('public._reception_work_hint(colis)'::regprocedure))=0
  OR position('AND NOT (c.attente_client_date IS NULL AND relance_open AND followup IS NULL)' IN pg_get_functiondef('public.sync_staff_work_actions(uuid)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'A replaced function does not carry the reviewed body'; END IF;
 FOREACH fn IN ARRAY ARRAY['_colis_departure_closing(colis)','_reception_work_hint(colis)','sync_staff_work_actions(uuid)'] LOOP
  IF has_function_privilege('anon','public.'||fn,'EXECUTE') OR has_function_privilege('authenticated','public.'||fn,'EXECUTE') OR has_function_privilege('service_role','public.'||fn,'EXECUTE') THEN
   RAISE EXCEPTION 'Replaced functions changed grants: %',fn; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.refresh_staff_work_actions()','EXECUTE') OR NOT has_function_privilege('authenticated','public.refresh_staff_work_actions()','EXECUTE') THEN
  RAISE EXCEPTION 'The refresh changed grants'; END IF;
 -- Every open reception dossier gets a computable closing, follow-up and hint (read only).
 PERFORM public._colis_departure_closing(c),public._consent_followup_until(c),public._reception_work_hint(c) FROM public.colis c
  WHERE NOT coalesce(c.archive,false) AND c.statut IN ('receptionne','mesure','attente_feu_vert');
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
    # The 17 business tables of the previous releases, whole rows: this release adds no column.
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
    if current['existing_new_objects']:
        problems.append('objects of this release already exist: ' + ', '.join(current['existing_new_objects']))
    replaced = {f['signature']: f for f in current['replaced']}
    for signature, expected in EXPECTED_SOURCE.items():
        if not replaced[signature]['present'] or replaced[signature]['md5'] != expected:
            problems.append('production source differs from the reviewed baseline: ' + signature)
    depended = {f['signature']: f for f in current['depended']}
    for signature, expected in UNCHANGED_SOURCE.items():
        if not depended[signature]['present'] or depended[signature]['md5'] != expected:
            problems.append('a function the release relies on differs from the reviewed baseline: ' + signature)
    missing = [name for name, present in current['dependencies'].items() if not present]
    if missing:
        problems.append('missing dependencies: ' + ', '.join(missing))
    return problems


def summary(current):
    reports = current['reports']
    return {'followed_up_consents': len(reports['followed_up_consents']), 'relance_hints_to_wait': len(reports['relance_hints_to_wait']),
            'receptionne_hints_to_reword': len(reports['receptionne_hints_to_reword']),
            'wish_days_with_planned_departure': len(reports['wish_days_with_planned_departure']),
            'open_reception_actions': reports['open_reception_actions']}


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
    sql += 'CREATE TEMP TABLE crf_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += BEFORE_SQL + '\n'
    sql += migration + '\n'
    sql += 'CREATE TEMP TABLE crf_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
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
    return (current['replaced'] == before['replaced'] and current['depended'] == before['depended'] and current['triggers'] == before['triggers']
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
    assert current['depended'] == before['depended']
    assert [item for item in current['triggers'] if item['name'] not in TRIGGERS] == before['triggers']
    assert {item['name']: item['definition'] for item in current['triggers'] if item['name'] in TRIGGERS} == TRIGGERS
    assert sorted(name.split(' ', 1)[0] for name in current['existing_new_objects']) == sorted(['function'] * len(NEW_FUNCTIONS) + ['trigger'] * len(TRIGGERS))
    # The Management API read-only mode rejects DO blocks: run the read-only checks in a rolled-back transaction.
    query('BEGIN;\n' + POST_CHECKS_SQL + '\nROLLBACK;', False)
    save('verified.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current, 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'registered': VERSION, 'sha256': digest(), 'replaced_functions': len(MARKERS), 'new_functions': len(NEW_FUNCTIONS),
                      'new_triggers': len(TRIGGERS), 'grants_and_triggers': 'as reviewed', 'reports_after': summary(current)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
