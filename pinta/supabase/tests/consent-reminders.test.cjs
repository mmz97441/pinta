// The automatic consent reminders (supabase/functions/_shared/consentReminders.ts): the sending hours at the client's
// destination, and what one run queues (the saved « relance_feu_vert » text, the buttons and the key of each reminder),
// with the server's list (consent_reminders_due) as the only source of what is due.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('../../node_modules/esbuild');
const compiled = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '../functions/_shared/consentReminders.ts')], bundle: true, write: false, format: 'cjs', platform: 'node',
  // The Supabase client of http.ts is never used here: a stand-in.
  external: ['https://esm.sh/*'],
}).outputFiles[0].text;
const errors = [];
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports, require: () => ({ createClient: () => null }), Date, Intl, Deno: { env: { get: key => key === 'APP_URL' ? 'https://expedile.app' : undefined } },
  console: { log() {}, warn() {}, error: (...args) => errors.push(args.join(' ')) } });
const { destinationHour, inSendingHours, consentButtons, queueConsentReminders, reminderKey } = moduleObject.exports;
// Objects made in the module's own realm, compared as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

const COLIS = '30000000-0000-4000-8000-000000000001';
const CLIENT = '20000000-0000-4000-8000-000000000001';
const due = (extra = {}) => ({ colisId: COLIS, clientId: CLIENT, ref: 'EXP-2YE537', consentVersion: 2, number: 1, dueAt: '2026-10-31T06:00:00Z', destinationCode: '974', ...extra });
function database({ listed = [due()], template = null, queue = () => ({ data: { message: { id: 'm1' }, outbox: { id: 'o1' } }, error: null }), listError = null } = {}) {
  const calls = { rpc: [], from: [] };
  const db = {
    rpc: async (name, args) => {
      calls.rpc.push([name, args]);
      if (name === 'consent_reminders_due') return listError ? { data: null, error: listError } : { data: listed, error: null };
      assert.equal(name, 'queue_message');
      return queue(args);
    },
    from(table) {
      const filters = {};
      const q = { select() { return q; }, eq(key, value) { filters[key] = value; return q; } };
      const answer = () => {
        calls.from.push([table, { ...filters }]);
        if (table === 'message_templates') return { data: template, error: null };
        if (table === 'colis') return { data: { id: COLIS, ref: 'EXP-2YE537', desc_contenu: 'Shein', client_id: CLIENT }, error: null };
        if (table === 'clients') return { data: { id: CLIENT, prenom: 'Flavie', nom: 'PAYET Flavie', cp: '97410', type: 'particulier', telegram_chat_id: 'chat' }, error: null };
        if (table === 'destinations') return { data: null, error: null };
        throw new Error(`Unexpected table ${table}`);
      };
      q.single = q.maybeSingle = async () => answer();
      return q;
    },
  };
  return { db, calls };
}
// 10 h at La Réunion (UTC+4), 6 h UTC.
const DAY = Date.parse('2026-10-31T06:00:00Z');

test('a reminder leaves between 8 h and 20 h at the client’s destination', () => {
  assert.equal(destinationHour('974', Date.parse('2026-10-31T03:59:00Z')), 7);
  assert.equal(inSendingHours('974', Date.parse('2026-10-31T03:59:00Z')), false, '7 h 59 at La Réunion');
  assert.equal(inSendingHours('974', Date.parse('2026-10-31T04:00:00Z')), true, '8 h at La Réunion');
  assert.equal(inSendingHours('974', Date.parse('2026-10-31T15:59:00Z')), true, '19 h 59 at La Réunion');
  assert.equal(inSendingHours('974', Date.parse('2026-10-31T16:00:00Z')), false, '20 h at La Réunion');
  assert.equal(inSendingHours('976', Date.parse('2026-10-31T04:59:00Z')), false, '7 h 59 at Mayotte (UTC+3)');
  assert.equal(inSendingHours('976', Date.parse('2026-10-31T05:00:00Z')), true, '8 h at Mayotte (UTC+3)');
  assert.equal(inSendingHours('971', Date.parse('2026-10-31T11:59:00Z')), false, '7 h 59 in Guadeloupe (UTC-4)');
  assert.equal(inSendingHours('971', Date.parse('2026-10-31T12:00:00Z')), true, '8 h in Guadeloupe');
  assert.equal(inSendingHours('', Date.parse('2026-10-31T04:00:00Z')), true, 'an unknown destination: La Réunion');
});

test('a due reminder is queued as a relance with the buttons of its dossier, its key and its consent version', async () => {
  const { db, calls } = database();
  const run = await queueConsentReminders(db, DAY);
  assert.deepEqual(plain(run), { due: 1, queued: 1, waiting: 0, failed: 0 });
  assert.deepEqual(plain(calls.rpc[0]), ['consent_reminders_due', { p_now: '2026-10-31T06:00:00.000Z' }]);
  const [, args] = calls.rpc[1];
  assert.equal(args.p_colis_id, COLIS);
  assert.equal(args.p_template, 'relance_feu_vert');
  assert.equal(args.p_canal, 'telegram');
  assert.equal(args.p_expected_consent_version, 2);
  assert.equal(args.p_idempotency_key, `consent-reminder:${COLIS}:2:1`);
  assert.equal(reminderKey(due({ number: 2 })), `consent-reminder:${COLIS}:2:2`);
  assert.deepEqual(plain(args.p_reply_markup), plain(consentButtons(COLIS)));
  assert.deepEqual(plain(args.p_reply_markup.inline_keyboard.flat().map(button => button.callback_data)), [`fv_oui_${COLIS}`, `fv_wait_${COLIS}`, `fv_non_${COLIS}`]);
  // The default text: the client's first name, the dossier and its size, the buttons it carries.
  assert.match(args.p_text, /^Bonjour Flavie 👋\n\nVotre dossier EXP-2YE537 \(\d+ colis\) vous attend à notre entrepôt de Paris\. Nous attendons votre accord pour le préparer\.\n\n🎯 Touchez « Autoriser la préparation » ci-dessous/u);
  assert.deepEqual(plain(calls.from.find(([table]) => table === 'message_templates')[1]), { key: 'relance_feu_vert', canal: 'telegram' });
});

test('the text the team saved is the one sent; an unknown variable stops the reminder, never another text', async () => {
  const saved = database({ template: { body: 'Bonjour {{prenom}}, votre accord pour {{ref}} est toujours attendu.' } });
  await queueConsentReminders(saved.db, DAY);
  assert.equal(saved.calls.rpc[1][1].p_text, 'Bonjour Flavie, votre accord pour EXP-2YE537 est toujours attendu.');
  const broken = database({ template: { body: 'Bonjour {{inconnue}}' } });
  assert.deepEqual(plain(await queueConsentReminders(broken.db, DAY)), { due: 1, queued: 0, waiting: 0, failed: 1 });
  assert.equal(broken.calls.rpc.length, 1, 'nothing queued');
});

test('outside the sending hours a reminder waits for the next run; one failure never stops the others', async () => {
  const night = database();
  assert.deepEqual(plain(await queueConsentReminders(night.db, Date.parse('2026-10-31T17:00:00Z'))), { due: 1, queued: 0, waiting: 1, failed: 0 });
  assert.equal(night.calls.rpc.length, 1, 'nothing queued at 21 h at La Réunion');
  let first = true;
  const mixed = database({ listed: [due(), due({ colisId: '30000000-0000-4000-8000-000000000002', number: 2 })],
    queue: () => { if (first) { first = false; return { data: null, error: { code: '40001', message: 'La demande a changé.' } }; } return { data: { message: { id: 'm2' } }, error: null }; } });
  assert.deepEqual(plain(await queueConsentReminders(mixed.db, DAY)), { due: 2, queued: 1, waiting: 0, failed: 1 });
});

test('without the server’s list nothing is queued (the worker reports it and goes on)', async () => {
  const { db, calls } = database({ listError: { code: 'PGRST202', message: 'Could not find the function' } });
  await assert.rejects(() => queueConsentReminders(db, DAY));
  assert.equal(calls.rpc.length, 1);
});
