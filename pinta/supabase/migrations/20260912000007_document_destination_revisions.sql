ALTER TABLE factures ADD COLUMN IF NOT EXISTS replaces_facture_id uuid REFERENCES factures(id);
CREATE UNIQUE INDEX IF NOT EXISTS factures_one_replacement ON factures(replaces_facture_id) WHERE replaces_facture_id IS NOT NULL;
CREATE FUNCTION guard_invoice_replacement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE original factures;
BEGIN
 IF TG_OP='UPDATE' AND NEW.replaces_facture_id IS DISTINCT FROM OLD.replaces_facture_id THEN RAISE EXCEPTION 'Le lien de remplacement est figé après le dépôt'; END IF;
 IF NEW.replaces_facture_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.replaces_facture_id IS NOT DISTINCT FROM OLD.replaces_facture_id THEN RETURN NEW; END IF;
 SELECT * INTO original FROM factures WHERE id=NEW.replaces_facture_id FOR UPDATE;
 IF NOT FOUND OR original.colis_id<>NEW.colis_id OR original.id=NEW.id OR original.rejet_motif IS NULL THEN RAISE EXCEPTION 'Choisissez une facture rejetée de ce même dossier'; END IF;
 IF EXISTS(SELECT 1 FROM colis WHERE id=NEW.colis_id AND paiement_date IS NOT NULL) THEN RAISE EXCEPTION 'Les documents du devis payé sont figés'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_invoice_replacement BEFORE INSERT OR UPDATE OF replaces_facture_id ON factures FOR EACH ROW EXECUTE FUNCTION guard_invoice_replacement();

CREATE FUNCTION invalidate_modern_quotes_on_client_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF (left(NEW.cp,3),NEW.type) IS NOT DISTINCT FROM (left(OLD.cp,3),OLD.type) THEN RETURN NEW; END IF;
 UPDATE colis SET devis_total=NULL,devis_snapshot=NULL,devis_brouillon=true,payplug_payment_id=NULL,payplug_payment_url=NULL,
  statut=CASE WHEN statut IN ('devis_envoye','attente_paiement') THEN 'en_preparation'::statut_colis ELSE statut END
 WHERE client_id=NEW.id AND paiement_date IS NULL AND (devis_total IS NOT NULL OR devis_snapshot IS NOT NULL OR payplug_payment_url IS NOT NULL);
 RETURN NEW;
END; $$;
CREATE TRIGGER invalidate_modern_quotes_on_client_change AFTER UPDATE OF cp,type ON clients FOR EACH ROW EXECUTE FUNCTION invalidate_modern_quotes_on_client_change();

-- Expose physical prepared units while retaining the existing safe financial projection.
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
 statut_updated_at,conversation_statut,conversation_version,conversation_updated_at,conversation_opened_at,conversation_resolved_at,demande_feu_vert_envoyee_at,
 final_packages,final_measurements_at,final_measurements_version,preparation_composition_version,outgoing_parcel_count
 FROM colis WHERE client_id=auth_client_id();

-- Recompute initial action eligibility after adding physical preparation freshness fields.
SELECT sync_staff_work_actions(id) FROM colis WHERE NOT archive;
