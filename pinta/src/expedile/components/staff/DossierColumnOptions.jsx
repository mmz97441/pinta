import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowLeft } from 'lucide-react';
import { clampColumnWidth, columnFilterChoices, columnFilterModes, columnWidthBounds, sanitizeColumnFilter } from '../../domain/dossierTablePreferences';

/** Native modal semantics keep keyboard focus here without covering the table
 * in another full-width toolbar. Position follows the actual trigger: from
 * 768px the dialog hangs under it, aligned on its left edge ('start') or its
 * right edge ('end'); on phones, or without a trigger, it is centred. A
 * `placement="sheet"` dialog rises from the bottom edge at full width; its
 * heading (title and close button) stays in view while its content scrolls.
 * The top layer also escapes the scrolling page header that holds the
 * triggers. Closing returns focus to the trigger, or to `fallbackFocus` when
 * the trigger is gone. */
// Safari before 15.4 has no <dialog>: the same element then opens as a fixed overlay over a
// backdrop that closes it, and Escape still closes it.
const NATIVE_MODAL = typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function';
export function ColumnDialog({ title, anchor, focusKey, onClose, children, closeLabel = 'Fermer le filtre', id = 'dossier-column-dialog', titleId = 'dossier-column-title', testId = 'column-filter-dialog', className = '', align = 'start', placement = 'anchored', width: preferredWidth = 340, fallbackFocus = '[data-column-filters-button]' }) {
  const dialog = useRef(null);
  const initialTrigger = useRef(anchor || document.activeElement);
  const fallback = useRef(fallbackFocus);
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 'calc(100dvh - 24px)' });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const node = dialog.current;
    if (NATIVE_MODAL) node.showModal(); else node.setAttribute('open', '');
    return () => { if (NATIVE_MODAL) node.close(); else node.removeAttribute('open'); const trigger = initialTrigger.current?.isConnected ? initialTrigger.current : document.querySelector(fallback.current); trigger?.focus({ preventScroll: true }); };
  }, []);
  // A second Escape without a click in between is not cancellable: the browser
  // closes the dialog itself. It opens again at once and its owner decides, so
  // a dialog that refuses to close (a change being written) stays on screen.
  useEffect(() => {
    if (!NATIVE_MODAL) return undefined;
    const node = dialog.current;
    const closedByBrowser = () => {
      if (!node.isConnected || node.open) return;
      node.showModal();
      closeRef.current();
    };
    node.addEventListener('close', closedByBrowser);
    return () => node.removeEventListener('close', closedByBrowser);
  }, []);
  useEffect(() => {
    if (NATIVE_MODAL) return undefined;
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);
  useLayoutEffect(() => {
    const node = dialog.current;
    const place = () => {
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height || window.innerHeight;
      const viewportWidth = viewport?.width || window.innerWidth;
      const originX = viewport?.offsetLeft || 0, originY = viewport?.offsetTop || 0;
      if (placement === 'sheet') {
        // A strip of the page stays visible above the sheet, so it reads as one.
        const maxHeight = Math.max(160, viewportHeight - 48);
        const height = Math.min(node.getBoundingClientRect().height, maxHeight);
        const left = originX, top = originY + viewportHeight - height, width = viewportWidth;
        setPosition(previous => previous.left === left && previous.top === top && previous.width === width && previous.maxHeight === maxHeight ? previous : { left, top, width, maxHeight });
        return;
      }
      const gap = 12, width = Math.min(preferredWidth, viewportWidth - gap * 2);
      const height = Math.min(node.getBoundingClientRect().height, viewportHeight - gap * 2);
      const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
      const desktop = window.innerWidth >= 768 && rect;
      const anchoredLeft = desktop && (align === 'end' ? rect.right - width : rect.left);
      const left = desktop ? Math.max(originX + gap, Math.min(anchoredLeft, originX + viewportWidth - width - gap)) : originX + (viewportWidth - width) / 2;
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
  }, [anchor, align, placement, preferredWidth]);
  useLayoutEffect(() => {
    const target = dialog.current?.querySelector('[data-filter-focus]');
    target?.focus({ preventScroll: true });
  }, [focusKey]);
  return createPortal(<>{!NATIVE_MODAL && <div className="dossier-dialog-fallback-backdrop" aria-hidden="true" onClick={onClose} />}<dialog ref={dialog} id={id} aria-modal="true" data-fallback-modal={NATIVE_MODAL ? undefined : 'true'} aria-labelledby={titleId} data-testid={testId} data-placement={placement} className={className ? `dossier-column-options ${className}` : 'dossier-column-options'} style={position}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); }}>
    <div className="dossier-column-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="dossier-column-close" aria-label={closeLabel} onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    {children}
  </dialog></>, document.body);
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

const DOSSIER_COLUMN_NOTES = [
  'Choisissez les colonnes et réglez leur largeur séparément. La référence reste affichée pour identifier chaque dossier.',
  'Vos choix sont mémorisés pour votre compte et cette vue, sur cet appareil. Les largeurs s’appliquent au tableau.',
];

/** `required` is the column that identifies a row (the reference of a dossier,
 * the task in Mon travail); focus starts on the first column one may hide.
 * Without `onResize` (cards), no width is offered: widths belong to the table. */
export function DossierColumnVisibility({ columns, visibleKeys, widths, anchor, required = 'ref', notes = DOSSIER_COLUMN_NOTES, onChange, onResize, onReset, onResetWidths, onClose }) {
  const firstChoice = columns.find(column => column.key !== required)?.key;
  return <ColumnDialog title="Colonnes affichées" closeLabel="Fermer les colonnes" anchor={anchor} onClose={onClose}>
    {notes.map(note => <p key={note}>{note}</p>)}
    <div className="dossier-column-visibility">{columns.map(column => <div key={column.key} className="dossier-column-setting"><label className="dossier-column-toggle">
      <input data-filter-focus={column.key === firstChoice ? '' : undefined} type="checkbox" aria-label={`Afficher ${column.label}`} checked={visibleKeys.includes(column.key)} disabled={column.key === required} onChange={event => onChange(column.key, event.target.checked)} />
      <span>{column.label}{column.key === required && <small>Obligatoire</small>}</span>
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
  const choices = columnFilterChoices(column);
  const [mode, setMode] = useState(active?.mode || columnFilterModes(column)[0].key);
  const [value, setValue] = useState(active?.value || choices?.[0] || '');
  const emptyMode = ['empty', 'filled'].includes(mode);
  const valid = sanitizeColumnFilter(column, { mode, value });
  const inputType = mode !== 'contains' && column.sort.type === 'date' ? 'date' : 'text';
  return <>
    <form onSubmit={event => { event.preventDefault(); if (valid) onFilter(valid); }}>
      <label>Condition<select data-filter-focus={emptyMode ? '' : undefined} aria-label={`Condition pour ${column.label}`} value={mode} onChange={event => setMode(event.target.value)}>{columnFilterModes(column).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      {!emptyMode && (choices ? <label>Valeur<select data-filter-focus="" aria-label={`Filtrer : ${column.label}`} value={value} onChange={event => setValue(event.target.value)}>{choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select></label>
        : <label>Valeur<input data-filter-focus="" aria-label={`Filtrer : ${column.label}`} type={inputType} inputMode={column.sort.type === 'number' && mode !== 'contains' ? 'decimal' : undefined} list={mode === 'contains' ? 'dossier-column-values' : undefined} value={value} maxLength={200} onChange={event => setValue(event.target.value)} placeholder={column.sort.type === 'number' ? 'Ex. : 2' : 'Texte recherché'} /><datalist id="dossier-column-values">{suggestions.map(item => <option key={item} value={item} />)}</datalist></label>)}
      <div className="dossier-column-filter-actions"><button className="dossier-column-apply" type="submit" disabled={!valid}>Appliquer le filtre</button>{active && <button type="button" onClick={() => onFilter(null)}>Effacer ce filtre</button>}<button type="button" onClick={onClose}>Fermer</button></div>
    </form>
    {onResize && <div className="dossier-column-width-options"><ColumnWidthControl column={column} width={widths?.[column.key]} onResize={onResize} />
      {onResetWidths && <button type="button" onClick={onResetWidths}>Rétablir les largeurs</button>}
      <p>Largeurs du tableau mémorisées pour votre compte et cette vue, sur cet appareil.</p>
    </div>}
  </>;
}
