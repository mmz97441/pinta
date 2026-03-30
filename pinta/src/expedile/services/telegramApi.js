// ══════════ Telegram Bot API ══════════
// Documentation : https://core.telegram.org/bots/api
//
// Envoi de messages via bot Telegram.
// Le bot doit être créé via @BotFather et le token stocké en variable d'env.
//
// ⚠️  En production, le token devra être sur un backend sécurisé (jamais côté client)
// ──────────────────────────────────────────────────────────────────────────────

const BOT_TOKEN = import.meta.env.VITE_TG_BOT_TOKEN || import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = 'expedile_bot';

/** Vérifie si l'API Telegram est configurée */
export function isTelegramConfigured() {
  return !!BOT_TOKEN;
}

/**
 * Normalise un numéro FR/DOM-TOM au format international sans le +
 * Ex: "+262 692 12 34 56" → "262692123456"
 *     "0692123456"        → "262692123456"
 */
export function normalizeTel(tel) {
  let cleaned = tel.replace(/[^0-9+]/g, '');
  // Si commence par +, on enlève le +
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  // Si commence par 0 (numéro local Réunion/Mayotte/Antilles)
  if (cleaned.startsWith('06') || cleaned.startsWith('07')) {
    cleaned = '33' + cleaned.slice(1); // France métro
  } else if (cleaned.startsWith('0692') || cleaned.startsWith('0693') || cleaned.startsWith('0694')) {
    cleaned = '262' + cleaned.slice(1); // Réunion
  } else if (cleaned.startsWith('0639')) {
    cleaned = '262' + cleaned.slice(1); // Mayotte
  }
  return cleaned;
}

/**
 * Construit un lien t.me (deep link vers le bot).
 */
export function telegramMeLink(startParam) {
  return `https://t.me/${BOT_USERNAME}${startParam ? '?start=' + encodeURIComponent(startParam) : ''}`;
}

/**
 * Envoie un message Telegram via le Bot API.
 *
 * @param {string} chatId - Chat ID du destinataire
 * @param {string} text   - Corps du message (Markdown supporté)
 * @returns {{ ok: boolean, messageId?: string, error?: string }}
 */
export async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN || !chatId) return { ok: false, error: 'Bot non configuré' };

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log('[Telegram API] Message envoyé ✓', data);
      return { ok: true, messageId: data.result?.message_id };
    }
    console.error('[Telegram API] Erreur:', data);
    return { ok: false, error: data.description || 'Erreur Telegram' };
  } catch (err) {
    console.error('[Telegram API] Erreur réseau:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Envoie une notification Telegram.
 * Telegram n'a pas de templates comme WhatsApp — on envoie le texte directement.
 *
 * @param {string} chatId     - Chat ID du destinataire
 * @param {string} text       - Corps du message
 * @param {object} [templateInfo] - Ignoré (compat WhatsApp)
 * @returns {{ ok: boolean, messageId?: string, error?: string, method?: string }}
 */
export async function sendNotification(chatId, text, templateInfo) {
  if (!isTelegramConfigured()) {
    return { ok: false, error: 'Bot non configuré', telegramLink: telegramMeLink() };
  }

  const result = await sendTelegram(chatId, text);
  if (result.ok) {
    return { ok: true, messageId: result.messageId, method: 'text' };
  }

  return {
    ok: false,
    error: result.error,
    telegramLink: telegramMeLink(),
    method: 'failed',
  };
}
