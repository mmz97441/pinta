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

// The staff navigation column must be at least this wide to hold a toast;
// otherwise (collapsed column) the toast sits just beside it.
const RAIL_MIN = 180;

/** Where the toast goes, so that it never hides a page heading or a primary
 * action: over the desktop navigation column when there is one, otherwise over
 * the bottom navigation bar (phone, tablet and client portal). */
export function toastPlacement(railWidth) {
  const rail = Number(railWidth) || 0;
  if (rail >= RAIL_MIN) return { kind: 'rail', left: 12, width: rail - 24 };
  if (rail > 0) return { kind: 'beside-rail', left: rail + 12, width: 320 };
  return { kind: 'bottom-bar' };
}
