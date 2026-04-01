import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { getDestByCP } from '../constants';

/**
 * Génère et ouvre un PDF d'étiquettes d'expédition pour les colis sélectionnés.
 * Chaque carton = 1 page A5 avec QR code.
 */
export async function printEtiquettes(colisList, clients, getClient) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' });
  let first = true;

  for (const colis of colisList) {
    const cl = getClient(colis.clientId);
    if (!cl) continue;
    const dest = getDestByCP(cl.cp);
    const trackings = colis.trackings?.filter((t) => t) || [];
    const nbCartons = Math.max(trackings.length, 1);

    for (let i = 0; i < nbCartons; i++) {
      if (!first) doc.addPage();
      first = false;

      const w = doc.internal.pageSize.getWidth();
      const h = doc.internal.pageSize.getHeight();

      // Background
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, w, h, 'F');

      // Border
      doc.setDrawColor(27, 58, 75);
      doc.setLineWidth(1);
      doc.rect(3, 3, w - 6, h - 6, 'S');

      // Header bar
      doc.setFillColor(27, 58, 75);
      doc.rect(3, 3, w - 6, 14, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('EXPEDILE', 8, 12);
      doc.setFontSize(11);
      doc.text(`Carton ${i + 1}/${nbCartons}`, w - 8, 12, { align: 'right' });

      // QR Code
      try {
        const qrUrl = `https://expedile.fr/colis/${colis.id}`;
        const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 200, margin: 1 });
        doc.addImage(qrDataUrl, 'PNG', 8, 22, 35, 35);
      } catch (e) {
        console.warn('QR generation failed:', e);
      }

      // Ref + Casier next to QR
      doc.setTextColor(27, 58, 75);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(colis.ref || 'EXP-????', 48, 30);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      if (colis.casier) {
        doc.setFillColor(232, 184, 75);
        doc.roundedRect(48, 33, 25, 7, 1.5, 1.5, 'F');
        doc.setTextColor(18, 42, 54);
        doc.setFont('helvetica', 'bold');
        doc.text(`Casier ${colis.casier}`, 50, 38);
      }

      // Tracking
      if (trackings[i]) {
        doc.setTextColor(100, 100, 100);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`Tracking: ${trackings[i]}`, 48, 47);
      }

      // Poids
      const poids = colis.finP || colis.poids || 0;
      doc.setTextColor(27, 58, 75);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`Poids: ${poids} kg`, 48, 53);

      // Separator line
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.line(8, 62, w - 8, 62);

      // DESTINATAIRE section
      doc.setTextColor(150, 150, 150);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text('DESTINATAIRE', 8, 68);

      doc.setTextColor(27, 58, 75);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      const nomComplet = cl.nom || '';
      doc.text(nomComplet, 8, 76);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);

      let y = 82;
      if (cl.adresseLigne1 || cl.adresse) {
        doc.text(cl.adresseLigne1 || cl.adresse || '', 8, y);
        y += 5;
      }
      if (cl.adresseLigne2) {
        doc.text(cl.adresseLigne2, 8, y);
        y += 5;
      }
      const cpVille = `${cl.cp || ''} ${cl.commune || cl.ville || ''}`.trim();
      if (cpVille) {
        doc.setFont('helvetica', 'bold');
        doc.text(cpVille, 8, y);
        y += 5;
      }
      if (dest) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(`${dest.flag || ''} ${dest.nom || ''}`, 8, y);
      }

      // Envoi date (bottom right)
      if (colis.envoi) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text(`Envoi: ${colis.envoi}`, w - 8, h - 8, { align: 'right' });
      }

      // Description (bottom left)
      if (colis.desc) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text(colis.desc.slice(0, 50), 8, h - 8);
      }
    }
  }

  // Open PDF
  doc.output('dataurlnewwindow');
}
