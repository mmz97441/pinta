import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import TaskMessage from '../staff/TaskMessage';

/**
 * « Demander l’accord » and « Relancer » opened in place: the dossier's message, exactly as its accord task
 * shows it (StaffDetailView): the request with `demanderFeuVert` before the send while the dossier is measured,
 * the relance once the request waits for the client. TaskMessage reads the selected dossier (`sel`, `setSelId`):
 * the screen selects this dossier before opening the panel, and the panel shows the message only once the
 * selection is this dossier. One instance (`consent-<id>`) across the change of step, as in the dossier: a send
 * whose answer was lost keeps its exact text and key for « Réessayer cet envoi ».
 */
export default function ConsentPanel({ dossierId, title, returnHref, onClose, id }) {
  const { sel, can, demanderFeuVert } = useApp();
  const panel = useRef(null);
  const titleId = `${id}-titre`;
  const ready = sel?.id === dossierId;
  // The panel takes the focus when it opens: the next Tab reaches its message, Shift+Tab the row.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const allowed = can('perm_colis_demander_feuvert');
  let content;
  if (!ready) content = <p role="status" className="colis-muted text-[15px]">Ouverture du message…</p>;
  else if (sel.statut === 'mesure') content = <TaskMessage key={`consent-${sel.id}`} template="demande_feu_vert" autoPreview sendLabel="Envoyer la demande d’accord" label="Préparer la demande au client" disabled={!allowed} beforeSend={options => demanderFeuVert(sel.id, options)} />;
  else if (sel.statut === 'attente_feu_vert' && !sel.attenteClientDate) content = <TaskMessage key={`consent-${sel.id}`} template="relance_feu_vert" autoPreview label="Préparer une relance" disabled={!allowed} />;
  else content = <p className="text-[15px]">L’étape de ce dossier a changé : le message n’est plus à envoyer d’ici. {returnHref && <Link className="colis-link-button" to={returnHref}>Ouvrir l’accord du client</Link>}</p>;
  return <section ref={panel} id={id} tabIndex={-1} aria-labelledby={titleId} className="colis-panel">
    <div className="colis-panel-head">
      <h2 id={titleId}>{title}</h2>
      <button type="button" onClick={onClose} className="colis-secondary shrink-0"><X size={18} aria-hidden="true" />Fermer</button>
    </div>
    {content}
  </section>;
}
