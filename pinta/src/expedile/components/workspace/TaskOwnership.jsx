import React from 'react';
import { useApp } from '../../context/AppContext';
import { actionWaiting, canWorkAction, WORK_KINDS } from '../../domain/personalWork';
import { WorkActionControls, staffName } from './WorkActionRow';

// compact: one line inside a status bar (the conversation thread), without its own box.
export default function TaskOwnership({ action, compact = false }) {
  const { auth, teamUsers = [], can = () => false } = useApp();
  if (!action || action.state === 'done') return null;
  const own = action.assignee_id === auth?.u?.id;
  const waiting = actionWaiting(action);
  const reason = action.blocked_reason || action.waiting_reason;
  // A free task this role cannot take reads as in the list, never « à prendre » without a button.
  const status = own ? 'Vous vous en occupez' : action.assignee_id ? `Pris en charge par ${staffName(action.assignee_id, teamUsers)}`
    : waiting ? 'Cette tâche attend' : !canWorkAction(action, can) ? 'Cette tâche nécessite une personne autorisée.' : 'Cette tâche est à prendre';
  return <section aria-label="Prise en charge de la tâche" data-testid="task-ownership" className={compact ? 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1' : 'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800'}>
    <div className={compact ? 'min-w-0 text-sm text-slate-600 dark:text-slate-300' : 'min-w-0 text-sm text-slate-700 dark:text-slate-200'}>
      {action.kind === 'correction' && <p className="mb-1 text-xs">{WORK_KINDS.correction.label}</p>}
      <p role="status" className={compact ? undefined : 'font-semibold'}>{status}</p>
      {waiting && <p className="mt-1 text-sm">{reason || 'En attente de reprise par l’équipe.'}</p>}
      {action.handoff_to && <p className="mt-1 text-sm">Relais proposé à {staffName(action.handoff_to, teamUsers)} · acceptation attendue</p>}
      {action.handoff_note && <p className="mt-1 whitespace-pre-wrap text-sm"><strong>Consigne de reprise : </strong>{action.handoff_note}</p>}
    </div>
    <WorkActionControls key={action.id} action={action} inTask compact />
  </section>;
}
