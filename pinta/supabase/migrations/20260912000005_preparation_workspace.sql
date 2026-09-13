-- Physical preparation is saved independently of invoices and commercial publication.
ALTER TABLE colis ADD COLUMN IF NOT EXISTS preparation_composition_version integer NOT NULL DEFAULT 0;
ALTER TABLE colis ADD COLUMN IF NOT EXISTS final_measurements_version integer;
ALTER TABLE colis ADD COLUMN IF NOT EXISTS final_measurements_at timestamptz;
ALTER TABLE colis ADD COLUMN IF NOT EXISTS final_packages jsonb;
-- Historical recorded measures remain historical facts; no outgoing count is invented.
UPDATE colis SET final_measurements_version=0 WHERE fin_l>0 AND fin_w>0 AND fin_h>0 AND fin_p>0
 AND (paiement_date IS NOT NULL OR (devis_total>0 AND devis_snapshot->'inputs'->'originalBoxes' IS NOT DISTINCT FROM dims_par_colis));
UPDATE colis SET statut='en_preparation' WHERE paiement_date IS NULL AND statut IN ('devis_envoye','attente_paiement') AND (devis_total IS NULL OR devis_total<=0 OR devis_brouillon);

CREATE FUNCTION invalidate_preparation_composition() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF (NEW.nb_colis,NEW.dims_par_colis,NEW.trackings_detail,NEW.trackings) IS DISTINCT FROM (OLD.nb_colis,OLD.dims_par_colis,OLD.trackings_detail,OLD.trackings) THEN
  IF OLD.paiement_date IS NOT NULL THEN RAISE EXCEPTION 'La composition d’un dossier payé est figée'; END IF;
  NEW.preparation_composition_version:=OLD.preparation_composition_version+1;
  NEW.final_measurements_version:=NULL; NEW.final_measurements_at:=NULL;
  NEW.outgoing_parcel_count:=NULL;
  -- Keep old measures for comparison, but never treat them as validated for new cartons.
  NEW.devis_total:=NULL; NEW.devis_snapshot:=NULL; NEW.devis_brouillon:=true;
  NEW.payplug_payment_id:=NULL; NEW.payplug_payment_url:=NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER invalidate_preparation_composition BEFORE UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION invalidate_preparation_composition();

CREATE FUNCTION guard_preparation_workspace() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user IN ('postgres','supabase_admin') OR auth.role()='service_role' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.final_packages IS NOT NULL OR NEW.outgoing_parcel_count IS NOT NULL OR NEW.final_measurements_version IS NOT NULL OR NEW.final_measurements_at IS NOT NULL OR NEW.preparation_composition_version<>0 THEN RAISE EXCEPTION 'Une réception ne certifie aucune préparation sortante' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.fin_l,NEW.fin_w,NEW.fin_h,NEW.fin_p,NEW.final_packages,NEW.final_measurements_version,NEW.final_measurements_at,NEW.preparation_composition_version) IS DISTINCT FROM (OLD.fin_l,OLD.fin_w,OLD.fin_h,OLD.fin_p,OLD.final_packages,OLD.final_measurements_version,OLD.final_measurements_at,OLD.preparation_composition_version) THEN
  RAISE EXCEPTION 'Utilisez la sauvegarde des mesures de préparation' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_preparation_workspace BEFORE INSERT OR UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION guard_preparation_workspace();

CREATE FUNCTION save_preparation_measurements(p_colis_id uuid,p_final_packages jsonb,p_expected_updated_at timestamptz,p_expected_composition_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; real_weight numeric; max_l numeric; max_w numeric; max_h numeric;
BEGIN
 IF NOT has_permission('perm_colis_preparer') THEN RAISE EXCEPTION 'Permission préparation requise' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.statut NOT IN ('en_preparation','devis_envoye','attente_paiement') OR c.paiement_date IS NOT NULL OR c.archive OR c.produit_interdit OR c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN RAISE EXCEPTION 'Un dossier autorisé et impayé, non archivé et sans produit interdit, en préparation est requis'; END IF;
 IF p_expected_updated_at IS NULL OR p_expected_composition_version IS NULL OR c.updated_at IS DISTINCT FROM p_expected_updated_at OR c.preparation_composition_version IS DISTINCT FROM p_expected_composition_version THEN
  RAISE EXCEPTION 'Le dossier ou ses cartons ont changé. Reprenez la version enregistrée avant de sauvegarder.' USING ERRCODE='40001';
 END IF;
 IF jsonb_typeof(p_final_packages) IS DISTINCT FROM 'array' OR jsonb_array_length(p_final_packages) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_final_packages) WHERE NOT reception_box_measured(value)) THEN RAISE EXCEPTION 'Mesurez longueur, largeur, hauteur et poids positifs de chaque colis sortant'; END IF;
 SELECT jsonb_agg(jsonb_build_object('dimL',(value->>'dimL')::numeric,'dimW',(value->>'dimW')::numeric,'dimH',(value->>'dimH')::numeric,'poids',(value->>'poids')::numeric) ORDER BY position) INTO p_final_packages FROM jsonb_array_elements(p_final_packages) WITH ORDINALITY AS boxes(value,position);
 SELECT sum((value->>'poids')::numeric),max((value->>'dimL')::numeric),max((value->>'dimW')::numeric),max((value->>'dimH')::numeric) INTO real_weight,max_l,max_w,max_h FROM jsonb_array_elements(p_final_packages);
 UPDATE colis SET final_packages=p_final_packages,fin_l=max_l,fin_w=max_w,fin_h=max_h,fin_p=real_weight,
  outgoing_parcel_count=jsonb_array_length(p_final_packages),final_measurements_version=preparation_composition_version,final_measurements_at=now(),
  devis_total=NULL,devis_snapshot=NULL,devis_brouillon=true,payplug_payment_id=NULL,payplug_payment_url=NULL,
  statut=CASE WHEN statut IN ('devis_envoye','attente_paiement') THEN 'en_preparation'::statut_colis ELSE statut END
 WHERE id=c.id RETURNING * INTO c;
 RETURN jsonb_build_object('colis',to_jsonb(c));
END; $$;
REVOKE ALL ON FUNCTION save_preparation_measurements(uuid,jsonb,timestamptz,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION save_preparation_measurements(uuid,jsonb,timestamptz,integer) TO authenticated;

-- Revisions belong in the preparation queue, never in an empty payment screen.
CREATE OR REPLACE FUNCTION invalidate_quote_on_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target uuid;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.colis_id ELSE NEW.colis_id END;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='factures' AND (to_jsonb(OLD)-ARRAY['telegram_msg_id','ocr_status','ocr_error']) IS NOT DISTINCT FROM (to_jsonb(NEW)-ARRAY['telegram_msg_id','ocr_status','ocr_error']) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM colis WHERE id=target AND paiement_date IS NOT NULL) THEN RAISE EXCEPTION 'Les documents et articles d’un dossier payé sont figés'; END IF;
 UPDATE colis SET devis_total=NULL,devis_snapshot=NULL,devis_brouillon=true,payplug_payment_id=NULL,payplug_payment_url=NULL,
  statut=CASE WHEN statut IN ('devis_envoye','attente_paiement') THEN 'en_preparation'::statut_colis ELSE statut END
 WHERE id=target AND (devis_total IS NOT NULL OR statut IN ('devis_envoye','attente_paiement'));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END; $$;
