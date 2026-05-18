-- Migration: 005_vues_metier
-- Version: 20260326173320
-- Pulled from Supabase project bqprktzehuhplpqjgjaz on 2026-05-18


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 5 : Vues métier par rôle                                 ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ══════════ VUE : COLIS ENRICHI (base pour toutes les vues) ══════════
CREATE OR REPLACE VIEW v_colis AS
SELECT
  c.*,
  cl.nom AS client_nom,
  cl.prenom AS client_prenom,
  cl.tel AS client_tel,
  cl.email AS client_email,
  cl.cp AS client_cp,
  cl.ville AS client_ville,
  cl.type AS client_type,
  cl.canal AS client_canal,
  d.nom AS destination_nom,
  d.flag AS destination_flag,
  d.tva AS destination_tva,
  d.has_om AS destination_has_om,
  SUBSTRING(cl.cp FROM 1 FOR 3) AS destination_code,
  e.ref AS envoi_ref,
  e.date_depart AS envoi_date_depart,
  e.statut AS envoi_statut,
  -- Taxes combinées
  COALESCE(c.devis_om, 0) + COALESCE(c.devis_omr, 0) + COALESCE(c.devis_tva, 0) AS taxes_total,
  -- Ancienneté dans le statut actuel
  EXTRACT(DAY FROM NOW() - c.updated_at)::INT AS jours_dans_statut,
  -- Nombre de factures / lignes
  (SELECT COUNT(*) FROM factures f WHERE f.colis_id = c.id) AS nb_factures,
  (SELECT COUNT(*) FROM factures f WHERE f.colis_id = c.id AND f.valide = FALSE) AS nb_factures_invalides,
  (SELECT COUNT(*) FROM lignes l WHERE l.colis_id = c.id) AS nb_lignes,
  (SELECT COUNT(*) FROM messages m WHERE m.colis_id = c.id) AS nb_messages
FROM colis c
JOIN clients cl ON cl.id = c.client_id
LEFT JOIN destinations d ON d.code = SUBSTRING(cl.cp FROM 1 FOR 3)
LEFT JOIN envois e ON e.id = c.envoi_id;

COMMENT ON VIEW v_colis IS 'Vue enrichie des colis avec client, destination, envoi et compteurs';

-- ══════════ VUE : DASHBOARD DIRECTEUR (KPIs) ══════════
CREATE OR REPLACE VIEW v_kpi_directeur AS
SELECT
  -- Volume
  COUNT(*) FILTER (WHERE statut NOT IN ('annule')) AS total_actifs,
  COUNT(*) FILTER (WHERE statut = 'livre') AS total_livres,
  COUNT(*) FILTER (WHERE statut = 'annule') AS total_annules,
  COUNT(*) FILTER (WHERE statut NOT IN ('livre', 'annule')) AS total_en_cours,

  -- Pipeline
  COUNT(*) FILTER (WHERE statut IN ('receptionne', 'mesure')) AS pipeline_reception,
  COUNT(*) FILTER (WHERE statut IN ('attente_feu_vert', 'devis_envoye', 'attente_paiement')) AS pipeline_attente_client,
  COUNT(*) FILTER (WHERE statut IN ('autorise', 'en_preparation')) AS pipeline_feu_vert,
  COUNT(*) FILTER (WHERE statut IN ('paye', 'expedie', 'transit', 'arrive', 'livraison')) AS pipeline_expedition,

  -- Financier
  COALESCE(SUM(devis_total) FILTER (WHERE statut = 'attente_paiement'), 0) AS montant_impayes,
  COALESCE(SUM(paiement_montant) FILTER (WHERE paiement_montant IS NOT NULL AND statut NOT IN ('annule')), 0) AS ca_total,
  COALESCE(SUM(paiement_montant) FILTER (
    WHERE paiement_date >= DATE_TRUNC('month', NOW()) AND statut NOT IN ('annule')
  ), 0) AS ca_mois_courant,
  COALESCE(AVG(devis_total) FILTER (WHERE devis_total IS NOT NULL AND statut NOT IN ('annule')), 0) AS panier_moyen,
  COALESCE(SUM(economie) FILTER (WHERE economie > 0), 0) AS economie_totale,

  -- Performance
  COALESCE(AVG(
    EXTRACT(DAY FROM date_livraison - date_reception)
  ) FILTER (WHERE date_livraison IS NOT NULL AND date_reception IS NOT NULL), 0) AS delai_moyen_jours,

  -- Alertes
  (SELECT COUNT(*) FROM alertes WHERE resolue = FALSE) AS alertes_ouvertes,
  (SELECT COUNT(*) FROM alertes WHERE resolue = FALSE AND severite = 'critical') AS alertes_critiques
FROM colis;

COMMENT ON VIEW v_kpi_directeur IS 'KPIs temps réel pour le tableau de bord directeur';

-- ══════════ VUE : CA PAR DESTINATION ══════════
CREATE OR REPLACE VIEW v_ca_par_destination AS
SELECT
  SUBSTRING(cl.cp FROM 1 FOR 3) AS destination_code,
  d.nom AS destination_nom,
  d.flag AS destination_flag,
  COUNT(*) AS nb_colis,
  COUNT(*) FILTER (WHERE c.statut = 'livre') AS nb_livres,
  COALESCE(SUM(c.paiement_montant) FILTER (WHERE c.paiement_montant IS NOT NULL), 0) AS ca,
  COALESCE(SUM(c.devis_transport) FILTER (WHERE c.devis_transport IS NOT NULL), 0) AS ca_transport,
  COALESCE(SUM(c.devis_om) FILTER (WHERE c.devis_om IS NOT NULL), 0)
    + COALESCE(SUM(c.devis_omr) FILTER (WHERE c.devis_omr IS NOT NULL), 0) AS ca_taxes,
  COALESCE(SUM(c.economie) FILTER (WHERE c.economie > 0), 0) AS economie_totale
FROM colis c
JOIN clients cl ON cl.id = c.client_id
LEFT JOIN destinations d ON d.code = SUBSTRING(cl.cp FROM 1 FOR 3)
WHERE c.statut NOT IN ('annule')
GROUP BY SUBSTRING(cl.cp FROM 1 FOR 3), d.nom, d.flag;

COMMENT ON VIEW v_ca_par_destination IS 'Chiffre d''affaires ventilé par destination DOM-TOM';

-- ══════════ VUE : FILE DU PRÉPARATEUR ══════════
-- Ce que le préparateur voit : ses tâches du jour, triées par urgence puis ancienneté
CREATE OR REPLACE VIEW v_file_preparateur AS
SELECT
  c.id,
  c.ref,
  c.statut,
  c.desc_contenu,
  c.casier,
  c.urgence,
  c.dim_l, c.dim_w, c.dim_h, c.poids,
  c.fin_l, c.fin_w, c.fin_h, c.fin_p,
  c.produit_interdit,
  c.date_reception,
  c.feu_vert,
  c.nb_colis,
  cl.nom AS client_nom,
  cl.prenom AS client_prenom,
  SUBSTRING(cl.cp FROM 1 FOR 3) AS destination_code,
  d.flag AS destination_flag,
  EXTRACT(DAY FROM NOW() - c.updated_at)::INT AS jours_dans_statut,
  -- Tâche à faire pour le préparateur
  CASE c.statut
    WHEN 'receptionne' THEN 'Mesurer'
    WHEN 'mesure' THEN 'Demander feu vert'
    WHEN 'autorise' THEN 'Préparer / Optimiser'
    WHEN 'en_preparation' THEN 'Finaliser devis'
    ELSE 'Aucune action'
  END AS action_requise
FROM colis c
JOIN clients cl ON cl.id = c.client_id
LEFT JOIN destinations d ON d.code = SUBSTRING(cl.cp FROM 1 FOR 3)
WHERE c.statut IN ('receptionne', 'mesure', 'autorise', 'en_preparation')
ORDER BY c.urgence DESC, c.date_reception ASC NULLS LAST;

COMMENT ON VIEW v_file_preparateur IS 'File de travail du préparateur — triée urgence puis FIFO';

-- ══════════ VUE : ENVOIS LOGISTICIEN ══════════
CREATE OR REPLACE VIEW v_envois_logisticien AS
SELECT
  e.*,
  d.nom AS destination_nom,
  d.flag AS destination_flag,
  (SELECT COUNT(*) FROM colis c WHERE c.envoi_id = e.id AND c.statut = 'paye') AS colis_prets,
  (SELECT COUNT(*) FROM colis c WHERE c.envoi_id = e.id AND c.statut NOT IN ('paye', 'expedie', 'transit', 'arrive', 'livraison', 'livre')) AS colis_non_prets,
  p.nom AS createur_nom
FROM envois e
LEFT JOIN destinations d ON d.code = e.destination_code
LEFT JOIN profiles p ON p.id = e.cree_par
ORDER BY
  CASE e.statut
    WHEN 'en_cours' THEN 1
    WHEN 'prochain' THEN 2
    WHEN 'planifie' THEN 3
    WHEN 'parti' THEN 4
    WHEN 'arrive' THEN 5
  END,
  e.date_depart ASC;

COMMENT ON VIEW v_envois_logisticien IS 'Vue envois enrichie pour le logisticien — avec compteurs colis et tri opérationnel';

-- ══════════ VUE : TOP CLIENTS ══════════
CREATE OR REPLACE VIEW v_top_clients AS
SELECT
  cl.id,
  cl.nom,
  cl.prenom,
  cl.ville,
  cl.cp,
  cl.type,
  cl.points,
  cl.canal,
  cl.created_at,
  d.flag AS destination_flag,
  d.nom AS destination_nom,
  COUNT(c.id) AS nb_colis_total,
  COUNT(c.id) FILTER (WHERE c.statut = 'livre') AS nb_livres,
  COUNT(c.id) FILTER (WHERE c.statut NOT IN ('livre', 'annule')) AS nb_en_cours,
  COALESCE(SUM(c.paiement_montant) FILTER (WHERE c.paiement_montant IS NOT NULL), 0) AS ca_client,
  COALESCE(SUM(c.devis_total) FILTER (WHERE c.statut = 'attente_paiement'), 0) AS montant_du,
  MAX(c.date_reception) AS dernier_colis
FROM clients cl
LEFT JOIN colis c ON c.client_id = cl.id AND c.statut != 'annule'
LEFT JOIN destinations d ON d.code = SUBSTRING(cl.cp FROM 1 FOR 3)
GROUP BY cl.id, cl.nom, cl.prenom, cl.ville, cl.cp, cl.type, cl.points, cl.canal, cl.created_at, d.flag, d.nom
ORDER BY ca_client DESC;

COMMENT ON VIEW v_top_clients IS 'Classement clients par CA — utile pour le directeur et le commercial';
