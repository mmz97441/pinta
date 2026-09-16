/* Consent and manual notification requests use isolated fictitious providers. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_TASK_MESSAGE_OUT || '/tmp/pinta-task-message';
const results = [];
const region = f => f.page.getByRole('region', { name: 'Notification au client', exact: true });
const field = f => region(f).getByLabel('Message à envoyer au client', { exact: true });
const send = f => region(f).getByRole('button', { name: 'Envoyer ce message', exact: true });
const permissions = (f, values) => {
  const row = { id: '88888888-8888-4888-8888-888888888888', staff_id: ids.S, ...values };
  f.tables.staff_users[0].staff_permissions = row; f.tables.staff_permissions = [row];
};
async function open(f) {
  await f.login(); await f.page.goto(`${base}/colis/${ids.P}?section=accord`);
  await f.page.getByRole('button', { name: 'Préparer la demande au client', exact: true }).click();
  await field(f).waitFor();
}
async function main() {
  await fs.mkdir(output, { recursive: true }); const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, role = 'directeur') {
    if (process.env.PINTA_TASK_MESSAGE_FILTER && !name.includes(process.env.PINTA_TASK_MESSAGE_FILTER)) return;
    const f = await setup(browser, role); f.page.setDefaultTimeout(10000);
    Object.assign(f.tables.colis[0], { statut: 'mesure', feu_vert: 'en_attente', nb_colis: 1, trackings: ['TEST-001'], trackings_detail: [{ number: 'TEST-001', fournisseur: 'Boutique A' }], dims_par_colis: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3 }] });
    Object.assign(f.tables.clients[0], { user_id: ids.C, email: null });
    f.queueCalls = []; f.queueByKey = new Map(); f.loseNextQueueResponse = false;
    await f.context.route('**/rest/v1/rpc/queue_message', async route => {
      const input = route.request().postDataJSON(); f.queueCalls.push(input);
      let message = f.queueByKey.get(input.p_idempotency_key);
      if (!message) {
        message = { id: crypto.randomUUID(), colis_id: input.p_colis_id, texte: input.p_text, template: input.p_template, canal: input.p_canal, type: 'staff', statut: 'en_attente', created_at: new Date().toISOString() };
        f.queueByKey.set(input.p_idempotency_key, message); f.tables.messages.push(message);
      }
      if (f.loseNextQueueResponse) { f.loseNextQueueResponse = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Réponse perdue après mise en file' }) }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message, outbox: { id: 'synthetic-outbox' } }) });
    });
    try { await run(f); assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []); results.push({ test: name, pass: true }); }
    catch (error) { results.push({ test: name, pass: false, error: error.stack }); process.exitCode = 1; await f.page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {}); await fs.writeFile(`${output}/${name}-failure.txt`, await f.page.locator('body').innerText().catch(() => '')); }
    finally { await f.context.close(); }
  }
  try {
    await scenario('preview-is-readonly-and-explicit-double-click-sends-one-initial-request', async f => {
      f.tables.factures = []; f.tables.lignes = []; await open(f);
      assert.match(await field(f).inputValue(), /factures d’achat/); assert.match(await field(f).inputValue(), /TEST-001/);
      await region(f).getByRole('button', { name: 'Fermer', exact: true }).click();
      assert.equal(f.tables.colis[0].statut, 'mesure'); assert.equal(f.queueCalls.length, 0);
      await f.page.getByRole('button', { name: 'Préparer la demande au client', exact: true }).click();
      await send(f).evaluate(button => { button.click(); button.click(); });
      await region(f).getByText('Message disponible dans l’espace client.', { exact: true }).waitFor();
      assert.equal(f.tables.colis[0].statut, 'attente_feu_vert'); assert.equal(f.queueCalls.length, 1);
      assert.equal(f.queueCalls[0].p_template, 'demande_feu_vert'); assert.equal(f.queueCalls[0].p_canal, 'portal');
      assert.match(f.queueCalls[0].p_text, /factures d’achat/);
      assert.ok(f.queueCalls[0].p_reply_markup.inline_keyboard.some(row => row.some(button => button.callback_data === `fv_oui_${ids.P}`)));
    });
    await scenario('lost-queue-response-retries-original-template-and-key-after-status-change', async f => {
      await open(f); f.loseNextQueueResponse = true; await send(f).click();
      await region(f).getByRole('alert').filter({ hasText: 'Réponse perdue' }).waitFor();
      assert.equal(f.tables.colis[0].statut, 'attente_feu_vert'); assert.equal(f.queueCalls.length, 1);
      assert.equal(await field(f).isDisabled(), true);
      await region(f).getByRole('button', { name: 'Fermer', exact: true }).click();
      await f.page.getByRole('button', { name: 'Préparer une relance', exact: true }).click();
      await region(f).getByRole('button', { name: 'Réessayer cet envoi', exact: true }).click();
      await region(f).getByText('Message disponible dans l’espace client.', { exact: true }).waitFor();
      assert.equal(f.queueCalls.length, 2); assert.deepEqual(f.queueCalls[1], f.queueCalls[0]); assert.equal(f.tables.messages.length, 1);
      assert.equal(f.requests.filter(request => request.method === 'PATCH' && request.path === '/rest/v1/colis').length, 1);
    });
    await scenario('invoice-change-invalidates-preview-even-when-proposed-wording-is-identical', async f => {
      await open(f); const original = await field(f).inputValue();
      f.tables.factures[0].montant = 321; f.tables.colis[0].updated_at = '2099-09-16T10:00:00Z';
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const refresh = region(f).getByRole('button', { name: 'Actualiser le message proposé', exact: true }); await refresh.waitFor();
      assert.equal(await send(f).isDisabled(), true); assert.equal(f.queueCalls.length, 0);
      await refresh.click(); assert.equal(await field(f).inputValue(), original); assert.equal(await send(f).isEnabled(), true);
    });
    await scenario('email-feedback-describes-draft-without-claiming-delivery', async f => {
      f.tables.clients[0].email = 'client@example.test';
      await f.page.addInitScript(() => { window.__opened = []; window.open = (...args) => { window.__opened.push(args); return null; }; });
      await open(f); await region(f).getByLabel('Canal de notification').selectOption('email');
      await region(f).getByRole('button', { name: 'Ouvrir le brouillon email', exact: true }).click();
      await region(f).getByText('Brouillon ouvert dans votre messagerie. Confirmez l’envoi dans celle-ci.', { exact: true }).waitFor();
      assert.equal(f.queueCalls.length, 1); assert.equal(f.queueCalls[0].p_canal, 'email');
      const opened = await f.page.evaluate(() => window.__opened); assert.equal(opened.length, 1); assert.match(opened[0][0], /^mailto:client@example\.test\?/);
      assert.equal(await region(f).getByText('Message livré à Telegram.', { exact: true }).count(), 0);
    });
    await scenario('portal-permission-is-independent-from-telegram-permission', async f => {
      f.tables.clients[0].telegram_chat_id = 'synthetic-chat';
      permissions(f, { perm_colis_demander_feuvert: true, perm_comm_message_libre: true, perm_comm_telegram: false, perm_comm_email: false });
      await open(f); assert.equal(await region(f).getByLabel('Canal de notification').inputValue(), 'portal');
      assert.equal(await region(f).getByRole('option', { name: 'Telegram', exact: true }).evaluate(option => option.disabled), true);
      assert.equal(await send(f).isEnabled(), true); await send(f).click();
      await region(f).getByText('Message disponible dans l’espace client.', { exact: true }).waitFor();
      assert.equal(f.queueCalls[0].p_canal, 'portal');
    }, 'preparateur');
    await scenario('unavailable-channel-permission-prevents-queueing', async f => {
      permissions(f, { perm_colis_demander_feuvert: true, perm_comm_message_libre: false, perm_comm_telegram: true, perm_comm_email: false });
      await open(f); assert.equal(await send(f).isDisabled(), true); assert.equal(f.queueCalls.length, 0); assert.equal(f.tables.colis[0].statut, 'mesure');
    }, 'preparateur');
    await scenario('failed-status-update-can-be-corrected-before-any-queue-attempt', async f => {
      let fail = true;
      await f.context.route('**/rest/v1/colis*', async route => {
        if (route.request().method() === 'PATCH' && fail) { fail = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Mise à jour momentanément indisponible' }) }); }
        return route.fallback();
      });
      await open(f); await send(f).click();
      await region(f).getByRole('alert').filter({ hasText: 'momentanément indisponible' }).waitFor();
      assert.equal(f.queueCalls.length, 0); assert.equal(await field(f).isEditable(), true);
      await field(f).fill((await field(f).inputValue()) + '\nMerci de votre retour.');
      await region(f).getByRole('button', { name: 'Réessayer cet envoi', exact: true }).click();
      await region(f).getByText('Message disponible dans l’espace client.', { exact: true }).waitFor();
      assert.equal(f.queueCalls.length, 1); assert.match(f.queueCalls[0].p_text, /Merci de votre retour\.$/); assert.equal(f.queueCalls[0].p_template, 'demande_feu_vert');
    });
    await scenario('document-change-during-status-save-is-refreshable-before-queueing', async f => {
      let entered, release; const started = new Promise(resolve => { entered = resolve; }); const gate = new Promise(resolve => { release = resolve; });
      await f.context.route('**/rest/v1/colis*', async route => {
        if (route.request().method() === 'PATCH') { entered(); await gate; }
        return route.fallback();
      });
      await open(f); await send(f).click(); await started;
      f.tables.factures[0].montant = 654; f.tables.colis[0].updated_at = '2099-09-16T10:00:00Z';
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const refresh = region(f).getByRole('button', { name: 'Actualiser le message proposé', exact: true }); await refresh.waitFor();
      release(); await region(f).getByRole('alert').filter({ hasText: 'Ce dossier a été modifié par un collègue' }).waitFor();
      assert.equal(f.queueCalls.length, 0); await refresh.click();
      await region(f).getByRole('button', { name: 'Réessayer cet envoi', exact: true }).click();
      await region(f).getByText('Message disponible dans l’espace client.', { exact: true }).waitFor();
      assert.equal(f.queueCalls.length, 1); assert.equal(f.queueCalls[0].p_template, 'demande_feu_vert');
      assert.equal(f.requests.filter(request => request.method === 'PATCH' && request.path === '/rest/v1/colis').length, 2);
    });
  } finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
