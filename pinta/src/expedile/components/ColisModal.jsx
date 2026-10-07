import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Search, UserPlus, Package, Camera, AlertTriangle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { BRAND, getDestByCP, PRODUITS_INTERDITS, ABONNEMENTS } from '../constants';
import { uid, searchClients } from '../utils';
import { Badge } from './ui';
import * as sb from '../lib/supabaseData';
import { deliverMessage } from '../services/telegramApi';
import { supabase } from '../lib/supabase';
import { renderTemplate } from '../services/messageTemplates';
import { DEFAULT_BODIES } from '../services/messageDefaults';
import { useDialog } from './ui/useDialog';
import { receptionCartons, receptionMeasurements, receptionMeasurementIssues, receptionCartonManifest, hasCompleteReceptionMeasurements, RECEPTION_MEASURES, removeReceptionCarton, RECEPTION_APPEND_STATUSES, receptionAppendBlockReason, receptionAppendImpact, receptionDossierReturn } from '../domain/reception';
import { safeWorkReturn } from '../domain/personalWork';
import { plural } from '../domain/plural';
import { usePersistentDraft } from '../hooks/usePersistentDraft';
import './reception.css';

// Below this visible height (keyboard open, landscape phone, short window),
// the sticky actions shrink to one row so the entry keeps the screen.
const SHORT_VIEW_HEIGHT = 640;
const visibleHeight = () => Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight);

/** Keep the focused entry above the sticky actions: its scroll-margin-bottom equals their height. */
function revealFocusedEntry(container) {
  const field = document.activeElement;
  if (!container || !field || !container.contains(field) || !field.matches('input, textarea, select')) return;
  if (field.closest('.reception-footer')) return;
  field.scrollIntoView({ block: 'nearest' });
}

// Drafts need the reception baseline, not invoice/message contents.
const receptionDraftDossier = dossier => {
  if (!dossier) return null;
  const { factures, lignes, messages, devisSnapshot, ...rest } = dossier;
  return { ...rest, devisSnapshot: devisSnapshot ? true : null };
};

function ReceptionInput({ label, ...props }) {
  return <label className="block min-w-0"><span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span><input {...props} /></label>;
}

function focusTrackingInput(input) {
  if (!input?.isConnected) return false;
  const details = input.closest('details');
  if (details) details.open = true;
  input.focus();
  input.scrollIntoView({ block: 'center' });
  return document.activeElement === input;
}

function CartonFields({ lines, dimensions, setTracking, setDimension, addTracking, removeTracking, inputRefs, dimensionRefs, onScan, issues = [], cartonOffset = 0 }) {
  return <div className="space-y-3">
    <p className="text-sm font-semibold text-gray-800">Cartons reçus</p>
    <p className="text-xs text-gray-600">Mesurez et pesez chaque carton reçu. Le fournisseur et le suivi sont facultatifs.</p>
    {lines.map((line, idx) => <section key={idx} aria-label={`Carton ${cartonOffset + idx + 1}`} className="rounded-xl border border-gray-200 p-3 space-y-3">
      <div className="flex justify-between items-center"><h3 className="text-sm font-bold text-gray-800">Carton {cartonOffset + idx + 1}</h3>{lines.length > 1 && <button type="button" onClick={() => removeTracking(idx)} aria-label={`Supprimer le carton ${cartonOffset + idx + 1}`} className="w-11 h-11 -my-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-700 flex items-center justify-center"><X size={16} /></button>}</div>
      <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">Numéro de suivi · carton {cartonOffset + idx + 1}<span className="font-normal"> · facultatif</span></span><input aria-label={`Numéro de suivi · carton ${cartonOffset + idx + 1}`} ref={element => { inputRefs.current[idx] = element; }} value={line.tracking} onChange={event => setTracking(idx, 'tracking', event.target.value)} onKeyDown={event => onScan(event, idx)} placeholder="Scanner ou saisir le numéro" autoComplete="off" aria-invalid={issues.some(issue => issue.index === idx && issue.key === 'tracking')} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-mono" /></label>
      <fieldset className="rounded-lg bg-gray-50 border border-gray-200 p-3">
        <legend className="px-1 text-xs font-bold text-gray-800">Mesures à réception — avant optimisation</legend>
        <div className="grid grid-cols-2 gap-3">
          {RECEPTION_MEASURES.map(({ key, label, unit }) => {
            const error = issues.find(issue => issue.index === idx && issue.key === key);
            return <label key={key} className="block min-w-0"><span className="block text-xs font-semibold text-gray-700 mb-1">{label} ({unit}) <span aria-hidden="true">*</span></span>
              <input ref={element => { dimensionRefs.current[`${idx}:${key}`] = element; }} aria-label={`${label} à réception (${unit}) · carton ${cartonOffset + idx + 1}`} aria-required="true" aria-invalid={!!error} aria-describedby={error ? `reception-${idx}-${key}-error` : undefined} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder={unit} value={dimensions[idx]?.[key] ?? ''} onChange={event => setDimension(idx, key, event.target.value)} onFocus={event => event.currentTarget.scrollIntoView({ block: 'center' })} className={`w-full min-h-11 rounded-lg border px-2.5 py-2 text-sm bg-white ${error ? 'border-red-500' : 'border-gray-300'}`} />
              {error && <span id={`reception-${idx}-${key}-error`} className="block mt-1 text-xs text-red-700">Valeur supérieure à zéro requise.</span>}
            </label>;
          })}
        </div>
      </fieldset>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-gray-600">Fournisseur{line.fournisseur ? ' · renseigné' : ' · facultatif'}</summary>      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ReceptionInput label={`Fournisseur · carton ${cartonOffset + idx + 1}`} placeholder="Amazon, Zara…" value={line.fournisseur} onChange={event => setTracking(idx, 'fournisseur', event.target.value)} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm" />

      </div>
</details>
    </section>)}
    <details><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-gray-600">Aide à la mesure et au scan</summary><p className="text-xs text-gray-600">Longueur : grand côté · Largeur : petit côté · Hauteur : du bas au haut. Mesurez l’extérieur du carton fermé. Entrée après un scan ajoute le suivant ; Tab parcourt les mesures.</p><svg viewBox="0 0 220 110" role="img" aria-label="Repères longueur, largeur et hauteur d’un carton" className="mt-2 h-28 w-full max-w-xs text-gray-600"><path d="M40 40 L120 15 L180 40 L100 65 Z M40 40 V85 L100 105 V65 M100 105 L180 80 V40" fill="none" stroke="currentColor" strokeWidth="2"/><text x="30" y="106" fontSize="10" fill="currentColor">Longueur</text><text x="144" y="101" fontSize="10" fill="currentColor">Largeur</text><text x="184" y="63" fontSize="10" fill="currentColor">Hauteur</text></svg></details>
    <button type="button" onClick={addTracking} className="w-full rounded-xl border border-dashed border-gray-300 px-3 py-2.5 text-sm font-semibold brand-t">+ Ajouter un carton</button>
  </div>;
}

const EMPTY_FORM = {
  trackingLines: [{ fournisseur: '', tracking: '' }],
  d: '',
  v: '',
  c: '',
  casier: '',
  notesReception: '',
  facUploaded: false,
  facVendeur: '',
  facMontant: '',
  facFichier: null,
  facFichierNom: '',
  // Mandatory original measurements, one entry per physical carton. Never final packing dimensions.
  multiDims: {},
  photoFile: null,
};

const EMPTY_NEW_CLIENT = {
  nom: '', prenom: '', genre: '', dateNaissance: '',
  tel: '', telFixe: '', email: '',
  ville: '', cp: '', adresseLigne1: '', adresseLigne2: '', commune: '', infosLivraison: '',
  telegramUsername: '', canal: 'telegram',
  type: 'particulier', modePaiement: 'colis',
  abonnement: 'freemium', abonnementDebut: '', abonnementFin: '',
  notes: '',
  raisonSociale: '', siret: '', interlocuteur: '',
};

// Ref provisoire locale — sera remplacée par la ref unique Supabase dans insertColis
function nextRef() {
  return 'EXP-TMP-' + Date.now().toString(36).toUpperCase();
}

export default function ColisModal({ open, onClose, initialColisId, initialClientId, fullPage = false, startAppend = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const appCtx = useApp();
  const { isStaff, authCl, clients, data, setData, flash, addNewClient } = appCtx;
  const produitsInterdits = appCtx.produitsInterdits || PRODUITS_INTERDITS;

  const [savedDraft, persistDraft, draftStorage] = usePersistentDraft(fullPage ? `reception-page:${initialColisId || initialClientId || 'new'}` : null, null);
  const [nf, setNf] = useState(() => ({ ...EMPTY_FORM, ...savedDraft?.nf, photoFile: savedDraft?.nf?.photoFile instanceof File ? savedDraft.nf.photoFile : null }));
  const [formErr, setFormErr] = useState({});
  const [clientSearchQ, setClientSearchQ] = useState(savedDraft?.clientSearchQ || '');
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(savedDraft?.selectedClient || null);

  // ── Mode: null = choix (ou auto-nouveau si pas de regroupables), 'rattacher', 'nouveau' ──
  const [mode, setMode] = useState(savedDraft?.mode || null);
  const [rattacherTarget, setRattacherTarget] = useState(() => startAppend && savedDraft?.receipt?.finished ? data.find(item => item.id === initialColisId) || savedDraft.rattacherTarget : savedDraft?.rattacherTarget || null);

  const [checkedInterdits, setCheckedInterdits] = useState(savedDraft?.checkedInterdits || []);

  // ── State ──
  const [newClientMode, setNewClientMode] = useState(savedDraft?.newClientMode || false);
  const [newClientForm, setNewClientForm] = useState(savedDraft?.newClientForm || EMPTY_NEW_CLIENT);
  const [newClientErr, setNewClientErr] = useState({});

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const trackingRefs = useRef([]);
  const dimensionRefs = useRef({});
  const [pendingMeasureFocus, setPendingMeasureFocus] = useState(null);
  const initialisedRef = useRef(Boolean(savedDraft));
  const [pendingFocus, setPendingFocus] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);
  const [receipt, setReceipt] = useState(() => startAppend && savedDraft?.receipt?.finished ? { ...savedDraft.receipt, finished: false } : savedDraft?.receipt || null);
  const [discarding, setDiscarding] = useState(false);
  const [requestId, setRequestId] = useState(() => savedDraft?.requestId || crypto.randomUUID());
  const [pendingAppend, setPendingAppend] = useState(savedDraft?.pendingAppend || null);
  const [pendingCreate, setPendingCreate] = useState(savedDraft?.pendingCreate || null);
  const [restoredPhoto, setRestoredPhoto] = useState(savedDraft?.photoName && !(savedDraft?.nf?.photoFile instanceof File) ? savedDraft.photoName : '');

  useEffect(() => {
    if (!fullPage || !open) return;
    persistDraft({ nf, clientSearchQ, selectedClient, mode, rattacherTarget: receptionDraftDossier(rattacherTarget), checkedInterdits, newClientMode, newClientForm, receipt: receipt ? { ...receipt, colis: receptionDraftDossier(receipt.colis) } : null, photoName: nf.photoFile?.name || restoredPhoto, requestId, pendingAppend, pendingCreate });
  }, [fullPage, open, nf, clientSearchQ, selectedClient, mode, rattacherTarget, checkedInterdits, newClientMode, newClientForm, receipt, restoredPhoto, requestId, pendingAppend, pendingCreate, persistDraft]);
  useEffect(() => {
    if (!open || !initialClientId || initialColisId || initialisedRef.current) return;
    const client = clients.find((item) => item.id === initialClientId);
    if (!client) return;
    initialisedRef.current = true;
    setSelectedClient(client); setClientSearchQ(client.nom);
    setMode(data.some((item) => !item.archive && item.clientId === client.id && RECEPTION_APPEND_STATUSES.includes(item.statut)) ? null : 'nouveau');
  }, [open, initialClientId, initialColisId, clients, data]);
  useEffect(() => {
    if (!open) { initialisedRef.current = false; return; }
    if (!initialColisId || initialisedRef.current) return;
    const target = data.find(colis => colis.id === initialColisId);
    const client = target && clients.find(item => item.id === target.clientId);
    if (!target || !client) return;
    initialisedRef.current = true;
    setSelectedClient(client); setClientSearchQ(client.nom); setMode('rattacher'); setRattacherTarget(target);
    setNf(previous => ({ ...previous, casier: target.casier || '' }));
  }, [open, initialColisId, data, clients]);
  useEffect(() => {
    if (!open || saving || !pendingMeasureFocus) return;
    const { index, key } = pendingMeasureFocus;
    const input = key === 'tracking' ? trackingRefs.current[index] : dimensionRefs.current[`${index}:${key}`];
    input?.focus(); input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setPendingMeasureFocus(null);
  }, [open, saving, pendingMeasureFocus]);
  useLayoutEffect(() => {
    // Focus a newly created row after its refs exist, before another scanner
    // event can race the deferred effect from the previous row.
    if (pendingFocus !== null && open && focusTrackingInput(trackingRefs.current[pendingFocus])) setPendingFocus(null);
  }, [nf.trackingLines.length, open, pendingFocus]);
  useEffect(() => {
    if (!nf.photoFile) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(nf.photoFile); setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [nf.photoFile]);
  // Validation from a previous expedition must not name its old carton numbers.
  useEffect(() => {
    setFormErr({});
    setSaveError('');
    setPendingMeasureFocus(null);
  }, [mode, rattacherTarget?.id]);
  const dialogRef=useDialog(open && !fullPage,()=>{if(!savingRef.current)resetAndClose();});
  // The sticky actions take one compact row when the visible height is short
  // (keyboard open). The visible height changes after a tap, never during it,
  // so a button under the finger does not move between press and release.
  const [shortView, setShortView] = useState(() => visibleHeight() < SHORT_VIEW_HEIGHT);
  useEffect(() => {
    if (!open || !fullPage) return undefined;
    const viewport = window.visualViewport;
    const onResize = () => { setShortView(visibleHeight() < SHORT_VIEW_HEIGHT); revealFocusedEntry(dialogRef.current); };
    setShortView(visibleHeight() < SHORT_VIEW_HEIGHT);
    window.addEventListener('resize', onResize);
    viewport?.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); viewport?.removeEventListener('resize', onResize); };
  }, [open, fullPage, dialogRef]);
  // Entries scroll clear of the actions: --reception-footer-height feeds their scroll-margin-bottom.
  const footerObserverRef = useRef(null);
  const footerRef = useCallback(node => {
    const previous = footerObserverRef.current;
    previous?.observer.disconnect();
    previous?.region.style.removeProperty('--reception-footer-height');
    footerObserverRef.current = null;
    const region = node?.parentElement;
    if (!region || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      region.style.setProperty('--reception-footer-height', `${Math.ceil(node.getBoundingClientRect().height)}px`);
      revealFocusedEntry(region);
    });
    observer.observe(node);
    footerObserverRef.current = { observer, region };
  }, []);
  const runSave = async action => {
    if(savingRef.current)return;
    if (isStaff && !appCtx.can('perm_colis_receptionner')) { setSaveError('Vous n’avez pas le droit d’enregistrer une réception. Contactez un responsable.'); return; }
    if (restoredPhoto) { setSaveError('Choisissez de nouveau la photo ou cliquez sur « Continuer sans photo » avant d’enregistrer.'); return; }
    savingRef.current=true;setSaving(true);setSaveError('');
    try {await action();} catch(error) {setSaveError(error.message);flash({msg:error.message,type:'error'});}
    finally {savingRef.current=false;setSaving(false);}
  };
  if (!open) return null;

  // ── helpers ──────────────────────────────────────────────
  const setField = (key, val) => { if (key === 'photoFile') setRestoredPhoto(''); setNf((prev) => ({ ...prev, [key]: val })); };

  const setTracking = (idx, field, val) => {
    setNf((prev) => {
      const trackingLines = prev.trackingLines.map((line, i) =>
        i === idx ? { ...line, [field]: val } : line
      );
      return { ...prev, trackingLines };
    });
  };

  const addTracking = () => {
    setPendingFocus(nf.trackingLines.length);
    setNf((prev) => ({ ...prev, trackingLines: [...prev.trackingLines, { fournisseur: '', tracking: '' }] }));
  };

  const removeTracking = (idx) => {
    setNf((prev) => removeReceptionCarton(prev, idx));
    setFormErr(prev => ({ ...prev, measurements: undefined, dimensions: undefined }));
  };
  const onScan = (event, idx) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!nf.trackingLines[idx].tracking.trim()) return;
    if (nf.trackingLines[idx + 1]) {
      if (focusTrackingInput(trackingRefs.current[idx + 1])) setPendingFocus(null);
      else setPendingFocus(idx + 1);
    }
    else addTracking();
  };
  const setDimension = (index, key, value) => {
    setNf(prev => ({ ...prev, multiDims: { ...prev.multiDims, [index]: { ...prev.multiDims[index], [key]: value } } }));
    setFormErr(prev => ({ ...prev, measurements: (prev.measurements || []).filter(issue => issue.index !== index || issue.key !== key), dimensions: undefined }));
  };
  // Continue the selected expedition's physical carton numbering, independent of tracking coverage.
  const cartonOffset = mode === 'rattacher' && rattacherTarget ? receptionCartonManifest(rattacherTarget).nbColis : 0;
  const cartonFields = <CartonFields cartonOffset={cartonOffset} lines={nf.trackingLines} dimensions={nf.multiDims} setDimension={setDimension} setTracking={setTracking} addTracking={addTracking} removeTracking={removeTracking} inputRefs={trackingRefs} dimensionRefs={dimensionRefs} onScan={onScan} issues={formErr.measurements} />;

  const resetAndClose = () => {
    setNf(EMPTY_FORM);
    setSaveError('');
    setPendingFocus(null);
    setPendingMeasureFocus(null);
    setFormErr({});
    setClientSearchQ('');
    setClientSearchOpen(false);
    setSelectedClient(null);
    setMode(null);
    setRattacherTarget(null);
    setNewClientMode(false);
    setNewClientForm(EMPTY_NEW_CLIENT);
    setNewClientErr({});
    setCheckedInterdits([]);
    setReceipt(null);
    setRestoredPhoto('');
    setDiscarding(false);
    setRequestId(crypto.randomUUID());
    setPendingAppend(null);
    setPendingCreate(null);
    if (!fullPage) onClose();
  };

  const openReceivedDossier = (colis, index) => {
    const current = new URLSearchParams(location.search);
    const returnTo = fullPage ? receptionDossierReturn(current.get('returnTo')) : location.pathname.startsWith('/colis/')
      ? safeWorkReturn(current.get('returnTo'), '/colis')
      : location.pathname + location.search;
    const query = new URLSearchParams({ returnTo, section: hasCompleteReceptionMeasurements(colis) ? 'accord' : 'reception' });
    navigate(`/colis/${encodeURIComponent(colis.id)}?${query}`, {
      state: { receivedCarton: { colisId: colis.id, index } },
    });
  };

  const confirmReceipt = (colis, firstIndex, count, action, client = selectedClient) => {
    const nextForm = { ...EMPTY_FORM, casier: colis.casier || '' };
    const nextRequestId = crypto.randomUUID();
    const nextReceipt = { colis, first: firstIndex + 1, last: firstIndex + count, count, finished: action === 'finish' };
    // Persist success even if the operator left this screen while the request completed.
    if (fullPage) persistDraft({ nf: nextForm, clientSearchQ: client?.nom || '', selectedClient: client, mode: 'rattacher', rattacherTarget: receptionDraftDossier(colis), checkedInterdits: [], newClientMode: false, newClientForm: EMPTY_NEW_CLIENT, receipt: { ...nextReceipt, colis: receptionDraftDossier(colis) }, photoName: '', requestId: nextRequestId, pendingAppend: null, pendingCreate: null });
    setRequestId(nextRequestId);
    setPendingAppend(null);
    setPendingCreate(null);
    setRattacherTarget(colis);
    setMode('rattacher');
    setNf(nextForm);
    setCheckedInterdits([]);
    setFormErr({});
    setRestoredPhoto('');
    setReceipt(nextReceipt);
    if (action !== 'finish') setPendingMeasureFocus({ index: 0, key: 'dimL' });
    else window.scrollTo({ top: 0 });
  };

  // ── client search ─────────────────────────────────────────
  const filteredClients = clientSearchQ.trim()
    ? searchClients(clients, clientSearchQ)
    : clients.slice(0, 8);

  const STATUTS_REGROUPABLES = RECEPTION_APPEND_STATUSES;

  const regroupables = selectedClient
    ? data.filter((c) => !c.archive && c.clientId === selectedClient.id && STATUTS_REGROUPABLES.includes(c.statut))
    : [];

  const handleSelectClient = (cl) => {
    setSelectedClient(cl);
    setReceipt(null);
    setClientSearchQ(cl.nom);
    setClientSearchOpen(false);
    setNewClientMode(false);
    setFormErr((prev) => ({ ...prev, client: undefined }));
    // Reset mode — will show choice if regroupables, else auto-nouveau
    setMode(null);
    setRattacherTarget(null);
    // Check regroupables for this client immediately
    const hasRegroupables = data.some(
      (c) => !c.archive && c.clientId === cl.id && STATUTS_REGROUPABLES.includes(c.statut)
    );
    if (!hasRegroupables) {
      setMode('nouveau');
    }
  };

  // ── New client inline ─────────────────────────────────────
  const setNCField = (key, val) => setNewClientForm((prev) => ({ ...prev, [key]: val }));

  const validateNewClient = () => {
    const errs = {};
    if (!newClientForm.nom.trim() || newClientForm.nom.trim().length < 2) errs.nom = 'Nom requis (min. 2 car.)';
    if (!newClientForm.cp.trim() || !/^9[7-8]\d{3}$/.test(newClientForm.cp.replace(/\s/g, ''))) errs.cp = 'Code postal DOM-TOM requis (97xxx)';
    if (newClientForm.tel && !/^\+?\d[\d\s\-]{6,18}$/.test(newClientForm.tel.replace(/\s/g, ''))) errs.tel = 'Numéro invalide';
    if (newClientForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newClientForm.email.trim())) errs.contact = 'Adresse email invalide';
    if (!newClientForm.email.trim() && !newClientForm.telegramUsername.trim()) errs.contact = 'Email ou Telegram requis (au moins un moyen de contact)';
    if (newClientForm.type === 'pro' && !newClientForm.raisonSociale.trim()) errs.raisonSociale = 'Raison sociale requise pour un pro';
    setNewClientErr(errs);
    return Object.keys(errs).length === 0;
  };

  // ── validation ────────────────────────────────────────────
  const validate = (rattacher = false) => {
    const errs = {};
    if (isStaff) {
      if (!selectedClient && !newClientMode) errs.client = 'Sélectionnez un client';
      if (!receptionCartons(nf.trackingLines, nf.multiDims).length) { const first = { index: 0, key: 'dimL' }; errs.dimensions = `Carton ${cartonOffset + 1} : renseignez la longueur à réception, puis les trois autres mesures.`; errs.measurements = [first]; setPendingMeasureFocus(first); }
      if (!rattacher && !nf.casier.trim()) errs.casier = 'Numéro de casier requis';
      const measurements = receptionMeasurementIssues(nf.trackingLines, nf.multiDims, cartonOffset);
      if (measurements.length) {
        errs.measurements = measurements;
        errs.dimensions = measurements[0].message;
        setPendingMeasureFocus(measurements[0]);
      }
    } else {
      if (!nf.d.trim()) errs.d = 'Description requise';
    }
    const numbers=nf.trackingLines.map(l=>l.tracking.trim()).filter(Boolean);
    const duplicates=numbers.find((number,index)=>numbers.indexOf(number)!==index);
    if(duplicates)errs.d=`Numéro saisi plusieurs fois : ${duplicates}`;
    const existing=data.find(c=>!c.archive&&!['livre','annule'].includes(c.statut)&&(c.trackings||[]).some(number=>numbers.includes(number)));
    if(existing)errs.d=`Ce numéro est déjà rattaché au dossier ${existing.ref}. Ouvrez ce dossier pour compléter la réception.`;
    setFormErr(errs);
    return Object.keys(errs).length === 0;
  };

  // ── submit: rattacher à un EXP existant ──────────────
  const handleRattacher = async (action = 'finish') => {
    if (!rattacherTarget) return;
    if (fullPage && action === 'finish' && receipt && !receptionCartons(nf.trackingLines, nf.multiDims).length && !nf.notesReception.trim() && !nf.photoFile && nf.casier === (receipt.colis.casier || '')) { setReceipt({ ...receipt, finished: true }); window.scrollTo({ top: 0 }); return; }
    if (!pendingAppend && !validate(true)) return;
    const lines = nf.trackingLines || [{ fournisseur: '', tracking: '' }];
    const newCartons = receptionCartons(lines, nf.multiDims);
    const newTrackings = newCartons.filter(l=>l.tracking.trim());

    if (newCartons.length === 0 && !nf.casier.trim()) {
      setFormErr({ tracking: 'Saisissez au moins un tracking ou un casier' });
      return;
    }

    const numbers = newTrackings.map((line) => line.tracking.trim());
    const duplicate = numbers.find((number, index) => numbers.indexOf(number) !== index);
    const other = data.find((colis) => !colis.archive && !['livre', 'annule'].includes(colis.statut) && (colis.trackings || []).some((number) => numbers.includes(number)));
    if (!pendingAppend && (duplicate || other)) { setFormErr({ tracking: duplicate ? `Numéro saisi plusieurs fois : ${duplicate}` : `Numéro déjà présent dans ${other.ref}. Vérifiez le carton avant rattachement.` }); return; }

    const existing = rattacherTarget;
    const blocked = receptionAppendBlockReason(existing);
    if (!pendingAppend && blocked) throw new Error(blocked);
    const intent = pendingAppend || { dossierId: existing.id, action, firstIndex: receptionCartonManifest(existing).nbColis,
      cartons: newCartons.map(carton => ({ ...nf.multiDims[carton.index], fournisseur: carton.fournisseur, tracking: carton.tracking })),
      options: { requestId, expectedUpdatedAt: existing.updatedAt, casier: nf.casier.trim() || undefined, notesReception: nf.notesReception.trim() || undefined, checkInterdits: checkedInterdits } };
    setPendingAppend(intent);
    if (fullPage) persistDraft(previous => ({ ...previous, pendingAppend: intent, requestId }));
    let result;
    try { result = await sb.appendReceptionCartons(intent.dossierId, intent.cartons, intent.options); }
    catch (error) {
      // A SQL rejection confirms no write. A lost response remains uncertain and must be replayed.
      if (error.code && (/^[0-9]{5}$/.test(error.code) || /^P(?:000|GRST)/.test(error.code))) {
        setPendingAppend(null);
        if (fullPage) persistDraft(previous => ({ ...previous, pendingAppend: null }));
      }
      throw error;
    }
    const saved = { ...existing, ...result, factures: existing.factures, lignes: existing.lignes, messages: existing.messages };
    setData(previous => previous.map(item => item.id === existing.id ? { ...item, ...result } : item));
    flash(`${plural(newCartons.length, 'carton rattaché', 'cartons rattachés')} à ${existing.ref} — ${plural(saved.nbColis, 'carton')} au total`);
    if (fullPage) { confirmReceipt(saved, intent.firstIndex, intent.cartons.length, intent.action); return; }
    resetAndClose();
    // Reception is saved first; the colleague decides when to send the combined request.
    if (isStaff) openReceivedDossier(saved, receptionCartonManifest(existing).nbColis);
    else {
      const sameDetail = location.pathname === `/colis/${existing.id}`;
      const query = new URLSearchParams(/^\/colis\/?$/.test(location.pathname) ? location.search : '');
      query.set('dossier', existing.id);
      navigate(sameDetail ? { pathname: location.pathname, search: location.search } : { pathname: '/colis', search: `?${query}` }, {
        state: { receivedCarton: { colisId: existing.id, index: receptionCartonManifest(existing).nbColis } },
      });
    }
  };

  // ── submit: staff new colis (reception) ──────────────
  const handleReceptionner = async (sendTG, action = 'finish') => {
    const sendNotification = !isStaff && sendTG;
    // If in new client mode, create client first
    let clientId;
    let cl;
    if (pendingCreate) {
      clientId = pendingCreate.client.id;
      cl = pendingCreate.client;
    } else if (newClientMode) {
      if (!appCtx.can('perm_clients_creer')) throw new Error('Votre accès ne permet pas de créer un client. Sélectionnez une fiche existante.');
      if (!validateNewClient()) return;
      if (!validate()) return;
      clientId = await addNewClient({
        nom: newClientForm.nom.trim(),
        prenom: newClientForm.prenom.trim(),
        genre: newClientForm.genre || '',
        dateNaissance: newClientForm.dateNaissance || null,
        ville: newClientForm.ville.trim(),
        cp: newClientForm.cp.trim(),
        adresseLigne1: newClientForm.adresseLigne1.trim(),
        adresseLigne2: newClientForm.adresseLigne2.trim(),
        commune: newClientForm.commune.trim(),
        infosLivraison: newClientForm.infosLivraison.trim(),
        tel: newClientForm.tel.trim(),
        telFixe: newClientForm.telFixe.trim(),
        email: newClientForm.email.trim(),
        telegramUsername: newClientForm.telegramUsername.trim(),
        canal: newClientForm.telegramUsername.trim() ? 'telegram' : (newClientForm.email.trim() ? 'email' : 'telegram'),
        type: newClientForm.type,
        modePaiement: newClientForm.modePaiement,
        abonnement: newClientForm.abonnement,
        abonnementDebut: newClientForm.abonnementDebut || null,
        abonnementFin: newClientForm.abonnementFin || null,
        raisonSociale: newClientForm.raisonSociale.trim(),
        siret: newClientForm.siret.trim(),
        interlocuteur: newClientForm.interlocuteur.trim(),
        notes: newClientForm.notes.trim(),
        created: new Date().toISOString().slice(0, 10),
        points: 0,
      });
      cl = { ...newClientForm, id: clientId, nom: newClientForm.nom.trim(), tel: newClientForm.tel.trim() };
      setSelectedClient(cl); setNewClientMode(false); setClientSearchQ(cl.nom);
    } else {
      if (!validate()) return;
      clientId = selectedClient.id;
      cl = selectedClient;
    }

    const colisTemplate = pendingCreate?.template || buildColis(clientId, 'receptionne');

    const intent = pendingCreate || { template: colisTemplate, client: cl, action, createId: requestId };
    if (fullPage) {
      setPendingCreate(intent);
      persistDraft(previous => ({ ...previous, pendingCreate: intent, requestId }));
    }
    let newColis = colisTemplate;
    try {
      const inserted = await sb.insertColis({
        clientId,
        desc: colisTemplate.desc,
        trackings: colisTemplate.trackings,
        trackingsDetail: colisTemplate.trackingsDetail,
        casier: colisTemplate.casier,
        dateReception: colisTemplate.dateReception,
        valeur: colisTemplate.valeur,
        notesReception: colisTemplate.notesReception,
        dimL: colisTemplate.dimL,
        dimW: colisTemplate.dimW,
        dimH: colisTemplate.dimH,
        poids: colisTemplate.poids,
        nbColis: colisTemplate.nbColis,
        dimsParColis: colisTemplate.dimsParColis,
        statut: colisTemplate.statut,
        checkInterdits: colisTemplate.checkInterdits,
        produitInterdit: colisTemplate.produitInterdit,
      }, fullPage ? { createId: intent.createId } : undefined);
      newColis = { ...colisTemplate, ...inserted };
    } catch (err) {
      if (err.code && (/^[0-9]{5}$/.test(err.code) || /^P(?:000|GRST)/.test(err.code))) {
        setPendingCreate(null);
        if (fullPage) persistDraft(previous => ({ ...previous, pendingCreate: null }));
      }
      throw new Error(`Réception non enregistrée : ${err.message}`);
    }
    setData((prev) => prev.some(item => item.id === newColis.id) ? prev.map(item => item.id === newColis.id ? { ...item, ...newColis } : item) : [...prev, newColis]);

    if (nf.photoFile) {
      try {
        const uploaded = await sb.uploadDocument('photos-colis',newColis.id,nf.photoFile);
        await sb.updateColis(newColis.id,{photoReception:true,photoReceptionUrl:uploaded.path});
      } catch(error) { flash({msg:`Colis enregistré, photo à ajouter : ${error.message}`,type:'warning'}); }
    }
    if (sendNotification && cl && !cl.telegramChatId && !cl.userId) {
      flash({ msg: `Expédition ${newColis.ref} enregistrée. Accès client à activer : ouvrez sa fiche pour l’inviter ou préparez un email.`, type: 'warning', duration: 12000 });
    } else if (sendNotification && cl) {
      try {
        const {data:queued,error}=await supabase.rpc('queue_message',{
          p_colis_id:newColis.id,p_text:renderTemplate(appCtx.messageTemplates.reception_telegram || DEFAULT_BODIES.reception_telegram,{client:cl,colis:newColis,destination:getDestByCP(cl.cp),settings:appCtx.settings}),
          p_template:'reception',p_idempotency_key:`receipt:${newColis.id}`,
          p_canal:cl.telegramChatId?'telegram':'portal',
        });
        if(error)throw error;
        if(cl.telegramChatId){
          const result=await deliverMessage(newColis.id,queued.message?.id || queued.message_id);
          if(!result.ok)throw new Error(result.error);
        }
        flash(`Colis ${newColis.ref} enregistré — notification ${cl.telegramChatId?'Telegram envoyée':'disponible dans l’espace client'}`);
      }catch(error){flash({msg:`Colis ${newColis.ref} enregistré. Notification à réessayer : ${error.message}`,type:'warning'});}
    }else flash(`Colis ${newColis.ref} réceptionné — casier ${nf.casier.trim()}`);

    const newId = newColis.id;
    if (fullPage) { confirmReceipt(newColis, 0, colisTemplate.nbColis, intent.action, cl); return; }
    resetAndClose();
    if (isStaff && newId) {
      openReceivedDossier(newColis, 0);
    }
  };

  // ── build colis object ────────────────────────────────────
  const buildColis = (clientId, statut) => {
    const ref = nextRef();
    const cartons = receptionCartons(nf.trackingLines, nf.multiDims);
    const trackings = cartons.map((t) => t.tracking).filter(Boolean);
    const trackingsDetail = cartons.map((t) => ({ number: t.tracking, fournisseur: t.fournisseur }));
    const factures =
      !isStaff && nf.facUploaded && nf.facVendeur.trim()
        ? [
            {
              id: 'f_' + uid(),
              vendeur: nf.facVendeur.trim(),
              montant: parseFloat(nf.facMontant) || 0,
              valide: false,
              fichier: nf.facFichier || null,
              fichierNom: nf.facFichierNom || null,
            },
          ]
        : [];

    const measurements = isStaff ? receptionMeasurements(nf.trackingLines, nf.multiDims) : null;
    const hasDims = Boolean(measurements);
    const { dimL = null, dimW = null, dimH = null, poids = null, dimsParColis = [] } = measurements || {};

    const finalStatut = hasDims ? 'mesure' : statut;

    return {
      id: 'p_' + uid(),
      clientId,
      ref,
      statut: finalStatut,
      trackings,
      trackingsDetail,
      nbColis: Math.max(1, cartons.length),
      desc: nf.d.trim() || [...new Set(nf.trackingLines.map((l) => l.fournisseur.trim()).filter(Boolean))].join(' + ') || 'Carton reçu',
      notesReception: nf.notesReception.trim() || null,
      valeur: null,
      dimL,
      dimW,
      dimH,
      poids,
      dimsParColis,
      finL: null,
      finW: null,
      finH: null,
      finP: null,
      estMin: null,
      estMax: null,
      feuVert: null,
      devisTransport: null,
      devisOM: null,
      devisOMR: null,
      devisTVA: null,
      devisTotal: null,
      paiementMontant: null,
      factures,
      lignes: [],
      messages: [],
      envoi: null,
      casier: isStaff ? nf.casier.trim() : null,
      dateReception: isStaff ? new Date().toISOString() : null,
      checkInterdits: checkedInterdits,
      produitInterdit: checkedInterdits.length > 0,
      photoReception: !!nf.photoFile,
    };
  };

  // ── shared field styles ───────────────────────────────────
  const inputCls = (err) =>
    `w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors ${
      err
        ? 'border-red-400 bg-red-50 focus:border-red-500'
        : 'border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white'
    }`;

  const labelCls = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1';

  const notificationAccessible = !!(selectedClient?.telegramChatId || selectedClient?.userId);

  // A draft is what the operator typed or chose here: neither the client or
  // expedition the page was opened for, nor the expedition just saved.
  const openedFor = receipt ? { clientId: receipt.colis.clientId, colisId: receipt.colis.id }
    : { clientId: initialClientId || data.find(item => item.id === initialColisId)?.clientId || null, colisId: initialColisId || null };
  const enteredValues = nf.trackingLines.length > 1
    || nf.trackingLines.some(line => line.tracking.trim() || line.fournisseur.trim())
    || Object.values(nf.multiDims || {}).some(box => Object.values(box || {}).some(value => String(value ?? '').trim() !== ''))
    || nf.casier.trim() !== (mode === 'rattacher' ? rattacherTarget?.casier || '' : '').trim()
    || Boolean(nf.notesReception.trim() || nf.photoFile || restoredPhoto || checkedInterdits.length || newClientMode);
  const choiceChanged = selectedClient
    ? selectedClient.id !== openedFor.clientId || (mode !== null && (rattacherTarget?.id || null) !== openedFor.colisId)
    : Boolean(clientSearchQ.trim());
  const hasDraft = enteredValues || choiceChanged || Boolean(pendingAppend || pendingCreate);
  const measuredCartons = nf.trackingLines.filter((line, index) => receptionMeasurements([line], { 0: nf.multiDims[index] })).length;
  const compactFooter = fullPage && shortView;

  // ─────────────────────────────────────────────────────────
  // References and lockers are matched against the physical parcel: never split inside them.
  const receiptSummary = receipt && <>{receipt.count === 1 ? `Carton ${receipt.first} enregistré` : `Cartons ${receipt.first} à ${receipt.last} enregistrés`} · <span className="reception-token">{receipt.colis.ref}</span> · <span className="reception-token">Casier {receipt.colis.casier || 'à renseigner'}</span></>;
  if (fullPage && receipt?.finished) return <section aria-label="Réception terminée" className="mx-auto max-w-3xl p-4 sm:p-8 space-y-6">
    <h1 className="text-2xl font-black text-gray-900">Réception enregistrée</h1>
    <div role="status" className="rounded-2xl border border-green-300 bg-green-50 p-5 space-y-2">
      <p className="text-lg font-bold text-green-800">{receiptSummary}</p>
      <p className="text-sm text-gray-700">{selectedClient?.nom} · {plural(receptionCartonManifest(receipt.colis).nbColis, 'carton reçu', 'cartons reçus')} dans cette expédition.</p>
      <p className="text-sm text-gray-700">Aucun message envoyé au client.</p>
    </div>
    <button type="button" className="w-full min-h-12 rounded-xl px-4 py-3 font-bold text-white" style={{ background: BRAND.navy }} onClick={() => openReceivedDossier(receipt.colis, receipt.first - 1)}>Ouvrir le dossier {receipt.colis.ref}</button>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="min-h-11 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-700" onClick={() => { setReceipt({ ...receipt, finished: false }); setPendingMeasureFocus({ index: 0, key: 'dimL' }); }}>Ajouter un carton à cette expédition</button>
      <button type="button" className="min-h-11 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-700" onClick={resetAndClose}>Réceptionner pour un autre client</button>
      <button type="button" className="min-h-11 px-4 text-sm font-semibold text-gray-700 underline" onClick={onClose}>Retour à ma liste</button>
    </div>
  </section>;

  const content = (
    <div
      className={fullPage ? "mx-auto w-full max-w-4xl px-4 py-5 sm:px-6" : "fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-0 sm:px-4"}
      style={fullPage ? undefined : { backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => {
        if (!fullPage && e.target === e.currentTarget && !saving) resetAndClose();
      }}
    >
      <div ref={dialogRef} role={fullPage ? "region" : "dialog"} aria-modal={fullPage ? undefined : "true"} aria-label="Réceptionner des cartons" tabIndex={-1} onFocus={fullPage ? event => revealFocusedEntry(event.currentTarget) : undefined} className={fullPage ? "bg-white w-full rounded-2xl border border-gray-200 flex flex-col" : "bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90dvh]"}>
        {/* ── Header ── */}
        <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            {fullPage ? <><h1 className="text-2xl font-black text-gray-900">Réceptionner des cartons</h1><p className="mt-1 text-sm text-gray-600">Choisissez le client, mesurez le carton, enregistrez.</p></> : <h2 className="text-lg font-black text-gray-900">Réceptionner des cartons</h2>}
          </div>
          <button
            onClick={fullPage ? onClose : resetAndClose}
            disabled={saving} className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
            aria-label={fullPage ? "Retour à ma liste, conserver le brouillon" : "Fermer"}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className={fullPage ? "reception-body px-4 sm:px-6 py-5 space-y-5" : "flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4"}>
          {fullPage && receipt && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-3 text-sm font-semibold text-green-800">{receiptSummary}. Vous pouvez saisir le carton suivant.</p>}
          {fullPage && restoredPhoto && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">La photo « {restoredPhoto} » doit être choisie à nouveau après le rechargement. Les autres saisies sont conservées.<button type="button" onClick={() => setRestoredPhoto('')} className="ml-2 underline">Continuer sans photo</button></p>}
          {fullPage && !draftStorage.storageAvailable && <p role="status" className="text-sm text-amber-800">Le navigateur bloque le stockage du brouillon. Gardez cet onglet ouvert jusqu’à l’enregistrement.</p>}
          {fullPage && (pendingAppend || pendingCreate) && !saving && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800"><p>L’enregistrement doit être vérifié avant de modifier ces cartons. Votre saisie est conservée.</p><button type="button" className="min-h-11 font-bold underline" onClick={() => runSave(() => pendingAppend ? handleRattacher(pendingAppend.action) : handleReceptionner(false, pendingCreate.action))}>Vérifier l’enregistrement</button></div>}
          <fieldset disabled={saving || Boolean(pendingAppend || pendingCreate)} className="min-w-0 space-y-4">
          {/* ── CLIENT (staff only) ── */}
          {isStaff && !newClientMode && (
            <div>
              <label htmlFor="reception-client" className={labelCls}>Client</label>
              <div>
                <div className="relative">
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                  />
                  <input
                    type="text"
                    id="reception-client" aria-invalid={!!formErr.client} placeholder="Rechercher un client…"
                    value={clientSearchQ}
                    onChange={(e) => {
                      setClientSearchQ(e.target.value);
                      setReceipt(null);
                      setRattacherTarget(null);
                      setSelectedClient(null);
                      setMode(null);
                      setClientSearchOpen(true);
                    }}
                    onFocus={() => { if (!selectedClient) setClientSearchOpen(true); }}
                    className={`w-full rounded-xl border pl-9 pr-3 py-2.5 text-sm outline-none transition-colors ${
                      formErr.client
                        ? 'border-red-400 bg-red-50 focus:border-red-500'
                        : selectedClient
                        ? 'border-green-400 bg-green-50'
                        : 'border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white'
                    }`}
                    autoComplete="off"
                  />
                </div>

                {/* Client list — inline (not absolute dropdown) */}
                {clientSearchOpen && !selectedClient && (
                  <div className="mt-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden max-h-52 overflow-y-auto">
                    {filteredClients.length === 0 && clientSearchQ.trim() ? (
                      <div className="px-4 py-3 text-center">
                        <p className="text-sm text-gray-400 mb-2">Aucun client trouvé</p>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setNewClientMode(true); setMode('nouveau');
                            setNewClientForm((prev) => ({ ...prev, nom: clientSearchQ.trim() }));
                            setClientSearchOpen(false);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white transition-all active:scale-95"
                          style={{ background: BRAND.navy }}
                        >
                          <UserPlus size={13} />
                          Créer « {clientSearchQ.trim()} »
                        </button>
                      </div>
                    ) : (
                      <>
                        {filteredClients.map((cl) => {
                          const dest = getDestByCP(cl.cp);
                          return (
                            <button
                              key={cl.id}
                              type="button"
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 text-left transition-colors"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleSelectClient(cl)}
                            >
                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-xs font-black text-white">
                                {cl.nom.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-gray-900 truncate">
                                  {cl.nom}
                                </div>
                                <div className="text-xs text-gray-500 flex items-center gap-1 truncate">
                                  <span>{dest.flag}</span>
                                  <span>{dest.label}</span>
                                  <span className="opacity-40">·</span>
                                  <span>{cl.ville}</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                        {/* Create new client option at bottom */}
                        <div className="border-t border-gray-100">
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setNewClientMode(true); setMode('nouveau');
                              setNewClientForm((prev) => ({ ...prev, nom: clientSearchQ.trim() }));
                              setClientSearchOpen(false);
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-emerald-50 text-left transition-colors"
                          >
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                              <UserPlus size={14} className="text-emerald-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-emerald-700">
                                Nouveau client
                              </div>
                              <div className="text-xs text-gray-400">
                                Créer une fiche client rapidement
                              </div>
                            </div>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              {formErr.client && (
                <p className="mt-1 text-xs text-red-500">{formErr.client}</p>
              )}

              {/* ── CHOIX : RATTACHER OU NOUVEAU ── */}
              {selectedClient && !mode && regroupables.length > 0 && (
                  <div className="mt-2 space-y-3">
                    <div
                      className="rounded-xl border p-3 space-y-3"
                      style={{ borderColor: BRAND.gold + '60', background: BRAND.gold + '08' }}
                    >
                      <div className="flex items-center gap-2">
                        <Package size={14} className="shrink-0" style={{ color: 'var(--text-accent)' }} />
                        <span className="text-xs font-bold" style={{ color: 'var(--text-accent)' }}>
                          Ce client a {plural(regroupables.length, 'expédition ouverte', 'expéditions ouvertes')}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">
                        Ce carton fait partie d’une expédition existante ?
                      </p>
                      <div className="space-y-2">
                        {regroupables.map((c) => (
                          // Reference, locker and status wrap as whole words; under 640 px « Ajouter ici » goes below.
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setMode('rattacher'); setRattacherTarget(c); setReceipt(null); setNf(previous => ({ ...previous, casier: c.casier || '' })); }}
                            className="reception-choice w-full flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3 p-3 rounded-xl border text-left transition-all duration-200 ease-out active:scale-[0.98]"
                          >
                            <span className="block flex-1 min-w-0">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="reception-token font-black text-sm" style={{ color: 'var(--brand-text)' }}>{c.ref}</span>
                                {c.casier && (
                                  <span className="reception-token text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: `${BRAND.gold}22`, color: 'var(--text-accent)' }}>
                                    {c.casier}
                                  </span>
                                )}
                                <span className="reception-token inline-flex"><Badge statut={c.statut} /></span>
                              </span>
                              <span className="block text-xs text-gray-500 truncate mt-1">{c.desc}</span>
                              <span className="block text-xs text-gray-500 mt-0.5">
                                {plural(receptionCartonManifest(c).nbColis, 'carton déjà rattaché', 'cartons déjà rattachés')}
                              </span>
                            </span>
                            <span className="reception-choice-action reception-token block text-center text-xs font-bold px-3 py-2 rounded-lg sm:py-1.5" style={{ background: BRAND.navy, color: 'white' }}>
                              Ajouter ici
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="relative flex items-center gap-3">
                      <div className="flex-1 border-t border-gray-200" />
                      <span className="text-[10px] font-bold text-gray-400 uppercase">ou</span>
                      <div className="flex-1 border-t border-gray-200" />
                    </div>

                    <button
                      type="button"
                      onClick={() => setMode('nouveau')}
                      className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-sm font-bold text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-all active:scale-[0.98]"
                    >
                      Créer une nouvelle expédition (nouveau EXP)
                    </button>
                  </div>
              )}
            </div>
          )}

          {/* ── INLINE NEW CLIENT FORM (complet) ── */}
          {isStaff && newClientMode && (
            <div
              className="rounded-xl border p-4 space-y-4"
              style={{ borderColor: '#10B981', background: 'var(--bg-surface)' }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <UserPlus size={15} className="text-emerald-600" />
                  <span className="text-sm font-bold text-emerald-800">Nouveau client</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewClientMode(false);
                    setNewClientForm(EMPTY_NEW_CLIENT);
                    setNewClientErr({});
                    setMode(null);
                  }}
                  className="text-xs font-semibold text-gray-400 hover:text-gray-600"
                >
                  Annuler
                </button>
              </div>

              {/* ── Type client + Forfait ── */}
              <div className="flex gap-2 flex-wrap">
                <div className="flex rounded-lg overflow-hidden border border-gray-200">
                  {[{ v: 'particulier', l: 'Particulier' }, { v: 'pro', l: 'Professionnel' }].map((t) => (
                    <button
                      key={t.v} type="button"
                      onClick={() => setNCField('type', t.v)}
                      className={`px-3 py-1.5 text-xs font-bold transition-colors ${newClientForm.type === t.v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    >
                      {t.l}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Abonnement" value={newClientForm.abonnement}
                  onChange={(e) => setNCField('abonnement', e.target.value)}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold bg-white"
                >
                  {Object.entries(ABONNEMENTS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label} {v.prix > 0 ? `(${v.prix}€/${v.periode})` : ''}</option>
                  ))}
                </select>
                {newClientForm.abonnement !== 'freemium' && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-500">Début :</span>
                      <ReceptionInput label="Début d’abonnement"
                        type="date"
                        value={newClientForm.abonnementDebut}
                        onChange={(e) => setNCField('abonnementDebut', e.target.value)}
                        className="px-2 py-1 rounded-lg border border-gray-200 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-500">Fin :</span>
                      <ReceptionInput label="Fin d’abonnement"
                        type="date"
                        value={newClientForm.abonnementFin}
                        onChange={(e) => setNCField('abonnementFin', e.target.value)}
                        className="px-2 py-1 rounded-lg border border-gray-200 text-xs"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* ── Champs Pro (conditionnels) ── */}
              {newClientForm.type === 'pro' && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Entreprise</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <ReceptionInput label="Raison sociale *"
                        type="text"
                        placeholder="Raison sociale *"
                        value={newClientForm.raisonSociale}
                        onChange={(e) => setNCField('raisonSociale', e.target.value)}
                        className={inputCls(newClientErr.raisonSociale)}
                      />
                      {newClientErr.raisonSociale && <p className="mt-0.5 text-[10px] text-red-500">{newClientErr.raisonSociale}</p>}
                    </div>
                    <ReceptionInput label="SIRET"
                      type="text"
                      placeholder="SIRET"
                      value={newClientForm.siret}
                      onChange={(e) => setNCField('siret', e.target.value)}
                      className={inputCls(false)}
                      style={{ fontFamily: 'monospace' }}
                    />
                  </div>
                  <ReceptionInput label="Interlocuteur"
                    type="text"
                    placeholder="Interlocuteur"
                    value={newClientForm.interlocuteur}
                    onChange={(e) => setNCField('interlocuteur', e.target.value)}
                    className={inputCls(false)}
                  />
                  <div>
                    <label className="text-[10px] text-gray-500 font-semibold mb-0.5 block">Mode de paiement</label>
                    <select
                      aria-label="Mode de paiement" value={newClientForm.modePaiement}
                      onChange={(e) => setNCField('modePaiement', e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs bg-white"
                    >
                      <option value="colis">Paiement par colis</option>
                      <option value="virement">Virement</option>
                      <option value="30j">Paiement à 30 jours</option>
                      <option value="fin_mois">Fin de mois</option>
                    </select>
                  </div>
                </div>
              )}

              {/* ── Identité ── */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Identité</p>
                {newClientForm.type === 'particulier' && (
                  <div className="flex gap-3">
                    {['Homme', 'Femme'].map((g) => (
                      <label key={g} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio" name="nc-genre"
                          checked={newClientForm.genre === g}
                          onChange={() => setNCField('genre', g)}
                          className="accent-emerald-500"
                        />
                        <span className="text-xs text-gray-600">{g}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className={`grid gap-2 ${newClientForm.type === 'particulier' ? 'grid-cols-2' : 'grid-cols-2'}`}>
                  <div>
                    <ReceptionInput label="Nom *"
                      type="text"
                      placeholder={newClientForm.type === 'pro' ? 'Nom contact *' : 'Nom *'}
                      value={newClientForm.nom}
                      onChange={(e) => setNCField('nom', e.target.value)}
                      className={inputCls(newClientErr.nom)}
                    />
                    {newClientErr.nom && <p className="mt-0.5 text-[10px] text-red-500">{newClientErr.nom}</p>}
                  </div>
                  <ReceptionInput label="Prénom"
                    type="text"
                    placeholder="Prénom"
                    value={newClientForm.prenom}
                    onChange={(e) => setNCField('prenom', e.target.value)}
                    className={inputCls(false)}
                  />
                  {newClientForm.type === 'particulier' && (
                    <ReceptionInput label="Date de naissance"
                      type="date"
                      title="Date de naissance"
                      placeholder="Date naissance"
                      value={newClientForm.dateNaissance}
                      onChange={(e) => setNCField('dateNaissance', e.target.value)}
                      className={inputCls(false)}
                    />
                  )}
                </div>
              </div>

              {/* ── Contact ── */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Contact</p>
                {newClientErr.contact && <p className="text-[10px] text-red-500 font-bold bg-red-50 border border-red-200 rounded-lg px-2 py-1">{newClientErr.contact}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <ReceptionInput label="Téléphone mobile"
                      type="tel"
                      placeholder="Tél. mobile *"
                      value={newClientForm.tel}
                      onChange={(e) => setNCField('tel', e.target.value)}
                      className={inputCls(newClientErr.tel)}
                      style={{ fontFamily: 'monospace' }}
                    />
                    {newClientErr.tel && <p className="mt-0.5 text-[10px] text-red-500">{newClientErr.tel}</p>}
                  </div>
                  <ReceptionInput label="Téléphone fixe"
                    type="tel"
                    placeholder="Tél. fixe"
                    value={newClientForm.telFixe}
                    onChange={(e) => setNCField('telFixe', e.target.value)}
                    className={inputCls(false)}
                    style={{ fontFamily: 'monospace' }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <ReceptionInput label="Email"
                    type="email"
                    placeholder="Email *"
                    value={newClientForm.email}
                    onChange={(e) => setNCField('email', e.target.value)}
                    className={inputCls(false)}
                  />
                  <ReceptionInput label="Identifiant Telegram"
                    type="text"
                    placeholder="Telegram @username"
                    value={newClientForm.telegramUsername}
                    onChange={(e) => setNCField('telegramUsername', e.target.value)}
                    className={inputCls(false)}
                  />
                </div>
              </div>

              {/* ── Adresse livraison ── */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Adresse de livraison</p>
                <ReceptionInput label="Adresse"
                  type="text"
                  placeholder="Adresse ligne 1 *"
                  value={newClientForm.adresseLigne1}
                  onChange={(e) => setNCField('adresseLigne1', e.target.value)}
                  className={inputCls(false)}
                />
                <ReceptionInput label="Complément d’adresse"
                  type="text"
                  placeholder="Adresse ligne 2 (complément)"
                  value={newClientForm.adresseLigne2}
                  onChange={(e) => setNCField('adresseLigne2', e.target.value)}
                  className={inputCls(false)}
                />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <ReceptionInput label="Code postal *"
                      type="text"
                      placeholder="Code postal *"
                      value={newClientForm.cp}
                      onChange={(e) => setNCField('cp', e.target.value)}
                      className={inputCls(newClientErr.cp)}
                      style={{ fontFamily: 'monospace' }}
                    />
                    {newClientErr.cp && <p className="mt-0.5 text-[10px] text-red-500">{newClientErr.cp}</p>}
                  </div>
                  <ReceptionInput label="Ville"
                    type="text"
                    placeholder="Ville"
                    value={newClientForm.ville}
                    onChange={(e) => setNCField('ville', e.target.value)}
                    className={inputCls(false)}
                  />
                  <ReceptionInput label="Commune"
                    type="text"
                    placeholder="Commune"
                    value={newClientForm.commune}
                    onChange={(e) => setNCField('commune', e.target.value)}
                    className={inputCls(false)}
                  />
                </div>
                <textarea
                  aria-label="Informations de livraison" placeholder="Infos livraison (digicode, étage, horaires...)"
                  value={newClientForm.infosLivraison}
                  onChange={(e) => setNCField('infosLivraison', e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white resize-none"
                />
              </div>

              {/* ── Notes ── */}
              <textarea
                aria-label="Notes internes" placeholder="Notes internes (optionnel)"
                value={newClientForm.notes}
                onChange={(e) => setNCField('notes', e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white resize-none"
              />
            </div>
          )}

          {/* ── RATTACHER MODE: formulaire simplifié ── */}
          {mode === 'rattacher' && rattacherTarget && (
            <>
              <div className="rounded-xl border p-3" style={{ borderColor: BRAND.navy + '30', background: BRAND.navy + '06' }}>
                <div className="flex items-center gap-2 mb-1">
                  <Package size={14} className="shrink-0" style={{ color: 'var(--brand-text)' }} />
                  <span className="text-xs font-bold" style={{ color: 'var(--brand-text)' }}>
                    Ajouter un carton à <span className="reception-token">{rattacherTarget.ref}</span>
                  </span>
                  <button type="button" onClick={() => { setMode(null); setRattacherTarget(null); }} className="ml-auto shrink-0 whitespace-nowrap min-h-11 px-3 text-sm text-gray-600 hover:text-gray-800">
                    Changer
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">{rattacherTarget.desc} · {plural(receptionCartonManifest(rattacherTarget).nbColis, 'carton déjà reçu', 'cartons déjà reçus')} · <span className="reception-token">Casier {rattacherTarget.casier || '—'}</span></p>
              </div>

              {receptionAppendBlockReason(rattacherTarget) ? <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3"><p className="text-sm font-semibold text-amber-800">{receptionAppendBlockReason(rattacherTarget)}</p><button type="button" className="min-h-11 underline font-semibold text-sm" onClick={() => navigate(`/colis/${rattacherTarget.id}?${new URLSearchParams({ section: 'devis', returnTo: location.pathname + location.search })}`)}>Ouvrir le dossier pour le corriger</button></div> : receptionAppendImpact(rattacherTarget) && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{receptionAppendImpact(rattacherTarget)}</p>}
              {cartonFields}
              <p className="text-xs text-gray-600">{plural(receptionCartonManifest(rattacherTarget).nbColis, 'carton déjà reçu', 'cartons déjà reçus')} : {receptionCartonManifest(rattacherTarget).nbColis < 2 ? 'ses mesures sont conservées' : 'leurs mesures sont conservées'}. {!hasCompleteReceptionMeasurements(rattacherTarget) && 'Certaines mesures anciennes restent à compléter dans le dossier avant de demander un accord.'}</p>

              {/* Casier optionnel (si on veut changer) */}
              <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-gray-700">Casier {nf.casier || rattacherTarget.casier || "à renseigner"} · Modifier</summary>
                <label htmlFor="reception-casier-existing" className={labelCls}>Casier (laisser vide pour garder {rattacherTarget.casier || 'l’actuel'})</label>
                <input
                  type="text"
                  id="reception-casier-existing" placeholder={rattacherTarget.casier || 'ex. A-03'}
                  value={nf.casier}
                  onChange={(e) => setField('casier', e.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white"
                />
              </details>

              {formErr.d && <p role="alert" className="text-sm font-semibold text-red-700">{formErr.d}</p>}
              {formErr.tracking && <p role="alert" className="text-xs text-red-500">{formErr.tracking}</p>}
            </>
          )}

          {/* ── NOUVEAU MODE: formulaire complet ── */}
          {mode === 'nouveau' && (
            <>
              {/* ── CASIER (staff only, MANDATORY — first field for speed) ── */}
              {isStaff && (
                <div>
                  <label htmlFor="reception-casier" className={labelCls}>
                    Casier <span className="text-red-400 ml-0.5">*</span>
                  </label>
                  <input
                    type="text"
                    id="reception-casier" aria-invalid={!!formErr.casier} placeholder="ex. A-03"
                    value={nf.casier}
                    onChange={(e) => {
                      setField('casier', e.target.value);
                      if (formErr.casier) setFormErr((prev) => ({ ...prev, casier: undefined }));
                    }}
                    className={inputCls(formErr.casier)}
                    autoFocus={isStaff && !!selectedClient}
                  />
                  {formErr.casier && (
                    <p className="mt-1 text-xs text-red-500">{formErr.casier}</p>
                  )}
                </div>
              )}

              {cartonFields}
              {formErr.d && <p role="alert" className="text-sm font-semibold text-red-700">{formErr.d}</p>}
              {checkedInterdits.length > 0 && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">Incident à vérifier : {checkedInterdits.join(", ")}. La préparation reste bloquée tant que le dossier n’est pas régularisé.</p>}
              <details className="rounded-xl border border-gray-200 p-3">
                <summary className="min-h-11 flex items-center cursor-pointer text-sm font-semibold text-gray-700">Compléments de réception{checkedInterdits.length > 0 ? ` · ${plural(checkedInterdits.length, 'alerte')}` : nf.notesReception || nf.photoFile ? ' · renseignés' : ' · observations, contrôles, photo'}</summary>
                <div className="space-y-4 pt-3">
              {/* ── NOTES DE RECEPTION (staff) ── */}
              {isStaff && (
                <div>
                  <label htmlFor="reception-notes" className={labelCls}>
                    Notes de réception
                    <span className="ml-1 normal-case text-gray-400 font-normal">(facultatif)</span>
                  </label>
                  <textarea
                    id="reception-notes" placeholder="ex. carton abîmé, scotch arraché, colis ouvert…"
                    value={nf.notesReception}
                    onChange={(e) => setField('notesReception', e.target.value)}
                    rows={2}
                    className="w-full rounded-xl border-2 border-amber-300 bg-amber-50 focus:border-amber-400 focus:bg-white px-3 py-2.5 text-sm outline-none transition-colors"
                  />
                </div>
              )}

              {/* ── CONTROLE PRODUITS INTERDITS (staff) ── */}
              {isStaff && (
                <div>
                  <label className={labelCls}>Contrôle produits interdits</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {produitsInterdits.map((item) => {
                      const checked = checkedInterdits.includes(item);
                      return (
                        <button
                          key={item}
                          aria-pressed={checked}
                          type="button"
                          onClick={() => setCheckedInterdits(prev =>
                            checked ? prev.filter(i => i !== item) : [...prev, item]
                          )}
                          className={`min-h-11 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all duration-200 ease-out active:scale-[0.98] ${
                            checked ? 'bg-red-100 text-red-700 ring-2 ring-red-400' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {checked && <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />}{item}
                        </button>
                      );
                    })}
                  </div>
                  {checkedInterdits.length > 0 && (
                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200">
                      <p className="flex items-center gap-1.5 text-xs font-bold text-red-700"><AlertTriangle size={14} aria-hidden="true" className="shrink-0" />Attention : {plural(checkedInterdits.length, 'produit interdit détecté', 'produits interdits détectés')}</p>
                      <p className="text-[10px] text-red-600 mt-0.5">Ce colis ne pourra peut-être pas être expédié par voie aérienne.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── PHOTO DE RECEPTION (staff, optional) ── */}
              {isStaff && (
                <div>
                  <label className={labelCls}>
                    Photo de réception
                    <span className="ml-1 normal-case text-gray-400 font-normal">(facultatif)</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="min-h-11 flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed focus-within:ring-2 focus-within:ring-blue-600 border-gray-300 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors">
                      <Camera size={16} className="text-gray-400" />
                      <span className="text-xs font-semibold text-gray-500">
                        Prendre une photo
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setField('photoFile', file);
                        }}
                      />
                    </label>
                    <label className="flex min-h-11 items-center rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-600 focus-within:ring-2 focus-within:ring-blue-600">{nf.photoFile ? "Remplacer la photo" : "Choisir une photo"}<input aria-label="Choisir une photo de réception" type="file" accept="image/*" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if(file) setField("photoFile", file); }} /></label>
                    {nf.photoFile && (
                      <button
                        type="button"
                        onClick={() => setField('photoFile', null)}
                        className="min-h-11 px-3 text-sm text-red-700"
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                  {nf.photoFile && (
                    <img
                      src={photoPreview}
                      alt="Photo réception"
                      className="mt-2 rounded-xl max-h-32 object-cover"
                    />
                  )}
                </div>
              )}

                </div>
              </details>

              {/* ── FACTURE (client only) ── */}
              {!isStaff && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <FileText size={15} className="text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">Facture d'origine</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Joindre la facture permet de calculer les taxes (Octroi de Mer) plus rapidement.
                      </p>
                    </div>
                  </div>

                  {/* Toggle uploaded */}
                  <label className="flex items-center gap-2 cursor-pointer mb-3">
                    <input
                      type="checkbox"
                      checked={nf.facUploaded}
                      onChange={(e) => setField('facUploaded', e.target.checked)}
                      className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                    />
                    <span className="text-sm text-gray-700">J'ai une facture à transmettre</span>
                  </label>

                  {nf.facUploaded && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className={labelCls}>Vendeur / Boutique</label>
                        <input
                          type="text"
                          placeholder="Ex: Amazon, Fnac, Nike…"
                          value={nf.facVendeur}
                          onChange={(e) => setField('facVendeur', e.target.value)}
                          className={inputCls(false)}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Montant de la facture (€)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Ex: 89.99"
                          value={nf.facMontant}
                          onChange={(e) => setField('facMontant', e.target.value)}
                          className={inputCls(false)}
                        />
                      </div>
                      {/* File upload */}
                      <div>
                        <label className={labelCls}>Photo / PDF de la facture</label>
                        {nf.facFichier ? (
                          <div className="flex items-center gap-2 p-2 rounded-xl bg-green-50 border border-green-200">
                            <img src={nf.facFichier} alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-200" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-green-800 truncate">{nf.facFichierNom}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setField('facFichier', null); setField('facFichierNom', ''); }}
                              className="text-red-400 hover:text-red-600 p-1"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <label className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 font-medium cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
                            <FileText size={16} />
                            Choisir un fichier
                            <input
                              type="file"
                              accept="image/*,.pdf"
                              className="sr-only"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => {
                                  setField('facFichier', reader.result);
                                  setField('facFichierNom', file.name);
                                };
                                reader.readAsDataURL(file);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          </fieldset>
        </div>

        {/* ── Footer / Actions ── */}
        {mode && (
          <div ref={fullPage ? footerRef : undefined} data-compact={compactFooter ? 'true' : undefined} className={fullPage ? `reception-footer sticky bottom-0 z-10 shrink-0 px-4 sm:px-6 border-t border-gray-200 bg-white rounded-b-2xl ${compactFooter ? 'pt-2' : 'pt-4'}` : "shrink-0 px-5 py-3 border-t border-gray-200 bg-white"} style={{ paddingBottom: compactFooter ? 'max(8px, env(safe-area-inset-bottom))' : 'max(12px, env(safe-area-inset-bottom))' }}>
            {/* Short visible height: the summary stays for screen readers, the actions keep one row. */}
            <div className={compactFooter ? 'sr-only' : 'mb-3 text-xs text-gray-600'} aria-live="polite">
              <p className="font-bold text-sm text-gray-800">{selectedClient?.nom || newClientForm.nom || authCl?.nom} · {mode === 'rattacher' ? <span className="reception-token">{rattacherTarget?.ref}</span> : 'Nouveau dossier'}</p>
              <p>{measuredCartons} / {plural(nf.trackingLines.length, 'carton mesuré', 'cartons mesurés')} à réception · <span className="reception-token">Casier {nf.casier || rattacherTarget?.casier || 'à renseigner'}</span></p>
              {isStaff ? <p>{fullPage ? "Aucun message envoyé au client lors de l’enregistrement." : "Enregistrez la réception, puis préparez la demande d’accord et de factures. Le message sera envoyé à votre confirmation."}</p> : mode === 'nouveau' && <p>{notificationAccessible ? `Notification proposée : ${selectedClient?.telegramChatId ? 'Telegram' : 'message dans l’espace client'}` : 'Accès client à activer : une action de contact sera créée pour l’équipe.'}</p>}
              {checkedInterdits.length > 0 && <p className="text-red-700 font-bold">{plural(checkedInterdits.length, 'produit interdit signalé', 'produits interdits signalés')}</p>}
            </div>
            {formErr.dimensions && <p role="alert" className={`${compactFooter ? 'mb-2' : 'mb-3'} text-sm font-semibold text-red-700`}>{formErr.dimensions}</p>}
            {saveError && <div role="alert" className={`${compactFooter ? 'mb-2' : 'mb-3'} text-sm font-semibold text-red-700`}><p>{saveError}</p>{fullPage && rattacherTarget && !pendingAppend && !pendingCreate && <button type="button" disabled={saving} className="min-h-11 underline" onClick={async () => { try { const updated = await appCtx.refreshColis(rattacherTarget.id); if (updated) { setRattacherTarget(updated); setSaveError('Le dossier est actualisé. Vos nouvelles mesures sont conservées : vérifiez le numéro du carton avant d’enregistrer.'); } } catch (error) { setSaveError(error.message); } }}>Actualiser le dossier sans perdre ma saisie</button>}</div>}
            {fullPage ? <div className={compactFooter ? 'grid grid-cols-2 gap-2' : 'grid gap-2 sm:grid-cols-2'}>
              <button type="button" disabled={saving || Boolean(pendingAppend || pendingCreate)} onClick={() => runSave(() => mode === 'rattacher' ? handleRattacher('continue') : handleReceptionner(false, 'continue'))} className={`${compactFooter ? 'min-h-11 px-2 py-1.5 leading-tight' : 'min-h-12 px-4 py-3'} rounded-xl text-sm font-bold text-white transition-all duration-200 ease-out hover:-translate-y-px active:scale-[0.98] disabled:opacity-60`} style={{ background: BRAND.navy }}>{saving ? 'Enregistrement…' : 'Enregistrer et ajouter un carton'}</button>
              <button type="button" disabled={saving || Boolean(pendingAppend || pendingCreate)} onClick={() => runSave(() => mode === 'rattacher' ? handleRattacher('finish') : handleReceptionner(false, 'finish'))} className={`${compactFooter ? 'min-h-11 px-2 py-1.5 leading-tight' : 'min-h-12 px-4 py-3'} rounded-xl border border-gray-300 text-sm font-bold text-gray-800 transition-all duration-200 ease-out active:scale-[0.98] disabled:opacity-60`}>Terminer la réception</button>
            </div> : <div className="flex flex-wrap sm:flex-nowrap gap-3">
              <button
                type="button"
                disabled={saving} onClick={mode === 'rattacher' ? () => { setMode(null); setRattacherTarget(null); } : resetAndClose}
                className="min-h-11 flex-1 sm:flex-none px-4 py-2.5 rounded-xl font-semibold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
              >
                {mode === 'rattacher' ? 'Retour' : 'Annuler'}
              </button>

              {mode === 'rattacher' ? (
                <button
                  type="button"
                  disabled={saving} onClick={() => runSave(handleRattacher)}
                  className="min-h-11 flex-1 py-2.5 rounded-xl font-bold text-sm text-white active:scale-95 transition-all"
                  style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
                >
                  Enregistrer {nf.trackingLines.length > 1 ? "les cartons" : "le carton"} dans {rattacherTarget?.ref}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={saving} onClick={() => runSave(() => handleReceptionner(!isStaff))}
                    className="order-first w-full sm:order-none sm:w-auto sm:flex-1 py-2.5 rounded-xl font-bold text-sm text-white active:scale-95 transition-all"
                    style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
                  >
                    {saving ? 'Enregistrement…' : isStaff || !notificationAccessible ? 'Réceptionner les cartons' : 'Réceptionner et notifier le client'}
                  </button>
                  {!isStaff && notificationAccessible && <button
                    type="button"
                    disabled={saving} onClick={() => runSave(() => handleReceptionner(false))}
                    className="min-h-11 flex-1 sm:flex-none px-4 py-2.5 rounded-xl font-semibold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
                  >
                    Sans notification
                  </button>}
                </>
              )}
            </div>}
          </div>
        )}
        {/* Shown once the operator has typed or chosen something here. */}
        {fullPage && (hasDraft || discarding) && <div className="px-5 py-3 text-sm text-gray-600 border-t border-gray-100">
          {discarding ? <div className="flex flex-wrap gap-3 items-center"><span>Effacer les saisies non enregistrées ?</span><button type="button" disabled={saving || Boolean(pendingAppend || pendingCreate)} className="min-h-11 px-3 font-bold text-red-700 underline" onClick={resetAndClose}>Oui, effacer le brouillon</button><button type="button" className="min-h-11 px-3 underline" onClick={() => setDiscarding(false)}>Garder la saisie</button></div> : <div className="flex flex-wrap items-center justify-between gap-2"><span>Brouillon conservé dans cet onglet.</span><button type="button" disabled={saving || Boolean(pendingAppend || pendingCreate)} className="min-h-11 px-3 underline" onClick={() => setDiscarding(true)}>Effacer le brouillon</button></div>}
        </div>}
      </div>
    </div>
  );
  return fullPage ? content : createPortal(content, document.body);
}
