import jsPDF from 'jspdf';
import { getDestByCP } from '../constants';

// QR Code generation using canvas API (no external dependency)
async function generateQRDataUrl(text) {
  try {
    // Use the qrcode library if available
    const QRCode = await import('qrcode');
    return await QRCode.toDataURL(text, { width: 200, margin: 1 });
  } catch {
    // Fallback: return null (no QR code)
    console.warn('[Etiquettes] QR code generation failed, skipping');
    return null;
  }
}

/**
 * Génère et ouvre un PDF d'étiquettes d'expédition pour les colis sélectionnés.
 * Chaque carton = 1 page A5 avec QR code.
 */
export async function printEtiquettes(colisList, clients, getClient) {
  if (!colisList || colisList.length === 0) return;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' });
  let first = true;

  for (const colis of colisList) {
    const cl = typeof getClient === 'function' ? getClient(colis.clientId) : null;
    if (!cl) continue;
    const dest = getDestByCP(cl.cp);
    const trackings = colis.trackings?.filter((t) => t) || [];
    const nbCartons = Math.max(trackings.length, 1);

    for (let i = 0; i < nbCartons; i++) {
      if (!first) doc.addPage();
      first = false;

      const w = doc.internal.pageSize.getWidth();
      const h = doc.internal.pageSize.getHeight();

      // Border
      doc.setDrawColor(27, 58, 75);
      doc.setLineWidth(0.8);
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

      // QR Code — encode full delivery info for driver scanning
      try {
        const qrData = JSON.stringify({
          ref: colis.ref,
          carton: `${i + 1}/${nbCartons}`,
          dest: {
            nom: cl.nom || '',
            prenom: cl.prenom || '',
            adresse: cl.adresseLigne1 || cl.adresse || '',
            adresse2: cl.adresseLigne2 || '',
            cp: cl.cp || '',
            ville: cl.commune || cl.ville || '',
            pays: dest?.nom || '',
          },
          tel: cl.tel || '',
          poids: colis.finP || colis.poids || 0,
          casier: colis.casier || '',
        });
        const qrDataUrl = await generateQRDataUrl(qrData);
        if (qrDataUrl) {
          doc.addImage(qrDataUrl, 'PNG', 8, 22, 35, 35);
        }
      } catch (e) {
        console.warn('QR failed:', e);
      }

      // Ref + Casier
      doc.setTextColor(27, 58, 75);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(colis.ref || 'EXP-????', 48, 32);

      if (colis.casier) {
        doc.setFontSize(10);
        doc.setFillColor(232, 184, 75);
        doc.roundedRect(48, 35, 28, 8, 2, 2, 'F');
        doc.setTextColor(18, 42, 54);
        doc.text(`Casier ${colis.casier}`, 50, 41);
      }

      // Tracking
      if (trackings[i]) {
        doc.setTextColor(120, 120, 120);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`Tracking: ${trackings[i]}`, 48, 50);
      }

      // Poids
      doc.setTextColor(27, 58, 75);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`${colis.finP || colis.poids || '?'} kg`, 48, 56);

      // Separator
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.line(8, 62, w - 8, 62);

      // DESTINATAIRE
      doc.setTextColor(150, 150, 150);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text('DESTINATAIRE', 8, 68);

      doc.setTextColor(27, 58, 75);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(cl.nom || '—', 8, 76);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);

      let y = 82;
      const addr = cl.adresseLigne1 || cl.adresse || '';
      if (addr) { doc.text(addr, 8, y); y += 5; }
      if (cl.adresseLigne2) { doc.text(cl.adresseLigne2, 8, y); y += 5; }

      const cpVille = `${cl.cp || ''} ${cl.commune || cl.ville || ''}`.trim();
      if (cpVille) {
        doc.setFont('helvetica', 'bold');
        doc.text(cpVille, 8, y);
        y += 6;
      }

      if (dest) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`${dest.nom || ''}`, 8, y);
      }

      // Bottom: description
      if (colis.desc) {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text(colis.desc.slice(0, 60), 8, h - 6);
      }
    }
  }

  // Open in new window
  const pdfBlob = doc.output('blob');
  const url = URL.createObjectURL(pdfBlob);
  window.open(url, '_blank');
}
