"""Release of the retention of payments and of the audit trail (2026-10-10) without rewriting any business row.

Compliance reference of 2026-10-10 (docs/facturation-conformite.md, rules F18, F22, F23, C14 and decision I2): payment
records and the journals of the audit trail are never modified nor erased and are kept ten years; a correction is a new
« plus / moins » record. The migration 20261010000001_history_retention.sql (its header holds the inventory: every
history table, its keys, its writers and the rule chosen) replaces by RESTRICT the keys through which deleting a dossier,
client, departure or message would erase or orphan history (and adds such a key when it is missing), creates eleven
private trigger functions, sixteen row triggers retention_guard and fourteen statement triggers retention_truncate, and
revokes from the API roles UPDATE, DELETE and TRUNCATE on the append-only tables, DELETE and TRUNCATE on the others.
No application function is replaced and no Edge function changes; the front's data layer (deleteClient, deleteEnvoi:
the deleted row is read back, the server's French message is shown) ships with it or after it.
Operations, each run separately by the lead and only with the user's explicit go-ahead:
  preflight  read-only, plain SELECTs with every predicate written in the query (the read-only role of the Management API
             cannot EXECUTE application functions): refuses when the version is registered, when an object of the release
             exists, when a writer whose transitions the guards encode differs from the reviewed repository baseline
             (md5 of pg_get_functiondef, local replay up to 20261007000004 on PostgreSQL 17), when the triggers of a
             history table differ from that replay's (one production added would run with guards never tested with it:
             a BEFORE trigger changing NEW, an AFTER one rewriting history), when a table or a column is missing, or
             when a history row points to a missing parent (the key added for it would fail). REPORTS,
             without changing them: the rows of each history table, every key of the history with its ON DELETE (those
             the release replaces or adds), the triggers already there, the API privileges it revokes, and what becomes
             protected (dossiers, clients and departures with history, checks of confirmed departures, paid links, final
             deliveries, withdrawals). Everything goes to the private backup (folder 0700, files 0600); counts on screen.
  rehearse   write transaction rolled back: migration, post checks (triggers, private functions with their reviewed
             bodies, keys, privileges, a call under the API role refused before reading anything, a rewrite of a
             recorded payment refused by its guard), then the invariants (business data unchanged; the other keys,
             triggers and functions unchanged).
  apply      same transaction, registered in schema_migrations, schema reload requested, committed.
  verify     the post checks again, read-only, run in BEGIN … ROLLBACK because the read-only mode rejects DO blocks, and a
             fresh report.
The migration SHA-256 is recorded at every step. Credentials stay in memory (management.py); nothing runs at import and no
secret is printed. Edge functions write payment_intents, messages, notification_outbox and client_inbox with the service
key: the deployed ones must be the repository's (compare_edge_sources.cjs) before apply, since the guards accept exactly
their transitions.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import TABLES

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261010000001_history_retention.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-10-history-retention'
VERSION = '20261010000001'
NAME = 'history_retention'
# The history columns and their parent (the same list as the migration): one RESTRICT or NO ACTION key each.
FK_SPECS = [
    ('paiements', 'colis_id', 'colis'), ('paiements', 'client_id', 'clients'), ('payment_intents', 'colis_id', 'colis'),
    ('legacy_payplug_payments', 'colis_id', 'colis'), ('legacy_payplug_payments', 'client_id', 'clients'),
    ('quote_versions', 'colis_id', 'colis'), ('quote_withdrawals', 'colis_id', 'colis'), ('quote_withdrawals', 'message_id', 'messages'),
    ('audit_actions', 'colis_id', 'colis'), ('logs_statut', 'colis_id', 'colis'), ('messages', 'colis_id', 'colis'),
    ('notification_outbox', 'message_id', 'messages'), ('notification_outbox', 'client_id', 'clients'), ('notification_outbox', 'colis_id', 'colis'),
    ('client_inbox', 'client_id', 'clients'), ('client_inbox', 'colis_id', 'colis'), ('com_log', 'colis_id', 'colis'),
    ('com_log', 'client_id', 'clients'), ('reception_append_receipts', 'colis_id', 'colis'), ('departure_manifests', 'envoi_id', 'envois'),
]
APPEND_ONLY = ['paiements', 'quote_versions', 'audit_actions', 'logs_statut', 'departure_manifests', 'com_log', 'reception_append_receipts',
               'legacy_payplug_payments']
GUARDED = ['payment_intents', 'quote_withdrawals', 'messages', 'notification_outbox', 'client_inbox', 'departure_loading_checks']
HISTORY = APPEND_ONLY + GUARDED
PARENTS = ['colis', 'clients', 'envois']
# retention_guard, by table: BEFORE UPDATE OR DELETE FOR EACH ROW (27) on the history, BEFORE DELETE FOR EACH ROW (11) on
# the parents. legacy_payplug_payments keeps its own guard (20260910000012) and only gains the TRUNCATE trigger.
ROW_GUARDS = {**{table: 27 for table in HISTORY if table != 'legacy_payplug_payments'}, **{table: 11 for table in PARENTS}}
# The new private trigger functions and their reviewed bodies (md5 of pg_get_functiondef, local replay, PostgreSQL 17).
NEW_SOURCE = {
    '_retention_append_only()': '10e8ceb245165f336bc75d31d293c219',
    '_retention_payment_intent()': '3d2266f06eb678aaf44816bce406298a',
    '_retention_message()': '34627f78101deaf6d3c6425e237079cc',
    '_retention_outbox()': '77a0534396ea66ae51def50d506c4aad',
    '_retention_quote_withdrawal()': '53933827d7348a02342fe6b94afe8376',
    '_retention_client_inbox()': '5bb26b3c08eaf61c7773aa85d0ed8220',
    '_retention_loading_check()': '9b4e7424079fa2a6ff727901ada72721',
    '_retention_colis_delete()': '1224749afabef67520a209e8adc70b89',
    '_retention_client_delete()': 'c5cb3d6ca4205793ce4a9a28d397c48e',
    '_retention_departure_delete()': 'f05b5a7fdab9321505547c08dacd5788',
    '_retention_truncate()': '7b67c56eed6009e5a8e65fce7aac8b10',
}
SECURITY_DEFINER = ['_retention_loading_check()', '_retention_colis_delete()', '_retention_client_delete()', '_retention_departure_delete()']
# The writers whose moves the guards accept (and the guards they run with): production must run the reviewed source
# (local replay up to 20261007000004, PostgreSQL 17), else a guard could refuse a move the reviewed code never made.
UNCHANGED_SOURCE = {
    '_record_payment(uuid,numeric,text,text,text,integer)': 'b2d02171fdba84f83e38403836b6dff5',
    'reserve_payplug_intent(uuid,integer,integer,boolean,text,timestamptz)': '1cf5991c963c55c571030aaf2113481c',
    'confirm_payplug_payment(text,uuid,integer,integer,text)': '1641488f1536e2b1176d2c6b56b4ab07',
    'record_payplug_cancellation(uuid,text,jsonb)': 'ef6886c1d0505fc758fd80d40c562b4d',
    'confirm_legacy_payplug_payment(jsonb)': '7da739786cc11611cb8d1ea168004cac',
    'mark_manual_payment(uuid,numeric,text,text)': 'a910e5f656d645823e464eba86211e10',
    'version_quote()': 'aeac234a2a24829221211d5e8ab48083',
    '_withdraw_quote(colis,text,text,text,uuid,uuid[])': '3e2da2d95f43998dffd940f11485ceb0',
    'correct_colis_task(uuid,text,jsonb,timestamptz,text)': '84acd87f68ce5153113532748a333781',
    'queue_message(uuid,text,text,text,jsonb,text,integer)': 'dd4b4221764d9bbc04bda2ebd3deee8c',
    '_apply_client_decision(uuid,text,timestamptz,timestamptz,text,text)': 'f81617af71de16615ce552baf90654a9',
    'cancel_previous_consent_requests()': 'c455f8119c4d32ca8ea6729b1bc18b5c',
    'reopen_customer_conversation()': '5cc069a94884ca658426f6aab1cff83e',
    'set_conversation_state(uuid,text,integer)': 'f4e9fb1e15cc1a3c84d5a2e61cb2d7f0',
    'guard_reminder_queue()': '29b53e5d6a60b2329c0a973fc75773e7',
    'guard_message_workflow()': '285940ba3f1e8a42aa27ce0ee009dcb9',
    'claim_inbox_assignment(uuid,uuid)': 'c5ab060907cc14f077e5bd1d38b87d61',
    '_open_late_invoice_request(colis,uuid,text)': '7849c39dc7085779e24187f8521c7ba6',
    'claim_quote_withdrawal(uuid,boolean)': '4379e07e0109783f1c6f67b2c22a88f1',
    'release_quote_withdrawal(uuid,text,text)': '4b632f43343f5278e21c8056f26c7bf0',
    'complete_quote_withdrawal(uuid)': '774471d2db400a07e18498aefd9df01b',
    'close_quote_withdrawals()': 'ddf7e40ca0444fc62108a92669333386',
    'mark_quote_withdrawal_message(uuid,integer,text,uuid,text)': 'd3ea07edeb4342400034a48e6b38d163',
    'withdraw_quote_for_documents(uuid,timestamptz,text,text,uuid,text,uuid)': 'f3feb37c931c858d91ef809483f9b371',
    'confirm_departure(uuid,jsonb,timestamptz,text)': '23e2307e6de8d178b2f565f25aaf7370',
    '_loading_checks_forget()': 'a048f69ddc29ec48c9aa12e49c203d39',
    'clear_loading_checks(uuid,uuid)': '1b6becaed10e4d82e261cfe1124410af',
    'record_loading_check(uuid,uuid,integer,integer,text)': '7f1aa92811f29e60fb579fe73ed82297',
    'record_loading_count(uuid,uuid,integer)': '31f6ed933cd0fbd4c6b2d790928fddf0',
    'append_reception_cartons(uuid,jsonb,timestamptz,text,text,text[],uuid)': '2a2f47c74a9538aaa58dab19d6c589d3',
    'revert_colis(uuid,timestamptz)': 'cc60484120610145646fc5742e3ec346',
    'guard_client_history_delete()': '294923591902328b06c683a2f75d3cec',
    'guard_departure_changes()': '45a560ad74f95d3247e08092f534427b',
    'fn_log_statut_change()': '9114ec969c513c9d4e1eb25f9b485593',
    'guard_legacy_payplug_snapshot()': '45ea5b16a2a09fbcdf02aaa005f2bdf9',
    'invalidate_legacy_payplug()': '4a739949e0521b7984c7cbf57d1e75b2',
}
# The triggers of the history tables before the release (local replay up to 20261007000004): (table, name, tgtype,
# enabled, function). The guards were reviewed and tested with exactly these; the release's own are left out.
REVIEWED_TRIGGERS = sorted([
    ('legacy_payplug_payments', 'guard_legacy_payplug_snapshot', 31, 'O', 'guard_legacy_payplug_snapshot()'),
    ('messages', 'guard_message_workflow', 23, 'O', 'guard_message_workflow()'),
    ('messages', 'reopen_customer_conversation', 5, 'O', 'reopen_customer_conversation()'),
    ('messages', 'stamp_consent_request_version', 7, 'O', 'stamp_consent_request_version()'),
    ('messages', 'z_sync_consent_request_failure', 17, 'O', 'trigger_sync_consent_followup()'),
    ('messages', 'z_sync_consent_request_work', 5, 'O', 'trigger_sync_consent_followup()'),
    ('notification_outbox', 'guard_reminder_queue', 23, 'O', 'guard_reminder_queue()'),
    ('notification_outbox', 'z_sync_consent_delivery_queued', 5, 'O', 'trigger_sync_consent_followup()'),
    ('notification_outbox', 'z_sync_consent_delivery_work', 17, 'O', 'trigger_sync_consent_followup()'),
    ('quote_withdrawals', 'z_sync_quote_withdrawal_work', 21, 'O', 'trigger_sync_staff_work_actions()'),
])
# Columns the guards read.
COLUMNS = {
    'payment_intents': ['id', 'colis_id', 'quote_version', 'amount_cents', 'currency', 'provider_is_live', 'created_at', 'updated_at', 'status',
                        'provider_id', 'payment_url', 'provider_cancelled_at', 'return_token_hash', 'return_token_expires_at'],
    'messages': ['lu', 'statut', 'telegram_msg_id', 'colis_id'],
    'notification_outbox': ['id', 'message_id', 'client_id', 'colis_id', 'quote_version', 'canal', 'reply_markup', 'idempotency_key', 'created_at', 'status'],
    'quote_withdrawals': ['id', 'colis_id', 'source', 'action', 'quote_version', 'reason', 'requested_by', 'created_at', 'facture_ids', 'withdrawn_at',
                          'withdrawn_quote_version', 'previous_statut'],
    'client_inbox': ['id', 'client_id', 'telegram_update_id', 'created_at', 'payload', 'colis_id'],
    'departure_loading_checks': ['envoi_id'],
    'colis': ['id', 'paiement_date', 'paiement_montant', 'date_expedition', 'quote_version', 'devis_total', 'envoi_id', 'client_id'],
    'envois': ['id', 'departed_at', 'manifest_version', 'statut'],
    'telegram_invitations': ['client_id'],
    'factures': ['colis_id'],
}
# Every business table fingerprinted before and after (previous releases' list plus the history it lacks).
FINGERPRINTED = list(dict.fromkeys(TABLES + ['logs_statut', 'quote_withdrawals', 'client_inbox', 'com_log', 'reception_append_receipts',
                                             'departure_loading_checks', 'telegram_invitations']))
API_ROLES = ['anon', 'authenticated', 'service_role']
API_MESSAGE_STATE = '42501'
PAYMENT_MESSAGE = ('Un paiement enregistré ne se modifie pas et ne se supprime pas : une correction s’enregistre comme une nouvelle écriture, '
                   'de signe opposé.')
QUOTE = "'"


def sql_text(value):
    """A SQL string literal."""
    return QUOTE + value.replace(QUOTE, QUOTE * 2) + QUOTE


def sql_array(values):
    return 'ARRAY[' + ','.join(sql_text(value) for value in values) + ']'


SPECS_VALUES = ','.join('(' + ','.join(sql_text(part) for part in spec) + ')' for spec in FK_SPECS)
# The key of a spec, found by column whatever its name.
KEY_OF_SPEC = ("c.contype='f' AND c.conrelid=to_regclass('public.'||s.tbl) AND c.confrelid=to_regclass('public.'||s.parent)"
               " AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||s.tbl) AND a.attname=s.col AND NOT a.attisdropped)]")
# _retention_colis_delete's predicate, written in the query (c a dossier).
DOSSIER_HISTORY = (
    "(c.paiement_date IS NOT NULL OR c.paiement_montant IS NOT NULL OR c.date_expedition IS NOT NULL OR c.quote_version>0 OR c.devis_total IS NOT NULL"
    " OR EXISTS(SELECT 1 FROM public.paiements t WHERE t.colis_id=c.id) OR EXISTS(SELECT 1 FROM public.payment_intents t WHERE t.colis_id=c.id)"
    " OR EXISTS(SELECT 1 FROM public.legacy_payplug_payments t WHERE t.colis_id=c.id) OR EXISTS(SELECT 1 FROM public.quote_versions t WHERE t.colis_id=c.id)"
    " OR EXISTS(SELECT 1 FROM public.quote_withdrawals t WHERE t.colis_id=c.id) OR EXISTS(SELECT 1 FROM public.audit_actions t WHERE t.colis_id=c.id)"
    " OR EXISTS(SELECT 1 FROM public.logs_statut t WHERE t.colis_id=c.id) OR EXISTS(SELECT 1 FROM public.messages t WHERE t.colis_id=c.id)"
    " OR EXISTS(SELECT 1 FROM public.notification_outbox t WHERE t.colis_id=c.id) OR EXISTS(SELECT 1 FROM public.client_inbox t WHERE t.colis_id=c.id)"
    " OR EXISTS(SELECT 1 FROM public.com_log t WHERE t.colis_id=c.id) OR EXISTS(SELECT 1 FROM public.reception_append_receipts t WHERE t.colis_id=c.id)"
    " OR EXISTS(SELECT 1 FROM public.factures t WHERE t.colis_id=c.id)"
    " OR EXISTS(SELECT 1 FROM public.envois e WHERE e.id=c.envoi_id AND (e.departed_at IS NOT NULL OR e.manifest_version>0)))")
# _retention_client_delete's predicate without the dossiers (cl a client).
CLIENT_OTHER_HISTORY = (
    "(EXISTS(SELECT 1 FROM public.paiements t WHERE t.client_id=cl.id) OR EXISTS(SELECT 1 FROM public.legacy_payplug_payments t WHERE t.client_id=cl.id)"
    " OR EXISTS(SELECT 1 FROM public.notification_outbox t WHERE t.client_id=cl.id) OR EXISTS(SELECT 1 FROM public.client_inbox t WHERE t.client_id=cl.id)"
    " OR EXISTS(SELECT 1 FROM public.com_log t WHERE t.client_id=cl.id) OR EXISTS(SELECT 1 FROM public.telegram_invitations t WHERE t.client_id=cl.id))")
CONFIRMED = "(e.departed_at IS NOT NULL OR e.manifest_version>0)"


def _rows_sql():
    return ','.join(sql_text(table) + ',(SELECT count(*) FROM public.' + table + ')' for table in HISTORY + PARENTS)


def _orphans_sql():
    parts = []
    for table, column, parent in FK_SPECS:
        parts.append(sql_text(table + '.' + column) + ',(SELECT count(*) FROM public.' + table + ' t WHERE t.' + column
                     + ' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.' + parent + ' p WHERE p.id=t.' + column + '))')
    return ','.join(parts)


def _columns_sql():
    checks = []
    wanted = {table: list(columns) for table, columns in COLUMNS.items()}
    for table, column, parent in FK_SPECS:
        for name, field in ((table, column), (parent, 'id')):
            if field not in wanted.setdefault(name, []):
                wanted[name].append(field)
    for table, columns in wanted.items():
        for column in columns:
            checks.append("SELECT " + sql_text(table + '.' + column) + " x WHERE NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass("
                          + sql_text('public.' + table) + ") AND attname=" + sql_text(column) + " AND NOT attisdropped)")
    return ' UNION ALL '.join(checks)


PREFLIGHT_SQL = r"""WITH specs AS (SELECT * FROM (VALUES """ + SPECS_VALUES + r""") s(tbl,col,parent)),
spec_keys AS (SELECT s.tbl,s.col,s.parent,c.conname,c.confdeltype::text on_delete FROM specs s LEFT JOIN pg_constraint c ON """ + KEY_OF_SPEC + r"""),
relied AS (SELECT s.signature,p.oid FROM unnest(""" + sql_array(sorted(UNCHANGED_SOURCE)) + r""") s(signature) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||s.signature))
SELECT jsonb_build_object(
 'registered',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='""" + VERSION + r"""'),
 'latest_registered',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'existing_new_objects',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM (
   SELECT 'function '||p.oid::regprocedure::text x FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '\_retention\_%'
   UNION ALL SELECT 'trigger '||tgname||' on '||tgrelid::regclass::text FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('retention_guard','retention_truncate')) s),
 'relied',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'present',oid IS NOT NULL,'md5',md5(pg_get_functiondef(oid))) ORDER BY signature) FROM relied),
 'missing_tables',(SELECT coalesce(jsonb_agg(t ORDER BY t),'[]') FROM unnest(""" + sql_array(HISTORY + PARENTS + ['factures', 'telegram_invitations']) + r""") t
   WHERE to_regclass('public.'||t) IS NULL),
 'missing_columns',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM (""" + _columns_sql() + r""") m),
 'enum_values',(SELECT count(*)=2 FROM pg_enum WHERE enumtypid='public.statut_envoi'::regtype AND enumlabel IN ('parti','arrive')),
 'keys',(SELECT jsonb_agg(jsonb_build_object('table',tbl,'column',col,'parent',parent,'name',conname,'on_delete',on_delete) ORDER BY tbl,col,conname) FROM spec_keys),
 'orphans',jsonb_build_object(""" + _orphans_sql() + r"""),
 'rows',jsonb_build_object(""" + _rows_sql() + r"""),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'type',tgtype,'enabled',tgenabled::text,
   'function',tgfoid::regprocedure::text) ORDER BY tgrelid::regclass::text,tgname),'[]') FROM pg_trigger
   WHERE NOT tgisinternal AND tgrelid IN (SELECT to_regclass('public.'||t) FROM unnest(""" + sql_array(HISTORY + PARENTS) + r""") t)),
 'api_privileges',(SELECT jsonb_object_agg(t,(SELECT jsonb_object_agg(r,(SELECT coalesce(jsonb_agg(p ORDER BY p),'[]') FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE']) p
    WHERE has_table_privilege(r,'public.'||t,p))) FROM unnest(""" + sql_array(API_ROLES) + r""") r)) FROM unnest(""" + sql_array(HISTORY) + r""") t),
 'reports',jsonb_build_object(
  'keys_replaced',(SELECT coalesce(jsonb_agg(tbl||'.'||col||' ('||on_delete||')' ORDER BY tbl,col),'[]') FROM spec_keys WHERE on_delete IN ('c','n','d')),
  'keys_added',(SELECT coalesce(jsonb_agg(tbl||'.'||col ORDER BY tbl,col),'[]') FROM spec_keys WHERE conname IS NULL),
  'dossiers',(SELECT count(*) FROM public.colis),
  'dossiers_with_history',(SELECT count(*) FROM public.colis c WHERE """ + DOSSIER_HISTORY + r"""),
  'clients_with_dossiers',(SELECT count(*) FROM public.clients cl WHERE EXISTS(SELECT 1 FROM public.colis c WHERE c.client_id=cl.id)),
  'clients_with_other_history_only',(SELECT count(*) FROM public.clients cl WHERE NOT EXISTS(SELECT 1 FROM public.colis c WHERE c.client_id=cl.id) AND """ + CLIENT_OTHER_HISTORY + r"""),
  'departures_left_without_departed_at',(SELECT count(*) FROM public.envois e WHERE e.statut IN ('parti','arrive') AND e.departed_at IS NULL AND e.manifest_version=0),
  'departures_open_with_dossiers',(SELECT count(*) FROM public.envois e WHERE NOT """ + CONFIRMED + r""" AND e.statut NOT IN ('parti','arrive')
    AND EXISTS(SELECT 1 FROM public.colis c WHERE c.envoi_id=e.id)),
  'checks_of_confirmed_departures',(SELECT count(*) FROM public.departure_loading_checks k JOIN public.envois e ON e.id=k.envoi_id WHERE """ + CONFIRMED + r"""),
  'paid_links',(SELECT count(*) FROM public.payment_intents WHERE status='paid'),
  'final_deliveries',(SELECT count(*) FROM public.notification_outbox WHERE status IN ('sent','cancelled')),
  'withdrawals_recorded',(SELECT count(*) FROM public.quote_withdrawals WHERE withdrawn_at IS NOT NULL),
  'inbox_attached',(SELECT count(*) FROM public.client_inbox WHERE colis_id IS NOT NULL))
) AS state;"""

# Keys, triggers and functions before the migration, to prove that the release changes only its own.
BEFORE_SQL = r"""CREATE TEMP TABLE ret_keys_before ON COMMIT DROP AS SELECT conrelid::regclass::text tbl,conname,pg_get_constraintdef(oid) def
 FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace;
CREATE TEMP TABLE ret_triggers_before ON COMMIT DROP AS SELECT tgrelid::regclass::text tbl,tgname,pg_get_triggerdef(oid) def,tgenabled::text enabled
 FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace);
CREATE TEMP TABLE ret_functions_before ON COMMIT DROP AS SELECT oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) md5,proacl::text acl,
 pg_get_userbyid(proowner) owner,proconfig::text config FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f';"""

INVARIANTS_SQL = r"""CREATE TEMP TABLE ret_keys_after ON COMMIT DROP AS SELECT conrelid::regclass::text tbl,conname,pg_get_constraintdef(oid) def
 FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace;
DO $$
BEGIN
 IF EXISTS ((SELECT * FROM ret_before EXCEPT SELECT * FROM ret_after) UNION ALL (SELECT * FROM ret_after EXCEPT SELECT * FROM ret_before)) THEN
  RAISE EXCEPTION 'The retention release modified existing business data'; END IF;
 -- Keys: only those of the history columns change, a cascading, nulling or missing key becoming RESTRICT.
 IF EXISTS(SELECT 1 FROM (SELECT * FROM ret_keys_before EXCEPT SELECT * FROM ret_keys_after) gone
    WHERE NOT EXISTS(SELECT 1 FROM (VALUES """ + SPECS_VALUES + r""") s(tbl,col,parent) WHERE s.tbl=gone.tbl AND gone.def LIKE 'FOREIGN KEY ('||s.col||') %')
     OR NOT (gone.def LIKE '%ON DELETE CASCADE%' OR gone.def LIKE '%ON DELETE SET NULL%' OR gone.def LIKE '%ON DELETE SET DEFAULT%'))
  OR EXISTS(SELECT 1 FROM (SELECT * FROM ret_keys_after EXCEPT SELECT * FROM ret_keys_before) added
    WHERE NOT EXISTS(SELECT 1 FROM (VALUES """ + SPECS_VALUES + r""") s(tbl,col,parent) WHERE s.tbl=added.tbl AND added.def LIKE 'FOREIGN KEY ('||s.col||') %')
     OR added.def NOT LIKE '%ON DELETE RESTRICT') THEN
  RAISE EXCEPTION 'The release changed a key that was not a cascading, nulling or missing key of the history'; END IF;
 IF EXISTS (SELECT * FROM ret_triggers_before EXCEPT SELECT tgrelid::regclass::text,tgname,pg_get_triggerdef(oid),tgenabled::text FROM pg_trigger
    WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)) THEN
  RAISE EXCEPTION 'The release changed an existing trigger'; END IF;
 IF EXISTS (SELECT * FROM ret_functions_before EXCEPT SELECT oid::regprocedure::text,md5(pg_get_functiondef(oid)),proacl::text,pg_get_userbyid(proowner),proconfig::text
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f') THEN
  RAISE EXCEPTION 'The release changed an existing function, its owner, grants or configuration'; END IF;
END $$;"""

POST_CHECKS_SQL = r"""DO $$
DECLARE fn text; tbl text; r text; owner oid:=(SELECT proowner FROM pg_proc WHERE oid='public.confirm_departure(uuid,jsonb,timestamptz,text)'::regprocedure);
 previous_role text:=current_setting('role'); previous_sub text:=coalesce(current_setting('request.jwt.claim.sub',true),''); state text; message text; probe uuid;
BEGIN
 IF (SELECT jsonb_object_agg(c.relname,t.tgtype) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid AND c.relnamespace='public'::regnamespace
     WHERE t.tgname='retention_guard' AND NOT t.tgisinternal AND t.tgenabled='O' AND cardinality(t.tgattr::int2[])=0 AND t.tgqual IS NULL AND c.relname IN (""" + ','.join(sql_text(t) for t in ROW_GUARDS) + r"""))
   IS DISTINCT FROM '""" + json.dumps(ROW_GUARDS, sort_keys=True) + r"""'::jsonb
  OR (SELECT count(*) FROM pg_trigger WHERE tgname='retention_guard' AND NOT tgisinternal)<>""" + str(len(ROW_GUARDS)) + r""" THEN
  RAISE EXCEPTION 'The row guards differ from the reviewed ones'; END IF;
 IF (SELECT array_agg(c.relname::text ORDER BY c.relname COLLATE "C") FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid AND c.relnamespace='public'::regnamespace
     WHERE t.tgname='retention_truncate' AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=34 AND t.tgfoid='public._retention_truncate()'::regprocedure) IS DISTINCT FROM """ + sql_array(sorted(HISTORY)) + r"""::text[] THEN
  RAISE EXCEPTION 'The TRUNCATE guards differ from the reviewed ones'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.clients'::regclass AND NOT tgisinternal AND tgtype&3=3 AND tgname>'z_guard_client_required_fields') THEN
  RAISE EXCEPTION 'z_guard_client_required_fields must stay the last BEFORE row trigger of clients'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgname='retention_guard' AND NOT t.tgisinternal
   AND p.oid<>CASE (SELECT relname FROM pg_class WHERE oid=t.tgrelid) WHEN 'payment_intents' THEN 'public._retention_payment_intent()'::regprocedure WHEN 'messages' THEN 'public._retention_message()'::regprocedure
    WHEN 'notification_outbox' THEN 'public._retention_outbox()'::regprocedure WHEN 'quote_withdrawals' THEN 'public._retention_quote_withdrawal()'::regprocedure
    WHEN 'client_inbox' THEN 'public._retention_client_inbox()'::regprocedure WHEN 'departure_loading_checks' THEN 'public._retention_loading_check()'::regprocedure
    WHEN 'colis' THEN 'public._retention_colis_delete()'::regprocedure WHEN 'clients' THEN 'public._retention_client_delete()'::regprocedure
    WHEN 'envois' THEN 'public._retention_departure_delete()'::regprocedure ELSE 'public._retention_append_only()'::regprocedure END) THEN
  RAISE EXCEPTION 'A row guard calls an unexpected function'; END IF;
 FOREACH fn IN ARRAY """ + sql_array(sorted(NEW_SOURCE)) + r""" LOOP
  IF has_function_privilege('anon','public.'||fn,'EXECUTE') OR has_function_privilege('authenticated','public.'||fn,'EXECUTE') OR has_function_privilege('service_role','public.'||fn,'EXECUTE')
   OR (SELECT proacl IS NULL OR EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0) FROM pg_proc WHERE oid=('public.'||fn)::regprocedure)
   OR NOT (SELECT proconfig @> ARRAY['search_path=public, pg_temp'] AND prorettype='trigger'::regtype AND proowner=owner FROM pg_proc WHERE oid=('public.'||fn)::regprocedure)
   OR (SELECT prosecdef FROM pg_proc WHERE oid=('public.'||fn)::regprocedure) IS DISTINCT FROM (fn=ANY(""" + sql_array(SECURITY_DEFINER) + r""")) THEN
   RAISE EXCEPTION 'Unexpected trigger function security: %',fn; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_each_text('""" + json.dumps(NEW_SOURCE, sort_keys=True) + r"""'::jsonb) s
   WHERE md5(pg_get_functiondef(('public.'||s.key)::regprocedure)) IS DISTINCT FROM s.value) THEN
  RAISE EXCEPTION 'A trigger function differs from its reviewed body'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES """ + SPECS_VALUES + r""") s(tbl,col,parent)
   WHERE (SELECT array_agg(c.confdeltype::text) FROM pg_constraint c WHERE """ + KEY_OF_SPEC + r""") IS DISTINCT FROM ARRAY['r']
    AND (SELECT array_agg(c.confdeltype::text) FROM pg_constraint c WHERE """ + KEY_OF_SPEC + r""") IS DISTINCT FROM ARRAY['a']) THEN
  RAISE EXCEPTION 'A history column lacks its single RESTRICT or NO ACTION key'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.departure_loading_checks'::regclass AND contype='f' AND confdeltype='c')<>3 THEN
  RAISE EXCEPTION 'The loading checks must keep their three cascading keys (working state before the confirmation)'; END IF;
 FOREACH tbl IN ARRAY """ + sql_array(APPEND_ONLY) + r""" LOOP
  FOREACH r IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
   IF has_table_privilege(r,'public.'||tbl,'UPDATE') OR has_table_privilege(r,'public.'||tbl,'DELETE') OR has_table_privilege(r,'public.'||tbl,'TRUNCATE') THEN
    RAISE EXCEPTION 'The API role % may still rewrite %',r,tbl; END IF;
  END LOOP;
 END LOOP;
 FOREACH tbl IN ARRAY """ + sql_array(GUARDED) + r""" LOOP
  FOREACH r IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
   IF has_table_privilege(r,'public.'||tbl,'DELETE') OR has_table_privilege(r,'public.'||tbl,'TRUNCATE') THEN RAISE EXCEPTION 'The API role % may still erase %',r,tbl; END IF;
  END LOOP;
 END LOOP;
 -- A deletion under the API role (as PostgREST sets it) is refused before any row is read; role restored at once.
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
 PERFORM set_config('role','authenticated',true);
 BEGIN
  EXECUTE 'DELETE FROM public.messages WHERE false';
  state:='accepted';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE;
 END;
 PERFORM set_config('role',previous_role,true);
 PERFORM set_config('request.jwt.claim.sub',previous_sub,true);
 IF state IS DISTINCT FROM '""" + API_MESSAGE_STATE + r"""' THEN RAISE EXCEPTION 'A deletion under the API role was not refused: %',state; END IF;
 -- A rewrite of a recorded payment by the owner is refused by its guard (in a subtransaction, nothing written).
 SELECT id INTO probe FROM public.paiements ORDER BY created_at,id LIMIT 1;
 IF probe IS NOT NULL THEN
  BEGIN
   UPDATE public.paiements SET montant=montant WHERE id=probe;
   state:='accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
  END;
  IF state IS DISTINCT FROM '23001' OR message IS DISTINCT FROM """ + sql_text(PAYMENT_MESSAGE) + r""" THEN
   RAISE EXCEPTION 'A rewrite of a recorded payment was not refused as reviewed: % %',state,message; END IF;
 END IF;
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
    # Row count plus an md5 over the sorted row hashes of every business table, before and after.
    parts = []
    for table in FINGERPRINTED:
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
    relied = {f['signature']: f for f in current['relied']}
    for signature, expected in UNCHANGED_SOURCE.items():
        if not relied[signature]['present'] or relied[signature]['md5'] != expected:
            problems.append('production source differs from the reviewed baseline: ' + signature)
    # regclass and regprocedure print the schema only when public is not on the search path.
    bare = lambda name: name[len('public.'):] if name.startswith('public.') else name
    triggers = sorted((bare(t['table']), t['name'], t['type'], t['enabled'], bare(t['function'])) for t in current['triggers']
                      if bare(t['table']) in HISTORY and t['name'] not in ('retention_guard', 'retention_truncate'))
    if triggers != REVIEWED_TRIGGERS:
        problems.append('triggers of the history tables differ from the reviewed baseline: '
                        + ', '.join(sorted({'.'.join(t[:2]) for t in set(triggers) ^ set(REVIEWED_TRIGGERS)})))
    missing = current['missing_tables'] + current['missing_columns'] + ([] if current['enum_values'] else ['statut_envoi parti/arrive'])
    if missing:
        problems.append('missing dependencies: ' + ', '.join(missing))
    orphans = {column: count for column, count in current['orphans'].items() if count}
    if orphans:
        problems.append('orphan rows (a key cannot be added): ' + ', '.join(column + '=' + str(count) for column, count in sorted(orphans.items())))
    return problems


def summary(current):
    # Counts only on screen; references and details stay in the private backup.
    return {'rows': current['rows'], 'keys_replaced': current['reports']['keys_replaced'], 'keys_added': current['reports']['keys_added'],
            'api_privileges_revoked': {table: {role: privileges for role, privileges in roles.items() if privileges}
                                       for table, roles in current['api_privileges'].items() if any(roles.values())},
            **{key: value for key, value in current['reports'].items() if key not in ('keys_replaced', 'keys_added')}}


def preflight():
    if (FOLDER / 'applied.json').exists():
        raise RuntimeError('Already applied; preserve the original backup and verify.')
    current = state()
    problems = baseline_problems(current)
    if problems:
        raise RuntimeError('Preflight refused: ' + '; '.join(problems) + '. Compare with the repository before any rehearsal.')
    save('before.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current,
                         'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'private_backup': str(FOLDER / 'before.json'), 'sha256': digest(), 'tables_fingerprinted': len(FINGERPRINTED),
                      'latest_registered': current['latest_registered'], 'relied': 'as reviewed', 'report': summary(current)},
                     indent=2, ensure_ascii=False))
    if current['reports']['departures_open_with_dossiers']:
        print('NOTE: once applied, a departure that still carries dossiers can no longer be deleted (RLS already kept them from the screens).')


def transaction_sql(register=False):
    migration = FILE.read_text()
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';\n"
    sql += 'CREATE TEMP TABLE ret_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += BEFORE_SQL + '\n'
    sql += migration + '\n'
    # Post checks first: the after fingerprints also prove that their refused probes left nothing.
    sql += POST_CHECKS_SQL + '\n'
    sql += 'CREATE TEMP TABLE ret_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += INVARIANTS_SQL + '\n'
    if register:
        sql += ("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + VERSION + "','" + NAME
                + "',ARRAY['" + migration.replace("'", "''") + "']);\nNOTIFY pgrst,'reload schema'; COMMIT;")
    else:
        sql += 'ROLLBACK;'
    return sql


def unchanged_since_preflight():
    before = load('before.json')['state']
    current = state()
    return (current['relied'] == before['relied'] and current['keys'] == before['keys'] and current['triggers'] == before['triggers']
            and current['api_privileges'] == before['api_privileges'] and not current['existing_new_objects'] and not current['registered']
            and not baseline_problems(current))


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
    assert current['relied'] == before['relied'], 'a relied writer changed since the preflight'
    assert sorted(name.split(' ', 1)[0] for name in current['existing_new_objects']) == sorted(
        ['function'] * len(NEW_SOURCE) + ['trigger'] * (len(ROW_GUARDS) + len(HISTORY))), 'unexpected objects of the release'
    assert all(key['on_delete'] in ('r', 'a') for key in current['keys']), 'a history key still cascades or is missing'
    # The Management API read-only mode rejects DO blocks: run the read-only checks in a rolled-back transaction.
    query('BEGIN;\n' + POST_CHECKS_SQL + '\nROLLBACK;', False)
    save('verified.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current, 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'registered': VERSION, 'sha256': digest(), 'row_guards': len(ROW_GUARDS), 'truncate_guards': len(HISTORY),
                      'functions': len(NEW_SOURCE), 'report': summary(current)}, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
