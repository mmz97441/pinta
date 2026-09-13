import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonalWork, sortWorkActions, workTotals, availableMissions, workActionUrl, staffAvailable, canWorkAction } from './personalWork.js';
const now = Date.parse('2026-09-12T12:00:00Z');
const dossier = { id: 'parcel', clientId: 'client', ref: 'EXP-QA', nbColis: 3, responsibleStaffId: 'referent' };
const base = { dossiers: [dossier], clients: [{ id: 'client', nom: 'Exemple' }], userId: 'worker', now, can: () => true };
const action = (id, changes = {}) => ({ id, colis_id: 'parcel', kind: 'preparation', state: 'ready', assignee_id: 'worker', created_at: '2026-09-10', ...changes });
test('personal buckets and counts describe exactly the same actionable scope', () => {
 const actions = [action('ready'), action('started', { state: 'in_progress' }), action('pool', { assignee_id: null }), action('wait', { state: 'waiting' }), action('blocked', { blocked_reason: 'Accord à revoir' }), action('other', { assignee_id: 'other' }), action('done', { state: 'done' })];
 const view = buildPersonalWork({ ...base, actions });
 assert.deepEqual(view.counts, { now: 1, progress: 1, pool: 1, waiting: 2 });
 assert.deepEqual(view.sections.now.map(row => row.id), ['ready']);
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
 assert.equal(new URL(workActionUrl(action('a'), '//outside.test'), 'https://example.test').searchParams.get('returnTo'), '/');
});
test('missing dossier data never creates an invisible personal action', () => {
 assert.equal(buildPersonalWork({ ...base, actions: [action('missing', { colis_id: 'unloaded' })] }).counts.now, 0);
});
test('unavailable staff retain owned work while new claims leave the actionable pool', () => {
 const view = buildPersonalWork({ ...base, preference: { available: false }, actions: [action('mine'), action('free', { assignee_id: null })] });
 assert.equal(view.counts.now, 1); assert.equal(view.counts.pool, 0);
});
test('customer access tasks open the client record and require invitation permission', () => {
 const item = action('access', { kind: 'conversation', action_hint: 'Accès client à activer' });
 assert.equal(canWorkAction(item, permission => permission === 'perm_comm_telegram'), false);
 assert.equal(canWorkAction(item, permission => permission === 'perm_clients_creer'), true);
 assert.equal(new URL(workActionUrl(item, '/', dossier), 'https://example.test').pathname, '/clients/client');
 assert.deepEqual(availableMissions(permission => permission === 'perm_colis_demander_feuvert').map(item => item.id), ['reception']);
});
