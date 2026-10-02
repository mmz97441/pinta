/* Full-page dossier journey on synthetic data only. Every remote request is mocked. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const { openTaskNavigation } = require('./task-navigation.helper.cjs');
const { openDetailsFor } = require('./ui-disclosure-helpers.cjs');
const output = process.env.PINTA_DOSSIER_FLOW_OUT || '/tmp/pinta-parcours-dossier';
const B = '88888888-1111-4111-8111-111111111111';
const P2 = '73333333-3333-4333-8333-333333333333';
const conversationId = '77777777-0000-4000-8000-000000000010';
const results = [];
const tab = (f, name) => f.page.getByRole('tab', { name: name === 'Colis' ? 'Colis' : /^Conversation/, exact: name === 'Colis' });
const preparationField = (f, label = 'Poids réel', unit = 'kg') => f.page.getByLabel(`${label} · colis sortant 1 (${unit})`, { exact: true });
const measureWrites = f => f.requests.filter(request => request.path.endsWith('/save_preparation_measurements'));
const businessWrites = f => f.requests.filter(request => /\/(queue_message|save_quote|save_quote_customs|save_invoice_review|save_preparation_measurements|transition_colis|revert_colis|client_decision|mark_manual_payment|append_reception_cartons|mutate_staff_work_action)$/.test(request.path));
const readMessages = f => f.requests.filter(request => request.path === '/rest/v1/messages' && request.method === 'PATCH');
const navigate = (f, url) => f.page.evaluate(to => { history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, url);

function pendingPreparation(f, authorised = true) {
  Object.assign(f.tables.colis[0], {
    statut: authorised ? 'autorise' : 'attente_feu_vert', feu_vert: authorised ? 'autorise' : 'en_attente',
    dims_par_colis: [{ dimL: 40, dimW: 30, dimH: 20, poids: 2 }, { dimL: 30, dimW: 20, dimH: 20, poids: 1 }],
    final_packages: [], fin_l: null, fin_w: null, fin_h: null, fin_p: null,
    final_measurements_version: null, final_measurements_at: null, outgoing_parcel_count: 0,
  });
}

function addConversation(f, assignee = ids.A) {
  f.tables.clients[0].user_id = 'client-fixture';
  f.tables.colis[0].conversation_statut = 'a_traiter';
  f.tables.colis[0].conversation_version = 1;
  f.tables.messages.push({ id: 'message-current', colis_id: ids.P, type: 'client', auteur_nom: 'Camille Exemple', texte: 'Merci de conserver les deux achats ensemble.', lu: false, created_at: '2026-10-01T06:00:00Z' });
  f.tables.staff_work_actions.push({ id: conversationId, colis_id: ids.P, kind: 'conversation', state: 'in_progress', assignee_id: assignee, version: 1, created_at: '2026-10-01T06:00:00Z' });
}

async function open(f, section = 'preparation', query = '') {
  await f.page.goto(`${base}/colis/${ids.P}?section=${section}${query}`);
  await f.page.getByTestId('dossier-task-header').waitFor();
  await tab(f, 'Colis').waitFor();
}

async function assertFullPage(f, { conversation = false, reference = 'EXP-TEST-001' } = {}) {
  await f.page.getByTestId('dossier-task-header').getByText(reference, { exact: true }).waitFor();
  assert.equal(await f.page.locator('.dossier-list').count(), 0, 'An open dossier replaces the list rather than squeezing work into an adjacent panel.');
  assert.equal(await f.page.getByRole('dialog', { name: 'Contexte du dossier', exact: true }).count(), 0);
  assert.equal(await tab(f, conversation ? 'Conversation' : 'Colis').getAttribute('aria-selected'), 'true');
  assert.equal(new URL(f.page.url()).pathname.startsWith('/colis/'), true);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, role = 'directeur') {
    if (process.env.PINTA_DOSSIER_FLOW_FILTER && !name.includes(process.env.PINTA_DOSSIER_FLOW_FILTER)) return;
    const f = await setup(browser, role); f.page.setDefaultTimeout(12000);
    try {
      await run(f);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
      assert.equal(f.requests.some(request => request.path.endsWith('/queue_message')), false, 'No message is sent while receiving, reading, measuring or navigating.');
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
      await f.page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {});
      await fs.writeFile(`${output}/${name}-failure.txt`, await f.page.locator('body').innerText().catch(() => ''));
    } finally { await f.context.close(); console.log(JSON.stringify(results.at(-1))); }
  }
  try {
    for (const mobile of [false, true]) await scenario(`list-opens-full-page-and-restores-filters-${mobile ? 'mobile' : 'desktop'}`, async f => {
      await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      await f.login();
      const returnTo = '/colis?sort=client&dir=desc&q=Camille';
      await f.page.goto(base + returnTo);
      await f.page.getByRole('button', { name: 'EXP-TEST-001', exact: true }).click();
      await assertFullPage(f);
      assert.equal(await f.page.getByRole('tab').count(), 2);
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), returnTo);
      await f.page.getByRole('button', { name: 'Retour à la liste de travail', exact: true }).click();
      await f.page.waitForURL(base + returnTo);
      await f.page.getByRole('button', { name: 'EXP-TEST-001', exact: true }).waitFor();
      assert.deepEqual(businessWrites(f), []);
    });

    await scenario('legacy-selected-dossier-link-opens-full-page-with-loop-free-return', async f => {
      await f.login(); await f.page.goto(`${base}/colis?sort=client&dir=desc&dossier=${ids.P}`);
      await assertFullPage(f);
      const destination = new URL(new URL(f.page.url()).searchParams.get('returnTo'), base);
      assert.equal(destination.pathname, '/colis');
      assert.equal(destination.searchParams.get('sort'), 'client');
      assert.equal(destination.searchParams.get('dir'), 'desc');
      assert.equal(destination.searchParams.has('dossier'), false, 'Returning to the list cannot immediately reopen the same dossier.');
      await f.page.getByRole('button', { name: 'Retour à la liste de travail', exact: true }).click();
      await f.page.waitForURL(destination.toString());
      assert.deepEqual(businessWrites(f), []);
    });

    await scenario('legacy-conversation-link-opens-the-same-dossier-conversation', async f => {
      addConversation(f); await f.login(); await f.page.goto(`${base}/conversations?dossier=${ids.P}&state=a_traiter`);
      await assertFullPage(f, { conversation: true });
      await f.page.getByRole('log', { name: 'Messages avec le client', exact: true }).getByText('Merci de conserver les deux achats ensemble.', { exact: true }).waitFor();
      assert.equal(await f.page.locator('textarea[id^="staff-message-"]').count(), 1);
      await f.page.locator('summary').filter({ hasText: 'Ce qui a déjà été fait' }).click();
      await f.page.getByText('Aucun événement enregistré.', { exact: true }).waitFor();
      assert.equal(await f.page.getByTestId('dossier-task-header').getByRole('region', { name: 'Prise en charge de la tâche', exact: true }).count(), 0, 'The preparation owner is not presented as the conversation owner.');
      await f.page.getByRole('tabpanel', { name: /^Conversation/ }).getByRole('region', { name: 'Prise en charge de la tâche', exact: true }).getByText('Vous vous en occupez',{exact:true}).waitFor();
      assert.deepEqual(businessWrites(f), []);
    });

    await scenario('conversation-task-opens-conversation-not-another-list', async f => {
      addConversation(f); await f.login();
      const action = f.page.locator(`[data-work-action="${conversationId}"]`);
      await action.getByRole('button', { name: 'Continuer', exact: true }).click();
      await assertFullPage(f, { conversation: true });
      await f.page.getByLabel('Votre réponse au client', { exact: true }).waitFor();
      assert.deepEqual(businessWrites(f), []);
    });

    await scenario('tabs-keep-measurements-and-one-reply-draft-without-sending', async f => {
      pendingPreparation(f); addConversation(f); await f.login(); await open(f);
      assert.equal(readMessages(f).length, 0, 'An unopened conversation must not mark the client message as read.');
      await preparationField(f).fill('2.75');
      await preparationField(f, 'Longueur', 'cm').fill('33');
      await tab(f, 'Conversation').click();
      const reply = f.page.getByLabel('Votre réponse au client', { exact: true });
      await reply.fill('Je vérifie vos cartons. Réponse encore en brouillon.');
      assert.equal(f.tables.messages[0].lu, true);
      assert.ok(readMessages(f).length >= 1);
      await tab(f, 'Colis').click();
      assert.equal(await preparationField(f).inputValue(), '2.75');
      assert.equal(await preparationField(f, 'Longueur', 'cm').inputValue(), '33');
      await f.page.getByRole('log', { name: 'Messages avec le client', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await f.page.getByRole('log', { name: 'Messages avec le client', exact: true }).count(), 0, 'The hidden conversation is not exposed as another live workspace.');
      await tab(f, 'Conversation').click();
      assert.equal(await reply.inputValue(), 'Je vérifie vos cartons. Réponse encore en brouillon.');
      assert.equal(await f.page.locator('textarea[id^="staff-message-"]').count(), 1);
      await f.page.getByRole('button', { name: /^Détails(?: du dossier)?$/ }).click();
      const context = f.page.getByRole('dialog', { name: 'Contexte du dossier', exact: true });
      assert.equal(await context.getByRole('button', { name: 'Messages', exact: true }).count(), 0, 'Details cannot mount a second message composer.');
      await context.getByRole('button', { name: 'Fermer le contexte du dossier', exact: true }).click();
      await tab(f, 'Colis').click();
      assert.equal(f.tables.colis[0].statut, 'autorise');
      assert.deepEqual(businessWrites(f), []);
    });

    await scenario('new-client-message-stays-unread-while-conversation-tab-is-hidden', async f => {
      addConversation(f); await f.login(); await open(f);
      await tab(f, 'Conversation').click(); await f.page.getByLabel('Votre réponse au client', { exact: true }).waitFor();
      await tab(f, 'Colis').click();
      const readsBefore = readMessages(f).length;
      f.tables.colis[0].updated_at = '2099-10-01T07:00:00Z';
      f.tables.messages.push({ ...f.tables.messages[0], id: 'message-later', texte: 'Je viens d’envoyer une nouvelle facture.', lu: false, created_at: '2026-10-01T07:00:00Z' });
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await tab(f, 'Conversation').getByLabel('1 messages non lus', { exact: true }).waitFor();
      assert.equal(f.tables.messages[1].lu, false);
      assert.equal(readMessages(f).length, readsBefore, 'Hidden tab does not issue a new mark-read command.');
      await tab(f, 'Conversation').click();
      await f.page.getByRole('log', { name: 'Messages avec le client', exact: true }).getByText('Je viens d’envoyer une nouvelle facture.', { exact: true }).waitFor();
      await f.page.waitForFunction(() => !document.querySelector('[aria-label="1 messages non lus"]'));
      assert.equal(f.tables.messages[1].lu, true); assert.ok(readMessages(f).length > readsBefore);
    });

    await scenario('conversation-drafts-stay-with-their-own-expedition', async f => {
      addConversation(f); f.tables.colis.push({ ...f.tables.colis[0], id: P2, ref: 'EXP-SECOND' });
      await f.login(); await open(f, 'preparation', '&onglet=conversation');
      const reply = () => f.page.getByLabel('Votre réponse au client', { exact: true });
      await reply().fill('Brouillon premier envoi');
      await navigate(f, `/colis/${P2}?onglet=conversation`);
      await assertFullPage(f, { conversation: true, reference: 'EXP-SECOND' });
      assert.equal(await reply().inputValue(), ''); await reply().fill('Brouillon second envoi');
      await navigate(f, `/colis/${ids.P}?onglet=conversation`);
      await assertFullPage(f, { conversation: true });
      assert.equal(await reply().inputValue(), 'Brouillon premier envoi');
      await navigate(f, `/colis/${P2}?onglet=conversation`);
      await assertFullPage(f, { conversation: true, reference: 'EXP-SECOND' });
      assert.equal(await reply().inputValue(), 'Brouillon second envoi');
      assert.deepEqual(businessWrites(f), []);
    });

    await scenario('authorised-optimisation-opens-directly-and-only-save-changes-status', async f => {
      pendingPreparation(f); const original = structuredClone(f.tables.colis[0]);
      await f.login(); await open(f);
      await preparationField(f).waitFor();
      assert.equal(await f.page.getByRole('button', { name: /Commencer (?:la préparation|l’optimisation)/ }).count(), 0);
      assert.deepEqual(f.tables.colis[0], original);
      for (const [label, unit, value] of [['Longueur', 'cm', '30'], ['Largeur', 'cm', '20'], ['Hauteur', 'cm', '15'], ['Poids réel', 'kg', '2.75']]) await preparationField(f, label, unit).fill(value);
      await f.page.getByRole('button', { name: 'Enregistrer l’optimisation', exact: true }).click();
      await f.page.getByRole('region', { name: /Relais après (?:préparation|optimisation)/ }).waitFor();
      assert.equal(f.tables.colis[0].statut, 'en_preparation');
      assert.equal(Number(f.tables.colis[0].final_packages[0].poids), 2.75);
      assert.equal(f.tables.colis[0].final_measurements_version, f.tables.colis[0].preparation_composition_version);
      assert.deepEqual(f.tables.colis[0].dims_par_colis, original.dims_par_colis);
      assert.equal(measureWrites(f).length, 1);
      assert.equal(f.requests.some(request => request.path.endsWith('/save_quote')), false);
      await f.page.reload(); await f.page.getByRole('region', { name: /Relais après (?:préparation|optimisation)/ }).waitFor();
      assert.match(await f.page.locator('#preparation-workspace').innerText(), /2[.,]75/);
    });

    await scenario('late-optimisation-save-never-steals-conversation-focus', async f => {
      pendingPreparation(f); addConversation(f); await f.login(); await open(f);
      let release, entered; const gate = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; });
      await f.context.route('**/rest/v1/rpc/save_preparation_measurements', async route => { entered(); await gate; return route.fallback(); });
      for (const [label, unit, value] of [['Longueur','cm','30'],['Largeur','cm','20'],['Hauteur','cm','15'],['Poids réel','kg','2.75']]) await preparationField(f,label,unit).fill(value);
      await f.page.getByRole('button', { name: 'Enregistrer l’optimisation', exact: true }).click(); await started;
      await tab(f, 'Conversation').click(); const reply = f.page.getByLabel('Votre réponse au client', { exact: true });
      await reply.fill('Je prépare une réponse pendant la sauvegarde.'); await reply.focus();
      const completed = f.page.waitForResponse(value => value.url().endsWith('/save_preparation_measurements'));
      release(); await completed; await f.page.waitForTimeout(350);
      assert.equal(await reply.evaluate(node => node === document.activeElement), true, 'Completion in the hidden tab never takes keyboard focus.');
      assert.equal(new URL(f.page.url()).searchParams.get('onglet'), 'conversation');
      assert.equal(await reply.inputValue(), 'Je prépare une réponse pendant la sauvegarde.');
      await tab(f, 'Colis').click(); await f.page.getByRole('region', { name: 'Relais après préparation', exact: true }).waitFor();
      assert.equal(f.tables.colis[0].statut, 'en_preparation'); assert.equal(measureWrites(f).length, 1);
    });

    await scenario('waiting-agreement-has-useful-action-and-never-unlocks-optimisation', async f => {
      pendingPreparation(f, false); const original = structuredClone(f.tables.colis[0]);
      await f.login(); await open(f);
      await f.page.getByTestId('task-guidance').waitFor();
      assert.equal(await preparationField(f).count(), 0);
      await f.page.getByRole('button', { name: 'Voir l’accord du client', exact: true }).click();
      await f.page.waitForURL(url => url.searchParams.get('section') === 'accord');
      assert.equal(await tab(f, 'Colis').getAttribute('aria-selected'), 'true');
      assert.deepEqual(f.tables.colis[0], original); assert.deepEqual(businessWrites(f), []);
    });

    await scenario('invoice-edit-and-extra-item-drafts-survive-conversation-tab', async f => {
      f.tables.factures[0].valide = false;
      await f.login(); await open(f, 'documents');
      const description = f.page.getByLabel('Description de l’article 1', { exact: true });
      await description.fill('Article corrigé à vérifier');
      const manual = f.page.getByLabel('Description du nouvel article', { exact: true });
      await openDetailsFor(manual); await manual.fill('Achat complémentaire encore en brouillon');
      await f.page.getByLabel('Prix du nouvel article', { exact: true }).fill('7');
      await tab(f, 'Conversation').click(); await f.page.getByLabel('Votre réponse au client', { exact: true }).fill('Demande encore en brouillon');
      await tab(f, 'Colis').click();
      assert.equal(await description.inputValue(), 'Article corrigé à vérifier');
      assert.equal(await manual.inputValue(), 'Achat complémentaire encore en brouillon');
      assert.equal(await f.page.getByLabel('Prix du nouvel article', { exact: true }).inputValue(), '7');
      assert.equal(f.tables.lignes.length, 1); assert.equal(f.tables.lignes[0].description, 'Article vérifié');
      assert.equal(f.tables.factures[0].valide, false); assert.deepEqual(businessWrites(f), []);
    });

    await scenario('unfinished-quote-fee-survives-conversation-without-entering-final-review', async f => {
      await f.login(); await open(f, 'devis');
      await f.page.getByText('Ajouter un frais', { exact: true }).click();
      const name = f.page.getByLabel('Libellé du frais', { exact: true }), amount = f.page.getByLabel('Montant du frais', { exact: true });
      await name.fill('Emballage en cours'); await amount.fill('9');
      await tab(f, 'Conversation').click(); await f.page.getByLabel('Votre réponse au client', { exact: true }).waitFor();
      await tab(f, 'Colis').click();
      assert.equal(await name.inputValue(), 'Emballage en cours'); assert.equal(await amount.inputValue(), '9');
      assert.equal(await f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis', exact: true }).isDisabled(), true);
      assert.deepEqual(f.tables.colis[0].frais_divers, []); assert.deepEqual(businessWrites(f), []);
    });

    await scenario('two-customs-codes-allocate-transport-by-item-value-in-visible-saved-quote', async f => {
      const duty = (code, rates) => ({tariffId:'tariff-'+code,code,label:'Nomenclature fictive '+code,destination:'974',rates,baseRates:rates,source:{id:'fixture',label:'Taux fictifs de recette'},overrideReason:null});
      Object.assign(f.tables.lignes[0], { qte:1, prix_unitaire:100, custom_duty:duty('11111111',{om:10,omr:2.5}) });
      f.tables.lignes.push({...f.tables.lignes[0],id:'second-line',description:'Trois articles vérifiés',qte:3,prix_unitaire:100,custom_duty:duty('22222222',{om:5,omr:1})});
      f.tables.factures[0].montant=400;
      await f.login(); await open(f, 'devis');
      await f.page.getByRole('button',{name:'Enregistrer et vérifier le devis',exact:true}).click();
      await f.page.getByRole('button',{name:'Envoyer le devis au client',exact:true}).waitFor();
      const quote = f.tables.colis[0].devis_snapshot;
      assert.equal(quote.amounts.transport,40); assert.deepEqual(quote.amounts.taxLines.map(line=>[line.value,line.transportShare,line.cif]),[[100,10,110],[300,30,330]]);
      assert.deepEqual(quote.inputs.lines.map(line=>line.customDuty.code),['11111111','22222222']);
      assert.equal(quote.amounts.om,27.5); assert.equal(quote.amounts.omr,6.05);
      const details = f.page.locator('details').filter({has:f.page.locator('summary').filter({hasText:'Articles et taux retenus (2)'})});
      await details.locator('summary').click();
      const rows = details.locator('li'); assert.equal(await rows.count(),2);
      assert.match(await rows.nth(0).innerText(),/Part de transport : 10[.,]00.*Base OM \/ OMR : 110[.,]00/);
      assert.match(await rows.nth(1).innerText(),/Part de transport : 30[.,]00.*Base OM \/ OMR : 330[.,]00/);
      assert.equal(f.requests.filter(request=>request.path.endsWith('/save_quote')).length,1);
    });

    await scenario('different-colleagues-can-own-optimisation-and-conversation', async f => {
      pendingPreparation(f); addConversation(f, ids.A);
      f.tables.staff_users.push({ id: B, auth_id: B, nom: 'Madly', role: 'directeur', actif: true, staff_permissions: {} });
      f.tables.staff_work_actions[0].assignee_id = B;
      await f.login(); await open(f);
      await f.page.getByRole('status').filter({ hasText: 'Madly s’occupe de cette tâche.' }).waitFor();
      if (await preparationField(f).count()) assert.equal(await preparationField(f).isDisabled(), true);
      await tab(f, 'Conversation').click();
      assert.equal(await f.page.getByLabel('Votre réponse au client', { exact: true }).isEnabled(), true);
      await f.page.getByLabel('Votre réponse au client', { exact: true }).fill('Réponse indépendante de l’optimisation');
      assert.equal(await f.page.getByTestId('dossier-task-header').getByRole('region', { name: 'Prise en charge de la tâche', exact: true }).count(), 0);
      await f.page.getByRole('tabpanel', { name: /^Conversation/ }).getByRole('region', { name: 'Prise en charge de la tâche', exact: true }).getByText('Vous vous en occupez',{exact:true}).waitFor();
      assert.deepEqual(businessWrites(f), []);
    });

    await scenario('colleague-conversation-is-read-only-while-own-optimisation-remains-editable', async f => {
      pendingPreparation(f); addConversation(f, B);
      f.tables.staff_users.push({ id: B, auth_id: B, nom: 'Madly', role: 'directeur', actif: true, staff_permissions: {} });
      await f.login(); await open(f); assert.equal(await preparationField(f).isEnabled(), true);
      await tab(f, 'Conversation').click();
      await f.page.getByRole('status').filter({ hasText: 'Madly s’occupe de cette conversation.' }).waitFor();
      assert.equal(await f.page.getByLabel('Votre réponse au client', { exact: true }).isDisabled(), true);
      assert.equal(await f.page.getByRole('button', { name: 'Envoyer le message', exact: true }).isDisabled(), true);
      await tab(f, 'Colis').click(); assert.equal(await preparationField(f).isEnabled(), true);
      assert.deepEqual(businessWrites(f), []);
    });

    await scenario('conversation-permission-remains-enforced-on-a-direct-tab-link', async f => {
      pendingPreparation(f); addConversation(f);
      const permissions = { id: 'permission', staff_id: ids.S, perm_colis_preparer: true, perm_comm_message_libre: false, perm_comm_telegram: false, perm_comm_email: false, perm_comm_voir_chat_autres: false };
      f.tables.staff_permissions = [permissions]; f.tables.staff_users[0].staff_permissions = permissions;
      await f.login(); await open(f, 'preparation', '&onglet=conversation');
      assert.equal(await tab(f, 'Conversation').count(), 0);
      assert.equal(await f.page.getByRole('log', { name: 'Messages avec le client', exact: true }).count(), 0);
      assert.equal(readMessages(f).length, 0); assert.equal(await preparationField(f).isEnabled(), true);
      assert.deepEqual(businessWrites(f), []);
    }, 'preparateur');

    await scenario('keyboard-tabs-and-stage-browsing-are-navigation-only', async f => {
      pendingPreparation(f); await f.login(); await open(f);
      await tab(f, 'Colis').focus(); await f.page.keyboard.press('ArrowRight');
      await f.page.getByLabel('Votre réponse au client', { exact: true }).waitFor();
      assert.equal(await tab(f, 'Conversation').evaluate(node => node === document.activeElement), true);
      await f.page.keyboard.press('Home');
      assert.equal(await tab(f, 'Colis').evaluate(node => node === document.activeElement), true);
      await openTaskNavigation(f); await f.page.getByLabel('Tâche du dossier', { exact: true }).selectOption('documents');
      await f.page.getByTestId('documents-task').waitFor();
      assert.equal(new URL(f.page.url()).searchParams.has('onglet'), false);
      assert.equal(f.tables.colis[0].statut, 'autorise'); assert.deepEqual(businessWrites(f), []);
    });

    for (const mobile of [false, true]) for (const dark of [false, true]) await scenario(`full-page-tabs-accessible-${mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}`, async f => {
      pendingPreparation(f); await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      await f.context.addInitScript(dark => localStorage.setItem('expedile-theme', dark ? 'dark' : 'light'), dark);
      await f.login(); await open(f); await preparationField(f).waitFor();
      for (const name of ['Colis', 'Conversation']) {
        await tab(f, name).click();
        if (name === 'Conversation' && mobile) {
          const reply = f.page.getByLabel('Votre réponse au client', { exact: true });
          await reply.waitFor();
          const geometry = await reply.evaluate(node => { const field = node.getBoundingClientRect(); const container = node.parentElement.getBoundingClientRect(); const send = node.parentElement.querySelector('button').getBoundingClientRect(); return { width:field.width, height:field.height, containerWidth:container.width, fieldBottom:field.bottom, sendTop:send.top }; });
          assert.ok(geometry.width >= geometry.containerWidth * 0.8, 'On mobile, a long send label cannot squeeze the reply field into a narrow column.');
          assert.ok(geometry.height >= 80, 'The mobile reply provides room for several lines.');
          assert.ok(geometry.sendTop >= geometry.fieldBottom, 'The mobile send action follows the reply field vertically.');
        }
        const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(audit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) })), []);
        assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await f.page.screenshot({ path: `${output}/${name}-${mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
      }
    });
  } finally {
    await browser.close(); await fs.writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
