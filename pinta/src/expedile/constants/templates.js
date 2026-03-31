import { getDestByCP } from './index';
import { eur, trackStr } from '../utils';

// ══════════════════════════════════════════════════════════════════════════════
// MSG_TEMPLATES — Messages professionnels et informatifs
// ══════════════════════════════════════════════════════════════════════════════

// Helper : liste des cartons avec fournisseur
function cartonsList(colis) {
  if (colis.trackingsDetail?.length > 0) {
    return colis.trackingsDetail
      .map((td, i) => `  ${i + 1}. ${td.fournisseur || 'Colis'} — ${td.number}`)
      .join('\n');
  }
  if (colis.trackings?.length > 0) {
    return colis.trackings.filter((t) => t).map((t, i) => `  ${i + 1}. ${t}`).join('\n');
  }
  return '';
}

// Helper : résumé complet des cartons pour le devis
function devisCartonsDetail(colis, mode) {
  const details = colis.trackingsDetail || [];
  const trackings = colis.trackings?.filter((t) => t) || [];
  const dimsPC = colis.dimsParColis || [];
  const nb = Math.max(details.length, trackings.length, 1);
  const bold = mode === 'telegram' ? '*' : '';

  if (nb <= 1 && details.length <= 1) {
    // Single carton — simple
    const td = details[0];
    const fournisseur = td?.fournisseur || '';
    const tracking = td?.number || trackings[0] || '';
    let line = `📦 ${bold}1 carton${bold}`;
    if (fournisseur) line += ` — ${fournisseur}`;
    if (tracking) line += ` (${tracking})`;
    return line;
  }

  // Multi-cartons — détail par carton
  const lines = [`📦 ${bold}${nb} cartons regroupés${bold} :`];
  for (let i = 0; i < nb; i++) {
    const td = details[i];
    const fournisseur = td?.fournisseur || '';
    const tracking = td?.number || trackings[i] || '';
    const dims = dimsPC[i];
    let line = `  ${i + 1}. `;
    if (fournisseur) line += `${fournisseur}`;
    if (tracking) line += fournisseur ? ` (${tracking})` : tracking;
    if (dims?.dimL) line += ` — ${dims.dimL}×${dims.dimW}×${dims.dimH} cm, ${dims.poids} kg`;
    lines.push(line);
  }
  return lines.join('\n');
}

function dimsText(colis) {
  if (!colis.dimL) return '';
  return `${colis.dimL} × ${colis.dimW} × ${colis.dimH} cm — ${colis.poids} kg`;
}

function nbCartonsText(colis) {
  const n = colis.trackings?.filter((t) => t).length || 1;
  return n > 1 ? `${n} cartons` : '1 carton';
}

export const MSG_TEMPLATES = {
  // ═══════════════════════════════════════════════════════════════
  // 📦 RÉCEPTION
  // ═══════════════════════════════════════════════════════════════
  reception: {
    label: '📦 Colis réceptionné',
    meta: {
      name: 'colis_reception',
      lang: 'fr',
      params: (c, colis) => [c.nom.split(' ')[0], colis.ref, colis.desc || ''],
    },
    telegram: (c, colis) => {
      const dest = getDestByCP(c.cp);
      const cartonsInfo = cartonsList(colis);
      return `Bonjour ${c.nom.split(' ')[0]} 👋

Bonne nouvelle ! Votre colis *${colis.ref}* est bien arrivé à notre entrepôt de Paris 🎉

📦 *Contenu :* ${colis.desc}
${cartonsInfo ? `📋 *${nbCartonsText(colis)} :*\n${cartonsInfo}\n` : ''}🎯 *Destination :* ${dest.flag} ${dest.nom}

📐 *Prochaine étape :* Nous allons mesurer et peser votre colis. Vous recevrez les dimensions et une demande d'accord pour lancer la préparation.

💡 En attendant, pensez à nous envoyer la *facture d'achat* si ce n'est pas déjà fait — elle est nécessaire pour le calcul des taxes.

À très vite !
_L'équipe Expedîle — Paris → ${dest.nom}_`;
    },
    email: (c, colis) => {
      const dest = getDestByCP(c.cp);
      const cartonsInfo = cartonsList(colis);
      return `Objet : 📦 Votre colis ${colis.ref} est bien arrivé à Paris !

Bonjour ${c.nom},

Nous avons le plaisir de vous confirmer la réception de votre colis à notre entrepôt de Paris.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Référence : ${colis.ref}
📋 Contenu : ${colis.desc}
${cartonsInfo ? `📦 ${nbCartonsText(colis)} :\n${cartonsInfo}\n` : ''}🎯 Destination : ${dest.flag} ${dest.nom}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Prochaines étapes :
1. Mesure et pesage de votre colis
2. Demande de votre accord pour la préparation
3. Optimisation de l'emballage
4. Envoi du devis final

💡 Important : Si vous ne l'avez pas encore fait, merci de nous transmettre la facture d'achat d'origine. Elle est indispensable pour le calcul des taxes (Octroi de Mer).

N'hésitez pas à nous contacter pour toute question.

Cordialement,
L'équipe Expedîle
Paris → ${dest.nom}`;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // 📄 FACTURE MANQUANTE
  // ═══════════════════════════════════════════════════════════════
  facture_manquante: {
    label: '📄 Facture manquante',
    meta: {
      name: 'facture_manquante',
      lang: 'fr',
      params: (c, colis) => [c.nom.split(' ')[0], colis.ref],
    },
    telegram: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋

Pour avancer sur votre colis *${colis.ref}* (${colis.desc}), nous avons besoin de la *facture d'achat d'origine*.

📄 *Pourquoi ?* La facture nous permet de :
  • Calculer les taxes douanières (Octroi de Mer)
  • Établir la déclaration en douane
  • Vous proposer le devis final

👉 Envoyez-nous simplement une *photo* ou un *PDF* de la facture en réponse à ce message.

⏱️ Sans cette facture, nous ne pouvons malheureusement pas finaliser le traitement de votre colis.

⚠️ *Bon à savoir :* Des frais de stockage peuvent s'appliquer après 14 jours.

Notre équipe attend votre facture — dès réception, nous avançons rapidement. 🚀

Merci d'avance !
_L'équipe Expedîle_`,
    email: (c, colis) =>
      `Objet : 📄 Facture requise pour votre colis ${colis.ref}

Bonjour ${c.nom},

Pour poursuivre le traitement de votre colis ${colis.ref} (${colis.desc}), nous avons besoin de la facture d'achat d'origine.

Cette facture est indispensable pour :
• Le calcul des taxes douanières (Octroi de Mer / OMR)
• L'établissement de la déclaration en douane
• La finalisation de votre devis

Merci de nous la transmettre en réponse à cet email (photo ou PDF lisible).

Sans ce document, le traitement de votre colis ne pourra pas avancer.

Important : Des frais de stockage peuvent s'appliquer après 14 jours.

Notre équipe attend votre facture — dès réception, nous avançons rapidement.

Cordialement,
L'équipe Expedîle`,
  },

  // ═══════════════════════════════════════════════════════════════
  // 🟢 DEMANDE DE FEU VERT
  // ═══════════════════════════════════════════════════════════════
  demande_feu_vert: {
    label: '🟢 Demande de feu vert',
    meta: {
      name: 'demande_feu_vert',
      lang: 'fr',
      params: (c, colis) => [
        c.nom.split(' ')[0],
        colis.ref,
        colis.dimL ? `${colis.dimL}x${colis.dimW}x${colis.dimH} cm` : '',
        colis.poids ? `${colis.poids} kg` : '',
      ],
    },
    telegram: (c, colis) => {
      const dest = getDestByCP(c.cp);
      const hasMulti = (colis.trackings?.filter((t) => t).length || 0) > 1;
      return `Bonjour ${c.nom.split(' ')[0]} 👋

Votre colis *${colis.ref}* a été réceptionné et mesuré à notre entrepôt de Paris ✅

📦 *${colis.desc}*
${hasMulti ? `📋 *${nbCartonsText(colis)}*\n` : ''}📐 *Dimensions :* ${dimsText(colis) || 'en cours de mesure'}
⚖️ *Poids volumétrique :* ${colis.dimL ? ((colis.dimL * colis.dimW * colis.dimH) / 5000).toFixed(2) + ' kg' : '—'}
🎯 *Destination :* ${dest.flag} ${dest.nom}

${colis.estMin && colis.estMax ? `💰 *Estimation :* entre ${eur(colis.estMin)} et ${eur(colis.estMax)}\n(Le montant exact sera calculé après optimisation de l'emballage)\n` : ''}
🔔 *Votre accord est nécessaire pour continuer :*

✅ Répondez *OUI* → Nous préparons et optimisons votre colis
❌ Répondez *NON* → Le colis ne sera pas préparé

${colis.factures?.length > 0 ? '' : `📄 *Rappel :* N'oubliez pas de nous envoyer la facture d'achat pour le calcul des taxes.\n`}
💡 *Comment ça marche ensuite ?*
1. Nous optimisons l'emballage (souvent plus petit = moins cher !)
2. Vous recevez le devis final détaillé
3. Après paiement, votre colis part dans le prochain envoi

_Expedîle — Paris → ${dest.nom}_`;
    },
    email: (c, colis) => {
      const dest = getDestByCP(c.cp);
      return `Objet : 🔔 Votre accord est nécessaire — Colis ${colis.ref}

Bonjour ${c.nom},

Votre colis a été réceptionné et mesuré à notre entrepôt de Paris.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Référence : ${colis.ref}
📋 Contenu : ${colis.desc}
📐 Dimensions : ${dimsText(colis) || 'en cours de mesure'}
⚖️ Poids volumétrique : ${colis.dimL ? ((colis.dimL * colis.dimW * colis.dimH) / 5000).toFixed(2) + ' kg' : '—'}
🎯 Destination : ${dest.flag} ${dest.nom}
${colis.estMin && colis.estMax ? `💰 Estimation : entre ${eur(colis.estMin)} et ${eur(colis.estMax)}\n` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Nous avons besoin de votre accord pour préparer et optimiser votre colis.

Comment ça fonctionne :
1. ✅ Vous nous donnez votre accord
2. 📦 Nous optimisons l'emballage (réduction du volume = économies sur le transport)
3. 💳 Vous recevez le devis final détaillé
4. ✈️ Après paiement, expédition dans le prochain envoi

${colis.factures?.length > 0 ? '' : `Important : Merci de nous transmettre la facture d'achat d'origine pour le calcul des taxes douanières.\n`}
Répondez simplement à cet email pour nous donner votre accord.

Cordialement,
L'équipe Expedîle
Paris → ${dest.nom}`;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // ✅ FEU VERT CONFIRMÉ
  // ═══════════════════════════════════════════════════════════════
  feu_vert_recu: {
    label: '✅ Feu vert confirmé',
    meta: {
      name: 'feu_vert_confirme',
      lang: 'fr',
      params: (c, colis) => [c.nom.split(' ')[0], colis.ref],
    },
    telegram: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋

Merci pour votre accord ! ✅

Votre colis *${colis.ref}* (${colis.desc}) est maintenant entre les mains de notre équipe de préparation.

📦 *Ce que nous faisons :*
  • Optimisation de l'emballage
  • Réduction du volume quand c'est possible
  • Préparation pour l'expédition

⏱️ Vous recevrez le devis final détaillé dès que la préparation sera terminée.

_L'équipe Expedîle_`,
    email: (c, colis) =>
      `Objet : ✅ Accord reçu — ${colis.ref} en préparation

Bonjour ${c.nom},

Merci ! Nous avons bien reçu votre accord pour le colis ${colis.ref} (${colis.desc}).

Notre équipe va maintenant :
• Optimiser l'emballage pour réduire le volume
• Préparer votre colis pour l'expédition
• Calculer le devis final

Vous recevrez le devis détaillé dès que la préparation sera terminée.

Cordialement,
L'équipe Expedîle`,
  },

  // ═══════════════════════════════════════════════════════════════
  // 💳 DEVIS FINAL
  // ═══════════════════════════════════════════════════════════════
  devis_final: {
    label: '💳 Devis final',
    meta: {
      name: 'devis_final',
      lang: 'fr',
      params: (c, colis) => [
        c.nom.split(' ')[0],
        colis.ref,
        eur(colis.devisTotal),
        eur(colis.devisTransport),
        eur((colis.devisOM || 0) + (colis.devisOMR || 0)),
      ],
    },
    telegram: (c, colis) => {
      const dest = getDestByCP(c.cp);
      const taxes = (colis.devisOM || 0) + (colis.devisOMR || 0);
      const pf = colis.poidsFact || colis.finP || colis.poids || 0;
      const cartonsInfo = devisCartonsDetail(colis, 'telegram');
      // Poids vol. avant optimisation (somme des cartons)
      const pvAvant = colis.dimL ? ((colis.dimL * colis.dimW * colis.dimH) / 5000) : 0;
      // Poids vol. après optimisation
      const pvApres = colis.finL ? ((colis.finL * colis.finW * colis.finH) / 5000) : 0;
      return `Bonjour ${c.nom.split(' ')[0]} 👋

Le devis final pour votre expédition *${colis.ref}* est prêt ! 📋

🎯 *Destination :* ${dest.flag} ${dest.nom}

${cartonsInfo}
${pvAvant > 0 ? `\n📐 *Poids volumétrique total avant optimisation :* ${pvAvant.toFixed(2)} kg` : ''}${pvApres > 0 ? `\n📐 *Après optimisation :* Volume ${colis.finL}×${colis.finW}×${colis.finH} cm — poids vol. ${pvApres.toFixed(2)} kg` : ''}
⚖️ *Poids facturable :* ${pf} kg
${colis.lignes?.length > 0 ? `\n📋 *Contenu déclaré :*\n${colis.lignes.map((l) => `  • ${l.desc} × ${l.qte} — ${eur(l.prix * l.qte)}`).join('\n')}\n` : ''}
━━━━━━━━━━━━━━━━
💰 *DÉTAIL DU DEVIS*
━━━━━━━━━━━━━━━━
🚀 Transport : *${eur(colis.devisTransport)}*
🏛️ Taxes douanières : *${eur((colis.devisOM || 0) + (colis.devisOMR || 0))}*
${(colis.devisOM > 0 || colis.devisOMR > 0) ? `   _(Octroi de Mer + Octroi de Mer Régional, calculés sur la valeur de vos articles)_\n` : ''}
📊 TVA (${dest.tva}%) : *${eur(colis.devisTVA)}*
${colis.fraisDivers?.length > 0 ? colis.fraisDivers.map((f) => `📎 ${f.libelle} : *${eur(f.montant)}*`).join('\n') + '\n' : ''}━━━━━━━━━━━━━━━━
💰 *TOTAL : ${eur(colis.devisTotal)}*
━━━━━━━━━━━━━━━━
${colis.economie > 0 ? `\n✅ *Vous économisez ${eur(colis.economie)}* grâce à l'optimisation !\n(Sans optimisation : ${eur(colis.avantOptimTotal)})\n` : ''}
${colis.payplugPaymentUrl
? `💳 *Payez en ligne :*\n${colis.payplugPaymentUrl}`
: `👉 *Pour déclencher l'expédition :*\nContactez-nous pour le règlement.`}

❓ Une question ? Répondez à ce message.

_L'équipe Expedîle — Paris → ${dest.nom}_`;
    },
    email: (c, colis) => {
      const dest = getDestByCP(c.cp);
      const taxes = (colis.devisOM || 0) + (colis.devisOMR || 0);
      const pf = colis.poidsFact || colis.finP || colis.poids || 0;
      const cartonsInfo = devisCartonsDetail(colis, 'email');
      const pvAvant = colis.dimL ? ((colis.dimL * colis.dimW * colis.dimH) / 5000) : 0;
      const pvApres = colis.finL ? ((colis.finL * colis.finW * colis.finH) / 5000) : 0;
      return `Objet : 💳 Devis final — ${colis.ref} : ${eur(colis.devisTotal)}

Bonjour ${c.nom},

Le devis final pour votre expédition est prêt.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 VOTRE EXPÉDITION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Référence : ${colis.ref}
Destination : ${dest.flag} ${dest.nom}

${cartonsInfo}
${pvAvant > 0 ? `\nPoids volumétrique total avant optimisation : ${pvAvant.toFixed(2)} kg` : ''}${pvApres > 0 ? `\nAprès optimisation : Volume ${colis.finL} × ${colis.finW} × ${colis.finH} cm — poids vol. ${pvApres.toFixed(2)} kg` : ''}

Poids facturable : ${pf} kg
${colis.lignes?.length > 0 ? `\nContenu déclaré :\n${colis.lignes.map((l) => `  • ${l.desc} × ${l.qte} — ${eur(l.prix * l.qte)}`).join('\n')}\n` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 DÉTAIL DU DEVIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Transport ........................ ${eur(colis.devisTransport)}
🏛️ Taxes douanières ................. ${eur((colis.devisOM || 0) + (colis.devisOMR || 0))}
   (Octroi de Mer + Octroi de Mer Régional)
📊 TVA (${dest.tva}%) ..................... ${eur(colis.devisTVA)}
${colis.fraisDivers?.length > 0 ? colis.fraisDivers.map((f) => `📎 ${f.libelle} ..................... ${eur(f.montant)}`).join('\n') + '\n' : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 TOTAL                              ${eur(colis.devisTotal)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${colis.economie > 0 ? `\n✅ Économie réalisée : ${eur(colis.economie)}\nGrâce à l'optimisation, vous économisez par rapport\naux dimensions d'origine (${eur(colis.avantOptimTotal)}).\n` : ''}
Pour déclencher l'expédition, réglez ce montant :
• Sur votre espace client en ligne
• Par virement bancaire
• En nous contactant

Une question ? Répondez à cet email.

Cordialement,
L'équipe Expedîle
Paris → ${dest.nom}`;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // ⏰ RELANCE FEU VERT
  // ═══════════════════════════════════════════════════════════════
  relance_feu_vert: {
    label: '⏰ Relance feu vert',
    meta: {
      name: 'relance_feu_vert',
      lang: 'fr',
      params: (c, colis) => [c.nom.split(' ')[0], colis.ref],
    },
    telegram: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋

Petit rappel amical 😊 Votre colis *${colis.ref}* (${colis.desc}) attend toujours votre accord pour la préparation.

📐 *Dimensions :* ${dimsText(colis) || '—'}

✅ Répondez *OUI* pour autoriser la préparation
❌ Répondez *NON* pour annuler

${colis.factures?.length > 0 ? '' : `📄 *Rappel :* Nous attendons aussi la facture d'achat pour le calcul des taxes.\n`}
⚠️ *Bon à savoir :* Des frais de stockage peuvent s'appliquer après 14 jours de stockage en entrepôt.

_L'équipe Expedîle_`,
    email: (c, colis) =>
      `Objet : ⏰ Rappel — En attente de votre accord pour ${colis.ref}

Bonjour ${c.nom},

Nous nous permettons de vous relancer : votre colis ${colis.ref} (${colis.desc}) est toujours en attente de votre accord pour la préparation.

Dimensions mesurées : ${dimsText(colis) || '—'}

Pour rappel, votre accord nous permet de :
• Optimiser l'emballage
• Préparer l'expédition
• Vous envoyer le devis final
${colis.factures?.length > 0 ? '' : `\nNous attendons également la facture d'achat d'origine.\n`}
Note : Des frais de stockage peuvent s'appliquer après 14 jours.

Répondez simplement à cet email pour nous donner votre accord.

Cordialement,
L'équipe Expedîle`,
  },

  // ═══════════════════════════════════════════════════════════════
  // ⏰ RELANCE PAIEMENT
  // ═══════════════════════════════════════════════════════════════
  relance_paiement: {
    label: '⏰ Relance paiement',
    meta: {
      name: 'relance_paiement',
      lang: 'fr',
      params: (c, colis) => [c.nom.split(' ')[0], colis.ref, eur(colis.devisTotal)],
    },
    telegram: (c, colis) => {
      const dest = getDestByCP(c.cp);
      return `Bonjour ${c.nom.split(' ')[0]} 👋

Votre colis *${colis.ref}* (${colis.desc}) est prêt à partir ! ✈️

💰 *Montant à régler : ${eur(colis.devisTotal)}*

🎯 Destination : ${dest.flag} ${dest.nom}

👉 Dès réception de votre paiement, votre colis sera inclus dans le prochain envoi.

Vous pouvez payer :
  • Sur votre espace client
  • Par virement bancaire
  • En nous contactant

❓ Un souci ? Répondez à ce message, nous sommes là pour vous aider.

_L'équipe Expedîle_`;
    },
    email: (c, colis) => {
      const dest = getDestByCP(c.cp);
      return `Objet : ⏰ Rappel paiement — ${colis.ref} (${eur(colis.devisTotal)})

Bonjour ${c.nom},

Votre colis ${colis.ref} (${colis.desc}) est prêt et n'attend plus que votre paiement pour être expédié vers ${dest.flag} ${dest.nom}.

Montant à régler : ${eur(colis.devisTotal)}

Dès réception de votre paiement, votre colis sera intégré au prochain envoi.

Moyens de paiement :
• En ligne sur votre espace client
• Par virement bancaire
• En nous contactant directement

N'hésitez pas à nous écrire si vous avez des questions.

Cordialement,
L'équipe Expedîle`;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // ✈️ EXPÉDIÉ
  // ═══════════════════════════════════════════════════════════════
  expedie: {
    label: '✈️ Colis expédié',
    meta: {
      name: 'colis_expedie',
      lang: 'fr',
      params: (c, colis) => [c.nom.split(' ')[0], colis.ref, getDestByCP(c.cp).nom],
    },
    telegram: (c, colis) => {
      const dest = getDestByCP(c.cp);
      return `Bonjour ${c.nom.split(' ')[0]} 👋

✈️ *Votre colis est en route !*

📦 *${colis.ref}* — ${colis.desc}
🎯 *Destination :* ${dest.flag} ${dest.nom}
📅 *Expédié le :* ${new Date().toLocaleDateString('fr-FR')}

Vous serez notifié(e) à chaque étape :
  ✈️ Transit → 🏛️ Dédouanement → 📍 Arrivée → 🚚 Livraison

Bonne réception !
_L'équipe Expedîle — Paris → ${dest.nom}_`;
    },
    email: (c, colis) => {
      const dest = getDestByCP(c.cp);
      return `Objet : ✈️ Votre colis ${colis.ref} est en route vers ${dest.nom} !

Bonjour ${c.nom},

Excellente nouvelle ! Votre colis a été expédié depuis notre entrepôt de Paris.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Référence : ${colis.ref}
📋 Contenu : ${colis.desc}
🎯 Destination : ${dest.flag} ${dest.nom}
📅 Date d'expédition : ${new Date().toLocaleDateString('fr-FR')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Vous recevrez une notification à chaque étape :
1. ✈️ Transit
2. 🏛️ Dédouanement
3. 📍 Arrivée à destination
4. 🚚 Livraison

Cordialement,
L'équipe Expedîle
Paris → ${dest.nom}`;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // 📍 ARRIVÉ
  // ═══════════════════════════════════════════════════════════════
  arrive: {
    label: '📍 Arrivé à destination',
    meta: {
      name: 'colis_arrive',
      lang: 'fr',
      params: (c, colis) => [c.nom.split(' ')[0], colis.ref, getDestByCP(c.cp).nom],
    },
    telegram: (c, colis) => {
      const dest = getDestByCP(c.cp);
      return `Bonjour ${c.nom.split(' ')[0]} 👋

📍 *Votre colis est arrivé à ${dest.nom} !*

📦 *${colis.ref}* — ${colis.desc}

🚚 Nous organisons maintenant la livraison. Vous serez prévenu(e) du créneau de livraison.

Merci de vous assurer d'être disponible ou de nous indiquer une personne de contact.

_L'équipe Expedîle_`;
    },
    email: (c, colis) => {
      const dest = getDestByCP(c.cp);
      return `Objet : 📍 Votre colis ${colis.ref} est arrivé à ${dest.nom} !

Bonjour ${c.nom},

Votre colis ${colis.ref} (${colis.desc}) est bien arrivé à ${dest.nom}.

Nous organisons la livraison dans les meilleurs délais. Vous serez prévenu(e) du créneau de livraison.

Merci de vous assurer d'être disponible ou de nous indiquer une personne habilitée à réceptionner le colis.

Cordialement,
L'équipe Expedîle`;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // 🚚 EN LIVRAISON
  // ═══════════════════════════════════════════════════════════════
  en_livraison: {
    label: '🚚 En livraison',
    meta: {
      name: 'en_livraison',
      lang: 'fr',
      params: (c, colis) => [c.nom.split(' ')[0], colis?.ref || ''],
    },
    telegram: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋

🚚 *Votre colis ${colis?.ref || ''} est en cours de livraison !*

📦 ${colis?.desc || 'Votre colis'}

Le livreur est en route. Merci de rester disponible.

📞 En cas d'absence, le livreur vous contactera pour reprogrammer.

_L'équipe Expedîle_`,
    email: (c, colis) =>
      `Objet : 🚚 Livraison en cours — ${colis?.ref || 'Votre colis'}

Bonjour ${c.nom},

Votre colis ${colis?.ref || ''} (${colis?.desc || ''}) est en cours de livraison aujourd'hui.

Le livreur est en route vers votre adresse. Merci de rester disponible.

En cas d'absence, le livreur vous contactera pour convenir d'un nouveau créneau.

Cordialement,
L'équipe Expedîle`,
  },

  // ═══════════════════════════════════════════════════════════════
  // ❌ FACTURE REJETÉE
  // ═══════════════════════════════════════════════════════════════
  facture_rejetee: {
    label: '❌ Facture rejetée',
    meta: {
      name: 'facture_rejetee',
      lang: 'fr',
      params: (c, colis) => [c.nom.split(' ')[0], colis.ref],
    },
    telegram: (c, colis) =>
      `Bonjour ${c.nom.split(' ')[0]} 👋

⚠️ La facture transmise pour votre colis *${colis.ref}* (${colis.desc}) n'a pas pu être validée.

📄 *Motif :* ${colis._motifRejet || 'Document non conforme ou illisible'}

👉 Merci de nous renvoyer une facture conforme :
  • Photo ou PDF lisible
  • Avec le détail des articles et les montants
  • Au nom de l'acheteur

Sans facture validée, nous ne pouvons pas calculer les taxes ni avancer sur votre colis.

_L'équipe Expedîle_`,
    email: (c, colis) =>
      `Objet : ⚠️ Facture non validée — ${colis.ref}

Bonjour ${c.nom},

La facture que vous nous avez transmise pour votre colis ${colis.ref} (${colis.desc}) n'a malheureusement pas pu être validée.

Motif : ${colis._motifRejet || 'Document non conforme ou illisible'}

Pour que nous puissions poursuivre le traitement, merci de nous renvoyer :
• Une facture lisible (photo nette ou PDF)
• Avec le détail des articles achetés et les montants
• Au nom de l'acheteur

Cordialement,
L'équipe Expedîle`,
  },

  // ═══════════════════════════════════════════════════════════════
  // ✍️ MESSAGE LIBRE
  // ═══════════════════════════════════════════════════════════════
  libre: {
    label: '✍️ Message libre',
    telegram: (c) => `Bonjour ${c.nom.split(' ')[0]} 👋\n\n\n\n_L'équipe Expedîle_`,
    email: (c) => `Objet : \n\nBonjour ${c.nom},\n\n\n\nCordialement,\nL'équipe Expedîle`,
  },

  invitation_telegram: {
    label: '📲 Invitation Telegram',
    telegram: (c) => '',
    email: (c) => {
      const prenom = c.nom?.split(' ')[0] || 'Client';
      const inviteLink = `https://t.me/Expedilebot?start=${c.id || ''}`;
      return `Objet : 📲 Activez vos notifications Expedile sur Telegram

Bonjour ${prenom},

Pour recevoir les notifications en temps reel concernant vos colis (reception, devis, expedition, livraison), activez votre compte Telegram Expedile en un clic :

${inviteLink}

C'est simple :
1. Cliquez sur le lien ci-dessus
2. Telegram s'ouvre avec notre bot @Expedilebot
3. Appuyez sur "Demarrer"
4. C'est fait ! Vous recevrez toutes vos notifications ici.

Si vous n'avez pas Telegram, telechargez-le gratuitement sur telegram.org

Cordialement,
L'equipe Expedile`;
    },
  },
};

export const TEMPLATE_LABELS = {};
Object.entries(MSG_TEMPLATES).forEach(([k, v]) => { TEMPLATE_LABELS[k] = v.label; });
