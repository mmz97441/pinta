import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Package, CheckCircle, Clock, CreditCard, Plane, Shield, Warehouse, Truck, AlertTriangle, Ruler, Check } from 'lucide-react';
import { DESTINATIONS, getDestByCP } from '../../constants';
import { configurationError } from '../../lib/supabase';
import { publicJourney, publicDeparture, clientDate } from '../../domain/clientJourney';
import { kg } from '../../utils/format';
import { plural } from '../../domain/plural';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import { PublicBrandHeader, PublicTrackingSkeleton, useSavedTheme } from '../client/ClientPortalStates';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Phases détaillées pour le client (8 étapes visibles)
const PUBLIC_PHASES = [
  { key: 'reception',    label: 'Réception',    icon: Package,     statuts: ['receptionne', 'mesure'] },
  { key: 'accord',       label: 'Accord',       icon: CheckCircle, statuts: ['attente_feu_vert', 'autorise', 'refuse_client'] },
  { key: 'preparation',  label: 'Préparation',  icon: Clock,       statuts: ['en_preparation'] },
  { key: 'paiement',     label: 'Paiement',     icon: CreditCard,  statuts: ['devis_envoye', 'attente_paiement', 'paye'] },
  { key: 'transport',    label: 'Transport',    icon: Plane,       statuts: ['expedie', 'transit'] },
  { key: 'dedouanement', label: 'Douane',       icon: Shield,      statuts: ['dedouanement'] },
  { key: 'depot',        label: 'Dépôt local',  icon: Warehouse,   statuts: ['arrive'] },
  { key: 'livraison',    label: 'Livraison',    icon: Truck,       statuts: ['livraison', 'livre'] },
];

function getPhaseIndex(statut) {
  for (let i = 0; i < PUBLIC_PHASES.length; i++) {
    if (PUBLIC_PHASES[i].statuts.includes(statut)) return i;
  }
  return 0;
}

const surface = { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' };

export default function TrackingPublic() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [invalidLink, setInvalidLink] = useState(false);
  useSavedTheme();
  useDocumentTitle(error ? 'Suivi indisponible' : 'Suivi d’expédition');

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
      .catch(() => { if (!controller.signal.aborted) { setError('Connexion impossible. Réessayez dans un instant.'); setLoading(false); } });
    return () => controller.abort();
  }, [token, retry]);

  if (loading) return <PublicTrackingSkeleton />;

  if (error) {
    return (
      <div className="min-h-[100dvh]" style={{ background: 'var(--bg-canvas)' }}>
        <PublicBrandHeader />
        <main className="flex items-center justify-center p-4 py-10">
          <div className="max-w-md w-full rounded-2xl border p-8 text-center shadow-sm" style={surface}>
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={28} className="text-red-700" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-black mb-2" style={{ color: 'var(--brand-text)' }}>Suivi indisponible</h1>
            <p className="text-sm text-slate-600">{error}</p>
            {invalidLink ? <p className="text-sm text-slate-600 mt-4">Contactez l’expéditeur pour obtenir un nouveau lien.</p> : <button className="mt-4 min-h-11 rounded-xl px-4 text-sm font-semibold text-white brand-bg transition-all duration-200 ease-out active:scale-[0.98]" onClick={() => setRetry(value => value + 1)}>Réessayer le suivi</button>}
          </div>
        </main>
      </div>
    );
  }

  const dest = data?.destination?.cp ? getDestByCP(data.destination.cp) : null;
  const destInfo = dest ? DESTINATIONS[dest.code] : null;
  const count = data.colis.length;

  return (
    <div className="min-h-[100dvh]" style={{ background: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      <PublicBrandHeader />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* Intro */}
        <section className="rounded-2xl border p-5 shadow-sm" style={surface} aria-labelledby="public-tracking-title">
          <h1 id="public-tracking-title" className="text-xl font-black" style={{ color: 'var(--brand-text)' }}>{count > 1 ? 'Suivi des expéditions' : 'Suivi de l’expédition'}</h1>
          <p className="mt-2 text-sm text-slate-600">Envoyé par <strong className="font-bold" style={{ color: 'var(--brand-text)' }}>{data.expediteur}</strong></p>
          {destInfo && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm">
              <span className="text-xl" aria-hidden="true">{destInfo.flag}</span>
              <span className="text-slate-600">Destination&nbsp;:</span>
              <span className="font-bold" style={{ color: 'var(--brand-text)' }}>
                {data.destination.ville || destInfo.nom || destInfo.label}
              </span>
            </p>
          )}
          <p className="text-sm text-slate-600 mt-3">
            {plural(count, 'expédition')} · informations de suivi partagées par l’expéditeur
          </p>
        </section>

        {data.colis.map((c) => {
          const phaseIdx = getPhaseIndex(c.statut);
          const phase = PUBLIC_PHASES[phaseIdx];
          const journey = publicJourney(c);
          // A day still to come before the departure, the confirmed day once shipped: never a past day as planned.
          const departure = publicDeparture(c);
          return (
            <article key={c.ref} className="rounded-2xl border shadow-sm overflow-hidden" style={surface} aria-labelledby={`public-${c.ref}`}>
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 id={`public-${c.ref}`} className="font-black text-base" style={{ color: 'var(--brand-text)' }}>{c.ref}</h2>
                  <span className="rounded-full px-2.5 py-0.5 text-sm font-semibold brand-bg-l brand-t">Étape {phaseIdx + 1} sur {PUBLIC_PHASES.length} · {phase.label}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600 break-words">{c.desc || 'Expédition'}</p>
                {c.receivedCount != null && <p className="mt-1 text-sm text-slate-600">{plural(c.receivedCount, 'carton reçu', 'cartons reçus')}{c.outgoingParcelCount != null ? ` · ${plural(c.outgoingParcelCount, 'colis sortant confirmé', 'colis sortants confirmés')}` : ''}</p>}
                {c.destinationCode && DESTINATIONS[c.destinationCode] && <p className="mt-1 text-sm text-slate-600">Destination de cette expédition&nbsp;: {DESTINATIONS[c.destinationCode].nom}</p>}
              </div>

              <div className="px-5 py-5">
                <section aria-label={`État actuel ${c.ref}`} className="space-y-2">
                  <h3 className="text-base font-bold text-slate-800">{journey.label}</h3>
                  <p className="text-sm text-slate-600">{journey.actor && <strong>{journey.actor} · </strong>}{journey.next}</p>
                  <p className="text-sm text-slate-500">{journey.event && clientDate(journey.event.date) ? `${journey.event.label} le ${clientDate(journey.event.date)}` : 'Date du dernier événement non renseignée.'}</p>
                  {departure && <p data-testid="public-departure" className="text-sm text-slate-600">{departure.label} <strong>{departure.day}</strong>. Il s’agit du départ, pas de la date de livraison.</p>}
                </section>
                <details className="mt-4 border-t border-slate-200">
                  <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Parcours du colis</summary>
                  <ol aria-label="Progression du colis" className="space-y-1 pb-2">{PUBLIC_PHASES.map((step, index) => {
                    const Icon = step.icon;
                    const state = index < phaseIdx ? 'Étape passée' : index === phaseIdx ? 'En cours' : 'À venir';
                    return <li key={step.key} aria-current={index === phaseIdx ? 'step' : undefined} className={`flex items-center gap-3 rounded-xl px-2 py-2 text-sm ${index === phaseIdx ? 'brand-bg-l font-bold text-slate-800' : index < phaseIdx ? 'text-slate-700' : 'text-slate-500'}`}>
                      <span aria-hidden="true" className="w-6 shrink-0 text-right tabular-nums">{index + 1}</span>
                      <Icon size={16} aria-hidden="true" className="shrink-0" />
                      <span className="min-w-0 flex-1">{step.label}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm">{index < phaseIdx && <Check size={14} aria-hidden="true" />}{state}</span>
                    </li>;
                  })}</ol>
                </details>

                {c.photoPrep && (
                  <div className="mt-4">
                    <p className="text-sm font-bold text-slate-600 mb-2">Photo de votre colis</p>
                    <div className="rounded-xl overflow-hidden border border-slate-100">
                      <img src={c.photoPrep} alt={`Colis ${c.ref}`} className="w-full h-auto object-cover" />
                    </div>
                  </div>
                )}

                <details className="mt-3 border-t border-slate-200"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600"><Ruler size={14} className="mr-2 inline" aria-hidden="true" />Cartons et mesures</summary>
                  {c.preparationNeedsReview && <p className="mb-2 text-sm text-slate-600">Les mesures après optimisation sont à confirmer pour la composition actuelle.</p>}
                  {c.preparedPackages?.length > 0 && <div className="space-y-2"><p className="text-sm font-semibold text-slate-700">Après optimisation</p>{c.preparedPackages.map((box,index) => <p key={index} className="text-sm text-slate-600">Colis sortant {index + 1} · {box.L} × {box.W} × {box.H} cm · {kg(box.P)}</p>)}</div>}
                  {c.receptionCartons?.length > 0 && <div className="mt-3 space-y-2"><p className="text-sm font-semibold text-slate-700">À réception</p>{c.receptionCartons.map((box,index) => <p key={index} className="text-sm text-slate-600">Carton {index + 1} · {box ? `${box.L} × ${box.W} × ${box.H} cm · ${kg(box.P)}` : 'Mesures non renseignées'}</p>)}</div>}
                  {!c.preparedPackages?.length && !c.receptionCartons?.length && <p className="text-sm text-slate-500">Mesures détaillées non renseignées.</p>}
                </details>

                {clientDate(c.dateReception) && (
                  <p className="text-sm text-slate-500 mt-3">
                    Reçu le {clientDate(c.dateReception)}
                  </p>
                )}
              </div>
            </article>
          );
        })}

        <p className="text-center pt-6 pb-4 text-sm text-slate-500">
          Suivi partagé · <span className="font-bold" style={{ color: 'var(--brand-text)' }}>Expedîle</span>
        </p>
      </main>
    </div>
  );
}
