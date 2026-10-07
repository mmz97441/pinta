import React, { useEffect, useRef, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { actionWaiting, canWorkAction, staffAvailable } from '../../domain/personalWork';
import { PRIMARY_COMMAND } from './workCommands';

/** Assignment and start are atomic; business validation stays explicit. */
export default function TaskTakeButton({ action, onClaim }) {
  const { auth, can, workPreferences = [], mutateWorkAction, refreshWork, flash } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const own = action?.assignee_id === auth?.u?.id;
  const available = own || staffAvailable(workPreferences.find(item => item.staff_id === auth?.u?.id));
  if (!action || action.state !== 'ready' || actionWaiting(action) || action.assignee_id && !own || !canWorkAction(action, can)) return null;

  async function claim() {
    if (pending.current || !available) return;
    const requestUrl = window.location.href;
    pending.current = true; setBusy(true); setError('');
    try {
      const saved = await mutateWorkAction(action, 'take');
      // Realtime can remove a successfully claimed row from the pool before
      // the RPC returns. Preserve its confirmation unless the user navigated.
      if (!saved || window.location.href !== requestUrl) return;
      flash('Vous vous occupez de cette tâche.');
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
    {/* « Continuer » reads like the one of a task already started (WorkActionButtons): the word alone. */}
    <button disabled={busy || !available} onClick={claim} data-take-kind={own ? 'continue' : 'claim'} className={PRIMARY_COMMAND}>{own
      ? busy ? 'Ouverture…' : 'Continuer'
      : <><UserCheck size={16} aria-hidden="true" />{busy ? 'Ouverture…' : 'Je m’en occupe'}</>}</button>
    {!available && <p className="text-xs text-slate-600 dark:text-slate-300">Vous êtes indisponible. Modifiez votre disponibilité dans Mon travail pour prendre une tâche.</p>}
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  </div>;
}
