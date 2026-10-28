// Creating a client with a stable id (insertClient(client, { createId })): a creation whose answer was lost is recovered
// by its id, never duplicated; the id of another client is never reused (src/expedile/lib/supabaseData.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [new URL('../src/expedile/lib/supabaseData.js', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolated-storage', setup(builder) {
  builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase', namespace: 'test' }));
  builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const supabase = globalThis.testSupabase;', loader: 'js' }));
} }] });
const createId = 'eb500000-0000-4000-8000-000000000001';
const input = { nom: 'Payet', prenom: 'Flavie', tel: '0692 12 34 56', email: 'flavie@example.test', adresseLigne1: '12 rue des Lilas', cp: '97400',
  ville: 'Saint-Denis', type: 'particulier', canal: 'email', modePaiement: 'colis', abonnement: 'freemium', telegramUsername: '@flaviep', points: 0 };

// The clients table as the server keeps it: the address written alike in adresse and adresse_ligne1, a creation date.
function storage({ loseResponse = false, readUnavailable = false, collision = false } = {}) {
  const rows = [], calls = [], state = { readUnavailable: false, loseResponse, collision };
  const testSupabase = { from(table) {
    let insert, single = false, conditions = [];
    const query = {
      select() { return this; },
      eq(key, value) { conditions.push([key, value]); return this; },
      maybeSingle() { single = true; return this; }, single() { single = true; return this; },
      insert(value) { insert = structuredClone(value); return this; },
      then(resolve, reject) {
        assert.equal(table, 'clients');
        calls.push(insert ? 'insert' : 'select');
        let result;
        if (insert) {
          if (state.collision) { state.collision = false; result = { error: { code: '23505', message: 'duplicate key value violates unique constraint "clients_ref_key"' } }; }
          else if (rows.some(row => row.id === insert.id)) result = { error: { code: '23505', message: 'duplicate key value violates unique constraint "clients_pkey"' } };
          else {
            const stored = { ...insert, id: insert.id || `generated-${rows.length + 1}`, created_at: '2026-10-28T09:00:00+00:00', user_id: null, telegram_chat_id: null };
            if (stored.adresse_ligne1) stored.adresse = stored.adresse_ligne1; else stored.adresse_ligne1 = stored.adresse;
            rows.push(stored);
            if (state.loseResponse) { state.loseResponse = false; state.readUnavailable = readUnavailable; result = { error: { message: 'network response lost' } }; }
            else result = { data: stored };
          }
        } else if (state.readUnavailable) result = { error: { message: 'offline' } };
        else {
          const selected = rows.filter(row => conditions.every(([key, value]) => row[key] === value));
          result = { data: single ? selected[0] || null : selected };
        }
        return Promise.resolve(structuredClone(result)).then(resolve, reject);
      },
    };
    return query;
  } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, testSupabase, console, URL });
  return { api: module.exports, rows, calls, state };
}
const { api: pure } = storage();
// The row insertClient sends for `input` (snake_case), as the server stored it.
const sent = { nom: 'Payet', prenom: 'Flavie', genre: null, date_naissance: '1990-05-04', ville: 'Saint-Denis', adresse: null, adresse_ligne1: '12 rue des Lilas',
  adresse_ligne2: null, commune: null, infos_livraison: null, cp: '97400', tel: '0692 12 34 56', tel_fixe: null, email: 'flavie@example.test', canal: 'email',
  type: 'particulier', mode_paiement: 'colis', points: 0, onboarded: false, notes: null, telegram_username: 'flaviep', abonnement: 'freemium',
  abonnement_debut: null, abonnement_fin: null, raison_sociale: null, siret: null, interlocuteur: null };

test('the same creation: the address the server keeps, the dates and blanks alike; what happened since is ignored', () => {
  const stored = { ...sent, id: createId, ref: 'CLI-ABCDE', adresse: '12 rue des Lilas', date_naissance: '1990-05-04', telegram_username: '@flaviep', notes: '',
    created_at: '2026-10-28T09:00:00+00:00', updated_at: '2026-10-28T10:00:00+00:00', telegram_chat_id: '7001', points: 120, onboarded: true, user_id: 'u1' };
  assert.equal(pure.sameClientCreation(stored, sent), true);
  // A form that filled adresse only: the server copies it to adresse_ligne1.
  assert.equal(pure.sameClientCreation({ ...stored, adresse: '3 chemin Bœuf', adresse_ligne1: '3 chemin Bœuf' }, { ...sent, adresse: '3 chemin Bœuf', adresse_ligne1: null }), true);
  assert.equal(pure.sameClientCreation({ ...stored, abonnement_debut: '2026-10-01' }, { ...sent, abonnement_debut: '2026-10-01T00:00:00.000Z' }), true);
  for (const [key, value] of [['nom', 'Hoarau'], ['prenom', 'Marc'], ['email', 'marc@example.test'], ['tel', '0692 00 00 00'], ['cp', '97600'],
    ['adresse_ligne1', '1 rue Autre'], ['type', 'pro'], ['raison_sociale', 'Payet SARL'], ['abonnement', 'premium'], ['date_naissance', '1991-05-04']])
    assert.equal(pure.sameClientCreation({ ...stored, [key]: value }, sent), false, key);
});

test('a lost creation answer is recovered by its id, with no second client', async () => {
  const { api, rows, calls } = storage({ loseResponse: true });
  const saved = await api.insertClient(input, { createId });
  assert.equal(saved.id, createId);
  assert.equal(saved.adresse, '12 rue des Lilas');
  assert.equal(rows.length, 1);
  assert.deepEqual(calls, ['insert', 'select']);
});

test('the creation retried after an outage returns the client recorded the first time', async () => {
  const { api, rows, calls, state } = storage({ loseResponse: true, readUnavailable: true });
  await assert.rejects(api.insertClient(input, { createId }), error => error.message === 'offline');
  state.readUnavailable = false;
  rows[0].telegram_chat_id = '7001';
  const saved = await api.insertClient(input, { createId });
  assert.equal(saved.id, createId);
  assert.equal(saved.telegramChatId, '7001');
  assert.equal(rows.length, 1);
  assert.deepEqual(calls, ['insert', 'select', 'insert', 'select']);
});

test('the id of a client with another content is refused (40001), never overwritten', async () => {
  const { api, rows } = storage();
  await api.insertClient(input, { createId });
  for (const changed of [{ ...input, nom: 'Hoarau' }, { ...input, email: 'autre@example.test' }, { ...input, adresseLigne1: '1 rue Autre' }])
    await assert.rejects(api.insertClient(changed, { createId }), error => error.code === '40001'
      && error.message === 'Cette fiche client existe déjà et son contenu a changé. Ouvrez la fiche avant de continuer.');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nom, 'Payet');
  // The same form sent twice: the recorded client.
  assert.equal((await api.insertClient(input, { createId })).id, createId);
});

test('a CLI reference collision retries a new reference with the same id; a refusal is passed on', async () => {
  const { api, rows, calls } = storage({ collision: true });
  assert.equal((await api.insertClient(input, { createId })).id, createId);
  assert.equal(rows.length, 1);
  assert.deepEqual(calls, ['insert', 'select', 'insert']);
  await assert.rejects(api.insertClient(input, { createId: 'client-1' }), error => error.code === '22023');
  assert.equal(calls.length, 3, 'An invalid id makes no call.');
});

test('without createId the creation is unchanged: one insertion, no read', async () => {
  const { api, rows, calls } = storage();
  const saved = await api.insertClient(input);
  assert.equal(saved.id, 'generated-1');
  assert.equal(rows.length, 1);
  assert.deepEqual(calls, ['insert']);
  const lost = storage({ loseResponse: true });
  await assert.rejects(lost.api.insertClient(input), error => error.message === 'network response lost');
  assert.deepEqual(lost.calls, ['insert']);
});
