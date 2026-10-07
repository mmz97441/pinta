import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { quotePresentation, PAYMENT_TERMS, cartonManifest } from '../domain/clientJourney';
import { pdfMoney as money, pdfNumber, pdfText, pdfUnit as unit } from './pdfFormat.js';

// Text and French numbers shared with the commercial invoice (pdfFormat.js); pdfText stays exported from here.
export { pdfText } from './pdfFormat.js';

const percent = value => value == null ? 'Non défini' : unit(value, '%');
const size = box => pdfText(`${pdfNumber(box.dimL)} × ${pdfNumber(box.dimW)} × ${pdfNumber(box.dimH)}\u00a0cm`);
const positive = value => Number(value) > 0;
const cells = rows => rows.map(row => row.map(pdfText));

/** The quote document from the saved snapshot. Returns the jsPDF document and its file name (nothing is saved). */
export function buildDevisPDF(colis, client, destination) {
  const snapshot = colis.devisSnapshot || colis.quoteSnapshot;
  const isEstimate = snapshot?.mode === 'estimate';
  const version = snapshot?.version || colis.quoteVersion;
  const issuedAt = snapshot?.createdAt || snapshot?.created_at;
  const published = quotePresentation(colis, client, destination);
  ({ colis, client, destination } = published);
  if (snapshot?.inputs) {
    const original = snapshot.inputs.originalBoxes?.length === 1 ? snapshot.inputs.originalBoxes[0] : null;
    colis = { ...colis, nbColis: Math.max(snapshot.inputs.originalBoxes?.length || 0, snapshot.inputs.trackings?.filter(Boolean).length || 0, 1),
      dimL: original?.dimL, dimW: original?.dimW, dimH: original?.dimH, poids: original?.poids };
  }
  if (!(Number(colis.devisTotal) > 0)) throw new Error('Aucun devis valide à exporter.');
  const pro = client?.type === 'pro';
  const doc = new jsPDF();
  const text = (value, ...rest) => doc.text(pdfText(value), ...rest);

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  text('EXPEDÎLE', 14, 20);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  text('Service de réexpédition DOM-TOM', 14, 26);
  text('Paris, France', 14, 30);

  // Devis info
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  text(isEstimate ? 'ESTIMATION' : 'DEVIS', 140, 20);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  text(`Référence\u00a0: ${colis.ref}`, 140, 28);
  text(issuedAt ? `Établi le ${new Date(issuedAt).toLocaleDateString('fr-FR')}` : (isEstimate ? 'Sous réserve de vérification' : 'Date historique non documentée'), 140, 33);
  if (version) text(`Version\u00a0: ${version}`, 140, 38);

  // Client info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  text('Client', 14, 45);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  text(client?.nom || '—', 14, 51);
  text(destination?.nom || '', 14, 56);
  if (client?.email) text(client.email, 14, 61);

  // Colis details
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  text('Détails du colis', 14, 75);

  const colisDetails = [
    ['Contenu', colis.desc || '—'],
    ['Nombre de cartons', String(cartonManifest(colis).count)],
  ];
  if (pro && snapshot?.inputs?.paymentTerms?.mode) {
    colisDetails.push(['Modalités de règlement', PAYMENT_TERMS[snapshot.inputs.paymentTerms.mode] || snapshot.inputs.paymentTerms.mode]);
  }
  if (colis.finalPackages?.length) {
    colisDetails.push(['Colis après optimisation', String(colis.finalPackages.length)]);
    colis.finalPackages.forEach((box,index) => colisDetails.push([`Colis sortant ${index + 1}`, `${size(box)} · ${unit(box.poids, 'kg')}`]));
  } else if (colis.finL) {
    colisDetails.push(['Dimensions optimisées', size({ dimL: colis.finL, dimW: colis.finW, dimH: colis.finH })]);
    colisDetails.push(['Poids après optimisation', positive(colis.finP) ? unit(colis.finP, 'kg') : '—']);
  }
  if (colis.dimL) {
    colisDetails.push(['Dimensions réception', size(colis)]);
    colisDetails.push(['Poids réception', positive(colis.poids) ? unit(colis.poids, 'kg') : '—']);
  }
  const billable = [colis.poidsFact, colis.finP, colis.poids].find(positive);
  colisDetails.push(['Poids facturable', billable ? unit(billable, 'kg') : '—']);

  autoTable(doc, {
    startY: 80,
    body: cells(colisDetails),
    theme: 'plain',
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 50, textColor: [100, 100, 100] },
      1: { cellWidth: 80 },
    },
  });

  // Devis breakdown: only the amounts that apply (never a « 0,00 € » line).
  const devisY = doc.lastAutoTable.finalY + 15;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  text('Ventilation du devis', 14, devisY);

  const devisRows = [['Transport', money(colis.devisTransport)]];
  if (!pro) {
    if (positive(colis.devisOM)) devisRows.push(['Octroi de mer (OM)', money(colis.devisOM)]);
    if (positive(colis.devisOMR)) devisRows.push(['Octroi de mer régional (OMR)', money(colis.devisOMR)]);
    if (positive(colis.devisTVA)) devisRows.push([destination?.tva == null ? 'TVA (taux historique non documenté)' : `TVA (${percent(destination.tva)})`, money(colis.devisTVA)]);
  }
  for (const fee of colis.fraisDivers || []) {
    if (positive(fee.montant)) devisRows.push([fee.libelle || fee.label || fee.nom || 'Frais complémentaires', money(fee.montant)]);
  }

  autoTable(doc, {
    startY: devisY + 5,
    body: cells(devisRows),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 100 },
      1: { cellWidth: 40, halign: 'right', fontStyle: 'bold' },
    },
    alternateRowStyles: { fillColor: [248, 249, 250] },
  });

  // Total
  const totalY = doc.lastAutoTable.finalY + 5;
  doc.setDrawColor(27, 58, 75);
  doc.setLineWidth(0.5);
  doc.line(14, totalY, 196, totalY);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(27, 58, 75);
  text(`TOTAL\u00a0: ${money(colis.devisTotal)}`, 196, totalY + 10, { align: 'right' });

  // Savings: only the saved, real amount.
  if (positive(colis.economie)) {
    doc.setFontSize(9);
    doc.setTextColor(4, 120, 87);
    text(`Économie réalisée grâce à l’optimisation\u00a0: ${money(colis.economie)}`, 196, totalY + 18, { align: 'right' });
  }

  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(110, 110, 110);
  doc.setFontSize(7);
  if (isEstimate) {
    text('Estimation indicative. Montant définitif après réception, mesure et vérification des documents.', 14, 277);
  }
  text('Expedîle — Service de réexpédition Paris – DOM-TOM', 14, 285);
  text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 196, 285, { align: 'right' });

  const classified = (snapshot?.inputs?.lines || []).filter(line => line.customDuty);
  if (classified.length) {
    doc.addPage();
    doc.setTextColor(27, 58, 75); doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    text('Classement douanier du devis', 14, 20);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    text(`${colis.ref}${version ? ` – version ${version}` : ''} – ${destination?.nom || ''}`, 14, 27);
    text('Taux d’octroi de mer (OM) et d’octroi de mer régional (OMR) à l’importation.', 14, 34);
    autoTable(doc, {
      startY: 40,
      head: cells([['Article et désignation douanière', 'Code douanier', 'OM', 'OMR', 'Référence et correction']]),
      body: cells(classified.map(line => {
        const duty = line.customDuty;
        const source = `${duty.source.label}${duty.source.page ? ` · p. ${duty.source.page}` : ''}`;
        const correction = duty.overrideReason ? `\nTaux source\u00a0: OM ${percent(duty.baseRates?.om)}\u00a0; OMR ${percent(duty.baseRates?.omr)}\nCorrection\u00a0: ${duty.overrideReason}` : '';
        return [`${line.description}\n${duty.label}`, duty.code, percent(duty.rates.om), percent(duty.rates.omr), source + correction];
      })),
      styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 66 }, 1: { cellWidth: 22 }, 2: { cellWidth: 14 }, 3: { cellWidth: 14 }, 4: { cellWidth: 66 } },
      headStyles: { fillColor: [27, 58, 75] }, margin: { bottom: 20 },
    });
  }
  return { doc, filename: `${isEstimate ? 'estimation' : 'devis'}-${colis.ref}${version ? `-v${version}` : ''}.pdf` };
}

export function exportDevisPDF(colis, client, destination) {
  const { doc, filename } = buildDevisPDF(colis, client, destination);
  doc.save(filename);
}
