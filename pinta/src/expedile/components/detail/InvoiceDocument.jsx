import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSignedFile } from '../ui/SecureFile';
import { invoiceIdentity } from '../../domain/invoiceProgress';
const PDFPreview = lazy(() => import('../ui/PDFPreview'));
const BUTTON = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold';
export default function InlineDocument({ invoice }) {
  // The private bucket is read through a short-lived signed URL; a failed
  // signature is retried on demand, never replaced by a public link.
  const { url, error, loading, retry, permanent } = useSignedFile('factures', invoice?.fichier);
  // The retry button disappears while the new link is requested: give focus
  // back to the document (or to the button again) instead of <body>.
  const box = useRef(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current || loading) return;
    refocus.current = false;
    (error && box.current?.querySelector('button') || box.current)?.focus({ preventScroll: true });
  }, [loading, error, url]);
  const tryAgain = () => { refocus.current = true; retry(); };
  if (!invoice?.fichier) return <p className="p-4 text-sm text-slate-600">Joignez le document pour vérifier les montants et articles.</p>;
  const identity = invoiceIdentity(invoice);
  const label = identity.supplierKnown ? identity.supplier : identity.fileName || 'Facture';
  const pdf = (invoice.fichierNom || invoice.fichier).split('?')[0].toLowerCase().endsWith('.pdf');
  return <div ref={box} tabIndex={-1} className="min-w-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{loading
    ? <div role="status" aria-label="Chargement du document" className="h-96 animate-pulse rounded-xl bg-slate-100" />
    : error ? permanent
      ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700"><p>Ce document ne peut pas être lu depuis ce lien. Demandez un nouveau dépôt du document ; le dossier reste ouvert.</p></div>
      : <div role="alert" className="space-y-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><p>Le document n’a pas pu être chargé. Vérifiez la connexion puis réessayez ; le dossier reste ouvert.</p><button type="button" onClick={tryAgain} className={`${BUTTON} border border-red-200 bg-white text-red-700`}><RefreshCw size={16} aria-hidden="true" />Réessayer</button></div>
    : <div className="space-y-2">{pdf
      ? <Suspense fallback={<p role="status" className="p-3 text-sm text-slate-600">Chargement du lecteur PDF…</p>}><PDFPreview key={invoice.fichier} url={url} title={label} /></Suspense>
      : <img src={url} alt={`Facture ${label}`} className="w-full rounded-lg" />}
      <a href={url} target="_blank" rel="noopener noreferrer" className={`${BUTTON} text-blue-700`}>Ouvrir le document en grand</a>
    </div>}
  </div>;
}
