import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, History, MessageCircle, Package, Users, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useDialog } from '../ui/useDialog';
import { currentInvoices } from '../../domain/invoiceDocuments';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { eur } from '../../utils';
import ColisInfo from './ColisInfo';
import InlineDocument from './InvoiceDocument';
import ChatPanel from './ChatPanel';
import AuditLog from './AuditLog';
import StaffAssignment from '../staff/StaffAssignment';

const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200';
const SECTIONS = [
  { id: 'reception', label: 'Réception', icon: Package },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'equipe', label: 'Équipe', icon: Users },
  { id: 'historique', label: 'Historique', icon: History },
];

function DocumentContext({ onClose }) {
  const { sel } = useApp();
  const [previewId, setPreviewId] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const invoices = sel.factures || [];
  const active = new Set(currentInvoices(invoices).map(invoice => invoice.id));
  const openTask = invoice => {
    onClose();
    navigate(dossierTaskUrl(sel.id, 'documents', location.search, { invoiceId: invoice?.id }));
  };
  const cards = (rows, historical = false) => rows.map(invoice => <article key={invoice.id} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{invoice.vendeur || invoice.fichierNom || 'Facture à vérifier'}</h3><p className="break-words text-xs text-slate-600 dark:text-slate-300">{invoice.fichierNom || 'Document sans nom'}</p></div><span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{invoice.duplicateOfId ? 'Doublon retiré' : historical ? 'Remplacée' : invoice.rejetMotif ? 'À corriger' : invoice.valide ? 'Validée' : 'À vérifier'}</span></div>
    {invoice.montant > 0 && <p className="text-sm">{eur(invoice.montant)} HT</p>}
    {historical && <p className="text-xs text-slate-600 dark:text-slate-300">Document conservé dans l’historique, exclu du devis.</p>}
    {invoice.rejetMotif && !historical && <p className="text-sm text-amber-800 dark:text-amber-200">Correction attendue : {invoice.rejetMotif}</p>}
    <div className="flex flex-wrap gap-2">{invoice.fichier && <button className={BUTTON} aria-expanded={previewId === invoice.id} onClick={() => setPreviewId(previous => previous === invoice.id ? null : invoice.id)}>{previewId === invoice.id ? 'Fermer le document' : 'Lire le document'}</button>}<button className={BUTTON} onClick={() => openTask(invoice)}>{historical || invoice.valide ? 'Consulter la facture' : 'Ouvrir la vérification'}</button></div>
    {previewId === invoice.id && <InlineDocument invoice={invoice} />}
  </article>);
  return <section aria-label="Documents du dossier" className="space-y-3">
    <p className="text-sm text-slate-600 dark:text-slate-300">Les documents reçus restent accessibles ici. La vérification et l’ajout de factures se font dans la tâche Factures.</p>
    {!invoices.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Aucune facture reçue.</p>}
    {cards(invoices.filter(invoice => active.has(invoice.id)))}
    {invoices.some(invoice => !active.has(invoice.id)) && <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Documents conservés dans l’historique ({invoices.filter(invoice => !active.has(invoice.id)).length})</summary>{cards(invoices.filter(invoice => !active.has(invoice.id)), true)}</details>}
    <button className={BUTTON} onClick={() => openTask()}>Ouvrir la tâche Factures</button>
  </section>;
}

/** Keep visited panels mounted: closing context must not discard a typed reply
 * or an assignment draft. Hidden conversations never mark messages as read. */
export default function DossierContextPanel({ section, onSectionChange, onClose }) {
  const { sel, can } = useApp();
  const open = Boolean(section);
  const dialogRef = useDialog(open, onClose);
  const [visited, setVisited] = useState(new Set());
  const canDocuments = ['perm_factures_voir', 'perm_factures_ajouter', 'perm_factures_valider', 'perm_factures_refuser', 'perm_factures_ocr', 'perm_factures_modifier_articles'].some(permission => can(permission));
  const canMessages = ['perm_comm_message_libre', 'perm_comm_telegram', 'perm_comm_email', 'perm_comm_voir_chat_autres'].some(permission => can(permission));
  const sections = SECTIONS.filter(item => (item.id !== 'documents' || canDocuments) && (item.id !== 'messages' || canMessages));
  const selected = sections.some(item => item.id === section) ? section : 'reception';
  useEffect(() => {
    if (open) setVisited(previous => new Set([...previous, selected]));
  }, [open, selected]);
  if (!sel) return null;
  const unread = (sel.messages || []).filter(message => message.type === 'client' && !message.lu).length;
  return createPortal(<div hidden={!open} className="fixed inset-0 z-40" data-testid="dossier-context">
    <div className="absolute inset-0 bg-slate-950/40" aria-hidden="true" onClick={onClose} />
    <aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dossier-context-title" className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-slate-900">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700"><div className="min-w-0"><h2 id="dossier-context-title" className="text-base font-bold text-slate-900 dark:text-white">Contexte du dossier</h2><p className="truncate font-mono text-xs text-slate-600 dark:text-slate-300">{sel.ref}</p></div><button className={BUTTON} aria-label="Fermer le contexte du dossier" onClick={onClose}><X size={18} /></button></div>
      <nav aria-label="Informations du dossier" className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 p-2 dark:border-slate-700">{sections.map(item => {
        const Icon = item.icon;
        return <button key={item.id} aria-current={item.id === selected ? 'page' : undefined} onClick={() => onSectionChange(item.id)} className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold ${item.id === selected ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}><Icon size={15} />{item.label}{item.id === 'messages' && unread > 0 && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">{unread}</span>}</button>;
      })}</nav>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-slate-800 dark:text-slate-100">
        {visited.has('reception') && <div hidden={selected !== 'reception'}><ColisInfo /></div>}
        {canDocuments && visited.has('documents') && <div hidden={selected !== 'documents'}><DocumentContext onClose={onClose} /></div>}
        {canMessages && visited.has('messages') && <div hidden={selected !== 'messages'}><ChatPanel embedded active={open && selected === 'messages'} /></div>}
        {visited.has('equipe') && <div hidden={selected !== 'equipe'}><StaffAssignment /></div>}
        {visited.has('historique') && <div hidden={selected !== 'historique'}><AuditLog expanded includeAudit={can('perm_admin_audit')} /></div>}
      </div>
    </aside>
  </div>, document.body);
}
