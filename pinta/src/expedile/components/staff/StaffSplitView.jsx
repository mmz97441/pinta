import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { Search, X, Package, Clock, CheckCircle, Check, CreditCard, Plane, AlertCircle, AlertTriangle, CalendarX, CalendarPlus, ListFilter, Settings2, User, UserX, UserCheck, Inbox, SearchX, XCircle, Loader2 } from 'lucide-react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { STATUTS, getDestByCP } from '../../constants';
import { fuzzy } from '../../utils';
const exportDossierTableExcel = async (...args) => { const exports = await import('../../utils/exportExcel'); return exports.exportDossierTableExcel(...args); };
import PersonalWorkView from '../workspace/PersonalWorkView';
import { WORK_QUEUES, queueContext, matchesWorkQueue, priorityScore } from '../../domain/workQueues';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { findColisByReference, normalizeColisReference } from '../../lib/supabaseData';
import { buildDossierTableModel, defineDossierTableColumn, isDossierTableColumnSortable, sortDossierTableRows, dossierTableSortDirectionLabel, BULK_STATUS_STEPS, BULK_STATUS_REASONS, bulkStatusPlan, bulkRefusalReason, countLabel, countWord } from '../../domain/dossierTable';
import { staffDataState } from '../../domain/dataLoad';
import useMediaQuery from '../../hooks/useMediaQuery';
import { staffAvailable, sortWorkActions, workActionUrl } from '../../domain/personalWork';
import DossierColumnOptions, { ColumnDialog, DossierColumnVisibility } from './DossierColumnOptions';
import DossierHorizontalScroll from './DossierHorizontalScroll';
import DossierDisplayOptions from './DossierDisplayOptions';
import useDossierTablePreferences from '../../hooks/useDossierTablePreferences';
import { COLUMN_FILTER_PREFIX, readColumnFilters, filterDossierTableRows, columnFilterLabel, dossierColumnSuggestions, DOSSIER_GROUPINGS, resolveDossierGrouping } from '../../domain/dossierTablePreferences';
import { groupDossiersByDeparture, parisCalendarDay, NO_DEPARTURE_GROUP_KEY } from '../../domain/departureGroups';
import { dossierAlerts } from '../../domain/dossierAlerts';
import { dossierDestinationCode, dossierWishState } from '../../domain/departurePlanning';
import { consentQueueFilter } from '../../domain/consentQueue';
import { clientDisplayName, groupDossiersByClient } from '../../domain/clientGroups';
import { TABLE_VIEWS, TABLE_COLUMNS, DossierTableHead, DossierTableRow, DossierTableCard } from './DossierTableRows';
import { DossierGroupRow, DossierCardGroup } from './DossierGroupHeader';

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
// The orders of work only: an order the column list already offers (« Référence
// · de A à Z ») is not repeated here. A saved order no longer offered falls back
// to the priority.
const SORT_OPTIONS = [
  { key: 'priority', label: 'Priorité (échéance, puis travail commencé, puis ancienneté)' },
  { key: 'date_desc', label: 'Plus récent d’abord' },
  { key: 'date_asc', label: 'Plus ancien d’abord' },
  { key: 'total_desc', label: 'Montant décroissant' },
  { key: 'total_asc', label: 'Montant croissant' },
];
const LS_SORT_KEY = 'expedile_default_sort_v2:';
// « Accords clients » keeps its own default order: a choice made there never reorders the other tabs.
const sortScopeOf = view => view === 'accords' ? 'accords' : 'shared';
const sortStorageKey = (userId, scope) => `${LS_SORT_KEY}${userId}${scope === 'accords' ? ':accords' : ''}`;
function loadDefaultSort(userId, scope = 'shared') {
  try {
    const saved = localStorage.getItem(sortStorageKey(userId, scope));
    if (saved && SORT_OPTIONS.some((o) => o.key === saved)) return saved;
  } catch {}
  return 'priority';
}

// « Regrouper › Par étape »: the stage bands, in the order of the journey.
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

/** Phones, upright or on their side: the page header scrolls away with the
 * list (the search stays pinned), « Filtres » opens as a sheet and the
 * automatic layout shows cards. dossierTable.css follows `data-compact`. */
const COMPACT_QUERY = '(max-width: 767px), (max-height: 500px) and (max-width: 1023px)';

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
  const { data, clients, getClient, envois, upd, flash, can, auth, loadArchives, archivesLoaded, categories, tarifs, settings, teamUsers = [], workActions = [], workPreferences = [], workLoading, workError, refreshWork, dataError, dataLoading, sbReady, retryLoad } = useApp();
  const compact = useMediaQuery(COMPACT_QUERY);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [searchParams, setSearchParams] = useSearchParams();
  const workFilter = searchParams.get('work');
  const clientFilter = searchParams.get('client');
  const envoiFilter = searchParams.get('envoi');
  // One bulk status change at a time: confirmed, run, then its per-dossier result.
  const [bulkRun, setBulkRun] = useState(null);
  const bulkRunning = bulkRun?.phase === 'running';
  // Phone bulk bar: the select only prepares a status; « Appliquer » asks to confirm it.
  const [bulkChoice, setBulkChoice] = useState('');
  useEffect(() => { if (selectedIds.size === 0) setBulkChoice(''); }, [selectedIds.size]);

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
  const allColumns = useMemo(() => TABLE_COLUMNS[tableView].filter(column => !column.financial || canSeePayments), [tableView, canSeePayments]);
  const { widths, setWidth, resetWidths, visibleKeys, setColumnVisible, resetColumns, textSize, setTextSize, layout, setLayout, grouping: savedGrouping, setGrouping, noDeparture, setNoDeparture } = useDossierTablePreferences(auth?.u?.id, tableView, allColumns);
  // Column widths only exist for the table: cards never offer them.
  const tableShown = layout === 'table' || (layout === 'auto' && !compact);
  const visibleSignature = visibleKeys.join('|');
  const displayColumns = useMemo(() => allColumns.filter(column => visibleSignature.split('|').includes(column.key)), [allColumns, visibleSignature]);
  const sortableColumns = displayColumns.filter(isDossierTableColumnSortable);
  const [visibilityAnchor, setVisibilityAnchor] = useState(null);
  const [columnOptions, setColumnOptions] = useState(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const displayButtonRef = useRef(null);
  const filtersButtonRef = useRef(null);
  const columnFilters = useMemo(() => readColumnFilters(searchParams, displayColumns), [searchParams, displayColumns]);
  const setColumnFilter = (key, value) => { setParam(COLUMN_FILTER_PREFIX + key, value ? JSON.stringify(value) : null); };
  // Unknown, hidden or unauthorized columns never filter the visible view.
  useEffect(() => {
    const invalid = [...searchParams.keys()].filter(key => key.startsWith(COLUMN_FILTER_PREFIX) && !columnFilters[key.slice(COLUMN_FILTER_PREFIX.length)]);
    const requestedSort = searchParams.get('sort');
    const knownColumn = TABLE_COLUMNS[tableView].find(column => column.key === requestedSort);
    const forbiddenColumn = Object.values(TABLE_COLUMNS).flat().find(column => column.key === requestedSort && column.financial && !canSeePayments);
    if (requestedSort && (knownColumn || forbiddenColumn) && !displayColumns.some(column => column.key === requestedSort)) invalid.push('sort', 'dir');
    if (invalid.length) setSearchParams(previous => { const next = new URLSearchParams(previous); invalid.forEach(key => next.delete(key)); return next; }, { replace: true });
  }, [searchParams, columnFilters, setSearchParams, tableView, canSeePayments, displayColumns]);
  // Above the default text size the reference column grows with the text, so a
  // reference never breaks; the saved width (and the default sizes) stay as set.
  const refFloor = textSize > 12 ? Math.ceil(textSize * 7.5) + 16 : 0;
  const tableWidths = widths.ref >= refFloor ? widths : { ...widths, ref: refFloor };
  const tableStyle = { width: 40 + displayColumns.reduce((sum, column) => sum + tableWidths[column.key], 0), '--dossier-ref-width': `${tableWidths.ref}px`, '--dossier-client-width': `${tableWidths.client}px`, '--dossier-client-left': `${40 + tableWidths.ref}px` };

  // Keep another view's sort in the URL, but never sort on invisible or
  // inaccessible data. Returning to that view restores its selected column.
  const sortColumn = sortableColumns.find(column => column.key === searchParams.get('sort'));
  const sortCol = sortColumn?.key || null;
  // Amount orders apply only where the quote price is displayed: never in « Accords clients ».
  const amountSortable = canSeePayments && displayColumns.some(column => column.key === 'requested');
  const sortOptions = SORT_OPTIONS.filter(option => amountSortable || !option.key.startsWith('total_'));
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
  // « À vérifier », marked next to each reference; the dossier page details it.
  const alertsByDossier = useMemo(() => {
    const envoiById = new Map(envois.map(envoi => [envoi.id, envoi]));
    return new Map(data.map(dossier => [dossier.id, dossierAlerts({ dossier, client: getClient(dossier.clientId), envoi: envoiById.get(dossier.envoi), envois, today: now })]));
  }, [data, getClient, envois, now]);
  // Each tab remembers its own « Regrouper » on this device; an explicit `view`
  // in the URL wins, so a shared link keeps its grouping.
  const grouping = resolveDossierGrouping(searchParams.get('view'), savedGrouping, tableView);
  const changeGrouping = value => {
    if (!DOSSIER_GROUPINGS.includes(value)) return;
    setGrouping(value);
    setParam('view', value);
  };
  const pageRef = useRef(null);
  const listScrollRef = useRef(null);
  const [listWidth, setListWidth] = useState(0);
  useEffect(() => {
    const element = listScrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setListWidth(element.clientWidth));
    observer.observe(element);
    setListWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const pinBudget = Math.max(0, listWidth - 300);
  const pinnedActionWidth = visibleKeys.includes('action') ? widths.action : 0;
  const unpinRef = listWidth < 768 || tableWidths.ref + pinnedActionWidth + 40 > pinBudget;
  const unpinClient = unpinRef || tableWidths.ref + widths.client + pinnedActionWidth + 40 > pinBudget;
  const actionPinned = visibleKeys.includes('action') && listWidth >= 768;
  // Columns hidden under the pinned action (or past the right edge) are marked
  // by a shadow and a fade; DossierHorizontalScroll reports the scroll edges.
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const [collapsedGroups, setCollapsedGroups] = usePersistentDraft('dossiers:groups', []);
  const [exportError, setExportError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const exportRows = async rows => {
    if (!canExportView || exportBusy) return;
    setExportError(''); setExportBusy(true);
    const exportColumns = displayColumns.filter(column => !column.financial || can('perm_finances_exporter'));
    try { await exportDossierTableExcel(rows, clients, models, tableView, exportColumns); }
    catch (error) { setExportError(error.message || 'Export impossible. Réessayez.'); }
    finally { setExportBusy(false); }
  };
  const listMemoryParams = new URLSearchParams(location.search);
  listMemoryParams.delete('dossier'); listMemoryParams.sort();
  const listMemoryKey = `expedile:list:${auth?.u?.id}:${location.pathname}:${listMemoryParams.toString()}:list`;
  // The list remembers where it was: the rows' own scroll, and on a phone the
  // page itself (its header scrolls away with the rows).
  useEffect(() => {
    const element = listScrollRef.current, page = pageRef.current;
    if (!element || !page) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(listMemoryKey));
      element.scrollTop = typeof saved === 'number' ? saved : saved?.top || 0;
      element.scrollLeft = saved?.left || 0;
      page.scrollTop = saved?.page || 0;
    } catch { /* optional preference */ }
    const save = () => { try { sessionStorage.setItem(listMemoryKey, JSON.stringify({ top: element.scrollTop, left: element.scrollLeft, page: page.scrollTop })); } catch { /* optional preference */ } };
    element.addEventListener('scroll', save, { passive: true });
    page.addEventListener('scroll', save, { passive: true });
    return () => { element.removeEventListener('scroll', save); page.removeEventListener('scroll', save); };
  }, [listMemoryKey]);
  const sortScope = sortScopeOf(tableView);
  const [defaultSorts, setDefaultSorts] = useState(() => ({ shared: loadDefaultSort(auth?.u?.id), accords: loadDefaultSort(auth?.u?.id, 'accords') }));
  const defaultSort = defaultSorts[sortScope];
  const defaultSortKey = defaultSort.startsWith('total_') && !amountSortable ? 'priority' : defaultSort;
  // The task scope (Tous, Mes tâches, À prendre) shows in its own control: it is
  // not repeated as a filter chip nor counted on « Filtres ».
  const activeFilters = [
    showArchive && { key: 'archive', label: 'Archives incluses' },
    workFilter && { key: 'work', label: `File : ${WORK_QUEUES.find(item => item.key === workFilter)?.label || 'Sélectionnée'}` },
    clientFilter && { key: 'client', label: `Client : ${getClient(clientFilter)?.nom || 'Sélectionné'}` },
    envoiFilter && { key: 'envoi', label: `Départ : ${envois.find(item => item.id === envoiFilter)?.ref || 'Sélectionné'}` },
    ownerFilter && { key: 'owner', label: `Responsable de tâche : ${ownerFilter === 'mine' ? 'Moi' : ownerFilter === 'unassigned' ? 'Non attribué' : teamUsers.find(item => item.authId === ownerFilter)?.nom || 'Sélectionné'}` },
    activeDest && { key: 'dest', label: `Destination : ${getDestByCP(activeDest + '00')?.nom || activeDest}` },
    activeTab !== 'all' && { key: 'tab', label: `Étape : ${PIPELINE.find(item => item.key === activeTab)?.label}` },
    ...sortableColumns.filter(column => columnFilters[column.key]).map(column => ({ key: COLUMN_FILTER_PREFIX + column.key, label: columnFilterLabel(column, columnFilters[column.key]) })),
  ].filter(Boolean);
  const clearFilters = () => {
    setShowFilters(false);
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      ['work', 'client', 'envoi', 'owner', 'dest', 'tab', 'archive', 'dossier', ...[...next.keys()].filter(key => key.startsWith(COLUMN_FILTER_PREFIX))].forEach(key => next.delete(key));
      return next;
    }, { replace: true });
  };
  const showAllTasks = () => setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('tasks'); next.delete('owner'); return next; }, { replace: true });
  const openReferenceDossier = () => {
    if (lookup.status === 'found') {
      pendingReferenceOpen.current = null;
      navigate(`/colis/${encodeURIComponent(lookup.row.id)}?${new URLSearchParams({ returnTo })}`);
    } else if (lookup.status === 'loading') pendingReferenceOpen.current = { query: search };
  };

  const changeDefaultSort = key => {
    if (!sortOptions.some(option => option.key === key)) return;
    setDefaultSorts(previous => ({ ...previous, [sortScope]: key }));
    try { localStorage.setItem(sortStorageKey(auth?.u?.id, sortScope), key); } catch { /* optional preference */ }
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
  // « Accords clients » is the one view that lists only some dossiers: those
  // whose consent is to obtain. Stage counts, suggestions, export and the empty
  // state all follow it.
  const viewRows = useMemo(() => tableView === 'accords' ? consentQueueFilter(scope) : scope, [scope, tableView]);
  const phaseRows = useMemo(() => {
    if (activeTab === 'all' && (workFilter === 'messages' || ownerFilter || taskScope !== 'all')) return viewRows;
    const phase = PIPELINE.find((item) => item.key === activeTab);
    return phase ? viewRows.filter(phase.filter) : viewRows;
  }, [viewRows, activeTab, workFilter, ownerFilter, taskScope]);

  const searched = useMemo(() => filterDossierTableRows(phaseRows, { columns: displayColumns, filters: columnFilters, models, getClient, envois }), [phaseRows, displayColumns, columnFilters, models, getClient, envois]);

  const columnSuggestions = useMemo(() => dossierColumnSuggestions(phaseRows, displayColumns.find(column => column.key === columnOptions?.key), { models, getClient, envois }), [phaseRows, displayColumns, columnOptions, models, getClient, envois]);

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
          return sort(TABLE_COLUMNS[tableView].find(column => column.key === 'requested'), 'desc');
        case 'total_asc':
          return sort(TABLE_COLUMNS[tableView].find(column => column.key === 'requested'), 'asc');
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

  // Groups keep the sorted order inside each band. A departure group reads
  // « Départ du jeudi 15 octobre · Réunion », then its reference.
  const today = parisCalendarDay(now);
  const grouped = grouping !== 'none';
  // A desired day without a departure forms « Départ à créer du jeudi 20 novembre · Réunion »,
  // or « Départ souhaité le … » once that day has its departure or has passed.
  const groups = useMemo(() => {
    if (grouping === 'envoi') return groupDossiersByDeparture(sorted, envois, { today, noDeparture,
      destinationOf: dossier => dossierDestinationCode(dossier, getClient(dossier.clientId)),
      wishStateOf: dossier => dossierWishState(dossier, getClient(dossier.clientId), envois, now)?.state }).map(group => {
      const unassigned = group.key === NO_DEPARTURE_GROUP_KEY;
      return { key: group.key, title: group.destinationLabel ? `${group.label} · ${group.destinationLabel}` : group.label, ref: group.ref,
        icon: unassigned ? CalendarX : group.wish ? CalendarPlus : Plane, color: unassigned ? 'var(--text-muted)' : 'var(--brand-text)', dossiers: group.dossiers };
    });
    if (grouping === 'statut') return STATUT_GROUPS.map(group => ({ key: group.label, title: group.label, icon: group.icon, color: group.color,
      dossiers: sorted.filter(dossier => group.statuts.includes(dossier.statut)) })).filter(group => group.dossiers.length > 0);
    // « Payet Flavie », as its rows read, then « 3 dossiers »: the client whose oldest dossier
    // arrived first leads; two clients with the same name are told apart by their reference.
    if (grouping === 'client') return groupDossiersByClient(sorted, { getClient, receivedAt: dossier => models.get(dossier.id)?.reception?.firstReceivedAt }).map(group => ({
      key: group.key, title: group.title, ref: group.ref, icon: group.client ? User : UserX, color: group.client ? 'var(--brand-text)' : 'var(--text-muted)', dossiers: group.dossiers }));
    return sorted.length ? [{ key: 'all', dossiers: sorted }] : [];
  }, [grouping, sorted, envois, today, now, noDeparture, getClient, models]);
  // Exports follow the order on screen, group by group.
  const displayedRows = useMemo(() => grouped ? groups.flatMap(group => group.dossiers) : sorted, [grouped, groups, sorted]);

  const tabCounts = useMemo(() => PIPELINE.reduce((all, phase) => {
    all[phase.key] = viewRows.filter((c) => phase.key === 'all' && (workFilter === 'messages' || ownerFilter || taskScope !== 'all') ? true : phase.filter(c)).length;
    return all;
  }, {}), [viewRows, workFilter, ownerFilter, taskScope]);
  const handleSort = (col, direction) => {
    if (!sortableColumns.some(column => column.key === col)) return;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('sort', col);
      next.set('dir', direction === 'asc' || direction === 'desc' ? direction : previous.get('sort') === col && previous.get('dir') !== 'desc' ? 'desc' : 'asc');
      return next;
    }, { replace: true });
  };

  // ── Bulk status changes: only a valid next step for every selected dossier,
  // confirmed with its list, written one dossier after another with its version.
  const selectedDossiers = useMemo(() => displayedRows.filter(dossier => selectedIds.has(dossier.id)), [displayedRows, selectedIds]);
  const bulkPlan = useMemo(() => bulkStatusPlan(selectedDossiers), [selectedDossiers]);
  const bulkChoices = bulkPlan.choices.filter(step => can(step.permission));
  const canBulkStatus = BULK_STATUS_STEPS.some(step => !step.viaDeparture && can(step.permission));
  const departureHint = bulkPlan.departure && (canBulkStatus || can('perm_colis_expedier'));
  const statusReason = canBulkStatus && !bulkChoices.length && !bulkPlan.departure ? bulkPlan.reason : null;
  const canLabels = can('perm_envois_etiquettes');
  useEffect(() => { if (bulkChoice && !bulkChoices.some(step => step.statut === bulkChoice)) setBulkChoice(''); }, [bulkChoice, bulkChoices]);
  const askBulkStatus = statut => {
    const step = bulkChoices.find(item => item.statut === statut);
    if (!step || bulkRun) return;
    const items = selectedDossiers.map(dossier => ({ id: dossier.id, ref: dossier.ref || 'Sans référence', client: clientDisplayName(getClient(dossier.clientId)) || 'Client non renseigné', updatedAt: dossier.updatedAt || null }));
    if (items.length) setBulkRun({ statut: step.statut, label: step.label, permission: step.permission, items, phase: 'confirm', results: [] });
  };
  const runBulkStatus = async () => {
    const run = bulkRun;
    if (!run || run.phase !== 'confirm' || !can(run.permission)) return;
    setBulkRun({ ...run, phase: 'running', results: [] });
    const results = [];
    for (const item of run.items) {
      // The version the person confirmed: a colleague's change is reported, never overwritten.
      try { await upd(item.id, { statut: run.statut }, { expectedUpdatedAt: item.updatedAt || undefined }); results.push({ id: item.id, ok: true }); }
      catch (error) { results.push({ id: item.id, ok: false, reason: bulkRefusalReason(error) }); }
      setBulkRun(current => current && { ...current, results: [...results] });
    }
    const refused = results.filter(result => !result.ok).map(result => result.id);
    setSelectedIds(new Set(refused));
    setBulkRun(current => current && { ...current, phase: 'done', results });
    const changed = results.length - refused.length;
    flash(refused.length
      ? { msg: `${countLabel(changed, 'dossier')} mis à jour · ${countLabel(refused.length, 'dossier')} non ${countWord(refused.length, 'modifié', 'modifiés')}, encore ${countWord(refused.length, 'sélectionné', 'sélectionnés')}`, type: 'warning' }
      : { msg: `${countLabel(changed, 'dossier')} ${countWord(changed, 'passé', 'passés')} à « ${run.label} »`, type: 'success' });
  };
  const closeBulkRun = () => { if (!bulkRunning) setBulkRun(null); };
  const toggleSelection = id => setSelectedIds(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  // The floating bulk bar never moves the rows: it overlays the list bottom,
  // and the list keeps room under its last row while the bar is shown.
  const bulkBarRef = useRef(null);
  const selecting = selectedIds.size > 0;
  useLayoutEffect(() => {
    const bar = bulkBarRef.current, page = pageRef.current;
    if (!page) return undefined;
    if (!bar) { page.style.removeProperty('--dossier-bulk-height'); return undefined; }
    const update = () => page.style.setProperty('--dossier-bulk-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [selecting]);
  // A row, its reference or the only search result opens the dossier itself,
  // which resolves its current step; only the action button opens the task.
  const openDossier = id => navigate(`/colis/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo })}`);
  const openTask = (id, action) => action ? navigate(workActionUrl(action, returnTo, data.find(item => item.id === id))) : openDossier(id);
  const selectedFromUrl = searchParams.get('dossier');
  useEffect(() => {
    if (!selectedFromUrl) return;
    const params = new URLSearchParams(location.search);
    params.delete('dossier');
    const query = params.toString(); // URLSearchParams.size needs Safari 17
    const back = `${location.pathname}${query ? `?${query}` : ''}`;
    navigate(`/colis/${encodeURIComponent(selectedFromUrl)}?${new URLSearchParams({ returnTo: back })}`, { replace: true });
  }, [selectedFromUrl, location.pathname, location.search, navigate]);
  // A tab opens with its own remembered grouping, not the previous tab's.
  const selectView = key => {
    setSearchParams(previous => { const next = new URLSearchParams(previous); if (key === 'daily') next.delete('table'); else next.set('table', key); next.delete('view'); return next; }, { replace: true });
    setSelectedIds(new Set()); setColumnOptions(null); setVisibilityAnchor(null); setDisplayOpen(false);
  };

  // A failed load never reads as an empty list: no count, no « Aucun dossier ».
  // A failed refresh keeps the loaded dossiers under the shell's banner.
  const { state: dataLoad, reason: dataProblem } = staffDataState({ sbReady, dataLoading, dataError, hasData: data.length > 0 });
  const loadFailed = dataLoad === 'failed';
  const visibleCount = sorted.length;

  const filterFields = <div className="dossier-filters-fields">
    <label className="dossier-filters-field">File de travail<select aria-label="File de travail" value={workFilter || ''} onChange={e => { setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('tab'); next.delete('archive'); if (e.target.value) next.set('work', e.target.value); else next.delete('work'); return next; }, { replace: true }); }}><option value="">Tous les dossiers</option>{WORK_QUEUES.map(queue => <option key={queue.key} value={queue.key}>{queue.label}</option>)}</select></label>
    <label className="dossier-filters-field">Étape<select aria-label="Étape" value={activeTab} onChange={event => setActiveTab(event.target.value)}>{PIPELINE.map(phase => <option key={phase.key} value={phase.key}>{loadFailed ? phase.label : `${phase.label} (${tabCounts[phase.key] || 0})`}</option>)}</select></label>
    <label className="dossier-filters-field">Responsable de la tâche<select aria-label="Responsable de la tâche" value={ownerFilter} onChange={e => { setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('tasks'); if (e.target.value) next.set('owner', e.target.value); else next.delete('owner'); return next; }, { replace: true }); }}><option value="">Toute l’équipe</option><option value="mine">Moi</option><option value="unassigned">Non attribué</option>{teamUsers.filter(user => user.authId && user.actif !== false).map(user => <option key={user.authId} value={user.authId}>{[user.prenom, user.nom].filter(Boolean).join(' ')}</option>)}</select></label>
    <label className="dossier-filters-field">Destination<select aria-label="Destination" value={activeDest || ''} onChange={e => setActiveDest(e.target.value)}><option value="">Toutes les destinations</option>{['974', '976', '971', '972'].map(code => <option key={code} value={code}>{getDestByCP(code + '00').nom}</option>)}</select></label>
  </div>;
  const filtersPanel = <div id="dossier-filters-panel" role="group" aria-label="Filtres des dossiers" className="dossier-filters-panel">
    {filterFields}
    <div className="dossier-filters-actions">
      {/* A work queue never includes archives (see scope): no toggle claims otherwise. */}
      {!workFilter && <button type="button" className="dossier-toolbar-button" disabled={archivesBusy} aria-pressed={showArchive} onClick={async () => { if (showArchive) { setShowArchive(false); return; } setArchivesBusy(true); try { if (!archivesLoaded) await loadArchives(); setShowArchive(true); } catch (error) { flash({ msg: 'Les archives n’ont pas pu être chargées. ' + error.message, type: 'error' }); } finally { setArchivesBusy(false); } }}>{archivesBusy ? 'Chargement archives…' : showArchive ? 'Archives incluses' : 'Inclure les archives'}</button>}
      <button type="button" className="dossier-toolbar-button" aria-haspopup="dialog" aria-expanded={Boolean(columnOptions?.fromMenu)} aria-controls={columnOptions?.fromMenu ? 'dossier-column-dialog' : undefined} onClick={event => setColumnOptions({ key: null, anchor: event.currentTarget, fromMenu: true })}>Filtres par colonne{Object.keys(columnFilters).length ? ` · ${Object.keys(columnFilters).length}` : ''}</button>
      {compact
        ? activeFilters.length > 0 && <button type="button" onClick={clearFilters} className="dossier-text-button">Retirer tous les filtres</button>
        : <button type="button" onClick={() => setShowFilters(false)} className="dossier-text-button">Fermer les filtres</button>}
    </div>
  </div>;

  return (
    <div ref={pageRef} className="dossier-list h-full min-h-0 min-w-0 flex flex-col" data-layout={layout} data-compact={compact ? 'true' : undefined} data-selection={selecting ? 'true' : undefined} style={{ '--dossier-text-size': `${textSize}px`, '--dossier-small-text-size': `${textSize}px` }}>

      <header className="dossier-list-header max-h-[55dvh] shrink-0 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3 pt-4">
        <div className="dossier-header-top">
          <h1 className="text-xl font-bold text-gray-900">Dossiers d’expédition</h1>
          {/* Every view stays visible: the tabs wrap on a narrow screen. */}
          <div role="group" aria-label="Vues du tableau" className="dossier-view-tabs">
            {TABLE_VIEWS.filter(view => view.key !== 'payments' || canSeePayments).map(view => <button key={view.key} type="button" aria-pressed={tableView === view.key}
              onClick={() => selectView(view.key)} className="dossier-view-tab">{view.label}</button>)}
          </div>
          {tableRequested === 'payments' && !canSeePayments && <p role="status" className="text-sm text-gray-700">Votre rôle ne permet pas de consulter les montants. Les dossiers restent accessibles dans Travail quotidien.</p>}
        </div>
        {/* On a phone this bar stays pinned while the rest of the header scrolls away. */}
        <div className="dossier-toolbar-bar">
          <div className="dossier-toolbar">
            <div className="dossier-toolbar-search relative">
              <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher ou scanner un colis"
                onKeyDown={event => { if (event.key !== 'Enter') return; if (exactReference) openReferenceDossier(); else if (sorted.length === 1) openDossier(sorted[0].id); }}
                placeholder="Référence, client, casier ou suivi…" className="min-h-11 w-full pl-10 pr-10 text-sm" />
              {search && <button aria-label="Effacer la recherche" onClick={() => setSearch('')} className="absolute right-0 top-0 flex min-h-11 w-10 items-center justify-center text-gray-500"><X size={17} aria-hidden="true" /></button>}
            </div>
            <div role="group" aria-label="Choisir les tâches affichées" className="dossier-scope">
              {[['all', 'Tous'], ['mine', 'Mes tâches'], ['pool', 'À prendre']].map(([value, label]) => <button key={value} type="button" aria-pressed={taskScope === value}
                onClick={() => { setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('owner'); if (value === 'all') next.delete('tasks'); else next.set('tasks', value); return next; }, { replace: true }); setSelectedIds(new Set()); }}
                ><span>{label}</span></button>)}
            </div>
            <button ref={filtersButtonRef} type="button" className="dossier-toolbar-button dossier-toolbar-icon-button dossier-toolbar-filters" data-column-filters-button aria-label={`Filtres${activeFilters.length ? ` · ${activeFilters.length}` : ''}`} aria-haspopup={compact ? 'dialog' : undefined} aria-expanded={showFilters} aria-controls={showFilters ? 'dossier-filters-panel' : undefined} onClick={() => setShowFilters(value => !value)}>
              <ListFilter size={18} aria-hidden="true" /><span className="dossier-toolbar-button-text">Filtres</span>{activeFilters.length > 0 && <span className="dossier-toolbar-badge" aria-hidden="true">{activeFilters.length}</span>}
            </button>
            <button ref={displayButtonRef} type="button" className="dossier-toolbar-button dossier-toolbar-icon-button" aria-label="Affichage" aria-haspopup="dialog" aria-expanded={displayOpen} aria-controls={displayOpen ? 'dossier-display-dialog' : undefined}
              onClick={() => { setColumnOptions(null); setVisibilityAnchor(null); setDisplayOpen(value => !value); }}>
              <Settings2 size={18} aria-hidden="true" /><span className="dossier-toolbar-button-text">Affichage</span>
            </button>
          </div>
        </div>
        {displayOpen && <DossierDisplayOptions anchor={displayButtonRef.current} onClose={() => setDisplayOpen(false)}
          visibleColumnCount={displayColumns.length} columnCount={allColumns.length}
          onOpenColumns={() => { setDisplayOpen(false); setColumnOptions(null); setVisibilityAnchor(displayButtonRef.current); }}
          layout={layout} onLayoutChange={setLayout} textSize={textSize} onTextSizeChange={setTextSize} textSizeKey={`${auth?.u?.id}:${tableView}`}
          grouping={grouping} onGroupingChange={changeGrouping} noDeparture={noDeparture} onNoDepartureChange={setNoDeparture}
          sortValue={sortCol ? `column:${sortCol}:${sortDir}` : defaultSortKey} sortOptions={sortOptions} sortableColumns={sortableColumns}
          onSortChange={value => { const [kind, key, direction] = value.split(':'); if (kind === 'column') handleSort(key, direction); else changeDefaultSort(value); }}
          canExport={canExportView} exportCount={displayedRows.length} exportBusy={exportBusy} exportError={exportError} onExport={() => exportRows(displayedRows)} />}
        {visibilityAnchor && <DossierColumnVisibility key={tableView} columns={allColumns} visibleKeys={visibleKeys} widths={widths} anchor={visibilityAnchor} onChange={setColumnVisible} onReset={resetColumns} onClose={() => setVisibilityAnchor(null)}
          {...(tableShown ? { onResize: setWidth, onResetWidths: resetWidths } : { notes: CARD_COLUMN_NOTES })} />}
        {columnOptions && <DossierColumnOptions key={tableView} columns={sortableColumns} columnKey={columnOptions.key} anchor={columnOptions.anchor} fromMenu={columnOptions.fromMenu} filters={columnFilters} widths={widths} suggestions={columnSuggestions} onSelect={key => setColumnOptions(previous => ({ ...previous, key }))} onFilter={setColumnFilter}
          onResize={tableShown ? setWidth : undefined} onResetWidths={tableShown ? resetWidths : undefined} onClose={() => setColumnOptions(null)} />}
        {showFilters && !compact && filtersPanel}
        <div className="dossier-header-meta">
          <div className="dossier-meta-row">
            {!loadFailed && <span role="status" className="dossier-meta-count">{countLabel(visibleCount, 'dossier')}</span>}
            {activeFilters.length > 0 && <div role="group" aria-label="Filtres actifs" className="dossier-active-filters">
              {activeFilters.map(filter => <button key={filter.key} type="button" aria-label={`Retirer le filtre ${filter.label}`} onClick={() => setParam(filter.key, null)} className="dossier-filter-chip"><span className="break-words">{filter.label}</span><X size={14} aria-hidden="true" className="shrink-0" /></button>)}
              <button type="button" onClick={clearFilters} className="dossier-text-button">Retirer les filtres</button>
            </div>}
            <span className="dossier-meta-spacer" aria-hidden="true" />
            {sortColumn && <p role="status" className="dossier-meta-sort">Tri : {sortColumn.label} · {dossierTableSortDirectionLabel(sortColumn, sortDir)}{grouped ? ' · dans chaque groupe' : ''}</p>}
            <DossierHorizontalScroll scrollRef={listScrollRef} onEdgesChange={setScrollEdges} layoutKey={`${tableView}:${tableStyle.width}:${visibleSignature}:${sorted.length}:${textSize}:${layout}:${compact}`} />
          </div>
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
        </div>
      </header>

      {/* On a phone « Filtres » is a sheet whose close button never leaves the screen. */}
      {showFilters && compact && <ColumnDialog id="dossier-filters-dialog" titleId="dossier-filters-title" testId="filters-sheet" className="dossier-filters-sheet" placement="sheet"
        title="Filtres" closeLabel="Fermer les filtres" anchor={filtersButtonRef.current} onClose={() => setShowFilters(false)}>
        {filtersPanel}
        <div className="dossier-filters-sheet-footer">
          <button type="button" className="dossier-filters-sheet-done" onClick={() => setShowFilters(false)}>{loadFailed || visibleCount === 0 ? 'Voir la liste' : visibleCount === 1 ? 'Voir le dossier' : `Voir les ${countLabel(visibleCount, 'dossier')}`}</button>
        </div>
      </ColumnDialog>}

      {workError && <div role="alert" className="dossier-list-notice shrink-0 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Les tâches n’ont pas pu être actualisées. Les dossiers restent consultables.<button onClick={() => refreshWork().catch(() => {})} className="ml-3 min-h-11 font-semibold underline">Recharger les tâches</button></div>}
      {workLoading && <p role="status" className="dossier-list-notice shrink-0 px-4 py-2 text-sm text-gray-600">Chargement des tâches…</p>}
      {taskScope === 'pool' && !available && <p className="dossier-list-notice shrink-0 px-4 py-2 text-sm text-gray-700">Vous êtes indisponible. <button onClick={() => navigate('/?preferences=1')} className="min-h-11 font-semibold underline">Modifier ma disponibilité dans Mon travail</button></p>}
      {/* A failed refresh keeps the last loaded dossiers: the application banner says so. */}

      {/* While « Affichage » is open, its own alert reports the export failure. */}
      {exportError && !displayOpen && <p role="alert" className="dossier-list-notice px-4 py-2 text-sm text-red-700">{exportError}</p>}
      {/* Main area: the table or the cards; the selection bar floats over its bottom. */}
      <div className="dossier-list-main flex-1 flex min-h-0 relative" data-more-right={scrollEdges.right ? 'true' : undefined} data-more-left={scrollEdges.left ? 'true' : undefined} data-action-pinned={actionPinned && tableShown ? 'true' : 'false'}>

        {/* Bulk action bar: the count and « Désélectionner tout » lead; on phones
            the status changes collapse into one native select. It overlays the
            list, so checking a row never moves the rows. */}
        {selecting && (
          <div ref={bulkBarRef} role="group" aria-label="Actions sur la sélection" className="dossier-bulk-bar">
            <span className="dossier-bulk-count">{countLabel(selectedIds.size, 'dossier')} {countWord(selectedIds.size, 'sélectionné', 'sélectionnés')}</span>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="dossier-text-button dossier-bulk-clear">
              Désélectionner tout
            </button>
            {bulkChoices.length > 0 && <>
              <div className="dossier-bulk-statuses" role="group" aria-label="Passer la sélection à l’étape suivante">
                {bulkChoices.map(step => (
                  <button key={step.statut} type="button" disabled={bulkRunning} onClick={() => askBulkStatus(step.statut)} className="dossier-bulk-button" aria-haspopup="dialog">
                    {step.label}
                  </button>
                ))}
              </div>
              {/* Choosing never changes a dossier: a keystroke on a closed select
                  (arrows, typeahead) fires « change ». « Appliquer » asks to confirm. */}
              <div className="dossier-bulk-picker">
                <select aria-label="Changer le statut" className="dossier-bulk-status-select" value={bulkChoice} disabled={bulkRunning}
                  onChange={event => setBulkChoice(event.target.value)}>
                  <option value="">{bulkRunning ? 'Mise à jour…' : 'Changer le statut…'}</option>
                  {bulkChoices.map(step => <option key={step.statut} value={step.statut}>{step.label}</option>)}
                </select>
                <button type="button" className="dossier-bulk-button" aria-haspopup="dialog" disabled={!bulkChoice || bulkRunning}
                  onClick={() => { const statut = bulkChoice; setBulkChoice(''); askBulkStatus(statut); }}>Appliquer</button>
              </div>
            </>}
            {departureHint && <p className="dossier-bulk-note"><Plane size={16} aria-hidden="true" /><span>{keepQuotes(BULK_STATUS_REASONS.departure)}{can('perm_envois_voir') && <> <button type="button" className="dossier-text-button" onClick={() => navigate('/departs')}>Ouvrir les départs</button></>}</span></p>}
            {statusReason && <p className="dossier-bulk-note"><AlertCircle size={16} aria-hidden="true" /><span>{keepQuotes(statusReason)}</span></p>}
            {canLabels && (
              <button
                type="button"
                onClick={() => {
                  const ids = [...selectedIds];
                  const colisForLabels = ids.map((id) => data.find((c) => c.id === id)).filter(Boolean);
                  if (colisForLabels.length === 0) return;
                  import('../../utils/exportEtiquettes').then((mod) => mod.printEtiquettes(colisForLabels, clients, getClient));
                }}
                className="dossier-bulk-button"
              >
                Étiquettes
              </button>
            )}
            {canExportView && (() => {
              const exportLabel = selectedIds.size === 1 ? 'Exporter le dossier sélectionné' : `Exporter les ${countLabel(selectedIds.size, 'dossier')} sélectionnés`;
              // The bar names the selection; the button shows « Exporter », and its
              // full name starts with that visible word (WCAG 2.5.3).
              return <button type="button" aria-label={exportLabel} title={exportLabel} onClick={() => exportRows(displayedRows.filter(dossier => selectedIds.has(dossier.id)))} className="dossier-bulk-button">
                Exporter
              </button>;
            })()}
            {!canBulkStatus && !departureHint && !canLabels && !canExportView && <p className="dossier-bulk-note"><span>Aucune action groupée n’est ouverte à votre rôle.</span></p>}
          </div>
        )}

        {/* Table (scrollable) */}
        <div id="dossier-table-scroll" ref={listScrollRef} role="region" aria-label="Tableau des dossiers" tabIndex={0} className="min-w-0 flex-1 overflow-y-auto overflow-x-auto">

          {(() => {
            if (loadFailed) return <DossierListProblem reason={dataProblem} onRetry={retryLoad} />;
            const displayCols = displayColumns;
            const totalColspan = displayCols.length + 1; // checkbox + N colonnes
            const toggleGroup = (group) => {
              const ids = group.dossiers.map((c) => c.id);
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
                else ids.forEach((id) => next.add(id));
                return next;
              });
            };
            const selectionOf = ids => { const count = ids.filter(id => selectedIds.has(id)).length; return count === 0 ? 'none' : count === ids.length ? 'all' : 'some'; };
            // Folding is shared by the table and the cards, and remembered for the person.
            const collapsed = group => collapsedGroups.includes(group.key);
            const headerProps = group => ({
              group, collapsed: collapsed(group), selection: group.dossiers.length ? selectionOf(group.dossiers.map(c => c.id)) : 'none',
              onToggle: () => setCollapsedGroups(previous => previous.includes(group.key) ? previous.filter(key => key !== group.key) : [...previous, group.key]),
              onToggleAll: () => toggleGroup(group),
            });
            const card = c => <DossierTableCard view={tableView} key={c.id} c={c} client={getClient(c.clientId)} model={models.get(c.id)} alerts={alertsByDossier.get(c.id)} columns={displayCols} checked={selectedIds.has(c.id)} onCheck={() => toggleSelection(c.id)} onOpen={action => openTask(c.id, action)} onOpenDossier={() => openDossier(c.id)} returnTo={returnTo} />;
            const tableRow = c => <DossierTableRow key={c.id} c={c} client={getClient(c.clientId)} model={models.get(c.id)} alerts={alertsByDossier.get(c.id)} columns={displayCols} checked={selectedIds.has(c.id)} onCheck={() => toggleSelection(c.id)} onOpen={action => openTask(c.id, action)} onOpenDossier={() => openDossier(c.id)} returnTo={returnTo} />;

            if (groups.length === 0) {
              if (exactReference) return null;
              const query = search.trim();
              const filtered = activeFilters.length > 0;
              const clearSearch = query ? <button key="search" type="button" className="dossier-empty-action" onClick={() => setSearch('')}>Effacer la recherche</button> : null;
              const removeFilters = filtered ? <button key="filters" type="button" className="dossier-empty-action" onClick={clearFilters}>Retirer les filtres</button> : null;
              if (taskScope !== 'all') return <DossierListEmpty icon={taskScope === 'mine' ? UserCheck : Inbox}
                title={!workReady ? 'La liste des tâches est indisponible pour le moment.' : taskScope === 'mine' ? 'Aucune tâche ne vous est attribuée dans cette sélection.' : 'Aucune tâche disponible dans cette sélection.'}
                text={!workReady ? 'Rechargez les tâches pour retrouver leur attribution.' : 'Les dossiers de l’équipe restent consultables dans « Tous ».'}>
                {!workReady && <button type="button" className="dossier-empty-action" data-primary="true" onClick={() => refreshWork().catch(() => {})}>Recharger les tâches</button>}
                <button type="button" className="dossier-empty-action" data-primary={workReady ? 'true' : undefined} onClick={showAllTasks}>Voir tous les dossiers</button>
                {clearSearch}{removeFilters}
              </DossierListEmpty>;
              // Without any filter, an empty « Accords clients » is the normal state: every consent is obtained.
              if (tableView === 'accords' && !filtered && !query) return <DossierListEmpty icon={CheckCircle} title="Aucun dossier en attente d’accord."
                text="Chaque dossier reçu a obtenu l’accord de son client.">
                <button type="button" className="dossier-empty-action" data-primary="true" onClick={() => selectView('daily')}>Voir le travail quotidien</button>
              </DossierListEmpty>;
              if (query && !filtered) return <DossierListEmpty icon={SearchX} title={`Aucun dossier ne correspond à « ${query} ».`}
                text="Vérifiez la référence, le nom du client, le casier ou le numéro de suivi.">
                {React.cloneElement(clearSearch, { 'data-primary': 'true' })}
              </DossierListEmpty>;
              if (filtered) return <DossierListEmpty icon={ListFilter} title="Aucun dossier ne correspond à ces filtres."
                text="Retirez un filtre pour élargir la liste.">
                {React.cloneElement(removeFilters, { 'data-primary': 'true' })}{clearSearch}
              </DossierListEmpty>;
              return <DossierListEmpty icon={Package} title="Aucun dossier pour le moment." text="Un dossier apparaît ici dès la réception de ses cartons.">
                {can('perm_colis_receptionner') && <button type="button" className="dossier-empty-action" data-primary="true" onClick={() => navigate(`/reception?${new URLSearchParams({ returnTo })}`)}>Réceptionner des cartons</button>}
              </DossierListEmpty>;
            }

            return <>
              <div className="dossier-card-list px-4">{grouped
                ? groups.map(group => <DossierCardGroup key={group.key} {...headerProps(group)}>{!collapsed(group) && group.dossiers.map(card)}</DossierCardGroup>)
                : sorted.map(card)}</div>
              <table aria-label="Dossiers d’expédition" data-view={tableView} data-unpin-client={unpinClient ? 'true' : undefined} data-unpin-ref={unpinRef ? 'true' : undefined} data-unpin-action={listWidth < 768 ? 'true' : undefined} style={{ ...tableStyle, '--dossier-list-width': listWidth ? `${listWidth}px` : undefined }} className="dossier-data-table text-left">
                <colgroup><col style={{ width: 40 }} />{displayCols.map(column => <col key={column.key} style={{ width: tableWidths[column.key] }} />)}</colgroup>
                <thead>
                  <DossierTableHead
                    columns={displayCols}
                    widths={widths}
                    onResize={setWidth}
                    filters={columnFilters}
                    onFilterColumn={(key, anchor) => { setColumnOptions({ key, anchor, fromMenu: false }); }}
                    openFilterKey={columnOptions && !columnOptions.fromMenu ? columnOptions.key : null}
                    selection={selectionOf(sorted.map(c => c.id))}
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
                  {grouped
                    ? groups.map(group => <React.Fragment key={group.key}>
                      <DossierGroupRow colSpan={totalColspan} {...headerProps(group)} />
                      {!collapsed(group) && group.dossiers.map(tableRow)}
                    </React.Fragment>)
                    : sorted.map(tableRow)}
                </tbody>
              </table>
            </>;
          })()}
        </div>
        {/* Past the right edge, more columns: a quiet fade when the action is not pinned. */}
        <div className="dossier-scroll-fade" aria-hidden="true" />

      </div>
      {bulkRun && <BulkStatusDialog run={bulkRun} onConfirm={runBulkStatus} onClose={closeBulkRun} />}
    </div>
  );
}

/** French guillemets never end or start a line alone: « … » stays on one
 * line, and the text itself (its accessible name) is unchanged. */
function keepQuotes(text) {
  return String(text).split(/(« [^»]* »)/g).map((part, index) => index % 2 ? <span key={index} className="dossier-nowrap">{part}</span> : part);
}

const CARD_COLUMN_NOTES = [
  'Choisissez les informations affichées sur chaque carte. La référence reste affichée pour identifier chaque dossier.',
  'Vos choix sont mémorisés pour votre compte et cette vue, sur cet appareil.',
];

/** An illustrated empty list: what is (not) there, why, and what to do next. */
function DossierListEmpty({ icon: Icon, title, text, children }) {
  const actions = React.Children.toArray(children).filter(Boolean);
  return <div className="dossier-empty">
    <span className="dossier-empty-icon" aria-hidden="true"><Icon size={28} /></span>
    <p className="dossier-empty-title">{keepQuotes(title)}</p>
    {text && <p className="dossier-empty-text">{keepQuotes(text)}</p>}
    {actions.length > 0 && <div className="dossier-empty-actions">{actions}</div>}
  </div>;
}

/** The application banner already reads « Chargement impossible : … »: under
 * its own title, the list gives the cause alone instead of repeating it. */
function problemCause(reason) {
  return String(reason || '').replace(/^(?:Chargement impossible|Actualisation des dossiers impossible)\s*:\s*/, '');
}

/** The dossiers could not be loaded: the reason and a new attempt, never an
 * empty list (a failed refresh keeps its dossiers under the application banner). */
function DossierListProblem({ reason, onRetry }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try { await onRetry?.(); } catch { /* The application banner reports the new failure. */ } finally { setBusy(false); }
  };
  return <div role="alert" className="dossier-list-problem">
    <AlertTriangle size={28} aria-hidden="true" className="dossier-list-problem-icon" />
    <div className="min-w-0">
      <p className="dossier-list-problem-title">Les dossiers n’ont pas pu être chargés.</p>
      <p className="dossier-list-problem-text">Motif : {problemCause(reason)}</p>
      <p className="dossier-list-problem-text">Aucun dossier n’est affiché tant que le chargement n’a pas abouti.</p>
      <button type="button" className="dossier-list-problem-retry" disabled={busy} onClick={retry}>{busy ? 'Nouvelle tentative…' : 'Réessayer'}</button>
    </div>
  </div>;
}

/** Confirm, run and report one bulk status change: the dossiers and the target
 * status first; then each dossier's result, with the server's reason for a
 * refusal. It cannot close while the changes are being written. */
function BulkStatusDialog({ run, onConfirm, onClose }) {
  const { label, items, phase, results } = run;
  const running = phase === 'running', done = phase === 'done';
  const refused = results.filter(result => !result.ok).length, changed = results.length - refused;
  const title = done ? 'Résultat du changement de statut' : keepQuotes(`Passer à « ${label} »`);
  return <ColumnDialog id="dossier-bulk-dialog" titleId="dossier-bulk-title" testId="bulk-status-dialog" className="dossier-bulk-dialog" title={title}
    closeLabel={done ? 'Fermer le résultat' : 'Fermer sans changer le statut'} width={460} focusKey={phase} fallbackFocus="#dossier-table-scroll" onClose={onClose}>
    {done
      ? <p role="status" className="dossier-bulk-summary">{keepQuotes(refused
        ? `${countLabel(changed, 'dossier')} ${countWord(changed, 'passé', 'passés')} à « ${label} » · ${countLabel(refused, 'dossier')} non ${countWord(refused, 'modifié', 'modifiés')}, ${countWord(refused, 'resté', 'restés')} ${countWord(refused, 'sélectionné', 'sélectionnés')}.`
        : `${countLabel(changed, 'dossier')} ${countWord(changed, 'passé', 'passés')} à « ${label} ».`)}</p>
      : <p className="dossier-bulk-intro">{keepQuotes(items.length === 1 ? `Ce dossier passera à « ${label} » :` : `Ces ${countLabel(items.length, 'dossier')} passeront à « ${label} » :`)}</p>}
    <ul className="dossier-bulk-list" aria-label="Dossiers concernés">
      {items.map(item => {
        const result = results.find(entry => entry.id === item.id);
        return <li key={item.id} data-bulk-item={item.id} data-result={result ? result.ok ? 'ok' : 'refused' : undefined}>
          <span className="dossier-bulk-ref">{item.ref}</span>
          <span className="dossier-bulk-client">{item.client}</span>
          {result && (result.ok
            ? <span className="dossier-bulk-result" data-ok="true"><Check size={14} aria-hidden="true" /><span>{keepQuotes(`Passé à « ${label} »`)}</span></span>
            : <span className="dossier-bulk-result" data-ok="false"><XCircle size={14} aria-hidden="true" /><span>{keepQuotes(`Non modifié : ${result.reason}`)}</span></span>)}
        </li>;
      })}
    </ul>
    {running && <p role="status" className="dossier-bulk-progress"><Loader2 size={16} aria-hidden="true" className="animate-spin" />Mise à jour {Math.min(results.length + 1, items.length)} sur {items.length}…</p>}
    <div className="dossier-column-filter-actions">
      {done
        ? <button type="button" data-filter-focus="" className="dossier-column-apply" onClick={onClose}>Fermer</button>
        : <>
          <button type="button" className="dossier-column-apply" disabled={running} onClick={onConfirm}>{running ? 'Mise à jour…' : keepQuotes(`Passer à « ${label} »`)}</button>
          <button type="button" data-filter-focus="" disabled={running} onClick={onClose}>Annuler</button>
        </>}
    </div>
  </ColumnDialog>;
}
