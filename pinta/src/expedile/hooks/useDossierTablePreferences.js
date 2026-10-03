import { useEffect, useState } from 'react';
import { clampColumnWidth, columnWidthsStorageKey, sanitizeColumnWidths } from '../domain/dossierTablePreferences';

function load(key, columns) {
  try { return sanitizeColumnWidths(columns, key ? JSON.parse(localStorage.getItem(key)) : null); }
  catch { return sanitizeColumnWidths(columns, null); }
}
export default function useDossierTablePreferences(userId, view, columns) {
  const key = columnWidthsStorageKey(userId, view);
  const [saved, setSaved] = useState(() => ({ key, widths: load(key, columns) }));
  // A user/view change cannot paint or persist the previous user's preferences.
  const widths = saved.key === key ? saved.widths : load(key, columns);
  useEffect(() => { if (saved.key !== key) setSaved({ key, widths: load(key, columns) }); }, [key, columns, saved.key]);
  const save = values => {
    const next = sanitizeColumnWidths(columns, values);
    setSaved({ key, widths: next });
    if (key) try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Preferences remain usable in memory. */ }
  };
  return { widths, setWidth: (column, width) => save({ ...widths, [column.key]: clampColumnWidth(column, width) }), resetWidths: () => save(null) };
}
