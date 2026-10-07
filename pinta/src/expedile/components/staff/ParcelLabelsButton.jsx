import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Printer } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { hasCurrentPreparation } from '../../domain/preparationReadiness';
import { legacySingleParcel } from '../../domain/loadingControl';
import { plural, pluralWord } from '../../domain/plural';

// The outgoing parcel labels (utils/exportParcelLabels.js): one 100 × 150 mm page per
// parcel of a prepared dossier, with its QR code and its Code 128 barcode.
//
// The label module (jsPDF, qrcode) loads as soon as a label button shows. Once it is in
// memory, a click builds the PDF and opens it in the same gesture, as iPad Safari requires.
// A click that comes before opens the window first, then fills it.
let labelsModule = null;
let labelsLoading = null;
function loadLabels() {
  if (labelsModule) return Promise.resolve(labelsModule);
  if (!labelsLoading) {
    labelsLoading = import('../../utils/exportParcelLabels').then(
      module => { labelsModule = module; return module; },
      // The next click asks again, but a browser such as Chrome keeps a failed module import
      // until the page is reloaded: the message says so (failureMessage).
      error => { labelsLoading = null; throw error; },
    );
  }
  return labelsLoading;
}

/** The window the click opens while the module loads; it receives the PDF (null when refused). */
function openWaitingWindow() {
  const target = window.open('', '_blank');
  if (target && target.document && target.document.body) {
    target.document.title = 'Étiquettes Expedîle';
    target.document.body.textContent = 'Préparation des étiquettes…';
  }
  return target;
}

// Chrome and Firefox: « …dynamically imported module… »; Safari: « Importing a module script failed. »
const LOAD_FAILURE = /dynamically imported module|Importing a module script failed|Failed to fetch/i;
/** The failure as the person reads it; the technical detail goes to the console for the support. */
function failureMessage(error) {
  if (LOAD_FAILURE.test(String(error?.message))) return 'Les étiquettes n’ont pas pu être chargées. Vérifiez la connexion puis rechargez la page pour réessayer.';
  console.error('[Expedîle] Étiquettes non préparées', error);
  return 'Les étiquettes n’ont pas pu être préparées. Réessayez ; si l’échec se répète, signalez-le avec la référence du dossier.';
}

/** What the click produced, in one sentence: never « imprimé », only opened or downloaded. */
function outcomeText(result) {
  if (!result || !result.count) return '';
  const labels = plural(result.count, 'étiquette');
  if (result.method === 'download') return `${labels} ${pluralWord(result.count, 'téléchargée')} (${result.filename}). Ouvrez le fichier pour ${result.count > 1 ? 'les imprimer' : 'l’imprimer'} sur étiquettes 100 × 150 mm.`;
  return `${labels} ${pluralWord(result.count, 'ouverte')} dans un nouvel onglet${result.dossiers > 1 ? ` pour ${plural(result.dossiers, 'dossier')}` : ''}. Imprimez sur étiquettes 100 × 150 mm.`;
}

/**
 * `print(dossiers)` builds and opens their labels; `state.phase` is idle, preparing (module
 * loading), done (`state.result`: count, method, skipped lines) or error (`state.message`).
 */
export function useParcelLabels() {
  const { getClient } = useApp();
  const [state, setState] = useState({ phase: 'idle' });
  const busy = useRef(false);
  const mounted = useRef(true);
  // Each print and each reset gets a number: an outcome only shows if nothing came after it.
  const attempt = useRef(0);
  useEffect(() => {
    mounted.current = true;
    loadLabels().then(null, () => { /* loaded again, and reported, by the click */ });
    return () => { mounted.current = false; };
  }, []);
  const settle = useCallback((id, next) => { if (mounted.current && id === attempt.current) setState(next); }, []);
  const print = useCallback(dossiers => {
    if (busy.current) return;
    const id = ++attempt.current;
    if (labelsModule) {
      try { settle(id, { phase: 'done', result: labelsModule.printParcelLabels(dossiers, { getClient }) }); }
      catch (error) { settle(id, { phase: 'error', message: failureMessage(error) }); }
      return;
    }
    busy.current = true;
    const target = openWaitingWindow();
    settle(id, { phase: 'preparing' });
    loadLabels()
      .then(module => settle(id, { phase: 'done', result: module.printParcelLabels(dossiers, { getClient, target }) }))
      .catch(error => {
        if (target && !target.closed) target.close();
        settle(id, { phase: 'error', message: failureMessage(error) });
      })
      .finally(() => { busy.current = false; });
  }, [getClient, settle]);
  // A print under way keeps its outcome: the window it opened belongs to it.
  const reset = useCallback(() => { if (busy.current) return; attempt.current += 1; if (mounted.current) setState({ phase: 'idle' }); }, []);
  return { state, print, reset };
}

/**
 * « Imprimer les étiquettes (N colis) » for one dossier: shown once its optimisation is
 * saved (current preparation), or for its one parcel when it was measured before the
 * parcels were listed (legacySingleParcel), to the people allowed to print labels.
 */
export default function ParcelLabelsButton({ dossier }) {
  const { can } = useApp();
  if (!dossier || !can('perm_envois_etiquettes') || !(hasCurrentPreparation(dossier) || legacySingleParcel(dossier))) return null;
  return <DossierParcelLabels dossier={dossier} />;
}

function DossierParcelLabels({ dossier }) {
  const { can } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, print } = useParcelLabels();
  const hint = useId();
  // A legacy measure (no parcel list, no outgoing count) is one parcel.
  const count = legacySingleParcel(dossier) ? 1 : Number(dossier.outgoingParcelCount) || (Array.isArray(dossier.finalPackages) ? dossier.finalPackages.length : 1);
  const preparing = state.phase === 'preparing';
  const result = state.phase === 'done' ? state.result : null;
  const skipped = result && !result.count ? result.skipped[0] : null;
  // Completing the record needs the right to change it, as for the dossier's « Compléter la fiche ».
  const completeClient = skipped?.reason === 'address' && skipped.complete && skipped.clientId && can('perm_clients_voir') && can('perm_clients_modifier')
    ? () => navigate(`/clients/${encodeURIComponent(skipped.clientId)}?${new URLSearchParams({ completer: skipped.complete, returnTo: location.pathname + location.search })}`)
    : null;
  return <div data-testid="parcel-labels" className="space-y-2">
    <button type="button" onClick={() => print([dossier])} disabled={preparing} aria-describedby={hint}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-px active:translate-y-px disabled:opacity-50 sm:w-auto">
      {preparing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Printer size={16} aria-hidden="true" />}
      {`Imprimer les étiquettes (${count} colis)`}
    </button>
    <p id={hint} className="text-xs text-slate-600">Une étiquette 100 × 150 mm par colis, avec son QR code et son code-barres pour le contrôle du chargement.</p>
    <p role="status" className={preparing || result?.count ? 'text-sm text-slate-700' : 'sr-only'}>{preparing ? 'Préparation des étiquettes…' : outcomeText(result)}</p>
    {state.phase === 'error' && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{state.message}</span></p>}
    {skipped && <div role="alert" className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Aucune étiquette. {result.lines.join(' ')}</span></p>
      {completeClient && <button type="button" className="min-h-11 font-semibold underline" onClick={completeClient}>Compléter la fiche client</button>}
    </div>}
  </div>;
}

/**
 * The « Étiquettes » action of the /colis selection bar: the labels of the selected
 * dossiers that are prepared, and the list of those left out, with their reason.
 */
export function SelectionParcelLabels({ dossiers }) {
  const { state, print, reset } = useParcelLabels();
  const selection = dossiers.map(dossier => dossier.id).join(',');
  // A new selection forgets the outcome of the previous one.
  useEffect(() => { reset(); }, [selection, reset]);
  const preparing = state.phase === 'preparing';
  const result = state.phase === 'done' ? state.result : null;
  const outcome = preparing ? 'Préparation des étiquettes…' : [outcomeText(result), ...(result?.count ? result.lines : [])].filter(Boolean).join(' ');
  const label = dossiers.length === 1 ? 'Étiquettes du dossier sélectionné' : `Étiquettes des ${plural(dossiers.length, 'dossier')} sélectionnés`;
  // The outcome takes its own line at the end of the bar, under the buttons.
  const line = { order: 1, flexBasis: '100%', maxWidth: 'none' };
  return <>
    <button type="button" className="dossier-bulk-button" disabled={preparing || !dossiers.length} onClick={() => print(dossiers)} aria-label={label} title={label}>
      Étiquettes
    </button>
    <p role="status" className={outcome ? 'dossier-bulk-note' : 'sr-only'} style={outcome ? line : undefined}>{outcome && <Printer size={16} aria-hidden="true" />}<span>{outcome}</span></p>
    {state.phase === 'error' && <p role="alert" className="dossier-bulk-note" style={line}><AlertTriangle size={16} aria-hidden="true" /><span>{state.message}</span></p>}
    {result && !result.count && <p role="alert" className="dossier-bulk-note" style={line}><AlertTriangle size={16} aria-hidden="true" /><span>Aucune étiquette à imprimer. {result.lines.join(' ')}</span></p>}
  </>;
}
