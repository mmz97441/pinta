/* « Départs » page (/departs) and the pro monthly recap on Paris time.
 * Synthetic data on a fixed clock; setup() mocks every request, so nothing
 * reaches Supabase, Telegram or PayPlug.
 *
 * Fixture (extend it rather than adding another one):
 * - the browser clock is Wednesday 7 October 2026, 23:30 in Paris — already
 *   Thursday 8 at 01:30 in Réunion, still Wednesday 17:30 in New York;
 * - departures to prepare: 30 Sept and 3 Oct (overdue), today 7 Oct (no
 *   dossier), 15 Oct Réunion (one loadable dossier, three dossiers wishing that
 *   day), 16 Oct Mayotte (closing 9 h 30), 22 Oct Réunion (closing 17 h), 29 Oct
 *   Réunion (its closing has passed: closed); left: 1 Oct Guadeloupe (manifest
 *   confirmed 8 h 00 Paris), 24 Sept Martinique (arrived); archived: 10 Sept;
 * - dossiers: EXP-LOAD-1 on the 15 Oct departure (2 prepared parcels, 19,5 kg);
 *   EXP-WISH-1…3 wishing 15 Oct (Réunion, one paid); EXP-WISH-MAYOTTE and
 *   EXP-WISH-ARCHIVED wishing 15 Oct but not for it; EXP-WISH-CLOSED wishing the
 *   closed 29 Oct; EXP-SHIPPED on the 1 Oct departure; EXP-PRO-PAID paid at
 *   23:00 Paris on 30 September by a professional client;
 * - commercial invoice (commercialInvoiceFixture, added by its scenarios):
 *   EXP-LOAD-1 gets a saved quote (two articles, 122,50 € of transport),
 *   EXP-LOAD-PRO (Lagon Services SARL, paid, one parcel of 8 kg, its own article
 *   lines, 65 € of transport) and EXP-LOAD-WAIT (awaiting payment) join the
 *   15 Oct departure; EXP-SHIPPED's frozen manifest carries the same quote. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');
const XLSX = require('xlsx');
// The downloaded PDF is read back with pdf.js, as tests/commercial-invoice-export.test.mjs does.
const pdfjsReady = import('pdfjs-dist/legacy/build/pdf.mjs');
const STANDARD_FONTS = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
const output = process.env.PINTA_DEPARTURES_PAGE_OUT || '/tmp/pinta-departures-page';
const results = [];

const NOW = new Date('2026-10-07T21:30:00Z');
const ZONES = ['Europe/Paris', 'Indian/Reunion', 'America/New_York'];
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLIENT = { reunion: uuid('c2000000', 1), mayotte: uuid('c2000000', 2), pro: uuid('c2000000', 3) };
const DEPARTURE = {
  overdueOld: uuid('d2000000', 1), overdue: uuid('d2000000', 2), today: uuid('d2000000', 3), reunion15: uuid('d2000000', 4),
  mayotte16: uuid('d2000000', 5), reunion22: uuid('d2000000', 6), closed29: uuid('d2000000', 7), left: uuid('d2000000', 8),
  arrived: uuid('d2000000', 9), archived: uuid('d2000000', 10),
};
const DOSSIER = {
  load: uuid('e2000000', 1), wish1: uuid('e2000000', 2), wish2: uuid('e2000000', 3), wish3: uuid('e2000000', 4),
  wishMayotte: uuid('e2000000', 5), wishArchived: uuid('e2000000', 6), wishClosed: uuid('e2000000', 7), shipped: uuid('e2000000', 8), pro: uuid('e2000000', 9),
  loadPro: uuid('e2000000', 10), loadWait: uuid('e2000000', 11),
};
// What every device shows, whatever its time zone (Paris time).
const EXPECTED_PARIS = {
  // « À préparer »: overdue first (oldest first), then the coming ones.
  order: ['ENV-2026-030', 'ENV-2026-033', 'ENV-2026-037', 'ENV-2026-045', 'ENV-2026-046', 'ENV-2026-052', 'ENV-2026-059'],
  overdue: ['ENV-2026-030', 'ENV-2026-033'],
  closings: {
    'ENV-2026-030': 'Clôture habituelle : mercredi 23 septembre, 17 h (heure de Paris)',
    'ENV-2026-033': 'Clôture habituelle : mercredi 30 septembre, 17 h (heure de Paris)',
    'ENV-2026-037': 'Clôture habituelle : mercredi 30 septembre, 17 h (heure de Paris)',
    'ENV-2026-045': 'Clôture habituelle : mercredi 14 octobre, 17 h (heure de Paris)',
    'ENV-2026-046': 'Clôture : mercredi 14 octobre, 9 h 30 (heure de Paris)',
    'ENV-2026-052': 'Clôture : mercredi 21 octobre, 17 h (heure de Paris)',
    'ENV-2026-059': 'Clôture : mercredi 7 octobre, 12 h (heure de Paris) · chargement clôturé',
  },
  editPrefill: '2026-10-21T17:00',
  // A weekly series typed 17:00 Paris across the 25 October clock change.
  created: [['2026-10-22', '2026-10-21T15:00:00.000Z'], ['2026-10-29', '2026-10-28T16:00:00.000Z']],
  createdClosings: ['Clôture : mercredi 21 octobre, 17 h (heure de Paris)', 'Clôture : mercredi 28 octobre, 17 h (heure de Paris)'],
  manifest: 'Confirmé le jeudi 1er octobre, 8 h (heure de Paris) · 1 expédition · 2 colis physiques.',
  manifestLine: 'EXP-SHIPPED · 2 colis préparés · 19,5 kg',
  recap: { september: '1 dossier sur la période', october: '0 dossier sur la période', defaultMonth: '9' },
};
const PERMISSIONS = ['perm_colis_affecter_envoi', 'perm_colis_expedier', 'perm_envois_voir', 'perm_envois_creer', 'perm_envois_modifier', 'perm_envois_reaffecter', 'perm_export_colis', 'perm_export_factures', 'perm_export_dau', 'perm_clients_voir', 'perm_export_recap_pro'];
const only = (...granted) => Object.fromEntries(PERMISSIONS.map(key => [key, granted.includes(key)]));
const box = (dimL, dimW, dimH, poids) => ({ dimL, dimW, dimH, poids });
const OLD_WORDINGS = /Sans horaire de clôture|aucune urgence horaire|Horaire de clôture à préciser|heure locale|Aucun départ dans cette vue/;

async function fixture(browser, { role = 'directeur', width = 1440, height = width < 768 ? 844 : 1000, theme = 'light', timezoneId = null, permissions = null, failTable = null, empty = false } = {}) {
  const f = await setup(browser, role, { failTable, timezoneId });
  if (permissions) { const row = { staff_id: ids.S, ...permissions }; f.tables.staff_permissions = [row]; f.tables.staff_users[0].staff_permissions = [row]; }
  f.page.setDefaultTimeout(10000);
  await f.page.setViewportSize({ width, height });
  // Screens are compared at rest: no colour transition is caught half-way.
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  await f.page.clock.setFixedTime(NOW);
  f.server.now = () => NOW.getTime();
  await f.context.addInitScript(value => { try { localStorage.setItem('expedile-theme', value); } catch { /* the system theme applies */ } }, theme);
  const client = (id, fields) => ({ id, user_id: null, telegram_chat_id: null, type: 'particulier', abonnement: 'freemium', onboarded: true, created_at: '2026-09-01T08:00:00Z', ...fields });
  f.tables.clients = [
    client(CLIENT.reunion, { ref: 'CLI-PAGE-01', nom: 'Hoarau', prenom: 'Flavie', email: 'flavie@example.test', cp: '97400', ville: 'Saint-Denis', adresse_ligne1: '12 rue de Paris' }),
    client(CLIENT.mayotte, { ref: 'CLI-PAGE-02', nom: 'Madi', prenom: 'Anli', email: 'anli@example.test', cp: '97600', ville: 'Mamoudzou', adresse_ligne1: '1 place du Marché' }),
    client(CLIENT.pro, { ref: 'CLI-PAGE-03', nom: 'Lagon Services', prenom: '', type: 'pro', raison_sociale: 'Lagon Services', email: 'compta@lagon.example', cp: '97410', ville: 'Saint-Pierre', adresse_ligne1: '5 rue du Port', mode_paiement: 'fin_mois' }),
  ];
  const left = { statut: 'parti', manifest_version: 1, departed_at: '2026-10-01T06:00:45Z' };
  f.departure = (id, ref, date, code, fields = {}) => ({ id, ref, date_depart: date, destination_code: code, statut: 'planifie', mode_transport: 'aerien', loading_closes_at: null, departed_at: null, manifest_version: 0, nb_colis: 0, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z', ...fields });
  f.left = left;
  f.tables.envois = empty ? [] : [
    f.departure(DEPARTURE.reunion22, 'ENV-2026-052', '2026-10-22', '974', { loading_closes_at: '2026-10-21T15:00:00Z' }),
    f.departure(DEPARTURE.today, 'ENV-2026-037', '2026-10-07', '974'),
    f.departure(DEPARTURE.closed29, 'ENV-2026-059', '2026-10-29', '974', { loading_closes_at: '2026-10-07T10:00:00Z' }),
    f.departure(DEPARTURE.overdue, 'ENV-2026-033', '2026-10-03', '974'),
    f.departure(DEPARTURE.reunion15, 'ENV-2026-045', '2026-10-15', '974'),
    f.departure(DEPARTURE.mayotte16, 'ENV-2026-046', '2026-10-16', '976', { loading_closes_at: '2026-10-14T07:30:00Z' }),
    f.departure(DEPARTURE.overdueOld, 'ENV-2026-030', '2026-09-30', '974'),
    f.departure(DEPARTURE.left, 'ENV-2026-034', '2026-10-01', '971', { ...left, loading_closes_at: '2026-09-30T15:00:00Z', nb_colis: 1 }),
    f.departure(DEPARTURE.arrived, 'ENV-2026-028', '2026-09-24', '972', { ...left, statut: 'arrive', departed_at: '2026-09-24T06:00:00Z' }),
    f.departure(DEPARTURE.archived, 'ENV-2026-021', '2026-09-10', '974', { ...left, statut: 'archive', departed_at: '2026-09-10T06:00:00Z' }),
  ];
  const template = structuredClone(f.tables.colis[0]);
  f.dossier = (id, ref, clientId, fields = {}) => ({ ...structuredClone(template), id, ref, client_id: clientId, envoi_id: null, depart_souhaite: null, casier: `P-${ref.slice(-1)}`, desc_contenu: `Achats ${ref}`, updated_at: '2026-10-05T08:00:00Z', ...fields });
  const paid = { statut: 'paye', quote_version: 1, devis_brouillon: false, devis_total: 140, devis_snapshot: { inputs: { destination: { code: '974' } }, amounts: { total: 140 } }, paiement_montant: 140, paiement_date: '2026-10-02T10:00:00Z' };
  const prepared = { final_packages: [box(40, 30, 30, 12), box(30, 30, 20, 7.5)], outgoing_parcel_count: 2, fin_l: 40, fin_w: 30, fin_h: 30, fin_p: 19.5, preparation_composition_version: 1, final_measurements_version: 1 };
  f.paid = paid; f.prepared = prepared;
  f.tables.colis = empty ? [] : [
    f.dossier(DOSSIER.load, 'EXP-LOAD-1', CLIENT.reunion, { ...paid, ...prepared, envoi_id: DEPARTURE.reunion15 }),
    f.dossier(DOSSIER.wish1, 'EXP-WISH-1', CLIENT.reunion, { statut: 'autorise', depart_souhaite: '2026-10-15' }),
    f.dossier(DOSSIER.wish2, 'EXP-WISH-2', CLIENT.reunion, { statut: 'mesure', depart_souhaite: '2026-10-15', updated_at: '2026-10-05T09:00:00Z' }),
    f.dossier(DOSSIER.wish3, 'EXP-WISH-3', CLIENT.reunion, { ...paid, depart_souhaite: '2026-10-15', updated_at: '2026-10-05T10:00:00Z' }),
    f.dossier(DOSSIER.wishMayotte, 'EXP-WISH-MAYOTTE', CLIENT.mayotte, { statut: 'autorise', depart_souhaite: '2026-10-15' }),
    f.dossier(DOSSIER.wishArchived, 'EXP-WISH-ARCHIVED', CLIENT.reunion, { statut: 'autorise', depart_souhaite: '2026-10-15', archive: true }),
    f.dossier(DOSSIER.wishClosed, 'EXP-WISH-CLOSED', CLIENT.reunion, { statut: 'autorise', depart_souhaite: '2026-10-29' }),
    f.dossier(DOSSIER.shipped, 'EXP-SHIPPED', CLIENT.reunion, { ...paid, ...prepared, statut: 'expedie', envoi_id: DEPARTURE.left, date_expedition: '2026-10-01T06:00:45Z' }),
    f.dossier(DOSSIER.pro, 'EXP-PRO-PAID', CLIENT.pro, { ...paid, paiement_date: '2026-09-30T21:00:00Z', date_reception: '2026-09-20T08:00:00Z', devis_total: 300, paiement_montant: 300 }),
  ];
  f.tables.factures = []; f.tables.lignes = [];
  f.tables.staff_work_actions = []; f.tables.notifications = [];
  // The confirmed manifest of a departure, as get_departure_manifest returns it.
  await f.context.route('**/rest/v1/rpc/get_departure_manifest', async route => {
    const input = route.request().postDataJSON();
    const envoi = f.tables.envois.find(item => item.id === input.p_envoi_id);
    const items = f.tables.colis.filter(item => item.envoi_id === input.p_envoi_id && item.date_expedition)
      .map(item => ({ colis: item, client: f.tables.clients.find(row => row.id === item.client_id), lignes: [], factures: [], categories: [] }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ envoi, confirmed_at: envoi?.departed_at, items, deferred: [], excluded: [] }) });
  });
  f.writes = () => f.requests.filter(request => ['POST', 'PATCH', 'DELETE'].includes(request.method) && /\/rest\/v1\/(envois|colis|rpc\/(assign_colis_departure|confirm_departure|set_colis_departure_wish|create_departure_for_colis))/.test(request.path));
  return f;
}

const page = f => f.page.locator('.departures-page');
const card = (f, ref) => f.page.locator('[data-departure-card]').filter({ has: f.page.getByRole('heading', { level: 2, name: new RegExp(`^${ref} ·`) }) });
const normalize = text => String(text ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Every card of the view, in screen order: its reference, overdue flag, closing line and state. */
const readCards = f => f.page.locator('[data-departure-card]').evaluateAll(nodes => nodes.map(node => ({
  ref: node.querySelector('h2').textContent.split(' · ')[0],
  title: node.querySelector('h2').textContent,
  state: node.querySelector('h2 + p')?.textContent || '',
  overdue: Boolean(node.querySelector('.departures-flag')),
  closing: node.querySelector('.departures-closing')?.textContent.replace(/[  ]/g, ' ') || null,
})));
async function openPage(f, query = '') {
  await f.page.goto(`${base}/departs${query}`);
  await f.page.getByRole('heading', { level: 1, name: 'Départs' }).waitFor();
}
async function view(f, label) {
  await page(f).getByRole('navigation', { name: 'État des départs' }).getByRole('button', { name: label, exact: true }).click();
  await f.page.waitForFunction(name => [...document.querySelectorAll('nav[aria-label="État des départs"] button')].some(button => button.textContent === name && button.getAttribute('aria-pressed') === 'true'), label);
}
const toast = (f, text) => f.page.locator('[aria-atomic="true"]').filter({ hasText: text });
const noPageOverflow = async (f, label) => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label}: no horizontal page scroll`);
async function axe(f, label) {
  const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${label}: accessibility`);
  await noPageOverflow(f, label);
}
const shot = (f, name) => f.page.screenshot({ path: path.join(output, `${name}.png`) });
/** The inner scroller of the staff layout grows to show the whole page in one picture. */
async function tallShot(f, name) {
  const viewport = f.page.viewportSize();
  const height = await f.page.evaluate(() => {
    const scroller = [...document.querySelectorAll('.overflow-y-auto')].filter(node => node.scrollHeight > node.clientHeight + 2).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    return scroller ? scroller.scrollHeight + (innerHeight - scroller.clientHeight) : document.documentElement.scrollHeight;
  });
  await f.page.setViewportSize({ width: viewport.width, height: Math.min(4000, Math.max(viewport.height, height)) });
  await f.page.screenshot({ path: path.join(output, `${name}.png`) });
  await f.page.setViewportSize(viewport);
}
/** The element has the focus and is entirely inside the viewport (above the phone navigation). */
async function assertSeenAndFocused(f, locator, label) {
  await f.page.waitForFunction(element => document.activeElement === element, await locator.elementHandle(), { timeout: 5000 }).catch(() => {});
  const state = await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const nav = [...document.querySelectorAll('.fixed.bottom-0')].find(node => node.getClientRects().length && getComputedStyle(node).display !== 'none');
    const bottom = nav ? nav.getBoundingClientRect().top : innerHeight;
    return { focused: document.activeElement === element, inView: box.height > 0 && box.top >= 0 && box.bottom <= bottom };
  });
  assert.deepEqual(state, { focused: true, inView: true }, label);
}
const noWrite = f => assert.deepEqual(f.writes().map(request => request.path), []);

/** What one device shows of the Paris times of the page and of the pro recap. */
async function observeParisTime(f) {
  const seen = {};
  seen.device = await f.page.evaluate(() => ({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, day: new Date().getDate() }));
  await openPage(f);
  await card(f, 'ENV-2026-045').waitFor();
  const cards = await readCards(f);
  seen.order = cards.map(item => item.ref);
  seen.overdue = cards.filter(item => item.overdue).map(item => item.ref);
  seen.closings = Object.fromEntries(cards.map(item => [item.ref, item.closing]));
  const edited = card(f, 'ENV-2026-052');
  await edited.getByRole('button', { name: 'Modifier le planning', exact: true }).click();
  seen.editPrefill = await edited.getByLabel('Clôture (heure de Paris)', { exact: true }).inputValue();
  await edited.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page(f).getByRole('button', { name: 'Planifier un départ', exact: true }).first().click();
  const form = f.page.locator('#departure-planning');
  await form.getByLabel('Premier départ', { exact: true }).fill('2026-10-22');
  await form.getByLabel('Destination', { exact: true }).selectOption('971');
  await form.getByLabel('Nombre de semaines', { exact: true }).fill('2');
  await form.getByLabel('Clôture (heure de Paris)', { exact: true }).fill('2026-10-21T17:00');
  await form.getByRole('button', { name: 'Enregistrer le planning', exact: true }).click();
  await toast(f, '2 départs planifiés.').waitFor();
  seen.created = f.tables.envois.filter(item => item.destination_code === '971' && !item.departed_at).map(item => [item.date_depart, item.loading_closes_at]).sort();
  seen.createdClosings = (await readCards(f)).filter(item => item.state.startsWith('Guadeloupe')).map(item => item.closing);
  await view(f, 'Partis');
  await card(f, 'ENV-2026-034').getByRole('button', { name: 'Voir le manifeste', exact: true }).click();
  const manifest = f.page.getByRole('region', { name: 'Manifeste confirmé', exact: true });
  await manifest.waitFor();
  seen.manifest = normalize(await manifest.locator('h2 + p').textContent());
  seen.manifestLine = normalize(await manifest.locator('p').nth(1).textContent());
  await f.page.goto(`${base}/clients/${CLIENT.pro}`);
  await f.page.getByRole('button', { name: 'Abonnement et administration', exact: true }).click();
  await f.page.getByRole('button', { name: /Récapitulatif mensuel/ }).click();
  const month = f.page.getByLabel('Mois du récapitulatif', { exact: true });
  const count = f.page.locator('p').filter({ hasText: /^\d+ dossiers? sur la période$/ }).first();
  seen.recap = { defaultMonth: await month.inputValue() };
  await f.page.getByLabel('Année du récapitulatif', { exact: true }).selectOption('2026');
  await month.selectOption('8'); seen.recap.september = await count.textContent();
  await month.selectOption('9'); seen.recap.october = await count.textContent();
  return seen;
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, options = {}) {
    if (process.env.PINTA_DEPARTURES_PAGE_FILTER && !name.includes(process.env.PINTA_DEPARTURES_PAGE_FILTER)) return;
    const f = await fixture(browser, options);
    try {
      if (options.before) await options.before(f);
      await f.login(); await run(f);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
      await f.page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, `${name}-failure.txt`), await f.page.locator('body').innerText().catch(() => ''));
    } finally { await f.context.close(); console.log(JSON.stringify(results.at(-1))); }
  }
  try {
    // ── 1. Paris time on every device ───────────────────────────────────
    const observed = {};
    for (const zone of ZONES) await scenario(`paris-time-${zone.replace('/', '-')}`, async f => {
      const { device, ...seen } = await observeParisTime(f);
      assert.equal(device.zone, zone, 'The browser really runs in that zone.');
      assert.equal(device.day, zone === 'Indian/Reunion' ? 8 : 7, 'Réunion is already on Thursday 8.');
      observed[zone] = seen;
      assert.deepEqual(seen, EXPECTED_PARIS, `${zone}: the Paris values`);
    }, { timezoneId: zone });
    if (!process.env.PINTA_DEPARTURES_PAGE_FILTER || 'paris-time-identical'.includes(process.env.PINTA_DEPARTURES_PAGE_FILTER)) {
      const identical = Object.keys(observed).length === ZONES.length && ZONES.every(zone => JSON.stringify(observed[zone]) === JSON.stringify(observed[ZONES[0]]));
      results.push(identical ? { test: 'paris-time-identical-in-three-zones', pass: true } : { test: 'paris-time-identical-in-three-zones', pass: false, error: JSON.stringify(observed, null, 1) });
      if (!identical) process.exitCode = 1;
      await fs.writeFile(path.join(output, 'paris-time-by-zone.json'), JSON.stringify(observed, null, 2));
      console.log(JSON.stringify(results.at(-1)));
    }

    // ── 2. Closing wording ──────────────────────────────────────────────
    await scenario('closing-wording-habitual-and-none-once-left', async f => {
      await openPage(f);
      await card(f, 'ENV-2026-045').waitFor();
      assert.equal(normalize(await card(f, 'ENV-2026-045').locator('.departures-closing').textContent()), 'Clôture habituelle : mercredi 14 octobre, 17 h (heure de Paris)');
      assert.doesNotMatch(await page(f).innerText(), OLD_WORDINGS);
      await page(f).getByRole('button', { name: 'Planifier un départ', exact: true }).first().click();
      const form = f.page.locator('#departure-planning');
      assert.match(normalize(await form.innerText()), /Sans clôture saisie, la clôture habituelle s’applique : le mercredi 17 h qui précède le départ \(heure de Paris\)\./);
      await form.getByLabel('Premier départ', { exact: true }).fill('2026-10-22');
      await form.locator('#departure-plan-closing-help').filter({ hasText: 'Sans clôture saisie, la clôture habituelle s’applique : mercredi 21 octobre, 17 h (heure de Paris).' }).waitFor();
      assert.doesNotMatch(await page(f).innerText(), OLD_WORDINGS);
      for (const label of ['Partis', 'Archivés']) {
        await view(f, label);
        await f.page.locator('[data-departure-card]').first().waitFor();
        assert.equal(await page(f).locator('.departures-closing').count(), 0, `${label}: no closing line once left or archived`);
        assert.doesNotMatch(await page(f).locator('[data-departure-card]').allInnerTexts().then(texts => texts.join('\n')), /Clôture/);
      }
      noWrite(f);
    });

    // ── 3. Planning and edit forms ──────────────────────────────────────
    await scenario('plan-form-inline-validation-cancel-and-save', async f => {
      await openPage(f);
      const open = page(f).getByRole('button', { name: 'Planifier un départ', exact: true }).first();
      await open.click();
      const form = f.page.locator('#departure-planning');
      const date = form.getByLabel('Premier départ', { exact: true }), weeks = form.getByLabel('Nombre de semaines', { exact: true }), closing = form.getByLabel('Clôture (heure de Paris)', { exact: true });
      await f.page.waitForFunction(() => document.activeElement?.id === 'departure-plan-date');
      assert.equal(await date.getAttribute('min'), '2026-10-07', 'The picker starts on the Paris day.');
      const save = form.getByRole('button', { name: 'Enregistrer le planning', exact: true });
      const errorOf = id => form.locator(`#${id}-error`);
      await save.click();
      await errorOf('departure-plan-date').filter({ hasText: 'Choisissez la date du premier départ.' }).waitFor();
      assert.equal(await date.getAttribute('aria-invalid'), 'true');
      assert.match(await date.getAttribute('aria-describedby'), /departure-plan-date-error/);
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'departure-plan-date', 'The first invalid field takes the focus.');
      await date.fill('2026-10-06'); await save.click();
      await errorOf('departure-plan-date').filter({ hasText: 'Choisissez une date à partir d’aujourd’hui (heure de Paris).' }).waitFor();
      await date.fill('2026-10-07'); await weeks.fill('13'); await save.click();
      await errorOf('departure-plan-weeks').filter({ hasText: 'Indiquez entre 1 et 12 départs hebdomadaires.' }).waitFor();
      assert.equal(await errorOf('departure-plan-date').count(), 0, 'Today in Paris is accepted.');
      await weeks.fill('2'); await closing.fill('2026-10-07T23:00'); await save.click();
      await errorOf('departure-plan-closing').filter({ hasText: 'La clôture doit être à venir.' }).waitFor();
      await closing.fill('2026-10-08T09:00'); await save.click();
      await errorOf('departure-plan-closing').filter({ hasText: 'La clôture doit avoir lieu au plus tard le jour du départ.' }).waitFor();
      await shot(f, 'plan-form-errors-light-1440');
      noWrite(f);
      await form.getByRole('button', { name: 'Annuler', exact: true }).click();
      await form.waitFor({ state: 'detached' });
      await f.page.waitForFunction(() => document.activeElement?.textContent?.includes('Planifier un départ'));
      noWrite(f);
      await open.click();
      assert.equal(await f.page.locator('#departure-planning').getByLabel('Premier départ', { exact: true }).inputValue(), '', 'Cancelling kept nothing.');
      const again = f.page.locator('#departure-planning');
      await again.getByLabel('Premier départ', { exact: true }).fill('2026-10-08');
      await again.getByLabel('Destination', { exact: true }).selectOption('972');
      await again.locator('#departure-plan-closing-help').filter({ hasText: 'mercredi 7 octobre, 17 h (heure de Paris)' }).waitFor();
      await again.getByRole('button', { name: 'Enregistrer le planning', exact: true }).click();
      await toast(f, '1 départ planifié.').waitFor();
      await again.waitFor({ state: 'detached' });
      const created = f.tables.envois.filter(item => item.destination_code === '972' && item.date_depart === '2026-10-08');
      assert.equal(created.length, 1);
      assert.equal(created[0].loading_closes_at, null, 'Without a closing typed, none is saved: the habitual one applies.');
      const added = (await readCards(f)).find(item => item.state.startsWith('Martinique'));
      assert.equal(added.closing, 'Clôture habituelle : mercredi 7 octobre, 17 h (heure de Paris)');
      // The same day again: refused in the form, nothing written.
      const posts = f.writes().length;
      await open.click();
      await f.page.locator('#departure-planning').getByLabel('Premier départ', { exact: true }).fill('2026-10-08');
      await f.page.locator('#departure-planning').getByLabel('Destination', { exact: true }).selectOption('972');
      await f.page.locator('#departure-planning').getByRole('button', { name: 'Enregistrer le planning', exact: true }).click();
      await f.page.locator('#departure-planning').getByRole('alert').filter({ hasText: 'Un départ existe déjà ce jour-là pour cette destination : rien n’a été ajouté.' }).waitFor();
      assert.equal(f.writes().length, posts);
    });
    await scenario('edit-form-inline-validation-cancel-and-paris-closing', async f => {
      await openPage(f);
      const overdue = card(f, 'ENV-2026-033');
      const modify = overdue.getByRole('button', { name: 'Modifier le planning', exact: true });
      await modify.click();
      await f.page.waitForFunction(() => document.activeElement?.id === 'departure-edit-date');
      assert.equal(await overdue.getByLabel('Date', { exact: true }).inputValue(), '2026-10-03');
      await overdue.getByRole('button', { name: 'Enregistrer le départ', exact: true }).click();
      await overdue.locator('#departure-edit-date-error').filter({ hasText: 'Choisissez une date à partir d’aujourd’hui (heure de Paris).' }).waitFor();
      noWrite(f);
      await overdue.getByRole('button', { name: 'Annuler', exact: true }).click();
      await overdue.locator('form').waitFor({ state: 'detached' });
      await f.page.waitForFunction(() => document.activeElement?.closest('[data-departure-card]') && document.activeElement.dataset.action === 'edit');
      assert.equal(await modify.evaluate(element => element === document.activeElement), true, 'Cancel gives the focus back to « Modifier le planning ».');
      noWrite(f);
      const closingCard = card(f, 'ENV-2026-052');
      await closingCard.getByRole('button', { name: 'Modifier le planning', exact: true }).click();
      const closing = closingCard.getByLabel('Clôture (heure de Paris)', { exact: true });
      assert.equal(await closing.inputValue(), '2026-10-21T17:00', 'Prefilled in Paris time.');
      await closing.fill('2026-10-23T09:00');
      await closingCard.getByRole('button', { name: 'Enregistrer le départ', exact: true }).click();
      await closingCard.locator('#departure-edit-closing-error').filter({ hasText: 'La clôture doit avoir lieu au plus tard le jour du départ.' }).waitFor();
      await shot(f, 'edit-form-errors-light-1440');
      noWrite(f);
      await closing.fill('2026-10-20T18:30');
      await closingCard.getByRole('button', { name: 'Enregistrer le départ', exact: true }).click();
      await toast(f, 'Départ ENV-2026-052 enregistré.').waitFor();
      const patch = f.writes().find(request => request.method === 'PATCH');
      assert.deepEqual(patch.input, { date_depart: '2026-10-22', destination_code: '974', loading_closes_at: '2026-10-20T16:30:00.000Z' });
      await closingCard.locator('.departures-closing').filter({ hasText: 'Clôture : mardi 20 octobre, 18 h 30 (heure de Paris)' }).waitFor();
      // A closing left untouched keeps its exact saved instant.
      const mayotte = card(f, 'ENV-2026-046');
      await mayotte.getByRole('button', { name: 'Modifier le planning', exact: true }).click();
      await mayotte.getByLabel('Date', { exact: true }).fill('2026-10-15');
      await mayotte.getByRole('button', { name: 'Enregistrer le départ', exact: true }).click();
      await toast(f, 'Départ ENV-2026-046 enregistré.').waitFor();
      assert.equal(f.writes().filter(request => request.method === 'PATCH').at(-1).input.loading_closes_at, '2026-10-14T07:30:00Z');
      // An emptied closing saves none: the habitual one applies again.
      await card(f, 'ENV-2026-052').getByRole('button', { name: 'Modifier le planning', exact: true }).click();
      await card(f, 'ENV-2026-052').getByLabel('Clôture (heure de Paris)', { exact: true }).fill('');
      await card(f, 'ENV-2026-052').locator('#departure-edit-closing-help').filter({ hasText: 'Sans clôture saisie, la clôture habituelle s’applique : mercredi 21 octobre, 17 h (heure de Paris).' }).waitFor();
      await card(f, 'ENV-2026-052').getByRole('button', { name: 'Enregistrer le départ', exact: true }).click();
      await card(f, 'ENV-2026-052').locator('.departures-closing').filter({ hasText: 'Clôture habituelle : mercredi 21 octobre, 17 h (heure de Paris)' }).waitFor();
      assert.equal(f.writes().filter(request => request.method === 'PATCH').at(-1).input.loading_closes_at, null);
    });

    // ── 4. Irreversible steps ───────────────────────────────────────────
    await scenario('arrival-and-archive-confirmed-before-an-irreversible-write', async f => {
      await openPage(f, '?vue=partis');
      const left = card(f, 'ENV-2026-034');
      const arrive = left.getByRole('button', { name: 'Confirmer l’arrivée', exact: true });
      const dialog = f.page.getByRole('dialog', { name: 'Confirmer l’arrivée de ENV-2026-034 ?', exact: true });
      await arrive.click();
      await dialog.waitFor();
      assert.match(normalize(await dialog.innerText()), /Le départ du jeudi 1er octobre pour la Guadeloupe sera enregistré comme arrivé à destination\. Cette action est définitive : elle ne pourra pas être annulée\./);
      await shot(f, 'arrival-dialog-light-1440');
      await axe(f, 'arrival dialog');
      // Escape, the X, the backdrop and « Annuler » close it without writing.
      await f.page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      await arrive.click(); await dialog.getByRole('button', { name: 'Fermer la confirmation', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      await arrive.click(); await dialog.waitFor(); await f.page.mouse.click(8, 8); await dialog.waitFor({ state: 'detached' });
      await arrive.click(); await dialog.getByRole('button', { name: 'Annuler', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      noWrite(f);
      // A colleague changed the departure meanwhile: the refusal stays in the dialog, nothing changes.
      f.tables.envois.find(item => item.id === DEPARTURE.left).updated_at = '2026-10-07T20:00:00Z';
      await arrive.click();
      await dialog.getByRole('button', { name: 'Confirmer l’arrivée', exact: true }).click();
      await dialog.getByTestId('confirm-inline-error').filter({ hasText: 'modifié par un collègue' }).waitFor();
      assert.equal(f.tables.envois.find(item => item.id === DEPARTURE.left).statut, 'parti');
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
      await Promise.all([
        f.page.waitForResponse(response => response.url().includes('/rest/v1/envois') && response.request().method() === 'GET'),
        page(f).getByRole('button', { name: 'Actualiser', exact: true }).click(),
      ]);
      await f.page.waitForFunction(() => !document.querySelector('.departures-page header button')?.disabled);
      await arrive.click();
      await dialog.getByRole('button', { name: 'Confirmer l’arrivée', exact: true }).click();
      await toast(f, 'Arrivée confirmée : ENV-2026-034 est arrivé à destination.').waitFor();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(f.tables.envois.find(item => item.id === DEPARTURE.left).statut, 'arrive');
      await left.getByText('Guadeloupe · Arrivé à destination', { exact: true }).waitFor();
      assert.doesNotMatch(await left.innerText(), /Départ confirmé/, 'No stale « Départ confirmé » after the arrival.');
      assert.equal(await arrive.count(), 0);
      await assertSeenAndFocused(f, left.getByRole('heading', { level: 2 }), 'The card keeps the focus');
      await left.getByRole('button', { name: 'Archiver ce départ', exact: true }).click();
      const archive = f.page.getByRole('dialog', { name: 'Archiver ENV-2026-034 ?', exact: true });
      assert.match(normalize(await archive.innerText()), /Cette action est définitive : elle ne pourra pas être annulée\./);
      await archive.getByRole('button', { name: 'Archiver ce départ', exact: true }).click();
      await toast(f, 'ENV-2026-034 est archivé. Il reste consultable dans « Archivés ».').waitFor();
      await left.waitFor({ state: 'detached' });
      assert.equal(f.tables.envois.find(item => item.id === DEPARTURE.left).statut, 'archive');
      await assertSeenAndFocused(f, f.page.getByRole('heading', { level: 1, name: 'Départs' }), 'The page title takes the focus once the card left the view');
      await view(f, 'Archivés');
      await card(f, 'ENV-2026-034').getByText('Guadeloupe · Archivé', { exact: true }).waitFor();
    });
    await scenario('confirmation-dialog-long-content-scrolls-inside-on-a-short-phone', async f => {
      await openPage(f, '?vue=partis');
      await card(f, 'ENV-2026-034').getByRole('button', { name: 'Confirmer l’arrivée', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Confirmer l’arrivée de ENV-2026-034 ?', exact: true });
      await dialog.waitFor();
      const measure = await dialog.evaluate(element => { const box = element.getBoundingClientRect(); return { scrolls: element.scrollHeight > element.clientHeight + 1, top: box.top, bottom: box.bottom, height: innerHeight }; });
      assert.equal(measure.scrolls, true, 'The long content scrolls inside the dialog');
      assert.ok(measure.top >= 0 && measure.bottom <= measure.height, 'The dialog stays inside the screen');
      await shot(f, 'arrival-dialog-long-dark-390');
      await axe(f, 'long dialog');
      const ok = dialog.getByRole('button', { name: 'Confirmer l’arrivée', exact: true });
      await ok.scrollIntoViewIfNeeded();
      assert.equal(await ok.isVisible(), true);
      await f.page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      noWrite(f);
    }, { width: 390, height: 360, theme: 'dark' });

    // ── 5. Panels opened from a card far below ──────────────────────────
    for (const width of [1440, 390]) await scenario(`loading-and-manifest-panels-come-into-view-${width}`, async f => {
      await openPage(f);
      const far = card(f, 'ENV-2026-099');
      const load = far.getByRole('button', { name: 'Vérifier et confirmer le chargement', exact: true });
      await load.scrollIntoViewIfNeeded();
      await load.click();
      const review = f.page.getByRole('region', { name: 'Vérifier le chargement', exact: true });
      await review.waitFor();
      // Its title in view and its scan field focused: the first label can be scanned at once (2026-10-07).
      await assertSeenAndFocused(f, review.getByLabel('Scanner un colis', { exact: true }), 'Loading review: the scan field');
      assert.equal(await review.getByRole('heading', { level: 2, name: 'Chargement de ENV-2026-099' }).evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }), true, 'Loading review: its title in view');
      await review.getByText('2 colis préparés · 19,5 kg', { exact: true }).waitFor();
      await shot(f, `loading-review-${width}`);
      await review.getByRole('button', { name: 'Fermer le chargement', exact: true }).click();
      await review.waitFor({ state: 'detached' });
      await assertSeenAndFocused(f, load, 'Closing gives the focus back to the card');
      await view(f, 'Partis');
      const old = card(f, 'ENV-2026-001');
      const open = old.getByRole('button', { name: 'Voir le manifeste', exact: true });
      await open.scrollIntoViewIfNeeded();
      await open.click();
      const manifest = f.page.getByRole('region', { name: 'Manifeste confirmé', exact: true });
      await manifest.waitFor();
      await assertSeenAndFocused(f, manifest.getByRole('heading', { level: 2, name: 'Manifeste ENV-2026-001' }), 'Manifest');
      await manifest.getByText('EXP-FAR-SHIPPED · 2 colis préparés · 19,5 kg', { exact: true }).waitFor();
      await shot(f, `manifest-${width}`);
      await manifest.getByRole('button', { name: 'Fermer le manifeste', exact: true }).click();
      await manifest.waitFor({ state: 'detached' });
      await assertSeenAndFocused(f, open, 'Closing the manifest gives the focus back');
      noWrite(f);
    }, {
      width,
      before: async f => {
        // Ten more departures to prepare before the one checked, eleven more that left after the one opened.
        for (let week = 0; week < 10; week += 1) f.tables.envois.push(f.departure(uuid('d3000000', week), `ENV-2026-${String(70 + week)}`, `2026-11-${String(5 + week * 2).padStart(2, '0')}`, '974'));
        f.tables.envois.push(f.departure(uuid('d3000000', 99), 'ENV-2026-099', '2026-12-17', '974'));
        f.tables.colis.push(f.dossier(uuid('e3000000', 99), 'EXP-FAR-1', CLIENT.reunion, { ...f.paid, ...f.prepared, envoi_id: uuid('d3000000', 99) }));
        for (let index = 0; index < 11; index += 1) f.tables.envois.push(f.departure(uuid('d4000000', index), `ENV-2026-0${String(10 + index)}`, `2026-09-${String(29 - index * 2).padStart(2, '0')}`, '974', { ...f.left, departed_at: `2026-09-${String(29 - index * 2).padStart(2, '0')}T06:00:00Z` }));
        f.tables.envois.push(f.departure(uuid('d4000000', 99), 'ENV-2026-001', '2026-08-27', '974', { ...f.left, departed_at: '2026-08-27T06:00:00Z' }));
        f.tables.colis.push(f.dossier(uuid('e4000000', 99), 'EXP-FAR-SHIPPED', CLIENT.reunion, { ...f.paid, ...f.prepared, statut: 'expedie', envoi_id: uuid('d4000000', 99), date_expedition: '2026-08-27T06:00:00Z' }));
      },
    });

    // ── 6. Failed load ──────────────────────────────────────────────────
    await scenario('failed-load-is-an-error-with-retry-never-an-empty-view', async f => {
      await openPage(f);
      const failure = page(f).getByRole('alert').filter({ hasText: 'Chargement impossible' });
      await failure.waitFor();
      assert.equal(normalize(await failure.innerText()), 'Chargement impossible Les départs n’ont pas pu être chargés : Indisponibilité simulée. Vérifiez la connexion puis réessayez. Réessayer');
      assert.doesNotMatch(await page(f).innerText(), /Aucun départ/);
      assert.equal(await page(f).locator('[data-departure-card]').count(), 0);
      const reads = () => f.requests.filter(request => request.method === 'GET' && request.path.endsWith('/envois')).length;
      const before = reads();
      await Promise.all([
        f.page.waitForResponse(response => response.url().includes('/rest/v1/envois') && response.request().method() === 'GET'),
        failure.getByRole('button', { name: 'Réessayer', exact: true }).click(),
      ]);
      await page(f).getByRole('alert').filter({ hasText: 'Chargement impossible' }).waitFor();
      assert.ok(reads() > before, 'Réessayer reads the departures again');
    }, { failTable: 'envois' });
    await scenario('failed-load-then-retry-shows-the-departures', async f => {
      await openPage(f);
      await page(f).getByRole('alert').filter({ hasText: 'Chargement impossible' }).waitFor();
      f.failing = false;
      await page(f).getByRole('button', { name: 'Réessayer', exact: true }).click();
      await card(f, 'ENV-2026-045').waitFor();
      assert.equal(await page(f).getByRole('alert').filter({ hasText: 'Chargement impossible' }).count(), 0);
    }, {
      before: async f => {
        f.failing = true;
        await f.context.route('**/rest/v1/envois*', route => (f.failing && route.request().method() === 'GET'
          ? route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'Indisponibilité simulée' }) })
          : route.fallback()));
      },
    });

    // ── 7. Empty views ──────────────────────────────────────────────────
    await scenario('empty-view-invites-to-plan-when-permitted', async f => {
      await openPage(f);
      const empty = page(f).getByTestId('departures-empty');
      await empty.getByRole('heading', { name: 'Aucun départ à préparer', exact: true }).waitFor();
      assert.equal(await empty.locator('.departures-empty-icon svg').count(), 1, 'An illustration');
      await empty.getByRole('button', { name: 'Planifier un départ', exact: true }).click();
      await f.page.waitForFunction(() => document.activeElement?.id === 'departure-plan-date');
      await view(f, 'Partis');
      await page(f).getByRole('heading', { name: 'Aucun départ parti', exact: true }).waitFor();
      await view(f, 'Archivés');
      await page(f).getByRole('heading', { name: 'Aucun départ archivé', exact: true }).waitFor();
      noWrite(f);
    }, { empty: true });
    await scenario('empty-view-explains-without-planning-permission', async f => {
      await openPage(f);
      const empty = page(f).getByTestId('departures-empty');
      await empty.getByText('La planification est faite par une personne autorisée de l’équipe ; les nouveaux départs apparaîtront ici.', { exact: false }).waitFor();
      assert.equal(await page(f).getByRole('button', { name: 'Planifier un départ', exact: true }).count(), 0);
    }, { empty: true, role: 'preparateur', permissions: only('perm_envois_voir') });

    // ── 8. Overdue first is part of paris-time; here only the flag. ──────
    await scenario('overdue-departures-first-with-their-flag', async f => {
      await openPage(f);
      await card(f, 'ENV-2026-045').waitFor();
      const cards = await readCards(f);
      assert.deepEqual(cards.slice(0, 2).map(item => [item.ref, item.overdue]), [['ENV-2026-030', true], ['ENV-2026-033', true]]);
      assert.equal(cards.slice(2).some(item => item.overdue), false);
      assert.equal(normalize(await card(f, 'ENV-2026-030').locator('.departures-flag').textContent()), 'Date dépassée · planning à vérifier ou reprogrammer');
    });

    // ── 9. Documents of a departure ─────────────────────────────────────
    await scenario('documents-disclosure-keeps-the-actions-44px', async f => {
      await openPage(f, '?vue=partis');
      const left = card(f, 'ENV-2026-034');
      await left.locator('summary').filter({ hasText: 'Documents du départ' }).click();
      await left.getByRole('button', { name: 'Manifeste Excel', exact: true }).waitFor();
      for (const name of ['Voir le manifeste', 'Confirmer l’arrivée']) {
        const height = await left.getByRole('button', { name, exact: true }).evaluate(element => element.getBoundingClientRect().height);
        assert.ok(height >= 44 && height <= 46, `${name}: ${height}px`);
      }
      await shot(f, 'documents-open-light-1440');
    });
    await scenario('documents-disclosure-hidden-without-export-permission', async f => {
      await openPage(f, '?vue=partis');
      const left = card(f, 'ENV-2026-034');
      await left.getByRole('button', { name: 'Voir le manifeste', exact: true }).waitFor();
      assert.equal(await page(f).locator('summary').filter({ hasText: 'Documents du départ' }).count(), 0);
      assert.equal(await left.getByRole('button', { name: 'Confirmer l’arrivée', exact: true }).count(), 0);
    }, { role: 'preparateur', permissions: only('perm_envois_voir') });
    await scenario('documents-disclosure-lists-only-the-permitted-exports', async f => {
      await openPage(f, '?vue=partis');
      const left = card(f, 'ENV-2026-034');
      await left.locator('summary').filter({ hasText: 'Documents du départ' }).click();
      assert.deepEqual(await left.locator('details button').allTextContents(), ['Manifeste Excel']);
    }, { role: 'logisticien', permissions: only('perm_envois_voir', 'perm_export_colis') });

    // ── 9b. Commercial invoice ──────────────────────────────────────────
    // Before the departure: its dossiers ready to load, read again at each export; the others listed.
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) await scenario(`commercial-invoice-before-departure-pdf-and-excel-${width}-${theme}`, async f => {
      await openPage(f);
      const target = card(f, 'ENV-2026-045');
      const { documents, invoice, pdf, excel } = await openInvoice(f, target);
      for (const [label, element] of [['summary', documents.locator('summary')], ['PDF', pdf], ['Excel', excel]]) {
        const height = await element.evaluate(node => node.getBoundingClientRect().height);
        assert.ok(height >= 44, `${label}: ${height}px`);
      }
      // The departure's own dossiers (envoi_id filter): a background refresh of the whole list does not count.
      const reads = () => f.requests.filter(request => request.method === 'GET' && request.path.endsWith('/rest/v1/colis') && /envoi_id=eq\./.test(request.search || '')).length;
      const before = reads();
      const file = await downloadOf(f, pdf, `invoice-before-${width}-${theme}`);
      assert.equal(file.name, 'facture-commerciale-ENV-2026-045.pdf');
      assert.ok(reads() > before, 'The dossiers are read again from the server at the export.');
      const items = await pdfItems(file.path);
      for (const expected of ['FACTURE COMMERCIALE', 'GROUPE DELIVREX', 'ENV-2026-045', '07/10/2026', '15/10/2026', 'La Réunion', 'Aérien', '27,5 kg',
        'N° expédition', 'Destinataire', 'Code SH', 'Description', 'Qté', 'P.U. HT', 'Valeur HT',
        'EXP-LOAD-1', 'Hoarau Flavie', '42050090', 'Mini scelleuse', '16,64 €', '76,75 €', '93,39 €', '39241000', 'Organisateur évier', '45,75 €', '55,67 €',
        'EXP-LOAD-PRO', 'Lagon Services SARL', '0901210000', 'Café torréfié 1 kg', '15,00 €', '60,00 €', '37,14 €', '97,14 €', '6911100000', 'Tasses en porcelaine', '27,86 €', '72,86 €',
        '131,56 €', '187,50 €', '319,06 €',
        'Transport réparti au prorata de la valeur des articles (quantité × prix unitaire HT). Valeurs en euros.', 'Document généré par Expedîle — usage douanier uniquement'])
        assert.ok(items.includes(expected), `PDF: « ${expected} »`);
      for (const absent of ['EXP-LOAD-WAIT', 'Ancienne commande remplacée', 'undefined', 'NaN']) assert.ok(!items.join('\n').includes(absent), `PDF: no « ${absent} »`);
      // What the invoice leaves out, with what it waits for.
      const excluded = invoice.locator('.departure-invoice-excluded');
      await excluded.getByRole('heading', { name: 'Non inclus (1)', exact: true }).waitFor();
      assert.equal(normalize(await excluded.locator('.departure-invoice-ref').textContent()), 'EXP-LOAD-WAIT');
      assert.equal(normalize(await excluded.locator('.departure-invoice-reason').textContent()), 'Paiement non confirmé');
      const payment = excluded.getByRole('link', { name: 'Vérifier le paiement EXP-LOAD-WAIT', exact: true });
      const link = new URL(await payment.getAttribute('href'), base);
      assert.deepEqual([link.pathname, link.searchParams.get('section'), link.searchParams.get('returnTo')], [`/colis/${DOSSIER.loadWait}`, 'paiement', '/departs']);
      assert.ok(await payment.evaluate(node => node.getBoundingClientRect().height) >= 44, 'The link is a 44 px target.');
      const sheet = await downloadOf(f, excel, `invoice-before-${width}-${theme}`);
      assert.equal(sheet.name, 'facture-commerciale-ENV-2026-045.xlsx');
      const book = XLSX.readFile(sheet.path, { cellNF: true });
      assert.deepEqual(book.SheetNames, ['Facture commerciale']);
      const rows = XLSX.utils.sheet_to_json(book.Sheets['Facture commerciale'], { header: 1, raw: true, defval: null });
      assert.deepEqual(rows.slice(1, 9).map(row => row.slice(0, 2)), [['N° de facture', 'ENV-2026-045'], ['Date', '07/10/2026'], ['Départ prévu', '15/10/2026'], ['Destination', 'La Réunion'], ['Mode de transport', 'Aérien'], ['Expéditions', 2], ['Nombre de colis', 3], ['Poids brut total (kg)', 27.5]]);
      const head = rows.findIndex(row => row[0] === 'N° expédition');
      assert.deepEqual(rows.slice(head, head + 6), [
        ['N° expédition', 'Destinataire', 'Code SH', 'Description', 'Qté', 'P.U. HT', 'Valeur HT', 'Transport affecté', 'Total'],
        ['EXP-LOAD-1', 'Hoarau Flavie', '42050090', 'Mini scelleuse', 1, 16.64, 16.64, 76.75, 93.39],
        ['EXP-LOAD-1', 'Hoarau Flavie', '39241000', 'Organisateur évier', 1, 9.92, 9.92, 45.75, 55.67],
        ['EXP-LOAD-PRO', 'Lagon Services SARL', '0901210000', 'Café torréfié 1 kg', 4, 15, 60, 37.14, 97.14],
        ['EXP-LOAD-PRO', 'Lagon Services SARL', '6911100000', 'Tasses en porcelaine', 6, 7.5, 45, 27.86, 72.86],
        ['Total', null, null, null, null, null, 131.56, 187.5, 319.06],
      ]);
      const code = book.Sheets['Facture commerciale'][XLSX.utils.encode_cell({ r: head + 3, c: 2 })];
      assert.deepEqual([code.t, code.v], ['s', '0901210000'], 'The HS code stays text, with its leading zero.');
      assert.equal(book.Sheets['Facture commerciale'][XLSX.utils.encode_cell({ r: head + 3, c: 7 })].z, '#,##0.00 "€"');
      assert.equal(await f.page.locator('[aria-atomic="true"]').filter({ hasText: /facture/i }).count(), 0, 'A download is not announced by a toast.');
      assert.equal(await invoice.getByRole('alert').count(), 0);
      noWrite(f);
      await documents.screenshot({ path: path.join(output, `commercial-invoice-before-${width}-${theme}.png`) });
      await axe(f, `commercial invoice ${width} ${theme}`);
    }, { width, theme, before: f => commercialInvoiceFixture(f) });
    // A missing HS code: what to fix, the dossier to open, and nothing downloaded.
    for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) await scenario(`commercial-invoice-blocked-without-hs-code-${width}-${theme}`, async f => {
      const downloads = [];
      f.page.on('download', item => downloads.push(item.suggestedFilename()));
      await openPage(f);
      const target = card(f, 'ENV-2026-045');
      const { documents, invoice, pdf, excel } = await openInvoice(f, target);
      for (const button of [pdf, excel]) {
        await Promise.all([
          f.page.waitForResponse(response => response.url().includes('/rest/v1/colis?') && response.request().method() === 'GET'),
          button.click(),
        ]);
        const alert = invoice.getByRole('alert').filter({ hasText: 'Facture non générée : 1 point à corriger.' });
        await alert.waitFor();
        assert.equal(normalize(await alert.locator('li').first().locator('span').first().textContent()), 'EXP-LOAD-PRO : code SH manquant pour « Tasses en porcelaine »');
        const open = alert.getByRole('link', { name: 'Ouvrir EXP-LOAD-PRO', exact: true });
        const link = new URL(await open.getAttribute('href'), base);
        assert.deepEqual([link.pathname, link.searchParams.get('section'), link.searchParams.get('returnTo')], [`/colis/${DOSSIER.loadPro}`, 'documents', '/departs'], 'The articles of a professional are those of its invoices.');
        assert.equal(await alert.getByRole('link', { name: 'Compléter les catégories', exact: true }).getAttribute('href'), '/settings?tab=categories');
        for (const element of [open, alert.getByRole('link', { name: 'Compléter les catégories', exact: true })]) assert.ok(await element.evaluate(node => node.getBoundingClientRect().height) >= 44);
        await invoice.getByRole('heading', { name: 'Non inclus (1)', exact: true }).waitFor();
      }
      assert.deepEqual(downloads, [], 'Nothing is downloaded while a code is missing.');
      noWrite(f);
      await documents.screenshot({ path: path.join(output, `commercial-invoice-blocked-${width}-${theme}.png`) });
      await axe(f, `commercial invoice blocked ${width} ${theme}`);
    }, { width, theme, before: f => commercialInvoiceFixture(f, { missingCode: true }) });
    await scenario('commercial-invoice-before-departure-hidden-without-permission', async f => {
      await openPage(f);
      const target = card(f, 'ENV-2026-045');
      await target.getByRole('button', { name: 'Vérifier et confirmer le chargement', exact: true }).waitFor();
      assert.equal(await target.locator('summary').filter({ hasText: 'Documents du départ' }).count(), 0);
      assert.equal(await page(f).getByRole('button', { name: /Facture commerciale/ }).count(), 0);
    }, { role: 'logisticien', permissions: only('perm_envois_voir', 'perm_envois_modifier', 'perm_colis_expedier', 'perm_export_colis', 'perm_export_dau'), before: f => commercialInvoiceFixture(f) });
    await scenario('commercial-invoice-before-departure-offered-with-the-permission-on-cards-with-dossiers', async f => {
      await openPage(f);
      const { invoice } = await openInvoice(f, card(f, 'ENV-2026-045'));
      assert.deepEqual(await invoice.locator('button').evaluateAll(nodes => nodes.map(node => node.textContent)), ['Facture commerciale en PDF', 'Facture commerciale en Excel']);
      assert.equal(await card(f, 'ENV-2026-037').locator('summary').count(), 0, 'A departure without dossier has no document.');
    }, { role: 'logisticien', permissions: only('perm_envois_voir', 'perm_export_factures'), before: f => commercialInvoiceFixture(f) });
    // After the departure: the frozen manifest, a code missing at the confirmation completed since in the categories.
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) await scenario(`commercial-invoice-after-departure-from-the-manifest-${width}-${theme}`, async f => {
      await openPage(f, '?vue=partis');
      const left = card(f, 'ENV-2026-034');
      const { documents, invoice, pdf, excel } = await openInvoice(f, left);
      assert.deepEqual(await documents.locator('button').evaluateAll(nodes => nodes.map(node => node.textContent)), ['Manifeste Excel', 'Données douane', 'Facture commerciale en PDF', 'Facture commerciale en Excel']);
      const manifests = () => f.manifestReads;
      // The departure's own dossiers (envoi_id filter): a background refresh of the whole list does not count.
      const colisReads = () => f.requests.filter(request => request.method === 'GET' && request.path.endsWith('/rest/v1/colis') && /envoi_id=eq\./.test(request.search || '')).length;
      const [beforeManifests, beforeReads] = [manifests(), colisReads()];
      const file = await downloadOf(f, pdf, `invoice-manifest-${width}-${theme}`);
      assert.equal(file.name, 'facture-commerciale-ENV-2026-034.pdf');
      assert.equal(manifests(), beforeManifests + 1, 'Read from the confirmed manifest');
      assert.equal(colisReads(), beforeReads, 'never from the current dossiers');
      const items = await pdfItems(file.path);
      for (const expected of ['ENV-2026-034', '01/10/2026', 'Guadeloupe', 'Aérien', '19,5 kg', 'EXP-SHIPPED', 'Hoarau Flavie', '42050090', '39241000', '76,75 €', '45,75 €', '26,56 €', '122,50 €', '149,06 €'])
        assert.ok(items.includes(expected), `PDF: « ${expected} »`);
      const sheet = await downloadOf(f, excel, `invoice-manifest-${width}-${theme}`);
      assert.equal(sheet.name, 'facture-commerciale-ENV-2026-034.xlsx');
      const rows = XLSX.utils.sheet_to_json(XLSX.readFile(sheet.path).Sheets['Facture commerciale'], { header: 1, raw: true, defval: null });
      const head = rows.findIndex(row => row[0] === 'N° expédition');
      assert.deepEqual(rows.slice(head + 1, head + 4).map(row => [row[0], row[2], row[7], row[8]]), [['EXP-SHIPPED', '42050090', 76.75, 93.39], ['EXP-SHIPPED', '39241000', 45.75, 55.67], ['Total', null, 122.5, 149.06]]);
      assert.equal(await invoice.locator('.departure-invoice-excluded').count(), 0, 'Nothing is left out of a confirmed manifest.');
      noWrite(f);
      await left.screenshot({ path: path.join(output, `commercial-invoice-manifest-${width}-${theme}.png`) });
      await axe(f, `commercial invoice manifest ${width} ${theme}`);
    }, { width, theme, before: f => commercialInvoiceFixture(f) });
    // The departure leaves while its card stays open (?envoi=): what was read before it never stays under its manifest.
    await scenario('commercial-invoice-result-before-departure-cleared-once-it-has-left', async f => {
      await openPage(f, `?envoi=${DEPARTURE.reunion15}`);
      const target = card(f, 'ENV-2026-045');
      const before = await openInvoice(f, target);
      await downloadOf(f, before.pdf, 'invoice-cleared');
      await before.invoice.getByRole('heading', { name: 'Non inclus (1)', exact: true }).waitFor();
      // A colleague confirms the loading; « Actualiser » reads the departure again.
      Object.assign(f.tables.envois.find(row => row.id === DEPARTURE.reunion15), { ...f.left, updated_at: '2026-10-07T21:00:00Z' });
      await page(f).getByRole('button', { name: 'Actualiser', exact: true }).click();
      await target.getByRole('button', { name: 'Voir le manifeste', exact: true }).waitFor();
      assert.equal(await target.locator('.departure-invoice-excluded').count(), 0, 'The « Non inclus » list of the loading is gone.');
      const after = await openInvoice(f, target);
      await after.invoice.getByText('Depuis le manifeste confirmé', { exact: false }).waitFor();
      assert.equal(await after.invoice.getByRole('alert').count(), 0);
      noWrite(f);
    }, { before: f => commercialInvoiceFixture(f) });

    // ── 10. French numbers ──────────────────────────────────────────────
    await scenario('weights-in-french-in-loading-review-and-manifest', async f => {
      await openPage(f);
      await card(f, 'ENV-2026-045').getByRole('button', { name: 'Vérifier et confirmer le chargement', exact: true }).click();
      const review = f.page.getByRole('region', { name: 'Vérifier le chargement', exact: true });
      const reviewLine = normalize(await review.getByText(/colis préparés/).textContent());
      await review.getByRole('button', { name: 'Fermer le chargement', exact: true }).click();
      await view(f, 'Partis');
      await card(f, 'ENV-2026-034').getByRole('button', { name: 'Voir le manifeste', exact: true }).click();
      const manifestLine = normalize(await f.page.getByRole('region', { name: 'Manifeste confirmé', exact: true }).getByText(/^EXP-SHIPPED/).textContent());
      assert.equal(reviewLine, '2 colis préparés · 19,5 kg');
      assert.equal(manifestLine, 'EXP-SHIPPED · 2 colis préparés · 19,5 kg');
    });

    // ── 11. Dossiers wishing the departure day ──────────────────────────
    await scenario('wished-dossiers-assigned-one-after-the-other-on-explicit-click', async f => {
      await openPage(f);
      const target = card(f, 'ENV-2026-045');
      const wishes = target.getByRole('region', { name: '3 dossiers souhaitent partir ce jour-là', exact: true });
      await wishes.waitFor();
      const links = await wishes.getByRole('link').evaluateAll(nodes => nodes.map(node => [node.textContent, new URL(node.href).pathname]));
      assert.deepEqual(links, [['EXP-WISH-1', `/colis/${DOSSIER.wish1}`], ['EXP-WISH-2', `/colis/${DOSSIER.wish2}`], ['EXP-WISH-3', `/colis/${DOSSIER.wish3}`]]);
      // Not for the closed departure of the 29th, nor for another destination or an archived dossier.
      assert.equal(await page(f).getByRole('region', { name: /souhaite/ }).count(), 1);
      assert.doesNotMatch(await wishes.innerText(), /MAYOTTE|ARCHIVED|CLOSED/);
      noWrite(f);
      // A colleague asks EXP-WISH-2's consent after this page was drawn: the page
      // receives the new version (focus reconciliation) and the click uses it.
      Object.assign(f.tables.colis.find(item => item.id === DOSSIER.wish2), { statut: 'attente_feu_vert', updated_at: '2026-10-07T20:00:00Z' });
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await wishes.getByText('Hoarau Flavie · En attente d\'accord client', { exact: true }).waitFor();
      const assign = wishes.getByRole('button', { name: 'Affecter ces dossiers', exact: true });
      await assign.click();
      await f.page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Affecter ces dossiers' && button.disabled));
      await target.getByRole('status').filter({ hasText: '3 dossiers affectés' }).waitFor();
      assert.equal(f.maxInFlight, 1, 'One assignment at a time');
      assert.deepEqual(f.assignments, [
        { id: DOSSIER.wish1, envoi: DEPARTURE.reunion15, sent: '2026-10-05T08:00:00Z', version: true },
        { id: DOSSIER.wish2, envoi: DEPARTURE.reunion15, sent: '2026-10-07T20:00:00Z', version: true },
        { id: DOSSIER.wish3, envoi: DEPARTURE.reunion15, sent: '2026-10-05T10:00:00Z', version: true },
      ], 'Each call carries the version the page holds at that moment, the colleague\'s one included');
      for (const id of [DOSSIER.wish1, DOSSIER.wish2, DOSSIER.wish3]) assert.deepEqual([f.tables.colis.find(item => item.id === id).envoi_id, f.tables.colis.find(item => item.id === id).depart_souhaite], [DEPARTURE.reunion15, null]);
      await wishes.waitFor({ state: 'detached' });
      await target.getByRole('button', { name: '4 dossiers actifs', exact: false }).waitFor();
      await toast(f, '3 dossiers affectés à ENV-2026-045.').waitFor();
      await shot(f, 'wishes-assigned-light-1440');
    }, { before: trackAssignments });
    // The same rule as the dossier calendar: a departure after the end of the
    // client's subscription is confirmed first, the dossiers named; cancelling writes nothing.
    for (const theme of ['light', 'dark']) await scenario(`wished-dossiers-after-the-subscription-end-are-confirmed-first-${theme}`, async f => {
      await openPage(f);
      const target = card(f, 'ENV-2026-045');
      const wishes = target.getByRole('region', { name: '3 dossiers souhaitent partir ce jour-là', exact: true });
      await wishes.waitFor();
      // On 7 October, a subscription ending on the 12th still runs: said in the future tense.
      assert.equal(await wishes.getByText(/abonnement jusqu’au 12 octobre/).count(), 3, 'Each late dossier says so in the list.');
      assert.equal(await wishes.getByText(/abonnement terminé/).count(), 0, 'Never as already ended.');
      const assign = wishes.getByRole('button', { name: 'Affecter ces dossiers', exact: true });
      await assign.click();
      const question = f.page.getByRole('dialog', { name: 'Affecter quand même ?', exact: true });
      await question.waitFor();
      assert.equal(normalize(await question.getByText(/^Le départ du/).textContent()), 'Le départ du jeudi 15 octobre est après la fin de l’abonnement de Flavie (12 octobre) : EXP-WISH-1, EXP-WISH-2 et EXP-WISH-3.');
      await axe(f, `subscription confirmation ${theme}`);
      await shot(f, `wishes-subscription-confirm-${theme}-1440`);
      await question.getByRole('button', { name: 'Annuler', exact: true }).click();
      await question.waitFor({ state: 'hidden' });
      assert.deepEqual(f.assignments, [], 'Cancelling assigns nothing.');
      noWrite(f);
      await assign.click();
      await question.getByRole('button', { name: 'Affecter quand même', exact: true }).click();
      await target.getByRole('status').filter({ hasText: '3 dossiers affectés' }).waitFor();
      assert.deepEqual(f.assignments.map(item => item.id), [DOSSIER.wish1, DOSSIER.wish2, DOSSIER.wish3]);
    }, { theme, before: async f => { await trackAssignments(f); Object.assign(f.tables.clients.find(item => item.id === CLIENT.reunion), { abonnement: 'premium', abonnement_debut: '2025-10-12', abonnement_fin: '2026-10-12' }); } });
    // On a phone, a wished reference is read whole (never « EXP- / WISH- / 1 »), the client and the
    // subscription note wrap beside or below it; a subscription already ended reads in the past tense.
    for (const [width, theme, end, note] of [[390, 'light', '2026-10-12', 'abonnement jusqu’au 12 octobre'], [390, 'dark', '2026-10-05', 'abonnement terminé le 5 octobre'], [320, 'light', '2026-10-12', 'abonnement jusqu’au 12 octobre']]) await scenario(`wished-references-stay-whole-on-a-phone-with-the-subscription-end-in-its-tense-${width}-${theme}`, async f => {
      await openPage(f);
      const wishes = card(f, 'ENV-2026-045').getByRole('region', { name: '3 dossiers souhaitent partir ce jour-là', exact: true });
      await wishes.waitFor();
      const lines = await wishes.locator('.departures-wishes-list li').evaluateAll(items => items.map(item => {
        const link = item.querySelector('a'), range = document.createRange(); range.selectNodeContents(link);
        const box = item.closest('.departures-wishes').getBoundingClientRect(), rect = link.getBoundingClientRect();
        return { ref: link.textContent, lines: new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size, inside: rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5, note: item.querySelector('.departures-wishes-client').textContent };
      }));
      assert.deepEqual(lines.map(line => line.ref), ['EXP-WISH-1', 'EXP-WISH-2', 'EXP-WISH-3']);
      for (const line of lines) {
        assert.equal(line.lines, 1, `${line.ref} on one line (${JSON.stringify(line)})`);
        assert.ok(line.inside, `${line.ref} inside the list`);
        assert.ok(line.note.endsWith(note), `${line.ref}: « ${note} » (${line.note})`);
      }
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'No horizontal scroll');
      await axe(f, `wishes ${width} ${theme}`);
      await wishes.screenshot({ path: `${output}/wishes-list-${width}-${theme}.png` });
    }, { width, theme, before: async f => { Object.assign(f.tables.clients.find(item => item.id === CLIENT.reunion), { abonnement: 'premium', abonnement_debut: '2025-10-12', abonnement_fin: end }); } });
    // Loaded, then the minute's refresh of the dossiers fails: the departures stay
    // (never « Les départs n’ont pas pu être chargés »), the banner gives the reason.
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) await scenario(`a-failed-refresh-keeps-the-departures-${width}-${theme}`, async f => {
      await openPage(f);
      await card(f, 'ENV-2026-045').waitFor();
      const cards = await f.page.locator('[data-departure-card]').count();
      await f.context.route('**/rest/v1/colis?*', route => new URL(route.request().url()).searchParams.get('select') === 'id,updated_at,client_id'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Actualisation refusée (essai)' }) }) : route.fallback());
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await f.page.getByRole('alert').filter({ hasText: 'Actualisation des dossiers impossible : Actualisation refusée (essai)' }).waitFor();
      assert.equal(await f.page.getByText(/Les départs n’ont pas pu être chargés/).count(), 0, 'A failed refresh is never a failed load.');
      assert.equal(await f.page.locator('[data-departure-card]').count(), cards, 'The departures stay on screen.');
      assert.equal(await page(f).getByRole('button', { name: 'Planifier un départ', exact: true }).first().isEnabled(), true);
      await axe(f, `refresh failure ${width} ${theme}`);
      await shot(f, `refresh-failure-${width}-${theme}`);
    }, { width, theme });

    await scenario('wished-dossier-changed-meanwhile-asks-to-reload-it', async f => {
      await openPage(f);
      const target = card(f, 'ENV-2026-045');
      await target.getByRole('region', { name: '3 dossiers souhaitent partir ce jour-là', exact: true }).waitFor();
      // A colleague changes EXP-WISH-2 at the very moment its assignment is sent.
      f.raceOn = DOSSIER.wish2;
      await target.getByRole('button', { name: 'Affecter ces dossiers', exact: true }).click();
      await target.getByRole('status').filter({ hasText: '2 dossiers affectés' }).waitFor();
      const failure = target.getByRole('alert');
      assert.equal(normalize(await failure.innerText()), '1 dossier non affecté : Le dossier EXP-WISH-2 a changé : rechargez-le');
      assert.equal(f.tables.colis.find(item => item.id === DOSSIER.wish2).envoi_id, null);
      assert.equal(f.assignments.length, 3, 'The others were still assigned, one after the other');
      await target.getByRole('region', { name: '1 dossier souhaite partir ce jour-là', exact: true }).waitFor();
      await shot(f, 'wishes-conflict-light-1440');
      await axe(f, 'assignment conflict');
    }, { before: trackAssignments });
    await scenario('wished-dossiers-listed-without-assign-permission', async f => {
      await openPage(f);
      const wishes = card(f, 'ENV-2026-045').getByRole('region', { name: '3 dossiers souhaitent partir ce jour-là', exact: true });
      await wishes.getByText('L’affectation à un départ est réservée aux personnes autorisées.', { exact: true }).waitFor();
      assert.equal(await wishes.getByRole('button').count(), 0);
      noWrite(f);
    }, { role: 'logisticien', permissions: only('perm_envois_voir', 'perm_envois_modifier', 'perm_colis_expedier') });

    // ── Loading without any dossier (coordinator addition) ──────────────
    await scenario('loading-action-secondary-and-disabled-without-dossier', async f => {
      await openPage(f);
      const empty = card(f, 'ENV-2026-037').getByRole('button', { name: 'Vérifier et confirmer le chargement', exact: true });
      assert.equal(await empty.isDisabled(), true);
      assert.equal(await empty.evaluate(element => element.classList.contains('brand-bg')), false, 'Secondary style');
      const reason = await empty.evaluate(element => document.getElementById(element.getAttribute('aria-describedby'))?.textContent);
      assert.equal(reason, 'Aucun dossier affecté à ce départ');
      const loadable = card(f, 'ENV-2026-045').getByRole('button', { name: 'Vérifier et confirmer le chargement', exact: true });
      assert.equal(await loadable.isEnabled(), true);
      assert.equal(await loadable.evaluate(element => element.classList.contains('brand-bg')), true, 'Primary style when there is something to load');
    });

    // ── Every state, light and dark, desktop and phone, with axe ────────
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
      const tag = `${theme}-${width}`;
      await scenario(`states-${tag}`, async f => {
        await openPage(f);
        await card(f, 'ENV-2026-045').getByRole('region', { name: /souhaitent partir/ }).waitFor();
        await tallShot(f, `${tag}-a-preparer`); await axe(f, 'À préparer');
        await page(f).getByRole('button', { name: 'Planifier un départ', exact: true }).first().click();
        await f.page.locator('#departure-planning').getByRole('button', { name: 'Enregistrer le planning', exact: true }).click();
        await f.page.locator('#departure-plan-date-error').waitFor();
        await shot(f, `${tag}-plan-form-errors`); await axe(f, 'Planning form');
        await f.page.locator('#departure-planning').getByRole('button', { name: 'Annuler', exact: true }).click();
        await card(f, 'ENV-2026-033').getByRole('button', { name: 'Modifier le planning', exact: true }).click();
        await card(f, 'ENV-2026-033').getByRole('button', { name: 'Enregistrer le départ', exact: true }).click();
        await f.page.locator('#departure-edit-date-error').waitFor();
        await card(f, 'ENV-2026-033').scrollIntoViewIfNeeded();
        await shot(f, `${tag}-edit-form-errors`); await axe(f, 'Edit form');
        await card(f, 'ENV-2026-033').getByRole('button', { name: 'Annuler', exact: true }).click();
        await card(f, 'ENV-2026-045').getByRole('button', { name: 'Vérifier et confirmer le chargement', exact: true }).click();
        await f.page.getByRole('region', { name: 'Vérifier le chargement', exact: true }).waitFor();
        await shot(f, `${tag}-loading-review`); await axe(f, 'Loading review');
        await f.page.getByRole('button', { name: 'Fermer le chargement', exact: true }).click();
        await view(f, 'Partis');
        await card(f, 'ENV-2026-034').locator('summary').click();
        await tallShot(f, `${tag}-partis-documents`); await axe(f, 'Partis');
        await card(f, 'ENV-2026-034').getByRole('button', { name: 'Voir le manifeste', exact: true }).click();
        await f.page.getByRole('region', { name: 'Manifeste confirmé', exact: true }).waitFor();
        await shot(f, `${tag}-manifest`); await axe(f, 'Manifest');
        await f.page.getByRole('button', { name: 'Fermer le manifeste', exact: true }).click();
        await card(f, 'ENV-2026-034').getByRole('button', { name: 'Confirmer l’arrivée', exact: true }).click();
        await f.page.getByRole('dialog').waitFor();
        await shot(f, `${tag}-arrival-dialog`); await axe(f, 'Arrival dialog');
        await f.page.keyboard.press('Escape');
        await view(f, 'Archivés');
        await card(f, 'ENV-2026-021').waitFor();
        await tallShot(f, `${tag}-archives`); await axe(f, 'Archivés');
        noWrite(f);
      }, { theme, width });
      await scenario(`empty-${tag}`, async f => {
        await openPage(f);
        await page(f).getByTestId('departures-empty').waitFor();
        await shot(f, `${tag}-empty`); await axe(f, 'Empty view');
      }, { theme, width, empty: true });
      await scenario(`load-error-${tag}`, async f => {
        await openPage(f);
        await page(f).getByRole('alert').filter({ hasText: 'Chargement impossible' }).waitFor();
        await shot(f, `${tag}-load-error`); await axe(f, 'Load error');
      }, { theme, width, failTable: 'envois' });
    }
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ base, passed: results.filter(r => r.pass).length, total: results.length, results }, null, 2));
  }
}

/** Records each assign_colis_departure call: its dossier, departure, whether it
 * carried the version the server holds at that moment, and how many run at once. */
async function trackAssignments(f) {
  f.assignments = []; f.maxInFlight = 0; let inFlight = 0;
  f.page.on('request', request => { if (request.url().endsWith('/rpc/assign_colis_departure')) { inFlight += 1; f.maxInFlight = Math.max(f.maxInFlight, inFlight); } });
  const done = request => { if (request.url().endsWith('/rpc/assign_colis_departure')) inFlight -= 1; };
  f.page.on('requestfinished', done); f.page.on('requestfailed', done);
  await f.context.route('**/rest/v1/rpc/assign_colis_departure', async route => {
    const input = route.request().postDataJSON();
    const row = f.tables.colis.find(item => item.id === input.p_colis_id);
    if (row && input.p_colis_id === f.raceOn) row.updated_at = '2026-10-07T21:00:00Z';
    f.assignments.push({ id: input.p_colis_id, envoi: input.p_envoi_id, sent: input.p_expected_updated_at, version: input.p_expected_updated_at === row?.updated_at });
    // Slow enough that parallel calls would overlap.
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fallback();
  });
}

/** The commercial invoice's data (see the header): HS codes on the categories, EXP-LOAD-1's
 * saved quote, a professional and a dossier awaiting payment on the 15 Oct departure, and
 * EXP-SHIPPED's frozen manifest with the same quote, whose plastic category had no HS code
 * at the confirmation. `missingCode`: the porcelain category has none either. */
async function commercialInvoiceFixture(f, { missingCode = false } = {}) {
  f.tables.categories.push(
    { id: 'cat-cuir', label: 'Cuir', code_hs: '4205', position: 2 },
    { id: 'cat-plastique', label: 'Vaisselle plastique', code_hs: '39241000', position: 3 },
    { id: 'cat-cafe', label: 'Café', code_hs: '0901210000', position: 4 },
    { id: 'cat-porcelaine', label: 'Porcelaine', code_hs: missingCode ? null : '6911100000', position: 5 },
  );
  f.tables.clients.find(row => row.id === CLIENT.pro).raison_sociale = 'Lagon Services SARL';
  const article = (id, description, unitPrice, categoryId) => ({ id, description, quantity: 1, unitPrice, categoryId });
  const lines = [article('l-inv-1', 'Mini scelleuse', 16.64, 'cat-cuir'), article('l-inv-2', 'Organisateur évier', 9.92, 'cat-plastique')];
  // 25 € + 19,5 kg × 5 € = 122,50 € of transport; the first article's customs code is frozen with the quote.
  const particulier = {
    schemaVersion: 1, currency: 'EUR', mode: 'final',
    inputs: { client: { type: 'particulier', nom: 'Hoarau Flavie' }, destination: { code: '974', nom: 'La Réunion', tva: 8.5 }, tarif: { base: 25, parKg: 5 }, volumetricDivisor: 5000, finalPackages: f.prepared.final_packages, lines, fees: [] },
    amounts: { realWeight: 19.5, volumetricWeight: 10.8, billableWeight: 19.5, transport: 122.5, total: 140,
      taxLines: [{ ...lines[0], value: 16.64, customDuty: { code: '42050090', label: 'Ouvrages en cuir' } }, { ...lines[1], value: 9.92 }] },
  };
  // A professional's quote: transport only, its articles are the dossier's lines.
  const professional = { schemaVersion: 1, currency: 'EUR', mode: 'final', inputs: { client: { type: 'pro' }, destination: { code: '974', nom: 'La Réunion', tva: 0 }, tarif: { base: 25, parKg: 5 }, volumetricDivisor: 5000, lines: [], fees: [] }, amounts: { transport: 65, total: 65, taxLines: [] } };
  f.tables.colis.find(row => row.id === DOSSIER.load).devis_snapshot = particulier;
  f.tables.colis.find(row => row.id === DOSSIER.shipped).devis_snapshot = particulier;
  f.tables.colis.push(
    f.dossier(DOSSIER.loadPro, 'EXP-LOAD-PRO', CLIENT.pro, { ...f.paid, devis_total: 65, paiement_montant: 65, devis_snapshot: professional, final_packages: [box(40, 30, 30, 8)], outgoing_parcel_count: 1, fin_l: 40, fin_w: 30, fin_h: 30, fin_p: 8, preparation_composition_version: 1, final_measurements_version: 1, envoi_id: DEPARTURE.reunion15 }),
    f.dossier(DOSSIER.loadWait, 'EXP-LOAD-WAIT', CLIENT.reunion, { ...f.prepared, statut: 'attente_paiement', devis_total: 140, devis_snapshot: particulier, envoi_id: DEPARTURE.reunion15 }),
  );
  // The professional's invoice replaces an older one, whose article is not declared.
  f.tables.factures.push(
    { id: 'f-inv-pro', colis_id: DOSSIER.loadPro, vendeur: 'Brûlerie du Port', montant: 105, valide: true, fichier_url: `${DOSSIER.loadPro}/facture.pdf`, replaces_facture_id: 'f-inv-old' },
    { id: 'f-inv-old', colis_id: DOSSIER.loadPro, vendeur: 'Brûlerie du Port', montant: 99, valide: true, fichier_url: `${DOSSIER.loadPro}/ancienne.pdf` },
  );
  f.tables.lignes.push(
    { id: 'l-inv-p1', colis_id: DOSSIER.loadPro, facture_id: 'f-inv-pro', description: 'Café torréfié 1 kg', qte: 4, prix_unitaire: 15, categorie_id: 'cat-cafe' },
    { id: 'l-inv-p2', colis_id: DOSSIER.loadPro, facture_id: 'f-inv-pro', description: 'Tasses en porcelaine', qte: 6, prix_unitaire: 7.5, categorie_id: 'cat-porcelaine' },
    { id: 'l-inv-old', colis_id: DOSSIER.loadPro, facture_id: 'f-inv-old', description: 'Ancienne commande remplacée', qte: 1, prix_unitaire: 99, categorie_id: 'cat-cafe' },
  );
  // The confirmed manifest, its categories as they were at the confirmation (registered last: answered first).
  f.manifestReads = 0;
  await f.context.route('**/rest/v1/rpc/get_departure_manifest', async route => {
    f.manifestReads += 1;
    const input = route.request().postDataJSON();
    const envoi = f.tables.envois.find(item => item.id === input.p_envoi_id);
    const frozen = [{ id: 'cat-cuir', label: 'Cuir', code_hs: '4205' }, { id: 'cat-plastique', label: 'Vaisselle plastique', code_hs: null }];
    const items = f.tables.colis.filter(item => item.envoi_id === input.p_envoi_id && item.date_expedition)
      .map(item => ({ colis: item, client: f.tables.clients.find(row => row.id === item.client_id), lignes: [], factures: [], categories: frozen }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ envoi, confirmed_at: envoi?.departed_at, items, deferred: [], excluded: [] }) });
  });
}

/** Opens « Documents du départ » on a card: its « Facture commerciale » block and buttons. */
async function openInvoice(f, target) {
  const documents = target.locator('details.departures-documents');
  await documents.locator('summary').filter({ hasText: 'Documents du départ' }).click();
  const invoice = documents.getByRole('region', { name: 'Facture commerciale', exact: true });
  await invoice.waitFor();
  return {
    documents, invoice,
    pdf: invoice.getByRole('button', { name: 'Facture commerciale en PDF', exact: true }),
    excel: invoice.getByRole('button', { name: 'Facture commerciale en Excel', exact: true }),
  };
}

/** Clicks and keeps the downloaded file in the output folder: its suggested name and its path. */
async function downloadOf(f, button, tag) {
  const [download] = await Promise.all([f.page.waitForEvent('download'), button.click()]);
  const name = download.suggestedFilename();
  const file = path.join(output, `${tag}-${name}`);
  await download.saveAs(file);
  return { name, path: file };
}

/** Every text item of the PDF's pages, no-break spaces read as spaces. */
async function pdfItems(file) {
  const pdfjs = await pdfjsReady;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(file)), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const items = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const content = await (await pdf.getPage(number)).getTextContent();
    items.push(...content.items.map(item => item.str.replace(/\u00a0/g, ' ')).filter(text => text.trim()));
  }
  return items;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
