const { openDetailsFor } = require('./ui-disclosure-helpers.cjs');
/* Staff receipt and later communication are separate; all providers are local fixtures. */
const { chromium } = require('playwright');
const { setup, base, ids } = require('./browser-regression.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const output = process.env.PINTA_RECEIPT_FLOW_OUT || '/tmp/pinta-receipt-flow';
const results = [];
const oldBox = { dimL: 40, dimW: 30, dimH: 20, poids: 3 };
async function measure(dialog, number) {
 for (const [label, unit, value] of [['Longueur','cm','20'],['Largeur','cm','30'],['Hauteur','cm','40'],['Poids','kg','2']]) await dialog.getByLabel(`${label} à réception (${unit}) · carton ${number}`, { exact: true }).fill(value);
}
async function open(f, list = '/?mission=reception') {
 await f.page.goto(base + list);
 await f.page.getByRole('button', { name: 'Réceptionner des cartons', exact: true }).filter({ visible: true }).first().click();
 const dialog = f.page.getByRole('dialog', { name: 'Réceptionner des cartons', exact: true });
 await dialog.getByPlaceholder('Rechercher un client…').fill('Camille');
 await dialog.getByRole('button').filter({ hasText: /Exemple/ }).first().click();
 return dialog;
}
(async () => {
 await fs.mkdir(output, { recursive: true });
 const browser = await chromium.launch({ headless: true });
 async function scenario(name, run) {
  const f = await setup(browser, 'directeur'); f.page.setDefaultTimeout(10000);
  Object.assign(f.tables.clients[0], { user_id: ids.C, telegram_chat_id: 'fake-chat-only' });
  try { await f.login(); await run(f); assert.equal(f.requests.some(request => /\/(queue_message|send-telegram|send-email|send-message)$/.test(request.path)), false, 'Receiving cartons must never notify the customer'); assert.deepEqual(f.tables.messages, []); assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []); results.push({ test: name, pass: true }); }
  catch (error) { process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack }); await f.page.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(output, name + '-failure.txt'), await f.page.locator('body').innerText().catch(() => '')); }
  finally { await f.context.close(); }
 }
 try {
  await scenario('receipt-requires-every-measure-and-opens-combined-agreement-without-notification', async f => {
   const dialog = await open(f);
   assert.equal(await dialog.getByRole('button', { name: /notifier|Sans notification/ }).count(), 0);
   await dialog.getByLabel('Casier', { exact: false }).fill('Z-03');
   await openDetailsFor(dialog.getByLabel('Numéro de suivi · carton 1', { exact: true })); await dialog.getByLabel('Numéro de suivi · carton 1', { exact: true }).fill('RECEIPT-NEW');
   const save = dialog.getByRole('button', { name: 'Réceptionner les cartons', exact: true });
   await save.click(); await dialog.getByRole('alert').filter({ hasText: /longueur à réception/ }).waitFor();
   assert.equal(f.tables.colis.length, 1);
   await measure(dialog, 1);
   await save.click(); await dialog.waitFor({ state: 'hidden' });
   await f.page.waitForURL(url => url.pathname.startsWith('/colis/') && url.searchParams.get('section') === 'accord');
   const created = f.tables.colis.find(item => item.id !== ids.P);
   assert.ok(created); assert.match(created.ref, /^EXP-/); assert.equal(created.nb_colis, 1); assert.equal(created.statut, 'mesure');
   assert.deepEqual(created.dims_par_colis, [{ dimL: 20, dimW: 30, dimH: 40, poids: 2 }]);
   assert.equal(created.fin_l, undefined);
   assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/?mission=reception');
   assert.deepEqual(await f.page.evaluate(() => history.state.usr.receivedCarton), { colisId: created.id, index: 0 });
   assert.equal(f.requests.filter(request => request.method === 'POST' && request.path === '/rest/v1/colis').length, 1);
  });
  await scenario('receipt-failure-preserves-draft-retry-and-double-click-inserts-once', async f => {
   let fail = true; let attempts = 0;
   await f.context.route('**/rest/v1/colis?*', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    attempts++;
    if (fail) { fail = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Réception indisponible simulée' }) }); }
    await new Promise(resolve => setTimeout(resolve, 150)); return route.fallback();
   });
   const dialog = await open(f); await dialog.getByLabel('Casier', { exact: false }).fill('Z-04'); await measure(dialog, 1);
   await openDetailsFor(dialog.getByLabel('Numéro de suivi · carton 1', { exact: true })); await dialog.getByLabel('Numéro de suivi · carton 1', { exact: true }).fill('RECEIPT-RETRY');
   const save = dialog.getByRole('button', { name: 'Réceptionner les cartons', exact: true });
   await save.click(); await dialog.getByRole('alert').filter({ hasText: /Réception non enregistrée/ }).waitFor();
   assert.equal(await dialog.getByLabel('Numéro de suivi · carton 1', { exact: true }).inputValue(), 'RECEIPT-RETRY');
   assert.equal(await dialog.getByLabel('Poids à réception (kg) · carton 1', { exact: true }).inputValue(), '2');
   await save.evaluate(node => { node.click(); node.click(); });
   await dialog.waitFor({ state: 'hidden' });
   await f.page.waitForURL(url => url.searchParams.get('section') === 'accord');
   assert.equal(attempts, 2, 'One failed attempt followed by a single insertion despite double click');
   assert.equal(f.tables.colis.length, 2);
  });
  for (const complete of [true, false]) await scenario(`attachment-keeps-reference-numbering-return-and-${complete ? 'agreement' : 'missing-receipt-measures'}`, async f => {
   await f.page.setViewportSize({ width: 390, height: 844 });
   Object.assign(f.tables.colis[0], { statut: 'autorise', dims_par_colis: complete ? [oldBox, oldBox] : [oldBox], nb_colis: 2, feu_vert: 'autorise' });
   const dialog = await open(f, '/?section=pool&mission=reception');
   await dialog.getByRole('button').filter({ hasText: 'EXP-TEST-001' }).click();
   await dialog.getByRole('heading', { name: 'Carton 3', exact: true }).waitFor();
   await measure(dialog, 3); await openDetailsFor(dialog.getByLabel('Numéro de suivi · carton 3', { exact: true })); await dialog.getByLabel('Numéro de suivi · carton 3', { exact: true }).fill('RECEIPT-ATTACH');
   await dialog.getByRole('button', { name: /^Enregistrer (?:le carton|les cartons) dans EXP-TEST-001$/, exact: true }).click();
   await dialog.waitFor({ state: 'hidden' });
   await f.page.waitForURL(url => url.pathname === '/colis/' + ids.P && url.searchParams.get('section') === (complete ? 'accord' : 'reception'));
   assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/?section=pool&mission=reception');
   assert.deepEqual(await f.page.evaluate(() => history.state.usr.receivedCarton), { colisId: ids.P, index: 2 });
   assert.equal(f.tables.colis.length, 1); assert.equal(f.tables.colis[0].ref, 'EXP-TEST-001'); assert.equal(f.tables.colis[0].nb_colis, 3);
   assert.equal(f.tables.colis[0].feu_vert, 'en_attente');
   assert.equal(f.requests.some(request => request.method === 'POST' && request.path === '/rest/v1/colis'), false);
  });
 } finally { await browser.close(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
