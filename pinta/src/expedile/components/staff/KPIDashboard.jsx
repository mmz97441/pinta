import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Clock, FileText, MessageCircle, Calculator, PauseCircle, AlertTriangle, ArrowRight, Archive, TrendingUp } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';
import { eur } from '../../utils';
import { operationalMetrics } from '../../domain/operations';
import { useMinuteNow } from '../../hooks/useMinuteNow';

function Metric({ label, value, detail, icon: Icon, onClick }) {
  return <button onClick={onClick} className="min-h-24 min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-slate-400 active:scale-[0.98]">
    <span className="flex items-center gap-2 text-xs font-semibold text-gray-500"><Icon size={15} className="shrink-0" />{label}</span><strong className="mt-2 block text-2xl font-bold" style={{ color: 'var(--brand-text)' }}>{value}</strong><span className="mt-1 block text-xs text-gray-400">{detail}</span>
  </button>;
}

export default function KPIDashboard() {
  const navigate = useNavigate();
  const { data, clients, categories, tarifs, settings, authRole, archivesLoaded, loadArchives } = useApp();
  const [loadingArchives, setLoadingArchives] = useState(false);
  const [error, setError] = useState('');
  const now = useMinuteNow();
  const metrics = useMemo(() => operationalMetrics({ data, clients, categories, tarifs, settings, now }), [data, clients, categories, tarifs, settings, now]);
  const isDirection = ['directeur', 'vice_directeur'].includes(authRole);
  const duration = metrics.medianDecisionHours === null ? 'Non mesuré' : metrics.medianDecisionHours < 48 ? `${metrics.medianDecisionHours.toFixed(1)} h` : `${(metrics.medianDecisionHours / 24).toFixed(1)} j`;
  const loadHistory = async () => {
    setLoadingArchives(true); setError('');
    try { await loadArchives(); } catch (failure) { setError(failure.message || 'Impossible de charger les archives.'); }
    finally { setLoadingArchives(false); }
  };
  return <details className="border-t border-gray-200 pt-4">
    <summary className="min-h-11 cursor-pointer list-none rounded-xl px-1 py-2"><span className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-slate-700"><BarChart3 size={17} />Pilotage de l’activité</span><span className="text-xs text-gray-500">{metrics.active.length} dossier{metrics.active.length > 1 ? 's actifs' : ' actif'} · {metrics.ready.length} prêt{metrics.ready.length > 1 ? 's' : ''} à chiffrer</span></span></summary>
    <div className="space-y-5 pt-4">
      <p className="text-xs text-gray-500">Les compteurs portent sur les dossiers, qui peuvent regrouper plusieurs cartons. Un dossier peut cumuler plusieurs éléments à traiter.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Metric label="Conversations à traiter" value={metrics.conversations.length} detail={`${metrics.conversationClientCount} clients · lecture distincte du traitement`} icon={MessageCircle} onClick={() => navigate('/colis?work=messages')} />
        <Metric label="Accord attendu" value={metrics.awaitingDecision.length} detail="Hors pauses demandées par le client" icon={Clock} onClick={() => navigate('/colis?work=decision')} />
        <Metric label="Attentes volontaires" value={metrics.voluntaryWait.length} detail={`${metrics.waitsToReview.length} échéances à revoir avec le client`} icon={PauseCircle} onClick={() => navigate('/colis?work=waiting')} />
        <Metric label="Documents à vérifier" value={metrics.documents.length} detail="Justificatifs absents ou non validés" icon={FileText} onClick={() => navigate('/colis?work=documents')} />
        <Metric label="Prêts à chiffrer" value={metrics.ready.length} detail="Mesures et prérequis du calcul complets" icon={Calculator} onClick={() => navigate('/colis?work=ready')} />
        <Metric label="Échéances dépassées" value={metrics.overdue.length} detail="Prochaine action renseignée, hors pauses" icon={AlertTriangle} onClick={() => navigate('/colis?work=overdue')} />
      </div>
      {metrics.waitsToReview.length > 0 && <button onClick={() => navigate('/colis?work=wait-review')} className="min-h-11 text-sm font-semibold text-amber-800 underline">Revoir les {metrics.waitsToReview.length} attentes arrivées à échéance</button>}
      <div className="grid gap-4 border-t border-gray-200 pt-4 md:grid-cols-2">
        <div><p className="text-xs font-semibold text-gray-500">Délai médian demande → accord</p><p className="mt-1 text-xl font-bold text-slate-800">{duration}</p><p className="mt-1 text-xs text-gray-400">{metrics.decisionHours.length} accords avec les deux horodatages disponibles. Délai calendaire ; les pauses passées ne sont pas soustraites.</p></div>
        <div><p className="text-xs font-semibold text-gray-500">Fiabilité des échanges</p><p className="mt-1 text-xl font-bold text-slate-800">{metrics.failed.length} dossiers avec envoi en échec</p><p className="mt-1 text-xs text-gray-400">À contrôler dans la conversation. La lecture ne clôture pas une conversation ; son traitement reste explicite.</p></div>
      </div>
      {metrics.ready.length > 0 && <div className="border-t border-gray-200 pt-4"><p className="mb-2 text-xs font-semibold text-gray-500">Devis prêts à reprendre</p><div className="divide-y divide-gray-100">{metrics.ready.slice(0, 5).map((parcel) => <button key={parcel.id} onClick={() => navigate(`/colis/${parcel.id}`)} className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left"><span className="min-w-0 truncate text-sm text-slate-700"><strong>{parcel.ref}</strong> · {clients.find((client) => client.id === parcel.clientId)?.nom || 'Client'}</span><ArrowRight size={15} className="shrink-0 text-gray-400" /></button>)}</div></div>}
      {isDirection && <div className="space-y-3 border-t border-gray-200 pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-semibold text-slate-700"><TrendingUp size={16} />Encaissements enregistrés</p>{!archivesLoaded && loadArchives && <button disabled={loadingArchives} onClick={loadHistory} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"><Archive size={14} />{loadingArchives ? 'Chargement…' : 'Inclure les dossiers archivés'}</button>}</div><p className="text-xs text-gray-500">{archivesLoaded ? 'Périmètre : dossiers chargés, archives incluses.' : 'Périmètre : dossiers non archivés uniquement. Le total historique nécessite les archives.'} Les sommes encaissées incluent transport, taxes et frais ; elles ne représentent pas la marge.</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[['Montants reçus', metrics.receipts], ['Transport des dossiers payés', metrics.paidTransport], ['Taxes des dossiers payés', metrics.paidTaxes]].map(([label, amount]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-gray-500">{label}</dt><dd className="mt-1 text-lg font-bold text-slate-800">{eur(amount)}</dd></div>)}</dl>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      </div>}
      <p className="text-xs text-gray-400">Les gains de temps de communication et de devis se mesureront sur un pilote observé. Aucun objectif chiffré ou temps de travail n’est déduit automatiquement de ces compteurs.</p>
    </div>
  </details>;
}
