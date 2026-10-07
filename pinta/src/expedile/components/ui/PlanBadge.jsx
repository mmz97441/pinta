import React from 'react';
import { clientPlan } from '../../domain/clientPlan';
import './planBadge.css';

/** « P » Premium or « F » Freemium before a client's name; the full wording is read
 * by screen readers and shown on hover. `decorative` when the label is already written
 * beside it. Without a plan or a client, nothing: an unknown client has no offer. */
export default function PlanBadge({ client, plan, decorative = false }) {
  const shown = plan || (client ? clientPlan(client) : null);
  if (!shown) return null;
  const label = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': shown.description, title: shown.description };
  return <span className="plan-badge" data-plan={shown.key} data-ended={shown.ended ? 'true' : undefined} {...label}>{shown.letter}</span>;
}
