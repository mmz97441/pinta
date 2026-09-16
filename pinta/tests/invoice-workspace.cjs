/* Invoice workspace regressions on fictitious data only. The shared transport
 * intercepts every provider request; these tests never contact real customers.
 * Backend atomicity/permissions are checked separately by the SQL suite. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setup, ids, base } = require('./browser-regression.cjs');

const output = process.env.PINTA_INVOICE_WORKSPACE_OUT || path.join(os.tmpdir(), 'pinta-invoice-workspace-20260916');
const B = '44444444-4444-4444-8444-444444444445';
const C = '44444444-4444-4444-8444-444444444446';
const EXTRACTION_B = '74444444-4444-4444-8444-444444444445';
const EXTRACTION_C = '74444444-4444-4444-8444-444444444446';
const UNLINKED = '54444444-4444-4444-8444-444444444446';
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const results = [];

async function fixture(browser, options = {}) {
  const f = await setup(browser, options.role || 'directeur');
  const { page, tables, context } = f;
  page.setDefaultTimeout(10000);
  if (options.permissions) {
    const row = { id: 'permission-row', staff_id: ids.S, ...options.permissions };
    tables.staff_permissions = [row];
    tables.staff_users[0].staff_permissions = row;
  }
  tables.factures[0].fichier_nom = 'achat-verifie.pdf';
  tables.factures[0].review_version = 1;
  tables.factures.push(
    { id: B, colis_id: ids.P, vendeur: 'Document à vérifier', montant: 0, valide: false, fichier_url: ids.P + '/scelleuse.pdf', fichier_nom: 'scelleuse.pdf', ocr_status: 'review', review_version: 1 },
    { id: C, colis_id: ids.P, vendeur: 'Document à vérifier', montant: 0, valide: false, fichier_url: ids.P + '/autre-achat.pdf', fichier_nom: 'autre-achat.pdf', ocr_status: 'review', review_version: 1 },
  );
  if (options.unlinked) tables.lignes.push({ id: UNLINKED, colis_id: ids.P, facture_id: null, description: 'Article saisi avant réception de la facture', qte: 1, prix_unitaire: 12, categorie_id: 'cat-test' });
  const records = new Map([
    [ids.F, { factureId: ids.F, reviewToken: 'review-1-a', extraction: null, draft: null, documentHash: 'hash-a', duplicateCandidateIds: [] }],
    [B, { factureId: B, reviewToken: 'review-1-b', extraction: { id: EXTRACTION_B, facture_id: B, document_hash: 'hash-b', document_file_url: ids.P + '/scelleuse.pdf', document_storage_identity: 'stored-b-1', status: 'review', vendeur: 'Boutique B', total: 16.64, lines: [{ desc: 'Scelleuse thermique', qte: 1, prix: 16.64, cat: options.category || null }], warnings: [] }, draft: null, documentHash: 'hash-b', duplicateCandidateIds: options.duplicates ? [C] : [] }],
    [C, { factureId: C, reviewToken: 'review-1-c', extraction: { id: EXTRACTION_C, facture_id: C, document_hash: options.duplicates ? 'hash-b' : 'hash-c', document_file_url: ids.P + '/autre-achat.pdf', document_storage_identity: 'stored-c-1', status: 'review', vendeur: 'Boutique C', total: 28, lines: [{ desc: 'Organisateur de bureau', qte: 1, prix: 28, cat: 'cat-test' }], warnings: [] }, draft: null, documentHash: options.duplicates ? 'hash-b' : 'hash-c', duplicateCandidateIds: options.duplicates ? [B] : [] }],
  ]);
  if (options.duplicates) Object.assign(records.get(C).extraction, { vendeur: 'Boutique B', total: 16.64, lines: [{ desc: 'Scelleuse thermique', qte: 1, prix: 16.64, cat: 'cat-test' }] });
  if (options.noAnalysis) for (const id of [B, C]) Object.assign(records.get(id), { extraction: null, documentHash: null, duplicateCandidateIds: [] });
  const calls = [], mutations = [];
  const control = { failSave: false, loseResponse: false, failContext: false, failRefresh: false, failClassify: false, gate: null };
  page.on('request', request => {
    const url = new URL(request.url());
    if (/\/rest\/v1\/(factures|lignes)$/.test(url.pathname) && request.method() !== 'GET') mutations.push({ path: url.pathname, method: request.method(), input: request.postDataJSON() });
  });
  const answer = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/storage/v1/object/sign/factures/**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') return answer(route, { signedURL: url.pathname + '?token=local-fixture' });
    const storedPath = decodeURIComponent(url.pathname.split('/object/sign/factures/')[1]);
    const invoice = tables.factures.find(item => item.fichier_url === storedPath);
    const extraction = records.get(invoice?.id)?.extraction;
    const { jsPDF } = require('jspdf');
    const pdf = new jsPDF();
    pdf.text('Facture fictive : ' + (invoice?.fichier_nom || storedPath), 20, 30);
    pdf.text((extraction?.vendeur || invoice?.vendeur || 'Boutique') + ' - ' + (extraction?.total || invoice?.montant || 0) + ' EUR HT', 20, 45);
    pdf.addPage(); pdf.text('Page 2 - Articles du document ' + (invoice?.fichier_nom || storedPath), 20, 30);
    pdf.text(extraction?.lines[0]?.desc || 'Article deja verifie', 20, 45);
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(pdf.output('arraybuffer')) });
  });
  await context.route('**/rest/v1/rpc/get_invoice_review_context', route => {
    calls.push({ kind: 'context', input: route.request().postDataJSON() });
    if (control.failContext) return answer(route, { message: 'Chargement des vérifications temporairement indisponible.' }, 503);
    const current = tables.factures.map(invoice => {
      if (!records.has(invoice.id)) records.set(invoice.id, { factureId: invoice.id, reviewToken: 'review-' + invoice.id, extraction: null, draft: null, documentHash: null, duplicateCandidateIds: [] });
      return clone(records.get(invoice.id));
    });
    return answer(route, { invoices: current, unlinkedLines: tables.lignes.filter(line => !line.facture_id).map(clone) });
  });
  await context.route('**/functions/v1/ocr-facture', route => {
    const input = route.request().postDataJSON();
    calls.push({ kind: 'ocr', input });
    if (!['resume', 'extract'].includes(input.action)) return answer(route, { error: 'Unexpected legacy OCR confirmation.' }, 400);
    return answer(route, { success: true, extraction: clone(records.get(input.factureId)?.extraction || null), insertedLignes: [], reused: true });
  });
  await context.route('**/rest/v1/rpc/save_invoice_review', async route => {
    const input = route.request().postDataJSON();
    calls.push({ kind: 'save', input: clone(input) });
    if (control.gate) { const gate = control.gate; control.gate = null; gate.entered.resolve(); await gate.release.promise; }
    if (control.failSave) { control.failSave = false; return answer(route, { code: 'XX000', message: 'Enregistrement indisponible pour cet essai. Votre saisie est conservée.' }, 503); }
    const record = records.get(input.p_facture_id);
    const invoice = tables.factures.find(item => item.id === input.p_facture_id);
    if (input.p_expected_review_token !== record.reviewToken || input.p_expected_file_url !== invoice.fichier_url) return answer(route, { code: '40001', message: 'Cette facture a changé. Rechargez sa vérification avant de recommencer.' }, 409);
    record.reviewToken += '-saved';
    const confirmed = input.p_confirm !== false;
    record.draft = confirmed ? null : { lines: clone(input.p_lines), total: input.p_total, vendeur: input.p_vendeur, extractionId: input.p_extraction_id };
    let insertedLignes = [];
    if (confirmed) {
      tables.lignes = tables.lignes.filter(line => line.facture_id !== invoice.id);
      insertedLignes = input.p_lines.map((line, index) => ({ id: `${invoice.id}-${index}`, desc: line.desc, qte: line.qte, prix: line.prix, cat: line.cat, factureId: invoice.id }));
      tables.lignes.push(...insertedLignes.map(line => ({ id: line.id, colis_id: ids.P, facture_id: invoice.id, description: line.desc, qte: line.qte, prix_unitaire: line.prix, categorie_id: line.cat })));
      Object.assign(invoice, { vendeur: input.p_vendeur, montant: input.p_total, valide: true, rejet_motif: null });
      if (record.extraction) Object.assign(record.extraction, { status: 'confirmed', vendeur: input.p_vendeur, total: input.p_total, lines: clone(input.p_lines) });
    }
    if (control.loseResponse) { control.loseResponse = false; return route.abort('connectionreset'); }
    return answer(route, { success: true, confirmed, facture: clone(invoice), insertedLignes, reviewToken: record.reviewToken });
  });
  await context.route('**/rest/v1/rpc/classify_invoice_duplicate', route => {
    const input = route.request().postDataJSON(); calls.push({ kind: 'classify', input });
    if (control.failClassify) return answer(route, { message: 'Retrait indisponible. Votre facture est conservée.' }, 503);
    const record = records.get(input.p_facture_id), original = records.get(input.p_original_facture_id);
    if (record.reviewToken !== input.p_expected_review_token || original.reviewToken !== input.p_expected_original_review_token) return answer(route, { code: '40001', message: 'Une facture a changé. Rechargez la comparaison.' }, 409);
    const invoice = tables.factures.find(item => item.id === input.p_facture_id);
    invoice.duplicate_of_facture_id = input.p_original_facture_id; invoice.valide = false;
    record.reviewToken += '-classified'; record.draft = null;
    return answer(route, { success: true, facture: clone(invoice), reviewToken: record.reviewToken });
  });
  await context.route('**/rest/v1/rpc/restore_invoice_duplicate', route => {
    const input = route.request().postDataJSON(); calls.push({ kind: 'restore', input });
    const record = records.get(input.p_facture_id);
    if (record.reviewToken !== input.p_expected_review_token) return answer(route, { code: '40001', message: 'Document modifié depuis le classement.' }, 409);
    const invoice = tables.factures.find(item => item.id === input.p_facture_id);
    invoice.duplicate_of_facture_id = null; invoice.valide = false;
    record.reviewToken += '-restored';
    return answer(route, { success: true, facture: clone(invoice), reviewToken: record.reviewToken });
  });
  await context.route('**/rest/v1/colis?*', route => {
    if (control.failRefresh && route.request().method() === 'GET') return answer(route, { message: 'Actualisation indisponible après enregistrement.' }, 503);
    return route.fallback();
  });
  return { ...f, calls, mutations, control, records };
}

const review = f => f.page.getByRole('region', { name: 'Vérification de la facture', exact: true });
const invoiceSelect = f => f.page.getByLabel('Facture à vérifier', { exact: true });
const validate = f => review(f).getByRole('button', { name: /^(Valider et passer à la suivante|Terminer la vérification)$/ });
const saveDraft = f => review(f).getByRole('button', { name: 'Enregistrer le brouillon', exact: true });
const saves = f => f.calls.filter(call => call.kind === 'save');
const category = f => review(f).getByLabel('Catégorie de l’article 1', { exact: true });
const description = f => review(f).getByLabel('Description de l’article 1', { exact: true });
const total = f => review(f).getByLabel('Total HT de la facture', { exact: true });
const confirmed = f => f.page.getByTestId('invoice-header-feedback').filter({ hasText: 'facture et articles validés et enregistrés' }).waitFor();

async function open(f, invoice = B) {
  await f.page.goto(`${base}/colis/${ids.P}?invoice=${invoice}&returnTo=%2Fcolis#quote-documents`);
  await f.page.getByRole('region', { name: 'Vérification de la facture', exact: true, includeHidden: true }).waitFor({ state: 'attached' });
  await f.page.getByLabel('Facture à vérifier', { exact: true }).waitFor({ state: 'attached' });
  // The region/select render before the async review context and its draft.
  // Attached (rather than visible) also covers the mobile Document tab.
  await f.page.getByTestId('invoice-action-bar').waitFor({ state: 'attached' });
}

async function openRetired(f, label = 'Facture 3 — autre-achat.pdf') {
  const history = f.page.locator('details').filter({ has: f.page.locator('summary').filter({ hasText: /^Doublons retirés/ }) });
  await history.waitFor();
  // The successful command finishes its refresh (including retries) before
  // switching to the original and re-enabling navigation.
  await history.locator('button:enabled').first().waitFor({ state: 'attached' });
  if (!await history.evaluate(element => element.open)) await history.locator('summary').click();
  await history.getByRole('button', { name: label, exact: true }).click();
}

async function visibleAndReachable(locator) {
  await locator.waitFor();
  assert.ok(await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.top < 0 || box.bottom > innerHeight + 1) return false;
    const hit = document.elementFromPoint(Math.min(innerWidth - 1, box.left + box.width / 2), box.top + box.height / 2);
    return hit === element || element.contains(hit);
  }), 'Action/feedback must remain within the viewport and not be covered by the quote action bar.');
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const scenario = async (name, options, action) => {
    if (process.env.PINTA_INVOICE_WORKSPACE_FILTER && !name.includes(process.env.PINTA_INVOICE_WORKSPACE_FILTER)) return;
    const f = await fixture(browser, options);
    try {
      await f.login();
      await action(f);
      assert.deepEqual(f.errors, [], 'No uncaught application exception');
      assert.deepEqual(f.networkDenied, [], 'No unexpected provider request');
      assert.deepEqual(f.mutations, [], 'Invoice verification must not make partial direct-table writes');
      assert.equal(f.requests.some(request => request.path.endsWith('/queue_message')), false, 'Invoice review must never send a customer message implicitly');
      results.push({ test: name, pass: true, saves: saves(f).length });
    } catch (error) {
      results.push({ test: name, pass: false, error: error.stack, url: f.page.url(), calls: f.calls, pageErrors: f.errors });
      await f.page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, `${name}-failure.txt`), await f.page.locator('body').innerText().catch(() => 'page unavailable'));
      process.exitCode = 1;
    } finally { await f.context.close(); }
  };
  try {
    await scenario('several-invoices-visible-and-indicator-target-preserved', {}, async f => {
      await f.page.goto(base + '/colis');
      await f.page.getByRole('link', { name: '2 factures reçues · À vérifier — EXP-TEST-001', exact: true }).filter({ visible: true }).click();
      assert.equal(new URL(f.page.url()).searchParams.get('invoice'), B);
      await invoiceSelect(f).locator('option[value="' + ids.F + '"]').waitFor({ state: 'attached' });
      assert.equal(await invoiceSelect(f).locator('option').count(), 3);
      assert.ok((await f.page.getByTestId('documents-task').boundingBox()).width >= 900, 'Desktop review uses the available width for the source document and its articles.');
      assert.equal(await f.page.getByLabel('Facture à vérifier', { exact: true }).inputValue(), B);
      await validate(f).waitFor();
      assert.equal(await validate(f).count(), 1);
      assert.equal(await f.page.getByRole('button', { name: /^(Valider la facture|Confirmer les articles vérifiés)$/ }).count(), 0);
      assert.match(await invoiceSelect(f).innerText(), /Validée|Vérifiée/);
      const canvas = f.page.getByRole('region', { name: 'Document source', exact: true }).locator('canvas[data-rendered="true"]');
      await canvas.waitFor();
      const firstDocument = await canvas.evaluate(element => element.toDataURL());
      await invoiceSelect(f).selectOption(C);
      await category(f).waitFor();
      assert.equal(await description(f).inputValue(), 'Organisateur de bureau');
      await canvas.waitFor();
      await f.page.waitForFunction(previous => {
        const source = document.querySelector('[aria-label="Document source"] canvas[data-rendered="true"]');
        return source && source.toDataURL() !== previous;
      }, firstDocument);
      assert.notEqual(await canvas.evaluate(element => element.toDataURL()), firstDocument, 'Selecting another invoice must render a different source PDF, not only change editable fields.');
      const actions = f.page.getByTestId('invoice-action-bar');
      assert.match(await actions.innerText(), /Facture 3 \/ 3 · autre-achat.pdf/);
      await actions.getByRole('button', { name: 'Vérifier la facture précédente', exact: true }).click();
      assert.equal(await description(f).inputValue(), 'Scelleuse thermique');
      assert.equal(saves(f).length, 0);
    });

    await scenario('missing-category-and-inconsistent-total-explained-at-action', {}, async f => {
      await open(f);
      await category(f).waitFor();
      if (await validate(f).isEnabled()) await validate(f).click();
      assert.match(await f.page.getByTestId('invoice-action-bar').innerText(), /catégorie/i);
      assert.equal(saves(f).length, 0);
      await category(f).selectOption('cat-test');
      await total(f).fill('99');
      if (await validate(f).isEnabled()) await validate(f).click();
      assert.match(await f.page.getByTestId('invoice-action-bar').innerText(), /total|somme|écart/i);
      assert.equal(saves(f).length, 0);
      await total(f).fill('16.64');
      assert.equal(await validate(f).isEnabled(), true);
    });

    await scenario('draft-survives-invoice-tabs-and-server-save-reload', {}, async f => {
      await open(f);
      await description(f).fill('Scelleuse relue par Camille');
      await category(f).selectOption('cat-test');
      await invoiceSelect(f).selectOption(C);
      await description(f).fill('Organisateur relu par Camille');
      await invoiceSelect(f).selectOption(B);
      assert.equal(await description(f).inputValue(), 'Scelleuse relue par Camille');
      await f.page.setViewportSize({ width: 390, height: 844 });
      await f.page.getByRole('tab', { name: 'Document', exact: true }).click();
      await f.page.getByRole('tab', { name: 'Articles et vérification', exact: true }).click();
      assert.equal(await description(f).inputValue(), 'Scelleuse relue par Camille');
      await saveDraft(f).click();
      await f.page.getByTestId('invoice-feedback').filter({ hasText: 'Brouillon enregistré pour scelleuse.pdf.' }).waitFor();
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, false);
      assert.equal(f.tables.lignes.length, 1);
      assert.equal(saves(f)[0].input.p_confirm, false);
      await f.page.reload();
      await f.page.getByRole('tab', { name: 'Articles et vérification', exact: true }).click();
      assert.equal(await description(f).inputValue(), 'Scelleuse relue par Camille');
      assert.equal(await category(f).inputValue(), 'cat-test');
    });

    await scenario('one-confirmation-double-click-guard-and-other-articles-preserved', { category: 'cat-test', unlinked: true }, async f => {
      await open(f);
      const original = clone(f.tables.lignes);
      const entered = deferred(), release = deferred();
      f.control.gate = { entered, release };
      await validate(f).click();
      await entered.promise;
      assert.equal(await validate(f).isDisabled(), true);
      // A second synthetic activation cannot bypass the synchronous in-flight guard.
      await validate(f).evaluate(button => button.click());
      assert.equal(saves(f).length, 1);
      release.resolve();
      await confirmed(f);
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, true);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === B).length, 1);
      assert.deepEqual(f.tables.lignes.filter(line => line.facture_id !== B), original);
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).valide, false);
      const payload = saves(f)[0].input;
      assert.equal(payload.p_total, 16.64);
      assert.equal(payload.p_vendeur, 'Boutique B');
      assert.equal(payload.p_lines[0].cat, 'cat-test');
      assert.equal(payload.p_confirm, true);
      await f.page.waitForFunction(id => document.querySelector('[aria-label="Facture à vérifier"]')?.value === id, C);
      assert.equal(await f.page.getByLabel('Facture à vérifier', { exact: true }).inputValue(), C);
    });

    await scenario('mobile-next-pending-invoice-keeps-articles-tab-from-document-url', { category: 'cat-test' }, async f => {
      await f.page.setViewportSize({ width: 390, height: 844 });
      await open(f, B);
      assert.equal(new URL(f.page.url()).searchParams.get('invoice'), B);
      await f.page.getByRole('tab', { name: 'Articles et vérification', exact: true }).click();
      await validate(f).click(); await confirmed(f);
      await f.page.waitForFunction(id => document.querySelector('[aria-label="Facture à vérifier"]')?.value === id, C);
      await description(f).waitFor();
      assert.equal(await f.page.getByLabel('Facture à vérifier', { exact: true }).inputValue(), C);
      assert.equal(await f.page.getByRole('tab', { name: 'Articles et vérification', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await f.page.getByRole('tab', { name: 'Document', exact: true }).getAttribute('aria-selected'), 'false');
      assert.equal(await description(f).inputValue(), 'Organisateur de bureau');
      assert.equal(await f.page.getByRole('region', { name: 'Document source', exact: true }).isVisible(), false);
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, true);
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).valide, false);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === B).length, 1);
      assert.equal(saves(f).length, 1);
    });

    await scenario('colleague-completes-next-invoice-during-save-opens-fresh-summary', { category: 'cat-test' }, async f => {
      await open(f, B);
      const entered = deferred(), release = deferred();
      f.control.gate = { entered, release };
      await validate(f).click();
      await entered.promise;
      Object.assign(f.tables.factures.find(invoice => invoice.id === C), { valide: true, vendeur: 'Boutique C', montant: 28 });
      f.tables.lignes.push({ id: 'colleague-completed-c', colis_id: ids.P, facture_id: C, description: 'Organisateur relu par le collègue', qte: 1, prix_unitaire: 28, categorie_id: 'cat-test' });
      f.records.get(C).reviewToken = 'confirmed-by-colleague-during-save';
      release.resolve();
      await confirmed(f);
      await f.page.getByRole('button', { name: 'Consulter les factures', exact: true }).waitFor();
      assert.equal(await review(f).count(), 0, 'The next task uses refreshed records and does not reopen a colleague’s completed invoice.');
      assert.equal(f.tables.factures.every(invoice => invoice.valide), true);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === C).length, 1);
      assert.equal(f.tables.lignes.find(line => line.facture_id === C).description, 'Organisateur relu par le collègue');
      assert.equal(saves(f).length, 1);
      assert.equal(saves(f)[0].input.p_facture_id, B);
    });

    await scenario('unsaved-draft-survives-return-to-list-and-reopening', {}, async f => {
      await open(f);
      await description(f).fill('Correction temporaire pendant un changement de dossier');
      await category(f).selectOption('cat-test');
      await f.page.getByRole('button', { name: 'Retour à la liste de travail', exact: true }).click();
      await f.page.getByRole('link', { name: '2 factures reçues · À vérifier — EXP-TEST-001', exact: true }).filter({ visible: true }).click();
      await description(f).waitFor();
      assert.equal(await description(f).inputValue(), 'Correction temporaire pendant un changement de dossier');
      assert.equal(await category(f).inputValue(), 'cat-test');
      assert.equal(saves(f).length, 0);
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, false);
    });

    await scenario('network-error-keeps-draft-visible-and-retry-imports-once', { category: 'cat-test' }, async f => {
      await open(f);
      await description(f).fill('Scelleuse corrigée avant erreur réseau');
      f.control.failSave = true;
      await validate(f).click();
      const alert = review(f).getByRole('alert').filter({ hasText: 'Enregistrement indisponible' });
      await visibleAndReachable(alert);
      assert.equal(await description(f).inputValue(), 'Scelleuse corrigée avant erreur réseau');
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, false);
      assert.equal(f.tables.lignes.length, 1);
      await validate(f).click();
      await confirmed(f);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === B).length, 1);
      assert.equal(saves(f).length, 2);
    });

    await scenario('lost-response-reload-recovers-committed-validation-without-double-import', { category: 'cat-test' }, async f => {
      await open(f);
      f.control.loseResponse = true;
      await validate(f).click();
      await review(f).getByRole('alert').waitFor();
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, true);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === B).length, 1);
      await f.page.reload();
      await review(f).waitFor();
      await review(f).getByRole('button', { name: 'Modifier la vérification', exact: true }).waitFor();
      assert.equal(await validate(f).count(), 0);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === B).length, 1);
      assert.equal(saves(f).length, 1);
    });

    await scenario('colleague-change-does-not-overwrite-local-corrections', { category: 'cat-test' }, async f => {
      await open(f);
      await description(f).fill('Correction locale à conserver');
      f.records.get(B).reviewToken = 'changed-by-colleague';
      await validate(f).click();
      const alert = review(f).getByRole('alert').filter({ hasText: 'Cette facture a changé' });
      await visibleAndReachable(alert);
      assert.equal(await description(f).inputValue(), 'Correction locale à conserver');
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, false);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === B).length, 0);
      assert.equal(saves(f).length, 1);
    });

    await scenario('duplicate-requires-explicit-confirmation-and-can-be-restored', { category: 'cat-test', duplicates: true }, async f => {
      await open(f, C);
      const original = clone(f.tables.factures.find(invoice => invoice.id === B));
      const lines = clone(f.tables.lignes);
      await review(f).getByText('Document identique reçu plusieurs fois', { exact: true }).waitFor();
      await review(f).getByRole('button', { name: 'Retirer cette copie', exact: true }).click();
      const dialog = f.page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(f.calls.filter(call => call.kind === 'classify').length, 0);
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, undefined);
      await review(f).getByRole('button', { name: 'Retirer cette copie', exact: true }).click();
      await dialog.getByRole('button', { name: 'Retirer le doublon', exact: true }).click();
      await f.page.getByTestId('invoice-header-feedback').filter({ hasText: 'Facture 3 retirée' }).waitFor();
      await openRetired(f);
      await review(f).getByRole('button', { name: 'Remettre à vérifier', exact: true }).waitFor();
      assert.equal(f.tables.factures.length, 3);
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, B);
      assert.deepEqual(f.tables.factures.find(invoice => invoice.id === B), original);
      assert.deepEqual(f.tables.lignes, lines);
      assert.equal(await validate(f).count(), 0);
      await review(f).getByRole('button', { name: 'Remettre à vérifier', exact: true }).click();
      await validate(f).waitFor();
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, null);
      assert.equal(f.calls.filter(call => call.kind === 'classify').length, 1);
      assert.equal(f.calls.filter(call => call.kind === 'restore').length, 1);
    });

    await scenario('manual-duplicate-without-analysis-mobile-cancel-withdraw-restore', { noAnalysis: true }, async f => {
      await f.page.setViewportSize({ width: 390, height: 844 });
      await open(f, C);
      const originals = clone(f.tables.factures.filter(invoice => invoice.id !== C));
      const lines = clone(f.tables.lignes);
      await f.page.getByRole('button', { name: 'Retirer cette facture en double', exact: true }).click();
      await f.page.getByLabel('Facture originale à conserver', { exact: true }).selectOption(B);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const audit = await new AxeBuilder({ page: f.page }).include('#quote-documents').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(item => item.id), []);
      await f.page.getByRole('group', { name: 'Retrait d’une facture en double' }).scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, 'manual-duplicate-mobile.png') });
      await f.page.getByRole('button', { name: 'Vérifier le retrait', exact: true }).click();
      const dialog = f.page.getByRole('dialog');
      assert.match(await dialog.innerText(), /À retirer : facture 3.*autre-achat.pdf/);
      assert.match(await dialog.innerText(), /À conserver : facture 2.*scelleuse.pdf/);
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
      assert.equal(f.calls.filter(call => call.kind === 'classify').length, 0);
      const ocrBefore = f.calls.filter(call => call.kind === 'ocr').length;
      await f.page.getByRole('button', { name: 'Vérifier le retrait', exact: true }).click();
      await dialog.getByRole('button', { name: 'Retirer le doublon', exact: true }).click();
      await f.page.getByTestId('invoice-header-feedback').filter({ hasText: 'Facture 3 retirée comme doublon' }).waitFor();
      assert.ok(f.calls.filter(call => call.kind === 'ocr').slice(ocrBefore).every(call => call.input.factureId === B && call.input.action === 'resume'), 'Withdrawal must not analyze/download the copy; opening the retained original may resume its saved proposals.');
      assert.equal(await invoiceSelect(f).locator('option').filter({ hasNotText: 'Consultation de l’historique' }).count(), 2);
      await openRetired(f);
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, B);
      assert.deepEqual(f.tables.factures.filter(invoice => invoice.id !== C), originals);
      assert.deepEqual(f.tables.lignes, lines);
      assert.equal(f.tables.factures.length, 3);
      await f.page.getByRole('tab', { name: 'Articles et vérification', exact: true }).click();
      await review(f).getByRole('button', { name: 'Remettre à vérifier', exact: true }).click();
      await f.page.getByTestId('invoice-header-feedback').filter({ hasText: 'Facture remise à vérifier' }).waitFor();
      assert.equal(await invoiceSelect(f).locator('option').filter({ hasNotText: 'Consultation de l’historique' }).count(), 3);
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, null);
      assert.equal(saves(f).length, 0);
    });

    for (const failure of ['conflict', 'network', 'refresh']) await scenario(`manual-duplicate-different-files-${failure}`, {}, async f => {
      await open(f, C);
      await f.page.getByRole('button', { name: 'Retirer cette facture en double', exact: true }).click();
      await f.page.getByLabel('Facture originale à conserver', { exact: true }).selectOption(B);
      await f.page.getByRole('button', { name: 'Vérifier le retrait', exact: true }).click();
      if (failure === 'conflict') f.records.get(B).reviewToken = 'changed-by-colleague';
      if (failure === 'network') f.control.failClassify = true;
      if (failure === 'refresh') f.control.failRefresh = true;
      await f.page.getByRole('dialog').getByRole('button', { name: 'Retirer le doublon', exact: true }).click();
      const header = f.page.getByTestId('invoice-header-feedback');
      await header.filter({ hasText: failure === 'conflict' ? 'Une facture a changé' : failure === 'network' ? 'Retrait indisponible' : 'Facture 3 retirée' }).waitFor();
      if (failure === 'refresh') {
        await openRetired(f);
        await f.page.getByTestId('invoice-feedback').filter({ hasText: 'actualisation du dossier a échoué' }).waitFor();
        assert.equal(await invoiceSelect(f).locator('option').filter({ hasNotText: 'Consultation de l’historique' }).count(), 2, 'Acknowledged withdrawal remains effective despite a refresh failure');
        assert.equal(await f.page.getByRole('button', { name: 'Retirer cette facture en double', exact: true }).count(), 0);
        assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, B);
        f.control.failRefresh = false;
        await review(f).getByRole('button', { name: 'Actualiser', exact: true }).click();
        await f.page.getByTestId('invoice-feedback').filter({ hasText: 'État enregistré rechargé' }).waitFor();
      } else {
        assert.equal(await header.getAttribute('role'), 'alert');
        assert.equal(await invoiceSelect(f).locator('option').filter({ hasNotText: 'Consultation de l’historique' }).count(), 3);
        assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, undefined);
      }
      assert.equal(f.calls.filter(call => call.kind === 'classify').length, 1);
      assert.equal(saves(f).length, 0);
    });

    for (const refreshFailure of [false, true]) await scenario(`last-invoice-validation-${refreshFailure ? 'refresh-warning-keeps-commit-recoverable' : 'opens-summary-with-confirmation'}`, { category: 'cat-test' }, async f => {
      Object.assign(f.tables.factures.find(invoice => invoice.id === C), { valide: true, vendeur: 'Boutique C', montant: 28 });
      f.tables.lignes.push({ id: 'last-invoice-existing-c', colis_id: ids.P, facture_id: C, description: 'Organisateur de bureau', qte: 1, prix_unitaire: 28, categorie_id: 'cat-test' });
      const previousLines = clone(f.tables.lignes);
      await f.page.goto(`${base}/colis/${ids.P}?section=documents&returnTo=%2Fcolis`);
      await validate(f).waitFor();
      assert.equal(new URL(f.page.url()).searchParams.has('invoice'), false);
      assert.equal(await f.page.getByLabel('Facture à vérifier', { exact: true }).inputValue(), B);
      f.control.failRefresh = refreshFailure;
      await validate(f).click();
      const header = f.page.getByTestId('invoice-header-feedback');
      await header.filter({ hasText: 'facture et articles validés et enregistrés' }).waitFor();
      await f.page.getByText('Factures vérifiées', { exact: true }).waitFor();
      if (refreshFailure) {
        await header.filter({ hasText: 'actualisation du dossier a échoué' }).waitFor();
        await review(f).getByRole('button', { name: 'Actualiser', exact: true }).waitFor();
        assert.equal(await validate(f).count(), 0, 'A committed invoice must not invite validation again after refresh fails.');
        f.control.failRefresh = false;
        await review(f).getByRole('button', { name: 'Actualiser', exact: true }).click();
        await f.page.getByTestId('invoice-feedback').filter({ hasText: 'État enregistré rechargé' }).waitFor();
      } else {
        await f.page.getByRole('button', { name: 'Consulter les factures', exact: true }).waitFor();
        assert.equal(await review(f).count(), 0, 'The final review automatically collapses into the completed summary.');
        await f.page.waitForFunction(() => {
          const message = document.querySelector('[data-testid="invoice-header-feedback"]');
          if (!message) return false;
          const box = message.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight;
        });
      }
      assert.equal(f.tables.factures.every(invoice => invoice.valide), true);
      assert.deepEqual(f.tables.lignes.filter(line => line.facture_id !== B), previousLines);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === B).length, 1);
      assert.equal(saves(f).length, 1);
      assert.equal(f.tables.colis[0].quote_version, 0);
    });

    await scenario('saved-validation-survives-failed-refresh-and-offers-actualisation', { category: 'cat-test' }, async f => {
      await open(f);
      await category(f).waitFor();
      f.control.failRefresh = true;
      await validate(f).click();
      const feedback = f.page.getByTestId('invoice-feedback');
      await feedback.filter({ hasText: 'actualisation du dossier a échoué' }).waitFor();
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, true);
      assert.equal(await validate(f).count(), 0);
      assert.equal(f.tables.lignes.filter(line => line.facture_id === B).length, 1);
      f.control.failRefresh = false;
      await review(f).getByRole('button', { name: 'Actualiser', exact: true }).click();
      await feedback.filter({ hasText: 'État enregistré rechargé' }).waitFor();
      assert.equal(saves(f).length, 1);
    });

    await scenario('read-only-staff-cannot-validate-or-edit-invoice', { role: 'preparateur', permissions: { perm_factures_voir: true } }, async f => {
      await open(f);
      await review(f).waitFor();
      const action = validate(f);
      assert.equal(await f.page.getByRole('button', { name: 'Retirer cette facture en double', exact: true }).count(), 0);
      assert.ok(await action.count() === 0 || await action.isDisabled());
      const editor = description(f);
      assert.ok(await editor.count() === 0 || await editor.isDisabled() || await editor.getAttribute('readonly') !== null);
      assert.equal(saves(f).length, 0);
      assert.equal(f.calls.some(call => call.kind === 'ocr' && call.input.action === 'extract'), false);
    });

    await scenario('mobile-and-dark-mode-accessible-without-overflow', { category: 'cat-test' }, async f => {
      for (const theme of ['light', 'dark']) {
        await f.page.evaluate(theme => localStorage.setItem('expedile-theme', theme), theme);
        await f.page.reload();
        for (const mobile of [false, true]) {
          await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
          await open(f);
          assert.equal(await f.page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark', 'The requested theme must actually be applied before accessibility checks.');
          if (mobile) await f.page.getByRole('tab', { name: 'Articles et vérification', exact: true }).click();
          await category(f).waitFor();
          assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await validate(f).scrollIntoViewIfNeeded();
          await visibleAndReachable(validate(f));
          assert.ok((await validate(f).boundingBox()).height >= 44);
          const audit = await new AxeBuilder({ page: f.page }).include('#quote-documents').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
          assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
          await f.page.screenshot({ path: path.join(output, `invoice-${theme}-${mobile ? 'mobile' : 'desktop'}.png`) });
        }
      }
    });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture, B, C, EXTRACTION_B, EXTRACTION_C, output };
