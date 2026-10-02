import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Search, X, Package, Clock, CheckCircle, Check, CreditCard, Plane, AlertCircle } from 'lucide-react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, getDestByCP } from '../../constants';
import { fuzzy } from '../../utils';
const exportDossierTableExcel = async (...args) => { const exports = await import('../../utils/exportExcel'); return exports.exportDossierTableExcel(...args); };
import PersonalWorkView from '../workspace/PersonalWorkView';
import { WORK_QUEUES, queueContext, matchesWorkQueue, priorityScore } from '../../domain/workQueues';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { findColisByReference, normalizeColisReference } from '../../lib/supabaseData';
import { buildDossierTableModel, defineDossierTableColumn, isDossierTableColumnSortable, sortDossierTableRows, dossierTableSortDirectionLabel } from '../../domain/dossierTable';
import { staffAvailable, sortWorkActions, workActionUrl } from '../../domain/personalWork';
import { TABLE_VIEWS, TABLE_COLUMNS, DossierTableHead, DossierTableRow, DossierTableCard } from './DossierTableRows';

// ── Pipeline cards (filters) ────────────────────────────────────────────────
const PIPELINE = [
  { key: 'all',         label: 'Tout',            icon: Package,     color: 'var(--brand-text)',  filter: (c) => c.statut !== 'annule' },
  { key: 'reception',   label: 'Réception',       icon: Package,     color: '#F59E0B',   filter: (c) => ['receptionne', 'mesure'].includes(c.statut) },
  { key: 'feuvert',     label: 'Accord attendu',   icon: Clock,       color: '#F97316',   filter: (c) => c.statut === 'attente_feu_vert' },
  { key: 'feuvert_ok',  label: 'Optimisation et factures',     icon: CheckCircle, color: '#65A30D',   filter: (c) => ['autorise', 'en_preparation'].includes(c.statut) },
  { key: 'paiement',    label: 'Att. paiement',   icon: CreditCard,  color: '#D97706',   filter: (c) => ['devis_envoye', 'attente_paiement'].includes(c.statut) },
  { key: 'expedition',  label: 'Expédition',      icon: Plane,       color: '#0891B2',   filter: (c) => ['paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison'].includes(c.statut) },
  { key: 'done',        label: 'Livrés',          icon: Check,       color: '#16A34A',   filter: (c) => c.statut === 'livre' },
];

const usefulDossierDate = c => (c.nextActionSource === 'manual' && c.nextActionAt ? c.nextActionAt : c.statutUpdatedAt || c.dateReception || c.createdAt) || '';
const defaultDateColumn = defineDossierTableColumn({ key: 'date', label: 'Activité du dossier', sort: { type: 'date', value: ({ dossier }) => usefulDossierDate(dossier) } });

// ── Default sort options ────────────────────────────────────────────────────
const SORT_OPTIONS = [
  { key: 'priority', label: 'Priorité (échéance → travail commencé → ancienneté)' },
  { key: 'date_desc', label: 'Plus récent d\'abord' },
  { key: 'date_asc', label: 'Plus ancien d\'abord (FIFO)' },
  { key: 'total_desc', label: 'Montant décroissant' },
  { key: 'total_asc', label: 'Montant croissant' },
  { key: 'ref_asc', label: 'Référence (A → Z)' },
];
const LS_SORT_KEY = 'expedile_default_sort_v2:';
function loadDefaultSort(userId) {
  try {
    const saved = localStorage.getItem(LS_SORT_KEY + userId);
    if (saved && SORT_OPTIONS.some((o) => o.key === saved)) return saved;
  } catch {}
  return 'priority';
}

// ── Group header row (colspan toute la largeur) ─────────────────────────────
function GroupHeaderRow({ icon: Icon, color, label, extraLabel, count, allChecked, onToggleAll, colspan, collapsed, onToggle }) {
  return (
    <tr className="border-b border-gray-200" style={{ background: 'var(--bg-surface)' }}>
      <td colSpan={colspan} className="px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <input aria-label={`Sélectionner le groupe ${label}`} type="checkbox"
              checked={allChecked}
              onChange={(e) => { e.stopPropagation(); onToggleAll(); }}
              onClick={(e) => e.stopPropagation()}
              className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer" />
            {Icon && <Icon size={13} style={{ color }} />}
            <button onClick={onToggle} aria-expanded={!collapsed} className="min-h-11 text-sm font-bold" style={{ color: 'var(--brand-text)' }}>{collapsed ? '▸' : '▾'} {label}</button>
            {extraLabel && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{extraLabel}</span>}
          </div>
          <span className="text-[10px] font-bold text-gray-400">{count} dossier(s)</span>
        </div>
      </td>
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD PAGE — exported for / route
// ════════════════════════════════════════════════════════════════════════════
export function DashboardPage() { return <PersonalWorkView />; }

// ════════════════════════════════════════════════════════════════════════════
// COLIS PAGE — one row per shipment; task ownership; full-page dossier
// ════════════════════════════════════════════════════════════════════════════
export default function StaffColisPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.pathname + location.search;
  const { data, clients, getClient, envois, changerStatut, flash, can, auth, loadArchives, archivesLoaded, categories, tarifs, settings, teamUsers = [], workActions = [], workPreferences = [], workLoading, workError, refreshWork } = useApp();
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [searchParams, setSearchParams] = useSearchParams();
  const workFilter = searchParams.get('work');
  const clientFilter = searchParams.get('client');
  const envoiFilter = searchParams.get('envoi');
  const [bulkBusy, setBulkBusy] = useState(false);

  const now = useMinuteNow();
  const context = useMemo(() => queueContext({ clients, getClient, categories, tarifs, settings, now }), [clients, getClient, categories, tarifs, settings, now]);
  const setParam = useCallback((key, value) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    if (value === null || value === '' || value === false) next.delete(key); else next.set(key, String(value));
    return next;
  }, { replace: true }), [setSearchParams]);
  const activeTab = PIPELINE.some((phase) => phase.key === searchParams.get('tab')) ? searchParams.get('tab') : 'all';
  const setActiveTab = (value) => setParam('tab', value === 'all' ? null : value);
  const activeDest = searchParams.get('dest');
  const setActiveDest = (value) => setParam('dest', value);
  const search = searchParams.get('q') || '';
  const setSearch = (value) => setParam('q', value);
  const exactReference = normalizeColisReference(search);
  const [referenceLookup, setReferenceLookup] = useState({ reference: '', status: 'idle', row: null, error: '' });
  const [referenceAttempt, setReferenceAttempt] = useState(0);
  const pendingReferenceOpen = useRef(null);
  useEffect(() => {
    if (!exactReference) {
      setReferenceLookup({ reference: '', status: 'idle', row: null, error: '' });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setReferenceLookup({ reference: exactReference, status: 'loading', row: null, error: '' });
    const timer = setTimeout(async () => {
      try {
        const row = await findColisByReference(exactReference, { signal: controller.signal });
        if (active) setReferenceLookup({ reference: exactReference, status: row ? 'found' : 'missing', row, error: '' });
      } catch (error) {
        if (active) setReferenceLookup({ reference: exactReference, status: 'error', row: null, error: error.message || 'Connexion au serveur indisponible.' });
      }
    }, 400);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [exactReference, referenceAttempt, auth?.u?.id]);
  const lookup = referenceLookup.reference === exactReference ? referenceLookup : { status: 'loading' };
  useEffect(() => {
    const pending = pendingReferenceOpen.current;
    if (!pending) return;
    if (pending.query !== search || ['error', 'missing'].includes(lookup.status)) {
      pendingReferenceOpen.current = null;
      return;
    }
    if (lookup.status === 'found') {
      pendingReferenceOpen.current = null;
      navigate(`/colis/${encodeURIComponent(lookup.row.id)}?${new URLSearchParams({ returnTo })}`);
    }
  }, [search, lookup.status, lookup.row?.id, navigate, returnTo]);
  const ownerFilter = searchParams.get('owner') || '';
  const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  const showArchive = searchParams.get('archive') === '1';
  const setShowArchive = (value) => setParam('archive', value ? '1' : null);
  const [archivesBusy, setArchivesBusy] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const canSeePayments = ['perm_finances_voir_total', 'perm_colis_calculer_devis', 'perm_colis_envoyer_devis', 'perm_colis_confirmer_paiement'].some(permission => can(permission));
  const tableRequested = TABLE_VIEWS.some(view => view.key === searchParams.get('table')) ? searchParams.get('table') : 'daily';
  const tableView = tableRequested === 'payments' && !canSeePayments ? 'daily' : tableRequested;
  const sortableColumns = TABLE_COLUMNS[tableView].filter(isDossierTableColumnSortable);
  // Keep another view's sort in the URL, but never sort on invisible or
  // inaccessible data. Returning to that view restores its selected column.
  const sortColumn = sortableColumns.find(column => column.key === searchParams.get('sort'));
  const sortCol = sortColumn?.key || null;
  const sortOptions = SORT_OPTIONS.filter(option => canSeePayments || !option.key.startsWith('total_'));
  const canExportView = can('perm_export_colis') && (tableView !== 'payments' || can('perm_finances_exporter'));
  const taskScope = ['mine', 'pool'].includes(searchParams.get('tasks')) ? searchParams.get('tasks') : 'all';
  const available = staffAvailable(workPreferences.find(item => item.staff_id === auth?.u?.id), now);
  const workReady = !workError && !(workLoading && !workActions.length);
  const actionsByDossier = useMemo(() => {
    const map = new Map();
    for (const action of workActions) {
      if (!map.has(action.colis_id)) map.set(action.colis_id, []);
      map.get(action.colis_id).push(action);
    }
    return map;
  }, [workActions]);
  const models = useMemo(() => new Map(data.map(dossier => [dossier.id, buildDossierTableModel(dossier, {
    actions: actionsByDossier.get(dossier.id) || [], client: getClient(dossier.clientId), me: auth?.u?.id, can, teamUsers, envois,
    scope: taskScope, view: tableView, available, now, workReady, assigneeFilter: ownerFilter,
  })])), [data, getClient, actionsByDossier, auth?.u?.id, can, teamUsers, envois, taskScope, tableView, available, now, workReady, ownerFilter]);
  const viewMode = ['envoi', 'statut'].includes(searchParams.get('view')) ? searchParams.get('view') : 'priority';
  const setViewMode = (value) => setParam('view', value === 'priority' ? null : value);
  const listScrollRef = useRef(null);
  const [collapsedGroups, setCollapsedGroups] = usePersistentDraft('dossiers:groups', []);
  const [exportError, setExportError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const exportRows = async rows => {
    if (!canExportView || exportBusy) return;
    setExportError(''); setExportBusy(true);
    try { await exportDossierTableExcel(rows, clients, models, tableView, TABLE_COLUMNS[tableView]); }
    catch (error) { setExportError(error.message || 'Export impossible. Réessayez.'); }
    finally { setExportBusy(false); }
  };
  const listMemoryParams = new URLSearchParams(location.search);
  listMemoryParams.delete('dossier'); listMemoryParams.sort();
  const listMemoryKey = `expedile:list:${auth?.u?.id}:${location.pathname}:${listMemoryParams.toString()}:list`;
  useEffect(() => {
    const element = listScrollRef.current; if (!element) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(listMemoryKey));
      element.scrollTop = typeof saved === 'number' ? saved : saved?.top || 0;
      element.scrollLeft = saved?.left || 0;
    } catch { /* optional preference */ }
    const save = () => { try { sessionStorage.setItem(listMemoryKey, JSON.stringify({ top: element.scrollTop, left: element.scrollLeft })); } catch { /* optional preference */ } };
    element.addEventListener('scroll', save, { passive: true });
    return () => { element.removeEventListener('scroll', save); };
  }, [listMemoryKey]);
  const [defaultSort, setDefaultSort] = useState(() => loadDefaultSort(auth?.u?.id));
  const defaultSortKey = canSeePayments || !defaultSort.startsWith('total_') ? defaultSort : 'priority';
  const activeFilters = [
    taskScope !== 'all' && { key: 'tasks', label: taskScope === 'mine' ? 'Mes tâches' : 'À prendre' },
    showArchive && { key: 'archive', label: 'Archives incluses' },
    workFilter && { key: 'work', label: `File : ${WORK_QUEUES.find(item => item.key === workFilter)?.label || 'Sélectionnée'}` },
    clientFilter && { key: 'client', label: `Client : ${getClient(clientFilter)?.nom || 'Sélectionné'}` },
    envoiFilter && { key: 'envoi', label: `Départ : ${envois.find(item => item.id === envoiFilter)?.ref || 'Sélectionné'}` },
    ownerFilter && { key: 'owner', label: `Responsable de tâche : ${ownerFilter === 'mine' ? 'Moi' : ownerFilter === 'unassigned' ? 'Non attribué' : teamUsers.find(item => item.authId === ownerFilter)?.nom || 'Sélectionné'}` },
    activeDest && { key: 'dest', label: `Destination : ${getDestByCP(activeDest + '00')?.nom || activeDest}` },
    activeTab !== 'all' && { key: 'tab', label: `Étape : ${PIPELINE.find(item => item.key === activeTab)?.label}` },
  ].filter(Boolean);
  const clearFilters = () => {
    setShowFilters(false);
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      ['work', 'client', 'envoi', 'owner', 'dest', 'tab', 'archive', 'dossier', 'tasks'].forEach(key => next.delete(key));
      return next;
    }, { replace: true });
  };
  const openReferenceDossier = () => {
    if (lookup.status === 'found') {
      pendingReferenceOpen.current = null;
      navigate(`/colis/${encodeURIComponent(lookup.row.id)}?${new URLSearchParams({ returnTo })}`);
    } else if (lookup.status === 'loading') pendingReferenceOpen.current = { query: search };
  };

  const changeDefaultSort = key => {
    if (!sortOptions.some(option => option.key === key)) return;
    setDefaultSort(key);
    try { localStorage.setItem(LS_SORT_KEY + auth?.u?.id, key); } catch { /* optional preference */ }
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('sort'); next.delete('dir'); return next; }, { replace: true });
  };

  useEffect(() => {
    if (!showArchive || archivesLoaded || archivesBusy) return;
    setArchivesBusy(true);
    loadArchives().catch((error) => { flash({ msg: error.message, type: 'error' }); setParam('archive', null); }).finally(() => setArchivesBusy(false));
  }, [showArchive, archivesLoaded, archivesBusy, loadArchives, flash, setParam]);

  const scope = useMemo(() => {
    let list = showArchive && !workFilter ? data : data.filter((c) => !c.archive);
    if (workFilter) list = list.filter((c) => matchesWorkQueue(c, workFilter, context));
    if (clientFilter) list = list.filter((c) => c.clientId === clientFilter);
    if (envoiFilter) list = list.filter((c) => c.envoi === envoiFilter);
    if (ownerFilter || taskScope !== 'all') list = list.filter(c => models.get(c.id)?.matchesScope);
    if (activeDest) list = list.filter((c) => getDestByCP(getClient(c.clientId)?.cp)?.code === activeDest);
    if (search.trim()) list = list.filter((c) => fuzzy(`${c.ref} ${c.desc || ''} ${getClient(c.clientId)?.nom || ''} ${c.casier || ''} ${c.trackings?.join(' ') || ''}`, exactReference || search));
    return list;
  }, [data, showArchive, workFilter, context, clientFilter, envoiFilter, ownerFilter, taskScope, models, activeDest, getClient, search, exactReference]);
  const searched = useMemo(() => {
    if (activeTab === 'all' && (workFilter === 'messages' || ownerFilter || taskScope !== 'all')) return scope;
    const phase = PIPELINE.find((item) => item.key === activeTab);
    return phase ? scope.filter(phase.filter) : scope;
  }, [scope, activeTab, workFilter, ownerFilter, taskScope]);

  // Sort
  const sorted = useMemo(() => {
    const sort = (column, direction) => sortDossierTableRows(searched, { column, direction, models, getClient, envois });
    if (sortColumn) return sort(sortColumn, sortDir);
    const arr = [...searched];
    switch (defaultSortKey) {
        case 'priority': {
          const ranked = new Map(sortWorkActions(searched.map(dossier => models.get(dossier.id)?.action).filter(Boolean), now).map((action, index) => [action.colis_id, index]));
          arr.sort((a, b) => {
            if (ranked.has(a.id) || ranked.has(b.id)) return (ranked.get(a.id) ?? Infinity) - (ranked.get(b.id) ?? Infinity);
            const clA = getClient(a.clientId);
            const clB = getClient(b.clientId);
            return priorityScore(b, clB, now) - priorityScore(a, clA, now);
          });
          break;
        }
        case 'date_desc':
          return sort(defaultDateColumn, 'desc');
        case 'date_asc':
          return sort(defaultDateColumn, 'asc');
        case 'total_desc':
          return sort(TABLE_COLUMNS.payments.find(column => column.key === 'requested'), 'desc');
        case 'total_asc':
          return sort(TABLE_COLUMNS.payments.find(column => column.key === 'requested'), 'asc');
        case 'ref_asc':
          return sort(TABLE_COLUMNS[tableView].find(column => column.key === 'ref'), 'asc');
    }
    return arr;
  }, [searched, sortColumn, sortDir, getClient, defaultSortKey, now, models, envois, tableView]);

  // Hidden rows must never remain part of a bulk action after filtering.
  useEffect(() => {
    const visible = new Set(sorted.map(dossier => dossier.id));
    setSelectedIds(previous => {
      const next = new Set([...previous].filter(id => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [sorted]);

  // Grouped by envoi (for envoi view)
  const groupedByEnvoi = useMemo(() => {
    const groups = {};
    const noEnvoi = [];
    sorted.forEach((c) => {
      if (c.envoi) {
        const e = envois.find((x) => x.id === c.envoi);
        const key = c.envoi;
        if (!groups[key]) groups[key] = { envoi: e, colis: [] };
        groups[key].colis.push(c);
      } else {
        noEnvoi.push(c);
      }
    });
    // Sort groups by date
    const sortedGroups = Object.values(groups).sort((a, b) => {
      if (!a.envoi?.date || !b.envoi?.date) return 0;
      return a.envoi.date.localeCompare(b.envoi.date);
    });
    if (noEnvoi.length > 0) sortedGroups.push({ envoi: null, colis: noEnvoi });
    return sortedGroups;
  }, [sorted, envois]);

  // Grouped by statut phase (for statut view)
  const STATUT_GROUPS = [
    { label: 'Réception', statuts: ['receptionne', 'mesure'], color: '#F59E0B', icon: Package },
    { label: 'Accord attendu', statuts: ['attente_feu_vert'], color: '#F97316', icon: Clock },
    { label: 'Optimisation et factures', statuts: ['autorise', 'en_preparation'], color: '#65A30D', icon: CheckCircle },
    { label: 'Devis / Paiement', statuts: ['devis_envoye', 'attente_paiement'], color: '#D97706', icon: CreditCard },
    { label: 'Payé', statuts: ['paye'], color: '#10B981', icon: Check },
    { label: 'En expédition', statuts: ['expedie', 'transit', 'dedouanement', 'arrive', 'livraison'], color: '#0891B2', icon: Plane },
    { label: 'Livrés', statuts: ['livre'], color: '#16A34A', icon: Check },
    { label: 'À revoir', statuts: ['refuse_client', 'annule'], color: '#B85454', icon: AlertCircle },
  ];

  const groupedByStatut = useMemo(() => {
    return STATUT_GROUPS.map((g) => ({
      ...g,
      colis: sorted.filter((c) => g.statuts.includes(c.statut)),
    })).filter((g) => g.colis.length > 0);
  }, [sorted]);

  const tabCounts = useMemo(() => PIPELINE.reduce((all, phase) => {
    all[phase.key] = scope.filter((c) => phase.key === 'all' && (workFilter === 'messages' || ownerFilter || taskScope !== 'all') ? true : phase.filter(c)).length;
    return all;
  }, {}), [scope, workFilter, ownerFilter, taskScope]);
  const handleSort = (col, direction) => {
    if (!sortableColumns.some(column => column.key === col)) return;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('sort', col);
      next.set('dir', direction === 'asc' || direction === 'desc' ? direction : previous.get('sort') === col && previous.get('dir') !== 'desc' ? 'desc' : 'asc');
      return next;
    }, { replace: true });
  };

  const toggleSelection = id => setSelectedIds(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const openColis = (id, claimedAction) => {
    const dossier = data.find(item => item.id === id);
    const action = claimedAction || models.get(id)?.action;
    navigate(action ? workActionUrl(action, returnTo, dossier) : `/colis/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo })}`);
  };
  const selectedFromUrl = searchParams.get('dossier');
  useEffect(() => {
    if (!selectedFromUrl) return;
    const params = new URLSearchParams(location.search);
    params.delete('dossier');
    const back = `${location.pathname}${params.size ? `?${params}` : ''}`;
    navigate(`/colis/${encodeURIComponent(selectedFromUrl)}?${new URLSearchParams({ returnTo: back })}`, { replace: true });
  }, [selectedFromUrl, location.pathname, location.search, navigate]);



  return (
    <div className="dossier-list h-full min-w-0 flex flex-col">

      <header className="max-h-[55dvh] shrink-0 space-y-3 overflow-y-auto overscroll-contain border-b border-gray-200 bg-white px-4 py-4">
        <h1 className="text-xl font-bold text-gray-900">Dossiers d’expédition</h1>
        <div aria-label="Vues du tableau" className="flex flex-wrap gap-2">
          {TABLE_VIEWS.filter(view => view.key !== 'payments' || canSeePayments).map(view => <button key={view.key} aria-pressed={tableView === view.key}
            onClick={() => { setParam('table', view.key === 'daily' ? null : view.key); setSelectedIds(new Set()); }}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${tableView === view.key ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900' : 'border border-gray-200 text-gray-700'}`}>{view.label}</button>)}
        </div>
        {tableRequested === 'payments' && !canSeePayments && <p role="status" className="text-sm text-gray-700">Votre rôle ne permet pas de consulter les montants. Les dossiers restent accessibles dans Travail quotidien.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <div aria-label="Choisir les tâches affichées" className="flex flex-wrap gap-1">
            {[['all', 'Tous'], ['mine', 'Mes tâches'], ['pool', 'À prendre']].map(([value, label]) => <button key={value} aria-pressed={taskScope === value}
              onClick={() => { setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('owner'); if (value === 'all') next.delete('tasks'); else next.set('tasks', value); return next; }, { replace: true }); setSelectedIds(new Set()); }}
              className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${taskScope === value ? 'brand-bg-l brand-t ring-1 ring-inset ring-slate-300' : 'text-gray-600'}`}>{label}</button>)}
          </div>
          <div className="relative min-w-0 flex-1 basis-64">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher ou scanner un colis"
              onKeyDown={event => { if (event.key !== 'Enter') return; if (exactReference) openReferenceDossier(); else if (sorted.length === 1) openColis(sorted[0].id); }}
              placeholder="Référence, client, casier ou suivi…" className="min-h-11 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-10 text-sm text-gray-900" />
            {search && <button aria-label="Effacer la recherche" onClick={() => setSearch('')} className="absolute right-0 top-0 flex min-h-11 w-10 items-center justify-center text-gray-500"><X size={17} /></button>}
          </div>
          <button onClick={() => setShowFilters(value => !value)} aria-expanded={showFilters} className="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700">Filtres et options{activeFilters.length ? ` · ${activeFilters.length}` : ''}</button>
        </div>
        {showFilters && <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-3">
          <label className="max-w-full text-sm font-medium text-gray-700">File de travail<select aria-label="File de travail" value={workFilter || ''} onChange={e => { setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('tab'); next.delete('archive'); if (e.target.value) next.set('work', e.target.value); else next.delete('work'); return next; }, { replace: true }); }} className="mt-1 block min-h-11 max-w-full rounded-lg border border-gray-300 bg-white px-2"><option value="">Tous les dossiers</option>{WORK_QUEUES.map(queue => <option key={queue.key} value={queue.key}>{queue.label}</option>)}</select></label>
          <label className="text-sm font-medium text-gray-700">Étape<select aria-label="Étape" value={activeTab} onChange={event => setActiveTab(event.target.value)} className="mt-1 block min-h-11 rounded-lg border border-gray-300 bg-white px-2">{PIPELINE.map(phase => <option key={phase.key} value={phase.key}>{phase.label} ({tabCounts[phase.key] || 0})</option>)}</select></label>
          <label className="text-sm font-medium text-gray-700">Responsable de la tâche<select aria-label="Responsable de la tâche" value={ownerFilter} onChange={e => { setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('tasks'); if (e.target.value) next.set('owner', e.target.value); else next.delete('owner'); return next; }, { replace: true }); }} className="mt-1 block min-h-11 rounded-lg border border-gray-300 bg-white px-2"><option value="">Toute l’équipe</option><option value="mine">Moi</option><option value="unassigned">Non attribué</option>{teamUsers.filter(user => user.authId && user.actif !== false).map(user => <option key={user.authId} value={user.authId}>{[user.prenom, user.nom].filter(Boolean).join(' ')}</option>)}</select></label>
          <label className="text-sm font-medium text-gray-700">Destination<select aria-label="Destination" value={activeDest || ''} onChange={e => setActiveDest(e.target.value)} className="mt-1 block min-h-11 rounded-lg border border-gray-300 bg-white px-2"><option value="">Toutes les destinations</option>{['974', '976', '971', '972'].map(code => <option key={code} value={code}>{getDestByCP(code + '00').nom}</option>)}</select></label>
          <label className="text-sm font-medium text-gray-700">Regrouper<select aria-label="Regrouper les dossiers" value={viewMode} onChange={event => setViewMode(event.target.value)} className="mt-1 block min-h-11 rounded-lg border border-gray-300 bg-white px-2"><option value="priority">Aucun</option><option value="statut">Par étape</option><option value="envoi">Par départ</option></select></label>
          <label className="min-w-0 max-w-full text-sm font-medium text-gray-700">Trier<select aria-label="Tri par défaut" value={sortCol ? `column:${sortCol}:${sortDir}` : defaultSortKey}
            onChange={event => { const [kind, key, direction] = event.target.value.split(':'); if (kind === 'column') handleSort(key, direction); else changeDefaultSort(event.target.value); }}
            className="mt-1 block min-h-11 max-w-full rounded-lg border border-gray-300 bg-white px-2">
            <optgroup label="Ordres de travail">{sortOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</optgroup>
            <optgroup label="Colonnes du tableau">{sortableColumns.flatMap(column => ['asc', 'desc'].map(direction => <option key={`${column.key}:${direction}`} value={`column:${column.key}:${direction}`}>{column.label} · {dossierTableSortDirectionLabel(column, direction)}</option>))}</optgroup>
          </select></label>
          <button hidden={Boolean(workFilter)} disabled={archivesBusy} aria-pressed={showArchive} onClick={async () => { if (showArchive) { setShowArchive(false); return; } setArchivesBusy(true); try { if (!archivesLoaded) await loadArchives(); setShowArchive(true); } catch (error) { flash({ msg: 'Les archives n’ont pas pu être chargées. ' + error.message, type: 'error' }); } finally { setArchivesBusy(false); } }} className="min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700">{archivesBusy ? 'Chargement archives…' : showArchive ? 'Archives incluses' : 'Inclure les archives'}</button>
          {canExportView && <button disabled={exportBusy || !sorted.length} onClick={() => exportRows(sorted)} className="min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700">{exportBusy ? 'Export…' : `Exporter ${sorted.length} dossiers filtrés`}</button>}
          <button onClick={() => setShowFilters(false)} className="min-h-11 px-3 text-sm font-semibold brand-t underline">Fermer les filtres</button>
        </div>}
        {activeFilters.length > 0 && <div aria-label="Filtres actifs" className="flex flex-wrap items-center gap-2">
          {activeFilters.map(filter => <button key={filter.key} aria-label={`Retirer le filtre ${filter.label}`} onClick={() => setParam(filter.key, null)} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-gray-700"><span className="break-words">{filter.label}</span><X size={14} className="shrink-0" /></button>)}
          <button onClick={clearFilters} className="min-h-11 px-2 text-sm font-semibold brand-t underline">Retirer les filtres</button>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600"><span role="status">{sorted.length} dossier(s) affiché(s)</span><span className="hidden sm:inline">{tableView === 'daily' ? 'Une ligne par expédition · responsable de la tâche affichée' : tableView === 'payments' ? 'Montants demandés au client et règlements enregistrés' : 'Départs affectés et vérifications restantes'}</span></div>
        {sortColumn && <p role="status" className="text-sm text-gray-600">Tri : {sortColumn.label} · {dossierTableSortDirectionLabel(sortColumn, sortDir)}{viewMode !== 'priority' ? ' · dans chaque groupe' : ''}</p>}
        {workFilter === 'messages' && <button onClick={() => navigate('/conversations')} className="min-h-11 rounded-lg border px-3 text-sm font-semibold">Ouvrir les conversations et messages à rattacher</button>}
        {exactReference && <section aria-label="Recherche de référence dans tous les dossiers" className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-slate-800">Recherche de référence · tous les dossiers, archives incluses</p>
          {lookup.status === 'loading' && <p role="status" className="mt-1 text-slate-600">Vérification de {exactReference}…</p>}
          {lookup.status === 'error' && <div role="alert" className="mt-1 text-red-700"><p>Impossible de vérifier cette référence. {lookup.error}</p><button onClick={() => setReferenceAttempt(value => value + 1)} className="mt-1 min-h-11 font-semibold underline">Réessayer la recherche</button></div>}
          {lookup.status === 'missing' && <p role="status" className="mt-1 text-slate-600">Aucun dossier accessible ne porte la référence {exactReference}. Vérifiez le numéro saisi.</p>}
          {lookup.status === 'found' && <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div role="status" className="min-w-0"><p className="font-semibold text-slate-900">{lookup.row.ref} · {STATUTS[lookup.row.statut]?.label || lookup.row.statut}{lookup.row.archive ? ' · Archivé' : ''}</p><p className="mt-1 text-slate-600">{sorted.some(item => item.id === lookup.row.id) ? 'Dossier trouvé dans la liste actuelle.' : 'Dossier trouvé en dehors de la liste actuelle. Vos filtres sont conservés.'}</p></div>
            <button onClick={openReferenceDossier} className="min-h-11 rounded-xl px-4 py-2 text-sm font-semibold text-white brand-bg">Ouvrir le dossier</button>
          </div>}
        </section>}
      </header>

      {workError && <div role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Les tâches n’ont pas pu être actualisées. Les dossiers restent consultables.<button onClick={() => refreshWork().catch(() => {})} className="ml-3 min-h-11 font-semibold underline">Recharger les tâches</button></div>}
      {workLoading && <p role="status" className="shrink-0 px-4 py-2 text-sm text-gray-600">Chargement des tâches…</p>}
      {taskScope === 'pool' && !available && <p className="shrink-0 px-4 py-2 text-sm text-gray-700">Vous êtes indisponible. <button onClick={() => navigate('/?preferences=1')} className="min-h-11 font-semibold underline">Modifier ma disponibilité dans Mon travail</button></p>}
      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex-shrink-0 px-4 py-2 bg-blue-50 border-b border-blue-200 flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-blue-700">{selectedIds.size} dossier sélectionné{selectedIds.size > 1 ? 's' : ''}</span>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: 'En transit', statut: 'transit', color: '#0EA5E9' },
              { label: 'Dédouanement', statut: 'dedouanement', color: '#8B5CF6' },
              { label: 'Arrivé', statut: 'arrive', color: '#14B8A6' },
              { label: 'En livraison', statut: 'livraison', color: '#84CC16' },
              { label: 'Livré', statut: 'livre', color: '#16A34A' },
              { label: 'Expédié', statut: 'expedie', color: '#06B6D4' },
            ].map((action) => (
              <button
                key={action.statut}
                disabled={bulkBusy || !can(action.statut === 'expedie' ? 'perm_colis_expedier' : 'perm_colis_changer_statut_expedition')}
                onClick={async () => {
                  setBulkBusy(true);
                  const failed = []; let ok = 0;
                  for (const id of selectedIds) { try { const result = await changerStatut(id, action.statut); if (result === false) failed.push(id); else ok++; } catch { failed.push(id); } }
                  setSelectedIds(new Set(failed)); setBulkBusy(false);
                  flash({ msg: `${ok} dossier(s) mis à jour${failed.length ? ` · ${failed.length} non modifié(s), encore sélectionné(s)` : ''}`, type: failed.length ? 'warning' : 'success' });
                }}
                className="px-2 py-1 rounded-lg text-[10px] font-bold text-white transition-all active:scale-95"
                style={{ background: action.color }}
              >
                {action.label}
              </button>
            ))}
          </div>
          {/* Étiquettes + Export */}
          {can('perm_envois_etiquettes') && (
            <button
              onClick={() => {
                const ids = [...selectedIds];
                const colisForLabels = ids.map((id) => data.find((c) => c.id === id)).filter(Boolean);
                if (colisForLabels.length === 0) return;
                import('../../utils/exportEtiquettes').then((mod) => mod.printEtiquettes(colisForLabels, clients, getClient));
              }}
              className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 transition-all active:scale-95"
            >
              Étiquettes
            </button>
          )}
          {canExportView && (
            <button
              onClick={() => {
                const colisForExport = sorted.filter(dossier => selectedIds.has(dossier.id));
                exportRows(colisForExport);
              }}
              className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all active:scale-95"
            >
              Exporter les {selectedIds.size} sélectionnés
            </button>
          )}
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-[10px] text-blue-500 hover:text-blue-700 font-semibold">
            Désélectionner tout
          </button>
        </div>
      )}

      {exportError && <p role="alert" className="px-4 py-2 text-sm text-red-700">{exportError}</p>}
      {/* Main area: table + detail side by side */}
      <div className="flex-1 flex min-h-0">

        {/* Table (scrollable) */}
        <div ref={listScrollRef} role="region" aria-label="Tableau des dossiers" tabIndex={0} className="min-w-0 flex-1 overflow-y-auto overflow-x-auto">

          {(() => {
            const groups = viewMode === 'envoi' ? groupedByEnvoi : viewMode === 'statut' ? groupedByStatut : sorted.length ? [{ label: 'Ordre de traitement', icon: Package, color: BRAND.navy, colis: sorted }] : [];
            const displayCols = TABLE_COLUMNS[tableView];
            const totalColspan = displayCols.length + 1; // checkbox + N colonnes + chevron
            const allInGroupSelected = (g) => g.colis.length > 0 && g.colis.every((c) => selectedIds.has(c.id));
            const toggleGroup = (g) => {
              const ids = g.colis.map((c) => c.id);
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
                else ids.forEach((id) => next.add(id));
                return next;
              });
            };

            if (groups.length === 0) {
              if (exactReference) return null;
              return <div className="text-center text-sm text-gray-600 px-4 py-8"><p>{!workReady && taskScope !== 'all' ? 'La liste des tâches est indisponible pour le moment.' : taskScope === 'mine' ? 'Aucune tâche ne vous est attribuée dans cette sélection.' : taskScope === 'pool' ? 'Aucune tâche disponible dans cette sélection.' : 'Aucun dossier ne correspond à ces filtres.'}</p>{taskScope !== 'all' && <button onClick={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('tasks'); next.delete('owner'); return next; }, { replace: true })} className="mt-2 min-h-11 px-3 font-semibold brand-t underline">Voir tous les dossiers</button>}{activeFilters.length > 0 && <button onClick={clearFilters} className="min-h-11 mt-2 font-semibold brand-t underline">Retirer les filtres</button>}{search && <button onClick={() => setSearch('')} className="min-h-11 mt-2 px-3 font-semibold brand-t underline">Effacer la recherche</button>}</div>;
            }

            return <>
              <div className="xl:hidden divide-y divide-gray-200 px-4">{sorted.map(c => <DossierTableCard key={c.id} c={c} client={getClient(c.clientId)} model={models.get(c.id)} columns={displayCols} checked={selectedIds.has(c.id)} onCheck={() => toggleSelection(c.id)} onOpen={action => openColis(c.id, action)} returnTo={returnTo} />)}</div>
              <table aria-label="Dossiers d’expédition" data-view={tableView} className="dossier-data-table hidden w-full text-left xl:table">
                <thead>
                  <DossierTableHead
                    columns={displayCols}
                    allSelected={sorted.length > 0 && sorted.every((c) => selectedIds.has(c.id))}
                    onSelectAll={() => {
                      if (sorted.every((c) => selectedIds.has(c.id))) setSelectedIds(new Set());
                      else setSelectedIds(new Set(sorted.map((c) => c.id)));
                    }}
                    onSort={handleSort}
                    sortCol={sortCol}
                    sortDir={sortDir}
                  />
                </thead>
                <tbody>
                  {groups.map((group) => {
                    // Props header selon vue
                    let headerProps;
                    if (viewMode === 'envoi') {
                      const e = group.envoi;
                      const dateLabel = e?.date
                        ? new Date(e.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
                        : 'Sans envoi affecté';
                      headerProps = {
                        icon: Plane,
                        color: 'var(--brand-text)',
                        label: dateLabel,
                        extraLabel: e?.ref,
                        bgTint: `${BRAND.navy}06`,
                      };
                    } else {
                      headerProps = {
                        icon: group.icon,
                        color: group.color,
                        label: group.label,
                        bgTint: `${group.color}08`,
                      };
                    }
                    const groupKey = viewMode === 'envoi' ? (group.envoi?.id || 'none') : group.label;
                    return (
                      <React.Fragment key={groupKey}>
                        {viewMode !== 'priority' && <GroupHeaderRow
                          {...headerProps}
                          count={group.colis.length}
                          colspan={totalColspan}
                          allChecked={allInGroupSelected(group)}
                          collapsed={collapsedGroups.includes(groupKey)}
                          onToggle={() => setCollapsedGroups(previous => previous.includes(groupKey) ? previous.filter(key => key !== groupKey) : [...previous, groupKey])}
                          onToggleAll={() => toggleGroup(group)}
                        />}
                        {(viewMode === 'priority' || !collapsedGroups.includes(groupKey)) && group.colis.map(c => <DossierTableRow key={c.id} c={c} client={getClient(c.clientId)} model={models.get(c.id)} columns={displayCols} checked={selectedIds.has(c.id)} onCheck={() => toggleSelection(c.id)} onOpen={action => openColis(c.id, action)} returnTo={returnTo} />)}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </>;
          })()}
        </div>

      </div>
    </div>
  );
}
