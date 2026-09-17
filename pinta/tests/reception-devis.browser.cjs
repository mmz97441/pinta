/* Isolated fixture transport: no client, provider or production mutation. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setup, base, ids: { P } } = require('./browser-regression.cjs');
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.PINTA_RECEPTION_DEVIS_OUT || path.resolve(__dirname, '../../docs/verification-reception-devis-2026-09-10');
const first = { dimL: 80, dimW: 10, dimH: 10, poids: 1 };
const second = { dimL: 10, dimW: 80, dimH: 10, poids: 1 };
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let current;
  try {
    for (const [device, viewport] of [['desktop', { width: 1440, height: 1100 }], ['mobile', { width: 390, height: 844 }]]) {
      current = await setup(browser, 'directeur');
      Object.assign(current.tables.colis[0], { statut: 'receptionne', nb_colis: 2, trackings: ['TEST-001'], trackings_detail: [{ number: 'TEST-001' }, {}], dims_par_colis: [first, null], dim_l: null, dim_w: null, dim_h: null, poids: null, fin_l: null, fin_w: null, fin_h: null, fin_p: null });
      await current.page.setViewportSize(viewport);
      await current.login();
      await current.page.goto(`${base}/colis/${P}`);
      const length = current.page.getByLabel('Longueur · carton 1 (cm)', { exact: true });
      await length.waitFor();
      assert.equal(await length.inputValue(), '80');
      assert.equal(await current.page.getByLabel('Longueur · carton 2 (cm)', { exact: true }).inputValue(), '');
      for (const [label, value] of [['Longueur', 10], ['Largeur', 80], ['Hauteur', 10], ['Poids réel', 1]]) {
        await current.page.getByLabel(`${label} · carton 2 (${label === 'Poids réel' ? 'kg' : 'cm'})`, { exact: true }).fill(String(value));
      }
      await current.page.getByText('3.20 kg', { exact: true }).first().waitFor();
      assert.equal(await current.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await current.page.screenshot({ path: path.join(output, `reception-${device}.png`), fullPage: true });
      const save = current.page.getByRole('button', { name: 'Enregistrer les mesures de réception', exact: true });
      await save.scrollIntoViewIfNeeded();
      await current.page.screenshot({ path: path.join(output, `reception-totals-${device}.png`) });
      const target = await save.boundingBox();
      assert.ok(target.height >= 44);
      await save.click();
      await current.page.getByRole('heading', { name: 'Réception enregistrée', exact: true }).waitFor();
      await current.page.getByRole('button', { name: 'Suivre l’accord du client', exact: true }).click();
      await current.page.getByRole('heading', { name: 'Demander l’accord du client', exact: true }).waitFor();
      assert.deepEqual(current.tables.colis[0].dims_par_colis, [first, second]);
      assert.equal(current.tables.colis[0].poids, 2);
      assert.equal(current.tables.colis[0].fin_p, null);
      await current.page.getByRole('button', { name: 'Réceptionner un autre carton', exact: true }).click();
      await current.page.getByRole('dialog').waitFor();
      await current.page.getByRole('dialog').getByRole('button', { name: /^Enregistrer (?:le carton|les cartons) dans EXP-TEST-001$/, exact: true }).waitFor();
      assert.match(await current.page.getByRole('dialog').innerText(), /EXP-TEST-001/);
      assert.equal(current.tables.colis[0].dims_par_colis.length, 2, 'opening the mandatory measurement flow cannot append an unmeasured carton');
      await current.page.keyboard.press('Escape');
      assert.equal(current.errors.length, 0, current.errors.join('\n'));
      results.push({ test: `physical-cartons-preserved-and-new-receipt-measured-${device}`, pass: true });
      await current.context.close();

      current = await setup(browser, 'directeur');
      Object.assign(current.tables.clients[0], { type: 'pro' });
      Object.assign(current.tables.colis[0], { statut: 'en_preparation', nb_colis: 2, trackings: ['TEST-001'], trackings_detail: [{ number: 'TEST-001' }, {}], dims_par_colis: [first, second], dim_l: 80, dim_w: 80, dim_h: 10, poids: 2, fin_l: null, fin_w: null, fin_h: null, fin_p: null, final_packages: [], final_measurements_version: null, outgoing_parcel_count: null, mode_paiement_pro: 'virement' });
      await current.page.setViewportSize(viewport);
      await current.login();
      await current.page.goto(`${base}/colis/${P}?section=devis`);
      await current.page.getByTestId('quote-action-bar').waitFor();
      const verify = current.page.getByRole('button', { name: 'Enregistrer et vérifier le devis', exact: true });
      assert.equal(await verify.isDisabled(), true);
      await current.page.getByRole('button', { name: 'Préparation à terminer', exact: true }).click();
      for (const [label, unit] of [['Longueur', 'cm'], ['Largeur', 'cm'], ['Hauteur', 'cm'], ['Poids réel', 'kg']]) assert.equal(await current.page.getByLabel(`${label} · colis sortant 1 (${unit})`, { exact: true }).inputValue(), '');
      await current.page.screenshot({ path: path.join(output, `preparation-separate-${device}.png`), fullPage: true });
      for (const [label, unit, value] of [['Longueur', 'cm', 40], ['Largeur', 'cm', 20], ['Hauteur', 'cm', 10], ['Poids réel', 'kg', 3]]) await current.page.getByLabel(`${label} · colis sortant 1 (${unit})`, { exact: true }).fill(String(value));
      await current.page.goBack();
      await verify.waitFor();
      assert.equal(await verify.isDisabled(), true, 'Final measures must be saved explicitly before calculating the quote.');
      await current.page.getByRole('button', { name: 'Reprendre la préparation', exact: true }).click();
      await current.page.getByRole('button', { name: 'Enregistrer les mesures de préparation', exact: true }).click();
      await current.page.getByRole('region', { name: 'Relais après préparation', exact: true }).getByText(/Préparation enregistrée/).waitFor();
      await current.page.goBack();
      await verify.waitFor();
      assert.equal(await verify.isDisabled(), false);
      await verify.click();
      await current.page.getByRole('button', { name: 'Envoyer le devis au client', exact: true }).waitFor();
      assert.deepEqual(current.tables.colis[0].dims_par_colis, [first, second]);
      assert.deepEqual(current.tables.colis[0].devis_snapshot.inputs.finalBox, { dimL: 40, dimW: 20, dimH: 10, poids: 3 });
      assert.equal(current.tables.colis[0].devis_snapshot.before.volumetricWeight, 3.2);
      assert.equal(current.tables.colis[0].devis_snapshot.amounts.realWeight, 3);
      assert.equal(current.tables.colis[0].devis_snapshot.amounts.volumetricWeight, 1.6);
      assert.equal(current.errors.length, 0, current.errors.join('\n'));
      assert.equal(current.page ? await current.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) : false, true);
      results.push({ test: `final-quote-needs-new-measures-keeps-reception-snapshot-${device}`, pass: true });
      await current.context.close();
    }
  } catch (error) {
    results.push({ test: 'browser-regression', pass: false, message: error.stack });
    if (current?.page && !current.page.isClosed()) await current.page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    if (results.every(result => result.pass)) fs.rmSync(path.join(output, 'failure.png'), { force: true });
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2));
}
main();
