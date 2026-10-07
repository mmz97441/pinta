import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_CLIENT_KEYS, COMPLETION_FIELDS, newClientErrors, requiredFieldFormatError, missingRequiredFields, importRowIssue, servedDestination, blankingMessage, missingMessage, phoneOf, validPhone, dialablePhone, phoneErrors, refusedClientFields, requiredFieldsPhrase, PHONE_FORMAT_MESSAGE } from './clientRequirements.js';

const complete = { prenom: 'Flavie', nom: 'Payet', email: 'flavie@example.test', tel: '0692 44 55 66', adresseLigne1: '12 rue de Paris', cp: '97400', ville: 'Saint-Denis' };

test('the seven required fields and their completion links', () => {
  assert.deepEqual(REQUIRED_CLIENT_KEYS, ['prenom', 'nom', 'email', 'tel', 'adresseLigne1', 'cp', 'ville']);
  assert.deepEqual({ ...COMPLETION_FIELDS }, { prenom: 'prenom', nom: 'nom', email: 'email', telephone: 'tel', adresse: 'adresseLigne1', cp: 'cp', ville: 'ville' });
});

test('a new client needs every required field, each one named', () => {
  assert.deepEqual(newClientErrors(complete), {});
  for (const key of REQUIRED_CLIENT_KEYS) {
    const errors = newClientErrors({ ...complete, [key]: '   ' });
    assert.deepEqual(Object.keys(errors), [key], key);
    assert.equal(errors[key], missingMessage(key));
  }
  assert.equal(missingMessage('adresseLigne1'), 'L’adresse est obligatoire.');
  assert.equal(missingMessage('tel'), 'Le téléphone est obligatoire.');
  assert.deepEqual(Object.keys(newClientErrors({})), REQUIRED_CLIENT_KEYS);
});

test('formats: email, a phone of at least 9 digits, a served five-digit postal code', () => {
  assert.equal(requiredFieldFormatError('email', 'pas-un-email'), 'Indiquez un email valide.');
  assert.equal(requiredFieldFormatError('email', 'camille@example.test'), '');
  for (const phone of ['0692445566', '0692 44 55 66', '0692.44.55.66', '0692-44-55-66', '+262 692 44 55 66', '+33612345678']) assert.equal(requiredFieldFormatError('tel', phone), '', phone);
  for (const phone of ['0692 44 55', '+262', 'appeler le soir', '0692/44/55/66', '06 92 44 55 6a', '262+692445566']) assert.match(requiredFieldFormatError('tel', phone), /au moins 9 chiffres/, phone);
  for (const cp of ['97400', '97600', '97110', '97200', ' 97410 ']) assert.equal(requiredFieldFormatError('cp', cp), '', cp);
  assert.match(requiredFieldFormatError('cp', '75011'), /pas une destination desservie : Guadeloupe \(971\), Martinique \(972\), La Réunion \(974\) et Mayotte \(976\)\./);
  assert.match(requiredFieldFormatError('cp', '97300'), /pas une destination desservie/, 'Guyane is not served.');
  assert.equal(requiredFieldFormatError('cp', '9740'), 'Indiquez un code postal à 5 chiffres.');
  assert.equal(servedDestination('97600')?.code, '976');
  assert.equal(servedDestination('97500'), null);
});

test('an older record may still miss fields; a filled one cannot be emptied', () => {
  assert.deepEqual(missingRequiredFields({ ...complete, email: null, tel: '', adresseLigne1: '' }), ['email', 'tel', 'adresseLigne1']);
  assert.deepEqual(missingRequiredFields({ ...complete, adresseLigne1: '', adresse: '3 rue ancienne' }), [], 'The former address column counts.');
  assert.equal(blankingMessage('prenom'), 'Le prénom est obligatoire : il ne peut pas être effacé.');
  assert.equal(blankingMessage('ville'), 'La ville est obligatoire : elle ne peut pas être effacée.');
});

test('an imported row is refused with its reason in French', () => {
  assert.equal(importRowIssue(complete), '');
  assert.equal(importRowIssue({ ...complete, tel: '' }), 'téléphone manquant');
  assert.equal(importRowIssue({ ...complete, ville: '' }), 'ville manquante');
  assert.equal(importRowIssue({ ...complete, adresseLigne1: '', ville: '' }), 'adresse et ville manquantes');
  assert.equal(importRowIssue({ ...complete, prenom: '', tel: '', ville: '' }), 'prénom, téléphone et ville manquants');
  assert.equal(importRowIssue({ ...complete, email: 'invalide' }), 'email invalide');
  assert.equal(importRowIssue({ ...complete, cp: '75011' }), 'code postal non desservi');
  assert.equal(importRowIssue({ ...complete, cp: '974' }), 'code postal invalide');
  assert.equal(importRowIssue({ ...complete, tel: '', email: 'x' }), 'téléphone manquant, email invalide');
});

test('the phone format is the database one: parentheses accepted, a no-break space or an inner + refused', () => {
  for (const phone of ['(0262) 41-22-33', '0262 (41) 22 33', ' 0692 44 55 66 ', '+262 (0)692 44 55 66']) assert.equal(validPhone(phone), true, phone);
  for (const phone of ['0692\u00a044\u00a055\u00a066', '0692\t445566', '0692 44 55 66+', '+262+692445566', '0692 44 55', '']) assert.equal(validPhone(phone), false, JSON.stringify(phone));
  assert.equal(requiredFieldFormatError('tel', '(0262) 41-22-33'), '');
  assert.equal(requiredFieldFormatError('telFixe', '0262 41'), PHONE_FORMAT_MESSAGE);
  assert.match(PHONE_FORMAT_MESSAGE, /parenthèses/);
  assert.equal(dialablePhone('+262 692 44 55 66'), '+262692445566');
  assert.equal(dialablePhone('(0262) 41-22-33'), '0262412233');
  assert.equal(dialablePhone('appeler le soir'), '');
});

test('a mobile or a landline satisfies the phone requirement, everywhere', () => {
  const landline = { ...complete, tel: null, telFixe: '0262 00 00 01' };
  assert.equal(phoneOf(landline), '0262 00 00 01');
  assert.deepEqual(missingRequiredFields(landline), [], 'a landline-only record is complete');
  assert.deepEqual(newClientErrors({ ...complete, tel: '', telFixe: '0262 00 00 01' }), {});
  assert.equal(importRowIssue({ ...complete, tel: '', telFixe: '0262 00 00 01' }), '');
  assert.deepEqual(phoneErrors({ tel: '', telFixe: '0262 00 00 01' }), {});
  assert.deepEqual(phoneErrors({ tel: '0692 44 55 66', telFixe: '' }), {});
  assert.deepEqual(phoneErrors({ tel: ' ', telFixe: null }), { tel: 'Le téléphone est obligatoire.' });
  assert.deepEqual(phoneErrors({ tel: '0692 12', telFixe: '0262' }), { tel: PHONE_FORMAT_MESSAGE, telFixe: PHONE_FORMAT_MESSAGE }, 'each number entered is checked');
  assert.deepEqual(phoneErrors({}, { missing: 'Indiquez un téléphone.', invalid: 'Numéro incomplet.' }), { tel: 'Indiquez un téléphone.' });
  assert.deepEqual(phoneErrors({ telFixe: '12' }, { invalid: 'Numéro incomplet.' }), { telFixe: 'Numéro incomplet.' });
});

test('a refusal of the database names its fields: by its hint, else by its French words', () => {
  assert.deepEqual(refusedClientFields({ code: '23514', message: 'Fiche client incomplète : il manque la ville.', hint: 'client_required_fields:ville' }), ['ville']);
  assert.deepEqual(refusedClientFields({ hint: 'client_required_fields:prenom,tel,adresse,cp' }), ['prenom', 'tel', 'adresseLigne1', 'cp']);
  assert.deepEqual(refusedClientFields({ message: 'Fiche client incomplète : il manque le prénom et la ville.' }), ['prenom', 'ville']);
  assert.deepEqual(refusedClientFields({ message: 'Le nom est obligatoire pour un compte client : il ne peut pas être effacé.' }), ['nom']);
  assert.deepEqual(refusedClientFields({ message: 'Email invalide : il doit être de la forme nom@domaine.fr.' }), ['email'], 'the example address names no field');
  assert.deepEqual(refusedClientFields({ message: 'Téléphone invalide : renseignez un mobile ou un fixe d’au moins 9 chiffres.' }), ['tel']);
  assert.deepEqual(refusedClientFields({ message: 'Service indisponible' }), []);
  assert.deepEqual(refusedClientFields(null), []);
  assert.equal(requiredFieldsPhrase(['prenom', 'adresseLigne1', 'ville']), 'le prénom, l’adresse et la ville');
  assert.equal(requiredFieldsPhrase(['tel']), 'le téléphone');
});
