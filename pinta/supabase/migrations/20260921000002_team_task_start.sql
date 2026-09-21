-- Team work: a single explicit command takes and starts executable work.
-- Locks only the task row: colleagues may work on different tasks of one dossier.
-- Taking work changes no dossier, client decision, measurement, payment or notification.
ALTER TABLE staff_work_actions ADD COLUMN accepted_handoff_note text;
COMMENT ON COLUMN staff_work_actions.accepted_handoff_note IS 'Last accepted handoff instruction, restored if a later proposed handoff is rejected.';

CREATE OR REPLACE FUNCTION _sync_staff_work_action(p_colis_id uuid,p_kind text,p_needed boolean,p_block text DEFAULT NULL,p_due timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
   accepted_handoff_note=CASE WHEN next_state='done' THEN NULL ELSE accepted_handoff_note END,
   waiting_reason=CASE WHEN review_at<=now() OR next_state='done' THEN NULL ELSE waiting_reason END,
   review_at=CASE WHEN review_at<=now() OR next_state='done' THEN NULL ELSE review_at END,version=version+1,updated_at=clock_timestamp()
  WHERE id=a.id;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION _sync_staff_work_action(uuid,text,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION mutate_staff_work_action(p_action_id uuid,p_command text,p_expected_version integer,p_payload jsonb DEFAULT '{}') RETURNS staff_work_actions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
 IF p_command IN ('claim','start','take') THEN
  IF a.assignee_id IS NOT NULL AND a.assignee_id<>auth.uid() THEN RAISE EXCEPTION 'Cette action est déjà prise en charge' USING ERRCODE='40001'; END IF;
  -- Taking work is one atomic assignment + start. Waiting (including voluntary
  -- waiting) must first be resolved explicitly; opening a task cannot bypass it.
  IF p_command IN ('start','take') AND (a.blocked_reason IS NOT NULL OR a.waiting_reason IS NOT NULL OR a.state='waiting') THEN
   RAISE EXCEPTION '%',coalesce(a.blocked_reason,a.waiting_reason,'Cette tâche est en attente. Consultez la raison avant de la reprendre.') USING ERRCODE='22023';
  END IF;
  IF p_command='take' AND a.state<>'ready' THEN RAISE EXCEPTION 'Cette tâche a déjà commencé. Ouvrez-la pour continuer.' USING ERRCODE='22023'; END IF;
  IF p_command='take' AND a.assignee_id IS DISTINCT FROM auth.uid() AND EXISTS(
   SELECT 1 FROM staff_work_preferences WHERE staff_id=auth.uid() AND (NOT available OR absent_until>now())
  ) THEN RAISE EXCEPTION 'Vous êtes indiqué comme indisponible. Passez disponible pour prendre une nouvelle tâche.' USING ERRCODE='22023'; END IF;
  a.assignee_id:=auth.uid();
  IF p_command IN ('start','take') THEN a.state:='in_progress';a.started_at:=coalesce(a.started_at,now());a.waiting_reason:=NULL;a.review_at:=NULL; END IF;
 ELSIF p_command IN ('accept','reject') THEN
  IF a.handoff_to IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Ce relais est destiné à un autre collaborateur' USING ERRCODE='42501'; END IF;
  recipient:=a.assignee_id;
  IF p_command='accept' THEN
   IF EXISTS(SELECT 1 FROM staff_work_preferences WHERE staff_id=auth.uid() AND (NOT available OR absent_until>now())) THEN
    RAISE EXCEPTION 'Vous êtes indiqué comme indisponible. Passez disponible pour accepter ce relais.' USING ERRCODE='22023';
   END IF;
   IF p_payload?'start' AND jsonb_typeof(p_payload->'start')<>'boolean' THEN RAISE EXCEPTION 'Reprise de tâche invalide' USING ERRCODE='22023'; END IF;
   IF coalesce((p_payload->>'start')::boolean,false) THEN
    IF a.state NOT IN ('ready','in_progress') OR a.blocked_reason IS NOT NULL OR a.waiting_reason IS NOT NULL THEN
     RAISE EXCEPTION '%',coalesce(a.blocked_reason,a.waiting_reason,'Cette tâche est en attente. Acceptez son suivi sans la commencer.') USING ERRCODE='22023';
    END IF;
    a.state:='in_progress';a.started_at:=coalesce(a.started_at,now());
   END IF;
   a.assignee_id:=auth.uid();a.accepted_handoff_note:=a.handoff_note;
  END IF;
  -- Keep the accepted instruction after opening/refreshing the task. Rejecting
  -- a later handoff restores the previous accepted context, not the rejected note.
  a.handoff_to:=NULL;a.handoff_note:=a.accepted_handoff_note;
 ELSIF p_command='reassign' THEN
  IF NOT is_direction() THEN RAISE EXCEPTION 'Réaffectation réservée à la coordination' USING ERRCODE='42501'; END IF;
  IF reason IS NULL THEN RAISE EXCEPTION 'Expliquez la réaffectation' USING ERRCODE='22023'; END IF;
  IF target IS NOT NULL AND NOT staff_can_work(target,a.kind) THEN RAISE EXCEPTION 'Destinataire inactif ou non habilité' USING ERRCODE='42501'; END IF;
  a.assignee_id:=target;a.handoff_to:=NULL;a.handoff_note:=NULL;a.accepted_handoff_note:=NULL;recipient:=target;
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
    IF EXISTS(SELECT 1 FROM staff_work_preferences WHERE staff_id=target AND (NOT available OR absent_until>now())) THEN
     RAISE EXCEPTION 'Ce collègue est indiqué comme indisponible. Choisissez une personne disponible.' USING ERRCODE='22023';
    END IF;
    IF note IS NULL THEN RAISE EXCEPTION 'Ajoutez une consigne de relais' USING ERRCODE='22023'; END IF;
    a.handoff_to:=target;a.handoff_note:=note;recipient:=target;
   WHEN 'release' THEN a.assignee_id:=NULL;a.handoff_to:=NULL;a.handoff_note:=NULL;a.accepted_handoff_note:=NULL;IF a.state='in_progress' THEN a.state:='ready'; END IF;
   WHEN 'wait' THEN
    IF reason IS NULL THEN RAISE EXCEPTION 'Motif d’attente requis' USING ERRCODE='22023'; END IF;
    IF p_payload->>'review_at' IS NOT NULL AND (p_payload->>'review_at')::timestamptz<=now() THEN RAISE EXCEPTION 'Date de réexamen future requise' USING ERRCODE='22023'; END IF;
    a.state:='waiting';a.waiting_reason:=reason;a.review_at:=(p_payload->>'review_at')::timestamptz;
   WHEN 'resume' THEN
    IF a.blocked_reason IS NOT NULL THEN RAISE EXCEPTION '%',a.blocked_reason USING ERRCODE='22023'; END IF;
    IF p_payload?'start' AND jsonb_typeof(p_payload->'start')<>'boolean' THEN RAISE EXCEPTION 'Reprise de tâche invalide' USING ERRCODE='22023'; END IF;
    IF coalesce((p_payload->>'start')::boolean,false) THEN
     IF a.state<>'waiting' OR a.waiting_reason IS NULL THEN RAISE EXCEPTION 'Cette attente a déjà été levée. Ouvrez la tâche pour continuer.' USING ERRCODE='22023'; END IF;
     a.state:='in_progress';a.started_at:=coalesce(a.started_at,now());
    ELSE a.state:='ready'; END IF;
    a.waiting_reason:=NULL;a.review_at:=NULL;
   ELSE RAISE EXCEPTION 'Commande d’action invalide' USING ERRCODE='22023';
  END CASE;
 END IF;
 IF p_payload?'due_at' THEN a.due_at:=(p_payload->>'due_at')::timestamptz;a.due_at_source:='manual'; END IF;
 UPDATE staff_work_actions SET state=a.state,assignee_id=a.assignee_id,due_at=a.due_at,due_at_source=a.due_at_source,waiting_reason=a.waiting_reason,review_at=a.review_at,
  handoff_to=a.handoff_to,handoff_note=a.handoff_note,accepted_handoff_note=a.accepted_handoff_note,priority_reason=a.priority_reason,priority_until=a.priority_until,priority_by=a.priority_by,
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
