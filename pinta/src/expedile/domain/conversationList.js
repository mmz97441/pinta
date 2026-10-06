import { conversationState } from './conversations.js';
import { urgency } from './workQueues.js';

// The team works on Paris time: days, hours and « hier » never follow the
// device's own time zone.
const PARIS = 'Europe/Paris';
const DAY = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit' });
const CLOCK = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, day: 'numeric', month: 'short' });
const SHORT_DATE_YEAR = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, day: 'numeric', month: 'short', year: 'numeric' });
const LONG_DATE = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long' });
const LONG_DATE_YEAR = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const URL_PATTERN = /https?:\/\/\S+/gi;
const SECTION_ORDER = { a_traiter: 0, attente_client: 1, termine: 2 };
const HANDLED_DECISIONS = ['client_decision_approve', 'client_decision_wait'];
const DELIVERED = ['envoye', 'distribue', 'lu'];

export const CHANNEL_LABELS = Object.freeze({ telegram: 'Telegram', portal: 'Espace client', email: 'E-mail' });

const time = value => { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : null; };
function parisDay(value) {
  const parts = Object.fromEntries(DAY.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return { key: `${parts.year}-${parts.month}-${parts.day}`, year: parts.year };
}
// A calendar day earlier, whatever the length of the day around a clock change.
function previousDayKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}
const capitalize = text => text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1);

export function clientDisplayName(client) {
  return (client?.nomFamille ? [client.prenom, client.nomFamille].filter(Boolean).join(' ') : client?.nom) || 'Client';
}
export function nameInitials(name = '') {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
  return letters.toLocaleUpperCase('fr-FR');
}

/** Host and path of a link, without the protocol, for reading only (the href keeps the full address). */
export function linkLabel(url, max = 40) {
  let label;
  try { const parsed = new URL(url); label = parsed.host.replace(/^www\./i, '') + parsed.pathname.replace(/\/$/, ''); }
  catch { label = String(url).replace(/^https?:\/\//i, ''); }
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** One readable line: line breaks and spaces collapse, addresses become « (lien) ». */
export function previewText(text = '') {
  return String(text || '').replace(URL_PATTERN, '(lien)').replace(/\s+/g, ' ').trim();
}

function staffAuthor(message, meId, teamUsers) {
  if (meId && message.auteurId === meId) return 'Vous';
  const person = message.auteurId ? teamUsers.find(user => user.authId === message.auteurId) : null;
  const name = person ? person.prenom || person.nom : !['Système', 'Expedîle'].includes(message.auteur) ? message.auteur : '';
  return String(name || '').trim().split(/\s+/)[0] || 'Équipe';
}

/** What the list shows of a conversation: the client's question while it is
 * « À répondre », otherwise the last exchange, never a template greeting. */
export function conversationPreview(dossier, { meId, teamUsers = [] } = {}) {
  const messages = dossier?.messages || [];
  const source = conversationState(dossier) === 'a_traiter'
    ? messages.findLast(message => message.type === 'client') || messages.at(-1)
    : messages.at(-1);
  if (!source) return { text: 'Documents reçus', fromStaff: false };
  const fromStaff = source.type === 'staff';
  // A staff template opens with « Bonjour {prénom} 👋 » on its own line.
  const body = fromStaff ? String(source.texte || '').replace(/^\s*bonjour\b[^\n]*\n+(?=\s*\S)/i, '') : source.texte;
  const text = previewText(body) || (source.attachmentPath ? 'Document reçu' : 'Documents reçus');
  return { text: fromStaff ? `${staffAuthor(source, meId, teamUsers)} : ${text}` : text, fromStaff };
}

/** Start of the client's wait: the opening of the conversation, else the first
 * client message after the last reply that reached the client. */
export function conversationSince(dossier) {
  if (dossier?.conversationOpenedAt) return dossier.conversationOpenedAt;
  const messages = dossier?.messages || [];
  const answered = messages.findLastIndex(message => message.type === 'staff' && DELIVERED.includes(message.statut));
  return messages.slice(answered + 1).find(message => message.type === 'client' && !HANDLED_DECISIONS.includes(message.template))?.createdAt || null;
}

/** Same rule as the work queues: a reply waiting for 7 days is overdue. */
export function conversationOverdue(dossier, now = Date.now()) {
  return conversationState(dossier) === 'a_traiter' && urgency({ ...dossier, conversationOpenedAt: conversationSince(dossier) }, now).overdue;
}

/** « 8 min », « 5 h », « 2 j » since a moment, for « depuis … ». */
export function waitingAge(value, now = Date.now()) {
  const start = time(value);
  if (start === null) return '';
  const minutes = Math.max(1, Math.floor((now - start) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} j`;
}

/** « 07:31 » today, « hier », then « 4 oct. ». */
export function conversationTime(value, now = Date.now()) {
  if (time(value) === null) return '';
  const day = parisDay(value), today = parisDay(now);
  if (day.key === today.key) return CLOCK.format(new Date(value));
  if (day.key === previousDayKey(today.key)) return 'hier';
  return (day.year === today.year ? SHORT_DATE : SHORT_DATE_YEAR).format(new Date(value));
}

/** Day separator of a thread: « Aujourd’hui », « Hier », « Samedi 4 octobre ». */
export function conversationDay(value, now = Date.now()) {
  if (time(value) === null) return '';
  const day = parisDay(value), today = parisDay(now);
  if (day.key === today.key) return 'Aujourd’hui';
  if (day.key === previousDayKey(today.key)) return 'Hier';
  return capitalize((day.year === today.year ? LONG_DATE : LONG_DATE_YEAR).format(new Date(value)));
}
export function conversationDayKey(value) { return time(value) === null ? '' : parisDay(value).key; }
export function conversationClock(value) { return time(value) === null ? '' : CLOCK.format(new Date(value)); }

/** Sections in reading order. « À répondre »: the oldest wait first, so a new
 * message never makes an old request look recent. The others: latest activity first. */
export function sortConversations(dossiers = []) {
  const updated = dossier => time(dossier.conversationUpdatedAt || dossier.updatedAt) ?? -Infinity;
  return [...dossiers].sort((a, b) => {
    const stateA = conversationState(a), stateB = conversationState(b);
    if (stateA !== stateB) return SECTION_ORDER[stateA] - SECTION_ORDER[stateB];
    const order = stateA === 'a_traiter'
      ? (time(conversationSince(a)) ?? Infinity) - (time(conversationSince(b)) ?? Infinity)
      : updated(b) - updated(a);
    return order || String(a.ref || a.id).localeCompare(String(b.ref || b.id));
  });
}
