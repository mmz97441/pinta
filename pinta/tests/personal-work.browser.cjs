/* Personal work fixtures are isolated: navigation never sends customer messages or claims tasks. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_PERSONAL_WORK_OUT || '/tmp/pinta-personal-work';
const B = '88888888-1111-4111-8111-111111111111';
const P2 = '99999999-1111-4111-8111-111111111111';
const results = [];
const row = (f, id) => f.page.locator(`[data-work-action="${id}"]`);
async function fixture(browser, restricted = false) {
 const f = await setup(browser, restricted ? 'preparateur' : 'directeur');
 f.page.setDefaultTimeout(10000);
 if (restricted) {
  const permissions = { id: 'prep-permissions', staff_id: ids.S, perm_colis_preparer: true };
  f.tables.staff_permissions = [permissions]; f.tables.staff_users[0].staff_permissions = permissions;
 }
 f.tables.staff_work_preferences = [{ staff_id: ids.A, missions: ['reception','preparation','communication','documents','departures'], active_mission: null, density: 'comfortable', available: true, version: 1 }];
 f.tables.staff_users.push({ id: B, auth_id: B, nom: 'Madly', role: 'directeur', actif: true, staff_permissions: {} });
 f.tables.colis.push({ ...f.tables.colis[0], id: P2, ref: 'EXP-AUTRE-EQUIPE' });
 const mk = (id, kind, rest = {}) => ({ id, colis_id: ids.P, kind, state: 'ready', assignee_id: ids.A, version: 1, created_at: '2026-09-10T08:00:00Z', ...rest });
 f.tables.staff_work_actions = [
  mk('prepare', 'preparation'), mk('started', 'departure', { state: 'in_progress' }),
  mk('quote', 'quote', { due_at: '2020-01-01T10:00:00Z' }),
  mk('documents', 'documents', { state: 'waiting', waiting_reason: 'Vérification fournisseur', review_at: '2099-01-01' }),
  mk('pool', 'conversation', { assignee_id: null }),
  mk('relay', 'preparation', { assignee_id: B, handoff_to: ids.A, handoff_note: 'Vérifier le carton fragile' }),
  mk('outside', 'correction'),
 ];
 return f;
}
function assertNoMutation(f) {
 assert.equal(f.requests.some(request => /\/(mutate_staff_work_action|queue_message|save_quote|save_invoice_review|save_preparation_measurements)$/.test(request.path)), false);
 assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
}
(async () => {
 await fs.mkdir(output, { recursive: true });
 const browser = await chromium.launch({ headless: true });
 async function scenario(name, callback, restricted = false) {
  const f = await fixture(browser, restricted);
  try { await f.login(); await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor(); await callback(f); assertNoMutation(f); results.push({ test: name, pass: true }); }
  catch (error) { process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack }); await f.page.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(output, name + '-failure.txt'), await f.page.locator('body').innerText().catch(() => '')); }
  finally { await f.context.close(); }
 }
 try {
  await scenario('two-views-merge-current-work-and-preserve-priority-and-old-bookmarks', async f => {
   const nav = f.page.getByRole('navigation', { name: 'Mes actions', exact: true });
   await nav.getByRole('button', { name: 'À faire 3', exact: true }).waitFor();
   assert.equal(await nav.getByRole('button').count(), 2);
   const actions = f.page.getByRole('region', { name: 'À faire', exact: true });
   assert.deepEqual(await actions.locator('article').evaluateAll(rows => rows.map(row => row.dataset.workAction)), ['quote', 'started', 'prepare']);
   await row(f, 'started').getByText('En cours', { exact: true }).waitFor();
   await row(f, 'quote').getByText(/Échéance dépassée/).waitFor();
   for (const [legacy, section, count] of [['progress','À faire',3],['now','À faire',3],['waiting','En attente',1],['pool','À prendre',1]]) {
    await f.page.goto(base + '/?section=' + legacy);
    await f.page.getByRole('region', { name: section, exact: true }).waitFor();
    assert.equal(await f.page.getByRole('region', { name: section, exact: true }).locator('article').count(), count);
   }
  });
  await scenario('filters-never-hide-urgent-owned-actions-handoffs-or-mission-exceptions', async f => {
   await f.page.locator('summary').filter({ hasText: /^Filtrer/ }).click();
   await f.page.getByLabel('Mission', { exact: true }).selectOption('preparation');
   await f.page.getByLabel('Rechercher dans mes tâches', { exact: true }).fill('aucun-résultat');
   await f.page.getByRole('region', { name: 'Urgences hors filtre', exact: true }).locator('[data-work-action="quote"]').waitFor();
   await f.page.getByRole('region', { name: 'Relais à accepter', exact: true }).getByRole('button', { name: 'Accepter le relais', exact: true }).waitFor();
   await f.page.getByRole('region', { name: 'Actions hors missions ou permissions', exact: true }).locator('[data-work-action="outside"]').waitFor();
   await f.page.getByRole('button', { name: 'Voir mes tâches sans filtre', exact: true }).click();
   await f.page.waitForURL(url => !url.searchParams.has('q') && url.searchParams.get('mission') === '');
   await f.page.waitForFunction(() => document.querySelector('input[placeholder="Client, EXP, tâche…"]')?.value === '');
   assert.equal(await f.page.getByLabel('Rechercher dans mes tâches', { exact: true }).inputValue(), '');
   assert.equal(await f.page.getByLabel('Mission', { exact: true }).inputValue(), '');
  });
  await scenario('global-search-finds-a-colleagues-dossier-independent-of-personal-missions', async f => {
   await f.page.locator('summary').filter({ hasText: /^Filtrer/ }).click();
   await f.page.getByLabel('Mission', { exact: true }).selectOption('preparation');
   await f.page.getByLabel('Rechercher dans mes tâches', { exact: true }).fill('EXP-AUTRE-EQUIPE');
   await f.page.getByRole('link', { name: 'Chercher aussi dans tous les dossiers', exact: true }).click();
   await f.page.waitForURL(url => url.pathname === '/colis' && url.searchParams.get('q') === 'EXP-AUTRE-EQUIPE');
   assert.equal(new URL(f.page.url()).searchParams.has('mission'), false);
   await f.page.getByRole('button', { name: 'EXP-AUTRE-EQUIPE', exact: true }).waitFor();
   assert.equal(await f.page.getByRole('button', { name: 'EXP-TEST-001', exact: true }).count(), 0);
  });
  await scenario('each-task-opens-directly-and-retains-exact-list-filters-without-claim', async f => {
   for (const [id, list, section] of [['prepare','/?section=progress&mission=preparation&q=Exemple','preparation'],['quote','/?mission=documents','devis'],['documents','/?section=waiting&mission=documents','documents'],['started','/?section=now&mission=departures','expedition']]) {
    await f.page.goto(base + list); const item = row(f, id);
    await item.getByRole('link', { name: /^Ouvrir / }).click();
    await f.page.waitForURL(url => url.pathname === '/colis/' + ids.P && url.searchParams.get('section') === section);
    const url = new URL(f.page.url()); assert.equal(url.searchParams.get('returnTo'), list); assert.equal(url.searchParams.get('action'), id);
   }
   await f.page.goto(base + '/?section=pool');
   const invitation = row(f, 'pool');
   await invitation.getByRole('button', { name: 'Consulter sans commencer', exact: true }).click();
   await f.page.waitForURL(url => url.pathname === '/conversations' && url.searchParams.get('action') === 'pool');
   assert.equal(f.tables.staff_work_actions.find(action => action.id === 'pool').assignee_id, null);
  });
  await scenario('permissions-remain-distinct-even-when-a-mission-is-requested-in-the-url', async f => {
   await f.page.goto(base + '/?mission=documents');
   const exceptions = f.page.getByRole('region', { name: 'Actions hors missions ou permissions', exact: true });
   await exceptions.locator('[data-work-action="quote"]').waitFor();
   assert.equal(await row(f, 'quote').getByRole('button', { name: 'Commencer', exact: true }).count(), 0);
   await row(f, 'quote').getByText('Permission modifiée : organisez un relais avec une personne habilitée.', { exact: true }).waitFor();
   assert.equal(await f.page.getByLabel('Mission', { exact: true }).locator('option[value="documents"]').count(), 0);
   await f.page.goto(base + '/?mission=preparation');
   await f.page.getByRole('region', { name: 'À faire', exact: true }).locator('[data-work-action="prepare"]').waitFor();
  }, true);
  await scenario('completed-task-offers-explicit-next-authorized-task-and-exact-return-without-claim', async f => {
   f.tables.staff_work_actions.find(action => action.id === 'prepare').state = 'done';
   f.tables.staff_work_actions.push({ ...f.tables.staff_work_actions.find(action => action.id === 'prepare'), id: 'prepare-next', colis_id: P2, state: 'ready' });
   const returnTo = '/?section=progress&mission=preparation&q=Exemple';
   await f.page.goto(`${base}/colis/${ids.P}?${new URLSearchParams({ section: 'preparation', action: 'prepare', returnTo })}`);
   const continuation = f.page.getByRole('navigation', { name: 'Après cette tâche', exact: true });
   await continuation.getByRole('link', { name: /Ouvrir la prochaine tâche/ }).waitFor();
   assert.equal(await continuation.getByRole('link', { name: 'Retour à ma liste', exact: true }).getAttribute('href'), returnTo);
   await continuation.getByRole('link', { name: /Ouvrir la prochaine tâche/ }).click();
   await f.page.waitForURL(url => url.pathname === '/colis/' + P2 && url.searchParams.get('action') === 'prepare-next');
   assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), returnTo);
   assert.equal(f.tables.staff_work_actions.find(action => action.id === 'prepare-next').state, 'ready');
   assert.equal(f.tables.staff_work_actions.find(action => action.id === 'prepare-next').assignee_id, ids.A);
  });
  for (const mobile of [false, true]) for (const dark of [false, true]) await scenario(`compact-list-axe-${mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}`, async f => {
   await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
   const current = await f.page.locator('html').evaluate(node => node.classList.contains('dark'));
   if (current !== dark) await f.page.getByRole('button', { name: dark ? 'Passer en mode sombre' : 'Passer en mode clair', exact: true }).filter({ visible: true }).click();
   assert.equal(await f.page.locator('html').evaluate(node => node.classList.contains('dark')), dark);
   assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
   const axe = await new AxeBuilder({ page: f.page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
   assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
   await f.page.screenshot({ path: path.join(output, `personal-${mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
  });
 } finally { await browser.close(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
