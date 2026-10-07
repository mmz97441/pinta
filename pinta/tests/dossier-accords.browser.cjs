/* « Départ » at any step (lot 3a, part F1) and « Accords clients » (part F2).
 * Synthetic data on a fixed Paris clock; setup() mocks every request, including
 * the departure commands (assign_colis_departure, set_colis_departure_wish,
 * create_departure_for_colis), so nothing reaches Supabase, Telegram or PayPlug.
 *
 * Fixture (extend it rather than adding another one):
 * - the browser and the mocked server clocks are Tuesday 6 October 2026, 10:00
 *   in Paris;
 * - departures: Réunion 8 Oct (closes Wednesday 7 Oct, 17 h: within 48 hours),
 *   15, 22 and 29 Oct; Guadeloupe 15 and 22 Oct; Réunion 1 Oct (departed);
 * - clients: Flavie Payet (Réunion, portal + Telegram), Lucas Hoarau (Réunion,
 *   subscription until 18 Oct), Nadia Jacoby (Guadeloupe), Paul Grondin (Réunion);
 * - dossiers EXP-ACC001…013, listed in fixture() with their status, client and
 *   departure. The consent states: ACC001 and ACC010 to submit (receptionne),
 *   ACC002, ACC006 and ACC012 to submit (mesure), ACC003 awaited (with
 *   relances, the last one more than 24 hours ago: the relance is due again),
 *   ACC004 and ACC005 waiting at the client's request (until 25 Oct, then
 *   without a date); ACC011 is archived; the others are past consent.
 * - ACC006 has the desired day 19 November and no departure (« Départ à créer »).
 * - « Accords clients » lists ACC001–006, 010 and 012 in four client bands
 *   (ACCORD_GROUPS); addRelances() adds the relances of its column scenarios.
 * Helpers are exported for the next parts: extend main() with new sections. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const XLSX = require('xlsx');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_DOSSIER_ACCORDS_OUT || '/tmp/pinta-dossier-accords';
const results = [];

const NOW = new Date('2026-10-06T08:00:00Z');
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pad = n => String(n).padStart(3, '0');
const CLIENT = {
  payet: uuid('c2000000', 1),
  hoarau: uuid('c2000000', 2),
  jacoby: uuid('c2000000', 3),
  grondin: uuid('c2000000', 4),
};
const DEPARTURE = {
  reunion8: uuid('d2000000', 1),
  reunion15: uuid('d2000000', 2),
  reunion22: uuid('d2000000', 3),
  reunion29: uuid('d2000000', 4),
  guadeloupe15: uuid('d2000000', 5),
  guadeloupe22: uuid('d2000000', 6),
  reunion1: uuid('d2000000', 7),
};
// DOSSIER.ACC001 is the id of EXP-ACC001, and so on.
const DOSSIER = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`ACC${pad(index + 1)}`, uuid('e2000000', index + 1)]));
const REF = Object.fromEntries(Object.keys(DOSSIER).map(key => [DOSSIER[key], `EXP-${key}`]));
// The option label of each upcoming departure, as the Départ field shows it. None has a
// loading closing of its own: the Wednesday 17 h is their habitual closing, never a cut-off.
const OPTION = {
  [DEPARTURE.reunion8]: 'jeudi 8 octobre · clôture habituelle mercredi 7 octobre, 17 h',
  [DEPARTURE.reunion15]: 'jeudi 15 octobre · clôture habituelle mercredi 14 octobre, 17 h',
  [DEPARTURE.reunion22]: 'jeudi 22 octobre · clôture habituelle mercredi 21 octobre, 17 h',
  [DEPARTURE.reunion29]: 'jeudi 29 octobre · clôture habituelle mercredi 28 octobre, 17 h',
  [DEPARTURE.guadeloupe15]: 'jeudi 15 octobre · clôture habituelle mercredi 14 octobre, 17 h',
  [DEPARTURE.guadeloupe22]: 'jeudi 22 octobre · clôture habituelle mercredi 21 octobre, 17 h',
};
const REUNION_PLANNED = [DEPARTURE.reunion8, DEPARTURE.reunion15, DEPARTURE.reunion22, DEPARTURE.reunion29];

async function fixture(browser, { role = 'directeur', width = 1440, height = width < 768 ? 844 : 1000, theme = 'light', permissions = null } = {}) {
  const f = await setup(browser, role);
  // A role other than the direction gets exactly these permissions.
  if (permissions) { const row = { staff_id: ids.S, ...permissions }; f.tables.staff_permissions = [row]; f.tables.staff_users[0].staff_permissions = [row]; }
  f.page.setDefaultTimeout(10000);
  await f.page.setViewportSize({ width, height });
  await f.page.clock.setFixedTime(NOW);
  f.server.now = () => NOW.getTime();
  await f.context.addInitScript(value => localStorage.setItem('expedile-theme', value), theme);
  await f.context.addInitScript(installGroupReader);
  const client = (id, fields) => ({ id, user_id: null, telegram_chat_id: null, type: 'particulier', abonnement: 'freemium', abonnement_debut: null, abonnement_fin: null, onboarded: true, created_at: '2026-09-01T08:00:00Z', ...fields });
  // Complete records (prénom, nom, email, téléphone, address): « À vérifier » says nothing about them.
  f.tables.clients = [
    client(CLIENT.payet, { ref: 'CLI-ACC-01', nom: 'Payet', prenom: 'Flavie', email: 'flavie@example.test', tel: '0692 20 00 01', cp: '97400', ville: 'Saint-Denis', adresse_ligne1: '12 rue de Paris', user_id: uuid('a2000000', 1), telegram_chat_id: 8001 }),
    client(CLIENT.hoarau, { ref: 'CLI-ACC-02', nom: 'Hoarau', prenom: 'Lucas', email: 'lucas@example.test', tel: '0692 20 00 02', cp: '97430', ville: 'Le Tampon', adresse_ligne1: '8 chemin des Fleurs', user_id: uuid('a2000000', 2), telegram_chat_id: 8002, abonnement: 'premium', abonnement_debut: '2025-10-18', abonnement_fin: '2026-10-18' }),
    client(CLIENT.jacoby, { ref: 'CLI-ACC-03', nom: 'Jacoby', prenom: 'Nadia', email: 'nadia@example.test', tel: '0690 20 00 03', cp: '97110', ville: 'Pointe-à-Pitre', adresse_ligne1: '4 rue Schœlcher', telegram_chat_id: 8003 }),
    client(CLIENT.grondin, { ref: 'CLI-ACC-04', nom: 'Grondin', prenom: 'Paul', email: 'paul@example.test', tel: '0692 20 00 04', cp: '97410', ville: 'Saint-Pierre', adresse_ligne1: '3 rue des Bons Enfants', telegram_chat_id: 8004 }),
  ];
  const departure = (id, ref, date, code, fields = {}) => ({ id, ref, date_depart: date, destination_code: code, statut: 'planifie', mode_transport: 'aerien', loading_closes_at: null, departed_at: null, manifest_version: 0, updated_at: '2026-10-01T08:00:00Z', ...fields });
  f.tables.envois = [
    departure(DEPARTURE.reunion8, 'ENV-2026-101', '2026-10-08', '974'),
    departure(DEPARTURE.reunion15, 'ENV-2026-102', '2026-10-15', '974'),
    departure(DEPARTURE.reunion22, 'ENV-2026-103', '2026-10-22', '974'),
    departure(DEPARTURE.reunion29, 'ENV-2026-104', '2026-10-29', '974'),
    departure(DEPARTURE.guadeloupe15, 'ENV-2026-105', '2026-10-15', '971'),
    departure(DEPARTURE.guadeloupe22, 'ENV-2026-106', '2026-10-22', '971'),
    departure(DEPARTURE.reunion1, 'ENV-2026-099', '2026-10-01', '974', { statut: 'parti', departed_at: '2026-10-01T06:00:00Z', manifest_version: 1 }),
  ];
  const template = structuredClone(f.tables.colis[0]);
  const dossier = (n, clientId, envoiId, fields = {}) => ({ ...structuredClone(template), id: DOSSIER[`ACC${pad(n)}`], ref: `EXP-ACC${pad(n)}`, client_id: clientId, envoi_id: envoiId, depart_souhaite: null,
    casier: `C-${pad(n)}`, desc_contenu: `Achats du dossier ${pad(n)}`, updated_at: `2026-10-0${1 + (n % 5)}T08:00:00Z`,
    reception_dates: [{ receivedAt: `2026-09-${String(10 + n).padStart(2, '0')}T08:00:00Z`, source: 'server' }, { receivedAt: `2026-09-${String(12 + n).padStart(2, '0')}T08:00:00Z`, source: 'server' }], ...fields });
  // Received and measured, before consent: no outgoing package yet.
  const measured = { statut: 'mesure', feu_vert: 'en_attente', feu_vert_date: null, final_packages: [], outgoing_parcel_count: 0, final_measurements_version: null, final_measurements_at: null, fin_l: null, fin_w: null, fin_h: null, fin_p: null };
  const received = { ...measured, statut: 'receptionne', dim_l: null, dim_w: null, dim_h: null, poids: null, dims_par_colis: [] };
  const awaited = { ...measured, statut: 'attente_feu_vert' };
  const paid = { statut: 'paye', quote_version: 1, devis_brouillon: false, devis_total: 120, devis_snapshot: { amounts: { total: 120 }, inputs: { destination: { code: '974' } } }, devis_envoye_le: '2026-10-02T08:00:00Z', paiement_montant: 120, paiement_date: '2026-10-02T10:00:00Z' };
  f.tables.colis = [
    dossier(1, CLIENT.payet, null, received),
    dossier(2, CLIENT.payet, DEPARTURE.reunion8, measured),
    dossier(3, CLIENT.payet, DEPARTURE.reunion8, { ...awaited, demande_feu_vert_envoyee_at: '2026-10-02T09:00:00Z', consent_request_version: 1 }),
    dossier(4, CLIENT.hoarau, null, { ...awaited, demande_feu_vert_envoyee_at: '2026-10-01T09:00:00Z', attente_client_date: '2026-10-03T08:00:00Z', attente_client_until: '2026-10-25T08:00:00Z', attente_client_motif: 'Attend d’autres colis' }),
    dossier(5, CLIENT.hoarau, null, { ...awaited, demande_feu_vert_envoyee_at: '2026-10-01T10:00:00Z', attente_client_date: '2026-10-04T08:00:00Z', attente_client_motif: 'Attend d’autres colis' }),
    dossier(6, CLIENT.grondin, null, { ...measured, depart_souhaite: '2026-11-19' }),
    dossier(7, CLIENT.jacoby, DEPARTURE.guadeloupe15, { statut: 'en_preparation' }),
    dossier(8, CLIENT.grondin, DEPARTURE.reunion15, paid),
    dossier(9, CLIENT.payet, null, { statut: 'autorise' }),
    dossier(10, CLIENT.jacoby, null, received),
    dossier(11, CLIENT.grondin, null, { ...awaited, archive: true }),
    dossier(12, CLIENT.hoarau, null, measured),
    dossier(13, CLIENT.payet, DEPARTURE.reunion1, { ...paid, statut: 'expedie', date_expedition: '2026-10-01T06:00:00Z' }),
  ];
  const invoice = structuredClone(f.tables.factures[0]), line = structuredClone(f.tables.lignes[0]);
  f.tables.factures = f.tables.colis.map((parcel, index) => ({ ...invoice, id: `accords-invoice-${index + 1}`, colis_id: parcel.id, fichier_url: `${parcel.id}/facture.pdf` }));
  f.tables.lignes = f.tables.colis.map((parcel, index) => ({ ...line, id: `accords-line-${index + 1}`, colis_id: parcel.id, facture_id: `accords-invoice-${index + 1}` }));
  const message = (n, dossierNumber, template, createdAt) => ({ id: uuid('b2000000', n), colis_id: DOSSIER[`ACC${pad(dossierNumber)}`], type: 'staff', auteur_nom: 'Camille', texte: template === 'relance_feu_vert' ? 'Bonjour, votre accord est toujours attendu.' : 'Bonjour, pouvons-nous préparer vos cartons ?', canal: 'telegram', template, statut: 'envoye', lu: true, created_at: createdAt });
  f.tables.messages = [
    message(1, 3, 'demande_feu_vert', '2026-10-02T09:00:00Z'),
    message(2, 3, 'relance_feu_vert', '2026-10-04T09:00:00Z'),
    // 24 h 30 before NOW: no longer followed up (a request or relance is followed up for 24 hours).
    message(3, 3, 'relance_feu_vert', '2026-10-05T07:30:00Z'),
    message(4, 4, 'demande_feu_vert', '2026-10-01T09:00:00Z'),
    message(5, 5, 'demande_feu_vert', '2026-10-01T10:00:00Z'),
  ];
  const work = (n, kind, fields = {}) => ({ id: uuid('f2000000', n), colis_id: DOSSIER[`ACC${pad(n)}`], kind, state: 'ready', assignee_id: null, version: 1, created_at: '2026-10-05T08:00:00Z', updated_at: '2026-10-05T08:00:00Z', ...fields });
  f.tables.staff_work_actions = [
    work(1, 'reception'),
    // The relance before the closing of 8 October (sync_staff_work_actions).
    work(2, 'reception', { action_hint: 'Demander l’accord avant la clôture du départ', due_at: '2026-10-07T15:00:00Z' }),
    work(3, 'reception', { action_hint: 'Relancer le client avant la clôture du départ', due_at: '2026-10-07T15:00:00Z' }),
    work(4, 'reception', { state: 'waiting', blocked_reason: 'Attente volontaire du client', due_at: '2026-10-25T08:00:00Z' }),
    work(6, 'reception'),
    work(8, 'departure'),
    work(9, 'preparation'),
  ];
  f.tables.staff_work_preferences[0].active_mission = null;
  f.tables.notifications = [];
  f.before = structuredClone(f.tables.colis);
  f.envoisBefore = structuredClone(f.tables.envois);
  return f;
}

/** A departure a scenario adds before the page loads it (the fixture's own stay as they are). */
const extraDeparture = (id, ref, date, code, fields = {}) => ({ id, ref, date_depart: date, destination_code: code, statut: 'planifie', mode_transport: 'aerien', loading_closes_at: null, departed_at: null, manifest_version: 0, updated_at: '2026-10-01T08:00:00Z', ...fields });
function addDepartures(f, ...rows) { f.tables.envois.push(...rows); f.envoisBefore = structuredClone(f.tables.envois); }

// Reading writes nothing: only the read-only RPCs of loading and of the dossier page.
const READ_ONLY_RPCS = ['/refresh_staff_work_actions', '/get_reception_dates', '/suggest_customs_tariffs', '/get_invoice_review_context'];
const DEPARTURE_COMMANDS = ['assign_colis_departure', 'set_colis_departure_wish', 'create_departure_for_colis'];
const writes = f => f.requests.filter(request => ['POST', 'PATCH', 'DELETE'].includes(request.method) && request.path.startsWith('/rest/v1/') && !READ_ONLY_RPCS.some(rpc => request.path.endsWith(rpc)));
const commands = (f, name) => f.requests.filter(request => request.path.endsWith(`/rpc/${name}`)).map(request => request.input);
function assertNoBusinessWrite(f) {
  assert.deepEqual(f.tables.colis, f.before);
  assert.deepEqual(f.tables.envois, f.envoisBefore);
  assert.deepEqual(writes(f), []);
  assert.equal(f.requests.some(request => /\/(queue_message|send-email|send-telegram|payplug-create)/.test(request.path)), false);
}
/** Only the given departure commands were written, and nothing else. */
function assertOnlyDepartureWrites(f) {
  assert.deepEqual(writes(f).filter(request => !DEPARTURE_COMMANDS.some(name => request.path.endsWith(`/rpc/${name}`))), []);
  assert.equal(f.requests.some(request => request.method === 'POST' && request.path.endsWith('/rest/v1/envois')), false, 'A departure is only created by its command.');
  assert.equal(f.requests.some(request => /\/(queue_message|send-email|send-telegram|payplug-create)/.test(request.path)), false, 'No message is sent.');
}
const row = (f, id) => f.tables.colis.find(item => item.id === id);
const noPageOverflow = async f => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
async function axe(f, include) {
  let builder = new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
  if (include) builder = builder.include(include);
  const audit = await builder.analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
}
const waitTheme = (f, theme) => f.page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
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

// ── The dossier page and its Départ field ─────────────────────────────────────
const overview = f => f.page.getByTestId('dossier-overview');
const workspace = f => f.page.getByTestId('dossier-task-workspace');
const departureLine = scope => scope.locator('.dossier-departure-line');
const editDeparture = f => overview(f).getByRole('button', { name: 'Modifier le départ du dossier', exact: true });
const combobox = scope => scope.getByRole('combobox', { name: 'Départ de cette expédition', exact: true });
const listbox = scope => scope.getByRole('listbox');
const alertBand = f => f.page.getByRole('region', { name: 'À vérifier', exact: true });
/** The band's lines in order: the sentence and its link, if any. */
const bandLines = f => alertBand(f).locator('li').evaluateAll(items => items.map(item => {
  const link = item.querySelector('a');
  return { text: item.querySelector('p').textContent.trim(), link: link && { label: link.textContent.trim(), href: link.getAttribute('href') } };
}));
// « À vérifier » lines of the consent and of the desired day (the Wednesday 7 October 17 h closing of 8 October).
const CUTOFF_8 = 'Accord du client à obtenir avant mercredi 7 octobre, 17 h (clôture habituelle du départ du jeudi 8 octobre).';
const MEASURE_CUTOFF_8 = 'Cartons à mesurer puis accord du client à demander avant mercredi 7 octobre, 17 h (clôture habituelle du départ du jeudi 8 octobre).';
const TO_ASSIGN_19 = 'Un départ est prévu le jeudi 19 novembre, jour souhaité : affectez-y le dossier.';
/** The dossier page shows its departure, read from the planning: what the band needs to decide is loaded. */
async function departureShown(f, text) {
  await f.page.waitForFunction(expected => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-text')?.innerText.replace(/\s+/g, ' ').trim() === expected, text);
}
/** Lets the page's minute clock see another instant, as on a page left open (no reload). Only the 30-second
 * clock (useMinuteNow) may show the change: 31 seconds do not reach the one-minute data refresh, and an instant
 * within the hour of the session does not renew it. Once per loaded page. */
async function idleUntil(f, instant) {
  await f.page.clock.setFixedTime(new Date(instant));
  await f.page.clock.runFor(31000);
}
/** Opens a dossier as the list does, once it has pinned its step in the URL. */
async function openDossier(f, id, query = '') {
  await f.page.goto(`${base}/colis/${id}?returnTo=%2Fcolis${query ? `&${query}` : ''}`);
  await f.page.getByTestId('dossier-task-header').getByText(REF[id], { exact: true }).waitFor();
  await f.page.waitForURL(url => url.searchParams.has('section'));
}
/** The line « Départ : … » and the saved state it reflects. */
async function departureText(scope) {
  const line = departureLine(scope);
  return { text: (await line.locator('.dossier-departure-text').innerText()).replace(/\s+/g, ' ').trim(), envoi: await line.getAttribute('data-envoi'), wish: await line.getAttribute('data-wish') };
}
/** The offered options, in order: departure label, its id, the « Prochain départ » mark and the current one. */
function optionList(scope) {
  return listbox(scope).getByRole('option').evaluateAll(nodes => nodes.map(node => ({
    label: node.querySelector('.dossier-departure-option-text').textContent.trim(), kind: node.dataset.kind, envoi: node.dataset.envoi || null,
    next: Boolean(node.querySelector('.dossier-departure-badge')), current: node.getAttribute('aria-current') === 'true',
  })));
}
async function openOverviewEditor(f) {
  await editDeparture(f).click();
  await combobox(overview(f)).waitFor();
  await listbox(overview(f)).waitFor();
  // The field takes the focus.
  await f.page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'combobox' && document.activeElement.closest('[data-testid="dossier-overview"]'));
}
const focusOnEdit = f => f.page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Modifier le départ du dossier');
const option = (scope, envoiId) => listbox(scope).locator(`[role="option"][data-envoi="${envoiId}"]`);
const actionOption = (scope, kind) => listbox(scope).locator(`[role="option"][data-kind="${kind}"]`);
const missingLine = scope => scope.locator('.dossier-departure-missing');
const fieldError = scope => scope.locator('.dossier-departure-picker [role="alert"]');

// ── « Accords clients » and the grouping by client ────────────────────────────
// The dossiers whose consent is to obtain, one band per client, the client
// whose oldest dossier arrived first leading (ACC001 on 11 September, ACC004 on
// 14, ACC006 on 16, ACC010 on 20). The others are past consent, or archived (ACC011).
const ACCORD_GROUPS = [
  { key: `client:${CLIENT.payet}`, title: 'Flavie Payet', count: '3 dossiers', dossiers: [DOSSIER.ACC001, DOSSIER.ACC002, DOSSIER.ACC003] },
  { key: `client:${CLIENT.hoarau}`, title: 'Lucas Hoarau', count: '3 dossiers', dossiers: [DOSSIER.ACC004, DOSSIER.ACC005, DOSSIER.ACC012] },
  { key: `client:${CLIENT.grondin}`, title: 'Paul Grondin', count: '1 dossier', dossiers: [DOSSIER.ACC006] },
  { key: `client:${CLIENT.jacoby}`, title: 'Nadia Jacoby', count: '1 dossier', dossiers: [DOSSIER.ACC010] },
];
const ACCORD_DOSSIERS = ACCORD_GROUPS.flatMap(group => group.dossiers);
const ACCORD_COLUMNS = [['ref', 'Référence'], ['client', 'Client'], ['receivedAt', 'Dernière réception'], ['consentState', 'Accord'], ['consentRequestedAt', 'Demande envoyée le'],
  ['lastRelanceAt', 'Dernière relance'], ['cartons', 'Cartons reçus'], ['casier', 'Casier'], ['departure', 'Départ prévu'], ['action', 'Action']];
const VIEW_LABELS = ['Travail quotidien', 'Paiements', 'Départs', 'Accords clients'];
/** Installed in the page: group headings and their dossiers, in screen order,
 * from the visible layout (table rows or cards). */
function installGroupReader() {
  window.__pintaGroups = () => {
    const shown = node => node.getClientRects().length > 0;
    const heading = node => ({ key: node.dataset.dossierGroup, title: node.querySelector('.dossier-group-title')?.textContent.trim(), ref: node.querySelector('.dossier-group-ref')?.textContent.trim() || null, count: node.querySelector('.dossier-group-count')?.textContent.trim(), dossiers: [] });
    const table = document.querySelector('table.dossier-data-table');
    if (table && shown(table)) {
      const groups = [];
      for (const item of table.tBodies[0].rows) {
        if (item.dataset.dossierGroup) groups.push(heading(item));
        else if (item.dataset.dossierRow) groups.at(-1)?.dossiers.push(item.dataset.dossierRow);
      }
      return { layout: 'table', groups };
    }
    return { layout: 'cards', groups: [...document.querySelectorAll('.dossier-card-list > [data-dossier-group]')].filter(shown).map(node => ({ ...heading(node), dossiers: [...node.querySelectorAll('[data-dossier-card]')].map(card => card.dataset.dossierCard) })) };
  };
}
const visibleGroups = f => f.page.evaluate(() => window.__pintaGroups());
const groupShape = (groups, ordered) => groups.map(({ key, title, ref = null, count, dossiers }) => ({ key, title, ref, count, dossiers: ordered ? dossiers : [...dossiers].sort() }));
/** Waits for React to commit the expected bands (the URL changes first), then compares them. */
async function assertGroups(f, expected, { ordered = false } = {}) {
  const want = groupShape(expected, ordered);
  await f.page.waitForFunction(([want, ordered]) => JSON.stringify(window.__pintaGroups().groups.map(({ key, title, ref, count, dossiers }) => ({ key, title, ref, count, dossiers: ordered ? dossiers : [...dossiers].sort() }))) === JSON.stringify(want), [want, ordered]).catch(() => {});
  assert.deepEqual(groupShape((await visibleGroups(f)).groups, ordered), want);
}
const shownIds = f => f.page.locator('[data-dossier-row]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.dossierRow));
const countStatus = (f, count) => f.page.locator('.dossier-meta-count').filter({ hasText: new RegExp(`^${count} dossiers?$`) });
async function openAccords(f, query = '') {
  await f.page.goto(`${base}/colis?table=accords${query ? `&${query}` : ''}`);
  await f.page.locator('[data-dossier-row]:visible').first().waitFor();
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
async function selectTab(f, label, value) {
  await closeDisplay(f);
  await f.page.locator('[aria-label="Vues du tableau"]').getByRole('button', { name: label, exact: true }).click();
  await f.page.waitForURL(url => (url.searchParams.get('table') || 'daily') === value);
}
const viewTabs = f => f.page.locator('[aria-label="Vues du tableau"]').getByRole('button').allTextContents();
const storedPreference = (f, kind, view) => f.page.evaluate(([kind, user, view]) => localStorage.getItem(`expedile:${kind}:v1:${encodeURIComponent(user)}:${view}`), [kind, ids.A, view]);
/** The cell of a table row: its pill, tone, other lines and whole text. */
async function tableCell(f, id, key) {
  const cell = f.page.locator(`tr[data-dossier-row="${id}"] > td[data-column="${key}"]`);
  const pill = cell.locator('.dossier-pill');
  return { text: (await cell.innerText()).replace(/\s+/g, ' ').trim(), pill: await pill.count() ? (await pill.innerText()).trim() : null, tone: await pill.count() ? await pill.getAttribute('data-tone') : null,
    secondary: (await cell.locator('.dossier-table-secondary').allTextContents()).map(text => text.trim()), placeholder: await cell.locator('.dossier-table-placeholder').count() > 0 };
}
/** Applies a column filter through its heading, as a person does. */
async function filterColumn(f, key, mode, value = '') {
  await f.page.locator(`th[data-column="${key}"] .dossier-table-filter`).click();
  const dialog = f.page.getByRole('dialog', { name: /^Filtrer / });
  const condition = dialog.getByRole('combobox', { name: /^Condition pour / });
  await condition.waitFor();
  const label = (await condition.getAttribute('aria-label')).slice('Condition pour '.length);
  await condition.selectOption(mode);
  if (mode === 'is') await dialog.getByLabel(`Filtrer : ${label}`, { exact: true }).selectOption(value);
  else if (!['empty', 'filled'].includes(mode)) await dialog.getByLabel(`Filtrer : ${label}`, { exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Appliquer le filtre', exact: true }).click();
  await f.page.waitForURL(url => url.searchParams.has(`col.${key}`));
  await dialog.waitFor({ state: 'hidden' });
}
/** Sorts on a column not sorted yet, through its heading: a first press sorts ascending, a second one descending. */
async function sortBy(f, key, direction) {
  const button = f.page.locator(`th[data-column="${key}"] .dossier-table-sort`);
  await button.click();
  await f.page.waitForURL(url => url.searchParams.get('sort') === key && url.searchParams.get('dir') === 'asc');
  if (direction === 'desc') { await button.click(); await f.page.waitForURL(url => url.searchParams.get('dir') === 'desc'); }
  await f.page.locator(`th[data-column="${key}"][aria-sort="${direction === 'asc' ? 'ascending' : 'descending'}"]`).waitFor();
}
/** The relances of the « Dernière relance » scenarios, added before the list loads. */
function addRelances(f) {
  const relance = (n, dossierNumber, createdAt, fields = {}) => ({ id: uuid('b2000000', 100 + n), colis_id: DOSSIER[`ACC${pad(dossierNumber)}`], type: 'staff', auteur_nom: 'Camille', texte: 'Bonjour, votre accord est toujours attendu.', canal: 'telegram', template: 'relance_feu_vert', statut: 'envoye', lu: true, created_at: createdAt, ...fields });
  f.tables.messages.push(
    // ACC004: a relance of an older request, before the request of 1 October.
    relance(1, 4, '2026-09-30T09:00:00Z'),
    // ACC005: an e-mail relance drafted before the client chose to wait: never sent.
    relance(2, 5, '2026-10-03T09:00:00Z', { canal: 'email', statut: 'envoi' }),
    // ACC012: measured again, no request is current; its old relance no longer counts.
    relance(3, 12, '2026-10-05T10:00:00Z'),
  );
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  // PINTA_DOSSIER_ACCORDS_SHARD=i/n runs every n-th scenario from the i-th (0-based): the shards cover the suite once.
  const [shard, shards] = (process.env.PINTA_DOSSIER_ACCORDS_SHARD || '0/1').split('/').map(Number);
  let index = -1;
  async function scenario(name, run, options = {}) {
    index += 1;
    if (index % shards !== shard) return;
    if (process.env.PINTA_DOSSIER_ACCORDS_FILTER && !name.includes(process.env.PINTA_DOSSIER_ACCORDS_FILTER)) return;
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
    // ── A. The Départ field at every step ───────────────────────────────────
    await scenario('opening-the-list-the-dossiers-and-the-departure-field-writes-nothing', async f => {
      for (const table of ['', 'table=departures', 'table=payments']) {
        await f.page.goto(`${base}/colis${table ? `?${table}` : ''}`);
        await f.page.locator('[data-dossier-row]:visible').first().waitFor();
      }
      for (const id of [DOSSIER.ACC001, DOSSIER.ACC003, DOSSIER.ACC006, DOSSIER.ACC007, DOSSIER.ACC008]) {
        await openDossier(f, id);
        await openOverviewEditor(f);
        // Typing a day without a departure only proposes; nothing is written.
        await combobox(overview(f)).fill('26/11');
        await missingLine(overview(f)).getByText('Aucun départ prévu le jeudi 26 novembre', { exact: false }).waitFor();
        await combobox(overview(f)).press('Escape');
        await combobox(overview(f)).waitFor({ state: 'detached' });
        await focusOnEdit(f); // Escape closes the field and returns to « Modifier ».
      }
      await openDossier(f, DOSSIER.ACC008, 'section=expedition');
      await combobox(workspace(f)).click();await listbox(workspace(f)).waitFor();
      await combobox(workspace(f)).press('Escape');await listbox(workspace(f)).waitFor({ state: 'detached' });
      assertNoBusinessWrite(f);
    });

    await scenario('the-field-names-the-departure-the-desired-day-or-what-is-to-choose-and-hides-after-departure', async f => {
      for (const [id, text] of [
        [DOSSIER.ACC003, 'Départ : jeudi 8 octobre · Réunion'],
        [DOSSIER.ACC006, 'Départ souhaité : jeudi 19 novembre · à créer'],
        [DOSSIER.ACC001, 'Départ : à choisir'],
        [DOSSIER.ACC007, 'Départ : jeudi 15 octobre · Guadeloupe'],
        [DOSSIER.ACC008, 'Départ : jeudi 15 octobre · Réunion'],
      ]) {
        await openDossier(f, id);
        assert.equal((await departureText(overview(f))).text, text, REF[id]);
        // Next to Casier, in the overview heading.
        const casier = await overview(f).locator('[data-overview="casier"]').boundingBox(), line = await overview(f).locator('[data-overview="departure"]').boundingBox();
        assert.ok(Math.abs((casier.y + casier.height / 2) - (line.y + line.height / 2)) <= 4 && line.x > casier.x, `${REF[id]}: the departure follows the casier on its line.`);
      }
      // The expedition step reads like the list for a desired day.
      await openDossier(f, DOSSIER.ACC006);
      assert.match(await overview(f).locator('[data-step="expedition"] button').getAttribute('title'), /^Souhaité le 19\/11\/2026 · à créer/);
      // After the departure, cancelled or archived: no Départ field.
      await openDossier(f, DOSSIER.ACC013);
      assert.equal(await overview(f).locator('[data-overview="departure"]').count(), 0);
      assertNoBusinessWrite(f);
    });

    for (const [statut, id, start, path, scopeOf] of [
      ['receptionne', DOSSIER.ACC001, null, [DEPARTURE.reunion15, DEPARTURE.reunion22], overview],
      ['attente_feu_vert', DOSSIER.ACC003, DEPARTURE.reunion8, [DEPARTURE.reunion15, DEPARTURE.reunion22], overview],
      ['en_preparation', DOSSIER.ACC007, DEPARTURE.guadeloupe15, [DEPARTURE.guadeloupe22, DEPARTURE.guadeloupe15], overview],
      ['paye', DOSSIER.ACC008, DEPARTURE.reunion15, [DEPARTURE.reunion22, DEPARTURE.reunion29], workspace],
    ]) await scenario(`choose-change-and-remove-the-departure-at-${statut}`, async f => {
      await openDossier(f, id, scopeOf === workspace ? 'section=expedition' : '');
      const scope = scopeOf(f), task = scopeOf === workspace;
      const planned = statut === 'en_preparation' ? [DEPARTURE.guadeloupe15, DEPARTURE.guadeloupe22] : REUNION_PLANNED;
      const destination = statut === 'en_preparation' ? 'Guadeloupe' : 'Réunion';
      const open = async () => { if (task) await combobox(scope).click(); else await openOverviewEditor(f); await listbox(scope).waitFor(); };
      await open();
      // The planned departures of the destination, soonest first, the next one marked; « Retirer le départ » when one is assigned.
      assert.deepEqual(await optionList(scope), [
        ...planned.map((envoi, index) => ({ label: OPTION[envoi], kind: 'departure', envoi, next: index === 0, current: envoi === start })),
        ...(start ? [{ label: 'Retirer le départ', kind: 'remove', envoi: null, next: false, current: false }] : []),
      ]);
      assert.equal(await listbox(scope).getAttribute('aria-label'), `Départs prévus pour ${statut === 'en_preparation' ? 'la Guadeloupe' : 'la Réunion'}`);
      assert.equal(await option(scope, planned[0]).getAttribute('aria-selected'), 'true', 'The next departure is suggested.');
      for (const [step, envoi] of path.entries()) {
        const before = row(f, id).updated_at;
        if (step > 0) await open();
        await option(scope, envoi).click();
        await f.page.waitForFunction(([selector, expected]) => document.querySelector(selector)?.dataset.envoi === expected, [`${task ? '[data-testid="dossier-task-workspace"]' : '[data-testid="dossier-overview"]'} .dossier-departure-line`, envoi]);
        assert.deepEqual(commands(f, 'assign_colis_departure').at(-1), { p_colis_id: id, p_envoi_id: envoi, p_expected_updated_at: before });
        assert.equal((await departureText(scope)).text, `Départ : ${OPTION[envoi].split(' · ')[0]} · ${destination}`);
        assert.equal(row(f, id).envoi_id, envoi);
        if (task) await scope.getByRole('status').filter({ hasText: 'Départ enregistré.' }).waitFor();
        else await focusOnEdit(f); // After the choice the focus returns to « Modifier ».
      }
      // Removing: one command, the dossier has no departure any more.
      const before = row(f, id).updated_at;
      await open();
      await actionOption(scope, 'remove').click();
      await f.page.waitForFunction(selector => document.querySelector(selector)?.dataset.envoi === '', `${task ? '[data-testid="dossier-task-workspace"]' : '[data-testid="dossier-overview"]'} .dossier-departure-line`);
      assert.deepEqual(commands(f, 'assign_colis_departure').at(-1), { p_colis_id: id, p_envoi_id: null, p_expected_updated_at: before });
      assert.equal((await departureText(scope)).text, 'Départ : à choisir');
      assert.equal(commands(f, 'assign_colis_departure').length, path.length + 1);
      assert.equal(row(f, id).envoi_id, null);
      if (task) await scope.getByRole('status').filter({ hasText: 'Affectation retirée.' }).waitFor();
      assert.deepEqual(f.tables.colis.filter(item => item.id !== id), f.before.filter(item => item.id !== id), 'Only this dossier changed.');
      assertOnlyDepartureWrites(f);
      assert.equal(commands(f, 'set_colis_departure_wish').length + commands(f, 'create_departure_for_colis').length, 0);
    });

    await scenario('the-combobox-filters-by-typing-and-works-with-the-keyboard', async f => {
      await openDossier(f, DOSSIER.ACC001);
      await openOverviewEditor(f);
      const scope = overview(f), input = combobox(scope);
      assert.equal(await input.getAttribute('aria-expanded'), 'true');
      assert.equal(await input.getAttribute('aria-controls'), await listbox(scope).getAttribute('id'));
      // Arrows move the suggestion, which the field announces.
      const active = async () => input.evaluate(node => document.getElementById(node.getAttribute('aria-activedescendant'))?.dataset.envoi || document.getElementById(node.getAttribute('aria-activedescendant'))?.dataset.kind || null);
      assert.equal(await active(), DEPARTURE.reunion8);
      await input.press('ArrowDown');assert.equal(await active(), DEPARTURE.reunion15);
      await input.press('ArrowUp');await input.press('ArrowUp');assert.equal(await active(), DEPARTURE.reunion29, 'Up from the first goes to the last.');
      // Typing filters: a word, then a date with its departure.
      await input.fill('22');
      assert.deepEqual((await optionList(scope)).map(item => item.envoi), [DEPARTURE.reunion22]);
      await input.fill('jeudi 29');
      assert.deepEqual((await optionList(scope)).map(item => item.envoi), [DEPARTURE.reunion29]);
      assert.equal(await missingLine(scope).count(), 0, 'A departure exists that day.');
      await input.fill('15/10');
      assert.deepEqual(await optionList(scope), [{ label: OPTION[DEPARTURE.reunion15], kind: 'departure', envoi: DEPARTURE.reunion15, next: false, current: false }]);
      // A weekday never moves the date: « jeudi 23 » is the next 23rd, named with its real weekday.
      assert.equal(await scope.locator('.dossier-departure-hint').innerText(), 'Tapez une date : 23/10 ou 23 octobre.');
      await input.fill('jeudi 23');
      assert.equal(await missingLine(scope).innerText(), 'Aucun départ prévu le vendredi 23 octobre pour la Réunion');
      // A past day proposes nothing.
      await input.fill('1/10/2026');
      assert.equal(await missingLine(scope).innerText(), 'Choisissez une date à venir.');
      assert.equal(await listbox(scope).count(), 0);
      // Enter chooses the suggestion.
      await input.fill('22/10');await input.press('Enter');
      await f.page.waitForFunction(id => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.envoi === id, DEPARTURE.reunion22);
      assert.deepEqual(commands(f, 'assign_colis_departure'), [{ p_colis_id: DOSSIER.ACC001, p_envoi_id: DEPARTURE.reunion22, p_expected_updated_at: f.before.find(item => item.id === DOSSIER.ACC001).updated_at }]);
      // « Annuler » closes without writing.
      await openOverviewEditor(f);await scope.getByRole('button', { name: 'Annuler', exact: true }).click();
      await input.waitFor({ state: 'detached' });
      assert.equal(commands(f, 'assign_colis_departure').length, 1);
      assertOnlyDepartureWrites(f);
    });

    await scenario('a-typed-day-without-departure-is-created-after-confirmation-and-assigned', async f => {
      await openDossier(f, DOSSIER.ACC001);
      await openOverviewEditor(f);
      const scope = overview(f);
      await combobox(scope).fill('jeudi 26 novembre');
      assert.equal(await missingLine(scope).innerText(), 'Aucun départ prévu le jeudi 26 novembre pour la Réunion');
      assert.deepEqual(await optionList(scope), [{ label: 'Créer ce départ (aérien) et y affecter le dossier', kind: 'create', envoi: null, next: false, current: false }]);
      const dialog = f.page.getByRole('dialog', { name: 'Créer le départ du jeudi 26 novembre ?', exact: true });
      const message = 'Départ aérien pour la Réunion, clôture mercredi 25 novembre, 17 h. Le dossier EXP-ACC001 y sera affecté. Aucun message n’est envoyé au client.';
      // Each way of closing the question writes nothing.
      for (const close of ['Annuler', 'Escape', 'Fermer la confirmation', 'backdrop']) {
        await actionOption(scope, 'create').click();
        await dialog.getByText(message, { exact: true }).waitFor();
        if (close === 'Escape') await f.page.keyboard.press('Escape');
        else if (close === 'backdrop') await f.page.mouse.click(4, 4);
        else await dialog.getByRole('button', { name: close, exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(commands(f, 'create_departure_for_colis').length, 0, `${close}: nothing is created.`);
        await combobox(scope).click();
      }
      assert.equal(f.tables.envois.length, f.envoisBefore.length);
      await actionOption(scope, 'create').click();
      await dialog.getByRole('button', { name: 'Créer ce départ et y affecter le dossier', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await f.page.waitForFunction(() => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.envoi);
      assert.deepEqual(commands(f, 'create_departure_for_colis'), [{ p_colis_id: DOSSIER.ACC001, p_date: '2026-11-26', p_expected_updated_at: f.before.find(item => item.id === DOSSIER.ACC001).updated_at }], 'Created once.');
      const created = f.tables.envois.find(envoi => !f.envoisBefore.some(item => item.id === envoi.id));
      assert.deepEqual({ date: created.date_depart, destination: created.destination_code, statut: created.statut, mode: created.mode_transport, closing: created.loading_closes_at },
        { date: '2026-11-26', destination: '974', statut: 'planifie', mode: 'aerien', closing: '2026-11-25T16:00:00.000Z' });
      assert.equal(row(f, DOSSIER.ACC001).envoi_id, created.id);
      assert.deepEqual(await departureText(overview(f)), { text: 'Départ : jeudi 26 novembre · Réunion', envoi: created.id, wish: '' });
      // The new departure is now offered like the others.
      await openOverviewEditor(f);
      assert.deepEqual((await optionList(scope)).filter(item => item.kind === 'departure').map(item => [item.envoi, item.current]), [...REUNION_PLANNED.map(envoi => [envoi, false]), [created.id, true]]);
      assertOnlyDepartureWrites(f);
      assert.equal(commands(f, 'assign_colis_departure').length + commands(f, 'set_colis_departure_wish').length, 0);
    });

    await scenario('without-perm-envois-creer-a-typed-day-is-kept-as-the-desired-day', async f => {
      await openDossier(f, DOSSIER.ACC001);
      await openOverviewEditor(f);
      const scope = overview(f);
      await combobox(scope).fill('26/11');
      assert.equal(await missingLine(scope).innerText(), 'Aucun départ prévu le jeudi 26 novembre pour la Réunion');
      assert.deepEqual(await optionList(scope), [{ label: 'Garder cette date (départ à créer)', kind: 'wish', envoi: null, next: false, current: false }]);
      await actionOption(scope, 'wish').click();
      await f.page.waitForFunction(() => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.wish === '2026-11-26');
      assert.deepEqual(commands(f, 'set_colis_departure_wish'), [{ p_colis_id: DOSSIER.ACC001, p_date: '2026-11-26', p_expected_updated_at: f.before.find(item => item.id === DOSSIER.ACC001).updated_at }]);
      assert.deepEqual(await departureText(overview(f)), { text: 'Départ souhaité : jeudi 26 novembre · à créer', envoi: '', wish: '2026-11-26' });
      assert.deepEqual([row(f, DOSSIER.ACC001).envoi_id, row(f, DOSSIER.ACC001).depart_souhaite], [null, '2026-11-26']);
      // « À vérifier » says that this departure is to create, with the link to the field.
      await alertBand(f).getByText('Départ souhaité le jeudi 26 novembre : aucun départ n’est prévu ce jour-là pour la Réunion.', { exact: true }).waitFor();
      await alertBand(f).getByRole('link', { name: 'Choisir ou créer le départ', exact: true }).waitFor();
      // A typed day with a planned departure assigns it, and replaces the wish.
      await openOverviewEditor(f);
      await combobox(scope).fill('15/10');
      assert.deepEqual((await optionList(scope)).map(item => item.envoi || item.kind), [DEPARTURE.reunion15, 'remove']);
      await option(scope, DEPARTURE.reunion15).click();
      await f.page.waitForFunction(id => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.envoi === id, DEPARTURE.reunion15);
      assert.deepEqual([row(f, DOSSIER.ACC001).envoi_id, row(f, DOSSIER.ACC001).depart_souhaite], [DEPARTURE.reunion15, null]);
      assert.equal(commands(f, 'create_departure_for_colis').length, 0);
      assertOnlyDepartureWrites(f);
    }, { role: 'logisticien', permissions: { perm_colis_affecter_envoi: true, perm_envois_voir: true, perm_envois_reaffecter: true, perm_colis_preparer: true } });

    await scenario('a-desired-day-can-be-removed-and-the-field-is-read-only-without-the-right-to-reassign', async f => {
      // Assigning (from no departure) is allowed, reassigning is not.
      await openDossier(f, DOSSIER.ACC006);
      await openOverviewEditor(f);
      assert.deepEqual((await optionList(overview(f))).map(item => item.envoi || item.kind), [...REUNION_PLANNED, 'remove']);
      assert.equal(await actionOption(overview(f), 'remove').innerText(), 'Retirer la date souhaitée', 'A desired day is no assignment.');
      await actionOption(overview(f), 'remove').click();
      await f.page.waitForFunction(() => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.wish === '');
      assert.deepEqual(commands(f, 'set_colis_departure_wish'), [{ p_colis_id: DOSSIER.ACC006, p_date: null, p_expected_updated_at: f.before.find(item => item.id === DOSSIER.ACC006).updated_at }]);
      assert.equal((await departureText(overview(f))).text, 'Départ : à choisir');
      await f.page.getByRole('status').filter({ hasText: 'Date souhaitée retirée' }).waitFor();
      assert.equal(await f.page.getByText('Affectation retirée', { exact: false }).count(), 0);
      // With a departure assigned, changing it needs perm_envois_reaffecter: read-only.
      await openDossier(f, DOSSIER.ACC003);
      assert.equal((await departureText(overview(f))).text, 'Départ : jeudi 8 octobre · Réunion');
      assert.equal(await editDeparture(f).count(), 0);
      await openDossier(f, DOSSIER.ACC008, 'section=expedition');
      assert.equal((await departureText(workspace(f))).text, 'Départ : jeudi 15 octobre · Réunion');
      assert.equal(await combobox(workspace(f)).count(), 0);
      await workspace(f).getByText('L’affectation est modifiable par une personne habilitée à réaffecter les départs.', { exact: true }).waitFor();
      assertOnlyDepartureWrites(f);
    }, { role: 'preparateur', permissions: { perm_colis_affecter_envoi: true, perm_envois_voir: true, perm_colis_preparer: true } });

    await scenario('without-the-assignment-permission-the-departure-is-read-only-everywhere', async f => {
      for (const id of [DOSSIER.ACC001, DOSSIER.ACC003, DOSSIER.ACC006, DOSSIER.ACC008]) {
        await openDossier(f, id);
        await departureLine(overview(f)).waitFor();
        assert.equal(await editDeparture(f).count(), 0, REF[id]);
      }
      await openDossier(f, DOSSIER.ACC008, 'section=expedition');
      assert.equal(await combobox(workspace(f)).count(), 0);
      await workspace(f).getByText('L’affectation est modifiable par une personne habilitée à réaffecter les départs.', { exact: true }).waitFor();
      // « À vérifier › Choisir ou créer le départ » is not offered either.
      await openDossier(f, DOSSIER.ACC006);
      await alertBand(f).getByText('Départ souhaité le jeudi 19 novembre : aucun départ n’est prévu ce jour-là pour la Réunion.', { exact: true }).waitFor();
      assert.equal(await alertBand(f).getByRole('link', { name: 'Choisir ou créer le départ', exact: true }).count(), 0);
      // An edit request in the address opens nothing.
      await f.page.goto(`${base}/colis/${DOSSIER.ACC006}?returnTo=%2Fcolis&modifier=depart`);
      await f.page.waitForURL(url => !url.searchParams.has('modifier'));
      assert.equal(await combobox(overview(f)).count(), 0);
      assertNoBusinessWrite(f);
    }, { role: 'preparateur', permissions: { perm_colis_preparer: true, perm_envois_voir: true, perm_colis_demander_feuvert: true } });

    for (const width of [1440, 390]) await scenario(`a-date-after-the-end-of-the-subscription-is-confirmed-for-an-assignment-and-a-creation-${width}`, async f => {
      // Lucas Hoarau's subscription ends on 18 October.
      await openDossier(f, DOSSIER.ACC012);
      const scope = overview(f);
      const question = f.page.getByRole('dialog', { name: 'Affecter quand même ?', exact: true });
      await openOverviewEditor(f);
      await option(scope, DEPARTURE.reunion22).click();
      await question.getByText('Le départ du jeudi 22 octobre est après la fin de l’abonnement de Lucas (18 octobre).', { exact: true }).waitFor();
      for (const button of await question.getByRole('button').all()) { const box = await button.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44 && box.x >= 0 && box.x + box.width <= width + 1); }
      await question.getByRole('button', { name: 'Annuler', exact: true }).click();await question.waitFor({ state: 'hidden' });
      assert.equal(commands(f, 'assign_colis_departure').length, 0, 'Cancelling writes nothing.');
      assert.equal((await departureText(scope)).text, 'Départ : à choisir');
      // Inside the subscription: saved at once.
      await combobox(scope).click();await option(scope, DEPARTURE.reunion15).click();
      await f.page.waitForFunction(id => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.envoi === id, DEPARTURE.reunion15);
      assert.equal(commands(f, 'assign_colis_departure').length, 1);
      // A creation after the end: the subscription first, then the creation itself.
      await openOverviewEditor(f);await combobox(scope).fill('26/11');
      await actionOption(scope, 'create').click();
      await question.getByText('Le départ du jeudi 26 novembre est après la fin de l’abonnement de Lucas (18 octobre).', { exact: true }).waitFor();
      await question.getByRole('button', { name: 'Affecter quand même', exact: true }).click();
      const creation = f.page.getByRole('dialog', { name: 'Créer le départ du jeudi 26 novembre ?', exact: true });
      await creation.waitFor();
      await noPageOverflow(f);
      await f.page.screenshot({ path: `${output}/create-departure-question-${width}.png` });
      await creation.getByRole('button', { name: 'Créer ce départ et y affecter le dossier', exact: true }).click();
      await creation.waitFor({ state: 'hidden' });
      await f.page.waitForFunction(id => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.envoi !== id, DEPARTURE.reunion15);
      assert.equal(commands(f, 'create_departure_for_colis').length, 1);
      assert.equal((await departureText(scope)).text, 'Départ : jeudi 26 novembre · Réunion');
      await alertBand(f).getByText('Le départ du jeudi 26 novembre est après la fin de son abonnement (18 octobre). Contactez le client.', { exact: true }).waitFor();
      assertOnlyDepartureWrites(f);
    }, { width });

    await scenario('a-desired-day-after-the-end-of-the-subscription-is-confirmed-too', async f => {
      await openDossier(f, DOSSIER.ACC012);
      const scope = overview(f), question = f.page.getByRole('dialog', { name: 'Affecter quand même ?', exact: true });
      await openOverviewEditor(f);await combobox(scope).fill('26/11');
      await actionOption(scope, 'wish').click();
      await question.getByText('Le départ du jeudi 26 novembre est après la fin de l’abonnement de Lucas (18 octobre).', { exact: true }).waitFor();
      await f.page.keyboard.press('Escape');await question.waitFor({ state: 'hidden' });
      assert.equal(commands(f, 'set_colis_departure_wish').length, 0);
      await combobox(scope).click();await actionOption(scope, 'wish').click();
      await question.getByRole('button', { name: 'Affecter quand même', exact: true }).click();
      await f.page.waitForFunction(() => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.wish === '2026-11-26');
      assert.equal(commands(f, 'set_colis_departure_wish').length, 1);
      assertOnlyDepartureWrites(f);
    }, { role: 'logisticien', permissions: { perm_colis_affecter_envoi: true, perm_envois_voir: true, perm_envois_reaffecter: true } });

    for (const [command, label] of [['assign_colis_departure', 'a departure'], ['set_colis_departure_wish', 'a desired day'], ['create_departure_for_colis', 'a creation']]) await scenario(`a-version-conflict-on-${label.replace(/\s/g, '-')}-is-shown-in-the-field-and-changes-nothing`, async f => {
      await openDossier(f, DOSSIER.ACC001);
      // A colleague saved the dossier meanwhile.
      row(f, DOSSIER.ACC001).updated_at = '2026-10-06T07:59:00Z';
      const saved = structuredClone(f.tables.colis), envois = structuredClone(f.tables.envois);
      await openOverviewEditor(f);
      const scope = overview(f);
      if (command === 'assign_colis_departure') await option(scope, DEPARTURE.reunion15).click();
      else {
        await combobox(scope).fill('26/11');
        await actionOption(scope, command === 'create_departure_for_colis' ? 'create' : 'wish').click();
        if (command === 'create_departure_for_colis') await f.page.getByRole('dialog').getByRole('button', { name: 'Créer ce départ et y affecter le dossier', exact: true }).click();
      }
      await fieldError(scope).waitFor();
      assert.equal(await fieldError(scope).innerText(), command === 'assign_colis_departure' ? 'Le dossier a changé. Rechargez-le.' : 'Le dossier a changé. Actualisez avant de réessayer.');
      assert.equal(commands(f, command).length, 1);
      assert.deepEqual(f.tables.colis, saved, 'Nothing is written.');
      assert.deepEqual(f.tables.envois, envois);
      assert.equal((await departureText(scope)).text, 'Départ : à choisir', 'Nothing is shown as saved.');
      await combobox(scope).waitFor();
      await f.page.screenshot({ path: `${output}/conflict-${command}-1440.png` });
      assertOnlyDepartureWrites(f);
    }, { role: command === 'set_colis_departure_wish' ? 'logisticien' : 'directeur', permissions: command === 'set_colis_departure_wish' ? { perm_colis_affecter_envoi: true, perm_envois_voir: true } : null });

    await scenario('a-departure-without-loading-closing-stays-offered-and-assignable-after-its-habitual-wednesday', async f => {
      // Leaving today (Tuesday 6 October) without a loading closing: its habitual Wednesday (30 September, 17 h) has
      // passed, yet the server takes dossiers until its day (guard_colis_departure), and so does the field.
      const today = uuid('d2000000', 8);
      addDepartures(f, extraDeparture(today, 'ENV-2026-100', '2026-10-06', '974'));
      await openDossier(f, DOSSIER.ACC001);
      await openOverviewEditor(f);
      const scope = overview(f);
      assert.deepEqual((await optionList(scope)).slice(0, 2), [
        { label: 'mardi 6 octobre · clôture habituelle mercredi 30 septembre, 17 h', kind: 'departure', envoi: today, next: true, current: false },
        { label: OPTION[DEPARTURE.reunion8], kind: 'departure', envoi: DEPARTURE.reunion8, next: false, current: false },
      ]);
      // Its day typed: the departure itself, never « Aucun départ prévu ».
      await combobox(scope).fill('6/10');
      assert.deepEqual((await optionList(scope)).map(item => item.envoi), [today]);
      assert.equal(await missingLine(scope).count(), 0);
      await option(scope, today).click();
      await f.page.waitForFunction(id => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.envoi === id, today);
      assert.deepEqual(commands(f, 'assign_colis_departure'), [{ p_colis_id: DOSSIER.ACC001, p_envoi_id: today, p_expected_updated_at: f.before.find(item => item.id === DOSSIER.ACC001).updated_at }]);
      assert.equal(row(f, DOSSIER.ACC001).envoi_id, today, 'The server accepted it.');
      assert.equal((await departureText(scope)).text, 'Départ : mardi 6 octobre · Réunion');
      // The paid dossier's expedition task offers it too, first.
      await openDossier(f, DOSSIER.ACC008, 'section=expedition');
      await combobox(workspace(f)).click();await listbox(workspace(f)).waitFor();
      assert.deepEqual((await optionList(workspace(f))).slice(0, 2).map(item => [item.envoi, item.next]), [[today, true], [DEPARTURE.reunion8, false]]);
      assert.equal(await workspace(f).getByText(/Aucun départ ouvert compatible/).count(), 0);
      await combobox(workspace(f)).press('Escape');
      assertOnlyDepartureWrites(f);
    });

    for (const width of [1440, 390]) await scenario(`a-departure-closed-or-gone-is-never-offered-and-its-day-says-so-${width}`, async f => {
      const closed = uuid('d2000000', 9), gone = uuid('d2000000', 10);
      addDepartures(f,
        // Its loading closed this morning at 9 h (Paris), although its habitual Wednesday is still ahead.
        extraDeparture(closed, 'ENV-2026-107', '2026-10-13', '974', { loading_closes_at: '2026-10-06T07:00:00Z' }),
        // Loaded and gone ahead of its planned day.
        extraDeparture(gone, 'ENV-2026-108', '2026-10-20', '974', { statut: 'parti', departed_at: '2026-10-05T10:00:00Z', manifest_version: 1 }));
      await openDossier(f, DOSSIER.ACC001);
      await openOverviewEditor(f);
      const scope = overview(f);
      assert.deepEqual((await optionList(scope)).map(item => item.envoi), REUNION_PLANNED, 'Neither is offered.');
      for (const [typed, text] of [
        ['13/10', 'Le départ du mardi 13 octobre pour la Réunion est clôturé : choisissez un autre jour.'],
        ['mardi 20', 'Le départ du mardi 20 octobre pour la Réunion est déjà parti : choisissez un autre jour.'],
      ]) {
        await combobox(scope).fill(typed);
        await missingLine(scope).getByText(text, { exact: false }).waitFor();
        assert.equal(await missingLine(scope).innerText(), text);
        // That day has its departure: nothing to create, no day to keep, never « Aucun départ prévu ».
        assert.equal(await listbox(scope).count(), 0, typed);
        assert.equal(await scope.getByText(/Aucun départ prévu/).count(), 0, typed);
      }
      await noPageOverflow(f);await axe(f);
      await scope.screenshot({ path: `${output}/field-closed-day-${width}.png` });
      assertNoBusinessWrite(f);
    }, { width });

    await scenario('replacing-an-assigned-departure-by-a-desired-day-is-confirmed-first', async f => {
      await openDossier(f, DOSSIER.ACC003);
      const scope = overview(f);
      await openOverviewEditor(f);
      await combobox(scope).fill('26/11');
      assert.deepEqual(await optionList(scope), [
        { label: 'Remplacer le départ par cette date (départ à créer)', kind: 'wish', envoi: null, next: false, current: false },
        { label: 'Retirer le départ', kind: 'remove', envoi: null, next: false, current: false },
      ]);
      const dialog = f.page.getByRole('dialog', { name: 'Remplacer le départ du jeudi 8 octobre ?', exact: true });
      await actionOption(scope, 'wish').click();
      await dialog.getByText('Le dossier EXP-ACC003 quittera le départ du jeudi 8 octobre (ENV-2026-101). Il gardera la date du jeudi 26 novembre, dont le départ reste à créer. Aucun message n’est envoyé au client.', { exact: true }).waitFor();
      await f.page.screenshot({ path: `${output}/replace-departure-question-1440.png` });
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();await dialog.waitFor({ state: 'hidden' });
      assert.equal(commands(f, 'set_colis_departure_wish').length, 0, 'Cancelling keeps the departure.');
      assert.deepEqual(await departureText(scope), { text: 'Départ : jeudi 8 octobre · Réunion', envoi: DEPARTURE.reunion8, wish: '' });
      await combobox(scope).click();await actionOption(scope, 'wish').click();
      await dialog.getByRole('button', { name: 'Remplacer le départ', exact: true }).click();await dialog.waitFor({ state: 'hidden' });
      await f.page.waitForFunction(() => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.wish === '2026-11-26');
      assert.deepEqual(commands(f, 'set_colis_departure_wish'), [{ p_colis_id: DOSSIER.ACC003, p_date: '2026-11-26', p_expected_updated_at: f.before.find(item => item.id === DOSSIER.ACC003).updated_at }]);
      assert.deepEqual(await departureText(scope), { text: 'Départ souhaité : jeudi 26 novembre · à créer', envoi: '', wish: '2026-11-26' });
      assert.deepEqual([row(f, DOSSIER.ACC003).envoi_id, row(f, DOSSIER.ACC003).depart_souhaite], [null, '2026-11-26']);
      assertOnlyDepartureWrites(f);
    }, { role: 'logisticien', permissions: { perm_colis_affecter_envoi: true, perm_envois_voir: true, perm_envois_reaffecter: true } });

    for (const width of [1440, 390]) await scenario(`a-desired-day-with-its-departure-planned-reads-to-assign-and-a-past-one-reads-past-${width}`, async f => {
      // 19 November is now planned for the Réunion; EXP-ACC012 kept 1 October, which has passed.
      const nov19 = uuid('d2000000', 11);
      addDepartures(f, extraDeparture(nov19, 'ENV-2026-109', '2026-11-19', '974'));
      row(f, DOSSIER.ACC012).depart_souhaite = '2026-10-01';
      f.before = structuredClone(f.tables.colis);
      await openDossier(f, DOSSIER.ACC006);
      assert.equal((await departureText(overview(f))).text, 'Départ souhaité : jeudi 19 novembre · départ prévu, à affecter');
      // « À vérifier » asks to assign it (the band is rendered before counting what it does not say).
      await alertBand(f).getByText(TO_ASSIGN_19, { exact: true }).waitFor();
      await alertBand(f).getByRole('link', { name: 'Affecter au départ', exact: true }).waitFor();
      assert.equal(await alertBand(f).getByText(/^Départ souhaité le/).count(), 0, 'Its departure is planned: nothing to create.');
      await openOverviewEditor(f);
      assert.ok((await optionList(overview(f))).some(item => item.envoi === nov19), 'Its departure is offered.');
      await combobox(overview(f)).press('Escape');
      await openDossier(f, DOSSIER.ACC012);
      assert.equal((await departureText(overview(f))).text, 'Départ souhaité : jeudi 1er octobre · date passée');
      const band = alertBand(f);
      if (width < 640 && await band.locator('summary').count()) await band.locator('summary').click();
      await band.getByText('Départ souhaité le jeudi 1er octobre : cette date est passée.', { exact: true }).waitFor();
      await band.getByRole('link', { name: 'Choisir un autre départ', exact: true }).waitFor();
      // The list column and the departure groups say the same.
      await f.page.goto(`${base}/colis?table=departures`);
      const cell = async id => (await f.page.locator(`[data-dossier-row="${id}"]:visible`).locator('[data-column="departure"]').last().innerText()).replace(/\s+/g, ' ').trim().replace(/^Départ prévu /, '');
      await f.page.locator(`[data-dossier-row="${DOSSIER.ACC006}"]:visible`).waitFor();
      assert.equal(await cell(DOSSIER.ACC006), 'Souhaité le 19/11/2026 · départ prévu, à affecter');
      assert.equal(await cell(DOSSIER.ACC012), 'Souhaité le 01/10/2026 · date passée');
      for (const [key, title, ref] of [['wish:974:2026-11-19', 'Départ souhaité le jeudi 19 novembre · Réunion', 'Départ prévu, à affecter'], ['wish:974:2026-10-01', 'Départ souhaité le jeudi 1er octobre · Réunion', 'Date passée']]) {
        const group = f.page.locator(`[data-dossier-group="${key}"]:visible`);
        await group.waitFor();
        assert.equal((await group.locator('.dossier-group-title').innerText()).trim(), title, key);
        assert.equal((await group.locator('.dossier-group-ref').innerText()).trim(), ref, key);
      }
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/list-wish-states-${width}.png`, fullPage: true });
      assertNoBusinessWrite(f);
    }, { width });

    await scenario('a-write-in-flight-keeps-the-field-open-and-then-shows-the-refusal', async f => {
      let release, pending = 0;
      const answer = new Promise(resolve => { release = resolve; });
      await f.page.route('**/rest/v1/rpc/assign_colis_departure', async route => {
        pending += 1;
        await answer;
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '40001', message: 'Le dossier a changé. Rechargez-le.' }) });
      });
      await openDossier(f, DOSSIER.ACC001);
      await openOverviewEditor(f);
      const scope = overview(f);
      await option(scope, DEPARTURE.reunion15).click();
      await f.page.waitForFunction(() => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-picker')?.getAttribute('aria-busy') === 'true');
      assert.equal(pending, 1);
      // Escape, « Modifier » and « Annuler » cannot close the field while the server answers.
      await combobox(scope).press('Escape');
      assert.equal(await combobox(scope).count(), 1, 'Escape keeps the field open during the write.');
      assert.equal(await editDeparture(f).isDisabled(), true);
      assert.equal(await scope.getByRole('button', { name: 'Annuler', exact: true }).isDisabled(), true);
      release();
      await fieldError(scope).waitFor();
      assert.equal(await fieldError(scope).innerText(), 'Le dossier a changé. Rechargez-le.', 'The refusal shows in the field.');
      assert.equal((await departureText(scope)).text, 'Départ : à choisir', 'Nothing is shown as saved.');
      assert.equal(await editDeparture(f).isDisabled(), false);
      // Answered, Escape closes it again.
      await combobox(scope).press('Escape');await combobox(scope).waitFor({ state: 'detached' });
      assert.deepEqual(f.tables.colis, f.before, 'Nothing is written.');
    });

    for (const width of [1440, 390]) await scenario(`the-open-field-follows-the-heading-actions-in-the-focus-order-${width}`, async f => {
      await openDossier(f, DOSSIER.ACC001);
      await openOverviewEditor(f);
      const layout = await f.page.evaluate(() => {
        const heading = document.querySelector('[data-testid="dossier-overview"] .dossier-overview-heading');
        const picker = heading.querySelector('.dossier-departure-picker');
        const history = heading.querySelector('[aria-label="Consulter l’historique du dossier"]');
        return { order: getComputedStyle(picker).order, follows: Boolean(history.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING),
          below: picker.getBoundingClientRect().top >= history.getBoundingClientRect().bottom - 1 };
      });
      assert.deepEqual(layout, { order: '0', follows: true, below: true }, 'No CSS reordering: in the DOM as on screen, the field follows the heading actions.');
      // Shift+Tab from the field goes back through « Annuler », then the last heading action; Tab returns.
      await combobox(overview(f)).focus();
      await f.page.keyboard.press('Shift+Tab');
      assert.equal(await f.page.evaluate(() => document.activeElement?.textContent.trim()), 'Annuler');
      await f.page.keyboard.press('Shift+Tab');
      assert.equal(await f.page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Consulter l’historique du dossier');
      await f.page.keyboard.press('Tab');await f.page.keyboard.press('Tab');
      assert.equal(await f.page.evaluate(() => document.activeElement?.getAttribute('role')), 'combobox');
      assertNoBusinessWrite(f);
    }, { width });

    for (const width of [1440, 390]) await scenario(`the-overview-departure-reads-only-while-a-colleague-holds-the-expedition-task-${width}`, async f => {
      // EXP-ACC008 is paid: its departure belongs to the expedition task, which a colleague holds.
      Object.assign(f.tables.staff_work_actions.find(action => action.colis_id === DOSSIER.ACC008 && action.kind === 'departure'), { state: 'in_progress', assignee_id: uuid('a2000000', 9) });
      await openDossier(f, DOSSIER.ACC008, 'section=expedition');
      // The task field reads only, the colleague named above it, never a missing permission.
      await workspace(f).getByText(/s’occupe de cette tâche/).first().waitFor();
      await departureLine(workspace(f)).waitFor();
      assert.equal(await combobox(workspace(f)).count(), 0);
      assert.equal(await workspace(f).getByText(/personne habilitée|demande l’accès aux départs/).count(), 0);
      // The overview says the same: no « Modifier », and why.
      assert.equal(await editDeparture(f).count(), 0);
      assert.equal((await overview(f).locator('.dossier-departure-locked').innerText()).trim(), 'Membre de l’équipe s’occupe de l’expédition.');
      await noPageOverflow(f);
      await f.page.screenshot({ path: `${output}/departure-held-by-colleague-${width}.png`, fullPage: true });
      // From another step of the dossier too, and an edit request in the address opens nothing.
      await f.page.goto(`${base}/colis/${DOSSIER.ACC008}?returnTo=%2Fcolis&section=reception&modifier=depart`);
      await f.page.waitForURL(url => !url.searchParams.has('modifier'));
      await departureLine(overview(f)).waitFor();
      assert.equal(await combobox(overview(f)).count(), 0);
      assert.equal(await editDeparture(f).count(), 0);
      await noPageOverflow(f);await axe(f);
      assertNoBusinessWrite(f);
    }, { width });

    await scenario('the-relance-before-the-closing-is-work-to-take-in-the-list', async f => {
      await f.page.goto(`${base}/colis`);
      const item = f.page.locator(`[data-dossier-row="${DOSSIER.ACC003}"]:visible`);
      await item.getByText('Relancer le client avant la clôture du départ', { exact: true }).waitFor();
      await item.locator('td[data-column="action"]').getByRole('button', { name: 'Je m’en occupe', exact: true }).waitFor();
      const ask = f.page.locator(`[data-dossier-row="${DOSSIER.ACC002}"]:visible`);
      await ask.getByText('Demander l’accord avant la clôture du départ', { exact: true }).waitFor();
      // The voluntary wait stays a waiting task.
      const waiting = f.page.locator(`[data-dossier-row="${DOSSIER.ACC004}"]:visible`);
      assert.equal(await waiting.locator('td[data-column="action"]').getByRole('button', { name: 'Je m’en occupe', exact: true }).count(), 0);
      assertNoBusinessWrite(f);
    });

    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`the-departure-field-is-readable-and-accessible-${width}-${theme}`, async f => {
      await openDossier(f, DOSSIER.ACC006);await waitTheme(f, theme);
      await f.page.screenshot({ path: `${output}/field-wish-${width}-${theme}.png`, fullPage: true });
      await openOverviewEditor(f);
      const scope = overview(f);
      for (const target of [editDeparture(f), combobox(scope), ...await listbox(scope).getByRole('option').all()]) {
        const box = await target.boundingBox();
        assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, '44px targets inside the screen.');
      }
      for (const part of await textStyles(scope.locator('.dossier-departure-text, .dossier-departure-label, .dossier-departure-hint, .dossier-departure-option-text, .dossier-departure-badge'))) {
        assert.ok(part.size >= 12, `${part.text}: ${part.size}px`); assert.ok(part.ratio >= 4.5, `${part.text}: ${part.ratio.toFixed(2)}:1`);
      }
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/field-open-${width}-${theme}.png`, fullPage: true });
      await combobox(scope).fill('26/11');await missingLine(scope).waitFor();
      await noPageOverflow(f);await axe(f);
      await scope.screenshot({ path: `${output}/field-typed-day-${width}-${theme}.png` });
      // The expedition task shows the same field, open.
      await openDossier(f, DOSSIER.ACC008, 'section=expedition');await waitTheme(f, theme);
      await combobox(workspace(f)).click();await listbox(workspace(f)).waitFor();
      for (const target of await listbox(workspace(f)).getByRole('option').all()) { const box = await target.boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1); }
      await noPageOverflow(f);await axe(f);
      await workspace(f).screenshot({ path: `${output}/task-field-${width}-${theme}.png` });
      assertNoBusinessWrite(f);
    }, { width, theme });

    // ── B. The list: the desired day and its group ──────────────────────────
    for (const width of [1440, 390]) await scenario(`the-list-shows-the-desired-day-and-groups-it-as-a-departure-to-create-${width}`, async f => {
      await f.page.goto(`${base}/colis?table=departures`);
      const item = f.page.locator(`[data-dossier-row="${DOSSIER.ACC006}"]:visible`);
      await item.waitFor();
      assert.equal((await item.locator('[data-column="departure"]').last().innerText()).replace(/\s+/g, ' ').trim().replace(/^Départ prévu /, ''), 'Souhaité le 19/11/2026 · à créer');
      // « Départs » groups by departure: the desired day has its own group, after the planned departures of October.
      const group = f.page.locator(`[data-dossier-group="wish:974:2026-11-19"]:visible`);
      await group.waitFor();
      assert.equal((await group.locator('.dossier-group-title').innerText()).trim(), 'Départ à créer du jeudi 19 novembre · Réunion');
      assert.equal((await group.locator('.dossier-group-ref').innerText()).trim(), 'À créer');
      assert.equal((await group.locator('.dossier-group-count').innerText()).trim(), '1 dossier');
      const keys = await f.page.locator('[data-dossier-group]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.dossierGroup));
      // Upcoming by day (Guadeloupe before Réunion on 15 October), the desired day on 19 November, then the past, then « Sans départ ».
      assert.deepEqual(keys, [DEPARTURE.reunion8, DEPARTURE.guadeloupe15, DEPARTURE.reunion15, 'wish:974:2026-11-19', DEPARTURE.reunion1, 'none']);
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/list-wish-group-${width}.png`, fullPage: true });
      assertNoBusinessWrite(f);
    }, { width });

    await scenario('the-departure-column-sorts-a-desired-day-on-that-day', async f => {
      await f.page.goto(`${base}/colis?table=departures&view=none&sort=departure&dir=asc`);
      await f.page.locator('[data-dossier-row]:visible').first().waitFor();
      const order = await f.page.locator('tr[data-dossier-row]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.dossierRow));
      const position = id => order.indexOf(id);
      assert.ok(position(DOSSIER.ACC008) < position(DOSSIER.ACC006) && position(DOSSIER.ACC002) < position(DOSSIER.ACC008), 'The 19 November wish comes after the 15 October departure, after 8 October.');
      assert.ok(position(DOSSIER.ACC006) < position(DOSSIER.ACC001), 'Dossiers without a departure or a day come last.');
      assertNoBusinessWrite(f);
    });

    // ── C. « À vérifier »: departure to create, consent before the closing ──
    await scenario('departure-to-create-opens-the-departure-field-of-the-dossier', async f => {
      await openDossier(f, DOSSIER.ACC006);
      const band = alertBand(f);
      await band.getByText('Départ souhaité le jeudi 19 novembre : aucun départ n’est prévu ce jour-là pour la Réunion.', { exact: true }).waitFor();
      const link = band.getByRole('link', { name: 'Choisir ou créer le départ', exact: true });
      const href = new URL(await link.getAttribute('href'), base);
      assert.equal(href.pathname, `/colis/${DOSSIER.ACC006}`);
      assert.equal(href.searchParams.get('modifier'), 'depart');
      assert.equal(href.searchParams.get('returnTo'), '/colis');
      await link.click();
      // The field opens with its suggestions, then the request leaves the address.
      await combobox(overview(f)).waitFor();await listbox(overview(f)).waitFor();
      await f.page.waitForURL(url => !url.searchParams.has('modifier') && url.searchParams.get('returnTo') === '/colis');
      await f.page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'combobox');
      // From the Conversation tab too: the link goes back to the Colis tab.
      await f.page.getByRole('tab', { name: /^Conversation/ }).click();
      await f.page.waitForURL(url => url.searchParams.get('onglet') === 'conversation');
      await band.getByRole('link', { name: 'Choisir ou créer le départ', exact: true }).click();
      await f.page.waitForURL(url => !url.searchParams.has('onglet'));
      await combobox(overview(f)).waitFor();
      assertNoBusinessWrite(f);
    });

    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`consent-before-the-closing-leads-to-the-accord-task-${width}-${theme}`, async f => {
      for (const [id, label] of [[DOSSIER.ACC003, 'Relancer le client'], [DOSSIER.ACC002, 'Demander l’accord']]) {
        await openDossier(f, id);await waitTheme(f, theme);
        const band = alertBand(f);
        if (width < 640 && await band.locator('summary').count()) await band.locator('summary').click();
        await band.getByText('Accord du client à obtenir avant mercredi 7 octobre, 17 h (clôture habituelle du départ du jeudi 8 octobre).', { exact: true }).waitFor();
        const link = band.getByRole('link', { name: label, exact: true });
        const box = await link.boundingBox();
        assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, 'A 44px link inside the screen.');
        await noPageOverflow(f);await axe(f);
        await f.page.screenshot({ path: `${output}/consent-before-cutoff-${REF[id]}-${width}-${theme}.png`, fullPage: true });
        await link.click();
        await f.page.waitForURL(url => url.searchParams.get('section') === 'accord' && url.hash === '#dossier-work' && url.searchParams.get('returnTo') === '/colis');
        await workspace(f).getByRole('heading', { name: id === DOSSIER.ACC003 ? 'En attente du client' : 'Demander l’accord du client', exact: true }).waitFor();
      }
      // The list mark names the line too.
      await f.page.goto(`${base}/colis`);
      await f.page.locator(`[data-dossier-row="${DOSSIER.ACC003}"]:visible`).getByRole('img', { name: /Accord du client à obtenir avant mercredi 7 octobre, 17 h/ }).waitFor();
      // The voluntary wait and the departure closing later are silent.
      for (const id of [DOSSIER.ACC004, DOSSIER.ACC007]) { await openDossier(f, id);assert.equal(await alertBand(f).getByText(/Accord du client à obtenir/).count(), 0, REF[id]); }
      assertNoBusinessWrite(f);
    }, { width, theme });

    await scenario('the-alert-links-follow-the-permissions', async f => {
      await openDossier(f, DOSSIER.ACC003);
      await alertBand(f).getByText(/^Accord du client à obtenir avant/).waitFor();
      assert.equal(await alertBand(f).getByRole('link', { name: 'Relancer le client', exact: true }).count(), 0, 'Without perm_colis_demander_feuvert no link.');
      // Creating departures without the right to assign one: the Départ field does not open, so no link leads to it.
      await openDossier(f, DOSSIER.ACC006);
      await alertBand(f).getByText('Départ souhaité le jeudi 19 novembre : aucun départ n’est prévu ce jour-là pour la Réunion.', { exact: true }).waitFor();
      assert.equal(await alertBand(f).getByRole('link', { name: 'Choisir ou créer le départ', exact: true }).count(), 0, 'The link follows the field’s own rule.');
      assert.equal(await editDeparture(f).count(), 0);
      assertNoBusinessWrite(f);
    }, { role: 'preparateur', permissions: { perm_colis_preparer: true, perm_envois_creer: true, perm_envois_voir: true } });

    await scenario('the-departure-link-is-offered-to-whoever-the-field-opens-for', async f => {
      await openDossier(f, DOSSIER.ACC006);
      const link = alertBand(f).getByRole('link', { name: 'Choisir ou créer le départ', exact: true });
      await link.click();
      await combobox(overview(f)).waitFor();await listbox(overview(f)).waitFor();
      await f.page.waitForURL(url => !url.searchParams.has('modifier'));
      assertNoBusinessWrite(f);
    }, { role: 'logisticien', permissions: { perm_colis_affecter_envoi: true, perm_envois_voir: true } });

    // ── C'. Consent follow-up, measures first, the departure planned on the desired day (2026-10-07) ──
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`a-request-or-relance-is-followed-up-24-hours-then-the-band-relances-on-an-idle-page-${width}-${theme}`, async f => {
      // EXP-ACC003: a relance sent 23 h 50 ago is still followed up: no relance before its 24 hours end, at 10 h 10.
      f.tables.messages.push({ id: uuid('b2000000', 300), colis_id: DOSSIER.ACC003, type: 'staff', auteur_nom: 'Camille', texte: 'Bonjour, votre accord est toujours attendu.', canal: 'telegram', template: 'relance_feu_vert', statut: 'envoye', lu: true, created_at: '2026-10-05T08:10:00Z' });
      await openDossier(f, DOSSIER.ACC003);await waitTheme(f, theme);
      await departureShown(f, 'Départ : jeudi 8 octobre · Réunion');
      assert.equal(await alertBand(f).count(), 0, 'Followed up: nothing to check.');
      await f.page.screenshot({ path: `${output}/followed-up-${width}-${theme}.png`, fullPage: true });
      // The page stays open: once the 24 hours have passed, before the closing, the minute clock brings the line back.
      await idleUntil(f, '2026-10-06T08:10:00Z');
      const band = alertBand(f);
      await band.getByText(CUTOFF_8, { exact: true }).waitFor();
      const link = band.getByRole('link', { name: 'Relancer le client', exact: true });
      const box = await link.boundingBox();
      assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, 'A 44px link inside the screen.');
      for (const part of await textStyles(band.locator('.dossier-alerts-title, .dossier-alerts-text, .dossier-alerts-action'))) {
        assert.ok(part.size >= 12, `${part.text}: ${part.size}px`); assert.ok(part.ratio >= 4.5, `${part.text}: ${part.ratio.toFixed(2)}:1`);
      }
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/relance-back-${width}-${theme}.png`, fullPage: true });
      assertNoBusinessWrite(f);
    }, { width, theme });

    await scenario('a-failed-relance-is-relanced-and-the-band-follows-the-relance-window-on-an-idle-page', async f => {
      // EXP-ACC003: the relance of 30 minutes ago failed: it did not reach the client, the relance is due at once.
      f.tables.messages.push({ id: uuid('b2000000', 301), colis_id: DOSSIER.ACC003, type: 'staff', auteur_nom: 'Camille', texte: 'Bonjour, votre accord est toujours attendu.', canal: 'telegram', template: 'relance_feu_vert', statut: 'echec', lu: true, created_at: '2026-10-06T07:30:00Z' });
      // EXP-ACC012 now leaves on Friday 9 October, its loading closing on Thursday 8 at 10 h 10 (Paris): the relance
      // window opens today at 10 h 10. EXP-ACC010 (received) leaves for the Guadeloupe on 8 October, its loading
      // closing today at 10 h 10: the window closes then.
      const early = uuid('d2000000', 13), closing = uuid('d2000000', 14);
      addDepartures(f, extraDeparture(early, 'ENV-2026-111', '2026-10-09', '974', { loading_closes_at: '2026-10-08T08:10:00Z' }),
        extraDeparture(closing, 'ENV-2026-112', '2026-10-08', '971', { loading_closes_at: '2026-10-06T08:10:00Z' }));
      row(f, DOSSIER.ACC012).envoi_id = early;row(f, DOSSIER.ACC010).envoi_id = closing;f.before = structuredClone(f.tables.colis);
      await openDossier(f, DOSSIER.ACC003);
      assert.deepEqual((await bandLines(f)).map(({ text, link }) => [text, link?.label]), [[CUTOFF_8, 'Relancer le client']]);
      // Left open, each page shows the window opening, then closing, through its minute clock alone.
      await openDossier(f, DOSSIER.ACC012);
      await departureShown(f, 'Départ : vendredi 9 octobre · Réunion');
      assert.equal(await alertBand(f).count(), 0, 'The window opens in 10 minutes: nothing to check yet.');
      await idleUntil(f, '2026-10-06T08:10:00Z');
      await alertBand(f).getByText('Accord du client à obtenir avant jeudi 8 octobre, 10 h 10 (clôture du départ du vendredi 9 octobre).', { exact: true }).waitFor();
      await f.page.clock.setFixedTime(NOW);
      await openDossier(f, DOSSIER.ACC010);
      await alertBand(f).getByText('Cartons à mesurer puis accord du client à demander avant mardi 6 octobre, 10 h 10 (clôture du départ du jeudi 8 octobre).', { exact: true }).waitFor();
      await idleUntil(f, '2026-10-06T08:10:00Z');
      await alertBand(f).waitFor({ state: 'detached' });
      assertNoBusinessWrite(f);
    });

    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`received-cartons-are-measured-before-the-consent-${width}-${theme}`, async f => {
      // EXP-ACC001 (received, not measured) now leaves on 8 October: its consent closes within 48 hours.
      row(f, DOSSIER.ACC001).envoi_id = DEPARTURE.reunion8;f.before = structuredClone(f.tables.colis);
      await openDossier(f, DOSSIER.ACC001);await waitTheme(f, theme);
      const displayed = new URL(f.page.url()), reception = new URLSearchParams(displayed.search);
      reception.set('section', 'reception');
      assert.deepEqual(await bandLines(f), [{ text: MEASURE_CUTOFF_8, link: { label: 'Mesurer les cartons', href: `${displayed.pathname}?${reception}#dossier-work` } }]);
      const link = alertBand(f).getByRole('link', { name: 'Mesurer les cartons', exact: true });
      const box = await link.boundingBox();
      assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, 'A 44px link inside the screen.');
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/measure-before-cutoff-${width}-${theme}.png`, fullPage: true });
      // The link opens the reception task, where the cartons are measured, with the way back to the list.
      await link.click();
      await f.page.waitForURL(url => url.searchParams.get('section') === 'reception' && url.hash === '#dossier-work' && url.searchParams.get('returnTo') === '/colis');
      await workspace(f).getByRole('button', { name: 'Enregistrer les mesures de réception', exact: true }).waitFor();
      // The list mark names the same line.
      await f.page.goto(`${base}/colis`);
      await f.page.locator(`[data-dossier-row="${DOSSIER.ACC001}"]:visible`).getByRole('img', { name: `À vérifier : ${MEASURE_CUTOFF_8}`, exact: true }).waitFor();
      assertNoBusinessWrite(f);
    }, { width, theme });

    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`a-departure-planned-on-the-desired-day-is-to-assign-and-closes-the-consent-${width}-${theme}`, async f => {
      // 19 November is now planned for the Réunion, its own loading closing on Wednesday 7 October at 9 h (Paris).
      const nov19 = uuid('d2000000', 12);
      addDepartures(f, extraDeparture(nov19, 'ENV-2026-110', '2026-11-19', '974', { loading_closes_at: '2026-10-07T07:00:00Z' }));
      await openDossier(f, DOSSIER.ACC006);await waitTheme(f, theme);
      const consent = 'Accord du client à obtenir avant mercredi 7 octobre, 9 h (clôture du départ du jeudi 19 novembre).';
      const band = alertBand(f);
      if (width < 640) {
        // Two lines fold behind « À vérifier · 2 points »; the heading stays outside the summary (a button).
        const fold = band.locator('summary');
        await fold.getByText('2 points', { exact: true }).waitFor();
        assert.equal(await band.locator('summary h2, summary [role="heading"]').count(), 0, 'No heading inside the summary.');
        assert.equal(await band.getByRole('heading', { level: 2, name: 'À vérifier', exact: true }).count(), 1, 'The band keeps its heading.');
        assert.ok((await band.boundingBox()).height <= 72, 'Folded, the band keeps one line above the dossier.');
        const summary = await fold.boundingBox();
        assert.ok(summary.height >= 44, 'The fold is a 44px target.');
        await fold.click();
      } else {
        await band.getByRole('heading', { level: 2, name: 'À vérifier', exact: true }).waitFor();
        assert.equal(await band.locator('summary').count(), 0);
      }
      const displayed = new URL(f.page.url()), accord = new URLSearchParams(displayed.search), field = new URLSearchParams(displayed.search);
      accord.set('section', 'accord');field.set('modifier', 'depart');
      assert.deepEqual(await bandLines(f), [
        { text: consent, link: { label: 'Demander l’accord', href: `${displayed.pathname}?${accord}#dossier-work` } },
        { text: TO_ASSIGN_19, link: { label: 'Affecter au départ', href: `${displayed.pathname}?${field}` } },
      ]);
      for (const target of await band.getByRole('link').all()) { const box = await target.boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, 'A 44px link inside the screen.'); }
      for (const part of await textStyles(band.locator('.dossier-alerts-title, .dossier-alerts-count, .dossier-alerts-text, .dossier-alerts-action'))) {
        assert.ok(part.size >= 12, `${part.text}: ${part.size}px`); assert.ok(part.ratio >= 4.5, `${part.text}: ${part.ratio.toFixed(2)}:1`);
      }
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/departure-to-assign-${width}-${theme}.png`, fullPage: true });
      // « Affecter au départ » opens the Départ field; choosing that departure assigns it and the line goes.
      await band.getByRole('link', { name: 'Affecter au départ', exact: true }).click();
      await combobox(overview(f)).waitFor();await listbox(overview(f)).waitFor();
      await f.page.waitForURL(url => !url.searchParams.has('modifier'));
      await option(overview(f), nov19).click();
      await f.page.waitForFunction(id => document.querySelector('[data-testid="dossier-overview"] .dossier-departure-line')?.dataset.envoi === id, nov19);
      assert.deepEqual(commands(f, 'assign_colis_departure'), [{ p_colis_id: DOSSIER.ACC006, p_envoi_id: nov19, p_expected_updated_at: f.before.find(item => item.id === DOSSIER.ACC006).updated_at }]);
      await band.getByText(TO_ASSIGN_19, { exact: true }).waitFor({ state: 'detached' });
      // Assigned, its closing is the same: the consent line stays.
      await band.getByText(consent, { exact: true }).waitFor();
      assertOnlyDepartureWrites(f);
    }, { width, theme });

    await scenario('the-measure-and-assign-links-follow-the-permissions', async f => {
      row(f, DOSSIER.ACC001).envoi_id = DEPARTURE.reunion8;f.before = structuredClone(f.tables.colis);
      addDepartures(f, extraDeparture(uuid('d2000000', 12), 'ENV-2026-110', '2026-11-19', '974'));
      // Measuring without asking for consent or assigning departures: the measure link only.
      await openDossier(f, DOSSIER.ACC001);
      assert.deepEqual((await bandLines(f)).map(({ text, link }) => [text, link?.label]), [[MEASURE_CUTOFF_8, 'Mesurer les cartons']]);
      await openDossier(f, DOSSIER.ACC002);
      assert.deepEqual((await bandLines(f)).map(({ text, link }) => [text, link?.label]), [[CUTOFF_8, undefined]]);
      await openDossier(f, DOSSIER.ACC006);
      assert.deepEqual((await bandLines(f)).map(({ text, link }) => [text, link?.label]), [[TO_ASSIGN_19, undefined]]);
      assertNoBusinessWrite(f);
    }, { role: 'preparateur', permissions: { perm_colis_preparer: true, perm_colis_mesurer: true, perm_envois_voir: true } });

    // ── C''. An incomplete client record (decided on 2026-10-07): every missing field, the first one opened ──
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) await scenario(`an-incomplete-client-record-lists-every-missing-field-and-opens-the-first-${width}-${theme}`, async f => {
      // Paul Grondin has no téléphone nor address any more; Nadia Jacoby only misses her address.
      Object.assign(f.tables.clients.find(client => client.id === CLIENT.grondin), { tel: null, adresse_ligne1: null });
      Object.assign(f.tables.clients.find(client => client.id === CLIENT.jacoby), { adresse_ligne1: '' });
      // EXP-ACC006 (desired day 19 November, no departure that day): two lines, folded on a phone.
      await openDossier(f, DOSSIER.ACC006);await waitTheme(f, theme);
      const band = alertBand(f);
      if (width < 640) {
        await band.locator('summary').getByText('2 points', { exact: true }).waitFor();
        await band.locator('summary').click();
      }
      const displayed = new URL(f.page.url()), from = displayed.pathname + displayed.search, field = new URLSearchParams(displayed.search);
      field.set('modifier', 'depart');
      assert.deepEqual(await bandLines(f), [
        { text: 'Fiche client incomplète : il manque le téléphone et l’adresse.', link: { label: 'Compléter la fiche', href: `/clients/${CLIENT.grondin}?${new URLSearchParams({ completer: 'telephone', returnTo: from })}` } },
        { text: 'Départ souhaité le jeudi 19 novembre : aucun départ n’est prévu ce jour-là pour la Réunion.', link: { label: 'Choisir ou créer le départ', href: `${displayed.pathname}?${field}` } },
      ]);
      for (const target of await band.getByRole('link').all()) { const box = await target.boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, 'A 44px link inside the screen.'); }
      for (const part of await textStyles(band.locator('.dossier-alerts-title, .dossier-alerts-count, .dossier-alerts-text, .dossier-alerts-action'))) {
        assert.ok(part.size >= 12, `${part.text}: ${part.size}px`); assert.ok(part.ratio >= 4.5, `${part.text}: ${part.ratio.toFixed(2)}:1`);
      }
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/client-incomplete-${width}-${theme}.png`, fullPage: true });
      // « Compléter la fiche » opens the client page on the first missing field, with the way back to the dossier.
      await band.getByRole('link', { name: 'Compléter la fiche', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === `/clients/${CLIENT.grondin}` && url.searchParams.get('completer') === 'telephone' && url.searchParams.get('returnTo') === from);
      // Only a field online payment needs is missing for an individual who has not paid: the online-payment wording.
      await openDossier(f, DOSSIER.ACC010);
      const jacoby = new URL(f.page.url());
      assert.deepEqual(await bandLines(f), [{ text: 'Fiche client incomplète pour le paiement en ligne : il manque l’adresse.', link: { label: 'Compléter la fiche', href: `/clients/${CLIENT.jacoby}?${new URLSearchParams({ completer: 'adresse', returnTo: jacoby.pathname + jacoby.search })}` } }]);
      // The list mark names the lines too.
      await f.page.goto(`${base}/colis`);
      await f.page.locator(`[data-dossier-row="${DOSSIER.ACC010}"]:visible`).getByRole('img', { name: 'À vérifier : Fiche client incomplète pour le paiement en ligne : il manque l’adresse.', exact: true }).waitFor();
      assertNoBusinessWrite(f);
    }, { width, theme });

    for (const [name, permissions, label] of [
      ['reading-the-client-record-only', { perm_colis_preparer: true, perm_clients_voir: true }, 'Voir la fiche client'],
      ['without-the-client-page', { perm_colis_preparer: true }, undefined],
    ]) await scenario(`${name}-the-incomplete-record-keeps-its-line-without-asking-to-complete`, async f => {
      Object.assign(f.tables.clients.find(client => client.id === CLIENT.grondin), { tel: null });
      await openDossier(f, DOSSIER.ACC006);
      const displayed = new URL(f.page.url());
      const lines = await bandLines(f);
      assert.deepEqual(lines.map(({ text, link }) => [text, link?.label]), [['Fiche client incomplète : il manque le téléphone.', label], ['Départ souhaité le jeudi 19 novembre : aucun départ n’est prévu ce jour-là pour la Réunion.', undefined]]);
      // Reading only: the client page opens without the request to complete a field.
      if (label) assert.equal(lines[0].link.href, `/clients/${CLIENT.grondin}?${new URLSearchParams({ returnTo: displayed.pathname + displayed.search })}`);
      assertNoBusinessWrite(f);
    }, { role: 'preparateur', permissions });

    await scenario('the-assign-link-is-offered-to-whoever-the-field-opens-for', async f => {
      row(f, DOSSIER.ACC001).envoi_id = DEPARTURE.reunion8;f.before = structuredClone(f.tables.colis);
      addDepartures(f, extraDeparture(uuid('d2000000', 12), 'ENV-2026-110', '2026-11-19', '974'));
      await openDossier(f, DOSSIER.ACC001);
      assert.deepEqual((await bandLines(f)).map(({ text, link }) => [text, link?.label]), [[MEASURE_CUTOFF_8, undefined]], 'Without perm_colis_mesurer no measure link.');
      await openDossier(f, DOSSIER.ACC006);
      assert.deepEqual((await bandLines(f)).map(({ text, link }) => [text, link?.label]), [[TO_ASSIGN_19, 'Affecter au départ']]);
      await alertBand(f).getByRole('link', { name: 'Affecter au départ', exact: true }).click();
      await combobox(overview(f)).waitFor();await listbox(overview(f)).waitFor();
      await f.page.waitForURL(url => !url.searchParams.has('modifier'));
      assertNoBusinessWrite(f);
    }, { role: 'logisticien', permissions: { perm_colis_affecter_envoi: true, perm_envois_voir: true } });

    // ── D. « Accords clients » ──────────────────────────────────────────────
    await scenario('the-accords-tab-lists-only-the-dossiers-awaiting-consent-grouped-by-client', async f => {
      await f.page.goto(`${base}/colis`);
      await countStatus(f, 12).waitFor();
      // After « Départs »; switching to it writes nothing and keeps its own default grouping.
      assert.deepEqual(await viewTabs(f), VIEW_LABELS);
      await selectTab(f, 'Accords clients', 'accords');
      assert.equal(new URL(f.page.url()).searchParams.has('view'), false, 'Grouping by client is its default: no URL parameter.');
      // Received, measured or awaiting the answer: authorised, paid, departed and archived (ACC011) dossiers are not listed.
      await assertGroups(f, ACCORD_GROUPS);
      assert.deepEqual((await shownIds(f)).sort(), [...ACCORD_DOSSIERS].sort());
      await countStatus(f, 8).waitFor();
      assert.equal(await f.page.locator('[aria-label="Vues du tableau"] [aria-pressed="true"]').innerText(), 'Accords clients');
      // « Flavie Payet », then « 3 dossiers »; the band folds by its name and selects every dossier.
      const band = f.page.locator(`tr[data-dossier-group="client:${CLIENT.payet}"]`);
      assert.equal((await band.innerText()).replace(/\s+/g, ' ').trim(), 'Flavie Payet 3 dossiers');
      const toggle = band.getByRole('button', { name: 'Flavie Payet', exact: true });
      assert.equal(await toggle.evaluate(node => (node.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent.trim()).join(' ')), '3 dossiers');
      await band.getByRole('checkbox', { name: 'Sélectionner le groupe Flavie Payet', exact: true }).waitFor();
      assert.equal(await band.locator('svg.dossier-group-icon').count(), 1, 'A lucide icon, no emoji.');
      // Its columns, the action last; no status or payment column.
      assert.deepEqual(await f.page.locator('table.dossier-data-table thead th[data-column-label]').evaluateAll(nodes => nodes.map(node => [node.dataset.column, node.dataset.columnLabel])), ACCORD_COLUMNS);
      // Affichage says « Par client », and offers it with the other groupings.
      const display = await openDisplay(f);
      const grouping = display.getByRole('combobox', { name: 'Regrouper les dossiers', exact: true });
      assert.equal(await grouping.inputValue(), 'client');
      assert.deepEqual(await grouping.locator('option').evaluateAll(options => options.map(option => [option.value, option.textContent])), [['none', 'Aucun'], ['statut', 'Par étape'], ['envoi', 'Par départ'], ['client', 'Par client']]);
      assert.equal(await display.getByRole('combobox', { name: 'Dossiers sans départ', exact: true }).count(), 0);
      await closeDisplay(f);
      // A shared link opens the same list.
      await openAccords(f);await assertGroups(f, ACCORD_GROUPS);
      await f.page.screenshot({ path: `${output}/accords-tab-1440-light.png`, fullPage: true });
      assertNoBusinessWrite(f);
    });

    await scenario('the-accords-columns-show-the-consent-the-request-the-last-relance-and-the-departure', async f => {
      addRelances(f);
      await openAccords(f);await assertGroups(f, ACCORD_GROUPS);
      const pill = async id => { const cell = await tableCell(f, id, 'consentState'); return [cell.pill, cell.tone, cell.secondary]; };
      // « À soumettre » (neutral), « Réponse attendue » (waiting), « Le client attend » (current) with the end of a dated wait.
      for (const id of [DOSSIER.ACC001, DOSSIER.ACC002, DOSSIER.ACC006, DOSSIER.ACC010, DOSSIER.ACC012]) assert.deepEqual(await pill(id), ['À soumettre', 'neutral', []], REF[id]);
      assert.deepEqual(await pill(DOSSIER.ACC003), ['Réponse attendue', 'waiting', []]);
      assert.deepEqual(await pill(DOSSIER.ACC004), ['Le client attend', 'current', ['jusqu’au 25/10']]);
      assert.deepEqual(await pill(DOSSIER.ACC005), ['Le client attend', 'current', []]);
      // « Demande envoyée le »: the confirmed delivery of the request, nothing for a request still to send.
      for (const [id, text] of [[DOSSIER.ACC003, '02/10/2026'], [DOSSIER.ACC004, '01/10/2026'], [DOSSIER.ACC005, '01/10/2026']]) {
        const cell = await tableCell(f, id, 'consentRequestedAt');
        assert.deepEqual([cell.text, cell.placeholder], [text, false], REF[id]);
        assert.equal(await f.page.locator(`tr[data-dossier-row="${id}"] td[data-column="consentRequestedAt"] time`).getAttribute('datetime'), f.tables.colis.find(item => item.id === id).demande_feu_vert_envoyee_at);
      }
      for (const id of [DOSSIER.ACC001, DOSSIER.ACC002, DOSSIER.ACC006]) assert.deepEqual(await tableCell(f, id, 'consentRequestedAt'), { text: 'Non renseigné', pill: null, tone: null, secondary: [], placeholder: true });
      // « Dernière relance »: the latest relance of the current request; a draft never reads as sent.
      const relance = async id => { const cell = await tableCell(f, id, 'lastRelanceAt'); return [cell.text, cell.secondary, cell.placeholder]; };
      assert.deepEqual(await relance(DOSSIER.ACC003), ['05/10/2026', [], false]);
      assert.deepEqual(await relance(DOSSIER.ACC005), ['03/10/2026 Brouillon manuel', ['Brouillon manuel'], false]);
      for (const id of [DOSSIER.ACC004, DOSSIER.ACC012, DOSSIER.ACC001]) assert.deepEqual(await relance(id), ['Non renseigné', [], true], `${REF[id]}: no relance of a current request.`);
      // Cartons, Casier and the departure column with the desired day.
      assert.deepEqual([(await tableCell(f, DOSSIER.ACC001, 'cartons')).text, (await tableCell(f, DOSSIER.ACC001, 'casier')).text], ['2', 'C-001']);
      for (const [id, text] of [[DOSSIER.ACC001, 'À planifier'], [DOSSIER.ACC002, 'Prévu le 08/10/2026'], [DOSSIER.ACC003, 'Prévu le 08/10/2026'], [DOSSIER.ACC006, 'Souhaité le 19/11/2026 · à créer']])
        assert.equal((await tableCell(f, id, 'departure')).text, text, REF[id]);
      // The action names the work: the relance before the closing is work to take.
      const action = f.page.locator(`tr[data-dossier-row="${DOSSIER.ACC003}"] td[data-column="action"]`);
      await action.getByText('Relancer le client avant la clôture du départ', { exact: true }).waitFor();
      await action.getByRole('button', { name: 'Je m’en occupe', exact: true }).waitFor();
      await f.page.locator(`tr[data-dossier-row="${DOSSIER.ACC004}"] td[data-column="action"]`).getByRole('button', { name: 'Consulter', exact: true }).waitFor();
      await f.page.screenshot({ path: `${output}/accords-columns-1440-light.png`, fullPage: true });
      // A newer relance whose delivery failed is shown with its state, never as sent.
      f.tables.messages.push({ id: uuid('b2000000', 200), colis_id: DOSSIER.ACC003, type: 'staff', auteur_nom: 'Camille', texte: 'Bonjour, votre accord est toujours attendu.', canal: 'telegram', template: 'relance_feu_vert', statut: 'echec', lu: true, created_at: '2026-10-06T07:00:00Z' });
      await f.page.reload();await f.page.locator(`tr[data-dossier-row="${DOSSIER.ACC003}"]`).waitFor();
      await f.page.locator(`tr[data-dossier-row="${DOSSIER.ACC003}"] td[data-column="lastRelanceAt"]`).getByText('Envoi non confirmé', { exact: true }).waitFor();
      assert.deepEqual(await relance(DOSSIER.ACC003), ['06/10/2026 Envoi non confirmé', ['Envoi non confirmé'], false]);
      assertNoBusinessWrite(f);
    });

    await scenario('the-accords-columns-sort-and-filter-like-the-others', async f => {
      addRelances(f);
      await openAccords(f, 'view=none');await assertGroups(f, []);
      await countStatus(f, 8).waitFor();
      const consentLabels = () => f.page.locator('tr[data-dossier-row] td[data-column="consentState"] .dossier-pill').allTextContents();
      // « Accord »: the three states in order, and the reverse.
      await sortBy(f, 'consentState', 'asc');
      assert.deepEqual(await consentLabels(), ['À soumettre', 'À soumettre', 'À soumettre', 'À soumettre', 'À soumettre', 'Le client attend', 'Le client attend', 'Réponse attendue']);
      await f.page.locator('th[data-column="consentState"] .dossier-table-sort').click();
      await f.page.waitForURL(url => url.searchParams.get('dir') === 'desc');
      await f.page.locator('th[data-column="consentState"][aria-sort="descending"]').waitFor();
      assert.deepEqual(await consentLabels(), ['Réponse attendue', 'Le client attend', 'Le client attend', 'À soumettre', 'À soumettre', 'À soumettre', 'À soumettre', 'À soumettre']);
      // « Demande envoyée le »: newest first, the requests still to send last.
      await sortBy(f, 'consentRequestedAt', 'desc');
      assert.deepEqual((await shownIds(f)).slice(0, 3), [DOSSIER.ACC003, DOSSIER.ACC005, DOSSIER.ACC004]);
      assert.equal((await f.page.locator('.dossier-meta-sort').innerText()).trim(), 'Tri : Demande envoyée le · plus récent d’abord');
      // « Dernière relance »: the dossiers with a relance first, in either direction.
      await sortBy(f, 'lastRelanceAt', 'asc');
      assert.deepEqual((await shownIds(f)).slice(0, 2), [DOSSIER.ACC005, DOSSIER.ACC003]);
      // « Accord » is filtered on one exact state.
      await filterColumn(f, 'consentState', 'is', 'Le client attend');
      await countStatus(f, 2).waitFor();
      assert.deepEqual((await shownIds(f)).sort(), [DOSSIER.ACC004, DOSSIER.ACC005].sort());
      const chip = f.page.getByRole('button', { name: 'Retirer le filtre Accord : est Le client attend', exact: true });
      await chip.click();await countStatus(f, 8).waitFor();
      // The dates filter on their day, and on whether they are known.
      await filterColumn(f, 'consentRequestedAt', 'min', '2026-10-02');
      await countStatus(f, 1).waitFor();
      assert.deepEqual(await shownIds(f), [DOSSIER.ACC003]);
      await f.page.getByRole('button', { name: 'Retirer les filtres', exact: true }).click();await countStatus(f, 8).waitFor();
      await filterColumn(f, 'lastRelanceAt', 'filled');
      await countStatus(f, 2).waitFor();
      assert.deepEqual((await shownIds(f)).sort(), [DOSSIER.ACC003, DOSSIER.ACC005].sort());
      // Grouped again, the filter keeps its bands: only the clients of the remaining dossiers.
      const display = await openDisplay(f);
      await display.getByRole('combobox', { name: 'Regrouper les dossiers', exact: true }).selectOption('client');
      await f.page.waitForURL(url => url.searchParams.get('view') === 'client');
      await assertGroups(f, [{ ...ACCORD_GROUPS[0], count: '1 dossier', dossiers: [DOSSIER.ACC003] }, { ...ACCORD_GROUPS[1], count: '1 dossier', dossiers: [DOSSIER.ACC005] }]);
      await closeDisplay(f);
      assertNoBusinessWrite(f);
    });

    await scenario('the-bands-follow-the-oldest-reception-of-each-client-and-the-sort-applies-inside', async f => {
      // Nadia Jacoby now has the oldest parcel of the list: her band leads.
      row(f, DOSSIER.ACC010).reception_dates = [{ receivedAt: '2026-09-01T08:00:00Z', source: 'server' }, { receivedAt: '2026-09-02T08:00:00Z', source: 'server' }];
      f.before = structuredClone(f.tables.colis);
      await openAccords(f);
      const bands = [ACCORD_GROUPS[3], ACCORD_GROUPS[0], ACCORD_GROUPS[1], ACCORD_GROUPS[2]];
      await assertGroups(f, bands);
      // Inside each band, the chosen sort: the latest reception first.
      await sortBy(f, 'receivedAt', 'desc');
      await assertGroups(f, bands.map(group => ({ ...group, dossiers: [...group.dossiers].reverse() })), { ordered: true });
      assert.equal((await f.page.locator('.dossier-meta-sort').innerText()).trim(), 'Tri : Dernière réception · plus récent d’abord · dans chaque groupe');
      // The export follows the screen, band by band, with the columns of the tab.
      const display = await openDisplay(f);const pending = f.page.waitForEvent('download');
      await display.getByRole('button', { name: 'Exporter 8 dossiers filtrés', exact: true }).click();
      const file = await pending;assert.equal(await file.failure(), null);await closeDisplay(f);
      const book = XLSX.read(await fs.readFile(await file.path()), { type: 'buffer' });
      const data = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
      assert.deepEqual(data[0], ACCORD_COLUMNS.filter(([key]) => key !== 'action').map(([, label]) => label));
      assert.deepEqual(data.slice(1).map(line => line[0]), bands.flatMap(group => [...group.dossiers].reverse().map(id => REF[id])));
      const line = id => data.find(item => item[0] === REF[id]);
      assert.deepEqual(line(DOSSIER.ACC004).slice(3, 6), ['Le client attend · jusqu’au 25/10', '01/10/2026', 'Non renseigné']);
      assert.deepEqual(line(DOSSIER.ACC003).slice(3, 9), ['Réponse attendue', '02/10/2026', '05/10/2026', 2, 'C-003', 'Prévu le 08/10/2026']);
      assert.equal(line(DOSSIER.ACC006)[8], 'Souhaité le 19/11/2026 · à créer');
      assertNoBusinessWrite(f);
    });

    await scenario('grouping-by-client-is-offered-in-every-tab-and-remembered-per-tab', async f => {
      // Every dossier of the list (not the archived ACC011), one band per client.
      const daily = [
        { key: `client:${CLIENT.payet}`, title: 'Flavie Payet', count: '5 dossiers', dossiers: [DOSSIER.ACC001, DOSSIER.ACC002, DOSSIER.ACC003, DOSSIER.ACC009, DOSSIER.ACC013] },
        { key: `client:${CLIENT.hoarau}`, title: 'Lucas Hoarau', count: '3 dossiers', dossiers: [DOSSIER.ACC004, DOSSIER.ACC005, DOSSIER.ACC012] },
        { key: `client:${CLIENT.grondin}`, title: 'Paul Grondin', count: '2 dossiers', dossiers: [DOSSIER.ACC006, DOSSIER.ACC008] },
        { key: `client:${CLIENT.jacoby}`, title: 'Nadia Jacoby', count: '2 dossiers', dossiers: [DOSSIER.ACC007, DOSSIER.ACC010] },
      ];
      await f.page.goto(`${base}/colis`);await countStatus(f, 12).waitFor();await assertGroups(f, []);
      let display = await openDisplay(f);
      let grouping = display.getByRole('combobox', { name: 'Regrouper les dossiers', exact: true });
      assert.equal(await grouping.inputValue(), 'none');
      await grouping.selectOption('client');await f.page.waitForURL(url => url.searchParams.get('view') === 'client');
      await assertGroups(f, daily);
      assert.equal(await display.isVisible(), true, 'Changing the grouping keeps Affichage open.');
      assert.equal(await storedPreference(f, 'table-group', 'daily'), '"client"');
      await closeDisplay(f);
      // « Accords clients » keeps its own choice: by client until changed there.
      await selectTab(f, 'Accords clients', 'accords');await assertGroups(f, ACCORD_GROUPS);
      assert.equal(await storedPreference(f, 'table-group', 'accords'), null);
      display = await openDisplay(f);grouping = display.getByRole('combobox', { name: 'Regrouper les dossiers', exact: true });
      await grouping.selectOption('none');await f.page.waitForURL(url => url.searchParams.get('view') === 'none');
      await assertGroups(f, []);
      assert.equal(await storedPreference(f, 'table-group', 'accords'), '"none"');
      await selectTab(f, 'Travail quotidien', 'daily');await assertGroups(f, daily);
      await selectTab(f, 'Accords clients', 'accords');await assertGroups(f, []);
      await countStatus(f, 8).waitFor();
      // « Départs » too can be read by client.
      await selectTab(f, 'Départs', 'departures');
      display = await openDisplay(f);
      await display.getByRole('combobox', { name: 'Regrouper les dossiers', exact: true }).selectOption('client');
      await f.page.waitForURL(url => url.searchParams.get('view') === 'client');
      await assertGroups(f, daily);
      await closeDisplay(f);
      assertNoBusinessWrite(f);
    });

    await scenario('every-role-that-sees-the-list-has-the-accords-tab', async f => {
      await f.page.goto(`${base}/colis`);await countStatus(f, 12).waitFor();
      // No payment view without a financial permission; « Accords clients » stays.
      assert.deepEqual(await viewTabs(f), ['Travail quotidien', 'Départs', 'Accords clients']);
      await selectTab(f, 'Accords clients', 'accords');
      await assertGroups(f, ACCORD_GROUPS);
      assert.equal(await f.page.locator('thead th[data-column="requested"], thead th[data-column="paymentState"]').count(), 0);
      assertNoBusinessWrite(f);
    }, { role: 'preparateur', permissions: { perm_colis_preparer: true } });

    await scenario('the-accords-tab-offers-no-amount-order-and-keeps-its-own-default-order', async f => {
      const sortMenu = async () => (await openDisplay(f)).getByRole('combobox', { name: 'Tri par défaut', exact: true });
      const orders = async () => (await sortMenu()).locator('optgroup[label="Ordres de travail"] option').evaluateAll(options => options.map(option => option.value));
      const storedSort = suffix => f.page.evaluate(key => localStorage.getItem(key), `expedile_default_sort_v2:${ids.A}${suffix}`);
      await f.page.goto(`${base}/colis`);await countStatus(f, 12).waitFor();
      assert.ok((await orders()).includes('total_desc'), 'Where the quote price shows, amounts can order the list.');
      await selectTab(f, 'Accords clients', 'accords');
      assert.deepEqual(await orders(), ['priority', 'date_desc', 'date_asc', 'ref_asc'], 'No amount here: the tab shows no price.');
      await (await sortMenu()).selectOption('date_asc');
      await f.page.waitForFunction(key => localStorage.getItem(key) === 'date_asc', `expedile_default_sort_v2:${ids.A}:accords`);
      assert.equal(await storedSort(':accords'), 'date_asc');
      assert.equal(await storedSort(''), null, 'The other tabs keep their order.');
      await selectTab(f, 'Travail quotidien', 'daily');
      assert.equal(await (await sortMenu()).inputValue(), 'priority');
      await (await sortMenu()).selectOption('date_desc');
      await f.page.waitForFunction(key => localStorage.getItem(key) === 'date_desc', `expedile_default_sort_v2:${ids.A}`);
      await selectTab(f, 'Accords clients', 'accords');
      assert.equal(await (await sortMenu()).inputValue(), 'date_asc', 'Each keeps its own default order.');
      await closeDisplay(f);
      assertNoBusinessWrite(f);
    });

    await scenario('an-empty-consent-queue-says-so-and-a-filtered-one-offers-to-clear-the-filters', async f => {
      // Every consent is obtained: nothing to submit, nothing awaited.
      f.tables.colis = f.tables.colis.filter(item => item.archive || !['receptionne', 'mesure', 'attente_feu_vert'].includes(item.statut));
      f.before = structuredClone(f.tables.colis);
      await f.page.goto(`${base}/colis?table=accords`);
      const empty = f.page.getByText('Aucun dossier en attente d’accord.', { exact: true });
      await empty.waitFor();
      assert.equal(await f.page.getByText('Aucun dossier ne correspond à ces filtres.', { exact: true }).count(), 0);
      assert.equal(await f.page.getByRole('button', { name: 'Retirer les filtres', exact: true }).count(), 0, 'No filter to remove.');
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/accords-empty-1440.png` });
      // With a filter, the list says that the filter hides the dossiers.
      await f.page.goto(`${base}/colis?table=accords&dest=976`);
      await f.page.getByText('Aucun dossier ne correspond à ces filtres.', { exact: true }).waitFor();
      assert.equal(await empty.count(), 0);
      await f.page.getByLabel('Tableau des dossiers').getByRole('button', { name: 'Retirer les filtres', exact: true }).waitFor();
      assertNoBusinessWrite(f);
    });

    await scenario('two-clients-with-the-same-name-are-told-apart-by-their-reference', async f => {
      // Paul Grondin's record now reads « Flavie Payet » too.
      Object.assign(f.tables.clients.find(client => client.id === CLIENT.grondin), { prenom: 'Flavie', nom: 'Payet' });
      await openAccords(f);
      await assertGroups(f, ACCORD_GROUPS.map(group => group.key === `client:${CLIENT.payet}` ? { ...group, ref: 'CLI-ACC-01' }
        : group.key === `client:${CLIENT.grondin}` ? { ...group, title: 'Flavie Payet', ref: 'CLI-ACC-04' } : group));
      for (const ref of ['CLI-ACC-01', 'CLI-ACC-04']) await f.page.getByRole('checkbox', { name: `Sélectionner le groupe Flavie Payet · ${ref}`, exact: true }).filter({ visible: true }).waitFor();
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/accords-same-name-1440.png` });
      assertNoBusinessWrite(f);
    });

    for (const theme of ['light', 'dark']) await scenario(`the-accords-table-is-readable-and-accessible-1440-${theme}`, async f => {
      addRelances(f);
      await openAccords(f);await waitTheme(f, theme);
      await assertGroups(f, ACCORD_GROUPS);
      const parts = '.dossier-group-title, .dossier-group-count, td[data-column="consentState"] .dossier-pill, td[data-column="consentState"] .dossier-table-secondary, td[data-column="lastRelanceAt"] .dossier-table-secondary, td[data-column="consentRequestedAt"] time, td[data-column="lastRelanceAt"] time';
      const readable = async state => {
        // Four bands, eight pills, the dated wait, three requests, two relances and a draft.
        const styles = await textStyles(f.page.locator(parts).filter({ visible: true }));
        assert.ok(styles.length >= 23, `${state}: ${styles.length} parts measured.`);
        for (const part of styles) { assert.ok(part.size >= 12, `${state} · ${part.text}: ${part.size}px`); assert.ok(part.ratio >= 4.5, `${state} · ${part.text}: ${part.ratio.toFixed(2)}:1`); }
      };
      await f.page.mouse.move(0, 0);await readable('normal');
      // At the default text size every heading of the tab reads whole.
      assert.deepEqual(await f.page.locator('table.dossier-data-table thead .dossier-table-heading-text').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent)), []);
      // Hovered and selected rows keep their pills readable.
      await f.page.locator(`tr[data-dossier-row="${DOSSIER.ACC004}"] td[data-column="client"]`).hover();await readable('hover');
      await f.page.getByRole('checkbox', { name: 'Sélectionner le groupe Lucas Hoarau', exact: true }).filter({ visible: true }).check();
      await f.page.getByRole('group', { name: 'Actions sur la sélection', exact: true }).getByText('3 dossiers sélectionnés', { exact: true }).waitFor();
      await f.page.mouse.move(0, 0);await readable('selected');
      await f.page.getByRole('button', { name: 'Désélectionner tout', exact: true }).click();
      const controls = await f.page.locator('.dossier-group-toggle:visible, .dossier-group-header .dossier-table-checkbox:visible').all();
      assert.equal(controls.length, 8, 'A toggle and a checkbox per band.');
      for (const target of controls) { const box = await target.boundingBox(); assert.ok(box.height >= 44, 'Band controls keep a 44px target.'); }
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/accords-table-1440-${theme}.png`, fullPage: true });
      assertNoBusinessWrite(f);
    }, { theme });

    for (const theme of ['light', 'dark']) await scenario(`the-accords-cards-keep-their-client-bands-390-${theme}`, async f => {
      addRelances(f);
      await openAccords(f);await waitTheme(f, theme);
      assert.equal((await visibleGroups(f)).layout, 'cards');
      await assertGroups(f, ACCORD_GROUPS);
      // The card names its consent beside the reference; its facts follow.
      const card = f.page.locator(`[data-dossier-card="${DOSSIER.ACC004}"]`);
      assert.equal((await card.locator('.dossier-table-card-heading [data-column="consentState"]').innerText()).replace(/\s+/g, ' ').trim(), 'Le client attend jusqu’au 25/10');
      assert.deepEqual(await card.locator('.dossier-table-card-facts > div').evaluateAll(nodes => nodes.map(node => [node.dataset.column, node.querySelector('dt').textContent.trim(), node.querySelector('dd').textContent.replace(/\s+/g, ' ').trim()])), [
        ['receivedAt', 'Dernière réception', '16/09/2026'], ['consentRequestedAt', 'Demande envoyée le', '01/10/2026'], ['lastRelanceAt', 'Dernière relance', 'Non renseigné'],
        ['cartons', 'Cartons reçus', '2'], ['casier', 'Casier', 'C-004'], ['departure', 'Départ prévu', 'À planifier'],
      ]);
      await f.page.screenshot({ path: `${output}/accords-cards-390-${theme}.png`, fullPage: true });
      // A band folds and selects its dossiers, with 44px controls inside the phone.
      const toggle = f.page.getByRole('button', { name: 'Lucas Hoarau', exact: true }).filter({ visible: true });
      const checkbox = f.page.getByRole('checkbox', { name: 'Sélectionner le groupe Lucas Hoarau', exact: true }).filter({ visible: true });
      for (const target of [toggle, checkbox.locator('..')]) { const box = await target.boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 391, 'Band controls fit the phone with 44px targets.'); }
      assert.equal(await f.page.getByRole('group', { name: 'Lucas Hoarau', exact: true }).count(), 1, 'The cards of a client are named by their band.');
      await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await assertGroups(f, ACCORD_GROUPS.map(group => group.title === 'Lucas Hoarau' ? { ...group, dossiers: [] } : group));
      await checkbox.check();
      await f.page.getByRole('group', { name: 'Actions sur la sélection', exact: true }).getByText('3 dossiers sélectionnés', { exact: true }).waitFor();
      await toggle.click();await assertGroups(f, ACCORD_GROUPS);
      for (const id of ACCORD_GROUPS[1].dossiers) assert.equal(await f.page.locator(`[data-dossier-card="${id}"]`).getAttribute('data-selected'), 'true');
      await checkbox.uncheck();
      const styles = await textStyles(f.page.locator('.dossier-group-title:visible, .dossier-group-count:visible, [data-dossier-card] [data-column="consentState"] .dossier-pill, [data-dossier-card] .dossier-table-secondary:visible, [data-dossier-card] .dossier-table-card-facts dt'));
      // Four bands, eight consent pills, the cards' other lines and their 48 fact labels.
      assert.ok(styles.length >= 64, `${styles.length} parts measured.`);
      for (const part of styles) { assert.ok(part.size >= 12, `${part.text}: ${part.size}px`); assert.ok(part.ratio >= 4.5, `${part.text}: ${part.ratio.toFixed(2)}:1`); }
      await noPageOverflow(f);await axe(f);
      await f.page.screenshot({ path: `${output}/accords-cards-folded-390-${theme}.png` });
      assertNoBusinessWrite(f);
    }, { width: 390, theme });
  } finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); }
}
module.exports = {
  fixture, CLIENT, DEPARTURE, DOSSIER, REF, NOW, OPTION, REUNION_PLANNED, READ_ONLY_RPCS, DEPARTURE_COMMANDS,
  writes, commands, assertNoBusinessWrite, assertOnlyDepartureWrites, row, noPageOverflow, axe, waitTheme, textStyles,
  overview, workspace, departureLine, editDeparture, combobox, listbox, alertBand, openDossier, departureText, optionList, openOverviewEditor,
  option, actionOption, missingLine, fieldError,
  ACCORD_GROUPS, ACCORD_DOSSIERS, ACCORD_COLUMNS, VIEW_LABELS, installGroupReader, visibleGroups, assertGroups, shownIds, countStatus, openAccords,
  openDisplay, closeDisplay, selectTab, viewTabs, storedPreference, tableCell, filterColumn, sortBy, addRelances,
};
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
