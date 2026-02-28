import React, { useState, useMemo } from 'react';
import {
  Plus, Search, X, BarChart3, CircleDot, Clock, CheckCircle,
  ChevronRight, AlertTriangle, Filter, Package,
  User, Clipboard, Ruler, Wrench, CreditCard, Plane, Star,
  Hash, Layers,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, STATUT_ENVOI, getDestByCP, FORFAITS } from '../../constants';
import { eur, labelEnvoi, trackStr, trackCount, hasTrack, searchGlobal } from '../../utils';
import { Badge } from '../ui';

// ── Statut groups ──────────────────────────────────────────────────────────────
const STATUTS_A_FAIRE = [
  'annonce', 'receptionne', 'mesure', 'autorise',
  'en_preparation', 'paye', 'expedie', 'transit', 'arrive', 'livraison',
];
const STATUTS_ATTENTE = ['attente_feu_vert', 'devis_envoye', 'attente_paiement'];
const STATUTS_LIVRE = ['livre'];
const STATUTS_PRETS_EXPEDIES = ['paye', 'expedie', 'transit', 'arrive', 'livraison', 'livre'];

// ── Summary card definitions ─────────────────────────────────────────────────
const SUMMARY_CARDS = [
  { key: 'afaire', label: 'À traiter', statuts: STATUTS_A_FAIRE, color: BRAND.navy, icon: CircleDot },
  { key: 'attente', label: 'Att. client', statuts: STATUTS_ATTENTE, color: '#D97706', icon: Clock },
  { key: 'expedies', label: 'Prêts / Expédiés', statuts: STATUTS_PRETS_EXPEDIES, color: '#059669', icon: CheckCircle },
];

// ── Pipeline definition ────────────────────────────────────────────────────────
const PIPELINE = [
  {
    key: 'reception',
    label: 'Réception',
    icon: Package,
    statuts: ['annonce', 'receptionne', 'mesure'],
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
    statuts: ['expedie', 'transit', 'arrive', 'livraison'],
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
    annonce: Clipboard,
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
    annonce:            { bg: '#F8FAFC', border: '#94A3B8', icon: '#64748B' },
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
    arrive:             { bg: '#F0FDFA', border: '#14B8A6', icon: '#0D9488' },
    livraison:          { bg: '#ECFDF5', border: '#10B981', icon: '#059669' },
    livre:              { bg: '#F0FDF4', border: '#16A34A', icon: '#15803D' },
    annule:             { bg: '#F9FAFB', border: '#9CA3AF', icon: '#6B7280' },
  };
  return map[statut] || { bg: '#FFFFFF', border: BRAND.navy, icon: BRAND.navy };
}

// ── Next action hint per statut ──────────────────────────────────────────────
function nextActionLabel(statut) {
  const map = {
    annonce: 'Réceptionner',
    receptionne: 'Mesurer',
    mesure: 'Demander feu vert',
    attente_feu_vert: 'Att. client',
    autorise: 'Préparer',
    en_preparation: 'Envoyer devis',
    devis_envoye: 'Att. paiement',
    attente_paiement: 'Att. paiement',
    paye: 'Expédier',
    expedie: 'Suivi transit',
    transit: 'Att. arrivée',
    arrive: 'Dédouaner',
    dedouanement: 'Planifier livraison',
    livraison: 'Livrer',
  };
  return map[statut] || null;
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
      className={`w-full text-left p-3 rounded-xl border anim-fade stagger-${Math.min(stagger, 8)} group transition-all hover:shadow-md`}
      style={{
        background: scs.bg,
        borderColor: `${scs.border}30`,
        borderLeft: `3px solid ${scs.border}`,
      }}
    >
      <div className="flex items-start gap-2.5">
        {/* Icon col */}
        <div
          className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${scs.border}15` }}
        >
          <StatutIco size={14} style={{ color: scs.icon }} strokeWidth={2.5} />
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
              <AlertTriangle size={11} className="text-amber-500 flex-shrink-0" />
            )}
          </div>

          {/* Row 2: client + type + dest */}
          <div className="mt-1 flex items-center gap-1.5">
            <User size={10} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-600 font-medium truncate">{client?.nom ?? '—'}</span>
            {client?.type === 'pro' && (
              <span className="text-[8px] font-black px-1 py-0.5 rounded" style={{ background: '#DBEAFE', color: '#1D4ED8' }}>PRO</span>
            )}
            {dest && (
              <span className="text-xs text-gray-400 flex-shrink-0">{dest.flag}</span>
            )}
          </div>

          {/* Row 3: description + dims + tracking */}
          <div className="mt-1 flex items-center gap-2.5 flex-wrap">
            {c.desc && (
              <span className="text-[11px] text-gray-500 truncate max-w-[140px]">{c.desc}</span>
            )}
            <DimsChip c={c} />
            {hasTrack(c) && (
              <span className="text-[10px] text-gray-400 font-mono truncate max-w-[120px]">
                {trackCount(c) > 1
                  ? `${trackCount(c)} trackings`
                  : trackStr(c)}
              </span>
            )}
            {envoi && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: `${BRAND.navy}10`, color: BRAND.navy }}
              >
                {labelEnvoi(envoi)}
              </span>
            )}
            {/* Next action hint */}
            {nextActionLabel(c.statut) && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: `${scs.border}12`, color: scs.icon }}
              >
                {nextActionLabel(c.statut)}
              </span>
            )}
          </div>
        </div>

        {/* Arrow */}
        <ChevronRight
          size={14}
          className="flex-shrink-0 mt-1.5 text-gray-300 group-hover:text-gray-500 transition-colors"
        />
      </div>
    </button>
  );
}

// ── Section header with optional right slot ──────────────────────────────────
function SectionHeader({ icon: Icon, label, count, color, right }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <div
        className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}15` }}
      >
        <Icon size={11} style={{ color }} strokeWidth={2.5} />
      </div>
      <span className="text-[13px] font-bold text-gray-800">{label}</span>
      <span
        className="text-[11px] font-bold px-1.5 py-0.5 rounded-md"
        style={{ background: `${color}12`, color }}
      >
        {count}
      </span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function StaffDashboard({ onNewColis }) {
  const { data, clients, envois, setSelId, getClient, isStaff, page } = useApp();

  const [globalSearch, setGlobalSearch] = useState('');
  const [envoiFilter, setEnvoiFilter] = useState('ALL');
  const [activeCard, setActiveCard] = useState(null);
  const [pipeFilter, setPipeFilter] = useState(null);
  const [showEnvoiFilter, setShowEnvoiFilter] = useState(false);
  const [viewMode, setViewMode] = useState('status'); // 'status' | 'numero'

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
  const totalAttente = useMemo(
    () => data.filter((c) => STATUTS_ATTENTE.includes(c.statut)).length,
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

  // ── Subscription expiration alerts (< 30 days) ──────────────────────────
  const expiringAbos = useMemo(() => {
    const now = new Date();
    const limit = new Date();
    limit.setDate(now.getDate() + 30);
    return clients.filter((c) => {
      if (!c.dateFinAbo || c.forfait === 'freemium') return false;
      const d = new Date(c.dateFinAbo + 'T00:00:00');
      return d <= limit;
    }).map((c) => {
      const d = new Date(c.dateFinAbo + 'T00:00:00');
      const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
      return { ...c, joursRestants: diff };
    }).sort((a, b) => a.joursRestants - b.joursRestants);
  }, [clients]);

  // ── Pipeline chips (always visible, scoped to active card if set) ─────
  const pipelineChips = useMemo(() => {
    const base = activeCardDef
      ? PIPELINE
          .map((p) => ({
            ...p,
            statuts: p.statuts.filter((s) => activeCardDef.statuts.includes(s)),
          }))
          .filter((p) => p.statuts.length > 0)
      : PIPELINE;
    return base.map((p) => ({
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

  // ── Missing invoices ──────────────────────────────────────────────────────
  const missingInvoices = useMemo(
    () => data.filter((c) =>
      c.statut !== 'annule' &&
      c.factures &&
      c.factures.some((f) => !f.valide)
    ),
    [data],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openColis = (id) => {
    setSelId(id);
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

  // ── Summary data ─────────────────────────────────────────────────────────
  const summaryItems = [
    ...SUMMARY_CARDS.map((c) => ({
      ...c,
      count: c.key === 'afaire' ? totalAFaire : c.key === 'attente' ? totalAttente : totalPretExpedies,
    })),
    { key: 'total', label: 'Total', count: totalAll, color: BRAND.gold, icon: BarChart3 },
  ];

  const allSectionsEmpty = aFaire.length === 0 && attente.length === 0 && livres.length === 0;

  // ── View toggle widget ──────────────────────────────────────────────────
  const viewToggle = (
    <div
      className="inline-flex rounded-lg overflow-hidden"
      style={{ border: '1px solid #E5E7EB' }}
    >
      <button
        onClick={() => setViewMode('status')}
        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold transition-all"
        style={
          viewMode === 'status'
            ? { background: BRAND.navy, color: 'white' }
            : { background: 'white', color: '#9CA3AF' }
        }
      >
        <Layers size={10} strokeWidth={2.5} />
        Statut
      </button>
      <button
        onClick={() => setViewMode('numero')}
        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold transition-all"
        style={
          viewMode === 'numero'
            ? { background: BRAND.navy, color: 'white' }
            : { background: 'white', color: '#9CA3AF' }
        }
      >
        <Hash size={10} strokeWidth={2.5} />
        N° Colis
      </button>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 pb-24">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="anim-fade flex items-center justify-between gap-3 pt-1">
        <div>
          <h1
            className="text-lg font-black tracking-tight leading-none"
            style={{ color: BRAND.navy, letterSpacing: '-0.025em' }}
          >
            Tableau de bord
          </h1>
          <p className="text-[11px] text-gray-400 mt-0.5 font-medium">
            {totalAll} colis actifs
          </p>
        </div>
        <button
          onClick={onNewColis}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-bold transition-all active:scale-95"
          style={{
            background: BRAND.navy,
            color: 'white',
          }}
        >
          <Plus size={14} strokeWidth={2.5} />
          Réceptionner
        </button>
      </div>

      {/* ── Summary bar ─────────────────────────────────────────────────── */}
      <div className="anim-fade stagger-1">
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: 'white',
            border: '1px solid #E5E7EB',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div className="grid grid-cols-4">
            {summaryItems.map((card, idx) => {
              const Icon = card.icon;
              const isActive = card.key === 'total' ? !activeCard : activeCard === card.key;
              const displayColor = card.key === 'total' ? BRAND.goldD : card.color;
              return (
                <button
                  key={card.key}
                  onClick={() => card.key === 'total' ? (setActiveCard(null), setPipeFilter(null)) : handleCardClick(card.key)}
                  className="relative text-center py-3 px-2 transition-all active:scale-[0.97]"
                  style={{
                    background: isActive ? `${card.color}08` : 'transparent',
                    borderRight: idx < 3 ? '1px solid #F3F4F6' : 'none',
                  }}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <div
                      className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full"
                      style={{ background: card.color }}
                    />
                  )}
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <Icon size={12} style={{ color: isActive ? displayColor : '#9CA3AF' }} strokeWidth={2} />
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: isActive ? displayColor : '#9CA3AF' }}
                    >
                      {card.label}
                    </span>
                  </div>
                  <p
                    className="text-2xl font-black leading-none"
                    style={{ color: isActive ? displayColor : '#D1D5DB' }}
                  >
                    {card.count}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Pipeline chips (always visible for quick 1-click filtering) ── */}
        <div className="flex gap-1.5 flex-wrap mt-2.5">
          {pipelineChips.map((p) => {
            const PIcon = p.icon;
            const isActive = pipeFilter === p.statuts.join(',');
            return (
              <button
                key={p.key}
                onClick={() => toggleSubFilter(p.statuts)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all active:scale-95"
                style={
                  isActive
                    ? { background: p.color, color: 'white', boxShadow: `0 1px 6px ${p.color}30` }
                    : { background: `${p.color}10`, color: p.color }
                }
              >
                <PIcon size={10} strokeWidth={2.5} />
                {p.label}
                <span className="font-black ml-0.5" style={{ opacity: isActive ? 0.9 : 0.6 }}>
                  {p.count}
                </span>
              </button>
            );
          })}
          {pipeFilter && (
            <button
              onClick={() => setPipeFilter(null)}
              className="flex items-center gap-0.5 px-1.5 py-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {/* ── Search + filter bar ─────────────────────────────────────────── */}
      <div className="anim-fade stagger-2 relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Rechercher client, colis, tracking…"
              className="w-full pl-9 pr-8 py-2 text-[13px] rounded-lg border border-gray-200 outline-none transition-all focus:border-amber-400"
              style={{ color: BRAND.navy }}
            />
            {hasSearch && (
              <button
                onClick={() => setGlobalSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowEnvoiFilter((p) => !p)}
            className="relative flex items-center justify-center w-9 h-9 rounded-lg border transition-all active:scale-95"
            style={{
              borderColor: showEnvoiFilter || envoiFilter !== 'ALL' ? BRAND.navy : '#E5E7EB',
              background: showEnvoiFilter ? `${BRAND.navy}06` : 'white',
            }}
          >
            <Filter size={14} style={{ color: showEnvoiFilter || envoiFilter !== 'ALL' ? BRAND.navy : '#9CA3AF' }} />
            {envoiFilter !== 'ALL' && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white"
                style={{ background: BRAND.navy }}
              />
            )}
          </button>
        </div>

        {/* Search dropdown */}
        {hasSearch && (
          <div
            className="absolute top-full left-0 right-0 mt-1 z-30 rounded-xl overflow-hidden"
            style={{ maxHeight: 300, overflowY: 'auto', background: '#FFFFFF', border: '1px solid #E5E7EB', boxShadow: '0 4px 20px rgba(0,0,0,0.10)' }}
          >
            {!hasResults && (
              <p className="px-3 py-2.5 text-[13px] text-gray-400">Aucun résultat</p>
            )}

            {searchResults.clients.length > 0 && (
              <div>
                <div className="px-3 py-1 bg-gray-50 border-b border-gray-100">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Clients
                  </span>
                </div>
                {searchResults.clients.map((cl) => (
                  <button
                    key={cl.id}
                    onClick={() => setGlobalSearch('')}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div
                      className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-black"
                      style={{
                        background: BRAND.navy,
                        color: BRAND.goldL,
                      }}
                    >
                      {cl.nom.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-gray-800 truncate">{cl.nom}</p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {cl.ville} · {getDestByCP(cl.cp).flag} {getDestByCP(cl.cp).label}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searchResults.colis.length > 0 && (
              <div>
                <div className="px-3 py-1 bg-gray-50 border-b border-gray-100">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Colis
                  </span>
                </div>
                {searchResults.colis.map((c) => {
                  const cl = getClient(c.clientId);
                  return (
                    <button
                      key={c.id}
                      onClick={() => openColis(c.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div
                        className="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center"
                        style={{ background: `${BRAND.navy}10` }}
                      >
                        <Package size={12} style={{ color: BRAND.navy }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-bold text-gray-800">{c.ref}</p>
                          <Badge statut={c.statut} />
                        </div>
                        <p className="text-[11px] text-gray-400 truncate">
                          {cl?.nom ?? '—'} · {c.desc}
                        </p>
                      </div>
                      <ChevronRight size={12} className="text-gray-300 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Missing invoice alert (compact) ─────────────────────────────── */}
      {missingInvoices.length > 0 && (
        <div
          className="anim-fade stagger-3 flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
        >
          <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
          <span className="text-[12px] font-semibold text-amber-700">
            {missingInvoices.length} sans facture
          </span>
          <div className="flex gap-1 flex-wrap flex-1">
            {missingInvoices.map((c) => (
              <button
                key={c.id}
                onClick={() => openColis(c.id)}
                className="text-[11px] font-bold px-1.5 py-0.5 rounded transition-all hover:bg-amber-200 active:scale-95"
                style={{ color: '#92400E' }}
              >
                {c.ref}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Subscription expiration alert ─────────────────────────────── */}
      {expiringAbos.length > 0 && (
        <div
          className="anim-fade stagger-4 flex items-start gap-2 px-3 py-2 rounded-lg"
          style={{ background: '#FFF1F2', border: '1px solid #FECDD3' }}
        >
          <AlertTriangle size={13} className="text-rose-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="text-[12px] font-semibold text-rose-700">
              Abonnement{expiringAbos.length > 1 ? 's' : ''} bientôt expiré{expiringAbos.length > 1 ? 's' : ''}
            </span>
            <div className="flex gap-2 flex-wrap mt-1">
              {expiringAbos.map((c) => {
                const f = FORFAITS[c.forfait];
                const expired = c.joursRestants <= 0;
                return (
                  <span
                    key={c.id}
                    className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                    style={{
                      background: expired ? '#FEE2E2' : '#FFF7ED',
                      color: expired ? '#DC2626' : '#C2410C',
                    }}
                  >
                    {c.nom.split(' ')[0]} · {f?.label}
                    {expired ? ' (expiré)' : ` (${c.joursRestants}j)`}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Envoi filter (collapsible) ──────────────────────────────────── */}
      {showEnvoiFilter && (
        <div className="anim-slide-down flex gap-1.5 overflow-x-auto pb-0.5 -mt-1">
          <button
            onClick={() => setEnvoiFilter('ALL')}
            className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-md transition-all"
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
            className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-md transition-all"
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
              className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-md transition-all"
              style={
                envoiFilter === e.id
                  ? { background: BRAND.navy, color: 'white' }
                  : { background: '#F3F4F6', color: '#6B7280' }
              }
            >
              {labelEnvoi(e)}
              <span className="ml-1 text-[10px]" style={{ opacity: 0.6 }}>
                {STATUT_ENVOI[e.statut]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── View: par statut (grouped) ────────────────────────────────── */}
      {viewMode === 'status' && (
        <>
          {/* À faire */}
          {aFaire.length > 0 && (
            <div className="anim-fade stagger-4">
              <SectionHeader
                icon={CircleDot}
                label="À faire"
                count={aFaire.length}
                color={BRAND.navy}
                right={viewToggle}
              />
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
            </div>
          )}

          {/* En attente du client */}
          {attente.length > 0 && (
            <div className="anim-fade stagger-5">
              <SectionHeader
                icon={Clock}
                label="En attente du client"
                count={attente.length}
                color="#D97706"
                right={aFaire.length === 0 ? viewToggle : null}
              />
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
            </div>
          )}

          {/* Livrés */}
          {livres.length > 0 && (
            <div className="anim-fade stagger-6">
              <SectionHeader
                icon={CheckCircle}
                label="Livrés"
                count={livres.length}
                color="#16A34A"
                right={aFaire.length === 0 && attente.length === 0 ? viewToggle : null}
              />
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
            </div>
          )}

          {/* Empty state - only when ALL sections are empty */}
          {allSectionsEmpty && (
            <div className="anim-fade stagger-4">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: '#05966912' }}
                  >
                    <CheckCircle size={11} style={{ color: '#059669' }} strokeWidth={2.5} />
                  </div>
                  <span className="text-[13px] font-bold text-gray-800">Colis</span>
                </div>
                {viewToggle}
              </div>
              <div
                className="rounded-lg py-8 flex flex-col items-center text-center"
                style={{ background: '#F9FAFB', border: '1px dashed #E5E7EB' }}
              >
                <CheckCircle size={20} className="text-emerald-400 mb-1.5" />
                <p className="text-[13px] font-semibold text-gray-500">Tous les colis sont à jour</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {activeCard ? 'Aucun colis ne correspond au filtre actif' : 'Rien à traiter pour le moment'}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── View: par numéro de colis (flat sorted) ──────────────────────── */}
      {viewMode === 'numero' && (
        <div className="anim-fade stagger-4">
          <SectionHeader
            icon={Hash}
            label="Tous les colis"
            count={sortedByNumero.length}
            color={BRAND.navy}
            right={viewToggle}
          />
          {sortedByNumero.length === 0 ? (
            <div
              className="rounded-lg py-8 flex flex-col items-center text-center"
              style={{ background: '#F9FAFB', border: '1px dashed #E5E7EB' }}
            >
              <Package size={20} className="text-gray-300 mb-1.5" />
              <p className="text-[13px] font-semibold text-gray-500">Aucun colis</p>
            </div>
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

    </div>
  );
}
