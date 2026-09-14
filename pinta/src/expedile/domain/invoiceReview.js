import { safeWorkReturn } from './personalWork.js';

// Reading a conversation never acknowledges a document review. The persisted
// invoice state is shared by the whole team, including after a page reload.
export function invoicesAwaitingReview(dossier) {
  if (!dossier || dossier.archive || dossier.paiementDate || dossier.paiement_date
    || !['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'pret', 'devis_envoye', 'attente_paiement'].includes(dossier.statut)) return [];
  const invoices = dossier.factures || [];
  const replaced = new Set(invoices.map(invoice => invoice.replacesFactureId || invoice.replaces_facture_id).filter(Boolean));
  return invoices.filter(invoice => !invoice.valide && !(invoice.rejetMotif || invoice.rejet_motif)?.trim()
    && !replaced.has(invoice.id)
    && Boolean((invoice.fichier || invoice.fichierUrl || invoice.fichier_url || '').trim()));
}

export function invoiceReviewLabel(count) {
  return count === 1 ? 'Facture reçue · À vérifier' : `${count} factures reçues · À vérifier`;
}

export function invoiceReviewUrl(dossier, returnTo = '/colis') {
  const invoice = invoicesAwaitingReview(dossier)[0];
  if (!invoice) return null;
  const params = new URLSearchParams({ returnTo: safeWorkReturn(returnTo, '/colis'), invoice: invoice.id });
  return `/colis/${encodeURIComponent(dossier.id)}?${params}#quote-documents`;
}
