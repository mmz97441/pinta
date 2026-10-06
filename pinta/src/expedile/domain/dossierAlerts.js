import { calendarDateLabel, departureDayLabel, isoCalendarDay, parisCalendarDay } from './departureGroups.js';
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

/** The ordered list of `{ key, text, action: { label, href } }` for a dossier:
 * 1. `no_contact`: no client space and no Telegram, while the dossier is open;
 * 2. `billing_incomplete`: an individual's record misses a field required for
 *    online payment, before any payment is recorded;
 * 3. `after_subscription`: its departure is after the end of the subscription,
 *    before the dossier leaves.
 * `envoi` is the dossier's departure. `dossierUrl` is the dossier page as
 * displayed: the client page leads back to it, and « Écrire au client » opens
 * its Conversation tab with the same way back to the list. */
export function dossierAlerts({ dossier, client, envoi, today = Date.now(), dossierUrl } = {}) {
  if (!dossier?.id || !client?.id) return [];
  // A closed dossier (archived, delivered, refused or cancelled) asks for nothing.
  if (dossier.archive || CLOSED.has(dossier.statut)) return [];
  const noContact = !client.userId && !client.telegramChatId;
  const missing = client.type === 'pro' || paymentRecorded(dossier) ? []
    : BILLING_FIELDS.filter(([, values]) => !values(client).some(filled)).map(([label]) => label);
  const departure = envoi && envoi.id === (dossier.envoi || dossier.envoiId) ? envoi : null;
  const late = BEFORE_DEPARTURE.has(dossier.statut) ? departureAfterSubscription(departure, client) : null;
  // The list asks every dossier: links are built only when something applies.
  if (!noContact && !missing.length && !late) return [];
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
