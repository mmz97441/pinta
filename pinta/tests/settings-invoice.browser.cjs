/* Paramètres › Facture commerciale (/settings?tab=facture), decided with the user on 2026-10-08:
 * the exporter (Expedîle, its address and identifiers) and the consignee of each destination, else
 * the default one, printed at the top of every commercial invoice. Stored under
 * app_settings.business.factureCommerciale by save_admin_setting, which replaces the whole business
 * object after a compare-and-swap on the stored one (p_expected).
 * The checks run in light and dark, at 1440 and 390 px, with axe. setup() mocks every request:
 * nothing reaches Supabase. PINTA_SETTINGS_INVOICE_FILTER keeps the checks whose name contains it
 * (« 390-dark », « save »…). */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_SETTINGS_INVOICE_OUT || '/tmp/pinta-settings-invoice';
const FILTER = process.env.PINTA_SETTINGS_INVOICE_FILTER || '';
const results = [];

const LAYOUTS = [
  { width: 1440, height: 1000, theme: 'light' }, { width: 1440, height: 1000, theme: 'dark' },
  { width: 390, height: 844, theme: 'light' }, { width: 390, height: 844, theme: 'dark' },
];
// A tablet, landscape and portrait: the panel is at its narrowest beside the rubric list.
const TABLETS = [{ width: 1024, height: 768, theme: 'light' }, { width: 768, height: 1024, theme: 'dark' }];
const tagOf = layout => `${layout.width}-${layout.theme}`;
const flat = text => String(text).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const clone = value => JSON.parse(JSON.stringify(value));

// The form's fields, in reading order, as domain/invoiceIdentity.js names and labels them.
const PARTY_FIELDS = ['nom', 'adresse', 'complement', 'codePostal', 'ville', 'pays', 'telephone', 'email', 'siret', 'eori', 'tva'];
const LABELS = { nom: 'Nom ou raison sociale', adresse: 'Adresse', complement: 'Complément d’adresse', codePostal: 'Code postal', ville: 'Ville', pays: 'Pays', telephone: 'Téléphone', email: 'Email', siret: 'SIRET', eori: 'Numéro EORI', tva: 'Numéro de TVA' };
const REQUIRED = ['nom', 'adresse', 'codePostal', 'ville', 'pays'];
const full = values => Object.fromEntries(PARTY_FIELDS.map(key => [key, values[key] ?? '']));
// The quote's legal mentions (decision of 10 October 2026, F10): the exporter's own fields, in their own group.
const LEGAL_FIELDS = ['formeJuridique', 'capital', 'rcsVille'];
const LEGAL_LABELS = { formeJuridique: 'Forme juridique', capital: 'Capital social (€)', rcsVille: 'Ville du greffe (RCS)' };
const LEGAL_HELP = { formeJuridique: 'Par exemple SAS, SARL ou SASU.', capital: 'En euros, par exemple 10 000.', rcsVille: 'La ville seule : le devis écrit « RCS Paris ».' };
const exporterFull = values => ({ ...full(values), ...Object.fromEntries(LEGAL_FIELDS.map(key => [key, values[key] ?? ''])) });
// The consignee of La Réunion the user gave on 2026-10-08, as it is seeded in production.
const REUNION = { nom: 'Expedîle', adresse: '5 Chemin Grand Canal', complement: 'Immeuble Thales', codePostal: '97490', ville: 'Sainte-Clotilde', pays: 'La Réunion (France)' };
// app_settings.business: the storage rules, keys no screen shows, and the identity stored so far.
const BUSINESS = { fraisStockage: '1.50', stockageGratuit: '14', diviseurVolumetrique: '5000', relancesFeuVert: 'J+2,J+5,J+7', relancesPaiement: 'J+3,J+7,J+14', timezone: 'Europe/Paris', relancesActivesDepuis: '2026-09-01T00:00:00Z', noteInterne: { source: 'migration', version: 3 }, factureCommerciale: { destinataires: { 974: REUNION } } };
// Test values only: the exporter's mainland address is not known yet, and the application never invents one.
const EXPORTER = { adresse: '10 allée de l’Essai', codePostal: '95700', ville: 'Roissy-en-France', pays: 'France', telephone: '01 23 45 67 89', email: 'contact@exemple.fr', siret: '123 456 789 00012', eori: 'fr 123456789 00012', tva: 'FR00123456789' };
const FALLBACK = { nom: 'Transitaire DOM (essai)', adresse: '1 rue de l’Essai', codePostal: '97600', ville: 'Mamoudzou', pays: 'Mayotte (France)' };
// The default consignee, then the destinations: [key, title, group name].
const BLOCKS = [['defaut', 'Destinataire par défaut', 'Destinataire par défaut'], ['974', 'La Réunion', 'Destinataire · La Réunion'], ['976', 'Mayotte', 'Destinataire · Mayotte'], ['971', 'Guadeloupe', 'Destinataire · Guadeloupe'], ['972', 'Martinique', 'Destinataire · Martinique']];
const DRAFT_HELP = 'Brouillon conservé lorsque vous changez de rubrique. Les changements ne s’appliquent qu’après enregistrement.';
const SAVED = 'Réglages de la facture commerciale enregistrés. Ils s’appliquent aux prochaines factures commerciales, étiquettes et devis imprimés.';
const RELOADED = 'Valeurs enregistrées rechargées. Le brouillon a été abandonné.';
const CONFLICT = 'Ces réglages ont été modifiés entre-temps, par un collègue ou dans un autre onglet. Rien n’a été enregistré : rechargez les valeurs enregistrées, puis refaites vos modifications. Votre saisie reste affichée jusque-là.';

const canonical = value => JSON.stringify(value ?? null, (key, item) => (item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item));
/** save_admin_setting as 20260917000001_admin_simplification.sql: permission, compare-and-swap on the stored
 *  value, validation of the whole business object, then the value replaced and returned as stored. The
 *  reads of app_settings go to the shared fixture, unless a check makes them fail (failRead). */
async function mockServer(f) {
  const server = { calls: [], beforeSave: null, failRead: false };
  const row = () => f.tables.app_settings.find(item => item.key === 'business');
  await f.context.route('**/rest/v1/app_settings*', route => (server.failRead && route.request().method() === 'GET'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Lecture des réglages indisponible (essai)' }) }) : route.fallback()));
  await f.context.route('**/rest/v1/rpc/save_admin_setting', async route => {
    const input = route.request().postDataJSON(); server.calls.push(clone(input));
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const allowed = ['directeur', 'vice_directeur'].includes(f.tables.staff_users[0].role) || (f.tables.staff_permissions || []).some(item => item.perm_admin_parametres === true);
    if (input.p_key !== 'business' || !allowed) return reply(403, { code: '42501', message: 'Permission de cette rubrique requise' });
    // A colleague's save landing between this page's read and its save.
    if (server.beforeSave) { const write = server.beforeSave; server.beforeSave = null; write(row().value); }
    if (canonical(row()?.value) !== canonical(input.p_expected)) return reply(409, { code: '40001', message: 'Ces paramètres ont changé. Rechargez avant de réessayer.' });
    const value = input.p_value, number = item => (item === '' || item == null ? NaN : Number(item)), cadence = /^J\+[0-9]+(, *J\+[0-9]+)*$/;
    if (!value || typeof value !== 'object' || Array.isArray(value) || !(number(value.fraisStockage) >= 0) || !(number(value.stockageGratuit) >= 0) || !(number(value.diviseurVolumetrique) > 0)
      || !cadence.test(value.relancesFeuVert ?? '') || !cadence.test(value.relancesPaiement ?? '')) return reply(400, { code: 'P0001', message: 'Vérifiez les montants, durées et jours de rappel' });
    if (row()) row().value = clone(value); else f.tables.app_settings.push({ key: 'business', value: clone(value) });
    return reply(200, value);
  });
  return server;
}

async function fixture(browser, layout, { role = 'directeur', permissions = null } = {}) {
  const f = await setup(browser, role);
  f.page.setDefaultTimeout(10000);
  f.layout = { ...layout, tag: tagOf(layout), mobile: layout.width < 1024 };
  await f.page.setViewportSize({ width: layout.width, height: layout.height });
  await f.context.addInitScript(value => { try { localStorage.setItem('expedile-theme', value); } catch { /* storage blocked */ } }, layout.theme);
  if (permissions) { const row = { staff_id: ids.S, ...permissions }; f.tables.staff_permissions = [row]; f.tables.staff_users[0].staff_permissions = [row]; }
  f.tables.app_settings.find(item => item.key === 'business').value = clone(BUSINESS);
  f.server = await mockServer(f);
  return f;
}
/** Each check starts from the stored object above, without a draft of an earlier check. */
async function reset(f) {
  f.tables.app_settings.find(item => item.key === 'business').value = clone(BUSINESS);
  Object.assign(f.server, { calls: [], beforeSave: null, failRead: false });
  await f.page.evaluate(() => { for (const key of Object.keys(sessionStorage)) if (key.startsWith('expedile:draft:')) sessionStorage.removeItem(key); });
}
const stored = f => f.tables.app_settings.find(item => item.key === 'business').value;

async function axe(f, label) {
  const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `axe · ${label}`);
}
const noPageOverflow = async (f, label) => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No horizontal scroll (${label}).`);
/** The page scrolls inside the application shell: grow the viewport to capture all of it. */
async function tallShot(f, name) {
  const viewport = f.page.viewportSize();
  const height = await f.page.evaluate(() => { const scroller = [...document.querySelectorAll('.overflow-y-auto')].filter(node => node.scrollHeight > node.clientHeight + 2).sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; return scroller ? scroller.scrollHeight + innerHeight - scroller.clientHeight : document.documentElement.scrollHeight; });
  await f.page.setViewportSize({ width: viewport.width, height: Math.min(6000, Math.max(viewport.height, height)) });
  await f.page.waitForTimeout(150);
  await f.page.screenshot({ path: `${output}/${name}-${f.layout.tag}.png` });
  await f.page.setViewportSize(viewport);
}
const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);

const panelOf = f => f.page.getByTestId('settings-panel');
const exporter = f => panelOf(f).getByRole('group', { name: 'Expéditeur', exact: true });
const consignee = (f, name) => panelOf(f).getByRole('group', { name, exact: true });
const block = (f, key) => panelOf(f).locator(`details[data-consignee="${key}"]`);
const field = (group, key) => group.getByLabel(LABELS[key], { exact: true });
const button = (f, name) => panelOf(f).getByRole('button', { name, exact: true });
const isOpen = (f, key) => block(f, key).evaluate(node => node.open);
async function openBlock(f, key) { if (!await isOpen(f, key)) await block(f, key).locator(':scope > summary').click(); }
async function fill(group, values) { for (const [key, value] of Object.entries(values)) await field(group, key).fill(value); }
async function values(group) { return Object.fromEntries(await Promise.all(PARTY_FIELDS.map(async key => [key, await field(group, key).inputValue()]))); }
const stateOf = locator => locator.locator('[data-party-state]').first().evaluate(node => [node.dataset.partyState, node.textContent.trim()]);
/** The state shows the warning sign (amber), not a check or a neutral grey text. */
const warns = async locator => (await locator.locator('[data-party-state] svg.lucide-alert-triangle').count()) > 0;
/** Waits for a row to reach a state (the page may take a moment to render it on a slower machine). */
const reaches = (locator, state) => locator.locator(`[data-party-state="${state}"]`).first().waitFor();
async function open(f) {
  await f.page.goto(`${base}/settings?tab=facture`);
  await panelOf(f).getByRole('heading', { name: 'Facture commerciale', exact: true }).waitFor();
}

// ── 1 · The panel as the stored identity sets it ───────────────────────────
async function checkPanel(f) {
  await reset(f); await open(f);
  const panel = panelOf(f);
  // Reached like every rubric: under « Documents » on a desktop, in the rubric list on a phone.
  if (f.layout.mobile) {
    const select = f.page.getByLabel('Rubrique', { exact: true });
    assert.equal(await select.evaluate(node => node.selectedOptions[0].textContent), 'Facture commerciale');
  } else {
    const nav = f.page.getByRole('navigation', { name: 'Paramètres', exact: true });
    assert.deepEqual(await nav.locator('p').allTextContents(), ['Tarifs et règles', 'Documents', 'Communication', 'Équipe']);
    assert.deepEqual(await nav.getByRole('button').allTextContents(), ['Tarifs de transport', 'Catégories et taxes', 'Stockage et rappels', 'Produits interdits', 'Facture commerciale', 'Canaux de contact', 'Modèles de messages', 'Équipe et accès']);
    assert.equal(await nav.getByRole('button', { name: 'Facture commerciale', exact: true }).getAttribute('aria-current'), 'page');
  }
  assert.equal(flat(await panel.getByText(/^Brouillon conservé/).innerText()), DRAFT_HELP);
  // The exporter: Expedîle by default, its address still to set (never invented).
  const sender = exporter(f);
  await sender.getByText('Imprimé en haut de chaque facture commerciale, comme expéditeur sur les étiquettes des colis et, avec les mentions légales ci-dessous, en haut des devis.', { exact: true }).waitFor();
  assert.deepEqual(await sender.locator('input').evaluateAll(nodes => nodes.map(node => node.id)), PARTY_FIELDS.map(key => `invoice-expediteur-${key}`));
  assert.deepEqual(await sender.locator('label').allTextContents(), PARTY_FIELDS.map(key => LABELS[key]));
  assert.deepEqual(await values(sender), full({ nom: 'Expedîle' }));
  assert.deepEqual(await stateOf(sender), ['incomplete', 'À compléter']);
  // The required fields are marked, beside their label (which stays the field's name).
  for (const key of PARTY_FIELDS) {
    const required = REQUIRED.includes(key), input = field(sender, key);
    assert.equal(await input.getAttribute('aria-required'), required ? 'true' : null, `${key}: aria-required`);
    assert.equal(await input.evaluate(node => node.parentElement.firstElementChild.textContent.includes('obligatoire')), required, `${key}: marked « obligatoire »`);
  }
  // The consignees: the default one, then each destination, collapsed, each saying whether it is set.
  await panel.getByText('Imprimé en haut de la facture commerciale d’un départ : le destinataire de sa destination, sinon le destinataire par défaut.', { exact: true }).waitFor();
  assert.deepEqual(await panel.locator('details[data-consignee]').evaluateAll(nodes => nodes.map(node => [node.dataset.consignee, node.open])), BLOCKS.map(([key]) => [key, false]));
  // Mayotte, Guadeloupe and Martinique have no consignee of their own: the default one is missing, and says so.
  const expectedStates = { defaut: ['none', 'Non réglé'], 974: ['set', 'Réglé'], 976: ['none', 'Non réglé'], 971: ['none', 'Non réglé'], 972: ['none', 'Non réglé'] };
  for (const [key, title] of BLOCKS) {
    const summary = block(f, key).locator(':scope > summary');
    assert.equal(await summary.locator('.font-semibold').first().textContent(), title);
    assert.deepEqual(await stateOf(summary), expectedStates[key], `${title}: its state`);
    assert.equal(await warns(summary), expectedStates[key][0] === 'none', `${title}: a warning when not set`);
  }
  assert.equal(flat(await block(f, '974').locator(':scope > summary').innerText()), 'La Réunion Expedîle · 97490 Sainte-Clotilde Réglé');
  // La Réunion opens on the stored consignee, editable; the destinations say how to fall back on the default one.
  await openBlock(f, '974');
  const reunion = consignee(f, 'Destinataire · La Réunion');
  await reunion.getByText('Laissez vide pour utiliser le destinataire par défaut.', { exact: true }).waitFor();
  assert.deepEqual(await values(reunion), full(REUNION));
  assert.equal(await field(reunion, 'adresse').isEditable(), true);
  await openBlock(f, 'defaut');
  await consignee(f, 'Destinataire par défaut').getByText('Utilisé pour toute destination sans destinataire propre.', { exact: true }).waitFor();
  // Touch targets: every row, field and button is 44 px high or more.
  const small = await panel.locator('summary, input, button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => ({ name: node.id || node.textContent.trim().slice(0, 40), height: node.getBoundingClientRect().height })).filter(item => item.height < 44));
  assert.deepEqual(small, [], 'Touch targets of 44 px.');
  await noPageOverflow(f, 'panel'); await axe(f, 'panel');
  await tallShot(f, 'facture-panel');
}

// ── 1b · The default consignee warns while a destination relies on it, and only then ──
const OWN_CONSIGNEES = {
  976: { nom: 'Transitaire Mayotte (essai)', adresse: '1 rue du Port', codePostal: '97600', ville: 'Mamoudzou', pays: 'Mayotte (France)' },
  971: { nom: 'Transitaire Guadeloupe (essai)', adresse: '1 quai de l’Essai', codePostal: '97110', ville: 'Pointe-à-Pitre', pays: 'Guadeloupe (France)' },
  972: { nom: 'Transitaire Martinique (essai)', adresse: '2 quai de l’Essai', codePostal: '97200', ville: 'Fort-de-France', pays: 'Martinique (France)' },
};
async function checkDefaultConsignee(f) {
  await reset(f);
  stored(f).factureCommerciale.destinataires = { 974: REUNION, ...clone(OWN_CONSIGNEES) };
  await open(f);
  const row = key => block(f, key).locator(':scope > summary');
  // Every destination has its own consignee: the default one is optional, without a warning.
  for (const key of ['974', '976', '971', '972']) assert.deepEqual(await stateOf(row(key)), ['set', 'Réglé'], key);
  assert.deepEqual(await stateOf(row('defaut')), ['optional', 'Non réglé']);
  assert.equal(await warns(row('defaut')), false, 'No warning while no destination relies on the default consignee.');
  // Martinique emptied relies on the default consignee again: both rows warn, before any save.
  await openBlock(f, '972');
  for (const key of PARTY_FIELDS) await field(consignee(f, 'Destinataire · Martinique'), key).fill('');
  await reaches(row('972'), 'none'); await reaches(row('defaut'), 'none');
  assert.deepEqual(await stateOf(row('defaut')), ['none', 'Non réglé']);
  assert.equal(await warns(row('defaut')), true, 'The default consignee is needed again: it warns as Martinique does.');
  assert.equal(await warns(row('972')), true);
  assert.equal(f.server.calls.length, 0);
}

// ── 1c · The fields of a row line up: a label and its « obligatoire » never push a field below its neighbour ──
async function checkRows(f) {
  await reset(f); await open(f);
  await openBlock(f, '974');
  await field(consignee(f, 'Destinataire · La Réunion'), 'ville').waitFor();
  const misaligned = await panelOf(f).locator('details[data-consignee="974"] .grid, [role="group"][aria-labelledby="invoice-expediteur-title"] .grid, [role="group"][aria-labelledby="invoice-legal-title"] .grid').evaluateAll(grids => grids.flatMap(grid => {
    const boxes = [...grid.querySelectorAll('input')].filter(node => node.getClientRects().length).map(node => ({ id: node.id, box: node.getBoundingClientRect() }));
    return boxes.flatMap((a, index) => boxes.slice(index + 1)
      .filter(b => a.box.top < b.box.bottom && b.box.top < a.box.bottom && Math.abs(a.box.top - b.box.top) > 0.5)
      .map(b => `${a.id} (${Math.round(a.box.top)}) / ${b.id} (${Math.round(b.box.top)})`));
  }));
  assert.deepEqual(misaligned, [], 'The fields of a row start at the same height.');
  await noPageOverflow(f, 'rows');
  if (TABLETS.some(layout => tagOf(layout) === f.layout.tag)) await tallShot(f, 'facture-tablet');
}

// ── 2 · Inline errors, nothing sent ────────────────────────────────────────
const ERRORS = {
  'expediteur-adresse': 'Indiquez l’adresse.', 'expediteur-codePostal': 'Indiquez le code postal.', 'expediteur-ville': 'Indiquez la ville.', 'expediteur-pays': 'Indiquez le pays.',
  'expediteur-email': 'Indiquez une adresse email valide, par exemple contact@exemple.fr.', 'expediteur-siret': 'Un SIRET compte 14 chiffres.',
  'expediteur-eori': 'Un numéro EORI commence par deux lettres (FR…) suivies de 15 caractères au plus.',
  'destinataires-971-adresse': 'Indiquez l’adresse.', 'destinataires-971-codePostal': 'Indiquez le code postal.', 'destinataires-971-ville': 'Indiquez la ville.', 'destinataires-971-pays': 'Indiquez le pays.',
};
async function checkErrors(f) {
  await reset(f); await open(f);
  const sender = exporter(f);
  await fill(sender, { email: 'contact', siret: '123', eori: '12' });
  // Guadeloupe started but left incomplete, its block closed again: the save opens it on its errors.
  await openBlock(f, '971');
  await fill(consignee(f, 'Destinataire · Guadeloupe'), { nom: 'Transit Antilles' });
  assert.deepEqual(await stateOf(block(f, '971').locator(':scope > summary')), ['incomplete', 'À compléter']);
  await block(f, '971').locator(':scope > summary').click();
  // What a screen reader announces when the focus lands: the field already marked wrong, with its message.
  await f.page.evaluate(() => {
    window.focusLanding = null;
    document.addEventListener('focusin', event => {
      const node = event.target, described = node.getAttribute('aria-describedby');
      if (node.tagName === 'INPUT' && !window.focusLanding) window.focusLanding = { id: node.id, invalid: node.getAttribute('aria-invalid'), message: described ? document.getElementById(described)?.textContent ?? null : null };
    });
  });
  await button(f, 'Enregistrer').click();
  await f.page.locator('#invoice-expediteur-adresse-error').waitFor();
  assert.deepEqual(await f.page.evaluate(() => window.focusLanding), { id: 'invoice-expediteur-adresse', invalid: 'true', message: 'Indiquez l’adresse.' });
  // The first wrong field, its label and its message are in view, under no bar.
  await f.page.waitForFunction(() => {
    const node = document.activeElement, parts = [node, document.querySelector(`label[for="${node.id}"]`), document.getElementById(`${node.id}-error`)];
    return parts.every(part => { const box = part?.getBoundingClientRect(); const hit = box && document.elementFromPoint(box.left + Math.min(box.width / 2, 20), box.top + box.height / 2); return Boolean(hit) && (hit === part || part.contains(hit)); });
  });
  for (const [id, message] of Object.entries(ERRORS)) {
    assert.equal(await f.page.locator(`#invoice-${id}-error`).textContent(), message, id);
    const input = f.page.locator(`#invoice-${id}`);
    assert.equal(await input.getAttribute('aria-invalid'), 'true', `${id}: aria-invalid`);
    assert.equal(await input.getAttribute('aria-describedby'), `invoice-${id}-error`, `${id}: described by its message`);
  }
  assert.equal(await panelOf(f).locator('[aria-invalid="true"]').count(), Object.keys(ERRORS).length, 'Only the wrong fields are marked.');
  assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'invoice-expediteur-adresse', 'The first wrong field takes the focus.');
  assert.equal(await isOpen(f, '971'), true, 'A block holding an error opens.');
  assert.equal(await isOpen(f, '974'), false, 'A block without error stays as it was.');
  const [red, green] = rgb(await f.page.locator('#invoice-expediteur-codePostal').evaluate(node => getComputedStyle(node).borderTopColor));
  assert.ok(red > green + 40, `A wrong field is outlined in red in ${f.layout.theme} (${red}, ${green}).`);
  assert.equal(f.server.calls.length, 0, 'An invalid form sends nothing.');
  assert.equal(await panelOf(f).getByRole('alert').count(), 0, 'Errors stay under their field, without a banner.');
  await noPageOverflow(f, 'errors'); await axe(f, 'errors');
  await tallShot(f, 'facture-errors');
  // Correcting a field removes its own message only.
  await field(sender, 'adresse').fill(EXPORTER.adresse);
  assert.equal(await f.page.locator('#invoice-expediteur-adresse-error').count(), 0);
  assert.equal(await f.page.locator('#invoice-expediteur-adresse').getAttribute('aria-invalid'), null);
  assert.equal(await f.page.locator('#invoice-expediteur-ville-error').count(), 1);
}

// ── 3 · A save: the whole stored object, factureCommerciale replaced, then read back ──
const SAVED_IDENTITY = {
  expediteur: exporterFull({ nom: 'Expedîle', ...EXPORTER, siret: '12345678900012', eori: 'FR12345678900012' }),
  destinataires: { defaut: full(FALLBACK), 974: full({ ...REUNION, complement: 'Immeuble Thales, 1er étage' }) },
};
async function fillValidForm(f) {
  await fill(exporter(f), EXPORTER);
  await openBlock(f, 'defaut'); await fill(consignee(f, 'Destinataire par défaut'), FALLBACK);
  await openBlock(f, '974'); await field(consignee(f, 'Destinataire · La Réunion'), 'complement').fill('Immeuble Thales, 1er étage');
}
async function checkSave(f) {
  await reset(f); await open(f);
  await fillValidForm(f);
  // Before the save, each row already says what the form holds: the empty destinations use the default consignee.
  assert.deepEqual(await stateOf(exporter(f)), ['set', 'Réglé']);
  for (const key of ['976', '971', '972']) assert.deepEqual(await stateOf(block(f, key).locator(':scope > summary')), ['default', 'Destinataire par défaut utilisé'], key);
  assert.deepEqual(await stateOf(block(f, 'defaut').locator(':scope > summary')), ['set', 'Réglé']);
  await button(f, 'Enregistrer').click();
  await panelOf(f).getByRole('status').filter({ hasText: SAVED }).waitFor();
  // One command: the stored object, every key kept, factureCommerciale replaced; the stored one as expected version.
  const expected = { ...BUSINESS, factureCommerciale: SAVED_IDENTITY };
  assert.equal(f.server.calls.length, 1);
  assert.deepEqual(f.server.calls[0], { p_key: 'business', p_value: expected, p_expected: BUSINESS });
  assert.deepEqual(stored(f), expected, 'No stored key is dropped.');
  assert.deepEqual(Object.keys(stored(f).factureCommerciale.destinataires).sort(), ['974', 'defaut'], 'An empty destination is not stored: the default consignee is used.');
  // The screen shows the saved values (SIRET and EORI as stored), without error.
  assert.equal(await field(exporter(f), 'siret').inputValue(), '12345678900012');
  assert.equal(await field(exporter(f), 'eori').inputValue(), 'FR12345678900012');
  assert.equal(await panelOf(f).locator('[aria-invalid="true"]').count(), 0);
  await noPageOverflow(f, 'saved'); await axe(f, 'saved');
  await tallShot(f, 'facture-saved');
  // Even with wider fonts (Linux, a larger text setting), each row's name stays whole on its line, clear of
  // its state: the state goes under it (a summary breaks a word that does not fit, brand.css).
  const wider = await f.page.addStyleTag({ content: 'details[data-consignee] > summary { letter-spacing: .1em; }' });
  const crowded = await panelOf(f).locator('details[data-consignee] > summary').evaluateAll(rows => rows.filter(row => {
    const range = document.createRange(); range.selectNodeContents(row.querySelector('.font-semibold'));
    const name = range.getBoundingClientRect(), state = row.querySelector('[data-party-state]').getBoundingClientRect(), edge = row.getBoundingClientRect().right;
    return range.getClientRects().length !== 1 || (name.right > state.left && name.left < state.right && name.bottom > state.top && name.top < state.bottom) || name.right > edge + 0.5 || state.right > edge + 0.5;
  }).map(row => row.parentElement.dataset.consignee));
  await wider.evaluate(node => node.remove());
  assert.deepEqual(crowded, [], 'Each name stays clear of its state.');
  // Read again from the database: without any draft, after a reload, the stored values come back.
  await f.page.evaluate(() => { for (const key of Object.keys(sessionStorage)) if (key.startsWith('expedile:draft:')) sessionStorage.removeItem(key); });
  await f.page.reload();
  await panelOf(f).getByRole('heading', { name: 'Facture commerciale', exact: true }).waitFor();
  assert.deepEqual(await values(exporter(f)), full(SAVED_IDENTITY.expediteur));
  await openBlock(f, '974');
  assert.deepEqual(await values(consignee(f, 'Destinataire · La Réunion')), SAVED_IDENTITY.destinataires['974']);
  assert.equal(flat(await block(f, '976').locator(':scope > summary').innerText()), 'Mayotte Destinataire par défaut utilisé');
  // A destination emptied again goes back to the default consignee, the other keys untouched.
  await field(consignee(f, 'Destinataire · La Réunion'), 'nom').fill('');
  for (const key of ['adresse', 'complement', 'codePostal', 'ville', 'pays']) await field(consignee(f, 'Destinataire · La Réunion'), key).fill('');
  assert.deepEqual(await stateOf(block(f, '974').locator(':scope > summary')), ['default', 'Destinataire par défaut utilisé']);
  await button(f, 'Enregistrer').click();
  await panelOf(f).getByRole('status').filter({ hasText: SAVED }).waitFor();
  assert.equal(f.server.calls.length, 2);
  assert.deepEqual(f.server.calls[1].p_expected, expected);
  assert.deepEqual(stored(f), { ...BUSINESS, factureCommerciale: { ...SAVED_IDENTITY, destinataires: { defaut: full(FALLBACK) } } });
}

// ── 3b · The quote's legal mentions (F10): their own group, a state that says what is missing, checked and stored ──
const legalGroup = f => panelOf(f).getByRole('group', { name: 'Mentions légales des devis', exact: true });
async function checkLegal(f) {
  await reset(f); await open(f);
  const legal = legalGroup(f);
  await legal.getByText('Imprimées en haut de chaque devis PDF avec le nom, l’adresse du siège, le SIRET et le numéro de TVA de l’expéditeur ci-dessus. Tant qu’une mention manque, le devis remis au client garde son en-tête actuel : aucune valeur n’est inventée.', { exact: true }).waitFor();
  assert.deepEqual(await legal.locator('input').evaluateAll(nodes => nodes.map(node => node.id)), LEGAL_FIELDS.map(key => `invoice-expediteur-${key}`));
  assert.deepEqual(await legal.locator('label').allTextContents(), LEGAL_FIELDS.map(key => LEGAL_LABELS[key]));
  for (const key of LEGAL_FIELDS) {
    const input = legal.getByLabel(LEGAL_LABELS[key], { exact: true });
    assert.equal(await input.getAttribute('aria-required'), null, `${key}: optional for the commercial invoice`);
    assert.equal(await f.page.locator(`#${await input.getAttribute('aria-describedby')}`).textContent(), LEGAL_HELP[key], `${key}: its example, announced with the field`);
  }
  // Nothing stored but the name the form proposes: the state says what the quote still lacks, in amber.
  assert.deepEqual(await stateOf(legal), ['legal-missing', 'À compléter']);
  assert.equal(await warns(legal), true);
  assert.equal(flat(await legal.getByTestId('invoice-legal-missing').innerText()), 'À compléter : forme juridique, capital social, adresse du siège, code postal du siège, ville du siège, SIRET, ville du greffe (RCS), numéro de TVA.');
  // The exporter, then the mentions as one would type them: complete before any save.
  await fill(exporter(f), EXPORTER);
  assert.equal(flat(await legal.getByTestId('invoice-legal-missing').innerText()), 'À compléter : forme juridique, capital social, ville du greffe (RCS).');
  const mention = key => legal.getByLabel(LEGAL_LABELS[key], { exact: true });
  await mention('formeJuridique').fill('SAS'); await mention('capital').fill('dix mille'); await mention('rcsVille').fill('RCS Pontoise');
  assert.deepEqual(await stateOf(legal), ['legal-missing', 'À compléter'], 'A capital that is not an amount is still missing.');
  // Saved as typed: the wrong capital is refused under its field, it takes the focus, nothing is sent.
  await button(f, 'Enregistrer').click();
  await f.page.locator('#invoice-expediteur-capital-error').waitFor();
  assert.equal(await f.page.locator('#invoice-expediteur-capital-error').textContent(), 'Indiquez le capital social en euros, par exemple 10 000.');
  assert.equal(await mention('capital').getAttribute('aria-describedby'), 'invoice-expediteur-capital-help invoice-expediteur-capital-error');
  assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'invoice-expediteur-capital');
  assert.equal(f.server.calls.length, 0);
  await noPageOverflow(f, 'legal error'); await axe(f, 'legal error');
  await mention('capital').fill('10 000');
  assert.deepEqual(await stateOf(legal), ['legal-set', 'Complètes']);
  assert.equal(await warns(legal), false);
  assert.equal(await legal.getByTestId('invoice-legal-missing').count(), 0);
  await button(f, 'Enregistrer').click();
  await panelOf(f).getByRole('status').filter({ hasText: SAVED }).waitFor();
  // Stored with the exporter, tidied (digits, the town alone), every other key kept.
  const expected = { ...BUSINESS, factureCommerciale: { ...BUSINESS.factureCommerciale, expediteur: exporterFull({ nom: 'Expedîle', ...EXPORTER, siret: '12345678900012', eori: 'FR12345678900012', formeJuridique: 'SAS', capital: '10000', rcsVille: 'Pontoise' }), destinataires: { 974: full(REUNION) } } };
  assert.deepEqual(f.server.calls[0], { p_key: 'business', p_value: expected, p_expected: BUSINESS });
  assert.deepEqual(stored(f), expected);
  // Read back from the database: the stored mentions, complete.
  await f.page.evaluate(() => { for (const key of Object.keys(sessionStorage)) if (key.startsWith('expedile:draft:')) sessionStorage.removeItem(key); });
  await f.page.reload();
  await panelOf(f).getByRole('heading', { name: 'Facture commerciale', exact: true }).waitFor();
  assert.deepEqual(await Promise.all(LEGAL_FIELDS.map(key => legalGroup(f).getByLabel(LEGAL_LABELS[key], { exact: true }).inputValue())), ['SAS', '10000', 'Pontoise']);
  assert.deepEqual(await stateOf(legalGroup(f)), ['legal-set', 'Complètes']);
  const small = await legalGroup(f).locator('input').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height < 44).map(node => node.id));
  assert.deepEqual(small, [], 'Touch targets of 44 px.');
  await noPageOverflow(f, 'legal'); await axe(f, 'legal');
  await tallShot(f, 'facture-legal');
}

// ── 4 · Reload and conflicts: a colleague's save is never written over ─────
async function checkConflicts(f) {
  await reset(f); await open(f);
  const sender = exporter(f);
  // « Annuler et recharger » reads the database again: a colleague's change shows, the draft is dropped.
  await field(sender, 'adresse').fill('Brouillon à abandonner');
  stored(f).factureCommerciale.destinataires['974'].complement = 'Bâtiment B';
  await button(f, 'Annuler et recharger').click();
  await panelOf(f).getByRole('status').filter({ hasText: RELOADED }).waitFor();
  assert.equal(await field(sender, 'adresse').inputValue(), '');
  await openBlock(f, '974');
  assert.equal(await field(consignee(f, 'Destinataire · La Réunion'), 'complement').inputValue(), 'Bâtiment B');
  assert.equal(f.server.calls.length, 0, 'A reload saves nothing.');
  // A colleague saved another identity while this form was being filled: nothing is sent.
  await fill(sender, EXPORTER);
  stored(f).factureCommerciale.destinataires['974'].complement = 'Bâtiment C';
  await button(f, 'Enregistrer').click();
  const alert = panelOf(f).getByRole('alert').filter({ hasText: 'modifiés entre-temps' });
  await alert.waitFor();
  assert.equal(flat(await alert.locator('p').innerText()), CONFLICT);
  assert.equal(f.server.calls.length, 0, 'The other identity is never written over.');
  assert.equal(await field(sender, 'adresse').inputValue(), EXPORTER.adresse, 'The typed values stay until the reload.');
  await noPageOverflow(f, 'conflict'); await axe(f, 'conflict');
  await tallShot(f, 'facture-conflict');
  await alert.getByRole('button', { name: 'Recharger les valeurs enregistrées', exact: true }).click();
  await panelOf(f).getByRole('status').filter({ hasText: RELOADED }).waitFor();
  assert.equal(await panelOf(f).getByRole('alert').count(), 0);
  assert.equal(await field(sender, 'adresse').inputValue(), '');
  assert.equal(await field(consignee(f, 'Destinataire · La Réunion'), 'complement').inputValue(), 'Bâtiment C');
  // The server refuses a stale version (40001): a colleague saved between this page's read and its save.
  await fill(sender, EXPORTER);
  f.server.beforeSave = value => { value.fraisStockage = '2.00'; };
  await button(f, 'Enregistrer').click();
  await alert.waitFor();
  assert.equal(await panelOf(f).getByRole('status').count(), 0, 'No success is shown for a refused save.');
  assert.equal(f.server.calls.length, 1);
  assert.equal(stored(f).fraisStockage, '2.00'); assert.deepEqual(stored(f).factureCommerciale.expediteur, undefined, 'Refused: nothing of this form is stored.');
  await alert.getByRole('button', { name: 'Recharger les valeurs enregistrées', exact: true }).click();
  await panelOf(f).getByRole('status').filter({ hasText: RELOADED }).waitFor();
  await fill(sender, EXPORTER);
  await button(f, 'Enregistrer').click();
  await panelOf(f).getByRole('status').filter({ hasText: SAVED }).waitFor();
  assert.equal(f.server.calls.length, 2);
  assert.equal(f.server.calls[1].p_value.fraisStockage, '2.00', 'The colleague\'s value is kept.');
  assert.equal(f.server.calls[1].p_expected.fraisStockage, '2.00', 'The save expects the version read again.');
  assert.deepEqual(stored(f).factureCommerciale.expediteur, SAVED_IDENTITY.expediteur);
}

// ── 5 · Keyboard ───────────────────────────────────────────────────────────
async function checkKeyboard(f) {
  await reset(f); await open(f);
  const summary = key => block(f, key).locator(':scope > summary');
  // From the exporter's last field, its legal mentions, then the first consignee row; Enter opens it, Tab enters it.
  await f.page.locator('#invoice-expediteur-tva').focus();
  for (const key of LEGAL_FIELDS) { await f.page.keyboard.press('Tab'); assert.equal(await f.page.evaluate(() => document.activeElement?.id), `invoice-expediteur-${key}`); }
  await f.page.keyboard.press('Tab');
  assert.equal(await summary('defaut').evaluate(node => node === document.activeElement), true, 'Tab reaches the default consignee row.');
  const ring = await summary('defaut').evaluate(node => { const style = getComputedStyle(node); return [style.outlineStyle, style.outlineWidth]; });
  assert.deepEqual(ring, ['solid', '3px'], 'The row shows the focus ring.');
  await f.page.keyboard.press('Enter');
  assert.equal(await isOpen(f, 'defaut'), true, 'Enter opens a row.');
  await f.page.keyboard.press('Tab');
  assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'invoice-destinataires-defaut-nom');
  await f.page.keyboard.press('Shift+Tab'); await f.page.keyboard.press('Space');
  assert.equal(await isOpen(f, 'defaut'), false, 'Space closes it.');
  await f.page.keyboard.press('Tab');
  assert.equal(await summary('974').evaluate(node => node === document.activeElement), true, 'Then La Réunion.');
  // Saving from the keyboard: the focus comes back to the button once the save is over.
  await fill(exporter(f), EXPORTER);
  await button(f, 'Enregistrer').focus();
  await f.page.keyboard.press('Enter');
  await panelOf(f).getByRole('status').filter({ hasText: SAVED }).waitFor();
  await f.page.waitForFunction(() => document.activeElement?.textContent === 'Enregistrer');
  assert.equal(f.server.calls.length, 1);
}

// ── 6 · Stockage et rappels and Facture commerciale save the same object: one never blocks the other ──
async function openRubric(f, label) {
  if (f.layout.mobile) await f.page.getByLabel('Rubrique', { exact: true }).selectOption({ label });
  else await f.page.getByRole('navigation', { name: 'Paramètres', exact: true }).getByRole('button', { name: label, exact: true }).click();
  await panelOf(f).getByRole('heading', { name: label, exact: true }).waitFor();
}
async function checkTwoPanels(f) {
  await reset(f);
  // A storage price typed first (its draft kept), then the invoice identity saved.
  await f.page.goto(`${base}/settings?tab=metier`);
  await panelOf(f).getByRole('heading', { name: 'Stockage et rappels', exact: true }).waitFor();
  await f.page.getByLabel('Frais de stockage', { exact: true }).fill('2.5');
  await openRubric(f, 'Facture commerciale');
  await fill(exporter(f), EXPORTER);
  await button(f, 'Enregistrer').click();
  await panelOf(f).getByRole('status').filter({ hasText: SAVED }).waitFor();
  const withIdentity = clone(stored(f));
  // Back to Stockage et rappels: the typed price is still there and saves without a conflict, the identity kept.
  await openRubric(f, 'Stockage et rappels');
  assert.equal(await f.page.getByLabel('Frais de stockage', { exact: true }).inputValue(), '2.5');
  await panelOf(f).getByRole('button', { name: 'Enregistrer les règles', exact: true }).click();
  await panelOf(f).getByText('Règles enregistrées. Les devis déjà enregistrés conservent leur version.', { exact: true }).waitFor();
  assert.deepEqual(f.server.calls[1], { p_key: 'business', p_value: { ...withIdentity, fraisStockage: 2.5, stockageGratuit: 14, diviseurVolumetrique: 5000 }, p_expected: withIdentity });
  assert.deepEqual(stored(f).factureCommerciale, withIdentity.factureCommerciale);
  // And the identity again, after the storage rules: saved without a conflict, the storage price kept.
  await openRubric(f, 'Facture commerciale');
  await field(exporter(f), 'telephone').fill('01 98 76 54 32');
  await button(f, 'Enregistrer').click();
  await panelOf(f).getByRole('status').filter({ hasText: SAVED }).waitFor();
  assert.equal(f.server.calls.length, 3);
  assert.equal(stored(f).fraisStockage, 2.5);
  assert.equal(stored(f).factureCommerciale.expediteur.telephone, '01 98 76 54 32');
}

// ── 7 · The stored storage rules are incomplete; the stored object cannot be read ──
async function checkBlockedAndUnreadable(f) {
  await reset(f);
  delete stored(f).fraisStockage;
  await open(f);
  await fill(exporter(f), EXPORTER);
  await button(f, 'Enregistrer').click();
  const error = panelOf(f).getByRole('alert').filter({ hasText: 'Stockage et rappels' });
  await error.waitFor();
  assert.equal(flat(await error.innerText()), 'Les règles de « Stockage et rappels » sont incomplètes : enregistrez-les d’abord, car les réglages de la facture commerciale sont enregistrés avec elles. Votre saisie est conservée.');
  assert.equal(f.server.calls.length, 0, 'Nothing the server would refuse is sent.');
  // The stored object cannot be read again before the save: nothing is sent, the typed values stay.
  await reset(f); await open(f);
  await fill(exporter(f), EXPORTER);
  f.server.failRead = true;
  await button(f, 'Enregistrer').click();
  const failure = panelOf(f).getByRole('alert').filter({ hasText: 'Lecture des réglages indisponible (essai)' });
  await failure.waitFor();
  assert.match(flat(await failure.innerText()), /Votre saisie est conservée\.$/);
  assert.equal(f.server.calls.length, 0);
  assert.equal(await field(exporter(f), 'adresse').inputValue(), EXPORTER.adresse);
  await button(f, 'Annuler et recharger').click();
  await panelOf(f).getByRole('alert').filter({ hasText: 'Lecture des réglages indisponible (essai)' }).waitFor();
  assert.equal(await field(exporter(f), 'adresse').inputValue(), EXPORTER.adresse, 'A failed reload keeps the draft.');
  f.server.failRead = false;
  await axe(f, 'unreadable');
}

// ── 8 · Permissions ────────────────────────────────────────────────────────
async function checkHiddenWithoutPermission(f) {
  await f.page.goto(`${base}/settings?tab=facture`);
  await f.page.getByRole('heading', { name: 'Modèles de messages', exact: true }).waitFor();
  assert.equal(await f.page.getByRole('heading', { name: 'Facture commerciale', exact: true }).count(), 0, 'The rubric opens on the first one allowed.');
  if (f.layout.mobile) assert.deepEqual(await f.page.getByLabel('Rubrique', { exact: true }).locator('option').allTextContents(), ['Modèles de messages']);
  else assert.equal(await f.page.getByRole('navigation', { name: 'Paramètres', exact: true }).getByRole('button', { name: 'Facture commerciale', exact: true }).count(), 0);
  assert.equal(await f.page.locator('[id^="invoice-"]').count(), 0);
  assert.equal(f.requests.filter(request => request.path.endsWith('/save_admin_setting')).length, 0);
}
async function checkAllowedByPermission(f) {
  await reset(f); await open(f);
  if (!f.layout.mobile) assert.deepEqual(await f.page.getByRole('navigation', { name: 'Paramètres', exact: true }).getByRole('button').allTextContents(), ['Stockage et rappels', 'Facture commerciale', 'Canaux de contact']);
  await fill(exporter(f), EXPORTER);
  await button(f, 'Enregistrer').click();
  await panelOf(f).getByRole('status').filter({ hasText: SAVED }).waitFor();
  assert.equal(f.server.calls.length, 1);
  await axe(f, 'allowed by permission');
}

// ── 9 · Configuration that could not load ──────────────────────────────────
async function checkFailedLoad(f) {
  f.server.failRead = true;
  await f.login();
  await f.page.goto(`${base}/settings?tab=facture`);
  const alert = panelOf(f).getByRole('alert');
  await alert.getByRole('heading', { name: 'Chargement impossible', exact: true }).waitFor();
  assert.equal(await panelOf(f).locator('input, select, textarea').count(), 0, 'Nothing is editable until the configuration is loaded.');
  await axe(f, 'failed load');
  f.server.failRead = false;
  await alert.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await panelOf(f).getByRole('heading', { name: 'Facture commerciale', exact: true }).waitFor();
  assert.equal(await field(exporter(f), 'adresse').isEditable(), true);
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
        console.log(JSON.stringify(results[results.length - 1]));
      }
    } finally { await f.context.close(); }
  }
  try {
    for (const layout of LAYOUTS) {
      await session('staff', layout, [
        ['panel', checkPanel],
        ['default-consignee', checkDefaultConsignee],
        ['rows', checkRows],
        ['errors', checkErrors],
        ['save', checkSave],
        ['legal', checkLegal],
        ['conflicts', checkConflicts],
        ['keyboard', checkKeyboard],
        ['two-panels', checkTwoPanels],
      ]);
    }
    for (const layout of TABLETS) await session('tablet', layout, [['rows', checkRows]]);
    await session('blocked', LAYOUTS[0], [['blocked-unreadable', checkBlockedAndUnreadable]]);
    await session('blocked', LAYOUTS[3], [['blocked-unreadable', checkBlockedAndUnreadable]]);
    // perm_admin_parametres opens the rubric (with Stockage et rappels and Canaux de contact); without it, hidden.
    for (const layout of [LAYOUTS[1], LAYOUTS[2]]) {
      await session('without-permission', layout, [['hidden-without-permission', checkHiddenWithoutPermission]], { role: 'logisticien', permissions: { perm_admin_templates: true } });
      await session('with-permission', layout, [['allowed-by-permission', checkAllowedByPermission]], { role: 'preparateur', permissions: { perm_admin_parametres: true } });
      await session('failed-load', layout, [['failed-load', checkFailedLoad]], { noLogin: true });
    }
  } finally {
    await browser.close();
    await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  }
  const failed = results.filter(item => !item.pass);
  console.log(JSON.stringify({ checks: results.length, failed: failed.map(item => item.test) }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
