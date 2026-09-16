import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, FileText, Loader2, Plus, Scan, Upload, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import * as sb from '../../lib/supabaseData';
import { supabase } from '../../lib/supabase';
import { functionErrorMessage } from '../../services/functionErrors';
import { eur, getPrenom } from '../../utils';
import { currentInvoices } from '../../domain/invoiceDocuments';
import InlineDocument from './InvoiceDocument';
import { ConversationAttachment, pendingInvoiceAttachments, conversationInvoiceEditable } from './ChatPanel';

const INPUT = 'min-h-11 min-w-0 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-70';
const BUTTON = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';
const SECONDARY = `${BUTTON} border border-gray-300 bg-white text-slate-700`;
const emptyLine = () => ({ desc: '', qte: 1, prix: '', cat: '' });
// Memory only, scoped to the signed-in operator. Navigation inside the app
// must not throw away an unfinished review; durable saves use the server RPC.
const reviewDraftCache = new Map();
const name = invoice => invoice?.fichierNom || invoice?.vendeur || 'Document sans nom';
const isReplaced = (invoice, invoices) => invoices.some(other => other.replacesFactureId === invoice.id);
const stateLabel = (invoice, invoices) => invoice.duplicateOfId ? 'Retirée · doublon' : isReplaced(invoice, invoices) ? 'Remplacée' : invoice.rejetMotif ? 'À remplacer' : invoice.valide ? 'Validée' : 'À vérifier';

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
  const { sel, auth, categories = [], can, setData, refreshColis, refreshWork, setCfm: askConfirm, getClient, sendMsg } = useApp();
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
  const resumedFiles = useRef(new Set());
  const invoices = sel?.factures || [];
  const activeInvoices = currentInvoices(invoices);
  const retiredInvoices = invoices.filter(invoice => invoice.duplicateOfId);
  const replacedInvoices = invoices.filter(invoice => !invoice.duplicateOfId && !activeInvoices.some(active => active.id === invoice.id));
  const selected = invoices.find(invoice => invoice.id === selectedId) || activeInvoices.find(invoice => !invoice.valide && !invoice.rejetMotif) || activeInvoices[0] || invoices[0];
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
  const pending = activeInvoices.filter(invoice => stateLabel(invoice, invoices) === 'À vérifier');
  const unlinked = (sel?.lignes || []).filter(line => !line.factureId);
  const unlinkedTotal = unlinked.reduce((total, line) => total + Number(line.qte || 0) * Number(line.prix || 0), 0);
  const documentsComplete = activeInvoices.length > 0 && activeInvoices.every(invoice => invoice.valide && !invoice.rejetMotif && invoice.fichier && invoice.montant > 0) && !pendingInvoiceAttachments(sel).length;
  const unfinishedReview = Object.values(drafts).some(item => item.dirty || item.editing && item.editingExplicit);
  const showReview = !workspace || !documentsComplete || reviewExpanded || !!requestedId || unfinishedReview;
  const index = invoices.findIndex(invoice => invoice.id === invoiceId);
  const navigationInvoices = selected?.duplicateOfId ? retiredInvoices : activeInvoices;
  const navigationIndex = navigationInvoices.findIndex(invoice => invoice.id === invoiceId);
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
    if (!showReview || historical || !selected?.fichier || !canResume || resumedFiles.current.has(fileKey)) return;
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
  }, [invoiceId, selected?.fichier, canResume, sel?.id, loadContext, showReview, historical]);
  useEffect(() => {
    if (requestedId) {
      setSelectedId(requestedId);
      setTab(requestedTab.current?.id === requestedId ? requestedTab.current.tab : 'document');
    }
    requestedTab.current = null;
  }, [requestedId, location.key]);
  useEffect(() => {
    if (!requestedId || activeTab !== 'document' || loading) return;
    const frame = requestAnimationFrame(() => { sectionRef.current?.scrollIntoView({ block: 'start' }); documentRef.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [requestedId, activeTab, loading]);
  useEffect(() => {
    const warn = event => { if (Object.values(draftsRef.current).some(item => item.dirty)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  if (!sel) return null;
  const feedbackFor = (id, message, type = 'success') => { if (alive.current) setFeedbacks(previous => ({ ...previous, [id || 'general']: { message, type } })); };
  const change = changes => setDrafts(previous => ({ ...previous, [invoiceId]: { ...previous[invoiceId], ...changes, dirty: true } }));
  const changeLine = (position, changes) => change({ lines: draft.lines.map((line, i) => i === position ? { ...line, ...changes } : line) });
  const choose = (id, nextTab) => {
    setSelectedId(id); setReviewExpanded(true); setRejecting(false); setReason(''); setRemovingDuplicate(false); setOriginalId('');
    if (nextTab) setTab(nextTab);
    if (requestedId && requestedId !== id) {
      requestedTab.current = { id, tab: nextTab || 'document' };
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
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: 'start' }));
  };
  const chooseForReview = id => { choose(id, 'articles'); requestAnimationFrame(() => { editorRef.current?.scrollIntoView({ block: 'start' }); editorRef.current?.focus({ preventScroll: true }); }); };
  const returnToSaved = () => {
    const close = () => setDrafts(previous => ({ ...previous, [invoiceId]: { ...seedDraft(selected, { ...record, draft: null, extraction: null }, sel.lignes || []), editing: false, editingExplicit: false, viewingSaved: true } }));
    if (!draft?.dirty) return close();
    askConfirm({ title: historical ? 'Abandonner la saisie locale ?' : 'Fermer sans enregistrer ?', msg: 'Vos modifications non enregistrées seront abandonnées. La version enregistrée du dossier est conservée.' + (record?.draft ? ' Le brouillon déjà enregistré restera disponible.' : ''), okLabel: historical ? 'Abandonner la saisie locale' : 'Revenir à la version validée', onOk: close });
  };
  const focusField = field => { const element = editorRef.current?.querySelector(`[data-field="${field}"]`); element?.focus(); element?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const run = async (key, operation) => {
    if (busyRef.current) return;
    const target = invoiceId || 'general';
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
  const save = confirm => run('save', async () => {
    if (confirm && issues.length) { feedbackFor(invoiceId, issues[0].message, 'error'); focusField(issues[0].field); return; }
    if (confirm && draft.extractionId) await invokeOCR(selected, 'resume');
    const result = await sb.saveInvoiceReview(selected, draft, confirm);
    // Apply the acknowledged transaction immediately: a later refresh failure is
    // not a failed save and must never invite a second import.
    setData(previous => previous.map(parcel => parcel.id !== sel.id ? parcel : {
      ...parcel, factures: parcel.factures.map(invoice => invoice.id === invoiceId ? result.facture : invoice),
      lignes: confirm ? [...(parcel.lignes || []).filter(line => line.factureId !== invoiceId), ...(result.insertedLignes || []).map(line => ({ ...line, factureId: invoiceId }))] : parcel.lignes,
    }));
    setDrafts(previous => ({ ...previous, [invoiceId]: { ...draft, dirty: false, editing: !confirm, editingExplicit: !confirm, reviewToken: result.reviewToken } }));
    setRecords(previous => ({ ...previous, [invoiceId]: { ...previous[invoiceId], reviewToken: result.reviewToken } }));
    const refreshed = await afterCommit(invoiceId, confirm ? `Facture ${index + 1} — ${name(selected)} : facture et articles validés et enregistrés.` : `Brouillon enregistré pour ${name(selected)}. Il sera disponible à la prochaine ouverture.`);
    if (taskMode && confirm && refreshed) {
      const freshInvoices = parcelRef.current.factures || [];
      const next = currentInvoices(freshInvoices).find(invoice => invoice.id !== invoiceId && stateLabel(invoice, freshInvoices) === 'À vérifier');
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
    setData(previous => previous.map(parcel => parcel.id !== sel.id ? parcel : { ...parcel, factures: parcel.factures.map(invoice => invoice.id === invoiceId ? result.facture : invoice) }));
    setDrafts(previous => ({ ...previous, [invoiceId]: { ...previous[invoiceId], dirty: false, editing: !result.facture.duplicateOfId, editingExplicit: false, reviewToken: result.reviewToken } }));
    setRecords(previous => ({ ...previous, [invoiceId]: { ...previous[invoiceId], reviewToken: result.reviewToken } }));
    setReloadRequired(previous => ({ ...previous, [invoiceId]: false }));
  };
  const classify = original => askConfirm({ title: 'Retirer cette facture en double ?', msg: `Vous confirmez que ces deux documents correspondent au même achat.\n\nÀ retirer : facture ${index + 1} — ${name(selected)}.\nÀ conserver : facture ${invoices.indexOf(original) + 1} — ${name(original)}.\n\nLa copie et ses articles seront exclus du devis. Elle restera consultable et restaurable dans « Doublons retirés ».${draft?.dirty ? '\nLe brouillon non enregistré de la copie sera abandonné.' : ''}\nAucun message ne sera envoyé au client.`, okLabel: 'Retirer le doublon', danger: true, onOk: () => run('duplicate', async () => {
    const result = await sb.classifyInvoiceDuplicate(invoiceId, original.id, draft?.reviewToken || record?.reviewToken, records[original.id]?.reviewToken);
    applyClassification(result); setRemovingDuplicate(false);
    const message = `Facture ${index + 1} retirée comme doublon. La facture ${invoices.indexOf(original) + 1} est conservée ; la copie et ses articles sont exclus du devis.`;
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
      setData(previous => previous.map(parcel => parcel.id === sel.id ? { ...parcel, factures: [...parcel.factures.filter(invoice => invoice.id !== saved.id), saved] } : parcel));
      setDrafts(previous => { const next = { ...previous }; delete next[saved.id]; return next; });
      choose(saved.id); setHeaderFeedback({ type: 'success', message: 'Document enregistré. Vous pouvez analyser ou saisir ses articles.' }); await afterCommit(saved.id, 'Document enregistré. Vous pouvez analyser ou saisir ses articles.');
    });
  };
  const requestInvoices = channel => run('request', async () => {
    await sendMsg(sel.id, sel.clientId, channel, 'facture_manquante', null);
    setHeaderFeedback({ type: 'success', message: 'La demande de facture est prise en charge par la messagerie.' });
    feedbackFor(invoiceId, 'La demande de facture est prise en charge par la messagerie.');
  });
  const manualEntry = () => askConfirm({ title: 'Saisir les articles manuellement ?', msg: 'Le brouillon de cette facture sera vidé. Les articles déjà enregistrés restent inchangés jusqu’à votre validation.', okLabel: 'Commencer la saisie', onOk: () => change({ vendeur: '', total: '', lines: [emptyLine()], extractionId: null, editing: true }) });
  const reject = () => run('reject', async () => {
    const saved = await sb.updateFacture(invoiceId, { valide: false, rejetMotif: reason.trim() });
    setData(previous => previous.map(parcel => parcel.id === sel.id ? { ...parcel, factures: parcel.factures.map(invoice => invoice.id === invoiceId ? saved : invoice) } : parcel));
    setDrafts(previous => ({ ...previous, [invoiceId]: { ...previous[invoiceId], dirty: false, editing: false } }));
    setRejecting(false);
    const client = getClient(sel.clientId);
    const text = `Bonjour ${getPrenom(client) || client?.nom || ''},\n\nLa facture ${name(selected)} du dossier ${sel.ref} nécessite une correction : ${reason.trim()}.\n\nMerci de joindre le document corrigé dans votre espace client.\n\nL’équipe Expedîle`;
    try { await sendMsg(sel.id, sel.clientId, client?.telegramChatId ? 'telegram' : 'email', null, text, { replyToMessageId: selected.telegramMsgId || undefined }); }
    catch (error) { await afterCommit(invoiceId, `Correction enregistrée. La notification n’a pas pu être envoyée : ${error.message}`, 'warning'); return; }
    await afterCommit(invoiceId, 'Correction enregistrée. La demande est prise en charge par la messagerie.');
  });

  return <section ref={sectionRef} id="quote-documents" aria-label="Factures d’achat" className="invoice-workspace min-w-0 scroll-mt-48 rounded-2xl border border-gray-200 bg-white">
    <input ref={uploadRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={upload} />
    <div className="space-y-3 border-b border-gray-200 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-base font-bold text-slate-800"><FileText size={19} />{taskMode ? 'Vérifier les factures' : 'Factures du dossier'} <span className="rounded-full bg-slate-100 px-2 py-0.5 text-sm">{activeInvoices.length}</span></h2><p className="mt-1 text-sm text-slate-600">{pending.length ? `${pending.length} à vérifier` : invoices.length ? 'Aucune facture en attente' : 'Ajoutez les factures reçues'} · {activeInvoices.filter(invoice => invoice.valide).length} validée(s){invoices.some(invoice => invoice.duplicateOfId) && ` · ${retiredInvoices.length} doublon(s) retiré(s)`}</p></div>{canAdd && <button disabled={!!busy} className={SECONDARY} onClick={() => { uploadTarget.current = null; uploadRef.current?.click(); }}><Upload size={16} />Ajouter une facture</button>}</div>
      {headerFeedback && <p data-testid="invoice-header-feedback" role={headerFeedback.type === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${headerFeedback.type === 'error' ? 'bg-red-50 text-red-700' : headerFeedback.type === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{headerFeedback.message}</p>}
      {documentsComplete && <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <h3 className="font-semibold text-emerald-800">Factures vérifiées</h3>
        <p className="text-sm text-emerald-800">{activeInvoices.length} facture(s) validée(s) · {eur(activeInvoices.reduce((total, invoice) => total + Number(invoice.montant), 0))} HT.{!taskMode && ' Ces validations sont enregistrées ; vous n’avez pas à les refaire.'}</p>
        {workspace && <div className="flex flex-wrap gap-2">{showReview ? <button className={SECONDARY} disabled={!!busy || unfinishedReview} onClick={closeReview}>Revenir au récapitulatif</button> : <button className={SECONDARY} onClick={() => setReviewExpanded(true)}>Consulter les factures</button>}{(!taskMode || onQuote) && <button className={`${BUTTON} bg-slate-700 text-white`} onClick={() => onQuote ? onQuote() : focusSection('quote-review')}>Passer au devis</button>}</div>}
        {unfinishedReview && <p className="text-sm text-amber-800">Une vérification est en cours de modification. Les valeurs déjà validées restent utilisées jusqu’à votre prochaine validation.</p>}
      </div>}
      {showReview && <>
      {!taskMode && <nav aria-label="Factures du dossier" className="flex gap-2 overflow-x-auto pb-1">{activeInvoices.map(invoice => <button key={invoice.id} disabled={!!busy} aria-label={`Facture ${invoices.indexOf(invoice) + 1} — ${name(invoice)}`} aria-current={invoiceId === invoice.id ? 'true' : undefined} onClick={() => choose(invoice.id)} className={`min-h-20 w-52 shrink-0 rounded-xl border p-3 text-left ${invoice.id === invoiceId ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-slate-50'}`}><span className="block text-xs font-semibold text-slate-600">Facture {invoices.indexOf(invoice) + 1} · {stateLabel(invoice, invoices)}</span><span className="mt-1 block truncate text-sm font-semibold text-slate-800" title={name(invoice)}>{name(invoice)}</span><span className="block text-xs text-slate-600">{drafts[invoice.id]?.dirty ? 'Modifications non enregistrées' : records[invoice.id]?.draft ? 'Brouillon enregistré' : invoice.montant > 0 ? `${eur(invoice.montant)} HT` : 'Montant à vérifier'}</span></button>)}</nav>}
      {!!activeInvoices.length && <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">Facture à vérifier<select aria-label="Facture à vérifier" disabled={!!busy} value={historical ? '' : invoiceId || ''} onChange={event => choose(event.target.value)} className={INPUT}>{historical && <option value="" disabled>Consultation de l’historique</option>}{activeInvoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoices.indexOf(invoice) + 1}. {name(invoice)} · {stateLabel(invoice, invoices)}</option>)}</select></label><button aria-label="Facture précédente" className={SECONDARY} disabled={!!busy || navigationIndex <= 0} onClick={() => choose(navigationInvoices[navigationIndex - 1].id)}><ChevronLeft size={18} /></button><button aria-label="Facture suivante" className={SECONDARY} disabled={!!busy || navigationIndex >= navigationInvoices.length - 1} onClick={() => choose(navigationInvoices[navigationIndex + 1].id)}><ChevronRight size={18} /></button></div>}
      {retiredInvoices.length > 0 && <details open={selected?.duplicateOfId ? true : undefined} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-700">Doublons retirés ({retiredInvoices.length})</summary><p className="mb-2 text-xs text-slate-600">Exclus du devis. Ouvrez une copie pour la consulter ou la remettre à vérifier.</p><nav aria-label="Doublons retirés" className="flex flex-wrap gap-2">{retiredInvoices.map(invoice => <button key={invoice.id} disabled={!!busy} aria-current={invoiceId === invoice.id ? 'true' : undefined} className={`${SECONDARY} max-w-full break-all text-left`} onClick={() => choose(invoice.id)}>Facture {invoices.indexOf(invoice) + 1} — {name(invoice)}</button>)}</nav></details>}
      {replacedInvoices.length > 0 && <details open={historical && !selected?.duplicateOfId ? true : undefined} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-700">Documents remplacés ({replacedInvoices.length})</summary><nav aria-label="Documents remplacés" className="flex flex-wrap gap-2">{replacedInvoices.map(invoice => <button key={invoice.id} disabled={!!busy} className={`${SECONDARY} max-w-full break-all text-left`} onClick={() => choose(invoice.id)}>Facture {invoices.indexOf(invoice) + 1} — {name(invoice)}</button>)}</nav></details>}
      {selected && !inactive && editable && can('perm_factures_valider') && <div>
        <button disabled={!!busy || !record || isOriginalOfCopies || !selected.fichier || !originalCandidates.length} aria-expanded={removingDuplicate} className={`${SECONDARY} text-red-700`} onClick={() => { setRemovingDuplicate(!removingDuplicate); setOriginalId(originalCandidates.length === 1 ? originalCandidates[0].id : ''); }}>Retirer cette facture en double</button>
        {isOriginalOfCopies ? <p className="mt-1 text-xs text-slate-600">Cette facture est l’original de copies déjà retirées. Restaurez ces copies avant de changer d’original.</p> : !originalCandidates.length && <p className="mt-1 text-xs text-slate-600">Une autre facture active doit être présente pour choisir l’original à conserver.</p>}
        {removingDuplicate && <div role="group" aria-label="Retrait d’une facture en double" className="mt-3 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="break-words text-sm font-semibold text-slate-800">À retirer : facture {index + 1} — {name(selected)}</p>
          <label className="block text-sm font-semibold text-slate-700">Facture originale à conserver<select aria-label="Facture originale à conserver" className={INPUT} value={originalId} onChange={event => setOriginalId(event.target.value)} disabled={!!busy}><option value="">Choisir la facture à conserver</option>{originalCandidates.map(invoice => <option key={invoice.id} value={invoice.id}>Facture {invoices.indexOf(invoice) + 1} — {name(invoice)} · {invoice.montant > 0 ? `${eur(invoice.montant)} HT` : 'Montant à vérifier'}</option>)}</select></label>
          <p className="text-sm text-slate-700">Confirmez qu’il s’agit du même achat, même si le nom du fichier ou le scan diffère. La copie sera exclue du devis et restera restaurable.</p>
          <div className="flex flex-wrap gap-2"><button disabled={!!busy || !chosenOriginal || !records[originalId]?.reviewToken} className={`${BUTTON} bg-red-700 text-white`} onClick={() => chosenOriginal && classify(chosenOriginal)}>Vérifier le retrait</button><button disabled={!!busy} className={SECONDARY} onClick={() => setRemovingDuplicate(false)}>Annuler le retrait</button></div>
        </div>}
      </div>}
      {editable && can('perm_comm_demander_facture') && <details><summary className="min-h-11 cursor-pointer py-2 text-sm text-slate-600">Demander une facture au client</summary><div className="flex flex-wrap gap-2"><button disabled={!!busy || !getClient(sel.clientId)?.telegramChatId || !can('perm_comm_telegram')} className={SECONDARY} onClick={() => requestInvoices('telegram')}>Demander par Telegram</button><button disabled={!!busy || !getClient(sel.clientId)?.email || !can('perm_comm_email')} className={SECONDARY} onClick={() => requestInvoices('email')}>Demander par email</button></div></details>}
      </>}
      {unlinked.length > 0 && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><p>{unlinked.length} article(s) saisi(s) manuellement · {eur(unlinkedTotal)} HT restent inclus dans le devis, en plus des articles des factures. Vérifiez s’il s’agit d’achats supplémentaires ou de doublons.</p>{workspace && <button className={`${BUTTON} underline`} onClick={() => focusSection('quote-unlinked')}>Vérifier les articles manuels</button>}</div>}
    </div>
    {pendingInvoiceAttachments(sel).length > 0 && <details className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-3" open={!invoices.length}><summary className="min-h-11 cursor-pointer text-sm font-semibold text-amber-800">Documents reçus à vérifier ({pendingInvoiceAttachments(sel).length})</summary><section aria-label="Documents reçus à vérifier" className="space-y-3">{!editable ? <p className="text-sm font-semibold text-slate-600">Consultation uniquement : ce dossier est payé, terminé ou archivé.</p> : !canAdd && <p className="text-sm text-slate-600">Un membre de l’équipe autorisé à ajouter des factures peut les intégrer au dossier.</p>}<p className="text-xs text-slate-600">Ces pièces jointes sont dans la conversation. Ajoutez celles qui sont des factures pour les vérifier ici.</p>{pendingInvoiceAttachments(sel).map(message => <ConversationAttachment key={message.id} message={message} colis={sel} canImport={canAdd} preview importLabel="Ajouter comme facture" onImported={refresh} />)}</section></details>}
    {!invoices.length && <p className="p-6 text-center text-sm text-slate-600">Aucune facture enregistrée.</p>}
    {loadError && <div role="alert" className="m-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadError}<button className={`${BUTTON} underline`} onClick={() => run('reload', loadContext)}>Réessayer le chargement</button></div>}
    {showReview && selected && <>
      <div role="tablist" aria-label="Espace de vérification" className={`invoice-mobile-tabs grid grid-cols-2 gap-2 border-b border-gray-200 p-3 ${workspace ? 'invoice-wide-tabs' : ''}`}>{[['document', 'Document'], ['articles', 'Articles et vérification']].map(([key, label]) => <button key={key} role="tab" aria-selected={activeTab === key} aria-controls={`invoice-${key}-${sel.id}`} id={`invoice-tab-${key}-${sel.id}`} className={`${BUTTON} ${activeTab === key ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setTab(key)}>{label}</button>)}</div>
      <div className={`invoice-panes ${workspace ? 'invoice-wide' : ''}`}>
        <div ref={documentRef} id={`invoice-document-${sel.id}`} tabIndex={-1} role="region" aria-label="Document source" className={`invoice-document min-w-0 scroll-mt-32 p-3 sm:p-4 ${activeTab === 'document' ? '' : 'invoice-pane-hidden'}`}><div className="mb-3 flex items-center justify-between gap-2"><p className="min-w-0 break-words text-sm font-semibold text-slate-800">{index + 1} / {invoices.length} · {name(selected)}</p></div><InlineDocument invoice={selected} /></div>
        <div ref={editorRef} id={`invoice-articles-${sel.id}`} tabIndex={-1} role="region" aria-label="Vérification de la facture" className={`invoice-editor min-w-0 space-y-4 p-3 sm:p-4 ${activeTab === 'articles' ? '' : 'invoice-pane-hidden'}`}>
          <div><h3 className="text-base font-bold text-slate-800">{selected.duplicateOfId ? `Facture ${index + 1} retirée comme doublon` : historical ? `Facture ${index + 1} remplacée` : selected.valide && !draft?.editing ? `Facture ${index + 1} validée` : `Vérifier la facture ${index + 1} sur ${invoices.length}`}</h3><p className="mt-1 break-words text-sm text-slate-600">{name(selected)} · {stateLabel(selected, invoices)}</p></div>
          {!editable && !pendingInvoiceAttachments(sel).length && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">Consultation uniquement : ce dossier est payé, terminé ou archivé.</p>}
          {editable && !canEdit && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">Votre rôle permet la consultation. La modification des articles nécessite une autorisation.</p>}
          {selected.duplicateOfId && <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700"><p>Copie de {name(invoices.find(invoice => invoice.id === selected.duplicateOfId))}. Ce document et ses articles sont exclus du devis. Aucune validation n’est attendue pour cette copie.</p><button className={`${BUTTON} underline`} disabled={!!busy} onClick={() => choose(selected.duplicateOfId)}>Voir la facture originale</button>{editable && can('perm_factures_valider') && <button className={`${BUTTON} underline`} disabled={!!busy || !record} onClick={restore}>Remettre à vérifier</button>}</div>}
          {isReplaced(selected, invoices) && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">Ce document a été remplacé. Vérifiez la facture corrigée depuis la liste.</p>}
          {historical && feedback && <p data-testid="invoice-feedback" role={feedback.type === 'error' ? 'alert' : 'status'} className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{feedback.message}</p>}
          {historical && (draft?.dirty || draft?.editingExplicit) && <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p role="alert">Cette facture fait désormais partie de l’historique. Votre saisie locale est conservée ; elle n’est pas appliquée au devis.</p>
            <details><summary className="min-h-11 cursor-pointer py-2 font-semibold">Voir ma saisie locale</summary><p>{draft.vendeur} · {eur(draft.total || 0)} HT</p><ul className="space-y-1">{draft.lines.map((line, position) => <li key={position}>{line.desc} · {line.qte} × {eur(line.prix || 0)} HT{line.cat && ` · ${categories.find(category => category.id === line.cat)?.label || line.cat}`}</li>)}</ul></details>
            <button className={SECONDARY} disabled={!!busy} onClick={returnToSaved}>Abandonner la saisie locale</button>
          </div>}
          {historical && reloadRequired[invoiceId] && <button className={SECONDARY} disabled={!!busy} onClick={requestReload}>Actualiser</button>}
          {selected.rejetMotif && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Correction attendue : {selected.rejetMotif}</p>}
          {!!duplicateCandidates.length && !inactive && !isOriginalOfCopies && <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"><p className="font-semibold">Document identique reçu plusieurs fois</p>{duplicateCandidates.map(original => <div key={original.id}><button className="min-h-11 text-left underline" onClick={() => choose(original.id)}>Voir {name(original)}</button>{editable && can('perm_factures_valider') && <button disabled={!!busy || !record || !records[original.id]} className={SECONDARY} onClick={() => classify(original)}>Retirer cette copie</button>}</div>)}<p className="text-xs">Gardez un seul original dans le devis. Le fichier et son historique sont conservés.</p></div>}
          {loading && !draft && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={16} className="animate-spin" />Chargement de la vérification…</p>}
          {draft && !historical && <>
            {selected.valide && !draft.editing && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><p className="font-semibold">Validation enregistrée</p><p>{selected.vendeur} · {eur(selected.montant)} HT · {draft.lines.length} article(s).</p><ul className="mt-2 space-y-1">{draft.lines.map((line, position) => <li key={position}>{line.desc} · {line.qte} × {eur(line.prix)} HT</li>)}</ul>{record?.draft && <p className="mt-2">Un brouillon enregistré reste disponible ; il ne remplace pas cette validation.</p>}{canEdit && !inactive && <button className={`${BUTTON} mt-2 border border-emerald-700`} disabled={!!busy} onClick={() => setDrafts(previous => ({ ...previous, [invoiceId]: { ...(record?.draft ? seedDraft(selected, record, sel.lignes || []) : draft), editing: true, editingExplicit: true } }))}>{record?.draft ? 'Reprendre le brouillon' : 'Modifier la vérification'}</button>}</div>}
            {draft.editing && <>
            {selected.valide && <button className={SECONDARY} disabled={!!busy} onClick={returnToSaved}>Revenir à la version validée</button>}
            <div className="flex flex-wrap gap-2">{canAdd && !inactive && <button data-field="document" disabled={!!busy} className={SECONDARY} onClick={() => { const pick = () => { uploadTarget.current = invoiceId; uploadRef.current?.click(); }; if (selected.fichier) askConfirm({ title: 'Remplacer le document source ?', msg: 'La validation sera annulée. Les articles devront être vérifiés à nouveau avec le nouveau fichier.', okLabel: 'Choisir un nouveau document', onOk: pick }); else pick(); }}><Upload size={15} />{selected.fichier ? 'Remplacer le document' : 'Joindre le document'}</button>}{editable && can('perm_factures_ocr') && selected.fichier && !inactive && <button disabled={!!busy} className={SECONDARY} onClick={analyze}><Scan size={15} />{record?.extraction ? 'Reprendre l’analyse' : 'Analyser la facture'}</button>}</div>
            {record?.extraction && !inactive && <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800"><p>{draft.extractionId ? 'Propositions de l’analyse : vérifiez les articles et leurs catégories.' : 'Une analyse du document est disponible. Vos articles enregistrés sont conservés.'}</p>{!draft.extractionId && <p className="mt-2 text-xs">Analyse : {record.extraction.vendeur || 'Vendeur à vérifier'} · {record.extraction.total > 0 ? eur(record.extraction.total) : 'Total à vérifier'} · {(record.extraction.lines || []).length} article(s).</p>}{!draft.extractionId && canEdit && <button className={`${BUTTON} underline`} disabled={!!busy} onClick={useAnalysis}>Utiliser les propositions</button>}{(record.extraction.warnings || []).map((warning, i) => <p className="mt-1 text-xs" key={i}>{typeof warning === 'string' ? warning : warning.message}</p>)}</div>}
            {!!draft.extractionId && canEdit && !inactive && <button className={`${BUTTON} text-slate-600 underline`} disabled={!!busy} onClick={manualEntry}>Saisir les articles manuellement</button>}
            <fieldset disabled={fieldsDisabled} className="min-w-0 space-y-3">
              <legend className="mb-2 text-sm font-semibold text-slate-800">Montants de la facture</legend><p className="text-xs text-slate-600">Utilisez les montants HT imprimés, sans recalculer la TVA. Si le HT n’est pas indiqué, demandez une précision au client.</p>
              <label className="block text-xs font-semibold text-slate-600">Vendeur<input aria-label="Vendeur de la facture" data-field="vendor" maxLength={500} className={INPUT} value={draft.vendeur} onChange={event => change({ vendeur: event.target.value })} /></label>
              <label className="block text-xs font-semibold text-slate-600">Total HT de la facture (€)<input aria-label="Total HT de la facture" data-field="total" type="number" step="0.01" min="0.01" className={INPUT} value={draft.total} onChange={event => change({ total: event.target.value })} /></label>
              <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-slate-800">Articles ({draft.lines.length})</h4><span className="text-sm text-slate-600">Total : {eur(draft.lines.reduce((value, line) => value + Number(line.qte || 0) * Number(line.prix || 0), 0))} HT</span></div>
              {draft.lines.map((line, position) => <fieldset key={position} className="min-w-0 space-y-2 rounded-xl border border-gray-200 bg-slate-50 p-3"><legend className="px-1 text-xs font-semibold text-slate-600">Article {position + 1}</legend>
                <label className="block text-xs text-slate-600">Description<textarea rows={2} maxLength={1000} aria-label={`Description de l’article ${position + 1}`} data-field={`desc-${position}`} className={INPUT} value={line.desc} onChange={event => changeLine(position, { desc: event.target.value })} /></label>
                <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-600">Quantité<input type="number" min="1" step="1" aria-label={`Quantité de l’article ${position + 1}`} data-field={`qte-${position}`} className={INPUT} value={line.qte} onChange={event => changeLine(position, { qte: event.target.value })} /></label><label className="text-xs text-slate-600">Prix unitaire HT (€)<input type="number" min="0" step="0.01" aria-label={`Prix unitaire HT de l’article ${position + 1}`} data-field={`prix-${position}`} className={INPUT} value={line.prix} onChange={event => changeLine(position, { prix: event.target.value })} /></label></div>
                <label className="block text-xs text-slate-600">Catégorie<select aria-label={`Catégorie de l’article ${position + 1}`} data-field={`cat-${position}`} aria-invalid={!line.cat || undefined} className={INPUT} value={line.cat || ''} onChange={event => changeLine(position, { cat: event.target.value })}><option value="">Choisir une catégorie</option>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
                {!line.cat && <p className="text-xs font-semibold text-amber-800">Choisissez une catégorie pour cet article.</p>}
                <button className={`${BUTTON} text-red-700`} aria-label={`Retirer l’article ${position + 1}`} onClick={() => change({ lines: draft.lines.filter((_, i) => position !== i) })}><X size={14} />Retirer l’article</button>
              </fieldset>)}
              <button data-field="add-line" className={`${SECONDARY} w-full border-dashed`} onClick={() => change({ lines: [...draft.lines, emptyLine()] })}><Plus size={16} />Ajouter un article à cette facture</button>
            </fieldset>
            </>}
            <div data-testid="invoice-action-bar" className="space-y-3 border-t border-gray-200 pt-4">
              <div className="flex items-center justify-between gap-2"><p className="min-w-0 break-words text-sm font-semibold text-slate-800">Facture {index + 1} / {invoices.length} · {name(selected)}</p><div className="flex shrink-0 gap-1"><button aria-label="Vérifier la facture précédente" className={SECONDARY} disabled={!!busy || navigationIndex <= 0} onClick={() => chooseForReview(navigationInvoices[navigationIndex - 1].id)}><ChevronLeft size={16} /></button><button aria-label="Vérifier la facture suivante" className={SECONDARY} disabled={!!busy || navigationIndex >= navigationInvoices.length - 1} onClick={() => chooseForReview(navigationInvoices[navigationIndex + 1].id)}><ChevronRight size={16} /></button></div></div>
              {feedback && <p data-testid="invoice-feedback" role={feedback.type === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${feedback.type === 'error' ? 'bg-red-50 text-red-700' : feedback.type === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{feedback.message}</p>}
              {draft.dirty && <p className="text-xs font-semibold text-amber-800">Modifications non enregistrées. Le changement de facture conserve votre saisie ; enregistrez le brouillon avant de quitter le dossier.</p>}
              {record?.reviewToken && draft.reviewToken !== record.reviewToken && draft.dirty && <p role="alert" className="text-sm text-amber-800">La version enregistrée a changé. Votre saisie est conservée ; rechargez pour retrouver les modifications de votre collègue.</p>}
              {!!reloadRequired[invoiceId] && <button className={SECONDARY} disabled={!!busy} onClick={requestReload}>Actualiser</button>}
              {!inactive && draft.editing && canEdit && <>
                {!!issues.length && <div id={`invoice-blockers-${invoiceId}`} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><p className="font-semibold">Avant de valider</p><ul className="mt-1 list-disc space-y-1 pl-4">{issues.map((issue, i) => <li key={i}><button className="text-left underline underline-offset-2" onClick={() => focusField(issue.field)}>{issue.message}</button></li>)}</ul></div>}
                <button aria-describedby={issues.length ? `invoice-blockers-${invoiceId}` : undefined} disabled={!!busy || !canValidate || !!reloadRequired[invoiceId] || !record} onClick={() => save(true)} className={`${BUTTON} w-full bg-emerald-700 text-white`}>{busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{taskMode ? pending.some(invoice => invoice.id !== invoiceId) ? 'Valider et passer à la suivante' : 'Terminer la vérification' : 'Valider cette facture et ses articles'}</button>
                {!canValidate && <p className="text-xs text-slate-600">Vous pouvez enregistrer le brouillon. La validation nécessite l’autorisation de votre responsable.</p>}
                <button disabled={!!busy || !!reloadRequired[invoiceId] || !record} onClick={() => save(false)} className={`${SECONDARY} w-full`}>Enregistrer le brouillon</button>
                <p className="text-xs text-slate-600">La validation enregistre les articles de cette facture dans le devis. Aucun message n’est envoyé au client.</p>
              </>}
              {selected.valide && !draft.editing && pending.some(invoice => invoice.id !== invoiceId) && <button className={`${BUTTON} w-full bg-slate-700 text-white`} disabled={!!busy} onClick={() => chooseForReview(pending.find(invoice => invoice.id !== invoiceId).id)}>Facture suivante à vérifier<ChevronRight size={16} /></button>}
              {!inactive && editable && can('perm_factures_refuser') && <button className={`${BUTTON} text-red-700`} disabled={!!busy} onClick={() => setRejecting(!rejecting)}>Demander une correction au client</button>}
              {rejecting && <div className="space-y-2 rounded-xl border border-red-200 p-3"><label className="block text-xs font-semibold text-slate-600">Correction attendue<textarea aria-label="Motif de correction" rows={3} className={INPUT} value={reason} onChange={event => setReason(event.target.value)} /></label><p className="text-xs text-slate-600">Cette action marque le document à remplacer et envoie votre demande au client.</p><button className={`${BUTTON} bg-red-700 text-white`} disabled={!!busy || !reason.trim()} onClick={reject}>Enregistrer et envoyer la demande</button><button className={SECONDARY} disabled={!!busy} onClick={() => setRejecting(false)}>Annuler</button></div>}
            </div>
          </>}
        </div>
      </div>
    </>}
    {!selected && feedback && <p role="status" className="p-3 text-sm text-slate-700">{feedback.message}</p>}
    {children && <div className="border-t border-gray-200 p-3 sm:p-4">{children}</div>}
  </section>;
}
