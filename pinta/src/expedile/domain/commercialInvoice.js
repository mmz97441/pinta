import { DESTINATIONS } from '../constants/index.js';
import { clientDisplayName } from './clientGroups.js';
import { loadableDossiers } from './departureBoard.js';
import { isoCalendarDay, parisCalendarDay } from './departureGroups.js';
import { departureReadiness } from './departureReadiness.js';
import { excludedInvoiceIds } from './invoiceDocuments.js';
import { consigneeFor, invoiceIdentity, missingPartyFields } from './invoiceIdentity.js';
import { parisDateTimeInput } from './parisTime.js';
import { roundMoney } from './quote.js';
import { allocateCents, savedQuoteBreakdown } from './quoteBreakdown.js';

// The commercial invoice of a departure, handed to customs with the shipment (PDF and
// Excel: utils/exportFactureCommerciPDF.js and utils/exportFactureCommerciale.js). One
// invoice per departure (decided with the user on 2026-10-08): at its top, the exporter
// (Expedîle) and the consignee of the departure's destination, as set in Paramètres ›
// Facture commerciale (domain/invoiceIdentity.js; a party is never invented: an incomplete
// exporter or no consignee blocks the document); then one row per article of each dossier:
// the dossier's EXP reference, the person it goes to, the article's HS code, its value and
// the part of the dossier's transport it carries.
//
// Nothing is recalculated. A particulier's articles and transport shares are those of the
// saved quote (quoteBreakdown.js), whose rules are quote.js and save_quote: the billed
// weight is the heavier of the real and volumetric totals, and the transport is shared in
// proportion to each article's value (quantity × unit price HT), in cents adding up
// exactly to the dossier's transport. A professional's quote has no article: its own
// article lines are used, without those of rejected, replaced or duplicate invoices (as
// the quote does), and the quote's transport is shared the same way. A missing HS code
// blocks the document: a code is never left empty nor invented (decision D33).
// Two editions share the departure's number: before the departure, from every dossier
// assigned to it at the export, paid and prepared or not, except the cancelled, archived
// and shipped ones (as its loading: loadableDossiers; basis 'loading', file
// « …-avant-depart »), each of them needing its saved quote, its articles and their HS
// codes; once it has left, from its confirmed manifest (basis 'manifest'). Each prints what
// it was established from and when (commercialInvoiceBasis), the title stays « FACTURE
// COMMERCIALE ». Pure: no network; the issue instant is given by the caller (issuedAt).

// The wording shared by the PDF and the Excel document.
export const COMMERCIAL_INVOICE_COLUMNS = Object.freeze(['N° expédition', 'Destinataire', 'Code SH', 'Description', 'Qté', 'P.U. HT', 'Valeur HT', 'Transport affecté', 'Total']);
/** The two parties printed at the top of the documents: the exporter, then the consignee. */
export const COMMERCIAL_INVOICE_PARTIES = Object.freeze(['EXPÉDITEUR', 'DESTINATAIRE']);
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
// « pour La Réunion », « pour la Guadeloupe »: the destination as a consignee of Paramètres › Facture commerciale.
const FOR_DESTINATION = { 974: 'La Réunion', 976: 'Mayotte', 971: 'la Guadeloupe', 972: 'la Martinique' };
const SETTINGS = 'Paramètres › Facture commerciale';
// The points corrected in Paramètres › Facture commerciale rather than in a dossier.
const IDENTITY_KINDS = new Set(['exporter', 'invoice-consignee']);

/** The point is fixed in Paramètres › Facture commerciale (the exporter or the consignee), not in a dossier. */
export const fixedInInvoiceSettings = error => IDENTITY_KINDS.has(error?.kind);

/** What blocks the parties of the departure: an incomplete exporter, no consignee for the
 *  destination nor a default one, or an incomplete consignee (never printed partly). */
function identityErrors(exporter, consignee, destinationCode) {
  const errors = [];
  const point = (kind, message, extra = {}) => errors.push({ ref: null, colisId: null, kind, task: null, message, ...extra });
  const missing = missingPartyFields(exporter);
  if (missing.length) point('exporter', `Complétez l’expéditeur dans ${SETTINGS} : ${missing.join(', ')}.`, { missing });
  const place = FOR_DESTINATION[destinationCode];
  if (!consignee) {
    point('invoice-consignee', place
      ? `Renseignez le destinataire de la facture pour ${place} (ou le destinataire par défaut) dans ${SETTINGS}.`
      : `Renseignez le destinataire de la facture par défaut dans ${SETTINGS}.`);
    return errors;
  }
  const lacking = missingPartyFields(consignee);
  if (lacking.length) {
    const whose = consignee.source === 'destination' && place ? `le destinataire de la facture pour ${place}` : 'le destinataire de la facture par défaut';
    point('invoice-consignee', `Complétez ${whose} dans ${SETTINGS} : ${lacking.join(', ')}.`, { missing: lacking });
  }
  return errors;
}

/** The name printed for a dossier: the company name of a professional, otherwise the
 *  person's (« Payet Flavie », clientDisplayName); null when the record names nobody. */
export function invoiceConsigneeName(client) {
  const company = client?.type === 'pro' ? String(client.raisonSociale || '').trim() : '';
  return company || clientDisplayName(client);
}

/** The articles of a saved quote, with their frozen HS code, their category's name
 *  (the one saved with the quote when the category is gone) and transport share. */
function quoteArticles(breakdown) {
  return breakdown.lines.map(line => ({
    description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
    value: line.value, transport: line.transportShare, hsCode: line.hsCode, customsToCheck: false,
    category: line.hsLabel || null,
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
      category: String(category?.label || '').trim() || null,
    };
  });
}

/**
 * The commercial invoice of a departure:
 * `buildCommercialInvoice({ envoi, items: [{ colis, client, lignes }], categories, identity, issuedAt, confirmed })`
 * → `{ ok, errors, rows, totals, meta }`.
 * - `identity`: the parties set in Paramètres › Facture commerciale, invoiceIdentity(settings);
 *   without it, nothing is set (the exporter has no address, there is no consignee).
 * - Before the departure (`confirmed` false), every dossier assigned to it but the cancelled,
 *   archived and shipped ones (loadableDossiers), paid and prepared or not. After it
 *   (`confirmed`, the frozen manifest), every loaded dossier.
 * - `errors` (`{ ref, colisId, kind, task, message }`, « EXP-… : code SH manquant pour « … »
 *   (catégorie « … ») »): what blocks the document; `ok` is false and nothing may be
 *   exported. `kind` says what to fix ('exporter' and 'invoice-consignee': the parties, in
 *   Paramètres › Facture commerciale, see fixedInInvoiceSettings, with the `missing` fields;
 *   for a dossier: 'hs-code', 'customs', 'article', 'articles', 'transport', 'quote',
 *   'consignee'; 'empty'), `task` the dossier step that shows it. An 'hs-code' point also
 *   carries `category`: the name of the category whose customs code is missing (completed
 *   in Paramètres › Catégories et taxes), null for an article without category (chosen with
 *   the dossier's invoices). The parties' points come first, then the dossiers'.
 * - `rows`: `{ ref, clientName, hsCode, description, quantity, unitPrice, value, transport, total }`,
 *   dossiers in reference order, articles in their quote order; amounts in euros, to the cent.
 * - `meta`: `{ number, date, departureDate, destination, mode, exporter, consignee, dossiers, parcels, weight, basis, issuedAt }`:
 *   the departure's reference, the issue day (Paris), the departure day, its destination and
 *   transport mode (null when not recorded), the exporter (identity.expediteur) and the
 *   consignee of its destination (consigneeFor: its own, else the default one, with its
 *   `source`; null when none is set), the outgoing parcels and their real weight (kg; both
 *   null when a dossier's prepared parcels are not known: never a partial total), what the
 *   document was established from ('loading': the dossiers assigned to the departure, before
 *   it leaves; 'manifest': the confirmed manifest) and the instant it was (ISO, null when unknown).
 * `lignes` is a dossier's article lines when they are not on `colis.lignes` (manifest).
 */
export function buildCommercialInvoice({ envoi = null, items = [], categories = [], identity = null, issuedAt = Date.now(), confirmed = false } = {}) {
  const parties = identity || invoiceIdentity({});
  const exporter = parties.expediteur;
  const consignee = consigneeFor(parties, envoi?.destinationCode);
  const errors = identityErrors(exporter, consignee, envoi?.destinationCode);
  const rows = [];
  const categoryList = Array.isArray(categories) ? categories : [];
  const categoryById = new Map(categoryList.map(category => [category.id, category]));
  const given = (Array.isArray(items) ? items : []).filter(item => item?.colis);
  // Before the departure, the dossiers its loading can still take; once it has left, its manifest.
  const assigned = confirmed ? null : new Set(loadableDossiers(envoi, given.map(item => item.colis)));
  const dossiers = given.filter(item => !assigned || assigned.has(item.colis))
    .sort((left, right) => naturalOrder.compare(String(left.colis.ref ?? ''), String(right.colis.ref ?? '')));
  let parcels = 0, weight = 0, measured = true;

  if (!dossiers.length) {
    errors.push({ ref: null, colisId: null, kind: 'empty', task: null, message: confirmed
      ? 'Aucun dossier embarqué dans ce manifeste : aucun article à déclarer.'
      : 'Aucun dossier affecté à ce départ : aucun article à déclarer.' });
  }

  for (const { colis, client = null, lignes } of dossiers) {
    const ref = colis.ref || null;
    const readiness = departureReadiness(colis);
    parcels += readiness.count;
    weight += readiness.weights?.realWeight || 0;
    if (!(readiness.count > 0) || !readiness.weights) measured = false;
    const found = [];
    const fail = (kind, message, task, extra = {}) => found.push({ ref, colisId: colis.id || null, kind, task, message: `${ref || 'Dossier sans référence'} : ${message}`, ...extra });

    const clientName = invoiceConsigneeName(client);
    if (!clientName) fail('consignee', 'nom du destinataire manquant', 'reception');
    const breakdown = savedQuoteBreakdown(colis.devisSnapshot, { categories: categoryList });
    // Before the departure, a dossier without its quote is quoted or taken off the departure.
    if (!breakdown) { fail('quote', confirmed ? 'aucun devis enregistré' : 'devis non enregistré : enregistrez son devis ou retirez-le du départ.', 'devis'); errors.push(...found); continue; }
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
      // The category is named: its customs code is what to complete (none: one is to be chosen).
      else if (!article.hsCode) {
        fail('hs-code', `code SH manquant pour ${name || 'un article'} (${article.category ? `catégorie ${quoted(article.category)}` : 'sans catégorie'})`,
          fromQuote ? 'devis' : 'documents', { category: article.category });
      }
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

  const value = rows.reduce((sum, row) => sum + toCents(row.value), 0);
  const transport = rows.reduce((sum, row) => sum + toCents(row.transport), 0);
  // A calendar day alone gives no instant: no time is invented for it.
  const instant = issuedAt === null || isoCalendarDay(issuedAt) ? NaN : new Date(issuedAt).getTime();
  return {
    ok: errors.length === 0 && rows.length > 0,
    errors,
    rows,
    totals: { value: fromCents(value), transport: fromCents(transport), total: fromCents(value + transport) },
    meta: {
      number: envoi?.ref || null,
      date: parisCalendarDay(issuedAt),
      departureDate: isoCalendarDay(envoi?.date),
      destination: DESTINATIONS[envoi?.destinationCode]?.nom || null,
      mode: TRANSPORT_MODES[envoi?.modeTransport] || null,
      exporter,
      consignee,
      dossiers: dossiers.length,
      parcels: measured ? parcels : null,
      weight: measured ? Math.round(weight * 100) / 100 : null,
      basis: confirmed ? 'manifest' : 'loading',
      issuedAt: Number.isFinite(instant) ? new Date(instant).toISOString() : null,
    },
  };
}

/** « 07/10/2026 » for a day written 2026-10-07; null otherwise. */
export function invoiceDayLabel(day) {
  const value = isoCalendarDay(day);
  return value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : null;
}

/** « 07/10/2026 à 14 h 32 », « 01/10/2026 à 8 h » (Paris wall time, as the closings of the
 *  « Départs » page); null without a valid instant (a calendar day alone has no time). */
export function invoiceIssueLabel(value) {
  const wall = isoCalendarDay(value) ? '' : parisDateTimeInput(value);
  if (!wall) return null;
  const hour = Number(wall.slice(11, 13)), minute = wall.slice(14, 16);
  return `${invoiceDayLabel(wall.slice(0, 10))} à ${hour} h${minute === '00' ? '' : ` ${minute}`}`;
}

/** The line printed under the header, saying which edition this is: « Établie avant la
 *  confirmation du départ, d’après tous les dossiers affectés au départ le 07/10/2026 à
 *  14 h 32 (heure de Paris). » or « Établie d’après le manifeste du départ confirmé le
 *  07/10/2026 à 16 h 05 (heure de Paris). »; without the instant when it is unknown. */
export function commercialInvoiceBasis(meta) {
  const issued = invoiceIssueLabel(meta?.issuedAt);
  const at = issued ? ` le ${issued} (heure de Paris)` : '';
  return meta?.basis === 'manifest'
    ? `Établie d’après le manifeste du départ confirmé${at}.`
    : `Établie avant la confirmation du départ, d’après tous les dossiers affectés au départ${at}.`;
}

/** « facture-commerciale-ENV-2026-036 » from the confirmed manifest,
 *  « facture-commerciale-ENV-2026-036-avant-depart » before the departure: the two editions
 *  never share a file name (the extension is the exporter's). */
export function commercialInvoiceFileName(invoice) {
  const number = String(invoice?.meta?.number || 'depart').replace(/[^\w.-]+/g, '-');
  return `facture-commerciale-${number}${invoice?.meta?.basis === 'manifest' ? '' : '-avant-depart'}`;
}
