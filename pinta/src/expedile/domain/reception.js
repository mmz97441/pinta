/** Ignore the empty line reserved for the next scanner input; keep original dimension indexes. */
export function receptionCartons(lines = [], dimensions = {}) {
  return lines.map((line, index) => ({ index, fournisseur: String(line.fournisseur || '').trim(), tracking: String(line.tracking || '').trim() }))
    .filter((line) => line.fournisseur || line.tracking || Object.values(dimensions[line.index] || {}).some(value => value !== '' && value != null));
}
export function receptionMeasurements(lines, dimensions = {}) {
  const cartons = receptionCartons(lines, dimensions);
  if (!cartons.length) return null;
  const boxes = cartons.map(({ index }) => Object.fromEntries(['dimL', 'dimW', 'dimH', 'poids'].map((key) => [key, Number(dimensions[index]?.[key])])));
  if (boxes.some((box) => Object.values(box).some((value) => !Number.isFinite(value) || value <= 0))) return null;
  return { dimsParColis: boxes, dimL: Math.max(...boxes.map((box) => box.dimL)), dimW: Math.max(...boxes.map((box) => box.dimW)), dimH: Math.max(...boxes.map((box) => box.dimH)), poids: Math.round(boxes.reduce((sum, box) => sum + box.poids, 0) * 100) / 100 };
}
export const RECEPTION_MEASURES = [
  { key: 'dimL', label: 'Longueur', unit: 'cm' },
  { key: 'dimW', label: 'Largeur', unit: 'cm' },
  { key: 'dimH', label: 'Hauteur', unit: 'cm' },
  { key: 'poids', label: 'Poids', unit: 'kg' },
];
const positive = (value) => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) > 0;
export function receptionMeasurementIssues(lines = [], dimensions = {}, cartonOffset = 0) {
  const issues = [];
  lines.forEach((line, index) => {
    const active = String(line.fournisseur || '').trim() || String(line.tracking || '').trim()
      || RECEPTION_MEASURES.some(({ key }) => dimensions[index]?.[key] !== '' && dimensions[index]?.[key] != null);
    if (!active) return;
    RECEPTION_MEASURES.forEach(({ key, label, unit }) => {
      if (!positive(dimensions[index]?.[key])) issues.push({ index, key, message: `Carton ${cartonOffset + index + 1} : ${label.toLowerCase()} à réception (${unit}) requise, avec une valeur supérieure à zéro.` });
    });
  });
  return issues;
}
/** Keep legacy gaps explicit; never split a multi-carton total into invented box measurements. */
export function receptionCartonManifest(existing = {}) {
  const detail = existing.trackingsDetail || [];
  const trackings = (existing.trackings || []).map(value => String(value || '').trim()).filter(Boolean);
  const dimensions = existing.dimsParColis || [];
  const nbColis = Math.max(Number(existing.nbColis) || 0, detail.length, trackings.length, dimensions.length, 1);
  const known = new Set(detail.map((line) => line.number).filter(Boolean));
  const remaining = trackings.filter((number) => !known.has(number));
  const trackingsDetail = Array.from({ length: nbColis }, (_, index) => detail[index]
    ? { ...detail[index], number: detail[index].number || '', fournisseur: detail[index].fournisseur || '' }
    : { number: remaining.shift() || '', fournisseur: '' });
  const dimsParColis = Array.from({ length: nbColis }, (_, index) => {
    const source = dimensions[index] || (nbColis === 1 && dimensions.length === 0 ? existing : {});
    return Object.fromEntries(RECEPTION_MEASURES.map(({ key }) => [key, positive(source[key]) ? Number(source[key]) : null]));
  });
  return { nbColis, trackings, trackingsDetail, dimsParColis };
}
export function hasCompleteReceptionMeasurements(colis = {}) {
  const manifest = receptionCartonManifest(colis);
  return manifest.dimsParColis.every((box) => RECEPTION_MEASURES.every(({ key }) => positive(box[key])));
}
/** Append measured new physical cartons without changing original/final measurement meaning. */
export function mergeReceptionCartons(existing, lines, dimensions) {
  const measurements = receptionMeasurements(lines, dimensions);
  if (!measurements || receptionMeasurementIssues(lines, dimensions).length) return null;
  const before = receptionCartonManifest(existing);
  const cartons = receptionCartons(lines, dimensions);
  const dimsParColis = [...before.dimsParColis, ...measurements.dimsParColis];
  const complete = dimsParColis.every((box) => RECEPTION_MEASURES.every(({ key }) => positive(box[key])));
  return {
    nbColis: before.nbColis + cartons.length,
    trackings: [...before.trackings, ...cartons.map((carton) => carton.tracking).filter(Boolean)],
    trackingsDetail: [...before.trackingsDetail, ...cartons.map((carton) => ({ number: carton.tracking, fournisseur: carton.fournisseur }))],
    dimsParColis,
    dimL: complete ? Math.max(...dimsParColis.map((box) => box.dimL)) : null,
    dimW: complete ? Math.max(...dimsParColis.map((box) => box.dimW)) : null,
    dimH: complete ? Math.max(...dimsParColis.map((box) => box.dimH)) : null,
    poids: complete ? Math.round(dimsParColis.reduce((sum, box) => sum + box.poids, 0) * 100) / 100 : null,
  };
}
export function removeReceptionCarton(form, index) {
  const lines = form.trackingLines.filter((_, current) => current !== index);
  const multiDims = Object.fromEntries(Object.entries(form.multiDims || {}).filter(([key]) => Number(key) !== index).map(([key, value]) => [Number(key) > index ? Number(key) - 1 : Number(key), value]));
  return { ...form, trackingLines: lines.length ? lines : [{ fournisseur: '', tracking: '' }], multiDims };
}
