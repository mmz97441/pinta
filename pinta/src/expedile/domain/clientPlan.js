import { calendarDateLabel, parisCalendarDay } from './departureGroups.js';

// The client's offer at a glance: « P » for a paid offer (Premium monthly or yearly,
// and the former Premium and VIP offers), « F » for Freemium.
// A subscription runs until its end day included, on Paris time, as the departure
// notes say (« abonnement jusqu’au … », « abonnement terminé le … »). From the next
// day a paid offer has ended, until the team renews it.

const LABELS = Object.freeze({ freemium: 'Freemium', premium: 'Premium', premium_mensuel: 'Premium mensuel', premium_annuel: 'Premium annuel', vip: 'VIP annuel' });
const PAID = new Set(['premium', 'premium_mensuel', 'premium_annuel', 'vip']);
const dayNumber = day => Date.parse(`${day}T00:00:00Z`) / 86400000;
const offerOf = client => String(client?.abonnement || 'freemium');
const isPaidOffer = offer => PAID.has(offer) || offer.startsWith('premium');

/** The last day (YYYY-MM-DD, Paris) of a paid subscription; null for Freemium, whose
 * leftover end date from a former subscription has nothing left to end. */
export function subscriptionEndDay(client) {
  const value = client?.abonnementFin;
  return isPaidOffer(offerOf(client)) && value ? parisCalendarDay(value) : null;
}

/**
 * { key: 'premium' | 'freemium', letter: 'P' | 'F', label, paid, endDay, daysLeft, ended, endLabel, description }
 * - `daysLeft`: Paris days until the end day (0 on the end day, negative once ended); null without an end day.
 * - `description`: the full wording, read by screen readers and shown on hover.
 */
export function clientPlan(client, now = Date.now()) {
  const offer = offerOf(client);
  const paid = isPaidOffer(offer);
  const label = LABELS[offer] || (paid ? 'Premium' : 'Freemium');
  const endDay = subscriptionEndDay(client);
  const today = parisCalendarDay(now);
  const daysLeft = endDay && today ? Math.round(dayNumber(endDay) - dayNumber(today)) : null;
  const ended = daysLeft !== null && daysLeft < 0;
  const endLabel = endDay ? calendarDateLabel(endDay, { today: now }) : null;
  return {
    key: paid ? 'premium' : 'freemium',
    letter: paid ? 'P' : 'F',
    label,
    paid,
    endDay,
    daysLeft,
    ended,
    endLabel,
    description: ended ? `Forfait ${label} terminé le ${endLabel}` : `Forfait ${label}`,
  };
}
