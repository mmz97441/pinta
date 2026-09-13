import { isActiveColis, queueContext, queueRows, timestamp } from './workQueues.js';
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Operational counts have an explicit data scope; no inferred time savings or revenue. */
export function operationalMetrics({ data = [], clients = [], categories = [], tarifs = {}, settings = {}, now = Date.now() }) {
  const context = queueContext({ clients, categories, tarifs, settings, now });
  const active = data.filter(isActiveColis);
  const voluntaryWait = queueRows(data, 'waiting', context);
  const awaitingDecision = queueRows(data, 'decision', context);
  const documents = queueRows(data, 'documents', context);
  const conversations = queueRows(data, 'messages', context);
  const unread = data.filter((parcel) => !parcel.archive && (parcel.messages || []).some((message) => message.type === 'client' && !message.lu));
  const failed = data.filter((parcel) => !parcel.archive && (parcel.messages || []).some((message) => message.statut === 'echec'));
  const ready = queueRows(data, 'ready', context);
  const decisionHours = data.flatMap((parcel) => {
    const requested = timestamp(parcel.demandeFeuVertEnvoyeeAt);
    const agreed = timestamp(parcel.feuVertDate);
    return parcel.feuVert === 'autorise' && Number.isFinite(requested) && agreed >= requested && agreed <= now ? [(agreed - requested) / 3600000] : [];
  });
  const overdue = queueRows(data, 'overdue', context);
  const waitsToReview = queueRows(data, 'wait-review', context);
  const paid = data.filter((parcel) => parcel.paiementDate && Number.isFinite(Number(parcel.paiementMontant)) && Number(parcel.paiementMontant) > 0);
  return { active, voluntaryWait, awaitingDecision, documents, conversations, conversationClientCount: new Set(conversations.map((parcel) => parcel.clientId)).size, unread, unreadClientCount: new Set(unread.map((parcel) => parcel.clientId)).size,
    failed, ready, overdue, waitsToReview, decisionHours, medianDecisionHours: median(decisionHours), paid,
    receipts: paid.reduce((sum, parcel) => sum + Number(parcel.paiementMontant), 0),
    paidTransport: paid.reduce((sum, parcel) => sum + Number(parcel.devisTransport || 0), 0),
    paidTaxes: paid.reduce((sum, parcel) => sum + Number(parcel.devisOM || 0) + Number(parcel.devisOMR || 0) + Number(parcel.devisTVA || 0), 0),
  };
}
