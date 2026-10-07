import { calendarDateLabel, departureDayLabel, isoCalendarDay } from './departureGroups.js';
import { OPEN_DEPARTURE_STATUSES, closedDepartureWording, closingLabel, consentRelanceOpen, destinationName, dossierDepartureClosing, dossierDestinationCode, dossierWishState } from './departurePlanning.js';
import { dossierTaskUrl } from './dossierTasks.js';
import { paymentRecorded } from './invoiceLock.js';
import { subscriptionEndDay } from './clientPlan.js';

// « À vérifier » on a dossier: what the team checks with the client. These are
// pointers only: nothing here blocks a step, writes or sends a message.

// The dossier has not left yet: the steps before « expedie » in the journey.
const BEFORE_DEPARTURE = new Set(['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye']);
// The fields every client record needs (decided on 2026-10-07), in the order the
// client page completes them: `key` is its `completer` parameter. `payment`: also
// required by payplug-create before creating a payment link, with the same
// alternatives (its `nom` is the family name).
const CLIENT_FIELDS = Object.freeze([
  { key: 'prenom', label: 'le prénom', values: client => [client.prenom] },
  { key: 'nom', label: 'le nom', payment: true, values: client => [client.nomFamille ?? client.nom] },
  { key: 'email', label: 'l’email', payment: true, values: client => [client.email] },
  { key: 'telephone', label: 'le téléphone', values: client => [client.tel, client.telFixe] },
  { key: 'adresse', label: 'l’adresse', payment: true, values: client => [client.adresse, client.adresseLigne1] },
  { key: 'cp', label: 'le code postal', payment: true, values: client => [client.cp] },
  { key: 'ville', label: 'la ville', payment: true, values: client => [client.ville, client.commune] },
]);
// « l’email et le code postal », « le nom, l’email et la ville ».
const frenchList = items => items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}` : items.join('');
const filled = value => String(value ?? '').trim() !== '';
const ORIGIN = 'https://expedile.invalid';

/** The dossier page as displayed (its tab, task and way back are kept), or
 * its plain address when `dossierUrl` is not this dossier's page. */
function dossierPage(dossier, dossierUrl) {
  const path = `/colis/${encodeURIComponent(dossier.id)}`;
  try {
    const url = new URL(dossierUrl || path, ORIGIN);
    if (url.origin === ORIGIN && url.pathname === path) return url;
  } catch { /* the plain address below */ }
  return new URL(path, ORIGIN);
}

/** The client's departure falls after the end of their subscription:
 * `{ departureDay, endDay }` (YYYY-MM-DD), otherwise null. */
export function departureAfterSubscription(envoi, client) {
  const departureDay = isoCalendarDay(envoi?.date);
  const endDay = subscriptionEndDay(client);
  return departureDay && endDay && departureDay > endDay ? { departureDay, endDay } : null;
}

const firstName = client => [client.prenom, client.raisonSociale, client.nom].find(filled)?.trim() || 'ce client';

/** Asked before assigning a departure after the end of the client's
 * subscription; null when the departure is within it. Confirming proceeds. */
export function subscriptionEndConfirmation(envoi, client, { today = Date.now() } = {}) {
  const late = departureAfterSubscription(envoi, client);
  return late ? {
    title: 'Affecter quand même ?',
    message: `Le départ du ${departureDayLabel(late.departureDay, { today })} est après la fin de l’abonnement de ${firstName(client)} (${calendarDateLabel(late.endDay, { today })}).`,
    okLabel: 'Affecter quand même',
  } : null;
}

const CLOSED = new Set(['livre', 'refuse_client', 'annule']);
// The consent is still to obtain: to submit (receptionne, mesure) or awaited.
const BEFORE_CONSENT = new Set(['receptionne', 'mesure', 'attente_feu_vert']);
const CONSENT_REQUESTS = new Set(['demande_feu_vert', 'relance_feu_vert']);
const FOLLOW_UP = 24 * 3600000;
// The states of a notification_outbox row: a delivery still to come (queued, blocked by an open conversation,
// rescheduled by the 24-hour client rule, or being sent), and one that will not reach the client.
const TO_DELIVER = new Set(['pending', 'blocked', 'sending']);
const UNDELIVERED = new Set(['failed', 'cancelled']);
const OPEN_DEPARTURE = new Set(OPEN_DEPARTURE_STATUSES);
const instantOf = value => {
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : null;
};

/** The follow-up of the dossier's latest consent request or relance written
 * by the team (a staff demande_feu_vert or relance_feu_vert message; a client's
 * message never counts), as the server's _consent_followup_until computes it
 * from its delivery (`outboxStatus` and `outboxSentAt`, its notification_outbox
 * row, when the data layer provides them):
 * - its delivery failed or was cancelled (outbox failed or cancelled, or the
 *   message « echec » without a delivery in progress): null, the relance is due;
 * - its delivery is still to come (outbox pending, blocked, rescheduled or
 *   sending): it holds until delivered, `{ at, until: null, pending: true }`;
 * - delivered (outbox sent): 24 hours from the delivery;
 * - an e-mail draft (outbox manual) or a portal message: 24 hours from its
 *   creation (the team acted; no delivery is claimed).
 * `at` is the message's saved instant and `until` the end of its 24 hours (ISO);
 * null once they have passed. Only the latest one counts: a failed relance is
 * not covered by an earlier delivered request. */
export function consentFollowUp(dossier, now = Date.now()) {
  const instant = instantOf(now);
  if (instant === null) return null;
  const latest = (Array.isArray(dossier?.messages) ? dossier.messages : [])
    // messages.type is never empty in the database: a message the client wrote is no request.
    .filter(message => (message?.type ?? 'staff') === 'staff' && CONSENT_REQUESTS.has(message.template) && instantOf(message.createdAt ?? NaN) !== null)
    .reduce((last, message) => {
      if (!last) return message;
      const time = instantOf(message.createdAt), lastTime = instantOf(last.createdAt);
      return time > lastTime || time === lastTime && String(message.id) > String(last.id) ? message : last;
    }, null);
  if (!latest || UNDELIVERED.has(latest.outboxStatus)) return null;
  if (TO_DELIVER.has(latest.outboxStatus)) return { at: latest.createdAt, until: null, pending: true };
  if (latest.statut === 'echec') return null;
  const delivered = latest.outboxStatus === 'sent' ? instantOf(latest.outboxSentAt ?? NaN) : null;
  const until = (delivered ?? instantOf(latest.createdAt)) + FOLLOW_UP;
  return instant < until ? { at: latest.createdAt, until: new Date(until).toISOString(), pending: false } : null;
}

/** The departure, assigned or planned on the desired day, can no longer take
 * the dossier: it has left, is archived or its day's departure is closed (the
 * server's _colis_departure_closing then gives no closing). */
function departureClosed(dossier, departure, now, client, envois) {
  if (dossier.envoi || dossier.envoiId) return Boolean(departure) && (Boolean(departure.departedAt) || !OPEN_DEPARTURE.has(departure.statut));
  const wish = dossierWishState(dossier, client, envois, now);
  return wish?.state === 'closed' || wish?.state === 'past';
}

/** The consent still missing while the dossier's departure closes within 48 h
 * (the server's _reception_work_hint): `{ closing, day, habitual }` (closing
 * instant, departure day, a habitual Wednesday closing), otherwise null. A
 * voluntary wait of the client is respected, an awaited consent is not
 * relanced while its latest request or relance is followed up, and a departure
 * that has left or is closed asks for another departure, never for consent
 * before a closing that cannot be met. */
function consentBeforeCutoff(dossier, departure, now, client, envois) {
  if (!BEFORE_CONSENT.has(dossier.statut)) return null;
  if (dossier.statut === 'attente_feu_vert' && (dossier.attenteClientDate || consentFollowUp(dossier, now))) return null;
  if (departureClosed(dossier, departure, now, client, envois)) return null;
  const planned = dossierDepartureClosing(dossier, departure, { client, envois, now });
  return planned?.day && consentRelanceOpen(planned.closing, now) ? planned : null;
}

/** The ordered list of `{ key, text, action: { label, href } }` for a dossier:
 * 1. `no_contact`: no client space and no Telegram, while the dossier is open;
 * 2. `client_incomplete`: the client record misses a field every record needs
 *    (prénom, nom, email, téléphone, adresse, code postal, ville), all listed.
 *    It reads « pour le paiement en ligne » when the online payment of an
 *    individual is still to come and every missing field is one payplug-create
 *    requires. « Compléter la fiche » opens the client page on the first missing
 *    field (`completer`);
 * 3. `consent_before_cutoff`: the consent is missing (to ask, or awaited without
 *    a voluntary wait nor a request or relance followed up for 24 hours) and its
 *    departure closes within 48 hours; its `step` is the task that handles it:
 *    `reception` (cartons to measure first) or `accord`;
 * 4. `departure_to_create`: its desired day needs a departure: none is planned
 *    that day (« Choisir ou créer le départ »), that day's departure is closed
 *    or has left, or the day has passed (« Choisir un autre départ »); or
 *    `departure_to_assign`: a departure the dossier can join is planned on its
 *    desired day, the dossier still has none (« Affecter au départ »);
 * 5. `after_subscription`: its departure, or its desired day, is after the end
 *    of the subscription, before the dossier leaves.
 * `envoi` is the dossier's departure and `envois` the departures the person can
 * read. `today` is the instant of the check. `dossierUrl` is the dossier page as
 * displayed: the client page leads back to it, « Écrire au client » opens its
 * Conversation tab, the desired-day links its Départ field and the consent
 * links its reception or accord task, each with the same way back to the list. */
export function dossierAlerts({ dossier, client, envoi, envois = [], today = Date.now(), dossierUrl } = {}) {
  if (!dossier?.id || !client?.id) return [];
  // A closed dossier (archived, delivered, refused or cancelled) asks for nothing.
  if (dossier.archive || CLOSED.has(dossier.statut)) return [];
  const noContact = !client.userId && !client.telegramChatId;
  const missing = CLIENT_FIELDS.filter(field => !field.values(client).some(filled));
  // Said « pour le paiement en ligne » only when that is true of every missing field.
  const forPayment = client.type !== 'pro' && !paymentRecorded(dossier) && missing.every(field => field.payment);
  const departure = envoi && envoi.id === (dossier.envoi || dossier.envoiId) ? envoi : null;
  const beforeDeparture = BEFORE_DEPARTURE.has(dossier.statut);
  // What the desired day stands for, against every departure the person can read that day.
  const wish = beforeDeparture ? dossierWishState(dossier, client, envois, today) : null;
  const cutoff = consentBeforeCutoff(dossier, departure, today, client, envois);
  const toCreate = wish && wish.state !== 'planned' ? wish : null;
  const toAssign = wish && wish.state === 'planned' ? wish : null;
  const late = beforeDeparture ? departureAfterSubscription(departure || (wish ? { date: wish.day } : null), client) : null;
  // The list asks every dossier: links are built only when something applies.
  if (!noContact && !missing.length && !cutoff && !toCreate && !toAssign && !late) return [];
  const page = dossierPage(dossier, dossierUrl);
  const returnTo = page.pathname + page.search;
  const clientPath = `/clients/${encodeURIComponent(client.id)}`;
  const alerts = [];
  if (noContact) alerts.push({
    key: 'no_contact',
    text: 'Le client n’a ni espace client ni Telegram : il ne reçoit pas nos messages.',
    action: { label: 'Inviter le client', href: `${clientPath}?${new URLSearchParams({ returnTo })}` },
  });
  if (missing.length) alerts.push({
    key: 'client_incomplete',
    text: `Fiche client incomplète${forPayment ? ' pour le paiement en ligne' : ''} : il manque ${frenchList(missing.map(field => field.label))}.`,
    // The client page opens its form on the first missing field, then leads back to the dossier.
    action: { label: 'Compléter la fiche', href: `${clientPath}?${new URLSearchParams({ completer: missing[0].key, returnTo })}` },
  });
  if (cutoff) {
    // Received but not measured: the cartons are measured first, then the consent asked (the server hint
    // « Mesurer puis demander l’accord avant la clôture du départ »), from the reception task.
    const measure = dossier.statut === 'receptionne';
    // Without a loading closing of its own, the Wednesday 17 h is the habitual closing, not a cut-off.
    const before = `${closingLabel(cutoff.closing, { today })} (clôture${cutoff.habitual ? ' habituelle' : ''} du départ du ${departureDayLabel(cutoff.day, { today })})`;
    alerts.push({
      key: 'consent_before_cutoff',
      step: measure ? 'reception' : 'accord',
      text: measure ? `Cartons à mesurer puis accord du client à demander avant ${before}.` : `Accord du client à obtenir avant ${before}.`,
      action: {
        label: measure ? 'Mesurer les cartons' : dossier.statut === 'attente_feu_vert' ? 'Relancer le client' : 'Demander l’accord',
        href: dossierTaskUrl(dossier.id, measure ? 'reception' : 'accord', page.search, { hash: 'dossier-work' }),
      },
    });
  }
  if (toCreate || toAssign) {
    const departurePage = new URLSearchParams(page.search);
    departurePage.delete('onglet');
    departurePage.set('modifier', 'depart');
    const href = `${page.pathname}?${departurePage}`;
    if (toAssign) alerts.push({
      key: 'departure_to_assign',
      text: `Un départ est prévu le ${departureDayLabel(toAssign.day, { today })}, jour souhaité : affectez-y le dossier.`,
      action: { label: 'Affecter au départ', href },
    });
    else {
      const where = destinationName(dossierDestinationCode(dossier, client));
      const day = departureDayLabel(toCreate.day, { today });
      alerts.push({
        key: 'departure_to_create',
        text: toCreate.state === 'past' ? `Départ souhaité le ${day} : cette date est passée.`
          : toCreate.state === 'closed' ? `Départ souhaité le ${day} : le départ de ce jour${where ? ` pour ${where}` : ''} ${closedDepartureWording(toCreate.envoi)}.`
            : `Départ souhaité le ${day} : aucun départ n’est prévu ce jour-là${where ? ` pour ${where}` : ''}.`,
        action: { label: toCreate.state === 'to_create' ? 'Choisir ou créer le départ' : 'Choisir un autre départ', href },
      });
    }
  }
  if (late) {
    const conversation = new URLSearchParams(page.search);
    conversation.delete('modifier');
    conversation.set('onglet', 'conversation');
    alerts.push({
      key: 'after_subscription',
      text: `Le départ du ${departureDayLabel(late.departureDay, { today })} est après la fin de son abonnement (${calendarDateLabel(late.endDay, { today })}). Contactez le client.`,
      action: { label: 'Écrire au client', href: `${page.pathname}?${conversation}` },
    });
  }
  return alerts;
}

/** The accessible name and title of the list mark. */
export const dossierAlertsLabel = alerts => `À vérifier : ${alerts.map(alert => alert.text).join(' ')}`;
