// Customs choices belong to a dossier. The shared category catalogue is never
// mutated by a quote correction; the server owns provenance and authorisation.
const rate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
export const validDutyRates = rates => !!rates && rate(rates.om) && rate(rates.omr);

export function mapCustomsTariff(row) {
  return {
    tariffId: row.id, code: row.code, label: row.label, destination: row.destination_code,
    baseRates: { om: row.om == null ? null : Number(row.om), omr: row.omr == null ? null : Number(row.omr) },
    source: { id: row.source_id, label: row.source_label, url: row.source_url, date: row.source_date, page: row.page, status: row.source_status },
    notes: row.notes || '', conditions: row.conditions || '',
  };
}

// Proposals are read-only reference rows, never a saved choice or an estimated tax.
export function mapCustomsSuggestions(rows, items, destination) {
  if (!Array.isArray(rows)) throw new Error('Les propositions douanières sont indisponibles. Réessayez.');
  const requested = new Set(items.map(item => item.lineId));
  const seen = new Set();
  const mapped = new Map();
  for (const row of rows) {
    if (!requested.has(row?.lineId) || seen.has(row.lineId) || !Array.isArray(row.candidates)) {
      throw new Error('Les propositions reçues ne correspondent pas aux articles. Réessayez.');
    }
    seen.add(row.lineId);
    const unique = new Set();
    const candidates = row.candidates.slice(0, 5).map(candidate => {
      if (!candidate?.id || unique.has(candidate.id) || candidate.destination_code !== destination ||
          !/^\d{8}(\d{2})?$/.test(candidate.code || '') || !candidate.label || !candidate.source_id) {
        throw new Error('Une proposition douanière est incomplète. Utilisez la recherche manuelle.');
      }
      unique.add(candidate.id);
      return { ...mapCustomsTariff(candidate), matchReason: typeof candidate.matchReason === 'string' ? candidate.matchReason : '' };
    });
    mapped.set(row.lineId, { lineId: row.lineId, candidates,
      ...(typeof row.notice === 'string' && row.notice ? { notice: row.notice } : {}),
      ...(typeof row.status === 'string' && row.status ? { status: row.status } : {}),
    });
  }
  if (seen.size !== requested.size) throw new Error('Certains articles n’ont pas été analysés. Réessayez.');
  return items.map(item => mapped.get(item.lineId));
}

export function resolveLineDuty(line, category, destinationCode) {
  const duty = line.customDuty;
  if (duty == null) {
    const rates = category?.taux?.[destinationCode];
    return { ok: !!category && validDutyRates(rates), rates: rates || null, customs: null,
      errors: !category ? ['Sélectionnez une catégorie connue.'] : !validDutyRates(rates) ? ['Taux manquants ou invalides pour cette destination.'] : [] };
  }
  const errors = [];
  if (duty.stale) errors.push('L’article a changé : vérifiez à nouveau son classement douanier.');
  if (duty.destination !== destinationCode) errors.push('Ce classement douanier ne correspond pas à la destination du devis.');
  if (!duty.tariffId || !/^\d{8}(\d{2})?$/.test(duty.code || '') || !String(duty.label || '').trim() || !duty.source?.id) errors.push('Choisissez une nomenclature douanière complète.');
  if (!validDutyRates(duty.rates)) errors.push('Renseignez les deux taux d’octroi de mer entre 0 et 100 %.');
  const corrected = !validDutyRates(duty.baseRates) || duty.rates?.om !== duty.baseRates.om || duty.rates?.omr !== duty.baseRates.omr;
  if (corrected && !String(duty.overrideReason || '').trim()) errors.push('Indiquez le motif de la correction des taux.');
  return { ok: !errors.length, rates: duty.rates || null, customs: structuredClone(duty), errors };
}

/** Prefer the frozen classification on manifests and published quote exports. */
export function customsDesignation(line, category = {}) {
  const duty = line.customDuty || line.customs;
  if (duty?.stale) throw new Error('Un classement douanier doit être vérifié avant l’export.');
  return { code: duty?.code || category.codeHs || category.code_hs || '', label: duty?.label || category.label || line.desc || line.description || '' };
}
