import test from 'node:test';
import assert from 'node:assert/strict';
import { shellLoadBanner, staffDataState } from './dataLoad.js';

test('a failed first load is a failure; a failed refresh keeps the loaded data', () => {
  assert.deepEqual(staffDataState({ sbReady: false, dataLoading: false, dataError: 'Chargement impossible : Indisponibilité simulée', hasData: false }), { state: 'failed', reason: 'Chargement impossible : Indisponibilité simulée' });
  // The reconciliation failed after a successful load: the dossiers stay on screen.
  assert.deepEqual(staffDataState({ sbReady: true, dataError: 'Actualisation des dossiers impossible : réseau', hasData: true }), { state: 'stale', reason: 'Actualisation des dossiers impossible : réseau' });
  // Loaded but empty (no dossier yet), then a refresh failed: still the empty list, with the banner.
  assert.equal(staffDataState({ sbReady: true, dataError: 'Actualisation des dossiers impossible : réseau', hasData: false }).state, 'stale');
  // A retry failed after an earlier success: the earlier data stay readable.
  assert.equal(staffDataState({ sbReady: false, dataError: 'Chargement impossible : réseau', hasData: true }).state, 'stale');
  // Not ready, nothing held and no message: the interrupted connection is the reason.
  assert.deepEqual(staffDataState({ sbReady: false, hasData: false }), { state: 'failed', reason: 'Connexion aux données interrompue.' });
  assert.deepEqual(staffDataState({ sbReady: true, hasData: true }), { state: 'ready', reason: '' });
  assert.equal(staffDataState({ dataLoading: true, dataError: 'ancien message' }).state, 'loading');
});

test('the shell banner never repeats a failure the page states itself', () => {
  for (const path of ['/', '/colis', '/departs', '/conversations', '/equipe', '/settings', '/clients', '/clients/new', '/clients/abc'])
    assert.equal(shellLoadBanner(path, 'failed'), false, path);
  for (const path of ['/colis/abc', '/devis', '/reception', '/plus']) assert.equal(shellLoadBanner(path, 'failed'), true, path);
  // Loaded data kept after a failed refresh: the banner gives the reason everywhere, Mon travail included.
  for (const path of ['/', '/colis', '/departs', '/colis/abc']) assert.equal(shellLoadBanner(path, 'stale'), true, path);
  for (const state of ['ready', 'loading']) assert.equal(shellLoadBanner('/devis', state), false, state);
});
