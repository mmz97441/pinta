import React, { useState, useMemo } from 'react';
import {
  Plus, Search, X, BarChart3, CircleDot, Clock, CheckCircle,
  ChevronRight, ChevronDown, AlertTriangle, Filter, Package,
  User, Clipboard, Ruler, Wrench, CreditCard, Plane, Star,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, STATUT_ENVOI, getDestByCP } from '../../constants';
import { eur, labelEnvoi, trackStr, trackCount, hasTrack, searchGlobal } from '../../utils';
import { Badge } from '../ui';

// ── Statut groups ──────────────────────────────────────────────────────────────
const STATUTS_A_FAIRE = [
  'annonce', 'receptionne', 'mesure', 'autorise',
  'en_preparation', 'paye', 'expedie', 'transit', 'arrive', 'livraison',
];
const STATUTS_ATTENTE = ['attente_feu_vert', 'devis_envoye', 'attente_paiement'];
const STATUTS_LIVRE = ['livre'];

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

// ── Colis card ───────────────────────────────────────────────────────────────
function ColisCard({ c, client, envois, onClick, stagger }) {
  const StatutIco = statutIcon(c.statut);
  const envoi = envois.find((e) => e.id === c.envoi);
  const dest = getDestByCP(client?.cp);
  const missingFacture = c.factures && c.factures.some((f) => !f.valide);

  return (
    <button
      onClick={onClick}
      className={`card-elevated w-full text-left p-3.5 anim-fade stagger-${Math.min(stagger, 8)} group`}
    >
      <div className="flex items-start gap-3">
        {/* Icon col */}
        <div
          className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `${BRAND.navy}12` }}
        >
          <StatutIco size={16} style={{ color: BRAND.navy }} strokeWidth={2} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Row 1: ref + badge */}
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
            {missingFacture && (
              <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
            )}
          </div>

          {/* Row 2: badge statut */}
          <div className="mt-1">
            <Badge statut={c.statut} />
          </div>

          {/* Row 3: client + dest */}
          <div className="mt-1.5 flex items-center gap-1.5">
            <User size={11} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-600 font-medium truncate">{client?.nom ?? '—'}</span>
            {dest && (
              <span className="text-xs text-gray-400 flex-shrink-0">{dest.flag}</span>
            )}
          </div>

          {/* Row 4: description */}
          {c.desc && (
            <p className="mt-0.5 text-xs text-gray-500 truncate">{c.desc}</p>
          )}

          {/* Row 5: dims + tracking */}
          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            <DimsChip c={c} />
            {hasTrack(c) && (
              <span className="text-xs text-gray-400 font-mono truncate max-w-[160px]">
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

// ── Main component ───────────────────────────────────────────────────────────
export default function StaffDashboard({ onNewColis }) {
  const { data, clients, envois, setSelId, getClient, isStaff, page } = useApp();

  const [globalSearch, setGlobalSearch] = useState('');
  const [envoiFilter, setEnvoiFilter] = useState('ALL');
  const [pipeFilter, setPipeFilter] = useState(null);
  const [pipeExpand, setPipeExpand] = useState(false);

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

  // ── Filtered pool by pipeline chip ───────────────────────────────────────
  const pipeStatuts = useMemo(() => {
    if (!pipeFilter) return null;
    return pipeFilter.split(',').map((s) => s.trim());
  }, [pipeFilter]);

  const activePool = useMemo(() => {
    if (!pipeStatuts) return envoiFiltered;
    return envoiFiltered.filter((c) => pipeStatuts.includes(c.statut));
  }, [envoiFiltered, pipeStatuts]);

  // ── Main lists ────────────────────────────────────────────────────────────
  const aFaire = useMemo(
    () => activePool.filter((c) => STATUTS_A_FAIRE.includes(c.statut)),
    [activePool],
  );
  const attente = useMemo(
    () => activePool.filter((c) => STATUTS_ATTENTE.includes(c.statut)),
    [activePool],
  );
  const livres = useMemo(
    () => activePool.filter((c) => STATUTS_LIVRE.includes(c.statut)),
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

  // ── Pipeline counts ───────────────────────────────────────────────────────
  const pipelineCounts = useMemo(() => {
    return PIPELINE.map((p) => ({
      ...p,
      count: envoiFiltered.filter((c) => p.statuts.includes(c.statut)).length,
    }));
  }, [envoiFiltered]);

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

  const togglePipeFilter = (statuts) => {
    const key = statuts.join(',');
    setPipeFilter((prev) => (prev === key ? null : key));
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5 pb-24">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="anim-fade flex items-center justify-between gap-3 pt-1">
        <div>
          <h1
            className="text-xl font-black tracking-tight leading-none"
            style={{ color: BRAND.navy, letterSpacing: '-0.025em' }}
          >
            Tableau de bord
          </h1>
          <p className="text-xs text-gray-400 mt-0.5 font-medium">
            {totalAll} colis actifs
          </p>
        </div>
        <button
          onClick={onNewColis}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
          style={{
            background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
            color: BRAND.navyD,
            boxShadow: `0 2px 12px ${BRAND.gold}40`,
          }}
        >
          <Plus size={15} strokeWidth={2.5} />
          Réceptionner
        </button>
      </div>

      {/* ── Global search ────────────────────────────────────────────────── */}
      <div className="anim-fade stagger-1 relative">
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            type="text"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Rechercher client, colis, tracking…"
            className="w-full pl-9 pr-8 py-2.5 text-sm rounded-xl border border-gray-200 bg-white outline-none transition-all"
            style={{ color: BRAND.navy }}
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

        {/* Search dropdown */}
        {hasSearch && (
          <div
            className="absolute top-full left-0 right-0 mt-1.5 z-30 card-elevated overflow-hidden"
            style={{ maxHeight: 320, overflowY: 'auto' }}
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

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <div className="anim-fade stagger-2 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* À traiter */}
        <div
          className="card p-4"
          style={{ borderLeft: `3px solid ${BRAND.navy}` }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                À traiter
              </p>
              <p
                className="text-3xl font-black mt-0.5 leading-none"
                style={{ color: BRAND.navy }}
              >
                {totalAFaire}
              </p>
            </div>
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: `${BRAND.navy}12` }}
            >
              <CircleDot size={16} style={{ color: BRAND.navy }} />
            </div>
          </div>
        </div>

        {/* Att. client */}
        <div
          className="card p-4"
          style={{ borderLeft: '3px solid #D97706' }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                Att. client
              </p>
              <p className="text-3xl font-black mt-0.5 leading-none text-amber-600">
                {totalAttente}
              </p>
            </div>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-50">
              <Clock size={16} className="text-amber-600" />
            </div>
          </div>
        </div>

        {/* Prêts / Expédiés */}
        <div
          className="card p-4"
          style={{ borderLeft: '3px solid #059669' }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                Prêts / Expédiés
              </p>
              <p className="text-3xl font-black mt-0.5 leading-none text-emerald-600">
                {totalPretExpedies}
              </p>
            </div>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-emerald-50">
              <CheckCircle size={16} className="text-emerald-600" />
            </div>
          </div>
        </div>

        {/* Total */}
        <div
          className="card p-4"
          style={{ borderLeft: `3px solid ${BRAND.gold}` }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                Total
              </p>
              <p
                className="text-3xl font-black mt-0.5 leading-none"
                style={{ color: BRAND.goldD }}
              >
                {totalAll}
              </p>
            </div>
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: `${BRAND.gold}18` }}
            >
              <BarChart3 size={16} style={{ color: BRAND.goldD }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Missing invoice alert ─────────────────────────────────────────── */}
      {missingInvoices.length > 0 && (
        <div
          className="anim-fade stagger-3 flex items-start gap-2.5 p-3.5 rounded-xl"
          style={{
            background: '#FEF3C720',
            border: '1px solid #FCD34D60',
          }}
        >
          <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-800">
              {missingInvoices.length} colis sans facture validée
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              {missingInvoices.map((c) => c.ref).join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* ── Envoi filter ──────────────────────────────────────────────────── */}
      <div className="anim-fade stagger-3">
        <div className="flex items-center gap-2 mb-2">
          <Filter size={13} className="text-gray-400" />
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Filtrer par envoi
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
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
      </div>

      {/* ── Pipeline chips ────────────────────────────────────────────────── */}
      <div className="anim-fade stagger-4">
        <button
          onClick={() => setPipeExpand((p) => !p)}
          className="flex items-center gap-1.5 mb-2.5 group"
        >
          <BarChart3 size={13} className="text-gray-400" />
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Pipeline
          </span>
          {pipeFilter && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1"
              style={{ background: `${BRAND.gold}22`, color: BRAND.goldD }}
            >
              filtre actif
            </span>
          )}
          <ChevronDown
            size={13}
            className={`ml-auto text-gray-400 transition-transform ${pipeExpand ? 'rotate-180' : ''}`}
          />
        </button>

        <div className="flex gap-2 flex-wrap">
          {pipelineCounts.map((p) => {
            const Icon = p.icon;
            const isActive = pipeFilter === p.statuts.join(',');
            return (
              <button
                key={p.key}
                onClick={() => togglePipeFilter(p.statuts)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold transition-all"
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
        </div>

        {/* Expanded: per-statut breakdown */}
        {pipeExpand && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5 anim-slide-down">
            {Object.entries(STATUTS)
              .filter(([, s]) => s.phase > 0)
              .map(([key, s]) => {
                const cnt = envoiFiltered.filter((c) => c.statut === key).length;
                if (cnt === 0) return null;
                return (
                  <button
                    key={key}
                    onClick={() => togglePipeFilter([key])}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all"
                    style={
                      pipeFilter === key
                        ? { background: BRAND.navy, color: 'white' }
                        : { background: '#F9FAFB', border: '1px solid #F3F4F6' }
                    }
                  >
                    <span
                      className="text-[11px] font-semibold truncate"
                      style={{ color: pipeFilter === key ? 'white' : '#374151' }}
                    >
                      {s.label}
                    </span>
                    <span
                      className="text-[11px] font-black ml-1.5 flex-shrink-0"
                      style={{ color: pipeFilter === key ? BRAND.gold : BRAND.navy }}
                    >
                      {cnt}
                    </span>
                  </button>
                );
              })}
          </div>
        )}

        {pipeFilter && (
          <button
            onClick={() => setPipeFilter(null)}
            className="mt-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={11} />
            Effacer le filtre pipeline
          </button>
        )}
      </div>

      {/* ── À faire ──────────────────────────────────────────────────────── */}
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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

      {/* ── En attente du client ──────────────────────────────────────────── */}
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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

      {/* ── Livrés ───────────────────────────────────────────────────────── */}
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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

    </div>
  );
}
