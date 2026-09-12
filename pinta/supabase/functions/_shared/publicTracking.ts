/** Public physical facts only: no customer identity, prices, notes or provider URLs. */
export function publicTrackingFacts(c: Record<string, unknown>) {
  const rows = (value: unknown) => Array.isArray(value) ? value : [];
  const dimension = (value: unknown) => {
    if (!value || typeof value !== 'object') return null;
    const box = value as Record<string, unknown>;
    if (!['dimL', 'dimW', 'dimH', 'poids'].every(key => Number.isFinite(Number(box[key])) && Number(box[key]) > 0)) return null;
    return { L: Number(box.dimL), W: Number(box.dimW), H: Number(box.dimH), P: Number(box.poids) };
  };
  const receivedCount = Math.max(1, Number(c.nb_colis) || 0, rows(c.dims_par_colis).length, rows(c.trackings_detail).length, rows(c.trackings).filter(Boolean).length);
  const reception = rows(c.dims_par_colis);
  const receptionCartons = Array.from({ length: receivedCount }, (_, index) => dimension(reception[index] || (receivedCount === 1 && reception.length === 0 ? { dimL: c.dim_l, dimW: c.dim_w, dimH: c.dim_h, poids: c.poids } : null)));
  const hasVersion = c.preparation_composition_version != null;
  const preparationNeedsReview = hasVersion && c.final_measurements_version !== c.preparation_composition_version;
  const prepared = rows(c.final_packages).map(dimension);
  const outgoingParcelCount = Number.isInteger(Number(c.outgoing_parcel_count)) && Number(c.outgoing_parcel_count) > 0 ? Number(c.outgoing_parcel_count) : null;
  const preparedPackages = !preparationNeedsReview && prepared.length > 0 && prepared.every(Boolean) && outgoingParcelCount === prepared.length ? prepared : [];
  const quoteNeedsReview = !c.paiement_date && (['devis_envoye', 'attente_paiement'].includes(String(c.statut)) || !!c.devis_envoye_le) && (c.devis_brouillon === true || !(Number(c.devis_total) > 0));
  const snapshot = c.devis_snapshot as { inputs?: { destination?: { code?: string } } } | null;
  return { receivedCount, receptionCartons, outgoingParcelCount, preparedPackages, preparationNeedsReview, quoteNeedsReview,
    destinationCode: c.paiement_date ? snapshot?.inputs?.destination?.code || null : null };
}
