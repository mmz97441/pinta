import { receptionCartonManifest } from './reception.js';

export const MISSIONS = [
  { id: 'reception', label: 'Réception' }, { id: 'preparation', label: 'Préparation' },
  { id: 'communication', label: 'Relation client' }, { id: 'documents', label: 'Documents et devis' },
  { id: 'departures', label: 'Départs' }, { id: 'coordination', label: 'Coordination' },
];
export const WORK_KINDS = {
  reception: { label: 'Réception et accord', mission: 'reception', permissions: ['perm_colis_receptionner', 'perm_colis_mesurer', 'perm_colis_demander_feuvert'] },
  preparation: { label: 'Préparer les cartons', mission: 'preparation', permissions: ['perm_colis_preparer'] },
  documents: { label: 'Vérifier les documents', mission: 'documents', permissions: ['perm_factures_valider', 'perm_factures_refuser', 'perm_factures_ocr', 'perm_factures_modifier_articles'] },
  conversation: { label: 'Répondre au client', mission: 'communication', permissions: ['perm_comm_message_libre', 'perm_comm_telegram', 'perm_comm_email'] },
  quote: { label: 'Établir le devis', mission: 'documents', permissions: ['perm_colis_calculer_devis', 'perm_colis_envoyer_devis'] },
  departure: { label: 'Organiser le départ', mission: 'departures', permissions: ['perm_colis_affecter_envoi', 'perm_colis_expedier', 'perm_envois_modifier'] },
  correction: { label: 'Revoir le dossier', mission: 'coordination', permissions: ['perm_colis_revenir_arriere', 'perm_colis_valider_feuvert'] },
};
export const WORK_STATES = { ready: 'À faire', in_progress: 'En cours', waiting: 'En attente', done: 'Terminé' };
export const PERSONAL_SECTIONS = [
  { id: 'now', label: 'À faire maintenant' }, { id: 'progress', label: 'En cours' },
  { id: 'pool', label: 'À prendre' }, { id: 'waiting', label: 'En attente' },
];
export const workTime = value => value ? Date.parse(value) : NaN;
export function canWorkAction(action, can = () => false) {
  if (action.kind === 'conversation' && action.action_hint === 'Accès client à activer') return can('perm_clients_creer');
  return Boolean(WORK_KINDS[action.kind]?.permissions.some(permission => can(permission)));
}
export function availableMissions(can) {
  return MISSIONS.filter(mission => mission.id === 'communication' && can('perm_clients_creer') || Object.values(WORK_KINDS).some(kind => kind.mission === mission.id && kind.permissions.some(permission => can(permission))));
}
export function effectiveMissions(preference, can) {
  const allowed = availableMissions(can).map(mission => mission.id);
  return preference && Array.isArray(preference.missions) ? preference.missions.filter(mission => allowed.includes(mission)) : allowed;
}
export function staffAvailable(preference, now = Date.now()) {
  return preference?.available !== false && !(workTime(preference?.absent_until) > now);
}
export function actionBlocked(action) { return Boolean(action.blocked_reason?.trim()); }
export function actionPriority(action, now = Date.now()) {
  const due = workTime(action.due_at);
  if (action.priority_reason?.trim() && workTime(action.priority_until) > now) return { rank: 500, reason: action.priority_reason, urgent: true };
  if (Number.isFinite(due) && due <= now) return { rank: 400, reason: 'Échéance dépassée', urgent: true };
  if (action.state === 'in_progress') return { rank: 300, reason: 'Travail déjà commencé', urgent: false };
  if (action.state === 'waiting' && workTime(action.review_at) <= now) return { rank: 200, reason: 'Attente à réexaminer', urgent: true };
  if (actionBlocked(action)) return { rank: 0, reason: action.blocked_reason, urgent: false };
  return { rank: 100, reason: Number.isFinite(due) ? 'Échéance prévue' : 'Action disponible', urgent: false };
}
export function sortWorkActions(actions, now = Date.now()) {
  return [...actions].sort((a, b) => actionPriority(b, now).rank - actionPriority(a, now).rank
    || (workTime(a.due_at) || Infinity) - (workTime(b.due_at) || Infinity)
    || (workTime(a.created_at) || Infinity) - (workTime(b.created_at) || Infinity)
    || String(a.id).localeCompare(String(b.id)));
}
export function buildPersonalWork({ actions = [], dossiers = [], clients = [], userId, preference, can = () => false, mission = '', search = '', now = Date.now() }) {
  const dossierById = new Map(dossiers.map(dossier => [dossier.id, dossier]));
  const clientById = new Map(clients.map(client => [client.id, client]));
  const missions = effectiveMissions(preference, can);
  const query = search.trim().toLocaleLowerCase('fr');
  const all = actions.filter(action => action.state !== 'done' && dossierById.has(action.colis_id) && !dossierById.get(action.colis_id).archive);
  const eligible = all.filter(action => canWorkAction(action, can) && missions.includes(WORK_KINDS[action.kind]?.mission));
  const scope = sortWorkActions(eligible.filter(action => {
    if (mission && WORK_KINDS[action.kind]?.mission !== mission) return false;
    const dossier = dossierById.get(action.colis_id);
    const client = clientById.get(dossier?.clientId);
    return !query || [WORK_KINDS[action.kind]?.label, dossier?.ref, client?.nom, client?.prenom, action.waiting_reason, action.blocked_reason].filter(Boolean).join(' ').toLocaleLowerCase('fr').includes(query);
  }), now);
  const owned = scope.filter(action => action.assignee_id === userId);
  const sections = {
    now: owned.filter(action => action.state === 'ready' && !actionBlocked(action)),
    progress: owned.filter(action => action.state === 'in_progress' && !actionBlocked(action)),
    pool: staffAvailable(preference, now) ? scope.filter(action => !action.assignee_id && action.state === 'ready' && !actionBlocked(action)) : [],
    waiting: owned.filter(action => action.state === 'waiting' || actionBlocked(action)),
  };
  return {
    sections, counts: Object.fromEntries(Object.entries(sections).map(([key, rows]) => [key, rows.length])), scope,
    handoffs: scope.filter(action => action.handoff_to === userId),
    exceptions: all.filter(action => action.assignee_id === userId && (!canWorkAction(action, can) || !missions.includes(WORK_KINDS[action.kind]?.mission))),
    outsideMissionDue: eligible.filter(action => action.assignee_id === userId && mission && WORK_KINDS[action.kind]?.mission !== mission && actionPriority(action, now).urgent),
    dossierById, clientById, missions,
  };
}
export function workTotals(actions, dossiers = []) {
  const ids = new Set(actions.map(action => action.colis_id));
  return { actions: actions.length, dossiers: ids.size, cartons: dossiers.filter(dossier => ids.has(dossier.id)).reduce((total, dossier) => total + receptionCartonManifest(dossier).nbColis, 0) };
}
export function safeWorkReturn(value, fallback = '/') {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : fallback;
}
export function workActionUrl(action, returnTo = '/', dossier) {
  const params = new URLSearchParams({ returnTo: safeWorkReturn(returnTo), action: action.id });
  if (action.kind === 'conversation' && action.action_hint === 'Accès client à activer' && dossier?.clientId) return `/clients/${encodeURIComponent(dossier.clientId)}?${params}`;
  if (action.kind === 'conversation') return `/conversations?${new URLSearchParams({ dossier: action.colis_id, action: action.id, returnTo: safeWorkReturn(returnTo) })}`;
  if (['preparation', 'documents', 'quote'].includes(action.kind)) return `/colis/${encodeURIComponent(action.colis_id)}?${params}`;
  return `/colis?${new URLSearchParams({ dossier: action.colis_id, returnTo: safeWorkReturn(returnTo), action: action.id })}`;
}
