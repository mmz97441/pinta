import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  COMMERCIAL_INVOICE_COLUMNS, COMMERCIAL_INVOICE_EXPORTER, COMMERCIAL_INVOICE_FOOTER, COMMERCIAL_INVOICE_NOTE,
  commercialInvoiceBasis, commercialInvoiceFileName, invoiceDayLabel,
} from '../domain/commercialInvoice.js';
import { pdfMoney, pdfNumber, pdfText, pdfUnit } from './pdfFormat.js';

// The commercial invoice of a departure (domain/commercialInvoice.js) as an A4 landscape
// PDF: the exporter and the departure, the line saying which edition it is (before the
// departure or from its manifest, and when), then one row per article with its share of
// the transport, the totals and the allocation rule. Every text goes through pdfText: the
// standard font cannot draw a character outside WinAnsi.

const NAVY = [27, 58, 75];
const GREY = [96, 96, 96];
const MARGIN = 14;
// Quantity and amounts: right-aligned, in the body, the header and the totals.
const NUMERIC = new Set([4, 5, 6, 7, 8]);

/** The PDF document and its file name, « facture-commerciale-ENV-2026-036.pdf » from the manifest,
 *  « facture-commerciale-ENV-2026-036-avant-depart.pdf » before the departure (nothing is saved). */
export function buildCommercialInvoicePDF(invoice) {
  if (!invoice?.ok) throw new Error('La facture commerciale comporte des points à corriger : aucun document n’est généré.');
  const { meta, rows, totals } = invoice;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const text = (value, ...rest) => doc.text(Array.isArray(value) ? value.map(pdfText) : pdfText(value), ...rest);

  // Exporter
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  text('EXPEDÎLE', MARGIN, 18);
  doc.setFontSize(7.5);
  doc.setTextColor(...GREY);
  text('EXPORTATEUR', MARGIN, 25);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(40, 40, 40);
  text(COMMERCIAL_INVOICE_EXPORTER, MARGIN, 29.5, { lineHeightFactor: 1.35 });

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
    ['Nombre de colis', String(meta.parcels)],
    ['Poids brut total', meta.weight > 0 ? pdfUnit(meta.weight, 'kg') : 'Non renseigné'],
  ];
  autoTable(doc, {
    startY: 22,
    margin: { left: width - MARGIN - 92, right: MARGIN },
    tableWidth: 92,
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
  const basisY = Math.max(doc.lastAutoTable.finalY, 46) + 6;
  doc.text(basis, MARGIN, basisY, { lineHeightFactor: 1.3 });

  // Articles
  autoTable(doc, {
    startY: basisY + basis.length * 4.2 + 1.5,
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
    head: [COMMERCIAL_INVOICE_COLUMNS.map(pdfText)],
    body: rows.map(row => [
      row.ref, row.clientName, row.hsCode, row.description, pdfNumber(row.quantity),
      pdfMoney(row.unitPrice), pdfMoney(row.value), pdfMoney(row.transport), pdfMoney(row.total),
    ].map(pdfText)),
    foot: [[
      { content: pdfText('Total'), colSpan: 6 },
      pdfMoney(totals.value), pdfMoney(totals.transport), pdfMoney(totals.total),
    ]],
    showFoot: 'lastPage',
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
