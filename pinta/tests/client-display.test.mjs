import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { normalizeTelegramUsername, formatTelegramHandle, clientContactLabel, clientSearchText, countLabel } from '../src/expedile/utils/clientDisplay.js';

/** utils/index.js imports a directory module: bundle it as the application does. */
async function utils() {
  const result = await build({ entryPoints: ['src/expedile/utils/index.js'], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' });
  const context = { module: { exports: {} }, exports: {}, console, Intl, Date };
  vm.runInNewContext(result.outputFiles[0].text, context);
  return context.module.exports;
}

const payet = { id: 'c3', ref: 'CLI-0003', nom: 'Payet Flavie', prenom: 'Flavie', email: 'flavie@example.test', tel: '0692 44 55 66', cp: '97600', ville: 'Mamoudzou', type: 'particulier', telegramUsername: 'flaviep' };
const hoarau = { id: 'c4', ref: 'CLI-0004', nom: 'Hoarau Jean-Marc', prenom: 'Jean-Marc', email: null, tel: null, cp: '97200', ville: 'Fort-de-France', type: 'particulier', telegramUsername: '@jmhoarau' };
const grondin = { id: 'c5', ref: 'CLI-0005', nom: 'Grondin Marie-Christine', email: 'mc.grondin@example.test', tel: '0690 00 00 00', cp: '97110', ville: 'Pointe-à-Pitre', type: 'particulier', telegramUsername: null };

test('a Telegram username is stored trimmed and without its leading @', () => {
  assert.equal(normalizeTelegramUsername('  @flaviep '), 'flaviep');
  assert.equal(normalizeTelegramUsername('@@flaviep'), 'flaviep');
  assert.equal(normalizeTelegramUsername('flaviep'), 'flaviep');
  assert.equal(normalizeTelegramUsername('  @  '), '');
  assert.equal(normalizeTelegramUsername(null), '');
  assert.equal(normalizeTelegramUsername(undefined), '');
  assert.equal(normalizeTelegramUsername('flavie@p'), 'flavie@p', 'Only the leading @ is a prefix.');
});

test('a Telegram username is displayed with exactly one @, never an empty handle', () => {
  assert.equal(formatTelegramHandle('flaviep'), '@flaviep');
  assert.equal(formatTelegramHandle('@flaviep'), '@flaviep');
  assert.equal(formatTelegramHandle(' @@flaviep '), '@flaviep');
  assert.equal(formatTelegramHandle(''), '');
  assert.equal(formatTelegramHandle('@'), '');
  assert.equal(formatTelegramHandle(null), '');
});

test('the contact shown for a client: email, then phone, then « @identifiant », otherwise nothing', () => {
  assert.equal(clientContactLabel(payet), 'flavie@example.test');
  assert.equal(clientContactLabel({ ...payet, email: '' }), '0692 44 55 66');
  assert.equal(clientContactLabel({ ...payet, email: '  ', tel: null }), '@flaviep');
  assert.equal(clientContactLabel(hoarau), '@jmhoarau', 'A Telegram-only client shows its handle, not « Contact à compléter ».');
  assert.equal(clientContactLabel({ ...hoarau, telegramUsername: '' }), '', 'The caller words the missing contact.');
  assert.equal(clientContactLabel(null), '');
  // An imported row (strings everywhere, maybe with @) reads the same way.
  assert.equal(clientContactLabel({ email: '', tel: '', telegramUsername: '@import_row' }), '@import_row');
});

test('the searched text includes the client reference and the Telegram username with and without @', () => {
  const text = clientSearchText(hoarau);
  assert.match(text, /CLI-0004/);
  assert.match(text, /(^| )jmhoarau( |$)/);
  assert.match(text, /@jmhoarau/);
  assert.doesNotMatch(clientSearchText(grondin), /(^| )@/, 'No handle without a Telegram username.');
  assert.equal(clientSearchText(null), '');
});

test('searchClients matches the reference and the Telegram username, with or without @', async () => {
  const { searchClients } = await utils();
  const clients = [payet, hoarau, grondin];
  const ids = query => Array.from(searchClients(clients, query), client => client.id);
  assert.deepEqual(ids('CLI-0004'), ['c4']);
  assert.deepEqual(ids('cli-0005'), ['c5'], 'Case does not matter.');
  assert.deepEqual(ids('jmhoarau'), ['c4']);
  assert.deepEqual(ids('@jmhoarau'), ['c4'], 'A stored « @jmhoarau » matches with the @.');
  assert.deepEqual(ids('@flaviep'), ['c3'], 'A stored « flaviep » matches with the @.');
  assert.deepEqual(ids('flaviep'), ['c3']);
  // The former fields still match.
  assert.deepEqual(ids('Grondin'), ['c5']);
  assert.deepEqual(ids('pointe a pitre'), ['c5'], 'Accents are ignored.');
  assert.deepEqual(ids('0692 44'), ['c3']);
  assert.deepEqual(ids('mc.grondin@'), ['c5']);
  assert.deepEqual(ids(''), ['c3', 'c4', 'c5']);
  assert.deepEqual(ids('inconnu'), []);
});

test('French counts: singular below two, plural from two', () => {
  assert.equal(countLabel(0, 'dossier', 'dossiers'), '0 dossier');
  assert.equal(countLabel(1, 'dossier actif', 'dossiers actifs'), '1 dossier actif');
  assert.equal(countLabel(2, 'dossier actif', 'dossiers actifs'), '2 dossiers actifs');
  assert.equal(countLabel(24, 'ligne valide', 'lignes valides'), '24 lignes valides');
  assert.equal(countLabel(undefined, 'client', 'clients'), '0 client');
});
