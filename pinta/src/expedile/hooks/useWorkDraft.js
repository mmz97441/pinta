import { useCallback, useLayoutEffect } from 'react';
import { registerWorkDraft } from '../domain/workDrafts';

/** Register committed editor state before the next user action. No unmount
 * cleanup: navigating to a work list does not save or discard its local draft.
 * The returned clear is bound to this identity, including after an async save. */
export function useWorkDraft({ userId, dossierId, kind, source, dirty, label }) {
  useLayoutEffect(() => {
    registerWorkDraft(userId, dossierId, kind, source, dirty, label);
  }, [userId, dossierId, kind, source, dirty, label]);
  return useCallback(() => registerWorkDraft(userId, dossierId, kind, source, false), [userId, dossierId, kind, source]);
}

export default useWorkDraft;
