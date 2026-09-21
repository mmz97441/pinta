import test from 'node:test';
import assert from 'node:assert/strict';
import { dossierFollowingWork, workSituation } from './collaborativeWork.js';

test('shared continuation shows the colleague and actual blocker, independently of my personal queue', () => {
  const rows = [
    { id: 'prep', colis_id: 'exp', kind: 'preparation', state: 'done', assignee_id: 'me' },
    { id: 'doc', colis_id: 'exp', kind: 'documents', state: 'in_progress', assignee_id: 'colleague' },
    { id: 'quote', colis_id: 'exp', kind: 'quote', state: 'waiting', blocked_reason: 'Factures à vérifier' },
    { id: 'other', colis_id: 'another-exp', kind: 'documents', state: 'ready' },
  ];
  const original = structuredClone(rows);
  const next = dossierFollowingWork(rows, 'exp', 'preparation', 'prep');
  assert.deepEqual(next.map(row => row.id), ['doc', 'quote']);
  assert.equal(next[0].assignee_id, 'colleague');
  assert.equal(workSituation(next[1]), 'Factures à vérifier');
  assert.deepEqual(rows, original, 'Consultation never assigns or changes a task');
});

test('a completed historical blocker does not look like outstanding work', () => {
  const done = { id: 'done', colis_id: 'exp', kind: 'documents', state: 'done', blocked_reason: 'Ancienne attente' };
  assert.equal(workSituation(done), 'Terminé');
  assert.deepEqual(dossierFollowingWork([done], 'exp', 'preparation'), []);
  assert.equal(workSituation({ state: 'in_progress', blocked_reason: 'Accord client attendu' }), 'Accord client attendu');
});
