import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Hook pour gérer le verrouillage optimiste d'un colis.
 * Quand l'utilisateur ouvre un colis, on enregistre qu'il l'édite.
 * Si quelqu'un d'autre l'édite aussi, on affiche un avertissement.
 *
 * Usage:
 *   const { lockedBy, isLockedByOther } = useColisLock(colisId, myName);
 */
export function useColisLock(colisId, staffId, staffNom) {
  const [lockedBy, setLockedBy] = useState(null);
  const intervalRef = useRef(null);

  // Register my lock
  const registerLock = useCallback(async () => {
    if (!colisId || !staffId) return;
    try {
      await supabase.from('colis_locks').upsert({
        colis_id: colisId,
        staff_id: staffId,
        staff_nom: staffNom || 'Utilisateur',
        locked_at: new Date().toISOString(),
      }, { onConflict: 'colis_id' });
    } catch {}
  }, [colisId, staffId, staffNom]);

  // Release my lock
  const releaseLock = useCallback(async () => {
    if (!colisId || !staffId) return;
    try {
      await supabase.from('colis_locks')
        .delete()
        .eq('colis_id', colisId)
        .eq('staff_id', staffId);
    } catch {}
  }, [colisId, staffId]);

  // Check who has the lock
  const checkLock = useCallback(async () => {
    if (!colisId) return;
    try {
      const { data } = await supabase
        .from('colis_locks')
        .select('staff_id, staff_nom, locked_at')
        .eq('colis_id', colisId)
        .single();

      if (data && data.staff_id !== staffId) {
        // Check if lock is still fresh (< 5 min)
        const lockAge = (Date.now() - new Date(data.locked_at).getTime()) / 1000;
        if (lockAge < 300) {
          setLockedBy(data.staff_nom);
        } else {
          setLockedBy(null);
        }
      } else {
        setLockedBy(null);
      }
    } catch {
      setLockedBy(null);
    }
  }, [colisId, staffId]);

  useEffect(() => {
    if (!colisId || !staffId) return;

    // Check if someone else is editing
    checkLock();

    // Register my lock
    registerLock();

    // Refresh lock every 60 seconds (heartbeat)
    intervalRef.current = setInterval(() => {
      registerLock();
      checkLock();
    }, 60000);

    // Listen to Realtime changes on colis_locks
    const channel = supabase
      .channel(`lock-${colisId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'colis_locks',
        filter: `colis_id=eq.${colisId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const lock = payload.new;
          if (lock.staff_id !== staffId) {
            setLockedBy(lock.staff_nom);
          }
        } else if (payload.eventType === 'DELETE') {
          setLockedBy(null);
        }
      })
      .subscribe();

    return () => {
      clearInterval(intervalRef.current);
      releaseLock();
      supabase.removeChannel(channel);
    };
  }, [colisId, staffId]);

  return {
    lockedBy,
    isLockedByOther: !!lockedBy,
  };
}
