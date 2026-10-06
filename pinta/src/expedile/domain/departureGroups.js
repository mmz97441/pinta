import { DESTINATIONS } from '../constants/index.js';

// Departures are planned on Paris time: « today » never follows the device's
// own time zone, and the ISO day of a departure is never shifted.
const PARIS = 'Europe/Paris';
const DAY_PARTS = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit' });
const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long' });
const DAY_LABEL_YEAR = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const DATE_LABEL = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, day: 'numeric', month: 'long' });
const DATE_LABEL_YEAR = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, day: 'numeric', month: 'long', year: 'numeric' });
const naturalOrder = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

export const NO_DEPARTURE_GROUP_KEY = 'none';
const NO_DEPARTURE_LABEL = 'Sans départ affecté';
// Same wording as the « Départ prévu » column for these two cases.
const UNREADABLE_DEPARTURE_LABEL = 'Départ à vérifier';
const UNDATED_DEPARTURE_LABEL = 'Date à préciser';

/** A real calendar day written YYYY-MM-DD, or null. */
export function isoCalendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

/** The Paris calendar day (YYYY-MM-DD) of an instant: a Date, a timestamp or an
 * ISO date-time. A calendar day is returned unchanged. */
export function parisCalendarDay(value = Date.now()) {
  const day = isoCalendarDay(value);
  if (day) return day;
  const date = new Date(value);
  if (value === null || !Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(DAY_PARTS.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function calendarDayLabel(value, today, [currentYear, otherYear]) {
  const day = isoCalendarDay(value);
  if (!day) return null;
  const sameYear = parisCalendarDay(today)?.slice(0, 4) === day.slice(0, 4);
  return (sameYear ? currentYear : otherYear).formatToParts(new Date(`${day}T12:00:00Z`))
    .map(part => part.type === 'day' && part.value === '1' ? '1er' : part.value).join('');
}

/** « jeudi 15 octobre », « jeudi 1er octobre », with the year when it is not the
 * current one. Noon UTC is the same calendar day in Paris on every device. */
export function departureDayLabel(value, { today = Date.now() } = {}) {
  return calendarDayLabel(value, today, [DAY_LABEL, DAY_LABEL_YEAR]);
}

/** The same day without its weekday: « 18 octobre », « 1er octobre 2027 ». */
export function calendarDateLabel(value, { today = Date.now() } = {}) {
  return calendarDayLabel(value, today, [DATE_LABEL, DATE_LABEL_YEAR]);
}

function departureGroup(key, envoi, today) {
  if (!envoi) return { key, envoi: null, label: UNREADABLE_DEPARTURE_LABEL, destinationLabel: null, ref: null, dossiers: [] };
  const day = isoCalendarDay(envoi.date);
  const code = envoi.destinationCode ? String(envoi.destinationCode) : '';
  return {
    key, envoi,
    label: day ? `Départ du ${departureDayLabel(day, { today })}` : UNDATED_DEPARTURE_LABEL,
    destinationLabel: DESTINATIONS[code]?.label || code || null,
    ref: envoi.ref || null,
    dossiers: [],
  };
}

// Missing values come last; equal groups keep a stable order by key.
const compareText = (left, right) => left && right ? naturalOrder.compare(left, right) : left ? -1 : right ? 1 : 0;
const compareKey = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** One group per departure (date + destination), for the dossier list:
 * 1. upcoming departures (Paris day ≥ today), soonest first, then by destination and reference;
 * 2. past departures, most recent first;
 * 3. departures without a readable date, by reference.
 * « Sans départ affecté » comes first with `noDeparture: 'top'`, otherwise last.
 * Each group keeps the incoming order of its dossiers: the caller has sorted them.
 * A departure the person cannot read (its id is not among `envois`) still
 * groups its own dossiers, as « Départ à vérifier ». */
export function groupDossiersByDeparture(dossiers = [], envois = [], { today = Date.now(), noDeparture = 'bottom' } = {}) {
  const todayDay = parisCalendarDay(today);
  const envoiById = new Map((envois || []).map(envoi => [envoi.id, envoi]));
  const groups = new Map();
  const withoutDeparture = [];
  for (const dossier of dossiers || []) {
    const envoiId = dossier.envoi || dossier.envoiId;
    if (!envoiId) { withoutDeparture.push(dossier); continue; }
    if (!groups.has(envoiId)) groups.set(envoiId, departureGroup(envoiId, envoiById.get(envoiId), todayDay));
    groups.get(envoiId).dossiers.push(dossier);
  }
  const rank = group => {
    const day = isoCalendarDay(group.envoi?.date);
    return { day, bucket: !day ? 2 : todayDay && day < todayDay ? 1 : 0 };
  };
  const ordered = [...groups.values()].map(group => ({ group, ...rank(group) })).sort((left, right) => {
    if (left.bucket !== right.bucket) return left.bucket - right.bucket;
    const byDay = left.bucket === 2 ? 0 : left.bucket === 0 ? compareKey(left.day, right.day) : compareKey(right.day, left.day);
    return byDay
      || (left.bucket === 2 ? 0 : compareText(left.group.destinationLabel, right.group.destinationLabel))
      || compareText(left.group.ref, right.group.ref)
      || compareKey(left.group.key, right.group.key);
  }).map(item => item.group);
  if (!withoutDeparture.length) return ordered;
  const unassigned = { key: NO_DEPARTURE_GROUP_KEY, envoi: null, label: NO_DEPARTURE_LABEL, destinationLabel: null, ref: null, dossiers: withoutDeparture };
  return noDeparture === 'top' ? [unassigned, ...ordered] : [...ordered, unassigned];
}
