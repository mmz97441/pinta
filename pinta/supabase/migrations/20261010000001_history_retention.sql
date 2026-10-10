-- Retention of payments and of the audit trail (compliance reference of 2026-10-10, docs/facturation-conformite.md,
-- rules F18, F22, F23, C14 and decision I2: « aucun droit UPDATE ni DELETE sur [...] les paiements ; un dossier qui porte
-- un devis, un paiement ou une facture ne peut plus être supprimé. Dans les migrations du dépôt, paiements, audit_actions
-- et logs_statut sont supprimés en cascade avec le dossier : remplacer par une interdiction pour ces enregistrements »).
-- Payment records and the journals that form the audit trail are kept ten years (from 2027-01-01), never modified nor
-- erased; a correction is a new « plus / moins » record. No business row is written by this migration: foreign keys,
-- private trigger functions, triggers and REVOKEs only.
--
-- Inventory (local replay of the repository on PostgreSQL 17, production-like legacy schema; writers read in
-- pinta/supabase/migrations, pinta/supabase/functions and pinta/src/expedile/lib/supabaseData.js):
--
-- paiements — the money ledger (positive payment, negative refund). FK colis_id ON DELETE CASCADE → RESTRICT;
--   client_id, confirme_par NO ACTION. Writers: _record_payment only (INSERT 'confirme'), called by
--   confirm_payplug_payment (payplug-webhook, service role), mark_manual_payment (staff) and
--   confirm_legacy_payplug_payment (webhook). Nothing updates or deletes a row. Rule: append-only.
-- payment_intents — one PayPlug link per dossier and quote version. FK colis_id NO ACTION. Writers:
--   reserve_payplug_intent (INSERT creating; failed → creating with a new return token, same amount: a quote version
--   has one total, version_quote bumps the version on any change of the total), Edge payplug-create (creating →
--   pending with provider_id and payment_url; → failed on a refusal, by id only, so a link superseded meanwhile
--   becomes failed too), version_quote, _withdraw_quote and correct_colis_task (creating|pending → superseded),
--   confirm_payplug_payment (pending → paid, paid → paid on a repeated webhook), record_payplug_cancellation
--   (provider_cancelled_at, once). Rule, kept as a narrow state machine (an insert-only rewrite would change these seven
--   writers and every reader that looks a link up by its reference: get_payment_return, payplugCancel,
--   _live_payment_link, _dossier_frozen_reason): no DELETE; dossier, quote version, amount, currency, live mode and
--   creation date frozen; the PayPlug reference set once, only by creating → pending; the cancellation proof set once;
--   the return token renewed only by failed → creating; only the transitions above; a paid link is final (its
--   updated_at only). The money itself is the ledger, paiements.
-- legacy_payplug_payments — the closed register of the former PayPlug links: already guarded since 20260910000012
--   (guard_legacy_payplug_snapshot: INSERT and DELETE refused; invalidation, first verification and cancellation proof
--   only, once). FKs NO ACTION. Added here: TRUNCATE refused, API UPDATE/DELETE/TRUNCATE revoked.
-- quote_versions — every saved quote. FK colis_id NO ACTION. Writers, INSERT only: version_quote (trigger on any change
--   of the quote amounts, behind save_quote, save_quote_customs, correct_colis_task, ...), _withdraw_quote,
--   correct_colis_task and append_reception_cartons (ON CONFLICT DO NOTHING). Rule: append-only.
-- quote_withdrawals — requests to withdraw a sent quote (process state plus their record). FKs NO ACTION. Writers:
--   _open_late_invoice_request (INSERT, upsert appending facture_ids; open → superseded), _withdraw_quote (INSERT
--   withdrawn; open → withdrawn), withdraw_quote_for_documents (appends facture_ids), claim/release/complete_
--   quote_withdrawal (service role), close_quote_withdrawals (trigger), mark_quote_withdrawal_message. Rule: no DELETE;
--   the request (dossier, origin, action, quote version, reason, author, creation) frozen; facture_ids only grow; the
--   effective withdrawal (withdrawn_at, withdrawn_quote_version, previous_statut) final once recorded. Status, retries,
--   locks, messages and closing stay process state.
-- audit_actions — the action journal. FK colis_id NO ACTION in production (legacy table, see
--   tests/legacy-schema-fixture.sql) but ON DELETE CASCADE on a fresh replay (20260910000001) → RESTRICT; user_id NO
--   ACTION. Writers, INSERT only: about thirty SQL commands, Edge send-telegram (retry_message) and consentReply,
--   supabaseData.insertAuditAction, the deployment scripts. Rule: append-only; a correction is a new entry.
-- logs_statut — the status journal. FK colis_id CASCADE → RESTRICT. Writer: fn_log_statut_change (AFTER UPDATE OF statut
--   ON colis); supabaseData.insertLog has no INSERT policy (refused, logged in the console). Rule: append-only.
-- messages — the conversation of each dossier (consent requests and client decisions included). FK colis_id CASCADE →
--   RESTRICT. Writers: INSERT by queue_message, _apply_client_decision, customer_document_received, deposit_client_invoice,
--   telegramIncoming (ON CONFLICT DO NOTHING), supabaseData.insertMessage and AppContext; UPDATE of lu (staff policy,
--   updateMessageLu, markAllMessagesLu, conversationApi) and of statut and telegram_msg_id (Edge dispatchOutbox, echec
--   included after an ambiguous send). Rule: no DELETE; only lu, statut and telegram_msg_id change; statut and
--   telegram_msg_id only with the service key or as the owner (a team session marks read, nothing else); a delivery
--   confirmed by Telegram (envoye) never returns to envoi or echec.
-- notification_outbox — every delivery attempt. FKs message_id, client_id, colis_id NO ACTION. Writers: queue_message
--   (INSERT pending, manual or sent), guard_reminder_queue (pending → blocked), Edge dispatchOutbox (pending|blocked →
--   sending → sent|failed|cancelled|blocked|pending), relances-auto (stale sending → failed), send-telegram retry
--   (failed → pending), _apply_client_decision, _withdraw_quote, cancel_previous_consent_requests and
--   correct_colis_task (→ cancelled), reopen_customer_conversation and set_conversation_state (pending ⇄ blocked).
--   Nothing updates a sent or cancelled row. Rule: no DELETE; message, client, dossier, quote version, channel, buttons,
--   idempotency key and creation frozen; a sent or cancelled row is final.
-- client_inbox — client messages received without a dossier. FKs NO ACTION. Writers: telegram-webhook (INSERT ON
--   CONFLICT DO NOTHING, error label, assignment), telegram-inbox-assign, claim_inbox_assignment (dossier chosen once).
--   Rule: no DELETE; client, Telegram event, creation and received payload (intake_error aside) frozen; a chosen dossier
--   is final.
-- com_log — the legacy communication journal: no writer in the current code. FK colis_id ON DELETE SET NULL → RESTRICT
--   (a deletion would have orphaned it); client_id NO ACTION. Rule: append-only.
-- reception_append_receipts — who added which cartons to a dossier. FK colis_id CASCADE → RESTRICT. Writer:
--   append_reception_cartons (INSERT). Rule: append-only.
-- departure_manifests — the confirmed departure file. FK envoi_id RESTRICT (kept). Writer: confirm_departure (INSERT).
--   Rule: append-only.
-- departure_loading_checks — the loading control. FKs envoi_id, colis_id, checked_by ON DELETE CASCADE, kept: before the
--   confirmation the checks are working state (record_loading_check, record_loading_count, clear_loading_checks and
--   _loading_checks_forget delete them; the 2026-10-07 design, tests C7 and C9); confirm_departure copies them into the
--   manifest. Rule: the checks of a confirmed departure (departed_at or manifest_version) can no longer be updated or
--   deleted, by a command, a cascade (dossier, departure or staff profile) or directly.
-- Parents. colis: nothing deletes a dossier (front, Edge, SQL); a dossier with any history (payment, link, quote, quote
--   version or withdrawal, journal, message, delivery, inbox, document, reception receipt, shipment or confirmed
--   departure) can no longer be deleted. clients: supabaseData.deleteClient (direction, RLS); guard_client_history_delete
--   (20260917000001) refuses a client with dossiers; the NO ACTION keys of payments, deliveries, inbox, com_log and
--   Telegram invitations already refused the others, in English: same refusal, now in French. envois:
--   supabaseData.deleteEnvoi (no screen uses it); RLS lets perm_envois_modifier delete a planned departure without
--   dossier only; guard_departure_changes refuses a confirmed departure; now also a departure that left (parti or
--   arrive, legacy rows without departed_at included) or that still carries dossiers (ON DELETE SET NULL would detach
--   them silently).
-- Left as they are (not money nor journal): notifications (read flags, CASCADE with the profile), alertes,
--   staff_work_actions, staff_work_preferences, colis_locks, factures and lignes (working documents, captured by the
--   quote snapshots and the manifest; a dossier with documents can no longer be deleted), ocr_jobs, ocr_extractions,
--   invoice_review_drafts, telegram_updates, telegram_invitations (counted as client history by the client guard),
--   share_links, message_templates_versions, tarifs (rates updated in place by save_admin_tariffs: the invoicing lot's
--   versioned grid), the storage buckets, and colis.paiement_* (a copy of the ledger written by _record_payment, which
--   guard_colis_permissions already keeps from the browser).
--
-- Refusals raise a French message with SQLSTATE 23001 (restrict_violation) and HINT retention:<table>; the screens show
-- the message as it is. Row triggers retention_guard (BEFORE; named to fire after the guard_* triggers, which may still
-- adjust NEW, e.g. guard_reminder_queue, and before z_guard_client_required_fields, which must stay the last BEFORE row
-- trigger of clients) and statement triggers retention_truncate (BEFORE TRUNCATE, cascades included). The trigger functions
-- are private (no EXECUTE for the API roles), with a fixed search_path; those that read other tables are SECURITY
-- DEFINER so that RLS never hides a history row from them. The API roles lose UPDATE, DELETE and TRUNCATE on the
-- append-only tables and DELETE and TRUNCATE on the others; their reads, inserts and the updates listed above stay.
-- The triggers bind every role, the table owner and the SECURITY DEFINER commands included; only a superuser session in
-- session_replication_role=replica, or a reviewed migration disabling a trigger in its own transaction (for instance to
-- fill a column it adds), can bypass them.

-- ── Foreign keys: no deletion of a dossier, client, departure or message erases or orphans a history row ──
-- Looked up by column, whatever their name: CASCADE, SET NULL and SET DEFAULT keys are replaced by RESTRICT; RESTRICT and
-- NO ACTION keys are kept; a missing key is added (the preflight reports orphan rows, which would make this fail).
DO $$
DECLARE spec record; fk record; kept boolean;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
   ('paiements','colis_id','colis'),('paiements','client_id','clients'),
   ('payment_intents','colis_id','colis'),
   ('legacy_payplug_payments','colis_id','colis'),('legacy_payplug_payments','client_id','clients'),
   ('quote_versions','colis_id','colis'),
   ('quote_withdrawals','colis_id','colis'),('quote_withdrawals','message_id','messages'),
   ('audit_actions','colis_id','colis'),
   ('logs_statut','colis_id','colis'),
   ('messages','colis_id','colis'),
   ('notification_outbox','message_id','messages'),('notification_outbox','client_id','clients'),('notification_outbox','colis_id','colis'),
   ('client_inbox','client_id','clients'),('client_inbox','colis_id','colis'),
   ('com_log','colis_id','colis'),('com_log','client_id','clients'),
   ('reception_append_receipts','colis_id','colis'),
   ('departure_manifests','envoi_id','envois')) s(tbl,col,parent)
 LOOP
  kept:=false;
  FOR fk IN SELECT c.conname,c.confdeltype FROM pg_constraint c
    WHERE c.contype='f' AND c.conrelid=format('public.%I',spec.tbl)::regclass AND c.confrelid=format('public.%I',spec.parent)::regclass
     AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid=format('public.%I',spec.tbl)::regclass AND a.attname=spec.col AND NOT a.attisdropped)]
    ORDER BY c.conname
  LOOP
   IF fk.confdeltype IN ('r','a') THEN kept:=true;
   ELSE EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',spec.tbl,fk.conname); END IF;
  END LOOP;
  IF NOT kept THEN
   EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE RESTRICT',
    spec.tbl,spec.tbl||'_'||spec.col||'_fkey',spec.col,spec.parent);
  END IF;
 END LOOP;
END $$;

-- ── Append-only tables: no UPDATE, no DELETE ──
CREATE FUNCTION _retention_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION '%',CASE TG_TABLE_NAME
   WHEN 'paiements' THEN 'Un paiement enregistré ne se modifie pas et ne se supprime pas : une correction s’enregistre comme une nouvelle écriture, de signe opposé.'
   WHEN 'quote_versions' THEN 'Une version de devis enregistrée est conservée telle quelle : un nouveau calcul crée une nouvelle version.'
   WHEN 'audit_actions' THEN 'Le journal des actions est conservé dix ans : une entrée ne se modifie pas et ne se supprime pas ; une correction s’ajoute comme une nouvelle entrée.'
   WHEN 'logs_statut' THEN 'L’historique des statuts est conservé dix ans : une entrée ne se modifie pas et ne se supprime pas.'
   WHEN 'departure_manifests' THEN 'Le manifeste d’un départ confirmé est conservé tel quel : il ne se modifie pas et ne se supprime pas.'
   WHEN 'com_log' THEN 'Le journal des communications est conservé dix ans : une entrée ne se modifie pas et ne se supprime pas.'
   WHEN 'reception_append_receipts' THEN 'Le reçu d’un ajout de cartons est conservé tel quel : il ne se modifie pas et ne se supprime pas.'
   ELSE 'Cet historique est conservé dix ans : il ne se modifie pas et ne se supprime pas.' END
  USING ERRCODE='23001',HINT='retention:'||TG_TABLE_NAME;
END $$;
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON paiements FOR EACH ROW EXECUTE FUNCTION _retention_append_only();
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON quote_versions FOR EACH ROW EXECUTE FUNCTION _retention_append_only();
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON audit_actions FOR EACH ROW EXECUTE FUNCTION _retention_append_only();
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON logs_statut FOR EACH ROW EXECUTE FUNCTION _retention_append_only();
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON departure_manifests FOR EACH ROW EXECUTE FUNCTION _retention_append_only();
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON com_log FOR EACH ROW EXECUTE FUNCTION _retention_append_only();
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON reception_append_receipts FOR EACH ROW EXECUTE FUNCTION _retention_append_only();

-- ── payment_intents: the states the writers use, money frozen ──
CREATE FUNCTION _retention_payment_intent() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Un lien de paiement est conservé dans l’historique des paiements : il ne se supprime pas.' USING ERRCODE='23001',HINT='retention:payment_intents';
 END IF;
 IF (NEW.id,NEW.colis_id,NEW.quote_version,NEW.amount_cents,NEW.currency,NEW.provider_is_live,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.colis_id,OLD.quote_version,OLD.amount_cents,OLD.currency,OLD.provider_is_live,OLD.created_at) THEN
  RAISE EXCEPTION 'Le dossier, la version du devis, le montant, la devise et le mode d’un lien de paiement ne se modifient pas.' USING ERRCODE='23001',HINT='retention:payment_intents';
 END IF;
 IF OLD.status='paid' AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN
  RAISE EXCEPTION 'Un paiement confirmé par PayPlug est définitif : son lien ne se modifie plus.' USING ERRCODE='23001',HINT='retention:payment_intents';
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
     (OLD.status='creating' AND NEW.status IN ('pending','failed','superseded'))
  OR (OLD.status='pending' AND NEW.status IN ('paid','superseded'))
  OR (OLD.status='failed' AND NEW.status='creating')
  OR (OLD.status='superseded' AND NEW.status='failed' AND OLD.provider_id IS NULL AND OLD.payment_url IS NULL)) THEN
  RAISE EXCEPTION 'Changement d’état du lien de paiement refusé : % → %.',OLD.status,NEW.status USING ERRCODE='23001',HINT='retention:payment_intents';
 END IF;
 IF (NEW.provider_id,NEW.payment_url) IS DISTINCT FROM (OLD.provider_id,OLD.payment_url)
  AND NOT (OLD.status='creating' AND NEW.status='pending' AND OLD.provider_id IS NULL AND OLD.payment_url IS NULL) THEN
  RAISE EXCEPTION 'La référence PayPlug d’un lien de paiement ne se modifie pas.' USING ERRCODE='23001',HINT='retention:payment_intents';
 END IF;
 IF OLD.provider_cancelled_at IS NOT NULL AND NEW.provider_cancelled_at IS DISTINCT FROM OLD.provider_cancelled_at THEN
  RAISE EXCEPTION 'La preuve d’annulation PayPlug d’un lien est définitive.' USING ERRCODE='23001',HINT='retention:payment_intents';
 END IF;
 IF (NEW.return_token_hash,NEW.return_token_expires_at) IS DISTINCT FROM (OLD.return_token_hash,OLD.return_token_expires_at)
  AND NOT (OLD.status='failed' AND NEW.status='creating') THEN
  RAISE EXCEPTION 'Le jeton de retour d’un lien de paiement ne se renouvelle qu’à une nouvelle tentative de création.' USING ERRCODE='23001',HINT='retention:payment_intents';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON payment_intents FOR EACH ROW EXECUTE FUNCTION _retention_payment_intent();

-- ── messages: delivery state and reading only ──
-- The delivery state (statut, telegram_msg_id) is written by the outbox dispatcher with the service key (PostgREST runs
-- it as service_role), or by a reviewed command running as the owner; a team session only marks a message read (its
-- RLS policy lets it update the row). A delivery Telegram confirmed (envoye, or a later receipt) never goes back to envoi
-- or echec, as its outbox row stays sent: dispatchOutbox's catch after a confirmed send can no longer show a delivered
-- message as failed.
CREATE FUNCTION _retention_message() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Un message est conservé dans l’historique du dossier : il ne se supprime pas.' USING ERRCODE='23001',HINT='retention:messages';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['lu','statut','telegram_msg_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['lu','statut','telegram_msg_id']) THEN
  RAISE EXCEPTION 'Le contenu d’un message enregistré ne se modifie pas : seuls son état d’envoi et sa lecture évoluent.' USING ERRCODE='23001',HINT='retention:messages';
 END IF;
 IF (NEW.statut,NEW.telegram_msg_id) IS DISTINCT FROM (OLD.statut,OLD.telegram_msg_id)
  AND current_user NOT IN ('postgres','supabase_admin','service_role') THEN
  RAISE EXCEPTION 'L’état d’envoi d’un message est enregistré par l’envoi lui-même : l’équipe peut seulement le marquer comme lu.' USING ERRCODE='23001',HINT='retention:messages';
 END IF;
 IF OLD.statut IN ('envoye','distribue','lu') AND NEW.statut IN ('envoi','echec') THEN
  RAISE EXCEPTION 'Un message dont l’envoi est confirmé le reste : son état ne revient ni à « en cours » ni à « échec ».' USING ERRCODE='23001',HINT='retention:messages';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION _retention_message();

-- ── notification_outbox: references frozen, a sent or cancelled delivery final ──
CREATE FUNCTION _retention_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Une sortie de message est conservée dans l’historique des envois : elle ne se supprime pas.' USING ERRCODE='23001',HINT='retention:notification_outbox';
 END IF;
 IF (NEW.id,NEW.message_id,NEW.client_id,NEW.colis_id,NEW.quote_version,NEW.canal,NEW.reply_markup,NEW.idempotency_key,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.message_id,OLD.client_id,OLD.colis_id,OLD.quote_version,OLD.canal,OLD.reply_markup,OLD.idempotency_key,OLD.created_at) THEN
  RAISE EXCEPTION 'Le message, le destinataire, le dossier et le canal d’une sortie de message ne se modifient pas.' USING ERRCODE='23001',HINT='retention:notification_outbox';
 END IF;
 IF OLD.status IN ('sent','cancelled') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
  RAISE EXCEPTION 'Un envoi confirmé ou annulé est définitif : sa sortie ne se modifie plus.' USING ERRCODE='23001',HINT='retention:notification_outbox';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON notification_outbox FOR EACH ROW EXECUTE FUNCTION _retention_outbox();

-- ── quote_withdrawals: the request and the effective withdrawal are a record ──
CREATE FUNCTION _retention_quote_withdrawal() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Une demande de retrait de devis est conservée dans l’historique du dossier : elle ne se supprime pas.' USING ERRCODE='23001',HINT='retention:quote_withdrawals';
 END IF;
 IF (NEW.id,NEW.colis_id,NEW.source,NEW.action,NEW.quote_version,NEW.reason,NEW.requested_by,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.colis_id,OLD.source,OLD.action,OLD.quote_version,OLD.reason,OLD.requested_by,OLD.created_at)
  OR NOT (NEW.facture_ids @> OLD.facture_ids) THEN
  RAISE EXCEPTION 'Une demande de retrait de devis (dossier, version, origine, motif, auteur, factures concernées) ne se réécrit pas.' USING ERRCODE='23001',HINT='retention:quote_withdrawals';
 END IF;
 IF OLD.withdrawn_at IS NOT NULL AND (NEW.withdrawn_at,NEW.withdrawn_quote_version,NEW.previous_statut)
  IS DISTINCT FROM (OLD.withdrawn_at,OLD.withdrawn_quote_version,OLD.previous_statut) THEN
  RAISE EXCEPTION 'Le retrait effectif d’un devis (date, version, étape précédente) est définitif.' USING ERRCODE='23001',HINT='retention:quote_withdrawals';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON quote_withdrawals FOR EACH ROW EXECUTE FUNCTION _retention_quote_withdrawal();

-- ── client_inbox: what the client sent is kept, its dossier once chosen too ──
CREATE FUNCTION _retention_client_inbox() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Un message reçu d’un client est conservé : il ne se supprime pas.' USING ERRCODE='23001',HINT='retention:client_inbox';
 END IF;
 IF (NEW.id,NEW.client_id,NEW.telegram_update_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.client_id,OLD.telegram_update_id,OLD.created_at)
  OR (NEW.payload-'intake_error') IS DISTINCT FROM (OLD.payload-'intake_error') THEN
  RAISE EXCEPTION 'Un message reçu (client, événement Telegram, contenu d’origine) ne se modifie pas.' USING ERRCODE='23001',HINT='retention:client_inbox';
 END IF;
 IF OLD.colis_id IS NOT NULL AND NEW.colis_id IS DISTINCT FROM OLD.colis_id THEN
  RAISE EXCEPTION 'Un message reçu rattaché à un dossier y reste.' USING ERRCODE='23001',HINT='retention:client_inbox';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON client_inbox FOR EACH ROW EXECUTE FUNCTION _retention_client_inbox();

-- ── departure_loading_checks: frozen once their departure is confirmed (the manifest holds them) ──
CREATE FUNCTION _retention_loading_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM envois e WHERE e.id=OLD.envoi_id AND (e.departed_at IS NOT NULL OR e.manifest_version>0)) THEN
  RAISE EXCEPTION 'Le contrôle de chargement d’un départ confirmé est conservé tel quel : il figure au manifeste du départ.' USING ERRCODE='23001',HINT='retention:departure_loading_checks';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retention_guard BEFORE UPDATE OR DELETE ON departure_loading_checks FOR EACH ROW EXECUTE FUNCTION _retention_loading_check();

-- ── Parents: a dossier, client or departure that carries history is kept ──
CREATE FUNCTION _retention_colis_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.paiement_date IS NOT NULL OR OLD.paiement_montant IS NOT NULL OR OLD.date_expedition IS NOT NULL OR OLD.quote_version>0 OR OLD.devis_total IS NOT NULL
  OR EXISTS(SELECT 1 FROM paiements WHERE colis_id=OLD.id) OR EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=OLD.id)
  OR EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=OLD.id) OR EXISTS(SELECT 1 FROM quote_versions WHERE colis_id=OLD.id)
  OR EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id=OLD.id) OR EXISTS(SELECT 1 FROM audit_actions WHERE colis_id=OLD.id)
  OR EXISTS(SELECT 1 FROM logs_statut WHERE colis_id=OLD.id) OR EXISTS(SELECT 1 FROM messages WHERE colis_id=OLD.id)
  OR EXISTS(SELECT 1 FROM notification_outbox WHERE colis_id=OLD.id) OR EXISTS(SELECT 1 FROM client_inbox WHERE colis_id=OLD.id)
  OR EXISTS(SELECT 1 FROM com_log WHERE colis_id=OLD.id) OR EXISTS(SELECT 1 FROM reception_append_receipts WHERE colis_id=OLD.id)
  OR EXISTS(SELECT 1 FROM factures WHERE colis_id=OLD.id)
  OR EXISTS(SELECT 1 FROM envois e WHERE e.id=OLD.envoi_id AND (e.departed_at IS NOT NULL OR e.manifest_version>0)) THEN
  RAISE EXCEPTION 'Ce dossier a un historique conservé dix ans (devis, paiement, messages, documents ou journal) : il ne peut pas être supprimé. Annulez-le ou archivez-le.'
   USING ERRCODE='23001',HINT='retention:colis';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER retention_guard BEFORE DELETE ON colis FOR EACH ROW EXECUTE FUNCTION _retention_colis_delete();

CREATE FUNCTION _retention_client_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM colis WHERE client_id=OLD.id) OR EXISTS(SELECT 1 FROM paiements WHERE client_id=OLD.id)
  OR EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE client_id=OLD.id) OR EXISTS(SELECT 1 FROM notification_outbox WHERE client_id=OLD.id)
  OR EXISTS(SELECT 1 FROM client_inbox WHERE client_id=OLD.id) OR EXISTS(SELECT 1 FROM com_log WHERE client_id=OLD.id)
  OR EXISTS(SELECT 1 FROM telegram_invitations WHERE client_id=OLD.id) THEN
  RAISE EXCEPTION 'Ce client a un historique conservé dix ans (dossiers, échanges, invitation Telegram ou paiements) : sa fiche ne peut pas être supprimée.'
   USING ERRCODE='23001',HINT='retention:clients';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER retention_guard BEFORE DELETE ON clients FOR EACH ROW EXECUTE FUNCTION _retention_client_delete();

CREATE FUNCTION _retention_departure_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.departed_at IS NOT NULL OR OLD.manifest_version>0 OR OLD.statut IN ('parti','arrive')
  OR EXISTS(SELECT 1 FROM departure_manifests WHERE envoi_id=OLD.id) THEN
  RAISE EXCEPTION 'Un départ parti reste dans l’historique : il ne peut pas être supprimé.' USING ERRCODE='23001',HINT='retention:envois';
 END IF;
 IF EXISTS(SELECT 1 FROM colis WHERE envoi_id=OLD.id) THEN
  RAISE EXCEPTION 'Ce départ contient encore des dossiers : retirez-les du départ avant de le supprimer.' USING ERRCODE='23001',HINT='retention:envois';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER retention_guard BEFORE DELETE ON envois FOR EACH ROW EXECUTE FUNCTION _retention_departure_delete();

-- ── TRUNCATE (a cascade from a parent included) ──
CREATE FUNCTION _retention_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'L’historique « % » est conservé dix ans : il ne peut pas être vidé.',TG_TABLE_NAME USING ERRCODE='23001',HINT='retention:'||TG_TABLE_NAME;
END $$;
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON paiements FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON payment_intents FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON legacy_payplug_payments FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON quote_versions FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON quote_withdrawals FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON audit_actions FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON logs_statut FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON messages FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON notification_outbox FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON client_inbox FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON com_log FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON reception_append_receipts FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON departure_manifests FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();
CREATE TRIGGER retention_truncate BEFORE TRUNCATE ON departure_loading_checks FOR EACH STATEMENT EXECUTE FUNCTION _retention_truncate();

-- ── Privileges: the API roles keep their reads, inserts and the updates listed above ──
REVOKE UPDATE,DELETE,TRUNCATE ON paiements,quote_versions,audit_actions,logs_statut,departure_manifests,com_log,reception_append_receipts,legacy_payplug_payments
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE DELETE,TRUNCATE ON payment_intents,quote_withdrawals,messages,notification_outbox,client_inbox,departure_loading_checks
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION _retention_append_only(),_retention_payment_intent(),_retention_message(),_retention_outbox(),_retention_quote_withdrawal(),
 _retention_client_inbox(),_retention_loading_check(),_retention_colis_delete(),_retention_client_delete(),_retention_departure_delete(),_retention_truncate()
 FROM PUBLIC,anon,authenticated,service_role;
