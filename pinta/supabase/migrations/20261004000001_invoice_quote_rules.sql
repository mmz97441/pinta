-- Invoice, quote and payment rules decided on 2026-10-04 (D1-D4).
-- D1 a validated invoice is never re-analysed unless « Modifier la vérification » opened a draft.
-- D2 staff changes to quoted pieces after the quote was sent require an explicit withdrawal:
--    the PayPlug link is cancelled first (Edge), then the quote is withdrawn and versioned here.
-- D3 a late client invoice opens a durable withdrawal request; the quote stays payable until
--    PayPlug confirms the abort, then the request is completed and the client is told once.
-- D4 the same evidence as _assert_unpaid_dossier freezes invoices, articles, analyses and drafts.
-- No business row is rewritten. Provider calls and messages stay in Edge functions.

CREATE TABLE quote_withdrawals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 colis_id uuid NOT NULL REFERENCES colis(id),
 source text NOT NULL CHECK (source IN ('staff','portal','telegram','conversation_import')),
 action text CHECK (action IS NULL OR action IN ('open_modification','replace_document','add_document','classify_duplicate',
   'restore_duplicate','request_correction','manual_articles','import_attachment')),
 quote_version integer NOT NULL,
 facture_ids uuid[] NOT NULL DEFAULT '{}',
 reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
 requested_by uuid REFERENCES profiles(id),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','withdrawn','paid','needs_review','superseded')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 locked_at timestamptz, last_error text,
 withdrawn_at timestamptz, withdrawn_quote_version integer, previous_statut statut_colis,
 link_cancelled boolean NOT NULL DEFAULT false,
 client_message_status text NOT NULL DEFAULT 'not_required'
   CHECK (client_message_status IN ('not_required','pending','sent','portal','manual','failed','skipped')),
 message_id uuid REFERENCES messages(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 closed_at timestamptz,
 closed_reason text CHECK (closed_reason IS NULL OR closed_reason IN ('new_quote_sent','paid','cancelled','archived','superseded'))
);
-- Only client requests are ever open: one per dossier, later files are appended.
CREATE UNIQUE INDEX quote_withdrawals_one_open ON quote_withdrawals(colis_id) WHERE status IN ('pending','processing','needs_review');
CREATE INDEX quote_withdrawals_due ON quote_withdrawals(next_attempt_at) WHERE status IN ('pending','processing');
CREATE INDEX quote_withdrawals_unclosed ON quote_withdrawals(colis_id) WHERE closed_at IS NULL;
ALTER TABLE quote_withdrawals ENABLE ROW LEVEL SECURITY;
-- Same audience as get_invoice_review_context: last_error carries PayPlug failure texts.
CREATE POLICY quote_withdrawals_staff_read ON quote_withdrawals FOR SELECT TO authenticated USING (is_staff() AND (has_permission('perm_factures_voir')
 OR has_permission('perm_factures_ajouter') OR has_permission('perm_factures_valider') OR has_permission('perm_factures_refuser')
 OR has_permission('perm_factures_ocr') OR has_permission('perm_factures_modifier_articles')));
-- Read only for API roles, whatever the platform default privileges (REFERENCES, TRIGGER, MAINTAIN included).
REVOKE ALL ON quote_withdrawals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON quote_withdrawals TO authenticated,service_role;

-- Worker outcome for analyses that must not run (D1/D4). The historical inline CHECK is found by definition.
DO $$ DECLARE checks text[]; BEGIN
 SELECT array_agg(conname) INTO checks FROM pg_constraint WHERE conrelid='public.ocr_jobs'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%';
 IF cardinality(checks) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Unexpected OCR job status constraints'; END IF;
 EXECUTE format('ALTER TABLE public.ocr_jobs DROP CONSTRAINT %I',checks[1]);
 ALTER TABLE public.ocr_jobs ADD CONSTRAINT ocr_jobs_status_check CHECK (status IN ('pending','processing','review','failed','skipped'));
END $$;

-- One definition of each rule. Same evidence as _assert_unpaid_dossier (2026-10-03); the reason only orders the message.
CREATE FUNCTION _dossier_frozen_reason(c colis) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE
  WHEN c.statut='paye' OR c.paiement_date IS NOT NULL OR c.paiement_montant IS NOT NULL
   OR EXISTS(SELECT 1 FROM paiements WHERE colis_id=c.id AND statut='confirme')
   OR EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status='paid')
   OR EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND (observed_payment_date IS NOT NULL OR observed_payment_amount IS NOT NULL)) THEN 'payment'
  WHEN c.date_expedition IS NOT NULL OR c.statut IN ('expedie','transit','dedouanement','arrive','livraison','livre')
   OR EXISTS(SELECT 1 FROM envois WHERE id=c.envoi_id AND (departed_at IS NOT NULL OR manifest_version>0)) THEN 'departure'
  WHEN c.archive OR c.statut NOT IN ('receptionne','mesure','attente_feu_vert','autorise','refuse_client','en_preparation','devis_envoye','attente_paiement') THEN 'closed'
 END $$;

CREATE FUNCTION _frozen_message(p_reason text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE p_reason
  WHEN 'payment' THEN 'Un paiement est enregistré pour ce dossier : factures, articles et analyses sont figés. Ils restent consultables.'
  WHEN 'departure' THEN 'Ce dossier est parti : factures, articles et analyses sont figés. Ils restent consultables.'
  ELSE 'Ce dossier est clos : factures, articles et analyses restent consultables.' END $$;

-- Rewritten on the shared predicate: same lock, code and message (measurement, quote and payment callers unchanged).
CREATE OR REPLACE FUNCTION _assert_unpaid_dossier(p_colis_id uuid) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable.' USING ERRCODE='22023'; END IF;
 IF _dossier_frozen_reason(c) IS NOT NULL THEN
  RAISE EXCEPTION 'Un paiement ou un départ est enregistré, ou le dossier est fermé. Les mesures et le devis sont en lecture seule.' USING ERRCODE='22023';
 END IF;
 RETURN c;
END; $$;

-- Link conditions of _assert_quote_editable (2026-10-03), creating included: any link without its PayPlug proof.
CREATE FUNCTION _live_payment_link(c colis) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND (status='creating'
     OR (provider_cancelled_at IS NULL AND (provider_id IS NOT NULL OR payment_url IS NOT NULL OR status='pending'))))
  OR EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND provider_cancelled_at IS NULL)
  OR (c.payplug_payment_url IS NOT NULL AND c.payplug_payment_id IS NULL)
  OR (c.payplug_payment_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND provider_id=c.payplug_payment_id AND provider_cancelled_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND provider_id=c.payplug_payment_id AND provider_cancelled_at IS NOT NULL)) $$;

CREATE FUNCTION _quote_locked(c colis) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.statut IN ('devis_envoye','attente_paiement') OR _live_payment_link(c) $$;

-- NULL = analysis allowed (D1/D4).
CREATE FUNCTION _invoice_analysis_reason(f factures) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE
  WHEN _dossier_frozen_reason((SELECT x FROM colis x WHERE x.id=f.colis_id)) IS NOT NULL THEN 'frozen'
  WHEN f.duplicate_of_facture_id IS NOT NULL OR f.rejet_motif IS NOT NULL
   OR EXISTS(SELECT 1 FROM factures r WHERE r.replaces_facture_id=f.id) THEN 'inactive'
  WHEN f.valide AND NOT EXISTS(SELECT 1 FROM invoice_review_drafts d WHERE d.facture_id=f.id) THEN 'validated'
 END $$;

-- Active validated invoice whose current, storage-bound analysis hash equals the given SHA-256.
CREATE FUNCTION _identical_validated_invoice(p_colis_id uuid,p_sha256 text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT f.id FROM factures f
 WHERE f.colis_id=p_colis_id AND f.valide AND f.duplicate_of_facture_id IS NULL AND f.rejet_motif IS NULL
  AND NOT EXISTS(SELECT 1 FROM factures r WHERE r.replaces_facture_id=f.id)
  AND EXISTS(SELECT 1 FROM ocr_extractions e WHERE e.facture_id=f.id AND e.document_hash=p_sha256 AND e.document_file_url=f.fichier_url
   AND (e.document_storage_identity IS NULL OR e.document_storage_identity=invoice_storage_identity(f.fichier_url)))
 ORDER BY f.created_at,f.id LIMIT 1 $$;

CREATE FUNCTION _late_invoice_open(p_colis_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id=p_colis_id AND source<>'staff' AND closed_at IS NULL
  AND status IN ('pending','processing','needs_review','withdrawn')) $$;

-- Latest unclosed request carrying this invoice (deposit and Telegram results).
CREATE FUNCTION _late_invoice_withdrawal(f factures) RETURNS quote_withdrawals LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT w.* FROM quote_withdrawals w WHERE w.colis_id=f.colis_id AND f.id=ANY(w.facture_ids) AND w.closed_at IS NULL
 ORDER BY w.created_at DESC,w.id DESC LIMIT 1 $$;

CREATE FUNCTION _assert_invoices_editable(p_colis_id uuid,p_allow_quote_locked boolean) RETURNS colis
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; reason text;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable.' USING ERRCODE='22023'; END IF;
 reason:=_dossier_frozen_reason(c);
 IF reason IS NOT NULL THEN RAISE EXCEPTION '%',_frozen_message(reason) USING ERRCODE='22023',HINT='invoices_frozen:'||reason; END IF;
 IF NOT coalesce(p_allow_quote_locked,false) AND _quote_locked(c) THEN
  RAISE EXCEPTION 'Le devis envoyé couvre ces factures. Utilisez « Retirer le devis et modifier » : son lien de paiement sera d’abord annulé.'
   USING ERRCODE='22023',HINT='quote_withdrawal_required';
 END IF;
 RETURN c;
END; $$;

-- Service read models for Edge pre-checks; the database commands remain authoritative.
CREATE FUNCTION invoice_lock_state(p_colis_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service requis.' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable.' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('frozenReason',_dossier_frozen_reason(c),'quoteLocked',_quote_locked(c),'quoteSent',c.statut IN ('devis_envoye','attente_paiement'),
  'creating',EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status='creating'),'liveLink',_live_payment_link(c),
  'lateInvoiceOpen',_late_invoice_open(c.id),'statut',c.statut,'quoteVersion',c.quote_version,'updatedAt',c.updated_at);
END; $$;

CREATE FUNCTION invoice_analysis_gate(p_facture_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f factures; reason text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service requis.' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM factures WHERE id=p_facture_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'reason','missing'); END IF;
 reason:=_invoice_analysis_reason(f);
 RETURN jsonb_build_object('allowed',reason IS NULL,'reason',reason,'colisId',f.colis_id);
END; $$;

-- BEFORE on factures and lignes; sorts before a_guard_invoice_review_state and takes the same dossier lock.
CREATE FUNCTION guard_invoice_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; c colis; reason text;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.colis_id ELSE NEW.colis_id END;
 SELECT * INTO c FROM colis WHERE id=target FOR UPDATE;
 IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 reason:=_dossier_frozen_reason(c);
 IF reason IS NOT NULL THEN RAISE EXCEPTION '%',_frozen_message(reason) USING ERRCODE='22023',HINT='invoices_frozen:'||reason; END IF;  -- D4, OCR columns included
 IF NOT _quote_locked(c) THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 -- OCR bookkeeping on an invoice of a locked quote (a late invoice being analysed).
 IF TG_TABLE_NAME='factures' AND TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['ocr_status','ocr_error','telegram_msg_id'])
    IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['ocr_status','ocr_error','telegram_msg_id']) THEN RETURN NEW; END IF;
 -- Customs classification only: written by save_quote_customs, which already requires every link to carry its proof.
 IF TG_TABLE_NAME='lignes' AND TG_OP='UPDATE' AND (to_jsonb(NEW)-'custom_duty') IS NOT DISTINCT FROM (to_jsonb(OLD)-'custom_duty') THEN RETURN NEW; END IF;
 -- Client-origin invoice (D3): accepted; the AFTER trigger opens a withdrawal request and the quote stays payable.
 IF TG_TABLE_NAME='factures' AND TG_OP='INSERT' THEN
  IF NOT NEW.valide AND NEW.duplicate_of_facture_id IS NULL
   AND ((auth.role()='authenticated' AND NOT is_staff() AND owns_colis(NEW.colis_id))
     OR (auth.role()='service_role' AND NEW.telegram_event_key IS NOT NULL)) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Le devis envoyé couvre ces factures. Utilisez « Retirer le devis et modifier » : son lien de paiement sera d’abord annulé.'
  USING ERRCODE='22023',HINT='quote_withdrawal_required';
END; $$;
CREATE TRIGGER a0_guard_invoice_lock BEFORE INSERT OR UPDATE OR DELETE ON factures FOR EACH ROW EXECUTE FUNCTION guard_invoice_lock();
CREATE TRIGGER a0_guard_invoice_lock BEFORE INSERT OR UPDATE OR DELETE ON lignes FOR EACH ROW EXECUTE FUNCTION guard_invoice_lock();

-- BEFORE on ocr_extractions and invoice_review_drafts. Deliberately no dossier lock (keeps dossier -> invoice -> extraction).
CREATE FUNCTION guard_invoice_analysis() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f factures; reason text;
BEGIN
 SELECT * INTO f FROM factures WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.facture_id ELSE NEW.facture_id END;
 IF FOUND THEN
  reason:=_dossier_frozen_reason((SELECT x FROM colis x WHERE x.id=f.colis_id));
  IF reason IS NOT NULL THEN RAISE EXCEPTION '%',_frozen_message(reason) USING ERRCODE='22023',HINT='invoices_frozen:'||reason; END IF;
  -- D1, INSERT only: confirming an extraction inside save_invoice_review must keep working without a draft.
  IF TG_TABLE_NAME='ocr_extractions' AND TG_OP='INSERT' AND f.valide AND NOT EXISTS(SELECT 1 FROM invoice_review_drafts d WHERE d.facture_id=f.id) THEN
   RAISE EXCEPTION 'Facture validée : ouvrez « Modifier la vérification » avant de relancer son analyse.' USING ERRCODE='22023',HINT='analysis_not_allowed:validated';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER a0_guard_invoice_analysis BEFORE INSERT OR UPDATE OR DELETE ON ocr_extractions FOR EACH ROW EXECUTE FUNCTION guard_invoice_analysis();
CREATE TRIGGER a0_guard_invoice_analysis BEFORE INSERT OR UPDATE OR DELETE ON invoice_review_drafts FOR EACH ROW EXECUTE FUNCTION guard_invoice_analysis();

-- Late client invoice: one open request per dossier, later files appended. Caller holds the dossier lock.
CREATE FUNCTION _open_late_invoice_request(c colis,p_facture_id uuid,p_source text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rid uuid;
BEGIN
 -- A request left open by an older quote version (a correction re-versioned it) no longer applies: it never absorbs this invoice.
 UPDATE quote_withdrawals SET status='superseded',closed_at=clock_timestamp(),closed_reason='superseded',locked_at=NULL,
  client_message_status=CASE WHEN client_message_status='pending' THEN 'skipped' ELSE client_message_status END
 WHERE colis_id=c.id AND status IN ('pending','processing','needs_review') AND quote_version IS DISTINCT FROM c.quote_version;
 INSERT INTO quote_withdrawals(colis_id,source,quote_version,facture_ids,reason,requested_by,status)
 VALUES(c.id,p_source,c.quote_version,ARRAY[p_facture_id],'Facture reçue du client après l’envoi du devis',
  CASE WHEN p_source='portal' AND EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid()) THEN auth.uid() END,'pending')
 ON CONFLICT (colis_id) WHERE status IN ('pending','processing','needs_review')
 DO UPDATE SET facture_ids=CASE WHEN p_facture_id=ANY(quote_withdrawals.facture_ids) THEN quote_withdrawals.facture_ids
                                ELSE quote_withdrawals.facture_ids||p_facture_id END
 RETURNING id INTO rid;
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,after_data)
 VALUES(c.id,CASE WHEN p_source='portal' AND EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid()) THEN auth.uid() END,
  CASE p_source WHEN 'portal' THEN 'Client (espace)' ELSE 'Client (Telegram)' END,'late_invoice_received',
  'Facture reçue après l’envoi du devis : annulation de l’ancien lien demandée',
  jsonb_build_object('withdrawalId',rid,'factureId',p_facture_id,'source',p_source,'quoteVersion',c.quote_version));
 RETURN rid;
END; $$;

-- Withdrawal core. Caller holds the dossier lock and checked _dossier_frozen_reason(c) IS NULL and _quote_locked(c).
CREATE FUNCTION _withdraw_quote(c colis,p_source text,p_action text,p_reason text,p_actor uuid,p_facture_ids uuid[]) RETURNS quote_withdrawals
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous colis:=c; w quote_withdrawals; linked boolean; announce boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status='creating') THEN
  RAISE EXCEPTION 'Un lien de paiement est en cours de création. Réessayez dans un instant.' USING ERRCODE='40001',HINT='payment_link_creating';
 END IF;
 IF _live_payment_link(c) THEN    -- every link must carry its PayPlug proof (record_payplug_cancellation)
  RAISE EXCEPTION 'L’ancien lien de paiement doit d’abord être annulé chez PayPlug.' USING ERRCODE='22023',HINT='link_cancellation_required';
 END IF;
 linked:=previous.payplug_payment_url IS NOT NULL
  OR EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND quote_version=previous.quote_version AND provider_cancelled_at IS NOT NULL);
 announce:=previous.statut IN ('devis_envoye','attente_paiement');
 IF c.devis_total>0 THEN
  INSERT INTO quote_versions(colis_id,version,snapshot,total,created_by)
  VALUES(c.id,c.quote_version,coalesce(c.devis_snapshot,to_jsonb(c)),c.devis_total,p_actor) ON CONFLICT(colis_id,version) DO NOTHING;
 END IF;
 -- version_quote: quote_version+1 and creating/pending intents superseded; sent -> en_preparation is an allowed transition.
 UPDATE colis SET devis_total=NULL,devis_snapshot=NULL,devis_brouillon=true,payplug_payment_id=NULL,payplug_payment_url=NULL,
  statut=CASE WHEN statut IN ('devis_envoye','attente_paiement') THEN 'en_preparation'::statut_colis ELSE statut END
 WHERE id=c.id RETURNING * INTO c;
 UPDATE payment_intents SET status='superseded',updated_at=clock_timestamp() WHERE colis_id=c.id AND status IN ('creating','pending');
 UPDATE notification_outbox o SET status='cancelled',last_error='Devis retiré : un nouveau devis sera envoyé'
 FROM messages m WHERE o.message_id=m.id AND o.colis_id=c.id AND o.status IN ('pending','blocked','manual','failed')
  AND m.template IN ('devis_final','devis_final_pro','relance_paiement');            -- 'sending'/'sent' untouched
 UPDATE quote_withdrawals SET status='withdrawn',withdrawn_at=clock_timestamp(),withdrawn_quote_version=previous.quote_version,
  previous_statut=previous.statut,link_cancelled=linked,locked_at=NULL,last_error=NULL,
  client_message_status=CASE WHEN announce THEN 'pending' ELSE 'not_required' END
 WHERE colis_id=c.id AND status IN ('pending','processing','needs_review');            -- absorbs the open client request (D3)
 IF p_source IN ('staff','conversation_import') THEN
  INSERT INTO quote_withdrawals(colis_id,source,action,quote_version,facture_ids,reason,requested_by,status,withdrawn_at,
   withdrawn_quote_version,previous_statut,link_cancelled,client_message_status)
  VALUES(c.id,p_source,p_action,previous.quote_version,coalesce(p_facture_ids,'{}'),trim(p_reason),p_actor,'withdrawn',clock_timestamp(),
   previous.quote_version,previous.statut,linked,CASE WHEN p_source='conversation_import' AND announce THEN 'pending' ELSE 'not_required' END)
  RETURNING * INTO w;
 ELSE
  SELECT * INTO w FROM quote_withdrawals WHERE colis_id=c.id AND status='withdrawn' AND withdrawn_quote_version=previous.quote_version
  ORDER BY created_at DESC,id DESC LIMIT 1;
 END IF;
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,before_data,after_data)
 VALUES(c.id,p_actor,coalesce((SELECT nom FROM profiles WHERE id=p_actor),(SELECT nom FROM staff_users WHERE auth_id=p_actor),
   CASE WHEN p_actor IS NULL THEN 'Expedîle (facture reçue du client)' ELSE 'Équipe' END),'quote_withdrawn',trim(p_reason),
  to_jsonb(previous),to_jsonb(c)||jsonb_build_object('withdrawalId',w.id,'source',p_source,'action',p_action,
  'withdrawnQuoteVersion',previous.quote_version,'linkCancelled',linked));
 RETURN w;
END; $$;

-- Unsent quote: unchanged legacy reset. Locked quote: client invoices open a request, staff writes were refused before.
CREATE OR REPLACE FUNCTION invalidate_quote_on_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; c colis; reason text; client_source text;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.colis_id ELSE NEW.colis_id END;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='factures' AND (to_jsonb(OLD)-ARRAY['telegram_msg_id','ocr_status','ocr_error'])
    IS NOT DISTINCT FROM (to_jsonb(NEW)-ARRAY['telegram_msg_id','ocr_status','ocr_error']) THEN RETURN NEW; END IF;
 SELECT * INTO c FROM colis WHERE id=target FOR UPDATE;      -- already held through a0_guard_invoice_lock
 IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 reason:=_dossier_frozen_reason(c);
 IF reason IS NOT NULL THEN RAISE EXCEPTION '%',_frozen_message(reason) USING ERRCODE='22023',HINT='invoices_frozen:'||reason; END IF;
 IF _quote_locked(c) THEN
  IF TG_TABLE_NAME='factures' AND TG_OP='INSERT' THEN
   client_source:=CASE WHEN auth.role()='service_role' AND NEW.telegram_event_key IS NOT NULL THEN 'telegram'
                       WHEN auth.role()='authenticated' AND NOT is_staff() AND owns_colis(NEW.colis_id) THEN 'portal' END;
   IF client_source IS NOT NULL THEN PERFORM _open_late_invoice_request(c,NEW.id,client_source); RETURN NEW; END IF;
  END IF;
  IF NOT (TG_TABLE_NAME='lignes' AND TG_OP='UPDATE' AND (to_jsonb(NEW)-'custom_duty') IS NOT DISTINCT FROM (to_jsonb(OLD)-'custom_duty')
          AND NOT _live_payment_link(c)) THEN
   RAISE EXCEPTION 'Le devis envoyé couvre ces factures. Utilisez « Retirer le devis et modifier ».' USING ERRCODE='22023',HINT='quote_withdrawal_required';
  END IF;
  -- Customs revision of a sent quote without link: an open client request is answered through the withdrawal core.
  IF EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id=c.id AND status IN ('pending','processing','needs_review')) THEN
   PERFORM _withdraw_quote(c,'staff',NULL,'Révision du classement douanier après l’envoi du devis',auth.uid(),'{}');
   IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
 END IF;
 UPDATE colis SET devis_total=NULL,devis_snapshot=NULL,devis_brouillon=true,payplug_payment_id=NULL,payplug_payment_url=NULL,
  statut=CASE WHEN statut IN ('devis_envoye','attente_paiement') THEN 'en_preparation'::statut_colis ELSE statut END
 WHERE id=target AND (devis_total IS NOT NULL OR statut IN ('devis_envoye','attente_paiement'));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;

-- D1: a validated invoice or a classified copy is never queued for analysis.
CREATE OR REPLACE FUNCTION queue_ocr_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.fichier_url IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.fichier_url IS NOT DISTINCT FROM OLD.fichier_url THEN RETURN NEW; END IF;
 IF NEW.valide OR NEW.duplicate_of_facture_id IS NOT NULL THEN RETURN NEW; END IF;
 INSERT INTO ocr_jobs(facture_id,colis_id) VALUES(NEW.id,NEW.colis_id) ON CONFLICT(facture_id) DO UPDATE SET status='pending',attempts=0,available_at=now(),last_error=NULL;
 UPDATE factures SET ocr_status='pending',ocr_error=NULL WHERE id=NEW.id;
 RETURN NEW;
END; $$;

-- D1: the modification of a validated invoice is the server draft, seeded from the validated values.
CREATE FUNCTION _open_invoice_modification(p_facture_id uuid,p_expected_review_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f factures; created integer;
BEGIN
 SELECT * INTO f FROM factures WHERE id=p_facture_id FOR UPDATE;
 IF NOT FOUND OR NOT f.valide OR f.duplicate_of_facture_id IS NOT NULL OR f.rejet_motif IS NOT NULL
  OR EXISTS(SELECT 1 FROM factures r WHERE r.replaces_facture_id=f.id) THEN
  RAISE EXCEPTION 'Seule une facture validée et active peut être modifiée.' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM ocr_extractions WHERE facture_id=f.id ORDER BY id FOR UPDATE;
 IF p_expected_review_token IS NULL OR p_expected_review_token IS DISTINCT FROM invoice_review_token(f.id) THEN
  RAISE EXCEPTION 'La facture ou ses articles ont changé. Rechargez la vérification.' USING ERRCODE='40001';
 END IF;
 INSERT INTO invoice_review_drafts(facture_id,payload,saved_by)
 VALUES(f.id,jsonb_build_object('lines',coalesce((SELECT jsonb_agg(jsonb_build_object('desc',l.description,'qte',l.qte,'prix',l.prix_unitaire,'cat',l.categorie_id) ORDER BY l.created_at,l.id)
   FROM lignes l WHERE l.facture_id=f.id),'[]'),'total',f.montant,'vendeur',f.vendeur,'extractionId',NULL),auth.uid())
 ON CONFLICT(facture_id) DO NOTHING;
 GET DIAGNOSTICS created=ROW_COUNT;
 IF created>0 THEN
  INSERT INTO audit_actions(colis_id,user_id,action,detail,after_data)
  VALUES(f.colis_id,auth.uid(),'invoice_modification_opened','Modification d’une facture validée ouverte',jsonb_build_object('factureId',f.id));
 END IF;
 RETURN jsonb_build_object('reviewToken',invoice_review_token(f.id),'draft',(SELECT payload FROM invoice_review_drafts WHERE facture_id=f.id),'created',created>0);
END; $$;

CREATE FUNCTION open_invoice_modification(p_facture_id uuid,p_expected_review_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid;
BEGIN
 IF NOT has_permission('perm_factures_modifier_articles') THEN RAISE EXCEPTION 'Permission de modification des articles requise' USING ERRCODE='42501'; END IF;
 SELECT colis_id INTO target FROM factures WHERE id=p_facture_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable.' USING ERRCODE='22023'; END IF;
 PERFORM _assert_staff_task_owner(target,'documents');
 PERFORM _assert_invoices_editable(target,false);
 RETURN _open_invoice_modification(p_facture_id,p_expected_review_token);
END; $$;

-- Closing never changes the quote: only D4 applies.
CREATE FUNCTION close_invoice_modification(p_facture_id uuid,p_expected_review_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; f factures; removed integer;
BEGIN
 IF NOT has_permission('perm_factures_modifier_articles') THEN RAISE EXCEPTION 'Permission de modification des articles requise' USING ERRCODE='42501'; END IF;
 SELECT colis_id INTO target FROM factures WHERE id=p_facture_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable.' USING ERRCODE='22023'; END IF;
 PERFORM _assert_staff_task_owner(target,'documents');
 PERFORM _assert_invoices_editable(target,true);
 SELECT * INTO f FROM factures WHERE id=p_facture_id FOR UPDATE;
 PERFORM 1 FROM ocr_extractions WHERE facture_id=f.id ORDER BY id FOR UPDATE;
 IF p_expected_review_token IS NULL OR p_expected_review_token IS DISTINCT FROM invoice_review_token(f.id) THEN
  RAISE EXCEPTION 'La facture ou ses articles ont changé. Rechargez la vérification.' USING ERRCODE='40001';
 END IF;
 DELETE FROM invoice_review_drafts WHERE facture_id=f.id;
 GET DIAGNOSTICS removed=ROW_COUNT;
 IF removed>0 THEN
  INSERT INTO audit_actions(colis_id,user_id,action,detail,after_data)
  VALUES(f.colis_id,auth.uid(),'invoice_modification_closed','Modification d’une facture fermée sans enregistrement',jsonb_build_object('factureId',f.id));
 END IF;
 RETURN jsonb_build_object('reviewToken',invoice_review_token(f.id),'closed',removed>0);
END; $$;

-- Body of import_conversation_invoice without permission, lock and freeze lines (the caller holds them).
CREATE FUNCTION _import_conversation_attachment(p_message_id uuid,p_colis_id uuid) RETURNS factures
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m messages; f factures;
BEGIN
 SELECT * INTO m FROM messages WHERE id=p_message_id;
 IF NOT FOUND OR m.attachment_path IS NULL OR m.colis_id IS DISTINCT FROM p_colis_id THEN
  RAISE EXCEPTION 'Ce message ne contient pas de document importable' USING ERRCODE='22023';
 END IF;
 SELECT * INTO f FROM factures WHERE colis_id=p_colis_id AND fichier_url=m.attachment_path LIMIT 1;
 IF FOUND THEN RETURN f; END IF;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom) VALUES(p_colis_id,'Document à vérifier',0,false,m.attachment_path,m.attachment_name) RETURNING * INTO f;
 INSERT INTO audit_actions(colis_id,user_id,action,detail) VALUES(p_colis_id,auth.uid(),'conversation_invoice_import',jsonb_build_object('message_id',m.id,'facture_id',f.id)::text);
 SELECT * INTO f FROM factures WHERE id=f.id;
 RETURN f;
END; $$;

-- Follow-up of a withdrawal (one definition): checked read-only by the Edge before any PayPlug abort,
-- then again under the locks by withdraw_quote_for_documents, before anything is withdrawn.
CREATE FUNCTION _assert_withdrawal_followup(p_colis_id uuid,p_action text,p_facture_id uuid,p_expected_review_token text,p_message_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f factures;
BEGIN
 IF p_facture_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM factures WHERE id=p_facture_id AND colis_id=p_colis_id) THEN
  RAISE EXCEPTION 'Cette facture n’appartient pas à ce dossier.' USING ERRCODE='22023';
 END IF;
 IF p_action='open_modification' THEN
  SELECT * INTO f FROM factures WHERE id=p_facture_id;
  IF NOT FOUND OR NOT f.valide OR f.duplicate_of_facture_id IS NOT NULL OR f.rejet_motif IS NOT NULL
   OR EXISTS(SELECT 1 FROM factures r WHERE r.replaces_facture_id=f.id) THEN
   RAISE EXCEPTION 'Seule une facture validée et active peut être modifiée.' USING ERRCODE='22023';
  END IF;
  IF p_expected_review_token IS NULL OR p_expected_review_token IS DISTINCT FROM invoice_review_token(f.id) THEN
   RAISE EXCEPTION 'La facture ou ses articles ont changé. Rechargez la vérification.' USING ERRCODE='40001';
  END IF;
 ELSIF p_action='import_attachment' AND (p_message_id IS NULL OR NOT EXISTS(SELECT 1 FROM messages WHERE id=p_message_id AND colis_id=p_colis_id AND attachment_path IS NOT NULL)) THEN
  RAISE EXCEPTION 'Ce message ne contient pas de document importable' USING ERRCODE='22023';
 END IF;
END; $$;

-- Service read-only pre-check (invoice-quote-withdrawal): an invalid follow-up never costs the client a live link.
CREATE FUNCTION withdraw_quote_preflight(p_colis_id uuid,p_action text,p_facture_id uuid DEFAULT NULL,p_expected_review_token text DEFAULT NULL,p_message_id uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service requis.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM colis WHERE id=p_colis_id) THEN RAISE EXCEPTION 'Dossier introuvable.' USING ERRCODE='22023'; END IF;
 PERFORM _assert_withdrawal_followup(p_colis_id,p_action,p_facture_id,p_expected_review_token,p_message_id);
 RETURN true;
END; $$;

-- D2: called by invoice-quote-withdrawal with the staff JWT, after every PayPlug link carries its cancellation proof.
CREATE FUNCTION withdraw_quote_for_documents(p_colis_id uuid,p_expected_updated_at timestamptz,p_action text,p_reason text DEFAULT NULL,
 p_facture_id uuid DEFAULT NULL,p_expected_review_token text DEFAULT NULL,p_message_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; w quote_withdrawals; f factures; reason text; modification jsonb; changed boolean:=false;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('open_modification','replace_document','add_document','classify_duplicate','restore_duplicate','request_correction','manual_articles','import_attachment') THEN
  RAISE EXCEPTION 'Action de retrait du devis inconnue.' USING ERRCODE='22023';
 END IF;
 IF NOT has_permission('perm_factures_modifier_articles')
  OR (p_action IN ('replace_document','add_document','import_attachment') AND NOT has_permission('perm_factures_ajouter'))
  OR (p_action='request_correction' AND NOT has_permission('perm_factures_refuser'))
  OR (p_action IN ('classify_duplicate','restore_duplicate') AND NOT has_permission('perm_factures_valider')) THEN
  RAISE EXCEPTION 'Votre rôle ne permet pas de retirer un devis envoyé.' USING ERRCODE='42501';
 END IF;
 reason:=coalesce(nullif(trim(p_reason),''),CASE p_action
  WHEN 'open_modification' THEN 'Modification d’une facture validée après l’envoi du devis'
  WHEN 'replace_document' THEN 'Remplacement d’un document après l’envoi du devis'
  WHEN 'add_document' THEN 'Ajout d’une facture après l’envoi du devis'
  WHEN 'classify_duplicate' THEN 'Retrait d’un doublon après l’envoi du devis'
  WHEN 'restore_duplicate' THEN 'Remise à vérifier d’une facture après l’envoi du devis'
  WHEN 'request_correction' THEN 'Demande de correction d’une facture après l’envoi du devis'
  WHEN 'manual_articles' THEN 'Modification d’un achat sans facture après l’envoi du devis'
  ELSE 'Facture reçue dans la conversation après l’envoi du devis' END);
 IF length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Motif du retrait requis (3 à 500 caractères).' USING ERRCODE='22023'; END IF;
 PERFORM _assert_staff_task_owner(p_colis_id,'documents');
 PERFORM _assert_staff_task_owner(p_colis_id,'correction');
 c:=_assert_invoices_editable(p_colis_id,true);
 IF p_expected_updated_at IS NULL OR c.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'Le dossier a changé. Actualisez avant de réessayer.' USING ERRCODE='40001';
 END IF;
 -- Validate the follow-up before anything is withdrawn, under the invoice locks: the whole command stays atomic.
 IF p_action='open_modification' THEN
  PERFORM 1 FROM factures WHERE id=p_facture_id AND colis_id=c.id FOR UPDATE;
  PERFORM 1 FROM ocr_extractions e WHERE e.facture_id=p_facture_id AND EXISTS(SELECT 1 FROM factures x WHERE x.id=e.facture_id AND x.colis_id=c.id) ORDER BY e.id FOR UPDATE;
 END IF;
 PERFORM _assert_withdrawal_followup(c.id,p_action,p_facture_id,p_expected_review_token,p_message_id);
 IF _quote_locked(c) THEN
  w:=_withdraw_quote(c,CASE p_action WHEN 'import_attachment' THEN 'conversation_import' ELSE 'staff' END,p_action,reason,auth.uid(),
   CASE WHEN p_facture_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[p_facture_id] END);
  changed:=true;
 END IF;
 IF p_action='open_modification' THEN modification:=_open_invoice_modification(p_facture_id,p_expected_review_token);
 ELSIF p_action='import_attachment' THEN
  f:=_import_conversation_attachment(p_message_id,c.id);
  IF w.id IS NOT NULL AND NOT f.id=ANY(w.facture_ids) THEN
   UPDATE quote_withdrawals SET facture_ids=facture_ids||f.id WHERE id=w.id RETURNING * INTO w;
  END IF;
 END IF;
 SELECT * INTO c FROM colis WHERE id=c.id;
 RETURN jsonb_build_object('colis',to_jsonb(c),'changed',changed,'withdrawal',CASE WHEN w.id IS NULL THEN NULL ELSE to_jsonb(w) END,
  'reviewToken',modification->'reviewToken','draft',modification->'draft','facture',CASE WHEN f.id IS NULL THEN NULL ELSE to_jsonb(f) END);
END; $$;

-- D3 portal: client-scoped, so the existing client triggers run unchanged. The Edge already checked bytes and identity.
CREATE FUNCTION client_document_precheck(p_colis_id uuid,p_user_id uuid,p_path text,p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE original uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service requis.' USING ERRCODE='42501'; END IF;
 IF p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM colis c JOIN clients cl ON cl.id=c.client_id WHERE c.id=p_colis_id AND cl.user_id=p_user_id) THEN
  RAISE EXCEPTION 'Dépôt réservé au client du dossier.' USING ERRCODE='42501';
 END IF;
 IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Empreinte du document invalide.' USING ERRCODE='22023'; END IF;
 IF p_path IS NULL OR left(p_path,37)<>p_colis_id::text||'/' OR position('..' IN p_path)>0 THEN RAISE EXCEPTION 'Document introuvable dans le dossier.' USING ERRCODE='22023'; END IF;
 original:=_identical_validated_invoice(p_colis_id,p_sha256);
 IF original IS NOT NULL AND NOT EXISTS(SELECT 1 FROM audit_actions WHERE colis_id=p_colis_id AND action='client_invoice_identical_ignored' AND after_data->>'path'=p_path) THEN
  INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,after_data)
  VALUES(p_colis_id,CASE WHEN EXISTS(SELECT 1 FROM profiles WHERE id=p_user_id) THEN p_user_id END,'Client (espace)','client_invoice_identical_ignored',
   'Document identique à une facture validée : rien ne change pour le devis',jsonb_build_object('path',p_path,'originalId',original,'sha256',p_sha256,'source','portal'));
 END IF;
 -- quoteSent: the duplicate reply mentions the quote only when the client has one.
 RETURN jsonb_build_object('identicalTo',original,'quoteSent',EXISTS(SELECT 1 FROM colis WHERE id=p_colis_id AND statut IN ('devis_envoye','attente_paiement')));
END; $$;

CREATE FUNCTION deposit_client_invoice(p_colis_id uuid,p_path text,p_file_name text,p_vendor text DEFAULT NULL,p_replaces_facture_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; f factures; m messages; w quote_withdrawals; reason text; file_name text:=nullif(trim(p_file_name),'');
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL OR is_staff() OR NOT owns_colis(p_colis_id) THEN
  RAISE EXCEPTION 'Dépôt réservé au client du dossier.' USING ERRCODE='42501';
 END IF;
 IF p_path IS NULL OR left(p_path,37)<>p_colis_id::text||'/' OR position('..' IN p_path)>0 OR lower(p_path) !~ '\.(pdf|jpe?g|png|webp)$'
  OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='factures' AND name=p_path) THEN
  RAISE EXCEPTION 'Document introuvable dans le dossier.' USING ERRCODE='22023';
 END IF;
 -- Same limits as client-invoice-deposit, on the stored object itself (this command is also reachable directly).
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='factures' AND name=p_path AND (coalesce((metadata->>'size')::bigint,0)>20971520
   OR lower(coalesce(metadata->>'mimetype','application/octet-stream')) NOT IN ('application/pdf','image/jpeg','image/jpg','image/png','image/webp','application/octet-stream'))) THEN
  RAISE EXCEPTION 'Envoyez une facture PDF, JPEG, PNG ou WebP de 20 Mo au plus.' USING ERRCODE='22023';
 END IF;
 IF file_name IS NULL OR length(file_name)>200 OR length(coalesce(trim(p_vendor),''))>200 THEN RAISE EXCEPTION 'Nom du document invalide.' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 SELECT * INTO f FROM factures WHERE colis_id=c.id AND fichier_url=p_path ORDER BY created_at,id LIMIT 1;
 IF NOT FOUND THEN
  reason:=_dossier_frozen_reason(c);
  IF reason IS NOT NULL THEN    -- D4: no invoice row; the document stays visible to staff in the conversation.
   SELECT * INTO m FROM messages WHERE colis_id=c.id AND attachment_path=p_path ORDER BY created_at,id LIMIT 1;
   IF NOT FOUND THEN
    INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,canal,template,attachment_path,attachment_name,attachment_type)
    VALUES(c.id,'client',auth.uid(),coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),'Client'),
     CASE reason WHEN 'payment' THEN 'Document reçu après le paiement : ' WHEN 'departure' THEN 'Document reçu après le départ : ' ELSE 'Document reçu sur un dossier clos : ' END||file_name,
     'portal','client_document',p_path,file_name,
     CASE WHEN lower(p_path) LIKE '%.pdf' THEN 'application/pdf' WHEN lower(p_path) LIKE '%.png' THEN 'image/png' WHEN lower(p_path) LIKE '%.webp' THEN 'image/webp' ELSE 'image/jpeg' END)
    RETURNING * INTO m;
   END IF;
   RETURN jsonb_build_object('status','frozen','reason',reason,'messageId',m.id,'facture',NULL,'withdrawalId',NULL);
  END IF;
  IF p_replaces_facture_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM factures WHERE id=p_replaces_facture_id AND colis_id=c.id AND rejet_motif IS NOT NULL) THEN
   RAISE EXCEPTION 'Choisissez la facture à corriger de ce dossier.' USING ERRCODE='22023';
  END IF;
  INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom,replaces_facture_id)
  VALUES(c.id,coalesce(nullif(trim(p_vendor),''),file_name),0,false,p_path,file_name,p_replaces_facture_id) RETURNING * INTO f;
  SELECT * INTO f FROM factures WHERE id=f.id;
 END IF;
 w:=_late_invoice_withdrawal(f);
 RETURN jsonb_build_object('status',CASE WHEN w.status IN ('pending','processing','needs_review') THEN 'intake' WHEN w.status='withdrawn' THEN 'withdrawn' ELSE 'added' END,
  'facture',to_jsonb(f),'withdrawalId',w.id);
END; $$;

-- D3 Telegram (service only). Every result carries ref and prenom for the acknowledgement.
CREATE FUNCTION register_telegram_document(p_message_id uuid,p_reply_message_id text,p_document_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE incoming messages; dossier colis; invoice factures; w quote_withdrawals; request_id uuid; request_sent_at timestamptz; reason text; original uuid; base jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Service Telegram requis' USING ERRCODE='42501';
 END IF;
 SELECT * INTO incoming FROM messages WHERE id=p_message_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Message introuvable' USING ERRCODE='22023'; END IF;
 IF p_document_sha256 IS NOT NULL AND p_document_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Empreinte du document invalide.' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('colisId',x.id,'ref',x.ref,'prenom',cl.prenom) INTO base FROM colis x LEFT JOIN clients cl ON cl.id=x.client_id WHERE x.id=incoming.colis_id;
 IF incoming.type<>'client' OR incoming.canal<>'telegram' OR incoming.attachment_path IS NULL
    OR incoming.attachment_type IS NULL OR incoming.attachment_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp') THEN
  RETURN base||jsonb_build_object('status','not_invoice');
 END IF;
 SELECT * INTO dossier FROM colis WHERE id=incoming.colis_id FOR UPDATE;
 SELECT * INTO invoice FROM factures WHERE colis_id=dossier.id AND fichier_url=incoming.attachment_path LIMIT 1;
 IF FOUND THEN
  w:=_late_invoice_withdrawal(invoice);
  RETURN base||jsonb_build_object('status','registered','factureId',invoice.id,'withdrawalId',w.id,'withdrawalStatus',w.status);
 END IF;
 reason:=_dossier_frozen_reason(dossier);
 IF reason IS NOT NULL THEN RETURN base||jsonb_build_object('status','frozen','reason',reason); END IF;
 IF p_document_sha256 IS NOT NULL THEN
  original:=_identical_validated_invoice(dossier.id,p_document_sha256);
  IF original IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM audit_actions WHERE colis_id=dossier.id AND action='client_invoice_identical_ignored' AND after_data->>'path'=incoming.attachment_path) THEN
    INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,after_data)
    VALUES(dossier.id,NULL,'Client (Telegram)','client_invoice_identical_ignored','Document identique à une facture validée : rien ne change pour le devis',
     jsonb_build_object('path',incoming.attachment_path,'originalId',original,'sha256',p_document_sha256,'source','telegram','messageId',incoming.id));
   END IF;
   RETURN base||jsonb_build_object('status','identical','originalId',original,'quoteSent',dossier.statut IN ('devis_envoye','attente_paiement'));
  END IF;
 END IF;
 -- Existing seven-day request rule and one-document rule (2026-09-16), unchanged.
 p_reply_message_id:=nullif(trim(p_reply_message_id),'');
 SELECT request.id,coalesce(delivery.sent_at,request.created_at) INTO request_id,request_sent_at
 FROM messages request LEFT JOIN notification_outbox delivery ON delivery.message_id=request.id
 WHERE request.colis_id=dossier.id AND request.type='staff' AND request.canal='telegram'
  AND (request.template IN ('facture_manquante','demande_facture')
    OR (request.template='demande_feu_vert' AND request.request_snapshot->'invoice_requested'='true'::jsonb))
  AND request.statut IN ('envoye','distribue','lu')
  AND (p_reply_message_id IS NULL OR request.telegram_msg_id=p_reply_message_id)
  AND coalesce(delivery.sent_at,request.created_at)<=incoming.created_at
  AND coalesce(delivery.sent_at,request.created_at)>=incoming.created_at-interval '7 days'
 ORDER BY coalesce(delivery.sent_at,request.created_at) DESC LIMIT 1;
 IF request_id IS NOT NULL AND NOT (p_reply_message_id IS NULL AND EXISTS(
  SELECT 1 FROM factures f WHERE f.colis_id=dossier.id AND f.rejet_motif IS NULL
   AND f.duplicate_of_facture_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)
   AND f.created_at>=request_sent_at
 )) THEN
  INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom,telegram_event_key)
  VALUES(dossier.id,'Document à vérifier',0,false,incoming.attachment_path,incoming.attachment_name,incoming.telegram_event_key)
  RETURNING * INTO invoice;
  INSERT INTO audit_actions(colis_id,user_id,action,detail)
  VALUES(dossier.id,NULL,'telegram_requested_invoice',jsonb_build_object('message_id',incoming.id,
   'request_message_id',request_id,'facture_id',invoice.id,'reply_to_telegram_message_id',p_reply_message_id)::text);
  w:=_late_invoice_withdrawal(invoice);
  RETURN base||jsonb_build_object('status','registered','factureId',invoice.id,'withdrawalId',w.id,'withdrawalStatus',w.status);
 END IF;
 RETURN base||jsonb_build_object('status',CASE WHEN _quote_locked(dossier) OR _late_invoice_open(dossier.id) THEN 'ask_client' ELSE 'not_invoice' END);
END; $$;

-- Same return type and ACL for the webhook still deployed during the mixed window. Two statements: the
-- invoice read must take a snapshot after the registration (a single SQL query would not see its insert).
CREATE OR REPLACE FUNCTION register_requested_invoice(p_message_id uuid,p_reply_message_id text)
RETURNS factures LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; invoice factures;
BEGIN
 result:=register_telegram_document(p_message_id,p_reply_message_id,NULL);
 SELECT * INTO invoice FROM factures WHERE id=(result->>'factureId')::uuid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN invoice;
END; $$;

-- « Oui, c’est une facture d’achat » (lf_oui_<messageId>): the chat must own the dossier of the document.
CREATE FUNCTION register_late_invoice_from_message(p_message_id uuid,p_chat_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE incoming messages; dossier colis; invoice factures; w quote_withdrawals; reason text; base jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service Telegram requis' USING ERRCODE='42501'; END IF;
 SELECT * INTO incoming FROM messages WHERE id=p_message_id;
 IF NOT FOUND OR incoming.type<>'client' OR incoming.canal<>'telegram' OR incoming.attachment_path IS NULL
  OR incoming.attachment_type IS NULL OR incoming.attachment_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp') THEN
  RAISE EXCEPTION 'Ce message ne contient pas de document utilisable.' USING ERRCODE='22023';
 END IF;
 IF nullif(trim(p_chat_id),'') IS NULL OR NOT EXISTS(SELECT 1 FROM colis x JOIN clients cl ON cl.id=x.client_id WHERE x.id=incoming.colis_id AND cl.telegram_chat_id=p_chat_id) THEN
  RAISE EXCEPTION 'Ce document ne correspond pas à votre compte' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('colisId',x.id,'ref',x.ref,'prenom',cl.prenom) INTO base FROM colis x JOIN clients cl ON cl.id=x.client_id WHERE x.id=incoming.colis_id;
 SELECT * INTO dossier FROM colis WHERE id=incoming.colis_id FOR UPDATE;
 SELECT * INTO invoice FROM factures WHERE colis_id=dossier.id AND fichier_url=incoming.attachment_path LIMIT 1;
 IF NOT FOUND THEN
  reason:=_dossier_frozen_reason(dossier);
  IF reason IS NOT NULL THEN RETURN base||jsonb_build_object('status','frozen','reason',reason); END IF;
  -- The question was asked about the quote of that moment: a later quote, or no quote left to update, makes the button stale.
  IF NOT (_quote_locked(dossier) OR _late_invoice_open(dossier.id)) OR dossier.devis_envoye_le>incoming.created_at THEN
   RETURN base||jsonb_build_object('status','stale');
  END IF;
  INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom,telegram_event_key)
  VALUES(dossier.id,'Document à vérifier',0,false,incoming.attachment_path,incoming.attachment_name,coalesce(incoming.telegram_event_key,'telegram-confirm:'||incoming.id))
  RETURNING * INTO invoice;
  INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,after_data)
  VALUES(dossier.id,NULL,'Client (Telegram)','telegram_late_invoice_confirmed','Le client confirme sur Telegram qu’il s’agit d’une facture d’achat',
   jsonb_build_object('messageId',incoming.id,'factureId',invoice.id));
 END IF;
 w:=_late_invoice_withdrawal(invoice);
 RETURN base||jsonb_build_object('status','registered','factureId',invoice.id,'withdrawalId',w.id,'withdrawalStatus',w.status);
END; $$;

-- Processing of client requests (service only). Every writer holds the dossier lock before the request row.
CREATE FUNCTION claim_quote_withdrawal(p_id uuid DEFAULT NULL,p_rearm boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE candidate record; w quote_withdrawals;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service requis.' USING ERRCODE='42501'; END IF;
 FOR candidate IN SELECT id,colis_id FROM quote_withdrawals
  WHERE (p_id IS NULL OR id=p_id) AND ((coalesce(p_rearm,false) AND p_id IS NOT NULL AND status='needs_review')
   OR (status='pending' AND (p_id IS NOT NULL OR next_attempt_at<=clock_timestamp()))
   OR (status='processing' AND locked_at<clock_timestamp()-interval '5 minutes'))
  ORDER BY next_attempt_at,created_at,id LIMIT 20 LOOP
  PERFORM 1 FROM colis WHERE id=candidate.colis_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN CONTINUE; END IF;
  SELECT * INTO w FROM quote_withdrawals WHERE id=candidate.id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN CONTINUE; END IF;
  IF coalesce(p_rearm,false) AND p_id IS NOT NULL AND w.status='needs_review' THEN w.status:='pending'; w.attempts:=0; END IF;
  IF NOT (w.status='pending' AND (p_id IS NOT NULL OR w.next_attempt_at<=clock_timestamp()))
   AND NOT (w.status='processing' AND w.locked_at<clock_timestamp()-interval '5 minutes') THEN CONTINUE; END IF;
  UPDATE quote_withdrawals SET status='processing',locked_at=clock_timestamp(),attempts=w.attempts+1,last_error=CASE WHEN p_rearm THEN NULL ELSE last_error END
  WHERE id=w.id RETURNING * INTO w;
  RETURN to_jsonb(w);
 END LOOP;
 RETURN NULL;
END; $$;

CREATE FUNCTION release_quote_withdrawal(p_id uuid,p_outcome text,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; c colis; w quote_withdrawals; delays integer[]:=ARRAY[5,10,20,40,60,60];
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service requis.' USING ERRCODE='42501'; END IF;
 IF p_outcome IS NULL OR p_outcome NOT IN ('retry','review','paid','superseded') THEN RAISE EXCEPTION 'Issue de traitement inconnue.' USING ERRCODE='22023'; END IF;
 SELECT colis_id INTO target FROM quote_withdrawals WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Demande de retrait introuvable.' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM colis WHERE id=target FOR UPDATE;
 SELECT * INTO w FROM quote_withdrawals WHERE id=p_id FOR UPDATE;
 IF w.status<>'processing' THEN RETURN to_jsonb(w); END IF;     -- only a claimed row is released; a completed one is kept
 -- PayPlug's word alone never closes a request as paid: only a booked payment does (it may be an older, superseded
 -- link the webhook refuses). Until then the link stays masked and the team reconciles it.
 IF p_outcome='paid' AND _dossier_frozen_reason(c) IS DISTINCT FROM 'payment' THEN
  p_outcome:='review';
  p_error:='Paiement signalé chez PayPlug mais non enregistré dans le dossier (rapprochement nécessaire)';
 END IF;
 UPDATE quote_withdrawals SET
  status=CASE p_outcome WHEN 'retry' THEN CASE WHEN attempts>=6 THEN 'needs_review' ELSE 'pending' END WHEN 'review' THEN 'needs_review' ELSE p_outcome END,
  next_attempt_at=CASE WHEN p_outcome='retry' AND attempts<6 THEN clock_timestamp()+make_interval(mins=>delays[greatest(1,least(attempts,6))]) ELSE next_attempt_at END,
  closed_at=CASE WHEN p_outcome IN ('paid','superseded') THEN clock_timestamp() ELSE closed_at END,
  closed_reason=CASE p_outcome WHEN 'paid' THEN 'paid' WHEN 'superseded' THEN 'superseded' ELSE closed_reason END,
  client_message_status=CASE WHEN p_outcome IN ('paid','superseded') AND client_message_status='pending' THEN 'skipped' ELSE client_message_status END,
  locked_at=NULL,last_error=left(p_error,500)
 WHERE id=w.id RETURNING * INTO w;
 RETURN to_jsonb(w);
END; $$;

CREATE FUNCTION complete_quote_withdrawal(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; c colis; w quote_withdrawals; frozen text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service requis.' USING ERRCODE='42501'; END IF;
 SELECT colis_id INTO target FROM quote_withdrawals WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Demande de retrait introuvable.' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM colis WHERE id=target FOR UPDATE;
 SELECT * INTO w FROM quote_withdrawals WHERE id=p_id FOR UPDATE;
 IF w.status NOT IN ('pending','processing','needs_review') THEN
  RETURN jsonb_build_object('status',w.status,'withdrawal',to_jsonb(w),'colis',to_jsonb(c));
 END IF;
 frozen:=_dossier_frozen_reason(c);
 IF frozen IS NOT NULL OR NOT _quote_locked(c) OR c.quote_version IS DISTINCT FROM w.quote_version THEN
  UPDATE quote_withdrawals SET status=CASE WHEN frozen='payment' THEN 'paid' ELSE 'superseded' END,closed_at=clock_timestamp(),
   closed_reason=CASE WHEN frozen='payment' THEN 'paid' ELSE 'superseded' END,locked_at=NULL,
   client_message_status=CASE WHEN client_message_status='pending' THEN 'skipped' ELSE client_message_status END
  WHERE id=w.id RETURNING * INTO w;
  RETURN jsonb_build_object('status',w.status,'withdrawal',to_jsonb(w),'colis',to_jsonb(c));
 END IF;
 PERFORM _withdraw_quote(c,w.source,NULL,w.reason,NULL,w.facture_ids);   -- 40001/22023 while a proof is missing: release with retry
 SELECT * INTO w FROM quote_withdrawals WHERE id=p_id;
 SELECT * INTO c FROM colis WHERE id=target;
 RETURN jsonb_build_object('status',w.status,'withdrawal',to_jsonb(w),'colis',to_jsonb(c));
END; $$;

-- One client message per withdrawn version (key late-invoice:<colis>:<version>); every row of that version follows it.
CREATE FUNCTION mark_quote_withdrawal_message(p_colis_id uuid,p_version integer,p_status text,p_message_id uuid DEFAULT NULL,p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service requis.' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('sent','portal','manual','failed','skipped') THEN RAISE EXCEPTION 'État de message inconnu.' USING ERRCODE='22023'; END IF;
 IF p_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages WHERE id=p_message_id AND colis_id=p_colis_id) THEN
  RAISE EXCEPTION 'Ce message n’appartient pas au dossier.' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM colis WHERE id=p_colis_id FOR UPDATE;
 UPDATE quote_withdrawals SET client_message_status=p_status,message_id=coalesce(p_message_id,message_id),
  last_error=CASE WHEN p_error IS NOT NULL THEN left(p_error,500) ELSE last_error END
 WHERE colis_id=p_colis_id AND withdrawn_quote_version=p_version AND client_message_status='pending';
END; $$;

-- Closing: a new quote, a payment, a cancellation or an archive ends the request. Sorts before z_sync_staff_work.
CREATE FUNCTION close_quote_withdrawals() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.statut IN ('devis_envoye','attente_paiement') AND OLD.statut NOT IN ('devis_envoye','attente_paiement') THEN
  UPDATE quote_withdrawals SET closed_at=clock_timestamp(),closed_reason='new_quote_sent',
   client_message_status=CASE WHEN client_message_status='pending' THEN 'skipped' ELSE client_message_status END
  WHERE colis_id=NEW.id AND closed_at IS NULL AND status='withdrawn';
  -- An open request of an older version (left by a correction) does not apply to the new quote: the portal shows its link.
  UPDATE quote_withdrawals SET status='superseded',closed_at=clock_timestamp(),closed_reason='superseded',locked_at=NULL,
   client_message_status=CASE WHEN client_message_status='pending' THEN 'skipped' ELSE client_message_status END
  WHERE colis_id=NEW.id AND closed_at IS NULL AND status IN ('pending','processing','needs_review') AND quote_version<NEW.quote_version;
 END IF;
 IF NEW.statut='paye' AND OLD.statut<>'paye' THEN
  UPDATE quote_withdrawals SET status=CASE WHEN status IN ('pending','processing','needs_review') THEN 'paid' ELSE status END,
   closed_at=clock_timestamp(),closed_reason='paid',locked_at=NULL,
   client_message_status=CASE WHEN client_message_status='pending' THEN 'skipped' ELSE client_message_status END
  WHERE colis_id=NEW.id AND closed_at IS NULL;
 END IF;
 IF (NEW.statut='annule' AND OLD.statut<>'annule') OR (coalesce(NEW.archive,false) AND NOT coalesce(OLD.archive,false)) THEN
  UPDATE quote_withdrawals SET status=CASE WHEN status IN ('pending','processing','needs_review') THEN 'superseded' ELSE status END,
   closed_at=clock_timestamp(),closed_reason=CASE WHEN coalesce(NEW.archive,false) THEN 'archived' ELSE 'cancelled' END,locked_at=NULL,
   client_message_status=CASE WHEN client_message_status='pending' THEN 'skipped' ELSE client_message_status END
  WHERE colis_id=NEW.id AND closed_at IS NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER y_close_quote_withdrawals AFTER UPDATE OF statut,archive ON colis FOR EACH ROW EXECUTE FUNCTION close_quote_withdrawals();
CREATE TRIGGER z_sync_quote_withdrawal_work AFTER INSERT OR UPDATE ON quote_withdrawals FOR EACH ROW EXECUTE FUNCTION trigger_sync_staff_work_actions();

-- Task projection (copy of 2026-09-21) plus the late-invoice state, its system hint/priority and the client message follow-up.
CREATE OR REPLACE FUNCTION sync_staff_work_actions(p_colis_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; open_case boolean; final_ready boolean; docs_ready boolean; documents_present boolean; has_contact boolean; is_pro boolean; d timestamptz;
 late quote_withdrawals; late_state text; message_attention boolean; late_priority text:='Facture reçue après l’envoi du devis';
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id;
 IF NOT FOUND THEN RETURN; END IF;
 open_case:=NOT c.archive AND c.statut NOT IN ('livre','annule');
 final_ready:=preparation_measurements_ready(c);
 SELECT EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=factures.id) AND coalesce(trim(fichier_url),'')<>''),
  EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=factures.id) AND valide AND nullif(trim(rejet_motif),'') IS NULL AND coalesce(trim(fichier_url),'')<>'')
  AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=factures.id) AND NOT valide AND nullif(trim(rejet_motif),'') IS NULL)
 INTO documents_present,docs_ready;
 SELECT user_id IS NOT NULL OR telegram_chat_id IS NOT NULL,type='pro' INTO has_contact,is_pro FROM clients WHERE id=c.client_id;
 SELECT * INTO late FROM quote_withdrawals WHERE colis_id=c.id AND source<>'staff' AND closed_at IS NULL AND status IN ('pending','processing','needs_review','withdrawn') ORDER BY created_at DESC,id DESC LIMIT 1;
 late_state:=CASE WHEN late.status IN ('pending','processing') THEN 'pending' WHEN late.status='needs_review' THEN 'review' WHEN late.status='withdrawn' THEN 'withdrawn' END;
 message_attention:=EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id=c.id AND closed_at IS NULL AND client_message_status IN ('failed','manual'));
 d:=CASE WHEN c.next_action_source='manual' THEN c.next_action_at END;
 PERFORM _sync_staff_work_action(c.id,'reception',open_case AND c.statut IN ('receptionne','mesure','attente_feu_vert'),CASE WHEN c.statut='attente_feu_vert' AND (c.attente_client_until IS NULL OR c.attente_client_until>now()) THEN CASE WHEN c.attente_client_date IS NOT NULL THEN 'Attente volontaire du client' ELSE 'Accord client attendu' END END,coalesce(c.attente_client_until,d));
 UPDATE staff_work_actions SET action_hint=CASE WHEN c.statut='attente_feu_vert' AND c.attente_client_until<=now() THEN 'Réexaminer l’attente client' ELSE NULL END WHERE colis_id=c.id AND kind='reception' AND action_hint IS DISTINCT FROM CASE WHEN c.statut='attente_feu_vert' AND c.attente_client_until<=now() THEN 'Réexaminer l’attente client' ELSE NULL END;
 PERFORM _sync_staff_work_action(c.id,'preparation',open_case AND c.statut IN ('autorise','en_preparation') AND NOT final_ready,
  CASE WHEN c.produit_interdit THEN 'Contenu à vérifier avant préparation' WHEN c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN 'Accord client requis' END,d);
 PERFORM _sync_staff_work_action(c.id,'documents',open_case AND ((c.statut IN ('receptionne','mesure','attente_feu_vert','autorise','en_preparation') AND NOT docs_ready) OR coalesce(late_state IN ('pending','review'),false)),
  CASE WHEN late_state='pending' THEN 'Annulation de l’ancien lien de paiement en cours' WHEN late_state='review' THEN 'Ancien lien de paiement à vérifier dans PayPlug' WHEN NOT documents_present THEN 'Facture attendue du client' END,d);
 PERFORM _sync_staff_work_action(c.id,'conversation',(NOT c.archive AND (c.conversation_statut<>'termine' OR (open_case AND NOT has_contact))) OR (open_case AND message_attention),CASE WHEN c.conversation_statut='attente_client' AND has_contact THEN 'Réponse attendue du client' END,d);
 UPDATE staff_work_actions SET action_hint=CASE WHEN NOT has_contact THEN 'Accès client à activer' WHEN message_attention THEN 'Prévenir le client : devis en cours de mise à jour' ELSE NULL END WHERE colis_id=c.id AND kind='conversation' AND action_hint IS DISTINCT FROM CASE WHEN NOT has_contact THEN 'Accès client à activer' WHEN message_attention THEN 'Prévenir le client : devis en cours de mise à jour' ELSE NULL END;
 PERFORM _sync_staff_work_action(c.id,'quote',open_case AND c.statut IN ('autorise','en_preparation') AND c.paiement_date IS NULL,
  CASE WHEN c.produit_interdit THEN 'Contenu à vérifier avant le devis' WHEN c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN 'Accord client requis' WHEN NOT final_ready THEN 'Mesures finales après optimisation requises' WHEN NOT docs_ready AND NOT is_pro THEN 'Documents à valider' END,d);
 -- System-managed hint and priority (no version bump, written only when a value differs); a direction priority is never touched.
 UPDATE staff_work_actions w SET action_hint=x.hint,
  priority_reason=CASE WHEN w.priority_by IS NOT NULL THEN w.priority_reason WHEN late_state IS NOT NULL THEN late_priority WHEN w.priority_reason=late_priority THEN NULL ELSE w.priority_reason END,
  priority_until=CASE WHEN w.priority_by IS NOT NULL THEN w.priority_until WHEN late_state IS NOT NULL THEN late.created_at+interval '7 days' WHEN w.priority_reason=late_priority THEN NULL ELSE w.priority_until END
 FROM (VALUES ('documents',CASE WHEN late_state IS NOT NULL THEN 'Vérifier la nouvelle facture puis renvoyer le devis' END),
  ('quote',CASE WHEN late_state IS NOT NULL THEN 'Renvoyer le devis mis à jour au client' END)) x(kind,hint)
 WHERE w.colis_id=c.id AND w.kind=x.kind AND (w.action_hint,w.priority_reason,w.priority_until) IS DISTINCT FROM (x.hint,
  CASE WHEN w.priority_by IS NOT NULL THEN w.priority_reason WHEN late_state IS NOT NULL THEN late_priority WHEN w.priority_reason=late_priority THEN NULL ELSE w.priority_reason END,
  CASE WHEN w.priority_by IS NOT NULL THEN w.priority_until WHEN late_state IS NOT NULL THEN late.created_at+interval '7 days' WHEN w.priority_reason=late_priority THEN NULL ELSE w.priority_until END);
 PERFORM _sync_staff_work_action(c.id,'departure',open_case AND c.statut='paye',NULL,d);
 PERFORM _sync_staff_work_action(c.id,'correction',open_case AND (c.statut='refuse_client' OR c.produit_interdit OR (c.next_action_source='manual' AND nullif(trim(c.next_action),'') IS NOT NULL)),NULL,d);
END; $$;

-- Review context (copy of 2026-09-16): D1 hides proposals of a validated invoice without draft and of a frozen dossier.
CREATE OR REPLACE FUNCTION get_invoice_review_context(p_colis_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis;
BEGIN
 IF NOT is_staff() OR NOT (has_permission('perm_factures_voir') OR has_permission('perm_factures_ajouter') OR has_permission('perm_factures_valider') OR has_permission('perm_factures_refuser') OR has_permission('perm_factures_ocr') OR has_permission('perm_factures_modifier_articles')) THEN RAISE EXCEPTION 'Accès factures requis' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable'; END IF;
 RETURN jsonb_build_object('invoices',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'factureId',f.id,'reviewToken',invoice_review_token(f.id),'extraction',CASE WHEN r.reason IN ('frozen','validated') THEN NULL ELSE to_jsonb(e) END,
  'analysisAllowed',r.reason IS NULL,'analysisBlockedReason',r.reason,
  'draft',(SELECT payload FROM invoice_review_drafts d WHERE d.facture_id=f.id),
  'documentHash',e.document_hash,'duplicateCandidateIds',coalesce((
   SELECT jsonb_agg(other.id ORDER BY other.created_at,other.id) FROM factures other
   WHERE other.colis_id=f.colis_id AND other.id<>f.id AND other.duplicate_of_facture_id IS NULL AND other.rejet_motif IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=other.id)
   AND EXISTS(SELECT 1 FROM ocr_extractions oe WHERE oe.facture_id=other.id AND oe.document_file_url=other.fichier_url AND (oe.document_storage_identity IS NULL OR oe.document_storage_identity=invoice_storage_identity(other.fichier_url)) AND oe.document_hash=e.document_hash)), '[]')) ORDER BY f.created_at,f.id)
  FROM factures f LEFT JOIN LATERAL (SELECT * FROM ocr_extractions current_e WHERE current_e.facture_id=f.id AND current_e.document_file_url=f.fichier_url AND (current_e.document_storage_identity IS NULL OR current_e.document_storage_identity=invoice_storage_identity(f.fichier_url)) ORDER BY current_e.created_at DESC,current_e.id LIMIT 1) e ON true
  CROSS JOIN LATERAL (SELECT _invoice_analysis_reason(f) AS reason) r WHERE f.colis_id=p_colis_id),'[]'),
  'unlinkedLines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at,l.id) FROM lignes l WHERE l.colis_id=p_colis_id AND l.facture_id IS NULL),'[]'),
  'lock',jsonb_build_object('frozenReason',_dossier_frozen_reason(c),'quoteLocked',_quote_locked(c),'quoteSent',c.statut IN ('devis_envoye','attente_paiement'),'liveLink',_live_payment_link(c),
   'withdrawal',(SELECT jsonb_build_object('id',w.id,'source',w.source,'status',w.status,'createdAt',w.created_at,'withdrawnAt',w.withdrawn_at,'linkCancelled',w.link_cancelled,
     'clientMessageStatus',w.client_message_status,'lastError',w.last_error,'factureIds',to_jsonb(w.facture_ids))
    FROM quote_withdrawals w WHERE w.colis_id=c.id AND (w.closed_at IS NULL OR w.status='paid')
    ORDER BY (w.closed_at IS NULL) DESC,(w.source<>'staff') DESC,w.created_at DESC,w.id DESC LIMIT 1)));
END; $$;

-- Client projection: the old link is hidden while a late invoice is processed; the portal shows the update state.
-- Inline sub-queries only (a function called by a view is checked against the caller's EXECUTE privilege).
-- The current deparse is unqualified (THEN payplug_payment_url); a qualified form is accepted too. Each anchor once.
DO $$ DECLARE definition text; link_anchor text; tail text:=E'\n   FROM colis'; BEGIN
 definition:=pg_get_viewdef('public.client_colis'::regclass,true);
 link_anchor:=CASE WHEN position('THEN colis.payplug_payment_url' IN definition)>0 THEN 'THEN colis.payplug_payment_url' ELSE 'THEN payplug_payment_url' END;
 IF (length(definition)-length(replace(definition,link_anchor,'')))/length(link_anchor)<>1
  OR (length(definition)-length(replace(definition,tail,'')))/length(tail)<>1
  OR position('quote_withdrawals' IN definition)>0 OR position('quote_update_pending' IN definition)>0 THEN
  RAISE EXCEPTION 'Unexpected client dossier view for late invoices';
 END IF;
 definition:=replace(definition,link_anchor,'AND NOT (EXISTS (SELECT 1 FROM quote_withdrawals w WHERE w.colis_id = colis.id AND w.status IN (''pending'',''processing'',''needs_review''))) '||link_anchor);
 definition:=replace(definition,tail,','||E'\n    (EXISTS (SELECT 1 FROM quote_withdrawals w WHERE w.colis_id = colis.id AND w.source <> ''staff'' AND w.closed_at IS NULL AND w.status IN (''pending'',''processing'',''needs_review'',''withdrawn''))) AS quote_update_pending'||tail);
 EXECUTE 'CREATE OR REPLACE VIEW public.client_colis WITH (security_barrier=true) AS '||definition;
END $$;

-- Existing commands keep permissions, owner checks, CAS and audit: one guarded call before their dossier/invoice lock.
-- import_conversation_invoice has no task-owner guard (unchanged), so only its own anchor is required.
DO $$
DECLARE item record; definition text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('save_invoice_review(uuid,text,text,jsonb,numeric,text,uuid,boolean)',true,
   ' SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;',
   ' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=p_facture_id),NOT p_confirm AND NOT coalesce((SELECT valide FROM factures WHERE id=p_facture_id),false));'),
  ('classify_invoice_duplicate(uuid,uuid,text,text)',true,
   ' SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;',
   ' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=p_facture_id),false);'),
  ('restore_invoice_duplicate(uuid,text)',true,
   ' SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;',
   ' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=p_facture_id),false);'),
  ('import_conversation_invoice(uuid)',false,
   ' SELECT * INTO c FROM colis WHERE id=m.colis_id FOR UPDATE;',
   ' PERFORM _assert_invoices_editable(m.colis_id,false);'),
  ('confirm_ocr_extraction_current(uuid,text,text,jsonb,numeric,text)',true,
   ' SELECT * INTO f FROM factures WHERE id=invoice_id FOR UPDATE;',
   ' PERFORM _assert_invoices_editable((SELECT colis_id FROM factures WHERE id=invoice_id),false);')
 ) AS injections(signature,owner_guarded,anchor,guarded) LOOP
  definition:=pg_get_functiondef(('public.'||item.signature)::regprocedure);
  IF (item.owner_guarded AND position('_assert_staff_task_owner(' IN definition)=0) OR position('_assert_invoices_editable(' IN definition)>0
   OR (length(definition)-length(replace(definition,item.anchor,'')))/length(item.anchor)<>1 THEN
   RAISE EXCEPTION 'Unexpected definition for invoice lock guard: %',item.signature;
  END IF;
  EXECUTE replace(definition,item.anchor,item.guarded||E'\n'||item.anchor);
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION _dossier_frozen_reason(colis),_frozen_message(text),_live_payment_link(colis),_quote_locked(colis),
 _invoice_analysis_reason(factures),_identical_validated_invoice(uuid,text),_late_invoice_open(uuid),_late_invoice_withdrawal(factures),
 _assert_invoices_editable(uuid,boolean),_open_late_invoice_request(colis,uuid,text),_withdraw_quote(colis,text,text,text,uuid,uuid[]),
 _assert_withdrawal_followup(uuid,text,uuid,text,uuid),
 _open_invoice_modification(uuid,text),_import_conversation_attachment(uuid,uuid),
 guard_invoice_lock(),guard_invoice_analysis(),close_quote_withdrawals() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION open_invoice_modification(uuid,text),close_invoice_modification(uuid,text),
 withdraw_quote_for_documents(uuid,timestamptz,text,text,uuid,text,uuid),deposit_client_invoice(uuid,text,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION open_invoice_modification(uuid,text),close_invoice_modification(uuid,text),
 withdraw_quote_for_documents(uuid,timestamptz,text,text,uuid,text,uuid),deposit_client_invoice(uuid,text,text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION invoice_lock_state(uuid),invoice_analysis_gate(uuid),client_document_precheck(uuid,uuid,text,text),withdraw_quote_preflight(uuid,text,uuid,text,uuid),
 register_telegram_document(uuid,text,text),register_late_invoice_from_message(uuid,text),claim_quote_withdrawal(uuid,boolean),
 release_quote_withdrawal(uuid,text,text),complete_quote_withdrawal(uuid),mark_quote_withdrawal_message(uuid,integer,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION invoice_lock_state(uuid),invoice_analysis_gate(uuid),client_document_precheck(uuid,uuid,text,text),withdraw_quote_preflight(uuid,text,uuid,text,uuid),
 register_telegram_document(uuid,text,text),register_late_invoice_from_message(uuid,text),claim_quote_withdrawal(uuid,boolean),
 release_quote_withdrawal(uuid,text,text),complete_quote_withdrawal(uuid),mark_quote_withdrawal_message(uuid,integer,text,uuid,text) TO service_role;
