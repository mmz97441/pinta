import jsPDF from 'jspdf';
import { getDestByCP, getSecteurByCP, getSecteurColor } from '../constants';

async function generateQR(text) {
  try {
    const QRCode = await import('qrcode');
    return await QRCode.toDataURL(text, { width: 200, margin: 0, errorCorrectionLevel: 'L' });
  } catch { return null; }
}

/**
 * Étiquette d'expédition — format A4, GROS caractères.
 * Le livreur doit pouvoir lire le nom et l'adresse en conduisant.
 */
export async function printEtiquettes(colisList, clients, getClient) {
  if (!colisList || colisList.length === 0) return;

  const doc = new jsPDF({ unit: 'mm', format: [100, 120] });
  let first = true;

  for (const colis of colisList) {
    const cl = typeof getClient === 'function' ? getClient(colis.clientId) : null;
    if (!cl) continue;
    const dest = getDestByCP(cl.cp);
    const trackings = colis.trackings?.filter((t) => t) || [];
    const nbCartons = Math.max(trackings.length, 1);

    for (let i = 0; i < nbCartons; i++) {
      if (!first) doc.addPage([100, 120]);
      first = false;

      const W = 100, H = 120;

      // ══════ HEADER NAVY ══════
      doc.setFillColor(27, 58, 75);
      doc.rect(0, 0, W, 12, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('EXPEDILE', 4, 8);
      doc.setFontSize(12);
      doc.text(`${i + 1} / ${nbCartons}`, W - 4, 8, { align: 'right' });

      // ══════ REF + CASIER ══════
      doc.setTextColor(27, 58, 75);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(colis.ref || '?', 4, 22);

      if (colis.casier) {
        doc.setFillColor(232, 184, 75);
        doc.roundedRect(4, 24, 28, 7, 2, 2, 'F');
        doc.setTextColor(18, 42, 54);
        doc.setFontSize(9);
        doc.text(`Casier ${colis.casier}`, 6, 29);
      }

      // Poids
      doc.setTextColor(27, 58, 75);
      doc.setFontSize(11);
      doc.text(`${colis.finP || colis.poids || '?'} kg`, 36, 29);

      // ══════ QR CODE (en haut à droite) ══════
      const qrText = [
        colis.ref,
        (cl.nom || '') + (cl.prenom ? ' ' + cl.prenom : ''),
        cl.adresseLigne1 || cl.adresse || '',
        `${cl.cp || ''} ${cl.commune || cl.ville || ''}`,
        dest?.nom || '',
        cl.tel || '',
      ].filter(Boolean).join('\n');

      try {
        const qr = await generateQR(qrText);
        if (qr) doc.addImage(qr, 'PNG', W - 28, 14, 22, 22);
      } catch {}

      // ══════ SÉPARATEUR ══════
      doc.setDrawColor(27, 58, 75);
      doc.setLineWidth(0.8);
      doc.line(4, 35, W - 4, 35);

      // ══════ NOM — GROS ══════
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      const nomComplet = ((cl.nomFamille || cl.nom || '') + (cl.prenom ? ' ' + cl.prenom : '')).toUpperCase();
      doc.text(nomComplet, 4, 45);

      // ══════ ADRESSE — LISIBLE ══════
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 30, 30);
      let y = 53;

      const addr1 = (cl.adresseLigne1 || cl.adresse || '').toUpperCase();
      if (addr1) { doc.text(addr1, 4, y); y += 6; }
      if (cl.adresseLigne2) { doc.text(cl.adresseLigne2.toUpperCase(), 4, y); y += 6; }

      // CP + VILLE — GROS
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      const cpVille = `${cl.cp || ''} ${(cl.commune || cl.ville || '').toUpperCase()}`.trim();
      if (cpVille) { doc.text(cpVille, 4, y); y += 8; }

      // DESTINATION — TRÈS GROS
      if (dest) {
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(27, 58, 75);
        doc.text(dest.nom?.toUpperCase() || '', 4, y);
        y += 10;
      }

      // SECTEUR — TRÈS VISIBLE
      const secteur = getSecteurByCP(cl.cp);
      if (secteur) {
        y += 4;
        const sColor = getSecteurColor(secteur);
        const r = parseInt(sColor.slice(1, 3), 16);
        const g = parseInt(sColor.slice(3, 5), 16);
        const b = parseInt(sColor.slice(5, 7), 16);
        doc.setFillColor(r, g, b);
        doc.roundedRect(4, y - 8, W - 8, 14, 3, 3, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text(`SECTEUR ${secteur}`, W / 2, y, { align: 'center' });
        y += 12;
      }

      // TÉLÉPHONE
      if (cl.tel) {
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text(`TEL: ${cl.tel}`, 4, y);
      }

      // ══════ BORDURE ══════
      doc.setDrawColor(27, 58, 75);
      doc.setLineWidth(1);
      doc.rect(1, 1, W - 2, H - 2, 'S');
    }
  }

  const pdfBlob = doc.output('blob');
  const url = URL.createObjectURL(pdfBlob);
  window.open(url, '_blank');
}
