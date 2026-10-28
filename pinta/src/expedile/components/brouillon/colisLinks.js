import { actionAllowed, colisActionHref } from '../../domain/brouillon';

// The addresses and rights of an action on « Colis » and its Brouillon sheet: the page it opens keeps the way back
// (`returnTo`), and an action the account may not do is never offered as if it could (actionAllowed and the
// action's `deniedReason`, domain/brouillon.js).

export { actionAllowed };

/** `href` with its way back set to `returnTo` (any earlier one replaced); the hash stays last. */
export function withReturnTo(href, returnTo) {
  if (!href) return null;
  if (!returnTo) return href;
  const hashAt = href.indexOf('#');
  const hash = hashAt >= 0 ? href.slice(hashAt) : '';
  const path = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = path.indexOf('?');
  const params = new URLSearchParams(queryAt >= 0 ? path.slice(queryAt + 1) : '');
  params.set('returnTo', returnTo);
  return `${queryAt >= 0 ? path.slice(0, queryAt) : path}?${params}${hash}`;
}

/** The page an action opens, with the way back: its dossier task or the dossier's conversation (colisActionHref),
 * the reception to validate (with the way back too). Null for a message opened in place (`panel`) and without
 * action. */
export function actionTarget(row, action, returnTo = '/') {
  if (!action || action.panel || !row?.id) return null;
  const href = colisActionHref({ ...row, action }, returnTo);
  return href && href.startsWith('/recevoir') ? withReturnTo(href, returnTo) : href;
}

/** The whole dossier (/colis/:id) in consultation, with the way back: what an account sees of an action it may not do. */
export function dossierHref(id, returnTo) {
  return `/colis/${encodeURIComponent(id)}${returnTo ? `?${new URLSearchParams({ returnTo })}` : ''}`;
}

/** Why an action is not offered to this account (its `deniedReason`). */
export function refusalReason(action) {
  return action?.deniedReason || 'Réservé aux personnes autorisées.';
}

/** « Lucie Martin s’en occupe », for a step whose task a colleague holds (`stage.heldBy`). */
export function heldLabel(heldBy) {
  if (!heldBy) return null;
  const name = String(heldBy.name || '').trim();
  return `${name || 'Un collègue'} s’en occupe`;
}
