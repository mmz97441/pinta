import { hasVoluntaryWait } from './workQueues.js';
import { messageDelivered, messageDeliveryLabel } from './conversations.js';

// « Accords clients »: the dossiers whose consent is still to obtain, and what
// the list says about each of them. Pure: nothing here writes or sends.

/** The three states of the tab, in the order of the journey. */
export const CONSENT_STAGE_LABELS = Object.freeze({
  to_submit: 'À soumettre',
  awaiting_reply: 'Réponse attendue',
  client_waiting: 'Le client attend',
});
const QUEUE_STATUSES = new Set(['receptionne', 'mesure', 'attente_feu_vert']);
// The table's business calendar (formatDossierTableDate), without the year.
const WAIT_DAY = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Indian/Reunion' });
const instant = value => { const time = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(time) ? time : null; };

/** The dossiers of « Accords clients »: received, measured or awaiting the
 * client's answer, archives excluded, in their incoming order. It is the one
 * dossier view that restricts its rows: buildDossierTableModel never filters,
 * so the list applies this before counting, suggesting or exporting. */
export function consentQueueFilter(dossiers = []) {
  return (dossiers || []).filter(dossier => Boolean(dossier) && !dossier.archive && QUEUE_STATUSES.has(dossier.statut));
}

/** to_submit (received or measured), awaiting_reply (the request is with the
 * client), client_waiting (the client chose to wait); null outside the queue. */
export function consentStage(dossier) {
  if (!dossier || dossier.archive || !QUEUE_STATUSES.has(dossier.statut)) return null;
  if (dossier.statut !== 'attente_feu_vert') return 'to_submit';
  return hasVoluntaryWait(dossier) ? 'client_waiting' : 'awaiting_reply';
}

/** The « Accord » of a dossier: its stage, its wording and, for a wait the
 * client dated, its end (`until`, the saved instant). Null outside the queue. */
export function consentState(dossier) {
  const stage = consentStage(dossier);
  if (!stage) return null;
  const until = stage === 'client_waiting' && instant(dossier.attenteClientUntil) !== null ? dossier.attenteClientUntil : null;
  return { stage, label: CONSENT_STAGE_LABELS[stage], until };
}

/** « jusqu’au 25/10 », the end of a dated wait; null without a readable date. */
export function consentWaitLabel(until) {
  const time = instant(until);
  return time === null ? null : `jusqu’au ${WAIT_DAY.format(new Date(time))}`;
}

/** The last relance of the current request while the answer is awaited: the
 * latest relance_feu_vert message from the latest demande_feu_vert on (an older
 * request's relances no longer count). `at` is its saved instant; until Telegram
 * or the portal confirmed it, `deliveryLabel` says where it stands (« En
 * attente de livraison », « Envoi non confirmé », « Brouillon manuel »), so a
 * relance never reads as sent before it is. Null when there is none. */
export function consentRelance(dossier) {
  if (dossier?.statut !== 'attente_feu_vert' || dossier.archive) return null;
  const messages = (Array.isArray(dossier.messages) ? dossier.messages : []).filter(message => instant(message?.createdAt) !== null);
  const requestedAt = Math.max(-Infinity, ...messages.filter(message => message.template === 'demande_feu_vert').map(message => instant(message.createdAt)));
  const latest = messages.filter(message => message.template === 'relance_feu_vert' && instant(message.createdAt) >= requestedAt)
    .reduce((last, message) => !last || instant(message.createdAt) >= instant(last.createdAt) ? message : last, null);
  if (!latest) return null;
  const delivered = messageDelivered(latest);
  return { at: latest.createdAt, delivered, deliveryLabel: delivered ? null : messageDeliveryLabel(latest) };
}
