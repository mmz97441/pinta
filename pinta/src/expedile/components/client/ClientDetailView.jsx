import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Package, CheckCircle, Wrench, CreditCard, Plane, MapPin,
  ChevronDown, ChevronUp, ChevronRight, AlertCircle, ThumbsUp, ThumbsDown, RotateCcw,
  ExternalLink, Clock, Download, Camera, Shield, Warehouse, Truck, RefreshCw, FileText, Upload,
  MessageCircle, CalendarDays, Info,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { hasPublishedQuote } from './quoteVisibility';
import { hasCurrentPreparation } from '../../domain/preparationReadiness';
import { invoiceRequestState } from '../../domain/invoiceRequest';
import { currentInvoices } from '../../domain/invoiceDocuments';
import { plural, pluralWord } from '../../domain/plural';
import {
  cartonManifest, clientJourney, clientWorkState, quotePresentation, PAYMENT_TERMS, outgoingTracking, latestShipmentNews,
  clientDate, clientDay, clientPhaseState, clientTaskExplanation, plannedDepartureMessage, plannedDepartureShown, cartonMeasures,
  measureText, firstWaitDay, waitUntilInstant,
} from '../../domain/clientJourney';
import { useApp } from '../../context/AppContext';
import { SecureImage } from '../ui/SecureFile';
import { BRAND, PHASES_CLIENT, getPhaseIndex, getDestByCP } from '../../constants';

import { eur } from '../../utils';
import { Ligne, ProgressBar } from '../ui';
import ImportTaxLines from '../ui/ImportTaxLines';
import { importTaxEstimate } from '../../domain/importTaxes';

// ── Phase icons ────────────────────────────────────────────────────────────────
const PHASE_ICONS = [Package, CheckCircle, Wrench, CreditCard, Plane, Shield, Warehouse, Truck];
const SHIPPED = ['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre'];
// The delivery date is announced once, here, until the parcel is at the local depot.
const DELIVERY_DATE_PENDING = ['expedie', 'transit', 'dedouanement'];
// Theme-safe surfaces: Tailwind utilities that brand.css remaps in dark mode, plus explicit dark: variants.
const SECONDARY_BUTTON = 'flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold brand-t transition-all duration-200 ease-out hover:bg-slate-50 active:scale-[0.98] dark:hover:bg-white/5';
const PRIMARY_BUTTON = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-xl brand-bg px-4 py-3 text-sm font-semibold text-white transition-all duration-200 ease-out hover:translate-y-[-1px] active:scale-[0.98] disabled:opacity-50';
const NB = '\u00a0';
// A technical refusal (network, database) is never shown as is to the client.
const TECHNICAL = /failed|fetch|network|load failed|violat|constraint|exception|unexpected|syntax|null value|duplicate key|permission denied|jwt|error/i;
/** What a refused decision tells the client: why, and what to do now. `field: 'date'` goes under the date. */
function decisionRefusal(error, decision, firstWait) {
  const message = String(error?.message || '');
  if (/date de reprise/i.test(message)) return { field: 'date', message: `Choisissez une date de reprise à partir du ${clientDate(firstWait)}.` };
  if (/ne peut plus être modifiée/i.test(message)) return { stale: true, message: `Cette demande a déjà reçu une réponse ou a changé${NB}: l’état de votre expédition est à jour ci-dessous.` };
  if (error?.stale) return { stale: true, message: decision === 'wait'
    ? `Votre expédition vient d’être mise à jour (un nouveau carton, par exemple)${NB}: vérifiez-la, puis enregistrez à nouveau votre attente.`
    : `Votre expédition vient d’être mise à jour (un nouveau carton, par exemple)${NB}: vérifiez-la ci-dessous, puis confirmez à nouveau.` };
  return { message: `Votre réponse n’a pas été enregistrée.${message && !TECHNICAL.test(message) ? ` ${message}` : ' Vérifiez votre connexion, puis réessayez.'}` };
}
// A pause refused because the expedition no longer awaits the client's consent (a carton arrived and is
// being measured, or the request was already answered): the form stays open with this reason under it.
const WAIT_NO_LONGER_POSSIBLE = `Votre attente n’a pas été enregistrée${NB}: votre expédition a changé entre-temps (un nouveau carton, par exemple). Son état est à jour ci-dessus. Si votre accord est de nouveau nécessaire, nous vous le demanderons, et vous pourrez alors enregistrer votre attente.`;

// ── Phase accordion step ───────────────────────────────────────────────────────
// Icons and chevrons use theme tokens: navy text in light mode, the light brand text in dark mode.
function PhaseStep({ phase, phaseIdx, state, open, onToggle, children }) {
  const Icon = PHASE_ICONS[phaseIdx] || Package;
  const isDone = state === 'done';
  const isActive = state === 'active';
  return (
    <div
      className={`overflow-hidden rounded-2xl transition-all duration-200 ease-out ${isActive ? 'card-elevated' : 'card'}`}
      style={{ borderLeft: `4px solid ${isActive ? 'var(--brand-text)' : 'var(--success)'}` }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex min-h-11 w-full items-center gap-3 px-4 text-left ${isActive ? 'py-3.5' : 'py-2.5'}`}
      >
        <span aria-hidden="true" className={`flex flex-shrink-0 items-center justify-center rounded-xl ${isActive ? 'h-9 w-9 brand-bg-l' : 'h-7 w-7 bg-emerald-50'}`}>
          {isDone ? <CheckCircle size={16} className="text-emerald-700" /> : <Icon size={18} strokeWidth={2.2} className="brand-t" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm leading-snug ${isDone ? 'font-semibold text-emerald-800' : 'font-black text-slate-900'}`}>
            {phase.label}{isDone && <span className="sr-only"> · étape terminée</span>}
          </span>
          {isActive && <span className="mt-0.5 block text-sm font-semibold" style={{ color: 'var(--text-accent)' }}>Étape en cours</span>}
        </span>
        <span aria-hidden="true" className={`flex flex-shrink-0 items-center justify-center rounded-full bg-slate-100 ${isActive ? 'h-7 w-7' : 'h-6 w-6'}`}>
          {open ? <ChevronUp size={14} className="text-slate-600" /> : <ChevronDown size={14} className="text-slate-600" />}
        </span>
      </button>
      {open && children && (
        <div className="anim-slide-down px-4 pb-4">
          <div className="border-t border-slate-200 pt-3">{children}</div>
        </div>
      )}
    </div>
  );
}

/** One vocabulary (cartons): one line per measured carton, or the global measures of a dossier measured as a whole. */
function CartonMeasures({ colis, pendingText = '' }) {
  const measures = cartonMeasures(colis);
  if (measures.mode === 'none') return pendingText ? (
    <p className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800"><Clock size={14} aria-hidden="true" />{pendingText}</p>
  ) : null;
  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-3" data-testid="carton-measures">
      <p className="text-sm font-black uppercase tracking-wider text-slate-500">{measures.title}</p>
      {measures.mode === 'global'
        ? <p className="text-sm text-slate-700">{measures.count > 1 ? 'Ces mesures concernent l’ensemble de vos cartons' : 'Mesures enregistrées'}&nbsp;: <span className="whitespace-nowrap font-semibold">{measureText(measures.global)}</span>.</p>
        : <ul className="divide-y divide-slate-200 dark:divide-[var(--border-subtle)]">{measures.cartons.map(carton => (
          <li key={carton.index} className="py-1.5 text-sm">
            <p className="font-semibold text-slate-700">Carton {carton.index}{carton.number && <span className="font-normal text-slate-600"> · <span className="break-all">{carton.number}</span></span>}</p>
            <p className="text-slate-600">{carton.measures ? measureText(carton.measures) : 'Mesures non renseignées'}</p>
          </li>
        ))}</ul>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ClientDetailView() {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const { sel, selDest, feuVert, ask, flash, authCl, envois = [], fetchPlannedDepartures, refreshColis, settings } = useApp();

  const curPhaseIdx = sel ? getPhaseIndex(sel.statut) : 0;
  const [timeOpen, setTimeOpen] = useState(curPhaseIdx);
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  // A decision refused because the expedition changed meanwhile: it was read again, this notice says so.
  const [updateNotice, setUpdateNotice] = useState('');
  const [waitError, setWaitError] = useState(null);
  const [trackingRetry, setTrackingRetry] = useState(false);
  // A new attempt to read the carrier tracking failed again: said next to its « Réessayer ».
  const [trackingRetryFailed, setTrackingRetryFailed] = useState(false);
  const [showWait, setShowWait] = useState(false);
  // A pause the server refused: its form stays open with the reason under it, whatever step the
  // expedition read again has reached (the step change would otherwise close it).
  const waitKept = useRef(false);
  const [waitVersion, setWaitVersion] = useState(null);
  const [waitUntil, setWaitUntil] = useState('');
  const [waitReason, setWaitReason] = useState('J’attends d’autres achats');
  const [descOpen, setDescOpen] = useState(false);
  const [descClamped, setDescClamped] = useState(false);
  const descRef = useRef(null);
  // client_planned_departures: { colisId, state: idle | loading | ready | error, date }.
  const [departure, setDeparture] = useState({ colisId: null, state: 'idle', date: null });
  const [departureAttempt, setDepartureAttempt] = useState(0);
  const departureWanted = plannedDepartureShown(sel);
  useEffect(() => { waitKept.current = false; setWaitError(null); setShowWait(false); setUpdateNotice(''); setTrackingRetryFailed(false); }, [sel?.id]);
  useEffect(() => { setTimeOpen(curPhaseIdx); setDecisionError(''); if (!waitKept.current) { setWaitError(null); setShowWait(false); } }, [sel?.id, curPhaseIdx]);
  useEffect(() => { setDescOpen(false); }, [sel?.id]);
  useEffect(() => {
    // A long description is clamped to two lines; the toggle appears only when text is actually hidden.
    const element = descRef.current;
    if (!element) return undefined;
    const measure = () => setDescClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [sel?.desc, descOpen]);
  useEffect(() => {
    // The planned departure day of this dossier only (never the staff-only desired day). A refresh keeps the
    // known day on screen; a failure is shown as such, never as « no date yet ».
    const colisId = sel?.id;
    if (!colisId || !departureWanted || typeof fetchPlannedDepartures !== 'function') { setDeparture({ colisId: null, state: 'idle', date: null }); return undefined; }
    let active = true;
    setDeparture(previous => previous.colisId === colisId && previous.state === 'ready' ? previous : { colisId, state: 'loading', date: null });
    fetchPlannedDepartures([colisId])
      .then(dates => { if (active) setDeparture({ colisId, state: 'ready', date: dates?.get?.(colisId) || null }); })
      .catch(() => { if (active) setDeparture({ colisId, state: 'error', date: null }); });
    return () => { active = false; };
  }, [sel?.id, sel?.statut, sel?.envoi, sel?.updatedAt, departureWanted, fetchPlannedDepartures, departureAttempt]);
  if (!sel) return null;
  const manifest = cartonManifest(sel);
  const journey = clientJourney(sel);
  const task = clientWorkState(sel, authCl);
  const published = quotePresentation(sel, authCl, selDest);
  const price = published.colis;
  const clientWaiting = journey.waiting;
  const trackingOut = outgoingTracking(sel, envois);
  const shipmentStarted = SHIPPED.includes(sel.statut);
  const delivered = sel.statut === 'livre';
  const news = shipmentStarted ? latestShipmentNews(sel) : null;
  const departureMessage = plannedDepartureMessage(sel, departure.colisId === sel.id ? departure : {});
  const departureDayShown = departureMessage?.kind === 'date';
  const previousPreparation = !hasCurrentPreparation(sel) || ['receptionne','mesure','attente_feu_vert','refuse_client','annule'].includes(sel.statut);
  const pro = authCl?.type === 'pro';
  // After the consent, before the quote: the purchase invoice still requested (same rule as the server), never for a professional.
  const invoiceReminder = ['autorise', 'en_preparation'].includes(sel.statut) && !sel.paiementDate && !sel.archive
    && !pro && invoiceRequestState(sel).requested;
  // The consent request when no purchase invoice is in the dossier yet: the consent is possible, the invoice follows.
  const consentWithoutInvoice = sel.statut === 'attente_feu_vert' && !pro && currentInvoices(sel.factures).length === 0;
  const taskExplanation = clientTaskExplanation(sel, authCl, task);
  const waitedSince = clientDate(sel.attenteClientDate);
  // A day the client chose: on that day in every territory (never one day early in the Antilles).
  const waitReview = clientDay(sel.attenteClientUntil);
  // The first day the server accepts as a resumption date (never today).
  const firstWait = firstWaitDay();
  const openPanel = panel => setParams(previous => { const next = new URLSearchParams(previous); next.set('panel', panel); return next; }, { replace: true });

  const toggleStep = (idx) => {
    if (clientPhaseState(idx, sel.statut) !== 'future') setTimeOpen((prev) => prev === idx ? null : idx);
  };
  const closeWait = () => { waitKept.current = false; setWaitError(null); setShowWait(false); };
  const recordDecision = async (decision, options) => {
    setDecisionPending(true); setDecisionError(''); setWaitError(null); setUpdateNotice('');
    if (decision === 'wait') waitKept.current = false;
    try { await feuVert(sel.id, decision, { expectedUpdatedAt: sel.updatedAt, ...options }); closeWait(); }
    catch (error) {
      // A stale version: the expedition has been read again (feuVert), the decision now concerns what is shown.
      // The message goes where the person acts: in the open wait form, else at the top of the current step.
      const refusal = decisionRefusal(error, decision, firstWait);
      if (decision === 'wait') {
        // Whatever the refusal, the form stays open with its reason, on the expedition read again.
        const refreshed = error.refreshed || await refreshColis(sel.id).catch(() => null);
        const stillAsked = !refreshed || (refreshed.statut === 'attente_feu_vert' && !refreshed.archive);
        waitKept.current = true;
        setWaitError(stillAsked ? refusal : { closed: true, message: WAIT_NO_LONGER_POSSIBLE });
        if (refreshed?.updatedAt) setWaitVersion(refreshed.updatedAt);
        setShowWait(true);
      } else if (refusal.stale) setUpdateNotice(refusal.message);
      else setDecisionError(refusal.message);
    }
    finally { setDecisionPending(false); }
  };
  const submitWait = (event) => {
    event.preventDefault();
    if (decisionPending || sel.statut !== 'attente_feu_vert' || sel.archive) return;
    // A date the server would refuse is said under the field, before anything is sent.
    if (waitUntil && waitUntil < firstWait) {
      setWaitError({ field: 'date', message: `Choisissez une date de reprise à partir du ${clientDate(firstWait)}.` });
      document.getElementById('client-wait-until')?.focus();
      return;
    }
    recordDecision('wait', { expectedUpdatedAt: waitVersion, waitUntil: waitUntilInstant(waitUntil), reason: waitReason.trim() });
  };
  // A failed read of the tracking keeps the expedition (outgoingTrackingError, lib/supabaseData.js): a new
  // failure is said next to the button, never a silent return to « Réessayer ».
  const retryTracking = async () => {
    setTrackingRetry(true); setTrackingRetryFailed(false);
    try { const fresh = await refreshColis(sel.id); if (fresh?.outgoingTrackingError) setTrackingRetryFailed(true); }
    catch { setTrackingRetryFailed(true); }
    finally { setTrackingRetry(false); }
  };
  const handleFeuVert = (ok) => {
    const count = manifest.count;
    // The dialog takes plain text: non-breaking hyphens keep « EXP-TEST-001 » on one line.
    const reference = String(sel.ref).replace(/-/g, '\u2011');
    ask(ok ? 'Autoriser cette préparation' : 'Refuser cette préparation',
      ok ? `Vous autorisez la préparation de l’expédition ${reference}, avec ${plural(count, 'carton')} ${pluralWord(count, 'actuellement réceptionné', 'actuellement réceptionnés')}.${manifest.trackings.length ? '\n\n' + manifest.trackings.join(' · ') : ''}\n\nLes nouveaux cartons ne sont pas inclus. Le devis final suivra la préparation.${consentWithoutInvoice ? '\n\nVotre facture d’achat reste à joindre\u00a0: elle nous permet d’établir votre devis.' : ''}`
        : `Vous refusez la préparation de l’expédition ${reference}\u00a0: vos cartons ne seront pas préparés. Notre équipe vous contactera pour convenir avec vous de la suite.\n\nPour simplement attendre d’autres achats, choisissez plutôt «\u00a0Attendre d’autres achats\u00a0».`,
      () => recordDecision(ok), { danger: !ok, okLabel: ok ? 'J’autorise la préparation' : 'Confirmer le refus' });
  };
  const handleRevoke = () => {
    openPanel('messages');
    flash('Précisez votre demande dans la conversation. Notre équipe vous confirmera si la préparation peut encore être arrêtée.');
  };
  const handlePayer = () => {
    if (hasPublishedQuote(sel) && sel.payplugPaymentUrl && /^https:\/\//.test(sel.payplugPaymentUrl)) window.open(sel.payplugPaymentUrl, '_blank', 'noopener,noreferrer');
    else openPanel('messages');
  };
  const downloadQuote = async () => {
    // The issuer's legal identity comes from the shared settings (Paramètres › Facture commerciale).
    try { const { exportDevisPDF } = await import('../../utils/exportDevisPDF'); await exportDevisPDF(sel, authCl, getDestByCP(authCl?.cp), { business: settings, audience: 'client' }); }
    catch (error) { flash({ msg: 'Le PDF n’a pas pu être généré. ' + error.message, type: 'error' }); }
  };

  // The pause form: in the consent request, or, once the server refused it because the expedition no
  // longer awaits the client's consent (`possible` false), on its own in the current step, kept open with
  // the reason under it and the text typed, until the client closes it.
  const waitForm = (possible) => <form noValidate data-testid="client-wait-form" className="space-y-3 rounded-xl border border-slate-200 p-3" onSubmit={submitWait}>
    <fieldset disabled={!possible} className="min-w-0 space-y-3">
      <p className="text-sm text-slate-600">Nous conservons vos cartons et suspendons nos relances. Cette demande ne déclenche aucune préparation&nbsp;: vous donnerez votre accord quand vous serez prêt(e).</p>
      <label className="block text-sm font-semibold text-slate-600">Votre précision<textarea required maxLength={500} value={waitReason} onChange={(e) => setWaitReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2 text-sm" /></label>
      <div>
        {/* The first day offered is the first one the server accepts: never today. */}
        <label htmlFor="client-wait-until" className="block text-sm font-semibold text-slate-600">Attendre jusqu’au (facultatif)</label>
        <input id="client-wait-until" type="date" min={firstWait} value={waitUntil}
          onChange={(e) => { setWaitUntil(e.target.value); if (waitError?.field === 'date') setWaitError(null); }}
          aria-invalid={waitError?.field === 'date' ? 'true' : undefined} aria-describedby={waitError?.field === 'date' ? 'client-wait-until-error' : 'client-wait-until-hint'}
          className={`mt-1 block min-h-11 w-full rounded-lg border bg-white px-2 text-sm ${waitError?.field === 'date' ? 'border-red-600' : 'border-slate-200'}`} />
        {waitError?.field === 'date'
          ? <p id="client-wait-until-error" role="alert" className="mt-1 text-sm text-red-700">{waitError.message}</p>
          : <p id="client-wait-until-hint" className="mt-1 text-sm text-slate-600">À partir du {clientDate(firstWait)}. Sans date, nous attendons simplement votre accord.</p>}
      </div>
      {waitError && waitError.field !== 'date' && !(possible && waitError.closed) && <p role="alert" className="text-sm text-red-700">{waitError.message}</p>}
      <button disabled={!possible || decisionPending || !waitReason.trim()} className="min-h-11 w-full rounded-xl brand-bg text-sm font-semibold text-white transition-all duration-200 ease-out active:scale-[0.98] disabled:opacity-50">{decisionPending ? 'Enregistrement…' : 'Enregistrer mon attente'}</button>
    </fieldset>
    {!possible && <button type="button" onClick={closeWait} className={`${SECONDARY_BUTTON} w-full`}>Fermer</button>}
  </form>;

  // ── Phase content renderers ───────────────────────────────────────────────
  const phaseContent = (phaseIdx) => {
    // Phase 0 – Réception
    if (phaseIdx === 0) {
      const several = manifest.count > 1;
      return (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-slate-600">
            {sel.statut === 'receptionne'
              ? several ? 'Vos cartons sont arrivés à notre entrepôt. Notre équipe les mesure.' : 'Votre carton est arrivé à notre entrepôt. Notre équipe le mesure.'
              : several ? `Vos ${plural(manifest.count, 'carton')} ont été réceptionnés et mesurés.` : 'Votre carton a été réceptionné et mesuré.'}
          </p>
          {clientDate(sel.dateReception) && (
            <p className="text-sm font-medium text-slate-500">
              Reçu le {clientDate(sel.dateReception, { weekday: true })} à {new Date(sel.dateReception).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <CartonMeasures colis={sel} pendingText={sel.statut === 'receptionne' ? 'Mesures en cours…' : ''} />
        </div>
      );
    }

    // Phase 1 – Accord (feu vert)
    if (phaseIdx === 1) {
      const isFV = sel.statut === 'attente_feu_vert' && !sel.archive;
      const isAutorise = sel.statut === 'autorise' || (sel.feuVert === 'autorise');
      const isRefuse = sel.statut === 'refuse_client';
      const count = manifest.count;

      return (
        <div className="space-y-3">
          {isFV && (
            <>
              {clientWaiting && <p className="border-l-2 border-slate-300 pl-3 text-sm text-slate-600">Votre attente est enregistrée&nbsp;: aucune préparation ne commence tant que vous n’avez pas donné votre accord.</p>}
              {decisionError && <p role="alert" className="text-sm text-red-700">{decisionError}</p>}
              <p className="text-sm font-semibold text-slate-700">{plural(count, 'carton')} {pluralWord(count, 'réceptionné')} · expédition <span className="whitespace-nowrap">{sel.ref}</span></p>
              {manifest.trackings.length > 0 && <p className="break-words text-sm text-slate-600">{pluralWord(manifest.trackings.length, 'Numéro de suivi de vos achats', 'Numéros de suivi de vos achats')}&nbsp;: {manifest.trackings.join(' · ')}</p>}
              <p className="text-sm text-slate-600">Votre accord concerne {count > 1 ? `ces ${plural(count, 'carton')}` : 'ce carton'} uniquement. Vous recevrez le prix final après la préparation.</p>
              {consentWithoutInvoice && (
                <p data-testid="consent-without-invoice" className="flex items-start gap-2 rounded-xl border p-3 text-sm" style={{ backgroundColor: 'var(--attention-bg)', borderColor: 'var(--attention-border)', color: 'var(--attention-text)' }}>
                  <FileText size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>Votre facture d’achat n’est pas encore dans votre expédition&nbsp;: vous pouvez tout de même donner votre accord dès maintenant. Joignez-la ensuite dans «&nbsp;Mes factures&nbsp;»&nbsp;: elle nous permet d’établir votre devis.</span>
                </p>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" disabled={decisionPending} onClick={() => handleFeuVert(true)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl brand-bg px-3 py-3 text-sm font-bold text-white transition-all duration-200 ease-out hover:translate-y-[-1px] active:scale-[0.98] disabled:opacity-50"><ThumbsUp size={16} aria-hidden="true" />{decisionPending ? 'Enregistrement…' : 'Autoriser la préparation'}</button>
                <button type="button" disabled={decisionPending} onClick={() => { if (showWait) { closeWait(); return; } setWaitVersion(sel.updatedAt); setShowWait(true); }} aria-expanded={showWait} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out active:scale-[0.98]"><Clock size={16} aria-hidden="true" />Attendre d’autres achats</button>
              </div>
              {showWait && waitForm(true)}
              <details className="border-t border-slate-200 pt-2">
                <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Mesures et fonctionnement</summary>
                <div className="space-y-3">
                  <CartonMeasures colis={sel} />
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="mb-1.5 text-sm font-black uppercase tracking-wider brand-t">Comment ça marche&nbsp;?</p>
                    <ol className="list-inside list-decimal space-y-1.5 text-sm leading-relaxed text-slate-600">
                      <li>Vous donnez votre accord avec le bouton «&nbsp;Autoriser la préparation&nbsp;».</li>
                      <li>Nous regroupons et réemballons vos achats.</li>
                      <li>Vous recevez le devis final à payer.</li>
                    </ol>
                  </div>
                  {clientWaiting && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><p className="font-semibold">Votre demande d’attente</p>{sel.attenteClientMotif && <p className="mt-1">{sel.attenteClientMotif}</p>}<p className="mt-1 text-slate-600">Quand vous serez prêt(e), utilisez le bouton «&nbsp;Autoriser la préparation&nbsp;» ci-dessus.</p></div>}
                </div>
              </details>
              <button type="button" disabled={decisionPending} onClick={() => handleFeuVert(false)} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-red-700"><ThumbsDown size={16} aria-hidden="true" />Refuser la préparation</button>
            </>
          )}
          {isAutorise && (
            <>
              <div className="rounded-xl bg-emerald-50 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-emerald-800">
                  <CheckCircle size={14} aria-hidden="true" />
                  Accord donné
                </p>
                <p className="text-sm leading-relaxed text-emerald-800">
                  Vous avez autorisé la préparation de ce colis. Expedîle va le préparer pour l’expédition.
                </p>
              </div>
              {invoiceReminder && (
                <div data-testid="consent-invoice-reminder" className="space-y-2 rounded-xl border p-3" style={{ backgroundColor: 'var(--attention-bg)', borderColor: 'var(--attention-border)', color: 'var(--attention-text)' }}>
                  <p className="flex items-start gap-1.5 text-sm font-semibold"><FileText size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Il nous manque encore votre facture d’achat.</p>
                  <p className="text-sm">Elle nous permet d’établir votre devis.</p>
                  <button type="button" onClick={() => openPanel('documents')} className={PRIMARY_BUTTON}><Upload size={16} aria-hidden="true" />Joindre mes factures</button>
                </div>
              )}
              <button
                type="button"
                onClick={handleRevoke}
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-slate-600 transition-colors duration-200 ease-out hover:text-red-700"
              >
                <RotateCcw size={14} aria-hidden="true" />
                Demander l’annulation de mon accord
              </button>
            </>
          )}
          {isRefuse && (
            <div className="rounded-xl bg-red-50 p-3">
              <p className="flex items-center gap-1.5 text-sm font-bold text-red-700">
                <AlertCircle size={14} aria-hidden="true" />
                Préparation refusée
              </p>
              <p className="mt-1 text-sm leading-relaxed text-red-700">
                Vous avez refusé la préparation de cette expédition. Notre équipe vous contactera pour convenir avec vous de la suite.
              </p>
            </div>
          )}
        </div>
      );
    }

    // Phase 2 – Préparation
    if (phaseIdx === 2) {
      return (
        <div className="space-y-2">
          <p className="text-sm leading-relaxed text-slate-600">
            {curPhaseIdx === 2
              ? 'Nous regroupons et réemballons vos achats pour préparer leur envoi.'
              : 'La préparation est terminée.'}
          </p>
          {curPhaseIdx === 2 && (
            <p className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-800">
              <Wrench size={14} aria-hidden="true" />
              Vous serez prévenu(e) dès que votre devis sera prêt.
            </p>
          )}
          {sel.photoPrep && (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <SecureImage src={sel.photoPrep} alt="Photo de votre colis préparé" className="h-auto w-full" />
              <p className="flex items-center gap-1.5 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <Camera size={14} aria-hidden="true" />
                Photo de votre colis préparé par notre équipe
              </p>
            </div>
          )}
        </div>
      );
    }

    // Phase 3 – Devis & Paiement
    if (phaseIdx === 3) {
      const isPay = ['devis_envoye', 'attente_paiement'].includes(sel.statut);
      const isPaye = sel.paiementMontant != null;
      const hasDevis = hasPublishedQuote(sel);
      // A late invoice is updating the quote: no old amount, no old link.
      const updating = sel.quoteUpdatePending && !isPaye;
      const quotePro = published.client.type === 'pro';
      const payLink = Boolean(sel.payplugPaymentUrl);
      const savings = Number(price.economie) > 0 ? Number(price.economie) : 0;
      const showQuote = hasDevis && !updating;
      // The amounts saved as octroi de mer, OMR and « TVA »: an estimate of the import taxes of the destination,
      // paid on arrival and part of the price (decision of 10 October 2026); none for a professional quote.
      const taxes = importTaxEstimate({ om: price.devisOM, omr: price.devisOMR, tva: price.devisTVA }, published.destination, { professional: quotePro });

      return (
        <div className="max-w-xl space-y-3">
          {updating && (
            <div role="status" data-testid="quote-update-pending" className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-blue-800 dark:border-transparent">
              <RefreshCw size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0"><p className="text-sm font-semibold">Votre devis est en cours de mise à jour</p><p className="mt-1 text-sm">Nous avons bien reçu votre nouvelle facture. Vous recevrez le nouveau devis dès qu’il sera prêt&nbsp;: vous n’avez rien à faire d’ici là.</p></div>
            </div>
          )}
          {showQuote && <p className="flex flex-wrap items-baseline justify-between gap-2 text-base font-semibold text-slate-800"><span>{isPaye ? 'Total du devis' : 'Montant à régler'}</span><strong className="text-2xl">{eur(price.devisTotal)}</strong></p>}
          {showQuote && savings > 0 && <p data-testid="quote-savings" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Économie réalisée grâce à l’optimisation&nbsp;: {eur(savings)}</p>}
          {showQuote && isPay && !isPaye && !sel.archive && (payLink || quotePro ? (
            <button
              type="button"
              onClick={handlePayer}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-black transition-all duration-200 ease-out hover:translate-y-[-1px] active:scale-[0.98]"
              style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, boxShadow: '0 4px 16px rgba(232,184,75,0.35)', color: BRAND.navyD }}
            >
              <CreditCard size={16} aria-hidden="true" />
              {payLink ? `Payer ${eur(price.devisTotal)}` : 'Consulter les échanges de règlement'}
            </button>
          ) : (
            <div role="status" data-testid="payment-link-pending" className="space-y-1 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
              <p className="flex items-start gap-2"><Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Votre lien de paiement sécurisé arrive&nbsp;: vous serez prévenu(e) dès qu’il est prêt.</span></p>
              <button type="button" onClick={() => openPanel('messages')} className="ml-6 min-h-11 font-semibold underline">Poser une question à l’équipe</button>
            </div>
          ))}
          {showQuote && (
            <details className="overflow-hidden rounded-xl border border-slate-200">
              <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold brand-t brand-bg-l">
                Détail du devis
              </summary>
              <div className="space-y-1 p-3">
                {price.avantOptimTransport != null && price.avantOptimTransport !== price.devisTransport && (
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-slate-500 line-through">Transport brut</span>
                    <span className="text-slate-500 line-through">{eur(price.avantOptimTransport)}</span>
                  </div>
                )}
                <Ligne label="Transport optimisé" value={eur(price.devisTransport)} />
                {taxes?.lines.length > 0 && <ImportTaxLines estimate={taxes} />}
                {(price.fraisDivers || []).filter((f) => Number(f.montant) > 0).map((f, i) => <Ligne key={i} label={f.libelle || f.label || f.nom || 'Frais complémentaires'} value={eur(f.montant)} />)}
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-slate-900">Total</span>
                    <span className="text-lg font-black brand-t">{eur(price.devisTotal)}</span>
                  </div>
                </div>
                <p className="border-t border-slate-200 pt-3 text-sm text-slate-500">{published.version ? `Devis · version ${published.version}` : 'Devis historique'}{clientDate(published.issuedAt) ? ` · Établi le ${clientDate(published.issuedAt)}` : ''}</p>
              </div>
            </details>
          )}

          {showQuote && (published.paymentMode || (quotePro && !isPaye)) && <div className="border-t border-slate-200 pt-3 text-sm text-slate-600">
            {published.paymentMode && <p>Modalités convenues&nbsp;: <strong>{PAYMENT_TERMS[published.paymentMode] || published.paymentMode}</strong>.</p>}
            {quotePro && !isPaye && <p className="mt-1">{published.paymentMode === 'virement' ? 'Utilisez les coordonnées bancaires transmises par notre équipe. Si vous ne les avez pas, demandez-les dans les échanges ci-dessous.' : ['30_jours','fin_de_mois'].includes(published.paymentMode) ? 'La date exacte d’échéance est celle communiquée par notre équipe. Consultez les échanges si elle ne figure pas sur votre devis.' : published.paymentMode === 'especes' ? 'Contactez notre équipe pour convenir de la remise du règlement.' : 'Les modalités sont à confirmer avec notre équipe.'} La réception du règlement sera confirmée ici.</p>}
            {quotePro && !isPaye && <div className="mt-2 space-y-2"><p className="text-sm">Référence à communiquer pour le règlement&nbsp;: <strong className="whitespace-nowrap">{price.ref}</strong> · {eur(price.devisTotal)}.</p><button type="button" className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold" onClick={async () => { try { await navigator.clipboard.writeText(`${price.ref} · ${eur(price.devisTotal)}`); flash('Référence de règlement copiée'); } catch { flash({ msg: 'Copie indisponible. La référence reste affichée ci-dessus.', type: 'error' }); } }}>Copier la référence de règlement</button></div>}
          </div>}
          {isPaye && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3">
              <CheckCircle size={16} className="flex-shrink-0 text-emerald-700" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold text-emerald-800">Paiement confirmé</p>
                <p className="text-sm text-emerald-800">{eur(sel.paiementMontant)} reçu{clientDate(sel.paiementDate) ? ` le ${clientDate(sel.paiementDate)}` : ''}. Merci&nbsp;!</p>
              </div>
            </div>
          )}

          {showQuote && (
            <button type="button" onClick={downloadQuote} className={`${SECONDARY_BUTTON} w-full`}>
              <Download size={16} aria-hidden="true" />
              Télécharger le devis (PDF)
            </button>
          )}

          {!hasDevis && !isPaye && !updating && (
            <p className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <Clock size={14} aria-hidden="true" />
              {journey.quoteNeedsReview ? 'Votre devis est en cours de révision. Aucun règlement n’est demandé pour la version retirée.' : 'Votre devis sera disponible à la fin de la préparation\u00a0: vous serez prévenu(e) dès qu’il sera prêt.'}
            </p>
          )}
        </div>
      );
    }

    // Phase 5 – Expédition
    if (phaseIdx === 4) {
      return (
        <div className="space-y-2">
          <p className="text-sm leading-relaxed text-slate-600">
            {sel.statut === 'expedie'
              ? 'Votre colis a été remis au transporteur.'
              : sel.statut === 'transit'
              ? 'Votre colis est en route vers votre destination.'
              : 'Votre colis a voyagé jusqu’à votre destination.'}
          </p>
          {sel.statut === 'transit' && (
            <p
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${BRAND.navy}, #0E7490)` }}
            >
              <Plane size={14} aria-hidden="true" />
              En route vers {selDest?.nom || 'votre destination'} {selDest?.flag || ''}
            </p>
          )}
          {trackingOut && <p className="break-words text-sm text-slate-600">Numéro de suivi vers votre adresse&nbsp;: <strong>{trackingOut}</strong></p>}
          {manifest.trackings.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-slate-600">Suivis fournisseurs vers l’entrepôt</summary>{manifest.trackings.map(number => <a key={number} href={`https://parcelsapp.com/fr/tracking/${encodeURIComponent(number)}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-2 break-all text-sm underline"><ExternalLink size={16} aria-hidden="true" />{number}</a>)}</details>}
        </div>
      );
    }

    if (phaseIdx === 5) return <p className="text-sm text-slate-600">{sel.statut === 'dedouanement' ? 'Votre colis est en cours de dédouanement. Notre équipe suit cette étape avant sa mise à disposition au dépôt local.' : 'Formalités de douane terminées.'}</p>;
    if (phaseIdx === 6) return <p className="text-sm text-slate-600">{sel.statut === 'arrive' ? 'Votre colis est arrivé au dépôt local. Notre équipe organise la livraison et vous informera des modalités confirmées.' : 'Passage au dépôt local enregistré.'}</p>;
    // Livraison
    if (phaseIdx === 7) {
      return delivered
        ? <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle size={16} aria-hidden="true" />{clientDate(sel.dateLivraison) ? `Livraison confirmée le ${clientDate(sel.dateLivraison)}.` : 'Livraison confirmée.'}</p>
        : <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"><MapPin size={14} aria-hidden="true" />Votre colis est en cours de livraison</p>;
    }

    return null;
  };

  return (
    <div className="anim-fade space-y-4" data-testid="client-dossier-detail">
      {/* ── Compact header with back ── */}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => navigate('/colis')}
          aria-label="Retour à mes expéditions" className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-xl transition-all duration-200 ease-out hover:bg-slate-100 active:scale-[0.98] dark:hover:bg-white/10"
        >
          <ArrowLeft size={18} className="text-slate-600" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="whitespace-nowrap text-lg font-black leading-tight text-slate-900">{sel.ref}</h1>
          {sel.desc && <p ref={descRef} id="client-dossier-description" className={`mt-0.5 break-words text-sm text-slate-600 ${descOpen ? '' : 'line-clamp-2'}`}>{sel.desc}</p>}
          {sel.desc && (descClamped || descOpen) && <button type="button" aria-expanded={descOpen} aria-controls="client-dossier-description" onClick={() => setDescOpen(value => !value)} className="min-h-11 text-sm font-semibold underline brand-t">{descOpen ? 'Réduire la description' : 'Lire toute la description'}</button>}
        </div>
      </div>

      <section aria-label="État actuel et prochaine étape" className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="max-w-2xl space-y-3">
          {updateNotice && <p role="alert" data-testid="decision-update-notice" className="flex items-start gap-2 rounded-xl border p-3 text-sm" style={{ backgroundColor: 'var(--attention-bg)', borderColor: 'var(--attention-border)', color: 'var(--attention-text)' }}><RefreshCw size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{updateNotice}</span></p>}
          <div><p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Étape actuelle</p><h2 className="mt-1 text-lg font-bold text-slate-800">{journey.label}</h2></div>
          {delivered ? (
            <div data-testid="delivered-celebration" className="space-y-1.5 rounded-2xl bg-emerald-50 p-4 text-center">
              <CheckCircle size={40} className="mx-auto text-emerald-700" aria-hidden="true" />
              <p className="text-xl font-black text-emerald-800">Livré&nbsp;!</p>
              <p className="text-sm text-emerald-800">Votre colis a bien été livré{selDest?.nom ? ` à ${selDest.nom}` : ''}.</p>
              <p className="text-sm font-semibold text-emerald-800">{clientDate(sel.dateLivraison) ? `Livraison confirmée le ${clientDate(sel.dateLivraison)}.` : 'Livraison confirmée.'}</p>
            </div>
          ) : task.kind === 'none'
            ? <p className="font-semibold text-slate-700">Aucune action attendue de votre part.</p>
            : <p className="text-sm font-semibold text-slate-700">À vous · {task.action}</p>}
          {task.kind === 'none' && (journey.quoteUpdating ? phaseContent(3) : <p className="text-sm text-slate-600">{journey.next}</p>)}
          {taskExplanation && <p data-testid="client-task-explanation" className="text-sm text-slate-600">{taskExplanation}</p>}
          {task.kind === 'agreement' && phaseContent(1)}
          {showWait && waitError?.closed && !(sel.statut === 'attente_feu_vert' && !sel.archive) && waitForm(false)}
          {task.kind === 'payment' && phaseContent(3)}
          {['documents','messages'].includes(task.kind) && <button type="button" onClick={() => openPanel(task.kind)} className={`${PRIMARY_BUTTON} w-full sm:w-auto sm:px-6`}>{task.kind === 'documents' ? <Upload size={16} aria-hidden="true" /> : <MessageCircle size={16} aria-hidden="true" />}{task.action}</button>}
          {clientWaiting && (
            <div data-testid="client-waiting" className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <p>{sel.attenteClientMotif || 'Vous avez demandé à attendre avant la préparation.'}</p>
              <p className="mt-1">Votre attente est enregistrée{waitedSince ? ` depuis le ${waitedSince}` : ''}{waitReview ? ` · Réexamen prévu ${journey.reviewDue ? 'depuis le' : 'le'} ${waitReview}` : ''}.</p>
            </div>
          )}
          {departureDayShown && (
            <p data-testid="planned-departure" className="flex items-start gap-2 text-sm text-slate-700">
              <CalendarDays size={16} className="mt-0.5 shrink-0 brand-t" aria-hidden="true" />
              <span>{departureMessage.label} <strong>{departureMessage.day}</strong>. {departureMessage.note}</span>
            </p>
          )}
          {departureMessage?.kind === 'pending' && (
            <p data-testid="planned-departure" className="flex items-start gap-2 text-sm text-slate-600">
              <CalendarDays size={16} className="mt-0.5 shrink-0 brand-t" aria-hidden="true" />
              <span>{departureMessage.text}</span>
            </p>
          )}
          {departureMessage?.kind === 'loading' && <div aria-hidden="true" data-testid="planned-departure-loading" className="h-5 w-72 max-w-full animate-pulse rounded-lg bg-slate-100" />}
          {departureMessage?.kind === 'error' && (
            <p role="status" data-testid="planned-departure" className="flex flex-wrap items-center gap-x-2 text-sm text-slate-600">
              <CalendarDays size={16} className="shrink-0 brand-t" aria-hidden="true" />
              <span>{departureMessage.text}</span>
              <button type="button" onClick={() => setDepartureAttempt(value => value + 1)} className="min-h-11 font-semibold underline brand-t">Réessayer</button>
            </p>
          )}
          {shipmentStarted && <>
            {trackingOut ? <a href={`https://parcelsapp.com/fr/tracking/${encodeURIComponent(trackingOut)}`} target="_blank" rel="noopener noreferrer" className={`${SECONDARY_BUTTON} w-full sm:w-auto`}><ExternalLink size={16} aria-hidden="true" />Suivre mon colis</a>
              : sel.outgoingTrackingError ? <p role="status" data-testid="outgoing-tracking-unavailable" className="flex flex-wrap items-center gap-x-2 text-sm text-slate-600"><span>{trackingRetryFailed ? 'Le numéro de suivi transporteur est toujours indisponible. Réessayez dans un instant\u00a0: les étapes de votre expédition restent visibles ici.' : 'Le numéro de suivi transporteur n’a pas pu être chargé pour le moment. Les étapes de votre expédition restent visibles ici.'}</span><button type="button" disabled={trackingRetry} onClick={retryTracking} className="min-h-11 font-semibold underline brand-t disabled:opacity-60">{trackingRetry ? 'Nouvelle tentative…' : 'Réessayer'}</button></p>
              : <p className="text-sm text-slate-600">Le suivi transporteur vers votre adresse n’est pas encore renseigné. Les étapes de votre expédition restent visibles ici.</p>}
            {!delivered && !(sel.statut === 'expedie' && departureDayShown) && <p data-testid="latest-news" className="text-sm text-slate-600">{news && clientDate(news.date) ? `Dernière nouvelle\u00a0: ${news.label.toLocaleLowerCase('fr')} le ${clientDate(news.date)}.` : 'La date de la dernière nouvelle n’est pas encore disponible.'}{DELIVERY_DATE_PENDING.includes(sel.statut) ? ' La date de livraison vous sera précisée dès qu’elle sera confirmée.' : ''}</p>}
          </>}
          {clientWaiting && <details className="border-t border-slate-200 pt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-700">Reprendre ma décision</summary>{phaseContent(1)}</details>}
          {journey.event && !journey.event.historical && !shipmentStarted && !clientWaiting && clientDate(journey.event.date) && <p className="text-sm text-slate-500">{journey.event.label} le {clientDate(journey.event.date)}</p>}
        </div>
      </section>

      <details className="rounded-xl border border-slate-200 p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-700">Suivi et détails de l’expédition</summary><div className="space-y-4 pt-3">
        {journey.event?.historical && <p className="text-sm text-slate-500">Historique · {journey.event.label} le {clientDate(journey.event.date)}</p>}
        {sel.finalPackages?.length > 0 && <details className="rounded-xl border border-slate-200 p-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-slate-700">{previousPreparation ? 'Mesures précédentes conservées' : 'Colis préparés pour l’envoi'} · {plural(sel.finalPackages.length, 'colis', 'colis')}{!previousPreparation ? ` ${pluralWord(sel.finalPackages.length, 'sortant')}` : ''}</summary><div className="space-y-2 text-sm text-slate-600">{previousPreparation && <p>Ces mesures appartiennent à une préparation précédente.</p>}{sel.finalPackages.map((box,index) => <p key={index}>Colis {index + 1} · {measureText(box)}</p>)}</div></details>}
        {sel.statut !== 'annule' && <ProgressBar statut={sel.statut} size="md" showLabel={false} />}
        {sel.statut === 'annule' && <p className="text-sm text-slate-600">Cette expédition a été annulée. Vos documents{sel.messages?.length ? ' et vos échanges' : ''} restent consultables ici.</p>}
        {sel.statut !== 'annule' && <div className="space-y-2">{PHASES_CLIENT.map((phase, idx) => {
          const state = clientPhaseState(idx, sel.statut);
          if (state === 'future' || (idx === 1 && (task.kind === 'agreement' || clientWaiting)) || (idx === 3 && (task.kind === 'payment' || journey.quoteUpdating))) return null;
          return <PhaseStep key={phase.key} phase={phase} phaseIdx={idx} state={state} open={timeOpen === idx} onToggle={() => toggleStep(idx)}>{phaseContent(idx)}</PhaseStep>;
        })}</div>}
        {!['annule','refuse_client'].includes(sel.statut) && curPhaseIdx < PHASES_CLIENT.length - 1 && <div><p className="mb-2 text-sm font-semibold text-slate-600">Prochaines étapes</p><div className="flex flex-wrap gap-2">{PHASES_CLIENT.slice(curPhaseIdx + 1).map(phase => <span key={phase.key} className="inline-flex items-center gap-1 text-sm text-slate-600"><ChevronRight size={14} aria-hidden="true" />{phase.label}</span>)}</div></div>}
      </div></details>

      {/* Spacer so last card isn't under bottom nav */}
      <div className="h-2" />
    </div>
  );
}
