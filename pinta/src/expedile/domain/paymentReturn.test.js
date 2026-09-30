import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentReturnFacts, paymentReturnMessage, paymentShipmentMessage, receiptDate } from './paymentReturn.js';

test('the browser return is never a payment confirmation and cancellation never overrides recorded payment', () => {
  for (const cancelled of [false, true]) {
    assert.doesNotMatch(paymentReturnMessage({ status: 'pending' }, cancelled).title, /reçu|confirmé/);
    assert.equal(paymentReturnMessage({ status: 'paid', isLive: true }, cancelled).title, 'Paiement reçu');
    assert.equal(paymentReturnMessage({ status: 'paid', isLive: false }, cancelled).title, 'Paiement de test confirmé');
    for (const status of ['superseded', 'cancelled', 'unavailable']) assert.doesNotMatch(paymentReturnMessage({ status }, cancelled).title, /reçu|confirmé/);
  }
});

test('receipt fails closed on malformed responses and never invents an amount or a test mode', () => {
  for (const result of [null, {}, { ok: true, reference: 'EXP-TEST', status: 'success' }, { ok: true, reference: '', status: 'paid' }, { ok: true, reference: 'EXP-TEST', status: 'paid', currency: 'EUR', isLive: null }, { ok: true, reference: 'EXP-TEST', status: 'paid', currency: 'USD', isLive: true }]) assert.throws(() => paymentReturnFacts(result));
  const result = paymentReturnFacts({ ok: true, reference: 'EXP-TEST', status: 'pending', currency: 'EUR', amountCents: '1000', isLive: 'false' });
  assert.equal(result.amountCents, null);
  assert.equal(result.isLive, null);
  assert.deepEqual(result.shipment, {});
});

test('the next departure is not invented and confirmed transport events supersede a planned date', () => {
  assert.match(paymentShipmentMessage({ status: 'paye' }).message, /date.*confirmée/);
  assert.match(paymentShipmentMessage({ status: 'paye', departureDate: '2026-10-02' }).title, /2 octobre 2026/);
  assert.equal(paymentShipmentMessage({ status: 'transit', departureDate: '2026-10-02', departedAt: '2026-09-30T08:00:00Z' }).title, 'Votre envoi a pris le départ');
  assert.equal(paymentShipmentMessage({ status: 'livre', deliveredAt: '2026-10-05T08:00:00Z' }).title, 'Votre envoi est livré');
  assert.doesNotMatch(paymentShipmentMessage({ status: 'annule', departureDate: '2026-10-02' }).title, /Départ prévu/);
  assert.equal(receiptDate('invalid'), null);
  assert.equal(receiptDate(null), null);
});
