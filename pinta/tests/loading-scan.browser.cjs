/* Loading control of a departure (« Vérifier le chargement » on /departs, 2026-10-07): every outgoing parcel is
 * checked before or while it is handed to the carrier, its label scanned (handheld scanner typing into the field,
 * or the tablet camera) or the dossier's parcels counted by hand. Synthetic data on a fixed clock: setup() mocks
 * every request, and its loading-control commands follow the server's rules, French sentences and HINTs
 * (browser-regression.cjs, supabase/tests/loading-checks.sql); nothing reaches Supabase.
 *
 * Fixture: Wednesday 7 October 2026, 14 h 32 in Paris; Madly Payet is signed in, Paul Hoarau scans on another
 * device. Departure ENV-2026-041 leaves today (Réunion) with EXP-2YE537 (2 parcels), EXP-4KM2PQ (1), EXP-7RT5WQ
 * (3), EXP-0042 (a legacy single measure) and EXP-9XB4ZT (1 parcel, quote not paid: to unblock). EXP-6HN3VD is on
 * ENV-2026-052 (22 October), EXP-8PL2KC on no departure. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const QRCode = require('qrcode');
const { setup, base } = require('./browser-regression.cjs');
const output = process.env.PINTA_LOADING_SCAN_OUT || '/tmp/pinta-loading-scan';
const results = [];

const NOW = new Date('2026-10-07T12:32:00Z');
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TODAY = uuid('d5000000', 1), LATER = uuid('d5000000', 2);
const CLIENT = { flavie: uuid('c5000000', 1), anli: uuid('c5000000', 2) };
const D = { two: uuid('e5000000', 1), one: uuid('e5000000', 2), three: uuid('e5000000', 3), unpaid: uuid('e5000000', 4), other: uuid('e5000000', 5), loose: uuid('e5000000', 6), legacy: uuid('e5000000', 7) };
const PAUL = uuid('a5000000', 2);
const PERMISSIONS = ['perm_colis_affecter_envoi', 'perm_colis_expedier', 'perm_envois_voir', 'perm_envois_creer', 'perm_envois_modifier', 'perm_envois_reaffecter', 'perm_export_colis', 'perm_export_factures', 'perm_export_dau'];
const only = (...granted) => Object.fromEntries(PERMISSIONS.map(key => [key, granted.includes(key)]));
const box = (dimL, dimW, dimH, poids) => ({ dimL, dimW, dimH, poids });
// « EXP-2YE537-2-2 » typed by a scanner set to an English keyboard on a French device.
const ENGLISH_LAYOUT = 'EXP)éYE("è)é)é';

async function fixture(browser, { role = 'directeur', width = 1440, height = width < 768 ? 844 : 1000, theme = 'light', permissions = null, camera = null } = {}) {
  const f = await setup(browser, role);
  if (permissions) { const row = { staff_id: f.tables.staff_users[0].id, ...permissions }; f.tables.staff_permissions = [row]; f.tables.staff_users[0].staff_permissions = [row]; }
  f.page.setDefaultTimeout(10000);
  await f.page.setViewportSize({ width, height });
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  // The browser's own Event.timeStamp, kept before Playwright's clock replaces it (see scanner()).
  await f.context.addInitScript(() => { window.__nativeTimeStamp = Object.getOwnPropertyDescriptor(Event.prototype, 'timeStamp'); });
  await f.page.clock.setFixedTime(NOW);
  f.server.now = () => NOW.getTime();
  await f.context.addInitScript(value => { try { localStorage.setItem('expedile-theme', value); } catch { /* the system theme applies */ } }, theme);
  Object.assign(f.tables.staff_users[0], { prenom: 'Madly', nom: 'Payet' });
  f.tables.staff_users.push({ id: uuid('55000000', 2), auth_id: PAUL, role: 'preparateur', nom: 'Hoarau', prenom: 'Paul', email: 'paul@example.test', actif: true, must_change_password: false, staff_permissions: [] });
  const client = (id, fields) => ({ id, user_id: null, telegram_chat_id: null, type: 'particulier', abonnement: 'freemium', onboarded: true, created_at: '2026-09-01T08:00:00Z', ...fields });
  f.tables.clients = [
    client(CLIENT.flavie, { ref: 'CLI-SCAN-01', nom: 'Hoarau', prenom: 'Flavie', email: 'flavie@example.test', cp: '97400', ville: 'Saint-Denis', adresse_ligne1: '12 rue de Paris' }),
    client(CLIENT.anli, { ref: 'CLI-SCAN-02', nom: 'Grondin', prenom: 'Anli', email: 'anli@example.test', cp: '97410', ville: 'Saint-Pierre', adresse_ligne1: '5 rue du Port' }),
  ];
  const departure = (id, ref, date) => ({ id, ref, date_depart: date, destination_code: '974', statut: 'planifie', mode_transport: 'aerien', loading_closes_at: null, departed_at: null, manifest_version: 0, nb_colis: 0, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z' });
  f.tables.envois = [departure(TODAY, 'ENV-2026-041', '2026-10-07'), departure(LATER, 'ENV-2026-052', '2026-10-22')];
  const template = structuredClone(f.tables.colis[0]);
  const paid = { statut: 'paye', quote_version: 1, devis_brouillon: false, devis_total: 140, devis_snapshot: { inputs: { destination: { code: '974' } }, amounts: { total: 140 } }, paiement_montant: 140, paiement_date: '2026-10-02T10:00:00Z' };
  const prepared = parcels => ({ final_packages: Array.from({ length: parcels }, (_, index) => box(40, 30, 30 - index * 5, 6 + index)), outgoing_parcel_count: parcels, fin_l: 40, fin_w: 30, fin_h: 30, fin_p: 6 * parcels, preparation_composition_version: 1, final_measurements_version: 1 });
  const dossier = (id, ref, clientId, fields) => ({ ...structuredClone(template), id, ref, client_id: clientId, envoi_id: TODAY, depart_souhaite: null, casier: `S-${ref.slice(-2)}`, desc_contenu: `Achats ${ref}`, updated_at: '2026-10-05T08:00:00Z', ...fields });
  f.tables.colis = [
    dossier(D.two, 'EXP-2YE537', CLIENT.flavie, { ...paid, ...prepared(2) }),
    dossier(D.one, 'EXP-4KM2PQ', CLIENT.anli, { ...paid, ...prepared(1) }),
    dossier(D.three, 'EXP-7RT5WQ', CLIENT.flavie, { ...paid, ...prepared(3) }),
    dossier(D.legacy, 'EXP-0042', CLIENT.anli, { ...paid, final_packages: [], outgoing_parcel_count: null, fin_l: 30, fin_w: 20, fin_h: 20, fin_p: 4, preparation_composition_version: null, final_measurements_version: null }),
    dossier(D.unpaid, 'EXP-9XB4ZT', CLIENT.anli, { ...prepared(1), statut: 'devis_envoye', quote_version: 1, devis_total: 90, paiement_date: null, paiement_montant: null }),
    dossier(D.other, 'EXP-6HN3VD', CLIENT.flavie, { ...paid, ...prepared(1), envoi_id: LATER }),
    dossier(D.loose, 'EXP-8PL2KC', CLIENT.flavie, { ...paid, ...prepared(1), envoi_id: null }),
  ];
  f.tables.factures = []; f.tables.lignes = []; f.tables.staff_work_actions = []; f.tables.notifications = [];
  // The camera of the test device: refused, absent, or a picture of a label (read by jsQR, or by a BarcodeDetector).
  if (camera) {
    const qr = await QRCode.toDataURL('EXP-2YE537-1-2', { margin: 4, width: 300, errorCorrectionLevel: 'M' });
    await f.context.addInitScript(({ mode, qr }) => {
      const refuse = name => () => Promise.reject(new DOMException(name === 'NotAllowedError' ? 'Permission denied' : 'Requested device not found', name));
      const media = navigator.mediaDevices || {};
      if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: media, configurable: true });
      if (mode === 'denied') media.getUserMedia = refuse('NotAllowedError');
      if (mode === 'missing') media.getUserMedia = refuse('NotFoundError');
      if (mode === 'qr' || mode === 'native') {
        window.__cameraOpened = 0;
        media.getUserMedia = async () => {
          window.__cameraOpened += 1;
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
          const context = canvas.getContext('2d');
          const image = new Image(); image.src = qr; await image.decode();
          const paint = () => { context.fillStyle = '#ffffff'; context.fillRect(0, 0, 640, 480); context.drawImage(image, 170, 90, 300, 300); };
          paint(); setInterval(paint, 80);
          return canvas.captureStream(15);
        };
      }
      // No BarcodeDetector: the QR decoder (jsQR) takes over, as on an iPad.
      if (mode === 'qr') { try { delete window.BarcodeDetector; } catch { /* not defined */ } }
      if (mode === 'native') {
        window.BarcodeDetector = class {
          static async getSupportedFormats() { return ['qr_code', 'code_128', 'ean_13']; }
          constructor(options) { window.__detectorFormats = options.formats; }
          async detect() { return [{ format: 'qr_code', rawValue: 'EXP-4KM2PQ-1-1' }]; }
        };
      }
    }, { mode: camera, qr });
  }
  f.workers = [];
  f.page.on('worker', worker => f.workers.push(worker.url()));
  f.assets = [];
  f.page.on('request', request => { if (request.url().startsWith(base)) f.assets.push(new URL(request.url()).pathname); });
  return f;
}

const review = f => f.page.getByRole('region', { name: 'Vérifier le chargement', exact: true });
const field = f => review(f).getByLabel('Scanner un colis', { exact: true });
const feedback = f => review(f).locator('.loading-scan-feedback');
const dossierRow = (f, id) => review(f).locator(`[data-loading-dossier="${id}"]`);
const normalize = text => String(text ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const checksOf = (f, id) => f.tables.departure_loading_checks.filter(row => row.colis_id === id).map(row => [row.parcel_index, row.parcel_count, row.method]).sort((a, b) => a[0] - b[0]);
const calls = (f, name) => f.requests.filter(request => request.path.endsWith(`/rpc/${name}`));
// Two frames before a picture: the page has painted its last state (with reduced motion, every change still runs a
// 0.01 ms transition that a picture taken at once can catch at its start).
const settle = f => f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const shot = async (f, name) => { await settle(f); await f.page.screenshot({ path: path.join(output, `${name}.png`) }); };
async function tallShot(f, name) {
  const viewport = f.page.viewportSize();
  const height = await f.page.evaluate(() => {
    const scroller = [...document.querySelectorAll('.overflow-y-auto')].filter(node => node.scrollHeight > node.clientHeight + 2).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    return scroller ? scroller.scrollHeight + (innerHeight - scroller.clientHeight) : document.documentElement.scrollHeight;
  });
  await f.page.setViewportSize({ width: viewport.width, height: Math.min(4000, Math.max(viewport.height, height)) });
  await settle(f);
  await f.page.screenshot({ path: path.join(output, `${name}.png`) });
  await f.page.setViewportSize(viewport);
}
async function axe(f, label) {
  const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${label}: accessibility`);
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label}: no horizontal page scroll`);
}
/** Polls until `read()` returns the expected value (CI is slower than a laptop). */
async function until(read, expected, label, timeout = 8000) {
  const end = Date.now() + timeout;
  let value;
  for (;;) {
    value = await read();
    try { assert.deepEqual(value, expected); return value; } catch (error) { if (Date.now() > end) { error.message = `${label}: ${error.message}`; throw error; } }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
const feedbackText = f => feedback(f).innerText().then(normalize);
const focusedIsField = f => field(f).evaluate(element => document.activeElement === element);

async function openLoading(f, { button = 'Vérifier et confirmer le chargement' } = {}) {
  await f.page.goto(`${base}/departs`);
  await f.page.getByRole('heading', { level: 1, name: 'Départs' }).waitFor();
  const card = f.page.locator('[data-departure-card]').filter({ has: f.page.getByRole('heading', { level: 2, name: /^ENV-2026-041 ·/ }) });
  await card.getByRole('button', { name: button, exact: true }).click();
  await review(f).waitFor();
  await field(f).waitFor();
  await until(() => focusedIsField(f), true, 'The scan field takes the focus when the loading opens');
}
/**
 * A handheld scanner, wherever the focus is: each key stamped `gap` ms after the previous one, as the device sends
 * them; « \n » is Enter. Its keys go through the DevTools protocol with their own times: Playwright's keyboard waits
 * for the page between two keys, and its clock replaces Event.timeStamp with a time read when the page first reads
 * it, so both would time the page (slower in CI) rather than the device. Two scans are at least 300 ms apart.
 */
async function scanner(f, text, gap = 4) {
  await f.page.evaluate(() => { if (window.__nativeTimeStamp) Object.defineProperty(Event.prototype, 'timeStamp', window.__nativeTimeStamp); });
  f.cdp = f.cdp || await f.context.newCDPSession(f.page);
  let at = Math.max(Date.now(), (f.scannedAt || 0) + 300);
  for (const char of text) {
    const enter = char === '\n', upper = char.toUpperCase();
    const key = enter ? 'Enter' : char, typed = enter ? '\r' : char;
    const code = enter ? 'Enter' : char === ' ' ? 'Space' : char === '-' ? 'Minus' : /^[A-Z]$/.test(upper) ? `Key${upper}` : /^\d$/.test(char) ? `Digit${char}` : '';
    const keyCode = enter ? 13 : char === ' ' ? 32 : char === '-' ? 189 : /^[A-Z0-9]$/.test(upper) ? upper.charCodeAt(0) : 0;
    await f.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, text: typed, unmodifiedText: typed, timestamp: at / 1000 });
    await f.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, timestamp: (at + 1) / 1000 });
    at += gap;
  }
  f.scannedAt = at;
}
/** A label scanned: its code, then Enter. */
const scan = (f, code) => scanner(f, `${code}\n`);
// The QR code of a former label (before October 2026): the reference, then the recipient, one line each.
const FORMER_LABEL = { one: 'EXP-4KM2PQ\nGRONDIN ANLI\n5 RUE DU PORT\n97410 SAINT-PIERRE\nLA REUNION\n0692000002\n', two: 'EXP-2YE537\nHOARAU FLAVIE\n12 RUE DE PARIS\n97400 SAINT-DENIS\nLA REUNION\n0692000001\n' };

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, options = {}) {
    if (process.env.PINTA_LOADING_SCAN_FILTER && !name.includes(process.env.PINTA_LOADING_SCAN_FILTER)) return;
    const f = await fixture(browser, options);
    try {
      await f.login(); await run(f);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
      await f.page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, `${name}-failure.txt`), await f.page.locator('body').innerText().catch(() => ''));
    } finally { await f.context.close(); console.log(JSON.stringify(results[results.length - 1])); }
  }
  try {
    // ── 1. A handheld scanner: codes in a row, repeated, unreadable, elsewhere, stale, English keyboard ──
    await scenario('scanner-codes-in-a-row-and-every-answer', async f => {
      await openLoading(f);
      assert.equal(normalize(await review(f).locator('.loading-totals').innerText()), 'Colis vérifiés 0/8 · Expéditions prêtes 0/5');
      // Two labels in a row, as fast as a scanner types: two checks, never one concatenated code.
      await scan(f, 'EXP-2YE537-1-2'); await scan(f, 'EXP-4KM2PQ-1-1');
      await until(() => [checksOf(f, D.two), checksOf(f, D.one)], [[[1, 2, 'scan']], [[1, 1, 'scan']]], 'Both labels recorded');
      assert.deepEqual(calls(f, 'record_loading_check').map(request => [request.input.p_colis_id, request.input.p_parcel_index, request.input.p_parcel_count, request.input.p_method]), [[D.two, 1, 2, 'scan'], [D.one, 1, 1, 'scan']]);
      await until(() => feedbackText(f), 'EXP-4KM2PQ · colis 1/1 vérifié Tous ses colis sont vérifiés : expédition prête à partir.', 'Last answer');
      assert.equal(await field(f).inputValue(), '', 'The field is emptied after each code');
      assert.equal(await focusedIsField(f), true, 'The field keeps the focus');
      assert.equal(await feedback(f).getAttribute('data-tone'), 'success');
      assert.equal(await feedback(f).getAttribute('role'), 'status');
      await until(() => review(f).getByRole('checkbox', { name: /EXP-4KM2PQ/ }).isChecked(), true, 'A dossier whose parcels are all checked is ticked automatically');
      assert.equal(await review(f).getByRole('checkbox', { name: /EXP-2YE537/ }).isChecked(), false);
      assert.equal(await review(f).getByRole('checkbox', { name: /EXP-2YE537/ }).isDisabled(), true, 'A dossier half checked cannot be ticked');
      assert.equal(normalize(await dossierRow(f, D.two).locator('.loading-progress').innerText()), 'Colis vérifiés 1/2 Colis 1 : vérifié Colis 2 : à vérifier');
      assert.equal(normalize(await dossierRow(f, D.one).locator('.loading-checked-by').innerText()), 'Vérifié par Madly à 14 h 32');
      assert.equal(normalize(await review(f).locator('.loading-totals').innerText()), 'Colis vérifiés 2/8 · Expéditions prêtes 1/5');
      // The checkbox says why it cannot be ticked.
      const why = await review(f).getByRole('checkbox', { name: /EXP-2YE537/ }).evaluate(element => document.getElementById(element.getAttribute('aria-describedby'))?.textContent);
      assert.equal(why, 'Cochée automatiquement dès que ses 2 colis sont vérifiés.');
      // The same label again: already checked, by whom and when; nothing changes.
      await scan(f, 'EXP-2YE537-1-2');
      await until(() => feedbackText(f), 'EXP-2YE537 · colis 1/2 déjà vérifié Vérifié par Madly à 14 h 32. Scannez un autre colis.', 'Repeated label');
      assert.equal(await feedback(f).getAttribute('data-tone'), 'warning');
      assert.deepEqual(checksOf(f, D.two), [[1, 2, 'scan']]);
      await until(() => dossierRow(f, D.two).getAttribute('data-flash'), 'warning', 'The dossier scanned is highlighted');
      // Not a label of Expedîle.
      await scan(f, '1Z999AA10123456784');
      await until(() => feedbackText(f), 'Code illisible « 1Z999AA10123456784 » n’est pas une étiquette de colis Expedîle. Scannez le code de l’étiquette (EXP-…-1-2), ou comptez les colis du dossier.', 'Unreadable code');
      assert.equal(await feedback(f).getAttribute('data-tone'), 'error');
      // A parcel of another departure, then of no departure: set aside, nothing recorded.
      const recorded = calls(f, 'record_loading_check').length;
      await scan(f, 'EXP-6HN3VD-1-1');
      await until(() => feedbackText(f), 'EXP-6HN3VD n’est pas sur ce départ Il est prévu sur le départ ENV-2026-052 du jeudi 22 octobre : mettez ce colis de côté.', 'Other departure');
      await scan(f, 'EXP-8PL2KC-1-1');
      await until(() => feedbackText(f), 'EXP-8PL2KC n’est pas sur ce départ Il n’est affecté à aucun départ : mettez ce colis de côté, ou affectez d’abord son dossier à ce départ.', 'No departure');
      assert.equal(calls(f, 'record_loading_check').length, recorded, 'Nothing is sent for a dossier of another loading');
      // A label printed for another preparation: the server's sentence.
      await scan(f, 'EXP-2YE537-3-3');
      await until(() => feedbackText(f), 'EXP-2YE537 · colis 3/3 non vérifié Étiquette périmée : ce dossier compte maintenant 2 colis. Réimprimez ses étiquettes.', 'Stale label');
      assert.equal(await feedback(f).getAttribute('data-tone'), 'error');
      assert.deepEqual(checksOf(f, D.two), [[1, 2, 'scan']]);
      await shot(f, 'scanner-stale-label-1440');
      // A scanner set to an English keyboard: the code is restored, accepted, and the setting explained.
      await scan(f, ENGLISH_LAYOUT);
      await until(() => feedbackText(f), 'EXP-2YE537 · colis 2/2 vérifié Tous ses colis sont vérifiés : expédition prête à partir. La douchette est réglée en clavier anglais : passez-la en français (AZERTY).', 'English keyboard');
      assert.deepEqual(checksOf(f, D.two), [[1, 2, 'scan'], [2, 2, 'scan']]);
      await until(() => review(f).getByRole('checkbox', { name: /EXP-2YE537/ }).isChecked(), true, 'Ticked once both parcels are checked');
      await shot(f, 'scanner-english-layout-1440');
      // A code typed while the focus is elsewhere still reaches the field.
      await review(f).getByRole('button', { name: 'Actualiser le chargement', exact: true }).focus();
      await scan(f, 'EXP-7RT5WQ-1-3');
      await until(() => checksOf(f, D.three), [[1, 3, 'scan']], 'A code typed outside the field');
      await until(() => focusedIsField(f), true, 'The field has the focus again');
      assert.deepEqual(f.tables.envois.find(row => row.id === TODAY).statut, 'planifie', 'Scanning never confirms the departure');
    });

    // ── 2. A bare reference: one parcel accepted as 1/1, several asked label by label ──
    await scenario('bare-reference-on-one-and-two-parcel-dossiers', async f => {
      await openLoading(f);
      await scan(f, 'EXP-4KM2PQ');
      await until(() => checksOf(f, D.one), [[1, 1, 'scan']], 'A bare reference is the parcel of a one-parcel dossier');
      await until(() => feedbackText(f), 'EXP-4KM2PQ · colis 1/1 vérifié Tous ses colis sont vérifiés : expédition prête à partir.', 'Bare reference, one parcel');
      await scan(f, 'EXP-0042');
      await until(() => checksOf(f, D.legacy), [[1, 1, 'scan']], 'A legacy single measure is one parcel');
      const before = calls(f, 'record_loading_check').length;
      await scan(f, 'EXP-2YE537');
      await until(() => feedbackText(f), 'EXP-2YE537 compte 2 colis : scannez l’étiquette de chaque colis ou comptez-les', 'Bare reference, two parcels');
      assert.equal(await feedback(f).getAttribute('data-tone'), 'warning');
      assert.equal(await dossierRow(f, D.two).getAttribute('data-flash'), 'warning', 'The dossier is highlighted');
      assert.equal(calls(f, 'record_loading_check').length, before, 'Nothing is recorded for a bare reference of several parcels');
      assert.deepEqual(checksOf(f, D.two), []);
      await shot(f, 'bare-reference-two-parcels-1440');
    });

    // ── 2b. A former label (its QR code: the reference, then the recipient line by line) read by a scanner that
    // turns each line into Enter: the reference is answered, the rest of the label never ──
    await scenario('former-label-typed-line-by-line-gets-one-answer', async f => {
      await f.context.addInitScript(() => {
        // The tones played (their frequencies): one per answer, none for the lines left out.
        window.__tones = [];
        if (typeof OscillatorNode !== 'function') return;
        const start = OscillatorNode.prototype.start;
        OscillatorNode.prototype.start = function (...args) { window.__tones.push(this.frequency.value); return start.apply(this, args); };
      });
      await openLoading(f);
      // Every title the answer zone shows, in order.
      await feedback(f).evaluate(zone => {
        window.__titles = [];
        new MutationObserver(() => {
          const title = zone.querySelector('.loading-scan-feedback-title')?.textContent || '';
          if (title && window.__titles[window.__titles.length - 1] !== title) window.__titles.push(title);
        }).observe(zone, { childList: true, subtree: true, characterData: true });
      });
      // Where the device has no sound (Web Audio unavailable), the titles alone say that each answer came once.
      const audible = await f.page.evaluate(() => { try { const Context = window.AudioContext || window.webkitAudioContext; new Context().close(); return true; } catch { return false; } });
      const seen = () => f.page.evaluate(() => ({ titles: window.__titles.splice(0), tones: window.__tones.splice(0) }))
        .then(({ titles, tones }) => (audible ? { titles, tones } : { titles }));
      const heard = tones => (audible ? { tones } : {});
      const settled = () => until(() => review(f).locator('.loading-pending').count(), 0, 'Every line handled');
      // The former label of a one-parcel dossier, typed at 5 ms per key: its reference is its parcel 1/1.
      await scanner(f, FORMER_LABEL.one, 5);
      await until(() => checksOf(f, D.one), [[1, 1, 'scan']], 'The reference line is checked');
      await settled();
      await until(() => feedbackText(f), 'EXP-4KM2PQ · colis 1/1 vérifié Tous ses colis sont vérifiés : expédition prête à partir.', 'Its answer stays');
      assert.deepEqual(await seen(), { titles: ['EXP-4KM2PQ · colis 1/1 vérifié'], ...heard([1046]) }, 'One answer, one tone: no « Code illisible » for the other lines');
      assert.equal(await field(f).inputValue(), '', 'Nothing left in the field');
      // The former label of a two-parcel dossier: it names no parcel; the answer says it is a former label.
      await scanner(f, FORMER_LABEL.two, 5);
      await settled();
      await until(() => feedbackText(f), 'Ancienne étiquette de EXP-2YE537 Ce dossier compte 2 colis : imprimez ses nouvelles étiquettes, une par colis, ou comptez ses colis à la main.', 'Former label explained');
      assert.equal(await feedback(f).getAttribute('data-tone'), 'warning');
      assert.deepEqual(await seen(), { titles: ['EXP-2YE537 compte 2 colis : scannez l’étiquette de chaque colis ou comptez-les', 'Ancienne étiquette de EXP-2YE537'], ...heard([660, 660]) }, 'One warning tone');
      assert.deepEqual(checksOf(f, D.two), [], 'Nothing recorded for a label that names no parcel');
      await shot(f, 'former-label-two-parcels-1440');
      // A code that is not a label, scanned on its own, is still answered.
      await scan(f, '1Z999AA10123456784');
      await until(() => feedback(f).getAttribute('data-tone'), 'error', 'An unreadable code alone is answered');
      assert.equal(calls(f, 'record_loading_check').length, 1, 'Only the one-parcel reference was sent');
    });

    // ── 3. Counting by hand, wrong then right; redoing a control ──
    for (const width of [1440, 390]) await scenario(`manual-count-wrong-then-right-and-redo-${width}`, async f => {
      await openLoading(f);
      const open = async () => {
        await dossierRow(f, D.three).getByRole('button', { name: 'Compter à la main les colis de EXP-7RT5WQ', exact: true }).click();
        const dialog = f.page.getByRole('dialog', { name: 'Compter les colis de EXP-7RT5WQ', exact: true });
        await dialog.waitFor();
        await until(() => dialog.getByLabel('Colis remis au transporteur', { exact: true }).evaluate(element => document.activeElement === element), true, 'The count field has the focus');
        return dialog;
      };
      // Closed by Escape, by a click beside it (desktop) and by its button, without writing.
      let dialog = await open();
      assert.equal(normalize(await dialog.locator('.loading-count-intro').innerText()), 'Préparation : 3 colis. Comptez les colis de ce dossier réellement remis au transporteur.');
      await f.page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      if (width > 640) { dialog = await open(); await f.page.mouse.click(8, 8); await dialog.waitFor({ state: 'detached' }); }
      dialog = await open(); await dialog.getByRole('button', { name: 'Fermer le comptage', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      assert.equal(calls(f, 'record_loading_count').length, 0);
      dialog = await open();
      const count = dialog.getByLabel('Colis remis au transporteur', { exact: true });
      await count.fill('2'); await dialog.getByRole('button', { name: 'Enregistrer le comptage', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Il manque des colis : reportez ce dossier ou retrouvez-les.' }).waitFor();
      assert.equal(await count.getAttribute('aria-invalid'), 'true');
      await shot(f, `count-missing-${width}`); await axe(f, 'Count dialog with its error');
      await count.fill('4'); await count.press('Enter');
      await dialog.getByRole('alert').filter({ hasText: 'Plus de colis que préparés (3) : retirez ceux d’un autre dossier, puis recomptez.' }).waitFor();
      assert.equal(calls(f, 'record_loading_count').length, 0, 'A wrong count is never sent');
      await count.fill('3'); await count.press('Enter');
      await dialog.waitFor({ state: 'detached' });
      assert.deepEqual(calls(f, 'record_loading_count').map(request => request.input.p_counted), [3]);
      assert.deepEqual(checksOf(f, D.three), [[1, 3, 'count'], [2, 3, 'count'], [3, 3, 'count']]);
      await until(() => feedbackText(f), 'EXP-7RT5WQ · 3 colis comptés à la main Tous ses colis sont vérifiés : expédition prête à partir.', 'Count recorded');
      await until(() => dossierRow(f, D.three).locator('.loading-checked-by').innerText().then(normalize), 'Vérifié par Madly à 14 h 32 (comptage à la main)', 'Who and when');
      await until(() => review(f).getByRole('checkbox', { name: /EXP-7RT5WQ/ }).isChecked(), true, 'Counted dossier ticked');
      await until(() => focusedIsField(f), true, 'The scan field has the focus back after a count');
      // Redo: confirmed first, then every check of the dossier is removed for every device.
      await dossierRow(f, D.three).getByRole('button', { name: 'Recommencer le contrôle de EXP-7RT5WQ', exact: true }).click();
      const confirmRedo = f.page.getByRole('dialog', { name: 'Recommencer le contrôle de EXP-7RT5WQ ?', exact: true });
      await confirmRedo.waitFor();
      await confirmRedo.getByRole('button', { name: 'Recommencer le contrôle', exact: true }).click();
      await confirmRedo.waitFor({ state: 'detached' });
      await until(() => checksOf(f, D.three), [], 'Checks cleared on the server');
      await until(() => feedbackText(f), 'EXP-7RT5WQ · contrôle à refaire Ses contrôles sont effacés sur tous les appareils : scannez ou comptez de nouveau ses colis.', 'Cleared');
      await until(() => review(f).getByRole('checkbox', { name: /EXP-7RT5WQ/ }).isChecked(), false, 'Unticked once cleared');
      assert.equal(normalize(await dossierRow(f, D.three).locator('.loading-progress-count').innerText()), 'Colis vérifiés 0/3');
      assert.equal(f.tables.audit_actions.filter(row => row.action === 'loading_checks_cleared').length, 1, 'The clearing is audited');
      await until(() => focusedIsField(f), true, 'The scan field has the focus back after a clearing');
      // « L’effacement reste inscrit dans l’historique du dossier »: named in words there.
      if (width > 640) {
        await f.page.goto(`${base}/colis/${D.three}`);
        await f.page.getByRole('button', { name: 'Consulter l’historique du dossier', exact: true }).click();
        const history = f.page.getByRole('dialog', { name: 'Contexte du dossier', exact: true }).getByTestId('dossier-history');
        await history.getByText('Contrôle du chargement recommencé', { exact: true }).waitFor();
      }
    }, { width });

    // ── 4. Automatic ticks, deferral and the confirmation after full checks ──
    await scenario('automatic-ticks-deferral-and-confirmation', async f => {
      await openLoading(f);
      const confirmButton = () => review(f).getByRole('button', { name: /^Confirmer le départ de/ });
      assert.equal(await confirmButton().isDisabled(), true, 'Nothing to confirm before a check');
      for (const code of ['EXP-2YE537-1-2', 'EXP-2YE537-2-2', 'EXP-4KM2PQ-1-1']) await scan(f, code);
      await until(() => [checksOf(f, D.two).length, checksOf(f, D.one).length], [2, 1], 'Three labels recorded');
      await until(() => confirmButton().innerText().then(normalize), 'Confirmer le départ de 2 expéditions', 'Two dossiers ticked');
      // A ticked dossier set aside is deferred with the others; ticked again, it leaves.
      const setAside = review(f).getByRole('checkbox', { name: /EXP-4KM2PQ/ });
      await setAside.uncheck();
      const why = await setAside.evaluate(element => document.getElementById(element.getAttribute('aria-describedby'))?.textContent);
      assert.equal(why, 'Décochée : ce dossier sera reporté.');
      assert.equal(normalize(await confirmButton().innerText()), 'Confirmer le départ de 1 expédition');
      // The next label, scanned while the focus is still on that box: checked as a scan, the box keeps its choice.
      assert.equal(await setAside.evaluate(element => document.activeElement === element), true, 'The box just unticked has the focus');
      await scan(f, 'EXP-7RT5WQ-1-3');
      await until(() => checksOf(f, D.three), [[1, 3, 'scan']], 'A label scanned with the focus on a dossier box');
      assert.deepEqual(calls(f, 'record_loading_check').filter(request => request.input.p_colis_id === D.three).map(request => request.input.p_method), ['scan'], 'Recorded once');
      await until(() => focusedIsField(f), true, 'The scan field has the focus');
      assert.equal(await setAside.isChecked(), false, 'Still set aside');
      // Space on a box still ticks and unticks it.
      await setAside.focus();
      await f.page.keyboard.press(' ');
      await until(() => setAside.isChecked(), true, 'Space ticks the box');
      await f.page.keyboard.press(' ');
      await until(() => setAside.isChecked(), false, 'Space unticks the box');
      assert.equal(await setAside.evaluate(element => document.activeElement === element), true, 'Space never goes to the scan field');
      // The person's choice stays in this tab: the page reloaded, the loading reopens with it.
      await f.page.reload();
      await review(f).waitFor();
      await until(() => review(f).getByRole('checkbox', { name: /EXP-2YE537/ }).isChecked(), true, 'Checked dossier still ticked after a reload');
      assert.equal(await review(f).getByRole('checkbox', { name: /EXP-4KM2PQ/ }).isChecked(), false, 'Set aside, still');
      await review(f).getByRole('checkbox', { name: /EXP-4KM2PQ/ }).check();
      await review(f).getByRole('checkbox', { name: /EXP-7RT5WQ/ }).evaluate(element => element.disabled).then(disabled => assert.equal(disabled, true));
      await confirmButton().click();
      await review(f).getByRole('alert').filter({ hasText: 'Indiquez le motif du report des autres dossiers.' }).waitFor();
      assert.equal(calls(f, 'confirm_departure').length, 0);
      await review(f).getByRole('textbox', { name: 'Motif du report des dossiers non cochés' }).fill('Colis non remis au transporteur');
      await until(() => review(f).getByRole('alert').count(), 0, 'The reason asked for, once written, is no longer asked for');
      // A label scanned while the reason has the focus is checked as a scan, never written into the reason.
      await scan(f, 'EXP-7RT5WQ-2-3');
      await until(() => checksOf(f, D.three), [[1, 3, 'scan'], [2, 3, 'scan']], 'A label scanned from the reason field is checked');
      await until(() => review(f).getByRole('textbox', { name: 'Motif du report des dossiers non cochés' }).inputValue(), 'Colis non remis au transporteur', 'The reason keeps only what was written');
      await until(() => focusedIsField(f), true, 'The scan field takes the focus back');
      assert.equal(normalize(await review(f).getByText(/expéditions? cochées?/).innerText()), '2 expéditions cochées · 3 à reporter.');
      await tallShot(f, 'ready-to-confirm-1440');
      await confirmButton().click();
      await f.page.getByRole('region', { name: 'Manifeste confirmé', exact: true }).waitFor();
      const [call] = calls(f, 'confirm_departure');
      assert.deepEqual(call.input.p_loaded.map(item => [item.id, item.outgoing_parcel_count]).sort(), [[D.two, 2], [D.one, 1]].sort());
      assert.equal(call.input.p_deferred_reason, 'Colis non remis au transporteur');
      assert.deepEqual([D.two, D.one, D.three, D.legacy, D.unpaid].map(id => { const row = f.tables.colis.find(item => item.id === id); return [row.ref, row.statut, row.envoi_id === TODAY]; }),
        [['EXP-2YE537', 'expedie', true], ['EXP-4KM2PQ', 'expedie', true], ['EXP-7RT5WQ', 'paye', false], ['EXP-0042', 'paye', false], ['EXP-9XB4ZT', 'devis_envoye', false]]);
      const manifest = f.tables.departure_manifests[0].snapshot;
      assert.deepEqual(manifest.items.map(item => [item.colis.ref, item.loading_checks.map(check => [check.parcel_index, check.method, check.checked_by_name])]).sort(),
        [['EXP-2YE537', [[1, 'scan', 'Madly Payet'], [2, 'scan', 'Madly Payet']]], ['EXP-4KM2PQ', [[1, 'scan', 'Madly Payet']]]]);
      assert.equal(await review(f).count(), 0, 'The loading closes once confirmed');
    });

    // ── 4a. A parcel code written by hand in the reason stays text; the same code scanned there is a scan ──
    await scenario('hand-typed-code-in-the-reason-stays-text', async f => {
      await openLoading(f);
      await scan(f, 'EXP-2YE537-1-2');
      await until(() => checksOf(f, D.two), [[1, 2, 'scan']], 'First parcel scanned');
      const reason = review(f).getByRole('textbox', { name: 'Motif du report des dossiers non cochés' });
      await reason.click();
      // A person writes which parcel is missing, at a person's speed, then Enter: a new line of the reason.
      await f.page.keyboard.type('Colis manquant EXP-2YE537-2/2', { delay: 120 });
      await f.page.keyboard.press('Enter');
      await until(() => reason.inputValue(), 'Colis manquant EXP-2YE537-2/2\n', 'The reason keeps what was written');
      await new Promise(resolve => setTimeout(resolve, 800));
      assert.deepEqual(checksOf(f, D.two), [[1, 2, 'scan']], 'The parcel written as missing is not checked');
      assert.equal(calls(f, 'record_loading_check').length, 1, 'Nothing sent');
      assert.equal(await reason.evaluate(element => document.activeElement === element), true, 'The reason keeps the focus');
      assert.equal(await review(f).getByRole('checkbox', { name: /EXP-2YE537/ }).isChecked(), false);
      // The same label scanned there: checked, never written into the reason.
      await scan(f, 'EXP-2YE537-2-2');
      await until(() => checksOf(f, D.two), [[1, 2, 'scan'], [2, 2, 'scan']], 'A label scanned in the reason is checked');
      await until(() => reason.inputValue(), 'Colis manquant EXP-2YE537-2/2', 'Only what was written stays');
      await until(() => focusedIsField(f), true, 'The scan field takes the focus back');
    });

    // ── 4b. A reading of the loading still under way when the departure is confirmed never reopens it ──
    await scenario('late-reading-never-reopens-a-confirmed-loading', async f => {
      await openLoading(f);
      for (const code of ['EXP-2YE537-1-2', 'EXP-2YE537-2-2', 'EXP-4KM2PQ-1-1']) await scan(f, code);
      await until(() => [checksOf(f, D.two).length, checksOf(f, D.one).length], [2, 1], 'Three labels recorded');
      await review(f).getByRole('textbox', { name: 'Motif du report des dossiers non cochés' }).fill('Colis non remis au transporteur');
      // The next reading of the departure's dossiers is held until the confirmation is done.
      let release; const held = new Promise(resolve => { release = resolve; }); let holding = true;
      await f.context.route('**/rest/v1/colis?**', async route => {
        if (holding && route.request().url().includes(`envoi_id=eq.${TODAY}`)) { holding = false; await held; }
        return route.fallback();
      });
      await field(f).focus();
      await scan(f, 'EXP-2YE537-3-3');
      await until(() => feedback(f).getAttribute('data-tone'), 'error', 'A stale label is refused, the loading is read again');
      await review(f).getByRole('button', { name: 'Confirmer le départ de 2 expéditions', exact: true }).click();
      await f.page.getByRole('region', { name: 'Manifeste confirmé', exact: true }).waitFor();
      const landed = f.page.waitForResponse(response => response.url().includes(`envoi_id=eq.${TODAY}`));
      release();
      await landed;
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal(await review(f).count(), 0, 'The reading that lands after the confirmation does not reopen the loading');
      await f.page.getByRole('region', { name: 'Manifeste confirmé', exact: true }).waitFor();
    });

    // ── 5. Shared progress: checks of another device appear; a check removed meanwhile is refused at confirmation ──
    await scenario('shared-progress-between-devices', async f => {
      await openLoading(f);
      const other = (colisId, index, count) => f.tables.departure_loading_checks.push({ envoi_id: TODAY, colis_id: colisId, parcel_index: index, parcel_count: count, method: 'camera', checked_by: PAUL, checked_at: NOW.toISOString() });
      other(D.two, 1, 2);
      await until(() => dossierRow(f, D.two).locator('.loading-progress-count').innerText().then(normalize), 'Colis vérifiés 1/2', 'Another device\'s check appears within 5 s', 9000);
      other(D.two, 2, 2);
      await until(() => review(f).getByRole('checkbox', { name: /EXP-2YE537/ }).isChecked(), true, 'Completed on another device: ticked', 9000);
      assert.equal(normalize(await dossierRow(f, D.two).locator('.loading-checked-by').innerText()), 'Vérifié par Paul à 14 h 32');
      // Cleared on the other device: unticked here too.
      f.tables.departure_loading_checks = f.tables.departure_loading_checks.filter(row => row.colis_id !== D.two);
      await until(() => review(f).getByRole('checkbox', { name: /EXP-2YE537/ }).isChecked(), false, 'Cleared elsewhere: unticked', 9000);
      // A dossier assigned to the departure on another device after the loading opened: its label is recognised.
      f.tables.colis.find(row => row.id === D.loose).envoi_id = TODAY;
      await scan(f, 'EXP-8PL2KC-1-1');
      await until(() => checksOf(f, D.loose), [[1, 1, 'scan']], 'The loading read again finds the dossier');
      await until(() => review(f).getByRole('checkbox', { name: /EXP-8PL2KC/ }).isChecked(), true, 'Listed and ticked');
      // A check removed on another device just before the confirmation: the server refuses, the screen reads again.
      await scan(f, 'EXP-4KM2PQ-1-1');
      await until(() => review(f).getByRole('checkbox', { name: /EXP-4KM2PQ/ }).isChecked(), true, 'Scanned here');
      await review(f).getByRole('textbox', { name: 'Motif du report des dossiers non cochés' }).fill('Contrôle à terminer');
      // Removed on the other device at the very moment of the confirmation (never by a refresh of this screen first).
      await f.context.route('**/rest/v1/rpc/confirm_departure', route => {
        f.tables.departure_loading_checks = f.tables.departure_loading_checks.filter(row => row.colis_id !== D.one);
        return route.fallback();
      });
      await review(f).getByRole('button', { name: 'Confirmer le départ de 2 expéditions', exact: true }).click();
      await review(f).getByRole('alert').filter({ hasText: 'Contrôle incomplet : EXP-4KM2PQ (0/1 colis vérifié). Scannez ou comptez ses colis, ou reportez-le.' }).waitFor();
      await until(() => review(f).getByRole('checkbox', { name: /EXP-4KM2PQ/ }).isChecked(), false, 'Read again after the refusal');
      assert.equal(f.tables.envois.find(row => row.id === TODAY).statut, 'planifie');
      // Scanned again: the refusal no longer describes the loading and leaves.
      await scan(f, 'EXP-4KM2PQ-1-1');
      await until(() => review(f).getByRole('checkbox', { name: /EXP-4KM2PQ/ }).isChecked(), true, 'Scanned again');
      await until(() => review(f).getByRole('alert').count(), 0, 'The former refusal leaves once the loading changed');
      const reads = calls(f, 'get_loading_checks').length;
      assert.ok(reads >= 4, `Checks read regularly (${reads})`);
    });

    // ── 5a. A dossier prepared again on another device (new labels) while the loading is open: the server's counts
    // are shown, and the screen reads the dossier's preparation again for a scan or a count ──
    await scenario('dossier-prepared-again-on-another-device', async f => {
      await openLoading(f);
      await scan(f, 'EXP-2YE537-1-2');
      await until(() => checksOf(f, D.two), [[1, 2, 'scan']], 'A label of the former preparation');
      // A parcel split on another device: three parcels, new labels; this screen still shows two.
      Object.assign(f.tables.colis.find(row => row.id === D.two), { final_packages: [box(40, 30, 25, 5), box(30, 30, 20, 4), box(20, 20, 20, 4)], outgoing_parcel_count: 3, fin_p: 13, updated_at: '2026-10-07T12:31:00Z' });
      await scan(f, 'EXP-2YE537-1-3');
      await until(() => feedbackText(f), 'EXP-2YE537 · colis 1/3 vérifié Il reste 2 colis à vérifier pour ce dossier.', 'The answer counts the new preparation');
      await until(() => dossierRow(f, D.two).locator('.loading-progress-count').innerText().then(normalize), 'Colis vérifiés 1/3', 'The dossier is read again with its three parcels');
      assert.deepEqual(checksOf(f, D.two), [[1, 3, 'scan']], 'The check of the former label is replaced');
      // Two parcels merged on another device: the count of the three parcels shown here is refused by the server,
      // the dialog then shows the new number and accepts it.
      Object.assign(f.tables.colis.find(row => row.id === D.three), { final_packages: [box(40, 30, 30, 9), box(40, 30, 25, 12)], outgoing_parcel_count: 2, updated_at: '2026-10-07T12:31:30Z' });
      await dossierRow(f, D.three).getByRole('button', { name: 'Compter à la main les colis de EXP-7RT5WQ', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Compter les colis de EXP-7RT5WQ', exact: true });
      const count = dialog.getByLabel('Colis remis au transporteur', { exact: true });
      await count.fill('3'); await count.press('Enter');
      await dialog.getByRole('alert').filter({ hasText: 'Comptage différent : EXP-7RT5WQ compte 2 colis, vous en avez compté 3. Recomptez ses colis, ou reportez-le.' }).waitFor();
      await until(() => dialog.locator('.loading-count-intro').innerText().then(normalize), 'Préparation : 2 colis. Comptez les colis de ce dossier réellement remis au transporteur.', 'The dialog shows the new preparation');
      await count.fill('2'); await count.press('Enter');
      await dialog.waitFor({ state: 'detached' });
      assert.deepEqual(checksOf(f, D.three), [[1, 2, 'count'], [2, 2, 'count']]);
      await until(() => review(f).getByRole('checkbox', { name: /EXP-7RT5WQ/ }).isChecked(), true, 'Counted on its new preparation: ticked');
    });

    // ── 5b. Reading failures: a loading whose checks cannot be read does not open; a failed refresh says so ──
    await scenario('loading-without-its-checks-does-not-open', async f => {
      await f.context.route('**/rest/v1/rpc/get_loading_checks', route => route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.get_loading_checks(p_envoi_id) in the schema cache', details: null, hint: null }) }));
      await f.page.goto(`${base}/departs`);
      const card = f.page.locator('[data-departure-card]').filter({ has: f.page.getByRole('heading', { level: 2, name: /^ENV-2026-041 ·/ }) });
      await card.getByRole('button', { name: 'Vérifier et confirmer le chargement', exact: true }).click();
      await card.getByRole('alert').filter({ hasText: 'Le contrôle du chargement n’est pas encore disponible sur le serveur. Prévenez la direction.' }).waitFor();
      assert.equal(await review(f).count(), 0, 'Without its checks, the loading is not shown as if nothing were checked');
      await until(() => new URL(f.page.url()).searchParams.has('loading'), false, 'The link is not kept');
      await shot(f, 'checks-unavailable-1440');
    });
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) await scenario(`failed-refresh-keeps-the-checks-and-says-so-${width}-${theme}`, async f => {
      await openLoading(f);
      await scan(f, 'EXP-4KM2PQ-1-1');
      await until(() => review(f).getByRole('checkbox', { name: /EXP-4KM2PQ/ }).isChecked(), true, 'Scanned');
      f.failChecks = true;
      await f.context.route('**/rest/v1/rpc/get_loading_checks', route => (f.failChecks
        ? route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'Service indisponible' }) })
        : route.fallback()));
      const warning = review(f).locator('.loading-warning');
      await until(() => warning.allInnerTexts().then(texts => normalize(texts.join(' '))), 'Les contrôles des autres appareils n’ont pas pu être relus : ceux affichés datent de la dernière lecture. Nouvel essai toutes les 5 secondes.', 'Failed refresh stated', 9000);
      assert.equal(await review(f).getByRole('checkbox', { name: /EXP-4KM2PQ/ }).isChecked(), true, 'The last checks read stay shown');
      await shot(f, `failed-refresh-${width}-${theme}`); await axe(f, 'Failed refresh');
      f.failChecks = false;
      await until(() => warning.count(), 0, 'The warning leaves once the checks are read again', 9000);
    }, { width, theme });

    // ── 6. A person who scans without confirming ──
    await scenario('scan-only-person-checks-without-confirming', async f => {
      await openLoading(f, { button: 'Vérifier le chargement' });
      assert.equal(await review(f).getByRole('checkbox').count(), 0, 'No box: the selection belongs to the person who confirms');
      assert.equal(await review(f).getByRole('button', { name: /^Confirmer le départ/ }).count(), 0);
      assert.equal(await review(f).getByRole('textbox', { name: 'Motif du report des dossiers non cochés' }).count(), 0);
      await review(f).getByText('La confirmation du départ est réservée à la direction et aux personnes autorisées à modifier les départs et à expédier les colis', { exact: false }).waitFor();
      await scan(f, 'EXP-4KM2PQ-1-1');
      await until(() => checksOf(f, D.one), [[1, 1, 'scan']], 'Scan recorded with the permission to ship alone');
      await dossierRow(f, D.one).getByText('Prête à partir', { exact: true }).waitFor();
      await shot(f, 'scan-only-1440'); await axe(f, 'Scan-only loading');
    }, { role: 'preparateur', permissions: only('perm_envois_voir', 'perm_colis_expedier') });
    await scenario('no-loading-without-the-permission-to-ship', async f => {
      await f.page.goto(`${base}/departs?loading=${TODAY}`);
      await f.page.locator('[data-departure-card]').first().waitFor();
      assert.equal(await f.page.getByRole('button', { name: /^Vérifier (et confirmer )?le chargement$/ }).count(), 0);
      await until(() => new URL(f.page.url()).searchParams.has('loading'), false, 'The link without permission does not open the loading');
      assert.equal(await review(f).count(), 0);
      assert.equal(calls(f, 'get_loading_checks').length, 0);
    }, { role: 'logisticien', permissions: only('perm_envois_voir', 'perm_envois_modifier') });

    // ── 7. Camera ──
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) await scenario(`camera-refused-explains-and-closes-${width}-${theme}`, async f => {
      await openLoading(f);
      // An answer given before the camera opens (a code typed with the scanner) is not repeated in the camera panel.
      await scan(f, '1Z999AA10123456784');
      await until(() => feedback(f).getAttribute('data-tone'), 'error', 'An answer before the camera');
      const button = review(f).getByRole('button', { name: 'Scanner avec la caméra', exact: true });
      await button.click();
      const dialog = f.page.getByRole('dialog', { name: 'Scanner avec la caméra', exact: true });
      await dialog.getByRole('alert').filter({ hasText: 'Accès à la caméra refusé. Autorisez la caméra pour ce site dans les réglages du navigateur, puis réessayez ; la douchette et la saisie restent disponibles.' }).waitFor();
      assert.equal(await dialog.getAttribute('data-state'), 'error');
      assert.deepEqual([normalize(await dialog.locator('.loading-scan-feedback').innerText()), await dialog.locator('.loading-scan-feedback').getAttribute('data-tone')], ['', null], 'The camera panel shows only what the camera reads');
      assert.equal(f.assets.some(item => item.includes('cameraScanWorker')), false, 'No decoder loaded for a refused camera');
      await shot(f, `camera-refused-${width}-${theme}`); await axe(f, 'Camera refused');
      // « La douchette reste disponible »: a label scanned now is checked as a scan, its Enter never closes the dialog.
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement) && document.activeElement.tagName), 'BUTTON', 'A button of the dialog has the focus');
      await scan(f, 'EXP-7RT5WQ-1-3');
      await until(() => checksOf(f, D.three), [[1, 3, 'scan']], 'A scanner label while the camera is open');
      assert.deepEqual(calls(f, 'record_loading_check').map(request => request.input.p_method), ['scan']);
      await until(() => dialog.locator('.loading-scan-feedback').innerText().then(normalize), 'EXP-7RT5WQ · colis 1/3 vérifié Il reste 2 colis à vérifier pour ce dossier.', 'Its answer in the camera panel');
      // A former label, line by line (its spaces included): one answer, the dialog still open.
      await scanner(f, FORMER_LABEL.one, 5);
      await until(() => checksOf(f, D.one), [[1, 1, 'scan']], 'The former label of a one-parcel dossier');
      await until(() => review(f).locator('.loading-pending').count(), 0, 'Every line handled');
      await until(() => dialog.locator('.loading-scan-feedback').innerText().then(normalize), 'EXP-4KM2PQ · colis 1/1 vérifié Tous ses colis sont vérifiés : expédition prête à partir.', 'One answer for the former label');
      assert.equal(await dialog.count(), 1, 'The dialog stays open');
      assert.equal(await dialog.getAttribute('data-state'), 'error');
      await shot(f, `camera-refused-scanner-${width}-${theme}`);
      if (width > 640) {
        // A key pressed by mistake, long before, never takes the button's key: Space presses « Fermer la caméra ».
        await f.page.keyboard.press('a');
        await new Promise(resolve => setTimeout(resolve, 1100));
        await f.page.keyboard.press(' ');
      } else await f.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await until(() => button.evaluate(element => document.activeElement === element), true, 'The focus goes back to the camera button');
      // The scan field still works after the camera.
      await scan(f, 'EXP-2YE537-2-2');
      await until(() => checksOf(f, D.two), [[2, 2, 'scan']], 'Scanner after the camera');
    }, { width, theme, camera: 'denied' });
    await scenario('camera-missing-explains', async f => {
      await openLoading(f);
      await review(f).getByRole('button', { name: 'Scanner avec la caméra', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Scanner avec la caméra', exact: true });
      await dialog.getByRole('alert').filter({ hasText: 'Aucune caméra disponible sur cet appareil. Utilisez la douchette ou saisissez le code de l’étiquette.' }).waitFor();
      // Tried again on demand: still no camera, the same explanation.
      await dialog.getByRole('button', { name: 'Réessayer', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Aucune caméra disponible sur cet appareil.' }).waitFor();
      await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    }, { camera: 'missing' });
    await scenario('camera-reads-a-label-with-the-qr-decoder-once', async f => {
      await openLoading(f);
      assert.equal(f.assets.some(item => item.includes('cameraScanWorker')), false, 'The QR decoder is not loaded with the page');
      await review(f).getByRole('button', { name: 'Scanner avec la caméra', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Scanner avec la caméra', exact: true });
      await until(() => checksOf(f, D.two), [[1, 2, 'camera']], 'The label in front of the camera is checked', 15000);
      assert.equal(await dialog.getAttribute('data-decoder'), 'qr');
      assert.ok(f.workers.some(url => url.includes('cameraScanWorker')), `The QR decoder runs in a worker (${f.workers.join(', ')})`);
      await until(() => dialog.locator('.loading-scan-feedback').innerText().then(normalize), 'EXP-2YE537 · colis 1/2 vérifié Il reste 1 colis à vérifier pour ce dossier.', 'Answer shown in the camera panel');
      assert.equal(await dialog.locator('.loading-scan-feedback').getAttribute('role'), 'status');
      assert.equal(await feedback(f).getAttribute('aria-live'), 'off', 'One live region at a time');
      // The label stays in view: read once, not again and again.
      await new Promise(resolve => setTimeout(resolve, 2500));
      assert.equal(calls(f, 'record_loading_check').length, 1, 'The same code is ignored while it stays in view');
      await shot(f, 'camera-reading-1440');
      // The scanner while the camera reads: its label is checked as a scan, its answer shown here, the camera stays.
      await scan(f, 'EXP-7RT5WQ-1-3');
      await until(() => checksOf(f, D.three), [[1, 3, 'scan']], 'A scanner label while the camera reads');
      assert.deepEqual(calls(f, 'record_loading_check').map(request => [request.input.p_colis_id, request.input.p_method]), [[D.two, 'camera'], [D.three, 'scan']]);
      await until(() => dialog.locator('.loading-scan-feedback').innerText().then(normalize), 'EXP-7RT5WQ · colis 1/3 vérifié Il reste 2 colis à vérifier pour ce dossier.', 'The scanner\'s answer in the camera panel');
      assert.equal(await dialog.getAttribute('data-state'), 'scanning', 'The camera keeps reading');
      await f.page.mouse.click(8, 8);
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await f.page.evaluate(() => window.__cameraOpened), 1);
      await until(() => dossierRow(f, D.two).locator('.loading-progress-count').innerText().then(normalize), 'Colis vérifiés 1/2', 'Progress on the page');
    }, { camera: 'qr' });
    await scenario('camera-uses-the-browser-reader-when-it-has-one', async f => {
      await openLoading(f);
      await review(f).getByRole('button', { name: 'Scanner avec la caméra', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Scanner avec la caméra', exact: true });
      await until(() => checksOf(f, D.one), [[1, 1, 'camera']], 'Read by the BarcodeDetector');
      assert.equal(await dialog.getAttribute('data-decoder'), 'native');
      assert.deepEqual(await f.page.evaluate(() => window.__detectorFormats), ['qr_code', 'code_128']);
      assert.equal(f.assets.some(item => item.includes('cameraScanWorker')), false, 'No QR decoder to load');
      await dialog.getByRole('button', { name: 'Fermer la caméra', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    }, { camera: 'native' });

    // ── 7b. A narrow phone with the wider fonts of Linux (CI): nothing leaves the screen ──
    await scenario('narrow-phone-with-wide-fonts-keeps-everything-in-view', async f => {
      // Applied to every page from now on (the next navigation opens the departures).
      await f.context.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const style = document.createElement('style'); style.textContent = '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }'; document.head.appendChild(style); }));
      await openLoading(f);
      for (const code of ['EXP-2YE537-1-2', 'EXP-6HN3VD-1-1']) await scan(f, code);
      await until(() => feedback(f).getAttribute('data-tone'), 'error', 'Error shown');
      const inView = await f.page.evaluate(() => [...document.querySelectorAll('.loading-scan-row > *, .loading-totals, .loading-scan-feedback, .loading-dossier-check')].every(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 0.5; }));
      assert.equal(inView, true, 'The scan bar and the dossiers stay inside the screen');
      await axe(f, 'Narrow phone, wide fonts');
      await dossierRow(f, D.three).getByRole('button', { name: 'Compter à la main les colis de EXP-7RT5WQ', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Compter les colis de EXP-7RT5WQ', exact: true });
      await dialog.waitFor();
      assert.equal(await dialog.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 0.5 && element.scrollWidth <= element.clientWidth + 1; }), true, 'The count dialog fits');
      await shot(f, 'narrow-phone-wide-fonts-count');
    }, { width: 320, height: 640 });

    // ── 7c. A phone: the scanned dossier lands under the scan bar, however long the last answer ──
    await scenario('phone-scanned-dossier-lands-under-the-scan-bar', async f => {
      await openLoading(f);
      const placement = id => f.page.evaluate(id => {
        const bar = document.querySelector('.loading-scan-bar').getBoundingClientRect();
        const row = document.querySelector(`[data-loading-dossier="${id}"]`);
        const name = row.querySelector('.loading-dossier-name').getBoundingClientRect();
        const hit = document.elementFromPoint(name.left + 4, name.top + name.height / 2);
        // The first dossier of a group: its group's title, whole, above it.
        const title = row.previousElementSibling && row.previousElementSibling.classList.contains('loading-group-title') ? row.previousElementSibling.getBoundingClientRect() : null;
        return { barBottom: Math.round(bar.bottom), nameTop: Math.round(name.top), nameBottom: Math.round(name.bottom), titleTop: title ? Math.round(title.top) : null, inView: name.bottom <= innerHeight, visible: Boolean(hit && row.contains(hit)) };
      }, id);
      // Below the screen, then above it, then after a long answer (a stale label: three lines in the bar).
      for (const [code, id, answer] of [
        ['EXP-0042', D.legacy, 'EXP-0042 · colis 1/1 vérifié'],
        ['EXP-2YE537-1-2', D.two, 'EXP-2YE537 · colis 1/2 vérifié'],
        ['EXP-2YE537-3-3', D.two, 'EXP-2YE537 · colis 3/3 non vérifié'],
      ]) {
        await scan(f, code);
        await until(() => feedback(f).locator('.loading-scan-feedback-title').innerText().then(normalize), answer, `Answer to ${code}`);
        await until(() => review(f).locator('.loading-pending').count(), 0, `${code} handled`);
        await settle(f);
        const where = await placement(id);
        assert.ok(where.nameTop >= where.barBottom && where.inView && where.visible && (where.titleTop === null || where.titleTop >= where.barBottom), `${code}: the dossier under the bar, in view (${JSON.stringify(where)})`);
      }
      await shot(f, 'phone-stale-label-dossier-under-the-bar-390');
    }, { width: 390 });

    // ── 8. Every state, light and dark, desktop and phone, with axe ──
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`states-${theme}-${width}`, async f => {
      await openLoading(f);
      await shot(f, `${theme}-${width}-opened`); await axe(f, 'Loading opened');
      for (const code of ['EXP-2YE537-1-2', 'EXP-4KM2PQ-1-1', 'EXP-0042']) await scan(f, code);
      await until(() => [checksOf(f, D.two).length, checksOf(f, D.one).length, checksOf(f, D.legacy).length], [1, 1, 1], 'Scans recorded');
      await scan(f, 'EXP-2YE537');
      await until(() => feedback(f).getAttribute('data-tone'), 'warning', 'Warning shown');
      await shot(f, `${theme}-${width}-warning`); await axe(f, 'Loading with a warning');
      await tallShot(f, `${theme}-${width}-progress`);
      await scan(f, 'EXP-6HN3VD-1-1');
      await until(() => feedback(f).getAttribute('data-tone'), 'error', 'Error shown');
      await shot(f, `${theme}-${width}-error`); await axe(f, 'Loading with an error');
      await dossierRow(f, D.three).getByRole('button', { name: 'Compter à la main les colis de EXP-7RT5WQ', exact: true }).click();
      await f.page.getByRole('dialog', { name: 'Compter les colis de EXP-7RT5WQ', exact: true }).waitFor();
      await shot(f, `${theme}-${width}-count`); await axe(f, 'Count dialog');
      await f.page.keyboard.press('Escape');
    }, { theme, width });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ base, passed: results.filter(r => r.pass).length, total: results.length, results }, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
