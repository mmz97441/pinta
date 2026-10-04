import { useTaskAccess } from '../../context/TaskAccessContext';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { eur } from '../../utils';
import * as sb from '../../lib/supabaseData';
import InvoiceWorkspace from '../detail/InvoiceWorkspace';
import useWorkDraft from '../../hooks/useWorkDraft';
import useQuoteWithdrawal from '../../hooks/useQuoteWithdrawal';
import { invoicesEditable, isQuoteWithdrawalError, withdrawnActionFailure } from '../../domain/invoiceLock';

const INPUT = 'min-h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm';
const manualDrafts = new Map();
const emptyArticle = () => ({ desc: '', qte: '1', prix: '', cat: '' });

/** Invoice review is a task of its own. Only unlinked lines need a second
 * editor; invoice-linked articles are edited once, inside their document. */
export default function DossierDocumentsTask({ onQuote, children }) {
  const { sel, auth, can: rawCan, categories = [], setData, ask } = useApp();
  const { taskCan: can } = useTaskAccess(rawCan);
  const cacheKey = `${auth?.u?.id}:${sel.id}`;
  const [article, setArticle] = useState(() => manualDrafts.get(cacheKey) || emptyArticle());
  const dirty = Boolean(article.desc || article.prix || article.cat || article.qte !== '1');
  const clearWorkDraft = useWorkDraft({ userId: auth?.u?.id, dossierId: sel.id, kind: 'documents', source: 'manual-article', dirty, label: 'Achat supplémentaire non enregistré' });
  useEffect(() => {
    if (dirty) manualDrafts.set(cacheKey, article); else manualDrafts.delete(cacheKey);
    const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [cacheKey, article, dirty]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const editable = invoicesEditable(sel) && can('perm_factures_modifier_articles');
  const manual = (sel.lignes || []).filter(line => !line.factureId);
  // Server lock from the review context loaded by InvoiceWorkspace; undefined until it is known (the dialog then
  // never claims that no client message is sent: an open late-invoice request would be announced).
  const [lock, setLock] = useState(undefined);
  const { guard, requestWithdrawal } = useQuoteWithdrawal(sel, lock, { report: message => setError(message) });
  async function run(operation, withdrawn = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError('');
    try { await operation(); } catch (failure) {
      // D2: the server refuses a purchase change covered by a sent quote.
      if (!withdrawn && isQuoteWithdrawalError(failure)) requestWithdrawal('manual_articles', () => run(operation, true));
      else setError(withdrawn ? withdrawnActionFailure(failure.message || 'Modification impossible.') : failure.message || 'Modification impossible. Réessayez.');
    }
    finally { busyRef.current = false; setBusy(false); }
  }
  // A manual purchase on a locked quote goes through « Retirer le devis et modifier l’achat ».
  const guarded = operation => guard('manual_articles', withdrawal => run(operation, !!withdrawal));
  const articleLine = () => ({ ...article, desc: article.desc.trim(), qte: Number(article.qte), prix: Number(article.prix), factureId: null });
  const articleValid = line => editable && line.desc && Number.isInteger(line.qte) && line.qte > 0 && article.prix !== '' && Number.isFinite(line.prix) && line.prix >= 0 && line.cat;
  async function add() {
    const line = articleLine();
    if (!articleValid(line)) throw new Error('Renseignez la description, la quantité, le prix HT et la catégorie.');
    const saved = await sb.insertLigne(sel.id, line);
    manualDrafts.delete(cacheKey); clearWorkDraft();
    setData(previous => previous.map(parcel => parcel.id === sel.id ? { ...parcel, lignes: [...(parcel.lignes || []).filter(item => item.id !== saved.id), saved] } : parcel));
    setArticle(emptyArticle());
  }
  return <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4" data-testid="documents-task">
    <InvoiceWorkspace workspace taskMode onQuote={onQuote} onLockChange={setLock}>
      <section id="quote-unlinked" tabIndex={-1} className="scroll-mt-32 space-y-3" aria-label="Articles manuels">
        {manual.length > 0 && <>
          <h3 className="text-sm font-semibold text-amber-800">Achats supplémentaires sans facture reliée</h3>
          <p className="text-sm text-slate-600">Ces achats ajoutent {eur(manual.reduce((total, line) => total + Number(line.qte) * Number(line.prix), 0))} HT au devis. Vérifiez qu’ils ne figurent pas déjà dans une facture ; rien n’est retiré automatiquement.</p>
          {manual.map(line => <div key={line.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">{line.desc}</p><p className="text-sm text-slate-600">{line.qte} × {eur(line.prix)} HT</p></div>
              <button aria-label={`Supprimer ${line.desc}`} disabled={busy || !editable} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-red-700 disabled:opacity-40" onClick={() => ask('Retirer cet article du devis ?', `L’article « ${line.desc} » sera retiré. Vérifiez qu’il est déjà présent dans une facture si vous corrigez un double comptage.`, () => guarded(async () => { await sb.deleteLigne(line.id); setData(previous => previous.map(parcel => parcel.id === sel.id ? { ...parcel, lignes: (parcel.lignes || []).filter(item => item.id !== line.id) } : parcel)); }), { danger: true, okLabel: 'Retirer l’article' })}><X size={18} /></button>
            </div>
            <label className="block text-xs font-semibold text-slate-600">Catégorie<select aria-label={`Catégorie de ${line.desc}`} disabled={busy || !editable} value={line.cat || ''} className={INPUT} onChange={event => { const cat = event.target.value; guarded(async () => { await sb.updateLigne(line.id, { cat }); setData(previous => previous.map(parcel => parcel.id === sel.id ? { ...parcel, lignes: (parcel.lignes || []).map(item => item.id === line.id ? { ...item, cat } : item) } : parcel)); }); }}><option value="">Catégorie à vérifier</option>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
          </div>)}
        </>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {editable && <details open={dirty || undefined}><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-600"><ChevronRight size={16} className="iw-chevron" aria-hidden="true" />Ajouter un achat supplémentaire sans facture reliée</summary>
          <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!articleValid(articleLine())) { setError('Renseignez la description, la quantité, le prix HT et la catégorie.'); return; } guarded(add); }}>
            <input required disabled={busy} aria-label="Description du nouvel article" value={article.desc} onChange={event => setArticle({ ...article, desc: event.target.value })} placeholder="Description de l’article" className={INPUT} />
            <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-600">Quantité<input required disabled={busy} aria-label="Quantité du nouvel article" type="number" min="1" step="1" value={article.qte} onChange={event => setArticle({ ...article, qte: event.target.value })} className={INPUT} /></label><label className="text-xs text-slate-600">Prix unitaire HT (€)<input required disabled={busy} aria-label="Prix du nouvel article" type="number" min="0" step="0.01" value={article.prix} onChange={event => setArticle({ ...article, prix: event.target.value })} className={INPUT} /></label></div>
            <select required disabled={busy} aria-label="Catégorie du nouvel article" value={article.cat} onChange={event => setArticle({ ...article, cat: event.target.value })} className={INPUT}><option value="">Choisir une catégorie</option>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select>
            <button disabled={busy} className="min-h-11 w-full rounded-xl bg-slate-100 text-sm font-semibold text-slate-700">Enregistrer l’article</button>
            {dirty && <button type="button" disabled={busy} className="min-h-11 text-sm font-semibold text-slate-600 underline" onClick={() => { manualDrafts.delete(cacheKey); clearWorkDraft(); setArticle(emptyArticle()); }}>Effacer la saisie</button>}
          </form>
        </details>}
      </section>
    </InvoiceWorkspace>
    {children}
  </div>;
}
