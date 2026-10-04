import { useTaskAccess } from '../../context/TaskAccessContext';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, FileText, History, Info, Loader2, Plus, Scan, Upload, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import * as sb from '../../lib/supabaseData';
import { supabase } from '../../lib/supabase';
import { functionErrorMessage } from '../../services/functionErrors';
import { eur, getPrenom } from '../../utils';
import { invoiceBuckets, invoiceIdentity, invoiceNumbering, invoiceOcrNote, invoiceProgressSummary, invoiceState, invoiceStateLabel, orderInvoices, reviewQueue } from '../../domain/invoiceProgress';
import InlineDocument from './InvoiceDocument';
import TaskMessage from '../staff/TaskMessage';
import { ConversationAttachment, pendingInvoiceAttachments, conversationInvoiceEditable } from './ChatPanel';
import useWorkDraft from '../../hooks/useWorkDraft';
import { registerWorkDraft } from '../../domain/workDrafts';
import './invoiceWorkspace.css';

const INPUT = 'min-h-11 min-w-0 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-70';
const BUTTON = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-[transform,background-color,border-color] duration-200 ease-out active:translate-y-[1px] disabled:opacity-50 disabled:active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';
const SECONDARY = `${BUTTON} border border-gray-300 bg-white text-slate-700`;
// Every disclosure in the workspace uses the same rotating chevron (CSS hides
// the native marker inside .invoice-workspace).
const CHEVRON = <ChevronRight size={16} className="iw-chevron" aria-hidden="true" />;
const emptyLine = () => ({ desc: '', qte: 1, prix: '', cat: '' });
// Memory only, scoped to the signed-in operator. Navigation inside the app
// must not throw away an unfinished review; durable saves use the server RPC.
const reviewDraftCache = new Map();
const name = invoice => invoice?.fichierNom || invoice?.vendeur || 'Document sans nom';
const isReplaced = (invoice, invoices) => invoices.some(other => other.replacesFactureId === invoice.id);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const TONE = { verified: 'done', toVerify: 'waiting', toCorrect: 'review' };
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
const DAY_YEAR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' });
const shortDate = value => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return (date.getFullYear() === new Date().getFullYear() ? DAY : DAY_YEAR).format(date);
};
// Supplier when known (confirmed or proposed), else the file name: what a
// person recognises on the paper invoice.
const shortName = identity => identity.supplierKnown ? identity.supplier : identity.fileName || identity.supplier;
const amountText = identity => identity.amount === null ? 'Montant à vérifier' : `${eur(identity.amount)} HT`;
// One line naming an invoice. A value read automatically carries the same
// short « (proposé) » as the list, right after that value.
const identityText = identity => `${shortName(identity)}${identity.supplierSuggested ? ' (proposé)' : ''} · ${amountText(identity)}${identity.amountSuggested ? ' (proposé)' : ''}`;
// After an RPC the returned row is authoritative; only the arrival date, used
// for the numbering, is kept when a payload omits it.
const keepArrival = (previous, saved) => saved.createdAt || !previous?.createdAt ? saved : { ...saved, createdAt: previous.createdAt };

function ArticleReview({ initialOpen, summary, children }) {
  const [expanded, setExpanded] = useState(initialOpen);
  return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="min-w-0 rounded-xl border border-gray-200 bg-slate-50 p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-700">{CHEVRON}<span className="min-w-0">{summary}</span></summary>{children}</details>;
}

function seedDraft(invoice, record, lines) {
  const saved = lines.filter(line => line.factureId === invoice.id);
  const extraction = record.extraction;
  const source = record.draft || (saved.length ? { vendeur: invoice.vendeur, total: invoice.montant, lines: saved, extractionId: null } : extraction ? { ...extraction, extractionId: extraction.id } : { vendeur: invoice.vendeur === 'Document à vérifier' ? '' : invoice.vendeur, total: invoice.montant || '', lines: [emptyLine()] });
  return { vendeur: source.vendeur || '', total: source.total ?? '', lines: (source.lines || []).map(line => ({ desc: line.desc || '', qte: line.qte ?? '', prix: line.prix ?? '', cat: line.cat || '' })), extractionId: source.extractionId || null, reviewToken: record.reviewToken, dirty: false, editing: !invoice.valide || !!record.draft, editingExplicit: !!record.draft };
}

export function reviewIssues(draft, categories, invoice) {
  const issues = [];
  if (!invoice.fichier) issues.push({ field: 'document', message: 'Joignez le document source avant de valider.' });
  if (!draft.vendeur.trim()) issues.push({ field: 'vendor', message: 'Renseignez le vendeur.' });
  if (!Number.isFinite(Number(draft.total)) || Number(draft.total) <= 0) issues.push({ field: 'total', message: 'Renseignez le total HT de la facture.' });
  else if (Math.abs(Number(draft.total) * 100 - Math.round(Number(draft.total) * 100)) > 0.000001) issues.push({ field: 'total', message: 'Le total HT doit comporter au maximum deux décimales.' });
  if (!draft.lines.length) issues.push({ field: 'add-line', message: 'Ajoutez au moins un article.' });
  draft.lines.forEach((line, index) => {
    if (!line.desc.trim()) issues.push({ field: `desc-${index}`, message: `Article ${index + 1} : indiquez la description.` });
    if (!Number.isInteger(Number(line.qte)) || Number(line.qte) <= 0 || Number(line.qte) > 100000) issues.push({ field: `qte-${index}`, message: `Article ${index + 1} : indiquez une quantité entière entre 1 et 100 000.` });
    if (line.prix === '' || !Number.isFinite(Number(line.prix)) || Number(line.prix) < 0) issues.push({ field: `prix-${index}`, message: `Article ${index + 1} : vérifiez le prix unitaire HT.` });
    else if (Math.abs(Number(line.prix) * 100 - Math.round(Number(line.prix) * 100)) > 0.000001) issues.push({ field: `prix-${index}`, message: `Article ${index + 1} : le prix HT doit comporter au maximum deux décimales.` });
    if (!categories.some(category => category.id === line.cat)) issues.push({ field: `cat-${index}`, message: `Article ${index + 1} : choisissez une catégorie.` });
  });
  const sum = draft.lines.reduce((value, line) => value + Number(line.qte) * Number(line.prix), 0);
  if (Number(draft.total) > 0 && Number.isFinite(sum) && Math.abs(sum - Number(draft.total)) > 0.02) issues.push({ field: 'total', message: `Total des articles : ${eur(sum)}. Il doit correspondre au total HT de la facture (${eur(Number(draft.total))}).` });
  return issues;
}

export default function InvoiceWorkspace({ workspace = false, taskMode = false, onQuote, tab, onTabChange, children }) {
  const { sel, auth, categories = [], can: rawCan, setData, refreshColis, refreshWork, setCfm: askConfirm, getClient } = useApp();
  const { taskCan: can } = useTaskAccess(rawCan);
  const cacheKey = `${auth?.u?.id || auth?.id}:${sel?.id}`;
  const location = useLocation();
  const navigate = useNavigate();
  const requestedId = new URLSearchParams(location.search).get('invoice');
  const [selectedId, setSelectedId] = useState(requestedId);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const requestedTab = useRef(null);
  const [localTab, setLocalTab] = useState('articles');
  const activeTab = tab || localTab;
  const setTab = next => { setLocalTab(next); onTabChange?.(next); };
  const [records, setRecords] = useState({});
  const [drafts, setDrafts] = useState(() => reviewDraftCache.get(cacheKey) || {});
  const draftsRef = useRef(drafts); draftsRef.current = drafts;
  const parcelRef = useRef(sel); parcelRef.current = sel;
  const alive = useRef(true);
  const loadSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [feedbacks, setFeedbacks] = useState({});
  const [headerFeedback, setHeaderFeedback] = useState(null);
  const [reloadRequired, setReloadRequired] = useState({});
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [removingDuplicate, setRemovingDuplicate] = useState(false);
  const [originalId, setOriginalId] = useState('');
  const uploadRef = useRef(null);
  const uploadTarget = useRef(null);
  const editorRef = useRef(null);
  const sectionRef = useRef(null);
  const documentRef = useRef(null);
  const currentRef = useRef(null);
  const completedRef = useRef(null);
  const currentTitleRef = useRef(null);
  const tabsRef = useRef(null);
  const modifyRef = useRef(null);
  // Focus to restore once the screen has settled (busy cleared, panels
  // swapped): candidates tried in order, only if focus fell to <body>.
  const focusAfter = useRef(null);
  // ?invoice= links coming from outside (indicator, side panel) move focus to
  // the document once; choosing another invoice here keeps focus where it is.
  const handledArrival = useRef(null);
  const internalNavigation = useRef(false);
  const resumedFiles = useRef(new Set());
  const invoices = sel?.factures || [];
  // One reading for the whole screen: arrival order, counted invoices numbered
  // 1..N, copies and old versions outside the count (domain/invoiceProgress).
  const numbering = invoiceNumbering(invoices);
  const buckets = invoiceBuckets(invoices, { pendingAttachments: pendingInvoiceAttachments(sel) });
  const activeInvoices = buckets.counted;
  const retiredInvoices = buckets.duplicates;
  const replacedInvoices = buckets.replaced;
  const pending = reviewQueue(buckets);
  const selected = invoices.find(invoice => invoice.id === selectedId) || pending[0] || activeInvoices[0] || orderInvoices(invoices)[0];
  const invoiceId = selected?.id;
  const record = records[invoiceId];
  const draft = drafts[invoiceId];
  const feedback = feedbacks[invoiceId || 'general'];
  const editable = conversationInvoiceEditable(sel);
  const canEdit = editable && can('perm_factures_modifier_articles');
  const canValidate = canEdit && can('perm_factures_valider');
  const canAdd = editable && can('perm_factures_ajouter');
  const inactive = selected && (selected.duplicateOfId || selected.rejetMotif || isReplaced(selected, invoices));
  const historical = selected && !activeInvoices.some(invoice => invoice.id === selected.id);
  const fieldsDisabled = !canEdit || !!busy || !!inactive || !draft?.editing;
  const issues = draft && selected ? reviewIssues(draft, categories, selected) : [];
  const unlinked = (sel?.lignes || []).filter(line => !line.factureId);
  const unlinkedTotal = unlinked.reduce((total, line) => total + Number(line.qte || 0) * Number(line.prix || 0), 0);
  const documentsComplete = buckets.complete;
  const unfinishedReview = Object.values(drafts).some(item => item.dirty || item.editing && item.editingExplicit);
  useWorkDraft({ userId: auth?.u?.id || auth?.id, dossierId: sel?.id, kind: 'documents', source: 'invoice-review', dirty: Object.values(drafts).some(item => item.dirty), label: 'Vérification de facture non enregistrée' });
  const showReview = !workspace || !documentsComplete || reviewExpanded || !!requestedId || unfinishedReview;
  const entry = numbering[invoiceId] || null;
  const position = activeInvoices.findIndex(invoice => invoice.id === invoiceId);
  const identityOf = invoice => invoiceIdentity(invoice, records[invoice.id], sel?.lignes || []);
  const numberLabel = invoice => numbering[invoice.id]?.n ? `facture ${numbering[invoice.id].n}` : 'facture';
  const originalCandidates = activeInvoices.filter(invoice => invoice.id !== invoiceId && invoice.fichier && !invoice.rejetMotif && !isReplaced(invoice, invoices));
  const chosenOriginal = originalCandidates.find(invoice => invoice.id === originalId);
  const isOriginalOfCopies = invoices.some(invoice => invoice.duplicateOfId === invoiceId);
  const duplicateCandidates = (record?.duplicateCandidateIds || []).map(id => invoices.find(invoice => invoice.id === id)).filter(invoice => invoice && !invoice.duplicateOfId && !invoice.rejetMotif && !isReplaced(invoice, invoices));
  const contextFingerprint = JSON.stringify([sel?.factures, sel?.lignes]);
  const canResume = can('perm_factures_ocr') || can('perm_factures_valider');

  const loadContext = useCallback(async (resetId = null) => {
    const sequence = ++loadSequence.current;
    const context = await sb.getInvoiceReviewContext(parcelRef.current.id);
    if (!alive.current || sequence !== loadSequence.current) return;
    const next = Object.fromEntries(context.invoices.map(item => [item.factureId, item]));
    setRecords(next); setLoadError('');
    setDrafts(previous => {
      const merged = { ...previous };
      for (const invoice of parcelRef.current.factures || []) {
        if (!next[invoice.id]) continue;
        if (invoice.id !== resetId && (previous[invoice.id]?.dirty || previous[invoice.id]?.editing && previous[invoice.id]?.editingExplicit && invoice.valide)) continue;
        if (invoice.id !== resetId && previous[invoice.id]?.viewingSaved && (invoice.valide || invoice.duplicateOfId || isReplaced(invoice, parcelRef.current.factures))) {
          merged[invoice.id] = { ...seedDraft(invoice, { ...next[invoice.id], draft: null, extraction: null }, parcelRef.current.lignes || []), editing: false, editingExplicit: false, viewingSaved: true };
          continue;
        }
        merged[invoice.id] = seedDraft(invoice, next[invoice.id], parcelRef.current.lignes || []);
      }
      return merged;
    });
  }, []);

  useEffect(() => { alive.current = true; return () => { alive.current = false; loadSequence.current++; }; }, []);
  useEffect(() => {
    if (Object.values(drafts).some(item => item.dirty)) reviewDraftCache.set(cacheKey, drafts);
    else reviewDraftCache.delete(cacheKey);
  }, [cacheKey, drafts]);
  useEffect(() => {
    loadContext().catch(error => { if (alive.current) setLoadError(error.message || 'Impossible de charger les vérifications.'); }).finally(() => { if (alive.current) setLoading(false); });
  }, [loadContext, contextFingerprint]);
  useEffect(() => {
    const fileKey = `${invoiceId}:${selected?.fichier}`;
    // Consultation never reads proposals again: no OCR call on a paid, closed
    // or archived dossier, and no warning about proposals that are not needed.
    if (!editable || !showReview || historical || !selected?.fichier || !canResume || resumedFiles.current.has(fileKey)) return;
    resumedFiles.current.add(fileKey);
    let active = true;
    // Resume only verifies the current file and retrieves saved proposals; it
    // neither calls the AI extraction service nor sends a customer message.
    supabase.functions.invoke('ocr-facture', { body: { factureId: invoiceId, colisId: sel.id, action: 'resume' } }).then(async response => {
      if (!active) return;
      if (response.error || !response.data?.success) throw new Error(await functionErrorMessage(response, 'Les propositions n’ont pas pu être reprises.'));
      await loadContext();
    }).catch(error => {
      if (active) setFeedbacks(previous => ({ ...previous, [invoiceId]: { type: 'warning', message: `${error.message} La saisie manuelle reste disponible.` } }));
    });
    return () => { active = false; };
  }, [invoiceId, selected?.fichier, canResume, sel?.id, loadContext, showReview, historical, editable]);
  useEffect(() => {
    if (requestedId) {
      setSelectedId(requestedId);
      setTab(requestedTab.current?.id === requestedId ? requestedTab.current.tab : 'document');
    }
    requestedTab.current = null;
  }, [requestedId, location.key]);
  useEffect(() => {
    if (!requestedId || loading || handledArrival.current === location.key) return;
    if (internalNavigation.current) { internalNavigation.current = false; handledArrival.current = location.key; return; }
    if (activeTab !== 'document') return;
    handledArrival.current = location.key;
    const frame = requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ block: 'start' });
      // On a phone the header and the invoice list can push the document below
      // the fold. Bring the « Facture n sur N » bar to the top: it says which
      // invoice is shown, and the document right below it is on screen (the
      // PDF, rendered only once visible, actually loads).
      if (documentRef.current && documentRef.current.getBoundingClientRect().top > window.innerHeight - 160) (currentRef.current || documentRef.current).scrollIntoView({ block: 'start' });
      documentRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [requestedId, activeTab, loading, location.key]);
  useEffect(() => {
    // Every render: an in-place action disabled or unmounted the control that
    // started it. Once nothing is busy, put keyboard focus back on it, or on a
    // stable target, rather than leaving it on <body> (WCAG 2.4.3).
    if (!focusAfter.current || busy) return;
    const candidates = focusAfter.current;
    focusAfter.current = null;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      for (const candidate of candidates) {
        const element = typeof candidate === 'function' ? candidate() : candidate;
        if (element?.isConnected && !element.disabled && element.getClientRects().length) { element.focus({ preventScroll: true }); return; }
      }
    });
  });
  useEffect(() => {
    const warn = event => { if (Object.values(draftsRef.current).some(item => item.dirty)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  if (!sel) return null;
  const feedbackFor = (id, message, type = 'success') => { if (alive.current) setFeedbacks(previous => ({ ...previous, [id || 'general']: { message, type } })); };
  const change = changes => setDrafts(previous => ({ ...previous, [invoiceId]: { ...previous[invoiceId], ...changes, dirty: true } }));
  // An acknowledged save can finish after navigation. Clear only this invoice
  // from the local pending work; another invoice's edits must remain protected.
  const settleDraft = (id, value) => {
    const next = { ...draftsRef.current };
    if (value) next[id] = value; else delete next[id];
    draftsRef.current = next;
    const dirty = Object.values(next).some(item => item.dirty);
    if (dirty) reviewDraftCache.set(cacheKey, next); else reviewDraftCache.delete(cacheKey);
    registerWorkDraft(auth?.u?.id || auth?.id, sel.id, 'documents', 'invoice-review', dirty, 'Vérification de facture non enregistrée');
    if (alive.current) setDrafts(next);
  };
  const changeLine = (position, changes) => change({ lines: draft.lines.map((line, i) => i === position ? { ...line, ...changes } : line) });
  const choose = (id, nextTab) => {
    setSelectedId(id); setReviewExpanded(true); setRejecting(false); setReason(''); setRemovingDuplicate(false); setOriginalId('');
    if (nextTab) setTab(nextTab);
    if (requestedId && requestedId !== id) {
      requestedTab.current = { id, tab: nextTab || 'document' };
      internalNavigation.current = true;
      const params = new URLSearchParams(location.search); params.set('invoice', id);
      navigate(`${location.pathname}?${params}${location.hash}`, { replace: true });
    }
  };
  const focusSection = id => { const section = document.getElementById(id); section?.scrollIntoView({ block: 'start' }); section?.focus({ preventScroll: true }); };
  const closeReview = () => {
    setReviewExpanded(false); setSelectedId(null);
    const params = new URLSearchParams(location.search); params.delete('invoice');
    if (taskMode) params.set('section', 'documents');
    if (requestedId) navigate(`${location.pathname}?${params}#quote-documents`, { replace: true });
    // The editor and its buttons unmount: keyboard focus goes to the summary
    // (or the section title), never to <body>.
    requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ block: 'start' });
      (completedRef.current || sectionRef.current?.querySelector('h2'))?.focus({ preventScroll: true });
    });
  };
  // Tabs shown (narrow panel): one pane at a time, so bring the « Facture n
  // sur N » bar to the top (the pane follows right below it), as for links.
  const tabsShown = () => (tabsRef.current?.getClientRects().length || 0) > 0;
  const chooseForReview = id => { choose(id, 'articles'); requestAnimationFrame(() => { ((tabsShown() && currentRef.current) || editorRef.current)?.scrollIntoView({ block: 'start' }); editorRef.current?.focus({ preventScroll: true }); }); };
  const consult = id => { choose(id, 'document'); requestAnimationFrame(() => { (currentRef.current || documentRef.current)?.scrollIntoView({ block: 'start' }); documentRef.current?.focus({ preventScroll: true }); }); };
  const stableFocus = [() => currentTitleRef.current, () => sectionRef.current?.querySelector('h2')];
  const returnToSaved = () => {
    const close = () => {
      focusAfter.current = [() => modifyRef.current, ...stableFocus];
      settleDraft(invoiceId, { ...seedDraft(selected, { ...record, draft: null, extraction: null }, sel.lignes || []), editing: false, editingExplicit: false, viewingSaved: true });
    };
    if (!draft?.dirty) return close();
    askConfirm({ title: historical ? 'Abandonner la saisie locale ?' : 'Fermer sans enregistrer ?', msg: 'Vos modifications non enregistrées seront abandonnées. La version enregistrée du dossier est conservée.' + (record?.draft ? ' Le brouillon déjà enregistré restera disponible.' : ''), okLabel: historical ? 'Abandonner la saisie locale' : 'Revenir à la version validée', onOk: close });
  };
  const focusField = field => { const element = sectionRef.current?.querySelector(`[data-field="${field}"]`); for(let parent = element?.parentElement; parent; parent = parent.parentElement) { if(parent.tagName === 'DETAILS') parent.open = true; } setTab('articles'); element?.focus(); element?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const run = async (key, operation) => {
    if (busyRef.current) return;
    const target = invoiceId || 'general';
    focusAfter.current = [document.activeElement, ...stableFocus];
    busyRef.current = true; setBusy(key); setHeaderFeedback(null); setFeedbacks(previous => ({ ...previous, [target]: null }));
    try { await operation(); }
    catch (error) {
      feedbackFor(target, error.message || 'Enregistrement interrompu. Votre saisie est conservée. Actualisez pour vérifier le résultat.', 'error');
      if (['request', 'upload', 'duplicate', 'restore'].includes(key)) setHeaderFeedback({ type: 'error', message: error.message || 'L’action n’a pas pu être enregistrée.' });
      if (error.code === '40001' || /fetch|network|serveur est indisponible/i.test(error.message || '')) setReloadRequired(previous => ({ ...previous, [target]: true }));
    } finally { busyRef.current = false; if (alive.current) setBusy(''); }
  };
  const invokeOCR = async (invoice, action) => {
    const response = await supabase.functions.invoke('ocr-facture', { body: { factureId: invoice.id, colisId: sel.id, action } });
    if (response.error || !response.data?.success) throw new Error(await functionErrorMessage(response, 'Analyse indisponible. Votre saisie est conservée.'));
    return response.data;
  };
  const refresh = async () => { const saved = await refreshColis(sel.id); if (saved) parcelRef.current = saved; await loadContext(); await refreshWork?.(); };
  const afterCommit = async (id, message, type = 'success') => {
    feedbackFor(id, message, type);
    // The last validation may collapse the editor. Keep its acknowledgement
    // visible in the summary, including a failure of the subsequent refresh.
    setHeaderFeedback({ type, message });
    try { await refresh(); return true; }
    catch {
      const warning = `${message} L’actualisation du dossier a échoué. Actualisez pour retrouver l’état partagé.`;
      feedbackFor(id, warning, 'warning'); setHeaderFeedback({ type: 'warning', message: warning });
      setSelectedId(id); setReviewExpanded(true);
      setReloadRequired(previous => ({ ...previous, [id]: true }));
      return false;
    }
  };
  const save = confirm => {
    if (confirm && issues.length) {
      if (busyRef.current) return;
      setHeaderFeedback(null); feedbackFor(invoiceId, issues[0].message, 'error'); focusField(issues[0].field);
      return;
    }
    return saveReview(confirm);
  };
  const saveReview = confirm => run('save', async () => {
    if (confirm && draft.extractionId) await invokeOCR(selected, 'resume');
    const result = await sb.saveInvoiceReview(selected, draft, confirm);
    // Apply the acknowledged transaction immediately: a later refresh failure is
    // not a failed save and must never invite a second import.
    setData(previous => previous.map(parcel => parcel.id !== sel.id ? parcel : {
      ...parcel, factures: parcel.factures.map(invoice => invoice.id === invoiceId ? keepArrival(invoice, result.facture) : invoice),
      lignes: confirm ? [...(parcel.lignes || []).filter(line => line.factureId !== invoiceId), ...(result.insertedLignes || []).map(line => ({ ...line, factureId: invoiceId }))] : parcel.lignes,
    }));
    settleDraft(invoiceId, { ...draft, dirty: false, editing: !confirm, editingExplicit: !confirm, reviewToken: result.reviewToken });
    setRecords(previous => ({ ...previous, [invoiceId]: { ...previous[invoiceId], reviewToken: result.reviewToken } }));
    const left = pending.filter(invoice => invoice.id !== invoiceId).length;
    const waiting = buckets.toCorrect.filter(invoice => invoice.id !== invoiceId).length;
    const remainder = left ? ` Il reste ${plural(left, 'facture', 'factures')} à vérifier.` : waiting ? ` ${plural(waiting, 'facture attend', 'factures attendent')} la correction du client.` : '';
    const refreshed = await afterCommit(invoiceId, confirm ? `Facture ${entry?.n || ''} sur ${buckets.total} · ${draft.vendeur.trim() || name(selected)} : facture et articles validés et enregistrés.${remainder}` : `Brouillon enregistré pour ${name(selected)}. Il sera disponible à la prochaine ouverture.`);
    if (taskMode && confirm && refreshed) {
      const next = reviewQueue(invoiceBuckets(parcelRef.current.factures || [])).find(invoice => invoice.id !== invoiceId);
      if (next) chooseForReview(next.id); else closeReview();
    }
  });
  const reload = () => run('reload', async () => {
    const saved = await refreshColis(sel.id);
    if (saved) parcelRef.current = saved;
    await loadContext(invoiceId);
    setReloadRequired(previous => ({ ...previous, [invoiceId]: false }));
    feedbackFor(invoiceId, 'État enregistré rechargé. Vérifiez la facture avant de poursuivre.');
  });
  const requestReload = () => {
    if (!draft?.dirty) return reload();
    askConfirm({ title: 'Recharger la vérification ?', msg: 'Votre saisie locale sera remplacée par la version enregistrée. Pour la conserver, annulez et copiez vos corrections avant de recharger.', okLabel: 'Recharger la version enregistrée', onOk: reload });
  };
  const analyze = () => run('analyze', async () => {
    const result = await invokeOCR(selected, 'extract');
    await loadContext();
    if (!result.extraction) throw new Error('Aucune proposition disponible. Complétez les articles manuellement.');
    feedbackFor(invoiceId, 'Analyse chargée. Vérifiez les propositions puis choisissez « Utiliser les propositions » pour remplacer la saisie courante.');
  });
  const useAnalysis = () => {
    const apply = () => { change({ vendeur: record.extraction.vendeur || '', total: record.extraction.total ?? '', lines: record.extraction.lines || [], extractionId: record.extraction.id, editing: true }); feedbackFor(invoiceId, 'Propositions reprises dans le brouillon. Vérifiez chaque article avant validation.'); };
    if (draft.dirty || (sel.lignes || []).some(line => line.factureId === invoiceId)) askConfirm({ title: 'Utiliser les propositions de l’analyse ?', msg: 'Le brouillon de cette facture sera remplacé. Les articles enregistrés restent inchangés jusqu’à votre validation.', okLabel: 'Utiliser les propositions', onOk: apply });
    else apply();
  };
  const applyClassification = result => {
    setData(previous => previous.map(parcel => parcel.id !== sel.id ? parcel : { ...parcel, factures: parcel.factures.map(invoice => invoice.id === invoiceId ? keepArrival(invoice, result.facture) : invoice) }));
    settleDraft(invoiceId, { ...draftsRef.current[invoiceId], dirty: false, editing: !result.facture.duplicateOfId, editingExplicit: false, reviewToken: result.reviewToken });
    setRecords(previous => ({ ...previous, [invoiceId]: { ...previous[invoiceId], reviewToken: result.reviewToken } }));
    setReloadRequired(previous => ({ ...previous, [invoiceId]: false }));
  };
  const described = invoice => { const identity = identityOf(invoice); return `${numberLabel(invoice)} — ${name(invoice)} (${[identity.supplierKnown && identity.supplier, identity.amount !== null && amountText(identity), identity.receivedAt && `reçue le ${shortDate(identity.receivedAt)}`].filter(Boolean).join(', ') || 'à vérifier'})`; };
  const classify = original => askConfirm({ title: 'Retirer cette facture en double ?', msg: `Vous confirmez que ces deux documents correspondent au même achat.\n\nÀ retirer : ${described(selected)}.\nÀ conserver : ${described(original)}.\n\nLa copie et ses articles seront exclus du devis. Elle restera consultable et restaurable dans « Doublons retirés ».${draft?.dirty ? '\nLe brouillon non enregistré de la copie sera abandonné.' : ''}\nAucun message ne sera envoyé au client.`, okLabel: 'Retirer le doublon', danger: true, onOk: () => run('duplicate', async () => {
    const result = await sb.classifyInvoiceDuplicate(invoiceId, original.id, draft?.reviewToken || record?.reviewToken, records[original.id]?.reviewToken);
    applyClassification(result); setRemovingDuplicate(false);
    // Numbers after the removal: the copy leaves the count, so the original
    // may move up. The message uses the numbers the list now shows.
    const kept = invoiceNumbering(invoices.map(invoice => invoice.id === invoiceId ? keepArrival(invoice, result.facture) : invoice))[original.id]?.n;
    const before = numbering[original.id]?.n;
    const message = `Copie retirée : ${name(selected)} devient « Copie de la facture ${kept} ». La facture ${kept} est conservée (${shortName(identityOf(original))}${before && before !== kept ? `, numérotée ${before} avant le retrait` : ''}) ; la copie et ses articles sont exclus du devis.`;
    setHeaderFeedback({ type: 'success', message });
    await afterCommit(invoiceId, message);
    choose(original.id);
  }) });
  const restore = () => run('restore', async () => {
    const result = await sb.restoreInvoiceDuplicate(invoiceId, record?.reviewToken);
    applyClassification(result);
    setHeaderFeedback({ type: 'success', message: 'Facture restaurée dans les documents du dossier. Vérifiez ses articles avant de valider.' });
    await afterCommit(invoiceId, 'Facture remise à vérifier. Ses articles seront pris en compte après validation.');
  });
  const upload = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    await run('upload', async () => {
      const document = await sb.uploadDocument('factures', sel.id, file);
      const target = uploadTarget.current;
      const saved = target ? await sb.updateFacture(target, { fichierUrl: document.path, fichierNom: file.name, valide: false, rejetMotif: null }) : await sb.insertFacture(sel.id, { vendeur: 'Document à vérifier', montant: 0, fichierUrl: document.path, fichierNom: file.name, valide: false });
      setData(previous => previous.map(parcel => parcel.id === sel.id ? { ...parcel, factures: [...parcel.factures.filter(invoice => invoice.id !== saved.id), keepArrival(parcel.factures.find(invoice => invoice.id === saved.id), saved)] } : parcel));
      settleDraft(saved.id, null);
      choose(saved.id); setHeaderFeedback({ type: 'success', message: 'Document enregistré. Vous pouvez analyser ou saisir ses articles.' }); await afterCommit(saved.id, 'Document enregistré. Vous pouvez analyser ou saisir ses articles.');
    });
  };
  const manualEntry = () => askConfirm({ title: 'Saisir les articles manuellement ?', msg: 'Le brouillon de cette facture sera vidé. Les articles déjà enregistrés restent inchangés jusqu’à votre validation.', okLabel: 'Commencer la saisie', onOk: () => change({ vendeur: '', total: '', lines: [emptyLine()], extractionId: null, editing: true }) });
  const reject = () => run('reject', async () => {
    const saved = await sb.updateFacture(invoiceId, { valide: false, rejetMotif: reason.trim() });
    choose(invoiceId, 'articles');
    setData(previous => previous.map(parcel => parcel.id === sel.id ? { ...parcel, factures: parcel.factures.map(invoice => invoice.id === invoiceId ? keepArrival(invoice, saved) : invoice) } : parcel));
    settleDraft(invoiceId, { ...draftsRef.current[invoiceId], dirty: false, editing: false });
    setRejecting(false);
    await afterCommit(invoiceId, 'Correction enregistrée. Préparez la demande au client pour lui transmettre le motif. Aucun message n’a encore été envoyé.');
  });

  const displayed = showReview && selected ? selected : null;
  const identity = selected ? identityOf(selected) : null;
  const selectedState = selected ? invoiceState(selected, invoices) : null;
  const next = buckets.next;
  const nextNumber = next ? numbering[next.id]?.n : null;
  const nextState = next ? invoiceState(next, invoices) : null;
  const nextIdentity = next ? identityOf(next) : null;
  // One primary call to action at a time: no « Vérifier la facture n » above
  // invoice n itself, and no invitation the role cannot carry out.
  const nextShown = !!next && next.id === displayed?.id;
  const nextAllowed = nextState === 'missingFile' ? canAdd : canEdit;
  const showNextStep = editable && !documentsComplete && (next ? nextState === 'toCorrect' || !nextShown : buckets.pendingAttachments > 0);
  const total = buckets.total;
  const { remaining } = invoiceProgressSummary(buckets);
  // The completed summary carries the total; the header does not repeat it.
  const meta = [
    !documentsComplete && buckets.verifiedTotalHT > 0 && `Total vérifié ${eur(buckets.verifiedTotalHT)} HT`,
    retiredInvoices.length && plural(retiredInvoices.length, 'doublon retiré', 'doublons retirés'),
  ].filter(Boolean);
  const showQuote = editable && (!taskMode || !!onQuote);
  const canRequest = editable && can('perm_comm_demander_facture');
  // The next-step card carries the one primary call to action when shown.
  const cardPrimary = showNextStep && !!next && nextState !== 'toCorrect' && nextAllowed;
  // Legacy row validated without a total: not verified (invoiceState), so the
  // pane must not say it is.
  const incompleteValidation = !!selected?.valide && selectedState === 'toVerify';
  const copyOf = invoice => numbering[invoice.id]?.copyOf;
  const historyLabel = invoice => numbering[invoice.id]?.kind === 'duplicate'
    ? (copyOf(invoice) ? `Copie de la facture ${copyOf(invoice)}` : numbering[invoice.id]?.copyOfVersion ? `Copie d’un document remplacé (facture ${numbering[invoice.id].copyOfVersion})` : 'Copie retirée')
    : (numbering[invoice.id]?.versionOf ? `Ancienne version de la facture ${numbering[invoice.id].versionOf}` : 'Ancienne version');
  const headline = !selected ? '' : entry?.kind === 'counted' ? `Facture ${entry.n} sur ${entry.total}` : historyLabel(selected);
  const detail = !selected ? '' : entry?.kind === 'counted' ? identityText(identity) : name(selected);
  const paneHeading = !selected ? '' : selected.duplicateOfId ? 'Copie retirée' : historical ? 'Ancienne version' : selected.rejetMotif ? 'Articles en attente de correction' : !draft ? 'Articles' : selected.valide && !draft.editing ? incompleteValidation ? 'Articles à vérifier' : 'Articles vérifiés' : !editable ? 'Articles non vérifiés' : selected.valide ? 'Modification des articles vérifiés' : draft.extractionId ? 'Articles proposés' : 'Articles à vérifier';

  return <section ref={sectionRef} id="quote-documents" aria-label="Factures d’achat" className="invoice-workspace min-w-0 scroll-mt-48 rounded-2xl border border-gray-200 bg-white">
    <input ref={uploadRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={upload} />
    <div className="space-y-3 border-b border-gray-200 p-3 sm:p-4">
      <div className="min-w-0">
        <h2 className="iw-title" tabIndex={-1}><FileText size={19} aria-hidden="true" />{taskMode && editable ? 'Vérifier les factures' : 'Factures du dossier'}</h2>
        <p className="iw-progress">{!total ? <strong>{buckets.pendingAttachments ? 'Aucune facture enregistrée' : 'Aucune facture reçue'}</strong> : documentsComplete ? <><strong>{plural(total, 'facture', 'factures')}</strong> · {total === 1 ? 'vérifiée' : 'toutes vérifiées'}</> : <><strong>{buckets.verified.length} sur {total}</strong> {total === 1 ? 'facture vérifiée' : 'factures vérifiées'}</>}{remaining.length > 0 && <span className="iw-muted"> · {remaining.join(' · ')}</span>}</p>
        {meta.length > 0 && <p className="iw-meta-line">{meta.join(' · ')}</p>}
        {total > 0 && <div className="iw-bar" aria-hidden="true">{activeInvoices.map(invoice => <span key={invoice.id} data-state={invoiceState(invoice, invoices)} />)}</div>}
      </div>
      {/* Dossier-level actions, after the summary they never interrupt; the
          same rule in the work, summary and consultation views. */}
      {(canAdd || canRequest) && <div className="iw-actions">
        {canAdd && <button disabled={!!busy} className={SECONDARY} onClick={() => { uploadTarget.current = null; uploadRef.current?.click(); }}><Upload size={16} />Ajouter une facture</button>}
        {canRequest && <TaskMessage template="facture_manquante" label="Préparer une demande de facture" disabled={!!busy} />}
      </div>}
      {!editable && <p className="iw-banner"><Info size={18} aria-hidden="true" />Consultation uniquement : ce dossier est payé, terminé ou archivé.</p>}
      {headerFeedback && (headerFeedback.type === 'success' && documentsComplete
        // The green « Factures vérifiées » summary right below carries the
        // result: the acknowledgement stays visible on a neutral surface.
        ? <p data-testid="invoice-header-feedback" role="status" className="iw-banner iw-feedback"><Check size={18} aria-hidden="true" />{headerFeedback.message}</p>
        : <p data-testid="invoice-header-feedback" role={headerFeedback.type === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${headerFeedback.type === 'error' ? 'bg-red-50 text-red-700' : headerFeedback.type === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{headerFeedback.message}</p>)}
      {showNextStep && <div className="iw-next">
        {!next ? canAdd ? <p className="iw-next-text"><strong>Prochaine étape : trier les documents reçus</strong><span>Ajoutez comme facture les pièces qui en sont, depuis « Documents reçus à vérifier ».</span></p>
          : <p className="iw-next-text"><strong>Documents reçus en attente de tri</strong><span>Un membre de l’équipe autorisé à ajouter des factures peut les intégrer.</span></p>
          : nextState === 'toCorrect' ? <p className="iw-next-text"><strong>En attente de la correction du client (facture {nextNumber})</strong><span>{next.rejetMotif}</span></p>
          : nextAllowed ? <><p className="iw-next-text"><strong>{nextState === 'missingFile' ? `Prochaine étape : joindre le document de la facture ${nextNumber}` : `Prochaine étape : vérifier la facture ${nextNumber}`}</strong><span>{identityText(nextIdentity)}</span></p><button type="button" className="iw-primary" disabled={!!busy} onClick={() => chooseForReview(next.id)}>{nextState === 'missingFile' ? `Ouvrir la facture ${nextNumber}` : `Vérifier la facture ${nextNumber}`}<ChevronRight size={16} aria-hidden="true" /></button></>
          // Without the permission, say what remains and offer what the role allows: consulting it.
          : <><p className="iw-next-text"><strong>{nextState === 'missingFile' ? `Document de la facture ${nextNumber} à joindre` : `Facture ${nextNumber} en attente de vérification`}</strong><span>{identityText(nextIdentity)}</span></p><button type="button" className={SECONDARY} disabled={!!busy} onClick={() => consult(next.id)}>Consulter la facture {nextNumber}</button></>}
      </div>}
      {documentsComplete && <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <h3 ref={completedRef} tabIndex={-1} className="font-semibold text-emerald-800">Factures vérifiées</h3>
        <p className="text-sm text-emerald-800"><span className="tabular-nums">{plural(total, 'facture vérifiée', 'factures vérifiées')} · {eur(buckets.verifiedTotalHT)} HT.</span>{showQuote && ' Le devis peut être préparé.'}{!taskMode && ' Ces validations sont enregistrées ; vous n’avez pas à les refaire.'}</p>
        {workspace && <div className="flex flex-wrap gap-2">{showReview ? <button className={SECONDARY} disabled={!!busy || unfinishedReview} onClick={closeReview}>Revenir au récapitulatif</button> : <button className={SECONDARY} onClick={() => setReviewExpanded(true)}>Consulter les factures</button>}{showQuote && <button type="button" className="iw-primary" onClick={() => onQuote ? onQuote() : focusSection('quote-review')}>Passer au devis<ChevronRight size={16} aria-hidden="true" /></button>}</div>}
        {unfinishedReview && <p className="text-sm text-amber-800">Une vérification est en cours de modification. Les valeurs déjà validées restent utilisées jusqu’à votre prochaine validation.</p>}
      </div>}
      {unlinked.length > 0 && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><p>{unlinked.length} article(s) saisi(s) manuellement · {eur(unlinkedTotal)} HT restent inclus dans le devis, en plus des articles des factures. Vérifiez s’il s’agit d’achats supplémentaires ou de doublons.</p>{workspace && <button className={`${BUTTON} underline`} onClick={() => focusSection('quote-unlinked')}>Vérifier les articles manuels</button>}</div>}
    </div>
    {pendingInvoiceAttachments(sel).length > 0 && <details className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-3" open={!invoices.length}><summary className="min-h-11 cursor-pointer text-sm font-semibold text-amber-800">{CHEVRON}Documents reçus à vérifier ({pendingInvoiceAttachments(sel).length})</summary><section aria-label="Documents reçus à vérifier" className="space-y-3">{!editable ? <p className="text-sm font-semibold text-slate-600">Consultation uniquement : ce dossier est payé, terminé ou archivé.</p> : !canAdd && <p className="text-sm text-slate-600">Un membre de l’équipe autorisé à ajouter des factures peut les intégrer au dossier.</p>}<p className="text-xs text-slate-600">Ces pièces jointes sont dans la conversation. Ajoutez celles qui sont des factures pour les vérifier ici.</p>{pendingInvoiceAttachments(sel).map(message => <ConversationAttachment key={message.id} message={message} colis={sel} canImport={canAdd} preview importLabel="Ajouter comme facture" onImported={refresh} />)}</section></details>}
    {(activeInvoices.length > 0 || retiredInvoices.length > 0 || replacedInvoices.length > 0) && <div className="space-y-2 p-3 sm:p-4">
      {activeInvoices.length > 0 && <ol role="list" aria-label="Factures du dossier" className="iw-list">{activeInvoices.map(invoice => {
        const item = numbering[invoice.id];
        const known = identityOf(invoice);
        const label = invoiceStateLabel(invoice, invoices);
        const state = invoiceState(invoice, invoices);
        // The row says why it waits, never « Propositions prêtes » beside a
        // pill telling that the client must act or the document is missing.
        const work = state === 'toCorrect' ? '' : state === 'missingFile' ? 'En attente du document' : drafts[invoice.id]?.dirty ? 'Modifications non enregistrées' : records[invoice.id]?.draft ? 'Brouillon enregistré' : invoiceOcrNote(invoice, records[invoice.id]);
        const details = [known.receivedAt && `Reçue le ${shortDate(known.receivedAt)}`, known.articles > 0 && plural(known.articles, 'article', 'articles'), work].filter(Boolean);
        // A proposal is worth showing only while the invoice is being verified.
        const amount = known.amount !== null && !(known.amountSuggested && state === 'toCorrect') ? known.amount : null;
        return <li key={invoice.id}><button type="button" className="iw-item" data-invoice-id={invoice.id} disabled={!!busy} aria-current={displayed?.id === invoice.id ? 'true' : undefined} aria-label={`Facture ${item.n} sur ${item.total} · ${known.supplier} · ${label}`} aria-describedby={`iw-${invoice.id}-meta iw-${invoice.id}-amount`} onClick={() => choose(invoice.id, activeTab)}>
          <span className="iw-num" aria-hidden="true">{item.n}</span>
          <span className="iw-who"><span className="iw-supplier">{known.supplier}{known.supplierSuggested && <span className="iw-muted"> (proposé)</span>}</span><span id={`iw-${invoice.id}-meta`} className="iw-meta"><span className="iw-meta-items">{details.map((text, index) => <span key={index} className="iw-meta-item">{text}</span>)}{known.fileName && <span className="iw-meta-item"><span className="iw-file" title={known.fileName}>{known.fileName}</span></span>}</span>{state === 'toCorrect' && <span className="iw-reason" title={invoice.rejetMotif}>Correction demandée : {invoice.rejetMotif}</span>}</span></span>
          <span id={`iw-${invoice.id}-amount`} className="iw-amount">{amount === null ? <>—{state === 'toVerify' && <small>Montant à vérifier</small>}</> : <>{eur(amount)}<small>{known.amountSuggested ? 'proposé' : 'HT'}</small></>}</span>
          <span className="iw-pill" data-tone={TONE[state]} aria-hidden="true">{label}</span>
        </button></li>;
      })}</ol>}
      {retiredInvoices.length > 0 && <details open={selected?.duplicateOfId ? true : undefined} className="iw-history"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-700">{CHEVRON}Doublons retirés ({retiredInvoices.length})<History size={15} aria-hidden="true" /></summary><p className="mb-2 text-xs text-slate-600">{editable && can('perm_factures_valider') ? 'Exclus du devis. Ouvrez une copie pour la consulter ou la remettre à vérifier.' : 'Exclus du devis. Ouvrez une copie pour la consulter.'}</p><nav aria-label="Doublons retirés" className="flex flex-wrap gap-2">{retiredInvoices.map(invoice => <button key={invoice.id} disabled={!!busy} aria-current={displayed?.id === invoice.id ? 'true' : undefined} className={`${SECONDARY} max-w-full break-all text-left`} onClick={() => choose(invoice.id)}>{historyLabel(invoice)} — {name(invoice)}</button>)}</nav></details>}
      {replacedInvoices.length > 0 && <details open={historical && !selected?.duplicateOfId ? true : undefined} className="iw-history"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-700">{CHEVRON}Documents remplacés ({replacedInvoices.length})<History size={15} aria-hidden="true" /></summary><nav aria-label="Documents remplacés" className="flex flex-wrap gap-2">{replacedInvoices.map(invoice => <button key={invoice.id} disabled={!!busy} aria-current={displayed?.id === invoice.id ? 'true' : undefined} className={`${SECONDARY} max-w-full break-all text-left`} onClick={() => choose(invoice.id)}>{historyLabel(invoice)} — {name(invoice)}</button>)}</nav></details>}
    </div>}
    {!invoices.length && <p className="p-6 text-center text-sm text-slate-600">Aucune facture enregistrée.</p>}
    {loadError && <div role="alert" className="m-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadError}<button className={`${BUTTON} underline`} onClick={() => run('reload', loadContext)}>Réessayer le chargement</button></div>}
    {displayed && <>
      <div ref={currentRef} className="iw-current" role="group" aria-label="Facture affichée">
        <h3 ref={currentTitleRef} tabIndex={-1} className="iw-current-title"><strong>{headline}</strong><span className="iw-muted"> · {detail}</span></h3>
        <span className="iw-pill" data-tone={TONE[selectedState]}>{invoiceStateLabel(selected, invoices)}</span>
        {entry?.kind === 'counted' && <div className="iw-nav">{[['Facture précédente', -1], ['Facture suivante', 1]].map(([label, step]) => {
          // aria-disabled, not disabled: the button just pressed stays focusable
          // at the end of the list, so keyboard focus never falls to <body>.
          const target = activeInvoices[position + step];
          const off = !!busy || !target;
          return <button key={label} type="button" aria-label={label} className="iw-nav-button" aria-disabled={off || undefined} onClick={() => { if (!off) choose(target.id, activeTab); }}>{step < 0 && <ChevronLeft size={18} aria-hidden="true" />}<span className="iw-nav-label">{label}</span>{step > 0 && <ChevronRight size={18} aria-hidden="true" />}</button>;
        })}</div>}
      </div>
      {!inactive && editable && <details className="mx-3 mt-2 sm:mx-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-600">{CHEVRON}Autres actions sur cette facture</summary><div className="space-y-3">
            <div className="flex flex-wrap gap-2">{canAdd && selected.fichier && !inactive && <button data-field="document" disabled={!!busy} className={SECONDARY} onClick={() => { const pick = () => { uploadTarget.current = invoiceId; uploadRef.current?.click(); }; if (selected.fichier) askConfirm({ title: 'Remplacer le document source ?', msg: 'La validation sera annulée. Les articles devront être vérifiés à nouveau avec le nouveau fichier.', okLabel: 'Choisir un nouveau document', onOk: pick }); else pick(); }}><Upload size={15} />{selected.fichier ? 'Remplacer le document' : 'Joindre le document'}</button>}{editable && can('perm_factures_ocr') && selected.fichier && !!record?.extraction && !inactive && <button disabled={!!busy} className={SECONDARY} onClick={analyze}><Scan size={15} />{record?.extraction ? 'Reprendre l’analyse' : 'Analyser la facture'}</button>}</div>
            {!!draft?.extractionId && canEdit && !inactive && <button className={`${BUTTON} text-slate-600 underline`} disabled={!!busy} onClick={manualEntry}>Saisir les articles manuellement</button>}
      {selected && !inactive && editable && can('perm_factures_valider') && <div>
        <button disabled={!!busy || !record || isOriginalOfCopies || !selected.fichier || !originalCandidates.length} aria-expanded={removingDuplicate} className={`${SECONDARY} text-red-700`} onClick={() => { setRemovingDuplicate(!removingDuplicate); setOriginalId(originalCandidates.length === 1 ? originalCandidates[0].id : ''); }}>Retirer cette facture en double</button>
        {isOriginalOfCopies ? <p className="mt-1 text-xs text-slate-600">Cette facture est l’original de copies déjà retirées. Restaurez ces copies avant de changer d’original.</p> : !originalCandidates.length && <p className="mt-1 text-xs text-slate-600">Une autre facture active doit être présente pour choisir l’original à conserver.</p>}
        {removingDuplicate && <div role="group" aria-label="Retrait d’une facture en double" className="mt-3 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="break-words text-sm font-semibold text-slate-800">À retirer : {numberLabel(selected)} — {name(selected)}</p>
          <label className="block text-sm font-semibold text-slate-700">Facture originale à conserver<select aria-label="Facture originale à conserver" className={INPUT} value={originalId} onChange={event => setOriginalId(event.target.value)} disabled={!!busy}><option value="">Choisir la facture à conserver</option>{originalCandidates.map(invoice => <option key={invoice.id} value={invoice.id}>Facture {numbering[invoice.id]?.n} — {shortName(identityOf(invoice))} · {name(invoice)} · {amountText(identityOf(invoice))}</option>)}</select></label>
          <p className="text-sm text-slate-700">Confirmez qu’il s’agit du même achat, même si le nom du fichier ou le scan diffère. La copie sera exclue du devis et restera restaurable.</p>
          {chosenOriginal && <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-700">{CHEVRON}Comparer avec l’original à conserver</summary><p className="mb-2 text-sm text-slate-600">Facture {numbering[chosenOriginal.id]?.n} · {shortName(identityOf(chosenOriginal))} · {amountText(identityOf(chosenOriginal))} · {name(chosenOriginal)}</p><InlineDocument invoice={chosenOriginal} /></details>}
          <div className="flex flex-wrap gap-2"><button disabled={!!busy || !chosenOriginal || !records[originalId]?.reviewToken} className={`${BUTTON} bg-red-700 text-white`} onClick={() => chosenOriginal && classify(chosenOriginal)}>Vérifier le retrait</button><button disabled={!!busy} className={SECONDARY} onClick={() => setRemovingDuplicate(false)}>Annuler le retrait</button></div>
        </div>}
      </div>}
      </div></details>}
      <div ref={tabsRef} role="tablist" aria-label="Espace de vérification" className={`invoice-mobile-tabs grid grid-cols-2 gap-2 border-b border-gray-200 p-3 ${workspace ? 'invoice-wide-tabs' : ''}`}>{[['document', 'Voir la facture'], ['articles', editable ? 'Vérifier les articles' : 'Voir les articles']].map(([key, label]) => <button key={key} role="tab" aria-selected={activeTab === key} aria-controls={`invoice-${key}-${sel.id}`} id={`invoice-tab-${key}-${sel.id}`} className={`${BUTTON} ${activeTab === key ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setTab(key)}>{label}</button>)}</div>
      <div className={`invoice-panes ${workspace ? 'invoice-wide' : ''}`}>
        <div ref={documentRef} id={`invoice-document-${sel.id}`} tabIndex={-1} role="region" aria-label="Document source" className={`invoice-document min-w-0 scroll-mt-32 p-3 sm:p-4 ${activeTab === 'document' ? '' : 'invoice-pane-hidden'}`}><p className="mb-3 truncate text-sm font-semibold text-slate-800" title={name(selected)}>Document · {name(selected)}</p><InlineDocument invoice={selected} /></div>
        <div ref={editorRef} id={`invoice-articles-${sel.id}`} tabIndex={-1} role="region" aria-label="Vérification de la facture" className={`invoice-editor min-w-0 space-y-4 p-3 sm:p-4 ${activeTab === 'articles' ? '' : 'invoice-pane-hidden'}`}>
          <h4 className="iw-pane-heading">{paneHeading}</h4>
          {editable && !canEdit && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">Votre rôle permet la consultation. La modification des articles nécessite une autorisation.</p>}
          {selected.duplicateOfId && <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700"><p>{(original => original && copyOf(selected) ? `Copie de la facture ${copyOf(selected)} (${shortName(identityOf(original))} · ${name(original)}).` : `${historyLabel(selected)}${original ? ` (${name(original)})` : ''}.`)(invoices.find(invoice => invoice.id === selected.duplicateOfId))} Ce document et ses articles sont exclus du devis. Aucune validation n’est attendue pour cette copie.</p><button className={`${BUTTON} underline`} disabled={!!busy} onClick={() => choose(selected.duplicateOfId)}>Voir la facture originale</button>{editable && can('perm_factures_valider') && <button className={`${BUTTON} underline`} disabled={!!busy || !record} onClick={restore}>Remettre à vérifier</button>}</div>}
          {isReplaced(selected, invoices) && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">Ce document a été remplacé. Vérifiez la facture corrigée depuis la liste.</p>}
          {historical && feedback && (feedback.message === headerFeedback?.message
            ? <p data-testid="invoice-feedback" className="iw-feedback-echo">{feedback.message}</p>
            : <p data-testid="invoice-feedback" role={feedback.type === 'error' ? 'alert' : 'status'} className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{feedback.message}</p>)}
          {historical && (draft?.dirty || draft?.editingExplicit) && <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p role="alert">Cette facture fait désormais partie de l’historique. Votre saisie locale est conservée ; elle n’est pas appliquée au devis.</p>
            <details><summary className="min-h-11 cursor-pointer py-2 font-semibold">{CHEVRON}Voir ma saisie locale</summary><p>{draft.vendeur} · {eur(draft.total || 0)} HT</p><ul className="space-y-1">{draft.lines.map((line, position) => <li key={position}>{line.desc} · {line.qte} × {eur(line.prix || 0)} HT{line.cat && ` · ${categories.find(category => category.id === line.cat)?.label || line.cat}`}</li>)}</ul></details>
            <button className={SECONDARY} disabled={!!busy} onClick={returnToSaved}>Abandonner la saisie locale</button>
          </div>}
          {historical && reloadRequired[invoiceId] && <button className={SECONDARY} disabled={!!busy} onClick={requestReload}>Actualiser</button>}
          {selected.rejetMotif && <div className="space-y-3 rounded-xl bg-red-50 p-3"><p className="text-sm text-red-700">Correction attendue : {selected.rejetMotif}</p>{!historical && editable && can('perm_factures_refuser') && <TaskMessage key={`correction-${selected.id}`} template={null} disabled={!!busy} label="Préparer la demande de correction" message={`Bonjour ${getPrenom(getClient(sel.clientId)) || getClient(sel.clientId)?.nom || ''},\n\nLa facture ${name(selected)} du dossier ${sel.ref} nécessite une correction : ${selected.rejetMotif}.\n\nMerci de joindre le document corrigé dans votre espace client.\n\nL’équipe Expedîle`} />}</div>}
          {!!duplicateCandidates.length && !inactive && !isOriginalOfCopies && <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"><p className="font-semibold">Document identique reçu plusieurs fois</p>{duplicateCandidates.map(original => <div key={original.id}><button className="min-h-11 text-left underline" onClick={() => choose(original.id)}>Voir la {numberLabel(original)} — {name(original)}</button>{editable && can('perm_factures_valider') && <button disabled={!!busy || !record || !records[original.id]} className={SECONDARY} onClick={() => classify(original)}>Retirer cette copie</button>}</div>)}<p className="text-xs">Gardez un seul original dans le devis. Le fichier et son historique sont conservés.</p></div>}
          {loading && !draft && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={16} className="animate-spin" />Chargement de la vérification…</p>}
          {draft && !historical && <>
            {selected.valide && !draft.editing && <div className="space-y-1">
              {incompleteValidation
                ? <p className="iw-warnline"><AlertTriangle size={16} aria-hidden="true" />Validation incomplète : total HT manquant · {plural(draft.lines.length, 'article', 'articles')}</p>
                : <p className="iw-okline"><Check size={16} aria-hidden="true" />{identity.validatedAt ? `Vérifiée le ${shortDate(identity.validatedAt)}` : 'Vérifiée'} · {plural(draft.lines.length, 'article', 'articles')}</p>}
              {draft.lines.length > 0 && <ul role="list" className="iw-lines">{draft.lines.map((line, position) => <li key={position}><span>{line.desc}</span><span>{line.qte} × {eur(line.prix)}</span></li>)}</ul>}
              {!incompleteValidation && <p className="iw-total"><span>Total de la facture</span><span>{eur(selected.montant)} HT</span></p>}
              {record?.draft && <p className="text-sm text-slate-600">Un brouillon enregistré reste disponible ; il ne remplace pas cette validation.</p>}
              {canEdit && !inactive && <button ref={modifyRef} className={SECONDARY} disabled={!!busy} onClick={() => { focusAfter.current = [() => sectionRef.current?.querySelector('[data-field="vendor"]')]; setDrafts(previous => ({ ...previous, [invoiceId]: { ...(record?.draft ? seedDraft(selected, record, sel.lignes || []) : draft), editing: true, editingExplicit: true } })); }}>{record?.draft ? 'Reprendre le brouillon' : 'Modifier la vérification'}</button>}
            </div>}
            {draft.editing && <>
            {selected.valide && <button className={SECONDARY} disabled={!!busy} onClick={returnToSaved}>Revenir à la version validée</button>}
            {canAdd && !selected.fichier && !inactive && <button data-field="document" disabled={!!busy} className={SECONDARY} onClick={() => { uploadTarget.current = invoiceId; uploadRef.current?.click(); }}><Upload size={15} />Joindre le document</button>}
            {editable && can('perm_factures_ocr') && selected.fichier && !record?.extraction && !inactive && <div><button disabled={!!busy || !record} className={SECONDARY} onClick={analyze}><Scan size={15} />Analyser la facture</button><p className="mt-1 text-xs text-slate-600">La lecture automatique propose les articles. Vérifiez les propositions avant validation.</p></div>}
            {record?.extraction && !inactive && <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800"><p>{draft.extractionId ? 'Propositions de l’analyse : vérifiez les articles et leurs catégories.' : 'Une analyse du document est disponible. Vos articles enregistrés sont conservés.'}</p>{!draft.extractionId && <p className="mt-2 text-xs">Analyse : {record.extraction.vendeur || 'Vendeur à vérifier'} · {record.extraction.total > 0 ? eur(record.extraction.total) : 'Total à vérifier'} · {(record.extraction.lines || []).length} article(s).</p>}{!draft.extractionId && canEdit && <button className={`${BUTTON} underline`} disabled={!!busy} onClick={useAnalysis}>Utiliser les propositions</button>}{(record.extraction.warnings || []).map((warning, i) => <p className="mt-1 text-xs" key={i}>{typeof warning === 'string' ? warning : warning.message}</p>)}</div>}

            <fieldset disabled={fieldsDisabled} className="min-w-0 space-y-3">
              <legend className="mb-2 text-sm font-semibold text-slate-800">Montants de la facture</legend><p className="text-xs text-slate-600">Utilisez les montants HT imprimés, sans recalculer la TVA. Si le HT n’est pas indiqué, demandez une précision au client.</p>
              <label className="block text-xs font-semibold text-slate-600">Vendeur<input aria-label="Vendeur de la facture" data-field="vendor" maxLength={500} className={INPUT} value={draft.vendeur} onChange={event => change({ vendeur: event.target.value })} /></label>
              <label className="block text-xs font-semibold text-slate-600">Total HT de la facture (€)<input aria-label="Total HT de la facture" data-field="total" type="number" step="0.01" min="0.01" className={INPUT} value={draft.total} onChange={event => change({ total: event.target.value })} /></label>
              <div className="flex items-center justify-between gap-2"><h5 className="text-sm font-semibold text-slate-800">Articles ({draft.lines.length})</h5><span className="text-sm tabular-nums text-slate-600">Total : {eur(draft.lines.reduce((value, line) => value + Number(line.qte || 0) * Number(line.prix || 0), 0))} HT</span></div>
              <p className="text-xs text-slate-600">{draft.lines.filter(line => categories.some(category => category.id === line.cat)).length} / {draft.lines.length} catégorie(s) renseignée(s). Comparez aussi quantités et prix avec la facture.</p>
              {draft.lines.length > 5 && <label className="block text-sm font-semibold text-slate-600">Aller à un article<select aria-label="Aller à un article" className={INPUT} defaultValue="" onChange={event => { if(event.target.value !== "") focusField(`cat-${event.target.value}`); }}><option value="" disabled>Choisir un article</option>{draft.lines.map((line, position) => <option key={position} value={position}>{position + 1}. {line.desc || "Description à compléter"}{!line.cat ? " · Catégorie à choisir" : ""}</option>)}</select></label>}
              {draft.lines.map((line, position) => <ArticleReview key={`${invoiceId}:${position}`} initialOpen={draft.lines.length <= 5 || issues.some(issue => new RegExp(`^(desc|qte|prix|cat)-${position}$`).test(issue.field))} summary={<>Article {position + 1} · {line.desc || "Description à compléter"}<span className="mt-1 block text-xs font-normal text-slate-600">{line.qte || "—"} × {line.prix !== "" ? eur(line.prix) : "—"} HT · {categories.find(category => category.id === line.cat)?.label || "Catégorie à choisir"}</span></>}><fieldset className="min-w-0 space-y-2"><legend className="sr-only">Article {position + 1}</legend>
                <label className="block text-xs text-slate-600">Description<textarea rows={2} maxLength={1000} aria-label={`Description de l’article ${position + 1}`} data-field={`desc-${position}`} className={INPUT} value={line.desc} onChange={event => changeLine(position, { desc: event.target.value })} /></label>
                <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-600">Quantité<input type="number" min="1" step="1" aria-label={`Quantité de l’article ${position + 1}`} data-field={`qte-${position}`} className={INPUT} value={line.qte} onChange={event => changeLine(position, { qte: event.target.value })} /></label><label className="text-xs text-slate-600">Prix unitaire HT (€)<input type="number" min="0" step="0.01" aria-label={`Prix unitaire HT de l’article ${position + 1}`} data-field={`prix-${position}`} className={INPUT} value={line.prix} onChange={event => changeLine(position, { prix: event.target.value })} /></label></div>
                <label className="block text-xs text-slate-600">Catégorie<select aria-label={`Catégorie de l’article ${position + 1}`} data-field={`cat-${position}`} aria-invalid={!line.cat || undefined} className={INPUT} value={line.cat || ''} onChange={event => changeLine(position, { cat: event.target.value })}><option value="">Choisir une catégorie</option>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
                {!line.cat && <p className="text-xs font-semibold text-amber-800">Choisissez une catégorie pour cet article.</p>}
                <button className={`${BUTTON} text-red-700`} aria-label={`Retirer l’article ${position + 1}`} onClick={() => change({ lines: draft.lines.filter((_, i) => position !== i) })}><X size={14} />Retirer l’article</button>
              </fieldset></ArticleReview>)}
              <button data-field="add-line" className={`${SECONDARY} w-full border-dashed`} onClick={() => change({ lines: [...draft.lines, emptyLine()] })}><Plus size={16} />Ajouter un article à cette facture</button>
            </fieldset>
            </>}
            <div data-testid="invoice-action-bar" className="space-y-3 border-t border-gray-200 pt-4">
              {selectedState === 'toCorrect' && entry?.n && <p className="text-sm text-slate-700"><span className="tabular-nums">Facture {entry.n} sur {entry.total}</span> · {shortName(identity)} — en attente de la correction du client</p>}
              {!inactive && draft.editing && canEdit && entry?.n && <p className="text-sm text-slate-700">Vous validez : <strong className="font-semibold tabular-nums text-slate-800">Facture {entry.n} sur {entry.total} · {shortName(identity)}</strong></p>}
              {feedback && (feedback.message === headerFeedback?.message
                // Already announced by the header: a quiet local reminder near
                // the buttons, not a second live region or a second coloured box.
                ? <p data-testid="invoice-feedback" className="iw-feedback-echo">{feedback.message}</p>
                : <p data-testid="invoice-feedback" role={feedback.type === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${feedback.type === 'error' ? 'bg-red-50 text-red-700' : feedback.type === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{feedback.message}</p>)}
              {draft.dirty && <p className="text-xs font-semibold text-amber-800">Modifications non enregistrées. Le changement de facture conserve votre saisie ; enregistrez le brouillon avant de quitter le dossier.</p>}
              {record?.reviewToken && draft.reviewToken !== record.reviewToken && draft.dirty && <p role="alert" className="text-sm text-amber-800">La version enregistrée a changé. Votre saisie est conservée. Version enregistrée : {selected.vendeur} · {eur(selected.montant || 0)} HT. Rechargez pour retrouver les modifications de votre collègue.</p>}
              {!!reloadRequired[invoiceId] && <button className={SECONDARY} disabled={!!busy} onClick={requestReload}>Actualiser</button>}
              {!inactive && draft.editing && canEdit && <>
                {!!issues.length && <div id={`invoice-blockers-${invoiceId}`} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><p className="font-semibold">Avant de valider</p><ul className="mt-1 list-disc space-y-1 pl-4">{issues.map((issue, i) => <li key={i}><button className="min-h-11 text-left underline underline-offset-2" onClick={() => focusField(issue.field)}>{issue.message}</button></li>)}</ul></div>}
                <button aria-describedby={issues.length ? `invoice-blockers-${invoiceId}` : undefined} disabled={!!busy || !canValidate || !!reloadRequired[invoiceId] || !record} onClick={() => save(true)} className={`${BUTTON} w-full bg-emerald-700 text-white`}>{busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{taskMode ? pending.some(invoice => invoice.id !== invoiceId) ? 'Valider et passer à la suivante' : 'Terminer la vérification' : 'Valider cette facture et ses articles'}</button>
                {!canValidate && <p className="text-xs text-slate-600">Vous pouvez enregistrer le brouillon. La validation nécessite l’autorisation de votre responsable.</p>}
                <button disabled={!!busy || !!reloadRequired[invoiceId] || !record} onClick={() => save(false)} className={`${SECONDARY} w-full`}>Enregistrer le brouillon</button>
                <p className="text-xs text-slate-600">Une seule validation enregistre ensemble la facture et ses articles pour le devis. Aucun message n’est envoyé au client.</p>
              </>}
              {canEdit && selected.valide && !draft.editing && pending.some(invoice => invoice.id !== invoiceId) && <button type="button" className={cardPrimary ? `${SECONDARY} w-full` : 'iw-primary w-full'} disabled={!!busy} onClick={() => chooseForReview(pending.find(invoice => invoice.id !== invoiceId).id)}>Facture suivante à vérifier<ChevronRight size={16} aria-hidden="true" /></button>}
              {!inactive && editable && can('perm_factures_refuser') && <button className={`${BUTTON} text-red-700`} disabled={!!busy} onClick={() => setRejecting(!rejecting)}>Demander une correction au client</button>}
              {rejecting && <div className="space-y-2 rounded-xl border border-red-200 p-3"><label className="block text-xs font-semibold text-slate-600">Correction attendue<textarea aria-label="Motif de correction" rows={3} className={INPUT} value={reason} onChange={event => setReason(event.target.value)} /></label><p className="text-xs text-slate-600">Le document sera marqué à remplacer. Vous préparerez ensuite le message au client avec ce motif et choisirez le canal avant l’envoi.</p><button className={`${BUTTON} bg-red-700 text-white`} disabled={!!busy || !reason.trim()} onClick={reject}>Enregistrer la correction</button><button className={SECONDARY} disabled={!!busy} onClick={() => setRejecting(false)}>Annuler</button></div>}
            </div>
          </>}

        </div>
      </div>
    </>}
    {!selected && feedback && <p role="status" className="p-3 text-sm text-slate-700">{feedback.message}</p>}
    {children && <div className="iw-extra border-t border-gray-200 p-3 sm:p-4">{children}</div>}
  </section>;
}
