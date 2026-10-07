import { DESTINATIONS } from '../constants/index.js';
import { clientDisplayName } from './clientGroups.js';
import { isoCalendarDay, parisCalendarDay } from './departureGroups.js';
import { departureReadiness } from './departureReadiness.js';
import { excludedInvoiceIds } from './invoiceDocuments.js';
import { roundMoney } from './quote.js';
import { allocateCents, savedQuoteBreakdown } from './quoteBreakdown.js';

// The commercial invoice of a departure, handed to customs with the shipment (PDF and
// Excel: utils/exportFactureCommerciPDF.js and utils/exportFactureCommerciale.js). One row
// per article of each dossier: the dossier's EXP reference, the person it goes to, the
// article's HS code, its value and the part of the dossier's transport it carries.
//
// Nothing is recalculated. A particulier's articles and transport shares are those of the
// saved quote (quoteBreakdown.js), whose rules are quote.js and save_quote: the billed
// weight is the heavier of the real and volumetric totals, and the transport is shared in
// proportion to each article's value (quantity × unit price HT), in cents adding up
// exactly to the dossier's transport. A professional's quote has no article: its own
// article lines are used, without those of rejected, replaced or duplicate invoices (as
// the quote does), and the quote's transport is shared the same way. A missing HS code
// blocks the document: a code is never left empty nor invented (decision D33).
// Pure: no network; the issue instant is given by the caller (issuedAt).

// The wording shared by the PDF and the Excel document.
export const COMMERCIAL_INVOICE_COLUMNS = Object.freeze(['N° expédition', 'Destinataire', 'Code SH', 'Description', 'Qté', 'P.U. HT', 'Valeur HT', 'Transport affecté', 'Total']);
export const COMMERCIAL_INVOICE_EXPORTER = Object.freeze(['GROUPE DELIVREX', '5 RUE DE COPENHAGUE', 'ROISSY POLE BAT AERONEF CS 13918', '95731 ROISSY CH DE GAULLE']);
export const COMMERCIAL_INVOICE_NOTE = 'Transport réparti au prorata de la valeur des articles (quantité × prix unitaire HT). Valeurs en euros.';
export const COMMERCIAL_INVOICE_FOOTER = 'Document généré par Expedîle — usage douanier uniquement';

const TRANSPORT_MODES = { aerien: 'Aérien', maritime: 'Maritime' };
const naturalOrder = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const finite = value => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value));
const num = value => (finite(value) ? Number(value) : null);
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const toCents = value => Math.round(roundMoney(Number(value) || 0) * 100);
const fromCents = value => value / 100;
const quoted = text => `« ${text} »`;

/** The name printed for a dossier: the company name of a professional, otherwise the
 *  person's (« Payet Flavie », clientDisplayName); null when the record names nobody. */
export function invoiceConsigneeName(client) {
  const company = client?.type === 'pro' ? String(client.raisonSociale || '').trim() : '';
  return company || clientDisplayName(client);
}

/** The articles of a saved quote, with their frozen HS code and transport share. */
function quoteArticles(breakdown) {
  return breakdown.lines.map(line => ({
    description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
    value: line.value, transport: line.transportShare, hsCode: line.hsCode, customsToCheck: false,
  }));
}

/** A professional's own article lines, the quote's transport shared by their value. */
function dossierArticles(colis, lines, categoryById, transport) {
  const excluded = excludedInvoiceIds(colis.factures || []);
  const active = (Array.isArray(lines) ? lines : []).filter(line => line && (!line.factureId || !excluded.has(line.factureId)));
  const values = active.map(line => (finite(line.qte) && finite(line.prix) ? Number(line.qte) * Number(line.prix) : 0));
  const shares = allocateCents(transport, values);
  return active.map((line, index) => {
    const category = categoryById.get(line.cat) || null;
    const duty = line.customDuty || null;
    // The classification frozen on the line, otherwise the category's code (customsDesignation).
    const code = String((duty && !duty.stale ? duty.code : '') || category?.codeHs || category?.code_hs || '').trim();
    return {
      description: String(line.desc ?? line.description ?? '').trim(), quantity: num(line.qte), unitPrice: num(line.prix),
      value: roundMoney(values[index]), transport: shares[index], hsCode: code || null, customsToCheck: Boolean(duty?.stale),
    };
  });
}

/**
 * The commercial invoice of a departure:
 * `buildCommercialInvoice({ envoi, items: [{ colis, client, lignes }], categories, issuedAt, confirmed })`
 * → `{ ok, errors, excluded, rows, totals, meta }`.
 * - Before the departure (`confirmed` false), only the dossiers ready to load
 *   (departureReadiness) are included; the others are listed in `excluded` with their reason.
 *   After it (`confirmed`, the frozen manifest), every loaded dossier is included.
 * - `errors` (`{ ref, colisId, kind, task, message }`, « EXP-… : code SH manquant pour « … » »):
 *   what blocks the document; `ok` is false and nothing may be exported. `kind` says what
 *   to fix ('hs-code', 'customs', 'article', 'articles', 'transport', 'quote', 'consignee',
 *   'empty'), `task` the dossier step that shows it.
 * - `rows`: `{ ref, clientName, hsCode, description, quantity, unitPrice, value, transport, total }`,
 *   dossiers in reference order, articles in their quote order; amounts in euros, to the cent.
 * - `meta`: `{ number, date, departureDate, destination, mode, dossiers, parcels, weight }`:
 *   the departure's reference, the issue day (Paris), the departure day, its destination and
 *   transport mode (null when not recorded), the outgoing parcels and their real weight (kg).
 * `lignes` is a dossier's article lines when they are not on `colis.lignes` (manifest).
 */
export function buildCommercialInvoice({ envoi = null, items = [], categories = [], issuedAt = Date.now(), confirmed = false } = {}) {
  const errors = [];
  const excluded = [];
  const rows = [];
  const categoryList = Array.isArray(categories) ? categories : [];
  const categoryById = new Map(categoryList.map(category => [category.id, category]));
  const dossiers = (Array.isArray(items) ? items : []).filter(item => item?.colis)
    .sort((left, right) => naturalOrder.compare(String(left.colis.ref ?? ''), String(right.colis.ref ?? '')));
  let included = 0, parcels = 0, weight = 0;

  for (const { colis, client = null, lignes } of dossiers) {
    const ref = colis.ref || null;
    const readiness = departureReadiness(colis);
    if (!confirmed && !readiness.eligible) {
      excluded.push({ ref, colisId: colis.id || null, task: readiness.reasons[0]?.task || null, reason: readiness.reasons.map(reason => reason.text).join(' · ') });
      continue;
    }
    included += 1;
    parcels += readiness.count;
    weight += readiness.weights?.realWeight || 0;
    const found = [];
    const fail = (kind, message, task) => found.push({ ref, colisId: colis.id || null, kind, task, message: `${ref || 'Dossier sans référence'} : ${message}` });

    const clientName = invoiceConsigneeName(client);
    if (!clientName) fail('consignee', 'nom du destinataire manquant', 'reception');
    const breakdown = savedQuoteBreakdown(colis.devisSnapshot, { categories: categoryList });
    if (!breakdown) { fail('quote', 'aucun devis enregistré', 'devis'); errors.push(...found); continue; }
    // A quote saved without its transport (older record) never prints a transport of 0,00 €.
    if (!finite(colis.devisSnapshot.amounts.transport)) { fail('quote', 'montant du transport absent du devis enregistré', 'devis'); errors.push(...found); continue; }
    const professional = breakdown.professional || client?.type === 'pro';
    const fromQuote = breakdown.lines.length > 0;
    const articles = fromQuote ? quoteArticles(breakdown)
      : professional ? dossierArticles(colis, lignes ?? colis.lignes, categoryById, breakdown.transport.amount) : [];
    if (!articles.length) { fail('articles', 'aucun article à déclarer', 'documents'); errors.push(...found); continue; }

    for (const article of articles) {
      const name = article.description ? quoted(article.description) : null;
      if (!name) fail('article', 'description manquante pour un article', 'documents');
      else if (!(isNumber(article.quantity) && article.quantity > 0) || !(isNumber(article.unitPrice) && article.unitPrice >= 0)) fail('article', `quantité ou prix unitaire à corriger pour ${name}`, 'documents');
      if (article.customsToCheck) fail('customs', `classement douanier à vérifier pour ${name || 'un article'}`, 'documents');
      // The quote's articles are shown with their code in its step; a professional's are its invoices' articles.
      else if (!article.hsCode) fail('hs-code', `code SH manquant pour ${name || 'un article'}`, fromQuote ? 'devis' : 'documents');
    }
    // The shares always add up to the transport, unless no article has a value to share it by.
    if (articles.reduce((sum, article) => sum + toCents(article.transport), 0) !== toCents(breakdown.transport.amount)) {
      fail('transport', 'valeur des articles nulle : le transport ne peut pas être réparti', 'documents');
    }
    if (found.length) { errors.push(...found); continue; }
    for (const article of articles) {
      rows.push({
        ref, clientName, hsCode: article.hsCode, description: article.description,
        quantity: article.quantity, unitPrice: article.unitPrice, value: article.value, transport: article.transport,
        total: fromCents(toCents(article.value) + toCents(article.transport)),
      });
    }
  }

  if (!included && !errors.length) {
    errors.push({ ref: null, colisId: null, kind: 'empty', task: null, message: confirmed
      ? 'Aucun dossier embarqué dans ce manifeste : aucun article à déclarer.'
      : 'Aucun dossier prêt à charger : la facture reprend les dossiers payés et préparés de ce départ.' });
  }
  const value = rows.reduce((sum, row) => sum + toCents(row.value), 0);
  const transport = rows.reduce((sum, row) => sum + toCents(row.transport), 0);
  return {
    ok: errors.length === 0 && rows.length > 0,
    errors,
    excluded,
    rows,
    totals: { value: fromCents(value), transport: fromCents(transport), total: fromCents(value + transport) },
    meta: {
      number: envoi?.ref || null,
      date: parisCalendarDay(issuedAt),
      departureDate: isoCalendarDay(envoi?.date),
      destination: DESTINATIONS[envoi?.destinationCode]?.nom || null,
      mode: TRANSPORT_MODES[envoi?.modeTransport] || null,
      dossiers: included,
      parcels,
      weight: Math.round(weight * 100) / 100,
    },
  };
}

/** « 07/10/2026 » for a day written 2026-10-07; null otherwise. */
export function invoiceDayLabel(day) {
  const value = isoCalendarDay(day);
  return value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : null;
}

/** « facture-commerciale-ENV-2026-036 » (the extension is the exporter's). */
export function commercialInvoiceFileName(invoice) {
  const number = String(invoice?.meta?.number || 'depart').replace(/[^\w.-]+/g, '-');
  return `facture-commerciale-${number}`;
}
