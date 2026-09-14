import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FileText, ArrowUpRight } from 'lucide-react';
import { invoicesAwaitingReview, invoiceReviewLabel, invoiceReviewUrl } from '../../domain/invoiceReview';

export default function InvoiceReviewIndicator({ dossier, returnTo }) {
  const location = useLocation();
  const count = invoicesAwaitingReview(dossier).length;
  if (!count) return null;
  const label = invoiceReviewLabel(count);
  return <Link
    to={invoiceReviewUrl(dossier, returnTo || location.pathname + location.search)}
    onClick={event => event.stopPropagation()}
    aria-label={`${label} — ${dossier.ref}`}
    title="Ouvrir la facture à vérifier. Lire le message ne retire pas cet indicateur."
    className="mt-2 inline-flex min-h-11 max-w-full items-center gap-1.5 whitespace-normal rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-left text-xs font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
  ><FileText size={15} className="shrink-0" /><span>{label}</span><ArrowUpRight size={14} className="shrink-0" /></Link>;
}
