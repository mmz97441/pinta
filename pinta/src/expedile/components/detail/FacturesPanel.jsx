import React, { useEffect, useRef, useState } from 'react';
import { X, Eye, Upload, Info } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { eur } from '../../utils';
import * as sb from '../../lib/supabaseData';
import { SecureImage, SecureFileLink } from '../ui/SecureFile';
import InvoiceWorkspace from './InvoiceWorkspace';
import { currentInvoices } from '../../domain/invoiceDocuments';
import { clientDepositInformation, clientDepositNotice, invoicesEditable, invoicesFrozenReason } from '../../domain/invoiceLock';
const INPUT = 'min-h-11 min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
const BUTTON = 'min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-40 active:scale-[0.98]';
// Why the client can no longer add an invoice here (the form is not shown): never a silent disappearance.
function depositClosedText(colis) {
  const reason = invoicesFrozenReason(colis);
  if (reason === 'payment') return 'Votre paiement est enregistré\u00a0: vos factures sont conservées dans ce dossier et ne peuvent plus être modifiées. Une question\u00a0? Écrivez à notre équipe depuis «\u00a0Messages\u00a0».';
  if (reason === 'departure') return 'Votre colis est parti\u00a0: vos factures restent consultables ici, sans nouveau dépôt possible. Une question\u00a0? Écrivez à notre équipe depuis «\u00a0Messages\u00a0».';
  if (reason === 'closed') return 'Ce dossier est clos\u00a0: vos factures restent consultables ici.';
  return 'Ce dossier ne reçoit pas de nouvelle facture pour le moment. Une question\u00a0? Écrivez à notre équipe depuis «\u00a0Messages\u00a0».';
}
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
  // A tap on the dark backdrop closes the preview, including the free area around the image; the image itself does not.
  return <div role="dialog" aria-modal="true" aria-label={title || 'Aperçu de la facture'} className="fixed inset-0 z-[9999] flex flex-col bg-slate-950/90 p-4" onClick={onClose}>
    <div className="flex items-center justify-between gap-3 text-white"><p className="truncate text-sm font-semibold">{title}</p><button ref={closeRef} aria-label="Fermer l’aperçu" onClick={(event) => { event.stopPropagation(); onClose(); }} className={`${BUTTON} bg-white/15`}><X size={20} /></button></div>
    <div data-testid="invoice-preview-backdrop" className="min-h-0 flex-1 overflow-auto py-4" onClick={(event) => { if (event.target !== event.currentTarget) event.stopPropagation(); }}><SecureImage bucket="factures" src={src} alt={title || 'Facture'} className="mx-auto block max-h-full max-w-full rounded-lg object-contain" /></div>
  </div>;
}


export default function FacturesPanel(props) {
  const { sel, isStaff } = useApp();
  return isStaff ? <InvoiceWorkspace key={sel?.id} {...props} /> : <ClientFacturesPanel key={sel?.id} />;
}
function ClientFacturesPanel() {
  const { sel, setData, refreshColis } = useApp();
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
  const activeInvoices = currentInvoices(invoices);
  const activeIds = new Set(activeInvoices.map(invoice => invoice.id));
  const pastInvoices = invoices.filter(invoice => !activeIds.has(invoice.id));
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
  const canDeposit = invoicesEditable(sel);
  // After a deposit answered « paid » or « frozen », the pre-send information no longer applies.
  const settled = clientFiles.some(item => item.status === 'saved' && ['paid', 'frozen'].includes(item.result));
  const information = settled ? '' : clientDepositInformation(sel);
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
    const failures = []; const results = [];
    try {
      for (const item of pendingFiles) {
        updateFile(item.id, { status: 'uploading', error: '' });
        try {
          let document = uploadedClientDocuments.current.get(item.id);
          if (!document) {
            document = await sb.uploadDocument('factures', parcelId, item.file);
            uploadedClientDocuments.current.set(item.id, document);
          }
          // The server is idempotent on the private path: a retry after a lost
          // response returns the same invoice, never a second one (D3).
          const result = await sb.depositClientInvoice({ colisId: parcelId, path: document.path, fileName: item.file.name, vendor: newVendor.trim() || null, replacesFactureId: replacesFactureId || null });
          const saved = result.facture;
          if (saved) setData(previous => previous.map(parcel => parcel.id === parcelId ? { ...parcel, factures: [...(parcel.factures || []).filter(invoice => invoice.id !== saved.id), saved] } : parcel));
          updateFile(item.id, { status: 'saved', result: result.status, error: '' }); results.push(result);
        } catch (failure) {
          const message = failure.message || 'Enregistrement impossible. Réessayez.';
          updateFile(item.id, { status: 'failed', error: message }); failures.push(message);
        }
      }
      if (failures.length) setError(failures.length === 1 ? failures[0] : `${failures.length} documents restent à envoyer. Les autres sont enregistrés.`);
      if (results.length) setNotice(clientDepositNotice(results));
      // The quote may now be updating: show the dossier as the server sees it.
      if (results.some(result => result.status !== 'added' && result.status !== 'duplicate')) await refreshColis(parcelId).catch(() => {});
      if (!failures.length) {
        explicitReplacementChoice.current = false;
        setReplacesFactureId(''); setNewVendor('');
        if (clientFileInput.current) clientFileInput.current.value = '';
      }
    } finally { busyRef.current = false; setBusy(''); }
  };
  const invoiceCard = invoice => {
    const current = activeIds.has(invoice.id);
    const state = invoice.duplicateOfId ? 'Copie retirée' : !current ? 'Remplacée' : invoice.valide ? 'Validée' : invoice.rejetMotif ? 'À corriger' : 'En cours de vérification';
    const pdf = (invoice.fichierNom || invoice.fichier || '').toLowerCase().endsWith('.pdf');
    // Without a vendor, the server stores the file name as vendor: the card names the document once.
    const vendor = invoice.vendeur && invoice.vendeur !== invoice.fichierNom ? invoice.vendeur : '';
    return <article key={invoice.id} aria-label={`Facture ${invoice.vendeur || 'à vérifier'}`} className="rounded-xl border border-gray-200 p-3">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{vendor || 'Facture d’achat'}</p><p className="text-sm text-gray-600">{invoice.montant > 0 ? eur(invoice.montant) : 'Montant à vérifier par l’équipe'}</p><p className="break-words text-xs text-gray-500">{invoice.fichierNom || 'Document manquant'}</p></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{state}</span></div>
      {invoice.rejetMotif && current && <p className="mt-2 text-xs text-red-700">Correction attendue&nbsp;: {invoice.rejetMotif}</p>}
      {invoice.fichier && (pdf ? <SecureFileLink href={invoice.fichier} bucket="factures" target="_blank" rel="noopener noreferrer" className={`${BUTTON} mt-2 bg-slate-100 text-slate-700`}><Eye size={14} />Ouvrir le PDF</SecureFileLink> : <button onClick={() => setPreview(invoice)} className={`${BUTTON} mt-2 bg-slate-100 text-slate-700`}><Eye size={14} />Voir le document</button>)}
    </article>;
  };
  return <section id="quote-documents" aria-label="Factures d’achat" className="min-w-0 border-t border-gray-200 py-4">
    {preview && <Lightbox src={preview.fichier} title={preview.vendeur} onClose={() => setPreview(null)} />}
    {error && <p role="alert" className="my-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" data-testid="client-deposit-notice" className="my-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
    {!canDeposit && <p data-testid="client-deposit-closed" className="my-3 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{depositClosedText(sel)}</p>}
    {canDeposit && <form aria-label="Déposer une facture" className="my-3 space-y-3 rounded-xl border border-slate-200 p-3" onSubmit={(event) => { event.preventDefault(); depositClientDocuments(); }}>
      <p className="text-sm font-semibold text-slate-700">{replacesFactureId ? 'Corriger une facture' : 'Envoyer mes factures'}</p>
      {information && <p data-testid="client-deposit-information" className="flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800"><Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{information}</p>}
      <p className="text-xs text-slate-600">Toutes les pages doivent être lisibles. PDF ou photos (JPG, PNG, WebP), 20 Mo par fichier. Plusieurs factures possibles pour un nouveau dépôt.</p>
      {(corrections.length > 0 || replacesFactureId) && <label className="block text-xs font-semibold text-slate-600">Type de dépôt<select aria-label="Facture corrigée" disabled={!!busy} value={replacesFactureId} onChange={event => { explicitReplacementChoice.current = true; setReplacesFactureId(event.target.value); clearSelection(); }} className={INPUT}><option value="choose" disabled>Choisir la facture à corriger</option><option value="">Nouvelle facture</option>{replacesFactureId && replacesFactureId !== 'choose' && !replacement && <option value={replacesFactureId} disabled>Cette facture a changé — choisissez le dépôt</option>}{corrections.map(invoice => <option key={invoice.id} value={invoice.id}>Corriger&nbsp;: {invoice.vendeur || "Facture rejetée"}</option>)}</select></label>}
      {replacement && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><strong>{replacement.vendeur || 'Facture à corriger'}</strong><br />Correction demandée&nbsp;: {replacement.rejetMotif}</p>}
      {replacesFactureId && <p className="text-xs text-slate-600">Un seul document corrigé. L’ancienne version reste dans l’historique.</p>}
      <label className="block text-xs font-semibold text-slate-600">Facture ou photo<input ref={clientFileInput} disabled={!!busy} multiple={!replacesFactureId} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => {
        const files = Array.from(event.target.files || []); selectionVersion.current++;
        uploadedClientDocuments.current.clear(); setError(''); setNotice('');
        setClientFiles(files.map((file,index) => ({ id: `${selectionVersion.current}-${index}`, file, status: 'ready', error: '' })));
      }} className="mt-1 block min-h-11 w-full min-w-0 text-xs" /></label>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-slate-600">Préciser le vendeur (facultatif)</summary><label className="block text-xs font-semibold text-slate-600">Vendeur (facultatif)<input disabled={!!busy} value={newVendor} onChange={(event) => setNewVendor(event.target.value)} className={INPUT} /></label></details>
      {clientFiles.length > 0 && <ul aria-label="Résultat du dépôt des factures" className="space-y-2">{clientFiles.map(item => <li key={item.id} className="rounded-lg bg-slate-50 p-2 text-xs"><p className="break-words font-semibold text-slate-700">{item.file.name}</p><p role="status" className={item.status === 'failed' ? 'text-red-700' : 'text-slate-600'}>{item.status === 'saved' ? item.result === 'duplicate' ? 'Déjà reçu · rien ne change' : item.result === 'frozen' || item.result === 'paid' ? 'Conservé dans votre dossier' : 'Enregistrée · à vérifier par l’équipe' : item.status === 'uploading' ? 'Enregistrement…' : item.status === 'failed' ? item.error : 'Prête à envoyer'}</p></li>)}</ul>}
      <button disabled={!!busy || !pendingFiles.length || replacesFactureId === 'choose'} className={`${BUTTON} w-full brand-bg text-white`}><Upload size={15} />{busy === 'client-deposit' ? 'Enregistrement des documents…' : pendingFiles.some(item => item.status === 'failed') ? 'Réessayer les documents en échec' : pendingFiles.length > 1 ? `Déposer les ${pendingFiles.length} factures` : 'Déposer la facture'}</button>
    </form>}
    <div className="space-y-3"><h3 className="text-sm font-semibold text-slate-700">Factures envoyées ({activeInvoices.length})</h3>{!activeInvoices.length && <p className="py-4 text-sm text-gray-500">{pastInvoices.length ? 'Aucune facture à utiliser pour cette expédition. Les anciennes copies restent dans l’historique.' : 'Aucune facture reçue'}</p>}{activeInvoices.map(invoiceCard)}</div>
    {pastInvoices.length > 0 && <details className="mt-3 border-t border-slate-200"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600">Anciennes versions et copies ({pastInvoices.length})</summary><div className="space-y-3">{pastInvoices.map(invoiceCard)}</div></details>}
  </section>;
}
