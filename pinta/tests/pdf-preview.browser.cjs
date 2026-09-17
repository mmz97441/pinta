/* Real PDF.js rendering, with all remote traffic intercepted by the fixture transport. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const { base, ids: { P, F } } = require('./browser-regression.cjs');
const { fixture: invoiceFixture } = require('./invoice-workspace.cjs');
const output = process.env.PINTA_PDF_OUT || path.resolve(__dirname, '../../docs/verification-pdf-2026-09-10');
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let fixture;
  try {
    fixture = await invoiceFixture(browser);
    let resumeCalls = 0;
    await fixture.context.route('**/functions/v1/ocr-facture', async (route) => {
      resumeCalls++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, extraction: { id: '77777777-7777-4777-8777-777777777777', facture_id: F, status: 'review', vendeur: 'Boutique A', total: 100, lines: [{ desc: 'Article à relire', qte: 1, prix: 100, cat: 'cat-test' }], warnings: [] } }) });
    });
    await fixture.login();
    await fixture.page.goto(`${base}/colis/${P}?section=documents`);
    const canvas = fixture.page.locator('canvas[role="img"]');
    await fixture.page.getByRole('region', { name: 'Document source', exact: true }).scrollIntoViewIfNeeded();
    await fixture.page.locator('canvas[data-rendered="true"]').waitFor();
    await fixture.page.getByText('Page 1 sur 2', { exact: true }).waitFor();
    assert.equal(await fixture.page.getByRole('button', { name: 'Page précédente', exact: true }).isDisabled(), true);
    const first = await canvas.evaluate((node) => ({ data: node.toDataURL(), width: node.width, height: node.height }));
    assert.ok(first.width > 100 && first.height > 100);
    await fixture.page.getByRole('button', { name: 'Page suivante', exact: true }).click();
    await fixture.page.locator('canvas[data-rendered="true"][aria-label*="page 2"]').waitFor();
    const second = await canvas.evaluate((node) => node.toDataURL());
    assert.notEqual(second, first.data, 'Second page must have different rendered pixels');
    assert.equal(await fixture.page.getByRole('button', { name: 'Page suivante', exact: true }).isDisabled(), true);
    await fixture.page.getByLabel('Zoom du document', { exact: true }).selectOption('2');
    await fixture.page.waitForFunction((width) => { const node = document.querySelector('canvas[role="img"]'); return node?.dataset.rendered === 'true' && node.width >= width * 1.9; }, first.width);
    const zoomed = await canvas.evaluate((node) => ({ width: node.width, scrollWidth: node.parentElement.scrollWidth, clientWidth: node.parentElement.clientWidth }));
    assert.ok(zoomed.scrollWidth > zoomed.clientWidth);
    assert.equal(await fixture.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.page.screenshot({ path: path.join(output, 'pdf-two-pages-desktop.png') });
    results.push({ test: 'two-distinct-pages-render-and-zoom-within-document', pass: true, firstSize: { width: first.width, height: first.height }, zoomedWidth: zoomed.width });

    await fixture.page.setViewportSize({ width: 390, height: 844 });
    await fixture.page.getByRole('tab', { name: 'Vérifier les articles', exact: true }).click();
    await fixture.page.getByLabel('Description de l’article 1', { exact: true }).fill('Correction conservée entre les onglets');
    const callsBeforeTabs = resumeCalls;
    await fixture.page.getByRole('tab', { name: 'Voir la facture', exact: true }).click();
    await fixture.page.locator('canvas[data-rendered="true"][aria-label*="page 2"]').waitFor();
    assert.equal(await fixture.page.getByLabel('Zoom du document', { exact: true }).inputValue(), '2');
    await fixture.page.getByRole('tab', { name: 'Vérifier les articles', exact: true }).click();
    assert.equal(await fixture.page.getByLabel('Description de l’article 1', { exact: true }).inputValue(), 'Correction conservée entre les onglets');
    await fixture.page.getByRole('tab', { name: 'Voir la facture', exact: true }).click();
    await fixture.page.getByText('Page 2 sur 2', { exact: true }).waitFor();
    assert.equal(resumeCalls, callsBeforeTabs, 'Switching tabs must not reanalyse/reload OCR');
    assert.equal(await fixture.page.getByRole('tab', { name: 'Voir la facture', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await fixture.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.page.getByRole('region', { name: 'Document source', exact: true }).scrollIntoViewIfNeeded();
    await fixture.page.waitForTimeout(250);
    await fixture.page.screenshot({ path: path.join(output, 'pdf-page-two-mobile.png') });
    results.push({ test: 'mobile-tabs-preserve-page-zoom-and-edited-article', pass: true });

    await fixture.page.evaluate(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      let rejectOnce = true;
      HTMLCanvasElement.prototype.getContext = function (...args) {
        if (rejectOnce && this.matches('canvas[role="img"]')) { rejectOnce = false; throw new Error('Injected PDF rendering failure'); }
        return getContext.apply(this, args);
      };
    });
    await fixture.page.getByRole('button', { name: 'Page précédente', exact: true }).click();
    await fixture.page.getByRole('alert').filter({ hasText: 'Cette page ne peut pas être affichée' }).waitFor();
    await fixture.page.getByRole('button', { name: 'Page suivante', exact: true }).click();
    await fixture.page.locator('canvas[data-rendered="true"][aria-label*="page 2"]').waitFor({ timeout: 3000 });
    results.push({ test: 'a-page-render-failure-can-recover-on-next-page', pass: true });

    for (let i = 0; i < 8; i++) {
      await fixture.page.getByLabel('Zoom du document', { exact: true }).selectOption(i % 2 ? '1' : '1.5');
      const previous = fixture.page.getByRole('button', { name: 'Page précédente', exact: true });
      const next = fixture.page.getByRole('button', { name: 'Page suivante', exact: true });
      if (await previous.isEnabled()) await previous.click(); else await next.click();
    }
    await fixture.page.locator('canvas[data-rendered="true"]').waitFor();
    assert.equal(await fixture.page.getByRole('alert').filter({ hasText: 'Cette page ne peut pas' }).count(), 0);
    assert.equal(fixture.errors.length, 0, fixture.errors.join('\n'));
    assert.equal(fixture.networkDenied.length, 0, fixture.networkDenied.join('\n'));
    results.push({ test: 'rapid-page-and-zoom-changes-cancel-obsolete-rendering', pass: true });
  } catch (error) {
    if (fixture) await fixture.page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    results.push({ test: 'failure', pass: false, error: error.stack }); process.exitCode = 1;
  } finally {
    await browser.close(); if (!process.exitCode) await fs.rm(path.join(output, 'failure.png'), { force: true }); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
  }
}
main();
