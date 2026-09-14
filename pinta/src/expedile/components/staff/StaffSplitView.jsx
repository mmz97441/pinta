import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Search, X, Package, Clock, CheckCircle, Check, Wrench, CreditCard, Plane,
  AlertTriangle, ChevronRight, Star, TrendingUp, Users, BarChart3, FileText, MessageCircle,
  Settings2, AlertCircle, ChevronLeft, CalendarClock, UserCheck,
} from 'lucide-react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, ABONNEMENTS, getDestByCP, getSecteurByCP, getSecteurColor } from '../../constants';
import { eur, fuzzy, labelEnvoi } from '../../utils';
const exportColisExcel = async (...args) => { const exports = await import('../../utils/exportExcel'); return exports.exportColisExcel(...args); };
import { Badge, Etapes } from '../ui';
import StaffDetailView from './StaffDetailView';
import StaffAssignment from './StaffAssignment';
import PersonalWorkView from '../workspace/PersonalWorkView';
import KPIDashboard from './KPIDashboard';
import ColisInfo from '../detail/ColisInfo';
import ReceivedCartons from '../detail/ReceivedCartons';
import FacturesPanel from '../detail/FacturesPanel';
import ChatPanel, { pendingInvoiceAttachments } from '../detail/ChatPanel';
import AuditLog from '../detail/AuditLog';
import { useColisLock } from '../../hooks/useColisLock';
import { WORK_QUEUES, queueContext, matchesWorkQueue, isActiveColis, isClientWaiting, isActionDue, isWaitDue, needsDocuments, nextAction, priorityScore, urgency, matchesOwner } from '../../domain/workQueues';
import { needsConversationAction } from '../../domain/conversations';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import { useDialog } from '../ui/useDialog';
import { receptionCartonManifest } from '../../domain/reception';
import { measureShipment, volumetricDivisor } from '../../domain/quote';
import { findColisByReference, normalizeColisReference } from '../../lib/supabaseData';
const QUEUE_ICONS = { messages: MessageCircle, preparation: Wrench, documents: FileText, waiting: Clock };
const unreadMessages = (colis) => (colis.messages || []).filter((message) => message.type === 'client' && !message.lu);

// ── Pipeline cards (filters) ────────────────────────────────────────────────
const PIPELINE = [
  { key: 'all',         label: 'Tout',            icon: Package,     color: 'var(--brand-text)',  filter: (c) => c.statut !== 'annule' },
  { key: 'reception',   label: 'Réception',       icon: Package,     color: '#F59E0B',   filter: (c) => ['receptionne', 'mesure'].includes(c.statut) },
  { key: 'feuvert',     label: 'Att. feu vert',   icon: Clock,       color: '#F97316',   filter: (c) => c.statut === 'attente_feu_vert' },
  { key: 'feuvert_ok',  label: 'Feu vert OK',     icon: CheckCircle, color: '#65A30D',   filter: (c) => ['autorise', 'en_preparation'].includes(c.statut) },
  { key: 'paiement',    label: 'Att. paiement',   icon: CreditCard,  color: '#D97706',   filter: (c) => ['devis_envoye', 'attente_paiement'].includes(c.statut) },
  { key: 'expedition',  label: 'Expédition',      icon: Plane,       color: '#0891B2',   filter: (c) => ['paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison'].includes(c.statut) },
  { key: 'done',        label: 'Livrés',          icon: Check,       color: '#16A34A',   filter: (c) => c.statut === 'livre' },
];

// ── Statut border color ─────────────────────────────────────────────────────
function statutBorderColor(s) {
  const map = {
    receptionne: '#F59E0B', mesure: '#EAB308', attente_feu_vert: '#F97316',
    autorise: '#22C55E', en_preparation: '#3B82F6', devis_envoye: '#D97706', attente_paiement: '#D97706',
    paye: '#10B981', expedie: '#06B6D4',
    transit: '#0EA5E9', dedouanement: '#8B5CF6', arrive: '#14B8A6',
    livraison: '#84CC16', livre: '#16A34A', annule: '#9CA3AF',
  };
  return map[s] || BRAND.navy;
}

// ── Table styles ────────────────────────────────────────────────────────────
const TH = 'px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap';
const TD = 'px-3 py-3 text-xs whitespace-nowrap';
const usefulDossierDate = c => (c.nextActionSource === 'manual' && c.nextActionAt ? c.nextActionAt : c.statutUpdatedAt || c.dateReception || c.createdAt) || '';
const DASH = null; // Cellule vide au lieu d'un tiret gris (moins de bruit visuel)

// ── Column definitions ──────────────────────────────────────────────────────
const ALL_COLUMNS = [
  { key: 'statut', label: 'Action / étape', defaultOn: true, alwaysOn: true },
  { key: 'client', label: 'Client', sortable: true, defaultOn: true, alwaysOn: true },
  { key: 'ref', label: 'EXP', sortable: true, defaultOn: true, alwaysOn: true },
  { key: 'cartons', label: 'Cartons reçus', defaultOn: true },
  { key: 'referent', label: 'Référent', defaultOn: true },
  { key: 'date', label: 'Date utile', sortable: true, defaultOn: true },
  { key: 'intitule', label: 'Intitulé', defaultOn: false },
  { key: 'paiement', label: 'Paiement', defaultOn: false },
  { key: 'prenom', label: 'Prénom', defaultOn: false },
  { key: 'email', label: 'Email', defaultOn: false },
  { key: 'tel', label: 'Tél.', defaultOn: false },
  { key: 'forfait', label: 'Forfait', defaultOn: false },
  { key: 'volCm3', label: 'Vol. réception cm³', sortable: true, align: 'right', defaultOn: false },
  { key: 'volKg', label: 'Vol. réception kg', align: 'right', defaultOn: false },
  { key: 'poids', label: 'Poids réception', align: 'right', defaultOn: false },
  { key: 'transport', label: 'Transport', sortable: true, align: 'right', defaultOn: false },
  { key: 'taxes', label: 'Taxes', sortable: true, align: 'right', defaultOn: false },
  { key: 'total', label: 'Total', sortable: true, align: 'right', defaultOn: false },
  { key: 'paye', label: 'Payé', align: 'right', defaultOn: false },
  { key: 'commune', label: 'Commune', defaultOn: false },
  { key: 'cp', label: 'CP', defaultOn: false },
];

const LS_COLS_KEY = 'expedile_columns_v2:';
function loadVisibleCols(userId) {
  try {
    const saved = localStorage.getItem(LS_COLS_KEY + userId);
    if (saved) return new Set(JSON.parse(saved));
  } catch {}
  return new Set(ALL_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key));
}

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

// ── Table header row ────────────────────────────────────────────────────────
function ColisTableHead({ visibleCols, onSelectAll, allSelected, onSort, sortCol, sortDir }) {
  const indicator = (col) => onSort ? (sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕') : '';
  // Sticky : colonnes du tableau restent visibles au scroll (au-dessus des lignes)
  const stickyBg = 'bg-slate-50'; // ≈ BRAND.navy + 06% sur blanc
  const thCls = (extra = '') => `${TH} ${stickyBg} sticky top-0 z-[5] ${extra}`;

  return (
    <tr className="border-b border-gray-200">
      <th className={`px-2 py-2 w-8 ${stickyBg} sticky top-0 z-[5]`}>
        <input aria-label="Sélectionner tous les dossiers affichés" type="checkbox" checked={allSelected} onChange={onSelectAll}
          className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer" />
      </th>
      {ALL_COLUMNS.filter((col) => visibleCols.has(col.key)).map((col) => {
        const align = col.align === 'right' ? 'text-right' : '';
        if (col.sortable && onSort) {
          return (
            <th key={col.key} aria-sort={sortCol === (col.key === 'volCm3' ? 'dims' : col.key) ? sortDir === 'asc' ? 'ascending' : 'descending' : 'none'} className={thCls(align)}>
              <button className="min-h-11 text-left" onClick={() => onSort(col.key === 'volCm3' ? 'dims' : col.key)}>{col.label}{indicator(col.key === 'volCm3' ? 'dims' : col.key)}</button>
            </th>
          );
        }
        return <th key={col.key} className={thCls(align)}>{col.label}</th>;
      })}
      <th className={`w-5 ${stickyBg} sticky top-0 z-[5]`}></th>
    </tr>
  );
}

// ── Table data row ──────────────────────────────────────────────────────────
function ColisTableRow({ c, client, prevClient, envois, onClick, isSelected, checked, onCheck, visibleCols, now, ownerName, settings }) {
  const sameClient = false;
  const dim = sameClient ? 'text-gray-300' : '';
  const dest = client ? getDestByCP(client.cp) : null;
  const divisor = volumetricDivisor(settings);
  const weights = measureShipment(receptionCartonManifest(c).dimsParColis, divisor);
  const volCm3 = weights ? weights.volumetricWeight * divisor : null;
  const volKg = weights?.volumetricWeight.toFixed(2);
  const taxes = (c.devisOM != null || c.devisOMR != null || c.devisTVA != null)
    ? ((c.devisOM || 0) + (c.devisOMR || 0) + (c.devisTVA || 0)) : null;
  const usefulDate = usefulDossierDate(c);
  const dateCreation = usefulDate ? new Date(usefulDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : 'À préciser';
  const isPaid = c.paiementMontant > 0;
  const abo = client?.abonnement ? (ABONNEMENTS[client.abonnement]?.label || client.abonnement) : '—';
  const prenom = client?.prenom || client?.nom?.split(' ').slice(0, -1).join(' ') || '';
  const nom = client?.nomFamille || client?.nom?.split(' ').pop() || client?.nom || '—';

  const event = urgency(c, now);
  const isUrgent = event.overdue;

  const cellRenderers = {
    date: () => <div className="text-gray-500"><span>{dateCreation}</span><p className="text-[10px]">{c.nextActionSource === 'manual' && c.nextActionAt ? 'Échéance promise' : 'Étape actuelle'}</p></div>,
    cartons: () => <span>{receptionCartonManifest(c).nbColis}</span>,
    referent: () => <span className="text-gray-600">{ownerName}</span>,
    ref: () => (
      <>
        <button onClick={(e) => { e.stopPropagation(); onClick(); }} className="min-h-11 text-left font-bold text-gray-900 hover:underline">{c.ref}</button>
        {c.casier && <span className="text-[8px] font-bold px-1 py-0.5 rounded ml-1" style={{ background: `${BRAND.gold}22`, color: 'var(--text-accent)' }}>{c.casier}</span>}
        {isUrgent && <span title={event.label} className="ml-1 text-xs font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-800">À revoir</span>}{needsConversationAction(c) && <span className="ml-1 text-xs font-semibold brand-t">À répondre</span>}
        {(() => { const unread = (c.messages || []).filter((m) => m.type === 'client' && !m.lu).length; return unread > 0 ? <span className="ml-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">{unread}</span> : null; })()}
      </>
    ),
    statut: () => <div className="max-w-[220px] whitespace-normal"><p className="mb-1 text-xs font-semibold text-slate-800">{nextAction(c, client, now)}</p><Badge statut={c.statut} /></div>,
    paiement: () => isPaid ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Payé</span> : c.devisTotal ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">En attente</span> : DASH,
    client: () => sameClient ? (
      <span className="text-gray-500 text-xs italic">↑ idem</span>
    ) : (
      <>
        <span className="text-gray-700 font-medium">{`${prenom} ${nom}`.trim()}</span>
        {dest && <span className="ml-1">{dest.flag}</span>}
        {(() => { const s = getSecteurByCP(client?.cp); return s ? <span className="ml-1 text-[7px] font-black px-1 py-0.5 rounded text-white" style={{ background: getSecteurColor(s) }}>{s}</span> : null; })()}
        {client?.abonnement === 'vip' && <span className="ml-1 text-[8px] font-black px-1 py-0.5 rounded" style={{ background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: 'white' }}>VIP</span>}
        {client?.type === 'pro' && client?.abonnement !== 'vip' && <span className="ml-1 text-[8px] font-black px-1 py-0.5 rounded" style={{ background: `${BRAND.gold}30`, color: 'var(--text-accent)' }}>PRO</span>}
      </>
    ),
    prenom: () => sameClient ? null : <span className="text-gray-500">{prenom || ''}</span>,
    email: () => sameClient ? null : <span className="text-gray-500 text-[10px]">{client?.email || ''}</span>,
    tel: () => sameClient ? null : <span className="text-gray-500 text-[10px] font-mono">{client?.tel || ''}</span>,
    forfait: () => sameClient ? null : <span className="text-[9px] font-semibold">{abo === '—' ? '' : abo}</span>,
    intitule: () => <span className="text-gray-600 truncate block max-w-[120px]">{c.desc || '—'}</span>,
    volCm3: () => volCm3 ? <span className="text-gray-500 font-mono text-[10px]">{volCm3.toLocaleString()}</span> : DASH,
    volKg: () => volKg ? <span className="text-gray-500 font-mono text-[10px]">{volKg}</span> : DASH,
    poids: () => weights ? <span className="text-gray-600 font-mono text-[10px]">{weights.realWeight.toFixed(2)} kg</span> : DASH,
    transport: () => c.devisTransport != null ? <span className="font-semibold text-gray-700">{eur(c.devisTransport)}</span> : DASH,
    taxes: () => taxes != null ? <span className="text-gray-600">{eur(taxes)}</span> : DASH,
    total: () => c.devisTotal != null ? <span className="font-bold" style={{ color: 'var(--brand-text)' }}>{eur(c.devisTotal)}</span> : DASH,
    paye: () => c.paiementMontant ? <span className="font-bold text-green-700">{eur(c.paiementMontant)}</span> : DASH,
    commune: () => sameClient ? null : <span className="text-gray-500 text-[10px]">{client?.ville || ''}</span>,
    cp: () => sameClient ? null : <span className="text-gray-500 text-[10px] font-mono">{client?.cp || ''}</span>,
  };

  return (
    <tr
      onClick={onClick}
      className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}

    >
      <td className="px-2 py-2 w-8" onClick={(e) => e.stopPropagation()}>
        <input aria-label={`Sélectionner le dossier ${c.ref}`} type="checkbox" checked={checked} onChange={onCheck}
          className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer" />
      </td>
      {ALL_COLUMNS.filter((col) => visibleCols.has(col.key)).map((col) => (
        <td key={col.key} className={`${TD}${col.align === 'right' ? ' text-right' : ''}`}>
          {cellRenderers[col.key]?.() || DASH}
        </td>
      ))}
      <td className="pr-1 py-2"><ChevronRight size={12} className="text-gray-300" /></td>
    </tr>
  );
}

// ── Group header row (colspan toute la largeur) ─────────────────────────────
function GroupHeaderRow({ icon: Icon, color, label, extraLabel, count, allChecked, onToggleAll, colspan, bgTint }) {
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
            <span className="text-xs font-bold" style={{ color: 'var(--brand-text)' }}>{label}</span>
            {extraLabel && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{extraLabel}</span>}
          </div>
          <span className="text-[10px] font-bold text-gray-400">{count} colis</span>
        </div>
      </td>
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DETAIL SLIDE-OVER
// ════════════════════════════════════════════════════════════════════════════
function DetailSlideOver({ onClose }) {
  const { sel } = useApp();
  if (!sel) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[560px] bg-white shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: statutBorderColor(sel.statut) }} />
            <span className="text-sm font-black" style={{ color: 'var(--brand-text)' }}>{sel.ref}</span>
            <Badge statut={sel.statut} />
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>
        <div className="px-4 pt-3"><Etapes statut={sel.statut} /></div>
        <div className="p-4 space-y-4">
          <StaffDetailView />
          <ColisInfo />
          {sel.statut !== 'en_preparation' && <FacturesPanel />}
          <ChatPanel />
          <AuditLog />
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD PAGE — exported for / route
// ════════════════════════════════════════════════════════════════════════════
export function DashboardPage() { return <PersonalWorkView />; }

// ════════════════════════════════════════════════════════════════════════════
// COLIS PAGE — /colis route: pipeline cards + table + detail slide-over
// ════════════════════════════════════════════════════════════════════════════
export default function StaffColisPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.pathname + location.search;
  const { data, clients, getClient, envois, setSelId, sel, changerStatut, flash, can, auth, loadArchives, archivesLoaded, categories, tarifs, settings, teamUsers = [] } = useApp();
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
  const sortCol = searchParams.get('sort');
  const setSortCol = (value) => setParam('sort', value);
  const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  const setSortDir = (value) => setParam('dir', typeof value === 'function' ? value(sortDir) : value);
  const showArchive = searchParams.get('archive') === '1';
  const setShowArchive = (value) => setParam('archive', value ? '1' : null);
  const [archivesBusy, setArchivesBusy] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const viewMode = ['envoi', 'statut'].includes(searchParams.get('view')) ? searchParams.get('view') : 'priority';
  const setViewMode = (value) => setParam('view', value === 'priority' ? null : value);
  const [navigationOrder, setNavigationOrder] = useState([]);
  const detailScrollRef = useRef(null);
  const [visibleCols, setVisibleCols] = useState(() => loadVisibleCols(auth?.u?.id));
  const [showColPicker, setShowColPicker] = useState(false);
  const [defaultSort, setDefaultSort] = useState(() => loadDefaultSort(auth?.u?.id));
  const [showSortPicker, setShowSortPicker] = useState(false);
  const activeFilters = [
    workFilter && { key: 'work', label: `File : ${WORK_QUEUES.find(item => item.key === workFilter)?.label || 'Sélectionnée'}` },
    clientFilter && { key: 'client', label: `Client : ${getClient(clientFilter)?.nom || 'Sélectionné'}` },
    envoiFilter && { key: 'envoi', label: `Départ : ${envois.find(item => item.id === envoiFilter)?.ref || 'Sélectionné'}` },
    ownerFilter && { key: 'owner', label: `Référent : ${ownerFilter === 'mine' ? 'Mes dossiers' : ownerFilter === 'unassigned' ? 'Non attribués' : teamUsers.find(item => item.authId === ownerFilter)?.nom || 'Sélectionné'}` },
    activeDest && { key: 'dest', label: `Destination : ${getDestByCP(activeDest + '00')?.nom || activeDest}` },
    activeTab !== 'all' && { key: 'tab', label: `Étape : ${PIPELINE.find(item => item.key === activeTab)?.label}` },
  ].filter(Boolean);
  const clearFilters = () => {
    setSelId(null); setShowFilters(false);
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      ['work', 'client', 'envoi', 'owner', 'dest', 'tab', 'archive', 'dossier'].forEach(key => next.delete(key));
      return next;
    }, { replace: true });
  };
  const openReferenceDossier = () => {
    if (lookup.status === 'found') {
      pendingReferenceOpen.current = null;
      navigate(`/colis/${encodeURIComponent(lookup.row.id)}?${new URLSearchParams({ returnTo })}`);
    } else if (lookup.status === 'loading') pendingReferenceOpen.current = { query: search };
  };

  const toggleCol = useCallback((key) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(LS_COLS_KEY + auth?.u?.id, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const changeDefaultSort = useCallback((key) => {
    setDefaultSort(key);
    localStorage.setItem(LS_SORT_KEY + auth?.u?.id, key);
    setShowSortPicker(false);
  }, []);
  const [showFactures, setShowFactures] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [narrowScreen, setNarrowScreen] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => { const query = window.matchMedia('(max-width: 1023px)'); const update = () => setNarrowScreen(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);

  // Verrouillage optimiste — affiche un bandeau si quelqu'un d'autre édite le même colis
  const { lockedBy, isLockedByOther } = useColisLock(sel?.id, auth?.u?.id, auth?.u?.nom);

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
    if (ownerFilter) list = list.filter((c) => (isActiveColis(c) || needsConversationAction(c)) && matchesOwner(c, ownerFilter, auth?.u?.id));
    if (activeDest) list = list.filter((c) => getDestByCP(getClient(c.clientId)?.cp)?.code === activeDest);
    if (search.trim()) list = list.filter((c) => fuzzy(`${c.ref} ${c.desc || ''} ${getClient(c.clientId)?.nom || ''} ${c.casier || ''} ${c.trackings?.join(' ') || ''}`, exactReference || search));
    return list;
  }, [data, showArchive, workFilter, context, clientFilter, envoiFilter, ownerFilter, auth?.u?.id, activeDest, getClient, search, exactReference]);
  const searched = useMemo(() => {
    if (activeTab === 'all' && (workFilter === 'messages' || ownerFilter)) return scope;
    const phase = PIPELINE.find((item) => item.key === activeTab);
    return phase ? scope.filter(phase.filter) : scope;
  }, [scope, activeTab, workFilter, ownerFilter]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortCol) {
      const arr = [...searched];
      switch (defaultSort) {
        case 'priority':
          arr.sort((a, b) => {
            const clA = getClient(a.clientId);
            const clB = getClient(b.clientId);
            return priorityScore(b, clB, now) - priorityScore(a, clA, now);
          });
          break;
        case 'date_desc':
          arr.sort((a, b) => usefulDossierDate(b).localeCompare(usefulDossierDate(a)));
          break;
        case 'date_asc':
          arr.sort((a, b) => usefulDossierDate(a).localeCompare(usefulDossierDate(b)));
          break;
        case 'total_desc':
          arr.sort((a, b) => (b.devisTotal || 0) - (a.devisTotal || 0));
          break;
        case 'total_asc':
          arr.sort((a, b) => (a.devisTotal || 0) - (b.devisTotal || 0));
          break;
        case 'ref_asc':
          arr.sort((a, b) => (a.ref || '').localeCompare(b.ref || '', 'fr', { numeric: true }));
          break;
      }
      return arr;
    }
    const arr = [...searched];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let va, vb;
      switch (sortCol) {
        case 'date': va = usefulDossierDate(a); vb = usefulDossierDate(b); return dir * va.localeCompare(vb);
        case 'client': va = (getClient(a.clientId)?.nom || '').toLowerCase(); vb = (getClient(b.clientId)?.nom || '').toLowerCase(); return dir * va.localeCompare(vb, 'fr');
        case 'ref': return dir * (a.ref || '').localeCompare(b.ref || '', 'fr', { numeric: true });
        case 'statut': return dir * (STATUTS[a.statut]?.label || '').localeCompare(STATUTS[b.statut]?.label || '', 'fr');
        case 'dims': {
          const left = measureShipment(receptionCartonManifest(a).dimsParColis, volumetricDivisor(settings));
          const right = measureShipment(receptionCartonManifest(b).dimsParColis, volumetricDivisor(settings));
          if (!left || !right) return left ? -1 : right ? 1 : 0;
          return dir * (left.volumetricWeight - right.volumetricWeight);
        }
        case 'transport': return dir * ((a.devisTransport || 0) - (b.devisTransport || 0));
        case 'taxes': va = (a.devisOM || 0) + (a.devisOMR || 0) + (a.devisTVA || 0); vb = (b.devisOM || 0) + (b.devisOMR || 0) + (b.devisTVA || 0); return dir * (va - vb);
        case 'total': return dir * ((a.devisTotal || 0) - (b.devisTotal || 0));
        default: return 0;
      }
    });
    return arr;
  }, [searched, sortCol, sortDir, getClient, defaultSort, now, settings]);

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
    { label: 'Attente feu vert', statuts: ['attente_feu_vert'], color: '#F97316', icon: Clock },
    { label: 'Feu vert OK / Préparation', statuts: ['autorise', 'en_preparation'], color: '#65A30D', icon: CheckCircle },
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
    all[phase.key] = scope.filter((c) => phase.key === 'all' && (workFilter === 'messages' || ownerFilter) ? true : phase.filter(c)).length;
    return all;
  }, {}), [scope, workFilter, ownerFilter]);
  const tabUrgences = useMemo(() => PIPELINE.reduce((all, phase) => {
    all[phase.key] = scope.filter(phase.filter).filter((c) => urgency(c, now).overdue).length;
    return all;
  }, {}), [scope, now]);

  const handleSort = (col) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('sort', col);
      next.set('dir', sortCol === col && sortDir === 'asc' ? 'desc' : 'asc');
      return next;
    }, { replace: true });
  };

  const openColis = (id, preserveOrder = false) => {
    if (!preserveOrder) setNavigationOrder(sorted.map((c) => c.id));
    setSelId(id);
    setSearchParams((previous) => { const next = new URLSearchParams(previous); next.set('dossier', id); return next; });
  };
  const closeDetail = useCallback(() => { setSelId(null); setSearchParams((previous) => { const next = new URLSearchParams(previous); next.delete('dossier'); return next; }, { replace: true }); }, [setSelId, setSearchParams]);
  const selectedFromUrl = searchParams.get('dossier');
  useEffect(() => {
    setSelId(selectedFromUrl || null);
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
  }, [selectedFromUrl, setSelId, workFilter]);
  useEffect(() => {
    if (!selectedFromUrl || !navigationOrder.length) setNavigationOrder(sorted.map((c) => c.id));
  }, [selectedFromUrl, sorted, navigationOrder.length]);
  const currentPosition = navigationOrder.indexOf(sel?.id);
  const nextId = currentPosition >= 0 ? navigationOrder.slice(currentPosition + 1).find((id) => sorted.some((c) => c.id === id)) : sorted.find((c) => c.id !== sel?.id)?.id;
  const previousId = currentPosition > 0 ? navigationOrder.slice(0, currentPosition).reverse().find((id) => sorted.some((c) => c.id === id)) : null;
  const mobileDetailRef = useDialog(Boolean(sel) && narrowScreen, closeDetail);
  useEffect(() => { const onKey = (event) => { if (document.activeElement?.closest?.('[role="dialog"]')) return; if (event.key === 'Escape') { if (showColPicker || showSortPicker) { setShowColPicker(false); setShowSortPicker(false); } else if (sel) closeDetail(); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [showColPicker, showSortPicker, sel, closeDetail]);


  return (
    <div className="h-full flex flex-col">

      {workFilter && <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2"><div><h1 className="font-bold text-gray-900">{WORK_QUEUES.find((q) => q.key === workFilter)?.label || 'File de travail'}</h1><p className="text-xs text-gray-500">{clientFilter ? getClient(clientFilter)?.nom : 'Dossiers à traiter ensemble par l’équipe'}</p></div><button onClick={clearFilters} className="text-xs min-h-11 text-gray-500 inline-flex items-center gap-1">Tous les dossiers<X size={14} /></button></div>}
      {workFilter === 'messages' && <div className="px-4 py-3"><button onClick={() => navigate('/conversations')} className="min-h-11 rounded-lg border px-3 text-sm font-semibold">Ouvrir les conversations et messages à rattacher</button></div>}
      <div className="shrink-0 px-4 pt-3 flex flex-wrap items-end gap-3">
        <label className="flex-1 lg:flex-none text-xs font-semibold text-gray-600">File de travail<select aria-label="File de travail" value={workFilter || ''} onChange={(e) => { setSearchParams((old) => { const next = new URLSearchParams(old); next.delete('tab'); next.delete('dossier'); next.delete('archive'); if (e.target.value) next.set('work', e.target.value); else next.delete('work'); return next; }); }} className="mt-1 block min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm"><option value="">Tous les dossiers</option>{WORK_QUEUES.map((queue) => <option key={queue.key} value={queue.key}>{queue.label}</option>)}</select></label>
        <button onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters} className="min-h-11 px-3 rounded-xl border border-gray-200 font-semibold text-sm brand-t">Filtres avancés{activeFilters.length ? ` · ${activeFilters.length} actif(s)` : ''}</button>
        <div className={`${showFilters ? 'flex' : 'hidden'} w-full lg:w-auto flex-wrap items-end gap-3`}>
        <label className="lg:hidden text-xs font-semibold text-gray-600">Étape<select aria-label="Étape" value={activeTab} onChange={(event) => setActiveTab(event.target.value)} className="block mt-1 min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm">{PIPELINE.map((phase) => <option key={phase.key} value={phase.key}>{phase.label} ({tabCounts[phase.key] || 0})</option>)}</select></label>
        <label className="text-xs font-semibold text-gray-600">Référent<select aria-label="Référent" value={ownerFilter} onChange={(e) => setParam('owner', e.target.value)} className="mt-1 block min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm"><option value="">Toute l’équipe</option><option value="mine">Mes dossiers</option><option value="unassigned">Non attribués</option>{teamUsers.filter((user) => user.authId && user.actif !== false).map((user) => <option key={user.authId} value={user.authId}>{user.nom}</option>)}</select></label>
        <label className="text-xs font-semibold text-gray-600">Destination<select aria-label="Destination" value={activeDest || ''} onChange={(e) => setActiveDest(e.target.value)} className="mt-1 block min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm"><option value="">Toutes les destinations</option>{['974', '976', '971', '972'].map((code) => <option key={code} value={code}>{getDestByCP(code + '00').nom}</option>)}</select></label>
        </div>
      </div>
      {activeFilters.length > 0 && <div aria-label="Filtres actifs" className="shrink-0 flex flex-wrap items-center gap-2 px-4 pt-3">
        {activeFilters.map(filter => <button key={filter.key} aria-label={`Retirer le filtre ${filter.label}`} onClick={() => setParam(filter.key, null)} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700"><span className="break-words">{filter.label}</span><X size={14} className="shrink-0" /></button>)}
        <button onClick={clearFilters} className="min-h-11 px-2 text-sm font-semibold brand-t underline">Retirer les filtres</button>
      </div>}
      {/* Top bar: pipeline cards + search */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 space-y-3 border-b border-gray-100 bg-white">
        {/* Pipeline cards — clickable filters (taste-skill : tactile feedback, urgence dot, hover lift) */}
        <div className={`${showFilters ? 'hidden lg:flex' : 'hidden'} gap-2 overflow-x-auto pt-2 pb-1`}>
          {PIPELINE.map((p) => {
            const Icon = p.icon;
            const isActive = activeTab === p.key;
            const count = tabCounts[p.key] || 0;
            const urgent = tabUrgences[p.key] || 0;
            return (
              <button
                key={p.key}
                onClick={() => setActiveTab(p.key)} aria-pressed={isActive}
                className={`relative shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 ease-out active:scale-[0.97] ${
                  isActive
                    ? 'text-white shadow-lg'
                    : 'bg-white border border-slate-200/70 hover:border-slate-300 hover:-translate-y-[1px] hover:shadow-md'
                }`}
                style={isActive
                  ? { background: BRAND.navy, boxShadow: 'var(--shadow-1)' }
                  : { color: 'var(--brand-text)' }
                }
              >
                <Icon size={14} strokeWidth={2.25} />
                <span>{p.label}</span>
                <span
                  className={`font-black text-[11px] px-1.5 py-0.5 rounded-full leading-none transition-colors`}
                  style={isActive
                    ? { background: 'rgba(255,255,255,0.22)' }
                    : { background: 'var(--bg-surface)', color: 'var(--brand-text)' }
                  }
                >
                  {count}
                </span>
                {urgent > 0 && (
                  <span
                    className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-black text-white"
                    style={{ background: '#DC2626', boxShadow: '0 0 0 2px white' }}
                    title={`${urgent} dossier(s) avec échéance dépassée ou étape datée depuis au moins 7 jours`}
                  >
                    {urgent}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search + count */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 basis-56 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              aria-label="Rechercher ou scanner un colis" onKeyDown={(event) => { if (event.key !== 'Enter') return; if (exactReference) openReferenceDossier(); else if (sorted.length === 1) openColis(sorted[0].id); }} placeholder="Rechercher ou scanner : référence, client, casier…"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border border-gray-200 outline-none focus:border-blue-400"
              style={{ color: 'var(--brand-text)' }}
            />
            {search && <button aria-label="Effacer la recherche" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
          </div>
          <span role="status" className="text-xs text-gray-500 font-medium">{sorted.length} dossier(s) affiché(s)</span>
          <button hidden={Boolean(workFilter)} disabled={archivesBusy || Boolean(workFilter)} title={workFilter ? 'Retirez la file de travail pour consulter les archives.' : undefined} aria-pressed={showArchive} onClick={async () => { if (showArchive) { setShowArchive(false); return; } setArchivesBusy(true); try { if (!archivesLoaded) await loadArchives(); setShowArchive(true); } catch (error) { flash({ msg: 'Les archives n’ont pas pu être chargées. ' + error.message, type: 'error' }); } finally { setArchivesBusy(false); } }} className={`min-h-11 px-2 text-xs font-semibold rounded-lg ${showArchive ? 'brand-bg-l brand-t' : 'text-gray-500'}`}>{archivesBusy ? 'Chargement archives…' : showArchive ? 'Archives incluses' : 'Inclure les archives'}</button>
          {/* Export Excel (all visible) */}
          {can('perm_export_colis') && (
            <button
              onClick={() => exportColisExcel(sorted, clients)}
              className="px-2 py-1 rounded-lg text-[10px] font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-all active:scale-95"
            >
              Export
            </button>
          )}

          {/* View mode toggle */}
          <div className="hidden lg:flex items-center gap-1 ml-auto bg-gray-100 rounded-lg p-0.5" aria-label="Regroupement de la liste"><button onClick={() => setViewMode('priority')} aria-pressed={viewMode === 'priority'} className={`min-h-11 px-2.5 rounded-md text-xs font-semibold ${viewMode === 'priority' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>Ordre de traitement</button>
            <button
              aria-pressed={viewMode === 'statut'} onClick={() => setViewMode('statut')}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${viewMode === 'statut' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}
            >
              Par statut
            </button>
            <button
              aria-pressed={viewMode === 'envoi'} onClick={() => setViewMode('envoi')}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${viewMode === 'envoi' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}
            >
              Par envoi
            </button>
          </div>

          {/* Default sort picker */}
          <div className="relative">
            <button
              onClick={() => setShowSortPicker((p) => !p)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${showSortPicker ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
              aria-label="Tri par défaut" aria-expanded={showSortPicker} title="Tri par défaut"
            >
              <span>Tri : {SORT_OPTIONS.find((o) => o.key === defaultSort)?.label.split(' ')[0] || 'Priorité'}</span>
              <ChevronRight size={12} className={`transition-transform ${showSortPicker ? 'rotate-90' : ''}`} />
            </button>
            {showSortPicker && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowSortPicker(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 bg-white rounded-xl shadow-2xl border border-gray-200 p-2 w-72">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 py-1">Tri par défaut</p>
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => changeDefaultSort(opt.key)}
                      className={`w-full text-left px-2 py-2 rounded-lg text-xs transition-colors ${defaultSort === opt.key ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      {defaultSort === opt.key && <Check size={12} className="inline mr-1" />}{opt.label}
                    </button>
                  ))}
                  <p className="text-[9px] text-gray-400 px-2 pt-2 border-t mt-1">Cliquer sur une colonne triable reste prioritaire.</p>
                </div>
              </>
            )}
          </div>

          {/* Column picker */}
          <div className="hidden lg:block relative">
            <button
              onClick={() => setShowColPicker((p) => !p)}
              className={`p-1.5 rounded-lg transition-colors ${showColPicker ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
              aria-label="Colonnes visibles" aria-expanded={showColPicker} title="Colonnes visibles"
            >
              <Settings2 size={15} />
            </button>
            {showColPicker && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowColPicker(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 bg-white rounded-xl shadow-2xl border border-gray-200 p-3 w-56">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Colonnes affichées</p>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {ALL_COLUMNS.map((col) => (
                      <label key={col.key} className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer hover:bg-gray-50 ${col.alwaysOn ? 'opacity-50' : ''}`}>
                        <input
                          type="checkbox"
                          checked={visibleCols.has(col.key)}
                          onChange={() => !col.alwaysOn && toggleCol(col.key)}
                          disabled={col.alwaysOn}
                          className="w-3.5 h-3.5 rounded accent-blue-500"
                        />
                        <span className="text-xs text-gray-700">{col.label}</span>
                        {col.alwaysOn && <span className="text-[8px] text-gray-400 ml-auto">requis</span>}
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const defaults = new Set(ALL_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key));
                      setVisibleCols(defaults);
                      localStorage.setItem(LS_COLS_KEY + auth?.u?.id, JSON.stringify([...defaults]));
                    }}
                    className="mt-2 w-full text-center text-[10px] font-bold text-blue-600 hover:text-blue-800 py-1"
                  >
                    Réinitialiser par défaut
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
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

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex-shrink-0 px-4 py-2 bg-blue-50 border-b border-blue-200 flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-blue-700">{selectedIds.size} colis sélectionné{selectedIds.size > 1 ? 's' : ''}</span>
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
          {can('perm_export_colis') && (
            <button
              onClick={() => {
                const ids = [...selectedIds];
                const colisForExport = ids.map((id) => data.find((c) => c.id === id)).filter(Boolean);
                exportColisExcel(colisForExport, clients);
              }}
              className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all active:scale-95"
            >
              Export Excel
            </button>
          )}
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-[10px] text-blue-500 hover:text-blue-700 font-semibold">
            Désélectionner tout
          </button>
        </div>
      )}

      {/* Main area: table + detail side by side */}
      <div className="flex-1 flex min-h-0">

        {/* Table (scrollable) */}
        <div className={`overflow-y-auto overflow-x-auto ${sel ? 'hidden lg:block flex-1 min-w-0' : 'flex-1'}`}>

          {(() => {
            const groups = viewMode === 'envoi' ? groupedByEnvoi : viewMode === 'statut' ? groupedByStatut : sorted.length ? [{ label: 'Ordre de traitement', icon: Package, color: BRAND.navy, colis: sorted }] : [];
            const totalColspan = visibleCols.size + 2; // checkbox + N colonnes + chevron
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
              return <div className="text-center text-sm text-gray-500 py-8"><p>Aucun dossier ne correspond à ces filtres.</p>{activeFilters.length > 0 && <button onClick={clearFilters} className="min-h-11 mt-2 font-semibold brand-t underline">Retirer les filtres</button>}{search && <button onClick={() => setSearch('')} className="min-h-11 mt-2 px-3 font-semibold brand-t underline">Effacer la recherche</button>}</div>;
            }

            return <>
              <div className="lg:hidden divide-y divide-gray-100 px-4">{sorted.map((c) => { const client = getClient(c.clientId); return <button key={c.id} onClick={() => openColis(c.id)} className="w-full text-left py-4 flex items-start gap-3 min-h-20"><div className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: statutBorderColor(c.statut) }} /><div className="flex-1"><div className="flex items-center justify-between gap-2"><span className="font-bold text-sm brand-t">{c.ref}</span>{needsConversationAction(c) && <span className="text-xs font-semibold brand-t">À répondre</span>}</div><p className="text-sm text-gray-700 mt-1">{client?.nom || 'Client'}</p><p className="text-xs text-gray-500 mt-1">{nextAction(c, client, now)}{c.casier ? ` · ${c.casier}` : ''}</p><p className="text-xs text-gray-500 mt-1">{c.responsibleStaffId ? teamUsers.find((user) => user.authId === c.responsibleStaffId)?.nom || 'Équipe' : 'Non attribué'} · {urgency(c, now).label}</p><p className="text-xs text-gray-500 mt-1 truncate">{c.desc || 'Contenu à préciser'}</p></div><ChevronRight size={17} className="text-gray-400 mt-1 shrink-0" /></button>; })}</div>
              <table className="hidden lg:table w-full text-left">
                <thead>
                  <ColisTableHead
                    visibleCols={visibleCols}
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
                        <GroupHeaderRow
                          {...headerProps}
                          count={group.colis.length}
                          colspan={totalColspan}
                          allChecked={allInGroupSelected(group)}
                          onToggleAll={() => toggleGroup(group)}
                        />
                        {group.colis.map((c, idx) => {
                          const prevC = idx > 0 ? group.colis[idx - 1] : null;
                          const prevCl = prevC ? getClient(prevC.clientId) : null;
                          return (
                            <ColisTableRow
                              key={c.id}
                              c={c}
                              settings={settings}
                              client={getClient(c.clientId)}
                              prevClient={prevCl}
                              envois={envois}
                              onClick={() => openColis(c.id)}
                              now={now} ownerName={c.responsibleStaffId ? teamUsers.find((user) => user.authId === c.responsibleStaffId)?.nom || 'Équipe' : 'Non attribué'} isSelected={sel?.id === c.id}
                              visibleCols={visibleCols}
                              checked={selectedIds.has(c.id)}
                              onCheck={() => setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(c.id)) next.delete(c.id);
                                else next.add(c.id);
                                return next;
                              })}
                            />
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </>;
          })()}
        </div>

        {/* Detail panel (inline, right side) */}
        {sel && (() => {
          const clDetail = getClient(sel.clientId);
          const destDetail = clDetail ? getDestByCP(clDetail.cp) : null;
          const unreadCount = (sel.messages || []).filter((m) => m.type === 'client' && !m.lu).length;
          const facturesSummary = sel.factures || [];
          const pendingDocumentCount = pendingInvoiceAttachments(sel).length;
          const validCount = facturesSummary.filter((f) => f.valide).length;
          const rejetCount = facturesSummary.filter((f) => f.rejetMotif).length;
          const receptionManifest = receptionCartonManifest(sel);
          const receptionWeights = measureShipment(receptionManifest.dimsParColis, volumetricDivisor(settings));
          const finalWeights = measureShipment([{ dimL: sel.finL, dimW: sel.finW, dimH: sel.finH, poids: sel.finP }], volumetricDivisor(settings));
          return (
          <div ref={(element) => { detailScrollRef.current = element; mobileDetailRef.current = element; }} role={narrowScreen ? 'dialog' : 'region'} aria-modal={narrowScreen ? true : undefined} tabIndex={-1} aria-label={`Dossier ${sel.ref}`} className={`fixed inset-0 z-[60] lg:relative lg:inset-auto lg:z-10 w-full lg:w-[500px] 2xl:w-[560px] flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]`}>
            {/* Compact header */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-3 py-2 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: statutBorderColor(sel.statut) }} />
                <span className="text-sm font-black" style={{ color: 'var(--brand-text)' }}>{sel.ref}</span>
                <Badge statut={sel.statut} />
                {sel.devisTotal > 0 && <span className="text-xs font-bold" style={{ color: 'var(--brand-text)' }}>{eur(sel.devisTotal)}</span>}
              </div>
              <div className="flex items-center gap-1">
                {/* Chat toggle */}
                <div className="relative group">
                  <button
                    aria-label="Ouvrir la conversation client" onClick={() => navigate(`/conversations?${new URLSearchParams({ dossier: sel.id, returnTo })}`)}
                    className="min-h-11 min-w-11 flex items-center justify-center rounded-lg relative text-slate-600 hover:bg-slate-100"
                  >
                    <MessageCircle size={16} />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 text-[8px] font-bold px-1 py-0.5 rounded-full bg-red-500 text-white min-w-[14px] text-center leading-none">{unreadCount}</span>
                    )}
                  </button>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-lg text-[10px] font-bold text-white bg-gray-800 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {unreadCount > 0 ? `Chat (${unreadCount} non lu${unreadCount > 1 ? 's' : ''})` : 'Chat client'}
                  </span>
                </div>
                <div className="relative group">
                  <button aria-label="Fermer le dossier" onClick={closeDetail} className="min-w-11 min-h-11 flex items-center justify-center p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                    <X size={18} />
                  </button>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-lg text-[10px] font-bold text-white bg-gray-800 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    Fermer
                  </span>
                </div>
              </div>
            </div>

            <nav aria-label="Parcourir cette file" className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
              <button disabled={!previousId} onClick={() => openColis(previousId, true)} className="min-h-11 px-2 flex items-center gap-1 text-xs font-semibold brand-t disabled:opacity-40"><ChevronLeft size={16} />Précédent</button>
              <span className="flex-1 text-center text-xs text-gray-500">{sorted.some((c) => c.id === sel.id) ? `${currentPosition + 1} / ${navigationOrder.length}` : 'Dossier sorti de cette file'}</span>
              <button disabled={!nextId} onClick={() => openColis(nextId, true)} className="min-h-11 px-2 flex items-center gap-1 text-xs font-semibold brand-t disabled:opacity-40">Dossier suivant<ChevronRight size={16} /></button>
            </nav>
            {/* Lock warning banner */}
            {isLockedByOther && (
              <div className="mx-4 mt-2 px-3 py-2 rounded-xl flex items-center gap-2"
                style={{ background: '#FEF3C7', border: '2px solid #F59E0B' }}>
                <AlertTriangle size={17} className="text-amber-700 shrink-0" />
                <p className="text-xs font-bold text-amber-800">{lockedBy} consulte ce dossier. La consultation ne vaut pas prise en charge.</p>
              </div>
            )}

            {/* Client + colis summary — compact inline */}
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold" style={{ color: 'var(--brand-text)' }}>{clDetail?.nom || '—'}</span>
                  {destDetail && <span>{destDetail.flag}</span>}
                  {clDetail?.abonnement && clDetail.abonnement !== 'freemium' && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ABONNEMENTS[clDetail.abonnement]?.couleur || ''}`}>
                      {ABONNEMENTS[clDetail.abonnement]?.label}
                    </span>
                  )}
                  {sel.casier && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${BRAND.gold}22`, color: 'var(--text-accent)' }}>{sel.casier}</span>}
                </div>
                <div className="text-right">
                  {finalWeights ? (
                    <span className="text-[10px] text-gray-500 font-mono">Après optimisation : {sel.finL}×{sel.finW}×{sel.finH} cm · {sel.finP} kg</span>
                  ) : receptionWeights ? (
                    <span className="text-[10px] text-gray-500 font-mono">Réception : {receptionManifest.nbColis} carton(s) · {receptionWeights.realWeight.toFixed(2)} kg</span>
                  ) : <span className="text-xs text-gray-500">Mesures à réception incomplètes</span>}
                </div>
              </div>
              <p className="text-xs text-gray-600">{sel.desc || '—'} · {receptionManifest.nbColis} carton{receptionManifest.nbColis > 1 ? 's' : ''}</p>
            </div>

            {/* Receipt cartons stay visible before workflow actions; preparation can fold them away. */}
            <div className="px-4 pb-4 space-y-3">
              <details key={`${sel.id}:${sel.statut}`} open={sel.statut !== 'en_preparation'} className="rounded-xl border border-gray-200 bg-white px-3">
                <summary className="min-h-11 py-3 cursor-pointer text-sm font-bold text-gray-800">Cartons reçus ({receptionManifest.nbColis})</summary>
                <div className="pb-3"><ReceivedCartons colis={sel} settings={settings} /></div>
              </details>
              <button onClick={() => navigate(`/colis/${encodeURIComponent(sel.id)}?${new URLSearchParams({ returnTo })}`)} className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Préparer et établir le devis</button>
              {sel.statut === 'en_preparation' ? <StaffAssignment /> : <StaffDetailView />}


              {/* Factures — part of the preparation workspace when active. */}
              {sel.statut !== 'en_preparation' && <><button
                onClick={() => setShowFactures((p) => !p)}
                aria-expanded={showFactures}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2 text-left">
                  <FileText size={13} className="text-gray-400" />
                  <span className="text-xs font-bold text-gray-600">Factures ({facturesSummary.length}){pendingDocumentCount > 0 ? ` · ${pendingDocumentCount} document${pendingDocumentCount > 1 ? 's' : ''} reçu${pendingDocumentCount > 1 ? 's' : ''} à vérifier` : ''}</span>
                  {validCount > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">{validCount} validée{validCount > 1 ? 's' : ''}</span>}
                  {rejetCount > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600">{rejetCount} refusée{rejetCount > 1 ? 's' : ''}</span>}
                  {facturesSummary.length === 0 && pendingDocumentCount === 0 && <span className="text-[9px] font-bold text-red-500">Manquante</span>}
                </div>
                <span className="text-[10px] text-gray-400">{showFactures ? '▼' : '▸'}</span>
              </button>
              {showFactures && <FacturesPanel />}</>}

              {/* Historique — collapsed */}
              <button
                onClick={() => setShowHistory((p) => !p)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors"
              >
                <span className="text-xs font-bold text-gray-600">Historique</span>
                <span className="text-[10px] text-gray-400">{showHistory ? '▼' : '▸'}</span>
              </button>
              {showHistory && <AuditLog />}
            </div>

          </div>
          );
        })()}
      </div>
    </div>
  );
}
