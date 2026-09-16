/* Preparation uses isolated fictitious providers only; no real document/customer write. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_PREPARATION_OUT || '/tmp/pinta-preparation-autonomous';
const clone = value => JSON.parse(JSON.stringify(value));
const boxes = [{ dimL: 40, dimW: 20, dimH: 10, poids: 2.5 }, { dimL: 25, dimW: 20, dimH: 15, poids: 1.25 }];
const section = f => f.page.getByRole('region', { name: 'Préparation après optimisation', exact: true });
const field = (f, label, unit, index = 1) => section(f).getByLabel(`${label} · colis sortant ${index} (${unit})`, { exact: true });
const save = f => section(f).getByRole('button', { name: 'Enregistrer les mesures de préparation', exact: true });
const measurementCalls = f => f.requests.filter(request => request.path.endsWith('/save_preparation_measurements'));
async function fillBox(f, box, index = 1) {
  for (const [key, label, unit] of [['dimL', 'Longueur', 'cm'], ['dimW', 'Largeur', 'cm'], ['dimH', 'Hauteur', 'cm'], ['poids', 'Poids réel', 'kg']]) await field(f, label, unit, index).fill(String(box[key]));
}
async function prepared(browser, { permissions = { perm_colis_preparer: true }, missing = true, empty = true, status = 'en_preparation' } = {}) {
  const f = await setup(browser, 'preparateur');
  f.page.setDefaultTimeout(10000);
  const permission = { id: 'permissions-preparation', staff_id: ids.S, ...permissions };
  f.tables.staff_permissions = [permission]; f.tables.staff_users[0].staff_permissions = permission;
  f.tables.colis[0].statut = status;
  if (missing) { f.tables.factures = []; f.tables.lignes = []; }
  else f.tables.factures[0].valide = false;
  if (empty) Object.assign(f.tables.colis[0], { final_packages: [], fin_l: null, fin_w: null, fin_h: null, fin_p: null, outgoing_parcel_count: null, final_measurements_version: null, final_measurements_at: null });
  return f;
}
async function open(f, query = 'section=preparation') {
  await f.page.goto(`${base}/colis/${ids.P}?${query}`);
  await section(f).waitFor(); await save(f).waitFor();
}
async function saved(f) { await section(f).getByText('Mesures enregistrées, même si les documents restent à vérifier.', { exact: true }).waitFor(); }
async function clean(f) {
  assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
  assert.equal(f.requests.some(request => /\/(save_quote|queue_message|save_invoice_review|confirm_quote)$/.test(request.path)), false, 'Preparing must never save a quote, validate invoices or notify a customer.');
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  async function scenario(name, options, action) {
    const f = await prepared(browser, options);
    try { await f.login(); await action(f); await clean(f); results.push({ test: name, pass: true }); }
    catch (error) { results.push({ test: name, pass: false, error: error.stack, requests: f.requests }); process.exitCode = 1; await f.page.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(output, name + '-failure.txt'), await f.page.locator('body').innerText().catch(() => '')); }
    finally { await f.context.close(); }
  }
  try {
    for (const mobile of [false, true]) await scenario(`preparer-only-saves-multiple-boxes-without-invoice-or-quote-${mobile ? 'mobile' : 'desktop'}`, { missing: !mobile }, async f => {
      await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      if (mobile) { await f.page.evaluate(() => localStorage.setItem('expedile-theme', 'dark')); }
      const reception = clone([f.tables.colis[0].nb_colis, f.tables.colis[0].trackings_detail, f.tables.colis[0].dim_l, f.tables.colis[0].poids]);
      await open(f, `returnTo=${encodeURIComponent('/?mission=preparation')}`);
      assert.equal(await f.page.getByRole('button', { name: 'Factures et devis', exact: true }).count(), 0);
      assert.equal(await f.page.getByTestId('quote-action-bar').count(), 0);
      assert.equal(await f.page.getByRole('region', { name: 'Factures d’achat', exact: true }).count(), 0);
      assert.equal(await save(f).isDisabled(), true);
      assert.equal(await field(f, 'Longueur', 'cm').inputValue(), '');
      await fillBox(f, boxes[0]);
      await section(f).getByRole('button', { name: '+ Ajouter un colis après optimisation', exact: true }).click();
      await fillBox(f, boxes[1], 2);
      await save(f).click(); await saved(f);
      assert.deepEqual(f.tables.colis[0].final_packages.map(box => Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Number(value)]))), boxes);
      assert.equal(f.tables.colis[0].outgoing_parcel_count, 2);
      assert.equal(f.tables.colis[0].quote_version, 0);
      assert.deepEqual([f.tables.colis[0].nb_colis, f.tables.colis[0].trackings_detail, f.tables.colis[0].dim_l, f.tables.colis[0].poids], reception);
      await section(f).getByRole('region', { name: 'Relais après préparation', exact: true }).waitFor();
      assert.equal(f.requests.some(request => request.path.endsWith('/get_invoice_review_context')), false);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.equal(await f.page.evaluate(() => document.documentElement.classList.contains('dark')), mobile);
      const audit = await new AxeBuilder({ page: f.page }).include('section[aria-label="Préparation après optimisation"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
      await section(f).scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, `preparation-${mobile ? 'mobile-dark' : 'desktop-light'}.png`), fullPage: true });
      await section(f).getByRole('button', { name: 'Revenir à ma file de travail', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === '/' && url.searchParams.get('mission') === 'preparation');
      await open(f); assert.equal(await field(f, 'Longueur', 'cm').inputValue(), '40');
    });
    await scenario('agreement-starts-preparation-without-invoice-permission', { status: 'autorise' }, async f => {
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      await f.page.getByRole('button', { name: 'Commencer la préparation', exact: true }).click();
      await section(f).waitFor();
      assert.equal(f.tables.colis[0].statut, 'en_preparation');
      await fillBox(f, boxes[0]); await save(f).click(); await saved(f);
      assert.equal(f.tables.factures.length, 0);
    });
    await scenario('missing-customer-agreement-blocks-preparation', {}, async f => {
      f.tables.colis[0].feu_vert = 'en_attente';
      await open(f);
      assert.equal(await save(f).isDisabled(), true);
      assert.equal(await field(f, 'Longueur', 'cm').isDisabled(), true);
      await section(f).getByRole('alert').filter({ hasText: 'Le feu vert du client doit être enregistré' }).waitFor();
      assert.equal(measurementCalls(f).length, 0);
    });
    await scenario('quote-worker-reads-measures-but-cannot-rewrite-them', { permissions: { perm_colis_calculer_devis: true }, missing: false, empty: false }, async f => {
      f.tables.factures[0].valide = true;
      f.tables.colis[0].final_packages = clone(boxes); f.tables.colis[0].fin_p = 3.75; f.tables.colis[0].outgoing_parcel_count = 2;
      await f.page.goto(`${base}/colis/${ids.P}?section=devis`);
      const recap = f.page.getByRole('region', { name: 'Mesures de préparation enregistrées', exact: true });
      await recap.waitFor(); assert.match(await recap.innerText(), /40 × 20 × 10 cm · 2.5 kg/); assert.match(await recap.innerText(), /Colis sortant 2/);
      const verify = f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis', exact: true });
      await verify.waitFor(); assert.equal(await verify.isEnabled(), true);
      assert.equal(await f.page.getByRole('region', { name: 'Factures d’achat', exact: true }).count(), 0);
      assert.equal(f.requests.some(request => request.path.endsWith('/get_invoice_review_context')), false);
      await recap.getByRole('button', { name: 'Consulter la préparation', exact: true }).click(); await section(f).waitFor();
      assert.equal(await field(f, 'Longueur', 'cm').isDisabled(), true); assert.equal(await save(f).isDisabled(), true);
      assert.equal(measurementCalls(f).length, 0);
    });
    await scenario('colleague-measurements-preserved-and-local-draft-compared', { empty: false }, async f => {
      await open(f); await field(f, 'Longueur', 'cm').fill('99');
      f.tables.colis[0].updated_at = '2099-01-01T00:00:00Z'; f.tables.colis[0].final_packages[0].dimL = 55; f.tables.colis[0].fin_l = 55;
      await save(f).click();
      await section(f).getByRole('alert').filter({ hasText: 'Version enregistrée' }).waitFor();
      assert.equal(await field(f, 'Longueur', 'cm').inputValue(), '99'); assert.equal(f.tables.colis[0].final_packages[0].dimL, 55);
      assert.equal(await section(f).getByRole('button', { name: 'Conserver ma saisie et réessayer', exact: true }).count(), 0);
      assert.equal(await save(f).isDisabled(), true); assert.equal(measurementCalls(f).length, 1);
      await section(f).getByRole('button', { name: 'Recharger et remplacer mon brouillon', exact: true }).click();
      assert.equal(await field(f, 'Longueur', 'cm').inputValue(), '55');
    });
    await scenario('invoice-update-allows-explicit-retry-without-losing-measures', { missing: false, empty: false }, async f => {
      await open(f); await field(f, 'Longueur', 'cm').fill('41');
      f.tables.colis[0].updated_at = '2099-01-01T00:00:00Z'; f.tables.factures[0].valide = true;
      await save(f).click();
      const resume = section(f).getByRole('button', { name: 'Conserver ma saisie et réessayer', exact: true });
      await resume.waitFor(); assert.equal(measurementCalls(f).length, 1);
      await resume.click(); assert.equal(measurementCalls(f).length, 1, 'Rebasing requires a separate explicit save; never automatically overwrite.');
      assert.equal(await field(f, 'Longueur', 'cm').inputValue(), '41');
      await save(f).click(); await saved(f);
      assert.equal(measurementCalls(f).length, 2); assert.equal(Number(f.tables.colis[0].final_packages[0].dimL), 41); assert.equal(f.tables.factures[0].valide, true);
    });
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
