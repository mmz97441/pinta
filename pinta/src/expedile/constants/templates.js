import { getDestByCP } from './index';
import { eur } from '../utils';

export const MSG_TEMPLATES = {
  reception: {
    label: '📦 Colis réceptionné',
    whatsapp: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋\n\nVotre colis *${colis.ref}* est bien arrivé à notre entrepôt de Paris !\n\n📦 Contenu : ${colis.desc}\n${colis.trackings?.length ? `🔍 Tracking : ${colis.trackings.join(', ')}\n` : ''}\nNous allons le mesurer et peser. On revient vers vous rapidement pour la suite.\n\n_Expedîle — Paris → ${getDestByCP(c.cp).nom}_`,
    email: (c, colis) =>
      `Objet : Votre colis ${colis.ref} est arrivé à Paris\n\nBonjour ${c.nom},\n\nNous confirmons la réception de votre colis ${colis.ref} (${colis.desc}) à notre entrepôt de Paris.\n\nNous procédons à la mesure et au pesage. Nous vous recontacterons pour la suite.\n\nCordialement,\nL'équipe Expedîle`,
  },

  facture_manquante: {
    label: '📄 Facture manquante',
    whatsapp: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋\n\n⚠️ Il nous manque la *facture d'origine* pour votre colis *${colis.ref}* (${colis.desc}).\n\nSans cette facture, nous ne pourrons pas calculer les taxes (Octroi de Mer) ni établir le devis.\n\n👉 Merci de nous l'envoyer par retour de message (photo ou PDF).\n\n_Expedîle_`,
    email: (c, colis) =>
      `Objet : Facture manquante pour ${colis.ref}\n\nBonjour ${c.nom},\n\nPour traiter votre colis ${colis.ref}, nous avons besoin de la facture d'achat d'origine afin de calculer les taxes (Octroi de Mer).\n\nMerci de nous la transmettre en réponse à cet email.\n\nCordialement,\nL'équipe Expedîle`,
  },

  demande_feu_vert: {
    label: '🟢 Demande de feu vert',
    whatsapp: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋\n\nVotre colis *${colis.ref}* a été réceptionné et mesuré à notre entrepôt de Paris.\n\n📦 ${colis.desc}\n📐 ${colis.dimL ? `${colis.dimL}×${colis.dimW}×${colis.dimH} cm` : ''} — ⚖️ ${colis.poids || '?'} kg\n\n👉 *Avez-vous l'accord pour qu'on prépare et optimise votre colis pour l'envoi ?*\n\n✅ Répondez *OUI* pour autoriser la préparation\n❌ Répondez *NON* pour annuler\n\n${colis.factures?.length > 0 ? '' : "📄 *Important* : pensez à nous envoyer la facture d'achat d'origine pour le calcul des taxes (OM / OMR).\n\n"}💡 Le devis final vous sera envoyé après la préparation et l'optimisation de votre colis.\n\n_Expedîle_`,
    email: (c, colis) =>
      `Objet : Votre accord est nécessaire — ${colis.ref}\n\nBonjour ${c.nom},\n\nVotre colis ${colis.ref} (${colis.desc}) a été réceptionné et mesuré à notre entrepôt.\nDimensions : ${colis.dimL ? `${colis.dimL}×${colis.dimW}×${colis.dimH} cm` : '—'} — Poids : ${colis.poids || '—'} kg\n\nNous avons besoin de votre accord pour préparer et optimiser votre colis.\n${colis.factures?.length > 0 ? '' : "\nImportant : merci de nous transmettre la facture d'achat d'origine pour le calcul des taxes.\n"}\nLe devis final sera établi après la préparation.\n\nCordialement,\nL'équipe Expedîle`,
  },

  feu_vert_recu: {
    label: '✅ Feu vert confirmé',
    whatsapp: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋\n\nMerci pour votre accord ! ✅\n\nVotre colis *${colis.ref}* va être préparé et optimisé par notre équipe.\n\nVous recevrez le devis final dès que c'est prêt.\n\n_Expedîle_`,
    email: (c, colis) =>
      `Objet : Accord reçu — ${colis.ref} en préparation\n\nBonjour ${c.nom},\n\nNous avons bien reçu votre accord pour le colis ${colis.ref}. Notre équipe va procéder à la préparation.\n\nCordialement,\nL'équipe Expedîle`,
  },

  devis_final: {
    label: '💳 Devis final',
    whatsapp: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋\n\nLe devis final pour votre colis *${colis.ref}* est prêt !\n\n📦 ${colis.desc}\n\n💰 *Total : ${eur(colis.devisTotal)}*\n  • Transport : ${eur(colis.devisTransport)}\n  • Taxes : ${eur((colis.devisOM || 0) + (colis.devisOMR || 0))}\n  • TVA : ${eur(colis.devisTVA)}\n${colis.economie > 0 ? `\n✅ *Économie grâce à l'optimisation : ${eur(colis.economie)}*\n(Sans optimisation : ${eur(colis.avantOptimTotal)})\n` : ''}\n👉 Vous pouvez payer directement sur votre espace client ou nous répondre pour toute question.\n\n_Expedîle_`,
    email: (c, colis) =>
      `Objet : Devis final — ${colis.ref} : ${eur(colis.devisTotal)}\n\nBonjour ${c.nom},\n\nVoici le devis final pour votre colis ${colis.ref} :\n- Transport : ${eur(colis.devisTransport)}\n- Taxes : ${eur((colis.devisOM || 0) + (colis.devisOMR || 0))}\n- TVA : ${eur(colis.devisTVA)}\n- TOTAL : ${eur(colis.devisTotal)}\n${colis.economie > 0 ? `\nGrâce à l'optimisation de votre colis, vous économisez ${eur(colis.economie)} (prix sans optimisation : ${eur(colis.avantOptimTotal)}).\n` : ''}\nCordialement,\nL'équipe Expedîle`,
  },

  relance_feu_vert: {
    label: '⏰ Relance feu vert',
    whatsapp: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋\n\nPetit rappel : votre colis *${colis.ref}* (${colis.desc}) attend toujours votre accord pour la préparation.\n\n✅ *OUI* pour autoriser la préparation\n❌ *NON* pour annuler\n\n${colis.factures?.length > 0 ? '' : "📄 N'oubliez pas de nous envoyer la facture d'achat d'origine.\n\n"}⚠️ Des frais de stockage peuvent s'appliquer après 14 jours.\n\n_Expedîle_`,
    email: (c, colis) =>
      `Objet : Rappel — En attente de votre accord pour ${colis.ref}\n\nBonjour ${c.nom},\n\nVotre colis ${colis.ref} est toujours en attente de votre accord pour la préparation.\n${colis.factures?.length > 0 ? '' : "\nRappel : merci de nous transmettre la facture d'achat d'origine.\n"}\nCordialement,\nL'équipe Expedîle`,
  },

  relance_paiement: {
    label: '⏰ Relance paiement',
    whatsapp: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋\n\nPetit rappel : le devis pour *${colis.ref}* est en attente de paiement.\n\n💰 Montant : *${eur(colis.devisTotal)}*\n\n👉 Payez sur votre espace client pour déclencher l'expédition.\n\n_Expedîle_`,
    email: (c, colis) =>
      `Objet : Rappel paiement — ${colis.ref}\n\nBonjour ${c.nom},\n\nLe paiement de ${eur(colis.devisTotal)} pour le colis ${colis.ref} est en attente.\n\nCordialement,\nL'équipe Expedîle`,
  },

  expedie: {
    label: '✈️ Colis expédié',
    whatsapp: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋\n\n✈️ Votre colis *${colis.ref}* a été expédié depuis Paris !\n\n📦 ${colis.desc}\n🎯 Destination : ${getDestByCP(c.cp).nom}\n\nVous serez notifié(e) dès l'arrivée.\n\n_Expedîle_`,
    email: (c, colis) =>
      `Objet : Colis expédié — ${colis.ref}\n\nBonjour ${c.nom},\n\nVotre colis ${colis.ref} a été expédié depuis notre entrepôt de Paris.\n\nCordialement,\nL'équipe Expedîle`,
  },

  arrive: {
    label: '📍 Arrivé à destination',
    whatsapp: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋\n\n📍 Votre colis *${colis.ref}* est arrivé à ${getDestByCP(c.cp).nom} !\n\nNous organisons la livraison, vous serez prévenu(e) du créneau.\n\n_Expedîle_`,
    email: (c, colis) =>
      `Objet : Colis arrivé à ${getDestByCP(c.cp).nom} — ${colis.ref}\n\nBonjour ${c.nom},\n\nVotre colis ${colis.ref} est bien arrivé. La livraison sera planifiée prochainement.\n\nCordialement,\nL'équipe Expedîle`,
  },

  en_livraison: {
    label: '🚚 En livraison',
    whatsapp: (c) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋\n\n🚚 Votre colis est en cours de livraison aujourd'hui !\n\nMerci de rester disponible. Le livreur vous contactera si besoin.\n\n_Expedîle_`,
    email: (c, colis) =>
      `Objet : Livraison en cours — ${colis.ref}\n\nBonjour ${c.nom},\n\nVotre colis ${colis.ref} est en cours de livraison.\n\nCordialement,\nL'équipe Expedîle`,
  },

  libre: {
    label: '✍️ Message libre',
    whatsapp: (c) => `Bonjour ${c.nom.split(' ')[0]} 👋\n\n`,
    email: (c) => `Objet : \n\nBonjour ${c.nom},\n\n\n\nCordialement,\nL'équipe Expedîle`,
  },
};
