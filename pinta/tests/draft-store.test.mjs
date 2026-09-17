import test from 'node:test';
import assert from 'node:assert/strict';
import { draftKey, readDraft, writeDraft, removeDraft, clearDrafts } from '../src/expedile/lib/draftStore.js';
const mockStorage = () => {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k), key: i => [...values.keys()][i], get length() { return values.size; } };
};
test('drafts stay isolated between accounts and dossiers; only the sent draft is removed', () => {
  const storage = mockStorage(); clearDrafts(storage);
  const a = draftKey('alice', 'chat:EXP-A'), b = draftKey('bob', 'chat:EXP-A'), c = draftKey('alice', 'chat:EXP-B');
  writeDraft(a, 'Deux lignes\nÀ garder', storage); writeDraft(c, 'Autre dossier', storage);
  assert.equal(readDraft(b, '', storage), '');
  removeDraft(c, storage);
  assert.equal(readDraft(a, '', storage), 'Deux lignes\nÀ garder');
  assert.equal(readDraft(c, '', storage), '');
  storage.setItem('unrelated', 'keep'); clearDrafts(storage);
  assert.equal(readDraft(a, '', storage), ''); assert.equal(storage.getItem('unrelated'), 'keep');
});
test('unavailable storage keeps drafts during navigation and reports the limitation', () => {
  clearDrafts(null); const key = draftKey('alice', 'chat:A');
  const blocked = { setItem() { throw new Error('quota'); } };
  assert.equal(writeDraft(key, 'Important', blocked), false);
  assert.equal(readDraft(key, '', blocked), 'Important');
  removeDraft(key, blocked); assert.equal(readDraft(key, '', blocked), '');
  assert.equal(draftKey(null, 'chat:A'), null);
});
