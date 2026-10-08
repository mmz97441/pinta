/* Totals and « Taxes calculées » of the « Dossiers d’expédition » list: synthetic data
 * only, every request intercepted; no provider, notification or production call. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const XLSX = require('xlsx');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_DOSSIER_TOTALS_OUT || '/tmp/pinta-dossier-totals';
const results = [];
const parcelId = n => `96000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DEPARTURE = { first: '97000000-1111-4111-8111-000000000001', second: '97000000-1111-4111-8111-000000000002' };
const PRO = '97000000-2222-4222-8222-000000000001';
const T = n => parcelId(n);
// Spaces as Intl writes them (« 1 250,00 € »): compared as plain spaces.
const plain = value => String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
const businessWrites = f => f.requests.filter(request => ['POST', 'PATCH', 'DELETE'].includes(request.method) && request.path.startsWith('/rest/v1/')
  && !['/refresh_staff_work_actions', '/get_reception_dates'].some(rpc => request.path.endsWith(rpc)));
const theme = (f, dark) => f.context.addInitScript(dark => localStorage.setItem('expedile-theme', dark ? 'dark' : 'light'), dark);
const waitTheme = (f, dark) => f.page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, dark);
const sizeOf = width => ({ width, height: width === 390 ? 844 : width === 1280 ? 800 : 900 });
const noPageOverflow = async f => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'No horizontal scroll of the page.');
async function axeClean(f, include) {
  let builder = new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
  if (include) builder = builder.include(include);
  const audit = await builder.analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
}
// The wide fallback font of the Linux CI: widths are checked with it too.
const wideFont = f => f.context.addInitScript(() => { const install = () => { const style = document.createElement('style'); style.textContent = 'body, body * { font-family: Verdana, "DejaVu Sans", sans-serif !important; }'; document.head.appendChild(style); }; if (document.head) install(); else document.addEventListener('DOMContentLoaded', install); });

/** A saved quote as save_quote freezes it: amounts and the client's type. */
const savedQuote = (amounts, { client = 'particulier', version = 1 } = {}) => ({ schemaVersion: 1, currency: 'EUR', mode: 'final', version, inputs: { client: { type: client }, volumetricDivisor: 5000 }, amounts: { transport: 50, fees: 0, ...amounts } });
const box = (dimL, dimW, dimH, poids) => ({ dimL, dimW, dimH, poids });

/**
 * Six dossiers, what their cells show (divisor 5000):
 *  T1 quote sent      2 cartons · 1 colis · 30×20×20 3 kg (2,4 kg vol.) · 100,00 € · taxes 20,00 €        · départ 1
 *  T2 draft           1 carton  · 2 colis · 1,25 + 2,5 kg (1,2 + 12 kg vol.) · 83,47 € Brouillon · 12,67 € Brouillon · départ 1
 *  T3 measured only   3 cartons · nothing optimised · À calculer · À calculer                         · no departure
 *  T4 paid            1 carton  · 1 colis · 40×30×20 5 kg (4,8 kg vol.) · 120,00 € · taxes 24,45 €        · départ 2
 *  T5 former quote    1 carton  · 1 colis · 30×20×20 2 kg (2,4 kg vol.) · 50,00 € · taxes À vérifier     · départ 2
 *  T6 professional    1 carton  · 1 colis · 30×20×20 1 kg (2,4 kg vol.) · 40,00 € · Sans taxes (pro)    · départ 1
 */
async function fixture(browser, options = {}) {
  const f = await setup(browser, options.restricted ? 'preparateur' : 'directeur', { device: options.device || {} });
  f.page.setDefaultTimeout(10000);
  if (options.restricted) {
    const rights = { id: 'totals-permissions', staff_id: ids.S, perm_colis_preparer: true, perm_export_colis: true };
    f.tables.staff_permissions = [rights]; f.tables.staff_users[0].staff_permissions = rights;
  }
  f.tables.staff_work_preferences[0].active_mission = null;
  f.tables.staff_work_actions = [];
  const client = f.tables.clients[0];
  f.tables.clients.push({ ...structuredClone(client), id: PRO, ref: 'CLI-PRO', nom: 'Société Lagon', prenom: '', type: 'pro', email: 'contact@lagon.example.test' });
  const original = structuredClone(f.tables.colis[0]);
  const parcel = (n, changes = {}) => ({ ...structuredClone(original), id: T(n), ref: `EXP-TOT00${n}`, client_id: client.id, casier: `T-${n}`, trackings: [], trackings_detail: [], dims_par_colis: [], reception_dates: [{ receivedAt: `2026-10-0${n}T08:00:00Z`, source: 'server' }],
    statut: 'devis_envoye', feu_vert: 'autorise', devis_brouillon: false, quote_version: 1, devis_envoye_le: '2026-10-02T08:00:00Z', devis_total: 0, devis_snapshot: null,
    preparation_composition_version: 1, final_measurements_version: 1, outgoing_parcel_count: 1, final_packages: [box(30, 20, 20, 3)], fin_l: 30, fin_w: 20, fin_h: 20, fin_p: 3,
    paiement_montant: null, paiement_date: null, envoi_id: null, updated_at: '2026-10-02T08:00:00Z', ...changes });
  f.tables.colis = [
    parcel(1, { nb_colis: 2, devis_total: 100, devis_snapshot: savedQuote({ om: 10, omr: 5, tva: 5, total: 100 }), envoi_id: DEPARTURE.first }),
    parcel(2, { nb_colis: 1, statut: 'en_preparation', devis_brouillon: true, quote_version: 3, devis_envoye_le: null, devis_total: 83.47, devis_snapshot: savedQuote({ om: 4.1, omr: 1.2, tva: 7.37, total: 83.47 }, { version: 3 }),
      outgoing_parcel_count: 2, final_packages: [box(30, 20, 10, 1.25), box(50, 40, 30, 2.5)], envoi_id: DEPARTURE.first }),
    parcel(3, { nb_colis: 3, statut: 'mesure', feu_vert: 'en_attente', quote_version: 0, devis_envoye_le: null, preparation_composition_version: null, final_measurements_version: null, outgoing_parcel_count: 0, final_packages: [], fin_l: null, fin_w: null, fin_h: null, fin_p: null }),
    parcel(4, { nb_colis: 1, statut: 'paye', devis_total: 120, devis_snapshot: savedQuote({ om: 12, omr: 3, tva: 9.45, total: 120 }), paiement_montant: 120, paiement_date: '2026-10-03T08:00:00Z', final_packages: [box(40, 30, 20, 5)], envoi_id: DEPARTURE.second }),
    parcel(5, { nb_colis: 1, devis_total: 50, final_packages: [box(30, 20, 20, 2)], envoi_id: DEPARTURE.second }),
    parcel(6, { nb_colis: 1, client_id: PRO, devis_total: 40, devis_snapshot: savedQuote({ om: 0, omr: 0, tva: 0, total: 40 }, { client: 'pro' }), final_packages: [box(30, 20, 20, 1)], envoi_id: DEPARTURE.first }),
  ];
  // A long working list: more measured dossiers, nothing to add up but their cartons.
  for (let n = 0; n < (options.more || 0); n++) f.tables.colis.push(parcel(100 + n, { ref: `EXP-LONG${100 + n}`, nb_colis: 1, statut: 'mesure', feu_vert: 'en_attente', quote_version: 0, devis_envoye_le: null, preparation_composition_version: null, final_measurements_version: null, outgoing_parcel_count: 0, final_packages: [], fin_l: null, fin_w: null, fin_h: null, fin_p: null }));
  const invoice = structuredClone(f.tables.factures[0]), line = structuredClone(f.tables.lignes[0]);
  f.tables.factures = f.tables.colis.map((row, index) => ({ ...invoice, id: `totals-invoice-${index}`, colis_id: row.id }));
  f.tables.lignes = f.tables.colis.map((row, index) => ({ ...line, id: `totals-line-${index}`, colis_id: row.id, facture_id: `totals-invoice-${index}` }));
  f.tables.envois = [
    { id: DEPARTURE.first, ref: 'DEP-TOT-01', destination_code: '974', date_depart: '2099-10-15', statut: 'planifie', updated_at: '2026-10-01T08:00:00Z' },
    { id: DEPARTURE.second, ref: 'DEP-TOT-02', destination_code: '974', date_depart: '2099-10-22', statut: 'planifie', updated_at: '2026-10-01T08:00:00Z' },
  ];
  f.before = structuredClone(f.tables.colis);
  return f;
}

async function open(f, query = '') {
  await f.page.goto(`${base}/colis${query ? `?${query}` : ''}`);
  await f.page.getByLabel('Rechercher ou scanner un colis', { exact: true }).waitFor();
  await f.page.locator('[data-dossier-row]:visible, [data-dossier-card]:visible').first().waitFor();
}
const SCROLLER = '#dossier-table-scroll';
const FOOT = 'table.dossier-data-table > tfoot > tr';
const subtotalRow = key => `table.dossier-data-table > tbody > tr[data-dossier-subtotal="${key}"]`;
const dossierCell = (f, n, key) => f.page.locator(`tr[data-dossier-row="${T(n)}"] > td[data-column="${key}"]`);
const countStatus = (f, count) => f.page.locator('.dossier-meta-count').filter({ hasText: new RegExp(`^${count} dossiers?$`) });
const ALL = [1, 2, 3, 4, 5, 6].map(T);

/** Installed in the page: a row of totals as shown and as read by assistive technology. */
function installTotalsReader() {
  const clean = text => String(text || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  const shown = node => { const copy = node.cloneNode(true); copy.querySelectorAll('.sr-only').forEach(item => item.remove()); return clean(copy.textContent); };
  window.__pintaTotalRow = selector => {
    const row = document.querySelector(selector);
    if (!row) return null;
    const label = row.querySelector(':scope > th[scope="row"]');
    const cells = {};
    for (const cell of row.querySelectorAll(':scope > td[data-total-column]')) {
      if (cell.dataset.totalColumn === 'select') continue;
      const value = cell.querySelector('.dossier-table-total-value, .dossier-table-placeholder');
      cells[cell.dataset.totalColumn] = value ? { text: clean(value.textContent), note: clean(cell.querySelector('.dossier-table-total-note')?.textContent), description: clean(cell.querySelector('.sr-only')?.textContent) } : clean(cell.textContent) || null;
    }
    return { label: label && shown(label), labelColumn: label?.dataset.totalColumn, spoken: label && clean(label.textContent), cells, select: clean(row.querySelector(':scope > [data-total-column="select"]')?.textContent), headingLike: row.querySelectorAll('[data-column]').length,
      controls: row.querySelectorAll('button, a[href], input, select, textarea, [tabindex]').length, height: row.getBoundingClientRect().height };
  };
}
const totalRow = (f, selector = FOOT) => f.page.evaluate(selector => window.__pintaTotalRow(selector), selector);
const cellTotals = (row, keys) => Object.fromEntries(keys.map(key => [key, row.cells[key]]));
const value = (text, note = '', description = '') => ({ text, note, description });
const partial = (text, known, count) => value(text, `${known} sur ${count} dossiers`, `Total de ${known} ${known > 1 ? 'dossiers' : 'dossier'} sur ${count} ; ${count - known} sans valeur.`);
const NONE = value('Non renseigné');
/** Waits until a row of totals reads `expected` (labels and cells), then compares, so a failure shows the difference. */
async function expectTotals(f, selector, expected) {
  const read = () => totalRow(f, selector).then(row => row && { label: row.label, ...cellTotals(row, Object.keys(expected).filter(key => key !== 'label')) });
  for (const until = Date.now() + 5000; Date.now() < until;) {
    if (JSON.stringify(await read()) === JSON.stringify(expected)) break;
    await f.page.waitForTimeout(50);
  }
  assert.deepEqual(await read(), expected);
}
// What the six dossiers add up to (see the fixture).
const DAILY_TOTAL = { label: 'Total · 6 dossiers', cartons: value('9'), optimizedDimensions: partial('25,2 kg vol.', 5, 6), optimizedWeight: partial('14,75', 5, 6), requested: partial('393,47 €', 5, 6), taxes: partial('57,12 €', 4, 6) };

async function selectTab(f, label, view) {
  await f.page.locator('[aria-label="Vues du tableau"]').getByRole('button', { name: label, exact: true }).click();
  await f.page.waitForURL(url => (url.searchParams.get('table') || 'daily') === view);
}
const displayDialog = f => f.page.getByRole('dialog', { name: 'Affichage', exact: true });
async function openDisplay(f) {
  const dialog = displayDialog(f);
  if (!await dialog.isVisible().catch(() => false)) await f.page.getByRole('button', { name: 'Affichage', exact: true }).click();
  await dialog.waitFor(); return dialog;
}
async function closeDisplay(f) {
  const dialog = displayDialog(f);
  if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Fermer l’affichage', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); }
}
async function download(f, count) {
  const display = await openDisplay(f); const pending = f.page.waitForEvent('download');
  await display.getByRole('button', { name: `Exporter ${count} dossiers filtrés`, exact: true }).click();
  const file = await pending; assert.equal(await file.failure(), null); await closeDisplay(f);
  return XLSX.read(await fs.readFile(await file.path()), { type: 'buffer', cellNF: true }).Sheets.Dossiers;
}
async function filterColumn(f, key, mode, text) {
  await f.page.locator(`th[data-column="${key}"] .dossier-table-filter`).click();
  const dialog = f.page.getByRole('dialog', { name: /^Filtrer / }); await dialog.waitFor();
  const condition = dialog.getByRole('combobox', { name: /^Condition pour / });
  const label = (await condition.getAttribute('aria-label')).slice('Condition pour '.length);
  await condition.selectOption(mode);
  if (text !== undefined) await dialog.getByLabel(`Filtrer : ${label}`, { exact: true }).fill(text);
  await dialog.getByRole('button', { name: 'Appliquer le filtre', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}
/** Contrast of a text over its painted background (every ancestor composited). */
function installContrast() {
  const rgba = value => { const n = value.match(/[\d.]+/g)?.map(Number) || []; return n.length >= 3 ? [...n.slice(0, 3), n[3] ?? 1] : [0, 0, 0, 0]; };
  const over = (fg, bg) => [...fg.slice(0, 3).map((channel, i) => channel * fg[3] + bg[i] * (1 - fg[3])), 1];
  const background = element => { const chain = []; for (let n = element; n && n.nodeType === 1; n = n.parentElement) chain.push(rgba(getComputedStyle(n).backgroundColor)); return chain.reverse().reduce((bg, color) => over(color, bg), [255, 255, 255, 1]); };
  const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  window.__pintaInk = element => { const bg = background(element); return contrast(over(rgba(getComputedStyle(element).color), bg), bg); };
}
/** The lowest contrast and the smallest size of the totals' texts shown. */
const totalsInk = f => f.page.evaluate(() => {
  const parts = [...document.querySelectorAll('.dossier-table-total-label, .dossier-table-total-value, .dossier-table-total-note, .dossier-table-total-row .dossier-table-placeholder, .dossier-group-totals, .dossier-group-total-value, .dossier-card-total-title, .dossier-card-total dt, .dossier-card-total dd > *')]
    .filter(node => node.getClientRects().length && node.textContent.trim());
  return { count: parts.length, contrast: Math.min(...parts.map(node => window.__pintaInk(node))), size: Math.min(...parts.map(node => parseFloat(getComputedStyle(node).fontSize))) };
});

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, options = {}) {
    if (process.env.PINTA_DOSSIER_TOTALS_FILTER && !name.includes(process.env.PINTA_DOSSIER_TOTALS_FILTER)) return;
    const f = await fixture(browser, options);
    await f.context.addInitScript(installTotalsReader); await f.context.addInitScript(installContrast);
    try {
      await f.login(); await run(f);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
      assert.deepEqual(businessWrites(f), [], 'Totals never write.');
      assert.deepEqual(f.tables.colis, f.before, 'No dossier changed.');
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
      await f.page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {});
      await fs.writeFile(`${output}/${name}-failure.txt`, await f.page.locator('body').innerText().catch(() => ''));
    } finally { await f.context.close(); console.log(JSON.stringify(results.at(-1))); }
  }
  try {
    // ── The total of the displayed dossiers, and « Taxes calculées » of each one ──────────────
    for (const width of [1440, 1280]) for (const dark of [false, true]) await scenario(`the-total-row-adds-up-the-displayed-dossiers-and-each-dossier-shows-its-taxes-${width}-${dark ? 'dark' : 'light'}`, async f => {
      await f.page.setViewportSize(sizeOf(width)); await theme(f, dark); await open(f); await waitTheme(f, dark);
      await countStatus(f, 6).waitFor();
      await expectTotals(f, FOOT, DAILY_TOTAL);
      const row = await totalRow(f);
      // One cell per column, in the first column its label; nothing to select, open or take.
      assert.equal(row.labelColumn, 'ref');
      assert.deepEqual(Object.keys(row.cells), ['client', 'receivedAt', 'statusLabel', 'paymentState', 'statut', 'owner', 'casier', 'cartons', 'optimizedDimensions', 'optimizedWeight', 'requested', 'taxes', 'action']);
      for (const key of ['client', 'receivedAt', 'statusLabel', 'paymentState', 'statut', 'owner', 'casier', 'action']) assert.equal(row.cells[key], null, `${key}: no total for text or dates.`);
      assert.deepEqual([row.select, row.controls], ['', 0]);
      assert.equal(row.headingLike, 0, 'Its cells never pass for a heading or a dossier cell ([data-column]).');
      assert.equal(await f.page.locator('tr[data-dossier-row]').count(), 6, 'The total is not a dossier.');
      // The widths of the columns: the total's cells line up with the headings.
      const misaligned = await f.page.evaluate(() => [...document.querySelectorAll('thead th[data-column]')].filter(th => {
        const cell = document.querySelector(`tfoot [data-total-column="${th.dataset.column}"]`), a = th.getBoundingClientRect(), b = cell?.getBoundingClientRect();
        return !b || Math.abs(a.left - b.left) > 1 || Math.abs(a.width - b.width) > 1;
      }).map(th => th.dataset.column));
      assert.deepEqual(misaligned, []);
      // « Taxes calculées » right after the price: the saved quote's own taxes, with the price's state.
      const headings = await f.page.locator('thead th[data-column]').evaluateAll(nodes => nodes.map(node => node.dataset.column));
      assert.equal(headings[headings.indexOf('requested') + 1], 'taxes');
      assert.equal(await f.page.locator('thead th[data-column="taxes"]').getAttribute('data-column-label'), 'Taxes calculées');
      const taxes = n => dossierCell(f, n, 'taxes').innerText().then(plain);
      assert.deepEqual(await Promise.all([1, 2, 3, 4, 5, 6].map(taxes)), ['20,00 €', '12,67 €\nBrouillon', 'À calculer', '24,45 €', 'À vérifier', 'Sans taxes (pro)']);
      assert.deepEqual(await Promise.all([1, 2, 3, 4, 5, 6].map(n => dossierCell(f, n, 'requested').innerText().then(plain))), ['100,00 €', '83,47 €\nBrouillon', 'À calculer', '120,00 €', '50,00 €', '40,00 €']);
      // The numbers line up on the right like their column; the incomplete note is read as a sentence.
      assert.equal(await f.page.locator('tfoot td[data-total-column="taxes"]').evaluate(node => getComputedStyle(node).textAlign), 'right');
      assert.equal(await f.page.locator('tfoot td[data-total-column="taxes"] .sr-only').textContent(), 'Total de 4 dossiers sur 6 ; 2 sans valeur.');
      assert.equal(await f.page.locator('tfoot td[data-total-column="taxes"] .dossier-table-total-note').getAttribute('aria-hidden'), 'true');
      await f.page.getByRole('rowheader', { name: 'Total · 6 dossiers', exact: true }).waitFor();
      const ink = await totalsInk(f);
      assert.ok(ink.count >= 6 && ink.contrast >= 4.5 && ink.size >= 11, `Readable totals: ${JSON.stringify(ink)}`);
      await axeClean(f, 'table.dossier-data-table');
      await f.page.locator(SCROLLER).evaluate(node => { node.scrollLeft = node.scrollWidth; });
      await f.page.waitForFunction(() => document.querySelector('.dossier-list-main')?.dataset.moreRight === undefined);
      await f.page.screenshot({ path: `${output}/total-daily-${width}-${dark ? 'dark' : 'light'}.png` });
      await selectTab(f, 'Paiements', 'payments');
      // Beside « Demandé », the taxes of the amount asked: the draft EXP-TOT002 asks nothing yet, so its taxes read
      // « À calculer » like its « Demandé », and both totals add up the same dossiers (EXP-TOT005: « À vérifier »).
      await expectTotals(f, FOOT, { label: 'Total · 6 dossiers', requested: partial('310,00 €', 4, 6), taxes: partial('44,45 €', 3, 6), paid: value('120,00 €'), remaining: partial('190,00 €', 4, 6), sentAt: null });
      const paymentHeadings = await f.page.locator('thead th[data-column]').evaluateAll(nodes => nodes.map(node => node.dataset.column));
      assert.deepEqual(paymentHeadings.slice(paymentHeadings.indexOf('requested'), paymentHeadings.indexOf('requested') + 3), ['requested', 'taxes', 'paid'], '« Taxes » right after « Demandé ».');
      assert.deepEqual(await Promise.all([1, 2, 3, 4, 5, 6].map(n => Promise.all(['requested', 'taxes'].map(key => dossierCell(f, n, key).innerText().then(plain))))),
        [['100,00 €', '20,00 €'], ['À calculer', 'À calculer'], ['À calculer', 'À calculer'], ['120,00 €', '24,45 €'], ['50,00 €', 'À vérifier'], ['40,00 €', 'Sans taxes (pro)']]);
      await f.page.screenshot({ path: `${output}/total-payments-${width}-${dark ? 'dark' : 'light'}.png` });
      await selectTab(f, 'Accords clients', 'accords');
      await f.page.locator('thead th[data-column="consentState"]').waitFor();
      assert.equal(await f.page.locator('thead th[data-column="taxes"]').count(), 0, 'No taxes in « Accords clients ».');
    });

    // ── What is displayed: filters, the search and the tabs change the totals; a sort never does ──
    await scenario('a-filter-the-search-and-a-step-change-the-totals-a-sort-never-does', async f => {
      await open(f); await expectTotals(f, FOOT, DAILY_TOTAL);
      for (const [key, direction] of [['requested', 'desc'], ['ref', 'asc'], ['taxes', 'asc']]) {
        await f.page.goto(`${base}/colis?sort=${key}&dir=${direction}`);
        await f.page.locator(`th[data-column="${key}"][aria-sort="${direction === 'desc' ? 'descending' : 'ascending'}"]`).waitFor();
        await expectTotals(f, FOOT, DAILY_TOTAL);
      }
      // Sorted on the price, the rows did move.
      await f.page.goto(`${base}/colis?sort=requested&dir=desc`); await f.page.locator('th[data-column="requested"][aria-sort="descending"]').waitFor();
      assert.deepEqual(await f.page.locator('tr[data-dossier-row]').evaluateAll(nodes => nodes.map(node => node.dataset.dossierRow)), [T(4), T(1), T(2), T(5), T(6), T(3)]);
      await expectTotals(f, FOOT, DAILY_TOTAL);
      // A column filter: the price from 60 €.
      await filterColumn(f, 'requested', 'min', '60'); await countStatus(f, 3).waitFor();
      await expectTotals(f, FOOT, { label: 'Total des 3 dossiers filtrés', cartons: value('4'), optimizedDimensions: value('20,4 kg vol.'), optimizedWeight: value('11,75'), requested: value('303,47 €'), taxes: value('57,12 €') });
      await f.page.getByRole('button', { name: 'Retirer les filtres', exact: true }).click(); await countStatus(f, 6).waitFor();
      await expectTotals(f, FOOT, DAILY_TOTAL);
      // The search: the professional client alone, whose quote has no tax.
      await f.page.getByLabel('Rechercher ou scanner un colis', { exact: true }).fill('Lagon'); await countStatus(f, 1).waitFor();
      await expectTotals(f, FOOT, { label: 'Total du dossier filtré', cartons: value('1'), optimizedDimensions: value('2,4 kg vol.'), optimizedWeight: value('1'), requested: value('40,00 €'), taxes: value('0,00 €') });
      await f.page.getByRole('button', { name: 'Effacer la recherche', exact: true }).click(); await countStatus(f, 6).waitFor();
      // A step of the journey: the quotes awaiting payment.
      await f.page.goto(`${base}/colis?tab=paiement`); await countStatus(f, 3).waitFor();
      await expectTotals(f, FOOT, { label: 'Total des 3 dossiers filtrés', cartons: value('4'), requested: value('190,00 €'), taxes: partial('20,00 €', 2, 3) });
      // « Mes tâches » narrows the list too: nobody took a task here, so the list is empty, and so are the totals.
      await f.page.goto(`${base}/colis?tasks=mine`);
      await f.page.getByText('Aucune tâche ne vous est attribuée dans cette sélection.', { exact: true }).waitFor();
      assert.equal(await f.page.locator('table.dossier-data-table').count(), 0);
      assert.equal(await f.page.locator('[data-dossier-total], tfoot').count(), 0, 'No dossier, no total.');
    });

    await scenario('a-dossier-updated-meanwhile-changes-the-totals', async f => {
      await open(f); await expectTotals(f, FOOT, DAILY_TOTAL);
      // EXP-TOT005's quote saved again by a colleague: its taxes are now known.
      const updated = f.tables.colis.find(row => row.id === T(5));
      Object.assign(updated, { devis_snapshot: savedQuote({ om: 4, omr: 1, tva: 2.5, total: 50 }), updated_at: '2026-10-08T09:00:00Z' });
      f.before = structuredClone(f.tables.colis);
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expectTotals(f, FOOT, { ...DAILY_TOTAL, taxes: partial('64,62 €', 5, 6) });
      assert.equal(plain(await dossierCell(f, 5, 'taxes').innerText()), '7,50 €');
    });

    // ── Grouped by departure: a subtotal closes each group, folded or not ──────────────────────
    const GROUPS = [
      { key: DEPARTURE.first, title: 'Départ du jeudi 15 octobre 2099 · Réunion', context: 'Départ du jeudi 15 octobre 2099 · Réunion · DEP-TOT-01', ids: [1, 2, 6],
        totals: { label: 'Sous-total · 3 dossiers', packages: value('4'), optimizedDimensions: value('18 kg vol.'), optimizedWeight: value('7,75'), requested: value('223,47 €'), taxes: value('32,67 €') } },
      { key: DEPARTURE.second, title: 'Départ du jeudi 22 octobre 2099 · Réunion', context: 'Départ du jeudi 22 octobre 2099 · Réunion · DEP-TOT-02', ids: [4, 5],
        totals: { label: 'Sous-total · 2 dossiers', packages: value('2'), optimizedDimensions: value('7,2 kg vol.'), optimizedWeight: value('7'), requested: value('170,00 €'), taxes: partial('24,45 €', 1, 2) } },
      { key: 'none', title: 'Sans départ affecté', context: 'Sans départ affecté', ids: [3],
        totals: { label: 'Sous-total · 1 dossier', packages: NONE, optimizedDimensions: NONE, optimizedWeight: NONE, requested: NONE, taxes: NONE } },
    ];
    const DEPARTURES_TOTAL = { label: 'Total · 6 dossiers', packages: partial('6', 5, 6), optimizedDimensions: partial('25,2 kg vol.', 5, 6), optimizedWeight: partial('14,75', 5, 6), requested: partial('393,47 €', 5, 6), taxes: partial('57,12 €', 4, 6) };
    /** The body of the table in screen order: group headings, dossiers and subtotals. */
    const bodyOrder = f => f.page.evaluate(() => [...document.querySelector('table.dossier-data-table').tBodies[0].rows].map(row => row.dataset.dossierGroup ? `group:${row.dataset.dossierGroup}` : row.dataset.dossierRow ? `dossier:${row.dataset.dossierRow}` : row.dataset.dossierSubtotal ? `subtotal:${row.dataset.dossierSubtotal}` : 'other'));
    for (const dark of [false, true]) await scenario(`grouped-by-departure-a-subtotal-closes-each-group-and-stays-when-it-is-folded-1440-${dark ? 'dark' : 'light'}`, async f => {
      await f.page.setViewportSize(sizeOf(1440)); await theme(f, dark); await open(f, 'table=departures'); await waitTheme(f, dark);
      for (const group of GROUPS) await expectTotals(f, subtotalRow(group.key), group.totals);
      await expectTotals(f, FOOT, DEPARTURES_TOTAL);
      // Each group: its heading, its dossiers, then its subtotal; the subtotals are not dossiers.
      const order = await bodyOrder(f);
      assert.deepEqual(order.filter(item => !item.startsWith('dossier:')), GROUPS.flatMap(group => [`group:${group.key}`, `subtotal:${group.key}`]));
      for (const group of GROUPS) {
        const at = order.indexOf(`group:${group.key}`);
        assert.deepEqual(order.slice(at + 1, at + 1 + group.ids.length).map(item => item.slice('dossier:'.length)).sort(), group.ids.map(T).sort());
        assert.equal(order[at + 1 + group.ids.length], `subtotal:${group.key}`);
        // Assistive technology hears the group's title with the subtotal.
        await f.page.getByRole('rowheader', { name: `${group.totals.label} · ${group.context}`, exact: true }).waitFor();
      }
      await countStatus(f, 6).waitFor();
      assert.equal(await f.page.locator('tr[data-dossier-row]').count(), 6);
      // In the narrow reference column a label wraps between « Sous-total · » and « 3 dossiers », never inside them.
      const parts = await f.page.locator('tr[data-dossier-subtotal] th[scope="row"] .dossier-nowrap').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, lines: new Set([...node.getClientRects()].map(rect => Math.round(rect.top))).size })));
      assert.deepEqual(parts.filter(part => part.lines !== 1), []);
      assert.deepEqual(parts.map(part => part.text.replace(/[\u00a0\u202f]/g, ' ')), ['Sous-total ·', '3 dossiers', 'Sous-total ·', '2 dossiers', 'Sous-total ·', '1 dossier']);
      // The subtotal rows hold no control: nothing to select or open.
      assert.equal(await f.page.locator('tr[data-dossier-subtotal] :is(button, a, input, select, [tabindex])').count(), 0);
      await f.page.locator(SCROLLER).evaluate(node => { node.scrollLeft = node.scrollWidth; });
      await f.page.waitForFunction(() => document.querySelector('.dossier-list-main')?.dataset.moreRight === undefined);
      await f.page.screenshot({ path: `${output}/subtotals-departures-1440-${dark ? 'dark' : 'light'}.png` });
      await axeClean(f, 'table.dossier-data-table');
      // Folding the first group leaves its subtotal right under its heading.
      await f.page.getByRole('button', { name: GROUPS[0].title, exact: true }).click();
      await f.page.waitForFunction(id => !document.querySelector(`tr[data-dossier-row="${id}"]`), T(1));
      const folded = await bodyOrder(f);
      assert.deepEqual(folded.slice(0, 3), [`group:${GROUPS[0].key}`, `subtotal:${GROUPS[0].key}`, `group:${GROUPS[1].key}`]);
      await expectTotals(f, subtotalRow(GROUPS[0].key), GROUPS[0].totals);
      // Every group folded: one line per departure with its weight, taxes and amounts; the total keeps every dossier.
      for (const group of GROUPS.slice(1)) await f.page.getByRole('button', { name: group.title, exact: true }).click();
      await f.page.waitForFunction(() => !document.querySelector('tr[data-dossier-row]'));
      assert.deepEqual(await bodyOrder(f), GROUPS.flatMap(group => [`group:${group.key}`, `subtotal:${group.key}`]));
      for (const group of GROUPS) await expectTotals(f, subtotalRow(group.key), group.totals);
      await expectTotals(f, FOOT, DEPARTURES_TOTAL);
      await countStatus(f, 6).waitFor();
      await f.page.screenshot({ path: `${output}/subtotals-folded-1440-${dark ? 'dark' : 'light'}.png` });
      // The export of a grouped list: the dossiers only, in screen order, then the total; no subtotal among them.
      const sheet = await download(f, 6);
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      const onScreen = order.filter(item => item.startsWith('dossier:')).map(item => `EXP-TOT00${ALL.indexOf(item.slice('dossier:'.length)) + 1}`);
      assert.deepEqual(data.slice(1, 7).map(line => line[0]), onScreen, 'The dossiers in screen order, group by group.');
      assert.ok(data[7].every(cell => cell === null)); assert.equal(data[8][0], 'Total'); assert.equal(data.length, 9);
      assert.doesNotMatch(JSON.stringify(data), /Sous-total|Départ du jeudi/);
    });

    // ── Permissions: without the amounts, no taxes column and no financial total ──────────────
    await scenario('a-role-without-the-amounts-sees-no-taxes-column-and-no-financial-total', async f => {
      await open(f);
      await expectTotals(f, FOOT, { label: 'Total · 6 dossiers', cartons: value('9'), optimizedDimensions: partial('25,2 kg vol.', 5, 6), optimizedWeight: partial('14,75', 5, 6) });
      const row = await totalRow(f);
      assert.equal(Object.hasOwn(row.cells, 'requested') || Object.hasOwn(row.cells, 'taxes'), false);
      assert.equal(await f.page.locator('th[data-column="taxes"], th[data-column="requested"], td[data-column="taxes"], [data-total-column="taxes"], [data-total-column="requested"]').count(), 0);
      assert.doesNotMatch(await f.page.locator('table.dossier-data-table').innerText(), /€/);
      // A forced price filter or sort neither shows nor hides anything.
      await f.page.goto(`${base}/colis?sort=taxes&dir=desc&${new URLSearchParams({ 'col.taxes': JSON.stringify({ mode: 'min', value: '1' }) })}`);
      await f.page.waitForURL(url => !url.searchParams.has('col.taxes') && !url.searchParams.has('sort'));
      await countStatus(f, 6).waitFor();
      const sheet = await download(f, 6);
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      assert.equal(data[0].includes('Taxes calculées'), false); assert.equal(data[0].includes('Prix du devis'), false);
      assert.equal(data[8][0], 'Total'); assert.doesNotMatch(JSON.stringify(data), /393|57\.12|83\.47/);
    }, { restricted: true });

    // ── A long list: the total stays pinned at the bottom; the keyboard never lands under it ──
    for (const width of [1280, 1440]) await scenario(`the-total-stays-at-the-bottom-of-a-long-list-and-keyboard-focus-never-hides-under-it-${width}`, async f => {
      await f.page.setViewportSize(sizeOf(width)); await open(f); await countStatus(f, 36).waitFor();
      await expectTotals(f, FOOT, { ...DAILY_TOTAL, label: 'Total · 36 dossiers', cartons: value('39'), optimizedDimensions: partial('25,2 kg vol.', 5, 36), optimizedWeight: partial('14,75', 5, 36), requested: partial('393,47 €', 5, 36), taxes: partial('57,12 €', 4, 36) });
      const scroller = f.page.locator(SCROLLER);
      const geometry = () => f.page.evaluate(() => {
        const scroll = document.getElementById('dossier-table-scroll'), view = scroll.getBoundingClientRect(), foot = document.querySelector('tfoot th[scope="row"]').getBoundingClientRect();
        const label = document.querySelector('tfoot th[scope="row"]'), box = label.getBoundingClientRect();
        const under = [...document.querySelectorAll('tr[data-dossier-row]')].some(row => { const r = row.getBoundingClientRect(); return r.top < foot.top && r.bottom > foot.top + 1; });
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { bottom: Math.round(view.top + scroll.clientHeight), footBottom: Math.round(foot.bottom), footTop: foot.top, labelLeft: Math.round(box.left), opaque: Boolean(hit && label.contains(hit)), under, top: scroll.scrollTop, max: scroll.scrollHeight - scroll.clientHeight };
      });
      await scroller.evaluate(node => { node.scrollTop = 0; });
      let state = await geometry();
      assert.ok(state.max > 400, 'A list longer than the screen.');
      assert.ok(Math.abs(state.footBottom - state.bottom) <= 1 && state.under && state.opaque, `Pinned at the bottom over the rows: ${JSON.stringify(state)}`);
      await scroller.evaluate(node => { node.scrollTop = Math.round((node.scrollHeight - node.clientHeight) / 2); });
      await f.page.waitForFunction(() => document.getElementById('dossier-table-scroll').scrollTop > 0);
      state = await geometry();
      assert.ok(Math.abs(state.footBottom - state.bottom) <= 1 && state.under && state.opaque, `Still there midway: ${JSON.stringify(state)}`);
      // Scrolled sideways, its label stays pinned with the reference column.
      const left = state.labelLeft;
      await scroller.evaluate(node => { node.scrollLeft = 300; }); await f.page.waitForFunction(() => document.getElementById('dossier-table-scroll').scrollLeft >= 299);
      assert.equal((await geometry()).labelLeft, left);
      await scroller.evaluate(node => { node.scrollLeft = 0; });
      await f.page.screenshot({ path: `${output}/pinned-total-long-list-${width}.png` });
      // A row brought into view by a script (or a test robot) stops above the total, not under it.
      await scroller.evaluate(node => { node.scrollTop = 0; });
      const placed = await f.page.evaluate(() => {
        const target = document.querySelectorAll('tr[data-dossier-row]')[20].querySelector('input[type="checkbox"]');
        target.scrollIntoView({ block: 'nearest' });
        const box = target.getBoundingClientRect(), foot = document.querySelector('tfoot th[scope="row"]').getBoundingClientRect();
        return { bottom: Math.round(box.bottom), footTop: Math.round(foot.top), scrolled: document.getElementById('dossier-table-scroll').scrollTop > 0 };
      });
      assert.ok(placed.scrolled && placed.bottom <= placed.footTop + 1, `Above the pinned total: ${JSON.stringify(placed)}`);
      // The keyboard: every control the Tab key reaches shows whole, above the pinned total.
      await scroller.evaluate(node => { node.scrollTop = 0; });
      await scroller.focus();
      const hidden = [];
      let moved = 0, previousTop = 0, stops = 0;
      for (let i = 0; i < 90; i++) {
        await f.page.keyboard.press('Tab');
        const stop = await f.page.evaluate(() => {
          const scroll = document.getElementById('dossier-table-scroll'), el = document.activeElement;
          if (!el || el === scroll || !scroll.contains(el)) return null;
          const r = el.getBoundingClientRect(), foot = document.querySelector('tfoot th[scope="row"]').getBoundingClientRect();
          const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
          // The focus ring (3 px away, 2 px wide) and some air stay clear of the pinned total.
          return { name: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 40), clear: r.bottom <= foot.top - 7, shows: Boolean(hit && (hit === el || el.contains(hit) || (hit.tagName === 'LABEL' && hit.contains(el)))), top: scroll.scrollTop };
        });
        if (!stop) break;
        stops++;
        if (!stop.clear || !stop.shows) hidden.push(stop.name);
        if (stop.top !== previousTop) moved++;
        previousTop = stop.top;
      }
      assert.ok(stops >= 60, `${stops} stops.`);
      assert.ok(moved > 0, 'The list scrolled down under the keyboard.');
      assert.deepEqual(hidden, [], 'No focused control under the pinned total.');
      // Back up with Shift+Tab from the end of the list.
      await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await f.page.locator('tbody tr[data-dossier-row]').last().locator('td[data-column="action"] button').focus();
      for (let i = 0; i < 40; i++) {
        await f.page.keyboard.press('Shift+Tab');
        const stop = await f.page.evaluate(() => {
          const scroll = document.getElementById('dossier-table-scroll'), el = document.activeElement;
          if (!el || el === scroll || !scroll.contains(el)) return null;
          const r = el.getBoundingClientRect(), foot = document.querySelector('tfoot th[scope="row"]').getBoundingClientRect();
          return { name: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 40), clear: r.bottom <= foot.top - 7 };
        });
        if (!stop) break;
        if (!stop.clear) hidden.push(stop.name);
      }
      assert.deepEqual(hidden, [], 'Nor going back.');
      // A control already in view, its ring within reach of the total: the Tab key brings it 8 px clear.
      await scroller.evaluate(node => { node.scrollTop = 0; });
      await f.page.locator('tr[data-dossier-row]').nth(9).locator('td[data-column="action"] button').focus();
      const edge = await f.page.evaluate(() => {
        const scroll = document.getElementById('dossier-table-scroll'), target = document.querySelectorAll('tr[data-dossier-row]')[10].querySelector('input[type="checkbox"]');
        const foot = () => document.querySelector('tfoot th[scope="row"]').getBoundingClientRect().top;
        scroll.scrollTop += target.getBoundingClientRect().bottom - (foot() - 3);
        return { bottom: target.getBoundingClientRect().bottom, footTop: foot() };
      });
      assert.ok(Math.abs(edge.footTop - 3 - edge.bottom) <= 1, `Set 3 px above the total: ${JSON.stringify(edge)}`);
      await f.page.keyboard.press('Tab');
      const ring = await f.page.evaluate(() => {
        const el = document.activeElement;
        return { checkbox: el.matches('tr[data-dossier-row] input[type="checkbox"]'), gap: document.querySelector('tfoot th[scope="row"]').getBoundingClientRect().top - el.getBoundingClientRect().bottom };
      });
      assert.ok(ring.checkbox && ring.gap >= 7, `The focus ring clears the total: ${JSON.stringify(ring)}`);
      // While a selection shows its bar, the total ends the list, above the bar, never under it.
      await scroller.evaluate(node => { node.scrollTop = 0; });
      await f.page.getByRole('checkbox', { name: 'Sélectionner le dossier EXP-TOT001', exact: true }).check();
      const bar = f.page.getByRole('group', { name: 'Actions sur la sélection', exact: true }); await bar.waitFor();
      assert.equal(await f.page.locator('tfoot th[scope="row"]').evaluate(node => getComputedStyle(node).bottom), 'auto');
      await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await f.page.waitForFunction(() => { const s = document.getElementById('dossier-table-scroll'); return s.scrollTop >= s.scrollHeight - s.clientHeight - 1; });
      const clear = await f.page.evaluate(() => {
        const foot = document.querySelector('tfoot th[scope="row"]').getBoundingClientRect(), bar = document.querySelector('.dossier-bulk-bar').getBoundingClientRect(), label = document.querySelector('tfoot th[scope="row"]').getBoundingClientRect();
        const hit = document.elementFromPoint(label.left + label.width / 2, label.top + label.height / 2);
        return { above: foot.bottom <= bar.top, shows: Boolean(hit?.closest('tfoot')) };
      });
      assert.deepEqual(clear, { above: true, shows: true });
      await f.page.screenshot({ path: `${output}/total-with-selection-${width}.png` });
    }, { more: 30 });

    // The wide fallback font of the Linux CI: no total breaks inside its number.
    await scenario('a-total-never-breaks-inside-its-number-with-the-wide-ci-font-1280', async f => {
      await wideFont(f); await f.page.setViewportSize(sizeOf(1280)); await open(f, 'table=departures');
      await expectTotals(f, FOOT, DEPARTURES_TOTAL);
      const broken = await f.page.evaluate(() => [...document.querySelectorAll('.dossier-table-total-value')].filter(node => {
        const lines = new Set([...node.getClientRects()].map(rect => Math.round(rect.top))).size;
        const range = document.createRange(); range.selectNodeContents(node);
        return lines > 1 || new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size > 1;
      }).map(node => node.textContent));
      assert.deepEqual(broken, []);
      await f.page.locator(SCROLLER).evaluate(node => { node.scrollLeft = node.scrollWidth; });
      await f.page.screenshot({ path: `${output}/wide-font-departures-1280.png` });
    });

    // ── A tablet shows the table too: at the largest text the pinned total is taller than the 80 px kept there
    // for the bottom navigation, and what the browser scrolls into view (as for the focus) still stops above it. ──
    await scenario('on-a-tablet-at-the-largest-text-what-is-scrolled-into-view-stops-above-the-pinned-total-768', async f => {
      await f.page.setViewportSize({ width: 768, height: 1024 }); await open(f, 'table=departures'); await countStatus(f, 36).waitFor();
      const size = (await openDisplay(f)).getByRole('spinbutton', { name: 'Taille du texte des dossiers', exact: true });
      await size.fill('20'); await size.press('Enter'); await closeDisplay(f);
      const pinned = () => f.page.evaluate(() => {
        const scroll = document.getElementById('dossier-table-scroll'), label = document.querySelector('tfoot th[scope="row"]');
        const view = scroll.getBoundingClientRect(), foot = label.getBoundingClientRect(), height = Math.round(foot.height);
        return { tall: height > 80, room: parseFloat(getComputedStyle(scroll).scrollPaddingBottom) >= height, stuck: Math.abs(foot.bottom - (view.top + scroll.clientHeight)) <= 1 };
      });
      for (const until = Date.now() + 5000; Date.now() < until && !Object.values(await pinned()).every(Boolean);) await f.page.waitForTimeout(50);
      assert.deepEqual(await pinned(), { tall: true, room: true, stuck: true });
      const hidden = await f.page.evaluate(() => {
        const scroll = document.getElementById('dossier-table-scroll'), under = [];
        for (const box of [...document.querySelectorAll('tr[data-dossier-row] input[type="checkbox"]')].slice(3, 24)) {
          scroll.scrollTop = 0;
          box.scrollIntoView({ block: 'nearest' });
          if (box.getBoundingClientRect().bottom > document.querySelector('tfoot th[scope="row"]').getBoundingClientRect().top + 1) under.push(box.getAttribute('aria-label'));
        }
        return under;
      });
      assert.deepEqual(hidden, [], 'No row scrolled into view under the pinned total.');
      // The keyboard too: every control the Tab key reaches shows whole, above the total.
      await f.page.locator(SCROLLER).evaluate(node => { node.scrollTop = 0; });
      await f.page.locator(SCROLLER).focus();
      const covered = [];
      let rowStops = 0;
      for (let i = 0; i < 120 && rowStops < 30; i++) {
        await f.page.keyboard.press('Tab');
        const stop = await f.page.evaluate(() => {
          const scroll = document.getElementById('dossier-table-scroll'), el = document.activeElement;
          if (!el || el === scroll || !scroll.contains(el) || el.closest('thead')) return el && scroll.contains(el) ? { skip: true } : null;
          return { name: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 40), clear: el.getBoundingClientRect().bottom <= document.querySelector('tfoot th[scope="row"]').getBoundingClientRect().top - 7 };
        });
        if (!stop) break;
        if (stop.skip) continue;
        rowStops++;
        if (!stop.clear) covered.push(stop.name);
      }
      assert.ok(rowStops >= 30, `${rowStops} stops in the rows.`);
      assert.deepEqual(covered, []);
      await f.page.screenshot({ path: `${output}/pinned-total-tablet-768-text-20.png` });
    }, { more: 30, device: { hasTouch: true } });

    // ── Cards (phones): a subtotal under each group heading, a total block at the end ──────────
    for (const dark of [false, true]) await scenario(`cards-show-each-group-subtotal-and-end-with-the-total-390-${dark ? 'dark' : 'light'}`, async f => {
      await f.page.setViewportSize(sizeOf(390)); await theme(f, dark); await open(f, 'table=departures'); await waitTheme(f, dark);
      const lines = () => f.page.locator('.dossier-card-list [data-dossier-group]').evaluateAll(groups => groups.map(group => {
        const line = group.querySelector('[data-group-totals]'); const copy = line?.cloneNode(true); copy?.querySelectorAll('.sr-only').forEach(node => node.remove());
        // Read aloud: without what is hidden from assistive technology, with the sr-only sentences.
        const voice = line?.cloneNode(true); voice?.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
        return { key: group.dataset.dossierGroup, shown: copy?.textContent.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim(), spoken: voice?.textContent.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim() };
      }));
      await f.page.waitForFunction(() => document.querySelectorAll('.dossier-card-list [data-group-totals]').length === 3);
      assert.deepEqual((await lines()).map(({ key, shown }) => ({ key, shown })), [
        { key: DEPARTURE.first, shown: 'Colis 4 · Dimensions 18 kg vol. · Poids 7,75 kg · Prix 223,47 € · Taxes 32,67 €' },
        { key: DEPARTURE.second, shown: 'Colis 2 · Dimensions 7,2 kg vol. · Poids 7 kg · Prix 170,00 € · Taxes 24,45 € (1 sur 2 dossiers)' },
        { key: 'none', shown: 'Non renseigné : colis, dimensions, poids, prix, taxes' },
      ]);
      assert.equal((await lines())[1].spoken, 'Sous-total : Colis 2 Dimensions 7,2 kg vol. Poids 7 kg Prix 170,00 € Taxes 24,45 €, Total de 1 dossier sur 2 ; 1 sans valeur.');
      // The list ends with its total.
      const block = f.page.locator('[data-dossier-total]');
      assert.equal(await block.evaluate(node => node.parentElement.lastElementChild === node), true);
      assert.equal(plain(await block.locator('.dossier-card-total-title').innerText()), 'Total des 6 dossiers');
      assert.deepEqual(await block.locator('dl > div').evaluateAll(items => items.map(item => [item.querySelector('dt').textContent,
        [...item.querySelectorAll('dd .dossier-table-total-value, dd .dossier-table-total-note, dd .dossier-table-placeholder')].map(node => node.textContent.replace(/[\u00a0\u202f]/g, ' ').trim()).join('\n')])), [
        ['Colis à expédier', '6\n5 sur 6 dossiers'], ['Dimensions finales', '25,2 kg vol.\n5 sur 6 dossiers'], ['Poids final (kg)', '14,75\n5 sur 6 dossiers'], ['Prix du devis', '393,47 €\n5 sur 6 dossiers'], ['Taxes calculées', '57,12 €\n4 sur 6 dossiers'],
      ]);
      assert.equal(await f.page.locator('[data-dossier-card]').count(), 6, 'The total is not a card.');
      await noPageOverflow(f);
      const ink = await totalsInk(f);
      assert.ok(ink.contrast >= 4.5 && ink.size >= 12, `Readable: ${JSON.stringify(ink)}`);
      await axeClean(f, '.dossier-card-list');
      const list = f.page.locator('.dossier-list');
      await f.page.screenshot({ path: `${output}/cards-group-subtotal-390-${dark ? 'dark' : 'light'}.png` });
      await list.evaluate(node => { node.scrollTop = node.scrollHeight; }); await f.page.waitForTimeout(200);
      await f.page.screenshot({ path: `${output}/cards-total-390-${dark ? 'dark' : 'light'}.png` });
      // The largest text still wraps inside the screen.
      const size = (await openDisplay(f)).getByRole('spinbutton', { name: 'Taille du texte des dossiers', exact: true });
      await size.fill('20'); await size.press('Enter'); await closeDisplay(f);
      await f.page.waitForFunction(() => getComputedStyle(document.querySelector('.dossier-card-total')).fontSize === '20px');
      await noPageOverflow(f);
      const outside = await f.page.evaluate(() => [...document.querySelectorAll('.dossier-group-totals, .dossier-card-total, .dossier-card-total dd, .dossier-group-total-figure')].filter(node => { const r = node.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.left < -0.5; }).map(node => node.textContent.slice(0, 30)));
      assert.deepEqual(outside, []);
      await list.evaluate(node => { node.scrollTop = 0; }); await f.page.waitForTimeout(200);
      await f.page.screenshot({ path: `${output}/cards-group-subtotal-20px-390-${dark ? 'dark' : 'light'}.png` });
      // Filtered: « Total du dossier filtré » / « Total des … dossiers filtrés ».
      await f.page.getByLabel('Rechercher ou scanner un colis', { exact: true }).fill('Lagon'); await countStatus(f, 1).waitFor();
      await f.page.waitForFunction(() => document.querySelector('.dossier-card-total-title')?.textContent === 'Total du dossier filtré');
    }, { device: { hasTouch: true, isMobile: true } });
    await scenario('cards-without-groups-end-with-the-total-only-390', async f => {
      await f.page.setViewportSize(sizeOf(390)); await open(f);
      await f.page.locator('[data-dossier-total]').waitFor();
      assert.equal(await f.page.locator('[data-group-totals]').count(), 0);
      assert.equal(plain(await f.page.locator('.dossier-card-total-title').innerText()), 'Total des 6 dossiers');
      assert.deepEqual(await f.page.locator('[data-dossier-total] dt').allTextContents(), ['Cartons reçus', 'Dimensions finales', 'Poids final (kg)', 'Prix du devis', 'Taxes calculées']);
      await noPageOverflow(f);
    }, { device: { hasTouch: true, isMobile: true } });

    // ── The spreadsheet: « Taxes calculées » and a « Total » row that follows Excel's filters ──
    await scenario('the-export-has-the-taxes-and-a-subtotal-row-equal-to-the-screen-totals', async f => {
      await open(f); await expectTotals(f, FOOT, DAILY_TOTAL);
      const sheet = await download(f, 6);
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      const header = data[0], at = label => header.indexOf(label);
      assert.equal(header[at('Prix du devis') + 1], 'Taxes calculées');
      assert.deepEqual(data.slice(1, 7).map(line => line[0]), await f.page.locator('tr[data-dossier-row] .dossier-table-reference').allTextContents(), 'The dossiers in screen order.');
      assert.ok(data[7].every(cell => cell === null), 'One empty row.');
      assert.equal(data[8][0], 'Total'); assert.equal(data.length, 9);
      const total = label => sheet[XLSX.utils.encode_cell({ r: 8, c: at(label) })];
      for (const [label, cached] of [['Cartons reçus', 9], ['Poids final (kg)', 14.75], ['Prix du devis', 393.47], ['Taxes calculées', 57.12]]) {
        const name = XLSX.utils.encode_col(at(label));
        assert.deepEqual([total(label).f, total(label).v], [`SUBTOTAL(9,${name}2:${name}7)`, cached], label);
      }
      assert.deepEqual(sheet['!autofilter'], { ref: `A1:${XLSX.utils.encode_col(header.length - 1)}7` });
      const taxes = data.slice(1, 7).map(line => line[at('Taxes calculées')]);
      const byRef = Object.fromEntries(data.slice(1, 7).map((line, index) => [line[0], taxes[index]]));
      assert.deepEqual(byRef, { 'EXP-TOT001': 20, 'EXP-TOT002': 12.67, 'EXP-TOT003': 'À calculer', 'EXP-TOT004': 24.45, 'EXP-TOT005': 'À vérifier', 'EXP-TOT006': 0 });
      const row = ref => data.findIndex(line => line[0] === ref);
      assert.equal(sheet[XLSX.utils.encode_cell({ r: row('EXP-TOT006'), c: at('Taxes calculées') })].w, 'Sans taxes (pro)');
      assert.equal(sheet[XLSX.utils.encode_cell({ r: row('EXP-TOT002'), c: at('Taxes calculées') })].w, '12.67 € · Brouillon');
    });
  } finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
