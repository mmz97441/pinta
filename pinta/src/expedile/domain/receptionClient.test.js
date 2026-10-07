import test from 'node:test';
import assert from 'node:assert/strict';
import { newClientErrors } from './clientRequirements.js';
import { firstNewClientField, newClientAlert, phoneErrorField } from './receptionClient.js';

const EMPTY = { nom: 'Martin', prenom: '', tel: '', telFixe: '', email: '', adresseLigne1: '', cp: '97400', ville: '' };

test('the alert next to the actions names every field to complete, in form order', () => {
  assert.equal(newClientAlert(newClientErrors(EMPTY)), 'Fiche client incomplète : il manque le prénom, le téléphone, l’email, l’adresse et la ville.');
  assert.equal(newClientAlert(newClientErrors({ ...EMPTY, prenom: 'Luc', email: 'luc@example.test', ville: 'Saint-Pierre' })), 'Fiche client incomplète : il manque le téléphone et l’adresse.');
  // A typed value in the wrong format is to correct, not missing.
  const complete = { ...EMPTY, prenom: 'Luc', tel: '0692 12 34 56', email: 'luc@example.test', adresseLigne1: '1 rue des Lilas', ville: 'Saint-Pierre' };
  assert.equal(newClientAlert(newClientErrors({ ...complete, email: 'luc@' })), 'Fiche client à corriger : l’email est à corriger.');
  assert.equal(newClientAlert(newClientErrors({ ...complete, email: 'luc@', cp: '75001' })), 'Fiche client à corriger : l’email et le code postal sont à corriger.');
  assert.equal(newClientAlert(newClientErrors({ ...complete, prenom: '', tel: '0692' })), 'Fiche client incomplète : il manque le prénom ; le téléphone est à corriger.');
  assert.equal(newClientAlert({ raisonSociale: 'Raison sociale requise pour un pro' }), 'Fiche client incomplète : il manque la raison sociale.');
  assert.equal(newClientAlert(newClientErrors(complete)), '');
  assert.equal(newClientAlert({}), '');
});

test('the phone error goes to the number typed, and the first refused field takes the focus', () => {
  assert.equal(phoneErrorField({ tel: '', telFixe: '' }), 'tel', 'Neither phone: under the mobile, the first one.');
  assert.equal(phoneErrorField({ tel: '0692', telFixe: '' }), 'tel');
  assert.equal(phoneErrorField({ tel: '', telFixe: '01 23' }), 'telFixe', 'Only the landline typed: its own field is refused.');
  assert.equal(phoneErrorField({ tel: '0692', telFixe: '01 23' }), 'tel', 'The mobile is the number checked when both are typed.');
  assert.equal(firstNewClientField(newClientErrors(EMPTY), EMPTY), 'prenom');
  const onlyLandline = { ...EMPTY, prenom: 'Luc', telFixe: '01 23' };
  assert.equal(firstNewClientField(newClientErrors(onlyLandline), onlyLandline), 'telFixe');
  assert.equal(firstNewClientField({ raisonSociale: 'Raison sociale requise pour un pro', email: 'x' }, {}), 'raisonSociale');
  assert.equal(firstNewClientField({}, {}), null);
});
