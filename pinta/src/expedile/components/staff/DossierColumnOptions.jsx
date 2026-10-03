import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowLeft } from 'lucide-react';
import { clampColumnWidth, columnFilterModes, columnWidthBounds, sanitizeColumnFilter } from '../../domain/dossierTablePreferences';

/** Native modal semantics keep keyboard focus here without covering the table
 * in another full-width toolbar. Position follows the actual trigger. */
function ColumnDialog({ title, anchor, focusKey, onClose, children, closeLabel = 'Fermer le filtre' }) {
  const dialog = useRef(null);
  const initialTrigger = useRef(anchor || document.activeElement);
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 'calc(100dvh - 24px)' });
  useLayoutEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => { node.close(); const trigger = initialTrigger.current?.isConnected ? initialTrigger.current : document.querySelector('[data-column-filters-button]'); trigger?.focus({ preventScroll: true }); };
  }, []);
  useLayoutEffect(() => {
    const node = dialog.current;
    const place = () => {
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height || window.innerHeight;
      const viewportWidth = viewport?.width || window.innerWidth;
      const originX = viewport?.offsetLeft || 0, originY = viewport?.offsetTop || 0;
      const gap = 12, width = Math.min(340, viewportWidth - gap * 2);
      const height = Math.min(node.getBoundingClientRect().height, viewportHeight - gap * 2);
      const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
      const desktop = window.innerWidth >= 768 && rect;
      const left = desktop ? Math.max(originX + gap, Math.min(rect.left, originX + viewportWidth - width - gap)) : originX + (viewportWidth - width) / 2;
      const preferredTop = desktop ? rect.bottom + 8 : originY + (viewportHeight - height) / 2;
      const top = Math.max(originY + gap, Math.min(preferredTop, originY + viewportHeight - height - gap));
      setPosition(previous => previous.left === left && previous.top === top && previous.width === width && previous.maxHeight === viewportHeight - gap * 2 ? previous : { left, top, width, maxHeight: viewportHeight - gap * 2 });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(node);
    window.addEventListener('resize', place);
    // Capture the table's own scroll, not only the document's scroll.
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); };
  }, [anchor]);
  useLayoutEffect(() => {
    const target = dialog.current?.querySelector('[data-filter-focus]');
    target?.focus({ preventScroll: true });
  }, [focusKey]);
  return createPortal(<dialog ref={dialog} id="dossier-column-dialog" aria-modal="true" aria-labelledby="dossier-column-title" data-testid="column-filter-dialog" className="dossier-column-options" style={position}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); }}>
    <div className="dossier-column-dialog-heading"><h2 id="dossier-column-title">{title}</h2><button type="button" className="dossier-column-close" aria-label={closeLabel} onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    {children}
  </dialog>, document.body);
}

export default function DossierColumnOptions({ columns, columnKey, anchor, fromMenu, filters, widths, suggestions = [], onSelect, onFilter, onResize, onResetWidths, onClose }) {
  const column = columns.find(item => item.key === columnKey);
  return <ColumnDialog title={column ? `Filtrer ${column.label}` : 'Filtrer une colonne'} anchor={anchor} focusKey={column?.key} onClose={onClose}>
    {!column ? <div className="dossier-column-choices">{columns.map((item, index) => <button key={item.key} data-column-choice={item.key} data-filter-focus={index === 0 ? '' : undefined} type="button" onClick={() => onSelect(item.key)}>{item.label}{filters[item.key] && <span>Filtré</span>}</button>)}</div>
      : <>
        {fromMenu && <button type="button" className="dossier-column-back" onClick={() => onSelect(null)}><ArrowLeft size={16} aria-hidden="true" />Changer de colonne</button>}
        <ColumnFilterEditor key={column.key} column={column} active={filters[column.key]} widths={widths} suggestions={suggestions} onFilter={value => { onFilter(column.key, value); onClose(); }} onResize={onResize} onResetWidths={onResetWidths} onClose={onClose} />
      </>}
  </ColumnDialog>;
}

export function DossierColumnVisibility({ columns, visibleKeys, widths, anchor, onChange, onResize, onReset, onResetWidths, onClose }) {
  return <ColumnDialog title="Colonnes affichées" closeLabel="Fermer les colonnes" anchor={anchor} onClose={onClose}>
    <p>Choisissez les colonnes et réglez leur largeur séparément. La référence reste affichée pour identifier chaque dossier.</p>
    <p>Vos choix sont mémorisés pour votre compte et cette vue, sur cet appareil. Les largeurs s’appliquent au tableau.</p>
    <div className="dossier-column-visibility">{columns.map(column => <div key={column.key} className="dossier-column-setting"><label className="dossier-column-toggle">
      <input data-filter-focus={column.key === 'client' ? '' : undefined} type="checkbox" aria-label={`Afficher ${column.label}`} checked={visibleKeys.includes(column.key)} disabled={column.key === 'ref'} onChange={event => onChange(column.key, event.target.checked)} />
      <span>{column.label}{column.key === 'ref' && <small>Obligatoire</small>}</span>
    </label>{onResize && <ColumnWidthControl column={column} width={widths?.[column.key]} onResize={onResize} />}</div>)}</div>
    <div className="dossier-column-filter-actions"><button type="button" onClick={onReset}>Rétablir les colonnes</button>{onResetWidths && <button type="button" onClick={onResetWidths}>Rétablir les largeurs</button>}<button type="button" className="dossier-column-apply" onClick={onClose}>Terminer</button></div>
  </ColumnDialog>;
}

function ColumnWidthControl({ column, width, onResize }) {
  const currentWidth = clampColumnWidth(column, width);
  const [widthText, setWidthText] = useState(String(currentWidth));
  useLayoutEffect(() => { setWidthText(String(currentWidth)); }, [column.key, currentWidth]);
  const { min, max } = columnWidthBounds(column);
  const commit = value => {
    const next = value !== '' && Number.isFinite(Number(value)) ? clampColumnWidth(column, value) : currentWidth;
    setWidthText(String(next));
    if (next !== currentWidth) onResize(column, next);
  };
  return <div className="dossier-column-width-control">
    <label>Largeur (px)<input aria-label={`Largeur de ${column.label}`} type="number" inputMode="numeric" min={min} max={max} step="1" value={widthText}
      onChange={event => setWidthText(event.target.value)} onBlur={() => commit(widthText.trim())}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(widthText.trim()); } }} /></label>
  </div>;
}

function ColumnFilterEditor({ column, active, widths, suggestions, onFilter, onResize, onResetWidths, onClose }) {
  const [mode, setMode] = useState(active?.mode || 'contains');
  const [value, setValue] = useState(active?.value || '');
  const emptyMode = ['empty', 'filled'].includes(mode);
  const valid = sanitizeColumnFilter(column, { mode, value });
  const inputType = mode !== 'contains' && column.sort.type === 'date' ? 'date' : 'text';
  return <>
    <form onSubmit={event => { event.preventDefault(); if (valid) onFilter(valid); }}>
      <label>Condition<select data-filter-focus={emptyMode ? '' : undefined} aria-label={`Condition pour ${column.label}`} value={mode} onChange={event => setMode(event.target.value)}>{columnFilterModes(column).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      {!emptyMode && <label>Valeur<input data-filter-focus="" aria-label={`Filtrer : ${column.label}`} type={inputType} inputMode={column.sort.type === 'number' && mode !== 'contains' ? 'decimal' : undefined} list={mode === 'contains' ? 'dossier-column-values' : undefined} value={value} maxLength={200} onChange={event => setValue(event.target.value)} placeholder={column.sort.type === 'number' ? 'Ex. : 2' : 'Texte recherché'} /><datalist id="dossier-column-values">{suggestions.map(item => <option key={item} value={item} />)}</datalist></label>}
      <div className="dossier-column-filter-actions"><button className="dossier-column-apply" type="submit" disabled={!valid}>Appliquer le filtre</button>{active && <button type="button" onClick={() => onFilter(null)}>Effacer ce filtre</button>}<button type="button" onClick={onClose}>Fermer</button></div>
    </form>
    {onResize && <div className="dossier-column-width-options"><ColumnWidthControl column={column} width={widths?.[column.key]} onResize={onResize} />
      {onResetWidths && <button type="button" onClick={onResetWidths}>Rétablir les largeurs</button>}
      <p>Largeurs du tableau mémorisées pour votre compte et cette vue, sur cet appareil.</p>
    </div>}
  </>;
}
