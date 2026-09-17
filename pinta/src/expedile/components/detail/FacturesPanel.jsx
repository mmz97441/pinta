import React, { useEffect, useRef, useState } from 'react';
import { X, Eye, Upload, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { eur } from '../../utils';
import * as sb from '../../lib/supabaseData';
import { SecureImage, SecureFileLink } from '../ui/SecureFile';
import InvoiceWorkspace from './InvoiceWorkspace';
import { currentInvoices } from '../../domain/invoiceDocuments';
const INPUT = 'min-h-11 min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
const BUTTON = 'min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-40 active:scale-[0.98]';
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


export default function FacturesPanel(props) {
  const { sel, isStaff } = useApp();
  return isStaff ? <InvoiceWorkspace key={sel?.id} {...props} /> : <ClientFacturesPanel key={sel?.id} />;
}
function ClientFacturesPanel() {
  const { sel, setData } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [replacesFactureId, setReplacesFactureId] = useState(() => { const rejected = currentInvoices(sel?.factures).filter(invoice => invoice.rejetMotif); return rejected.length === 1 ? rejected[0].id : rejected.length > 1 ? 'choose' : ''; });
  const explicitReplacementChoice = useRef(false);
  const [clientFiles, setClientFiles] = useState([]);
  const [newVendor, setNewVendor] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const uploadedClientDocuments = useRef(new Map());
  const clientFileInput = useRef(null);
  const selectionVersion = useRef(0);
  const invoices = sel?.factures || [];
  const parcelId = sel?.id;
  const corrections = currentInvoices(invoices).filter(invoice => invoice.rejetMotif);
  const correctionIds = corrections.map(invoice => invoice.id).join('|');
  const hasPendingFiles = clientFiles.some(item => item.status !== 'saved');
  useEffect(() => {
    // Refreshes can arrive while this panel is hidden. Follow new correction
    // requests only when no file or explicit "new invoice" choice is at risk.
    if (busy || hasPendingFiles) return;
    const ids = correctionIds ? correctionIds.split('|') : [];
    if (explicitReplacementChoice.current && (replacesFactureId === '' || ids.includes(replacesFactureId))) return;
    if (ids.includes(replacesFactureId)) return;
    explicitReplacementChoice.current = false;
    setReplacesFactureId(ids.length === 1 ? ids[0] : ids.length > 1 ? 'choose' : '');
  }, [correctionIds, busy, hasPendingFiles, replacesFactureId]);
  if (!sel) return null;
  const replacement = corrections.find(invoice => invoice.id === replacesFactureId);
  const canDeposit = !sel.archive && !sel.paiementDate && ['receptionne','mesure','attente_feu_vert','autorise','en_preparation','devis_envoye','attente_paiement'].includes(sel.statut);
  const pendingFiles = clientFiles.filter(item => item.status !== 'saved');
  const updateFile = (id, patch) => setClientFiles(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item));
  const clearSelection = () => {
    setClientFiles([]); uploadedClientDocuments.current.clear();
    if (clientFileInput.current) clientFileInput.current.value = '';
    setError(''); setNotice('');
  };
  const depositClientDocuments = async () => {
    if (busyRef.current) return;
    if (!canDeposit) { setError('Ce dossier ne peut plus recevoir de facture. Contactez notre équipe.'); return; }
    if (replacesFactureId && !replacement) { setError('Choisissez la facture à corriger, ou choisissez Nouvelle facture.'); return; }
    if (!pendingFiles.length) { setError('Choisissez une facture PDF ou une photo lisible.'); return; }
    if (replacesFactureId && pendingFiles.length !== 1) { setError('Choisissez un seul document pour remplacer cette facture.'); return; }
    busyRef.current = true; setBusy('client-deposit'); setError(''); setNotice('');
    let savedCount = 0; const failures = [];
    try {
      for (const item of pendingFiles) {
        updateFile(item.id, { status: 'uploading', error: '' });
        try {
          let document = uploadedClientDocuments.current.get(item.id);
          if (!document) {
            document = await sb.uploadDocument('factures', parcelId, item.file);
            uploadedClientDocuments.current.set(item.id, document);
          }
          // A retry may follow a lost response after a successful insert. Reuse
          // the invoice with this exact private path before attempting another.
          const existing = item.status === 'failed'
            ? await sb.fetchAllRows('factures', query => query.eq('colis_id', parcelId).eq('fichier_url', document.path)) : [];
          const saved = existing.length ? sb.mapFact(existing[0]) : await sb.insertFacture(parcelId, {
            vendeur: newVendor.trim() || item.file.name, montant: 0, valide: false,
            fichierUrl: document.path, fichierNom: item.file.name, replacesFactureId: replacesFactureId || null,
          });
          setData(previous => previous.map(parcel => parcel.id === parcelId ? { ...parcel, factures: [...(parcel.factures || []).filter(invoice => invoice.id !== saved.id), saved] } : parcel));
          updateFile(item.id, { status: 'saved', error: '' }); savedCount++;
        } catch (failure) {
          const message = failure.message || 'Enregistrement impossible. Réessayez.';
          updateFile(item.id, { status: 'failed', error: message }); failures.push(message);
        }
      }
      if (failures.length) setError(failures.length === 1 ? failures[0] : `${failures.length} documents restent à envoyer. Les autres sont enregistrés.`);
      if (savedCount) setNotice(savedCount === 1 ? 'Facture reçue et enregistrée. Notre équipe la vérifie.' : `${savedCount} factures reçues et enregistrées. Notre équipe les vérifie.`);
      if (!failures.length) {
        explicitReplacementChoice.current = false;
        setReplacesFactureId(''); setNewVendor('');
        if (clientFileInput.current) clientFileInput.current.value = '';
      }
    } finally { busyRef.current = false; setBusy(''); }
  };
  return <section id="quote-documents" aria-label="Factures d’achat" className="min-w-0 border-t border-gray-200 py-4">
    {preview && <Lightbox src={preview.fichier} title={preview.vendeur} onClose={() => setPreview(null)} />}
    <button className={`${BUTTON} px-0 text-slate-700`} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<FileText size={16} />Mes factures ({invoices.length})</button>
    {error && <p role="alert" className="my-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="my-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
    {canDeposit && <form aria-label="Déposer une facture" className="my-3 space-y-3 rounded-xl border border-slate-200 p-3" onSubmit={(event) => { event.preventDefault(); depositClientDocuments(); }}>
      <p className="text-sm font-semibold text-slate-700">{replacesFactureId ? 'Corriger une facture' : 'Envoyer mes factures'}</p>
      <p className="text-xs text-slate-600">Toutes les pages doivent être lisibles. PDF ou photos (JPG, PNG, WebP), 20 Mo par fichier. Plusieurs factures possibles pour un nouveau dépôt.</p>
      {(corrections.length > 0 || replacesFactureId) && <label className="block text-xs font-semibold text-slate-600">Type de dépôt<select aria-label="Facture corrigée" disabled={!!busy} value={replacesFactureId} onChange={event => { explicitReplacementChoice.current = true; setReplacesFactureId(event.target.value); clearSelection(); }} className={INPUT}><option value="choose" disabled>Choisir la facture à corriger</option><option value="">Nouvelle facture</option>{replacesFactureId && replacesFactureId !== 'choose' && !replacement && <option value={replacesFactureId} disabled>Cette facture a changé — choisissez le dépôt</option>}{corrections.map(invoice => <option key={invoice.id} value={invoice.id}>Corriger : {invoice.vendeur || "Facture rejetée"}</option>)}</select></label>}
      {replacement && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><strong>{replacement.vendeur || 'Facture à corriger'}</strong><br />Correction demandée : {replacement.rejetMotif}</p>}
      {replacesFactureId && <p className="text-xs text-slate-600">Un seul document corrigé. L’ancienne version reste dans l’historique.</p>}
      <label className="block text-xs font-semibold text-slate-600">Facture ou photo<input ref={clientFileInput} disabled={!!busy} multiple={!replacesFactureId} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => {
        const files = Array.from(event.target.files || []); selectionVersion.current++;
        uploadedClientDocuments.current.clear(); setError(''); setNotice('');
        setClientFiles(files.map((file,index) => ({ id: `${selectionVersion.current}-${index}`, file, status: 'ready', error: '' })));
      }} className="mt-1 block min-h-11 w-full min-w-0 text-xs" /></label>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-slate-600">Préciser le vendeur (facultatif)</summary><label className="block text-xs font-semibold text-slate-600">Vendeur (facultatif)<input disabled={!!busy} value={newVendor} onChange={(event) => setNewVendor(event.target.value)} className={INPUT} /></label></details>
      {clientFiles.length > 0 && <ul aria-label="Résultat du dépôt des factures" className="space-y-2">{clientFiles.map(item => <li key={item.id} className="rounded-lg bg-slate-50 p-2 text-xs"><p className="break-words font-semibold text-slate-700">{item.file.name}</p><p role="status" className={item.status === 'failed' ? 'text-red-700' : 'text-slate-600'}>{item.status === 'saved' ? 'Enregistrée · à vérifier par l’équipe' : item.status === 'uploading' ? 'Enregistrement…' : item.status === 'failed' ? item.error : 'Prête à envoyer'}</p></li>)}</ul>}
      <button disabled={!!busy || !pendingFiles.length || replacesFactureId === 'choose'} className={`${BUTTON} w-full bg-slate-700 text-white`}><Upload size={15} />{busy === 'client-deposit' ? 'Enregistrement des documents…' : pendingFiles.some(item => item.status === 'failed') ? 'Réessayer les documents en échec' : pendingFiles.length > 1 ? `Déposer les ${pendingFiles.length} factures` : 'Déposer la facture'}</button>
    </form>}
    {!collapsed && <div className="space-y-3">{!invoices.length && <p className="py-4 text-sm text-gray-500">Aucune facture reçue</p>}{invoices.map(invoice => {
      const replaced = invoices.some(other => other.replacesFactureId === invoice.id);
      const state = invoice.duplicateOfId ? 'Copie retirée' : replaced ? 'Remplacée' : invoice.valide ? 'Validée' : invoice.rejetMotif ? 'À corriger' : 'En cours de vérification';
      const pdf = (invoice.fichierNom || invoice.fichier || '').toLowerCase().endsWith('.pdf');
      return <article key={invoice.id} aria-label={`Facture ${invoice.vendeur || 'à vérifier'}`} className="rounded-xl border border-gray-200 p-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{invoice.vendeur || 'Vendeur à renseigner'}</p><p className="text-sm text-gray-600">{invoice.montant > 0 ? eur(invoice.montant) : 'Montant à vérifier par l’équipe'}</p><p className="break-words text-xs text-gray-500">{invoice.fichierNom || 'Document manquant'}</p></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{state}</span></div>
        {invoice.rejetMotif && !replaced && <p className="mt-2 text-xs text-red-700">Correction attendue : {invoice.rejetMotif}</p>}
        {invoice.fichier && (pdf ? <SecureFileLink href={invoice.fichier} bucket="factures" target="_blank" rel="noopener noreferrer" className={`${BUTTON} mt-2 bg-slate-100 text-slate-700`}><Eye size={14} />Ouvrir le PDF</SecureFileLink> : <button onClick={() => setPreview(invoice)} className={`${BUTTON} mt-2 bg-slate-100 text-slate-700`}><Eye size={14} />Voir le document</button>)}
      </article>;
    })}</div>}
  </section>;
}
