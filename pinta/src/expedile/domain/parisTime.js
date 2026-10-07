import { isoCalendarDay, parisCalendarDay } from './departureGroups.js';
import { parisInstant } from './departurePlanning.js';

// Paris wall time for the screens where a person reads or types a time: the
// « Départs » page and the monthly recap follow Europe/Paris whatever the
// device's own time zone (Réunion, New York…), across both clock changes.
// Nothing here writes.

const PARIS = 'Europe/Paris';
const DAY = 86400000;
const WALL_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: PARIS, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
// A datetime-local value: « 2026-10-21T17:00 » (seconds, when a browser adds them, are zero).
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::00(?:\.0{1,3})?)?$/;

const instantOf = value => {
  if (value === null || value === undefined || value === '') return null;
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : null;
};

/** « 2026-10-21T17:00 »: the Paris wall time of an instant, as a
 * datetime-local field shows it; '' without a valid instant. */
export function parisDateTimeInput(value) {
  const time = instantOf(value);
  if (time === null) return '';
  const parts = Object.fromEntries(WALL_TIME.formatToParts(new Date(time)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The ISO instant of a Paris wall time typed « 2026-10-21T17:00 » (a
 * datetime-local value), or null when the text is not such a time or when that
 * time does not exist in Paris (the hour skipped in spring). An autumn time
 * that occurs twice is read once the clocks have gone back (winter time). */
export function parisDateTimeInstant(text) {
  const match = typeof text === 'string' ? text.trim().match(DATE_TIME) : null;
  if (!match) return null;
  const [, day, hourText, minuteText] = match;
  const hour = Number(hourText), minute = Number(minuteText);
  if (!isoCalendarDay(day) || hour > 23 || minute > 59) return null;
  const instant = parisInstant(day, hour, minute);
  // The wall time read back must be the one typed: otherwise it does not exist in Paris.
  return instant !== null && parisDateTimeInput(instant) === `${day}T${hourText}:${minuteText}` ? new Date(instant).toISOString() : null;
}

/** A calendar day (YYYY-MM-DD) moved by a whole number of days, or null. */
export function addCalendarDays(value, count) {
  const day = isoCalendarDay(value);
  if (!day || !Number.isInteger(count)) return null;
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);
}

/** The same Paris wall time `days` days later (« 2026-10-21T17:00 » + 7 →
 * « 2026-10-28T17:00 »): a weekly series keeps its hour in Paris across a clock
 * change. Null for a text that is not a datetime-local value. */
export function shiftParisDateTime(text, days) {
  const match = typeof text === 'string' ? text.trim().match(DATE_TIME) : null;
  const day = match ? addCalendarDays(match[1], days) : null;
  return day ? `${day}T${match[2]}:${match[3]}` : null;
}

/** `{ year, month }` (month 0–11) of the Paris calendar day of an instant; a
 * calendar day (YYYY-MM-DD) is read as it is. Null without a date. */
export function parisMonth(value) {
  if (value === null || value === undefined || value === '') return null;
  const day = parisCalendarDay(value);
  return day ? { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) - 1 } : null;
}

/** « 30/09/2026 »: the Paris calendar day of an instant (a calendar day as it
 * is), or '' without a date. */
export function parisDateLabel(value) {
  if (value === null || value === undefined || value === '') return '';
  const day = parisCalendarDay(value);
  return day ? day.split('-').reverse().join('/') : '';
}
