import React, { useMemo } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Search, Users, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { MISSIONS, PERSONAL_SECTIONS, buildPersonalWork, personalSection, workTotals, workActionUrl, staffAvailable, canWorkAction } from '../../domain/personalWork';
import WorkActionRow from './WorkActionRow';
import WorkPreferences from './WorkPreferences';

const tabClass = 'min-h-11 rounded-lg border px-4 text-sm font-semibold';

export default function PersonalWorkView() {
  const { auth, data = [], clients = [], can, workActions = [], workPreferences = [], workLoading, workError, refreshWork } = useApp();
  const [params, setParams] = useSearchParams();
  const location = useLocation(); const navigate = useNavigate(); const now = useMinuteNow();
  const preference = workPreferences.find(item => item.staff_id === auth?.u?.id);
  const mission = params.has('mission') ? params.get('mission') : preference?.active_mission || '';
  const section = personalSection(params.get('section'));
  const search = params.get('q') || '';
  const view = useMemo(() => buildPersonalWork({ actions: workActions, dossiers: data, clients, userId: auth?.u?.id, preference, can, mission, search, now }), [workActions, data, clients, auth?.u?.id, preference, can, mission, search, now]);
  const rows = view.sections[section]; const totals = workTotals(rows, data); const returnTo = location.pathname + location.search;
  const label = section === 'pool' ? 'À prendre' : PERSONAL_SECTIONS.find(item => item.id === section).label;
  const initialLoading = workLoading && !workActions.length && !workPreferences.length;
  const setFilter = (key, value) => setParams(old => { const next = new URLSearchParams(old); if (value || key === 'mission') next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const clearFilters = () => setParams(old => { const next = new URLSearchParams(old); next.set('mission', ''); next.delete('q'); return next; }, { replace: true });
  const globalSearchUrl = `/colis${search.trim() ? `?${new URLSearchParams({ q: search.trim() })}` : ''}`;
  const renderRow = (action, notice) => <WorkActionRow key={action.id} action={action} dossier={view.dossierById.get(action.colis_id)} client={view.clientById.get(view.dossierById.get(action.colis_id)?.clientId)} returnTo={returnTo} now={now} density={preference?.density || 'compact'} compactLayout notice={notice} />;

  return <main className="mx-auto w-full max-w-6xl p-4 sm:p-6 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">Mon travail</h1><p className="mt-1 text-sm text-slate-600">{auth?.u?.prenom || auth?.u?.nom} · {staffAvailable(preference, now) ? 'Disponible' : 'Indisponibilité déclarée'}</p></div>
      <div className="flex flex-wrap gap-2"><button onClick={() => navigate('/equipe')} className="min-h-11 flex items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold"><Users size={16} />Équipe</button><WorkPreferences preference={preference} /></div>
    </header>
    {workError && <div role="alert" className="rounded-xl border border-red-200 p-3 text-sm text-red-700">{String(workError.message || workError)}<button onClick={() => refreshWork().catch(() => {})} className="ml-3 min-h-11 underline"><RefreshCw size={14} className="inline mr-1" />Réessayer</button></div>}
    {workLoading && !initialLoading && <p role="status" className="text-xs text-slate-500">Actualisation des actions…</p>}
    {initialLoading ? <div role="status" className="space-y-3"><p className="text-sm text-slate-600">Chargement des actions…</p>{[1, 2, 3].map(id => <div key={id} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div> : <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">Mission<select aria-label="Mission" value={mission} onChange={event => setFilter('mission', event.target.value)} className="mt-1 block min-h-11 max-w-full rounded-xl border border-slate-200 bg-white px-3"><option value="">Toutes mes missions</option>{MISSIONS.filter(item => view.missions.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="flex-1 min-w-48 text-sm font-semibold">Rechercher dans mes tâches<span className="relative mt-1 block"><Search size={16} className="absolute left-3 top-3.5 text-slate-400" /><input value={search} onChange={event => setFilter('q', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 font-normal" placeholder="Client, EXP, action…" /></span></label>
        <Link to={globalSearchUrl} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700 underline underline-offset-4">Rechercher dans tous les dossiers<ArrowRight size={15} /></Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <nav aria-label="Mes actions" className="flex gap-2">{PERSONAL_SECTIONS.map(item => <button key={item.id} aria-label={`${item.label} ${view.counts[item.id]}`} aria-pressed={section === item.id} onClick={() => setFilter('section', item.id)} className={`${tabClass} ${section === item.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'}`}>{item.label}<span className="ml-2 tabular-nums">{view.counts[item.id]}</span></button>)}</nav>
        <button aria-label={`À prendre ${view.counts.pool}`} aria-pressed={section === 'pool'} onClick={() => setFilter('section', 'pool')} className={`${tabClass} ${section === 'pool' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'}`}>À prendre<span className="ml-2 tabular-nums">{view.counts.pool}</span></button>
      </div>
      {(view.handoffs.length > 0 || view.exceptions.length > 0) && <nav aria-label="Coordination de mes tâches" className="flex flex-wrap gap-x-4 text-sm font-semibold text-slate-700">{view.handoffs.length > 0 && <a href="#work-handoffs" className="inline-flex min-h-11 items-center underline underline-offset-4">Relais à accepter ({view.handoffs.length})</a>}{view.exceptions.length > 0 && <a href="#work-exceptions" className="inline-flex min-h-11 items-center underline underline-offset-4">Actions à réorganiser ({view.exceptions.length})</a>}</nav>}
      {view.outsideFilterDue.length > 0 && <section aria-label="Urgences hors filtre" className="rounded-xl border border-amber-300 px-4"><div className="flex flex-wrap items-center justify-between gap-2 pt-2"><h2 className="font-semibold text-amber-800">Urgences hors de ce filtre · {view.outsideFilterDue.length}</h2><button onClick={clearFilters} className="min-h-11 text-sm font-semibold underline">Voir mes tâches sans filtre</button></div>{view.outsideFilterDue.map(action => renderRow(action))}</section>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold text-slate-900">{label}</h2><p className="mt-1 text-xs text-slate-600">{totals.actions} action(s) · {totals.dossiers} dossier(s) · {totals.cartons} carton(s) reçu(s){section === 'now' ? ' · Tâches en cours incluses' : ''}</p>{section === 'pool' && <p className="mt-1 text-sm text-slate-600">{staffAvailable(preference, now) ? 'Choisissez une tâche libre. La consultation ne vous l’attribue pas.' : 'Votre indisponibilité suspend la prise de nouvelles tâches. Vos tâches attribuées restent accessibles dans À faire.'}</p>}</div>
        {section === 'now' && rows[0] && <Link to={workActionUrl(rows[0], returnTo, view.dossierById.get(rows[0].colis_id))} className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white">Traiter le suivant<ArrowRight size={16} /></Link>}
      </div>
      {rows.length ? <section aria-label={label}>{rows.map(action => renderRow(action))}</section> : <div className="border-y border-slate-200 py-8 text-center"><h2 className="font-semibold text-slate-900">Aucune action dans cette sélection</h2><p className="mt-2 text-sm text-slate-600">{view.missions.length ? 'Vos filtres concernent uniquement vos tâches. Vous pouvez aussi chercher dans tous les dossiers autorisés.' : 'Choisissez une mission autorisée dans vos préférences.'}</p><div className="mt-3 flex flex-wrap justify-center gap-3">{(search || mission) && <button onClick={clearFilters} className="min-h-11 px-3 text-sm font-semibold underline">Effacer les filtres</button>}{section !== 'pool' && <button onClick={() => setFilter('section', 'pool')} className="min-h-11 px-3 text-sm font-semibold underline">Voir les actions à prendre</button>}</div></div>}
      {view.handoffs.length > 0 && <section id="work-handoffs" aria-label="Relais à accepter" className="rounded-xl border border-blue-200 px-4"><h2 className="pt-3 font-semibold text-slate-900">Relais à accepter · {view.handoffs.length}</h2><p className="mt-1 text-xs text-slate-600">Le collègue reste responsable jusqu’à votre acceptation.</p>{view.handoffs.map(action => renderRow(action))}</section>}
      {view.exceptions.length > 0 && <section id="work-exceptions" aria-label="Actions hors missions ou permissions" className="rounded-xl border border-amber-300 px-4"><div className="flex flex-wrap items-center justify-between gap-2 pt-2"><h2 className="font-semibold text-amber-800">Actions à réorganiser · {view.exceptions.length}</h2><Link to={`/equipe?owner=${auth.u.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold underline">Organiser un relais</Link></div>{view.exceptions.map(action => renderRow(action, canWorkAction(action, can) ? 'Hors de vos missions choisies : cette action vous reste attribuée.' : 'Permission modifiée : organisez un relais avec une personne habilitée.'))}</section>}
    </>}
  </main>;
}
