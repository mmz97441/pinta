import test from 'node:test';
import assert from 'node:assert/strict';
import { clientPlan } from './clientPlan.js';

const NOW = Date.parse('2026-10-07T12:00:00Z');

test('Freemium reads F; every paid offer reads P', () => {
  assert.deepEqual(clientPlan({ abonnement: 'freemium' }, NOW), { key: 'freemium', letter: 'F', label: 'Freemium', paid: false, endDay: null, daysLeft: null, ended: false, endLabel: null, description: 'Forfait Freemium' });
  for (const [offer, label] of [['premium_mensuel', 'Premium mensuel'], ['premium_annuel', 'Premium annuel'], ['premium', 'Premium'], ['vip', 'VIP annuel']]) {
    const plan = clientPlan({ abonnement: offer }, NOW);
    assert.equal(plan.letter, 'P', offer);
    assert.equal(plan.description, `Forfait ${label}`);
  }
});

test('a client without offer is Freemium, and a Freemium end date is ignored', () => {
  assert.equal(clientPlan({}, NOW).letter, 'F');
  assert.equal(clientPlan(null, NOW).letter, 'F');
  assert.equal(clientPlan({ abonnement: 'freemium', abonnementFin: '2020-01-01' }, NOW).ended, false);
});

test('a paid offer runs until its end day included, on Paris time', () => {
  const lastDay = clientPlan({ abonnement: 'premium_mensuel', abonnementFin: '2026-10-07' }, NOW);
  assert.deepEqual([lastDay.daysLeft, lastDay.ended, lastDay.description], [0, false, 'Forfait Premium mensuel']);
  assert.equal(clientPlan({ abonnement: 'premium_annuel', abonnementFin: '2026-10-14' }, NOW).daysLeft, 7);
  // 23:30 in Paris on 6 October is still 6 October, wherever the device is.
  assert.equal(clientPlan({ abonnement: 'premium_mensuel', abonnementFin: '2026-10-06' }, Date.parse('2026-10-06T21:30:00Z')).ended, false);
  assert.equal(clientPlan({ abonnement: 'premium_mensuel', abonnementFin: '2026-10-06' }, Date.parse('2026-10-06T22:30:00Z')).ended, true);
});

test('an ended paid offer keeps P and says when it ended', () => {
  const ended = clientPlan({ abonnement: 'premium_annuel', abonnementFin: '2026-10-01' }, NOW);
  assert.deepEqual([ended.letter, ended.ended, ended.daysLeft], ['P', true, -6]);
  assert.equal(ended.description, 'Forfait Premium annuel terminé le 1er octobre');
  assert.equal(clientPlan({ abonnement: 'premium_mensuel', abonnementFin: '2020-01-31' }, NOW).description, 'Forfait Premium mensuel terminé le 31 janvier 2020');
  // An unreadable end date never invents an end.
  assert.equal(clientPlan({ abonnement: 'premium_mensuel', abonnementFin: 'bientôt' }, NOW).ended, false);
});
