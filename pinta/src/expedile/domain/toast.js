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
// A toast never sits over a control: a click meant for « Se déconnecter » or a
// bottom-navigation entry must never land on a message (or, through it, on the
// control). It is also a solid surface: a click on it closes it and goes no
// further (ui/Toast.jsx). Rectangles are { left, top, right, bottom } in
// viewport pixels.

// The staff navigation column holds a toast when it is at least this wide
// (expanded); collapsed (64 px), the toast goes to the page area.
export const RAIL_MIN = 180;
// From this width the page area sits beside the staff navigation (or is wide
// enough for a corner); below it, phone and tablet, the toast is centred.
const DESKTOP = 1024;
const PAGE_WIDTH = 360;
const BAR_WIDTH = 440;

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
export const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * The places a toast may take, in order of preference:
 * - `rail`: the free space of the expanded staff navigation column, under its
 *   last entry and above « Paramètres » (`zone`: that free space), when the
 *   toast fits in it;
 * - on a desktop, in the page area (beside the column if any): `bottom`
 *   (start), `bottom-end`, then `top-end`;
 * - on a phone or a tablet, centred: `bottom`, then `top`.
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
  }
  return candidates;
}

/**
 * The first place that covers no control (`controls`: the rectangles of the
 * buttons, links and fields one can click there). When every place covers
 * one, the page place covering the fewest (the navigation column is never
 * covered); the toast then still takes the click for itself.
 */
export function chooseToastPlacement(candidates, controls = []) {
  let best = null;
  for (const candidate of candidates) {
    const covered = controls.filter(control => overlaps(candidate, control)).length;
    if (!covered) return { ...candidate, covered };
    if (candidate.kind !== 'rail' && (!best || covered < best.covered)) best = { ...candidate, covered };
  }
  return best;
}
