/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupDossiersByClient, clientGroupTitle, clientGroupDistinction, CLIENT_GROUP_PREFIX, UNKNOWN_CLIENT_GROUP_KEY } from './clientGroups.js';

// mapClient: `nom` is « Payet Flavie », `nomFamille` the family name.
const CLIENTS = {
  payet: { id: 'payet', nom: 'Payet Flavie', nomFamille: 'Payet', prenom: 'Flavie' },
  hoarau: { id: 'hoarau', nom: 'Hoarau Lucas', nomFamille: 'Hoarau', prenom: 'Lucas' },
  lagon: { id: 'lagon', nom: 'Lagon Services', nomFamille: 'Lagon Services', prenom: '' },
  adam: { id: 'adam', nom: 'Adam Zoé', nomFamille: 'Adam', prenom: 'Zoé' },
};
const getClient = id => CLIENTS[id];
const dossier = (id, clientId, receivedAt) => ({ id, clientId, receivedAt });
const receivedAt = item => item.receivedAt;
const shape = groups => groups.map(group => ({ key: group.key, title: group.title, dossiers: group.dossiers.map(item => item.id) }));

test('one band per client, the client whose oldest dossier arrived first leading', () => {
  const dossiers = [
    dossier('h1', 'hoarau', '2026-09-20T08:00:00Z'), dossier('p1', 'payet', '2026-09-25T08:00:00Z'),
    dossier('l1', 'lagon', '2026-09-22T08:00:00Z'), dossier('p2', 'payet', '2026-09-11T08:00:00Z'),
    dossier('h2', 'hoarau', '2026-09-14T08:00:00Z'), dossier('p3', 'payet', null),
  ];
  assert.deepEqual(shape(groupDossiersByClient(dossiers, { getClient, receivedAt })), [
    { key: 'client:payet', title: 'Flavie Payet', dossiers: ['p1', 'p2', 'p3'] },
    { key: 'client:hoarau', title: 'Lucas Hoarau', dossiers: ['h1', 'h2'] },
    { key: 'client:lagon', title: 'Lagon Services', dossiers: ['l1'] },
  ], 'Each band keeps the incoming (sorted) order of its dossiers.');
  assert.equal(groupDossiersByClient(dossiers, { getClient, receivedAt })[0].client, CLIENTS.payet);
  assert.equal(CLIENT_GROUP_PREFIX, 'client:');
});

test('bands without a known reception follow the dated ones, ties go by name then key', () => {
  const groups = groupDossiersByClient([
    dossier('a1', 'adam', null), dossier('h1', 'hoarau', 'pas une date'), dossier('p1', 'payet', '2026-09-30T08:00:00Z'),
    dossier('l1', 'lagon', '2026-09-30T08:00:00Z'),
  ], { getClient, receivedAt });
  // « Flavie Payet » before « Lagon Services » on the same day; « Lucas Hoarau » before « Zoé Adam » without a date.
  assert.deepEqual(groups.map(group => group.key), ['client:payet', 'client:lagon', 'client:hoarau', 'client:adam']);
  assert.deepEqual(shape(groupDossiersByClient([dossier('x', 'payet', '2026-09-01T08:00:00Z')], { getClient })), [{ key: 'client:payet', title: 'Flavie Payet', dossiers: ['x'] }], 'Without dates, the order is by name.');
});

test('a dossier without a client, or a client the person cannot read, never joins another band', () => {
  const groups = groupDossiersByClient([dossier('n1', null, '2026-09-01T08:00:00Z'), dossier('u1', 'unreadable', '2026-09-02T08:00:00Z'), dossier('n2', undefined, null), dossier('p1', 'payet', '2026-09-03T08:00:00Z')], { getClient, receivedAt });
  assert.deepEqual(shape(groups), [
    { key: UNKNOWN_CLIENT_GROUP_KEY, title: 'Client non renseigné', dossiers: ['n1', 'n2'] },
    { key: 'client:unreadable', title: 'Client non renseigné', dossiers: ['u1'] },
    { key: 'client:payet', title: 'Flavie Payet', dossiers: ['p1'] },
  ]);
  assert.equal(groups[0].client, null);assert.equal(groups[1].client, null);
  assert.deepEqual(groupDossiersByClient(), []);assert.deepEqual(groupDossiersByClient(null), []);
});

test('two clients with the same name get their reference as the bands’ secondary text', () => {
  const twins = {
    ...CLIENTS,
    marie1: { id: 'marie1', ref: 'CLI-0012', nom: 'Payet Marie', nomFamille: 'Payet', prenom: 'Marie', ville: 'Saint-Denis' },
    marie2: { id: 'marie2', ref: 'CLI-0458', nom: 'Payet Marie', nomFamille: 'Payet', prenom: 'Marie', ville: 'Saint-Pierre' },
    marie3: { id: 'marie3', ref: null, nom: 'Payet Marie', nomFamille: 'Payet', prenom: 'Marie', ville: ' Le Port ' },
  };
  const groups = groupDossiersByClient([dossier('m1', 'marie1', '2026-09-10T08:00:00Z'), dossier('p1', 'payet', '2026-09-11T08:00:00Z'), dossier('m2', 'marie2', '2026-09-12T08:00:00Z'), dossier('m3', 'marie3', '2026-09-13T08:00:00Z')],
    { getClient: id => twins[id], receivedAt });
  assert.deepEqual(groups.map(group => [group.key, group.title, group.ref]), [
    ['client:marie1', 'Marie Payet', 'CLI-0012'], ['client:payet', 'Flavie Payet', null], ['client:marie2', 'Marie Payet', 'CLI-0458'], ['client:marie3', 'Marie Payet', 'Le Port'],
  ], 'Only the bands whose titles repeat carry a reference; without one, the town.');
  assert.equal(clientGroupDistinction({ email: 'marie@example.test' }), 'marie@example.test');
  assert.equal(clientGroupDistinction({ commune: 'Cilaos' }), 'Cilaos');
  assert.equal(clientGroupDistinction(null), null);
  // Unknown and unreadable clients have nothing to show.
  assert.deepEqual(groupDossiersByClient([dossier('n1', null, null), dossier('u1', 'unreadable', null)], { getClient: () => undefined }).map(group => group.ref), [null, null]);
});

test('the band title addresses the client by first name then family name', () => {
  assert.equal(clientGroupTitle(CLIENTS.payet), 'Flavie Payet');
  assert.equal(clientGroupTitle({ nom: 'Grondin Paul' }), 'Grondin Paul', 'A record without its parts keeps its name.');
  assert.equal(clientGroupTitle({ prenom: 'Nadia' }), 'Nadia');
  for (const unknown of [null, undefined, {}, { nom: '  ' }]) assert.equal(clientGroupTitle(unknown), 'Client non renseigné');
});

test('grouping is pure: the dossiers and the input order are untouched', () => {
  const dossiers = Object.freeze([Object.freeze(dossier('p1', 'payet', '2026-09-25T08:00:00Z')), Object.freeze(dossier('h1', 'hoarau', '2026-09-20T08:00:00Z'))]);
  const groups = groupDossiersByClient(dossiers, { getClient, receivedAt });
  assert.equal(groups[1].dossiers[0], dossiers[0]);
  assert.deepEqual(dossiers.map(item => item.id), ['p1', 'h1']);
});
