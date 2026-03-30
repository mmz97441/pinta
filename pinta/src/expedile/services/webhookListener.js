// ══════════ SSE listener — messages Telegram entrants ══════════
// Se connecte au serveur webhook via Server-Sent Events.
// EventSource gère la reconnexion automatique en cas de coupure.
// ───────────────────────────────────────────────────────────────

const SSE_URL = import.meta.env.VITE_WEBHOOK_URL || '/api/events';

let eventSource = null;
let listeners = [];

/**
 * Se connecte au flux SSE et appelle `onEvent(event)` pour chaque événement.
 * Retourne une fonction de nettoyage.
 *
 * event.type === 'message'  → message entrant du client
 * event.type === 'status'   → mise à jour statut (sent|delivered|read)
 */
export function connectWebhook(onEvent) {
  listeners.push(onEvent);

  if (!eventSource) {
    eventSource = new EventSource(SSE_URL);

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        listeners.forEach((fn) => fn(event));
      } catch (err) {
        console.warn('[Webhook SSE] Parse error:', err);
      }
    };

    eventSource.onerror = () => {
      // EventSource reconnecte automatiquement
      console.warn('[Webhook SSE] Connexion perdue, reconnexion auto…');
    };
  }

  return () => {
    listeners = listeners.filter((fn) => fn !== onEvent);
    if (listeners.length === 0 && eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}
