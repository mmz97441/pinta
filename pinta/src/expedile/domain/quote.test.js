import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote, measureShipment, quoteInputFingerprint } from './quote.js';

const fixture = () => ({
  colis: { id: 'parcel', finL: 40, finW: 30, finH: 20, finP: 3, dimL: 40, dimW: 30, dimH: 20, poids: 3,
    factures: [{ id: 'invoice', montant: 100, valide: true, fichier: 'parcel/invoice.pdf' }],
    lignes: [{ id: 'line', desc: 'Vêtement', qte: 2, prix: 50, cat: 'clothes', factureId: 'invoice' }], fraisDivers: [] },
  client: { type: 'particulier' }, destination: { code: '974', nom: 'La Réunion', tva: 8.5 }, tarif: { base: 10, parKg: 5 },
  categories: [{ id: 'clothes', label: 'Vêtements', taux: { '974': { om: 10, omr: 2.5 } } }],
});
test('transport, CIF allocation, tax components and total agree to cents', () => {
  const quote = calculateQuote(fixture());
  assert.equal(quote.ok, true);
  assert.deepEqual([quote.amounts.transport, quote.amounts.om, quote.amounts.omr, quote.amounts.tva, quote.amounts.total], [34, 13.4, 3.35, 4.31, 55.06]);
  assert.equal(quote.patch.economie, 0);
});
test('pro identical dimensions never invent VAT savings and need no invoices', () => {
  const input = fixture(); input.client.type = 'pro'; input.colis.factures = []; input.colis.lignes = [];
  const quote = calculateQuote(input);
  assert.equal(quote.ok, true); assert.equal(quote.amounts.total, 34); assert.equal(quote.patch.avantOptimTotal, 34); assert.equal(quote.patch.economie, 0);
});
test('missing categories and destination tax rates block instead of falling back to zero or Réunion', () => {
  const input = fixture(); input.colis.lignes[0].cat = null;
  assert.equal(calculateQuote(input).ok, false);
  input.colis.lignes[0].cat = 'clothes'; input.destination.code = '976';
  assert.equal(calculateQuote(input).ok, false);
});
test('nonfinite, negative and incomplete measures are rejected', () => {
  for (const invalid of ['', null, 0, -1, NaN, Infinity, '1foo']) {
    const input = fixture(); input.colis.finP = invalid;
    assert.equal(calculateQuote(input).ok, false, String(invalid));
  }
});
test('invalid quantities, prices, invoice and fee data are actionable errors', () => {
  const input = fixture(); input.colis.lignes[0].qte = 0; input.colis.factures[0].valide = false; input.colis.fraisDivers = [{ libelle: 'Frais', montant: -1 }];
  const quote = calculateQuote(input);
  assert.equal(quote.ok, false); assert.ok(quote.errors.some((error) => error.field === 'factures')); assert.ok(quote.errors.some((error) => error.field === 'fraisDivers.0'));
});
test('estimate and final use exactly the same calculation and fees count once', () => {
  const input = fixture(); input.colis.fraisDivers = [{ libelle: 'Enlèvement', montant: 7.5 }];
  const final = calculateQuote(input); const estimate = calculateQuote({ ...input, mode: 'estimate' });
  assert.deepEqual(final.amounts, estimate.amounts); assert.equal(final.patch.devisTotal, 62.56); assert.equal(final.patch.economie, 0);
});
test('before optimisation recalculates transport allocation and taxes under same rules', () => {
  const input = fixture(); input.colis.dimL = 80;
  const quote = calculateQuote(input);
  assert.equal(quote.before.transport, 58); assert.equal(quote.before.om, 15.8); assert.equal(quote.before.omr, 3.95);
  assert.equal(quote.before.total, 84.36); assert.equal(quote.patch.economie, 29.3);
});
test('configured divisor and grouped carton weights are shared with receiving', () => {
  assert.deepEqual(measureShipment([{ dimL: 40, dimW: 30, dimH: 20, poids: 3 }, { dimL: 10, dimW: 10, dimH: 10, poids: 10 }], 5000), { realWeight: 13, volumetricWeight: 5, billableWeight: 13 });
  const input = fixture(); input.settings = { diviseurVolumetrique: '6000' };
  assert.equal(calculateQuote(input).amounts.transport, 30);
});
test('snapshot is deterministic and detached from mutable input arrays', () => {
  const input = fixture(); const first = calculateQuote(input); const second = calculateQuote(input);
  assert.deepEqual(first.snapshot, second.snapshot); input.colis.lignes[0].prix = 999;
  assert.equal(first.snapshot.inputs.lines[0].unitPrice, 50);
});
test('input fingerprint ignores relation order and detects document, tariff or article changes', () => {
  const input = fixture(); input.colis.lignes.push({ ...input.colis.lignes[0], id: 'second', prix: 25 });
  const original = quoteInputFingerprint(calculateQuote(input).snapshot);
  input.colis.lignes.reverse();
  assert.equal(quoteInputFingerprint(calculateQuote(input).snapshot), original);
  input.tarif.parKg = 6;
  assert.notEqual(quoteInputFingerprint(calculateQuote(input).snapshot), original);
});
test('a default destination cannot hide an incompatible client postal code or an invoice with zero value', () => {
  const input = fixture(); input.client.cp = '75001';
  assert.equal(calculateQuote(input).ok, false);
  input.client.cp = '97400'; input.colis.factures[0].montant = 0;
  assert.equal(calculateQuote(input).ok, false);
});
