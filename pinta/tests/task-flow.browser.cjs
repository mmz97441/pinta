/* Full task separation, using intercepted fictitious providers only. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { fixture, B, C } = require('./invoice-workspace.cjs');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_TASK_FLOW_OUT || '/tmp/pinta-task-flow';
const section = f => f.page.getByTestId('dossier-task-workspace');
const selectTask = (f, task) => f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption(task);
async function open(f, task) { await f.page.goto(`${base}/colis/${ids.P}?section=${task}&returnTo=${encodeURIComponent('/?mission=documents')}`); await section(f).waitFor(); }
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true }); const results = [];
  async function scenario(name, action, invoice = false) {
    const f = invoice ? await fixture(browser, { category: 'cat-test' }) : await setup(browser, 'directeur');
    f.page.setDefaultTimeout(10000);
    try { await f.login(); await action(f); assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []); results.push({ test: name, pass: true }); }
    catch (error) { results.push({ test: name, pass: false, error: error.stack }); process.exitCode = 1; await f.page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {}); await fs.writeFile(`${output}/${name}-failure.txt`, await f.page.locator('body').innerText().catch(() => '')); }
    finally { await f.context.close(); }
  }
  try {
    for (const mobile of [false, true]) await scenario(`invoice-task-to-quote-${mobile ? 'mobile' : 'desktop'}`, async f => {
      await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      await open(f, 'documents');
      assert.equal(await f.page.getByTestId('quote-action-bar').count(), 0);
      assert.equal(await f.page.getByLabel('Longueur · colis sortant 1 (cm)', { exact: true }).count(), 0);
      const next = f.page.getByRole('button', { name: 'Valider et passer à la suivante', exact: true }); await next.waitFor();
      await next.click();
      await f.page.waitForFunction(id => document.querySelector('select[aria-label="Facture à vérifier"]')?.value === id, C);
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, true);
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).valide, false);
      await f.page.getByRole('button', { name: 'Terminer la vérification', exact: true }).click();
      await f.page.getByText('Factures vérifiées', { exact: true }).waitFor();
      assert.equal(f.calls.filter(call => call.kind === 'save').length, 2);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === B).length, 1);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === C).length, 1);
      await f.page.getByRole('button', { name: 'Passer au devis', exact: true }).click();
      const saveQuote = f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis', exact: true }); await saveQuote.waitFor();
      assert.equal(await saveQuote.isEnabled(), true);
      assert.equal(await f.page.getByRole('region', { name: 'Factures d’achat', exact: true }).count(), 0);
      assert.equal(await f.page.getByRole('region', { name: 'Document source', exact: true }).count(), 0);
      assert.equal(await f.page.getByLabel('Description de l’article 1', { exact: true }).count(), 0);
      assert.equal(f.requests.some(request => request.path.endsWith('/queue_message')), false);
      const audit = await new AxeBuilder({ page: f.page }).include('[data-testid="dossier-task-workspace"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      assert.deepEqual(audit.violations.map(item => item.id), []);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await f.page.screenshot({ path: `${output}/quote-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    }, true);
    await scenario('preparation-completion-replaces-form-and-keeps-receipt', async f => {
      const received = JSON.stringify([f.tables.colis[0].trackings_detail, f.tables.colis[0].dims_par_colis, f.tables.colis[0].poids]);
      await open(f,'preparation');
      await f.page.getByRole('button', { name: 'Modifier les mesures', exact: true }).click();
      await f.page.getByLabel('Longueur · colis sortant 1 (cm)', { exact: true }).fill('38');
      await f.page.getByRole('button', { name: 'Enregistrer les mesures de préparation', exact: true }).click();
      await f.page.getByRole('button', { name: 'Modifier les mesures', exact: true }).waitFor();
      assert.equal(await f.page.getByLabel('Longueur · colis sortant 1 (cm)', { exact: true }).count(), 0);
      assert.equal(new URL(f.page.url()).searchParams.get('section'), 'preparation');
      assert.equal(JSON.stringify([f.tables.colis[0].trackings_detail, f.tables.colis[0].dims_par_colis, f.tables.colis[0].poids]), received);
      assert.equal(f.requests.some(request => /\/(save_quote|queue_message|save_invoice_review)$/.test(request.path)), false);
    });
    await scenario('documents-before-agreement-remain-independent', async f => {
      f.tables.colis[0].statut = 'attente_feu_vert'; f.tables.colis[0].feu_vert = 'en_attente';
      await open(f, 'documents');
      await f.page.getByRole('button', { name: 'Valider et passer à la suivante', exact: true }).waitFor();
      assert.equal(await f.page.getByTestId('quote-action-bar').count(), 0);
      await selectTask(f, 'preparation');
      await section(f).getByText('La préparation attend l’accord du client.', { exact: true }).waitFor();
      assert.equal(f.calls.filter(call => call.kind === 'save').length, 0);
      assert.equal(f.requests.some(request => request.path.endsWith('/save_preparation_measurements')), false);
    }, true);
    await scenario('shipping-status-update-does-not-send-notification', async f => {
      Object.assign(f.tables.colis[0], { statut: 'arrive', paiement_date: '2026-09-15T10:00:00Z', paiement_montant: 70 });
      await open(f,'livraison');
      const before = f.requests.filter(request => request.path.endsWith('/queue_message')).length;
      await f.page.getByRole('button', { name: 'Préparer une information au client', exact: true }).click();
      await f.page.getByLabel('Message à envoyer au client', { exact: true }).waitFor();
      await section(f).getByRole('button', { name: 'Fermer', exact: true }).click();
      assert.equal(f.requests.filter(request => request.path.endsWith('/queue_message')).length, before);
      const transition = section(f).getByRole('button', { name: 'Lancer la livraison', exact: true });
      await transition.click();
      await section(f).getByRole('button', { name: 'Confirmer la livraison', exact: true }).click();
      await f.page.getByRole('heading', { name: 'Livraison terminée', exact: true }).waitFor();
      assert.equal(f.tables.colis[0].statut, 'livre');
      assert.equal(f.requests.filter(request => request.path.endsWith('/queue_message')).length, before);
    });
  } finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(results,null,2)); console.log(JSON.stringify(results,null,2)); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
