-- Departure at any step (lot 3a, 2026-10-06).
-- The departure of a dossier is chosen, changed or removed at every step until the parcel leaves (statuses before
-- expedie, not annule, not archived). A desired day without a planned departure stays on the dossier
-- (« Départ à créer »); the client approval uses it before the automatic pick and never selects another day silently.
-- A missing departure is created only by an explicit staff command (aérien, closing on the Wednesday 17 h Paris before it).
-- The reception task becomes a relance in the 48 hours before the departure closing while consent is missing.
-- No business row is rewritten: one nullable column, an index, a write guard, commands and the task projection.

ALTER TABLE colis ADD COLUMN depart_souhaite date;
COMMENT ON COLUMN colis.depart_souhaite IS 'Jour de départ souhaité tant qu’aucun départ n’est affecté pour ce jour ; réservé à l’équipe.';
CREATE INDEX colis_depart_souhaite ON colis(depart_souhaite) WHERE depart_souhaite IS NOT NULL;

-- The desired day changes only through the commands below (permission, version and audit), never by a direct write.
CREATE FUNCTION guard_colis_departure_wish() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF current_user IN ('postgres','supabase_admin') OR auth.role()='service_role' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.depart_souhaite IS NOT NULL THEN RAISE EXCEPTION 'Utilisez la commande de départ du dossier' USING ERRCODE='42501'; END IF;
 ELSIF NEW.depart_souhaite IS DISTINCT FROM OLD.depart_souhaite THEN
  RAISE EXCEPTION 'Utilisez la commande de départ du dossier' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_colis_departure_wish BEFORE INSERT OR UPDATE OF depart_souhaite ON colis FOR EACH ROW EXECUTE FUNCTION guard_colis_departure_wish();

-- « Clôture mercredi 17 h »: the last Wednesday strictly before the departure day, at 17:00 Europe/Paris
-- (Thursday: the day before; Friday: two days before; Wednesday: seven days before).
CREATE FUNCTION departure_default_closing(p_date date) RETURNS timestamptz LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT ((p_date-((extract(isodow FROM p_date)::integer+3)%7+1))+time '17:00') AT TIME ZONE 'Europe/Paris'
$$;

-- Destination checked by guard_colis_departure: the quote snapshot once paid, otherwise the client postcode prefix.
CREATE FUNCTION _colis_destination(c colis) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN c.paiement_date IS NOT NULL THEN coalesce(c.devis_snapshot#>>'{inputs,destination,code}',c.devis_snapshot->'destination'->>'code',left(cl.cp,3)) ELSE left(cl.cp,3) END
 FROM clients cl WHERE cl.id=c.client_id
$$;
-- The departure of that day the dossier can join (the current one first), NULL when there is none. Same destination
-- and same validity as guard_colis_departure (open status, not departed, from today in Paris, loading closing absent
-- or ahead), so writing it can never make the guard raise.
CREATE FUNCTION _departure_for_day(c colis,p_date date) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT e.id FROM envois e WHERE e.date_depart=p_date AND e.destination_code=_colis_destination(c)
  AND e.statut IN ('planifie','prochain','en_cours','en_preparation','pret') AND e.date_depart>=(now() AT TIME ZONE 'Europe/Paris')::date
  AND e.departed_at IS NULL AND (e.loading_closes_at IS NULL OR e.loading_closes_at>now())
 ORDER BY e.id IS DISTINCT FROM c.envoi_id,e.id LIMIT 1
$$;
-- Closing of the dossier's departure: the assigned one (loading closing, else the Wednesday rule), else the desired day.
CREATE FUNCTION _colis_departure_closing(c colis) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN c.envoi_id IS NOT NULL THEN (SELECT coalesce(e.loading_closes_at,departure_default_closing(e.date_depart)) FROM envois e WHERE e.id=c.envoi_id)
  ELSE departure_default_closing(c.depart_souhaite) END
$$;
-- Relance window: the 48 hours before a closing that has not passed.
CREATE FUNCTION _consent_relance_open(p_closing timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(now()<p_closing AND p_closing-interval '48 hours'<=now(),false)
$$;
-- Reception task hint: an expired client wait first, then the consent still missing inside the relance window
-- (never during a voluntary client wait). Plain labels, never formatted dates.
CREATE FUNCTION _reception_work_hint(c colis) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN c.statut='attente_feu_vert' AND c.attente_client_until<=now() THEN 'Réexaminer l’attente client'
  WHEN coalesce(c.archive,false) OR NOT _consent_relance_open(_colis_departure_closing(c)) THEN NULL
  WHEN c.statut='attente_feu_vert' AND c.attente_client_date IS NULL THEN 'Relancer le client avant la clôture du départ'
  WHEN c.statut IN ('receptionne','mesure') THEN 'Demander l’accord avant la clôture du départ' END
$$;

-- Staff assignment (copy of 2026-09-12) plus: an assigned departure replaces the desired day.
CREATE OR REPLACE FUNCTION assign_colis_departure(p_colis_id uuid,p_envoi_id uuid,p_expected_updated_at timestamptz) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; old_envoi uuid;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable' USING ERRCODE='P0002'; END IF;
 IF NOT has_permission(CASE WHEN c.envoi_id IS NULL THEN 'perm_colis_affecter_envoi' ELSE 'perm_envois_reaffecter' END) THEN RAISE EXCEPTION 'Permission d’affectation ou de réaffectation requise' USING ERRCODE='42501'; END IF;
 IF p_expected_updated_at IS NULL OR p_expected_updated_at<>c.updated_at THEN RAISE EXCEPTION 'Le dossier a changé. Rechargez-le.' USING ERRCODE='40001'; END IF;
 IF c.statut IN ('expedie','transit','dedouanement','arrive','livraison','livre','annule') OR c.archive THEN RAISE EXCEPTION 'Ce dossier ne peut plus être affecté' USING ERRCODE='22023'; END IF;
 old_envoi:=c.envoi_id;
 UPDATE colis SET envoi_id=p_envoi_id,depart_souhaite=CASE WHEN p_envoi_id IS NULL THEN depart_souhaite END WHERE id=c.id RETURNING * INTO c;
 INSERT INTO audit_actions(colis_id,user_id,action,detail) VALUES(c.id,auth.uid(),'departure_assignment',jsonb_build_object('before',old_envoi,'after',p_envoi_id)::text);
 RETURN c;
END; $$;

-- Desired departure day, at any step before the parcel leaves: the valid departure of that day is assigned, otherwise
-- the dossier keeps the day without a departure (« Départ à créer »). A NULL day clears the wish.
CREATE FUNCTION set_colis_departure_wish(p_colis_id uuid,p_date date,p_expected_updated_at timestamptz) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; previous colis; departure uuid;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable' USING ERRCODE='P0002'; END IF;
 IF NOT has_permission(CASE WHEN c.envoi_id IS NULL THEN 'perm_colis_affecter_envoi' ELSE 'perm_envois_reaffecter' END) THEN RAISE EXCEPTION 'Permission d’affectation ou de réaffectation requise' USING ERRCODE='42501'; END IF;
 IF p_expected_updated_at IS NULL OR p_expected_updated_at<>c.updated_at THEN RAISE EXCEPTION 'Le dossier a changé. Actualisez avant de réessayer.' USING ERRCODE='40001'; END IF;
 IF c.statut IN ('expedie','transit','dedouanement','arrive','livraison','livre','annule') OR c.archive THEN RAISE EXCEPTION 'Ce dossier ne peut plus être affecté' USING ERRCODE='22023'; END IF;
 IF p_date<(now() AT TIME ZONE 'Europe/Paris')::date THEN RAISE EXCEPTION 'Choisissez une date à venir.' USING ERRCODE='22023'; END IF;
 previous:=c;
 IF p_date IS NOT NULL THEN departure:=_departure_for_day(c,p_date); END IF;
 UPDATE colis SET envoi_id=CASE WHEN p_date IS NULL THEN envoi_id ELSE departure END,depart_souhaite=CASE WHEN departure IS NULL THEN p_date END
  WHERE id=c.id RETURNING * INTO c;
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,before_data,after_data)
 VALUES(c.id,auth.uid(),coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),(SELECT nom FROM staff_users WHERE auth_id=auth.uid()),'Équipe'),'departure_wish',to_char(p_date,'YYYY-MM-DD'),
  jsonb_build_object('envoi_id',previous.envoi_id,'depart_souhaite',previous.depart_souhaite),jsonb_build_object('envoi_id',c.envoi_id,'depart_souhaite',c.depart_souhaite));
 RETURN c;
END; $$;

-- Explicit creation of the missing departure from the dossier (aérien, Wednesday 17 h Paris closing), or reuse of the
-- departure of that day the dossier can join; the dossier is then assigned to it. A day whose departure is closed or
-- has left is refused, never duplicated. Returns {colis, envoi}.
CREATE FUNCTION create_departure_for_colis(p_colis_id uuid,p_date date,p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; previous colis; e envois; dest text; created boolean:=false;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable' USING ERRCODE='P0002'; END IF;
 IF NOT has_permission('perm_envois_creer') OR NOT has_permission(CASE WHEN c.envoi_id IS NULL THEN 'perm_colis_affecter_envoi' ELSE 'perm_envois_reaffecter' END) THEN
  RAISE EXCEPTION 'Permissions de création du départ et d’affectation requises' USING ERRCODE='42501';
 END IF;
 IF p_expected_updated_at IS NULL OR p_expected_updated_at<>c.updated_at THEN RAISE EXCEPTION 'Le dossier a changé. Actualisez avant de réessayer.' USING ERRCODE='40001'; END IF;
 IF c.statut IN ('expedie','transit','dedouanement','arrive','livraison','livre','annule') OR c.archive THEN RAISE EXCEPTION 'Ce dossier ne peut plus être affecté' USING ERRCODE='22023'; END IF;
 dest:=_colis_destination(c);
 IF NOT EXISTS(SELECT 1 FROM destinations WHERE code=dest) THEN RAISE EXCEPTION 'Destination du client inconnue : complétez son code postal.' USING ERRCODE='22023'; END IF;
 IF p_date IS NULL OR p_date<(now() AT TIME ZONE 'Europe/Paris')::date THEN RAISE EXCEPTION 'Choisissez une date à venir.' USING ERRCODE='22023'; END IF;
 -- One departure per destination and day: a concurrent creation waits here, then reuses it. Only a departure the dossier
 -- can join is reused (the predicate of guard_colis_departure). Lock order: dossier, then departure.
 PERFORM pg_advisory_xact_lock(hashtext('departure:'||dest||':'||to_char(p_date,'YYYY-MM-DD')));
 SELECT * INTO e FROM envois WHERE destination_code=dest AND date_depart=p_date
  AND statut IN ('planifie','prochain','en_cours','en_preparation','pret') AND date_depart>=(now() AT TIME ZONE 'Europe/Paris')::date
  AND departed_at IS NULL AND (loading_closes_at IS NULL OR loading_closes_at>now())
  ORDER BY id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM envois WHERE destination_code=dest AND date_depart=p_date AND statut<>'archive') THEN
   RAISE EXCEPTION 'Le départ de ce jour est clôturé : choisissez un autre jour.' USING ERRCODE='22023';
  END IF;
  -- A new departure closes on the Wednesday 17 h Paris before it: that closing must still be ahead.
  IF departure_default_closing(p_date)<=now() THEN RAISE EXCEPTION 'La clôture de ce départ est déjà passée.' USING ERRCODE='22023'; END IF;
  INSERT INTO envois(date_depart,destination_code,statut,mode_transport,loading_closes_at,cree_par)
  VALUES(p_date,dest,'planifie','aerien',departure_default_closing(p_date),auth.uid()) RETURNING * INTO e;
  created:=true;
 END IF;
 previous:=c;
 UPDATE colis SET envoi_id=e.id,depart_souhaite=NULL WHERE id=c.id RETURNING * INTO c;
 SELECT * INTO e FROM envois WHERE id=e.id;
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,before_data,after_data)
 VALUES(c.id,auth.uid(),coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),(SELECT nom FROM staff_users WHERE auth_id=auth.uid()),'Équipe'),'departure_create',
  jsonb_build_object('envoi_id',e.id,'ref',e.ref,'created',created,'date',to_char(p_date,'YYYY-MM-DD'),'destination',dest)::text,
  jsonb_build_object('envoi_id',previous.envoi_id,'depart_souhaite',previous.depart_souhaite),jsonb_build_object('envoi_id',c.envoi_id,'depart_souhaite',c.depart_souhaite));
 RETURN jsonb_build_object('colis',to_jsonb(c),'envoi',to_jsonb(e));
END; $$;

-- Client decision (copy of 2026-09-12); only the approval's departure changes. Precedence: a still valid assigned
-- departure, else the valid departure of the desired day, else the desired day stays unassigned, else the automatic pick.
-- Only validated departures are written, so guard_colis_departure cannot make a consent fail.
CREATE OR REPLACE FUNCTION _apply_client_decision(p_colis_id uuid,p_action text,p_expected_updated_at timestamptz,p_wait_until timestamptz,p_reason text,p_actor text) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; dest text; departure uuid; paris timestamp:=now() AT TIME ZONE 'Europe/Paris'; minimum_depart date;
BEGIN
 IF p_action NOT IN ('approve','wait','refuse') THEN RAISE EXCEPTION 'Décision invalide'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.statut<>'attente_feu_vert' THEN RAISE EXCEPTION 'Cette demande ne peut plus être modifiée'; END IF;
 IF p_expected_updated_at IS NOT NULL AND c.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'Le dossier a changé. Rechargez avant de confirmer.'; END IF;
 IF p_wait_until IS NOT NULL AND p_wait_until<=now() THEN RAISE EXCEPTION 'La date de reprise doit être future'; END IF;
 IF p_action='approve' THEN
  SELECT left(cp,3) INTO dest FROM clients WHERE id=c.client_id;
  minimum_depart:=date_trunc('week',paris)::date+4;
  IF extract(isodow FROM paris)>3 OR (extract(isodow FROM paris)=3 AND paris::time>=time '17:00') THEN minimum_depart:=minimum_depart+7; END IF;
  IF valid_departure_for_colis(c.envoi_id,c.client_id) THEN departure:=c.envoi_id;
  ELSIF c.depart_souhaite IS NOT NULL THEN departure:=_departure_for_day(c,c.depart_souhaite);
  ELSE SELECT id INTO departure FROM envois WHERE destination_code=dest AND statut IN ('planifie','prochain') AND date_depart>=minimum_depart AND (loading_closes_at IS NULL OR loading_closes_at>now()) ORDER BY date_depart,id LIMIT 1;
  END IF;
  UPDATE colis SET statut='autorise',feu_vert='autorise',feu_vert_date=now(),attente_client_motif=NULL,attente_client_date=NULL,attente_client_until=NULL,envoi_id=departure,depart_souhaite=CASE WHEN departure IS NULL THEN depart_souhaite END,next_action_source='system',next_action='Préparer le colis',next_action_at=NULL WHERE id=c.id RETURNING * INTO c;
 ELSIF p_action='wait' THEN
  UPDATE colis SET attente_client_motif=coalesce(nullif(trim(p_reason),''),'Attend d’autres colis'),attente_client_date=now(),attente_client_until=p_wait_until,next_action_source='system',next_action='Attente volontaire du client',next_action_at=p_wait_until WHERE id=c.id RETURNING * INTO c;
  UPDATE notification_outbox SET status='cancelled' WHERE colis_id=c.id AND status IN ('pending','blocked') AND message_id IN (SELECT id FROM messages WHERE template='relance_feu_vert');
 ELSE
  UPDATE colis SET statut='refuse_client',feu_vert='refuse',feu_vert_date=now(),attente_client_motif=NULL,attente_client_date=NULL,attente_client_until=NULL,next_action_source='system',next_action='Contacter le client pour la suite',next_action_at=NULL WHERE id=c.id RETURNING * INTO c;
 END IF;
 INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,canal,template) VALUES(c.id,'client',auth.uid(),p_actor,CASE p_action WHEN 'approve' THEN 'Accord de préparation enregistré pour ce dossier et ses cartons actuels.' WHEN 'wait' THEN 'Attente volontaire enregistrée. Les relances sont suspendues.' ELSE 'Préparation refusée. Notre équipe vous recontactera.' END,'portal','client_decision_'||p_action);
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail) VALUES(c.id,auth.uid(),p_actor,'client_decision',p_action);
 SELECT * INTO c FROM colis WHERE id=c.id;
 RETURN c;
END; $$;

-- Task projection (copy of 2026-10-04) plus the departure closing on the reception action: inside the 48 hours before
-- the closing, consent without a voluntary client wait is a relance due at the closing; outside, an awaited consent
-- stays blocked and is due when the window opens. Hints are merged into the single reception hint update.
CREATE OR REPLACE FUNCTION sync_staff_work_actions(p_colis_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; open_case boolean; final_ready boolean; docs_ready boolean; documents_present boolean; has_contact boolean; is_pro boolean; d timestamptz;
 late quote_withdrawals; late_state text; message_attention boolean; late_priority text:='Facture reçue après l’envoi du devis';
 closing timestamptz; relance_open boolean; reception_due timestamptz; reception_hint text;
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
 reception_due:=coalesce(c.attente_client_until,d);
 IF c.statut='attente_feu_vert' AND c.attente_client_date IS NULL AND closing>now() THEN
  reception_due:=least(reception_due,CASE WHEN relance_open THEN closing ELSE closing-interval '48 hours' END);
 ELSIF c.statut IN ('receptionne','mesure') AND relance_open THEN
  reception_due:=least(reception_due,closing);
 END IF;
 reception_hint:=_reception_work_hint(c);
 PERFORM _sync_staff_work_action(c.id,'reception',open_case AND c.statut IN ('receptionne','mesure','attente_feu_vert'),CASE WHEN c.statut='attente_feu_vert' AND (c.attente_client_until IS NULL OR c.attente_client_until>now()) AND NOT (c.attente_client_date IS NULL AND relance_open) THEN CASE WHEN c.attente_client_date IS NOT NULL THEN 'Attente volontaire du client' ELSE 'Accord client attendu' END END,reception_due);
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

-- Time-based refresh (copy of 2026-09-12) plus the reception actions whose hint changed with time (relance window
-- opened or closed): the stored hint differs from the computed one. A recomputed row matches, so nothing loops.
CREATE OR REPLACE FUNCTION refresh_staff_work_actions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid;
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Accès équipe requis' USING ERRCODE='42501'; END IF;
 FOR target IN SELECT colis_id FROM staff_work_actions WHERE state='waiting' AND (review_at<=now() OR (kind='reception' AND due_at<=now()))
  UNION SELECT w.colis_id FROM staff_work_actions w JOIN colis c ON c.id=w.colis_id WHERE w.kind='reception' AND w.state<>'done' AND w.action_hint IS DISTINCT FROM _reception_work_hint(c)
 LOOP PERFORM sync_staff_work_actions(target); END LOOP;
END; $$;

REVOKE ALL ON FUNCTION departure_default_closing(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION departure_default_closing(date) TO authenticated;
REVOKE ALL ON FUNCTION set_colis_departure_wish(uuid,date,timestamptz),create_departure_for_colis(uuid,date,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION set_colis_departure_wish(uuid,date,timestamptz),create_departure_for_colis(uuid,date,timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION _colis_destination(colis),_departure_for_day(colis,date),_colis_departure_closing(colis),_consent_relance_open(timestamptz),
 _reception_work_hint(colis),guard_colis_departure_wish() FROM PUBLIC,anon,authenticated,service_role;
