import React from 'react';
import { ChevronRight, Package } from 'lucide-react';
import { cartonManifest, clientWorkState } from '../../domain/clientJourney';
import { eur } from '../../utils';
import { hasPublishedQuote } from './quoteVisibility';

export default function ClientShipmentCard({ colis, client, onOpen }) {
  const state = clientWorkState(colis, client);
  const manifest = cartonManifest(colis);
  return <button onClick={onOpen} className="card min-h-11 w-full rounded-2xl p-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-bold text-slate-900">{colis.ref}</p><p className="mt-1 break-words text-sm text-slate-600">{colis.desc || 'Votre expédition'}</p></div><ChevronRight size={20} className="mt-1 shrink-0 text-slate-500" /></div>
    <p className="mt-3 flex items-center gap-2 text-xs text-slate-600"><Package size={15} />{manifest.count} carton{manifest.count > 1 ? 's' : ''} réceptionné{manifest.count > 1 ? 's' : ''}</p>
    <p className="mt-2 text-sm font-semibold brand-t">{state.journey.label}</p>
    <p className="mt-1 text-xs text-slate-600">{state.journey.next}</p>
    {state.journey.waiting && <p className="mt-2 text-xs text-slate-600">{colis.attenteClientMotif}{colis.attenteClientUntil ? ` · Réexamen ${state.journey.reviewDue ? 'prévu depuis' : 'prévu le'} ${new Date(colis.attenteClientUntil).toLocaleDateString('fr-FR')}` : ''}</p>}
    {hasPublishedQuote(colis) && <p className="mt-2 text-sm font-semibold text-slate-800">Devis : {eur(colis.devisTotal)}</p>}
    <span className={`mt-3 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold ${state.section === 'todo' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{state.action}</span>
  </button>;
}
