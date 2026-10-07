import { WORK_KINDS, WORK_STATES, actionPriority, workDate } from './personalWork.js';
import { receptionCartonManifest } from './reception.js';
import { plural } from './plural.js';

/** Mon travail lists tasks, not dossiers: two tasks may share one reference and
 * the server priority keeps the order. The task title identifies a row and the
 * commands are always shown; the other columns are a reading choice. */
export const WORK_TABLE_COLUMNS = Object.freeze([
  Object.freeze({ key: 'task', label: 'Tâche' }),
  Object.freeze({ key: 'due', label: 'Échéance' }),
  Object.freeze({ key: 'ref', label: 'Dossier' }),
  Object.freeze({ key: 'client', label: 'Client' }),
  Object.freeze({ key: 'casier', label: 'Casier' }),
  Object.freeze({ key: 'cartons', label: 'Cartons', align: 'right' }),
  Object.freeze({ key: 'action', label: 'Action', fixed: true }),
]);
/** The columns offered in « Colonnes »: « Action » is not a choice. */
export const WORK_TABLE_CHOICES = Object.freeze(WORK_TABLE_COLUMNS.filter(column => !column.fixed));

export function visibleWorkColumns(visibleKeys = []) {
  return WORK_TABLE_COLUMNS.filter(column => column.fixed || column.key === 'task' || visibleKeys.includes(column.key));
}

/** « Automatique » gives the table from 1280px, where its default columns fit beside the
 * sidebar, and cards below; a forced choice wins. */
export function resolveWorkLayout(preference, wide) {
  return preference === 'table' || preference === 'cards' ? preference : wide ? 'table' : 'cards';
}

export function cartonCount(count) {
  return plural(count, 'carton');
}

// « À faire » is the section itself: only a different state earns a pill.
const STATE_PILLS = { in_progress: { label: WORK_STATES.in_progress, tone: 'current' }, waiting: { label: WORK_STATES.waiting, tone: 'waiting' } };
const clientName = client => (client?.nomFamille ? [client.prenom, client.nomFamille].filter(Boolean).join(' ') : client?.nom) || 'Client';

/** The deadline keeps the priority wording. The table column is already named
 * « Échéance », so its cell (`text`) drops that word; a card keeps it (`label`).
 * `status` and `date` are the two halves of `text`, each kept whole on its line. */
function workDue(priority, date) {
  if (!priority.urgent && !date) return null;
  if (priority.rank === 400) return { text: `Dépassée · ${date}`, label: `${priority.reason} · ${date}`, status: 'Dépassée', date, urgent: true };
  if (!priority.urgent) return { text: `Prévue · ${date}`, label: `Échéance prévue · ${date}`, status: 'Prévue', date, urgent: false };
  const text = date ? `${priority.reason} · ${date}` : priority.reason;
  return { text, label: text, status: priority.reason, date: date || null, urgent: true };
}

/** One task as the table row and the card show it. A row assigned to the
 * current person does not name them again; a colleague stays named. The
 * waiting line is introduced by « En attente » only when no « En attente »
 * pill already says it: beside the pill it gives the reason. */
export function workRowModel(action, dossier, client, { now = Date.now(), meId } = {}) {
  const priority = actionPriority(action, now);
  const waiting = action.blocked_reason || action.waiting_reason;
  const review = workDate(action.review_at, { now });
  const state = STATE_PILLS[action.state] || null;
  return {
    title: action.action_hint || WORK_KINDS[action.kind]?.label || 'Action à préciser',
    state,
    urgent: priority.urgent,
    due: workDue(priority, workDate(action.due_at, { now })),
    ref: dossier?.ref || 'Dossier à consulter',
    client: clientName(client),
    casier: dossier?.casier || null,
    cartons: dossier ? receptionCartonManifest(dossier).nbColis : null,
    assigneeId: action.assignee_id && action.assignee_id !== meId ? action.assignee_id : null,
    waiting: waiting ? `${waiting}${review ? ` · À revoir le ${review}` : ''}` : null,
    waitingLabel: state?.label === WORK_STATES.waiting ? 'Raison' : WORK_STATES.waiting,
    handoff: action.handoff_to ? { to: action.handoff_to, note: action.handoff_note || '' } : null,
    note: !action.handoff_to && action.handoff_note ? action.handoff_note : null,
  };
}
