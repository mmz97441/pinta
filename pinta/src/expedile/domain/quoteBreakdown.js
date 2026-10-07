import { roundMoney } from './quote.js';

// The saved quote read back for the team and for the customs documents: weights,
// transport, taxes, fees and each article's share. Every amount comes from the frozen
// snapshot (devis_snapshot); nothing is recalculated with today's tariff, rates or
// divisor. The rules are those of quote.js and save_quote: the billed weight is the
// heavier of the total real weight and the total volumetric weight, and the transport
// is shared between articles in proportion to their value (quantity × unit price HT).

const finite = value => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value));
const num = value => (finite(value) ? Number(value) : null);

/**
 * Splits `total` (euros) into cents in proportion to `weights`, so that the parts add
 * up exactly to the total: each part gets its floor, then the remaining cents go to the
 * largest remainders (ties: the first line). A zero or invalid weight gets nothing;
 * without any positive weight, every part is 0.
 */
export function allocateCents(total, weights) {
  const list = Array.isArray(weights) ? weights.map(weight => (finite(weight) && Number(weight) > 0 ? Number(weight) : 0)) : [];
  const cents = Math.round(roundMoney(num(total) || 0) * 100);
  const sum = list.reduce((acc, weight) => acc + weight, 0);
  if (!list.length || sum <= 0 || cents === 0) return list.map(() => 0);
  const sign = cents < 0 ? -1 : 1;
  const absolute = Math.abs(cents);
  const exact = list.map(weight => absolute * weight / sum);
  const parts = exact.map(value => Math.floor(value));
  let rest = absolute - parts.reduce((acc, part) => acc + part, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - parts[index] }))
    .filter(item => list[item.index] > 0)
    .sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));
  for (let k = 0; rest > 0 && order.length; k = (k + 1) % order.length, rest -= 1) parts[order[k].index] += 1;
  return parts.map(part => (sign * part) / 100);
}

/**
 * The divisor a saved quote was priced with. The server computes the volumetric weight
 * with its own divisor while the snapshot keeps the one the browser sent: when they
 * differ (a browser still holding an older setting), the divisor implied by the saved
 * amounts (total volume ÷ saved volumetric weight) is the one that was billed.
 */
export function savedQuoteDivisor(snapshot) {
  const inputs = snapshot?.inputs || {};
  const stated = num(inputs.volumetricDivisor);
  const volumes = (Array.isArray(inputs.finalPackages) ? inputs.finalPackages : []).map(box => ['dimL', 'dimW', 'dimH'].reduce((product, key) => product * (num(box?.[key]) || 0), 1));
  const totalVolume = volumes.reduce((sum, volume) => sum + volume, 0);
  const saved = num(snapshot?.amounts?.volumetricWeight);
  if (volumes.length && volumes.every(volume => volume > 0) && saved > 0) {
    const implied = totalVolume / saved;
    if (stated > 0 && Math.abs(implied - stated) <= stated * 1e-6) return stated;
    return Math.round(implied * 1000) / 1000;
  }
  return stated > 0 ? stated : null;
}

/** The volumetric weight of one parcel (L × l × h ÷ divisor, in kg), or null. */
export function parcelVolumetricWeight(box, divisor) {
  const dims = ['dimL', 'dimW', 'dimH'].map(key => num(box?.[key]));
  const value = num(divisor);
  return value > 0 && dims.every(dim => dim > 0) ? (dims[0] * dims[1] * dims[2]) / value : null;
}

/**
 * The detail of a saved quote, or null without saved amounts:
 * - `weights`: real, volumetric and billable totals, which one was retained
 *   ('volumetric' when it is the heavier, otherwise 'real'), the divisor used and each
 *   parcel with its own volumetric weight;
 * - `transport`: amount and the tariff used (flat rate + price per kg), when stored;
 * - `taxes`: OM, OMR, TVA, the TVA rate and its base (transport + OM + OMR);
 * - `fees` and `feesTotal`;
 * - `lines`: each article with its value, its transport share, its OM/OMR base and its
 *   OM/OMR amounts in cents (shares add up exactly to the totals), its HS code (the
 *   customs classification frozen with the quote, otherwise the article's category).
 */
export function savedQuoteBreakdown(snapshot, { categories = [] } = {}) {
  const amounts = snapshot?.amounts;
  const inputs = snapshot?.inputs || {};
  if (!amounts || !finite(amounts.total)) return null;
  const categoryById = new Map((Array.isArray(categories) ? categories : []).map(category => [category.id, category]));
  const divisor = savedQuoteDivisor(snapshot);
  const packages = (Array.isArray(inputs.finalPackages) ? inputs.finalPackages : []).map(box => ({
    dimL: num(box?.dimL), dimW: num(box?.dimW), dimH: num(box?.dimH), poids: num(box?.poids),
    volumetricWeight: parcelVolumetricWeight(box, divisor),
  }));
  const realWeight = num(amounts.realWeight);
  const volumetricWeight = num(amounts.volumetricWeight);
  const billableWeight = num(amounts.billableWeight);
  const retained = billableWeight === null ? null : (volumetricWeight !== null && realWeight !== null && volumetricWeight > realWeight ? 'volumetric' : 'real');
  const transport = num(amounts.transport) || 0;
  const tarif = finite(inputs.tarif?.base) && finite(inputs.tarif?.parKg) ? { base: Number(inputs.tarif.base), perKg: Number(inputs.tarif.parKg) } : null;

  const taxLines = Array.isArray(amounts.taxLines) && amounts.taxLines.length ? amounts.taxLines : null;
  const source = taxLines || (Array.isArray(inputs.lines) ? inputs.lines : []);
  const values = source.map(line => (finite(line.value) ? Number(line.value) : (num(line.quantity) || 0) * (num(line.unitPrice) || 0)));
  const shares = allocateCents(transport, values);
  const om = num(amounts.om) || 0;
  const omr = num(amounts.omr) || 0;
  // Per-article taxes exist only when the snapshot kept them (taxLines).
  const omParts = taxLines ? allocateCents(om, taxLines.map(line => num(line.om) || 0)) : null;
  const omrParts = taxLines ? allocateCents(omr, taxLines.map(line => num(line.omr) || 0)) : null;
  const lines = source.map((line, index) => {
    const category = categoryById.get(line.categoryId) || null;
    const duty = line.customDuty || null;
    const hsCode = String(duty?.code || category?.codeHs || category?.code_hs || '').trim() || null;
    const value = roundMoney(values[index] || 0);
    return {
      id: line.id ?? null,
      description: String(line.description || '').trim(),
      quantity: num(line.quantity),
      unitPrice: num(line.unitPrice),
      value,
      transportShare: shares[index],
      base: roundMoney(value + shares[index]),
      rates: line.rates ? { om: num(line.rates.om), omr: num(line.rates.omr) } : null,
      om: omParts ? omParts[index] : null,
      omr: omrParts ? omrParts[index] : null,
      hsCode,
      hsLabel: duty?.label || category?.label || line.categoryLabel || null,
      hsSource: duty?.code ? 'customs' : hsCode ? 'category' : null,
      overrideReason: duty?.overrideReason || null,
    };
  });
  const feeList = Array.isArray(inputs.fees) ? inputs.fees : Array.isArray(snapshot.fraisDivers) ? snapshot.fraisDivers : [];
  const fees = feeList.map(fee => ({ libelle: String(fee?.libelle || '').trim(), montant: num(fee?.montant) || 0 }));
  const tva = num(amounts.tva) || 0;
  return {
    professional: inputs.client?.type === 'pro',
    weights: { realWeight, volumetricWeight, billableWeight, retained, divisor, packages },
    transport: { amount: transport, tarif },
    taxes: { om, omr, tva, tvaRate: num(inputs.destination?.tva), tvaBase: roundMoney(transport + om + omr) },
    fees,
    feesTotal: num(amounts.fees) ?? roundMoney(fees.reduce((sum, fee) => sum + fee.montant, 0)),
    merchandiseValue: num(amounts.merchandiseValue),
    lines,
    total: Number(amounts.total),
    savings: num(snapshot.savings) || 0,
  };
}
