/* D3 in the client portal, on a fictitious dossier: an invoice added after the
 * quote was sent. Every request is intercepted (no PayPlug, Telegram or
 * Supabase contact); the PayPlug-first withdrawal itself is covered by the SQL
 * and Edge suites. This suite checks what the client reads before and after. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');

const output = process.env.PINTA_CLIENT_LATE_INVOICE_OUT || '/tmp/pinta-client-late-invoice';
const LINK = 'https://secure.payplug.com/pay/fictitious-link';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const pdf = name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic document') });
const INFO = {
  link: 'Votre devis vous a déjà été envoyé. Si vous ajoutez une facture, il sera mis à jour avec cet achat : l’ancien lien de paiement sera annulé et vous recevrez un nouveau devis.',
  noLink: 'Votre devis vous a déjà été envoyé. Si vous ajoutez une facture, il sera mis à jour avec cet achat et vous recevrez un nouveau devis.',
};
const NOTICE = {
  quote_withdrawn_link: 'Merci, votre facture est bien reçue ! Votre devis va être mis à jour avec cet achat : l’ancien lien de paiement n’est plus valable. Vous recevrez le nouveau devis dès qu’il sera prêt.',
  quote_withdrawn: 'Merci, votre facture est bien reçue ! Votre devis va être mis à jour avec cet achat. Vous recevrez le nouveau devis dès qu’il sera prêt.',
  received_pending: 'Merci, votre facture est bien reçue ! Notre équipe met à jour votre devis avec cet achat. Merci d’attendre le nouveau devis avant tout paiement : vous serez prévenu(e) dès qu’il sera prêt.',
  paid: 'Votre paiement est en cours d’enregistrement : ce document est conservé dans votre dossier et notre équipe revient vers vous si nécessaire.',
  frozen: 'Votre paiement est déjà enregistré : ce document est conservé dans votre dossier et notre équipe revient vers vous si nécessaire.',
  duplicate: 'Nous avions déjà ce document : rien ne change pour votre devis.',
  added: 'Facture reçue et enregistrée. Notre équipe la vérifie.',
  mixed: 'Facture reçue et enregistrée. Notre équipe la vérifie. 1 document était déjà dans votre dossier.',
};
const PENDING_TITLE = 'Votre devis est en cours de mise à jour';
const PENDING_TEXT = 'Nous avons bien reçu votre nouvelle facture. Vous recevrez le nouveau devis dès qu’il sera prêt : vous n’avez rien à faire d’ici là.';
const flat = text => String(text).replace(/[  ]/g, ' ');

/** A sent quote on the client's dossier, with its PayPlug link unless link=false. */
function sentQuote(f, { link = true, pending = false } = {}) {
  Object.assign(f.tables.colis[0], {
    statut: 'devis_envoye', feu_vert: 'autorise', devis_total: 152.4, devis_transport: 40, devis_brouillon: false, devis_envoye_le: '2026-10-01T08:00:00Z', quote_version: 3,
    payplug_payment_id: link ? 'pay_fictitious' : null, payplug_payment_url: link ? LINK : null, quote_update_pending: pending,
  });
}
async function open(f) {
  await f.login();
  await f.page.goto(`${base}/colis/${ids.P}`);
  await f.page.getByRole('region', { name: 'État actuel et prochaine étape', exact: true }).waitFor();
}
async function openDocuments(f) {
  const form = f.page.getByRole('form', { name: 'Déposer une facture', exact: true });
  const toggle = f.page.getByRole('button', { name: /^Mes factures \(/ });
  await toggle.waitFor();
  // The documents panel may already be open (kept in the address after a reload).
  if (await toggle.getAttribute('aria-expanded') !== 'true' && !await form.isVisible()) await toggle.click();
  await form.waitFor();
}
const noOverflow = async (f, label) => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No horizontal overflow (${label}).`);
async function axe(f, selector) {
  const audit = await new AxeBuilder({ page: f.page }).include(selector).withTags(AXE_TAGS).analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  async function scenario(name, action) {
    if (process.env.PINTA_CLIENT_LATE_INVOICE_FILTER && !name.includes(process.env.PINTA_CLIENT_LATE_INVOICE_FILTER)) return;
    const f = await setup(browser, 'client');
    f.page.setDefaultTimeout(10000);
    const deposits = [];
    await f.context.route('**/storage/v1/object/factures/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    try {
      await action(f, deposits);
      assert.deepEqual(f.errors, [], 'No uncaught application exception');
      assert.deepEqual(f.networkDenied, [], 'No unexpected provider request');
      assert.equal(f.requests.some(request => /\/rest\/v1\/factures$/.test(request.path) && request.method !== 'GET'), false, 'The portal never writes invoices directly: the deposit command does.');
      assert.equal(f.requests.some(request => /\/(queue_message|payplug-create)$/.test(request.path)), false, 'No message or payment link is created from the portal.');
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1;
      results.push({ test: name, pass: false, error: error.stack, url: f.page.url() });
      await f.page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, `${name}-failure.txt`), await f.page.locator('body').innerText().catch(() => 'page unavailable'));
    } finally { await f.context.close(); }
  }
  /** Answers the deposit command with the given outcome per file name. */
  const answerDeposits = (f, deposits, outcome) => f.context.route('**/functions/v1/client-invoice-deposit', route => {
    const input = route.request().postDataJSON(); deposits.push(input);
    const { status, linkCancelled, reason } = outcome(input);
    const facture = ['frozen', 'paid', 'duplicate'].includes(status) ? undefined : { id: crypto.randomUUID(), colis_id: input.colisId, vendeur: input.fileName, montant: 0, valide: false, fichier_url: input.path, fichier_nom: input.fileName };
    if (facture) f.tables.factures.push(facture);
    // client_colis then reports the update in progress (quote_update_pending).
    if (['received_pending', 'quote_withdrawn'].includes(status)) f.tables.colis[0].quote_update_pending = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status, ...(reason ? { reason } : {}), ...(facture ? { facture } : {}), ...(linkCancelled === undefined ? {} : { linkCancelled }) }) });
  });
  const information = f => f.page.getByTestId('client-deposit-information');
  const notice = f => f.page.getByTestId('client-deposit-notice');

  try {
    await scenario('information-before-sending-with-and-without-link', async f => {
      sentQuote(f);
      await open(f);
      await f.page.getByRole('button', { name: /^Payer/ }).waitFor();
      await openDocuments(f);
      assert.equal(flat(await information(f).innerText()), INFO.link);
      sentQuote(f, { link: false });
      await f.page.reload(); await openDocuments(f);
      assert.equal(flat(await information(f).innerText()), INFO.noLink);
      // Before the quote is sent there is nothing to announce.
      Object.assign(f.tables.colis[0], { statut: 'en_preparation', devis_total: null, devis_brouillon: true });
      await f.page.reload(); await openDocuments(f);
      assert.equal(await information(f).count(), 0);
    });

    await scenario('every-deposit-outcome-has-its-notice', async (f, deposits) => {
      sentQuote(f);
      const plan = [
        ['quote_withdrawn_link', { status: 'quote_withdrawn', linkCancelled: true }],
        ['quote_withdrawn', { status: 'quote_withdrawn', linkCancelled: false }],
        ['received_pending', { status: 'received_pending' }],
        ['paid', { status: 'paid' }],
        ['frozen', { status: 'frozen', reason: 'payment' }],
        ['duplicate', { status: 'duplicate' }],
        ['added', { status: 'added' }],
      ];
      let current = null;
      await answerDeposits(f, deposits, () => current);
      await open(f);
      for (const [key, outcome] of plan) {
        current = outcome;
        sentQuote(f);
        await f.page.reload(); await openDocuments(f);
        await f.page.getByLabel('Facture ou photo', { exact: true }).setInputFiles(pdf(`${key}.pdf`));
        await f.page.getByRole('button', { name: 'Déposer la facture', exact: true }).click();
        await notice(f).waitFor();
        assert.equal(flat(await notice(f).innerText()), NOTICE[key], `Notice for ${key}`);
        assert.equal(await notice(f).getAttribute('role'), 'status');
        // Once a deposit is kept outside the quote (paid or frozen), the pre-send information is withdrawn.
        if (['paid', 'frozen'].includes(key)) assert.equal(await information(f).count(), 0, `No pre-send information after ${key}`);
      }
      assert.deepEqual(deposits.map(input => input.fileName), plan.map(([key]) => `${key}.pdf`), 'One deposit command per file.');
      assert.ok(deposits.every(input => input.colisId === ids.P && input.path.startsWith(ids.P + '/') && input.vendor === null && input.replacesFactureId === null));
    });

    await scenario('batch-notice-follows-priority-and-counts-known-documents', async (f, deposits) => {
      sentQuote(f);
      await answerDeposits(f, deposits, input => ({ status: input.fileName.startsWith('known') ? 'duplicate' : input.fileName.startsWith('late') ? 'received_pending' : 'added' }));
      await open(f); await openDocuments(f);
      await f.page.getByLabel('Facture ou photo', { exact: true }).setInputFiles([pdf('nouvelle.pdf'), pdf('known.pdf')]);
      await f.page.getByRole('button', { name: 'Déposer les 2 factures', exact: true }).click();
      await notice(f).waitFor();
      assert.equal(flat(await notice(f).innerText()), NOTICE.mixed);
      await f.page.getByLabel('Facture ou photo', { exact: true }).setInputFiles([pdf('nouvelle-2.pdf'), pdf('late.pdf')]);
      await f.page.getByRole('button', { name: 'Déposer les 2 factures', exact: true }).click();
      await notice(f).filter({ hasText: 'Notre équipe met à jour votre devis' }).waitFor();
      assert.equal(flat(await notice(f).innerText()), NOTICE.received_pending, 'An updating quote outranks the other outcomes.');
      const rows = await f.page.getByRole('list', { name: 'Résultat du dépôt des factures', exact: true }).innerText();
      assert.match(rows, /late\.pdf/);
    });

    for (const [mobile, theme] of [[false, 'light'], [true, 'dark']]) await scenario(`quote-update-pending-replaces-amount-and-pay-button-${mobile ? 'mobile-dark' : 'desktop-light'}`, async f => {
      if (mobile) await f.page.setViewportSize({ width: 390, height: 844 });
      sentQuote(f);
      await open(f);
      await f.page.evaluate(value => localStorage.setItem('expedile-theme', value), theme);
      // Control: the sent quote shows its amount and pay button.
      await f.page.reload();
      await f.page.getByRole('button', { name: /^Payer/ }).waitFor();
      assert.equal(await f.page.getByTestId('quote-update-pending').count(), 0);
      sentQuote(f, { link: false, pending: true });
      await f.page.reload();
      const block = f.page.getByTestId('quote-update-pending');
      await block.waitFor();
      assert.equal(await block.getAttribute('role'), 'status');
      assert.equal(flat(await block.innerText()).replace(/\n+/g, '\n'), `${PENDING_TITLE}\n${PENDING_TEXT}`);
      assert.equal(await f.page.getByRole('button', { name: /^Payer/ }).count(), 0, 'No pay button while the quote is updated.');
      assert.equal(await f.page.getByText('Montant à régler', { exact: true }).count(), 0, 'The old amount is not shown.');
      assert.equal(await f.page.getByText(/152[.,]40/).count(), 0, 'The old total appears nowhere.');
      // One instruction only: nothing to do, no payment step, no old PDF, no « Devis envoyé le ».
      const current = f.page.getByRole('region', { name: 'État actuel et prochaine étape', exact: true });
      assert.equal(flat(await current.getByRole('heading', { level: 2 }).innerText()), 'Devis en cours de mise à jour');
      assert.equal(await current.getByText(/^À vous/).count(), 0, 'No « À vous » action while the quote is updating.');
      assert.equal(await current.getByText('Aucune action attendue de votre part.', { exact: true }).count(), 1);
      assert.equal(await f.page.getByRole('button', { name: 'Télécharger le devis (PDF)', exact: true }).count(), 0, 'The withdrawn quote cannot be downloaded.');
      assert.equal(await current.getByText(/^Devis envoyé le/).count(), 0);
      assert.equal(await f.page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark');
      await noOverflow(f, `pending ${theme}`);
      await axe(f, '[data-testid="quote-update-pending"]');
      await block.scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, `quote-update-pending-${mobile ? 'mobile' : 'desktop'}-${theme}.png`) });
      // The information about a sent quote is not repeated while it is updating.
      await openDocuments(f);
      assert.equal(await f.page.getByTestId('client-deposit-information').count(), 0);
    });

    await scenario('quote-update-pending-in-the-list-and-for-a-professional-client', async f => {
      sentQuote(f, { link: false, pending: true });
      await f.login();
      await f.page.goto(`${base}/colis`);
      const card = f.page.getByRole('button', { name: new RegExp(f.tables.colis[0].ref) }).first();
      await card.waitFor();
      const text = flat(await card.innerText());
      assert.match(text, /Devis en cours de mise à jour/); assert.match(text, /Suivre la mise à jour du devis/);
      assert.doesNotMatch(text, /Consulter le devis et le règlement|152[.,]40/, 'The list never asks to pay an updating quote.');
      // A professional client sees neither the old total nor the transfer reference.
      const client = f.tables.clients.find(row => row.id === f.tables.colis[0].client_id);
      if (client) client.type = 'pro';
      Object.assign(f.tables.colis[0], { mode_paiement_pro: 'virement' });
      await f.page.goto(`${base}/colis/${ids.P}`);
      await f.page.getByTestId('quote-update-pending').waitFor();
      assert.equal(await f.page.getByText(/Référence à communiquer/).count(), 0);
      assert.equal(await f.page.getByText(/152[.,]40/).count(), 0);
    });

    await scenario('mobile-390-information-and-notice-without-horizontal-scroll', async (f, deposits) => {
      await f.page.setViewportSize({ width: 390, height: 844 });
      sentQuote(f);
      await answerDeposits(f, deposits, () => ({ status: 'received_pending' }));
      await open(f);
      await f.page.evaluate(() => localStorage.setItem('expedile-theme', 'dark'));
      await f.page.reload(); await openDocuments(f);
      assert.equal(flat(await information(f).innerText()), INFO.link);
      await noOverflow(f, 'information 390');
      await axe(f, 'form[aria-label="Déposer une facture"]');
      await f.page.getByLabel('Facture ou photo', { exact: true }).setInputFiles(pdf('facture-un-nom-de-fichier-particulierement-long-pour-un-telephone.pdf'));
      await f.page.getByRole('button', { name: 'Déposer la facture', exact: true }).click();
      await notice(f).waitFor();
      assert.equal(flat(await notice(f).innerText()), NOTICE.received_pending);
      // The refreshed dossier shows the update in progress instead of the old quote.
      await f.page.getByTestId('quote-update-pending').waitFor();
      assert.equal(await information(f).count(), 0);
      assert.equal(await f.page.getByRole('button', { name: /^Payer/ }).count(), 0);
      await noOverflow(f, 'notice 390');
      await notice(f).scrollIntoViewIfNeeded();
      await f.page.screenshot({ path: path.join(output, 'deposit-notice-mobile-dark.png') });
      await f.page.setViewportSize({ width: 320, height: 700 });
      await noOverflow(f, 'notice 320');
    });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
