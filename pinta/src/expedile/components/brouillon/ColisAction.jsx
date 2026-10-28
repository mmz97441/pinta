import React from 'react';
import { Link } from 'react-router-dom';
import { NO_ACTION_LABEL, colisActionHref } from '../../domain/brouillon';

// The rights an action needs on this screen; the dossier task itself keeps its own checks.
const REQUIRED = {
  valider_reception: { permission: 'perm_colis_receptionner', reason: 'Réservé aux personnes autorisées à réceptionner.' },
  panel: { permission: 'perm_colis_demander_feuvert', reason: 'Réservé aux personnes autorisées à demander l’accord.' },
};

/** What the action of a row needs: its permission and the reason given when it is missing, or null. */
export function actionRequirement(action) {
  if (!action) return null;
  if (action.key === 'valider_reception') return REQUIRED.valider_reception;
  return action.panel ? REQUIRED.panel : null;
}

/**
 * The one action of a dossier, or « Rien à faire »: `href` opens a page (the reception to validate, the dossier
 * task with the way back), `panel` opens the message in place (`onTogglePanel`), a missing right disables the
 * button and says why. `href`: the action's own address when the caller already has it (the sheet), otherwise
 * colisActionHref(row, returnTo).
 */
export default function ColisAction({ row, action = row?.action, href = null, returnTo = '/', can, panelId, panelOpen = false, onTogglePanel, size = 'normal', className = '' }) {
  if (!action) return <p className={`colis-nothing ${className}`}>{NO_ACTION_LABEL}</p>;
  const requirement = actionRequirement(action);
  const reasonId = `${panelId || row?.id || 'action'}-raison`;
  if (requirement && !can(requirement.permission)) {
    return <div className={className}>
      <button type="button" disabled aria-describedby={reasonId} className="colis-action" data-size={size}>{action.label}</button>
      <p id={reasonId} className="colis-reason">{requirement.reason}</p>
    </div>;
  }
  if (action.panel) {
    return <div className={className}>
      <button type="button" aria-expanded={panelOpen} aria-controls={panelOpen ? panelId : undefined} onClick={onTogglePanel} className="colis-action" data-size={size} data-action={action.key}>{action.label}</button>
    </div>;
  }
  const target = href || action.href || colisActionHref(row, returnTo);
  if (!target) return <p className={`colis-nothing ${className}`}>{NO_ACTION_LABEL}</p>;
  return <div className={className}>
    <Link to={target} className="colis-action" data-size={size} data-action={action.key}>{action.label}</Link>
  </div>;
}
