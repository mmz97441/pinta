import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { chooseToastPlacement, overlaps, toastCandidates, toastContent } from '../../domain/toast';
// Styles: .expedile-toast in brand.css.

const ICONS = { info: Info, success: CheckCircle, warning: AlertTriangle, error: XCircle };
// What one can click or type in, the clickable rows (a dossier row opens its dossier) and the
// elements given a click of their own: the toast never sits over one of them.
const CONTROLS = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="option"], [onclick], tr[data-dossier-row]';
// The page headings, measured by their text (a block heading spans the whole width, its text does not).
const HEADINGS = 'h1, h2, h3';
// The bars that stay at the bottom of the screen (bottom navigation, sticky
// actions, the reply box) and the top bar of a phone or of the client portal.
const FLOORS = '[data-toast-floor], .reception-footer, .dossier-bulk-bar, .chat-composer, .glass-nav';
const CEILINGS = '[data-toast-ceiling]';
// A native modal dialog (or its fallback on Safari before 15.4, DossierColumnOptions.jsx): the toast
// waits behind it, never drawn under its backdrop where a click would close the dialog.
const MODAL = 'dialog[open][aria-modal="true"], dialog[open][data-fallback-modal="true"]';

const shown = element => {
  const box = element?.getBoundingClientRect();
  return box && box.width > 0 && box.height > 0 ? box : null;
};
const intersect = (a, b) => {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top), right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return right - left > 0.5 && bottom - top > 0.5 ? { left, top, right, bottom } : null;
};
/** The part of `box` left visible by the scrolling containers around `element`. */
function visiblePart(element, box, screen) {
  let visible = intersect(box, screen);
  for (let parent = element.parentElement; visible && parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) visible = intersect(visible, parent.getBoundingClientRect());
  }
  return visible;
}
/** Whether a click at the centre of `part` reaches `element` (not a backdrop, a sticky bar or a dialog above it). */
function reachable(element, part) {
  const hit = document.elementFromPoint((part.left + part.right) / 2, (part.top + part.bottom) / 2);
  return Boolean(hit) && (element === hit || element.contains(hit));
}

/** Measures the screen around the toast `node` and returns its place. `current`: the kind of the place it holds. */
function locate(node, staff, current) {
  const visual = window.visualViewport;
  const viewport = { width: window.innerWidth, top: visual?.offsetTop || 0, height: visual?.height || window.innerHeight };
  const viewportBottom = viewport.top + viewport.height;
  const screen = { left: 0, top: viewport.top, right: viewport.width, bottom: viewportBottom };
  const rail = staff ? shown(document.querySelector('.staff-sidebar')) : null;
  const navigation = rail && document.querySelector('.staff-sidebar [data-toast-zone]');
  const entries = navigation ? [...navigation.querySelectorAll('button')].map(shown).filter(Boolean) : [];
  const zoneBox = shown(navigation);
  const zone = zoneBox && { top: entries.length ? Math.max(...entries.map(entry => entry.bottom)) : zoneBox.top, bottom: zoneBox.bottom };
  // What a click reaches is measured with the toast set aside.
  const committed = { width: node.style.width, pointerEvents: node.style.pointerEvents };
  node.style.pointerEvents = 'none';
  // Only the bars at the bottom (or the top) of what is visible count, and only when they are
  // on top (a panel or a dialog over the bottom navigation leaves that space to the toast).
  const onTop = element => { const box = shown(element); return box && reachable(element, intersect(box, screen) || box) ? box : null; };
  const floors = [...document.querySelectorAll(FLOORS)].map(onTop).filter(box => box && box.top < viewportBottom && box.bottom > viewport.top + viewport.height / 2);
  const ceilings = [...document.querySelectorAll(CEILINGS)].map(onTop).filter(box => box && box.bottom > viewport.top && box.top < viewport.top + viewport.height / 2);
  const floor = floors.length ? Math.min(viewportBottom, ...floors.map(box => box.top)) : viewportBottom;
  const ceiling = ceilings.length ? Math.max(viewport.top, ...ceilings.map(box => box.bottom)) : viewport.top;
  // The toast's height at each width: measured, then the committed width comes back.
  const heights = new Map();
  const heightFor = width => {
    if (!heights.has(width)) { node.style.width = `${width}px`; heights.set(width, node.getBoundingClientRect().height); }
    return heights.get(width);
  };
  const candidates = toastCandidates({ viewport, rail, zone, ceiling, floor, heightFor });
  node.style.width = committed.width;
  // What a click reaches under the places: the visible part of each control (a row
  // scrolled under a sticky header or out of its list does not count), and only when
  // that part takes the click (not behind a dialog's backdrop).
  const boxes = [];
  const seen = new Set();
  const consider = (element, box) => {
    if (!box || !candidates.some(candidate => overlaps(candidate, box))) return;
    const part = visiblePart(element, box, screen);
    if (part && reachable(element, part)) boxes.push(part);
  };
  for (const found of document.querySelectorAll(CONTROLS)) {
    if (node.contains(found)) continue;
    // A checkbox or a radio button is clicked through its whole label.
    const control = /^(checkbox|radio)$/.test(found.type) ? found.closest('label') || found : found;
    if (seen.has(control)) continue;
    seen.add(control);
    consider(control, shown(control));
  }
  for (const heading of document.querySelectorAll(HEADINGS)) {
    if (node.contains(heading) || !shown(heading)) continue;
    const range = document.createRange();
    range.selectNodeContents(heading);
    for (const line of range.getClientRects()) if (line.width > 0 && line.height > 0) consider(heading, line);
  }
  node.style.pointerEvents = committed.pointerEvents;
  const choice = chooseToastPlacement(candidates, boxes, { current });
  return choice && { kind: choice.kind, left: Math.round(choice.left), top: Math.round(choice.top), width: Math.round(choice.width), covered: choice.covered };
}

/** The message of flash(): placed clear of every control (domain/toast.js), a
 * click on it closes it and never reaches what lies under it. Above the bottom
 * navigation and the « Détails du dossier » panel (z-60), below confirmations (z-100).
 * It moves when the page settles or scrolls under it (a page just opened, its
 * scroll to the task, a list scrolled by the person), and keeps its place while
 * that place stays clear. When no place is clear, the person's scroll closes it
 * rather than keep it over a command. Behind a native modal dialog, it waits
 * (its time with it, AppContext.holdToast): the dialog states its own result.
 * `route`: the page shown (App.jsx). */
export default function Toast({ route = '' }) {
  const { toast, setToast, holdToast, isStaff } = useApp();
  const node = useRef(null);
  const [placement, setPlacement] = useState(null);
  const placementRef = useRef(null);
  // Shown again after waiting behind a dialog: drawn anew, so assistive technologies announce it then.
  const [generation, setGeneration] = useState(0);
  const schedule = useRef(() => {});
  const keep = next => {
    const previous = placementRef.current;
    const same = previous && next && previous.kind === next.kind && previous.left === next.left && previous.top === next.top && previous.width === next.width;
    if (!same) { placementRef.current = next; setPlacement(next); }
  };
  useLayoutEffect(() => {
    if (!toast) { placementRef.current = null; setPlacement(null); return undefined; }
    let frame = 0;
    let held = false;
    // A scroll, a wheel turn, a swipe or a key of the person since the last placement.
    let personMoved = false;
    let scrolled = false;
    const place = () => {
      frame = 0;
      if (!node.current) return;
      const modal = Boolean(document.querySelector(MODAL));
      holdToast?.(modal);
      if (modal) { held = true; keep(null); scrolled = false; personMoved = false; return; }
      if (held) { held = false; setGeneration(value => value + 1); }
      const next = locate(node.current, isStaff, placementRef.current?.kind);
      // Nothing is clear any more and the person is moving the page: the message goes.
      if (next?.covered && scrolled && personMoved) { setToast(''); return; }
      scrolled = false; personMoved = false;
      keep(next);
    };
    place();
    const later = () => { if (!frame) frame = requestAnimationFrame(place); };
    const onScroll = () => { scrolled = true; later(); };
    const moved = () => { personMoved = true; };
    schedule.current = later;
    window.addEventListener('resize', later);
    window.visualViewport?.addEventListener('resize', later);
    window.visualViewport?.addEventListener('scroll', onScroll);
    // The page or any of its lists scrolls under the toast.
    document.addEventListener('scroll', onScroll, true);
    for (const type of ['wheel', 'touchmove', 'keydown']) window.addEventListener(type, moved, { capture: true, passive: true });
    // Folding or unfolding the navigation column moves the free space.
    const rail = isStaff ? document.querySelector('.staff-sidebar') : null;
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
    if (rail) resizeObserver?.observe(rail);
    // A page drawing its content (after its loading view), a panel opening, a dialog
    // opening or closing: the next frame looks again.
    const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(records => {
      if (records.some(record => !node.current?.contains(record.target))) later();
    }) : null;
    mutationObserver?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'class'] });
    return () => {
      cancelAnimationFrame(frame);
      schedule.current = () => {};
      window.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, true);
      for (const type of ['wheel', 'touchmove', 'keydown']) window.removeEventListener(type, moved, { capture: true, passive: true });
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      holdToast?.(false);
    };
  }, [toast, isStaff]);
  // A save that opens another page: once that page is drawn, the toast moves clear of its controls.
  useEffect(() => { schedule.current(); }, [route]);
  if (!toast) return null;

  const { msg, type, action } = toastContent(toast);
  const Icon = ICONS[type];
  // Measured before the first paint: until then (and behind a modal dialog) the toast takes no room and no click.
  const style = placement ? { left: placement.left, top: placement.top, width: placement.width } : { left: 0, top: 0, visibility: 'hidden' };

  return (
    <div
      key={generation}
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
