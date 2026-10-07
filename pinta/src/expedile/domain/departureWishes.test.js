import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionEndNote, wishesAfterSubscription, wishesSubscriptionConfirmation } from './departureWishes.js';

// Tuesday 6 October 2026, 10:00 in Paris.
const today = Date.parse('2026-10-06T08:00:00Z');
const OCT_22 = { id: 'reunion-22', date: '2026-10-22', destinationCode: '974', ref: 'ENV-2026-103' };
const lucas = { id: 'c-lucas', prenom: 'Lucas', nom: 'Hoarau Lucas', abonnement: 'premium', abonnementFin: '2026-10-18' };
const marie = { id: 'c-marie', prenom: 'Marie', nom: 'Martin Marie', abonnement: 'premium', abonnementFin: '2026-10-20' };
const flavie = { id: 'c-flavie', prenom: 'Flavie', nom: 'Payet Flavie', abonnement: 'freemium', abonnementFin: null };
const dossier = (ref, clientId) => ({ id: ref, ref, clientId });

test('« Affecter ces dossiers » asks first when a dossier leaves after its client’s subscription', () => {
  const clients = [lucas, marie, flavie];
  assert.deepEqual(wishesAfterSubscription(OCT_22, [dossier('EXP-ACC012', 'c-lucas'), dossier('EXP-ACC001', 'c-flavie')], clients)
    .map(item => [item.dossier.ref, item.endDay]), [['EXP-ACC012', '2026-10-18']]);
  assert.deepEqual(wishesSubscriptionConfirmation(OCT_22, [dossier('EXP-ACC012', 'c-lucas'), dossier('EXP-ACC001', 'c-flavie')], clients, { today }), {
    title: 'Affecter quand même ?',
    message: 'Le départ du jeudi 22 octobre est après la fin de l’abonnement de Lucas (18 octobre) : EXP-ACC012.',
    okLabel: 'Affecter quand même',
    refs: ['EXP-ACC012'],
  });
  // Several dossiers of one client: named once, with all its dossiers.
  assert.equal(wishesSubscriptionConfirmation(OCT_22, [dossier('EXP-ACC012', 'c-lucas'), dossier('EXP-ACC013', 'c-lucas'), dossier('EXP-ACC001', 'c-flavie')], clients, { today }).message,
    'Le départ du jeudi 22 octobre est après la fin de l’abonnement de Lucas (18 octobre) : EXP-ACC012 et EXP-ACC013.');
  // Several clients: each one with the end of its subscription and its dossiers.
  assert.equal(wishesSubscriptionConfirmation(OCT_22, [dossier('EXP-ACC012', 'c-lucas'), dossier('EXP-ACC020', 'c-marie'), dossier('EXP-ACC013', 'c-lucas')], clients, { today }).message,
    'Le départ du jeudi 22 octobre est après la fin de l’abonnement de ces clients : Lucas (fin le 18 octobre) pour EXP-ACC012 et EXP-ACC013 ; Marie (fin le 20 octobre) pour EXP-ACC020.');
  // Within the subscriptions, or without an end date: nothing to ask.
  assert.equal(wishesSubscriptionConfirmation(OCT_22, [dossier('EXP-ACC001', 'c-flavie')], clients, { today }), null);
  assert.equal(wishesSubscriptionConfirmation({ ...OCT_22, date: '2026-10-18' }, [dossier('EXP-ACC012', 'c-lucas')], clients, { today }), null, 'The last day of the subscription needs no confirmation.');
  assert.equal(wishesSubscriptionConfirmation(OCT_22, [dossier('EXP-X', 'unknown')], clients, { today }), null, 'An unknown client is never presumed late.');
  assert.equal(wishesSubscriptionConfirmation(OCT_22, [], clients, { today }), null);
});

test('the note beside a wished dossier speaks of a subscription still running in the future tense', () => {
  // Tuesday 6 October 2026 in Paris.
  assert.equal(subscriptionEndNote('2026-10-18', { today }), 'abonnement jusqu’au 18 octobre');
  assert.equal(subscriptionEndNote('2026-10-06', { today }), 'abonnement jusqu’au 6 octobre', 'Its last day is still within it.');
  assert.equal(subscriptionEndNote('2026-10-01', { today }), 'abonnement terminé le 1er octobre');
  assert.equal(subscriptionEndNote('2027-01-04', { today }), 'abonnement jusqu’au 4 janvier 2027');
  // The day is the Paris one, whatever the device: 23:30 on 5 October in Paris is still the 5th,
  // 00:30 on the 6th is the day after the end.
  assert.equal(subscriptionEndNote('2026-10-05', { today: Date.parse('2026-10-05T21:30:00Z') }), 'abonnement jusqu’au 5 octobre');
  assert.equal(subscriptionEndNote('2026-10-05', { today: Date.parse('2026-10-05T22:30:00Z') }), 'abonnement terminé le 5 octobre');
  assert.equal(subscriptionEndNote('not-a-day', { today }), null);
});
