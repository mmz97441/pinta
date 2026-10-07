/* Outgoing parcel labels in the browser: « Imprimer les étiquettes (N colis) » once the optimisation is saved, with
 * the permission « Imprimer les étiquettes » and hidden without it; its reprint after payment; the « Étiquettes »
 * action of the /colis selection with the dossiers left out, its outcome above the buttons (nothing moves under the
 * pointer, even without CSS containment as in Safari 14) and its alerts toned; an incomplete address, whose client
 * record link is offered only to the people allowed to change it; the window opened by the click itself while the label
 * module loads (iPad Safari), styled like the app, the button keeping the keyboard focus meanwhile; the download when
 * the window is refused, its file name whole; a loading failure stated on screen; and every outcome without a tab
 * brought into view above the bottom navigation.
 * setup() mocks every request: nothing reaches Supabase, Telegram or PayPlug, and printing writes nothing.
 * The PDF a click creates is read back from its blob, checked with pdf.js, and its first page drawn to a PNG. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_PARCEL_LABELS_OUT || '/tmp/pinta-parcel-labels';
const results = [];
const REF = 'EXP-2YE537';
const OTHER = { id: '88888888-8888-4888-8888-888888888888', ref: 'EXP-3HF210' };
const boxes = [{ dimL: 40, dimW: 20, dimH: 10, poids: 2.5 }, { dimL: 25, dimW: 20, dimH: 15, poids: 1.25 }];
const LABEL_CHUNK = /\/assets\/exportParcelLabels-[\w-]+\.js$/;
const PDFJS = path.dirname(require.resolve('pdfjs-dist/package.json'));
let pdfjs;

/** Installed in the page: the PDF blobs created and the windows asked for; `refuse` makes window.open fail. */
function recordLabels() {
  window.__labels = { blobs: [], opens: [], refuse: false };
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = object => { const url = create(object); if (object && object.type === 'application/pdf') window.__labels.blobs.push(url); return url; };
  const open = window.open.bind(window);
  window.open = (...args) => { window.__labels.opens.push(args.map(value => String(value ?? ''))); return window.__labels.refuse ? null : open(...args); };
}
const wideFonts = () => { const apply = () => { const style = document.createElement('style'); style.textContent = 'body, body * { font-family: Verdana, "DejaVu Sans", sans-serif !important; }'; document.head.appendChild(style); }; if (document.head) apply(); else document.addEventListener('DOMContentLoaded', apply); };

async function fixture(browser, { role = 'directeur', permissions = null, width = 1440, theme = 'light', state = 'prepared' } = {}) {
  const f = await setup(browser, role);
  f.page.setDefaultTimeout(10000);
  if (permissions) { const row = { id: 'labels-permissions', staff_id: ids.S, ...permissions }; f.tables.staff_permissions = [row]; f.tables.staff_users[0].staff_permissions = row; }
  await f.page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
  await f.context.addInitScript(value => localStorage.setItem('expedile-theme', value), theme);
  await f.context.addInitScript(recordLabels);
  if (width < 768) await f.context.addInitScript(wideFonts);
  // The address of the label module once the page has fetched it (labelModuleReady).
  f.page.on('response', response => { if (LABEL_CHUNK.test(new URL(response.url()).pathname)) f.labelChunk = response.url(); });
  const parcel = f.tables.colis[0];
  parcel.ref = REF;
  if (state === 'empty') Object.assign(parcel, { final_packages: [], fin_l: null, fin_w: null, fin_h: null, fin_p: null, outgoing_parcel_count: null, final_measurements_version: null, final_measurements_at: null });
  if (state === 'quoted') Object.assign(parcel, { statut: 'devis_envoye', quote_version: 1, devis_brouillon: false, devis_total: 77.5, devis_envoye_le: '2026-09-10T08:00:00Z',
    devis_snapshot: { inputs: { destination: { code: '974', nom: 'La Réunion', tva: 8.5 } }, amounts: { total: 77.5 } } });
  if (state === 'paid' || state === 'legacy') Object.assign(parcel, { statut: 'paye', quote_version: 1, devis_brouillon: false, devis_total: 77.5, devis_envoye_le: '2026-09-10T08:00:00Z', paiement_montant: 77.5, paiement_date: '2026-09-11T08:00:00Z',
    devis_snapshot: { inputs: { destination: { code: '974', nom: 'La Réunion', tva: 8.5 } }, amounts: { total: 77.5 } } });
  // Measured before the outgoing parcels were listed (20260912000005): one final measure, no list, no outgoing count.
  if (state === 'legacy') Object.assign(parcel, { final_packages: null, outgoing_parcel_count: null, preparation_composition_version: 0, final_measurements_version: 0 });
  // A second dossier of the same client, agreed but not prepared yet.
  f.tables.colis.push({ ...JSON.parse(JSON.stringify(parcel)), id: OTHER.id, ref: OTHER.ref, statut: 'autorise', casier: 'A-07', final_packages: [], fin_l: null, fin_w: null, fin_h: null, fin_p: null,
    outgoing_parcel_count: null, final_measurements_version: null, final_measurements_at: null, quote_version: 0, devis_total: null, devis_snapshot: null, paiement_date: null, paiement_montant: null });
  return f;
}
const preparation = f => f.page.getByRole('region', { name: 'Préparation après optimisation', exact: true });
const relay = f => preparation(f).getByRole('region', { name: 'Relais après préparation', exact: true });
const labelsBlock = f => f.page.getByTestId('parcel-labels');
const labelsButton = (f, count) => f.page.getByRole('button', { name: `Imprimer les étiquettes (${count} colis)`, exact: true });
const bar = f => f.page.getByRole('group', { name: 'Actions sur la sélection', exact: true });
const labelsState = f => f.page.evaluate(() => JSON.parse(JSON.stringify(window.__labels)));

async function waitTheme(f, theme) { await f.page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark'); }
async function fillBox(f, box, index) {
  for (const [key, label, unit] of [['dimL', 'Longueur', 'cm'], ['dimW', 'Largeur', 'cm'], ['dimH', 'Hauteur', 'cm'], ['poids', 'Poids réel', 'kg']])
    await preparation(f).getByLabel(`${label} · colis sortant ${index} (${unit})`, { exact: true }).fill(String(box[key]));
}
/** The PDF of the `count`-th blob the page created, as bytes. */
async function labelPdf(f, count) {
  await f.page.waitForFunction(n => window.__labels.blobs.length >= n, count);
  const base64 = await f.page.evaluate(async n => {
    const bytes = new Uint8Array(await (await fetch(window.__labels.blobs[n - 1])).arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  }, count);
  return Buffer.from(base64, 'base64');
}
/** Each page's text items, no-break spaces read as spaces. */
async function pdfPages(buffer) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: path.join(PDFJS, 'standard_fonts') + path.sep }).promise;
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    pages.push({ view: page.view, text: (await page.getTextContent()).items.map(item => item.str.replace(/\u00a0/g, ' ')).filter(text => text.trim()) });
  }
  return pages;
}
function assertLabelPages(pages, labels) {
  assert.equal(pages.length, labels.length, 'one page per outgoing parcel');
  pages.forEach((page, index) => {
    const { index: position, count, size, weight } = labels[index];
    assert.ok(Math.abs(page.view[2] - 283.46) < 0.1 && Math.abs(page.view[3] - 425.2) < 0.1, 'a 100 × 150 mm page');
    for (const text of [`${REF} · Colis ${position}/${count}`, REF, `Colis ${position}/${count}`, 'CASIER A-03', size, `Poids réel ${weight}`, 'EXEMPLE Camille', '1 RUE EXEMPLE', '97400 SAINT-DENIS', 'LA RÉUNION', 'Tél. 0262 00 00 01'])
      assert.ok(page.text.includes(text), `page ${index + 1}: « ${text} » in ${JSON.stringify(page.text)}`);
  });
}
/** The first page of the PDF drawn by pdf.js in a separate, offline page, saved as a PNG. */
async function renderLabel(browser, buffer, file) {
  const context = await browser.newContext({ viewport: { width: 900, height: 1300 } });
  await context.route('http://label.render/**', async route => {
    const name = new URL(route.request().url()).pathname;
    if (name === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="fr"><body style="margin:0;background:#fff"><canvas id="label"></canvas></body></html>' });
    if (['/pdf.mjs', '/pdf.worker.mjs'].includes(name)) return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(PDFJS, 'build', name.slice(1))) });
    if (name.startsWith('/standard_fonts/')) return route.fulfill({ contentType: 'application/octet-stream', body: await fs.readFile(path.join(PDFJS, name)) });
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto('http://label.render/');
  await page.evaluate(async data => {
    const pdfjsLib = await import('/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
    const pdf = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(data), char => char.charCodeAt(0)), standardFontDataUrl: '/standard_fonts/' }).promise;
    const first = await pdf.getPage(1);
    const viewport = first.getViewport({ scale: 3 });
    const canvas = document.getElementById('label');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await first.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
  }, buffer.toString('base64'));
  await page.locator('#label').screenshot({ path: file });
  await context.close();
}
async function noOverflow(f) { assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal scroll'); }
async function axe(f, selector) {
  const audit = await new AxeBuilder({ page: f.page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
}
// The work queue refreshes itself every minute and on focus (AppContext): that call is not the print's.
const BACKGROUND_REFRESH = '/rest/v1/rpc/refresh_staff_work_actions';
/** Printing writes nothing: no request reaches the mocked backend between the click and its outcome. */
async function printWithoutWrites(f, click, settled) {
  const before = f.requests.length;
  await click();
  await settled();
  assert.deepEqual(f.requests.slice(before).filter(request => request.method !== 'GET' && request.path !== BACKGROUND_REFRESH), [], 'printing labels writes nothing');
}
async function closePopups(f) { for (const page of f.context.pages()) if (page !== f.page) await page.close(); }
/**
 * Scrolls the page so that `locator` ends `gap` px above the bottom of what is visible: the top of the phone's bottom
 * navigation, else the window's bottom. Returns that limit; the outcome under the button then starts out of view.
 */
async function nearTheBottom(f, locator, gap = 12) {
  await locator.scrollIntoViewIfNeeded();
  const { limit, bottom } = await locator.evaluate((node, gap) => {
    const nav = document.querySelector('[data-staff-bottom-nav]');
    const limit = nav && nav.getBoundingClientRect().height > 0 ? nav.getBoundingClientRect().top : innerHeight;
    let scroller = node.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    (scroller || document.scrollingElement).scrollTop += node.getBoundingClientRect().bottom - (limit - gap);
    return { limit, bottom: node.getBoundingClientRect().bottom };
  }, gap);
  assert.ok(bottom > limit - gap - 2 && bottom <= limit, `the button ends ${Math.round(limit - bottom)} px above the bottom limit`);
  return limit;
}
/** Waits until `locator` is entirely visible between the top of the window and `limit` (a smooth scroll takes a moment). */
async function fullyVisible(f, locator, limit) {
  const node = await locator.elementHandle();
  await f.page.waitForFunction(([node, limit]) => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= limit + 0.5; }, [node, limit], { timeout: 8000 })
    .catch(async () => { throw new Error(`outcome out of view: ${JSON.stringify(await node.evaluate(item => item.getBoundingClientRect().toJSON()))}, visible down to ${limit}`); });
}
/** The tops of the line boxes of an element's text: a single one when the text keeps to one line. */
const lineTops = locator => locator.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); return [...new Set([...range.getClientRects()].map(rect => Math.round(rect.top)))]; });
/** The centre of the selection bar's « Étiquettes » button, and what a second click there would hit. */
const pointAt = button => button.evaluate(node => { const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, top: rect.top, left: rect.left }; });
const hits = (f, point, button) => button.evaluate((node, { x, y }) => node.contains(document.elementFromPoint(x, y)), point);
/** Waits until the label module that the button preloads is in memory: the next click opens the PDF itself. */
async function labelModuleReady(f) {
  for (let attempt = 0; attempt < 100 && !f.labelChunk; attempt += 1) await f.page.waitForTimeout(100);
  assert.ok(f.labelChunk, 'the label button preloads its module');
  // The same module, imported again, settles once it is evaluated; two frames let the button's own import settle too.
  await f.page.evaluate(async url => {
    await import(url);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, f.labelChunk);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const browser = await chromium.launch({ headless: true });
  let rendered = false;
  async function scenario(name, options, action) {
    const f = await fixture(browser, options);
    try {
      await f.login();
      await action(f);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
      results.push({ test: name, pass: true });
    } catch (error) {
      results.push({ test: name, pass: false, error: error.stack }); process.exitCode = 1;
      await f.page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, `${name}-failure.txt`), await f.page.locator('body').innerText().catch(() => '')).catch(() => {});
    } finally { await f.context.close(); }
  }
  try {
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) await scenario(`labels-after-the-optimisation-${width}-${theme}`,
      { role: 'preparateur', permissions: { perm_colis_preparer: true, perm_envois_etiquettes: true }, width, theme, state: 'empty' }, async f => {
        await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
        await preparation(f).waitFor(); await waitTheme(f, theme);
        // No label before the optimisation is saved.
        assert.equal(await labelsBlock(f).count(), 0);
        await fillBox(f, boxes[0], 1);
        await preparation(f).getByRole('button', { name: '+ Ajouter un colis après optimisation', exact: true }).click();
        await fillBox(f, boxes[1], 2);
        await preparation(f).getByRole('button', { name: 'Enregistrer l’optimisation', exact: true }).click();
        await relay(f).waitFor();
        const button = relay(f).getByRole('button', { name: 'Imprimer les étiquettes (2 colis)', exact: true });
        await button.waitFor();
        assert.ok((await button.boundingBox()).height >= 44, 'a 44 px touch target');
        await printWithoutWrites(f, () => button.click(),
          () => relay(f).getByRole('status').filter({ hasText: '2 étiquettes ouvertes dans un nouvel onglet. Imprimez sur étiquettes 100 × 150 mm.' }).waitFor());
        const pdf = await labelPdf(f, 1);
        assertLabelPages(await pdfPages(pdf), [{ index: 1, count: 2, size: '40 × 20 × 10 cm', weight: '2,5 kg' }, { index: 2, count: 2, size: '25 × 20 × 15 cm', weight: '1,25 kg' }]);
        const { opens } = await labelsState(f);
        // The module was loaded ahead (the window gets the PDF in the click) or not yet (the click opened it first).
        assert.ok(opens.length === 1 && (/^blob:/.test(opens[0][0]) || opens[0][0] === '') && opens[0][1] === '_blank', JSON.stringify(opens));
        await closePopups(f);
        await noOverflow(f);
        await axe(f, '[data-testid="parcel-labels"]');
        await relay(f).scrollIntoViewIfNeeded();
        await f.page.screenshot({ path: path.join(output, `preparation-labels-${width}-${theme}.png`), fullPage: width < 768 });
        if (!rendered) { await renderLabel(browser, pdf, path.join(output, `etiquette-${REF}-colis-1.png`)); rendered = true; }
      });

    await scenario('labels-hidden-without-the-permission-1440-light', { role: 'preparateur', permissions: { perm_colis_preparer: true }, state: 'empty' }, async f => {
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      await fillBox(f, boxes[0], 1);
      await preparation(f).getByRole('button', { name: 'Enregistrer l’optimisation', exact: true }).click();
      await relay(f).getByText('Optimisation enregistrée', { exact: false }).waitFor();
      assert.equal(await labelsBlock(f).count(), 0, 'no label button without « Imprimer les étiquettes »');
      await f.page.goto(`${base}/colis`);
      await f.page.getByRole('checkbox', { name: `Sélectionner le dossier ${REF}`, exact: true }).check();
      await bar(f).getByText('1 dossier sélectionné', { exact: true }).waitFor();
      assert.equal(await bar(f).getByRole('button', { name: /^Étiquettes/ }).count(), 0);
      assert.deepEqual((await labelsState(f)).opens, []);
    });

    await scenario('no-label-button-before-a-current-preparation-1440-light', { state: 'empty' }, async f => {
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      await preparation(f).getByRole('button', { name: 'Enregistrer l’optimisation', exact: true }).waitFor();
      assert.equal(await labelsBlock(f).count(), 0);
    });

    await scenario('labels-beside-the-saved-preparation-once-the-quote-is-sent-1440-light', { state: 'quoted' }, async f => {
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      const guidance = f.page.getByTestId('task-guidance');
      await guidance.getByRole('heading', { name: 'Préparation enregistrée', exact: true }).waitFor();
      // Idle, the place kept for the outcome lays out no box: the card ends with its own padding under the block.
      const room = await labelsBlock(f).evaluate(node => { const card = node.closest('[data-testid="task-guidance"]'); const style = getComputedStyle(card);
        return Math.round(card.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth)); });
      assert.equal(room, 0, 'nothing hangs under the idle label block');
      // Once the button's module is preloaded, the click builds the PDF and opens it itself (iPad Safari): no blank window first.
      await labelModuleReady(f);
      await printWithoutWrites(f, () => guidance.getByRole('button', { name: 'Imprimer les étiquettes (1 colis)', exact: true }).click(),
        () => labelsBlock(f).getByRole('status').filter({ hasText: '1 étiquette ouverte dans un nouvel onglet.' }).waitFor());
      const { opens, blobs } = await labelsState(f);
      assert.deepEqual(opens, [[blobs[0], '_blank']], 'the PDF itself opened in the click');
      assertLabelPages(await pdfPages(await labelPdf(f, 1)), [{ index: 1, count: 1, size: '30 × 20 × 20 cm', weight: '3 kg' }]);
      await closePopups(f);
    });

    for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) await scenario(`labels-reprinted-after-payment-${width}-${theme}`, { width, theme, state: 'paid' }, async f => {
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      const guidance = f.page.getByTestId('task-guidance');
      await guidance.getByRole('heading', { name: 'Préparation terminée', exact: true }).waitFor(); await waitTheme(f, theme);
      const button = guidance.getByRole('button', { name: 'Imprimer les étiquettes (1 colis)', exact: true });
      await printWithoutWrites(f, () => button.click(), () => labelsBlock(f).getByRole('status').filter({ hasText: '1 étiquette ouverte dans un nouvel onglet.' }).waitFor());
      assertLabelPages(await pdfPages(await labelPdf(f, 1)), [{ index: 1, count: 1, size: '30 × 20 × 20 cm', weight: '3 kg' }]);
      await closePopups(f);
      await noOverflow(f);
      await axe(f, '[data-testid="parcel-labels"]');
      await labelsBlock(f).scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, `reprint-after-payment-${width}-${theme}.png`), fullPage: width < 768 });
    });

    // A dossier measured before the outgoing parcels were listed: its one parcel gets the label « 1/1 » that the
    // loading control expects, on its read-only preparation and from the /colis selection.
    await scenario('labels-of-a-dossier-measured-before-the-parcels-were-listed-1440-light', { state: 'legacy' }, async f => {
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      const guidance = f.page.getByTestId('task-guidance');
      await guidance.getByRole('heading', { name: 'Préparation terminée', exact: true }).waitFor();
      await printWithoutWrites(f, () => guidance.getByRole('button', { name: 'Imprimer les étiquettes (1 colis)', exact: true }).click(),
        () => labelsBlock(f).getByRole('status').filter({ hasText: '1 étiquette ouverte dans un nouvel onglet.' }).waitFor());
      assertLabelPages(await pdfPages(await labelPdf(f, 1)), [{ index: 1, count: 1, size: '30 × 20 × 20 cm', weight: '3 kg' }]);
      await closePopups(f);
      await axe(f, '[data-testid="parcel-labels"]');
      await labelsBlock(f).scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, 'legacy-dossier-label-1440-light.png') });
      await f.page.goto(`${base}/colis`);
      await f.page.getByRole('checkbox', { name: `Sélectionner le dossier ${REF}`, exact: true }).check();
      await printWithoutWrites(f, () => bar(f).getByRole('button', { name: 'Étiquettes du dossier sélectionné', exact: true }).click(),
        () => bar(f).getByRole('status').filter({ hasText: '1 étiquette ouverte dans un nouvel onglet.' }).waitFor());
      // A new page: its first document.
      assertLabelPages(await pdfPages(await labelPdf(f, 1)), [{ index: 1, count: 1, size: '30 × 20 × 20 cm', weight: '3 kg' }]);
      await closePopups(f);
      // A refused window downloads the file; its name, which carries the reference, stays whole in the bar too.
      await f.page.evaluate(() => { window.__labels.refuse = true; });
      const [download] = await Promise.all([f.page.waitForEvent('download'), bar(f).getByRole('button', { name: 'Étiquettes du dossier sélectionné', exact: true }).click()]);
      assert.equal(download.suggestedFilename(), `etiquettes-${REF}.pdf`);
      const downloaded = bar(f).getByRole('status').filter({ hasText: `1 étiquette téléchargée (etiquettes-${REF}.pdf). Ouvrez le fichier pour l’imprimer sur étiquettes 100 × 150 mm.` });
      await downloaded.waitFor();
      assert.deepEqual(await downloaded.locator('.keep-token').allInnerTexts(), [`(etiquettes-${REF}.pdf).`]);
    });

    for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) await scenario(`selection-labels-and-dossiers-left-out-${width}-${theme}`, { width, theme }, async f => {
      await f.page.goto(`${base}/colis`); await waitTheme(f, theme);
      for (const ref of [REF, OTHER.ref]) await f.page.getByRole('checkbox', { name: `Sélectionner le dossier ${ref}`, exact: true }).check();
      await bar(f).getByText('2 dossiers sélectionnés', { exact: true }).waitFor();
      const action = bar(f).getByRole('button', { name: 'Étiquettes des 2 dossiers sélectionnés', exact: true });
      assert.equal(await action.innerText(), 'Étiquettes');
      const before = await pointAt(action);
      await printWithoutWrites(f, () => action.click(),
        () => bar(f).getByRole('status').filter({ hasText: `1 étiquette ouverte dans un nouvel onglet. Imprimez sur étiquettes 100 × 150 mm. ${OTHER.ref} : étiquettes disponibles après l’optimisation des colis` }).waitFor());
      // The outcome takes its own line above the buttons: « Étiquettes » stays under the pointer.
      const after = await pointAt(action);
      assert.ok(Math.abs(after.top - before.top) <= 1 && Math.abs(after.left - before.left) <= 6, `the button stays in place: ${JSON.stringify({ before, after })}`);
      assert.equal(await hits(f, before, action), true, 'a second click at the same place reaches « Étiquettes »');
      const outcome = bar(f).getByRole('status');
      assert.ok((await outcome.boundingBox()).y + 1 < before.top, 'the outcome reads above the buttons');
      // The reference left out moves to the next line whole, never split at its hyphen.
      assert.deepEqual(await outcome.locator('.keep-token').allInnerTexts(), [OTHER.ref]);
      assert.equal((await lineTops(outcome.locator('.keep-token'))).length, 1);
      assertLabelPages(await pdfPages(await labelPdf(f, 1)), [{ index: 1, count: 1, size: '30 × 20 × 20 cm', weight: '3 kg' }]);
      await closePopups(f);
      await noOverflow(f);
      await axe(f, '[aria-label="Actions sur la sélection"]');
      await f.page.screenshot({ path: path.join(output, `selection-labels-${width}-${theme}.png`) });
      // A new selection forgets that outcome; nothing printable opens nothing and says why, as a warning.
      await f.page.getByRole('checkbox', { name: `Sélectionner le dossier ${REF}`, exact: true }).uncheck();
      await bar(f).getByText('1 dossier sélectionné', { exact: true }).waitFor();
      await bar(f).locator('.dossier-bulk-note').filter({ hasText: 'ouverte' }).waitFor({ state: 'detached' });
      const single = bar(f).getByRole('button', { name: 'Étiquettes du dossier sélectionné', exact: true });
      const point = await pointAt(single);
      await single.click();
      const nothing = bar(f).getByRole('alert').filter({ hasText: `Aucune étiquette à imprimer. ${OTHER.ref} : étiquettes disponibles après l’optimisation des colis` });
      await nothing.waitFor();
      assert.equal(await nothing.getAttribute('data-tone'), 'warning');
      assert.deepEqual(await nothing.locator('.keep-token').allInnerTexts(), [OTHER.ref]);
      assert.equal(await hits(f, point, single), true, 'the alert does not take the place of « Étiquettes »');
      assert.equal((await labelsState(f)).opens.length, 1, 'no window for a selection without labels');
      await f.page.screenshot({ path: path.join(output, `selection-without-labels-${width}-${theme}.png`) });
    });

    // A browser without CSS containment (Safari before 15.4, so Safari 14): the outcome's text must not widen the bar
    // either, else « Étiquettes » slides away and « Exporter » comes under the pointer (84 px at 1440 px).
    await scenario('selection-labels-stay-under-the-pointer-without-css-containment-1440-light', {}, async f => {
      await f.page.goto(`${base}/colis`);
      await f.page.addStyleTag({ content: '.dossier-bulk-bar > p { contain: none !important; }' });
      for (const ref of [REF, OTHER.ref]) await f.page.getByRole('checkbox', { name: `Sélectionner le dossier ${ref}`, exact: true }).check();
      const action = bar(f).getByRole('button', { name: 'Étiquettes des 2 dossiers sélectionnés', exact: true });
      const before = await pointAt(action);
      await action.click();
      const outcome = bar(f).getByRole('status').filter({ hasText: '1 étiquette ouverte dans un nouvel onglet.' });
      await outcome.waitFor();
      await closePopups(f);
      const after = await pointAt(action);
      assert.ok(Math.abs(after.top - before.top) <= 1 && Math.abs(after.left - before.left) <= 6, `the button stays in place: ${JSON.stringify({ before, after })}`);
      assert.equal(await hits(f, before, action), true, 'a second click at the same place reaches « Étiquettes », never « Exporter »');
      // The outcome still takes the bar's whole line, its text wrapping inside it.
      const [width, line] = await outcome.evaluate(node => { const style = getComputedStyle(node.parentElement);
        return [node.getBoundingClientRect().width, node.parentElement.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)]; });
      assert.ok(Math.abs(width - line) <= 1, `the outcome spans the bar: ${width} of ${line} px`);
      // Nothing printable: the warning takes the same line.
      await f.page.getByRole('checkbox', { name: `Sélectionner le dossier ${REF}`, exact: true }).uncheck();
      const single = bar(f).getByRole('button', { name: 'Étiquettes du dossier sélectionné', exact: true });
      await bar(f).locator('.dossier-bulk-note').filter({ hasText: 'ouverte' }).waitFor({ state: 'detached' });
      const point = await pointAt(single);
      await single.click();
      await bar(f).getByRole('alert').filter({ hasText: 'Aucune étiquette à imprimer.' }).waitFor();
      assert.equal(await hits(f, point, single), true, 'the warning leaves « Étiquettes » under the pointer');
      await noOverflow(f);
    });

    await scenario('an-incomplete-address-prints-nothing-and-opens-the-client-record-1440-light', {}, async f => {
      f.tables.clients[0].adresse_ligne1 = null;
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      // The button at the bottom of the window: no tab opens, so the alert is brought into view.
      const limit = await nearTheBottom(f, labelsButton(f, 1));
      await labelsButton(f, 1).click();
      const alert = labelsBlock(f).getByRole('alert');
      await alert.filter({ hasText: `Aucune étiquette. ${REF} : adresse du destinataire à compléter avant d’imprimer les étiquettes (adresse)` }).waitFor();
      await fullyVisible(f, alert, limit);
      assert.deepEqual(await alert.locator('.keep-token').allInnerTexts(), [REF]);
      assert.deepEqual((await labelsState(f)).blobs, [], 'no document without the address');
      await alert.getByRole('button', { name: 'Compléter la fiche client', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === `/clients/${ids.C}` && url.searchParams.get('completer') === 'adresse' && url.searchParams.get('returnTo') === `/colis/${ids.P}?section=preparation`);
    });

    await scenario('an-incomplete-address-without-the-right-to-change-the-record-390-dark', { role: 'preparateur', width: 390, theme: 'dark',
      permissions: { perm_colis_preparer: true, perm_envois_etiquettes: true, perm_clients_voir: true } }, async f => {
      f.tables.clients[0].adresse_ligne1 = null;
      await f.page.emulateMedia({ reducedMotion: 'reduce' });
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      await waitTheme(f, 'dark');
      // Just above the phone's bottom navigation: the alert is brought into view, without animation here.
      const limit = await nearTheBottom(f, labelsButton(f, 1));
      await labelsButton(f, 1).click();
      const alert = labelsBlock(f).getByRole('alert');
      await alert.filter({ hasText: `Aucune étiquette. ${REF} : adresse du destinataire à compléter avant d’imprimer les étiquettes (adresse)` }).waitFor();
      await fullyVisible(f, alert, limit);
      // Completing the record is offered only to the people allowed to change it.
      assert.equal(await alert.getByRole('button').count(), 0, 'no « Compléter la fiche client » without perm_clients_modifier');
      assert.deepEqual((await labelsState(f)).blobs, [], 'no document without the address');
      await noOverflow(f);
      await axe(f, '[data-testid="parcel-labels"]');
      await labelsBlock(f).scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, 'incomplete-address-read-only-390-dark.png') });
    });

    // The window opened by the click reads like the app until the labels replace it: --bg-canvas and --text-primary.
    const WAITING = { light: { background: 'rgb(250, 250, 246)', color: 'rgb(42, 40, 38)', scheme: 'light' }, dark: { background: 'rgb(28, 26, 23)', color: 'rgb(232, 228, 220)', scheme: 'dark' } };
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) await scenario(`a-click-before-the-module-opens-the-window-first-${width}-${theme}`, { width, theme }, async f => {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      await f.context.route(LABEL_CHUNK, async route => { await held; await route.fallback(); });
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      await waitTheme(f, theme);
      const button = labelsButton(f, 1);
      // From the keyboard: Enter on the focused button.
      await button.focus();
      const [waiting] = await Promise.all([f.page.waitForEvent('popup'), f.page.keyboard.press('Enter')]);
      await labelsBlock(f).getByRole('status').filter({ hasText: 'Préparation des étiquettes…' }).waitFor();
      assert.deepEqual([await button.getAttribute('aria-disabled'), await button.getAttribute('aria-busy')], ['true', 'true'], 'one print at a time');
      assert.equal(await button.evaluate(node => document.activeElement === node), true, 'the button keeps the keyboard focus while the labels are prepared');
      // A second Enter meanwhile opens nothing more.
      await f.page.keyboard.press('Enter');
      assert.deepEqual((await labelsState(f)).opens, [['', '_blank']], 'the click itself opened the window');
      const look = await waiting.evaluate(() => {
        const style = getComputedStyle(document.body);
        return { lang: document.documentElement.lang, title: document.title, viewport: document.querySelector('meta[name="viewport"]')?.content, text: document.body.textContent,
          background: style.backgroundColor, color: style.color, size: style.fontSize, weight: style.fontWeight, margin: style.margin, display: style.display, scheme: getComputedStyle(document.documentElement).colorScheme };
      });
      assert.deepEqual(look, { lang: 'fr', title: 'Étiquettes Expedîle', viewport: 'width=device-width, initial-scale=1', text: 'Préparation des étiquettes…',
        background: WAITING[theme].background, color: WAITING[theme].color, size: '16px', weight: '600', margin: '0px', display: 'grid', scheme: WAITING[theme].scheme });
      await waiting.screenshot({ path: path.join(output, `waiting-window-${width}-${theme}.png`) });
      release();
      await labelsBlock(f).getByRole('status').filter({ hasText: '1 étiquette ouverte dans un nouvel onglet.' }).waitFor();
      assertLabelPages(await pdfPages(await labelPdf(f, 1)), [{ index: 1, count: 1, size: '30 × 20 × 20 cm', weight: '3 kg' }]);
      assert.equal((await labelsState(f)).opens.length, 1, 'the PDF went into that window, no second one');
      assert.equal(await button.getAttribute('aria-disabled'), null);
      assert.equal(await button.evaluate(node => document.activeElement === node), true, 'the focus is still on the button once the labels are opened');
      await closePopups(f);
    });

    await scenario('a-refused-window-downloads-the-labels-390-dark', { width: 390, theme: 'dark' }, async f => {
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      const button = labelsButton(f, 1);
      await button.waitFor();
      await f.page.evaluate(() => { window.__labels.refuse = true; });
      const limit = await nearTheBottom(f, button);
      const [download] = await Promise.all([f.page.waitForEvent('download'), button.click()]);
      assert.equal(download.suggestedFilename(), `etiquettes-${REF}.pdf`);
      assertLabelPages(await pdfPages(await fs.readFile(await download.path())), [{ index: 1, count: 1, size: '30 × 20 × 20 cm', weight: '3 kg' }]);
      const status = labelsBlock(f).getByRole('status').filter({ hasText: `1 étiquette téléchargée (etiquettes-${REF}.pdf). Ouvrez le fichier pour l’imprimer sur étiquettes 100 × 150 mm.` });
      await status.waitFor();
      // No tab to look at: the message comes into view above the bottom navigation, the file name on one line.
      await fullyVisible(f, status, limit);
      // The file name, with the brackets and the full stop against it, never split at its hyphen nor left without them.
      const name = status.locator('.keep-token');
      assert.deepEqual(await name.allInnerTexts(), [`(etiquettes-${REF}.pdf).`]);
      assert.equal((await lineTops(name)).length, 1, 'the file name is never split at its hyphen');
      await noOverflow(f);
      await labelsBlock(f).scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, 'refused-window-download-390-dark.png') });
    });

    await scenario('a-loading-failure-is-stated-and-closes-the-waiting-window-1440-dark', { theme: 'dark' }, async f => {
      await f.context.route(LABEL_CHUNK, route => route.abort());
      await f.page.goto(`${base}/colis/${ids.P}?section=preparation`);
      const limit = await nearTheBottom(f, labelsButton(f, 1));
      await labelsButton(f, 1).click();
      // Chrome keeps a failed module import until the page is reloaded: the message asks for the reload.
      const failure = labelsBlock(f).getByRole('alert').filter({ hasText: 'Les étiquettes n’ont pas pu être chargées. Vérifiez la connexion puis rechargez la page pour réessayer.' });
      await failure.waitFor();
      await fullyVisible(f, failure, limit);
      assert.deepEqual((await labelsState(f)).opens, [['', '_blank']]);
      for (let attempt = 0; attempt < 50 && f.context.pages().length > 1; attempt += 1) await f.page.waitForTimeout(100);
      assert.equal(f.context.pages().length, 1, 'the waiting window is closed');
      assert.equal(await labelsButton(f, 1).isEnabled(), true, 'the person can try again');
      assert.equal(await labelsButton(f, 1).getAttribute('aria-disabled'), null);
      await labelsBlock(f).scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, 'loading-failure-1440-dark.png') });
      // The selection bar states the same failure as an error, apart from its neutral notes.
      await f.page.goto(`${base}/colis`);
      await f.page.getByRole('checkbox', { name: `Sélectionner le dossier ${REF}`, exact: true }).check();
      await bar(f).getByRole('button', { name: 'Étiquettes du dossier sélectionné', exact: true }).click();
      const barFailure = bar(f).getByRole('alert').filter({ hasText: 'Les étiquettes n’ont pas pu être chargées.' });
      await barFailure.waitFor();
      assert.equal(await barFailure.getAttribute('data-tone'), 'error');
      for (let attempt = 0; attempt < 50 && f.context.pages().length > 1; attempt += 1) await f.page.waitForTimeout(100);
      await f.page.screenshot({ path: path.join(output, 'selection-loading-failure-1440-dark.png') });
    });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'parcel-labels-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
