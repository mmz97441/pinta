import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, TrendingUp, TrendingDown, Package, Target, ShoppingCart, Plane,
  Users, FileText, Clock, CheckCircle, CreditCard, Crown, Zap, UserPlus, Send,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, DESTINATIONS, ABONNEMENTS, getDestByCP } from '../../constants';
import { eur } from '../../utils';

// ── Pipeline groups for KPI ──
const KPI_PIPELINE = [
  { key: 'reception',   label: 'Réception',    statuts: ['receptionne', 'mesure'],                              color: '#D97706' },
  { key: 'feu_vert',    label: 'Feu vert',     statuts: ['attente_feu_vert'],                                   color: '#F97316' },
  { key: 'preparation', label: 'Préparation',  statuts: ['autorise', 'en_preparation'],                         color: '#2563EB' },
  { key: 'paiement',    label: 'Paiement',     statuts: ['devis_envoye'],                                       color: '#A21CAF' },
  { key: 'expedition',  label: 'Expédition',   statuts: ['paye', 'expedie', 'transit', 'dedouanement'],         color: '#0891B2' },
  { key: 'livre',       label: 'Livré',        statuts: ['arrive', 'livraison', 'livre'],                       color: '#16A34A' },
];

// Helper : date range utils
function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfPrevMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() - 1, 1); }
function startOfWeek(d = new Date()) { const x = new Date(d); const day = x.getDay() || 7; x.setDate(x.getDate() - day + 1); x.setHours(0,0,0,0); return x; }
function daysBetween(a, b) { return (b - a) / (1000 * 60 * 60 * 24); }
function pctChange(curr, prev) { if (!prev) return curr > 0 ? 100 : 0; return ((curr - prev) / prev) * 100; }

export default function KPIDashboard() {
  const navigate = useNavigate();
  const { data, clients, envois, authRole } = useApp();

  const isDirection = ['directeur', 'vice_directeur'].includes(authRole);
  const isLogistic = ['directeur', 'vice_directeur', 'logisticien'].includes(authRole);

  // ══════════ KPIs FINANCIERS ══════════
  const caTotal = useMemo(
    () => data.filter((c) => c.statut !== 'annule' && c.paiementMontant).reduce((s, c) => s + (c.paiementMontant || 0), 0),
    [data],
  );

  const caMois = useMemo(() => {
    const start = startOfMonth();
    return data.filter((c) => c.paiementMontant && c.paiementDate && new Date(c.paiementDate) >= start)
      .reduce((s, c) => s + (c.paiementMontant || 0), 0);
  }, [data]);

  const caMoisPrev = useMemo(() => {
    const start = startOfPrevMonth();
    const end = startOfMonth();
    return data.filter((c) => {
      if (!c.paiementMontant || !c.paiementDate) return false;
      const d = new Date(c.paiementDate);
      return d >= start && d < end;
    }).reduce((s, c) => s + (c.paiementMontant || 0), 0);
  }, [data]);

  const caSemaine = useMemo(() => {
    const start = startOfWeek();
    return data.filter((c) => c.paiementMontant && c.paiementDate && new Date(c.paiementDate) >= start)
      .reduce((s, c) => s + (c.paiementMontant || 0), 0);
  }, [data]);

  const evolutionMois = useMemo(() => pctChange(caMois, caMoisPrev), [caMois, caMoisPrev]);

  const panierMoyen = useMemo(() => {
    const paid = data.filter((c) => c.paiementMontant && c.devisTotal && c.statut !== 'annule');
    if (paid.length === 0) return 0;
    return paid.reduce((s, c) => s + c.devisTotal, 0) / paid.length;
  }, [data]);

  // Taux conversion (devis → payé)
  const tauxConversion = useMemo(() => {
    const devisEnvoyes = data.filter((c) => c.devisTotal > 0 && ['devis_envoye', 'paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre'].includes(c.statut)).length;
    const payes = data.filter((c) => c.paiementMontant > 0).length;
    if (devisEnvoyes === 0) return 0;
    return (payes / devisEnvoyes) * 100;
  }, [data]);

  const colisTraites = useMemo(() => data.filter((c) => c.statut === 'livre').length, [data]);

  const nouveauxClients = useMemo(() => {
    const start = startOfMonth();
    return clients.filter((c) => c.created && new Date(c.created) >= start).length;
  }, [clients]);

  // ══════════ PIPELINE ══════════
  const pipelineCounts = useMemo(
    () => KPI_PIPELINE.map((p) => ({ ...p, count: data.filter((c) => p.statuts.includes(c.statut)).length })),
    [data],
  );
  const pipelineTotal = useMemo(() => pipelineCounts.reduce((s, p) => s + p.count, 0), [pipelineCounts]);

  // ══════════ DESTINATIONS ══════════
  const destStats = useMemo(() => {
    return ['974', '976', '971', '972'].map((code) => {
      const dest = DESTINATIONS[code];
      const colisDest = data.filter((c) => {
        if (c.statut === 'annule') return false;
        const cl = clients.find((x) => x.id === c.clientId);
        if (!cl) return false;
        const d = getDestByCP(cl.cp);
        return d?.code === code;
      });
      return {
        ...dest,
        count: colisDest.length,
        ca: colisDest.filter((c) => c.paiementMontant).reduce((s, c) => s + (c.paiementMontant || 0), 0),
      };
    });
  }, [data, clients]);

  // ══════════ PROCHAIN ENVOI (vedette logisticien) ══════════
  const prochainEnvoi = useMemo(() => {
    const now = new Date();
    const upcoming = envois
      .filter((e) => e.statut !== 'archive' && e.statut !== 'parti' && e.date && new Date(e.date) >= now)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!upcoming) return null;
    const colisInEnvoi = data.filter((c) => c.envoi === upcoming.id && c.statut !== 'annule');
    const totalPoids = colisInEnvoi.reduce((s, c) => s + (c.finP || c.poids || 0), 0);
    const byDest = {};
    colisInEnvoi.forEach((c) => {
      const cl = clients.find((x) => x.id === c.clientId);
      const d = getDestByCP(cl?.cp);
      if (d) byDest[d.code] = (byDest[d.code] || 0) + 1;
    });
    return {
      envoi: upcoming,
      colis: colisInEnvoi,
      totalPoids,
      byDest,
      joursRestants: Math.ceil(daysBetween(now, new Date(upcoming.date))),
    };
  }, [envois, data, clients]);

  // ══════════ ABONNEMENTS ══════════
  const abonnementStats = useMemo(() => {
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const nonFreemium = clients.filter((c) => c.abonnement && c.abonnement !== 'freemium');
    const expired = nonFreemium.filter((c) => c.abonnementFin && new Date(c.abonnementFin) < now);
    const expiring7 = nonFreemium.filter((c) => c.abonnementFin && new Date(c.abonnementFin) >= now && new Date(c.abonnementFin) <= in7);
    const expiring30 = nonFreemium.filter((c) => c.abonnementFin && new Date(c.abonnementFin) > in7 && new Date(c.abonnementFin) <= in30);
    const actifs = nonFreemium.filter((c) => !c.abonnementFin || new Date(c.abonnementFin) >= now);

    // Par type
    const vip = actifs.filter((c) => c.abonnement === 'vip').length;
    const premiumAn = actifs.filter((c) => c.abonnement === 'premium_annuel').length;
    const premiumMois = actifs.filter((c) => c.abonnement === 'premium_mensuel').length;
    const freemium = clients.length - nonFreemium.length;

    // À convertir : clients freemium avec 3+ colis
    const aConvertir = clients.filter((cl) => {
      if (cl.abonnement && cl.abonnement !== 'freemium') return false;
      const nbColis = data.filter((c) => c.clientId === cl.id && c.statut !== 'annule').length;
      return nbColis >= 3;
    });

    return { expired, expiring7, expiring30, actifs, vip, premiumAn, premiumMois, freemium, aConvertir };
  }, [clients, data]);

  // ══════════ OBJECTIFS ══════════
  const colisThisMonth = useMemo(() => {
    const start = startOfMonth();
    return data.filter((c) => c.statut !== 'annule' && c.dateReception && new Date(c.dateReception) >= start).length;
  }, [data]);

  const objectifColis = 50;
  const objectifCA = 5000;
  const progressColis = (colisThisMonth / objectifColis) * 100;
  const progressCA = (caMois / objectifCA) * 100;

  // ══════════ ALERTES ══════════
  const blockedOver7 = useMemo(() => data.filter((c) => {
    if (c.statut === 'annule' || c.statut === 'livre' || !c.dateReception) return false;
    const diff = daysBetween(new Date(c.dateReception), new Date());
    return diff > 7 && ['receptionne', 'mesure', 'attente_feu_vert'].includes(c.statut);
  }).length, [data]);

  const facturesManquantes = useMemo(() => data.filter((c) => {
    if (c.statut === 'annule' || c.statut === 'livre') return false;
    return !c.factures || c.factures.length === 0 || !c.factures.some((f) => f.valide);
  }).length, [data]);

  const paiementsEnRetard = useMemo(() => data.filter((c) => {
    if (c.statut !== 'devis_envoye' || !c.devisEnvoyeDate) return false;
    return daysBetween(new Date(c.devisEnvoyeDate), new Date()) > 3;
  }).length, [data]);

  const colisSansEnvoi = useMemo(() => data.filter((c) =>
    ['paye'].includes(c.statut) && !c.envoi
  ).length, [data]);

  // ══════════ ACTIVITÉ RÉCENTE ══════════
  const recentActivity = useMemo(() => {
    const events = [];
    data.forEach((c) => {
      const cl = clients.find((x) => x.id === c.clientId);
      const nom = cl?.nom || '?';
      if (c.paiementDate) events.push({ type: 'paye', date: c.paiementDate, icon: CheckCircle, color: '#16A34A', text: `${nom} a payé ${c.ref}`, amount: eur(c.paiementMontant) });
      if (c.dateReception && c.statut !== 'annule') events.push({ type: 'reception', date: c.dateReception, icon: Package, color: '#D97706', text: `${c.ref} réceptionné (${nom})` });
    });
    return events.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  }, [data, clients]);

  // Helper
  function timeAgo(date) {
    const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (mins < 1) return 'à l\'instant';
    if (mins < 60) return `il y a ${mins}min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `il y a ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `il y a ${days}j`;
  }

  function progressColor(pct) {
    if (pct >= 100) return '#16A34A';
    if (pct >= 70) return '#D97706';
    return '#DC2626';
  }

  // ══════════ RENDU ══════════
  return (
    <div className="space-y-4">

      {/* ── ALERTES URGENTES (tout le staff) ── */}
      {(blockedOver7 > 0 || facturesManquantes > 0 || paiementsEnRetard > 0 || abonnementStats.expiring7.length > 0) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {blockedOver7 > 0 && (
            <AlertCard
              icon={Clock}
              label="Colis bloqués > 7j"
              count={blockedOver7}
              color="#DC2626"
              action="Voir"
              onClick={() => navigate('/colis?tab=reception')}
            />
          )}
          {facturesManquantes > 0 && (
            <AlertCard
              icon={FileText}
              label="Factures manquantes"
              count={facturesManquantes}
              color="#D97706"
              action="Demander"
              onClick={() => navigate('/colis?tab=preparation')}
            />
          )}
          {paiementsEnRetard > 0 && (
            <AlertCard
              icon={CreditCard}
              label="Paiements > 3j"
              count={paiementsEnRetard}
              color="#EA580C"
              action="Relancer"
              onClick={() => navigate('/colis?tab=paiement')}
            />
          )}
          {abonnementStats.expiring7.length > 0 && (
            <AlertCard
              icon={Crown}
              label="Abo. expire < 7j"
              count={abonnementStats.expiring7.length}
              color="#7C3AED"
              action="Relancer"
              onClick={() => navigate('/clients')}
            />
          )}
        </div>
      )}

      {/* ── PROCHAIN ENVOI (logisticien/direction) ── */}
      {isLogistic && prochainEnvoi && (
        <div className="card p-4 rounded-2xl" style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL || BRAND.navy})`, color: 'white' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Plane size={14} />
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-75">Prochain envoi</span>
              </div>
              <p className="text-xl font-black capitalize">
                {new Date(prochainEnvoi.envoi.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <p className="text-xs opacity-75 mt-1">
                Dans {prochainEnvoi.joursRestants}j · {prochainEnvoi.colis.length} colis · {prochainEnvoi.totalPoids.toFixed(1)}kg
              </p>
              <div className="flex gap-2 mt-2 flex-wrap">
                {Object.entries(prochainEnvoi.byDest).map(([code, count]) => {
                  const d = DESTINATIONS[code];
                  return (
                    <span key={code} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20">
                      {d.flag} {count}
                    </span>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => navigate('/colis?tab=expedition')}
              className="flex-shrink-0 bg-white/20 hover:bg-white/30 transition-colors rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-1.5"
            >
              Voir détail
            </button>
          </div>
          {colisSansEnvoi > 0 && (
            <div className="mt-3 pt-3 border-t border-white/20 flex items-center justify-between text-xs">
              <span className="opacity-90">⚠️ {colisSansEnvoi} colis payés sans envoi affecté</span>
              <button onClick={() => navigate('/colis?tab=expedition')} className="font-bold hover:underline">Affecter →</button>
            </div>
          )}
        </div>
      )}

      {/* ── KPI FINANCIERS (direction) ── */}
      {isDirection && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="CA Total" value={eur(caTotal)} icon={TrendingUp} color={BRAND.navy} onClick={() => navigate('/colis')} />
          <MetricCard
            label="CA ce mois"
            value={eur(caMois)}
            icon={TrendingUp}
            color="#059669"
            trend={caMoisPrev > 0 ? evolutionMois : null}
            onClick={() => navigate('/colis')}
          />
          <MetricCard label="CA semaine" value={eur(caSemaine)} icon={Zap} color="#2563EB" onClick={() => navigate('/colis')} />
          <MetricCard label="Panier moyen" value={eur(panierMoyen)} icon={ShoppingCart} color="#7C3AED" onClick={() => navigate('/colis')} />
          <MetricCard label="Taux conversion" value={`${tauxConversion.toFixed(0)}%`} icon={Target} color="#EA580C" onClick={() => navigate('/colis')} />
          <MetricCard label="Nouveaux clients" value={nouveauxClients} icon={UserPlus} color="#16A34A" onClick={() => navigate('/clients')} />
          <MetricCard label="Colis livrés" value={colisTraites} icon={Package} color="#0891B2" onClick={() => navigate('/colis?tab=livre')} />
          <MetricCard label="Pipeline actif" value={pipelineTotal} icon={Send} color={BRAND.gold} onClick={() => navigate('/colis')} />
        </div>
      )}

      {/* ── PIPELINE ── */}
      <div className="card p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
          Pipeline ({pipelineTotal} colis actifs)
        </p>
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

      {/* ── ABONNEMENTS DÉTAIL (direction + logisticien) ── */}
      {isLogistic && (
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Crown size={14} style={{ color: BRAND.gold }} />
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Abonnements</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <SubStatCard label="VIP" count={abonnementStats.vip} color="#D97706" icon="👑" onClick={() => navigate('/clients')} />
            <SubStatCard label="Premium annuel" count={abonnementStats.premiumAn} color="#2563EB" icon="🚀" onClick={() => navigate('/clients')} />
            <SubStatCard label="Premium mensuel" count={abonnementStats.premiumMois} color="#7C3AED" icon="🚀" onClick={() => navigate('/clients')} />
            <SubStatCard label="Freemium" count={abonnementStats.freemium} color="#64748B" icon="🆓" onClick={() => navigate('/clients')} />
            <SubStatCard label="À convertir (≥3 colis)" count={abonnementStats.aConvertir.length} color="#16A34A" icon="💎" onClick={() => navigate('/clients')} />
          </div>
          {(abonnementStats.expired.length > 0 || abonnementStats.expiring30.length > 0) && (
            <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 text-[11px]">
              {abonnementStats.expired.length > 0 && (
                <button onClick={() => navigate('/clients')} className="px-2 py-1 rounded-lg bg-red-50 text-red-700 font-bold hover:bg-red-100">
                  ❌ {abonnementStats.expired.length} expiré{abonnementStats.expired.length > 1 ? 's' : ''}
                </button>
              )}
              {abonnementStats.expiring7.length > 0 && (
                <button onClick={() => navigate('/clients')} className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 font-bold hover:bg-amber-100">
                  ⚠️ {abonnementStats.expiring7.length} expire &lt; 7j
                </button>
              )}
              {abonnementStats.expiring30.length > 0 && (
                <button onClick={() => navigate('/clients')} className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 font-bold hover:bg-blue-100">
                  🗓 {abonnementStats.expiring30.length} expire &lt; 30j
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── DESTINATIONS (direction) ── */}
      {isDirection && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {destStats.map((d) => (
            <button
              key={d.code}
              onClick={() => navigate(`/colis?dest=${d.code}`)}
              className="card p-4 rounded-2xl text-left hover:shadow-md transition-all active:scale-[0.98]"
              style={{ borderLeft: `3px solid ${BRAND.gold}` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{d.flag}</span>
                <span className="text-sm font-bold" style={{ color: BRAND.navy }}>{d.label || d.nom}</span>
              </div>
              <p className="text-xs text-gray-500">{d.count} colis</p>
              <p className="text-sm font-bold" style={{ color: BRAND.navy }}>{eur(d.ca)}</p>
            </button>
          ))}
        </div>
      )}

      {/* ── OBJECTIFS ── */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target size={16} style={{ color: BRAND.navy }} />
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Objectifs du mois</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ObjectiveBar
            label={`Colis traités : ${colisThisMonth} / ${objectifColis}`}
            pct={progressColis}
            color={progressColor(progressColis)}
          />
          {isDirection && (
            <ObjectiveBar
              label={`CA : ${eur(caMois)} / ${eur(objectifCA)}`}
              pct={progressCA}
              color={progressColor(progressCA)}
            />
          )}
        </div>
      </div>

      {/* ── ACTIVITÉ RÉCENTE ── */}
      {recentActivity.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Activité récente</p>
          <div className="space-y-2">
            {recentActivity.map((ev, i) => {
              const Icon = ev.icon;
              return (
                <div key={i} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${ev.color}15` }}>
                    <Icon size={13} style={{ color: ev.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">{ev.text}</p>
                    <p className="text-[10px] text-gray-400">{timeAgo(ev.date)}</p>
                  </div>
                  {ev.amount && (
                    <span className="text-xs font-bold" style={{ color: ev.color }}>{ev.amount}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════ SUB-COMPONENTS ══════════

function MetricCard({ label, value, icon: Icon, color, trend, onClick }) {
  const trendPositive = trend > 0;
  return (
    <button onClick={onClick} className="card p-4 rounded-2xl text-left hover:shadow-md transition-all active:scale-[0.98]">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}15` }}>
          <Icon size={14} style={{ color }} strokeWidth={2.5} />
        </div>
        <span className="text-xs font-semibold text-gray-500">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-1 mt-1">
        <p className="text-lg font-black" style={{ color }}>{value}</p>
        {trend != null && (
          <span className={`text-[10px] font-bold flex items-center gap-0.5 ${trendPositive ? 'text-green-600' : 'text-red-500'}`}>
            {trendPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {Math.abs(trend).toFixed(0)}%
          </span>
        )}
      </div>
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
        <div className="h-full rounded-full transition-all" style={{ width: `${clamped}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function AlertCard({ icon: Icon, label, count, color, action, onClick }) {
  return (
    <button
      onClick={onClick}
      className="card p-3 rounded-2xl text-left hover:shadow-md transition-all active:scale-[0.98] w-full"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={13} style={{ color }} />
        <span className="text-[10px] font-semibold text-gray-600">{label}</span>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xl font-black" style={{ color }}>{count}</p>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${color}15`, color }}>{action} →</span>
      </div>
    </button>
  );
}

function SubStatCard({ label, count, color, icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-gray-100 p-3 text-left hover:shadow-sm hover:border-gray-200 transition-all active:scale-[0.98]"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-[10px] font-semibold text-gray-500 truncate">{label}</span>
      </div>
      <p className="text-lg font-black" style={{ color }}>{count}</p>
    </button>
  );
}
