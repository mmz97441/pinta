import React from 'react';
import { useLocation, useSearchParams, Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { MISSIONS, WORK_KINDS, WORK_STATES, sortWorkActions, staffAvailable, actionPriority, actionWaiting, workTotals, workLoad, teamWorkQueues } from '../../domain/personalWork';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import WorkActionRow, { staffName, workDate } from './WorkActionRow';

const QUEUES = [
  { id: 'unassigned', label: 'Prêt à prendre', description: 'Ces tâches peuvent commencer et personne ne s’en occupe encore.', empty: 'Toutes les tâches prêtes ont une personne pour s’en occuper.' },
  { id: 'waiting', label: 'En attente', description: 'Une réponse ou un autre travail est nécessaire. Consultez la raison avant de relancer.', empty: 'Aucune tâche n’attend une réponse ou un autre travail.' },
  { id: 'handoff', label: 'Relais à accepter', description: 'Le collègue actuel reste responsable tant que le destinataire n’a pas accepté.', empty: 'Aucun passage de relais n’attend une acceptation.' },
  { id: 'overdue', label: 'À revoir aujourd’hui', description: 'Une échéance ou une date de suivi est atteinte. Vérifiez la situation et décidez de la suite.', empty: 'Aucune échéance ni date de suivi n’est dépassée.' },
  { id: 'all', label: 'Tout le travail', description: 'Les tâches de l’équipe et la personne qui s’en occupe.', empty: 'Aucune tâche en cours dans les dossiers visibles.' },
];

export default function TeamWorkView() {
  const { data = [], clients = [], teamUsers = [], workActions = [], workPreferences = [], workLoading, workError, refreshWork, auth } = useApp();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const now = useMinuteNow();
  const owner = params.get('owner') || '';
  const mission = params.get('mission') || '';
  const state = params.get('state') || '';
  const exception = params.get('exception') || '';
  const search = (params.get('q') || '').trim().toLocaleLowerCase('fr');
  const hasFilters = [owner, mission, state, exception, search].some(Boolean);
  const queue = QUEUES.find(item => item.id === params.get('queue')) || QUEUES.find(item => item.id === (hasFilters ? 'all' : 'unassigned'));
  const update = (key, value) => setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); next.set('queue', 'all'); return next; });
  const dossiers = new Map(data.map(item => [item.id, item]));
  const clientMap = new Map(clients.map(item => [item.id, item]));
  const all = workActions.filter(action => action.state !== 'done' && dossiers.has(action.colis_id) && !dossiers.get(action.colis_id).archive);
  const queues = teamWorkQueues(all, now);
  const rows = sortWorkActions(queues[queue.id].filter(action => {
    const client = clientMap.get(dossiers.get(action.colis_id)?.clientId);
    const text = [dossiers.get(action.colis_id)?.ref, client?.nom, client?.prenom, client?.nomFamille, action.action_hint, action.blocked_reason, action.waiting_reason, WORK_KINDS[action.kind]?.label].filter(Boolean).join(' ').toLocaleLowerCase('fr');
    return (!owner || (owner === 'unassigned' ? !action.assignee_id : action.assignee_id === (owner === 'me' ? auth?.u?.id : owner)))
      && (!search || text.includes(search)) && (!mission || WORK_KINDS[action.kind]?.mission === mission)
      && (!state || (state === 'waiting' ? actionWaiting(action) : action.state === state && !actionWaiting(action)))
      && (!exception || (exception === 'handoff' ? action.handoff_to : exception === 'blocked' ? action.blocked_reason : actionPriority(action, now).urgent));
  }), now);
  const totals = workTotals(rows, data);
  const returnTo = location.pathname + location.search;
  return <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Équipe</h1><p className="mt-1 text-sm text-slate-600">Repérez le travail à prendre, ce qui attend et les passages de relais.</p></div><Link to="/" className="min-h-11 rounded-lg border px-4 py-3 text-sm font-semibold">Mon travail</Link></header>
    {workError && <p role="alert" className="rounded-xl border border-red-200 p-3 text-red-700">{workError.message || String(workError)} <button onClick={() => refreshWork().catch(() => {})} className="min-h-11 underline">Réessayer</button></p>}
    <nav aria-label="Priorités de l’équipe" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{QUEUES.map(item => <button key={item.id} aria-pressed={queue.id === item.id} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold ${queue.id === item.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'}`} onClick={() => setParams({ queue: item.id })}>{item.label} ({queues[item.id].length})</button>)}</nav>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3"><label className="block min-w-0 flex-1 text-sm font-semibold">Rechercher une EXP ou un client<input value={params.get('q') || ''} onChange={event => update('q', event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" /></label><details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Filtrer les tâches{hasFilters ? ' · filtres actifs' : ''}</summary><div className="flex flex-wrap gap-3">
        <label className="text-xs font-semibold">Personne qui s’en occupe<select value={owner} onChange={event => update('owner', event.target.value)} className="mt-1 block min-h-11 max-w-full rounded-lg border px-2"><option value="">Toute l’équipe</option><option value="me">Moi</option><option value="unassigned">Sans responsable</option>{teamUsers.map(user => <option key={user.authId} value={user.authId}>{staffName(user.authId, teamUsers)}</option>)}</select></label>
        <label className="text-xs font-semibold">Mission<select value={mission} onChange={event => update('mission', event.target.value)} className="mt-1 block min-h-11 max-w-full rounded-lg border px-2"><option value="">Toutes</option>{MISSIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="text-xs font-semibold">État<select value={state} onChange={event => update('state', event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2"><option value="">Tous</option>{Object.entries(WORK_STATES).filter(([key]) => key !== 'done').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-xs font-semibold">Points à surveiller<select value={exception} onChange={event => update('exception', event.target.value)} className="mt-1 block min-h-11 max-w-full rounded-lg border px-2"><option value="">Tous</option><option value="urgent">Échéances et priorités</option><option value="handoff">Relais à accepter</option><option value="blocked">Prérequis manquants</option></select></label>
      </div></details></div>
      {hasFilters && <button onClick={() => setParams({ queue: 'all' })} className="min-h-11 text-sm font-semibold underline">Effacer les filtres</button>}
      <div className="mt-5 border-t border-slate-200 pt-4"><h2 className="font-semibold text-slate-900">{queue.label}</h2><p className="mt-1 text-sm text-slate-600">{queue.description}</p>{rows.length > 0 && <p className="mt-2 text-xs text-slate-600">{totals.actions} tâche(s) · {totals.dossiers} dossier(s)</p>}</div>
      {workLoading && <p className="py-2 text-xs text-slate-600" role="status">{workActions.length ? 'Actualisation des tâches…' : 'Chargement des tâches…'}</p>}
      {rows.length ? <section aria-label={queue.label}>{rows.map(action => { const dossier = dossiers.get(action.colis_id); return <WorkActionRow key={action.id} action={action} dossier={dossier} client={clientMap.get(dossier?.clientId)} returnTo={returnTo} now={now} compactLayout />; })}</section> : !workLoading && !workError && <div className="py-8 text-sm text-slate-600"><p>{hasFilters ? 'Aucune tâche ne correspond à ces filtres.' : queue.empty}</p>{queue.id !== 'all' && <button onClick={() => setParams({ queue: 'all' })} className="mt-2 min-h-11 font-semibold underline">Voir tout le travail de l’équipe</button>}</div>}
    </section>
    <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Qui fait quoi ? Disponibilité et charge de l’équipe</summary><p className="mb-3 text-sm text-slate-600">Les attentes sont séparées du travail à réaliser. Le nombre de tâches n’indique pas leur durée.</p><section aria-label="Charge et disponibilité" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{teamUsers.filter(user => user.actif !== false || all.some(action => action.assignee_id === user.authId)).map(user => {
      const preference = workPreferences.find(item => item.staff_id === user.authId);
      const own = all.filter(action => action.assignee_id === user.authId);
      const available = user.actif !== false && staffAvailable(preference, now);
      const load = workLoad(own);
      return <button key={user.authId} onClick={() => update('owner', owner === user.authId ? '' : user.authId)} aria-pressed={owner === user.authId} className={`rounded-xl border p-4 text-left ${owner === user.authId ? 'border-slate-800 bg-slate-50' : 'border-slate-200 bg-white'}`}><span className="block font-semibold">{staffName(user.authId, teamUsers)}</span><span className="mt-1 block text-xs text-slate-600">{available ? 'Disponible' : 'Indisponible'}{!available && preference?.absent_until ? ` · retour prévu ${workDate(preference.absent_until)}` : ''}{user.actif === false ? ' · compte désactivé' : ''}</span><span className="mt-3 block text-sm">{load.in_progress} en cours · {load.ready} à commencer</span><span className="mt-1 block text-xs text-slate-600">{load.waiting} en attente</span>{own.some(action => actionPriority(action, now).urgent) && <span className="mt-2 block text-xs font-semibold text-amber-800">{own.filter(action => actionPriority(action, now).urgent).length} tâche(s) à revoir</span>}</button>;
    })}</section></details>
  </main>;
}
