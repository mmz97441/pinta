-- Migration: 003_communication_audit
-- Version: 20260326173002
-- Pulled from Supabase project bqprktzehuhplpqjgjaz on 2026-05-18


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 3 : Communication, notifications, audit                  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ══════════ MESSAGES (chat staff ↔ client par colis) ══════════
CREATE TABLE messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colis_id      UUID NOT NULL REFERENCES colis(id) ON DELETE CASCADE,
  type          type_message NOT NULL,
  auteur_id     UUID REFERENCES profiles(id),
  auteur_nom    TEXT,
  texte         TEXT NOT NULL,
  statut        statut_message,
  wa_id         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE messages IS 'Chat par colis entre staff et client — intégré WhatsApp';
COMMENT ON COLUMN messages.wa_id IS 'ID message WhatsApp Business pour suivi statut livraison';

-- ══════════ NOTIFICATIONS ══════════
CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  titre         TEXT NOT NULL,
  msg           TEXT NOT NULL,
  lu            BOOLEAN NOT NULL DEFAULT FALSE,
  colis_id      UUID REFERENCES colis(id) ON DELETE SET NULL,
  type          TEXT,  -- 'statut_change', 'feu_vert', 'paiement', 'message', 'alerte'
  metadata      JSONB, -- Données supplémentaires (ancien/nouveau statut, montant, etc.)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE notifications IS 'Notifications in-app pour clients et staff';

-- ══════════ LOGS STATUT (audit trail) ══════════
CREATE TABLE logs_statut (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colis_id        UUID NOT NULL REFERENCES colis(id) ON DELETE CASCADE,
  ancien_statut   statut_colis,
  nouveau_statut  statut_colis NOT NULL,
  user_id         UUID REFERENCES profiles(id),
  user_nom        TEXT,
  commentaire     TEXT,
  metadata        JSONB,  -- Données contextuelles (dims, montant, etc.)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE logs_statut IS 'Historique complet de chaque changement de statut — jamais supprimé';

-- ══════════ COM_LOG (historique communications) ══════════
CREATE TABLE com_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colis_id      UUID REFERENCES colis(id) ON DELETE SET NULL,
  client_id     UUID NOT NULL REFERENCES clients(id),
  canal         canal_communication NOT NULL,
  template      TEXT,
  msg           TEXT,
  user_id       UUID REFERENCES profiles(id),
  user_nom      TEXT,
  statut        TEXT,  -- 'envoye', 'echec', 'ouvert'
  wa_id         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE com_log IS 'Journal de toutes les communications envoyées (WhatsApp, email, SMS)';

-- ══════════ ALERTES SYSTEME ══════════
-- Alertes automatiques générées par triggers (colis bloqué, impayé ancien, etc.)
CREATE TABLE alertes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT NOT NULL,  -- 'colis_bloque', 'impaye_ancien', 'facture_manquante', 'produit_interdit'
  titre         TEXT NOT NULL,
  description   TEXT,
  colis_id      UUID REFERENCES colis(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
  severite      TEXT NOT NULL DEFAULT 'info' CHECK (severite IN ('info', 'warning', 'critical')),
  resolue       BOOLEAN NOT NULL DEFAULT FALSE,
  resolue_par   UUID REFERENCES profiles(id),
  resolue_le    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE alertes IS 'Alertes automatiques pour la direction — colis bloqués, impayés, anomalies';

-- ══════════ INDEXES ══════════
CREATE INDEX idx_messages_colis     ON messages(colis_id, created_at);
CREATE INDEX idx_messages_wa        ON messages(wa_id) WHERE wa_id IS NOT NULL;

CREATE INDEX idx_notifs_user        ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifs_non_lues    ON notifications(user_id, created_at DESC) WHERE lu = FALSE;
CREATE INDEX idx_notifs_colis       ON notifications(colis_id) WHERE colis_id IS NOT NULL;

CREATE INDEX idx_logs_colis         ON logs_statut(colis_id, created_at DESC);
CREATE INDEX idx_logs_user          ON logs_statut(user_id) WHERE user_id IS NOT NULL;

CREATE INDEX idx_comlog_colis       ON com_log(colis_id) WHERE colis_id IS NOT NULL;
CREATE INDEX idx_comlog_client      ON com_log(client_id, created_at DESC);

CREATE INDEX idx_alertes_ouvertes   ON alertes(type, severite, created_at DESC) WHERE resolue = FALSE;
CREATE INDEX idx_alertes_colis      ON alertes(colis_id) WHERE colis_id IS NOT NULL;

-- ══════════ REALTIME ══════════
-- Activer le realtime sur les tables critiques
ALTER PUBLICATION supabase_realtime ADD TABLE colis;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE alertes;
