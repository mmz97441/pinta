-- A calculated quote and its payment link must never survive a change to their inputs.
CREATE OR REPLACE FUNCTION invalidate_quote_on_colis_inputs() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF (NEW.fin_l,NEW.fin_w,NEW.fin_h,NEW.fin_p,NEW.frais_divers,NEW.mode_paiement_pro) IS DISTINCT FROM (OLD.fin_l,OLD.fin_w,OLD.fin_h,OLD.fin_p,OLD.frais_divers,OLD.mode_paiement_pro) AND NEW.devis_snapshot IS NOT DISTINCT FROM OLD.devis_snapshot THEN
  IF OLD.paiement_date IS NOT NULL THEN RAISE EXCEPTION 'Les données d’un devis payé sont figées'; END IF;
  NEW.devis_total:=NULL; NEW.devis_snapshot:=NULL; NEW.devis_brouillon:=true; NEW.payplug_payment_id:=NULL; NEW.payplug_payment_url:=NULL;
 END IF;
 IF NEW.statut='devis_envoye' AND OLD.statut<>'devis_envoye' THEN
  IF NEW.devis_total IS NULL OR NEW.devis_total<=0 OR NEW.quote_version<1 THEN RAISE EXCEPTION 'Un devis calculé valide est requis'; END IF;
  NEW.devis_envoye_le:=now();NEW.devis_envoye_par:=auth.uid();
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER invalidate_quote_on_colis_inputs BEFORE UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION invalidate_quote_on_colis_inputs();
CREATE OR REPLACE FUNCTION invalidate_quote_on_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target uuid;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.colis_id ELSE NEW.colis_id END;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='factures' AND (to_jsonb(OLD)-ARRAY['telegram_msg_id','ocr_status','ocr_error']) IS NOT DISTINCT FROM (to_jsonb(NEW)-ARRAY['telegram_msg_id','ocr_status','ocr_error']) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM colis WHERE id=target AND paiement_date IS NOT NULL) THEN RAISE EXCEPTION 'Les documents et articles d’un dossier payé sont figés'; END IF;
 UPDATE colis SET devis_total=NULL,devis_snapshot=NULL,devis_brouillon=true,payplug_payment_id=NULL,payplug_payment_url=NULL WHERE id=target AND devis_total IS NOT NULL;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER invalidate_quote_on_invoice AFTER INSERT OR UPDATE OR DELETE ON factures FOR EACH ROW EXECUTE FUNCTION invalidate_quote_on_document();
CREATE TRIGGER invalidate_quote_on_line AFTER INSERT OR UPDATE OR DELETE ON lignes FOR EACH ROW EXECUTE FUNCTION invalidate_quote_on_document();
CREATE OR REPLACE FUNCTION guard_colis_permissions() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE permission text;
BEGIN
 IF current_user IN ('postgres','supabase_admin') OR auth.role()='service_role' THEN RETURN NEW; END IF;
 IF NOT is_staff() THEN RAISE EXCEPTION 'Utilisez la commande de décision client'; END IF;
 IF NEW.statut IS DISTINCT FROM OLD.statut THEN
  permission:=CASE NEW.statut::text WHEN 'receptionne' THEN 'perm_colis_receptionner' WHEN 'mesure' THEN 'perm_colis_mesurer' WHEN 'attente_feu_vert' THEN 'perm_colis_demander_feuvert' WHEN 'autorise' THEN 'perm_colis_valider_feuvert' WHEN 'refuse_client' THEN 'perm_colis_valider_feuvert' WHEN 'en_preparation' THEN 'perm_colis_preparer' WHEN 'devis_envoye' THEN 'perm_colis_envoyer_devis' WHEN 'attente_paiement' THEN 'perm_colis_envoyer_devis' WHEN 'paye' THEN 'perm_colis_confirmer_paiement' WHEN 'expedie' THEN 'perm_colis_expedier' WHEN 'annule' THEN 'perm_colis_annuler' ELSE 'perm_colis_changer_statut_expedition' END;
  IF NOT has_permission(permission) THEN RAISE EXCEPTION 'Permission insuffisante pour ce changement de statut'; END IF;
 END IF;
 IF (NEW.paiement_date,NEW.paiement_montant) IS DISTINCT FROM (OLD.paiement_date,OLD.paiement_montant) OR (NEW.statut='paye' AND OLD.statut<>'paye') THEN RAISE EXCEPTION 'Utilisez la commande de confirmation du paiement'; END IF;
 IF (NEW.devis_total,NEW.devis_transport,NEW.devis_om,NEW.devis_omr,NEW.devis_tva,NEW.devis_snapshot,NEW.quote_version,NEW.poids_facturable,NEW.payplug_payment_id,NEW.payplug_payment_url) IS DISTINCT FROM (OLD.devis_total,OLD.devis_transport,OLD.devis_om,OLD.devis_omr,OLD.devis_tva,OLD.devis_snapshot,OLD.quote_version,OLD.poids_facturable,OLD.payplug_payment_id,OLD.payplug_payment_url) THEN RAISE EXCEPTION 'Utilisez save_quote pour calculer un devis et le service de paiement pour créer son lien'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_colis_permissions BEFORE UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION guard_colis_permissions();
CREATE OR REPLACE FUNCTION complete_password_change() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ UPDATE staff_users SET must_change_password=false WHERE auth_id=auth.uid(); $$;
REVOKE ALL ON FUNCTION complete_password_change() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION complete_password_change() TO authenticated;
CREATE OR REPLACE FUNCTION fn_calcul_poids_facturable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE divisor numeric;
BEGIN
 SELECT coalesce((value->>'diviseurVolumetrique')::numeric,5000) INTO divisor FROM app_settings WHERE key='business';divisor:=coalesce(divisor,5000);
 IF divisor<=0 THEN RAISE EXCEPTION 'Diviseur volumétrique invalide'; END IF;
 IF NEW.fin_l IS NOT NULL AND NEW.fin_w IS NOT NULL AND NEW.fin_h IS NOT NULL AND NEW.fin_p IS NOT NULL THEN NEW.poids_facturable:=greatest(NEW.fin_p,NEW.fin_l*NEW.fin_w*NEW.fin_h/divisor); END IF;
 RETURN NEW;
END; $$;
