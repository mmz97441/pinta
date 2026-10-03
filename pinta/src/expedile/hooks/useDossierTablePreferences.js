import { useEffect, useState } from 'react';
import { clampColumnWidth, columnWidthsStorageKey, columnVisibilityStorageKey, dossierTextSizeStorageKey, dossierLayoutStorageKey, sanitizeColumnWidths, sanitizeHiddenColumns, sanitizeDossierTextSize, sanitizeDossierTableLayout } from '../domain/dossierTablePreferences';

function read(key) {
  try { return key ? JSON.parse(localStorage.getItem(key)) : null; }
  catch { return null; }
}
function persist(key, value) {
  if (key) try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences remain usable in memory. */ }
}
function load(key, visibilityKey, textKey, layoutKey, columns) {
  return { key, columns, widths: sanitizeColumnWidths(columns, read(key)), hidden: sanitizeHiddenColumns(columns, read(visibilityKey)), textSize: sanitizeDossierTextSize(read(textKey)), layout: sanitizeDossierTableLayout(read(layoutKey)) };
}
export default function useDossierTablePreferences(userId, view, columns) {
  const key = columnWidthsStorageKey(userId, view);
  const visibilityKey = columnVisibilityStorageKey(userId, view);
  const textKey = dossierTextSizeStorageKey(userId, view);
  const layoutKey = dossierLayoutStorageKey(userId, view);
  const [saved, setSaved] = useState(() => load(key, visibilityKey, textKey, layoutKey, columns));
  // A user/view change cannot paint or persist the previous user's preferences.
  // Permission changes can also add/remove columns while staying in this view.
  const matches = saved.key === key && saved.columns === columns;
  const current = matches ? saved : load(key, visibilityKey, textKey, layoutKey, columns);
  useEffect(() => { if (!matches) setSaved(load(key, visibilityKey, textKey, layoutKey, columns)); }, [key, visibilityKey, textKey, layoutKey, columns, matches]);
  const saveWidths = values => {
    const widths = sanitizeColumnWidths(columns, values);
    setSaved({ ...current, widths }); persist(key, widths);
  };
  const saveHidden = values => {
    const hidden = sanitizeHiddenColumns(columns, values);
    setSaved({ ...current, hidden }); persist(visibilityKey, hidden);
  };
  return {
    widths: current.widths,
    textSize: current.textSize,
    layout: current.layout,
    setLayout: value => {
      const layout = sanitizeDossierTableLayout(value);
      setSaved({ ...current, layout }); persist(layoutKey, layout);
    },
    setTextSize: value => {
      const textSize = sanitizeDossierTextSize(value);
      setSaved({ ...current, textSize }); persist(textKey, textSize);
    },
    visibleKeys: columns.filter(column => !current.hidden.includes(column.key)).map(column => column.key),
    setColumnVisible: (columnKey, visible) => saveHidden(visible ? current.hidden.filter(key => key !== columnKey) : [...current.hidden, columnKey]),
    resetColumns: () => saveHidden([]),
    setWidth: (column, width) => saveWidths({ ...current.widths, [column.key]: clampColumnWidth(column, width) }),
    resetWidths: () => saveWidths(null),
  };
}
