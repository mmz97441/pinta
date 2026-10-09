import { isDossierTableColumnSortable, formatDossierTableDate } from './dossierTable.js';

export const COLUMN_FILTER_PREFIX = 'col.';
// Each heading reads whole at the default text size, even with a wide fallback
// font (Verdana, DejaVu Sans): « Qui s’en occupe », « Poids (kg) », « Devis
// envoyé » and « Destination » keep a few pixels to spare. At any other text
// size, on a touch screen or with a narrower saved width, the table draws the
// column at least as wide as its heading needs (headingWidthFloors).
const widths = { ref: 140, client: 180, statusLabel: 155, paymentState: 140, statut: 190, owner: 160, casier: 90, cartons: 100, receivedAt: 130, optimizedDimensions: 190, optimizedWeight: 120, requested: 130, transport: 130, taxes: 130, paid: 115, remaining: 130, sentAt: 140, departure: 140, destination: 130, packages: 135, readiness: 195, consentState: 150, consentRequestedAt: 180, lastRelanceAt: 165, action: 140 };
// Each dossier preset and Mon travail (`work`) keep their own reading choices.
const PREFERENCE_VIEWS = ['daily', 'payments', 'departures', 'accords', 'work'];
const preferenceView = view => PREFERENCE_VIEWS.includes(view);
// Never under 11px: a smaller size is not readable on any screen.
export const DOSSIER_TEXT_SIZE_BOUNDS = Object.freeze({ min: 11, max: 20, initial: 12 });
/** The dossier lists open at 14px on a touch screen or below 1024px. */
export const DOSSIER_TOUCH_TEXT_SIZE = 14;
const TOUCH_OR_NARROW = '(pointer: coarse), (max-width: 1023px)';
/** A touch screen, or a window narrower than 1024px (phones and tablets). */
export function touchOrNarrowScreen() {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(TOUCH_OR_NARROW).matches; }
  catch { return false; }
}
/** Mon travail opens at a reading size close to its former text; the dossier
 * tables keep their compact 12px on a computer and 14px on phones and tablets. */
export function tableTextSizeInitial(view, { touch = touchOrNarrowScreen() } = {}) {
  return view === 'work' ? 15 : touch ? DOSSIER_TOUCH_TEXT_SIZE : DOSSIER_TEXT_SIZE_BOUNDS.initial;
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
/** Cards or table is one choice for the whole dossier list (its four tabs):
 * they share the key « Travail quotidien » always used, so a choice made there
 * before stays. Mon travail keeps its own. */
export function dossierLayoutStorageKey(userId, view) {
  const scope = view === 'work' ? 'work' : 'daily';
  return userId && preferenceView(view) ? `expedile:table-layout:v1:${encodeURIComponent(userId)}:${scope}` : null;
}
/** « Regrouper » of each dossier list tab: none, by stage, by departure or by
 * client. « Départs » opens grouped by departure, « Accords clients » by
 * client; Mon travail has no grouping. */
export const DOSSIER_GROUPINGS = Object.freeze(['none', 'statut', 'envoi', 'client']);
const groupingView = view => ['daily', 'payments', 'departures', 'accords'].includes(view);
export function defaultDossierGrouping(view) {
  return view === 'departures' ? 'envoi' : view === 'accords' ? 'client' : 'none';
}
export function sanitizeDossierGrouping(value, view) {
  return DOSSIER_GROUPINGS.includes(value) ? value : defaultDossierGrouping(view);
}
/** An explicit `view` in the URL wins over the stored choice: shared links keep their grouping. */
export function resolveDossierGrouping(requested, stored, view) {
  return DOSSIER_GROUPINGS.includes(requested) ? requested : sanitizeDossierGrouping(stored, view);
}
export function dossierGroupingStorageKey(userId, view) {
  return userId && groupingView(view) ? `expedile:table-group:v1:${encodeURIComponent(userId)}:${view}` : null;
}
/** Where « Sans départ affecté » goes when grouping by departure. */
export function sanitizeNoDeparturePlacement(value) {
  return value === 'top' ? 'top' : 'bottom';
}
export function noDeparturePlacementStorageKey(userId, view) {
  return userId && groupingView(view) ? `expedile:table-no-departure:v1:${encodeURIComponent(userId)}:${view}` : null;
}
export function columnWidthBounds(column) {
  const min = column?.key === 'action' ? 132 : column?.key === 'optimizedDimensions' ? 110 : ['ref', 'client'].includes(column?.key) ? 96 : 64;
  const initial = Math.max(min, widths[column?.key] || 140);
  return { min, max: column?.key === 'action' ? 280 : 600, initial };
}
/** Room a heading takes around its words. A sortable column: the cell's padding and border
 * (17 px), its sort arrow (15 px) and its filter (26 px). The arrow always shows on a touch
 * screen and on the sorted column; elsewhere it shows on hover or focus only. Any other
 * column: padding and border, the pinned Action's being the widest (19 px). */
export const HEADING_CHROME = Object.freeze({ sortable: 58, arrow: 15, plain: 19 });
/** The narrowest width at which each heading reads whole at rest: `measureText(text)` gives
 * the width of its visible words (shortLabel, else label) in the heading font. `arrows`: the
 * idle sort arrows show (a touch screen); `sortedKey`: the column sorted, whose arrow shows. */
export function headingWidthFloors(columns, measureText, { arrows = true, sortedKey = null } = {}) {
  return Object.fromEntries((columns || []).map(column => {
    const text = Number(measureText(column.shortLabel || column.label || ''));
    const chrome = !isDossierTableColumnSortable(column) ? HEADING_CHROME.plain
      : HEADING_CHROME.sortable - (arrows || column.key === sortedKey ? 0 : HEADING_CHROME.arrow);
    return [column.key, Number.isFinite(text) && text > 0 ? Math.ceil(text) + chrome : 0];
  }));
}
/** The widths drawn: each saved width, never under the floor of its heading. */
export function flooredColumnWidths(widths, floors = {}) {
  return Object.fromEntries(Object.entries(widths || {}).map(([key, width]) => [key, Math.max(width, floors[key] || 0)]));
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
/** The columns shown, in the order of the view: a column added since the
 * person saved their choices (« Taxes calculées », « Transport ») appears in its place, shown,
 * until they hide it. */
export function visibleTableColumnKeys(columns, hidden) {
  return (columns || []).filter(column => !(hidden || []).includes(column.key)).map(column => column.key);
}
export function sanitizeColumnWidths(columns, values) {
  return Object.fromEntries(columns.map(column => [column.key, clampColumnWidth(column, values?.[column.key])]));
}

const normalizeChoice = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();
/** A column with a closed list of values (« Paiement ») is filtered on one exact
 * value: « Payé » must not also keep « Non payé ». */
export function columnFilterChoices(column) {
  return Array.isArray(column?.filter?.choices) ? column.filter.choices : null;
}
export function columnFilterModes(column) {
  const presence = [{ key: 'empty', label: 'Non renseigné' }, { key: 'filled', label: 'Renseigné' }];
  if (columnFilterChoices(column)) return [{ key: 'is', label: 'Est' }, ...presence];
  const modes = [{ key: 'contains', label: 'Contient' }, ...presence];
  if (column?.sort?.type === 'number') modes.push({ key: 'min', label: 'Au moins' }, { key: 'max', label: 'Au plus' });
  if (column?.sort?.type === 'date') modes.push({ key: 'min', label: 'À partir du' }, { key: 'max', label: 'Jusqu’au' });
  return modes;
}
export function sanitizeColumnFilter(column, value) {
  if (!isDossierTableColumnSortable(column) || !value || typeof value !== 'object') return null;
  const choices = columnFilterChoices(column);
  // An older link (« contient Payé ») keeps its meaning only when it names one value exactly.
  if (choices) {
    if (['empty', 'filled'].includes(value.mode)) return { mode: value.mode, value: '' };
    const choice = typeof value.value === 'string' && choices.find(item => normalizeChoice(item) === normalizeChoice(value.value));
    return choice ? { mode: 'is', value: choice } : null;
  }
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
      if (filter.mode === 'is') return !empty && normalizeChoice(value) === normalizeChoice(filter.value);
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
