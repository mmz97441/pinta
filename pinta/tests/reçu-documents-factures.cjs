/* Documents received through messages remain visible before invoice import.
 * All API, file and WebSocket traffic is intercepted; fixtures are fictitious. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setup, ids, base } = require('./browser-regression.cjs');
const { P } = ids;
const output = process.env.PINTA_RECEIVED_DOCS_OUT || path.join(os.tmpdir(), 'pinta-received-documents');
const results = [];
async function openReceived(page, count) {
  const summary = page.locator('#quote-documents summary').filter({ hasText: `Documents reçus à vérifier (${count})` });
  await summary.waitFor();
  if (!await summary.locator('..').evaluate(element => element.open)) await summary.click();
  await page.getByRole('region', { name: 'Documents reçus à vérifier', exact: true }).waitFor();
}


(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let fixture;
  try {
    fixture = await setup(browser, 'directeur');
    const { tables, page, context } = fixture;
    page.setDefaultTimeout(15000);
    tables.factures = []; tables.lignes = [];
    Object.assign(tables.colis[0], { statut: 'autorise', paiement_date: null });
    const first = { id: 'document-message-1', colis_id: P, type: 'client', auteur_nom: 'Client exemple', texte: 'Document du premier achat', canal: 'telegram', lu: true, attachment_path: P + '/achat-un.pdf', attachment_name: 'achat-un.pdf', attachment_type: 'application/pdf', created_at: '2026-09-10T08:00:00Z' };
    const second = { ...first, id: 'document-message-2', texte: 'Document du second achat', attachment_path: P + '/achat-deux.pdf', attachment_name: 'achat-deux.pdf', created_at: '2026-09-10T09:00:00Z' };
    tables.messages = [first, { ...first, id: 'duplicate-first-message' }, second];
    let failImport = false, failRefresh = false;
    const imports = [];
    await context.route('**/rest/v1/rpc/import_conversation_invoice', async route => {
      const input = route.request().postDataJSON();
      imports.push(input);
      if (failImport) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'Ajout temporairement impossible. Réessayez.' }) });
      const message = tables.messages.find(item => item.id === input.p_message_id);
      let invoice = tables.factures.find(item => item.fichier_url === message.attachment_path);
      if (!invoice) {
        invoice = { id: 'received-invoice-' + tables.factures.length, colis_id: P, vendeur: 'Document à vérifier', montant: 0, valide: false, fichier_url: message.attachment_path, fichier_nom: message.attachment_name };
        tables.factures.push(invoice);
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invoice) });
    });
    await context.route('**/rest/v1/colis?*', async route => {
      if (failRefresh && new URL(route.request().url()).searchParams.get('id') === 'eq.' + P) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Lecture du dossier indisponible.' }) });
      return route.fallback();
    });
    await fixture.login();
    await page.goto(base + '/colis?dossier=' + P);
    const collapsedSummary = page.getByRole('button', { name: /^Factures \(0\) · 2 documents reçus à vérifier/ });
    await collapsedSummary.waitFor();
    assert.equal(await collapsedSummary.getAttribute('aria-expanded'), 'false');
    assert.equal(await collapsedSummary.getByText('Manquante', { exact: true }).count(), 0);
    await collapsedSummary.click();
    await openReceived(page, 2);
    results.push({ test: 'collapsed-dossier-invoice-summary-announces-received-documents-before-opening', pass: true });
    await page.goto(base + '/colis/' + P);
    const invoices = page.getByRole('region', { name: 'Factures d’achat', exact: true });
    const received = invoices.getByRole('region', { name: 'Documents reçus à vérifier', exact: true });
    await openReceived(page, 2);
    assert.equal(await received.getByRole('link', { name: /^achat-(un|deux)\.pdf$/ }).count(), 2, 'The same storage path in two messages appears only once');
    assert.equal(await invoices.getByText('Aucune facture reçue', { exact: true }).count(), 0, 'Received documents must not be reported as never received');
    const firstDocument = received.getByRole('link', { name: 'achat-un.pdf', exact: true }).locator('..');
    const privateLink = firstDocument.getByRole('link', { name: 'achat-un.pdf', exact: true });
    await privateLink.waitFor();
    assert.match(await privateLink.getAttribute('href'), /\/storage\/v1\/object\/sign\//);
    assert.equal(await privateLink.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(imports.length, 0, 'Opening the dossier does not auto-import arbitrary attachments');
    results.push({ test: 'unimported-message-documents-visible-private-and-deduplicated', pass: true });

    await firstDocument.getByRole('button', { name: 'Voir l’aperçu', exact: true }).click();
    await firstDocument.locator('canvas[data-rendered="true"]').waitFor();
    await firstDocument.getByText('Page 1 sur 2', { exact: true }).waitFor();
    await firstDocument.getByRole('button', { name: 'Fermer l’aperçu', exact: true }).click();
    results.push({ test: 'private-pdf-preview-renders-before-import', pass: true });
    await page.screenshot({ path: path.join(output, 'documents-received-desktop.png') });

    await firstDocument.getByRole('button', { name: 'Ajouter comme facture', exact: true }).click();
    await openReceived(page, 1);
    assert.equal(await received.getByRole('link', { name: 'achat-un.pdf', exact: true }).count(), 0);
    assert.equal(tables.factures.length, 1);
    assert.equal(tables.factures[0].valide, false);
    assert.equal(tables.factures[0].montant, 0);
    assert.equal(tables.factures[0].fichier_url, first.attachment_path);
    assert.equal(await invoices.getByRole('navigation', { name: 'Factures du dossier', exact: true }).getByRole('button').filter({ hasText: 'À vérifier' }).count(), 1);
    assert.equal(imports.length, 1);
    assert.equal(await page.locator('#conversation-client').getByRole('button', { name: 'Utiliser comme facture', exact: true }).count(), 1, 'The chat also suppresses import for the newly imported path');
    await page.goto(base + '/colis?dossier=' + P);
    await page.getByRole('button', { name: /^Factures \(1\) · 1 document reçu à vérifier/ }).waitFor();
    await page.goto(base + '/colis/' + P);
    await openReceived(page, 1);
    results.push({ test: 'import-creates-one-unvalidated-invoice-and-removes-pending-and-chat-duplicates', pass: true });

    failImport = true;
    await received.getByRole('button', { name: 'Ajouter comme facture', exact: true }).click();
    await received.getByRole('alert').filter({ hasText: 'Ajout temporairement impossible' }).waitFor();
    assert.equal(tables.factures.length, 1);
    assert.equal(await received.getByRole('link', { name: 'achat-deux.pdf', exact: true }).count(), 1);
    failImport = false;
    failRefresh = true;
    await received.getByRole('button', { name: 'Ajouter comme facture', exact: true }).click();
    await received.getByRole('alert').filter({ hasText: 'Facture enregistrée. Actualisation impossible' }).waitFor();
    assert.equal(tables.factures.length, 2);
    const callsBeforeRefresh = imports.length;
    failRefresh = false;
    await received.getByRole('button', { name: 'Réessayer l’actualisation', exact: true }).click();
    await received.waitFor({ state: 'detached' });
    assert.equal(imports.length, callsBeforeRefresh, 'Refreshing after a successful import must not call the import RPC again');
    assert.equal(tables.factures.length, 2);
    assert.ok(tables.factures.every(invoice => !invoice.valide));
    await page.goto(base + '/colis?dossier=' + P);
    const importedSummary = page.getByRole('button', { name: /^Factures \(2\)/ });
    await importedSummary.waitFor();
    assert.doesNotMatch(await importedSummary.innerText(), /documents? reçus? à vérifier/);
    results.push({ test: 'failed-import-retains-document-and-successful-import-refresh-can-retry-without-reimport', pass: true });

    tables.factures = []; tables.colis[0].statut = 'paye';
    // A terminal status protects the dossier even if an old payment date is missing.
    tables.colis[0].paiement_date = null;
    await page.goto(base + '/colis/' + P);
    await openReceived(page, 2);
    await received.getByText('Consultation uniquement : ce dossier est payé, terminé ou archivé.', { exact: true }).waitFor();
    assert.equal(await received.getByRole('button', { name: 'Ajouter comme facture', exact: true }).count(), 0);
    assert.equal(await invoices.getByRole('button', { name: 'Ajouter une facture', exact: true }).count(), 0);
    assert.equal(await page.locator('#conversation-client').getByRole('button', { name: 'Utiliser comme facture', exact: true }).count(), 0);
    await received.getByRole('link', { name: 'achat-un.pdf', exact: true }).waitFor();
    results.push({ test: 'paid-dossier-retains-document-reading-and-disables-all-invoice-import-entry-points', pass: true });

    for (const changes of [{ statut: 'livre', archive: false, paiement_date: null }, { statut: 'autorise', archive: true, paiement_date: null }, { statut: 'autorise', archive: false, paiement_date: '2026-09-10T10:00:00Z' }]) {
      Object.assign(tables.colis[0], changes);
      await page.goto(base + '/colis/' + P);
      await openReceived(page, 2);
      assert.equal(await received.getByRole('button', { name: 'Ajouter comme facture', exact: true }).count(), 0);
      assert.equal(await page.locator('#conversation-client').getByRole('button', { name: 'Utiliser comme facture', exact: true }).count(), 0);
    }
    results.push({ test: 'completed-archived-or-payment-dated-dossiers-share-read-only-guards', pass: true });

    Object.assign(tables.colis[0], { statut: 'autorise', archive: false, paiement_date: null });
    await page.goto(base + '/colis/' + P);
    await page.setViewportSize({ width: 390, height: 844 });
    await openReceived(page, 2);
    await received.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Received documents fit mobile');
    const mobileButton = received.getByRole('button', { name: 'Ajouter comme facture', exact: true }).first();
    await mobileButton.scrollIntoViewIfNeeded();
    assert.ok((await mobileButton.boundingBox()).height >= 44);
    await page.screenshot({ path: path.join(output, 'documents-received-mobile.png') });
    assert.equal(imports.length, callsBeforeRefresh, 'Read-only checks and previews do not mutate invoices');
    assert.deepEqual(fixture.errors, []);
    assert.deepEqual(fixture.networkDenied, []);
    results.push({ test: 'mobile-documents-fit-and-only-explicit-import-mutates', pass: true });
    await context.close();

    fixture = await setup(browser, 'preparateur');
    fixture.tables.factures = []; fixture.tables.lignes = [];
    Object.assign(fixture.tables.colis[0], { statut: 'autorise', paiement_date: null });
    fixture.tables.messages = [first];
    await fixture.login();
    await fixture.page.goto(base + '/colis/' + P);
    const permissionRestricted = fixture.page.getByRole('region', { name: 'Documents reçus à vérifier', exact: true });
    await openReceived(fixture.page, 1);
    await permissionRestricted.getByRole('link', { name: 'achat-un.pdf', exact: true }).waitFor();
    assert.equal(await permissionRestricted.getByRole('button', { name: 'Ajouter comme facture', exact: true }).count(), 0);
    assert.equal(await fixture.page.locator('#conversation-client').getByRole('button', { name: 'Utiliser comme facture', exact: true }).count(), 0);
    assert.deepEqual(fixture.errors, []);
    assert.deepEqual(fixture.networkDenied, []);
    results.push({ test: 'staff-without-add-invoice-permission-can-read-but-cannot-import', pass: true });
  } catch (error) {
    results.push({ test: 'failure', message: error.stack });
    if (fixture?.page) await fixture.page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (!process.exitCode) await fs.rm(path.join(output, 'failure.png'), { force: true });
    await fs.writeFile(path.join(output, 'received-documents-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
})();
