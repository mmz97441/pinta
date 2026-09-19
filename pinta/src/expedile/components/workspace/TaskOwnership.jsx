import React, { useEffect, useRef, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { actionWaiting, canWorkAction, staffAvailable, WORK_KINDS } from '../../domain/personalWork';

/** Claim is assignment only: it never starts work or changes client consent. */
export function TaskClaimButton({ action, onClaim }) {
  const { auth, can, workPreferences = [], mutateWorkAction, refreshWork, flash } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const available = staffAvailable(workPreferences.find(item => item.staff_id === auth?.u?.id));
  if (!action || action.state === 'done' || action.assignee_id || !canWorkAction(action, can)) return null;

  async function claim() {
    if (pending.current || !available) return;
    const requestUrl = window.location.href;
    pending.current = true; setBusy(true); setError('');
    try {
      const saved = await mutateWorkAction(action, 'claim');
      // Realtime can remove a successfully claimed row from the pool before
      // the RPC returns. Preserve its confirmation unless the user navigated.
      if (window.location.href !== requestUrl) return;
      flash(actionWaiting(saved) ? 'Tâche prise en charge. Elle reste en attente.' : 'Tâche prise en charge.');
      onClaim?.(saved);
    } catch (err) {
      if (window.location.href !== requestUrl) return;
      const message = err.message || 'La prise en charge a échoué. Réessayez.';
      if (mounted.current) setError(message);
      flash({ msg: message, type: 'error' });
      // A colleague may have claimed it since this screen loaded. Refresh the
      // owner; never retry an assignment automatically after a conflict.
      await refreshWork().catch(() => {});
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <div className="space-y-1.5">
    <button disabled={busy || !available} onClick={claim} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"><UserCheck size={16} />{busy ? 'Prise en charge…' : 'Prendre cette tâche'}</button>
    {!available ? <p className="text-xs text-slate-600 dark:text-slate-300">Vous êtes indisponible. Modifiez votre disponibilité dans Mon travail pour prendre une tâche.</p>
      : actionWaiting(action) && <p className="text-xs text-slate-600 dark:text-slate-300">Vous prenez le suivi ; l’attente reste inchangée.</p>}
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  </div>;
}

export default function TaskOwnership({ action }) {
  const { auth, teamUsers = [] } = useApp();
  if (!action || action.state === 'done') return null;
  const own = action.assignee_id === auth?.u?.id;
  const person = teamUsers.find(user => user.authId === action.assignee_id);
  const name = person ? [person.prenom, person.nom].filter(Boolean).join(' ') : 'un membre de l’équipe';
  const reason = action.blocked_reason || action.waiting_reason;
  return <section aria-label="Prise en charge de la tâche" data-testid="task-ownership" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
    <div className="min-w-0 text-sm text-slate-700 dark:text-slate-200">
      {action.kind === 'correction' && <p className="mb-1 text-xs">{WORK_KINDS.correction.label}</p>}
      <p role="status" className="font-semibold">{own ? 'Vous vous en occupez' : action.assignee_id ? `Pris en charge par ${name}` : 'Cette tâche est à prendre'}</p>
      {actionWaiting(action) && <p className="mt-1 text-xs">En attente{reason ? ` · ${reason}` : ''}</p>}
    </div>
    <TaskClaimButton key={action.id} action={action} />
  </section>;
}
