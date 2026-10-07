import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, ListFilter, Loader2, Search, Settings2, Users, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import useDossierTablePreferences from '../../hooks/useDossierTablePreferences';
import useWorkLayout from '../../hooks/useWorkLayout';
import { PERSONAL_SECTIONS, availableMissions, buildPersonalWork, personalSection, workTotals, staffAvailable, staffDisplayName } from '../../domain/personalWork';
import { WORK_TABLE_CHOICES, visibleWorkColumns } from '../../domain/workTable';
import { plural } from '../../domain/plural';
import { holdsStaffData, staffDataState } from '../../domain/dataLoad';
import { DossierColumnVisibility } from '../staff/DossierColumnOptions';
import WorkActionRow, { PRIMARY_COMMAND } from './WorkActionRow';
import WorkActionTable from './WorkActionTable';
import WorkDisplayOptions from './WorkDisplayOptions';
import WorkPreferences from './WorkPreferences';
import WorkLoadError from './WorkLoadError';
import useParamInput from '../../hooks/useParamInput';
import '../staff/dossierTable.css';
import './workTable.css';

const SECTION_HELP = {
  now: 'Le travail qui vous est attribué. Ouvrez une tâche pour continuer.',
  waiting: 'Une réponse ou un autre travail est nécessaire. La raison est indiquée sur chaque tâche.',
  pool: 'Ces tâches sont prêtes. « Je m’en occupe » vous attribue le travail et l’ouvre.',
};
const COLUMN_NOTES = ['Choisissez les colonnes affichées, dans le tableau comme sur les cartes. La tâche et ses commandes restent visibles.', 'Vos choix sont mémorisés pour votre compte, sur cet appareil.'];
const exceptionNotice = 'Permission modifiée : organisez un relais avec une personne habilitée.';
const linkButton = 'min-h-11 px-3 text-sm font-semibold underline';


/** A relay waits for my decision while the colleague stays responsible, so it
 * sits above the list. On a phone the band folds to one line until opened. */
function WorkHandoffs({ count, phone, children }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const title = `Relais à accepter · ${count}`;
  return <section id="work-handoffs" aria-label="Relais à accepter" className="work-handoffs">
    <h2 className="work-handoffs-title">{phone
      ? <button type="button" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(value => !value)}><Users size={18} aria-hidden="true" /><span>{title}</span><ChevronDown size={18} aria-hidden="true" className="work-handoffs-chevron" /></button>
      : <><Users size={18} aria-hidden="true" /><span>{title}</span></>}</h2>
    {(!phone || open) && <ul id={listId} className="work-handoff-list">{children}</ul>}
  </section>;
}

export default function PersonalWorkView() {
  const { auth, data = [], clients = [], envois = [], can, workActions = [], workPreferences = [], workLoading, workError, refreshWork, dataError, dataLoading, sbReady, retryLoad } = useApp();
  const [params, setParams] = useSearchParams();
  const location = useLocation(); const navigate = useNavigate(); const now = useMinuteNow();
  const [preferencesRequest, setPreferencesRequest] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [columnsAnchor, setColumnsAnchor] = useState(null);
  const filterRef = useRef(null);
  const displayButtonRef = useRef(null);
  const tabsRef = useRef(null);
  const searchId = useId();
  const { visibleKeys, setColumnVisible, resetColumns, textSize, setTextSize, layout: layoutPreference, setLayout } = useDossierTablePreferences(auth?.u?.id, 'work', WORK_TABLE_CHOICES);
  const { layout, phone } = useWorkLayout(layoutPreference);
  const columns = visibleWorkColumns(visibleKeys);
  const preference = workPreferences.find(item => item.staff_id === auth?.u?.id);
  const mission = params.get('mission') || '';
  const section = personalSection(params.get('section'));
  const search = params.get('q') || '';
  const view = useMemo(() => buildPersonalWork({ actions: workActions, dossiers: data, clients, userId: auth?.u?.id, preference, can, mission, search, now }), [workActions, data, clients, auth?.u?.id, preference, can, mission, search, now]);
  const unfiltered = useMemo(() => buildPersonalWork({ actions: workActions, dossiers: data, clients, userId: auth?.u?.id, preference, can, now }), [workActions, data, clients, auth?.u?.id, preference, can, now]);
  const rows = view.sections[section]; const totals = workTotals(rows, data); const returnTo = location.pathname + location.search;
  const label = section === 'pool' ? 'À prendre' : PERSONAL_SECTIONS.find(item => item.id === section).label;
  // The dossiers or the tasks never loaded: an empty list would read as « no
  // work ». A failed refresh keeps the loaded tasks, under the shell's banner.
  const dataLoad = staffDataState({ sbReady, dataLoading, dataError, hasData: holdsStaffData({ data, clients, envois }) });
  const dataFailed = dataLoad.state === 'failed';
  const loadFailed = dataFailed || (Boolean(workError) && !workActions.length);
  const loadReason = dataFailed ? dataLoad.reason : String(workError?.message || workError);
  const retryLoading = async () => {
    if (retrying) return;
    setRetrying(true);
    try { await (dataFailed ? retryLoad?.() : refreshWork()); }
    catch { /* The reason stays on screen. */ }
    finally { setRetrying(false); }
  };
  const initialLoading = !loadFailed && workLoading && !workActions.length;
  const refreshing = workLoading && !initialLoading;
  const displayName = staffDisplayName(auth?.u);
  const setFilter = (key, value) => setParams(old => { const next = new URLSearchParams(old); if (value || key === 'mission') next.set(key, value); else next.delete(key); return next; }, { replace: true });
  // The text as typed or scanned; the address follows it (hooks/useParamInput.js).
  const [searchText, changeSearch] = useParamInput(search, value => setFilter('q', value));
  const clearFilters = () => setParams(old => { const next = new URLSearchParams(old); next.set('mission', ''); next.delete('q'); return next; }, { replace: true });
  const showSection = nextSection => setParams(old => { const next = new URLSearchParams(old); next.set('mission', ''); next.delete('q'); next.set('section', nextSection); return next; }, { replace: true });
  const globalSearchUrl = `/colis${search.trim() ? `?${new URLSearchParams({ q: search.trim() })}` : ''}`;
  const rowProps = action => { const dossier = view.dossierById.get(action.colis_id); return { action, dossier, client: view.clientById.get(dossier?.clientId), returnTo, now }; };
  // One layout for every list of the page: the table, or cards in a grid.
  const renderList = (actions, caption, notice) => layout === 'table'
    ? <WorkActionTable caption={caption} actions={actions} dossierById={view.dossierById} clientById={view.clientById} columns={columns} returnTo={returnTo} now={now} notice={notice} />
    : <div className="work-cards">{actions.map(action => <WorkActionRow key={action.id} variant="card" {...rowProps(action)} notice={notice} visibleKeys={visibleKeys} />)}</div>;
  const openPreferences = () => { setPreferencesRequest(value => value + 1); document.getElementById('work-preferences')?.scrollIntoView({ block: 'start' }); };
  const preferencesRequested = params.get('preferences') === '1';
  useEffect(() => {
    if (!preferencesRequested) return;
    setPreferencesRequest(value => value + 1);
    document.getElementById('work-preferences')?.scrollIntoView({ block: 'start' });
  }, [preferencesRequested]);
  // The filter popover closes on Escape or a press outside it. The <details>
  // stays uncontrolled: the browser opens it, so the DOM closes it too.
  useEffect(() => {
    if (!filterOpen) return undefined;
    const close = event => { if (filterRef.current && !filterRef.current.contains(event.target)) filterRef.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [filterOpen]);
  // On narrow screens the tabs scroll inside their strip: keep the chosen one visible.
  useLayoutEffect(() => {
    const strip = tabsRef.current;
    const tab = strip?.querySelector('[aria-pressed="true"]');
    if (!tab || strip.scrollWidth <= strip.clientWidth) return;
    if (tab.offsetLeft - 16 < strip.scrollLeft) strip.scrollLeft = Math.max(0, tab.offsetLeft - 16);
    else if (tab.offsetLeft + tab.offsetWidth + 16 > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = tab.offsetLeft + tab.offsetWidth + 16 - strip.clientWidth;
  }, [section, initialLoading]);
  const available = staffAvailable(preference, now);
  const hasFilters = Boolean(search || mission);
  const allowedMissions = availableMissions(can);
  const poolPreferencesActive = view.missions.length < allowedMissions.length;
  // A failed refresh after a successful load: the last list stays, never read as « no work ».
  const empty = workError
    ? { title: 'Vos tâches n’ont pas pu être actualisées', text: 'Réessayez pour savoir quel travail est disponible.', retry: true }
    : section === 'pool' && !available
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

  // The staff shell owns the page's single <main>.
  return <div className="work-page space-y-4 px-4 pb-8 pt-4" data-density={preference?.density === 'compact' ? 'compact' : undefined} style={{ '--dossier-text-size': `${textSize}px` }}>
    <header className="work-header">
      <h1>Mon travail</h1>
      {loadFailed ? <p className="work-presence"><span className="work-presence-name">{displayName}</span></p>
        : <p className="work-presence"><span className="work-presence-dot" data-available={available ? 'true' : 'false'} aria-hidden="true" /><span className="work-presence-name">{displayName} · </span>{available ? 'Disponible' : 'Indisponibilité déclarée'}</p>}
      <div className="work-header-actions"><button type="button" onClick={() => navigate('/equipe')} className="dossier-toolbar-button"><Users size={18} aria-hidden="true" />Équipe</button>{!loadFailed && <button type="button" onClick={openPreferences} className="dossier-text-button">Ma disponibilité</button>}</div>
    </header>
    {!loadFailed && workError && rows.length > 0 && <div role="alert" className="work-refresh-error"><p>Actualisation des tâches impossible : {String(workError.message || workError).trim().replace(/[.\s]+$/, '')}. La liste affichée est la dernière chargée.</p><button type="button" disabled={retrying} onClick={retryLoading} className="dossier-text-button"><RefreshCw size={15} aria-hidden="true" className={retrying ? 'animate-spin' : undefined} />{retrying ? 'Nouvel essai…' : 'Réessayer'}</button></div>}
    {/* The dossiers or the tasks did not load: nothing on this page can be counted. */}
    {loadFailed ? <WorkLoadError title="Vos tâches n’ont pas pu être chargées" reason={loadReason} note="Vos tâches enregistrées sont conservées. La liste et ses compteurs s’afficheront dès que le chargement aura réussi." retrying={retrying} onRetry={retryLoading} /> : initialLoading ? <div role="status" className="space-y-3">
      <p className="text-sm text-slate-600">Chargement des tâches…</p>
      {layout === 'table'
        ? <div className="work-skeleton-table" aria-hidden="true">{[0, 1, 2, 3, 4].map(id => <span key={id} className="animate-pulse" />)}</div>
        : <div className="work-cards" aria-hidden="true">{[0, 1, 2].map(id => <span key={id} className="work-skeleton-card animate-pulse" />)}</div>}
    </div> : <>
      <div ref={tabsRef} className="dossier-view-tabs work-tabs">
        <nav aria-label="Mes tâches" className="contents">{PERSONAL_SECTIONS.map(item => <button key={item.id} type="button" aria-label={`${item.label} ${view.counts[item.id]}`} aria-pressed={section === item.id} onClick={() => setFilter('section', item.id)} className="dossier-view-tab">{item.label}<span className="work-tab-count">{view.counts[item.id]}</span></button>)}</nav>
        <button type="button" aria-label={`À prendre ${view.counts.pool}`} aria-pressed={section === 'pool'} onClick={() => setFilter('section', 'pool')} className="dossier-view-tab">À prendre<span className="work-tab-count">{view.counts.pool}</span></button>
      </div>
      <div className="dossier-toolbar work-toolbar">
        <div className="dossier-toolbar-search relative">
          <label htmlFor={searchId} className="sr-only">Rechercher dans mes tâches</label>
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input id={searchId} type="search" value={searchText} onChange={event => changeSearch(event.target.value)} placeholder="Client, EXP, tâche…" className="min-h-11 w-full pl-10 pr-3 text-sm" />
        </div>
        <details ref={filterRef} className="work-filter" onToggle={event => setFilterOpen(event.currentTarget.open)}
          onKeyDown={event => { if (event.key !== 'Escape' || !event.currentTarget.open) return; event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }}>
          <summary className="dossier-toolbar-button work-toolbar-icon"><ListFilter size={18} aria-hidden="true" /><span className="work-toolbar-label">Filtrer</span>{mission && <><span className="sr-only"> · 1 actif</span><span className="dossier-toolbar-badge" aria-hidden="true">1</span></>}</summary>
          <div className="dossier-filters-panel work-filter-popover">
            <label className="dossier-filters-field">Mission<select aria-label="Mission" value={mission} onChange={event => setFilter('mission', event.target.value)}><option value="">Tous les types de travail</option>{allowedMissions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          </div>
        </details>
        <button ref={displayButtonRef} type="button" className="dossier-toolbar-button work-toolbar-icon" aria-label="Affichage" aria-haspopup="dialog" aria-expanded={displayOpen} aria-controls={displayOpen ? 'work-display-dialog' : undefined}
          onClick={() => { setColumnsAnchor(null); setDisplayOpen(value => !value); }}>
          <Settings2 size={18} aria-hidden="true" /><span className="work-toolbar-label">Affichage</span>
        </button>
      </div>
      {displayOpen && <WorkDisplayOptions anchor={displayButtonRef.current} onClose={() => setDisplayOpen(false)}
        visibleColumnCount={visibleKeys.length} columnCount={WORK_TABLE_CHOICES.length}
        onOpenColumns={() => { setDisplayOpen(false); setColumnsAnchor(displayButtonRef.current); }}
        layout={layoutPreference} onLayoutChange={setLayout} textSize={textSize} onTextSizeChange={setTextSize} textSizeKey={auth?.u?.id} preference={preference} />}
      {columnsAnchor && <DossierColumnVisibility columns={WORK_TABLE_CHOICES} visibleKeys={visibleKeys} required="task" notes={COLUMN_NOTES} anchor={columnsAnchor} onChange={setColumnVisible} onReset={resetColumns} onClose={() => setColumnsAnchor(null)} />}
      {search && <Link to={globalSearchUrl} className="work-inline-link">Chercher aussi dans tous les dossiers<ArrowRight size={15} aria-hidden="true" /></Link>}
      {hasFilters && <div className="work-notice"><p>Filtre actif{mission ? ` · ${allowedMissions.find(item => item.id === mission)?.label || 'Mission sélectionnée'}` : ''}{view.outsideFilterOwned.length > 0 ? ` · ${view.outsideFilterOwned.length} de vos tâches hors de cette sélection` : ''}</p><button onClick={clearFilters} className="dossier-text-button">Tout afficher</button></div>}
      {view.handoffs.length > 0 && <WorkHandoffs count={view.handoffs.length} phone={phone}>{view.handoffs.map(action => <WorkActionRow key={action.id} variant="handoff" {...rowProps(action)} />)}</WorkHandoffs>}
      {view.outsideFilterDue.length > 0 && <section aria-label="Urgences hors filtre" className="work-region"><div className="work-region-heading"><h2>Urgences hors de ce filtre · {view.outsideFilterDue.length}</h2><button onClick={clearFilters} className="dossier-text-button">Voir mes tâches sans filtre</button></div>{renderList(view.outsideFilterDue, 'Urgences hors de ce filtre')}</section>}
      {section === 'pool' && poolPreferencesActive && <div className="work-notice"><span>Nouvelles tâches proposées : {allowedMissions.filter(item => view.missions.includes(item.id)).map(item => item.label).join(', ') || 'aucune mission sélectionnée'}</span><button onClick={openPreferences} className="dossier-text-button">Modifier les missions affichées</button></div>}
      {view.exceptions.length > 0 && <nav aria-label="Coordination de mes tâches"><a href="#work-exceptions" className="work-inline-link">Tâches à réorganiser ({view.exceptions.length})</a></nav>}
      {(rows.length > 0 || refreshing) && <div className="work-count">
        {rows.length > 0 && <><p role="status"><strong>{plural(totals.actions, 'tâche')}</strong> · {plural(totals.dossiers, 'dossier')}</p><p className="work-count-help">{SECTION_HELP[section]}</p></>}
        {refreshing && <p role="status" className="work-refresh"><Loader2 size={14} aria-hidden="true" className="animate-spin" />Actualisation des tâches…</p>}
      </div>}
      {rows.length ? <section aria-label={label}>{renderList(rows, label)}</section> : <section role={empty.retry ? 'alert' : undefined} aria-label="Pourquoi la liste est vide" className="work-empty"><h2 className="font-semibold text-slate-900">{empty.title}</h2><p className="mt-2 text-sm text-slate-600">{empty.text}</p><div className="mt-3 flex flex-wrap items-center justify-center gap-3">
        {empty.retry && <button disabled={retrying} onClick={retryLoading} className={PRIMARY_COMMAND}>{retrying ? 'Nouvel essai…' : 'Recharger les tâches'}</button>}
        {empty.clear && <button onClick={clearFilters} className={PRIMARY_COMMAND}>Effacer les filtres</button>}
        {empty.preferences && <button onClick={openPreferences} className={PRIMARY_COMMAND}>{empty.preferences}</button>}
        {!hasFilters && !empty.preferences && !empty.retry && section !== 'pool' && unfiltered.counts.pool > 0 && <button onClick={() => showSection('pool')} className={PRIMARY_COMMAND}>Voir les tâches à prendre</button>}
        {section !== 'now' && unfiltered.counts.now > 0 && <button onClick={() => showSection('now')} className={linkButton}>Voir mes tâches à faire</button>}
        {section !== 'waiting' && unfiltered.counts.waiting > 0 && <button onClick={() => showSection('waiting')} className={linkButton}>Voir mes tâches en attente</button>}
        {section === 'pool' && !empty.retry && <Link to="/equipe?queue=waiting" className={`inline-flex items-center ${linkButton}`}>Voir les attentes de l’équipe</Link>}
        <Link to={globalSearchUrl} className={`inline-flex items-center ${linkButton}`}>{search ? 'Chercher ce dossier dans toute l’équipe' : 'Voir les dossiers de l’équipe'}</Link>
      </div></section>}
      {view.exceptions.length > 0 && <section id="work-exceptions" aria-label="Tâches hors missions ou permissions" className="work-region"><div className="work-region-heading"><h2>Tâches à réorganiser · {view.exceptions.length}</h2><Link to={`/equipe?owner=${auth.u.id}`} className="dossier-text-button work-text-link">Organiser un relais</Link></div>{renderList(view.exceptions, 'Tâches à réorganiser', exceptionNotice)}</section>}
    </>}
    {/* Preferences are loaded with the tasks: never offer to save them from an unknown state. */}
    {!loadFailed && <section id="work-preferences" className="work-preferences-section scroll-mt-4"><WorkPreferences preference={preference} openRequest={preferencesRequest} /></section>}
  </div>;
}
