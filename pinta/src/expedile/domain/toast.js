/** Short confirmations and errors shown by flash(): a plain string or { msg, type, action, duration }. */
export const TOAST_TYPES = ['info', 'success', 'warning', 'error'];

// A message that reports a failure is shown as an error, whatever tone its
// caller chose: « Erreur : … », « Échec de l’envoi … », « Impossible de copier ».
const FAILURE = /^\s*(erreur|échec|echec|impossible)(\s|:|$)/iu;

export function toastContent(toast) {
  const rich = Boolean(toast) && typeof toast === 'object';
  const msg = String((rich ? toast.msg : toast) ?? '');
  const declared = rich && TOAST_TYPES.includes(toast.type) ? toast.type : 'info';
  return { msg, type: declared !== 'error' && FAILURE.test(msg) ? 'error' : declared, action: rich && toast.action ? toast.action : null };
}

// ── Where a toast goes ──────────────────────────────────────────────────────
// A toast never sits over a control: a click meant for « Se déconnecter », a
// bottom-navigation entry or a clickable row must never land on a message (or,
// through it, on the control). It is also a solid surface: a click on it
// closes it and goes no further (ui/Toast.jsx). Rectangles are
// { left, top, right, bottom } in viewport pixels.

// The staff navigation column holds a toast when it is at least this wide
// (expanded); collapsed (64 px), the toast goes to the page area.
export const RAIL_MIN = 180;
// From this width the page area sits beside the staff navigation (or is wide
// enough for a corner); below it, phone and tablet, the toast is centred, then
// tries the corners at a narrower width.
const DESKTOP = 1024;
const PAGE_WIDTH = 360;
const BAR_WIDTH = 440;
const CORNER_WIDTH = 300;

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
export const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * The places a toast may take, in order of preference:
 * - `rail`: the free space of the expanded staff navigation column, under its
 *   last entry and above « Paramètres » (`zone`: that free space), when the
 *   toast fits in it;
 * - on a desktop, in the page area (beside the column if any): `bottom`
 *   (start), `bottom-end`, then `top-end`;
 * - on a phone or a tablet, centred: `bottom`, then `top`; then the corners,
 *   narrower (`bottom-end`, `bottom-start`, `top-end`, `top-start`), which fit
 *   beside a short heading or between the groups of a toolbar.
 * Bottom places stay above the bottom bars (`floor`: the top of the bottom
 * navigation or of a sticky action bar) and top places below the top bar
 * (`ceiling`). `heightFor(width)` is the toast's height at that width.
 */
export function toastCandidates({ viewport, rail = null, zone = null, ceiling, floor, heightFor }) {
  const top = Number.isFinite(ceiling) ? ceiling : viewport.top || 0;
  const bottom = Number.isFinite(floor) ? floor : (viewport.top || 0) + viewport.height;
  const candidates = [];
  const place = (kind, left, width, edge) => {
    const height = heightFor(width);
    // A message taller than the space keeps its top in view.
    const y = edge === 'top' ? top + (rail ? 16 : 8) : Math.max(top + 8, bottom - (rail ? 16 : 8) - height);
    candidates.push({ kind, ...rect(left, y, width, height) });
  };
  if (rail && rail.width >= RAIL_MIN && zone) {
    const width = rail.width - 24;
    const height = heightFor(width);
    const y = zone.bottom - 8 - height;
    if (y >= zone.top + 8) candidates.push({ kind: 'rail', ...rect(rail.left + 12, y, width, height) });
  }
  if (viewport.width >= DESKTOP) {
    const start = rail ? rail.right : 0;
    const width = Math.min(PAGE_WIDTH, viewport.width - start - 32);
    place('bottom', start + 16, width, 'bottom');
    place('bottom-end', viewport.width - 16 - width, width, 'bottom');
    place('top-end', viewport.width - 16 - width, width, 'top');
  } else {
    const width = Math.min(BAR_WIDTH, viewport.width - 24);
    const left = (viewport.width - width) / 2;
    place('bottom', left, width, 'bottom');
    place('top', left, width, 'top');
    // The corners only add places when they are narrower than the centred bar.
    const corner = Math.min(CORNER_WIDTH, viewport.width - 24);
    if (corner < width - 1) {
      place('bottom-end', viewport.width - 12 - corner, corner, 'bottom');
      place('bottom-start', 12, corner, 'bottom');
      place('top-end', viewport.width - 12 - corner, corner, 'top');
      place('top-start', 12, corner, 'top');
    }
  }
  return candidates;
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * The place a toast takes. `controls`: the rectangles of what one can click
 * there (buttons, links, fields, clickable rows) and of the headings' text.
 * - `current` (the kind of the place it holds): kept while it covers nothing,
 *   so a toast never jumps while it is read;
 * - else the first place that covers nothing;
 * - else, `covered` > 0: the page place hiding the least of them (by area: the
 *   edge of a button rather than a whole row; never the navigation column).
 *   ui/Toast.jsx then closes the toast as soon as the person scrolls rather
 *   than keep it over a command.
 */
export function chooseToastPlacement(candidates, controls = [], { current = null } = {}) {
  const coverage = candidate => {
    const hit = controls.filter(control => overlaps(candidate, control));
    return { covered: hit.length, area: hit.reduce((sum, control) => sum + overlapArea(candidate, control), 0) };
  };
  const held = current && candidates.find(candidate => candidate.kind === current);
  if (held && !coverage(held).covered) return { ...held, covered: 0 };
  let best = null;
  for (const candidate of candidates) {
    const { covered, area } = coverage(candidate);
    if (!covered) return { ...candidate, covered };
    if (candidate.kind !== 'rail' && (!best || area < best.area)) best = { ...candidate, covered, area };
  }
  if (!best) return null;
  const { area: _area, ...choice } = best;
  return choice;
}
