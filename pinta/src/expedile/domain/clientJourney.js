import { receptionCartonManifest } from './reception.js';
import { currentInvoices } from './invoiceDocuments.js';
/** Client-facing facts only. A status never implies a delivery date. */
export function cartonManifest(colis) {
  const trackings = [...new Set((colis?.trackings || []).map(String).map((s) => s.trim()).filter(Boolean))];
  const count = receptionCartonManifest(colis).nbColis;
  return { id: colis.id, ref: colis.ref, updatedAt: colis.updatedAt, count, trackings };
}

export const PAYMENT_TERMS = {
  payplug: 'Carte bancaire sécurisée', virement: 'Virement bancaire', especes: 'Espèces',
  '30_jours': 'Paiement à 30 jours', fin_de_mois: 'Paiement en fin de mois',
};

/** Same saved facts for the portal and the PDF; legacy data has no invented tax rate. */
export function quotePresentation(colis, client = {}, destination = {}) {
  const snapshot = colis.devisSnapshot || colis.quoteSnapshot;
  if (!snapshot?.inputs || !snapshot?.amounts) return {
    colis, client, destination: { ...destination, tva: null },
    paymentMode: colis.modePaiementPro || null, version: colis.quoteVersion || null, issuedAt: null,
  };
  const { inputs, amounts } = snapshot;
  return {
    colis: { ...colis, ref: inputs.reference || colis.ref, desc: inputs.description,
      finalPackages: inputs.finalPackages || (inputs.finalBox ? [inputs.finalBox] : []),
      trackings: inputs.trackings || [], fraisDivers: inputs.fees || [],
      finL: inputs.finalBox?.dimL, finW: inputs.finalBox?.dimW, finH: inputs.finalBox?.dimH, finP: inputs.finalBox?.poids,
      devisTransport: amounts.transport, devisOM: amounts.om, devisOMR: amounts.omr, devisTVA: amounts.tva,
      devisTotal: amounts.total, poidsFact: amounts.billableWeight, economie: snapshot.savings || 0,
      avantOptimTransport: snapshot.before?.transport ?? null, avantOptimTotal: snapshot.before?.total ?? null },
    client: { ...client, ...inputs.client }, destination: { ...destination, ...inputs.destination },
    paymentMode: inputs.paymentTerms?.mode || null, version: snapshot.version || colis.quoteVersion || null,
    issuedAt: snapshot.createdAt || snapshot.created_at || null,
  };
}

const STATES = {
  receptionne: ['Colis réceptionné', 'Notre équipe', 'Mesurer les cartons réceptionnés.'],
  mesure: ['Mesures enregistrées', 'Notre équipe', 'Vous transmettre la demande de préparation.'],
  attente_feu_vert: ['Votre accord est attendu', 'À vous', 'Autoriser la préparation ou demander à attendre.'],
  autorise: ['Votre accord est enregistré', 'Notre équipe', 'Commencer la préparation.'],
  refuse_client: ['Préparation refusée', 'Notre équipe', 'Convenir avec vous de la suite du dossier.'],
  en_preparation: ['Préparation en cours', 'Notre équipe', 'Optimiser le colis et établir le devis final.'],
  devis_envoye: ['Devis reçu — en attente de paiement', 'À vous', 'Consulter le devis et ses modalités de règlement.'],
  attente_paiement: ['Devis reçu — en attente de paiement', 'À vous', 'Consulter le devis et ses modalités de règlement.'],
  paye: ['Paiement reçu', 'Notre équipe', 'Préparer le départ de votre colis.'],
  expedie: ['Colis expédié', 'Transporteur', 'Acheminer votre colis vers sa destination.'],
  transit: ['Colis en transit', 'Transporteur', 'Acheminer votre colis vers sa destination.'],
  dedouanement: ['Dédouanement en cours', 'Notre équipe', 'Finaliser le dédouanement avant la mise à disposition locale.'],
  arrive: ['Colis au dépôt local', 'Notre équipe', 'Organiser la livraison.'],
  livraison: ['Livraison en cours', 'Transporteur', 'Livrer votre colis. La date sera précisée lorsqu’elle sera confirmée.'],
  livre: ['Colis livré', null, 'Le parcours de livraison est terminé.'],
  annule: ['Dossier annulé', null, 'Consultez les échanges pour les dispositions convenues.'],
};

export function clientJourney(colis, now = Date.now()) {
  const waiting = hasClientRequestedWait(colis);
  const reviewDue = waiting && !!colis.attenteClientUntil && Date.parse(colis.attenteClientUntil) <= now;
  const quoteNeedsReview = needsQuoteRecalculation(colis);
  const [label, actor, next] = waiting
    ? ['En attente à votre demande', 'À vous, lorsque vous serez prêt', 'Autoriser la préparation lorsque vos achats sont réunis.']
    : quoteNeedsReview ? ['Devis en cours de révision', 'Notre équipe', 'Vérifier les changements et vous transmettre un nouveau devis. Aucun règlement n’est demandé pour le devis retiré.']
    : STATES[colis.statut] || ['État à préciser', 'Notre équipe', 'Confirmer la prochaine étape du dossier.'];
  const events = [
    ['Réception enregistrée', colis.dateReception], ['Demande d’accord envoyée', colis.demandeFeuVertEnvoyeeAt],
    ['Attente demandée', colis.attenteClientDate], [colis.feuVert === 'refuse' || colis.statut === 'refuse_client' ? 'Refus enregistré' : 'Accord enregistré', colis.feuVertDate],
    ['Devis envoyé', colis.devisEnvoyeLe], ['Paiement reçu', colis.paiementDate], ['Expédition enregistrée', colis.dateExpedition], ['Livraison confirmée', colis.dateLivraison],
  ].filter(([, date]) => date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= now)
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
  return { label, actor, next, waiting, reviewDue, quoteNeedsReview, event: events[0] ? { label: events[0][0], date: events[0][1] } : null };
}

export function hasClientRequestedWait(colis) {
  return colis?.statut === 'attente_feu_vert' && !!colis.attenteClientDate;
}

export function needsQuoteRecalculation(colis) {
  if (typeof colis?.quoteNeedsReview === 'boolean') return colis.quoteNeedsReview;
  return !!colis && !colis.paiementDate && (['devis_envoye', 'attente_paiement'].includes(colis.statut) || !!colis.devisEnvoyeLe)
    && (colis.devisBrouillon === true || !(Number(colis.devisTotal) > 0));
}

/** One expedition belongs to one section; a withdrawn quote never requests payment. */
export function clientWorkState(colis, client = {}) {
  const journey = clientJourney(colis);
  if (['livre', 'annule'].includes(colis.statut) || colis.archive) return { section: 'history', action: 'Consulter le dossier', journey };
  if (journey.waiting) return { section: 'waiting', action: 'Consulter mon attente', journey };
  if (colis.statut === 'attente_feu_vert') return { section: 'todo', action: 'Donner mon accord ou attendre', journey };
  if (['devis_envoye', 'attente_paiement'].includes(colis.statut) && !journey.quoteNeedsReview && !colis.paiementDate)
    return { section: 'todo', action: client.type === 'pro' ? 'Consulter les modalités de règlement' : colis.payplugPaymentUrl ? 'Consulter et régler le devis' : 'Consulter le devis et le règlement', journey };
  const rejected = currentInvoices(colis.factures).some(invoice => invoice.rejetMotif || invoice.rejet_motif);
  if (rejected && !colis.paiementDate) return { section: 'todo', action: 'Corriger une facture', journey };
  return { section: 'team', action: 'Suivre mon expédition', journey };
}
