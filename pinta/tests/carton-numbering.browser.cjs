/* Real form numbering and saved carton positions, with all APIs intercepted as fixtures. */
const { chromium } = require('playwright');
const { setup, ids, base } = require('./browser-regression.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const out = process.env.PINTA_NUMBERING_OUT || path.resolve(__dirname, '../../docs/verification-numerotation-cartons-2026-09-11');
const oldBox = { dimL: 40, dimW: 30, dimH: 20, poids: 3 };
async function measure(dialog, carton, values) {
  for (const [i, name] of ['Longueur', 'Largeur', 'Hauteur', 'Poids'].entries()) {
    await dialog.getByLabel(`${name} à réception (${i === 3 ? 'kg' : 'cm'}) · carton ${carton}`, { exact: true }).fill(String(values[i]));
  }
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const mobile of [false, true]) {
      const f = await setup(browser, 'directeur');
      f.page.setDefaultTimeout(12000);
      if (mobile) await f.page.setViewportSize({ width: 390, height: 844 });
      Object.assign(f.tables.colis[0], { statut: 'mesure', nb_colis: 1, trackings: [], trackings_detail: [{}], dims_par_colis: [oldBox], fin_l: null, fin_w: null, fin_h: null, fin_p: null });
      const other = { ...f.tables.colis[0], id: '77777777-7777-4777-8777-777777777777', ref: 'EXP-NUM-003', nb_colis: 3, trackings: ['ONLY-ONE-TRACKING'], trackings_detail: [{ number: 'ONLY-ONE-TRACKING' }], dims_par_colis: [oldBox, oldBox] };
      f.tables.colis.push(other);
      await f.login();
      await f.page.goto(`${base}/colis/${ids.P}?section=accord`);
      await f.page.getByRole('button', { name: 'Réceptionner un autre carton', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Réceptionner des cartons', exact: true });
      await dialog.getByRole('heading', { name: 'Carton 2', exact: true }).waitFor();
      assert.equal(await dialog.getByRole('heading', { name: 'Carton 1', exact: true }).count(), 0);
      await dialog.getByLabel('Fournisseur · carton 2', { exact: true }).fill('Fournisseur temporaire');
      await dialog.getByRole('button', { name: 'Rattacher à EXP-TEST-001', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Carton 2 : longueur à réception (cm)' }).waitFor();
      const length = dialog.getByLabel('Longueur à réception (cm) · carton 2', { exact: true });
      assert.equal(await length.evaluate(node => document.activeElement === node), true, 'Validation focuses the same visible carton number');
      await measure(dialog, 2, [15, 25, 35, 1.5]);
      await f.page.screenshot({ path: path.join(out, `carton-2-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
      await dialog.getByRole('button', { name: '+ Ajouter un carton', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Carton 3', exact: true }).waitFor();
      await dialog.getByLabel('Fournisseur · carton 3', { exact: true }).fill('Carton conservé');
      await dialog.getByLabel('Numéro de suivi · carton 3', { exact: true }).fill('SAVED-CARTON');
      await measure(dialog, 3, [12, 23, 34, 2.5]);
      // Removing an unsaved line renumbers its successor without changing its measures.
      await dialog.getByRole('button', { name: 'Supprimer le carton 2', exact: true }).click();
      assert.equal(await dialog.getByLabel('Fournisseur · carton 2', { exact: true }).inputValue(), 'Carton conservé');
      assert.equal(await length.inputValue(), '12');
      assert.equal(await dialog.getByRole('heading', { name: 'Carton 3', exact: true }).count(), 0);
      await dialog.getByRole('button', { name: 'Rattacher à EXP-TEST-001', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await f.page.getByRole('button', { name: 'Voir le carton reçu', exact: true }).click();
      await f.page.getByRole('listitem', { name: 'Carton 2', exact: true }).getByText('SAVED-CARTON', { exact: true }).waitFor();
      assert.equal(f.tables.colis[0].ref, 'EXP-TEST-001');
      assert.equal(f.tables.colis[0].nb_colis, 2);
      assert.deepEqual(f.tables.colis[0].dims_par_colis, [oldBox, { dimL: 12, dimW: 23, dimH: 34, poids: 2.5 }]);
      assert.equal(f.tables.colis[0].fin_l, null);
      await f.page.reload();
      await f.page.getByRole('button', { name: 'Réceptionner un autre carton', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Carton 3', exact: true }).waitFor();
      await dialog.getByLabel('Poids à réception (kg) · carton 3', { exact: true }).fill('1');
      await dialog.getByRole('button', { name: 'Rattacher à EXP-TEST-001', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Carton 3 : longueur à réception (cm)' }).waitFor();
      // A different expedition has three physical cartons despite incomplete tracking coverage.
      await dialog.getByRole('button', { name: 'Changer', exact: true }).click();
      await dialog.getByRole('button').filter({ hasText: 'EXP-NUM-003' }).click();
      await dialog.getByRole('heading', { name: 'Carton 4', exact: true }).waitFor();
      assert.equal(await dialog.getByRole('alert').count(), 0, 'The previous expedition validation is cleared');
      await dialog.getByRole('button', { name: 'Rattacher à EXP-NUM-003', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Carton 4 : longueur à réception (cm)' }).waitFor();
      await dialog.getByRole('button', { name: 'Changer', exact: true }).click();
      await dialog.getByRole('button', { name: 'Créer une nouvelle expédition (nouveau EXP)', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Carton 1', exact: true }).waitFor();
      assert.equal(await dialog.getByRole('heading', { name: 'Carton 4', exact: true }).count(), 0);
      assert.equal(await dialog.getByLabel('Poids à réception (kg) · carton 1', { exact: true }).inputValue(), '1');
      assert.deepEqual(f.errors, []);
      assert.deepEqual(f.networkDenied, []);
      results.push({ viewport: mobile ? '390x844' : '1440x1000', firstAttachmentStartsAtTwo: true, consecutiveNumbers: true, validationNumberAndFocusMatch: true, removalPreservesMeasures: true, referenceUnchanged: true, reopeningContinuesNumbering: true, physicalCountInsteadOfTrackingCount: true, switchingExpeditionUpdatesNumbers: true, newExpeditionStartsAtOne: true });
      await f.context.close();
    }
  } finally { await browser.close(); }
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ status: 'passed', results }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
