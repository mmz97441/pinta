import { measureShipment } from './quote.js';

export function departureReadiness(dossier) {
  const packages = dossier.finalPackages?.length ? dossier.finalPackages : [{ dimL: dossier.finL, dimW: dossier.finW, dimH: dossier.finH, poids: dossier.finP }];
  const weights = measureShipment(packages);
  const legacySingle = !dossier.finalPackages?.length && !dossier.outgoingParcelCount && Boolean(weights);
  const count = legacySingle ? 1 : Number(dossier.outgoingParcelCount) || 0;
  const outdated = dossier.preparationCompositionVersion != null && dossier.finalMeasurementsVersion !== dossier.preparationCompositionVersion;
  const reasons = [];
  if (dossier.statut !== 'paye') reasons.push({ text: 'Paiement non confirmé', task: 'paiement' });
  if (!weights || !count || outdated || (dossier.finalPackages?.length && count !== packages.length)) reasons.push({ text: outdated ? 'Mesures à revoir après modification des cartons' : 'Mesures ou nombre de colis préparés incomplets', task: 'preparation' });
  return { eligible: reasons.length === 0, reasons, count, weights, legacySingle };
}
