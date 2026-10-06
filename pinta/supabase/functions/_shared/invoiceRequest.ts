// « Facture encore demandée » on the server: the rule of queue_message's invoice_requested
// (migration 20260920000001, demande_feu_vert) and of register_telegram_document's
// confirmation case (20261006000002), on the dossier's factures rows.
// A current invoice is neither a retired copy (duplicate_of_facture_id) nor replaced by
// another invoice (replaces_facture_id). The invoice is still requested when no current
// invoice is free of a rejection, or when a current invoice is rejected. rejet_motif is
// tested like SQL « IS NOT NULL ». The front mirror is src/expedile/domain/invoiceRequest.js.
export type InvoiceRow = { id?: string | null; duplicate_of_facture_id?: string | null; replaces_facture_id?: string | null;
  rejet_motif?: string | null; valide?: boolean | null };

const present = (value: unknown) => value !== null && value !== undefined;

/** Current invoices only: retired copies and replaced invoices stay in history. */
export function currentInvoices<T extends InvoiceRow>(rows: T[] | null | undefined): T[] {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const replaced = new Set(list.map(row => row.replaces_facture_id).filter(present));
  return list.filter(row => !present(row.duplicate_of_facture_id) && !(present(row.id) && replaced.has(row.id)));
}

/** True while the dossier still needs a purchase invoice from the client. */
export function invoiceRequested(rows: InvoiceRow[] | null | undefined): boolean {
  const current = currentInvoices(rows);
  return !current.some(row => !present(row.rejet_motif)) || current.some(row => present(row.rejet_motif));
}
