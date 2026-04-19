import { useState, useEffect, useCallback } from 'react';
import * as sb from '../lib/supabaseData';

/**
 * Hook pour charger et vérifier les permissions de l'utilisateur connecté.
 * Usage: const { can, perms, loading } = usePermissions(authUserId);
 * can('perm_colis_receptionner') → true/false
 */
export function usePermissions(authId, authRole) {
  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authId) { setPerms(null); setLoading(false); return; }

    sb.fetchStaffUsers().then((users) => {
      const me = users.find((u) => u.authId === authId || u.id === authId);
      if (me?.permissions) {
        setPerms(me.permissions);
      } else {
        setPerms(null);
      }
      setLoading(false);
    }).catch(() => {
      setPerms(null);
      setLoading(false);
    });
  }, [authId]);

  const can = useCallback((permKey) => {
    // Directeur/vice-directeur = full access even without explicit permissions
    if (authRole === 'directeur' || authRole === 'vice_directeur') return true;
    if (!perms) return false;
    return perms[permKey] === true;
  }, [perms, authRole]);

  return { can, perms, loading, setPerms };
}
