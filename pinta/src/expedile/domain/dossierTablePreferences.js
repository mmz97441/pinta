import { isDossierTableColumnSortable, formatDossierTableDate } from './dossierTable.js';

export const COLUMN_FILTER_PREFIX = 'col.';
const widths = { ref: 140, client: 180, statusLabel: 155, paymentState: 140, statut: 190, owner: 125, casier: 90, cartons: 90, receivedAt: 130, optimizedDimensions: 190, optimizedWeight: 110, requested: 130, paid: 115, remaining: 130, sentAt: 130, departure: 140, destination: 115, packages: 135, readiness: 195, action: 140 };
// Each dossier preset and Mon travail (`work`) keep their own reading choices.
const PREFERENCE_VIEWS = ['daily', 'payments', 'departures', 'work'];
const preferenceView = view => PREFERENCE_VIEWS.includes(view);
export const DOSSIER_TEXT_SIZE_BOUNDS = Object.freeze({ min: 5, max: 20, initial: 12 });
/** Mon travail opens at a reading size close to its former text; the dossier
 * tables keep their compact 12px. */
export function tableTextSizeInitial(view) {
  return view === 'work' ? 15 : DOSSIER_TEXT_SIZE_BOUNDS.initial;
}
export function sanitizeDossierTextSize(value, initial = DOSSIER_TEXT_SIZE_BOUNDS.initial) {
  const { min, max } = DOSSIER_TEXT_SIZE_BOUNDS;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : initial;
}
export function dossierTextSizeStorageKey(userId, view) {
  return userId && preferenceView(view) ? `expedile:table-text:v1:${encodeURIComponent(userId)}:${view}` : null;
}
export function sanitizeDossierTableLayout(value) {
  return ['auto', 'table', 'cards'].includes(value) ? value : 'auto';
}
export function dossierLayoutStorageKey(userId, view) {
  return userId && preferenceView(view) ? `expedile:table-layout:v1:${encodeURIComponent(userId)}:${view}` : null;
}
export function columnWidthBounds(column) {
  const min = column?.key === 'action' ? 132 : column?.key === 'optimizedDimensions' ? 110 : ['ref', 'client'].includes(column?.key) ? 96 : 64;
  const initial = Math.max(min, widths[column?.key] || 140);
  return { min, max: column?.key === 'action' ? 280 : 600, initial };
}
export function clampColumnWidth(column, value) {
  const { min, max, initial } = columnWidthBounds(column);
  return value != null && value !== '' && Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : initial;
}
export function columnWidthsStorageKey(userId, view) {
  return userId && preferenceView(view) ? `expedile:table-widths:v1:${encodeURIComponent(userId)}:${view}` : null;
}
export function columnVisibilityStorageKey(userId, view) {
  return userId && preferenceView(view) ? `expedile:table-columns:v1:${encodeURIComponent(userId)}:${view}` : null;
}
/** The one column that identifies a row: the reference of a dossier, the
 * title of a task in Mon travail. */
export function requiredTableColumn(view) {
  return view === 'work' ? 'task' : 'ref';
}
/** Store exclusions: a newly introduced data column stays discoverable. The
 * required column is the single mandatory datum, and foreign keys are ignored. */
export function sanitizeHiddenColumns(columns, hidden, required = 'ref') {
  return Array.isArray(hidden) ? columns.filter(column => column.key !== required && hidden.includes(column.key)).map(column => column.key) : [];
}
export function sanitizeColumnWidths(columns, values) {
  return Object.fromEntries(columns.map(column => [column.key, clampColumnWidth(column, values?.[column.key])]));
}

export function columnFilterModes(column) {
  const modes = [{ key: 'contains', label: 'Contient' }, { key: 'empty', label: 'Non renseigné' }, { key: 'filled', label: 'Renseigné' }];
  if (column?.sort?.type === 'number') modes.push({ key: 'min', label: 'Au moins' }, { key: 'max', label: 'Au plus' });
  if (column?.sort?.type === 'date') modes.push({ key: 'min', label: 'À partir du' }, { key: 'max', label: 'Jusqu’au' });
  return modes;
}
export function sanitizeColumnFilter(column, value) {
  if (!isDossierTableColumnSortable(column) || !value || typeof value !== 'object') return null;
  const mode = columnFilterModes(column).some(item => item.key === value.mode) ? value.mode : 'contains';
  const text = typeof value.value === 'string' ? value.value.slice(0, 200).trim() : '';
  if (['empty', 'filled'].includes(mode)) return { mode, value: '' };
  if (!text) return null;
  if (mode !== 'contains' && (column.sort.type === 'number' ? !Number.isFinite(Number(text.replace(',', '.'))) : !/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text)) return null;
  return { mode, value: text };
}
export function readColumnFilters(params, columns) {
  const filters = {};
  for (const column of columns) {
    try {
      const filter = sanitizeColumnFilter(column, JSON.parse(params.get(COLUMN_FILTER_PREFIX + column.key)));
      if (filter) filters[column.key] = filter;
    } catch { /* Malformed or foreign URL values never hide rows. */ }
  }
  return filters;
}
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[,]/g, '.').replace(/\s+/g, ' ').trim();
export function filterDossierTableRows(dossiers, { columns, filters, models, getClient = () => undefined, envois = [] }) {
  const active = columns.map(column => [column, sanitizeColumnFilter(column, filters[column.key])]).filter(([, filter]) => filter);
  if (!active.length) return dossiers;
  const envoiById = new Map(envois.map(envoi => [envoi.id, envoi]));
  return dossiers.filter(dossier => {
    const context = { dossier, model: models?.get?.(dossier.id), client: getClient(dossier.clientId), envoi: envoiById.get(dossier.envoi || dossier.envoiId) };
    return active.every(([column, filter]) => {
      const value = (column.filter?.value || column.sort.value)(context);
      const empty = value == null || value === '';
      if (filter.mode === 'empty') return empty;
      if (filter.mode === 'filled') return !empty;
      if (filter.mode === 'contains') {
        const visible = column.filter?.text ? column.filter.text(context) : column.sort.type === 'date' ? `${formatDossierTableDate(value)} ${value || ''}` : value;
        return visible != null && normalize(visible).includes(normalize(filter.value));
      }
      if (empty) return false;
      const number = column.sort.type === 'date' ? formatDossierTableDate(value).split('/').reverse().join('-') : Number(value);
      const threshold = column.sort.type === 'date' ? filter.value : Number(filter.value.replace(',', '.'));
      return filter.mode === 'min' ? number >= threshold : number <= threshold;
    });
  });
}

export function columnFilterLabel(column, filter) {
  const mode = columnFilterModes(column).find(item => item.key === filter.mode)?.label || 'Contient';
  return `${column.label} : ${mode.toLocaleLowerCase('fr')}${filter.value ? ` ${filter.value}` : ''}`;
}

/** Suggestions reflect the accessible, scoped rows before column filtering. */
export function dossierColumnSuggestions(dossiers, column, { models, getClient = () => undefined, envois = [] }) {
  if (!isDossierTableColumnSortable(column)) return [];
  const envoiById = new Map(envois.map(envoi => [envoi.id, envoi]));
  const values = dossiers.map(dossier => {
    const context = { dossier, model: models?.get?.(dossier.id), client: getClient(dossier.clientId), envoi: envoiById.get(dossier.envoi || dossier.envoiId) };
    const value = (column.filter?.text || column.filter?.value || column.sort.value)(context);
    return value == null ? null : column.sort.type === 'date' ? formatDossierTableDate(value) : String(value);
  }).filter(value => value != null && value !== '');
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })).slice(0, 100);
}
