// The staff data as a page can show it (dossiers, clients, departures, tasks
// are read together at login; a reconciliation refreshes them on focus and
// every minute). CLAUDE.md §10.9: loading, an empty list and a failure stay
// distinct, and a failed refresh never erases what was already loaded.

const FALLBACK_REASON = 'Connexion aux données interrompue.';

/**
 * Whether staff data are held from an earlier load: dossiers, clients or
 * departures (they are read together, so a successful load leaves at least
 * one of them for any team at work). The shell and every page decide with
 * this same value, so a failure is never reported twice, nor hidden.
 */
export function holdsStaffData({ data = [], clients = [], envois = [] } = {}) {
  return (data?.length || 0) > 0 || (clients?.length || 0) > 0 || (envois?.length || 0) > 0;
}

/**
 * - `failed`: nothing could be read (the first load failed and no data is
 *   held): the page states the reason with « Réessayer » in place of its list,
 *   never a count of 0 nor « nothing to do »;
 * - `stale`: data are held but the latest load or refresh failed: the page
 *   keeps them, the shell's banner gives the reason and « Réessayer »;
 * - `loading`, or `ready`.
 * `reason` is the message to show (the load error, or the interrupted connection).
 */
export function staffDataState({ sbReady = false, dataLoading = false, dataError = '', hasData = false } = {}) {
  if (dataLoading) return { state: 'loading', reason: '' };
  const reason = String(dataError || '').trim() || (sbReady ? '' : FALLBACK_REASON);
  if (!reason) return { state: 'ready', reason: '' };
  return { state: !sbReady && !hasData ? 'failed' : 'stale', reason };
}

// The pages that state a failed first load themselves (reason and « Réessayer »
// in place of their content): the shell's banner steps aside there, so the
// same failure is never shown twice. The new-client form has nothing to put
// in its place: the banner states the failure there.
const OWN_FAILURE = new Set(['/', '/colis', '/departs', '/conversations', '/equipe', '/settings', '/clients']);
const ownFailure = pathname => OWN_FAILURE.has(pathname) || (pathname.startsWith('/clients/') && pathname !== '/clients/new');

/** Whether the shell shows its load banner on this route for this state. */
export function shellLoadBanner(pathname, state) {
  if (state === 'stale') return true;
  return state === 'failed' && !ownFailure(String(pathname || '/'));
}
