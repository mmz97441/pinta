import React, { useState, useMemo, useEffect } from 'react';
import {
  Search, X, Package, Clock, CheckCircle, Check, Wrench, CreditCard, Plane,
  AlertTriangle, ChevronRight, Star, TrendingUp, Users, BarChart3,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, ABONNEMENTS, getDestByCP } from '../../constants';
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

// ── Table styles ────────────────────────────────────────────────────────────
const TH = 'px-2 py-2 text-[9px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap';
const TD = 'px-2 py-2 text-[11px] whitespace-nowrap';
const DASH = <span className="text-gray-300">—</span>;

// ── Table header row ────────────────────────────────────────────────────────
function ColisTableHead({ compact }) {
  return (
    <tr className="border-b border-gray-200" style={{ background: `${BRAND.navy}06` }}>
      <th className={TH}>Date</th>
      <th className={TH}>Réf.</th>
      <th className={TH}>Statut</th>
      {!compact && <th className={TH}>Paiem.</th>}
      <th className={TH}>Nom</th>
      <th className={TH}>Prénom</th>
      {!compact && <th className={TH}>Email</th>}
      {!compact && <th className={TH}>Tél.</th>}
      {!compact && <th className={TH}>Forfait</th>}
      <th className={TH}>Intitulé</th>
      {!compact && <th className={`${TH} text-right`}>Vol. cm³</th>}
      {!compact && <th className={`${TH} text-right`}>Vol. kg</th>}
      {!compact && <th className={`${TH} text-right`}>Poids</th>}
      <th className={`${TH} text-right`}>Transport</th>
      <th className={`${TH} text-right`}>Taxes</th>
      <th className={`${TH} text-right`}>Total</th>
      {!compact && <th className={`${TH} text-right`}>Payé</th>}
      {!compact && <th className={TH}>Commune</th>}
      {!compact && <th className={TH}>CP</th>}
      <th className="w-5"></th>
    </tr>
  );
}

// ── Table data row ──────────────────────────────────────────────────────────
function ColisTableRow({ c, client, envois, onClick, isSelected, compact }) {
  const dest = client ? getDestByCP(client.cp) : null;
  const hasDims = c.dimL && c.dimW && c.dimH;
  const volCm3 = hasDims ? c.dimL * c.dimW * c.dimH : null;
  const volKg = volCm3 ? (volCm3 / 5000).toFixed(2) : null;
  const taxes = (c.devisOM != null || c.devisOMR != null || c.devisTVA != null)
    ? ((c.devisOM || 0) + (c.devisOMR || 0) + (c.devisTVA || 0)) : null;
  const dateCreation = c.dateReception
    ? new Date(c.dateReception).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    : c.createdAt
    ? new Date(c.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    : '—';
  const isPaid = c.paiementMontant > 0;
  const abo = client?.abonnement ? (ABONNEMENTS[client.abonnement]?.label || client.abonnement) : '—';
  const prenom = client?.nom?.split(' ').slice(0, -1).join(' ') || '';
  const nom = client?.nom?.split(' ').pop() || client?.nom || '—';

  return (
    <tr
      onClick={onClick}
      className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
      style={{ borderLeft: `3px solid ${statutBorderColor(c.statut)}` }}
    >
      <td className={TD}><span className="text-gray-500">{dateCreation}</span></td>
      <td className={TD}>
        <span className="font-black text-gray-900">{c.ref}</span>
        {c.casier && <span className="text-[8px] font-bold px-1 py-0.5 rounded ml-1" style={{ background: `${BRAND.gold}22`, color: BRAND.goldD }}>{c.casier}</span>}
      </td>
      <td className={TD}><Badge statut={c.statut} /></td>
      {!compact && <td className={TD}>
        {isPaid ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Payé</span>
          : c.devisTotal ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">En attente</span>
          : DASH}
      </td>}
      <td className={TD}><span className="text-gray-700 font-medium">{nom}</span>{dest && <span className="ml-1">{dest.flag}</span>}</td>
      <td className={TD}><span className="text-gray-500">{prenom || '—'}</span></td>
      {!compact && <td className={TD}><span className="text-gray-500 text-[10px]">{client?.email || '—'}</span></td>}
      {!compact && <td className={TD}><span className="text-gray-500 text-[10px] font-mono">{client?.tel || '—'}</span></td>}
      {!compact && <td className={TD}><span className="text-[9px] font-semibold">{abo}</span></td>}
      <td className={TD}><span className="text-gray-600 truncate block max-w-[120px]">{c.desc || '—'}</span></td>
      {!compact && <td className={`${TD} text-right`}>{volCm3 ? <span className="text-gray-500 font-mono text-[10px]">{volCm3.toLocaleString()}</span> : DASH}</td>}
      {!compact && <td className={`${TD} text-right`}>{volKg ? <span className="text-gray-500 font-mono text-[10px]">{volKg}</span> : DASH}</td>}
      {!compact && <td className={`${TD} text-right`}>{c.poids ? <span className="text-gray-600 font-mono text-[10px]">{c.poids} kg</span> : DASH}</td>}
      <td className={`${TD} text-right`}>{c.devisTransport != null ? <span className="font-semibold text-gray-700">{eur(c.devisTransport)}</span> : DASH}</td>
      <td className={`${TD} text-right`}>{taxes != null ? <span className="text-gray-600">{eur(taxes)}</span> : DASH}</td>
      <td className={`${TD} text-right`}>{c.devisTotal != null ? <span className="font-bold" style={{ color: BRAND.navy }}>{eur(c.devisTotal)}</span> : DASH}</td>
      {!compact && <td className={`${TD} text-right`}>{c.paiementMontant ? <span className="font-bold text-green-700">{eur(c.paiementMontant)}</span> : DASH}</td>}
      {!compact && <td className={TD}><span className="text-gray-500 text-[10px]">{client?.ville || '—'}</span></td>}
      {!compact && <td className={TD}><span className="text-gray-500 text-[10px] font-mono">{client?.cp || '—'}</span></td>}
      <td className="pr-1 py-2"><ChevronRight size={12} className="text-gray-300" /></td>
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
  const urlDest = searchParams.get('dest');
  // If a colis is already selected (navigated from dashboard), show 'all' to ensure it's visible
  const [activeTab, setActiveTab] = useState(
    sel ? 'all' : (urlTab && PIPELINE.some((t) => t.key === urlTab) ? urlTab : 'all')
  );
  const [activeDest, setActiveDest] = useState(urlDest || null);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [showArchive, setShowArchive] = useState(false);
  const [viewMode, setViewMode] = useState('statut'); // 'statut' | 'envoi'

  useEffect(() => {
    if (urlTab && PIPELINE.some((t) => t.key === urlTab)) setActiveTab(urlTab);
    setActiveDest(searchParams.get('dest') || null);
  }, [urlTab, searchParams]);

  // Pool
  const pool = useMemo(() => {
    let list = showArchive ? data : data.filter((c) => !c.archive);
    const tab = PIPELINE.find((t) => t.key === activeTab);
    if (tab) list = list.filter(tab.filter);
    // Filter by destination
    if (activeDest) {
      list = list.filter((c) => {
        const cl = getClient(c.clientId);
        if (!cl) return false;
        const d = getDestByCP(cl.cp);
        return d?.code === activeDest;
      });
    }
    return list;
  }, [data, activeTab, showArchive, activeDest, getClient]);

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
  ];

  const groupedByStatut = useMemo(() => {
    return STATUT_GROUPS.map((g) => ({
      ...g,
      colis: sorted.filter((c) => g.statuts.includes(c.statut)),
    })).filter((g) => g.colis.length > 0);
  }, [sorted]);

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
    <div className="h-full flex flex-col">

      {/* Top bar: pipeline cards + search */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 space-y-3 border-b border-gray-100 bg-white">
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
          {activeDest && (() => {
            const d = getDestByCP(activeDest === '974' ? '97400' : activeDest === '976' ? '97600' : activeDest === '971' ? '97100' : '97200');
            return (
              <button
                onClick={() => { setActiveDest(null); navigate('/colis' + (activeTab !== 'all' ? `?tab=${activeTab}` : '')); }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 hover:bg-amber-200 transition-all"
              >
                {d?.flag} {d?.label || activeDest}
                <X size={12} />
              </button>
            );
          })()}

          {/* View mode toggle */}
          <div className="flex items-center gap-1 ml-auto bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('statut')}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${viewMode === 'statut' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}
            >
              Par statut
            </button>
            <button
              onClick={() => setViewMode('envoi')}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${viewMode === 'envoi' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}
            >
              Par envoi
            </button>
          </div>
        </div>
      </div>

      {/* Main area: table + detail side by side */}
      <div className="flex-1 flex min-h-0">

        {/* Table (scrollable) */}
        <div className={`overflow-y-auto overflow-x-auto ${sel ? 'flex-1 min-w-0' : 'flex-1'}`}>

          {viewMode === 'envoi' ? (
            /* ── VUE PAR ENVOI ── */
            <div className="space-y-3 p-2">
              {groupedByEnvoi.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">Aucun colis</p>
              ) : groupedByEnvoi.map((group) => {
                const e = group.envoi;
                const dateLabel = e?.date
                  ? new Date(e.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
                  : 'Sans envoi affecté';
                return (
                  <div key={e?.id || 'none'} className="rounded-xl border border-gray-100 overflow-hidden bg-white">
                    <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between" style={{ background: `${BRAND.navy}06` }}>
                      <div className="flex items-center gap-2">
                        <Plane size={13} style={{ color: BRAND.navy }} />
                        <span className="text-xs font-bold" style={{ color: BRAND.navy }}>{dateLabel}</span>
                        {e?.ref && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{e.ref}</span>}
                      </div>
                      <span className="text-[10px] font-bold text-gray-400">{group.colis.length} colis</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead><ColisTableHead compact={!!sel} /></thead>
                        <tbody>
                          {group.colis.map((c) => (
                            <ColisTableRow key={c.id} c={c} client={getClient(c.clientId)} envois={envois}
                              onClick={() => openColis(c.id)} isSelected={sel?.id === c.id} compact={!!sel} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── VUE PAR STATUT (groupé par phase) ── */
            <div className="space-y-3 p-2">
              {groupedByStatut.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">Aucun colis</p>
              ) : groupedByStatut.map((group) => {
                const Icon = group.icon;
                return (
                  <div key={group.label} className="rounded-xl border border-gray-100 overflow-hidden bg-white">
                    <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between" style={{ background: `${group.color}08` }}>
                      <div className="flex items-center gap-2">
                        <Icon size={13} style={{ color: group.color }} />
                        <span className="text-xs font-bold" style={{ color: group.color }}>{group.label}</span>
                      </div>
                      <span className="text-[10px] font-bold text-gray-400">{group.colis.length} colis</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead><ColisTableHead compact={!!sel} /></thead>
                        <tbody>
                          {group.colis.map((c) => (
                            <ColisTableRow key={c.id} c={c} client={getClient(c.clientId)} envois={envois}
                              onClick={() => openColis(c.id)} isSelected={sel?.id === c.id} compact={!!sel} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel (inline, right side) */}
        {sel && (
          <div className="w-[820px] flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: statutBorderColor(sel.statut) }} />
                <span className="text-sm font-black" style={{ color: BRAND.navy }}>{sel.ref}</span>
                <Badge statut={sel.statut} />
              </div>
              <button onClick={closeDetail} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
            </div>
            <div className="px-4 pt-3"><Etapes statut={sel.statut} /></div>
            {/* Two-column detail layout */}
            <div className="p-4 flex gap-4">
              {/* Left: info, factures, audit */}
              <div className="flex-1 min-w-0 space-y-4">
                <ColisInfo />
                <FacturesPanel />
                <AuditLog />
              </div>
              {/* Right: actions + chat */}
              <div className="w-[340px] flex-shrink-0 space-y-4">
                <div className="sticky top-16 space-y-4">
                  <StaffDetailView />
                  <ChatPanel />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
