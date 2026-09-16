import React, { Suspense, lazy } from 'react';
import { useSignedFile } from '../ui/SecureFile';
const PDFPreview = lazy(() => import('../ui/PDFPreview'));
const BUTTON = 'min-h-11 inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold';
export default function InlineDocument({ invoice }) {
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
