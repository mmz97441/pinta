// Server copy of the default bodies the server sends itself, keyed <key>_<canal>.
// Mirrors src/expedile/services/messageDefaults.js (parity test in
// tests/reception-measurements.test.mjs): change both files together. A body
// saved in message_templates always takes precedence over these defaults.
export const DEFAULT_BODIES: Record<string, string> = {
  facture_apres_devis_telegram: `Bonjour {{prenom}} 👋\n\nVotre facture pour le dossier {{ref}} est bien reçue, merci !\n\n📦 Votre devis va être mis à jour avec cet achat. L’ancien lien de paiement n’est plus valable : vous n’avez rien à régler pour le moment.\n\n✅ Notre équipe vérifie la facture. Vous recevrez le nouveau devis, avec son nouveau lien de paiement, dès qu’il sera prêt.\n\nL’équipe Expedîle`,
  facture_apres_devis_email: `Bonjour {{prenom}},\n\nVotre facture pour le dossier {{ref}} est bien reçue, merci !\n\nVotre devis va être mis à jour avec cet achat. L’ancien lien de paiement n’est plus valable : vous n’avez rien à régler pour le moment.\n\nNotre équipe vérifie la facture. Vous recevrez le nouveau devis, avec son nouveau lien de paiement, dès qu’il sera prêt.\n\nCordialement,\nL’équipe Expedîle`,
  facture_apres_devis_sans_lien_telegram: `Bonjour {{prenom}} 👋\n\nVotre facture pour le dossier {{ref}} est bien reçue, merci !\n\n📦 Votre devis va être mis à jour avec cet achat : merci d’attendre le nouveau devis avant tout règlement.\n\n✅ Notre équipe vérifie la facture. Vous recevrez le nouveau devis dès qu’il sera prêt.\n\nL’équipe Expedîle`,
  facture_apres_devis_sans_lien_email: `Bonjour {{prenom}},\n\nVotre facture pour le dossier {{ref}} est bien reçue, merci !\n\nVotre devis va être mis à jour avec cet achat : merci d’attendre le nouveau devis avant tout règlement.\n\nNotre équipe vérifie la facture. Vous recevrez le nouveau devis dès qu’il sera prêt.\n\nCordialement,\nL’équipe Expedîle`,
};
