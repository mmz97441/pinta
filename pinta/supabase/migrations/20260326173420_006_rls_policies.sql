-- Migration: 006_rls_policies
-- Version: 20260326173420
-- Pulled from Supabase project bqprktzehuhplpqjgjaz on 2026-05-18


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 6 : Row Level Security                                   ║
-- ║                                                                      ║
-- ║  directeur/vice_directeur → accès total                             ║
-- ║  logisticien → colis R/W, envois CRUD, clients R                    ║
-- ║  preparateur → colis R/W (champs physiques), pas tarifs/CA          ║
-- ║  client → uniquement SES colis, SES notifs, SES messages            ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Helper : récupérer le rôle de l'utilisateur courant
CREATE OR REPLACE FUNCTION auth_role()
RETURNS role_utilisateur AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper : vérifier si l'utilisateur est staff (non client)
CREATE OR REPLACE FUNCTION is_staff()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('directeur', 'vice_directeur', 'logisticien', 'preparateur')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper : vérifier si direction
CREATE OR REPLACE FUNCTION is_direction()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('directeur', 'vice_directeur')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper : récupérer le client_id lié au user courant
CREATE OR REPLACE FUNCTION auth_client_id()
RETURNS UUID AS $$
  SELECT id FROM clients WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════
-- PROFILES
-- ═══════════════════════════════════════════════
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles: staff voit tout"
  ON profiles FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Profiles: client voit son profil"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Profiles: chacun modifie son profil"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ═══════════════════════════════════════════════
-- CLIENTS
-- ═══════════════════════════════════════════════
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients: staff voit tout"
  ON clients FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Clients: client voit sa fiche"
  ON clients FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Clients: direction CRUD"
  ON clients FOR ALL TO authenticated
  USING (is_direction())
  WITH CHECK (is_direction());

CREATE POLICY "Clients: staff crée"
  ON clients FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY "Clients: staff modifie"
  ON clients FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

-- ═══════════════════════════════════════════════
-- COLIS
-- ═══════════════════════════════════════════════
ALTER TABLE colis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Colis: staff voit tout"
  ON colis FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Colis: client voit ses colis"
  ON colis FOR SELECT TO authenticated
  USING (client_id = auth_client_id());

CREATE POLICY "Colis: staff crée"
  ON colis FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY "Colis: staff modifie"
  ON colis FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY "Colis: client donne feu vert"
  ON colis FOR UPDATE TO authenticated
  USING (client_id = auth_client_id() AND statut = 'attente_feu_vert')
  WITH CHECK (client_id = auth_client_id());

-- ═══════════════════════════════════════════════
-- ENVOIS
-- ═══════════════════════════════════════════════
ALTER TABLE envois ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Envois: staff voit"
  ON envois FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Envois: logisticien+ CRUD"
  ON envois FOR ALL TO authenticated
  USING (auth_role() IN ('directeur', 'vice_directeur', 'logisticien'))
  WITH CHECK (auth_role() IN ('directeur', 'vice_directeur', 'logisticien'));

-- ═══════════════════════════════════════════════
-- FACTURES
-- ═══════════════════════════════════════════════
ALTER TABLE factures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Factures: staff voit"
  ON factures FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Factures: staff CRUD"
  ON factures FOR ALL TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY "Factures: client voit ses factures"
  ON factures FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM colis c WHERE c.id = factures.colis_id AND c.client_id = auth_client_id()));

-- ═══════════════════════════════════════════════
-- LIGNES
-- ═══════════════════════════════════════════════
ALTER TABLE lignes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lignes: staff voit"
  ON lignes FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Lignes: staff CRUD"
  ON lignes FOR ALL TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

-- ═══════════════════════════════════════════════
-- MESSAGES
-- ═══════════════════════════════════════════════
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Messages: staff voit tout"
  ON messages FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Messages: client voit ses messages"
  ON messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM colis c WHERE c.id = messages.colis_id AND c.client_id = auth_client_id()));

CREATE POLICY "Messages: staff envoie"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY "Messages: client envoie"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM colis c WHERE c.id = colis_id AND c.client_id = auth_client_id()));

-- ═══════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Notifs: user voit ses notifs"
  ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Notifs: user marque lu"
  ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Notifs: system crée"
  ON notifications FOR INSERT TO authenticated
  WITH CHECK (is_staff());

-- ═══════════════════════════════════════════════
-- PAIEMENTS
-- ═══════════════════════════════════════════════
ALTER TABLE paiements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Paiements: direction voit"
  ON paiements FOR SELECT TO authenticated
  USING (is_direction());

CREATE POLICY "Paiements: client voit ses paiements"
  ON paiements FOR SELECT TO authenticated
  USING (client_id = auth_client_id());

CREATE POLICY "Paiements: staff gère"
  ON paiements FOR ALL TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

-- ═══════════════════════════════════════════════
-- LOGS STATUT (lecture seule sauf insert auto)
-- ═══════════════════════════════════════════════
ALTER TABLE logs_statut ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Logs: staff voit"
  ON logs_statut FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Logs: client voit ses logs"
  ON logs_statut FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM colis c WHERE c.id = logs_statut.colis_id AND c.client_id = auth_client_id()));

-- ═══════════════════════════════════════════════
-- ALERTES
-- ═══════════════════════════════════════════════
ALTER TABLE alertes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Alertes: direction voit"
  ON alertes FOR SELECT TO authenticated
  USING (auth_role() IN ('directeur', 'vice_directeur'));

CREATE POLICY "Alertes: direction gère"
  ON alertes FOR UPDATE TO authenticated
  USING (is_direction())
  WITH CHECK (is_direction());

-- ═══════════════════════════════════════════════
-- TABLES DE RÉFÉRENCE (lecture par tous, écriture direction)
-- ═══════════════════════════════════════════════
ALTER TABLE destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE taux_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarifs ENABLE ROW LEVEL SECURITY;
ALTER TABLE adresses_livraison ENABLE ROW LEVEL SECURITY;
ALTER TABLE com_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Destinations: tous lisent" ON destinations FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Destinations: direction modifie" ON destinations FOR ALL TO authenticated USING (is_direction()) WITH CHECK (is_direction());

CREATE POLICY "Categories: tous lisent" ON categories FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Categories: direction modifie" ON categories FOR ALL TO authenticated USING (is_direction()) WITH CHECK (is_direction());

CREATE POLICY "Taux: tous lisent" ON taux_categories FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Taux: direction modifie" ON taux_categories FOR ALL TO authenticated USING (is_direction()) WITH CHECK (is_direction());

CREATE POLICY "Tarifs: staff lit" ON tarifs FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "Tarifs: direction modifie" ON tarifs FOR ALL TO authenticated USING (is_direction()) WITH CHECK (is_direction());

CREATE POLICY "Adresses: client gère ses adresses" ON adresses_livraison FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = adresses_livraison.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.id = client_id AND c.user_id = auth.uid()));

CREATE POLICY "Adresses: staff voit" ON adresses_livraison FOR SELECT TO authenticated USING (is_staff());

CREATE POLICY "ComLog: staff voit" ON com_log FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "ComLog: staff crée" ON com_log FOR INSERT TO authenticated WITH CHECK (is_staff());
