-- Additive completion of the application schema. No customer data is deleted.
ALTER TABLE clients ALTER COLUMN canal SET DEFAULT 'telegram';
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS ref text,
  ADD COLUMN IF NOT EXISTS genre text,
  ADD COLUMN IF NOT EXISTS date_naissance date,
  ADD COLUMN IF NOT EXISTS adresse_ligne1 text,
  ADD COLUMN IF NOT EXISTS adresse_ligne2 text,
  ADD COLUMN IF NOT EXISTS commune text,
  ADD COLUMN IF NOT EXISTS infos_livraison text,
  ADD COLUMN IF NOT EXISTS tel_fixe text,
  ADD COLUMN IF NOT EXISTS mode_paiement text DEFAULT 'colis',
  ADD COLUMN IF NOT EXISTS abonnement text DEFAULT 'freemium',
  ADD COLUMN IF NOT EXISTS abonnement_debut date,
  ADD COLUMN IF NOT EXISTS abonnement_fin date,
  ADD COLUMN IF NOT EXISTS methode_paiement text,
  ADD COLUMN IF NOT EXISTS telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS telegram_username text,
  ADD COLUMN IF NOT EXISTS raison_sociale text,
  ADD COLUMN IF NOT EXISTS siret text,
  ADD COLUMN IF NOT EXISTS interlocuteur text;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS code_hs text;
ALTER TABLE colis
  ADD COLUMN IF NOT EXISTS trackings_detail jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS casier_historique jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS tags_preparation jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS notes_reception text,
  ADD COLUMN IF NOT EXISTS commentaire_preparation text,
  ADD COLUMN IF NOT EXISTS frais_divers jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS mode_paiement_pro text,
  ADD COLUMN IF NOT EXISTS photo_reception boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS archive boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payplug_payment_id text,
  ADD COLUMN IF NOT EXISTS payplug_payment_url text,
  ADD COLUMN IF NOT EXISTS attente_client_until timestamptz,
  ADD COLUMN IF NOT EXISTS responsible_staff_id uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS next_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS demande_feu_vert_envoyee_at timestamptz,
  ADD COLUMN IF NOT EXISTS quote_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS devis_snapshot jsonb;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS rejet_motif text, ADD COLUMN IF NOT EXISTS telegram_msg_id text;
ALTER TABLE lignes ADD COLUMN IF NOT EXISTS facture_id uuid REFERENCES factures(id) ON DELETE SET NULL;
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS telegram_msg_id text,
  ADD COLUMN IF NOT EXISTS msg_id text,
  ADD COLUMN IF NOT EXISTS lu boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS canal text DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS template text,
  ADD COLUMN IF NOT EXISTS request_snapshot jsonb;
CREATE TABLE IF NOT EXISTS staff_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_id uuid UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
 nom text NOT NULL, prenom text, email text NOT NULL, role role_utilisateur NOT NULL DEFAULT 'preparateur',
 actif boolean NOT NULL DEFAULT true, must_change_password boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid UNIQUE NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE);
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_receptionner boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_mesurer boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_modifier_dims boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_demander_feuvert boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_valider_feuvert boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_preparer boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_calculer_devis boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_envoyer_devis boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_confirmer_paiement boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_affecter_envoi boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_expedier boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_changer_statut_expedition boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_annuler boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_revenir_arriere boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_colis_archiver boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_clients_voir boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_clients_creer boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_clients_modifier boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_clients_supprimer boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_clients_modifier_abonnement boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_clients_voir_finances boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_factures_voir boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_factures_ajouter boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_factures_valider boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_factures_refuser boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_factures_ocr boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_factures_modifier_articles boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_comm_telegram boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_comm_email boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_comm_demander_facture boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_comm_message_libre boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_comm_voir_chat_autres boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_envois_voir boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_envois_creer boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_envois_modifier boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_envois_reaffecter boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_envois_etiquettes boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_finances_voir_transport boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_finances_voir_taxes boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_finances_voir_total boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_finances_voir_kpi boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_finances_exporter boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_finances_modifier_tarifs boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_export_colis boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_export_factures boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_export_dau boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_export_recap_pro boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_admin_utilisateurs boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_admin_categories boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_admin_templates boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_admin_produits_interdits boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_admin_audit boolean NOT NULL DEFAULT false;
ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS perm_admin_parametres boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION fn_default_permissions(p_role text) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_object_agg(k, CASE WHEN p_role IN ('directeur','vice_directeur') THEN true
   WHEN p_role='logisticien' THEN k NOT LIKE 'perm_admin_%' AND k NOT IN ('perm_clients_supprimer','perm_finances_voir_kpi','perm_clients_modifier_abonnement')
   WHEN p_role='preparateur' THEN k IN ('perm_colis_receptionner','perm_colis_mesurer','perm_colis_modifier_dims','perm_colis_demander_feuvert','perm_colis_preparer','perm_clients_voir','perm_clients_creer','perm_factures_voir','perm_factures_ajouter','perm_factures_ocr','perm_factures_modifier_articles','perm_comm_telegram','perm_comm_email','perm_comm_demander_facture','perm_comm_message_libre','perm_envois_voir')
   ELSE false END) FROM unnest(ARRAY['perm_colis_receptionner','perm_colis_mesurer','perm_colis_modifier_dims','perm_colis_demander_feuvert','perm_colis_valider_feuvert','perm_colis_preparer','perm_colis_calculer_devis','perm_colis_envoyer_devis','perm_colis_confirmer_paiement','perm_colis_affecter_envoi','perm_colis_expedier','perm_colis_changer_statut_expedition','perm_colis_annuler','perm_colis_revenir_arriere','perm_colis_archiver','perm_clients_voir','perm_clients_creer','perm_clients_modifier','perm_clients_supprimer','perm_clients_modifier_abonnement','perm_clients_voir_finances','perm_factures_voir','perm_factures_ajouter','perm_factures_valider','perm_factures_refuser','perm_factures_ocr','perm_factures_modifier_articles','perm_comm_telegram','perm_comm_email','perm_comm_demander_facture','perm_comm_message_libre','perm_comm_voir_chat_autres','perm_envois_voir','perm_envois_creer','perm_envois_modifier','perm_envois_reaffecter','perm_envois_etiquettes','perm_finances_voir_transport','perm_finances_voir_taxes','perm_finances_voir_total','perm_finances_voir_kpi','perm_finances_exporter','perm_finances_modifier_tarifs','perm_export_colis','perm_export_factures','perm_export_dau','perm_export_recap_pro','perm_admin_utilisateurs','perm_admin_categories','perm_admin_templates','perm_admin_produits_interdits','perm_admin_audit','perm_admin_parametres']) k;
$$;
INSERT INTO staff_users(auth_id,nom,prenom,email,role,actif,must_change_password)
 SELECT p.id,p.nom,p.prenom,coalesce(u.email,''),p.role,p.actif,false FROM profiles p JOIN auth.users u ON u.id=p.id WHERE p.role<>'client'
 ON CONFLICT(auth_id) DO NOTHING;
INSERT INTO staff_permissions SELECT (jsonb_populate_record(NULL::staff_permissions,
 fn_default_permissions(s.role::text) || jsonb_build_object('id',gen_random_uuid(),'staff_id',s.id))).* FROM staff_users s ON CONFLICT(staff_id) DO NOTHING;
-- Newly reconstructed permission rows receive role defaults; existing configured rows remain unchanged.

CREATE TABLE IF NOT EXISTS audit_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), colis_id uuid REFERENCES colis(id) ON DELETE CASCADE,
 user_id uuid REFERENCES profiles(id), user_nom text, action text NOT NULL, detail text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS colis_locks (
 colis_id uuid PRIMARY KEY REFERENCES colis(id) ON DELETE CASCADE,
 staff_id uuid NOT NULL REFERENCES profiles(id), staff_nom text NOT NULL, locked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES profiles(id));
CREATE TABLE IF NOT EXISTS message_templates (key text NOT NULL,canal text NOT NULL CHECK(canal IN ('telegram','email','portal')),body text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES profiles(id),PRIMARY KEY(key,canal));
CREATE TABLE IF NOT EXISTS quote_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),colis_id uuid NOT NULL REFERENCES colis(id),version integer NOT NULL,
 snapshot jsonb NOT NULL,total numeric(10,2) NOT NULL CHECK(total>0),created_by uuid REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(colis_id,version)
);
CREATE TABLE IF NOT EXISTS payment_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),colis_id uuid NOT NULL REFERENCES colis(id),quote_version integer NOT NULL,
 provider_id text UNIQUE,payment_url text,amount_cents integer NOT NULL CHECK(amount_cents>0),currency text NOT NULL DEFAULT 'EUR',
 status text NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','pending','paid','failed','superseded')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(colis_id,quote_version)
);
ALTER TABLE paiements ADD COLUMN IF NOT EXISTS provider_id text,ADD COLUMN IF NOT EXISTS quote_version integer;
CREATE UNIQUE INDEX IF NOT EXISTS paiements_provider_unique ON paiements(provider_id) WHERE provider_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid NOT NULL REFERENCES messages(id),client_id uuid NOT NULL REFERENCES clients(id),
 colis_id uuid NOT NULL REFERENCES colis(id),quote_version integer,canal text NOT NULL,reply_markup jsonb,idempotency_key text UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','manual','cancelled')),
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),locked_at timestamptz,last_error text,sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending ON notification_outbox(available_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS telegram_invitations (token text PRIMARY KEY,client_id uuid NOT NULL REFERENCES clients(id),expires_at timestamptz NOT NULL,used_at timestamptz,created_by uuid REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS telegram_updates (update_id bigint PRIMARY KEY,status text NOT NULL DEFAULT 'processing',locked_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz);
CREATE TABLE IF NOT EXISTS ocr_extractions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),facture_id uuid NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
 document_hash text NOT NULL,status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','confirmed')),
 vendeur text,total numeric(10,2),lines jsonb NOT NULL,warnings jsonb NOT NULL DEFAULT '[]',
 confirmed_at timestamptz,confirmed_by uuid REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(facture_id,document_hash)
);
ALTER TABLE lignes ADD COLUMN IF NOT EXISTS ocr_extraction_id uuid REFERENCES ocr_extractions(id);
CREATE INDEX IF NOT EXISTS messages_recent ON messages(colis_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS colis_responsible_action ON colis(responsible_staff_id,next_action_at) WHERE archive=false;
CREATE INDEX IF NOT EXISTS clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS clients_telegram_chat_id ON clients(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- Canonical role is administrator-managed profiles.role, never user_metadata.
CREATE OR REPLACE FUNCTION fn_handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN INSERT INTO profiles(id,nom,prenom,role) VALUES(NEW.id,coalesce(NEW.raw_user_meta_data->>'nom',NEW.email,'Utilisateur'),NEW.raw_user_meta_data->>'prenom','client'); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION auth_role() RETURNS role_utilisateur LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$ SELECT role FROM profiles WHERE id=auth.uid() AND actif=true $$;
CREATE OR REPLACE FUNCTION is_staff() RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$ SELECT coalesce(auth_role()<>'client',false) $$;
CREATE OR REPLACE FUNCTION is_direction() RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$ SELECT coalesce(auth_role() IN ('directeur','vice_directeur'),false) $$;
CREATE OR REPLACE FUNCTION auth_client_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$ SELECT id FROM clients WHERE user_id=auth.uid() LIMIT 1 $$;
CREATE OR REPLACE FUNCTION has_permission(p_key text) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
 SELECT is_staff() AND (is_direction() OR EXISTS(SELECT 1 FROM staff_users s JOIN staff_permissions p ON p.staff_id=s.id WHERE s.auth_id=auth.uid() AND s.actif AND coalesce((to_jsonb(p)->>p_key)::boolean,false))); $$;
CREATE OR REPLACE FUNCTION guard_profile_security() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF auth.role()<>'service_role' AND current_user NOT IN ('postgres','supabase_admin') AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.actif IS DISTINCT FROM OLD.actif OR NEW.id IS DISTINCT FROM OLD.id) THEN RAISE EXCEPTION 'Profil: modification administrative requise'; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER guard_profile_security BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_security();
CREATE OR REPLACE FUNCTION sync_staff_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN UPDATE profiles SET role='client',actif=false WHERE id=OLD.auth_id; RETURN OLD; END IF;
 IF NEW.role='client' THEN RAISE EXCEPTION 'Rôle équipe invalide'; END IF;
 -- Historical installations store staff_users.role as constrained TEXT.
 UPDATE profiles SET role=NEW.role::text::role_utilisateur,actif=NEW.actif WHERE id=NEW.auth_id; RETURN NEW;
END; $$;
CREATE TRIGGER sync_staff_profile AFTER INSERT OR UPDATE OF role,actif OR DELETE ON staff_users FOR EACH ROW EXECUTE FUNCTION sync_staff_profile();
UPDATE profiles p SET role=s.role::text::role_utilisateur,actif=s.actif FROM staff_users s WHERE p.id=s.auth_id;
DROP POLICY IF EXISTS "Colis: client donne feu vert" ON colis;
DROP POLICY IF EXISTS "Messages: client envoie" ON messages;
CREATE POLICY "Messages: client écrit en son nom" ON messages FOR INSERT TO authenticated WITH CHECK(type='client' AND auteur_id=auth.uid() AND EXISTS(SELECT 1 FROM colis c WHERE c.id=colis_id AND c.client_id=auth_client_id()));
CREATE POLICY "Messages: staff marque lu" ON messages FOR UPDATE TO authenticated USING(is_staff()) WITH CHECK(is_staff());
CREATE POLICY "Lignes: client voit ses lignes" ON lignes FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM colis c WHERE c.id=colis_id AND c.client_id=auth_client_id()));
CREATE POLICY "Factures: client dépose" ON factures FOR INSERT TO authenticated WITH CHECK(valide=false AND EXISTS(SELECT 1 FROM colis c WHERE c.id=colis_id AND c.client_id=auth_client_id()));
CREATE POLICY "Clients: client modifie ses coordonnées" ON clients FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE OR REPLACE FUNCTION guard_client_fields() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF auth.role()='authenticated' AND NOT is_staff() AND
 (to_jsonb(NEW)-ARRAY['nom','prenom','tel','tel_fixe','email','ville','adresse','adresse_ligne1','adresse_ligne2','commune','infos_livraison','cp','genre','date_naissance','canal','onboarded','updated_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['nom','prenom','tel','tel_fixe','email','ville','adresse','adresse_ligne1','adresse_ligne2','commune','infos_livraison','cp','genre','date_naissance','canal','onboarded','updated_at']) THEN RAISE EXCEPTION 'Seules les coordonnées peuvent être modifiées'; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER guard_client_fields BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION guard_client_fields();
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE colis_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings_read" ON app_settings FOR SELECT TO authenticated USING(true);
CREATE POLICY "app_settings_manage" ON app_settings FOR ALL TO authenticated USING(is_direction()) WITH CHECK(is_direction());
CREATE POLICY "message_templates_read" ON message_templates FOR SELECT TO authenticated USING(true);
CREATE POLICY "message_templates_manage" ON message_templates FOR ALL TO authenticated USING(is_direction()) WITH CHECK(is_direction());
CREATE POLICY "staff_users_read" ON staff_users FOR SELECT TO authenticated USING(is_staff());
CREATE POLICY "staff_users_manage" ON staff_users FOR ALL TO authenticated USING(is_direction()) WITH CHECK(is_direction());
CREATE POLICY "staff_permissions_read" ON staff_permissions FOR SELECT TO authenticated USING(is_staff());
CREATE POLICY "staff_permissions_manage" ON staff_permissions FOR ALL TO authenticated USING(is_direction()) WITH CHECK(is_direction());
CREATE POLICY "audit_actions_read" ON audit_actions FOR SELECT TO authenticated USING(is_staff());
CREATE POLICY "colis_locks_read" ON colis_locks FOR SELECT TO authenticated USING(is_staff());
CREATE POLICY "notification_outbox_read" ON notification_outbox FOR SELECT TO authenticated USING(is_staff());
CREATE POLICY "ocr_extractions_read" ON ocr_extractions FOR SELECT TO authenticated USING(is_staff());
CREATE POLICY "audit_actions_insert" ON audit_actions FOR INSERT TO authenticated WITH CHECK(is_staff() AND (user_id IS NULL OR user_id=auth.uid()));
CREATE POLICY "quotes_read" ON quote_versions FOR SELECT TO authenticated USING(is_staff() OR EXISTS(SELECT 1 FROM colis c WHERE c.id=colis_id AND c.client_id=auth_client_id()));
CREATE POLICY "intents_read" ON payment_intents FOR SELECT TO authenticated USING(is_staff() OR EXISTS(SELECT 1 FROM colis c WHERE c.id=colis_id AND c.client_id=auth_client_id()));
-- Storage is private. Existing database URLs remain parseable; clients request temporary signed URLs.
INSERT INTO storage.buckets(id,name,public) VALUES('factures','factures',false),('photos-colis','photos-colis',false) ON CONFLICT(id) DO UPDATE SET public=false;
DROP POLICY IF EXISTS "Factures upload" ON storage.objects;
DROP POLICY IF EXISTS "Factures update" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload photos-colis" ON storage.objects;
CREATE POLICY "Dossier files read" ON storage.objects FOR SELECT TO authenticated USING(bucket_id IN ('factures','photos-colis') AND (is_staff() OR EXISTS(SELECT 1 FROM colis c WHERE c.id::text=(storage.foldername(name))[1] AND c.client_id=auth_client_id())));
CREATE POLICY "Dossier files upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id IN ('factures','photos-colis') AND EXISTS(SELECT 1 FROM colis c WHERE c.id::text=(storage.foldername(name))[1] AND (is_staff() OR (bucket_id='factures' AND c.client_id=auth_client_id()))));
CREATE POLICY "Dossier files update" ON storage.objects FOR UPDATE TO authenticated USING(bucket_id IN ('factures','photos-colis') AND is_staff()) WITH CHECK(bucket_id IN ('factures','photos-colis') AND is_staff());
-- Values already displayed in the existing application, now persisted and consumed.
INSERT INTO app_settings(key,value) VALUES('business','{"fraisStockage":"1.50","stockageGratuit":"14","relancesFeuVert":"J+2,J+5,J+7","relancesPaiement":"J+3,J+7,J+14","diviseurVolumetrique":"5000","timezone":"Europe/Paris"}') ON CONFLICT(key) DO NOTHING;
