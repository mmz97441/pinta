import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/** Atomic, expiring editing presence. updated_at still guards every persisted mutation. */
export function useColisLock(colisId, staffId) {
  const [lockedBy, setLockedBy] = useState(null);
  const [lockError, setLockError] = useState(null);
  useEffect(() => {
    if (!colisId || !staffId) {
      setLockedBy(null);
      return;
    }
    let active = true;
    const acquire = async () => {
      const { data, error } = await supabase.rpc('acquire_colis_lock', { p_colis_id: colisId });
      if (!active) return;
      if (error) {
        setLockError(error.message);
        return;
      }
      const lock = Array.isArray(data) ? data[0] : data;
      setLockError(null);
      setLockedBy(
        lock?.staff_id && lock.staff_id !== staffId ? lock.staff_nom || 'Un collègue' : null,
      );
    };
    acquire();
    const interval = setInterval(acquire, 60000);
    const channel = supabase
      .channel(`lock-${colisId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'colis_locks', filter: `colis_id=eq.${colisId}` },
        (payload) => {
          if (!active) return;
          const lock = payload.new;
          if (lock?.staff_id && lock.staff_id !== staffId)
            setLockedBy(lock.staff_nom || 'Un collègue');
          else setLockedBy(null);
        },
      )
      .subscribe();
    return () => {
      active = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
      supabase.rpc('release_colis_lock', { p_colis_id: colisId }).then(() => {});
    };
  }, [colisId, staffId]);
  return { lockedBy, isLockedByOther: !!lockedBy, lockError };
}
