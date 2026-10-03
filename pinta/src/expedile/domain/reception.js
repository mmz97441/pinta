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
  const activeIndexes = new Set(receptionCartons(lines, dimensions).map((line) => line.index));
  const lastActive = Math.max(-1, ...activeIndexes);
  lines.forEach((line, index) => {
    const active = String(line.fournisseur || '').trim() || String(line.tracking || '').trim()
      || RECEPTION_MEASURES.some(({ key }) => dimensions[index]?.[key] !== '' && dimensions[index]?.[key] != null);
    if (!active) {
      if (index < lastActive) issues.push({ index, key: 'tracking', message: `Carton ${cartonOffset + index + 1} : cette ligne est vide avant un carton renseigné. Supprimez-la ou complétez ses mesures avant d’enregistrer.` });
      return;
    }
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

/** A received box can join an unpaid dossier; later milestones require a deliberate restart. */
export const RECEPTION_APPEND_STATUSES = ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement'];
export function receptionAppendBlockReason(colis = {}) {
  if (colis.archive) return 'Ce dossier est archivé. Choisissez une autre expédition.';
  if (colis.paiementDate || colis.paiementMontant > 0 || colis.statut === 'paye') return 'Le paiement est déjà enregistré. Un responsable doit vérifier ce dossier avant tout ajout.';
  if (!RECEPTION_APPEND_STATUSES.includes(colis.statut)) return 'Cette expédition ne peut plus recevoir de carton. Choisissez une autre expédition.';
  if (colis.payplugPaymentId || colis.payplugPaymentUrl) return 'Un lien de paiement existe. Corrigez le devis pour désactiver ce lien avant d’ajouter un carton.';
  return '';
}
export function receptionAppendImpact(colis = {}) {
  if (['devis_envoye', 'attente_paiement'].includes(colis.statut) || colis.devisTotal != null || colis.devisSnapshot) return 'Cet ajout conserve les cartons et les factures. Il faudra redemander l’accord du client, vérifier la préparation et refaire le devis. L’ancien devis sera conservé dans l’historique.';
  if (colis.statut === 'en_preparation') return 'Cet ajout conserve les cartons et les factures. Il faudra redemander l’accord du client et vérifier la préparation avec le nouveau carton.';
  if (colis.statut === 'autorise' || colis.statut === 'attente_feu_vert' || colis.feuVert === 'autorise' || colis.demandeFeuVertEnvoyeeAt) return 'Il faudra redemander l’accord du client pour inclure ce nouveau carton. L’ajout n’envoie aucun message.';
  return '';
}

/** Reception may return to its source dossier, but the saved dossier must return to its source list. */
export function receptionDossierReturn(value) {
  let path = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/colis';
    if (!/^\/colis\/[^/?#]+/.test(path)) return /^\/reception(?:[/?#]|$)/.test(path) ? '/colis' : path;
    path = new URL(path, 'https://pinta.invalid').searchParams.get('returnTo');
  }
  return '/colis';
}

/** Per-carton arrival evidence is separate from carton identity/measurements.
 * A dossier's initial date never dates every later carton by implication. */
export function receptionDateSummary(dossier = {}, { now = Date.now() } = {}) {
  const length = value => Array.isArray(value) ? value.length : 0;
  const totalCount = Math.max(Number(dossier.nbColis) || 0, length(dossier.trackingsDetail), length(dossier.trackings), length(dossier.dimsParColis), 1);
  const evidence = Array.isArray(dossier.receptionDates) ? dossier.receptionDates : [];
  const sources = new Set(['server', 'append_receipt', 'initial_receipt', 'audit']);
  const dates = Array.from({ length: totalCount }, (_, index) => {
    const entry = evidence[index], value = entry?.receivedAt;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !sources.has(entry?.source) || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now
      || new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
    return { receivedAt: value, source: entry.source };
  });
  const known = dates.filter(Boolean).sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  return { dates, totalCount, knownCount: known.length, complete: known.length === totalCount,
    firstReceivedAt: known[0]?.receivedAt || null, lastReceivedAt: known.at(-1)?.receivedAt || null,
    error: dossier.receptionDatesError === true };
}
