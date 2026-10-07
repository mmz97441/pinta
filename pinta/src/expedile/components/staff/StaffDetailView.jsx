import { useTaskAccess } from '../../context/TaskAccessContext';
import { useNavigate, useLocation } from 'react-router-dom';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Ruler, Check, Clock, AlertTriangle, Eye, X, RotateCcw, Send, Plus, Archive,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, TRANSITIONS, TAGS_PREPARATION, getDestByCP } from '../../constants';
import { eur, kg } from '../../utils';
import { Ligne } from '../ui';
import WebcamCapture from '../ui/WebcamCapture';
import DossierDocumentsTask from './DossierDocumentsTask';
import ReceivedCartons from '../detail/ReceivedCartons';
import { receptionCartonManifest, receptionMeasurements } from '../../domain/reception';
import { currentInvoices } from '../../domain/invoiceDocuments';
import { needsQuoteRecalculation } from '../../domain/clientJourney';
import { calculateQuote, measureShipment, volumetricDivisor, quoteInputFingerprint, canReviewSavedQuote } from '../../domain/quote';
import { dossierTaskUrl, resolveDossierTask, hasCurrentPreparation, dossierNextTask } from '../../domain/dossierTasks';
import { recordVersionAtLeast } from '../../domain/recordVersion';
import { safeWorkReturn } from '../../domain/personalWork';
import { usePersistentDraft } from '../../hooks/usePersistentDraft';
import useWorkDraft from '../../hooks/useWorkDraft';
import TaskContinuation from '../workspace/TaskContinuation';
import { staffName } from '../workspace/WorkActionRow';
import TaskMessage from './TaskMessage';
import QuoteCustomsPanel from './QuoteCustomsPanel';
import ShipmentRevision from './ShipmentRevision';
import TaskReopen from './TaskReopen';
import TaskGuidance from './TaskGuidance';
import { revisionLockedReason, shipmentRevisionBoxes } from '../../domain/shipmentRevision';
import { departureFieldEditable, departureIssue, plannedDeparturesFor } from '../../domain/departurePlanning';
import { canSeeDossierFinances } from '../../domain/dossierOverview';
import { plural, pluralWord } from '../../domain/plural';
import DossierDeparture from '../detail/DossierDeparture';
import '../detail/dossierActions.css';

const receptionDrafts = new Map();
const preparationDrafts = new Map();
const preparationCommentDrafts = new Map();
const dateLabel = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : null;
// Matches revert_colis: navigation never calls this correction.
const REVERT_TARGETS = { mesure: 'receptionne', attente_feu_vert: 'mesure', autorise: 'attente_feu_vert', en_preparation: 'autorise', devis_envoye: 'en_preparation', attente_paiement: 'devis_envoye', expedie: 'paye', transit: 'expedie', dedouanement: 'transit', arrive: 'dedouanement', livraison: 'arrive' };
const savedFinalPackages = colis => {
  const boxes = shipmentRevisionBoxes(colis || {}, 'preparation');
  // A blank input is useful for the first package. It is never a saved measure.
  return boxes.length ? boxes : [{ dimL: '', dimW: '', dimH: '', poids: '' }];
};

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
// The left border is the status colour; without one, the brand text token (navy
// in light mode, light navy in dark mode) keeps the edge and the icon visible.
function Section({ title, icon: Icon, color, children }) {
  return (
    <div className="rounded-2xl border bg-white" style={{ borderLeft: `4px solid ${color || 'var(--brand-text)'}` }}>
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={16} aria-hidden="true" style={{ color: color || 'var(--brand-text)' }} />}
          <span className="text-sm font-bold" style={{ color: 'var(--brand-text)' }}>{title}</span>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Input field ──────────────────────────────────────────────────────────────
// `displayLabel` is the short visible label (« Longueur »); `label` the full
// accessible name (« Longueur · carton 2 »), which contains it.
function Field({ label, displayLabel, type = 'text', value, onChange, onBlur, placeholder, min, step, unit, disabled = false }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{displayLabel || label}</label>
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
// One primary style for every step (dossierActions.css): never a status colour.
function BtnPrimary({ onClick, children, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="dossier-primary-button w-full py-3">
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════
export default function StaffDetailView({ workspace = false, active = true, task: requestedTask, onOpenContext }) {
  const workspaceActive = useRef(active);
  workspaceActive.current = active;
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
    correctColisTask,
    refreshColis,
    confirmerDevis,
    settings = {},
    categories,
    getTarif,
    envois,
    payer,
    can: rawCan,
  } = useApp();
  const { taskCan: can, readOnly } = useTaskAccess(rawCan);

  // ── Local state ──────────────────────────────────────────────────────────
  const [actionLoading, setActionLoading] = useState(false);
  const actionRef = useRef(false);
  const [commentaire, setCommentaire] = useState(sel?.commentairePreparation || '');
  const commentDirty = useRef(false);
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
  const [preparationConflictRefresh, setPreparationConflictRefresh] = useState({ state: 'idle' });
  const preparationConflictRequest = useRef(0);
  const preparationOwner = useRef(null);
  preparationOwner.current = `${auth?.u?.id}:${sel?.id}`;
  const [measuresSaved, setMeasuresSaved] = useState(false);
  const [preparationEditing, setPreparationEditing] = useState(false);
  // Photo simulation
  // Produits interdits checklist
  // Devis preview mode
  const [devisPrev, setDevisPrev] = useState(null);
  const [savedInputs, setSavedInputs] = useState('');
  const [customsDirty, setCustomsDirty] = useState(false);
  const [paymentFeedback, setPaymentFeedback] = useState('');
  // Tags préparation
  const [selTags, setSelTags] = useState(sel?.tagsPreparation || []);
  // Frais divers
  const [fraisDivers, setFraisDivers] = useState(sel?.fraisDivers || []);
  const [pendingFeeDraft, setPendingFeeDraft] = usePersistentDraft(sel?.id ? `quote-fee:${sel.id}` : null, { libelle: '', montant: '' });
  const newFraisLibelle = pendingFeeDraft?.libelle || '';
  const newFraisMontant = pendingFeeDraft?.montant ?? '';
  const setNewFraisLibelle = value => setPendingFeeDraft(previous => ({ ...previous, libelle: value }));
  const setNewFraisMontant = value => setPendingFeeDraft(previous => ({ ...previous, montant: value }));
  const pendingFee = Boolean(newFraisLibelle.trim() || newFraisMontant !== '');
  // Pro payment method
  const [proPayMethod, setProPayMethod] = useState(sel?.modePaiementPro || cl?.methodePaiement || 'virement');
  // Add carton toggle
  // Corrections section
  const [showCorrections, setShowCorrections] = useState(false);
  const [preparationRevision, setPreparationRevision] = useState(false);

  useEffect(() => {
    if (sel) {
      setCommentaire(preparationCommentDrafts.get(`${auth?.u?.id}:${sel.id}`) ?? sel.commentairePreparation ?? '');
      commentDirty.current = preparationCommentDrafts.has(`${auth?.u?.id}:${sel.id}`);
      setFormErr('');
      const draft = preparationDrafts.get(`${auth?.u?.id}:${sel.id}`);
      setFinalPackages(draft?.finalPackages || savedFinalPackages(sel));
      preparationDirty.current = !!draft;
      preparationVersion.current = draft?.version || sel.updatedAt;
      preparationComposition.current = draft?.composition ?? sel.preparationCompositionVersion;
      preparationBaseline.current = draft?.baseline || JSON.stringify(savedFinalPackages(sel));
      setPreparationConflict(!!draft && draft.version !== sel.updatedAt);
      setPreparationConflictRefresh({ state: 'idle' });
      setMeasuresSaved(false);
      setPreparationEditing(false);
      setPaymentFeedback('');
      setSelTags(sel.tagsPreparation || []);
      setFraisDivers(preparationDrafts.get(`${auth?.u?.id}:${sel.id}`)?.fraisDivers || sel.fraisDivers || []);
      setDevisPrev(null);
      setShowCorrections(false);
      setPreparationRevision(false);
      // Re-sync canal based on new client
      const newCl = clients.find((x) => x.id === sel.clientId);
      setProPayMethod(preparationDrafts.get(`${auth?.u?.id}:${sel.id}`)?.proPayMethod || sel.modePaiementPro || newCl?.methodePaiement || 'virement');
      loadedPreparation.current = JSON.stringify([draft?.finalPackages || savedFinalPackages(sel), draft?.fraisDivers || sel.fraisDivers || [], draft?.proPayMethod || sel.modePaiementPro || newCl?.methodePaiement || 'virement']);
    }
  }, [sel?.id]);

  useEffect(() => () => { preparationConflictRequest.current += 1; }, [sel?.id, auth?.u?.id]);

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
    const guard = event => { if (preparationDirty.current || commentDirty.current || receptionDirty.current || pendingFee) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [pendingFee]);

  const receptionSignature = JSON.stringify([sel?.id, sel?.nbColis, sel?.trackings, sel?.trackingsDetail, sel?.dimsParColis, sel?.dimL, sel?.dimW, sel?.dimH, sel?.poids]);
  useEffect(() => {
    if (!sel) return;
    if (receptionDirty.current && receptionOwner.current === sel.id) {
      setReceptionConflict(true);
      return;
    }
    const draft = receptionDrafts.get(`${auth?.u?.id}:${sel.id}`);
    const manifest = receptionCartonManifest(sel);
    setMultiDims(draft?.multiDims || Object.fromEntries(manifest.dimsParColis.map((box, index) => [index, box])));
    receptionVersion.current = draft?.version || sel.updatedAt;
    receptionOwner.current = sel.id;
    receptionDirty.current = Boolean(draft);
    setReceptionConflict(Boolean(draft && draft.version !== sel.updatedAt));
  }, [receptionSignature, auth?.u?.id]);
  useEffect(() => {
    if (sel && receptionDirty.current && receptionOwner.current === sel.id) receptionDrafts.set(`${auth?.u?.id}:${sel.id}`, { multiDims, version: receptionVersion.current });
  }, [sel?.id, auth?.u?.id, multiDims]);
  useWorkDraft({ userId: auth?.u?.id, dossierId: sel?.id, kind: 'reception', source: 'reception-measures', dirty: receptionDirty.current, label: 'mesures à réception' });
  useWorkDraft({ userId: auth?.u?.id, dossierId: sel?.id, kind: 'preparation', source: 'preparation-measures', dirty: preparationDirty.current && JSON.stringify(finalPackages) !== preparationBaseline.current, label: 'mesures après optimisation' });
  useWorkDraft({ userId: auth?.u?.id, dossierId: sel?.id, kind: 'preparation', source: 'preparation-comment', dirty: commentDirty.current, label: 'consigne de préparation' });
  useWorkDraft({ userId: auth?.u?.id, dossierId: sel?.id, kind: 'quote', source: 'quote-fees', dirty: pendingFee || preparationDirty.current && (JSON.stringify(fraisDivers) !== JSON.stringify(sel?.fraisDivers || []) || proPayMethod !== (sel?.modePaiementPro || cl?.methodePaiement || 'virement')), label: 'frais ou modalités du devis' });

  const openingActionId = new URLSearchParams(location.search).get('action');
  const canInvoiceWorkspace = ['perm_factures_voir', 'perm_factures_ajouter', 'perm_factures_valider', 'perm_factures_refuser', 'perm_factures_ocr', 'perm_factures_modifier_articles'].some(permission => rawCan(permission));
  const canQuoteWorkspace = ['perm_colis_calculer_devis', 'perm_colis_envoyer_devis', 'perm_finances_voir_total'].some(permission => rawCan(permission));
  const canCalculateQuote = can('perm_colis_calculer_devis');
  // The rule of the overview's Devis and Paiement steps: no amount without it.
  const financeVisible = canSeeDossierFinances(rawCan);
  const task = requestedTask || resolveDossierTask(sel || {}, location.search, workActions, can, cl || {});
  const editRequested = new URLSearchParams(location.search).get('modifier') === task;
  const consumeEditRequest = useCallback(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('modifier')) return;
    params.delete('modifier');
    navigate(`${location.pathname}?${params}${location.hash}`, { replace: true, state: location.state });
  }, [location.search, location.pathname, location.hash, location.state, navigate]);
  useEffect(() => {
    if (!editRequested || !sel) return;
    // Sent quotes and measurement revisions consume the intent in their own
    // editor. Here only the ordinary draft forms are opened, without a save.
    const stage = needsQuoteRecalculation(sel) ? 'en_preparation' : sel.statut;
    const normalPreparation = task === 'preparation' && ['autorise', 'en_preparation'].includes(stage)
      && !preparationRevision && !sel.devisSnapshot?.inputs && !(sel.devisSnapshot && hasCurrentPreparation(sel));
    const draftQuote = task === 'devis' && ['autorise', 'en_preparation'].includes(stage);
    const initialReceipt = task === 'reception' && stage === 'receptionne';
    if (!normalPreparation && !draftQuote && !initialReceipt) return;
    const locked = revisionLockedReason(sel, task === 'reception' ? 'reception' : 'preparation');
    if (!locked && !readOnly) {
      if (normalPreparation && can('perm_colis_preparer')) setPreparationEditing(true);
      if (draftQuote && canCalculateQuote) setDevisPrev(false);
    }
    consumeEditRequest();
  }, [editRequested, sel, task, preparationRevision, readOnly, can, canCalculateQuote, consumeEditRequest]);
  const preparationView = task === 'preparation';
  useEffect(() => {
    if (!workspaceActive.current || !preparationView || (!formErr && !measuresSaved)) return;
    preparationFeedback.current?.scrollIntoView({ block: measuresSaved ? 'start' : 'nearest' });
    preparationFeedback.current?.focus({ preventScroll: true });
  }, [formErr, measuresSaved, preparationView]);

  if (!sel || !isStaff) return null;

  const dest = selDest || getDestByCP(cl?.cp);
  const tarif = getTarif(dest?.code, cl?.abonnement);
  const divisor = volumetricDivisor(settings);
  const savedWeights = measureShipment(savedFinalPackages(sel), divisor);
  const measuresCurrent = hasCurrentPreparation(sel);
  const chooseSection = (section, hash) => navigate(dossierTaskUrl(sel.id, section, location.search, { hash }));
  const continuation = <TaskContinuation onOpenTeam={onOpenContext ? () => onOpenContext('equipe') : undefined} currentActionId={openingActionId} currentDossierId={sel.id} currentKind={{documents:'documents',devis:'quote',preparation:'preparation',reception:'reception',accord:'reception',expedition:'departure',livraison:'departure'}[task]} />;
  const nextUsefulTask = dossierNextTask(sel, rawCan, cl);
  const canViewTask = target => target === 'documents' ? canInvoiceWorkspace : target === 'devis' ? canQuoteWorkspace : true;
  const taskLinkLabels = { reception: 'Voir les mesures à réception', accord: 'Voir l’accord du client', preparation: 'Ouvrir l’optimisation', documents: 'Vérifier les factures d’achat', devis: 'Ouvrir le devis', paiement: 'Voir le règlement', expedition: 'Voir le transport', livraison: 'Ouvrir la livraison' };
  const taskOwner = target => {
    const kind = { reception: 'reception', accord: 'reception', preparation: 'preparation', documents: 'documents', devis: 'quote', expedition: 'departure', livraison: 'departure' }[target];
    const action = workActions.find(item => item.colis_id === sel.id && item.kind === kind && item.state !== 'done');
    return action?.assignee_id ? `Cette tâche est suivie par ${action.assignee_id === auth?.u?.id ? 'vous' : staffName(action.assignee_id, teamUsers)}.` : null;
  };
  const guidance = (title, message, target = nextUsefulTask, children) => <TaskGuidance title={title} message={message}
    owner={target && target !== task ? taskOwner(target) : null}
    actionLabel={target && target !== task && canViewTask(target) ? taskLinkLabels[target] : null}
    onOpen={target && target !== task && canViewTask(target) ? () => chooseSection(target) : null}>{children}{continuation}</TaskGuidance>;
  const runAction = async (action) => {
    if (readOnly) { setFormErr('Cette tâche est suivie par un collègue. Demandez un relais avant de la modifier.'); return false; }
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

  const correctionTarget = REVERT_TARGETS[sel.statut];
  const correctionLabel = STATUTS[correctionTarget]?.label || correctionTarget;
  const lastRequest = dateLabel(sel.demandeFeuVertEnvoyeeAt);
  const replyDate = dateLabel(sel.attenteClientDate || sel.feuVertDate);

  // ── Revert / Cancel helpers ───────────────────────────────────────────────
  function handleRevert() {
    ask(
      `Corriger l’étape vers ${correctionLabel} ?`,
      `${sel.ref} passera de « ${STATUTS[sel.statut]?.label || sel.statut} » à « ${correctionLabel} ». Les cartons, mesures et factures sont conservés.${['receptionne','mesure','attente_feu_vert','autorise','en_preparation'].includes(correctionTarget) ? ' Le total et la version enregistrée du devis seront effacés : il faudra recalculer et vérifier le devis.' : ' Le devis enregistré est conservé.'}${['receptionne','mesure','attente_feu_vert'].includes(correctionTarget) ? ' L’accord client repasse en attente.' : ''} Aucun message ne sera envoyé au client.`,
      () => runAction(() => revertStatut(sel.id)),
      { danger: true, okLabel: `Confirmer la correction vers ${correctionLabel}` },
    );
  }

  function handleCancel() {
    ask(
      'Annuler cette expédition ?',
      `L’expédition ${sel.ref} sera annulée et ne pourra plus être préparée ni expédiée. Ses cartons, factures et échanges restent conservés. Ce n’est pas l’abandon d’une saisie. Aucun remboursement ni message client n’est effectué par cette action.`,
      () => runAction(() => annulerColis(sel.id)),
      { danger: true, okLabel: 'Annuler l’expédition' },
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
    receptionDirty.current = false; receptionDrafts.delete(`${auth?.u?.id}:${sel.id}`);
    setReceptionConflict(false);
    setMultiDims(Object.fromEntries(saved.dimsParColis.map((box, index) => [index, box])));
    flash(`Mesures de réception enregistrées (${plural(manifest.nbColis, 'carton')}). Les mesures après optimisation seront saisies pendant la préparation.`);
  }

  // Preview and saved quote use exactly the same explicit input values.
  const finalChanges = { finalPackages, fraisDivers, ...(cl?.type === 'pro' ? { modePaiementPro: proPayMethod } : {}) };
  const quote = calculateQuote({ colis: { ...sel, ...finalChanges }, client: cl, destination: dest, tarif, categories, settings });
  const acceptPreparation = saved => {
    preparationConflictRequest.current += 1;
    setPreparationConflictRefresh({ state: 'idle' });
    preparationVersion.current = saved.updatedAt;
    preparationComposition.current = saved.preparationCompositionVersion;
    preparationBaseline.current = JSON.stringify(savedFinalPackages(saved));
    preparationDirty.current = false; preparationDrafts.delete(`${auth?.u?.id}:${sel.id}`);
    setPreparationConflict(false); setFinalPackages(savedFinalPackages(saved));
  };
  // After a rejected save, the cached dossier is not a safe comparison source.
  // Keep every draft field until a complete fresh read and an explicit choice.
  const preparationConflictReady = preparationConflictRefresh.state === 'idle'
    || (preparationConflictRefresh.state === 'ready' && recordVersionAtLeast(sel.updatedAt, preparationConflictRefresh.version));
  const refreshPreparationConflict = async () => {
    const request = ++preparationConflictRequest.current;
    const owner = `${auth?.u?.id}:${sel.id}`;
    const isCurrent = () => request === preparationConflictRequest.current && owner === preparationOwner.current;
    setPreparationConflict(true);
    setPreparationConflictRefresh({ state: 'loading' });
    try {
      const fresh = await refreshColis(sel.id);
      if (!isCurrent()) return false;
      if (!fresh?.updatedAt || fresh.id !== sel.id) throw new Error('Dossier indisponible.');
      setPreparationConflictRefresh({ state: 'ready', version: fresh.updatedAt });
      return true;
    } catch {
      if (isCurrent()) setPreparationConflictRefresh({ state: 'error' });
      return false;
    }
  };
  const preparationConflictLoading = !preparationConflictReady && preparationConflictRefresh.state !== 'error';
  const preparationConflictNotice = !preparationConflictReady && (preparationConflictLoading
    ? <p role="status">Chargement de la version à jour… Votre saisie est conservée.</p>
    : <div><p>Impossible de charger la version à jour. Votre saisie est conservée. Réessayez le chargement avant de comparer les versions.</p><button className="min-h-11 block font-semibold underline" onClick={refreshPreparationConflict}>Réessayer le chargement</button></div>);
  const reloadPreparation = () => {
    if (!preparationConflictReady) return;
    acceptPreparation(sel); setFraisDivers(sel.fraisDivers || []);
    setProPayMethod(sel.modePaiementPro || cl?.methodePaiement || 'virement'); setDevisPrev(false); setFormErr('');
  };
  const canKeepPreparationDraft = preparationConflictReady && !sel.archive && !sel.produitInterdit && sel.feuVert === 'autorise' && ['autorise', 'en_preparation'].includes(sel.statut) && preparationComposition.current === sel.preparationCompositionVersion && preparationBaseline.current === JSON.stringify(savedFinalPackages(sel));
  const keepPreparationDraft = () => {
    if (!canKeepPreparationDraft) return;
    preparationVersion.current = sel.updatedAt;
    preparationConflictRequest.current += 1;
    setPreparationConflictRefresh({ state: 'idle' });
    setPreparationConflict(false); setFormErr('');
    preparationDrafts.set(`${auth?.u?.id}:${sel.id}`, { finalPackages, fraisDivers, proPayMethod, version: sel.updatedAt, composition: preparationComposition.current, baseline: preparationBaseline.current });
  };
  async function handleSaveMeasurements() {
    if (preparationConflict) throw new Error('Le dossier a changé. Comparez votre saisie avec la version enregistrée avant de poursuivre.');
    const owner = `${auth?.u?.id}:${sel.id}`;
    let saved;
    try {
      saved = await savePreparationMeasurements(sel.id, { finalPackages }, { expectedUpdatedAt: preparationVersion.current, expectedCompositionVersion: preparationComposition.current });
    } catch (error) {
      if (preparationOwner.current !== owner) return false;
      if (error.code === '40001') await refreshPreparationConflict();
      if (preparationOwner.current !== owner) return false;
      throw error;
    }
    if (preparationOwner.current !== owner) return false;
    if (saved) { acceptPreparation(saved);
      if (JSON.stringify(fraisDivers) !== JSON.stringify(saved.fraisDivers || []) || proPayMethod !== (saved.modePaiementPro || cl?.methodePaiement || 'virement')) {
        preparationDirty.current = true; preparationDrafts.set(`${auth?.u?.id}:${sel.id}`, { finalPackages: savedFinalPackages(saved), fraisDivers, proPayMethod, version: saved.updatedAt, composition: saved.preparationCompositionVersion });
      }
      setMeasuresSaved(true); setPreparationEditing(false); flash('Optimisation enregistrée. Les mesures sont disponibles pour préparer le montant à payer.'); }
    return saved;
  }
  async function handleEnvoyerDevis() {
    if (pendingFee) throw new Error('Ajoutez le frais en cours de saisie ou annulez-le avant d’enregistrer le devis.');
    if (customsDirty) throw new Error('Terminez le classement douanier avant d’enregistrer le devis.');
    if (preparationConflict) throw new Error('Le dossier a changé. Reprenez la version enregistrée avant de calculer le devis.');
    if (!quote.ok) { setFormErr(quote.errors.map((error) => error.message).join(' ')); return false; }
    const saved = await envoyerDevis(sel.id, finalChanges, { expectedUpdatedAt: preparationVersion.current });
    if (saved !== false && saved != null) { acceptPreparation(saved); setSavedInputs(quoteInputFingerprint(quote.snapshot)); setDevisPrev(true); }
    return saved;
  }

  async function handleConfirmDevisEnvoye() {
    if (customsDirty) throw new Error('Terminez le classement douanier avant d’envoyer le devis.');
    const result = await confirmerDevis(sel.id, { canal: cl?.telegramChatId ? 'telegram' : 'email' });
    if (result !== false) setDevisPrev(false);
    return result;
  }

  const customsPanel = cl?.type !== 'pro' && canQuoteWorkspace ? <QuoteCustomsPanel key={sel.id} colis={sel} destination={dest?.code} onDirtyChange={setCustomsDirty} onSaved={saved => {
    setDevisPrev(false); setSavedInputs(''); setCustomsDirty(false);
    // Our classification save changes updatedAt, but does not change the
    // preparer's measures or this operator's unsaved fees. Preserve that draft
    // only when it was based on the version that has just been saved.
    if (preparationVersion.current === sel.updatedAt && preparationComposition.current === saved.preparationCompositionVersion && preparationBaseline.current === JSON.stringify(savedFinalPackages(saved))) {
      preparationVersion.current = saved.updatedAt; setPreparationConflict(false);
      if (preparationDirty.current) preparationDrafts.set(`${auth?.u?.id}:${sel.id}`, { finalPackages, fraisDivers, proPayMethod, version: saved.updatedAt, composition: preparationComposition.current, baseline: preparationBaseline.current });
    }
  }} /> : null;

  // ── Correction bar availability ───────────────────────────────────────────
  const canRevert = ['expedie', 'transit', 'dedouanement', 'arrive', 'livraison'].includes(sel.statut) && !!correctionTarget && !sel.archive && can('perm_colis_revenir_arriere');
  const canArchive = can('perm_colis_archiver');
  const canCancel = !sel.archive && !!sel.statut && sel.statut !== 'annule' && sel.statut !== 'livre' && can('perm_colis_annuler');
  const canCorrect = permission => can('perm_colis_revenir_arriere') && can(permission);
  const saveRevision = async (phase, boxes, expectedUpdatedAt) => {
    if (phase === 'preparation') setPreparationRevision(true);
    const saved = await correctColisTask(sel.id, phase, { boxes }, {
      expectedUpdatedAt,
      reason: phase === 'reception' ? 'Correction des mesures à réception.' : 'Correction des mesures après optimisation.',
    });
    acceptPreparation(saved); setDevisPrev(null); setSavedInputs('');
    return saved;
  };
  const reopenTask = async (phase, expectedUpdatedAt) => {
    const saved = await correctColisTask(sel.id, phase, {}, {
      expectedUpdatedAt,
      reason: phase === 'accord' ? 'Nouvelle demande d’accord initiée par l’équipe.' : 'Reprise du devis pour correction.',
    });
    acceptPreparation(saved); setDevisPrev(false); setSavedInputs('');
    flash(phase === 'accord' ? 'Prêt à redemander l’accord. Préparez le message puis choisissez de l’envoyer.' : 'Devis repris. Vos informations sont conservées pour la correction.');
    return saved;
  };
  const revisionEditor = phase => {
    const nextTask = phase === 'reception' ? 'accord' : nextUsefulTask;
    const mayContinue = nextTask !== phase && canViewTask(nextTask);
    return <ShipmentRevision colis={sel} phase={phase} draftOwnerId={auth?.u?.id}
      autoOpen={editRequested && task === phase} onAutoOpen={consumeEditRequest}
      canEdit={canCorrect(phase === 'reception' ? 'perm_colis_mesurer' : 'perm_colis_preparer')}
      onSave={saveRevision} onReload={() => refreshColis(sel.id)}
      onContinue={() => mayContinue ? chooseSection(nextTask) : navigate(safeWorkReturn(new URLSearchParams(location.search).get('returnTo') || '/'))}
      nextLabel={mayContinue ? taskLinkLabels[nextTask] : 'Retour à ma liste'} />;
  };
  const reopenControl = phase => <TaskReopen colis={sel} task={phase}
    autoOpen={editRequested && task === phase} onAutoOpen={consumeEditRequest}
    canEdit={canCorrect(phase === 'accord' ? 'perm_colis_demander_feuvert' : 'perm_colis_calculer_devis')}
    onSave={reopenTask} onReload={() => refreshColis(sel.id)} />;

  // ════════════════════════════════════════════════════════════════════════
  // RENDER STATUS BLOCKS
  // ════════════════════════════════════════════════════════════════════════

  function renderActionBlock() {
    const stage = needsQuoteRecalculation(sel) ? 'en_preparation' : sel.statut;
    const inTransport = Boolean(sel.dateExpedition) || ['expedie','transit','dedouanement','arrive','livraison','livre'].includes(sel.statut);
    const paymentRecorded = Boolean(sel.paiementDate) || sel.paiementMontant != null || sel.statut === 'paye';
    const closed = sel.archive || sel.statut === 'annule';
    const frozenLines = sel.devisSnapshot?.amounts?.taxLines || sel.devisSnapshot?.inputs?.lines || [];
    const quoteSummary = Number(sel.devisTotal) > 0 ? <div aria-label="Devis enregistré" className="space-y-2 rounded-xl border border-slate-200 p-4 text-sm">
      {sel.devisSnapshot?.amounts && <><Ligne label="Transport" value={eur(sel.devisSnapshot.amounts.transport)} /><Ligne label="Taxes" value={eur((sel.devisSnapshot.amounts.om || 0) + (sel.devisSnapshot.amounts.omr || 0) + (sel.devisSnapshot.amounts.tva || 0))} /><Ligne label="Frais" value={eur(sel.devisSnapshot.amounts.fees)} /></>}
      <Ligne label="Total" value={eur(sel.devisTotal)} />
      {frozenLines.length > 0 && <details aria-label="Articles et taux enregistrés"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Articles et taux enregistrés ({frozenLines.length})</summary><ul className="divide-y divide-slate-200">{frozenLines.map((line, index) => <li key={line.id || index} className="space-y-1 py-3"><p className="font-semibold">{line.description}</p>{line.customDuty?.code && <p>{line.customDuty.code} · {line.customDuty.label}</p>}<p>{line.quantity} × {eur(line.unitPrice)} HT</p><p>OM : {line.rates?.om == null ? 'non renseigné' : `${line.rates.om} %`} · OMR : {line.rates?.omr == null ? 'non renseigné' : `${line.rates.omr} %`}</p>{line.customDuty?.overrideReason && <p>Motif de correction : {line.customDuty.overrideReason}</p>}</li>)}</ul><p className="py-2 text-slate-600">Valeurs conservées avec ce devis.</p></details>}
    </div> : <p className="text-sm text-slate-600">Aucun devis en cours n’est enregistré dans ce dossier.</p>;
    // Closed dossiers keep their data available without offering work to restart.
    // These guards precede task prerequisites so cancellation never looks like
    // an outstanding agreement, preparation or payment.
    if (closed) {
      const title = sel.archive ? 'Dossier archivé' : 'Expédition annulée';
      const message = sel.archive ? 'Ce dossier est conservé pour consultation. Aucune préparation ni notification n’est attendue.' : 'Cette expédition a été annulée. Les informations restent consultables ; aucune étape n’est à poursuivre.';
      const content = ['reception','preparation'].includes(task) ? revisionEditor(task)
        : task === 'documents' && canInvoiceWorkspace ? <DossierDocumentsTask key={sel.id} />
        : task === 'devis' && canQuoteWorkspace ? quoteSummary : null;
      return guidance(title, message, null, content);
    }
    if (task === 'documents') return canInvoiceWorkspace
      ? <DossierDocumentsTask key={sel.id} onQuote={canQuoteWorkspace ? () => chooseSection('devis') : undefined}>{continuation}</DossierDocumentsTask>
      : guidance('Factures réservées à l’équipe habilitée', 'Vous n’avez pas accès aux factures de ce dossier. La personne chargée de leur vérification doit terminer cette tâche.', nextUsefulTask === 'documents' ? null : nextUsefulTask);
    if (task === 'reception' && (stage !== 'receptionne' || revisionLockedReason(sel, 'reception'))) return <section className="space-y-4">{revisionEditor('reception')}
      <TaskGuidance title="Réception enregistrée" message="Les mesures des cartons reçus sont conservées. Consultez la suite utile du dossier sans les ressaisir."
        actionLabel={nextUsefulTask !== 'reception' && canViewTask(nextUsefulTask) ? taskLinkLabels[nextUsefulTask] : null}
        onOpen={nextUsefulTask !== 'reception' && canViewTask(nextUsefulTask) ? () => chooseSection(nextUsefulTask) : null} />
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Fournisseurs et suivis des cartons</summary><ReceivedCartons colis={sel} settings={settings} /></details>{continuation}</section>;
    if (task === 'preparation' && (paymentRecorded || inTransport)) return guidance('Préparation terminée', 'Les mesures préparées sont conservées en lecture seule. Le dossier poursuit son règlement ou son transport.', nextUsefulTask, revisionEditor('preparation'));
    if (task === 'preparation' && sel.feuVert !== 'autorise') {
      const receiptNeeded = stage === 'receptionne';
      const message = receiptNeeded ? 'Enregistrez les mesures à réception, puis demandez l’accord du client avant de préparer.'
        : stage === 'mesure' ? 'Les cartons sont mesurés. Demandez maintenant l’accord du client avant de préparer.'
        : stage === 'refuse_client' ? 'Le client a refusé la préparation. La personne qui suit le dossier doit convenir avec lui de la suite.'
        : sel.attenteClientDate ? 'Le client souhaite attendre d’autres cartons. La préparation reste en attente de son accord.'
        : 'La préparation attend l’accord du client. Vous pouvez consulter la demande et les échanges.';
      return guidance('Préparation en attente', message, receiptNeeded ? 'reception' : 'accord', savedWeights ? revisionEditor('preparation') : null);
    }
    if (task === 'preparation' && (!['autorise','en_preparation'].includes(stage) || preparationRevision || sel.devisSnapshot?.inputs || (sel.devisSnapshot && measuresCurrent))) return <section className="space-y-4">
      {!measuresCurrent && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Les mesures de préparation ne sont pas confirmées pour les colis actuels. {canCorrect('perm_colis_preparer') ? 'Utilisez « Modifier » pour vérifier puis enregistrer les colis préparés. Le devis précédent devra être recalculé.' : 'Une personne autorisée à corriger la préparation doit les vérifier et les enregistrer avant le devis.'}</p>}{revisionEditor('preparation')}
      {measuresCurrent && <TaskGuidance title="Préparation enregistrée" message="Les mesures après optimisation sont disponibles pour le devis. Les factures peuvent être vérifiées par un autre membre de l’équipe."
        owner={nextUsefulTask !== task ? taskOwner(nextUsefulTask) : null} actionLabel={nextUsefulTask !== task && canViewTask(nextUsefulTask) ? taskLinkLabels[nextUsefulTask] : null}
        onOpen={nextUsefulTask !== task && canViewTask(nextUsefulTask) ? () => chooseSection(nextUsefulTask) : null} />}{continuation}</section>;
    if (task === 'devis' && !canQuoteWorkspace) return guidance('Devis réservé à l’équipe habilitée', 'Votre rôle ne permet pas de consulter ou d’établir le devis. Une personne chargée du devis doit poursuivre cette tâche.', nextUsefulTask === 'devis' ? null : nextUsefulTask);
    if (task === 'devis' && (paymentRecorded || inTransport)) return guidance('Devis enregistré', 'Ce devis est conservé en lecture seule après le paiement ou le départ.', nextUsefulTask, quoteSummary);
    if (task === 'devis' && ['autorise','en_preparation'].includes(stage) && !measuresCurrent) return guidance('Préparation à terminer avant le devis', `${sel.feuVert === 'autorise' ? 'L’accord du client est reçu. ' : ''}${savedWeights ? 'Les mesures visibles doivent être confirmées pour le nombre actuel de colis préparés.' : 'Il reste à enregistrer les mesures après optimisation et le nombre de colis préparés.'} Cette confirmation est nécessaire avant de calculer le devis.`, sel.feuVert === 'autorise' ? 'preparation' : 'accord');
    // A certified preparation may predate the agreement. Opening the quote is
    // navigation only; its explicit save performs the authorized status change.
    const renderStage = stage === 'autorise' && (task === 'preparation' || measuresCurrent && task === 'devis') ? 'en_preparation' : stage;
    if (task === 'devis' && renderStage === 'en_preparation' && sel.feuVert !== 'autorise') return guidance('Accord attendu avant le devis', 'Les informations préparées sont conservées. L’accord du client doit être confirmé avant d’établir le devis.', 'accord');
    if (task === 'devis' && renderStage === 'en_preparation' && quote.errors.some(error => error.field === 'factures')) return guidance('Factures à vérifier avant le devis', canInvoiceWorkspace ? 'Les mesures de préparation sont enregistrées. Il reste à vérifier les factures pour établir un devis complet.' : 'Les mesures de préparation sont enregistrées. Un membre de l’équipe autorisé à vérifier les factures doit les compléter avant le calcul du devis.', 'documents');
    if (task === 'devis' && renderStage !== 'en_preparation') {
      if (['devis_envoye','attente_paiement'].includes(stage) && Number(sel.devisTotal) > 0) return guidance('Devis enregistré', 'Le devis est enregistré. Consultez le règlement ou reprenez le devis pour le corriger.', 'paiement', <>{quoteSummary}{reopenControl('devis')}</>);
      return guidance('Devis en attente', stage === 'receptionne' ? 'Les mesures à réception doivent être enregistrées avant de demander l’accord du client.' : stage === 'refuse_client' ? 'Le client a refusé la préparation. La suite doit être convenue avec lui avant d’établir le devis.' : 'Le devis attend l’accord du client. Les factures et les mesures déjà enregistrées sont conservées.', stage === 'receptionne' ? 'reception' : 'accord');
    }
    if (task === 'paiement' && !['devis_envoye','attente_paiement'].includes(stage)) {
      if (paymentRecorded || inTransport) return guidance('Paiement confirmé', `${financeVisible ? `Paiement de ${eur(sel.paiementMontant || sel.devisTotal)} reçu.` : 'Paiement reçu.'} Vous pouvez consulter la suite du transport.`, nextUsefulTask);
      const withdrawn = needsQuoteRecalculation(sel);
      return guidance(withdrawn ? 'Devis à reprendre avant le règlement' : 'Règlement à venir', withdrawn ? 'Le devis précédent a été retiré. Aucun règlement n’est attendu pour cette version ; un nouveau devis doit être vérifié puis envoyé.' : 'Le client pourra régler après réception du devis. Consultez ce qu’il reste à préparer.', nextUsefulTask === 'paiement' ? 'devis' : nextUsefulTask);
    }
    if (['expedition','livraison'].includes(task) && !['paye','expedie','transit','dedouanement','arrive','livraison','livre'].includes(stage)) {
      const message = { reception: 'Les cartons doivent être mesurés à réception avant de poursuivre.', accord: 'L’accord du client est attendu avant la préparation.', preparation: 'La préparation et ses mesures doivent être enregistrées avant le devis et le règlement.', documents: 'Les factures doivent être vérifiées avant de terminer le devis.', devis: 'Le devis doit être vérifié et envoyé avant le règlement.', paiement: 'Le règlement du client est attendu avant le départ.' }[nextUsefulTask] || 'Le départ attend la préparation du dossier et la confirmation du règlement.';
      return guidance(task === 'livraison' ? 'Livraison à venir' : 'Expédition en attente', message, nextUsefulTask);
    }
    if (task === 'accord' && !['mesure','attente_feu_vert','refuse_client'].includes(stage)) {
      if (paymentRecorded || inTransport) return guidance('Accord du client — historique', 'Cette étape reste consultable après le règlement ou le départ. Aucun nouvel accord n’est attendu.', nextUsefulTask);
      if (sel.feuVert === 'autorise') return guidance('Accord du client reçu', `Le client a autorisé la préparation${replyDate ? ` le ${replyDate}` : ''}. Les informations déjà enregistrées sont conservées.`, nextUsefulTask,
        reopenControl('accord'));
      return stage === 'receptionne' ? guidance('Accord à demander après la réception', 'Enregistrez les mesures de chaque carton reçu avant de préparer la demande au client.', 'reception')
        : guidance('Accord du client à vérifier', 'L’accord du client n’est pas confirmé. Vérifiez les échanges du dossier avant de préparer une nouvelle demande.', null, <>{onOpenContext && <button className="min-h-11 font-semibold underline" onClick={() => onOpenContext('messages')}>Voir les échanges</button>}{reopenControl('accord')}</>);
    }
    if (task === 'livraison' && ['paye','expedie','transit','dedouanement'].includes(stage)) return guidance('Livraison non commencée', `État actuel : ${STATUTS[sel.statut]?.label}. La livraison sera organisée après l’arrivée à destination.`, 'expedition');
    if (task === 'expedition' && ['arrive','livraison','livre'].includes(stage)) return guidance('Transport arrivé à destination', `Le transport est terminé. ${sel.statut === 'livre' ? 'Les colis ont été remis au client.' : sel.statut === 'livraison' ? 'La livraison au client est en cours.' : 'La livraison au client peut maintenant être organisée.'}`, 'livraison');
    switch (renderStage) {

      // ── 1. RECEPTIONNE ─────────────────────────────────────────────────
      case 'receptionne': {
        const manifest = receptionCartonManifest(sel);
        const boxes = manifest.dimsParColis.map((_, index) => multiDims[index] || {});
        const weights = measureShipment(boxes, divisor);
        const validTariff = tarif && [tarif.base, tarif.parKg].every(value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0);
        const transport = weights && validTariff ? Number(tarif.base) + weights.billableWeight * Number(tarif.parKg) : null;
        return <Section title={`Mesures de réception · ${plural(manifest.nbColis, 'carton')}`} icon={Ruler} color={borderColor}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Mesurez chaque carton tel qu’il est reçu. Après optimisation de l’emballage, de nouvelles dimensions et un nouveau poids seront saisis pour établir le devis.</p>
            {receptionConflict && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Un carton ou ses mesures ont été modifiés depuis votre saisie. Vos valeurs saisies restent affichées.<button type="button" className="min-h-11 block font-semibold underline" onClick={() => { setMultiDims(Object.fromEntries(manifest.dimsParColis.map((box, index) => [index, box]))); receptionVersion.current = sel.updatedAt; receptionDirty.current = false; receptionDrafts.delete(`${auth?.u?.id}:${sel.id}`); setReceptionConflict(false); setFormErr(''); }}>Reprendre les mesures enregistrées</button></div>}
            {manifest.trackingsDetail.map((carton, index) => {
              const box = multiDims[index] || {};
              return <fieldset key={index} className="rounded-xl border border-gray-200 p-3 space-y-3">
                <legend className="px-1 text-sm font-semibold brand-t">Carton {index + 1}{carton.fournisseur ? ` · ${carton.fournisseur}` : ''}{carton.number ? ` · ${carton.number}` : ' · Sans numéro de suivi'}</legend>
                {/* Short visible labels, as in the preparation form: « carton N » stays in the accessible name and in the legend. */}
                <div className="grid grid-cols-2 gap-3">{[['dimL', 'Longueur', 'cm'], ['dimW', 'Largeur', 'cm'], ['dimH', 'Hauteur', 'cm'], ['poids', 'Poids réel', 'kg']].map(([key, label, unit]) => <Field key={key} displayLabel={label} label={`${label} · carton ${index + 1}`} type="number" min="0.01" step="0.01" unit={unit} disabled={actionLoading || !can('perm_colis_mesurer')} value={box[key] ?? ''} onChange={event => { receptionDirty.current = true; setMultiDims(previous => ({ ...previous, [index]: { ...previous[index], [key]: event.target.value } })); }} />)}</div>
              </fieldset>;
            })}
            {weights && <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-1 text-sm">
              <Ligne label="Poids réel total à réception" value={kg(weights.realWeight)} />
              <details><summary className="min-h-11 cursor-pointer py-3 font-semibold text-slate-600">Comprendre le calcul du transport</summary><div className="space-y-1">
                <Ligne label="Poids volumétrique total à réception" value={kg(weights.volumetricWeight)} />
                <Ligne label="Poids facturable avant optimisation" value={kg(weights.billableWeight)} />
                {transport != null ? <Ligne label="Transport avant optimisation, hors taxes et frais" value={eur(transport)} /> : <p className="text-sm text-amber-700">Tarif de destination à renseigner avant toute estimation.</p>}
                <p className="pt-1 text-sm text-gray-500">Le devis utilisera les mesures après regroupement et réemballage, ainsi que les factures vérifiées.</p>
              </div></details>
            </div>}
            <BtnPrimary onClick={() => runAction(handleValiderMesures)} disabled={actionLoading || receptionConflict || !can('perm_colis_mesurer')}><Check size={15} />{actionLoading ? 'Enregistrement…' : 'Enregistrer les mesures de réception'}</BtnPrimary>
            {!can('perm_colis_mesurer') && <p className="text-sm text-slate-600">Une personne autorisée à mesurer doit enregistrer ces cartons. {taskOwner('reception')}</p>}
            {continuation}
          </div>
        </Section>;
      }

      // ── MEASURED AT RECEPTION: request explicit preparation consent ───────
      case 'mesure': {
        const received = receptionCartonManifest(sel).nbColis;
        return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold text-slate-800">Demander l’accord du client</h2><p className="text-sm text-slate-600">{plural(received, 'carton')} {pluralWord(received, 'reçu')} et {pluralWord(received, 'mesuré')} · Casier {sel.casier || 'à renseigner'}</p>{sel.consentRequestVersion > 0 && <p role="status" className="text-sm font-semibold text-slate-700">Nouvelle demande à envoyer. La réponse précédente reste dans l’historique.</p>}<TaskMessage key={`consent-${sel.id}`} template="demande_feu_vert" autoPreview sendLabel="Envoyer la demande d’accord" label="Préparer la demande au client" disabled={actionLoading || !can('perm_colis_demander_feuvert')} beforeSend={options => demanderFeuVert(sel.id, options)} />{continuation}</section>;
      }
      case 'attente_feu_vert': {
        return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold text-slate-800">En attente du client</h2><p className="text-sm text-slate-600">{!!sel.attenteClientDate ? 'Le client souhaite attendre d’autres cartons.' : 'La demande est enregistrée. L’accord du client est attendu.'}</p>{lastRequest && <p className="text-sm text-slate-600">Dernière demande : {lastRequest}</p>}{replyDate && <p className="text-sm text-slate-600">Réponse client : {replyDate}{sel.attenteClientMotif ? ` · ${sel.attenteClientMotif}` : ''}</p>}{sel.attenteClientUntil && <p className="text-sm text-slate-600">Attente demandée jusqu’au {dateLabel(sel.attenteClientUntil)}</p>}{!sel.attenteClientDate && <p className="text-sm text-slate-600">Consultez le dernier échange avant de relancer. La relance reste à votre initiative.</p>}{!sel.attenteClientDate && <TaskMessage key={`consent-${sel.id}`} template="relance_feu_vert" label="Préparer une relance" disabled={!can('perm_colis_demander_feuvert')} />}{onOpenContext && <button className="min-h-11 text-sm font-semibold text-slate-700 underline" onClick={() => onOpenContext('messages')}>Voir les échanges</button>}{sel.attenteClientDate && reopenControl('accord')}{continuation}</section>;
      }
      case 'refuse_client': return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-800">Préparation refusée par le client</h2><p className="text-sm text-slate-600">La préparation reste arrêtée. La personne qui suit le dossier doit convenir avec le client de la suite à donner.</p><p className="text-sm text-slate-600">Suit le dossier : {staffName(sel.responsibleStaffId, teamUsers)}{replyDate ? ` · Refus reçu le ${replyDate}` : ""}</p>{onOpenContext && <button className="min-h-11 font-semibold underline" onClick={() => onOpenContext('messages')}>Ouvrir les échanges</button>}{reopenControl('accord')}{continuation}</section>;

      // ── 5. AUTORISE ────────────────────────────────────────────────────
      case 'autorise': {
        return (
          <Section title="Préparer les colis" icon={Check} color={borderColor}>
            <div className="space-y-3">
              <p className="text-sm text-slate-700">{sel.ref} · {cl?.nom} · Casier {sel.casier || "à renseigner"} · {plural(receptionCartonManifest(sel).nbColis, 'carton')} {pluralWord(receptionCartonManifest(sel).nbColis, 'reçu')}</p>
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

              {sel.notesReception && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">À savoir à réception : {sel.notesReception}</p>}{sel.produitInterdit && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Un produit interdit est signalé. Faites régulariser le dossier avant de préparer.</p>}
              <BtnPrimary
                onClick={() => runAction(async () => { await changerStatut(sel.id, 'en_preparation'); chooseSection('preparation'); })}
                disabled={actionLoading || subExpired || sel.produitInterdit || !can('perm_colis_preparer')}>
                <Check size={15} />
                {actionLoading ? 'En cours...' : 'Commencer la préparation'}
              </BtnPrimary>
              {!can('perm_colis_preparer') && <p className="text-sm text-slate-600">La préparation doit être effectuée par une personne habilitée. {taskOwner('preparation')} Les factures peuvent être vérifiées en parallèle.</p>}
              {!can('perm_colis_preparer') && canInvoiceWorkspace && <button className="min-h-11 font-semibold underline" onClick={() => chooseSection('documents')}>Ouvrir les factures</button>}
              {continuation}
            </div>
          </Section>
        );
      }

      // ── 6. EN_PREPARATION ─────────────────────────────────────────────
      case 'en_preparation': {
        const normalizeBoxes = boxes => JSON.stringify(boxes.map(box => Object.fromEntries(['dimL','dimW','dimH','poids'].map(key => [key,Number(box[key])]))));
        const measuresChanged = normalizeBoxes(finalPackages) !== normalizeBoxes(savedFinalPackages(sel));
        const verified = !pendingFee && !customsDirty && !measuresChanged && !preparationConflict && quote.ok
          && (devisPrev === null ? canReviewSavedQuote(sel, quote) : devisPrev && savedInputs === quoteInputFingerprint(quote.snapshot));
        const blockerAction = ({ field, message }) => {
          if (field.startsWith('dimensions')) return () => chooseSection('preparation');
          if (field.includes('customs') || field.includes('customDuty')) return () => { document.getElementById('quote-customs')?.scrollIntoView({ block: 'start' }); document.getElementById('quote-customs')?.focus({ preventScroll: true }); };
          if (field.startsWith('fraisDivers')) return () => document.getElementById('quote-fees')?.scrollIntoView({ block: 'start' });
          if (field === 'factures' || field.startsWith('lignes') || field.startsWith('lines')) return canInvoiceWorkspace ? () => chooseSection('documents', field === 'factures' ? 'quote-documents' : 'quote-unlinked') : null;
          if (field === 'dossier') return sel.feuVert !== 'autorise' ? () => chooseSection('accord') : onOpenContext ? () => onOpenContext('reception') : null;
          if (field === 'tarif') return can('perm_finances_modifier_tarifs') ? () => navigate('/settings?tab=tarifs') : null;
          if (field === 'settings') return can('perm_admin_parametres') ? () => navigate('/settings?tab=metier') : null;
          if ((field === 'client' || field === 'destination') && !message.includes('TVA')) return can('perm_clients_voir') && can('perm_clients_modifier') ? () => navigate(`/clients/${sel.clientId}`) : null;
          return null;
        };
        const preparationBlock = sel.archive ? 'Désarchivez le dossier avant de poursuivre sa préparation.' : sel.produitInterdit ? 'Un produit interdit est signalé : faites vérifier le dossier avant de poursuivre.' : sel.feuVert !== 'autorise' ? 'Le feu vert du client doit être enregistré avant de poursuivre la préparation.' : null;
        const weights = measureShipment(finalPackages, divisor);
        const isPro = cl?.type === 'pro';
        const inputClass = 'min-h-11 min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
        const changeFinal = (index, key, value) => { preparationDirty.current = true; setFinalPackages(previous => previous.map((box,position) => position === index ? { ...box, [key]: value } : box)); setMeasuresSaved(false); setDevisPrev(false); };
        const receivedCount = receptionCartonManifest(sel).nbColis;
        // Full width, like every other step of the dossier.
        if (preparationView) return <section id="preparation-workspace" aria-label="Préparation après optimisation" className="w-full min-w-0 scroll-mt-48 space-y-5">
          <div><h2 className="text-lg font-bold text-slate-800">Optimiser et mesurer les colis</h2><p className="mt-1 text-sm text-slate-600">{plural(receivedCount, 'carton')} {pluralWord(receivedCount, 'reçu')} · {finalPackages.length} colis {pluralWord(finalPackages.length, 'préparé')} · Casier {sel.casier || "à renseigner"}</p></div>
          {(preparationEditing || measuresChanged || !savedWeights || !measuresCurrent) && <div id="quote-measures" className="scroll-mt-24"><Section title="Mesures après optimisation" icon={Ruler} color={borderColor}>
            <p className="mb-3 text-sm text-slate-600">Après regroupement et réemballage, mesurez et pesez chaque colis prêt à partir. Les mesures des cartons reçus sont conservées séparément.</p>
            {preparationBlock && <p role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{preparationBlock}</p>}
            {preparationConflict && <div role="alert" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>Une autre modification a été enregistrée depuis l’ouverture de votre saisie. Votre brouillon est conservé ; aucune mesure ne sera écrasée.</p>
              {preparationConflictNotice}
              {preparationConflictReady && <><p className="mt-2">Version enregistrée : {savedFinalPackages(sel).map((box,index) => `colis ${index + 1} : ${box.dimL || '—'} × ${box.dimW || '—'} × ${box.dimH || '—'} cm / ${kg(box.poids)}`).join(' ; ')}</p><div className="mt-2 space-y-2">{canKeepPreparationDraft && <><p>Les mesures enregistrées et la composition des cartons sont inchangées. Vous pouvez conserver votre saisie et reprendre sur la nouvelle version du dossier.</p><button className="min-h-11 block font-semibold underline" onClick={keepPreparationDraft}>Conserver ma saisie et réessayer</button></>}<button className="min-h-11 block font-semibold underline" onClick={reloadPreparation}>Recharger et remplacer mon brouillon</button></div></>}
            </div>}
            {sel.preparationCompositionVersion != null && sel.finalMeasurementsVersion != null && sel.finalMeasurementsVersion !== sel.preparationCompositionVersion ? <p role="status" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">La composition des cartons a changé. Mesurez à nouveau l’ensemble préparé puis enregistrez les mesures pour confirmer cette nouvelle préparation.</p> : !measuresCurrent && savedWeights && <p role="status" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Les mesures visibles ne sont pas encore confirmées pour le nombre actuel de colis préparés. Vérifiez chaque colis puis enregistrez les mesures pour terminer la préparation.</p>}
            <div className="space-y-3">{finalPackages.map((box,index) => <fieldset key={index} className="rounded-xl border border-slate-200 p-3"><legend className="px-1 text-sm font-semibold text-slate-700">Colis préparé {index + 1}</legend><div className="grid grid-cols-2 gap-3">{[['dimL', 'Longueur', 'cm'], ['dimW', 'Largeur', 'cm'], ['dimH', 'Hauteur', 'cm'], ['poids', 'Poids réel', 'kg']].map(([key,label,unit]) => <Field key={key} displayLabel={label} label={`${label} · colis sortant ${index + 1}`} type="number" min="0.01" step="0.01" disabled={actionLoading || !!preparationBlock || !can('perm_colis_preparer')} value={box[key] ?? ''} onChange={event => changeFinal(index,key,event.target.value)} unit={unit} />)}</div>{finalPackages.length > 1 && <button disabled={actionLoading || !!preparationBlock || !can('perm_colis_preparer')} className="min-h-11 text-sm font-semibold text-red-700 disabled:opacity-40" onClick={() => { preparationDirty.current = true; setFinalPackages(previous => previous.filter((_,position) => position !== index)); setDevisPrev(false); }}>Retirer le colis sortant {index + 1}</button>}</fieldset>)}</div>
            <button disabled={actionLoading || !!preparationBlock || !can('perm_colis_preparer')} className="my-3 min-h-11 w-full rounded-xl border border-dashed border-slate-300 text-sm font-semibold brand-t disabled:opacity-40" onClick={() => { preparationDirty.current = true; setFinalPackages(previous => [...previous,{dimL:'',dimW:'',dimH:'',poids:''}]); setDevisPrev(false); }}>+ Ajouter un colis après optimisation</button>
            <div ref={preparationFeedback} tabIndex={-1} className="scroll-mt-32">{formErr && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{formErr}</p>}
            {!weights && <p className="mb-2 text-sm text-amber-800">Renseignez les trois dimensions et un poids positif pour chaque colis sortant avant d’enregistrer.</p>}
            <BtnPrimary disabled={actionLoading || !!preparationBlock || preparationConflict || !weights || !can('perm_colis_preparer')} onClick={() => runAction(handleSaveMeasurements)}><Check size={16} />Enregistrer l’optimisation</BtnPrimary>
            {!can('perm_colis_preparer') && <p className="mt-2 text-sm text-slate-600">Les mesures sont enregistrées par une personne habilitée à préparer. Les factures peuvent être vérifiées en parallèle, selon vos droits. Le devis attend les mesures enregistrées et les factures vérifiées.</p>}
            <p role="status" className="mt-2 text-xs text-slate-600">{measuresSaved ? 'Mesures enregistrées.' : ''}</p></div>
            {weights && <details className="mt-4 border-t border-gray-100 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-semibold text-slate-600">Comprendre le calcul du transport</summary><div className="space-y-1"><Ligne label="Poids volumétrique" value={kg(weights.volumetricWeight)} /><Ligne label="Poids facturable" value={kg(weights.billableWeight)} /></div></details>}
          </Section></div>}
          {!preparationEditing && !measuresChanged && savedWeights && measuresCurrent && <section ref={preparationFeedback} tabIndex={-1} aria-label="Relais après préparation" className="scroll-mt-56 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-800">Optimisation enregistrée · {savedFinalPackages(sel).length} colis {pluralWord(savedFinalPackages(sel).length, 'sortant')} · {kg(savedWeights.realWeight)}</p>{sel.finalMeasurementsAt && <p className="text-xs text-slate-600">Mesures enregistrées le {dateLabel(sel.finalMeasurementsAt)}</p>}
            <p className="text-sm text-slate-700">{savedFinalPackages(sel).map((box,index) => `Colis ${index + 1} : ${box.dimL} × ${box.dimW} × ${box.dimH} cm · ${kg(box.poids)}`).join(' ; ')}</p>
            <p className="text-sm text-slate-700">{nextUsefulTask === 'documents' ? 'Prochaine étape : vérifier les factures d’achat pour calculer le montant à payer.' : 'Prochaine étape : préparer le montant à payer par le client.'} {taskOwner(nextUsefulTask)}</p>
            {nextUsefulTask !== task && canViewTask(nextUsefulTask) && <BtnPrimary onClick={() => chooseSection(nextUsefulTask)}>{nextUsefulTask === 'documents' ? 'Vérifier les factures d’achat' : taskLinkLabels[nextUsefulTask]}</BtnPrimary>}
            {can('perm_colis_preparer') && !preparationBlock && !preparationEditing && <button className="min-h-11 text-sm font-semibold text-slate-700 underline" onClick={() => setPreparationEditing(true)}>Modifier les mesures</button>}
            {continuation}
          </section>}
          {can('perm_colis_preparer') && !preparationBlock && <>
          <details className="border-t border-slate-200"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Consignes facultatives {selTags.length > 0 ? `· ${plural(selTags.length, 'choisie')}` : ''}</summary>          <div className="space-y-2">
            <p className="text-xs text-slate-600">Les étiquettes s’enregistrent dès le clic. Le commentaire s’enregistre avec « Enregistrer la consigne » ; les mesures ont leur propre bouton.</p>
            <div className="flex flex-wrap gap-2">{TAGS_PREPARATION.map((tag) => <button key={tag} disabled={actionLoading} onClick={() => runAction(async () => { const next = selTags.includes(tag) ? selTags.filter((item) => item !== tag) : [...selTags, tag]; await upd(sel.id, { tagsPreparation: next }); setSelTags(next); })} className={`min-h-11 rounded-full px-3 py-2 text-xs font-semibold ${selTags.includes(tag) ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{tag}</button>)}</div>
            <textarea disabled={actionLoading} aria-label="Commentaire de préparation" value={commentaire} onChange={(event) => { const value = event.target.value; setCommentaire(value); commentDirty.current = value !== (sel.commentairePreparation || ""); if(commentDirty.current) preparationCommentDrafts.set(`${auth?.u?.id}:${sel.id}`, value); else preparationCommentDrafts.delete(`${auth?.u?.id}:${sel.id}`); }} placeholder="Instructions utiles à la préparation…" rows={2} className={inputClass} />
            {commentaire !== (sel.commentairePreparation || '') && <button disabled={actionLoading} className="min-h-11 text-xs font-semibold text-blue-700" onClick={() => runAction(async () => { await upd(sel.id, { commentairePreparation: commentaire }); preparationCommentDrafts.delete(`${auth?.u?.id}:${sel.id}`); commentDirty.current = false; flash("Consigne enregistrée."); })}>Enregistrer la consigne</button>}
          </div>
</details>
          <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Photo du colis préparé</summary><p className="mb-2 text-xs text-slate-600">La photo s’enregistre séparément après sa confirmation.</p><WebcamCapture colisId={sel.id} colisRef={sel.ref} existingUrl={sel.photoPrep} onCapture={(path) => runAction(() => upd(sel.id, { photoPrep: path }))} /></details>
          </>}
        </section>;
        // Full width like the other steps. « À compléter » is said once, here: the
        // action bar below names what blocks instead of repeating it.
        return <div className="w-full min-w-0 space-y-5">
          <div><h2 className="text-lg font-bold text-slate-800">{verified ? 'Vérifier et envoyer le devis' : 'Établir le devis'}</h2><p className="mt-1 text-sm text-slate-600">{verified ? 'Le devis est enregistré. Vérifiez le montant et le destinataire avant de l’envoyer.' : 'Complétez le devis, puis enregistrez-le pour vérifier le montant avant l’envoi.'}</p></div><div aria-label="Résumé du devis" className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">{verified ? "Brouillon enregistré" : quote.ok ? "Estimation · prête à vérifier" : "Montant du devis"}</p><p className="text-2xl font-bold text-slate-800">{quote.ok ? eur(quote.amounts.total) : "À compléter"}</p><p className="text-xs text-slate-600">{verified ? "Version enregistrée, non envoyée au client." : quote.ok ? "Calcul actuel non enregistré." : "Les points à résoudre sont listés ci-dessous."}</p></div>
          {preparationConflict && <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p>Le dossier a été modifié depuis votre saisie. Votre brouillon est conservé ; reprenez la version partagée avant d’enregistrer le devis.</p>
            {preparationConflictNotice}
            {preparationConflictReady && <><p>Frais enregistrés : {(sel.fraisDivers || []).length ? sel.fraisDivers.map(fee => `${fee.libelle} · ${eur(fee.montant)}`).join(' ; ') : 'aucun'}.</p>
            {canKeepPreparationDraft && <><p>Les mesures et les cartons sont inchangés. Vous pouvez conserver vos frais puis vérifier le nouveau calcul.</p><button className="min-h-11 block font-semibold underline" onClick={keepPreparationDraft}>Conserver mes frais et recalculer</button></>}
            <button className="min-h-11 block font-semibold underline" onClick={reloadPreparation}>Recharger et remplacer mon brouillon</button></>}
          </div>}
          {!verified && <>
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-y border-slate-200 py-3 text-sm" aria-label="Éléments du devis">
            <button className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-slate-700 underline" onClick={() => chooseSection('preparation')}>{savedWeights && measuresCurrent ? <>Préparation enregistrée<Check size={16} aria-hidden="true" /></> : 'Préparation à terminer'}</button>
            {canInvoiceWorkspace && <button className="min-h-11 font-semibold text-slate-700 underline" onClick={() => chooseSection('documents')}>{plural(currentInvoices(sel.factures || []).filter(invoice => invoice.valide).length, 'facture vérifiée', 'factures vérifiées')}</button>}
          </div>
          {measuresChanged && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Un brouillon de mesures reste à enregistrer. <button className="min-h-11 font-semibold underline" onClick={() => chooseSection('preparation')}>Reprendre la préparation</button></p>}
          {!quote.ok && <div className="rounded-xl bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-800">À résoudre avant le devis</p><ul className="mt-2 space-y-1 text-sm text-amber-800">{[...new Map(quote.errors.map(error => [error.message,error])).values()].map((error, index) => {
            const action = blockerAction(error);
            return <li key={index}>{action ? <button className="min-h-11 text-left underline underline-offset-2" onClick={action}>{error.message}</button> : <p className="py-2">{error.message} Une personne habilitée doit corriger ce point avant le devis.</p>}</li>;
          })}</ul></div>}
          {(sel.lignes || []).some(line => !line.factureId) && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Articles manuels inclus : {eur((sel.lignes || []).filter(line => !line.factureId).reduce((total,line) => total + Number(line.qte) * Number(line.prix),0))} HT. {canInvoiceWorkspace ? <button className="min-h-11 font-semibold underline" onClick={() => chooseSection('documents','quote-unlinked')}>Vérifier les articles manuels</button> : "La vérification de ces articles est réservée à une personne habilitée à consulter les factures."}</p>}
          {isPro && <label className="block space-y-2 text-xs font-semibold text-slate-600">Modalités de règlement convenues<select aria-label="Modalités de règlement professionnel" disabled={actionLoading || !canCalculateQuote} value={proPayMethod} onChange={(event) => { preparationDirty.current = true; setProPayMethod(event.target.value); setDevisPrev(false); }} className={inputClass}>{[['virement', 'Virement bancaire'], ['especes', 'Espèces'], ['30_jours', 'Paiement à 30 jours'], ['fin_de_mois', 'Paiement en fin de mois']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="block text-xs font-normal text-gray-500">Cette modalité figurera dans la version du devis. Le paiement sera confirmé séparément après réception du règlement.</span></label>}
          {customsPanel}
          <div id="quote-fees" className="scroll-mt-24 space-y-2 border-t border-gray-200 pt-4"><p className="text-xs font-semibold text-slate-600">Frais convenus</p>{fraisDivers.map((fee, index) => <div key={index} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 break-words">{fee.libelle}</span><strong>{eur(fee.montant)}</strong>{canCalculateQuote && <button aria-label={`Retirer ${fee.libelle}`} disabled={actionLoading} className="flex min-h-11 min-w-11 items-center justify-center text-gray-400" onClick={() => runAction(async () => { const next = fraisDivers.filter((_, position) => position !== index); preparationDirty.current = true; setFraisDivers(next); setDevisPrev(false); })}><X size={14} /></button>}</div>)}
            {canCalculateQuote && <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Ajouter un frais</summary><form className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2" onSubmit={(event) => { event.preventDefault(); runAction(async () => { const amount = Number(newFraisMontant); if (!newFraisLibelle.trim() || newFraisMontant === '' || !Number.isFinite(amount) || amount < 0) throw new Error('Indiquez le libellé et un montant positif ou nul.'); const next = [...fraisDivers, { libelle: newFraisLibelle.trim(), montant: amount }]; preparationDirty.current = true; setFraisDivers(next); setNewFraisLibelle(''); setNewFraisMontant(''); setDevisPrev(false); }); }}><input aria-label="Libellé du frais" required value={newFraisLibelle} onChange={(event) => setNewFraisLibelle(event.target.value)} placeholder="Libellé du frais" className={inputClass} /><input aria-label="Montant du frais" required type="number" min="0" step="0.01" value={newFraisMontant} onChange={(event) => setNewFraisMontant(event.target.value)} placeholder="€" className={inputClass} /><button disabled={actionLoading} className="col-span-2 min-h-11 rounded-xl bg-slate-100 text-xs font-semibold text-slate-700">Ajouter le frais</button>{pendingFee && <button type="button" className="col-span-2 min-h-11 text-sm font-semibold text-slate-600 underline" onClick={() => { setNewFraisLibelle(''); setNewFraisMontant(''); }}>Annuler ce frais</button>}</form></details>}
            {!canCalculateQuote && <p className="text-sm text-slate-600">Les frais{isPro ? " et les modalités de règlement" : ""} sont consultables. Leur modification doit être enregistrée par une personne chargée du calcul du devis.</p>}
          </div>
          </>}
          {subExpired && <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700">Abonnement expiré : régularisez l’offre du client avant l’envoi.</p>}

          {quote.ok && quote.warnings.length > 0 && <div className="space-y-1 rounded-xl bg-amber-50 p-3">{quote.warnings.map((warning, index) => <p key={index} className="text-xs text-amber-800">{warning}</p>)}</div>}
          {verified && !isPro && <details className="rounded-xl border border-slate-200 bg-white px-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Articles et taux retenus ({quote.snapshot.inputs.lines.length})</summary><p className="pb-2 text-sm text-slate-600">Le transport est réparti selon la valeur des articles : quantité × prix unitaire HT. Les taux OM et OMR de chaque article s’appliquent à sa valeur augmentée de sa part de transport. Les montants affichés sont arrondis ; le calcul conserve les décimales.</p><ul className="divide-y divide-slate-200 pb-3 text-sm">{quote.amounts.taxLines.map((line, index) => <li key={line.id || index} className="space-y-1 py-3"><p className="font-semibold text-slate-800">{line.description}</p><p>{line.quantity} × {eur(line.unitPrice)} HT · Marchandise : {eur(line.value)}</p><p className="text-slate-600">Part de transport : {eur(line.transportShare)} · Base OM / OMR : {eur(line.cif)}</p><p className="text-slate-600">{line.customDuty ? `${line.customDuty.code} · ${line.customDuty.label}` : line.categoryLabel} · OM {line.rates.om} % · OMR {line.rates.omr} %</p>{line.customDuty?.overrideReason && <p className="text-slate-600">Taux corrigés : {line.customDuty.overrideReason}</p>}</li>)}</ul></details>}
          {quote.ok && <Section title={verified ? 'Brouillon enregistré · vérifier puis envoyer' : 'Estimation du devis'} icon={Eye}>
            <div className="space-y-2 text-sm"><Ligne label="Transport" value={eur(quote.amounts.transport)} />{!isPro && <><Ligne label="Taxes" value={eur(quote.amounts.om + quote.amounts.omr + quote.amounts.tva)} /><details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Détail des taxes</summary><Ligne label="Octroi de mer" value={eur(quote.amounts.om)} /><Ligne label="Octroi de mer régional" value={eur(quote.amounts.omr)} /><Ligne label={`TVA (${dest.tva} %)`} value={eur(quote.amounts.tva)} /></details></>}<Ligne label="Frais convenus" value={eur(quote.amounts.fees)} />{verified && fraisDivers.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Détail des frais</summary>{fraisDivers.map((fee, index) => <Ligne key={index} label={fee.libelle} value={eur(fee.montant)} />)}</details>}{quote.patch.economie > 0 && <Ligne label="Économie après optimisation" value={eur(quote.patch.economie)} />}</div>
          </Section>}
          <div id="quote-review" tabIndex={-1} data-testid="quote-action-bar" className={`${customsDirty ? 'lg:sticky' : 'sticky'} bottom-16 z-10 -mx-1 scroll-mt-48 border-t border-slate-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-3px_12px_rgba(0,0,0,0.06)] lg:bottom-0`}>
            <div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-600">Total à régler</p><p className="text-lg font-bold text-slate-800">{quote.ok ? eur(quote.amounts.total) : 'Non calculé'}</p></div><p role="status" className="max-w-[60%] text-right text-xs text-slate-600">{actionLoading ? 'Enregistrement en cours…' : verified ? 'Brouillon enregistré · vérifiez le détail avant envoi' : !quote.ok ? 'Points à résoudre avant l’enregistrement' : sel.devisBrouillon ? 'Modifications à enregistrer et vérifier' : 'Calcul non enregistré'}</p></div>
          {customsDirty && <p className="mb-2 text-sm font-semibold text-amber-800">Terminez le classement douanier avant d’enregistrer le devis.</p>}
          {!verified && !can('perm_colis_calculer_devis') && <p className="mb-2 text-sm text-slate-700">Une personne chargée du calcul doit vérifier et enregistrer ce devis avant son envoi.</p>}
          {pendingFee && <p role="status" className="mb-2 text-sm font-semibold text-amber-800">Un frais est en cours de saisie. <button className="min-h-11 underline" onClick={() => { document.getElementById('quote-fees')?.querySelector('details')?.setAttribute('open', ''); document.querySelector('#quote-fees input')?.focus(); }}>Terminer ou annuler ce frais</button></p>}
          {!verified ? <BtnPrimary onClick={() => runAction(handleEnvoyerDevis)} disabled={pendingFee || customsDirty || !quote.ok || measuresChanged || preparationConflict || actionLoading || subExpired || !can('perm_colis_calculer_devis')}><Eye size={16} />{actionLoading ? 'Enregistrement…' : 'Enregistrer et vérifier le devis'}</BtnPrimary> : <div className="space-y-2"><p className="text-sm text-slate-700">Pour {cl?.nom} · {eur(sel.devisTotal)} · {cl?.telegramChatId ? "Telegram" : `Email : ${cl?.email || "à renseigner"}`}{isPro ? ` · ${{virement:"Virement bancaire",especes:"Espèces","30_jours":"Paiement à 30 jours",fin_de_mois:"Paiement en fin de mois"}[proPayMethod]}` : " · Règlement avant départ"}</p><BtnPrimary onClick={() => runAction(handleConfirmDevisEnvoye)} disabled={customsDirty || actionLoading || preparationConflict || !quote.ok || subExpired || !can('perm_colis_envoyer_devis')}><Send size={16} />{actionLoading ? 'Envoi en cours…' : 'Envoyer le devis au client'}</BtnPrimary>{can('perm_colis_calculer_devis') && <button className="min-h-11 w-full rounded-xl border border-gray-200 text-sm font-semibold text-gray-600" onClick={() => setDevisPrev(false)}>Modifier le brouillon</button>}</div>}
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
              {financeVisible ? <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-xs font-bold text-amber-700 mb-1">Montant à payer</p>
                <p className="text-2xl font-black" style={{ color: 'var(--brand-text)' }}>
                  {eur(sel.devisTotal)}
                </p>
              </div> : <p className="text-sm text-slate-600">Le devis est envoyé : le règlement du client est attendu. Le montant est réservé aux personnes habilitées aux devis et aux paiements.</p>}
              {sel.devisEnvoyeLe && <p className="text-sm text-slate-600">Devis envoyé le {dateLabel(sel.devisEnvoyeLe)}</p>}
              {isPro ? (
                <>
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <p className="text-xs font-bold text-blue-800 mb-1">
                      Client professionnel — {PAY_METHODS[sel.modePaiementPro] || 'Modalité à vérifier dans le devis'}
                    </p>
                  </div>
                  {["30_jours", "fin_de_mois"].includes(sel.modePaiementPro) && <p className="text-sm text-slate-600">Date exacte d’échéance : à confirmer dans les échanges convenus avec le client. Elle n’est pas enregistrée séparément dans ce dossier.</p>}
                  <p className="text-xs text-gray-500">Les modalités sont celles du devis envoyé. Pour les modifier, utilisez les corrections autorisées du devis puis établissez une nouvelle version.</p>
                  <BtnPrimary
                    onClick={() => ask('Confirmer le règlement reçu ?', `${sel.ref} · ${cl?.nom} · ${eur(sel.devisTotal)} · ${PAY_METHODS[sel.modePaiementPro] || 'Mode à vérifier'}. Confirmez uniquement après réception effective du règlement. Aucun encaissement bancaire n’est déclenché.`, () => runAction(() => payer(sel.id, sel.devisTotal)), { okLabel: 'Confirmer le paiement reçu' })}
                    disabled={actionLoading || !sel.devisTotal || !can('perm_colis_confirmer_paiement')}
                  >
                    <Check size={15} />
                    Confirmer réception du paiement
                  </BtnPrimary>
                </>
              ) : (
                <div className="space-y-2">
                  {!sel.payplugPaymentUrl && <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>Le lien de paiement n’est pas disponible. La personne chargée du devis doit le vérifier avant de relancer le client.</p>{canQuoteWorkspace && <button className="min-h-11 font-semibold underline" onClick={() => chooseSection('devis')}>Ouvrir le devis</button>}</div>}
                  {/* Lien de paiement PayPlug */}
                  {sel.payplugPaymentUrl && (
                    <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 space-y-2">
                      <p className="text-[10px] font-bold text-blue-700 uppercase">Lien de paiement</p>
                      <a href={sel.payplugPaymentUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline">Ouvrir le lien de paiement</a><button className="min-h-11 px-3 text-sm font-semibold text-blue-700 underline" onClick={async () => { try { await navigator.clipboard.writeText(sel.payplugPaymentUrl); setPaymentFeedback("Lien de paiement copié."); } catch { setPaymentFeedback("Copie impossible. Ouvrez le lien pour le copier depuis votre navigateur."); } }}>Copier le lien de paiement</button>{paymentFeedback && <p role="status" className="text-sm text-slate-600">{paymentFeedback}</p>}
                    </div>
                  )}
                  {sel.payplugPaymentUrl && <TaskMessage template="relance_paiement" label="Préparer une relance de paiement" />}
                </div>
              )}
              {isPro && !can('perm_colis_confirmer_paiement') && <p className="text-sm text-slate-600">Une personne autorisée à confirmer les règlements doit enregistrer le paiement reçu. La consultation ne confirme aucun paiement.</p>}
              {continuation}
            </div>
          </Section>
        );
      }

      // ── 9. PAYE ────────────────────────────────────────────────────────
      case 'paye': {
        // The server's rule (guard_colis_departure), on Paris days: the paid quote fixes the destination,
        // a departure without loading closing stays open until its day.
        const availableEnvois = plannedDeparturesFor(sel, cl, envois);
        const assigned = envois.find(departure => departure.id === sel.envoi);
        const assignmentIssue = sel.envoi ? departureIssue(assigned, sel, cl) : null;
        // The field's own rule; while a colleague holds the task, the banner above says so.
        const canAssign = departureFieldEditable(sel, can);
        const assignRight = can(sel.envoi ? 'perm_envois_reaffecter' : 'perm_colis_affecter_envoi');
        return (
          <Section title="Paiement reçu — Expédier" icon={Check} color={borderColor}>
            <div className="space-y-4">
              {/* « Paiement reçu » is a fact for everyone; its amount follows the finance rule of the Devis and Paiement steps. */}
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200" data-testid="payment-received">
                <p className={financeVisible ? 'text-xs font-bold text-emerald-700 mb-1' : 'text-sm font-bold text-emerald-700'}>Paiement reçu</p>
                {financeVisible && <p className="text-2xl font-black text-emerald-700">
                  {eur(sel.paiementMontant || sel.devisTotal)}
                </p>}
              </div>

              {/* The same « Départ » field as the overview: after the end of the
                  subscription the choice is confirmed first; cancelling writes nothing. */}
              <DossierDeparture variant="task" can={can} />

              {canAssign && !readOnly && <p className="text-xs text-slate-600">{can('perm_envois_creer') ? 'Un départ choisi est enregistré aussitôt, sans message au client. Un jour sans départ vous propose d’en créer un. Si une confirmation est nécessaire (nouveau départ à la place de celui du dossier, par exemple), elle vous est demandée avant.' : 'Un départ choisi est enregistré aussitôt, sans message au client. Si une confirmation est nécessaire, elle vous est demandée avant.'}</p>}
              {assignmentIssue && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Affectation à revoir : {assignmentIssue}. Choisissez un départ compatible avant le chargement.</p>}
              {!canAssign && !readOnly && <p className="text-sm text-slate-600">{assignRight ? 'Le choix du départ demande l’accès aux départs.' : `L’affectation est modifiable par une personne habilitée ${sel.envoi ? 'à réaffecter les départs' : 'à affecter les expéditions'}.`}</p>}
              {!availableEnvois.length && <p className="text-sm text-slate-600">Aucun départ ouvert compatible avec la destination du devis payé. La coordination doit prévoir le prochain départ.{can("perm_envois_creer") && <button className="min-h-11 block font-semibold underline" onClick={() => navigate("/departs")}>Ouvrir les départs pour en créer un</button>}</p>}
              {subExpired && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-300">
                  <AlertTriangle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs font-bold text-red-800">
                    Abonnement expiré — expédition bloquée.
                  </p>
                </div>
              )}

              <BtnPrimary
                onClick={() => navigate(`/departs?envoi=${encodeURIComponent(sel.envoi)}`)}
                disabled={!sel.envoi || !!assignmentIssue || subExpired || !can('perm_envois_voir')}
              >
                <Check size={15} />
                Vérifier le départ et son manifeste
              </BtnPrimary>
              {!can('perm_envois_voir') && <p className="text-sm text-slate-600">L’équipe chargée des départs doit vérifier le manifeste avant l’expédition.</p>}
              {continuation}
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
              >
                <Check size={15} />
                Confirmer l'arrivée à destination
              </BtnPrimary>
              {!can('perm_colis_changer_statut_expedition') && <p className="text-sm text-slate-600">L’équipe chargée du transport enregistrera l’arrivée une fois le dédouanement terminé.</p>}
              {continuation}
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
          <Section title={task === 'livraison' ? 'Suivi de livraison' : 'Suivi du transport'} icon={Check} color={borderColor}>
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
                    >
                      <Clock size={15} />
                      Passer en dédouanement
                    </BtnPrimary>
                    <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Autre situation de transport</summary><button className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold" disabled={actionLoading || !can('perm_colis_changer_statut_expedition')} onClick={() => runAction(() => changerStatut(sel.id, 'arrive'))}>Arrivé directement (sans dédouanement)</button></details>
                  </>
                ) : (
                  nextStatuts.map((ns) => {
                    return (
                      <BtnPrimary
                        key={ns}
                        disabled={actionLoading || !can('perm_colis_changer_statut_expedition')}
                        onClick={() => ns === 'livre' ? ask('Confirmer la livraison ?', `${sel.ref} · ${cl?.nom}. Confirmez que tous les colis préparés de cette expédition ont été remis au client. La date de livraison sera enregistrée.`, () => runAction(() => changerStatut(sel.id, ns)), { okLabel: 'Confirmer la livraison' }) : runAction(() => changerStatut(sel.id, ns))}
                      >
                        <Check size={15} />
                        {{ transit: 'Confirmer le départ en vol', arrive: 'Confirmer l’arrivée à destination', livraison: 'Lancer la livraison', livre: 'Confirmer la livraison' }[ns] || STATUTS[ns]?.label}
                      </BtnPrimary>
                    );
                  })
                )}
              </div>
              {!can('perm_colis_changer_statut_expedition') && <p className="text-sm text-slate-600">{task === 'livraison' ? 'La personne chargée de la livraison' : 'L’équipe chargée du transport'} enregistrera la prochaine étape. Vous pouvez consulter le suivi sans le modifier.</p>}
              {trackingSteps[currentIdx]?.tpl && <TaskMessage key={sel.statut} template={trackingSteps[currentIdx].tpl} label="Préparer une information au client" />}
              {continuation}
            </div>
          </Section>
        );
      }

      case 'livre': return <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="text-lg font-bold text-emerald-800">Livraison terminée</h2><p className="text-sm text-slate-700">Le dossier est livré{sel.dateLivraison ? ` depuis le ${dateLabel(sel.dateLivraison)}` : ""}. Les documents et les échanges restent consultables dans les détails du dossier.</p>{continuation}</section>;
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
    <div className="dossier-task min-w-0 flex flex-col gap-4 pb-24 lg:pb-4">
      {formErr && !(preparationView && (sel.statut === 'en_preparation' || needsQuoteRecalculation(sel))) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{formErr}</p>}

      {/* ── Action block ───────────────────────────────────────────────── */}
      {renderActionBlock()}
      {!sel.archive && ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement'].includes(sel.statut) && can('perm_colis_receptionner') && <button type="button" onClick={() => navigate(`/reception?${new URLSearchParams({ dossier: sel.id, returnTo: location.pathname + location.search })}`)} className="min-h-11 flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold brand-t"><Plus size={16} />Réceptionner un autre carton</button>}

      {/* ── Corrections (collapsible, discreet) ──────────────────────── */}
      {(canRevert || canCancel || canArchive) && (
        <div>
          <button
            onClick={() => setShowCorrections((p) => !p)}
            className="min-h-11 flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-600 transition-colors"
          >
            <RotateCcw size={11} />
            {showCorrections ? 'Masquer les corrections' : 'Corrections'}
          </button>
          {showCorrections && (
            <div className="flex gap-2 flex-wrap mt-2 anim-fade">
              {canRevert && (
                <button
                  onClick={handleRevert}
                  className="min-h-11 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100 transition-colors"
                >
                  <RotateCcw size={11} />
                  Corriger l’étape vers {correctionLabel}…
                </button>
              )}
              {canCancel && (
                <button
                  onClick={handleCancel}
                  className="min-h-11 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-colors"
                >
                  <X size={11} />
                  Annuler l’expédition…
                </button>
              )}
              {canArchive && (sel.archive ? (
                <button
                  onClick={() => runAction(() => desarchiverColis(sel.id))}
                  className="min-h-11 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
                >
                  <Archive size={11} />
                  Désarchiver
                </button>
              ) : (
                <button
                  onClick={() => ask("Archiver ce dossier ?", `${sel.ref} sera masqué des listes courantes. Les cartons, factures et échanges sont conservés. Une personne autorisée pourra le désarchiver. Aucun message ne sera envoyé.`, () => runAction(() => archiverColis(sel.id)), { okLabel: "Archiver le dossier" })}
                  className="min-h-11 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-gray-200 text-gray-500 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <Archive size={11} />
                  Archiver
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
