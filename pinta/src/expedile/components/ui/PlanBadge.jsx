import React from 'react';
import { clientPlan } from '../../domain/clientPlan';
import './planBadge.css';

/** « P » Premium or « F » Freemium before a client's name; the full wording is read
 * by screen readers and shown on hover. `decorative` when the label is already written beside it. */
export default function PlanBadge({ client, plan = clientPlan(client), decorative = false }) {
  const label = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': plan.description, title: plan.description };
  return <span className="plan-badge" data-plan={plan.key} data-ended={plan.ended ? 'true' : undefined} {...label}>{plan.letter}</span>;
}
