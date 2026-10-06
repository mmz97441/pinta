import test from 'node:test';
import assert from 'node:assert/strict';
import { plural, pluralWord } from './plural.js';

test('0 and 1 take the singular, 2 and more the plural', () => {
  assert.equal(plural(0, 'carton'), '0 carton');
  assert.equal(plural(1, 'dossier'), '1 dossier');
  assert.equal(plural(2, 'dossier'), '2 dossiers');
  assert.equal(pluralWord(1, 'facture vérifiée', 'factures vérifiées'), 'facture vérifiée');
  assert.equal(pluralWord(3, 'facture vérifiée', 'factures vérifiées'), 'factures vérifiées');
});

test('irregular forms and large counts read in French', () => {
  assert.equal(plural(2, 'colis', 'colis'), '2 colis');
  assert.equal(plural(1234, 'carton').replace(/\s/gu, ' '), '1 234 cartons');
  assert.equal(plural(undefined, 'article'), '0 article');
});
