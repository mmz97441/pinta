/* Local fixture integration: configured volumes in the table and complete dossier information. */
const { chromium } = require('playwright');
const { setup, ids, base } = require('./browser-regression.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const out = process.env.PINTA_UX_TEAM_OUT || path.resolve(__dirname, '../../docs/verification-ux-equipe-2026-09-10');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    await fs.mkdir(out, { recursive: true });
    for (const mobile of [false, true]) {
      const f = await setup(browser, 'directeur');
      f.page.setDefaultTimeout(10000);
      if (mobile) await f.page.setViewportSize({ width: 390, height: 844 });
      f.tables.app_settings.find(row => row.key === 'business').value.diviseurVolumetrique = 6000;
      Object.assign(f.tables.colis[0], {
        statut: 'mesure', nb_colis: 2, dim_l: 80, dim_w: 80, dim_h: 10, poids: 99,
        dims_par_colis: [{ dimL: 80, dimW: 10, dimH: 10, poids: 1 }, { dimL: 10, dimW: 80, dimH: 10, poids: 1 }],
        fin_l: 40, fin_w: 20, fin_h: 10, fin_p: 2,
      });
      await f.context.addInitScript(staffId => localStorage.setItem('expedile_columns_v2:' + staffId, JSON.stringify(['ref', 'statut', 'client', 'volCm3', 'volKg', 'poids', 'total'])), ids.A);
      await f.login();
      if (!mobile) {
        await f.page.goto(base + '/colis');
        const row = f.page.getByRole('row').filter({ has: f.page.getByRole('button', { name: 'EXP-TEST-001', exact: true }) });
        await row.getByText('2.67', { exact: true }).waitFor();
        await row.getByText('2.00 kg', { exact: true }).waitFor();
        assert.equal(await row.getByText('10.67', { exact: true }).count(), 0, 'Maximum dimensions must not replace the sum of actual carton volumes');
        assert.equal(await row.getByText('99 kg', { exact: true }).count(), 0, 'Stale aggregate weight must not replace individual carton weights');
      }
      await f.page.goto(base + '/colis/' + ids.P);
      const measures = f.page.getByRole('region', { name: 'Mesures des cartons', exact: true });
      await measures.getByText('Totaux à réception', { exact: true }).waitFor();
      assert.equal(await measures.getByText('2.67 kg', { exact: true }).count(), 2);
      await measures.getByText('Vol : 1.33 kg', { exact: true }).waitFor();
      assert.equal(await measures.getByText(/10\.67|99 kg/).count(), 0);
      await measures.scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(out, `mesures-config-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
      f.tables.colis[0].nb_colis = 3;
      f.tables.colis[0].fin_w = null;
      await f.page.reload();
      await measures.getByText(/Total avant optimisation indisponible/).waitFor();
      assert.equal(await measures.getByText('Totaux à réception', { exact: true }).count(), 0);
      await measures.getByText('Mesures après optimisation à compléter ; aucun poids calculé.', { exact: true }).waitFor();
      assert.equal(await measures.getByText('Vol : 1.33 kg', { exact: true }).count(), 0);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(f.errors, []);
      assert.deepEqual(f.networkDenied, []);
      results.push({ viewport: mobile ? '390x844' : '1440x1000', configuredDivisor: 'PASS', perCartonVolumeSum: 'PASS', legacyGapsHideTotals: 'PASS', incompleteFinalDoesNotFallback: 'PASS', pageErrors: f.errors, unexpectedNetwork: f.networkDenied });
      await f.context.close();
    }
    await fs.writeFile(path.join(out, 'measurements-display-results.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
