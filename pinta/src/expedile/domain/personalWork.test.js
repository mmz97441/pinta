import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonalWork, sortWorkActions, workTotals, availableMissions, workActionUrl, workActionOpensClient, staffAvailable, canWorkAction, personalSection, nextPersonalWorkAction, PERSONAL_SECTIONS, findDossierWorkAction, workLoad, teamWorkQueues, workDate, workDateParts, staffDisplayName } from './personalWork.js';
const now = Date.parse('2026-09-12T12:00:00Z');
const dossier = { id: 'parcel', clientId: 'client', ref: 'EXP-QA', nbColis: 3, responsibleStaffId: 'referent' };
const base = { dossiers: [dossier], clients: [{ id: 'client', nom: 'Exemple' }], userId: 'worker', now, can: () => true };
const action = (id, changes = {}) => ({ id, colis_id: 'parcel', kind: 'preparation', state: 'ready', assignee_id: 'worker', created_at: '2026-09-10', ...changes });
test('personal buckets and counts describe exactly the same actionable scope', () => {
 const actions = [action('ready'), action('started', { state: 'in_progress' }), action('pool', { assignee_id: null }), action('wait', { state: 'waiting' }), action('blocked', { blocked_reason: 'Accord à revoir' }), action('other', { assignee_id: 'other' }), action('done', { state: 'done' })];
 const view = buildPersonalWork({ ...base, actions });
 assert.deepEqual(view.counts, { now: 2, pool: 1, waiting: 2 });
 assert.deepEqual(view.sections.now.map(row => row.id), ['started', 'ready']);
 assert.equal(new Set(Object.values(view.sections).flat().map(row => row.id)).size, 5);
 assert.equal(dossier.responsibleStaffId, 'referent');
});
test('missions never grant a permission and preparation does not inherit the communication backlog', () => {
 const can = permission => permission === 'perm_colis_preparer';
 assert.deepEqual(availableMissions(can).map(mission => mission.id), ['preparation']);
 const view = buildPersonalWork({ ...base, can, preference: { missions: ['preparation', 'communication'] }, actions: [action('prepare'), action('reply', { kind: 'conversation' })] });
 assert.deepEqual(view.sections.now.map(row => row.id), ['prepare']);
 assert.deepEqual(view.exceptions.map(row => row.id), ['reply']);
});
test('a promised deadline and work already started precede a new message without blanket message priority', () => {
 const rows = [action('reply', { kind: 'conversation' }), action('prepare', { state: 'in_progress' }), action('quote', { kind: 'quote', due_at: '2026-09-12T09:00:00Z' })];
 assert.deepEqual(sortWorkActions(rows, now).map(row => row.id), ['quote', 'prepare', 'reply']);
});
test('handoff recipient sees the invitation while the sender keeps ownership until acceptance', () => {
 const pending = action('relay', { handoff_to: 'other' });
 assert.equal(buildPersonalWork({ ...base, actions: [pending] }).counts.now, 1);
 const recipient = buildPersonalWork({ ...base, userId: 'other', actions: [pending] });
 assert.equal(recipient.counts.now, 0); assert.equal(recipient.handoffs.length, 1);
});
test('mission filters retain a warning for another assigned commitment already due', () => {
 const view = buildPersonalWork({ ...base, mission: 'preparation', actions: [action('prepare'), action('quote', { kind: 'quote', due_at: '2026-09-11' })] });
 assert.equal(view.counts.now, 1); assert.equal(view.outsideMissionDue.length, 1);
});
test('units count actions, distinct dossiers and physical receipt cartons separately', () => {
 assert.deepEqual(workTotals([action('a'), action('b', { kind: 'documents' })], [dossier]), { actions: 2, dossiers: 1, cartons: 3 });
});
test('absences do not silently make a colleague available or transfer their work', () => {
 assert.equal(staffAvailable({ available: false, absent_until: '2026-09-11' }, now), false);
 assert.equal(staffAvailable({ available: true, absent_until: '2026-09-13' }, now), false);
});
test('opening work preserves the queue route and rejects external return URLs', () => {
 const url = new URL(workActionUrl(action('a'), '/?section=progress&mission=preparation'), 'https://example.test');
 assert.equal(url.searchParams.get('returnTo'), '/?section=progress&mission=preparation');
 assert.equal(url.searchParams.get('section'), 'preparation');
 for (const [kind, section] of [['documents', 'documents'], ['quote', 'devis'], ['departure', 'expedition']]) {
  const task = new URL(workActionUrl(action('other', { kind })), 'https://example.test');
  assert.equal(task.searchParams.get('section'), section);
  assert.equal(task.pathname, '/colis/parcel');
 }
 assert.equal(new URL(workActionUrl(action('a'), '//outside.test'), 'https://example.test').searchParams.get('returnTo'), '/');
});
test('missing dossier data never creates an invisible personal action', () => {
 assert.equal(buildPersonalWork({ ...base, actions: [action('missing', { colis_id: 'unloaded' })] }).counts.now, 0);
});
test('unavailable staff retain owned work while new claims leave the actionable pool', () => {
 const view = buildPersonalWork({ ...base, preference: { available: false }, actions: [action('mine'), action('free', { assignee_id: null })] });
 assert.equal(view.counts.now, 1); assert.equal(view.counts.pool, 0);
});
test('unassigned waits stay in team tracking and never advertise immediately executable work', () => {
 const item = action('consent', { kind: 'reception', state: 'waiting', blocked_reason: 'Accord client attendu', assignee_id: null });
 const before = buildPersonalWork({ ...base, actions: [item] });
 assert.deepEqual(before.sections.pool, []);
 assert.deepEqual(teamWorkQueues([item], now).waiting.map(row => row.id), ['consent']);
 assert.equal(before.counts.now, 0);
 const after = buildPersonalWork({ ...base, actions: [{ ...item, assignee_id: base.userId }] });
 assert.equal(after.counts.pool, 0); assert.equal(after.counts.now, 0);
 assert.deepEqual(after.sections.waiting.map(row => row.id), ['consent']);
 assert.equal(item.blocked_reason, 'Accord client attendu');
 for (const overrides of [{ can: () => false }, { preference: { missions: ['preparation'] } }, { preference: { available: false } }]) {
  assert.equal(buildPersonalWork({ ...base, actions: [item], ...overrides }).counts.pool, 0);
 }
});
test('dossier claim targets the visible task, never a completed quote or another dossier', () => {
 const current = { ...dossier, statut: 'attente_feu_vert', devisTotal: 30, quoteNeedsReview: true };
 const consent = action('consent', { kind: 'reception', state: 'waiting', blocked_reason: 'Accord client attendu', assignee_id: null });
 const actions = [action('old-quote', { kind: 'quote', state: 'done' }), action('foreign', { colis_id: 'other' }), consent];
 assert.equal(findDossierWorkAction(current, actions)?.id, 'consent');
 assert.equal(findDossierWorkAction(current, actions, 'accord')?.id, 'consent');
 assert.equal(findDossierWorkAction(current, actions, 'devis'), null);
 assert.equal(findDossierWorkAction(current, actions, 'preparation'), null);
 assert.equal(findDossierWorkAction({ ...current, archive: true }, actions), null);
 assert.equal(findDossierWorkAction(current, [actions[0]]), null);
 assert.equal(findDossierWorkAction(current, [{ ...consent, assignee_id: 'colleague' }])?.assignee_id, 'colleague');
});
test('pool continuation skips a wait even when its deadline makes it the highest priority', () => {
 const waiting = action('waiting', { assignee_id: null, state: 'waiting', blocked_reason: 'Accord client attendu', due_at: '2020-01-01' });
 const input = { ...base, returnTo: '/?section=pool', actions: [waiting, action('ready', { assignee_id: null })] };
 assert.equal(buildPersonalWork(input).sections.pool[0].id, 'ready');
 assert.equal(nextPersonalWorkAction(input)?.id, 'ready');
 assert.equal(nextPersonalWorkAction({ ...input, actions: [waiting] }), null);
});
test('dossier preview selects an authorized task while an explicit screen keeps its own assignment', () => {
 const current = { ...dossier, statut: 'en_preparation', preparationCompositionVersion: 1, finalMeasurementsVersion: 1, finalPackages: [{ dimL: 20, dimW: 20, dimH: 20, poids: 1 }], factures: [] };
 const documents = action('documents', { kind: 'documents' });
 const quote = action('quote', { kind: 'quote', state: 'waiting', blocked_reason: 'Documents à valider' });
 const can = permission => permission === 'perm_colis_calculer_devis';
 assert.equal(findDossierWorkAction(current, [documents, quote], undefined, { can })?.id, 'quote');
 assert.equal(findDossierWorkAction(current, [documents], undefined, { can }), null);
 assert.equal(findDossierWorkAction(current, [documents, quote], 'documents', { can })?.id, 'documents');
 const correction = action('correction', { kind: 'correction' });
 const paidStep = { ...dossier, statut: 'devis_envoye', devisTotal: 30 };
 assert.equal(findDossierWorkAction(paidStep, [correction])?.id, 'correction');
 assert.equal(findDossierWorkAction(paidStep, [correction], 'paiement', { actionId: 'correction' })?.id, 'correction');
 assert.equal(findDossierWorkAction(paidStep, [correction], 'documents', { actionId: 'correction' }), null);
});
test('customer access tasks open the client record and require invitation permission', () => {
 const item = action('access', { kind: 'conversation', action_hint: 'Accès client à activer' });
 assert.equal(canWorkAction(item, permission => permission === 'perm_comm_telegram'), false);
 assert.equal(canWorkAction(item, permission => permission === 'perm_clients_creer'), true);
 assert.equal(new URL(workActionUrl(item, '/', dossier), 'https://example.test').pathname, '/clients/client');
 // The open button names the client record exactly when the task leads there.
 assert.equal(workActionOpensClient(item, dossier), true);
 assert.equal(workActionOpensClient(item, { ...dossier, clientId: null }), false);
 assert.equal(new URL(workActionUrl(item, '/', { ...dossier, clientId: null }), 'https://example.test').pathname, '/colis/parcel');
 assert.equal(workActionOpensClient(action('reply', { kind: 'conversation' }), dossier), false);
 assert.equal(workActionOpensClient(null, dossier), false);
 assert.deepEqual(availableMissions(permission => permission === 'perm_colis_demander_feuvert').map(item => item.id), ['reception']);
});

test('two main views preserve old progress, now, waiting and pool links', () => {
 assert.deepEqual(PERSONAL_SECTIONS.map(item => item.id), ['now', 'waiting']);
 for (const [old, current] of [['progress', 'now'], ['now', 'now'], ['waiting', 'waiting'], ['pool', 'pool'], ['unknown', 'now'], [null, 'now']]) assert.equal(personalSection(old), current);
});
test('explicit filters show hidden owned work while invitations and urgent commitments remain visible', () => {
 const view = buildPersonalWork({ ...base, mission: 'preparation', search: 'unknown', preference: { missions: ['preparation', 'documents'] }, actions: [
  action('urgent', { kind: 'quote', due_at: '2026-09-11' }),
  action('outside', { kind: 'departure' }),
  action('handoff', { kind: 'conversation', assignee_id: 'other', handoff_to: 'worker' }),
 ] });
 assert.equal(view.counts.now, 0);
 assert.deepEqual(view.outsideFilterDue.map(item => item.id), ['urgent']);
 assert.deepEqual(view.exceptions, []);
 assert.deepEqual(view.outsideFilterOwned.map(item => item.id), ['urgent', 'outside']);
 assert.deepEqual(view.handoffs.map(item => item.id), ['handoff']);
});
test('search matches the task instruction, priority reason and full client name', () => {
 for (const search of ['fragile', 'DUPONT', 'promesse']) {
  const view = buildPersonalWork({ ...base, clients: [{ id: 'client', prenom: 'Marie', nomFamille: 'Dupont' }], search, actions: [action('find', { action_hint: 'Protéger le contenu fragile', priority_reason: 'Promesse client', priority_until: '2026-09-20' })] });
  assert.equal(view.counts.now, 1);
 }
});
test('receipt, consent and correction actions open the relevant dossier task directly', () => {
 for (const [kind, statut, section] of [['reception', 'receptionne', 'reception'], ['reception', 'mesure', 'accord'], ['correction', 'autorise', 'preparation'], ['correction', 'devis_envoye', 'paiement']]) {
  const url = new URL(workActionUrl(action('task', { kind }), '/?section=pool', { ...dossier, statut, devisTotal: 20 }), 'https://example.test');
  assert.equal(url.pathname, '/colis/parcel'); assert.equal(url.searchParams.get('section'), section);
  assert.equal(url.searchParams.get('action'), 'task'); assert.equal(url.searchParams.get('returnTo'), '/?section=pool');
 }
 const conversation = new URL(workActionUrl(action('reply', { kind: 'conversation' }), '/?q=Exemple', dossier), 'https://example.test');
 assert.equal(conversation.pathname, '/colis/parcel'); assert.equal(conversation.searchParams.get('onglet'), 'conversation');
});
test('continuation uses the current personal filters and permissions without claiming work', () => {
 const actions = [action('finished'), action('foreign', { assignee_id: 'other' }), action('forbidden', { kind: 'quote' }), action('blocked', { blocked_reason: 'Accord requis' }), action('waiting', { state: 'waiting' }), action('next'), action('free', { assignee_id: null })];
 const input = { ...base, actions, currentActionId: 'finished', returnTo: '/?section=progress&mission=preparation&q=Exemple', can: permission => permission === 'perm_colis_preparer' };
 const before = JSON.stringify(actions);
 assert.equal(nextPersonalWorkAction(input)?.id, 'next');
 assert.equal(nextPersonalWorkAction({ ...input, returnTo: '/?section=pool&mission=preparation' })?.id, 'free');
 assert.equal(nextPersonalWorkAction({ ...input, returnTo: '/?q=missing' }), null);
 assert.equal(nextPersonalWorkAction({ ...input, returnTo: '/?section=waiting' }), null);
 assert.equal(nextPersonalWorkAction({ ...input, returnTo: '/equipe?mission=preparation' }), null);
 assert.equal(nextPersonalWorkAction({ ...input, returnTo: '/colis?q=Exemple' }), null);
 assert.equal(nextPersonalWorkAction({ ...input, preference: { available: false }, returnTo: '/?section=pool' }), null);
 assert.equal(JSON.stringify(actions), before);
});
test('continuation never reopens the task just completed, including when no action was in the URL', () => {
 const input = { ...base, currentDossierId: 'parcel', currentKind: 'preparation', actions: [action('prep'), action('documents', { kind: 'documents' })] };
 assert.equal(nextPersonalWorkAction(input)?.id, 'documents');
 assert.equal(nextPersonalWorkAction({ ...input, currentKind: undefined }), null);
 assert.equal(nextPersonalWorkAction({ ...input, preference: { active_mission: 'preparation' } })?.id, 'documents');
 assert.equal(nextPersonalWorkAction({ ...input, preference: { active_mission: 'preparation' }, returnTo: '/?mission=' })?.id, 'documents');
});

test('mission preferences never hide permitted assigned work, including when no new mission is selected', () => {
 const actions = [action('prepare'), action('quote', { kind: 'quote' }), action('wait', { kind: 'departure', state: 'waiting' }), action('free', { assignee_id: null }), action('freequote', { kind: 'quote', assignee_id: null })];
 for (const missions of [[], ['preparation']]) {
  const view = buildPersonalWork({ ...base, preference: { missions }, actions });
  assert.deepEqual(view.sections.now.map(item => item.id), ['prepare', 'quote']);
  assert.deepEqual(view.sections.waiting.map(item => item.id), ['wait']);
  assert.deepEqual(view.sections.pool.map(item => item.id), missions.length ? ['free'] : []);
  assert.deepEqual(view.exceptions, []);
 }
 const restricted = buildPersonalWork({ ...base, preference: { missions: [] }, actions, can: permission => permission === 'perm_colis_preparer' });
 assert.deepEqual(restricted.sections.now.map(item => item.id), ['prepare']);
 assert.deepEqual(restricted.exceptions.map(item => item.id), ['quote', 'wait']);
});

test('the pool excludes stale blocked states, waiting work and tasks owned by colleagues', () => {
 const actions = [action('ready', { assignee_id: null }), action('blocked', { assignee_id: null, blocked_reason: 'Factures à vérifier' }), action('waiting', { assignee_id: null, state: 'waiting' }), action('started', { assignee_id: null, state: 'in_progress' }), action('colleague', { assignee_id: 'colleague' }), action('done', { assignee_id: null, state: 'done' })];
 assert.deepEqual(buildPersonalWork({ ...base, actions }).sections.pool.map(item => item.id), ['ready']);
 assert.deepEqual(teamWorkQueues(actions, now).unassigned.map(item => item.id), ['ready']);
});

test('team queues retain blocked work, handoffs and missed review dates without changing ownership', () => {
 const actions = [action('free', { assignee_id: null }), action('blocked', { blocked_reason: 'Factures à vérifier' }), action('wait', { state: 'waiting', review_at: '2026-09-11' }), action('relay', { handoff_to: 'colleague' }), action('late', { due_at: '2026-09-10' }), action('priority', { priority_reason: 'Fragile', priority_until: '2026-09-20' }), action('finished', { state: 'done', due_at: '2026-09-10', handoff_to: 'colleague' })];
 const before = JSON.stringify(actions);
 const queues = teamWorkQueues(actions, now);
 assert.deepEqual(queues.unassigned.map(item => item.id), ['free']);
 assert.deepEqual(queues.waiting.map(item => item.id), ['wait', 'blocked']);
 assert.deepEqual(queues.handoff.map(item => item.id), ['relay']);
 assert.deepEqual(queues.overdue.map(item => item.id), ['late', 'wait']);
 assert.equal(queues.all.length, 6);
 assert.equal(JSON.stringify(actions), before);
});

test('team workload counts dependency blocks as waiting even when their stored state is in progress', () => {
 const actions = [action('ready'), action('progress', { state: 'in_progress' }), action('blocked-ready', { blocked_reason: 'Accord attendu' }), action('blocked-progress', { state: 'in_progress', blocked_reason: 'Factures attendues' }), action('wait', { state: 'waiting' }), action('done', { state: 'done' })];
 assert.deepEqual(workLoad(actions), { ready: 1, in_progress: 1, waiting: 3 });
 assert.deepEqual(workLoad([]), { ready: 0, in_progress: 0, waiting: 0 });
});

test('deadlines read like the dossier Départ labels, on Paris time whatever the device', () => {
 const today = Date.parse('2026-10-05T10:00:00Z');
 assert.equal(workDate('2026-10-21T15:00:00Z', { now: today }), 'mercredi 21 octobre, 17 h');
 assert.equal(workDate('2026-10-08T07:30:00Z', { now: today }), 'jeudi 8 octobre, 9 h 30');
 // 23:30 UTC is already the next day in Paris; the year shows when it is not the current one.
 assert.equal(workDate('2026-10-05T23:30:00Z', { now: today }), 'mardi 6 octobre, 1 h 30');
 assert.equal(workDate('2027-01-01T08:00:00Z', { now: today }), 'vendredi 1er janvier 2027, 9 h');
 for (const missing of [null, undefined, '', 'demain']) assert.equal(workDate(missing, { now: today }), null);
});

test('a deadline splits only between its day, its year and its hour, and still reads as workDate', () => {
 const today = Date.parse('2026-01-02T22:59:00Z');
 // Another year is a piece of its own, so the widest piece is always a day.
 assert.deepEqual(workDateParts('2025-12-31T22:59:00Z', { now: today }), ['mercredi 31 décembre', '2025,', '23 h 59']);
 assert.deepEqual(workDateParts('2026-01-03T22:59:00Z', { now: today }), ['samedi 3 janvier,', '23 h 59']);
 assert.deepEqual(workDateParts('2024-09-01T21:59:00Z', { now: Date.parse('2024-09-03T21:59:00Z') }), ['dimanche 1er septembre,', '23 h 59']);
 assert.deepEqual(workDateParts('2027-01-01T08:00:00Z', { now: Date.parse('2026-10-05T10:00:00Z') }), ['vendredi 1er janvier', '2027,', '9 h']);
 assert.deepEqual(workDateParts('2026-10-08T07:05:00Z', { now: Date.parse('2026-10-05T10:00:00Z') }), ['jeudi 8 octobre,', '9 h 05']);
 for (const missing of [null, undefined, '', 'demain']) assert.equal(workDateParts(missing, { now: today }), null);
 // Every day of three years, at hours and minutes that move each time, in winter and summer time.
 const parisYear = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric' });
 for (let instant = Date.parse('2025-01-01T00:07:00Z'); instant < Date.parse('2028-01-01T00:00:00Z'); instant += 86400000 + 3600000 + 7 * 60000) {
  const value = new Date(instant).toISOString();
  const parts = workDateParts(value, { now: today });
  assert.equal(parts.join(' '), workDate(value, { now: today }), value);
  assert.ok(parts.length === 2 || parts.length === 3, value);
  assert.match(parts[parts.length - 1], /^\d{1,2} h( \d{2})?$/, value);
  assert.equal(parts.length === 3, parisYear.format(instant) !== '2026', `${value}: the year is a piece only when it is not the current one`);
  if (parts.length === 3) assert.equal(parts[1], `${parisYear.format(instant)},`, value);
  assert.ok(parts.every(part => part.trim() === part && part.length > 0), value);
 }
});

test('a dossier task opens on its work area; a conversation and a client access do not', () => {
 const task = new URL(workActionUrl(action('prepare'), '/?section=pool', dossier), 'https://example.test');
 assert.equal(task.hash, '#dossier-work', 'The dossier page scrolls to and focuses its work area.');
 assert.equal(task.searchParams.get('section'), 'preparation');
 const conversation = new URL(workActionUrl(action('reply', { kind: 'conversation' }), '/', dossier), 'https://example.test');
 assert.equal(conversation.hash, '');
 assert.equal(conversation.searchParams.get('onglet'), 'conversation');
 const access = new URL(workActionUrl(action('access', { kind: 'conversation', action_hint: 'Accès client à activer' }), '/', dossier), 'https://example.test');
 assert.deepEqual([access.pathname, access.hash], ['/clients/client', '']);
});

test('a staff member reads the same name in the sidebar and Mon travail: the first name, else the name', () => {
 assert.equal(staffDisplayName({ prenom: 'Madly', nom: 'Hoarau' }), 'Madly');
 assert.equal(staffDisplayName({ prenom: '  ', nom: 'Camille' }), 'Camille');
 assert.equal(staffDisplayName({ nom: 'Camille' }), 'Camille');
 assert.equal(staffDisplayName(null), '');
});
