import React from 'react';
import { useApp } from '../../context/AppContext';
import { actionWaiting, WORK_KINDS } from '../../domain/personalWork';
import { WorkActionControls, staffName } from './WorkActionRow';

export default function TaskOwnership({ action }) {
  const { auth, teamUsers = [] } = useApp();
  if (!action || action.state === 'done') return null;
  const own = action.assignee_id === auth?.u?.id;
  const waiting = actionWaiting(action);
  const reason = action.blocked_reason || action.waiting_reason;
  return <section aria-label="Prise en charge de la tâche" data-testid="task-ownership" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
    <div className="min-w-0 text-sm text-slate-700 dark:text-slate-200">
      {action.kind === 'correction' && <p className="mb-1 text-xs">{WORK_KINDS.correction.label}</p>}
      <p role="status" className="font-semibold">{own ? 'Vous vous en occupez' : action.assignee_id ? `Pris en charge par ${staffName(action.assignee_id, teamUsers)}` : waiting ? 'Cette tâche attend' : 'Cette tâche est à prendre'}</p>
      {waiting && <p className="mt-1 text-sm">{reason || 'En attente de reprise par l’équipe.'}</p>}
      {action.handoff_to && <p className="mt-1 text-sm">Relais proposé à {staffName(action.handoff_to, teamUsers)} · acceptation attendue</p>}
      {action.handoff_note && <p className="mt-1 whitespace-pre-wrap text-sm"><strong>Consigne de reprise : </strong>{action.handoff_note}</p>}
    </div>
    <WorkActionControls key={action.id} action={action} inTask compact />
  </section>;
}
