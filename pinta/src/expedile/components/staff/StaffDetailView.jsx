import { useNavigate, useLocation } from 'react-router-dom';
import React, { useState, useEffect, useRef } from 'react';
import {
  Ruler, Check, Clock, AlertTriangle, Eye, X, RotateCcw, Send, Plus, Archive,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, TRANSITIONS, TAGS_PREPARATION, getDestByCP } from '../../constants';
import { eur } from '../../utils';
import { Ligne } from '../ui';
import WebcamCapture from '../ui/WebcamCapture';
import DossierDocumentsTask from './DossierDocumentsTask';
import ReceivedCartons from '../detail/ReceivedCartons';
import ColisModal from '../ColisModal';
import { receptionCartonManifest, receptionMeasurements } from '../../domain/reception';
import { currentInvoices } from '../../domain/invoiceDocuments';
import { needsQuoteRecalculation } from '../../domain/clientJourney';
import { calculateQuote, measureShipment, volumetricDivisor, quoteInputFingerprint } from '../../domain/quote';
import { dossierTaskUrl, resolveDossierTask } from '../../domain/dossierTasks';
import TaskContinuation from '../workspace/TaskContinuation';
import { staffName } from '../workspace/WorkActionRow';
import TaskMessage from './TaskMessage';

const preparationDrafts = new Map();
const savedFinalPackages = (colis) => colis?.finalPackages?.length ? colis.finalPackages.map(box => ({ ...box })) : [{ dimL: colis?.finL ?? '', dimW: colis?.finW ?? '', dimH: colis?.finH ?? '', poids: colis?.finP ?? '' }];

// ── Status border color helper ───────────────────────────────────────────────
function statusBorderColor(statut) {
  const map = {
    receptionne: '#F59E0B',
    mesure: '#EAB308',
    attente_feu_vert: '#F97316',
    autorise: '#22C55E',
    refuse_client: '#EF4444',
    en_preparation: '#3B82F6',
    devis_envoye: '#D97706',
    attente_paiement: '#D97706',
    paye: '#10B981',
    expedie: '#06B6D4',
    transit: '#0EA5E9',
    dedouanement: '#8B5CF6',
    arrive: '#14B8A6',
    livraison: '#84CC16',
    livre: '#16A34A',
    annule: '#9CA3AF',
  };
  return map[statut] || BRAND.navy;
}

// ── Section block wrapper ────────────────────────────────────────────────────
function Section({ title, icon: Icon, color, children }) {
  return (
    <div className="rounded-2xl border bg-white" style={{ borderLeft: `4px solid ${color || BRAND.navy}` }}>
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={16} style={{ color: color || BRAND.navy }} />}
          <span className="text-sm font-bold" style={{ color: 'var(--brand-text)' }}>{title}</span>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Input field ──────────────────────────────────────────────────────────────
function Field({ label, type = 'text', value, onChange, onBlur, placeholder, min, step, unit, disabled = false }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{label}</label>
      <div className="relative flex items-center">
        <input
          type={type}
          disabled={disabled}
          inputMode={type === 'number' ? 'decimal' : undefined}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          min={min}
          step={step}
          aria-label={unit ? `${label} (${unit})` : label}
          className="min-h-11 min-w-0 w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm font-medium outline-none transition-all focus:border-blue-400"
          style={{ color: 'var(--brand-text)', paddingRight: unit ? '2.5rem' : undefined }}
        />
        {unit && (
          <span className="absolute right-3 text-xs text-gray-400 font-bold pointer-events-none">{unit}</span>
        )}
      </div>
    </div>
  );
}

// ── Action button primary ────────────────────────────────────────────────────
function BtnPrimary({ onClick, children, disabled, color }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
      style={{
        background: color
          ? color
          : `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})`,
        color: 'white',
        boxShadow: `0 2px 10px ${color || BRAND.navy}30`,
      }}
    >
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════
export default function StaffDetailView({ workspace = false, task: requestedTask, onOpenContext }) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    sel,
    selClient: cl,
    selDest,
    isStaff,
    auth,
    teamUsers = [],
    workActions = [],
    clients,
    upd,
    ask,
    flash,
    changerStatut,
    revertStatut,
    annulerColis,
    archiverColis,
    desarchiverColis,
    demanderFeuVert,
    envoyerDevis,
    savePreparationMeasurements,
    refreshColis,
    confirmerDevis,
    settings = {},
    categories,
    getTarif,
    envois,
    assignDeparture,
    payer,
    can,
  } = useApp();

  // ── Local state ──────────────────────────────────────────────────────────
  const [actionLoading, setActionLoading] = useState(false);
  const actionRef = useRef(false);
  const [commentaire, setCommentaire] = useState(sel?.commentairePreparation || '');
  const [formErr, setFormErr] = useState('');
  const preparationFeedback = useRef(null);

  // Reception measurements remain separate from the optimised final package.
  const receptionVersion = useRef(null);
  const receptionOwner = useRef(null);
  const receptionDirty = useRef(false);
  const [receptionConflict, setReceptionConflict] = useState(false);
  // One set per physical carton, including cartons without a tracking number.
  const [multiDims, setMultiDims] = useState({});
  // Local fin dims form — initialized from existing sel values
  const [finalPackages, setFinalPackages] = useState(() => savedFinalPackages(sel));
  const preparationVersion = useRef(sel?.updatedAt);
  const preparationComposition = useRef(sel?.preparationCompositionVersion);
  const preparationBaseline = useRef(JSON.stringify(savedFinalPackages(sel)));
  const preparationDirty = useRef(false);
  const loadedPreparation = useRef(null);
  const [preparationConflict, setPreparationConflict] = useState(false);
  const [measuresSaved, setMeasuresSaved] = useState(false);
  const [preparationEditing, setPreparationEditing] = useState(false);
  // Photo simulation
  // Produits interdits checklist
  // Devis preview mode
  const [devisPrev, setDevisPrev] = useState(false);
  const [savedInputs, setSavedInputs] = useState('');
  // Envoi assignment
  const [selEnvoi, setSelEnvoi] = useState(sel?.envoi || '');
  // Tags préparation
  const [selTags, setSelTags] = useState(sel?.tagsPreparation || []);
  // Frais divers
  const [fraisDivers, setFraisDivers] = useState(sel?.fraisDivers || []);
  const [newFraisLibelle, setNewFraisLibelle] = useState('');
  const [newFraisMontant, setNewFraisMontant] = useState('');
  // Pro payment method
  const [proPayMethod, setProPayMethod] = useState(sel?.modePaiementPro || cl?.methodePaiement || 'virement');
  // Add carton toggle
  const [showAddCarton, setShowAddCarton] = useState(false);
  // Corrections section
  const [showCorrections, setShowCorrections] = useState(false);

  useEffect(() => {
    if (sel) {
      setCommentaire(sel.commentairePreparation || '');
      setFormErr('');
      const draft = preparationDrafts.get(`${auth?.u?.id}:${sel.id}`);
      setFinalPackages(draft?.finalPackages || savedFinalPackages(sel));
      preparationDirty.current = !!draft;
      preparationVersion.current = draft?.version || sel.updatedAt;
      preparationComposition.current = draft?.composition ?? sel.preparationCompositionVersion;
      preparationBaseline.current = draft?.baseline || JSON.stringify(savedFinalPackages(sel));
      setPreparationConflict(!!draft && draft.version !== sel.updatedAt);
      setMeasuresSaved(false);
      setPreparationEditing(false);
      setSelEnvoi(sel.envoi || '');
      setSelTags(sel.tagsPreparation || []);
      setFraisDivers(preparationDrafts.get(`${auth?.u?.id}:${sel.id}`)?.fraisDivers || sel.fraisDivers || []);
      setShowAddCarton(false);
      setDevisPrev(false);
      setShowCorrections(false);
      // Re-sync canal based on new client
      const newCl = clients.find((x) => x.id === sel.clientId);
      setProPayMethod(preparationDrafts.get(`${auth?.u?.id}:${sel.id}`)?.proPayMethod || sel.modePaiementPro || newCl?.methodePaiement || 'virement');
      loadedPreparation.current = JSON.stringify([draft?.finalPackages || savedFinalPackages(sel), draft?.fraisDivers || sel.fraisDivers || [], draft?.proPayMethod || sel.modePaiementPro || newCl?.methodePaiement || 'virement']);
    }
  }, [sel?.id]);

  useEffect(() => {
    if (!sel || preparationVersion.current === sel.updatedAt) return;
    if (preparationDirty.current) { setPreparationConflict(true); return; }
    preparationVersion.current = sel.updatedAt;
    preparationComposition.current = sel.preparationCompositionVersion;
    preparationBaseline.current = JSON.stringify(savedFinalPackages(sel));
    setFinalPackages(savedFinalPackages(sel)); setFraisDivers(sel.fraisDivers || []);
    setProPayMethod(sel.modePaiementPro || cl?.methodePaiement || 'virement');
    setPreparationConflict(false); setDevisPrev(false);
  }, [sel?.id, sel?.updatedAt]);

  useEffect(() => {
    if (loadedPreparation.current && loadedPreparation.current !== JSON.stringify([finalPackages,fraisDivers,proPayMethod])) return;
    loadedPreparation.current = null;
    if (sel && preparationDirty.current) preparationDrafts.set(`${auth?.u?.id}:${sel.id}`, { finalPackages, fraisDivers, proPayMethod, version: preparationVersion.current, composition: preparationComposition.current, baseline: preparationBaseline.current });
  }, [sel?.id, finalPackages, fraisDivers, proPayMethod, auth?.u?.id]);
  useEffect(() => {
    const guard = event => { if (preparationDirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const receptionSignature = JSON.stringify([sel?.id, sel?.nbColis, sel?.trackings, sel?.trackingsDetail, sel?.dimsParColis, sel?.dimL, sel?.dimW, sel?.dimH, sel?.poids]);
  useEffect(() => {
    if (!sel) return;
    if (receptionDirty.current && receptionOwner.current === sel.id) {
      setReceptionConflict(true);
      return;
    }
    const manifest = receptionCartonManifest(sel);
    setMultiDims(Object.fromEntries(manifest.dimsParColis.map((box, index) => [index, box])));
    receptionVersion.current = sel.updatedAt;
    receptionOwner.current = sel.id;
    receptionDirty.current = false;
    setReceptionConflict(false);
  }, [receptionSignature]);

  const openingActionId = new URLSearchParams(location.search).get('action');
  const canInvoiceWorkspace = ['perm_factures_voir', 'perm_factures_ajouter', 'perm_factures_valider', 'perm_factures_refuser', 'perm_factures_ocr', 'perm_factures_modifier_articles'].some(permission => can(permission));
  const canQuoteWorkspace = ['perm_colis_calculer_devis', 'perm_colis_envoyer_devis', 'perm_finances_voir_total'].some(permission => can(permission));
  const task = requestedTask || resolveDossierTask(sel || {}, location.search, workActions, can);
  const preparationView = task === 'preparation';
  useEffect(() => {
    if (!preparationView || (!formErr && !measuresSaved)) return;
    preparationFeedback.current?.scrollIntoView({ block: 'nearest' });
    preparationFeedback.current?.focus({ preventScroll: true });
  }, [formErr, measuresSaved, preparationView]);

  if (!sel || !isStaff) return null;

  const dest = selDest || getDestByCP(cl?.cp);
  const tarif = getTarif(dest?.code, cl?.abonnement);
  const divisor = volumetricDivisor(settings);
  const savedWeights = measureShipment(savedFinalPackages(sel), divisor);
  const measuresCurrent = sel.preparationCompositionVersion != null && sel.finalMeasurementsVersion === sel.preparationCompositionVersion;
  const chooseSection = (section, hash) => navigate(dossierTaskUrl(sel.id, section, location.search, { hash }));
  const continuation = <TaskContinuation currentActionId={openingActionId} currentDossierId={sel.id} currentKind={{documents:'documents',devis:'quote',preparation:'preparation',reception:'reception',accord:'reception',expedition:'departure',livraison:'departure'}[task]} />;
  const runAction = async (action) => {
    if (actionRef.current) return;
    actionRef.current = true; setActionLoading(true); setFormErr('');
    try { return await action(); } catch (error) { setFormErr(error.message || 'L’action n’a pas pu être enregistrée. Réessayez.'); return false; }
    finally { actionRef.current = false; setActionLoading(false); }
  };
  const borderColor = statusBorderColor(sel.statut);

  // ── Subscription status ──────────────────────────────────────────────────
  const isFreemium = !cl?.abonnement || cl.abonnement === 'freemium';
  const subFin = cl?.abonnementFin ? new Date(cl.abonnementFin) : null;
  const subJoursRestants = subFin ? Math.ceil((subFin - new Date()) / (1000 * 60 * 60 * 24)) : null;
  const subExpired = !isFreemium && subJoursRestants !== null && subJoursRestants <= 0;
  const subWarning = !isFreemium && subJoursRestants !== null && subJoursRestants > 0 && subJoursRestants <= 7;

  // ── Revert / Cancel helpers ───────────────────────────────────────────────
  function handleRevert() {
    ask(
      'Retour à l\'étape précédente',
      'Cette action remet le colis à l\'étape précédente. Les données (dimensions, devis, etc.) sont conservées. Continuer ?',
      () => runAction(() => revertStatut(sel.id)),
      { danger: true, okLabel: 'Oui, revenir en arrière' },
    );
  }

  function handleCancel() {
    ask(
      'Annuler ce colis',
      `Voulez-vous vraiment annuler le colis ${sel.ref} ? Cette action est irréversible.`,
      () => runAction(() => annulerColis(sel.id)),
      { danger: true, okLabel: 'Oui, annuler' },
    );
  }

  // Every reception edit writes both the individual boxes and the aggregate summary.
  async function handleValiderMesures() {
    if (receptionConflict) { setFormErr('Les mesures enregistrées ont changé. Reprenez la version du dossier avant de poursuivre.'); return; }
    const manifest = receptionCartonManifest(sel);
    const lines = manifest.trackingsDetail.map((box, index) => ({ fournisseur: box.fournisseur || `Carton ${index + 1}`, tracking: box.number || '' }));
    const measured = receptionMeasurements(lines, multiDims);
    if (!measured) {
      setFormErr('Renseignez les quatre mesures positives de chaque carton reçu.');
      return;
    }
    const saved = await upd(sel.id, { ...measured, statut: 'mesure' }, { expectedUpdatedAt: receptionVersion.current });
    receptionVersion.current = saved.updatedAt;
    receptionDirty.current = false;
    setReceptionConflict(false);
    setMultiDims(Object.fromEntries(saved.dimsParColis.map((box, index) => [index, box])));
    flash(`Mesures de réception enregistrées (${manifest.nbColis} carton${manifest.nbColis > 1 ? 's' : ''}). Les mesures après optimisation seront saisies pendant la préparation.`);
  }

  // Preview and saved quote use exactly the same explicit input values.
  const finalChanges = { finalPackages, fraisDivers, ...(cl?.type === 'pro' ? { modePaiementPro: proPayMethod } : {}) };
  const quote = calculateQuote({ colis: { ...sel, ...finalChanges }, client: cl, destination: dest, tarif, categories, settings });
  const acceptPreparation = saved => {
    preparationVersion.current = saved.updatedAt;
    preparationComposition.current = saved.preparationCompositionVersion;
    preparationBaseline.current = JSON.stringify(savedFinalPackages(saved));
    preparationDirty.current = false; preparationDrafts.delete(`${auth?.u?.id}:${sel.id}`);
    setPreparationConflict(false); setFinalPackages(savedFinalPackages(saved));
  };
  const reloadPreparation = () => {
    acceptPreparation(sel); setFraisDivers(sel.fraisDivers || []);
    setProPayMethod(sel.modePaiementPro || cl?.methodePaiement || 'virement'); setDevisPrev(false); setFormErr('');
  };
  const canKeepPreparationDraft = !sel.archive && !sel.produitInterdit && sel.feuVert === 'autorise' && ['autorise', 'en_preparation'].includes(sel.statut) && preparationComposition.current === sel.preparationCompositionVersion && preparationBaseline.current === JSON.stringify(savedFinalPackages(sel));
  const keepPreparationDraft = () => {
    if (!canKeepPreparationDraft) return;
    preparationVersion.current = sel.updatedAt;
    setPreparationConflict(false); setFormErr('');
    preparationDrafts.set(`${auth?.u?.id}:${sel.id}`, { finalPackages, fraisDivers, proPayMethod, version: sel.updatedAt, composition: preparationComposition.current, baseline: preparationBaseline.current });
  };
  async function handleSaveMeasurements() {
    if (preparationConflict) throw new Error('Le dossier a changé. Comparez votre saisie avec la version enregistrée avant de poursuivre.');
    let saved;
    try {
      saved = await savePreparationMeasurements(sel.id, { finalPackages }, { expectedUpdatedAt: preparationVersion.current, expectedCompositionVersion: preparationComposition.current });
    } catch (error) {
      if (error.code === '40001') { setPreparationConflict(true); await refreshColis(sel.id).catch(() => {}); }
      throw error;
    }
    if (saved) { acceptPreparation(saved);
      if (JSON.stringify(fraisDivers) !== JSON.stringify(saved.fraisDivers || []) || proPayMethod !== (saved.modePaiementPro || cl?.methodePaiement || 'virement')) {
        preparationDirty.current = true; preparationDrafts.set(`${auth?.u?.id}:${sel.id}`, { finalPackages: savedFinalPackages(saved), fraisDivers, proPayMethod, version: saved.updatedAt, composition: saved.preparationCompositionVersion });
      }
      setMeasuresSaved(true); setPreparationEditing(false); flash('Préparation enregistrée.'); }
    return saved;
  }
  async function handleEnvoyerDevis() {
    if (preparationConflict) throw new Error('Le dossier a changé. Reprenez la version enregistrée avant de calculer le devis.');
    if (!quote.ok) { setFormErr(quote.errors.map((error) => error.message).join(' ')); return false; }
    const saved = await envoyerDevis(sel.id, finalChanges, { expectedUpdatedAt: preparationVersion.current });
    if (saved !== false && saved != null) { acceptPreparation(saved); setSavedInputs(quoteInputFingerprint(quote.snapshot)); setDevisPrev(true); }
    return saved;
  }

  async function handleConfirmDevisEnvoye() {
    const result = await confirmerDevis(sel.id, { canal: cl?.telegramChatId ? 'telegram' : 'email' });
    if (result !== false) setDevisPrev(false);
    return result;
  }

  // ── Correction bar availability ───────────────────────────────────────────
  const canRevert = !!sel.statut && sel.statut !== 'annule' && sel.statut !== 'livre' && can('perm_colis_revenir_arriere');
  const canCancel = !!sel.statut && sel.statut !== 'annule' && sel.statut !== 'livre' && can('perm_colis_annuler');

  // ════════════════════════════════════════════════════════════════════════
  // RENDER STATUS BLOCKS
  // ════════════════════════════════════════════════════════════════════════

  function renderActionBlock() {
    if (task === 'documents') return canInvoiceWorkspace ? <DossierDocumentsTask key={sel.id} onQuote={canQuoteWorkspace ? () => chooseSection('devis') : undefined}>{continuation}</DossierDocumentsTask> : <p role="alert" className="p-4 text-sm text-slate-700">Vous n’avez pas accès aux factures de ce dossier.</p>;
    const stage = needsQuoteRecalculation(sel) ? 'en_preparation' : sel.statut;
    if (task === 'reception' && stage !== 'receptionne') return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-800">Réception enregistrée</h2><ReceivedCartons colis={sel} settings={settings} />{['mesure','attente_feu_vert'].includes(stage) && <BtnPrimary onClick={() => chooseSection('accord')}>Suivre l’accord du client</BtnPrimary>}{continuation}</section>;
    if (task === 'preparation' && !['autorise','en_preparation'].includes(stage)) return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-800">Préparation</h2>{sel.feuVert === 'autorise' && savedWeights && measuresCurrent ? <p className="text-sm text-slate-700">Mesures enregistrées : {savedFinalPackages(sel).map((box,index) => `Colis ${index + 1} · ${box.dimL} × ${box.dimW} × ${box.dimH} cm · ${box.poids} kg`).join(' ; ')}</p> : <p className="text-sm text-slate-700">La préparation attend l’accord du client.</p>}{continuation}</section>;
    if (task === 'devis' && stage !== 'en_preparation') {
      const amounts = sel.devisSnapshot?.amounts;
      return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-800">{sel.devisTotal ? 'Devis enregistré' : 'Devis à établir'}</h2>{canQuoteWorkspace ? sel.devisTotal ? <div className="space-y-2 rounded-xl border border-slate-200 p-4 text-sm">{amounts && <><Ligne label="Transport" value={eur(amounts.transport)} /><Ligne label="Taxes" value={eur((amounts.om || 0) + (amounts.omr || 0) + (amounts.tva || 0))} /><Ligne label="Frais" value={eur(amounts.fees)} /></>}<Ligne label="Total" value={eur(sel.devisTotal)} /><button className="min-h-11 font-semibold underline" onClick={() => chooseSection('paiement')}>Voir le règlement</button></div> : <p className="text-sm text-slate-700">Le devis sera disponible après l’accord du client et la préparation.</p> : <p role="alert" className="text-sm text-slate-700">Votre rôle ne permet pas de consulter le devis.</p>}{continuation}</section>;
    }
    if (task === 'devis' && !canQuoteWorkspace) return <p role="alert" className="p-4 text-sm text-slate-700">Votre rôle ne permet pas d’établir le devis.</p>;
    if (task === 'paiement' && !['devis_envoye','attente_paiement'].includes(stage)) return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-800">{sel.paiementDate ? 'Paiement confirmé' : 'Règlement'}</h2><p className="text-sm text-slate-700">{sel.paiementDate ? `${eur(sel.paiementMontant || sel.devisTotal)} reçu(s).` : 'Le règlement intervient après l’envoi du devis.'}</p>{continuation}</section>;
    if (['expedition','livraison'].includes(task) && !['paye','expedie','transit','dedouanement','arrive','livraison','livre'].includes(stage)) return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-800">Expédition à organiser</h2><p className="text-sm text-slate-700">Le dossier doit être préparé et son règlement confirmé avant le départ.</p>{continuation}</section>;
    if (task === 'accord' && !['mesure','attente_feu_vert','refuse_client'].includes(stage)) return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-800">Accord du client</h2><p className="text-sm text-slate-700">{sel.feuVert === 'autorise' ? 'Accord enregistré pour la préparation.' : 'Les mesures à réception doivent être enregistrées avant la demande.'}</p>{continuation}</section>;
    switch (needsQuoteRecalculation(sel) ? 'en_preparation' : sel.statut) {

      // ── 1. RECEPTIONNE ─────────────────────────────────────────────────
      case 'receptionne': {
        const manifest = receptionCartonManifest(sel);
        const boxes = manifest.dimsParColis.map((_, index) => multiDims[index] || {});
        const weights = measureShipment(boxes, divisor);
        const validTariff = tarif && [tarif.base, tarif.parKg].every(value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0);
        const transport = weights && validTariff ? Number(tarif.base) + weights.billableWeight * Number(tarif.parKg) : null;
        return <Section title={`Mesures de réception · ${manifest.nbColis} carton${manifest.nbColis > 1 ? 's' : ''}`} icon={Ruler} color={borderColor}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Mesurez chaque carton tel qu’il est reçu. Après optimisation de l’emballage, de nouvelles dimensions et un nouveau poids seront saisis pour établir le devis.</p>
            {receptionConflict && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Un carton ou ses mesures ont été modifiés depuis votre saisie. Vos valeurs saisies restent affichées.<button type="button" className="min-h-11 block font-semibold underline" onClick={() => { setMultiDims(Object.fromEntries(manifest.dimsParColis.map((box, index) => [index, box]))); receptionVersion.current = sel.updatedAt; receptionDirty.current = false; setReceptionConflict(false); setFormErr(''); }}>Reprendre les mesures enregistrées</button></div>}
            {manifest.trackingsDetail.map((carton, index) => {
              const box = multiDims[index] || {};
              return <fieldset key={index} className="rounded-xl border border-gray-200 p-3 space-y-3">
                <legend className="px-1 text-sm font-semibold brand-t">Carton {index + 1}{carton.fournisseur ? ` · ${carton.fournisseur}` : ''}{carton.number ? ` · ${carton.number}` : ' · Sans numéro de suivi'}</legend>
                <div className="grid grid-cols-2 gap-3">{[['dimL', 'Longueur', 'cm'], ['dimW', 'Largeur', 'cm'], ['dimH', 'Hauteur', 'cm'], ['poids', 'Poids réel', 'kg']].map(([key, label, unit]) => <Field key={key} label={`${label} · carton ${index + 1}`} type="number" min="0.01" step="0.01" unit={unit} value={box[key] ?? ''} onChange={event => { receptionDirty.current = true; setMultiDims(previous => ({ ...previous, [index]: { ...previous[index], [key]: event.target.value } })); }} />)}</div>
              </fieldset>;
            })}
            {weights && <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-1 text-sm">
              <Ligne label="Poids réel total à réception" value={`${weights.realWeight.toFixed(2)} kg`} />
              <Ligne label="Poids volumétrique total à réception" value={`${weights.volumetricWeight.toFixed(2)} kg`} />
              <Ligne label="Poids facturable avant optimisation" value={`${weights.billableWeight.toFixed(2)} kg`} />
              {transport != null ? <Ligne label="Transport avant optimisation, hors taxes et frais" value={eur(transport)} /> : <p className="text-sm text-amber-700">Tarif de destination à renseigner avant toute estimation.</p>}
              <p className="pt-1 text-xs text-gray-500">Ce montant ne constitue pas le devis final : celui-ci utilisera les mesures après optimisation et les documents vérifiés.</p>
            </div>}
            <BtnPrimary onClick={() => runAction(handleValiderMesures)} disabled={actionLoading || receptionConflict || !can('perm_colis_mesurer')}><Check size={15} />{actionLoading ? 'Enregistrement…' : 'Enregistrer les mesures de réception'}</BtnPrimary>
          </div>
        </Section>;
      }

      // ── MEASURED AT RECEPTION: request explicit preparation consent ───────
      case 'mesure': {
        return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold text-slate-800">Demander l’accord du client</h2><p className="text-sm text-slate-600">{receptionCartonManifest(sel).nbColis} carton(s) reçus et mesurés · Casier {sel.casier || 'à renseigner'}</p><TaskMessage template="demande_feu_vert" label="Préparer la demande au client" disabled={actionLoading || !can('perm_colis_demander_feuvert')} beforeSend={() => demanderFeuVert(sel.id)} />{continuation}</section>;
      }
      case 'attente_feu_vert': {
        return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold text-slate-800">En attente du client</h2><p className="text-sm text-slate-600">{!!sel.attenteClientDate ? 'Le client souhaite attendre d’autres cartons.' : 'La demande est enregistrée. L’accord du client est attendu.'}</p>{!sel.attenteClientDate && <TaskMessage template="relance_feu_vert" label="Préparer une relance" disabled={!can('perm_colis_demander_feuvert')} />}{onOpenContext && <button className="min-h-11 text-sm font-semibold text-slate-700 underline" onClick={() => onOpenContext('messages')}>Voir les échanges</button>}{continuation}</section>;
      }
      case 'refuse_client': return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-800">Préparation refusée par le client</h2><p className="text-sm text-slate-600">Organisez la suite avec le client avant de reprendre le dossier.</p>{onOpenContext && <button className="min-h-11 font-semibold underline" onClick={() => onOpenContext('messages')}>Ouvrir les échanges</button>}{continuation}</section>;

      // ── 5. AUTORISE ────────────────────────────────────────────────────
      case 'autorise': {
        return (
          <Section title="Préparer le colis" icon={Check} color={borderColor}>
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 border border-green-200">
                <Check size={12} className="text-green-500 flex-shrink-0" />
                <p className="text-[10px] font-bold text-green-700">Accord client reçu</p>
              </div>

              {subExpired && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-200">
                  <AlertTriangle size={12} className="text-red-500 flex-shrink-0" />
                  <p className="text-[10px] font-bold text-red-700">Abonnement expiré — préparation bloquée</p>
                </div>
              )}
              {subWarning && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
                  <p className="text-[10px] font-semibold text-amber-700">Abo. expire dans {subJoursRestants}j</p>
                </div>
              )}

              <BtnPrimary
                onClick={() => runAction(async () => { await changerStatut(sel.id, 'en_preparation'); chooseSection('preparation'); })}
                disabled={actionLoading || subExpired || !can('perm_colis_preparer')} color="#2563EB">
                <Check size={15} />
                {actionLoading ? 'En cours...' : 'Commencer la préparation'}
              </BtnPrimary>
            </div>
          </Section>
        );
      }

      // ── 6. EN_PREPARATION ─────────────────────────────────────────────
      case 'en_preparation': {
        const normalizeBoxes = boxes => JSON.stringify(boxes.map(box => Object.fromEntries(['dimL','dimW','dimH','poids'].map(key => [key,Number(box[key])]))));
        const measuresChanged = normalizeBoxes(finalPackages) !== normalizeBoxes(savedFinalPackages(sel));
        const verified = !measuresChanged && devisPrev && quote.ok && savedInputs === quoteInputFingerprint(quote.snapshot);
        const focusBlocker = (field) => {
          if (field.startsWith('dimensions')) return chooseSection('preparation');
          if (field.startsWith('fraisDivers')) return document.getElementById('quote-fees')?.scrollIntoView({ block: 'start' });
          chooseSection('documents', field.startsWith('lignes') || field.startsWith('lines') ? 'quote-unlinked' : 'quote-documents');
        };
        const preparationBlock = sel.archive ? 'Désarchivez le dossier avant de poursuivre sa préparation.' : sel.produitInterdit ? 'Un produit interdit est signalé : faites vérifier le dossier avant de poursuivre.' : sel.feuVert !== 'autorise' ? 'Le feu vert du client doit être enregistré avant de poursuivre la préparation.' : null;
        const weights = measureShipment(finalPackages, divisor);
        const isPro = cl?.type === 'pro';
        const inputClass = 'min-h-11 min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
        const changeFinal = (index, key, value) => { preparationDirty.current = true; setFinalPackages(previous => previous.map((box,position) => position === index ? { ...box, [key]: value } : box)); setMeasuresSaved(false); setDevisPrev(false); };
        if (preparationView) return <section id="preparation-workspace" aria-label="Préparation après optimisation" className="mx-auto w-full max-w-3xl scroll-mt-48 space-y-5">
          <div><h2 className="text-lg font-bold text-slate-800">Préparation</h2><p className="mt-1 text-sm text-slate-600">Saisissez les mesures de chaque colis après optimisation.</p></div>
          {(preparationEditing || measuresChanged || !savedWeights || !measuresCurrent) && <div id="quote-measures" className="scroll-mt-24"><Section title="Mesures après optimisation" icon={Ruler} color={borderColor}>
            <p className="mb-3 text-sm text-slate-600">Mesurez chaque colis physique après optimisation. Ces valeurs sont indépendantes des cartons reçus et alimentent le devis et le manifeste de départ.</p>
            {preparationBlock && <p role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{preparationBlock}</p>}
            {preparationConflict && <div role="alert" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><p>Une autre modification a été enregistrée depuis l’ouverture de votre saisie. Votre brouillon est conservé ; aucune mesure ne sera écrasée.</p><p className="mt-2">Version enregistrée : {savedFinalPackages(sel).map((box,index) => `colis ${index + 1} : ${box.dimL || '—'} × ${box.dimW || '—'} × ${box.dimH || '—'} cm / ${box.poids || '—'} kg`).join(' ; ')}</p><div className="mt-2 space-y-2">{canKeepPreparationDraft && <><p>Les mesures enregistrées et la composition des cartons sont inchangées. Vous pouvez conserver votre saisie et reprendre sur la nouvelle version du dossier.</p><button className="min-h-11 block font-semibold underline" onClick={keepPreparationDraft}>Conserver ma saisie et réessayer</button></>}<button className="min-h-11 block font-semibold underline" onClick={reloadPreparation}>Recharger et remplacer mon brouillon</button></div></div>}
            {sel.preparationCompositionVersion != null && sel.finalMeasurementsVersion !== sel.preparationCompositionVersion && <p role="status" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">La composition des cartons a changé. Mesurez à nouveau l’ensemble préparé puis enregistrez les mesures pour confirmer cette nouvelle préparation.</p>}
            <div className="space-y-3">{finalPackages.map((box,index) => <fieldset key={index} className="rounded-xl border border-slate-200 p-3"><legend className="px-1 text-sm font-semibold text-slate-700">Colis sortant {index + 1}</legend><div className="grid grid-cols-2 gap-3">{[['dimL', 'Longueur', 'cm'], ['dimW', 'Largeur', 'cm'], ['dimH', 'Hauteur', 'cm'], ['poids', 'Poids réel', 'kg']].map(([key,label,unit]) => <Field key={key} label={`${label} · colis sortant ${index + 1}`} type="number" min="0.01" step="0.01" disabled={actionLoading || !!preparationBlock || !can('perm_colis_preparer')} value={box[key] ?? ''} onChange={event => changeFinal(index,key,event.target.value)} unit={unit} />)}</div>{finalPackages.length > 1 && <button disabled={actionLoading || !!preparationBlock || !can('perm_colis_preparer')} className="min-h-11 text-sm font-semibold text-red-700 disabled:opacity-40" onClick={() => { preparationDirty.current = true; setFinalPackages(previous => previous.filter((_,position) => position !== index)); setDevisPrev(false); }}>Retirer le colis sortant {index + 1}</button>}</fieldset>)}</div>
            <button disabled={actionLoading || !!preparationBlock || !can('perm_colis_preparer')} className="my-3 min-h-11 w-full rounded-xl border border-dashed border-slate-300 text-sm font-semibold brand-t disabled:opacity-40" onClick={() => { preparationDirty.current = true; setFinalPackages(previous => [...previous,{dimL:'',dimW:'',dimH:'',poids:''}]); setDevisPrev(false); }}>+ Ajouter un colis après optimisation</button>
            <div ref={preparationFeedback} tabIndex={-1} className="scroll-mt-32">{formErr && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{formErr}</p>}
            {!weights && <p className="mb-2 text-sm text-amber-800">Renseignez les trois dimensions et un poids positif pour chaque colis sortant avant d’enregistrer.</p>}
            <BtnPrimary disabled={actionLoading || !!preparationBlock || preparationConflict || !weights || !can('perm_colis_preparer')} onClick={() => runAction(handleSaveMeasurements)}><Check size={16} />Enregistrer les mesures de préparation</BtnPrimary>
            {!can('perm_colis_preparer') && <p className="mt-2 text-sm text-slate-600">Les mesures sont enregistrées par une personne habilitée à préparer. Vous pouvez vérifier les documents et établir le devis dès qu’elles sont confirmées.</p>}
            <p role="status" className="mt-2 text-xs text-slate-600">{measuresSaved ? 'Mesures enregistrées.' : ''}</p></div>
            {weights && <div className="mt-4 space-y-1 border-t border-gray-100 pt-3 text-sm"><Ligne label="Poids volumétrique" value={`${weights.volumetricWeight.toFixed(2)} kg`} /><Ligne label="Poids facturable" value={`${weights.billableWeight.toFixed(2)} kg`} /></div>}
          </Section></div>}
          {!preparationEditing && !measuresChanged && savedWeights && measuresCurrent && <section aria-label="Relais après préparation" className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-800">Préparation enregistrée · {savedFinalPackages(sel).length} colis sortant(s) · {savedWeights.realWeight.toFixed(2)} kg</p>
            <p className="text-sm text-slate-700">{savedFinalPackages(sel).map((box,index) => `Colis ${index + 1} : ${box.dimL} × ${box.dimW} × ${box.dimH} cm · ${box.poids} kg`).join(' ; ')}</p>
            {can('perm_colis_preparer') && !preparationBlock && !preparationEditing && <button className="min-h-11 text-sm font-semibold text-slate-700 underline" onClick={() => setPreparationEditing(true)}>Modifier les mesures</button>}
            {workActions.filter(action => action.colis_id === sel.id && ['documents','quote'].includes(action.kind) && action.state !== 'done').slice(0,1).map(action => <p key={action.id} className="text-sm text-slate-700">{action.kind === 'documents' ? 'Factures à vérifier' : 'Devis à établir'} · {action.assignee_id ? staffName(action.assignee_id, teamUsers) : 'à prendre'}</p>)}
            {continuation}
          </section>}
          {can('perm_colis_preparer') && !preparationBlock && <>
          <details className="border-t border-slate-200"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Consignes facultatives {selTags.length > 0 ? `· ${selTags.length} choisie(s)` : ''}</summary>          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600">Consignes de préparation</p>
            <div className="flex flex-wrap gap-2">{TAGS_PREPARATION.map((tag) => <button key={tag} disabled={actionLoading} onClick={() => runAction(async () => { const next = selTags.includes(tag) ? selTags.filter((item) => item !== tag) : [...selTags, tag]; await upd(sel.id, { tagsPreparation: next }); setSelTags(next); })} className={`min-h-11 rounded-full px-3 py-2 text-xs font-semibold ${selTags.includes(tag) ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{tag}</button>)}</div>
            <textarea aria-label="Commentaire de préparation" value={commentaire} onChange={(event) => setCommentaire(event.target.value)} placeholder="Instructions utiles à la préparation…" rows={2} className={inputClass} />
            {commentaire !== (sel.commentairePreparation || '') && <button disabled={actionLoading} className="min-h-11 text-xs font-semibold text-blue-700" onClick={() => runAction(() => upd(sel.id, { commentairePreparation: commentaire }))}>Enregistrer la consigne</button>}
          </div>
</details>
          <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Photo du colis préparé</summary><WebcamCapture colisId={sel.id} colisRef={sel.ref} existingUrl={sel.photoPrep} onCapture={(path) => runAction(() => upd(sel.id, { photoPrep: path }))} /></details>
          </>}
        </section>;
        return <div className={`min-w-0 space-y-5 ${workspace ? "mx-auto w-full max-w-3xl" : ""}`}>
          <div><h2 className="text-lg font-bold text-slate-800">Établir le devis</h2><p className="mt-1 text-sm text-slate-600">Vérifiez le montant, puis enregistrez le devis avant son envoi.</p></div>
          {preparationConflict && <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p>Le dossier a été modifié depuis votre saisie. Votre brouillon est conservé ; reprenez la version partagée avant d’enregistrer le devis.</p>
            <p>Frais enregistrés : {(sel.fraisDivers || []).length ? sel.fraisDivers.map(fee => `${fee.libelle} · ${eur(fee.montant)}`).join(' ; ') : 'aucun'}.</p>
            {canKeepPreparationDraft && <><p>Les mesures et les cartons sont inchangés. Vous pouvez conserver vos frais puis vérifier le nouveau calcul.</p><button className="min-h-11 block font-semibold underline" onClick={keepPreparationDraft}>Conserver mes frais et recalculer</button></>}
            <button className="min-h-11 block font-semibold underline" onClick={reloadPreparation}>Recharger et remplacer mon brouillon</button>
          </div>}
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-y border-slate-200 py-3 text-sm" aria-label="Éléments du devis">
            <button className="min-h-11 font-semibold text-slate-700 underline" onClick={() => chooseSection('preparation')}>{savedWeights && measuresCurrent ? 'Préparation enregistrée ✓' : 'Préparation à terminer'}</button>
            {canInvoiceWorkspace && <button className="min-h-11 font-semibold text-slate-700 underline" onClick={() => chooseSection('documents')}>{currentInvoices(sel.factures || []).filter(invoice => invoice.valide).length} facture(s) vérifiée(s)</button>}
          </div>
          {measuresChanged && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Un brouillon de mesures reste à enregistrer. <button className="min-h-11 font-semibold underline" onClick={() => chooseSection('preparation')}>Reprendre la préparation</button></p>}
          {!quote.ok && <div className="rounded-xl bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-800">À résoudre avant le devis</p><ul className="mt-2 space-y-1 text-sm text-amber-800">{[...new Map(quote.errors.map(error => [error.message,error])).values()].map((error, index) => <li key={index}><button className="min-h-11 text-left underline underline-offset-2" onClick={() => focusBlocker(error.field)}>{error.message}</button></li>)}</ul></div>}
          {(sel.lignes || []).some(line => !line.factureId) && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Articles manuels inclus : {eur((sel.lignes || []).filter(line => !line.factureId).reduce((total,line) => total + Number(line.qte) * Number(line.prix),0))} HT. <button className="min-h-11 font-semibold underline" onClick={() => chooseSection('documents','quote-unlinked')}>Vérifier les articles manuels</button></p>}
          {isPro && <label className="block space-y-2 text-xs font-semibold text-slate-600">Modalités de règlement convenues<select aria-label="Modalités de règlement professionnel" value={proPayMethod} onChange={(event) => { preparationDirty.current = true; setProPayMethod(event.target.value); setDevisPrev(false); }} className={inputClass}>{[['virement', 'Virement bancaire'], ['especes', 'Espèces'], ['30_jours', 'Paiement à 30 jours'], ['fin_de_mois', 'Paiement en fin de mois']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="block text-xs font-normal text-gray-500">Cette modalité figurera dans la version du devis. Le paiement sera confirmé séparément après réception du règlement.</span></label>}
          <div id="quote-fees" className="scroll-mt-24 space-y-2 border-t border-gray-200 pt-4"><p className="text-xs font-semibold text-slate-600">Frais convenus</p>{fraisDivers.map((fee, index) => <div key={index} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 break-words">{fee.libelle}</span><strong>{eur(fee.montant)}</strong><button aria-label={`Retirer ${fee.libelle}`} disabled={actionLoading} className="flex min-h-11 min-w-11 items-center justify-center text-gray-400" onClick={() => runAction(async () => { const next = fraisDivers.filter((_, position) => position !== index); preparationDirty.current = true; setFraisDivers(next); setDevisPrev(false); })}><X size={14} /></button></div>)}
            <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Ajouter un frais</summary><form className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2" onSubmit={(event) => { event.preventDefault(); runAction(async () => { const amount = Number(newFraisMontant); if (!newFraisLibelle.trim() || newFraisMontant === '' || !Number.isFinite(amount) || amount < 0) throw new Error('Indiquez le libellé et un montant positif ou nul.'); const next = [...fraisDivers, { libelle: newFraisLibelle.trim(), montant: amount }]; preparationDirty.current = true; setFraisDivers(next); setNewFraisLibelle(''); setNewFraisMontant(''); setDevisPrev(false); }); }}><input aria-label="Libellé du frais" required value={newFraisLibelle} onChange={(event) => setNewFraisLibelle(event.target.value)} placeholder="Libellé du frais" className={inputClass} /><input aria-label="Montant du frais" required type="number" min="0" step="0.01" value={newFraisMontant} onChange={(event) => setNewFraisMontant(event.target.value)} placeholder="€" className={inputClass} /><button disabled={actionLoading} className="col-span-2 min-h-11 rounded-xl bg-slate-100 text-xs font-semibold text-slate-700">Ajouter le frais</button></form></details>
          </div>
          {subExpired && <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700">Abonnement expiré : régularisez l’offre du client avant l’envoi.</p>}

          {quote.ok && quote.warnings.length > 0 && <div className="space-y-1 rounded-xl bg-amber-50 p-3">{quote.warnings.map((warning, index) => <p key={index} className="text-xs text-amber-800">{warning}</p>)}</div>}
          {quote.ok && <Section title={verified ? 'Brouillon enregistré · vérifier puis envoyer' : 'Estimation du devis'} icon={Eye} color={BRAND.navy}>
            <div className="space-y-2 text-sm"><Ligne label="Transport" value={eur(quote.amounts.transport)} />{!isPro && <><Ligne label="Octroi de mer" value={eur(quote.amounts.om)} /><Ligne label="Octroi de mer régional" value={eur(quote.amounts.omr)} /><Ligne label={`TVA (${dest.tva} %)`} value={eur(quote.amounts.tva)} /></>}<Ligne label="Frais convenus" value={eur(quote.amounts.fees)} />{quote.patch.economie > 0 && <Ligne label="Économie après optimisation" value={eur(quote.patch.economie)} />}</div>
          </Section>}
          <div id="quote-review" tabIndex={-1} data-testid="quote-action-bar" className="sticky bottom-16 z-10 -mx-1 scroll-mt-48 border-t border-slate-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-3px_12px_rgba(0,0,0,0.06)] lg:bottom-0">
            <div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-600">Total à régler</p><p className="text-lg font-bold text-slate-800">{quote.ok ? eur(quote.amounts.total) : 'À compléter'}</p></div><p role="status" className="max-w-[60%] text-right text-xs text-slate-600">{actionLoading ? 'Enregistrement en cours…' : verified ? 'Brouillon enregistré · vérifiez le détail avant envoi' : sel.devisBrouillon ? 'Modifications à enregistrer et vérifier' : 'Calcul non enregistré'}</p></div>
          {!verified ? <BtnPrimary onClick={() => runAction(handleEnvoyerDevis)} disabled={!quote.ok || measuresChanged || preparationConflict || actionLoading || subExpired || !can('perm_colis_calculer_devis')}><Eye size={16} />{actionLoading ? 'Enregistrement…' : 'Enregistrer et vérifier le devis'}</BtnPrimary> : <div className="space-y-2"><BtnPrimary color="#15803D" onClick={() => runAction(handleConfirmDevisEnvoye)} disabled={actionLoading || preparationConflict || !quote.ok || subExpired || !can('perm_colis_envoyer_devis')}><Send size={16} />{actionLoading ? 'Envoi en cours…' : 'Envoyer le devis au client'}</BtnPrimary><button className="min-h-11 w-full rounded-xl border border-gray-200 text-sm font-semibold text-gray-600" onClick={() => setDevisPrev(false)}>Modifier le brouillon</button></div>}
          </div>
        </div>;
      }

      // ── 7. DEVIS_ENVOYE ────────────────────────────────────────────────
      // ── 7. DEVIS ENVOYE — en attente de paiement ──────────────────────
      case 'attente_paiement':
      case 'devis_envoye': {
        const isPro = cl?.type === 'pro';
        const PAY_METHODS = {
          virement: 'Virement bancaire',
          especes: 'Espèces',
          '30_jours': 'Paiement à 30 jours',
          fin_de_mois: 'Paiement fin de mois',
        };
        return (
          <Section title="En attente de paiement" icon={Clock} color={borderColor}>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-xs font-bold text-amber-700 mb-1">Montant à payer</p>
                <p className="text-2xl font-black" style={{ color: 'var(--brand-text)' }}>
                  {eur(sel.devisTotal)}
                </p>
              </div>
              {isPro ? (
                <>
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <p className="text-xs font-bold text-blue-800 mb-1">
                      Client professionnel — {PAY_METHODS[sel.modePaiementPro] || 'Modalité à vérifier dans le devis'}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500">Les modalités sont celles du devis envoyé. Pour les modifier, revenez à la préparation et établissez une nouvelle version.</p>
                  <BtnPrimary
                    onClick={() => runAction(() => payer(sel.id, sel.devisTotal))}
                    disabled={actionLoading || !sel.devisTotal || !can('perm_colis_confirmer_paiement')}
                    color="#059669"
                  >
                    <Check size={15} />
                    Confirmer réception du paiement
                  </BtnPrimary>
                </>
              ) : (
                <div className="space-y-2">
                  {/* Lien de paiement PayPlug */}
                  {sel.payplugPaymentUrl && (
                    <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 space-y-2">
                      <p className="text-[10px] font-bold text-blue-700 uppercase">Lien de paiement</p>
                      <a href={sel.payplugPaymentUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-600 underline break-all block">{sel.payplugPaymentUrl}</a>
                    </div>
                  )}
                  <TaskMessage template="relance_paiement" label="Préparer une relance de paiement" />
                </div>
              )}
            </div>
          </Section>
        );
      }

      // ── 9. PAYE ────────────────────────────────────────────────────────
      case 'paye': {
        const destinationCode = sel.devisSnapshot?.inputs?.destination?.code || dest?.code;
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Indian/Reunion' });
        const departureIssue = departure => !departure ? 'Départ introuvable' : departure.destinationCode !== destinationCode ? 'Destination différente du devis payé' : ['parti','arrive','archive'].includes(departure.statut) ? 'Départ déjà parti, arrivé ou archivé' : !departure.date || departure.date.slice(0,10) < today ? 'Date de départ dépassée ou absente' : departure.loadingClosesAt && Date.parse(departure.loadingClosesAt) <= Date.now() ? 'Chargement clôturé' : null;
        const availableEnvois = envois.filter(departure => !departureIssue(departure));
        const assigned = envois.find(departure => departure.id === sel.envoi);
        const assignmentIssue = sel.envoi ? departureIssue(assigned) : null;
        const canAssign = can(sel.envoi ? 'perm_envois_reaffecter' : 'perm_colis_affecter_envoi');
        return (
          <Section title="Paiement reçu — Expédier" icon={Check} color={borderColor}>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <p className="text-xs font-bold text-emerald-700 mb-1">Paiement reçu</p>
                <p className="text-2xl font-black text-emerald-700">
                  {eur(sel.paiementMontant || sel.devisTotal)}
                </p>
              </div>

              {/* Envoi assignment */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Affecter à un envoi
                </label>
                <select
                  aria-label="Départ de cette expédition"
                  value={selEnvoi}
                  disabled={actionLoading || !canAssign}
                  onChange={(e) => { const envoi = e.target.value; runAction(async () => {
                    await assignDeparture(sel, envoi || null);
                    setSelEnvoi(envoi);
                    flash(envoi ? 'Envoi affecté' : 'Envoi retiré');
                  }); }}
                  className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none"
                  style={{ color: 'var(--brand-text)' }}
                >
                  <option value="">— Choisir un départ compatible —</option>
                  {assignmentIssue && <option value={sel.envoi} disabled>{assigned?.date || "Départ affecté"} · {assignmentIssue}</option>}
                  {availableEnvois.map((e) => {
                    const d = new Date(e.date + 'T00:00:00');
                    const label = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
                    return (
                      <option key={e.id} value={e.id}>
                        {label} — {e.statut}
                      </option>
                    );
                  })}
                </select>
              </div>

              {assignmentIssue && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Affectation à revoir : {assignmentIssue}. Choisissez un départ compatible avant le chargement.</p>}
              {!canAssign && <p className="text-sm text-slate-600">L’affectation est modifiable par une personne habilitée {sel.envoi ? "à réaffecter les départs" : "à affecter les expéditions"}.</p>}
              {!availableEnvois.length && <p className="text-sm text-slate-600">Aucun départ ouvert compatible avec la destination du devis payé. La coordination doit prévoir le prochain départ.</p>}
              {subExpired && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-300">
                  <AlertTriangle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs font-bold text-red-800">
                    Abonnement expiré — expédition bloquée.
                  </p>
                </div>
              )}

              <BtnPrimary
                onClick={() => navigate(`/departs?envoi=${encodeURIComponent(sel.envoi || selEnvoi)}`)}
                disabled={(!sel.envoi && !selEnvoi) || !!assignmentIssue || subExpired || !can('perm_envois_voir')}
                color="#0891B2"
              >
                <Check size={15} />
                Vérifier le départ et son manifeste
              </BtnPrimary>
            </div>
          </Section>
        );
      }

      // ── 10a. DEDOUANEMENT ─────────────────────────────────────────────
      case 'dedouanement': {
        return (
          <Section title="En dédouanement" icon={Clock} color={borderColor}>
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-violet-50 border border-violet-200">
                <Clock size={14} className="text-violet-500 flex-shrink-0" />
                <p className="text-xs font-medium text-violet-700">
                  Le colis est en cours de dédouanement à destination.
                </p>
              </div>
              <BtnPrimary
                disabled={actionLoading || !can('perm_colis_changer_statut_expedition')}
                onClick={() => runAction(() => changerStatut(sel.id, 'arrive'))}
                color="#14B8A6"
              >
                <Check size={15} />
                Confirmer l'arrivée à destination
              </BtnPrimary>
            </div>
          </Section>
        );
      }

      // ── 10b. EXPEDIE / TRANSIT / ARRIVE / LIVRAISON ────────────────────
      case 'expedie':
      case 'transit':
      case 'arrive':
      case 'livraison': {
        const nextStatuts = TRANSITIONS[sel.statut] || [];
        const trackingSteps = [
          { key: 'expedie', label: 'Expédié', tpl: 'expedie' },
          { key: 'transit', label: 'En vol' },
          { key: 'dedouanement', label: 'Dédouanement' },
          { key: 'arrive', label: 'Arrivé', tpl: 'arrive' },
          { key: 'livraison', label: 'En livraison', tpl: 'en_livraison' },
          { key: 'livre', label: 'Livré' },
        ];
        const currentIdx = trackingSteps.findIndex((s) => s.key === sel.statut);

        return (
          <Section title="Suivi d'expédition" icon={Check} color={borderColor}>
            <div className="space-y-4">
              <p className="text-sm font-semibold text-slate-700">{trackingSteps[currentIdx]?.label || STATUTS[sel.statut]?.label}</p>
              {sel.tracking && <p className="break-all text-sm text-slate-600">Suivi : {sel.tracking}</p>}
              {/* Next step buttons */}
              <div className="flex flex-col gap-2">
                {sel.statut === 'transit' ? (
                  <>
                    <BtnPrimary
                      disabled={actionLoading || !can('perm_colis_changer_statut_expedition')}
                      onClick={() => runAction(() => changerStatut(sel.id, 'dedouanement'))}
                      color="#8B5CF6"
                    >
                      <Clock size={15} />
                      Passer en dédouanement
                    </BtnPrimary>
                    <BtnPrimary
                      disabled={actionLoading || !can('perm_colis_changer_statut_expedition')}
                      onClick={() => runAction(() => changerStatut(sel.id, 'arrive'))}
                      color="#14B8A6"
                    >
                      <Check size={15} />
                      Arrivé directement (sans dédouanement)
                    </BtnPrimary>
                  </>
                ) : (
                  nextStatuts.map((ns) => {
                    return (
                      <BtnPrimary
                        key={ns}
                        disabled={actionLoading || !can('perm_colis_changer_statut_expedition')}
                        onClick={() => runAction(() => changerStatut(sel.id, ns))}
                        color={borderColor}
                      >
                        <Check size={15} />
                        {{ transit: 'Confirmer le départ en vol', arrive: 'Confirmer l’arrivée à destination', livraison: 'Lancer la livraison', livre: 'Confirmer la livraison' }[ns] || STATUTS[ns]?.label}
                      </BtnPrimary>
                    );
                  })
                )}
              </div>
              {trackingSteps[currentIdx]?.tpl && <TaskMessage key={sel.statut} template={trackingSteps[currentIdx].tpl} label="Préparer une information au client" />}
              {continuation}
            </div>
          </Section>
        );
      }

      case 'livre': return <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="text-lg font-bold text-emerald-800">Livraison terminée</h2><p className="text-sm text-slate-700">Le dossier est livré. Les documents et les échanges restent consultables dans son contexte.</p>{continuation}</section>;
      case 'annule': return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-800">Dossier annulé</h2>{continuation}</section>;
      default: return null;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // COMMUNICATION PANEL
  // ════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════
  // FULL RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-w-0 flex flex-col gap-4 pb-24 lg:pb-4">
      {formErr && !(preparationView && (sel.statut === 'en_preparation' || needsQuoteRecalculation(sel))) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{formErr}</p>}

      {/* ── Action block ───────────────────────────────────────────────── */}
      {renderActionBlock()}
      {['receptionne', 'mesure', 'attente_feu_vert', 'autorise'].includes(sel.statut) && can('perm_colis_receptionner') && <button type="button" onClick={() => setShowAddCarton(true)} className="min-h-11 flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold brand-t"><Plus size={16} />Réceptionner un autre carton</button>}
      <ColisModal open={showAddCarton} onClose={() => setShowAddCarton(false)} initialColisId={sel.id} />

      {/* ── Corrections (collapsible, discreet) ──────────────────────── */}
      {(canRevert || canCancel) && (
        <div>
          <button
            onClick={() => setShowCorrections((p) => !p)}
            className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            <RotateCcw size={11} />
            {showCorrections ? 'Masquer les corrections' : 'Corrections'}
          </button>
          {showCorrections && (
            <div className="flex gap-2 flex-wrap mt-2 anim-fade">
              {canRevert && (
                <button
                  onClick={handleRevert}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100 transition-colors"
                >
                  <RotateCcw size={11} />
                  Étape précédente
                </button>
              )}
              {canCancel && (
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-colors"
                >
                  <X size={11} />
                  Annuler le colis
                </button>
              )}
              {sel.archive ? (
                <button
                  onClick={() => runAction(() => desarchiverColis(sel.id))}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
                >
                  <Archive size={11} />
                  Désarchiver
                </button>
              ) : (
                <button
                  onClick={() => runAction(() => archiverColis(sel.id))}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-200 text-gray-500 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <Archive size={11} />
                  Archiver
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
