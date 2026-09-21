import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { dossierFollowingWork, workSituation, workTitle } from '../../domain/collaborativeWork';
import { staffName } from './WorkActionRow';
import { nextPersonalWorkAction, safeWorkReturn, WORK_KINDS, workActionUrl } from '../../domain/personalWork';

/** Mounted after a successful task. Following a link never claims or starts it. */
export default function TaskContinuation({ currentActionId, currentDossierId, currentKind, returnTo, onOpenTeam, className = '' }) {
  const { auth, data = [], clients = [], can, workActions = [], workPreferences = [], workLoading, workError, teamUsers = [] } = useApp();
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
  const following = dossierFollowingWork(workActions, currentDossierId, currentKind, actionId);
  const dossier = next && data.find(item => item.id === next.colis_id);
  const client = dossier && clients.find(item => item.id === dossier.clientId);
  return <nav aria-label="Après cette tâche" className={`space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 ${className}`}>
    {currentDossierId && (following.length > 0 || workLoading || workError) && <div aria-label="Suite du dossier" className="space-y-2">
      <p className="text-sm font-semibold text-slate-800">Suite et travail en parallèle</p>
      {workLoading ? <p role="status" className="text-sm text-slate-600">Actualisation du travail de l’équipe…</p> : workError ? <p className="text-sm text-amber-800">Le suivi de l’équipe doit être actualisé depuis Mon travail.</p> : following.length ? following.slice(0, 2).map(action => <div key={action.id} className="text-sm text-slate-700"><p><strong>{workTitle(action)}</strong> · {action.assignee_id === auth?.u?.id ? 'Vous' : action.assignee_id ? staffName(action.assignee_id, teamUsers) : 'À attribuer'}</p><p className="text-slate-600">{workSituation(action)}</p></div>) : <p className="text-sm text-slate-600">Aucune autre tâche d’équipe ouverte dans ce dossier.</p>}
      {onOpenTeam && <button onClick={onOpenTeam} className="min-h-11 text-sm font-semibold text-slate-700 underline">Voir le suivi du dossier</button>}
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-2">
    <Link to={listUrl} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700"><ArrowLeft size={16} />Retour à ma liste</Link>
    {next && <div className="min-w-0"><p className="mb-1 text-xs text-slate-600 break-words">{next.colis_id === currentDossierId ? 'Dans ce dossier' : 'Autre dossier'} · {next.action_hint || WORK_KINDS[next.kind]?.label} · {dossier?.ref} · {client?.nom || [client?.prenom, client?.nomFamille].filter(Boolean).join(' ')}</p><Link to={workActionUrl(next, listUrl, dossier)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700">{next.colis_id === currentDossierId ? 'Voir une autre tâche de ce dossier' : 'Passer à un autre dossier'}<ArrowRight size={16} /></Link></div>}
    </div>
  </nav>;
}
