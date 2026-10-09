import { DOSSIER_TOTAL_KINDS, dossierTableNumber, countLabel, volumetricWeightLabel } from './dossierTable.js';
import { kg } from '../utils/format.js';

/** A column with a total whose displayed dossiers have no value at all. */
export const TOTAL_UNKNOWN_LABEL = 'Non renseigné';

const COUNT = new Intl.NumberFormat('fr-FR');
const MONEY = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const WEIGHT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
// Whole parcels, hundredths of a kilogram (as the cells round the weights) and cents:
// sums of integers, exact whatever the order of the dossiers.
const SCALE = Object.freeze({ count: 1, weight: 100, volumetric: 100, money: 100 });

/** A total written like its column's cells: « 1 250,00 € », « 45,2 », « 12,5 kg vol. », « 24 ». */
export function formatDossierTableTotal(kind, value) {
  if (kind === 'money') return MONEY.format(value);
  if (kind === 'weight') return WEIGHT.format(value);
  if (kind === 'volumetric') return volumetricWeightLabel(value);
  return COUNT.format(value);
}

/**
 * The totals of the dossiers given, for each of `columns` that adds up
 * (DOSSIER_TOTAL_KINDS): the caller passes the dossiers displayed (search, tab,
 * work, owner and column filters applied), so a total follows what is shown and
 * never the order. Each value is the cell's own (dossierTableNumber); a dossier
 * whose cell shows no value (« À calculer », « À vérifier », not measured yet)
 * is left out and counted: `note` « 4 sur 6 dossiers », `description` for
 * assistive technology. A draft amount is shown, so it counts. Nothing known:
 * « Non renseigné », never 0.
 * → { count, columns: { [key]: { key, kind, value, known, missing, count, text, note, description } } }
 */
export function dossierTableTotals(dossiers, columns, models) {
  const list = Array.isArray(dossiers) ? dossiers : [];
  const count = list.length;
  const totals = {};
  for (const column of columns || []) {
    const kind = DOSSIER_TOTAL_KINDS[column?.key];
    if (!kind || totals[column.key]) continue;
    let units = 0, known = 0;
    for (const dossier of list) {
      const value = dossierTableNumber(column, { dossier, model: models?.get?.(dossier.id) });
      if (typeof value !== 'number') continue;
      units += Math.round(value * SCALE[kind]);
      known += 1;
    }
    const value = known ? units / SCALE[kind] : null;
    const missing = count - known;
    const partial = value !== null && missing > 0;
    totals[column.key] = Object.freeze({
      key: column.key, kind, value, known, missing, count,
      text: value === null ? TOTAL_UNKNOWN_LABEL : formatDossierTableTotal(kind, value),
      note: partial ? `${COUNT.format(known)} sur ${countLabel(count, 'dossier')}` : '',
      description: partial ? `Total de ${countLabel(known, 'dossier')} sur ${COUNT.format(count)} ; ${COUNT.format(missing)} sans valeur.` : '',
    });
  }
  return { count, columns: totals };
}

/** Whether these totals have anything to show: at least one column adds up. */
export function hasDossierTableTotals(totals) {
  return Boolean(totals?.count) && Object.keys(totals.columns || {}).length > 0;
}

/** Table: « Total · 12 dossiers », or « Total des 12 dossiers filtrés » when a search or a filter applies. */
export function dossierTableTotalLabel(count, { filtered = false } = {}) {
  if (!filtered) return `Total · ${countLabel(count, 'dossier')}`;
  return count === 1 ? 'Total du dossier filtré' : `Total des ${COUNT.format(count)} dossiers filtrés`;
}

/** The row that closes a group: « Sous-total · 3 dossiers ». */
export function dossierTableSubtotalLabel(count) {
  return `Sous-total · ${countLabel(count, 'dossier')}`;
}

/** Cards: the block that ends the list, « Total des 12 dossiers » (« … filtrés »). */
export function dossierCardTotalLabel(count, { filtered = false } = {}) {
  if (count === 1) return filtered ? 'Total du dossier filtré' : 'Total du dossier';
  return `Total des ${COUNT.format(count)} dossiers${filtered ? ' filtrés' : ''}`;
}

/** The one-line subtotal under a group heading of the cards, in the order of the
 * columns, with their short labels: « Poids 45,2 kg · Prix 1 250,00 € · Transport
 * 1 070,00 € · Taxes 180,00 € ».
 * The weight takes its unit, which its column heading otherwise gives. */
export function dossierTableTotalSummary(totals, columns) {
  return (columns || []).filter(column => totals?.columns?.[column.key]).map(column => {
    const total = totals.columns[column.key];
    const weight = total.kind === 'weight' && total.value !== null;
    return {
      key: column.key,
      label: column.key === 'optimizedWeight' ? 'Poids' : column.shortLabel || column.label,
      text: weight ? kg(total.value) : total.text,
      known: total.value !== null,
      note: total.note,
      description: total.description,
    };
  });
}
