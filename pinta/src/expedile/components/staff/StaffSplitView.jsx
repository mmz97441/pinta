import React, { useState, useMemo, useEffect } from 'react';
import {
  Search, X, Package, Clock, CheckCircle, Check, Wrench, CreditCard, Plane, Ruler,
  AlertTriangle, Filter, ChevronRight, Star, FileText,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, getDestByCP } from '../../constants';
import { eur, fuzzy } from '../../utils';
import { Badge, Etapes } from '../ui';
import StaffDetailView from './StaffDetailView';
import ColisInfo from '../detail/ColisInfo';
import FacturesPanel from '../detail/FacturesPanel';
import ChatPanel from '../detail/ChatPanel';
import AuditLog from '../detail/AuditLog';
import DetailHeader from '../detail/DetailHeader';

// ── Tab definitions ─────────────────────────────────────────────────────────
const TABS = [
  { key: 'all', label: 'Tout', filter: (c) => c.statut !== 'annule' },
  { key: 'todo', label: 'À traiter', filter: (c) => ['receptionne', 'mesure', 'autorise', 'en_preparation', 'paye'].includes(c.statut) },
  { key: 'waiting', label: 'Att. client', filter: (c) => ['attente_feu_vert', 'devis_envoye', 'attente_paiement'].includes(c.statut) },
  { key: 'shipping', label: 'Expédition', filter: (c) => ['expedie', 'transit', 'dedouanement', 'arrive', 'livraison'].includes(c.statut) },
  { key: 'done', label: 'Livrés', filter: (c) => c.statut === 'livre' },
];

// ── Statut icon map ─────────────────────────────────────────────────────────
function StatutIcon({ statut }) {
  const map = {
    receptionne: Package, mesure: Ruler, attente_feu_vert: Clock, autorise: CheckCircle,
    en_preparation: Wrench, devis_envoye: Star, attente_paiement: CreditCard,
    paye: CreditCard, expedie: Plane, transit: Plane, dedouanement: Clock,
    arrive: CheckCircle, livraison: Plane, livre: Check,
  };
  const Icon = map[statut] || Package;
  return <Icon size={12} />;
}

// ── Statut dot color ────────────────────────────────────────────────────────
function statutColor(s) {
  const map = {
    receptionne: '#F59E0B', mesure: '#EAB308', attente_feu_vert: '#F97316',
    autorise: '#22C55E', en_preparation: '#3B82F6', devis_envoye: '#D97706',
    attente_paiement: '#D97706', paye: '#10B981', expedie: '#06B6D4',
    transit: '#0EA5E9', dedouanement: '#8B5CF6', arrive: '#14B8A6',
    livraison: '#84CC16', livre: '#16A34A', annule: '#9CA3AF',
  };
  return map[s] || BRAND.navy;
}

// ════════════════════════════════════════════════════════════════════════════
// COLIS ROW — compact list item
// ════════════════════════════════════════════════════════════════════════════
function ColisRow({ colis, client, isActive, onClick }) {
  const hasValidFacture = colis.factures?.some((f) => f.valide);
  const missingFacture = !hasValidFacture && colis.statut !== 'livre' && colis.statut !== 'annule';
  const dest = getDestByCP(client?.cp);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-all border-l-3 ${
        isActive
          ? 'bg-blue-50 border-l-[3px]'
          : 'hover:bg-gray-50 border-l-[3px] border-transparent'
      }`}
      style={isActive ? { borderLeftColor: statutColor(colis.statut) } : {}}
    >
      {/* Status dot */}
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: statutColor(colis.statut) }}
      />

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-black text-gray-800">{colis.ref}</span>
          {colis.casier && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-100 text-gray-500">{colis.casier}</span>
          )}
          {missingFacture && (
            <FileText size={10} className="text-amber-500" title="Facture manquante" />
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[11px] text-gray-500 truncate">{client?.nom || '—'}</span>
          {dest?.flag && <span className="text-[10px]">{dest.flag}</span>}
        </div>
      </div>

      {/* Right side: status + amount */}
      <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: `${statutColor(colis.statut)}18`, color: statutColor(colis.statut) }}
        >
          {STATUTS[colis.statut]?.label?.split(' ')[0] || colis.statut}
        </span>
        {colis.devisTotal > 0 && (
          <span className="text-[10px] font-bold text-gray-600">{eur(colis.devisTotal)}</span>
        )}
      </div>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DETAIL PANEL — right side (reuses existing components)
// ════════════════════════════════════════════════════════════════════════════
function DetailPanel({ onClose }) {
  const { sel } = useApp();

  if (!sel) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <Package size={40} className="text-gray-200 mb-3" />
        <p className="text-sm font-semibold text-gray-400">Sélectionnez un colis</p>
        <p className="text-xs text-gray-300 mt-1">Cliquez sur un colis dans la liste pour voir son détail</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Compact header for detail */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: statutColor(sel.statut) }}
          />
          <span className="text-sm font-black" style={{ color: BRAND.navy }}>{sel.ref}</span>
          <Badge statut={sel.statut} />
        </div>
        {/* Close button for mobile */}
        <button
          onClick={onClose}
          className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
        >
          <X size={16} />
        </button>
      </div>

      {/* Status steps */}
      <div className="px-4 pt-3">
        <Etapes statut={sel.statut} />
      </div>

      {/* Two-column detail inside panel */}
      <div className="p-4 space-y-4">
        {/* Actions (most important — first) */}
        <StaffDetailView />
        {/* Info */}
        <ColisInfo />
        {/* Factures */}
        <FacturesPanel />
        {/* Chat */}
        <ChatPanel />
        {/* Audit */}
        <AuditLog />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN SPLIT VIEW
// ════════════════════════════════════════════════════════════════════════════
export default function StaffSplitView({ onNewColis }) {
  const { data, clients, getClient, setSelId, sel, archiverColis } = useApp();

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('todo');
  const [showArchive, setShowArchive] = useState(false);

  // Mobile: show detail panel full-screen when a colis is selected
  const [mobileDetail, setMobileDetail] = useState(false);

  // Select a colis
  const selectColis = (id) => {
    setSelId(id);
    setMobileDetail(true); // On mobile, show detail
  };

  const closeDetail = () => {
    setSelId(null);
    setMobileDetail(false);
  };

  // ── Filter pipeline ────────────────────────────────────────────────────
  const pool = useMemo(() => {
    let list = showArchive ? data : data.filter((c) => !c.archive);
    // Apply tab filter
    const tab = TABS.find((t) => t.key === activeTab);
    if (tab) list = list.filter(tab.filter);
    return list;
  }, [data, activeTab, showArchive]);

  // Search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return pool;
    return pool.filter((c) => {
      const cl = getClient(c.clientId);
      const txt = `${c.ref} ${c.desc || ''} ${cl?.nom || ''} ${c.casier || ''} ${c.trackings?.join(' ') || ''}`;
      return fuzzy(txt, search);
    });
  }, [pool, search, getClient]);

  // Tab counts (from full non-archived data)
  const tabCounts = useMemo(() => {
    const base = data.filter((c) => !c.archive);
    return TABS.reduce((acc, tab) => {
      acc[tab.key] = base.filter(tab.filter).length;
      return acc;
    }, {});
  }, [data]);

  const archivedCount = useMemo(() => data.filter((c) => c.archive).length, [data]);

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex h-[calc(100vh-52px)]">

      {/* ══════════════ LEFT PANEL — List ══════════════ */}
      <div
        className={`flex flex-col border-r border-gray-200 bg-white ${
          mobileDetail ? 'hidden lg:flex' : 'flex'
        }`}
        style={{ width: '100%', maxWidth: '400px', minWidth: '320px' }}
      >
        {/* Search bar */}
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="w-full pl-8 pr-8 py-2 text-xs rounded-lg border border-gray-200 outline-none transition-all focus:border-blue-400"
              style={{ color: BRAND.navy }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-3 py-2 text-[11px] font-bold whitespace-nowrap transition-all border-b-2 ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                activeTab === tab.key ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
              }`}>
                {tabCounts[tab.key] || 0}
              </span>
            </button>
          ))}
        </div>

        {/* Colis list */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package size={24} className="text-gray-200 mb-2" />
              <p className="text-xs text-gray-400">Aucun colis</p>
            </div>
          ) : (
            filtered.map((c) => (
              <ColisRow
                key={c.id}
                colis={c}
                client={getClient(c.clientId)}
                isActive={sel?.id === c.id}
                onClick={() => selectColis(c.id)}
              />
            ))
          )}
        </div>

        {/* Footer: count + archive toggle */}
        <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
          <span>{filtered.length} colis</span>
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchive((p) => !p)}
              className={`font-bold ${showArchive ? 'text-blue-500' : 'text-gray-400'}`}
            >
              {showArchive ? `${archivedCount} archivés (visible)` : `${archivedCount} archivés`}
            </button>
          )}
        </div>
      </div>

      {/* ══════════════ RIGHT PANEL — Detail ══════════════ */}
      <div
        className={`flex-1 bg-gray-50 ${
          mobileDetail ? 'flex flex-col' : 'hidden lg:flex lg:flex-col'
        }`}
      >
        <DetailPanel onClose={closeDetail} />
      </div>

      {/* ══════════════ FAB — Nouveau colis ══════════════ */}
      <button
        onClick={onNewColis}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 pl-4 pr-5 py-3.5 rounded-2xl text-sm font-black transition-all active:scale-95 shadow-xl hover:shadow-2xl"
        style={{
          background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
          color: BRAND.navyD,
          boxShadow: `0 4px 20px ${BRAND.gold}50`,
        }}
      >
        <span className="text-lg leading-none">+</span>
        Nouveau colis
      </button>
    </div>
  );
}
