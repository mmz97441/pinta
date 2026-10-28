import { DESTINATIONS, STATUTS } from '../constants/index.js';
import { RECEPTION_APPEND_STATUSES, RECEPTION_MEASURES, hasCompleteReceptionMeasurements, receptionAppendBlockReason, receptionAppendImpact, receptionCartonManifest, receptionDateSummary } from './reception.js';
import { PAYMENT_DETAIL_LABELS, PAYMENT_STATE_LABELS, TABLE_COLUMNS, TAXES_PRO_LABEL, buildDossierTableModel, formatDossierTableDate } from './dossierTable.js';
import { statusTone } from './dossierTableTone.js';
import { CANCELLED_SEND_LABEL, consentRelance, consentState, consentSummary } from './consentQueue.js';
import { consentFollowUp } from './dossierAlerts.js';
import { messageDeliveryLabel, needsConversationAction } from './conversations.js';
import { findDossierWorkAction } from './personalWork.js';
import { hasCurrentPreparation } from './preparationReadiness.js';
import { savedQuoteBreakdown } from './quoteBreakdown.js';
import { importTaxEstimate } from './importTaxes.js';
import { closingLabel, departureFieldText, dossierDepartureClosing, dossierDestinationCode, dossierWishState } from './departurePlanning.js';
import { NO_DEPARTURE_GROUP_KEY, departureDayLabel, groupDossiersByDeparture, isoCalendarDay } from './departureGroups.js';
import { DOSSIER_TASKS, dossierNextTask, dossierTaskUrl } from './dossierTasks.js';
import { canSeeDossierFinances } from './dossierOverview.js';
import { calculateQuote } from './quote.js';
import { invoiceBuckets, invoiceProgressSummary } from './invoiceProgress.js';
import { pendingInvoiceAttachments } from './invoiceDocuments.js';
import { invoiceRequestState } from './invoiceRequest.js';
import { clientDisplayName } from './clientGroups.js';
import { parseParcelCode } from './parcelCode.js';
import { workspaceReturnPath } from './navigation.js';
import { clientSearchText, countLabel } from '../utils/clientDisplay.js';
import { eur, kg } from '../utils/format.js';

// « Colis » and its Brouillon sheet (docs/specification-brouillon-reception-2026-10-28.md, « Logique Brouillon »):
// the tabs, one row per dossier with its step in the team's words and its one action, the sorts, the departure
// groups and their totals, the Brouillon sheet, the arrival notices and the target of a reception. Every fact is
// read with the existing rules (reception, consent, preparation, invoices, saved quote, departures, permissions):
// nothing here recalculates a price, writes or sends. Pure: no React, no network; the clock only when the caller
// gives no `now`.

// ── Small readers ────────────────────────────────────────────────────────────
const text = value => typeof value === 'string' ? value.trim() : '';
const positive = value => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean'
  && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const finiteAmount = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const instantOf = value => {
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};
/** « 27/10/2026 » on the business calendar (formatDossierTableDate, Indian/Reunion), or null when unknown. */
const dateLabel = value => instantOf(value) === null ? null : formatDossierTableDate(new Date(instantOf(value)).toISOString());
const naturalOrder = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

// The search of utils/index.js (fuzzy): every word of the query, accents and case aside. That module imports
// '../constants' without its extension, which `node --test` cannot load, so its rule is repeated here as is.
const fold = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function fuzzy(haystack, needle) {
  if (!needle) return true;
  const content = fold(haystack);
  return fold(needle).split(/\s+/).filter(Boolean).every(term => content.includes(term));
}
// A tracking number typed or scanned with or without its spaces, dashes, dots or slashes.
const compactCode = value => String(value ?? '').replace(/[\s./-]+/g, '');

// ── Tabs and sorts ───────────────────────────────────────────────────────────
/** The four tabs of « Colis » (`?onglet=`), with the internal statuses each one lists. Archived and cancelled
 * dossiers are in none of them. */
export const COLIS_TABS = Object.freeze([
  Object.freeze({ key: 'brouillon', label: 'Brouillon', description: 'En stock, devis pas encore envoyé', statuts: Object.freeze(['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'refuse_client']) }),
  Object.freeze({ key: 'a_payer', label: 'À payer', description: 'Devis envoyé, paiement attendu', statuts: Object.freeze(['devis_envoye', 'attente_paiement']) }),
  Object.freeze({ key: 'pret', label: 'Prêt à partir', description: 'Payé, pas encore parti', statuts: Object.freeze(['paye']) }),
  Object.freeze({ key: 'parti', label: 'Parti', description: 'Expédié jusqu’à la livraison', statuts: Object.freeze(['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre']) }),
]);
export const COLIS_DEFAULT_TAB = 'brouillon';

/** The tab of a dossier (`brouillon`, `a_payer`, `pret`, `parti`), or null: archived, cancelled or unknown status. */
export function colisTab(dossier) {
  if (!dossier || dossier.archive || dossier.statut === 'annule') return null;
  const tab = COLIS_TABS.find(item => item.statuts.includes(dossier.statut));
  return tab ? tab.key : null;
}

/** A tab key read from the address (`?onglet=`): itself when it exists, otherwise the Brouillon tab. */
export function colisTabKey(value) {
  return COLIS_TABS.some(tab => tab.key === value) ? value : COLIS_DEFAULT_TAB;
}

/** The four ways to sort (`?classer=`), « Par nom » by default. « Par montant » reads prices: `financial`. */
export const COLIS_SORTS = Object.freeze([
  Object.freeze({ key: 'nom', label: 'Par nom' }),
  Object.freeze({ key: 'depart', label: 'Par date d’envoi' }),
  Object.freeze({ key: 'reception', label: 'Par réception' }),
  Object.freeze({ key: 'montant', label: 'Par montant', financial: true }),
]);
export const COLIS_DEFAULT_SORT = 'nom';

/** A sort key read from the address (`?classer=`): itself when it exists, otherwise « Par nom ». */
export function colisSortKey(value) {
  return COLIS_SORTS.some(sort => sort.key === value) ? value : COLIS_DEFAULT_SORT;
}

// ── Measures shared by the Colis and reception screens ───────────────────────
export const MEASURE_MISSING_LABEL = 'À mesurer';
const SIDE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 });
const VOLUME = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** The volume of a box in m³ from its sides in cm (L × l × H ÷ 1 000 000), unrounded; null without three positive sides. */
export function cartonVolumeM3(box) {
  const sides = ['dimL', 'dimW', 'dimH'].map(key => positive(box?.[key]));
  return sides.every(side => side !== null) ? sides[0] * sides[1] * sides[2] / 1000000 : null;
}

/** « 40 × 30,5 × 20 cm », as the dossier table writes dimensions; « À mesurer » without three positive sides. */
export function formatDimensions(box) {
  const sides = ['dimL', 'dimW', 'dimH'].map(key => positive(box?.[key]));
  return sides.every(side => side !== null) ? `${sides.map(side => SIDE.format(side)).join(' × ')} cm` : MEASURE_MISSING_LABEL;
}

/** « 12,5 kg » (kg(): at most two decimals); « À mesurer » for a missing or non-positive weight, never « 0 kg ». */
export function formatKg(value) {
  const weight = positive(value);
  return weight === null ? MEASURE_MISSING_LABEL : kg(weight);
}

/** « 0,125 m³ », rounded to three decimals for display; « < 0,001 m³ » for a smaller volume (never a false
 * zero); « À mesurer » without a positive volume. */
export function formatM3(value) {
  const volume = positive(value);
  if (volume === null) return MEASURE_MISSING_LABEL;
  return volume < 0.0005 ? `<\u00a0${VOLUME.format(0.001)}\u00a0m³` : `${VOLUME.format(volume)}\u00a0m³`;
}

/** Weight and volume of a set of boxes: each a sum only when every box has its value (hundredths of a kilogram,
 * unrounded m³), otherwise null. */
function measuredTotals(boxes) {
  const weights = boxes.map(box => positive(box.poids));
  const volumes = boxes.map(box => cartonVolumeM3(box));
  const poids = boxes.length && weights.every(weight => weight !== null) ? weights.reduce((sum, weight) => sum + Math.round(weight * 100), 0) / 100 : null;
  const volume = boxes.length && volumes.every(item => item !== null) ? volumes.reduce((sum, item) => sum + item, 0) : null;
  return { poids, volume, poidsLabel: formatKg(poids), volumeLabel: formatM3(volume) };
}

// ── Receptions waiting for their validation ──────────────────────────────────
const wholeNumber = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
function cartonCountOf(entry, cartons) {
  const counted = wholeNumber(entry?.cartonCount);
  if (counted !== null) return counted;
  if (cartons.length) return cartons.length;
  const first = wholeNumber(entry?.firstCarton), last = wholeNumber(entry?.lastCarton);
  return first !== null && last !== null && last >= first ? last - first + 1 : 0;
}
const earliest = (left, right) => instantOf(left) === null ? right || null : instantOf(right) === null || instantOf(left) <= instantOf(right) ? left : right;
const latest = (left, right) => instantOf(left) === null ? right || null : instantOf(right) === null || instantOf(left) >= instantOf(right) ? left : right;

/** The receptions to validate (fetchPendingReceptions) indexed by dossier: Map(colisId → entry), each entry as
 * the server gives it with `cartons` always a list and `cartonCount` always a number. Two entries of the same
 * dossier are merged (first and last cartons, dates, cartons). */
export function pendingByColis(pendingList) {
  const index = new Map();
  for (const entry of pendingValues(pendingList)) {
    if (!entry?.colisId) continue;
    const cartons = Array.isArray(entry.cartons) ? entry.cartons.filter(Boolean) : [];
    const own = { ...entry, cartons, cartonCount: cartonCountOf(entry, cartons) };
    const previous = index.get(entry.colisId);
    if (!previous) { index.set(entry.colisId, own); continue; }
    const numbers = new Set(previous.cartons.map(carton => carton.carton));
    const merged = [...previous.cartons, ...cartons.filter(carton => !numbers.has(carton.carton))]
      .sort((left, right) => (Number(left.carton) || 0) - (Number(right.carton) || 0));
    const firsts = [previous.firstCarton, own.firstCarton].map(wholeNumber).filter(value => value !== null);
    const lasts = [previous.lastCarton, own.lastCarton].map(wholeNumber).filter(value => value !== null);
    index.set(entry.colisId, { ...previous, cartons: merged,
      firstCarton: firsts.length ? Math.min(...firsts) : previous.firstCarton ?? null,
      lastCarton: lasts.length ? Math.max(...lasts) : previous.lastCarton ?? null,
      cartonCount: merged.length || previous.cartonCount + own.cartonCount,
      receivedFrom: earliest(previous.receivedFrom, own.receivedFrom), receivedTo: latest(previous.receivedTo, own.receivedTo) });
  }
  return index;
}

/** The list behind any form of `pending`: the server's list, the index of pendingByColis or an object by dossier. */
function pendingValues(pending) {
  if (pending instanceof Map) return [...pending.values()];
  if (Array.isArray(pending)) return pending;
  return pending && typeof pending === 'object' ? Object.values(pending) : [];
}

function pendingEntry(pending, colisId) {
  if (!pending || !colisId) return null;
  const own = pending instanceof Map ? [pending.get(colisId)]
    : Array.isArray(pending) ? pending.filter(item => item?.colisId === colisId)
      : typeof pending === 'object' ? [pending[colisId]] : [];
  const entry = pendingByColis(own.filter(Boolean).map(item => ({ colisId, ...item }))).get(colisId);
  return entry && entry.cartonCount > 0 ? entry : null;
}

/** The numbers (1 = first) of a dossier's cartons waiting for their validation. */
function pendingNumbers(entry) {
  if (!entry) return new Set();
  const listed = entry.cartons.map(carton => wholeNumber(carton.carton)).filter(value => value !== null);
  if (listed.length) return new Set(listed);
  const first = wholeNumber(entry.firstCarton), last = wholeNumber(entry.lastCarton);
  return new Set(first !== null && last !== null && last >= first ? Array.from({ length: last - first + 1 }, (_, index) => first + index) : []);
}

/** « /recevoir?client=<id>&valider=1 »: the reception opened on its validation. */
const receptionValidationHref = clientId => clientId ? `/recevoir?${new URLSearchParams({ client: clientId, valider: '1' })}` : null;

/** The receptions to validate grouped by client, the longest waiting first: [{ clientId, dossiers, items,
 * cartonCount, receivedFrom, receivedTo, href }]. `items`: what validateReception takes to validate them all,
 * [{ colisId, fromCarton, throughCarton }]: the first and the last carton waiting of each dossier, as listed (the
 * server refuses a validation whose first carton is no longer the one shown); orderValidationItems sets their order.
 * `href`: « Valider et prévenir ». */
export function pendingByClient(pending) {
  const groups = new Map();
  for (const entry of pendingByColis(pendingValues(pending)).values()) {
    if (!entry.clientId || !(entry.cartonCount > 0)) continue;
    const group = groups.get(entry.clientId) || { clientId: entry.clientId, dossiers: [], items: [], cartonCount: 0, receivedFrom: null, receivedTo: null, href: receptionValidationHref(entry.clientId) };
    group.dossiers.push(entry);
    // The cartons listed are those shown; without them, the range the server gave.
    const shown = entry.cartons.map(carton => wholeNumber(carton.carton)).filter(value => value !== null);
    const from = shown.length ? Math.min(...shown) : wholeNumber(entry.firstCarton);
    const through = shown.length ? Math.max(...shown) : wholeNumber(entry.lastCarton);
    if (from !== null && through !== null && through >= from) group.items.push({ colisId: entry.colisId, fromCarton: from, throughCarton: through });
    group.cartonCount += entry.cartonCount;
    group.receivedFrom = earliest(group.receivedFrom, entry.receivedFrom);
    group.receivedTo = latest(group.receivedTo, entry.receivedTo);
    groups.set(entry.clientId, group);
  }
  return [...groups.values()].sort((left, right) => {
    const a = instantOf(left.receivedFrom), b = instantOf(right.receivedFrom);
    if (a === null || b === null) return a !== null ? -1 : b !== null ? 1 : String(left.clientId).localeCompare(String(right.clientId));
    return a - b || String(left.clientId).localeCompare(String(right.clientId));
  });
}

// ── What is known of a dossier ───────────────────────────────────────────────
function clientOf(dossier, ctx) {
  const given = ctx.client;
  if (given && (!given.id || !dossier.clientId || given.id === dossier.clientId)) return given;
  if (typeof ctx.getClient === 'function' && dossier.clientId) return ctx.getClient(dossier.clientId) || null;
  return null;
}

/** Everything a step, a row and a sheet read, computed once: the dossier table model gives the saved quote's
 * price (quotePrice), the payment, the departure and the reception dates. */
function factsOf(dossier, ctx = {}) {
  const now = instantOf(ctx.now) ?? Date.now();
  const client = clientOf(dossier, ctx || {});
  const envois = Array.isArray(ctx.envois) ? ctx.envois.filter(Boolean) : [];
  const can = typeof ctx.can === 'function' ? ctx.can : () => false;
  const settings = ctx.settings || {};
  // A null client must not replace the model's own fallback (the saved quote's client).
  const model = buildDossierTableModel(dossier, { client: client || undefined, envois, can, now, settings });
  // The team's tasks (staff_work_actions), the person reading (auth.u) and the team: who holds a task.
  const meId = typeof ctx.me === 'string' ? ctx.me : ctx.me?.id || null;
  return { dossier, client, envois, can, now, settings, model, tab: colisTab(dossier), finances: canSeeDossierFinances(can), pending: pendingEntry(ctx.pending, dossier.id),
    notices: ctx.notices, tarifs: ctx.tarifs, categories: ctx.categories, actions: ctx.actions, meId, teamUsers: ctx.teamUsers };
}

/** The existing rule of the quote engine (calculateQuote, errors of the field « factures »): the quote of a
 * private client needs at least one validated purchase invoice, every invoice verified, their documents attached
 * and positive amounts. The quote task shows « Factures à vérifier avant le devis » on the same errors. */
function invoicesBlockQuote(dossier, client) {
  const quoteClient = client || dossier.devisSnapshot?.inputs?.client || {};
  return calculateQuote({ colis: dossier, client: quoteClient, mode: 'final' }).errors.some(error => error.field === 'factures');
}

/** An error of calculateQuote in the team's plain words: what is still missing for the quote. */
function quoteGap(error) {
  const field = String(error?.field || ''), message = String(error?.message || '');
  const article = /^(lignes|customs)\.(\d+)$/.exec(field);
  if (article) return article[1] === 'customs' ? `Classement douanier de l’article ${Number(article[2]) + 1} à vérifier` : `Article ${Number(article[2]) + 1} à compléter`;
  if (field.startsWith('dimensions')) return 'Mesures après optimisation';
  if (field.startsWith('fraisDivers')) return 'Frais divers à compléter';
  if (field === 'dossier') return /interdit/i.test(message) ? 'Produit interdit à régler' : /feu vert/i.test(message) ? 'Accord du client' : /archiv/i.test(message) ? 'Dossier archivé' : message;
  return {
    factures: 'Factures d’achat vérifiées',
    client: 'Type de client à renseigner',
    destination: /TVA/.test(message) ? 'Taux de TVA de la destination à renseigner' : 'Destination du client à vérifier',
    settings: 'Diviseur volumétrique à régler',
    tarif: 'Tarif de la destination à renseigner',
    lignes: /valeur totale/i.test(message) ? 'Valeur des articles à vérifier' : 'Articles et catégories à renseigner',
    total: 'Total du devis à vérifier',
  }[field] || message;
}

/** What the complete quote still misses, as the « Prêts à chiffrer » queue checks it (workQueues, « ready »): the
 * calculation with the client's destination, its tariff, the categories and the settings, its errors in plain words,
 * without repeats. Null when the caller gives no `tarifs` and `categories` (nothing is claimed without them). */
function quoteGaps(f) {
  if (!f.tarifs || typeof f.tarifs !== 'object' || !Array.isArray(f.categories)) return null;
  if (!f.client) return ['Fiche client à retrouver'];
  const destination = DESTINATIONS[String(f.client.cp || '').slice(0, 3)];
  const result = calculateQuote({ colis: f.dossier, client: f.client, destination, tarif: f.tarifs[destination?.code], categories: f.categories, settings: f.settings });
  return [...new Set(result.errors.map(quoteGap).filter(Boolean))];
}

// ── Steps ────────────────────────────────────────────────────────────────────
/** The steps of the Brouillon tab, in the order they are recognised: the first that applies wins (« Le client a
 * répondu » before any request or relance, « Demande à vérifier » before waiting for an answer). */
export const BROUILLON_STAGES = Object.freeze([
  { key: 'reception_a_valider', label: 'Réception à valider' },
  { key: 'mesures_a_completer', label: 'Mesures à compléter' },
  { key: 'client_a_repondu', label: 'Le client a répondu' },
  { key: 'accord_a_demander', label: 'Accord à demander' },
  { key: 'demande_a_verifier', label: 'Demande à vérifier' },
  { key: 'attend_client', label: 'Attend le client' },
  { key: 'client_refuse', label: 'Le client refuse' },
  { key: 'produit_interdit', label: 'Produit interdit à régler' },
  { key: 'a_preparer', label: 'À préparer' },
  { key: 'facture_manquante', label: 'Facture manquante' },
  { key: 'devis_a_completer', label: 'Devis à compléter' },
  { key: 'pret_pour_devis', label: 'Prêt pour le devis' },
].map(item => Object.freeze(item)));
const STAGE_LABELS = Object.fromEntries(BROUILLON_STAGES.map(item => [item.key, item.label]));

/** What a row without action says: the dossier waits for someone else. */
export const NO_ACTION_LABEL = 'Rien à faire';

// The rights of each action, as the screen that does it checks them: `permissions`, any one suffices (none: open to
// all); `requiresAll`, every one is needed too (the correction of a task asks for perm_colis_revenir_arriere AND the
// right of the task, as correct-colis-task does). `deniedReason`: what the screen says without them.
const RIGHTS = Object.freeze({
  // The reception page (/recevoir), App.jsx.
  reception: { permissions: ['perm_colis_receptionner'], deniedReason: 'Réservé aux personnes autorisées à réceptionner.' },
  // « Enregistrer les mesures de réception », StaffDetailView.
  mesures: { permissions: ['perm_colis_mesurer'], deniedReason: 'Réservé aux personnes autorisées à mesurer les cartons.' },
  // The request and the relance (TaskMessage, disabled without it), queue_message.
  accord: { permissions: ['perm_colis_demander_feuvert'], deniedReason: 'Réservé aux personnes autorisées à demander l’accord.' },
  // A new request after the client's wait: TaskReopen of the accord task (correct-colis-task).
  nouvelAccord: { permissions: ['perm_colis_demander_feuvert'], requiresAll: ['perm_colis_revenir_arriere'], deniedReason: 'Réservé aux personnes autorisées à corriger le dossier et à demander l’accord.' },
  // « Commencer la préparation », « Enregistrer l’optimisation », StaffDetailView.
  preparation: { permissions: ['perm_colis_preparer'], deniedReason: 'Réservé aux personnes autorisées à préparer.' },
  // InvoiceWorkspace: add a document, or verify one.
  factures: { permissions: ['perm_factures_ajouter', 'perm_factures_valider'], deniedReason: 'Réservé aux personnes autorisées à ajouter ou vérifier les factures.' },
  // « Enregistrer et vérifier le devis », « Envoyer le devis au client », StaffDetailView.
  devis: { permissions: ['perm_colis_calculer_devis', 'perm_colis_envoyer_devis'], deniedReason: 'Réservé aux personnes autorisées à établir ou envoyer le devis.' },
  // « Confirmer réception du paiement », or the payment relance (TaskMessage and its channels).
  paiement: { permissions: ['perm_colis_confirmer_paiement', 'perm_comm_telegram', 'perm_comm_email', 'perm_comm_message_libre'], deniedReason: 'Réservé aux personnes autorisées à suivre les règlements.' },
  // The departure field and « Vérifier le départ et son manifeste »: both need the departures.
  depart: { permissions: ['perm_envois_voir'], deniedReason: 'Réservé aux personnes ayant accès aux départs.' },
  // The transport steps, StaffDetailView.
  transport: { permissions: ['perm_colis_changer_statut_expedition'], deniedReason: 'Réservé à l’équipe chargée du transport.' },
  // The Conversation tab of the dossier, App.jsx.
  conversation: { permissions: ['perm_comm_message_libre', 'perm_comm_telegram', 'perm_comm_email', 'perm_comm_voir_chat_autres'], deniedReason: 'Réservé aux personnes autorisées à échanger avec les clients.' },
  // « Vérifier et réessayer » of a message not delivered, ChatPanel: the right of its channel.
  telegram: { permissions: ['perm_comm_telegram'], deniedReason: 'Réservé aux personnes autorisées à écrire sur Telegram.' },
  email: { permissions: ['perm_comm_email'], deniedReason: 'Réservé aux personnes autorisées à écrire par e-mail.' },
  // Consulting the dossier asks for nothing more.
  consultation: { permissions: [] },
});

// One action = one click. `task`: the dossier task it opens (dossierTaskUrl); `panel`: the message the screen opens
// in place (TaskMessage template, as in StaffDetailView), no page; `href`: an address of its own.
const action = (key, label, task, rights, extra = {}) => ({
  key, label, task: task || null, permissions: [...rights.permissions],
  ...(rights.requiresAll ? { requiresAll: [...rights.requiresAll] } : {}),
  ...(rights.deniedReason ? { deniedReason: rights.deniedReason } : {}),
  ...extra,
});
/** « /colis/<id>?onglet=conversation »: the conversation of the dossier. */
const conversationHref = dossier => dossier.id ? `/colis/${encodeURIComponent(dossier.id)}?${new URLSearchParams({ onglet: 'conversation' })}` : null;
const ACTIONS = {
  validerReception: dossier => action('valider_reception', 'Valider la réception', null, RIGHTS.reception, { href: receptionValidationHref(dossier.clientId) }),
  completerMesures: () => action('completer_mesures', 'Compléter les mesures', 'reception', RIGHTS.mesures),
  demanderAccord: () => action('demander_accord', 'Demander l’accord', 'accord', RIGHTS.accord, { panel: 'demande_feu_vert' }),
  relancer: () => action('relancer', 'Relancer', 'accord', RIGHTS.accord, { panel: 'relance_feu_vert' }),
  // After a wait the client chose, the request is asked again (TaskReopen in the accord task, as StaffDetailView does).
  redemanderAccord: () => action('redemander_accord', 'Redemander l’accord', 'accord', RIGHTS.nouvelAccord),
  // The client wrote: their message is read and answered in the conversation, before anything is asked of them.
  lireReponse: dossier => action('lire_reponse', 'Lire la réponse', null, RIGHTS.conversation, { href: conversationHref(dossier) }),
  // A request or relance not delivered: the conversation shows it with « Vérifier et réessayer ».
  verifierEnvoi: (dossier, canal) => action('verifier_envoi', 'Vérifier l’envoi', null, canal === 'telegram' ? RIGHTS.telegram : canal === 'email' ? RIGHTS.email : RIGHTS.conversation, { href: conversationHref(dossier) }),
  voirDossier: task => action('voir_dossier', 'Voir le dossier', task, RIGHTS.consultation),
  preparer: () => action('preparer', 'Préparer', 'preparation', RIGHTS.preparation),
  ajouterFacture: () => action('ajouter_facture', 'Ajouter la facture', 'documents', RIGHTS.factures),
  completerDevis: () => action('completer_devis', 'Compléter le devis', 'devis', RIGHTS.devis),
  envoyerDevis: () => action('envoyer_devis', 'Envoyer le devis', 'devis', RIGHTS.devis),
  suivrePaiement: () => action('suivre_paiement', DOSSIER_TASKS.paiement.title, 'paiement', RIGHTS.paiement),
  preparerDepart: () => action('preparer_depart', 'Préparer le départ', 'expedition', RIGHTS.depart),
  suivreExpedition: () => action('suivre_expedition', DOSSIER_TASKS.expedition.title, 'expedition', RIGHTS.transport),
  suivreLivraison: () => action('suivre_livraison', DOSSIER_TASKS.livraison.title, 'livraison', RIGHTS.transport),
};

/** Whether this person may do this action: one of its `permissions` (none: open to all) and every one of its
 * `requiresAll`. `can` is the permission check of the screen (useApp().can). False without an action. A task held
 * by a colleague (`heldBy` on the step) is said apart. */
export function actionAllowed(action, can) {
  if (!action) return false;
  const check = typeof can === 'function' ? can : () => false;
  const any = Array.isArray(action.permissions) ? action.permissions : [];
  const all = Array.isArray(action.requiresAll) ? action.requiresAll : [];
  return (any.length === 0 || any.some(permission => check(permission))) && all.every(permission => check(permission));
}

// `tone`: the colour family of the dossier table (DOSSIER_TABLE_TONES): current (to do), waiting (someone else),
// review (to check), done, neutral.
const stage = (key, label, detail, tone, next) => ({ key, label, detail: detail || '', tone, action: next || null });

// The team task an action works on, when it is not its dossier task: the conversation.
const CONVERSATION_ACTIONS = new Set(['lire_reponse', 'verifier_envoi']);
/** The colleague holding the team task of this action (staff_work_actions, as findDossierWorkAction finds it: the
 * accord is the « reception » task, as _assert_staff_task_owner(id, 'reception') checks it on the server), when
 * another active member of the team holds it and it is not done: `{ id, name }`, the name as the application writes
 * it (first name and name, « Membre de l’équipe » otherwise). Null without the tasks, the person or the team. */
function heldByOf(f, next) {
  if (!next || !Array.isArray(f.actions) || !f.meId || !Array.isArray(f.teamUsers)) return null;
  const task = CONVERSATION_ACTIONS.has(next.key) ? 'conversation' : next.task;
  if (!task) return null;
  const work = findDossierWorkAction(f.dossier, f.actions, task);
  if (!work?.assignee_id || work.assignee_id === f.meId || work.state === 'done') return null;
  const member = f.teamUsers.find(user => user?.authId === work.assignee_id);
  if (!member || member.actif === false) return null;
  return { id: work.assignee_id, name: [text(member.prenom), text(member.nom)].filter(Boolean).join(' ') || 'Membre de l’équipe' };
}

function receptionStage(f) {
  const count = f.pending.cartonCount;
  const day = dateLabel(f.pending.receivedTo || f.pending.receivedFrom);
  const when = day ? ` · ${count > 1 ? 'dernier reçu' : 'reçu'} le ${day}` : '';
  return stage('reception_a_valider', STAGE_LABELS.reception_a_valider, `${countLabel(count, 'carton', 'cartons')} à valider${when}`, 'current', ACTIONS.validerReception(f.dossier));
}

// The client's decisions by button are no message to answer (conversationState leaves them aside too).
const CLIENT_DECISIONS = new Set(['client_decision_approve', 'client_decision_wait']);
/** « Le client a répondu »: their conversation is to answer (needsConversationAction). Nothing is asked of them
 * before their message is read, never a relance. */
function repliedStage(f) {
  const latest = (Array.isArray(f.dossier.messages) ? f.dossier.messages : [])
    .filter(message => message?.type === 'client' && !CLIENT_DECISIONS.has(message.template) && instantOf(message.createdAt) !== null)
    .reduce((last, message) => !last || instantOf(message.createdAt) >= instantOf(last.createdAt) ? message : last, null);
  const day = latest ? dateLabel(latest.createdAt) : null;
  return stage('client_a_repondu', STAGE_LABELS.client_a_repondu, day ? `Message du ${day} à lire` : 'Message à lire', 'current', ACTIONS.lireReponse(f.dossier));
}

/** A message still on its way after this many minutes is to check (an arrival notice, a request or a relance of
 * consent): its delivery no longer runs by itself (scheduled task stopped, missing token…) or its result is
 * uncertain. Nothing is sent again on its own. */
export const NOTICE_SEND_CHECK_MINUTES = 10;
const SEND_CHECK_MS = NOTICE_SEND_CHECK_MINUTES * 60000;
// Still to deliver (notification_outbox): queued, being sent, or held.
const ON_ITS_WAY = new Set(['pending', 'sending', 'blocked']);
// What a delivery still on its way after those minutes says, by the state of its outbox.
const STUCK_SEND = Object.freeze({
  pending: `Toujours pas parti au bout de ${NOTICE_SEND_CHECK_MINUTES} minutes`,
  sending: `Envoi commencé il y a plus de ${NOTICE_SEND_CHECK_MINUTES} minutes, sans confirmation`,
  blocked: `Envoi retenu depuis plus de ${NOTICE_SEND_CHECK_MINUTES} minutes`,
  unknown: `Envoi sans confirmation depuis plus de ${NOTICE_SEND_CHECK_MINUTES} minutes`,
});

const CONSENT_MESSAGES = new Set(['demande_feu_vert', 'relance_feu_vert']);
/** The latest request or relance of consent the team wrote, as consentFollowUp selects it (a message of the client
 * never counts; equal instants by id). */
function latestConsentMessage(dossier) {
  return (Array.isArray(dossier.messages) ? dossier.messages : [])
    .filter(message => (message?.type ?? 'staff') === 'staff' && CONSENT_MESSAGES.has(message.template) && instantOf(message.createdAt) !== null)
    .reduce((last, message) => {
      if (!last) return message;
      const time = instantOf(message.createdAt), lastTime = instantOf(last.createdAt);
      return time > lastTime || time === lastTime && String(message.id) > String(last.id) ? message : last;
    }, null);
}

/** The latest request or relance of consent when it did not reach the client: failed (outbox « failed », or the
 * message « echec » without a delivery in progress: « Envoi non confirmé »), cancelled other than by the client's own
 * wait (« Envoi annulé »; client_decision('wait') cancels the queued relances, that is no failure), or still on its
 * way after NOTICE_SEND_CHECK_MINUTES, the rule of the arrival notices. `{ message, wording }`, or null: delivered,
 * an e-mail draft (outbox « manual »), or on its way for a few minutes. */
function consentNotDelivered(dossier, now) {
  const message = latestConsentMessage(dossier);
  if (!message) return null;
  const outbox = message.outboxStatus ?? null;
  if (outbox === 'sent' || outbox === 'manual' || outbox === null && ['envoye', 'distribue', 'lu'].includes(message.statut)) return null;
  const waitChosenAt = instantOf(dossier.attenteClientDate);
  const byClientWait = waitChosenAt !== null && waitChosenAt >= instantOf(message.createdAt);
  if (outbox === 'cancelled' || outbox === null && message.statut === 'envoi' && message.canal !== 'email' && byClientWait)
    return byClientWait ? null : { message, wording: CANCELLED_SEND_LABEL };
  if (outbox === 'failed' || message.statut === 'echec' && !ON_ITS_WAY.has(outbox)) return { message, wording: messageDeliveryLabel({ statut: 'echec' }) };
  const onItsWay = ON_ITS_WAY.has(outbox) || outbox === null && message.statut === 'envoi' && message.canal !== 'email';
  // A relance the server postponed (one relance per client in 24 hours, a conversation to answer first) leaves at its
  // own time: when the data layer gives it (`outboxAvailableAt`, notification_outbox.available_at), the minutes count
  // from then.
  const since = Math.max(instantOf(message.createdAt), instantOf(message.outboxAvailableAt) ?? -Infinity);
  return onItsWay && now - since > SEND_CHECK_MS ? { message, wording: STUCK_SEND[outbox] || STUCK_SEND.unknown } : null;
}

function waitingStage(f) {
  const { dossier, now } = f;
  if (needsConversationAction(dossier)) return repliedStage(f);
  const consent = consentState(dossier, now);
  const waitChosen = consent?.stage === 'client_waiting';
  // A wait the client chose: nothing to do until its day has passed.
  if (waitChosen && !consent.over) return stage('attend_client', STAGE_LABELS.attend_client, consentSummary(consent), 'waiting', null);
  // A request or relance that did not reach the client is checked in the conversation, never relanced.
  const lost = consentNotDelivered(dossier, now);
  if (lost) return stage('demande_a_verifier', STAGE_LABELS.demande_a_verifier, `${lost.message.template === 'relance_feu_vert' ? 'Relance' : 'Demande'} du ${dateLabel(lost.message.createdAt)} · ${lost.wording}`,
    'review', ACTIONS.verifierEnvoi(dossier, lost.message.canal));
  // The latest request or relance is followed up (consentFollowUp): still to deliver, or delivered less than 24 h
  // ago. Also after a wait that has ended, once the team has relanced the client.
  const followUp = consentFollowUp(dossier, now);
  const relance = consentRelance(dossier);
  if (followUp?.pending) return stage('attend_client', STAGE_LABELS.attend_client, `${relance ? 'Relance' : 'Demande'} en cours d’envoi`, 'waiting', null);
  if (followUp) return stage('attend_client', STAGE_LABELS.attend_client, `${relance ? 'Relancé' : 'Demandé'} le ${dateLabel(followUp.at)}`, 'waiting', null);
  // The wait has ended (« Attente terminée … à réexaminer »): the client answered « wait », so the accord is asked
  // again from the accord task (a new request version), never relanced on the old one.
  if (waitChosen) return stage('attend_client', STAGE_LABELS.attend_client, consentSummary(consent), 'waiting', ACTIONS.redemanderAccord());
  // No follow-up running: the relance is due. It never leaves on its own (the server's reminders are manual). An
  // e-mail relance kept as a draft says so (« Brouillon manuel »).
  const requestedAt = dateLabel(dossier.demandeFeuVertEnvoyeeAt);
  const last = relance ? relance.delivered || !relance.deliveryLabel ? `relancé le ${dateLabel(relance.at)}` : `relance du ${dateLabel(relance.at)} · ${relance.deliveryLabel}`
    : requestedAt ? `demandé le ${requestedAt}` : '';
  return stage('attend_client', STAGE_LABELS.attend_client, `Sans réponse${last ? ` · ${last}` : ''}`, 'waiting', ACTIONS.relancer());
}

function preparationDetail(dossier) {
  const outdated = dossier.preparationCompositionVersion != null && dossier.finalMeasurementsVersion != null
    && dossier.finalMeasurementsVersion !== dossier.preparationCompositionVersion;
  if (outdated) return 'Mesures après optimisation à confirmer pour les cartons actuels';
  if (dossier.statut === 'en_preparation') return 'Préparation en cours';
  const day = dateLabel(dossier.feuVertDate);
  return day ? `Accord donné le ${day}` : 'Accord donné';
}

function quoteReadyDetail(dossier) {
  if (dossier.devisBrouillon && positive(dossier.devisTotal) !== null) return 'Devis enregistré · à vérifier et envoyer';
  if (dossier.devisEnvoyeLe) return 'Ancien devis retiré · nouveau devis à envoyer';
  return 'Tout est prêt pour le devis';
}

function brouillonStage(f) {
  const { dossier, client } = f;
  if (f.pending) return receptionStage(f);
  if (dossier.statut === 'receptionne') {
    const missing = receptionCartonManifest(dossier).dimsParColis.filter(box => !RECEPTION_MEASURES.every(({ key }) => positive(box[key]) !== null)).length;
    return stage('mesures_a_completer', STAGE_LABELS.mesures_a_completer, missing ? `${countLabel(missing, 'carton', 'cartons')} sans mesures` : 'Mesures à enregistrer', 'current', ACTIONS.completerMesures());
  }
  if (dossier.statut === 'mesure') {
    if (needsConversationAction(dossier)) return repliedStage(f);
    const again = Number(dossier.consentRequestVersion) > 0 || Boolean(dossier.demandeFeuVertEnvoyeeAt);
    return stage('accord_a_demander', STAGE_LABELS.accord_a_demander, again ? 'Nouvelle demande à envoyer' : 'Jamais demandé', 'current', ACTIONS.demanderAccord());
  }
  if (dossier.statut === 'attente_feu_vert') return waitingStage(f);
  if (dossier.statut === 'refuse_client') {
    const day = dateLabel(dossier.feuVertDate);
    return stage('client_refuse', STAGE_LABELS.client_refuse, day ? `Refus enregistré le ${day}` : 'Refus enregistré', 'review', ACTIONS.voirDossier('accord'));
  }
  // « autorise » or « en_preparation » whose consent is not recorded (dossierNextTask: « accord »): the request
  // cannot be sent from this status, the dossier's accord task reopens it.
  if (dossier.feuVert !== undefined && dossier.feuVert !== 'autorise')
    return stage('accord_a_demander', STAGE_LABELS.accord_a_demander, 'Accord du client à vérifier dans le dossier', 'review', ACTIONS.voirDossier('accord'));
  if (dossier.produitInterdit) {
    const items = (Array.isArray(dossier.checkInterdits) ? dossier.checkInterdits : []).map(text).filter(Boolean);
    return stage('produit_interdit', STAGE_LABELS.produit_interdit, items.length ? `Signalé : ${items.join(', ')}` : 'Signalé à la réception', 'review', ACTIONS.voirDossier('reception'));
  }
  if (!hasCurrentPreparation(dossier)) return stage('a_preparer', STAGE_LABELS.a_preparer, preparationDetail(dossier), 'current', ACTIONS.preparer());
  if (invoicesBlockQuote(dossier, client)) {
    const progress = invoiceProgressSummary(invoiceBuckets(dossier.factures || [], { pendingAttachments: pendingInvoiceAttachments(dossier) }));
    return stage('facture_manquante', STAGE_LABELS.facture_manquante, progress.text, 'review', ACTIONS.ajouterFacture());
  }
  // Ready only if the complete quote would be calculated (destination, tariff, articles and categories, type of client…).
  const gaps = quoteGaps(f);
  if (gaps?.length) return stage('devis_a_completer', STAGE_LABELS.devis_a_completer, gaps[0], 'review', ACTIONS.completerDevis());
  return stage('pret_pour_devis', STAGE_LABELS.pret_pour_devis, quoteReadyDetail(dossier), 'current', ACTIONS.envoyerDevis());
}

// The other tabs read the existing models: the payment (buildDossierTableModel.payment), the departure
// (its readiness and planning) and the status.
function paymentStage(f) {
  const payment = f.model.payment;
  const sentDay = dateLabel(payment.sentAt);
  const sent = sentDay ? `Devis envoyé le ${sentDay}` : 'Devis envoyé';
  const withdrawn = payment.detailLabel === PAYMENT_DETAIL_LABELS.toRecalculate;
  // Only an expected or partial payment is the normal wait of this tab; any other situation is checked. The states
  // carry no amount: everyone reads them; the rest to pay only with the right to see amounts.
  const review = ![PAYMENT_DETAIL_LABELS.expected, PAYMENT_DETAIL_LABELS.partial].includes(payment.detailLabel);
  // While the payment is awaited, its task offers a relance: a client who wrote is read first.
  if (!review && needsConversationAction(f.dossier)) return repliedStage(f);
  const remaining = f.finances && payment.paid > 0 && payment.remaining > 0 ? ` · reste ${eur(payment.remaining)}` : '';
  return stage(review ? 'paiement_a_verifier' : 'paiement_attendu', payment.detailLabel, withdrawn ? 'Devis retiré · à refaire' : `${sent}${remaining}`, review ? 'review' : 'waiting', ACTIONS.suivrePaiement());
}

function readyStage(f) {
  const departure = f.model.departure;
  const ready = /^Prêt/.test(departure.readinessLabel || '');
  const planned = departure.label === 'À choisir' ? 'Départ à choisir' : departure.label;
  return stage(ready ? 'pret_a_partir' : 'depart_a_verifier', departure.readinessLabel || 'Départ à vérifier', planned, ready ? 'current' : 'review', ACTIONS.preparerDepart());
}

function departedStage(f) {
  const { dossier, envois, now } = f;
  const envoi = envois.find(item => item.id === (dossier.envoi || dossier.envoiId));
  const day = isoCalendarDay(envoi?.date);
  const label = STATUTS[dossier.statut]?.label || 'Statut à vérifier';
  if (dossier.statut === 'livre') {
    const delivered = dateLabel(dossier.dateLivraison);
    return stage('livre', label, delivered ? `Livré le ${delivered}` : '', 'done', null);
  }
  const task = dossierNextTask(dossier, () => true, f.client || {});
  return stage('parti', label, day ? `Départ du ${departureDayLabel(day, { today: now })}` : f.model.departure.label, statusTone(dossier, f.model),
    task === 'livraison' ? ACTIONS.suivreLivraison() : ACTIONS.suivreExpedition());
}

function tabStage(f) {
  const { dossier } = f;
  if (dossier.archive) return stage('archive', 'Dossier archivé', 'Aucune action attendue', 'neutral', null);
  if (dossier.statut === 'annule') return stage('annule', 'Dossier annulé', 'Aucune action attendue', 'neutral', null);
  if (f.tab === 'brouillon') return brouillonStage(f);
  if (f.tab === 'a_payer') return paymentStage(f);
  if (f.tab === 'pret') return readyStage(f);
  if (f.tab === 'parti') return departedStage(f);
  return stage('etat_a_verifier', 'État à vérifier', 'Statut du dossier inconnu', 'review', ACTIONS.voirDossier(dossierNextTask(dossier, () => true, f.client || {})));
}

/** The step, and `heldBy` when a colleague holds the task of its action. */
function stageOf(f) {
  const result = tabStage(f);
  const heldBy = heldByOf(f, result.action);
  return heldBy ? { ...result, heldBy } : result;
}

/**
 * Where the dossier is: `{ key, label, detail, tone, action, heldBy? }`.
 * - `action` = `{ key, label, task, permissions, requiresAll?, deniedReason?, panel?, href? }`, or null for « Rien à
 *   faire »: `task` the dossier task it opens (null for an address of its own); `panel` the message opened in place
 *   (« Demander l’accord », « Relancer »); `href` « Valider la réception » (its reception), « Lire la réponse » and
 *   « Vérifier l’envoi » (the dossier's conversation; colisActionHref adds the way back). `permissions`: the rights
 *   of the screen that does it, one suffices (none: open to all, « Voir le dossier »); `requiresAll`: needed too
 *   (« Redemander l’accord »); `deniedReason`: what to say without them. actionAllowed(action, can) checks them.
 * - `heldBy` = `{ id, name }`, only when `ctx.actions`, `ctx.me` and `ctx.teamUsers` show the team task of the
 *   action held by another active member, not done (heldByOf).
 * Brouillon: the first step of BROUILLON_STAGES that applies. Other tabs: the payment (« Le client a répondu »
 * first while it is awaited), the departure readiness or the status, with the paiement, expedition or livraison task.
 * `ctx` = { client, envois, settings, pending, notices, can, now, tarifs, categories, actions, me, teamUsers }
 * (`pending`: pendingByColis or the server's list; `tarifs` and `categories` as useApp() gives them: without them
 * « Prêt pour le devis » is not checked against the complete calculation; `actions`: useApp().workActions, `me`:
 * auth.u or its id, `teamUsers`: useApp().teamUsers).
 */
export function colisStage(dossier, ctx = {}) {
  return stageOf(factsOf(dossier || {}, ctx || {}));
}

// ── Rows ─────────────────────────────────────────────────────────────────────
const UNKNOWN_CLIENT = 'Client non renseigné';
const clientTypeLabel = client => !client ? null : client.type === 'pro' ? 'Professionnel' : client.type === 'particulier' ? 'Particulier' : 'Type à préciser';

/** The received cartons as the dossier records them (receptionCartonManifest: a former single carton without
 * per-carton measures keeps its own; several cartons are never split from a total), with their arrival dates. */
function receivedCartons(dossier, now, pending) {
  const manifest = receptionCartonManifest(dossier);
  const dates = receptionDateSummary(dossier, { now });
  const waiting = pendingNumbers(pending);
  return manifest.dimsParColis.map((box, index) => {
    const detail = manifest.trackingsDetail[index] || {};
    const volume = cartonVolumeM3(box);
    const receivedAt = dates.dates[index]?.receivedAt || null;
    const supplier = text(detail.fournisseur) || null, tracking = text(detail.number) || null;
    return {
      number: index + 1, supplier, supplierLabel: supplier || 'Vendeur non renseigné', tracking, trackingLabel: tracking || 'Sans numéro de suivi',
      dimL: box.dimL, dimW: box.dimW, dimH: box.dimH, poids: box.poids, volume,
      dimensionsLabel: formatDimensions(box), poidsLabel: formatKg(box.poids), volumeLabel: formatM3(volume),
      receivedAt, receivedLabel: dateLabel(receivedAt) || 'Non renseigné',
      pending: waiting.has(index + 1),
    };
  });
}

function trackingNumbers(dossier) {
  const manifest = receptionCartonManifest(dossier);
  return [...new Set([...manifest.trackingsDetail.map(detail => text(detail.number)), ...manifest.trackings.map(text)].filter(Boolean))];
}

function departureOf(f) {
  const { dossier, client, envois, now } = f;
  const envoiId = dossier.envoi || dossier.envoiId || null;
  const envoi = envoiId ? envois.find(item => item.id === envoiId) || null : null;
  const wish = envoiId ? null : dossierWishState(dossier, client || {}, envois, now);
  const kind = envoiId ? envoi ? 'assigned' : 'unknown' : wish ? 'wish' : 'none';
  const date = kind === 'assigned' ? isoCalendarDay(envoi.date) : kind === 'wish' ? wish.day : null;
  const field = departureFieldText(dossier, envois, { today: now, client: client || {} });
  const planned = kind === 'unknown' ? null : dossierDepartureClosing(dossier, envoi, { client: client || {}, envois, now });
  const closing = planned?.closing || null;
  return {
    key: kind === 'none' ? NO_DEPARTURE_GROUP_KEY : kind === 'wish' ? `wish:${String(dossierDestinationCode(dossier, client || {}) ?? '')}:${wish.day}` : envoiId,
    kind, envoiId, envoi, ref: envoi?.ref || null, date, dateLabel: date ? departureDayLabel(date, { today: now }) : null, wishState: wish?.state || null,
    label: `${field.prefix} : ${field.value}`,
    closing, closingLabel: closing ? `${planned.habitual ? 'clôture habituelle' : 'clôture'} ${closingLabel(closing, { today: now })}` : null,
  };
}

/** `total.state` of a paid dossier (the other states are the quote's own words: « À calculer », « À revoir »,
 * « Brouillon » or ''). */
export const PAID_TOTAL_STATE = 'paid';
/** A paid dossier: the tabs « Prêt à partir » and « Parti » (paid before it leaves), or a payment recorded in full
 * (the payment model: « Payé »). It is never presented as to pay. */
const isPaid = f => f.tab === 'pret' || f.tab === 'parti' || f.model.payment.stateLabel === PAYMENT_STATE_LABELS.paid;
/** What was paid: the amount recorded, otherwise the saved quote's total; null when neither is known. */
const paidAmount = f => f.model.payment.paid > 0 ? f.model.payment.paid : finiteAmount(f.model.quotePrice.amount);

function totalOf(f) {
  // « Payé » carries no amount: it is said even without the right to see amounts, the amount only with it.
  if (isPaid(f)) return { visible: f.finances, amount: f.finances ? paidAmount(f) : null, state: PAID_TOTAL_STATE, label: PAYMENT_STATE_LABELS.paid };
  if (!f.finances) return { visible: false, amount: null, state: null, label: null };
  const price = f.model.quotePrice;
  const state = price.stateLabel || '';
  if (finiteAmount(price.amount) === null) return { visible: true, amount: null, state: state || PAYMENT_DETAIL_LABELS.toCalculate, label: state || PAYMENT_DETAIL_LABELS.toCalculate };
  return { visible: true, amount: price.amount, state, label: state ? `${eur(price.amount)} · ${state}` : eur(price.amount) };
}

function rowOf(f) {
  const { dossier, client, now, model } = f;
  const stageNow = stageOf(f);
  const cartons = receivedCartons(dossier, now, f.pending);
  const measures = measuredTotals(cartons);
  const known = clientDisplayName(client) || text(client?.raisonSociale) || null;
  const code = dossierDestinationCode(dossier, client || {});
  const lastReceivedAt = model.reception.lastReceivedAt;
  const trackings = trackingNumbers(dossier);
  const casier = text(dossier.casier) || null;
  return {
    id: dossier.id, ref: dossier.ref || null, statut: dossier.statut, tab: f.tab,
    clientId: dossier.clientId || null, clientName: known || UNKNOWN_CLIENT, clientKnown: Boolean(known),
    clientType: client?.type || null, clientTypeLabel: clientTypeLabel(client),
    destinationCode: code || null, destinationLabel: DESTINATIONS[code]?.label || 'Destination à préciser',
    commune: text(client?.commune) || text(client?.ville) || null,
    cartons: cartons.length, cartonsLabel: countLabel(cartons.length, 'carton', 'cartons'), pendingCartons: f.pending?.cartonCount || 0,
    casier, casierLabel: casier ? `Casier ${casier}` : 'Casier à renseigner',
    poids: measures.poids, poidsLabel: measures.poidsLabel, volume: measures.volume, volumeLabel: measures.volumeLabel,
    lastReceivedAt, lastReceivedLabel: dateLabel(lastReceivedAt) || 'Non renseigné',
    stage: stageNow, action: stageNow.action,
    total: totalOf(f),
    departure: departureOf(f),
    ficheHref: dossier.id ? `/brouillon/${encodeURIComponent(dossier.id)}` : null,
    searchText: [clientSearchText(client), known, dossier.ref, casier, ...trackings, ...trackings.map(compactCode).filter(code => !trackings.includes(code))].filter(Boolean).join(' '),
  };
}

/**
 * One row of « Colis »: `id, ref, statut, tab, clientId, clientName, clientKnown, clientType, clientTypeLabel,
 * destinationCode, destinationLabel, commune, cartons, cartonsLabel, pendingCartons, casier, casierLabel, poids,
 * poidsLabel, volume, volumeLabel, lastReceivedAt, lastReceivedLabel, stage, action, total, departure, ficheHref,
 * searchText`. `poids`/`volume`: the received cartons, null unless every carton is measured. `total` =
 * `{ visible, amount, state, label }`: the saved and current quote (quotePrice), « À calculer » or its state
 * without one, never a false zero; nothing when canSeeDossierFinances is false. A paid dossier (« Prêt à partir »,
 * « Parti », or a payment recorded in full): `state` PAID_TOTAL_STATE (« paid »), `label` « Payé », `amount` the
 * amount paid or else the quote's total (null and `visible` false without the right to see amounts). `departure` =
 * `{ key, kind, envoiId, ref, date, dateLabel, wishState, label, closing, closingLabel }`.
 */
export function colisRow(dossier, ctx = {}) {
  return rowOf(factsOf(dossier || {}, ctx || {}));
}

/** The rows matching a search: name, client details, dossier reference, casier and tracking numbers (with or
 * without their spaces), every word of the query; a scanned parcel label (« EXP-2YE537-1-2 ») finds its dossier. */
export function filterColisRows(rows = [], q = '') {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const query = String(q ?? '').trim();
  if (!query) return list;
  const code = parseParcelCode(query);
  const ref = code.ok ? code.ref.toUpperCase() : null;
  const compact = compactCode(query);
  return list.filter(row => (ref && String(row.ref || '').toUpperCase() === ref)
    || fuzzy(row.searchText, query) || (compact !== query && compact.length >= 4 && fuzzy(row.searchText, compact)));
}

const byName = (left, right) => Number(!left.row.clientKnown) - Number(!right.row.clientKnown)
  || naturalOrder.compare(left.row.clientName || '', right.row.clientName || '')
  || naturalOrder.compare(left.row.ref || '', right.row.ref || '') || left.index - right.index;
/** Unknown values (null) after the known ones, whatever the direction of `compare`; 0 between two unknown. */
const nullsLast = (a, b, compare) => a === null || b === null ? Number(a === null) - Number(b === null) : compare(a, b);
const descending = (a, b) => b - a;

/**
 * The rows in the order of a sort (COLIS_SORTS), a new list: `nom` alphabetical (unknown client last); `depart`
 * the order of groupColisRowsByDeparture, by name inside a departure; `reception` the latest carton received
 * first; `montant` the highest price first. Rows without a date or a price come last; equal rows by name.
 */
export function sortColisRows(rows = [], key = COLIS_DEFAULT_SORT, { now = Date.now() } = {}) {
  const indexed = (Array.isArray(rows) ? rows : []).filter(Boolean).map((row, index) => ({ row, index }));
  const named = [...indexed].sort(byName);
  if (key === 'depart') return groupColisRowsByDeparture(named.map(item => item.row), { now }).reduce((list, group) => list.concat(group.rows), []);
  const valueOf = key === 'reception' ? row => instantOf(row.lastReceivedAt)
    : key === 'montant' ? row => row.total?.visible ? finiteAmount(row.total.amount) : null : null;
  if (!valueOf) return named.map(item => item.row);
  return named.map((item, order) => ({ row: item.row, order, value: valueOf(item.row) }))
    .sort((a, b) => nullsLast(a.value, b.value, descending) || a.order - b.order).map(item => item.row);
}

/**
 * The totals of rows (the stock shown, or a departure group): `{ clients, dossiers, cartons, poids,
 * poidsManquants, volume, volumeManquants, montantVisible, montantConnu, prixConnus, labels }`. Weights and
 * volumes add the measured rows (`…Manquants`: rows left out); null when none is measured. `montantConnu` adds
 * the known prices of `prixConnus` rows; null without any, and hidden (`montantVisible` false) without the right
 * to see amounts. `labels`: « 3 clients », « 12 cartons », « 45,2 kg », « 0,512 m³ », « 1 250,00 € »,
 * « 2 prix connus sur 4 ».
 */
export function colisTotals(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const clients = new Set(list.map(row => row.clientId ? `client:${row.clientId}` : `row:${row.id}`)).size;
  let cartons = 0, weightCents = 0, weighed = 0, volume = 0, measured = 0, amountCents = 0, priced = 0;
  for (const row of list) {
    cartons += Number(row.cartons) || 0;
    if (positive(row.poids) !== null) { weightCents += Math.round(row.poids * 100); weighed += 1; }
    if (positive(row.volume) !== null) { volume += row.volume; measured += 1; }
    if (row.total?.visible && finiteAmount(row.total.amount) !== null) { amountCents += Math.round(row.total.amount * 100); priced += 1; }
  }
  const montantVisible = list.length > 0 && list.every(row => row.total?.visible === true);
  const poids = weighed ? weightCents / 100 : null;
  const total = { clients, dossiers: list.length, cartons, poids, poidsManquants: list.length - weighed, volume: measured ? volume : null, volumeManquants: list.length - measured,
    montantVisible, montantConnu: montantVisible && priced ? amountCents / 100 : null, prixConnus: montantVisible ? priced : null };
  total.labels = {
    clients: countLabel(clients, 'client', 'clients'), dossiers: countLabel(list.length, 'dossier', 'dossiers'), cartons: countLabel(cartons, 'carton', 'cartons'),
    poids: formatKg(total.poids), volume: formatM3(total.volume),
    montant: montantVisible ? total.montantConnu !== null ? eur(total.montantConnu) : PAYMENT_DETAIL_LABELS.toCalculate : null,
    prixConnus: montantVisible ? `${countLabel(priced, 'prix connu', 'prix connus')} sur ${list.length}` : null,
  };
  return total;
}

/**
 * « Par date d’envoi »: one group per departure (groupDossiersByDeparture: the coming departures soonest first,
 * then those whose date has passed, then the undated ones; a desired day without a departure forms « Départ à
 * créer du … » at its date), then « Départ à choisir ». Each group: `{ key, label, date, dateLabel,
 * destinationLabel, ref, closingLabel, rows, totals }` (colisTotals), its rows in the incoming order.
 */
export function groupColisRowsByDeparture(rows = [], { now = Date.now() } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const envois = new Map();
  for (const row of list) if (row.departure?.envoi?.id) envois.set(row.departure.envoi.id, row.departure.envoi);
  const items = list.map(row => ({ envoi: row.departure?.envoiId || null, departSouhaite: row.departure?.kind === 'wish' ? row.departure.date : null, row }));
  return groupDossiersByDeparture(items, [...envois.values()], {
    today: now, noDeparture: 'bottom',
    destinationOf: item => item.row.destinationCode, wishStateOf: item => item.row.departure?.wishState || 'to_create',
  }).map(group => {
    const members = group.dossiers.map(item => item.row);
    const none = group.key === NO_DEPARTURE_GROUP_KEY;
    const date = none ? null : members[0]?.departure?.date || null;
    return { key: group.key, label: none ? 'Départ à choisir' : group.label, date, dateLabel: date ? departureDayLabel(date, { today: now }) : null,
      destinationLabel: group.destinationLabel || null, ref: group.ref || null, closingLabel: none ? null : members[0]?.departure?.closingLabel || null,
      rows: members, totals: colisTotals(members) };
  });
}

/** The address of a row's action when it opens a page: « Valider la réception » its reception; « Lire la
 * réponse » and « Vérifier l’envoi » the dossier's conversation, a task its dossier task, both with `returnTo` (a way
 * back workspaceReturnPath accepts, otherwise « / »). Null for an action opened in place (`panel`) and for « Rien à
 * faire ». */
export function colisActionHref(row, returnTo = '/') {
  const next = row?.action;
  if (!next || !row?.id) return null;
  if (next.key === 'valider_reception') return next.href || receptionValidationHref(row.clientId);
  if (next.panel) return null;
  const back = workspaceReturnPath(`?${new URLSearchParams({ returnTo: String(returnTo ?? '') })}`, '/');
  if (next.href) {
    const [path, query = ''] = String(next.href).split('?');
    if (!path.startsWith('/colis/')) return next.href;
    const params = new URLSearchParams(query);
    params.set('returnTo', back);
    return `${path}?${params}`;
  }
  if (!next.task) return null;
  return dossierTaskUrl(row.id, next.task, `?${new URLSearchParams({ returnTo: back })}`, { hash: 'dossier-work' });
}

// ── Arrival notices ──────────────────────────────────────────────────────────
export const ARRIVAL_NOTICE_STATES = Object.freeze({
  sans_avis: 'Sans avis', en_cours: 'En cours d’envoi', a_verifier: 'Envoi à vérifier', envoye: 'Envoyé', remis: 'Remis', a_envoyer: 'À envoyer',
  non_remis: 'Non remis', annule: 'Annulé',
});
const CANALS = Object.freeze({ telegram: 'Telegram', email: 'E-mail' });

/** Why a notice still on its way is to check, by the state of its delivery (outbox): the words of a request of
 * consent in the same situation (STUCK_SEND), with what to do. */
function sendToCheck(status, canal, lastError) {
  if (status === 'sending') return `${STUCK_SEND.sending} ${canal === 'email' ? 'du fournisseur d’e-mail.' : 'de Telegram : vérifiez dans Telegram si le message est arrivé.'}`;
  if (status === 'pending') return `${STUCK_SEND.pending} : l’envoi automatique ne l’a pas pris en charge.`;
  if (status === 'blocked') return `${STUCK_SEND.blocked}${lastError ? ` : ${lastError}` : ''}.`;
  return `${STUCK_SEND.unknown} : vérifiez si le message est arrivé.`;
}

/** A notice of list_arrival_notices, or the result of validate_reception ({ validation, message, outbox }). */
function noticeOf(notice) {
  if (!notice || typeof notice !== 'object') return null;
  return notice.validation && typeof notice.validation === 'object' ? { ...notice.validation, message: notice.message ?? null, outbox: notice.outbox ?? null } : notice;
}

/**
 * The state of an arrival notice: `{ key, label, tone, detail, reason, action, canal, canalLabel }`, `key` one of
 * ARRIVAL_NOTICE_STATES: sans_avis (validated without notice), remis (the message is « distribue » or « lu »),
 * non_remis (outbox « failed » or message « echec », with its `reason`; « Réessayer » for Telegram, « Corriger
 * l’adresse » for an e-mail), annule (outbox « cancelled »), envoye (Telegram confirmed: outbox « sent » or
 * message « envoye »), a_envoyer (an e-mail kept « manual » until the provider is connected: « Copier le
 * texte »), en_cours (still to deliver: outbox « pending », « sending » or « blocked »), a_verifier once it has
 * been so for more than NOTICE_SEND_CHECK_MINUTES since its message (else the validation) was recorded, at `now`:
 * « Réessayer » for a Telegram notice never taken (pending, blocked), nothing for a send started without
 * confirmation (sending: the server only sends again a failed one). An uncertain send is never retried by itself.
 * Null without a notice.
 */
export function arrivalNoticeState(notice, { now = Date.now() } = {}) {
  const item = noticeOf(notice);
  if (!item) return null;
  const canal = item.canal || item.message?.canal || null;
  const base = { canal, canalLabel: CANALS[canal] || null, reason: null, action: null };
  const make = (key, tone, detail, extra = {}) => ({ key, label: ARRIVAL_NOTICE_STATES[key], tone, detail, ...base, ...extra });
  if (item.notify === false) return make('sans_avis', 'neutral', 'Réception validée sans prévenir le client');
  const outbox = item.outbox || null, status = outbox?.status || null, message = item.message?.statut || null;
  if (['distribue', 'lu'].includes(message)) return make('remis', 'done', canal === 'email' ? 'Livraison confirmée par le fournisseur d’e-mail' : 'Message remis au client');
  if (status === 'failed' || message === 'echec') {
    const reason = text(outbox?.lastError ?? outbox?.last_error) || 'Raison non précisée';
    return make('non_remis', 'review', reason, { reason, action: canal === 'email' ? { key: 'corriger_adresse', label: 'Corriger l’adresse' } : { key: 'reessayer', label: 'Réessayer' } });
  }
  if (status === 'cancelled') return make('annule', 'neutral', 'Envoi annulé');
  if (status === 'sent' || message === 'envoye') {
    const day = dateLabel(outbox?.sentAt ?? outbox?.sent_at);
    return make('envoye', 'done', canal === 'telegram' ? `Telegram a confirmé l’envoi${day ? ` le ${day}` : ''}` : `Envoyé${day ? ` le ${day}` : ''}`);
  }
  if (status === 'manual' || canal === 'email' && !ON_ITS_WAY.has(status)) return make('a_envoyer', 'current', 'E-mail à envoyer depuis votre messagerie : copiez le texte', { action: { key: 'copier_texte', label: 'Copier le texte' } });
  // Still on its way: for a few minutes at most. Without a readable date, it stays « En cours d’envoi ».
  const since = instantOf(item.message?.createdAt ?? item.message?.created_at) ?? instantOf(item.createdAt);
  const at = instantOf(now) ?? Date.now();
  if (since !== null && at - since > SEND_CHECK_MS) {
    const lastError = text(outbox?.lastError ?? outbox?.last_error) || null;
    // A Telegram notice never taken can be sent from the screen (send-telegram takes a pending or blocked one).
    const retry = canal === 'telegram' && (status === 'pending' || status === 'blocked');
    return make('a_verifier', 'review', sendToCheck(status, canal, lastError), { reason: lastError, action: retry ? { key: 'reessayer', label: 'Réessayer' } : null });
  }
  return make('en_cours', 'waiting', canal === 'telegram' ? 'Envoi Telegram en cours' : 'Envoi en cours');
}

/** « Carton 3 », « Cartons 3 et 4 », « Cartons 3 à 5 ». */
function cartonRangeLabel(first, last) {
  const from = wholeNumber(first), to = wholeNumber(last);
  if (from === null) return null;
  if (to === null || to === from) return `Carton ${from}`;
  return `Cartons ${from} ${to === from + 1 ? 'et' : 'à'} ${to}`;
}

/** One arrival notice ready to show: `{ id, createdAt, dateLabel, clientName, actorName, canal, canalLabel,
 * cartonCount, cartonsLabel, refs, dossierCartonsLabel, state, text }` (`dossierCartonsLabel`: the cartons of
 * `colisId` it announced; `text`: the message, to copy for an e-mail; `state` read at `now`). Null without a notice. */
export function arrivalNoticeSummary(notice, { colisId = null, now = Date.now() } = {}) {
  const item = noticeOf(notice);
  if (!item) return null;
  const items = Array.isArray(item.items) ? item.items.filter(Boolean) : [];
  const cartonCount = Array.isArray(item.cartons) ? item.cartons.length
    : items.reduce((sum, entry) => sum + Math.max(0, (wholeNumber(entry.lastCarton) || 0) - (wholeNumber(entry.firstCarton) || 1) + 1), 0);
  const own = colisId ? items.find(entry => entry.colisId === colisId) : null;
  const state = arrivalNoticeState(item, { now });
  return {
    id: item.id || null, createdAt: item.createdAt || null, dateLabel: dateLabel(item.createdAt) || 'Non renseigné',
    clientName: [text(item.client?.nom), text(item.client?.prenom)].filter(Boolean).join(' ') || null, actorName: text(item.actor?.nom) || null,
    canal: state.canal, canalLabel: state.canalLabel, cartonCount, cartonsLabel: countLabel(cartonCount, 'carton', 'cartons'),
    refs: items.map(entry => entry.ref).filter(Boolean), dossierCartonsLabel: own ? cartonRangeLabel(own.firstCarton, own.lastCarton) : null,
    state, text: item.message?.texte || null,
  };
}

/**
 * The alerts at the top of « Colis », only when something is to do: `reception_a_valider` (cartons recorded and
 * not validated: « Valider et prévenir » for one client, « Voir les réceptions » for several) and
 * `avis_non_remis` (notices not delivered, `failed`, and sends to check, `toCheck`, at `now`; an e-mail « À
 * envoyer » is no alert). Each `{ key, tone, count, text, action: { label, href } }`.
 */
export function brouillonAlerts({ pending, notices, now = Date.now() } = {}) {
  const alerts = [];
  const clients = pendingByClient(pending);
  const cartons = clients.reduce((sum, group) => sum + group.cartonCount, 0);
  if (cartons > 0) alerts.push({
    key: 'reception_a_valider', tone: 'review', count: cartons, clients: clients.length,
    text: `Réception à valider : ${countLabel(cartons, 'carton', 'cartons')}${clients.length > 1 ? ` de ${countLabel(clients.length, 'client', 'clients')}` : ''}`,
    action: clients.length === 1 ? { label: 'Valider et prévenir', href: clients[0].href } : { label: 'Voir les réceptions', href: '/avis' },
  });
  const states = (Array.isArray(notices) ? notices : []).map(notice => arrivalNoticeState(notice, { now })?.key);
  const failed = states.filter(key => key === 'non_remis').length;
  const toCheck = states.filter(key => key === 'a_verifier').length;
  // « 2 avis d’arrivée non remis », « 1 avis d’arrivée à vérifier », « 2 avis d’arrivée non remis, 1 à vérifier ».
  const text = failed && toCheck ? `${countLabel(failed, 'avis d’arrivée non remis', 'avis d’arrivée non remis')}, ${toCheck} à vérifier`
    : failed ? countLabel(failed, 'avis d’arrivée non remis', 'avis d’arrivée non remis') : countLabel(toCheck, 'avis d’arrivée à vérifier', 'avis d’arrivée à vérifier');
  if (failed + toCheck > 0) alerts.push({
    key: 'avis_non_remis', tone: 'review', count: failed + toCheck, failed, toCheck, text,
    action: { label: 'Voir les avis', href: '/avis' },
  });
  return alerts;
}

/**
 * The dossiers of a validation in the order the server takes them: the notice is filed on the first one, and an
 * invoice the client sends in reply is recorded on it. So the dossiers that still request their purchase invoice
 * come first (invoiceRequestState(colis).requested, the rule of arrivalTemplate), then the others, each in its
 * incoming order. `dossierById`: a Map, an object by id, a function or the list of dossiers; a dossier it does not
 * know goes with the others. Returns a new list of the same items.
 */
export function orderValidationItems(items = [], dossierById) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const byId = Array.isArray(dossierById) ? new Map(dossierById.filter(Boolean).map(dossier => [dossier.id, dossier])) : dossierById;
  const lookup = typeof byId === 'function' ? byId : byId instanceof Map ? id => byId.get(id) : id => byId?.[id];
  const asks = list.map(item => {
    const dossier = item.colisId ? lookup(item.colisId) : null;
    return Boolean(dossier) && invoiceRequestState(dossier).requested;
  });
  return [...list.filter((_, index) => asks[index]), ...list.filter((_, index) => !asks[index])];
}

// ── Reception target ─────────────────────────────────────────────────────────
const newestFirst = (left, right) => {
  const a = instantOf(left.createdAt) ?? instantOf(left.dateReception), b = instantOf(right.createdAt) ?? instantOf(right.dateReception);
  return nullsLast(a, b, descending) || naturalOrder.compare(String(right.ref || ''), String(left.ref || ''));
};

/**
 * Where a carton of this client goes: `{ mode: 'append', dossier, label: 'Le carton rejoint son brouillon',
 * detail, impact }` — the most recently created dossier still before its quote (Brouillon tab, a status that can
 * receive a carton, receptionAppendBlockReason empty) — or `{ mode: 'new', dossier: null, label: 'Nouveau
 * brouillon', detail, blockedReason }`: no open dossier, a quote already sent, or an open dossier that cannot
 * take a carton (`blockedReason`). `impact`: what the addition changes (receptionAppendImpact).
 */
export function receptionTarget(clientId, dossiers = []) {
  const own = clientId ? (Array.isArray(dossiers) ? dossiers : []).filter(dossier => dossier && dossier.clientId === clientId) : [];
  const open = own.filter(dossier => colisTab(dossier) === 'brouillon' && RECEPTION_APPEND_STATUSES.includes(dossier.statut));
  const ready = open.filter(dossier => !receptionAppendBlockReason(dossier)).sort(newestFirst);
  if (ready.length) {
    const dossier = ready[0];
    return { mode: 'append', dossier, label: 'Le carton rejoint son brouillon',
      detail: [dossier.ref, text(dossier.casier) ? `casier ${text(dossier.casier)}` : 'casier à renseigner'].filter(Boolean).join(' · '),
      impact: receptionAppendImpact(dossier) || null };
  }
  const blockedReason = open.map(receptionAppendBlockReason).find(Boolean) || null;
  const quoted = own.some(dossier => colisTab(dossier) === 'a_payer');
  return { mode: 'new', dossier: null, label: 'Nouveau brouillon',
    detail: blockedReason ? 'Le brouillon en cours ne peut pas recevoir de carton' : quoted ? 'Devis déjà envoyé' : 'Aucun dossier ouvert',
    blockedReason };
}

// ── Brouillon sheet ──────────────────────────────────────────────────────────
// The team's name of the estimated import taxes (decision of 10 October 2026), the one of the dossier table.
const TAXES_LABEL = TABLE_COLUMNS.daily.find(column => column.key === 'taxes').label;

/** What the quote still needs, in the order of the journey (the rules of the steps). */
function quoteMissing(f) {
  const { dossier } = f;
  const missing = [];
  if (dossier.statut === 'receptionne' || !hasCompleteReceptionMeasurements(dossier)) missing.push('Mesures des cartons reçus');
  if (['receptionne', 'mesure', 'attente_feu_vert', 'refuse_client'].includes(dossier.statut) || dossier.feuVert !== undefined && dossier.feuVert !== 'autorise') missing.push('Accord du client');
  if (dossier.produitInterdit) missing.push('Produit interdit à régler');
  if (!hasCurrentPreparation(dossier)) missing.push('Mesures après optimisation');
  if (invoicesBlockQuote(dossier, f.client)) missing.push('Factures d’achat vérifiées');
  return missing;
}

/** Everything the quote still needs: the steps of the journey (quoteMissing), then what the complete calculation
 * misses (quoteGaps), without repeats. Nothing once the price is known or the dossier paid. */
function ficheMissing(f) {
  if (isPaid(f) || finiteAmount(f.model.quotePrice.amount) !== null) return [];
  return [...new Set([...quoteMissing(f), ...(quoteGaps(f) || [])])];
}

/** « Prix à payer », only from the saved quote (devisSnapshot) whose price the list shows; « Payé » once paid. */
function fichePrice(f, missing) {
  const paid = isPaid(f);
  if (!f.finances) return paid ? { visible: false, state: PAID_TOTAL_STATE, label: PAYMENT_STATE_LABELS.paid } : { visible: false };
  const { dossier, model } = f;
  const price = model.quotePrice;
  const amount = paid ? paidAmount(f) : finiteAmount(price.amount);
  const state = paid ? PAID_TOTAL_STATE : price.stateLabel || '';
  if (amount === null) {
    if (paid) return { visible: true, known: false, state, label: PAYMENT_STATE_LABELS.paid, missing: [], message: 'Le montant réglé est à consulter dans le dossier.' };
    const label = state || PAYMENT_DETAIL_LABELS.toCalculate;
    return { visible: true, known: false, state: label, label, missing,
      message: label === PAYMENT_DETAIL_LABELS.toCalculate ? missing.length ? null : 'Tout est prêt pour calculer le devis.' : 'Le devis enregistré est à revoir dans le dossier.' };
  }
  const total = { label: paid ? PAYMENT_STATE_LABELS.paid : 'Total', amount, text: eur(amount) };
  const known = { visible: true, known: true, state, label: paid ? PAYMENT_STATE_LABELS.paid : state ? `${eur(amount)} · ${state}` : eur(amount), total };
  // Transport and taxes are read from the very saved quote whose total is this price (quoteTransport, quoteTaxes),
  // and only when that total is the amount shown (a payment recorded at another amount keeps its detail in the dossier).
  const sameTotal = finiteAmount(price.amount) !== null && Math.round(price.amount * 100) === Math.round(amount * 100);
  const breakdown = sameTotal && finiteAmount(model.quoteTransport.amount) !== null && finiteAmount(model.quoteTaxes.amount) !== null ? savedQuoteBreakdown(dossier.devisSnapshot) : null;
  if (!breakdown) return { ...known, detailed: false, transport: null, taxes: null, fees: null, savings: null, message: 'Le détail de ce devis est à consulter dans le dossier.' };
  const billable = finiteAmount(breakdown.weights.billableWeight);
  const destination = dossier.devisSnapshot?.inputs?.destination || { code: dossierDestinationCode(dossier, f.client || {}) };
  const estimate = importTaxEstimate({ om: breakdown.taxes.om, omr: breakdown.taxes.omr, tva: breakdown.taxes.tva }, destination, { professional: breakdown.professional });
  const taxes = estimate
    ? { label: TAXES_LABEL, amount: model.quoteTaxes.amount, text: eur(model.quoteTaxes.amount), professional: false, heading: estimate.heading, note: estimate.note,
      lines: estimate.lines.map(line => ({ key: line.key, label: line.label, amount: line.amount, text: eur(line.amount) })) }
    : { label: TAXES_LABEL, amount: 0, text: TAXES_PRO_LABEL, professional: true, heading: null, note: null, lines: [] };
  return {
    ...known, detailed: true,
    transport: { label: 'Transport', amount: model.quoteTransport.amount, text: eur(model.quoteTransport.amount), billableWeight: billable, billableWeightLabel: billable !== null ? `Poids facturé : ${kg(billable)}` : null },
    taxes,
    // No « 0,00 € » line for a quote without fees or without saving.
    fees: breakdown.feesTotal > 0 ? { label: 'Frais convenus', amount: breakdown.feesTotal, text: eur(breakdown.feesTotal),
      lines: breakdown.fees.map(fee => ({ label: fee.libelle || 'Frais', amount: fee.montant, text: eur(fee.montant) })) } : null,
    savings: breakdown.savings > 0 ? { label: 'Économie réalisée grâce à l’optimisation', amount: breakdown.savings, text: eur(breakdown.savings) } : null,
    message: null,
  };
}

/** « Après optimisation »: the parcels to ship once the preparation is current (hasCurrentPreparation), and the
 * volume gained against the received cartons. */
function ficheOptimized(dossier, receivedVolume) {
  if (!hasCurrentPreparation(dossier)) {
    const outdated = dossier.preparationCompositionVersion != null && dossier.finalMeasurementsVersion != null && dossier.finalMeasurementsVersion !== dossier.preparationCompositionVersion;
    return { done: false, summary: outdated ? 'Mesures après optimisation à confirmer pour les cartons actuels' : 'Préparation à faire',
      count: 0, packages: [], poids: null, volume: null, poidsLabel: MEASURE_MISSING_LABEL, volumeLabel: MEASURE_MISSING_LABEL, volumeGain: null };
  }
  // The same parcels as the dossier table: the saved packages, or the single legacy final box.
  const boxes = dossier.finalPackages ?? [{ dimL: dossier.finL, dimW: dossier.finW, dimH: dossier.finH, poids: dossier.finP }];
  const packages = boxes.map((box, index) => {
    const volume = cartonVolumeM3(box);
    return { number: index + 1, dimL: positive(box.dimL), dimW: positive(box.dimW), dimH: positive(box.dimH), poids: positive(box.poids), volume,
      dimensionsLabel: formatDimensions(box), poidsLabel: formatKg(box.poids), volumeLabel: formatM3(volume) };
  });
  const totals = measuredTotals(packages);
  let volumeGain = null;
  if (positive(receivedVolume) !== null && positive(totals.volume) !== null) {
    const percent = Math.round((1 - totals.volume / receivedVolume) * 100);
    volumeGain = { percent, label: percent > 0 ? `Gain de volume : ${percent}\u00a0%` : percent < 0 ? `Volume en hausse de ${-percent}\u00a0%` : 'Volume inchangé' };
  }
  return { done: true, summary: countLabel(packages.length, 'colis à expédier', 'colis à expédier'), count: packages.length, packages, ...totals, volumeGain };
}

function latestNotice(notices, colisId) {
  return (Array.isArray(notices) ? notices : []).map(noticeOf).filter(notice => notice && (notice.items || []).some(item => item?.colisId === colisId))
    .reduce((best, notice) => !best || (instantOf(notice.createdAt) ?? -Infinity) > (instantOf(best.createdAt) ?? -Infinity) ? notice : best, null);
}

/**
 * The Brouillon sheet of a dossier: `{ id, ref, header, stage, action, links, received, optimized, price, missing,
 * notice, noticeLabel }`.
 * - `header`: name, type of client, destination, commune, casier, step;
 * - `action`: the row's one action with its `href` (way back: this sheet), or null;
 * - `links`: « Tout le dossier » (/colis/:id?returnTo=/brouillon/:id) and « Ajouter un carton »
 *   (/recevoir?dossier=:id; no `href` when receptionAppendBlockReason refuses it, `blockedReason` says why);
 * - `received`: the cartons (number, vendor, tracking, dimensions, weight, volume, date, `pending` when it waits
 *   for its validation) and their totals;
 * - `optimized`: the parcels after optimisation, their totals and `volumeGain` ({ percent, label });
 * - `price`: `{ visible: false }` without the right to see amounts (`state` « paid » and `label` « Payé » too for a
 *   paid dossier); otherwise, from the saved quote only, `known` with total, transport (billed weight), taxes
 *   (« Taxes à l’importation estimées », their estimate heading, note and detail lines), fees and saving, or
 *   `known: false` with its label and `missing`. Paid: `state` « paid », `label` « Payé », `total` « Payé » with
 *   the amount paid (else the quote's total), never « à payer »;
 * - `missing`: what the quote still needs, for everyone (no amount): the journey's steps, then the gaps of the
 *   complete calculation when `ctx.tarifs` and `ctx.categories` are given; [] once the price is known or paid;
 * - `notice`: the latest arrival notice of the dossier (arrivalNoticeSummary), or null with `noticeLabel`.
 */
export function brouillonFiche(dossier, ctx = {}) {
  const f = factsOf(dossier || {}, ctx || {});
  const row = rowOf(f);
  const source = f.dossier;
  const cartons = receivedCartons(source, f.now, f.pending);
  const receivedTotals = measuredTotals(cartons);
  // The server's count, as the step says it, even before the dossier's own record shows a carton just added.
  const pendingCount = f.pending ? f.pending.cartonCount : 0;
  const id = source.id ? encodeURIComponent(source.id) : null;
  const blockedReason = receptionAppendBlockReason(source) || null;
  const latest = id ? latestNotice(f.notices, source.id) : null;
  const missing = ficheMissing(f);
  return {
    id: source.id || null, ref: source.ref || null,
    header: { ref: row.ref, clientName: row.clientName, clientTypeLabel: row.clientTypeLabel, destinationLabel: row.destinationLabel, commune: row.commune,
      casier: row.casier, casierLabel: row.casierLabel, stage: row.stage },
    stage: row.stage,
    action: row.action ? { ...row.action, href: colisActionHref(row, id ? `/brouillon/${id}` : '/') } : null,
    links: {
      dossier: id ? { label: 'Tout le dossier', href: `/colis/${id}?${new URLSearchParams({ returnTo: `/brouillon/${source.id}` })}` } : null,
      addCarton: { label: 'Ajouter un carton', href: id && !blockedReason ? `/recevoir?${new URLSearchParams({ dossier: source.id })}` : null, blockedReason },
    },
    received: { count: cartons.length, countLabel: countLabel(cartons.length, 'carton', 'cartons'), cartons, ...receivedTotals,
      pendingCount, pendingLabel: pendingCount ? `${countLabel(pendingCount, 'carton', 'cartons')} à valider` : null },
    optimized: ficheOptimized(source, receivedTotals.volume),
    price: fichePrice(f, missing),
    missing,
    notice: latest ? arrivalNoticeSummary(latest, { colisId: source.id, now: f.now }) : null,
    noticeLabel: latest ? null : 'Aucun avis d’arrivée',
  };
}
