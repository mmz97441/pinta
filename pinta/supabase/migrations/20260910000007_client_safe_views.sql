-- Never return staff notes or draft quotes through the client's API.
CREATE OR REPLACE FUNCTION owns_colis(p_colis_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM colis WHERE id=p_colis_id AND client_id=auth_client_id()) $$;
CREATE VIEW client_clients WITH (security_barrier=true) AS
 SELECT id,user_id,ref,nom,prenom,genre,date_naissance,ville,adresse,adresse_ligne1,adresse_ligne2,commune,infos_livraison,cp,tel,tel_fixe,email,canal,type,mode_paiement,points,onboarded,created_at,updated_at,abonnement,abonnement_debut,abonnement_fin,methode_paiement,telegram_chat_id,telegram_username,raison_sociale,siret,interlocuteur FROM clients WHERE user_id=auth.uid();
CREATE VIEW client_colis WITH (security_barrier=true) AS
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
 quote_version,devis_envoye_le,paiement_montant,paiement_date,envoi_id,date_expedition,date_livraison,photo_reception_url,photo_prep,archive,created_at,updated_at
 FROM colis WHERE client_id=auth_client_id();
REVOKE ALL ON client_clients,client_colis FROM PUBLIC,anon;
GRANT SELECT ON client_clients,client_colis TO authenticated;
DROP POLICY IF EXISTS "Clients: client voit sa fiche" ON clients;
DROP POLICY IF EXISTS "Clients: client modifie ses coordonnées" ON clients;
DROP POLICY IF EXISTS "Colis: client voit ses colis" ON colis;
DROP POLICY IF EXISTS "Factures: client voit ses factures" ON factures;
DROP POLICY IF EXISTS "Factures: client dépose" ON factures;
DROP POLICY IF EXISTS "Lignes: client voit ses lignes" ON lignes;
DROP POLICY IF EXISTS "Messages: client voit ses messages" ON messages;
DROP POLICY IF EXISTS "Messages: client écrit en son nom" ON messages;
DROP POLICY IF EXISTS "Logs: client voit ses logs" ON logs_statut;
CREATE POLICY "Factures: client lecture sûre" ON factures FOR SELECT TO authenticated USING(owns_colis(colis_id));
CREATE POLICY "Factures: client dépôt sûr" ON factures FOR INSERT TO authenticated WITH CHECK(valide=false AND owns_colis(colis_id));
CREATE POLICY "Lignes: client lecture sûre" ON lignes FOR SELECT TO authenticated USING(owns_colis(colis_id));
CREATE POLICY "Messages: client lecture sûre" ON messages FOR SELECT TO authenticated USING(owns_colis(colis_id));
CREATE POLICY "Messages: client écriture sûre" ON messages FOR INSERT TO authenticated WITH CHECK(type='client' AND auteur_id=auth.uid() AND owns_colis(colis_id));
-- Status logs can contain internal metadata. Client tracking is derived from safe status fields.
DROP POLICY IF EXISTS "quotes_read" ON quote_versions;
CREATE POLICY "quotes_read" ON quote_versions FOR SELECT TO authenticated USING(is_staff());
DROP POLICY IF EXISTS "intents_read" ON payment_intents;
CREATE POLICY "intents_read" ON payment_intents FOR SELECT TO authenticated USING(is_staff());
DROP POLICY IF EXISTS "Dossier files read" ON storage.objects;
DROP POLICY IF EXISTS "Dossier files upload" ON storage.objects;
CREATE POLICY "Dossier files read" ON storage.objects FOR SELECT TO authenticated USING(bucket_id IN ('factures','photos-colis') AND (is_staff() OR CASE WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN owns_colis(((storage.foldername(name))[1])::uuid) ELSE false END));
CREATE POLICY "Dossier files upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id IN ('factures','photos-colis') AND CASE WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (is_staff() OR (bucket_id='factures' AND owns_colis(((storage.foldername(name))[1])::uuid))) ELSE false END);
CREATE OR REPLACE FUNCTION update_client_profile(p_changes jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c clients; modified clients; result jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN ('nom','prenom','tel','tel_fixe','email','ville','adresse','adresse_ligne1','adresse_ligne2','commune','infos_livraison','cp','genre','date_naissance','canal','onboarded')) THEN RAISE EXCEPTION 'Seules les coordonnées peuvent être modifiées'; END IF;
 SELECT * INTO c FROM clients WHERE id=auth_client_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche client introuvable'; END IF;
 modified:=jsonb_populate_record(c,p_changes);
 UPDATE clients SET nom=modified.nom,prenom=modified.prenom,tel=modified.tel,tel_fixe=modified.tel_fixe,email=modified.email,ville=modified.ville,adresse=modified.adresse,adresse_ligne1=modified.adresse_ligne1,adresse_ligne2=modified.adresse_ligne2,commune=modified.commune,infos_livraison=modified.infos_livraison,cp=modified.cp,genre=modified.genre,date_naissance=modified.date_naissance,canal=modified.canal,onboarded=modified.onboarded WHERE id=c.id;
 SELECT to_jsonb(v) INTO result FROM client_clients v WHERE id=c.id; RETURN result;
END; $$;
REVOKE ALL ON FUNCTION update_client_profile(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION update_client_profile(jsonb) TO authenticated;
DROP FUNCTION client_decision(uuid,text,timestamptz,timestamptz,text);
CREATE FUNCTION client_decision(p_colis_id uuid,p_action text,p_expected_updated_at timestamptz DEFAULT NULL,p_wait_until timestamptz DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis;result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM colis WHERE id=p_colis_id AND (client_id=auth_client_id() OR has_permission('perm_colis_valider_feuvert'))) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
 c:=_apply_client_decision(p_colis_id,p_action,p_expected_updated_at,p_wait_until,p_reason,coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),'Client'));
 IF is_staff() THEN RETURN to_jsonb(c); END IF;
 SELECT to_jsonb(v) INTO result FROM client_colis v WHERE id=c.id;RETURN result;
END; $$;
REVOKE ALL ON FUNCTION client_decision(uuid,text,timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION client_decision(uuid,text,timestamptz,timestamptz,text) TO authenticated;

-- Uploaded objects are immutable from the browser; replace with a new object path.
DROP POLICY IF EXISTS "Dossier files update" ON storage.objects;
