import React from 'react';
import { PHASES_CLIENT, getPhaseIndex } from '../../constants';
import { clientJourney } from '../../domain/clientJourney';

/** Stage markers are milestones, never an estimate of remaining time. */
export default function ProgressBar({ statut, size = 'sm', showLabel = true }) {
  const idx = getPhaseIndex(statut);
  const state = clientJourney({ statut });
  return <div className={size === 'md' ? '' : 'mt-2'}>
    {showLabel && <p className="mb-2 text-xs font-semibold text-slate-600">{state.label}</p>}
    <div role="group" className="flex gap-1" aria-label={`Étape : ${state.label}`}>
      {PHASES_CLIENT.map((phase, index) => <span key={phase.key} aria-hidden="true" className={`h-1.5 min-w-0 flex-1 rounded-full ${index <= idx ? 'bg-slate-600' : 'bg-slate-200'}`} />)}
    </div>
  </div>;
}
