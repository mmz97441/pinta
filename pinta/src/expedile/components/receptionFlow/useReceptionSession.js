import { useCallback, useMemo } from 'react';
import { usePersistentDraft } from '../../hooks/usePersistentDraft';
import { EMPTY_CARTON } from './receptionFlowModel';

// The reception of one client, kept in this browser tab (sessionStorage, by account and client): a tablet switched
// off or a page reloaded loses neither the carton being typed, nor a save whose answer was lost (`intent`, replayed
// as it is), nor the validation being sent (`validation`, same request identifier), nor the result shown at the end.
//
// - target: { mode: 'append', dossierId } once a carton of this reception is saved (or chosen from a dossier);
// - form: the carton being typed; intent: the carton save to check (lost answer);
// - saved: the cartons saved during this reception [{ colisId, ref, number }]; lastSaved: the last of them;
// - consent: by dossier, what the first addition changed for the client's consent (consentRenewal);
// - validation: { args } of validateReception while its answer is unknown; done: what the rangement shows.
const VERSION = 1;
export const FRESH_SESSION = Object.freeze({ v: VERSION, target: null, form: EMPTY_CARTON, intent: null, saved: [], lastSaved: null, consent: {}, validation: null, done: null });

const sessionOf = value => value && value.v === VERSION ? { ...FRESH_SESSION, ...value, form: { ...EMPTY_CARTON, ...(value.form || {}) } } : FRESH_SESSION;

export function useReceptionSession(clientId) {
  const [value, setValue, store] = usePersistentDraft(clientId ? `reception-flow:client:${clientId}` : null, null);
  const session = useMemo(() => sessionOf(value), [value]);
  // Read and written by the captured key: an answer arriving after the operator moved on still lands on its client.
  const update = useCallback(changes => setValue(previous => {
    const base = sessionOf(previous);
    return { ...base, ...(typeof changes === 'function' ? changes(base) : changes), v: VERSION };
  }), [setValue]);
  return { session, update, clear: store.clear, storageAvailable: store.storageAvailable };
}

// The search of the first step and the new client being typed.
export const EMPTY_NEW_CLIENT = Object.freeze({ type: 'particulier', raisonSociale: '', nom: '', prenom: '', tel: '', telFixe: '', email: '', adresseLigne1: '', cp: '', ville: '' });
const START_VERSION = 1;
const startOf = value => value && value.v === START_VERSION ? { q: '', creating: false, ...value, newClient: { ...EMPTY_NEW_CLIENT, ...(value.newClient || {}) } } : { v: START_VERSION, q: '', creating: false, newClient: EMPTY_NEW_CLIENT };

export function useReceptionStart() {
  const [value, setValue, store] = usePersistentDraft('reception-flow:start', null);
  const start = useMemo(() => startOf(value), [value]);
  const update = useCallback(changes => setValue(previous => {
    const base = startOf(previous);
    return { ...base, ...(typeof changes === 'function' ? changes(base) : changes), v: START_VERSION };
  }), [setValue]);
  return { start, update, clear: store.clear };
}
