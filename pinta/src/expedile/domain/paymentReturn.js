const statuses = new Set(['paid', 'pending', 'superseded', 'cancelled', 'unavailable']);

export function paymentReturnFacts(value) {
  if (!value?.ok || !statuses.has(value.status) || value.currency !== 'EUR' || typeof value.reference !== 'string' || !value.reference.trim() || value.status === 'paid' && typeof value.isLive !== 'boolean') throw new Error('Confirmation momentanément indisponible.');
  return {
    ...value,
    amountCents: Number.isSafeInteger(value.amountCents) && value.amountCents > 0 ? value.amountCents : null,
    isLive: typeof value.isLive === 'boolean' ? value.isLive : null,
    shipment: value.shipment || {},
  };
}

export function paymentReturnMessage(payment, cancelled = false) {
  if (payment.status === 'paid') return {
    title: payment.isLive === false ? 'Paiement de test confirmé' : 'Paiement reçu',
    message: payment.isLive === false ? 'La simulation de paiement a bien été enregistrée. Aucun règlement réel n’a été encaissé.' : 'Merci, votre règlement est confirmé. Vous n’avez rien d’autre à faire pour le paiement.',
  };
  if (payment.status === 'superseded') return { title: 'Ce lien correspond à un ancien devis', message: 'Le dossier a été mis à jour. Contactez notre équipe avant de régler à nouveau.' };
  if (payment.status === 'cancelled') return { title: 'Ce lien de paiement est fermé', message: 'Aucun paiement n’est confirmé avec ce lien. Contactez notre équipe pour connaître la suite.' };
  if (payment.status === 'unavailable') return { title: 'Paiement à vérifier avec notre équipe', message: 'Nous ne pouvons pas confirmer ce règlement pour le moment. Ne payez pas une seconde fois avant notre vérification.' };
  return {
    title: cancelled ? 'Paiement à vérifier' : 'Confirmation du paiement en cours',
    message: cancelled ? 'Vous êtes revenu de la page de paiement. Aucun règlement n’est encore confirmé ici. Nous vérifions son état.' : 'Nous attendons la confirmation du paiement. Cela peut prendre quelques instants. Ne payez pas une seconde fois.',
  };
}

export function receiptDate(value, dateOnly = false) {
  if (!value) return null;
  const date = new Date(dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) }) : null;
}

export function paymentShipmentMessage(shipment = {}) {
  if (shipment.status === 'annule') return { title: 'Notre équipe vérifie la suite de votre envoi', message: 'Contactez-nous pour connaître les modalités de prise en charge de ce dossier.' };
  if (shipment.deliveredAt || shipment.status === 'livre') return { title: 'Votre envoi est livré', message: receiptDate(shipment.deliveredAt) ? `Livraison confirmée le ${receiptDate(shipment.deliveredAt)}.` : 'La livraison a été confirmée.' };
  if (shipment.departedAt || ['expedie', 'transit', 'dedouanement', 'arrive', 'livraison'].includes(shipment.status)) return { title: 'Votre envoi a pris le départ', message: receiptDate(shipment.departedAt) ? `Départ enregistré le ${receiptDate(shipment.departedAt)}.` : 'Votre colis poursuit son acheminement.' };
  const date = receiptDate(shipment.departureDate, true);
  return date
    ? { title: `Départ prévu le ${date}`, message: 'Votre envoi est prévu sur ce départ. Notre équipe s’occupe de la suite. Il s’agit de la date de départ, pas de livraison.' }
    : { title: 'Prochaine étape : le départ de votre envoi', message: 'Notre équipe prépare la suite pour le prochain départ disponible. La date apparaîtra ici dès qu’elle sera confirmée.' };
}
