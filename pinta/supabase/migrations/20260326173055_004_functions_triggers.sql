-- Migration: 004_functions_triggers
-- Version: 20260326173055
-- Pulled from Supabase project bqprktzehuhplpqjgjaz on 2026-05-18


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 4 : Fonctions et triggers                                ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ══════════ AUTO-GÉNÉRATION REF COLIS (EXP-0001) ══════════
CREATE OR REPLACE FUNCTION fn_generer_ref_colis()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ref IS NULL OR NEW.ref = '' THEN
    NEW.ref := 'EXP-' || LPAD(nextval('seq_colis_ref')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_colis_ref
  BEFORE INSERT ON colis
  FOR EACH ROW EXECUTE FUNCTION fn_generer_ref_colis();

-- ══════════ AUTO-GÉNÉRATION REF ENVOI (ENV-2026-001) ══════════
CREATE OR REPLACE FUNCTION fn_generer_ref_envoi()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ref IS NULL OR NEW.ref = '' THEN
    NEW.ref := 'ENV-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(nextval('seq_envoi_ref')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_envoi_ref
  BEFORE INSERT ON envois
  FOR EACH ROW EXECUTE FUNCTION fn_generer_ref_envoi();

-- ══════════ UPDATED_AT AUTOMATIQUE ══════════
CREATE OR REPLACE FUNCTION fn_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated   BEFORE UPDATE ON profiles   FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_clients_updated    BEFORE UPDATE ON clients    FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_colis_updated      BEFORE UPDATE ON colis      FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_envois_updated     BEFORE UPDATE ON envois     FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

-- ══════════ LOG AUTOMATIQUE DES CHANGEMENTS DE STATUT ══════════
CREATE OR REPLACE FUNCTION fn_log_statut_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.statut IS DISTINCT FROM NEW.statut THEN
    INSERT INTO logs_statut (colis_id, ancien_statut, nouveau_statut, user_id, metadata)
    VALUES (
      NEW.id,
      OLD.statut,
      NEW.statut,
      auth.uid(),
      jsonb_build_object(
        'ref', NEW.ref,
        'client_id', NEW.client_id
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_colis_log_statut
  AFTER UPDATE OF statut ON colis
  FOR EACH ROW EXECUTE FUNCTION fn_log_statut_change();

-- ══════════ CALCUL POIDS FACTURABLE AUTOMATIQUE ══════════
-- max(poids réel, poids volumétrique L×W×H/5000)
CREATE OR REPLACE FUNCTION fn_calcul_poids_facturable()
RETURNS TRIGGER AS $$
DECLARE
  pv NUMERIC;
BEGIN
  IF NEW.fin_l IS NOT NULL AND NEW.fin_w IS NOT NULL AND NEW.fin_h IS NOT NULL AND NEW.fin_p IS NOT NULL THEN
    pv := (NEW.fin_l * NEW.fin_w * NEW.fin_h) / 5000.0;
    NEW.poids_facturable := GREATEST(NEW.fin_p, pv);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_colis_poids_fact
  BEFORE INSERT OR UPDATE OF fin_l, fin_w, fin_h, fin_p ON colis
  FOR EACH ROW EXECUTE FUNCTION fn_calcul_poids_facturable();

-- ══════════ MISE À JOUR AGRÉGATS ENVOI ══════════
-- Quand un colis est affecté/retiré d'un envoi, recalculer les totaux
CREATE OR REPLACE FUNCTION fn_update_envoi_aggregats()
RETURNS TRIGGER AS $$
BEGIN
  -- Recalculer l'ancien envoi si changement
  IF OLD.envoi_id IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.envoi_id IS DISTINCT FROM NEW.envoi_id) THEN
    UPDATE envois SET
      nb_colis = (SELECT COUNT(*) FROM colis WHERE envoi_id = OLD.envoi_id),
      poids_total = COALESCE((SELECT SUM(COALESCE(poids_facturable, poids, 0)) FROM colis WHERE envoi_id = OLD.envoi_id), 0),
      volume_total = COALESCE((SELECT SUM(
        CASE WHEN fin_l IS NOT NULL THEN (fin_l * fin_w * fin_h) / 1000000.0
             WHEN dim_l IS NOT NULL THEN (dim_l * dim_w * dim_h) / 1000000.0
             ELSE 0 END
      ) FROM colis WHERE envoi_id = OLD.envoi_id), 0)
    WHERE id = OLD.envoi_id;
  END IF;

  -- Recalculer le nouvel envoi
  IF TG_OP != 'DELETE' AND NEW.envoi_id IS NOT NULL THEN
    UPDATE envois SET
      nb_colis = (SELECT COUNT(*) FROM colis WHERE envoi_id = NEW.envoi_id),
      poids_total = COALESCE((SELECT SUM(COALESCE(poids_facturable, poids, 0)) FROM colis WHERE envoi_id = NEW.envoi_id), 0),
      volume_total = COALESCE((SELECT SUM(
        CASE WHEN fin_l IS NOT NULL THEN (fin_l * fin_w * fin_h) / 1000000.0
             WHEN dim_l IS NOT NULL THEN (dim_l * dim_w * dim_h) / 1000000.0
             ELSE 0 END
      ) FROM colis WHERE envoi_id = NEW.envoi_id), 0)
    WHERE id = NEW.envoi_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_colis_envoi_aggregats
  AFTER INSERT OR UPDATE OF envoi_id, poids_facturable, poids, fin_l, fin_w, fin_h OR DELETE
  ON colis FOR EACH ROW EXECUTE FUNCTION fn_update_envoi_aggregats();

-- ══════════ VALIDATION TRANSITIONS DE STATUT ══════════
-- Empêcher les transitions invalides au niveau DB
CREATE OR REPLACE FUNCTION fn_valider_transition_statut()
RETURNS TRIGGER AS $$
DECLARE
  transitions_valides TEXT[];
BEGIN
  IF OLD.statut = NEW.statut THEN RETURN NEW; END IF;

  -- Annulation possible depuis tout état non terminal
  IF NEW.statut = 'annule' AND OLD.statut NOT IN ('livre', 'annule') THEN
    RETURN NEW;
  END IF;

  transitions_valides := CASE OLD.statut::TEXT
    WHEN 'receptionne'      THEN ARRAY['mesure']
    WHEN 'mesure'           THEN ARRAY['attente_feu_vert']
    WHEN 'attente_feu_vert' THEN ARRAY['autorise', 'refuse_client']
    WHEN 'autorise'         THEN ARRAY['en_preparation']
    WHEN 'refuse_client'    THEN ARRAY['annule']
    WHEN 'en_preparation'   THEN ARRAY['devis_envoye']
    WHEN 'devis_envoye'     THEN ARRAY['attente_paiement']
    WHEN 'attente_paiement' THEN ARRAY['paye']
    WHEN 'paye'             THEN ARRAY['expedie']
    WHEN 'expedie'          THEN ARRAY['transit']
    WHEN 'transit'          THEN ARRAY['arrive']
    WHEN 'arrive'           THEN ARRAY['livraison']
    WHEN 'livraison'        THEN ARRAY['livre']
    WHEN 'livre'            THEN ARRAY[]::TEXT[]
    WHEN 'annule'           THEN ARRAY[]::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;

  IF NOT (NEW.statut::TEXT = ANY(transitions_valides)) THEN
    RAISE EXCEPTION 'Transition invalide : % → %', OLD.statut, NEW.statut;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_colis_valider_transition
  BEFORE UPDATE OF statut ON colis
  FOR EACH ROW EXECUTE FUNCTION fn_valider_transition_statut();

-- ══════════ SYNC AUTH.USERS → PROFILES ══════════
CREATE OR REPLACE FUNCTION fn_handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, nom, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'nom', NEW.email, 'Utilisateur'),
    COALESCE((NEW.raw_user_meta_data ->> 'role')::role_utilisateur, 'client')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION fn_handle_new_user();

-- ══════════ ALERTE AUTO : COLIS BLOQUÉ > 7 JOURS ══════════
-- Fonction appelable par cron (pg_cron ou Edge Function)
CREATE OR REPLACE FUNCTION fn_generer_alertes_colis_bloques()
RETURNS INTEGER AS $$
DECLARE
  nb INTEGER := 0;
BEGIN
  -- Colis bloqués depuis > 7 jours dans un statut intermédiaire
  INSERT INTO alertes (type, titre, description, colis_id, client_id, severite)
  SELECT
    'colis_bloque',
    'Colis bloqué depuis ' || EXTRACT(DAY FROM NOW() - c.updated_at)::INT || ' jours',
    c.ref || ' est en statut "' || c.statut || '" depuis le ' || TO_CHAR(c.updated_at, 'DD/MM/YYYY'),
    c.id,
    c.client_id,
    CASE
      WHEN NOW() - c.updated_at > INTERVAL '14 days' THEN 'critical'
      ELSE 'warning'
    END
  FROM colis c
  WHERE c.statut NOT IN ('livre', 'annule', 'expedie', 'transit', 'arrive', 'livraison')
    AND c.updated_at < NOW() - INTERVAL '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM alertes a
      WHERE a.colis_id = c.id AND a.type = 'colis_bloque' AND a.resolue = FALSE
    );

  GET DIAGNOSTICS nb = ROW_COUNT;
  RETURN nb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════ ALERTE AUTO : IMPAYÉ > 14 JOURS ══════════
CREATE OR REPLACE FUNCTION fn_generer_alertes_impayes()
RETURNS INTEGER AS $$
DECLARE
  nb INTEGER := 0;
BEGIN
  INSERT INTO alertes (type, titre, description, colis_id, client_id, severite)
  SELECT
    'impaye_ancien',
    'Impayé depuis ' || EXTRACT(DAY FROM NOW() - c.updated_at)::INT || ' jours',
    c.ref || ' — ' || COALESCE(c.devis_total::TEXT, '?') || ' € en attente',
    c.id,
    c.client_id,
    CASE
      WHEN NOW() - c.updated_at > INTERVAL '30 days' THEN 'critical'
      ELSE 'warning'
    END
  FROM colis c
  WHERE c.statut = 'attente_paiement'
    AND c.updated_at < NOW() - INTERVAL '14 days'
    AND NOT EXISTS (
      SELECT 1 FROM alertes a
      WHERE a.colis_id = c.id AND a.type = 'impaye_ancien' AND a.resolue = FALSE
    );

  GET DIAGNOSTICS nb = ROW_COUNT;
  RETURN nb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
