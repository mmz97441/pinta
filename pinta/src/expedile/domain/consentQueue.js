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
/** A dated wait whose day has passed: still the client's wait (`client_waiting`),
 * now to re-examine, as the server task « Réexaminer l’attente client » says. */
export const CONSENT_WAIT_OVER_LABEL = 'Attente terminée';
/** Every wording of the « Accord » column, for its exact-value filter. */
export const CONSENT_LABELS = Object.freeze([...Object.values(CONSENT_STAGE_LABELS), CONSENT_WAIT_OVER_LABEL]);
/** A relance still queued when the client chose to wait: the server cancelled
 * its delivery (client_decision), so it was never sent. */
export const CANCELLED_RELANCE_LABEL = 'Annulée · attente du client';
const QUEUE_STATUSES = new Set(['receptionne', 'mesure', 'attente_feu_vert']);
// The table's business calendar (formatDossierTableDate), without the year.
const WAIT_DAY = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Indian/Reunion' });
const instant = value => { const time = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(time) ? time : null; };
const moment = now => now instanceof Date ? now.getTime() : Number.isFinite(Number(now)) ? Number(now) : Date.now();

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
 * client dated, its end (`until`, the saved instant). Once that day has passed
 * (`over`), the wait reads « Attente terminée », to re-examine. Null outside
 * the queue. */
export function consentState(dossier, now = Date.now()) {
  const stage = consentStage(dossier);
  if (!stage) return null;
  const end = stage === 'client_waiting' ? instant(dossier.attenteClientUntil) : null;
  const over = end !== null && end <= moment(now);
  return { stage, label: over ? CONSENT_WAIT_OVER_LABEL : CONSENT_STAGE_LABELS[stage], until: end !== null ? dossier.attenteClientUntil : null, over };
}

/** « jusqu’au 25/10 », the end of a dated wait, or « le 25/10 · à réexaminer »
 * once it has passed; null without a readable date. */
export function consentWaitLabel(until, { over = false } = {}) {
  const time = instant(until);
  if (time === null) return null;
  const day = WAIT_DAY.format(new Date(time));
  return over ? `le ${day} · à réexaminer` : `jusqu’au ${day}`;
}

/** The « Accord » on one line, as the export writes it: « Le client attend ·
 * jusqu’au 25/10 », « Attente terminée le 25/10 · à réexaminer ». */
export function consentSummary(consent) {
  if (!consent) return '';
  const end = consentWaitLabel(consent.until, { over: consent.over });
  if (!end) return consent.label;
  return consent.over ? `${consent.label} ${end}` : `${consent.label} · ${end}`;
}

/** The last relance of the current request while the answer is awaited: the
 * latest relance_feu_vert message from the latest demande_feu_vert on (an older
 * request's relances no longer count). `at` is its saved instant; until Telegram
 * or the portal confirmed it, `deliveryLabel` says where it stands (« En
 * attente de livraison », « Envoi non confirmé », « Brouillon manuel »), so a
 * relance never reads as sent before it is. A Telegram relance still queued
 * when the client chose to wait was cancelled by the server (`cancelled`,
 * « Annulée · attente du client »): it never reads as awaiting delivery. Null
 * when there is none. */
export function consentRelance(dossier) {
  if (dossier?.statut !== 'attente_feu_vert' || dossier.archive) return null;
  const messages = (Array.isArray(dossier.messages) ? dossier.messages : []).filter(message => instant(message?.createdAt) !== null);
  const requestedAt = Math.max(-Infinity, ...messages.filter(message => message.template === 'demande_feu_vert').map(message => instant(message.createdAt)));
  const latest = messages.filter(message => message.template === 'relance_feu_vert' && instant(message.createdAt) >= requestedAt)
    .reduce((last, message) => !last || instant(message.createdAt) >= instant(last.createdAt) ? message : last, null);
  if (!latest) return null;
  const delivered = messageDelivered(latest);
  // client_decision('wait') cancels the pending and blocked relances; a manual
  // e-mail draft and a failed send keep their own state.
  const waitChosenAt = instant(dossier.attenteClientDate);
  const cancelled = !delivered && latest.statut === 'envoi' && latest.canal !== 'email'
    && waitChosenAt !== null && waitChosenAt >= instant(latest.createdAt);
  return { at: latest.createdAt, delivered, cancelled, deliveryLabel: delivered ? null : cancelled ? CANCELLED_RELANCE_LABEL : messageDeliveryLabel(latest) };
}
