/* A colleague's writes arrive without WebSocket events; APIs remain isolated fixtures. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { setup } = require('./browser-regression.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const f = await setup(browser, 'directeur');
  f.page.setDefaultTimeout(12000);
  try {
    let failIndex = false;
    const reads = [];
    await f.context.route('**/rest/v1/colis?*', async route => {
      const url = new URL(route.request().url());
      reads.push(url.searchParams.toString());
      if (failIndex && url.searchParams.get('select') === 'id,updated_at,client_id') {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Connexion temporairement indisponible' }) });
      }
      return route.fallback();
    });
    await f.page.clock.install();
    await f.login();
    await f.page.getByRole('button', { name: 'Dossiers d’expédition', exact: true }).click();
    await f.page.getByText('EXP-TEST-001', { exact: true }).filter({ visible: true }).first().waitFor();
    const client = { ...f.tables.clients[0], id: '77777777-0000-4000-8000-000000000001', nom: 'Collaboration', prenom: 'Synchro' };
    const colleagueParcel = { ...f.tables.colis[0], id: '88888888-0000-4000-8000-000000000001', client_id: client.id, ref: 'EXP-SYNC02', updated_at: new Date().toISOString() };
    f.tables.clients.push(client);
    f.tables.colis.push(colleagueParcel);
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await f.page.getByText('EXP-SYNC02', { exact: true }).filter({ visible: true }).first().waitFor();
    await f.page.getByText(/Collaboration/).filter({ visible: true }).first().waitFor();
    console.log('PASS: missed colleague creation and new client recovered on focus');

    const onlineParcel = { ...colleagueParcel, id: '88888888-0000-4000-8000-000000000002', ref: 'EXP-SYNC03' };
    f.tables.colis.push(onlineParcel);
    await f.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await f.page.getByText('EXP-SYNC03', { exact: true }).filter({ visible: true }).first().waitFor();
    console.log('PASS: missed creation recovered on network reconnection');

    const periodicParcel = { ...colleagueParcel, id: '88888888-0000-4000-8000-000000000003', ref: 'EXP-SYNC04' };
    f.tables.colis.push(periodicParcel);
    await f.page.clock.fastForward(61000);
    await f.page.getByText('EXP-SYNC04', { exact: true }).filter({ visible: true }).first().waitFor();
    console.log('PASS: visible idle tab recovers missed events periodically');

    colleagueParcel.archive = true;
    colleagueParcel.updated_at = new Date(Date.now() + 1000).toISOString();
    await f.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await f.page.clock.fastForward(200);
    await f.page.getByText('EXP-SYNC02', { exact: true }).filter({ visible: true }).waitFor({ state: 'hidden' });
    console.log('PASS: a colleague archiving a dossier updates the active list');

    const before = reads.length;
    await f.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await f.page.clock.fastForward(200);
    await f.page.waitForFunction(() => !document.body.innerText.includes('Chargement de votre espace'));
    await new Promise(resolve => setTimeout(resolve, 500));
    const after = reads.slice(before).map(value => new URLSearchParams(value));
    assert.ok(after.some(params => params.get('select') === 'id,updated_at,client_id'));
    assert.ok(after.every(params => !params.has('id')), 'Unchanged dossiers must not refetch their details and relations');
    console.log('PASS: unchanged dossiers use a lightweight index only');

    failIndex = true;
    await f.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await f.page.clock.fastForward(200);
    await f.page.getByRole('alert').filter({ hasText: 'Actualisation des dossiers impossible' }).waitFor();
    await f.page.getByText('EXP-SYNC03', { exact: true }).filter({ visible: true }).first().waitFor();
    failIndex = false;
    await f.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await f.page.clock.fastForward(200);
    await f.page.getByRole('alert').filter({ hasText: 'Actualisation des dossiers impossible' }).waitFor({ state: 'hidden' });
    console.log('PASS: failed refresh keeps existing data and reports recovery');
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.networkDenied, []);

    const clientSession = await setup(browser, 'client');
    try {
      await clientSession.login();
      const refreshed = clientSession.page.waitForRequest(request => new URL(request.url()).pathname === '/rest/v1/client_colis');
      await clientSession.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await refreshed;
      assert.ok(!clientSession.requests.some(request => request.path === '/rest/v1/colis'), 'Client sessions never use the staff index or raw dossier reads');
      assert.deepEqual(clientSession.errors, []);
      assert.deepEqual(clientSession.networkDenied, []);
      console.log('PASS: client refresh remains restricted to safe client views');
    } finally { await clientSession.context.close(); }
  } finally {
    await f.context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
