/* Dossiers d’expédition: grouping by departure (A), the dossier row (B) and
 * « À vérifier » (C). Synthetic data on a fixed Paris clock; setup() mocks every
 * request, so nothing reaches Supabase, Telegram or PayPlug.
 *
 * Fixture (extend it rather than adding another one):
 * - the browser clock is Tuesday 6 October 2026, 10:00 in Paris;
 * - departures: 8 Oct Martinique, 15 Oct Guadeloupe and Réunion, 22 and 29 Oct
 *   Réunion (upcoming), 1 Oct and 17 Sept Réunion (past), one Mayotte departure
 *   without a date; 29 Oct has no dossier yet;
 * - clients: complete (portal + Telegram), no contact, incomplete billing
 *   (no email, no address), subscription ending 18 Oct, Martinique, professional;
 * - dossiers EXP-DEP001…011, listed in fixture() with their client and departure.
 * EXPECTED_GROUPS, STAGE_TITLES and EXPECTED_ALERTS describe this fixture:
 * update them with it. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const XLSX = require('xlsx');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_DOSSIER_DEPARTURES_OUT || '/tmp/pinta-dossier-departures';
const results = [];

const NOW = new Date('2026-10-06T08:00:00Z');
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pad = n => String(n).padStart(3, '0');
const CLIENT = {
  complete: uuid('c1000000', 1),
  noContact: uuid('c1000000', 2),
  incomplete: uuid('c1000000', 3),
  subscription: uuid('c1000000', 4),
  martinique: uuid('c1000000', 5),
  pro: uuid('c1000000', 6),
};
const DEPARTURE = {
  martinique8: uuid('d1000000', 1),
  guadeloupe15: uuid('d1000000', 2),
  reunion15: uuid('d1000000', 3),
  reunion22: uuid('d1000000', 4),
  reunion29: uuid('d1000000', 5),
  reunion1: uuid('d1000000', 6),
  reunion17sept: uuid('d1000000', 7),
  mayotteUndated: uuid('d1000000', 8),
};
// DOSSIER.DEP001 is the id of EXP-DEP001, and so on.
const DOSSIER = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`DEP${pad(index + 1)}`, uuid('e1000000', index + 1)]));
const REF = Object.fromEntries(Object.keys(DOSSIER).map(key => [DOSSIER[key], `EXP-${key}`]));

// The groups of the « Départs » tab, « Sans départ affecté » at the bottom.
const EXPECTED_GROUPS = [
  { key: DEPARTURE.martinique8, title: 'Départ du jeudi 8 octobre · Martinique', ref: 'ENV-2026-043', count: '1 dossier', dossiers: [DOSSIER.DEP004] },
  { key: DEPARTURE.guadeloupe15, title: 'Départ du jeudi 15 octobre · Guadeloupe', ref: 'ENV-2026-042', count: '1 dossier', dossiers: [DOSSIER.DEP003] },
  { key: DEPARTURE.reunion15, title: 'Départ du jeudi 15 octobre · Réunion', ref: 'ENV-2026-041', count: '3 dossiers', dossiers: [DOSSIER.DEP001, DOSSIER.DEP002, DOSSIER.DEP011] },
  { key: DEPARTURE.reunion22, title: 'Départ du jeudi 22 octobre · Réunion', ref: 'ENV-2026-044', count: '1 dossier', dossiers: [DOSSIER.DEP005] },
  { key: DEPARTURE.reunion1, title: 'Départ du jeudi 1er octobre · Réunion', ref: 'ENV-2026-039', count: '1 dossier', dossiers: [DOSSIER.DEP006] },
  { key: DEPARTURE.reunion17sept, title: 'Départ du jeudi 17 septembre · Réunion', ref: 'ENV-2026-035', count: '1 dossier', dossiers: [DOSSIER.DEP007] },
  { key: DEPARTURE.mayotteUndated, title: 'Date à préciser · Mayotte', ref: 'ENV-2026-045', count: '1 dossier', dossiers: [DOSSIER.DEP008] },
  { key: 'none', title: 'Sans départ affecté', ref: null, count: '2 dossiers', dossiers: [DOSSIER.DEP009, DOSSIER.DEP010] },
];
const STAGE_TITLES = ['Réception', 'Optimisation et factures', 'Devis / Paiement', 'Payé', 'En expédition', 'Livrés'];

async function fixture(browser, { role = 'directeur', width = 1440, height = width < 768 ? 844 : 1000, theme = 'light', permissions = null } = {}) {
  const f = await setup(browser, role);
  // A role other than the direction gets exactly these permissions.
  if (permissions) { const row = { staff_id: ids.S, ...permissions }; f.tables.staff_permissions = [row]; f.tables.staff_users[0].staff_permissions = [row]; }
  f.page.setDefaultTimeout(10000);
  await f.page.setViewportSize({ width, height });
  await f.page.clock.setFixedTime(NOW);
  await f.context.addInitScript(value => localStorage.setItem('expedile-theme', value), theme);
  await f.context.addInitScript(installGroupReader);
  const client = (id, fields) => ({ id, user_id: null, telegram_chat_id: null, type: 'particulier', abonnement: 'freemium', abonnement_debut: null, abonnement_fin: null, onboarded: true, created_at: '2026-09-01T08:00:00Z', ...fields });
  f.tables.clients = [
    client(CLIENT.complete, { ref: 'CLI-DEP-01', nom: 'Hoarau', prenom: 'Flavie', email: 'flavie@example.test', cp: '97400', ville: 'Saint-Denis', adresse_ligne1: '12 rue de Paris', user_id: uuid('a1000000', 1), telegram_chat_id: 7001 }),
    client(CLIENT.noContact, { ref: 'CLI-DEP-02', nom: 'Payet', prenom: 'Jean', email: 'jean@example.test', cp: '97410', ville: 'Saint-Pierre', adresse_ligne1: '3 rue des Bons Enfants' }),
    client(CLIENT.incomplete, { ref: 'CLI-DEP-03', nom: 'Jacoby', prenom: 'Nadia', email: null, cp: '97110', ville: 'Pointe-à-Pitre', adresse_ligne1: null, telegram_chat_id: 7003 }),
    client(CLIENT.subscription, { ref: 'CLI-DEP-04', nom: 'Grondin', prenom: 'Lucas', email: 'lucas@example.test', cp: '97430', ville: 'Le Tampon', adresse_ligne1: '8 chemin des Fleurs', user_id: uuid('a1000000', 4), telegram_chat_id: 7004, abonnement: 'premium', abonnement_debut: '2025-10-18', abonnement_fin: '2026-10-18' }),
    client(CLIENT.martinique, { ref: 'CLI-DEP-05', nom: 'Rosier', prenom: 'Paul', email: 'paul@example.test', cp: '97200', ville: 'Fort-de-France', adresse_ligne1: '5 rue Victor Hugo', telegram_chat_id: 7005 }),
    client(CLIENT.pro, { ref: 'CLI-DEP-06', nom: 'Lagon Services', prenom: '', type: 'pro', raison_sociale: 'Lagon Services', email: null, cp: '97600', ville: 'Mamoudzou', adresse_ligne1: '1 place du Marché', telegram_chat_id: 7006 }),
  ];
  const departure = (id, ref, date, code, fields = {}) => ({ id, ref, date_depart: date, destination_code: code, statut: 'planifie', mode_transport: 'aerien', loading_closes_at: null, departed_at: null, manifest_version: 0, updated_at: '2026-10-01T08:00:00Z', ...fields });
  f.tables.envois = [
    departure(DEPARTURE.reunion15, 'ENV-2026-041', '2026-10-15', '974'),
    departure(DEPARTURE.guadeloupe15, 'ENV-2026-042', '2026-10-15', '971'),
    departure(DEPARTURE.martinique8, 'ENV-2026-043', '2026-10-08', '972'),
    departure(DEPARTURE.reunion22, 'ENV-2026-044', '2026-10-22', '974'),
    departure(DEPARTURE.reunion29, 'ENV-2026-046', '2026-10-29', '974'),
    departure(DEPARTURE.reunion1, 'ENV-2026-039', '2026-10-01', '974', { statut: 'en_cours', departed_at: '2026-10-01T06:00:00Z', manifest_version: 1 }),
    departure(DEPARTURE.reunion17sept, 'ENV-2026-035', '2026-09-17', '974', { statut: 'en_cours', departed_at: '2026-09-17T06:00:00Z', manifest_version: 1 }),
    departure(DEPARTURE.mayotteUndated, 'ENV-2026-045', null, '976'),
  ];
  const template = structuredClone(f.tables.colis[0]);
  const dossier = (n, clientId, envoiId, fields = {}) => ({ ...structuredClone(template), id: DOSSIER[`DEP${pad(n)}`], ref: `EXP-DEP${pad(n)}`, client_id: clientId, envoi_id: envoiId, casier: `D-${pad(n)}`, desc_contenu: `Achats du dossier ${pad(n)}`,
    reception_dates: [10, 12].map(day => ({ receivedAt: `2026-09-${day + n}T08:00:00Z`, source: 'server' })), ...fields });
  const paid = { statut: 'paye', quote_version: 1, devis_brouillon: false, devis_total: 120, devis_snapshot: { amounts: { total: 120 } }, devis_envoye_le: '2026-10-02T08:00:00Z', paiement_montant: 120, paiement_date: '2026-10-02T10:00:00Z' };
  const received = { feu_vert: 'en_attente', final_packages: [], outgoing_parcel_count: 0, final_measurements_version: null, fin_l: null, fin_w: null, fin_h: null, fin_p: null };
  f.tables.colis = [
    dossier(1, CLIENT.complete, DEPARTURE.reunion15, paid),
    dossier(2, CLIENT.noContact, DEPARTURE.reunion15, { statut: 'autorise' }),
    dossier(3, CLIENT.incomplete, DEPARTURE.guadeloupe15, { statut: 'devis_envoye', quote_version: 1, devis_brouillon: false, devis_total: 95, devis_snapshot: { amounts: { total: 95 } }, devis_envoye_le: '2026-10-05T09:00:00Z' }),
    dossier(4, CLIENT.martinique, DEPARTURE.martinique8, paid),
    dossier(5, CLIENT.subscription, DEPARTURE.reunion22, { statut: 'autorise' }),
    dossier(6, CLIENT.complete, DEPARTURE.reunion1, { ...paid, statut: 'expedie', date_expedition: '2026-10-01T06:00:00Z' }),
    dossier(7, CLIENT.noContact, DEPARTURE.reunion17sept, { ...paid, statut: 'livre', date_expedition: '2026-09-17T06:00:00Z' }),
    dossier(8, CLIENT.pro, DEPARTURE.mayotteUndated, { statut: 'en_preparation' }),
    dossier(9, CLIENT.complete, null, { statut: 'mesure', ...received }),
    dossier(10, CLIENT.incomplete, null, { statut: 'receptionne', ...received, dim_l: null, dim_w: null, dim_h: null, poids: null }),
    dossier(11, CLIENT.subscription, DEPARTURE.reunion15, { statut: 'en_preparation' }),
  ];
  const invoice = structuredClone(f.tables.factures[0]), line = structuredClone(f.tables.lignes[0]);
  f.tables.factures = f.tables.colis.map((parcel, index) => ({ ...invoice, id: `departures-invoice-${index + 1}`, colis_id: parcel.id, fichier_url: `${parcel.id}/facture.pdf` }));
  f.tables.lignes = f.tables.colis.map((parcel, index) => ({ ...line, id: `departures-line-${index + 1}`, colis_id: parcel.id, facture_id: `departures-invoice-${index + 1}` }));
  const work = (n, kind, fields = {}) => ({ id: uuid('f1000000', n), colis_id: DOSSIER[`DEP${pad(n)}`], kind, state: 'ready', assignee_id: null, version: 1, created_at: '2026-10-05T08:00:00Z', updated_at: '2026-10-05T08:00:00Z', ...fields });
  f.tables.staff_work_actions = [
    work(2, 'conversation', { action_hint: 'Accès client à activer' }),
    work(4, 'departure'),
    work(9, 'reception'),
    work(11, 'preparation'),
  ];
  f.tables.staff_work_preferences[0].active_mission = null;
  f.tables.notifications = [];
  f.before = structuredClone(f.tables.colis);
  return f;
}

// Reading the list never writes: only the two read-only RPCs of loading are allowed.
const READ_ONLY_RPCS = ['/refresh_staff_work_actions', '/get_reception_dates'];
// Opening a dossier also asks for customs suggestions, a STABLE (read-only) RPC.
const DOSSIER_READ_ONLY_RPCS = [...READ_ONLY_RPCS, '/suggest_customs_tariffs'];
function assertNoBusinessWrite(f, readOnlyRpcs = READ_ONLY_RPCS) {
  assert.deepEqual(f.tables.colis, f.before);
  assert.deepEqual(f.requests.filter(request => ['POST', 'PATCH', 'DELETE'].includes(request.method) && request.path.startsWith('/rest/v1/') && !readOnlyRpcs.some(rpc => request.path.endsWith(rpc))), []);
  assert.equal(f.requests.some(request => /\/(queue_message|send-email|send-telegram|payplug-create)/.test(request.path)), false);
}
const rows = f => f.page.locator('[data-dossier-row]:visible, [data-dossier-card]:visible');
async function openList(f, query = '') {
  await f.page.goto(`${base}/colis${query ? `?${query}` : ''}`);
  await rows(f).first().waitFor();
}
const displayDialog = f => f.page.getByRole('dialog', { name: 'Affichage', exact: true });
async function openDisplay(f) {
  const dialog = displayDialog(f);
  if (!await dialog.isVisible().catch(() => false)) await f.page.getByRole('button', { name: 'Affichage', exact: true }).click();
  await dialog.waitFor();
  return dialog;
}
async function closeDisplay(f) {
  const dialog = displayDialog(f);
  if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Fermer l’affichage', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); }
}
async function setTextSize(f, value) {
  const size = (await openDisplay(f)).getByRole('spinbutton', { name: 'Taille du texte des dossiers', exact: true });
  await size.fill(String(value));await size.press('Enter');await closeDisplay(f);
}
async function selectTab(f, label, value) {
  await closeDisplay(f);
  await f.page.locator('[aria-label="Vues du tableau"]').getByRole('button', { name: label, exact: true }).click();
  await f.page.waitForURL(url => (url.searchParams.get('table') || 'daily') === value);
}
/** Installed in the page: group headings and their dossiers, in screen order,
 * from the visible layout (table rows or cards). */
function installGroupReader() {
  window.__pintaGroups = () => {
    const shown = node => node.getClientRects().length > 0;
    const heading = node => ({ key: node.dataset.dossierGroup, title: node.querySelector('.dossier-group-title')?.textContent.trim(), ref: node.querySelector('.dossier-group-ref')?.textContent.trim() || null, count: node.querySelector('.dossier-group-count')?.textContent.trim(), dossiers: [] });
    const table = document.querySelector('table.dossier-data-table');
    if (table && shown(table)) {
      const groups = [];
      for (const row of table.tBodies[0].rows) {
        if (row.dataset.dossierGroup) groups.push(heading(row));
        else if (row.dataset.dossierRow) groups.at(-1)?.dossiers.push(row.dataset.dossierRow);
      }
      return { layout: 'table', groups };
    }
    return { layout: 'cards', groups: [...document.querySelectorAll('.dossier-card-list > [data-dossier-group]')].filter(shown).map(node => ({ ...heading(node), dossiers: [...node.querySelectorAll('[data-dossier-card]')].map(card => card.dataset.dossierCard) })) };
  };
}
const visibleGroups = f => f.page.evaluate(() => window.__pintaGroups());
const groupShape = (groups, ordered) => groups.map(({ key, title, ref, count, dossiers }) => ({ key, title, ref, count, dossiers: ordered ? dossiers : [...dossiers].sort() }));
/** Waits for React to commit the expected groups (the URL changes first), then
 * compares them, so a failure shows the difference. */
async function assertGroups(f, expected, { ordered = false } = {}) {
  const want = groupShape(expected, ordered);
  await f.page.waitForFunction(([want, ordered]) => JSON.stringify(window.__pintaGroups().groups.map(({ key, title, ref, count, dossiers }) => ({ key, title, ref, count, dossiers: ordered ? dossiers : [...dossiers].sort() }))) === JSON.stringify(want), [want, ordered]).catch(() => {});
  assert.deepEqual(groupShape((await visibleGroups(f)).groups, ordered), want);
}
async function waitGroupTitles(f, titles) {
  await f.page.waitForFunction(expected => JSON.stringify(window.__pintaGroups().groups.map(group => group.title)) === JSON.stringify(expected), titles).catch(() => {});
  assert.deepEqual((await visibleGroups(f)).groups.map(group => group.title), titles);
}
const noGroups = f => waitGroupTitles(f, []);
const groupToggle = (f, title) => f.page.getByRole('button', { name: title, exact: true }).filter({ visible: true });
const groupCheckbox = (f, name) => f.page.getByRole('checkbox', { name: `Sélectionner le groupe ${name}`, exact: true }).filter({ visible: true });
const stored = (f, kind, view) => f.page.evaluate(([kind, user, view]) => localStorage.getItem(`expedile:${kind}:v1:${encodeURIComponent(user)}:${view}`), [kind, ids.A, view]);
const description = locator => locator.evaluate(node => (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent.trim()).join(' '));
const noPageOverflow = async f => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
async function axe(f) {
  const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
}
/** Font size and text contrast of each part of the visible group headings. */
function headingStyles(f) {
  return f.page.locator('[data-dossier-group]:visible').evaluateAll(nodes => {
    const rgba = value => { const n = value.match(/[\d.]+/g)?.map(Number) || []; return n.length >= 3 ? [...n.slice(0, 3), n[3] ?? 1] : [0, 0, 0, 0]; };
    const over = (fg, bg) => [...fg.slice(0, 3).map((channel, i) => channel * fg[3] + bg[i] * (1 - fg[3])), 1];
    const background = element => { const chain = []; for (let n = element; n && n.nodeType === 1; n = n.parentElement) chain.push(rgba(getComputedStyle(n).backgroundColor)); return chain.reverse().reduce((bg, color) => over(color, bg), [255, 255, 255, 1]); };
    const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    return nodes.flatMap(node => ['.dossier-group-title', '.dossier-group-ref', '.dossier-group-count'].map(selector => node.querySelector(selector)).filter(Boolean).map(part => {
      const style = getComputedStyle(part), bg = background(part);
      return { text: part.textContent.trim(), size: parseFloat(style.fontSize), ratio: contrast(over(rgba(style.color), bg), bg) };
    }));
  });
}

// B. The row, its reference and the action button.
const dossierItem = (f, id) => f.page.locator(`[data-dossier-row="${id}"]:visible, [data-dossier-card="${id}"]:visible`).first();
const backToList = f => f.page.getByRole('button', { name: 'Retour à la liste de travail', exact: true });
// EXP-DEP002's only task is « Accès client à activer », worked on the client page.
const accessTask = f => f.tables.staff_work_actions.find(action => action.colis_id === DOSSIER.DEP002);
/** The dossier itself is open: no task in its URL, only the way back to the
 * list, and the dossier shows its own Colis tab. */
async function assertDossierOpened(f, id, returnTo) {
  await f.page.waitForURL(url => url.pathname === `/colis/${id}`);
  assert.deepEqual(Object.fromEntries(new URL(f.page.url()).searchParams), { returnTo });
  await f.page.getByTestId('dossier-task-header').getByText(REF[id], { exact: true }).waitFor();
  assert.equal(await f.page.getByRole('tab', { name: 'Colis', exact: true }).getAttribute('aria-selected'), 'true');
}
async function returnToList(f, returnTo) {
  await backToList(f).click();
  await f.page.waitForURL(url => url.pathname + url.search === returnTo);
  await rows(f).first().waitFor();
}

// C. « À vérifier » on the dossier page and in the list.
const NO_CONTACT = 'Le client n’a ni espace client ni Telegram : il ne reçoit pas nos messages.';
const missingBilling = fields => `Fiche client incomplète pour le paiement en ligne : il manque ${fields}.`;
const AFTER_SUBSCRIPTION = 'Le départ du jeudi 22 octobre est après la fin de son abonnement (18 octobre). Contactez le client.';
// The lines of each dossier to check in this fixture; the other dossiers have none.
const EXPECTED_ALERTS = {
  [DOSSIER.DEP002]: [NO_CONTACT],
  [DOSSIER.DEP003]: [missingBilling('l’email et l’adresse')],
  [DOSSIER.DEP005]: [AFTER_SUBSCRIPTION],
  [DOSSIER.DEP010]: [missingBilling('l’email et l’adresse')],
};
// Lucas (subscription until 18 October) without client space, Telegram or email:
// EXP-DEP005 then shows the three cases, in this order.
const THREE_CASES = [[NO_CONTACT, 'Inviter le client'], [missingBilling('l’email'), 'Compléter la fiche'], [AFTER_SUBSCRIPTION, 'Écrire au client']];
const withThreeCases = f => Object.assign(f.tables.clients.find(client => client.id === CLIENT.subscription), { user_id: null, telegram_chat_id: null, email: null });
const alertBand = f => f.page.getByRole('region', { name: 'À vérifier', exact: true });
const conversationTab = f => f.page.getByRole('tab', { name: /^Conversation/ });
const replyField = f => f.page.getByLabel('Votre réponse au client', { exact: true });
const waitTheme = (f, theme) => f.page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
/** Opens a dossier as the list does, once it has pinned its step in the URL. */
async function openDossier(f, id) {
  await f.page.goto(`${base}/colis/${id}?returnTo=%2Fcolis`);
  await f.page.getByTestId('dossier-task-header').getByText(REF[id], { exact: true }).waitFor();
  await f.page.waitForURL(url => url.searchParams.has('section'));
}
/** The band's lines in order: the sentence and its link, if any. */
const bandLines = f => alertBand(f).locator('li').evaluateAll(items => items.map(item => {
  const link = item.querySelector('a');
  return { text: item.querySelector('p').textContent.trim(), link: link && { label: link.textContent.trim(), href: link.getAttribute('href') } };
}));
/** Font size and contrast of each element, against the colours painted under it. */
function textStyles(locator) {
  return locator.evaluateAll(nodes => {
    const rgba = value => { const n = value.match(/[\d.]+/g)?.map(Number) || []; return n.length >= 3 ? [...n.slice(0, 3), n[3] ?? 1] : [0, 0, 0, 0]; };
    const over = (fg, bg) => [...fg.slice(0, 3).map((channel, i) => channel * fg[3] + bg[i] * (1 - fg[3])), 1];
    const background = element => { const chain = []; for (let n = element; n && n.nodeType === 1; n = n.parentElement) chain.push(rgba(getComputedStyle(n).backgroundColor)); return chain.reverse().reduce((bg, color) => over(color, bg), [255, 255, 255, 1]); };
    const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    return nodes.map(node => { const style = getComputedStyle(node), bg = background(node); return { text: node.textContent.trim() || node.getAttribute('aria-label'), size: parseFloat(style.fontSize), ratio: contrast(over(rgba(style.color), bg), bg) }; });
  });
}
/** The « À vérifier » mark of every visible dossier (table row or card), by id. */
const listMarks = f => f.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-dossier-row]')].filter(node => node.getClientRects().length > 0).map(node => {
  const mark = node.querySelector('[data-column="ref"] .dossier-table-alert');
  return [node.dataset.dossierRow, mark && { role: mark.getAttribute('role'), name: mark.getAttribute('aria-label'), title: mark.getAttribute('title'), focusable: mark.tabIndex >= 0 || mark.querySelector('[tabindex]') !== null }];
})));

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, options = {}) {
    if (process.env.PINTA_DOSSIER_DEPARTURES_FILTER && !name.includes(process.env.PINTA_DOSSIER_DEPARTURES_FILTER)) return;
    const f = await fixture(browser, options);
    try {
      await f.login(); await run(f);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
      await f.page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {});
      await fs.writeFile(`${output}/${name}-failure.txt`, await f.page.locator('body').innerText().catch(() => ''));
    } finally { await f.context.close(); console.log(JSON.stringify(results.at(-1))); }
  }
  try {
    // ── A. Grouping by departure ─────────────────────────────────────────────
    await scenario('departures-tab-groups-by-departure-with-the-next-departure-first', async f => {
      await openList(f);await noGroups(f);
      assert.equal(new URL(f.page.url()).searchParams.has('view'), false, 'Travail quotidien is not grouped by default.');
      await selectTab(f, 'Départs', 'departures');
      assert.equal(new URL(f.page.url()).searchParams.has('view'), false, 'The default grouping does not need a URL parameter.');
      await assertGroups(f, EXPECTED_GROUPS);
      // The heading names the departure, its reference and how many dossiers it holds.
      const reunion = f.page.locator(`[data-dossier-group="${DEPARTURE.reunion15}"]:visible`);
      assert.match((await reunion.innerText()).replace(/\s+/g, ' ').trim(), /^Départ du jeudi 15 octobre · Réunion ENV-2026-041 3 dossiers$/);
      const toggle = groupToggle(f, 'Départ du jeudi 15 octobre · Réunion');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await description(toggle), 'ENV-2026-041 3 dossiers');
      assert.equal(await description(groupToggle(f, 'Sans départ affecté')), '2 dossiers');
      await groupCheckbox(f, 'Départ du jeudi 15 octobre · Réunion · ENV-2026-041').waitFor();
      await groupCheckbox(f, 'Sans départ affecté').waitFor();
      for (const target of [toggle, groupCheckbox(f, 'Sans départ affecté').locator('..')]) { const box = await target.boundingBox(); assert.ok(box.height >= 44, 'Group heading controls keep a 44px target.'); }
      // Affichage shows the tab's grouping and its « Dossiers sans départ » choice.
      const display = await openDisplay(f);
      assert.equal(await display.getByRole('combobox', { name: 'Regrouper les dossiers', exact: true }).inputValue(), 'envoi');
      const placement = display.getByRole('combobox', { name: 'Dossiers sans départ', exact: true });
      assert.equal(await placement.inputValue(), 'bottom');
      assert.deepEqual(await placement.locator('option').evaluateAll(options => options.map(option => [option.value, option.textContent])), [['bottom', 'En bas'], ['top', 'En haut']]);
      await closeDisplay(f);
      await f.page.screenshot({ path: `${output}/departures-grouped-1440-light.png`, fullPage: true });
      assertNoBusinessWrite(f);
    });

    await scenario('dossiers-without-departure-at-the-top-is-a-personal-choice-kept-after-reload', async f => {
      await openList(f, 'table=departures');await assertGroups(f, EXPECTED_GROUPS);
      let display = await openDisplay(f);
      await display.getByRole('combobox', { name: 'Dossiers sans départ', exact: true }).selectOption('top');
      const top = [EXPECTED_GROUPS.at(-1), ...EXPECTED_GROUPS.slice(0, -1)];
      await assertGroups(f, top);
      assert.equal(await display.isVisible(), true, 'Changing the placement keeps Affichage open.');
      assert.equal(await stored(f, 'table-no-departure', 'departures'), '"top"');
      assert.equal(new URL(f.page.url()).searchParams.has('view'), false, 'The placement is a personal preference, not a URL parameter.');
      await f.page.reload();await rows(f).first().waitFor();await assertGroups(f, top);
      display = await openDisplay(f);
      assert.equal(await display.getByRole('combobox', { name: 'Dossiers sans départ', exact: true }).inputValue(), 'top');
      // The choice only exists while grouping by departure.
      const grouping = display.getByRole('combobox', { name: 'Regrouper les dossiers', exact: true });
      await grouping.selectOption('statut');await f.page.waitForURL(url => url.searchParams.get('view') === 'statut');
      await waitGroupTitles(f, STAGE_TITLES);
      assert.equal(await display.getByRole('combobox', { name: 'Dossiers sans départ', exact: true }).count(), 0);
      await grouping.selectOption('envoi');await f.page.waitForURL(url => url.searchParams.get('view') === 'envoi');
      await assertGroups(f, top);
      assert.equal(await display.getByRole('combobox', { name: 'Dossiers sans départ', exact: true }).inputValue(), 'top');
      // Another tab keeps its own placement.
      await selectTab(f, 'Travail quotidien', 'daily');await noGroups(f);
      display = await openDisplay(f);
      await display.getByRole('combobox', { name: 'Regrouper les dossiers', exact: true }).selectOption('envoi');
      await assertGroups(f, EXPECTED_GROUPS);
      assert.equal(await display.getByRole('combobox', { name: 'Dossiers sans départ', exact: true }).inputValue(), 'bottom');
      assertNoBusinessWrite(f);
    });

    await scenario('grouping-is-remembered-per-tab-after-leaving-and-returning-through-the-menu', async f => {
      await openList(f);await noGroups(f);
      const display = await openDisplay(f);
      await display.getByRole('combobox', { name: 'Regrouper les dossiers', exact: true }).selectOption('envoi');
      await f.page.waitForURL(url => url.searchParams.get('view') === 'envoi');
      await assertGroups(f, EXPECTED_GROUPS);
      assert.equal(await stored(f, 'table-group', 'daily'), '"envoi"');
      await closeDisplay(f);
      // Leave through the menu, then come back through the menu: the URL has no view.
      await f.page.getByRole('button', { name: 'Mon travail', exact: true }).filter({ visible: true }).click();
      await f.page.waitForURL(url => url.pathname === '/');
      await f.page.getByRole('button', { name: 'Dossiers d’expédition', exact: true }).filter({ visible: true }).click();
      await f.page.waitForURL(url => url.pathname === '/colis' && !url.search);
      await assertGroups(f, EXPECTED_GROUPS);
      // Each tab has its own choice; coming back restores the remembered one.
      await selectTab(f, 'Paiements', 'payments');await noGroups(f);
      assert.equal(new URL(f.page.url()).searchParams.has('view'), false);
      await selectTab(f, 'Départs', 'departures');await assertGroups(f, EXPECTED_GROUPS);
      await selectTab(f, 'Travail quotidien', 'daily');await assertGroups(f, EXPECTED_GROUPS);
      // A shared link with an explicit grouping wins, without changing the remembered choice.
      await openList(f, 'view=none');await noGroups(f);
      await openList(f, 'view=statut');await waitGroupTitles(f, STAGE_TITLES);
      assert.equal(await stored(f, 'table-group', 'daily'), '"envoi"');
      await openList(f);await assertGroups(f, EXPECTED_GROUPS);
      assertNoBusinessWrite(f);
    });

    await scenario('a-column-sort-applies-inside-each-group-and-the-export-follows-the-screen', async f => {
      await openList(f, 'table=departures');await assertGroups(f, EXPECTED_GROUPS);
      const sortButton = f.page.locator('th[data-column="ref"] .dossier-table-sort');
      await sortButton.click();await f.page.waitForURL(url => url.searchParams.get('sort') === 'ref' && url.searchParams.get('dir') === 'asc');
      await assertGroups(f, EXPECTED_GROUPS, { ordered: true });
      await sortButton.click();await f.page.waitForURL(url => url.searchParams.get('dir') === 'desc');
      const descending = EXPECTED_GROUPS.map(group => ({ ...group, dossiers: [...group.dossiers].reverse() }));
      await assertGroups(f, descending, { ordered: true });
      assert.equal((await f.page.locator('.dossier-meta-sort').innerText()).trim(), 'Tri : Référence · de Z à A · dans chaque groupe');
      const display = await openDisplay(f);const pending = f.page.waitForEvent('download');
      await display.getByRole('button', { name: 'Exporter 11 dossiers filtrés', exact: true }).click();
      const file = await pending;assert.equal(await file.failure(), null);await closeDisplay(f);
      const sheet = XLSX.read(await fs.readFile(await file.path()), { type: 'buffer' });
      const data = XLSX.utils.sheet_to_json(sheet.Sheets[sheet.SheetNames[0]], { header: 1 });
      assert.deepEqual(data.slice(1).map(line => line[0]), descending.flatMap(group => group.dossiers.map(id => REF[id])), 'The export lists the dossiers group by group, as on screen.');
      assertNoBusinessWrite(f);
    });

    for (const theme of ['light', 'dark']) await scenario(`table-groups-fold-select-and-keep-their-heading-in-view-1440-${theme}`, async f => {
      await openList(f, 'table=departures');await f.page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
      await assertGroups(f, EXPECTED_GROUPS);
      assert.equal((await visibleGroups(f)).layout, 'table');
      const title = 'Départ du jeudi 15 octobre · Réunion';
      const toggle = groupToggle(f, title);
      await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await assertGroups(f, EXPECTED_GROUPS.map(group => group.key === DEPARTURE.reunion15 ? { ...group, dossiers: [] } : group));
      await groupCheckbox(f, `${title} · ENV-2026-041`).check();
      const bar = f.page.getByRole('group', { name: 'Actions sur la sélection', exact: true });
      await bar.getByText('3 dossiers sélectionnés', { exact: true }).waitFor();
      await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      for (const id of EXPECTED_GROUPS[2].dossiers) assert.equal(await f.page.locator(`tr[data-dossier-row="${id}"]`).getAttribute('data-selected'), 'true');
      await groupCheckbox(f, `${title} · ENV-2026-041`).uncheck();await bar.waitFor({ state: 'hidden' });
      // The heading stays at the left edge while the columns scroll.
      const region = f.page.getByRole('region', { name: 'Tableau des dossiers', exact: true });
      const scrolled = await region.evaluate(node => { node.scrollLeft = 600; return node.scrollLeft; });
      assert.ok(scrolled > 100, 'The departure table really scrolls horizontally.');
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const area = await region.boundingBox(), heading = await toggle.boundingBox();
      assert.ok(heading.x >= area.x && heading.x + heading.width <= area.x + area.width, 'The group title stays in view.');
      await region.evaluate(node => { node.scrollLeft = 0; });
      // Readable at every text size: never under 12px, contrast kept.
      for (const part of await headingStyles(f)) { assert.ok(part.size >= 12, `${part.text}: ${part.size}px`); assert.ok(part.ratio >= 4.5, `${part.text}: ${part.ratio.toFixed(2)}:1`); }
      await setTextSize(f, 5);
      for (const part of await headingStyles(f)) assert.ok(part.size >= 12, `At the smallest text size, ${part.text} stays at ${part.size}px.`);
      await setTextSize(f, 20);
      for (const part of await headingStyles(f)) assert.ok(part.size >= 20, `At the largest text size, ${part.text} grows with the rows (${part.size}px).`);
      await setTextSize(f, 12);
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/table-groups-1440-${theme}.png`, fullPage: true });
      assertNoBusinessWrite(f);
    }, { theme });

    for (const theme of ['light', 'dark']) await scenario(`cards-show-the-same-collapsible-selectable-groups-390-${theme}`, async f => {
      await openList(f, 'table=departures');await f.page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
      await assertGroups(f, EXPECTED_GROUPS);
      assert.equal((await visibleGroups(f)).layout, 'cards');
      await f.page.screenshot({ path: `${output}/cards-groups-390-${theme}.png`, fullPage: true });
      const title = 'Départ du jeudi 15 octobre · Réunion';
      const toggle = groupToggle(f, title), checkbox = groupCheckbox(f, `${title} · ENV-2026-041`);
      for (const target of [toggle, checkbox.locator('..')]) { const box = await target.boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 391, 'Group controls fit the phone with 44px targets.'); }
      const group = f.page.locator(`.dossier-card-list > [data-dossier-group="${DEPARTURE.reunion15}"]`);
      assert.equal(await group.getAttribute('role'), 'group');
      assert.equal(await f.page.getByRole('group', { name: title, exact: true }).count(), 1, 'The cards of a departure are named by their heading.');
      await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await assertGroups(f, EXPECTED_GROUPS.map(item => item.key === DEPARTURE.reunion15 ? { ...item, dossiers: [] } : item));
      await checkbox.check();
      await f.page.getByRole('group', { name: 'Actions sur la sélection', exact: true }).getByText('3 dossiers sélectionnés', { exact: true }).waitFor();
      await toggle.click();await assertGroups(f, EXPECTED_GROUPS);
      for (const id of EXPECTED_GROUPS[2].dossiers) assert.equal(await f.page.locator(`[data-dossier-card="${id}"]`).getAttribute('data-selected'), 'true');
      // The folding is the same in the table: it is one remembered choice.
      await toggle.click();await f.page.setViewportSize({ width: 1440, height: 1000 });
      await f.page.locator('table.dossier-data-table').waitFor();
      assert.equal(await groupToggle(f, title).getAttribute('aria-expanded'), 'false');
      assert.equal(await f.page.locator(`tr[data-dossier-row="${DOSSIER.DEP001}"]`).count(), 0);
      await groupToggle(f, title).click();await f.page.setViewportSize({ width: 390, height: 844 });
      await assertGroups(f, EXPECTED_GROUPS);
      for (const part of await headingStyles(f)) { assert.ok(part.size >= 12, `${part.text}: ${part.size}px`); assert.ok(part.ratio >= 4.5, `${part.text}: ${part.ratio.toFixed(2)}:1`); }
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/cards-groups-selected-390-${theme}.png`, fullPage: true });
      // On the smallest phone, « Dossiers sans départ » stays reachable inside Affichage.
      await f.page.setViewportSize({ width: 320, height: 568 });
      const display = await openDisplay(f), placement = display.getByRole('combobox', { name: 'Dossiers sans départ', exact: true });
      await placement.scrollIntoViewIfNeeded();
      const field = await placement.boundingBox(), frame = await display.boundingBox();
      assert.ok(field.height >= 44 && field.x >= frame.x && field.x + field.width <= frame.x + frame.width + 1 && field.y >= 0 && field.y + field.height <= 568, 'The placement field is reachable inside Affichage.');
      await f.page.screenshot({ path: `${output}/display-placement-320-${theme}.png` });
      await placement.focus();await f.page.keyboard.press('Escape');await display.waitFor({ state: 'hidden' });
      assert.equal(await f.page.getByRole('button', { name: 'Affichage', exact: true }).evaluate(node => node === document.activeElement), true, 'Escape returns focus to Affichage.');
      await noPageOverflow(f);
      assertNoBusinessWrite(f);
    }, { width: 390, theme });

    // ── B. A row click opens the dossier ─────────────────────────────────────
    await scenario('a-row-its-reference-or-the-only-search-result-opens-the-dossier-not-its-task', async f => {
      await openList(f);assert.equal((await visibleGroups(f)).layout, 'table');
      // « Accès client à activer » is worked on the client page; the row and the
      // reference still open the dossier itself.
      const access = dossierItem(f, DOSSIER.DEP002);
      await access.locator('td[data-column="client"]').click();
      await assertDossierOpened(f, DOSSIER.DEP002, '/colis');
      await f.page.screenshot({ path: `${output}/row-opens-dossier-1440-light.png`, fullPage: true });
      await returnToList(f, '/colis');
      await access.getByRole('button', { name: 'EXP-DEP002', exact: true }).click();
      await assertDossierOpened(f, DOSSIER.DEP002, '/colis');
      await returnToList(f, '/colis');
      // Taking that task is unchanged: « Je m’en occupe » stays its only button.
      const take = access.locator('td[data-column="action"]');
      await take.getByRole('button', { name: 'Je m’en occupe', exact: true }).waitFor();
      assert.deepEqual(await take.getByRole('button').allTextContents(), ['Je m’en occupe']);
      // Any other task too: the dossier opens on the step it resolves itself.
      await dossierItem(f, DOSSIER.DEP011).locator('td[data-column="casier"]').click();
      await assertDossierOpened(f, DOSSIER.DEP011, '/colis');
      await returnToList(f, '/colis');
      // Grouped by departure in « Départs »: the way back keeps the tab and its groups.
      await selectTab(f, 'Départs', 'departures');await assertGroups(f, EXPECTED_GROUPS);
      await dossierItem(f, DOSSIER.DEP002).locator('td[data-column="client"]').click();
      await assertDossierOpened(f, DOSSIER.DEP002, '/colis?table=departures');
      await returnToList(f, '/colis?table=departures');await assertGroups(f, EXPECTED_GROUPS);
      // Enter on the only search result opens that dossier as well.
      const search = f.page.getByLabel('Rechercher ou scanner un colis', { exact: true });
      await search.fill('D-002');await f.page.waitForURL(url => url.searchParams.get('q') === 'D-002');
      await f.page.locator('.dossier-meta-count').filter({ hasText: /^1 dossier$/ }).waitFor();
      await search.press('Enter');
      await assertDossierOpened(f, DOSSIER.DEP002, '/colis?table=departures&q=D-002');
      assertNoBusinessWrite(f, DOSSIER_READ_ONLY_RPCS);
    });

    await scenario('the-reference-of-a-card-opens-the-dossier-390', async f => {
      await openList(f);assert.equal((await visibleGroups(f)).layout, 'cards');
      await dossierItem(f, DOSSIER.DEP002).getByRole('button', { name: 'EXP-DEP002', exact: true }).click();
      await assertDossierOpened(f, DOSSIER.DEP002, '/colis');
      await noPageOverflow(f);
      await f.page.screenshot({ path: `${output}/card-reference-opens-dossier-390-light.png`, fullPage: true });
      await returnToList(f, '/colis');
      await selectTab(f, 'Départs', 'departures');await assertGroups(f, EXPECTED_GROUPS);
      await dossierItem(f, DOSSIER.DEP011).getByRole('button', { name: 'EXP-DEP011', exact: true }).click();
      await assertDossierOpened(f, DOSSIER.DEP011, '/colis?table=departures');
      assertNoBusinessWrite(f, DOSSIER_READ_ONLY_RPCS);
    }, { width: 390 });

    // The action button still opens the task; for « Accès client à activer » it
    // says that it leads to the client page.
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`the-client-access-task-button-reads-ouvrir-la-fiche-client-and-opens-it-${width}-${theme}`, async f => {
      Object.assign(accessTask(f), { state: 'in_progress', assignee_id: ids.A });
      await openList(f);await f.page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
      assert.equal((await visibleGroups(f)).layout, width < 768 ? 'cards' : 'table');
      const item = dossierItem(f, DOSSIER.DEP002), action = item.locator('[data-column="action"]');
      const open = action.getByRole('button', { name: 'Ouvrir la fiche client', exact: true });
      await open.waitFor();
      assert.deepEqual(await action.getByRole('button').allTextContents(), ['Ouvrir la fiche client'], 'The task worked on the client page names it, instead of « Continuer ».');
      assert.match(await open.getAttribute('class'), /dossier-table-open-primary/, 'Own work in progress keeps the filled button.');
      await open.scrollIntoViewIfNeeded();
      const box = await open.boundingBox();
      assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, 'A 44px target inside the screen.');
      assert.equal(await open.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'The label is never clipped.');
      await noPageOverflow(f);await axe(f);
      await item.screenshot({ path: `${output}/client-access-action-${width}-${theme}.png` });
      // At the largest text size the label wraps between words, never clipped.
      await setTextSize(f, 20);await open.scrollIntoViewIfNeeded();
      assert.equal(await open.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().height >= 44), true, 'The label still fits at 20px.');
      await noPageOverflow(f);
      await item.screenshot({ path: `${output}/client-access-action-${width}-${theme}-20px.png` });
      await setTextSize(f, 12);await open.scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: `${output}/client-access-list-${width}-${theme}.png`, fullPage: true });
      await open.click();
      await f.page.waitForURL(url => url.pathname === `/clients/${CLIENT.noContact}`);
      assert.deepEqual(Object.fromEntries(new URL(f.page.url()).searchParams), { returnTo: '/colis', action: accessTask(f).id });
      await f.page.getByRole('region', { name: 'Contact disponible', exact: true }).getByText(/Accès au portail à activer/).waitFor();
      assertNoBusinessWrite(f, DOSSIER_READ_ONLY_RPCS);
    }, { width, theme });

    await scenario('a-colleague-s-client-access-task-also-names-the-client-page', async f => {
      Object.assign(accessTask(f), { state: 'in_progress', assignee_id: uuid('a1000000', 9) });
      await openList(f);
      const action = dossierItem(f, DOSSIER.DEP002).locator('[data-column="action"]');
      const open = action.getByRole('button', { name: 'Ouvrir la fiche client', exact: true });
      await open.waitFor();
      assert.deepEqual(await action.getByRole('button').allTextContents(), ['Ouvrir la fiche client'], 'Instead of « Consulter ».');
      assert.doesNotMatch(await open.getAttribute('class'), /dossier-table-open-primary/, 'A colleague’s task keeps the quiet button.');
      await open.click();
      await f.page.waitForURL(url => url.pathname === `/clients/${CLIENT.noContact}`);
      assert.equal(new URL(f.page.url()).searchParams.get('action'), accessTask(f).id);
      assert.equal(accessTask(f).assignee_id, uuid('a1000000', 9), 'Opening never takes a colleague’s task.');
      assertNoBusinessWrite(f, DOSSIER_READ_ONLY_RPCS);
    });

    // ── C. « À vérifier » ────────────────────────────────────────────────────
    await scenario('the-a-verifier-band-shows-each-case-with-the-link-that-handles-it', async f => {
      // A complete record, a departure inside the subscription, a delivered or a professional dossier: no band.
      for (const id of [DOSSIER.DEP001, DOSSIER.DEP011, DOSSIER.DEP007, DOSSIER.DEP008]) {
        await openDossier(f, id);
        assert.equal(await alertBand(f).count(), 0, `${REF[id]} has nothing to check.`);
      }
      // The record cases lead to the client page, which can lead back to the dossier as displayed.
      for (const [id, text, label, client] of [[DOSSIER.DEP002, NO_CONTACT, 'Inviter le client', CLIENT.noContact], [DOSSIER.DEP003, missingBilling('l’email et l’adresse'), 'Compléter la fiche', CLIENT.incomplete]]) {
        await openDossier(f, id);
        const displayed = new URL(f.page.url()), from = displayed.pathname + displayed.search;
        assert.deepEqual(await bandLines(f), [{ text, link: { label, href: `/clients/${client}?${new URLSearchParams({ returnTo: from })}` } }]);
        if (id === DOSSIER.DEP002) await f.page.screenshot({ path: `${output}/a-verifier-no-contact-1440-light.png`, fullPage: true });
        await alertBand(f).getByRole('link', { name: label, exact: true }).click();
        await f.page.waitForURL(url => url.pathname === `/clients/${client}`);
        assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), from);
        await f.page.getByRole('region', { name: 'Contact disponible', exact: true }).waitFor();
        if (id === DOSSIER.DEP002) await f.page.getByRole('button', { name: 'Inviter à l’espace client', exact: true }).waitFor();
        // The client page leads back to the dossier as it was displayed.
        await f.page.getByRole('button', { name: 'Retour au dossier', exact: true }).click();
        await f.page.waitForURL(url => url.pathname + url.search === from);
      }
      // A departure after the end of the subscription leads to the Conversation tab, with the same way back.
      await openDossier(f, DOSSIER.DEP005);
      const displayed = new URL(f.page.url()), conversation = new URLSearchParams(displayed.search);
      conversation.set('onglet', 'conversation');
      assert.deepEqual(await bandLines(f), [{ text: AFTER_SUBSCRIPTION, link: { label: 'Écrire au client', href: `${displayed.pathname}?${conversation}` } }]);
      await alertBand(f).getByRole('link', { name: 'Écrire au client', exact: true }).click();
      await f.page.waitForURL(url => url.searchParams.get('onglet') === 'conversation');
      await f.page.locator('#dossier-tab-conversation[aria-selected="true"]').waitFor();
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/colis', 'The way back to the list is kept.');
      // The band stays on the Conversation tab, where its link goes to the reply field.
      assert.deepEqual((await bandLines(f)).map(line => line.text), [AFTER_SUBSCRIPTION]);
      await replyField(f).waitFor();
      const url = f.page.url();
      await alertBand(f).getByRole('link', { name: 'Écrire au client', exact: true }).click();
      await f.page.waitForFunction(() => document.activeElement?.matches('textarea[id^="staff-message-"]'));
      assert.equal(f.page.url(), url);
      assertNoBusinessWrite(f, DOSSIER_READ_ONLY_RPCS);
    });

    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`the-a-verifier-band-lists-three-cases-between-the-header-and-the-tabs-${width}-${theme}`, async f => {
      withThreeCases(f);
      // The list names the three lines on the mark; the reference opens the dossier.
      await openList(f);await waitTheme(f, theme);
      const item = dossierItem(f, DOSSIER.DEP005);
      await item.getByRole('img', { name: `À vérifier : ${THREE_CASES.map(([text]) => text).join(' ')}`, exact: true }).waitFor();
      await item.getByRole('button', { name: 'EXP-DEP005', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === `/colis/${DOSSIER.DEP005}` && url.searchParams.has('section'));
      for (const tab of ['colis', 'conversation']) {
        if (tab === 'conversation') { await conversationTab(f).click();await f.page.waitForURL(url => url.searchParams.get('onglet') === 'conversation');await replyField(f).waitFor(); }
        if (width < 640 && tab === 'colis') {
          // On a phone, the three lines fold behind « À vérifier · 3 points » until opened.
          const fold = alertBand(f).locator('summary');
          await fold.getByText('3 points', { exact: true }).waitFor();
          assert.ok((await alertBand(f).boundingBox()).height <= 72, 'Folded, the band keeps one line above the dossier.');
          assert.equal(await alertBand(f).getByRole('link').first().isVisible(), false);
          await fold.click();
        }
        assert.deepEqual((await bandLines(f)).map(({ text, link }) => [text, link?.label]), THREE_CASES);
        // Between the dossier header and the Colis / Conversation tabs.
        const header = await f.page.getByTestId('dossier-task-header').boundingBox(), area = await alertBand(f).boundingBox(), tabs = await f.page.locator('.dossier-page-tabs').boundingBox();
        assert.ok(Math.abs(area.y - header.y - header.height) <= 1 && Math.abs(tabs.y - area.y - area.height) <= 1, `${tab}: the band sits between the header and the tabs.`);
        assert.ok(Math.abs(area.x - header.x) <= 1 && Math.abs(area.width - header.width) <= 1, 'The band runs across the dossier page, like its header.');
        for (const link of await alertBand(f).getByRole('link').all()) { const box = await link.boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, 'A 44px link inside the screen.'); }
        for (const part of await textStyles(alertBand(f).locator('h2, p, a'))) { assert.ok(part.size >= 12, `${part.text}: ${part.size}px`); assert.ok(part.ratio >= 4.5, `${part.text}: ${part.ratio.toFixed(2)}:1`); }
        await noPageOverflow(f);await axe(f);
        await f.page.screenshot({ path: `${output}/a-verifier-${tab}-${width}-${theme}.png`, fullPage: true });
      }
      // Under the band, the reply stays reachable above the phone navigation.
      await replyField(f).scrollIntoViewIfNeeded();
      const reply = await replyField(f).boundingBox();
      const bottom = width < 1024 ? (await f.page.getByRole('button', { name: 'Dossiers', exact: true }).locator('..').boundingBox()).y : 1000;
      assert.ok(reply.y >= 0 && reply.y + reply.height <= bottom, 'The reply field can be brought into view.');
      if (width < 640) {
        // A single alert never folds: its sentence and link stay in view.
        await openDossier(f, DOSSIER.DEP002);
        await alertBand(f).getByRole('link', { name: 'Inviter le client', exact: true }).waitFor();
        assert.equal(await alertBand(f).locator('summary').count(), 0, 'One alert is shown unfolded on a phone.');
      }
      assertNoBusinessWrite(f, DOSSIER_READ_ONLY_RPCS);
    }, { width, theme });

    // A link leads only where the person may go; the lines stay.
    for (const [name, permissions, links] of [
      ['without-the-client-page-or-the-conversation', { perm_colis_preparer: true }, [undefined, undefined, undefined]],
      ['with-the-client-page-but-not-the-conversation', { perm_colis_preparer: true, perm_clients_voir: true }, ['Voir la fiche client', 'Voir la fiche client', undefined]],
      ['with-client-editing-and-replies', { perm_colis_preparer: true, perm_clients_voir: true, perm_clients_modifier: true, perm_comm_message_libre: true }, ['Inviter le client', 'Compléter la fiche', 'Écrire au client']],
    ]) await scenario(`${name}-the-band-keeps-its-lines-and-only-the-links-the-person-can-follow`, async f => {
      withThreeCases(f);
      await openDossier(f, DOSSIER.DEP005);
      assert.deepEqual((await bandLines(f)).map(({ text, link }) => [text, link?.label]), THREE_CASES.map(([text], index) => [text, links[index]]));
      if (!permissions.perm_comm_message_libre) assert.equal(await conversationTab(f).count(), 0, 'Without message access the dossier has no Conversation tab.');
      await noPageOverflow(f);
      assertNoBusinessWrite(f, DOSSIER_READ_ONLY_RPCS);
    }, { role: 'preparateur', permissions });

    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`the-list-marks-each-dossier-to-check-next-to-its-reference-${width}-${theme}`, async f => {
      await openList(f);await waitTheme(f, theme);
      assert.equal((await visibleGroups(f)).layout, width < 768 ? 'cards' : 'table');
      assert.deepEqual(await listMarks(f), Object.fromEntries(Object.values(DOSSIER).map(id => {
        const name = EXPECTED_ALERTS[id] && `À vérifier : ${EXPECTED_ALERTS[id].join(' ')}`;
        return [id, name ? { role: 'img', name, title: name, focusable: false } : null];
      })));
      // Right after the reference, on its line, readable on every row state.
      const item = dossierItem(f, DOSSIER.DEP002), reference = item.getByRole('button', { name: 'EXP-DEP002', exact: true });
      const mark = item.getByRole('img', { name: `À vérifier : ${NO_CONTACT}`, exact: true });
      const markBox = await mark.boundingBox(), referenceBox = await reference.boundingBox();
      assert.ok(markBox.x >= referenceBox.x + referenceBox.width && markBox.x - referenceBox.x - referenceBox.width <= 12, 'The mark follows the reference.');
      assert.ok(markBox.y >= referenceBox.y && markBox.y + markBox.height <= referenceBox.y + referenceBox.height && markBox.height >= 14, 'It sits on the reference line.');
      for (const part of await textStyles(f.page.locator('.dossier-table-alert:visible'))) assert.ok(part.ratio >= 3, `${part.text}: ${part.ratio.toFixed(2)}:1`);
      await item.getByRole('checkbox').check();await mark.hover();
      for (const part of await textStyles(mark)) assert.ok(part.ratio >= 3, `Selected and hovered: ${part.ratio.toFixed(2)}:1`);
      await item.getByRole('checkbox').uncheck();
      // Not a separate tab stop: from the reference, Tab moves past it.
      await reference.focus();await f.page.keyboard.press('Tab');
      assert.equal(await mark.evaluate(node => node.contains(document.activeElement)), false);
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/list-marks-${width}-${theme}.png`, fullPage: true });
      await item.screenshot({ path: `${output}/list-mark-dossier-${width}-${theme}.png` });
      // In the table the mark is part of the row: a click on it opens the dossier.
      if (width >= 768) { await mark.click();await assertDossierOpened(f, DOSSIER.DEP002, '/colis'); }
      assertNoBusinessWrite(f, width >= 768 ? DOSSIER_READ_ONLY_RPCS : READ_ONLY_RPCS);
    }, { width, theme });

    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`a-departure-after-the-end-of-the-subscription-is-confirmed-before-it-is-assigned-${width}-${theme}`, async f => {
      // Lucas’s EXP-DEP011 is paid like EXP-DEP001; it leaves on 15 October, inside his subscription.
      const parcel = f.tables.colis.find(item => item.id === DOSSIER.DEP011), paid = f.tables.colis.find(item => item.id === DOSSIER.DEP001);
      for (const key of ['statut', 'quote_version', 'devis_brouillon', 'devis_total', 'devis_snapshot', 'devis_envoye_le', 'paiement_montant', 'paiement_date']) parcel[key] = structuredClone(paid[key]);
      const before = structuredClone(f.tables.colis), calls = [];
      await f.page.route('**/rest/v1/rpc/assign_colis_departure', async route => {
        const input = route.request().postDataJSON();calls.push(input);
        if (input.p_expected_updated_at !== parcel.updated_at) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '40001', message: 'Le dossier a changé. Actualisez puis réessayez.' }) });
        Object.assign(parcel, { envoi_id: input.p_envoi_id, updated_at: new Date(Date.parse(parcel.updated_at) + 60000).toISOString() });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(parcel) });
      });
      await openDossier(f, DOSSIER.DEP011);await waitTheme(f, theme);
      const select = f.page.getByLabel('Départ de cette expédition', { exact: true });
      await select.waitFor();
      assert.deepEqual((await select.locator('option').evaluateAll(options => options.map(option => option.value))).sort(), ['', DEPARTURE.reunion15, DEPARTURE.reunion22, DEPARTURE.reunion29].sort());
      assert.equal(await select.inputValue(), DEPARTURE.reunion15);
      assert.equal(await alertBand(f).count(), 0, 'The 15 October departure is inside the subscription.');
      const dialog = f.page.getByRole('dialog', { name: 'Affecter quand même ?', exact: true });
      // Each way of closing the question writes nothing and shows the saved departure again.
      for (const close of ['Annuler', 'Escape', 'Fermer la confirmation', 'backdrop']) {
        await select.selectOption(DEPARTURE.reunion22);await dialog.waitFor();
        await dialog.getByText('Le départ du jeudi 22 octobre est après la fin de l’abonnement de Lucas (18 octobre).', { exact: true }).waitFor();
        if (close === 'Escape') await f.page.keyboard.press('Escape');
        else if (close === 'backdrop') await f.page.mouse.click(4, 4);
        else await dialog.getByRole('button', { name: close, exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(calls.length, 0, `${close}: nothing is written.`);
        assert.equal(await select.inputValue(), DEPARTURE.reunion15, `${close}: the saved departure is shown again.`);
      }
      // Confirmed: the departure is assigned exactly as without the question.
      await select.selectOption(DEPARTURE.reunion29);await dialog.waitFor();
      await dialog.getByText('Le départ du jeudi 29 octobre est après la fin de l’abonnement de Lucas (18 octobre).', { exact: true }).waitFor();
      for (const button of await dialog.getByRole('button').all()) { const box = await button.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44 && box.x >= 0 && box.x + box.width <= width + 1); }
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/assign-after-subscription-question-${width}-${theme}.png` });
      await dialog.getByRole('button', { name: 'Affecter quand même', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await f.page.getByText('Départ enregistré.', { exact: true }).waitFor();
      assert.deepEqual(calls, [{ p_colis_id: DOSSIER.DEP011, p_envoi_id: DEPARTURE.reunion29, p_expected_updated_at: before.find(item => item.id === DOSSIER.DEP011).updated_at }]);
      assert.equal(await select.inputValue(), DEPARTURE.reunion29);
      // The dossier now says so in « À vérifier ».
      await alertBand(f).waitFor();
      assert.deepEqual((await bandLines(f)).map(line => line.text), ['Le départ du jeudi 29 octobre est après la fin de son abonnement (18 octobre). Contactez le client.']);
      await f.page.screenshot({ path: `${output}/assigned-after-subscription-${width}-${theme}.png`, fullPage: true });
      // Inside the subscription the choice is saved at once.
      await select.selectOption(DEPARTURE.reunion15);
      await alertBand(f).waitFor({ state: 'detached' });
      assert.equal(calls.length, 2);assert.equal(calls[1].p_envoi_id, DEPARTURE.reunion15);
      assert.equal(await select.inputValue(), DEPARTURE.reunion15);
      // Only these two assignments were written.
      assert.deepEqual(f.tables.colis.filter(item => item.id !== DOSSIER.DEP011), before.filter(item => item.id !== DOSSIER.DEP011));
      assert.deepEqual(f.requests.filter(request => ['POST', 'PATCH', 'DELETE'].includes(request.method) && request.path.startsWith('/rest/v1/') && !DOSSIER_READ_ONLY_RPCS.some(rpc => request.path.endsWith(rpc))), []);
      assert.equal(f.requests.some(request => /\/(queue_message|send-email|send-telegram|payplug-create)/.test(request.path)), false);
    }, { width, theme });
  } finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); }
}
module.exports = { fixture, CLIENT, DEPARTURE, DOSSIER, REF, NOW };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
