-- Consent relance follow-up (final review of lot 3a, 2026-10-07, refined after the final verification review).
-- 1. The latest consent request or relance written by the team (a staff message, template demande_feu_vert or
--    relance_feu_vert; a client's message never counts) is followed up until it reaches the client, then for 24 hours:
--    while its Telegram delivery is still to come (outbox pending, blocked by an open conversation, rescheduled by the
--    24-hour client rule, or sending), and during the 24 hours after notification_outbox.sent_at, an awaited consent is
--    not relanced. An e-mail draft (outbox manual) or a portal message is followed up for 24 hours from its creation:
--    the team acted, no delivery is claimed. A delivery that failed (outbox failed, or message « echec » without a
--    delivery in progress) or was cancelled (outbox cancelled: its message stays « envoi ») is no follow-up. The
--    reception task waits (« Accord client attendu ») until the follow-up ends, the closing at the latest (the closing
--    while the delivery is still to come). Then, still before the closing, the relance comes back:
--    refresh_staff_work_actions re-syncs the task because its due date has passed or its stored hint differs. A
--    voluntary client wait is still never relanced and an expired wait still asks to review it first.
-- 2. Hints of a consent still to ask: receptionne « Mesurer puis demander l’accord avant la clôture du départ »,
--    mesure « Demander l’accord avant la clôture du départ » (unchanged).
-- 3. The closing of the consent: the assigned departure's while it is open (not left, not archived); without one, the
--    open departure planned on the desired day (_departure_for_day: its loading closing, else the Wednesday 17 h), else
--    the Wednesday 17 h of that day when no departure of the destination is planned that day. A departure that has left
--    or is closed gives no closing: no relance hint, no due date before a closing that cannot be met; the dossier's
--    « Choisir un autre départ » drives the action.
-- 4. notification_outbox(message_id) is indexed: the follow-up reads the delivery rows of one message.
-- Writing a staff request or relance, then its outbox row, and every change of its delivery state (to deliver,
-- delivered, draft, failed or cancelled) re-sync the dossier's tasks at once.
-- No business row is rewritten: two private functions, three replaced functions, four triggers and one index. Open
-- reception tasks take the new rules at their next synchronisation or refresh (the stored hint differs from the
-- computed one, or their due date has passed).

-- The follow-up of the dossier's latest staff request or relance: the instant it ends; 'infinity' while its delivery is
-- still to come (a delivery in progress decides, even over the « echec » left by an earlier attempt); NULL once ended,
-- when its delivery failed or was cancelled, or without request.
CREATE FUNCTION _consent_followup_until(c colis) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT f.until FROM (
  SELECT CASE WHEN bool_or(o.status IN ('failed','cancelled')) THEN NULL
    WHEN bool_or(o.status IN ('pending','blocked','sending')) THEN 'infinity'::timestamptz
    WHEN latest.statut='echec' THEN NULL
    ELSE coalesce(max(o.sent_at) FILTER (WHERE o.status='sent'),latest.created_at)+interval '24 hours' END AS until
  FROM (SELECT m.id,m.created_at,m.statut FROM messages m WHERE m.colis_id=c.id AND m.type='staff' AND m.template IN ('demande_feu_vert','relance_feu_vert')
   ORDER BY m.created_at DESC,m.id DESC LIMIT 1) latest
  LEFT JOIN notification_outbox o ON o.message_id=latest.id
  GROUP BY latest.id,latest.created_at,latest.statut) f
 WHERE f.until>now()
$$;

-- Closing of the dossier's departure (copy of 2026-10-06) plus: an assigned departure that has left or is no longer
-- open gives none; without a departure, the open departure planned on the desired day closes it (its loading
-- closing, else the Wednesday rule); otherwise the Wednesday rule of that day, unless a departure of the destination
-- planned that day is closed or has left (create_departure_for_colis refuses that day).
CREATE OR REPLACE FUNCTION _colis_departure_closing(c colis) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN c.envoi_id IS NOT NULL THEN (SELECT coalesce(e.loading_closes_at,departure_default_closing(e.date_depart)) FROM envois e WHERE e.id=c.envoi_id
   AND e.statut IN ('planifie','prochain','en_cours','en_preparation','pret') AND e.departed_at IS NULL)
  ELSE coalesce((SELECT coalesce(e.loading_closes_at,departure_default_closing(e.date_depart)) FROM envois e WHERE e.id=_departure_for_day(c,c.depart_souhaite)),
   CASE WHEN NOT EXISTS(SELECT 1 FROM envois e WHERE e.date_depart=c.depart_souhaite AND e.destination_code=_colis_destination(c) AND e.statut<>'archive')
    THEN departure_default_closing(c.depart_souhaite) END) END
$$;

-- Reception task hint (copy of 2026-10-06): an expired client wait first, then the consent still missing inside the
-- relance window (never during a voluntary client wait, nor while the latest request or relance is followed up).
-- Plain labels, never formatted dates.
CREATE OR REPLACE FUNCTION _reception_work_hint(c colis) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN c.statut='attente_feu_vert' AND c.attente_client_until<=now() THEN 'Réexaminer l’attente client'
  WHEN coalesce(c.archive,false) OR NOT _consent_relance_open(_colis_departure_closing(c)) THEN NULL
  WHEN c.statut='attente_feu_vert' AND c.attente_client_date IS NULL AND _consent_followup_until(c) IS NULL THEN 'Relancer le client avant la clôture du départ'
  WHEN c.statut='receptionne' THEN 'Mesurer puis demander l’accord avant la clôture du départ'
  WHEN c.statut='mesure' THEN 'Demander l’accord avant la clôture du départ' END
$$;

-- Task projection (copy of 2026-10-06) plus the follow-up of an awaited consent: while the latest request or relance
-- is followed up, the reception task waits, due when the follow-up ends (the closing at the latest, and the closing
-- while its delivery is still to come); outside the relance window it is due when the window opens, or when the
-- follow-up ends if that is later.
CREATE OR REPLACE FUNCTION sync_staff_work_actions(p_colis_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; open_case boolean; final_ready boolean; docs_ready boolean; documents_present boolean; has_contact boolean; is_pro boolean; d timestamptz;
 late quote_withdrawals; late_state text; message_attention boolean; late_priority text:='Facture reçue après l’envoi du devis';
 closing timestamptz; relance_open boolean; reception_due timestamptz; reception_hint text; followup timestamptz;
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
 closing:=_colis_departure_closing(c);
 relance_open:=_consent_relance_open(closing);
 followup:=CASE WHEN c.statut='attente_feu_vert' AND c.attente_client_date IS NULL THEN _consent_followup_until(c) END;
 reception_due:=coalesce(c.attente_client_until,d);
 IF c.statut='attente_feu_vert' AND c.attente_client_date IS NULL AND closing>now() THEN
  reception_due:=least(reception_due,CASE WHEN relance_open AND followup IS NULL THEN closing ELSE least(greatest(closing-interval '48 hours',followup),closing) END);
 ELSIF c.statut IN ('receptionne','mesure') AND relance_open THEN
  reception_due:=least(reception_due,closing);
 END IF;
 reception_hint:=_reception_work_hint(c);
 PERFORM _sync_staff_work_action(c.id,'reception',open_case AND c.statut IN ('receptionne','mesure','attente_feu_vert'),CASE WHEN c.statut='attente_feu_vert' AND (c.attente_client_until IS NULL OR c.attente_client_until>now()) AND NOT (c.attente_client_date IS NULL AND relance_open AND followup IS NULL) THEN CASE WHEN c.attente_client_date IS NOT NULL THEN 'Attente volontaire du client' ELSE 'Accord client attendu' END END,reception_due);
 UPDATE staff_work_actions SET action_hint=reception_hint WHERE colis_id=c.id AND kind='reception' AND action_hint IS DISTINCT FROM reception_hint;
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

-- Re-syncs the dossier's tasks when a staff request or relance is written (its message, then its outbox row) and when
-- its delivery state changes (moves between pending, blocked and sending change nothing and do not fire).
-- Lock order of the commands: the dossier, then its messages, outbox rows and tasks.
-- * INSERT: the writing command (queue_message) already holds the dossier; the lock is taken like every command takes it.
-- * UPDATE: the statement already holds the outbox or message row (send-telegram's retry, dispatchOutbox, the stale-send
--   sweep of relances-auto, cancel_previous_consent_requests). Waiting for the dossier here would reverse that order and
--   deadlock with a command changing the cartons, so the dossier is taken only if it is free (SKIP LOCKED; NO KEY UPDATE,
--   so that inserting a message or an invoice of the dossier never waits for it). When it is held, the transaction
--   holding it synchronises it, and refresh_staff_work_actions (the team's work list) brings back a relance whose hint
--   changed. Any failure of this re-sync (a lock conflict with a refresh, for example) is only reported as a warning:
--   the delivery state is always recorded, and one dossier never fails a multi-row update.
CREATE FUNCTION trigger_sync_consent_followup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='notification_outbox' THEN
  IF NOT EXISTS(SELECT 1 FROM messages WHERE id=NEW.message_id AND type='staff' AND template IN ('demande_feu_vert','relance_feu_vert')) THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM colis WHERE id=NEW.colis_id FOR UPDATE;
  PERFORM sync_staff_work_actions(NEW.colis_id);
  RETURN NEW;
 END IF;
 BEGIN
  PERFORM 1 FROM colis WHERE id=NEW.colis_id FOR NO KEY UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM sync_staff_work_actions(NEW.colis_id);
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Tâches du dossier % non resynchronisées après un changement de livraison (%) : %',NEW.colis_id,SQLSTATE,SQLERRM;
 END;
 RETURN NEW;
END; $$;
CREATE TRIGGER z_sync_consent_request_work AFTER INSERT ON messages FOR EACH ROW
 WHEN (NEW.type='staff' AND NEW.template IN ('demande_feu_vert','relance_feu_vert')) EXECUTE FUNCTION trigger_sync_consent_followup();
CREATE TRIGGER z_sync_consent_request_failure AFTER UPDATE OF statut ON messages FOR EACH ROW
 WHEN (NEW.type='staff' AND NEW.template IN ('demande_feu_vert','relance_feu_vert') AND OLD.statut IS DISTINCT FROM NEW.statut AND (OLD.statut='echec' OR NEW.statut='echec'))
 EXECUTE FUNCTION trigger_sync_consent_followup();
-- The outbox row is written after its message: a delivery to come replaces the 24 hours counted from the message (an
-- e-mail draft keeps them).
CREATE TRIGGER z_sync_consent_delivery_queued AFTER INSERT ON notification_outbox FOR EACH ROW
 WHEN (NEW.status<>'manual') EXECUTE FUNCTION trigger_sync_consent_followup();
CREATE TRIGGER z_sync_consent_delivery_work AFTER UPDATE OF status ON notification_outbox FOR EACH ROW
 WHEN (OLD.status IS DISTINCT FROM NEW.status AND NOT (OLD.status IN ('pending','blocked','sending') AND NEW.status IN ('pending','blocked','sending')))
 EXECUTE FUNCTION trigger_sync_consent_followup();

-- The follow-up reads the delivery rows of one message (also send-telegram's lookup by message).
CREATE INDEX IF NOT EXISTS notification_outbox_message_id ON notification_outbox(message_id);

REVOKE ALL ON FUNCTION _consent_followup_until(colis),trigger_sync_consent_followup() FROM PUBLIC,anon,authenticated,service_role;
