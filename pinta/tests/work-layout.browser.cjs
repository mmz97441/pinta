/* Mon travail, Tableau and Cartes: fictitious tasks, every remote request mocked.
   Nothing is claimed, saved or sent: layout, display preferences and drafts only. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
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

async function fixture(browser, { dark = false } = {}) {
 const f = await setup(browser, 'directeur');
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
function assertNoMutation(f) {
 assert.equal(f.requests.some(request => /\/(mutate_staff_work_action|save_staff_work_preferences|queue_message|save_quote|save_invoice_review|save_preparation_measurements)$/.test(request.path)), false, 'Display choices never write business data');
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
// The staff shell clips the document: measure the page and the container that scrolls it.
const pageOverflow = f => f.page.evaluate(() => {
 const main = document.querySelector('main.work-page'), scroller = main?.parentElement;
 return document.documentElement.scrollWidth > innerWidth + 1
  || Boolean(main && main.scrollWidth > main.clientWidth + 1)
  || Boolean(scroller && scroller.scrollWidth > scroller.clientWidth + 1);
});
async function display(f) { await displayButton(f).click(); await displayDialog(f).waitFor(); return displayDialog(f); }
async function closeDisplay(f) { await displayDialog(f).getByRole('button', { name: 'Fermer l’affichage', exact: true }).click(); await displayDialog(f).waitFor({ state: 'hidden' }); }
async function chooseLayout(f, value) { const dialog = await display(f); await dialog.getByLabel('Affichage des tâches', { exact: true }).selectOption(value); await closeDisplay(f); }
const focused = locator => locator.evaluate(node => node === document.activeElement);
async function shot(f, name) { await f.page.mouse.move(0, 0); await f.page.screenshot({ path: path.join(output, name + '.png') }); }

(async () => {
 await fs.mkdir(output, { recursive: true });
 const browser = await chromium.launch({ headless: true });
 async function scenario(name, callback, options = {}) {
  if (process.env.PINTA_WORK_LAYOUT_FILTER && !name.includes(process.env.PINTA_WORK_LAYOUT_FILTER)) return;
  const f = await fixture(browser, options);
  try {
   if (options.viewport) await f.page.setViewportSize(options.viewport);
   await f.login(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
   await callback(f); assertNoMutation(f); results.push({ test: name, pass: true });
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
   await row(f, 'waiting').getByText(/En attente : Vérification fournisseur · À revoir le /).waitFor();
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
   await dialog.getByRole('button', { name: 'Agrandir le texte des tâches', exact: true }).click();
   await dialog.getByRole('button', { name: 'Agrandir le texte des tâches', exact: true }).click();
   assert.equal(await dialog.getByLabel('Taille du texte des tâches', { exact: true }).inputValue(), '17');
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
