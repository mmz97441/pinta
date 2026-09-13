DROP POLICY IF EXISTS "Paiements: staff gère" ON paiements;
CREATE POLICY "Paiements: staff autorisé lit" ON paiements FOR SELECT TO authenticated USING(has_permission('perm_colis_confirmer_paiement'));
CREATE OR REPLACE FUNCTION guard_document_permissions() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user IN ('postgres','supabase_admin') OR auth.role()='service_role' THEN IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END IF;
 IF TG_TABLE_NAME='lignes' AND NOT has_permission('perm_factures_modifier_articles') THEN RAISE EXCEPTION 'Permission modification articles requise'; END IF;
 IF TG_TABLE_NAME='factures' THEN
  IF TG_OP='INSERT' AND is_staff() AND NOT has_permission('perm_factures_ajouter') THEN RAISE EXCEPTION 'Permission ajout facture requise'; END IF;
  IF TG_OP='INSERT' AND NEW.valide AND NOT has_permission('perm_factures_valider') THEN RAISE EXCEPTION 'Permission validation facture requise'; END IF;
  IF TG_OP='UPDATE' AND (NEW.vendeur,NEW.montant,NEW.fichier_url) IS DISTINCT FROM (OLD.vendeur,OLD.montant,OLD.fichier_url) THEN
   IF NOT (has_permission('perm_factures_ajouter') OR has_permission('perm_factures_valider')) THEN RAISE EXCEPTION 'Permission modification facture requise'; END IF;
   IF NOT has_permission('perm_factures_valider') THEN NEW.valide:=false;NEW.valide_par:=NULL;NEW.valide_le:=NULL; END IF;
  END IF;
  IF TG_OP='UPDATE' AND NEW.valide AND NOT OLD.valide AND NOT has_permission('perm_factures_valider') THEN RAISE EXCEPTION 'Permission validation facture requise'; END IF;
  IF TG_OP='UPDATE' AND NEW.rejet_motif IS DISTINCT FROM OLD.rejet_motif AND NOT has_permission('perm_factures_refuser') THEN RAISE EXCEPTION 'Permission refus facture requise'; END IF;
  IF TG_OP='DELETE' AND NOT has_permission('perm_factures_refuser') THEN RAISE EXCEPTION 'Permission suppression facture requise'; END IF;
  IF TG_OP<>'DELETE' AND NEW.valide AND (coalesce(trim(NEW.fichier_url),'')='' OR NEW.montant<=0) THEN RAISE EXCEPTION 'Document et montant valides requis'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END; $$;
CREATE TRIGGER guard_document_permissions BEFORE INSERT OR UPDATE OR DELETE ON factures FOR EACH ROW EXECUTE FUNCTION guard_document_permissions();
CREATE TRIGGER guard_document_permissions BEFORE INSERT OR UPDATE OR DELETE ON lignes FOR EACH ROW EXECUTE FUNCTION guard_document_permissions();
CREATE OR REPLACE FUNCTION guard_staff_client_permissions() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user IN ('postgres','supabase_admin') OR auth.role()='service_role' THEN RETURN NEW; END IF;
 IF is_staff() AND NOT has_permission('perm_clients_modifier') THEN RAISE EXCEPTION 'Permission modification client requise'; END IF;
 IF is_staff() AND (NEW.abonnement,NEW.abonnement_debut,NEW.abonnement_fin) IS DISTINCT FROM (OLD.abonnement,OLD.abonnement_debut,OLD.abonnement_fin) AND NOT has_permission('perm_clients_modifier_abonnement') THEN RAISE EXCEPTION 'Permission abonnement requise'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_staff_client_permissions BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION guard_staff_client_permissions();
CREATE OR REPLACE FUNCTION revert_colis(p_colis_id uuid,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; target statut_colis;
BEGIN
 IF NOT has_permission('perm_colis_revenir_arriere') THEN RAISE EXCEPTION 'Permission correction requise'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable'; END IF;
 IF p_expected_updated_at IS NOT NULL AND c.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'Le dossier a changé. Rechargez-le.'; END IF;
 target:=(CASE c.statut::text WHEN 'mesure' THEN 'receptionne' WHEN 'attente_feu_vert' THEN 'mesure' WHEN 'autorise' THEN 'attente_feu_vert' WHEN 'en_preparation' THEN 'autorise' WHEN 'devis_envoye' THEN 'en_preparation' WHEN 'attente_paiement' THEN 'devis_envoye' WHEN 'expedie' THEN 'paye' WHEN 'transit' THEN 'expedie' WHEN 'dedouanement' THEN 'transit' WHEN 'arrive' THEN 'dedouanement' WHEN 'livraison' THEN 'arrive' ELSE NULL END)::statut_colis;
 IF target IS NULL THEN RAISE EXCEPTION 'Ce statut ne permet pas de retour arrière'; END IF;
 PERFORM set_config('expedile.revert','allowed',true);
 UPDATE colis SET statut=target,
  devis_total=CASE WHEN target IN ('receptionne','mesure','attente_feu_vert','autorise','en_preparation') THEN NULL ELSE devis_total END,
  devis_snapshot=CASE WHEN target IN ('receptionne','mesure','attente_feu_vert','autorise','en_preparation') THEN NULL ELSE devis_snapshot END,
  feu_vert=CASE WHEN target IN ('receptionne','mesure','attente_feu_vert') THEN 'en_attente'::statut_feu_vert ELSE feu_vert END
 WHERE id=c.id RETURNING * INTO c;
 PERFORM set_config('expedile.revert','',true);
 INSERT INTO audit_actions(colis_id,user_id,action,detail) VALUES(c.id,auth.uid(),'correction_statut','Retour contrôlé vers '||target::text);
 RETURN c;
END; $$;
REVOKE ALL ON FUNCTION revert_colis(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION revert_colis(uuid,timestamptz) TO authenticated;
