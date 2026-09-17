import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCustomsTariff, mapCustomsSuggestions, resolveLineDuty, customsDesignation } from './customs.js';
import { calculateQuote, quoteInputFingerprint } from './quote.js';

const duty = () => ({ tariffId: 'source-p1-r1', code: '01012100', label: 'Désignation officielle', destination: '974',
  baseRates: { om: 4, omr: 2.5 }, rates: { om: 4, omr: 2.5 }, source: { id: 'reference', label: 'Référence de test', page: 1, status: 'reference' }, overrideReason: null });
const category = { id: 'c', label: 'Catégorie historique', codeHs: '99990000', taux: { '974': { om: 10, omr: 2.5 } } };
const fixture = () => ({ colis: { finL: 40, finW: 30, finH: 20, finP: 3, dimL: 40, dimW: 30, dimH: 20, poids: 3,
  lignes: [{ id: 'line', desc: 'Article de la facture', qte: 1, prix: 100, cat: 'c', factureId: 'f', customDuty: duty() }],
  factures: [{ id: 'f', montant: 100, valide: true, fichier: 'f.pdf' }] },
  client: { type: 'particulier' }, destination: { code: '974', nom: 'Réunion', tva: 8.5 }, tarif: { base: 10, parKg: 5 }, categories: [structuredClone(category)] });

test('catalogue distinguishes missing rate from zero, preserves leading zero and provenance', () => {
  const item = mapCustomsTariff({ id: 't', code: '01012100', om: null, omr: '0', source_id: 's', source_date: '2025-12-18', page: 410 });
  assert.deepEqual(item.baseRates, { om: null, omr: 0 }); assert.equal(item.code, '01012100'); assert.equal(item.source.page, 410);
});
test('quote uses classification rates for current and before-optimisation amounts', () => {
  const input = fixture(); input.colis.dimL = 80;
  const result = calculateQuote(input);
  assert.equal(result.ok, true); assert.equal(result.amounts.om, 5.36); assert.equal(result.before.om, 6.32);
  assert.equal(result.snapshot.inputs.lines[0].description, 'Article de la facture');
  assert.equal(result.snapshot.inputs.lines[0].customDuty.label, 'Désignation officielle');
});
test('manual zero rates affect this dossier only and remain frozen in the snapshot', () => {
  const input = fixture(); const line = input.colis.lignes[0];
  line.customDuty.rates = { om: 0, omr: 0 }; line.customDuty.overrideReason = 'Exonération vérifiée';
  const result = calculateQuote(input);
  assert.equal(result.ok, true); assert.equal(result.amounts.om, 0); assert.equal(result.amounts.omr, 0);
  assert.equal(input.categories[0].taux['974'].om, 10); assert.equal(calculateQuote(fixture()).amounts.om, 5.36);
  line.customDuty.rates.om = 17; line.customDuty.source.label = 'changed';
  assert.equal(result.snapshot.inputs.lines[0].customDuty.rates.om, 0);
  assert.equal(result.snapshot.inputs.lines[0].customDuty.source.label, 'Référence de test');
});
test('unknown, stale, incomplete and wrong-destination classifications never use category fallback', () => {
  for (const change of [{ stale: true }, { destination: '972' }, { code: '010121' }, { rates: { om: null, omr: 0 } }, { rates: { om: 7, omr: 0 }, overrideReason: '' }]) {
    const input = fixture(); Object.assign(input.colis.lignes[0].customDuty, change);
    assert.equal(calculateQuote(input).ok, false, JSON.stringify(change));
  }
  assert.equal(resolveLineDuty({ customDuty: { stale: true } }, category, '974').ok, false);
});
test('reference with absent rates needs explicit rates and correction reason', () => {
  const customDuty = { ...duty(), baseRates: { om: null, omr: null }, rates: { om: 4, omr: 2.5 } };
  assert.equal(resolveLineDuty({ customDuty }, category, '974').ok, false);
  customDuty.overrideReason = 'Taux confirmé avec le déclarant';
  assert.equal(resolveLineDuty({ customDuty }, category, '974').ok, true);
});
test('valid ten-digit subdivisions are retained without truncation', () => {
  const customDuty = { ...duty(), code: '2007999710' };
  assert.equal(resolveLineDuty({ customDuty }, category, '974').ok, true);
  assert.equal(customsDesignation({ customDuty }, category).code, '2007999710');
});
test('correction, code and source changes invalidate quote fingerprint', () => {
  const input = fixture(); const original = quoteInputFingerprint(calculateQuote(input).snapshot);
  for (const change of [{ code: '01012910' }, { overrideReason: 'Révision vérifiée' }, { source: { id: 'new' } }]) {
    const changed = structuredClone(input); Object.assign(changed.colis.lignes[0].customDuty, change);
    assert.notEqual(quoteInputFingerprint(calculateQuote(changed).snapshot), original);
  }
});
test('legacy lines use their own destination category; exports prefer frozen classification', () => {
  assert.equal(resolveLineDuty({}, category, '974').rates.om, 10);
  assert.equal(resolveLineDuty({}, category, '972').ok, false);
  assert.deepEqual(customsDesignation({ customDuty: duty(), desc: 'Invoice' }, category), { code: '01012100', label: 'Désignation officielle' });
  assert.throws(() => customsDesignation({ customDuty: { stale: true } }, category));
});
test('rates outside the allowed range and non-numeric values block calculation', () => {
  for (const om of [-1, 101, NaN, Infinity, '', '4', null]) {
    assert.equal(resolveLineDuty({ customDuty: { ...duty(), rates: { om, omr: 2.5 }, overrideReason: 'reason' } }, category, '974').ok, false);
  }
});

test('automatic proposals retain reference rates and do not become applied quote choices', () => {
  const items = [{ lineId: 'line', description: 'Produit de la facture' }];
  const row = { id: 'ref', code: '01012100', label: 'Libellé officiel', destination_code: '974', om: null, omr: '0', source_id: 'edition', matchReason: 'Mots de la description' };
  const [result] = mapCustomsSuggestions([{ lineId: 'line', candidates: [row] }], items, '974');
  assert.deepEqual(result.candidates[0].baseRates, { om: null, omr: 0 });
  assert.equal(result.candidates[0].matchReason, 'Mots de la description');
  assert.equal(result.candidates[0].rates, undefined);
  assert.equal(result.customDuty, undefined);
  const input = fixture(); delete input.colis.lignes[0].customDuty;
  const before = calculateQuote(input).snapshot;
  input.colis.lignes[0].suggestions = result.candidates;
  assert.deepEqual(calculateQuote(input).snapshot, before);
});
test('incomplete or unrelated suggestion batches are not shown as successful analyses', () => {
  const items = [{ lineId: 'a' }, { lineId: 'b' }];
  for (const rows of [null, {}, [{ lineId: 'a', candidates: [] }], [{ lineId: 'a', candidates: [] }, { lineId: 'a', candidates: [] }], [{ lineId: 'a', candidates: [] }, { lineId: 'other', candidates: [] }]]) {
    assert.throws(() => mapCustomsSuggestions(rows, items, '974'));
  }
  assert.deepEqual(mapCustomsSuggestions([{ lineId: 'b', candidates: [] }, { lineId: 'a', candidates: [] }], items, '974'), [{ lineId: 'a', candidates: [] }, { lineId: 'b', candidates: [] }]);
});
test('a suggestion for another destination or a fabricated reference is rejected', () => {
  const row = { id: 'r', code: '01012100', label: 'Produit', destination_code: '974', source_id: 'official' };
  for (const invalid of [{ destination_code: '972' }, { source_id: null }, { code: '123' }, { id: null }]) {
    assert.throws(() => mapCustomsSuggestions([{ lineId: 'a', candidates: [{ ...row, ...invalid }] }], [{ lineId: 'a' }], '974'));
  }
});
