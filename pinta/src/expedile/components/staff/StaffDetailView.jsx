import { useNavigate, useLocation } from 'react-router-dom';
import React, { useState, useEffect, useRef } from 'react';
import {
  Ruler, Check, Clock, AlertTriangle, Eye, X, RotateCcw, Send, Mail, Plus, Archive, Package,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND, STATUTS, TRANSITIONS, TAGS_PREPARATION, getDestByCP } from '../../constants';
import { eur } from '../../utils';
import { Ligne } from '../ui';
import WebcamCapture from '../ui/WebcamCapture';
import StaffAssignment from './StaffAssignment';
import FacturesPanel from '../detail/FacturesPanel';
import ColisModal from '../ColisModal';
import { receptionCartonManifest, receptionMeasurements } from '../../domain/reception';
import * as sb from '../../lib/supabaseData';
import { currentInvoices } from '../../domain/invoiceDocuments';
import { needsQuoteRecalculation } from '../../domain/clientJourney';
import { calculateQuote, measureShipment, volumetricDivisor, quoteInputFingerprint } from '../../domain/quote';
import { workspaceReturnPath } from '../../domain/navigation';
import { staffName } from '../workspace/WorkActionRow';

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

// ── Telegram button ──────────────────────────────────────────────────────────
function BtnTelegram({ onClick, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
      style={{ background: '#0088cc', color: 'white', boxShadow: '0 2px 8px #0088cc40' }}
    >
      <Send size={14} />
      {children}
    </button>
  );
}

// ── Email button ────────────────────────────────────────────────────────────
function BtnEmail({ onClick, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
      style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})`, color: 'white', boxShadow: '0 2px 8px rgba(27,58,75,0.25)' }}
    >
      <Mail size={14} />
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════
export default function StaffDetailView({ workspace = false }) {
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
    sendMsg,
    categories,
    getTarif,
    envois,
    assignDeparture,
    payer,
    setData,
    can,
  } = useApp();

  // ── Local state ──────────────────────────────────────────────────────────
  const [documentTab, setDocumentTab] = useState('articles');
  const [actionLoading, setActionLoading] = useState(false);
  const actionRef = useRef(false);
  const [commentaire, setCommentaire] = useState(sel?.commentairePreparation || '');
  const [newArticle, setNewArticle] = useState({ desc: '', qte: '1', prix: '', cat: '', factureId: '' });
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
      setNewArticle({ desc: '', qte: '1', prix: '', cat: '', factureId: '' });
      setFormErr('');
      const draft = preparationDrafts.get(`${auth?.u?.id}:${sel.id}`);
      setFinalPackages(draft?.finalPackages || savedFinalPackages(sel));
      preparationDirty.current = !!draft;
      preparationVersion.current = draft?.version || sel.updatedAt;
      preparationComposition.current = draft?.composition ?? sel.preparationCompositionVersion;
      preparationBaseline.current = draft?.baseline || JSON.stringify(savedFinalPackages(sel));
      setPreparationConflict(!!draft && draft.version !== sel.updatedAt);
      setMeasuresSaved(false);
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
  const openingKind = workActions.find(action => action.id === openingActionId && action.colis_id === sel?.id)?.kind;
  const params = new URLSearchParams(location.search);
  const canInvoiceWorkspace = ['perm_factures_voir', 'perm_factures_ajouter', 'perm_factures_valider', 'perm_factures_refuser', 'perm_factures_ocr', 'perm_factures_modifier_articles'].some(permission => can(permission));
  const canQuoteWorkspace = canInvoiceWorkspace || can('perm_colis_calculer_devis') || can('perm_colis_envoyer_devis');
  const preparationView = params.get('section') === 'preparation' || !canQuoteWorkspace || (!params.get('section') && !params.get('invoice') && openingKind === 'preparation');
  useEffect(() => {
    const anchor = preparationView ? 'preparation-workspace' : { documents: 'quote-documents', quote: 'quote-review' }[openingKind];
    if (!anchor) return;
    if (openingKind === 'documents') setDocumentTab('document');
    const frame = requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [sel?.id, openingActionId, openingKind, preparationView]);
  useEffect(() => {
    if (!preparationView || (!formErr && !measuresSaved)) return;
    preparationFeedback.current?.scrollIntoView({ block: 'nearest' });
    preparationFeedback.current?.focus({ preventScroll: true });
  }, [formErr, measuresSaved, preparationView]);

  if (!sel || !isStaff) return null;

  const assignee = teamUsers.find((user) => user.authId === sel.responsibleStaffId);
  const assignmentLabel = sel.responsibleStaffId === auth?.u?.id ? 'vous' : assignee ? [assignee.prenom, assignee.nom].filter(Boolean).join(' ') : sel.responsibleStaffId ? 'dossier pris en charge' : 'non attribué';
  const dest = selDest || getDestByCP(cl?.cp);
  const tarif = getTarif(dest?.code, cl?.abonnement);
  const divisor = volumetricDivisor(settings);
  const chooseSection = (section) => {
    const next = new URLSearchParams(location.search);
    next.set('section', section); next.delete('invoice'); next.delete('action');
    navigate(`/colis/${sel.id}?${next}#${section === 'preparation' ? 'preparation-workspace' : 'quote-documents'}`);
  };
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

  // ── Missing invoice? ──────────────────────────────────────────────────────
  // missingFacture = true si AUCUNE facture n'est validée
  const hasAnyValidFacture = sel.factures && sel.factures.length > 0 && sel.factures.some((f) => f.valide);
  const missingFacture = cl?.type !== 'pro' && !hasAnyValidFacture;

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
      setMeasuresSaved(true); flash('Mesures après optimisation enregistrées. Les documents peuvent être complétés séparément.'); }
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

  async function addArticle() {
    const article = { ...newArticle, desc: newArticle.desc.trim(), qte: Number(newArticle.qte), prix: Number(newArticle.prix), factureId: newArticle.factureId || null };
    if (!article.desc || !Number.isInteger(article.qte) || article.qte <= 0 || newArticle.prix === '' || !Number.isFinite(article.prix) || article.prix < 0 || !article.cat) throw new Error('Renseignez description, quantité entière positive, prix et catégorie.');
    const saved = await sb.insertLigne(sel.id, article);
    setData((previous) => previous.map((parcel) => parcel.id === sel.id ? { ...parcel, lignes: [...(parcel.lignes || []).filter((line) => line.id !== saved.id), saved] } : parcel));
    setNewArticle({ desc: '', qte: '1', prix: '', cat: '', factureId: '' });
    setDevisPrev(false);
  }

  // ── Correction bar availability ───────────────────────────────────────────
  const canRevert = !!sel.statut && sel.statut !== 'annule' && sel.statut !== 'livre' && can('perm_colis_revenir_arriere');
  const canCancel = !!sel.statut && sel.statut !== 'annule' && sel.statut !== 'livre' && can('perm_colis_annuler');

  // ════════════════════════════════════════════════════════════════════════
  // RENDER STATUS BLOCKS
  // ════════════════════════════════════════════════════════════════════════

  function renderActionBlock() {
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
        return (
          <Section title="Demander le feu vert" icon={Clock} color={borderColor}>
            <div className="space-y-3">
              {/* Action principale : 2 boutons côte à côte */}
              <div className="flex gap-2">
                <BtnTelegram
                  disabled={actionLoading || !cl?.telegramChatId || !can('perm_colis_demander_feuvert')}
                  onClick={() => runAction(async () => { await demanderFeuVert(sel.id); await sendMsg(sel.id, cl?.id, 'telegram', 'demande_feu_vert', null); })}
                >
                  {actionLoading ? 'Envoi...' : 'Telegram'}
                </BtnTelegram>
                <BtnEmail
                  disabled={actionLoading || !cl?.email || !can('perm_colis_demander_feuvert')}
                  onClick={() => runAction(async () => { await demanderFeuVert(sel.id); await sendMsg(sel.id, cl?.id, 'email', 'demande_feu_vert', null); })}
                >
                  {actionLoading ? 'Envoi...' : 'Email'}
                </BtnEmail>
              </div>

              {/* Alerte facture — compacte */}
              {missingFacture && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
                  <p className="text-[10px] font-semibold text-amber-700 flex-1">Facture manquante</p>
                  <button
                    onClick={() => runAction(() => sendMsg(sel.id, cl?.id, cl?.telegramChatId ? 'telegram' : 'email', 'facture_manquante', null))}
                    className="text-[10px] font-bold px-2 py-1 rounded bg-amber-200 text-amber-800 hover:bg-amber-300 transition-all active:scale-95"
                  >
                    Demander
                  </button>
                </div>
              )}

            </div>
          </Section>
        );
      }

      // ── 4. ATTENTE_FEU_VERT ────────────────────────────────────────────
      case 'attente_feu_vert': {
        return (
          <Section title="En attente du client" icon={Clock} color={borderColor}>
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-50 border border-orange-200">
                <Clock size={12} className="text-orange-500 flex-shrink-0" />
                <p className="text-[10px] font-medium text-orange-700">
                  Réponse attendue de {cl?.prenom || cl?.nom || 'votre client'}
                </p>
              </div>

              {/* Relancer — 2 boutons côte à côte */}
              <div className="flex gap-2">
                <BtnTelegram disabled={actionLoading || !cl?.telegramChatId}
                  onClick={() => runAction(() => sendMsg(sel.id, cl?.id, 'telegram', 'relance_feu_vert', null))}>
                  {actionLoading ? 'Envoi...' : 'Relancer Telegram'}
                </BtnTelegram>
                <BtnEmail disabled={actionLoading || !cl?.email}
                  onClick={() => runAction(() => sendMsg(sel.id, cl?.id, 'email', 'relance_feu_vert', null))}>
                  {actionLoading ? 'Envoi...' : 'Relancer email'}
                </BtnEmail>
              </div>

              {/* Alerte facture — compacte */}
              {missingFacture && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
                  <p className="text-[10px] font-semibold text-amber-700 flex-1">Facture manquante</p>
                  <button
                    onClick={() => runAction(() => sendMsg(sel.id, cl?.id, cl?.telegramChatId ? 'telegram' : 'email', 'facture_manquante', null))}
                    className="text-[10px] font-bold px-2 py-1 rounded bg-amber-200 text-amber-800 hover:bg-amber-300 transition-all active:scale-95"
                  >
                    Demander
                  </button>
                </div>
              )}
            </div>
          </Section>
        );
      }

      // ── 5. AUTORISE ────────────────────────────────────────────────────
      case 'autorise': {
        return (
          <Section title="Préparer le colis" icon={Check} color={borderColor}>
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 border border-green-200">
                <Check size={12} className="text-green-500 flex-shrink-0" />
                <p className="text-[10px] font-bold text-green-700">Accord client reçu</p>
              </div>

              {missingFacture && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
                  <p className="text-[10px] font-semibold text-amber-700">Les factures seront vérifiées séparément avant le devis.</p>
                </div>
              )}

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
          const anchor = field.startsWith('dimensions') ? 'quote-measures' : field.startsWith('fraisDivers') ? 'quote-fees' : field.startsWith('lignes') || field.startsWith('lines') ? 'quote-articles' : 'quote-documents';
          if (field.startsWith('dimensions')) { chooseSection('preparation'); return; }
          setDocumentTab('articles');
          requestAnimationFrame(() => { const target = document.getElementById(anchor); target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); target?.querySelector('input,select,button')?.focus({ preventScroll: true }); });
        };
        const preparationBlock = sel.archive ? 'Désarchivez le dossier avant de poursuivre sa préparation.' : sel.produitInterdit ? 'Un produit interdit est signalé : faites vérifier le dossier avant de poursuivre.' : sel.feuVert !== 'autorise' ? 'Le feu vert du client doit être enregistré avant de poursuivre la préparation.' : null;
        const weights = measureShipment(finalPackages, divisor);
        const isPro = cl?.type === 'pro';
        const inputClass = 'min-h-11 min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
        const changeFinal = (index, key, value) => { preparationDirty.current = true; setFinalPackages(previous => previous.map((box,position) => position === index ? { ...box, [key]: value } : box)); setMeasuresSaved(false); setDevisPrev(false); };
        const savedWeights = measureShipment(savedFinalPackages(sel), divisor);
        const measuresCurrent = sel.preparationCompositionVersion != null && sel.finalMeasurementsVersion === sel.preparationCompositionVersion;
        const sectionNavigation = <nav aria-label="Organisation du dossier" className="flex flex-wrap gap-2"><button aria-current={preparationView ? 'page' : undefined} onClick={() => chooseSection('preparation')} className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold ${preparationView ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-700'}`}>Préparation</button>{canQuoteWorkspace && <button aria-current={!preparationView ? 'page' : undefined} onClick={() => chooseSection('devis')} className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold ${!preparationView ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-700'}`}>Factures et devis</button>}</nav>;
        if (preparationView) return <section id="preparation-workspace" aria-label="Préparation après optimisation" className="mx-auto w-full max-w-3xl scroll-mt-48 space-y-5">
          {sectionNavigation}
          <div><h2 className="text-lg font-bold text-slate-800">Préparation</h2><p className="mt-1 text-sm text-slate-600">Optimisez l’emballage, puis pesez et mesurez chaque colis sortant. Enregistrez votre travail pour que la personne chargée du devis puisse prendre la suite.</p><p className="mt-2 text-sm text-slate-600">Les factures peuvent être complétées séparément. Aucun devis ni message client n’est envoyé depuis cet écran.</p></div>
          <div id="quote-measures" className="scroll-mt-24"><Section title="Mesures après optimisation" icon={Ruler} color={borderColor}>
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
            <p role="status" className="mt-2 text-xs text-slate-600">{measuresSaved ? 'Mesures enregistrées, même si les documents restent à vérifier.' : 'Les mesures peuvent être enregistrées avant les documents et le devis.'}</p></div>
            {weights && <div className="mt-4 space-y-1 border-t border-gray-100 pt-3 text-sm"><Ligne label="Poids volumétrique" value={`${weights.volumetricWeight.toFixed(2)} kg`} /><Ligne label="Poids facturable" value={`${weights.billableWeight.toFixed(2)} kg`} /></div>}
          </Section></div>
          {!measuresChanged && savedWeights && measuresCurrent && <section aria-label="Relais après préparation" className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="text-sm font-semibold text-emerald-800">Mesures disponibles pour le devis</h3><p className="text-sm text-emerald-800">{savedFinalPackages(sel).length} colis sortant(s) · {savedWeights.realWeight.toFixed(2)} kg au total. Votre collègue retrouve ces mesures dans « Factures et devis », sans les ressaisir.</p>
            {workActions.filter(action => action.colis_id === sel.id && ['documents','quote'].includes(action.kind) && action.state !== 'done').map(action => <p key={action.id} className="text-sm text-slate-700">{action.kind === 'documents' ? 'Factures' : 'Devis'} : {action.assignee_id ? staffName(action.assignee_id, teamUsers) : 'à prendre par une personne habilitée'}{action.blocked_reason ? ` · ${action.blocked_reason}` : ''}</p>)}
            {canQuoteWorkspace && <button onClick={() => chooseSection('devis')} className="min-h-11 rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Continuer vers les factures et le devis</button>}
            <button onClick={() => navigate(workspaceReturnPath(location.search, '/'))} className="min-h-11 block text-sm font-semibold text-slate-700 underline">Revenir à ma file de travail</button>
          </section>}
          {can('perm_colis_preparer') && !preparationBlock && <>
          <details className="border-t border-slate-200"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Consignes facultatives {selTags.length > 0 ? `· ${selTags.length} choisie(s)` : ''}</summary>          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600">Consignes de préparation</p>
            <div className="flex flex-wrap gap-2">{TAGS_PREPARATION.map((tag) => <button key={tag} disabled={actionLoading} onClick={() => runAction(async () => { const next = selTags.includes(tag) ? selTags.filter((item) => item !== tag) : [...selTags, tag]; await upd(sel.id, { tagsPreparation: next }); setSelTags(next); })} className={`min-h-11 rounded-full px-3 py-2 text-xs font-semibold ${selTags.includes(tag) ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{tag}</button>)}</div>
            <textarea aria-label="Commentaire de préparation" value={commentaire} onChange={(event) => setCommentaire(event.target.value)} placeholder="Instructions utiles à la préparation…" rows={2} className={inputClass} />
            {commentaire !== (sel.commentairePreparation || '') && <button disabled={actionLoading} className="min-h-11 text-xs font-semibold text-blue-700" onClick={() => runAction(() => upd(sel.id, { commentairePreparation: commentaire }))}>Enregistrer la consigne</button>}
          </div>
</details>
          <div><p className="mb-2 text-xs font-semibold text-slate-600">Photo du colis préparé</p><WebcamCapture colisId={sel.id} colisRef={sel.ref} existingUrl={sel.photoPrep} onCapture={(path) => runAction(() => upd(sel.id, { photoPrep: path }))} /></div>
          </>}
        </section>;
        return <div className={`min-w-0 space-y-5 ${workspace ? "mx-auto w-full max-w-6xl" : ""}`}>
          {sectionNavigation}
          <div className="border-b border-gray-200 pb-4">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Factures et devis</p>
            <p className="mt-1 text-sm text-slate-700">{isPro ? 'Client professionnel : transport et frais convenus, sans calcul de taxes dans ce devis.' : 'Vérifiez les factures et les articles, puis établissez le devis à partir des mesures enregistrées par la préparation.'}</p>
          </div>
          <nav aria-label="Vérifications du devis" className="flex flex-wrap gap-2">{[['quote-measures','Mesures'],['quote-documents','Documents'],['quote-articles','Articles'],['quote-fees','Frais']].filter(([id]) => !isPro || id !== 'quote-articles').map(([id,label]) => <a key={id} href={`#${id}`} onClick={(event) => { event.preventDefault(); setDocumentTab(id === 'quote-documents' ? 'document' : 'articles'); requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }} className="inline-flex min-h-11 items-center rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-700">{label}</a>)}</nav>
          {measuresChanged && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">Enregistrez les mesures modifiées avant de vérifier le devis. Vos documents peuvent être complétés séparément.</p>}
          {!quote.ok && <div className="rounded-xl bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-800">À compléter pour le devis</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-800">{quote.errors.map((error, index) => <li key={index}><button className="min-h-11 text-left underline underline-offset-2" onClick={() => focusBlocker(error.field)}>{error.message}</button></li>)}</ul></div>}
          {isPro && <label className="block space-y-2 text-xs font-semibold text-slate-600">Modalités de règlement convenues<select aria-label="Modalités de règlement professionnel" value={proPayMethod} onChange={(event) => { preparationDirty.current = true; setProPayMethod(event.target.value); setDevisPrev(false); }} className={inputClass}>{[['virement', 'Virement bancaire'], ['especes', 'Espèces'], ['30_jours', 'Paiement à 30 jours'], ['fin_de_mois', 'Paiement en fin de mois']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="block text-xs font-normal text-gray-500">Cette modalité figurera dans la version du devis. Le paiement sera confirmé séparément après réception du règlement.</span></label>}
          <section id="quote-measures" aria-label="Mesures de préparation enregistrées" className="scroll-mt-24 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">Mesures après optimisation</h3>
            {savedWeights && measuresCurrent ? <><p className="text-sm text-slate-700">{savedFinalPackages(sel).map((box,index) => `Colis sortant ${index + 1} : ${box.dimL} × ${box.dimW} × ${box.dimH} cm · ${box.poids} kg`).join(' ; ')}</p><p className="text-xs text-slate-600">Ces mesures enregistrées par la préparation sont utilisées dans ce devis.</p></> : <p className="text-sm text-amber-800">Les mesures après optimisation doivent être enregistrées par la préparation avant de calculer le devis.</p>}
            {measuresChanged && <p className="text-sm text-amber-800">Un brouillon de mesures n’est pas encore enregistré. Reprenez la préparation pour le terminer.</p>}
            <button className="min-h-11 text-sm font-semibold text-blue-700 underline" onClick={() => chooseSection('preparation')}>{can('perm_colis_preparer') ? 'Ouvrir la préparation' : 'Consulter la préparation'}</button>
          </section>
          {canInvoiceWorkspace && <FacturesPanel workspace tab={documentTab} onTabChange={setDocumentTab}>
          {!isPro && <div id="quote-articles" className="scroll-mt-24"><Section title="Récapitulatif des articles du dossier" icon={Package} color={borderColor}>
            <div className="mb-4 divide-y divide-gray-100">{currentInvoices(sel.factures || []).filter(invoice => !invoice.rejetMotif).map(invoice => {
              const lines = (sel.lignes || []).filter(line => line.factureId === invoice.id);
              return <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><div className="min-w-0"><p className="break-words font-semibold text-slate-700">{invoice.fichierNom || invoice.vendeur}</p><p className="text-xs text-slate-600">{lines.length} article(s) enregistré(s) · {eur(lines.reduce((total, line) => total + Number(line.qte) * Number(line.prix), 0))} HT · {invoice.valide ? 'Validée' : 'À vérifier'}</p></div><button className="min-h-11 text-sm font-semibold text-blue-700" onClick={() => { const params = new URLSearchParams(location.search); params.set('invoice', invoice.id); navigate(`/colis/${sel.id}?${params}#quote-documents`); }}>{invoice.valide ? 'Consulter la facture' : 'Vérifier cette facture'}</button></div>;
            })}</div>
            <div id="quote-unlinked" tabIndex={-1} className="scroll-mt-48">
            {(sel.lignes || []).some(line => !line.factureId) && <h4 className="mb-2 text-sm font-semibold text-amber-800">Articles saisis manuellement · inclus dans le devis</h4>}
            <div className="space-y-3">{(sel.lignes || []).filter(line => !line.factureId).map((line) => <div key={line.id} className="space-y-2 border-b border-gray-100 pb-3">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-medium text-slate-700">{line.desc}</p><p className="text-xs text-gray-500">{line.qte} × {eur(line.prix)}</p></div><button aria-label={`Supprimer ${line.desc}`} disabled={actionLoading || !can('perm_factures_modifier_articles')} onClick={() => ask('Retirer cet article du devis ?', `L’article « ${line.desc} » sera retiré. Vérifiez qu’il est déjà présent dans une facture si vous corrigez un double comptage.`, () => runAction(async () => { await sb.deleteLigne(line.id); setData((previous) => previous.map((parcel) => parcel.id === sel.id ? { ...parcel, lignes: (parcel.lignes || []).filter((item) => item.id !== line.id) } : parcel)); setDevisPrev(false); }), { danger: true, okLabel: 'Retirer l’article' })} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><X size={15} /></button></div>
              <select aria-label={`Catégorie de ${line.desc}`} disabled={actionLoading || !can('perm_factures_modifier_articles')} value={line.cat || ''} onChange={(event) => { const cat = event.target.value; runAction(async () => { await sb.updateLigne(line.id, { cat }); setData((previous) => previous.map((parcel) => parcel.id === sel.id ? { ...parcel, lignes: (parcel.lignes || []).map((item) => item.id === line.id ? { ...item, cat } : item) } : parcel)); setDevisPrev(false); }); }} className={inputClass}><option value="">Catégorie à vérifier</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select>
            </div>)}
              {(sel.lignes || []).some(line => !line.factureId) && <p className="text-xs text-slate-600">Ces articles ont été saisis séparément et s’ajoutent aux articles des factures. Si un article est déjà présent dans une facture validée, retirez sa ligne manuelle pour éviter de le compter deux fois.</p>}
              <details><summary className="min-h-11 cursor-pointer text-sm font-semibold text-slate-600">Ajouter un article sans facture source</summary><form className="space-y-2" onSubmit={(event) => { event.preventDefault(); runAction(addArticle); }}>
                <input aria-label="Description du nouvel article" required value={newArticle.desc} onChange={(event) => setNewArticle({ ...newArticle, desc: event.target.value })} placeholder="Description de l’article" className={inputClass} />
                <div className="grid grid-cols-2 gap-2"><label className="text-xs text-gray-500">Quantité<input required aria-label="Quantité du nouvel article" type="number" min="1" step="1" value={newArticle.qte} onChange={(event) => setNewArticle({ ...newArticle, qte: event.target.value })} className={inputClass} /></label><label className="text-xs text-gray-500">Prix unitaire HT (€)<input required aria-label="Prix du nouvel article" type="number" min="0" step="0.01" value={newArticle.prix} onChange={(event) => setNewArticle({ ...newArticle, prix: event.target.value })} className={inputClass} /></label></div>
                <select required aria-label="Catégorie du nouvel article" value={newArticle.cat} onChange={(event) => setNewArticle({ ...newArticle, cat: event.target.value })} className={inputClass}><option value="">Choisir une catégorie</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select>

                <button disabled={actionLoading || !can('perm_factures_modifier_articles')} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-semibold text-slate-700"><Plus size={14} />Enregistrer l’article</button>
              </form></details>
            </div>
            </div>
          </Section></div>}
          </FacturesPanel>}
          <div id="quote-fees" className="scroll-mt-24 space-y-2 border-t border-gray-200 pt-4"><p className="text-xs font-semibold text-slate-600">Frais convenus</p>{fraisDivers.map((fee, index) => <div key={index} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 break-words">{fee.libelle}</span><strong>{eur(fee.montant)}</strong><button aria-label={`Retirer ${fee.libelle}`} disabled={actionLoading} className="flex min-h-11 min-w-11 items-center justify-center text-gray-400" onClick={() => runAction(async () => { const next = fraisDivers.filter((_, position) => position !== index); preparationDirty.current = true; setFraisDivers(next); setDevisPrev(false); })}><X size={14} /></button></div>)}
            <form className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2" onSubmit={(event) => { event.preventDefault(); runAction(async () => { const amount = Number(newFraisMontant); if (!newFraisLibelle.trim() || newFraisMontant === '' || !Number.isFinite(amount) || amount < 0) throw new Error('Indiquez le libellé et un montant positif ou nul.'); const next = [...fraisDivers, { libelle: newFraisLibelle.trim(), montant: amount }]; preparationDirty.current = true; setFraisDivers(next); setNewFraisLibelle(''); setNewFraisMontant(''); setDevisPrev(false); }); }}><input aria-label="Libellé du frais" required value={newFraisLibelle} onChange={(event) => setNewFraisLibelle(event.target.value)} placeholder="Libellé du frais" className={inputClass} /><input aria-label="Montant du frais" required type="number" min="0" step="0.01" value={newFraisMontant} onChange={(event) => setNewFraisMontant(event.target.value)} placeholder="€" className={inputClass} /><button disabled={actionLoading} className="col-span-2 min-h-11 rounded-xl bg-slate-100 text-xs font-semibold text-slate-700">Ajouter le frais</button></form>
          </div>
          {subExpired && <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700">Abonnement expiré : régularisez l’offre du client avant l’envoi.</p>}

          {quote.ok && quote.warnings.length > 0 && <div className="space-y-1 rounded-xl bg-amber-50 p-3">{quote.warnings.map((warning, index) => <p key={index} className="text-xs text-amber-800">{warning}</p>)}</div>}
          {quote.ok && <Section title={verified ? 'Brouillon enregistré · vérifier puis envoyer' : 'Estimation du devis'} icon={Eye} color={BRAND.navy}>
            <div className="space-y-2 text-sm"><Ligne label="Transport" value={eur(quote.amounts.transport)} />{!isPro && <><Ligne label="Octroi de mer" value={eur(quote.amounts.om)} /><Ligne label="Octroi de mer régional" value={eur(quote.amounts.omr)} /><Ligne label={`TVA (${dest.tva} %)`} value={eur(quote.amounts.tva)} /></>}<Ligne label="Frais convenus" value={eur(quote.amounts.fees)} /><div className="border-t border-gray-200 pt-3"><Ligne label="Total à régler" value={<strong className="text-xl" style={{ color: 'var(--brand-text)' }}>{eur(quote.amounts.total)}</strong>} /></div>{quote.patch.economie > 0 && <Ligne label="Économie après optimisation" value={eur(quote.patch.economie)} />}</div>
          </Section>}
          <div id="quote-review" tabIndex={-1} data-testid="quote-action-bar" className="-mx-1 scroll-mt-48 border-t border-slate-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-3px_12px_rgba(0,0,0,0.06)]">
            <div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-600">Total recalculé</p><p className="text-lg font-bold text-slate-800">{quote.ok ? eur(quote.amounts.total) : 'À compléter'}</p></div><p role="status" className="max-w-[60%] text-right text-xs text-slate-600">{actionLoading ? 'Enregistrement en cours…' : verified ? 'Brouillon enregistré · vérifiez le détail avant envoi' : sel.devisBrouillon ? 'Modifications à enregistrer et vérifier' : 'Calcul non enregistré'}</p></div>
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
                  {/* Renvoyer le lien */}
                  <BtnTelegram disabled={actionLoading || !cl?.telegramChatId} onClick={() => runAction(() => sendMsg(sel.id, cl?.id, 'telegram', 'relance_paiement', null))}>
                    {actionLoading ? 'Envoi...' : sel.payplugPaymentUrl ? 'Renvoyer le lien de paiement' : 'Relancer via Telegram'}
                  </BtnTelegram>
                  <BtnEmail disabled={actionLoading || !cl?.email} onClick={() => runAction(() => sendMsg(sel.id, cl?.id, 'email', 'relance_paiement', null))}>
                    {actionLoading ? 'Envoi...' : 'Relancer par email'}
                  </BtnEmail>
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
              {/* Timeline */}
              <div className="space-y-2">
                {trackingSteps.map((step, idx) => {
                  const done = idx < currentIdx;
                  const active = idx === currentIdx;
                  return (
                    <div
                      key={step.key}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl"
                      style={{
                        background: active ? `${borderColor}15` : done ? '#F0FDF4' : '#F9FAFB',
                        border: active ? `1.5px solid ${borderColor}` : done ? '1.5px solid #BBF7D0' : '1.5px solid #F3F4F6',
                      }}
                    >
                      <div
                        className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px]"
                        style={{
                          background: active ? borderColor : done ? '#22C55E' : '#E5E7EB',
                          color: 'white',
                        }}
                      >
                        {done ? <Check size={10} /> : idx + 1}
                      </div>
                      <span
                        className="text-sm font-semibold"
                        style={{ color: active ? borderColor : done ? '#16A34A' : '#9CA3AF' }}
                      >
                        {step.label}
                      </span>
                      {active && (
                        <span
                          className="ml-auto text-[10px] font-black px-2 py-0.5 rounded-full"
                          style={{ background: borderColor, color: 'white' }}
                        >
                          EN COURS
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Next step buttons */}
              <div className="flex flex-col gap-2">
                {sel.statut === 'transit' ? (
                  <>
                    <BtnPrimary
                      onClick={() => runAction(() => changerStatut(sel.id, 'dedouanement'))}
                      color="#8B5CF6"
                    >
                      <Clock size={15} />
                      Passer en dédouanement
                    </BtnPrimary>
                    <BtnPrimary
                      onClick={() => runAction(async () => {
                        await changerStatut(sel.id, 'arrive');
                        await sendMsg(sel.id, cl?.id, cl?.telegramChatId ? 'telegram' : 'email', 'arrive', null);
                      })}
                      color="#14B8A6"
                    >
                      <Check size={15} />
                      Arrivé directement (sans dédouanement)
                    </BtnPrimary>
                  </>
                ) : (
                  nextStatuts.map((ns) => {
                    const step = trackingSteps.find((s) => s.key === ns);
                    const tpl = step?.tpl;
                    return (
                      <BtnPrimary
                        key={ns}
                        onClick={() => runAction(async () => {
                          await changerStatut(sel.id, ns);
                          if (tpl) await sendMsg(sel.id, cl?.id, cl?.telegramChatId ? 'telegram' : 'email', tpl, null);
                        })}
                        color={borderColor}
                      >
                        <Check size={15} />
                        {STATUTS[ns]?.actionStaff || STATUTS[ns]?.label}
                      </BtnPrimary>
                    );
                  })
                )}
              </div>
            </div>
          </Section>
        );
      }

      default:
        return null;
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
      {sel.statut === 'en_preparation' ? <details className="border-b border-slate-200"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Suivi : {assignmentLabel}{sel.nextAction ? ` · ${sel.nextAction}` : ''}</summary><StaffAssignment /></details> : <StaffAssignment />}
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
