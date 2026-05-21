-- Migration: 001_types_enums_core_tables
-- Version: 20260326172652
-- Pulled from Supabase project bqprktzehuhplpqjgjaz on 2026-05-18


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  EXPEDÎLE — Schéma complet v1                                       ║
-- ║  Migration 1 : Types, enums, tables fondamentales                   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ══════════ ENUMS ══════════

CREATE TYPE role_utilisateur AS ENUM (
  'directeur',
  'vice_directeur',
  'logisticien',
  'preparateur',
  'client'
);

CREATE TYPE statut_colis AS ENUM (
  'receptionne',
  'mesure',
  'attente_feu_vert',
  'autorise',
  'refuse_client',
  'en_preparation',
  'devis_envoye',
  'attente_paiement',
  'paye',
  'expedie',
  'transit',
  'arrive',
  'livraison',
  'livre',
  'annule'
);

CREATE TYPE statut_feu_vert AS ENUM ('en_attente', 'autorise', 'refuse');
CREATE TYPE canal_communication AS ENUM ('whatsapp', 'email', 'sms');
CREATE TYPE type_client AS ENUM ('particulier', 'pro');
CREATE TYPE statut_envoi AS ENUM ('planifie', 'prochain', 'en_cours', 'parti', 'arrive');
CREATE TYPE statut_paiement AS ENUM ('en_attente', 'confirme', 'echoue', 'rembourse');
CREATE TYPE type_message AS ENUM ('staff', 'client', 'system');
CREATE TYPE statut_message AS ENUM ('envoi', 'envoye', 'distribue', 'lu', 'echec');

-- ══════════ PROFILES ══════════
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role          role_utilisateur NOT NULL DEFAULT 'client',
  nom           TEXT NOT NULL,
  prenom        TEXT,
  tel           TEXT,
  avatar_url    TEXT,
  actif         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE profiles IS 'Profils utilisateurs (staff + clients authentifiés)';

-- ══════════ DESTINATIONS DOM-TOM ══════════
CREATE TABLE destinations (
  code          TEXT PRIMARY KEY,
  nom           TEXT NOT NULL,
  flag          TEXT,
  tva           NUMERIC(5,2) NOT NULL DEFAULT 8.5,
  has_om        BOOLEAN NOT NULL DEFAULT TRUE,
  taxe_conso    NUMERIC(5,2) NOT NULL DEFAULT 0,
  actif         BOOLEAN NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE destinations IS 'Territoires DOM-TOM desservis';

-- ══════════ CLIENTS ══════════
CREATE TABLE clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  nom           TEXT NOT NULL,
  prenom        TEXT,
  ville         TEXT,
  adresse       TEXT,
  cp            TEXT NOT NULL,
  tel           TEXT,
  email         TEXT,
  canal         canal_communication NOT NULL DEFAULT 'whatsapp',
  type          type_client NOT NULL DEFAULT 'particulier',
  points        INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  onboarded     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE clients IS 'Entité métier client — peut exister sans compte auth';
COMMENT ON COLUMN clients.cp IS 'Code postal — les 3 premiers chiffres déterminent la destination';

-- ══════════ ADRESSES LIVRAISON ══════════
CREATE TABLE adresses_livraison (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label         TEXT NOT NULL DEFAULT 'Domicile',
  adresse       TEXT NOT NULL,
  complement    TEXT,
  ville         TEXT NOT NULL,
  cp            TEXT NOT NULL,
  telephone     TEXT,
  par_defaut    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE adresses_livraison IS 'Adresses de livraison multiples par client';

-- ══════════ CATEGORIES PRODUITS ══════════
CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT NOT NULL UNIQUE,
  custom        BOOLEAN NOT NULL DEFAULT FALSE,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE categories IS 'Catégories produits pour calcul octroi de mer';

-- ══════════ TAUX PAR CATÉGORIE × DESTINATION ══════════
CREATE TABLE taux_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categorie_id      UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  destination_code  TEXT NOT NULL REFERENCES destinations(code) ON DELETE CASCADE,
  om                NUMERIC(5,2) NOT NULL DEFAULT 0,
  omr               NUMERIC(5,2) NOT NULL DEFAULT 0,
  UNIQUE(categorie_id, destination_code)
);
COMMENT ON TABLE taux_categories IS 'Taux OM/OMR par croisement catégorie × destination';

-- ══════════ TARIFS TRANSPORT ══════════
CREATE TABLE tarifs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_code  TEXT NOT NULL REFERENCES destinations(code) ON DELETE CASCADE,
  base              NUMERIC(10,2) NOT NULL,
  par_kg            NUMERIC(10,2) NOT NULL,
  actif             BOOLEAN NOT NULL DEFAULT TRUE,
  valide_depuis     DATE NOT NULL DEFAULT CURRENT_DATE,
  valide_jusqua     DATE,
  cree_par          UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE tarifs IS 'Grille tarifaire transport — historisée pour traçabilité';

CREATE UNIQUE INDEX idx_tarifs_actif_unique
  ON tarifs(destination_code) WHERE actif = TRUE;

-- Indexes fondamentaux
CREATE INDEX idx_clients_cp ON clients(cp);
CREATE INDEX idx_clients_user ON clients(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_clients_nom ON clients USING gin(to_tsvector('french', nom));
