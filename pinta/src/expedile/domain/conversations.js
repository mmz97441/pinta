// One vocabulary for the list, the thread and the confirmations.
export const CONVERSATION_STATES = Object.freeze({
  a_traiter: 'À répondre',
  attente_client: 'Attente client',
  termine: 'Traitée',
});

// Object.hasOwn is missing from Safari 14, the declared build target.
const known = value => Object.prototype.hasOwnProperty.call(CONVERSATION_STATES, value);

export function conversationState(colis) {
  const value = typeof colis === 'string' ? colis : colis?.conversationStatut ?? colis?.conversation_statut;
  if (known(value)) return value;
  // Compatibility for imported/local fixtures that have no durable state yet.
  // Reading never closes work. Only a later delivered reply offers historical
  // evidence that the last free-form customer message may have been handled.
  const messages = colis?.messages || [];
  const date = (message) => Date.parse(message.createdAt || message.created_at || '') || 0;
  const customer = messages.filter((message) => message.type === 'client' && !['client_decision_approve','client_decision_wait'].includes(message.template));
  if (!customer.length) return 'termine';
  const lastCustomer = Math.max(...customer.map(date));
  const delivered = messages.filter((message) => message.type === 'staff' && messageDelivered(message));
  return delivered.some((message) => date(message) > lastCustomer) ? 'termine' : 'a_traiter';
}

export function needsConversationAction(colis) { return conversationState(colis) === 'a_traiter'; }
export function conversationLabel(valueOrColis) { return CONVERSATION_STATES[conversationState(valueOrColis)]; }

// The delivery of a message, worded the same in the thread and in the lists.
const DELIVERY_LABELS = Object.freeze({ envoi: 'En attente de livraison', envoye: 'Envoyé', distribue: 'Distribué', lu: 'Lu', echec: 'Envoi non confirmé', en_attente: 'En attente de connexion Telegram' });
/** Telegram (or the portal) confirmed the message: pending, failed or draft messages are not sent. */
export function messageDelivered(message) { return ['envoye', 'distribue', 'lu'].includes(message?.statut); }
export function messageDeliveryLabel(message) {
  if (!message?.statut) return null;
  // No business e-mail provider is connected: an e-mail stays a manual draft.
  return message.canal === 'email' && message.statut === 'envoi' ? 'Brouillon manuel' : DELIVERY_LABELS[message.statut] || message.statut;
}
