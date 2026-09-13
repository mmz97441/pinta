-- Commit this legacy UI status before departure commands use it.
ALTER TYPE statut_envoi ADD VALUE IF NOT EXISTS 'archive';
-- One durable action per business stage; dossier reference and referent are unchanged.
CREATE TABLE staff_work_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),colis_id uuid NOT NULL REFERENCES colis(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('reception','preparation','documents','conversation','quote','departure','correction')),
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','in_progress','waiting','done')),
 assignee_id uuid REFERENCES profiles(id),version integer NOT NULL DEFAULT 1,
 due_at timestamptz,due_at_source text NOT NULL DEFAULT 'system' CHECK(due_at_source IN ('system','manual')),action_hint text,blocked_reason text,waiting_reason text,review_at timestamptz,
 handoff_to uuid REFERENCES profiles(id),handoff_note text,
 priority_reason text,priority_until timestamptz,priority_by uuid REFERENCES profiles(id),
 started_at timestamptz,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(colis_id,kind),CHECK(handoff_to IS NULL OR (assignee_id IS NOT NULL AND handoff_to<>assignee_id))
);
CREATE INDEX staff_work_queue ON staff_work_actions(assignee_id,state,due_at) WHERE state<>'done';
CREATE TABLE staff_work_preferences (
 staff_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
 missions text[] NOT NULL DEFAULT '{}',active_mission text,density text NOT NULL DEFAULT 'comfortable' CHECK(density IN ('comfortable','compact')),
 available boolean NOT NULL DEFAULT true,absent_until timestamptz,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(missions<@ARRAY['reception','preparation','communication','documents','departures','coordination']),
 CHECK(active_mission IS NULL OR active_mission=ANY(missions))
);
ALTER TABLE staff_work_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_work_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_work_read ON staff_work_actions FOR SELECT TO authenticated USING(is_staff());
CREATE POLICY staff_preferences_read ON staff_work_preferences FOR SELECT TO authenticated USING(is_staff());
GRANT SELECT ON staff_work_actions,staff_work_preferences TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON staff_work_actions,staff_work_preferences FROM authenticated,anon;

CREATE FUNCTION staff_can_work(p_staff_id uuid,p_kind text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM profiles u JOIN staff_users s ON s.auth_id=u.id LEFT JOIN staff_permissions p ON p.staff_id=s.id
 WHERE u.id=p_staff_id AND u.actif AND s.actif AND u.role<>'client' AND (u.role IN ('directeur','vice_directeur') OR EXISTS(
 SELECT 1 FROM unnest(CASE p_kind
 WHEN 'reception' THEN ARRAY['perm_colis_receptionner','perm_colis_mesurer','perm_colis_demander_feuvert']
 WHEN 'preparation' THEN ARRAY['perm_colis_preparer']
 WHEN 'documents' THEN ARRAY['perm_factures_valider','perm_factures_refuser','perm_factures_ocr','perm_factures_modifier_articles']
 WHEN 'conversation' THEN ARRAY['perm_comm_message_libre','perm_comm_telegram','perm_comm_email','perm_clients_creer']
 WHEN 'quote' THEN ARRAY['perm_colis_calculer_devis','perm_colis_envoyer_devis']
 WHEN 'departure' THEN ARRAY['perm_colis_affecter_envoi','perm_colis_expedier','perm_envois_modifier']
 WHEN 'correction' THEN ARRAY['perm_colis_revenir_arriere','perm_colis_valider_feuvert'] ELSE ARRAY[]::text[] END) k
 WHERE coalesce((to_jsonb(p)->>k)::boolean,false))));
$$;
REVOKE ALL ON FUNCTION staff_can_work(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION staff_can_work(uuid,text) TO authenticated;

CREATE FUNCTION _sync_staff_work_action(p_colis_id uuid,p_kind text,p_needed boolean,p_block text DEFAULT NULL,p_due timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a staff_work_actions; next_state text;
BEGIN
 SELECT * INTO a FROM staff_work_actions WHERE colis_id=p_colis_id AND kind=p_kind FOR UPDATE;
 IF NOT FOUND THEN
  IF p_needed THEN INSERT INTO staff_work_actions(colis_id,kind,state,blocked_reason,due_at) VALUES(p_colis_id,p_kind,CASE WHEN p_block IS NULL THEN 'ready' ELSE 'waiting' END,p_block,p_due); END IF;
  RETURN;
 END IF;
 next_state:=CASE WHEN NOT p_needed THEN 'done' WHEN p_block IS NOT NULL THEN 'waiting'
 WHEN a.waiting_reason IS NOT NULL AND (a.review_at IS NULL OR a.review_at>now()) THEN 'waiting'
 WHEN a.state='in_progress' AND a.assignee_id IS NOT NULL THEN 'in_progress' ELSE 'ready' END;
 IF a.due_at_source='manual' THEN p_due:=a.due_at; END IF;
 IF (a.state,a.blocked_reason,a.due_at) IS DISTINCT FROM (next_state,p_block,p_due) OR a.review_at<=now() THEN
  UPDATE staff_work_actions SET state=next_state,blocked_reason=p_block,due_at=p_due,
   completed_at=CASE WHEN next_state='done' THEN coalesce(completed_at,now()) ELSE NULL END,
   handoff_to=CASE WHEN next_state='done' THEN NULL ELSE handoff_to END,handoff_note=CASE WHEN next_state='done' THEN NULL ELSE handoff_note END,
   waiting_reason=CASE WHEN review_at<=now() OR next_state='done' THEN NULL ELSE waiting_reason END,
   review_at=CASE WHEN review_at<=now() OR next_state='done' THEN NULL ELSE review_at END,version=version+1,updated_at=clock_timestamp()
  WHERE id=a.id;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION _sync_staff_work_action(uuid,text,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sync_staff_work_actions(p_colis_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; open_case boolean; final_ready boolean; docs_ready boolean; documents_present boolean; has_contact boolean; is_pro boolean; d timestamptz;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id;
 IF NOT FOUND THEN RETURN; END IF;
 open_case:=NOT c.archive AND c.statut NOT IN ('livre','annule');
 final_ready:=coalesce(c.fin_l>0 AND c.fin_w>0 AND c.fin_h>0 AND c.fin_p>0,false)
  AND (NOT (to_jsonb(c)?'preparation_composition_version') OR (to_jsonb(c)->>'preparation_composition_version') IS NOT DISTINCT FROM (to_jsonb(c)->>'final_measurements_version'));
 SELECT EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND coalesce(trim(fichier_url),'')<>''),
  EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND valide AND nullif(trim(rejet_motif),'') IS NULL AND coalesce(trim(fichier_url),'')<>'')
  AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND NOT valide AND nullif(trim(rejet_motif),'') IS NULL)
 INTO documents_present,docs_ready;
 SELECT user_id IS NOT NULL OR telegram_chat_id IS NOT NULL,type='pro' INTO has_contact,is_pro FROM clients WHERE id=c.client_id;
 d:=CASE WHEN c.next_action_source='manual' THEN c.next_action_at END;
 PERFORM _sync_staff_work_action(c.id,'reception',open_case AND c.statut IN ('receptionne','mesure','attente_feu_vert'),CASE WHEN c.statut='attente_feu_vert' AND (c.attente_client_until IS NULL OR c.attente_client_until>now()) THEN CASE WHEN c.attente_client_date IS NOT NULL THEN 'Attente volontaire du client' ELSE 'Accord client attendu' END END,coalesce(c.attente_client_until,d));
 UPDATE staff_work_actions SET action_hint=CASE WHEN c.statut='attente_feu_vert' AND c.attente_client_until<=now() THEN 'Réexaminer l’attente client' ELSE NULL END WHERE colis_id=c.id AND kind='reception' AND action_hint IS DISTINCT FROM CASE WHEN c.statut='attente_feu_vert' AND c.attente_client_until<=now() THEN 'Réexaminer l’attente client' ELSE NULL END;
 PERFORM _sync_staff_work_action(c.id,'preparation',open_case AND c.statut IN ('autorise','en_preparation') AND NOT final_ready,
  CASE WHEN c.produit_interdit THEN 'Contenu à vérifier avant préparation' WHEN c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN 'Accord client requis' END,d);
 PERFORM _sync_staff_work_action(c.id,'documents',open_case AND c.statut IN ('receptionne','mesure','attente_feu_vert','autorise','en_preparation') AND NOT docs_ready,
  CASE WHEN NOT documents_present THEN 'Facture attendue du client' END,d);
 PERFORM _sync_staff_work_action(c.id,'conversation',NOT c.archive AND (c.conversation_statut<>'termine' OR (open_case AND NOT has_contact)),CASE WHEN c.conversation_statut='attente_client' AND has_contact THEN 'Réponse attendue du client' END,d);
 UPDATE staff_work_actions SET action_hint=CASE WHEN NOT has_contact THEN 'Accès client à activer' ELSE NULL END WHERE colis_id=c.id AND kind='conversation' AND action_hint IS DISTINCT FROM CASE WHEN NOT has_contact THEN 'Accès client à activer' ELSE NULL END;
 PERFORM _sync_staff_work_action(c.id,'quote',open_case AND c.statut IN ('autorise','en_preparation') AND c.paiement_date IS NULL,
  CASE WHEN c.produit_interdit THEN 'Contenu à vérifier avant le devis' WHEN c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN 'Accord client requis' WHEN NOT final_ready THEN 'Mesures finales après optimisation requises' WHEN NOT docs_ready AND NOT is_pro THEN 'Documents à valider' END,d);
 PERFORM _sync_staff_work_action(c.id,'departure',open_case AND c.statut='paye',NULL,d);
 PERFORM _sync_staff_work_action(c.id,'correction',open_case AND (c.statut='refuse_client' OR c.produit_interdit OR (c.next_action_source='manual' AND nullif(trim(c.next_action),'') IS NOT NULL)),NULL,d);
END; $$;
REVOKE ALL ON FUNCTION sync_staff_work_actions(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION trigger_sync_staff_work_actions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='colis' THEN PERFORM sync_staff_work_actions(NEW.id);
 ELSE PERFORM sync_staff_work_actions(CASE WHEN TG_OP='DELETE' THEN OLD.colis_id ELSE NEW.colis_id END); END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER z_sync_staff_work AFTER INSERT OR UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION trigger_sync_staff_work_actions();
CREATE TRIGGER z_sync_staff_documents AFTER INSERT OR UPDATE OR DELETE ON factures FOR EACH ROW EXECUTE FUNCTION trigger_sync_staff_work_actions();
SELECT sync_staff_work_actions(id) FROM colis WHERE NOT archive;

CREATE FUNCTION mutate_staff_work_action(p_action_id uuid,p_command text,p_expected_version integer,p_payload jsonb DEFAULT '{}') RETURNS staff_work_actions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a staff_work_actions; before_a staff_work_actions; target uuid; recipient uuid; note text:=nullif(trim(p_payload->>'note'),''); reason text:=nullif(trim(p_payload->>'reason'),'');
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Accès équipe requis' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR length(coalesce(note,''))>500 OR length(coalesce(reason,''))>500 THEN RAISE EXCEPTION 'Consigne ou motif invalide' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM staff_work_actions WHERE id=p_action_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Action introuvable' USING ERRCODE='P0002'; END IF;
 IF p_expected_version IS NULL OR a.version<>p_expected_version THEN RAISE EXCEPTION 'Cette action a changé. Rechargez la file ; votre collègue a peut-être pris le relais.' USING ERRCODE='40001'; END IF;
 IF a.state='done' THEN RAISE EXCEPTION 'Cette action métier est déjà terminée' USING ERRCODE='22023'; END IF;
 IF NOT staff_can_work(auth.uid(),a.kind) AND NOT is_direction() THEN RAISE EXCEPTION 'Permission métier requise pour cette action' USING ERRCODE='42501'; END IF;
 before_a:=a; target:=nullif(p_payload->>'staff_id','')::uuid;
 IF p_command IN ('claim','start') THEN
  IF a.assignee_id IS NOT NULL AND a.assignee_id<>auth.uid() THEN RAISE EXCEPTION 'Cette action est déjà prise en charge' USING ERRCODE='40001'; END IF;
  IF p_command='start' AND a.blocked_reason IS NOT NULL THEN RAISE EXCEPTION '%',a.blocked_reason USING ERRCODE='22023'; END IF;
  a.assignee_id:=auth.uid();
  IF p_command='start' THEN a.state:='in_progress';a.started_at:=coalesce(a.started_at,now());a.waiting_reason:=NULL;a.review_at:=NULL; END IF;
 ELSIF p_command IN ('accept','reject') THEN
  IF a.handoff_to IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Ce relais est destiné à un autre collaborateur' USING ERRCODE='42501'; END IF;
  recipient:=a.assignee_id;
  IF p_command='accept' THEN a.assignee_id:=auth.uid(); END IF;
  a.handoff_to:=NULL;a.handoff_note:=NULL;
 ELSIF p_command='reassign' THEN
  IF NOT is_direction() THEN RAISE EXCEPTION 'Réaffectation réservée à la coordination' USING ERRCODE='42501'; END IF;
  IF reason IS NULL THEN RAISE EXCEPTION 'Expliquez la réaffectation' USING ERRCODE='22023'; END IF;
  IF target IS NOT NULL AND NOT staff_can_work(target,a.kind) THEN RAISE EXCEPTION 'Destinataire inactif ou non habilité' USING ERRCODE='42501'; END IF;
  a.assignee_id:=target;a.handoff_to:=NULL;a.handoff_note:=NULL;recipient:=target;
  IF target IS NULL AND a.state='in_progress' THEN a.state:='ready'; END IF;
 ELSIF p_command='prioritize' THEN
  IF NOT is_direction() THEN RAISE EXCEPTION 'Priorité réservée à la coordination' USING ERRCODE='42501'; END IF;
  IF reason IS NULL OR (p_payload->>'until')::timestamptz IS NULL OR (p_payload->>'until')::timestamptz<=now() THEN RAISE EXCEPTION 'Motif et fin de priorité future requis' USING ERRCODE='22023'; END IF;
  a.priority_reason:=reason;a.priority_until:=(p_payload->>'until')::timestamptz;a.priority_by:=auth.uid();
 ELSE
  IF a.assignee_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Prenez cette action en charge pour la modifier' USING ERRCODE='42501'; END IF;
  CASE p_command
   WHEN 'handoff' THEN
    IF target IS NULL OR target=auth.uid() OR NOT staff_can_work(target,a.kind) THEN RAISE EXCEPTION 'Destinataire actif et habilité requis' USING ERRCODE='42501'; END IF;
    IF note IS NULL THEN RAISE EXCEPTION 'Ajoutez une consigne de relais' USING ERRCODE='22023'; END IF;
    a.handoff_to:=target;a.handoff_note:=note;recipient:=target;
   WHEN 'release' THEN a.assignee_id:=NULL;a.handoff_to:=NULL;a.handoff_note:=NULL;IF a.state='in_progress' THEN a.state:='ready'; END IF;
   WHEN 'wait' THEN
    IF reason IS NULL THEN RAISE EXCEPTION 'Motif d’attente requis' USING ERRCODE='22023'; END IF;
    IF p_payload->>'review_at' IS NOT NULL AND (p_payload->>'review_at')::timestamptz<=now() THEN RAISE EXCEPTION 'Date de réexamen future requise' USING ERRCODE='22023'; END IF;
    a.state:='waiting';a.waiting_reason:=reason;a.review_at:=(p_payload->>'review_at')::timestamptz;
   WHEN 'resume' THEN
    IF a.blocked_reason IS NOT NULL THEN RAISE EXCEPTION '%',a.blocked_reason USING ERRCODE='22023'; END IF;
    a.state:='ready';a.waiting_reason:=NULL;a.review_at:=NULL;
   ELSE RAISE EXCEPTION 'Commande d’action invalide' USING ERRCODE='22023';
  END CASE;
 END IF;
 IF p_payload?'due_at' THEN a.due_at:=(p_payload->>'due_at')::timestamptz;a.due_at_source:='manual'; END IF;
 UPDATE staff_work_actions SET state=a.state,assignee_id=a.assignee_id,due_at=a.due_at,due_at_source=a.due_at_source,waiting_reason=a.waiting_reason,review_at=a.review_at,
  handoff_to=a.handoff_to,handoff_note=a.handoff_note,priority_reason=a.priority_reason,priority_until=a.priority_until,priority_by=a.priority_by,
  started_at=a.started_at,version=version+1,updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail) VALUES(a.colis_id,auth.uid(),(SELECT nom FROM profiles WHERE id=auth.uid()),'work_action_'||p_command,jsonb_build_object('action_id',a.id,'kind',a.kind,'before',to_jsonb(before_a),'after',to_jsonb(a),'reason',reason,'note',note)::text);
 IF p_command='reassign' AND before_a.assignee_id IS NOT NULL AND before_a.assignee_id<>auth.uid() AND before_a.assignee_id IS DISTINCT FROM recipient THEN
  INSERT INTO notifications(user_id,titre,msg,colis_id,type) VALUES(before_a.assignee_id,'Action réaffectée par la coordination',reason,a.colis_id,'work_action');
 END IF;
 IF recipient IS NOT NULL AND recipient<>auth.uid() THEN
  INSERT INTO notifications(user_id,titre,msg,colis_id,type) VALUES(recipient,CASE WHEN p_command='handoff' THEN 'Relais à accepter' ELSE 'Action mise à jour' END,coalesce(note,reason,'Le responsable de cette action a changé.'),a.colis_id,'work_action');
 END IF;
 RETURN a;
END; $$;
REVOKE ALL ON FUNCTION mutate_staff_work_action(uuid,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mutate_staff_work_action(uuid,text,integer,jsonb) TO authenticated;

CREATE FUNCTION save_staff_work_preferences(p_preferences jsonb,p_expected_version integer DEFAULT NULL) RETURNS staff_work_preferences LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p staff_work_preferences; m text[];
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Accès équipe requis' USING ERRCODE='42501'; END IF;
 IF p_preferences IS NULL OR jsonb_typeof(p_preferences)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_preferences) k WHERE k NOT IN ('missions','active_mission','density','available','absent_until')) THEN RAISE EXCEPTION 'Préférences invalides' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO p FROM staff_work_preferences WHERE staff_id=auth.uid() FOR UPDATE;
 IF (FOUND AND (p_expected_version IS NULL OR p.version<>p_expected_version)) OR (NOT FOUND AND p_expected_version IS NOT NULL) THEN RAISE EXCEPTION 'Les préférences ont changé. Rechargez votre vue.' USING ERRCODE='40001'; END IF;
 IF p.staff_id IS NULL THEN INSERT INTO staff_work_preferences(staff_id) VALUES(auth.uid()) RETURNING * INTO p; END IF;
 IF p_preferences?'missions' THEN
  IF jsonb_typeof(p_preferences->'missions')<>'array' THEN RAISE EXCEPTION 'Liste de missions requise' USING ERRCODE='22023'; END IF;
  SELECT coalesce(array_agg(DISTINCT value),'{}') INTO m FROM jsonb_array_elements_text(p_preferences->'missions');p.missions:=m;
 END IF;
 IF p_preferences?'active_mission' THEN p.active_mission:=nullif(p_preferences->>'active_mission',''); END IF;
 IF p_preferences?'density' THEN p.density:=p_preferences->>'density'; END IF;
 IF p_preferences?'available' THEN
  IF jsonb_typeof(p_preferences->'available')<>'boolean' THEN RAISE EXCEPTION 'Disponibilité invalide' USING ERRCODE='22023'; END IF;
  p.available:=(p_preferences->>'available')::boolean;
 END IF;
 IF p_preferences?'absent_until' THEN p.absent_until:=(p_preferences->>'absent_until')::timestamptz; END IF;
 UPDATE staff_work_preferences SET missions=p.missions,active_mission=p.active_mission,density=p.density,available=p.available,absent_until=p.absent_until,version=version+1,updated_at=clock_timestamp() WHERE staff_id=auth.uid() RETURNING * INTO p;
 RETURN p;
END; $$;
REVOKE ALL ON FUNCTION save_staff_work_preferences(jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION save_staff_work_preferences(jsonb,integer) TO authenticated;
CREATE FUNCTION refresh_staff_work_actions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid;
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Accès équipe requis' USING ERRCODE='42501'; END IF;
 FOR target IN SELECT DISTINCT colis_id FROM staff_work_actions WHERE state='waiting' AND (review_at<=now() OR (kind='reception' AND due_at<=now())) LOOP PERFORM sync_staff_work_actions(target); END LOOP;
END; $$;
REVOKE ALL ON FUNCTION refresh_staff_work_actions() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION refresh_staff_work_actions() TO authenticated;
DO $$ DECLARE n text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND NOT puballtables) THEN
  FOREACH n IN ARRAY ARRAY['staff_work_actions','staff_work_preferences'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=n) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',n); END IF;
  END LOOP;
 END IF;
END; $$;

CREATE FUNCTION sync_client_work_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; BEGIN
 IF (NEW.user_id,NEW.telegram_chat_id,NEW.type) IS DISTINCT FROM (OLD.user_id,OLD.telegram_chat_id,OLD.type) THEN
  FOR target IN SELECT id FROM colis WHERE client_id=NEW.id AND NOT archive LOOP PERFORM sync_staff_work_actions(target); END LOOP;
 END IF; RETURN NEW; END; $$;
CREATE TRIGGER z_sync_client_work_access AFTER UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION sync_client_work_access();
