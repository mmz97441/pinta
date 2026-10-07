import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ChevronDown } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { dossierAlerts } from '../../domain/dossierAlerts';
import { departureFieldEditable } from '../../domain/departurePlanning';
import useMediaQuery from '../../hooks/useMediaQuery';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import './dossierAlerts.css';

/** The client page for reading only: without the request to complete a field. */
function readingHref(href) {
  const url = new URL(href, 'https://expedile.invalid');
  url.searchParams.delete('completer');
  return url.pathname + url.search;
}

/** « À vérifier », between the dossier header and its tabs, on both tabs: one
 * line per alert with the link that handles it. Links only: nothing here writes.
 * A link the person cannot follow (client page, conversation, measures, consent,
 * or a Départ field that would not open, `departureReadOnly` while a colleague
 * holds it) is left out. The minute clock opens and closes the time-bound alerts
 * (relance window, follow-up of a request) on a page left open. */
export default function DossierAlerts({ conversation = false, departureReadOnly = false }) {
  const location = useLocation();
  const { sel, selClient, envois = [], can } = useApp();
  const now = useMinuteNow();
  // On a phone, several alerts fold behind their count so the dossier stays in view.
  const phone = useMediaQuery('(max-width: 639px)');
  const [open, setOpen] = useState(false);
  const alerts = sel ? dossierAlerts({ dossier: sel, client: selClient, envoi: envois.find(envoi => envoi.id === sel.envoi), envois, today: now, dossierUrl: location.pathname + location.search }) : [];
  if (!alerts.length) return null;
  // Each link leads where the person can act; reading a record alone gets « Voir la fiche client ».
  const canInvite = can('perm_clients_creer') || can('perm_clients_modifier');
  const canEditClient = can('perm_clients_modifier');
  const canSeeClient = canInvite || can('perm_clients_voir');
  const canReply = can('perm_comm_message_libre') || can('perm_comm_telegram') || can('perm_comm_email');
  // The desired-day links open the Départ field: offered only when it opens for this person.
  const canPlanDeparture = !departureReadOnly && departureFieldEditable(sel, can);
  // The consent before the closing leads to the measures (cartons received) or to the consent request.
  const canHandleConsent = alert => can(alert.step === 'reception' ? 'perm_colis_mesurer' : 'perm_colis_demander_feuvert');
  const linkFor = alert => alert.key === 'after_subscription' ? canReply ? alert.action : null
    : alert.key === 'departure_to_create' || alert.key === 'departure_to_assign' ? canPlanDeparture ? alert.action : null
    : alert.key === 'consent_before_cutoff' ? canHandleConsent(alert) ? alert.action : null
    : (alert.key === 'no_contact' ? canInvite : canEditClient) ? alert.action
      : canSeeClient ? { label: 'Voir la fiche client', href: readingHref(alert.action.href) } : null;
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
  // The heading stays a heading outside the fold's summary (a summary is a button: its content is not a heading).
  return <section aria-label="À vérifier" className="dossier-alerts">
    <div className={`dossier-alerts-inner w-full px-4 sm:px-6 lg:px-8 ${conversation ? '' : 'mx-auto max-w-[1600px]'}`}>
      <AlertTriangle size={20} aria-hidden="true" className="dossier-alerts-icon" />
      <div className="dossier-alerts-content">
        {phone && alerts.length > 1 ? <>
          <h2 className="sr-only">À vérifier</h2>
          <details className="dossier-alerts-fold" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
            <summary className="dossier-alerts-summary"><span className="dossier-alerts-title">À vérifier</span><span aria-hidden="true" className="dossier-alerts-count">·</span><span className="dossier-alerts-count">{alerts.length} points</span><ChevronDown size={18} aria-hidden="true" className="dossier-alerts-chevron" /></summary>
            {list}
          </details>
        </> : <><h2 className="dossier-alerts-title">À vérifier</h2>{list}</>}
      </div>
    </div>
  </section>;
}
