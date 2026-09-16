/* Isolated fixture: a second receiver updates the dossier while the first form stays open. */
const { chromium } = require('playwright');
const { setup, ids } = require('./browser-regression.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await setup(browser, 'directeur');
    const original = f.tables.colis[0]; original.statut = 'receptionne';
    const originalVersion = original.updated_at;
    let changesChannel;
    await f.context.routeWebSocket('**/*', socket => {
      socket.onMessage(raw => {
        if (typeof raw !== 'string') return;
        const decoded = JSON.parse(raw);
        const array = Array.isArray(decoded);
        const [joinRef, ref, topic, event, payload] = array ? decoded : [decoded.join_ref, decoded.ref, decoded.topic, decoded.event, decoded.payload];
        const filters = (payload?.config?.postgres_changes || []).map((filter, index) => ({ ...filter, id: index + 1 }));
        const reply = { status: 'ok', response: event === 'phx_join' ? { postgres_changes: filters } : {} };
        socket.send(JSON.stringify(array ? [joinRef, ref, topic, 'phx_reply', reply] : { join_ref: joinRef, ref, topic, event: 'phx_reply', payload: reply }));
        if (event === 'phx_join' && filters.some(filter => filter.table === 'colis')) changesChannel = { socket, array, joinRef, topic, filterId: filters.find(filter => filter.table === 'colis').id };
      });
    });
    let patchVersion;
    f.page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'PATCH' && url.pathname === '/rest/v1/colis') patchVersion = url.searchParams.get('updated_at');
    });
    f.page.setDefaultTimeout(10000);
    await f.login();
    await f.page.getByRole('button', { name: 'Réceptionner des cartons', exact: true }).first().click();
    const dialog = f.page.getByRole('dialog', { name: 'Réceptionner des cartons' });
    await dialog.getByPlaceholder('Rechercher un client…').fill('Camille');
    await dialog.getByRole('button').filter({ hasText: /Exemple/ }).first().click();
    await dialog.getByRole('button').filter({ hasText: 'EXP-TEST-001' }).click();
    await dialog.getByRole('heading', { name: 'Carton 3', level: 3, exact: true }).waitFor();
    await dialog.getByLabel('Numéro de suivi · carton 3').fill('LOCAL-ADDITION');
    for (const [label, value, unit] of [['Longueur', '30', 'cm'], ['Largeur', '20', 'cm'], ['Hauteur', '10', 'cm'], ['Poids', '1.5', 'kg']]) {
      await dialog.getByLabel(`${label} à réception (${unit}) · carton 3`, { exact: true }).fill(value);
    }
    assert.ok(changesChannel, 'A real provider subscription is connected to the local mock');
    Object.assign(original, { nb_colis: 4, trackings: ['TEST-001', 'TEST-002', 'REMOTE-03', 'REMOTE-04'], updated_at: '2026-09-10T11:59:00Z' });
    const payload = { ids: [changesChannel.filterId], data: { schema: 'public', table: 'colis', type: 'UPDATE', commit_timestamp: original.updated_at, columns: [], record: original, old_record: { id: ids.P } } };
    const refresh = f.page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/rest/v1/colis' && new URL(response.url()).searchParams.get('id') === `eq.${ids.P}`);
    changesChannel.socket.send(JSON.stringify(changesChannel.array ? [changesChannel.joinRef, null, changesChannel.topic, 'postgres_changes', payload] : { join_ref: changesChannel.joinRef, ref: null, topic: changesChannel.topic, event: 'postgres_changes', payload }));
    await refresh;
    // Visible dashboard state behind the modal confirms the provider finished its relation fetch.
    await f.page.waitForTimeout(500);
    await dialog.getByRole('heading', { name: 'Carton 3', level: 3, exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Rattacher à EXP-TEST-001', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'modifié par un collègue' }).waitFor();
    assert.equal(patchVersion, `eq.${originalVersion}`, 'The submitted snapshot, not the refreshed cache, guards the write');
    assert.equal(original.nb_colis, 4);
    assert.equal(original.ref, 'EXP-TEST-001');
    assert.deepEqual(original.trackings, ['TEST-001', 'TEST-002', 'REMOTE-03', 'REMOTE-04']);
    assert.deepEqual(f.errors, []);
    const result = { test: 'concurrent-reception-preserves-colleague-cartons-after-provider-refresh', pass: true, conflictVisible: true, originalSnapshotUsed: true, remoteCartonsPreserved: 4, pageErrors: f.errors, unexpectedNetwork: f.networkDenied };
    const out = process.env.PINTA_UX_TEAM_OUT || path.resolve(__dirname, '../../docs/verification-ux-equipe-2026-09-10');
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, 'concurrency-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    await f.context.close();
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
