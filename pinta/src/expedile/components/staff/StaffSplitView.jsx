import React, { useState, useMemo, useEffect } from 'react';
import {
  Search, X, Package, Clock, CheckCircle, Check, Wrench, CreditCard, Plane,
  AlertTriangle, ChevronRight, Star, TrendingUp, Users, BarChart3,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, getDestByCP } from '../../constants';
import { eur, fuzzy, labelEnvoi } from '../../utils';
import { Badge, Etapes } from '../ui';
import StaffDetailView from './StaffDetailView';
import KPIDashboard from './KPIDashboard';
import ColisInfo from '../detail/ColisInfo';
import FacturesPanel from '../detail/FacturesPanel';
import ChatPanel from '../detail/ChatPanel';
import AuditLog from '../detail/AuditLog';

// ── Pipeline cards (filters) ────────────────────────────────────────────────
const PIPELINE = [
  { key: 'all',         label: 'Tout',            icon: Package,     color: BRAND.navy,  filter: (c) => c.statut !== 'annule' },
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
    autorise: '#22C55E', en_preparation: '#3B82F6', devis_envoye: '#D97706',
    attente_paiement: '#D97706', paye: '#10B981', expedie: '#06B6D4',
    transit: '#0EA5E9', dedouanement: '#8B5CF6', arrive: '#14B8A6',
    livraison: '#84CC16', livre: '#16A34A', annule: '#9CA3AF',
  };
  return map[s] || BRAND.navy;
}

// ── Table header style ──────────────────────────────────────────────────────
const TH = 'px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500';

// ════════════════════════════════════════════════════════════════════════════
// TABLE ROW
// ════════════════════════════════════════════════════════════════════════════
function ColisTableRow({ c, client, envois, onClick, stagger }) {
  const envoi = envois.find((e) => e.id === c.envoi);
  const dest = client ? getDestByCP(client.cp) : null;
  const hasDims = c.dimL && c.dimW && c.dimH && c.poids;
  const taxes = (c.devisOM != null || c.devisOMR != null || c.devisTVA != null)
    ? ((c.devisOM || 0) + (c.devisOMR || 0) + (c.devisTVA || 0)) : null;
  const nbCartons = (c.trackings?.filter((t) => t) || []).length || 1;

  return (
    <tr
      onClick={onClick}
      className="border-b border-gray-50 last:border-b-0 cursor-pointer transition-colors hover:bg-gray-50 active:bg-gray-100"
      style={{ borderLeft: `3px solid ${statutBorderColor(c.statut)}` }}
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
            <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: `${BRAND.gold}22`, color: BRAND.goldD }}>{c.casier}</span>
          )}
          {nbCartons > 1 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{nbCartons} cartons</span>}
        </div>
        {c.desc && <span className="text-[11px] text-gray-500 truncate block max-w-[130px]">{c.desc}</span>}
      </td>
      <td className="px-3 py-2.5">
        {c.factures && c.factures.length > 0 ? (
          c.factures.every((f) => f.valide)
            ? <Check size={14} className="text-green-500" />
            : <AlertTriangle size={14} className="text-amber-500" />
        ) : <span className="text-[10px] font-bold text-red-500">Manquante</span>}
      </td>
      <td className="px-3 py-2.5"><Badge statut={c.statut} /></td>
      <td className="px-3 py-2.5">
        {hasDims
          ? <span className="text-[11px] text-gray-500 font-mono whitespace-nowrap">{c.dimL}×{c.dimW}×{c.dimH} cm · {c.poids} kg</span>
          : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5 text-right">
        {c.devisTransport != null ? <span className="text-xs font-semibold text-gray-700">{eur(c.devisTransport)}</span> : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5 text-right">
        {taxes != null ? <span className="text-xs text-gray-600">{eur(taxes)}</span> : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5 text-right">
        {c.devisTotal != null ? <span className="text-sm font-bold" style={{ color: BRAND.navy }}>{eur(c.devisTotal)}</span> : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5">
        {envoi ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}>{labelEnvoi(envoi)}</span> : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="pr-2 py-2.5"><ChevronRight size={14} className="text-gray-300" /></td>
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
            <span className="text-sm font-black" style={{ color: BRAND.navy }}>{sel.ref}</span>
            <Badge statut={sel.statut} />
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>
        <div className="px-4 pt-3"><Etapes statut={sel.statut} /></div>
        <div className="p-4 space-y-4">
          <StaffDetailView />
          <ColisInfo />
          <FacturesPanel />
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
export function DashboardPage() {
  const navigate = useNavigate();
  const { data, clients, getClient, setSelId, authRole } = useApp();

  const active = data.filter((c) => c.statut !== 'annule' && !c.archive);

  const counts = useMemo(() => ({
    total: active.length,
  }), [active]);

  const pipelineCounts = useMemo(() => PIPELINE.filter((t) => t.key !== 'all').map((t) => ({
    ...t, count: active.filter(t.filter).length,
  })), [active]);

  const missingFactures = useMemo(() => active.filter((c) => c.statut !== 'livre' && !c.factures?.some((f) => f.valide)), [active]);
  const fvSansFacture = useMemo(() => missingFactures.filter((c) => ['attente_feu_vert', 'autorise', 'en_preparation'].includes(c.statut)), [missingFactures]);

  const caMonth = useMemo(() => {
    const now = new Date(); const m = now.getMonth(), y = now.getFullYear();
    return active.filter((c) => c.paiementMontant && c.paiementDate)
      .filter((c) => { const d = new Date(c.paiementDate); return d.getMonth() === m && d.getFullYear() === y; })
      .reduce((s, c) => s + (c.paiementMontant || 0), 0);
  }, [active]);

  const handleSelectColis = (id) => { setSelId(id); navigate('/colis'); };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-xl font-black" style={{ color: BRAND.navy }}>Tableau de bord</h1>
          <p className="text-xs text-gray-400 mt-0.5">{counts.total} colis actifs · {clients.length} clients</p>
        </div>

        {/* Pipeline cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {pipelineCounts.map((card) => {
            const Icon = card.icon;
            return (
              <button key={card.key} onClick={() => navigate(`/colis?tab=${card.key}`)}
                className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-left hover:shadow-md hover:border-gray-200 transition-all active:scale-[0.98]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{card.label}</p>
                    <p className="text-2xl font-black mt-0.5" style={{ color: card.color }}>{card.count}</p>
                  </div>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${card.color}12` }}>
                    <Icon size={16} style={{ color: card.color }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {(authRole === 'directeur' || authRole === 'vice_directeur') && caMonth > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${BRAND.gold}20` }}>
              <TrendingUp size={18} style={{ color: BRAND.goldD }} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">CA ce mois</p>
              <p className="text-xl font-black" style={{ color: BRAND.navy }}>{eur(caMonth)}</p>
            </div>
          </div>
        )}

        {missingFactures.length > 0 && (
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-amber-600" />
              <p className="text-xs font-bold text-amber-800">{missingFactures.length} colis sans facture validée</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {missingFactures.slice(0, 8).map((c) => (
                <button key={c.id} onClick={() => handleSelectColis(c.id)}
                  className="text-[11px] font-bold px-2 py-1 rounded-lg bg-white border border-amber-200 text-amber-800 hover:bg-amber-100 transition-all active:scale-95">{c.ref}</button>
              ))}
              {missingFactures.length > 8 && <span className="text-[11px] font-semibold text-amber-500 px-2 py-1">+{missingFactures.length - 8} autres</span>}
            </div>
          </div>
        )}

        {fvSansFacture.length > 0 && (
          <div className="bg-red-50 rounded-xl border border-red-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={14} className="text-red-600" />
              <p className="text-xs font-bold text-red-800">{fvSansFacture.length} colis en traitement sans facture — relance nécessaire</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {fvSansFacture.map((c) => {
                const cl = getClient(c.clientId);
                return <button key={c.id} onClick={() => handleSelectColis(c.id)}
                  className="text-[11px] font-bold px-2 py-1 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-100 transition-all active:scale-95">
                  {c.ref} <span className="font-normal text-red-400">{cl?.nom?.split(' ').pop()}</span>
                </button>;
              })}
            </div>
          </div>
        )}

        {(authRole === 'directeur' || authRole === 'vice_directeur') && <KPIDashboard />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// COLIS PAGE — /colis route: pipeline cards + table + detail slide-over
// ════════════════════════════════════════════════════════════════════════════
export default function StaffColisPage() {
  const navigate = useNavigate();
  const { data, clients, getClient, envois, setSelId, sel } = useApp();
  const [searchParams] = useSearchParams();

  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(urlTab && PIPELINE.some((t) => t.key === urlTab) ? urlTab : 'all');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [showArchive, setShowArchive] = useState(false);

  useEffect(() => {
    if (urlTab && PIPELINE.some((t) => t.key === urlTab)) setActiveTab(urlTab);
  }, [urlTab]);

  // Pool
  const pool = useMemo(() => {
    let list = showArchive ? data : data.filter((c) => !c.archive);
    const tab = PIPELINE.find((t) => t.key === activeTab);
    if (tab) list = list.filter(tab.filter);
    return list;
  }, [data, activeTab, showArchive]);

  // Search
  const searched = useMemo(() => {
    if (!search.trim()) return pool;
    return pool.filter((c) => {
      const cl = getClient(c.clientId);
      const txt = `${c.ref} ${c.desc || ''} ${cl?.nom || ''} ${c.casier || ''} ${c.trackings?.join(' ') || ''}`;
      return fuzzy(txt, search);
    });
  }, [pool, search, getClient]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortCol) return searched;
    const arr = [...searched];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let va, vb;
      switch (sortCol) {
        case 'client': va = (getClient(a.clientId)?.nom || '').toLowerCase(); vb = (getClient(b.clientId)?.nom || '').toLowerCase(); return dir * va.localeCompare(vb, 'fr');
        case 'ref': return dir * (a.ref || '').localeCompare(b.ref || '', 'fr', { numeric: true });
        case 'statut': return dir * (STATUTS[a.statut]?.label || '').localeCompare(STATUTS[b.statut]?.label || '', 'fr');
        case 'dims': return dir * ((a.dimL || 0) - (b.dimL || 0));
        case 'transport': return dir * ((a.devisTransport || 0) - (b.devisTransport || 0));
        case 'taxes': va = (a.devisOM || 0) + (a.devisOMR || 0) + (a.devisTVA || 0); vb = (b.devisOM || 0) + (b.devisOMR || 0) + (b.devisTVA || 0); return dir * (va - vb);
        case 'total': return dir * ((a.devisTotal || 0) - (b.devisTotal || 0));
        default: return 0;
      }
    });
    return arr;
  }, [searched, sortCol, sortDir, getClient]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const base = data.filter((c) => !c.archive);
    return PIPELINE.reduce((acc, t) => { acc[t.key] = base.filter(t.filter).length; return acc; }, {});
  }, [data]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const openColis = (id) => setSelId(id);
  const closeDetail = () => setSelId(null);

  const sortIndicator = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕';
  const thSort = (col) => ({ onClick: () => handleSort(col), className: `${TH} cursor-pointer hover:text-gray-700 select-none` });
  const thSortRight = (col) => ({ onClick: () => handleSort(col), className: `${TH} text-right cursor-pointer hover:text-gray-700 select-none` });

  return (
    <div className="h-full overflow-y-auto">
      {/* Detail slide-over */}
      {sel && <DetailSlideOver onClose={closeDetail} />}

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">

        {/* Pipeline cards — clickable filters */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {PIPELINE.map((p) => {
            const Icon = p.icon;
            const isActive = activeTab === p.key;
            const count = tabCounts[p.key] || 0;
            return (
              <button
                key={p.key}
                onClick={() => setActiveTab(p.key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 ${
                  isActive ? 'text-white shadow-md' : 'bg-white border border-gray-100 shadow-sm hover:shadow-md'
                }`}
                style={isActive
                  ? { background: p.color, boxShadow: `0 2px 8px ${p.color}40` }
                  : { color: p.color }
                }
              >
                <Icon size={14} />
                {p.label}
                <span className={`font-black text-[11px] px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-white/25' : ''
                }`} style={!isActive ? { background: `${p.color}12` } : {}}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search + count */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer les colis (ref, client, tracking, casier...)"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border border-gray-200 outline-none focus:border-blue-400"
              style={{ color: BRAND.navy }}
            />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
          </div>
          <span className="text-xs text-gray-400 font-medium">{sorted.length} colis</span>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
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
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400">Aucun colis trouvé</td></tr>
                ) : sorted.map((c, i) => (
                  <ColisTableRow key={c.id} c={c} client={getClient(c.clientId)} envois={envois} stagger={i} onClick={() => openColis(c.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
