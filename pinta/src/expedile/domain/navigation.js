// The way back to a workspace list: the Colis home (/), Dossiers (/colis), Conversations, Équipe, Mon travail
// (/travail), a Brouillon sheet (/brouillon/<id>), the reception (/recevoir) and the arrival notices (/avis), each with
// or without its parameters. Nothing else: no other page, no external address, no « // », no backslash.
const RETURN_PATH = /^\/(?:colis|conversations|equipe|travail|recevoir|avis|brouillon\/[A-Za-z0-9_-]+)?(?:\?|$)/;

export function workspaceReturnPath(search, fallback = '/colis') {
  const value = new URLSearchParams(search).get('returnTo');
  if (!value || !RETURN_PATH.test(value)) return fallback;
  return value;
}
