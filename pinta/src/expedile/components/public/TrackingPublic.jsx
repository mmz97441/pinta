import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Package, CheckCircle, Clock, Plane, MapPin, Loader2, AlertTriangle, Ruler } from 'lucide-react';
import { BRAND, STATUTS, DESTINATIONS, getDestByCP } from '../../constants';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://bqprktzehuhplpqjgjaz.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Phases simplifiées pour affichage public
const PUBLIC_PHASES = [
  { key: 'reception', label: 'Reçu', icon: Package, statuts: ['receptionne', 'mesure'] },
  { key: 'accord', label: 'Votre accord', icon: CheckCircle, statuts: ['attente_feu_vert', 'autorise'] },
  { key: 'preparation', label: 'Préparation', icon: Clock, statuts: ['en_preparation', 'devis_envoye', 'paye'] },
  { key: 'expedition', label: 'En vol', icon: Plane, statuts: ['expedie', 'transit', 'dedouanement'] },
  { key: 'livraison', label: 'Livré', icon: MapPin, statuts: ['arrive', 'livraison', 'livre'] },
];

function getPhaseIndex(statut) {
  for (let i = 0; i < PUBLIC_PHASES.length; i++) {
    if (PUBLIC_PHASES[i].statuts.includes(statut)) return i;
  }
  return 0;
}

function getStatutLabel(statut) {
  const map = {
    receptionne: 'Votre colis est bien arrivé chez Expedîle',
    mesure: 'Mesuré et prêt pour validation',
    attente_feu_vert: 'En attente de votre accord',
    autorise: 'Accord reçu — préparation programmée',
    en_preparation: 'En cours de préparation et optimisation',
    devis_envoye: 'Devis envoyé, en attente de paiement',
    paye: 'Payé, programmé pour le prochain vol',
    expedie: 'En route vers l\'aéroport',
    transit: 'En vol vers sa destination ✈️',
    dedouanement: 'En cours de dédouanement',
    arrive: 'Arrivé à destination',
    livraison: 'En cours de livraison',
    livre: 'Livré ✓',
  };
  return map[statut] || statut;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function formatETA(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const days = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const label = cap(d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
  if (days < 0) return label;
  if (days === 0) return `Aujourd'hui — ${label}`;
  if (days === 1) return `Demain — ${label}`;
  return `Dans ${days} jours — ${label}`;
}

export default function TrackingPublic() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) { setError('Lien invalide'); setLoading(false); return; }
    fetch(`${SUPABASE_URL}/functions/v1/get-tracking?token=${encodeURIComponent(token)}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) setError(res.error || 'Une erreur est survenue');
        else setData(res);
        setLoading(false);
      })
      .catch(() => { setError('Connexion impossible. Réessayez plus tard.'); setLoading(false); });
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F8FAFC' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin" style={{ color: BRAND.navy }} />
          <p className="text-sm text-gray-500">Chargement du suivi...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F8FAFC' }}>
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <h1 className="text-lg font-black mb-2" style={{ color: BRAND.navy }}>Suivi indisponible</h1>
          <p className="text-sm text-gray-500">{error}</p>
          <p className="text-xs text-gray-400 mt-4">Contactez l'expéditeur pour obtenir un nouveau lien.</p>
        </div>
      </div>
    );
  }

  const dest = data?.destination?.cp ? getDestByCP(data.destination.cp) : null;
  const destInfo = dest ? DESTINATIONS[dest.code] : null;

  return (
    <div className="min-h-screen" style={{ background: '#F8FAFC' }}>
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📦</span>
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
            {data.colis.length} colis en cours · suivi en temps réel
          </p>
        </div>

        {/* Cards colis */}
        {data.colis.map((c) => {
          const phaseIdx = getPhaseIndex(c.statut);
          return (
            <div key={c.ref} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Header du colis */}
              <div className="px-5 py-4 border-b border-gray-50 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-black text-base" style={{ color: BRAND.navy }}>{c.ref}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#E0F2FE', color: '#075985' }}>
                      {STATUTS[c.statut]?.label || c.statut}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 truncate">{c.desc || 'Colis'}</p>
                </div>
              </div>

              {/* Timeline */}
              <div className="px-5 py-5">
                <div className="relative flex items-start justify-between">
                  {/* Ligne horizontale de base */}
                  <div className="absolute top-4 left-[10%] right-[10%] h-0.5 bg-gray-100" />
                  {/* Ligne horizontale remplie (progression) */}
                  <div
                    className="absolute top-4 left-[10%] h-0.5 transition-all duration-700 ease-out"
                    style={{
                      width: `${(phaseIdx / (PUBLIC_PHASES.length - 1)) * 80}%`,
                      background: `linear-gradient(90deg, ${BRAND.gold}, ${BRAND.navy})`,
                    }}
                  />

                  {PUBLIC_PHASES.map((phase, i) => {
                    const Icon = phase.icon;
                    const done = i < phaseIdx;
                    const active = i === phaseIdx;
                    return (
                      <div key={phase.key} className="relative z-10 flex flex-col items-center" style={{ width: `${100 / PUBLIC_PHASES.length}%` }}>
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 ${active ? 'ring-4 ring-opacity-30' : ''}`}
                          style={{
                            background: done || active ? BRAND.navy : '#E5E7EB',
                            color: done || active ? 'white' : '#9CA3AF',
                            ringColor: active ? BRAND.navy : undefined,
                          }}
                        >
                          <Icon size={14} />
                        </div>
                        <span className={`text-[10px] mt-2 font-bold text-center ${active ? '' : 'text-gray-400'}`}
                          style={{ color: active ? BRAND.navy : undefined }}>
                          {phase.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Statut détaillé */}
                <div className="mt-4 p-3 rounded-xl bg-gray-50">
                  <p className="text-xs font-bold mb-1" style={{ color: BRAND.navy }}>État actuel</p>
                  <p className="text-sm text-gray-700">{getStatutLabel(c.statut)}</p>
                  {c.eta && ['autorise', 'en_preparation', 'devis_envoye', 'paye', 'expedie'].includes(c.statut) && (
                    <div className="mt-2 pt-2 border-t border-gray-200 flex items-center gap-2 text-xs">
                      <Plane size={12} style={{ color: BRAND.navy }} />
                      <span className="text-gray-500">Envoi prévu :</span>
                      <span className="font-bold" style={{ color: BRAND.navy }}>{formatETA(c.eta)}</span>
                    </div>
                  )}
                </div>

                {/* Photo préparation */}
                {c.photoPrep && (
                  <div className="mt-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Photo de votre colis</p>
                    <div className="rounded-xl overflow-hidden border border-gray-100">
                      <img src={c.photoPrep} alt={`Colis ${c.ref}`} className="w-full h-auto object-cover" />
                    </div>
                  </div>
                )}

                {/* Dimensions */}
                {c.dims && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                    <Ruler size={12} />
                    <span>{c.dims.L}×{c.dims.W}×{c.dims.H} cm · {c.dims.P} kg</span>
                  </div>
                )}

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
            Suivi en temps réel · propulsé par <span className="font-bold" style={{ color: BRAND.navy }}>Expedîle</span>
          </p>
        </div>
      </div>
    </div>
  );
}
