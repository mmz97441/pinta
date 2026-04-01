import jsPDF from 'jspdf';
import { getDestByCP, getSecteurByCP, getSecteurColor } from '../constants';

async function generateQR(text) {
  try {
    const QRCode = await import('qrcode');
    return await QRCode.toDataURL(text, { width: 200, margin: 0, errorCorrectionLevel: 'L' });
  } catch { return null; }
}

export async function printEtiquettes(colisList, clients, getClient) {
  if (!colisList || colisList.length === 0) return;

  const doc = new jsPDF({ unit: 'mm', format: [100, 150] });
  let first = true;

  for (const colis of colisList) {
    const cl = typeof getClient === 'function' ? getClient(colis.clientId) : null;
    if (!cl) continue;
    const dest = getDestByCP(cl.cp);
    const secteur = getSecteurByCP(cl.cp);
    const trackings = colis.trackings?.filter((t) => t) || [];
    const nbCartons = Math.max(trackings.length, 1);
    const nomComplet = ((cl.nomFamille || cl.nom || '') + (cl.prenom ? ' ' + cl.prenom : '')).toUpperCase();

    for (let i = 0; i < nbCartons; i++) {
      if (!first) doc.addPage([100, 150]);
      first = false;

      const W = 100, H = 150;

      // ═══════════════════════════════════════════════
      // BLOC 1 — HEADER : Logo + Secteur + Carton
      // ═══════════════════════════════════════════════
      doc.setFillColor(27, 58, 75);
      doc.rect(0, 0, W, 18, 'F');

      // Secteur (gros bloc coloré à gauche)
      if (secteur) {
        const sc = getSecteurColor(secteur);
        const r = parseInt(sc.slice(1, 3), 16);
        const g = parseInt(sc.slice(3, 5), 16);
        const b = parseInt(sc.slice(5, 7), 16);
        doc.setFillColor(r, g, b);
        doc.rect(0, 0, 28, 18, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(secteur, 14, 12, { align: 'center' });
      }

      // EXPEDILE
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('EXPEDILE', secteur ? 32 : 4, 8);

      // Service type
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text('REEXPEDITION DOM-TOM', secteur ? 32 : 4, 14);

      // Carton number
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(`${i + 1}/${nbCartons}`, W - 4, 12, { align: 'right' });

      // ═══════════════════════════════════════════════
      // BLOC 2 — EXPÉDITEUR (FROM)
      // ═══════════════════════════════════════════════
      doc.setFillColor(245, 245, 245);
      doc.rect(0, 18, W, 18, 'F');

      doc.setTextColor(120, 120, 120);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.text('FROM / EXPÉDITEUR', 4, 23);

      doc.setTextColor(60, 60, 60);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('EXPEDILE — 75001 PARIS, FRANCE', 4, 29);
      doc.text('contact@expedile.fr', 4, 33);

      // REF à droite
      doc.setTextColor(27, 58, 75);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(colis.ref || '?', W - 4, 29, { align: 'right' });

      // Séparateur épais
      doc.setDrawColor(27, 58, 75);
      doc.setLineWidth(1.2);
      doc.line(0, 36, W, 36);

      // ═══════════════════════════════════════════════
      // BLOC 3 — DESTINATAIRE (SHIP TO) — LE PLUS GROS
      // ═══════════════════════════════════════════════
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.text('SHIP TO / DESTINATAIRE', 4, 42);

      // Nom GROS
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(nomComplet, 4, 50);

      // Adresse
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      let y = 57;
      const addr1 = (cl.adresseLigne1 || cl.adresse || '').toUpperCase();
      if (addr1) { doc.text(addr1, 4, y); y += 5; }
      if (cl.adresseLigne2) { doc.text(cl.adresseLigne2.toUpperCase(), 4, y); y += 5; }

      // CP + VILLE — gras
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      const cpVille = `${cl.cp || ''} ${(cl.commune || cl.ville || '').toUpperCase()}`.trim();
      if (cpVille) { doc.text(cpVille, 4, y); y += 7; }

      // Destination — GROS
      if (dest) {
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(27, 58, 75);
        doc.text(dest.nom?.toUpperCase() || '', 4, y);
        y += 7;
      }

      // Téléphone
      if (cl.tel) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60, 60, 60);
        doc.text(`TEL: ${cl.tel}`, 4, y);
      }

      // Séparateur
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.line(0, 95, W, 95);

      // ═══════════════════════════════════════════════
      // BLOC 4 — QR CODE + INFOS COLIS (bas)
      // ═══════════════════════════════════════════════
      // QR code centré
      const qrText = [
        colis.ref,
        nomComplet,
        cl.adresseLigne1 || cl.adresse || '',
        `${cl.cp || ''} ${cl.commune || cl.ville || ''}`,
        dest?.nom || '',
        cl.tel || '',
      ].filter(Boolean).join('\n');

      try {
        const qr = await generateQR(qrText);
        if (qr) doc.addImage(qr, 'PNG', (W - 35) / 2, 98, 35, 35);
      } catch {}

      // Casier + Poids en bas
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(27, 58, 75);
      if (colis.casier) {
        doc.setFillColor(232, 184, 75);
        doc.roundedRect(4, 136, 22, 6, 1.5, 1.5, 'F');
        doc.setTextColor(18, 42, 54);
        doc.text(colis.casier, 6, 140.5);
      }

      doc.setTextColor(27, 58, 75);
      doc.setFontSize(9);
      doc.text(`${colis.finP || colis.poids || '?'} kg`, 30, 140.5);

      // Description
      if (colis.desc) {
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text(colis.desc.slice(0, 40), 50, 140.5);
      }

      // Carton rappel en bas droite
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(27, 58, 75);
      doc.text(`${i + 1} / ${nbCartons}`, W - 4, 140.5, { align: 'right' });

      // Bordure extérieure
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.8);
      doc.rect(0.5, 0.5, W - 1, H - 1, 'S');
    }
  }

  const pdfBlob = doc.output('blob');
  const url = URL.createObjectURL(pdfBlob);
  window.open(url, '_blank');
}
