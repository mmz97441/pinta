import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { chooseToastPlacement, overlaps, toastCandidates, toastContent } from '../../domain/toast';
// Styles: .expedile-toast in brand.css.

const ICONS = { info: Info, success: CheckCircle, warning: AlertTriangle, error: XCircle };
// What one can click or type in, and the page headings: the toast never sits over one of them.
const CONTROLS = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="option"], h1, h2, h3';
// The bars that stay at the bottom of the screen (bottom navigation, sticky
// actions, the reply box) and the top bar of a phone or of the client portal.
const FLOORS = '[data-toast-floor], .reception-footer, .dossier-bulk-bar, .chat-composer, .glass-nav';
const CEILINGS = '[data-toast-ceiling]';

const shown = element => {
  const box = element?.getBoundingClientRect();
  return box && box.width > 0 && box.height > 0 ? box : null;
};

/** Measures the screen around the toast `node` and returns its place. */
function locate(node, staff) {
  const visual = window.visualViewport;
  const viewport = { width: window.innerWidth, top: visual?.offsetTop || 0, height: visual?.height || window.innerHeight };
  const viewportBottom = viewport.top + viewport.height;
  const rail = staff ? shown(document.querySelector('.staff-sidebar')) : null;
  const navigation = rail && document.querySelector('.staff-sidebar [data-toast-zone]');
  const entries = navigation ? [...navigation.querySelectorAll('button')].map(shown).filter(Boolean) : [];
  const zoneBox = shown(navigation);
  const zone = zoneBox && { top: entries.length ? Math.max(...entries.map(entry => entry.bottom)) : zoneBox.top, bottom: zoneBox.bottom };
  // Only the bars at the bottom (or the top) of what is visible count.
  const floors = [...document.querySelectorAll(FLOORS)].map(shown).filter(box => box && box.top < viewportBottom && box.bottom > viewport.top + viewport.height / 2);
  const ceilings = [...document.querySelectorAll(CEILINGS)].map(shown).filter(box => box && box.bottom > viewport.top && box.top < viewport.top + viewport.height / 2);
  const floor = floors.length ? Math.min(viewportBottom, ...floors.map(box => box.top)) : viewportBottom;
  const ceiling = ceilings.length ? Math.max(viewport.top, ...ceilings.map(box => box.bottom)) : viewport.top;
  // The toast's height at each width: measured, then the committed width comes back.
  const committed = node.style.width;
  const heights = new Map();
  const heightFor = width => {
    if (!heights.has(width)) { node.style.width = `${width}px`; heights.set(width, node.getBoundingClientRect().height); }
    return heights.get(width);
  };
  const candidates = toastCandidates({ viewport, rail, zone, ceiling, floor, heightFor });
  node.style.width = committed;
  // The controls one can click under a place: what the point under their centre
  // reaches (a control behind a dialog's backdrop is not clickable), the toast
  // itself standing for what it already covers.
  const controls = [...document.querySelectorAll(CONTROLS)].filter(control => !node.contains(control)).flatMap(control => {
    const box = shown(control);
    if (!box || !candidates.some(candidate => overlaps(candidate, box))) return [];
    const x = Math.min(Math.max((Math.max(box.left, 0) + Math.min(box.right, viewport.width)) / 2, 0), viewport.width - 1);
    const y = Math.min(Math.max((Math.max(box.top, viewport.top) + Math.min(box.bottom, viewportBottom)) / 2, 0), window.innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    return hit && (control.contains(hit) || node.contains(hit)) ? [box] : [];
  });
  const choice = chooseToastPlacement(candidates, controls);
  return choice && { kind: choice.kind, left: Math.round(choice.left), top: Math.round(choice.top), width: Math.round(choice.width) };
}

/** The message of flash(): placed clear of every control (domain/toast.js), a
 * click on it closes it and never reaches what lies under it. Above the bottom
 * navigation and the « Détails du dossier » panel (z-60), below confirmations (z-100).
 * `route`: the page shown (App.jsx), to move clear of the controls of a page just opened. */
export default function Toast({ route = '' }) {
  const { toast, setToast, isStaff } = useApp();
  const node = useRef(null);
  const [placement, setPlacement] = useState(null);
  const keep = next => setPlacement(previous => previous && next && previous.kind === next.kind && previous.left === next.left && previous.top === next.top && previous.width === next.width ? previous : next);
  useLayoutEffect(() => {
    if (!toast) { setPlacement(null); return undefined; }
    let frame = 0;
    const place = () => { if (node.current) keep(locate(node.current, isStaff)); };
    place();
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    window.addEventListener('resize', later);
    window.visualViewport?.addEventListener('resize', later);
    // Folding or unfolding the navigation column moves the free space.
    const rail = isStaff ? document.querySelector('.staff-sidebar') : null;
    const observer = rail && typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
    observer?.observe(rail);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('resize', later);
      observer?.disconnect();
    };
  }, [toast, isStaff]);
  // A save that opens another page: once that page is drawn, the toast moves clear of its controls.
  useEffect(() => {
    if (!toast) return undefined;
    const frame = requestAnimationFrame(() => { if (node.current) keep(locate(node.current, isStaff)); });
    return () => cancelAnimationFrame(frame);
  }, [route]);
  if (!toast) return null;

  const { msg, type, action } = toastContent(toast);
  const Icon = ICONS[type];
  // Measured before the first paint: until then the toast takes no room and no click.
  const style = placement ? { left: placement.left, top: placement.top, width: placement.width } : { left: 0, top: 0, visibility: 'hidden' };

  return (
    <div
      ref={node}
      role={type === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      data-toast={type}
      data-placement={placement?.kind}
      className={`expedile-toast expedile-toast--${type} fixed z-[70] anim-fade-up`}
      style={style}
      onClick={() => setToast('')}
    >
      <div className="flex items-start gap-2.5">
        <Icon size={18} className="expedile-toast__icon mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-line text-xs font-semibold">{msg}</p>
          {action && (
            <button
              type="button"
              onClick={event => { event.stopPropagation(); action.onClick(); setToast(''); }}
              className="expedile-toast__action mt-2 min-h-11 rounded-lg px-3 text-sm font-bold transition-all duration-200 ease-out active:scale-[0.98]"
            >
              {action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
