// Client display helpers shared by the client pages, the client search and the
// client write mapping (lib/supabaseData.js). Pure functions: no import, so the
// Node tests can load this module directly.

/** A Telegram username as stored: trimmed, without its leading @. */
export function normalizeTelegramUsername(value) {
  return String(value ?? '').trim().replace(/^@+/, '').trim();
}

/** A Telegram username as displayed: « @identifiant », or '' when unknown. */
export function formatTelegramHandle(value) {
  const username = normalizeTelegramUsername(value);
  return username ? `@${username}` : '';
}

/** The way to reach a client shown in lists: email, then phone, then Telegram username. '' when none is known. */
export function clientContactLabel(client) {
  if (!client) return '';
  return String(client.email ?? '').trim() || String(client.tel ?? '').trim() || formatTelegramHandle(client.telegramUsername);
}

/** Every text a client search matches: identity, destination, contact, reference and Telegram username (with and without @). */
export function clientSearchText(client) {
  if (!client) return '';
  const username = normalizeTelegramUsername(client.telegramUsername);
  return [client.nom, client.raisonSociale, client.ville, client.cp, client.tel, client.email, client.type, client.ref, username, username && `@${username}`]
    .filter(Boolean).join(' ');
}

/** « 1 dossier », « 2 dossiers », « 0 dossier » (French: below two is singular). */
export function countLabel(count, singular, plural) {
  const value = Number(count) || 0;
  return `${value} ${Math.abs(value) >= 2 ? plural : singular}`;
}
