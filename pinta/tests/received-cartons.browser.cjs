/* Staff attachment visibility; all API traffic uses isolated fixtures, including reloads. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const { setup, ids, base } = require('./browser-regression.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const out = process.env.PINTA_CARTONS_OUT || path.resolve(__dirname, '../../docs/verification-cartons-2026-09-11');
const initialBoxes = [{ dimL: 40, dimW: 30, dimH: 20, poids: 3 }, { dimL: 30, dimW: 20, dimH: 10, poids: 2 }];

async function fillBox(dialog, carton, measures) {
  for (const [index, label] of ['Longueur', 'Largeur', 'Hauteur', 'Poids'].entries()) {
    await dialog.getByLabel(`${label} à réception (${index === 3 ? 'kg' : 'cm'}) · carton ${carton}`, { exact: true }).fill(String(measures[index]));
  }
}
async function assertFocusedCarton(page, item) {
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Carton '));
  assert.equal(await item.evaluate(node => node === document.activeElement), true);
  const box = await item.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && box.y >= 44 && box.y + box.height <= viewport.height, 'Saved carton is fully visible below the sticky dossier heading');
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const mobile of [false, true]) for (const dark of [false, true]) {
      const f = await setup(browser, 'directeur');
      f.page.setDefaultTimeout(12000);
      if (mobile) await f.page.setViewportSize({ width: 390, height: 844 });
      const theme = dark ? 'dark' : 'light';
      await f.context.addInitScript(isDark => {
        localStorage.setItem('expedile-theme', isDark ? 'dark' : 'light');
      }, dark);
      Object.assign(f.tables.colis[0], { statut: 'mesure', dims_par_colis: initialBoxes, poids: 5, fin_l: null, fin_w: null, fin_h: null, fin_p: null });
      await f.login();
      await f.page.goto(`${base}/colis?sort=client&dir=desc&dossier=${ids.P}`);
      await f.page.waitForFunction(isDark => document.documentElement.classList.contains('dark') === isDark, dark);
      const measures = f.page.getByRole('region', { name: 'Mesures des cartons', exact: true });
      await measures.getByRole('listitem', { name: 'Carton 1', exact: true }).waitFor();
      assert.equal(await measures.getByRole('listitem').count(), 2, 'Existing cartons are visible in the inline panel');
      await measures.getByText('Boutique B', { exact: true }).waitFor();
      await f.page.getByRole('button', { name: 'Réceptionner un autre carton', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Réceptionner un colis', exact: true });
      await dialog.getByRole('heading', { name: 'Carton 3', level: 3, exact: true }).waitFor();
      await dialog.getByLabel('Fournisseur · carton 3', { exact: true }).fill('Boutique C');
      await dialog.getByLabel('Numéro de suivi · carton 3', { exact: true }).fill('QA-ATTACH-003');
      await fillBox(dialog, 3, [15, 25, 35, 1.5]);
      await dialog.getByRole('button', { name: 'Rattacher à EXP-TEST-001', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const third = measures.getByRole('listitem', { name: 'Carton 3', exact: true });
      await third.getByText('QA-ATTACH-003', { exact: true }).waitFor();
      await third.getByText('Boutique C', { exact: true }).waitFor();
      assert.match(await third.innerText(), /15 × 25 × 35 cm · 1.5 kg/);
      await assertFocusedCarton(f.page, third);
      assert.equal(f.tables.colis.length, 1, 'Attaching a carton keeps the same dossier');
      assert.equal(f.tables.colis[0].nb_colis, 3);
      assert.equal(f.tables.colis[0].ref, 'EXP-TEST-001', 'Carton numbering never changes the dossier reference');
      assert.deepEqual(f.tables.colis[0].dims_par_colis.slice(0, 2), initialBoxes);
      assert.equal(f.tables.colis[0].fin_l, null);
      assert.equal(new URL(f.page.url()).searchParams.get('sort'), 'client');
      assert.equal(new URL(f.page.url()).searchParams.get('dir'), 'desc');
      assert.equal(new URL(f.page.url()).searchParams.get('dossier'), ids.P);
      await f.page.screenshot({ path: path.join(out, `carton-attached-${mobile ? 'mobile' : 'desktop'}-${theme}.png`), fullPage: true });
      await f.page.reload();
      await third.getByText('QA-ATTACH-003', { exact: true }).waitFor();
      assert.equal(await measures.getByRole('listitem').count(), 3, 'The saved carton remains visible after reload');

      // A receipt started from the general list must open its actual destination dossier.
      await f.page.goto(`${base}/colis?sort=client&dir=desc`);
      await f.page.getByRole('button', { name: mobile ? 'Réceptionner un colis' : 'Nouveau colis', exact: true }).click();
      await dialog.getByLabel('Client', { exact: true }).fill('Camille');
      await dialog.getByRole('button').filter({ hasText: /Exemple/ }).first().click();
      await dialog.getByRole('button').filter({ hasText: 'EXP-TEST-001' }).click();
      await dialog.getByRole('heading', { name: 'Carton 4', level: 3, exact: true }).waitFor();
      await fillBox(dialog, 4, [10, 10, 10, 0.6]);
      await dialog.getByRole('button', { name: 'Rattacher à EXP-TEST-001', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const fourth = measures.getByRole('listitem', { name: 'Carton 4', exact: true });
      await fourth.getByText('Numéro de suivi non renseigné', { exact: true }).waitFor();
      await fourth.getByText('Fournisseur non renseigné', { exact: true }).waitFor();
      assert.match(await fourth.innerText(), /10 × 10 × 10 cm · 0.6 kg/);
      await assertFocusedCarton(f.page, fourth);
      assert.equal(new URL(f.page.url()).searchParams.get('dossier'), ids.P);
      assert.equal(new URL(f.page.url()).searchParams.get('sort'), 'client');
      assert.equal(f.tables.colis.length, 1);
      assert.equal(f.tables.colis[0].ref, 'EXP-TEST-001');

      // Show known historical coordinates and explicitly omit incomplete totals.
      f.tables.colis[0].dims_par_colis[1] = { dimL: 30, dimW: null, dimH: 10, poids: 2 };
      await f.page.reload();
      const second = measures.getByRole('listitem', { name: 'Carton 2', exact: true });
      await second.getByText('Mesures à réception incomplètes — à vérifier', { exact: true }).waitFor();
      assert.match(await second.innerText(), /30 × — × 10 cm · 2 kg/);
      assert.equal(await measures.getByText('Totaux à réception', { exact: true }).count(), 0);
      await f.page.waitForFunction(isDark => document.documentElement.classList.contains('dark') === isDark, dark);
      await measures.scrollIntoViewIfNeeded();
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const axe = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      await fs.writeFile(path.join(out, `axe-${mobile ? 'mobile' : 'desktop'}-${theme}.json`), JSON.stringify(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })) })), null, 2));
      assert.deepEqual(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), [], `${mobile ? 'mobile' : 'desktop'} ${theme}`);
      assert.deepEqual(f.errors, []);
      assert.deepEqual(f.networkDenied, []);
      results.push({ viewport: mobile ? '390x844' : '1440x1000', theme, inlineList: 'passed', attachmentVisibleWithoutReload: 'passed', reloadPersistence: 'passed', generalReceiptOpensDossier: 'passed', noTrackingCartonVisible: 'passed', originalMeasuresPreserved: 'passed', finalMeasuresSeparate: 'passed', legacyPartialMeasuresVisible: 'passed', accessibilityViolations: 0 });
      await f.context.close();
    }
  } finally { await browser.close(); }
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ status: 'passed', results }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
