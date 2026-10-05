"""Release of the invoice, quote and payment rules (D1-D4, 2026-10-04) without rewriting business data.

Operations, each run separately and only with the user's explicit go-ahead (runbook §9, steps 2-4):
  preflight  read-only: refuses when already registered or when the production baseline differs from the
             reviewed repository; saves definitions, ACLs, fingerprints and reports privately (mode 0600).
  rehearse   write transaction rolled back: migration plus invariants (data unchanged, one freeze predicate
             on the real dossiers, client view and guarded commands changed exactly as reviewed, grants).
  apply      same transaction, registered in schema_migrations, schema reload requested, committed.
  verify     read-only checks; the view comparison uses a temporary view in a rolled-back transaction.
Credentials stay in memory (management.py). Nothing runs at import. No provider, message or OCR call.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request
from task_owner_guards20260921 import TABLES

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / 'pinta/supabase/migrations/20261004000001_invoice_quote_rules.sql'
FOLDER = ROOT / '.deployment-backups/2026-10-04-invoice-quote-rules'
VERSION = '20261004000001'
NAME = 'invoice_quote_rules'
# Replaced whole by the migration: the production source must be the reviewed one (local replay of 20261003000002).
EXPECTED_SOURCE = {
    '_assert_unpaid_dossier(uuid)': '5e8a334d7c0485ee81d52bf82b7dd7f1',
    'invalidate_quote_on_document()': 'c81f3b1781b8403ecdc762ea2d316c43',
    'queue_ocr_document()': 'b8cf8c69ffc6ae515019ee21979b855e',
    'get_invoice_review_context(uuid)': 'bdc4b43eb1f1cdb50fd4675e78ce9c9d',
    'sync_staff_work_actions(uuid)': '72d17145521a27ebecd672d74ae0b21b',
    'register_requested_invoice(uuid,text)': '1b87dbaadd9ce3c699fcd27359293970',
}
# Changed by one guarded line inserted before a unique anchor (checked by the migration and below).
INJECTED = {
    'save_invoice_review(uuid,text,text,jsonb,numeric,text,uuid,boolean)': ' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=p_facture_id),NOT p_confirm AND NOT coalesce((SELECT valide FROM factures WHERE id=p_facture_id),false));',
    'classify_invoice_duplicate(uuid,uuid,text,text)': ' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=p_facture_id),false);',
    'restore_invoice_duplicate(uuid,text)': ' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=p_facture_id),false);',
    'import_conversation_invoice(uuid)': ' PERFORM _assert_invoices_editable(m.colis_id,false);',
    'confirm_ocr_extraction_current(uuid,text,text,jsonb,numeric,text)': ' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=invoice_id),false);',
}
MARKERS = {
    '_assert_unpaid_dossier(uuid)': '_dossier_frozen_reason(c)',
    'invalidate_quote_on_document()': '_open_late_invoice_request(c,NEW.id,client_source)',
    'queue_ocr_document()': 'IF NEW.valide OR NEW.duplicate_of_facture_id IS NOT NULL THEN RETURN NEW; END IF;',
    'get_invoice_review_context(uuid)': "'analysisAllowed'",
    'sync_staff_work_actions(uuid)': 'late_state',
    'register_requested_invoice(uuid,text)': 'register_telegram_document(p_message_id,p_reply_message_id,NULL)',
}

PREFLIGHT_SQL = r"""WITH commands AS (
 SELECT s.signature,s.anchor,s.owner_guarded,p.oid,pg_get_functiondef(p.oid) definition FROM (VALUES
  ('_assert_unpaid_dossier(uuid)',NULL,false),('invalidate_quote_on_document()',NULL,false),('queue_ocr_document()',NULL,false),
  ('get_invoice_review_context(uuid)',NULL,false),('sync_staff_work_actions(uuid)',NULL,false),('register_requested_invoice(uuid,text)',NULL,false),
  ('save_invoice_review(uuid,text,text,jsonb,numeric,text,uuid,boolean)',' SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;',true),
  ('classify_invoice_duplicate(uuid,uuid,text,text)',' SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;',true),
  ('restore_invoice_duplicate(uuid,text)',' SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;',true),
  ('import_conversation_invoice(uuid)',' SELECT * INTO c FROM colis WHERE id=m.colis_id FOR UPDATE;',false),
  ('confirm_ocr_extraction_current(uuid,text,text,jsonb,numeric,text)',' SELECT * INTO f FROM factures WHERE id=invoice_id FOR UPDATE;',true)
 ) s(signature,anchor,owner_guarded) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||s.signature)),
view AS (SELECT c.oid,pg_get_viewdef(c.oid,true) definition,c.relacl,c.relowner,c.reloptions FROM pg_class c WHERE c.oid='public.client_colis'::regclass),
live AS (SELECT c.* FROM public.colis c WHERE NOT coalesce((c.archive
  OR c.statut NOT IN ('receptionne','mesure','attente_feu_vert','autorise','refuse_client','en_preparation','devis_envoye','attente_paiement')
  OR c.paiement_date IS NOT NULL OR c.paiement_montant IS NOT NULL OR c.date_expedition IS NOT NULL
  OR EXISTS(SELECT 1 FROM public.paiements WHERE colis_id=c.id AND statut='confirme')
  OR EXISTS(SELECT 1 FROM public.payment_intents WHERE colis_id=c.id AND status='paid')
  OR EXISTS(SELECT 1 FROM public.legacy_payplug_payments WHERE colis_id=c.id AND (observed_payment_date IS NOT NULL OR observed_payment_amount IS NOT NULL))
  OR EXISTS(SELECT 1 FROM public.envois WHERE id=c.envoi_id AND (departed_at IS NOT NULL OR manifest_version>0))),false))
SELECT jsonb_build_object(
 'registered',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261004000001'),
 'existing_new_objects',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM (
   SELECT 'function '||p.proname x FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('_dossier_frozen_reason','_frozen_message','_live_payment_link','_quote_locked',
    '_invoice_analysis_reason','_identical_validated_invoice','_late_invoice_open','_late_invoice_withdrawal','_assert_invoices_editable','_open_late_invoice_request','_withdraw_quote',
    '_open_invoice_modification','_import_conversation_attachment','guard_invoice_lock','guard_invoice_analysis','close_quote_withdrawals','invoice_lock_state','invoice_analysis_gate',
    'client_document_precheck','register_telegram_document','register_late_invoice_from_message','claim_quote_withdrawal','release_quote_withdrawal','complete_quote_withdrawal',
    'mark_quote_withdrawal_message','open_invoice_modification','close_invoice_modification','withdraw_quote_for_documents','deposit_client_invoice',
    '_assert_withdrawal_followup','withdraw_quote_preflight')
   UNION ALL SELECT 'table quote_withdrawals' WHERE to_regclass('public.quote_withdrawals') IS NOT NULL
   UNION ALL SELECT 'trigger '||tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('a0_guard_invoice_lock','a0_guard_invoice_analysis','y_close_quote_withdrawals','z_sync_quote_withdrawal_work')) s),
 'commands',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'present',oid IS NOT NULL,'md5',md5(definition),'definition',definition,
   'owner',(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=commands.oid),'acl',(SELECT proacl FROM pg_proc WHERE oid=commands.oid),
   'security_definer',(SELECT prosecdef FROM pg_proc WHERE oid=commands.oid),'config',(SELECT proconfig FROM pg_proc WHERE oid=commands.oid),
   'anon',CASE WHEN oid IS NOT NULL THEN has_function_privilege('anon',oid,'EXECUTE') END,'authenticated',CASE WHEN oid IS NOT NULL THEN has_function_privilege('authenticated',oid,'EXECUTE') END,
   'service',CASE WHEN oid IS NOT NULL THEN has_function_privilege('service_role',oid,'EXECUTE') END,
   'anchor_count',CASE WHEN anchor IS NOT NULL THEN (length(definition)-length(replace(definition,anchor,'')))/length(anchor) END,
   'owner_guard_ok',NOT owner_guarded OR position('_assert_staff_task_owner(' IN definition)>0,'already_guarded',position('_assert_invoices_editable(' IN definition)>0) ORDER BY signature) FROM commands),
 'view',(SELECT jsonb_build_object('definition',definition,'md5',md5(definition),'acl',relacl,'owner',pg_get_userbyid(relowner),'options',reloptions,
   'link_anchor_count',(length(definition)-length(replace(definition,'THEN payplug_payment_url','')))/length('THEN payplug_payment_url')
    +(length(definition)-length(replace(definition,'THEN colis.payplug_payment_url','')))/length('THEN colis.payplug_payment_url'),
   'from_anchor_count',(length(definition)-length(replace(definition,E'\n   FROM colis','')))/length(E'\n   FROM colis'),
   'already_extended',position('quote_withdrawals' IN definition)>0 OR position('quote_update_pending' IN definition)>0) FROM view),
 'ocr_job_checks',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname),'[]') FROM pg_constraint
   WHERE conrelid='public.ocr_jobs'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%'),
 'reports',jsonb_build_object(
  'quote_sent',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'ref',ref,'statut',statut,'quote_version',quote_version,'link',payplug_payment_url IS NOT NULL) ORDER BY ref),'[]') FROM public.colis WHERE statut IN ('devis_envoye','attente_paiement')),
  'live_links_open_dossiers',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind','intent','id',i.id,'colis_id',i.colis_id,'ref',l.ref,'status',i.status,'quote_version',i.quote_version,
     'current',i.provider_id IS NOT DISTINCT FROM l.payplug_payment_id AND i.quote_version=l.quote_version) ORDER BY l.ref,i.created_at),'[]')
    FROM public.payment_intents i JOIN live l ON l.id=i.colis_id WHERE i.provider_id IS NOT NULL AND i.provider_cancelled_at IS NULL AND i.status<>'paid'),
  'legacy_links_open_dossiers',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind','legacy','provider_id',g.provider_id,'colis_id',g.colis_id,'ref',l.ref,'invalidated',g.invalidated_at IS NOT NULL) ORDER BY l.ref),'[]')
    FROM public.legacy_payplug_payments g JOIN live l ON l.id=g.colis_id WHERE g.provider_cancelled_at IS NULL),
  'orphan_urls',(SELECT coalesce(jsonb_agg(jsonb_build_object('colis_id',id,'ref',ref,'statut',statut) ORDER BY ref),'[]') FROM live WHERE payplug_payment_url IS NOT NULL AND payplug_payment_id IS NULL),
  'creating_intents',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'colis_id',colis_id,'quote_version',quote_version,'created_at',created_at) ORDER BY created_at),'[]') FROM public.payment_intents WHERE status='creating'),
  'validated_with_draft',(SELECT coalesce(jsonb_agg(jsonb_build_object('facture_id',f.id,'colis_id',f.colis_id,'draft_updated_at',d.updated_at) ORDER BY d.updated_at),'[]') FROM public.factures f JOIN public.invoice_review_drafts d ON d.facture_id=f.id WHERE f.valide),
  'ocr_jobs_on_validated',(SELECT coalesce(jsonb_agg(jsonb_build_object('facture_id',j.facture_id,'status',j.status,'copy',f.duplicate_of_facture_id IS NOT NULL) ORDER BY j.created_at),'[]') FROM public.ocr_jobs j JOIN public.factures f ON f.id=j.facture_id
    WHERE j.status IN ('pending','processing') AND (f.valide OR f.duplicate_of_facture_id IS NOT NULL)),
  'amount_without_date',(SELECT coalesce(jsonb_agg(jsonb_build_object('colis_id',id,'ref',ref,'statut',statut) ORDER BY ref),'[]') FROM public.colis WHERE paiement_montant IS NOT NULL AND paiement_date IS NULL))
) AS state;"""

BEFORE_SQL = r"""CREATE TEMP TABLE iqr_view_before ON COMMIT DROP AS SELECT pg_get_viewdef('public.client_colis'::regclass,true) definition,relacl,relowner,reloptions FROM pg_class WHERE oid='public.client_colis'::regclass;
CREATE TEMP TABLE iqr_injections ON COMMIT DROP AS SELECT * FROM (VALUES
 ('save_invoice_review(uuid,text,text,jsonb,numeric,text,uuid,boolean)',' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=p_facture_id),NOT p_confirm AND NOT coalesce((SELECT valide FROM factures WHERE id=p_facture_id),false));'),
 ('classify_invoice_duplicate(uuid,uuid,text,text)',' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=p_facture_id),false);'),
 ('restore_invoice_duplicate(uuid,text)',' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=p_facture_id),false);'),
 ('import_conversation_invoice(uuid)',' PERFORM _assert_invoices_editable(m.colis_id,false);'),
 ('confirm_ocr_extraction_current(uuid,text,text,jsonb,numeric,text)',' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=invoice_id),false);')) x(signature,guard);
CREATE TEMP TABLE iqr_commands_before ON COMMIT DROP AS SELECT s.signature,p.oid,pg_get_functiondef(p.oid) definition,p.proacl acl,p.proowner owner FROM unnest(ARRAY[
 '_assert_unpaid_dossier(uuid)','invalidate_quote_on_document()','queue_ocr_document()','get_invoice_review_context(uuid)','sync_staff_work_actions(uuid)','register_requested_invoice(uuid,text)',
 'save_invoice_review(uuid,text,text,jsonb,numeric,text,uuid,boolean)','classify_invoice_duplicate(uuid,uuid,text,text)','restore_invoice_duplicate(uuid,text)','import_conversation_invoice(uuid)',
 'confirm_ocr_extraction_current(uuid,text,text,jsonb,numeric,text)']) s(signature) JOIN pg_proc p ON p.oid=('public.'||s.signature)::regprocedure;"""

INVARIANTS_SQL = r"""DO $$
DECLARE mismatch integer; old record; expected text; anchor text; tail text:=E'\n   FROM colis'; item record; definition text;
BEGIN
 IF EXISTS ((SELECT * FROM iqr_before EXCEPT SELECT * FROM iqr_after) UNION ALL (SELECT * FROM iqr_after EXCEPT SELECT * FROM iqr_before)) THEN
  RAISE EXCEPTION 'Invoice rules release modified existing business data'; END IF;
 IF EXISTS(SELECT 1 FROM public.quote_withdrawals) THEN RAISE EXCEPTION 'Withdrawal requests must start empty'; END IF;
 SELECT count(*) INTO mismatch FROM public.colis c WHERE (public._dossier_frozen_reason(c) IS NOT NULL) IS DISTINCT FROM coalesce((c.archive
  OR c.statut NOT IN ('receptionne','mesure','attente_feu_vert','autorise','refuse_client','en_preparation','devis_envoye','attente_paiement')
  OR c.paiement_date IS NOT NULL OR c.paiement_montant IS NOT NULL OR c.date_expedition IS NOT NULL
  OR EXISTS(SELECT 1 FROM public.paiements WHERE colis_id=c.id AND statut='confirme')
  OR EXISTS(SELECT 1 FROM public.payment_intents WHERE colis_id=c.id AND status='paid')
  OR EXISTS(SELECT 1 FROM public.legacy_payplug_payments WHERE colis_id=c.id AND (observed_payment_date IS NOT NULL OR observed_payment_amount IS NOT NULL))
  OR EXISTS(SELECT 1 FROM public.envois WHERE id=c.envoi_id AND (departed_at IS NOT NULL OR manifest_version>0))),false);
 IF mismatch<>0 THEN RAISE EXCEPTION 'Freeze predicate differs from the 2026-10-03 evidence on % real dossiers',mismatch; END IF;
 SELECT * INTO old FROM iqr_view_before;
 anchor:=CASE WHEN position('THEN colis.payplug_payment_url' IN old.definition)>0 THEN 'THEN colis.payplug_payment_url' ELSE 'THEN payplug_payment_url' END;
 expected:=replace(replace(old.definition,anchor,'AND NOT (EXISTS (SELECT 1 FROM quote_withdrawals w WHERE w.colis_id = colis.id AND w.status IN (''pending'',''processing'',''needs_review''))) '||anchor),
  tail,','||E'\n    (EXISTS (SELECT 1 FROM quote_withdrawals w WHERE w.colis_id = colis.id AND w.source <> ''staff'' AND w.closed_at IS NULL AND w.status IN (''pending'',''processing'',''needs_review'',''withdrawn''))) AS quote_update_pending'||tail);
 EXECUTE 'CREATE TEMP VIEW iqr_expected_client_colis AS '||expected;
 IF pg_get_viewdef('iqr_expected_client_colis'::regclass,true)<>pg_get_viewdef('public.client_colis'::regclass,true)
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid='public.client_colis'::regclass AND (relacl,relowner,reloptions) IS DISTINCT FROM (old.relacl,old.relowner,old.reloptions)) THEN
  RAISE EXCEPTION 'Client projection changed beyond the two late-invoice fragments'; END IF;
 DROP VIEW iqr_expected_client_colis;
 FOR item IN SELECT b.*,i.guard FROM iqr_commands_before b LEFT JOIN iqr_injections i USING(signature) LOOP
  definition:=pg_get_functiondef(item.oid);
  IF (SELECT (proacl,proowner) IS DISTINCT FROM (item.acl,item.owner) OR NOT prosecdef OR NOT proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid=item.oid) THEN
   RAISE EXCEPTION 'Command lost its owner, grants or definer security: %',item.signature; END IF;
  IF item.guard IS NOT NULL AND ((length(definition)-length(replace(definition,item.guard,'')))/length(item.guard)<>1 OR replace(definition,item.guard||E'\n','')<>item.definition
   OR NOT has_function_privilege(item.owner,'public._assert_invoices_editable(uuid,boolean)','EXECUTE')) THEN
   RAISE EXCEPTION 'Guard not injected exactly once, or other changes in: %',item.signature; END IF;
 END LOOP;
END $$;"""

POST_CHECKS_SQL = r"""DO $$
DECLARE fn text; owner oid:=(SELECT proowner FROM pg_proc WHERE oid='public.save_quote(uuid,jsonb,timestamptz)'::regprocedure);
BEGIN
 FOREACH fn IN ARRAY ARRAY['_dossier_frozen_reason(colis)','_frozen_message(text)','_live_payment_link(colis)','_quote_locked(colis)','_invoice_analysis_reason(factures)',
  '_identical_validated_invoice(uuid,text)','_late_invoice_open(uuid)','_late_invoice_withdrawal(factures)','_assert_invoices_editable(uuid,boolean)',
  '_open_late_invoice_request(colis,uuid,text)','_withdraw_quote(colis,text,text,text,uuid,uuid[])','_open_invoice_modification(uuid,text)',
  '_import_conversation_attachment(uuid,uuid)','guard_invoice_lock()','guard_invoice_analysis()','close_quote_withdrawals()','_assert_withdrawal_followup(uuid,text,uuid,text,uuid)'] LOOP
  IF has_function_privilege('anon','public.'||fn,'EXECUTE') OR has_function_privilege('authenticated','public.'||fn,'EXECUTE') OR has_function_privilege('service_role','public.'||fn,'EXECUTE')
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner FROM pg_proc WHERE oid=('public.'||fn)::regprocedure) THEN
   RAISE EXCEPTION 'Unexpected private helper security: %',fn; END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['invoice_lock_state(uuid)','invoice_analysis_gate(uuid)','client_document_precheck(uuid,uuid,text,text)','register_telegram_document(uuid,text,text)',
  'register_late_invoice_from_message(uuid,text)','claim_quote_withdrawal(uuid,boolean)','release_quote_withdrawal(uuid,text,text)','complete_quote_withdrawal(uuid)',
  'mark_quote_withdrawal_message(uuid,integer,text,uuid,text)','withdraw_quote_preflight(uuid,text,uuid,text,uuid)'] LOOP
  IF has_function_privilege('anon','public.'||fn,'EXECUTE') OR has_function_privilege('authenticated','public.'||fn,'EXECUTE') OR NOT has_function_privilege('service_role','public.'||fn,'EXECUTE')
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner FROM pg_proc WHERE oid=('public.'||fn)::regprocedure) THEN
   RAISE EXCEPTION 'Unexpected service command security: %',fn; END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['open_invoice_modification(uuid,text)','close_invoice_modification(uuid,text)','withdraw_quote_for_documents(uuid,timestamptz,text,text,uuid,text,uuid)',
  'deposit_client_invoice(uuid,text,text,text,uuid)'] LOOP
  IF has_function_privilege('anon','public.'||fn,'EXECUTE') OR has_function_privilege('service_role','public.'||fn,'EXECUTE') OR NOT has_function_privilege('authenticated','public.'||fn,'EXECUTE')
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND proowner=owner FROM pg_proc WHERE oid=('public.'||fn)::regprocedure) THEN
   RAISE EXCEPTION 'Unexpected staff or client command security: %',fn; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.register_requested_invoice(uuid,text)','EXECUTE') OR has_function_privilege('authenticated','public.register_requested_invoice(uuid,text)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.register_requested_invoice(uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Telegram compatibility wrapper changed grants'; END IF;
 IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled='O' AND (t.tgrelid,t.tgname) IN (('public.factures'::regclass,'a0_guard_invoice_lock'),
  ('public.lignes'::regclass,'a0_guard_invoice_lock'),('public.ocr_extractions'::regclass,'a0_guard_invoice_analysis'),('public.invoice_review_drafts'::regclass,'a0_guard_invoice_analysis'),
  ('public.colis'::regclass,'y_close_quote_withdrawals'),('public.quote_withdrawals'::regclass,'z_sync_quote_withdrawal_work')))<>6 THEN RAISE EXCEPTION 'Missing or disabled invoice rule trigger'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.quote_withdrawals'::regclass)
  OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='quote_withdrawals')<>1
  OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quote_withdrawals' AND policyname='quote_withdrawals_staff_read' AND cmd='SELECT')
  OR has_table_privilege('anon','public.quote_withdrawals','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_table_privilege('authenticated','public.quote_withdrawals','INSERT,UPDATE,DELETE,TRUNCATE') OR NOT has_table_privilege('authenticated','public.quote_withdrawals','SELECT')
  OR has_table_privilege('service_role','public.quote_withdrawals','INSERT,UPDATE,DELETE,TRUNCATE') OR NOT has_table_privilege('service_role','public.quote_withdrawals','SELECT')
  OR has_table_privilege('authenticated','public.quote_withdrawals','REFERENCES,TRIGGER') OR has_table_privilege('service_role','public.quote_withdrawals','REFERENCES,TRIGGER') THEN
  RAISE EXCEPTION 'Unexpected withdrawal request table security'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.ocr_jobs'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%')<>1
  OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ocr_jobs'::regclass AND conname='ocr_jobs_status_check' AND pg_get_constraintdef(oid) LIKE '%''skipped''%') THEN
  RAISE EXCEPTION 'Unexpected OCR job status constraint'; END IF;
 IF (SELECT count(*) FROM public.colis c WHERE (public._dossier_frozen_reason(c) IS NOT NULL) IS DISTINCT FROM coalesce((c.archive
  OR c.statut NOT IN ('receptionne','mesure','attente_feu_vert','autorise','refuse_client','en_preparation','devis_envoye','attente_paiement')
  OR c.paiement_date IS NOT NULL OR c.paiement_montant IS NOT NULL OR c.date_expedition IS NOT NULL
  OR EXISTS(SELECT 1 FROM public.paiements WHERE colis_id=c.id AND statut='confirme')
  OR EXISTS(SELECT 1 FROM public.payment_intents WHERE colis_id=c.id AND status='paid')
  OR EXISTS(SELECT 1 FROM public.legacy_payplug_payments WHERE colis_id=c.id AND (observed_payment_date IS NOT NULL OR observed_payment_amount IS NOT NULL))
  OR EXISTS(SELECT 1 FROM public.envois WHERE id=c.envoi_id AND (departed_at IS NOT NULL OR manifest_version>0))),false))<>0 THEN
  RAISE EXCEPTION 'Freeze predicate differs from the 2026-10-03 evidence on real dossiers'; END IF;
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
    # The 17 business tables of the previous releases, plus the OCR queue and analyses touched by D1/D4.
    parts = []
    for table in TABLES + ['ocr_jobs', 'ocr_extractions']:
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
    commands = {c['signature']: c for c in current['commands']}
    for signature, expected in EXPECTED_SOURCE.items():
        if not commands[signature]['present'] or commands[signature]['md5'] != expected:
            problems.append('production source differs from the reviewed baseline: ' + signature)
    for signature in INJECTED:
        command = commands[signature]
        if not command['present'] or command['anchor_count'] != 1 or not command['owner_guard_ok'] or command['already_guarded']:
            problems.append('unexpected source for the guarded command: ' + signature)
    view = current['view']
    if view['link_anchor_count'] != 1 or view['from_anchor_count'] != 1 or view['already_extended']:
        problems.append('unexpected client_colis view anchors')
    if len(current['ocr_job_checks']) != 1:
        problems.append('unexpected OCR job status constraints')
    return problems


def preflight():
    if (FOLDER / 'applied.json').exists():
        raise RuntimeError('Already applied; preserve the original backup and verify.')
    current = state()
    problems = baseline_problems(current)
    if problems:
        raise RuntimeError('Preflight refused: ' + '; '.join(problems) + '. Compare with the repository before any rehearsal.')
    save('before.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current,
                         'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'private_backup': str(FOLDER / 'before.json'), 'sha256': digest(), 'tables_protected': len(TABLES) + 2,
                      'ocr_job_check': current['ocr_job_checks'][0]['name'],
                      'reports': {name: len(rows) for name, rows in current['reports'].items()}}, indent=2))


def transaction_sql(register=False):
    migration = FILE.read_text()
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"
    sql += 'CREATE TEMP TABLE iqr_before ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
    sql += BEFORE_SQL + '\n'
    sql += migration + '\n'
    sql += 'CREATE TEMP TABLE iqr_after ON COMMIT DROP AS ' + fingerprints_sql() + ';\n'
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
    return (current['commands'] == before['commands'] and current['view'] == before['view']
            and current['ocr_job_checks'] == before['ocr_job_checks'] and not current['existing_new_objects'] and not current['registered'])


def rehearse():
    check_hash('before.json')
    if not unchanged_since_preflight():
        raise RuntimeError('Production changed since preflight: repeat preflight.')
    query(transaction_sql(), False)
    if not unchanged_since_preflight():
        raise RuntimeError('Rollback did not restore the baseline.')
    save('rehearsed.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'rolled_back': True, 'business_data_unchanged': True})
    print('Invoice rules rehearsed: business data unchanged, one freeze predicate on real dossiers, rollback verified.')


def apply():
    check_hash('before.json')
    check_hash('rehearsed.json')
    if not unchanged_since_preflight():
        raise RuntimeError('Production changed after rehearsal: repeat preflight and rehearsal.')
    query(transaction_sql(True), False)
    save('applied.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'business_data_unchanged_during_apply': True})
    print('Invoice rules committed and registered; business data unchanged; schema reload requested.')


def view_check_sql(previous):
    # Same two fragments applied to the saved definition, deparsed by PostgreSQL itself, then rolled back.
    literal = "'" + previous.replace("'", "''") + "'"
    return ("BEGIN;\nDO $iqr$ DECLARE old text:=" + literal + r"""; anchor text; tail text:=E'\n   FROM colis'; expected text; BEGIN
 anchor:=CASE WHEN position('THEN colis.payplug_payment_url' IN old)>0 THEN 'THEN colis.payplug_payment_url' ELSE 'THEN payplug_payment_url' END;
 expected:=replace(replace(old,anchor,'AND NOT (EXISTS (SELECT 1 FROM quote_withdrawals w WHERE w.colis_id = colis.id AND w.status IN (''pending'',''processing'',''needs_review''))) '||anchor),
  tail,','||E'\n    (EXISTS (SELECT 1 FROM quote_withdrawals w WHERE w.colis_id = colis.id AND w.source <> ''staff'' AND w.closed_at IS NULL AND w.status IN (''pending'',''processing'',''needs_review'',''withdrawn''))) AS quote_update_pending'||tail);
 EXECUTE 'CREATE TEMP VIEW iqr_expected_client_colis AS '||expected;
 IF pg_get_viewdef('iqr_expected_client_colis'::regclass,true)<>pg_get_viewdef('public.client_colis'::regclass,true) THEN
  RAISE EXCEPTION 'Client projection differs from the reviewed late-invoice change'; END IF;
END $iqr$;
ROLLBACK;""")


def verify():
    check_hash('applied.json')
    assert query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + VERSION + "'") == [{'version': VERSION}]
    before = load('before.json')['state']
    current = state()
    previous = {c['signature']: c for c in before['commands']}
    commands = {c['signature']: c for c in current['commands']}
    for signature, guard in INJECTED.items():
        definition = commands[signature]['definition']
        assert definition.count(guard) == 1 and definition.replace(guard + '\n', '', 1) == previous[signature]['definition'], signature
    for signature, marker in MARKERS.items():
        assert marker in commands[signature]['definition'], signature
    for signature, command in commands.items():
        assert command['acl'] == previous[signature]['acl'] and command['owner'] == previous[signature]['owner'], signature
        assert command['security_definer'] and 'search_path=public, pg_temp' in command['config'], signature
    assert current['view']['acl'] == before['view']['acl'] and current['view']['owner'] == before['view']['owner'] and current['view']['options'] == before['view']['options']
    # The Management API read-only mode rejects DO blocks: run the read-only checks in a rolled-back transaction.
    query('BEGIN;\n' + POST_CHECKS_SQL + '\nROLLBACK;', False)
    query(view_check_sql(before['view']['definition']), False)
    save('verified.json', {'sha256': digest(), 'at': datetime.now(timezone.utc).isoformat(), 'state': current, 'fingerprints': query(fingerprints_sql())})
    print(json.dumps({'registered': VERSION, 'guarded_commands': len(INJECTED), 'replaced_commands': len(MARKERS),
                      'client_view': 'old definition plus the two late-invoice fragments', 'grants_and_triggers': 'as reviewed'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'rehearse', 'apply', 'verify'])
    globals()[parser.parse_args().operation]()
