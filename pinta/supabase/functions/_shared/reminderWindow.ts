// Both dates must identify an instant explicitly. Do not infer the server's
// local timezone from a date-only value entered in settings.
export function reminderTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = parts;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Date.parse otherwise silently normalizes February 30 or 24:00 into a
  // different date, which must not silently activate reminder generation.
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isReminderInActiveWindow(since: unknown, activeSince: unknown, now = Date.now()): boolean {
  const requested = reminderTimestamp(since);
  const activation = reminderTimestamp(activeSince);
  return requested !== null && activation !== null && Number.isFinite(now)
    && requested >= activation && requested <= now;
}
