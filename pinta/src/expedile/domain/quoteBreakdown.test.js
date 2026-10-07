import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote } from './quote.js';
import { allocateCents, parcelVolumetricWeight, savedQuoteBreakdown } from './quoteBreakdown.js';

const sum = parts => Math.round(parts.reduce((acc, part) => acc + part, 0) * 100) / 100;

test('allocateCents shares in proportion and always adds up to the total', () => {
  assert.deepEqual(allocateCents(40, [100, 300]), [10, 30]);
  assert.deepEqual(allocateCents(10, [1, 1, 1]), [3.34, 3.33, 3.33], 'The remaining cent goes to the first of equal remainders.');
  assert.deepEqual(allocateCents(39, [16.64, 9.92]), [24.43, 14.57]);
  assert.deepEqual(allocateCents(0.05, [1, 1, 1, 1, 1, 1]), [0.01, 0.01, 0.01, 0.01, 0.01, 0]);
  assert.deepEqual(allocateCents(12, [0, 5, null, 'x']), [0, 12, 0, 0], 'Only positive weights receive a share.');
  assert.deepEqual(allocateCents(12, [0, 0]), [0, 0]);
  assert.deepEqual(allocateCents(12, []), []);
  for (const [total, weights] of [[123.45, [3.3, 1.1, 7.7, 2.2]], [0.07, [1, 2, 3]], [99.99, [33.333, 33.333, 33.334]], [1000, [0.01, 999.99]]])
    assert.equal(sum(allocateCents(total, weights)), total);
});

test('a parcel volumetric weight is L × l × h ÷ divisor', () => {
  assert.equal(parcelVolumetricWeight({ dimL: 40, dimW: 35, dimH: 10 }, 5000), 2.8);
  assert.equal(parcelVolumetricWeight({ dimL: 40, dimW: 35, dimH: 10 }, 6000), 14000 / 6000);
  assert.equal(parcelVolumetricWeight({ dimL: 40, dimW: 0, dimH: 10 }, 5000), null);
  assert.equal(parcelVolumetricWeight({ dimL: 40, dimW: 35, dimH: 10 }, 'x'), null);
});

// The screen of 7 October: Transport 39,00 €, Taxes 8,65 €, Total 47,65 €.
function savedQuote() {
  const colis = {
    id: 'p1', ref: 'EXP-2YE537', statut: 'en_preparation',
    finalPackages: [{ dimL: 40, dimW: 35, dimH: 10, poids: 1.9 }], outgoingParcelCount: 1,
    lignes: [
      { id: 'l-1', factureId: 'f1', desc: 'Mini scelleuse', qte: 1, prix: 16.64, cat: 'cat-a' },
      { id: 'l-2', factureId: 'f1', desc: 'Organisateur évier', qte: 1, prix: 9.92, cat: 'cat-b' },
    ],
    factures: [{ id: 'f1', montant: 26.56, valide: true, statut: 'validee', fichierUrl: 'f1.pdf' }],
    fraisDivers: [],
  };
  const categories = [{ id: 'cat-a', label: 'Cuir', codeHs: '4205', taux: { 974: { om: 5, omr: 2.5 } } }, { id: 'cat-b', label: 'Vaisselle plastique', codeHs: '39241000', taux: { 974: { om: 5, omr: 2.5 } } }];
  const result = calculateQuote({ colis, client: { id: 'c1', type: 'particulier', nom: 'NICE Guillaume' }, destination: { code: '974', nom: 'Réunion', tva: 8.5 }, tarif: { base: 25, parKg: 5 }, categories, settings: { diviseurVolumetrique: 5000 }, mode: 'final' });
  // The first article was classified with the customs catalogue: its code is frozen with the quote.
  if (result.ok) result.snapshot.amounts.taxLines[0].customDuty = { code: '42050090', label: 'Ouvrages en cuir', overrideReason: null };
  return { result, categories };
}

test('savedQuoteBreakdown reads weights, transport, taxes, fees and articles from the snapshot', () => {
  const { result, categories } = savedQuote();
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const detail = savedQuoteBreakdown(result.snapshot, { categories });
  assert.equal(detail.total, 47.65);
  assert.deepEqual([detail.weights.realWeight, detail.weights.volumetricWeight, detail.weights.billableWeight, detail.weights.retained, detail.weights.divisor], [1.9, 2.8, 2.8, 'volumetric', 5000]);
  assert.equal(detail.weights.packages[0].volumetricWeight, 2.8);
  assert.deepEqual(detail.transport, { amount: 39, tarif: { base: 25, perKg: 5 } });
  assert.deepEqual(detail.taxes, { om: 3.28, omr: 1.64, tva: 3.73, tvaRate: 8.5, tvaBase: 43.92 });
  assert.deepEqual(detail.fees, []);
  assert.equal(detail.lines.length, 2);
  assert.deepEqual(detail.lines.map(line => [line.hsCode, line.hsSource, line.value, line.transportShare, line.base]), [['42050090', 'customs', 16.64, 24.43, 41.07], ['39241000', 'category', 9.92, 14.57, 24.49]]);
  assert.equal(sum(detail.lines.map(line => line.transportShare)), detail.transport.amount);
  assert.equal(sum(detail.lines.map(line => line.om)), detail.taxes.om);
  assert.equal(sum(detail.lines.map(line => line.omr)), detail.taxes.omr);
});

test('the real weight is retained when it is the heavier, and old snapshots still give shares', () => {
  const detail = savedQuoteBreakdown({ inputs: { lines: [{ description: 'A', quantity: 2, unitPrice: 10 }, { description: 'B', quantity: 1, unitPrice: 20 }], fees: [{ libelle: 'Emballage', montant: 4 }] }, amounts: { total: 64, transport: 30, realWeight: 5, volumetricWeight: 2, billableWeight: 5, om: 0, omr: 0, tva: 0, fees: 4 } });
  assert.equal(detail.weights.retained, 'real');
  assert.deepEqual(detail.lines.map(line => [line.value, line.transportShare, line.om]), [[20, 15, null], [20, 15, null]]);
  assert.deepEqual(detail.fees, [{ libelle: 'Emballage', montant: 4 }]);
  assert.equal(detail.feesTotal, 4);
  assert.equal(savedQuoteBreakdown(null), null);
  assert.equal(savedQuoteBreakdown({ inputs: {} }), null, 'No saved amounts: nothing to read.');
});
