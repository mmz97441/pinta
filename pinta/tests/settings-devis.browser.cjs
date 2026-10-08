/* Paramètres (/settings) and Estimation rapide (/devis), final review:
 * 1 estimate contrast in dark mode, 2 the shared estimate text, 3 French amounts
 * and weights, 4 storage and reminders, 5 failed configuration load, 6 contact
 * channels, 7 names, 8 team list, 9 toasts, 10 the loading shell.
 * Every check runs in light and dark, at 1440 and 390 px, with axe. setup()
 * mocks every request: nothing reaches Supabase, Telegram or PayPlug.
 * PINTA_SETTINGS_DEVIS_FILTER keeps the checks whose name contains it
 * (« 390-dark », « business »…). */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_SETTINGS_DEVIS_OUT || '/tmp/pinta-settings-devis';
const FILTER = process.env.PINTA_SETTINGS_DEVIS_FILTER || '';
const results = [];

const LAYOUTS = [
  { width: 1440, height: 1000, theme: 'light' }, { width: 1440, height: 1000, theme: 'dark' },
  { width: 390, height: 844, theme: 'light' }, { width: 390, height: 844, theme: 'dark' },
];
const tagOf = layout => `${layout.width}-${layout.theme}`;
const flat = text => String(text).replace(/[  ]/g, ' ');
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Team: a suspended account sorts before the active colleagues and must not open first.
const STAFF = [
  { id: uuid('5a000000', 1), auth_id: uuid('5b000000', 1), role: 'logisticien', nom: 'Martin', prenom: 'Sophie', email: 'sophie@example.test', actif: true, must_change_password: false, staff_permissions: [] },
  { id: uuid('5a000000', 2), auth_id: uuid('5b000000', 2), role: 'preparateur', nom: 'Técher', prenom: 'Alexandre-Emmanuel', email: 'alexandre@example.test', actif: true, must_change_password: true, staff_permissions: [] },
  { id: uuid('5a000000', 3), auth_id: uuid('5b000000', 3), role: 'preparateur', nom: 'Ancien', prenom: 'Compte', email: 'ancien@example.test', actif: false, must_change_password: false, staff_permissions: [] },
];
const USERS_IN_ORDER = ['Alexandre-Emmanuel Técher', 'Compte Ancien', 'Sophie Martin', 'Test Camille'];
// app_settings.business: the three visible values and keys no screen shows any more.
const BUSINESS = { fraisStockage: '1.50', stockageGratuit: '14', diviseurVolumetrique: '5000', relancesFeuVert: 'J+2,J+5,J+7', relancesPaiement: 'J+3,J+7,J+14', timezone: 'Europe/Paris', relancesActivesDepuis: '2026-09-01T00:00:00Z', noteInterne: { source: 'migration', version: 3 } };
// 40 × 30 × 20 cm, 3 kg, 120 € of « Divers » (OM 10 %, OMR 2,5 %) to La Réunion (25 € + 5 €/kg).
const ESTIMATE_TEXT = [
  'Bonjour Marie,', '',
  'Voici votre estimation pour une expédition vers La Réunion.', '',
  'Dimensions : 40 × 30 × 20 cm', 'Poids réel : 3 kg', 'Poids facturable : 4,8 kg', '',
  'Transport : 49,00 €', 'Octroi de mer : 16,90 €', 'Octroi de mer régional : 4,22 €', 'TVA (8,5 %) : 5,96 €', 'Total estimatif : 76,08 €', '',
  'Le montant définitif sera établi après réception, vérification des documents et mesure du colis. Les frais de services supplémentaires éventuellement convenus seront indiqués séparément.', '',
  'L’équipe Expedîle',
].join('\n');

async function fixture(browser, layout, { role = 'directeur', permissions = null } = {}) {
  const f = await setup(browser, role);
  f.page.setDefaultTimeout(10000);
  f.layout = { ...layout, tag: tagOf(layout), mobile: layout.width < 1024 };
  await f.page.setViewportSize({ width: layout.width, height: layout.height });
  await f.context.addInitScript(value => { try { localStorage.setItem('expedile-theme', value); } catch { /* storage blocked */ } }, layout.theme);
  if (role !== 'client') {
    if (permissions) { const row = { staff_id: ids.S, ...permissions }; f.tables.staff_permissions = [row]; f.tables.staff_users[0].staff_permissions = [row]; }
    f.tables.staff_users.push(...structuredClone(STAFF));
  }
  f.tables.tarifs.push(...['971', '972', '976'].map(code => ({ id: `tarif-${code}`, destination_code: code, base: 25, par_kg: 5, actif: true })));
  f.tables.app_settings[0].value = structuredClone(BUSINESS);
  return f;
}

/** save_admin_setting, as 20260917000001_admin_simplification.sql: optimistic check, validation, whole value replaced. */
async function mockBusinessSave(f) {
  const calls = [];
  const canonical = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const reminder = /^J\+[0-9]+(, *J\+[0-9]+)*$/;
  const number = value => value === '' || value == null ? NaN : Number(value);
  await f.context.route('**/rest/v1/rpc/save_admin_setting', async route => {
    const input = route.request().postDataJSON(); calls.push(structuredClone(input));
    const row = f.tables.app_settings.find(item => item.key === input.p_key);
    const value = input.p_value;
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (canonical(row?.value ?? null) !== canonical(input.p_expected ?? null)) return reply(409, { code: '40001', message: 'Ces paramètres ont changé. Rechargez avant de réessayer.' });
    if (!value || typeof value !== 'object' || Array.isArray(value) || !(number(value.fraisStockage) >= 0) || !(number(value.stockageGratuit) >= 0) || !(number(value.diviseurVolumetrique) > 0)
      || !reminder.test(value.relancesFeuVert ?? '') || !reminder.test(value.relancesPaiement ?? '')) return reply(400, { code: 'P0001', message: 'Vérifiez les montants, durées et jours de rappel' });
    if (row) row.value = structuredClone(value); else f.tables.app_settings.push({ key: input.p_key, value: structuredClone(value) });
    return reply(200, value);
  });
  return calls;
}

/** Every finite animation or transition finished (never an endless spinner), at most 3 seconds. */
const settle = f => f.page.evaluate(() => Promise.race([
  Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => null))),
  new Promise(resolve => setTimeout(resolve, 3000)),
]));
async function axe(f, label, include = null) {
  // A page that just opened may still be fading in: its contrast is measured once it has arrived.
  await settle(f);
  const builder = new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  const audit = await (include ? builder.include(include) : builder).analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `axe · ${label}`);
}
const noPageOverflow = async (f, label) => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No horizontal scroll (${label}).`);
const shot = (f, name) => f.page.screenshot({ path: `${output}/${name}-${f.layout.tag}.png` });
/** The page scrolls inside the application shell: grow the viewport to capture all of it. */
async function tallShot(f, name) {
  const viewport = f.page.viewportSize();
  const height = await f.page.evaluate(() => { const scroller = [...document.querySelectorAll('.overflow-y-auto')].filter(node => node.scrollHeight > node.clientHeight + 2).sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; return scroller ? scroller.scrollHeight + innerHeight - scroller.clientHeight : document.documentElement.scrollHeight; });
  await f.page.setViewportSize({ width: viewport.width, height: Math.min(4000, Math.max(viewport.height, height)) });
  await f.page.waitForTimeout(150);
  await f.page.screenshot({ path: `${output}/${name}-${f.layout.tag}.png` });
  await f.page.setViewportSize(viewport);
}
/** Text contrast, colours composited over every ancestor background. */
const contrastOf = locator => locator.evaluate(node => {
  const rgba = value => { const n = value.match(/[\d.]+/g)?.map(Number) || []; return n.length >= 3 ? [...n.slice(0, 3), n[3] ?? 1] : [0, 0, 0, 0]; };
  const over = (fg, bg) => [...fg.slice(0, 3).map((channel, i) => channel * fg[3] + bg[i] * (1 - fg[3])), 1];
  const background = element => { const chain = []; for (let n = element; n && n.nodeType === 1; n = n.parentElement) chain.push(rgba(getComputedStyle(n).backgroundColor)); return chain.reverse().reduce((bg, color) => over(color, bg), [255, 255, 255, 1]); };
  const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const bg = background(node);
  return { text: node.textContent.trim(), color: getComputedStyle(node).color, ratio: contrast(over(rgba(getComputedStyle(node).color), bg), bg) };
});
const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
/** Client-side navigation: the session state (sent messages) stays in memory. */
const spa = (f, path) => f.page.evaluate(target => { history.pushState({}, '', target); dispatchEvent(new PopStateEvent('popstate')); }, path);
async function openSettingsTab(f, label) {
  if (f.layout.mobile) await f.page.getByLabel('Rubrique', { exact: true }).selectOption({ label });
  else await f.page.getByRole('navigation', { name: 'Paramètres', exact: true }).getByRole('button', { name: label, exact: true }).click();
}

/** Where the toast is, and what lies under it: no heading or control of the
 * page, of the navigation column or of the bottom bar may sit under a toast. */
async function toastGeometry(f) {
  await f.page.locator('[data-toast]').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
  return f.page.evaluate(() => {
    const node = document.querySelector('[data-toast]'), box = node.getBoundingClientRect();
    const rect = element => { const r = element?.getBoundingClientRect(); return r && r.width && r.height ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } : null; };
    const bar = [...document.querySelectorAll('button[aria-label="Plus"], nav[aria-label="Navigation principale"] button')].map(button => button.closest('.fixed')).find(Boolean);
    const rail = rect(document.querySelector('.staff-sidebar')), nav = rect(bar);
    const settings = rect(document.querySelector('.staff-sidebar button[aria-label="Paramètres"]'));
    const covered = [...document.querySelectorAll('h1, h2, h3, button, a[href], input, select, textarea, summary')]
      .filter(element => element.getClientRects().length && !node.contains(element))
      .filter(element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < box.bottom && r.bottom > box.top && r.left < box.right && r.right > box.left; })
      .map(element => `${element.tagName} « ${(element.getAttribute('aria-label') || element.textContent).trim().slice(0, 40)} »`);
    // A click on the toast stays on it (never on what lies under it).
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { kind: node.dataset.toast, placement: node.dataset.placement, role: node.getAttribute('role'), text: node.textContent.trim(), toast: rect(node), rail, nav, settings, covered, takesClick: node.contains(hit), accent: getComputedStyle(node).borderLeftColor, viewport: innerHeight };
  });
}
function assertToastClear(f, geometry, label, { collapsed = false } = {}) {
  assert.deepEqual(geometry.covered, [], `${label}: the toast covers no heading, action or field, of the page or of the navigation.`);
  assert.equal(geometry.takesClick, true, `${label}: a click on the toast stays on it.`);
  if (f.layout.mobile) {
    // Centred first; when a control lies there, a narrower corner (domain/toast.js), never over it.
    assert.ok(['bottom', 'top', 'bottom-end', 'bottom-start', 'top-end', 'top-start'].includes(geometry.placement), `${label}: centred above the bottom bar or below the top bar, else a corner (${geometry.placement}).`);
    assert.ok(geometry.nav && geometry.toast.bottom <= geometry.nav.top + 0.5 && geometry.toast.top >= 0, `${label}: never on the bottom navigation (${JSON.stringify(geometry)}).`);
  } else if (collapsed) {
    // The folded column (64 px) holds no message: a free corner of the page, beside it.
    assert.ok(['bottom', 'bottom-end', 'top-end'].includes(geometry.placement), `${label}: a corner of the page (${geometry.placement}).`);
    assert.ok(geometry.rail && geometry.toast.left >= geometry.rail.right, `${label}: never over the folded column (${JSON.stringify(geometry)}).`);
  } else {
    assert.equal(geometry.placement, 'rail');
    assert.ok(geometry.rail && geometry.settings && geometry.toast.left >= geometry.rail.left && geometry.toast.right <= geometry.rail.right + 0.5 && geometry.toast.bottom <= geometry.settings.top + 0.5,
      `${label}: in the free space of the navigation column, above « Paramètres » and the account buttons (${JSON.stringify(geometry)}).`);
  }
}
/** A click (a tap on a phone) on the toast closes it, and nothing else happens. */
async function dismissToast(f, label) {
  const toast = f.page.locator('[data-toast]');
  const box = await toast.boundingBox(), url = f.page.url();
  if (f.layout.mobile) await f.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => f.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2));
  else await f.page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  await toast.waitFor({ state: 'hidden' });
  assert.equal(f.page.url(), url, `${label}: closing the toast navigates nowhere.`);
  assert.equal(await f.page.locator('#login-email').count(), 0, `${label}: closing the toast never logs out.`);
}

// ── 1, 2, 3 · Estimation rapide ────────────────────────────────────────────
async function fillEstimate(f, { nom = 'Martin', prenom = 'Marie' } = {}) {
  await f.page.goto(`${base}/devis`);
  await f.page.getByRole('heading', { name: 'Estimation rapide', exact: true }).waitFor();
  for (const [label, value] of [['Longueur (cm)', '40'], ['Largeur (cm)', '30'], ['Hauteur (cm)', '20'], ['Poids (kg)', '3']]) await f.page.getByLabel(label, { exact: true }).fill(value);
  await f.page.getByLabel('Valeur de la marchandise', { exact: true }).fill('120');
  await f.page.locator('label', { hasText: 'Catégorie de marchandise' }).locator('select').selectOption('cat-test');
  await f.page.getByLabel('Nom', { exact: true }).fill(nom);
  await f.page.getByLabel('Prénom', { exact: true }).fill(prenom);
}
async function checkEstimate(f) {
  await f.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await fillEstimate(f);
  const title = f.page.getByRole('heading', { name: 'Estimation rapide', exact: true });
  const total = f.page.getByTestId('estimate-total');
  // 1 · The title and the total use the brand text token: readable in both themes.
  assert.equal(flat(await total.innerText()), '76,08 €');
  for (const [name, locator] of [['Estimation rapide', title], ['total', total]]) {
    const style = await contrastOf(locator);
    assert.ok(style.ratio >= 4.5, `${name}: ${style.ratio.toFixed(2)}:1 (${style.color}) in ${f.layout.theme}`);
  }
  // 3 · French amounts and weights, never split between two lines.
  const aside = f.page.locator('aside');
  const summary = flat(await aside.innerText());
  for (const expected of [/Transport\s+49,00 €/, /Octroi de mer\s+16,90 €/, /Octroi de mer régional\s+4,22 €/, /TVA \(8,5 %\)\s+5,96 €/, /Poids facturable : 4,8 kg\./]) assert.match(summary, expected);
  assert.doesNotMatch(summary, /\d\.\d\d €|\d\.\d+ kg/, 'No amount or weight keeps the English decimal point.');
  assert.deepEqual(await aside.locator('dd, [data-testid="estimate-total"]').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length !== 1).map(node => node.textContent)), [], 'Each amount fits on one line.');
  // 2 · The shared text: a readable layout, the first name, and the same text in the copy.
  await aside.locator('summary', { hasText: 'Aperçu du texte à partager' }).click();
  const preview = f.page.getByTestId('estimate-text');
  assert.equal(flat(await preview.innerText()).trim(), ESTIMATE_TEXT);
  assert.equal(await preview.evaluate(node => getComputedStyle(node).fontFamily.includes('mono')), false, 'The preview is not a monospace block.');
  assert.deepEqual(await preview.locator('.whitespace-nowrap').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length !== 1).map(node => node.textContent)), [], 'No value is split between two lines.');
  assert.match(await preview.innerText(), /4,22 €/, 'A no-break space ties each amount to its euro sign.');
  await noPageOverflow(f, 'estimate');
  await axe(f, 'estimate with its text');
  await tallShot(f, 'devis-estimate-text');
  await aside.getByRole('button', { name: 'Copier le texte', exact: true }).click();
  await aside.getByText('Estimation copiée.', { exact: true }).waitFor();
  assert.equal(flat(await f.page.evaluate(() => navigator.clipboard.readText())), ESTIMATE_TEXT, 'The copied text is the previewed text.');
  // Two greetings: with a name, without one; never « Bonjour , ».
  for (const [nom, prenom, greeting] of [['', '', 'Bonjour,'], ['Martin', '', 'Bonjour Martin,'], ['', 'Marie', 'Bonjour Marie,']]) {
    await f.page.getByLabel('Nom', { exact: true }).fill(nom); await f.page.getByLabel('Prénom', { exact: true }).fill(prenom);
    const text = flat(await preview.innerText());
    assert.equal(text.split('\n')[0], greeting); assert.doesNotMatch(text, /Bonjour ,/);
  }
}
async function checkEstimateWithoutCategories(f) {
  const categories = structuredClone(f.tables.categories), rates = structuredClone(f.tables.taux_categories);
  try {
    // A category exists without rates for Mayotte: the estimate explains it.
    await f.page.goto(`${base}/devis`);
    await f.page.locator('label', { hasText: 'Destination' }).locator('select').selectOption('976');
    const note = f.page.getByRole('note', { name: 'Catégories à configurer', exact: true });
    await note.getByText('Aucune catégorie n’a de taux pour Mayotte.', { exact: true }).waitFor();
    assert.deepEqual(await f.page.locator('label', { hasText: 'Catégorie de marchandise' }).locator('option').evaluateAll(options => options.map(option => option.textContent)), ['Choisir une catégorie', 'Divers · taux à compléter']);
    // No category at all: explanation and a link to the categories settings.
    f.tables.categories = []; f.tables.taux_categories = [];
    await f.page.goto(`${base}/devis`);
    await note.getByText('Aucune catégorie de marchandise n’est configurée.', { exact: true }).waitFor();
    await note.getByText(/l’octroi de mer dépend de la catégorie/).waitFor();
    assert.equal(await f.page.locator('label', { hasText: 'Catégorie de marchandise' }).count(), 0);
    await noPageOverflow(f, 'estimate without category');
    await axe(f, 'estimate without category');
    await shot(f, 'devis-no-category');
    await note.getByRole('link', { name: 'Configurer les catégories et taxes', exact: true }).click();
    await f.page.waitForURL(url => url.pathname === '/settings' && url.searchParams.get('tab') === 'categories');
    await f.page.getByRole('heading', { name: 'Catégories et taxes', exact: true }).waitFor();
  } finally { f.tables.categories = categories; f.tables.taux_categories = rates; }
}

// ── 4 · Stockage et rappels ────────────────────────────────────────────────
async function checkBusiness(f) {
  const calls = await mockBusinessSave(f);
  try {
    await f.page.goto(`${base}/settings?tab=metier`);
    const panel = f.page.getByTestId('settings-panel');
    await panel.getByRole('heading', { name: 'Stockage et rappels', exact: true }).waitFor();
    await panel.getByRole('heading', { name: 'Tarif de stockage de référence', exact: true }).waitFor();
    await panel.getByText('Indicatif : les frais de stockage s’ajoutent au devis par l’équipe, jamais automatiquement.', { exact: true }).waitFor();
    // The reminders are explained, never offered as settings that act.
    // The consent relance as the server applies it (20261007000001): 48 h before the closing, never within the 24 h
    // after a delivered request or relance, nor while it is still to deliver.
    assert.equal(flat(await panel.locator('li', { hasText: 'Accord du client' }).innerText()), 'Accord du client : quand l’accord manque, la tâche de relance apparaît 48 h avant la clôture du départ. Après une demande ou une relance, elle attend sa livraison au client puis 24 h ; un envoi en échec ou annulé ne la retarde pas.');
    assert.equal(flat(await panel.locator('li', { hasText: 'Paiement' }).innerText()), 'Paiement : les relances se font depuis le dossier.');
    assert.equal(await panel.getByText(/créent des tâches|Rappels après/).count(), 0);
    assert.deepEqual(await panel.locator('input, select, textarea').evaluateAll(nodes => nodes.map(node => node.id)), ['business-fraisStockage', 'business-stockageGratuit', 'business-diviseurVolumetrique']);
    for (const width of await panel.locator('input').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width))) assert.ok(width <= 128, `A 2–4 digit value gets a narrow field (${width}px).`);
    const field = label => f.page.getByLabel(label, { exact: true });
    assert.deepEqual([await field('Frais de stockage').inputValue(), await field('Stockage gratuit').inputValue(), await field('Diviseur du poids volumétrique').inputValue()], ['1.50', '14', '5000']);
    // Invalid values: an inline message under each field, nothing sent.
    await field('Frais de stockage').fill('-1'); await field('Diviseur du poids volumétrique').fill('0');
    await panel.getByRole('button', { name: 'Enregistrer les règles', exact: true }).click();
    await panel.locator('#business-fraisStockage-error').getByText('Indiquez un montant positif ou nul, par exemple 1,50.', { exact: true }).waitFor();
    await panel.locator('#business-diviseurVolumetrique-error').getByText('Indiquez un diviseur supérieur à zéro, par exemple 5000.', { exact: true }).waitFor();
    assert.equal(await field('Frais de stockage').getAttribute('aria-invalid'), 'true');
    const [red, green] = rgb(await field('Diviseur du poids volumétrique').evaluate(node => getComputedStyle(node).borderTopColor));
    assert.ok(red > green + 40, `A wrong value is outlined in red in ${f.layout.theme} (${red}, ${green}).`);
    assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'business-fraisStockage');
    assert.equal(calls.length, 0, 'An invalid form sends nothing.');
    await axe(f, 'business errors'); await shot(f, 'settings-metier-errors');
    // A valid save sends the whole stored object: the hidden keys are kept as they were.
    await field('Frais de stockage').fill('2.5'); await field('Stockage gratuit').fill('7'); await field('Diviseur du poids volumétrique').fill('6000');
    await panel.getByRole('button', { name: 'Enregistrer les règles', exact: true }).click();
    await panel.getByText('Règles enregistrées. Les devis déjà enregistrés conservent leur version.', { exact: true }).waitFor();
    const saved = { ...BUSINESS, fraisStockage: 2.5, stockageGratuit: 7, diviseurVolumetrique: 6000 };
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { p_key: 'business', p_value: saved, p_expected: BUSINESS });
    assert.deepEqual(f.tables.app_settings.find(row => row.key === 'business').value, saved, 'No stored key is dropped.');
    assert.equal(await panel.locator('.text-red-500').count(), 0);
    await tallShot(f, 'settings-metier-saved');
    // Re-read from the database: another administrator changes a value, « Annuler et recharger » shows it.
    f.tables.app_settings.find(row => row.key === 'business').value.fraisStockage = 3;
    await f.page.reload();
    await panel.getByRole('heading', { name: 'Stockage et rappels', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Annuler et recharger', exact: true }).click();
    assert.equal(await field('Frais de stockage').inputValue(), '3');
    assert.equal(await field('Diviseur du poids volumétrique').inputValue(), '6000');
    await axe(f, 'business reloaded');
  } finally {
    await f.context.unroute('**/rest/v1/rpc/save_admin_setting');
    f.tables.app_settings.find(row => row.key === 'business').value = structuredClone(BUSINESS);
    await f.page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.includes('admin:business')) localStorage.removeItem(key); });
  }
}

// ── 5 · Configuration that could not load ──────────────────────────────────
async function checkFailedLoad(f) {
  let failing = true;
  await f.context.route('**/rest/v1/app_settings*', route => failing && route.request().method() === 'GET'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Indisponibilité simulée' }) }) : route.fallback());
  await f.login();
  await f.page.goto(`${base}/settings?tab=metier`);
  const main = f.page.getByTestId('settings-panel');
  const alert = main.getByRole('alert');
  await alert.getByRole('heading', { name: 'Chargement impossible', exact: true }).waitFor();
  assert.match(flat(await alert.innerText()), /La configuration n’a pas pu être chargée \(Indisponibilité simulée\)\. Aucun réglage n’est modifiable tant qu’elle n’est pas chargée/);
  assert.equal(await f.page.getByText(/Chargement de la configuration|disponibles après connexion/).count(), 0, 'A failure is never presented as a load in progress.');
  assert.equal(await main.locator('input, select, textarea').count(), 0, 'Nothing is editable until the configuration is loaded.');
  await noPageOverflow(f, 'failed load'); await axe(f, 'failed load'); await shot(f, 'settings-failed-load');
  failing = false;
  await alert.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await f.page.getByRole('heading', { name: 'Stockage et rappels', exact: true }).waitFor();
  assert.equal(await f.page.getByLabel('Frais de stockage', { exact: true }).isEnabled(), true);
  assert.equal(await f.page.getByRole('heading', { name: 'Chargement impossible', exact: true }).count(), 0);
}

// ── 6 · Canaux de contact (and 9 · the toast of a delivered message) ─────
async function sendConsentRequest(f, at) {
  await f.page.clock.setFixedTime(new Date(at));
  const region = f.page.getByRole('region', { name: 'Notification au client', exact: true });
  const prepare = region.getByRole('button', { name: 'Préparer la demande au client', exact: true });
  if (await prepare.count()) await prepare.click();
  await region.getByLabel('Message à envoyer au client', { exact: true }).waitFor();
  await region.getByRole('button', { name: /^(Envoyer la demande d’accord|Envoyer ce message)$/ }).click();
  await f.page.locator('[data-toast]').filter({ hasText: 'Message livré à Telegram' }).waitFor();
}
async function checkChannels(f) {
  Object.assign(f.tables.colis[0], { statut: 'mesure', feu_vert: 'en_attente', consent_request_version: 0, nb_colis: 1, trackings: ['TEST-001'], trackings_detail: [{ number: 'TEST-001', fournisseur: 'Boutique A' }], dims_par_colis: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3 }] });
  Object.assign(f.tables.clients[0], { telegram_chat_id: '555' });
  await f.context.route('**/functions/v1/send-telegram', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'sent' }) }));
  await f.page.goto(`${base}/colis/${ids.P}?section=accord`);
  await sendConsentRequest(f, '2026-10-06T21:26:47.607Z');
  // 9 · The confirmation covers no control: the navigation column's free space, or above the bottom bar.
  const geometry = await toastGeometry(f);
  assert.equal(geometry.kind, 'info'); assert.equal(geometry.role, 'status');
  assertToastClear(f, geometry, 'delivered message');
  await shot(f, 'toast-message-delivered');
  await sendConsentRequest(f, '2026-10-06T22:05:00.000Z');
  assert.equal(f.tables.messages.length, 2);
  await spa(f, '/settings?tab=telegram');
  const main = f.page.getByTestId('settings-panel');
  await main.getByRole('heading', { name: 'Canaux de contact', exact: true }).waitFor();
  const telegram = main.locator('[data-channel="telegram"]'), email = main.locator('[data-channel="email"]');
  // The latest delivery (not the oldest), in French and Paris time; the log covers this page only.
  await telegram.getByText('Dernier message livré depuis l’ouverture de cette page : 7 octobre 2026 à 00:05', { exact: true }).waitFor();
  assert.equal(await telegram.locator('time').getAttribute('datetime'), '2026-10-06T22:05:00.000Z');
  assert.doesNotMatch(await main.innerText(), /\d{4}-\d{2}-\d{2}T\d/, 'No raw ISO date.');
  // Email never claims a sending.
  const emailText = flat(await email.innerText());
  assert.match(emailText, /Les emails sont préparés comme brouillons à envoyer depuis votre messagerie\./);
  assert.match(emailText, /Aucun brouillon préparé depuis l’ouverture de cette page\./);
  assert.doesNotMatch(emailText, /envoyer depuis un dossier|Vous pouvez envoyer/);
  await noPageOverflow(f, 'channels'); await axe(f, 'channels'); await shot(f, 'settings-channels');
}

// ── 7 · Names ──────────────────────────────────────────────────────────────
async function checkNames(f) {
  await f.page.goto(`${base}/settings?tab=users`);
  await f.page.getByRole('heading', { name: 'Équipe et accès', exact: true }).waitFor();
  assert.equal(await f.page.getByRole('heading', { name: 'Utilisateurs et permissions' }).count(), 0, 'One name for the rubric and its heading.');
  if (f.layout.mobile) assert.equal(await f.page.getByLabel('Rubrique', { exact: true }).evaluate(select => select.selectedOptions[0].textContent), 'Équipe et accès');
  else assert.equal(await f.page.getByRole('navigation', { name: 'Paramètres', exact: true }).getByRole('button', { name: 'Équipe et accès', exact: true }).getAttribute('aria-current'), 'page');
  await f.page.getByRole('group', { name: 'Utilisateurs de l’équipe', exact: true }).getByRole('button').filter({ hasText: 'Sophie Martin' }).click();
  const departures = f.page.getByRole('region', { name: 'Départs', exact: true });
  await departures.getByRole('button', { expanded: false }).first().click();
  assert.deepEqual(await departures.getByRole('checkbox').evaluateAll(boxes => boxes.map(box => box.closest('label').textContent.trim())), ['Voir les départs', 'Créer un départ', 'Modifier un départ', 'Réaffecter un colis à un autre départ', 'Imprimer les étiquettes']);
  const parcels = f.page.getByRole('region', { name: 'Colis', exact: true });
  await parcels.getByRole('button', { expanded: false }).first().click();
  await parcels.getByRole('checkbox', { name: 'Affecter à un départ', exact: true }).waitFor();
  const labels = await f.page.locator('[aria-label="Équipe et accès"] input[type="checkbox"]').evaluateAll(boxes => boxes.map(box => box.closest('label').textContent.trim()));
  assert.deepEqual(labels.filter(label => /\benvois?\b/i.test(label)), [], 'No permission speaks of « envoi » for a departure.');
  await axe(f, 'team permissions'); await shot(f, 'settings-users-names');
  await f.page.goto(`${base}/settings?tab=categories`);
  await f.page.getByRole('button', { name: /^Divers · / }).click();
  await f.page.getByLabel('Octroi de mer régional (%)', { exact: true }).waitFor();
  await f.page.getByLabel('Octroi de mer (%)', { exact: true }).waitFor();
  assert.equal(await f.page.getByText(/Octroi régional/).count(), 0);
}

// ── 8 · Team list ──────────────────────────────────────────────────────────
async function checkTeam(f) {
  await f.page.goto(`${base}/settings?tab=tarifs`);
  await f.page.getByRole('heading', { name: 'Tarifs de transport', exact: true }).waitFor();
  // Loading: skeleton rows shaped like the list, the label for screen readers only.
  let release; const held = new Promise(resolve => { release = resolve; });
  await f.context.route('**/rest/v1/staff_users*', async route => { if (route.request().method() === 'GET') await held; return route.fallback(); });
  try {
    await openSettingsTab(f, 'Équipe et accès');
    const skeleton = f.page.getByTestId('staff-users-skeleton');
    await skeleton.waitFor();
    assert.equal(await skeleton.getAttribute('aria-busy'), 'true');
    assert.ok(await skeleton.locator('.animate-pulse').count() >= 12, 'Skeleton rows for the list and the permissions.');
    const label = skeleton.getByText('Chargement des utilisateurs et de leurs permissions…', { exact: true });
    assert.ok((await label.boundingBox()).width <= 1, 'The loading sentence is read, not shown.');
    await axe(f, 'team skeleton'); await shot(f, 'settings-users-loading');
  } finally { release(); await f.context.unroute('**/rest/v1/staff_users*'); }
  const group = f.page.getByRole('group', { name: 'Utilisateurs de l’équipe', exact: true });
  await group.getByRole('button').first().waitFor();
  const names = await group.getByRole('button').evaluateAll(buttons => buttons.map(button => button.querySelector('span.block').textContent));
  assert.deepEqual(names, USERS_IN_ORDER, 'Displayed and sorted by the same « Prénom Nom ».');
  assert.equal(await group.locator('[aria-pressed="true"]').evaluate(button => button.querySelector('span.block').textContent), 'Alexandre-Emmanuel Técher', 'A suspended account is never opened first.');
  await group.getByRole('button').filter({ hasText: 'Compte Ancien' }).click();
  const reactivate = f.page.getByRole('button', { name: 'Réactiver l’accès', exact: true });
  await reactivate.waitFor();
  assert.equal(await f.page.getByRole('button', { name: 'Suspendre l’accès', exact: true }).count(), 0);
  const [r, g] = rgb(await reactivate.evaluate(button => getComputedStyle(button).color));
  assert.ok(g > r, `« Réactiver l’accès » is a positive action, not a red one (${r}, ${g}).`);
  assert.ok((await contrastOf(reactivate)).ratio >= 4.5);
  await axe(f, 'suspended account'); await shot(f, 'settings-users-reactivate');
  await group.getByRole('button').filter({ hasText: 'Sophie Martin' }).click();
  const [red, green] = rgb(await f.page.getByRole('button', { name: 'Suspendre l’accès', exact: true }).evaluate(button => getComputedStyle(button).color));
  assert.ok(red > green, 'Suspending stays the red action.');
}

// ── 9 · Toasts ─────────────────────────────────────────────────────────────
async function checkToasts(f) {
  // A deleted category is confirmed once, inline, as every setting.
  await f.context.route('**/rest/v1/rpc/delete_admin_category', route => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  try {
    await f.page.goto(`${base}/settings?tab=categories`);
    await f.page.locator('article', { hasText: 'Divers' }).getByRole('button', { name: 'Supprimer', exact: true }).click();
    const dialog = f.page.getByRole('dialog');
    await dialog.getByRole('button').filter({ hasText: /^(Supprimer|Confirmer)$/ }).last().click();
    await f.page.getByTestId('settings-panel').getByText('Catégorie supprimée.', { exact: true }).waitFor();
    await f.page.waitForTimeout(400);
    assert.equal(await f.page.locator('[data-toast]').count(), 0, 'No toast doubles the inline confirmation.');
  } finally { await f.context.unroute('**/rest/v1/rpc/delete_admin_category'); }
  // « Client ajouté » never covers the page heading or its actions.
  await f.page.goto(`${base}/clients/new`);
  for (const [label, value] of Object.entries({ Nom: 'Ti Kaz Import', Prénom: 'Marie', Email: 'contact@tikaz.example', Téléphone: '0692 12 34 56', Adresse: '4 rue des Lilas', 'Code postal': '97410', Ville: 'Saint-Pierre' })) {
    await f.page.getByLabel(label, { exact: true }).fill(value);
  }
  await f.page.getByRole('button', { name: 'Créer le client', exact: true }).click();
  await f.page.locator('[data-toast]').filter({ hasText: 'Client ajouté' }).waitFor();
  assertToastClear(f, await toastGeometry(f), 'Client ajouté');
  await axe(f, 'client added toast'); await shot(f, 'toast-client-added');
  await dismissToast(f, 'Client ajouté');
  // A failed revocation is an error, in the error style.
  // The share link lives in « Synthèse », the tab a client page opens on.
  await f.page.goto(`${base}/clients/${ids.C}`);
  // On a desktop, with the navigation column folded this time.
  if (!f.layout.mobile) await f.page.getByRole('button', { name: 'Réduire la navigation', exact: true }).click();
  await f.page.getByRole('button', { name: 'Créer le lien de suivi', exact: true }).click();
  await f.page.getByRole('button', { name: /Révoquer/ }).first().waitFor();
  await f.context.route('**/rest/v1/share_links*', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Service indisponible (essai)' }) }) : route.fallback());
  try {
    await f.page.getByRole('button', { name: /Révoquer/ }).first().click();
    await f.page.getByRole('dialog').getByRole('button', { name: 'Révoquer', exact: true }).click();
    const toast = f.page.locator('[data-toast]').filter({ hasText: 'Le lien n’a pas été révoqué : Service indisponible (essai)' });
    await toast.waitFor();
    const geometry = await toastGeometry(f);
    assert.equal(geometry.kind, 'error'); assert.equal(geometry.role, 'alert');
    const [r, g, b] = rgb(geometry.accent);
    assert.ok(r > g + 40 && r > b + 40, `The error edge is red (${geometry.accent}).`);
    assert.ok((await contrastOf(toast.locator('p'))).ratio >= 4.5);
    assertToastClear(f, geometry, 'revocation error', { collapsed: !f.layout.mobile });
    // The client page around it belongs to another screen: the audit covers the toast.
    await axe(f, 'revocation error toast', '[data-toast]'); await shot(f, 'toast-revoke-error');
  } finally { await f.context.unroute('**/rest/v1/share_links*'); }
}

// ── 10 · Loading view ──────────────────────────────────────────────────────
/** The shell around the content: navigation column (desktop), top and bottom bars (phone). */
function shellGeometry(f, skeleton) {
  return f.page.evaluate(isSkeleton => {
    const rect = element => { const r = element?.getBoundingClientRect(); return r ? { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null; };
    const root = isSkeleton ? document.querySelector('[data-testid="shell-skeleton"]') : document.querySelector('.staff-sidebar').parentElement;
    const children = [...root.children];
    const rail = isSkeleton ? children[0] : root.querySelector('.staff-sidebar');
    const column = children.find(node => node.classList.contains('flex-1') && node.classList.contains('flex-col'));
    const bar = children.find(node => node.classList.contains('fixed'));
    return { rail: rect(rail), column: rect(column), top: rect(column.firstElementChild), bottom: rect(bar) };
  }, skeleton);
}
async function checkLoadingShell(f) {
  await f.page.goto(`${base}/settings?tab=tarifs`);
  await f.page.getByRole('heading', { name: 'Tarifs de transport', exact: true }).waitFor();
  let releaseProfile, releaseData;
  const profile = new Promise(resolve => { releaseProfile = resolve; }), data = new Promise(resolve => { releaseData = resolve; });
  await f.context.route('**/rest/v1/profiles*', async route => { await profile; return route.fallback(); });
  await f.context.route('**/rest/v1/colis*', async route => { if (route.request().method() === 'GET') await data; return route.fallback(); });
  try {
    await f.page.reload({ waitUntil: 'domcontentloaded' });
    const skeleton = f.page.getByTestId('shell-skeleton');
    // Before the profile is known, the shell of the last session on this device; then the profile decides.
    await skeleton.waitFor();
    assert.equal(await skeleton.getAttribute('data-shell'), 'staff');
    const dataRequested = f.page.waitForRequest(request => new URL(request.url()).pathname === '/rest/v1/colis');
    releaseProfile();
    await dataRequested;
    await f.page.getByText('Chargement de votre espace…', { exact: true }).waitFor();
    assert.equal(await skeleton.getAttribute('data-shell'), 'staff');
    const before = await shellGeometry(f, true);
    if (f.layout.mobile) { assert.ok(before.top.height >= 48 && before.bottom.height >= 60, JSON.stringify(before)); assert.equal(before.rail.width, 0); }
    else { assert.deepEqual([before.rail.left, before.rail.width, before.column.left], [0, 220, 220]); assert.equal(await skeleton.evaluate(node => getComputedStyle(node.firstElementChild).backgroundImage.includes('gradient')), true, 'The navy column is already there.'); }
    await noPageOverflow(f, 'loading shell'); await axe(f, 'loading shell'); await shot(f, 'loading-shell');
    releaseData();
    await f.page.getByRole('heading', { name: 'Tarifs de transport', exact: true }).waitFor();
    const after = await shellGeometry(f, false);
    // Nothing jumps when the page appears: same column, same bars.
    if (f.layout.mobile) { assert.equal(after.top.height, before.top.height, 'Top bar'); assert.ok(Math.abs(after.bottom.height - before.bottom.height) <= 1 && after.bottom.top === before.bottom.top, `Bottom bar ${JSON.stringify([before.bottom, after.bottom])}`); }
    else { assert.deepEqual([after.rail.left, after.rail.width, after.column.left], [before.rail.left, before.rail.width, before.column.left]); }
  } finally {
    releaseProfile(); releaseData();
    await f.context.unroute('**/rest/v1/profiles*'); await f.context.unroute('**/rest/v1/colis*');
  }
}
async function checkClientLoadingShell(f) {
  await f.login();
  await f.page.getByRole('navigation', { name: 'Navigation principale', exact: true }).waitFor({ state: 'attached' });
  // The resolved profile is remembered on this device: the next visit starts from the client shell.
  await f.page.waitForFunction(() => localStorage.getItem('expedile-shell') === 'client');
  const header = () => f.page.evaluate(() => { const node = document.querySelector('[data-testid="shell-skeleton"] .glass-dark, header.glass-dark'); const r = node.getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height) }; });
  // The bottom bar: its placeholder, then the real one (none from 1024 px: the links sit in the header).
  const navBar = () => f.page.evaluate(() => { const node = document.querySelector('[data-testid="shell-skeleton"] [data-skeleton-bar], nav.glass-nav[aria-label="Navigation principale"]'); const r = node?.getBoundingClientRect(); return r?.height ? { top: Math.round(r.top), height: Math.round(r.height) } : null; });
  // 1 · A returning client while the profile is read: the shell placeholder is the client's, never the staff's.
  let release; let held = new Promise(resolve => { release = resolve; });
  await f.context.route('**/rest/v1/profiles*', async route => { await held; return route.fallback(); });
  try {
    await f.page.reload({ waitUntil: 'domcontentloaded' });
    const shell = f.page.getByTestId('shell-skeleton');
    await shell.waitFor();
    assert.equal(await shell.getAttribute('data-shell'), 'client', 'A returning client never sees the staff navigation while the profile is read.');
    const before = { header: await header(), nav: await navBar() };
    await noPageOverflow(f, 'client loading shell'); await axe(f, 'client loading shell'); await shot(f, 'loading-shell-client');
    release();
    await f.page.getByRole('navigation', { name: 'Navigation principale', exact: true }).waitFor({ state: 'attached' });
    await f.page.waitForFunction(() => !document.querySelector('[data-testid="shell-skeleton"]'));
    const after = { header: await header(), nav: await navBar() };
    assert.deepEqual(after.header, before.header, 'Same header.');
    assert.deepEqual(Boolean(after.nav), Boolean(before.nav), `A bottom bar in both or in neither ${JSON.stringify([before.nav, after.nav])}`);
    if (after.nav) assert.ok(Math.abs(after.nav.height - before.nav.height) <= 1 && Math.abs(after.nav.top - before.nav.top) <= 1, `Same bottom bar ${JSON.stringify([before.nav, after.nav])}`);
  } finally { release(); await f.context.unroute('**/rest/v1/profiles*'); }
  // 2 · Once the client is known, the portal's own skeletons, in its real header and navigation.
  // The expeditions are held: the portal's skeleton is the state reached on any machine. A shell
  // placeholder drawn on the way (a slow machine shows it a moment) is recorded as it appears,
  // never read after it is gone: it must be the client's too.
  await f.page.addInitScript(() => {
    window.__expedileShells = [];
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('[data-testid="shell-skeleton"]')) if (!window.__expedileShells.includes(node.dataset.shell)) window.__expedileShells.push(node.dataset.shell);
    }).observe(document, { childList: true, subtree: true });
  });
  held = new Promise(resolve => { release = resolve; });
  await f.context.route('**/rest/v1/client_colis*', async route => { await held; return route.fallback(); });
  try {
    await f.page.reload({ waitUntil: 'domcontentloaded' });
    await f.page.locator('[data-testid^="client-skeleton-"]').first().waitFor();
    const shells = await f.page.evaluate(() => window.__expedileShells);
    assert.ok(shells.every(kind => kind === 'client'), `Only the client's shell placeholder, if any (${JSON.stringify(shells)}).`);
    const before = { header: await header(), nav: await navBar() };
    release();
    await f.page.getByRole('navigation', { name: 'Navigation principale', exact: true }).waitFor({ state: 'attached' });
    await f.page.waitForFunction(() => !document.querySelector('[data-testid="shell-skeleton"], [data-testid^="client-skeleton-"]'));
    const after = { header: await header(), nav: await navBar() };
    assert.deepEqual(after.header, before.header, 'Same header.');
    assert.deepEqual(Boolean(after.nav), Boolean(before.nav));
    if (after.nav) assert.ok(Math.abs(after.nav.height - before.nav.height) <= 1 && Math.abs(after.nav.top - before.nav.top) <= 1, `Same bottom bar ${JSON.stringify([before.nav, after.nav])}`);
  } finally { release(); await f.context.unroute('**/rest/v1/client_colis*'); }
}

/** A client's expedition that does not exist: the browser title says so too; a
 * voluntary password change goes back to the profile, never through the home page. */
async function checkClientReturns(f) {
  await f.login();
  const spa = path => f.page.evaluate(target => { history.pushState({}, '', target); dispatchEvent(new PopStateEvent('popstate')); }, path);
  await f.page.getByRole('navigation', { name: 'Navigation principale', exact: true }).first().waitFor({ state: 'attached' });
  await spa('/colis/aaaaaaaa-0000-4000-8000-000000000999');
  await f.page.getByRole('heading', { level: 1, name: 'Expédition introuvable', exact: true }).waitFor();
  await f.page.waitForFunction(() => document.title === 'Expédition introuvable — Expedîle');
  await spa('/profil');
  await spa('/password');
  await f.page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await f.page.waitForURL(url => url.pathname === '/profil');
  await spa('/password');
  await f.page.getByLabel('Nouveau mot de passe', { exact: true }).fill('Expedile-client-2026');
  await f.page.locator('#confirm-password').fill('Expedile-client-2026');
  await f.page.evaluate(() => { window.__paths = []; const record = () => window.__paths.push(location.pathname); for (const name of ['pushState', 'replaceState']) { const original = history[name].bind(history); history[name] = (...args) => { const result = original(...args); record(); return result; }; } });
  await f.page.locator('form').getByRole('button').filter({ hasText: /mot de passe/i }).last().click();
  await f.page.waitForURL(url => url.pathname === '/profil');
  await f.page.locator('[data-toast="success"]').filter({ hasText: 'Votre mot de passe est modifié.' }).waitFor();
  assert.equal((await f.page.evaluate(() => window.__paths)).includes('/'), false, 'Never through the home page.');
  await axe(f, 'client password changed'); await shot(f, 'client-password-changed');
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const wanted = name => !FILTER || name.includes(FILTER);
  /** One logged-in context runs several checks; each check records its own result. */
  async function session(name, layout, checks, options = {}) {
    const names = checks.map(([check]) => `${check}-${tagOf(layout)}`);
    if (!names.some(wanted) && !wanted(`${name}-${tagOf(layout)}`)) return;
    const f = await fixture(browser, layout, options);
    try {
      if (!options.noLogin) await f.login();
      for (const [check, run] of checks) {
        const test = `${check}-${tagOf(layout)}`;
        if (!wanted(test) && !wanted(`${name}-${tagOf(layout)}`)) continue;
        const errors = f.errors.length, denied = f.networkDenied.length;
        try {
          await run(f);
          assert.deepEqual(f.errors.slice(errors), [], 'No uncaught application error');
          assert.deepEqual(f.networkDenied.slice(denied), [], 'No unexpected external request');
          results.push({ test, pass: true });
        } catch (error) {
          process.exitCode = 1; results.push({ test, pass: false, error: error.stack });
          await f.page.screenshot({ path: `${output}/${test}-failure.png`, fullPage: true }).catch(() => {});
        }
        console.log(JSON.stringify(results.at(-1)));
      }
    } finally { await f.context.close(); }
  }
  try {
    for (const layout of LAYOUTS) {
      await session('staff', layout, [
        ['estimate', checkEstimate],
        ['estimate-without-category', checkEstimateWithoutCategories],
        ['names', checkNames],
        ['team', checkTeam],
        ['business', checkBusiness],
        ['toasts', checkToasts],
        ['loading-shell', checkLoadingShell],
        // Last: it fixes the page clock.
        ['channels', checkChannels],
      ]);
      await session('failed-load', layout, [['failed-load', checkFailedLoad]], { noLogin: true });
      await session('client', layout, [['client-loading-shell', checkClientLoadingShell]], { role: 'client', noLogin: true });
      await session('client-returns', layout, [['client-returns', checkClientReturns]], { role: 'client', noLogin: true });
    }
    // Without the categories permission, the estimate explains whom to ask (no link).
    await session('estimate-no-category-permission', LAYOUTS[3], [['estimate-no-category-permission', async f => {
      f.tables.categories = []; f.tables.taux_categories = [];
      await f.page.goto(`${base}/devis`);
      const note = f.page.getByRole('note', { name: 'Catégories à configurer', exact: true });
      await note.getByText('Demandez à la direction de les configurer dans les paramètres.', { exact: true }).waitFor();
      assert.equal(await note.getByRole('link').count(), 0);
      await axe(f, 'estimate without permission'); await shot(f, 'devis-no-category-no-permission');
    }]], { role: 'logisticien', permissions: { perm_colis_calculer_devis: true } });
  } finally {
    await browser.close();
    await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
