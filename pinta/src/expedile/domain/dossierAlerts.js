import { calendarDateLabel, departureDayLabel, isoCalendarDay, parisCalendarDay } from './departureGroups.js';
import { closedDepartureWording, closingLabel, consentRelanceOpen, destinationName, dossierDepartureClosing, dossierDestinationCode, dossierWishState } from './departurePlanning.js';
import { dossierTaskUrl } from './dossierTasks.js';
import { paymentRecorded } from './invoiceLock.js';

// « À vérifier » on a dossier: what the team checks with the client. These are
// pointers only: nothing here blocks a step, writes or sends a message.

// The dossier has not left yet: the steps before « expedie » in the journey.
const BEFORE_DEPARTURE = new Set(['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye']);
// The fields payplug-create requires before creating a payment link, with the
// same alternatives (its `nom` is the family name).
const BILLING_FIELDS = [
  ['le nom', client => [client.nomFamille ?? client.nom]],
  ['l’email', client => [client.email]],
  ['l’adresse', client => [client.adresse, client.adresseLigne1]],
  ['le code postal', client => [client.cp]],
  ['la ville', client => [client.ville, client.commune]],
];
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
  const endDay = client?.abonnementFin ? parisCalendarDay(client.abonnementFin) : null;
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

/** The consent still missing while the dossier's departure closes within 48 h:
 * `{ closing, day, habitual }` (closing instant, departure day, a habitual
 * Wednesday closing), otherwise null. A voluntary wait of the client is
 * respected. */
function consentBeforeCutoff(dossier, departure, now) {
  if (!BEFORE_CONSENT.has(dossier.statut) || dossier.statut === 'attente_feu_vert' && dossier.attenteClientDate) return null;
  const planned = dossierDepartureClosing(dossier, departure);
  return planned?.day && consentRelanceOpen(planned.closing, now) ? planned : null;
}

/** The ordered list of `{ key, text, action: { label, href } }` for a dossier:
 * 1. `no_contact`: no client space and no Telegram, while the dossier is open;
 * 2. `billing_incomplete`: an individual's record misses a field required for
 *    online payment, before any payment is recorded;
 * 3. `consent_before_cutoff`: the consent is missing (to ask, or awaited without
 *    a voluntary wait) and its departure closes within 48 hours;
 * 4. `departure_to_create`: its desired day needs a departure: none is planned
 *    that day (« Choisir ou créer le départ »), that day's departure is closed
 *    or has left, or the day has passed (« Choisir un autre départ »). A desired
 *    day whose departure is planned and open stays silent here;
 * 5. `after_subscription`: its departure, or its desired day, is after the end
 *    of the subscription, before the dossier leaves.
 * `envoi` is the dossier's departure and `envois` the departures the person can
 * read. `today` is the instant of the check. `dossierUrl` is the dossier page as
 * displayed: the client page leads back to it, « Écrire au client » opens its
 * Conversation tab, « Choisir ou créer le départ » its Départ field and the
 * consent links its accord task, each with the same way back to the list. */
export function dossierAlerts({ dossier, client, envoi, envois = [], today = Date.now(), dossierUrl } = {}) {
  if (!dossier?.id || !client?.id) return [];
  // A closed dossier (archived, delivered, refused or cancelled) asks for nothing.
  if (dossier.archive || CLOSED.has(dossier.statut)) return [];
  const noContact = !client.userId && !client.telegramChatId;
  const missing = client.type === 'pro' || paymentRecorded(dossier) ? []
    : BILLING_FIELDS.filter(([, values]) => !values(client).some(filled)).map(([label]) => label);
  const departure = envoi && envoi.id === (dossier.envoi || dossier.envoiId) ? envoi : null;
  const beforeDeparture = BEFORE_DEPARTURE.has(dossier.statut);
  // What the desired day stands for, against every departure the person can read that day.
  const wish = beforeDeparture ? dossierWishState(dossier, client, envois, today) : null;
  const cutoff = consentBeforeCutoff(dossier, departure, today);
  const toCreate = wish && wish.state !== 'planned' ? wish : null;
  const late = beforeDeparture ? departureAfterSubscription(departure || (wish ? { date: wish.day } : null), client) : null;
  // The list asks every dossier: links are built only when something applies.
  if (!noContact && !missing.length && !cutoff && !toCreate && !late) return [];
  const page = dossierPage(dossier, dossierUrl);
  const clientHref = `/clients/${encodeURIComponent(client.id)}?${new URLSearchParams({ returnTo: page.pathname + page.search })}`;
  const alerts = [];
  if (noContact) alerts.push({
    key: 'no_contact',
    text: 'Le client n’a ni espace client ni Telegram : il ne reçoit pas nos messages.',
    action: { label: 'Inviter le client', href: clientHref },
  });
  if (missing.length) alerts.push({
    key: 'billing_incomplete',
    text: `Fiche client incomplète pour le paiement en ligne : il manque ${frenchList(missing)}.`,
    action: { label: 'Compléter la fiche', href: clientHref },
  });
  if (cutoff) alerts.push({
    key: 'consent_before_cutoff',
    // Without a loading closing of its own, the Wednesday 17 h is the habitual closing, not a cut-off.
    text: `Accord du client à obtenir avant ${closingLabel(cutoff.closing, { today })} (clôture${cutoff.habitual ? ' habituelle' : ''} du départ du ${departureDayLabel(cutoff.day, { today })}).`,
    action: { label: dossier.statut === 'attente_feu_vert' ? 'Relancer le client' : 'Demander l’accord', href: dossierTaskUrl(dossier.id, 'accord', page.search, { hash: 'dossier-work' }) },
  });
  if (toCreate) {
    const departurePage = new URLSearchParams(page.search);
    departurePage.delete('onglet');
    departurePage.set('modifier', 'depart');
    const where = destinationName(dossierDestinationCode(dossier, client));
    const day = departureDayLabel(toCreate.day, { today });
    alerts.push({
      key: 'departure_to_create',
      text: toCreate.state === 'past' ? `Départ souhaité le ${day} : cette date est passée.`
        : toCreate.state === 'closed' ? `Départ souhaité le ${day} : le départ de ce jour${where ? ` pour ${where}` : ''} ${closedDepartureWording(toCreate.envoi)}.`
          : `Départ souhaité le ${day} : aucun départ n’est prévu ce jour-là${where ? ` pour ${where}` : ''}.`,
      action: { label: toCreate.state === 'to_create' ? 'Choisir ou créer le départ' : 'Choisir un autre départ', href: `${page.pathname}?${departurePage}` },
    });
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
