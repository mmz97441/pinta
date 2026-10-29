import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_LABELS, IDENTITY_MISSING, ZONES, clientText, clientTypeLabel, deliveryText, dossierIdentity, forfaitLabel, zoneOf } from './dossierIdentity.js';

// The client and the dossier of the team's screenshot of 29 October 2026 (fictitious copy).
const nice = { id: 'c-nice', nom: 'Nice', prenom: 'Alain Jean Jocelyn', ref: 'CLI-7ASHU', type: 'particulier', abonnement: 'premium_annuel', cp: '97441', ville: 'Ste Suzanne', commune: 'Ste Suzanne' };
const dossier = { id: 'd-nice', ref: 'EXP-TUALDS', casier: '5C', clientId: 'c-nice', statut: 'attente_feu_vert' };

test('every fact has its word, the same on every screen', () => {
  assert.deepEqual(IDENTITY_LABELS, { ref: 'N° d’envoi', casier: 'Casier', livraison: 'Livraison', client: 'Client', clientRef: 'N° client', forfait: 'Forfait', zone: 'Zone' });
  assert.deepEqual(IDENTITY_MISSING, { ref: 'Non attribué', casier: 'À renseigner', forfait: 'Non renseigné', destination: 'Destination à préciser' });
});

test('the identity of a dossier: its number, its casier, where it goes and its client', () => {
  assert.deepEqual(dossierIdentity(dossier, nice), {
    ref: 'EXP-TUALDS', casier: '5C', clientRef: 'CLI-7ASHU', clientTypeLabel: 'Particulier', forfaitLabel: 'Premium Annuel',
    destinationCode: '974', destinationLabel: 'Réunion', destinationName: 'La Réunion', commune: 'Ste Suzanne', zone: 'EST', zoneLabel: 'Est',
  });
  assert.equal(deliveryText(dossierIdentity(dossier, nice)), 'Ste Suzanne · Zone EST · La Réunion');
  assert.equal(clientText(dossierIdentity(dossier, nice)), 'N° CLI-7ASHU · Particulier');
});

test('what is not recorded is null, and the texts say what is known', () => {
  const bare = dossierIdentity({ ref: '  ', casier: '' }, null);
  assert.deepEqual(bare, { ref: null, casier: null, clientRef: null, clientTypeLabel: null, forfaitLabel: null, destinationCode: null,
    destinationLabel: 'Destination à préciser', destinationName: null, commune: null, zone: null, zoneLabel: null });
  assert.equal(deliveryText(bare), 'Destination à préciser');
  assert.equal(clientText(bare), null);
  assert.equal(deliveryText(null), 'Destination à préciser');
  // Mayotte: no zone; a client without number: his type only.
  const mayotte = dossierIdentity(dossier, { type: 'pro', cp: '97600', ville: 'Mamoudzou' });
  assert.deepEqual([mayotte.zone, mayotte.destinationName, deliveryText(mayotte), clientText(mayotte)], [null, 'Mayotte', 'Mamoudzou · Mayotte', 'Professionnel']);
  // A postcode outside the destinations keeps its code (the groups of « Par destination » read it) and says it is to check.
  const paris = dossierIdentity(dossier, { cp: '75011', ville: 'Paris' });
  assert.deepEqual([paris.destinationCode, paris.destinationLabel, paris.destinationName, deliveryText(paris)], ['750', 'Destination à préciser', null, 'Paris · Destination à préciser']);
});

test('the zones of La Réunion, the plans and the types of client', () => {
  assert.deepEqual(ZONES, { NORD: 'Nord', EST: 'Est', OUEST: 'Ouest', SUD: 'Sud' });
  assert.equal(zoneOf({ cp: '97400' }, '974'), 'NORD');
  assert.equal(zoneOf({ cp: '97400' }, '976'), null, 'Only La Réunion has zones.');
  assert.equal(zoneOf({ cp: null }, '974'), null);
  assert.deepEqual(['freemium', 'premium_annuel', 'vip', 'premium', 'inconnu', '', null].map(key => forfaitLabel({ abonnement: key })),
    ['Freemium', 'Premium Annuel', 'VIP Annuel', 'Premium', null, null, null]);
  assert.deepEqual([{ type: 'pro' }, { type: 'particulier' }, { type: null }, null].map(clientTypeLabel), ['Professionnel', 'Particulier', 'Type à préciser', null]);
});

test('a paid dossier keeps the destination of its quote', () => {
  const paid = { ...dossier, paiementDate: '2026-10-20T10:00:00Z', devisSnapshot: { inputs: { destination: { code: '976' } } } };
  assert.equal(dossierIdentity(paid, nice).destinationName, 'Mayotte');
  assert.equal(dossierIdentity(paid, nice).zone, null);
});
