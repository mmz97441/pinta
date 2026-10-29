// The automatic reminders of an awaited agreement, as the scheduled worker sends them (migration
// 20261029000001_consent_automation.sql, consent_reminders_due; supabase/functions/_shared/consentReminders.ts).
// app_settings.business.relancesAccordAuto = { actif, depuis, premiereApresHeures, suivanteApresHeures, nombreMax }:
// reminder n° 1 is due premiereApresHeures after the request reached the client on Telegram, n° k+1
// suivanteApresHeures after reminder n° k reached him, nombreMax at most (a relance the team sent counts), for the
// requests delivered since `depuis`. It leaves between 8 h and 20 h at the client's destination, never while the
// client's conversation waits for the team. The screens only show it: the server decides. Pure: no React, no network.

const HOUR = 3600 * 1000;
const CONSENT_MESSAGES = new Set(['demande_feu_vert', 'relance_feu_vert']);
const TO_DELIVER = new Set(['pending', 'blocked', 'sending']);
const UNDELIVERED = new Set(['failed', 'cancelled']);
// The hours a reminder may leave, at the client's destination (SENDING_HOURS of the worker).
export const REMINDER_SENDING_HOURS = Object.freeze({ from: 8, to: 20 });
const ZONES = Object.freeze({ 974: 'Indian/Reunion', 976: 'Indian/Mayotte', 971: 'America/Guadeloupe', 972: 'America/Martinique' });

const instantOf = value => {
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};
// The server's telegram_chat_id ~ '[^[:space:]]': any character that is not a blank.
const filled = value => value != null && /\S/.test(String(value));

/** The settings of the automatic reminders: { since, first, next, max } (instant, hours, hours, count), or null when
 * they are off, absent or unreadable — then nothing leaves on its own (the server's rule: fails closed). */
export function autoReminderSettings(settings) {
  const config = settings?.relancesAccordAuto;
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.actif !== true) return null;
  const since = instantOf(config.depuis);
  const first = Number(config.premiereApresHeures);
  const next = Number(config.suivanteApresHeures);
  const max = Number(config.nombreMax);
  const hours = value => Number.isFinite(value) && value > 0;
  if (since === null || !hours(first) || !hours(next) || !Number.isInteger(max) || max < 1 || max > 5) return null;
  return { since, first, next, max };
}

const hoursLabel = value => `${String(value).replace('.', ',')} h`;
/** « une relance part automatiquement 48 h après la demande, puis une seconde 24 h plus tard », or null when off. */
export function autoReminderWording(settings) {
  const config = autoReminderSettings(settings);
  if (!config) return null;
  const first = `une relance part automatiquement ${hoursLabel(config.first)} après la demande`;
  if (config.max === 1) return first;
  if (config.max === 2) return `${first}, puis une seconde ${hoursLabel(config.next)} plus tard`;
  return `${first}, puis toutes les ${hoursLabel(config.next)}, ${config.max} au plus`;
}

/** The destination of a client as the worker reads it: the first three digits of the postal code. */
export function reminderDestinationCode(client) {
  return String(client?.cp ?? '').replace(/\D/g, '').slice(0, 3);
}

/** The hour (0-23) at the destination (La Réunion when unknown), as the worker reads it. */
export function destinationHour(destinationCode, instant) {
  const zone = ZONES[String(destinationCode || '')] || ZONES[974];
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(instant));
  return Number(parts.find(part => part.type === 'hour')?.value) % 24;
}

/** The first instant from `due` on when a reminder may leave (8 h to 20 h at the destination). */
export function reminderSendingInstant(due, destinationCode) {
  let at = due;
  for (let step = 0; step < 48; step += 1) {
    const hour = destinationHour(destinationCode, at);
    if (hour >= REMINDER_SENDING_HOURS.from && hour < REMINDER_SENDING_HOURS.to) return at;
    // The destinations' offsets are whole hours: the next hour of UTC is the next hour there.
    at = Math.floor(at / HOUR) * HOUR + HOUR;
  }
  return at;
}

const latestByCreation = messages => messages.reduce((last, message) => {
  if (!last) return message;
  const time = instantOf(message.createdAt), lastTime = instantOf(last.createdAt);
  return time > lastTime || time === lastTime && String(message.id) > String(last.id) ? message : last;
}, null);

/**
 * The automatic reminders of one dossier waiting for its client's agreement, mirror of consent_reminders_due:
 * { sent, max, exhausted, nextAt, due, suspended } — `sent` the reminders delivered since the request (the team's
 * count), `nextAt` (ISO) when the next one may leave (null once `exhausted`), `due` it may leave now, `suspended`
 * 'conversation' while a conversation of the client waits for the team (`openConversationClients`: the ids of those
 * clients; the client's unassigned inbox, which the screens do not read, suspends it too). null when no reminder will
 * leave on its own: settings off, the client without Telegram, a wait chosen, the request not delivered (or before
 * the settings' start), a request or relance still to deliver, failed or cancelled since.
 * The request of the current version is read as the latest request (a new version always comes with a new request).
 */
export function autoReminderPlan(dossier, { client, settings, now = Date.now(), openConversationClients = null } = {}) {
  const config = autoReminderSettings(settings);
  if (!config || !dossier || dossier.statut !== 'attente_feu_vert' || dossier.archive || dossier.paiementDate || dossier.attenteClientDate) return null;
  if (!filled(client?.telegramChatId)) return null;
  const consent = (Array.isArray(dossier.messages) ? dossier.messages : [])
    .filter(message => (message?.type ?? 'staff') === 'staff' && CONSENT_MESSAGES.has(message.template) && message.canal === 'telegram' && instantOf(message.createdAt) !== null);
  const request = latestByCreation(consent.filter(message => message.template === 'demande_feu_vert'));
  const requestAt = request?.outboxStatus === 'sent' ? instantOf(request.outboxSentAt) : null;
  if (requestAt === null || requestAt < config.since) return null;
  const current = consent.filter(message => instantOf(message.createdAt) >= instantOf(request.createdAt));
  if (current.some(message => TO_DELIVER.has(message.outboxStatus))) return null;
  if (consent.some(message => UNDELIVERED.has(message.outboxStatus) && instantOf(message.createdAt) >= requestAt)) return null;
  const delivered = consent.filter(message => message.template === 'relance_feu_vert' && message.outboxStatus === 'sent' && (instantOf(message.outboxSentAt) ?? -Infinity) >= requestAt)
    .map(message => instantOf(message.outboxSentAt));
  const sent = delivered.length;
  if (sent >= config.max) return { sent, max: config.max, exhausted: true, nextAt: null, due: false, suspended: null };
  const dueAt = sent ? Math.max(...delivered) + config.next * HOUR : requestAt + config.first * HOUR;
  const at = instantOf(now) ?? Date.now();
  // Due already: it leaves at the worker's next run (every few minutes), or at 8 h at the destination.
  const nextAt = reminderSendingInstant(Math.max(dueAt, at), reminderDestinationCode(client));
  const suspended = openConversationClients?.has?.(dossier.clientId) ? 'conversation' : null;
  return { sent, max: config.max, exhausted: false, nextAt: new Date(nextAt).toISOString(), due: nextAt <= at, suspended };
}

/** The clients whose conversation waits for the team (a dossier « à traiter », not archived): the server's
 * client_has_open_conversation, without the unassigned inbox the screens do not read. */
export function openConversationClients(dossiers) {
  return new Set((Array.isArray(dossiers) ? dossiers : [])
    .filter(dossier => dossier && !dossier.archive && dossier.conversationStatut === 'a_traiter' && dossier.clientId).map(dossier => dossier.clientId));
}
