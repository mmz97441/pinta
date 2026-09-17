import { receptionCartonManifest } from '../../domain/reception';
import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Package, CheckCircle, Wrench, CreditCard, Plane, MapPin,
  ChevronDown, ChevronUp, ChevronRight, AlertCircle, ThumbsUp, ThumbsDown, RotateCcw,
  ExternalLink, Clock, Download, Camera, Shield, Warehouse, Truck,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { hasPublishedQuote } from './quoteVisibility';
import { cartonManifest, clientJourney, clientWorkState, quotePresentation, PAYMENT_TERMS, outgoingTracking, latestLogisticsEvent } from '../../domain/clientJourney';
import { useApp } from '../../context/AppContext';
import { SecureImage } from '../ui/SecureFile';
import { BRAND, PHASES_CLIENT, getPhaseIndex, getDestByCP } from '../../constants';

import { eur } from '../../utils';
import { Ligne, ProgressBar } from '../ui';

// ── Phase icons ────────────────────────────────────────────────────────────────
const PHASE_ICONS = [Package, CheckCircle, Wrench, CreditCard, Plane, Shield, Warehouse, Truck];

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
                ? 'text-sm font-semibold text-emerald-700'
                : isActive
                ? 'text-sm font-black text-gray-900'
                : 'text-sm font-medium text-gray-400'
            }`}
          >
            {phase.label}
          </p>
          {isActive && (
            <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-accent)' }}>
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
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const { sel, selDest, feuVert, ask, flash, authCl, envois = [] } = useApp();

  const curPhaseIdx = sel ? getPhaseIndex(sel.statut) : 0;
  const [timeOpen, setTimeOpen] = useState(curPhaseIdx);
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [showWait, setShowWait] = useState(false);
  const [waitUntil, setWaitUntil] = useState('');
  const [waitReason, setWaitReason] = useState('J’attends d’autres achats');
  useEffect(() => { setTimeOpen(curPhaseIdx); setDecisionError(''); setShowWait(false); }, [sel?.id, curPhaseIdx]);
  if (!sel) return null;
  const manifest = cartonManifest(sel);
  const journey = clientJourney(sel);
  const task = clientWorkState(sel, authCl);
  const published = quotePresentation(sel, authCl, selDest);
  const price = published.colis;
  const clientWaiting = journey.waiting;
  const trackingOut = outgoingTracking(sel, envois);
  const logistics = latestLogisticsEvent(sel);
  const openPanel = panel => setParams(previous => { const next = new URLSearchParams(previous); next.set('panel', panel); return next; }, { replace: true });

  const toggleStep = (idx) => {
    if (getPhaseState(idx, curPhaseIdx) !== 'future') setTimeOpen((prev) => prev === idx ? null : idx);
  };
  const recordDecision = async (decision, options) => {
    setDecisionPending(true); setDecisionError('');
    try { await feuVert(sel.id, decision, { expectedUpdatedAt: sel.updatedAt, ...options }); setShowWait(false); }
    catch (error) { setDecisionError(error.message || 'Votre réponse n’a pas été enregistrée. Réessayez.'); }
    finally { setDecisionPending(false); }
  };
  const handleFeuVert = (ok) => {
    const cartons = (sel.trackings || []).filter(Boolean);
    ask(ok ? 'Autoriser cette préparation' : 'Refuser cette préparation',
      ok ? `Vous autorisez la préparation du dossier ${sel.ref}, avec ${manifest.count} carton(s) actuellement réceptionné(s).${cartons.length ? '\n\n' + cartons.join(' · ') : ''}\n\nLes nouveaux cartons ne sont pas inclus. Le devis final suivra la préparation.`
        : `Vous refusez la préparation du dossier ${sel.ref}. Pour simplement attendre d’autres achats, choisissez « Attendre » à la place.`,
      () => recordDecision(ok), { danger: !ok, okLabel: ok ? 'J’autorise ce dossier' : 'Confirmer le refus' });
  };
  const handleRevoke = () => {
    openPanel('messages');
    flash('Précisez votre demande dans la conversation. Notre équipe vous confirmera si la préparation peut encore être arrêtée.');
  };
  const handlePayer = () => {
    if (hasPublishedQuote(sel) && sel.payplugPaymentUrl && /^https:\/\//.test(sel.payplugPaymentUrl)) window.open(sel.payplugPaymentUrl, '_blank', 'noopener,noreferrer');
    else openPanel('messages');
  };

  // ── Phase content renderers ───────────────────────────────────────────────
  const phaseContent = (phaseIdx) => {
    const phase = PHASES_CLIENT[phaseIdx];

    // Phase 0 – Réception
    if (phaseIdx === 0) {
      const hasDims = sel.dimL && sel.dimW && sel.dimH && sel.poids;
      return (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 leading-relaxed">
            {curPhaseIdx === 0
              ? 'Votre colis est arrivé à l\'entrepôt. Nous sommes en train de le mesurer.'
              : 'Votre colis a été réceptionné et mesuré.'}
          </p>
          {sel.dateReception && (
            <p className="text-sm font-medium text-gray-400">
              Reçu le {new Date(sel.dateReception).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {' à '}{new Date(sel.dateReception).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {sel.casier && (
            <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-xl px-3 py-2">
              <Package size={13} />
              <span>Casier : <span className="font-black">{sel.casier}</span></span>
            </div>
          )}
          {hasDims && sel.dimsParColis && sel.dimsParColis.length > 1 ? (
            <div className="rounded-xl bg-gray-50 p-3 space-y-2">
              <p className="text-sm font-black uppercase tracking-widest text-gray-400 mb-1">
                Dimensions mesurées ({sel.dimsParColis.length} colis)
              </p>
              {sel.dimsParColis.map((d, i) => (
                <div key={i} className="rounded-lg bg-white p-2 border border-gray-100">
                  <p className="text-sm font-bold text-gray-400 mb-0.5">
                    Carton {i + 1}{receptionCartonManifest(sel).trackingsDetail[i]?.number ? ` · ${receptionCartonManifest(sel).trackingsDetail[i].number}` : ' · Sans numéro de suivi'}
                  </p>
                  <Ligne label="L × W × H" value={`${d.dimL} × ${d.dimW} × ${d.dimH} cm`} />
                  <Ligne label="Poids" value={`${d.poids} kg`} />
                </div>
              ))}
            </div>
          ) : hasDims ? (
            <div className="rounded-xl bg-gray-50 p-3 space-y-1">
              <p className="text-sm font-black uppercase tracking-widest text-gray-400 mb-2">Dimensions mesurées</p>
              <Ligne label="Dimensions" value={`${sel.dimL} × ${sel.dimW} × ${sel.dimH} cm`} />
              <Ligne label="Poids" value={`${sel.poids} kg`} />
            </div>
          ) : (
            <p className="text-sm text-amber-600 flex items-center gap-1.5 bg-amber-50 rounded-xl px-3 py-2">
              <Clock size={13} />
              Mesures en cours…
            </p>
          )}
        </div>
      );
    }

    // Phase 2 – Accord (feu vert)
    if (phaseIdx === 1) {
      const isFV = sel.statut === 'attente_feu_vert' && !sel.archive;
      const isAutorise = sel.statut === 'autorise' || (sel.feuVert === 'autorise');
      const isRefuse = sel.statut === 'refuse_client';

      return (
        <div className="space-y-3">
          {isFV && (
            <>
              {clientWaiting && <p className="border-l-2 border-slate-300 pl-3 text-sm text-slate-600">Votre attente est enregistrée. Aucune préparation ne commence tant que vous n’avez pas donné votre accord.</p>}
              {decisionError && <p role="alert" className="text-sm text-red-700">{decisionError}</p>}
              <p className="text-sm font-semibold text-slate-700">{manifest.count} carton(s) réceptionné(s) · dossier {sel.ref}</p>
              {manifest.trackings.length > 0 && <p className="break-words text-sm text-slate-600">Références connues : {manifest.trackings.join(' · ')}</p>}
              <p className="text-sm text-slate-600">Votre accord concerne ces cartons uniquement. Le devis suivra l’optimisation.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button disabled={decisionPending} onClick={() => handleFeuVert(true)} className="min-h-11 flex items-center justify-center gap-2 rounded-xl px-3 py-3 font-bold text-sm text-white brand-bg disabled:opacity-50"><ThumbsUp size={16} />{decisionPending ? 'Enregistrement…' : 'Autoriser la préparation'}</button>
                <button disabled={decisionPending} onClick={() => setShowWait((v) => !v)} aria-expanded={showWait} className="min-h-11 flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold text-slate-700"><Clock size={16} />Attendre d’autres achats</button>
              </div>
              {showWait && <form className="border border-gray-200 rounded-xl p-3 space-y-3" onSubmit={(event) => { event.preventDefault(); recordDecision('wait', { waitUntil: waitUntil || null, reason: waitReason.trim() }); }}>
                <p className="text-sm text-gray-600">Nous conservons votre dossier en attente. Cette demande ne déclenche aucune préparation.</p>
                <label className="block text-sm font-semibold text-gray-600">Votre précision<textarea required maxLength={500} value={waitReason} onChange={(e) => setWaitReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-200 p-2 text-sm bg-white" /></label>
                <label className="block text-sm font-semibold text-gray-600">Attendre jusqu’au (facultatif)<input type="date" min={new Date().toLocaleDateString('en-CA')} value={waitUntil} onChange={(e) => setWaitUntil(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-gray-200 px-2 text-sm bg-white" /></label>
                <button disabled={decisionPending || !waitReason.trim()} className="min-h-11 w-full rounded-xl brand-bg text-white text-sm font-semibold disabled:opacity-50">{decisionPending ? 'Enregistrement…' : 'Enregistrer mon attente'}</button>
              </form>}
              <details className="border-t border-slate-200 pt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Mesures et fonctionnement</summary><div className="space-y-3">              {sel.dimsParColis && sel.dimsParColis.length > 1 ? (
                <div className="rounded-xl bg-gray-50 p-3 space-y-2">
                  <p className="text-sm font-black uppercase tracking-widest text-gray-400 mb-1">
                    Dimensions mesurées ({sel.dimsParColis.length} colis)
                  </p>
                  {sel.dimsParColis.map((d, i) => (
                    <div key={i} className="rounded-lg bg-white p-2 border border-gray-100">
                      <p className="text-sm font-bold text-gray-400 mb-0.5">
                        Carton {i + 1}{receptionCartonManifest(sel).trackingsDetail[i]?.number ? ` · ${receptionCartonManifest(sel).trackingsDetail[i].number}` : ' · Sans numéro de suivi'}
                      </p>
                      <Ligne label="L × W × H" value={`${d.dimL} × ${d.dimW} × ${d.dimH} cm`} />
                      <Ligne label="Poids" value={`${d.poids} kg`} />
                    </div>
                  ))}
                </div>
              ) : sel.dimL ? (
                <div className="rounded-xl bg-gray-50 p-3 space-y-1">
                  <p className="text-sm font-black uppercase tracking-widest text-gray-400 mb-2">Dimensions mesurées</p>
                  <Ligne label="L × W × H" value={`${sel.dimL} × ${sel.dimW} × ${sel.dimH} cm`} />
                  <Ligne label="Poids" value={`${sel.poids} kg`} />
                </div>
              ) : null}
              <div className="rounded-xl p-3 border border-blue-100" style={{ backgroundColor: BRAND.navy + '06' }}>
                <p className="text-sm font-black uppercase tracking-widest mb-1.5" style={{ color: 'var(--brand-text)' }}>
                  Comment ça marche ?
                </p>
                <div className="space-y-1.5 text-sm text-gray-600 leading-relaxed">
                  <p>1. Vous donnez votre accord ci-dessous</p>
                  <p>2. Nous préparons et optimisons votre colis</p>
                  <p>3. Vous recevez le devis final à payer</p>
                </div>
              </div>
              {clientWaiting && <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700"><p className="font-semibold">Votre demande d’attente est enregistrée</p><p className="mt-1">{sel.attenteClientMotif}{sel.attenteClientUntil ? ` · Jusqu’au ${new Date(sel.attenteClientUntil).toLocaleDateString('fr-FR')}` : ''}</p><p className="text-sm text-gray-500 mt-1">Vous pouvez utiliser le bouton « Autoriser la préparation » dès que vous êtes prêt.</p></div>}
</div></details>
              <button disabled={decisionPending} onClick={() => handleFeuVert(false)} className="min-h-11 flex items-center gap-2 text-sm font-semibold text-red-700"><ThumbsDown size={15} />Refuser la préparation</button>
            </>
          )}
          {isAutorise && (
            <>
              <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-100">
                <p className="text-sm font-bold text-emerald-700 flex items-center gap-1.5 mb-1">
                  <CheckCircle size={13} />
                  Accord donné
                </p>
                <p className="text-sm text-emerald-600 leading-relaxed">
                  Vous avez autorisé la préparation de ce colis. Expedîle va le préparer pour l'expédition.
                </p>
              </div>
              <button
                onClick={handleRevoke}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-400 hover:text-red-500 transition-colors"
              >
                <RotateCcw size={11} />
                Demander l’annulation de mon accord
              </button>
            </>
          )}
          {isRefuse && (
            <div className="rounded-xl p-3 bg-red-50 border border-red-100">
              <p className="text-sm font-bold text-red-700 flex items-center gap-1.5">
                <AlertCircle size={13} />
                Préparation refusée
              </p>
              <p className="text-sm text-red-600 mt-1 leading-relaxed">
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
          <p className="text-sm text-gray-500 leading-relaxed">
            {curPhaseIdx === 2
              ? 'Votre colis est en cours de préparation et d\'optimisation dans notre entrepôt.'
              : 'La préparation est terminée.'}
          </p>
          {curPhaseIdx === 2 && (
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded-xl px-3 py-2">
              <Wrench size={13} />
              Traitement en cours — nous vous informerons dès que le devis est prêt
            </div>
          )}
          {sel.casier && (
            <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-xl px-3 py-2">
              <Package size={13} />
              <span>Casier : <span className="font-black">{sel.casier}</span></span>
            </div>
          )}
          {sel.photoPrep && (
            <div className="rounded-xl overflow-hidden border border-gray-200">
              <SecureImage src={sel.photoPrep} alt="Photo de votre colis préparé" className="w-full h-auto" />
              <div className="px-3 py-2 bg-gray-50 text-sm text-gray-500 flex items-center gap-1.5">
                <Camera size={11} />
                Photo de votre colis préparé par notre équipe
              </div>
            </div>
          )}
        </div>
      );
    }

    // Phase 4 – Devis & Paiement
    if (phaseIdx === 3) {
      const isPay = ['devis_envoye', 'attente_paiement'].includes(sel.statut);
      const isPaye = sel.paiementMontant != null;
      const hasDevis = hasPublishedQuote(sel);

      return (
        <div className="space-y-3">
          {hasDevis && <p className="flex flex-wrap items-baseline justify-between gap-2 text-base font-semibold text-slate-800"><span>{isPaye ? 'Total du devis' : 'Montant à régler'}</span><strong className="text-2xl">{eur(price.devisTotal)}</strong></p>}
          {hasDevis && isPay && !isPaye && !sel.archive && (
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
              {sel.payplugPaymentUrl ? `Payer ${hasDevis ? eur(price.devisTotal) : ''}` : published.client.type === 'pro' ? 'Consulter les échanges de règlement' : 'Contacter l’équipe pour le règlement'}
            </button>
          )}
          {hasDevis && (
            <details className="rounded-xl border border-gray-100 overflow-hidden">
              <summary
                className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold"
                style={{ backgroundColor: BRAND.navy + '08', color: 'var(--brand-text)' }}
              >
                Détail du devis
              </summary>
              <div className="p-3 space-y-1">
                {price.avantOptimTransport != null && price.avantOptimTransport !== price.devisTransport && (
                  <>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-400 line-through">Transport brut</span>
                      <span className="text-gray-400 line-through">{eur(price.avantOptimTransport)}</span>
                    </div>
                  </>
                )}
                <Ligne label="Transport optimisé" value={eur(price.devisTransport)} />
                {/* Taxes douanières par catégorie */}
                {price.devisOM > 0 && <Ligne label="Octroi de mer" value={eur(price.devisOM)} />}
                {price.devisOMR > 0 && <Ligne label="Octroi de mer régional" value={eur(price.devisOMR)} />}
                {(price.fraisDivers || []).filter((f) => Number(f.montant) > 0).map((f, i) => <Ligne key={i} label={f.libelle || f.label || f.nom || 'Frais complémentaires'} value={eur(f.montant)} />)}
                {price.devisTVA != null && price.devisTVA > 0 && (
                  <Ligne label={published.destination.tva == null ? 'TVA (taux historique non documenté)' : `TVA (${published.destination.tva}%)`} value={eur(price.devisTVA)} />
                )}
                <div className="border-t border-gray-100 mt-2 pt-2">
                  <div className="flex justify-between items-center">
                    <span className="font-black text-sm text-gray-900">Total</span>
                    <span className="font-black text-lg" style={{ color: 'var(--brand-text)' }}>
                      {eur(price.devisTotal)}
                    </span>
                  </div>
                  {price.economie != null && price.economie > 0 && (
                    <div className="mt-1.5 text-sm font-bold text-emerald-600 bg-emerald-50 rounded-lg px-2.5 py-1.5 flex items-center gap-1">
                      <span>Économie réalisée : {eur(price.economie)}</span>
                    </div>
                  )}
                </div>
              </div>
            </details>
          )}

          {hasDevis && <div className="border-t border-slate-200 pt-3 text-sm text-slate-600">
            <p className="font-semibold">{published.version ? `Devis publié · version ${published.version}` : 'Devis historique'}</p>
            {published.issuedAt && <p className="mt-1 text-sm">Établi le {new Date(published.issuedAt).toLocaleDateString('fr-FR')}</p>}
            {published.paymentMode && <p className="mt-2">Modalités convenues : <strong>{PAYMENT_TERMS[published.paymentMode] || published.paymentMode}</strong>.</p>}
            {published.client.type === 'pro' && !isPaye && <p className="mt-1">{published.paymentMode === 'virement' ? 'Utilisez les coordonnées bancaires transmises par notre équipe. Si vous ne les avez pas, demandez-les dans les échanges ci-dessous.' : ['30_jours','fin_de_mois'].includes(published.paymentMode) ? 'La date exacte d’échéance est celle communiquée par notre équipe. Consultez les échanges si elle ne figure pas sur votre devis.' : published.paymentMode === 'especes' ? 'Contactez notre équipe pour convenir de la remise du règlement.' : 'Les modalités sont à confirmer avec notre équipe.'} La réception du règlement sera confirmée ici.</p>}
            {published.client.type === 'pro' && !isPaye && <div className="mt-2 space-y-2"><p className="text-sm">Référence à communiquer pour le règlement : <strong>{price.ref}</strong> · {eur(price.devisTotal)}.</p><button className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold" onClick={async () => { try { await navigator.clipboard.writeText(`${price.ref} · ${eur(price.devisTotal)}`); flash('Référence de règlement copiée'); } catch { flash({ msg: 'Copie indisponible. La référence reste affichée ci-dessus.', type: 'error' }); } }}>Copier la référence de règlement</button></div>}

          </div>}
          {isPaye && (
            <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-100 flex items-center gap-2">
              <CheckCircle size={15} className="text-emerald-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-emerald-700">Paiement confirmé</p>
                <p className="text-sm text-emerald-600">{eur(sel.paiementMontant)} reçu</p>
              </div>
            </div>
          )}

          {hasDevis && (
            <button
              onClick={async () => { try { const { exportDevisPDF } = await import('../../utils/exportDevisPDF'); await exportDevisPDF(sel, authCl, getDestByCP(authCl?.cp)); } catch (error) { flash({ msg: 'Le PDF n’a pas pu être généré. ' + error.message, type: 'error' }); } }}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
              style={{ background: `${BRAND.navy}10`, color: 'var(--brand-text)' }}
            >
              <Download size={15} />
              Télécharger le devis (PDF)
            </button>
          )}



          {!hasDevis && !isPaye && (
            <p className="text-sm text-gray-400 flex items-center gap-1.5 bg-gray-50 rounded-xl px-3 py-2">
              <Clock size={13} />
              {journey.quoteNeedsReview ? 'Votre devis est en cours de révision. Aucun règlement n’est demandé pour la version retirée.' : 'Le devis sera disponible prochainement'}
            </p>
          )}
        </div>
      );
    }

    // Phase 5 – Expédition
    if (phaseIdx === 4) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 leading-relaxed">
            {sel.statut === 'expedie'
              ? 'Votre colis a été remis au transporteur.'
              : sel.statut === 'transit'
              ? 'Votre colis est en vol vers votre destination !'
              : 'Votre colis est en route.'}
          </p>
          {sel.statut === 'transit' && (
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${BRAND.navy}, #0891B2)` }}
            >
              <Plane size={14} />
              Vol en cours vers {selDest?.nom || 'votre destination'} {selDest?.flag || ''}
            </div>
          )}
          {trackingOut ? <a href={`https://parcelsapp.com/fr/tracking/${encodeURIComponent(trackingOut)}`} target="_blank" rel="noopener noreferrer" className="min-h-11 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold brand-t bg-slate-50"><ExternalLink size={16} />Suivi vers votre adresse · {trackingOut}</a> : <p className="text-sm text-slate-600">Le suivi transporteur vers votre adresse n’est pas encore renseigné. Les étapes de votre expédition restent visibles ici.</p>}
          {manifest.trackings.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-slate-600">Suivis fournisseurs vers l’entrepôt</summary>{manifest.trackings.map(number => <a key={number} href={`https://parcelsapp.com/fr/tracking/${encodeURIComponent(number)}`} target="_blank" rel="noopener noreferrer" className="min-h-11 flex items-center gap-2 break-all text-sm underline"><ExternalLink size={16} />{number}</a>)}</details>}
        </div>
      );
    }

    if (phaseIdx === 5) return <p className="text-sm text-slate-600">{sel.statut === 'dedouanement' ? 'Votre colis est en cours de dédouanement. Notre équipe suit cette étape avant sa mise à disposition au dépôt local.' : 'Étape de dédouanement passée.'}</p>;
    if (phaseIdx === 6) return <p className="text-sm text-slate-600">{sel.statut === 'arrive' ? 'Votre colis est arrivé au dépôt local. Notre équipe organise la livraison et vous informera des modalités confirmées.' : 'Passage au dépôt local enregistré.'}</p>;
    // Livraison
    if (phaseIdx === 7) {
      const isLivre = sel.statut === 'livre';
      const isEnLivraison = sel.statut === 'livraison';
      const isArrive = sel.statut === 'arrive';

      return (
        <div className="space-y-3">
          {isArrive && (
            <div className="flex items-center gap-2 text-sm font-semibold text-teal-700 bg-teal-50 rounded-xl px-3 py-2">
              <MapPin size={13} />
              Colis arrivé à destination — livraison en cours de planification
            </div>
          )}
          {isEnLivraison && (
            <div className="flex items-center gap-2 text-sm font-semibold text-lime-700 bg-lime-50 rounded-xl px-3 py-2">
              <MapPin size={13} />
              Votre colis est en cours de livraison
            </div>
          )}
          {isLivre && (
            <div className="text-center py-3 space-y-2">
              <CheckCircle size={40} className="mx-auto text-emerald-600" />
              <p className="font-black text-xl text-gray-900">Livré !</p>
              <p className="text-sm text-gray-500">
                Votre colis a bien été livré à {selDest?.nom || 'votre domicile'}.
              </p>
              <div className="flex items-center justify-center gap-1.5 text-sm font-bold text-emerald-600">
                <CheckCircle size={14} />
                Livraison confirmée
              </div>
            </div>
          )}
          {!isLivre && !isEnLivraison && !isArrive && (
            <p className="text-sm text-gray-400 flex items-center gap-1.5 bg-gray-50 rounded-xl px-3 py-2">
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
          onClick={() => navigate('/colis')}
          aria-label="Retour à mes colis" className="flex-shrink-0 min-w-11 min-h-11 rounded-xl flex items-center justify-center transition-all active:scale-90 hover:bg-gray-100"
        >
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-black text-gray-900 leading-none">{sel.ref}</h2>

          </div>
          <p className="text-sm text-gray-400 truncate mt-0.5">{sel.desc}</p>
        </div>
      </div>

      <section aria-label="État actuel et prochaine étape" className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div><p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Étape actuelle</p><h2 className="mt-1 text-lg font-bold text-slate-800">{journey.label}</h2></div>
        {task.kind === 'none' ? <><p className="font-semibold text-slate-700">Aucune action attendue de votre part.</p><p className="text-sm text-slate-600">{journey.next}</p></> : <p className="text-sm font-semibold text-slate-700">À vous · {task.action}</p>}
        {task.kind === 'agreement' && phaseContent(1)}
        {task.kind === 'payment' && phaseContent(3)}
        {['documents','messages'].includes(task.kind) && <button onClick={() => openPanel(task.kind)} className="min-h-11 w-full rounded-xl brand-bg px-4 py-3 text-sm font-semibold text-white">{task.action}</button>}
        {clientWaiting && <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><p>{sel.attenteClientMotif || 'Vous avez demandé à attendre avant la préparation.'}</p><p className="mt-1">Attente enregistrée le {new Date(sel.attenteClientDate).toLocaleDateString('fr-FR')}{sel.attenteClientUntil ? ` · Réexamen prévu le ${new Date(sel.attenteClientUntil).toLocaleDateString('fr-FR')}` : ''}</p></div>}
        {['expedie','transit','dedouanement','arrive','livraison','livre'].includes(sel.statut) && <p className="text-sm text-slate-600">{logistics ? `Dernier événement logistique renseigné : ${logistics.label.toLocaleLowerCase('fr')} le ${new Date(logistics.date).toLocaleDateString('fr-FR')}.` : 'Date du dernier événement logistique non renseignée.'}{sel.statut !== 'livre' ? ' La date de livraison sera précisée lorsqu’elle sera confirmée.' : ''}</p>}
        {clientWaiting && <details className="border-t border-slate-200 pt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-700">Reprendre ma décision</summary>{phaseContent(1)}</details>}
        {journey.event && <p className="text-sm text-slate-500">{journey.event.label} le {new Date(journey.event.date).toLocaleDateString('fr-FR')}</p>}
      </section>

      <details className="rounded-xl border border-slate-200 p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-700">Suivi et détails de l’expédition</summary><div className="space-y-4 pt-3">
        {sel.finalPackages?.length > 0 && <details className="rounded-xl border border-slate-200 p-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-slate-700">Après optimisation · {sel.finalPackages.length} colis sortant{sel.finalPackages.length > 1 ? 's' : ''}</summary><div className="space-y-2 text-sm text-slate-600">{sel.finalPackages.map((box,index) => <p key={index}>Colis {index + 1} · {box.dimL} × {box.dimW} × {box.dimH} cm · {box.poids} kg</p>)}</div></details>}
        {sel.statut !== 'annule' && <ProgressBar statut={sel.statut} size="md" showLabel={false} />}
        {sel.statut === 'annule' && <p className="text-sm text-slate-600">Ce dossier a été annulé. Les documents et échanges restent consultables.</p>}
        {sel.statut !== 'annule' && <div className="space-y-2">{PHASES_CLIENT.map((phase, idx) => {
          const state = getPhaseState(idx, curPhaseIdx);
          if (state === 'future' || (idx === 1 && (task.kind === 'agreement' || clientWaiting)) || (idx === 3 && task.kind === 'payment')) return null;
          return <PhaseStep key={phase.key} phase={phase} phaseIdx={idx} state={state} open={timeOpen === idx} onToggle={() => toggleStep(idx)}>{phaseContent(idx)}</PhaseStep>;
        })}</div>}
        {!['annule','refuse_client'].includes(sel.statut) && curPhaseIdx < PHASES_CLIENT.length - 1 && <div><p className="mb-2 text-sm font-semibold text-slate-500">Prochaines étapes</p><div className="flex flex-wrap gap-2">{PHASES_CLIENT.slice(curPhaseIdx + 1).map(phase => <span key={phase.key} className="inline-flex items-center gap-1 text-sm text-slate-600"><ChevronRight size={12} />{phase.label}</span>)}</div></div>}
      </div></details>

      {/* Spacer so last card isn't under bottom nav */}
      <div className="h-2" />
    </div>
  );
}
