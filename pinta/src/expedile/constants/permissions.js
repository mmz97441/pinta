// ══════════ PERMISSIONS STAFF ══════════
// 45 permissions réparties en 8 catégories

export const PERMISSION_CATEGORIES = [
  {
    key: 'colis', label: 'Colis', permissions: [
      { key: 'perm_colis_receptionner', label: 'Réceptionner un colis' },
      { key: 'perm_colis_mesurer', label: 'Mesurer / peser' },
      { key: 'perm_colis_modifier_dims', label: 'Modifier les dimensions après réception' },
      { key: 'perm_colis_demander_feuvert', label: 'Demander le feu vert' },
      { key: 'perm_colis_valider_feuvert', label: 'Valider le feu vert manuellement' },
      { key: 'perm_colis_preparer', label: 'Préparer (optimiser l\'emballage)' },
      { key: 'perm_colis_calculer_devis', label: 'Calculer le devis' },
      { key: 'perm_colis_envoyer_devis', label: 'Envoyer le devis au client' },
      { key: 'perm_colis_confirmer_paiement', label: 'Confirmer un paiement' },
      { key: 'perm_colis_affecter_envoi', label: 'Affecter à un envoi' },
      { key: 'perm_colis_expedier', label: 'Expédier' },
      { key: 'perm_colis_changer_statut_expedition', label: 'Changer le statut d\'expédition' },
      { key: 'perm_colis_annuler', label: 'Annuler un colis' },
      { key: 'perm_colis_revenir_arriere', label: 'Revenir en arrière (correction)' },
      { key: 'perm_colis_archiver', label: 'Archiver un colis' },
    ],
  },
  {
    key: 'clients', label: 'Clients', permissions: [
      { key: 'perm_clients_voir', label: 'Voir les clients' },
      { key: 'perm_clients_creer', label: 'Créer un client' },
      { key: 'perm_clients_modifier', label: 'Modifier un client' },
      { key: 'perm_clients_supprimer', label: 'Supprimer un client' },
      { key: 'perm_clients_modifier_abonnement', label: 'Modifier l\'abonnement' },
      { key: 'perm_clients_voir_finances', label: 'Voir les infos financières client' },
    ],
  },
  {
    key: 'factures', label: 'Factures', permissions: [
      { key: 'perm_factures_voir', label: 'Voir les factures' },
      { key: 'perm_factures_ajouter', label: 'Ajouter une facture' },
      { key: 'perm_factures_valider', label: 'Valider une facture' },
      { key: 'perm_factures_refuser', label: 'Refuser une facture' },
      { key: 'perm_factures_ocr', label: 'Lancer l\'OCR' },
      { key: 'perm_factures_modifier_articles', label: 'Modifier les articles / catégories' },
    ],
  },
  {
    key: 'comm', label: 'Communication', permissions: [
      { key: 'perm_comm_telegram', label: 'Envoyer un message Telegram' },
      { key: 'perm_comm_email', label: 'Envoyer un email' },
      { key: 'perm_comm_demander_facture', label: 'Demander une facture au client' },
      { key: 'perm_comm_message_libre', label: 'Envoyer un message libre' },
      { key: 'perm_comm_voir_chat_autres', label: 'Voir le chat des autres utilisateurs' },
    ],
  },
  {
    key: 'envois', label: 'Envois', permissions: [
      { key: 'perm_envois_voir', label: 'Voir les envois' },
      { key: 'perm_envois_creer', label: 'Créer un envoi' },
      { key: 'perm_envois_modifier', label: 'Modifier un envoi' },
      { key: 'perm_envois_reaffecter', label: 'Réaffecter un colis à un autre envoi' },
      { key: 'perm_envois_etiquettes', label: 'Imprimer les étiquettes' },
    ],
  },
  {
    key: 'finances', label: 'Finances', permissions: [
      { key: 'perm_finances_voir_transport', label: 'Voir les prix de transport' },
      { key: 'perm_finances_voir_taxes', label: 'Voir les taxes (OM/OMR/TVA)' },
      { key: 'perm_finances_voir_total', label: 'Voir le montant total du devis' },
      { key: 'perm_finances_voir_kpi', label: 'Voir le CA / KPIs' },
      { key: 'perm_finances_exporter', label: 'Exporter les données financières' },
      { key: 'perm_finances_modifier_tarifs', label: 'Modifier les tarifs' },
    ],
  },
  {
    key: 'exports', label: 'Exports', permissions: [
      { key: 'perm_export_colis', label: 'Exporter la liste des colis (Excel)' },
      { key: 'perm_export_factures', label: 'Exporter les factures commerciales' },
      { key: 'perm_export_dau', label: 'Exporter la DAU' },
      { key: 'perm_export_recap_pro', label: 'Exporter le récap pro' },
    ],
  },
  {
    key: 'admin', label: 'Administration', permissions: [
      { key: 'perm_admin_utilisateurs', label: 'Gérer les utilisateurs et permissions' },
      { key: 'perm_admin_categories', label: 'Gérer les catégories douanières' },
      { key: 'perm_admin_templates', label: 'Gérer les templates de messages' },
      { key: 'perm_admin_produits_interdits', label: 'Gérer les produits interdits' },
      { key: 'perm_admin_audit', label: 'Voir l\'historique / audit complet' },
      { key: 'perm_admin_parametres', label: 'Accéder aux paramètres' },
    ],
  },
];

// All permission keys flat
export const ALL_PERMISSION_KEYS = PERMISSION_CATEGORIES.flatMap((cat) => cat.permissions.map((p) => p.key));
