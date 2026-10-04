import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, History, Package, Users, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useTaskAccess } from '../../context/TaskAccessContext';
import { useDialog } from '../ui/useDialog';
import { invoiceIdentity, invoiceNumbering, invoiceStateLabel, numberedInvoices, orderInvoices } from '../../domain/invoiceProgress';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { eur } from '../../utils';
import ColisInfo from './ColisInfo';
import InlineDocument from './InvoiceDocument';
import { conversationInvoiceEditable } from './ChatPanel';
import AuditLog from './AuditLog';
import StaffAssignment from '../staff/StaffAssignment';

const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200';
const SECTIONS = [
  { id: 'reception', label: 'Réception', icon: Package },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'equipe', label: 'Équipe', icon: Users },
  { id: 'historique', label: 'Historique', icon: History },
];

function DocumentContext({ onClose }) {
  const { sel, can: rawCan } = useApp();
  // Same permission rule as the workspace: only a role that may edit the
  // articles is invited to verify; the others consult the invoice.
  const { taskCan: can } = useTaskAccess(rawCan);
  const [previewId, setPreviewId] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const invoices = sel.factures || [];
  // Same order, numbering and labels as the invoice workspace.
  const numbering = invoiceNumbering(invoices);
  const counted = numberedInvoices(invoices);
  const editable = conversationInvoiceEditable(sel);
  const history = orderInvoices(invoices).filter(invoice => numbering[invoice.id]?.kind !== 'counted');
  const openTask = invoice => {
    onClose();
    navigate(dossierTaskUrl(sel.id, 'documents', location.search, { invoiceId: invoice?.id }));
  };
  const title = invoice => {
    const entry = numbering[invoice.id];
    if (entry?.kind === 'duplicate') return entry.copyOf ? `Copie de la facture ${entry.copyOf}` : entry.copyOfVersion ? `Copie d’un document remplacé (facture ${entry.copyOfVersion})` : 'Copie retirée';
    if (entry?.kind === 'replaced') return entry.versionOf ? `Ancienne version de la facture ${entry.versionOf}` : 'Ancienne version';
    // Same rule as the workspace's short name: the confirmed supplier, else the
    // file name (never a placeholder that the workspace would not show).
    const identity = invoiceIdentity(invoice);
    return `Facture ${entry.n} sur ${entry.total} · ${identity.supplierKnown ? identity.supplier : identity.fileName || identity.supplier}`;
  };
  const cards = (rows, historical = false) => rows.map(invoice => <article key={invoice.id} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{title(invoice)}</h3><p className="break-words text-xs text-slate-600 dark:text-slate-300">{invoice.fichierNom || 'Document sans nom'}</p></div><span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{invoiceStateLabel(invoice, invoices)}</span></div>
    {invoice.montant > 0 && <p className="text-sm tabular-nums">{eur(invoice.montant)} HT</p>}
    {historical && <p className="text-xs text-slate-600 dark:text-slate-300">Document conservé dans l’historique, exclu du devis.</p>}
    {invoice.rejetMotif && !historical && <p className="text-sm text-amber-800 dark:text-amber-200">Correction attendue : {invoice.rejetMotif}</p>}
    <div className="flex flex-wrap gap-2">{invoice.fichier && <button className={BUTTON} aria-expanded={previewId === invoice.id} onClick={() => setPreviewId(previous => previous === invoice.id ? null : invoice.id)}>{previewId === invoice.id ? 'Fermer le document' : 'Voir le document'}</button>}{editable && !historical && !invoice.valide && !invoice.rejetMotif && <button className={BUTTON} onClick={() => openTask(invoice)}>{can('perm_factures_modifier_articles') ? 'Vérifier' : 'Consulter'} la facture {numbering[invoice.id]?.n}</button>}</div>
    {previewId === invoice.id && <InlineDocument invoice={invoice} />}
  </article>);
  return <section aria-label="Documents du dossier" className="space-y-3">
    <p className="text-sm text-slate-600 dark:text-slate-300">Les documents reçus restent accessibles ici. La vérification et l’ajout de factures se font dans la tâche Factures.</p>
    {!invoices.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Aucune facture reçue.</p>}
    {cards(counted)}
    {history.length > 0 && <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Documents conservés dans l’historique ({history.length})</summary>{cards(history, true)}</details>}
    <button className={BUTTON} onClick={() => openTask()}>Ouvrir la tâche Factures</button>
  </section>;
}

/** Closing context must not discard an assignment draft or document preview. */
export default function DossierContextPanel({ section, onSectionChange, onClose, casierEditRequest = 0 }) {
  const { sel, can } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const open = Boolean(section);
  const dialogRef = useDialog(open, onClose);
  const [visited, setVisited] = useState(new Set());
  const canDocuments = ['perm_factures_voir', 'perm_factures_ajouter', 'perm_factures_valider', 'perm_factures_refuser', 'perm_factures_ocr', 'perm_factures_modifier_articles'].some(permission => can(permission));
  const sections = SECTIONS.filter(item => (item.id !== 'documents' || canDocuments));
  const selected = sections.some(item => item.id === section) ? section : 'reception';
  useEffect(() => {
    if (open) setVisited(previous => new Set([...previous, selected]));
  }, [open, selected]);
  if (!sel) return null;
  return createPortal(<div hidden={!open} className="fixed inset-0 z-40" data-testid="dossier-context">
    <div className="absolute inset-0 bg-slate-950/40" aria-hidden="true" onClick={onClose} />
    <aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Contexte du dossier" className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-slate-900">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700"><div className="min-w-0"><h2 id="dossier-context-title" className="text-base font-bold text-slate-900 dark:text-white">Détails du dossier</h2><p className="truncate font-mono text-xs text-slate-600 dark:text-slate-300">{sel.ref}</p></div><button className={BUTTON} aria-label="Fermer le contexte du dossier" onClick={onClose}><X size={18} /></button></div>
      <nav aria-label="Informations du dossier" className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 p-2 dark:border-slate-700">{sections.map(item => {
        const Icon = item.icon;
        return <button key={item.id} aria-current={item.id === selected ? 'page' : undefined} onClick={() => onSectionChange(item.id)} className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold ${item.id === selected ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}><Icon size={15} />{item.label}</button>;
      })}</nav>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-slate-800 dark:text-slate-100">
        {visited.has('reception') && <div hidden={selected !== 'reception'}><ColisInfo compact casierEditRequest={casierEditRequest} onCompleteReception={() => { onClose(); navigate(dossierTaskUrl(sel.id, "reception", location.search)); }} /></div>}
        {canDocuments && visited.has('documents') && <div hidden={selected !== 'documents'}><DocumentContext onClose={onClose} /></div>}
        {visited.has('equipe') && <div hidden={selected !== 'equipe'}><StaffAssignment /></div>}
        {visited.has('historique') && <div hidden={selected !== 'historique'}><AuditLog expanded includeAudit={can('perm_admin_audit')} /></div>}
      </div>
    </aside>
  </div>, document.body);
}
