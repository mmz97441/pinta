import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { getSecteurByCP } from '../constants/index.js';
import { formatParcelCode, parcelCodeText, parseParcelCode } from '../domain/parcelCode.js';
import { hasCurrentPreparation } from '../domain/preparationReadiness.js';
import { servedDestination } from '../domain/clientRequirements.js';
import { drawCode128 } from './code128.js';
import { pdfText } from './exportDevisPDF.js';

// The labels of the outgoing parcels: one 100 × 150 mm page per parcel of a prepared
// dossier (its current preparation: finalPackages, outgoingParcelCount). Each label
// carries « EXP-2YE537-1-2 » as a QR code and as a Code 128 barcode — the reference,
// the parcel's position and the dossier's parcel count, nothing personal — and the
// recipient in plain text for the driver at destination.
//
// The whole document is built synchronously (the QR code and the bars are drawn as
// rectangles), so a click can open it in the same gesture: iPad Safari only lets a
// click open a window before any await.

const PAGE = { width: 100, height: 150 };
const MARGIN = 4;
const NAVY = [27, 58, 75];
const INK = [0, 0, 0];
const MUTED = [90, 90, 90];
const QR_SIZE = 32; // mm, the symbol itself; its quiet zone is the white around it
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const SENDER = 'EXPEDÎLE — 75001 PARIS, FRANCE · contact@expedile.fr';

/** Why a dossier gets no label, as the screens state it after its reference. */
export const LABEL_SKIP_MESSAGES = Object.freeze({
  'not-prepared': 'étiquettes disponibles après l’optimisation des colis',
  cancelled: 'expédition annulée, aucune étiquette à imprimer',
  archived: 'dossier archivé, aucune étiquette à imprimer',
  reference: 'référence à vérifier avant d’imprimer les étiquettes',
  client: 'fiche client introuvable, rechargez la page',
  address: 'adresse du destinataire à compléter avant d’imprimer les étiquettes',
});
// The field of the client record that completes each missing part (`/clients/:id?completer=`).
const COMPLETER = { nom: 'nom', adresse: 'adresse', 'code postal': 'cp', ville: 'ville', destination: 'cp' };

const trim = value => String(value ?? '').trim();
const textLines = value => String(value ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const upper = value => trim(value).toLocaleUpperCase('fr-FR');

/** The saved outgoing parcels, as hasCurrentPreparation() certifies them (legacy NULL: the scalar totals). */
function preparedBoxes(dossier) {
  return dossier.finalPackages == null
    ? [{ dimL: dossier.finL, dimW: dossier.finW, dimH: dossier.finH, poids: dossier.finP }]
    : dossier.finalPackages;
}

/** The recipient as printed for the driver, and what the client record still misses for it. */
function labelRecipient(client, dossier) {
  const family = trim(client.nomFamille);
  const name = family ? [upper(family), trim(client.prenom)].filter(Boolean).join(' ') : trim(client.nom) || trim(client.prenom);
  const company = client.type === 'pro' ? trim(client.raisonSociale) : '';
  const street = textLines(client.adresseLigne1 || client.adresse);
  const lines = [...street, ...textLines(client.adresseLigne2)].map(upper);
  const postcode = String(client.cp ?? '').replace(/\s/g, '');
  const town = upper(client.commune || client.ville);
  // The destination frozen with the quote, else the one of the postcode (a served one only).
  const destination = trim(dossier.devisSnapshot?.inputs?.destination?.nom) || servedDestination(postcode)?.nom || '';
  const phones = [...new Set([trim(client.tel), trim(client.telFixe)].filter(Boolean))];
  const missing = [];
  if (!name && !company) missing.push('nom');
  // The address itself, as the client record requires it: a complement alone is not an address.
  if (!street.length) missing.push('adresse');
  if (!postcode) missing.push('code postal');
  if (!town) missing.push('ville');
  if (postcode && !destination) missing.push('destination');
  return {
    name, company, lines, postcode, town, destination: upper(destination), phones,
    instructions: textLines(client.infosLivraison).join(' '), sector: getSecteurByCP(postcode), missing,
  };
}

/**
 * The labels of `dossiers`, in their order, one per outgoing parcel:
 * `{ labels, skipped }`. A label holds its dossier, `index`/`count`, the `code` of the QR
 * code and barcode (formatParcelCode), its readable `codeText` (parcelCodeText), the
 * recipient, the parcel's own measures and the casier. A dossier without labels is listed
 * in `skipped` with its `reason` (LABEL_SKIP_MESSAGES) and `message`; an incomplete address
 * also names the `missing` parts and the client field to `complete`.
 */
export function parcelLabels(dossiers, { getClient } = {}) {
  const labels = [];
  const skipped = [];
  for (const dossier of Array.isArray(dossiers) ? dossiers : []) {
    if (!dossier) continue;
    const ref = trim(dossier.ref);
    const skip = (reason, extra = {}) => skipped.push({ id: dossier.id ?? null, ref: ref || 'Dossier sans référence', clientId: dossier.clientId ?? null, reason, message: LABEL_SKIP_MESSAGES[reason], ...extra });
    if (dossier.statut === 'annule') { skip('cancelled'); continue; }
    if (dossier.archive) { skip('archived'); continue; }
    if (!hasCurrentPreparation(dossier)) { skip('not-prepared'); continue; }
    const boxes = preparedBoxes(dossier);
    const count = boxes.length;
    // The scanners read the code back with parseParcelCode: a reference it cannot read gets no label.
    const read = parseParcelCode(formatParcelCode(ref, count, count));
    if (!read.ok || read.ref !== ref || read.index !== count || read.count !== count) { skip('reference'); continue; }
    const client = typeof getClient === 'function' ? getClient(dossier.clientId) : null;
    if (!client) { skip('client'); continue; }
    const recipient = labelRecipient(client, dossier);
    if (recipient.missing.length) { skip('address', { missing: recipient.missing, complete: COMPLETER[recipient.missing[0]] }); continue; }
    boxes.forEach((box, position) => {
      const index = position + 1;
      labels.push({
        dossierId: dossier.id ?? null, ref, index, count,
        code: formatParcelCode(ref, index, count), codeText: parcelCodeText(ref, index, count),
        casier: trim(dossier.casier), recipient,
        parcel: { dimL: Number(box.dimL), dimW: Number(box.dimW), dimH: Number(box.dimH), poids: Number(box.poids) },
      });
    });
  }
  return { labels, skipped };
}

/** « EXP-2YE537, EXP-3HF210 : étiquettes disponibles après l’optimisation des colis », one line per reason. */
export function skippedLabelLines(skipped) {
  const byReason = new Map();
  for (const item of skipped || []) {
    const message = item.reason === 'address' && item.missing?.length ? `${LABEL_SKIP_MESSAGES.address} (${item.missing.join(', ')})` : item.message;
    byReason.set(message, [...(byReason.get(message) || []), item.ref]);
  }
  return [...byReason].map(([message, refs]) => `${refs.join(', ')} : ${message}`);
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/** Writes `value` in at most `maxWidth` mm: the font shrinks down to `minSize`, then the end gives way to « … ». */
function fitText(doc, value, { size, minSize = size, maxWidth }) {
  const text = pdfText(value);
  let current = size;
  doc.setFontSize(current);
  while (current > minSize && doc.getTextWidth(text) > maxWidth) { current = Math.max(minSize, current - 0.5); doc.setFontSize(current); }
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function write(doc, value, x, y, { size, minSize, maxWidth = PAGE.width - 2 * MARGIN, bold = false, color = INK, align = 'left' }) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setTextColor(...color);
  const text = fitText(doc, value, { size, minSize, maxWidth });
  doc.text(text, x, y, { align });
  return text;
}

/** The address lines wrapped to the label's width: at most three lines, the font shrinking from 11 to 9 pt first. */
function addressRows(doc, lines) {
  const maxWidth = PAGE.width - 2 * MARGIN;
  doc.setFont('helvetica', 'normal');
  let wrapped = [];
  for (const size of [11, 10, 9]) {
    doc.setFontSize(size);
    // `next`: the piece starts another line of the record, not the rest of a wrapped one.
    wrapped = lines.flatMap((line, index) => doc.splitTextToSize(pdfText(line), maxWidth).map((text, piece) => ({ text, next: index > 0 && piece === 0 })));
    if (wrapped.length <= 3) return wrapped.map(({ text }) => ({ text, size, height: Math.round(size * 4.4) / 10 }));
  }
  // Still longer: the third line takes the rest (record lines separated by commas) and ends with « … » if it must.
  const rest = wrapped.slice(2).map(({ text, next }, index) => `${index === 0 ? '' : next ? ', ' : ' '}${text}`).join('');
  return [wrapped[0].text, wrapped[1].text, rest].map(text => ({ text, size: 9, height: 4 }));
}

/**
 * The QR code of `text` (error correction M), `size` mm wide, the symbol's top-left corner
 * at (x, y). Each row's dark run is a rectangle of one single path, filled once: screens
 * then show no seam between rows.
 */
export function drawQrCode(doc, text, { x, y, size }) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const count = qr.modules.size;
  const module = size / count;
  const runs = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count;) {
      if (!qr.modules.get(row, column)) { column += 1; continue; }
      let end = column;
      while (end < count && qr.modules.get(row, end)) end += 1;
      runs.push([x + column * module, y + row * module, (end - column) * module, module]);
      column = end;
    }
  }
  doc.setFillColor(...INK);
  // A null style keeps composing the same path; the last rectangle fills it.
  runs.forEach(([left, top, width, height], index) => doc.rect(left, top, width, height, index === runs.length - 1 ? 'F' : null));
  return { x, y, size, modules: count, moduleSize: module, version: qr.version };
}

const dimensions = parcel => `${NUMBER.format(parcel.dimL)} × ${NUMBER.format(parcel.dimW)} × ${NUMBER.format(parcel.dimH)}\u00a0cm`;
const weight = value => `${NUMBER.format(value)}\u00a0kg`;

function drawLabel(doc, label) {
  const { width: W } = PAGE;
  const right = W - MARGIN;
  const { recipient } = label;

  // Header: the delivery sector of La Réunion, the brand and the destination.
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 12, 'F');
  let brandX = MARGIN;
  if (recipient.sector) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(3, 2, 21, 8, 1.2, 1.2, 'F');
    write(doc, recipient.sector, 13.5, 7.7, { size: 11, minSize: 8, maxWidth: 19, bold: true, color: NAVY, align: 'center' });
    brandX = 27;
  }
  write(doc, 'EXPEDÎLE', brandX, 6.2, { size: 12, bold: true, color: [255, 255, 255], maxWidth: 36 });
  write(doc, 'Réexpédition Paris – DOM-TOM', brandX, 10, { size: 6.5, color: [255, 255, 255], maxWidth: 40 });
  if (recipient.destination) write(doc, recipient.destination, right, 8, { size: 11, minSize: 7, bold: true, color: [255, 255, 255], maxWidth: W - brandX - 42, align: 'right' });

  // Sender.
  doc.setFillColor(243, 244, 246);
  doc.rect(0, 12, W, 7.5, 'F');
  write(doc, 'EXPÉDITEUR', MARGIN, 14.9, { size: 5.5, bold: true, color: MUTED });
  write(doc, SENDER, MARGIN, 18, { size: 7, minSize: 6, color: [55, 55, 55] });

  // The parcel: reference and position, large; casier and its own measures. The QR code on the right.
  const column = 50; // the QR code's quiet zone starts beyond it
  write(doc, label.ref, MARGIN, 29.5, { size: 24, minSize: 14, maxWidth: column, bold: true });
  write(doc, `Colis ${label.index}/${label.count}`, MARGIN, 40, { size: 24, minSize: 14, maxWidth: column, bold: true });
  if (label.casier) {
    doc.setFont('helvetica', 'bold');
    const casier = fitText(doc, `CASIER ${label.casier}`, { size: 10, minSize: 7, maxWidth: column - 3 });
    const boxWidth = doc.getTextWidth(casier) + 3;
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.4);
    doc.roundedRect(MARGIN, 43.6, boxWidth, 6.4, 1, 1, 'S');
    doc.setTextColor(...INK);
    doc.text(casier, MARGIN + 1.5, 48.2);
  }
  write(doc, dimensions(label.parcel), MARGIN, 55, { size: 10, minSize: 8, maxWidth: column });
  write(doc, `Poids réel ${weight(label.parcel.poids)}`, MARGIN, 59.6, { size: 10, minSize: 8, maxWidth: column, bold: true });
  drawQrCode(doc, label.code, { x: right - QR_SIZE - 2, y: 23, size: QR_SIZE });

  doc.setDrawColor(...INK);
  doc.setLineWidth(0.8);
  doc.line(0, 63.5, W, 63.5);

  // Recipient, for the driver at destination. Lines that cannot fit above the barcode are left out
  // (the delivery instructions first), never drawn over it.
  write(doc, 'DESTINATAIRE', MARGIN, 68, { size: 6, bold: true, color: MUTED });
  const rows = [];
  if (recipient.company) rows.push({ text: recipient.company, size: 15, minSize: 10, bold: true, height: 6.2 });
  if (recipient.name) rows.push(recipient.company ? { text: recipient.name, size: 11, minSize: 8, height: 4.8 } : { text: recipient.name, size: 15, minSize: 10, bold: true, height: 6.2 });
  rows.push(...addressRows(doc, recipient.lines));
  rows.push({ text: `${recipient.postcode} ${recipient.town}`, size: 13, minSize: 9, bold: true, height: 5.8 });
  if (recipient.destination) rows.push({ text: recipient.destination, size: 15, minSize: 10, bold: true, color: NAVY, height: 6.4 });
  if (recipient.phones.length) rows.push({ text: `Tél. ${recipient.phones.join(' · ')}`, size: 10.5, minSize: 8, height: 4.8 });
  if (recipient.instructions) rows.push({ text: `Instructions : ${recipient.instructions}`, size: 8, minSize: 7, height: 4, color: [55, 55, 55], optional: true });
  let y = 68;
  const bottom = 111.5;
  for (const row of rows) {
    if (y + row.height > bottom) { if (row.optional) continue; break; }
    y += row.height;
    write(doc, row.text, MARGIN, y, row);
  }

  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);
  doc.line(0, 113.5, W, 113.5);

  // The barcode: the same code as the QR code, its readable line underneath.
  drawCode128(doc, label.code, { x: MARGIN, y: 117, height: 20, moduleWidth: 0.375, maxWidth: W - 2 * MARGIN });
  write(doc, label.codeText, W / 2, 142.5, { size: 11, minSize: 8, bold: true, align: 'center' });
}

/** The labels as a jsPDF document (nothing is opened): `{ doc, filename }`. */
export function buildParcelLabelsPdf(labels) {
  if (!Array.isArray(labels) || !labels.length) throw new Error('Aucune étiquette à imprimer.');
  const doc = new jsPDF({ unit: 'mm', format: [PAGE.width, PAGE.height], orientation: 'portrait' });
  labels.forEach((label, index) => {
    if (index > 0) doc.addPage([PAGE.width, PAGE.height], 'portrait');
    drawLabel(doc, label);
  });
  const refs = [...new Set(labels.map(label => label.ref))];
  const title = refs.length === 1 ? `Étiquettes ${refs[0]}` : `Étiquettes de ${refs.length} dossiers`;
  doc.setProperties({ title, subject: `${labels.length} étiquette${labels.length > 1 ? 's' : ''} colis 100 × 150 mm`, creator: 'Expedîle' });
  const filename = refs.length === 1 ? `etiquettes-${refs[0]}.pdf` : `etiquettes-${labels.length}-colis.pdf`;
  return { doc, filename };
}

/**
 * Builds the labels of `dossiers` and opens them, inside the click that asked for them:
 * in `target` when the click already opened a window (window.open('', '_blank') before
 * loading this module), else in a new window, else as a download.
 * Returns `{ count, dossiers, skipped, lines, method: 'window' | 'download' | null, filename }`
 * (`lines`: skippedLabelLines): nothing printable opens nothing (and closes `target`).
 * Throws when the document cannot be built.
 */
export function printParcelLabels(dossiers, { getClient, target = null } = {}) {
  const { labels, skipped } = parcelLabels(dossiers, { getClient });
  const lines = skippedLabelLines(skipped);
  if (!labels.length) {
    if (target && !target.closed) target.close();
    return { count: 0, dossiers: 0, skipped, lines, method: null, filename: null };
  }
  const { doc, filename } = buildParcelLabelsPdf(labels);
  const url = URL.createObjectURL(doc.output('blob'));
  let method = 'window';
  if (target && !target.closed) target.location.replace(url);
  else if (!window.open(url, '_blank')) {
    // The window was refused (pop-up blocker): the document is downloaded instead.
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    method = 'download';
  }
  // The opened tab keeps its copy; the address is released once it has surely loaded.
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  return { count: labels.length, dossiers: new Set(labels.map(label => label.dossierId)).size, skipped, lines, method, filename };
}
