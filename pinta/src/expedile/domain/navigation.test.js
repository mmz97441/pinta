import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceReturnPath } from './navigation.js';

const back = (returnTo, fallback) => workspaceReturnPath(`?${new URLSearchParams({ returnTo })}`, fallback);

test('the workspace lists stay valid ways back, with or without their parameters', () => {
  for (const path of ['/', '/?onglet=a_payer&classer=depart&q=payet', '/colis', '/colis?vue=accords', '/conversations', '/equipe', '/travail', '/travail?section=waiting'])
    assert.equal(back(path), path);
});

test('a Brouillon sheet, the reception and the arrival notices are ways back too', () => {
  for (const path of ['/brouillon/0b6a3c1e-5f2d-4c8e-9a1b-2c3d4e5f6a7b', '/brouillon/dossier_1?returnTo=%2F%3Fonglet%3Dbrouillon',
    '/recevoir', '/recevoir?client=c1&valider=1', '/recevoir?dossier=d1', '/avis', '/avis?client=c1'])
    assert.equal(back(path), path);
});

test('nothing else is accepted: the fallback replaces it', () => {
  for (const path of ['https://evil.example/brouillon/1', '//evil.example', '///evil.example', '/\\evil.example', 'javascript:alert(1)',
    'brouillon/1', '/brouillon', '/brouillon/', '/brouillon/1/2', '/brouillon/..', '/brouillon/%2F%2Fevil', '/brouillon/1#x', '/brouillons/1',
    '/recevoirx', '/recevoir/1', '/avis/', '/avisx', '/avis#x', '/reception', '/colis/123', '/clients', '/settings', ' /avis'])
    assert.equal(back(path, '/'), '/', path);
  assert.equal(workspaceReturnPath(''), '/colis', 'Without a way back: the default fallback.');
  assert.equal(workspaceReturnPath('?returnTo='), '/colis');
});
