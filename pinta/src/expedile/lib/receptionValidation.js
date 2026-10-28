// ══════════════════════════════════════════════════════════════════════
// Validated reception and grouped arrival notice (migration 20261028000001_reception_validation.sql)
// ══════════════════════════════════════════════════════════════════════
// The team records each carton as soon as it is entered, then validates the reception of a client at once; with a
// notice, the server queues ONE message (Telegram, else e-mail) for all the cartons of that reception. The server
// decides and checks everything (permissions, channel, pending cartons): these functions only shape the calls and
// their answers. Errors follow lib/supabaseData.js: a server refusal is thrown as it is (code 42501, 22023 or 40001
// and its French message); an argument the server would refuse is refused here with code 22023, without any call.
import { supabase } from './supabase';
import { randomId } from './randomId';

export const ARRIVAL_CHANNELS = ['telegram', 'email'];
export const ARRIVAL_TEMPLATES = ['arrivee_colis', 'arrivee_colis_facture'];
export const MAX_VALIDATION_DOSSIERS = 20;
export const MAX_NOTICE_LENGTH = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalid = (message) => Object.assign(new Error(message), { code: '22023' });
const trimmed = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const number = (value) => {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const integer = (value) => {
  const parsed = number(value);
  return Number.isInteger(parsed) ? parsed : null;
};
// ISO dates stay strings as the server wrote them (formatting belongs to the screens); anything else is unknown. A
// pattern rather than Date.parse: PostgreSQL's microseconds are not read alike by every browser of the build target.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/;
const isoDate = (value) => (typeof value === 'string' && ISO_DATE.test(value) ? value : null);

// ── Pure normalisation (exported for the screens and the tests) ─────

/** One received carton: number in its dossier, tracking number, vendor, measures at reception, stamped arrival. */
export function normalizeReceptionCarton(raw) {
  const carton = raw && typeof raw === 'object' ? raw : {};
  return {
    carton: integer(carton.carton),
    number: trimmed(carton.number),
    fournisseur: trimmed(carton.fournisseur),
    dimL: number(carton.dimL),
    dimW: number(carton.dimW),
    dimH: number(carton.dimH),
    poids: number(carton.poids),
    receivedAt: isoDate(carton.receivedAt),
  };
}

/** A carton of a validation snapshot: the carton and the dossier it belongs to. */
export function normalizeValidatedCarton(raw) {
  return { colisId: raw?.colisId || null, ref: raw?.ref || '', ...normalizeReceptionCarton(raw) };
}

/** A dossier of a validation and the range of cartons it validated. */
export function normalizeValidationItem(raw) {
  return { colisId: raw?.colisId || null, ref: raw?.ref || '', firstCarton: integer(raw?.firstCarton), lastCarton: integer(raw?.lastCarton) };
}

/** list_pending_receptions → one entry per dossier with cartons waiting for validation (the longest waiting first).
 *  cartonCount is the number of pending cartons (cartons.length), not the size of the dossier. */
export function normalizePendingReceptions(data) {
  if (!Array.isArray(data)) throw new Error('La liste des réceptions à valider n’a pas pu être lue. Actualisez la page.');
  return data.map((row) => ({
    colisId: row?.colisId || null,
    ref: row?.ref || '',
    clientId: row?.clientId || null,
    statut: row?.statut || null,
    casier: trimmed(row?.casier),
    firstCarton: integer(row?.firstCarton),
    lastCarton: integer(row?.lastCarton),
    cartonCount: integer(row?.cartonCount) ?? 0,
    receivedFrom: isoDate(row?.receivedFrom),
    receivedTo: isoDate(row?.receivedTo),
    cartons: Array.isArray(row?.cartons) ? row.cartons.map(normalizeReceptionCarton) : [],
  }));
}

/** The message of a notice: a messages row (validate_reception) or its summary (list_arrival_notices). */
export function normalizeNoticeMessage(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  return {
    id: raw.id,
    colisId: raw.colis_id ?? raw.colisId ?? null,
    statut: raw.statut ?? null,
    canal: raw.canal ?? null,
    template: raw.template ?? null,
    texte: typeof raw.texte === 'string' ? raw.texte : '',
    createdAt: raw.created_at ?? raw.createdAt ?? null,
  };
}

/** The delivery of a notice: a notification_outbox row (validate_reception) or its summary (list_arrival_notices).
 *  status: pending, blocked or sending (on its way), sent (confirmed), failed or cancelled (with lastError), manual
 *  (an e-mail to send by hand until an e-mail provider is connected). */
export function normalizeNoticeOutbox(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  return {
    id: raw.id,
    messageId: raw.message_id ?? raw.messageId ?? null,
    colisId: raw.colis_id ?? raw.colisId ?? null,
    canal: raw.canal ?? null,
    status: raw.status ?? null,
    attempts: integer(raw.attempts) ?? 0,
    sentAt: raw.sent_at ?? raw.sentAt ?? null,
    lastError: raw.last_error ?? raw.lastError ?? null,
    idempotencyKey: raw.idempotency_key ?? raw.idempotencyKey ?? null,
  };
}

/** validate_reception → { validation, message, outbox, reused }. message and outbox are null without notice. */
export function normalizeValidationResult(data) {
  const validation = data?.validation;
  if (!validation?.id) throw new Error('La validation de la réception n’a pas été confirmée. Actualisez la liste avant de recommencer.');
  return {
    validation: {
      id: validation.id,
      requestId: validation.requestId || null,
      clientId: validation.clientId || null,
      notify: validation.notify === true,
      canal: validation.canal || null,
      template: validation.template || null,
      createdAt: validation.createdAt || null,
      items: Array.isArray(validation.items) ? validation.items.map(normalizeValidationItem) : [],
      cartons: Array.isArray(validation.cartons) ? validation.cartons.map(normalizeValidatedCarton) : [],
    },
    message: normalizeNoticeMessage(data.message),
    outbox: normalizeNoticeOutbox(data.outbox),
    reused: data.reused === true,
  };
}

/** list_arrival_notices → the validations, with or without notice, most recent first. */
export function normalizeArrivalNotices(data) {
  if (!Array.isArray(data)) throw new Error('Les avis d’arrivée n’ont pas pu être lus. Actualisez la page.');
  return data.map((row) => ({
    id: row?.id || null,
    createdAt: row?.createdAt || null,
    clientId: row?.clientId || null,
    client: { nom: row?.client?.nom || '', prenom: row?.client?.prenom || null },
    actor: { nom: row?.actor?.nom || null },
    notify: row?.notify === true,
    canal: row?.canal || null,
    template: row?.template || null,
    items: Array.isArray(row?.items) ? row.items.map(normalizeValidationItem) : [],
    cartons: Array.isArray(row?.cartons) ? row.cartons.map(normalizeValidatedCarton) : [],
    message: normalizeNoticeMessage(row?.message),
    outbox: normalizeNoticeOutbox(row?.outbox),
  }));
}

/** The items of a validation, as the server accepts them: 1 to 20 distinct dossiers, each with the number of the
 *  last carton to validate (its pending cartons up to that one are validated). */
export function validationItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_VALIDATION_DOSSIERS) throw invalid('Validez de 1 à 20 dossiers à la fois.');
  const seen = new Set();
  return items.map((item) => {
    const colisId = typeof item?.colisId === 'string' ? item.colisId.trim() : '';
    const throughCarton = item?.throughCarton;
    if (!UUID.test(colisId) || !Number.isInteger(throughCarton) || throughCarton < 1)
      throw invalid('Chaque dossier indique son identifiant et le numéro du dernier carton à valider.');
    if (seen.has(colisId.toLowerCase())) throw invalid('Un dossier ne figure qu’une fois dans une validation.');
    seen.add(colisId.toLowerCase());
    return { colisId, throughCarton };
  });
}

/** Every pending carton of the listed dossiers (the usual « Valider la réception »), in the order of the list. */
export function pendingValidationItems(pending) {
  return (pending || []).filter((row) => row?.colisId && Number.isInteger(row.lastCarton))
    .map((row) => ({ colisId: row.colisId, throughCarton: row.lastCarton }));
}

/** The cartons a validation of `items` records and its notice announces, exactly as the server snapshots them: the
 *  pending cartons of each dossier up to throughCarton, in the order of the items, then by carton number. */
export function receptionCartonsFor(pending, items) {
  const byDossier = new Map((pending || []).map((row) => [String(row?.colisId || '').toLowerCase(), row]));
  return validationItems(items).flatMap(({ colisId, throughCarton }) => {
    const row = byDossier.get(colisId.toLowerCase());
    if (!row) return [];
    return (row.cartons || []).filter((carton) => Number.isInteger(carton.carton) && carton.carton <= throughCarton)
      .sort((a, b) => a.carton - b.carton)
      .map((carton) => ({ colisId: row.colisId, ref: row.ref, ...carton }));
  });
}

/** The arguments of validate_reception. Without notice, channel, template and text are not sent (the server refuses
 *  them). With a notice, the channel is the one the screen computed with the server's rule (Telegram when linked, else
 *  the e-mail): a different decision on the server means the contact changed (40001, reload). */
export function validationRequest({ clientId, items, notify, canal = null, template = null, text: body = null, requestId = null } = {}) {
  if (typeof clientId !== 'string' || !UUID.test(clientId)) throw invalid('Choisissez le client de la réception.');
  if (typeof notify !== 'boolean') throw invalid('Indiquez si le client doit être prévenu.');
  if (requestId != null && (typeof requestId !== 'string' || !UUID.test(requestId))) throw invalid('Identifiant de validation invalide.');
  const args = {
    p_client_id: clientId, p_items: validationItems(items), p_notify: notify,
    p_canal: null, p_template: null, p_text: null, p_request_id: requestId || randomId(),
  };
  if (!notify) return args;
  if (!ARRIVAL_CHANNELS.includes(canal)) throw invalid('Précisez le canal de l’avis d’arrivée : telegram ou email.');
  if (!ARRIVAL_TEMPLATES.includes(template)) throw invalid('Choisissez le modèle de l’avis d’arrivée : arrivee_colis ou arrivee_colis_facture.');
  // Counted in characters, as the server counts them (an emoji is one).
  if (typeof body !== 'string' || !body.trim() || Array.from(body).length > MAX_NOTICE_LENGTH)
    throw invalid('Le texte de l’avis d’arrivée doit contenir de 1 à 4096 caractères.');
  return { ...args, p_canal: canal, p_template: template, p_text: body };
}

// ── Server calls ────────────────────────────────────────────────────

/** The receptions to validate, of one client or of everyone. Team only (42501 otherwise). */
export async function fetchPendingReceptions({ clientId = null } = {}) {
  const { data, error } = await supabase.rpc('list_pending_receptions', { p_client_id: clientId || null });
  if (error) throw error;
  return normalizePendingReceptions(data);
}

/** Validates a reception and, with `notify`, queues its notice. Keep the same `requestId` (randomId(), created once for
 *  the validation) when retrying after a lost response: the server then returns the recorded validation (reused: true)
 *  and sends nothing more; the same identifier with another content is refused (40001). A Telegram notice is pending:
 *  send it with deliverMessage(message.colisId, message.id), otherwise the scheduled worker sends it; an e-mail notice
 *  stays manual (text ready to copy). */
export async function validateReception({ clientId, items, notify, canal, template, text, requestId } = {}) {
  const args = validationRequest({ clientId, items, notify, canal, template, text, requestId });
  const { data, error } = await supabase.rpc('validate_reception', args);
  if (error) throw error;
  return normalizeValidationResult(data);
}

/** The arrival notices (validations with or without notice) of a client and/or a dossier, most recent first. */
export async function fetchArrivalNotices({ clientId = null, colisId = null, limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw invalid('Demandez de 1 à 200 avis d’arrivée.');
  const { data, error } = await supabase.rpc('list_arrival_notices', { p_client_id: clientId || null, p_colis_id: colisId || null, p_limit: limit });
  if (error) throw error;
  return normalizeArrivalNotices(data);
}
