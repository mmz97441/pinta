/* Mon travail, Tableau and Cartes: fictitious tasks, every remote request mocked.
   Nothing is claimed, saved or sent: layout, display preferences and drafts only. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_WORK_LAYOUT_OUT || '/tmp/pinta-work-layout';
const B = '88888888-1111-4111-8111-111111111111';
const results = [];
const row = (f, id) => f.page.locator(`[data-work-action="${id}"]`);
const todo = f => f.page.getByRole('region', { name: 'À faire', exact: true });
const displayButton = f => f.page.getByRole('button', { name: 'Affichage', exact: true });
const displayDialog = f => f.page.getByRole('dialog', { name: 'Affichage', exact: true });
// sortWorkActions: overdue, then work in progress (ties by id), then by deadline and age.
const ORDER = ['quote', 'documents', 'reply', 'reception', 'prepare', 'departure'];

async function fixture(browser, { dark = false, timezoneId, device } = {}) {
 const f = await setup(browser, 'directeur', { timezoneId, device });
 f.page.setDefaultTimeout(10000);
 // Screenshots never catch a tab underline halfway through its transition.
 await f.page.emulateMedia({ reducedMotion: 'reduce' });
 await f.context.addInitScript(theme => localStorage.setItem('expedile-theme', theme), dark ? 'dark' : 'light');
 const t = f.tables, colis = t.colis[0];
 t.staff_users.push({ id: B, auth_id: B, nom: 'Madly', role: 'directeur', actif: true, staff_permissions: {} });
 t.staff_work_preferences = [{ staff_id: ids.A, missions: ['reception', 'preparation', 'communication', 'documents', 'departures', 'coordination'], active_mission: null, density: 'comfortable', available: true, version: 1 }];
 const client = (id, nom, prenom = '') => ({ ...t.clients[0], id, nom, prenom, user_id: null, email: `${id.slice(0, 4)}@example.test` });
 t.clients.push(client('c2000000-0000-4000-8000-000000000002', 'Hoarau', 'Jean-Marc'), client('c3000000-0000-4000-8000-000000000003', 'Payet', 'Flavie'), client('c4000000-0000-4000-8000-000000000004', 'Boutique Kréol SARL'), client('c5000000-0000-4000-8000-000000000005', 'Abdallah', 'Mohamed'));
 const parcel = (id, ref, client_id, casier, nb_colis) => ({ ...colis, id, ref, client_id, casier, nb_colis, trackings: [], trackings_detail: [] });
 t.colis.push(
  parcel('d3980000-0000-4000-8000-000000000398', 'EXP-2026-0398', t.clients[1].id, 'B-12', 3),
  parcel('d4120000-0000-4000-8000-000000000412', 'EXP-2026-0412', t.clients[2].id, 'A-07', 3),
  parcel('d4200000-0000-4000-8000-000000000420', 'EXP-2026-0420', t.clients[2].id, 'C-07', 2),
  parcel('d3550000-0000-4000-8000-000000000355', 'EXP-2026-0355', t.clients[3].id, 'D-02', 5),
  parcel('d3620000-0000-4000-8000-000000000362', 'EXP-2026-0362', t.clients[4].id, 'B-04', 2),
  parcel('d3410000-0000-4000-8000-000000000341', 'EXP-2026-0341', t.clients[4].id, '', 1),
 );
 const [, q398, q412, q420, q355, q362, q341] = t.colis.map(item => item.id);
 // An invoice waiting for review shows its indicator on the document task.
 t.factures.push({ id: 'invoice-pending', colis_id: ids.P, vendeur: 'Boutique B', montant: 40, valide: false, fichier_url: ids.P + '/second.pdf', fichier_nom: 'second.pdf' });
 const day = 86400000, now = Date.now();
 const mk = (id, colis_id, kind, changes = {}) => ({ id, colis_id, kind, state: 'ready', assignee_id: ids.A, version: 1, created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z', ...changes });
 t.staff_work_actions = [
  mk('quote', q398, 'quote', { due_at: new Date(now - 2 * day).toISOString() }),
  mk('reply', q412, 'conversation', { state: 'in_progress' }),
  mk('documents', ids.P, 'documents', { state: 'in_progress' }),
  mk('reception', q420, 'reception', { due_at: new Date(now + day).toISOString() }),
  mk('prepare', q355, 'preparation', { created_at: '2026-10-01T09:00:00Z' }),
  mk('departure', q362, 'departure', { created_at: '2026-10-01T10:00:00Z' }),
  mk('waiting', q420, 'preparation', { state: 'waiting', waiting_reason: 'Vérification fournisseur', review_at: new Date(now + 3 * day).toISOString() }),
  mk('pool', q355, 'conversation', { assignee_id: null }),
  mk('relay', q341, 'departure', { state: 'in_progress', assignee_id: B, handoff_to: ids.A, handoff_note: 'Étiquettes à vérifier avant jeudi' }),
 ];
 return f;
}
// `writes`: the one command a scenario sends on purpose (the account's density).
function assertNoMutation(f, writes = []) {
 assert.equal(f.requests.some(request => /\/(mutate_staff_work_action|save_staff_work_preferences|queue_message|save_quote|save_invoice_review|save_preparation_measurements)$/.test(request.path) && !writes.some(path => request.path.endsWith('/' + path))), false, 'Display choices never write business data');
 assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
}
async function layoutOf(f, region = todo(f)) {
 await region.locator('[data-work-action]').first().waitFor();
 const tables = await region.locator('table').count(), cards = await region.locator('article[data-work-action]').count();
 return tables === 1 && cards === 0 ? 'table' : tables === 0 && cards > 0 ? 'cards' : `mixed (${tables} tables, ${cards} cards)`;
}
// A resize changes the layout on the next render: wait for it, then inspect.
async function settledLayout(f, expected) {
 await f.page.waitForFunction(expected => { const region = document.querySelector('section[aria-label="À faire"]'); return Boolean(region?.querySelector(expected === 'table' ? 'table' : 'article[data-work-action]')); }, expected).catch(() => {});
 return layoutOf(f);
}
async function assertSingleCopies(f) {
 for (const id of ORDER) assert.equal(await row(f, id).count(), 1, `[data-work-action="${id}"] is rendered once`);
 // On a phone the relay band stays folded until opened.
 const phone = await f.page.evaluate(() => innerWidth < 768);
 assert.equal(await row(f, 'relay').count(), phone ? 0 : 1, '[data-work-action="relay"] is rendered once, or folded on a phone');
}
// The staff shell clips the document: measure the page and the container that scrolls it
// (the shell's single <main>).
const pageOverflow = f => f.page.evaluate(() => {
 const main = document.querySelector('.work-page'), scroller = main?.parentElement;
 return document.documentElement.scrollWidth > innerWidth + 1
  || Boolean(main && main.scrollWidth > main.clientWidth + 1)
  || Boolean(scroller && scroller.scrollWidth > scroller.clientWidth + 1);
});
async function display(f) { await displayButton(f).click(); await displayDialog(f).waitFor(); return displayDialog(f); }
async function closeDisplay(f) { await displayDialog(f).getByRole('button', { name: 'Fermer l’affichage', exact: true }).click(); await displayDialog(f).waitFor({ state: 'hidden' }); }
async function chooseLayout(f, value) { const dialog = await display(f); await dialog.getByLabel('Affichage des tâches', { exact: true }).selectOption(value); await closeDisplay(f); }
const focused = locator => locator.evaluate(node => node === document.activeElement);
async function shot(f, name) { await f.page.mouse.move(0, 0); await f.page.screenshot({ path: path.join(output, name + '.png') }); }
async function axeClean(f, label) {
 const axe = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
 assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], label);
}
// WCAG relative luminance and contrast ratio of two computed rgb() colours.
const luminance = color => { const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + 0.05) / (dark + 0.05); };
// A filled command: its fill, text, shape and the first opaque background behind it.
const commandLook = locator => locator.evaluate(node => {
 let behind = getComputedStyle(document.body).backgroundColor;
 for (let parent = node.parentElement; parent; parent = parent.parentElement) { const color = getComputedStyle(parent).backgroundColor; if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { behind = color; break; } }
 const style = getComputedStyle(node);
 return { fill: style.backgroundColor, text: style.color, radius: style.borderRadius, weight: style.fontWeight, height: node.getBoundingClientRect().height, behind };
});
// The rendered lines of an element's text.
const lineCount = locator => locator.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); return new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size; });
// The bottom reserve of the shell's <main>, once settled: under reduced motion every
// change still runs a 0.01ms transition (brand.css), finished at the next frame.
const mainReserve = async (f, expected) => {
 await f.page.waitForFunction(value => getComputedStyle(document.querySelector('main')).paddingBottom === value, expected, { timeout: 2000 }).catch(() => {});
 return f.page.locator('main').evaluate(node => getComputedStyle(node).paddingBottom);
};
const loadFailure = (f, scope = f.page.locator('.work-page')) => scope.getByRole('alert').filter({ has: f.page.getByRole('heading', { name: 'Vos tâches n’ont pas pu être chargées', exact: true }) });
async function failColisLoad(f) {
 f.failColis = true;
 await f.context.route('**/rest/v1/colis?*', route => f.failColis && route.request().method() === 'GET' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Indisponibilité simulée' }) }) : route.fallback());
}

(async () => {
 await fs.mkdir(output, { recursive: true });
 const browser = await chromium.launch({ headless: true });
 async function scenario(name, callback, options = {}) {
  if (process.env.PINTA_WORK_LAYOUT_FILTER && !name.includes(process.env.PINTA_WORK_LAYOUT_FILTER)) return;
  const f = await fixture(browser, options);
  try {
   if (options.viewport) await f.page.setViewportSize(options.viewport);
   if (options.before) await options.before(f);
   await f.login(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
   await callback(f); assertNoMutation(f, options.writes); results.push({ test: name, pass: true });
  } catch (error) {
   process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
   await f.page.screenshot({ path: path.join(output, name + '-failure.png') }).catch(() => {});
   await fs.writeFile(path.join(output, name + '-failure.txt'), await f.page.locator('body').innerText().catch(() => ''));
  } finally { await f.context.close(); console.log(JSON.stringify({ test: name, pass: results.at(-1)?.test === name && results.at(-1).pass })); }
 }
 try {
  await scenario('automatic-layout-is-a-table-from-1280px-and-cards-below', async f => {
   for (const [width, expected] of [[1440, 'table'], [1280, 'table'], [1279, 'cards'], [1024, 'cards'], [768, 'cards'], [390, 'cards']]) {
    await f.page.setViewportSize({ width, height: 900 });
    assert.equal(await settledLayout(f, expected), expected, `${width}px after a resize`);
    await f.page.reload(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
    assert.equal(await layoutOf(f), expected, `${width}px after a reload`);
    await assertSingleCopies(f);
    assert.deepEqual(await todo(f).locator('[data-work-action]').evaluateAll(rows => rows.map(item => item.dataset.workAction)), ORDER, 'Server priority order in every layout');
    assert.equal(await pageOverflow(f), false, `${width}px: no page overflow`);
   }
   // The relay and the urgent task use the same choice, outside the main list.
   await f.page.setViewportSize({ width: 1440, height: 900 });
   const relay = f.page.getByRole('region', { name: 'Relais à accepter', exact: true });
   await relay.getByRole('heading', { name: 'Relais à accepter · 1', exact: true }).waitFor();
   // French spacing: non-breaking spaces before « : » and inside the quotes.
   await relay.getByText(/proposé par Madly\s:\s«\sÉtiquettes à vérifier avant jeudi\s»/).waitFor();
   await relay.getByRole('button', { name: 'Accepter et ouvrir', exact: true }).waitFor();
   await relay.getByRole('button', { name: 'Décliner', exact: true }).waitFor();
   assert.ok(await relay.evaluate(node => { const list = document.querySelector('[aria-label="À faire"]'); return node.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING; }), 'Relays sit above the list');
   assert.equal(await f.page.locator('a[href="#work-handoffs"]').count(), 0, 'No anchor link to the relays any more');
  });
  await scenario('table-cells-commands-and-deadline-follow-the-validated-layout', async f => {
   const table = todo(f).getByRole('table', { name: 'À faire', exact: true });
   assert.deepEqual(await table.getByRole('columnheader').allInnerTexts(), ['Tâche', 'Échéance', 'Dossier', 'Client', 'Casier', 'Cartons', 'Action']);
   assert.equal(await table.locator('thead th').first().evaluate(node => getComputedStyle(node).position), 'sticky');
   const quote = row(f, 'quote');
   await quote.getByRole('link', { name: 'Ouvrir Établir le devis — EXP-2026-0398', exact: true }).waitFor();
   await quote.getByRole('cell', { name: /^Dépassée · / }).waitFor();
   assert.equal(await quote.locator('td').first().evaluate(node => getComputedStyle(node).boxShadow.includes('inset')), true, 'Urgent rows carry the amber edge');
   assert.equal(await quote.getByRole('cell', { name: /^Dépassée · / }).locator('.work-due').evaluate(node => getComputedStyle(node).fontWeight), '700');
   assert.deepEqual(await quote.locator('td').allInnerTexts().then(cells => cells.slice(2, 6)), ['EXP-2026-0398', 'Jean-Marc Hoarau', 'B-12', '3']);
   // « Voir » only appears without a primary command; « Je m’en occupe » stays filled.
   assert.equal(await quote.getByRole('button', { name: 'Continuer', exact: true }).count(), 1);
   assert.equal(await quote.getByRole('button', { name: 'Voir', exact: true }).count(), 0);
   await row(f, 'reply').getByText('En cours', { exact: true }).waitFor();
   assert.equal(await row(f, 'reply').getByRole('button', { name: 'Voir', exact: true }).count(), 0);
   assert.equal(await quote.getByText('À faire', { exact: true }).count(), 0, '« À faire » is not repeated on its own rows');
   assert.equal(await f.page.getByText(/Réalise la tâche : vous/).count(), 0);
   await row(f, 'documents').getByRole('link', { name: 'Facture reçue · À vérifier — EXP-TEST-001', exact: true }).waitFor();
   await row(f, 'reception').getByRole('cell', { name: /^Prévue · / }).waitFor();
   await f.page.getByRole('button', { name: 'En attente 1', exact: true }).click();
   // Beside its « En attente » pill the line gives the reason: « En attente » is said once.
   await row(f, 'waiting').getByText(/^Raison : Vérification fournisseur · À revoir le /).waitFor();
   assert.equal((await row(f, 'waiting').innerText()).match(/En attente/g).length, 1);
   await row(f, 'waiting').getByRole('button', { name: 'Voir', exact: true }).waitFor();
   await f.page.getByRole('button', { name: 'À prendre 1', exact: true }).click();
   const claim = row(f, 'pool').getByRole('button', { name: 'Je m’en occupe', exact: true });
   assert.equal(await claim.evaluate(node => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)'), true);
   assert.equal(await row(f, 'pool').getByRole('button', { name: 'Voir', exact: true }).count(), 0);
  });
  await scenario('display-dialog-closes-with-x-escape-and-backdrop-returning-focus', async f => {
   assert.equal(await displayButton(f).getAttribute('aria-expanded'), 'false');
   let dialog = await display(f);
   assert.equal(await displayButton(f).getAttribute('aria-controls'), 'work-display-dialog');
   await dialog.getByRole('group', { name: 'Colonnes', exact: true }).waitFor();
   await dialog.getByRole('group', { name: 'Lecture', exact: true }).waitFor();
   assert.equal(await dialog.getByLabel('Affichage des tâches', { exact: true }).inputValue(), 'auto');
   await dialog.getByRole('group', { name: 'Régler la taille du texte des tâches', exact: true }).waitFor();
   await closeDisplay(f);
   assert.equal(await focused(displayButton(f)), true, 'X returns focus to « Affichage »');
   dialog = await display(f); await f.page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
   assert.equal(await focused(displayButton(f)), true, 'Escape returns focus to « Affichage »');
   dialog = await display(f); await f.page.mouse.click(8, 8); await dialog.waitFor({ state: 'hidden' });
   assert.equal(await focused(displayButton(f)), true, 'The backdrop returns focus to « Affichage »');
   assert.equal(await displayButton(f).getAttribute('aria-expanded'), 'false');
  });
  await scenario('forced-cards-at-1440-survive-a-reload', async f => {
   await chooseLayout(f, 'cards');
   assert.equal(await layoutOf(f), 'cards');
   await f.page.reload(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
   assert.equal(await layoutOf(f), 'cards');
   await assertSingleCopies(f);
   assert.equal(await todo(f).locator('.work-cards').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 3);
   const quote = row(f, 'quote');
   assert.equal(await quote.getByRole('heading', { level: 2 }).innerText(), 'Établir le devis');
   await quote.getByRole('link', { name: 'Ouvrir Établir le devis — EXP-2026-0398', exact: true }).waitFor();
   await quote.getByText(/^Échéance dépassée · /).waitFor();
   await quote.getByText('Casier B-12 · 3 cartons', { exact: true }).waitFor();
   await row(f, 'reply').getByText('En cours', { exact: true }).waitFor();
   assert.equal(await quote.evaluate(node => getComputedStyle(node).boxShadow.includes('inset')), true);
   await display(f); await shot(f, 'cards-1440-display-light'); await closeDisplay(f);
   await chooseLayout(f, 'auto');
   assert.equal(await layoutOf(f), 'table');
  }, { viewport: { width: 1440, height: 900 } });
  await scenario('forced-table-on-a-phone-scrolls-inside-its-frame', async f => {
   await chooseLayout(f, 'table');
   assert.equal(await layoutOf(f), 'table');
   const frame = todo(f).locator('.work-table-frame');
   assert.ok(await frame.evaluate(node => node.scrollWidth > node.clientWidth + 1), 'The table is wider than the phone');
   assert.equal(await frame.evaluate(node => getComputedStyle(node).overflowX), 'auto');
   assert.ok(await frame.evaluate(node => { node.scrollLeft = 240; return node.scrollLeft; }) > 0, 'The frame scrolls horizontally');
   assert.equal(await pageOverflow(f), false, 'The page itself never scrolls sideways');
   await shot(f, 'table-forced-390-light');
   await f.page.reload(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
   assert.equal(await layoutOf(f), 'table');
  }, { viewport: { width: 390, height: 844 } });
  await scenario('hidden-casier-and-text-size-survive-a-reload', async f => {
   const table = todo(f).getByRole('table', { name: 'À faire', exact: true });
   const fontSize = () => table.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
   assert.equal(await fontSize(), 15);
   let dialog = await display(f);
   assert.equal(await dialog.getByText('6 sur 6 colonnes affichées', { exact: true }).count(), 1);
   await dialog.getByRole('button', { name: 'Colonnes', exact: true }).click();
   const columns = f.page.getByRole('dialog', { name: 'Colonnes affichées', exact: true });
   assert.equal(await columns.getByRole('checkbox', { name: 'Afficher Tâche', exact: true }).isDisabled(), true);
   assert.equal(await columns.getByRole('checkbox', { name: 'Afficher Action', exact: true }).count(), 0, '« Action » is not a choice');
   assert.equal(await focused(columns.getByRole('checkbox', { name: 'Afficher Échéance', exact: true })), true);
   await columns.getByRole('checkbox', { name: 'Afficher Casier', exact: true }).uncheck();
   await columns.getByRole('button', { name: 'Terminer', exact: true }).click(); await columns.waitFor({ state: 'hidden' });
   assert.equal(await focused(displayButton(f)), true);
   assert.equal(await table.getByRole('columnheader', { name: 'Casier', exact: true }).count(), 0);
   dialog = await display(f);
   // One step at a time: each click is applied before the next one (a quick second click could be lost on a slow machine).
   const sizeField = dialog.getByLabel('Taille du texte des tâches', { exact: true });
   const sizeIs = async value => { for (let attempt = 0; attempt < 30 && await sizeField.inputValue() !== value; attempt += 1) await f.page.waitForTimeout(100); return sizeField.inputValue(); };
   const before = Number(await sizeField.inputValue());
   await dialog.getByRole('button', { name: 'Agrandir le texte des tâches', exact: true }).click();
   assert.equal(await sizeIs(String(before + 1)), String(before + 1));
   await dialog.getByRole('button', { name: 'Agrandir le texte des tâches', exact: true }).click();
   assert.equal(await sizeIs('17'), '17');
   await closeDisplay(f);
   assert.equal(await fontSize(), 17);
   await f.page.reload(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
   assert.equal(await fontSize(), 17);
   assert.equal(await table.getByRole('columnheader', { name: 'Casier', exact: true }).count(), 0);
   await table.getByRole('columnheader', { name: 'Cartons', exact: true }).waitFor();
   // The dossier list keeps its own settings.
   await f.page.goto(base + '/colis');
   await f.page.getByRole('heading', { name: 'Dossiers d’expédition', exact: true }).waitFor();
   assert.equal(await f.page.locator('.dossier-list').evaluate(node => getComputedStyle(node).getPropertyValue('--dossier-text-size').trim()), '12px');
  }, { viewport: { width: 1440, height: 900 } });
  await scenario('options-open-an-expansion-row-and-a-wait-draft-survives-a-refresh', async f => {
   const prepare = row(f, 'prepare'), options = prepare.getByRole('button', { name: 'Options', exact: true });
   await options.click();
   const panel = f.page.locator('[data-work-action-panel="prepare"]');
   await panel.waitFor();
   assert.equal(await prepare.evaluate(node => node.nextElementSibling?.dataset.workActionPanel), 'prepare', 'The panel is the row right below the task');
   assert.equal(await panel.locator('td').getAttribute('colspan'), '7');
   assert.equal(await options.getAttribute('aria-expanded'), 'true');
   assert.equal(await panel.locator(`[id="${await options.getAttribute('aria-controls')}"]`).count(), 1);
   assert.equal(await prepare.getByRole('button', { name: 'Mettre en attente', exact: true }).count(), 0, 'Never inside the narrow action cell');
   await panel.getByRole('button', { name: 'Mettre en attente', exact: true }).click();
   const motive = panel.getByLabel('Motif', { exact: true });
   await motive.fill('Attente du transporteur pour le carton 2.');
   await shot(f, 'table-options-1440-light');
   await f.context.route('**/rest/v1/staff_work_actions?*', async route => { await new Promise(resolve => setTimeout(resolve, 300)); return route.fallback(); });
   const refreshed = f.page.waitForResponse(response => response.url().includes('/rest/v1/staff_work_actions?'));
   await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
   await refreshed;
   await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
   assert.equal(await motive.inputValue(), 'Attente du transporteur pour le carton 2.', 'A background refresh keeps the draft');
   await panel.getByRole('button', { name: 'Annuler', exact: true }).click();
   await panel.waitFor({ state: 'hidden' });
   assert.equal(f.tables.staff_work_actions.find(action => action.id === 'prepare').state, 'ready');
  }, { viewport: { width: 1440, height: 900 } });
  await scenario('an-open-options-form-survives-a-change-of-layout', async f => {
   await row(f, 'prepare').getByRole('button', { name: 'Options', exact: true }).click();
   const panel = f.page.locator('[data-work-action-panel="prepare"]');
   await panel.getByRole('button', { name: 'Mettre en attente', exact: true }).click();
   await panel.getByLabel('Motif', { exact: true }).fill('Attente du transporteur pour le carton 2.');
   // A tablet turned to portrait: the table becomes cards, the typed reason stays with its task.
   await f.page.setViewportSize({ width: 1000, height: 900 });
   assert.equal(await settledLayout(f, 'cards'), 'cards');
   const card = row(f, 'prepare');
   assert.equal(await card.getByLabel('Motif', { exact: true }).inputValue(), 'Attente du transporteur pour le carton 2.', 'The draft follows the task into its card');
   await card.getByRole('button', { name: 'Annuler', exact: true }).click();
   await f.page.setViewportSize({ width: 1440, height: 900 });
   assert.equal(await settledLayout(f, 'table'), 'table');
   assert.equal(await f.page.locator('[data-work-action-panel="prepare"]').count(), 0, 'A cancelled form does not come back');
  }, { viewport: { width: 1440, height: 900 } });
  await scenario('relay-band-folds-on-a-phone-and-the-first-card-stays-on-screen', async f => {
   const first = row(f, 'quote');
   await first.waitFor();
   const box = await first.boundingBox();
   assert.ok(box.y + box.height < 780, `The first task ends at ${Math.round(box.y + box.height)}px`);
   const relay = f.page.getByRole('region', { name: 'Relais à accepter', exact: true });
   const toggle = relay.getByRole('button', { name: 'Relais à accepter · 1', exact: true });
   assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
   assert.equal(await relay.getByRole('button', { name: 'Accepter et ouvrir', exact: true }).count(), 0);
   await shot(f, 'cards-390-first-screen-light');
   await toggle.click();
   assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
   await relay.getByRole('button', { name: 'Accepter et ouvrir', exact: true }).waitFor();
   for (const name of ['Filtrer', 'Affichage']) {
    const control = name === 'Filtrer' ? f.page.locator('summary').filter({ hasText: /^Filtrer/ }) : displayButton(f);
    const bounds = await control.boundingBox();
    assert.ok(Math.round(bounds.width) === 44 && Math.round(bounds.height) === 44, `${name} is a 44px icon button`);
   }
   await f.page.locator('summary').filter({ hasText: /^Filtrer/ }).click();
   await f.page.getByLabel('Mission', { exact: true }).waitFor();
   assert.equal(await pageOverflow(f), false, 'The filter popover stays on screen');
   await f.page.keyboard.press('Escape');
   await f.page.getByLabel('Mission', { exact: true }).waitFor({ state: 'hidden' });
   assert.equal(await focused(f.page.locator('summary').filter({ hasText: /^Filtrer/ })), true, 'Escape returns to « Filtrer »');
  }, { viewport: { width: 390, height: 844 } });
  for (const width of [1440, 390]) await scenario(`filters-urgencies-empty-and-loading-follow-the-layout-${width}`, async f => {
   const expected = width === 1440 ? 'table' : 'cards';
   await f.page.locator('summary').filter({ hasText: /^Filtrer/ }).click();
   await f.page.getByLabel('Mission', { exact: true }).selectOption('preparation');
   await f.page.getByRole('button', { name: 'À faire 1', exact: true }).waitFor();
   assert.match(await f.page.locator('summary').filter({ hasText: /^Filtrer/ }).innerText(), /^Filtrer/);
   await f.page.locator('summary').filter({ hasText: /^Filtrer/ }).getByText('· 1 actif').waitFor({ state: 'attached' });
   await f.page.getByText(/^Filtre actif · Optimisation/).waitFor();
   const urgent = f.page.getByRole('region', { name: 'Urgences hors filtre', exact: true });
   assert.equal(await layoutOf(f, urgent), expected, 'Urgencies use the list layout');
   await urgent.locator('[data-work-action="quote"]').waitFor();
   assert.equal(await layoutOf(f), expected);
   await f.page.mouse.click(5, 5);
   await f.page.getByLabel('Mission', { exact: true }).waitFor({ state: 'hidden' });
   await shot(f, `filtered-${width}-light`);
   await f.page.getByLabel('Rechercher dans mes tâches', { exact: true }).fill('aucun-résultat');
   const empty = f.page.getByRole('region', { name: 'Pourquoi la liste est vide', exact: true });
   await empty.getByRole('heading', { name: 'Des tâches sont masquées par vos filtres', exact: true }).waitFor();
   await f.page.getByRole('link', { name: 'Chercher aussi dans tous les dossiers', exact: true }).waitFor();
   await shot(f, `empty-${width}-light`);
   await f.page.getByRole('button', { name: 'Voir mes tâches sans filtre', exact: true }).click();
   await todo(f).locator('[data-work-action]').first().waitFor();
   // The skeleton of a first load takes the shape of the chosen layout.
   f.tables.staff_work_actions = [];
   await f.page.reload(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
   let release;
   const held = new Promise(resolve => { release = resolve; });
   await f.context.route('**/rest/v1/staff_work_actions?*', async route => { await held; return route.fallback(); });
   await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
   const loading = f.page.getByRole('status').filter({ hasText: 'Chargement des tâches…' });
   await loading.waitFor();
   assert.equal(await loading.locator(expected === 'table' ? '.work-skeleton-table' : '.work-skeleton-card').count() > 0, true);
   await shot(f, `loading-${width}-light`);
   release();
   await loading.waitFor({ state: 'hidden' });
  }, { viewport: { width, height: width === 390 ? 844 : 900 } });
  // ── Final review: load failure, commands, name, rules, density, shell ──
  for (const [width, dark] of [[1440, false], [1440, true], [390, false], [390, true]]) await scenario(`a-failed-load-shows-its-reason-and-a-retry-never-empty-counts-${width}-${dark ? 'dark' : 'light'}`, async f => {
   const work = f.page.locator('.work-page');
   const failure = loadFailure(f);
   await failure.waitFor();
   await failure.getByText('Chargement impossible : Indisponibilité simulée', { exact: true }).waitFor();
   assert.equal(await f.page.getByRole('alert').filter({ hasText: 'Indisponibilité simulée' }).count(), 1, 'One message: the shell banner steps aside for the page’s own');
   for (const tab of [/^À faire/, /^En attente/, /^À prendre/]) assert.equal(await work.getByRole('button', { name: tab }).count(), 0, 'No count without loaded tasks');
   assert.equal(await work.getByText(/pas de tâche|Aucune tâche/).count(), 0, 'A failed load never reads as « no work »');
   assert.equal(await work.getByRole('button', { name: 'Ma disponibilité', exact: true }).count(), 0, 'Preferences are not offered from an unknown state');
   assert.equal(await work.getByText(/Disponible|Indisponibilité déclarée/).count(), 0);
   await axeClean(f, 'load failure');
   await shot(f, `load-failure-${width}-${dark ? 'dark' : 'light'}`);
   f.failColis = false;
   await failure.getByRole('button', { name: 'Réessayer', exact: true }).click();
   await f.page.getByRole('button', { name: 'À faire 6', exact: true }).waitFor();
   assert.equal(await loadFailure(f).count(), 0);
  }, { dark, viewport: { width, height: width === 390 ? 844 : 900 }, before: failColisLoad });
  await scenario('a-failed-task-refresh-with-no-task-loaded-is-an-error-not-an-empty-list', async f => {
   f.tables.staff_work_actions = [];
   await f.page.reload(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
   const empty = f.page.getByRole('region', { name: 'Pourquoi la liste est vide', exact: true });
   await empty.getByRole('heading', { name: 'Vous n’avez pas de tâche à faire pour le moment', exact: true }).waitFor();
   let fail = true;
   await f.context.route('**/rest/v1/staff_work_actions?*', route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Suivi des tâches indisponible' }) }) : route.fallback());
   await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
   const failure = loadFailure(f);
   await failure.getByText('Suivi des tâches indisponible', { exact: true }).waitFor();
   assert.equal(await f.page.getByRole('button', { name: 'À faire 0', exact: true }).count(), 0);
   assert.equal(await empty.count(), 0, '« Vous n’avez pas de tâche » is never shown for an unknown list');
   fail = false;
   await failure.getByRole('button', { name: 'Réessayer', exact: true }).click();
   await empty.getByRole('heading', { name: 'Vous n’avez pas de tâche à faire pour le moment', exact: true }).waitFor();
  });
  for (const dark of [false, true]) await scenario(`filled-commands-share-one-style-and-stand-out-${dark ? 'dark' : 'light'}`, async f => {
   await f.page.mouse.move(0, 0);
   const relay = f.page.getByRole('region', { name: 'Relais à accepter', exact: true });
   const looks = {
    'Continuer · à commencer': await commandLook(row(f, 'quote').getByRole('button', { name: 'Continuer', exact: true })),
    'Continuer · en cours': await commandLook(row(f, 'reply').getByRole('button', { name: 'Continuer', exact: true })),
    'Accepter et ouvrir': await commandLook(relay.getByRole('button', { name: 'Accepter et ouvrir', exact: true })),
   };
   assert.equal(await row(f, 'quote').getByRole('button', { name: 'Continuer', exact: true }).innerHTML(), await row(f, 'reply').getByRole('button', { name: 'Continuer', exact: true }).innerHTML(), 'Both « Continuer » read the same: the word alone.');
   await f.page.getByRole('button', { name: 'Ma disponibilité', exact: true }).click();
   const form = f.page.getByRole('form', { name: 'Mes missions et disponibilité', exact: true });
   looks.Enregistrer = await commandLook(form.getByRole('button', { name: 'Enregistrer', exact: true }));
   await shot(f, `preferences-1440-${dark ? 'dark' : 'light'}`);
   // An empty « À faire » with work to take offers « Voir les tâches à prendre ».
   f.tables.staff_work_actions = f.tables.staff_work_actions.filter(action => action.id === 'pool');
   await f.page.reload(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
   const see = f.page.getByRole('region', { name: 'Pourquoi la liste est vide', exact: true }).getByRole('button', { name: 'Voir les tâches à prendre', exact: true });
   await f.page.mouse.move(0, 0);
   looks['Voir les tâches à prendre'] = await commandLook(see);
   await shot(f, `empty-1440-${dark ? 'dark' : 'light'}`);
   await see.click();
   await row(f, 'pool').waitFor(); await f.page.mouse.move(0, 0);
   looks['Je m’en occupe'] = await commandLook(row(f, 'pool').getByRole('button', { name: 'Je m’en occupe', exact: true }));
   const reference = looks['Continuer · en cours'];
   for (const [name, look] of Object.entries(looks)) {
    assert.deepEqual([look.fill, look.text, look.radius, look.weight], [reference.fill, reference.text, reference.radius, reference.weight], `${name} has the one filled style`);
    assert.ok(look.height >= 44, `${name}: 44px target`);
    assert.ok(contrast(look.fill, look.behind) >= 3, `${name}: ${contrast(look.fill, look.behind).toFixed(2)}:1 against the page`);
    assert.ok(contrast(look.text, look.fill) >= 4.5, `${name}: text ${contrast(look.text, look.fill).toFixed(2)}:1`);
   }
  }, { dark, viewport: { width: 1440, height: 1000 } });
  await scenario('the-sidebar-and-mon-travail-name-the-same-person', async f => {
   const sidebar = f.page.locator('.staff-sidebar');
   assert.equal((await sidebar.locator('[data-staff-name]').innerText()).trim(), 'Test', 'The first name, as in Mon travail');
   assert.equal(await sidebar.locator('[data-staff-name]').getAttribute('title'), 'Test Camille');
   assert.equal((await f.page.locator('.work-presence-name').innerText()).replace(/[\s·]+$/u, ''), 'Test');
  });
  await scenario('the-empty-list-and-the-preferences-are-separated-by-one-rule', async f => {
   f.tables.staff_work_actions = f.tables.staff_work_actions.filter(action => action.id === 'pool');
   await f.page.reload(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
   const empty = f.page.getByRole('region', { name: 'Pourquoi la liste est vide', exact: true });
   await empty.waitFor();
   assert.equal(await empty.evaluate(node => getComputedStyle(node).borderBottomWidth), '0px');
   assert.equal(await f.page.locator('#work-preferences').evaluate(node => getComputedStyle(node).borderTopWidth), '1px');
  });
  await scenario('card-commands-line-up-at-the-bottom-of-each-row', async f => {
   await chooseLayout(f, 'cards');
   const cards = await todo(f).locator('article[data-work-action]').evaluateAll(nodes => nodes.map(node => { const card = node.getBoundingClientRect(), controls = node.querySelector('.work-card-controls').getBoundingClientRect(); return { top: Math.round(card.top), bottom: Math.round(card.bottom), controls: Math.round(controls.bottom) }; }));
   const lines = [...new Set(cards.map(card => card.top))];
   assert.ok(lines.length >= 2);
   for (const top of lines) {
    const line = cards.filter(card => card.top === top);
    assert.ok(Math.max(...line.map(card => card.controls)) - Math.min(...line.map(card => card.controls)) <= 1, `Commands share one baseline in the row at ${top}px: ${JSON.stringify(line)}`);
   }
   await shot(f, 'cards-aligned-1440-light');
   await f.page.getByRole('button', { name: 'En attente 1', exact: true }).click();
   await row(f, 'waiting').waitFor();
   assert.equal((await row(f, 'waiting').innerText()).match(/En attente/g).length, 1, 'A waiting card says « En attente » once');
   await chooseLayout(f, 'auto');
  }, { viewport: { width: 1440, height: 1100 } });
  for (const width of [1440, 1280, 390]) await scenario(`missions-align-in-columns-coordination-included-${width}`, async f => {
   await f.page.getByRole('button', { name: 'Mes missions et disponibilité', exact: true }).click();
   const group = f.page.getByRole('group', { name: 'Missions proposées dans À prendre', exact: true });
   await group.waitFor();
   const boxes = await group.locator('label').evaluateAll(labels => labels.map(label => { const rect = label.getBoundingClientRect(); return { text: label.textContent.trim(), x: Math.round(rect.left), y: Math.round(rect.top), height: Math.round(rect.height) }; }));
   assert.equal(boxes.length, 6);
   const tops = [...new Set(boxes.map(box => box.y))].sort((a, b) => a - b);
   const columns = boxes.filter(box => box.y === tops[0]).map(box => box.x);
   assert.ok(boxes.every(box => columns.includes(box.x)), `Every mission sits in a column of the first row: ${JSON.stringify(boxes)}`);
   for (let index = 1; index < tops.length; index += 1) assert.ok(tops[index] - tops[index - 1] <= boxes[0].height + 1, 'No extra gap before a row');
   assert.equal(await f.page.getByText('Options d’affichage').count(), 0, 'The density moved to « Affichage »');
   await group.scrollIntoViewIfNeeded();
   await f.page.screenshot({ path: path.join(output, `missions-${width}.png`) });
  }, { viewport: { width, height: 1000 } });
  await scenario('density-is-chosen-in-affichage-and-saved-for-the-account', async f => {
   const saves = [];
   let refuse = false;
   await f.context.route('**/rest/v1/rpc/save_staff_work_preferences', async route => {
    const input = route.request().postDataJSON(); saves.push(input);
    if (refuse) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '40001', message: 'Les préférences ont changé. Rechargez votre vue.' }) });
    const preference = f.tables.staff_work_preferences[0]; Object.assign(preference, input.p_preferences); preference.version += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(preference) });
   });
   const page = f.page.locator('.work-page');
   const dialog = await display(f);
   const density = dialog.getByLabel('Densité', { exact: true });
   assert.equal(await density.inputValue(), 'comfortable');
   await density.selectOption('compact');
   await f.page.waitForFunction(() => document.querySelector('.work-page')?.dataset.density === 'compact');
   assert.deepEqual(saves, [{ p_preferences: { density: 'compact' }, p_expected_version: 1 }], 'Only the density, with the version read');
   assert.equal(await density.inputValue(), 'compact');
   await axeClean(f, 'display dialog with density');
   // A refused save keeps the confirmed density and says why, in the dialog.
   refuse = true;
   await density.selectOption('comfortable');
   await dialog.getByRole('alert').filter({ hasText: 'La densité n’a pas été enregistrée' }).waitFor();
   assert.equal(await density.inputValue(), 'compact');
   assert.equal(await page.getAttribute('data-density'), 'compact');
   assert.deepEqual(saves[1], { p_preferences: { density: 'comfortable' }, p_expected_version: 2 });
   await shot(f, 'display-density-refused-1440-light');
   await closeDisplay(f);
  }, { writes: ['save_staff_work_preferences'] });
  await scenario('an-unassigned-task-is-attributed-a-held-one-reassigned', async f => {
   await f.page.getByRole('button', { name: 'À prendre 1', exact: true }).click();
   await row(f, 'pool').getByRole('button', { name: 'Options', exact: true }).click();
   const pool = f.page.locator('[data-work-action-panel="pool"]');
   assert.equal(await pool.getByRole('button', { name: 'Réaffecter immédiatement', exact: true }).count(), 0);
   await pool.getByRole('button', { name: 'Attribuer…', exact: true }).click();
   const person = pool.getByLabel('Attribuer à', { exact: true });
   assert.equal(await person.evaluate(node => node.required), true, 'A person is required to attribute a task');
   assert.equal(await person.locator('option').first().innerText(), 'Choisir une personne disponible et habilitée');
   await pool.getByRole('button', { name: 'Annuler', exact: true }).click();
   await f.page.getByRole('button', { name: 'À faire 6', exact: true }).click();
   await row(f, 'prepare').getByRole('button', { name: 'Options', exact: true }).click();
   await f.page.locator('[data-work-action-panel="prepare"]').getByRole('button', { name: 'Réaffecter immédiatement', exact: true }).waitFor();
  });
  await scenario('deadlines-read-like-the-departure-labels-in-paris-time-and-keep-their-lines-at-1280', async f => {
   const { workDate } = await import(pathToFileURL(path.join(__dirname, '../src/expedile/domain/personalWork.js')).href);
   const quote = f.tables.staff_work_actions.find(action => action.id === 'quote');
   const expected = workDate(quote.due_at, { now: Date.now() });
   assert.match(expected, /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \d{1,2}(er)? [a-zéû]+( \d{4})?, \d{1,2} h( \d{2})?$/);
   assert.deepEqual(await row(f, 'quote').locator('.work-due-part').allInnerTexts(), ['Dépassée ·', expected], 'A device in Auckland still reads the Paris time');
   for (const id of ORDER) {
    for (const part of await row(f, id).locator('.work-due-part, .work-client').all()) assert.equal(await lineCount(part), 1, `${id}: « ${await part.innerText()} » on one line`);
   }
   assert.equal(await row(f, 'prepare').locator('.work-client').getAttribute('title'), 'Boutique Kréol SARL', 'A long name stays whole in its title');
   assert.ok(await todo(f).locator('.work-table-frame').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'The default columns fit at 1280px');
   await shot(f, 'table-1280-light');
  }, { viewport: { width: 1280, height: 900 }, timezoneId: 'Pacific/Auckland' });
  await scenario('the-shell-gives-each-staff-page-one-main-landmark', async f => {
   for (const route of ['/', '/colis', `/colis/${ids.P}`, `/colis/${ids.P}?onglet=conversation`, '/conversations', '/equipe', '/departs', '/clients', '/devis', '/plus']) {
    await f.page.goto(base + route);
    await f.page.locator('main h1').first().waitFor();
    assert.equal(await f.page.locator('main').count(), 1, `${route}: one <main>`);
    assert.equal(await f.page.locator('main main, main [role="main"]').count(), 0, `${route}: no nested main`);
   }
  });
  await scenario('a-thread-opened-from-conversations-keeps-conversations-current', async f => {
   const current = scope => f.page.locator(`${scope} [aria-current="page"]`);
   for (const [route, expected] of [[`/colis/${ids.P}?onglet=conversation`, 'Conversations'], [`/colis/${ids.P}?returnTo=%2Fconversations%3Fstate%3Da_traiter`, 'Conversations'], [`/colis/${ids.P}?returnTo=%2Fcolis`, 'Dossiers d’expédition'], [`/colis/${ids.P}`, 'Dossiers d’expédition']]) {
    await f.page.goto(base + route);
    await f.page.getByTestId('dossier-task-header').waitFor();
    assert.equal(await current('.staff-sidebar').getAttribute('aria-label'), expected, route);
   }
   await f.page.setViewportSize({ width: 390, height: 844 });
   await f.page.goto(`${base}/colis/${ids.P}?onglet=conversation`);
   await f.page.getByTestId('dossier-task-header').waitFor();
   assert.equal(await current('[data-staff-bottom-nav]').getAttribute('aria-label'), 'Conversations');
  });
  for (const width of [320, 390]) for (const dark of [false, true]) await scenario(`bottom-navigation-labels-read-at-11px-on-one-line-${width}-${dark ? 'dark' : 'light'}`, async f => {
   const nav = f.page.locator('[data-staff-bottom-nav]');
   const labels = await nav.locator('button').evaluateAll(buttons => buttons.map(button => { const label = button.lastElementChild, rect = label.getBoundingClientRect(), box = button.getBoundingClientRect(), style = getComputedStyle(label); return { text: label.textContent, size: parseFloat(style.fontSize), lines: Math.round(rect.height / parseFloat(style.lineHeight)), inside: rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5, target: box.height }; }));
   assert.deepEqual(labels.map(label => label.text), ['Mon travail', 'Dossiers', 'Conversations', 'Plus']);
   for (const label of labels) {
    assert.ok(label.size >= 11, `${label.text}: ${label.size}px`);
    assert.equal(label.lines, 1, `${label.text} on one line`);
    assert.ok(label.inside, `${label.text} inside its button`);
    assert.ok(label.target >= 44);
   }
   const height = await nav.evaluate(node => node.getBoundingClientRect().height);
   assert.ok(height <= 72, `The bar stays within the space pages reserve: ${height}px`);
   assert.equal(await mainReserve(f, `${height}px`), `${height}px`, 'The page keeps exactly the bar free: no strip');
   await axeClean(f, 'phone shell');
   await shot(f, `bottom-nav-${width}-${dark ? 'dark' : 'light'}`);
  }, { dark, viewport: { width, height: 844 } });
  for (const dark of [false, true]) await scenario(`phone-account-commands-live-in-plus-with-a-confirmed-logout-${dark ? 'dark' : 'light'}`, async f => {
   assert.equal(await f.page.getByRole('button', { name: 'Se déconnecter', exact: true }).filter({ visible: true }).count(), 0, 'No one-tap logout beside the theme toggle');
   await f.page.locator('[data-staff-bottom-nav]').getByRole('button', { name: 'Plus', exact: true }).click();
   await f.page.getByRole('heading', { name: 'Votre espace', exact: true }).waitFor();
   const account = f.page.getByRole('region', { name: 'Mon compte', exact: true });
   await account.getByText('Test Camille', { exact: true }).waitFor();
   await account.getByRole('button', { name: 'Modifier le mot de passe', exact: true }).waitFor();
   await axeClean(f, 'Plus');
   await shot(f, `plus-390-${dark ? 'dark' : 'light'}`);
   await account.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
   const confirm = f.page.getByRole('dialog', { name: 'Se déconnecter ?', exact: true });
   await confirm.getByText(/brouillons non enregistrés/).waitFor();
   // The confirmations share the one primary fill: never a navy block in dark mode.
   const ok = await commandLook(confirm.getByRole('button', { name: 'Se déconnecter', exact: true }));
   assert.deepEqual({ fill: ok.fill, text: ok.text }, dark ? { fill: 'rgb(196, 218, 229)', text: 'rgb(18, 42, 54)' } : { fill: 'rgb(23, 50, 77)', text: 'rgb(255, 255, 255)' }, 'The confirmation’s primary fill');
   assert.ok(contrast(ok.fill, ok.text) >= 4.5, `The confirmation reads at 4.5:1 or more (${contrast(ok.fill, ok.text).toFixed(2)})`);
   await shot(f, `logout-confirm-390-${dark ? 'dark' : 'light'}`);
   await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
   await confirm.waitFor({ state: 'hidden' });
   assert.equal(await f.page.locator('#login-email').count(), 0, 'Cancelling keeps the session');
   await account.getByRole('button', { name: 'Modifier le mot de passe', exact: true }).click();
   await f.page.waitForURL(url => url.pathname === '/password');
   await f.page.goBack();
   await account.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
   await confirm.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
   await f.page.getByLabel('Email', { exact: true }).waitFor();
  }, { dark, viewport: { width: 390, height: 844 } });
  // A voluntary change from « Plus »: « Annuler » goes back to Plus; once Auth confirms,
  // the change is said (never a silent return) and Plus comes back.
  for (const dark of [false, true]) await scenario(`a-password-change-from-plus-is-confirmed-and-cancel-returns-to-plus-${dark ? 'dark' : 'light'}`, async f => {
   const plus = async () => { await f.page.locator('[data-staff-bottom-nav]').getByRole('button', { name: 'Plus', exact: true }).click(); await f.page.getByRole('heading', { name: 'Votre espace', exact: true }).waitFor(); };
   const account = f.page.getByRole('region', { name: 'Mon compte', exact: true });
   await plus();
   await account.getByRole('button', { name: 'Modifier le mot de passe', exact: true }).click();
   await f.page.waitForURL(url => url.pathname === '/password');
   await f.page.getByRole('button', { name: 'Annuler', exact: true }).click();
   await f.page.waitForURL(url => url.pathname === '/plus');
   await f.page.getByRole('heading', { name: 'Votre espace', exact: true }).waitFor();
   await account.getByRole('button', { name: 'Modifier le mot de passe', exact: true }).click();
   await f.page.getByLabel('Nouveau mot de passe', { exact: true }).fill('Expedile-nouveau-2026');
   await f.page.locator('#confirm-password').fill('Expedile-nouveau-2026');
   await f.page.getByRole('button', { name: 'Définir mon mot de passe et continuer', exact: true }).click();
   await f.page.waitForURL(url => url.pathname === '/plus');
   await f.page.getByRole('heading', { name: 'Votre espace', exact: true }).waitFor();
   const toast = f.page.locator('[data-toast="success"]').filter({ hasText: 'Votre mot de passe est modifié.' });
   await toast.waitFor();
   assert.ok(f.requests.some(request => request.method === 'PUT' && request.path === '/auth/v1/user'), 'The new password went to Auth.');
   await axeClean(f, 'password changed');
   await shot(f, `password-changed-390-${dark ? 'dark' : 'light'}`);
  }, { dark, viewport: { width: 390, height: 844 } });
  // The tasks loaded, then a refresh of the dossiers failed: Mon travail keeps its
  // list (never « Vos tâches n’ont pas pu être chargées »), the banner gives the reason.
  for (const [width, dark] of [[1440, false], [390, true]]) await scenario(`a-failed-refresh-keeps-the-loaded-tasks-${width}-${dark ? 'dark' : 'light'}`, async f => {
   await todo(f).locator('[data-work-action]').first().waitFor();
   const before = await todo(f).locator('[data-work-action]').count();
   // The minute's reconciliation reads the dossier index: refused, without the retries of a 503.
   await f.context.route('**/rest/v1/colis?*', route => new URL(route.request().url()).searchParams.get('select') === 'id,updated_at,client_id'
     ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Actualisation refusée (essai)' }) }) : route.fallback());
   await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
   const banner = f.page.getByRole('alert').filter({ hasText: 'Actualisation des dossiers impossible' });
   await banner.waitFor();
   assert.match(await banner.innerText(), /Actualisation refusée \(essai\)/);
   assert.equal(await loadFailure(f).count(), 0, 'A failed refresh is never a failed load.');
   assert.equal(await todo(f).locator('[data-work-action]').count(), before, 'The loaded tasks stay on screen.');
   assert.match(await f.page.locator('.work-presence').innerText(), /Disponible/, 'The availability, read from the loaded data, stays.');
   await axeClean(f, 'refresh failure');
   await shot(f, `refresh-failure-${width}-${dark ? 'dark' : 'light'}`);
  }, { dark, viewport: { width, height: width === 390 ? 844 : 900 } });
  // Équipe: the tasks never loaded is an error with its reason, never « (0) » nor
  // « every task has someone »; the shell banner steps aside for it.
  for (const [width, dark] of [[1440, false], [1440, true], [390, false], [390, true]]) await scenario(`team-page-failed-load-is-an-error-never-empty-queues-${width}-${dark ? 'dark' : 'light'}`, async f => {
   await loadFailure(f).waitFor();
   // In the application, without reloading: the failure is the one of the first load.
   await f.page.evaluate(() => { history.pushState({}, '', '/equipe'); dispatchEvent(new PopStateEvent('popstate')); });
   await f.page.getByRole('heading', { name: 'Équipe', exact: true }).waitFor();
   const failure = f.page.getByRole('alert').filter({ has: f.page.getByRole('heading', { name: 'Le travail de l’équipe n’a pas pu être chargé', exact: true }) });
   await failure.waitFor();
   await failure.getByText('Chargement impossible : Indisponibilité simulée', { exact: true }).waitFor();
   assert.equal(await f.page.getByRole('alert').filter({ hasText: 'Indisponibilité simulée' }).count(), 1, 'One message: the shell banner steps aside for the page’s own.');
   assert.equal(await f.page.getByRole('navigation', { name: 'Priorités de l’équipe', exact: true }).count(), 0, 'No queue counted from unknown tasks.');
   assert.equal(await f.page.getByText(/Toutes les tâches prêtes ont une personne|\(0\)/).count(), 0);
   await axeClean(f, 'team failed load');
   await shot(f, `team-load-failure-${width}-${dark ? 'dark' : 'light'}`);
   f.failColis = false;
   await failure.getByRole('button', { name: 'Réessayer', exact: true }).click();
   await f.page.getByRole('navigation', { name: 'Priorités de l’équipe', exact: true }).waitFor();
   assert.equal(await failure.count(), 0);
  }, { dark, viewport: { width, height: width === 390 ? 844 : 900 }, before: failColisLoad });
  // One primary fill on every staff screen: navy in light mode, the light navy with navy text in
  // dark mode (Mon travail, Équipe, Départs, Clients, Paramètres); the open settings rubric reads
  // as selected, never as a second primary button.
  for (const dark of [false, true]) await scenario(`one-primary-fill-on-every-staff-screen-${dark ? 'dark' : 'light'}`, async f => {
   const expected = dark ? { fill: 'rgb(196, 218, 229)', text: 'rgb(18, 42, 54)' } : { fill: 'rgb(27, 58, 75)', text: 'rgb(255, 255, 255)' };
   const spa = path => f.page.evaluate(target => { history.pushState({}, '', target); dispatchEvent(new PopStateEvent('popstate')); }, path);
   const look = async (locator, label) => { await locator.waitFor(); await f.page.mouse.move(0, 0); const { fill, text } = await commandLook(locator); assert.deepEqual({ fill, text }, expected, `${label}: the primary fill`); };
   await look(row(f, 'quote').getByRole('button', { name: 'Continuer', exact: true }), 'Mon travail');
   await spa('/equipe');
   await look(f.page.getByRole('navigation', { name: 'Priorités de l’équipe', exact: true }).locator('button[aria-pressed="true"]'), 'Équipe, the open queue');
   const take = f.page.getByRole('main').getByRole('button', { name: 'Je m’en occupe', exact: true }).first();
   if (await take.count()) await look(take, 'Équipe, « Je m’en occupe »');
   await spa('/departs');
   await look(f.page.getByRole('button', { name: 'Planifier un départ', exact: true }).first(), 'Départs');
   await spa('/clients');
   await look(f.page.getByRole('button', { name: 'Nouveau client', exact: true }).first(), 'Clients');
   await spa('/settings?tab=tarifs');
   await look(f.page.getByRole('button', { name: 'Enregistrer les tarifs', exact: true }), 'Paramètres');
   const rubric = await commandLook(f.page.getByRole('navigation', { name: 'Paramètres', exact: true }).locator('button[aria-current="page"]'));
   assert.notEqual(rubric.fill, expected.fill, 'The open rubric is not a second primary button.');
   // Hovered, it stays readable (never the primary's light fill under its light text).
   await f.page.getByRole('navigation', { name: 'Paramètres', exact: true }).locator('button[aria-current="page"]').hover();
   await axeClean(f, 'settings rubric');
   await shot(f, `primary-settings-${dark ? 'dark' : 'light'}`);
  }, { dark, viewport: { width: 1440, height: 900 } });
  // A casier code is read against the shelf: never « C- » above « 002 »; Linux's wider fonts included.
  for (const width of [1440, 1280]) await scenario(`casier-codes-never-split-in-the-table-${width}`, async f => {
   await f.page.addStyleTag({ content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }' });
   await todo(f).locator('table').waitFor();
   const cells = await todo(f).locator('td[data-work-column="casier"]').evaluateAll(nodes => nodes.map(node => { const range = document.createRange(); range.selectNodeContents(node); return { text: node.textContent.trim(), lines: new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size }; }));
   assert.ok(cells.length > 0);
   for (const cell of cells) assert.equal(cell.lines, cell.text ? 1 : 0, `« ${cell.text} » on one line`);
   assert.equal(await pageOverflow(f), false);
   await shot(f, `casier-whole-${width}`);
  }, { viewport: { width, height: 900 } });
  // Tablet cards: the titles of one row start at the same height, one line or two.
  for (const dark of [false, true]) await scenario(`card-titles-of-a-row-line-up-768-${dark ? 'dark' : 'light'}`, async f => {
   await todo(f).locator('article[data-work-action]').first().waitFor();
   // A longer title (« Demander l’accord avant la clôture du départ ») takes two lines beside a one-line title.
   await f.page.addStyleTag({ content: 'section[aria-label="À faire"] article[data-work-action]:nth-of-type(2) .work-task-link { max-width: 6.5em; }' });
   const titles = await todo(f).locator('article[data-work-action] .work-task-link').evaluateAll(nodes => nodes.map(node => { const card = node.closest('article').getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(node); const rects = [...range.getClientRects()].filter(rect => rect.width > 0); return { row: Math.round(card.top), text: Math.round(rects[0].top - card.top), lines: new Set(rects.map(rect => Math.round(rect.top))).size }; }));
   assert.equal(titles[1].lines, 2, 'The second title takes two lines.');
   const rows = new Map(); for (const title of titles) rows.set(title.row, [...(rows.get(title.row) || []), title.text]);
   assert.ok([...rows.values()].some(row => row.length > 1), 'Two cards side by side.');
   for (const [top, row] of rows) assert.ok(Math.max(...row) - Math.min(...row) <= 1, `Row at ${top}: titles start at ${row.join(', ')} px`);
   await axeClean(f, 'cards');
   await shot(f, `card-titles-768-${dark ? 'dark' : 'light'}`);
  }, { dark, viewport: { width: 768, height: 1024 } });
  for (const dark of [false, true]) await scenario(`the-bottom-navigation-steps-aside-while-typing-${dark ? 'dark' : 'light'}`, async f => {
   const nav = f.page.locator('[data-staff-bottom-nav]');
   const reserve = expected => mainReserve(f, expected);
   const height = await nav.evaluate(node => node.getBoundingClientRect().height);
   assert.equal(await reserve(`${height}px`), `${height}px`);
   const search = f.page.getByLabel('Rechercher dans mes tâches', { exact: true });
   await search.focus();
   assert.equal(await nav.isVisible(), true, 'A full-height screen keeps its navigation');
   // The keyboard opens: 844 → 500px of visible height.
   await f.page.setViewportSize({ width: 390, height: 500 });
   await nav.waitFor({ state: 'hidden' });
   assert.equal(await reserve('0px'), '0px', 'No space kept for a hidden bar');
   await search.fill('EXP');
   const field = await search.boundingBox();
   assert.ok(field.y >= 0 && field.y + field.height <= 500, 'The field stays in view');
   await axeClean(f, 'typing');
   await shot(f, `typing-390x500-${dark ? 'dark' : 'light'}`);
   // A press that takes the focus from the field (a mouse here; a finger in the reception
   // and chat tests): the bar stays aside while the press lasts, so the release lands on
   // the control, never on a bar appearing under it; once the press has ended, it is back.
   const filters = f.page.locator('summary').filter({ hasText: /^Filtrer/ });
   const press = await filters.boundingBox();
   await f.page.mouse.move(press.x + press.width / 2, press.y + press.height / 2);
   await f.page.mouse.down();
   await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
   assert.equal(await nav.isVisible(), false, 'Still aside while the press lasts');
   await f.page.mouse.up();
   await f.page.getByLabel('Mission', { exact: true }).waitFor();
   await nav.waitFor();
   assert.equal(await reserve(`${height}px`), `${height}px`, 'Back once the press has ended, with its exact reserve');
   // Back in the field, then a script takes the focus away: no press to wait for, back at once.
   await search.focus();
   await nav.waitFor({ state: 'hidden' });
   await search.evaluate(node => node.blur());
   await nav.waitFor();
   // The keyboard closes: the bar stays, with its exact reserve.
   await f.page.setViewportSize({ width: 390, height: 844 });
   await nav.waitFor();
   assert.equal(await reserve(`${height}px`), `${height}px`, 'Back when the keyboard closes, with its exact reserve');
   // The keyboard opens again on the field, then closes while the field keeps the focus.
   await search.focus();
   await f.page.setViewportSize({ width: 390, height: 500 });
   await nav.waitFor({ state: 'hidden' });
   await f.page.setViewportSize({ width: 390, height: 844 });
   await nav.waitFor();
   assert.equal(await reserve(`${height}px`), `${height}px`, 'Back when the keyboard closes');
  }, { dark, viewport: { width: 390, height: 844 } });
  // A window under 1024 × 640 (a snapped or zoomed laptop, a small tablet on its side with a
  // scanner) has no on-screen keyboard: once the focus leaves the field, the bar always comes
  // back (click elsewhere, Tab, a scan validated with Enter), never only on a resize.
  for (const dark of [false, true]) await scenario(`the-bottom-navigation-comes-back-after-a-field-in-a-short-window-900x600-${dark ? 'dark' : 'light'}`, async f => {
   const nav = f.page.locator('[data-staff-bottom-nav]');
   await nav.waitFor();
   assert.equal(await f.page.locator('.staff-sidebar').isVisible(), false, 'No navigation column under 1024 px: the bar is the only navigation');
   const search = f.page.getByLabel('Rechercher dans mes tâches', { exact: true });
   await search.click();
   await nav.waitFor({ state: 'hidden' });
   // A click on a part of the page that takes no focus.
   const brand = await f.page.locator('[data-toast-ceiling] span.brand-t').first().boundingBox();
   await f.page.mouse.click(brand.x + 10, brand.y + brand.height / 2);
   await nav.waitFor();
   assert.equal(await f.page.evaluate(() => document.activeElement === document.body), true, 'The focus left the field');
   const barHeight = await nav.evaluate(node => node.getBoundingClientRect().height);
   assert.equal(await mainReserve(f, `${barHeight}px`), `${barHeight}px`, 'The page keeps exactly the bar free again');
   // Tab from the field to the next control.
   await search.click();
   await nav.waitFor({ state: 'hidden' });
   await f.page.keyboard.press('Tab');
   await nav.waitFor();
   assert.equal(await f.page.evaluate(() => document.activeElement?.matches('input, textarea, select')), false, 'The focus is on a control, not a field');
   // Typed (or scanned) then validated with Enter: the one dossier found opens, with the bar.
   await f.page.goto(`${base}/colis`);
   const scan = f.page.getByLabel('Rechercher ou scanner un colis', { exact: true });
   await scan.click();
   await nav.waitFor({ state: 'hidden' });
   await f.page.keyboard.type('Kréol');
   await f.page.locator('[data-dossier-row]:visible').filter({ hasText: 'EXP-2026-0355' }).first().waitFor();
   await f.page.keyboard.press('Enter');
   await f.page.waitForURL(url => url.pathname === '/colis/d3550000-0000-4000-8000-000000000355');
   await f.page.getByTestId('dossier-task-header').waitFor();
   await nav.waitFor();
   await axeClean(f, 'short window, after a scan');
   await shot(f, `bar-back-900x600-${dark ? 'dark' : 'light'}`);
  }, { dark, viewport: { width: 900, height: 600 } });
  // A phone on its side (844 × 390, touch): the keyboard closes while the field keeps the
  // focus (Android's Back), then a tap on the page takes the focus away: the bar comes back.
  for (const dark of [false, true]) await scenario(`the-bottom-navigation-comes-back-after-a-tap-once-the-keyboard-closed-844x390-${dark ? 'dark' : 'light'}`, async f => {
   const nav = f.page.locator('[data-staff-bottom-nav]');
   await nav.waitFor();
   const search = f.page.getByLabel('Rechercher dans mes tâches', { exact: true });
   const field = await search.boundingBox();
   await f.page.touchscreen.tap(field.x + field.width / 2, field.y + field.height / 2);
   await nav.waitFor({ state: 'hidden' });
   // The keyboard opens (180 px left), then closes with the focus kept in the field.
   await f.page.setViewportSize({ width: 844, height: 180 });
   await nav.waitFor({ state: 'hidden' });
   await f.page.setViewportSize({ width: 844, height: 390 });
   await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
   assert.equal(await search.evaluate(node => node === document.activeElement), true, 'The field keeps the focus');
   assert.equal(await nav.isVisible(), false, 'A field still focused on a short screen keeps the bar aside');
   const brand = await f.page.locator('[data-toast-ceiling] span.brand-t').first().boundingBox();
   await f.page.touchscreen.tap(brand.x + 10, brand.y + brand.height / 2);
   await nav.waitFor();
   assert.equal(await f.page.evaluate(() => document.activeElement === document.body), true, 'The tap took the focus from the field');
   await axeClean(f, 'landscape phone, after a tap');
   await shot(f, `bar-back-844x390-${dark ? 'dark' : 'light'}`);
  }, { dark, viewport: { width: 844, height: 390 }, device: { hasTouch: true, isMobile: true } });
  await scenario('opening-a-task-on-a-phone-lands-on-its-work-area', async f => {
   const link = row(f, 'prepare').getByRole('link', { name: /^Ouvrir Optimiser les colis/ });
   assert.ok((await link.getAttribute('href')).endsWith('#dossier-work'));
   await link.click();
   await f.page.waitForURL(url => url.hash === '#dossier-work' && url.searchParams.get('section') === 'preparation');
   await f.page.waitForFunction(() => { const rect = document.getElementById('dossier-work')?.getBoundingClientRect(); return rect && rect.top >= 0 && rect.top < innerHeight / 2; });
   await f.page.goBack();
   await row(f, 'documents').getByRole('button', { name: 'Continuer', exact: true }).click();
   await f.page.waitForURL(url => url.hash === '#dossier-work' && url.searchParams.get('section') === 'documents');
   await f.page.waitForFunction(() => { const rect = document.getElementById('dossier-work')?.getBoundingClientRect(); return rect && rect.top >= 0 && rect.top < innerHeight / 2; });
  }, { viewport: { width: 390, height: 844 } });
  for (const width of [1440, 1280]) await scenario(`sidebar-icons-role-and-receive-button-${width}`, async f => {
   const sidebar = f.page.locator('.staff-sidebar');
   const icon = name => sidebar.getByRole('button', { name, exact: true }).locator('svg').getAttribute('class');
   assert.notEqual(await icon('Équipe'), await icon('Clients'), 'Équipe and Clients have their own icons');
   assert.ok(parseFloat(await sidebar.getByText('Direction', { exact: true }).evaluate(node => getComputedStyle(node).fontSize)) >= 11);
   const receive = sidebar.getByRole('button', { name: 'Réceptionner des cartons', exact: true });
   const label = await receive.evaluate(button => { const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE); const range = document.createRange(); range.selectNodeContents(text); const rects = [...range.getClientRects()]; const box = button.getBoundingClientRect(); return { lines: new Set(rects.map(rect => Math.round(rect.top))).size, inside: rects.every(rect => rect.right <= box.right + 0.5) }; });
   assert.ok(label.inside, 'The label never leaves its button');
   // The sidebar is sized for the system fonts of macOS and Windows; the wider Linux
   // fonts of the CI may wrap it on two lines, inside the button.
   if (process.platform !== 'linux') assert.equal(label.lines, 1, '« Réceptionner des cartons » on one line');
   await shot(f, `sidebar-${width}`);
  }, { viewport: { width, height: 900 } });
  for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) await scenario(`no-page-overflow-at-${width}`, async f => {
   await f.page.getByRole('region', { name: 'À faire', exact: true }).locator('[data-work-action]').first().waitFor();
   assert.equal(await pageOverflow(f), false);
   if (width >= 1280) assert.ok(await todo(f).locator('.work-table-frame').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'The default columns fit without scrolling');
   await f.page.locator('summary').filter({ hasText: /^Filtrer/ }).click();
   await f.page.getByLabel('Mission', { exact: true }).waitFor();
   assert.equal(await pageOverflow(f), false, 'Open filters fit too');
  }, { viewport: { width, height: 900 } });
  for (const width of [1440, 390]) for (const dark of [false, true]) await scenario(`axe-${width}-${dark ? 'dark' : 'light'}`, async f => {
   assert.equal(await f.page.locator('html').evaluate(node => node.classList.contains('dark')), dark);
   await todo(f).locator('[data-work-action]').first().waitFor();
   const audit = async label => {
    const axe = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], label);
   };
   await audit('list');
   await row(f, 'prepare').getByRole('button', { name: 'Options', exact: true }).click();
   await f.page.getByRole('button', { name: 'Passer à un collègue', exact: true }).click();
   await audit('open task options');
   await display(f); await audit('display dialog'); await closeDisplay(f);
  }, { dark, viewport: { width, height: width === 390 ? 844 : 900 } });
  // Review screenshots: the page scrolls inside the application frame, so a tall
  // viewport shows the whole list.
  for (const width of [1440, 1024, 768, 390]) for (const dark of [false, true]) await scenario(`screenshots-${width}-${dark ? 'dark' : 'light'}`, async f => {
   await todo(f).locator('[data-work-action]').first().waitFor();
   await shot(f, `todo-${width}-${dark ? 'dark' : 'light'}`);
   await f.page.getByRole('button', { name: 'En attente 1', exact: true }).click();
   await row(f, 'waiting').waitFor();
   await shot(f, `waiting-${width}-${dark ? 'dark' : 'light'}`);
   await f.page.getByRole('button', { name: 'À prendre 1', exact: true }).click();
   await row(f, 'pool').waitFor();
   await shot(f, `pool-${width}-${dark ? 'dark' : 'light'}`);
  }, { dark, viewport: { width, height: width === 390 ? 1300 : 1100 } });
 } finally { await browser.close(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); }
 if (results.some(item => !item.pass)) { process.exitCode = 1; console.error(JSON.stringify(results.filter(item => !item.pass), null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
