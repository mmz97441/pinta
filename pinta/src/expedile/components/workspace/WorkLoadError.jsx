import React, { useId } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { PRIMARY_COMMAND } from './workCommands';
import './workLoadError.css';

/** A list that could not be read (the dossiers or the tasks never loaded):
 * its reason and « Réessayer » in place of the list, never a count of 0 nor
 * an « all done » sentence. Mon travail, Équipe and Conversations. */
export default function WorkLoadError({ title, reason, note, retrying = false, onRetry }) {
  const titleId = useId();
  return <section role="alert" aria-labelledby={titleId} className="work-load-error">
    <AlertTriangle size={20} aria-hidden="true" className="work-load-error-icon" />
    <div className="work-load-error-body">
      <h2 id={titleId}>{title}</h2>
      <p className="work-load-error-reason">{reason}</p>
      {note && <p>{note}</p>}
      <button type="button" disabled={retrying} onClick={onRetry} className={PRIMARY_COMMAND}><RefreshCw size={16} aria-hidden="true" className={retrying ? 'animate-spin' : undefined} />{retrying ? 'Nouvel essai…' : 'Réessayer'}</button>
    </div>
  </section>;
}
