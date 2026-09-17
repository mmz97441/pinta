import { useCallback, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { draftKey, readDraft, writeDraft, removeDraft } from '../lib/draftStore';

export function usePersistentDraft(scope, initialValue = '') {
  const { auth } = useApp();
  const key = draftKey(auth?.session?.user?.id || auth?.u?.id, scope);
  const initial = useRef(initialValue); initial.current = initialValue;
  const [state, setState] = useState(() => ({ key, value: readDraft(key, initialValue), storageAvailable: true }));
  const value = state.key === key ? state.value : readDraft(key, initialValue);
  const setValue = useCallback(next => {
    // Read by the captured key: an async response for dossier A cannot clear B.
    const previous = readDraft(key, initial.current);
    const result = typeof next === 'function' ? next(previous) : next;
    const storageAvailable = writeDraft(key, result);
    setState({ key, value: result, storageAvailable });
  }, [key]);
  const clear = useCallback(() => {
    removeDraft(key);
    setState({ key, value: initial.current, storageAvailable: true });
  }, [key]);
  return [value, setValue, { clear, storageAvailable: state.storageAvailable }];
}
export default usePersistentDraft;
