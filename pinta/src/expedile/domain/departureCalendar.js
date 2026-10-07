import { departureDayLabel, isoCalendarDay, parisCalendarDay } from './departureGroups.js';
import {
  closedDepartureWording, closingLabel, departureClosing, departureClosingHabitual, departureDefaultClosing, departureForDate,
  departureIssue, departuresOfDay, destinationName, dossierDestinationCode, dossierWishState, plannedDeparturesFor,
} from './departurePlanning.js';

// The calendar of a dossier's « Départ » (lot P4b). Pure: what each day of a
// month means for the dossier, the shortcuts to the next departures, the
// keyboard moves of the date grid and the proposal for a day without departure.
// Every day is a Paris calendar day (YYYY-MM-DD) and « today » is the Paris day
// of `now`; the validity of a departure is the server's rule (departureIssue,
// plannedDeparturesFor). Nothing here writes.

const DAY_MS = 86400000;
// Formatted at noon UTC: the same calendar day everywhere.
const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const SHORT_CLOSING = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });

/** Monday first: the column headers and their full names. */
export const WEEKDAYS = Object.freeze([
  { short: 'lu', long: 'lundi' }, { short: 'ma', long: 'mardi' }, { short: 'me', long: 'mercredi' }, { short: 'je', long: 'jeudi' },
  { short: 've', long: 'vendredi' }, { short: 'sa', long: 'samedi' }, { short: 'di', long: 'dimanche' },
]);
/** How far ahead the calendar goes (months after the current one). */
export const CALENDAR_MONTHS_AHEAD = 18;
/** The departures offered as one-click shortcuts. */
export const SHORTCUT_COUNT = 3;

const pad = value => String(value).padStart(2, '0');
const capitalize = text => text ? text[0].toUpperCase() + text.slice(1) : text;

/** 'YYYY-MM' of a calendar day, or null. */
export function monthOf(value) {
  const day = isoCalendarDay(value);
  return day ? day.slice(0, 7) : null;
}

/** The month `delta` months after 'YYYY-MM'. */
export function addMonths(month, delta) {
  const [year, number] = month.split('-').map(Number);
  const index = year * 12 + number - 1 + delta;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${pad(index % 12 + 1)}`;
}

/** The calendar day `count` days after `day`. */
export function addDays(day, count) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

const daysInMonth = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
/** 0 for Monday … 6 for Sunday. */
const weekdayIndex = day => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** « novembre 2026 ». */
export function monthLabel(month) {
  return MONTH_LABEL.format(new Date(`${month}-01T12:00:00Z`));
}

/** The weeks of a month, Monday first: seven cells each, a day or null
 * outside the month. */
export function monthWeeks(month) {
  const cells = [...Array(weekdayIndex(`${month}-01`)).fill(null),
    ...Array.from({ length: daysInMonth(month) }, (_, index) => `${month}-${pad(index + 1)}`)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/** « jeu. 8 oct. ». */
export function shortDayLabel(day) {
  const iso = isoCalendarDay(day);
  return iso ? SHORT_DAY.format(new Date(`${iso}T12:00:00Z`)) : null;
}

/** « mer. 7, 17 h » (Paris), for an instant. */
export function shortClosingLabel(value) {
  const time = Date.parse(value ?? '');
  if (!Number.isFinite(time)) return null;
  const parts = Object.fromEntries(SHORT_CLOSING.formatToParts(new Date(time)).map(part => [part.type, part.value]));
  return `${parts.weekday} ${parts.day === '1' ? '1er' : parts.day}, ${Number(parts.hour)} h${parts.minute && parts.minute !== '00' ? ` ${parts.minute}` : ''}`;
}

/** « clôture mercredi 11 novembre, 17 h », « clôture habituelle … » without a
 * loading closing of its own (`short`: « clôture mer. 11, 17 h »). */
export function departureClosingText(envoi, { now = Date.now(), short = false } = {}) {
  const closing = departureClosing(envoi);
  const label = short ? shortClosingLabel(closing) : closingLabel(closing, { today: now });
  return label ? `${departureClosingHabitual(envoi) ? 'clôture habituelle' : 'clôture'} ${label}` : null;
}

/** What the calendar knows of a dossier on one screen: today, the departures it
 * can join (server rule, soonest first), its assigned departure and its
 * desired day. `envois` are the departures the person can read. */
export function departureCalendarContext(dossier = {}, client = {}, envois = [], { now = Date.now() } = {}) {
  const today = parisCalendarDay(now);
  const planned = plannedDeparturesFor(dossier, client, envois, now);
  const assignedId = dossier?.envoi || dossier?.envoiId || null;
  const assigned = assignedId ? (envois || []).find(envoi => envoi?.id === assignedId) || null : null;
  const wish = dossierWishState(dossier, client, envois, now);
  const code = dossierDestinationCode(dossier, client);
  return {
    dossier, client, envois: envois || [], now, today, planned, assignedId, assigned,
    assignedDay: isoCalendarDay(assigned?.date), wish, wishDay: wish?.day || null, destination: code, where: destinationName(code),
  };
}

/** One day of the grid: `kind` is past (before today, not selectable),
 * departure (a departure the dossier can join), closed (that day's departure
 * is closed or has left) or free (a day to come without departure); the
 * marks today, assigned (the dossier's departure) and wish (its desired day);
 * `label` is the accessible name (« jeudi 12 novembre, départ prévu, clôture
 * mercredi 11 novembre, 17 h »). */
export function calendarDay(day, context) {
  const { today, planned, dossier, client, envois, now, assignedDay, wishDay } = context;
  const envoiOfDay = departureForDate(planned, day);
  const existing = envoiOfDay ? null : departuresOfDay(dossier, client, envois, day)[0] || null;
  const kind = today && day < today ? 'past' : envoiOfDay ? 'departure' : existing ? 'closed' : 'free';
  const envoi = envoiOfDay || existing;
  const assigned = Boolean(assignedDay) && assignedDay === day;
  const wish = Boolean(wishDay) && wishDay === day;
  const parts = [departureDayLabel(day, { today: now })];
  if (kind === 'past') parts.push(assigned ? 'départ du dossier, jour passé' : 'jour passé');
  else if (kind === 'departure') parts.push(assigned ? 'départ du dossier' : 'départ prévu', departureClosingText(envoiOfDay, { now }));
  else if (kind === 'closed') parts.push(`${assigned ? 'départ du dossier, ' : ''}${closedDepartureWording(existing) === 'est déjà parti' ? 'départ déjà parti' : 'départ clôturé'}`);
  else parts.push(wish ? 'jour souhaité, aucun départ prévu' : 'aucun départ prévu');
  if (day === today) parts.push('aujourd’hui');
  return { day, number: Number(day.slice(8, 10)), kind, envoi, today: day === today, assigned, wish, label: parts.filter(Boolean).join(', ') };
}

/** The next departures the dossier can join, as one-click shortcuts. */
export function departureShortcuts(context, count = SHORTCUT_COUNT) {
  return context.planned.slice(0, count).map(envoi => ({
    envoi, day: envoi.date, current: envoi.id === context.assignedId,
    label: shortDayLabel(envoi.date), closing: departureClosingText(envoi, { now: context.now, short: true }),
    accessibleLabel: [departureDayLabel(envoi.date, { today: context.now }), envoi.id === context.assignedId ? 'départ du dossier' : 'départ prévu', departureClosingText(envoi, { now: context.now })].filter(Boolean).join(', '),
  }));
}

/** The first and last months the grid offers: from the current Paris month to
 * 18 months ahead, or further when a departure, the dossier's own or its
 * desired day is planned later. */
export function calendarMonthBounds(context) {
  const first = monthOf(context.today);
  const later = [addMonths(first, CALENDAR_MONTHS_AHEAD), ...context.planned.map(envoi => monthOf(envoi.date)), monthOf(context.assignedDay), monthOf(context.wishDay)];
  const sorted = later.filter(Boolean).sort();
  return { first, last: sorted[sorted.length - 1] };
}

const clampMonth = (month, { first, last }) => month < first ? first : month > last ? last : month;

/** The month the calendar opens on: the assigned departure's, else the desired
 * day's, else the next departure's, else the current month (never before it). */
export function initialCalendarMonth(context) {
  const day = context.assignedDay || context.wishDay || context.planned[0]?.date || context.today;
  return clampMonth(monthOf(day) || monthOf(context.today), calendarMonthBounds(context));
}

/** The day that holds the grid's focus in a month: the dossier's departure or
 * desired day, the next departure, today, else the first day to come. */
export function initialFocusDay(month, context) {
  const inMonth = day => Boolean(day) && monthOf(day) === month;
  const candidates = [context.assignedDay, context.wishDay, ...context.planned.map(envoi => envoi.date), context.today];
  const found = candidates.find(day => inMonth(day) && day >= context.today) || candidates.find(inMonth);
  if (found) return found;
  return month === monthOf(context.today) ? context.today : `${month}-01`;
}

/** The same day number in another month, within that month. */
export function sameDayInMonth(day, month) {
  return `${month}-${pad(Math.min(Number(day.slice(8, 10)), daysInMonth(month)))}`;
}

/** The day the grid's focus moves to for a key (WAI-ARIA date grid): arrows by
 * day and week, Home/End to the week's Monday/Sunday, PageUp/PageDown by
 * month (Shift: by year); null for another key. Kept within the offered months. */
export function moveCalendarFocus(day, key, context, { shift = false } = {}) {
  const bounds = calendarMonthBounds(context);
  const moved = {
    ArrowLeft: () => addDays(day, -1), ArrowRight: () => addDays(day, 1), ArrowUp: () => addDays(day, -7), ArrowDown: () => addDays(day, 7),
    Home: () => addDays(day, -weekdayIndex(day)), End: () => addDays(day, 6 - weekdayIndex(day)),
    PageUp: () => sameDayInMonth(day, addMonths(monthOf(day), shift ? -12 : -1)), PageDown: () => sameDayInMonth(day, addMonths(monthOf(day), shift ? 12 : 1)),
  }[key]?.();
  if (!moved) return null;
  const month = monthOf(moved);
  if (month < bounds.first) return `${bounds.first}-01`;
  if (month > bounds.last) return `${bounds.last}-${pad(daysInMonth(bounds.last))}`;
  return moved;
}

/** What a chosen day without a usable departure offers. A closed or departed
 * day only says so (`closed`); a day to come without departure proposes its
 * creation (aérien, closing on the habitual Wednesday 17 h) when the person
 * may create it and that closing is ahead, and keeping it as the desired day.
 * `replacing`: the dossier's current departure, which either choice replaces. */
export function dayProposal(day, context, { canCreate = false } = {}) {
  const info = calendarDay(day, context);
  const title = capitalize(departureDayLabel(day, { today: context.now }));
  if (info.kind === 'closed') return { day, kind: 'closed', title, message: `Le départ du ${departureDayLabel(day, { today: context.now })} ${closedDepartureWording(info.envoi)} : choisissez un autre jour.` };
  if (info.kind !== 'free') return null;
  const closing = departureDefaultClosing(day);
  const closingOpen = Date.parse(closing) > context.now;
  const create = Boolean(canCreate && context.where && closingOpen);
  const replacing = context.assigned ? departureDayLabel(context.assigned.date, { today: context.now }) || 'actuel' : null;
  const instead = replacing ? ` à la place du départ du ${replacing}` : '';
  return {
    day, kind: 'free', title, message: `${title} : aucun départ prévu`, create, keep: !(info.wish && !context.assigned),
    createLabel: `Créer ce départ (aérien) et y affecter le dossier${instead}`,
    keepLabel: `Garder comme date souhaitée${instead}`,
    closingText: create ? `clôture ${closingLabel(closing, { today: context.now })} (heure de Paris)` : null,
    note: !context.where ? 'Destination du client inconnue : complétez son code postal pour créer un départ.'
      : canCreate && !closingOpen ? 'La clôture de ce départ est déjà passée : gardez la date souhaitée ou choisissez un autre jour.' : null,
    replacing, closing,
  };
}

/** Why the server would refuse this departure for the dossier, or null. */
export function departureRefusal(envoi, context) {
  return departureIssue(envoi, context.dossier, context.client, context.now);
}
