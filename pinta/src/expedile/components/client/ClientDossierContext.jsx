import React, { useEffect, useRef, useState } from 'react';
import { FileText, MessageCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import FacturesPanel from '../detail/FacturesPanel';
import ChatPanel from '../detail/ChatPanel';

/** Open only the requested context, then retain drafts while switching panels. */
export default function ClientDossierContext() {
  const { sel } = useApp();
  const [params, setParams] = useSearchParams();
  const panel = params.get('panel');
  const [visited, setVisited] = useState({});
  const content = useRef(null);
  useEffect(() => {
    if (!['documents', 'messages'].includes(panel)) return;
    setVisited(previous => ({ ...previous, [panel]: true }));
    content.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    content.current?.focus({ preventScroll: true });
  }, [panel]);
  if (!sel) return null;
  const open = (name) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (panel === name) next.delete('panel'); else next.set('panel', name);
    return next;
  }, { replace: true });
  return <section aria-label="Documents et échanges du dossier" className="space-y-3 border-t border-slate-200 pt-4">
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-expanded={panel === 'documents'} aria-controls="client-documents" onClick={() => open('documents')} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"><FileText size={16} />Documents ({sel.factures?.length || 0})</button>
      <button type="button" aria-expanded={panel === 'messages'} aria-controls="client-conversation" onClick={() => open('messages')} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"><MessageCircle size={16} />Messages ({sel.messages?.length || 0})</button>
    </div>
    <div ref={content} tabIndex={-1} className="scroll-mt-24 focus:outline-none">
      <div id="client-documents" hidden={panel !== 'documents'}>{(panel === 'documents' || visited.documents) && <FacturesPanel />}</div>
      <section id="client-conversation" hidden={panel !== 'messages'} aria-label="Échanges avec l’équipe">{(panel === 'messages' || visited.messages) && <ChatPanel embedded active={panel === 'messages'} />}</section>
    </div>
  </section>;
}
