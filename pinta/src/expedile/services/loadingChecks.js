// Loading control of a departure (supabase/migrations/20261007000004_departure_loading_checks.sql): each
// outgoing parcel's label scanned (handheld scanner or tablet camera), or a dossier's parcels counted by hand,
// stored on the server for every device with who and when. confirm_departure accepts a dossier only when all
// its parcels are checked. The server is authoritative: its refusals carry a French sentence, shown as it is,
// and a HINT « loading_check:<reason> » that tells the screen what happened.
import { supabase } from '../lib/supabase';

/** How a parcel was checked: its label scanned, read by the camera, or the dossier's parcels counted by hand. */
export const LOADING_CHECK_METHODS = Object.freeze(['scan', 'camera', 'count']);

/**
 * The reasons a command refuses (HINT loading_check:<reason>). `refresh`: the screen's own data are out of
 * date (another device, a new preparation, the departure confirmed meanwhile) and should be read again.
 */
export const LOADING_CHECK_REASONS = Object.freeze({
  permission: { refresh: false },
  invalid_method: { refresh: false },
  invalid_label: { refresh: false },
  invalid_count: { refresh: false },
  departure_not_found: { refresh: true },
  departure_closed: { refresh: true },
  dossier_not_found: { refresh: true },
  not_assigned: { refresh: true },
  dossier_closed: { refresh: true },
  not_prepared: { refresh: true },
  stale_label: { refresh: true },
  count_mismatch: { refresh: false },
  incomplete: { refresh: false },
});

// Failures without a server sentence of the loading control, by operation.
const FALLBACK = {
  write: {
    permission: 'Accès refusé : reconnectez-vous, ou demandez à la direction la permission d’expédier les colis.',
    network: 'Connexion impossible : ce contrôle n’est pas confirmé. Vérifiez le réseau puis recommencez ; un colis déjà contrôlé n’est jamais compté deux fois.',
    conflict: 'Le chargement a changé sur un autre appareil. Actualisez-le puis recommencez.',
    unknown: 'Le contrôle n’a pas pu être enregistré. Réessayez.',
  },
  clear: {
    permission: 'Accès refusé : reconnectez-vous, ou demandez à la direction la permission d’expédier les colis.',
    network: 'Connexion impossible : l’effacement n’est pas confirmé. Vérifiez le réseau puis actualisez le chargement.',
    conflict: 'Le chargement a changé sur un autre appareil. Actualisez-le puis recommencez.',
    unknown: 'Les contrôles n’ont pas pu être effacés. Réessayez.',
  },
  read: {
    permission: 'Accès refusé : reconnectez-vous, ou demandez à la direction l’accès aux départs.',
    network: 'Connexion impossible : le contrôle du chargement n’a pas pu être lu. Vérifiez le réseau puis réessayez.',
    conflict: 'Le chargement a changé. Actualisez-le.',
    unknown: 'Le contrôle du chargement n’a pas pu être lu. Réessayez.',
  },
};
const UNAVAILABLE = 'Le contrôle du chargement n’est pas encore disponible sur le serveur. Prévenez la direction.';

const HINT = /^loading_check:([a-z_]+)$/;

function parseDetails(details) {
  if (!details || typeof details !== 'string') return null;
  try {
    const value = JSON.parse(details);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
      colisId: value.colis_id ?? null, ref: value.ref ?? null,
      checked: value.checked == null ? null : Number(value.checked), expected: value.expected == null ? null : Number(value.expected),
    };
  } catch {
    return null;
  }
}

/**
 * Explains a refusal of the loading control (or of the departure confirmation) for the screen:
 * { reason, message, refresh, code, details }. A sentence of the loading control (any HINT
 * loading_check:<reason>) is shown as it is; any other failure gets a French sentence for the operation
 * ('write' a check or a count, 'clear', 'read'). `details` ({ colisId, ref, checked, expected }) comes with
 * « Contrôle incomplet ».
 */
export function loadingCheckError(error, operation = 'write') {
  const texts = FALLBACK[operation] || FALLBACK.write;
  const code = typeof error?.code === 'string' ? error.code : '';
  const hint = HINT.exec(String(error?.hint ?? ''));
  const serverMessage = typeof error?.message === 'string' ? error.message.trim() : '';
  if (hint && serverMessage) {
    const reason = hint[1];
    return { reason, message: serverMessage, refresh: LOADING_CHECK_REASONS[reason]?.refresh ?? true, code, details: parseDetails(error.details) };
  }
  // The function is unknown to the API (release not applied yet): PostgREST answers PGRST202.
  if (code === 'PGRST202' || code === '42883') return { reason: 'unavailable', message: UNAVAILABLE, refresh: false, code, details: null };
  if (code === '42501') return { reason: 'permission', message: texts.permission, refresh: false, code, details: null };
  if (code === '40001') return { reason: 'conflict', message: texts.conflict, refresh: true, code, details: null };
  // A request that never got an answer has no SQLSTATE (supabase-js reports the failed fetch).
  if (!code) return { reason: 'network', message: texts.network, refresh: false, code, details: null };
  return { reason: 'unknown', message: texts.unknown, refresh: false, code, details: null };
}

/** The same explanation as an Error to throw: message, plus reason, refresh, code, details and the original cause. */
export function loadingCheckFailure(error, operation = 'write') {
  const explained = loadingCheckError(error, operation);
  return Object.assign(new Error(explained.message), explained, { cause: error });
}

/** One check, as the commands and get_loading_checks return it. */
export function mapLoadingCheck(row) {
  if (!row) return null;
  return {
    colisId: row.colis_id, parcelIndex: Number(row.parcel_index), parcelCount: Number(row.parcel_count),
    method: row.method, checkedBy: row.checked_by ?? null, checkedByName: row.checked_by_name || '', checkedAt: row.checked_at,
  };
}

const counts = (data) => ({ status: data?.status, checked: Number(data?.checked ?? 0), expected: data?.expected == null ? null : Number(data.expected) });

/**
 * One scanned label (« EXP-2YE537-1-2 » read by domain/parcelCode.js) of a dossier on the departure.
 * Resolves { status: 'recorded' | 'already', checked, expected, check }: a label scanned again keeps its
 * first check (who, when, method).
 */
export async function recordLoadingCheck(envoiId, colisId, parcelIndex, parcelCount, method) {
  const { data, error } = await supabase.rpc('record_loading_check', {
    p_envoi_id: envoiId, p_colis_id: colisId, p_parcel_index: parcelIndex, p_parcel_count: parcelCount, p_method: method,
  });
  if (error) throw loadingCheckFailure(error, 'write');
  return { ...counts(data), check: mapLoadingCheck(data?.check) };
}

/**
 * The dossier's parcels counted by hand: accepted only when the count matches. Resolves
 * { status: 'recorded' | 'already', checked, expected, added }.
 */
export async function recordLoadingCount(envoiId, colisId, counted) {
  const { data, error } = await supabase.rpc('record_loading_count', { p_envoi_id: envoiId, p_colis_id: colisId, p_counted: counted });
  if (error) throw loadingCheckFailure(error, 'write');
  return { ...counts(data), added: Number(data?.added ?? 0) };
}

/** Redo a dossier's control on this departure. Resolves { status: 'cleared' | 'none', cleared, checked, expected }. */
export async function clearLoadingChecks(envoiId, colisId) {
  const { data, error } = await supabase.rpc('clear_loading_checks', { p_envoi_id: envoiId, p_colis_id: colisId });
  if (error) throw loadingCheckFailure(error, 'clear');
  return { ...counts(data), cleared: Number(data?.cleared ?? 0) };
}

/** The checks of the dossiers currently on the departure, shared by every device, by dossier then parcel. */
export async function fetchLoadingChecks(envoiId) {
  const { data, error } = await supabase.rpc('get_loading_checks', { p_envoi_id: envoiId });
  if (error) throw loadingCheckFailure(error, 'read');
  return (Array.isArray(data) ? data : []).map(mapLoadingCheck);
}
