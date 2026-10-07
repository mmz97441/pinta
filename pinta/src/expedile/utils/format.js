// ══════════ FORMATAGE ══════════
// Amounts and weights shown on screen: French format, with a no-break space
// before the unit so « 4,22 » and « € » never end up on two lines. Intl
// separates thousands with a narrow no-break space, like the other amounts of
// the interface (dossier table, payment page): « 1 234,50 € », « 19,5 kg ».
// Exports (PDF, Excel) keep their own documented formats.
const MONEY = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const WEIGHT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const PARIS_DATE_TIME = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' });

/** « 1 234,50 € ». A missing or invalid amount reads 0,00 € (never « -0,00 € »). */
export function eur(n) {
  const value = Number(n);
  return MONEY.format(Number.isFinite(value) && Math.abs(value) >= 0.005 ? value : 0);
}

/** « 19,5 kg », « 8 kg », « 2,67 kg »: at most two decimals. */
export function kg(n) {
  const value = Number(n);
  if (n === '' || n == null || !Number.isFinite(value)) return '— kg';
  return `${WEIGHT.format(Math.abs(value) >= 0.005 ? value : 0)} kg`;
}

/** Message text (Telegram, email): the Edge renderer _shared/messageTemplate.ts
 * writes amounts as « 76.08 € ». The browser preview must stay identical to the
 * delivered text, so both renderers change format together, never one alone. */
export function messageEur(n) {
  const value = Number(n);
  return `${(Number.isFinite(value) ? value : 0).toFixed(2)} €`;
}

/** « 6 octobre 2026 à 23:26 », Paris time, whatever the device's time zone. */
export function parisDateTime(value) {
  const time = typeof value === 'string' || typeof value === 'number' || value instanceof Date ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? PARIS_DATE_TIME.format(time) : null;
}
