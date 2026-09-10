-- Enforce measurements at the staff receipt boundary, without rejecting updates
-- to historical dossiers or treating receipt dimensions as preparation inputs.
CREATE FUNCTION reception_carton_count(p_nb integer,p_details jsonb,p_trackings text[],p_dims jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
 SELECT greatest(1,coalesce(p_nb,0),(SELECT count(*)::integer FROM unnest(p_trackings) t WHERE coalesce(trim(t),'')<>''),
 CASE WHEN jsonb_typeof(p_details)='array' THEN jsonb_array_length(p_details) ELSE 0 END,
 CASE WHEN jsonb_typeof(p_dims)='array' THEN jsonb_array_length(p_dims) ELSE 0 END);
$$;
CREATE FUNCTION reception_box_measured(p_box jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; value numeric;
BEGIN
 IF jsonb_typeof(p_box) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['dimL','dimW','dimH','poids'] LOOP
  IF coalesce(p_box->>field,'') !~ '^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN RETURN false; END IF;
  BEGIN value:=(p_box->>field)::numeric; EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN false; END;
  IF value<=0 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END; $$;

CREATE FUNCTION guard_reception_measurements() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE previous_count integer:=0; total_count integer; additional boolean; promote boolean:=false;
 boxes jsonb; old_box jsonb; idx integer; field text; complete boolean; old_value numeric; new_value numeric;
BEGIN
 -- Management migrations, service jobs and fixture restoration are distinct
 -- from a physical receipt entered by an authenticated staff member.
 IF current_user IN ('postgres','supabase_admin') OR auth.role()='service_role' THEN RETURN NEW; END IF;
 total_count:=reception_carton_count(NEW.nb_colis,NEW.trackings_detail,NEW.trackings,NEW.dims_par_colis);
 IF TG_OP='UPDATE' THEN
  previous_count:=reception_carton_count(OLD.nb_colis,OLD.trackings_detail,OLD.trackings,OLD.dims_par_colis);
  additional:=total_count>previous_count;
  promote:=NEW.statut='mesure' AND (NEW.statut IS DISTINCT FROM OLD.statut OR
   (NEW.dims_par_colis,NEW.dim_l,NEW.dim_w,NEW.dim_h,NEW.poids) IS DISTINCT FROM (OLD.dims_par_colis,OLD.dim_l,OLD.dim_w,OLD.dim_h,OLD.poids));
  IF NOT additional AND NOT promote THEN RETURN NEW; END IF;
  IF additional AND (OLD.statut NOT IN ('receptionne','mesure','attente_feu_vert','autorise') OR OLD.paiement_date IS NOT NULL) THEN RAISE EXCEPTION 'Rattachez les nouveaux cartons avant la préparation et le paiement'; END IF;
 ELSE additional:=true; END IF;
 IF additional AND NOT has_permission('perm_colis_receptionner') THEN RAISE EXCEPTION 'Permission réception requise'; END IF;
 IF additional AND NEW.statut NOT IN ('receptionne','mesure') THEN RAISE EXCEPTION 'Une réception revient à l’étape réception ou mesure, sans accord implicite'; END IF;
 IF additional THEN
  IF NEW.nb_colis IS DISTINCT FROM total_count OR jsonb_typeof(NEW.trackings_detail) IS DISTINCT FROM 'array'
   OR jsonb_array_length(NEW.trackings_detail)<>total_count THEN RAISE EXCEPTION 'Le nombre de cartons et leur liste doivent correspondre'; END IF;
  IF TG_OP='INSERT' THEN
   IF NEW.fin_l IS NOT NULL OR NEW.fin_w IS NOT NULL OR NEW.fin_h IS NOT NULL OR NEW.fin_p IS NOT NULL THEN RAISE EXCEPTION 'Les mesures après optimisation seront saisies pendant la préparation'; END IF;
  ELSIF (NEW.fin_l,NEW.fin_w,NEW.fin_h,NEW.fin_p) IS DISTINCT FROM (OLD.fin_l,OLD.fin_w,OLD.fin_h,OLD.fin_p) THEN RAISE EXCEPTION 'Le rattachement ne modifie pas les mesures après optimisation'; END IF;
 END IF;
 boxes:=NEW.dims_par_colis;
 -- Historical single-carton measurements have an unambiguous scalar equivalent.
 -- Multiple cartons never inherit fictitious individual measures from maxima.
 IF NOT additional AND total_count=1 AND (boxes IS NULL OR boxes='[]'::jsonb) THEN
  boxes:=jsonb_build_array(jsonb_build_object('dimL',NEW.dim_l,'dimW',NEW.dim_w,'dimH',NEW.dim_h,'poids',NEW.poids));
 END IF;
 IF jsonb_typeof(boxes) IS DISTINCT FROM 'array' OR jsonb_array_length(boxes)<>total_count THEN RAISE EXCEPTION 'Une position de mesure est requise pour chaque carton'; END IF;
 IF additional THEN
  FOR idx IN previous_count..total_count-1 LOOP
   IF NOT reception_box_measured(boxes->idx) THEN RAISE EXCEPTION 'Renseignez longueur, largeur, hauteur et poids positifs du carton %',idx+1; END IF;
  END LOOP;
  IF TG_OP='UPDATE' THEN
   FOR idx IN 0..previous_count-1 LOOP
    old_box:=OLD.dims_par_colis->idx;
    IF previous_count=1 AND (OLD.dims_par_colis IS NULL OR OLD.dims_par_colis='[]'::jsonb) THEN
     old_box:=jsonb_build_object('dimL',OLD.dim_l,'dimW',OLD.dim_w,'dimH',OLD.dim_h,'poids',OLD.poids);
    END IF;
    -- Preserve each known coordinate even when the historical carton is only
    -- partially measured. Unknown values may be completed, never fabricated.
    FOREACH field IN ARRAY ARRAY['dimL','dimW','dimH','poids'] LOOP
     BEGIN old_value:=(old_box->>field)::numeric; EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN old_value:=NULL; END;
     IF old_value>0 AND old_value NOT IN ('NaN'::numeric,'Infinity'::numeric) THEN
      BEGIN new_value:=(boxes->idx->>field)::numeric; EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN new_value:=NULL; END;
      IF new_value IS DISTINCT FROM old_value THEN RAISE EXCEPTION 'Le rattachement conserve les mesures existantes du carton %',idx+1; END IF;
     END IF;
    END LOOP;
   END LOOP;
  END IF;
  NEW.feu_vert:='en_attente';NEW.feu_vert_date:=NULL;NEW.attente_client_date:=NULL;
  NEW.attente_client_motif:=NULL;NEW.attente_client_until:=NULL;NEW.demande_feu_vert_envoyee_at:=NULL;
 END IF;
 SELECT bool_and(reception_box_measured(value)) INTO complete FROM jsonb_array_elements(boxes);
 IF NEW.statut='mesure' AND NOT complete THEN RAISE EXCEPTION 'Les anciens cartons doivent aussi être mesurés avant de déclarer le dossier mesuré'; END IF;
 NEW.dims_par_colis:=boxes;
 IF complete THEN
  SELECT max((value->>'dimL')::numeric),max((value->>'dimW')::numeric),max((value->>'dimH')::numeric),round(sum((value->>'poids')::numeric),2)
  INTO NEW.dim_l,NEW.dim_w,NEW.dim_h,NEW.poids FROM jsonb_array_elements(boxes);
 ELSE NEW.dim_l:=NULL;NEW.dim_w:=NULL;NEW.dim_h:=NULL;NEW.poids:=NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_reception_measurements BEFORE INSERT OR UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION guard_reception_measurements();

-- A newly measured receipt still invalidates the previous carton consent.
CREATE OR REPLACE FUNCTION fn_valider_transition_statut() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE allowed text[];
BEGIN
 IF OLD.statut=NEW.statut THEN RETURN NEW; END IF;
 IF current_user IN ('postgres','supabase_admin') AND current_setting('expedile.revert',true)='allowed' THEN RETURN NEW; END IF;
 IF NEW.statut IN ('receptionne','mesure') AND OLD.statut IN ('mesure','attente_feu_vert','autorise') AND (NEW.trackings,NEW.nb_colis,NEW.trackings_detail) IS DISTINCT FROM (OLD.trackings,OLD.nb_colis,OLD.trackings_detail) AND NEW.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert AND (has_permission('perm_colis_receptionner') OR auth.role()='service_role') THEN RETURN NEW; END IF;
 IF NEW.statut='annule' AND OLD.statut NOT IN ('livre','annule') THEN RETURN NEW; END IF;
 allowed:=CASE OLD.statut::text
 WHEN 'receptionne' THEN ARRAY['mesure','attente_feu_vert'] WHEN 'mesure' THEN ARRAY['attente_feu_vert']
 WHEN 'attente_feu_vert' THEN ARRAY['autorise','refuse_client'] WHEN 'refuse_client' THEN ARRAY['attente_feu_vert']
 WHEN 'autorise' THEN ARRAY['en_preparation'] WHEN 'en_preparation' THEN ARRAY['devis_envoye']
 WHEN 'devis_envoye' THEN ARRAY['attente_paiement','paye','en_preparation'] WHEN 'attente_paiement' THEN ARRAY['paye','en_preparation']
 WHEN 'paye' THEN ARRAY['expedie'] WHEN 'expedie' THEN ARRAY['transit'] WHEN 'transit' THEN ARRAY['dedouanement','arrive']
 WHEN 'dedouanement' THEN ARRAY['arrive'] WHEN 'arrive' THEN ARRAY['livraison'] WHEN 'livraison' THEN ARRAY['livre'] ELSE ARRAY[]::text[] END;
 IF NOT NEW.statut::text=ANY(allowed) THEN RAISE EXCEPTION 'Transition invalide : % → %',OLD.statut,NEW.statut; END IF;
 RETURN NEW;
END; $$;
