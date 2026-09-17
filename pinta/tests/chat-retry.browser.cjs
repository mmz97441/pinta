/* Stable retry identity on synthetic messages only, including a lost response. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const out = process.env.PINTA_CHAT_RETRY_OUT || '/tmp/pinta-chat-retry';
const results = [];
const answer = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const navigate = (page, to) => page.evaluate(url => { window.history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }, to);
(async () => {
  await fs.mkdir(out, { recursive: true }); const browser = await chromium.launch();
  const run = async (role, name, action) => {
    const f = await setup(browser, role); f.page.setDefaultTimeout(10000);
    try { await action(f); assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.stack }); await f.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); }
    finally { await f.context.close(); }
  };
  await run('directeur', 'staff-lost-response-reload-reuses-message-and-next-send-is-new', async f => {
    f.tables.clients[0].user_id = 'client-fixture'; f.tables.colis[0].conversation_statut = 'a_traiter';
    const attempts = [], stored = new Map(); let lose = true;
    await f.context.route('**/rest/v1/rpc/queue_message', async route => {
      const input = route.request().postDataJSON(); attempts.push(input);
      if (!stored.has(input.p_idempotency_key)) {
        const message = { id: crypto.randomUUID(), colis_id: input.p_colis_id, texte: input.p_text, type: 'staff', auteur_nom: 'Équipe fictive', statut: 'envoye', canal: input.p_canal, created_at: new Date().toISOString() };
        f.tables.messages.push(message); stored.set(input.p_idempotency_key, { message, outbox: { id: crypto.randomUUID() } });
      }
      if (lose) { lose = false; return answer(route, { message: 'Confirmation perdue après enregistrement fictif.' }, 503); }
      return answer(route, stored.get(input.p_idempotency_key));
    });
    await f.login(); await f.page.goto(`${base}/conversations?dossier=${ids.P}`);
    const input = f.page.getByLabel('Votre réponse au client', { exact: true }); await input.fill('Réponse stable\nÀ conserver');
    await input.press('Control+Enter'); await f.page.locator('p[role="alert"]').filter({ hasText: 'Confirmation perdue' }).waitFor();
    assert.equal(f.tables.messages.filter(message => message.type === 'staff').length, 1);
    await f.page.reload(); await input.waitFor(); assert.equal(await input.inputValue(), 'Réponse stable\nÀ conserver');
    await f.page.getByText(/Une tentative d’envoi existe/).waitFor(); await input.press('Control+Enter');
    await f.page.getByText('Message enregistré. Son état d’envoi apparaît dans la conversation.', { exact: true }).waitFor();
    assert.deepEqual(attempts[1], attempts[0]); assert.equal(stored.size, 1); assert.equal(await input.inputValue(), '');
    await input.fill('Réponse stable\nÀ conserver'); await input.press('Control+Enter');
    await f.page.waitForFunction(() => document.querySelector('textarea[id^="staff-message-"]')?.value === '');
    assert.equal(attempts.length, 3); assert.notEqual(attempts[2].p_idempotency_key, attempts[0].p_idempotency_key); assert.equal(stored.size, 2);
  });
  await run('client', 'client-lost-insert-response-reuses-primary-key-after-reload', async f => {
    const attempts = []; let lose = true;
    await f.context.route('**/rest/v1/messages*', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      const input = route.request().postDataJSON(); attempts.push(input);
      if (f.tables.messages.some(message => message.id === input.id)) return answer(route, { code: '23505', message: 'Identifiant déjà enregistré.' }, 409);
      f.tables.messages.push({ ...input, created_at: new Date().toISOString() });
      if (lose) { lose = false; return answer(route, { message: 'Confirmation client perdue.' }, 503); }
      return answer(route, null, 201);
    });
    await f.login(); await f.page.goto(`${base}/colis/${ids.P}?panel=messages`);
    const input = f.page.getByLabel('Votre message à l’équipe', { exact: true }); await input.fill('Mon adresse complète\nBâtiment B'); await input.press('Control+Enter');
    await f.page.locator('p[role="alert"]').filter({ hasText: 'Confirmation client perdue.' }).waitFor();
    await f.page.reload(); await input.waitFor(); assert.equal(await input.inputValue(), 'Mon adresse complète\nBâtiment B'); await input.press('Control+Enter');
    await f.page.getByText('Message enregistré. Son état d’envoi apparaît dans la conversation.', { exact: true }).waitFor();
    assert.equal(attempts.length, 2); assert.deepEqual(attempts[1], attempts[0]); assert.equal(f.tables.messages.filter(message => message.texte === attempts[0].texte).length, 1); assert.equal(await input.inputValue(), '');
  });
  await run('directeur', 'completed-send-in-another-dossier-keeps-current-draft', async f => {
    const second = '73333333-3333-4333-8333-333333333333'; f.tables.clients[0].user_id = 'client-fixture';
    f.tables.colis.push({ ...f.tables.colis[0], id: second, ref: 'EXP-SECOND' });
    let release, entered; const gate = new Promise(resolve => { release = resolve; }); const pending = new Promise(resolve => { entered = resolve; });
    await f.context.route('**/rest/v1/rpc/queue_message', async route => { entered(); await gate; return route.fallback(); });
    await f.login(); await f.page.goto(`${base}/conversations?dossier=${second}`);
    const field = () => f.page.getByLabel('Votre réponse au client', { exact: true }); await field().fill('Brouillon du second dossier');
    await navigate(f.page, `/conversations?dossier=${ids.P}`); await field().fill('Envoi du premier dossier'); await field().press('Control+Enter'); await pending;
    await navigate(f.page, `/conversations?dossier=${second}`); assert.equal(await field().inputValue(), 'Brouillon du second dossier'); release();
    await field().waitFor(); await f.page.waitForFunction(() => document.querySelector('textarea[id^="staff-message-"]')?.disabled === false);
    assert.equal(await field().inputValue(), 'Brouillon du second dossier'); await navigate(f.page, `/conversations?dossier=${ids.P}`); assert.equal(await field().inputValue(), '');
  });
  await browser.close(); await fs.writeFile(`${out}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
  if (results.some(result => !result.pass)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
