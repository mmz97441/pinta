/* Real UI with fictitious data; all provider requests are intercepted. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ids, base } = require('./browser-regression.cjs');
const { fixture } = require('./invoice-workspace.cjs');
const output = process.env.PINTA_INVOICE_INDICATOR_OUT || path.join(os.tmpdir(), 'pinta-invoice-indicator');
const results = [];

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let f;
  try {
    f = await fixture(browser);
    const { page, tables } = f;
    page.setDefaultTimeout(15000);
    Object.assign(tables.colis[0], { statut: 'autorise', conversation_statut: 'termine' });
    const first = { ...tables.factures[0], valide: false };
    const second = { ...first, id: 'invoice-second', vendeur: 'Boutique B', fichier_url: ids.P + '/second.pdf', fichier_nom: 'second.pdf' };
    tables.factures = [{ ...first, id: 'invoice-validated', vendeur: 'Déjà validée', valide: true, fichier_url: ids.P + '/approved.pdf' }, first, second];
    tables.messages = [{ id: 'read-message', colis_id: ids.P, type: 'client', lu: true, texte: 'Voici ma facture', attachment_path: first.fichier_url }];
    const badge = (label = '2 factures reçues · À vérifier') => page.getByRole('link', { name: label + ' — EXP-TEST-001', exact: true }).filter({ visible: true });
    await f.login();
    await page.goto(base + '/colis?q=EXP-TEST-001');
    await badge().waitFor();
    assert.equal(await page.getByText('À répondre', { exact: true }).count(), 0);
    results.push({ test: 'received-invoice-indicator-visible-with-read-message-and-treated-conversation', pass: true });
    await badge().click();
    assert.equal(new URL(page.url()).searchParams.get('invoice'), first.id);
    const firstArticle = page.getByRole('region', { name: 'Vérification de la facture', exact: true });
    const firstDocument = page.getByRole('region', { name: 'Document source', exact: true });
    await firstDocument.locator('canvas[data-rendered="true"]').waitFor();
    assert.equal(await firstDocument.evaluate(element => element === document.activeElement), true);
    assert.equal(tables.factures.filter(invoice => invoice.valide).length, 1);
    results.push({ test: 'one-click-opens-and-focuses-correct-pending-pdf-without-validating-it', pass: true });
    await page.getByRole('tab', { name: 'Vérifier les articles', exact: true }).click();
    await firstArticle.getByRole('button', { name: 'Valider et passer à la suivante', exact: true }).click();
    await page.getByTestId('invoice-header-feedback').filter({ hasText: 'facture et articles validés et enregistrés' }).waitFor();
    await page.getByRole('button', { name: 'Retour à la liste de travail', exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get('q'), 'EXP-TEST-001');
    await badge('Facture reçue · À vérifier').waitFor();
    assert.equal(new URL(await badge('Facture reçue · À vérifier').getAttribute('href'), base).searchParams.get('invoice'), second.id);
    results.push({ test: 'validation-updates-count-and-next-target-while-return-preserves-filters', pass: true });

    await page.goto(base + '/?mission=preparation');
    await badge('Facture reçue · À vérifier').waitFor();
    results.push({ test: 'personal-work-shows-invoice-on-the-users-assigned-action', pass: true });
    tables.staff_work_actions.push({ ...tables.staff_work_actions[0], id: 'documents-action', kind: 'documents', assignee_id: null });
    await page.goto(base + '/?mission=documents&section=pool');
    await badge('Facture reçue · À vérifier').click();
    assert.equal(new URL(page.url()).searchParams.get('invoice'), second.id);
    assert.equal(tables.staff_work_actions.find(action => action.id === 'documents-action').assignee_id, null);
    await page.getByRole('button', { name: 'Retour à la liste de travail', exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get('section'), 'pool');
    results.push({ test: 'unassigned-work-links-directly-without-claiming-or-changing-team-priorities', pass: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/colis');
    await badge('Facture reçue · À vérifier').waitFor();
    assert.ok((await badge('Facture reçue · À vérifier').boundingBox()).height >= 44);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, 'indicator-mobile.png'), fullPage: true });
    Object.assign(tables.colis[0], { statut: 'en_preparation' });
    await badge('Facture reçue · À vérifier').click();
    await page.getByRole('region', { name: 'Document source', exact: true }).locator('canvas[data-rendered="true"]').waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Voir la facture', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByLabel('Facture à vérifier', { exact: true }).inputValue(), second.id);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    results.push({ test: 'mobile-indicator-and-preparation-link-open-document-tab-with-correct-invoice', pass: true });

    // Another team member's persisted validation is reflected after reloading.
    tables.factures.find(invoice => invoice.id === second.id).valide = true;
    await page.goto(base + '/colis');
    await page.getByRole('button', { name: 'EXP-TEST-001', exact: true }).filter({ visible: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: /factures? reçues? · À vérifier/i }).count(), 0);
    await page.goto(base + '/?mission=preparation');
    await page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: /factures? reçues? · À vérifier/i }).count(), 0);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.networkDenied, []);
    results.push({ test: 'colleague-validation-removes-indicator-from-list-and-personal-work', pass: true });
  } catch (error) {
    results.push({ test: 'failure', pass: false, error: error.stack, url: f?.page.url(), documents: await f?.page.locator('#quote-documents').innerText().catch(() => 'absent') });
    if (f?.page && !f.page.isClosed()) await f.page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    process.exitCode = 1;
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
})();
