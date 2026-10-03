-- Arrival metadata never participates in carton identity, approval snapshots,
-- measurements or quote calculation. Existing dossiers are NOT updated here.
ALTER TABLE colis ADD COLUMN reception_dates jsonb CHECK(reception_dates IS NULL OR jsonb_typeof(reception_dates)='array');
CREATE INDEX reception_append_receipts_colis_idx ON reception_append_receipts(colis_id);

CREATE FUNCTION _reception_dates_from_evidence(c colis) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb:='[]'; entry jsonb; pos integer; total integer;
 stamp timestamptz; matches integer; original_single boolean;
BEGIN
 total:=reception_carton_count(c.nb_colis,c.trackings_detail,c.trackings,c.dims_par_colis);
 -- A sole physical carton is unambiguous. For an appended dossier, recover its
 -- original one-carton lot only when the stored before-image proves that count.
 original_single:=total=1 OR EXISTS(
  SELECT 1 FROM audit_actions a JOIN reception_append_receipts r ON r.colis_id=a.colis_id
   AND r.first_carton=2 AND r.created_at=a.created_at
  WHERE a.colis_id=c.id AND a.action='reception_cartons_added'
   AND a.before_data->'nb_colis'='1'::jsonb
   AND CASE WHEN jsonb_typeof(a.before_data->'trackings_detail')='array' THEN jsonb_array_length(a.before_data->'trackings_detail') ELSE 0 END<=1
   AND CASE WHEN jsonb_typeof(a.before_data->'dims_par_colis')='array' THEN jsonb_array_length(a.before_data->'dims_par_colis') ELSE 0 END<=1
   AND a.before_data->>'date_reception'=to_jsonb(c)->>'date_reception');
 FOR pos IN 1..total LOOP
  entry:=c.reception_dates->(pos-1);
  IF entry IS NOT NULL AND entry<>'null'::jsonb THEN result:=result||jsonb_build_array(entry);CONTINUE;END IF;
  -- A receipt permanently identifies the ordinal range that was appended.
  -- If a tracked identity has since changed, do not date its replacement.
  SELECT count(*),min(r.created_at) INTO matches,stamp FROM reception_append_receipts r
   WHERE r.colis_id=c.id AND pos>=r.first_carton AND pos<r.first_carton+r.added
    AND r.created_at<=now()
    AND (coalesce(trim(r.request_payload#>>ARRAY['cartons',(pos-r.first_carton)::text,'tracking']),'')=''
     OR trim(r.request_payload#>>ARRAY['cartons',(pos-r.first_carton)::text,'tracking'])=coalesce(c.trackings_detail->(pos-1)->>'number',''));
  IF matches=1 THEN entry:=jsonb_build_object('receivedAt',stamp,'source','append_receipt');
  ELSIF pos=1 AND original_single AND c.date_reception IS NOT NULL AND c.date_reception<=now() THEN
   entry:=jsonb_build_object('receivedAt',c.date_reception,'source','initial_receipt');
  ELSE entry:='null'::jsonb;END IF;
  result:=result||jsonb_build_array(entry);
 END LOOP;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION _reception_dates_from_evidence(colis) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION stamp_reception_dates() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_count integer; next_count integer; pos integer; stamp timestamptz:=clock_timestamp(); dates jsonb;
BEGIN
 next_count:=reception_carton_count(NEW.nb_colis,NEW.trackings_detail,NEW.trackings,NEW.dims_par_colis);
 IF TG_OP='INSERT' THEN
  -- Only an actual staff receipt creates new arrival evidence; imports and
  -- historical non-receipt inserts never become arrivals merely by insertion.
  NEW.reception_dates:=NULL;
  IF NEW.statut IN ('receptionne','mesure') AND has_permission('perm_colis_receptionner') THEN
   SELECT jsonb_agg(jsonb_build_object('receivedAt',stamp,'source','server') ORDER BY n) INTO NEW.reception_dates FROM generate_series(1,next_count) n;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.reception_dates IS DISTINCT FROM OLD.reception_dates THEN
  RAISE EXCEPTION 'Les dates de réception sont enregistrées automatiquement et ne peuvent pas être réécrites.' USING ERRCODE='42501';
 END IF;
 previous_count:=reception_carton_count(OLD.nb_colis,OLD.trackings_detail,OLD.trackings,OLD.dims_par_colis);
 -- Reads never backfill a dossier. A later real save retains the proven
 -- metadata in its returned row so it cannot erase dates enriched by the RPC.
 dates:=_reception_dates_from_evidence(OLD);
 NEW.reception_dates:=dates;
 IF next_count>previous_count THEN
  FOR pos IN previous_count+1..next_count LOOP
   dates:=dates||jsonb_build_array(jsonb_build_object('receivedAt',stamp,'source','server'));
  END LOOP;
  NEW.reception_dates:=dates;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION stamp_reception_dates() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ab_stamp_reception_dates BEFORE INSERT OR UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION stamp_reception_dates();

-- Same narrow fields on the client projection, retaining its owner predicate,
-- security barrier and financial masking. CREATE OR REPLACE keeps existing ACL.
DO $$ DECLARE definition text; anchor text:='\n   FROM colis'; BEGIN
 definition:=pg_get_viewdef('public.client_colis'::regclass,true);
 anchor:=E'\n   FROM colis';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Unexpected client dossier view for reception dates'; END IF;
 EXECUTE 'CREATE OR REPLACE VIEW public.client_colis WITH (security_barrier=true) AS '||replace(definition,anchor,','||E'\n    colis.reception_dates'||anchor);
END; $$;

CREATE FUNCTION get_reception_dates(p_colis_ids uuid[]) RETURNS TABLE(colis_id uuid,reception_dates jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND actif) THEN
  RAISE EXCEPTION 'Connexion active requise pour consulter les réceptions.' USING ERRCODE='42501';
 END IF;
 IF p_colis_ids IS NULL OR cardinality(p_colis_ids)>100 THEN RAISE EXCEPTION 'Sélectionnez au maximum 100 dossiers.' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT c.id,_reception_dates_from_evidence(c) FROM colis c
  WHERE c.id=ANY(p_colis_ids) AND (is_staff() OR c.client_id=auth_client_id());
END; $$;
REVOKE ALL ON FUNCTION get_reception_dates(uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION get_reception_dates(uuid[]) TO authenticated;
