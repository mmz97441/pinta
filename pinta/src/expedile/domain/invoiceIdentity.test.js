import test from 'node:test';
import assert from 'node:assert/strict';
import { consigneeFor, invoiceIdentity, missingPartyFields, partyLines, validateInvoiceIdentity } from './invoiceIdentity.js';

const exporter = { nom: 'Expedîle', adresse: '12 rue des Entrepôts', codePostal: '93290', ville: 'Tremblay-en-France', pays: 'France', email: 'contact@expedile.fr', siret: '123 456 789 00012', eori: 'fr12345678900012' };
const reunion = { nom: 'Transit Océan Indien', adresse: '5 rue du Port', codePostal: '97420', ville: 'Le Port', pays: 'La Réunion (France)' };
const fallback = { nom: 'Expedîle Outre-mer', adresse: '1 avenue de la Mer', codePostal: '97400', ville: 'Saint-Denis', pays: 'France (DOM)' };

test('the exporter is Expedîle by default, the consignee follows the destination, then the default one', () => {
  const empty = invoiceIdentity({});
  assert.equal(empty.expediteur.nom, 'Expedîle');
  assert.equal(consigneeFor(empty, '974'), null, 'Nothing configured: no consignee is invented.');
  const identity = invoiceIdentity({ factureCommerciale: { expediteur: exporter, destinataires: { defaut: fallback, 974: reunion } } });
  assert.equal(consigneeFor(identity, '974').nom, 'Transit Océan Indien');
  assert.equal(consigneeFor(identity, '974').source, 'destination');
  assert.equal(consigneeFor(identity, '976').nom, 'Expedîle Outre-mer');
  assert.equal(consigneeFor(identity, '976').source, 'defaut');
});

test('required fields and their absence are named in French', () => {
  assert.deepEqual(missingPartyFields(invoiceIdentity({}).expediteur), ['adresse', 'code postal', 'ville', 'pays']);
  assert.deepEqual(missingPartyFields(invoiceIdentity({ factureCommerciale: { expediteur: exporter } }).expediteur), []);
  assert.deepEqual(missingPartyFields(null), ['nom ou raison sociale', 'adresse', 'code postal', 'ville', 'pays']);
});

test('validation: a complete exporter, consignees empty or complete, valid email, SIRET and EORI', () => {
  const ok = validateInvoiceIdentity({ expediteur: exporter, destinataires: { defaut: fallback, 974: reunion, 976: {} } });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.expediteur.siret, '12345678900012');
  assert.equal(ok.value.expediteur.eori, 'FR12345678900012');
  assert.deepEqual(Object.keys(ok.value.destinataires).sort(), ['974', 'defaut'], 'An empty consignee is not stored.');
  const bad = validateInvoiceIdentity({ expediteur: { nom: '', adresse: '', email: 'contact', siret: '123' }, destinataires: { 971: { nom: 'Transit Antilles' } } });
  assert.equal(bad.value.expediteur.nom, 'Expedîle');
  assert.deepEqual(Object.keys(bad.errors).sort(), ['destinataires.971.adresse', 'destinataires.971.codePostal', 'destinataires.971.pays', 'destinataires.971.ville', 'expediteur.adresse', 'expediteur.codePostal', 'expediteur.email', 'expediteur.pays', 'expediteur.siret', 'expediteur.ville']);
});

test('a party is printed line by line, without empty lines', () => {
  assert.deepEqual(partyLines(invoiceIdentity({ factureCommerciale: { expediteur: exporter } }).expediteur), [
    'Expedîle', '12 rue des Entrepôts', '93290 Tremblay-en-France', 'France', 'contact@expedile.fr', 'SIRET 123 456 789 00012 · EORI fr12345678900012',
  ]);
  assert.deepEqual(partyLines(null), []);
});
