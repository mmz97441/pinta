import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { nextPersonalWorkAction, safeWorkReturn, WORK_KINDS, workActionUrl } from '../../domain/personalWork';

/** Mounted after a successful task. Following a link never claims or starts it. */
export default function TaskContinuation({ currentActionId, currentDossierId, currentKind, returnTo, className = '' }) {
  const { auth, data = [], clients = [], can, workActions = [], workPreferences = [], workLoading, workError } = useApp();
  const location = useLocation();
  const now = useMinuteNow();
  const params = new URLSearchParams(location.search);
  const listUrl = safeWorkReturn(returnTo || params.get('returnTo') || '/');
  const actionId = currentActionId || params.get('action');
  const next = !workLoading && !workError ? nextPersonalWorkAction({
    actions: workActions, dossiers: data, clients, userId: auth?.u?.id,
    preference: workPreferences.find(item => item.staff_id === auth?.u?.id), can, now,
    returnTo: listUrl, currentActionId: actionId, currentDossierId, currentKind,
  }) : null;
  const dossier = next && data.find(item => item.id === next.colis_id);
  const client = dossier && clients.find(item => item.id === dossier.clientId);
  return <nav aria-label="Après cette tâche" className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 ${className}`}>
    <Link to={listUrl} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700"><ArrowLeft size={16} />Retour à ma liste</Link>
    {next && <div className="min-w-0"><p className="mb-1 text-xs text-slate-600 break-words">{next.action_hint || WORK_KINDS[next.kind]?.label} · {dossier?.ref} · {client?.nom || [client?.prenom, client?.nomFamille].filter(Boolean).join(' ')}</p><Link to={workActionUrl(next, listUrl, dossier)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white">Ouvrir la prochaine tâche<ArrowRight size={16} /></Link></div>}
  </nav>;
}
