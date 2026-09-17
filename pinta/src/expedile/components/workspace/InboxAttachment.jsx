import React, { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { supabase } from '../../lib/supabase';
import { functionErrorMessage } from '../../services/functionErrors';
const PDFPreview = lazy(() => import('../ui/PDFPreview'));

export default function InboxAttachment({ item }) {
  const [document, setDocument] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const objectUrl = useRef(null);
  const generation = useRef(0);
  const file = item.payload?.document || item.payload?.photo?.at(-1);
  useEffect(() => {
    generation.current++; setDocument(null); setError(''); setBusy(false);
    return () => { generation.current++; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; };
  }, [item.id]);
  async function preview() {
    const attempt = generation.current; setBusy(true); setError('');
    try {
      const response = await supabase.functions.invoke('telegram-inbox-document', { body: { inboxId: item.id } });
      if (response.error || !(response.data instanceof Blob)) throw new Error(await functionErrorMessage(response, 'Aperçu indisponible. Réessayez.'));
      if (generation.current !== attempt) return;
      const type = response.data.type;
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Ce format ne peut pas être affiché.');
      objectUrl.current = URL.createObjectURL(response.data); setDocument({ url: objectUrl.current, type });
    } catch (issue) { if (generation.current === attempt) setError(issue.message); }
    finally { if (generation.current === attempt) setBusy(false); }
  }
  if (!file) return null;
  const name = file.file_name || 'Photo reçue sur Telegram';
  return <section className="space-y-2 rounded-xl border p-3" aria-label="Pièce jointe à rattacher">
    <p className="break-words text-sm font-semibold">{name}</p>
    {!document && <button disabled={busy} onClick={preview} className="min-h-11 rounded-lg border px-3 text-sm font-semibold">{busy ? 'Ouverture…' : 'Voir le document avant de le rattacher'}</button>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {document && (document.type === 'application/pdf' ? <Suspense fallback={<p role="status">Chargement du document…</p>}><PDFPreview url={document.url} title={name} /></Suspense> : <img src={document.url} alt={name} className="max-h-96 max-w-full object-contain" />)}
  </section>;
}
