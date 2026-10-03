import { DESTINATIONS, STATUTS, getSecteurByCP } from '../constants/index.js';
import { DOSSIER_TASKS, dossierNextTask } from './dossierTasks.js';
import { hasCurrentPreparation } from './preparationReadiness.js';
import { departureReadiness } from './departureReadiness.js';
import { actionPriority, actionWaiting, canWorkAction, sortWorkActions } from './personalWork.js';
import { workTitle, workSituation } from './collaborativeWork.js';
import { receptionCartonManifest, receptionDateSummary } from './reception.js';

const SORT_TYPES = new Set(['text', 'number', 'date']);
const naturalTextOrder = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/** A data column must declare its real value and its type once. Adding a column
 * then enables headers, keyboard sorting and the mobile sorting menu together.
 * Command columns explicitly opt out: their buttons do not represent data. */
export function defineDossierTableColumn(column) {
  if (!column?.key || !column.label) throw new Error('Une colonne doit avoir une clé et un titre.');
  if (column.kind === 'action') return Object.freeze({ ...column, sort: null });
  if (!SORT_TYPES.has(column.sort?.type) || typeof column.sort?.value !== 'function')
    throw new Error(`La colonne ${column.key} doit définir sort.type et sort.value.`);
  return Object.freeze({ ...column, kind: 'data', sort: Object.freeze({ ...column.sort }) });
}

const clientName = client => client?.nomFamille ? [client.nomFamille, client.prenom].filter(Boolean).join(' ') : client?.nom || client?.prenom || null;
const refColumn = defineDossierTableColumn({ key: 'ref', label: 'Référence', sort: { type: 'text', value: ({ dossier }) => dossier.ref } });
const clientColumn = defineDossierTableColumn({ key: 'client', label: 'Client', sort: { type: 'text', value: ({ client }) => clientName(client) } });
const actionColumn = defineDossierTableColumn({ key: 'action', label: 'Action', kind: 'action' });
const statusColumn = defineDossierTableColumn({ key: 'statusLabel', label: 'Statut du dossier', sort: { type: 'text', value: ({ model }) => model?.statusLabel } });
const paymentStateColumn = defineDossierTableColumn({ key: 'paymentState', label: 'Paiement', sort: { type: 'text', value: ({ model }) => model?.payment?.stateLabel } });
const dimensionsColumn = defineDossierTableColumn({ key: 'optimizedDimensions', label: 'Dimensions optimisées', sort: { type: 'text', value: ({ model }) => model?.optimizedDimensions?.join(' · ') || null } });
const receptionDateColumn = defineDossierTableColumn({ key: 'receivedAt', label: 'Dernière réception', sort: { type: 'date', value: ({ model }) => model?.reception?.lastReceivedAt } });
const financialColumn = (key, label) => defineDossierTableColumn({ key, label, align: 'right', sort: { type: 'number', value: ({ model }) => model?.payment?.[key] } });
export const TABLE_COLUMNS = Object.freeze({
  daily: Object.freeze([refColumn, clientColumn, receptionDateColumn, statusColumn, paymentStateColumn,
    defineDossierTableColumn({ key: 'statut', label: 'Travail à faire', sort: { type: 'text', value: ({ model }) => model?.title === 'Tâches à actualiser' ? null : model?.title } }),
    defineDossierTableColumn({ key: 'owner', label: 'Qui s’en occupe', filter: { text: ({ model }) => model?.ownerName }, sort: { type: 'text', value: ({ model }) => ['—', 'Non attribué', 'Membre de l’équipe'].includes(model?.ownerName) ? null : model?.ownerName } }),
    defineDossierTableColumn({ key: 'casier', label: 'Casier', filter: { text: ({ dossier }) => dossier.casier || 'À renseigner' }, sort: { type: 'text', value: ({ dossier }) => dossier.casier } }),
    defineDossierTableColumn({ key: 'cartons', label: 'Cartons reçus', sort: { type: 'number', value: ({ dossier }) => receptionCartonManifest(dossier).nbColis } }), dimensionsColumn, actionColumn]),
  payments: Object.freeze([refColumn, clientColumn, receptionDateColumn, statusColumn, paymentStateColumn, financialColumn('requested', 'Demandé'), financialColumn('paid', 'Payé'), financialColumn('remaining', 'Reste à payer'),
    defineDossierTableColumn({ key: 'sentAt', label: 'Devis envoyé le', sort: { type: 'date', value: ({ model }) => model?.payment?.sentAt } }), actionColumn]),
  departures: Object.freeze([refColumn, clientColumn, receptionDateColumn, statusColumn, paymentStateColumn,
    defineDossierTableColumn({ key: 'departure', label: 'Départ prévu', sort: { type: 'date', value: ({ model, envoi }) => /^(Prévu le|Date dépassée)/.test(model?.departure?.label || '') ? envoi?.date : null } }),
    defineDossierTableColumn({ key: 'destination', label: 'Destination', sort: { type: 'text', value: ({ model }) => model?.departure?.destination === 'Destination à préciser' ? null : model?.departure?.destination } }),
    defineDossierTableColumn({ key: 'packages', label: 'Colis à expédier', sort: { type: 'number', value: ({ dossier, model }) => model?.optimized ? dossier.outgoingParcelCount : null } }),
    defineDossierTableColumn({ key: 'readiness', label: 'Prêt à partir ?', sort: { type: 'text', value: ({ model }) => model?.departure?.readinessLabel } }), dimensionsColumn, actionColumn]),
});

export function isDossierTableColumnSortable(column) {
  return column?.kind !== 'action' && SORT_TYPES.has(column?.sort?.type) && typeof column.sort.value === 'function';
}

function normalizedSortValue(value, type) {
  if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
  if (type === 'text') return typeof value === 'string' ? value.trim() : null;
  if (type === 'number') return (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === 'date') {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
    const date = value.slice(0, 10), timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
    return timestamp;
  }
  return null;
}

/** Unknown values stay last in BOTH directions. Equal values retain input
 * order, accessors run once per dossier and no row/model is rewritten. */
export function sortDossierTableRows(dossiers, { column, direction = 'asc', models, getClient = () => undefined, envois = [] } = {}) {
  if (!isDossierTableColumnSortable(column)) return [...dossiers];
  const envoiById = new Map(envois.map(envoi => [envoi.id, envoi]));
  const sign = direction === 'desc' ? -1 : 1;
  return dossiers.map((dossier, index) => ({ dossier, index, value: normalizedSortValue(column.sort.value({
    dossier, model: models?.get?.(dossier.id), client: getClient(dossier.clientId), envoi: envoiById.get(dossier.envoi || dossier.envoiId),
  }), column.sort.type) })).sort((left, right) => {
    if (left.value === null || right.value === null) return left.value !== null ? -1 : right.value !== null ? 1 : left.index - right.index;
    const order = column.sort.type === 'text' ? naturalTextOrder.compare(left.value, right.value) : left.value - right.value;
    return sign * order || left.index - right.index;
  }).map(item => item.dossier);
}

export function dossierTableSortDirectionLabel(column, direction = 'asc') {
  const descending = direction === 'desc';
  return column?.sort?.type === 'date' ? descending ? 'plus récent d’abord' : 'plus ancien d’abord'
    : column?.sort?.type === 'number' ? descending ? 'du plus grand au plus petit' : 'du plus petit au plus grand'
    : descending ? 'Z → A' : 'A → Z';
}

const BEFORE_QUOTE = new Set(['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'refuse_client']);
const QUOTED = new Set(['devis_envoye', 'attente_paiement', 'paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre']);
const dateTime = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const money = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value) * 100) / 100 : null;

/** Amounts are recorded facts in euros, never inferred from a status or a link. */
function paymentModel(dossier, now) {
  const total = money(dossier.devisTotal);
  const frozenTotal = money(dossier.devisSnapshot?.amounts?.total);
  const explicitZero = frozenTotal === 0 && Number(dossier.quoteVersion) > 0;
  const candidate = total ?? (explicitZero ? 0 : null);
  const quoted = QUOTED.has(dossier.statut);
  const revised = dossier.devisBrouillon === true || dossier.quoteNeedsReview === true
    || BEFORE_QUOTE.has(dossier.statut) && Boolean(dossier.devisEnvoyeLe);
  const conflictingTotal = frozenTotal !== null && candidate !== null && frozenTotal !== candidate;
  const valid = quoted && !revised && !conflictingTotal && (candidate > 0 || candidate === 0 && explicitZero);
  const requested = valid ? candidate : null;
  const amount = money(dossier.paiementMontant);
  const paymentDate = dateTime(dossier.paiementDate);
  const recorded = paymentDate !== null && paymentDate <= now && amount !== null;
  const uncertainPayment = !recorded && (dossier.paiementMontant != null || dossier.paiementDate || dossier.statut === 'paye');
  const paid = recorded ? amount : uncertainPayment ? null : 0;
  const remaining = requested !== null && paid !== null ? Math.max(0, Math.round((requested - paid) * 100) / 100) : null;
  const sent = dateTime(dossier.devisEnvoyeLe);
  const sentAt = valid && sent !== null && sent <= now ? dossier.devisEnvoyeLe : null;
  let stateLabel;
  if (uncertainPayment || conflictingTotal || recorded && requested === null) stateLabel = 'Paiement à vérifier';
  else if (requested === null) stateLabel = revised ? 'À recalculer' : candidate > 0 ? 'Devis à envoyer' : 'À calculer';
  else if (paid > requested) stateLabel = 'Trop-perçu à vérifier';
  else if (paid > 0 && remaining > 0) stateLabel = 'Paiement partiel';
  else if (recorded && remaining === 0) stateLabel = 'Payé';
  else if (requested === 0) stateLabel = 'Aucun règlement demandé';
  else stateLabel = 'Paiement attendu';
  return { requested, paid, remaining, sentAt, stateLabel };
}

const fullyPaid = payment => payment.requested !== null && payment.paid !== null && payment.paid > 0 && payment.remaining === 0;
const currentTask = (dossier, payment, client) => dossierNextTask({ ...dossier,
  paiementDate: fullyPaid(payment) ? dossier.paiementDate : null,
  ...(payment.requested === 0 ? { quoteNeedsReview: false } : {}),
}, () => true, client);

function departureModel(dossier, envois, optimized, payment, now, client) {
  const envoiId = dossier.envoi || dossier.envoiId;
  const envoi = envois.find(item => item.id === envoiId);
  const code = envoi?.destinationCode || dossier.destinationCode || dossier.devisSnapshot?.inputs?.destination?.code || String(client?.cp || '').replace(/\s/g, '').slice(0, 3);
  const destination = DESTINATIONS[code]?.label || (code ? String(code) : 'Destination à préciser');
  const date = typeof envoi?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(envoi.date)
    && Number.isFinite(Date.parse(`${envoi.date}T00:00:00Z`)) && new Date(`${envoi.date}T00:00:00Z`).toISOString().slice(0, 10) === envoi.date ? envoi.date : null;
  const formattedDate = date ? date.split('-').reverse().join('/') : null;
  const departed = Boolean(dossier.dateExpedition || envoi?.departedAt || envoi?.manifestVersion > 0);
  const cancelled = envoi?.statut === 'annule';
  const past = date && date < new Date(now).toISOString().slice(0, 10);
  const label = !envoi ? departed ? 'Expédition enregistrée' : envoiId ? 'Départ à vérifier' : 'À planifier'
    : cancelled ? 'Départ annulé'
    : departed ? 'Départ confirmé'
    : envoi.statut === 'archive' ? 'Départ archivé'
    : !date ? 'Date à préciser' : past ? `Date dépassée · ${formattedDate}` : `Prévu le ${formattedDate}`;
  const readiness = departureReadiness(dossier);
  const task = currentTask(dossier, payment, client);
  const nextPrerequisite = {
    reception: 'Réception à compléter',
    accord: dossier.statut === 'mesure' ? 'Accord client à demander' : dossier.statut === 'refuse_client' ? 'Accord client à revoir' : 'Accord client attendu',
    preparation: 'Optimisation à terminer', documents: 'Factures à vérifier', devis: 'Devis à envoyer',
  }[task];
  let readinessLabel;
  if (dossier.statut === 'annule' || dossier.archive) readinessLabel = dossier.archive ? 'Dossier archivé' : 'Dossier annulé';
  else if (dossier.statut === 'livre') readinessLabel = 'Livré';
  else if (departed) readinessLabel = 'Expédition enregistrée';
  else if (cancelled || envoi?.statut === 'archive' || past) readinessLabel = 'Planning à vérifier';
  else if (nextPrerequisite) readinessLabel = nextPrerequisite;
  else if (payment.requested === 0) readinessLabel = 'Montant nul : départ à vérifier avec un responsable';
  else if (!fullyPaid(payment)) readinessLabel = payment.paid > 0 && payment.remaining > 0 ? 'Paiement à compléter' : 'Paiement à vérifier';
  else if (!optimized) readinessLabel = 'Optimisation à terminer';
  else if (!readiness.eligible) readinessLabel = readiness.reasons[0]?.text || 'Départ à vérifier';
  else readinessLabel = envoi ? 'Prêt pour ce départ' : 'Prêt à affecter';
  return { label, destination, packagesLabel: optimized ? `${dossier.outgoingParcelCount} colis après optimisation` : 'Colis après optimisation à confirmer', readinessLabel };
}

/** Keep task ids/versions and attribution. A stale ready row must not enable a
 * command when the dossier already proves its prerequisite is missing. */
function checkedAction(action, dossier, optimized, payment, now) {
  let reason;
  const open = !['annule', 'livre'].includes(dossier.statut);
  const compatible = {
    reception: ['receptionne', 'mesure', 'attente_feu_vert'].includes(dossier.statut),
    preparation: ['autorise', 'en_preparation'].includes(dossier.statut) && !optimized,
    documents: ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation'].includes(dossier.statut),
    quote: ['autorise', 'en_preparation'].includes(dossier.statut),
    departure: dossier.statut === 'paye' && !dossier.dateExpedition,
    conversation: true,
    correction: open,
  }[action.kind];
  if (!compatible) reason = 'Le dossier a changé. Actualisez les tâches.';
  else if (action.kind === 'reception' && dossier.statut === 'attente_feu_vert'
    && !(dateTime(dossier.attenteClientUntil) !== null && dateTime(dossier.attenteClientUntil) <= now))
    reason = dossier.attenteClientDate ? 'Attente demandée par le client' : 'Accord client attendu';
  else if (['preparation', 'quote'].includes(action.kind) && dossier.feuVert !== undefined && dossier.feuVert !== 'autorise') reason = 'Accord client requis';
  else if (['preparation', 'quote'].includes(action.kind) && dossier.produitInterdit) reason = 'Contenu à vérifier';
  else if (action.kind === 'quote' && !optimized) reason = 'Optimisation à terminer';
  else if (action.kind === 'departure' && !fullyPaid(payment)) reason = payment.requested === 0 ? 'Montant nul : départ à vérifier avec un responsable' : payment.paid > 0 && payment.remaining > 0 ? 'Paiement à compléter' : 'Paiement à vérifier';
  else if (action.kind === 'departure' && !optimized) reason = 'Optimisation à terminer';
  return reason && !action.blocked_reason?.trim() ? { ...action, blocked_reason: reason } : action;
}

function ownerName(action, me, teamUsers) {
  if (!action) return '—';
  if (!action.assignee_id) return 'Non attribué';
  if (action.assignee_id === me) return 'Vous';
  const user = teamUsers.find(person => person.authId === action.assignee_id);
  return [user?.prenom, user?.nom].filter(Boolean).join(' ').trim() || 'Membre de l’équipe';
}

/** One dossier produces one row. Presets change presentation, never ownership
 * filters, permissions, availability or the number of matching dossiers.
 * `actions` may be pre-grouped by the caller; no global store or mutation here.
 */
export function buildDossierTableModel(dossier, { actions = [], me, can = () => false, teamUsers = [], envois = [], client = dossier.devisSnapshot?.inputs?.client || {}, scope = 'all', view = 'daily', available = true, now = Date.now(), workReady = true, assigneeFilter = '' } = {}) {
  const optimized = hasCurrentPreparation(dossier);
  const payment = paymentModel(dossier, now);
  const departure = departureModel(dossier, envois, optimized, payment, now, client);
  const boxes = optimized ? dossier.finalPackages ?? [{ dimL: dossier.finL, dimW: dossier.finW, dimH: dossier.finH }] : [];
  const dimensions = value => Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  const optimizedDimensions = boxes.map((box, index) => `${boxes.length > 1 ? `Colis ${index + 1} : ` : ''}${dimensions(box.dimL)} × ${dimensions(box.dimW)} × ${dimensions(box.dimH)} cm`);
  // A legacy status cannot turn an incomplete recorded payment into “Payé”.
  const statusLabel = dossier.statut === 'paye' && payment.stateLabel !== 'Payé' ? payment.stateLabel : STATUTS[dossier.statut]?.label || 'Statut à vérifier';
  const base = { reception: receptionDateSummary(dossier, { now }), payment, departure, optimized, optimizedDimensions, statusLabel };
  if (!workReady) return { ...base, action: null, title: 'Tâches à actualiser', detail: 'Actualisez les tâches pour retrouver leur attribution.', ownerName: '—', otherActionsCount: 0, matchesScope: scope === 'all' && !assigneeFilter };
  const rows = dossier.archive ? [] : sortWorkActions(actions.filter(action => action.colis_id === dossier.id && action.state !== 'done')
    .map(action => checkedAction(action, dossier, optimized, payment, now)), now);
  const mine = action => Boolean(me) && action.assignee_id === me;
  const free = action => !action.assignee_id;
  const canDo = action => canWorkAction(action, can) && !actionWaiting(action)
    && (mine(action) && ['ready', 'in_progress'].includes(action.state) || free(action) && available && action.state === 'ready');
  const scoped = rows.filter(action => (scope === 'mine' ? mine(action) : scope === 'pool' ? Boolean(me) && free(action) && canDo(action) : true)
    && (!assigneeFilter || (assigneeFilter === 'mine' ? mine(action) : assigneeFilter === 'unassigned' ? free(action) : action.assignee_id === assigneeFilter)));
  const next = currentTask(dossier, payment, client);
  const stageKind = { reception: 'reception', accord: dossier.statut === 'refuse_client' ? 'correction' : 'reception', preparation: 'preparation', documents: 'documents', devis: 'quote', paiement: 'quote', expedition: 'departure', livraison: 'departure' }[next];
  const preferred = view === 'payments' ? 'quote' : view === 'departures' ? 'departure' : stageKind;
  const ordered = [...scoped].sort((a, b) => Number(!canDo(a)) - Number(!canDo(b))
    || Number(actionWaiting(a)) - Number(actionWaiting(b))
    || Number(a.kind !== preferred) - Number(b.kind !== preferred)
    || Number(a.kind !== stageKind) - Number(b.kind !== stageKind));
  const action = ordered[0] || null;
  let title = action ? workTitle({ ...action, action_hint: action.action_hint?.trim() }) : dossier.archive ? 'Dossier archivé' : dossier.statut === 'livre' ? 'Livré' : dossier.statut === 'annule' ? 'Dossier annulé' : DOSSIER_TASKS[next]?.title || 'Consulter le dossier';
  if (action?.kind === 'reception' && !action.action_hint?.trim()) title = dossier.statut === 'receptionne' ? 'Mesurer les cartons' : dossier.statut === 'mesure' ? 'Demander l’accord du client' : 'Suivre l’accord du client';
  let detail = action ? actionWaiting(action) ? workSituation(action) : !canWorkAction(action, can) ? 'Cette tâche nécessite une personne autorisée.' : action.assignee_id && !mine(action) ? 'Un collègue s’occupe de cette tâche.' : free(action) && !available ? 'Vous êtes indisponible pour prendre une nouvelle tâche.' : workSituation(action)
    : 'Consultez le dossier pour retrouver la prochaine étape.';
  if (action && !actionWaiting(action)) {
    const priority = actionPriority(action, now);
    if (priority.urgent) detail = priority.reason + (canDo(action) ? '' : ` · ${detail}`);
  }
  return { ...base, action, title, detail, ownerName: ownerName(action, me, teamUsers), otherActionsCount: Math.max(0, rows.length - (action ? 1 : 0)), matchesScope: scope === 'all' && !assigneeFilter || scoped.length > 0 };
}

const exportKeys = {
  daily: ['ref', 'client', 'receivedAt', 'statusLabel', 'paymentState', 'statut', 'owner', 'casier', 'cartons', 'optimizedDimensions'],
  payments: ['ref', 'client', 'receivedAt', 'statusLabel', 'paymentState', 'requested', 'paid', 'remaining', 'sentAt'],
  departures: ['ref', 'client', 'receivedAt', 'statusLabel', 'paymentState', 'departure', 'destination', 'packages', 'readiness', 'optimizedDimensions'],
};
const tableDateFormatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Indian/Reunion' });

/** Shared by screen and spreadsheet; an explicit business timezone makes the
 * same saved instant display on the same date on every colleague's computer. */
export function formatDossierTableDate(value) {
  const timestamp = dateTime(value);
  return timestamp === null ? 'Non renseigné' : tableDateFormatter.format(new Date(timestamp));
}

export function dossierTableMissingAmountLabel(payment, key) {
  return key === 'paid' || /vérifier/.test(payment?.stateLabel || '') ? 'À vérifier' : 'À calculer';
}

/** Export has a strict view allowlist, even if an unexpected descriptor is
 * supplied. It cannot fall back to the old all-fields/client-contact export. */
export function dossierTableExportColumns(view, columns) {
  if (!Object.hasOwn(exportKeys, view) || !Array.isArray(columns)) throw new Error('La vue et ses colonnes doivent être précisées avant l’export.');
  const seenKeys = new Set(), seenLabels = new Set();
  return columns.filter(column => {
    if (!exportKeys[view].includes(column?.key) || seenKeys.has(column.key)) return false;
    if (typeof column.label !== 'string' || !column.label.trim()) throw new Error('Une colonne à exporter n’a pas de nom.');
    if (seenLabels.has(column.label)) throw new Error('Deux colonnes à exporter portent le même nom.');
    seenKeys.add(column.key); seenLabels.add(column.label);
    return true;
  }).map(({ key, label }) => ({ key, label }));
}

/** Export precisely the supplied visible rows and descriptors, in their order.
 * The caller applies permissions/filters and passes the same models as the UI.
 * Financial values and task ownership NEVER fall back to raw dossier fields.
 */
export function buildDossierTableExportRows(dossiers, clients, models, view, columns) {
  const selected = dossierTableExportColumns(view, columns);
  const clientById = new Map((clients || []).map(client => [client.id, client]));
  const seen = new Set();
  return (dossiers || []).filter(dossier => {
    const key = dossier.id || dossier.ref;
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).map(dossier => {
    const client = clientById.get(dossier.clientId);
    const model = models?.get?.(dossier.id);
    const name = client?.nomFamille ? [client.nomFamille, client.prenom].filter(Boolean).join(' ') : client?.nom || client?.prenom || 'Client non renseigné';
    const code = String(client?.cp || '').trim().slice(0, 3);
    const sector = getSecteurByCP(client?.cp);
    const zone = [DESTINATIONS[code]?.label, sector ? sector[0] + sector.slice(1).toLowerCase() : ''].filter(Boolean).join(' · ');
    const amount = key => typeof model?.payment?.[key] === 'number' && Number.isFinite(model.payment[key])
      ? model.payment[key] : dossierTableMissingAmountLabel(model?.payment, key);
    const values = {
      ref: dossier.ref || 'Sans référence',
      client: [name, zone].filter(Boolean).join('\n'),
      statut: [model?.title || 'Tâches à actualiser', model?.detail, model?.otherActionsCount > 0 ? `${model.otherActionsCount} autre${model.otherActionsCount > 1 ? 's' : ''} tâche${model.otherActionsCount > 1 ? 's' : ''} en parallèle` : ''].filter(Boolean).join('\n'),
      statusLabel: model?.statusLabel || 'Statut à vérifier', paymentState: model?.payment?.stateLabel || 'À vérifier',
      optimizedDimensions: model?.optimized ? (model.optimizedDimensions || []).join('\n') : '',
      owner: model?.ownerName || '—',
      casier: dossier.casier || 'À renseigner',
      cartons: receptionCartonManifest(dossier).nbColis,
      receivedAt: formatDossierTableDate(model?.reception?.lastReceivedAt) + (model?.reception?.lastReceivedAt && !model.reception.complete ? ` · ${model.reception.knownCount}/${model.reception.totalCount} cartons datés` : ''),
      requested: amount('requested'), paid: amount('paid'), remaining: amount('remaining'),
      sentAt: formatDossierTableDate(model?.payment?.sentAt),
      departure: model?.departure?.label || 'À prévoir', destination: model?.departure?.destination || 'À renseigner',
      packages: model?.departure?.packagesLabel || 'À préparer', readiness: model?.departure?.readinessLabel || 'À vérifier',
    };
    return Object.fromEntries(selected.map(column => [column.label, values[column.key]]));
  });
}
