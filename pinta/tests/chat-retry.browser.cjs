/* Stable retry identity on synthetic messages only, including a lost response. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const out = process.env.PINTA_CHAT_RETRY_OUT || '/tmp/pinta-chat-retry';
const results = [];
const answer = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const navigate = (page, to) => page.evaluate(url => { window.history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }, to);
(async () => {
  await fs.mkdir(out, { recursive: true }); const browser = await chromium.launch();
  const run = async (role, name, action) => {
    const f = await setup(browser, role); f.page.setDefaultTimeout(10000);
    try { await action(f); assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.stack }); await f.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); }
    finally { await f.context.close(); }
  };
  await run('directeur', 'staff-lost-response-reload-reuses-message-and-next-send-is-new', async f => {
    f.tables.clients[0].user_id = 'client-fixture'; f.tables.colis[0].conversation_statut = 'a_traiter';
    const attempts = [], stored = new Map(); let lose = true;
    await f.context.route('**/rest/v1/rpc/queue_message', async route => {
      const input = route.request().postDataJSON(); attempts.push(input);
      if (!stored.has(input.p_idempotency_key)) {
        const message = { id: crypto.randomUUID(), colis_id: input.p_colis_id, texte: input.p_text, type: 'staff', auteur_nom: 'Équipe fictive', statut: 'envoye', canal: input.p_canal, created_at: new Date().toISOString() };
        f.tables.messages.push(message); stored.set(input.p_idempotency_key, { message, outbox: { id: crypto.randomUUID() } });
      }
      if (lose) { lose = false; return answer(route, { message: 'Confirmation perdue après enregistrement fictif.' }, 503); }
      return answer(route, stored.get(input.p_idempotency_key));
    });
    // The exchange open beside the list (1440px): the reload keeps it open with its draft.
    await f.login(); await f.page.goto(`${base}/conversations?ouvert=${ids.P}`);
    const input = f.page.getByLabel('Votre réponse au client', { exact: true }); await input.fill('Réponse stable\nÀ conserver');
    await input.press('Control+Enter'); await f.page.locator('p[role="alert"]').filter({ hasText: 'Confirmation perdue' }).waitFor();
    assert.equal(f.tables.messages.filter(message => message.type === 'staff').length, 1);
    await f.page.reload(); await input.waitFor(); assert.equal(await input.inputValue(), 'Réponse stable\nÀ conserver');
    await f.page.getByText(/Une tentative d’envoi existe/).waitFor(); await input.press('Control+Enter');
    await f.page.getByText('Message enregistré. Son état d’envoi apparaît dans la conversation.', { exact: true }).waitFor();
    assert.deepEqual(attempts[1], attempts[0]); assert.equal(stored.size, 1); assert.equal(await input.inputValue(), '');
    await input.fill('Réponse stable\nÀ conserver'); await input.press('Control+Enter');
    await f.page.waitForFunction(() => document.querySelector('textarea[id^="staff-message-"]')?.value === '');
    assert.equal(attempts.length, 3); assert.notEqual(attempts[2].p_idempotency_key, attempts[0].p_idempotency_key); assert.equal(stored.size, 2);
  });
  await run('client', 'client-lost-insert-response-reuses-primary-key-after-reload', async f => {
    const attempts = []; let lose = true;
    await f.context.route('**/rest/v1/messages*', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      const input = route.request().postDataJSON(); attempts.push(input);
      if (f.tables.messages.some(message => message.id === input.id)) return answer(route, { code: '23505', message: 'Identifiant déjà enregistré.' }, 409);
      f.tables.messages.push({ ...input, created_at: new Date().toISOString() });
      if (lose) { lose = false; return answer(route, { message: 'Confirmation client perdue.' }, 503); }
      return answer(route, null, 201);
    });
    await f.login(); await f.page.goto(`${base}/colis/${ids.P}?panel=messages`);
    const input = f.page.getByLabel('Votre message à l’équipe', { exact: true }); await input.fill('Mon adresse complète\nBâtiment B'); await input.press('Control+Enter');
    await f.page.locator('p[role="alert"]').filter({ hasText: 'Confirmation client perdue.' }).waitFor();
    await f.page.reload(); await input.waitFor(); assert.equal(await input.inputValue(), 'Mon adresse complète\nBâtiment B'); await input.press('Control+Enter');
    await f.page.getByText('Message envoyé à l’équipe : nous vous répondons ici.', { exact: true }).waitFor();
    assert.equal(attempts.length, 2); assert.deepEqual(attempts[1], attempts[0]); assert.equal(f.tables.messages.filter(message => message.texte === attempts[0].texte).length, 1); assert.equal(await input.inputValue(), '');
  });
  await run('directeur', 'completed-send-in-another-dossier-keeps-current-draft', async f => {
    const second = '73333333-3333-4333-8333-333333333333'; f.tables.clients[0].user_id = 'client-fixture';
    f.tables.colis.push({ ...f.tables.colis[0], id: second, ref: 'EXP-SECOND' });
    let release, entered; const gate = new Promise(resolve => { release = resolve; }); const pending = new Promise(resolve => { entered = resolve; });
    await f.context.route('**/rest/v1/rpc/queue_message', async route => { entered(); await gate; return route.fallback(); });
    await f.login(); await f.page.goto(`${base}/conversations?ouvert=${second}`);
    const field = () => f.page.getByLabel('Votre réponse au client', { exact: true }); await field().fill('Brouillon du second dossier');
    // A navigation renders the other conversation's composer a moment later: read it once it is there.
    const composerValue = async expected => { let value; for (let wait = 0; wait < 60; wait++) { value = await field().inputValue(); if (value === expected) break; await f.page.waitForTimeout(50); } return value; };
    await navigate(f.page, `/conversations?ouvert=${ids.P}`); await field().fill('Envoi du premier dossier'); await field().press('Control+Enter'); await pending;
    await navigate(f.page, `/conversations?ouvert=${second}`); assert.equal(await composerValue('Brouillon du second dossier'), 'Brouillon du second dossier');
    const attemptKey = `expedile:draft:v1:${encodeURIComponent(ids.A)}:${encodeURIComponent(`conversation-send:${ids.P}`)}`;
    assert.notEqual(await f.page.evaluate(key => sessionStorage.getItem(key), attemptKey), null, 'The first send is still pending before its response is released.');
    release();
    // Each opened conversation has its own composer, beside the list. The
    // second composer's enabled state says nothing about the first send finishing.
    await f.page.waitForFunction(key => sessionStorage.getItem(key) === null, attemptKey);
    assert.equal(await field().inputValue(), 'Brouillon du second dossier'); await navigate(f.page, `/conversations?ouvert=${ids.P}`); assert.equal(await composerValue(''), '');
  });
  // The client's own thread in the espace client: no team delivery state, « Vous » on the
  // right, a decision recorded by the team under the team member, a log scrollable by keyboard.
  const clientThread = f => {
    const staff = (id, statut, canal, texte, minute) => ({ id, colis_id: ids.P, type: 'staff', auteur_nom: 'Camille — Expedîle', auteur_id: 'staff-camille', canal, statut, texte, created_at: `2026-10-02T09:${minute}:00Z`, lu: true });
    f.tables.messages = [
      staff('s1', 'envoi', 'telegram', 'Bonjour Camille, vos cartons sont arrivés.', '00'),
      staff('s2', 'echec', 'telegram', 'Bonjour Camille 👋 Votre devis est prêt !', '05'),
      staff('s3', 'en_attente', 'portal', 'Bonjour Camille, pouvez-vous nous transmettre la facture Temu ?', '10'),
      { id: 'c1', colis_id: ids.P, type: 'client', auteur_nom: 'Exemple Camille', auteur_id: ids.A, texte: 'Bonjour, j’attends encore un colis Zalando. Puis-je attendre ?', created_at: '2026-10-02T09:15:00Z', lu: false },
      { id: 'd1', colis_id: ids.P, type: 'client', template: 'client_decision_wait', auteur_nom: 'Madly', auteur_id: 'staff-madly', canal: 'portal', texte: 'Attente volontaire enregistrée. Les relances sont suspendues.', created_at: '2026-10-02T09:20:00Z', lu: true },
      ...Array.from({ length: 6 }, (_, index) => staff(`s${index + 4}`, 'envoye', 'telegram', `Suivi ${index + 1} : vos cartons restent ensemble en attendant le colis Zalando.`, String(25 + index))),
    ];
  };
  // The page and the log at rest (five unchanged frames): axe measures the targets where they stay,
  // never one passing under the sticky header while a scroll is still under way.
  const scrollAtRest = page => page.evaluate(() => new Promise(resolve => {
    const log = document.querySelector('#client-conversation [role="log"]');
    let last = '', still = 0, frames = 0;
    const tick = () => {
      const now = `${scrollX},${scrollY},${log ? log.scrollTop : ''}`;
      still = now === last ? still + 1 : 0; last = now; frames += 1;
      if (still >= 5 || frames > 600) resolve(still >= 5); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  // `wide`: the wider fonts of a Linux machine (the CI), here on every machine.
  for (const [width, height, fonts] of [[1440, 1000], [1280, 800], [1280, 800, 'wide'], [390, 844]]) for (const dark of [false, true]) await run('client', `client-thread-reads-vous-without-team-delivery-states-${width}${fonts ? '-wide-fonts' : ''}-${dark ? 'dark' : 'light'}`, async f => {
    clientThread(f);
    await f.context.addInitScript(theme => localStorage.setItem('expedile-theme', theme), dark ? 'dark' : 'light');
    if (fonts) await f.context.addInitScript(() => { const apply = () => { const style = document.createElement('style'); style.textContent = '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }'; document.head.appendChild(style); }; if (document.head) apply(); else document.addEventListener('DOMContentLoaded', apply); });
    await f.page.setViewportSize({ width, height });
    await f.login(); await f.page.goto(`${base}/colis/${ids.P}?panel=messages`);
    const thread = f.page.locator('#client-conversation');
    const log = thread.getByRole('log', { name: 'Messages avec l’équipe', exact: true });
    await log.getByText('Suivi 6 :', { exact: false }).waitFor();
    for (const label of ['En attente de livraison', 'Envoi non confirmé', 'En attente de connexion Telegram', 'Envoyé', 'Distribué', 'Non lu']) assert.equal(await thread.getByText(label, { exact: true }).count(), 0, `« ${label} » is the team’s concern`);
    // The client's own message: « Vous », on the right.
    const own = log.locator('[data-from="client"]');
    assert.equal(await own.count(), 1);
    await own.getByText('Vous', { exact: true }).waitFor();
    const [ownBox, logBox] = [await own.locator(':scope > div').boundingBox(), await log.boundingBox()];
    assert.ok(ownBox.x + ownBox.width >= logBox.x + logBox.width - 24 && ownBox.x > logBox.x + 16, `Own message on the right: ${JSON.stringify({ ownBox, logBox })}`);
    // A decision the team recorded reads under the team member, on the team's side.
    const recorded = log.locator('[data-from="team"]').filter({ hasText: 'Attente volontaire enregistrée' });
    await recorded.getByText('Madly', { exact: true }).waitFor();
    assert.equal(await recorded.getByText('Vous', { exact: true }).count(), 0);
    // The scrolling log is reached and scrolled with the keyboard.
    assert.equal(await log.getAttribute('tabindex'), '0');
    assert.ok(await log.evaluate(node => node.scrollHeight > node.clientHeight + 20), 'The history scrolls');
    await log.focus();
    const bottom = await log.evaluate(node => node.scrollTop);
    await f.page.keyboard.press('PageUp');
    await f.page.waitForFunction(start => document.querySelector('#client-conversation [role="log"]').scrollTop < start, bottom);
    assert.equal(await scrollAtRest(f.page), true, 'The page and the log come to rest.');
    const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
    await f.page.screenshot({ path: `${out}/client-thread-${width}${fonts ? '-wide-fonts' : ''}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
    // A sent message: the client is told the team has it and answers here.
    await thread.getByLabel('Votre message à l’équipe', { exact: true }).fill('Le colis Zalando est arrivé chez vous ?');
    await thread.getByRole('button', { name: 'Envoyer le message', exact: true }).click();
    await thread.getByText('Message envoyé à l’équipe : nous vous répondons ici.', { exact: true }).waitFor();
    await log.getByText('Le colis Zalando est arrivé chez vous ?', { exact: true }).waitFor();
    assert.equal(await log.locator('[data-from="client"]').count(), 2);
    assert.equal(await thread.getByText(/Son état d’envoi/).count(), 0);
  });
  await browser.close(); await fs.writeFile(`${out}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
  if (results.some(result => !result.pass)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
