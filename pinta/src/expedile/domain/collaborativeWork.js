import { actionWaiting, sortWorkActions, WORK_KINDS } from './personalWork.js';

export function workSituation(action) {
  if (action.state === 'done') return 'Terminé';
  if (actionWaiting(action)) return action.blocked_reason || action.waiting_reason || 'En attente de reprise par l’équipe';
  return action.state === 'in_progress' ? 'En cours' : action.assignee_id ? 'Prêt à continuer' : 'Disponible';
}

export function workTitle(action) {
  return action.action_hint || WORK_KINDS[action.kind]?.label || 'Travail à préciser';
}

/** The next colleague's work matters even when it is outside my permissions.
 * These rows are information only, never a grant to execute that work. */
export function dossierFollowingWork(actions, dossierId, currentKind, currentActionId) {
  const rows = actions.filter(action => action.colis_id === dossierId && action.state !== 'done'
    && action.id !== currentActionId && (!currentKind || action.kind !== currentKind));
  const ordered = sortWorkActions(rows);
  return [...ordered.filter(action => !actionWaiting(action)), ...ordered.filter(actionWaiting)];
}
