import { ABONNEMENTS, DESTINATIONS, getSecteurByCP } from '../constants/index.js';
import { dossierDestinationCode } from './departurePlanning.js';

// Who and what a dossier is, in the same words on every screen of the team (the Brouillon sheet, the « Colis » list,
// the complete dossier): every code is said with its word — « N° d’envoi EXP-… », « N° client CLI-… », « Forfait … »,
// « Zone EST », « Casier 5C » — never shown bare (team request of 29 October 2026: a newcomer must not get lost
// between the numbers). Pure: no React, no network.

/** The words of each fact. */
export const IDENTITY_LABELS = Object.freeze({
  ref: 'N° d’envoi', casier: 'Casier', livraison: 'Livraison', client: 'Client', clientRef: 'N° client', forfait: 'Forfait', zone: 'Zone',
});
/** What a fact reads when it is not recorded: never an empty field. */
export const IDENTITY_MISSING = Object.freeze({
  ref: 'Non attribué', casier: 'À renseigner', forfait: 'Non renseigné', destination: 'Destination à préciser',
});

/** The delivery zones of La Réunion (getSecteurByCP, from the postcode), in the order of « Par destination ». */
export const ZONES = Object.freeze({ NORD: 'Nord', EST: 'Est', OUEST: 'Ouest', SUD: 'Sud' });

const text = value => typeof value === 'string' ? value.trim() : '';

/** The zone of a client delivered in La Réunion (« NORD »…), null elsewhere or for a postcode the table does not know. */
export function zoneOf(client, destinationCode) {
  if (destinationCode !== '974') return null;
  const zone = getSecteurByCP(client?.cp);
  return Object.prototype.hasOwnProperty.call(ZONES, zone) ? zone : null;
}

/** « Freemium », « Premium Annuel », « VIP Annuel » (ABONNEMENTS), « Premium » for the historical offer; null without one. */
export function forfaitLabel(client) {
  const key = text(client?.abonnement);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(ABONNEMENTS, key)) return ABONNEMENTS[key].label;
  return key === 'premium' ? 'Premium' : null;
}

/** « Particulier », « Professionnel », « Type à préciser »; null without a client record. */
export function clientTypeLabel(client) {
  if (!client) return null;
  return client.type === 'pro' ? 'Professionnel' : client.type === 'particulier' ? 'Particulier' : 'Type à préciser';
}

/**
 * The identity of a dossier and of its client: `ref`, `casier`, `clientRef`, `clientTypeLabel`, `forfaitLabel`,
 * `destinationCode` (as dossierDestinationCode reads it, even unknown), `destinationLabel` (« Réunion », short, for the
 * lists; « Destination à préciser » for a code DESTINATIONS does not know), `destinationName` (« La Réunion »),
 * `commune`, `zone` (« EST », La Réunion only) and `zoneLabel` (« Est »). Null where it is not recorded: the screens
 * write IDENTITY_MISSING instead, never an empty field.
 */
export function dossierIdentity(dossier = {}, client = null) {
  const code = dossierDestinationCode(dossier || {}, client || {});
  const destination = DESTINATIONS[code] || null;
  const zone = zoneOf(client, code);
  return {
    ref: text(dossier?.ref) || null,
    casier: text(dossier?.casier) || null,
    clientRef: text(client?.ref) || null,
    clientTypeLabel: clientTypeLabel(client),
    forfaitLabel: forfaitLabel(client),
    destinationCode: code || null,
    destinationLabel: destination?.label || IDENTITY_MISSING.destination,
    destinationName: destination?.nom || null,
    commune: text(client?.commune) || text(client?.ville) || null,
    zone, zoneLabel: zone ? ZONES[zone] : null,
  };
}

/** « Ste Suzanne · Zone EST · La Réunion » as plain text (an export, a screen reader, a test): the commune, the zone
 * and the destination when known, « Destination à préciser » without a destination. */
export function deliveryText(identity) {
  if (!identity) return IDENTITY_MISSING.destination;
  const parts = [identity.commune, identity.zone ? `${IDENTITY_LABELS.zone} ${identity.zone}` : null, identity.destinationName || IDENTITY_MISSING.destination];
  return parts.filter(Boolean).join(' · ');
}

/** « N° CLI-7ASHU · Particulier »: the client's number and type, or what is known of them. */
export function clientText(identity) {
  if (!identity) return null;
  return [identity.clientRef ? `N° ${identity.clientRef}` : null, identity.clientTypeLabel].filter(Boolean).join(' · ') || null;
}
