import test from 'node:test';
import assert from 'node:assert/strict';
import { newClientErrors, newClientFieldErrors, PHONE_FORMAT_MESSAGE } from './clientRequirements.js';
import { firstNewClientField, newClientAlert } from './receptionClient.js';

const EMPTY = { nom: 'Martin', prenom: '', tel: '', telFixe: '', email: '', adresseLigne1: '', cp: '97400', ville: '' };

test('the alert next to the actions names every field to complete, in form order', () => {
  assert.equal(newClientAlert(newClientFieldErrors(EMPTY)), 'Fiche client incomplète : il manque le prénom, le téléphone, l’email, l’adresse et la ville.');
  assert.equal(newClientAlert(newClientFieldErrors({ ...EMPTY, prenom: 'Luc', email: 'luc@example.test', ville: 'Saint-Pierre' })), 'Fiche client incomplète : il manque le téléphone et l’adresse.');
  // A typed value in the wrong format is to correct, not missing.
  const complete = { ...EMPTY, prenom: 'Luc', tel: '0692 12 34 56', email: 'luc@example.test', adresseLigne1: '1 rue des Lilas', ville: 'Saint-Pierre' };
  assert.equal(newClientAlert(newClientFieldErrors({ ...complete, email: 'luc@' })), 'Fiche client à corriger : l’email est à corriger.');
  assert.equal(newClientAlert(newClientFieldErrors({ ...complete, email: 'luc@', cp: '75001' })), 'Fiche client à corriger : l’email et le code postal sont à corriger.');
  assert.equal(newClientAlert(newClientFieldErrors({ ...complete, prenom: '', tel: '0692' })), 'Fiche client incomplète : il manque le prénom ; le téléphone est à corriger.');
  assert.equal(newClientAlert({ raisonSociale: 'Raison sociale requise pour un pro' }), 'Fiche client incomplète : il manque la raison sociale.');
  assert.equal(newClientAlert(newClientFieldErrors(complete)), '');
  assert.equal(newClientAlert({}), '');
  // The older rule's errors (one « tel » key) still read the same.
  assert.equal(newClientAlert(newClientErrors({ ...EMPTY, prenom: 'Luc', email: 'luc@example.test', ville: 'Saint-Pierre' })), 'Fiche client incomplète : il manque le téléphone et l’adresse.');
});

test('each number typed is checked under its own field: a valid mobile never covers an invalid landline', () => {
  const complete = { ...EMPTY, prenom: 'Luc', tel: '0692 12 34 56', email: 'luc@example.test', adresseLigne1: '1 rue des Lilas', ville: 'Saint-Pierre' };
  // Created at reception, this landline would then block every save of the client's own profile.
  assert.deepEqual(newClientFieldErrors({ ...complete, telFixe: '-' }), { telFixe: PHONE_FORMAT_MESSAGE });
  assert.equal(newClientAlert(newClientFieldErrors({ ...complete, telFixe: '-' })), 'Fiche client à corriger : le téléphone fixe est à corriger.');
  // An invalid mobile beside a valid landline is refused too, under the mobile.
  assert.deepEqual(newClientFieldErrors({ ...complete, tel: '0692', telFixe: '0262 41 22 34' }), { tel: PHONE_FORMAT_MESSAGE });
  assert.equal(newClientAlert(newClientFieldErrors({ ...complete, tel: '0692 12', telFixe: '0262' })), 'Fiche client à corriger : le téléphone et le téléphone fixe sont à corriger.');
  // A valid landline alone, or both valid: nothing to correct.
  assert.deepEqual(newClientFieldErrors({ ...complete, tel: '', telFixe: '0262 41 22 34' }), {});
  assert.deepEqual(newClientFieldErrors({ ...complete, telFixe: '(0262) 41-22-34' }), {});
});

test('the first refused field takes the focus, the phone error under the number typed', () => {
  assert.equal(firstNewClientField(newClientFieldErrors(EMPTY)), 'prenom');
  const onlyLandline = { ...EMPTY, prenom: 'Luc', telFixe: '01 23' };
  assert.deepEqual(newClientFieldErrors(onlyLandline).tel, undefined, 'Only the landline typed: the empty mobile is not refused.');
  assert.equal(firstNewClientField(newClientFieldErrors(onlyLandline)), 'telFixe', 'Only the landline typed: its own field is refused.');
  assert.equal(firstNewClientField(newClientFieldErrors({ ...onlyLandline, telFixe: '' })), 'tel', 'Neither phone: under the mobile, the first one.');
  assert.equal(firstNewClientField(newClientFieldErrors({ ...onlyLandline, tel: '0692 12 34 56', telFixe: '-' })), 'telFixe');
  assert.equal(firstNewClientField({ raisonSociale: 'Raison sociale requise pour un pro', email: 'x' }), 'raisonSociale');
  assert.equal(firstNewClientField({}), null);
});
