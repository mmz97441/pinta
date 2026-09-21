import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWorkDraft, pendingWorkDrafts, clearWorkDrafts } from './workDrafts.js';

test('local draft guards are isolated by operator, dossier, task and editor', () => {
  clearWorkDrafts();
  registerWorkDraft('alice', 'parcel', 'documents', 'invoice-review', true, 'Factures non enregistrées');
  registerWorkDraft('alice', 'parcel', 'documents', 'manual-article', true, 'Article non enregistré');
  registerWorkDraft('alice', 'parcel', 'preparation', 'measurements', true, 'Mesures non enregistrées');
  registerWorkDraft('bob', 'parcel', 'documents', 'invoice-review', true, 'Factures de Bob');
  registerWorkDraft('alice', 'other', 'documents', 'invoice-review', true, 'Autre dossier');
  assert.deepEqual(pendingWorkDrafts('alice', 'parcel', 'documents').map(item => item.source), ['invoice-review', 'manual-article']);
  assert.equal(pendingWorkDrafts('alice', 'parcel', 'preparation').length, 1);
  assert.equal(pendingWorkDrafts('alice', 'parcel').length, 3);
  assert.equal(pendingWorkDrafts('bob', 'parcel', 'documents')[0].label, 'Factures de Bob');
  assert.equal(pendingWorkDrafts('alice', 'other').length, 1);
  assert.equal(pendingWorkDrafts('unknown', 'parcel').length, 0);
});

test('saving or discarding one editor leaves independent unsaved work protected', () => {
  clearWorkDrafts();
  registerWorkDraft('alice', 'parcel', 'documents', 'invoice-review', true, 'Factures');
  registerWorkDraft('alice', 'parcel', 'documents', 'manual-article', true, 'Article');
  registerWorkDraft('alice', 'parcel', 'documents', 'invoice-review', false);
  assert.deepEqual(pendingWorkDrafts('alice', 'parcel').map(item => item.source), ['manual-article']);
  registerWorkDraft('alice', 'parcel', 'documents', 'manual-article', false);
  assert.deepEqual(pendingWorkDrafts('alice', 'parcel'), []);
});

test('repeated renders replace registration without duplication or exposing mutable entries', () => {
  clearWorkDrafts();
  registerWorkDraft('alice', 'parcel', 'quote', 'customs', true, 'Douane');
  registerWorkDraft('alice', 'parcel', 'quote', 'customs', true, 'Classement douanier');
  const entries = pendingWorkDrafts('alice', 'parcel');
  assert.equal(entries.length, 1);
  entries[0].userId = 'bob'; entries[0].label = 'Corrompu';
  assert.equal(pendingWorkDrafts('alice', 'parcel')[0].label, 'Classement douanier');
  assert.deepEqual(pendingWorkDrafts('bob', 'parcel'), []);
});

test('incomplete identities never register a draft and encoded tuple keys cannot collide', () => {
  clearWorkDrafts();
  for (const identity of [[undefined, 'p', 'documents', 'a'], ['u', '', 'documents', 'a'], ['u', 'p', null, 'a'], ['u', 'p', 'documents', '']]) registerWorkDraft(...identity, true, 'Invalid');
  assert.deepEqual(pendingWorkDrafts('u', 'p'), []);
  assert.deepEqual(pendingWorkDrafts(undefined, 'p'), []);
  registerWorkDraft('u:a', 'p', 'documents', 'a', true, 'First');
  registerWorkDraft('u', 'a:p', 'documents', 'a', true, 'Second');
  assert.equal(pendingWorkDrafts('u:a', 'p')[0].label, 'First');
  assert.equal(pendingWorkDrafts('u', 'a:p')[0].label, 'Second');
});

test('logout can clear one operator or all local guard registrations', () => {
  clearWorkDrafts();
  registerWorkDraft('alice', 'parcel', 'documents', 'invoice', true, 'Alice');
  registerWorkDraft('bob', 'parcel', 'documents', 'invoice', true, 'Bob');
  clearWorkDrafts('alice');
  assert.deepEqual(pendingWorkDrafts('alice', 'parcel'), []);
  assert.equal(pendingWorkDrafts('bob', 'parcel').length, 1);
  clearWorkDrafts();
  assert.deepEqual(pendingWorkDrafts('bob', 'parcel'), []);
});
