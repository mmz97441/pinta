/* Fictitious transport only: this suite never opens a real customer dossier. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, ids, base } = require('./browser-regression.cjs');
const output = process.env.PINTA_DOSSIER_SHELL_OUT || '/tmp/pinta-dossier-shell';

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const mobile of [false, true]) {
      const f = await setup(browser, 'directeur');
      try {
        await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
        await f.login();
        if (mobile) await f.page.evaluate(() => localStorage.setItem('expedile-theme', 'dark'));
        await f.page.goto(`${base}/colis/${ids.P}?section=preparation&returnTo=${encodeURIComponent('/?mission=preparation')}`);
        await f.page.getByTestId('dossier-task-header').waitFor();
        assert.equal(await f.page.getByRole('region', { name: 'Mesures des cartons', exact: true }).count(), 0, 'Receipt context does not occupy the task page.');
        assert.equal(await f.page.getByRole('log', { name: 'Messages avec le client', exact: true }).count(), 0, 'Conversation is closed until explicitly requested.');
        const contextButton = f.page.getByRole('button', { name: /^Détails(?: du dossier)?$/, exact: true });
        await contextButton.click();
        const panel = f.page.getByRole('dialog', { name: 'Contexte du dossier', exact: true });
        await panel.waitFor();
        await panel.getByRole('region', { name: 'Mesures des cartons', exact: true }).waitFor();
        const close = panel.getByRole('button', { name: 'Fermer le contexte du dossier', exact: true });
        assert.equal(await close.evaluate(element => element === document.activeElement), true);
        await f.page.keyboard.press('Shift+Tab');
        assert.equal(await panel.evaluate(element => element.contains(document.activeElement)), true, 'Keyboard focus stays inside the context.');
        await f.page.keyboard.press('Escape');
        assert.equal(await panel.count(), 0);
        assert.equal(await contextButton.evaluate(element => element === document.activeElement), true, 'Closing restores the task trigger focus.');
        await contextButton.click();
        await panel.getByRole('button', { name: 'Messages', exact: true }).click();
        const reply = panel.getByLabel('Votre réponse au client', { exact: true });
        await reply.fill('Brouillon local conservé après fermeture du contexte');
        await panel.getByRole('button', { name: 'Réception', exact: true }).click();
        await close.click();
        await contextButton.click();
        await panel.getByRole('button', { name: 'Messages', exact: true }).click();
        assert.equal(await reply.inputValue(), 'Brouillon local conservé après fermeture du contexte');
        assert.equal(f.requests.some(request => /\/queue_message$/.test(request.path)), false, 'Opening context never sends a notification.');
        await panel.getByRole('button', { name: 'Documents', exact: true }).click();
        await panel.getByRole('region', { name: 'Documents du dossier', exact: true }).waitFor();
        assert.equal(await panel.getByRole('button', { name: 'Valider cette facture et ses articles', exact: true }).count(), 0, 'Context is not a second verification form.');
        await panel.getByRole('button', { name: 'Historique', exact: true }).click();
        await panel.getByText('Aucun événement enregistré.', { exact: true }).waitFor();
        const audit = await new AxeBuilder({ page: f.page }).include('[data-testid="dossier-context"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(audit.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) })), []);
        assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await f.page.screenshot({ path: `${output}/context-${mobile ? 'mobile-dark' : 'desktop'}.png` });
        await close.click();
        await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('documents');
        assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/?mission=preparation');
        assert.equal(new URL(f.page.url()).searchParams.get('section'), 'documents');
        await f.page.goto(`${base}/colis/${ids.P}?returnTo=%2F%3Fmission%3Dpreparation`);
        await f.page.waitForURL(url => url.searchParams.get('section') === 'devis');
        assert.deepEqual(f.errors, []);
        assert.deepEqual(f.networkDenied, []);
        results.push({ viewport: mobile ? 'mobile' : 'desktop', pass: true });
      } catch (error) {
        results.push({ viewport: mobile ? 'mobile' : 'desktop', pass: false, error: error.stack });
        await f.page.screenshot({ path: `${output}/failure-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
        await fs.writeFile(`${output}/failure-${mobile ? 'mobile' : 'desktop'}.txt`, await f.page.locator('body').innerText());
        process.exitCode = 1;
      } finally { await f.context.close(); }
    }
  } finally { await browser.close(); }
  await fs.writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
