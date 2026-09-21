import { measureShipment } from './quote.js';

/** A certificate covers exactly the saved outgoing packages. An explicit empty
 * array must not fall back to old scalar totals; only legacy NULL may do so. */
export function hasCurrentPreparation(dossier = {}) {
  if (dossier.preparationCompositionVersion == null || dossier.finalMeasurementsVersion == null
    || dossier.finalMeasurementsVersion !== dossier.preparationCompositionVersion) return false;
  const boxes = dossier.finalPackages == null
    ? [{ dimL: dossier.finL, dimW: dossier.finW, dimH: dossier.finH, poids: dossier.finP }]
    : dossier.finalPackages;
  if (!Array.isArray(boxes) || boxes.length < 1 || boxes.length > 100
    || dossier.outgoingParcelCount !== boxes.length) return false;
  const numeric = /^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$/;
  return boxes.every(box => box && ['dimL', 'dimW', 'dimH', 'poids'].every(key => numeric.test(String(box[key]))))
    && Boolean(measureShipment(boxes));
}
