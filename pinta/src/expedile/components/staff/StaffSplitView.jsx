import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { Search, X, Package, Clock, CheckCircle, Check, CreditCard, Plane, AlertCircle, CalendarX, ListFilter, Settings2 } from 'lucide-react';
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
import { buildDossierTableModel, defineDossierTableColumn, isDossierTableColumnSortable, sortDossierTableRows, dossierTableSortDirectionLabel } from '../../domain/dossierTable';
import { staffAvailable, sortWorkActions, workActionUrl } from '../../domain/personalWork';
import DossierColumnOptions, { DossierColumnVisibility } from './DossierColumnOptions';
import DossierHorizontalScroll from './DossierHorizontalScroll';
import DossierDisplayOptions from './DossierDisplayOptions';
import useDossierTablePreferences from '../../hooks/useDossierTablePreferences';
import { COLUMN_FILTER_PREFIX, readColumnFilters, filterDossierTableRows, columnFilterLabel, dossierColumnSuggestions, DOSSIER_GROUPINGS, resolveDossierGrouping } from '../../domain/dossierTablePreferences';
import { groupDossiersByDeparture, parisCalendarDay, NO_DEPARTURE_GROUP_KEY } from '../../domain/departureGroups';
import { dossierAlerts } from '../../domain/dossierAlerts';
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
const SORT_OPTIONS = [
  { key: 'priority', label: 'Priorité (échéance, puis travail commencé, puis ancienneté)' },
  { key: 'date_desc', label: 'Plus récent d\'abord' },
  { key: 'date_asc', label: 'Plus ancien d\'abord (FIFO)' },
  { key: 'total_desc', label: 'Montant décroissant' },
  { key: 'total_asc', label: 'Montant croissant' },
  { key: 'ref_asc', label: 'Référence (de A à Z)' },
];
// Bulk status changes after departure, each behind its own permission.
const BULK_STATUSES = [
  { label: 'En transit', statut: 'transit', permission: 'perm_colis_changer_statut_expedition' },
  { label: 'Dédouanement', statut: 'dedouanement', permission: 'perm_colis_changer_statut_expedition' },
  { label: 'Arrivé', statut: 'arrive', permission: 'perm_colis_changer_statut_expedition' },
  { label: 'En livraison', statut: 'livraison', permission: 'perm_colis_changer_statut_expedition' },
  { label: 'Livré', statut: 'livre', permission: 'perm_colis_changer_statut_expedition' },
  { label: 'Expédié', statut: 'expedie', permission: 'perm_colis_expedier' },
];
const LS_SORT_KEY = 'expedile_default_sort_v2:';
function loadDefaultSort(userId) {
  try {
    const saved = localStorage.getItem(LS_SORT_KEY + userId);
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
  // Phone bulk bar: the select only prepares a status; « Appliquer » runs it.
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
  const visibleSignature = visibleKeys.join('|');
  const displayColumns = useMemo(() => allColumns.filter(column => visibleSignature.split('|').includes(column.key)), [allColumns, visibleSignature]);
  const sortableColumns = displayColumns.filter(isDossierTableColumnSortable);
  const [visibilityAnchor, setVisibilityAnchor] = useState(null);
  const [columnOptions, setColumnOptions] = useState(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const displayButtonRef = useRef(null);
  const viewTabsRef = useRef(null);
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
  // « À vérifier », marked next to each reference; the dossier page details it.
  const alertsByDossier = useMemo(() => {
    const envoiById = new Map(envois.map(envoi => [envoi.id, envoi]));
    return new Map(data.map(dossier => [dossier.id, dossierAlerts({ dossier, client: getClient(dossier.clientId), envoi: envoiById.get(dossier.envoi), today: now })]));
  }, [data, getClient, envois, now]);
  // Each tab remembers its own « Regrouper » on this device; an explicit `view`
  // in the URL wins, so a shared link keeps its grouping.
  const grouping = resolveDossierGrouping(searchParams.get('view'), savedGrouping, tableView);
  const changeGrouping = value => {
    if (!DOSSIER_GROUPINGS.includes(value)) return;
    setGrouping(value);
    setParam('view', value);
  };
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
  const defaultSortKey = defaultSort.startsWith('total_') && (!canSeePayments || !displayColumns.some(column => column.key === 'requested')) ? 'priority' : defaultSort;
  const activeFilters = [
    taskScope !== 'all' && { key: 'tasks', label: taskScope === 'mine' ? 'Mes tâches' : 'À prendre' },
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
      ['work', 'client', 'envoi', 'owner', 'dest', 'tab', 'archive', 'dossier', 'tasks', ...[...next.keys()].filter(key => key.startsWith(COLUMN_FILTER_PREFIX))].forEach(key => next.delete(key));
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
  const phaseRows = useMemo(() => {
    if (activeTab === 'all' && (workFilter === 'messages' || ownerFilter || taskScope !== 'all')) return scope;
    const phase = PIPELINE.find((item) => item.key === activeTab);
    return phase ? scope.filter(phase.filter) : scope;
  }, [scope, activeTab, workFilter, ownerFilter, taskScope]);

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

  // Groups keep the sorted order inside each band. A departure group reads
  // « Départ du jeudi 15 octobre · Réunion », then its reference.
  const today = parisCalendarDay(now);
  const grouped = grouping !== 'none';
  const groups = useMemo(() => {
    if (grouping === 'envoi') return groupDossiersByDeparture(sorted, envois, { today, noDeparture }).map(group => {
      const unassigned = group.key === NO_DEPARTURE_GROUP_KEY;
      return { key: group.key, title: group.destinationLabel ? `${group.label} · ${group.destinationLabel}` : group.label, ref: group.ref,
        icon: unassigned ? CalendarX : Plane, color: unassigned ? 'var(--text-muted)' : 'var(--brand-text)', dossiers: group.dossiers };
    });
    if (grouping === 'statut') return STATUT_GROUPS.map(group => ({ key: group.label, title: group.label, icon: group.icon, color: group.color,
      dossiers: sorted.filter(dossier => group.statuts.includes(dossier.statut)) })).filter(group => group.dossiers.length > 0);
    return sorted.length ? [{ key: 'all', dossiers: sorted }] : [];
  }, [grouping, sorted, envois, today, noDeparture]);
  // Exports follow the order on screen, group by group.
  const displayedRows = useMemo(() => grouped ? groups.flatMap(group => group.dossiers) : sorted, [grouped, groups, sorted]);

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

  const applyBulkStatus = async statut => {
    const action = BULK_STATUSES.find(item => item.statut === statut);
    if (!action || bulkBusy || !can(action.permission)) return;
    setBulkBusy(true);
    const failed = []; let ok = 0;
    for (const id of selectedIds) { try { const result = await changerStatut(id, action.statut); if (result === false) failed.push(id); else ok++; } catch { failed.push(id); } }
    setSelectedIds(new Set(failed)); setBulkBusy(false);
    flash({ msg: `${ok} dossier(s) mis à jour${failed.length ? ` · ${failed.length} non modifié(s), encore sélectionné(s)` : ''}`, type: failed.length ? 'warning' : 'success' });
  };
  const toggleSelection = id => setSelectedIds(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  // A row, its reference or the only search result opens the dossier itself,
  // which resolves its current step; only the action button opens the task.
  const openDossier = id => navigate(`/colis/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo })}`);
  const openTask = (id, action) => action ? navigate(workActionUrl(action, returnTo, data.find(item => item.id === id))) : openDossier(id);
  const selectedFromUrl = searchParams.get('dossier');
  useEffect(() => {
    if (!selectedFromUrl) return;
    const params = new URLSearchParams(location.search);
    params.delete('dossier');
    const back = `${location.pathname}${params.size ? `?${params}` : ''}`;
    navigate(`/colis/${encodeURIComponent(selectedFromUrl)}?${new URLSearchParams({ returnTo: back })}`, { replace: true });
  }, [selectedFromUrl, location.pathname, location.search, navigate]);
  // On narrow screens the view tabs scroll inside their own strip: keep the
  // selected one visible without moving the page.
  useLayoutEffect(() => {
    const strip = viewTabsRef.current;
    const tab = strip?.querySelector('[aria-pressed="true"]');
    if (!tab || strip.scrollWidth <= strip.clientWidth) return;
    const margin = 16;
    if (tab.offsetLeft - margin < strip.scrollLeft) strip.scrollLeft = Math.max(0, tab.offsetLeft - margin);
    else if (tab.offsetLeft + tab.offsetWidth + margin > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = tab.offsetLeft + tab.offsetWidth + margin - strip.clientWidth;
  }, [tableView]);



  return (
    <div className="dossier-list h-full min-h-0 min-w-0 flex flex-col" data-layout={layout} style={{ '--dossier-text-size': `${textSize}px`, '--dossier-small-text-size': `${textSize}px` }}>

      <header className="dossier-list-header max-h-[55dvh] shrink-0 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3 pt-4">
        <h1 className="text-xl font-bold text-gray-900">Dossiers d’expédition</h1>
        <div ref={viewTabsRef} role="group" aria-label="Vues du tableau" className="dossier-view-tabs">
          {/* A tab opens with its own remembered grouping, not the previous tab's. */}
          {TABLE_VIEWS.filter(view => view.key !== 'payments' || canSeePayments).map(view => <button key={view.key} type="button" aria-pressed={tableView === view.key}
            onClick={() => { setSearchParams(previous => { const next = new URLSearchParams(previous); if (view.key === 'daily') next.delete('table'); else next.set('table', view.key); next.delete('view'); return next; }, { replace: true }); setSelectedIds(new Set()); setColumnOptions(null); setVisibilityAnchor(null); setDisplayOpen(false); }}
            className="dossier-view-tab">{view.label}</button>)}
        </div>
        {tableRequested === 'payments' && !canSeePayments && <p role="status" className="text-sm text-gray-700">Votre rôle ne permet pas de consulter les montants. Les dossiers restent accessibles dans Travail quotidien.</p>}
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
          <button type="button" className="dossier-toolbar-button dossier-toolbar-icon-button dossier-toolbar-filters" data-column-filters-button aria-label={`Filtres${activeFilters.length ? ` · ${activeFilters.length}` : ''}`} aria-expanded={showFilters} aria-controls={showFilters ? 'dossier-filters-panel' : undefined} onClick={() => setShowFilters(value => !value)}>
            <ListFilter size={18} aria-hidden="true" /><span className="dossier-toolbar-button-text">Filtres</span>{activeFilters.length > 0 && <span className="dossier-toolbar-badge" aria-hidden="true">{activeFilters.length}</span>}
          </button>
          <button ref={displayButtonRef} type="button" className="dossier-toolbar-button dossier-toolbar-icon-button" aria-label="Affichage" aria-haspopup="dialog" aria-expanded={displayOpen} aria-controls={displayOpen ? 'dossier-display-dialog' : undefined}
            onClick={() => { setColumnOptions(null); setVisibilityAnchor(null); setDisplayOpen(value => !value); }}>
            <Settings2 size={18} aria-hidden="true" /><span className="dossier-toolbar-button-text">Affichage</span>
          </button>
        </div>
        {displayOpen && <DossierDisplayOptions anchor={displayButtonRef.current} onClose={() => setDisplayOpen(false)}
          visibleColumnCount={displayColumns.length} columnCount={allColumns.length}
          onOpenColumns={() => { setDisplayOpen(false); setColumnOptions(null); setVisibilityAnchor(displayButtonRef.current); }}
          layout={layout} onLayoutChange={setLayout} textSize={textSize} onTextSizeChange={setTextSize} textSizeKey={`${auth?.u?.id}:${tableView}`}
          grouping={grouping} onGroupingChange={changeGrouping} noDeparture={noDeparture} onNoDepartureChange={setNoDeparture}
          sortValue={sortCol ? `column:${sortCol}:${sortDir}` : defaultSortKey} sortOptions={sortOptions} sortableColumns={sortableColumns}
          onSortChange={value => { const [kind, key, direction] = value.split(':'); if (kind === 'column') handleSort(key, direction); else changeDefaultSort(value); }}
          canExport={canExportView} exportCount={displayedRows.length} exportBusy={exportBusy} exportError={exportError} onExport={() => exportRows(displayedRows)} />}
        {visibilityAnchor && <DossierColumnVisibility key={tableView} columns={allColumns} visibleKeys={visibleKeys} widths={widths} onResize={setWidth} onResetWidths={resetWidths} anchor={visibilityAnchor} onChange={setColumnVisible} onReset={resetColumns} onClose={() => setVisibilityAnchor(null)} />}
        {columnOptions && <DossierColumnOptions key={tableView} columns={sortableColumns} columnKey={columnOptions.key} anchor={columnOptions.anchor} fromMenu={columnOptions.fromMenu} filters={columnFilters} widths={widths} suggestions={columnSuggestions} onSelect={key => setColumnOptions(previous => ({ ...previous, key }))} onFilter={setColumnFilter} onResize={setWidth} onResetWidths={resetWidths} onClose={() => setColumnOptions(null)} />}
        {showFilters && <div id="dossier-filters-panel" role="group" aria-label="Filtres des dossiers" className="dossier-filters-panel">
          <div className="dossier-filters-fields">
            <label className="dossier-filters-field">File de travail<select aria-label="File de travail" value={workFilter || ''} onChange={e => { setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('tab'); next.delete('archive'); if (e.target.value) next.set('work', e.target.value); else next.delete('work'); return next; }, { replace: true }); }}><option value="">Tous les dossiers</option>{WORK_QUEUES.map(queue => <option key={queue.key} value={queue.key}>{queue.label}</option>)}</select></label>
            <label className="dossier-filters-field">Étape<select aria-label="Étape" value={activeTab} onChange={event => setActiveTab(event.target.value)}>{PIPELINE.map(phase => <option key={phase.key} value={phase.key}>{phase.label} ({tabCounts[phase.key] || 0})</option>)}</select></label>
            <label className="dossier-filters-field">Responsable de la tâche<select aria-label="Responsable de la tâche" value={ownerFilter} onChange={e => { setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('tasks'); if (e.target.value) next.set('owner', e.target.value); else next.delete('owner'); return next; }, { replace: true }); }}><option value="">Toute l’équipe</option><option value="mine">Moi</option><option value="unassigned">Non attribué</option>{teamUsers.filter(user => user.authId && user.actif !== false).map(user => <option key={user.authId} value={user.authId}>{[user.prenom, user.nom].filter(Boolean).join(' ')}</option>)}</select></label>
            <label className="dossier-filters-field">Destination<select aria-label="Destination" value={activeDest || ''} onChange={e => setActiveDest(e.target.value)}><option value="">Toutes les destinations</option>{['974', '976', '971', '972'].map(code => <option key={code} value={code}>{getDestByCP(code + '00').nom}</option>)}</select></label>
          </div>
          <div className="dossier-filters-actions">
            {/* A work queue never includes archives (see scope): no toggle claims otherwise. */}
            {!workFilter && <button type="button" className="dossier-toolbar-button" disabled={archivesBusy} aria-pressed={showArchive} onClick={async () => { if (showArchive) { setShowArchive(false); return; } setArchivesBusy(true); try { if (!archivesLoaded) await loadArchives(); setShowArchive(true); } catch (error) { flash({ msg: 'Les archives n’ont pas pu être chargées. ' + error.message, type: 'error' }); } finally { setArchivesBusy(false); } }}>{archivesBusy ? 'Chargement archives…' : showArchive ? 'Archives incluses' : 'Inclure les archives'}</button>}
            <button type="button" className="dossier-toolbar-button" aria-haspopup="dialog" aria-expanded={Boolean(columnOptions?.fromMenu)} aria-controls={columnOptions?.fromMenu ? 'dossier-column-dialog' : undefined} onClick={event => setColumnOptions({ key: null, anchor: event.currentTarget, fromMenu: true })}>Filtres par colonne{Object.keys(columnFilters).length ? ` · ${Object.keys(columnFilters).length}` : ''}</button>
            <button type="button" onClick={() => setShowFilters(false)} className="dossier-text-button">Fermer les filtres</button>
          </div>
        </div>}
        <div className="dossier-meta-row">
          <span role="status" className="dossier-meta-count">{sorted.length} {sorted.length > 1 ? 'dossiers' : 'dossier'}</span>
          {activeFilters.length > 0 && <div role="group" aria-label="Filtres actifs" className="dossier-active-filters">
            {activeFilters.map(filter => <button key={filter.key} type="button" aria-label={`Retirer le filtre ${filter.label}`} onClick={() => setParam(filter.key, null)} className="dossier-filter-chip"><span className="break-words">{filter.label}</span><X size={14} aria-hidden="true" className="shrink-0" /></button>)}
            <button type="button" onClick={clearFilters} className="dossier-text-button">Retirer les filtres</button>
          </div>}
          <span className="dossier-meta-spacer" aria-hidden="true" />
          {sortColumn && <p role="status" className="dossier-meta-sort">Tri : {sortColumn.label} · {dossierTableSortDirectionLabel(sortColumn, sortDir)}{grouped ? ' · dans chaque groupe' : ''}</p>}
          <DossierHorizontalScroll scrollRef={listScrollRef} layoutKey={`${tableView}:${tableStyle.width}:${visibleSignature}:${sorted.length}:${textSize}:${layout}`} />
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
      </header>

      {workError && <div role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Les tâches n’ont pas pu être actualisées. Les dossiers restent consultables.<button onClick={() => refreshWork().catch(() => {})} className="ml-3 min-h-11 font-semibold underline">Recharger les tâches</button></div>}
      {workLoading && <p role="status" className="shrink-0 px-4 py-2 text-sm text-gray-600">Chargement des tâches…</p>}
      {taskScope === 'pool' && !available && <p className="shrink-0 px-4 py-2 text-sm text-gray-700">Vous êtes indisponible. <button onClick={() => navigate('/?preferences=1')} className="min-h-11 font-semibold underline">Modifier ma disponibilité dans Mon travail</button></p>}
      {/* Bulk action bar: the count and « Désélectionner tout » lead; on phones
          the status changes collapse into one native select. */}
      {selectedIds.size > 0 && (
        <div role="group" aria-label="Actions sur la sélection" className="dossier-bulk-bar">
          <span className="dossier-bulk-count">{selectedIds.size} dossier{selectedIds.size > 1 ? 's' : ''} sélectionné{selectedIds.size > 1 ? 's' : ''}</span>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="dossier-text-button dossier-bulk-clear">
            Désélectionner tout
          </button>
          <div className="dossier-bulk-statuses">
            {BULK_STATUSES.map((action) => (
              <button key={action.statut} type="button" disabled={bulkBusy || !can(action.permission)} onClick={() => applyBulkStatus(action.statut)} className="dossier-bulk-button">
                {action.label}
              </button>
            ))}
          </div>
          {/* Choosing never changes a dossier: a keystroke on a closed select
              (arrows, typeahead) fires « change ». The explicit button applies. */}
          <div className="dossier-bulk-picker">
            <select aria-label="Changer le statut" className="dossier-bulk-status-select" value={bulkChoice} disabled={bulkBusy || !BULK_STATUSES.some(action => can(action.permission))}
              onChange={event => setBulkChoice(event.target.value)}>
              <option value="">{bulkBusy ? 'Mise à jour…' : 'Changer le statut…'}</option>
              {BULK_STATUSES.map(action => <option key={action.statut} value={action.statut} disabled={!can(action.permission)}>{action.label}</option>)}
            </select>
            <button type="button" className="dossier-bulk-button" disabled={!bulkChoice || bulkBusy || !can(BULK_STATUSES.find(action => action.statut === bulkChoice)?.permission)}
              onClick={() => { const statut = bulkChoice; setBulkChoice(''); applyBulkStatus(statut); }}>Appliquer</button>
          </div>
          {can('perm_envois_etiquettes') && (
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
            const exportLabel = selectedIds.size === 1 ? 'Exporter le dossier sélectionné' : `Exporter les ${selectedIds.size} dossiers sélectionnés`;
            // The bar names the selection; the button shows « Exporter », and its
            // full name starts with that visible word (WCAG 2.5.3).
            return <button type="button" aria-label={exportLabel} title={exportLabel} onClick={() => exportRows(displayedRows.filter(dossier => selectedIds.has(dossier.id)))} className="dossier-bulk-button">
              Exporter
            </button>;
          })()}
        </div>
      )}

      {/* While « Affichage » is open, its own alert reports the export failure. */}
      {exportError && !displayOpen && <p role="alert" className="px-4 py-2 text-sm text-red-700">{exportError}</p>}
      {/* Main area: table + detail side by side */}
      <div className="flex-1 flex min-h-0">

        {/* Table (scrollable) */}
        <div id="dossier-table-scroll" ref={listScrollRef} role="region" aria-label="Tableau des dossiers" tabIndex={0} className="min-w-0 flex-1 overflow-y-auto overflow-x-auto">

          {(() => {
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
            // Folding is shared by the table and the cards, and remembered for the person.
            const collapsed = group => collapsedGroups.includes(group.key);
            const headerProps = group => ({
              group, collapsed: collapsed(group), checked: group.dossiers.length > 0 && group.dossiers.every((c) => selectedIds.has(c.id)),
              onToggle: () => setCollapsedGroups(previous => previous.includes(group.key) ? previous.filter(key => key !== group.key) : [...previous, group.key]),
              onToggleAll: () => toggleGroup(group),
            });
            const card = c => <DossierTableCard view={tableView} key={c.id} c={c} client={getClient(c.clientId)} model={models.get(c.id)} alerts={alertsByDossier.get(c.id)} columns={displayCols} checked={selectedIds.has(c.id)} onCheck={() => toggleSelection(c.id)} onOpen={action => openTask(c.id, action)} onOpenDossier={() => openDossier(c.id)} returnTo={returnTo} />;
            const tableRow = c => <DossierTableRow key={c.id} c={c} client={getClient(c.clientId)} model={models.get(c.id)} alerts={alertsByDossier.get(c.id)} columns={displayCols} checked={selectedIds.has(c.id)} onCheck={() => toggleSelection(c.id)} onOpen={action => openTask(c.id, action)} onOpenDossier={() => openDossier(c.id)} returnTo={returnTo} />;

            if (groups.length === 0) {
              if (exactReference) return null;
              return <div className="text-center text-sm text-gray-600 px-4 py-8"><p>{!workReady && taskScope !== 'all' ? 'La liste des tâches est indisponible pour le moment.' : taskScope === 'mine' ? 'Aucune tâche ne vous est attribuée dans cette sélection.' : taskScope === 'pool' ? 'Aucune tâche disponible dans cette sélection.' : 'Aucun dossier ne correspond à ces filtres.'}</p>{taskScope !== 'all' && <button onClick={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('tasks'); next.delete('owner'); return next; }, { replace: true })} className="mt-2 min-h-11 px-3 font-semibold brand-t underline">Voir tous les dossiers</button>}{activeFilters.length > 0 && <button onClick={clearFilters} className="min-h-11 mt-2 font-semibold brand-t underline">Retirer les filtres</button>}{search && <button onClick={() => setSearch('')} className="min-h-11 mt-2 px-3 font-semibold brand-t underline">Effacer la recherche</button>}</div>;
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

      </div>
    </div>
  );
}
