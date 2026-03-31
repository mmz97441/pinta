import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, X, BarChart3, CircleDot, Clock, CheckCircle, Check,
  ChevronRight, AlertTriangle, Filter, Package, Download,
  User, UserPlus, Ruler, Wrench, CreditCard, Plane, Star,
  Hash, Layers, CalendarDays, FileSpreadsheet, FileText,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, STATUT_ENVOI, ABONNEMENTS, getDestByCP } from '../../constants';
import { eur, labelEnvoi, trackStr, trackCount, hasTrack, searchGlobal, fuzzy } from '../../utils';
import { Badge, ViewToggle } from '../ui';
import { exportColisExcel } from '../../utils/exportExcel';
import { exportFactureCommerciale } from '../../utils/exportFactureCommerciale';
import { exportDAUData } from '../../utils/exportDAU';
import { exportFactureCommerciPDF } from '../../utils/exportFactureCommerciPDF';
import { exportRecapProExcel } from '../../utils/exportRecapPro';
import KPIDashboard from './KPIDashboard';

// ── Statut groups ──────────────────────────────────────────────────────────────
const STATUTS_A_FAIRE = [
  'receptionne', 'mesure', 'autorise',
  'en_preparation', 'paye', 'expedie', 'transit', 'arrive', 'livraison',
];
const STATUTS_ATTENTE = ['attente_feu_vert', 'devis_envoye', 'attente_paiement'];
const STATUTS_LIVRE = ['livre'];
const STATUTS_PRETS_EXPEDIES = ['paye', 'expedie', 'transit', 'arrive', 'livraison', 'livre'];

// ── Summary card definitions ─────────────────────────────────────────────────
const STATUTS_FEU_VERT_OK = ['autorise', 'en_preparation'];
const STATUTS_ATTENTE_FV = ['attente_feu_vert'];

const SUMMARY_CARDS = [
  { key: 'afaire', label: 'À traiter', statuts: STATUTS_A_FAIRE, color: BRAND.navy, icon: CircleDot },
  { key: 'attente_fv', label: 'Att. feu vert', statuts: ['attente_feu_vert'], color: '#F97316', icon: Clock },
  { key: 'feuvert', label: 'Feu vert OK', statuts: STATUTS_FEU_VERT_OK, color: '#65A30D', icon: CheckCircle },
  { key: 'attente_paie', label: 'Att. paiement', statuts: ['devis_envoye', 'attente_paiement'], color: '#D97706', icon: CreditCard },
  { key: 'expedies', label: 'Prêts / Expédiés', statuts: STATUTS_PRETS_EXPEDIES, color: '#059669', icon: Plane },
];

// ── Pipeline definition ────────────────────────────────────────────────────────
const PIPELINE = [
  {
    key: 'reception',
    label: 'Réception',
    icon: Package,
    statuts: ['receptionne', 'mesure'],
    color: BRAND.navy,
  },
  {
    key: 'attente',
    label: 'Att. client',
    icon: Clock,
    statuts: ['attente_feu_vert', 'devis_envoye', 'attente_paiement'],
    color: '#D97706',
  },
  {
    key: 'preparation',
    label: 'Prép.',
    icon: Wrench,
    statuts: ['autorise', 'en_preparation'],
    color: '#2563EB',
  },
  {
    key: 'paiement',
    label: 'Paiement',
    icon: CreditCard,
    statuts: ['paye'],
    color: '#059669',
  },
  {
    key: 'expedition',
    label: 'Expédition',
    icon: Plane,
    statuts: ['expedie', 'transit', 'dedouanement', 'arrive', 'livraison'],
    color: '#0891B2',
  },
  {
    key: 'livre',
    label: 'Livrés',
    icon: CheckCircle,
    statuts: ['livre'],
    color: '#16A34A',
  },
];

// ── Icon per statut ─────────────────────────────────────────────────────────
function statutIcon(statut) {
  const map = {
    receptionne: Package,
    mesure: Ruler,
    attente_feu_vert: Clock,
    autorise: CheckCircle,
    refuse_client: X,
    en_preparation: Wrench,
    devis_envoye: Star,
    attente_paiement: CreditCard,
    paye: CreditCard,
    expedie: Plane,
    transit: Plane,
    dedouanement: Clock,
    arrive: CircleDot,
    livraison: CircleDot,
    livre: CheckCircle,
  };
  return map[statut] || CircleDot;
}

// ── Small dimension display ──────────────────────────────────────────────────
function DimsChip({ c }) {
  const hasDims = c.dimL && c.dimW && c.dimH && c.poids;
  if (!hasDims) return <span className="text-xs text-gray-400 italic">dims manquantes</span>;
  return (
    <span className="text-xs text-gray-500 font-mono">
      {c.dimL}×{c.dimW}×{c.dimH} cm · {c.poids} kg
    </span>
  );
}

// ── Statut card colors ──────────────────────────────────────────────────────
function statutCardStyle(statut) {
  const map = {
    receptionne:        { bg: '#FFFBEB', border: '#F59E0B', icon: '#D97706' },
    mesure:             { bg: '#FEF9C3', border: '#EAB308', icon: '#CA8A04' },
    attente_feu_vert:   { bg: '#FFF7ED', border: '#F97316', icon: '#EA580C' },
    autorise:           { bg: '#F7FEE7', border: '#84CC16', icon: '#65A30D' },
    refuse_client:      { bg: '#FEF2F2', border: '#EF4444', icon: '#DC2626' },
    en_preparation:     { bg: '#EFF6FF', border: '#3B82F6', icon: '#2563EB' },
    devis_envoye:       { bg: '#FFFBEB', border: '#D97706', icon: '#B45309' },
    attente_paiement:   { bg: '#FDF4FF', border: '#C026D3', icon: '#A21CAF' },
    paye:               { bg: '#EEF2FF', border: '#6366F1', icon: '#4F46E5' },
    expedie:            { bg: '#ECFEFF', border: '#06B6D4', icon: '#0891B2' },
    transit:            { bg: '#F0F9FF', border: '#0EA5E9', icon: '#0284C7' },
    dedouanement:       { bg: '#EDE9FE', border: '#8B5CF6', icon: '#7C3AED' },
    arrive:             { bg: '#F0FDFA', border: '#14B8A6', icon: '#0D9488' },
    livraison:          { bg: '#ECFDF5', border: '#10B981', icon: '#059669' },
    livre:              { bg: '#F0FDF4', border: '#16A34A', icon: '#15803D' },
    annule:             { bg: '#F9FAFB', border: '#9CA3AF', icon: '#6B7280' },
  };
  return map[statut] || { bg: '#FFFFFF', border: BRAND.navy, icon: BRAND.navy };
}

// ── Colis card ───────────────────────────────────────────────────────────────
function ColisCard({ c, client, envois, onClick, stagger }) {
  const StatutIco = statutIcon(c.statut);
  const envoi = envois.find((e) => e.id === c.envoi);
  const dest = getDestByCP(client?.cp);
  const missingFacture = c.factures && c.factures.some((f) => !f.valide);
  const scs = statutCardStyle(c.statut);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3.5 rounded-2xl border anim-fade stagger-${Math.min(stagger, 8)} group transition-all hover:shadow-md`}
      style={{
        background: scs.bg,
        borderColor: `${scs.border}40`,
        borderLeft: `3.5px solid ${scs.border}`,
      }}
    >
      <div className="flex items-start gap-3">
        {/* Icon col */}
        <div
          className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `${scs.border}18` }}
        >
          <StatutIco size={16} style={{ color: scs.icon }} strokeWidth={2} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Row 1: ref + casier + badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-xs font-black tracking-tight"
              style={{ color: BRAND.navy, letterSpacing: '-0.01em' }}
            >
              {c.ref}
            </span>
            {c.casier && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: `${BRAND.gold}22`, color: BRAND.goldD }}
              >
                {c.casier}
              </span>
            )}
            <Badge statut={c.statut} />
            {missingFacture && (
              <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
            )}
          </div>

          {/* Row 2: client + dest + description */}
          <div className="mt-1.5 flex items-center gap-1.5">
            <User size={11} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-600 font-medium truncate">{client?.nom ?? '—'}</span>
            {dest && (
              <span className="text-xs text-gray-400 flex-shrink-0">{dest.flag}</span>
            )}
            {c.desc && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-500 truncate">{c.desc}</span>
              </>
            )}
          </div>

          {/* Row 3: metadata (date · dims · tracking · envoi) */}
          <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px] text-gray-400">
            {c.dateReception && (
              <span className="font-medium">
                {new Date(c.dateReception).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
              </span>
            )}
            {c.dateReception && (c.dimL || hasTrack(c) || envoi) && <span>·</span>}
            <DimsChip c={c} />
            {hasTrack(c) && (
              <>
                <span>·</span>
                <span className="font-mono truncate max-w-[140px]">
                  {trackCount(c) > 1
                    ? `${trackCount(c)} trackings`
                    : trackStr(c)}
                </span>
              </>
            )}
            {envoi && (
              <span
                className="font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
              >
                {labelEnvoi(envoi)}
              </span>
            )}
          </div>
        </div>

        {/* Arrow */}
        <ChevronRight
          size={16}
          className="flex-shrink-0 mt-1 text-gray-300 group-hover:text-gray-500 transition-colors"
        />
      </div>
    </button>
  );
}

// ── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, label, count, color }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div
        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}18` }}
      >
        <Icon size={13} style={{ color }} strokeWidth={2.5} />
      </div>
      <span className="text-sm font-bold text-gray-800">{label}</span>
      <span
        className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
        style={{ background: `${color}18`, color }}
      >
        {count}
      </span>
    </div>
  );
}

// ── Colis table row (for column view) ────────────────────────────────────────
function ColisTableRow({ c, client, envois, onClick, stagger }) {
  const envoi = envois.find((e) => e.id === c.envoi);
  const dest = client ? getDestByCP(client.cp) : null;
  const hasDims = c.dimL && c.dimW && c.dimH && c.poids;
  const scs = statutCardStyle(c.statut);
  const taxes = (c.devisOM != null || c.devisOMR != null || c.devisTVA != null)
    ? ((c.devisOM || 0) + (c.devisOMR || 0) + (c.devisTVA || 0))
    : null;

  const trackings = c.trackings?.filter((t) => t) || [];
  const nbCartons = trackings.length || 1;

  return (
    <tr
      onClick={onClick}
      className="anim-fade border-b border-gray-50 last:border-b-0 cursor-pointer transition-colors hover:bg-gray-50 active:bg-gray-100"
      style={{
        animationDelay: `${stagger * 0.03}s`,
        borderLeft: `3px solid ${scs.border}`,
      }}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-600 font-medium truncate max-w-[120px]">{client?.nom ?? '—'}</span>
          {dest && <span className="text-xs flex-shrink-0">{dest.flag}</span>}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="font-black text-xs text-gray-900">{c.ref}</span>
          {c.casier && (
            <span
              className="text-[9px] font-bold px-1 py-0.5 rounded"
              style={{ background: `${BRAND.gold}22`, color: BRAND.goldD }}
            >
              {c.casier}
            </span>
          )}
          {nbCartons > 1 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
              {nbCartons} cartons
            </span>
          )}
          {(() => {
            const unread = (c.messages || []).filter((m) => m.type === 'client' && !m.lu).length;
            if (unread === 0) return null;
            return (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white animate-pulse">
                {unread} msg
              </span>
            );
          })()}
        </div>
        {c.desc && <span className="text-[11px] text-gray-500 truncate block max-w-[130px]">{c.desc}</span>}
      </td>
      <td className="px-3 py-2.5">
        {c.factures && c.factures.length > 0 ? (
          c.factures.every((f) => f.valide) ? (
            <Check size={14} className="text-green-500" />
          ) : (
            <AlertTriangle size={14} className="text-amber-500" />
          )
        ) : (
          <span className="text-[10px] font-bold text-red-500">Manquante</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <Badge statut={c.statut} />
      </td>
      <td className="px-3 py-2.5">
        {hasDims ? (
          <span className="text-[11px] text-gray-500 font-mono whitespace-nowrap">{c.dimL}×{c.dimW}×{c.dimH} cm · {c.poids} kg</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {c.devisTransport != null ? (
          <span className="text-xs font-semibold text-gray-700">{eur(c.devisTransport)}</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {taxes != null ? (
          <span className="text-xs text-gray-600">{eur(taxes)}</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {c.devisTotal != null ? (
          <span className="text-sm font-bold" style={{ color: BRAND.navy }}>{eur(c.devisTotal)}</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {envoi ? (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
            style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
          >
            {labelEnvoi(envoi)}
          </span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>
      <td className="pr-2 py-2.5">
        <ChevronRight size={14} className="text-gray-300" />
      </td>
    </tr>
  );
}

const TH = 'px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500';

function ColisTable({ items, getClient, envois, openColis, filterFn, sortCol, sortDir, onSort }) {
  const filtered = filterFn ? filterFn(items) : items;

  const sorted = useMemo(() => {
    if (!sortCol || !onSort) return filtered;
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let va, vb;
      switch (sortCol) {
        case 'client': {
          const ca = getClient(a.clientId);
          const cb = getClient(b.clientId);
          va = (ca?.nom || '').toLowerCase();
          vb = (cb?.nom || '').toLowerCase();
          return dir * va.localeCompare(vb, 'fr');
        }
        case 'ref':
          return dir * (a.ref || '').localeCompare(b.ref || '', 'fr', { numeric: true });
        case 'statut':
          return dir * (STATUTS[a.statut]?.label || '').localeCompare(STATUTS[b.statut]?.label || '', 'fr');
        case 'dims':
          va = a.dimL || 0;
          vb = b.dimL || 0;
          return dir * (va - vb);
        case 'transport':
          va = a.devisTransport || 0;
          vb = b.devisTransport || 0;
          return dir * (va - vb);
        case 'taxes':
          va = (a.devisOM || 0) + (a.devisOMR || 0) + (a.devisTVA || 0);
          vb = (b.devisOM || 0) + (b.devisOMR || 0) + (b.devisTVA || 0);
          return dir * (va - vb);
        case 'total':
          va = a.devisTotal || 0;
          vb = b.devisTotal || 0;
          return dir * (va - vb);
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sortCol, sortDir, getClient]);

  const sortIndicator = (col) => {
    if (!onSort) return '';
    return sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕';
  };
  const thSort = (col) => onSort ? { onClick: () => onSort(col), className: `${TH} cursor-pointer hover:text-gray-700 select-none` } : { className: TH };
  const thSortRight = (col) => onSort ? { onClick: () => onSort(col), className: `${TH} text-right cursor-pointer hover:text-gray-700 select-none` } : { className: `${TH} text-right` };

  return (
    <div className="card rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100" style={{ backgroundColor: BRAND.navy + '08' }}>
              <th {...thSort('client')}>Client{sortIndicator('client')}</th>
              <th {...thSort('ref')}>N° Colis{sortIndicator('ref')}</th>
              <th className={TH}>Facture</th>
              <th {...thSort('statut')}>Statut{sortIndicator('statut')}</th>
              <th {...thSort('dims')}>Dimensions{sortIndicator('dims')}</th>
              <th {...thSortRight('transport')}>Transport{sortIndicator('transport')}</th>
              <th {...thSortRight('taxes')}>Taxes{sortIndicator('taxes')}</th>
              <th {...thSortRight('total')}>Total{sortIndicator('total')}</th>
              <th className={TH}>Envoi</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-6 text-center text-sm text-gray-400">Aucun résultat</td></tr>
            ) : sorted.map((c, i) => (
              <ColisTableRow
                key={c.id}
                c={c}
                client={getClient(c.clientId)}
                envois={envois}
                stagger={i}
                onClick={() => openColis(c.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function StaffDashboard({ onNewColis }) {
  const navigate = useNavigate();
  const { data, clients, envois, categories, getClient, isStaff, authRole, page, flash } = useApp();

  const [globalSearch, setGlobalSearch] = useState('');
  const [envoiFilter, setEnvoiFilter] = useState('ALL');
  const [activeCard, setActiveCard] = useState(null);
  const [pipeFilter, setPipeFilter] = useState(null);
  const [showEnvoiFilter, setShowEnvoiFilter] = useState(false);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [viewMode, setViewMode] = useState('status'); // 'status' | 'numero'
  const [displayMode, setDisplayMode] = useState('columns'); // 'cards' | 'columns'
  const [tableSearch, setTableSearch] = useState('');
  const [showAllMissing, setShowAllMissing] = useState(false);
  const [showKPI, setShowKPI] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportCols, setExportCols] = useState({
    client: true, statut: true, description: true, dims: true, poids: true,
    transport: true, taxes: true, total: true, dateReception: true, casier: true,
    envoi: true, fournisseurs: true,
  });

  // ── Search results ────────────────────────────────────────────────────────
  const searchResults = useMemo(
    () => searchGlobal(clients, data, globalSearch),
    [clients, data, globalSearch],
  );
  const hasSearch = globalSearch.trim().length > 0;
  const hasResults = hasSearch && (searchResults.clients.length > 0 || searchResults.colis.length > 0);

  // ── Filtered pool by envoi ────────────────────────────────────────────────
  const envoiFiltered = useMemo(() => {
    if (envoiFilter === 'ALL') return data;
    if (envoiFilter === 'NONE') return data.filter((c) => !c.envoi);
    return data.filter((c) => c.envoi === envoiFilter);
  }, [data, envoiFilter]);

  // ── Active card definition ──────────────────────────────────────────────
  const activeCardDef = useMemo(
    () => SUMMARY_CARDS.find((c) => c.key === activeCard) ?? null,
    [activeCard],
  );

  // ── Filtered pool by card + sub-filter ─────────────────────────────────
  const filterStatuts = useMemo(() => {
    if (pipeFilter) return pipeFilter.split(',').map((s) => s.trim());
    if (activeCardDef) return activeCardDef.statuts;
    return null;
  }, [pipeFilter, activeCardDef]);

  const activePool = useMemo(() => {
    if (!filterStatuts) return envoiFiltered;
    return envoiFiltered.filter((c) => filterStatuts.includes(c.statut));
  }, [envoiFiltered, filterStatuts]);

  // ── Main lists (sorted by statut order within each group) ────────────────
  const sortByStatut = (list, order) =>
    [...list].sort((a, b) => order.indexOf(a.statut) - order.indexOf(b.statut));

  const aFaire = useMemo(
    () => sortByStatut(activePool.filter((c) => STATUTS_A_FAIRE.includes(c.statut)), STATUTS_A_FAIRE),
    [activePool],
  );
  const attente = useMemo(
    () => sortByStatut(activePool.filter((c) => STATUTS_ATTENTE.includes(c.statut)), STATUTS_ATTENTE),
    [activePool],
  );
  const livres = useMemo(
    () => sortByStatut(activePool.filter((c) => STATUTS_LIVRE.includes(c.statut)), STATUTS_LIVRE),
    [activePool],
  );

  // ── Summary counts (always from full data, not filtered) ──────────────────
  const totalAFaire = useMemo(
    () => data.filter((c) => STATUTS_A_FAIRE.includes(c.statut)).length,
    [data],
  );
  const totalAttenteFV = useMemo(
    () => data.filter((c) => STATUTS_ATTENTE_FV.includes(c.statut)).length,
    [data],
  );
  const totalAttentePaie = useMemo(
    () => data.filter((c) => ['devis_envoye', 'attente_paiement'].includes(c.statut)).length,
    [data],
  );
  const totalFeuVert = useMemo(
    () => data.filter((c) => STATUTS_FEU_VERT_OK.includes(c.statut)).length,
    [data],
  );
  const totalPretExpedies = useMemo(
    () => data.filter((c) => ['paye', 'expedie', 'transit', 'arrive', 'livraison', 'livre'].includes(c.statut)).length,
    [data],
  );
  const totalAll = useMemo(
    () => data.filter((c) => c.statut !== 'annule').length,
    [data],
  );

  // ── Sub-pipeline chips for active card ──────────────────────────────────
  const subPipelineChips = useMemo(() => {
    if (!activeCardDef) return [];
    return PIPELINE
      .map((p) => ({
        ...p,
        statuts: p.statuts.filter((s) => activeCardDef.statuts.includes(s)),
      }))
      .filter((p) => p.statuts.length > 0)
      .map((p) => ({
        ...p,
        count: envoiFiltered.filter((c) => p.statuts.includes(c.statut)).length,
      }));
  }, [activeCardDef, envoiFiltered]);

  // ── Sorted flat list for "numero" view mode ─────────────────────────────
  const sortedByNumero = useMemo(() => {
    return [...activePool]
      .filter((c) => c.statut !== 'annule')
      .sort((a, b) => a.ref.localeCompare(b.ref, 'fr', { numeric: true }));
  }, [activePool]);

  // ── Grouped by envoi for "envoi" view mode ─────────────────────────────
  const groupedByEnvoi = useMemo(() => {
    const pool = activePool.filter((c) => c.statut !== 'annule');
    const groups = [];
    const byEnvoi = {};
    const sansEnvoi = [];

    pool.forEach((c) => {
      if (c.envoi) {
        if (!byEnvoi[c.envoi]) byEnvoi[c.envoi] = [];
        byEnvoi[c.envoi].push(c);
      } else {
        sansEnvoi.push(c);
      }
    });

    // Sort envois by date (most recent first)
    const sortedEnvois = [...envois]
      .filter((e) => byEnvoi[e.id])
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    sortedEnvois.forEach((e) => {
      groups.push({ envoi: e, colis: byEnvoi[e.id] });
    });

    if (sansEnvoi.length > 0) {
      groups.push({ envoi: null, colis: sansEnvoi });
    }

    return groups;
  }, [activePool, envois]);

  // ── Table search filter ────────────────────────────────────────────────
  const filterByTableSearch = useMemo(() => {
    if (!tableSearch.trim()) return null;
    return (list) => list.filter((c) => {
      const cl = getClient(c.clientId);
      const trackingsStr = c.trackings?.join(' ') || '';
      const fournisseurs = (c.trackingsDetail || []).map((td) => td.fournisseur).join(' ');
      const txt = `${c.ref} ${c.desc || ''} ${cl?.nom || ''} ${c.casier || ''} ${trackingsStr} ${fournisseurs}`;
      return fuzzy(txt, tableSearch);
    });
  }, [tableSearch, getClient]);

  // ── Missing invoices (all active colis without validated facture) ──────────
  const missingInvoices = useMemo(
    () => data.filter((c) => {
      if (c.statut === 'annule' || c.statut === 'livre') return false;
      const hasValid = c.factures && c.factures.length > 0 && c.factures.some((f) => f.valide);
      return !hasValid;
    }),
    [data],
  );

  // ── Colis en feu vert SANS facture (relance prioritaire) ─────────────────
  const feuVertSansFacture = useMemo(
    () => data.filter((c) => {
      if (!['attente_feu_vert', 'autorise', 'en_preparation'].includes(c.statut)) return false;
      const hasValid = c.factures && c.factures.length > 0 && c.factures.some((f) => f.valide);
      return !hasValid;
    }),
    [data],
  );

  // ── Expiring subscriptions ─────────────────────────────────────────────
  const expiringClients = useMemo(() => {
    const now = new Date();
    const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return clients.filter((cl) => {
      if (!cl.abonnement || cl.abonnement === 'freemium') return false;
      if (!cl.abonnementFin) return false;
      const fin = new Date(cl.abonnementFin);
      return fin <= in7days;
    });
  }, [clients]);

  // ── Pro client billing data ─────────────────────────────────────────────
  const MOIS_LABELS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const proClients = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    return clients
      .filter((cl) => cl.type === 'pro')
      .map((cl) => {
        const myColis = data.filter((c) => {
          if (c.clientId !== cl.id) return false;
          if (!['paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre'].includes(c.statut)) return false;
          const date = c.paiementDate || c.dateReception;
          if (!date) return false;
          const d = new Date(date);
          return d.getMonth() === month && d.getFullYear() === year;
        });
        return {
          ...cl,
          colisCount: myColis.length,
          totalTTC: myColis.reduce((s, c) => s + (c.devisTotal || 0), 0),
        };
      })
      .filter((cl) => cl.colisCount > 0);
  }, [clients, data]);

  // ── Sort handler ─────────────────────────────────────────────────────────
  const handleSort = (col) => {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else if (sortDir === 'desc') { setSortCol(null); setSortDir('asc'); }
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openColis = (id) => {
    navigate(`/colis/${id}`);
    setGlobalSearch('');
  };

  const handleCardClick = (cardKey) => {
    setActiveCard((prev) => (prev === cardKey ? null : cardKey));
    setPipeFilter(null);
  };

  const toggleSubFilter = (statuts) => {
    const key = statuts.join(',');
    setPipeFilter((prev) => (prev === key ? null : key));
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5 pb-24">

      {/* ── KPI Section (collapsible) ──────────────────────────────────── */}
      <div className="anim-fade">
        <button
          onClick={() => setShowKPI((p) => !p)}
          className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all hover:bg-gray-50"
          style={{ background: showKPI ? `${BRAND.navy}08` : 'transparent', border: `1px solid ${showKPI ? BRAND.navy + '25' : '#E5E7EB'}` }}
        >
          <span className="text-base">{'📊'}</span>
          <span className="text-sm font-bold" style={{ color: BRAND.navy }}>Indicateurs</span>
          <span
            className="ml-auto text-xs font-semibold transition-transform"
            style={{ color: BRAND.navy, transform: showKPI ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            ▾
          </span>
        </button>
        {showKPI && (
          <div className="mt-3">
            <KPIDashboard />
          </div>
        )}
      </div>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="anim-fade flex items-center justify-between gap-3 pt-1">
        <div>
          <h1
            className="text-xl font-black tracking-tight leading-none"
            style={{ color: BRAND.navy, letterSpacing: '-0.025em' }}
          >
            Tableau de bord
          </h1>
          <p className="text-xs text-gray-500 mt-0.5 font-medium">
            {totalAll} colis actifs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onNewColis}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 border-2"
            style={{ borderColor: BRAND.navy, color: BRAND.navy, background: 'white' }}
          >
            <UserPlus size={15} strokeWidth={2.5} />
            Nouveau client
          </button>
          <button
            onClick={onNewColis}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
              color: BRAND.navyD,
              boxShadow: `0 2px 12px ${BRAND.gold}40`,
            }}
          >
            <Package size={15} strokeWidth={2.5} />
            Nouveau colis
          </button>
        </div>
      </div>

      {/* ── Global search + envoi filter toggle ─────────────────────────── */}
      <div className="anim-fade stagger-1 relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Rechercher client, colis, tracking…"
              className="w-full pl-9 pr-8 py-2.5 text-sm rounded-xl border-2 border-gray-200 outline-none transition-all focus:border-amber-400"
              style={{ color: BRAND.navy, background: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
            />
            {hasSearch && (
              <button
                onClick={() => setGlobalSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            aria-label="Filtrer par envoi"
            onClick={() => setShowEnvoiFilter((p) => !p)}
            className="relative flex items-center justify-center w-10 rounded-xl border bg-white transition-all active:scale-95"
            style={{
              borderColor: showEnvoiFilter ? BRAND.navy : '#E5E7EB',
              background: showEnvoiFilter ? `${BRAND.navy}08` : 'white',
            }}
          >
            <Filter size={15} style={{ color: showEnvoiFilter || envoiFilter !== 'ALL' ? BRAND.navy : '#9CA3AF' }} />
            {envoiFilter !== 'ALL' && (
              <span
                className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white"
                style={{ background: BRAND.navy }}
              />
            )}
          </button>
        </div>

        {/* Search backdrop */}
        {hasSearch && (
          <div
            className="fixed inset-0 z-20"
            onClick={() => setGlobalSearch('')}
          />
        )}

        {/* Search dropdown */}
        {hasSearch && (
          <div
            className="absolute top-full left-0 right-0 mt-1.5 z-30 rounded-2xl overflow-hidden"
            style={{ maxHeight: 320, overflowY: 'auto', background: '#FFFFFF', border: '1px solid #E5E7EB', boxShadow: '0 8px 32px rgba(0,0,0,0.16)' }}
          >
            {!hasResults && (
              <p className="px-4 py-3 text-sm text-gray-400">Aucun résultat</p>
            )}

            {searchResults.clients.length > 0 && (
              <div>
                <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    Clients
                  </span>
                </div>
                {searchResults.clients.map((cl) => (
                  <button
                    key={cl.id}
                    onClick={() => setGlobalSearch('')}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div
                      className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-black"
                      style={{
                        background: `linear-gradient(135deg, ${BRAND.navyL}, ${BRAND.navy})`,
                        color: BRAND.goldL,
                      }}
                    >
                      {cl.nom.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{cl.nom}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {cl.ville} · {getDestByCP(cl.cp).flag} {getDestByCP(cl.cp).label}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searchResults.colis.length > 0 && (
              <div>
                <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    Colis
                  </span>
                </div>
                {searchResults.colis.map((c) => {
                  const cl = getClient(c.clientId);
                  return (
                    <button
                      key={c.id}
                      onClick={() => openColis(c.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div
                        className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center"
                        style={{ background: `${BRAND.navy}12` }}
                      >
                        <Package size={13} style={{ color: BRAND.navy }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-gray-800">{c.ref}</p>
                          <Badge statut={c.statut} />
                        </div>
                        <p className="text-xs text-gray-400 truncate">
                          {cl?.nom ?? '—'} · {c.desc}
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Summary cards (primary navigation) ─────────────────────────── */}
      <div className="anim-fade stagger-2">
        <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
          {[
            ...SUMMARY_CARDS.map((c) => ({
              ...c,
              count: c.key === 'afaire' ? totalAFaire
                : c.key === 'attente_fv' ? totalAttenteFV
                : c.key === 'attente_paie' ? totalAttentePaie
                : c.key === 'feuvert' ? totalFeuVert
                : totalPretExpedies,
            })),
            { key: 'total', label: 'Total', count: totalAll, color: BRAND.gold, icon: BarChart3 },
          ].map((card) => {
            const Icon = card.icon;
            const isActive = card.key === 'total' ? !activeCard : activeCard === card.key;
            const displayColor = card.key === 'total' ? BRAND.goldD : card.color;
            return (
              <button
                key={card.key}
                onClick={() => card.key === 'total' ? (setActiveCard(null), setPipeFilter(null)) : handleCardClick(card.key)}
                className={`card p-4 text-left transition-all active:scale-95 ${isActive ? 'ring-2' : 'opacity-60 hover:opacity-90'}`}
                style={{
                  borderLeft: `4px solid ${isActive ? card.color : card.color + '60'}`,
                  ...(isActive
                    ? {
                        '--tw-ring-color': card.color,
                        boxShadow: `0 2px 12px ${card.color}25`,
                        background: `${card.color}06`,
                      }
                    : {}),
                }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className={`text-[11px] font-bold uppercase tracking-wider ${isActive ? 'text-gray-700' : 'text-gray-500'}`}>
                      {card.label}
                    </p>
                    <p
                      className="text-3xl font-black mt-0.5 leading-none"
                      style={{ color: displayColor }}
                    >
                      {card.count}
                    </p>
                  </div>
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{ background: isActive ? `${card.color}20` : `${card.color}12` }}
                  >
                    <Icon size={16} style={{ color: displayColor }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Sub-filter chips (appear when a card is active) ──────────── */}
        {activeCard && subPipelineChips.length > 1 && (
          <div className="flex gap-2 flex-wrap mt-3 anim-slide-down">
            {subPipelineChips.map((p) => {
              const Icon = p.icon;
              const isActive = pipeFilter === p.statuts.join(',');
              return (
                <button
                  key={p.key}
                  onClick={() => toggleSubFilter(p.statuts)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95"
                  style={
                    isActive
                      ? { background: p.color, color: 'white', boxShadow: `0 2px 8px ${p.color}40` }
                      : { background: `${p.color}12`, color: p.color }
                  }
                >
                  <Icon size={11} strokeWidth={2.5} />
                  {p.label}
                  <span
                    className="font-black text-[11px] ml-0.5"
                    style={{ opacity: isActive ? 0.9 : 0.75 }}
                  >
                    {p.count}
                  </span>
                </button>
              );
            })}
            {pipeFilter && (
              <button
                onClick={() => setPipeFilter(null)}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={11} />
                Tout voir
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Missing invoice alert ─────────────────────────────────────────── */}
      {missingInvoices.length > 0 && (
        <div
          className="anim-fade stagger-3 rounded-xl overflow-hidden"
          style={{
            background: '#FEF3C7',
            border: '1px solid #FCD34D80',
          }}
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2.5">
            <AlertTriangle size={15} className="text-amber-600 flex-shrink-0" />
            <p className="text-xs font-bold text-amber-800">
              {missingInvoices.length} colis sans facture validée
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 px-3.5 pb-3">
            {(showAllMissing ? missingInvoices : missingInvoices.slice(0, 5)).map((c) => (
              <button
                key={c.id}
                onClick={() => openColis(c.id)}
                className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all active:scale-95 hover:bg-amber-200"
                style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #FCD34D' }}
              >
                {c.ref}
                <ChevronRight size={11} className="text-amber-500" />
              </button>
            ))}
            {!showAllMissing && missingInvoices.length > 5 && (
              <button
                onClick={() => setShowAllMissing(true)}
                className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all active:scale-95 hover:bg-amber-200"
                style={{ color: '#92400E' }}
              >
                +{missingInvoices.length - 5} autres
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Feu vert SANS facture — relance prioritaire ──────────────── */}
      {feuVertSansFacture.length > 0 && (
        <div
          className="anim-fade stagger-3 rounded-xl overflow-hidden"
          style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2.5">
            <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-bold text-red-800">
                {feuVertSansFacture.length} colis en feu vert sans facture — relance nécessaire
              </p>
              <p className="text-[10px] text-red-600 mt-0.5">
                Sans facture, le calcul des taxes (OM/OMR) et les formalités douanières sont impossibles.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 px-3.5 pb-3">
            {feuVertSansFacture.map((c) => {
              const cl = getClient(c.clientId);
              return (
                <button
                  key={c.id}
                  onClick={() => openColis(c.id)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all active:scale-95 hover:bg-red-100"
                  style={{ background: '#FFF5F5', color: '#991B1B', border: '1px solid #FECACA' }}
                >
                  <span>{c.ref}</span>
                  <span className="font-normal text-red-500">{cl?.nom?.split(' ')[0] || ''}</span>
                  <ChevronRight size={11} className="text-red-400" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Expiring subscriptions alert ───────────────────────────────── */}
      {expiringClients.length > 0 && (
        <div
          className="anim-fade stagger-4 rounded-xl overflow-hidden"
          style={{
            background: '#EDE9FE',
            border: '1px solid #C4B5FD80',
          }}
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2.5">
            <Clock size={15} className="text-violet-600 flex-shrink-0" />
            <p className="text-xs font-bold text-violet-800">
              {expiringClients.length} abonnement{expiringClients.length > 1 ? 's' : ''}{' '}
              {expiringClients.every((cl) => new Date(cl.abonnementFin) < new Date())
                ? 'expiré(s)'
                : 'expirent bientôt'}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 px-3.5 pb-3">
            {expiringClients.map((cl) => (
              <button
                key={cl.id}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all active:scale-95 hover:bg-violet-200"
                style={{ background: '#F5F3FF', color: '#5B21B6', border: '1px solid #C4B5FD' }}
              >
                {cl.nom}
                {ABONNEMENTS[cl.abonnement] && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: '#DDD6FE', color: '#6D28D9' }}
                  >
                    {ABONNEMENTS[cl.abonnement].label}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Facturation Pro ─────────────────────────────────────────────── */}
      {proClients.length > 0 && (
        <div
          className="anim-fade stagger-4 rounded-xl overflow-hidden"
          style={{
            background: '#EEF2FF',
            border: '1px solid #818CF840',
          }}
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2.5">
            <FileSpreadsheet size={15} className="text-indigo-600 flex-shrink-0" />
            <p className="text-xs font-bold text-indigo-800">
              Facturation Pro — {MOIS_LABELS[new Date().getMonth()]} {new Date().getFullYear()}
            </p>
          </div>
          <div className="px-3.5 pb-3 space-y-2">
            {proClients.map((cl) => (
              <div
                key={cl.id}
                className="flex items-center gap-2.5 p-2.5 rounded-lg"
                style={{ background: '#F5F3FF', border: '1px solid #C7D2FE' }}
              >
                <div
                  className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-black"
                  style={{
                    background: `linear-gradient(135deg, ${BRAND.navyL}, ${BRAND.navy})`,
                    color: BRAND.goldL,
                  }}
                >
                  {(cl.nom || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-indigo-900 truncate">{cl.nom}</p>
                  <p className="text-[10px] text-indigo-600">
                    {cl.colisCount} colis · {cl.totalTTC.toFixed(2)} €
                    {cl.methodePaiement === '30_jours'
                      ? ' · Paiement 30j'
                      : ' · Fin de mois'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    const now = new Date();
                    const count = exportRecapProExcel(cl, data, now.getMonth(), now.getFullYear());
                    if (count > 0) flash(`Récap exporté : ${count} colis`);
                    else flash('Aucun colis pour cette période');
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 hover:bg-indigo-200"
                  style={{ background: '#E0E7FF', color: '#3730A3', border: '1px solid #A5B4FC' }}
                >
                  <Download size={11} />
                  Récap
                </button>
              </div>
            ))}
            {proClients.length > 1 && (
              <button
                onClick={() => {
                  const now = new Date();
                  let totalCount = 0;
                  proClients.forEach((cl) => {
                    totalCount += exportRecapProExcel(cl, data, now.getMonth(), now.getFullYear());
                  });
                  flash(`${totalCount} colis exportés pour ${proClients.length} clients pro`);
                }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 hover:bg-indigo-200"
                style={{ background: '#E0E7FF', color: '#3730A3', border: '1px solid #A5B4FC' }}
              >
                <Download size={12} />
                Exporter tout ({proClients.length} clients)
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Envoi filter (collapsible) ──────────────────────────────────── */}
      {showEnvoiFilter && (
        <div className="anim-slide-down flex gap-2 overflow-x-auto pb-1 -mt-2">
          <button
            onClick={() => setEnvoiFilter('ALL')}
            className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all"
            style={
              envoiFilter === 'ALL'
                ? { background: BRAND.navy, color: 'white' }
                : { background: '#F3F4F6', color: '#6B7280' }
            }
          >
            Tous
          </button>
          <button
            onClick={() => setEnvoiFilter('NONE')}
            className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all"
            style={
              envoiFilter === 'NONE'
                ? { background: BRAND.navy, color: 'white' }
                : { background: '#F3F4F6', color: '#6B7280' }
            }
          >
            Sans envoi
          </button>
          {envois.map((e) => (
            <button
              key={e.id}
              onClick={() => setEnvoiFilter(e.id)}
              className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all"
              style={
                envoiFilter === e.id
                  ? { background: BRAND.navy, color: 'white' }
                  : { background: '#F3F4F6', color: '#6B7280' }
              }
            >
              {labelEnvoi(e)}
              <span
                className="ml-1.5 text-[10px]"
                style={{ opacity: 0.7 }}
              >
                {STATUT_ENVOI[e.statut]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── View mode toggle + table search ─────────────────────────────── */}
      <div className="anim-fade stagger-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold text-gray-500">
              {activePool.filter((c) => c.statut !== 'annule').length} colis affichés
            </p>
            <div className="relative">
              <button
                onClick={() => setShowExportPanel((v) => !v)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <Download size={12} />
                Export Excel
              </button>
              {showExportPanel && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-xl shadow-lg border border-gray-200 p-3 w-64 space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">Colonnes</p>
                    <button
                      onClick={() => {
                        const allOn = Object.values(exportCols).every(Boolean);
                        const next = {};
                        Object.keys(exportCols).forEach((k) => { next[k] = !allOn; });
                        setExportCols(next);
                      }}
                      className="text-[10px] font-bold text-blue-600 hover:underline"
                    >
                      {Object.values(exportCols).every(Boolean) ? 'Tout désélectionner' : 'Tout sélectionner'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { key: 'client', label: 'Client' },
                      { key: 'statut', label: 'Statut' },
                      { key: 'description', label: 'Description' },
                      { key: 'dims', label: 'Dimensions' },
                      { key: 'poids', label: 'Poids' },
                      { key: 'transport', label: 'Transport' },
                      { key: 'taxes', label: 'Taxes' },
                      { key: 'total', label: 'Total' },
                      { key: 'dateReception', label: 'Date réception' },
                      { key: 'casier', label: 'Casier' },
                      { key: 'envoi', label: 'Envoi' },
                      { key: 'fournisseurs', label: 'Fournisseurs' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={exportCols[key]}
                          onChange={() => setExportCols((prev) => ({ ...prev, [key]: !prev[key] }))}
                          className="rounded"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => {
                        const toExport = activePool.filter((c) => c.statut !== 'annule');
                        exportColisExcel(toExport, clients, exportCols);
                        flash(`${toExport.length} colis exportés`);
                        setShowExportPanel(false);
                      }}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold text-white transition-all active:scale-95"
                      style={{ background: BRAND.navy }}
                    >
                      <Download size={12} />
                      Télécharger
                    </button>
                    <button
                      onClick={() => setShowExportPanel(false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ViewToggle value={displayMode} onChange={setDisplayMode} />
            <div
              className="inline-flex rounded-xl overflow-hidden border"
              style={{ borderColor: '#E5E7EB' }}
            >
              <button
                onClick={() => setViewMode('status')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all"
                style={
                  viewMode === 'status'
                    ? { background: BRAND.navy, color: 'white' }
                    : { background: 'white', color: '#6B7280' }
                }
              >
                <Layers size={13} strokeWidth={2.5} />
                Statut
              </button>
              <button
                onClick={() => setViewMode('numero')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all"
                style={
                  viewMode === 'numero'
                    ? { background: BRAND.navy, color: 'white' }
                    : { background: 'white', color: '#6B7280' }
                }
              >
                <Hash size={13} strokeWidth={2.5} />
                N° Colis
              </button>
              <button
                onClick={() => setViewMode('envoi')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all"
                style={
                  viewMode === 'envoi'
                    ? { background: BRAND.navy, color: 'white' }
                    : { background: 'white', color: '#6B7280' }
                }
              >
                <CalendarDays size={13} strokeWidth={2.5} />
                Envoi
              </button>
            </div>
          </div>
        </div>

        {/* ── Table search bar ── */}
        {displayMode === 'columns' && (
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="text"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Filtrer les colis (ref, client, tracking, fournisseur, casier…)"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border border-gray-200 outline-none transition-all focus:border-amber-400 bg-white"
              style={{ color: BRAND.navy }}
            />
            {tableSearch && (
              <button
                onClick={() => setTableSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── View: par statut (grouped) ────────────────────────────────── */}
      {viewMode === 'status' && (
        <>
          {/* À faire */}
          {(aFaire.length > 0 || !activeCard) && (
            <div className="anim-fade stagger-5">
              <SectionHeader
                icon={CircleDot}
                label="À faire"
                count={aFaire.length}
                color={BRAND.navy}
              />
              {aFaire.length === 0 ? (
                <div className="card p-6 flex flex-col items-center text-center">
                  <CheckCircle size={28} className="text-emerald-300 mb-2" />
                  <p className="text-sm font-semibold text-gray-500">Rien à traiter</p>
                  <p className="text-xs text-gray-400 mt-0.5">Tous les colis sont à jour</p>
                </div>
              ) : displayMode === 'columns' ? (
                <ColisTable filterFn={filterByTableSearch} items={aFaire} getClient={getClient} envois={envois} openColis={openColis} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {aFaire.map((c, i) => (
                    <ColisCard
                      key={c.id}
                      c={c}
                      client={getClient(c.clientId)}
                      envois={envois}
                      stagger={i + 1}
                      onClick={() => openColis(c.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* En attente du client */}
          {(attente.length > 0 || !activeCard) && (
            <div className="anim-fade stagger-6">
              <SectionHeader
                icon={Clock}
                label="En attente du client"
                count={attente.length}
                color="#D97706"
              />
              {attente.length === 0 ? (
                <div
                  className="card p-4 flex items-center gap-2.5"
                  style={{ background: '#FFFBEB', borderColor: '#FCD34D40' }}
                >
                  <Clock size={16} className="text-amber-300 flex-shrink-0" />
                  <p className="text-sm text-amber-600 font-medium">Aucun colis en attente</p>
                </div>
              ) : displayMode === 'columns' ? (
                <ColisTable filterFn={filterByTableSearch} items={attente} getClient={getClient} envois={envois} openColis={openColis} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {attente.map((c, i) => (
                    <ColisCard
                      key={c.id}
                      c={c}
                      client={getClient(c.clientId)}
                      envois={envois}
                      stagger={i + 1}
                      onClick={() => openColis(c.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Livrés */}
          {(livres.length > 0 || !activeCard) && (
            <div className="anim-fade stagger-7">
              <SectionHeader
                icon={CheckCircle}
                label="Livrés"
                count={livres.length}
                color="#16A34A"
              />
              {livres.length === 0 ? (
                <div
                  className="card p-4 flex items-center gap-2.5"
                  style={{ background: '#F0FDF4', borderColor: '#BBF7D040' }}
                >
                  <Star size={16} className="text-emerald-300 flex-shrink-0" />
                  <p className="text-sm text-emerald-600 font-medium">Aucun colis livré (sur la sélection)</p>
                </div>
              ) : displayMode === 'columns' ? (
                <ColisTable filterFn={filterByTableSearch} items={livres} getClient={getClient} envois={envois} openColis={openColis} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {livres.map((c, i) => (
                    <ColisCard
                      key={c.id}
                      c={c}
                      client={getClient(c.clientId)}
                      envois={envois}
                      stagger={i + 1}
                      onClick={() => openColis(c.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── View: par numéro de colis (flat sorted) ──────────────────────── */}
      {viewMode === 'numero' && (
        <div className="anim-fade stagger-5">
          <SectionHeader
            icon={Hash}
            label="Tous les colis"
            count={sortedByNumero.length}
            color={BRAND.navy}
          />
          {sortedByNumero.length === 0 ? (
            <div className="card p-6 flex flex-col items-center text-center">
              <Package size={28} className="text-gray-300 mb-2" />
              <p className="text-sm font-semibold text-gray-500">Aucun colis</p>
            </div>
          ) : displayMode === 'columns' ? (
            <ColisTable filterFn={filterByTableSearch} items={sortedByNumero} getClient={getClient} envois={envois} openColis={openColis} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {sortedByNumero.map((c, i) => (
                <ColisCard
                  key={c.id}
                  c={c}
                  client={getClient(c.clientId)}
                  envois={envois}
                  stagger={i + 1}
                  onClick={() => openColis(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── View: par date d'envoi (grouped) ──────────────────────────── */}
      {viewMode === 'envoi' && (
        <div className="space-y-5">
          {groupedByEnvoi.length === 0 ? (
            <div className="card p-6 flex flex-col items-center text-center anim-fade">
              <Package size={28} className="text-gray-300 mb-2" />
              <p className="text-sm font-semibold text-gray-500">Aucun colis</p>
            </div>
          ) : groupedByEnvoi.map((group, gi) => {
            const e = group.envoi;
            return (
              <div key={e ? e.id : 'sans-envoi'} className="anim-fade" style={{ animationDelay: `${gi * 0.06}s` }}>
                {/* Group header */}
                <div className="flex items-center gap-2.5 mb-2.5">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: e ? `${BRAND.navy}15` : '#F3F4F6' }}
                  >
                    {e ? (
                      <Plane size={14} style={{ color: BRAND.navy }} strokeWidth={2} />
                    ) : (
                      <Package size={14} className="text-gray-400" strokeWidth={2} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-800">
                        {e ? labelEnvoi(e) : 'Sans envoi'}
                      </span>
                      {e && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: `${BRAND.navy}12`, color: BRAND.navy }}
                        >
                          {e.ref || STATUT_ENVOI[e.statut]}
                        </span>
                      )}
                      {e && STATUT_ENVOI[e.statut] && (
                        <span className="text-[10px] text-gray-400 font-medium">
                          {STATUT_ENVOI[e.statut]}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: e ? `${BRAND.navy}12` : '#F3F4F6', color: e ? BRAND.navy : '#9CA3AF' }}
                  >
                    {group.colis.length}
                  </span>
                  {e && (
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        const nb = exportFactureCommerciale(e, group.colis, clients, categories);
                        flash(`Facture commerciale ${e.ref} — ${nb} articles exportés`);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all active:scale-95 hover:bg-gray-100"
                      style={{ color: BRAND.navy }}
                      title="Télécharger la facture commerciale"
                    >
                      <FileSpreadsheet size={12} />
                      Facture COM
                    </button>
                  )}
                  {e && (
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        const nb = exportFactureCommerciPDF(e, group.colis, clients, categories);
                        flash(`PDF facture commerciale ${e.ref} — ${nb} articles`);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all active:scale-95 hover:bg-gray-100"
                      style={{ color: '#DC2626' }}
                      title="Télécharger en PDF"
                    >
                      <FileText size={12} />
                      PDF
                    </button>
                  )}
                  {e && (
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        const nb = exportDAUData(e, group.colis, clients, categories);
                        flash(`Données DAU ${e.ref} — ${nb} codes HS exportés`);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all active:scale-95 hover:bg-gray-100"
                      style={{ color: '#8B5CF6' }}
                      title="Données pour la déclaration douanière"
                    >
                      <FileSpreadsheet size={12} />
                      DAU
                    </button>
                  )}
                </div>

                {/* Group content */}
                {displayMode === 'columns' ? (
                  <ColisTable filterFn={filterByTableSearch} items={group.colis} getClient={getClient} envois={envois} openColis={openColis} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {group.colis.map((c, i) => (
                      <ColisCard
                        key={c.id}
                        c={c}
                        client={getClient(c.clientId)}
                        envois={envois}
                        stagger={i + 1}
                        onClick={() => openColis(c.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
