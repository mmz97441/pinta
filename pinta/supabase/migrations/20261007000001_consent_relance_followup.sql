-- Consent relance follow-up (final review of lot 3a, 2026-10-07).
-- 1. A consent request or relance (messages.template demande_feu_vert or relance_feu_vert) is followed up for 24 hours:
--    while the latest one is less than 24 hours old and its delivery has neither failed nor been cancelled, an awaited
--    consent is not relanced; the reception task waits (« Accord client attendu ») until the 24 hours end, the closing at
--    the latest. Then, still before the closing, the relance comes back: refresh_staff_work_actions re-syncs the task
--    because its due date has passed and its stored hint differs. A voluntary client wait is still never relanced and
--    an expired wait still asks to review it first.
-- 2. Hints of a consent still to ask: receptionne « Mesurer puis demander l’accord avant la clôture du départ »,
--    mesure « Demander l’accord avant la clôture du départ » (unchanged).
-- 3. A dossier without departure whose desired day has an open planned departure (_departure_for_day) uses that
--    departure's closing (its loading closing, else the Wednesday 17 h) for the relance window.
-- Creating a request or relance, or a delivery failing or being cancelled, re-syncs the dossier's tasks at once.
-- No business row is rewritten: two private functions, three replaced functions and three triggers. Open reception
-- tasks take the new rules at their next synchronisation or refresh (the stored hint differs from the computed one).

-- The follow-up of the dossier's latest consent request or relance: the instant its 24 hours end, while it is less than
-- 24 hours old and its delivery has neither failed (message « echec », outbox failed) nor been cancelled (outbox
-- cancelled: its message stays « envoi »). NULL otherwise: no request, an older one, or one that did not reach the client.
CREATE FUNCTION _consent_followup_until(c colis) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT latest.created_at+interval '24 hours' FROM (
  SELECT m.id,m.created_at,m.statut FROM messages m WHERE m.colis_id=c.id AND m.template IN ('demande_feu_vert','relance_feu_vert')
  ORDER BY m.created_at DESC,m.id DESC LIMIT 1) latest
 WHERE latest.created_at+interval '24 hours'>now() AND latest.statut IS DISTINCT FROM 'echec'
  AND NOT EXISTS(SELECT 1 FROM notification_outbox o WHERE o.message_id=latest.id AND o.status IN ('failed','cancelled'))
$$;

-- Closing of the dossier's departure (copy of 2026-10-06) plus: without a departure, the open departure planned on its
-- desired day closes it (its loading closing, else the Wednesday rule); otherwise the Wednesday rule of that day.
CREATE OR REPLACE FUNCTION _colis_departure_closing(c colis) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN c.envoi_id IS NOT NULL THEN (SELECT coalesce(e.loading_closes_at,departure_default_closing(e.date_depart)) FROM envois e WHERE e.id=c.envoi_id)
  ELSE coalesce((SELECT coalesce(e.loading_closes_at,departure_default_closing(e.date_depart)) FROM envois e WHERE e.id=_departure_for_day(c,c.depart_souhaite)),
   departure_default_closing(c.depart_souhaite)) END
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
-- is followed up, the reception task waits, due when the follow-up ends (the closing at the latest); outside the
-- relance window it is due when the window opens, or when the follow-up ends if that is later.
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

-- A request or relance starts its follow-up; a delivery that fails or is cancelled ends it, and a retry restarts it.
-- The dossier's tasks are then re-synced at once, for a consent message only. The dossier row is locked first, the
-- order of every synchronisation (dossier, then its tasks): a command in progress on the dossier, such as a relance
-- being queued, commits before this synchronisation reads it. Only these changes fire: a delivery in progress or
-- confirmed takes no lock.
CREATE FUNCTION trigger_sync_consent_followup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='notification_outbox' THEN
  IF NOT EXISTS(SELECT 1 FROM messages WHERE id=NEW.message_id AND template IN ('demande_feu_vert','relance_feu_vert')) THEN RETURN NEW; END IF;
 END IF;
 PERFORM 1 FROM colis WHERE id=NEW.colis_id FOR UPDATE;
 PERFORM sync_staff_work_actions(NEW.colis_id);
 RETURN NEW;
END; $$;
CREATE TRIGGER z_sync_consent_request_work AFTER INSERT ON messages FOR EACH ROW
 WHEN (NEW.template IN ('demande_feu_vert','relance_feu_vert')) EXECUTE FUNCTION trigger_sync_consent_followup();
CREATE TRIGGER z_sync_consent_request_failure AFTER UPDATE OF statut ON messages FOR EACH ROW
 WHEN (NEW.template IN ('demande_feu_vert','relance_feu_vert') AND OLD.statut IS DISTINCT FROM NEW.statut AND (OLD.statut='echec' OR NEW.statut='echec'))
 EXECUTE FUNCTION trigger_sync_consent_followup();
CREATE TRIGGER z_sync_consent_delivery_work AFTER UPDATE OF status ON notification_outbox FOR EACH ROW
 WHEN (OLD.status IS DISTINCT FROM NEW.status AND (OLD.status IN ('failed','cancelled') OR NEW.status IN ('failed','cancelled')))
 EXECUTE FUNCTION trigger_sync_consent_followup();

REVOKE ALL ON FUNCTION _consent_followup_until(colis),trigger_sync_consent_followup() FROM PUBLIC,anon,authenticated,service_role;
