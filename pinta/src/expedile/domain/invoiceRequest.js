import { currentInvoices } from './invoiceDocuments.js';

/** A received document awaits staff review; it must not be requested again. */
export function invoiceRequestState(colis = {}) {
  const invoices = currentInvoices(colis.factures || []);
  const correction = invoices.some(invoice => Boolean(invoice.rejetMotif || invoice.rejet_motif));
  const received = invoices.filter(invoice => !(invoice.rejetMotif || invoice.rejet_motif));
  const documented = received.filter(invoice => invoice.valide || invoice.fichier || invoice.fichierUrl || invoice.fichier_url);
  return { requested: correction || received.length === 0, correction, receivedCount: documented.length,
    ambiguous: documented.length < received.length, pending: received.some(invoice => !invoice.valide) };
}

export function invoiceRequestText(colis = {}) {
  const state = invoiceRequestState(colis);
  if (state.correction) return 'Une facture reste à corriger. Déposez sa version lisible dans les documents de ce dossier.';
  if (state.requested) return 'Merci de joindre vos factures d’achat (PDF ou photos lisibles) dans les documents de ce dossier.';
  if (state.ambiguous) return 'Nous vérifions les justificatifs enregistrés dans votre dossier.';
  return state.pending ? 'Vos documents sont reçus et attendent notre vérification.' : 'Vos factures sont enregistrées dans ce dossier.';
}
