-- Receiving another physical carton keeps the expedition reference and the
-- previous work, but requires fresh consent and a new optimisation confirmation.
-- This command neither sends a message nor cancels a provider checkout.
CREATE TABLE public.reception_append_receipts (
 request_id uuid PRIMARY KEY, colis_id uuid NOT NULL REFERENCES public.colis(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES public.profiles(id), request_payload jsonb NOT NULL,
 first_carton integer NOT NULL CHECK(first_carton>0), added integer NOT NULL CHECK(added>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reception_append_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reception_append_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.append_reception_cartons(
 p_colis_id uuid,p_cartons jsonb,p_expected_updated_at timestamptz,
 p_casier text DEFAULT NULL,p_notes_reception text DEFAULT NULL,p_check_interdits text[] DEFAULT NULL,
 p_request_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; previous colis; old_count integer; total_count integer; pos integer;
 carton jsonb; box jsonb; boxes jsonb:='[]'; details jsonb:='[]'; remaining text[];
 all_trackings text[]; new_tracking text;
 complete boolean; weight numeric; longest numeric; widest numeric; highest numeric;
 receipt reception_append_receipts; payload jsonb; reception_was_done boolean;
BEGIN
 IF NOT has_permission('perm_colis_receptionner') THEN RAISE EXCEPTION 'Permission réception requise' USING ERRCODE='42501'; END IF;
 PERFORM _assert_staff_task_owner(p_colis_id,'reception');
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable.' USING ERRCODE='22023'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identifiant de réception requis.' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('cartons',p_cartons,'casier',p_casier,'notes',p_notes_reception,'checks',p_check_interdits);
 SELECT * INTO receipt FROM reception_append_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF receipt.colis_id IS DISTINCT FROM c.id OR receipt.actor_id IS DISTINCT FROM auth.uid() OR receipt.request_payload IS DISTINCT FROM payload THEN
   RAISE EXCEPTION 'Cette réception a déjà été enregistrée avec un autre contenu. Actualisez le dossier avant de continuer.' USING ERRCODE='40001';
  END IF;
  RETURN jsonb_build_object('colis',to_jsonb(c),'added',receipt.added,'firstCarton',receipt.first_carton,'lastCarton',receipt.first_carton+receipt.added-1,'reused',true);
 END IF;
 IF c.archive OR c.paiement_date IS NOT NULL OR c.paiement_montant IS NOT NULL
  OR c.statut NOT IN ('receptionne','mesure','attente_feu_vert','autorise','en_preparation','devis_envoye','attente_paiement')
  OR c.date_expedition IS NOT NULL OR EXISTS(SELECT 1 FROM envois WHERE id=c.envoi_id AND (departed_at IS NOT NULL OR manifest_version>0))
  THEN RAISE EXCEPTION 'Ajoutez les cartons à un dossier ouvert, avant paiement et départ.' USING ERRCODE='22023'; END IF;
 IF p_expected_updated_at IS NULL OR c.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'Le dossier a changé. Actualisez-le avant de rattacher vos cartons ; vos saisies sont conservées.' USING ERRCODE='40001';
 END IF;
 IF jsonb_typeof(p_cartons) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cartons) NOT BETWEEN 1 AND 100
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_cartons) b WHERE NOT reception_box_measured(b)) THEN
  RAISE EXCEPTION 'Renseignez longueur, largeur, hauteur et poids positifs de chaque nouveau carton.' USING ERRCODE='22023';
 END IF;
 IF length(coalesce(p_casier,''))>100 OR length(coalesce(p_notes_reception,''))>2000
  OR cardinality(p_check_interdits)>100 OR EXISTS(SELECT 1 FROM unnest(p_check_interdits) t WHERE length(t)>200) THEN
  RAISE EXCEPTION 'Le casier, les notes ou les signalements sont trop longs.' USING ERRCODE='22023';
 END IF;
 -- Preserve all external checkout evidence. The existing explicit correction
 -- service can close a pending link before the operator retries this command.
 IF EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status='creating') THEN
  RAISE EXCEPTION 'Un lien de paiement est en cours de création. Attendez sa création avant de corriger le dossier.' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND provider_id IS NOT NULL AND provider_cancelled_at IS NULL)
  OR EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND provider_cancelled_at IS NULL)
  OR (c.payplug_payment_url IS NOT NULL AND c.payplug_payment_id IS NULL)
  OR (c.payplug_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND provider_id=c.payplug_payment_id AND provider_cancelled_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND provider_id=c.payplug_payment_id AND provider_cancelled_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'Un lien de paiement existe. Ouvrez Corriger le montant pour le fermer avant d’ajouter un carton. Aucun carton n’a été ajouté.' USING ERRCODE='22023';
 END IF;
 previous:=c;
 SELECT state='done' INTO reception_was_done FROM staff_work_actions WHERE colis_id=c.id AND kind='reception';
 old_count:=reception_carton_count(c.nb_colis,c.trackings_detail,c.trackings,c.dims_par_colis);
 total_count:=old_count+jsonb_array_length(p_cartons);
 IF total_count>100 THEN RAISE EXCEPTION 'Un dossier peut contenir au maximum 100 cartons.' USING ERRCODE='22023'; END IF;
 -- Empty historical positions stay explicitly unknown, never inferred from a
 -- multi-carton summary; legacy one-carton scalar measures are unambiguous.
 SELECT coalesce(array_agg(t),'{}') INTO remaining FROM unnest(c.trackings) t
  WHERE nullif(trim(t),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(c.trackings_detail,'[]')) d WHERE d->>'number'=t);
 FOR pos IN 0..old_count-1 LOOP
  carton:=c.trackings_detail->pos;
  IF carton IS NULL THEN
   carton:=jsonb_build_object('number',coalesce(remaining[1],''),'fournisseur',''); remaining:=remaining[2:];
  END IF;
  details:=details||jsonb_build_array(carton);
  box:=c.dims_par_colis->pos;
  IF box IS NULL AND old_count=1 AND coalesce(c.dims_par_colis,'[]')='[]'::jsonb THEN
   box:=jsonb_build_object('dimL',c.dim_l,'dimW',c.dim_w,'dimH',c.dim_h,'poids',c.poids);
  END IF;
  boxes:=boxes||jsonb_build_array(coalesce(box,'{}'::jsonb));
 END LOOP;
 all_trackings:=coalesce(c.trackings,'{}');
 -- Concurrent append commands with a common scanned number serialize even
 -- across dossiers; sorted locks avoid inversions for multi-carton submissions.
 FOR new_tracking IN SELECT DISTINCT lower(trim(value->>'tracking')) FROM jsonb_array_elements(p_cartons)
  WHERE nullif(trim(value->>'tracking'),'') IS NOT NULL ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('expedile-reception-tracking:'||new_tracking,0));
 END LOOP;
 FOR carton IN SELECT value FROM jsonb_array_elements(p_cartons) LOOP
  new_tracking:=coalesce(trim(carton->>'tracking'),'');
  IF length(new_tracking)>200 OR length(coalesce(carton->>'fournisseur',''))>200 THEN RAISE EXCEPTION 'Le numéro de suivi ou le fournisseur est trop long.' USING ERRCODE='22023'; END IF;
  IF new_tracking<>'' THEN
   IF EXISTS(SELECT 1 FROM unnest(all_trackings) t WHERE lower(trim(t))=lower(new_tracking))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(details) d WHERE lower(trim(d->>'number'))=lower(new_tracking)) THEN
    RAISE EXCEPTION 'Ce numéro de suivi est déjà présent dans ce dossier : %.',new_tracking USING ERRCODE='22023';
   END IF;
   IF EXISTS(SELECT 1 FROM colis other WHERE other.id<>c.id AND (
     EXISTS(SELECT 1 FROM unnest(other.trackings) t WHERE lower(trim(t))=lower(new_tracking))
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(other.trackings_detail,'[]')) d WHERE lower(trim(d->>'number'))=lower(new_tracking)))) THEN
    RAISE EXCEPTION 'Ce numéro de suivi est déjà enregistré dans un autre dossier. Vérifiez le carton.' USING ERRCODE='22023';
   END IF;
   all_trackings:=array_append(all_trackings,new_tracking);
  END IF;
  details:=details||jsonb_build_array(jsonb_build_object('number',new_tracking,'fournisseur',trim(coalesce(carton->>'fournisseur',''))));
  boxes:=boxes||jsonb_build_array(jsonb_build_object('dimL',(carton->>'dimL')::numeric,'dimW',(carton->>'dimW')::numeric,'dimH',(carton->>'dimH')::numeric,'poids',(carton->>'poids')::numeric));
 END LOOP;
 SELECT bool_and(reception_box_measured(value)) INTO complete FROM jsonb_array_elements(boxes);
 IF complete THEN
  SELECT sum((value->>'poids')::numeric),max((value->>'dimL')::numeric),max((value->>'dimW')::numeric),max((value->>'dimH')::numeric)
   INTO weight,longest,widest,highest FROM jsonb_array_elements(boxes);
 END IF;
 IF c.devis_total>0 THEN
  INSERT INTO quote_versions(colis_id,version,snapshot,total,created_by)
   VALUES(c.id,c.quote_version,coalesce(c.devis_snapshot,to_jsonb(c)),c.devis_total,auth.uid()) ON CONFLICT(colis_id,version) DO NOTHING;
 END IF;
 PERFORM set_config('expedile.revert','allowed',true);
 UPDATE colis SET nb_colis=total_count,dims_par_colis=boxes,trackings_detail=details,trackings=all_trackings,
  dim_l=longest,dim_w=widest,dim_h=highest,poids=round(weight,2),
  statut=CASE WHEN complete THEN 'mesure'::statut_colis ELSE 'receptionne'::statut_colis END,
  feu_vert='en_attente',feu_vert_date=NULL,attente_client_date=NULL,attente_client_until=NULL,attente_client_motif=NULL,demande_feu_vert_envoyee_at=NULL,
  casier=coalesce(nullif(trim(p_casier),''),casier),
  notes_reception=CASE WHEN nullif(trim(p_notes_reception),'') IS NULL THEN notes_reception ELSE concat_ws(E'\n',nullif(notes_reception,''),trim(p_notes_reception)) END,
  check_interdits=ARRAY(SELECT DISTINCT v FROM unnest(coalesce(check_interdits,'{}')||coalesce(p_check_interdits,'{}')) v WHERE nullif(trim(v),'') IS NOT NULL ORDER BY v),
  produit_interdit=produit_interdit OR EXISTS(SELECT 1 FROM unnest(p_check_interdits) v WHERE nullif(trim(v),'') IS NOT NULL)
 WHERE id=c.id RETURNING * INTO c;
 PERFORM set_config('expedile.revert','',true);
 -- A completed historical assignment is not a new mandate. Reopened receipt
 -- work is free to take; a currently active assignee was checked before saving.
 IF reception_was_done THEN
  UPDATE staff_work_actions SET assignee_id=NULL,version=version+1,updated_at=clock_timestamp()
   WHERE colis_id=c.id AND kind='reception' AND assignee_id IS NOT NULL;
 END IF;
 INSERT INTO audit_actions(colis_id,user_id,action,detail,before_data,after_data)
  VALUES(c.id,auth.uid(),'reception_cartons_added',jsonb_build_object('added',jsonb_array_length(p_cartons),'firstCarton',old_count+1,'lastCarton',total_count,'consentRenewal',true)::text,to_jsonb(previous),to_jsonb(c));
 INSERT INTO reception_append_receipts(request_id,colis_id,actor_id,request_payload,first_carton,added)
  VALUES(p_request_id,c.id,auth.uid(),payload,old_count+1,jsonb_array_length(p_cartons));
 RETURN jsonb_build_object('colis',to_jsonb(c),'added',jsonb_array_length(p_cartons),'firstCarton',old_count+1,'lastCarton',total_count);
END; $$;
REVOKE ALL ON FUNCTION public.append_reception_cartons(uuid,jsonb,timestamptz,text,text,text[],uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.append_reception_cartons(uuid,jsonb,timestamptz,text,text,text[],uuid) TO authenticated;

-- Keep the existing communication channels, idempotency, snapshots and grants.
-- The operator's explicit send queues the request AND starts the wait together.
-- A failed permission, stale owner or incomplete receipt leaves both untouched.
DO $$
DECLARE definition text; anchor text; replacement text;
BEGIN
 definition:=pg_get_functiondef('public.queue_message(uuid,text,text,text,jsonb,text,integer)'::regprocedure);
 anchor:=E' IF p_template IN (''demande_feu_vert'',''relance_feu_vert'') THEN\n  snap:=';
 replacement:=$guard$ IF p_template IN ('demande_feu_vert','relance_feu_vert') THEN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
   IF NOT has_permission('perm_colis_demander_feuvert') THEN RAISE EXCEPTION 'Permission de demande d’accord requise' USING ERRCODE='42501'; END IF;
   PERFORM _assert_staff_task_owner(c.id,'reception');
  END IF;
  IF c.archive OR c.paiement_date IS NOT NULL OR c.statut NOT IN ('receptionne','mesure','attente_feu_vert')
   OR (p_template='relance_feu_vert' AND c.statut<>'attente_feu_vert') THEN
   RAISE EXCEPTION 'La demande d’accord ne correspond plus à cette étape. Actualisez le dossier.' USING ERRCODE='40001';
  END IF;
  IF NOT coalesce((reception_carton_count(c.nb_colis,c.trackings_detail,c.trackings,c.dims_par_colis)=1
    AND coalesce(c.dims_par_colis,'[]'::jsonb)='[]'::jsonb
    AND reception_box_measured(jsonb_build_object('dimL',c.dim_l,'dimW',c.dim_w,'dimH',c.dim_h,'poids',c.poids)))
   OR (jsonb_typeof(c.dims_par_colis)='array'
    AND reception_carton_count(c.nb_colis,c.trackings_detail,c.trackings,c.dims_par_colis)=jsonb_array_length(c.dims_par_colis)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.dims_par_colis) b WHERE NOT reception_box_measured(b))),false) THEN
   RAISE EXCEPTION 'Enregistrez les mesures à réception de chaque carton avant de demander l’accord.' USING ERRCODE='22023';
  END IF;
  IF c.statut IN ('receptionne','mesure') THEN
   UPDATE colis SET statut='attente_feu_vert',feu_vert='en_attente' WHERE id=c.id RETURNING * INTO c;
  END IF;
  snap:=$guard$;
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Unexpected combined approval command definition'; END IF;
 EXECUTE replace(definition,anchor,replacement);
END; $$;
