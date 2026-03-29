import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportDevisPDF(colis, client, destination) {
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
  doc.text('DEVIS', 140, 20);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Référence : ${colis.ref}`, 140, 28);
  doc.text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, 140, 33);

  // Client info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Client', 14, 45);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(client?.nom || '—', 14, 51);
  doc.text(`${destination?.flag || ''} ${destination?.nom || ''}`, 14, 56);
  if (client?.email) doc.text(client.email, 14, 61);

  // Colis details
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Détails du colis', 14, 75);

  const colisDetails = [
    ['Contenu', colis.desc || '—'],
    ['Nombre de cartons', String(colis.trackings?.filter(t => t).length || 1)],
  ];
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

  const devisRows = [
    ['Transport', `${(colis.devisTransport || 0).toFixed(2)} €`],
    ['Octroi de Mer (OM)', `${(colis.devisOM || 0).toFixed(2)} €`],
    ['Octroi de Mer Régional (OMR)', `${(colis.devisOMR || 0).toFixed(2)} €`],
    [`TVA (${destination?.tva || 0}%)`, `${(colis.devisTVA || 0).toFixed(2)} €`],
  ];

  // Add frais divers if any
  if (colis.fraisDivers?.length > 0) {
    colis.fraisDivers.forEach(f => {
      devisRows.push([f.libelle, `${(f.montant || 0).toFixed(2)} €`]);
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
  doc.text('Expedîle — Service de réexpédition Paris → DOM-TOM', 14, 285);
  doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 196, 285, { align: 'right' });

  doc.save(`devis-${colis.ref}.pdf`);
}
