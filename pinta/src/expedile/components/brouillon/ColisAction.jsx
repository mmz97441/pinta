import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FolderOpen, UserRound } from 'lucide-react';
import { NO_ACTION_LABEL } from '../../domain/brouillon';
import { actionAllowed, actionTarget, dossierHref, heldLabel, refusalReason } from './colisLinks';

/** The confirmation of a message just sent from here (« Demande d’accord envoyée : Telegram a confirmé »). */
function Confirmation({ text }) {
  return <p role="status" className="colis-confirmation" data-testid="colis-confirmation"><CheckCircle2 size={18} aria-hidden="true" className="shrink-0" /><span>{text}</span></p>;
}

/**
 * The one action of a dossier, or « Rien à faire ». A message (`panel`: « Demander l’accord », « Relancer ») opens
 * the page's message sheet (`onOpenPanel`); any other action opens its page with the way back (`returnTo`).
 * - An action this account may not do (actionAllowed): a disabled button and why, or « Voir le dossier » for a
 *   task (the dossier opens in consultation).
 * - A task a colleague holds (`held`, the step's `heldBy`): « Lucie Martin s’en occupe »; the message stays closed.
 * - `confirmation`: the message just sent from here, said above the next action.
 */
export default function ColisAction({ row, action = row?.action, returnTo = '/', can, onOpenPanel, panelOpen = false, panelId, held = null, confirmation = null, size = 'normal', className = '' }) {
  // One per line (the page's sheet is shared by every line).
  const reasonId = `action-${row?.id || panelId || 'dossier'}-raison`;
  const holder = heldLabel(held);
  const said = confirmation ? <Confirmation text={confirmation} /> : null;
  if (!action) {
    if (said) return <div className={`grid gap-2 ${className}`}>{said}{holder && <p className="colis-reason colis-held"><UserRound size={16} aria-hidden="true" />{holder}</p>}</div>;
    return holder
      ? <p className={`colis-nothing colis-held ${className}`}><UserRound size={16} aria-hidden="true" />{holder}</p>
      : <p className={`colis-nothing ${className}`}>{NO_ACTION_LABEL}</p>;
  }
  const allowed = actionAllowed(action, can);
  const disabled = (reason, key = 'refus') => <div className={`grid gap-2 ${className}`}>
    {said}
    <div>
      <button type="button" disabled aria-describedby={reasonId} className="colis-action" data-size={size} data-action={action.key} data-blocked={key}>{action.label}</button>
      <p id={reasonId} className={`colis-reason${key === 'collegue' ? ' colis-held' : ''}`}>{key === 'collegue' && <UserRound size={16} aria-hidden="true" />}{reason}</p>
    </div>
  </div>;

  if (action.panel) {
    if (!allowed) return disabled(refusalReason(action));
    if (holder) return disabled(holder, 'collegue');
    return <div className={`grid gap-2 ${className}`}>
      {said}
      <button type="button" aria-haspopup="dialog" aria-expanded={panelOpen} aria-controls={panelOpen ? panelId : undefined} onClick={onOpenPanel}
        className="colis-action" data-size={size} data-action={action.key}>{action.label}</button>
    </div>;
  }
  if (!allowed) {
    if (action.key === 'valider_reception' || !row?.id) return disabled(refusalReason(action));
    // A task this account may not do: the dossier, to read it, and why the task is not offered.
    return <div className={`grid gap-2 ${className}`}>
      {said}
      <div>
        <Link to={dossierHref(row.id, returnTo)} aria-describedby={reasonId} className="colis-secondary w-full" data-action="voir_dossier" data-refused={action.key}><FolderOpen size={18} aria-hidden="true" />Voir le dossier</Link>
        <p id={reasonId} className="colis-reason">{refusalReason(action)}</p>
      </div>
    </div>;
  }
  const target = actionTarget(row, action, returnTo);
  if (!target) return said ? <div className={className}>{said}</div> : <p className={`colis-nothing ${className}`}>{NO_ACTION_LABEL}</p>;
  return <div className={`grid gap-2 ${className}`}>
    {said}
    <div>
      <Link to={target} className="colis-action" data-size={size} data-action={action.key} aria-describedby={holder ? reasonId : undefined}>{action.label}</Link>
      {holder && <p id={reasonId} className="colis-reason colis-held"><UserRound size={16} aria-hidden="true" />{holder}</p>}
    </div>
  </div>;
}
