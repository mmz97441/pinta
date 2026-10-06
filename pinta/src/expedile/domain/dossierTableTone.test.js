import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUTS } from '../constants/index.js';
import { PAYMENT_DETAIL_LABELS, PAYMENT_STATE_LABELS, buildDossierTableModel } from './dossierTable.js';
import { DOSSIER_TABLE_TONES, consentTone, paymentTone, statusTone } from './dossierTableTone.js';
import { CONSENT_STAGE_LABELS } from './consentQueue.js';

const withPayment = stateLabel => ({ payment: { stateLabel } });
const withDetail = (stateLabel, detailLabel) => ({ payment: { stateLabel, detailLabel } });
const now = Date.parse('2026-10-02T12:00:00Z');
const prepared = { id: 'parcel', ref: 'EXP-TONE', statut: 'en_preparation', feuVert: 'autorise', nbColis: 1, preparationCompositionVersion: 2, finalMeasurementsVersion: 2, outgoingParcelCount: 1, finalPackages: [{ dimL: 10, dimW: 20, dimH: 30, poids: 2 }] };
const quoted = { ...prepared, statut: 'devis_envoye', devisTotal: 100, devisEnvoyeLe: '2026-10-01T12:00:00Z', devisBrouillon: false, quoteVersion: 1 };

test('every payment state the table can show has a deliberate tone', () => {
  // « Paiement » says Payé or Non payé; « À vérifier » only when the records disagree.
  const expected = { paid: 'done', unpaid: 'neutral', toVerify: 'review' };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(PAYMENT_STATE_LABELS).sort());
  for (const [key, tone] of Object.entries(expected)) assert.equal(paymentTone(withPayment(PAYMENT_STATE_LABELS[key])), tone, key);
});

test('unknown payment wording is reviewed when it asks for a check and neutral otherwise', () => {
  assert.equal(paymentTone(withPayment('Montant à vérifier')), 'review');
  assert.equal(paymentTone(withPayment('Nouvel état')), 'neutral');
  for (const value of [undefined, null, {}, { payment: null }, withPayment(''), withPayment(42)]) assert.equal(paymentTone(value), 'neutral');
});

test('dossier statuses follow their stage and an unknown status asks for a review', () => {
  const expected = {
    livre: 'done', attente_feu_vert: 'waiting', devis_envoye: 'waiting', attente_paiement: 'waiting', refuse_client: 'review',
    expedie: 'current', transit: 'current', dedouanement: 'current', arrive: 'current', livraison: 'current',
    receptionne: 'neutral', mesure: 'neutral', autorise: 'neutral', en_preparation: 'neutral', annule: 'neutral',
  };
  // A new status must be given a tone on purpose instead of silently turning red.
  assert.deepEqual([...Object.keys(expected), 'paye'].sort(), Object.keys(STATUTS).sort());
  for (const [status, tone] of Object.entries(expected)) assert.equal(statusTone({ statut: status }, withPayment(PAYMENT_STATE_LABELS.unpaid)), tone, status);
  for (const dossier of [{ statut: 'inconnu' }, { statut: '' }, {}, null, undefined, { statut: '__proto__' }]) assert.equal(statusTone(dossier, {}), 'review');
});

test('a paid status is green only when the recorded payment is complete', () => {
  // The status of a dossier marked paid takes the colour of the detailed situation.
  assert.equal(statusTone({ statut: 'paye' }, withDetail(PAYMENT_STATE_LABELS.paid, PAYMENT_DETAIL_LABELS.paid)), 'done');
  assert.equal(statusTone({ statut: 'paye' }, withDetail(PAYMENT_STATE_LABELS.unpaid, PAYMENT_DETAIL_LABELS.partial)), 'waiting');
  assert.equal(statusTone({ statut: 'paye' }, withDetail(PAYMENT_STATE_LABELS.toVerify, PAYMENT_DETAIL_LABELS.toVerify)), 'review');
  assert.equal(statusTone({ statut: 'paye' }, withDetail(PAYMENT_STATE_LABELS.toVerify, PAYMENT_DETAIL_LABELS.overpaid)), 'review');
  assert.equal(statusTone({ statut: 'paye' }, {}), 'neutral');
});

test('tones computed from real table models stay within the known palette', () => {
  const cases = [
    [{ ...quoted, statut: 'paye', paiementMontant: 100, paiementDate: '2026-10-02T09:00:00Z' }, 'done', 'done'],
    [{ ...quoted, statut: 'paye', paiementMontant: 30, paiementDate: '2026-10-02T09:00:00Z' }, 'waiting', 'neutral'],
    [{ ...quoted, statut: 'paye', paiementMontant: 130, paiementDate: '2026-10-02T09:00:00Z' }, 'review', 'review'],
    [quoted, 'waiting', 'neutral'],
    [prepared, 'neutral', 'neutral'],
  ];
  for (const [dossier, status, payment] of cases) {
    const row = buildDossierTableModel(dossier, { now, can: () => true });
    assert.equal(statusTone(dossier, row), status, `${dossier.statut} / ${row.payment.stateLabel}`);
    assert.equal(paymentTone(row), payment, row.payment.stateLabel);
    assert.ok(DOSSIER_TABLE_TONES.includes(statusTone(dossier, row)) && DOSSIER_TABLE_TONES.includes(paymentTone(row)));
  }
});

test('the « Accord » pill: to submit is neutral, an awaited answer waits, the client’s own wait is current', () => {
  const expected = { to_submit: 'neutral', awaiting_reply: 'waiting', client_waiting: 'current' };
  // A new consent state must be given a tone on purpose.
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(CONSENT_STAGE_LABELS).sort());
  for (const [stage, tone] of Object.entries(expected)) assert.equal(consentTone(stage), tone, stage);
  for (const unknown of [null, undefined, '', 'refused', '__proto__']) assert.equal(consentTone(unknown), 'neutral');
  assert.ok(Object.values(expected).every(tone => DOSSIER_TABLE_TONES.includes(tone)));
});
