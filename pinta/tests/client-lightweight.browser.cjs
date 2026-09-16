/* Every account, document and business request is fictitious and intercepted. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_CLIENT_LIGHT_OUT || '/tmp/pinta-client-lightweight';
const pdf = name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic document') });
const results = [];
async function main() {
  const browser = await chromium.launch({ headless: true }); await fs.mkdir(output, { recursive: true });
  async function scenario(name, run) {
    const f = await setup(browser, 'client'); f.page.setDefaultTimeout(10000);
    try {
      await run(f);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
      assert.equal(f.requests.some(request => request.path.endsWith('/queue_message')), false, 'No automatic staff notification is sent.');
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
      await f.page.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {});
    } finally { await f.context.close(); }
  }
  const open = async f => { await f.login(); await f.page.goto(`${base}/colis/${ids.P}`); await f.page.getByRole('region', { name: 'État actuel et prochaine étape', exact: true }).waitFor(); };
  const docs = f => f.page.getByRole('button', { name: /^Documents \(/ });
  const messages = f => f.page.getByRole('button', { name: /^Messages \(/ });
  const pending = f => { Object.assign(f.tables.colis[0], { statut: 'en_preparation', feu_vert: 'autorise' }); f.tables.factures = []; f.tables.lignes = []; };
  try {
    await scenario('single-consent-action-and-context-hidden-by-default', async f => {
      f.tables.colis[0].nb_colis = 3; f.tables.factures = []; f.tables.lignes = [];
      await open(f);
      assert.equal(await f.page.getByLabel('Facture ou photo', { exact: true }).count(), 0);
      assert.equal(await f.page.getByLabel('Votre message à l’équipe', { exact: true }).count(), 0);
      await f.page.getByRole('button', { name: 'Autoriser la préparation', exact: true }).click();
      const dialog = f.page.getByRole('dialog'); await dialog.waitFor(); assert.match(await dialog.innerText(), /3 carton\(s\)/);
      await dialog.getByRole('button', { name: 'J’autorise ce dossier', exact: true }).click();
      await f.page.getByRole('button', { name: 'Transmettre mes factures', exact: true }).waitFor();
      assert.equal(f.tables.colis[0].statut, 'autorise');
    });
    await scenario('waiting-client-has-no-required-action-and-can-resume-explicitly', async f => {
      f.tables.colis[0].attente_client_date = '2026-09-01T08:00:00Z';
      f.tables.factures = []; await open(f);
      await f.page.getByText('Aucune action attendue de votre part.', { exact: true }).waitFor();
      assert.equal(await f.page.getByRole('button', { name: 'Autoriser la préparation', exact: true }).isVisible(), false);
      await f.page.getByText('Reprendre ma décision', { exact: true }).click();
      await f.page.getByRole('button', { name: 'Autoriser la préparation', exact: true }).waitFor();
      assert.equal(f.requests.some(request => request.path.endsWith('/client_decision')), false);
    });
    await scenario('multiple-documents-partial-failure-and-retry-without-duplicate-upload', async f => {
      pending(f); let uploads = 0; let inserts = 0; let rejectSecond = true;
      await f.context.route('**/storage/v1/object/factures/**', async route => { uploads++; await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
      await f.context.route('**/rest/v1/factures*', async route => {
        if (route.request().method() === 'POST') {
          inserts++; const input = route.request().postDataJSON();
          if (input.fichier_nom === 'second.pdf' && rejectSecond) { rejectSecond = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Insertion indisponible pour second.pdf' }) }); }
        }
        return route.fallback();
      });
      await open(f); await f.page.getByRole('button', { name: 'Transmettre mes factures', exact: true }).click();
      const input = f.page.getByLabel('Facture ou photo', { exact: true });
      assert.equal(await input.getAttribute('multiple'), '');
      await input.setInputFiles([pdf('first.pdf'), pdf('second.pdf')]);
      await f.page.getByRole('form', { name: 'Déposer une facture', exact: true }).evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
      await f.page.getByRole('alert').filter({ hasText: 'Insertion indisponible' }).waitFor();
      assert.equal(f.tables.factures.length, 1); assert.equal(uploads, 2); assert.equal(inserts, 2);
      await f.page.getByRole('button', { name: 'Réessayer les documents en échec', exact: true }).click();
      await f.page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Résultat du dépôt des factures"] li')].every(row => row.innerText.includes('Enregistrée')));
      assert.equal(f.tables.factures.length, 2); assert.equal(uploads, 2); assert.equal(inserts, 3);
      assert.ok(f.tables.factures.every(invoice => invoice.colis_id === ids.P && !invoice.valide && invoice.montant === 0));
      await input.setInputFiles({ name: 'unsupported.zip', mimeType: 'application/zip', buffer: Buffer.from('synthetic') });
      await f.page.getByRole('button', { name: 'Déposer la facture', exact: true }).click();
      await f.page.getByRole('alert').filter({ hasText: 'Utilisez un PDF' }).waitFor(); assert.equal(uploads, 2);
      await f.page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await f.page.screenshot({ path: path.join(output, 'multiple-documents-mobile.png'), fullPage: true });
    });
    await scenario('lost-insert-response-reuses-the-already-saved-private-document', async f => {
      pending(f); let inserts = 0;
      await f.context.route('**/storage/v1/object/factures/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await f.context.route('**/rest/v1/factures*', async route => {
        if (route.request().method() === 'POST') {
          inserts++; f.tables.factures.push({ ...route.request().postDataJSON(), id: ids.F });
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Réponse perdue après enregistrement' }) });
        }
        return route.fallback();
      });
      await open(f); await docs(f).click(); await f.page.getByLabel('Facture ou photo', { exact: true }).setInputFiles(pdf('saved.pdf'));
      await f.page.getByRole('button', { name: 'Déposer la facture', exact: true }).click();
      await f.page.getByRole('alert').filter({ hasText: 'Réponse perdue' }).waitFor();
      await f.page.getByRole('button', { name: 'Réessayer les documents en échec', exact: true }).click();
      await f.page.getByText('Facture reçue et enregistrée. Notre équipe la vérifie.', { exact: true }).waitFor();
      assert.equal(inserts, 1); assert.equal(f.tables.factures.length, 1);
    });
    await scenario('replacement-stays-single-file-and-preserves-its-original', async f => {
      Object.assign(f.tables.colis[0], { statut: 'en_preparation', feu_vert: 'autorise' });
      Object.assign(f.tables.factures[0], { valide: false, rejet_motif: 'Page illisible' });
      await f.context.route('**/storage/v1/object/factures/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await open(f); await f.page.getByRole('button', { name: 'Corriger une facture', exact: true }).click();
      await f.page.getByLabel('Facture corrigée', { exact: true }).selectOption(ids.F);
      const input = f.page.getByLabel('Facture ou photo', { exact: true }); assert.equal(await input.getAttribute('multiple'), null);
      await input.setInputFiles(pdf('correction.pdf')); await f.page.getByRole('button', { name: 'Déposer la facture', exact: true }).click();
      await f.page.getByText('Facture reçue et enregistrée. Notre équipe la vérifie.', { exact: true }).waitFor();
      assert.equal(f.tables.factures.length, 2); assert.equal(f.tables.factures[1].replaces_facture_id, ids.F);
      assert.equal(f.tables.factures[0].rejet_motif, 'Page illisible');
    });
    await scenario('messages-open-once-and-preserve-draft-between-context-panels', async f => {
      Object.assign(f.tables.colis[0], { statut: 'en_preparation', conversation_statut: 'attente_client' });
      await open(f); await f.page.getByRole('button', { name: 'Répondre à l’équipe', exact: true }).click();
      const reply = f.page.getByLabel('Votre message à l’équipe', { exact: true }); await reply.fill('Brouillon client conservé');
      await docs(f).click(); await messages(f).click(); assert.equal(await reply.inputValue(), 'Brouillon client conservé');
      assert.equal(f.requests.some(request => request.method === 'POST' && request.path.endsWith('/messages')), false);
      await f.page.setViewportSize({ width: 390, height: 844 });
      const audit = await new AxeBuilder({ page: f.page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
      await f.page.screenshot({ path: path.join(output, 'client-messages-mobile.png'), fullPage: true });
    });
    await scenario('professional-payment-terms-and-message-contact-remain-accessible', async f => {
      f.tables.clients[0].type = 'pro';
      Object.assign(f.tables.colis[0], { statut: 'devis_envoye', devis_total: 120, devis_transport: 120, devis_brouillon: false, mode_paiement_pro: 'virement', devis_envoye_le: '2026-09-01T08:00:00Z' });
      await open(f); await f.page.getByText('Virement bancaire', { exact: true }).waitFor();
      await f.page.getByRole('button', { name: 'Télécharger le devis (PDF)', exact: true }).waitFor();
      await f.page.getByRole('button', { name: 'Consulter les échanges de règlement', exact: true }).click();
      await f.page.getByLabel('Votre message à l’équipe', { exact: true }).waitFor();
      assert.equal(f.tables.colis[0].statut, 'devis_envoye');
    });
    await scenario('paid-documents-are-consultable-without-deposit-or-payment-action', async f => {
      Object.assign(f.tables.colis[0], { statut: 'paye', paiement_date: '2026-09-01T08:00:00Z', paiement_montant: 120 });
      await open(f); await f.page.getByText('Aucune action attendue de votre part.', { exact: true }).waitFor();
      await docs(f).click(); await f.page.getByRole('link', { name: 'Ouvrir le PDF', exact: true }).waitFor();
      assert.equal(await f.page.getByLabel('Facture ou photo', { exact: true }).count(), 0);
      assert.equal(await f.page.getByRole('button', { name: /^Payer / }).count(), 0);
    });
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
