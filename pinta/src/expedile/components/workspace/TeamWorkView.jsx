import React from 'react';
import { useLocation, useSearchParams, Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { MISSIONS, WORK_KINDS, WORK_STATES, sortWorkActions, staffAvailable, actionPriority, workTotals } from '../../domain/personalWork';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import WorkActionRow, { staffName, workDate } from './WorkActionRow';

export default function TeamWorkView() {
  const { data = [], clients = [], teamUsers = [], workActions = [], workPreferences = [], workLoading, workError, refreshWork, auth } = useApp();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const now = useMinuteNow();
  const owner = params.get('owner') || '';
  const mission = params.get('mission') || '';
  const state = params.get('state') || '';
  const exception = params.get('exception') || '';
  const update = (key, value) => setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next; });
  const dossiers = new Map(data.map(item => [item.id, item]));
  const clientMap = new Map(clients.map(item => [item.id, item]));
  const all = workActions.filter(action => action.state !== 'done' && dossiers.has(action.colis_id) && !dossiers.get(action.colis_id).archive);
  const rows = sortWorkActions(all.filter(action => (!owner || (owner === 'unassigned' ? !action.assignee_id : action.assignee_id === (owner === 'me' ? auth?.u?.id : owner)))
    && (!mission || WORK_KINDS[action.kind]?.mission === mission) && (!state || action.state === state)
    && (!exception || (exception === 'handoff' ? action.handoff_to : exception === 'blocked' ? action.blocked_reason : actionPriority(action, now).urgent))), now);
  const totals = workTotals(rows, data);
  const returnTo = location.pathname + location.search;
  return <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Équipe</h1><p className="mt-1 text-sm text-slate-600">Responsables, attentes et relais. La disponibilité est déclarée par chacun.</p></div><Link to="/" className="min-h-11 rounded-lg border px-4 py-3 text-sm font-semibold">Mon travail</Link></header>
    {workError && <p role="alert" className="rounded-xl border border-red-200 p-3 text-red-700">{workError.message || String(workError)} <button onClick={() => refreshWork().catch(() => {})} className="underline">Réessayer</button></p>}
    <section aria-label="Charge et disponibilité" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{teamUsers.filter(user => user.actif !== false || all.some(action => action.assignee_id === user.authId)).map(user => {
      const preference = workPreferences.find(item => item.staff_id === user.authId);
      const own = all.filter(action => action.assignee_id === user.authId);
      const available = user.actif !== false && staffAvailable(preference, now);
      return <button key={user.authId} onClick={() => update('owner', owner === user.authId ? '' : user.authId)} aria-pressed={owner === user.authId} className={`rounded-xl border p-4 text-left ${owner === user.authId ? 'border-slate-800 bg-slate-50' : 'border-slate-200 bg-white'}`}><span className="block font-semibold">{staffName(user.authId, teamUsers)}</span><span className="mt-1 block text-xs text-slate-600">{available ? 'Disponible' : 'Indisponible'}{preference?.absent_until ? ` · retour prévu ${workDate(preference.absent_until)}` : ''}{user.actif === false ? ' · compte désactivé' : ''}</span><span className="mt-3 flex flex-wrap gap-3 text-xs">{Object.entries(WORK_STATES).filter(([key]) => key !== 'done').map(([key, label]) => <span key={key}>{own.filter(action => action.state === key).length} {label.toLowerCase()}</span>)}</span>{own.some(action => actionPriority(action, now).urgent) && <span className="mt-2 block text-xs font-semibold text-amber-800">{own.filter(action => actionPriority(action, now).urgent).length} action(s) à surveiller</span>}</button>;
    })}</section>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap gap-3">
      <label className="text-xs font-semibold">Responsable de l’action<select value={owner} onChange={event => update('owner', event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2"><option value="">Toute l’équipe</option><option value="me">Moi</option><option value="unassigned">Sans responsable</option>{teamUsers.map(user => <option key={user.authId} value={user.authId}>{staffName(user.authId, teamUsers)}</option>)}</select></label>
      <label className="text-xs font-semibold">Mission<select value={mission} onChange={event => update('mission', event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2"><option value="">Toutes</option>{MISSIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="text-xs font-semibold">État<select value={state} onChange={event => update('state', event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2"><option value="">Tous</option>{Object.entries(WORK_STATES).filter(([key]) => key !== 'done').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold">Points à surveiller<select value={exception} onChange={event => update('exception', event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2"><option value="">Tous</option><option value="urgent">Échéances et priorités</option><option value="handoff">Relais à accepter</option><option value="blocked">Prérequis manquants</option></select></label>
    </div><p className="mt-4 text-sm text-slate-600">{totals.actions} actions · {totals.dossiers} dossiers · {totals.cartons} cartons reçus</p>
    {workLoading && <p className="py-2 text-xs text-slate-600" role="status">{workActions.length ? 'Actualisation des actions…' : 'Chargement des actions…'}</p>}
    {rows.length ? rows.map(action => { const dossier = dossiers.get(action.colis_id); return <WorkActionRow key={action.id} action={action} dossier={dossier} client={clientMap.get(dossier?.clientId)} returnTo={returnTo} now={now} />; }) : !workLoading && <p className="py-8 text-sm text-slate-600">Aucune action dans ces filtres.</p>}
    </section>
  </main>;
}
