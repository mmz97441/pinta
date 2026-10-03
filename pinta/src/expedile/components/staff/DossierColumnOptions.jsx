import React, { useEffect, useRef, useState } from 'react';
import { columnFilterModes, columnWidthBounds, sanitizeColumnFilter } from '../../domain/dossierTablePreferences';

/** One shared editor works from a column heading and on a phone alike. */
export default function DossierColumnOptions({ columns, columnKey, filters, widths, suggestions = [], onSelect, onFilter, onResize, onResetWidths, onClose }) {
  const column = columns.find(item => item.key === columnKey) || columns[0];
  const active = filters[column.key];
  const [mode, setMode] = useState(active?.mode || 'contains');
  const [value, setValue] = useState(active?.value || '');
  const [widthText, setWidthText] = useState(String(widths[column.key]));
  const input = useRef(null);
  useEffect(() => { setMode(active?.mode || 'contains'); setValue(active?.value || ''); }, [column.key, active?.mode, active?.value]);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [column.key]);
  useEffect(() => { setWidthText(String(widths[column.key])); }, [column.key, widths]);
  const emptyMode = ['empty', 'filled'].includes(mode);
  const valid = sanitizeColumnFilter(column, { mode, value });
  const inputType = mode !== 'contains' && column.sort.type === 'date' ? 'date' : 'text';
  const bounds = columnWidthBounds(column);
  const applyWidth = () => { if (widthText.trim() && Number.isFinite(Number(widthText))) onResize(column, widthText); else setWidthText(String(widths[column.key])); };
  return <section aria-label="Options des colonnes" className="dossier-column-options">
    <form onSubmit={event => { event.preventDefault(); if (valid) onFilter(column.key, valid); }}>
      <label>Colonne<select aria-label="Colonne à filtrer" value={column.key} onChange={event => onSelect(event.target.value)}>{columns.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label>Condition<select aria-label={`Condition pour ${column.label}`} value={mode} onChange={event => setMode(event.target.value)}>{columnFilterModes(column).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      {!emptyMode && <label className="dossier-column-filter-value">Valeur<input ref={input} aria-label={`Filtrer : ${column.label}`} type={inputType} inputMode={column.sort.type === 'number' && mode !== 'contains' ? 'decimal' : undefined} list={mode === 'contains' ? 'dossier-column-values' : undefined} value={value} maxLength={200} onChange={event => setValue(event.target.value)} placeholder={column.sort.type === 'number' ? 'Ex. : 2' : 'Texte recherché'} /><datalist id="dossier-column-values">{suggestions.map(item => <option key={item} value={item} />)}</datalist></label>}
      <button type="submit" disabled={!valid}>Appliquer le filtre</button>
      {active && <button type="button" onClick={() => onFilter(column.key, null)}>Effacer ce filtre</button>}
      <button type="button" onClick={onClose}>Fermer les options</button>
    </form>
    <details><summary>Largeur des colonnes sur ordinateur</summary><div className="dossier-column-width-options">
      <label>Largeur de {column.label} (px)<input aria-label={`Largeur de ${column.label}`} type="number" min={bounds.min} max={bounds.max} value={widthText} onChange={event => setWidthText(event.target.value)} onBlur={applyWidth} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyWidth(); } }} /></label>
      <button type="button" onClick={onResetWidths}>Rétablir les largeurs</button>
      <p>Ces largeurs sont mémorisées pour votre compte et cette vue. Sur ordinateur, vous pouvez aussi tirer le bord d’une colonne.</p>
    </div></details>
  </section>;
}
