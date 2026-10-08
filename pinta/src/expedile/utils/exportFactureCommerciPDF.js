import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  COMMERCIAL_INVOICE_COLUMNS, COMMERCIAL_INVOICE_FOOTER, COMMERCIAL_INVOICE_NOTE, COMMERCIAL_INVOICE_PARTIES,
  commercialInvoiceBasis, commercialInvoiceFileName, invoiceDayLabel,
} from '../domain/commercialInvoice.js';
import { partyLines } from '../domain/invoiceIdentity.js';
import { pdfMoney, pdfNumber, pdfText, pdfUnit } from './pdfFormat.js';

// The commercial invoice of a departure (domain/commercialInvoice.js) as an A4 landscape
// PDF: at the top, the exporter and the consignee side by side (Paramètres › Facture
// commerciale) and the departure on the right; the line saying which edition it is (before
// the departure or from its manifest, and when); then one row per article with its share of
// the transport, the totals and the allocation rule. Every text goes through pdfText: the
// standard font cannot draw a character outside WinAnsi.

const NAVY = [27, 58, 75];
const GREY = [96, 96, 96];
const MARGIN = 14;
// The two parties, side by side on the left of the departure (92 mm on the right, 12 mm apart).
const PARTY_WIDTH = 78;
const PARTY_GAP = 9;
const DEPARTURE_WIDTH = 92;
const PARTY_LINE = 8.5 * 1.35 * 25.4 / 72; // mm between two lines of 8,5 pt
// Quantity and amounts: right-aligned, in the body, the header and the totals.
const NUMERIC = new Set([4, 5, 6, 7, 8]);
// A right-aligned figure is placed from its measured width: jsPDF measures a no-break space (« 1 189,50 € ») at
// 0.53 em where Helvetica draws 0.28 em, so an amount of 1 000 € or more would stop short of the others in its
// column. Its spaces are plain in the cells (the columns are wide enough for it never to wrap there).
const cellNumber = text => text.replace(/\u00a0/g, ' ');

/** A party under its label at (x, y): its name in bold, then its lines, each wrapped to `width` (never cut).
 *  Returns the baseline of its last line. */
function drawParty(doc, label, lines, x, y, width) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GREY);
  doc.text(pdfText(label), x, y);
  let baseline = y + 4.5 - PARTY_LINE;
  lines.forEach((line, index) => {
    doc.setFont('helvetica', index === 0 ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(40, 40, 40);
    for (const piece of doc.splitTextToSize(pdfText(line), width)) {
      baseline += PARTY_LINE;
      doc.text(piece, x, baseline);
    }
  });
  return baseline;
}

/** The PDF document and its file name, « facture-commerciale-ENV-2026-036.pdf » from the manifest,
 *  « facture-commerciale-ENV-2026-036-avant-depart.pdf » before the departure (nothing is saved). */
export function buildCommercialInvoicePDF(invoice) {
  if (!invoice?.ok) throw new Error('La facture commerciale comporte des points à corriger : aucun document n’est généré.');
  const { meta, rows, totals } = invoice;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const text = (value, ...rest) => doc.text(Array.isArray(value) ? value.map(pdfText) : pdfText(value), ...rest);

  // The letterhead, then the exporter and the consignee of the departure, side by side.
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  text('EXPEDÎLE', MARGIN, 18);
  const [exporterLabel, consigneeLabel] = COMMERCIAL_INVOICE_PARTIES;
  const partiesEnd = Math.max(
    drawParty(doc, exporterLabel, partyLines(meta.exporter), MARGIN, 25, PARTY_WIDTH),
    drawParty(doc, consigneeLabel, partyLines(meta.consignee), MARGIN + PARTY_WIDTH + PARTY_GAP, 25, PARTY_WIDTH),
  ) + 1.5;

  // The departure
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  text('FACTURE COMMERCIALE', width - MARGIN, 18, { align: 'right' });
  const departure = [
    ['N° de facture', meta.number || 'Non renseigné'],
    ['Date', invoiceDayLabel(meta.date) || 'Non renseignée'],
    ['Départ prévu', invoiceDayLabel(meta.departureDate) || 'Non renseigné'],
    ['Destination', meta.destination || 'Non renseignée'],
    ...(meta.mode ? [['Mode de transport', meta.mode]] : []),
    ['Expéditions', String(meta.dossiers)],
    ['Nombre de colis', meta.parcels > 0 ? String(meta.parcels) : 'Non renseigné'],
    ['Poids brut total', meta.weight > 0 ? pdfUnit(meta.weight, 'kg') : 'Non renseigné'],
  ];
  autoTable(doc, {
    startY: 22,
    margin: { left: width - MARGIN - DEPARTURE_WIDTH, right: MARGIN },
    tableWidth: DEPARTURE_WIDTH,
    theme: 'plain',
    body: departure.map(row => row.map(pdfText)),
    styles: { fontSize: 8.5, cellPadding: { top: 0.7, bottom: 0.7, left: 0, right: 2 }, textColor: [40, 40, 40] },
    columnStyles: { 0: { cellWidth: 34, fontStyle: 'bold', textColor: GREY }, 1: { cellWidth: 58 } },
  });

  // Under the header, what the document was established from and when.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  const basis = doc.splitTextToSize(pdfText(commercialInvoiceBasis(meta)), width - 2 * MARGIN);
  const basisY = Math.max(doc.lastAutoTable.finalY, partiesEnd, 46) + 6;
  doc.text(basis, MARGIN, basisY, { lineHeightFactor: 1.3 });

  // Articles
  autoTable(doc, {
    startY: basisY + basis.length * 4.2 + 1.5,
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
    head: [COMMERCIAL_INVOICE_COLUMNS.map(pdfText)],
    body: rows.map(row => [
      row.ref, row.clientName, row.hsCode, row.description, cellNumber(pdfNumber(row.quantity)),
      cellNumber(pdfMoney(row.unitPrice)), cellNumber(pdfMoney(row.value)), cellNumber(pdfMoney(row.transport)), cellNumber(pdfMoney(row.total)),
    ].map(pdfText)),
    foot: [[
      { content: pdfText('Total'), colSpan: 6 },
      cellNumber(pdfMoney(totals.value)), cellNumber(pdfMoney(totals.transport)), cellNumber(pdfMoney(totals.total)),
    ]],
    showFoot: 'lastPage',
    // An article is never cut across two pages (its description on several lines): the row moves whole.
    rowPageBreak: 'avoid',
    theme: 'striped',
    styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak', valign: 'top', textColor: [30, 30, 30], lineColor: [222, 226, 230] },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', valign: 'bottom' },
    footStyles: { fillColor: [232, 239, 243], textColor: NAVY, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [247, 248, 249] },
    columnStyles: {
      0: { cellWidth: 28 }, 1: { cellWidth: 40 }, 2: { cellWidth: 22 }, 3: { cellWidth: 'auto' }, 4: { cellWidth: 12 },
      5: { cellWidth: 23 }, 6: { cellWidth: 24 }, 7: { cellWidth: 25 }, 8: { cellWidth: 24 },
    },
    didParseCell: (data) => {
      if (NUMERIC.has(data.column.index) || (data.section === 'foot' && data.column.index === 0)) data.cell.styles.halign = 'right';
    },
  });

  // How the transport was allocated, under the totals.
  let noteY = doc.lastAutoTable.finalY + 7;
  if (noteY > height - 22) { doc.addPage(); noteY = 20; }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  text(COMMERCIAL_INVOICE_NOTE, MARGIN, noteY);

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(110, 110, 110);
    text(COMMERCIAL_INVOICE_FOOTER, MARGIN, height - 8);
    text(`${meta.number || ''}${meta.number ? ' · ' : ''}Page ${page}/${pages}`, width - MARGIN, height - 8, { align: 'right' });
  }
  return { doc, filename: `${commercialInvoiceFileName(invoice)}.pdf` };
}

/** Downloads the PDF; returns the number of article rows. */
export function exportFactureCommerciPDF(invoice) {
  const { doc, filename } = buildCommercialInvoicePDF(invoice);
  doc.save(filename);
  return invoice.rows.length;
}
