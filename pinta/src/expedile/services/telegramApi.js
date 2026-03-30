// ══════════ Telegram Bot API ══════════
// Documentation : https://core.telegram.org/bots/api
//
// Modes d'envoi :
//   1. sendMessage → message texte (Markdown supporté)
//   2. sendDocument / sendPhoto → fichiers
//
// ⚠️  En production, le token devra être sur un backend sécurisé (jamais côté client)
// ──────────────────────────────────────────────────────────────────────────────

const BOT_TOKEN = import.meta.env.VITE_TG_BOT_TOKEN;

const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

/** Vérifie si l'API Telegram est configurée */
export function isTgConfigured() {
  return !!BOT_TOKEN;
}

/**
 * Normalise un numéro FR/DOM-TOM au format international sans le +
 * Ex: "+262 692 12 34 56" → "262692123456"
 *     "0692123456"        → "262692123456"
 */
export function normalizeTel(tel) {
  let cleaned = tel.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  if (cleaned.startsWith('06') || cleaned.startsWith('07')) {
    cleaned = '33' + cleaned.slice(1);
  } else if (cleaned.startsWith('0692') || cleaned.startsWith('0693') || cleaned.startsWith('0694')) {
    cleaned = '262' + cleaned.slice(1);
  } else if (cleaned.startsWith('0639')) {
    cleaned = '262' + cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Envoie un message texte via Telegram Bot API.
 *
 * @param {string} chatId - Chat ID du destinataire Telegram
 * @param {string} text   - Corps du message (supporte Markdown)
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
export async function sendText(chatId, text) {
  if (!isTgConfigured()) return { ok: false, error: 'API Telegram non configurée' };

  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  };

  try {
    const res = await fetch(`${BASE_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('[TG API] Erreur:', data);
      return { ok: false, error: data.description || `HTTP ${res.status}`, data };
    }
    console.log('[TG API] Message envoyé ✓', data);
    return { ok: true, data: data.result };
  } catch (err) {
    console.error('[TG API] Erreur réseau:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Construit un lien t.me (fallback manuel).
 */
export function tgMeLink(botUsername, text) {
  return `https://t.me/${botUsername || 'expedile_bot'}`;
}

/**
 * Envoie un message Telegram (chat).
 *
 * @param {string} chatId - Chat ID Telegram du destinataire
 * @param {string} text   - Corps du message
 * @returns {{ ok: boolean, messageId?: number, error?: string, tgLink?: string }}
 */
export async function sendTelegram(chatId, text) {
  if (!isTgConfigured()) {
    return { ok: false, error: 'API non configurée', tgLink: tgMeLink() };
  }

  const result = await sendText(chatId, text);

  if (result.ok) {
    return { ok: true, messageId: result.data?.message_id };
  } else {
    return { ok: false, error: result.error, tgLink: tgMeLink() };
  }
}

/**
 * Envoie une notification Telegram.
 * Contrairement à WhatsApp, pas de fenêtre 24h — on peut toujours envoyer.
 *
 * @param {string} chatId   - Chat ID Telegram du destinataire
 * @param {string} text     - Corps du message
 * @returns {{ ok: boolean, messageId?: number, error?: string, tgLink?: string, method?: string }}
 */
export async function sendNotification(chatId, text) {
  if (!isTgConfigured()) {
    return { ok: false, error: 'API non configurée', tgLink: tgMeLink() };
  }

  const result = await sendText(chatId, text);
  if (result.ok) {
    return {
      ok: true,
      messageId: result.data?.message_id,
      method: 'text',
    };
  }

  return {
    ok: false,
    error: result.error,
    tgLink: tgMeLink(),
    method: 'failed',
  };
}
