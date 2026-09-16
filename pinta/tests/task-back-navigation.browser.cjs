/* Navigation-only regression: all APIs are mocked and business state must remain identical. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_TASK_BACK_OUT || '/tmp/pinta-task-back-navigation';
const results = [];
const header = f => f.page.getByTestId('dossier-task-header');
const snapshot = f => JSON.stringify({ parcels: f.tables.colis, invoices: f.tables.factures, articles: f.tables.lignes, messages: f.tables.messages });
const returnTo = '/?section=progress&mission=documents&q=Exemple';
async function open(f, task) {
 await f.page.goto(`${base}/colis/${ids.P}?${new URLSearchParams({ section: task, returnTo })}`);
 await header(f).waitFor();
}
async function task(f, expected) {
 await f.page.waitForURL(url => url.pathname === '/colis/' + ids.P && url.searchParams.get('section') === expected);
 await f.page.waitForFunction(value => document.querySelector('select[aria-label="Tâche du dossier"]')?.value === value, expected);
 assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), returnTo);
}
function noWrite(f, before) {
 assert.equal(snapshot(f), before, 'Browsing backwards must not alter status, validated data, documents or articles');
 assert.equal(f.requests.some(request => /\/(save_quote|save_invoice_review|save_preparation_measurements|queue_message|mutate_staff_work_action|revert_colis|revert_colis|revert_colis_status)$/.test(request.path)), false, 'A navigation control must not trigger a business operation');
 assert.equal(f.requests.some(request => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) && /^\/rest\/v1\/(colis|factures|lignes|messages)$/.test(request.path)), false);
 assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
}
(async () => {
 await fs.mkdir(output, { recursive: true });
 const browser = await chromium.launch({ headless: true });
 async function scenario(name, mobile, restricted, run) {
  const f = await setup(browser, restricted ? 'preparateur' : 'directeur');
  f.page.setDefaultTimeout(10000);
  if (restricted) {
   const permissions = { id: 'quote-only', staff_id: ids.S, perm_colis_calculer_devis: true, perm_colis_preparer: false,
    perm_factures_voir: false, perm_factures_ajouter: false, perm_factures_valider: false,
    perm_factures_refuser: false, perm_factures_ocr: false, perm_factures_modifier_articles: false };
   f.tables.staff_permissions = [permissions]; f.tables.staff_users[0].staff_permissions = permissions;
  }
  try {
   await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
   await f.login(); const before = snapshot(f); await run(f); noWrite(f, before);
   assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
   results.push({ test: name, pass: true });
  } catch (error) {
   process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
   await f.page.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {});
   await fs.writeFile(path.join(output, name + '-failure.txt'), await f.page.locator('body').innerText().catch(() => ''));
  } finally { await f.context.close(); }
 }
 try {
  for (const mobile of [false, true]) {
   const device = mobile ? 'mobile' : 'desktop';
   await scenario(`quote-documents-roundtrip-preserves-manual-draft-${device}`, mobile, false, async f => {
    await open(f, 'devis');
    await f.page.getByTestId('quote-action-bar').waitFor();
    assert.equal(await f.page.getByRole('region', { name: 'Document source', exact: true }).count(), 0);
    const back = header(f).getByRole('button', { name: 'Revenir aux factures', exact: true });
    await back.waitFor(); await back.focus(); await f.page.keyboard.press('Enter'); await task(f, 'documents');
    await f.page.locator('summary').filter({ hasText: 'Ajouter un article sans facture source' }).click();
    const description = f.page.getByLabel('Description du nouvel article', { exact: true });
    await description.fill('Saisie manuelle locale à conserver');
    await f.page.getByLabel('Prix du nouvel article', { exact: true }).fill('12.40');
    await f.page.getByLabel('Catégorie du nouvel article', { exact: true }).selectOption('cat-test');
    await f.page.getByRole('button', { name: 'Passer au devis', exact: true }).click(); await task(f, 'devis');
    await f.page.getByTestId('quote-action-bar').waitFor();
    assert.equal(await f.page.getByRole('region', { name: 'Factures d’achat', exact: true }).count(), 0);
    assert.equal(await f.page.getByRole('region', { name: 'Document source', exact: true }).count(), 0);
    const audit = await new AxeBuilder({ page: f.page }).include('[data-testid="dossier-task-header"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    assert.deepEqual(audit.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), []);
    await f.page.screenshot({ path: path.join(output, `back-header-${device}.png`) });
    await back.click(); await task(f, 'documents');
    await description.waitFor(); assert.equal(await description.inputValue(), 'Saisie manuelle locale à conserver');
    assert.equal(await f.page.getByLabel('Prix du nouvel article', { exact: true }).inputValue(), '12.40');
    assert.equal(await f.page.getByLabel('Catégorie du nouvel article', { exact: true }).inputValue(), 'cat-test');
   });
   await scenario(`preparation-agreement-roundtrip-preserves-local-measures-${device}`, mobile, false, async f => {
    await open(f, 'preparation');
    await f.page.getByRole('button', { name: 'Modifier les mesures', exact: true }).click();
    const length = f.page.getByLabel('Longueur · colis sortant 1 (cm)', { exact: true });
    await length.fill('39');
    await f.page.getByLabel('Poids réel · colis sortant 1 (kg)', { exact: true }).fill('4.25');
    await f.page.locator('summary').filter({ hasText: 'Consignes facultatives' }).click();
    const comment = f.page.getByLabel('Commentaire de préparation', { exact: true });
    await comment.fill('Protéger les articles fragiles avant fermeture.');
    await header(f).getByRole('button', { name: 'Revenir à l’accord client', exact: true }).click(); await task(f, 'accord');
    await f.page.getByText('Accord enregistré pour la préparation.', { exact: true }).waitFor();
    assert.equal(f.tables.colis[0].statut, 'en_preparation'); assert.equal(f.tables.colis[0].feu_vert, 'autorise');
    await header(f).getByLabel('Tâche du dossier', { exact: true }).selectOption('preparation'); await task(f, 'preparation');
    await length.waitFor(); assert.equal(await length.inputValue(), '39');
    assert.equal(await f.page.getByLabel('Poids réel · colis sortant 1 (kg)', { exact: true }).inputValue(), '4.25');
    await f.page.locator('summary').filter({ hasText: 'Consignes facultatives' }).click();
    assert.equal(await comment.inputValue(), 'Protéger les articles fragiles avant fermeture.');
    assert.equal(f.tables.colis[0].fin_l, 30); assert.equal(f.tables.colis[0].fin_p, 3);
   });
   await scenario(`quote-permission-only-back-skips-invoices-and-preserves-work-list-${device}`, mobile, true, async f => {
    await open(f, 'devis');
    await f.page.getByTestId('quote-action-bar').waitFor();
    assert.equal(await header(f).getByLabel('Tâche du dossier', { exact: true }).locator('option[value="documents"]').count(), 0);
    assert.equal(await header(f).getByRole('button', { name: 'Revenir aux factures', exact: true }).count(), 0);
    await header(f).getByRole('button', { name: 'Revenir à la préparation', exact: true }).click(); await task(f, 'preparation');
    assert.equal(await f.page.getByRole('button', { name: 'Modifier les mesures', exact: true }).count(), 0);
    assert.equal(f.requests.some(request => request.path.endsWith('/get_invoice_review_context')), false);
    await header(f).getByRole('button', { name: 'Retour à la liste de travail', exact: true }).click();
    await f.page.waitForURL(url => url.pathname + url.search === returnTo);
    await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
   });
  }
 } finally { await browser.close(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
