export function workspaceReturnPath(search, fallback = '/colis') {
  const value = new URLSearchParams(search).get('returnTo');
  if (!value || !/^\/(?:colis|conversations|equipe|travail)?(?:\?|$)/.test(value)) return fallback;
  return value;
}
