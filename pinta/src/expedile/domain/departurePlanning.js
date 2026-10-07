import { DESTINATIONS } from '../constants/index.js';
import { departureDayLabel, isoCalendarDay, parisCalendarDay } from './departureGroups.js';

// The departure of a dossier, chosen at any step until the parcel leaves. One
// validity rule, the server's (guard_colis_departure, valid_departure_for_colis,
// _departure_for_day): the dossier's destination (_colis_destination), an open
// status, not departed, a date from today and a loading closing absent or still
// ahead. The Wednesday 17 h closing (departure_default_closing) is only the
// habitual one: it dates a created departure, opens the consent relance and
// informs the labels, it never closes a departure. Everything runs on Paris
// time: « today », the closing and a typed date never follow the device's own
// time zone. Nothing here writes.

const PARIS = 'Europe/Paris';
const DAY = 86400000;
const WALL_CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: PARIS, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const naturalOrder = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/** Departure statuses a dossier can still join (guard_colis_departure). */
export const OPEN_DEPARTURE_STATUSES = Object.freeze(['planifie', 'prochain', 'en_cours', 'en_preparation', 'pret']);
const OPEN = new Set(OPEN_DEPARTURE_STATUSES);
// Before « expedie »: the statuses whose departure can still be chosen or changed.
const BEFORE_DEPARTURE = new Set(['receptionne', 'mesure', 'attente_feu_vert', 'refuse_client', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye']);
// « pour la Réunion », « pour Mayotte ».
const DESTINATION_NAMES = { '974': 'la Réunion', '976': 'Mayotte', '971': 'la Guadeloupe', '972': 'la Martinique' };

const instantOf = value => {
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : null;
};
const compareKey = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const compareText = (left, right) => left && right ? naturalOrder.compare(left, right) : left ? -1 : right ? 1 : 0;
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/\s+/g, ' ').trim();

function parisWallClock(time) {
  const parts = Object.fromEntries(WALL_CLOCK.formatToParts(new Date(time)).map(part => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

/** The instant (ms) of a Paris wall-clock time on a calendar day, or null. */
export function parisInstant(value, hour = 0, minute = 0) {
  const day = isoCalendarDay(value);
  if (!day) return null;
  const [year, month, date] = day.split('-').map(Number);
  const wanted = Date.UTC(year, month - 1, date, hour, minute);
  // Paris is one or two hours ahead of UTC: start from one hour and correct.
  let instant = wanted - 3600000;
  for (let pass = 0; pass < 2; pass += 1) {
    const clock = parisWallClock(instant);
    instant += wanted - Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  }
  return instant;
}

const addDays = (day, count) => new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);

/** « Clôture mercredi 17 h »: the last Wednesday strictly before the departure
 * day, at 17:00 Paris (Thursday: the day before; Friday: two days before;
 * Wednesday: seven days before), as an ISO instant. Same rule as
 * departure_default_closing on the server. */
export function departureDefaultClosing(value) {
  const day = isoCalendarDay(value);
  if (!day) return null;
  const isoWeekday = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
  return new Date(parisInstant(addDays(day, -((isoWeekday + 3) % 7 + 1)), 17)).toISOString();
}

/** The closing shown for a departure and used by the consent relance
 * (_colis_departure_closing): its own loading closing, else the habitual
 * Wednesday 17 h on its date. An ISO instant, or null for an undated
 * departure. Only an explicit loading closing ever closes a departure. */
export function departureClosing(envoi) {
  const loading = instantOf(envoi?.loadingClosesAt ?? NaN);
  return loading !== null ? new Date(loading).toISOString() : departureDefaultClosing(envoi?.date);
}

/** The departure has no loading closing of its own: its closing is the habitual
 * Wednesday 17 h, information only. */
export function departureClosingHabitual(envoi) {
  return instantOf(envoi?.loadingClosesAt ?? NaN) === null;
}

/** « mercredi 22 octobre, 17 h », « jeudi 8 octobre, 9 h 30 » (Paris). */
export function closingLabel(value, { today = Date.now() } = {}) {
  const time = instantOf(value ?? NaN);
  if (time === null) return null;
  const clock = parisWallClock(time);
  return `${departureDayLabel(parisCalendarDay(time), { today })}, ${clock.hour} h${clock.minute ? ` ${String(clock.minute).padStart(2, '0')}` : ''}`;
}

/** The destination a departure must serve, as the server checks it: the quote
 * snapshot once paid, otherwise the client postcode prefix. Never Réunion by
 * default. */
export function dossierDestinationCode(dossier = {}, client = {}) {
  const prefix = String(client?.cp ?? '').slice(0, 3) || null;
  if (!dossier?.paiementDate) return prefix;
  return dossier.devisSnapshot?.inputs?.destination?.code || dossier.devisSnapshot?.destination?.code || prefix;
}

/** « la Réunion », « Mayotte »; null for an unknown destination. */
export function destinationName(code) {
  return DESTINATIONS[code] ? DESTINATION_NAMES[code] || DESTINATIONS[code].label : null;
}

/** The departure can be chosen, changed or removed: the parcel has not left,
 * the dossier is neither cancelled nor archived. */
export function departureEditable(dossier = {}) {
  return Boolean(dossier) && !dossier.archive && !dossier.dateExpedition && BEFORE_DEPARTURE.has(dossier.statut);
}

/** The Départ field opens for this person: the dossier has not left, and the
 * server's permission to assign (perm_colis_affecter_envoi), or to reassign
 * once a departure is assigned (perm_envois_reaffecter), with the planning in
 * view (perm_envois_voir). `can` is the permission check of the screen. */
export function departureFieldEditable(dossier, can = () => false) {
  return Boolean(dossier) && departureEditable(dossier)
    && can(dossier.envoi || dossier.envoiId ? 'perm_envois_reaffecter' : 'perm_colis_affecter_envoi') && can('perm_envois_voir');
}

/** Why this departure cannot take the dossier, as the server checks it before
 * any assignment (guard_colis_departure): its destination, an open status, not
 * departed, a date from today (Paris), a loading closing absent or still ahead.
 * Null when it can; the habitual Wednesday closing never counts. */
export function departureIssue(envoi, dossier = {}, client = {}, now = Date.now()) {
  if (!envoi) return 'Départ introuvable';
  const code = dossierDestinationCode(dossier, client);
  if (!code) return 'Destination du client inconnue';
  if (String(envoi.destinationCode ?? '') !== code) return dossier?.paiementDate ? 'Destination différente du devis payé' : 'Destination différente de celle du client';
  if (envoi.departedAt || !OPEN.has(envoi.statut)) return 'Départ déjà parti, arrivé ou archivé';
  const instant = instantOf(now);
  const today = instant === null ? null : parisCalendarDay(instant);
  const day = isoCalendarDay(envoi.date);
  if (!day || !today || day < today) return 'Date de départ dépassée ou absente';
  const loading = instantOf(envoi.loadingClosesAt ?? NaN);
  return loading !== null && loading <= instant ? 'Chargement clôturé' : null;
}

/** The departures this dossier can join, soonest first: departureIssue is null. */
export function plannedDeparturesFor(dossier, client, envois = [], now = Date.now()) {
  if (!dossierDestinationCode(dossier, client) || instantOf(now) === null) return [];
  return (envois || []).filter(envoi => envoi && !departureIssue(envoi, dossier, client, now))
    .sort((left, right) => compareKey(left.date, right.date) || compareText(left.ref, right.ref) || compareKey(String(left.id), String(right.id)));
}

/** Every departure of the dossier's destination planned on that day, whatever
 * its state, archived ones aside: what the person can see of that day, as
 * create_departure_for_colis counts it. */
export function departuresOfDay(dossier, client, envois = [], value) {
  const day = isoCalendarDay(value), code = dossierDestinationCode(dossier, client);
  if (!day || !code) return [];
  return (envois || []).filter(envoi => envoi && isoCalendarDay(envoi.date) === day && String(envoi.destinationCode ?? '') === code && envoi.statut !== 'archive');
}

/** « est déjà parti » for a departure that has left, « est clôturé » for one
 * whose loading closed: why a departure of that day takes no more dossiers. */
export function closedDepartureWording(envoi) {
  return envoi?.departedAt || !OPEN.has(envoi?.statut) ? 'est déjà parti' : 'est clôturé';
}

/** The planned departure of that day, or null. */
export function departureForDate(departures = [], value) {
  const day = isoCalendarDay(value);
  return day ? (departures || []).find(envoi => envoi?.date === day) || null : null;
}

/** The desired day of a dossier without a departure (« Départ à créer »), or null. */
export function dossierDepartureWish(dossier = {}) {
  return dossier?.envoi || dossier?.envoiId ? null : isoCalendarDay(dossier?.departSouhaite);
}

/** What the desired day of a dossier stands for, from the departures the
 * person can read: `to_create` (no departure that day for its destination),
 * `planned` (a departure it can join is planned that day: to assign), `closed`
 * (that day's departure is closed or has left) or `past` (the day has gone).
 * `{ day, state, envoi }` (`envoi`: that day's departure), or null without a
 * wish. */
export function dossierWishState(dossier, client, envois = [], now = Date.now()) {
  const day = dossierDepartureWish(dossier || {});
  if (!day) return null;
  const instant = instantOf(now);
  const today = instant === null ? null : parisCalendarDay(instant);
  if (today && day < today) return { day, state: 'past', envoi: null };
  const open = departureForDate(plannedDeparturesFor(dossier, client, envois, now), day);
  if (open) return { day, state: 'planned', envoi: open };
  const existing = departuresOfDay(dossier, client, envois, day)[0] || null;
  return { day, state: existing ? 'closed' : 'to_create', envoi: existing };
}

/** The wording of each state of a desired day. */
export const WISH_STATE_LABELS = Object.freeze({
  to_create: 'à créer',
  planned: 'départ prévu, à affecter',
  closed: 'départ clôturé',
  past: 'date passée',
});

/** « Souhaité le 20/11/2026 · à créer » (or « · départ prévu, à affecter »,
 * « · départ clôturé », « · date passée »): the list and step wording of a wish. */
export function wishedDepartureLabel(dossier, { client = {}, envois = [], now = Date.now() } = {}) {
  const wish = dossierWishState(dossier, client, envois, now);
  return wish ? `Souhaité le ${wish.day.split('-').reverse().join('/')} · ${WISH_STATE_LABELS[wish.state]}` : null;
}

/** « jeudi 23 octobre · clôture mercredi 22 octobre, 17 h » for a loading
 * closing, « jeudi 23 octobre · clôture habituelle mercredi 22 octobre, 17 h »
 * without one: the Wednesday 17 h is then information, never a cut-off. */
export function departureOptionLabel(envoi, { today = Date.now() } = {}) {
  const day = departureDayLabel(envoi?.date, { today });
  const closing = closingLabel(departureClosing(envoi), { today });
  return day ? closing ? `${day} · ${departureClosingHabitual(envoi) ? 'clôture habituelle' : 'clôture'} ${closing}` : day : null;
}

/** Typing filters the planned departures on their wording, their date and
 * their reference. */
export function departureMatchesText(envoi, text, { today = Date.now() } = {}) {
  const query = fold(text);
  if (!query) return true;
  const day = isoCalendarDay(envoi?.date);
  return fold([departureOptionLabel(envoi, { today }), day && day.split('-').reverse().join('/'), envoi?.ref].filter(Boolean).join(' ')).includes(query);
}

/** What the dossier shows for its departure: « Départ : jeudi 23 octobre ·
 * Réunion », « Départ souhaité : jeudi 20 novembre · à créer » (or the other
 * wordings of dossierWishState) or « Départ : à choisir ». `state` is assigned,
 * unknown (a departure the person cannot read), wish (with its `wishState`) or
 * none. `today` is the instant of the reading. */
export function departureFieldText(dossier = {}, envois = [], { today = Date.now(), client = {} } = {}) {
  const envoiId = dossier.envoi || dossier.envoiId;
  if (envoiId) {
    const envoi = (envois || []).find(item => item?.id === envoiId);
    if (!envoi) return { state: 'unknown', prefix: 'Départ', value: 'à vérifier' };
    const destination = DESTINATIONS[envoi.destinationCode]?.label || (envoi.destinationCode ? String(envoi.destinationCode) : null);
    return { state: 'assigned', prefix: 'Départ', value: [departureDayLabel(envoi.date, { today }) || 'date à préciser', destination].filter(Boolean).join(' · ') };
  }
  const wish = dossierWishState(dossier, client, envois, today);
  if (wish) return { state: 'wish', wishState: wish.state, prefix: 'Départ souhaité', value: `${departureDayLabel(wish.day, { today })} · ${WISH_STATE_LABELS[wish.state]}` };
  return { state: 'none', prefix: 'Départ', value: 'à choisir' };
}

/** The closing that matters for the dossier's consent (the server's
 * _colis_departure_closing): its departure's closing; without one, the
 * closing of the open departure planned on its desired day (the one
 * _departure_for_day would assign: the lowest id among the departures the
 * dossier can join that day), else the Wednesday 17 h of that day.
 * `{ closing, day, habitual }` (`habitual`: the Wednesday 17 h, without a
 * loading closing of its own), or null. `client`, `envois` and `now` find the
 * departure planned on the desired day; without them that day's Wednesday
 * 17 h applies. */
export function dossierDepartureClosing(dossier = {}, envoi = null, { client = {}, envois = [], now = Date.now() } = {}) {
  const envoiId = dossier.envoi || dossier.envoiId;
  if (envoiId) {
    if (!envoi || envoi.id !== envoiId) return null;
    const closing = departureClosing(envoi);
    return closing ? { closing, day: isoCalendarDay(envoi.date), habitual: departureClosingHabitual(envoi) } : null;
  }
  const wish = dossierDepartureWish(dossier);
  if (!wish) return null;
  const planned = plannedDeparturesFor(dossier, client, envois, now).filter(item => isoCalendarDay(item.date) === wish)
    .sort((left, right) => compareKey(String(left.id), String(right.id)))[0];
  return planned ? { closing: departureClosing(planned), day: wish, habitual: departureClosingHabitual(planned) }
    : { closing: departureDefaultClosing(wish), day: wish, habitual: true };
}

/** The 48 hours before a closing that has not passed yet. */
export function consentRelanceOpen(closing, now = Date.now()) {
  const end = instantOf(closing ?? NaN), instant = instantOf(now);
  return end !== null && instant !== null && instant < end && end - 48 * 3600000 <= instant;
}

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
// Indexed like Date#getUTCDay.
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const byPrefix = (words, word) => {
  if (!word || word.length < 3) return -1;
  const found = words.map((item, index) => item.startsWith(word) ? index : -1).filter(index => index >= 0);
  return found.length === 1 ? found[0] : -1;
};
const calendarDay = (year, month, day) => isoCalendarDay(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

/** The calendar day a person typed, from today (Paris): « 23/10 », « 23/10/2026 »,
 * « 23 octobre », « 2026-10-23 », or « jeudi 23 » (the next 23rd, whatever its
 * weekday: the label then names the real day, so a mismatch shows). A weekday
 * never moves the date. Without a year, the next such day from today. Null
 * when the text is not a date. */
export function matchTypedDate(text, { today = Date.now() } = {}) {
  const value = fold(text).replace(/\b1er\b/g, '1');
  const start = parisCalendarDay(today);
  if (!value || !start) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isoCalendarDay(value);
  const match = value.match(/^(?:([a-z]+)\.?,?\s+)?(\d{1,2})(?:\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}|\d{2}))?|\s+([a-z]+)\.?(?:\s+(\d{4}))?)?$/);
  if (!match) return null;
  const [, weekdayWord, dayText, monthNumber, numericYear, monthWord, wordYear] = match;
  const weekday = weekdayWord ? byPrefix(WEEKDAYS, weekdayWord) : null;
  if (weekdayWord && weekday < 0) return null;
  const day = Number(dayText);
  const month = monthNumber ? Number(monthNumber) : monthWord ? byPrefix(MONTHS, monthWord) + 1 : null;
  if (month === 0 || day < 1 || day > 31) return null;
  const [startYear, startMonth] = start.split('-').map(Number);
  if (!month) {
    // « jeudi 23 »: the next 23rd from today; the weekday only shows it is a day.
    if (weekday === null) return null;
    for (let offset = 0; offset <= 12; offset += 1) {
      const index = startMonth - 1 + offset;
      const candidate = calendarDay(startYear + Math.floor(index / 12), index % 12 + 1, day);
      if (candidate && candidate >= start) return candidate;
    }
    return null;
  }
  const yearText = numericYear || wordYear;
  if (yearText) return calendarDay(yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText), month, day);
  for (const year of [startYear, startYear + 1, startYear + 2, startYear + 3, startYear + 4]) {
    const candidate = calendarDay(year, month, day);
    if (candidate && candidate >= start) return candidate;
  }
  return null;
}
