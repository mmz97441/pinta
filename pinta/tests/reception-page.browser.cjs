/* Full-page reception, entirely isolated from real clients and services. */
const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, ids, base } = require('./browser-regression.cjs');
const out = process.env.PINTA_RECEPTION_OUT || '/tmp/pinta-reception-page';
async function measures(page, number, values) {
  for (const [index, label] of ['Longueur', 'Largeur', 'Hauteur', 'Poids'].entries()) await page.getByLabel(`${label} à réception (${label === 'Poids' ? 'kg' : 'cm'}) · carton ${number}`, { exact: true }).fill(String(values[index]));
}
async function run() {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const mobile of [false, true]) for (const dark of [false, true]) {
      const f = await setup(browser, 'directeur');
      f.page.setDefaultTimeout(10000);
      await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      await f.page.addInitScript(dark => { localStorage.setItem('expedile-theme', dark ? 'dark' : 'light'); }, dark);
      // Existing dossier has two measured boxes, a distinct optimized package, and invoices.
      f.tables.colis[0].dims_par_colis = [{ dimL: 40, dimW: 30, dimH: 20, poids: 2 }, { dimL: 20, dimW: 10, dimH: 10, poids: 1 }];
      let conflict = false, loseResponse = false, counter = 0;
      const receipts = new Map();
      await f.context.route('**/rest/v1/rpc/append_reception_cartons', async route => {
        const input = route.request().postDataJSON();
        f.requests.push({ method: 'POST', path: '/rest/v1/rpc/append_reception_cartons', input });
        const current = f.tables.colis.find(item => item.id === input.p_colis_id);
        if (receipts.has(input.p_request_id)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ colis: current, reused: true }) });
        if (conflict || input.p_expected_updated_at !== current.updated_at) { conflict = false; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '40001', message: 'Le dossier a changé. Actualisez sans perdre votre saisie.' }) }); }
        const next = input.p_cartons.map(box => Object.fromEntries(['dimL', 'dimW', 'dimH', 'poids'].map(key => [key, Number(box[key])])));
        current.dims_par_colis = [...(current.dims_par_colis || []), ...next];
        current.nb_colis += next.length;
        current.trackings = [...current.trackings, ...input.p_cartons.map(box => box.tracking).filter(Boolean)];
        current.trackings_detail = [...current.trackings_detail, ...input.p_cartons.map(box => ({ number: box.tracking || '', fournisseur: box.fournisseur || '' }))];
        current.casier = input.p_casier || current.casier;
        current.statut = 'mesure'; current.feu_vert = 'en_attente';
        current.preparation_composition_version = (current.preparation_composition_version || 1) + 1;
        current.final_measurements_version = null;
        current.updated_at = `2026-10-01T10:00:${String(++counter).padStart(2, '0')}Z`;
        receipts.set(input.p_request_id, true);
        if (loseResponse) { loseResponse = false; return route.abort('failed'); }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ colis: current }) });
      });
      await f.login();
      await f.page.goto(`${base}/reception?dossier=${ids.P}&returnTo=%2Fcolis`);
      const region = f.page.getByRole('region', { name: 'Réceptionner des cartons', exact: true });
      await region.waitFor();
      assert.equal(await f.page.getByRole('dialog').count(), 0, 'Reception is a page, not a focus-trapping modal');
      await region.getByRole('heading', { name: 'Carton 3', exact: true }).waitFor();
      await region.getByRole('button', { name: 'Enregistrer et ajouter un carton', exact: true }).click();
      await region.getByRole('alert').filter({ hasText: /Carton 3/ }).waitFor();
      assert.equal(f.requests.filter(r => r.path.endsWith('append_reception_cartons')).length, 0, 'Incomplete measurements never reach the server');
      await measures(region, 3, [50, 30, 20, 2.5]);
      await f.page.reload();
      await region.waitFor();
      assert.equal(await region.getByLabel('Longueur à réception (cm) · carton 3').inputValue(), '50', 'Draft survives reload');
      conflict = true;
      await region.getByRole('button', { name: 'Enregistrer et ajouter un carton', exact: true }).click();
      await region.getByRole('alert').filter({ hasText: 'Le dossier a changé' }).waitFor();
      assert.equal(await region.getByLabel('Poids à réception (kg) · carton 3').inputValue(), '2.5');
      assert.equal(f.tables.colis[0].nb_colis, 2, 'Failed append leaves persisted boxes unchanged');
      await region.getByRole('button', { name: 'Actualiser le dossier sans perdre ma saisie' }).click();
      await region.getByRole('button', { name: 'Enregistrer et ajouter un carton', exact: true }).click();
      await region.getByRole('heading', { name: 'Carton 4', exact: true }).waitFor();
      await region.getByRole('status').filter({ hasText: 'Carton 3 enregistré · EXP-TEST-001 · Casier A-03' }).waitFor();
      assert.equal(f.tables.colis.length, 1, 'Appending does not create another EXP');
      assert.equal(f.tables.colis[0].nb_colis, 3);
      assert.equal(f.tables.colis[0].fin_p, 3, 'Reception weight never overwrites optimized weight');
      assert.equal(await region.getByLabel('Poids à réception (kg) · carton 4').inputValue(), '', 'Next carton starts empty');
      // Leaving and reopening the same route retains the EXP and carton numbering.
      await region.getByRole('button', { name: 'Retour à ma liste, conserver le brouillon' }).click();
      await f.page.goto(`${base}/reception?dossier=${ids.P}&returnTo=%2Fcolis`);
      await region.getByRole('heading', { name: 'Carton 4', exact: true }).waitFor();
      await measures(region, 4, [15, 12, 10, 0.75]);
      const axe = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], 'No accessibility violations on reception');
      await f.page.screenshot({ path: path.join(out, `reception-${mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
      loseResponse = true;
      await region.getByRole('button', { name: 'Terminer la réception', exact: true }).click();
      await region.getByRole('button', { name: 'Vérifier l’enregistrement', exact: true }).waitFor();
      assert.equal(f.tables.colis[0].nb_colis, 4, 'Server committed even though the response was lost');
      assert.equal(await region.getByLabel('Poids à réception (kg) · carton 4').isDisabled(), true, 'Uncertain receipt cannot be changed before verification');
      await f.page.reload();
      await region.getByRole('button', { name: 'Vérifier l’enregistrement', exact: true }).click();
      await f.page.getByRole('heading', { name: 'Réception enregistrée', exact: true }).waitFor();
      await f.page.getByRole('status').filter({ hasText: 'Carton 4 enregistré · EXP-TEST-001 · Casier A-03' }).waitFor();
      assert.equal(f.tables.colis[0].nb_colis, 4);
      assert.ok(!f.requests.some(r => /queue_message|send-telegram|send-email/.test(r.path)), 'Reception never notifies the client');
      await f.page.getByRole('button', { name: 'Ouvrir le dossier EXP-TEST-001', exact: true }).click();
      await f.page.waitForURL(`**/colis/${ids.P}?*`);
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/colis');
      assert.deepEqual(f.errors, []);
      results.push({ mobile, dark, pass: true, scenarios: ['required-measures', 'same-exp-append', 'continuous-numbering', 'draft-reload', 'draft-back', 'conflict-retains-input', 'separate-optimized-measures', 'finish-confirmation', 'lost-response-idempotent-replay-after-reload', 'no-notification', 'axe'] });
      await f.context.close();
    }
    // Several open dossiers require an explicit choice before receiving another box.
    const f = await setup(browser, 'directeur');
    f.page.setDefaultTimeout(10000);
    f.tables.colis.push({ ...f.tables.colis[0], id: '77777777-7777-4777-8777-777777777777', ref: 'EXP-TEST-002', casier: 'B-04' });
    let creationOutage = false;
    await f.context.route('**/rest/v1/colis*', async route => {
      if (route.request().method() !== 'POST') { if (creationOutage && new URL(route.request().url()).searchParams.has('id')) return route.abort('failed'); return route.fallback(); }
      const input = route.request().postDataJSON();
      f.requests.push({ method: 'POST', path: '/rest/v1/colis', input });
      const row = { ...input, id: input.id, ref: 'EXP-NEW123', updated_at: '2026-10-01T11:00:00Z', created_at: '2026-10-01T11:00:00Z' };
      f.tables.colis.push(row);
      creationOutage = true;
      return route.abort('failed');
    });
    await f.login();
    await f.page.goto(`${base}/reception?client=${ids.C}`);
    const region = f.page.getByRole('region', { name: 'Réceptionner des cartons', exact: true });
    await region.getByText('Ce client a 2 expédition(s) ouverte(s)').waitFor();
    assert.equal(await region.getByLabel('Longueur à réception (cm) · carton 1').count(), 0, 'No entry until the expedition is chosen');
    await region.getByRole('button').filter({ hasText: 'EXP-TEST-002' }).click();
    await region.getByRole('heading', { name: 'Carton 3', exact: true }).waitFor();
    await region.getByRole('button', { name: 'Changer', exact: true }).click();
    await region.getByRole('button', { name: 'Créer une nouvelle expédition (nouveau EXP)', exact: true }).click();
    await region.getByLabel('Casier', { exact: false }).fill('C-05');
    await measures(region, 1, [20, 20, 20, 1]);
    await region.getByRole('button', { name: 'Enregistrer et ajouter un carton', exact: true }).click();
    await region.getByRole('button', { name: 'Vérifier l’enregistrement', exact: true }).waitFor();
    assert.equal(f.tables.colis.length, 3, 'Creation committed before the response was lost');
    assert.equal(await region.getByLabel('Client', { exact: true }).isDisabled(), true);
    creationOutage = false;
    await f.page.reload();
    await region.getByRole('button', { name: 'Vérifier l’enregistrement', exact: true }).click();
    await region.getByRole('heading', { name: 'Carton 2', exact: true }).waitFor();
    await region.getByRole('status').filter({ hasText: 'Carton 1 enregistré · EXP-NEW123 · Casier C-05' }).waitFor();
    assert.equal(f.requests.filter(r => r.path === '/rest/v1/colis' && r.method === 'POST').length, 1);
    await region.getByRole('button', { name: 'Terminer la réception', exact: true }).click();
    await f.page.getByRole('heading', { name: 'Réception enregistrée', exact: true }).waitFor();
    assert.equal(f.tables.colis.at(-1).nb_colis, 1, 'Finish after continue saves no empty carton');
    await f.page.getByRole('button', { name: 'Réceptionner pour un autre client', exact: true }).click();
    await region.waitFor();
    assert.equal(await region.getByLabel('Client', { exact: true }).inputValue(), '');
    await region.getByLabel('Client', { exact: true }).fill('Camille');
    await region.getByRole('button').filter({ hasText: 'Exemple' }).first().click();
    await region.getByRole('button').filter({ hasText: 'EXP-NEW123' }).click();
    await measures(region, 2, [30, 30, 30, 2]);
    await region.getByRole('button', { name: 'Effacer le brouillon', exact: true }).click();
    await region.getByRole('button', { name: 'Oui, effacer le brouillon', exact: true }).click();
    await f.page.reload();
    await region.waitFor();
    assert.equal(await region.getByLabel('Client', { exact: true }).inputValue(), '', 'Discard stays discarded after reload');
    assert.equal(await region.getByLabel('Poids à réception (kg) · carton 2').count(), 0);
    assert.ok(!f.requests.some(r => /queue_message|send-telegram|send-email/.test(r.path)));
    assert.deepEqual(f.errors, []);
    results.push({ pass: true, scenarios: ['multiple-explicit-choice', 'new-reception', 'new-exp-continue', 'creation-lost-response-reload-same-exp', 'finish-without-empty-carton', 'another-client', 'explicit-draft-discard'] });
    await f.context.close();
  } catch(error) {
    results.push({ pass: false, error: error.stack });
    const page = browser.contexts().flatMap(context => context.pages()).at(-1);
    await page?.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); }
}
run();
