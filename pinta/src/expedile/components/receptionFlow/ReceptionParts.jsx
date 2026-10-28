import React from 'react';
import { AlertTriangle, Check, CheckCircle2, Info, X } from 'lucide-react';

// Pieces shared by the four steps of the reception and by the arrival notices.

const STEPS = [['client', 'Client'], ['carton', 'Cartons'], ['validation', 'Validation']];

/** « Réceptionner des cartons », where the operator is (1 Client, 2 Cartons, 3 Validation) and « Fermer ». */
export function StepHeader({ step, onClose }) {
  const index = step === 'done' ? STEPS.length : Math.max(0, STEPS.findIndex(([key]) => key === step));
  // One row from 1280 px (title, steps, close); below, the steps take a row of their own under the title.
  return <header className="rf-header">
    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:gap-x-6 sm:px-6">
      <h1 className="rf-strong text-[18px] font-extrabold leading-tight sm:text-[20px]">Réceptionner des cartons</h1>
      <button type="button" onClick={onClose} className="rf-strong ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-[17px] font-bold hover:bg-slate-100 sm:px-3 xl:order-last">
        <X size={20} aria-hidden="true" />Fermer
      </button>
      <ol aria-label="Étapes de la réception" className="hidden w-full items-center gap-4 pb-1 md:flex xl:mx-auto xl:w-auto xl:pb-0">
        {STEPS.map(([key, label], position) => {
          const state = position < index ? 'done' : position === index ? 'current' : 'next';
          return <li key={key} aria-current={state === 'current' ? 'step' : undefined} className={`rf-step rf-step--${state}`}>
            {position > 0 && <span aria-hidden="true" className={`rf-step-link mr-2${position <= index ? ' rf-step-link--done' : ''}`} />}
            <span className="rf-step-mark" aria-hidden="true">{state === 'done' ? <Check size={16} strokeWidth={3} /> : position + 1}</span>
            {label}{state === 'done' && <span className="sr-only"> (terminé)</span>}
          </li>;
        })}
      </ol>
      <p className="rf-muted w-full pb-1 text-[15px] font-semibold md:hidden">{step === 'done' ? 'Réception validée' : `Étape ${index + 1} sur 3 : ${STEPS[index][1]}`}</p>
    </div>
  </header>;
}

/** « · Réunion · Saint-Pierre »: each part kept whole (never « Saint- » at the end of a line). */
export function Place({ place }) {
  if (!place) return null;
  return <span className="rf-muted text-[15px] font-semibold">{place.split(' · ').map((part, index) => <React.Fragment key={index}> · <span className="whitespace-nowrap">{part}</span></React.Fragment>)}</span>;
}

/** « Casier A-03 », read against the parcel: never split. */
export function Casier({ value, lower = false }) {
  const casier = String(value || '').trim();
  return casier ? <span className="whitespace-nowrap">{lower ? 'casier' : 'Casier'} <span className="rf-code font-bold">{casier}</span></span> : <span className="whitespace-nowrap">casier à renseigner</span>;
}

/** The client of the reception and what happens to the carton (`tone`: join, new). */
export function ClientBand({ client, place, detail, tone = 'join', action = null }) {
  return <div className={`rf-band rf-band--${tone} flex flex-wrap items-center justify-between gap-x-4 gap-y-2`}>
    <div className="min-w-0">
      <p className="rf-strong text-[19px] font-extrabold leading-snug">{client?.nom || 'Client'}<Place place={place} /></p>
      {detail && <p className="rf-band-detail mt-0.5 text-[16px]">{detail}</p>}
    </div>
    {action}
  </div>;
}

const NOTE_ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: AlertTriangle, neutral: Info };

/** A note in a coloured box: information, success, attention, failure. */
export function Note({ tone = 'info', role, title, children, action = null, className = '', id }) {
  const Icon = NOTE_ICONS[tone] || Info;
  return <div id={id} role={role} className={`rf-note rf-note--${tone} ${className}`}>
    <Icon size={24} aria-hidden="true" className="mt-0.5 shrink-0" />
    <div className="min-w-0 flex-1">
      {title && <p className="font-extrabold">{title}</p>}
      {children && <div className={title ? 'mt-0.5 text-[16px]' : ''}>{children}</div>}
      {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
    </div>
  </div>;
}

/** A labelled field with its error under it (aria-invalid, aria-describedby). */
export function Field({ id, label, hint, error, children, className = '' }) {
  return <div className={`min-w-0 ${className}`}>
    <label htmlFor={id} className="rf-label">{label}{hint && <span className="rf-label-hint"> · {hint}</span>}</label>
    {children}
    {error && <p id={`${id}-error`} className="rf-error">{error}</p>}
  </div>;
}

/** The props of an input with an error: aria-invalid and its description. */
export const invalidProps = (id, error) => error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {};

/** Neutral placeholders while a list loads, the shape of its rows. */
export function SkeletonRows({ rows = 3, label }) {
  return <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
    <p className="rf-muted text-[16px] font-semibold">{label}</p>
    <div aria-hidden="true" className="space-y-3">{Array.from({ length: rows }, (_, row) => <div key={row} className="rf-skeleton h-16 w-full" />)}</div>
  </div>;
}
