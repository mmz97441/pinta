import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Check, X, RotateCcw, Eye, Upload, FileText, Plus, Send, Scan, ChevronDown, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';
import { eur, getPrenom } from '../../utils';
import * as sb from '../../lib/supabaseData';
import { supabase } from '../../lib/supabase';
import { SecureImage, SecureFileLink, useSignedFile } from '../ui/SecureFile';
import { functionErrorMessage } from '../../services/functionErrors';

const PDFPreview = lazy(() => import('../ui/PDFPreview'));

const INPUT = 'min-h-11 min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
const BUTTON = 'min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-40 active:scale-[0.98]';
const REJECTION_REASONS = ['Document illisible', 'Facture incomplète', 'Montant à vérifier', 'Mauvais document'];

function Lightbox({ src, title, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      if (event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current?.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); previous?.focus?.(); };
  }, [onClose]);
  return <div role="dialog" aria-modal="true" aria-label={title || 'Aperçu de la facture'} className="fixed inset-0 z-[9999] flex flex-col bg-slate-950/90 p-4" onClick={onClose}>
    <div className="flex items-center justify-between gap-3 text-white"><p className="truncate text-sm font-semibold">{title}</p><button ref={closeRef} aria-label="Fermer l’aperçu" onClick={onClose} className={`${BUTTON} bg-white/15`}><X size={20} /></button></div>
    <div className="min-h-0 flex-1 overflow-auto py-4" onClick={(event) => event.stopPropagation()}><SecureImage bucket="factures" src={src} alt={title || 'Facture'} className="mx-auto max-h-full max-w-full rounded-lg object-contain" /></div>
  </div>;
}

function InlineDocument({ invoice }) {
  const { url, error, loading } = useSignedFile('factures', invoice?.fichier);
  if (!invoice?.fichier) return <p className="p-4 text-sm text-slate-600">Joignez le document pour vérifier les montants et articles.</p>;
  if (loading) return <div role="status" aria-label="Chargement du document" className="h-96 animate-pulse rounded-xl bg-slate-100" />;
  if (error) return <p role="alert" className="p-3 text-sm text-red-700">{error}</p>;
  const pdf = (invoice.fichierNom || invoice.fichier).split('?')[0].toLowerCase().endsWith('.pdf');
  return <div className="space-y-2">{pdf
    ? <Suspense fallback={<p role="status" className="p-3 text-sm text-slate-600">Chargement du lecteur PDF…</p>}><PDFPreview key={invoice.fichier} url={url} title={invoice.vendeur} /></Suspense>
    : <img src={url} alt={`Facture ${invoice.vendeur}`} className="w-full rounded-lg" />}
    <a href={url} target="_blank" rel="noopener noreferrer" className={`${BUTTON} text-blue-700`}>Ouvrir le document en grand</a>
  </div>;
}

function lineAnomalies(line, categories) {
  return [!line.desc?.trim() && 'Description manquante', (!Number.isInteger(Number(line.qte)) || Number(line.qte) <= 0) && 'Quantité entière positive requise', (line.prix === '' || line.prix == null || !Number.isFinite(Number(line.prix)) || Number(line.prix) < 0) && 'Prix HT à vérifier', !categories.some((c) => c.id === line.cat) && 'Catégorie à vérifier'].filter(Boolean);
}

function InvoiceFields({ invoice, busy, onSave }) {
  const [vendor, setVendor] = useState(invoice.vendeur || '');
  const [amount, setAmount] = useState(String(invoice.montant ?? ''));
  useEffect(() => { setVendor(invoice.vendeur || ''); setAmount(String(invoice.montant ?? '')); }, [invoice.id, invoice.vendeur, invoice.montant]);
  const dirty = vendor !== (invoice.vendeur || '') || amount !== String(invoice.montant ?? '');
  return <form className="mt-3 grid grid-cols-[minmax(0,1fr)_7rem] gap-2" onSubmit={(event) => { event.preventDefault(); onSave({ vendeur: vendor.trim(), montant: Number(amount), valide: false }); }}>
    <label className="text-xs text-gray-500">Vendeur<input aria-label="Vendeur de la facture" required value={vendor} onChange={(event) => setVendor(event.target.value)} className={INPUT} /></label>
    <label className="text-xs text-gray-500">Total HT (€)<input aria-label="Total HT de la facture" required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className={INPUT} /></label>
    {dirty && <button disabled={busy || !vendor.trim() || !(Number(amount) > 0)} className={`${BUTTON} col-span-2 bg-slate-100 text-slate-700`}><Check size={14} />Enregistrer la correction</button>}
  </form>;
}

export default function FacturesPanel({ workspace = false, tab, onTabChange, children }) {
  const { sel, isStaff, setData, refreshColis, sendMsg, getClient, categories = [], can } = useApp();
  const [selectedId, setSelectedId] = useState(null);
  const [localTab, setLocalTab] = useState('articles');
  const workspaceTab = tab || localTab;
  const setWorkspaceTab = (next) => { setLocalTab(next); onTabChange?.(next); };
  const [resuming, setResuming] = useState(false);
  const currentParcel = useRef(sel?.id); currentParcel.current = sel?.id;
  const selectedInvoice = (sel?.factures || []).find((invoice) => invoice.id === selectedId) || sel?.factures?.[0];
  const canResume = isStaff && (can('perm_factures_ocr') || can('perm_factures_valider'));
  const [collapsed, setCollapsed] = useState(false);
  const [clientFile, setClientFile] = useState(null);
  const uploadedClientDocument = useRef(null);
  const clientFileInput = useRef(null);
  const [newVendor, setNewVendor] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(null);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');
  const [extractions, setExtractions] = useState({});
  const uploadTarget = useRef(null);
  const fileInput = useRef(null);
  useEffect(() => { setExtractions({}); setClientFile(null); if (clientFileInput.current) clientFileInput.current.value = ''; uploadedClientDocument.current = null; setSelectedId(null); setWorkspaceTab('articles'); setError(''); setNotice(''); setRejectingId(null); setShowAdd(false); }, [sel?.id]);
  useEffect(() => {
    let alive = true;
    const invoice = selectedInvoice;
    if (!canResume || !invoice?.fichier) { setResuming(false); return undefined; }
    setResuming(true);
    supabase.functions.invoke('ocr-facture', { body: { factureId: invoice.id, colisId: sel.id, action: 'resume' } }).then(async ({ data, error: failure }) => {
      if (!alive) return;
      if (failure || !data?.success) throw new Error(await functionErrorMessage({ data, error: failure }, 'Reprise indisponible'));
      setExtractions((previous) => previous[invoice.id]?._dirty ? previous : { ...previous, [invoice.id]: data.extraction });
    }).catch((failure) => { if (alive) setError(`Les propositions enregistrées n’ont pas pu être chargées : ${failure.message}. Utilisez « Reprendre la vérification » pour réessayer.`); })
      .finally(() => { if (alive) setResuming(false); });
    return () => { alive = false; };
  }, [sel?.id, selectedInvoice?.id, selectedInvoice?.fichier, selectedInvoice?.ocrStatus, canResume]);
  if (!sel) return null;
  const parcelId = sel.id;
  const client = getClient(sel.clientId);
  const invoices = sel.factures || [];
  const canDeposit = !isStaff && !sel.paiementDate && ['receptionne','mesure','attente_feu_vert','autorise','en_preparation','devis_envoye','attente_paiement'].includes(sel.statut);
  const canEdit = isStaff && !sel.paiementDate;
  const canAdd = canEdit && can('perm_factures_ajouter');
  const canValidate = canEdit && can('perm_factures_valider');
  const canReject = canEdit && can('perm_factures_refuser');
  const canAnalyze = canEdit && can('perm_factures_ocr');
  const replaceInvoice = (invoice) => setData((previous) => previous.map((parcel) => parcel.id === parcelId ? { ...parcel, factures: (parcel.factures || []).map((item) => item.id === invoice.id ? invoice : item) } : parcel));
  const run = async (key, action) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(key); setError(''); setNotice('');
    try { await action(); } catch (failure) { if (currentParcel.current === parcelId) setError(failure.message || 'L’action n’a pas pu être enregistrée. Réessayez.'); }
    finally { busyRef.current = false; setBusy(null); }
  };
  const invokeOCR = async (body) => {
    const { data, error: failure } = await supabase.functions.invoke('ocr-facture', { body: { ...body, colisId: parcelId } });
    if (failure || !data?.success) throw new Error(await functionErrorMessage({ data, error: failure }, 'Analyse indisponible. La saisie manuelle reste disponible.'));
    return data;
  };
  const extract = async (invoice, action = 'extract') => {
    const data = await invokeOCR({ factureId: invoice.id, action });
    if (currentParcel.current !== parcelId) return;
    setExtractions((previous) => ({ ...previous, [invoice.id]: data.extraction }));
    setNotice(data.extraction ? 'Analyse enregistrée. Vérifiez les propositions avant de les importer dans le devis.' : 'Aucune analyse enregistrée pour ce document. Lancez l’analyse ou saisissez les articles.');
  };
  const saveInvoice = async (invoice, changes) => {
    const saved = await sb.updateFacture(invoice.id, changes);
    replaceInvoice(saved);
    return saved;
  };
  const addInvoice = () => run('add', async () => {
    const amount = newAmount === '' ? 0 : Number(newAmount);
    if (!newVendor.trim() || !Number.isFinite(amount) || amount < 0) throw new Error('Renseignez un vendeur et un montant positif ou nul.');
    const saved = await sb.insertFacture(parcelId, { vendeur: newVendor.trim(), montant: amount, valide: false });
    setData((previous) => previous.map((parcel) => parcel.id === parcelId ? { ...parcel, factures: [...(parcel.factures || []).filter((invoice) => invoice.id !== saved.id), saved] } : parcel));
    setNewVendor(''); setNewAmount(''); setShowAdd(false); setNotice('Facture enregistrée. Joignez son document pour la vérifier.');
  });
  const depositClientDocument = () => run('client-deposit', async () => {
    if (!clientFile) throw new Error('Choisissez une facture PDF ou une photo lisible.');
    let document = uploadedClientDocument.current;
    if (!document || document.file !== clientFile || document.parcelId !== parcelId) {
      const saved = await sb.uploadDocument('factures', parcelId, clientFile);
      document = { ...saved, file: clientFile, parcelId }; uploadedClientDocument.current = document;
    }
    const saved = await sb.insertFacture(parcelId, { vendeur: newVendor.trim() || clientFile.name, montant: 0, valide: false, fichierUrl: document.path, fichierNom: clientFile.name });
    setData((previous) => previous.map((parcel) => parcel.id === parcelId ? { ...parcel, factures: [...(parcel.factures || []).filter((invoice) => invoice.id !== saved.id), saved] } : parcel));
    if (currentParcel.current === parcelId) { setClientFile(null); if (clientFileInput.current) clientFileInput.current.value = ''; setNewVendor(''); uploadedClientDocument.current = null; setNotice('Facture reçue et enregistrée. Notre équipe vérifiera le document et les articles ; vous n’avez pas besoin de le renvoyer par message.'); }
  });
  const validate = (invoice) => run(invoice.id, async () => {
    if (!invoice.fichier || !invoice.vendeur?.trim() || !(Number(invoice.montant) > 0)) throw new Error('Joignez un document lisible et renseignez le vendeur et le montant avant de valider.');
    await saveInvoice(invoice, { valide: true, rejetMotif: null }); setNotice('Facture validée et enregistrée.');
  });
  const reject = (invoice, rejection) => run(invoice.id, async () => {
    if (!rejection.trim()) throw new Error('Indiquez la correction attendue du client.');
    await saveInvoice(invoice, { valide: false, rejetMotif: rejection.trim() });
    setRejectingId(null); setReason('');
    const channel = client?.telegramChatId ? 'telegram' : 'email';
    const text = `Bonjour ${getPrenom(client) || client?.nom || ''},\n\nLa facture ${invoice.vendeur} de votre dossier ${sel.ref} nécessite une correction : ${rejection.trim()}.\n\nMerci de joindre une photo ou un PDF lisible dans votre espace client. Nous pouvons préparer votre dossier dès votre accord ; cette facture est nécessaire pour établir le devis.\n\nL’équipe Expedîle`;
    try { await sendMsg(parcelId, sel.clientId, channel, null, text, { replyToMessageId: invoice.telegramMsgId || undefined }); setNotice('Refus enregistré. La demande de correction est prise en charge par la messagerie.'); }
    catch (failure) { setError(`Refus enregistré, mais la notification a échoué : ${failure.message}`); }
  });
  const uploadFile = async (event) => {
    const file = event.target.files?.[0]; const id = uploadTarget.current; event.target.value = '';
    if (!file || !id) return;
    await run(id, async () => {
      const { path } = await sb.uploadDocument('factures', parcelId, file);
      const saved = await sb.updateFacture(id, { fichierUrl: path, fichierNom: file.name, valide: false, rejetMotif: null });
      replaceInvoice(saved); setExtractions((previous) => ({ ...previous, [id]: null }));
      setNotice('Document enregistré. Sa validation doit être renouvelée après remplacement.');
      if (canAnalyze) {
        try { await extract(saved); }
        catch (failure) { setNotice(`Document enregistré. ${failure.message} Vous pouvez compléter les articles manuellement.`); }
      }
    });
  };
  const confirmExtraction = (invoice, extraction) => run(invoice.id, async () => {
    await invokeOCR({ factureId: invoice.id, action: 'confirm', extractionId: extraction.id, lines: extraction.lines, total: Number(extraction.total), vendeur: extraction.vendeur });
    await refreshColis(parcelId);
    setExtractions((previous) => ({ ...previous, [invoice.id]: { ...extraction, status: 'confirmed' } }));
    setNotice('Articles vérifiés et importés une seule fois. La facture est validée et enregistrée.');
  });
  const changeExtraction = (id, changes) => setExtractions((previous) => ({ ...previous, [id]: { ...previous[id], ...changes, _dirty: true } }));
  const changeLine = (id, index, changes) => setExtractions((previous) => ({ ...previous, [id]: { ...previous[id], _dirty: true, lines: previous[id].lines.map((line, position) => position === index ? { ...line, ...changes } : line) } }));

  return <section id="quote-documents" aria-label="Factures d’achat" className="min-w-0 border-t border-gray-200 py-4">
    <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={uploadFile} />
    {preview && <Lightbox src={preview.fichier} title={preview.vendeur} onClose={() => setPreview(null)} />}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button className={`${BUTTON} px-0 text-slate-700`} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<FileText size={16} />Factures ({invoices.length})</button>
      {canAdd && <button className={`${BUTTON} bg-slate-100 text-slate-700`} onClick={() => { setShowAdd(!showAdd); setCollapsed(false); }}><Plus size={14} />Ajouter</button>}
    </div>
    {error && <p role="alert" className="my-2 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    {notice && <p role="status" className="my-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-800">{notice}</p>}
    {canDeposit && <form aria-label="Déposer une facture" className="my-3 space-y-3 rounded-xl border border-slate-200 p-3" onSubmit={(event) => { event.preventDefault(); depositClientDocument(); }}>
      <p className="text-sm font-semibold text-slate-700">Ajouter une facture à ce dossier</p>
      <p className="text-xs text-slate-600">PDF ou photo lisible (JPG, PNG, WebP), 20 Mo maximum. Joignez toutes les pages avec les articles et les montants. Pour une correction, déposez la nouvelle version ici.</p>
      <label className="block text-xs font-semibold text-slate-600">Vendeur (facultatif)<input value={newVendor} onChange={(event) => setNewVendor(event.target.value)} className={INPUT} /></label>
      <label className="block text-xs font-semibold text-slate-600">Facture ou photo<input required ref={clientFileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { setClientFile(event.target.files?.[0] || null); uploadedClientDocument.current = null; }} className="mt-1 block min-h-11 w-full min-w-0 text-xs" /></label>
      {clientFile && <p className="break-words text-xs text-slate-600">Document sélectionné : {clientFile.name}</p>}
      <button disabled={!!busy || !clientFile} className={`${BUTTON} w-full bg-slate-700 text-white`}><Upload size={15} />{busy === 'client-deposit' ? 'Enregistrement du document…' : 'Déposer la facture'}</button>
    </form>}
    {workspace && <div className="space-y-3 py-3">
      <label className="block text-xs font-semibold text-slate-600">Facture à vérifier<select aria-label="Facture à vérifier" value={selectedInvoice?.id || ''} onChange={(event) => setSelectedId(event.target.value)} className={INPUT}>{!invoices.length && <option value="">Aucune facture reçue</option>}{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.vendeur || 'Vendeur à renseigner'} · {invoice.valide ? 'Validée' : 'À vérifier'}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2 lg:hidden" role="tablist" aria-label="Espace de vérification">{[['document', 'Document'], ['articles', 'Articles et vérification']].map(([key, label]) => <button key={key} role="tab" aria-selected={workspaceTab === key} className={`${BUTTON} ${workspaceTab === key ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setWorkspaceTab(key)}>{label}</button>)}</div>
    </div>}
    <div className={workspace ? 'grid min-w-0 grid-cols-1 lg:grid-cols-2 gap-5' : ''}>
      {workspace && <div role="region" aria-label="Document source" className={`min-w-0 ${workspaceTab === 'document' ? '' : 'hidden lg:block'}`}><InlineDocument invoice={selectedInvoice} /></div>}
      <div className={`min-w-0 ${workspace && workspaceTab !== 'articles' ? 'hidden lg:block' : ''}`}>
    {!collapsed && <div className="space-y-3">
      {isStaff && <div className="flex flex-wrap gap-2"><button disabled={!!busy || !client?.telegramChatId} className={`${BUTTON} text-sky-700 bg-sky-50`} onClick={() => run('request', () => sendMsg(parcelId, sel.clientId, 'telegram', 'facture_manquante', null))}><Send size={13} />Demander par Telegram</button><button disabled={!!busy || !client?.email} className={`${BUTTON} bg-slate-100 text-slate-700`} onClick={() => run('request', () => sendMsg(parcelId, sel.clientId, 'email', 'facture_manquante', null))}>Demander par email</button></div>}
      {showAdd && canAdd && <form className="rounded-xl border border-dashed border-gray-300 p-3 space-y-2" onSubmit={(event) => { event.preventDefault(); addInvoice(); }}><label className="block text-xs text-gray-500">Vendeur<input required aria-label="Nouveau vendeur" value={newVendor} onChange={(event) => setNewVendor(event.target.value)} className={INPUT} placeholder="Nom du vendeur" /></label><label className="block text-xs text-gray-500">Total HT connu (€)<input aria-label="Nouveau montant" type="number" min="0" step="0.01" value={newAmount} onChange={(event) => setNewAmount(event.target.value)} className={INPUT} placeholder="À compléter après lecture" /></label><button disabled={!!busy || !newVendor.trim()} className={`${BUTTON} w-full text-white`} style={{ background: BRAND.navy }}>Enregistrer la facture</button></form>}
      {!invoices.length && <div className="py-5 text-center text-gray-500"><FileText size={25} className="mx-auto mb-2 text-gray-300" /><p className="text-sm">Aucune facture reçue</p><p className="mt-1 text-xs">Les documents permettent de calculer un devis complet dès la préparation.</p></div>}
      {invoices.map((invoice) => {
        const extraction = extractions[invoice.id];
        const isPdf = (invoice.fichierNom || invoice.fichier || '').split('?')[0].toLowerCase().endsWith('.pdf');
        return <article key={invoice.id} className={`rounded-xl border border-gray-200 p-3 ${workspace && selectedInvoice?.id !== invoice.id ? 'hidden' : ''}`}>
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{invoice.vendeur || 'Vendeur à renseigner'}</p><p className="text-sm text-gray-600">{Number(invoice.montant) > 0 ? `${eur(invoice.montant)}${isStaff ? ' HT' : ''}` : 'Montant à vérifier par l’équipe'}</p><p className="truncate text-xs text-gray-400">{invoice.fichierNom || (invoice.fichier ? 'Document joint' : 'Document manquant')}</p></div><span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${invoice.valide ? 'bg-emerald-50 text-emerald-700' : invoice.rejetMotif ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{invoice.valide ? 'Validée' : invoice.rejetMotif ? 'À remplacer' : 'À vérifier'}</span></div>
          {isStaff && <p className="mt-2 text-xs text-slate-600">Base attendue : total HT imprimé sur la facture, sans recalculer la TVA. Si seul un montant TTC est disponible, demandez une précision avant validation.</p>}
          {isStaff && <p role="status" className="mt-2 text-xs font-semibold text-slate-600">{resuming && selectedInvoice?.id === invoice.id ? 'Chargement des propositions enregistrées…' : extraction?.status === 'confirmed' ? 'Articles importés et vérifiés' : extraction ? 'Propositions à vérifier' : invoice.ocrStatus === 'queued' ? 'Analyse en attente' : invoice.ocrStatus === 'processing' ? 'Analyse en cours' : invoice.ocrStatus === 'failed' ? 'Analyse en échec · saisie manuelle disponible' : 'Analyse non disponible pour ce document'}</p>}
          {isStaff && invoice.ocrError && <p className="mt-1 text-xs text-amber-700">{invoice.ocrError}</p>}
          {invoice.rejetMotif && <p className="mt-2 text-xs text-red-700">Correction attendue : {invoice.rejetMotif}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {invoice.fichier && (isPdf ? <SecureFileLink href={invoice.fichier} bucket="factures" target="_blank" rel="noopener noreferrer" className={`${BUTTON} bg-slate-100 text-slate-700`}><Eye size={14} />Ouvrir le PDF</SecureFileLink> : <button onClick={() => setPreview(invoice)} className={`${BUTTON} bg-slate-100 text-slate-700`}><Eye size={14} />Voir le document</button>)}
            {canAdd && <button disabled={!!busy} onClick={() => { uploadTarget.current = invoice.id; fileInput.current?.click(); }} className={`${BUTTON} bg-slate-100 text-slate-700`}><Upload size={14} />{invoice.fichier ? 'Remplacer' : 'Joindre le document'}</button>}
            {canResume && invoice.fichier && <button disabled={!!busy || resuming} onClick={() => run(invoice.id, () => extract(invoice, 'resume'))} className={`${BUTTON} bg-slate-100 text-slate-700`}>Reprendre la vérification</button>}
            {canAnalyze && invoice.fichier && !extraction && <button disabled={!!busy} onClick={() => run(invoice.id, () => extract(invoice))} className={`${BUTTON} bg-blue-50 text-blue-700`}>{busy === invoice.id ? <Loader2 size={14} className="animate-spin" /> : <Scan size={14} />}Analyser la facture</button>}
          </div>
          {canAdd && <InvoiceFields invoice={invoice} busy={!!busy} onSave={(changes) => run(invoice.id, async () => { await saveInvoice(invoice, changes); setNotice('Correction enregistrée. La facture doit être revérifiée.'); })} />}
          {extraction && extraction.status !== 'confirmed' && <div className="mt-4 border-t border-gray-200 pt-3 space-y-3"><p className="text-sm font-semibold text-slate-800">Propositions de l’analyse · à vérifier</p>{(extraction.warnings || []).map((warning, index) => <p key={index} className="flex gap-1.5 text-xs text-amber-700"><AlertTriangle size={13} className="shrink-0" />{typeof warning === 'string' ? warning : warning.message}</p>)}
            <label className="block text-xs text-gray-500">Vendeur extrait<input className={INPUT} value={extraction.vendeur || ''} onChange={(event) => changeExtraction(invoice.id, { vendeur: event.target.value })} /></label>
            <label className="block text-xs text-gray-500">Total HT des articles à importer (€)<input type="number" min="0.01" step="0.01" className={INPUT} value={extraction.total ?? ''} onChange={(event) => changeExtraction(invoice.id, { total: event.target.value })} /></label>
            {(extraction.lines || []).map((line, index) => <div key={index} className="space-y-2 rounded-xl bg-slate-50 p-2">{lineAnomalies(line, categories).map((message) => <p key={message} role="status" className="text-xs text-amber-800">{message}</p>)}<input aria-label={`Description extraite ${index + 1}`} className={INPUT} value={line.desc || ''} onChange={(event) => changeLine(invoice.id, index, { desc: event.target.value })} /><div className="grid grid-cols-2 gap-2"><label className="text-xs text-gray-500">Quantité<input type="number" min="1" step="1" className={INPUT} value={line.qte ?? ''} onChange={(event) => changeLine(invoice.id, index, { qte: Number(event.target.value) })} /></label><label className="text-xs text-gray-500">Prix unitaire HT (€)<input type="number" min="0" step="0.01" className={INPUT} value={line.prix ?? ''} onChange={(event) => changeLine(invoice.id, index, { prix: Number(event.target.value) })} /></label></div><select aria-label={`Catégorie extraite ${index + 1}`} className={INPUT} value={line.cat || ''} onChange={(event) => changeLine(invoice.id, index, { cat: event.target.value })}><option value="">Catégorie à vérifier</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></div>)}
            {Math.abs((extraction.lines || []).reduce((sum, line) => sum + Number(line.qte || 0) * Number(line.prix || 0), 0) - Number(extraction.total)) > 0.02 && <p role="alert" className="text-xs text-amber-800">La somme des articles diffère du total HT. Vérifiez les lignes et le total avant confirmation.</p>}
            {extraction._dirty && <p className="text-xs text-slate-600">Corrections à confirmer. Elles restent disponibles pendant le changement d’onglet ; confirmez avant de quitter le dossier.</p>}
            <button disabled={!!busy || !canValidate || !extraction.lines?.length || extraction.lines.some((line) => lineAnomalies(line, categories).length > 0) || !(Number(extraction.total) > 0) || Math.abs(extraction.lines.reduce((sum, line) => sum + Number(line.qte) * Number(line.prix), 0) - Number(extraction.total)) > 0.02} className={`${BUTTON} w-full bg-blue-600 text-white`} onClick={() => confirmExtraction(invoice, extraction)}><Check size={14} />Confirmer les articles vérifiés</button>
          </div>}
          {canEdit && <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">{invoice.valide ? <button disabled={!!busy || !canValidate} className={`${BUTTON} bg-amber-50 text-amber-700`} onClick={() => run(invoice.id, async () => { await saveInvoice(invoice, { valide: false }); setNotice('Validation annulée.'); })}><RotateCcw size={14} />Annuler la validation</button> : <><button disabled={!!busy || !canValidate} onClick={() => validate(invoice)} className={`${BUTTON} flex-1 bg-emerald-600 text-white`}><Check size={14} />Valider la facture</button><button disabled={!!busy || !canReject} onClick={() => { setRejectingId(rejectingId === invoice.id ? null : invoice.id); setReason(''); }} className={`${BUTTON} bg-red-50 text-red-700`}><X size={14} />Demander une correction</button></>}</div>}
          {canReject && rejectingId === invoice.id && <div className="mt-3 space-y-2"><p className="text-xs text-gray-500">La correction sera demandée au client après enregistrement.</p><div className="flex flex-wrap gap-2">{REJECTION_REASONS.map((item) => <button key={item} disabled={!!busy} className={`${BUTTON} bg-red-50 text-red-700`} onClick={() => reject(invoice, item)}>{item}</button>)}</div><input aria-label="Motif de correction" className={INPUT} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Précisez la correction attendue" /><button disabled={!!busy || !reason.trim()} onClick={() => reject(invoice, reason)} className={`${BUTTON} bg-red-600 text-white`}>Enregistrer et demander la correction</button></div>}
        </article>;
      })}
    </div>}
    {children}
      </div>
    </div>
  </section>;
}
