-- Reading is an acknowledgement of visibility, never evidence of resolution.
-- NULL used to be presented as "not archived" by the UI but excluded by the
-- actual API filter. Normalize this historical ambiguity before creating work.
UPDATE colis SET archive=false WHERE archive IS NULL;
ALTER TABLE colis ALTER COLUMN archive SET DEFAULT false, ALTER COLUMN archive SET NOT NULL;
ALTER TABLE colis
 ADD COLUMN conversation_statut text NOT NULL DEFAULT 'termine' CHECK(conversation_statut IN ('a_traiter','attente_client','termine')),
 ADD COLUMN conversation_version integer NOT NULL DEFAULT 0,
 ADD COLUMN conversation_updated_at timestamptz,
 ADD COLUMN conversation_opened_at timestamptz,
 ADD COLUMN conversation_resolved_at timestamptz,
 ADD COLUMN statut_updated_at timestamptz;

-- A historical read flag does not prove that a reply was handled. Mark only
-- conversations whose last customer message has no later delivered staff reply.
UPDATE colis c SET conversation_statut='a_traiter',conversation_version=1,
 conversation_updated_at=m.last_client,conversation_opened_at=m.last_client
FROM (SELECT colis_id,max(created_at) last_client,min(created_at) first_client FROM messages WHERE type='client' GROUP BY colis_id) m
WHERE c.id=m.colis_id AND NOT coalesce(c.archive,false) AND NOT EXISTS(SELECT 1 FROM messages s WHERE s.colis_id=c.id AND s.type='staff' AND s.statut IN ('envoye','distribue','lu') AND s.created_at>m.last_client);
UPDATE colis c SET statut_updated_at=l.changed_at FROM
 (SELECT colis_id,nouveau_statut,max(created_at) changed_at FROM logs_statut GROUP BY colis_id,nouveau_statut) l
 WHERE l.colis_id=c.id AND l.nouveau_statut=c.statut;
CREATE INDEX colis_conversation_work ON colis(conversation_statut,conversation_opened_at) WHERE conversation_statut='a_traiter';

ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_status_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_status_check CHECK(status IN ('pending','sending','sent','failed','manual','cancelled','blocked'));

CREATE FUNCTION client_has_open_conversation(p_client_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM colis WHERE client_id=p_client_id AND NOT coalesce(archive,false) AND conversation_statut='a_traiter')
 OR EXISTS(SELECT 1 FROM client_inbox WHERE client_id=p_client_id AND status='unassigned');
$$;
REVOKE ALL ON FUNCTION client_has_open_conversation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION client_has_open_conversation(uuid) TO service_role;

CREATE FUNCTION guard_operational_state() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.statut_updated_at:=clock_timestamp();
  IF current_user NOT IN ('postgres','supabase_admin') AND auth.role()<>'service_role' THEN
   NEW.conversation_statut:='termine';NEW.conversation_version:=0;
   NEW.conversation_updated_at:=NULL;NEW.conversation_opened_at:=NULL;NEW.conversation_resolved_at:=NULL;
  END IF;
 ELSE
  IF NEW.archive AND NOT coalesce(OLD.archive,false) AND NEW.conversation_statut='a_traiter' THEN RAISE EXCEPTION 'Traitez la conversation avant d’archiver ce dossier'; END IF;
  IF current_user NOT IN ('postgres','supabase_admin') AND auth.role()<>'service_role' AND
   (NEW.conversation_statut,NEW.conversation_version,NEW.conversation_updated_at,NEW.conversation_opened_at,NEW.conversation_resolved_at,NEW.statut_updated_at)
   IS DISTINCT FROM (OLD.conversation_statut,OLD.conversation_version,OLD.conversation_updated_at,OLD.conversation_opened_at,OLD.conversation_resolved_at,OLD.statut_updated_at)
   THEN RAISE EXCEPTION 'Utilisez la commande de traitement de conversation'; END IF;
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN NEW.statut_updated_at:=clock_timestamp(); END IF;
 END IF;
 IF NEW.responsible_staff_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.responsible_staff_id IS DISTINCT FROM OLD.responsible_staff_id) AND NOT EXISTS(
  SELECT 1 FROM profiles p JOIN staff_users s ON s.auth_id=p.id WHERE p.id=NEW.responsible_staff_id AND p.actif AND p.role<>'client' AND s.actif
 ) THEN RAISE EXCEPTION 'Le responsable doit être un membre actif de l’équipe'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_operational_state BEFORE INSERT OR UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION guard_operational_state();

CREATE FUNCTION guard_message_workflow() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin') AND auth.role()<>'service_role' THEN
  IF NEW.template LIKE 'client_decision_%' AND (TG_OP='INSERT' OR NEW.template IS DISTINCT FROM OLD.template) THEN RAISE EXCEPTION 'Décision structurée réservée à la commande client'; END IF;
  IF TG_OP='UPDATE' AND NEW.colis_id IS DISTINCT FROM OLD.colis_id THEN RAISE EXCEPTION 'Le dossier du message est immuable'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_message_workflow BEFORE INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION guard_message_workflow();

CREATE FUNCTION reopen_customer_conversation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE customer uuid; was_archived boolean;
BEGIN
 IF NEW.type<>'client' OR NEW.template IN ('client_decision_approve','client_decision_wait') THEN RETURN NEW; END IF;
 SELECT client_id,archive INTO customer,was_archived FROM colis WHERE id=NEW.colis_id FOR UPDATE;
 UPDATE colis SET archive=false,conversation_statut='a_traiter',conversation_version=conversation_version+1,
  conversation_updated_at=clock_timestamp(),conversation_opened_at=CASE WHEN conversation_statut='a_traiter' THEN coalesce(conversation_opened_at,clock_timestamp()) ELSE clock_timestamp() END,
  conversation_resolved_at=NULL WHERE id=NEW.colis_id RETURNING client_id INTO customer;
 IF was_archived THEN
  INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail) VALUES(NEW.colis_id,auth.uid(),NEW.auteur_nom,'conversation_reopen_archive','Nouveau message client : dossier réactivé pour une réponse visible');
 END IF;
 UPDATE notification_outbox SET status='blocked',last_error='Conversation client à traiter avant toute relance'
  WHERE client_id=customer AND status='pending' AND message_id IN(SELECT id FROM messages WHERE template IN ('relance_feu_vert','relance_paiement'));
 RETURN NEW;
END; $$;
CREATE TRIGGER reopen_customer_conversation AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION reopen_customer_conversation();

CREATE FUNCTION customer_document_received() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- The portal customer actor is proven by Auth and parcel ownership. OCR,
 -- staff uploads and Telegram's service upload cannot accidentally take this path.
 IF auth.role()='authenticated' AND NOT is_staff() AND owns_colis(NEW.colis_id) AND coalesce(trim(NEW.fichier_url),'')<>'' THEN
  INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,canal,template)
   VALUES(NEW.colis_id,'client',auth.uid(),coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),'Client'),
    'Document reçu : '||coalesce(nullif(NEW.fichier_nom,''),nullif(NEW.vendeur,''),'facture d’achat'),'portal','client_document');
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER customer_document_received AFTER INSERT ON factures FOR EACH ROW EXECUTE FUNCTION customer_document_received();

CREATE FUNCTION guard_reminder_queue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status='pending' AND EXISTS(SELECT 1 FROM messages WHERE id=NEW.message_id AND template IN ('relance_feu_vert','relance_paiement'))
  AND client_has_open_conversation(NEW.client_id) THEN
  NEW.status:='blocked';NEW.last_error:='Conversation client à traiter avant toute relance';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_reminder_queue BEFORE INSERT OR UPDATE OF status ON notification_outbox FOR EACH ROW EXECUTE FUNCTION guard_reminder_queue();
UPDATE notification_outbox o SET status='blocked',last_error='Conversation client à traiter avant toute relance'
 WHERE o.status='pending' AND client_has_open_conversation(o.client_id) AND EXISTS(SELECT 1 FROM messages m WHERE m.id=o.message_id AND m.template IN ('relance_feu_vert','relance_paiement'));

CREATE FUNCTION set_conversation_state(p_colis_id uuid,p_state text,p_expected_version integer) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; previous text;
BEGIN
 IF NOT (has_permission('perm_comm_message_libre') OR has_permission('perm_comm_telegram') OR has_permission('perm_comm_email')) THEN RAISE EXCEPTION 'Permission de traitement des échanges requise'; END IF;
 IF p_state IS NULL OR p_state NOT IN ('a_traiter','attente_client','termine') THEN RAISE EXCEPTION 'État de traitement invalide'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<>c.conversation_version THEN RAISE EXCEPTION 'Un nouveau message ou une modification est arrivé. Rechargez la conversation.'; END IF;
 IF c.conversation_statut=p_state THEN RETURN c; END IF;
 IF p_state='a_traiter' AND c.archive THEN RAISE EXCEPTION 'Réactivez ce dossier avant de rouvrir son traitement'; END IF;
 previous:=c.conversation_statut;
 UPDATE colis SET conversation_statut=p_state,conversation_version=conversation_version+1,conversation_updated_at=clock_timestamp(),
  conversation_opened_at=CASE WHEN p_state='a_traiter' THEN coalesce(conversation_opened_at,clock_timestamp()) ELSE conversation_opened_at END,
  conversation_resolved_at=CASE WHEN p_state='termine' THEN clock_timestamp() ELSE NULL END
 WHERE id=c.id RETURNING * INTO c;
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail)
 VALUES(c.id,auth.uid(),(SELECT nom FROM profiles WHERE id=auth.uid()),'conversation_state',previous||' → '||p_state);
 IF p_state='a_traiter' THEN
  UPDATE notification_outbox SET status='blocked',last_error='Conversation client à traiter avant toute relance'
   WHERE client_id=c.client_id AND status='pending' AND message_id IN(SELECT id FROM messages WHERE template IN ('relance_feu_vert','relance_paiement'));
 ELSIF NOT client_has_open_conversation(c.client_id) THEN
  UPDATE notification_outbox SET status='pending',available_at=now(),last_error=NULL WHERE client_id=c.client_id AND status='blocked';
 END IF;
 RETURN c;
END; $$;
REVOKE ALL ON FUNCTION set_conversation_state(uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION set_conversation_state(uuid,text,integer) TO authenticated;

CREATE FUNCTION assign_colis_work(p_colis_id uuid,p_responsible_staff_id uuid,p_next_action text,p_next_action_at timestamptz,p_expected_updated_at timestamptz) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis;
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Accès équipe requis'; END IF;
 IF length(coalesce(p_next_action,''))>250 THEN RAISE EXCEPTION 'L’action est limitée à 250 caractères'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable'; END IF;
 IF p_expected_updated_at IS NULL OR p_expected_updated_at<>c.updated_at THEN RAISE EXCEPTION 'Le suivi a changé. Rechargez le dossier.'; END IF;
 UPDATE colis SET responsible_staff_id=p_responsible_staff_id,next_action=nullif(trim(p_next_action),''),next_action_at=p_next_action_at WHERE id=c.id RETURNING * INTO c;
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail) VALUES(c.id,auth.uid(),(SELECT nom FROM profiles WHERE id=auth.uid()),'work_assignment',coalesce(p_next_action,'Suivi du dossier')||CASE WHEN p_responsible_staff_id IS NULL THEN ' · non attribué' ELSE ' · responsable mis à jour' END);
 RETURN c;
END; $$;
REVOKE ALL ON FUNCTION assign_colis_work(uuid,uuid,text,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION assign_colis_work(uuid,uuid,text,timestamptz,timestamptz) TO authenticated;

-- Preserve all decision/consent checks while identifying already-executed
-- structured choices. They are not free-form questions requiring a staff reply.
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
  SELECT id INTO departure FROM envois WHERE destination_code=dest AND statut IN ('planifie','prochain') AND date_depart>=minimum_depart ORDER BY date_depart,id LIMIT 1;
  UPDATE colis SET statut='autorise',feu_vert='autorise',feu_vert_date=now(),attente_client_motif=NULL,attente_client_date=NULL,attente_client_until=NULL,envoi_id=coalesce(envoi_id,departure),next_action='Préparer le colis',next_action_at=now() WHERE id=c.id RETURNING * INTO c;
 ELSIF p_action='wait' THEN
  UPDATE colis SET attente_client_motif=coalesce(nullif(trim(p_reason),''),'Attend d’autres colis'),attente_client_date=now(),attente_client_until=p_wait_until,next_action='Attente volontaire du client',next_action_at=p_wait_until WHERE id=c.id RETURNING * INTO c;
  UPDATE notification_outbox SET status='cancelled' WHERE colis_id=c.id AND status IN ('pending','blocked') AND message_id IN (SELECT id FROM messages WHERE template='relance_feu_vert');
 ELSE
  UPDATE colis SET statut='refuse_client',feu_vert='refuse',feu_vert_date=now(),attente_client_motif=NULL,attente_client_date=NULL,attente_client_until=NULL,next_action='Contacter le client pour la suite',next_action_at=now() WHERE id=c.id RETURNING * INTO c;
 END IF;
 INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,canal,template) VALUES(c.id,'client',auth.uid(),p_actor,CASE p_action WHEN 'approve' THEN 'Accord de préparation enregistré pour ce dossier et ses cartons actuels.' WHEN 'wait' THEN 'Attente volontaire enregistrée. Les relances sont suspendues.' ELSE 'Préparation refusée. Notre équipe vous recontactera.' END,'portal','client_decision_'||p_action);
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail) VALUES(c.id,auth.uid(),p_actor,'client_decision',p_action);
 SELECT * INTO c FROM colis WHERE id=c.id;
 RETURN c;
END; $$;

CREATE OR REPLACE VIEW client_colis WITH (security_barrier=true) AS
 SELECT id,client_id,ref,statut,desc_contenu,valeur_declaree,trackings,trackings_detail,date_reception,
 dim_l,dim_w,dim_h,poids,nb_colis,dims_par_colis,fin_l,fin_w,fin_h,fin_p,poids_facturable,feu_vert,feu_vert_date,
 attente_client_motif,attente_client_date,attente_client_until,est_min,est_max,devis_brouillon,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_transport END AS devis_transport,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_om END AS devis_om,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_omr END AS devis_omr,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_tva END AS devis_tva,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_total END AS devis_total,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN avant_optim_transport END AS avant_optim_transport,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN avant_optim_total END AS avant_optim_total,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN economie END AS economie,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_snapshot END AS devis_snapshot,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN payplug_payment_url END AS payplug_payment_url,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN frais_divers ELSE '[]'::jsonb END AS frais_divers,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN mode_paiement_pro END AS mode_paiement_pro,
 quote_version,devis_envoye_le,paiement_montant,paiement_date,envoi_id,date_expedition,date_livraison,photo_reception_url,photo_prep,archive,created_at,updated_at,
 statut_updated_at,conversation_statut,conversation_version,conversation_updated_at,conversation_opened_at,conversation_resolved_at,demande_feu_vert_envoyee_at
 FROM colis WHERE client_id=auth_client_id();
