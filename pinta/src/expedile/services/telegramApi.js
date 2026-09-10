import { supabase } from '../lib/supabase';
import { functionErrorMessage } from './functionErrors';

const BOT_USERNAME = 'Expedilebot';
export function isTelegramConfigured() {
  return !!supabase;
}
export function normalizeTel(tel = '') {
  let value = tel.replace(/[^0-9+]/g, '').replace(/^\+/, '');
  if (/^0(?:262|692|693)/.test(value)) return '262' + value.slice(1);
  if (/^0[67]/.test(value)) return '33' + value.slice(1);
  return value;
}
export function telegramMeLink(token) {
  return `https://t.me/${BOT_USERNAME}${token ? '?start=' + encodeURIComponent(token) : ''}`;
}
// Invitations must come from create_telegram_invitation, never a raw client id.
export function telegramLink() {
  return telegramMeLink();
}
export async function createTelegramInvitation(clientId) {
  const { data, error } = await supabase.rpc('create_telegram_invitation', {
    p_client_id: clientId,
  });
  if (error) throw error;
  return data;
}
async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('send-telegram', { body });
  if (error) return { ok: false, error: await functionErrorMessage({ data, error }, 'Telegram n’a pas confirmé l’envoi. Le message reste disponible dans le dossier.') };
  return data || { ok: false, error: 'Réponse Telegram vide' };
}
export async function deliverMessage(colisId, messageId, options = {}) {
  if (!colisId || !messageId) return { ok: false, error: 'Message enregistré et dossier requis' };
  return invoke({ colisId, messageId, ...options });
}
export async function sendTelegram(chatId, text, options = {}) {
  if (!chatId) return { ok: false, error: 'Ce client n’a pas relié Telegram.' };
  return invoke({ chatId: String(chatId), text, ...options });
}
export function sendTelegramReply(chatId, text, replyToMessageId, options = {}) {
  return sendTelegram(chatId, text, {
    ...options,
    replyToId: replyToMessageId ? Number(replyToMessageId) : undefined,
  });
}
export function sendTelegramWithButtons(chatId, text, buttons, options = {}) {
  return sendTelegram(chatId, text, { ...options, replyMarkup: { inline_keyboard: buttons } });
}
export const sendNotification = sendTelegram;
