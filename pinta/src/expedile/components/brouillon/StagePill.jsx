import React from 'react';

/** Where the dossier is, in the team's words (colisStage): the pill's colour follows its step or its tone. */
export default function StagePill({ stage, notice = null, className = '' }) {
  if (!stage?.label) return null;
  return <span className={`colis-pill ${className}`} data-stage={notice ? undefined : stage.key} data-notice={notice || undefined} data-tone={stage.tone || 'neutral'}>{stage.label}</span>;
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
