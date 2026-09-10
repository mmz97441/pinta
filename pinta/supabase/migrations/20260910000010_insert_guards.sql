CREATE OR REPLACE FUNCTION guard_colis_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user IN ('postgres','supabase_admin') OR auth.role()='service_role' THEN RETURN NEW; END IF;
 IF NOT has_permission('perm_colis_receptionner') THEN RAISE EXCEPTION 'Permission réception requise'; END IF;
 IF NEW.statut NOT IN ('receptionne','mesure') OR NEW.feu_vert='autorise' OR NEW.devis_total IS NOT NULL OR NEW.devis_snapshot IS NOT NULL OR NEW.paiement_date IS NOT NULL OR NEW.paiement_montant IS NOT NULL OR NEW.payplug_payment_id IS NOT NULL OR NEW.quote_version<>0 THEN RAISE EXCEPTION 'Un nouveau dossier doit commencer à la réception, sans devis ni paiement'; END IF;
 NEW.cree_par:=auth.uid();RETURN NEW;
END; $$;
CREATE TRIGGER guard_colis_insert BEFORE INSERT ON colis FOR EACH ROW EXECUTE FUNCTION guard_colis_insert();
