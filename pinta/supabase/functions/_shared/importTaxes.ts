// Edge copy of the {{estimation_taxes}} wording of src/expedile/domain/importTaxes.js (decision of the
// direction, 10 October 2026: the amounts the quote engine computes as octroi de mer, OMR and « TVA » are
// an estimate of the import taxes due at destination, paid on arrival and included in the price, never a
// tax collected by Expedîle France). Change both files together: tests/import-taxes.test.mjs renders
// both and requires the same text.

export const IMPORT_TAX_PLACES: Record<string, { at: string; of: string }> = {
  974: { at: 'à La Réunion', of: 'de La Réunion' },
  976: { at: 'à Mayotte', of: 'de Mayotte' },
  971: { at: 'en Guadeloupe', of: 'de la Guadeloupe' },
  972: { at: 'en Martinique', of: 'de la Martinique' },
};
const CODES_BY_NAME: Record<string, string> = { 'la réunion': '974', réunion: '974', mayotte: '976', guadeloupe: '971', martinique: '972' };
const ELSEWHERE = { at: 'à destination', of: 'à destination' };
const NOTE = 'payées à l’arrivée, comprises dans le prix';
const PARTS: [string, string][] = [['om', 'octroi de mer'], ['omr', 'octroi de mer régional'], ['tva', 'TVA à l’importation']];

export function importTaxPlace(destination: any): { at: string; of: string } {
  const code = String(destination?.code ?? '').trim() || CODES_BY_NAME[String(destination?.nom || destination?.label || '').trim().toLowerCase()];
  return IMPORT_TAX_PLACES[code] || ELSEWHERE;
}

const cents = (value: unknown) => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? Math.round(number * 100) : 0;
};

/** The {{estimation_taxes}} block: the estimate and its detail, or the sentence that says why there is none; empty for a professional. */
export function importTaxMessage(amounts: { om?: unknown; omr?: unknown; tva?: unknown; total?: unknown }, destination: any, professional: boolean, money: (value: number) => string): string {
  if (professional) return '';
  if (!(Number(amounts.total) > 0)) return 'Estimation des taxes à l’importation : à calculer avec le devis.';
  const place = importTaxPlace(destination);
  const lines = PARTS.map(([key, name]) => ({ name, value: cents((amounts as Record<string, unknown>)[key]) })).filter(line => line.value > 0);
  if (!lines.length) return `Aucune taxe à l’importation n’est estimée ${place.at} pour ce devis.`;
  const total = lines.reduce((sum, line) => sum + line.value, 0) / 100;
  return [`Estimation des taxes à l’importation ${place.at} (${NOTE}) : ${money(total)}`,
    ...lines.map(line => `• dont estimation ${line.name} ${place.of} : ${money(line.value / 100)}`)].join('\n');
}
