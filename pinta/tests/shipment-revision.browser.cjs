/* Correction commands against isolated API fixtures; no real client, quote or payment. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');

const output = process.env.PINTA_SHIPMENT_REVISION_OUT || '/tmp/pinta-shipment-revision';
const results = [];
const returnTo = '/colis?q=EXP-TEST-001';
const clone = value => structuredClone(value);
const snapshot = f => JSON.stringify({ colis: f.tables.colis, factures: f.tables.factures, lignes: f.tables.lignes, messages: f.tables.messages });
const revision = (f, phase) => f.page.getByTestId(`shipment-revision-${phase}`);
const field = (f, phase, index = 1, name = 'Longueur', unit = 'cm') => revision(f, phase).getByLabel(`${name} · ${phase === 'reception' ? 'carton' : 'colis préparé'} ${index} (${unit})`, { exact: true });
const advanceVersion = row => { row.updated_at = new Date(Date.parse(row.updated_at) + 60000).toISOString(); };

async function fixture(browser, options = {}) {
  const f = await setup(browser, options.restricted ? 'preparateur' : 'directeur');
  f.page.setDefaultTimeout(10000);
  f.calls = [];
  f.failures = options.conflict ? ['conflict'] : options.networkError ? ['network'] : [];
  Object.assign(f.tables.colis[0], {
    statut: 'devis_envoye', feu_vert: 'autorise', feu_vert_date: '2026-09-09T07:00:00Z',
    dims_par_colis: [{ dimL: 40, dimW: 30, dimH: 20, poids: 1.5 }, { dimL: 35, dimW: 25, dimH: 15, poids: 1.5 }],
    devis_brouillon: false, devis_total: 70, devis_envoye_le: '2026-09-09T10:00:00Z',
    devis_snapshot: { amounts: { transport: 50, om: 10, omr: 2.5, tva: 3.5, fees: 4, total: 70 } },
    frais_divers: [{ libelle: 'Emballage convenu', montant: 4 }],
    payplug_payment_id: 'fixture-unpaid-payment', payplug_payment_url: 'https://example.invalid/fixture-payment',
    ...options.colis,
  });
  if (options.restricted) {
    const permissions = { id: 'quote-only', staff_id: ids.S, perm_colis_calculer_devis: true, ...options.permissions };
    f.tables.staff_permissions = [permissions]; f.tables.staff_users[0].staff_permissions = permissions;
  }
  f.tables.staff_work_preferences[0].active_mission = null;
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await f.context.route('**/functions/v1/correct-colis-task', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const input = route.request().postDataJSON();
    f.calls.push(clone(input));
    const row = f.tables.colis.find(item => item.id === input.colisId);
    const failure = f.failures.shift();
    if (failure === 'network') return route.fulfill({ status: 503, headers, contentType: 'application/json', body: JSON.stringify({ error: 'Correction momentanément indisponible.', message: 'Correction momentanément indisponible.' }) });
    if (failure === 'conflict') {
      row.dims_par_colis[0].dimL = 49; row.dim_l = 49; advanceVersion(row);
      return route.fulfill({ status: 409, headers, contentType: 'application/json', body: JSON.stringify({ code: '40001', error: 'Le dossier a changé. Votre saisie est conservée.', message: 'Le dossier a changé. Votre saisie est conservée.' }) });
    }
    if (!row || input.expectedUpdatedAt !== row.updated_at || !['reception', 'preparation', 'accord', 'devis'].includes(input.task) || !input.reason?.trim()) {
      return route.fulfill({ status: 409, headers, contentType: 'application/json', body: JSON.stringify({ code: '40001', error: 'Version ou commande de correction invalide.', message: 'Version ou commande de correction invalide.' }) });
    }
    const boxes = input.values?.boxes;
    if (input.task === 'reception' || input.task === 'preparation') {
      if (!Array.isArray(boxes) || !boxes.length || boxes.some(box => ['dimL', 'dimW', 'dimH', 'poids'].some(key => !Number.isFinite(box[key]) || box[key] <= 0)) || input.task === 'reception' && boxes.length !== row.nb_colis) {
        return route.fulfill({ status: 400, headers, contentType: 'application/json', body: JSON.stringify({ error: 'Mesures invalides.' }) });
      }
      if (input.task === 'reception') {
        row.dims_par_colis = clone(boxes);
        row.dim_l = Math.max(...boxes.map(box => box.dimL)); row.dim_w = Math.max(...boxes.map(box => box.dimW)); row.dim_h = Math.max(...boxes.map(box => box.dimH)); row.poids = boxes.reduce((sum, box) => sum + box.poids, 0);
      } else {
        row.final_packages = clone(boxes);
        row.fin_l = Math.max(...boxes.map(box => box.dimL)); row.fin_w = Math.max(...boxes.map(box => box.dimW)); row.fin_h = Math.max(...boxes.map(box => box.dimH)); row.fin_p = boxes.reduce((sum, box) => sum + box.poids, 0);
        row.final_measurements_version = row.preparation_composition_version; row.outgoing_parcel_count = boxes.length;
      }
    }
    if (input.task === 'accord') Object.assign(row, { feu_vert: 'en_attente', feu_vert_date: null, statut: 'mesure', demande_feu_vert_envoyee_at: null, attente_client_date: null, attente_client_motif: null, attente_client_until: null, consent_request_version: (row.consent_request_version || 0) + 1 });
    else if (['preparation', 'devis'].includes(input.task) || ['devis_envoye', 'attente_paiement'].includes(row.statut)) row.statut = 'en_preparation';
    Object.assign(row, { devis_snapshot: null, devis_total: null, devis_brouillon: true, payplug_payment_id: null, payplug_payment_url: null });
    advanceVersion(row);
    // Models the Edge result shape; server invalidation and concurrency are
    // verified separately by SQL/Edge tests, not established by this fixture.
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ colis: row, changed: true, invalidated: ['devis', ...(input.task === 'accord' ? ['accord'] : [])] }) });
  });
  return f;
}

async function open(f, task) {
  await f.page.goto(`${base}/colis/${ids.P}?${new URLSearchParams({ section: task, returnTo })}`);
  await f.page.getByTestId('dossier-task-header').waitFor();
}
function unchanged(f, before) {
  assert.equal(snapshot(f), before, 'Navigation, cancellation and no-op edits preserve business data');
  assert.equal(f.calls.length, 0, 'No correction is sent without an explicit changed save');
}
function independentData(f, before, phase) {
  assert.deepEqual(f.tables.factures, before.factures); assert.deepEqual(f.tables.lignes, before.lignes);
  assert.deepEqual(f.tables.colis[0].trackings_detail, before.colis.trackings_detail);
  assert.equal(f.tables.colis[0].nb_colis, before.colis.nb_colis);
  assert.equal(f.tables.colis[0].feu_vert, before.colis.feu_vert);
  assert.equal(f.tables.colis[0].feu_vert_date, before.colis.feu_vert_date);
  assert.deepEqual(f.tables.colis[0].frais_divers, before.colis.frais_divers);
  assert.deepEqual(phase === 'reception' ? f.tables.colis[0].final_packages : f.tables.colis[0].dims_par_colis, phase === 'reception' ? before.colis.final_packages : before.colis.dims_par_colis);
}
function noImplicitMutation(f) {
  assert.equal(f.requests.some(request => /\/(queue_message|client_decision|save_quote|save_invoice_review|save_preparation_measurements|mutate_staff_work_action|revert_colis|revert_colis_status)$/.test(request.path)), false, 'Correction never implies notification, payment, assignment or status rollback');
  assert.equal(f.requests.some(request => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) && /^\/rest\/v1\/(colis|factures|lignes|messages)$/.test(request.path)), false, 'Only the dedicated correction command may change the dossier');
  assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, options = {}) {
    if (process.env.PINTA_SHIPMENT_REVISION_FILTER && !name.includes(process.env.PINTA_SHIPMENT_REVISION_FILTER)) return;
    const f = await fixture(browser, options);
    try {
      await f.page.setViewportSize(options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      await f.login(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
      await run(f); noImplicitMutation(f);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'The correction screen fits the viewport');
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
      await f.page.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, name + '-failure.txt'), await f.page.locator('body').innerText().catch(() => ''));
    } finally { await f.context.close(); console.log(JSON.stringify(results.at(-1))); }
  }
  try {
    await scenario('step-navigation-only-does-not-reopen-or-correct-anything', async f => {
      const before = snapshot(f); await open(f, 'reception'); await revision(f, 'reception').waitFor();
      const select = f.page.getByLabel('Tâche du dossier', { exact: true });
      for (const task of ['accord', 'preparation', 'documents', 'devis', 'paiement', 'expedition', 'livraison', 'reception']) {
        await select.selectOption(task); await f.page.waitForURL(url => url.searchParams.get('section') === task);
      }
      await revision(f, 'reception').waitFor(); unchanged(f, before);
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), returnTo);
    });
    for (const phase of ['reception', 'preparation']) await scenario(`${phase}-prefilled-noop-and-cancel-never-write-mobile`, async f => {
      const before = snapshot(f); await open(f, phase); const panel = revision(f, phase);
      await panel.getByRole('button', { name: 'Modifier', exact: true }).click();
      assert.equal(await field(f, phase).inputValue(), phase === 'reception' ? '40' : '30');
      assert.equal(await panel.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled(), true);
      await field(f, phase).fill(phase === 'reception' ? '40.00' : '30.00');
      assert.equal(await panel.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled(), true, 'Equivalent decimal entry is not a change');
      await field(f, phase).fill('43');
      assert.equal(await panel.getByRole('button', { name: 'Enregistrer', exact: true }).isEnabled(), true);
      await panel.getByRole('button', { name: 'Annuler', exact: true }).click();
      await panel.getByRole('button', { name: 'Modifier', exact: true }).waitFor();
      await panel.getByRole('status').filter({ hasText: 'Modification annulée' }).waitFor(); unchanged(f, before);
      await f.page.screenshot({ path: path.join(output, phase + '-readonly-mobile.png'), fullPage: true });
    }, { mobile: true });
    for (const phase of ['reception', 'preparation']) await scenario(`${phase}-save-is-explicit-and-preserves-independent-work`, async f => {
      const before = { colis: clone(f.tables.colis[0]), factures: clone(f.tables.factures), lignes: clone(f.tables.lignes) };
      await open(f, phase); const panel = revision(f, phase);
      await panel.getByRole('button', { name: 'Modifier', exact: true }).click();
      await panel.getByText(/le devis enregistré sera retiré, ainsi que son lien de paiement éventuel/).waitFor();
      await field(f, phase).fill('42');
      await field(f, phase, 1, 'Poids', 'kg').fill('2,75');
      await panel.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: 'enregistrées.' }).waitFor();
      assert.equal(f.calls.length, 1); assert.equal(f.calls[0].task, phase); assert.equal(f.calls[0].expectedUpdatedAt, before.colis.updated_at);
      assert.deepEqual(Object.keys(f.calls[0].values), ['boxes']); assert.equal(f.calls[0].values.boxes[0].dimL, 42); assert.equal(f.calls[0].values.boxes[0].poids, 2.75);
      independentData(f, before, phase); assert.equal(f.tables.colis[0].devis_snapshot, null); assert.equal(f.tables.colis[0].payplug_payment_url, null);
      await panel.getByRole('button', { name: 'Modifier', exact: true }).waitFor();
      assert.ok(await panel.getByRole('button').count() >= 2, 'Success offers a next action besides editing again');
      await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('documents');
      await f.page.getByTestId('documents-task').waitFor();
      assert.equal(f.tables.factures[0].valide, true);
    });
    await scenario('prepared-package-count-can-change-without-changing-received-cartons', async f => {
      const before = { colis: clone(f.tables.colis[0]), factures: clone(f.tables.factures), lignes: clone(f.tables.lignes) };
      await open(f, 'preparation'); const panel = revision(f, 'preparation');
      await panel.getByRole('button', { name: 'Modifier', exact: true }).click();
      await panel.getByRole('button', { name: 'Ajouter un colis préparé', exact: true }).click();
      for (const [name, unit, value] of [['Longueur', 'cm', '20'], ['Largeur', 'cm', '15'], ['Hauteur', 'cm', '10'], ['Poids', 'kg', '1']]) await field(f, 'preparation', 2, name, unit).fill(value);
      await panel.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: 'enregistrées.' }).waitFor();
      assert.equal(f.calls.length, 1); assert.equal(f.calls[0].values.boxes.length, 2); assert.equal(f.tables.colis[0].outgoing_parcel_count, 2);
      independentData(f, before, 'preparation');
    });
    await scenario('invalid-measure-focuses-exact-field-without-request-mobile', async f => {
      const before = snapshot(f); await open(f, 'reception'); const panel = revision(f, 'reception');
      await panel.getByRole('button', { name: 'Modifier', exact: true }).click();
      const weight = field(f, 'reception', 2, 'Poids', 'kg'); await weight.fill('0');
      await panel.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await panel.getByRole('alert').filter({ hasText: 'Carton 2' }).waitFor();
      assert.equal(await weight.getAttribute('aria-invalid'), 'true'); assert.equal(await weight.evaluate(node => node === document.activeElement), true);
      await panel.getByText('Valeur supérieure à zéro requise.', { exact: true }).waitFor();
      assert.match(await weight.getAttribute('aria-describedby'), /poids-error$/);
      assert.equal(await weight.evaluate(node => {
        const box = node.getBoundingClientRect();
        const visible = document.elementFromPoint(box.left + box.width / 2, box.bottom - 2);
        return box.top >= 0 && box.bottom <= innerHeight && (visible === node || node.contains(visible));
      }), true, 'The focused invalid field remains visible above the fixed mobile navigation');
      unchanged(f, before);
      const audit = await new AxeBuilder({ page: f.page }).include('[data-testid="shipment-revision-reception"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
      await f.page.screenshot({ path: path.join(output, 'receipt-edit-error-mobile.png'), fullPage: true });
    }, { mobile: true });
    await scenario('draft-survives-step-navigation-and-reload-without-save', async f => {
      const before = snapshot(f); await open(f, 'reception'); const panel = revision(f, 'reception');
      await panel.getByRole('button', { name: 'Modifier', exact: true }).click(); await field(f, 'reception').fill('46');
      await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('accord');
      await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('reception');
      await field(f, 'reception').waitFor(); assert.equal(await field(f, 'reception').inputValue(), '46');
      f.page.once('dialog', dialog => dialog.accept()); await f.page.reload();
      await field(f, 'reception').waitFor(); assert.equal(await field(f, 'reception').inputValue(), '46'); unchanged(f, before);
    });
    await scenario('conflict-keeps-draft-and-reloads-only-on-explicit-request', async f => {
      await open(f, 'reception'); const panel = revision(f, 'reception');
      await panel.getByRole('button', { name: 'Modifier', exact: true }).click(); await field(f, 'reception').fill('45');
      await panel.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await panel.getByRole('button', { name: 'Recharger les mesures enregistrées', exact: true }).waitFor();
      assert.equal(await field(f, 'reception').inputValue(), '45'); assert.equal(f.calls.length, 1); assert.equal(f.tables.colis[0].dims_par_colis[0].dimL, 49);
      await panel.getByRole('button', { name: 'Recharger les mesures enregistrées', exact: true }).click();
      await f.page.waitForFunction(() => document.querySelector('[aria-label="Longueur · carton 1 (cm)"]')?.value === '49');
      assert.equal(f.calls.length, 1, 'Reloading performs no new correction');
      assert.equal(await panel.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled(), true);
      const currentVersion = f.tables.colis[0].updated_at;
      await field(f, 'reception').fill('47'); await panel.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: 'enregistrées.' }).waitFor();
      assert.equal(f.calls.length, 2); assert.equal(f.calls[1].expectedUpdatedAt, currentVersion);
    }, { conflict: true });
    await scenario('network-failure-keeps-values-and-retry-is-explicit', async f => {
      await open(f, 'reception'); const panel = revision(f, 'reception');
      await panel.getByRole('button', { name: 'Modifier', exact: true }).click(); await field(f, 'reception').fill('48');
      await panel.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await panel.getByRole('alert').filter({ hasText: /indisponible/ }).waitFor();
      assert.equal(f.calls.length, 1); assert.equal(await field(f, 'reception').inputValue(), '48'); assert.equal(f.tables.colis[0].dims_par_colis[0].dimL, 40);
      await panel.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await panel.getByRole('status').filter({ hasText: 'enregistrées.' }).waitFor();
      assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1], f.calls[0]);
    }, { networkError: true });
    for (const [name, changes] of [['paid', { statut: 'paye', paiement_date: '2026-09-10' }], ['shipped', { statut: 'expedie' }], ['cancelled', { statut: 'annule' }], ['archived', { archive: true }]]) await scenario(`${name}-measurements-stay-read-only`, async f => {
      const before = snapshot(f);
      for (const phase of ['reception', 'preparation']) {
        await open(f, phase); const panel = revision(f, phase); await panel.waitFor();
        assert.equal(await panel.getByRole('button', { name: 'Modifier', exact: true }).count(), 0);
      }
      unchanged(f, before);
    }, { colis: changes });
    await scenario('quote-permission-does-not-grant-measurement-revision', async f => {
      const before = snapshot(f);
      for (const phase of ['reception', 'preparation']) {
        await open(f, phase); const panel = revision(f, phase); await panel.waitFor();
        assert.equal(await panel.getByRole('button', { name: 'Modifier', exact: true }).count(), 0);
      }
      unchanged(f, before);
    }, { restricted: true });
    for (const [name, permissions] of [
      ['measurement-permission-alone', { perm_colis_mesurer: true, perm_colis_preparer: true }],
      ['correction-permission-alone', { perm_colis_revenir_arriere: true }],
    ]) await scenario(`${name}-does-not-grant-measurement-revision`, async f => {
      const before = snapshot(f);
      for (const phase of ['reception', 'preparation']) {
        await open(f, phase); const panel = revision(f, phase); await panel.waitFor();
        assert.equal(await panel.getByRole('button', { name: 'Modifier', exact: true }).count(), 0);
      }
      unchanged(f, before);
    }, { restricted: true, permissions });
    await scenario('new-client-consent-requires-confirmation-and-never-sends-notification', async f => {
      const before = snapshot(f); const saved = clone(f.tables.colis[0]); await open(f, 'accord');
      await f.page.getByRole('button', { name: 'Demander un nouvel accord', exact: true }).click();
      await f.page.getByRole('button', { name: 'Préparer une nouvelle demande', exact: true }).waitFor(); unchanged(f, before);
      await f.page.getByRole('button', { name: 'Annuler', exact: true }).click(); unchanged(f, before);
      await f.page.getByRole('button', { name: 'Demander un nouvel accord', exact: true }).click();
      await f.page.getByRole('button', { name: 'Préparer une nouvelle demande', exact: true }).click();
      await f.page.getByRole('button', { name: 'Préparer la demande au client', exact: true }).waitFor();
      assert.equal(f.calls.length, 1); assert.equal(f.calls[0].task, 'accord');
      assert.equal(f.tables.colis[0].feu_vert, 'en_attente'); assert.equal(f.tables.colis[0].statut, 'mesure');
      assert.deepEqual(f.tables.colis[0].dims_par_colis, saved.dims_par_colis); assert.deepEqual(f.tables.colis[0].final_packages, saved.final_packages);
      assert.equal(f.tables.factures[0].valide, true); assert.equal(f.tables.messages.length, 0);
      await f.page.screenshot({ path: path.join(output, 'new-consent-after-reopen.png'), fullPage: true });
    });
    await scenario('sent-quote-reopens-as-an-editable-draft-without-notification', async f => {
      const saved = clone(f.tables.colis[0]); await open(f, 'devis');
      await f.page.getByRole('button', { name: 'Modifier le devis', exact: true }).click();
      assert.equal(f.calls.length, 0); await f.page.getByRole('button', { name: 'Reprendre le devis', exact: true }).click();
      await f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis', exact: true }).waitFor();
      assert.equal(f.calls.length, 1); assert.equal(f.calls[0].task, 'devis');
      assert.deepEqual(f.tables.colis[0].dims_par_colis, saved.dims_par_colis); assert.deepEqual(f.tables.colis[0].final_packages, saved.final_packages);
      assert.deepEqual(f.tables.colis[0].frais_divers, saved.frais_divers); assert.equal(f.tables.factures[0].valide, true);
      assert.equal(f.tables.colis[0].feu_vert, 'autorise'); assert.equal(f.tables.colis[0].devis_snapshot, null); assert.equal(f.tables.messages.length, 0);
    });
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
