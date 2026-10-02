import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Search, Users, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { PERSONAL_SECTIONS, availableMissions, buildPersonalWork, personalSection, workTotals, staffAvailable } from '../../domain/personalWork';
import WorkActionRow from './WorkActionRow';
import WorkPreferences from './WorkPreferences';

const tabClass = 'min-h-11 rounded-lg border px-3 text-sm font-semibold';

export default function PersonalWorkView() {
  const { auth, data = [], clients = [], can, workActions = [], workPreferences = [], workLoading, workError, refreshWork } = useApp();
  const [params, setParams] = useSearchParams();
  const location = useLocation(); const navigate = useNavigate(); const now = useMinuteNow();
  const [preferencesRequest, setPreferencesRequest] = useState(0);
  const preference = workPreferences.find(item => item.staff_id === auth?.u?.id);
  const mission = params.get('mission') || '';
  const section = personalSection(params.get('section'));
  const search = params.get('q') || '';
  const view = useMemo(() => buildPersonalWork({ actions: workActions, dossiers: data, clients, userId: auth?.u?.id, preference, can, mission, search, now }), [workActions, data, clients, auth?.u?.id, preference, can, mission, search, now]);
  const unfiltered = useMemo(() => buildPersonalWork({ actions: workActions, dossiers: data, clients, userId: auth?.u?.id, preference, can, now }), [workActions, data, clients, auth?.u?.id, preference, can, now]);
  const rows = view.sections[section]; const totals = workTotals(rows, data); const returnTo = location.pathname + location.search;
  const label = section === 'pool' ? 'À prendre' : PERSONAL_SECTIONS.find(item => item.id === section).label;
  const initialLoading = workLoading && !workActions.length;
  const setFilter = (key, value) => setParams(old => { const next = new URLSearchParams(old); if (value || key === 'mission') next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const clearFilters = () => setParams(old => { const next = new URLSearchParams(old); next.set('mission', ''); next.delete('q'); return next; }, { replace: true });
  const showSection = nextSection => setParams(old => { const next = new URLSearchParams(old); next.set('mission', ''); next.delete('q'); next.set('section', nextSection); return next; }, { replace: true });
  const globalSearchUrl = `/colis${search.trim() ? `?${new URLSearchParams({ q: search.trim() })}` : ''}`;
  const renderRow = (action, notice) => <WorkActionRow key={action.id} action={action} dossier={view.dossierById.get(action.colis_id)} client={view.clientById.get(view.dossierById.get(action.colis_id)?.clientId)} returnTo={returnTo} now={now} density={preference?.density || 'comfortable'} compactLayout notice={notice} />;
  const openPreferences = () => { setPreferencesRequest(value => value + 1); document.getElementById('work-preferences')?.scrollIntoView({ block: 'start' }); };
  const preferencesRequested = params.get('preferences') === '1';
  useEffect(() => {
    if (!preferencesRequested) return;
    setPreferencesRequest(value => value + 1);
    document.getElementById('work-preferences')?.scrollIntoView({ block: 'start' });
  }, [preferencesRequested]);
  const unavailable = !staffAvailable(preference, now);
  const hasFilters = Boolean(search || mission);
  const allowedMissions = availableMissions(can);
  const poolPreferencesActive = view.missions.length < allowedMissions.length;
  const empty = workError
    ? { title: 'Vos tâches n’ont pas pu être chargées', text: 'Réessayez pour savoir quel travail est disponible.', retry: true }
    : section === 'pool' && unavailable
    ? { title: 'Vous avez indiqué être indisponible', text: 'La prise de nouvelles tâches est suspendue. Vous pouvez toujours consulter vos tâches déjà attribuées.', preferences: 'Modifier ma disponibilité' }
    : !allowedMissions.length || (section === 'pool' && !view.missions.length)
      ? allowedMissions.length
        ? { title: 'Choisissez les tâches que vous souhaitez prendre', text: 'Aucun type de travail n’est sélectionné pour les nouvelles tâches. Vos tâches déjà attribuées restent dans À faire et En attente.', preferences: 'Choisir mes missions' }
        : { title: 'Aucune tâche ne vous est accessible', text: 'Demandez à votre responsable de vérifier vos droits d’accès.' }
      : hasFilters
        ? { title: unfiltered.counts[section] ? 'Des tâches sont masquées par vos filtres' : search ? 'Aucune tâche ne correspond à votre recherche' : 'Aucune tâche dans cette mission', text: 'Retirez les filtres ou cherchez dans tous les dossiers.', clear: true }
        : section === 'pool'
          ? { title: 'Aucune tâche prête à prendre', text: 'Les tâches bloquées restent visibles dans le suivi de l’équipe. Vous pouvez aussi élargir les missions affichées.', preferences: poolPreferencesActive ? 'Voir mes missions' : null }
          : section === 'waiting'
            ? { title: 'Aucune de vos tâches n’est en attente', text: 'Retrouvez le travail disponible dans À faire ou À prendre.' }
            : { title: 'Vous n’avez pas de tâche à faire pour le moment', text: unfiltered.counts.pool ? 'Des tâches sont disponibles pour vous dans À prendre.' : unfiltered.counts.waiting ? 'Vos tâches en attente restent dans En attente.' : 'Vous pouvez consulter les dossiers de l’équipe.' };

  return <main className="mx-auto w-full max-w-6xl p-4 sm:p-6 space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">Mon travail</h1><p className="mt-1 text-sm text-slate-600">{auth?.u?.prenom || auth?.u?.nom} · {staffAvailable(preference, now) ? 'Disponible' : 'Indisponibilité déclarée'}</p></div>
      <div className="flex items-start gap-2"><button onClick={() => navigate('/equipe')} className="min-h-11 flex items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold"><Users size={16} />Équipe</button><button onClick={openPreferences} className="inline-flex min-h-11 items-center px-2 text-sm underline">Ma disponibilité</button></div>
    </header>
    {workError && rows.length > 0 && <div role="alert" className="rounded-xl border border-red-200 p-3 text-sm text-red-700">{String(workError.message || workError)}<button onClick={() => refreshWork().catch(() => {})} className="ml-3 min-h-11 underline"><RefreshCw size={14} className="inline mr-1" />Réessayer</button></div>}
    {workLoading && !initialLoading && <p role="status" className="text-xs text-slate-500">Actualisation des tâches…</p>}
    {initialLoading ? <div role="status" className="space-y-3"><p className="text-sm text-slate-600">Chargement des tâches…</p>{[1, 2, 3].map(id => <div key={id} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div> : <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-48 text-sm font-semibold">Rechercher dans mes tâches<span className="relative mt-1 block"><Search size={16} className="absolute left-3 top-3.5 text-slate-400" /><input value={search} onChange={event => setFilter('q', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 font-normal" placeholder="Client, EXP, tâche…" /></span></label>
        <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Filtrer{mission ? ' · 1 actif' : ''}</summary><label className="block font-semibold">Mission<select aria-label="Mission" value={mission} onChange={event => setFilter('mission', event.target.value)} className="mt-1 block min-h-11 max-w-full rounded-xl border border-slate-200 bg-white px-3"><option value="">Tous les types de travail</option>{allowedMissions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></details>
        {search && <Link to={globalSearchUrl} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700 underline underline-offset-4">Chercher aussi dans tous les dossiers<ArrowRight size={15} /></Link>}
      </div>
      {hasFilters && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-100 px-3 text-sm text-slate-700"><p>Filtre actif{mission ? ` · ${allowedMissions.find(item => item.id === mission)?.label || 'Mission sélectionnée'}` : ''}{view.outsideFilterOwned.length > 0 ? ` · ${view.outsideFilterOwned.length} de vos tâches hors de cette sélection` : ''}</p><button onClick={clearFilters} className="min-h-11 font-semibold underline">Tout afficher</button></div>}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <nav aria-label="Mes tâches" className="contents">{PERSONAL_SECTIONS.map(item => <button key={item.id} aria-label={`${item.label} ${view.counts[item.id]}`} aria-pressed={section === item.id} onClick={() => setFilter('section', item.id)} className={`${tabClass} ${section === item.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'}`}>{item.label}<span className="ml-2 tabular-nums">{view.counts[item.id]}</span></button>)}</nav>
        <button aria-label={`À prendre ${view.counts.pool}`} aria-pressed={section === 'pool'} onClick={() => setFilter('section', 'pool')} className={`${tabClass} ${section === 'pool' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'}`}>À prendre<span className="ml-2 tabular-nums">{view.counts.pool}</span></button>
      </div>
      {(view.handoffs.length > 0 || view.exceptions.length > 0) && <nav aria-label="Coordination de mes tâches" className="flex flex-wrap gap-x-4 text-sm font-semibold text-slate-700">{view.handoffs.length > 0 && <a href="#work-handoffs" className="inline-flex min-h-11 items-center underline underline-offset-4">Relais à accepter ({view.handoffs.length})</a>}{view.exceptions.length > 0 && <a href="#work-exceptions" className="inline-flex min-h-11 items-center underline underline-offset-4">Tâches à réorganiser ({view.exceptions.length})</a>}</nav>}
      {view.outsideFilterDue.length > 0 && <section aria-label="Urgences hors filtre" className="rounded-xl border border-amber-300 px-4"><div className="flex flex-wrap items-center justify-between gap-2 pt-2"><h2 className="font-semibold text-amber-800">Urgences hors de ce filtre · {view.outsideFilterDue.length}</h2><button onClick={clearFilters} className="min-h-11 text-sm font-semibold underline">Voir mes tâches sans filtre</button></div>{view.outsideFilterDue.map(action => renderRow(action))}</section>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold text-slate-900">{label}</h2><p className="mt-1 text-sm text-slate-600">{section === 'now' ? 'Le travail qui vous est attribué. Ouvrez une tâche pour continuer.' : section === 'waiting' ? 'Une réponse ou un autre travail est nécessaire. La raison est indiquée sur chaque tâche.' : 'Ces tâches sont prêtes. « Je m’en occupe » vous attribue le travail et l’ouvre.'}</p>{rows.length > 0 && <p className="mt-1 text-xs text-slate-600">{totals.actions} tâche(s) · {totals.dossiers} dossier(s)</p>}</div>

      </div>
      {section === 'pool' && poolPreferencesActive && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-600"><span>Nouvelles tâches proposées : {allowedMissions.filter(item => view.missions.includes(item.id)).map(item => item.label).join(', ') || 'aucune mission sélectionnée'}</span><button onClick={openPreferences} className="min-h-11 font-semibold underline">Modifier les missions affichées</button></div>}
      {rows.length ? <section aria-label={label}>{rows.map(action => renderRow(action))}</section> : <section role={empty.retry ? 'alert' : undefined} aria-label="Pourquoi la liste est vide" className="border-y border-slate-200 py-8 text-center"><h2 className="font-semibold text-slate-900">{empty.title}</h2><p className="mt-2 text-sm text-slate-600">{empty.text}</p><div className="mt-3 flex flex-wrap justify-center gap-3">
        {empty.retry && <button onClick={() => refreshWork().catch(() => {})} className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white">Recharger les tâches</button>}
        {empty.clear && <button onClick={clearFilters} className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white">Effacer les filtres</button>}
        {empty.preferences && <button onClick={openPreferences} className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white">{empty.preferences}</button>}
        {!hasFilters && !empty.preferences && !empty.retry && section !== 'pool' && unfiltered.counts.pool > 0 && <button onClick={() => showSection('pool')} className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white">Voir les tâches à prendre</button>}
        {section !== 'now' && unfiltered.counts.now > 0 && <button onClick={() => showSection('now')} className="min-h-11 px-3 text-sm font-semibold underline">Voir mes tâches à faire</button>}
        {section !== 'waiting' && unfiltered.counts.waiting > 0 && <button onClick={() => showSection('waiting')} className="min-h-11 px-3 text-sm font-semibold underline">Voir mes tâches en attente</button>}
        {section === 'pool' && !empty.retry && <Link to="/equipe?queue=waiting" className="inline-flex min-h-11 items-center px-3 text-sm font-semibold underline">Voir les attentes de l’équipe</Link>}
        <Link to={globalSearchUrl} className="inline-flex min-h-11 items-center px-3 text-sm font-semibold underline">{search ? 'Chercher ce dossier dans toute l’équipe' : 'Voir les dossiers de l’équipe'}</Link>
      </div></section>}
      {view.handoffs.length > 0 && <section id="work-handoffs" aria-label="Relais à accepter" className="rounded-xl border border-blue-200 px-4"><h2 className="pt-3 font-semibold text-slate-900">Relais à accepter · {view.handoffs.length}</h2><p className="mt-1 text-xs text-slate-600">Le collègue reste responsable jusqu’à votre acceptation.</p>{view.handoffs.map(action => renderRow(action))}</section>}
      {view.exceptions.length > 0 && <section id="work-exceptions" aria-label="Tâches hors missions ou permissions" className="rounded-xl border border-amber-300 px-4"><div className="flex flex-wrap items-center justify-between gap-2 pt-2"><h2 className="font-semibold text-amber-800">Tâches à réorganiser · {view.exceptions.length}</h2><Link to={`/equipe?owner=${auth.u.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold underline">Organiser un relais</Link></div>{view.exceptions.map(action => renderRow(action, 'Permission modifiée : organisez un relais avec une personne habilitée.'))}</section>}
    </>}
    <section id="work-preferences" className="scroll-mt-4 border-t pt-4"><WorkPreferences preference={preference} openRequest={preferencesRequest} /></section>
  </main>;
}
