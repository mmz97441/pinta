import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, CheckCircle2, Info, MessageSquare, X } from 'lucide-react';

// Pieces shared by the three steps of the reception and by the arrival notices.

const STEPS = [['client', 'Client'], ['carton', 'Cartons'], ['done', 'Rangement']];

/** « Réceptionner des cartons », where the operator is (1 Client, 2 Cartons, 3 Rangement) and « Fermer ». */
export function StepHeader({ step, onClose }) {
  const index = Math.max(0, STEPS.findIndex(([key]) => key === step));
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
      <p className="rf-muted w-full pb-1 text-[15px] font-semibold md:hidden">{`Étape ${index + 1} sur ${STEPS.length} : ${STEPS[index][1]}`}</p>
    </div>
  </header>;
}

/** « · Réunion · Saint-Pierre »: each part kept whole (never « Saint- » at the end of a line). `lead`: the separator
 * before the first part, after a name on the same line. */
export function Place({ place, lead = true, className = '' }) {
  if (!place) return null;
  return <span className={`rf-muted text-[15px] font-semibold ${className}`}>{place.split(' · ').map((part, index) => <React.Fragment key={index}>{lead || index > 0 ? ' · ' : ''}<span className="whitespace-nowrap">{part}</span></React.Fragment>)}</span>;
}

/**
 * A table at every width (phone, tablet, computer): when the width runs short, it scrolls sideways in its own frame,
 * never the page, its first column pinned (opaque, an edge line, and a shadow at its edge while columns slide under
 * it or wait on the right). The frame is a region named `label`, which the keyboard can scroll while it overflows.
 */
export function TableFrame({ label, children, className = '' }) {
  const frameRef = useRef(null);
  const [edges, setEdges] = useState({ overflow: false, start: true, end: true });
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    let pending = 0;
    const measure = () => {
      pending = 0;
      const overflow = frame.scrollWidth > frame.clientWidth + 1;
      const start = frame.scrollLeft <= 1;
      const end = frame.scrollLeft + frame.clientWidth >= frame.scrollWidth - 1;
      setEdges(previous => previous.overflow === overflow && previous.start === start && previous.end === end ? previous : { overflow, start, end });
    };
    const schedule = () => { if (!pending) pending = requestAnimationFrame(measure); };
    measure();
    frame.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // The table grows with its rows (a list read again, a notice sent): measured again.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    if (observer) { observer.observe(frame); if (frame.firstElementChild) observer.observe(frame.firstElementChild); }
    return () => {
      frame.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (pending) cancelAnimationFrame(pending);
    };
  }, []);
  return <div className={`rf-table-shell ${className}`} data-overflow={edges.overflow ? 'true' : undefined}
    data-scrolled={edges.overflow && !edges.start ? 'true' : undefined} data-more={edges.overflow && !edges.end ? 'true' : undefined}>
    <div ref={frameRef} className="rf-table-frame" role="region" aria-label={label} tabIndex={edges.overflow ? 0 : undefined}>{children}</div>
  </div>;
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

/** The permissions that open the conversation of a dossier (its « Conversation » tab). */
export const CONVERSATION_PERMISSIONS = ['perm_comm_message_libre', 'perm_comm_telegram', 'perm_comm_email', 'perm_comm_voir_chat_autres'];

/** The conversation of a dossier; « returnTo » brings back to the reception. */
export const conversationHref = (dossierId, returnTo) => `/colis/${encodeURIComponent(dossierId)}?${new URLSearchParams({ onglet: 'conversation', ...(returnTo ? { returnTo } : {}) })}`;

/** The cartons flagged at the reception (damaged or opened, forbidden product: [{ colisId, ref, carton, damaged,
 * interdits }]), which the arrival notice does not mention: the team tells the client from the dossier's
 * conversation. `notice`: an arrival notice is sent (or was). */
export function FlaggedCartons({ flagged, name, title, returnTo, canOpen, notice = true }) {
  if (!flagged?.length) return null;
  return <Note tone="warning" role="note" title={title}>
    <TableFrame label={`Cartons à signaler à ${name}`} className="mt-2">
      <table className="rf-table">
        <caption className="sr-only">Cartons signalés à la réception</caption>
        <thead><tr>
          <th scope="col">Carton</th><th scope="col">Dossier</th><th scope="col">Signalé</th>
          {canOpen && <th scope="col">Action</th>}
        </tr></thead>
        <tbody>{flagged.map(item => <tr key={`${item.colisId}:${item.carton}`}>
          <th scope="row"><span className="rf-carton-number"><span className="sr-only">Carton </span>{item.carton}</span></th>
          <td><span className="rf-code whitespace-nowrap font-semibold">{item.ref}</span></td>
          <td className="rf-cell-text">
            {item.damaged && <span className="block">Abîmé ou ouvert</span>}
            {item.interdits?.length > 0 && <span className="block">Produit interdit : {item.interdits.join(', ')}</span>}
          </td>
          {canOpen && <td><Link to={conversationHref(item.colisId, returnTo)} aria-label={`Ouvrir la conversation du dossier ${item.ref}`}
            className="rf-small-action inline-flex items-center gap-2 whitespace-nowrap"><MessageSquare size={18} aria-hidden="true" />Ouvrir la conversation</Link></td>}
        </tr>)}</tbody>
      </table>
    </TableFrame>
    <p className="mt-2">{notice ? 'L’avis d’arrivée n’en parle pas : ' : ''}{notice ? `prévenez ${name}` : `Prévenez ${name}`} depuis la conversation du dossier.{canOpen ? '' : ' Demandez à un collègue qui écrit aux clients de le faire.'}</p>
  </Note>;
}

/** Neutral placeholders while a table loads: its frame, its header and the shape of its rows. */
export function SkeletonRows({ rows = 3, label }) {
  return <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
    <p className="rf-muted text-[16px] font-semibold">{label}</p>
    <div aria-hidden="true" className="rf-table-frame">
      <div className="rf-skeleton-head" />
      {Array.from({ length: rows }, (_, row) => <div key={row} className="rf-skeleton-row"><div className="rf-skeleton h-6 w-1/4" /><div className="rf-skeleton h-6 flex-1" /></div>)}
    </div>
  </div>;
}
