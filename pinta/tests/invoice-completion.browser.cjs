/* Fictitious completion/consultation fixtures. All provider traffic is intercepted
 * by the shared invoice transport; this suite never opens real customer records. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture, B, C } = require('./invoice-workspace.cjs');
const { base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_INVOICE_COMPLETION_OUT || '/tmp/pinta-invoice-completion';
const clone = value => JSON.parse(JSON.stringify(value));
const invoicePanel = f => f.page.getByRole('region', { name: 'Factures d’achat', exact: true });
const review = f => f.page.getByRole('region', { name: 'Vérification de la facture', exact: true });
const noEditor = async f => {
  for (const label of ['Total HT de la facture', 'Description de l’article 1', 'Catégorie de l’article 1']) assert.equal(await f.page.getByLabel(label, { exact: true }).count(), 0, `Completed or retired document must not display a fake editable/disabled field: ${label}`);
  assert.equal(await f.page.getByRole('button', { name: /^(Valider et passer à la suivante|Terminer la vérification)$/ }).count(), 0);
};
async function completedFixture(browser, { manual = false, pending = false } = {}) {
  const f = await fixture(browser, { category: 'cat-test', unlinked: manual, noAnalysis: true });
  const copy = f.tables.factures.find(invoice => invoice.id === ids.F);
  Object.assign(copy, { duplicate_of_facture_id: B, valide: false, vendeur: 'Document à vérifier', montant: 0 });
  Object.assign(f.tables.factures.find(invoice => invoice.id === B), { valide: !pending, vendeur: 'Boutique B', montant: 16.64 });
  Object.assign(f.tables.factures.find(invoice => invoice.id === C), { valide: true, vendeur: 'Boutique C', montant: 28 });
  f.tables.lignes = [
    ...f.tables.lignes.filter(line => !line.facture_id),
    { id: 'completion-b', colis_id: ids.P, facture_id: B, description: 'Scelleuse thermique', qte: 1, prix_unitaire: 16.64, categorie_id: 'cat-test' },
    { id: 'completion-c', colis_id: ids.P, facture_id: C, description: 'Organisateur de bureau', qte: 1, prix_unitaire: 28, categorie_id: 'cat-test' },
  ];
  return f;
}
async function open(f, invoice = null) {
  const params = new URLSearchParams({ section: 'documents', returnTo: '/?mission=documents' });
  if (invoice) params.set('invoice', invoice);
  await f.page.goto(`${base}/colis/${ids.P}?${params}#quote-documents`);
  await invoicePanel(f).waitFor();
}
async function complete(f) { await invoicePanel(f).getByText('Factures vérifiées', { exact: true }).waitFor(); }
async function withinViewport(locator) {
  await locator.waitFor();
  await locator.page().waitForFunction(selector => {
    const target = document.querySelector(selector);
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    return rect.top >= 0 && rect.top < innerHeight && rect.bottom > 0;
  }, '#' + await locator.getAttribute('id'));
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  async function scenario(name, options, action) {
    if (process.env.PINTA_INVOICE_COMPLETION_FILTER && !name.includes(process.env.PINTA_INVOICE_COMPLETION_FILTER)) return;
    const f = await completedFixture(browser, options);
    try {
      await f.login(); await action(f);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
      assert.equal(f.calls.some(call => ['save','classify','restore'].includes(call.kind)), false, 'Consulting completed invoices never revalidates, reimports or restores them.');
      assert.equal(f.requests.some(request => /\/(save_quote|queue_message)$/.test(request.path)), false, 'Reaching the quote does not save or send it.');
      assert.deepEqual(f.mutations, [], 'Manual-line warning and cancel never mutate the invoice or article tables.');
      results.push({ test: name, pass: true });
    } catch (error) {
      results.push({ test: name, pass: false, error: error.stack, url: f.page.url(), calls: f.calls }); process.exitCode = 1;
      await f.page.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, name + '-failure.txt'), await f.page.locator('body').innerText().catch(() => ''));
    } finally { await f.context.close(); }
  }
  try {
    for (const mobile of [false, true]) await scenario(`all-active-invoices-verified-return-opens-summary-${mobile ? 'mobile' : 'desktop'}`, {}, async f => {
      await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      if (mobile) await f.page.evaluate(() => localStorage.setItem('expedile-theme', 'dark'));
      await open(f); await complete(f); await noEditor(f);
      assert.equal(f.tables.factures[0].duplicate_of_facture_id, B, 'Fixture deliberately puts the retired zero-amount copy first.');
      assert.match(await invoicePanel(f).innerText(), /2/);
      assert.equal(await invoicePanel(f).getByText('Choisissez une catégorie pour cet article.', { exact: true }).count(), 0);
      const rows = clone(f.tables.lignes);
      await invoicePanel(f).getByRole('button', { name: 'Passer au devis', exact: true }).click();
      await withinViewport(f.page.getByTestId('quote-action-bar'));
      const calculate = f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis', exact: true });
      assert.equal(await calculate.isEnabled(), true);
      assert.equal(f.tables.colis[0].quote_version, 0);
      assert.deepEqual(f.tables.lignes, rows);
      assert.equal(new URL(f.page.url()).searchParams.get('section'), 'devis');
      assert.equal(await invoicePanel(f).count(), 0, 'Quote task does not mount a second invoice editor.');
      await f.page.reload(); await calculate.waitFor(); await noEditor(f);
      await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('preparation');
      await f.page.getByRole('region', { name: 'Préparation après optimisation', exact: true }).waitFor();
      await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('documents');
      await complete(f); await noEditor(f);
      assert.equal(await f.page.evaluate(() => document.documentElement.classList.contains('dark')), mobile, 'Audit the requested light desktop / dark mobile theme, not only its storage preference.');
      const audit = await new AxeBuilder({ page: f.page }).include('#quote-documents').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
      await invoicePanel(f).scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, `completed-${mobile ? 'mobile' : 'desktop'}.png`) });
    });
    await scenario('explicit-retired-link-is-history-without-zero-amount-editor', {}, async f => {
      await open(f, ids.F);
      const original = f.page.getByRole('button', { name: 'Voir la facture originale', exact: true });
      await original.waitFor(); await noEditor(f);
      assert.match(await invoicePanel(f).innerText(), /exclu|doublon/i);
      const options = f.page.getByLabel('Facture à vérifier', { exact: true }).locator('option');
      assert.equal(await options.filter({ hasText: 'achat-verifie.pdf' }).count(), 0, 'Retired copies belong to history, not the active document selector.');
      await original.click();
      await f.page.getByRole('button', { name: 'Modifier la vérification', exact: true }).waitFor();
      assert.equal(await f.page.getByLabel('Facture à vérifier', { exact: true }).inputValue(), B);
      assert.notEqual(new URL(f.page.url()).searchParams.get('invoice'), ids.F);
      assert.equal(await f.page.getByRole('button', { name: /^(Valider et passer à la suivante|Terminer la vérification)$/ }).count(), 0);
      await invoicePanel(f).getByRole('button', { name: 'Revenir au récapitulatif', exact: true }).click(); await complete(f); await noEditor(f);
      const url = new URL(f.page.url());
      assert.equal(url.searchParams.has('invoice'), false); assert.equal(url.searchParams.get('section'), 'documents'); assert.equal(url.searchParams.get('returnTo'), '/?mission=documents');
    });
    await scenario('explicit-consultation-keeps-validated-documents-readonly', {}, async f => {
      await open(f); await complete(f);
      await invoicePanel(f).getByRole('button', { name: 'Consulter les factures', exact: true }).click();
      await f.page.getByRole('button', { name: 'Modifier la vérification', exact: true }).waitFor();
      assert.notEqual(await f.page.getByLabel('Facture à vérifier', { exact: true }).inputValue(), ids.F);
      assert.equal(await f.page.getByRole('button', { name: /^(Valider et passer à la suivante|Terminer la vérification)$/ }).count(), 0);
      const editor = f.page.getByLabel('Description de l’article 1', { exact: true });
      if (await editor.count()) assert.equal(await editor.isDisabled(), true);
      await invoicePanel(f).getByRole('button', { name: 'Revenir au récapitulatif', exact: true }).click(); await complete(f); await noEditor(f);
    });
    await scenario('one-original-still-pending-opens-that-review-not-summary-or-copy', { pending: true }, async f => {
      await open(f);
      await f.page.getByRole('button', { name: /^(Valider et passer à la suivante|Terminer la vérification)$/ }).waitFor();
      assert.equal(await f.page.getByLabel('Facture à vérifier', { exact: true }).inputValue(), B);
      assert.equal(await f.page.getByLabel('Description de l’article 1', { exact: true }).inputValue(), 'Scelleuse thermique');
      assert.equal(await invoicePanel(f).getByText('Factures vérifiées', { exact: true }).count(), 0);
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, false);
    });
    for (const dirty of [false, true]) await scenario(`validated-review-can-close-${dirty ? 'dirty-editor-after-confirmation' : 'clean-editor-without-confirmation'}`, {}, async f => {
      await open(f, B);
      const originalInvoices = clone(f.tables.factures), originalLines = clone(f.tables.lignes);
      const modify = f.page.getByRole('button', { name: 'Modifier la vérification', exact: true });
      await modify.click();
      const description = f.page.getByLabel('Description de l’article 1', { exact: true });
      await description.waitFor();
      if (dirty) await description.fill('Correction locale à abandonner après confirmation');
      const close = f.page.getByRole('button', { name: 'Revenir à la version validée', exact: true });
      await close.click();
      if (dirty) {
        const dialog = f.page.getByRole('dialog', { name: 'Fermer sans enregistrer ?', exact: true });
        await dialog.waitFor();
        await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
        assert.equal(await description.inputValue(), 'Correction locale à abandonner après confirmation');
        assert.deepEqual(f.tables.lignes, originalLines);
        await close.click();
        await dialog.getByRole('button', { name: 'Revenir à la version validée', exact: true }).click();
      } else assert.equal(await f.page.getByRole('dialog').count(), 0);
      await modify.waitFor(); await noEditor(f);
      assert.deepEqual(f.tables.factures, originalInvoices); assert.deepEqual(f.tables.lignes, originalLines);
      await invoicePanel(f).getByRole('button', { name: 'Revenir au récapitulatif', exact: true }).click();
      await complete(f); await noEditor(f);
      await invoicePanel(f).getByRole('button', { name: 'Consulter les factures', exact: true }).click();
      await modify.waitFor();
      assert.match(await review(f).innerText(), /Scelleuse thermique/);
      assert.doesNotMatch(await review(f).innerText(), /Correction locale à abandonner/);
    });
    await scenario('replaced-original-excluded-from-completion-counts-and-editor', {}, async f => {
      Object.assign(f.tables.factures.find(invoice => invoice.id === ids.F), { duplicate_of_facture_id: null, valide: true, montant: 250 });
      f.tables.factures.find(invoice => invoice.id === B).replaces_facture_id = ids.F;
      await open(f); await complete(f); await noEditor(f);
      const summary = invoicePanel(f).getByText('Factures vérifiées', { exact: true }).locator('..');
      assert.match(await summary.innerText(), /2 facture\(s\) validée\(s\)/);
      assert.match(await summary.innerText(), /44[,.]64/);
      await invoicePanel(f).getByRole('button', { name: 'Consulter les factures', exact: true }).click();
      await f.page.getByRole('button', { name: 'Modifier la vérification', exact: true }).waitFor();
      assert.equal(await f.page.getByLabel('Facture à vérifier', { exact: true }).locator('option').count(), 2);
      await invoicePanel(f).locator('summary').filter({ hasText: /^Documents remplacés/ }).click();
      await invoicePanel(f).getByRole('navigation', { name: 'Documents remplacés', exact: true }).getByRole('button', { name: 'Facture 1 — achat-verifie.pdf', exact: true }).click();
      await review(f).getByText('Ce document a été remplacé. Vérifiez la facture corrigée depuis la liste.', { exact: true }).waitFor();
      await noEditor(f);
    });
    for (const dirty of [false, true]) await scenario(`colleague-validation-${dirty ? 'preserves-local-correction' : 'closes-automatic-editor'}`, { pending: true }, async f => {
      await open(f, B);
      const description = f.page.getByLabel('Description de l’article 1', { exact: true });
      await description.waitFor();
      if (dirty) await description.fill('Correction locale à préserver');
      f.tables.factures.find(invoice => invoice.id === B).valide = true;
      f.records.get(B).reviewToken = 'confirmed-by-colleague';
      f.tables.colis[0].updated_at = '2026-09-16T12:00:00Z';
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await complete(f);
      if (dirty) {
        await review(f).getByRole('alert').filter({ hasText: 'La version enregistrée a changé' }).waitFor();
        assert.equal(await description.inputValue(), 'Correction locale à préserver');
      } else {
        await f.page.getByRole('button', { name: 'Modifier la vérification', exact: true }).waitFor();
        await noEditor(f);
      }
      assert.equal(f.tables.lignes.filter(line => line.facture_id === B).length, 1);
    });
    await scenario('colleague-retires-dirty-invoice-keeps-local-draft-until-explicit-discard', { pending: true }, async f => {
      // B must not already be an original with copies: the colleague can then
      // legitimately classify it as a second copy of C.
      f.tables.factures.find(invoice => invoice.id === ids.F).duplicate_of_facture_id = C;
      await open(f, B);
      const description = f.page.getByLabel('Description de l’article 1', { exact: true });
      await description.fill('Correction locale après classement par un collègue');
      const originalLines = clone(f.tables.lignes);
      Object.assign(f.tables.factures.find(invoice => invoice.id === B), { duplicate_of_facture_id: C, valide: false });
      f.records.get(B).reviewToken = 'retired-by-colleague';
      f.tables.colis[0].updated_at = '2026-09-16T12:00:00Z';
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const warning = review(f).getByRole('alert').filter({ hasText: 'Cette facture fait désormais partie de l’historique. Votre saisie locale est conservée' });
      await warning.waitFor();
      assert.equal(await f.page.getByRole('button', { name: /^(Valider et passer à la suivante|Terminer la vérification)$/ }).count(), 0);
      await review(f).locator('summary').filter({ hasText: 'Voir ma saisie locale' }).click();
      await review(f).getByText('Correction locale après classement par un collègue', { exact: false }).waitFor();
      const discard = review(f).getByRole('button', { name: 'Abandonner la saisie locale', exact: true });
      await discard.click();
      const dialog = f.page.getByRole('dialog'); await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
      await warning.waitFor();
      await review(f).getByText('Correction locale après classement par un collègue', { exact: false }).waitFor();
      await discard.click();
      await dialog.getByRole('button', { name: 'Abandonner la saisie locale', exact: true }).click();
      await warning.waitFor({ state: 'detached' });
      await noEditor(f);
      assert.deepEqual(f.tables.lignes, originalLines);
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).duplicate_of_facture_id, C);
      await invoicePanel(f).getByRole('button', { name: 'Revenir au récapitulatif', exact: true }).click();
      await complete(f); await noEditor(f);
    });
    await scenario('manual-articles-warning-shows-value-and-opens-review-without-deletion', { manual: true }, async f => {
      await open(f); await complete(f);
      const manualRows = clone(f.tables.lignes.filter(line => !line.facture_id));
      const inspect = invoicePanel(f).getByRole('button', { name: 'Vérifier les articles manuels', exact: true });
      await inspect.waitFor();
      assert.match(await inspect.locator('..').innerText(), /12[,.]00/);
      await inspect.click();
      const manual = f.page.locator('#quote-unlinked'); await withinViewport(manual);
      assert.match(await manual.innerText(), /Article saisi avant réception de la facture/);
      assert.deepEqual(f.tables.lignes.filter(line => !line.facture_id), manualRows);
      await manual.getByRole('button', { name: 'Supprimer Article saisi avant réception de la facture', exact: true }).click();
      const dialog = f.page.getByRole('dialog'); await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
      assert.deepEqual(f.tables.lignes.filter(line => !line.facture_id), manualRows);
      assert.equal(f.tables.lignes.length, 3);
      assert.equal(f.tables.factures.filter(invoice => invoice.valide).length, 2);
    });
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
