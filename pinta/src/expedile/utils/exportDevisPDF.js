import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { quotePresentation, PAYMENT_TERMS, cartonManifest } from '../domain/clientJourney';

export function exportDevisPDF(colis, client, destination) {
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
  const doc = new jsPDF();

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('EXPEDÎLE', 14, 20);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Service de réexpédition DOM-TOM', 14, 26);
  doc.text('Paris, France', 14, 30);

  // Devis info
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(isEstimate ? 'ESTIMATION' : 'DEVIS', 140, 20);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Référence : ${colis.ref}`, 140, 28);
  doc.text(issuedAt ? `Établi le : ${new Date(issuedAt).toLocaleDateString('fr-FR')}` : (isEstimate ? 'Sous réserve de vérification' : 'Date historique non documentée'), 140, 33);
  if (version) doc.text(`Version : ${version}`, 140, 38);

  // Client info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Client', 14, 45);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(client?.nom || '—', 14, 51);
  doc.text(destination?.nom || '', 14, 56);
  if (client?.email) doc.text(client.email, 14, 61);

  // Colis details
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Détails du colis', 14, 75);

  const colisDetails = [
    ['Contenu', colis.desc || '—'],
    ['Nombre de cartons', String(cartonManifest(colis).count)],
  ];
  if (client?.type === 'pro' && snapshot?.inputs?.paymentTerms?.mode) {
    colisDetails.push(['Modalités de règlement', PAYMENT_TERMS[snapshot.inputs.paymentTerms.mode] || snapshot.inputs.paymentTerms.mode]);
  }
  if (colis.finL) {
    colisDetails.push(['Dimensions optimisées', `${colis.finL} × ${colis.finW} × ${colis.finH} cm`]);
    colisDetails.push(['Poids après optimisation', `${colis.finP || '—'} kg`]);
  }
  if (colis.dimL) {
    colisDetails.push(['Dimensions réception', `${colis.dimL} × ${colis.dimW} × ${colis.dimH} cm`]);
    colisDetails.push(['Poids réception', `${colis.poids || '—'} kg`]);
  }
  colisDetails.push(['Poids facturable', `${colis.poidsFact || colis.finP || colis.poids || '—'} kg`]);

  autoTable(doc, {
    startY: 80,
    body: colisDetails,
    theme: 'plain',
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 50, textColor: [100, 100, 100] },
      1: { cellWidth: 80 },
    },
  });

  // Devis breakdown
  const devisY = doc.lastAutoTable.finalY + 15;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Ventilation du devis', 14, devisY);

  const devisRows = [['Transport', `${Number(colis.devisTransport || 0).toFixed(2)} €`]];
  if (client?.type !== 'pro') devisRows.push(
    ['Octroi de Mer (OM)', `${Number(colis.devisOM || 0).toFixed(2)} €`],
    ['Octroi de Mer Régional (OMR)', `${Number(colis.devisOMR || 0).toFixed(2)} €`],
    [destination?.tva == null ? 'TVA (taux historique non documenté)' : `TVA (${destination.tva}%)`, `${Number(colis.devisTVA || 0).toFixed(2)} €`],
  );

  // Add frais divers if any
  if (colis.fraisDivers?.length > 0) {
    colis.fraisDivers.forEach(f => {
      devisRows.push([f.libelle, `${Number(f.montant || 0).toFixed(2)} €`]);
    });
  }

  autoTable(doc, {
    startY: devisY + 5,
    body: devisRows,
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
  doc.text(`TOTAL : ${(colis.devisTotal || 0).toFixed(2)} €`, 196, totalY + 10, { align: 'right' });

  // Savings
  if (colis.economie > 0) {
    doc.setFontSize(9);
    doc.setTextColor(16, 185, 129);
    doc.text(`Économie réalisée grâce à l'optimisation : ${(colis.economie || 0).toFixed(2)} €`, 196, totalY + 18, { align: 'right' });
  }

  // Footer
  doc.setTextColor(150, 150, 150);
  doc.setFontSize(7);
  if (isEstimate) {
    doc.text('Estimation indicative. Montant définitif après réception, mesure et vérification des documents.', 14, 277);
  }
  doc.text('Expedîle — Service de réexpédition Paris → DOM-TOM', 14, 285);
  doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 196, 285, { align: 'right' });

  doc.save(`${isEstimate ? 'estimation' : 'devis'}-${colis.ref}${version ? `-v${version}` : ''}.pdf`);
}
