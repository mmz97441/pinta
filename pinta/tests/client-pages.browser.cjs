/* Staff client pages: /clients (list and import), /clients/new, /clients/:id and
 * the shared tracking link. setup() mocks every request; nothing reaches Supabase,
 * Telegram, an email provider or PayPlug. The save_client_subscription command is
 * modelled below (permission, expected values, returned values).
 *
 * Fixture: Exemple Camille (base client, one open dossier, no Telegram), Boutique
 * Kréol (professional, Telegram linked, long name and email, one paid dossier),
 * Flavie Payet (VIP, portal and Telegram linked, a delivered and an archived paid
 * dossier), Jean-Marc Hoarau (Telegram username only, stored with a legacy @),
 * Marie-Christine Grondin (email and phone).
 *
 * Covers the final review of the client pages: one coherent save per tab (1),
 * load failures (2), empty and no-result states (3), search and Telegram contact
 * (4, 5), the new client form (6), dark mode and contrast (7), 44px targets (8),
 * the import window (9), the explained disabled invitation (10), wording and
 * layout (11), at 1440 and 390 px in both themes, with axe.
 * Required client information (decision of 7 October 2026): creation blocked
 * by each missing or invalid field, import rows refused with their reason, an
 * older incomplete record completed step by step, a filled field never emptied,
 * the database refusal (SQLSTATE 23514) shown and never a success, and the
 * « Compléter la fiche » link (?completer=<champ>) opening and focusing the field. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_CLIENT_PAGES_OUT || '/tmp/pinta-client-pages';
const results = [];

const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLIENT = { exemple: ids.C, boutique: uuid('c2000000', 2), payet: uuid('c3000000', 3), hoarau: uuid('c4000000', 4), grondin: uuid('c5000000', 5) };
const DOSSIER = { boutiquePaid: uuid('d7000000', 1), payetDelivered: uuid('d7000000', 2), payetArchived: uuid('d7000000', 3) };
const PREPARATEUR = ['perm_colis_receptionner', 'perm_colis_mesurer', 'perm_colis_modifier_dims', 'perm_colis_demander_feuvert', 'perm_colis_preparer', 'perm_clients_voir', 'perm_clients_creer', 'perm_factures_voir', 'perm_factures_ajouter', 'perm_factures_ocr', 'perm_factures_modifier_articles', 'perm_comm_telegram', 'perm_comm_email', 'perm_comm_demander_facture', 'perm_comm_message_libre', 'perm_envois_voir'];
const LOGISTICIEN = ['perm_colis_receptionner', 'perm_colis_affecter_envoi', 'perm_colis_expedier', 'perm_clients_voir', 'perm_clients_creer', 'perm_clients_modifier', 'perm_clients_voir_finances', 'perm_comm_telegram', 'perm_envois_voir', 'perm_export_recap_pro'];
const grant = list => Object.fromEntries(list.map(key => [key, true]));
// Every changed state is looked at on a desktop and a phone, in both themes.
const MATRIX = [[1440, 'light'], [1440, 'dark'], [390, 'light'], [390, 'dark']];
// Indigo of the former professional billing panel: it must not come back.
const INDIGO = ['rgb(238, 242, 255)', 'rgb(165, 180, 252)', 'rgb(199, 210, 254)', 'rgb(224, 231, 255)', 'rgb(245, 243, 255)', 'rgb(55, 48, 163)', 'rgb(67, 56, 202)', 'rgb(79, 70, 229)', 'rgb(129, 140, 248)'];

function enrich(t) {
  const client = (id, fields) => ({ id, user_id: null, telegram_chat_id: null, telegram_username: null, type: 'particulier', abonnement: 'freemium', abonnement_debut: null, abonnement_fin: null, onboarded: true, created_at: '2026-09-01T08:00:00Z', ...fields });
  t.clients.push(
    client(CLIENT.boutique, { ref: 'CLI-0002', nom: 'Boutique Kréol Import-Export Océan Indien', prenom: '', email: 'achats.longue.adresse.compta@boutique-kreol-import-export.example', tel: '+262 692 11 22 33', cp: '97410', ville: 'Saint-Pierre', adresse_ligne1: '12 chemin des Bambous', type: 'pro', raison_sociale: 'Boutique Kréol Import-Export Océan Indien SARL', siret: '12345678900011', mode_paiement: 'virement', telegram_chat_id: '123456', created_at: '2026-08-01T08:00:00Z' }),
    client(CLIENT.payet, { ref: 'CLI-0003', nom: 'Payet', prenom: 'Flavie', email: 'flavie.payet.adresse-de-contact@example.test', tel: '0692 44 55 66', cp: '97600', ville: 'Mamoudzou', abonnement: 'vip', abonnement_debut: '2026-01-01', abonnement_fin: '2026-12-31', telegram_chat_id: '987654', telegram_username: 'flaviep', user_id: uuid('a3000000', 3), created_at: '2026-07-01T08:00:00Z' }),
    client(CLIENT.hoarau, { ref: 'CLI-0004', nom: 'Hoarau', prenom: 'Jean-Marc', email: null, tel: null, telegram_username: '@jmhoarau', cp: '97200', ville: 'Fort-de-France', abonnement: 'premium_annuel', onboarded: false, created_at: '2026-06-01T08:00:00Z' }),
    client(CLIENT.grondin, { ref: 'CLI-0005', nom: 'Grondin', prenom: 'Marie-Christine', email: 'mc.grondin@example.test', tel: '0690 00 00 00', cp: '97110', ville: 'Pointe-à-Pitre', created_at: '2026-05-01T08:00:00Z' }),
  );
  const template = structuredClone(t.colis[0]);
  const dossier = (id, clientId, fields) => ({ ...structuredClone(template), id, client_id: clientId, envoi_id: null, casier: null, ...fields });
  t.colis.push(
    dossier(DOSSIER.boutiquePaid, CLIENT.boutique, { ref: 'EXP-TEST-002', statut: 'paye', desc_contenu: 'Stock boutique', paiement_date: '2026-09-28T08:00:00Z', paiement_montant: 1234.5, devis_total: 1234.5, quote_version: 1, casier: 'B-12' }),
    dossier(DOSSIER.payetDelivered, CLIENT.payet, { ref: 'EXP-TEST-003', statut: 'livre', desc_contenu: 'Vêtements', paiement_date: '2026-08-28T08:00:00Z', paiement_montant: 88, devis_total: 88, quote_version: 1 }),
    dossier(DOSSIER.payetArchived, CLIENT.payet, { ref: 'EXP-TEST-004', statut: 'livre', archive: true, desc_contenu: 'Archivé', paiement_date: '2026-03-02T08:00:00Z', paiement_montant: 50, devis_total: 50, quote_version: 1 }),
  );
  t.share_links = [];
}

/** save_client_subscription, as the SQL command: permission, expected values, values returned. */
async function subscriptionCommand(f, route) {
  const input = route.request().postDataJSON();
  f.subscriptionCalls.push(input);
  const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  const role = f.tables.staff_users[0].role;
  if (!['directeur', 'vice_directeur'].includes(role) && !f.tables.staff_permissions.some(row => row.perm_clients_modifier_abonnement)) return reply(403, { code: '42501', message: 'Permission abonnement requise' });
  const client = f.tables.clients.find(row => row.id === input.p_id);
  const previous = { abonnement: client.abonnement || 'freemium', abonnementDebut: client.abonnement_debut || null, abonnementFin: client.abonnement_fin || null };
  const expected = input.p_expected || {};
  if (f.subscriptionConflict || Object.keys(previous).some(key => (expected[key] ?? null) !== previous[key])) return reply(409, { code: '40001', message: 'Cet abonnement a changé. Rechargez avant de réessayer.' });
  Object.assign(client, { abonnement: input.p_values.abonnement, abonnement_debut: input.p_values.abonnementDebut || null, abonnement_fin: input.p_values.abonnementFin || null });
  return reply(200, input.p_values);
}

async function fixture(browser, { role = 'directeur', width = 1440, theme = 'light', permissions = null, prepare = null } = {}) {
  const f = await setup(browser, role);
  f.page.setDefaultTimeout(15000);
  await f.page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
  await f.context.addInitScript(value => { try { localStorage.setItem('expedile-theme', value); } catch { /* storage blocked */ } }, theme);
  if (permissions) { const row = { staff_id: ids.S, ...permissions }; f.tables.staff_permissions = [row]; f.tables.staff_users[0].staff_permissions = [row]; }
  enrich(f.tables);
  f.subscriptionCalls = [];
  await f.context.route('**/rest/v1/rpc/save_client_subscription', route => subscriptionCommand(f, route));
  f.theme = theme; f.width = width;
  if (prepare) await prepare(f);
  return f;
}

// ── Checks shared by every view ───────────────────────────────────────────────
const patches = f => f.requests.filter(request => request.method === 'PATCH' && request.path === '/rest/v1/clients');
const posts = f => f.requests.filter(request => request.method === 'POST' && request.path === '/rest/v1/clients');
const content = f => f.page.locator('h1').first();
const heading = (f, name) => f.page.getByRole('heading', { name, exact: true });
async function waitTheme(f) { await f.page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, f.theme === 'dark'); }
async function open(f, path, h1) {
  await f.page.goto(`${base}${path}`);
  await f.page.getByRole('heading', { level: 1, name: h1, exact: true }).waitFor();
  await waitTheme(f);
}
async function axe(f) {
  const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target.join(' ')) })), [], 'axe');
}
/** Contrast (4.5:1), text size (11px), 44px targets, overflow and plural forms of a page part. */
function inspect(f, selector) {
  return f.page.evaluate(selector => {
    const root = selector ? document.querySelector(selector) : document.querySelector('h1')?.closest('.overflow-y-auto') || document.body;
    const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const rgba = value => { const n = value.match(/[\d.]+/g)?.map(Number) || []; return n.length >= 3 ? [...n.slice(0, 3), n[3] ?? 1] : [0, 0, 0, 0]; };
    const over = (fg, bg) => [...fg.slice(0, 3).map((channel, i) => channel * fg[3] + bg[i] * (1 - fg[3])), 1];
    const layers = node => { const chain = []; for (let n = node; n && n.nodeType === 1; n = n.parentElement) chain.push(getComputedStyle(n)); return chain; };
    const background = node => layers(node).reverse().reduce((bg, style) => over(rgba(style.backgroundColor), bg), [255, 255, 255, 1]);
    const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const texts = [...root.querySelectorAll('*')].filter(node => visible(node) && [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())
      && !node.closest('[aria-hidden="true"], :disabled, fieldset:disabled, option, select'));
    const lowContrast = [], small = [], gradients = [];
    for (const node of texts) {
      const style = getComputedStyle(node);
      if (layers(node).some(layer => /gradient/.test(layer.backgroundImage))) gradients.push(node.textContent.trim().slice(0, 50));
      const ratio = contrast(over(rgba(style.color), background(node)), background(node));
      if (ratio < 4.5) lowContrast.push(`${node.textContent.trim().slice(0, 50)} ${ratio.toFixed(2)}:1`);
      if (parseFloat(style.fontSize) < 11) small.push(`${node.textContent.trim().slice(0, 50)} ${style.fontSize}`);
    }
    const targets = [...root.querySelectorAll('button, a[href], select, summary, textarea, input:not([type=checkbox]):not([type=radio]):not([type=hidden])')].filter(visible)
      .map(node => { const box = node.getBoundingClientRect(); return { text: (node.getAttribute('aria-label') || node.textContent || node.name || node.type).trim().slice(0, 40), width: Math.round(box.width), height: Math.round(box.height) }; })
      .filter(item => item.height < 43.5 || item.width < 43.5);
    const clipped = [...root.querySelectorAll('h1, h2, h3, p, span, strong, li, td, th, button, a, label, summary')].filter(node => visible(node) && node.scrollWidth > node.clientWidth + 1 && ['hidden', 'clip'].includes(getComputedStyle(node).overflowX) || (visible(node) && getComputedStyle(node).textOverflow === 'ellipsis' && node.scrollWidth > node.clientWidth + 1)).map(node => node.textContent.trim().slice(0, 50));
    return { lowContrast, small, gradients, targets, clipped, plural: /\(s\)/.test(root.innerText), overflow: document.documentElement.scrollWidth > innerWidth + 1 || root.scrollWidth > root.clientWidth + 1 };
  }, selector);
}
/** Entrance animations (anim-fade) blend colours while they run: measure once they are over. */
const settle = f => f.page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => null))));
async function audit(f, name, { selector = null, tall = true } = {}) {
  await settle(f);
  const report = await inspect(f, selector);
  assert.deepEqual(report.lowContrast, [], `${name}: text contrast below 4.5:1`);
  assert.deepEqual(report.small, [], `${name}: text below 11px`);
  assert.deepEqual(report.gradients, [], `${name}: text over a gradient`);
  assert.deepEqual(report.targets, [], `${name}: targets below 44px`);
  assert.deepEqual(report.clipped, [], `${name}: clipped text`);
  assert.equal(report.plural, false, `${name}: « (s) » plural`);
  assert.equal(report.overflow, false, `${name}: horizontal overflow`);
  await axe(f);
  await shot(f, name, { tall });
}
/** A screenshot of the whole inner scroller: the viewport grows to its height for the capture. */
async function shot(f, name, { tall = true } = {}) {
  const file = `${output}/${name}-${f.width}-${f.theme}.png`;
  if (!tall) return f.page.screenshot({ path: file });
  const viewport = f.page.viewportSize();
  const height = await f.page.evaluate(() => { const scroller = document.querySelector('h1')?.closest('.overflow-y-auto'); return scroller ? scroller.scrollHeight + (innerHeight - scroller.clientHeight) : document.documentElement.scrollHeight; });
  await f.page.setViewportSize({ width: viewport.width, height: Math.min(4000, Math.max(viewport.height, height)) });
  await f.page.screenshot({ path: file });
  await f.page.setViewportSize(viewport);
}
async function failingTable(f, table) {
  f.failing = true;
  await f.context.route(`**/rest/v1/${table}*`, route => f.failing && route.request().method() === 'GET'
    ? route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'retry-after': '0' }, body: JSON.stringify({ message: 'Indisponibilité simulée' }) })
    : route.fallback());
}
// The application toast (aria-atomic), never a text of the page that reads the same.
const toast = (f, text) => f.page.locator('[aria-atomic="true"]').filter({ hasText: text }).getByText(text, { exact: true }).waitFor();
const tab = (f, name) => f.page.getByRole('navigation', { name: 'Sections de la fiche client' }).getByRole('button', { name, exact: true });
const focused = f => f.page.evaluate(() => ({ name: document.activeElement?.getAttribute('name'), text: (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim(), inDialog: Boolean(document.activeElement?.closest('[role="dialog"]')) }));
// Import rows carry the seven required columns; `fields` overrides one row's values.
const importRow = (i, fields = {}) => {
  const row = { nom: `Import${i}`, prenom: 'Camille', email: `import${i}@example.test`, telegram: '', tel: `0693 10 00 ${String(i).padStart(2, '0')}`, adresse: `${i} rue des Lilas`, cp: '97400', ville: 'Saint-Denis', ...fields };
  return [row.nom, row.prenom, row.email, row.telegram, row.tel, row.adresse, row.cp, row.ville].join(';');
};
const csv = rows => Buffer.from(`Nom;Prénom;Email;Telegram;Téléphone;Adresse;Code postal;Ville\n${rows.join('\n')}`);
// 24 complete rows (lines 2 to 25) and four refused ones (lines 26 to 29).
const REFUSED_ROWS = ['Ligne 26 : téléphone manquant', 'Ligne 27 : prénom et ville manquants', 'Ligne 28 (Import26) : email invalide', 'Ligne 29 : code postal non desservi'];
const longCsv = csv([...Array.from({ length: 24 }, (_, i) => importRow(i, i === 3 ? { telegram: '@import_telegram' } : {})),
  importRow(24, { tel: '' }), importRow(25, { prenom: '', ville: '' }), importRow(26, { email: 'pas-un-email' }), importRow(27, { cp: '75011' })]);
// The seven required fields of the new client form, valid.
const NEW_CLIENT = { Nom: 'Nouveau', Prénom: 'Camille', Email: 'nouveau@example.test', Téléphone: '0692 12 34 56', Adresse: '4 rue des Lilas', 'Code postal': '97400', Ville: 'Saint-Denis' };
const NEW_CLIENT_FIELDS = { Nom: 'nom', Prénom: 'prenom', Email: 'email', Téléphone: 'tel', Adresse: 'adresseLigne1', 'Code postal': 'cp', Ville: 'ville' };
const MISSING = { nom: 'Le nom est obligatoire.', prenom: 'Le prénom est obligatoire.', email: 'L’email est obligatoire.', tel: 'Le téléphone est obligatoire.', adresseLigne1: 'L’adresse est obligatoire.', cp: 'Le code postal est obligatoire.', ville: 'La ville est obligatoire.' };
async function fillNewClient(f, values = NEW_CLIENT) { for (const [label, value] of Object.entries(values)) await f.page.getByLabel(label, { exact: true }).fill(value); }
const createButton = f => f.page.getByRole('button', { name: 'Créer le client', exact: true });

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  // Scenarios are independent (one context and one mocked database each): a small pool runs them side by side.
  const queue = [];
  const scenario = (name, run, options = {}) => {
    if (!process.env.PINTA_CLIENT_PAGES_FILTER || name.includes(process.env.PINTA_CLIENT_PAGES_FILTER)) queue.push({ name, run, options });
  };
  async function execute({ name, run, options }) {
    const f = await fixture(browser, options);
    let result;
    try {
      await f.login(); await run(f);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
      result = { test: name, pass: true };
    } catch (error) {
      process.exitCode = 1; result = { test: name, pass: false, error: error.stack };
      await f.page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {});
    } finally { await f.context.close(); results.push(result); console.log(JSON.stringify(result)); }
  }
  try {
    // ── Every page and state, in both themes and at both widths ──────────────
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await scenario(`views-${width}-${theme}`, async f => {
        await open(f, '/clients', 'Clients');
        await f.page.getByText('5 clients', { exact: true }).waitFor();
        await audit(f, 'list-cards');
        await f.page.getByLabel('Rechercher un client').fill('introuvable');
        await f.page.getByText('Aucun client ne correspond à « introuvable »', { exact: true }).waitFor();
        await audit(f, 'list-no-result', { tall: false });
        await f.page.getByRole('button', { name: 'Effacer la recherche', exact: true }).click();
        if (width === 1440) {
          await f.page.getByLabel('Présentation').selectOption('list');
          await f.page.getByRole('columnheader', { name: 'Encaissé (dossiers non archivés)' }).waitFor();
          await audit(f, 'list-table');
          await f.page.getByLabel('Présentation').selectOption('cards');
        }
        await open(f, `/clients/${CLIENT.exemple}`, 'Exemple Camille');
        await f.page.getByText('Pas encore de lien de suivi', { exact: true }).waitFor();
        await audit(f, 'detail-overview');
        await tab(f, 'Coordonnées').click();
        await audit(f, 'detail-contact');
        await tab(f, 'Abonnement et administration').click();
        await audit(f, 'detail-admin');
        await open(f, `/clients/${CLIENT.boutique}`, 'Boutique Kréol Import-Export Océan Indien');
        await f.page.getByText('Expéditions ouvertes (1)', { exact: true }).waitFor();
        await audit(f, 'detail-pro-overview');
        await tab(f, 'Abonnement et administration').click();
        await f.page.getByRole('button', { name: /^Récapitulatif mensuel/ }).click();
        await f.page.getByLabel('Mois du récapitulatif').selectOption('8');
        await f.page.getByLabel('Année du récapitulatif').selectOption('2026');
        await f.page.getByRole('button', { name: 'Exporter 1 dossier', exact: true }).waitFor();
        await audit(f, 'detail-pro-admin');
        const colours = await f.page.locator('#client-billing-recap').evaluate(node => [node, ...node.querySelectorAll('*')].flatMap(element => { const style = getComputedStyle(element); return [style.color, style.backgroundColor, style.borderTopColor]; }));
        assert.deepEqual(colours.filter(colour => INDIGO.includes(colour)), [], 'No indigo left in the billing panel.');
        await open(f, `/clients/${CLIENT.payet}`, 'Payet Flavie');
        await audit(f, 'detail-vip-overview');
        await open(f, '/clients/new', 'Nouveau client');
        await f.page.getByRole('button', { name: 'Créer le client', exact: true }).click();
        await f.page.getByText('Le nom est obligatoire.', { exact: true }).waitFor();
        await audit(f, 'new-validation');
        await open(f, '/clients', 'Clients');
        await f.page.getByRole('button', { name: 'Importer des clients', exact: true }).click();
        const dialog = f.page.getByRole('dialog', { name: 'Importer des clients' });
        await dialog.getByText('Glissez-déposez votre fichier ici', { exact: true }).waitFor();
        await audit(f, 'import-short', { selector: '[role="dialog"]', tall: false });
        await dialog.locator('input[type=file]').setInputFiles({ name: 'clients.csv', mimeType: 'text/csv', buffer: longCsv });
        await dialog.getByText('24 clients sélectionnés sur 24 lignes valides', { exact: true }).waitFor();
        const scroll = await dialog.evaluate(node => { const body = node.querySelector('.overflow-y-auto'); const footer = node.querySelector('footer').getBoundingClientRect(); return { inner: body.scrollHeight > body.clientHeight, footerVisible: footer.bottom <= innerHeight + 1 && footer.top >= 0 }; });
        assert.deepEqual(scroll, { inner: true, footerVisible: true }, 'Long content scrolls inside the window, its footer stays visible.');
        await audit(f, 'import-long', { selector: '[role="dialog"]', tall: false });
        await f.page.keyboard.press('Escape');
        await dialog.getByRole('heading', { name: 'Fermer sans importer ?' }).waitFor();
        await audit(f, 'import-confirm', { selector: '[role="dialog"]', tall: false });
      }, { width, theme });
    }

    // ── 1. One save per tab, through the server writes, with an honest message ──
    await scenario('admin-tab-saves-offer-and-notes-together', async f => {
      await open(f, `/clients/${CLIENT.exemple}`, 'Exemple Camille');
      await tab(f, 'Abonnement et administration').click();
      const form = f.page.locator('form[aria-labelledby="client-admin-title"]');
      assert.equal(await f.page.getByRole('button', { name: 'Enregistrer', exact: true }).count(), 1, 'One save button in the tab.');
      assert.equal(await f.page.getByRole('button', { name: /Enregistrer l’abonnement/ }).count(), 0);
      assert.equal(await form.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled(), true, 'Nothing to save yet.');
      await form.getByText('Aucune modification à enregistrer.', { exact: true }).waitFor();
      await form.getByLabel('Offre', { exact: true }).selectOption('vip');
      await form.getByLabel('Notes internes').fill('Client fidèle depuis 2024');
      assert.equal(await tab(f, 'Abonnement et administration').getAttribute('aria-describedby') !== null, true, 'The tab shows its unsaved changes.');
      await form.getByText('Modifications non enregistrées.', { exact: true }).waitFor();
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await toast(f, 'Modifications enregistrées : notes internes et abonnement.');
      assert.deepEqual(f.subscriptionCalls, [{ p_id: CLIENT.exemple, p_values: { abonnement: 'vip', abonnementDebut: null, abonnementFin: null }, p_expected: { abonnement: 'freemium', abonnementDebut: null, abonnementFin: null } }]);
      assert.deepEqual(patches(f).map(request => request.input), [{ notes: 'Client fidèle depuis 2024' }], 'Only the changed field of the tab is written.');
      assert.equal(f.tables.clients[0].abonnement, 'vip');
      await f.page.getByRole('heading', { name: 'Expéditions ouvertes (1)' }).waitFor();
      await f.page.locator('header').getByText('VIP', { exact: true }).waitFor();
      await f.page.reload();
      await heading(f, 'Exemple Camille').waitFor();
      await tab(f, 'Abonnement et administration').click();
      assert.equal(await form.getByLabel('Offre', { exact: true }).inputValue(), 'vip', 'The saved offer is read back from the server.');
      assert.equal(await form.getByLabel('Notes internes').inputValue(), 'Client fidèle depuis 2024');
      assert.equal(await tab(f, 'Abonnement et administration').getAttribute('aria-describedby'), null, 'Nothing left unsaved.');
      // The reviewer's case: changing only the offer, then the tab's save.
      await form.getByLabel('Offre', { exact: true }).selectOption('premium_mensuel');
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await toast(f, 'Modifications enregistrées : abonnement.');
      assert.equal(f.tables.clients[0].abonnement, 'premium_mensuel');
      assert.equal(patches(f).length, 1, 'No client PATCH when only the offer changed.');
    });
    for (const [width, theme] of MATRIX) await scenario(`admin-tab-partial-failure-keeps-the-unsaved-part-${width}-${theme}`, async f => {
      f.subscriptionConflict = true;
      await open(f, `/clients/${CLIENT.exemple}`, 'Exemple Camille');
      await tab(f, 'Abonnement et administration').click();
      const form = f.page.locator('form[aria-labelledby="client-admin-title"]');
      await form.getByLabel('Offre', { exact: true }).selectOption('vip');
      await form.getByLabel('Notes internes').fill('À rappeler');
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await toast(f, 'Modifications enregistrées : notes internes.');
      const alert = form.getByRole('alert');
      await alert.getByText('Abonnement non enregistré : Cet abonnement a changé. Rechargez avant de réessayer.', { exact: true }).waitFor();
      await alert.getByRole('button', { name: 'Actualiser la fiche', exact: true }).waitFor();
      assert.equal(await form.getByLabel('Offre', { exact: true }).inputValue(), 'vip', 'The unsaved offer stays in the form.');
      assert.equal(f.tables.clients[0].abonnement, 'freemium');
      assert.equal(f.tables.clients[0].notes, 'À rappeler');
      assert.notEqual(await tab(f, 'Abonnement et administration').getAttribute('aria-describedby'), null);
      await audit(f, 'admin-partial-failure', { tall: true });
      f.subscriptionConflict = false;
      await alert.getByRole('button', { name: 'Actualiser la fiche', exact: true }).click();
      await toast(f, 'Fiche actualisée : vérifiez l’offre enregistrée avant de la modifier.');
      assert.equal(await form.getByLabel('Offre', { exact: true }).inputValue(), 'freemium', 'The form shows the stored offer again.');
    }, { width, theme });
    await scenario('admin-tab-without-subscription-permission-saves-only-what-it-may', async f => {
      await open(f, `/clients/${CLIENT.exemple}`, 'Exemple Camille');
      await tab(f, 'Abonnement et administration').click();
      const form = f.page.locator('form[aria-labelledby="client-admin-title"]');
      assert.equal(await form.getByLabel('Offre', { exact: true }).isDisabled(), true);
      await form.getByText('Vous pouvez consulter l’offre. Sa modification nécessite le droit Abonnement.', { exact: true }).waitFor();
      await form.getByRole('button', { name: 'Pro', exact: true }).click();
      await form.getByLabel('Raison sociale').fill('Exemple SARL');
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await toast(f, 'Modifications enregistrées : type de client et facturation professionnelle.');
      assert.deepEqual(patches(f).map(request => request.input), [{ type: 'pro', raison_sociale: 'Exemple SARL' }]);
      assert.equal(f.subscriptionCalls.length, 0);
    }, { role: 'logisticien', permissions: grant(LOGISTICIEN) });
    await scenario('contact-tab-saves-only-contact-and-normalises-the-telegram-username', async f => {
      await open(f, `/clients/${CLIENT.hoarau}`, 'Hoarau Jean-Marc');
      await f.page.locator('header').getByText('Telegram @jmhoarau', { exact: true }).waitFor();
      await tab(f, 'Coordonnées').click();
      const form = f.page.locator('form[aria-labelledby="client-contact-title"]');
      const username = form.getByLabel('Identifiant Telegram', { exact: true });
      assert.equal(await username.getAttribute('placeholder'), '@identifiant');
      assert.equal(await username.inputValue(), '@jmhoarau', 'A legacy « @jmhoarau » reads with one @.');
      await username.fill('  @jm_hoarau ');
      await form.getByLabel('Ville').fill('Le Lamentin');
      // An admin change stays a draft of its own tab: the contact save does not take it.
      await tab(f, 'Abonnement et administration').click();
      await f.page.getByLabel('Notes internes').fill('Brouillon administratif');
      await tab(f, 'Coordonnées').click();
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await toast(f, 'Coordonnées enregistrées.');
      assert.deepEqual(patches(f).map(request => request.input), [{ telegram_username: 'jm_hoarau', ville: 'Le Lamentin' }]);
      const hoarau = f.tables.clients.find(client => client.id === CLIENT.hoarau);
      assert.equal(hoarau.telegram_username, 'jm_hoarau', 'Stored without @.');
      await f.page.locator('header').getByText('Telegram @jm_hoarau', { exact: true }).waitFor();
      assert.notEqual(await tab(f, 'Abonnement et administration').getAttribute('aria-describedby'), null, 'The administration draft is still marked unsaved.');
      assert.equal(hoarau.notes ?? null, null);
    });
    await scenario('contact-tab-refused-save-focuses-the-first-invalid-field', async f => {
      await open(f, `/clients/${CLIENT.exemple}`, 'Exemple Camille');
      await tab(f, 'Coordonnées').click();
      const form = f.page.locator('form[aria-labelledby="client-contact-title"]');
      await form.getByLabel('Email', { exact: true }).fill('pas-un-email');
      await form.getByLabel('Code postal').fill('75011');
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await form.getByText('Indiquez un email valide.', { exact: true }).waitFor();
      assert.equal((await focused(f)).name, 'email', 'The first invalid field in reading order.');
      assert.equal(patches(f).length, 0);
      await form.getByRole('button', { name: 'Annuler', exact: true }).click();
      await tab(f, 'Coordonnées').click();
      assert.equal(await form.getByLabel('Email', { exact: true }).inputValue(), 'camille@example.test');
    });

    // ── 2. Failed loads are never « not found » or « no result » ────────────────
    for (const table of ['clients', 'colis']) for (const [width, theme] of MATRIX) {
      await scenario(`detail-load-failure-${table}-${width}-${theme}`, async f => {
        await failingTable(f, table);
        await f.page.goto(`${base}/clients/${CLIENT.payet}`);
        const failure = f.page.getByRole('alert').filter({ has: f.page.getByRole('heading', { name: 'Chargement impossible' }) });
        await failure.waitFor();
        assert.equal(await f.page.getByText('Client introuvable', { exact: true }).count(), 0);
        await audit(f, `detail-load-failure-${table}`, { tall: false });
        f.failing = false;
        await failure.getByRole('button', { name: 'Réessayer', exact: true }).click();
        await heading(f, 'Payet Flavie').waitFor();
      }, { width, theme });
    }
    for (const [width, theme] of MATRIX) await scenario(`list-load-failure-${width}-${theme}`, async f => {
      await failingTable(f, 'clients');
      await f.page.goto(`${base}/clients`);
      const failure = f.page.getByRole('alert').filter({ hasText: 'La liste des clients n’a pas pu être chargée' });
      await failure.waitFor();
      assert.equal(await f.page.getByText(/Aucun client ne correspond/).count(), 0);
      assert.equal(await f.page.getByRole('button', { name: 'Nouveau client', exact: true }).count(), 0, 'No creation on unloaded data.');
      await audit(f, 'list-load-failure', { tall: false });
      f.failing = false;
      await failure.getByRole('button', { name: 'Réessayer', exact: true }).click();
      await f.page.getByText('5 clients', { exact: true }).waitFor();
    }, { width, theme });
    await scenario('detail-unknown-client-is-not-found', async f => {
      await open(f, `/clients/${uuid('c9000000', 9)}`, 'Client introuvable');
    });

    // ── 3. Empty states ─────────────────────────────────────────────────────────
    for (const [width, theme] of MATRIX) await scenario(`list-without-clients-${width}-${theme}`, async f => {
      await open(f, '/clients', 'Clients');
      await heading(f, 'Aucun client pour l’instant').waitFor();
      assert.equal(await f.page.getByRole('button', { name: 'Nouveau client', exact: true }).count(), 1);
      assert.equal(await f.page.getByRole('button', { name: 'Importer des clients', exact: true }).count(), 1);
      await audit(f, 'list-empty', { tall: false });
      await f.page.getByRole('button', { name: 'Nouveau client', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === '/clients/new');
    }, { width, theme, prepare: f => { f.tables.clients = []; f.tables.colis = []; f.tables.factures = []; f.tables.lignes = []; f.tables.staff_work_actions = []; } });
    await scenario('list-without-clients-and-without-creation-right', async f => {
      await open(f, '/clients', 'Clients');
      await f.page.getByText('Les fiches créées par l’équipe apparaîtront ici.', { exact: true }).waitFor();
      assert.equal(await f.page.getByRole('button', { name: /Nouveau client|Importer/ }).count(), 0);
    }, { role: 'logisticien', permissions: grant(['perm_clients_voir']), prepare: f => { f.tables.clients = []; f.tables.colis = []; f.tables.staff_work_actions = []; } });
    await scenario('list-search-and-filter-without-result', async f => {
      await open(f, '/clients', 'Clients');
      const search = f.page.getByLabel('Rechercher un client');
      await search.fill('Payet');
      await f.page.getByLabel('Afficher').selectOption('pro');
      await f.page.getByText('Aucun client ne correspond à « Payet » parmi les clients professionnels', { exact: true }).waitFor();
      await f.page.getByRole('button', { name: 'Effacer la recherche', exact: true }).click();
      assert.equal(await search.inputValue(), '');
      assert.equal((await focused(f)).text, '', 'Focus back in the search field.');
      assert.equal(await f.page.evaluate(() => document.activeElement?.type), 'search');
      await f.page.getByText('1 client affiché sur 5', { exact: true }).waitFor();
      await f.page.getByLabel('Afficher').selectOption('telegram');
      await search.fill('Grondin');
      await f.page.getByRole('button', { name: 'Afficher tous les clients', exact: true }).click();
      await f.page.getByText('1 client affiché sur 5', { exact: true }).waitFor();
    });

    // ── 4, 5. Search on reference and Telegram, Telegram contact display ────────
    await scenario('search-reference-and-telegram-and-telegram-contact', async f => {
      await open(f, '/clients', 'Clients');
      const search = f.page.getByLabel('Rechercher un client');
      const cards = () => f.page.locator('[data-client-id]:visible').evaluateAll(nodes => nodes.map(node => node.querySelector('span')?.textContent));
      for (const [query, expected] of [['CLI-0004', ['Hoarau Jean-Marc']], ['cli-0002', ['Boutique Kréol Import-Export Océan Indien']], ['@jmhoarau', ['Hoarau Jean-Marc']], ['jmhoarau', ['Hoarau Jean-Marc']], ['@flaviep', ['Payet Flavie']], ['flaviep', ['Payet Flavie']]]) {
        await search.fill(query);
        await f.page.waitForFunction(count => document.querySelectorAll('[data-client-id]').length === count, expected.length);
        assert.deepEqual(await cards(), expected, query);
      }
      await search.fill('Hoarau');
      const card = f.page.locator(`[data-client-id="${CLIENT.hoarau}"]`).first();
      await card.getByText('@jmhoarau', { exact: true }).waitFor();
      assert.equal(await f.page.getByText('Contact à compléter').count(), 0, 'A Telegram-only client has a contact.');
      await card.getByText('Aucun dossier actif · Telegram non lié', { exact: true }).waitFor();
      await search.fill('');
      await f.page.locator(`[data-client-id="${CLIENT.exemple}"]`).first().getByText('1 dossier actif · Telegram non lié', { exact: true }).waitFor();
      await f.page.locator(`[data-client-id="${CLIENT.boutique}"]`).first().getByText('1 dossier actif · Telegram lié', { exact: true }).waitFor();
      assert.deepEqual(await f.page.getByLabel('Afficher').locator('option').allTextContents(), ['Tous les clients', 'Avec dossier actif', 'Professionnels', 'Telegram lié']);
      // Cards of a row start with their title at the same height.
      const tops = await f.page.locator('[data-client-id]').evaluateAll(nodes => nodes.slice(0, 3).map(node => Math.round(node.querySelector('span').getBoundingClientRect().top - node.getBoundingClientRect().top)));
      assert.equal(new Set(tops).size, 1, `Titles aligned at the top: ${tops}`);
      await f.page.getByLabel('Présentation').selectOption('list');
      const row = f.page.getByRole('row').filter({ hasText: 'Hoarau Jean-Marc' });
      await row.getByRole('cell', { name: '@jmhoarau', exact: true }).waitFor();
      await f.page.getByRole('row').filter({ hasText: 'Payet Flavie' }).getByRole('cell', { name: '88.00 €', exact: true }).waitFor();
      assert.equal(await f.page.getByText('dossiers chargés').count(), 0);
    });

    // ── 6, 5 and the required fields: creation is blocked until each one is valid ──
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) await scenario(`new-client-required-fields-focus-confirmation-and-telegram-${width}-${theme}`, async f => {
      await open(f, '/clients/new', 'Nouveau client');
      const username = f.page.getByLabel('Identifiant Telegram (facultatif)', { exact: true });
      assert.equal(await username.getAttribute('placeholder'), '@identifiant');
      // « obligatoire » beside each required label, the label alone naming the field.
      assert.equal(await f.page.getByText('obligatoire', { exact: true }).count(), 7);
      for (const label of Object.keys(NEW_CLIENT)) assert.equal(await f.page.getByLabel(label, { exact: true }).getAttribute('required'), '', label);
      await createButton(f).click();
      assert.equal((await focused(f)).name, 'nom', 'Focus on the first invalid field.');
      for (const message of Object.values(MISSING)) await f.page.getByText(message, { exact: true }).waitFor();
      await audit(f, 'new-every-field-missing');
      await fillNewClient(f);
      // Each required field missing on its own blocks the creation, with its focus and its message.
      for (const [label, key] of Object.entries(NEW_CLIENT_FIELDS)) {
        await f.page.getByLabel(label, { exact: true }).fill('');
        await createButton(f).click();
        assert.equal((await focused(f)).name, key, `${label}: focused`);
        await f.page.getByText(MISSING[key], { exact: true }).waitFor();
        await f.page.getByLabel(label, { exact: true }).fill(NEW_CLIENT[label]);
      }
      for (const [label, value, key, message] of [
        ['Email', 'pas-un-email', 'email', 'Indiquez un email valide.'],
        ['Téléphone', '0692 12 34', 'tel', 'Indiquez un numéro d’au moins 9 chiffres (espaces, points, tirets et + initial acceptés).'],
        ['Code postal', '75011', 'cp', 'Ce code postal n’est pas une destination desservie : Guadeloupe (971), Martinique (972), La Réunion (974) et Mayotte (976).'],
        ['Code postal', '9740', 'cp', 'Indiquez un code postal à 5 chiffres.'],
      ]) {
        await f.page.getByLabel(label, { exact: true }).fill(value);
        await createButton(f).click();
        assert.equal((await focused(f)).name, key, `${value}: focused`);
        await f.page.getByText(message, { exact: true }).waitFor();
        await f.page.getByLabel(label, { exact: true }).fill(NEW_CLIENT[label]);
      }
      assert.equal(posts(f).length, 0, 'Nothing is written while a required field is invalid.');
      await f.page.getByText('Destination : La Réunion').waitFor();
      // Abandoning a form with data asks first.
      await f.page.getByRole('button', { name: 'Abandonner', exact: true }).click();
      const confirm = f.page.getByRole('dialog').filter({ hasText: 'Abandonner ce nouveau client ?' });
      await confirm.waitFor();
      await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
      assert.equal(await f.page.getByLabel('Nom', { exact: true }).inputValue(), 'Nouveau', 'Cancelling keeps the data.');
      await username.fill(' @nouveau_client ');
      await createButton(f).click();
      await heading(f, 'Client créé').waitFor();
      assert.equal(posts(f).length, 1);
      const written = posts(f)[0].input;
      assert.deepEqual([written.prenom, written.nom, written.email, written.tel, written.adresse_ligne1, written.adresse, written.cp, written.ville], ['Camille', 'Nouveau', 'nouveau@example.test', '0692 12 34 56', '4 rue des Lilas', '4 rue des Lilas', '97400', 'Saint-Denis']);
      assert.equal(written.telegram_username, 'nouveau_client', 'Stored without @.');
      assert.equal(written.canal, 'telegram');
      await f.page.getByText('La fiche de Nouveau Camille est enregistrée. Aucune invitation n’a été envoyée automatiquement.', { exact: true }).waitFor();
      await f.page.getByText('Lier le Telegram du client (facultatif)', { exact: true }).waitFor();
      await audit(f, 'new-created', { tall: false });
      // A second form: abandoning asks, then empties the draft.
      await open(f, '/clients/new', 'Nouveau client');
      await f.page.getByLabel('Prénom', { exact: true }).fill('Brouillon');
      await f.page.getByRole('button', { name: 'Abandonner', exact: true }).click();
      await f.page.getByRole('dialog').getByRole('button', { name: 'Abandonner le brouillon', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === '/clients');
      await open(f, '/clients/new', 'Nouveau client');
      assert.equal(await f.page.getByLabel('Prénom', { exact: true }).inputValue(), '');
      // An empty form leaves without a question.
      await f.page.getByRole('button', { name: 'Abandonner', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === '/clients');
      assert.equal(await f.page.getByRole('dialog').count(), 0);
    }, { width, theme });
    await scenario('new-client-server-refusal-is-shown-never-a-success', async f => {
      // The database guard (trigger on clients, SQLSTATE 23514) refuses: its French message is shown.
      await f.context.route('**/rest/v1/clients*', route => route.request().method() === 'POST'
        ? route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: '23514', message: 'Informations obligatoires manquantes : téléphone, ville.' }) })
        : route.fallback());
      await open(f, '/clients/new', 'Nouveau client');
      await fillNewClient(f);
      await createButton(f).click();
      const refusal = f.page.locator('form').getByRole('alert').filter({ hasText: 'Client non créé' });
      await refusal.getByText('Client non créé : Informations obligatoires manquantes : téléphone, ville. Votre saisie est conservée.', { exact: true }).waitFor();
      assert.equal(await refusal.evaluate(node => node === document.activeElement), true, 'The refusal receives the focus.');
      assert.ok(await refusal.evaluate(node => node.getBoundingClientRect().top < node.closest('form').querySelector('fieldset').getBoundingClientRect().top), 'At the top of the form.');
      assert.equal(await heading(f, 'Client créé').count(), 0);
      assert.equal(await f.page.locator('[aria-atomic="true"][role="status"]').count(), 0, 'No success toast.');
      assert.equal(await f.page.getByLabel('Ville', { exact: true }).inputValue(), 'Saint-Denis', 'The entry is kept.');
      await audit(f, 'new-server-refusal', { tall: false });
    }, { theme: 'dark' });

    // ── Required fields on an existing client: never emptied, completed step by step ──
    for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) await scenario(`legacy-client-completes-step-by-step-${width}-${theme}`, async f => {
      await open(f, `/clients/${CLIENT.hoarau}`, 'Hoarau Jean-Marc');
      await tab(f, 'Coordonnées').click();
      const form = f.page.locator('form[aria-labelledby="client-contact-title"]');
      await form.getByText('Fiche incomplète : email, téléphone et adresse à compléter. Vous pouvez enregistrer les informations complétées dès maintenant.', { exact: true }).waitFor();
      assert.equal(await form.getByText('À compléter', { exact: true }).count(), 3);
      for (const label of ['Email', 'Téléphone', 'Adresse de livraison']) {
        const described = await form.getByLabel(label, { exact: true }).evaluate(node => (node.getAttribute('aria-describedby') || '').split(' ').map(id => document.getElementById(id)?.textContent).join(' '));
        assert.match(described, /À compléter/, label);
      }
      await audit(f, 'legacy-incomplete');
      await form.getByLabel('Téléphone', { exact: true }).fill('0696 11 22 33');
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await toast(f, 'Coordonnées enregistrées.');
      assert.deepEqual(patches(f).map(request => request.input), [{ tel: '0696 11 22 33' }], 'A partial completion is saved.');
      await tab(f, 'Coordonnées').click();
      await form.getByText('Fiche incomplète : email et adresse à compléter. Vous pouvez enregistrer les informations complétées dès maintenant.', { exact: true }).waitFor();
      assert.equal(await form.getByText('À compléter', { exact: true }).count(), 2);
    }, { width, theme });
    await scenario('filled-required-fields-cannot-be-emptied-and-a-server-refusal-is-shown', async f => {
      await open(f, `/clients/${CLIENT.exemple}`, 'Exemple Camille');
      await tab(f, 'Coordonnées').click();
      const form = f.page.locator('form[aria-labelledby="client-contact-title"]');
      await form.getByLabel('Prénom', { exact: true }).fill('');
      await form.getByText('Le prénom est obligatoire : il ne peut pas être effacé.', { exact: true }).waitFor();
      await form.getByLabel('Ville', { exact: true }).fill('   ');
      await form.getByText('La ville est obligatoire : elle ne peut pas être effacée.', { exact: true }).waitFor();
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      assert.equal((await focused(f)).name, 'prenom');
      assert.equal(patches(f).length, 0, 'An emptied required field is never sent.');
      await audit(f, 'no-blanking', { tall: false });
      // The database guard refuses an update: the message is shown, never a success.
      await form.getByLabel('Prénom', { exact: true }).fill('Camille-Rose');
      await form.getByLabel('Ville', { exact: true }).fill('Saint-Denis');
      await f.context.route('**/rest/v1/clients*', route => route.request().method() === 'PATCH'
        ? route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: '23514', message: 'Une information obligatoire ne peut pas être effacée : prénom.' }) })
        : route.fallback());
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await form.getByRole('alert').getByText('Coordonnées non enregistrées : Une information obligatoire ne peut pas être effacée : prénom. Vos saisies sont conservées.', { exact: true }).waitFor();
      assert.equal(await f.page.locator('[aria-atomic="true"][role="status"]').count(), 0, 'No success toast.');
      assert.equal(await form.getByLabel('Prénom', { exact: true }).inputValue(), 'Camille-Rose');
    });

    // ── « Compléter la fiche »: /clients/:id?completer=<champ> opens and focuses the field ──
    for (const [width, theme] of MATRIX) await scenario(`complete-link-focuses-the-field-${width}-${theme}`, async f => {
      const from = `/colis/${ids.P}`;
      await open(f, `/clients/${CLIENT.hoarau}?${new URLSearchParams({ returnTo: from, completer: 'adresse' })}`, 'Hoarau Jean-Marc');
      assert.equal(await tab(f, 'Coordonnées').getAttribute('aria-pressed'), 'true', 'The contact form is open.');
      await f.page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'adresseLigne1');
      const field = f.page.getByLabel('Adresse de livraison', { exact: true });
      const view = await field.evaluate(node => { const box = node.getBoundingClientRect(); const style = getComputedStyle(node); return { inside: box.top >= 0 && box.bottom <= innerHeight, ring: style.boxShadow !== 'none', todo: (node.getAttribute('aria-describedby') || '').split(' ').map(id => document.getElementById(id)?.textContent).join(' ') }; });
      assert.deepEqual(view, { inside: true, ring: true, todo: 'À compléter' }, 'In view, highlighted and marked « À compléter ».');
      await audit(f, 'complete-link', { tall: false });
      // Another field, an unknown value, and the way back to the dossier.
      await open(f, `/clients/${CLIENT.hoarau}?${new URLSearchParams({ returnTo: from, completer: 'telephone' })}`, 'Hoarau Jean-Marc');
      await f.page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'tel');
      await open(f, `/clients/${CLIENT.hoarau}?${new URLSearchParams({ returnTo: from, completer: 'inconnu' })}`, 'Hoarau Jean-Marc');
      assert.equal(await tab(f, 'Synthèse').getAttribute('aria-pressed'), 'true');
      await f.page.getByRole('button', { name: 'Retour au dossier', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === from);
    }, { width, theme });

    // ── 7, 8, 11. Header, chips, contrast, targets and wording on the detail page ──
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) await scenario(`detail-header-${width}-${theme}`, async f => {
      await open(f, `/clients/${CLIENT.boutique}`, 'Boutique Kréol Import-Export Océan Indien');
      const header = f.page.locator('header').filter({ has: f.page.getByRole('heading', { level: 1 }) });
      const whole = await header.evaluate(node => [...node.querySelectorAll('h1, li span')].map(element => ({ text: element.textContent, whole: element.scrollWidth <= element.clientWidth + 1 && getComputedStyle(element).textOverflow !== 'ellipsis', inside: element.getBoundingClientRect().right <= innerWidth })));
      assert.ok(whole.length >= 3);
      for (const item of whole) assert.ok(item.whole && item.inside, `Read whole: ${item.text}`);
      const sizes = await header.locator('.rounded-full').evaluateAll(nodes => nodes.filter(node => node.textContent.trim()).map(node => ({ text: node.textContent.trim(), size: parseFloat(getComputedStyle(node).fontSize) })));
      assert.ok(sizes.length >= 3);
      for (const chip of sizes) assert.ok(chip.size >= 11, `${chip.text} ${chip.size}px`);
      await header.getByText('1 dossier au total', { exact: true }).waitFor();
      await header.getByText('1 actif', { exact: true }).waitFor();
      await header.getByText('1234.50 € encaissés', { exact: true }).waitFor();
      await shot(f, 'detail-header', { tall: false });
      await open(f, `/clients/${CLIENT.exemple}`, 'Exemple Camille');
      await f.page.getByText('Historique complet (1 dossier)', { exact: true }).waitFor();
      await f.page.getByText('2 cartons reçus · Casier A-03', { exact: true }).waitFor();
      await f.page.getByText('Telegram non lié · Accès au portail à activer', { exact: true }).waitFor();
      const chip = f.page.locator('header').getByText('Telegram non lié', { exact: true });
      const chipStyle = await chip.evaluate(node => getComputedStyle(node).backgroundColor);
      assert.equal(chipStyle, theme === 'dark' ? 'rgb(68, 54, 27)' : 'rgb(255, 245, 216)', 'The attention tokens of the theme.');
      await tab(f, 'Coordonnées').click();
      const toggle = f.page.getByRole('button', { name: 'Email', exact: true });
      const inactive = await toggle.evaluate(node => getComputedStyle(node).backgroundColor);
      assert.notEqual(inactive, 'rgb(255, 255, 255)', 'No white segment.');
      if (theme === 'dark') {
        const borders = await f.page.evaluate(() => [...document.querySelectorAll('form[aria-labelledby="client-contact-title"] [role="group"], form[aria-labelledby="client-contact-title"] button')].map(node => getComputedStyle(node)).filter(style => parseFloat(style.borderTopWidth) > 0).map(style => style.borderTopColor));
        assert.ok(borders.length >= 2, 'The toggle group and the secondary button are measured.');
        assert.ok(borders.every(colour => colour === 'rgb(58, 53, 48)'), `Subtle borders on dark: ${borders}`);
      }
    }, { width, theme });

    // ── 10. The préparateur sees why the invitation is unavailable ──────────────
    for (const [width, theme] of MATRIX) await scenario(`preparateur-sees-the-reasons-${width}-${theme}`, async f => {
      await open(f, `/clients/${CLIENT.exemple}`, 'Exemple Camille');
      const invite = f.page.getByRole('button', { name: 'Créer une invitation personnelle', exact: true });
      assert.equal(await invite.isDisabled(), true);
      const reason = await invite.evaluate(node => document.getElementById(node.getAttribute('aria-describedby'))?.textContent);
      assert.match(reason || '', /réservée aux personnes autorisées à modifier les fiches clients/);
      await f.page.getByText(reason, { exact: true }).waitFor();
      await tab(f, 'Coordonnées').click();
      await f.page.getByText('Votre rôle permet de consulter cette fiche. Les modifications sont réservées aux personnes habilitées.', { exact: true }).waitFor();
      assert.equal(await f.page.getByLabel('Nom', { exact: true }).isDisabled(), true);
      await audit(f, 'preparateur-contact', { tall: false });
      await tab(f, 'Synthèse').click();
      await audit(f, 'preparateur-overview');
    }, { role: 'preparateur', permissions: grant(PREPARATEUR), width, theme });

    // ── 11. Save/Cancel belong to their form; no unrelated section in the edit tabs ──
    await scenario('edit-tabs-hold-only-their-form', async f => {
      await open(f, `/clients/${CLIENT.boutique}`, 'Boutique Kréol Import-Export Océan Indien');
      for (const [name, form] of [['Coordonnées', 'client-contact-title'], ['Abonnement et administration', 'client-admin-title']]) {
        await tab(f, name).click();
        for (const unrelated of ['Partager le suivi avec un proche', 'Expéditions ouvertes (1)', 'Joindre ce client']) assert.equal(await heading(f, unrelated).count(), 0, `${unrelated} is not in ${name}`);
        const layout = await f.page.locator(`form[aria-labelledby="${form}"]`).evaluate(node => { const fields = [...node.querySelectorAll('input, select, textarea')]; const save = [...node.querySelectorAll('button[type="submit"]')]; const lastField = fields.at(-1).getBoundingClientRect().bottom; return { saves: save.length, after: save[0].getBoundingClientRect().top >= lastField, cancel: [...node.querySelectorAll('button')].some(button => button.textContent.trim() === 'Annuler') }; });
        assert.deepEqual(layout, { saves: 1, after: true, cancel: true }, name);
      }
      await f.page.getByRole('button', { name: /^Récapitulatif mensuel/ }).waitFor();
      assert.equal(await f.page.getByRole('button', { name: /^Récapitulatif mensuel/ }).getAttribute('aria-expanded'), 'false');
      await tab(f, 'Synthèse').click();
      await heading(f, 'Partager le suivi avec un proche').waitFor();
      await f.page.getByText('Valable jusqu’à 10 jours après la dernière livraison', { exact: true }).waitFor();
    });
    await scenario('pro-recap-export', async f => {
      await open(f, `/clients/${CLIENT.boutique}`, 'Boutique Kréol Import-Export Océan Indien');
      await tab(f, 'Abonnement et administration').click();
      await f.page.getByRole('button', { name: /^Récapitulatif mensuel/ }).click();
      await f.page.getByLabel('Mois du récapitulatif').selectOption('8');
      await f.page.getByLabel('Année du récapitulatif').selectOption('2026');
      await f.page.getByText('1 dossier sur la période', { exact: true }).waitFor();
      const download = f.page.waitForEvent('download');
      await f.page.getByRole('button', { name: 'Exporter 1 dossier', exact: true }).click();
      assert.match((await download).suggestedFilename(), /^recap-pro-.*-2026-09\.xlsx$/);
      await toast(f, 'Récapitulatif exporté : 1 dossier.');
      await f.page.getByLabel('Mois du récapitulatif').selectOption('9');
      assert.equal(await f.page.getByRole('button', { name: 'Aucun dossier à exporter', exact: true }).isDisabled(), true);
    }, { theme: 'dark' });

    // ── 7. The shared tracking link in both themes ──────────────────────────────
    for (const [width, theme] of MATRIX) await scenario(`share-link-${width}-${theme}`, async f => {
      await open(f, `/clients/${CLIENT.exemple}`, 'Exemple Camille');
      await f.page.getByText('Pas encore de lien de suivi', { exact: true }).waitFor();
      await audit(f, 'share-link-empty', { tall: true });
      await f.page.getByRole('button', { name: 'Créer le lien de suivi', exact: true }).click();
      await toast(f, 'Lien de suivi créé');
      assert.equal(f.tables.share_links.length, 1);
      const send = f.page.getByRole('button', { name: 'Envoyer via Telegram', exact: true });
      assert.equal(await send.isDisabled(), true);
      await f.page.getByText('Envoi par Telegram indisponible : le Telegram du client n’est pas lié. Il peut le lier avec son invitation personnelle.', { exact: true }).waitFor();
      await f.page.getByText('0 vue', { exact: true }).waitFor();
      await audit(f, 'share-link-active', { tall: true });
      await f.page.getByRole('button', { name: 'Révoquer', exact: true }).click();
      await f.page.getByRole('dialog').getByRole('button', { name: 'Révoquer', exact: true }).click();
      await toast(f, 'Lien révoqué');
      await f.page.locator('section[aria-labelledby="share-link-title"]').getByText('Lien révoqué', { exact: true }).waitFor();
      await audit(f, 'share-link-revoked', { tall: true });
    }, { width, theme });

    // ── 9. The import window ────────────────────────────────────────────────────
    await scenario('import-creates-the-complete-rows-only', async f => {
      await open(f, '/clients', 'Clients');
      await f.page.getByRole('button', { name: 'Importer des clients', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Importer des clients' });
      await dialog.locator('input[type=file]').setInputFiles({ name: 'clients.csv', mimeType: 'text/csv', buffer: csv([importRow(1), importRow(2, { tel: '' }), importRow(3), importRow(4, { adresse: '', cp: '97500' })]) });
      await dialog.getByText('2 clients sélectionnés sur 2 lignes valides', { exact: true }).waitFor();
      assert.deepEqual(await dialog.locator('details li').allTextContents(), ['Ligne 3 : téléphone manquant', 'Ligne 5 : adresse manquante, code postal non desservi']);
      await audit(f, 'import-refused-rows', { selector: '[role="dialog"]', tall: false });
      await dialog.getByRole('button', { name: 'Importer 2 clients', exact: true }).click();
      await dialog.getByText('2 fiches créées, 0 non confirmée, 0 non traitée.', { exact: true }).waitFor();
      assert.deepEqual(posts(f).map(request => [request.input.nom, request.input.prenom, request.input.tel, request.input.adresse_ligne1, request.input.cp, request.input.ville]),
        [['Import1', 'Camille', '0693 10 00 01', '1 rue des Lilas', '97400', 'Saint-Denis'], ['Import3', 'Camille', '0693 10 00 03', '3 rue des Lilas', '97400', 'Saint-Denis']]);
    }, { theme: 'dark' });
    for (const width of [1440, 390]) await scenario(`import-window-${width}`, async f => {
      await open(f, '/clients', 'Clients');
      const opener = f.page.getByRole('button', { name: 'Importer des clients', exact: true });
      await opener.click();
      const dialog = f.page.getByRole('dialog', { name: 'Importer des clients' });
      assert.equal((await focused(f)).text, 'Fermer l’import', 'Focus starts on the close button.');
      assert.equal(await dialog.getByRole('button', { name: 'Terminer', exact: true }).count(), 0, 'No « Terminer » before a file.');
      // Without rows, the backdrop, the X and Escape close at once; focus comes back.
      await f.page.mouse.click(3, 3);
      await dialog.waitFor({ state: 'detached' });
      assert.equal((await focused(f)).text, 'Importer des clients');
      await opener.click(); await dialog.getByRole('button', { name: 'Fermer l’import', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await opener.click(); await f.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      // A dropped file is read like a chosen one.
      await opener.click();
      const transfer = await f.page.evaluateHandle(text => { const data = new DataTransfer(); data.items.add(new File([text], 'clients.csv', { type: 'text/csv' })); return data; }, longCsv.toString());
      const zone = dialog.getByTestId('client-import-drop');
      await zone.dispatchEvent('dragenter', { dataTransfer: transfer });
      await zone.getByText('Relâchez pour lire le fichier', { exact: true }).waitFor();
      await zone.dispatchEvent('drop', { dataTransfer: transfer });
      await dialog.getByText('24 clients sélectionnés sur 24 lignes valides', { exact: true }).waitFor();
      await dialog.getByText('Ligne 5 · Camille Import3', { exact: true }).waitFor();
      await dialog.getByText('import3@example.test · 97400', { exact: true }).waitFor();
      // Rows without the required information are listed with their reason, not offered for import.
      const refused = dialog.locator('details').filter({ hasText: '4 lignes exclues de l’import : informations obligatoires manquantes ou invalides' });
      assert.equal(await refused.getAttribute('open'), '', 'The reasons are open.');
      assert.deepEqual(await refused.locator('li').allTextContents(), REFUSED_ROWS);
      assert.equal(await dialog.locator('label').filter({ hasText: /Camille Import2[4-7]/ }).count(), 0, 'No refused row among the rows to import.');
      // Focus stays inside the window.
      for (let i = 0; i < 12; i++) { await f.page.keyboard.press('Tab'); assert.equal((await focused(f)).inDialog, true); }
      for (let i = 0; i < 4; i++) { await f.page.keyboard.press('Shift+Tab'); assert.equal((await focused(f)).inDialog, true); }
      // Closing with read rows asks first: Escape, backdrop and X.
      await f.page.keyboard.press('Escape');
      await dialog.getByRole('heading', { name: 'Fermer sans importer ?' }).waitFor();
      await dialog.getByText('Les 24 lignes lues ne seront pas importées. Aucun client n’a été créé.', { exact: true }).waitFor();
      assert.equal((await focused(f)).text, 'Continuer l’import');
      await f.page.keyboard.press('Escape');
      await dialog.getByText('24 clients sélectionnés sur 24 lignes valides', { exact: true }).waitFor();
      assert.equal((await focused(f)).inDialog, true, 'Focus returns inside the window.');
      await f.page.mouse.click(3, 3);
      await dialog.getByRole('button', { name: 'Continuer l’import', exact: true }).click();
      await dialog.getByText('24 clients sélectionnés sur 24 lignes valides', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Fermer l’import', exact: true }).click();
      await dialog.getByRole('button', { name: 'Fermer sans importer', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal((await focused(f)).text, 'Importer des clients');
      assert.equal(posts(f).length, 0, 'Nothing imported.');
    }, { width });
    const workers = Math.max(1, Number(process.env.PINTA_CLIENT_PAGES_CONCURRENCY) || 3);
    await Promise.all(Array.from({ length: workers }, async () => { while (queue.length) await execute(queue.shift()); }));
    assert.ok(results.length > 0, 'At least one scenario ran.');
  } finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); }
}
module.exports = { fixture, CLIENT, DOSSIER, audit, inspect };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
