/* D2 « Retirer le devis et … » on fictitious dossiers only. The shared invoice
 * transport intercepts every provider request (PayPlug, Telegram, Supabase);
 * the PayPlug-first ordering, permissions and races are covered by the SQL and
 * Edge suites. This suite checks what the team sees and which requests leave. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture, B, C } = require('./invoice-workspace.cjs');
const { base, ids } = require('./browser-regression.cjs');
const { waitForCurrentInvoice } = require('./invoice-list.helper.cjs');

const output = process.env.PINTA_INVOICE_QUOTE_WITHDRAWAL_OUT || '/tmp/pinta-invoice-quote-withdrawal';
const LINK = 'https://secure.payplug.com/pay/fictitious-link';
const flat = text => String(text).replace(/[  ]/g, ' ');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const TEXT = {
  sentWithLink: 'Le devis envoyé au client (152,40 €) va être retiré. Son lien de paiement sera d’abord annulé chez PayPlug : le client ne pourra plus régler l’ancien montant.\nVous pourrez ensuite modifier la vérification de la facture, puis vérifier et envoyer un nouveau devis avec un nouveau lien.\nAucun message n’est envoyé au client par cette action.',
  sentWithoutLink: 'Le devis envoyé au client (152,40 €) va être retiré. Vous pourrez ensuite modifier la vérification de la facture, puis vérifier et envoyer un nouveau devis. Aucun message n’est envoyé au client par cette action.',
  liveLinkOnly: 'Un lien de paiement est encore actif pour ce dossier. Il sera d’abord annulé chez PayPlug. Vous pourrez ensuite modifier la vérification de la facture. Aucun message n’est envoyé au client par cette action.',
  uncertain: 'PayPlug n’a pas confirmé l’annulation de l’ancien lien. Rien n’a été modifié. Vérifiez dans PayPlug si le client a payé, puis réessayez.',
  paid: 'Un paiement est signalé chez PayPlug pour ce devis. Le devis est conservé et ne peut plus être modifié. Actualisez le dossier dans un instant.',
  partial: 'L’ancien lien de paiement est annulé, mais le retrait du devis n’est pas enregistré. Le dossier a été actualisé : réessayez.',
};

/** A sent quote with a live PayPlug link on the fixture dossier. */
async function sentFixture(browser, { link = true, duplicates = false, role, permissions } = {}) {
  const f = await fixture(browser, { category: 'cat-test', duplicates, ...(role ? { role } : {}), ...(permissions ? { permissions } : {}) });
  Object.assign(f.tables.colis[0], {
    statut: 'devis_envoye', devis_total: 152.4, devis_transport: 40, devis_brouillon: false, devis_envoye_le: '2026-10-01T08:00:00Z', quote_version: 3,
    payplug_payment_id: link ? 'pay_fictitious' : null, payplug_payment_url: link ? LINK : null,
  });
  const requests = [];
  f.page.on('request', request => { const url = new URL(request.url()); requests.push({ method: request.method(), path: url.pathname, search: url.search }); });
  return { ...f, sequence: requests };
}
const dialog = f => f.page.getByRole('dialog');
const withdrawals = f => f.calls.filter(call => call.kind === 'withdrawal');
const ocrCalls = f => f.calls.filter(call => call.kind === 'ocr');

async function openInvoice(f, invoice = ids.F) {
  await f.page.goto(`${base}/colis/${ids.P}?invoice=${invoice}&returnTo=%2Fcolis#quote-documents`);
  await f.page.getByTestId('invoice-action-bar').waitFor({ state: 'attached' });
  await waitForCurrentInvoice(f.page, invoice);
  await articlesTab(f);
}
async function articlesTab(f) {
  // Narrow layouts show one pane at a time.
  const tab = f.page.getByRole('tab', { name: 'Vérifier les articles', exact: true });
  if (await tab.isVisible()) await tab.click();
}
async function openModifyDialog(f) {
  await f.page.getByTestId('invoice-modify').click();
  await dialog(f).waitFor();
}
async function dialogText(f) {
  return flat(await dialog(f).locator('p').first().innerText());
}
const noOverflow = async (f, label) => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No horizontal overflow (${label}).`);
async function setTheme(f, theme) {
  await f.page.evaluate(value => localStorage.setItem('expedile-theme', value), theme);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  async function scenario(name, options, action) {
    if (process.env.PINTA_INVOICE_QUOTE_WITHDRAWAL_FILTER && !name.includes(process.env.PINTA_INVOICE_QUOTE_WITHDRAWAL_FILTER)) return;
    const f = await sentFixture(browser, options);
    f.page.setDefaultTimeout(10000);
    try {
      await f.login();
      await action(f);
      assert.deepEqual(f.errors, [], 'No uncaught application exception');
      assert.deepEqual(f.networkDenied, [], 'No unexpected provider request');
      assert.deepEqual(f.mutations, [], 'No direct write to invoices or articles around a sent quote');
      assert.equal(f.requests.some(request => /\/(queue_message|save_quote)$/.test(request.path)), false, 'A staff withdrawal never sends a message or a quote from the browser');
      results.push({ test: name, pass: true, withdrawals: withdrawals(f).length });
    } catch (error) {
      results.push({ test: name, pass: false, error: error.stack, url: f.page.url(), calls: f.calls, pageErrors: f.errors });
      await f.page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, `${name}-failure.txt`), await f.page.locator('body').innerText().catch(() => 'page unavailable'));
      process.exitCode = 1;
    } finally { await f.context.close(); }
  }
  try {
    for (const [mobile, theme] of [[false, 'light'], [true, 'dark']]) await scenario(`dialog-exact-texts-and-dismissals-make-no-request-${mobile ? 'mobile-dark' : 'desktop-light'}`, {}, async f => {
      if (mobile) await f.page.setViewportSize({ width: 390, height: 844 });
      await setTheme(f, theme);
      await openInvoice(f);
      assert.equal(await f.page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark');
      // Each way out of the dialog keeps the quote: no request at all.
      const before = f.calls.length;
      for (const dismiss of ['keep', 'escape', 'backdrop', 'close']) {
        await openModifyDialog(f);
        assert.equal(await dialog(f).getByRole('heading').innerText(), 'Modifier une facture du devis envoyé ?');
        assert.equal(await dialogText(f), TEXT.sentWithLink);
        assert.deepEqual(await dialog(f).getByRole('button').allInnerTexts(), ['', 'Garder le devis', 'Retirer le devis et modifier']);
        if (dismiss === 'keep') {
          await noOverflow(f, `dialog ${theme}`);
          const audit = await new AxeBuilder({ page: f.page }).include('[role="dialog"]').withTags(AXE_TAGS).analyze();
          assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
          await f.page.screenshot({ path: path.join(output, `dialog-${mobile ? 'mobile' : 'desktop'}-${theme}.png`) });
          await dialog(f).getByRole('button', { name: 'Garder le devis', exact: true }).click();
        } else if (dismiss === 'escape') await f.page.keyboard.press('Escape');
        else if (dismiss === 'backdrop') await f.page.mouse.click(5, 5);
        else await dialog(f).getByRole('button', { name: 'Fermer la confirmation', exact: true }).click();
        await dialog(f).waitFor({ state: 'detached' });
      }
      await f.page.waitForTimeout(300);
      assert.deepEqual(f.calls.slice(before).filter(call => call.kind !== 'sign'), [], 'Dismissing the dialog sends no withdrawal, modification or analysis request.');
      assert.equal(f.tables.colis[0].statut, 'devis_envoye');
      assert.equal(f.tables.colis[0].payplug_payment_url, LINK);
    });

    await scenario('dialog-without-link-and-live-link-only-variants', { link: false }, async f => {
      await openInvoice(f);
      await openModifyDialog(f);
      assert.equal(await dialogText(f), TEXT.sentWithoutLink);
      await f.page.keyboard.press('Escape');
      // A live link on a dossier the screen does not see as sent (e.g. an orphan link).
      Object.assign(f.tables.colis[0], { statut: 'en_preparation', payplug_payment_id: 'pay_orphan', payplug_payment_url: LINK });
      await f.page.reload(); await f.page.getByTestId('invoice-action-bar').waitFor({ state: 'attached' }); await articlesTab(f);
      await openModifyDialog(f);
      assert.equal(await dialogText(f), TEXT.liveLinkOnly);
      await dialog(f).getByRole('button', { name: 'Garder le devis', exact: true }).click();
      assert.equal(withdrawals(f).length, 0);
    });

    await scenario('confirm-withdraws-once-then-opens-the-modification-and-one-resume', {}, async f => {
      await openInvoice(f);
      assert.equal(ocrCalls(f).length, 0, 'D1: a validated invoice opens without analysis.');
      await openModifyDialog(f);
      await dialog(f).getByRole('button', { name: 'Retirer le devis et modifier', exact: true }).click();
      await dialog(f).waitFor({ state: 'detached' });
      const description = f.page.getByLabel('Description de l’article 1', { exact: true });
      await description.waitFor();
      assert.equal(await description.isEditable(), true, 'Edit mode opens after the withdrawal.');
      assert.equal(await description.inputValue(), 'Article vérifié');
      assert.equal(withdrawals(f).length, 1);
      assert.deepEqual(withdrawals(f)[0].input, { action: 'open_modification', colisId: ids.P, expectedUpdatedAt: '2026-09-09T08:00:00Z', reason: 'Modification d’une facture validée après l’envoi du devis', factureId: ids.F, expectedReviewToken: 'review-1-a' });
      assert.equal(f.calls.filter(call => call.kind === 'open-modification').length, 0, 'The withdrawal command opens the draft itself (atomic).');
      for (let i = 0; i < 40 && !ocrCalls(f).length; i++) await f.page.waitForTimeout(100);
      await f.page.waitForTimeout(400);
      assert.deepEqual(ocrCalls(f).map(call => call.input.action), ['resume'], 'Exactly one resume, after the modification is open.');
      assert.equal(f.tables.colis[0].statut, 'en_preparation');
      assert.equal(f.tables.colis[0].payplug_payment_url, null);
      // The dossier shown is the saved one: no sent-quote dialog any more.
      assert.equal(await f.page.getByTestId('invoice-header-feedback').filter({ hasText: 'Le devis est retiré. L’action n’a pas abouti' }).count(), 0);
    });

    await scenario('long-dialog-content-scrolls-inside-the-dialog', { duplicates: true }, async f => {
      await f.page.setViewportSize({ width: 390, height: 520 });
      await openInvoice(f, C);
      const more = f.page.locator('summary').filter({ hasText: 'Autres actions sur cette facture' });
      await more.click();
      await f.page.getByRole('button', { name: 'Retirer cette facture en double', exact: true }).click();
      const group = f.page.getByRole('group', { name: 'Retrait d’une facture en double', exact: true });
      await group.getByLabel('Facture originale à conserver', { exact: true }).selectOption(B);
      await group.getByRole('button', { name: 'Vérifier le retrait', exact: true }).click();
      await dialog(f).waitFor();
      assert.equal(await dialog(f).getByRole('heading').innerText(), 'Retirer cette copie du devis envoyé ?');
      const text = await dialogText(f);
      assert.match(text, /^Vous confirmez que ces deux documents correspondent au même achat\./);
      assert.match(text, /À retirer : facture \d — autre-achat\.pdf/);
      assert.ok(text.endsWith(TEXT.sentWithLink.replace('modifier la vérification de la facture', 'retirer la copie')), 'The duplicate check is followed by the withdrawal paragraph.');
      assert.doesNotMatch(text, /Aucun message ne sera envoyé au client\./, 'The no-message sentence is not said twice.');
      const box = await dialog(f).evaluate(element => ({ scroll: element.scrollHeight, client: element.clientHeight, top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom }));
      assert.ok(box.scroll > box.client, `Long content overflows inside the dialog (${box.scroll} > ${box.client}).`);
      assert.ok(box.top >= 0 && box.bottom <= 520 + 1, 'The dialog stays within the screen.');
      const confirm = dialog(f).getByRole('button', { name: 'Retirer le devis et retirer la copie', exact: true });
      await confirm.scrollIntoViewIfNeeded();
      assert.ok(await confirm.isVisible());
      await noOverflow(f, 'long dialog 390');
      await f.page.screenshot({ path: path.join(output, 'long-dialog-mobile.png') });
      await dialog(f).getByRole('button', { name: 'Garder le devis', exact: true }).click();
      assert.equal(withdrawals(f).length, 0);
      assert.equal(f.calls.some(call => call.kind === 'classify'), false);
    });

    await scenario('each-invoice-action-names-its-withdrawal', { duplicates: true }, async f => {
      const expectDialog = async (title, button) => {
        await dialog(f).filter({ hasText: title }).waitFor();
        assert.equal(await dialog(f).getByRole('heading').innerText(), title);
        await dialog(f).getByRole('button', { name: button, exact: true }).waitFor();
        await dialog(f).getByRole('button', { name: 'Garder le devis', exact: true }).click();
        await dialog(f).waitFor({ state: 'detached' });
      };
      await openInvoice(f, B);
      // Replace: the document is chosen first, then the withdrawal is asked.
      await f.page.locator('summary').filter({ hasText: 'Autres actions sur cette facture' }).click();
      await f.page.getByRole('button', { name: 'Remplacer le document', exact: true }).click();
      const [replaceChooser] = await Promise.all([f.page.waitForEvent('filechooser'), dialog(f).getByRole('button', { name: 'Choisir un nouveau document', exact: true }).click()]);
      await replaceChooser.setFiles({ name: 'nouvelle.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fictitious') });
      await expectDialog('Remplacer un document du devis envoyé ?', 'Retirer le devis et remplacer le document');
      // Add.
      const [addChooser] = await Promise.all([f.page.waitForEvent('filechooser'), f.page.getByRole('button', { name: 'Ajouter une facture', exact: true }).click()]);
      await addChooser.setFiles({ name: 'ajout.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fictitious') });
      await expectDialog('Ajouter une facture au devis envoyé ?', 'Retirer le devis et ajouter la facture');
      // Duplicate.
      await f.page.getByRole('button', { name: 'Retirer cette facture en double', exact: true }).click();
      const group = f.page.getByRole('group', { name: 'Retrait d’une facture en double', exact: true });
      await group.getByLabel('Facture originale à conserver', { exact: true }).selectOption(C);
      await group.getByRole('button', { name: 'Vérifier le retrait', exact: true }).click();
      await expectDialog('Retirer cette copie du devis envoyé ?', 'Retirer le devis et retirer la copie');
      // Correction request.
      await articlesTab(f);
      await f.page.getByRole('button', { name: 'Demander une correction au client', exact: true }).click();
      await f.page.getByLabel('Motif de correction', { exact: true }).fill('Le montant total est illisible.');
      await f.page.getByRole('button', { name: 'Enregistrer la correction', exact: true }).click();
      await expectDialog('Demander une correction au client ?', 'Retirer le devis et demander la correction');
      // Restore a retired copy.
      f.tables.factures.find(invoice => invoice.id === C).duplicate_of_facture_id = B;
      await f.page.goto(`${base}/colis/${ids.P}?invoice=${C}&returnTo=%2Fcolis#quote-documents`);
      await articlesTab(f);
      await f.page.getByRole('button', { name: 'Remettre à vérifier', exact: true }).click();
      await expectDialog('Remettre cette facture à vérifier ?', 'Retirer le devis et remettre à vérifier');
      // A purchase without invoice (documents task), while a late client invoice waits: the server will tell the client.
      f.control.withdrawal = { id: '88888888-0000-4000-8000-00000000000a', source: 'portal', status: 'pending', createdAt: '2026-10-03T08:00:00Z', withdrawnAt: null, linkCancelled: false, clientMessageStatus: 'not_required', lastError: null, factureIds: [] };
      await f.page.goto(`${base}/colis/${ids.P}?section=documents&returnTo=%2Fcolis`);
      await f.page.getByTestId('quote-withdrawal-banner').waitFor();
      await f.page.locator('summary').filter({ hasText: 'Ajouter un achat supplémentaire sans facture reliée' }).click();
      await f.page.getByLabel('Description du nouvel article', { exact: true }).fill('Housse de protection');
      await f.page.getByLabel('Quantité du nouvel article', { exact: true }).fill('1');
      await f.page.getByLabel('Prix du nouvel article', { exact: true }).fill('12');
      await f.page.getByLabel('Catégorie du nouvel article', { exact: true }).selectOption('cat-test');
      await f.page.getByLabel('Description du nouvel article', { exact: true }).press('Enter');
      await dialog(f).filter({ hasText: 'Modifier les achats du devis envoyé ?' }).waitFor();
      assert.ok((await dialogText(f)).endsWith('Le client recevra un message : facture bien reçue, devis mis à jour avec cet achat, ancien lien de paiement plus valable.'), 'The documents task uses the server lock: an absorbed client request is announced.');
      await expectDialog('Modifier les achats du devis envoyé ?', 'Retirer le devis et modifier l’achat');
      f.control.withdrawal = null;
      // A document received in the conversation.
      f.tables.messages.push({ id: 'late-document-message', colis_id: ids.P, type: 'client', auteur_nom: 'Client exemple', texte: 'Ma facture oubliée', canal: 'telegram', lu: true, attachment_path: ids.P + '/oubliee.pdf', attachment_name: 'oubliee.pdf', attachment_type: 'application/pdf', created_at: '2026-10-02T08:00:00Z' });
      await f.page.reload();
      const summary = f.page.locator('#quote-documents summary').filter({ hasText: 'Documents reçus à vérifier (1)' });
      await summary.waitFor();
      if (!await summary.locator('..').evaluate(element => element.open)) await summary.click();
      await f.page.getByRole('button', { name: 'Ajouter comme facture', exact: true }).click();
      await dialog(f).filter({ hasText: 'Ajouter cette facture au devis envoyé ?' }).waitFor();
      assert.ok((await dialogText(f)).endsWith('Le client recevra un message : facture bien reçue, devis mis à jour avec cet achat, ancien lien de paiement plus valable.'), 'The import announces the D3 client message.');
      await expectDialog('Ajouter cette facture au devis envoyé ?', 'Retirer le devis et ajouter la facture');
      assert.equal(withdrawals(f).length, 0, 'Keeping the quote never withdraws it.');
      assert.equal(f.calls.some(call => ['classify', 'restore'].includes(call.kind)), false);
      assert.equal(f.requests.some(request => /\/(import_conversation_invoice|lignes)$/.test(request.path) && request.method !== 'GET'), false);
    });

    await scenario('conversation-import-withdraws-and-tells-the-client', {}, async f => {
      f.tables.messages.push({ id: 'late-document-message', colis_id: ids.P, type: 'client', auteur_nom: 'Client exemple', texte: 'Ma facture oubliée', canal: 'telegram', lu: true, attachment_path: ids.P + '/oubliee.pdf', attachment_name: 'oubliee.pdf', attachment_type: 'application/pdf', created_at: '2026-10-02T08:00:00Z' });
      await f.page.goto(`${base}/colis/${ids.P}?returnTo=%2Fcolis`);
      await f.page.getByRole('tab', { name: /^Conversation/ }).click();
      const log = f.page.getByRole('log', { name: 'Messages avec le client', exact: true });
      await log.waitFor();
      await log.getByRole('button', { name: 'Utiliser comme facture', exact: true }).click();
      await dialog(f).filter({ hasText: 'Ajouter cette facture au devis envoyé ?' }).waitFor();
      await dialog(f).getByRole('button', { name: 'Retirer le devis et ajouter la facture', exact: true }).click();
      await log.getByText('Facture ajoutée, devis retiré. Client prévenu.', { exact: true }).waitFor();
      assert.equal(withdrawals(f).length, 1);
      assert.deepEqual(withdrawals(f)[0].input, { action: 'import_attachment', colisId: ids.P, expectedUpdatedAt: '2026-09-09T08:00:00Z', reason: 'Facture reçue dans la conversation après l’envoi du devis', messageId: 'late-document-message' });
      assert.equal(f.requests.some(request => request.path.endsWith('/import_conversation_invoice')), false, 'The import is part of the withdrawal command.');
      assert.equal(f.tables.factures.filter(invoice => invoice.fichier_url === ids.P + '/oubliee.pdf').length, 1);
    });

    await scenario('provider-errors-stay-inline-in-the-dialog', {}, async f => {
      const replies = [
        () => ({ status: 502, body: { ok: false, code: 'payplug_uncertain', error: 'PayPlug n’a pas confirmé.' } }),
        // The compensation cleared the cancelled URL: the dossier revision moved on.
        () => { Object.assign(f.tables.colis[0], { payplug_payment_url: null, updated_at: '2026-09-09T08:05:00Z' }); return { status: 500, body: { ok: false, code: null, hint: null, paymentLinkCancelled: true, withdrawalSaved: false, error: 'L’ancien lien de paiement est annulé, mais le retrait du devis n’est pas enregistré.' } }; },
        () => ({ status: 409, body: { ok: false, code: 'payplug_paid', error: 'Paiement signalé.' } }),
      ];
      f.control.withdrawalReply = () => replies.shift()();
      await openInvoice(f);
      await openModifyDialog(f);
      const confirm = dialog(f).getByRole('button', { name: 'Retirer le devis et modifier', exact: true });
      for (const expected of [TEXT.uncertain, TEXT.partial, TEXT.paid]) {
        const before = f.sequence.length;
        await confirm.click();
        await dialog(f).getByTestId('confirm-inline-error').filter({ hasText: expected }).waitFor();
        assert.equal(await dialog(f).getByRole('alert').innerText(), expected);
        assert.equal(await dialog(f).getByRole('heading').innerText(), 'Modifier une facture du devis envoyé ?', 'The dialog stays open on its own error.');
        // The body never promises what already happened (partial) and disappears on a final error (UX-R2-04).
        if (expected === TEXT.partial) assert.doesNotMatch(await dialogText(f), /sera d’abord annulé/);
        if (expected === TEXT.paid) assert.equal(await dialog(f).locator('p').count(), 1, 'Only the final error remains under the title.');
        // Every failed attempt reloads the saved dossier.
        const after = f.sequence.slice(before);
        const call = after.findIndex(request => request.path.endsWith('/functions/v1/invoice-quote-withdrawal'));
        assert.ok(call >= 0 && after.slice(call + 1).some(request => request.method === 'GET' && /\/rest\/v1\/colis$/.test(request.path) && request.search.includes(ids.P)), 'The dossier is refreshed after a failed withdrawal.');
      }
      await f.page.screenshot({ path: path.join(output, 'inline-error-desktop.png') });
      assert.equal(withdrawals(f).length, 3, 'One request per explicit click, never an automatic retry.');
      assert.deepEqual(withdrawals(f).map(call => call.input.expectedUpdatedAt), ['2026-09-09T08:00:00Z', '2026-09-09T08:00:00Z', '2026-09-09T08:05:00Z'], 'The retry after a partial failure uses the reloaded revision.');
      // A payment seen at PayPlug is final: the withdrawal is no longer offered.
      assert.equal(await confirm.count(), 0, 'No « Retirer le devis » button after a final error.');
      assert.deepEqual(await dialog(f).getByRole('button').allInnerTexts(), ['', 'Fermer']);
      assert.equal(await f.page.getByLabel('Description de l’article 1', { exact: true }).isEditable().catch(() => false), false, 'Nothing opens for editing after a failed withdrawal.');
      await dialog(f).getByRole('button', { name: 'Fermer', exact: true }).click();
      assert.equal(f.calls.some(call => call.kind === 'open-modification'), false);
    });

    await scenario('server-lock-hint-opens-the-dialog-when-the-screen-saw-no-lock', {}, async f => {
      Object.assign(f.tables.colis[0], { statut: 'en_preparation', payplug_payment_id: null, payplug_payment_url: null, devis_total: null });
      f.control.openReply = { status: 400, body: { code: '22023', message: 'Le devis envoyé couvre ces factures.', hint: 'quote_withdrawal_required' } };
      await openInvoice(f);
      await f.page.getByTestId('invoice-modify').click();
      await dialog(f).waitFor();
      assert.equal(await dialog(f).getByRole('heading').innerText(), 'Modifier une facture du devis envoyé ?');
      assert.equal(await dialogText(f), TEXT.liveLinkOnly);
      assert.equal(f.calls.filter(call => call.kind === 'open-modification').length, 1);
      await dialog(f).getByRole('button', { name: 'Retirer le devis et modifier', exact: true }).click();
      await f.page.getByLabel('Description de l’article 1', { exact: true }).waitFor();
      assert.equal(withdrawals(f).length, 1);
      assert.equal(withdrawals(f)[0].input.action, 'open_modification');
    });

    await scenario('a-role-without-article-permission-is-told-before-choosing-a-file', { role: 'preparateur', permissions: { perm_factures_voir: true, perm_factures_ajouter: true } }, async f => {
      await openInvoice(f);
      const info = f.page.getByTestId('invoice-lock-role-info');
      await info.waitFor();
      assert.equal(flat(await info.innerText()), 'Le devis envoyé couvre ces factures. Une personne autorisée à modifier les articles doit d’abord le retirer.');
      const add = f.page.getByRole('button', { name: 'Ajouter une facture', exact: true });
      assert.equal(await add.isDisabled(), true, 'No file is chosen for nothing.');
      assert.equal(await add.getAttribute('aria-describedby'), 'invoice-lock-role-info');
      assert.equal(withdrawals(f).length, 0);
    });

    await scenario('withdrawal-banners-pending-review-retry-and-withdrawn', {}, async f => {
      const request = { id: '88888888-0000-4000-8000-000000000009', source: 'portal', status: 'pending', createdAt: '2026-10-03T08:00:00Z', withdrawnAt: null, linkCancelled: false, clientMessageStatus: 'not_required', lastError: null, factureIds: [B] };
      f.control.withdrawal = { ...request };
      await openInvoice(f, B);
      const banner = f.page.getByTestId('quote-withdrawal-banner');
      await banner.waitFor();
      assert.equal(await banner.getAttribute('data-status'), 'pending');
      assert.match(flat(await banner.innerText()), /Facture reçue du client après l’envoi du devis\. L’ancien lien de paiement est en cours d’annulation : le devis sera retiré automatiquement\./);
      assert.equal(await banner.getByRole('button', { name: 'Réessayer l’annulation', exact: true }).isEnabled(), true);
      f.control.withdrawal = { ...request, status: 'processing' };
      await f.page.reload(); await banner.waitFor();
      assert.equal(await banner.getAttribute('data-status'), 'processing');
      assert.equal(await banner.getByRole('button', { name: 'Réessayer l’annulation', exact: true }).isDisabled(), true, 'No second attempt while one is running.');
      f.control.withdrawal = { ...request, status: 'needs_review', lastError: 'PayPlug ne confirme pas l’annulation' };
      await f.page.reload(); await banner.waitFor();
      assert.equal(await banner.getAttribute('data-status'), 'needs_review');
      assert.match(flat(await banner.innerText()), /L’ancien lien de paiement n’a pas pu être annulé automatiquement : PayPlug ne confirme pas l’annulation\. Vérifiez-le dans PayPlug, puis réessayez\./);
      await f.page.setViewportSize({ width: 390, height: 844 });
      await noOverflow(f, 'banner 390');
      // At 390 px the retry button wraps below the text, which keeps the banner width; a long provider token wraps inside it.
      f.control.withdrawal = { ...request, status: 'needs_review', lastError: 'payment_already_refunded_or_in_unexpected_state pay_5uI0x7Zs2Ty2q4lY1Ab9cDeF' };
      await f.page.reload(); await banner.waitFor();
      const layout = await banner.evaluate(node => { const text = node.querySelector('p').getBoundingClientRect(); const box = node.getBoundingClientRect(); const button = node.querySelector('button').getBoundingClientRect();
        return { ratio: text.width / box.width, below: button.top >= text.bottom - 1, clipped: [...node.querySelectorAll('p')].some(p => p.scrollWidth > p.clientWidth + 1) }; });
      assert.ok(layout.ratio > 0.7, `The banner text keeps the width (${layout.ratio.toFixed(2)}).`); assert.equal(layout.below, true, 'The retry button sits below the text.');
      assert.equal(layout.clipped, false, 'A long PayPlug token is wrapped, not clipped.');
      await noOverflow(f, 'banner 390 long token');
      await banner.scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, 'banner-needs-review-mobile.png') });
      await setTheme(f, 'dark'); await f.page.reload(); await banner.waitFor();
      const audit = await new AxeBuilder({ page: f.page }).include('[data-testid="quote-withdrawal-banner"]').withTags(AXE_TAGS).analyze();
      assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], 'Banner contrast in dark mode.');
      await setTheme(f, 'light'); await f.page.reload(); await banner.waitFor();
      await f.page.setViewportSize({ width: 1440, height: 1000 });
      await banner.getByRole('button', { name: 'Réessayer l’annulation', exact: true }).click();
      await f.page.waitForFunction(() => document.querySelector('[data-testid="quote-withdrawal-banner"]')?.dataset.status === 'withdrawn');
      assert.deepEqual(withdrawals(f).map(call => call.input), [{ action: 'retry', colisId: ids.P, withdrawalId: request.id }]);
      assert.match(flat(await banner.innerText()), /^Devis retiré le .+ : facture reçue du client après l’envoi\. Ancien lien de paiement annulé\. Client prévenu\. Vérifiez la nouvelle facture puis envoyez le nouveau devis\.$/);
      // A payment booked meanwhile: the late invoice is kept, never added to the paid quote.
      f.control.withdrawal = { ...request, status: 'paid' };
      Object.assign(f.tables.colis[0], { statut: 'paye', paiement_date: '2026-10-03T09:00:00Z', paiement_montant: 152.4 });
      await f.page.reload(); await banner.waitFor();
      assert.equal(await banner.getAttribute('data-status'), 'paid');
      assert.equal(flat(await banner.innerText()), 'Facture reçue après le paiement : conservée, non ajoutée au devis payé.');
      await f.page.getByTestId('invoice-frozen-notice').filter({ hasText: 'Paiement enregistré : factures, articles et analyses sont figés. Ils restent consultables.' }).waitFor();
      assert.equal(await f.page.getByTestId('invoice-modify').count(), 0);
    });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
