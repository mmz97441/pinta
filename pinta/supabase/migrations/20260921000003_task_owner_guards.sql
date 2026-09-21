-- An active task may only be edited by its current owner once assigned.
-- Scope: the explicit staff RPCs below. Free and completed tasks remain editable
-- according to the existing business permissions. Derived triggers/client events
-- do not call this helper and cannot be blocked by a colleague's assignment.
CREATE FUNCTION _assert_staff_task_owner(p_colis_id uuid,p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a staff_work_actions; owner_name text;
BEGIN
 IF NOT is_staff() THEN RETURN; END IF;
 -- Business commands already serialize their actual save on this row. Acquire
 -- it before the task row to keep one ordering with synchronization triggers.
 PERFORM 1 FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO a FROM staff_work_actions WHERE colis_id=p_colis_id AND kind=p_kind FOR UPDATE;
 IF FOUND AND a.state<>'done' AND a.assignee_id IS NOT NULL AND a.assignee_id IS DISTINCT FROM auth.uid() THEN
  SELECT coalesce(nullif(trim(s.nom),''),nullif(trim(p.nom),'')) INTO owner_name FROM profiles p LEFT JOIN staff_users s ON s.auth_id=p.id WHERE p.id=a.assignee_id;
  RAISE EXCEPTION 'Cette tâche est suivie par %. Vos saisies sont conservées : demandez un relais ou actualisez la tâche avant de poursuivre.',coalesce(owner_name,'un collègue') USING ERRCODE='40001';
 END IF;
END; $$;
REVOKE ALL ON FUNCTION _assert_staff_task_owner(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Keep the already-validated implementations intact: insert one guarded call
-- immediately before their dossier read/lock. The helper locks dossier then task;
-- the original SELECT still sets FOUND for the command's existing validations.
-- Exact signatures and unique anchors make an unexpected source version fail.
DO $$
DECLARE item record; definition text; anchor text; guarded text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('save_preparation_measurements(uuid,jsonb,timestamp with time zone,integer)',
   ' SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;',
   ' PERFORM _assert_staff_task_owner(p_colis_id,''preparation'');'),
  ('save_quote(uuid,jsonb,timestamp with time zone)',
   ' SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;',
   ' PERFORM _assert_staff_task_owner(p_colis_id,''quote'');'),
  ('save_quote_customs(uuid,jsonb,timestamp with time zone)',
   ' SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;',
   ' PERFORM _assert_staff_task_owner(p_colis_id,''quote'');'),
  ('save_invoice_review(uuid,text,text,jsonb,numeric,text,uuid,boolean)',
   ' SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;',
   ' PERFORM _assert_staff_task_owner((SELECT colis_id FROM factures WHERE id=p_facture_id),''documents'');'),
  ('classify_invoice_duplicate(uuid,uuid,text,text)',
   ' SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;',
   ' PERFORM _assert_staff_task_owner((SELECT colis_id FROM factures WHERE id=p_facture_id),''documents'');'),
  ('restore_invoice_duplicate(uuid,text)',
   ' SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;',
   ' PERFORM _assert_staff_task_owner((SELECT colis_id FROM factures WHERE id=p_facture_id),''documents'');'),
  ('correct_colis_task(uuid,text,jsonb,timestamp with time zone,text)',
   ' SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;',
   ' PERFORM _assert_staff_task_owner(p_colis_id,CASE p_task WHEN ''reception'' THEN ''reception'' WHEN ''accord'' THEN ''reception'' WHEN ''preparation'' THEN ''preparation'' WHEN ''devis'' THEN ''quote'' END);' || E'\n' ||
   ' PERFORM _assert_staff_task_owner(p_colis_id,''correction'');')
 ) AS replacements(signature,anchor,guarded) LOOP
  definition:=pg_get_functiondef(('public.'||item.signature)::regprocedure);
  anchor:=item.anchor;guarded:=item.guarded;
  IF position('_assert_staff_task_owner(' in definition)>0 OR (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
   RAISE EXCEPTION 'Unexpected source definition for task owner guard: %',item.signature;
  END IF;
  EXECUTE replace(definition,anchor,guarded||E'\n'||anchor);
 END LOOP;
END; $$;

-- The legacy OCR confirmation endpoint remains guarded and uses the same lock
-- order as current invoice review: dossier -> task -> invoice -> extraction.
CREATE OR REPLACE FUNCTION confirm_ocr_extraction_current(
 p_extraction_id uuid,p_expected_file_url text,p_expected_document_hash text,
 p_lines jsonb DEFAULT NULL,p_total numeric DEFAULT NULL,p_vendeur text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e ocr_extractions; f factures; invoice_id uuid;
BEGIN
 IF NOT has_permission('perm_factures_valider') THEN RAISE EXCEPTION 'Permission validation facture requise'; END IF;
 SELECT facture_id INTO invoice_id FROM ocr_extractions WHERE id=p_extraction_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Extraction introuvable'; END IF;
 PERFORM _assert_staff_task_owner((SELECT colis_id FROM factures WHERE id=invoice_id),'documents');
 SELECT * INTO f FROM factures WHERE id=invoice_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable'; END IF;
 SELECT * INTO e FROM ocr_extractions WHERE id=p_extraction_id FOR UPDATE;
 IF NOT FOUND OR e.facture_id IS DISTINCT FROM f.id THEN RAISE EXCEPTION 'L’analyse a changé. Rechargez la facture.' USING ERRCODE='40001'; END IF;
 IF coalesce(trim(p_expected_file_url),'')='' OR coalesce(trim(p_expected_document_hash),'')=''
  OR f.fichier_url IS DISTINCT FROM p_expected_file_url
  OR e.document_file_url IS DISTINCT FROM p_expected_file_url
  OR e.document_hash IS DISTINCT FROM p_expected_document_hash
 THEN RAISE EXCEPTION 'Le document a changé. Reprenez son analyse avant confirmation'; END IF;
 RETURN confirm_ocr_extraction(p_extraction_id,p_lines,p_total,p_vendeur);
END; $$;
REVOKE ALL ON FUNCTION confirm_ocr_extraction_current(uuid,text,text,jsonb,numeric,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION confirm_ocr_extraction_current(uuid,text,text,jsonb,numeric,text) TO authenticated;

-- Assignment writes already obtain a key-share dossier lock through their audit
-- foreign key. Take that same non-exclusive lock BEFORE the task to prevent the
-- inverse order when a business save concurrently locks dossier then task.
-- It never reserves the whole dossier for an operator or changes any business row.
DO $$
DECLARE definition text; anchor text:=' SELECT * INTO a FROM staff_work_actions WHERE id=p_action_id FOR UPDATE;';
BEGIN
 definition:=pg_get_functiondef('public.mutate_staff_work_action(uuid,text,integer,jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Unexpected task mutation definition'; END IF;
 EXECUTE replace(definition,anchor,
  ' PERFORM 1 FROM colis WHERE id=(SELECT colis_id FROM staff_work_actions WHERE id=p_action_id) FOR KEY SHARE;'||E'\n'||anchor);
END; $$;
