import { DESTINATIONS, STATUTS, getSecteurByCP } from '../constants/index.js';
import { DOSSIER_TASKS, dossierNextTask } from './dossierTasks.js';
import { hasCurrentPreparation } from './preparationReadiness.js';
import { departureReadiness } from './departureReadiness.js';
import { actionPriority, actionWaiting, canWorkAction, sortWorkActions } from './personalWork.js';
import { workTitle, workSituation } from './collaborativeWork.js';
import { receptionCartonManifest, receptionDateSummary } from './reception.js';
import { parisCalendarDay } from './departureGroups.js';
import { dossierDepartureWish, wishedDepartureLabel } from './departurePlanning.js';
import { CONSENT_LABELS, consentRelance, consentState, consentSummary } from './consentQueue.js';
import { clientDisplayName } from './clientGroups.js';
import { volumetricDivisor } from './quote.js';
import { parcelVolumetricWeight, savedQuoteDivisor } from './quoteBreakdown.js';
import { kg } from '../utils/format.js';

const SORT_TYPES = new Set(['text', 'number', 'date']);

/** French agreement of a count: 0 and 1 take the singular (« 0 dossier »,
 * « 1 dossier », « 2 dossiers »). Same rules as pluralWord()/plural() in
 * domain/plural.js, which this package's base does not contain yet. */
const COUNT_FORMAT = new Intl.NumberFormat('fr-FR');
export function countWord(count, singular, plural = `${singular}s`) {
  return Math.abs(Number(count) || 0) < 2 ? singular : plural;
}
/** « 3 dossiers », « 1 tâche », « 1 234 dossiers ». */
export function countLabel(count, singular, plural) {
  const value = Number(count) || 0;
  return `${COUNT_FORMAT.format(value)} ${countWord(value, singular, plural)}`;
}
/** « 1 autre tâche en parallèle », « 2 autres tâches en parallèle ». */
export function parallelTasksLabel(count) {
  return `${countLabel(count, 'autre')} ${countWord(count, 'tâche')} en parallèle`;
}
const naturalTextOrder = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/** A data column must declare its real value and its type once. Adding a column
 * then enables headers, keyboard sorting and the mobile sorting menu together.
 * Command columns explicitly opt out: their buttons do not represent data. */
export function defineDossierTableColumn(column) {
  if (!column?.key || !column.label) throw new Error('Une colonne doit avoir une clé et un titre.');
  if (column.kind === 'action') return Object.freeze({ ...column, sort: null });
  if (!SORT_TYPES.has(column.sort?.type) || typeof column.sort?.value !== 'function')
    throw new Error(`La colonne ${column.key} doit définir sort.type et sort.value.`);
  return Object.freeze({ ...column, kind: 'data', sort: Object.freeze({ ...column.sort }) });
}

// « Payet Flavie », as the rows and the client bands show the client.
const clientName = client => clientDisplayName(client);
const refColumn = defineDossierTableColumn({ key: 'ref', label: 'Référence', sort: { type: 'text', value: ({ dossier }) => dossier.ref } });
const clientColumn = defineDossierTableColumn({ key: 'client', label: 'Client', sort: { type: 'text', value: ({ client }) => clientName(client) } });
const actionColumn = defineDossierTableColumn({ key: 'action', label: 'Action', kind: 'action' });
const statusColumn = defineDossierTableColumn({ key: 'statusLabel', label: 'Statut du dossier', shortLabel: 'Statut', sort: { type: 'text', value: ({ model }) => model?.statusLabel } });
const paymentStateColumn = defineDossierTableColumn({ key: 'paymentState', label: 'Paiement', filter: { choices: ['Payé', 'Non payé', 'À vérifier'] }, sort: { type: 'text', value: ({ model }) => model?.payment?.stateLabel } });
// « Contient » searches the text shown, volumetric weights included (« 1,77 kg vol. »).
const dimensionsColumn = defineDossierTableColumn({ key: 'optimizedDimensions', label: 'Dimensions finales', shortLabel: 'Dimensions', filter: { text: ({ model }) => dossierDimensionsLines(model).join(' · ') || null }, sort: { type: 'text', value: ({ model }) => model?.optimizedDimensions?.join(' · ') || null } });
const receptionDateColumn = defineDossierTableColumn({ key: 'receivedAt', label: 'Dernière réception', shortLabel: 'Réception', sort: { type: 'date', value: ({ model }) => model?.reception?.lastReceivedAt } });
const finalWeightColumn = defineDossierTableColumn({ key: 'optimizedWeight', label: 'Poids final (kg)', shortLabel: 'Poids (kg)', align: 'right', sort: { type: 'number', value: ({ model }) => model?.optimizedWeight } });
const financialColumn = (key, label, priceKind = 'payment', shortLabel) => defineDossierTableColumn({ key, label, ...(shortLabel ? { shortLabel } : {}), align: 'right', financial: true, priceKind, sort: { type: 'number', value: ({ model }) => priceKind === 'quote' ? model?.quotePrice?.amount : model?.payment?.[key] } });
const quotePriceColumn = financialColumn('requested', 'Prix du devis', 'quote', 'Prix');
// OM + OMR + TVA of the saved quote whose price the list shows beside them, « Demandé » in « Paiements »
// (quoteTaxesModel): financial like the price.
const taxesColumn = defineDossierTableColumn({ key: 'taxes', label: 'Taxes calculées', shortLabel: 'Taxes', align: 'right', financial: true, sort: { type: 'number', value: ({ model }) => model?.quoteTaxes?.amount } });
const casierColumn = defineDossierTableColumn({ key: 'casier', label: 'Casier', filter: { text: ({ dossier }) => dossier.casier || 'À renseigner' }, sort: { type: 'text', value: ({ dossier }) => dossier.casier } });
const cartonsColumn = defineDossierTableColumn({ key: 'cartons', label: 'Cartons reçus', shortLabel: 'Cartons', sort: { type: 'number', value: ({ dossier }) => receptionCartonManifest(dossier).nbColis } });
// A desired day without a departure (« Souhaité le … · à créer ») sorts on that day.
const departureColumn = defineDossierTableColumn({ key: 'departure', label: 'Départ prévu', shortLabel: 'Départ', sort: { type: 'date', value: ({ dossier, model, envoi }) => /^(Prévu le|Date dépassée)/.test(model?.departure?.label || '') ? envoi?.date : dossierDepartureWish(dossier) } });
// « Accords clients »: the consent still to obtain, the request and its last relance.
const consentStateColumn = defineDossierTableColumn({ key: 'consentState', label: 'Accord', filter: { choices: CONSENT_LABELS }, sort: { type: 'text', value: ({ dossier, model }) => (model?.consent ?? consentState(dossier))?.label } });
const consentRequestColumn = defineDossierTableColumn({ key: 'consentRequestedAt', label: 'Demande envoyée le', shortLabel: 'Demande envoyée', sort: { type: 'date', value: ({ dossier }) => dossier.demandeFeuVertEnvoyeeAt } });
const consentRelanceColumn = defineDossierTableColumn({ key: 'lastRelanceAt', label: 'Dernière relance', sort: { type: 'date', value: ({ dossier, model }) => (model?.relance ?? consentRelance(dossier))?.at } });
export const TABLE_COLUMNS = Object.freeze({
  daily: Object.freeze([refColumn, clientColumn, receptionDateColumn, statusColumn, paymentStateColumn,
    defineDossierTableColumn({ key: 'statut', label: 'Travail à faire', shortLabel: 'Travail', sort: { type: 'text', value: ({ model }) => model?.title === 'Tâches à actualiser' ? null : model?.title } }),
    defineDossierTableColumn({ key: 'owner', label: 'Qui s’en occupe', filter: { text: ({ model }) => model?.ownerName }, sort: { type: 'text', value: ({ model }) => ['—', 'Non attribué', 'Membre de l’équipe'].includes(model?.ownerName) ? null : model?.ownerName } }),
    casierColumn, cartonsColumn, dimensionsColumn, finalWeightColumn, quotePriceColumn, taxesColumn, actionColumn]),
  payments: Object.freeze([refColumn, clientColumn, receptionDateColumn, statusColumn, paymentStateColumn, financialColumn('requested', 'Demandé'), taxesColumn, financialColumn('paid', 'Payé'), financialColumn('remaining', 'Reste à payer', 'payment', 'Reste'),
    defineDossierTableColumn({ key: 'sentAt', label: 'Devis envoyé le', shortLabel: 'Devis envoyé', sort: { type: 'date', value: ({ model }) => model?.payment?.sentAt } }), actionColumn]),
  departures: Object.freeze([refColumn, clientColumn, receptionDateColumn, statusColumn, paymentStateColumn, departureColumn,
    defineDossierTableColumn({ key: 'destination', label: 'Destination', sort: { type: 'text', value: ({ model }) => model?.departure?.destination === 'Destination à préciser' ? null : model?.departure?.destination } }),
    defineDossierTableColumn({ key: 'packages', label: 'Colis à expédier', shortLabel: 'Colis', sort: { type: 'number', value: ({ dossier, model }) => model?.optimized ? dossier.outgoingParcelCount : null } }),
    defineDossierTableColumn({ key: 'readiness', label: 'Prêt à partir ?', sort: { type: 'text', value: ({ model }) => model?.departure?.readinessLabel } }), dimensionsColumn, finalWeightColumn, quotePriceColumn, taxesColumn, actionColumn]),
  // No status or payment column: every dossier here is before its quote.
  accords: Object.freeze([refColumn, clientColumn, receptionDateColumn, consentStateColumn, consentRequestColumn, consentRelanceColumn, cartonsColumn, casierColumn, departureColumn, actionColumn]),
});

export function isDossierTableColumnSortable(column) {
  return column?.kind !== 'action' && SORT_TYPES.has(column?.sort?.type) && typeof column.sort.value === 'function';
}

function normalizedSortValue(value, type) {
  if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
  if (type === 'text') return typeof value === 'string' ? value.trim() : null;
  if (type === 'number') return (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === 'date') {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
    const date = value.slice(0, 10), timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
    return timestamp;
  }
  return null;
}

/** Unknown values stay last in BOTH directions. Equal values retain input
 * order, accessors run once per dossier and no row/model is rewritten. */
export function sortDossierTableRows(dossiers, { column, direction = 'asc', models, getClient = () => undefined, envois = [] } = {}) {
  if (!isDossierTableColumnSortable(column)) return [...dossiers];
  const envoiById = new Map(envois.map(envoi => [envoi.id, envoi]));
  const sign = direction === 'desc' ? -1 : 1;
  return dossiers.map((dossier, index) => ({ dossier, index, value: normalizedSortValue(column.sort.value({
    dossier, model: models?.get?.(dossier.id), client: getClient(dossier.clientId), envoi: envoiById.get(dossier.envoi || dossier.envoiId),
  }), column.sort.type) })).sort((left, right) => {
    if (left.value === null || right.value === null) return left.value !== null ? -1 : right.value !== null ? 1 : left.index - right.index;
    const order = column.sort.type === 'text' ? naturalTextOrder.compare(left.value, right.value) : left.value - right.value;
    return sign * order || left.index - right.index;
  }).map(item => item.dossier);
}

export function dossierTableSortDirectionLabel(column, direction = 'asc') {
  const descending = direction === 'desc';
  return column?.sort?.type === 'date' ? descending ? 'plus récent d’abord' : 'plus ancien d’abord'
    : column?.sort?.type === 'number' ? descending ? 'du plus grand au plus petit' : 'du plus petit au plus grand'
    : descending ? 'de Z à A' : 'de A à Z';
}

const BEFORE_QUOTE = new Set(['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'refuse_client']);
const QUOTED = new Set(['devis_envoye', 'attente_paiement', 'paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre']);
const dateTime = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const money = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value) * 100) / 100 : null;

/** The « Paiement » column only says whether the shipment is paid; « À vérifier »
 * appears when the records disagree. Shared with the colour tones so a wording
 * change cannot silently drop a state back to the neutral colour. */
export const PAYMENT_STATE_LABELS = Object.freeze({ paid: 'Payé', unpaid: 'Non payé', toVerify: 'À vérifier' });

/** The detailed payment situation, kept where it explains something: the dossier
 * page, the remaining amount, and the status of a dossier marked paid too early. */
export const PAYMENT_DETAIL_LABELS = Object.freeze({
  toVerify: 'Paiement à vérifier', toRecalculate: 'À recalculer', quoteToSend: 'Devis à envoyer', toCalculate: 'À calculer',
  overpaid: 'Trop-perçu à vérifier', partial: 'Paiement partiel', paid: 'Payé', noneRequested: 'Aucun règlement demandé', expected: 'Paiement attendu',
});

/** Amounts are recorded facts in euros, never inferred from a status or a link. */
function paymentModel(dossier, now) {
  const total = money(dossier.devisTotal);
  const frozenTotal = money(dossier.devisSnapshot?.amounts?.total);
  const explicitZero = frozenTotal === 0 && Number(dossier.quoteVersion) > 0;
  const candidate = total ?? (explicitZero ? 0 : null);
  const quoted = QUOTED.has(dossier.statut);
  const revised = dossier.devisBrouillon === true || dossier.quoteNeedsReview === true
    || BEFORE_QUOTE.has(dossier.statut) && Boolean(dossier.devisEnvoyeLe);
  const conflictingTotal = frozenTotal !== null && candidate !== null && frozenTotal !== candidate;
  const valid = quoted && !revised && !conflictingTotal && (candidate > 0 || candidate === 0 && explicitZero);
  const requested = valid ? candidate : null;
  const amount = money(dossier.paiementMontant);
  const paymentDate = dateTime(dossier.paiementDate);
  const recorded = paymentDate !== null && paymentDate <= now && amount !== null;
  const uncertainPayment = !recorded && (dossier.paiementMontant != null || dossier.paiementDate || dossier.statut === 'paye');
  const paid = recorded ? amount : uncertainPayment ? null : 0;
  const remaining = requested !== null && paid !== null ? Math.max(0, Math.round((requested - paid) * 100) / 100) : null;
  const sent = dateTime(dossier.devisEnvoyeLe);
  const sentAt = valid && sent !== null && sent <= now ? dossier.devisEnvoyeLe : null;
  const labels = PAYMENT_DETAIL_LABELS;
  let detailLabel;
  if (uncertainPayment || conflictingTotal || recorded && requested === null) detailLabel = labels.toVerify;
  else if (requested === null) detailLabel = revised ? labels.toRecalculate : candidate > 0 ? labels.quoteToSend : labels.toCalculate;
  else if (paid > requested) detailLabel = labels.overpaid;
  else if (paid > 0 && remaining > 0) detailLabel = labels.partial;
  else if (recorded && remaining === 0) detailLabel = labels.paid;
  else if (requested === 0) detailLabel = labels.noneRequested;
  else detailLabel = labels.expected;
  // Until the shipment is fully paid it is « Non payé »; only contradictory records ask for a check.
  const stateLabel = detailLabel === labels.paid ? PAYMENT_STATE_LABELS.paid
    : detailLabel === labels.toVerify || detailLabel === labels.overpaid ? PAYMENT_STATE_LABELS.toVerify : PAYMENT_STATE_LABELS.unpaid;
  return { requested, paid, remaining, sentAt, stateLabel, detailLabel };
}

/** A recorded quote is not necessarily an amount already asked from the client.
 * Keep this display fact separate from payment.requested and outstanding money. */
function quotePriceModel(dossier, payment, optimized) {
  const total = money(dossier.devisTotal);
  const frozen = money(dossier.devisSnapshot?.amounts?.total);
  const zeroProven = frozen === 0 && Number(dossier.quoteVersion) > 0;
  const versionMismatch = dossier.devisSnapshot?.version != null && Number(dossier.devisSnapshot.version) !== Number(dossier.quoteVersion);
  const conflict = total !== null && frozen !== null && total !== frozen;
  // A recorded capture retains its frozen quote even if a legacy raw field or
  // draft flag disagrees. The disagreement remains explicit for verification.
  if (payment.paid > 0 && frozen !== null && !versionMismatch && (frozen > 0 || zeroProven)) {
    return { amount: frozen, stateLabel: conflict || dossier.devisBrouillon || dossier.quoteNeedsReview ? 'À revoir' : '' };
  }
  if (versionMismatch || conflict || dossier.quoteNeedsReview === true) return { amount: null, stateLabel: 'À revoir' };
  const currentStage = dossier.statut === 'en_preparation' || dossier.statut === 'autorise' && optimized || QUOTED.has(dossier.statut);
  if (!currentStage) return { amount: null, stateLabel: total > 0 || frozen > 0 || dossier.devisEnvoyeLe ? 'À revoir' : 'À calculer' };
  const candidate = total ?? frozen;
  if (!(candidate > 0 || candidate === 0 && zeroProven)) return { amount: null, stateLabel: 'À calculer' };
  return { amount: candidate, stateLabel: dossier.devisBrouillon || ['autorise', 'en_preparation'].includes(dossier.statut) ? 'Brouillon' : '' };
}

/** « Taxes calculées » of a professional quote without any tax. */
export const TAXES_PRO_LABEL = 'Sans taxes (pro)';
/** A price whose saved quote cannot say its taxes (a former dossier, missing or invalid amounts, another total or version). */
export const TAXES_UNVERIFIED_LABEL = 'À vérifier';
const moneyCents = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value) * 100) : null;

/** « Taxes calculées »: OM + OMR + TVA of the very saved quote whose price the
 * list shows beside them (devisSnapshot.amounts), added in cents. Nothing is
 * recalculated here nor taken from the raw columns: without a price, the price's
 * own state (« À calculer », « À revoir »…) is repeated; a price with a state
 * (« Brouillon », « À revoir ») gives its taxes the same state; a price without a
 * usable saved quote behind it reads « À vérifier ». `pro`: a professional quote
 * without tax. `quotePrice`: « Prix du devis », or in « Paiements » « Demandé »
 * (requestedPriceModel). */
function quoteTaxesModel(dossier, quotePrice) {
  if (quotePrice.amount === null) return { amount: null, stateLabel: quotePrice.stateLabel || 'À calculer', pro: false };
  const snapshot = dossier.devisSnapshot;
  const parts = ['om', 'omr', 'tva'].map(key => moneyCents(snapshot?.amounts?.[key]));
  const sameQuote = moneyCents(snapshot?.amounts?.total) === Math.round(quotePrice.amount * 100)
    && (snapshot?.version == null || Number(snapshot.version) === Number(dossier.quoteVersion));
  if (!sameQuote || parts.includes(null)) return { amount: null, stateLabel: TAXES_UNVERIFIED_LABEL, pro: false };
  const cents = parts.reduce((sum, part) => sum + part, 0);
  return { amount: cents / 100, stateLabel: quotePrice.stateLabel || '', pro: cents === 0 && snapshot?.inputs?.client?.type === 'pro' };
}
/** « Paiements » puts the taxes beside « Demandé », the amount asked from the
 * client: there they are that amount's taxes. A draft or a quote to verify asks
 * nothing yet, so its taxes say what « Demandé » says (« À calculer »,
 * « À vérifier ») and the two totals add up the same dossiers. */
function requestedPriceModel(payment) {
  return { amount: payment.requested, stateLabel: payment.requested === null ? dossierTableMissingAmountLabel(payment, 'requested') : '' };
}

export function dossierTableAmount(model, column) {
  return column?.priceKind === 'quote' ? model?.quotePrice?.amount ?? null : model?.payment?.[column?.key] ?? null;
}

export function dossierTableAmountState(model, column) {
  return column?.priceKind === 'quote' ? model?.quotePrice?.stateLabel || (model?.quotePrice?.amount == null ? 'À calculer' : '') : '';
}

const fullyPaid = payment => payment.requested !== null && payment.paid !== null && payment.paid > 0 && payment.remaining === 0;
const currentTask = (dossier, payment, client) => dossierNextTask({ ...dossier,
  paiementDate: fullyPaid(payment) ? dossier.paiementDate : null,
  ...(payment.requested === 0 ? { quoteNeedsReview: false } : {}),
}, () => true, client);

function departureModel(dossier, envois, optimized, payment, now, client) {
  const envoiId = dossier.envoi || dossier.envoiId;
  const envoi = envois.find(item => item.id === envoiId);
  const code = envoi?.destinationCode || dossier.destinationCode || dossier.devisSnapshot?.inputs?.destination?.code || String(client?.cp || '').replace(/\s/g, '').slice(0, 3);
  const destination = DESTINATIONS[code]?.label || (code ? String(code) : 'Destination à préciser');
  const date = typeof envoi?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(envoi.date)
    && Number.isFinite(Date.parse(`${envoi.date}T00:00:00Z`)) && new Date(`${envoi.date}T00:00:00Z`).toISOString().slice(0, 10) === envoi.date ? envoi.date : null;
  const formattedDate = date ? date.split('-').reverse().join('/') : null;
  const departed = Boolean(dossier.dateExpedition || envoi?.departedAt || envoi?.manifestVersion > 0);
  const cancelled = envoi?.statut === 'annule';
  // Departures are planned on Paris days.
  const past = date && date < parisCalendarDay(now);
  const label = !envoi ? departed ? 'Expédition enregistrée' : envoiId ? 'Départ à vérifier' : wishedDepartureLabel(dossier, { client, envois, now }) || 'À choisir'
    : cancelled ? 'Départ annulé'
    : departed ? 'Départ confirmé'
    : envoi.statut === 'archive' ? 'Départ archivé'
    : !date ? 'Date à préciser' : past ? `Date dépassée · ${formattedDate}` : `Prévu le ${formattedDate}`;
  const readiness = departureReadiness(dossier);
  const task = currentTask(dossier, payment, client);
  const nextPrerequisite = {
    reception: 'Réception à compléter',
    accord: dossier.statut === 'mesure' ? 'Accord client à demander' : dossier.statut === 'refuse_client' ? 'Accord client à revoir' : 'Accord client attendu',
    preparation: 'Optimisation à terminer', documents: 'Factures à vérifier', devis: 'Devis à envoyer',
  }[task];
  let readinessLabel;
  if (dossier.statut === 'annule' || dossier.archive) readinessLabel = dossier.archive ? 'Dossier archivé' : 'Dossier annulé';
  else if (dossier.statut === 'livre') readinessLabel = 'Livré';
  else if (departed) readinessLabel = 'Expédition enregistrée';
  else if (cancelled || envoi?.statut === 'archive' || past) readinessLabel = 'Planning à vérifier';
  else if (nextPrerequisite) readinessLabel = nextPrerequisite;
  else if (payment.requested === 0) readinessLabel = 'Montant nul : départ à vérifier avec un responsable';
  else if (!fullyPaid(payment)) readinessLabel = payment.paid > 0 && payment.remaining > 0 ? 'Paiement à compléter' : 'Paiement à vérifier';
  else if (!optimized) readinessLabel = 'Optimisation à terminer';
  else if (!readiness.eligible) readinessLabel = readiness.reasons[0]?.text || 'Départ à vérifier';
  else readinessLabel = envoi ? 'Prêt pour ce départ' : 'Prêt à affecter';
  return { label, destination, packagesLabel: optimized ? `${dossier.outgoingParcelCount} colis après optimisation` : 'Colis après optimisation à confirmer', readinessLabel };
}

/** A task row the dossier has outgrown (its step moved on): the list offers to
 * refresh the tasks right there (model.refreshable). */
export const STALE_TASK_REASON = 'Le dossier a changé. Actualisez les tâches.';

// The server turns the awaited consent into a relance before the departure
// closing (sync_staff_work_actions): that reception action is work to do.
const CONSENT_RELANCE_HINT = /^(Relancer le client avant la clôture|Demander l['’]accord avant la clôture)/;

/** Keep task ids/versions and attribution. A stale ready row must not enable a
 * command when the dossier already proves its prerequisite is missing. */
function checkedAction(action, dossier, optimized, payment, now) {
  let reason;
  const open = !['annule', 'livre'].includes(dossier.statut);
  const compatible = {
    reception: ['receptionne', 'mesure', 'attente_feu_vert'].includes(dossier.statut),
    preparation: ['autorise', 'en_preparation'].includes(dossier.statut) && !optimized,
    documents: ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation'].includes(dossier.statut),
    quote: ['autorise', 'en_preparation'].includes(dossier.statut),
    departure: dossier.statut === 'paye' && !dossier.dateExpedition,
    conversation: true,
    correction: open,
  }[action.kind];
  if (!compatible) reason = STALE_TASK_REASON;
  else if (action.kind === 'reception' && dossier.statut === 'attente_feu_vert'
    && !(dateTime(dossier.attenteClientUntil) !== null && dateTime(dossier.attenteClientUntil) <= now)
    && !CONSENT_RELANCE_HINT.test(action.action_hint?.trim() || ''))
    reason = dossier.attenteClientDate ? 'Attente demandée par le client' : 'Accord client attendu';
  else if (['preparation', 'quote'].includes(action.kind) && dossier.feuVert !== undefined && dossier.feuVert !== 'autorise') reason = 'Accord client requis';
  else if (['preparation', 'quote'].includes(action.kind) && dossier.produitInterdit) reason = 'Contenu à vérifier';
  else if (action.kind === 'quote' && !optimized) reason = 'Optimisation à terminer';
  else if (action.kind === 'departure' && !fullyPaid(payment)) reason = payment.requested === 0 ? 'Montant nul : départ à vérifier avec un responsable' : payment.paid > 0 && payment.remaining > 0 ? 'Paiement à compléter' : 'Paiement à vérifier';
  else if (action.kind === 'departure' && !optimized) reason = 'Optimisation à terminer';
  return reason && !action.blocked_reason?.trim() ? { ...action, blocked_reason: reason } : action;
}

function ownerName(action, me, teamUsers) {
  if (!action) return '—';
  if (!action.assignee_id) return 'Non attribué';
  if (action.assignee_id === me) return 'Vous';
  const user = teamUsers.find(person => person.authId === action.assignee_id);
  return [user?.prenom, user?.nom].filter(Boolean).join(' ').trim() || 'Membre de l’équipe';
}

// ── Volumetric weight of the outgoing parcels ───────────────────────────────
const measured = value => (value === '' || value == null ? NaN : Number(value));
const sameParcels = (saved, boxes) => saved.length > 0 && saved.length === boxes.length
  && saved.every((box, index) => ['dimL', 'dimW', 'dimH', 'poids'].every(key => {
    const left = measured(box?.[key]), right = measured(boxes[index]?.[key]);
    return Number.isFinite(left) && left === right;
  }));

/** The divisor of the volumetric weights shown for these outgoing parcels: the
 * saved quote's when it priced exactly these parcels (what was billed), otherwise
 * the configured one (volumetricDivisor). Null when it is not a positive number:
 * the list then shows the dimensions alone. */
export function dossierVolumetricDivisor(dossier, boxes, settings) {
  const inputs = dossier?.devisSnapshot?.inputs;
  const quoted = savedQuoteDivisor(dossier?.devisSnapshot);
  if (Array.isArray(inputs?.finalPackages) && Array.isArray(boxes) && Number.isFinite(quoted) && quoted > 0 && sameParcels(inputs.finalPackages, boxes))
    return { value: quoted, source: 'quote' };
  const configured = volumetricDivisor(settings || {});
  return Number.isFinite(configured) && configured > 0 ? { value: configured, source: 'settings' } : null;
}

/** « 1,77 kg vol. » (kg() formatting), or null without a volumetric weight. */
export function volumetricWeightLabel(weight) {
  return typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 ? `${kg(weight)} vol.` : null;
}

/** « Dimensions finales » as the list shows and exports them, one line per
 * outgoing parcel: « 31 × 22 × 13 cm · 1,77 kg vol. ». Several parcels are
 * numbered (« Colis 1 : … ») and end with « Total : 2,5 kg vol. ». Without a
 * valid divisor, the dimensions stand alone; before the optimisation, nothing. */
export function dossierDimensionsLines(model) {
  if (!model?.optimized) return [];
  if (!Array.isArray(model.optimizedParcels)) return [...(model.optimizedDimensions || [])];
  const parcels = model.optimizedParcels;
  const lines = parcels.map(parcel => {
    const volumetric = volumetricWeightLabel(parcel.volumetricWeight);
    return `${parcel.label ? `${parcel.label} : ` : ''}${parcel.dimensions}${volumetric ? ` · ${volumetric}` : ''}`;
  });
  const total = parcels.length > 1 ? volumetricWeightLabel(model.optimizedVolumetricTotal) : null;
  return total ? [...lines, `Total : ${total}`] : lines;
}

/** One dossier produces one row. The model never filters: a view changes the
 * presentation and the preferred task, never ownership filters, permissions or
 * availability. The one view that lists fewer dossiers, « Accords clients »,
 * restricts its rows before the model (consentQueueFilter).
 * `actions` may be pre-grouped by the caller; no global store or mutation here.
 * `settings` (app_settings « business ») give the volumetric divisor.
 */
export function buildDossierTableModel(dossier, { actions = [], me, can = () => false, teamUsers = [], envois = [], client = dossier.devisSnapshot?.inputs?.client || {}, scope = 'all', view = 'daily', available = true, now = Date.now(), workReady = true, assigneeFilter = '', settings = {} } = {}) {
  const optimized = hasCurrentPreparation(dossier);
  const payment = paymentModel(dossier, now);
  const departure = departureModel(dossier, envois, optimized, payment, now, client);
  const boxes = optimized ? dossier.finalPackages ?? [{ dimL: dossier.finL, dimW: dossier.finW, dimH: dossier.finH, poids: dossier.finP }] : [];
  const optimizedWeight = optimized ? Math.round((boxes.reduce((sum, box) => sum + Number(box.poids), 0) + Number.EPSILON) * 100) / 100 : null;
  const quotePrice = quotePriceModel(dossier, payment, optimized);
  const quoteTaxes = quoteTaxesModel(dossier, view === 'payments' ? requestedPriceModel(payment) : quotePrice);
  const dimensions = value => Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  // Each outgoing parcel with its volumetric weight (L × l × h ÷ divisor, unrounded);
  // the total adds the unrounded weights, as the quote does (measureShipment).
  const divisor = optimized ? dossierVolumetricDivisor(dossier, boxes, settings) : null;
  const optimizedParcels = boxes.map((box, index) => {
    const sides = [box.dimL, box.dimW, box.dimH].map(dimensions);
    return { label: boxes.length > 1 ? `Colis ${index + 1}` : null, sides, dimensions: `${sides.join(' × ')} cm`,
      volumetricWeight: divisor ? parcelVolumetricWeight(box, divisor.value) : null };
  });
  const optimizedVolumetricTotal = optimizedParcels.length && optimizedParcels.every(parcel => parcel.volumetricWeight !== null)
    ? optimizedParcels.reduce((sum, parcel) => sum + parcel.volumetricWeight, 0) : null;
  const optimizedDimensions = optimizedParcels.map(parcel => `${parcel.label ? `${parcel.label} : ` : ''}${parcel.dimensions}`);
  // A legacy status cannot turn an incomplete recorded payment into “Payé”.
  const statusLabel = dossier.statut === 'paye' && payment.stateLabel !== PAYMENT_STATE_LABELS.paid ? payment.detailLabel : STATUTS[dossier.statut]?.label || 'Statut à vérifier';
  // « Accords clients »: the consent and its last relance, on the same clock as the rest of the row.
  const base = { reception: receptionDateSummary(dossier, { now }), payment, quotePrice, quoteTaxes, departure, optimized, optimizedDimensions, optimizedWeight, statusLabel,
    optimizedParcels, optimizedVolumetricTotal, optimizedVolumetricDivisor: divisor?.value ?? null, optimizedVolumetricSource: divisor?.source ?? null,
    consent: consentState(dossier, now), relance: consentRelance(dossier) };
  if (!workReady) return { ...base, action: null, title: 'Tâches à actualiser', detail: 'Actualisez les tâches pour retrouver leur attribution.', ownerName: '—', otherActionsCount: 0, matchesScope: scope === 'all' && !assigneeFilter };
  const rows = dossier.archive ? [] : sortWorkActions(actions.filter(action => action.colis_id === dossier.id && action.state !== 'done')
    .map(action => checkedAction(action, dossier, optimized, payment, now)), now);
  const mine = action => Boolean(me) && action.assignee_id === me;
  const free = action => !action.assignee_id;
  const canDo = action => canWorkAction(action, can) && !actionWaiting(action)
    && (mine(action) && ['ready', 'in_progress'].includes(action.state) || free(action) && available && action.state === 'ready');
  const scoped = rows.filter(action => (scope === 'mine' ? mine(action) : scope === 'pool' ? Boolean(me) && free(action) && canDo(action) : true)
    && (!assigneeFilter || (assigneeFilter === 'mine' ? mine(action) : assigneeFilter === 'unassigned' ? free(action) : action.assignee_id === assigneeFilter)));
  const next = currentTask(dossier, payment, client);
  const stageKind = { reception: 'reception', accord: dossier.statut === 'refuse_client' ? 'correction' : 'reception', preparation: 'preparation', documents: 'documents', devis: 'quote', paiement: 'quote', expedition: 'departure', livraison: 'departure' }[next];
  const preferred = view === 'payments' ? 'quote' : view === 'departures' ? 'departure' : view === 'accords' ? 'reception' : stageKind;
  const ordered = [...scoped].sort((a, b) => Number(!canDo(a)) - Number(!canDo(b))
    || Number(actionWaiting(a)) - Number(actionWaiting(b))
    || Number(a.kind !== preferred) - Number(b.kind !== preferred)
    || Number(a.kind !== stageKind) - Number(b.kind !== stageKind));
  const action = ordered[0] || null;
  let title = action ? workTitle({ ...action, action_hint: action.action_hint?.trim() }) : dossier.archive ? 'Dossier archivé' : dossier.statut === 'livre' ? 'Livré' : dossier.statut === 'annule' ? 'Dossier annulé' : DOSSIER_TASKS[next]?.title || 'Consulter le dossier';
  if (action?.kind === 'reception' && !action.action_hint?.trim()) title = dossier.statut === 'receptionne' ? 'Mesurer les cartons' : dossier.statut === 'mesure' ? 'Demander l’accord du client' : 'Suivre l’accord du client';
  let detail = action ? actionWaiting(action) ? workSituation(action) : !canWorkAction(action, can) ? 'Cette tâche nécessite une personne autorisée.' : action.assignee_id && !mine(action) ? 'Un collègue s’occupe de cette tâche.' : free(action) && !available ? 'Vous êtes indisponible pour prendre une nouvelle tâche.' : workSituation(action)
    : 'Consultez le dossier pour retrouver la prochaine étape.';
  if (action && !actionWaiting(action)) {
    const priority = actionPriority(action, now);
    if (priority.urgent) detail = priority.reason + (canDo(action) ? '' : ` · ${detail}`);
  }
  return { ...base, action, title, detail, refreshable: action?.blocked_reason === STALE_TASK_REASON, ownerName: ownerName(action, me, teamUsers), otherActionsCount: Math.max(0, rows.length - (action ? 1 : 0)), matchesScope: scope === 'all' && !assigneeFilter || scoped.length > 0 };
}

const exportKeys = {
  daily: ['ref', 'client', 'receivedAt', 'statusLabel', 'paymentState', 'statut', 'owner', 'casier', 'cartons', 'optimizedDimensions', 'optimizedWeight', 'requested', 'taxes'],
  payments: ['ref', 'client', 'receivedAt', 'statusLabel', 'paymentState', 'requested', 'taxes', 'paid', 'remaining', 'sentAt'],
  departures: ['ref', 'client', 'receivedAt', 'statusLabel', 'paymentState', 'departure', 'destination', 'packages', 'readiness', 'optimizedDimensions', 'optimizedWeight', 'requested', 'taxes'],
  accords: ['ref', 'client', 'receivedAt', 'consentState', 'consentRequestedAt', 'lastRelanceAt', 'cartons', 'casier', 'departure'],
};

// ── Numbers of the list: the columns with a total ──────────────────────────
/** The columns that add up, and how: counts, kilograms (« Poids final »), the
 * volumetric weight of « Dimensions finales », and euros. No total for text or dates. */
export const DOSSIER_TOTAL_KINDS = Object.freeze({
  cartons: 'count', packages: 'count', optimizedWeight: 'weight', optimizedDimensions: 'volumetric',
  requested: 'money', taxes: 'money', paid: 'money', remaining: 'money',
});
const finiteNumber = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
/** The number a column with a total shows for one dossier, read from the same
 * source as its cell: the cartons received, the outgoing parcels and the final
 * weight once optimised, the volumetric total of « Dimensions finales », the
 * quote price (or the requested amount in « Paiements »), the taxes, the amount
 * paid and the rest to pay. Null when the cell shows no value (« À calculer »,
 * « À vérifier », not measured yet); undefined for a column without a total.
 * The screen totals and the spreadsheet both read it, so they add up the same cells. */
export function dossierTableNumber(column, { dossier = {}, model } = {}) {
  if (!Object.prototype.hasOwnProperty.call(DOSSIER_TOTAL_KINDS, column?.key)) return undefined;
  if (column.key === 'cartons') return finiteNumber(receptionCartonManifest(dossier).nbColis);
  if (column.key === 'taxes') return finiteNumber(model?.quoteTaxes?.amount);
  if (['requested', 'paid', 'remaining'].includes(column.key)) return finiteNumber(dossierTableAmount(model, column));
  if (!model?.optimized) return null;
  return finiteNumber({ packages: dossier.outgoingParcelCount, optimizedWeight: model.optimizedWeight, optimizedDimensions: model.optimizedVolumetricTotal }[column.key]);
}

const EXPORT_COUNT_FORMAT = '0';
const EXPORT_WEIGHT_FORMAT = '#,##0.00';
/** The Excel format of a column's numbers (« 1 250,00 € », « 45,20 », « 12 »).
 * An amount keeps its state after it (« 89,50 € · Brouillon ») and a
 * professional quote's zero taxes read « Sans taxes (pro) », as in the cell:
 * the number itself stays a number the spreadsheet adds up. */
export function dossierTableExportFormat(kind, { state = '', zeroLabel = '' } = {}) {
  if (kind === 'count') return EXPORT_COUNT_FORMAT;
  if (kind === 'weight') return EXPORT_WEIGHT_FORMAT;
  if (kind !== 'money') return null;
  const suffix = state ? ` · ${state}` : '';
  const amount = `#,##0.00 "€${suffix}"`;
  return zeroLabel ? `${amount};-${amount};"${zeroLabel}${suffix}"` : amount;
}
function exportCellFormat(column, model) {
  const kind = DOSSIER_TOTAL_KINDS[column.key];
  if (kind !== 'money') return dossierTableExportFormat(kind);
  if (column.key === 'taxes') return dossierTableExportFormat(kind, { state: model?.quoteTaxes?.stateLabel, zeroLabel: model?.quoteTaxes?.pro ? TAXES_PRO_LABEL : '' });
  return dossierTableExportFormat(kind, { state: dossierTableAmountState(model, column) });
}
const tableDateFormatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Indian/Reunion' });

/** Shared by screen and spreadsheet; an explicit business timezone makes the
 * same saved instant display on the same date on every colleague's computer. */
export function formatDossierTableDate(value) {
  const timestamp = dateTime(value);
  return timestamp === null ? 'Non renseigné' : tableDateFormatter.format(new Date(timestamp));
}

export function dossierTableMissingAmountLabel(payment, key) {
  return key === 'paid' || /vérifier/.test(payment?.stateLabel || '') ? 'À vérifier' : 'À calculer';
}

/** Export has a strict view allowlist, even if an unexpected descriptor is
 * supplied. It cannot fall back to the old all-fields/client-contact export. */
export function dossierTableExportColumns(view, columns) {
  if (!Object.prototype.hasOwnProperty.call(exportKeys, view) || !Array.isArray(columns)) throw new Error('La vue et ses colonnes doivent être précisées avant l’export.');
  const seenKeys = new Set(), seenLabels = new Set();
  return columns.filter(column => {
    if (!exportKeys[view].includes(column?.key) || seenKeys.has(column.key)) return false;
    const source = TABLE_COLUMNS[view].find(item => item.key === column.key)?.priceKind;
    if (source === 'quote' && column.priceKind !== 'quote' || column.priceKind && column.priceKind !== source) return false;
    if (typeof column.label !== 'string' || !column.label.trim()) throw new Error('Une colonne à exporter n’a pas de nom.');
    if (seenLabels.has(column.label)) throw new Error('Deux colonnes à exporter portent le même nom.');
    seenKeys.add(column.key); seenLabels.add(column.label);
    return true;
  }).map(({ key, label, priceKind }) => ({ key, label, ...(priceKind ? { priceKind } : {}) }));
}

/** Export precisely the supplied visible rows and descriptors, in their order.
 * The caller applies permissions/filters and passes the same models as the UI.
 * Financial values and task ownership NEVER fall back to raw dossier fields.
 * `rows`: one object per dossier, its values under the column labels; a column
 * with a total (dossierTableNumber) gives a number exactly when its cell shows
 * one, otherwise the cell's wording. `formats`: the Excel format of each number.
 */
export function buildDossierTableExport(dossiers, clients, models, view, columns) {
  const selected = dossierTableExportColumns(view, columns);
  const seen = new Set();
  const unique = (dossiers || []).filter(dossier => {
    const key = dossier.id || dossier.ref;
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
  const rows = exportValues(unique, clients, models, selected);
  const formats = unique.map((dossier, index) => Object.fromEntries(selected.filter(column => typeof rows[index][column.label] === 'number' && DOSSIER_TOTAL_KINDS[column.key])
    .map(column => [column.label, exportCellFormat(column, models?.get?.(dossier.id))])));
  return { columns: selected, dossiers: unique, rows, formats };
}

export function buildDossierTableExportRows(dossiers, clients, models, view, columns) {
  return buildDossierTableExport(dossiers, clients, models, view, columns).rows;
}

function exportValues(dossiers, clients, models, selected) {
  const clientById = new Map((clients || []).map(client => [client.id, client]));
  return dossiers.map(dossier => {
    const client = clientById.get(dossier.clientId);
    const model = models?.get?.(dossier.id);
    const name = client?.nomFamille ? [client.nomFamille, client.prenom].filter(Boolean).join(' ') : client?.nom || client?.prenom || 'Client non renseigné';
    const code = String(client?.cp || '').trim().slice(0, 3);
    const sector = getSecteurByCP(client?.cp);
    const zone = [DESTINATIONS[code]?.label, sector ? sector[0] + sector.slice(1).toLowerCase() : ''].filter(Boolean).join(' · ');
    const amount = key => typeof model?.payment?.[key] === 'number' && Number.isFinite(model.payment[key])
      ? model.payment[key] : dossierTableMissingAmountLabel(model?.payment, key);
    // The screen's wording: « Le client attend · jusqu’au 25/10 », « 06/10/2026 · Envoi non confirmé ».
    const consent = model?.consent ?? consentState(dossier), relance = model?.relance ?? consentRelance(dossier);
    const values = {
      ref: dossier.ref || 'Sans référence',
      client: [name, zone].filter(Boolean).join('\n'),
      statut: [model?.title || 'Tâches à actualiser', model?.detail, model?.otherActionsCount > 0 ? parallelTasksLabel(model.otherActionsCount) : ''].filter(Boolean).join('\n'),
      statusLabel: model?.statusLabel || 'Statut à vérifier', paymentState: model?.payment?.stateLabel || 'À vérifier',
      // The cell's text, volumetric weights and total included.
      optimizedDimensions: dossierDimensionsLines(model).join('\n'),
      optimizedWeight: model?.optimized ? model.optimizedWeight ?? '' : '',
      owner: model?.ownerName || '—',
      casier: dossier.casier || 'À renseigner',
      cartons: receptionCartonManifest(dossier).nbColis,
      receivedAt: formatDossierTableDate(model?.reception?.lastReceivedAt) + (model?.reception?.lastReceivedAt && !model.reception.complete ? ` · ${model.reception.knownCount}/${model.reception.totalCount} cartons datés` : ''),
      requested: amount('requested'), paid: amount('paid'), remaining: amount('remaining'),
      taxes: model?.quoteTaxes?.stateLabel || 'À calculer',
      sentAt: formatDossierTableDate(model?.payment?.sentAt),
      departure: model?.departure?.label || 'À prévoir', destination: model?.departure?.destination || 'À renseigner',
      packages: model?.departure?.packagesLabel || 'À préparer', readiness: model?.departure?.readinessLabel || 'À vérifier',
      consentState: consentSummary(consent),
      consentRequestedAt: consentRequestLabel(dossier),
      lastRelanceAt: relance ? [formatDossierTableDate(relance.at), relance.deliveryLabel].filter(Boolean).join(' · ') : NO_RELANCE_LABEL,
    };
    return Object.fromEntries(selected.map(column => {
      // « Dimensions finales » stays the text of its cell; its volumetric total is the screen's.
      const number = column.key === 'optimizedDimensions' ? null : dossierTableNumber(column, { dossier, model });
      if (typeof number === 'number') return [column.label, number];
      if (column.priceKind === 'quote') return [column.label, dossierTableAmountState(model, column) || 'À calculer'];
      return [column.label, values[column.key]];
    }));
  });
}

// ── « Accords clients »: what an empty request or relance column says ──────
export const REQUEST_NOT_SENT_LABEL = 'Pas encore envoyée';
export const NO_RELANCE_LABEL = 'Aucune relance';
/** « 02/10/2026 », the confirmed delivery of the consent request, or « Pas encore envoyée ». */
export function consentRequestLabel(dossier) {
  return dateTime(dossier?.demandeFeuVertEnvoyeeAt) === null ? REQUEST_NOT_SENT_LABEL : formatDossierTableDate(dossier.demandeFeuVertEnvoyeeAt);
}

/** A card shows a fact only when it has something to say: no « Poids final »
 * or « Dimensions finales » before the optimisation. */
export function dossierFactHasValue(column, model = {}) {
  if (column?.key === 'optimizedWeight') return model?.optimizedWeight != null;
  if (column?.key === 'optimizedDimensions') return Boolean(model?.optimized) && (model?.optimizedDimensions || []).length > 0;
  if (column?.key === 'consentState') return Boolean(model?.consent);
  return true;
}

// ── Bulk status changes ─────────────────────────────────────────────────────
/** The transport chain after the departure, in its order. `from` mirrors the
 * database guard fn_valider_transition_statut; `permission` mirrors
 * guard_colis_permissions. « Expédié » is only reached by confirming the
 * loading of the departure (guard_colis_departure refuses a direct change):
 * it is never a bulk write, the list points to the departure instead. */
// Each step reads as its status pill (STATUTS): « 2 dossiers passés à « En vol » »
// above rows showing « En vol ».
const bulkStep = (statut, from, permission, extra = {}) => Object.freeze({ statut, label: STATUTS[statut].label, from: Object.freeze(from), permission, ...extra });
export const BULK_STATUS_STEPS = Object.freeze([
  bulkStep('expedie', ['paye'], 'perm_colis_expedier', { viaDeparture: true }),
  bulkStep('transit', ['expedie'], 'perm_colis_changer_statut_expedition'),
  bulkStep('dedouanement', ['transit'], 'perm_colis_changer_statut_expedition'),
  bulkStep('arrive', ['transit', 'dedouanement'], 'perm_colis_changer_statut_expedition'),
  bulkStep('livraison', ['arrive'], 'perm_colis_changer_statut_expedition'),
  bulkStep('livre', ['livraison'], 'perm_colis_changer_statut_expedition'),
]);
const AFTER_DEPARTURE = new Set(['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre']);
export const BULK_STATUS_REASONS = Object.freeze({
  departure: '« Expédié » se confirme au chargement de leur départ.',
  beforeDeparture: 'Avant le départ, un dossier avance par son parcours : pas de statut groupé.',
  delivered: 'Dossiers livrés : aucune étape ne suit.',
  mixed: 'Étapes différentes : sélectionnez des dossiers au même statut pour les faire avancer ensemble.',
});
/** What a bulk status change can do for these dossiers: the steps that are a
 * valid next status for EVERY one of them, in the order of the chain
 * (`choices`); otherwise why none applies (`reason`) and whether the departure
 * confirms the next step (`departure`). Permissions are the caller's. */
export function bulkStatusPlan(dossiers = []) {
  const list = (dossiers || []).filter(Boolean);
  if (!list.length) return { choices: [], reason: null, departure: false };
  const choices = BULK_STATUS_STEPS.filter(step => !step.viaDeparture && list.every(dossier => step.from.includes(dossier.statut)));
  if (choices.length) return { choices, reason: null, departure: false };
  if (list.every(dossier => dossier.statut === 'paye')) return { choices, reason: BULK_STATUS_REASONS.departure, departure: true };
  if (list.some(dossier => !AFTER_DEPARTURE.has(dossier.statut) && dossier.statut !== 'paye')) return { choices, reason: BULK_STATUS_REASONS.beforeDeparture, departure: false };
  if (list.every(dossier => dossier.statut === 'livre')) return { choices, reason: BULK_STATUS_REASONS.delivered, departure: false };
  return { choices, reason: BULK_STATUS_REASONS.mixed, departure: false };
}
const statusName = statut => BULK_STATUS_STEPS.find(step => step.statut === statut)?.label || STATUTS[statut]?.label || statut;
/** The server's refusal of one dossier, in plain words: a refused transition
 * names both statuses, any other refusal keeps the server's own message. */
export function bulkRefusalReason(error) {
  const message = typeof error === 'string' ? error : error?.message;
  const transition = typeof message === 'string' && message.match(/Transition invalide\s*:\s*([a-z_]+)\s*→\s*([a-z_]+)/);
  if (transition) return `Passage de « ${statusName(transition[1])} » à « ${statusName(transition[2])} » refusé par le serveur.`;
  return typeof message === 'string' && message.trim() ? message.trim() : 'Refusé par le serveur, sans motif précisé.';
}
