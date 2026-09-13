const PUBLISHED_STATES = new Set(['devis_envoye', 'attente_paiement', 'paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre']);

export function hasPublishedQuote(colis) {
  return Boolean(colis && !colis.devisBrouillon && Number(colis.devisTotal) > 0 && PUBLISHED_STATES.has(colis.statut));
}
