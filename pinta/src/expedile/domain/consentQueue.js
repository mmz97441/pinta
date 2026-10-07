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
/** A relance whose delivery the server cancelled for another reason (the
 * dossier or the request changed before it left): it was never sent. */
export const CANCELLED_SEND_LABEL = 'Envoi annulé';
const QUEUE_STATUSES = new Set(['receptionne', 'mesure', 'attente_feu_vert']);
// notification_outbox states: a delivery still to come, and the end of a delivery that did not reach the client.
const TO_DELIVER = new Set(['pending', 'blocked', 'sending']);
const FAILED_SEND = 'failed', CANCELLED_SEND = 'cancelled';
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
 * latest relance_feu_vert the team wrote (staff messages only) from the latest
 * demande_feu_vert on (an older request's relances no longer count). Its
 * delivery is read from its notification_outbox row (`outboxStatus`,
 * `outboxSentAt`) when the data layer provides it, else from the message:
 * - delivered (outbox sent, or the message confirmed): `at` is the delivery
 *   instant when known, else the saved instant, and there is no label;
 * - cancelled by the server (outbox cancelled; its message stays « envoi »):
 *   « Annulée · attente du client » when the client chose to wait after it
 *   was queued (client_decision cancels the queued relances), « Envoi annulé »
 *   otherwise. Without the outbox row, a Telegram relance still « envoi » when
 *   the client chose to wait reads « Annulée · attente du client » too;
 * - failed (outbox failed, or the message « echec » without a delivery in
 *   progress): « Envoi non confirmé »;
 * - still to deliver (queued, blocked, rescheduled or being sent, including a
 *   retry): « En attente de livraison »; an e-mail draft: « Brouillon manuel ».
 * So a relance never reads as sent before it is, and a cancelled or failed one
 * never reads as awaiting delivery. Null when there is none. */
export function consentRelance(dossier) {
  if (dossier?.statut !== 'attente_feu_vert' || dossier.archive) return null;
  // A message the client wrote (messages.type is never empty in the database) is no request nor relance.
  const messages = (Array.isArray(dossier.messages) ? dossier.messages : []).filter(message => (message?.type ?? 'staff') === 'staff' && instant(message.createdAt) !== null);
  const requestedAt = Math.max(-Infinity, ...messages.filter(message => message.template === 'demande_feu_vert').map(message => instant(message.createdAt)));
  const latest = messages.filter(message => message.template === 'relance_feu_vert' && instant(message.createdAt) >= requestedAt)
    .reduce((last, message) => !last || instant(message.createdAt) >= instant(last.createdAt) ? message : last, null);
  if (!latest) return null;
  const outbox = latest.outboxStatus ?? null;
  const delivered = outbox === 'sent' || (outbox !== FAILED_SEND && outbox !== CANCELLED_SEND && !TO_DELIVER.has(outbox) && messageDelivered(latest));
  // client_decision('wait') cancels the pending and blocked relances; a manual
  // e-mail draft and a failed send keep their own state.
  const waitChosenAt = instant(dossier.attenteClientDate);
  const waitAfter = waitChosenAt !== null && waitChosenAt >= instant(latest.createdAt);
  const cancelled = !delivered && (outbox === CANCELLED_SEND || (outbox === null && latest.statut === 'envoi' && latest.canal !== 'email' && waitAfter));
  const deliveryLabel = delivered ? null
    : cancelled ? (outbox === CANCELLED_SEND && !waitAfter ? CANCELLED_SEND_LABEL : CANCELLED_RELANCE_LABEL)
      : outbox === FAILED_SEND ? messageDeliveryLabel({ statut: 'echec' })
        : TO_DELIVER.has(outbox) ? messageDeliveryLabel({ statut: 'envoi' })
          : messageDeliveryLabel(latest);
  const deliveredAt = delivered && outbox === 'sent' && instant(latest.outboxSentAt) !== null ? latest.outboxSentAt : null;
  return { at: deliveredAt || latest.createdAt, delivered, cancelled, deliveryLabel };
}
