-- Migration: 002_colis_envois_operations
-- Version: 20260326172921
-- Pulled from Supabase project bqprktzehuhplpqjgjaz on 2026-05-18


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 2 : Colis, envois, tables opérationnelles + indexes      ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Séquences pour références auto-générées
CREATE SEQUENCE seq_colis_ref START WITH 1;
CREATE SEQUENCE seq_envoi_ref START WITH 1;

-- ══════════ ENVOIS ══════════
CREATE TABLE envois (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                 TEXT UNIQUE NOT NULL,
  destination_code    TEXT REFERENCES destinations(code),
  statut              statut_envoi NOT NULL DEFAULT 'planifie',
  date_depart         DATE,
  date_arrivee_prevue DATE,
  date_arrivee_reelle DATE,
  transporteur        TEXT,
  tracking_principal  TEXT,
  mode_transport      TEXT CHECK (mode_transport IN ('aerien', 'maritime')),
  nb_colis            INTEGER NOT NULL DEFAULT 0,
  poids_total         NUMERIC(10,2) NOT NULL DEFAULT 0,
  volume_total        NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  cree_par            UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE envois IS 'Lots d''expédition groupée vers une destination DOM-TOM';

-- ══════════ COLIS ══════════
CREATE TABLE colis (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                 TEXT UNIQUE NOT NULL,
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  statut              statut_colis NOT NULL DEFAULT 'receptionne',

  -- Identification
  desc_contenu        TEXT,
  valeur_declaree     NUMERIC(10,2),
  trackings           TEXT[] DEFAULT '{}',

  -- Entrepôt
  casier              TEXT,
  date_reception      TIMESTAMPTZ,
  receptionne_par     UUID REFERENCES profiles(id),
  photo_reception_url TEXT,
  produit_interdit    BOOLEAN NOT NULL DEFAULT FALSE,
  check_interdits     TEXT[] DEFAULT '{}',

  -- Dimensions brutes (à réception)
  dim_l               NUMERIC(8,2),
  dim_w               NUMERIC(8,2),
  dim_h               NUMERIC(8,2),
  poids               NUMERIC(8,2),
  nb_colis            INTEGER NOT NULL DEFAULT 1,
  dims_par_colis      JSONB,
  mesure_par          UUID REFERENCES profiles(id),
  mesure_le           TIMESTAMPTZ,

  -- Dimensions finales (après optimisation)
  fin_l               NUMERIC(8,2),
  fin_w               NUMERIC(8,2),
  fin_h               NUMERIC(8,2),
  fin_p               NUMERIC(8,2),
  poids_facturable    NUMERIC(8,2),
  prepare_par         UUID REFERENCES profiles(id),
  prepare_le          TIMESTAMPTZ,

  -- Feu vert client
  feu_vert            statut_feu_vert,
  feu_vert_date       TIMESTAMPTZ,
  feu_vert_commentaire TEXT,

  -- Estimations
  est_min             NUMERIC(10,2),
  est_max             NUMERIC(10,2),

  -- Devis final
  devis_brouillon     BOOLEAN NOT NULL DEFAULT FALSE,
  devis_transport     NUMERIC(10,2),
  devis_om            NUMERIC(10,2),
  devis_omr           NUMERIC(10,2),
  devis_tva           NUMERIC(10,2),
  devis_total         NUMERIC(10,2),
  avant_optim_transport NUMERIC(10,2),
  avant_optim_total   NUMERIC(10,2),
  economie            NUMERIC(10,2) DEFAULT 0,
  devis_envoye_le     TIMESTAMPTZ,
  devis_envoye_par    UUID REFERENCES profiles(id),

  -- Paiement (dénormalisé pour accès rapide)
  paiement_montant    NUMERIC(10,2),
  paiement_date       TIMESTAMPTZ,
  paiement_methode    TEXT,
  paiement_reference  TEXT,

  -- Expédition
  envoi_id            UUID REFERENCES envois(id) ON DELETE SET NULL,
  date_expedition     TIMESTAMPTZ,
  date_livraison      TIMESTAMPTZ,
  livre_a             TEXT,
  preuve_livraison_url TEXT,

  -- Interne
  urgence             BOOLEAN NOT NULL DEFAULT FALSE,
  notes_internes      TEXT,
  cree_par            UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Contraintes métier
  CONSTRAINT chk_dims_brutes CHECK (
    (dim_l IS NULL AND dim_w IS NULL AND dim_h IS NULL)
    OR (dim_l > 0 AND dim_w > 0 AND dim_h > 0)
  ),
  CONSTRAINT chk_dims_finales CHECK (
    (fin_l IS NULL AND fin_w IS NULL AND fin_h IS NULL)
    OR (fin_l > 0 AND fin_w > 0 AND fin_h > 0)
  ),
  CONSTRAINT chk_devis_positif CHECK (devis_total IS NULL OR devis_total >= 0),
  CONSTRAINT chk_paiement_positif CHECK (paiement_montant IS NULL OR paiement_montant > 0)
);
COMMENT ON TABLE colis IS 'Entité centrale — cycle réception → mesure → feu vert → préparation → devis → paiement → expédition → livraison';
COMMENT ON COLUMN colis.poids_facturable IS 'max(poids réel, poids volumétrique L×W×H/5000)';
COMMENT ON COLUMN colis.economie IS 'Gain en € grâce à l''optimisation emballage';

-- ══════════ FACTURES D'ACHAT ══════════
CREATE TABLE factures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colis_id      UUID NOT NULL REFERENCES colis(id) ON DELETE CASCADE,
  vendeur       TEXT,
  montant       NUMERIC(10,2) NOT NULL DEFAULT 0,
  devise        TEXT NOT NULL DEFAULT 'EUR',
  valide        BOOLEAN NOT NULL DEFAULT FALSE,
  fichier_url   TEXT,
  fichier_nom   TEXT,
  valide_par    UUID REFERENCES profiles(id),
  valide_le     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE factures IS 'Factures d''achat fournisseur — base du calcul OM/OMR';

-- ══════════ LIGNES ARTICLES ══════════
CREATE TABLE lignes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colis_id        UUID NOT NULL REFERENCES colis(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  qte             INTEGER NOT NULL DEFAULT 1 CHECK (qte > 0),
  prix_unitaire   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (prix_unitaire >= 0),
  categorie_id    UUID REFERENCES categories(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE lignes IS 'Articles du colis — la catégorie détermine les taux OM/OMR';

-- ══════════ PAIEMENTS ══════════
CREATE TABLE paiements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colis_id        UUID NOT NULL REFERENCES colis(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id),
  montant         NUMERIC(10,2) NOT NULL CHECK (montant != 0),
  methode         TEXT,
  reference       TEXT,
  statut          statut_paiement NOT NULL DEFAULT 'en_attente',
  confirme_par    UUID REFERENCES profiles(id),
  confirme_le     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE paiements IS 'Historique paiements et remboursements';
COMMENT ON COLUMN paiements.montant IS 'Positif = paiement, négatif = remboursement';

-- ══════════ INDEXES ══════════
CREATE INDEX idx_colis_client       ON colis(client_id);
CREATE INDEX idx_colis_statut       ON colis(statut);
CREATE INDEX idx_colis_envoi        ON colis(envoi_id) WHERE envoi_id IS NOT NULL;
CREATE INDEX idx_colis_ref_pattern  ON colis(ref text_pattern_ops);
CREATE INDEX idx_colis_date_recep   ON colis(date_reception DESC) WHERE date_reception IS NOT NULL;
CREATE INDEX idx_colis_urgence      ON colis(created_at) WHERE urgence = TRUE AND statut NOT IN ('livre', 'annule');
CREATE INDEX idx_colis_created      ON colis(created_at DESC);
CREATE INDEX idx_colis_file_prep    ON colis(statut, created_at) WHERE statut NOT IN ('livre', 'annule');
CREATE INDEX idx_colis_attente_paie ON colis(devis_total, created_at) WHERE statut = 'attente_paiement';

CREATE INDEX idx_envois_statut      ON envois(statut);
CREATE INDEX idx_envois_date        ON envois(date_depart);
CREATE INDEX idx_envois_dest        ON envois(destination_code);

CREATE INDEX idx_factures_colis     ON factures(colis_id);
CREATE INDEX idx_lignes_colis       ON lignes(colis_id);
CREATE INDEX idx_paiements_colis    ON paiements(colis_id);
CREATE INDEX idx_paiements_client   ON paiements(client_id);
CREATE INDEX idx_paiements_attente  ON paiements(created_at) WHERE statut = 'en_attente';
