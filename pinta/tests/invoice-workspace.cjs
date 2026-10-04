/* Invoice workspace regressions on fictitious data only. The shared transport
 * intercepts every provider request; these tests never contact real customers.
 * Backend atomicity/permissions are checked separately by the SQL suite. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setup, ids, base, invoiceLock, analysisReason } = require('./browser-regression.cjs');
const { invoiceList, invoiceItems, invoiceItem, currentInvoiceItem, currentInvoiceId, waitForCurrentInvoice, invoiceNames, chooseInvoice } = require('./invoice-list.helper.cjs');

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
  // withdrawal: lock.withdrawal of the review context; withdrawalReply(input): { status, body } of the D2 Edge function.
  const control = { failSave: false, loseResponse: false, failContext: false, failRefresh: false, failClassify: false, failSign: null, gate: null, withdrawal: null, withdrawalReply: null, openReply: null, legacyContext: false };
  page.on('request', request => {
    const url = new URL(request.url());
    if (/\/rest\/v1\/(factures|lignes)$/.test(url.pathname) && request.method() !== 'GET') mutations.push({ path: url.pathname, method: request.method(), input: request.postDataJSON() });
  });
  const answer = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/storage/v1/object/sign/factures/**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      calls.push({ kind: 'sign', path: url.pathname });
      if (control.failSign?.remaining > 0 && url.pathname.endsWith('/' + control.failSign.file)) { control.failSign.remaining -= 1; return answer(route, { statusCode: '503', error: 'Unavailable', message: 'Signature temporairement indisponible.' }, 503); }
      return answer(route, { signedURL: url.pathname + '?token=local-fixture' });
    }
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
    const parcel = tables.colis[0];
    const current = tables.factures.map(invoice => {
      if (!records.has(invoice.id)) records.set(invoice.id, { factureId: invoice.id, reviewToken: 'review-' + invoice.id, extraction: null, draft: null, documentHash: null, duplicateCandidateIds: [] });
      const record = clone(records.get(invoice.id));
      if (control.legacyContext) return record;
      // D1/D4 as the server answers: no analysis for a validated invoice without an open modification, nor on a frozen dossier.
      const reason = analysisReason(parcel, invoice, record.draft);
      return { ...record, extraction: ['frozen', 'validated'].includes(reason) ? null : record.extraction, analysisAllowed: reason === null, analysisBlockedReason: reason };
    });
    return answer(route, { invoices: current, unlinkedLines: tables.lignes.filter(line => !line.facture_id).map(clone), ...(control.legacyContext ? {} : { lock: invoiceLock(parcel, clone(control.withdrawal)) }) });
  });
  const validatedDraft = invoice => ({ lines: tables.lignes.filter(line => line.facture_id === invoice.id).map(line => ({ desc: line.description, qte: line.qte, prix: line.prix_unitaire, cat: line.categorie_id })), total: invoice.montant, vendeur: invoice.vendeur, extractionId: null });
  await context.route('**/rest/v1/rpc/open_invoice_modification', route => {
    const input = route.request().postDataJSON(); calls.push({ kind: 'open-modification', input });
    if (control.openReply) { const reply = control.openReply; control.openReply = null; return answer(route, reply.body, reply.status); }
    const record = records.get(input.p_facture_id), invoice = tables.factures.find(item => item.id === input.p_facture_id);
    if (!invoice?.valide) return answer(route, { code: '22023', message: 'Seule une facture validée et active peut être modifiée.' }, 400);
    if (input.p_expected_review_token !== record.reviewToken) return answer(route, { code: '40001', message: 'Cette facture a changé. Rechargez sa vérification.' }, 409);
    const created = !record.draft;
    if (created) { record.draft = validatedDraft(invoice); record.reviewToken += '-opened'; }
    return answer(route, { reviewToken: record.reviewToken, draft: clone(record.draft), created });
  });
  await context.route('**/rest/v1/rpc/close_invoice_modification', route => {
    const input = route.request().postDataJSON(); calls.push({ kind: 'close-modification', input });
    const record = records.get(input.p_facture_id);
    if (input.p_expected_review_token !== record.reviewToken) return answer(route, { code: '40001', message: 'Cette facture a changé. Rechargez sa vérification.' }, 409);
    const closed = !!record.draft; record.draft = null; record.reviewToken += '-closed';
    return answer(route, { reviewToken: record.reviewToken, closed });
  });
  // D2: PayPlug first, then the database withdraws the quote (and opens the draft for open_modification).
  await context.route('**/functions/v1/invoice-quote-withdrawal', route => {
    const input = route.request().postDataJSON(); calls.push({ kind: 'withdrawal', input });
    if (control.withdrawalReply) { const reply = control.withdrawalReply(input); if (reply) return answer(route, reply.body, reply.status); }
    const parcel = tables.colis[0];
    if (input.action === 'retry') { control.withdrawal = { ...control.withdrawal, status: 'withdrawn', withdrawnAt: '2026-10-04T09:00:00Z', linkCancelled: true, clientMessageStatus: 'sent' }; return answer(route, { ok: true, withdrawal: { id: input.withdrawalId, status: 'withdrawn', linkCancelled: true, message: { canal: 'telegram', status: 'sent' } } }); }
    if (input.expectedUpdatedAt !== parcel.updated_at) return answer(route, { ok: false, code: '40001', error: 'Le dossier a changé. Actualisez puis réessayez.' }, 409);
    const linked = !!(parcel.payplug_payment_id || parcel.payplug_payment_url);
    Object.assign(parcel, { statut: ['devis_envoye', 'attente_paiement'].includes(parcel.statut) ? 'en_preparation' : parcel.statut, devis_total: null, devis_snapshot: null, devis_brouillon: true, payplug_payment_id: null, payplug_payment_url: null, quote_version: (parcel.quote_version || 0) + 1, updated_at: new Date(Math.max(Date.now(), Date.parse(parcel.updated_at) + 1000)).toISOString() });
    const withdrawal = { id: '88888888-0000-4000-8000-000000000001', colis_id: parcel.id, source: input.action === 'import_attachment' ? 'conversation_import' : 'staff', action: input.action, status: 'withdrawn', link_cancelled: linked, reason: input.reason };
    const reply = { ok: true, changed: true, colis: clone(parcel), withdrawal, paymentLinkCancelled: linked };
    if (input.action === 'open_modification') {
      const record = records.get(input.factureId), invoice = tables.factures.find(item => item.id === input.factureId);
      if (input.expectedReviewToken !== record.reviewToken) return answer(route, { ok: false, code: '40001', error: 'Cette facture a changé.' }, 409);
      if (!record.draft) { record.draft = validatedDraft(invoice); record.reviewToken += '-opened'; }
      reply.reviewToken = record.reviewToken;
    }
    if (input.action === 'import_attachment') {
      // Atomic with the withdrawal: the invoice is imported and the D3 message delivered after the commit.
      const message = tables.messages.find(item => item.id === input.messageId);
      let invoice = tables.factures.find(item => item.fichier_url === message.attachment_path);
      if (!invoice) { invoice = { id: '98888888-0000-4000-8000-000000000001', colis_id: parcel.id, vendeur: 'Document à vérifier', montant: 0, valide: false, fichier_url: message.attachment_path, fichier_nom: message.attachment_name }; tables.factures.push(invoice); }
      Object.assign(reply, { facture: clone(invoice), message: { canal: 'telegram', status: 'sent' } });
    }
    return answer(route, reply);
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
const validate = f => review(f).getByRole('button', { name: /^(Valider et passer à la suivante|Terminer la vérification)$/ });
const saveDraft = f => review(f).getByRole('button', { name: 'Enregistrer le brouillon', exact: true });
const saves = f => f.calls.filter(call => call.kind === 'save');
const category = f => review(f).getByLabel('Catégorie de l’article 1', { exact: true });
const description = f => review(f).getByLabel('Description de l’article 1', { exact: true });
const total = f => review(f).getByLabel('Total HT de la facture', { exact: true });
const confirmed = f => f.page.getByTestId('invoice-header-feedback').filter({ hasText: 'facture et articles validés et enregistrés' }).waitFor();

const panel = f => f.page.getByRole('region', { name: 'Factures d’achat', exact: true });
const shownInvoice = f => f.page.getByRole('group', { name: 'Facture affichée', exact: true });
// The bold progress line of the header: « {verified} sur {N} … » or « {N} factures · toutes vérifiées ».
const progressLine = f => panel(f).locator('p').filter({ hasText: /^(\d+ sur \d+ factures? vérifiées?|\d+ factures? · (toutes )?vérifiées?|Aucune facture (reçue|enregistrée))/ });
const READ_ONLY = 'Paiement enregistré : factures, articles et analyses sont figés. Ils restent consultables.'; // FROZEN_TEXT.payment (D4)
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
async function noAxeViolations(f, selector = '#quote-documents') {
  const audit = await new AxeBuilder({ page: f.page }).include(selector).withTags(AXE_TAGS).analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
}
const noOverflow = async (f, label) => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No horizontal overflow (${label}).`);
async function setTheme(f, theme) {
  await f.page.evaluate(theme => localStorage.setItem('expedile-theme', theme), theme);
  await f.page.reload();
}
async function minTarget(locator, label) {
  for (const box of await locator.evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height }; })))
    assert.ok(box.height >= 44 && box.width >= 44, `${label} keeps a 44px target (${box.width}x${box.height}).`);
}

async function open(f, invoice = B) {
  await f.page.goto(`${base}/colis/${ids.P}?invoice=${invoice}&returnTo=%2Fcolis#quote-documents`);
  await f.page.getByRole('region', { name: 'Vérification de la facture', exact: true, includeHidden: true }).waitFor({ state: 'attached' });
  await invoiceList(f.page).waitFor({ state: 'attached' });
  // The region/list render before the async review context and its draft.
  // Attached (rather than visible) also covers the mobile Document tab.
  await f.page.getByTestId('invoice-action-bar').waitFor({ state: 'attached' });
}

async function openRetired(f, label = 'Copie de la facture 2 — autre-achat.pdf') {
  const history = f.page.locator('details').filter({ has: f.page.locator('summary').filter({ hasText: /^Doublons retirés/ }) });
  await history.waitFor();
  // The successful command finishes its refresh (including retries) before
  // switching to the original and re-enabling navigation.
  await history.locator('button:enabled').first().waitFor({ state: 'attached' });
  if (!await history.evaluate(element => element.open)) await history.locator('summary').click();
  await history.getByRole('button', { name: label, exact: true }).click();
}

// After an in-place action, keyboard focus must not fall back to <body>.
async function focusKept(f, label) {
  await f.page.waitForFunction(() => document.activeElement && document.activeElement !== document.body, null, { timeout: 5000 })
    .catch(() => assert.fail(`Focus fell to <body> after ${label}.`));
  return f.page.evaluate(() => (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').trim());
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
      await invoiceItem(f.page, ids.F).waitFor({ state: 'attached' });
      assert.equal(await invoiceItems(f.page).count(), 3);
      assert.ok((await f.page.getByTestId('documents-task').boundingBox()).width >= 900, 'Desktop review uses the available width for the source document and its articles.');
      await waitForCurrentInvoice(f.page, B);
      assert.equal(await currentInvoiceItem(f.page).count(), 1, 'Exactly one invoice is marked as displayed.');
      await validate(f).waitFor();
      assert.equal(await validate(f).count(), 1);
      assert.equal(await f.page.getByRole('button', { name: /^(Valider la facture|Confirmer les articles vérifiés)$/ }).count(), 0);
      assert.match(await invoiceItem(f.page, ids.F).getAttribute('aria-label'), /^Facture 1 sur 3 · Boutique A · Vérifiée$/);
      assert.doesNotMatch(await invoiceItem(f.page, ids.F).innerText(), /à vérifier/i, 'A verified invoice is never labelled « à vérifier ».');
      const canvas = f.page.getByRole('region', { name: 'Document source', exact: true }).locator('canvas[data-rendered="true"]');
      await canvas.waitFor();
      const firstDocument = await canvas.evaluate(element => element.toDataURL());
      await chooseInvoice(f.page, C);
      await waitForCurrentInvoice(f.page, C);
      await category(f).waitFor();
      assert.equal(await description(f).inputValue(), 'Organisateur de bureau');
      await canvas.waitFor();
      await f.page.waitForFunction(previous => {
        const source = document.querySelector('[aria-label="Document source"] canvas[data-rendered="true"]');
        return source && source.toDataURL() !== previous;
      }, firstDocument);
      assert.notEqual(await canvas.evaluate(element => element.toDataURL()), firstDocument, 'Selecting another invoice must render a different source PDF, not only change editable fields.');
      // One numbering: the list, the displayed-invoice bar and the footer
      // reminder near the validate button all name the same « n sur N ».
      const actions = f.page.getByTestId('invoice-action-bar');
      const shown = f.page.getByRole('group', { name: 'Facture affichée', exact: true });
      assert.match(await currentInvoiceItem(f.page).getAttribute('aria-label'), /^Facture 3 sur 3 · Boutique C · À vérifier$/);
      assert.match(await shown.innerText(), /Facture 3 sur 3 · Boutique C/);
      assert.match(await actions.innerText(), /Vous validez : Facture 3 sur 3 · Boutique C/);
      assert.equal(await f.page.getByRole('button', { name: /^Vérifier la facture (précédente|suivante)$/ }).count(), 0, 'The displayed-invoice bar is the single invoice navigator.');
      assert.equal(await shown.getByRole('button', { name: 'Facture suivante', exact: true }).getAttribute('aria-disabled'), 'true', 'The last invoice has no next one.');
      // The end-of-list button stays focusable (aria-disabled), so pressing it again does nothing and keeps focus.
      await shown.getByRole('button', { name: 'Facture suivante', exact: true }).focus();
      await f.page.keyboard.press('Enter');
      await waitForCurrentInvoice(f.page, C);
      assert.equal(await shown.getByRole('button', { name: 'Facture suivante', exact: true }).evaluate(element => element === document.activeElement), true);
      await shown.getByRole('button', { name: 'Facture précédente', exact: true }).click();
      await waitForCurrentInvoice(f.page, B);
      assert.equal(await description(f).inputValue(), 'Scelleuse thermique');
      assert.match(await shown.innerText(), /Facture 2 sur 3 · Boutique B/);
      assert.match(await actions.innerText(), /Vous validez : Facture 2 sur 3 · Boutique B/);
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
      await chooseInvoice(f.page, C);
      await waitForCurrentInvoice(f.page, C);
      await description(f).fill('Organisateur relu par Camille');
      await chooseInvoice(f.page, B);
      await waitForCurrentInvoice(f.page, B);
      assert.equal(await description(f).inputValue(), 'Scelleuse relue par Camille');
      await f.page.setViewportSize({ width: 390, height: 844 });
      await f.page.getByRole('tab', { name: 'Voir la facture', exact: true }).click();
      await f.page.getByRole('tab', { name: 'Vérifier les articles', exact: true }).click();
      assert.equal(await description(f).inputValue(), 'Scelleuse relue par Camille');
      await saveDraft(f).click();
      await f.page.getByTestId('invoice-feedback').filter({ hasText: 'Brouillon enregistré pour scelleuse.pdf.' }).waitFor();
      // One live region per message: the header announces it, the reminder near the buttons stays silent.
      assert.equal(await f.page.getByTestId('invoice-header-feedback').filter({ hasText: 'Brouillon enregistré pour scelleuse.pdf.' }).getAttribute('role'), 'status');
      assert.equal(await f.page.getByTestId('invoice-feedback').getAttribute('role'), null);
      assert.equal(await f.page.locator('[role="status"], [role="alert"]').filter({ hasText: 'Brouillon enregistré pour scelleuse.pdf.' }).count(), 1, 'The draft acknowledgement is announced once.');
      assert.equal(await focusKept(f, 'the draft save'), 'Enregistrer le brouillon', 'Focus returns to the draft button once it is enabled again.');
      assert.equal(f.tables.factures.find(invoice => invoice.id === B).valide, false);
      assert.equal(f.tables.lignes.length, 1);
      assert.equal(saves(f)[0].input.p_confirm, false);
      await f.page.reload();
      await f.page.getByRole('tab', { name: 'Vérifier les articles', exact: true }).click();
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
      await waitForCurrentInvoice(f.page, C);
      assert.equal(await currentInvoiceId(f.page), C);
    });

    await scenario('mobile-next-pending-invoice-keeps-articles-tab-from-document-url', { category: 'cat-test' }, async f => {
      await f.page.setViewportSize({ width: 390, height: 844 });
      await open(f, B);
      assert.equal(new URL(f.page.url()).searchParams.get('invoice'), B);
      await f.page.getByRole('tab', { name: 'Vérifier les articles', exact: true }).click();
      await validate(f).click(); await confirmed(f);
      await waitForCurrentInvoice(f.page, C);
      await description(f).waitFor();
      assert.equal(await currentInvoiceId(f.page), C);
      await f.page.waitForFunction(() => { const bar = document.querySelector('[role="group"][aria-label="Facture affichée"]'); const box = bar?.getBoundingClientRect(); return box && box.top >= 0 && box.bottom <= innerHeight; }, null, { timeout: 5000 })
        .catch(() => assert.fail('After auto-advance on a phone, the « Facture n sur N » bar must be on screen.'));
      assert.match(await shownInvoice(f).innerText(), /Facture 3 sur 3/);
      assert.equal(await f.page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Vérification de la facture');
      assert.equal(await f.page.getByRole('tab', { name: 'Vérifier les articles', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await f.page.getByRole('tab', { name: 'Voir la facture', exact: true }).getAttribute('aria-selected'), 'false');
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
      // The route restores the list after unmounting the document workspace.
      // Wait for its visible table before locating the responsive invoice link.
      await f.page.getByRole('region', { name: 'Tableau des dossiers', exact: true }).waitFor();
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
      assert.match(await focusKept(f, 'a failed validation'), /^(Valider et passer à la suivante|Terminer la vérification)$/);
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
      await f.page.getByTestId('invoice-header-feedback').filter({ hasText: 'Copie retirée : autre-achat.pdf devient « Copie de la facture 2 ». La facture 2 est conservée (' }).waitFor();
      assert.equal(await invoiceItems(f.page).count(), 2, 'The removed copy leaves the counted list.');
      assert.equal(await invoiceItem(f.page, C).count(), 0);
      assert.match(await focusKept(f, 'the duplicate removal'), /^Facture 2 sur 2/, 'Focus lands on the invoice now displayed (the original).');
      await openRetired(f);
      assert.match(await f.page.getByRole('group', { name: 'Facture affichée', exact: true }).innerText(), /Copie de la facture 2/);
      assert.equal(await f.page.locator('[role="status"], [role="alert"]').filter({ hasText: 'Copie retirée : autre-achat.pdf' }).count(), 1, 'The removal is announced once, also on the retired copy.');
      await review(f).getByRole('button', { name: 'Remettre à vérifier', exact: true }).waitFor();
      assert.equal(f.tables.factures.length, 3);
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, B);
      assert.deepEqual(f.tables.factures.find(invoice => invoice.id === B), original);
      assert.deepEqual(f.tables.lignes, lines);
      assert.equal(await validate(f).count(), 0);
      await review(f).getByRole('button', { name: 'Remettre à vérifier', exact: true }).click();
      await validate(f).waitFor();
      assert.match(await focusKept(f, 'the restoration'), /^Facture \d sur 3/);
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, null);
      assert.equal(f.calls.filter(call => call.kind === 'classify').length, 1);
      assert.equal(f.calls.filter(call => call.kind === 'restore').length, 1);
    });

    await scenario('manual-duplicate-without-analysis-mobile-cancel-withdraw-restore', { noAnalysis: true }, async f => {
      await f.page.setViewportSize({ width: 390, height: 844 });
      await open(f, C);
      const originals = clone(f.tables.factures.filter(invoice => invoice.id !== C));
      const lines = clone(f.tables.lignes);
      await f.page.locator('summary').filter({ hasText: 'Autres actions sur cette facture' }).click(); await f.page.getByRole('button', { name: 'Retirer cette facture en double', exact: true }).click();
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
      await f.page.getByTestId('invoice-header-feedback').filter({ hasText: 'Copie retirée : autre-achat.pdf devient « Copie de la facture 2 ». La facture 2 est conservée (' }).waitFor();
      assert.ok(f.calls.filter(call => call.kind === 'ocr').slice(ocrBefore).every(call => call.input.factureId === B && call.input.action === 'resume'), 'Withdrawal must not analyze/download the copy; opening the retained original may resume its saved proposals.');
      assert.equal(await invoiceItems(f.page).count(), 2);
      assert.equal(await invoiceItem(f.page, C).count(), 0, 'A removed copy is listed only in history.');
      await openRetired(f);
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, B);
      assert.deepEqual(f.tables.factures.filter(invoice => invoice.id !== C), originals);
      assert.deepEqual(f.tables.lignes, lines);
      assert.equal(f.tables.factures.length, 3);
      await f.page.getByRole('tab', { name: 'Vérifier les articles', exact: true }).click();
      await review(f).getByRole('button', { name: 'Remettre à vérifier', exact: true }).click();
      await f.page.getByTestId('invoice-header-feedback').filter({ hasText: 'Facture remise à vérifier' }).waitFor();
      await invoiceItem(f.page, C).waitFor();
      assert.equal(await invoiceItems(f.page).count(), 3);
      assert.deepEqual((await invoiceNames(f.page)).map(name => name.split(' · ')[0]), ['Facture 1 sur 3', 'Facture 2 sur 3', 'Facture 3 sur 3'], 'A restored copy takes back its place without gaps in the numbering.');
      assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, null);
      assert.equal(saves(f).length, 0);
    });

    for (const failure of ['conflict', 'network', 'refresh']) await scenario(`manual-duplicate-different-files-${failure}`, {}, async f => {
      await open(f, C);
      await f.page.locator('summary').filter({ hasText: 'Autres actions sur cette facture' }).click(); await f.page.getByRole('button', { name: 'Retirer cette facture en double', exact: true }).click();
      await f.page.getByLabel('Facture originale à conserver', { exact: true }).selectOption(B);
      await f.page.getByRole('button', { name: 'Vérifier le retrait', exact: true }).click();
      if (failure === 'conflict') f.records.get(B).reviewToken = 'changed-by-colleague';
      if (failure === 'network') f.control.failClassify = true;
      if (failure === 'refresh') f.control.failRefresh = true;
      await f.page.getByRole('dialog').getByRole('button', { name: 'Retirer le doublon', exact: true }).click();
      const header = f.page.getByTestId('invoice-header-feedback');
      await header.filter({ hasText: failure === 'conflict' ? 'Une facture a changé' : failure === 'network' ? 'Retrait indisponible' : 'Copie retirée : autre-achat.pdf devient « Copie de la facture 2 »' }).waitFor();
      if (failure === 'refresh') {
        await openRetired(f);
        await f.page.getByTestId('invoice-feedback').filter({ hasText: 'actualisation du dossier a échoué' }).waitFor();
        assert.equal(await invoiceItems(f.page).count(), 2, 'Acknowledged withdrawal remains effective despite a refresh failure');
        assert.equal(await invoiceItem(f.page, C).count(), 0);
        assert.equal(await f.page.getByRole('button', { name: 'Retirer cette facture en double', exact: true }).count(), 0);
        assert.equal(f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id, B);
        f.control.failRefresh = false;
        await review(f).getByRole('button', { name: 'Actualiser', exact: true }).click();
        await f.page.getByTestId('invoice-feedback').filter({ hasText: 'État enregistré rechargé' }).waitFor();
      } else {
        assert.equal(await header.getAttribute('role'), 'alert');
        assert.equal(await invoiceItems(f.page).count(), 3);
        await invoiceItem(f.page, C).waitFor();
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
      await waitForCurrentInvoice(f.page, B);
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
        await f.page.waitForFunction(() => document.activeElement?.textContent === 'Factures vérifiées', null, { timeout: 3000 });
        assert.notEqual(await f.page.evaluate(() => document.activeElement?.tagName), 'BODY', 'Keyboard focus moves to the completed summary, not to <body>.');
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
      // A view-only role is told what remains, never invited to verify.
      assert.equal(await panel(f).getByRole('button', { name: /^Vérifier la facture/ }).count(), 0);
      await chooseInvoice(f.page, ids.F);
      await waitForCurrentInvoice(f.page, ids.F);
      await panel(f).getByText('Facture 2 en attente de vérification', { exact: true }).waitFor();
      assert.equal(await panel(f).getByRole('button', { name: /^Vérifier la facture/ }).count(), 0);
      assert.equal(await panel(f).getByRole('button', { name: 'Facture suivante à vérifier', exact: true }).count(), 0);
      await panel(f).getByRole('button', { name: 'Consulter la facture 2', exact: true }).click();
      await waitForCurrentInvoice(f.page, B);
      const action = validate(f);
      assert.equal(await f.page.getByRole('button', { name: 'Retirer cette facture en double', exact: true }).count(), 0);
      assert.ok(await action.count() === 0 || await action.isDisabled());
      const editor = description(f);
      assert.ok(await editor.count() === 0 || await editor.isDisabled() || await editor.getAttribute('readonly') !== null);
      assert.equal(saves(f).length, 0);
      assert.equal(f.calls.some(call => call.kind === 'ocr' && call.input.action === 'extract'), false);
      // Received documents left to sort: a role that cannot add invoices is
      // told who can, never invited to sort them itself.
      for (const id of [B, C]) Object.assign(f.tables.factures.find(invoice => invoice.id === id), { valide: true, vendeur: 'Boutique vérifiée', montant: 10 });
      f.tables.messages = [{ id: 'pending-attachment', colis_id: ids.P, type: 'client', auteur_nom: 'Client exemple', texte: 'Une autre pièce', canal: 'telegram', lu: true, attachment_path: ids.P + '/piece-a-trier.pdf', attachment_name: 'piece-a-trier.pdf', attachment_type: 'application/pdf', created_at: '2026-09-10T08:00:00Z' }];
      await f.page.goto(`${base}/colis/${ids.P}?section=documents&returnTo=%2Fcolis`);
      await panel(f).getByText('Documents reçus en attente de tri', { exact: true }).waitFor();
      assert.equal(await panel(f).getByText(/^Prochaine étape/).count(), 0, 'No invitation to sort documents without the permission to add invoices.');
      assert.match(await progressLine(f).innerText(), /^3 sur 3 factures vérifiées · 1 document reçu à trier$/);
    });

    await scenario('arrival-numbering-is-stable-after-reload-whatever-the-uuid-order', { category: 'cat-test' }, async f => {
      // UUID order is F < B < C; arrival order is C, F, B (mixed offsets on purpose).
      Object.assign(f.tables.factures.find(invoice => invoice.id === C), { created_at: '2026-09-10T08:00:00Z' });
      Object.assign(f.tables.factures.find(invoice => invoice.id === ids.F), { created_at: '2026-09-11T10:00:00+02:00' });
      Object.assign(f.tables.factures.find(invoice => invoice.id === B), { created_at: '2026-09-12T08:00:00+00:00' });
      const expected = ['Facture 1 sur 3 · Boutique C · À vérifier', 'Facture 2 sur 3 · Boutique A · Vérifiée', 'Facture 3 sur 3 · Boutique B · À vérifier'];
      const checkNumbering = async () => {
        assert.deepEqual(await invoiceNames(f.page), expected, 'Invoices are numbered by arrival, not by identifier.');
        await waitForCurrentInvoice(f.page, B);
        assert.match(await shownInvoice(f).innerText(), /Facture 3 sur 3 · Boutique B/);
        await f.page.getByTestId('invoice-action-bar').filter({ hasText: 'Vous validez : Facture 3 sur 3 · Boutique B' }).waitFor();
        assert.match(await invoiceItem(f.page, C).innerText(), /Reçue le 10 sept\./);
        assert.equal(await progressLine(f).innerText(), '1 sur 3 factures vérifiées · 2 à vérifier');
        assert.match(await panel(f).innerText(), /Total vérifié 100[,.]00\s?€ HT/);
        await panel(f).getByText('Prochaine étape : vérifier la facture 1', { exact: true }).waitFor();
      };
      await open(f, B);
      await checkNumbering();
      // The server may answer in any order: reversing the rows changes nothing.
      f.tables.factures.reverse();
      await f.page.reload();
      await invoiceList(f.page).waitFor();
      await checkNumbering();
      // The next-step button opens the first invoice still to verify.
      await panel(f).getByRole('button', { name: 'Vérifier la facture 1', exact: true }).click();
      await waitForCurrentInvoice(f.page, C);
      assert.match(await shownInvoice(f).innerText(), /Facture 1 sur 3 · Boutique C/);
      assert.equal(await panel(f).getByRole('button', { name: 'Vérifier la facture 1', exact: true }).count(), 0, 'No call to verify invoice 1 above invoice 1 itself.');
      assert.equal(await panel(f).getByText(/^Prochaine étape/).count(), 0);
      await f.page.getByTestId('invoice-action-bar').filter({ hasText: 'Vous validez : Facture 1 sur 3 · Boutique C' }).waitFor();
      assert.ok(f.calls.some(call => call.kind === 'ocr' && call.input.action === 'resume'), 'Control: an editable dossier does resume saved proposals, so the read-only check below is meaningful.');
      assert.equal(saves(f).length, 0);
    });

    await scenario('progress-line-counts-invoices-waiting-for-a-client-correction', { category: 'cat-test' }, async f => {
      Object.assign(f.tables.factures.find(invoice => invoice.id === C), { rejet_motif: 'Montant illisible sur la photo.' });
      await open(f, B);
      assert.equal(await progressLine(f).innerText(), '1 sur 3 factures vérifiées · 1 à vérifier · 1 à corriger par le client');
      assert.match(await invoiceItem(f.page, C).getAttribute('aria-label'), /^Facture 3 sur 3 · .+ · À corriger par le client$/);
      const rejectedRow = await invoiceItem(f.page, C).innerText();
      assert.doesNotMatch(rejectedRow, /Propositions prêtes|proposé$/m, 'A row waiting on the client never says proposals are ready.');
      assert.match(rejectedRow, /Correction demandée : Montant illisible sur la photo\./);
      assert.match(await invoiceItem(f.page, B).innerText(), /Propositions prêtes/, 'Control: an invoice to verify still shows its proposals.');
      // Invoice 2 is the next one and already on screen: no second primary button for it.
      assert.match(await shownInvoice(f).innerText(), /Facture 2 sur 3/);
      assert.equal(await panel(f).getByText(/^Prochaine étape/).count(), 0);
      assert.equal(await panel(f).getByRole('button', { name: 'Vérifier la facture 2', exact: true }).count(), 0);
      // From another invoice, the next step names invoice 2 (the rejected one is not « to verify »).
      await chooseInvoice(f.page, ids.F);
      await waitForCurrentInvoice(f.page, ids.F);
      await panel(f).getByText('Prochaine étape : vérifier la facture 2', { exact: true }).waitFor();
      await panel(f).getByRole('button', { name: 'Vérifier la facture 2', exact: true }).waitFor();
      Object.assign(f.tables.factures.find(invoice => invoice.id === B), { valide: true, vendeur: 'Boutique B', montant: 16.64 });
      f.tables.lignes.push({ id: 'rejected-flow-b', colis_id: ids.P, facture_id: B, description: 'Scelleuse thermique', qte: 1, prix_unitaire: 16.64, categorie_id: 'cat-test' });
      await f.page.goto(`${base}/colis/${ids.P}?section=documents&returnTo=%2Fcolis`);
      await invoiceList(f.page).waitFor();
      assert.equal(await progressLine(f).innerText(), '2 sur 3 factures vérifiées · 1 à corriger par le client');
      // The dossier overview above the workspace gives the same count, in the same words.
      assert.match(await f.page.locator('[data-overview="invoices"]').innerText(), /2 sur 3 factures vérifiées · 1 à corriger par le client/);
      assert.match(await panel(f).innerText(), /Total vérifié 116[,.]64\s?€ HT/, 'The verified total excludes the invoice awaiting a correction.');
      await panel(f).getByText('En attente de la correction du client (facture 3)', { exact: true }).waitFor();
      assert.equal(await panel(f).getByRole('button', { name: 'Vérifier la facture 3', exact: true }).count(), 0, 'Nothing to verify while the client corrects the document.');
      assert.equal(await panel(f).getByText('Factures vérifiées', { exact: true }).count(), 0, 'A rejected invoice keeps the step open.');
      assert.equal(saves(f).length, 0);
    });

    await scenario('paid-dossier-is-read-only-consultation-without-ocr-calls', { category: 'cat-test', duplicates: true }, async f => {
      // The user's case: two verified invoices and one removed copy on a paid dossier.
      Object.assign(f.tables.colis[0], { statut: 'paye', paiement_date: '2026-09-20T10:00:00Z' });
      Object.assign(f.tables.factures.find(invoice => invoice.id === B), { valide: true, vendeur: 'Boutique B', montant: 16.64 });
      Object.assign(f.tables.factures.find(invoice => invoice.id === C), { duplicate_of_facture_id: B });
      f.tables.lignes.push({ id: 'paid-b', colis_id: ids.P, facture_id: B, description: 'Scelleuse thermique', qte: 1, prix_unitaire: 16.64, categorie_id: 'cat-test' });
      const ocr = () => f.calls.filter(call => call.kind === 'ocr');
      await f.page.goto(`${base}/colis/${ids.P}?section=documents&returnTo=%2Fcolis`);
      await invoiceList(f.page).waitFor();
      await panel(f).getByRole('heading', { name: 'Factures du dossier', exact: true }).waitFor();
      assert.equal(await panel(f).getByRole('heading', { name: 'Vérifier les factures', exact: true }).count(), 0);
      assert.equal(await panel(f).getByText(READ_ONLY, { exact: true }).count(), 1, 'One read-only banner, at the top.');
      assert.equal(await progressLine(f).innerText(), '2 factures · toutes vérifiées');
      assert.match(await panel(f).innerText(), /1 doublon retiré/);
      await panel(f).getByText('Factures vérifiées', { exact: true }).waitFor();
      assert.match(await panel(f).getByText('Factures vérifiées', { exact: true }).locator('..').innerText(), /2 factures vérifiées · 116[,.]64/);
      assert.equal(await panel(f).getByRole('button', { name: 'Passer au devis', exact: true }).count(), 0, 'No quote invitation on a paid dossier.');
      assert.equal(await panel(f).getByText(/Le devis peut être préparé/).count(), 0);
      assert.deepEqual(await invoiceNames(f.page), ['Facture 1 sur 2 · Boutique A · Vérifiée', 'Facture 2 sur 2 · Boutique B · Vérifiée']);
      assert.doesNotMatch(await invoiceList(f.page).innerText(), /à vérifier/i);
      assert.equal(await panel(f).getByRole('button', { name: /^Vérifier la facture/ }).count(), 0);
      // Opening each invoice is pure consultation: no proposal is read again.
      await chooseInvoice(f.page, B);
      await waitForCurrentInvoice(f.page, B);
      await f.page.getByRole('region', { name: 'Document source', exact: true }).locator('canvas[data-rendered="true"]').waitFor();
      assert.match(await shownInvoice(f).innerText(), /Facture 2 sur 2 · Boutique B/);
      await shownInvoice(f).getByRole('button', { name: 'Facture précédente', exact: true }).click();
      await waitForCurrentInvoice(f.page, ids.F);
      await f.page.goto(`${base}/colis/${ids.P}?invoice=${B}&returnTo=%2Fcolis#quote-documents`);
      await waitForCurrentInvoice(f.page, B);
      await review(f).waitFor();
      const history = panel(f).locator('details').filter({ has: f.page.locator('summary').filter({ hasText: /^Doublons retirés \(1\)/ }) });
      if (!await history.evaluate(element => element.open)) await history.locator('summary').click();
      assert.match(await history.innerText(), /Ouvrez une copie pour la consulter\./);
      assert.doesNotMatch(await history.innerText(), /remettre à vérifier/);
      await history.getByRole('button', { name: 'Copie de la facture 2 — autre-achat.pdf', exact: true }).click();
      await shownInvoice(f).filter({ hasText: 'Copie de la facture 2' }).waitFor();
      assert.equal(await currentInvoiceItem(f.page).count(), 0, 'A copy is never marked as one of the counted invoices.');
      await f.page.waitForTimeout(300); // let any (forbidden) background resume request surface
      assert.deepEqual(ocr(), [], 'A paid dossier never calls ocr-facture when invoices are opened.');
      assert.equal(await panel(f).getByText(/propositions n’ont pas pu être reprises/).count(), 0);
      assert.equal(await validate(f).count(), 0);
      for (const theme of ['light', 'dark']) {
        await setTheme(f, theme);
        for (const size of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
          await f.page.setViewportSize(size);
          await invoiceList(f.page).waitFor();
          assert.equal(await f.page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark');
          await noOverflow(f, `${theme} ${size.width}`);
          await noAxeViolations(f);
        }
      }
      await f.page.setViewportSize({ width: 320, height: 700 });
      await noOverflow(f, 'read-only 320');
      // Read-only on a phone: the article tab offers consultation, not verification.
      await f.page.setViewportSize({ width: 390, height: 844 });
      await f.page.getByRole('tab', { name: 'Voir les articles', exact: true }).waitFor();
      assert.equal(await f.page.getByRole('tab', { name: 'Vérifier les articles', exact: true }).count(), 0);
      // The history keeps a visible disclosure marker and shows which copy is open.
      const historyAgain = panel(f).locator('details').filter({ has: f.page.locator('summary').filter({ hasText: /^Doublons retirés \(1\)/ }) });
      assert.equal(await historyAgain.locator('summary svg.iw-chevron').count(), 1);
      if (!await historyAgain.evaluate(element => element.open)) await historyAgain.locator('summary').click();
      const openCopy = historyAgain.getByRole('button', { name: 'Copie de la facture 2 — autre-achat.pdf', exact: true });
      assert.equal(await openCopy.getAttribute('aria-current'), 'true');
      assert.notEqual(await openCopy.evaluate(element => getComputedStyle(element).boxShadow), 'none', 'The open copy is visibly selected.');
      assert.deepEqual(ocr(), []);
    });

    await scenario('paid-dossier-with-an-unverified-invoice-offers-no-verification', { category: 'cat-test' }, async f => {
      Object.assign(f.tables.colis[0], { statut: 'paye', paiement_date: '2026-09-20T10:00:00Z' });
      Object.assign(f.tables.factures.find(invoice => invoice.id === B), { valide: true, vendeur: 'Boutique B', montant: 16.64 });
      f.tables.lignes.push({ id: 'paid-b-2', colis_id: ids.P, facture_id: B, description: 'Scelleuse thermique', qte: 1, prix_unitaire: 16.64, categorie_id: 'cat-test' });
      await f.page.goto(`${base}/colis/${ids.P}?invoice=${B}&returnTo=%2Fcolis#quote-documents`);
      await waitForCurrentInvoice(f.page, B);
      await review(f).waitFor();
      await f.page.getByTestId('invoice-action-bar').waitFor();
      assert.equal(await panel(f).getByRole('button', { name: 'Facture suivante à vérifier', exact: true }).count(), 0, 'No invitation to verify on a paid dossier.');
      assert.equal(await panel(f).getByRole('button', { name: /^Vérifier la facture/ }).count(), 0);
      assert.equal(await panel(f).getByText(/^Prochaine étape/).count(), 0);
      assert.equal(await validate(f).count(), 0);
      assert.equal(f.calls.filter(call => call.kind === 'ocr').length, 0);
    });

    await scenario('displayed-invoice-bar-never-hides-its-state-behind-the-buttons', { category: 'cat-test' }, async f => {
      const box = locator => locator.evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      for (const [width, supplier] of [[1024, null], [1280, null], [1440, 'ShenZhen BaiDian ZhiShiChanQuan Technology Co Ltd'], [1024, 'ShenZhen BaiDian ZhiShiChanQuan Technology Co Ltd']]) {
        if (supplier) f.tables.factures.find(invoice => invoice.id === B).vendeur = supplier;
        await f.page.setViewportSize({ width, height: 900 });
        await open(f, B);
        await waitForCurrentInvoice(f.page, B);
        const pill = shownInvoice(f).locator('.iw-pill');
        const nav = shownInvoice(f).locator('.iw-nav');
        assert.ok(apart(await box(pill), await box(nav)), `${width}${supplier ? ' long supplier' : ''}: the state pill and the buttons do not overlap.`);
        assert.equal(await pill.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `${width}: the state pill is not cut.`);
        assert.match(await shownInvoice(f).innerText(), /16[,.]64/, `${width}: the amount stays readable in the bar.`);
      }
    });

    await scenario('tabs-hidden-beside-both-panes-and-working-on-mobile', { category: 'cat-test' }, async f => {
      const documentPane = () => f.page.getByRole('region', { name: 'Document source', exact: true });
      const showDocument = () => f.page.getByRole('tab', { name: 'Voir la facture', exact: true });
      const showArticles = () => f.page.getByRole('tab', { name: 'Vérifier les articles', exact: true });
      await f.page.setViewportSize({ width: 1440, height: 1000 });
      await open(f, B);
      await category(f).waitFor();
      assert.ok((await panel(f).boundingBox()).width >= 850, 'Wide layout: the invoice container reaches the two-pane breakpoint.');
      assert.equal(await showDocument().isVisible(), false, 'Wide layout: no inert tab above two visible panes.');
      assert.equal(await showArticles().isVisible(), false);
      await documentPane().locator('canvas[data-rendered="true"]').waitFor();
      const [doc, articles] = [await documentPane().boundingBox(), await review(f).boundingBox()];
      assert.ok(doc.x + doc.width <= articles.x + 1, 'Document and articles sit side by side.');
      await f.page.setViewportSize({ width: 390, height: 844 });
      await showDocument().waitFor();
      await showDocument().click();
      assert.equal(await showDocument().getAttribute('aria-selected'), 'true');
      assert.equal(await showArticles().getAttribute('aria-selected'), 'false');
      await documentPane().locator('canvas[data-rendered="true"]').waitFor();
      assert.equal(await review(f).isVisible(), false);
      await showArticles().click();
      assert.equal(await showArticles().getAttribute('aria-selected'), 'true');
      await category(f).waitFor();
      assert.equal(await documentPane().isVisible(), false);
      await minTarget(f.page.getByRole('tab'), 'Mobile tab');
    });

    await scenario('invoice-list-is-keyboard-operable-with-aria-current', { category: 'cat-test' }, async f => {
      await open(f, B);
      await waitForCurrentInvoice(f.page, B);
      await invoiceItem(f.page, C).focus();
      assert.equal(await invoiceItem(f.page, C).evaluate(element => element === document.activeElement), true);
      await f.page.keyboard.press('Enter');
      await waitForCurrentInvoice(f.page, C);
      // Only an arrival from outside (indicator link) moves focus to the document.
      // Choosing another invoice here keeps keyboard focus on the chosen item, even
      // though the ?invoice= link is rewritten.
      assert.equal(new URL(f.page.url()).searchParams.get('invoice'), C);
      await f.page.waitForTimeout(200);
      assert.equal(await invoiceItem(f.page, C).evaluate(element => element === document.activeElement), true, 'Focus stays on the chosen list item.');
      await review(f).getByLabel('Description de l’article 1', { exact: true }).waitFor();
      assert.equal(await description(f).inputValue(), 'Organisateur de bureau');
      await invoiceItem(f.page, C).focus();
      await f.page.keyboard.press('Shift+Tab');
      assert.equal(await invoiceItem(f.page, B).evaluate(element => element === document.activeElement), true, 'List items follow each other in the tab order.');
      assert.ok(await invoiceItem(f.page, B).evaluate(element => { const style = getComputedStyle(element); return style.outlineStyle !== 'none' || style.boxShadow !== 'none'; }), 'Keyboard focus is visible on the list item.');
      // Light theme: a navy ring (>= 3:1), not the 2:1 gold outline.
      assert.equal(await invoiceItem(f.page, B).evaluate(element => getComputedStyle(element).outlineColor), 'rgb(27, 58, 75)');
      await f.page.keyboard.press('Space');
      await waitForCurrentInvoice(f.page, B);
      assert.equal(await description(f).inputValue(), 'Scelleuse thermique');
      assert.equal(await currentInvoiceItem(f.page).count(), 1);
      // Walking to the end of the list keeps focus on the button just pressed.
      const following = shownInvoice(f).getByRole('button', { name: 'Facture suivante', exact: true });
      await following.focus();
      await f.page.keyboard.press('Enter');
      await waitForCurrentInvoice(f.page, C);
      assert.equal(await following.getAttribute('aria-disabled'), 'true');
      assert.equal(await following.evaluate(element => element === document.activeElement), true, 'Focus never falls to <body> at the end of the list.');
      assert.equal(saves(f).length, 0);
    });

    await scenario('document-retry-requests-a-fresh-signed-url-without-reloading', { category: 'cat-test' }, async f => {
      f.control.failSign = { file: 'scelleuse.pdf', remaining: 1 };
      // Full dossier reloads (select=* on this dossier), not the light background sync poll.
      const dossierReloads = [];
      f.page.on('request', request => { const url = new URL(request.url()); if (request.method() === 'GET' && url.pathname.endsWith('/rest/v1/colis') && url.searchParams.get('select') === '*' && url.searchParams.get('id') === `eq.${ids.P}`) dossierReloads.push(url.href); });
      await open(f, B);
      const source = f.page.getByRole('region', { name: 'Document source', exact: true });
      const failure = source.getByRole('alert').filter({ hasText: 'Le document n’a pas pu être chargé' });
      await failure.waitFor();
      const retry = failure.getByRole('button', { name: 'Réessayer', exact: true });
      await minTarget(retry, 'Document retry');
      const contexts = f.calls.filter(call => call.kind === 'context').length;
      const signs = f.calls.filter(call => call.kind === 'sign' && call.path.endsWith('/scelleuse.pdf')).length;
      const dossierReads = dossierReloads.length;
      await retry.focus();
      await f.page.keyboard.press('Enter');
      await source.locator('canvas[data-rendered="true"]').waitFor();
      assert.equal(await failure.count(), 0);
      assert.equal(await source.evaluate(element => element.contains(document.activeElement)), true, 'After the retry, focus is on the document, not <body>.');
      assert.equal(f.calls.filter(call => call.kind === 'sign' && call.path.endsWith('/scelleuse.pdf')).length, signs + 1, 'Retry asks for exactly one fresh signed URL.');
      assert.equal(f.calls.filter(call => call.kind === 'context').length, contexts, 'Retry does not reload the review context.');
      assert.ok(dossierReads >= 1, 'Control: the dossier load itself is observed.');
      assert.equal(dossierReloads.length, dossierReads, 'Retry does not reload the dossier.');
      assert.equal(f.requests.some(request => request.path.includes('/storage/v1/object/public/')), false, 'Private bucket: never a public URL.');
      assert.equal(await description(f).inputValue(), 'Scelleuse thermique');
      assert.equal(saves(f).length, 0);
    });

    await scenario('mobile-and-dark-mode-accessible-without-overflow', { category: 'cat-test' }, async f => {
      for (const theme of ['light', 'dark']) {
        await f.page.evaluate(theme => localStorage.setItem('expedile-theme', theme), theme);
        await f.page.reload();
        for (const mobile of [false, true]) {
          await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
          await open(f);
          assert.equal(await f.page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark', 'The requested theme must actually be applied before accessibility checks.');
          if (mobile) await f.page.getByRole('tab', { name: 'Vérifier les articles', exact: true }).click();
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
      // A deep link on a phone shows which invoice is open: the « Facture n sur N »
      // bar is on screen with the document right below it.
      await f.page.setViewportSize({ width: 390, height: 844 });
      await open(f, B);
      await f.page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Document source');
      await f.page.waitForTimeout(300);
      const bar = await shownInvoice(f).evaluate(element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      assert.ok(bar.top >= 0 && bar.bottom <= 844, `The displayed-invoice bar is visible after a deep link (${bar.top}-${bar.bottom}).`);
      assert.match(await shownInvoice(f).innerText(), /Facture 2 sur 3/);
      // Narrowest supported phone: the list, the displayed-invoice bar and its
      // navigation stay inside the screen with 44px targets.
      await f.page.setViewportSize({ width: 320, height: 700 });
      await invoiceList(f.page).waitFor();
      await noOverflow(f, '320 px');
      await minTarget(invoiceItems(f.page), 'Invoice list item');
      await minTarget(shownInvoice(f).getByRole('button'), 'Previous/next invoice');
      assert.equal(await invoiceItems(f.page).count(), 3);
      await f.page.screenshot({ path: path.join(output, 'invoice-dark-320.png'), fullPage: true });
    });

    // D1: a validated invoice is consulted without any analysis, whatever the server still holds.
    for (const legacy of [false, true]) await scenario(`validated-invoice-opens-without-analysis${legacy ? '-legacy-context' : ''}`, {}, async f => {
      Object.assign(f.records.get(ids.F), { documentHash: 'hash-a', extraction: { id: '74444444-4444-4444-8444-444444444444', facture_id: ids.F, document_hash: 'hash-a', document_file_url: ids.P + '/facture.pdf', document_storage_identity: 'stored-a-1', status: 'review', vendeur: 'Boutique A proposée', total: 99, lines: [{ desc: 'Article proposé', qte: 1, prix: 99, cat: 'cat-test' }], warnings: [] } });
      // Legacy: a server from before D1 still returns the extraction and no analysisAllowed.
      f.control.legacyContext = legacy;
      await open(f, ids.F);
      await f.page.getByTestId('invoice-modify').waitFor({ state: 'attached' });
      await f.page.waitForTimeout(400);
      assert.deepEqual(f.calls.filter(call => call.kind === 'ocr'), [], 'No ocr-facture call for a validated invoice.');
      assert.equal(await f.page.getByRole('button', { name: 'Reprendre l’analyse', exact: true }).count(), 0);
      assert.equal(await f.page.getByRole('button', { name: 'Analyser la facture', exact: true }).count(), 0);
      assert.equal(await f.page.getByTestId('invoice-proposals').count(), 0);
      assert.doesNotMatch(await review(f).innerText(), /\(proposé\)|Article proposé|Boutique A proposée/);
    });

    await scenario('modify-validated-invoice-opens-the-server-draft-then-one-resume', {}, async f => {
      await open(f, ids.F);
      await f.page.getByTestId('invoice-modify').click();
      await description(f).waitFor();
      assert.equal(await description(f).isEditable(), true);
      assert.deepEqual(f.calls.filter(call => call.kind === 'open-modification').map(call => call.input), [{ p_facture_id: ids.F, p_expected_review_token: 'review-1-a' }]);
      for (let i = 0; i < 40 && !f.calls.some(call => call.kind === 'ocr'); i++) await f.page.waitForTimeout(100);
      await f.page.waitForTimeout(400);
      assert.deepEqual(f.calls.filter(call => call.kind === 'ocr').map(call => call.input.action), ['resume'], 'Exactly one resume once the modification is open.');
      assert.equal(f.calls.some(call => call.kind === 'withdrawal'), false, 'No quote: nothing to withdraw.');
      assert.ok(f.records.get(ids.F).draft, 'The modification is a server draft.');
    });

    await scenario('payment-amount-without-date-freezes-invoices-without-ocr', {}, async f => {
      Object.assign(f.tables.colis[0], { paiement_montant: 152.4, paiement_date: null });
      Object.assign(f.tables.factures.find(invoice => invoice.id === C), { ocr_status: 'pending' });   // job skipped by the worker: the status stays stale
      await f.page.goto(`${base}/colis/${ids.P}?invoice=${B}&returnTo=%2Fcolis#quote-documents`);
      await f.page.getByTestId('invoice-frozen-notice').waitFor();
      assert.equal(await f.page.getByTestId('invoice-frozen-notice').innerText(), READ_ONLY);
      // R2-01 / UX-R2-03: no reading « en cours », no « À vérifier », a read-only pane that says why.
      const list = f.page.getByRole('list', { name: 'Factures du dossier' });
      await list.getByText('Conservée · hors devis').first().waitFor();
      const listText = await list.innerText();
      assert.doesNotMatch(listText, /Lecture automatique en cours|Propositions prêtes|À vérifier|Montant à vérifier/);
      const articlesTab = f.page.getByRole('tab', { name: 'Voir les articles', exact: true });
      if (await articlesTab.isVisible()) await articlesTab.click();
      assert.equal(await f.page.getByTestId('invoice-frozen-pane-notice').innerText(), READ_ONLY);
      await f.page.getByTestId('invoice-kept-summary').waitFor();
      assert.equal(await f.page.getByText('Choisissez une catégorie pour cet article.').count(), 0);
      assert.equal(await f.page.getByLabel('Description de l’article 1', { exact: true }).count(), 0, 'No editing form on a frozen dossier.');
      await f.page.waitForTimeout(400);
      assert.deepEqual(f.calls.filter(call => call.kind === 'ocr'), [], 'A frozen dossier never calls ocr-facture.');
      assert.equal(await validate(f).count(), 0);
      assert.equal(await f.page.getByTestId('invoice-proposals').count(), 0);
      assert.equal(await f.page.getByRole('button', { name: 'Ajouter une facture', exact: true }).count(), 0);
    });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture, B, C, EXTRACTION_B, EXTRACTION_C, output };
