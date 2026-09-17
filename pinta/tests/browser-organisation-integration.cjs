/* Browser UI regression. All business APIs are local fixtures, never real clients. */
const { chromium } = require('playwright');
const { setup, base, ids } = require('./browser-regression.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;
const out = process.env.PINTA_INTEGRATION_OUT || path.resolve(__dirname, '../../docs/verification-organisation-2026-09-12/integration');
const results = [], accessibility = [];
const clone = (value) => JSON.parse(JSON.stringify(value));
const E = 'aaaaaaaa-0000-4000-8000-000000000001';

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, role, action) {
    if (process.env.PINTA_INTEGRATION_FILTER && !name.includes(process.env.PINTA_INTEGRATION_FILTER)) return;
    const f = await setup(browser, role);
    f.page.setDefaultTimeout(12000);
    try {
      await action(f);
      assert.deepEqual(f.errors, [], 'No application exception');
      assert.deepEqual(f.networkDenied, [], 'No external business request');
      await fs.rm(path.join(out, `${name}-failure.png`), { force: true });
      results.push({ test: name, pass: true });
    } catch (error) {
      await f.page.screenshot({ path: path.join(out, `${name}-failure.png`), fullPage: true }).catch(() => {});
      results.push({ test: name, pass: false, error: error.stack, pageErrors: f.errors }); process.exitCode = 1;
    } finally { await f.context.close(); }
    console.log(JSON.stringify(results.at(-1)));
  }
  async function audit(f, name) {
    const report = await new AxeBuilder({ page: f.page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    const overflow = await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    accessibility.push({ name, overflow, violations: report.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) })) });
    await f.page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    assert.equal(overflow, false, 'No horizontal overflow');
    assert.equal(report.violations.length, 0, `Accessibility issues: ${report.violations.map(v => v.id).join(', ')}`);
  }
  await scenario('client-summary-address-history', 'directeur', async f => {
    const old = { ...clone(f.tables.colis[0]), id: 'bbbbbbbb-0000-4000-8000-000000000001', ref: 'EXP-ARCHIVE', archive: true, statut: 'livre' };
    f.tables.colis.push(old);
    await f.login(); await f.page.goto(`${base}/clients/${ids.C}`);
    await f.page.getByRole('heading', { name: 'Expéditions ouvertes (1)' }).waitFor();
    assert.equal(await f.page.getByLabel('Nom *', { exact: true }).isVisible(), false);
    await f.page.getByText('Historique complet (2 dossiers)', { exact: true }).click();
    await f.page.getByText('EXP-ARCHIVE · Archivé', { exact: true }).waitFor();
    await audit(f, 'client-summary-desktop');
    await f.page.getByRole('button', { name: 'Coordonnées', exact: true }).click();
    await f.page.getByLabel('Adresse de livraison', { exact: true }).fill('25 rue Corrigée');
    await f.page.getByLabel('Complément d’adresse', { exact: true }).fill('Bâtiment B');
    await f.page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await f.page.getByRole('heading', { name: 'Expéditions ouvertes (1)' }).waitFor();
    assert.equal(f.tables.clients[0].adresse_ligne1, '25 rue Corrigée');
    assert.equal(f.tables.clients[0].adresse, '25 rue Corrigée');
    assert.equal(f.tables.clients[0].adresse_ligne2, 'Bâtiment B');
    await f.page.reload(); await f.page.getByRole('button', { name: 'Coordonnées', exact: true }).click();
    assert.equal(await f.page.getByLabel('Adresse de livraison', { exact: true }).inputValue(), '25 rue Corrigée');
    await f.page.setViewportSize({ width: 390, height: 844 });
    await audit(f, 'client-contact-mobile');
    await f.page.getByRole('button', { name: 'Synthèse', exact: true }).click();
    await f.page.getByRole('button', { name: 'Réceptionner pour ce client', exact: true }).click();
    await f.page.getByRole('dialog', { name: 'Réceptionner des cartons', exact: true }).waitFor();
    await f.page.waitForFunction(() => document.querySelector('#reception-client')?.value === 'Exemple Camille');
    assert.equal(await f.page.getByPlaceholder('Rechercher un client…').inputValue(), 'Exemple Camille');
    const modal = f.page.getByRole('dialog', { name: 'Réceptionner des cartons', exact: true });
    const box = await modal.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 845, 'Reception dialog remains entirely inside viewport');
    await modal.getByRole('button', { name: 'Fermer', exact: true }).waitFor();
    await audit(f, 'client-reception-mobile');
  });
  await scenario('reception-gap-refused', 'directeur', async f => {
    f.tables.colis[0].statut = 'mesure'; f.tables.colis[0].nb_colis = 1;
    f.tables.colis[0].trackings = ['TEST-001']; f.tables.colis[0].trackings_detail = [{ number: 'TEST-001', fournisseur: 'A' }];
    f.tables.colis[0].dims_par_colis = [{ dimL: 40, dimW: 30, dimH: 20, poids: 3 }];
    await f.login();
    await f.page.getByRole('button', { name: 'Réceptionner des cartons', exact: true }).first().click();
    const dialog = f.page.getByRole('dialog', { name: 'Réceptionner des cartons', exact: true });
    await dialog.getByPlaceholder('Rechercher un client…').fill('Camille');
    await dialog.getByRole('button').filter({ hasText: 'Exemple Camille' }).first().click();
    await dialog.getByRole('button').filter({ hasText: 'EXP-TEST-001' }).first().click();
    await dialog.getByRole('button', { name: '+ Ajouter un carton', exact: true }).click();
    for (const [label, value] of [['Longueur', '20'],['Largeur','20'],['Hauteur','20'],['Poids','2']]) await dialog.getByRole('spinbutton', { name: `${label} à réception (${label === 'Poids' ? 'kg' : 'cm'}) · carton 3`, exact: true }).fill(value);
    await dialog.getByRole('button', { name: /Enregistrer le.*carton.*dans EXP-TEST-001/ }).click();
    await dialog.getByText(/cette ligne est vide avant un carton renseigné/).waitFor();
    assert.equal(f.requests.filter(r => r.method === 'PATCH' && r.path.endsWith('/colis')).length, 0);
    assert.equal(f.tables.colis[0].nb_colis, 1);
    await dialog.getByRole('button', { name: 'Supprimer le carton 2', exact: true }).click();
    assert.equal(await dialog.getByRole('spinbutton', { name: 'Poids à réception (kg) · carton 2', exact: true }).inputValue(), '2');
    await dialog.getByRole('button', { name: /Enregistrer le.*carton.*dans EXP-TEST-001/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(f.tables.colis[0].nb_colis, 2);
    assert.equal(f.tables.colis[0].dims_par_colis[1].poids, 2);
    assert.equal(f.tables.colis[0].ref, 'EXP-TEST-001');
  });
  await scenario('reception-contact-missing-and-forbidden-flag', 'directeur', async f => {
    f.tables.clients[0].user_id = null; f.tables.clients[0].telegram_chat_id = null;
    f.tables.colis[0].statut = 'mesure';
    await f.login(); await f.page.getByRole('button', { name: 'Réceptionner des cartons', exact: true }).first().click();
    const dialog = f.page.getByRole('dialog', { name: 'Réceptionner des cartons', exact: true });
    await dialog.getByPlaceholder('Rechercher un client…').fill('Camille');
    await dialog.getByRole('button').filter({ hasText: 'Exemple Camille' }).first().click();
    await dialog.getByRole('button').filter({ hasText: 'Créer une nouvelle expédition' }).click();
    await dialog.getByText(/Le message sera envoyé à votre confirmation/).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Réceptionner et notifier le client', exact: true }).count(), 0);
    await dialog.getByText(/Compléments de réception/).click();
    await dialog.getByRole('button', { name: 'Batteries lithium', exact: true }).click();
    await dialog.getByPlaceholder('Rechercher un client…').fill('Camille');
    await dialog.getByRole('button').filter({ hasText: 'Exemple Camille' }).first().click();
    await dialog.getByRole('button').filter({ hasText: 'EXP-TEST-001' }).first().click();
    const carton = (f.tables.colis[0].nb_colis || 1) + 1;
    for (const [label, value] of [['Longueur','20'],['Largeur','20'],['Hauteur','20'],['Poids','2']]) await dialog.getByRole('spinbutton', { name: `${label} à réception (${label === 'Poids' ? 'kg' : 'cm'}) · carton ${carton}`, exact: true }).fill(value);
    await dialog.getByRole('button', { name: /Enregistrer le.*carton.*dans EXP-TEST-001/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(f.tables.colis[0].produit_interdit, true);
    assert.ok(f.tables.colis[0].check_interdits.includes('Batteries lithium'));
    assert.equal(f.requests.filter(r => r.path.endsWith('/queue_message')).length, 0);
  });
  await scenario('reception-without-client-access-never-announces-notification', 'directeur', async f => {
    f.tables.clients[0].user_id = null; f.tables.clients[0].telegram_chat_id = null;
    await f.login(); await f.page.getByRole('button', { name: 'Réceptionner des cartons', exact: true }).first().click();
    const dialog = f.page.getByRole('dialog', { name: 'Réceptionner des cartons', exact: true });
    await dialog.getByPlaceholder('Rechercher un client…').fill('Camille');
    await dialog.getByRole('button').filter({ hasText: 'Exemple Camille' }).first().click();
    await dialog.getByLabel('Casier *', { exact: true }).fill('A02');
    for (const [label,value] of [['Longueur','20'],['Largeur','20'],['Hauteur','20'],['Poids','2']]) await dialog.getByRole('spinbutton', { name: `${label} à réception (${label === 'Poids' ? 'kg' : 'cm'}) · carton 1`, exact: true }).fill(value);
    await dialog.getByRole('button', { name: 'Réceptionner les cartons', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(f.tables.colis.length, 2);
    assert.equal(f.requests.filter(r => r.path.endsWith('/queue_message')).length, 0);
    await f.page.getByTestId('dossier-task-header').waitFor();
    await f.page.getByRole('button', { name: 'Préparer la demande au client', exact: true }).click();
    await f.page.getByRole('button', { name: 'Ouvrir le brouillon email', exact: true }).waitFor();
    assert.equal(f.requests.filter(r => r.path.endsWith('/queue_message')).length, 0);
    assert.equal(await f.page.getByText(/notification disponible dans l’espace client/).count(), 0);
  });
  await scenario('departure-edit-conflict-preserves-colleague', 'directeur', async f => {
    f.tables.envois = [{ id: E, ref: 'ENV-TEST', date_depart: '2026-09-12', destination_code: '974', statut: 'planifie', updated_at: '2026-09-12T01:00:00Z', manifest_version: 0 }];
    await f.login(); await f.page.goto(`${base}/departs`);
    await f.page.getByRole('button', { name: 'Modifier le planning', exact: true }).click();
    await f.page.getByLabel('Date', { exact: true }).fill('2026-09-13');
    f.tables.envois[0].date_depart = '2026-09-15'; f.tables.envois[0].updated_at = '2026-09-12T02:00:00Z';
    await f.page.getByRole('button', { name: 'Enregistrer le départ', exact: true }).click();
    await f.page.getByRole('alert').filter({ hasText: 'modifié par un collègue' }).waitFor();
    assert.equal(f.tables.envois[0].date_depart, '2026-09-15');
    assert.equal(await f.page.getByLabel('Date', { exact: true }).inputValue(), '2026-09-13');
  });
  await scenario('notifications-global-unread-and-pagination', 'client', async f => {
    f.tables.notifications = Array.from({ length: 72 }, (_, index) => ({ id: `notification-${index}`, user_id: ids.A, titre: `Notification ${index}`, msg: 'Événement de test', lu: index !== 71, created_at: new Date(Date.UTC(2026,8,12) - index * 60000).toISOString(), colis_id: null }));
    await f.login(); await f.page.goto(`${base}/notifications`);
    await f.page.getByRole('button', { name: 'Charger les notifications précédentes', exact: true }).waitFor();
    assert.equal(await f.page.getByText('Notification 71', { exact: true }).count(), 0);
    // The only unread notification is outside the first page, yet the mark-all control is present.
    await f.page.getByRole('button', { name: /Tout marquer/ }).waitFor();
    await f.page.getByRole('button', { name: 'Charger les notifications précédentes', exact: true }).click();
    await f.page.getByText('Notification 71', { exact: true }).waitFor();
    assert.equal(await f.page.getByRole('button', { name: 'Charger les notifications précédentes', exact: true }).count(), 0);
    const readRequest = f.page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/notifications'));
    await f.page.getByRole('button').filter({ hasText: 'Notification 71' }).click();
    await readRequest;
    assert.equal(f.tables.notifications[71].lu, true);
  });
  await scenario('departure-selection-frozen-manifest', 'directeur', async f => {
    f.tables.envois = [{ id: E, ref: 'ENV-TEST', date_depart: '2026-09-12', destination_code: '974', statut: 'planifie', updated_at: '2026-09-12T01:00:00Z', manifest_version: 0 }];
    Object.assign(f.tables.colis[0], { envoi_id: E, statut: 'paye', paiement_date: '2026-09-11T10:00:00Z', paiement_montant: 60, devis_total: 60 });
    f.tables.colis.push({ ...clone(f.tables.colis[0]), id: 'cccccccc-0000-4000-8000-000000000001', ref: 'EXP-REPORT', statut: 'autorise', paiement_date: null });
    f.tables.colis.push({ ...clone(f.tables.colis[0]), id: 'dddddddd-0000-4000-8000-000000000001', ref: 'EXP-ANNULE', statut: 'annule', devis_total: 999 });
    let snapshot = null; const calls = [];
    await f.context.route('**/rest/v1/rpc/confirm_departure', async route => {
      const input = route.request().postDataJSON(); calls.push(input);
      assert.equal(input.p_loaded.length, 1); assert.equal(input.p_loaded[0].id, ids.P); assert.equal(input.p_deferred_reason, 'Documents à compléter');
      f.tables.envois[0].statut = 'parti'; f.tables.envois[0].manifest_version = 1; f.tables.envois[0].departed_at = '2026-09-12T02:00:00Z';
      f.tables.colis[0].statut = 'expedie'; f.tables.colis[0].date_expedition = '2026-09-12T02:00:00Z';
      f.tables.colis[1].envoi_id = null;
      snapshot = clone({ envoi: f.tables.envois[0], confirmed_at: '2026-09-12T02:00:00Z', items: [{ colis: f.tables.colis[0], client: f.tables.clients[0], lignes: f.tables.lignes, factures: f.tables.factures, categories: f.tables.categories }], deferred: [{ id: f.tables.colis[1].id, ref: 'EXP-REPORT', reason: input.p_deferred_reason }] });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.tables.envois[0]) });
    });
    await f.context.route('**/rest/v1/rpc/get_departure_manifest', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) }));
    await f.login(); await f.page.goto(`${base}/departs?envoi=${E}`);
    await f.page.getByRole('button', { name: 'Vérifier et confirmer le chargement', exact: true }).click();
    const review = f.page.getByRole('region', { name: 'Vérifier le chargement' });
    await review.getByRole('checkbox').first().check();
    assert.equal(await review.getByRole('checkbox').count(), 2, 'Cancelled dossier excluded');
    await review.getByRole('button', { name: /Confirmer le départ de 1/ }).click();
    await f.page.getByRole('alert').filter({ hasText: 'motif du report' }).waitFor();
    assert.equal(calls.length, 0);
    await review.getByRole('textbox', { name: 'Motif du report des dossiers non cochés' }).fill('Documents à compléter');
    await review.getByRole('button', { name: /Confirmer le départ de 1/ }).click();
    await f.page.getByRole('region', { name: 'Manifeste confirmé' }).waitFor();
    assert.equal(calls.length, 1);
    f.tables.colis[0].archive = true; f.tables.colis[0].devis_total = 888;
    await f.page.reload(); await f.page.getByRole('button', { name: 'Voir le manifeste', exact: true }).click();
    await f.page.getByRole('region', { name: 'Manifeste confirmé' }).waitFor();
    await f.page.locator('summary').filter({ hasText: 'Documents du départ' }).click();
    const downloadEvent = f.page.waitForEvent('download');
    await f.page.getByRole('button', { name: 'Manifeste Excel', exact: true }).click();
    const download = await downloadEvent; const target = path.join(out, 'manifest-fixture.xlsx'); await download.saveAs(target);
    const XLSX = require('xlsx'); const workbook = XLSX.readFile(target); const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Embarqués']);
    assert.equal(rows.length, 1); assert.equal(rows[0]['Total devis (€)'], 60); assert.equal(rows[0]['Colis physiques expédiés'], 1);
    await f.page.setViewportSize({ width: 390, height: 844 }); await audit(f, 'departure-manifest-mobile');
  });
  await browser.close();
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ base, passed: results.filter(r => r.pass).length, total: results.length, results }, null, 2));
  await fs.writeFile(path.join(out, 'accessibility.json'), JSON.stringify(accessibility, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
