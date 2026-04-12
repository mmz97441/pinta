// ══════════ Telegram via Edge Function (sécurisé) ══════════
// Le token Telegram n'est PLUS dans le frontend.
// Tous les appels passent par l'Edge Function send-telegram côté serveur.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://bqprktzehuhplpqjgjaz.supabase.co';
const SEND_URL = `${SUPABASE_URL}/functions/v1/send-telegram`;
// TODO: Remplacer par JWT Supabase Auth quand verify_jwt sera activé
const API_SECRET = import.meta.env.VITE_EDGE_API_SECRET || '';
const BOT_USERNAME = 'Expedilebot';

function edgeHeaders() {
  return { 'Content-Type': 'application/json', 'x-api-secret': API_SECRET };
}

/** Vérifie si l'API Telegram est configurée (toujours true avec Edge Function) */
export function isTelegramConfigured() {
  return true;
}

export function normalizeTel(tel) {
  let cleaned = tel.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  if (cleaned.startsWith('06') || cleaned.startsWith('07')) {
    cleaned = '33' + cleaned.slice(1);
  } else if (cleaned.startsWith('0692') || cleaned.startsWith('0693') || cleaned.startsWith('0694')) {
    cleaned = '262' + cleaned.slice(1);
  } else if (cleaned.startsWith('0262')) {
    cleaned = '262' + cleaned.slice(1);
  }
  return cleaned;
}

export function telegramMeLink(startParam) {
  return `https://t.me/${BOT_USERNAME}${startParam ? '?start=' + encodeURIComponent(startParam) : ''}`;
}

export function telegramLink(clientId) {
  return telegramMeLink(clientId);
}

/** Envoie un message Telegram via Edge Function (token côté serveur) */
export async function sendTelegram(chatId, text) {
  if (!chatId) return { ok: false, error: 'Chat ID manquant' };
  if (!/^\d+$/.test(String(chatId))) return { ok: false, error: 'Format Chat ID invalide' };

  try {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: edgeHeaders(),
      body: JSON.stringify({ chatId: String(chatId), text }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log('[Telegram] Message envoyé ✓');
      return { ok: true, messageId: data.messageId };
    }
    console.error('[Telegram] Erreur:', data.error);
    return { ok: false, error: data.error || 'Erreur Telegram' };
  } catch (err) {
    console.error('[Telegram] Erreur réseau:', err);
    return { ok: false, error: err.message };
  }
}

/** Envoie un message en réponse à un message spécifique */
export async function sendTelegramReply(chatId, text, replyToMessageId) {
  if (!chatId) return { ok: false, error: 'Chat ID manquant' };
  try {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: edgeHeaders(),
      body: JSON.stringify({
        chatId: String(chatId),
        text,
        replyToId: replyToMessageId ? parseInt(replyToMessageId) : undefined,
      }),
    });
    const data = await res.json();
    return { ok: data.ok, messageId: data.messageId, error: data.error };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Envoie un message avec boutons inline (feu vert OUI/NON) */
export async function sendTelegramWithButtons(chatId, text, buttons) {
  if (!chatId) return { ok: false, error: 'Chat ID manquant' };
  try {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: edgeHeaders(),
      body: JSON.stringify({
        chatId: String(chatId),
        text,
        replyMarkup: { inline_keyboard: buttons },
      }),
    });
    const data = await res.json();
    return { ok: data.ok, messageId: data.messageId, error: data.error };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Alias pour compatibilité — envoie une notification simple */
export async function sendNotification(chatId, text) {
  return sendTelegram(chatId, text);
}
