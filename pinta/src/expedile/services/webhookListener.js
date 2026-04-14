// ══════════ SSE listener — messages Telegram entrants (legacy) ══════════
// Ce listener SSE n'est activé QUE si VITE_WEBHOOK_URL est explicitement défini.
// Les messages Telegram entrants passent désormais par :
//   1. Edge Function `telegram-webhook` (reçoit les messages du bot)
//   2. Insertion dans la table `messages` de Supabase
//   3. Supabase Realtime notifie le frontend
// Donc ce fichier est conservé uniquement pour compatibilité avec un serveur SSE externe.
// ─────────────────────────────────────────────────────────────────────────

const SSE_URL = import.meta.env.VITE_WEBHOOK_URL || '';

let eventSource = null;
let listeners = [];

/**
 * Se connecte au flux SSE si VITE_WEBHOOK_URL est configuré, sinon ne fait rien.
 * Retourne une fonction de nettoyage (no-op si SSE non configuré).
 */
export function connectWebhook(onEvent) {
  // Si aucune URL SSE n'est configurée, on n'essaie pas de se connecter
  if (!SSE_URL) {
    return () => {};
  }

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
