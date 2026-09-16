/* Concurrent quote edits against isolated fixtures; no real notification or quote. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_QUOTE_CONFLICT_OUT || '/tmp/pinta-quote-task-conflict';
const results = [];
const save = f => f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis', exact: true });
const keep = f => f.page.getByRole('button', { name: 'Conserver mes frais et recalculer', exact: true });
const reload = f => f.page.getByRole('button', { name: 'Recharger et remplacer mon brouillon', exact: true });
async function open(f) { await f.login(); await f.page.goto(`${base}/colis/${ids.P}?section=devis`); await save(f).waitFor(); }
async function addFee(f) {
  await f.page.getByText('Ajouter un frais', { exact: true }).click();
  await f.page.getByLabel('Libellé du frais', { exact: true }).fill('Emballage convenu');
  await f.page.getByLabel('Montant du frais', { exact: true }).fill('7');
  await f.page.getByRole('button', { name: 'Ajouter le frais', exact: true }).click();
}
async function colleagueUpdate(f) {
  f.tables.colis[0].updated_at = new Date(Math.max(Date.now(), Date.parse(f.tables.colis[0].updated_at)) + 60000).toISOString();
  await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
}
const articleDescription = f => f.page.getByLabel('Description du nouvel article', { exact: true });
const articleWrites = f => f.requests.filter(request => request.path === '/rest/v1/lignes' && ['POST', 'PATCH', 'DELETE'].includes(request.method));
async function openDocuments(f, id = ids.P) {
  await f.page.evaluate(to => { history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, `/colis/${id}?section=documents`);
  await f.page.getByTestId('dossier-task-header').getByText(f.tables.colis.find(parcel => parcel.id === id).ref, { exact: true }).waitFor();
  await f.page.getByTestId('documents-task').waitFor();
}
async function main() {
  await fs.mkdir(output, { recursive: true }); const browser = await chromium.launch({ headless: true });
  async function scenario(name, run) {
    const f = await setup(browser, 'directeur'); f.page.setDefaultTimeout(10000);
    try { await run(f); assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []); assert.equal(f.requests.some(request => request.path.endsWith('/queue_message')), false); results.push({ test: name, pass: true }); }
    catch (error) { process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack }); await f.page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {}); await fs.writeFile(`${output}/${name}-failure.txt`, await f.page.locator('body').innerText().catch(() => '')); }
    finally { await f.context.close(); }
  }
  try {
    await scenario('quote-fee-conflict-explains-recovery-and-rechecks-new-invoice-amounts', async f => {
      await open(f); await addFee(f); assert.equal(await save(f).isEnabled(), true);
      f.tables.colis[0].commentaire_preparation = 'Consigne ajoutée par un collègue'; await colleagueUpdate(f);
      await keep(f).waitFor(); assert.equal(await save(f).isDisabled(), true);
      assert.ok((await f.page.getByRole('alert').allTextContents()).some(text => /dossier|collègue|modification/i.test(text)));
      assert.equal(f.requests.filter(request => request.path.endsWith('/save_quote')).length, 0);
      await keep(f).click(); assert.equal(await save(f).isEnabled(), true);
      assert.equal(f.requests.filter(request => request.path.endsWith('/save_quote')).length, 0, 'Rebasing the draft must not publish or save a quote.');
      await save(f).click(); const publish = f.page.getByRole('button', { name: 'Envoyer le devis au client', exact: true }); await publish.waitFor();
      const first = f.requests.find(request => request.path.endsWith('/save_quote')).input.p_snapshot;
      assert.equal(first.inputs.fees[0].montant, 7); assert.equal(first.inputs.lines[0].unitPrice, 100);
      f.tables.factures[0].montant = 200; f.tables.lignes[0].prix_unitaire = 200; await colleagueUpdate(f);
      await save(f).waitFor(); assert.equal(await publish.count(), 0, 'A changed invoice must invalidate the saved preview before delivery.');
      assert.equal(f.requests.filter(request => request.path.endsWith('/save_quote')).length, 1);
      await save(f).click(); await publish.waitFor();
      const second = f.requests.filter(request => request.path.endsWith('/save_quote'))[1].input.p_snapshot;
      assert.equal(second.inputs.lines[0].unitPrice, 200); assert.equal(second.inputs.fees[0].montant, 7);
      assert.notEqual(second.amounts.total, first.amounts.total);
    });
    await scenario('changed-preparation-forbids-fee-rebase-and-explicit-reload-keeps-colleague-measurements', async f => {
      await open(f); await addFee(f);
      f.tables.colis[0].final_packages[0].poids = 9; f.tables.colis[0].fin_p = 9; await colleagueUpdate(f);
      await reload(f).waitFor(); assert.equal(await keep(f).count(), 0); assert.equal(await save(f).isDisabled(), true);
      assert.equal(f.requests.filter(request => request.path.endsWith('/save_quote')).length, 0);
      await reload(f).click(); assert.equal(await save(f).isEnabled(), true);
      assert.equal(await f.page.getByText('Emballage convenu', { exact: true }).count(), 0);
      assert.equal(f.tables.colis[0].final_packages[0].poids, 9);
      assert.equal(f.requests.some(request => request.path.endsWith('/save_preparation_measurements') || request.path.endsWith('/save_quote')), false);
      await save(f).click(); await f.page.getByRole('button', { name: 'Envoyer le devis au client', exact: true }).waitFor();
      const snapshot = f.requests.find(request => request.path.endsWith('/save_quote')).input.p_snapshot;
      assert.equal(snapshot.inputs.finalPackages[0].poids, 9); assert.equal(snapshot.inputs.fees.length, 0);
    });
    await scenario('manual-article-draft-survives-task-change-and-saves-only-on-explicit-submit', async f => {
      await f.login(); await openDocuments(f);
      await f.page.getByText('Ajouter un article sans facture source', { exact: true }).click();
      await articleDescription(f).fill('Achat manuel conservé');
      await f.page.getByLabel('Quantité du nouvel article', { exact: true }).fill('2');
      await f.page.getByLabel('Prix du nouvel article', { exact: true }).fill('19');
      await f.page.getByLabel('Catégorie du nouvel article', { exact: true }).selectOption('cat-test');
      await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('devis');
      await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('documents');
      await articleDescription(f).waitFor();
      assert.equal(await articleDescription(f).inputValue(), 'Achat manuel conservé');
      assert.equal(await f.page.getByLabel('Quantité du nouvel article', { exact: true }).inputValue(), '2');
      assert.equal(await f.page.getByLabel('Prix du nouvel article', { exact: true }).inputValue(), '19');
      assert.equal(await f.page.getByLabel('Catégorie du nouvel article', { exact: true }).inputValue(), 'cat-test');
      assert.equal(articleWrites(f).length, 0); assert.equal(f.tables.lignes.length, 1);
      assert.equal(await f.page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), true);
      await f.page.getByRole('button', { name: 'Enregistrer l’article', exact: true }).click();
      await f.page.getByText('Achat manuel conservé', { exact: true }).waitFor();
      assert.equal(articleWrites(f).length, 1); assert.equal(f.tables.lignes.length, 2);
      const saved = f.tables.lignes.find(line => line.description === 'Achat manuel conservé');
      assert.equal(saved.colis_id, ids.P); assert.equal(saved.qte, 2); assert.equal(saved.prix_unitaire, 19); assert.equal(saved.facture_id, null);
      await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('devis');
      await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('documents');
      assert.equal(await articleDescription(f).inputValue(), ''); assert.equal(articleWrites(f).length, 1);
    });
    await scenario('manual-article-drafts-are-isolated-by-dossier-and-explicit-clear-stays-empty', async f => {
      const otherId = '77777777-7777-4777-8777-777777777777';
      f.tables.colis.push({ ...structuredClone(f.tables.colis[0]), id: otherId, ref: 'EXP-TEST-002' });
      await f.login(); await openDocuments(f);
      await f.page.getByText('Ajouter un article sans facture source', { exact: true }).click(); await articleDescription(f).fill('Brouillon du premier dossier');
      await openDocuments(f, otherId); assert.equal(await articleDescription(f).inputValue(), '');
      await f.page.getByText('Ajouter un article sans facture source', { exact: true }).click(); await articleDescription(f).fill('Brouillon du second dossier');
      await openDocuments(f); await articleDescription(f).waitFor(); assert.equal(await articleDescription(f).inputValue(), 'Brouillon du premier dossier');
      await f.page.getByRole('button', { name: 'Effacer la saisie', exact: true }).click();
      await openDocuments(f, otherId); await articleDescription(f).waitFor(); assert.equal(await articleDescription(f).inputValue(), 'Brouillon du second dossier');
      await openDocuments(f); assert.equal(await articleDescription(f).inputValue(), '');
      assert.equal(await f.page.getByLabel('Prix du nouvel article', { exact: true }).inputValue(), '');
      assert.equal(await f.page.getByRole('button', { name: 'Effacer la saisie', exact: true }).count(), 0);
      assert.equal(articleWrites(f).length, 0); assert.equal(f.tables.lignes.length, 1);
    });
  } finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
