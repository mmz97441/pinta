import { DESTINATIONS } from '../constants/index.js';
import { isoCalendarDay, parisCalendarDay } from './departureGroups.js';
import {
  closingLabel, departureClosing, departureClosingHabitual, departureEditable, departureIssue, dossierDepartureWish, OPEN_DEPARTURE_STATUSES,
} from './departurePlanning.js';
import { addCalendarDays, parisDateTimeInstant, shiftParisDateTime } from './parisTime.js';

// The « Départs » page: its order, its wording and its form checks, on Paris
// time whatever the device's own zone. The validity of a departure for a
// dossier stays the server's rule (departureIssue). Nothing here writes.

const naturalOrder = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const KILOGRAMS = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const OPEN = new Set(OPEN_DEPARTURE_STATUSES);
// Statuses of a dossier that has left: it cannot be loaded again.
const SHIPPED = new Set(['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre', 'annule']);
const compareText = (left, right) => naturalOrder.compare(String(left ?? ''), String(right ?? ''));
const compareKey = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** « 1 dossier », « 3 dossiers » (French: 0 and 1 take the singular). */
export const countLabel = (count, one, many) => `${count} ${Math.abs(count) <= 1 ? one : many}`;

/** The loading of the departure was confirmed: it has a manifest or left. */
export const departureDeparted = envoi => Boolean(envoi && (Number(envoi.manifestVersion) > 0 || envoi.departedAt));

/** The three views of the page; a departure belongs to exactly one. */
export function departureInView(envoi, view) {
  if (!envoi) return false;
  if (view === 'archives') return envoi.statut === 'archive';
  return envoi.statut !== 'archive' && departureDeparted(envoi) === (view === 'partis');
}

/** Its day has passed (Paris) and it has not left: the planning needs a check. */
export function departureOverdue(envoi, today = Date.now()) {
  const day = isoCalendarDay(envoi?.date), current = parisCalendarDay(today);
  return Boolean(day && current) && !departureDeparted(envoi) && !['parti', 'arrive', 'archive'].includes(envoi.statut) && day < current;
}

/** « À préparer »: overdue departures first (they need attention), oldest
 * first, then the coming ones soonest first, undated ones last. « Partis » and
 * « Archivés »: the most recent first. Ties by reference. */
export function sortDepartures(envois = [], view = 'a-preparer', today = Date.now()) {
  const rank = envoi => !isoCalendarDay(envoi.date) ? 2 : departureOverdue(envoi, today) ? 0 : 1;
  return [...(envois || [])].filter(Boolean).sort((left, right) => {
    if (view !== 'a-preparer') return compareKey(right.date || '', left.date || '') || compareText(left.ref, right.ref);
    return rank(left) - rank(right) || compareKey(left.date || '', right.date || '') || compareText(left.ref, right.ref) || compareKey(String(left.id), String(right.id));
  });
}

/** What the card says of the departure's state. */
export function departureStateLabel(envoi) {
  if (envoi?.statut === 'archive') return 'Archivé';
  if (envoi?.statut === 'arrive') return 'Arrivé à destination';
  if (departureDeparted(envoi) || envoi?.statut === 'parti') return 'Départ confirmé';
  return 'À préparer';
}

/** « Clôture : mercredi 21 octobre, 17 h (heure de Paris) » for a loading
 * closing of its own (« · chargement clôturé » once it has passed: the
 * departure takes no more dossiers), « Clôture habituelle : … » otherwise (the
 * Wednesday 17 h before the departure, information only). Null once the
 * departure has left, arrived or is archived, and for an undated departure
 * without a closing. `today` is the instant of the reading. */
export function departureClosingLine(envoi, { today = Date.now() } = {}) {
  if (!envoi || departureDeparted(envoi) || ['parti', 'arrive', 'archive'].includes(envoi.statut)) return null;
  const closing = departureClosing(envoi);
  const label = closing ? closingLabel(closing, { today }) : null;
  if (!label) return null;
  if (departureClosingHabitual(envoi)) return `Clôture habituelle : ${label} (heure de Paris)`;
  const now = today instanceof Date ? today.getTime() : typeof today === 'number' ? today : Date.parse(today);
  return `Clôture : ${label} (heure de Paris)${Date.parse(closing) <= now ? ' · chargement clôturé' : ''}`;
}

/** « Confirmé le mercredi 7 octobre, 23 h 30 (heure de Paris) ». */
export function confirmedLine(value, { today = Date.now() } = {}) {
  const label = closingLabel(value, { today });
  return label ? `Confirmé le ${label} (heure de Paris)` : 'Date de confirmation à vérifier';
}

/** « 19,5 kg » (French, two decimals at most), or null without a weight. */
export function formatKg(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${KILOGRAMS.format(value)} kg` : null;
}

/** « 2 colis préparés · 19,5 kg »: one wording for the loading review and the manifest. */
export function preparedSummary(count, weight) {
  const parcels = Number(count) > 0 ? `${count} colis ${Number(count) === 1 ? 'préparé' : 'préparés'}` : 'Nombre de colis à vérifier';
  return `${parcels} · ${formatKg(weight) || 'poids à vérifier'}`;
}

/** The dossiers of the departure that its loading can still take: assigned,
 * neither cancelled nor archived, not shipped. */
export function loadableDossiers(envoi, dossiers = []) {
  return (dossiers || []).filter(dossier => dossier && envoi && (dossier.envoi || dossier.envoiId) === envoi.id && !dossier.archive && !dossier.dateExpedition && !SHIPPED.has(dossier.statut));
}

/** The open dossiers whose desired day (`departSouhaite`, a Paris day) is the
 * departure's day and that it can take, as the server checks it
 * (departureIssue): same destination (the paid quote once paid, otherwise the
 * client's), no departure yet, neither archived nor cancelled, before
 * « expedie », the departure still open (status, not left, from today, its
 * loading closing ahead). None for a departure that is closed or has left.
 * By reference. */
export function wishedDossiersFor(envoi, dossiers = [], clients = [], now = Date.now()) {
  const day = isoCalendarDay(envoi?.date);
  if (!day || departureDeparted(envoi) || !OPEN.has(envoi.statut)) return [];
  const clientOf = new Map((clients || []).map(client => [client.id, client]));
  return (dossiers || []).filter(dossier => dossier && departureEditable(dossier) && dossierDepartureWish(dossier) === day
    && departureIssue(envoi, dossier, clientOf.get(dossier.clientId) || {}, now) === null)
    .sort((left, right) => compareText(left.ref, right.ref) || compareKey(String(left.id), String(right.id)));
}

/** Why one dossier of « Affecter ces dossiers » was not assigned: a changed
 * version (40001) asks to reload it, any other refusal keeps the server's words. */
export function assignmentFailure(dossier, error) {
  const ref = dossier?.ref || 'sans référence';
  if (error?.code === '40001') return `Le dossier ${ref} a changé : rechargez-le`;
  return `${ref} : ${error?.message || 'affectation impossible'}`;
}

function closingIssue(text, day, now, weeks = 1) {
  if (!text) return null;
  const instants = Array.from({ length: Math.max(1, weeks) }, (_, week) => parisDateTimeInstant(shiftParisDateTime(text, week * 7)));
  if (!instants[0]) return 'Cet horaire n’existe pas à Paris (changement d’heure) : choisissez une autre heure.';
  if (instants.some(instant => !instant)) return 'Une semaine de la série tombe sur l’heure sautée au changement d’heure : choisissez une autre heure.';
  if (Date.parse(instants[0]) <= now) return 'La clôture doit être à venir.';
  if (day && parisCalendarDay(instants[0]) > day) return 'La clôture doit avoir lieu au plus tard le jour du départ.';
  return null;
}

function dayIssue(value, today, missing) {
  if (!value) return missing;
  const day = isoCalendarDay(value);
  if (!day) return 'Date invalide.';
  return today && day < today ? 'Choisissez une date à partir d’aujourd’hui (heure de Paris).' : null;
}

/** Errors of the planning form, by field: a first departure from today (Paris),
 * a destination, 1 to 12 weekly departures, and an optional loading closing
 * still ahead, at the latest on the departure day, existing in Paris for every
 * week of the series. Empty when the form can be saved. */
export function planningErrors({ date, destinationCode, weeks, closing } = {}, { now = Date.now() } = {}) {
  const errors = {};
  const today = parisCalendarDay(now);
  const dateError = dayIssue(date, today, 'Choisissez la date du premier départ.');
  if (dateError) errors.date = dateError;
  if (!DESTINATIONS[destinationCode]) errors.destinationCode = 'Choisissez une destination.';
  const count = Number(weeks);
  const weeksValid = String(weeks ?? '').trim() !== '' && Number.isInteger(count) && count >= 1 && count <= 12;
  if (!weeksValid) errors.weeks = 'Indiquez entre 1 et 12 départs hebdomadaires.';
  const closingError = closingIssue(closing, dateError ? null : isoCalendarDay(date), now, weeksValid ? count : 1);
  if (closingError) errors.closing = closingError;
  return errors;
}

/** Errors of a departure's edit form, by field: its day from today (Paris), a
 * destination, and an optional loading closing still ahead, at the latest on
 * its day. Empty when it can be saved. */
export function departureEditErrors({ date, destinationCode, closing } = {}, { now = Date.now() } = {}) {
  const errors = {};
  const dateError = dayIssue(date, parisCalendarDay(now), 'Choisissez la date du départ.');
  if (dateError) errors.date = dateError;
  if (!DESTINATIONS[destinationCode]) errors.destinationCode = 'Choisissez une destination.';
  const closingError = closingIssue(closing, dateError ? null : isoCalendarDay(date), now);
  if (closingError) errors.closing = closingError;
  return errors;
}

/** The departures of a valid planning form, one per week: `{ date,
 * loadingClosesAt }`, the closing at the same Paris hour every week (null
 * without a closing: the habitual Wednesday 17 h then applies). */
export function weeklyDepartures({ date, weeks, closing } = {}) {
  return Array.from({ length: Number(weeks) }, (_, week) => ({
    date: addCalendarDays(date, week * 7),
    loadingClosesAt: closing ? parisDateTimeInstant(shiftParisDateTime(closing, week * 7)) : null,
  }));
}
