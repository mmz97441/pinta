import * as XLSX from 'xlsx';
import {
  COMMERCIAL_INVOICE_COLUMNS, COMMERCIAL_INVOICE_FOOTER, COMMERCIAL_INVOICE_NOTE, COMMERCIAL_INVOICE_PARTIES,
  commercialInvoiceBasis, commercialInvoiceFileName, invoiceDayLabel,
} from '../domain/commercialInvoice.js';
import { partyLines } from '../domain/invoiceIdentity.js';

// The commercial invoice of a departure (domain/commercialInvoice.js) as an Excel sheet
// « Facture commerciale »: the title and the line saying which edition it is (before the
// departure or from its manifest, and when), the exporter and the consignee (Paramètres ›
// Facture commerciale: the label in column A, one printed line per row in column B), the
// departure, then the same columns as the PDF. Amounts are numbers shown in euros
// (« 1 234,50 € » in French Excel), HS codes stay text (leading zeros), the totals are sums
// of the article rows.

export const COMMERCIAL_INVOICE_SHEET = 'Facture commerciale';
const MONEY_FORMAT = '#,##0.00 "€"';
const MONEY_COLUMNS = [5, 6, 7, 8];
const TOTAL_COLUMNS = [6, 7, 8];
const cell = (sheet, r, c) => sheet[XLSX.utils.encode_cell({ r, c })];
/** A party as rows: its label beside its first line, then one line per row. */
const partyRows = (label, party) => partyLines(party).map((line, index) => [index === 0 ? label : null, line]);

/** The workbook and its file name, « facture-commerciale-ENV-2026-036.xlsx » from the manifest,
 *  « facture-commerciale-ENV-2026-036-avant-depart.xlsx » before the departure (nothing is written). */
export function buildCommercialInvoiceWorkbook(invoice) {
  if (!invoice?.ok) throw new Error('La facture commerciale comporte des points à corriger : aucun document n’est généré.');
  const { meta, rows, totals } = invoice;
  const [exporterLabel, consigneeLabel] = COMMERCIAL_INVOICE_PARTIES;
  const header = [
    ['FACTURE COMMERCIALE'],
    [commercialInvoiceBasis(meta)],
    ...partyRows(exporterLabel, meta.exporter),
    ...partyRows(consigneeLabel, meta.consignee),
    [],
    ['N° de facture', meta.number || 'Non renseigné'],
    ['Date', invoiceDayLabel(meta.date) || 'Non renseignée'],
    ['Départ prévu', invoiceDayLabel(meta.departureDate) || 'Non renseigné'],
    ['Destination', meta.destination || 'Non renseignée'],
    ...(meta.mode ? [['Mode de transport', meta.mode]] : []),
    ['Expéditions', meta.dossiers],
    ['Nombre de colis', meta.parcels > 0 ? meta.parcels : 'Non renseigné'],
    ['Poids brut total (kg)', meta.weight > 0 ? meta.weight : 'Non renseigné'],
    [],
  ];
  const columnsRow = header.length;
  const first = columnsRow + 1;
  const last = first + rows.length - 1;
  const totalRow = last + 1;
  const sheet = XLSX.utils.aoa_to_sheet([
    ...header,
    [...COMMERCIAL_INVOICE_COLUMNS],
    ...rows.map(row => [row.ref, row.clientName, row.hsCode, row.description, row.quantity, row.unitPrice, row.value, row.transport, row.total]),
    ['Total', null, null, null, null, null, totals.value, totals.transport, totals.total],
    [],
    [COMMERCIAL_INVOICE_NOTE],
    [COMMERCIAL_INVOICE_FOOTER],
  ]);
  for (let r = first; r <= last; r += 1) {
    const code = cell(sheet, r, 2);
    Object.assign(code, { t: 's', v: String(code.v), z: '@' });
    for (const c of MONEY_COLUMNS) cell(sheet, r, c).z = MONEY_FORMAT;
  }
  // The totals are sums of the rows (their value is kept for readers that do not calculate).
  for (const c of TOTAL_COLUMNS) {
    const column = XLSX.utils.encode_col(c);
    Object.assign(cell(sheet, totalRow, c), { f: `SUM(${column}${first + 1}:${column}${last + 1})`, z: MONEY_FORMAT });
  }
  // SheetJS writes no wrap style: the description and recipient columns take the width of their longest text, up to
  // a cap, so that text is read whole in the sheet and in print rather than cut mid-word by the next column.
  const widest = (field, least, most) => Math.min(most, rows.reduce((width, row) => Math.max(width, String(row[field] ?? '').length + 2), least));
  sheet['!cols'] = [16, widest('clientName', 28, 45), 14, widest('description', 44, 80), 6, 12, 13, 18, 13].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: columnsRow, c: 0 }, e: { r: last, c: COMMERCIAL_INVOICE_COLUMNS.length - 1 } }) };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, COMMERCIAL_INVOICE_SHEET);
  return { book, filename: `${commercialInvoiceFileName(invoice)}.xlsx` };
}

/** Downloads the Excel file; returns the number of article rows. */
export function exportFactureCommerciale(invoice) {
  const { book, filename } = buildCommercialInvoiceWorkbook(invoice);
  XLSX.writeFile(book, filename, { compression: true });
  return invoice.rows.length;
}
