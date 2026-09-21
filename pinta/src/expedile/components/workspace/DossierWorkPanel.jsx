import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { fetchDossierWork } from '../../lib/supabaseData';
import { actionWaiting, sortWorkActions } from '../../domain/personalWork';
import { workSituation, workTitle } from '../../domain/collaborativeWork';
import { WorkActionControls, staffName } from './WorkActionRow';

export default function DossierWorkPanel({ dossier }) {
  const { sel, workActions = [], teamUsers = [], auth } = useApp();
  const location = useLocation();
  const current = dossier || sel;
  const [history, setHistory] = useState({ id: null, rows: [], loading: true, error: '' });
  const [retry, setRetry] = useState(0);
  const revision = workActions.filter(action => action.colis_id === current?.id).map(action => `${action.id}:${action.version}`).join('|');
  useEffect(() => {
    let active = true;
    if (!current?.id) return;
    setHistory(previous => ({ ...previous, loading: true, error: '' }));
    fetchDossierWork(current.id).then(rows => { if (active) setHistory({ id: current.id, rows, loading: false, error: '' }); })
      .catch(error => { if (active) setHistory(previous => ({ ...previous, loading: false, error: error.message || 'Le suivi ne peut pas être chargé.' })); });
    return () => { active = false; };
  }, [current?.id, current?.updatedAt, revision, retry]);
  const known = new Map((history.id === current?.id ? history.rows : []).map(action => [action.id, action]));
  workActions.filter(action => action.colis_id === current?.id).forEach(action => {
    if (!known.has(action.id) || action.version >= known.get(action.id).version) known.set(action.id, action);
  });
  const all = [...known.values()];
  const rows = [...sortWorkActions(all.filter(action => action.state !== 'done')), ...all.filter(action => action.state === 'done')];
  return <section aria-label="Suivi partagé du dossier" className="space-y-3 rounded-xl border border-slate-200 p-4">
    <h2 className="font-semibold">Qui fait quoi ?</h2>
    {history.loading && <p role="status" className="text-sm text-slate-600">Actualisation du suivi…</p>}
    {history.error && <p role="alert" className="text-sm text-red-700">{history.error}<button className="ml-2 min-h-11 underline" onClick={() => setRetry(value => value + 1)}>Réessayer</button></p>}
    {!history.loading && !history.error && !rows.length && <p className="text-sm text-slate-600">Aucune tâche enregistrée pour ce dossier. Consultez son état et les échanges dans les détails.</p>}
    <ul className="divide-y divide-slate-200">{rows.map(action => <li key={action.id} className="space-y-2 py-3" data-dossier-work={action.kind}>
      <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-sm font-semibold">{workTitle(action)}</h3><span className="text-sm text-slate-600">{action.assignee_id === auth?.u?.id ? 'Vous' : action.assignee_id ? staffName(action.assignee_id, teamUsers) : action.state === 'done' ? 'Équipe' : actionWaiting(action) ? 'Suivi à attribuer' : 'À prendre'}</span></div>
      <p className={`text-sm ${action.state === 'done' ? 'text-emerald-700' : 'text-slate-600'}`}>{workSituation(action)}</p>
      {action.handoff_to && <p className="text-sm text-amber-800">Relais proposé à {staffName(action.handoff_to, teamUsers)} · acceptation attendue</p>}
      {action.handoff_note && <p className="whitespace-pre-wrap text-sm text-slate-700"><strong>Consigne de reprise : </strong>{action.handoff_note}</p>}
      {action.state !== 'done' && <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Ouvrir ou organiser cette tâche</summary><WorkActionControls action={action} returnTo={location.pathname + location.search} compact /></details>}
    </li>)}</ul>
  </section>;
}
