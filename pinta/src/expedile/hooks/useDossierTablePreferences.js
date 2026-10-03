import { useEffect, useState } from 'react';
import { clampColumnWidth, columnWidthsStorageKey, columnVisibilityStorageKey, sanitizeColumnWidths, sanitizeHiddenColumns } from '../domain/dossierTablePreferences';

function read(key) {
  try { return key ? JSON.parse(localStorage.getItem(key)) : null; }
  catch { return null; }
}
function persist(key, value) {
  if (key) try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences remain usable in memory. */ }
}
function load(key, visibilityKey, columns) {
  return { key, widths: sanitizeColumnWidths(columns, read(key)), hidden: sanitizeHiddenColumns(columns, read(visibilityKey)) };
}
export default function useDossierTablePreferences(userId, view, columns) {
  const key = columnWidthsStorageKey(userId, view);
  const visibilityKey = columnVisibilityStorageKey(userId, view);
  const [saved, setSaved] = useState(() => load(key, visibilityKey, columns));
  // A user/view change cannot paint or persist the previous user's preferences.
  const current = saved.key === key ? saved : load(key, visibilityKey, columns);
  useEffect(() => { if (saved.key !== key) setSaved(load(key, visibilityKey, columns)); }, [key, visibilityKey, columns, saved.key]);
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
    visibleKeys: columns.filter(column => !current.hidden.includes(column.key)).map(column => column.key),
    setColumnVisible: (columnKey, visible) => saveHidden(visible ? current.hidden.filter(key => key !== columnKey) : [...current.hidden, columnKey]),
    resetColumns: () => saveHidden([]),
    setWidth: (column, width) => saveWidths({ ...current.widths, [column.key]: clampColumnWidth(column, width) }),
    resetWidths: () => saveWidths(null),
  };
}
