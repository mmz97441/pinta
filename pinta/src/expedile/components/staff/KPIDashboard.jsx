import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, TrendingUp, Package, Target, ShoppingCart } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, DESTINATIONS, getDestByCP } from '../../constants';
import { eur } from '../../utils';

// ── Pipeline groups for KPI ──
const KPI_PIPELINE = [
  { key: 'reception',   label: 'Reception',    statuts: ['receptionne', 'mesure'],                              color: '#D97706' },
  { key: 'feu_vert',    label: 'Feu vert',     statuts: ['attente_feu_vert'],                                   color: '#F97316' },
  { key: 'preparation', label: 'Preparation',   statuts: ['autorise', 'en_preparation'],                        color: '#2563EB' },
  { key: 'paiement',    label: 'Paiement',     statuts: ['devis_envoye', 'attente_paiement'],                   color: '#A21CAF' },
  { key: 'expedition',  label: 'Expedition',    statuts: ['paye', 'expedie', 'transit', 'dedouanement'],        color: '#0891B2' },
  { key: 'livre',       label: 'Livre',         statuts: ['arrive', 'livraison', 'livre'],                      color: '#16A34A' },
];

export default function KPIDashboard() {
  const navigate = useNavigate();
  const { data, clients, envois, authRole } = useApp();

  const isDirection = ['directeur', 'vice_directeur'].includes(authRole);

  // ── Row 1: Key metrics ──
  const caTotal = useMemo(
    () => data.filter((c) => c.statut !== 'annule' && c.paiementMontant).reduce((s, c) => s + (c.paiementMontant || 0), 0),
    [data],
  );

  const caMois = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return data
      .filter((c) => {
        if (c.statut === 'annule' || !c.paiementMontant || !c.paiementDate) return false;
        const d = new Date(c.paiementDate);
        return d.getFullYear() === y && d.getMonth() === m;
      })
      .reduce((s, c) => s + (c.paiementMontant || 0), 0);
  }, [data]);

  const panierMoyen = useMemo(() => {
    const paid = data.filter((c) => c.paiementMontant && c.devisTotal && c.statut !== 'annule');
    if (paid.length === 0) return 0;
    return paid.reduce((s, c) => s + c.devisTotal, 0) / paid.length;
  }, [data]);

  const colisTraites = useMemo(
    () => data.filter((c) => c.statut === 'livre').length,
    [data],
  );

  // ── Row 2: Pipeline counts ──
  const pipelineCounts = useMemo(
    () => KPI_PIPELINE.map((p) => ({
      ...p,
      count: data.filter((c) => p.statuts.includes(c.statut)).length,
    })),
    [data],
  );

  const pipelineTotal = useMemo(
    () => pipelineCounts.reduce((s, p) => s + p.count, 0),
    [pipelineCounts],
  );

  // ── Row 3: CA par destination ──
  const destStats = useMemo(() => {
    const dests = ['974', '976', '971', '972'];
    return dests.map((code) => {
      const dest = DESTINATIONS[code];
      const colisDest = data.filter((c) => {
        if (c.statut === 'annule') return false;
        const cl = clients.find((x) => x.id === c.clientId);
        if (!cl) return false;
        const d = getDestByCP(cl.cp);
        return d.code === code;
      });
      const count = colisDest.length;
      const ca = colisDest.filter((c) => c.paiementMontant).reduce((s, c) => s + (c.paiementMontant || 0), 0);
      return { ...dest, count, ca };
    });
  }, [data, clients]);

  // ── Row 4: Objectives ──
  const colisThisMonth = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return data.filter((c) => {
      if (c.statut === 'annule' || !c.dateReception) return false;
      const d = new Date(c.dateReception);
      return d.getFullYear() === y && d.getMonth() === m;
    }).length;
  }, [data]);

  const objectifColis = 50;
  const objectifCA = 5000;
  const progressColis = objectifColis > 0 ? (colisThisMonth / objectifColis) * 100 : 0;
  const progressCA = objectifCA > 0 ? (caMois / objectifCA) * 100 : 0;

  // ── Row 5: Alerts ──
  const blockedOver7 = useMemo(() => {
    const now = new Date();
    return data.filter((c) => {
      if (c.statut === 'annule' || c.statut === 'livre') return false;
      if (!c.dateReception) return false;
      const diff = (now - new Date(c.dateReception)) / (1000 * 60 * 60 * 24);
      return diff > 7 && ['receptionne', 'mesure', 'attente_feu_vert'].includes(c.statut);
    }).length;
  }, [data]);

  const facturesManquantes = useMemo(
    () => data.filter((c) => {
      if (c.statut === 'annule' || c.statut === 'livre') return false;
      return !c.factures || c.factures.length === 0 || !c.factures.some((f) => f.valide);
    }).length,
    [data],
  );

  const abonnementsExpirants = useMemo(() => {
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return clients.filter((cl) => {
      if (!cl.abonnement || cl.abonnement === 'freemium' || !cl.abonnementFin) return false;
      return new Date(cl.abonnementFin) <= in7;
    }).length;
  }, [clients]);

  // ── Progress bar color helper ──
  function progressColor(pct) {
    if (pct >= 100) return '#16A34A';
    if (pct >= 70) return '#D97706';
    return '#DC2626';
  }

  return (
    <div className="space-y-4">

      {/* ── Row 1: Key Metrics (direction only) ── */}
      {isDirection && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard label="CA Total" value={eur(caTotal)} icon={TrendingUp} color={BRAND.navy} onClick={() => navigate('/colis')} />
          <MetricCard label="CA ce mois" value={eur(caMois)} icon={TrendingUp} color="#059669" onClick={() => navigate('/colis')} />
          <MetricCard label="Panier moyen" value={eur(panierMoyen)} icon={ShoppingCart} color="#7C3AED" onClick={() => navigate('/colis')} />
          <MetricCard label="Colis livres" value={colisTraites} icon={Package} color="#16A34A" onClick={() => navigate('/colis?tab=done')} />
        </div>
      )}

      {/* ── Row 2: Pipeline ── */}
      <div className="card p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Pipeline ({pipelineTotal} colis actifs)</p>
        <div className="flex gap-2 flex-wrap">
          {pipelineCounts.map((p) => (
            <button
              key={p.key}
              onClick={() => navigate(`/colis?tab=${p.key}`)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:shadow-md active:scale-95"
              style={{ background: `${p.color}12`, border: `1px solid ${p.color}30` }}
            >
              <span className="text-lg font-black" style={{ color: p.color }}>{p.count}</span>
              <span className="text-xs font-semibold text-gray-600">{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Row 3: CA par destination (direction only) ── */}
      {isDirection && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {destStats.map((d) => (
            <button
              key={d.code}
              onClick={() => navigate(`/colis?dest=${d.code}`)}
              className="card p-4 rounded-2xl text-left hover:shadow-md transition-all active:scale-[0.98]"
              style={{ borderLeft: `3px solid ${BRAND.gold}` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{d.flag}</span>
                <span className="text-sm font-bold" style={{ color: BRAND.navy }}>{d.label}</span>
              </div>
              <p className="text-xs text-gray-500">{d.count} colis</p>
              <p className="text-sm font-bold" style={{ color: BRAND.navy }}>{eur(d.ca)}</p>
            </button>
          ))}
        </div>
      )}

      {/* ── Row 4: Objectifs (visible to all staff) ── */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target size={16} style={{ color: BRAND.navy }} />
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Objectifs du mois</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ObjectiveBar
            label={`Colis traites: ${colisThisMonth} / ${objectifColis}`}
            pct={progressColis}
            color={progressColor(progressColis)}
          />
          {isDirection && (
            <ObjectiveBar
              label={`CA: ${eur(caMois)} / ${eur(objectifCA)}`}
              pct={progressCA}
              color={progressColor(progressCA)}
            />
          )}
        </div>
      </div>

      {/* ── Row 5: Alertes actives (direction only) ── */}
      {isDirection && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <AlertCard label="Colis bloques > 7j" count={blockedOver7} color="#DC2626" onClick={() => navigate('/colis?tab=reception')} />
          <AlertCard label="Factures manquantes" count={facturesManquantes} color="#D97706" onClick={() => navigate('/colis')} />
          <AlertCard label="Abo. expirants" count={abonnementsExpirants} color="#7C3AED" onClick={() => navigate('/clients')} />
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function MetricCard({ label, value, icon: Icon, color, onClick }) {
  return (
    <button onClick={onClick} className="card p-4 rounded-2xl text-left hover:shadow-md transition-all active:scale-[0.98]">
      <div className="flex items-center gap-2 mb-1">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}15` }}
        >
          <Icon size={14} style={{ color }} strokeWidth={2.5} />
        </div>
        <span className="text-xs font-semibold text-gray-500">{label}</span>
      </div>
      <p className="text-lg font-black mt-1" style={{ color }}>{value}</p>
    </button>
  );
}

function ObjectiveBar({ label, pct, color }) {
  const clamped = Math.min(pct, 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <span className="text-xs font-bold" style={{ color }}>{Math.round(pct)}%</span>
      </div>
      <div className="w-full h-2.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function AlertCard({ label, count, color, onClick }) {
  return (
    <button
      onClick={onClick}
      className="card p-4 rounded-2xl text-left hover:shadow-md transition-shadow w-full"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} style={{ color }} />
        <span className="text-xs font-semibold text-gray-600">{label}</span>
      </div>
      <p className="text-2xl font-black mt-1" style={{ color }}>{count}</p>
    </button>
  );
}
