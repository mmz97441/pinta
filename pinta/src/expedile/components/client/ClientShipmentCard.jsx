import React from 'react';
import { ChevronRight, Package } from 'lucide-react';
import { cartonManifest, clientWorkState } from '../../domain/clientJourney';
import { eur } from '../../utils';
import { plural } from '../../domain/plural';
import { hasPublishedQuote } from './quoteVisibility';

/** Top-aligned content and an action pinned to the bottom: cards of one grid row line up. */
export default function ClientShipmentCard({ colis, client, onOpen }) {
  const state = clientWorkState(colis, client);
  const manifest = cartonManifest(colis);
  return <button type="button" onClick={onOpen} className="card flex h-full min-h-11 w-full flex-col items-stretch justify-start rounded-2xl p-4 text-left transition-all duration-200 ease-out hover:bg-slate-50 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
    <span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block font-bold text-slate-900">{colis.ref}</span><span className="mt-1 block break-words text-sm text-slate-600">{colis.desc || 'Votre expédition'}</span></span><ChevronRight size={20} className="mt-1 shrink-0 text-slate-500" aria-hidden="true" /></span>
    <span className="mt-3 flex items-center gap-2 text-sm text-slate-600"><Package size={15} aria-hidden="true" className="shrink-0" />{plural(manifest.count, 'carton réceptionné', 'cartons réceptionnés')}</span>
    <span className="mt-2 block text-sm font-semibold brand-t">{state.journey.label}</span>
    {state.section !== 'todo' && <span className="mt-1 block text-sm text-slate-600">{state.journey.next}</span>}
    {state.journey.waiting && <span className="mt-2 block text-sm text-slate-600">{colis.attenteClientMotif}{colis.attenteClientUntil ? `${colis.attenteClientMotif ? ' · ' : ''}Réexamen ${state.journey.reviewDue ? 'prévu depuis le' : 'prévu le'} ${new Date(colis.attenteClientUntil).toLocaleDateString('fr-FR')}` : ''}</span>}
    {hasPublishedQuote(colis) && !state.journey.quoteUpdating && <span className="mt-2 block text-sm font-semibold text-slate-800">Devis&nbsp;: {eur(colis.devisTotal)}</span>}
    <span className="mt-auto block pt-3"><span className={`inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold ${state.section === 'todo' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{state.action}</span></span>
  </button>;
}
