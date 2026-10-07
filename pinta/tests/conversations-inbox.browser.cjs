/* Conversations inbox: synthetic clients and messages only; every transport intercepted. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_CONVERSATIONS_OUT || '/tmp/pinta-conversations';
const B = '88888888-1111-4111-8111-111111111111';
const FLAVIE = 'cccccccc-1111-4111-8111-111111111111';
const P2 = '73333333-3333-4333-8333-333333333333', P3 = '74444444-4444-4444-8444-444444444444', P4 = '75555555-5555-4555-8555-555555555555';
const results = [];
const log = f => f.page.getByRole('log', { name: 'Messages avec le client', exact: true });
const reply = f => f.page.getByLabel('Votre réponse au client', { exact: true });
const row = (f, text) => f.page.getByRole('button').filter({ hasText: text });
const reads = f => f.requests.filter(request => request.path === '/rest/v1/messages' && request.method === 'PATCH');
const overflow = f => f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const minutesAgo = minutes => new Date(Date.now() - minutes * 60000).toISOString();
// Noon UTC two days ago: the same calendar day in Paris whatever the hour of the run.
const twoDaysAgo = minutes => { const day = new Date(Date.now() - 2 * 86400000); day.setUTCHours(12, minutes, 0, 0); return day.toISOString(); };

function fixture(f, { extra = 0 } = {}) {
  const t = f.tables;
  t.clients[0].user_id = 'client-fixture';
  t.clients.push({ ...t.clients[0], id: FLAVIE, ref: 'CLI-FLAVIE', nom: 'Payet', prenom: 'Flavie', user_id: 'client-flavie', telegram_chat_id: '424242' });
  t.staff_users.push({ id: B, auth_id: B, nom: 'Hoarau', prenom: 'Madly', role: 'directeur', actif: true, staff_permissions: {} });
  const parcel = (id, ref, client, conversation, version, extraFields = {}) => ({ ...t.colis[0], id, ref, client_id: client, conversation_statut: conversation, conversation_version: version, conversation_opened_at: null, conversation_updated_at: minutesAgo(5), ...extraFields });
  Object.assign(t.colis[0], { conversation_statut: 'a_traiter', conversation_version: 3, conversation_opened_at: minutesAgo(60), conversation_updated_at: minutesAgo(1) });
  t.colis.push(
    parcel(P2, 'EXP-TEST-002', FLAVIE, 'a_traiter', 1, { conversation_opened_at: minutesAgo(60 * 24 * 9), statut: 'en_preparation' }),
    parcel(P3, 'EXP-TEST-003', FLAVIE, 'attente_client', 1, { conversation_updated_at: minutesAgo(120), desc_contenu: null }),
    parcel(P4, 'EXP-TEST-004', ids.C, 'termine', 2, { conversation_updated_at: minutesAgo(60 * 30) }),
  );
  for (let index = 0; index < extra; index += 1) t.colis.push(parcel(`76666666-6666-4666-8666-${String(100000000000 + index)}`, `EXP-LIST-${String(index + 1).padStart(2, '0')}`, FLAVIE, 'attente_client', 1, { conversation_updated_at: minutesAgo(200 + index) }));
  const message = (id, colis, type, texte, created_at, fields = {}) => ({ id, colis_id: colis, type, texte, created_at, auteur_nom: type === 'staff' ? 'Camille' : 'Client', auteur_id: type === 'staff' ? ids.A : null, canal: 'portal', lu: type !== 'client', statut: type === 'staff' ? 'envoye' : null, ...fields });
  t.messages = [
    message('m-01', ids.P, 'staff', 'Bonjour Camille 👋\n\nNous attendons votre facture Boutique B pour finaliser le devis.', twoDaysAgo(0), { canal: 'telegram', statut: 'echec' }),
    message('m-02', ids.P, 'staff', 'Une copie vous attend aussi dans votre espace client.', twoDaysAgo(1)),
    message('m-03', ids.P, 'client', 'Voici le suivi : https://www.example.test/suivi/123456?ref=abc', minutesAgo(2)),
    message('m-04', ids.P, 'client', 'Pouvez-vous attendre mon dernier colis ?', minutesAgo(1)),
    message('m-05', P2, 'client', 'Le montant me semble élevé, pouvez-vous vérifier ?', minutesAgo(60 * 24 * 9)),
    message('m-06', P3, 'staff', 'Bonjour Flavie 👋\n\nVotre devis vous attend dans votre espace.', minutesAgo(120), { canal: 'email', statut: 'envoi' }),
    message('m-07', P4, 'client', 'Merci pour le suivi.', minutesAgo(60 * 30), { lu: true }),
  ];
  t.client_inbox = [{ id: 'inbox-1', client_id: FLAVIE, status: 'unassigned', texte: 'Voici la facture du deuxième colis https://www.example.test/facture.pdf', created_at: minutesAgo(12), payload: { document: { file_id: 'fixture', file_name: 'facture.pdf', mime_type: 'application/pdf' } } }];
  t.staff_work_actions = [
    { id: 'conversation-p', colis_id: ids.P, kind: 'conversation', state: 'in_progress', assignee_id: ids.A, version: 1, created_at: minutesAgo(60), updated_at: minutesAgo(60) },
    { id: 'conversation-p2', colis_id: P2, kind: 'conversation', state: 'ready', assignee_id: null, version: 1, created_at: minutesAgo(60), updated_at: minutesAgo(60) },
  ];
}

async function open(f, path, width = 1440, height = 1000) {
  await f.page.setViewportSize({ width, height });
  await f.page.goto(base + path);
  await f.page.getByRole('heading', { name: 'Conversations', exact: true }).waitFor();
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, options) {
    if (process.env.PINTA_CONVERSATIONS_FILTER && !name.includes(process.env.PINTA_CONVERSATIONS_FILTER)) return;
    const f = await setup(browser, 'directeur', options?.setup); f.page.setDefaultTimeout(12000); fixture(f, options);
    try {
      await f.login(); await run(f);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
      if (!options?.sends) assert.equal(f.requests.some(request => /\/(queue_message|send-telegram|send-email)$/.test(request.path)), false, 'Reading, selecting and drafting never send a message.');
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
      await f.page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {});
      await fs.writeFile(`${output}/${name}-failure.txt`, await f.page.locator('body').innerText().catch(() => ''));
    } finally { await f.context.close(); console.log(JSON.stringify(results.at(-1))); }
  }
  try {
    for (const width of [1440, 1024, 1023, 390]) await scenario(`two-panes-from-1024-single-pane-below-${width}`, async f => {
      await open(f, '/conversations', width);
      const wide = width >= 1024;
      assert.equal(await f.page.locator('.conversation-pane').count(), wide ? 1 : 0);
      if (wide) await f.page.getByRole('heading', { name: 'Choisissez une conversation', exact: true }).waitFor();
      assert.equal(reads(f).length, 0, 'An inbox without an open exchange marks nothing read.');
      await row(f, 'Le montant me semble élevé').click();
      if (wide) {
        await f.page.waitForURL(url => url.pathname === '/conversations' && url.searchParams.get('ouvert') === P2);
        await log(f).getByText('Le montant me semble élevé, pouvez-vous vérifier ?', { exact: true }).waitFor();
        assert.equal(await row(f, 'Le montant me semble élevé').getAttribute('aria-current'), 'true');
        await f.page.getByRole('heading', { name: 'Conversations', exact: true }).waitFor();
        assert.equal(await f.page.locator('[role="log"]').count(), 1);
        assert.equal(await f.page.locator('#staff-message-' + P2).count(), 1);
        const pane = await f.page.locator('.conversation-pane').boundingBox(), list = await f.page.locator('.conversation-list').boundingBox();
        assert.ok(list.x + list.width <= pane.x + 1 && list.width >= 399 && list.width <= 431, 'The list and the exchange sit side by side.');
      } else {
        await f.page.waitForURL(url => url.pathname === `/colis/${P2}` && url.searchParams.get('onglet') === 'conversation');
        assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/conversations');
        await reply(f).waitFor();
      }
      assert.equal(await overflow(f), false);
      await f.page.screenshot({ path: `${output}/selected-${width}.png` });
    });

    await scenario('selection-keeps-list-scroll-and-conversations-current', async f => {
      await open(f, '/conversations', 1440, 700);
      const body = f.page.locator('.conversation-list__body');
      await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
      const before = await body.evaluate(node => node.scrollTop);
      assert.ok(before > 200, 'The list scrolls on its own.');
      await row(f, 'EXP-LIST-20').click();
      await f.page.waitForURL(url => url.searchParams.has('ouvert'));
      await log(f).waitFor();
      assert.ok(Math.abs(await body.evaluate(node => node.scrollTop) - before) < 2, 'Opening an exchange keeps the list position.');
      assert.equal(await row(f, 'EXP-LIST-20').getAttribute('aria-current'), 'true');
      assert.equal(await f.page.getByRole('button', { name: 'Conversations', exact: true }).getAttribute('aria-current'), 'page');
      await row(f, 'EXP-LIST-19').click();
      await f.page.waitForURL(url => url.searchParams.get('ouvert')?.endsWith('100000000018'));
      assert.ok(Math.abs(await body.evaluate(node => node.scrollTop) - before) < 2);
    }, { extra: 20 });

    await scenario('deep-link-opens-the-pane-and-legacy-link-opens-the-dossier', async f => {
      await open(f, `/conversations?ouvert=${P2}&state=a_traiter`);
      await f.page.getByRole('heading', { name: 'Flavie Payet EXP-TEST-002', exact: true }).waitFor();
      assert.equal(await f.page.getByRole('button', { name: 'À répondre 2', exact: true }).getAttribute('aria-pressed'), 'true');
      const dossierLink = f.page.getByRole('link', { name: 'Ouvrir le dossier', exact: true });
      const target = new URL(await dossierLink.getAttribute('href'), base);
      assert.equal(target.pathname, `/colis/${P2}`); assert.equal(target.searchParams.get('onglet'), 'conversation');
      assert.equal(target.searchParams.get('returnTo'), `/conversations?ouvert=${P2}&state=a_traiter`);
      // « Détails du dossier » opens the same context panel as the dossier page, for this dossier.
      const details = f.page.getByRole('button', { name: 'Détails du dossier', exact: true });
      await details.click();
      const context = f.page.getByRole('dialog', { name: 'Contexte du dossier', exact: true });
      await context.getByText('EXP-TEST-002', { exact: true }).waitFor();
      await context.getByRole('button', { name: 'Fermer le contexte du dossier', exact: true }).click();
      await context.waitFor({ state: 'hidden' });
      assert.equal(await details.evaluate(node => node === document.activeElement), true);
      await f.page.goto(`${base}/conversations?dossier=${ids.P}&state=a_traiter`);
      await f.page.waitForURL(url => url.pathname === `/colis/${ids.P}`);
      const legacy = new URL(f.page.url());
      assert.equal(legacy.searchParams.get('onglet'), 'conversation');
      assert.equal(legacy.searchParams.get('returnTo'), '/conversations?state=a_traiter');
      await f.page.getByRole('tab', { name: /^Conversation/ }).waitFor();
      assert.equal(await f.page.getByRole('tab', { name: /^Conversation/ }).getAttribute('aria-selected'), 'true');
      // Below 1024px the pane parameter behaves like the legacy link, without a return loop.
      await f.page.setViewportSize({ width: 390, height: 844 });
      await f.page.goto(`${base}/conversations?ouvert=${P2}&q=Flavie`);
      await f.page.waitForURL(url => url.pathname === `/colis/${P2}`);
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/conversations?q=Flavie');
    });

    await scenario('one-draft-shared-by-the-pane-and-the-dossier-tab', async f => {
      await open(f, `/conversations?ouvert=${ids.P}`);
      await reply(f).fill('Brouillon commun au dossier');
      await f.page.getByRole('link', { name: 'Ouvrir le dossier', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === `/colis/${ids.P}` && url.searchParams.get('onglet') === 'conversation');
      assert.equal(await reply(f).inputValue(), 'Brouillon commun au dossier');
      await reply(f).fill('Brouillon commun au dossier, complété');
      await f.page.getByRole('button', { name: 'Retour à la liste de travail', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === '/conversations' && url.searchParams.get('ouvert') === ids.P);
      assert.equal(await reply(f).inputValue(), 'Brouillon commun au dossier, complété');
      assert.equal(await f.page.locator('textarea[id^="staff-message-"]').count(), 1);
    });

    await scenario('only-the-open-conversation-is-marked-read', async f => {
      await open(f, `/conversations?ouvert=${P2}`);
      await f.page.waitForFunction(id => !document.querySelector(`#conversation-client .chat-unread`) && document.querySelector('#staff-message-' + id), P2);
      await f.page.waitForFunction(() => document.querySelectorAll('.conversation-row[data-unread]:not([data-inbox])').length === 1);
      assert.equal(f.tables.messages.find(item => item.id === 'm-05').lu, true);
      assert.deepEqual(f.tables.messages.filter(item => item.colis_id === ids.P && item.type === 'client').map(item => item.lu), [false, false], 'A conversation shown only in the list stays unread.');
      await row(f, 'Pouvez-vous attendre mon dernier colis').getByText('2 messages non lus').waitFor({ state: 'attached' });
      const before = reads(f).length;
      await f.page.setViewportSize({ width: 1440, height: 1000 });
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await f.page.waitForTimeout(300);
      assert.equal(reads(f).length, before, 'Refreshing never reads another conversation.');
    });

    await scenario('marquer-comme-traite-sends-the-expected-version', async f => {
      const commands = [];
      await f.context.route('**/rest/v1/rpc/set_conversation_state', async route => {
        const input = route.request().postDataJSON(); commands.push(input);
        const parcel = f.tables.colis.find(item => item.id === input.p_colis_id);
        if (parcel.conversation_version !== input.p_expected_version) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '40001', message: 'La conversation a changé.' }) });
        Object.assign(parcel, { conversation_statut: input.p_state, conversation_version: parcel.conversation_version + 1, updated_at: new Date().toISOString() });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(parcel) });
      });
      await open(f, `/conversations?ouvert=${ids.P}`);
      const status = f.page.locator('#conversation-client .chat-status');
      await status.getByText('À répondre', { exact: true }).waitFor();
      await f.page.getByRole('button', { name: 'Marquer comme traité', exact: true }).click();
      await status.getByText('Traitée', { exact: true }).waitFor();
      assert.deepEqual(commands, [{ p_colis_id: ids.P, p_state: 'termine', p_expected_version: 3 }]);
      await f.page.getByRole('button', { name: 'À répondre', exact: true }).waitFor();
      assert.equal(await f.page.getByRole('button', { name: 'Marquer comme traité', exact: true }).count(), 0);
      // The exchange stays open while the list files it under « Traitées ».
      assert.equal(new URL(f.page.url()).searchParams.get('ouvert'), ids.P);
      await f.page.getByRole('button', { name: /^Traitées · 2$/ }).waitFor();
    });

    // A narrow thread (the pane beside the list at 1024, or a phone) keeps the close
    // command, even when it is not the primary one: « Attente client », or a task still to take.
    for (const [label, id] of [['attente-client', P3], ['task-to-take', P2]]) await scenario(`marquer-comme-traite-stays-reachable-in-narrow-threads-${label}`, async f => {
      const commands = [];
      await f.context.route('**/rest/v1/rpc/set_conversation_state', async route => {
        const input = route.request().postDataJSON(); commands.push(input);
        const parcel = f.tables.colis.find(item => item.id === input.p_colis_id);
        Object.assign(parcel, { conversation_statut: input.p_state, conversation_version: parcel.conversation_version + 1, updated_at: new Date().toISOString() });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(parcel) });
      });
      await open(f, `/conversations?ouvert=${id}`, 1024, 900);
      const paneClose = f.page.locator('#conversation-client').getByRole('button', { name: 'Marquer comme traité', exact: true });
      await paneClose.waitFor();
      assert.ok(await paneClose.isVisible(), 'Visible in the pane beside the list');
      await f.page.setViewportSize({ width: 390, height: 844 });
      await f.page.goto(base + `/colis/${id}?onglet=conversation`);
      const phoneClose = f.page.locator('#conversation-client').getByRole('button', { name: 'Marquer comme traité', exact: true });
      await phoneClose.waitFor();
      assert.ok((await phoneClose.boundingBox()).height >= 44, 'A 44px target on a phone');
      await phoneClose.click();
      await f.page.locator('#conversation-client .chat-status').getByText('Traitée', { exact: true }).waitFor();
      assert.deepEqual(commands.map(command => [command.p_colis_id, command.p_state]), [[id, 'termine']]);
    });

    await scenario('state-segments-stay-inside-their-track-with-large-counts', async f => {
      for (const width of [1440, 1024]) {
        await open(f, '/conversations', width, 900);
        await f.page.getByRole('button', { name: /^Attente client\s*121$/ }).waitFor();
        const inside = await f.page.locator('.conversation-segments').evaluate(track => {
          const box = track.getBoundingClientRect();
          return [...track.children].every(button => { const rect = button.getBoundingClientRect(); return rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.bottom <= box.bottom + 1; });
        });
        assert.equal(inside, true, `${width}px: three-digit counts stay inside the segmented control`);
      }
    }, { extra: 120 });

    await scenario('owner-filter-and-segment-counts-match-the-badge', async f => {
      await open(f, '/conversations');
      const badge = Number((await f.page.getByRole('button', { name: 'Conversations', exact: true }).getAttribute('aria-description')).match(/^\d+/)[0]);
      const count = async label => Number((await f.page.getByRole('button', { name: new RegExp(`^${label} \\d+$`) }).textContent()).match(/\d+$/)[0]);
      assert.equal(await count('À répondre') + await f.page.getByRole('region', { name: 'Messages sans dossier', exact: true }).getByRole('listitem').count(), badge);
      assert.equal(await count('À répondre'), 2); assert.equal(await count('Attente client'), 1);
      const filters = f.page.getByRole('button', { name: 'Filtres', exact: true });
      await filters.click();
      const dialog = f.page.getByRole('dialog', { name: 'Filtres', exact: true });
      await dialog.getByLabel('Responsable', { exact: true }).selectOption('me');
      await f.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await f.page.getByRole('button', { name: 'Filtres · 1', exact: true }).evaluate(node => node === document.activeElement), true, 'Closing the filters returns to their button.');
      assert.equal(new URL(f.page.url()).searchParams.get('owner'), 'me');
      await row(f, 'EXP-TEST-001').waitFor();
      assert.equal(await row(f, 'EXP-TEST-002').count(), 0);
      assert.equal(await f.page.getByRole('region', { name: 'Messages sans dossier', exact: true }).count(), 0);
      assert.equal(await count('À répondre'), 1);
      await f.page.getByRole('button', { name: 'Filtres · 1', exact: true }).click();
      await dialog.getByLabel('Responsable', { exact: true }).selectOption('unassigned');
      await dialog.getByRole('button', { name: 'Fermer les filtres', exact: true }).click();
      await row(f, 'EXP-TEST-002').waitFor();
      assert.equal(await row(f, 'EXP-TEST-001').count(), 0);
      // A closed exchange without a task is « Traitée », never « Non attribué ».
      assert.equal(await row(f, 'EXP-TEST-004').count(), 0);
      await f.page.getByRole('button', { name: 'Traitées', exact: true }).click();
      await f.page.getByText('Aucune conversation dans ces filtres.', { exact: true }).waitFor();
      await f.page.getByRole('button', { name: 'Retirer les filtres', exact: true }).click();
      await row(f, 'EXP-TEST-001').waitFor();
      assert.equal(new URL(f.page.url()).searchParams.has('owner'), false);
    });

    await scenario('inbox-message-is-assigned-in-the-pane-then-its-conversation-opens', async f => {
      const assignments = [];
      await f.context.route('**/functions/v1/telegram-inbox-assign', async route => {
        const input = route.request().postDataJSON(); assignments.push(input);
        const item = f.tables.client_inbox.find(entry => entry.id === input.inboxId); item.status = 'assigned';
        f.tables.messages.push({ id: 'assigned-message', colis_id: input.colisId, type: 'client', texte: item.texte, lu: false, created_at: new Date().toISOString() });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      });
      await open(f, '/conversations');
      await row(f, 'Voici la facture du deuxième colis').click();
      await f.page.waitForURL(url => url.searchParams.get('inbox') === 'inbox-1');
      const form = f.page.getByRole('region', { name: 'Message à rattacher', exact: true });
      await form.getByText('Voici la facture du deuxième colis https://www.example.test/facture.pdf', { exact: true }).waitFor();
      await form.getByRole('button', { name: 'Voir le document avant de le rattacher', exact: true }).waitFor();
      const options = await form.getByLabel('Dossier du client', { exact: true }).locator('option').allTextContents();
      assert.ok(options.some(option => option.startsWith('EXP-TEST-002 · ')), JSON.stringify(options));
      assert.ok(options.some(option => option.startsWith('EXP-TEST-003 · En cours de préparation · ')), JSON.stringify(options));
      assert.equal(options.some(option => /\b(en_preparation|attente_feu_vert|receptionne)\b/.test(option)), false, 'Dossier options never show a raw status code.');
      await f.page.getByRole('heading', { name: 'Conversations', exact: true }).waitFor();
      await form.getByLabel('Dossier du client', { exact: true }).selectOption(P2);
      await form.getByRole('button', { name: 'Rattacher au dossier', exact: true }).click();
      await f.page.getByRole('dialog').getByRole('button', { name: 'Rattacher', exact: true }).click();
      await f.page.waitForURL(url => url.searchParams.get('ouvert') === P2 && !url.searchParams.has('inbox'));
      await f.page.locator('#staff-message-' + P2).waitFor();
      await log(f).getByText('Voici la facture du deuxième colis', { exact: false }).waitFor();
      assert.deepEqual(assignments, [{ inboxId: 'inbox-1', colisId: P2 }]);
      assert.equal(await f.page.getByRole('region', { name: 'Messages sans dossier', exact: true }).count(), 0);
    });

    await scenario('failed-telegram-message-offers-a-verified-retry', async f => {
      await open(f, `/conversations?ouvert=${ids.P}`);
      const failed = log(f).locator('.chat-bubble').filter({ hasText: 'Nous attendons votre facture Boutique B' });
      await failed.getByText('Envoi non confirmé', { exact: true }).waitFor();
      await failed.getByRole('button', { name: 'Vérifier et réessayer', exact: true }).click();
      const confirm = f.page.getByRole('dialog');
      await confirm.getByText('Vérifiez dans Telegram que le client n’a pas reçu ce message, puis confirmez le renvoi.', { exact: true }).waitFor();
      await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
      assert.equal(f.requests.some(request => request.path.endsWith('/send-telegram')), false, 'No retry without the explicit confirmation.');
      assert.equal(await log(f).getByRole('button', { name: 'Vérifier et réessayer', exact: true }).count(), 1, 'Only the failed Telegram message offers a retry.');
      // An e-mail is never presented as delivered: it remains a manual draft.
      await row(f, 'EXP-TEST-003').click();
      await log(f).getByText('Brouillon manuel', { exact: true }).waitFor();
      assert.equal(await log(f).getByText('En attente de livraison', { exact: true }).count(), 0);
    });

    await scenario('thread-groups-days-and-authors-without-read-buttons', async f => {
      await open(f, `/conversations?ouvert=${ids.P}`);
      await log(f).getByText('Pouvez-vous attendre mon dernier colis ?', { exact: true }).waitFor();
      const days = await log(f).locator('.chat-day').allTextContents();
      assert.equal(days.length, 2); assert.equal(days[1], 'Aujourd’hui'); assert.match(days[0], /^[A-Z][a-zé]+ \d{1,2} [a-zéû]+( \d{4})?$/);
      assert.deepEqual(await log(f).locator('.chat-author').allTextContents(), ['Camille', 'Camille Exemple'], 'The author appears once per group.');
      assert.equal(await log(f).getByRole('button', { name: /^(Lu|Non lu)$|comme (non )?lu$/ }).count(), 0, 'No read toggle beside each message.');
      const link = log(f).getByRole('link', { name: 'example.test/suivi/123456', exact: true });
      assert.equal(await link.getAttribute('href'), 'https://www.example.test/suivi/123456?ref=abc');
      const bubble = await log(f).locator('.chat-bubble').first().boundingBox(), area = await log(f).boundingBox();
      assert.ok(bubble.width <= Math.min(620, area.width * 0.8) + 1, 'Bubbles keep a readable width.');
      // « Marquer comme non lu » marks the latest client message, then the list shows it.
      await f.page.getByRole('button', { name: 'Autres actions sur la conversation', exact: true }).click();
      await f.page.getByText('La demande reste à traiter, même après lecture. Les relances automatiques de ce client sont suspendues.', { exact: true }).waitFor();
      await f.page.getByRole('button', { name: 'Marquer comme non lu', exact: true }).click();
      await f.page.waitForFunction(() => document.querySelectorAll('#conversation-client .chat-unread').length === 1);
      assert.equal(f.tables.messages.find(item => item.id === 'm-04').lu, false);
      assert.equal(f.tables.messages.find(item => item.id === 'm-03').lu, true);
      await row(f, 'Pouvez-vous attendre mon dernier colis').getByText('1 message non lu').waitFor({ state: 'attached' });
      assert.equal(await f.page.getByRole('button', { name: 'Autres actions sur la conversation', exact: true }).evaluate(node => node === document.activeElement), true);
    });

    for (const [width, height] of [[1440, 1000], [390, 844]]) for (const dark of [false, true]) await scenario(`axe-${width}-${dark ? 'dark' : 'light'}`, async f => {
      await f.context.addInitScript(theme => localStorage.setItem('expedile-theme', theme), dark ? 'dark' : 'light');
      await open(f, width >= 1024 ? `/conversations?ouvert=${ids.P}` : '/conversations', width, height);
      if (width >= 1024) await reply(f).fill('Brouillon pour la vérification');
      const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) })), []);
      await f.page.screenshot({ path: `${output}/conversations-${width}-${dark ? 'dark' : 'light'}.png` });
      if (width >= 1024) {
        await f.page.getByRole('button', { name: 'Autres actions sur la conversation', exact: true }).click();
        const menu = await new AxeBuilder({ page: f.page }).include('#conversation-client').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(menu.violations.map(issue => issue.id), []);
        await f.page.keyboard.press('Escape');
      } else {
        await row(f, 'Pouvez-vous attendre mon dernier colis').click();
        await reply(f).waitFor();
        const thread = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(thread.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), []);
        await f.page.screenshot({ path: `${output}/conversation-tab-${width}-${dark ? 'dark' : 'light'}.png` });
      }
    });

    await scenario('no-page-overflow-from-320-to-1920', async f => {
      for (const width of [320, 390, 768, 1023, 1024, 1280, 1440, 1920]) {
        await open(f, '/conversations', width, 900);
        assert.equal(await overflow(f), false, `List at ${width}px`);
        await f.page.goto(`${base}/conversations?ouvert=${ids.P}`);
        await reply(f).waitFor();
        assert.equal(await overflow(f), false, `Exchange at ${width}px`);
        const send = await f.page.getByRole('button', { name: 'Envoyer le message', exact: true }).boundingBox();
        assert.ok(send.x >= 0 && send.x + send.width <= width + 1, `Send button inside the screen at ${width}px`);
      }
    });

    // ── Final review: desktop rows, compact segments, safe links, decisions, keyboard ──
    for (const [width, dark] of [[1280, false], [1280, true], [1366, false], [1440, false], [1440, true]]) await scenario(`the-list-keeps-its-computer-rows-and-one-row-of-segments-${width}-${dark ? 'dark' : 'light'}`, async f => {
      await f.context.addInitScript(theme => localStorage.setItem('expedile-theme', theme), dark ? 'dark' : 'light');
      await open(f, '/conversations', width, 800);
      const list = await f.page.locator('.conversation-list').evaluate(node => ({ content: node.clientWidth, title: getComputedStyle(node.querySelector('.conversation-row__title')).flexDirection, since: getComputedStyle(node.querySelector('.conversation-row__since')).position, segments: node.querySelector('.conversation-segments').getBoundingClientRect().height }));
      assert.ok(list.content >= 400, `${width}px: a 400px list keeps its computer rows (${list.content}px)`);
      assert.equal(list.title, 'row', 'Name and reference share one line');
      assert.notEqual(list.since, 'absolute', '« depuis » stays readable');
      assert.ok(list.segments <= 52, `${width}px: the four segments hold on one row (${list.segments}px)`);
      const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), []);
      await f.page.screenshot({ path: `${output}/list-${width}-${dark ? 'dark' : 'light'}.png` });
    });

    for (const width of [1440, 390]) await scenario(`a-message-without-dossier-links-safely-and-its-confirmation-keeps-references-whole-${width}`, async f => {
      await open(f, '/conversations', width, 900);
      await row(f, 'Voici la facture du deuxième colis').click();
      const form = f.page.getByRole('region', { name: 'Message à rattacher', exact: true });
      const link = form.getByRole('link', { name: 'https://www.example.test/facture.pdf', exact: true });
      assert.equal(await link.getAttribute('href'), 'https://www.example.test/facture.pdf');
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.deepEqual((await link.getAttribute('rel')).split(/\s+/).sort(), ['noopener', 'noreferrer']);
      // The reception dates read like the dossier list (formatDossierTableDate), the counts in French.
      const options = await form.getByLabel('Dossier du client', { exact: true }).locator('option').allTextContents();
      assert.ok(options.includes('EXP-TEST-003 · En cours de préparation · 2 cartons · reçu le 08/09/2026'), JSON.stringify(options));
      assert.equal(options.some(option => option.includes('(s)')), false);
      await form.getByLabel('Dossier du client', { exact: true }).selectOption(P2);
      await form.getByRole('button', { name: 'Rattacher au dossier', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Rattacher ce message ?', exact: true });
      const reference = dialog.getByText('EXP-TEST-002', { exact: true });
      assert.equal(await reference.evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap');
      assert.equal(await reference.evaluate(node => node.getClientRects().length), 1, 'The reference stays on one line');
      const confirm = dialog.getByRole('button', { name: 'Rattacher', exact: true });
      assert.ok((await confirm.boundingBox()).height <= 48, 'The confirmation label holds on one line');
      await f.page.screenshot({ path: `${output}/inbox-confirm-${width}.png` });
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
      assert.equal(f.requests.some(request => request.path.endsWith('/telegram-inbox-assign')), false);
    });

    await scenario('the-folded-traitees-section-names-an-existing-list', async f => {
      await open(f, '/conversations');
      const toggle = f.page.getByRole('button', { name: /^Traitées · 1$/ });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      const target = f.page.locator(`#${await toggle.getAttribute('aria-controls')}`);
      assert.equal(await target.count(), 1, 'aria-controls names an element while folded');
      assert.equal(await target.isHidden(), true);
      assert.equal(await target.locator('li').count(), 0, 'A folded list renders no row');
      await toggle.click();
      await target.locator('li').first().waitFor();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    });

    await scenario('a-decision-recorded-by-the-team-is-signed-by-the-team-member', async f => {
      f.tables.messages.push(
        { id: 'm-08', colis_id: P3, type: 'client', template: 'client_decision_wait', texte: 'Attente volontaire enregistrée. Les relances sont suspendues.', created_at: minutesAgo(90), auteur_nom: 'Madly', auteur_id: B, canal: 'portal', lu: true },
        { id: 'm-09', colis_id: P3, type: 'client', template: 'client_decision_approve', texte: 'Accord de préparation enregistré pour ce dossier et ses cartons actuels.', created_at: minutesAgo(80), auteur_nom: 'Payet Flavie', auteur_id: 'client-flavie', canal: 'portal', lu: true },
      );
      await open(f, `/conversations?ouvert=${P3}`);
      const recorded = log(f).locator('.chat-message').filter({ hasText: 'Attente volontaire enregistrée' });
      assert.equal(await recorded.getAttribute('data-from'), 'staff', 'Recorded by the team: on the team’s side');
      const authors = await log(f).locator('.chat-author').allTextContents();
      assert.deepEqual(authors.slice(-2), ['Madly', 'Flavie Payet'], 'The team member, then the client for the client’s own decision');
      await f.page.screenshot({ path: `${output}/decision-recorded-by-team-1440.png` });
    });

    await scenario('a-keyboard-and-a-mouse-keep-the-ctrl-entree-hint', async f => {
      await open(f, `/conversations?ouvert=${ids.P}`, 1440, 900);
      assert.equal(await f.page.getByText('Ctrl + Entrée pour envoyer', { exact: true }).isVisible(), true);
    });
    await scenario('a-touch-screen-has-no-ctrl-entree-hint', async f => {
      await f.page.setViewportSize({ width: 768, height: 1024 });
      await f.page.goto(`${base}/colis/${ids.P}?onglet=conversation`);
      await reply(f).waitFor();
      // The tablet thread is wide enough for the help line: only the shortcut leaves it.
      assert.equal(await f.page.locator('.chat-composer__help').isVisible(), true);
      assert.equal(await f.page.locator('.chat-composer__shortcut').isVisible(), false, 'There is no Ctrl key to press on a touch screen');
    }, { setup: { device: { hasTouch: true, isMobile: true } } });

    for (const dark of [false, true]) await scenario(`a-phone-keyboard-keeps-envoyer-in-view-${dark ? 'dark' : 'light'}`, async f => {
      await f.context.addInitScript(theme => localStorage.setItem('expedile-theme', theme), dark ? 'dark' : 'light');
      await f.page.setViewportSize({ width: 390, height: 844 });
      await f.page.goto(`${base}/colis/${P2}?onglet=conversation&returnTo=%2Fconversations`);
      await reply(f).waitFor();
      await reply(f).focus();
      // The keyboard opens: the visible height falls to 500px and the field is brought into view.
      await f.page.setViewportSize({ width: 390, height: 500 });
      await reply(f).evaluate(node => node.scrollIntoView({ block: 'nearest' }));
      await f.page.locator('[data-staff-bottom-nav]').waitFor({ state: 'hidden' });
      await reply(f).fill('Bonjour Flavie, nous avons bien reçu votre deuxième colis.');
      const send = await f.page.getByRole('button', { name: 'Envoyer le message', exact: true }).boundingBox();
      const field = await reply(f).boundingBox();
      assert.ok(field.y >= 0 && send.y + send.height <= 500, `« Envoyer » is in view with the keyboard: ${JSON.stringify({ field, send })}`);
      await f.page.waitForFunction(() => getComputedStyle(document.querySelector('main')).paddingBottom === '0px', null, { timeout: 2000 }).catch(() => {});
      assert.equal(await f.page.locator('main').evaluate(node => getComputedStyle(node).paddingBottom), '0px', 'No space kept for the hidden bar');
      const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), []);
      await f.page.screenshot({ path: `${output}/keyboard-390x500-${dark ? 'dark' : 'light'}.png` });
      // Leaving the field alone never brings the bar back under the finger:
      // it returns when the keyboard closes (the visible height grows back).
      await reply(f).evaluate(node => node.blur());
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await f.page.locator('[data-staff-bottom-nav]').isVisible(), false, 'Still hidden while the keyboard is open.');
      await f.page.setViewportSize({ width: 390, height: 844 });
      await f.page.locator('[data-staff-bottom-nav]').waitFor();
    });

    // A real finger on « Envoyer » while the keyboard is open: the first tap sends.
    // The bar must not come back between the press and the release (it would take the release).
    for (const dark of [false, true]) await scenario(`the-first-tap-on-envoyer-with-the-keyboard-open-sends-${dark ? 'dark' : 'light'}`, async f => {
      await f.context.addInitScript(theme => localStorage.setItem('expedile-theme', theme), dark ? 'dark' : 'light');
      await f.page.setViewportSize({ width: 390, height: 844 });
      await f.page.goto(`${base}/colis/${ids.P}?onglet=conversation&returnTo=%2Fconversations`);
      await reply(f).waitFor();
      await reply(f).focus();
      await f.page.setViewportSize({ width: 390, height: 500 });
      await reply(f).evaluate(node => node.scrollIntoView({ block: 'nearest' }));
      await f.page.locator('[data-staff-bottom-nav]').waitFor({ state: 'hidden' });
      await reply(f).fill('Bonjour Camille, votre deuxième carton est bien arrivé.');
      const send = f.page.getByRole('button', { name: 'Envoyer le message', exact: true });
      const box = await send.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 500, `« Envoyer » is in view: ${JSON.stringify(box)}`);
      const queued = () => f.requests.filter(request => request.path === '/rest/v1/rpc/queue_message').length;
      // Where a finger lands, without any automatic scroll first.
      await f.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await log(f).getByText('Bonjour Camille, votre deuxième carton est bien arrivé.', { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(queued(), 1, 'One tap, one message: the first tap is never lost.');
      await f.page.screenshot({ path: `${output}/first-tap-send-390x500-${dark ? 'dark' : 'light'}.png` });
    }, { sends: true, setup: { device: { hasTouch: true, isMobile: true } } });

    // A real reply (greeting, context, signature: seven lines) typed with the keyboard
    // open: « Envoyer », under the growing field, stays in view and takes the tap.
    for (const [width, height, keyboard, dark] of [[390, 844, 500, false], [390, 844, 500, true], [320, 640, 360, false]]) await scenario(`a-long-reply-keeps-envoyer-in-view-${width}-${dark ? 'dark' : 'light'}`, async f => {
      await f.context.addInitScript(theme => localStorage.setItem('expedile-theme', theme), dark ? 'dark' : 'light');
      await f.page.setViewportSize({ width, height });
      await f.page.goto(`${base}/colis/${ids.P}?onglet=conversation&returnTo=%2Fconversations`);
      await reply(f).waitFor();
      await reply(f).focus();
      await f.page.setViewportSize({ width, height: keyboard });
      await reply(f).evaluate(node => node.scrollIntoView({ block: 'nearest' }));
      const lines = ['Bonjour Camille,', 'Nous avons bien reçu votre deuxième colis.', 'Il sera regroupé avec le premier.', 'Le devis suivra dès la mesure.', 'Vous serez notifiée.', 'Belle journée,', 'L’équipe Expedîle'];
      for (const [index, line] of lines.entries()) { await f.page.keyboard.type(line); if (index < lines.length - 1) await f.page.keyboard.press('Shift+Enter'); }
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await f.page.evaluate(() => {
        const send = document.querySelector('button[aria-label="Envoyer le message"]'), box = send.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { send: [Math.round(box.top), Math.round(box.bottom)], reachable: send.contains(hit), focused: document.activeElement?.getAttribute('aria-label') || document.activeElement?.id };
      });
      assert.ok(state.send[0] >= 0 && state.send[1] <= keyboard, `« Envoyer » stays above the keyboard: ${JSON.stringify(state)}`);
      assert.equal(state.reachable, true, 'Nothing covers « Envoyer ».');
      assert.equal(await reply(f).inputValue(), lines.join('\n'), 'The whole reply is kept.');
      await f.page.screenshot({ path: `${output}/long-reply-${width}x${keyboard}-${dark ? 'dark' : 'light'}.png` });
      const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), []);
    });

    // The dossiers and their messages could not be read: an error with its reason
    // and « Réessayer », never « Aucune conversation » nor a count of 0, said once.
    for (const [width, dark] of [[1440, false], [1440, true], [390, false], [390, true]]) await scenario(`a-failed-load-is-an-error-never-an-empty-inbox-${width}-${dark ? 'dark' : 'light'}`, async f => {
      await f.context.addInitScript(theme => localStorage.setItem('expedile-theme', theme), dark ? 'dark' : 'light');
      await open(f, '/conversations', width, width === 390 ? 844 : 1000);
      const failure = f.page.getByRole('alert').filter({ has: f.page.getByRole('heading', { name: 'Les conversations n’ont pas pu être chargées', exact: true }) });
      await failure.waitFor();
      await failure.getByText('Chargement impossible : Indisponibilité simulée', { exact: false }).waitFor();
      assert.equal(await f.page.getByRole('alert').filter({ hasText: 'Indisponibilité simulée' }).count(), 1, 'One message: the shell banner steps aside for the page’s own.');
      assert.equal(await f.page.getByText('Aucune conversation pour le moment.', { exact: true }).count(), 0);
      assert.equal(await f.page.getByRole('group', { name: 'Traitement des conversations', exact: true }).count(), 0, 'No count of conversations that could not be read.');
      assert.equal(await f.page.getByRole('heading', { name: 'Choisissez une conversation', exact: true }).count(), 0);
      const retry = failure.getByRole('button', { name: 'Réessayer', exact: true });
      const box = await retry.boundingBox(); assert.ok(box.height >= 44);
      const frame = await failure.boundingBox(), list = await f.page.locator('.conversation-list').boundingBox();
      assert.ok(frame.x >= list.x + 15.5 && frame.x + frame.width <= list.x + list.width - 15.5, `The message keeps the list's side margins (${JSON.stringify({ frame, list })}).`);
      assert.equal(await overflow(f), false);
      const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), []);
      await f.page.screenshot({ path: `${output}/load-failed-${width}-${dark ? 'dark' : 'light'}.png` });
    }, { setup: { failTable: 'colis' } });

    await scenario('short-phone-keeps-the-composer-reachable', async f => {
      await open(f, '/conversations', 390, 568);
      await row(f, 'Pouvez-vous attendre mon dernier colis').click();
      await reply(f).waitFor();
      await reply(f).fill('Réponse préparée sur un petit écran.');
      const send = f.page.getByRole('button', { name: 'Envoyer le message', exact: true });
      // While the field has the focus on a short phone the navigation steps aside.
      await f.page.locator('[data-staff-bottom-nav]').waitFor({ state: 'hidden' });
      await send.scrollIntoViewIfNeeded();
      const typing = await send.boundingBox();
      assert.ok(typing.y >= 48 && typing.y + typing.height <= 568, `The send button is reachable while typing: ${JSON.stringify(typing)}`);
      // Moving the focus to « Envoyer » keeps the bar aside while the keyboard is
      // open (it would come back under the finger); closing the keyboard brings it back.
      await send.focus();
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await f.page.locator('[data-staff-bottom-nav]').isVisible(), false, 'The focus leaving the field never brings the bar back by itself.');
      await f.page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await f.page.locator('[data-staff-bottom-nav]').waitFor();
      await send.scrollIntoViewIfNeeded();
      const action = await send.boundingBox(), nav = await f.page.getByRole('button', { name: 'Dossiers', exact: true }).locator('..').boundingBox();
      assert.ok(action.y >= 48 && action.y + action.height <= nav.y, `The send button is reachable above the navigation: ${JSON.stringify({ action, nav })}`);
      assert.equal(await send.isEnabled(), true);
      assert.equal(await overflow(f), false);
      await f.page.screenshot({ path: `${output}/short-phone-390x568.png` });
    });
  } finally {
    await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
