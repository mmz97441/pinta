"""Release of the confirmation after the client's consent (lot 3b, 2026-10-06) without rewriting business data.

Operations, each run separately by the lead and only with the user's explicit go-ahead:
  preflight  read-only: refuses when already registered, when lot 3a (20261006000001) is not registered yet, when the
             new filter is already present, or when register_telegram_document or a function this lot relies on differs
             from the reviewed repository baseline (md5 of pg_get_functiondef, local replay up to 20261006000001 on
             PostgreSQL 17). Lists the saved message_templates of the four confirmation keys (a saved body wins over the
             new defaults and must be reported to the lead) and every saved body that still carries a Markdown marker
             (the defaults are now plain text; saved rows are never written). Only plain SELECTs: the read-only role of the Management API
             cannot EXECUTE application functions, so every predicate is written in the query. Saves everything privately
             (folder 0700, files 0600).
  rehearse   write transaction rolled back: migration plus invariants (business data and saved templates unchanged, the
             decision functions and every other dependency untouched, the replaced command keeps owner/grants/configuration)
             and the post checks.
  apply      same transaction, registered in schema_migrations, schema reload requested, committed.
  verify     read-only checks, run in BEGIN … ROLLBACK because the read-only mode rejects DO blocks.
The migration SHA-256 is recorded at every step. Credentials stay in memory (management.py); nothing runs at import and
no secret is printed. The Edge functions (edge_consent_reply20261006.sh) are deployed after apply and verify: only the
new telegram-webhook stores the feu_vert_recu_facture confirmation that the new filter recognises.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import TABLES

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261006000002_consent_reply.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-06-consent-reply'
VERSION = '20261006000002'
NAME = 'consent_reply'
PREVIOUS_VERSION = '20261006000001'  # lot 3a, applied first
# Replaced whole by the migration: production must run the reviewed source (local replay up to 20261006000001, PostgreSQL 17).
EXPECTED_SOURCE = {
    'register_telegram_document(uuid,text,text)': '8fde44a13c983f8ddff12c90a643c006',
}
# A substring that proves the new body of each replaced function.
MARKERS = {
    'register_telegram_document(uuid,text,text)': "OR (request.template='feu_vert_recu_facture' AND p_reply_message_id IS NOT NULL AND (",
}
# Relied on unchanged (decision, queue, reply resolution and invoice registration): same baseline, never touched.
EXPECTED_DEPENDENCIES = {
    '_apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)': 'f81617af71de16615ce552baf90654a9',
    'telegram_client_decision(uuid,text,text,text)': '261a709207266b4d02457b8d04e6899c',
    'client_decision(uuid,text,timestamptz,timestamptz,text)': '10f309304106cd1e6db42f51eedae9ce',
    'queue_message(uuid,text,text,text,jsonb,text,integer)': 'dd4b4221764d9bbc04bda2ebd3deee8c',
    'register_requested_invoice(uuid,text)': '02133c0a52552db1d3a4f4c6c596211e',
    'register_late_invoice_from_message(uuid,text)': '44ca6e47ac915db6aedb6b245e7a0ea8',
    'resolve_telegram_message_colis(uuid,text,text)': '91df377be4165fbe6296e09d4da49d61',
}
# Keys whose saved body (message_templates) the server now sends instead of the default.
TEMPLATE_KEYS = ['feu_vert_recu', 'feu_vert_recu_facture', 'choix_attente_recu', 'refus_recu']
# The 17 business tables of the previous releases, plus the saved templates the migration must never overwrite.
PROTECTED = TABLES + ['message_templates']
REPLACED = ','.join("'" + signature + "'" for signature in sorted(EXPECTED_SOURCE))
DEPENDENCIES = ','.join("'" + signature + "'" for signature in sorted(EXPECTED_DEPENDENCIES))
KEYS = ','.join("'" + key + "'" for key in TEMPLATE_KEYS)
# queue_message's invoice_requested, written in the query (current invoices: no retired copy, not replaced).
CURRENT_INVOICE = ("f.colis_id=c.id AND f.duplicate_of_facture_id IS NULL"
                   " AND NOT EXISTS(SELECT 1 FROM public.factures r WHERE r.replaces_facture_id=f.id)")
INVOICE_REQUESTED = ("(NOT EXISTS(SELECT 1 FROM public.factures f WHERE " + CURRENT_INVOICE + " AND f.rejet_motif IS NULL)"
                     " OR EXISTS(SELECT 1 FROM public.factures f WHERE " + CURRENT_INVOICE + " AND f.rejet_motif IS NOT NULL))")

PREFLIGHT_SQL = r"""WITH replaced AS (
 SELECT s.signature,p.oid,pg_get_functiondef(p.oid) definition FROM unnest(ARRAY[""" + REPLACED + r"""]) s(signature)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||s.signature)),
relied AS (
 SELECT s.signature,p.oid,md5(pg_get_functiondef(p.oid)) md5,p.proacl acl FROM unnest(ARRAY[""" + DEPENDENCIES + r"""]) s(signature)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||s.signature))
SELECT jsonb_build_object(
 'registered',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='""" + VERSION + r"""'),
 'previous_registered',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='""" + PREVIOUS_VERSION + r"""'),
 'replaced',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'present',oid IS NOT NULL,'md5',md5(definition),'definition',definition,
   'owner',(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=replaced.oid),'acl',(SELECT proacl FROM pg_proc WHERE oid=replaced.oid),
   'security_definer',(SELECT prosecdef FROM pg_proc WHERE oid=replaced.oid),'config',(SELECT proconfig FROM pg_proc WHERE oid=replaced.oid),
   'anon',CASE WHEN oid IS NOT NULL THEN has_function_privilege('anon',oid,'EXECUTE') END,
   'authenticated',CASE WHEN oid IS NOT NULL THEN has_function_privilege('authenticated',oid,'EXECUTE') END,
   'service',CASE WHEN oid IS NOT NULL THEN has_function_privilege('service_role',oid,'EXECUTE') END) ORDER BY signature) FROM replaced),
 'relied',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'present',oid IS NOT NULL,'md5',md5,'acl',acl) ORDER BY signature) FROM relied),
 'templates',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'canal',canal,'updated_at',updated_at,'md5',md5(body),'body',body) ORDER BY key,canal),'[]')
   FROM public.message_templates WHERE key IN (""" + KEYS + r""")),
 'template_saves',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',created_at,'detail',detail) ORDER BY created_at DESC),'[]')
   FROM public.audit_actions WHERE action='message_template_saved' AND split_part(detail,' / ',1) IN (""" + KEYS + r""")),
 -- Saved bodies of any key still carrying a Markdown marker outside their variables: plain-text Telegram shows it as is.
 'templates_with_markdown',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'canal',canal,'updated_at',updated_at) ORDER BY key,canal),'[]')
   FROM public.message_templates WHERE regexp_replace(body,'\{\{\w+\}\}','','g') ~ '[_*]'),
 'dependencies',jsonb_build_object(
  'message_templates',to_regclass('public.message_templates') IS NOT NULL,
  'outbox_idempotency_unique',EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
    WHERE i.indrelid='public.notification_outbox'::regclass AND i.indisunique AND i.indnatts=1 AND a.attname='idempotency_key'),
  'messages_telegram_msg_id',EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.messages'::regclass AND attname='telegram_msg_id' AND NOT attisdropped)),
 'reports',jsonb_build_object(
  'awaiting_consent_on_telegram',(SELECT count(*) FROM public.colis c JOIN public.clients cl ON cl.id=c.client_id
    WHERE c.statut='attente_feu_vert' AND NOT coalesce(c.archive,false) AND cl.telegram_chat_id IS NOT NULL),
  'consented_invoice_still_requested',(SELECT count(*) FROM public.colis c JOIN public.clients cl ON cl.id=c.client_id
    WHERE c.statut IN ('autorise','en_preparation') AND NOT coalesce(c.archive,false) AND c.paiement_date IS NULL AND cl.type IS DISTINCT FROM 'pro'
    AND """ + INVOICE_REQUESTED + r"""),
  'stored_confirmations',(SELECT count(*) FROM public.messages WHERE template IN (""" + KEYS + r""")),
  'consent_reply_failures',(SELECT count(*) FROM public.audit_actions WHERE action='consent_reply_failed'))
) AS state;"""

BEFORE_SQL = r"""CREATE TEMP TABLE crp_replaced_before ON COMMIT DROP AS SELECT s.signature,p.oid,p.proacl acl,p.proowner owner,p.proconfig config
 FROM unnest(ARRAY[""" + REPLACED + r"""]) s(signature) JOIN pg_proc p ON p.oid=('public.'||s.signature)::regprocedure;
CREATE TEMP TABLE crp_relied_before ON COMMIT DROP AS SELECT s.signature,p.oid,md5(pg_get_functiondef(p.oid)) md5,p.proacl acl,p.proowner owner,p.proconfig config,p.prosecdef secdef
 FROM unnest(ARRAY[""" + DEPENDENCIES + r"""]) s(signature) JOIN pg_proc p ON p.oid=('public.'||s.signature)::regprocedure;"""

INVARIANTS_SQL = r"""DO $$
DECLARE item record;
BEGIN
 IF EXISTS ((SELECT * FROM crp_before EXCEPT SELECT * FROM crp_after) UNION ALL (SELECT * FROM crp_after EXCEPT SELECT * FROM crp_before)) THEN
  RAISE EXCEPTION 'Consent reply release modified business data or a saved message template'; END IF;
 FOR item IN SELECT * FROM crp_replaced_before LOOP
  IF (SELECT (proacl,proowner,proconfig) IS DISTINCT FROM (item.acl,item.owner,item.config) OR NOT prosecdef FROM pg_proc WHERE oid=item.oid) THEN
   RAISE EXCEPTION 'Replaced function lost its owner, grants, configuration or definer security: %',item.signature; END IF;
 END LOOP;
 FOR item IN SELECT * FROM crp_relied_before LOOP
  IF (SELECT (md5(pg_get_functiondef(oid)),proacl,proowner,proconfig,prosecdef) IS DISTINCT FROM (item.md5,item.acl,item.owner,item.config,item.secdef) FROM pg_proc WHERE oid=item.oid) THEN
   RAISE EXCEPTION 'A function outside the release changed: %',item.signature; END IF;
 END LOOP;
END $$;"""

POST_CHECKS_SQL = r"""DO $$
DECLARE fn regprocedure:='public.register_telegram_document(uuid,text,text)'::regprocedure; definition text;
 marker text:='OR (request.template=''feu_vert_recu_facture'' AND p_reply_message_id IS NOT NULL AND (';
BEGIN
 definition:=pg_get_functiondef(fn);
 IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1
  OR position('request.template IN (''facture_manquante'',''demande_facture'')' IN definition)=0
  OR position('request.template=''demande_feu_vert'' AND request.request_snapshot->''invoice_requested''=''true''::jsonb' IN definition)=0
  OR position('AND coalesce(delivery.sent_at,request.created_at)>=incoming.created_at-interval ''7 days''' IN definition)=0 THEN
  RAISE EXCEPTION 'register_telegram_document does not carry the reviewed filter'; END IF;
 IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR NOT has_function_privilege('service_role',fn,'EXECUTE')
  OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=(SELECT proowner FROM pg_proc WHERE oid='public.queue_message(uuid,text,text,text,jsonb,text,integer)'::regprocedure)
   FROM pg_proc WHERE oid=fn) THEN
  RAISE EXCEPTION 'Unexpected security of register_telegram_document'; END IF;
 IF has_function_privilege('authenticated','public.register_requested_invoice(uuid,text)','EXECUTE') OR NOT has_function_privilege('service_role','public.register_requested_invoice(uuid,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.telegram_client_decision(uuid,text,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public._apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.queue_message(uuid,text,text,text,jsonb,text,integer)','EXECUTE') THEN
  RAISE EXCEPTION 'A related command changed grants'; END IF;
 IF position('feu_vert_recu' IN pg_get_functiondef('public._apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)'::regprocedure))>0 THEN
  RAISE EXCEPTION 'The client decision rules must stay untouched'; END IF;
END $$;"""


def query(sql, readonly=True):
    return request('/database/query', 'POST', {'query': sql, 'read_only': readonly})


def digest():
    return hashlib.sha256(FILE.read_bytes()).hexdigest()


def save(name, value):
    FOLDER.mkdir(mode=0o700, parents=True, exist_ok=True)
    FOLDER.chmod(0o700)
    path = FOLDER / name
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False))
    path.chmod(0o600)


def load(name):
    return json.loads((FOLDER / name).read_text())


def check_hash(name):
    if load(name)['sha256'] != digest():
        raise RuntimeError('Migration changed: repeat preflight and rehearsal.')


def fingerprints_sql():
    # Business tables and saved templates: row count plus an md5 over the sorted row hashes, before and after.
    parts = []
    for table in PROTECTED:
        parts.append("SELECT '" + table + "'::text table_name,count(*) row_count,"
                     "md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) fingerprint FROM public." + table + ' t')
    return '\nUNION ALL\n'.join(parts)


def state():
    return query(PREFLIGHT_SQL)[0]['state']


def already_applied(current):
    return any(MARKERS[f['signature']] in (f['definition'] or '') for f in current['replaced'])


def baseline_problems(current):
    problems = []
    if current['registered']:
        problems.append('version already registered')
    if not current['previous_registered']:
        problems.append('lot 3a (' + PREVIOUS_VERSION + ') is not registered: apply it first')
    if already_applied(current):
        problems.append('the confirmation filter is already present')
    replaced = {f['signature']: f for f in current['replaced']}
    for signature, expected in EXPECTED_SOURCE.items():
        if not replaced[signature]['present'] or replaced[signature]['md5'] != expected:
            problems.append('production source differs from the reviewed baseline: ' + signature)
    relied = {f['signature']: f for f in current['relied']}
    for signature, expected in EXPECTED_DEPENDENCIES.items():
        if not relied[signature]['present'] or relied[signature]['md5'] != expected:
            problems.append('relied-on function differs from the reviewed baseline: ' + signature)
    missing = [name for name, present in current['dependencies'].items() if not present]
    if missing:
        problems.append('missing dependencies: ' + ', '.join(missing))
    return problems


def saved_templates(current):
    """Saved bodies win over the new defaults: printed for the lead, never overwritten."""
    return [{'key': t['key'], 'canal': t['canal'], 'updated_at': t['updated_at'], 'md5': t['md5'], 'body': t['body']} for t in current['templates']]


def preflight():
    if (FOLDER / 'applied.json').exists():
        raise RuntimeError('Already applied; preserve the original backup and verify.')
    current = state()
    problems = baseline_problems(current)
    if problems:
        raise RuntimeError('Preflight refused: ' + '; '.join(problems) + '. Compare with the repository before any rehearsal.')
    save('before.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current,
                         'fingerprints': query(fingerprints_sql())})
    templates = saved_templates(current)
    print(json.dumps({'private_backup': str(FOLDER / 'before.json'), 'sha256': digest(), 'tables_protected': len(PROTECTED),
                      'saved_templates': templates, 'template_saves': current['template_saves'],
                      'templates_with_markdown': current['templates_with_markdown'], 'reports': current['reports']},
                     indent=2, ensure_ascii=False))
    if templates:
        print('WARNING: saved message_templates win over the new defaults for '
              + ', '.join(t['key'] + '/' + t['canal'] for t in templates)
              + '. Report them to the lead (show the director) before deploying the Edge functions; never overwrite them.')
    if current['templates_with_markdown']:
        print('WARNING: saved message_templates still carry Markdown markers shown as is in plain text: '
              + ', '.join(t['key'] + '/' + t['canal'] for t in current['templates_with_markdown'])
              + '. Only the director can replace them (template editor); this release never writes them.')


def transaction_sql(register=False):
    migration = FILE.read_text()
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    sql += 'CREATE TEMP TABLE crp_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += BEFORE_SQL + '\n'
    sql += migration + '\n'
    sql += 'CREATE TEMP TABLE crp_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
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
    return (current['replaced'] == before['replaced'] and current['relied'] == before['relied']
            and not current['registered'] and current['previous_registered'] and not already_applied(current))


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
        assert function['definition'].count(marker) == 1, signature
        for key in ['acl', 'owner', 'security_definer', 'config', 'anon', 'authenticated', 'service']:
            assert function[key] == previous[signature][key], signature + ' ' + key
    assert current['relied'] == before['relied']
    # The Management API read-only mode rejects DO blocks: run the read-only checks in a rolled-back transaction.
    query('BEGIN;\n' + POST_CHECKS_SQL + '\nROLLBACK;', False)
    save('verified.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current, 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'registered': VERSION, 'sha256': digest(), 'replaced_functions': len(MARKERS), 'relied_functions_unchanged': len(EXPECTED_DEPENDENCIES),
                      'saved_templates': saved_templates(current), 'templates_with_markdown': current['templates_with_markdown'],
                      'grants': 'as reviewed'}, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
