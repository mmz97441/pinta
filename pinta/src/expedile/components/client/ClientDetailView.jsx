import React, { useState } from 'react';
import {
  ArrowLeft, Package, CheckCircle, Wrench, CreditCard, Plane, MapPin,
  ChevronDown, ChevronUp, ChevronRight, AlertCircle, ThumbsUp, ThumbsDown, RotateCcw,
  ExternalLink, Clock,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, PHASES_CLIENT, getPhaseIndex } from '../../constants';
import { eur, trackStr, hasTrack } from '../../utils';
import { Badge, Ligne, ProgressBar } from '../ui';

// ── Phase icons ────────────────────────────────────────────────────────────────
const PHASE_ICONS = [Package, Package, CheckCircle, Wrench, CreditCard, Plane, MapPin];

// ── Phase state helper ─────────────────────────────────────────────────────────
function getPhaseState(phaseIdx, curPhaseIdx) {
  if (phaseIdx < curPhaseIdx) return 'done';
  if (phaseIdx === curPhaseIdx) return 'active';
  return 'future';
}

// ── Phase accordion step ───────────────────────────────────────────────────────
function PhaseStep({ phase, phaseIdx, state, open, onToggle, children }) {
  const Icon = PHASE_ICONS[phaseIdx] || Package;
  const isDone = state === 'done';
  const isActive = state === 'active';
  const isFuture = state === 'future';

  return (
    <div
      className={`rounded-2xl overflow-hidden transition-all ${
        isActive ? 'card-elevated' : 'card'
      }`}
      style={
        isActive
          ? { borderLeft: `4px solid ${BRAND.navy}` }
          : isDone
          ? { borderLeft: `4px solid #10b981` }
          : {}
      }
    >
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-4 text-left ${
          isActive ? 'py-3.5' : isDone ? 'py-2.5' : 'py-2.5'
        } ${isFuture ? 'opacity-40' : ''}`}
      >
        {/* Icon */}
        <div
          className={`flex-shrink-0 rounded-xl flex items-center justify-center ${
            isActive ? 'w-9 h-9' : 'w-7 h-7'
          }`}
          style={
            isDone
              ? { backgroundColor: '#d1fae5' }
              : isActive
              ? { backgroundColor: BRAND.navy + '15' }
              : { backgroundColor: '#f3f4f6' }
          }
        >
          {isDone ? (
            <CheckCircle size={isActive ? 18 : 15} className="text-emerald-600" />
          ) : (
            <Icon
              size={isActive ? 18 : 15}
              strokeWidth={isActive ? 2.2 : 1.8}
              style={{ color: isActive ? BRAND.navy : '#9ca3af' }}
            />
          )}
        </div>

        {/* Label */}
        <div className="flex-1 min-w-0">
          <p
            className={`leading-snug ${
              isDone
                ? 'text-xs font-semibold text-emerald-700'
                : isActive
                ? 'text-sm font-black text-gray-900'
                : 'text-xs font-medium text-gray-400'
            }`}
          >
            {phase.label}
          </p>
          {isActive && (
            <p className="text-[10px] font-semibold mt-0.5" style={{ color: BRAND.gold }}>
              Étape en cours
            </p>
          )}
        </div>

        {/* Chevron (only for done + active) */}
        {!isFuture && (
          <div
            className={`flex-shrink-0 rounded-full flex items-center justify-center ${
              isActive ? 'w-6 h-6' : 'w-5 h-5'
            }`}
            style={{ backgroundColor: isActive ? BRAND.navy + '12' : '#f3f4f6' }}
          >
            {open ? (
              <ChevronUp size={isActive ? 13 : 11} style={{ color: isActive ? BRAND.navy : '#9ca3af' }} />
            ) : (
              <ChevronDown size={isActive ? 13 : 11} style={{ color: isActive ? BRAND.navy : '#9ca3af' }} />
            )}
          </div>
        )}
      </button>

      {/* Expanded content */}
      {open && !isFuture && children && (
        <div className="px-4 pb-4 anim-slide-down">
          <div className="border-t border-gray-50 pt-3">{children}</div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ClientDetailView() {
  const { sel, selDest, setSelId, feuVert, feuVertBulk, payer, ask, flash, authCl, data } = useApp();

  if (!sel) return null;

  const curPhaseIdx = getPhaseIndex(sel.statut);

  // Auto-expand the active phase so the client sees the action immediately
  const [timeOpen, setTimeOpen] = useState(curPhaseIdx);

  const toggleStep = (idx) => {
    const state = getPhaseState(idx, curPhaseIdx);
    if (state === 'future') return; // not expandable
    setTimeOpen((prev) => (prev === idx ? null : idx));
  };

  // ── Feu vert handlers ──────────────────────────────────────────────────────
  const autresFV = authCl
    ? data.filter((p) => p.clientId === authCl.id && p.statut === 'attente_feu_vert' && p.id !== sel.id)
    : [];

  const handleFeuVert = (ok) => {
    if (ok) {
      if (autresFV.length > 0) {
        const refs = autresFV.map((p) => p.ref).join(', ');
        ask(
          'Autoriser la préparation',
          `Vous confirmez que le contenu de ${sel.ref} est conforme et autorisez Expedîle à le préparer pour l'expédition ?\n\nVous avez aussi ${autresFV.length} autre${autresFV.length > 1 ? 's' : ''} colis en attente (${refs}). Voulez-vous tout autoriser d'un coup ?`,
          () => { feuVertBulk([sel.id, ...autresFV.map((p) => p.id)]); setSelId(null); },
          { okLabel: `Tout autoriser (${autresFV.length + 1})` }
        );
      } else {
        ask(
          'Autoriser la préparation',
          `Vous confirmez que le contenu de ${sel.ref} est conforme et autorisez Expedîle à le préparer pour l'expédition ?`,
          () => feuVert(sel.id, true),
          { okLabel: 'Oui, j\'autorise' }
        );
      }
    } else {
      ask(
        'Refuser la préparation',
        `Êtes-vous sûr de vouloir refuser la préparation de ${sel.ref} ? Ce colis ne sera pas expédié.`,
        () => { feuVert(sel.id, false); setSelId(null); },
        { danger: true, okLabel: 'Oui, je refuse' }
      );
    }
  };

  const handleRevoke = () => {
    ask(
      'Révoquer l\'accord',
      'Vous souhaitez annuler votre autorisation. Contactez-nous rapidement si la préparation n\'a pas encore commencé.',
      () => flash('Contactez le support pour révoquer votre accord.'),
      { okLabel: 'Contacter le support' }
    );
  };

  // ── Payer handler ──────────────────────────────────────────────────────────
  const handlePayer = () => {
    if (!sel.devisTotal) return;
    ask(
      'Confirmer le paiement',
      `Vous allez valider le paiement de ${eur(sel.devisTotal)} pour le colis ${sel.ref}.\n\nVous serez redirigé vers notre page de paiement sécurisé.`,
      () => { payer(sel.id, sel.devisTotal); },
      { okLabel: 'Procéder au paiement' }
    );
  };

  // ── Phase content renderers ───────────────────────────────────────────────
  const phaseContent = (phaseIdx) => {
    const phase = PHASES_CLIENT[phaseIdx];

    // Phase 0 – Réception
    if (phaseIdx === 0) {
      const hasDims = sel.dimL && sel.dimW && sel.dimH && sel.poids;
      return (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            {curPhaseIdx === 0
              ? 'Votre colis est arrivé à l\'entrepôt. Nous sommes en train de le mesurer.'
              : 'Votre colis a été réceptionné et mesuré.'}
          </p>
          {sel.dateReception && (
            <p className="text-[10px] font-medium text-gray-400">
              Reçu le {new Date(sel.dateReception).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {' à '}{new Date(sel.dateReception).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {sel.casier && (
            <div className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded-xl px-3 py-2">
              <Package size={13} />
              <span>Casier : <span className="font-black">{sel.casier}</span></span>
            </div>
          )}
          {hasDims && sel.dimsParColis && sel.dimsParColis.length > 1 ? (
            <div className="rounded-xl bg-gray-50 p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                Dimensions mesurées ({sel.dimsParColis.length} colis)
              </p>
              {sel.dimsParColis.map((d, i) => (
                <div key={i} className="rounded-lg bg-white p-2 border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 mb-0.5">
                    {sel.trackings?.filter((t) => t)[i] || `Colis ${i + 1}`}
                  </p>
                  <Ligne label="L × W × H" value={`${d.dimL} × ${d.dimW} × ${d.dimH} cm`} />
                  <Ligne label="Poids" value={`${d.poids} kg`} />
                </div>
              ))}
            </div>
          ) : hasDims ? (
            <div className="rounded-xl bg-gray-50 p-3 space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Dimensions mesurées</p>
              <Ligne label="Dimensions" value={`${sel.dimL} × ${sel.dimW} × ${sel.dimH} cm`} />
              <Ligne label="Poids" value={`${sel.poids} kg`} />
            </div>
          ) : (
            <p className="text-xs text-amber-600 flex items-center gap-1.5 bg-amber-50 rounded-xl px-3 py-2">
              <Clock size={13} />
              Mesures en cours…
            </p>
          )}
        </div>
      );
    }

    // Phase 2 – Accord (feu vert)
    if (phaseIdx === 1) {
      const isFV = sel.statut === 'attente_feu_vert';
      const isAutorise = sel.statut === 'autorise' || (sel.feuVert === 'autorise');
      const isRefuse = sel.statut === 'refuse_client';

      return (
        <div className="space-y-3">
          {isFV && (
            <>
              <div className="rounded-xl p-3 bg-amber-50 border border-amber-100">
                <p className="text-xs font-bold text-amber-800 mb-1 flex items-center gap-1.5">
                  <AlertCircle size={13} />
                  Votre accord est requis
                </p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  Nous avons réceptionné et mesuré votre colis. Autorisez-nous à le préparer et l'optimiser pour l'expédition. Le devis final vous sera envoyé après la préparation.
                </p>
              </div>
              {sel.dimsParColis && sel.dimsParColis.length > 1 ? (
                <div className="rounded-xl bg-gray-50 p-3 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                    Dimensions mesurées ({sel.dimsParColis.length} colis)
                  </p>
                  {sel.dimsParColis.map((d, i) => (
                    <div key={i} className="rounded-lg bg-white p-2 border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 mb-0.5">
                        {sel.trackings?.filter((t) => t)[i] || `Colis ${i + 1}`}
                      </p>
                      <Ligne label="L × W × H" value={`${d.dimL} × ${d.dimW} × ${d.dimH} cm`} />
                      <Ligne label="Poids" value={`${d.poids} kg`} />
                    </div>
                  ))}
                </div>
              ) : sel.dimL ? (
                <div className="rounded-xl bg-gray-50 p-3 space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Dimensions mesurées</p>
                  <Ligne label="L × W × H" value={`${sel.dimL} × ${sel.dimW} × ${sel.dimH} cm`} />
                  <Ligne label="Poids" value={`${sel.poids} kg`} />
                </div>
              ) : null}
              <div className="rounded-xl p-3 border border-blue-100" style={{ backgroundColor: BRAND.navy + '06' }}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: BRAND.navy }}>
                  Comment ça marche ?
                </p>
                <div className="space-y-1.5 text-xs text-gray-600 leading-relaxed">
                  <p>1. Vous donnez votre accord ci-dessous</p>
                  <p>2. Nous préparons et optimisons votre colis</p>
                  <p>3. Vous recevez le devis final à payer</p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleFeuVert(false)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-red-600 bg-red-50 active:scale-95 transition-all"
                >
                  <ThumbsDown size={15} />
                  Non
                </button>
                <button
                  onClick={() => handleFeuVert(true)}
                  className="flex-[2] flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white active:scale-95 transition-all"
                  style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
                >
                  <ThumbsUp size={15} />
                  Oui, j'autorise la préparation
                </button>
              </div>
            </>
          )}
          {isAutorise && (
            <>
              <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-100">
                <p className="text-xs font-bold text-emerald-700 flex items-center gap-1.5 mb-1">
                  <CheckCircle size={13} />
                  Accord donné
                </p>
                <p className="text-xs text-emerald-600 leading-relaxed">
                  Vous avez autorisé la préparation de ce colis. Expedîle va le préparer pour l'expédition.
                </p>
              </div>
              <button
                onClick={handleRevoke}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-red-500 transition-colors"
              >
                <RotateCcw size={11} />
                Révoquer mon accord
              </button>
            </>
          )}
          {isRefuse && (
            <div className="rounded-xl p-3 bg-red-50 border border-red-100">
              <p className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                <AlertCircle size={13} />
                Préparation refusée
              </p>
              <p className="text-xs text-red-600 mt-1 leading-relaxed">
                Vous avez refusé la préparation. Contactez-nous pour toute question.
              </p>
            </div>
          )}
        </div>
      );
    }

    // Phase 3 – Préparation
    if (phaseIdx === 2) {
      return (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 leading-relaxed">
            {curPhaseIdx === 3
              ? 'Votre colis est en cours de préparation et d\'optimisation dans notre entrepôt.'
              : 'La préparation est terminée.'}
          </p>
          {curPhaseIdx === 3 && (
            <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 rounded-xl px-3 py-2">
              <Wrench size={13} />
              Traitement en cours — nous vous informerons dès que le devis est prêt
            </div>
          )}
          {sel.casier && (
            <div className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded-xl px-3 py-2">
              <Package size={13} />
              <span>Casier : <span className="font-black">{sel.casier}</span></span>
            </div>
          )}
        </div>
      );
    }

    // Phase 4 – Devis & Paiement
    if (phaseIdx === 3) {
      const isPay = sel.statut === 'attente_paiement';
      const isDevis = sel.statut === 'devis_envoye';
      const isPaye = sel.paiementMontant != null;
      const hasDevis = sel.devisTotal != null;

      return (
        <div className="space-y-3">
          {hasDevis && (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <div
                className="px-3 py-2 text-[10px] font-black uppercase tracking-widest"
                style={{ backgroundColor: BRAND.navy + '08', color: BRAND.navy }}
              >
                Détail du devis
              </div>
              <div className="p-3 space-y-1">
                {sel.avantOptimTransport != null && sel.avantOptimTransport !== sel.devisTransport && (
                  <>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400 line-through">Transport brut</span>
                      <span className="text-gray-400 line-through">{eur(sel.avantOptimTransport)}</span>
                    </div>
                  </>
                )}
                <Ligne label="Transport optimisé" value={eur(sel.devisTransport)} />
                {sel.devisOM != null && sel.devisOM > 0 && (
                  <Ligne label="Octroi de Mer" value={eur(sel.devisOM)} />
                )}
                {sel.devisOMR != null && sel.devisOMR > 0 && (
                  <Ligne label="OM Régional" value={eur(sel.devisOMR)} />
                )}
                {sel.devisTVA != null && sel.devisTVA > 0 && (
                  <Ligne label={`TVA (${selDest?.tva ?? 8.5}%)`} value={eur(sel.devisTVA)} />
                )}
                <div className="border-t border-gray-100 mt-2 pt-2">
                  <div className="flex justify-between items-center">
                    <span className="font-black text-sm text-gray-900">Total</span>
                    <span className="font-black text-lg" style={{ color: BRAND.navy }}>
                      {eur(sel.devisTotal)}
                    </span>
                  </div>
                  {sel.economie != null && sel.economie > 0 && (
                    <div className="mt-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 rounded-lg px-2.5 py-1.5 flex items-center gap-1">
                      <span>Économie réalisée : {eur(sel.economie)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {isPaye && (
            <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-100 flex items-center gap-2">
              <CheckCircle size={15} className="text-emerald-600 flex-shrink-0" />
              <div>
                <p className="text-xs font-bold text-emerald-700">Paiement confirmé</p>
                <p className="text-xs text-emerald-600">{eur(sel.paiementMontant)} reçu</p>
              </div>
            </div>
          )}

          {(isPay || isDevis) && !isPaye && (
            <button
              onClick={handlePayer}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-sm text-white active:scale-95 transition-all"
              style={{
                background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
                boxShadow: `0 4px 16px rgba(232,184,75,0.35)`,
                color: BRAND.navyD,
              }}
            >
              <CreditCard size={16} />
              Payer {hasDevis ? eur(sel.devisTotal) : ''}
            </button>
          )}

          {!hasDevis && !isPaye && (
            <p className="text-xs text-gray-400 flex items-center gap-1.5 bg-gray-50 rounded-xl px-3 py-2">
              <Clock size={13} />
              Le devis sera disponible prochainement
            </p>
          )}
        </div>
      );
    }

    // Phase 5 – Expédition
    if (phaseIdx === 4) {
      return (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 leading-relaxed">
            {sel.statut === 'expedie'
              ? 'Votre colis a été remis au transporteur.'
              : sel.statut === 'transit'
              ? 'Votre colis est en vol vers votre destination !'
              : 'Votre colis est en route.'}
          </p>
          {sel.statut === 'transit' && (
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${BRAND.navy}, #0891B2)` }}
            >
              <Plane size={14} />
              Vol en cours vers {selDest?.nom || 'votre destination'} {selDest?.flag || ''}
            </div>
          )}
          {hasTrack(sel) && (
            <a
              href={`https://parcelsapp.com/en/tracking/${sel.trackings.filter((t) => t)[0]}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl transition-colors"
              style={{ color: BRAND.navy, backgroundColor: BRAND.navy + '08' }}
            >
              <ExternalLink size={12} />
              Suivre le colis ({trackStr(sel)})
            </a>
          )}
        </div>
      );
    }

    // Phase 6 – Livraison
    if (phaseIdx === 5) {
      const isLivre = sel.statut === 'livre';
      const isEnLivraison = sel.statut === 'livraison';
      const isArrive = sel.statut === 'arrive';

      return (
        <div className="space-y-3">
          {isArrive && (
            <div className="flex items-center gap-2 text-xs font-semibold text-teal-700 bg-teal-50 rounded-xl px-3 py-2">
              <MapPin size={13} />
              Colis arrivé à destination — livraison en cours de planification
            </div>
          )}
          {isEnLivraison && (
            <div className="flex items-center gap-2 text-xs font-semibold text-lime-700 bg-lime-50 rounded-xl px-3 py-2">
              <MapPin size={13} />
              Livraison en cours aujourd'hui !
            </div>
          )}
          {isLivre && (
            <div className="text-center py-3 space-y-2">
              <div className="text-5xl">🎉</div>
              <p className="font-black text-xl text-gray-900">Livré !</p>
              <p className="text-sm text-gray-500">
                Votre colis a bien été livré à {selDest?.nom || 'votre domicile'}.
              </p>
              <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-600">
                <CheckCircle size={14} />
                Livraison confirmée
              </div>
            </div>
          )}
          {!isLivre && !isEnLivraison && !isArrive && (
            <p className="text-xs text-gray-400 flex items-center gap-1.5 bg-gray-50 rounded-xl px-3 py-2">
              <Clock size={13} />
              La livraison sera programmée à l'arrivée du colis
            </p>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="anim-fade space-y-4">
      {/* ── Compact header with back ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSelId(null)}
          className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 hover:bg-gray-100"
        >
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-black text-gray-900 leading-none">{sel.ref}</h2>
            <Badge statut={sel.statut} />
          </div>
          <p className="text-xs text-gray-400 truncate mt-0.5">{sel.desc}</p>
        </div>
      </div>

      {/* ── Progress bar (inline, no card wrapper) ── */}
      {sel.statut !== 'annule' && (
        <div className="px-1">
          <ProgressBar statut={sel.statut} size="md" labelText="Progression" />
        </div>
      )}

      {sel.statut === 'annule' && (
        <div className="card p-3 rounded-2xl flex items-center gap-2 text-sm text-gray-500">
          <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
          Ce colis a été annulé.
        </div>
      )}

      {/* ── Accordion timeline (done + active phases) ── */}
      <div className="space-y-2">
        {PHASES_CLIENT.map((phase, idx) => {
          const state = getPhaseState(idx, curPhaseIdx);
          if (state === 'future') return null;
          const isOpen = timeOpen === idx;

          return (
            <PhaseStep
              key={phase.key}
              phase={phase}
              phaseIdx={idx}
              state={state}
              open={isOpen}
              onToggle={() => toggleStep(idx)}
            >
              {phaseContent(idx)}
            </PhaseStep>
          );
        })}
      </div>

      {/* ── Future phases (compact list) ── */}
      {curPhaseIdx < PHASES_CLIENT.length - 1 && (
        <div className="card rounded-2xl p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
            Prochaines étapes
          </p>
          <div className="flex flex-wrap gap-2">
            {PHASES_CLIENT.slice(curPhaseIdx + 1).map((phase, i) => {
              const Icon = PHASE_ICONS[curPhaseIdx + 1 + i] || Package;
              return (
                <div key={phase.key} className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
                  <Icon size={12} strokeWidth={1.5} />
                  <span>{phase.label}</span>
                  {i < PHASES_CLIENT.length - curPhaseIdx - 2 && (
                    <ChevronRight size={10} className="text-gray-300" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Spacer so last card isn't under bottom nav */}
      <div className="h-2" />
    </div>
  );
}
