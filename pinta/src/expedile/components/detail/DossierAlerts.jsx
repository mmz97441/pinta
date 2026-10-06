import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ChevronDown } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { dossierAlerts } from '../../domain/dossierAlerts';
import useMediaQuery from '../../hooks/useMediaQuery';
import './dossierAlerts.css';

/** « À vérifier », between the dossier header and its tabs, on both tabs: one
 * line per alert with the link that handles it. Links only: nothing here writes.
 * A link the person cannot follow (client page or conversation) is left out. */
export default function DossierAlerts({ conversation = false }) {
  const location = useLocation();
  const { sel, selClient, envois = [], can } = useApp();
  // On a phone, several alerts fold behind their count so the dossier stays in view.
  const phone = useMediaQuery('(max-width: 639px)');
  const [open, setOpen] = useState(false);
  const alerts = sel ? dossierAlerts({ dossier: sel, client: selClient, envoi: envois.find(envoi => envoi.id === sel.envoi), dossierUrl: location.pathname + location.search }) : [];
  if (!alerts.length) return null;
  // Each link leads where the person can act; reading a record alone gets « Voir la fiche client ».
  const canInvite = can('perm_clients_creer') || can('perm_clients_modifier');
  const canEditClient = can('perm_clients_modifier');
  const canSeeClient = canInvite || can('perm_clients_voir');
  const canReply = can('perm_comm_message_libre') || can('perm_comm_telegram') || can('perm_comm_email');
  const linkFor = alert => alert.key === 'after_subscription' ? canReply ? alert.action : null
    : (alert.key === 'no_contact' ? canInvite : canEditClient) ? alert.action
      : canSeeClient ? { ...alert.action, label: 'Voir la fiche client' } : null;
  // Already on the Conversation tab, « Écrire au client » goes to the reply field.
  const follow = (alert, event) => {
    const reply = conversation && alert.key === 'after_subscription' ? document.getElementById(`staff-message-${sel.id}`) : null;
    if (!reply) return;
    event.preventDefault();
    reply.focus();
  };
  const list = <ul className="dossier-alerts-list">
    {alerts.map(alert => <li key={alert.key} className="dossier-alerts-item" data-alert={alert.key}>
      <p className="dossier-alerts-text">{alert.text}</p>
      {linkFor(alert) && <Link to={linkFor(alert).href} onClick={event => follow(alert, event)} className="dossier-alerts-action">
        {linkFor(alert).label}<ArrowRight size={16} aria-hidden="true" />
      </Link>}
    </li>)}
  </ul>;
  return <section aria-label="À vérifier" className="dossier-alerts">
    <div className={`dossier-alerts-inner w-full px-4 sm:px-6 lg:px-8 ${conversation ? '' : 'mx-auto max-w-[1600px]'}`}>
      <AlertTriangle size={20} aria-hidden="true" className="dossier-alerts-icon" />
      <div className="dossier-alerts-content">
        {phone && alerts.length > 1 ? <details className="dossier-alerts-fold" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
          <summary className="dossier-alerts-summary"><h2 className="dossier-alerts-title">À vérifier</h2><span aria-hidden="true" className="dossier-alerts-count">·</span><span className="dossier-alerts-count">{alerts.length} points</span><ChevronDown size={18} aria-hidden="true" className="dossier-alerts-chevron" /></summary>
          {list}
        </details> : <><h2 className="dossier-alerts-title">À vérifier</h2>{list}</>}
      </div>
    </div>
  </section>;
}
