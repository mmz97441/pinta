import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportFactureCommerciPDF(envoi, colis, clients, categories) {
  const doc = new jsPDF();

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('EXPEDÎLE', 14, 20);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text([
    'GROUPE DELIVREX',
    '5 RUE DE COPENHAGUE',
    'ROISSY POLE BAT AERONEF CS 13918',
    '95731 ROISSY CH DE GAULLE',
  ], 14, 28);

  // Facture info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('FACTURE COMMERCIALE', 120, 20);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  const today = new Date().toLocaleDateString('fr-FR');
  doc.text(`N° de facture : ${envoi?.ref || 'FC-' + today.replace(/\//g, '')}`, 120, 28);
  doc.text(`Date : ${today}`, 120, 33);
  doc.text(`Envoi : ${envoi?.ref || '—'}`, 120, 38);

  // Table data
  const rows = [];
  let sousTotal = 0;

  colis.forEach((c) => {
    const cl = clients.find((x) => x.id === c.clientId);
    const clientRef = `${c.ref} ${cl?.nom || ''}`;

    (c.lignes || []).forEach((ligne) => {
      const cat = categories.find((x) => x.id === ligne.cat);
      const total = (ligne.qte || 1) * (ligne.prix || 0);
      sousTotal += total;
      rows.push([
        cat?.codeHs || cat?.code_hs || '',
        ligne.desc || '',
        ligne.qte || 1,
        `${(ligne.prix || 0).toFixed(2)} €`,
        `${total.toFixed(2)} €`,
        clientRef,
      ]);
    });

    if (!c.lignes || c.lignes.length === 0) {
      const val = c.valeur || 0;
      sousTotal += val;
      rows.push([
        '',
        c.desc || 'Marchandise diverse',
        1,
        `${val.toFixed(2)} €`,
        `${val.toFixed(2)} €`,
        clientRef,
      ]);
    }
  });

  // AutoTable
  autoTable(doc, {
    startY: 50,
    head: [['Code HS', 'Description', 'Qté', 'P.U HT', 'Prix total', 'Référence']],
    body: rows,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [27, 58, 75], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 55 },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 50 },
    },
    alternateRowStyles: { fillColor: [248, 249, 250] },
  });

  // Totals
  const finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(9);
  doc.text(`Sous-total : ${sousTotal.toFixed(2)} €`, 140, finalY, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`TOTAL : ${sousTotal.toFixed(2)} €`, 140, finalY + 8, { align: 'right' });

  // Footer
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Document généré par Expedîle — usage douanier uniquement', 14, 285);

  const filename = `facture-commerciale-${envoi?.ref || 'export'}.pdf`;
  doc.save(filename);
  return rows.length;
}
