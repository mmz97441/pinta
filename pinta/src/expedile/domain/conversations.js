export const CONVERSATION_STATES = Object.freeze({
  a_traiter: 'À répondre',
  attente_client: 'Attente client',
  termine: 'Terminé',
});

export function conversationState(colis) {
  const value = typeof colis === 'string' ? colis : colis?.conversationStatut ?? colis?.conversation_statut;
  if (Object.hasOwn(CONVERSATION_STATES, value)) return value;
  // Compatibility for imported/local fixtures that have no durable state yet.
  // Reading never closes work. Only a later delivered reply offers historical
  // evidence that the last free-form customer message may have been handled.
  const messages = colis?.messages || [];
  const date = (message) => Date.parse(message.createdAt || message.created_at || '') || 0;
  const customer = messages.filter((message) => message.type === 'client' && !['client_decision_approve','client_decision_wait'].includes(message.template));
  if (!customer.length) return 'termine';
  const lastCustomer = Math.max(...customer.map(date));
  const delivered = messages.filter((message) => message.type === 'staff' && ['envoye','distribue','lu'].includes(message.statut));
  return delivered.some((message) => date(message) > lastCustomer) ? 'termine' : 'a_traiter';
}

export function needsConversationAction(colis) { return conversationState(colis) === 'a_traiter'; }
export function conversationLabel(valueOrColis) { return CONVERSATION_STATES[conversationState(valueOrColis)]; }
