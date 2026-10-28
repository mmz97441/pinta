import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchArrivalNotices, fetchPendingReceptions, fetchReceptionPhotos } from '../../lib/receptionValidation';

// The receptions waiting for their validation and the arrival notices, as the server lists them
// (lib/receptionValidation.js), for « Colis » and the Brouillon sheet. Read at mount, when the window comes
// back, every minute while the page is visible and after a change of the loaded dossiers (`data`): one read at
// a time, at most one every five seconds (« Réessayer » excepted), so a burst of updates never becomes a burst
// of requests. A failed read keeps the last answer and gives its reason: the list stays readable under it.
const EVERY_MINUTE = 60000;
const MIN_GAP = 5000;
const AFTER_DATA = 1500;
const AFTER_FOCUS = 250;
const reasonOf = error => String(error?.message || error || '').trim().replace(/[.\s]+$/, '') || 'lecture impossible';
const EMPTY = { pending: null, notices: null, photos: null, pendingError: '', noticesError: '', photosError: '', loading: true };

/**
 * `{ pending, notices, photos, pendingError, noticesError, photosError, loading, retry }`: `pending`
 * (fetchPendingReceptions, of `clientId` or everyone), `notices` (fetchArrivalNotices of `colisId`, or the latest
 * `limit`) and, with `photos: true`, the reception photos of `colisId` (fetchReceptionPhotos) are null until their
 * first successful read. `enabled: false` reads nothing (a sheet whose dossier is not known yet).
 */
export default function useReceptionSignals({ clientId = null, colisId = null, limit = 50, photos = false, enabled = true, data } = {}) {
  const [state, setState] = useState(EMPTY);
  const params = useRef({ clientId, colisId, limit, photos, enabled });
  params.current = { clientId, colisId, limit, photos, enabled };
  const control = useRef({ alive: false, running: false, again: false, timer: 0, lastStart: 0, generation: 0 });
  const runRef = useRef(null);

  const schedule = useCallback((delay = 0, { immediate = false } = {}) => {
    const c = control.current;
    if (!c.alive) return;
    clearTimeout(c.timer);
    const wait = immediate ? 0 : Math.max(delay, c.lastStart + MIN_GAP - Date.now(), 0);
    c.timer = setTimeout(() => runRef.current?.(), wait);
  }, []);

  runRef.current = async () => {
    const c = control.current;
    const current = params.current;
    if (!c.alive || !current.enabled) return;
    if (c.running) { c.again = true; return; }
    c.running = true; c.again = false; c.lastStart = Date.now();
    const generation = c.generation;
    setState(previous => previous.loading ? previous : { ...previous, loading: true });
    const [pending, notices, pictures] = await Promise.allSettled([
      fetchPendingReceptions({ clientId: current.clientId }),
      fetchArrivalNotices({ colisId: current.colisId, limit: current.limit }),
      current.photos && current.colisId ? fetchReceptionPhotos(current.colisId) : Promise.resolve(null),
    ]);
    c.running = false;
    if (!c.alive) return;
    if (generation === c.generation) setState(previous => ({
      pending: pending.status === 'fulfilled' ? pending.value : previous.pending,
      notices: notices.status === 'fulfilled' ? notices.value : previous.notices,
      photos: pictures.status === 'fulfilled' ? pictures.value : previous.photos,
      pendingError: pending.status === 'rejected' ? reasonOf(pending.reason) : '',
      noticesError: notices.status === 'rejected' ? reasonOf(notices.reason) : '',
      photosError: pictures.status === 'rejected' ? reasonOf(pictures.reason) : '',
      loading: false,
    }));
    // A read asked meanwhile, or for other parameters, follows at once.
    if (c.again || generation !== c.generation) { c.again = false; schedule(0, { immediate: true }); }
  };

  // Mount, or other parameters (another dossier): what was read for the former ones is not shown.
  useEffect(() => {
    const c = control.current;
    c.alive = true;
    c.generation += 1;
    setState(EMPTY);
    schedule(0, { immediate: true });
    return () => { clearTimeout(c.timer); };
  }, [clientId, colisId, limit, photos, enabled, schedule]);
  useEffect(() => () => { control.current.alive = false; clearTimeout(control.current.timer); }, []);

  // The window comes back, or every minute while it is visible.
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') schedule(AFTER_FOCUS); };
    const tick = () => { if (document.visibilityState === 'visible') schedule(0); };
    window.addEventListener('focus', back);
    window.addEventListener('online', back);
    document.addEventListener('visibilitychange', back);
    const interval = setInterval(tick, EVERY_MINUTE);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', back);
      window.removeEventListener('online', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [schedule]);

  // The loaded dossiers changed (a carton recorded, a colleague's update): read again once things settle.
  const firstData = useRef(true);
  useEffect(() => {
    if (firstData.current) { firstData.current = false; return; }
    schedule(AFTER_DATA);
  }, [data, schedule]);

  const retry = useCallback(() => schedule(0, { immediate: true }), [schedule]);
  return { ...state, retry };
}
