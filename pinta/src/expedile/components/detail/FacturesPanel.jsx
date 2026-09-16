import React, { useEffect, useRef, useState } from 'react';
import { X, Eye, Upload, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { eur } from '../../utils';
import * as sb from '../../lib/supabaseData';
import { SecureImage, SecureFileLink } from '../ui/SecureFile';
import InvoiceWorkspace from './InvoiceWorkspace';
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
  const [replacesFactureId, setReplacesFactureId] = useState('');
  const [clientFile, setClientFile] = useState(null);
  const [newVendor, setNewVendor] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const uploadedClientDocument = useRef(null);
  const clientFileInput = useRef(null);
  if (!sel) return null;
  const invoices = sel.factures || [];
  const parcelId = sel.id;
  const canDeposit = !sel.archive && !sel.paiementDate && ['receptionne','mesure','attente_feu_vert','autorise','en_preparation','devis_envoye','attente_paiement'].includes(sel.statut);
  const depositClientDocument = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('client-deposit'); setError(''); setNotice('');
    try {
      if (!clientFile) throw new Error('Choisissez une facture PDF ou une photo lisible.');
      let document = uploadedClientDocument.current;
      if (!document || document.file !== clientFile || document.parcelId !== parcelId) {
        const saved = await sb.uploadDocument('factures', parcelId, clientFile);
        document = { ...saved, file: clientFile, parcelId }; uploadedClientDocument.current = document;
      }
      const saved = await sb.insertFacture(parcelId, { vendeur: newVendor.trim() || clientFile.name, montant: 0, valide: false, fichierUrl: document.path, fichierNom: clientFile.name, replacesFactureId: replacesFactureId || null });
      setData(previous => previous.map(parcel => parcel.id === parcelId ? { ...parcel, factures: [...(parcel.factures || []).filter(invoice => invoice.id !== saved.id), saved] } : parcel));
      setReplacesFactureId(''); setClientFile(null); if (clientFileInput.current) clientFileInput.current.value = ''; setNewVendor(''); uploadedClientDocument.current = null;
      setNotice('Facture reçue et enregistrée. Notre équipe vérifiera le document et les articles ; vous n’avez pas besoin de le renvoyer par message.');
    } catch (failure) { setError(failure.message || 'Le document n’a pas pu être enregistré. Réessayez.'); }
    finally { busyRef.current = false; setBusy(''); }
  };
  return <section id="quote-documents" aria-label="Factures d’achat" className="min-w-0 border-t border-gray-200 py-4">
    {preview && <Lightbox src={preview.fichier} title={preview.vendeur} onClose={() => setPreview(null)} />}
    <button className={`${BUTTON} px-0 text-slate-700`} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<FileText size={16} />Factures ({invoices.length})</button>
    {error && <p role="alert" className="my-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="my-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
    {canDeposit && <form aria-label="Déposer une facture" className="my-3 space-y-3 rounded-xl border border-slate-200 p-3" onSubmit={(event) => { event.preventDefault(); depositClientDocument(); }}>
      <p className="text-sm font-semibold text-slate-700">Ajouter une facture à ce dossier</p>
      <p className="text-xs text-slate-600">PDF ou photo lisible (JPG, PNG, WebP), 20 Mo maximum. Joignez toutes les pages avec les articles et les montants. Pour une correction, sélectionnez la facture à remplacer : son historique sera conservé et ses anciens articles seront exclus du devis.</p>
      {(invoices.some(invoice => invoice.rejetMotif)) && <label className="block text-xs font-semibold text-slate-600">Type de dépôt<select aria-label="Facture corrigée" value={replacesFactureId} onChange={event => setReplacesFactureId(event.target.value)} className={INPUT}><option value="">Nouvelle facture</option>{invoices.filter(invoice => invoice.rejetMotif && !invoices.some(other => other.replacesFactureId === invoice.id)).map(invoice => <option key={invoice.id} value={invoice.id}>Corriger : {invoice.vendeur || "Facture rejetée"}</option>)}</select></label>}
      <label className="block text-xs font-semibold text-slate-600">Vendeur (facultatif)<input value={newVendor} onChange={(event) => setNewVendor(event.target.value)} className={INPUT} /></label>
      <label className="block text-xs font-semibold text-slate-600">Facture ou photo<input required ref={clientFileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { setClientFile(event.target.files?.[0] || null); uploadedClientDocument.current = null; }} className="mt-1 block min-h-11 w-full min-w-0 text-xs" /></label>
      {clientFile && <p className="break-words text-xs text-slate-600">Document sélectionné : {clientFile.name}</p>}
      <button disabled={!!busy || !clientFile} className={`${BUTTON} w-full bg-slate-700 text-white`}><Upload size={15} />{busy === 'client-deposit' ? 'Enregistrement du document…' : 'Déposer la facture'}</button>
    </form>}
    {!collapsed && <div className="space-y-3">{!invoices.length && <p className="py-4 text-sm text-gray-500">Aucune facture reçue</p>}{invoices.map(invoice => {
      const replaced = invoices.some(other => other.replacesFactureId === invoice.id);
      const state = invoice.duplicateOfId ? 'Copie conservée' : replaced ? 'Remplacée' : invoice.valide ? 'Validée' : invoice.rejetMotif ? 'À remplacer' : 'À vérifier';
      const pdf = (invoice.fichierNom || invoice.fichier || '').toLowerCase().endsWith('.pdf');
      return <article key={invoice.id} aria-label={`Facture ${invoice.vendeur || 'à vérifier'}`} className="rounded-xl border border-gray-200 p-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{invoice.vendeur || 'Vendeur à renseigner'}</p><p className="text-sm text-gray-600">{invoice.montant > 0 ? eur(invoice.montant) : 'Montant à vérifier par l’équipe'}</p><p className="break-words text-xs text-gray-500">{invoice.fichierNom || 'Document manquant'}</p></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{state}</span></div>
        {invoice.rejetMotif && !replaced && <p className="mt-2 text-xs text-red-700">Correction attendue : {invoice.rejetMotif}</p>}
        {invoice.fichier && (pdf ? <SecureFileLink href={invoice.fichier} bucket="factures" target="_blank" rel="noopener noreferrer" className={`${BUTTON} mt-2 bg-slate-100 text-slate-700`}><Eye size={14} />Ouvrir le PDF</SecureFileLink> : <button onClick={() => setPreview(invoice)} className={`${BUTTON} mt-2 bg-slate-100 text-slate-700`}><Eye size={14} />Voir le document</button>)}
      </article>;
    })}</div>}
  </section>;
}
