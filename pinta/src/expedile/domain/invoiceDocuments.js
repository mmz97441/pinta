/** Documents retained for audit remain visible, but must not count twice in
 * review queues, client correction requests, or the merchandise value. */
export function currentInvoices(invoices = []) {
  const originals = (invoices || []).filter(invoice => !(invoice.duplicateOfId || invoice.duplicate_of_facture_id));
  const replaced = new Set((invoices || []).map(invoice => invoice.replacesFactureId || invoice.replaces_facture_id).filter(Boolean));
  return originals.filter(invoice => !replaced.has(invoice.id) && !(invoice.replacedById || invoice.replaced_by_id));
}

export function excludedInvoiceIds(invoices = []) {
  const currentIds = new Set(currentInvoices(invoices).filter(invoice => !(invoice.rejetMotif || invoice.rejet_motif)).map(invoice => invoice.id));
  return new Set((invoices || []).filter(invoice => invoice.id && !currentIds.has(invoice.id)).map(invoice => invoice.id));
}
