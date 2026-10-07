import { departureAfterSubscription } from './dossierAlerts.js';
import { calendarDateLabel, departureDayLabel, parisCalendarDay } from './departureGroups.js';

// « Affecter ces dossiers » on Départs: the same rule as the dossier calendar
// (decision of 7 October 2026): a departure after the end of the client's
// subscription is assigned only once confirmed.

const filled = value => String(value ?? '').trim() !== '';
const firstName = client => [client?.prenom, client?.raisonSociale, client?.nom].find(filled)?.trim() || 'ce client';
const frenchList = items => items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}` : items.join('');

/** The proposed dossiers whose client's subscription ends before this departure:
 * `{ dossier, client, endDay }`, in the order given. */
export function wishesAfterSubscription(envoi, dossiers = [], clients = []) {
  const clientOf = new Map((clients || []).map(client => [client.id, client]));
  return (dossiers || []).flatMap(dossier => {
    const client = clientOf.get(dossier?.clientId);
    const late = client ? departureAfterSubscription(envoi, client) : null;
    return late ? [{ dossier, client, endDay: late.endDay }] : [];
  });
}

/** The question asked before « Affecter ces dossiers » when some of them leave
 * after their client's subscription (null otherwise): those dossiers, under
 * their client and the end of the subscription. Confirming assigns them all. */
export function wishesSubscriptionConfirmation(envoi, dossiers, clients, { today = Date.now() } = {}) {
  const late = wishesAfterSubscription(envoi, dossiers, clients);
  if (!late.length) return null;
  const groups = [];
  for (const { dossier, client, endDay } of late) {
    const group = groups.find(item => item.client === client) || groups[groups.push({ client, endDay, refs: [] }) - 1];
    group.refs.push(dossier.ref || 'dossier sans référence');
  }
  const day = departureDayLabel(envoi?.date, { today });
  const end = group => calendarDateLabel(group.endDay, { today });
  return {
    title: 'Affecter quand même ?',
    message: groups.length === 1
      ? `Le départ du ${day} est après la fin de l’abonnement de ${firstName(groups[0].client)} (${end(groups[0])}) : ${frenchList(groups[0].refs)}.`
      : `Le départ du ${day} est après la fin de l’abonnement de ces clients : ${groups.map(group => `${firstName(group.client)} (fin le ${end(group)}) pour ${frenchList(group.refs)}`).join(' ; ')}.`,
    okLabel: 'Affecter quand même',
    // The references named, which the screen keeps whole (never split at a hyphen).
    refs: groups.flatMap(group => group.refs),
  };
}

/** The note beside a wished dossier whose client's subscription ends before the
 * departure: « abonnement jusqu’au 12 octobre » while it still runs (today
 * included, Paris day), « abonnement terminé le 2 octobre » once it has ended. */
export function subscriptionEndNote(endDay, { today = Date.now() } = {}) {
  const label = calendarDateLabel(endDay, { today });
  if (!label) return null;
  const current = parisCalendarDay(today);
  return current && endDay < current ? `abonnement terminé le ${label}` : `abonnement jusqu’au ${label}`;
}
