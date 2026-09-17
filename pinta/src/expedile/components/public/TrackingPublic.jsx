import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Package, CheckCircle, Clock, CreditCard, Plane, Shield, Warehouse, Truck, Loader2, AlertTriangle, Ruler } from 'lucide-react';
import { BRAND, STATUTS, DESTINATIONS, getDestByCP } from '../../constants';
import { configurationError } from '../../lib/supabase';
import { publicJourney } from '../../domain/clientJourney';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Phases détaillées pour le client (8 étapes visibles)
const PUBLIC_PHASES = [
  { key: 'reception',    label: 'Reçu',         icon: Package,     statuts: ['receptionne', 'mesure'] },
  { key: 'accord',       label: 'Accord',       icon: CheckCircle, statuts: ['attente_feu_vert', 'autorise', 'refuse_client'] },
  { key: 'preparation',  label: 'Préparation',  icon: Clock,       statuts: ['en_preparation'] },
  { key: 'paiement',     label: 'Paiement',     icon: CreditCard,  statuts: ['devis_envoye', 'attente_paiement', 'paye'] },
  { key: 'vol',          label: 'En vol',       icon: Plane,       statuts: ['expedie', 'transit'] },
  { key: 'dedouanement', label: 'Douane',       icon: Shield,      statuts: ['dedouanement'] },
  { key: 'depot',        label: 'Au dépôt',     icon: Warehouse,   statuts: ['arrive'] },
  { key: 'livraison',    label: 'Livraison',    icon: Truck,       statuts: ['livraison', 'livre'] },
];

function getPhaseIndex(statut) {
  for (let i = 0; i < PUBLIC_PHASES.length; i++) {
    if (PUBLIC_PHASES[i].statuts.includes(statut)) return i;
  }
  return 0;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function formatETA(value) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? `${value}T12:00:00` : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : null;
}

export default function TrackingPublic() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [invalidLink, setInvalidLink] = useState(false);

  useEffect(() => {
    setData(null); setError(null); setInvalidLink(false); setLoading(true);
    if (configurationError) { setError('Le suivi est momentanément indisponible. Contactez notre équipe.'); setLoading(false); return; }
    if (!token) { setInvalidLink(true); setError('Ce lien n’est plus valable.'); setLoading(false); return; }
    const controller = new AbortController();
    fetch(`${SUPABASE_URL}/functions/v1/get-tracking?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    })
      .then(async (r) => { const res = await r.json(); return { ...res, httpStatus: r.status }; })
      .then((res) => {
        if (controller.signal.aborted) return;
        if (!res.ok) { const invalid = [400, 401, 403, 404, 410].includes(res.httpStatus); setInvalidLink(invalid); setError(invalid ? 'Ce lien n’est plus valable ou n’est pas accessible.' : 'Le service de suivi est momentanément indisponible.'); }
        else setData(res);
        setLoading(false);
      })
      .catch(() => { if (!controller.signal.aborted) { setError('Connexion impossible. Réessayez plus tard.'); setLoading(false); } });
    return () => controller.abort();
  }, [token, retry]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center" style={{ background: '#F8FAFC' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin" style={{ color: BRAND.navy }} />
          <p className="text-sm text-gray-500">Chargement du suivi...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4" style={{ background: '#F8FAFC' }}>
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <h1 className="text-lg font-black mb-2" style={{ color: BRAND.navy }}>Suivi indisponible</h1>
          <p className="text-sm text-gray-500">{error}</p>
          {invalidLink ? <p className="text-sm text-gray-600 mt-4">Contactez l’expéditeur pour obtenir un nouveau lien.</p> : <button className="mt-4 min-h-11 rounded-xl px-4 text-sm font-semibold text-white" style={{ backgroundColor: BRAND.navy }} onClick={() => setRetry(value => value + 1)}>Réessayer le suivi</button>}
        </div>
      </div>
    );
  }

  const dest = data?.destination?.cp ? getDestByCP(data.destination.cp) : null;
  const destInfo = dest ? DESTINATIONS[dest.code] : null;

  return (
    <div className="min-h-[100dvh]" style={{ background: '#F8FAFC' }}>
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package size={24} style={{ color: BRAND.navy }} />
            <span className="text-base font-black" style={{ color: BRAND.navy, letterSpacing: '-0.02em' }}>Expedîle</span>
          </div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Suivi partagé</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* Intro card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Envoyé par</p>
          <p className="text-xl font-black mb-3" style={{ color: BRAND.navy }}>{data.expediteur}</p>
          {destInfo && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-xl">{destInfo.flag}</span>
              <span className="text-gray-600">Destination :</span>
              <span className="font-bold" style={{ color: BRAND.navy }}>
                {data.destination.ville || destInfo.nom || destInfo.label}
              </span>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-3">
            {data.colis.length} expédition{data.colis.length > 1 ? 's' : ''} · informations de suivi
          </p>
        </div>

        {/* Cards colis */}
        {data.colis.map((c) => {
          const phaseIdx = getPhaseIndex(c.statut);
          const journey = publicJourney(c);
          return (
            <div key={c.ref} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Header du colis */}
              <div className="px-5 py-4 border-b border-gray-50 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-black text-base" style={{ color: BRAND.navy }}>{c.ref}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#E0F2FE', color: '#075985' }}>
                      {journey.waiting ? 'Attente demandée' : journey.quoteNeedsReview ? 'Devis en révision' : STATUTS[c.statut]?.label || c.statut}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 truncate">{c.desc || 'Expédition'}</p>
                  {c.receivedCount != null && <p className="mt-1 text-xs text-slate-600">{c.receivedCount} carton{c.receivedCount > 1 ? 's' : ''} reçu{c.receivedCount > 1 ? 's' : ''}{c.outgoingParcelCount != null ? ` · ${c.outgoingParcelCount} colis sortant${c.outgoingParcelCount > 1 ? 's' : ''} confirmé${c.outgoingParcelCount > 1 ? 's' : ''}` : ''}</p>}
                  {c.destinationCode && DESTINATIONS[c.destinationCode] && <p className="mt-1 text-xs text-slate-600">Destination de cette expédition : {DESTINATIONS[c.destinationCode].nom}</p>}
                </div>
              </div>

              {/* Timeline */}
              <div className="px-5 py-5">
                <section aria-label={`État actuel ${c.ref}`} className="space-y-2">
                  <h2 className="text-base font-bold text-slate-800">{journey.label}</h2>
                  <p className="text-sm text-slate-600">{journey.actor && <strong>{journey.actor} · </strong>}{journey.next}</p>
                  <p className="text-xs text-slate-500">{journey.event ? `${journey.event.label} le ${formatDate(journey.event.date)}` : 'Date du dernier événement non renseignée.'}</p>
                  {c.eta && formatETA(c.eta) && ['autorise', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye', 'expedie'].includes(c.statut) && <p className="text-sm text-slate-600">Départ prévu : <strong>{formatETA(c.eta)}</strong>. Il s’agit du départ, pas de la date de livraison.</p>}
                </section>
                <details className="mt-4 border-t border-slate-200">
                  <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Parcours du colis</summary>
                  <ol aria-label="Progression du colis" className="grid grid-cols-1 sm:grid-cols-2 gap-2">{PUBLIC_PHASES.map((phase, index) => {
                    const Icon = phase.icon;
                    return <li key={phase.key} aria-current={index === phaseIdx ? 'step' : undefined} className={`flex items-center gap-2 py-2 text-sm ${index === phaseIdx ? 'font-bold text-slate-800' : 'text-slate-500'}`}><Icon size={16} /><span>{phase.label}</span><span className="ml-auto text-xs">{index < phaseIdx ? 'Étape passée' : index === phaseIdx ? 'En cours' : 'À venir'}</span></li>;
                  })}</ol>
                </details>

                {/* Photo préparation */}
                {c.photoPrep && (
                  <div className="mt-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Photo de votre colis</p>
                    <div className="rounded-xl overflow-hidden border border-gray-100">
                      <img src={c.photoPrep} alt={`Colis ${c.ref}`} className="w-full h-auto object-cover" />
                    </div>
                  </div>
                )}

                <details className="mt-3 border-t border-slate-200"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600"><Ruler size={14} className="mr-2 inline" />Cartons et mesures</summary>
                  {c.preparationNeedsReview && <p className="mb-2 text-sm text-slate-600">Les mesures après optimisation sont à confirmer pour la composition actuelle.</p>}
                  {c.preparedPackages?.length > 0 && <div className="space-y-2"><p className="text-sm font-semibold text-slate-700">Après optimisation</p>{c.preparedPackages.map((box,index) => <p key={index} className="text-sm text-slate-600">Colis sortant {index + 1} · {box.L} × {box.W} × {box.H} cm · {box.P} kg</p>)}</div>}
                  {c.receptionCartons?.length > 0 && <div className="mt-3 space-y-2"><p className="text-sm font-semibold text-slate-700">À réception</p>{c.receptionCartons.map((box,index) => <p key={index} className="text-sm text-slate-600">Carton {index + 1} · {box ? `${box.L} × ${box.W} × ${box.H} cm · ${box.P} kg` : 'Mesures non renseignées'}</p>)}</div>}
                  {!c.preparedPackages?.length && !c.receptionCartons?.length && <p className="text-sm text-slate-500">Mesures détaillées non renseignées.</p>}
                </details>

                {/* Date réception */}
                {c.dateReception && (
                  <p className="text-[10px] text-gray-400 mt-3">
                    Reçu le {formatDate(c.dateReception)}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {/* Footer */}
        <div className="text-center pt-6 pb-4">
          <p className="text-[10px] text-gray-400">
            Suivi partagé · <span className="font-bold" style={{ color: BRAND.navy }}>Expedîle</span>
          </p>
        </div>
      </div>
    </div>
  );
}
