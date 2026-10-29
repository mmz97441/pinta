import React from 'react';
import { IDENTITY_LABELS, IDENTITY_MISSING } from '../../domain/dossierIdentity';
import { ZoneTag } from './StagePill';
import './identityFacts.css';

// Who and what the dossier is, each fact with its word (team request of 29 October 2026: a newcomer must not get lost
// between the shipment's number, the client's number, the plan, the destination and the delivery zone). The same
// words on the Brouillon sheet and on the complete dossier; the facts come from domain/dossierIdentity.js.

// The shipment, then its client: two lists, side by side where the width allows.
const GROUPS = Object.freeze([{ key: 'envoi' }, { key: 'client' }]);
const ALL_FACTS = Object.freeze(['ref', 'casier', 'livraison', 'client', 'forfait']);

/** A code (« EXP-TUALDS », « 5C »), or what it reads when it is not recorded. */
function Code({ value, missing }) {
  return value ? <span className="identity-code keep-token">{value}</span> : <span className="identity-missing">{missing}</span>;
}

/** « Ste Suzanne · Zone EST · La Réunion »: the commune, the zone and the destination, as far as they are known. */
function Delivery({ identity }) {
  const parts = [
    identity.commune && <span key="commune" className="identity-part">{identity.commune}</span>,
    identity.zone && <ZoneTag key="zone" zone={identity.zone} label={identity.zoneLabel} />,
    identity.destinationName ? <span key="destination" className="identity-part">{identity.destinationName}</span>
      : <span key="destination" className="identity-part identity-missing">{IDENTITY_MISSING.destination}</span>,
  ].filter(Boolean);
  return parts.flatMap((part, index) => index ? [<span key={`sep-${index}`} aria-hidden="true">{' · '}</span>, part] : [part]);
}

/** « N° CLI-7ASHU · Particulier ». */
function ClientFacts({ identity }) {
  if (!identity.clientRef && !identity.clientTypeLabel) return <span className="identity-missing">Non renseigné</span>;
  return <>
    {identity.clientRef && <>N° <span className="identity-code keep-token">{identity.clientRef}</span></>}
    {identity.clientRef && identity.clientTypeLabel && <span aria-hidden="true">{' · '}</span>}
    {identity.clientTypeLabel}
  </>;
}

const FACTS = {
  ref: { group: 'envoi', label: IDENTITY_LABELS.ref, value: identity => <Code value={identity.ref} missing={IDENTITY_MISSING.ref} /> },
  casier: { group: 'envoi', label: IDENTITY_LABELS.casier, value: identity => <Code value={identity.casier} missing={IDENTITY_MISSING.casier} /> },
  livraison: { group: 'envoi', label: IDENTITY_LABELS.livraison, value: identity => <Delivery identity={identity} /> },
  client: { group: 'client', label: IDENTITY_LABELS.client, value: identity => <ClientFacts identity={identity} /> },
  forfait: { group: 'client', label: IDENTITY_LABELS.forfait, value: identity => identity.forfaitLabel || <span className="identity-missing">{IDENTITY_MISSING.forfait}</span> },
};

/**
 * The facts of `identity` (dossierIdentity), each with its label: the shipment (N° d’envoi, Casier, Livraison) beside
 * its client (Client, Forfait). `facts`: which ones, in this order. `layout`: « columns » (the shipment beside the
 * client, the client under it on a phone) or « inline » (one line that wraps, under a heading that already says the
 * rest).
 */
export default function IdentityFacts({ identity, facts = ALL_FACTS, layout = 'columns', className = '', testId = 'identity-facts' }) {
  if (!identity) return null;
  const shown = facts.filter(key => FACTS[key]);
  const groups = GROUPS.map(group => ({ ...group, keys: shown.filter(key => FACTS[key].group === group.key) })).filter(group => group.keys.length);
  if (!groups.length) return null;
  return <div className={`identity-facts ${className}`.trim()} data-layout={layout} data-testid={testId}>
    {groups.map(group => <dl key={group.key} className="identity-group" data-group={group.key}>
      {group.keys.map(key => <div key={key} className="identity-row" data-fact={key}>
        <dt>{FACTS[key].label}</dt>
        <dd>{FACTS[key].value(identity)}</dd>
      </div>)}
    </dl>)}
  </div>;
}
