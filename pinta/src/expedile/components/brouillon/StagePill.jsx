import React from 'react';
import { IDENTITY_LABELS } from '../../domain/dossierIdentity';
import './zoneTag.css';

/** Where the dossier is, in the team's words (colisStage): the pill's colour follows its step or its tone. */
export default function StagePill({ stage, notice = null, className = '' }) {
  if (!stage?.label) return null;
  return <span className={`colis-pill ${className}`} data-stage={notice ? undefined : stage.key} data-notice={notice || undefined} data-tone={stage.tone || 'neutral'}>{stage.label}</span>;
}

/** The delivery zone of La Réunion with its word, « Zone EST », one colour per zone (as in SunApps, the zone's name in
 * capitals). `region`: the destination it stands for when the line does not name it (« Réunion, Zone Est » for a
 * screen reader). */
export function ZoneTag({ zone, label, region = '' }) {
  if (!zone || !label) return null;
  return <span className="colis-zone" data-zone={zone}>{region && <span className="sr-only">{region}, </span>}{IDENTITY_LABELS.zone} <span className="colis-zone-name">{label}</span></span>;
}

/** « N° client CLT174737 » and « Forfait Premium Annuel », each on its line with its word, when known. */
export function ClientMeta({ clientRef, forfaitLabel, className = 'colis-sub' }) {
  if (!clientRef && !forfaitLabel) return null;
  return <>
    {clientRef && <span className={className} data-client-meta="ref">{IDENTITY_LABELS.clientRef} <span className="colis-code keep-token">{clientRef}</span></span>}
    {forfaitLabel && <span className={className} data-client-meta="forfait">{IDENTITY_LABELS.forfait} {forfaitLabel}</span>}
  </>;
}

/** « 7 clients · 19 cartons · 40,6 kg · 0,441 m³ » from colisTotals: a weight or a volume is shown only when
 * known, and the dossiers left out of them are named (« 1 dossier à mesurer »), never a false zero. */
export function totalsParts(totals, { amount = false } = {}) {
  if (!totals) return [];
  const { labels } = totals;
  const parts = [labels.clients, labels.cartons];
  if (totals.poids !== null) parts.push(labels.poids);
  if (totals.volume !== null) parts.push(labels.volume);
  const unmeasured = Math.max(totals.poidsManquants || 0, totals.volumeManquants || 0);
  if (unmeasured > 0) parts.push(`${unmeasured} ${unmeasured > 1 ? 'dossiers' : 'dossier'} à mesurer`);
  if (amount && totals.montantVisible) {
    parts.push(totals.montantConnu !== null ? `${labels.montant} (${labels.prixConnus})` : 'prix à calculer');
  }
  return parts;
}
