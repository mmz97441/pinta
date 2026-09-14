/* Reference lookup regressions. All API/WebSocket traffic is mocked by setup. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setup, ids, base } = require('./browser-regression.cjs');
const { C } = ids;
const REMOTE = '88888888-2222-4222-8222-222222222222';
const ARCHIVED = '99999999-2222-4222-8222-222222222222';
const DEPARTURE = 'aaaaaaaa-2222-4222-8222-222222222222';
const output = process.env.PINTA_REFERENCE_OUT || path.join(os.tmpdir(), 'pinta-reference-search');
const results = [];

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let fixture;
  let releaseSlow;
  try {
    fixture = await setup(browser, 'directeur');
    const { page, context, tables } = fixture;
    page.setDefaultTimeout(15000);
    Object.assign(tables.colis[0], { ref: 'EXP-ABC234', statut: 'autorise' });
    tables.envois.push({ id: DEPARTURE, ref: 'ENV-TEST', statut: 'planifie', date_depart: '2026-10-01' });
    const remote = { ...tables.colis[0], id: REMOTE, ref: 'EXP-ZYX987', desc_contenu: 'Dossier reçu par un collègue' };
    const archived = { ...remote, id: ARCHIVED, ref: 'EXP-0042', statut: 'annule', archive: true };
    const lookupRequests = [];
    const lookupRows = [tables.colis[0], remote, archived];
    let failLookup = false;
    const slowResponse = new Promise(resolve => { releaseSlow = resolve; });
    await context.route('**/rest/v1/colis?*', async route => {
      const request = route.request();
      const params = new URL(request.url()).searchParams;
      const referenceFilter = params.get('ref');
      if (request.method() !== 'GET') return route.fallback();
      if (!referenceFilter) {
        const id = params.get('id')?.replace(/^eq\./, '');
        const row = [remote, archived].find(item => item.id === id);
        if (!row) return route.fallback();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) });
      }
      lookupRequests.push(Object.fromEntries(params));
      assert.equal(params.get('select'), 'id,ref,statut,archive');
      assert.equal(params.get('limit'), '2');
      assert.deepEqual([...params.keys()].sort(), ['limit', 'ref', 'select']);
      assert.match(referenceFilter, /^ilike\.EXP-(?:[A-Z0-9]{6}|\d{4,})$/);
      if (failLookup) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Connexion momentanément indisponible.' }) });
      if (referenceFilter === 'ilike.EXP-SLOW12') await slowResponse;
      let rows = lookupRows.filter(row => row.ref.toUpperCase() === referenceFilter.slice(6).toUpperCase());
      if (referenceFilter === 'ilike.EXP-DOUBLE') rows = [{ ...remote, ref: 'EXP-DOUBLE' }, { ...archived, ref: 'exp-double' }];
      const body = JSON.stringify(rows.map(({ id, ref, statut, archive }) => ({ id, ref, statut, archive })));
      await route.fulfill({ status: 200, contentType: 'application/json', body }).catch(() => {});
    });
    await fixture.login();
    await page.getByRole('button', { name: 'Dossiers d’expédition', exact: true }).click();
    const search = page.getByRole('textbox', { name: 'Rechercher ou scanner un colis' });
    const panel = page.getByRole('region', { name: 'Recherche de référence dans tous les dossiers' });
    await search.fill('EXP-ZYX');
    await page.waitForTimeout(600);
    assert.equal(lookupRequests.length, 0, 'A partial reference must not query the server');
    await search.fill('Client exemple');
    await page.waitForTimeout(500);
    assert.equal(lookupRequests.length, 0, 'A normal text search stays local');
    results.push({ test: 'partial-references-and-normal-searches-do-not-query-server', pass: true });

    await search.fill('exp–zyx987');
    await panel.getByText('Dossier trouvé en dehors de la liste actuelle. Vos filtres sont conservés.', { exact: true }).waitFor();
    assert.equal(lookupRequests.at(-1).ref, 'ilike.EXP-ZYX987');
    assert.equal(await page.getByText('0 dossier(s) affiché(s)', { exact: true }).count(), 1);
    await panel.getByRole('button', { name: 'Ouvrir le dossier', exact: true }).click();
    await page.waitForURL('**/colis/' + REMOTE + '?*');
    await page.getByText('EXP-ZYX987', { exact: true }).first().waitFor();
    assert.equal(new URL(new URL(page.url()).searchParams.get('returnTo'), base).searchParams.get('q'), 'exp–zyx987');
    results.push({ test: 'case-and-unicode-hyphen-normalization-finds-uncached-dossier-and-opens-full-detail', pass: true });

    await page.goto(base + '/colis');
    await search.fill('EXP-ZYX987');
    await search.press('Enter');
    await page.waitForURL('**/colis/' + REMOTE + '?*');
    await page.getByText('EXP-ZYX987', { exact: true }).first().waitFor();
    results.push({ test: 'scanner-enter-before-debounce-opens-correct-dossier-on-confirmed-response', pass: true });

    const filters = { q: 'EXP-ZYX987', owner: 'mine', client: C, envoi: DEPARTURE, dest: '976', tab: 'done', work: 'preparation' };
    await page.goto(base + '/colis?' + new URLSearchParams(filters));
    await panel.getByRole('button', { name: 'Ouvrir le dossier', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Filtres avancés/ }).getAttribute('aria-expanded'), 'false');
    const activeFilters = page.locator('[aria-label="Filtres actifs"]');
    for (const label of ['File : Préparer les dossiers', 'Client : Exemple Camille', 'Départ : ENV-TEST', 'Référent : Mes dossiers', 'Destination : Mayotte', 'Étape : Livrés']) {
      await activeFilters.getByText(label, { exact: true }).waitFor();
    }
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), filters, 'The global result must preserve every active filter');
    await page.screenshot({ path: path.join(output, 'reference-outside-filter-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Six filter chips must wrap within the mobile viewport');
    await panel.getByRole('button', { name: 'Ouvrir le dossier', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'reference-outside-filter-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Retirer les filtres', exact: true }).first().click();
    assert.equal(new URL(page.url()).searchParams.get('q'), 'EXP-ZYX987');
    for (const key of ['owner', 'client', 'envoi', 'dest', 'tab', 'work']) assert.equal(new URL(page.url()).searchParams.has(key), false);
    results.push({ test: 'all-active-filter-chips-visible-while-collapsed-and-clear-preserves-query', pass: true });

    await search.fill('EXP-0042');
    await panel.getByText(/EXP-0042.*Archivé/).waitFor();
    assert.equal(new URL(page.url()).searchParams.has('archive'), false, 'An archived match must not silently change the archive filter');
    await panel.getByRole('button', { name: 'Ouvrir le dossier', exact: true }).click();
    await page.waitForURL('**/colis/' + ARCHIVED + '?*');
    await page.getByText('EXP-0042', { exact: true }).first().waitFor();
    results.push({ test: 'historical-reference-finds-and-opens-archived-cancelled-dossier', pass: true });

    await page.goto(base + '/colis');
    failLookup = true;
    await search.fill('EXP-ZYX987');
    await search.press('Enter');
    await panel.getByRole('alert').waitFor();
    assert.match(await panel.innerText(), /Impossible de vérifier cette référence/);
    assert.doesNotMatch(await panel.innerText(), /Aucun dossier accessible/);
    assert.equal(new URL(page.url()).pathname, '/colis');
    failLookup = false;
    await panel.getByRole('button', { name: 'Réessayer la recherche', exact: true }).click();
    await panel.getByRole('button', { name: 'Ouvrir le dossier', exact: true }).waitFor();
    results.push({ test: 'lookup-network-error-is-explicit-retryable-and-never-reported-as-missing', pass: true });

    await search.fill('EXP-DOUBLE');
    await panel.getByRole('alert').filter({ hasText: 'Plusieurs dossiers' }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Ouvrir le dossier', exact: true }).count(), 0, 'An ambiguous reference must not choose a dossier silently');
    results.push({ test: 'duplicate-case-insensitive-reference-is-reported-instead-of-arbitrary-open', pass: true });

    await search.fill('EXP-MISS99');
    await search.press('Enter');
    await panel.getByText('Aucun dossier accessible ne porte la référence EXP-MISS99. Vérifiez le numéro saisi.', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('alert').count(), 0);
    assert.equal(new URL(page.url()).pathname, '/colis');
    results.push({ test: 'confirmed-empty-server-response-reports-reference-not-found', pass: true });

    const slowRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get('ref') === 'ilike.EXP-SLOW12');
    await search.fill('EXP-SLOW12');
    await search.press('Enter');
    await slowRequest;
    await panel.getByText('Vérification de EXP-SLOW12…', { exact: true }).waitFor();
    assert.doesNotMatch(await panel.innerText(), /Aucun dossier accessible/);
    await search.fill('EXP-ZYX987');
    await panel.getByRole('button', { name: 'Ouvrir le dossier', exact: true }).waitFor();
    releaseSlow();
    await page.waitForTimeout(250);
    assert.match(await panel.innerText(), /EXP-ZYX987/);
    assert.doesNotMatch(await panel.innerText(), /SLOW12|Aucun dossier accessible/);
    assert.equal(new URL(page.url()).pathname, '/colis', 'Changing the query cancels a pending scan opening');
    results.push({ test: 'slow-obsolete-response-cannot-overwrite-current-reference-result', pass: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole('button', { name: 'Ouvrir le dossier', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The lookup fits the mobile viewport');
    const openButton = await panel.getByRole('button', { name: 'Ouvrir le dossier', exact: true }).boundingBox();
    assert.ok(openButton.height >= 44);
    await page.screenshot({ path: path.join(output, 'reference-mobile.png') });
    results.push({ test: 'mobile-reference-result-fits-screen-with-accessible-open-target', pass: true });
    assert.deepEqual(fixture.errors, []);
    assert.deepEqual(fixture.networkDenied, []);
    assert.ok(lookupRequests.length > 0 && lookupRequests.every(request => !request.archive && !request.client_id && !request.cree_par), 'Reference lookups remain independent from archive/client/creator filters');
    results.push({ test: 'all-reference-queries-are-exact-bounded-read-only-and-network-isolated', pass: true });
  } catch (error) {
    results.push({ test: 'failure', message: error.stack });
    if (fixture?.page) await fixture.page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    releaseSlow?.();
    await browser.close();
    await fs.writeFile(path.join(output, 'reference-search-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
})();
