/* Network-isolated browser regression suite. Every non-local request is intercepted. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.PINTA_TEST_URL || 'http://127.0.0.1:4175';
const output =
  process.env.PINTA_TEST_OUT ||
  path.resolve(__dirname, '../../docs/verification-expedile-2026-09-10');
const A = '11111111-1111-4111-8111-111111111111',
  C = '22222222-2222-4222-8222-222222222222',
  P = '33333333-3333-4333-8333-333333333333',
  F = '44444444-4444-4444-8444-444444444444',
  L = '55555555-5555-4555-8555-555555555555',
  S = '66666666-6666-4666-8666-666666666666';
const observations = [];
function fixtures(role) {
  return {
    profiles: [{ id: A, nom: 'Camille', role, actif: true }],
    clients: [
      {
        id: C,
        user_id: role === 'client' ? A : null,
        ref: 'CLI-TEST',
        nom: 'Exemple',
        prenom: 'Camille',
        email: 'camille@example.test',
        cp: '97400',
        ville: 'Saint-Denis',
        adresse_ligne1: '1 rue Exemple',
        type: 'particulier',
        abonnement: 'freemium',
        onboarded: true,
        created_at: '2026-09-01T08:00:00Z',
      },
    ],
    colis: [
      {
        id: P,
        client_id: C,
        ref: 'EXP-TEST-001',
        statut: role === 'client' ? 'attente_feu_vert' : 'en_preparation',
        desc_contenu: 'Deux achats à regrouper',
        trackings: ['TEST-001', 'TEST-002'],
        trackings_detail: [
          { number: 'TEST-001', fournisseur: 'Boutique A' },
          { number: 'TEST-002', fournisseur: 'Boutique B' },
        ],
        casier: 'A-03',
        nb_colis: 2,
        date_reception: '2026-09-08T08:00:00Z',
        created_at: '2026-09-08T08:00:00Z',
        updated_at: '2026-09-09T08:00:00Z',
        dim_l: 40,
        dim_w: 30,
        dim_h: 20,
        poids: 3,
        fin_l: 30,
        fin_w: 20,
        fin_h: 20,
        fin_p: 3,
        final_packages: [{ dimL: 30, dimW: 20, dimH: 20, poids: 3 }],
        preparation_composition_version: 1,
        final_measurements_version: 1,
        final_measurements_at: '2026-09-09T08:00:00Z',
        outgoing_parcel_count: 1,
        feu_vert: role === 'client' ? 'en_attente' : 'autorise',
        archive: false,
        quote_version: 0,
        frais_divers: [],
      },
    ],
    factures: [
      {
        id: F,
        colis_id: P,
        vendeur: 'Boutique A',
        montant: 100,
        valide: true,
        fichier_url: P + '/facture.pdf',
        fichier_nom: 'facture.pdf',
      },
    ],
    lignes: [
      {
        id: L,
        colis_id: P,
        facture_id: F,
        description: 'Article vérifié',
        qte: 1,
        prix_unitaire: 100,
        categorie_id: 'cat-test',
      },
    ],
    categories: [{ id: 'cat-test', label: 'Divers', position: 1 }],
    taux_categories: [
      { id: 'rate-test', categorie_id: 'cat-test', destination_code: '974', om: 10, omr: 2.5 },
    ],
    tarifs: [{ id: 'tarif-test', destination_code: '974', base: 25, par_kg: 5, actif: true }],
    staff_users: [
      {
        id: S,
        auth_id: A,
        role,
        nom: 'Camille',
        prenom: 'Test',
        email: 'audit@example.test',
        actif: true,
        must_change_password: false,
        staff_permissions: [],
      },
    ],
    app_settings: [
      {
        key: 'business',
        value: {
          diviseurVolumetrique: 5000,
          fraisStockage: 1.5,
          stockageGratuit: 14,
          relancesFeuVert: 'J+2, J+5, J+7',
          relancesPaiement: 'J+3, J+7, J+14',
        },
      },
    ],
    message_templates: [],
    envois: [],
    messages: [],
    notifications: [
      {
        id: 'notif-test',
        user_id: A,
        titre: 'Bienvenue',
        msg: 'Dossier à consulter',
        lu: false,
        colis_id: P,
        created_at: '2026-09-09T12:00:00Z',
      },
    ],
    client_inbox: [],
    staff_work_actions: [{ id: '77777777-0000-4000-8000-000000000001', colis_id: P, kind: 'preparation', state: 'ready', assignee_id: A, version: 1, created_at: '2026-09-09T08:00:00Z', updated_at: '2026-09-09T08:00:00Z' }],
    staff_work_preferences: [{ staff_id: A, missions: ['reception','preparation','communication','documents','departures','coordination'], active_mission: 'preparation', density: 'comfortable', available: true, version: 1 }],
    audit_actions: [],
    logs_statut: [],
    staff_permissions: [],
  };
}
async function setup(browser, role, { failTable = null } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'fr-FR',
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
  const tables = fixtures(role),
    requests = [],
    errors = [],
    networkDenied = [];
  const user = {
    id: A,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'audit@example.test',
    user_metadata: { role: role === 'client' ? 'directeur' : 'client', nom: 'Metadata non fiable' },
    created_at: new Date().toISOString(),
  };
  const token =
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') +
    '.' +
    Buffer.from(
      JSON.stringify({ sub: A, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url') +
    '.test';
  const session = {
    access_token: token,
    refresh_token: 'test',
    token_type: 'bearer',
    expires_in: 3600,
    user,
  };
  function filterRows(rows, params) {
    return rows.filter((row) =>
      [...params].every(([key, value]) => {
        if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) return true;
        if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
        if (value.startsWith('neq.')) return String(row[key]) !== value.slice(4);
        if (value.startsWith('gt.')) return String(row[key]) > value.slice(3);
        if (value.startsWith('in.('))
          return value.slice(4, -1).split(',').includes(String(row[key]));
        return true;
      }),
    );
  }
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      method = req.method();
    if (url.origin === base && !url.pathname.startsWith('/api/')) return route.continue();
    const input = ['POST', 'PATCH', 'PUT'].includes(method) ? req.postDataJSON() : null;
    requests.push({ method, path: url.pathname, input });
    if (method === 'GET' && url.pathname.includes('/storage/v1/object/sign/')) {
      const { jsPDF } = require('jspdf');
      const pdf = new jsPDF(); pdf.text('Facture fictive - Boutique A - 100 EUR HT', 20, 30);
      pdf.addPage(); pdf.text('Page 2 - Detail des articles et montant HT', 20, 60); pdf.text('Article A : 100 EUR HT', 20, 80);
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(pdf.output('arraybuffer')) });
    }
    let body = {},
      status = 200;
    const responseHeaders = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
    if (url.pathname.includes('/auth/v1/token')) body = session;
    else if (url.pathname.includes('/auth/v1/user')) body = user;
    else if (url.pathname.includes('/auth/v1/logout')) {
      status = 204;
      body = null;
    } else if (url.pathname.includes('/auth/v1/recover')) body = {};
    else if (url.pathname.endsWith('/functions/v1/get-tracking')) body = {
      ok: true, expediteur: 'Camille E.', destination: { cp: '97400', ville: 'Saint-Denis' },
      colis: [{ ref: 'EXP-TEST-001', desc: 'Deux achats à regrouper', statut: 'attente_paiement', quoteNeedsReview: false, receivedCount: 2, preparedPackages: [{ L: 30, W: 20, H: 20, P: 5 }], outgoingParcelCount: 1, dateReception: '2026-09-08T08:00:00Z', dims: { L: 30, W: 20, H: 20, P: 5 } }],
    };
    else if (url.pathname.endsWith('/functions/v1/ocr-facture') && input?.action === 'resume') body = { success: true, extraction: null };
    else if (url.pathname.includes('/storage/v1/object/sign/'))
      body = { signedURL: '/storage/v1/object/sign/factures/test.pdf?token=fake' };
    else if (url.pathname.includes('/rest/v1/rpc/')) {
      const rpc = url.pathname.split('/').pop(),
        colis = tables.colis.find((c) => c.id === input?.p_colis_id);
      if (rpc === 'get_invoice_review_context') body = {
        invoices: tables.factures.filter(invoice => invoice.colis_id === input.p_colis_id).map(invoice => ({ factureId: invoice.id, reviewToken: 'fixture-review-' + invoice.id, extraction: null, draft: null, documentHash: null, duplicateCandidateIds: [] })),
        unlinkedLines: tables.lignes.filter(line => line.colis_id === input.p_colis_id && !line.facture_id),
      };
      else if (rpc === 'refresh_staff_work_actions') body = null;
      else if (rpc === 'save_preparation_measurements') {
        if (input.p_expected_updated_at !== colis.updated_at || input.p_expected_composition_version !== colis.preparation_composition_version) {
          status = 409; body = { code: '40001', message: 'Le dossier a changé. Votre brouillon est conservé.' };
        } else {
          const boxes = input.p_final_packages;
          Object.assign(colis, { final_packages: boxes, fin_l: Math.max(...boxes.map(b => +b.dimL)), fin_w: Math.max(...boxes.map(b => +b.dimW)), fin_h: Math.max(...boxes.map(b => +b.dimH)), fin_p: boxes.reduce((n,b) => n + +b.poids, 0), final_measurements_version: colis.preparation_composition_version, final_measurements_at: new Date().toISOString(), outgoing_parcel_count: boxes.length, updated_at: new Date().toISOString() });
          body = { colis };
        }
      }
      else if (rpc === 'save_quote') {
        const m = {
          devisTransport: 'devis_transport',
          devisOM: 'devis_om',
          devisOMR: 'devis_omr',
          devisTVA: 'devis_tva',
          devisTotal: 'devis_total',
          poidsFact: 'poids_facturable',
          avantOptimTransport: 'avant_optim_transport',
          avantOptimTotal: 'avant_optim_total',
          economie: 'economie',
          finL: 'fin_l',
          finW: 'fin_w',
          finH: 'fin_h',
          finP: 'fin_p',
          fraisDivers: 'frais_divers',
          finalPackages: 'final_packages',
        };
        for (const [key, value] of Object.entries(input.p_snapshot))
          if (m[key]) colis[m[key]] = value;
        colis.devis_snapshot = input.p_snapshot;
        colis.quote_version++;
        colis.updated_at = new Date().toISOString();
        body = { colis, quote: { version: colis.quote_version } };
      } else if (rpc === 'client_decision') {
        if (input.p_action === 'wait') {
          colis.attente_client_date = new Date().toISOString();
          colis.attente_client_motif = input.p_reason;
          colis.attente_client_until = input.p_wait_until;
        } else {
          colis.statut = input.p_action === 'approve' ? 'autorise' : 'refuse_client';
          colis.feu_vert = input.p_action === 'approve' ? 'autorise' : 'refuse';
        }
        colis.updated_at = new Date().toISOString();
        body = colis;
      } else if (rpc === 'acquire_colis_lock')
        body = { staff_id: A, staff_nom: 'Camille', locked_at: new Date().toISOString() };
      else if (rpc === 'release_colis_lock') body = true;
      else if (rpc === 'queue_message') {
        const message = {
          id: crypto.randomUUID(),
          colis_id: input.p_colis_id,
          texte: input.p_text,
          type: 'staff',
          auteur_nom: 'Camille',
          statut: input.p_canal === 'portal' ? 'en_attente' : 'envoi',
          canal: input.p_canal,
          created_at: new Date().toISOString(),
        };
        tables.messages.push(message);
        body = { message, outbox: { id: crypto.randomUUID() } };
      } else if (rpc === 'create_telegram_invitation')
        body = {
          token: 'one-use-token',
          url: 'https://t.me/Expedilebot?start=one-use-token',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        };
      else {
        status = 400;
        body = { message: 'Unexpected RPC ' + rpc };
      }
    } else if (url.pathname.includes('/rest/v1/')) {
      const table = url.pathname.split('/').pop();
      if (table === failTable) {
        status = 503;
        body = { message: 'Indisponibilité simulée' };
      } else {
        let rows = filterRows(
          tables[table.replace(/^client_(clients|colis)$/, '$1')] || [],
          url.searchParams,
        );
        if (method === 'POST') {
          const inputs = Array.isArray(input) ? input : [input];
          body = [];
          for (const item of inputs) {
            let row =
              table === 'message_templates'
                ? tables[table].find((r) => r.key === item.key && r.canal === item.canal)
                : table === 'app_settings'
                  ? tables[table].find((r) => r.key === item.key)
                  : null;
            if (row) Object.assign(row, item);
            else {
              row = {
                id: crypto.randomUUID(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...item,
              };
              (tables[table] ||= []).push(row);
            }
            body.push(row);
          }
        } else if (method === 'PATCH') {
          rows.forEach((row) =>
            Object.assign(row, input, { updated_at: new Date().toISOString() }),
          );
          body = rows;
        } else if (method === 'DELETE') {
          tables[table] = (tables[table] || []).filter((r) => !rows.includes(r));
          body = [];
        } else {
          const ordering = (url.searchParams.get('order') || '').split(',').filter(Boolean);
          if (ordering.length) rows.sort((a,b) => { for (const order of ordering) { const [key,direction] = order.split('.'); const compared = String(a[key] ?? '').localeCompare(String(b[key] ?? '')); if (compared) return direction === 'desc' ? -compared : compared; } return 0; });
          const offset = Number(url.searchParams.get('offset')) || 0;
          const limit = Number(url.searchParams.get('limit')) || rows.length;
          body = rows.slice(offset,offset + limit);
          responseHeaders['content-range'] = `${offset}-${Math.max(offset,offset + body.length - 1)}/${rows.length}`;
        }
        if (req.headers().accept?.includes('vnd.pgrst.object'))
          body = Array.isArray(body) ? body[0] || null : body;
      }
    } else {
      networkDenied.push(url.pathname);
      status = 400;
      body = { error: 'Blocked unexpected external request' };
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: status === 204 ? '' : JSON.stringify(body),
      headers: responseHeaders,
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const login = async () => {
    await page.goto(base);
    await page.getByLabel('Email', { exact: true }).fill('audit@example.test');
    await page.getByLabel('Mot de passe', { exact: true }).fill('test-password-long');
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector('#login-email') &&
        !document.body.innerText.includes('Chargement de votre espace'),
    );
  };
  return { context, page, tables, requests, errors, networkDenied, login };
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    let f = await setup(browser, 'client');
    await f.login();
    await f.page.waitForTimeout(400);
    assert.equal(
      await f.page.getByRole('heading', { name: 'Mon travail' }).count(),
      0,
      'Client must not enter staff dashboard despite forged metadata',
    );
    await f.page.screenshot({ path: path.join(output, 'client-home-desktop.png'), fullPage: true });
    await f.page.reload();
    await f.page.waitForTimeout(500);
    assert.equal(await f.page.locator('#login-email').count(), 0, 'Client session restored');
    await f.page.goto(base + '/colis/' + P);
    await f.page.getByRole('button', { name: 'Attendre d’autres achats' }).click();
    await f.page.locator('textarea').first().fill('Je souhaite regrouper une dernière commande.');
    await f.page.getByRole('button', { name: 'Enregistrer mon attente' }).click();
    await f.page.waitForFunction(
      () =>
        document.body.innerText.includes('attente est enregistrée') ||
        document.body.innerText.includes('attente demandée') ||
        document.body.innerText.includes('Attente demandée'),
    );
    assert.equal(
      f.tables.colis[0].attente_client_motif,
      'Je souhaite regrouper une dernière commande.',
    );
    f.tables.colis[0].attente_client_motif = 'Attente confirmée depuis un autre appareil.';
    await f.page.getByText('Mesures et fonctionnement', { exact: true }).click();
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await f.page.getByText('Attente confirmée depuis un autre appareil.').waitFor();
    assert.ok(f.requests.some((r) => r.path.endsWith('/client_colis')), 'Client refresh uses safe views');
    observations.push({ test: 'client-safe-view-refresh-on-focus', pass: true });
    await f.page.setViewportSize({ width: 390, height: 844 });
    await f.page.reload();
    await f.page.getByText('Mesures et fonctionnement', { exact: true }).click();
    await f.page.getByText('Attente confirmée depuis un autre appareil.').waitFor();
    await f.page.waitForTimeout(350);
    await f.page.screenshot({
      path: path.join(output, 'client-detail-mobile.png'),
      fullPage: false,
    });
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
    observations.push({ test: 'client-login-canonical-role-session-wait', pass: true });
    await f.context.close();

    f = await setup(browser, 'directeur');
    await f.login();
    await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
    await f.page.screenshot({
      path: path.join(output, 'staff-dashboard-desktop.png'),
      fullPage: true,
    });
    await f.page.reload();
    await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
    observations.push({ test: 'staff-session-restored', pass: true });
    await f.page.goto(base + '/settings');
    await f.page.getByRole('heading', { name: 'Départs' }).waitFor();
    assert.equal(
      f.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/envois')).length,
      0,
      'Settings cannot create departures on navigation',
    );
    await f.page.getByRole('button', { name: 'Messages', exact: true }).click();
    await f.page
      .locator('textarea')
      .first()
      .fill('Bonjour {{prenom}}, votre dossier {{ref}} est disponible.');
    await f.page.getByRole('button', { name: 'Sauvegarder', exact: true }).click();
    await f.page.getByRole('button', { name: /Sauvegardé/ }).waitFor();
    assert.equal(
      f.tables.message_templates[0].body,
      'Bonjour {{prenom}}, votre dossier {{ref}} est disponible.',
    );
    await f.page.reload();
    await f.page.getByRole('button', { name: 'Messages', exact: true }).click();
    assert.equal(
      await f.page.locator('textarea').first().inputValue(),
      f.tables.message_templates[0].body,
    );
    observations.push({ test: 'settings-no-implicit-writes-template-durable', pass: true });
    await f.page.goto(base + '/colis/' + P);
    await f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis' }).waitFor();
    await f.page.waitForTimeout(350);
    await f.page.screenshot({
      path: path.join(output, 'staff-detail-desktop.png'),
      fullPage: true,
    });
    const num = f.page.locator('input[type="number"]');
    const labels = await num.evaluateAll((inputs) =>
      inputs.map((i) => ({
        value: i.value,
        placeholder: i.placeholder,
        aria: i.getAttribute('aria-label'),
      })),
    );
    observations.push({ test: 'quote-fields', fields: labels });
    // The final weight is the only number input initially equal to 3 in the preparation form.
    const weight = f.page.locator('input[type="number"]').filter({ visible: true });
    const candidates = await weight.count();
    let changed = false;
    for (let i = 0; i < candidates; i++)
      if ((await weight.nth(i).inputValue()) === '3') {
        await weight.nth(i).fill('5');
        changed = true;
        break;
      }
    assert.ok(changed, 'Final weight field found');
    await f.page.getByRole('button', { name: 'Enregistrer les mesures de préparation' }).click();
    await f.page.waitForFunction(() => document.body.innerText.includes('Mesures enregistrées, même si les documents restent à vérifier.'));
    await f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis' }).click();
    await f.page.getByRole('button', { name: 'Envoyer le devis au client' }).waitFor();
    assert.equal(f.tables.colis[0].devis_transport, 50);
    assert.equal(Number(f.tables.colis[0].fin_p), 5);
    assert.equal(f.tables.colis[0].quote_version, 1);
    observations.push({
      test: 'quote-explicit-latest-weight-persisted',
      pass: true,
      total: f.tables.colis[0].devis_total,
    });
    await f.page.setViewportSize({ width: 390, height: 844 });
    await f.page.goto(base + '/colis?dossier=' + P);
    await f.page.getByRole('button', { name: 'Fermer le dossier', exact: true }).waitFor();
    await f.page.waitForTimeout(350);
    await f.page.screenshot({ path: path.join(output, 'staff-detail-mobile.png'), fullPage: true });
    const visibleControls = await f.page
      .locator('input,button,textarea,select')
      .evaluateAll((elements) =>
        elements
          .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
          .map((e) => ({
            text: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 35),
            x: e.getBoundingClientRect().x,
            right: e.getBoundingClientRect().right,
          }))
          .filter((r) => r.x < 0 || r.right > window.innerWidth + 1),
      );
    assert.deepEqual(visibleControls, [], 'No visible detail control clipped offscreen');
    await f.page.keyboard.press('Escape');
    await f.page.waitForTimeout(200);
    assert.ok(!f.page.url().includes(P), 'Escape closes mobile detail');
    observations.push({ test: 'mobile-detail-controls-and-escape', pass: true });
    await f.page.goto(base + '/');
    const openReception = () => f.page.getByRole('button', { name: /Nouveau colis|Réceptionner/ }).first().click();
    await openReception();
    const reception = f.page.getByRole('dialog', { name: 'Réceptionner des cartons', exact: true });
    await reception.waitFor();
    await f.page.waitForTimeout(100);
    await f.page.screenshot({ path: path.join(output, 'reception-mobile.png'), fullPage: true });
    await f.page.keyboard.press('Escape');
    assert.equal(await reception.count(), 0, 'Escape closes reception');
    await openReception();
    await reception.getByRole('button', { name: 'Fermer', exact: true }).click();
    assert.equal(await reception.count(), 0, 'Close button closes reception');
    await openReception();
    await f.page.mouse.click(2, 2);
    assert.equal(await reception.count(), 0, 'Backdrop closes reception');
    await openReception();
    await reception.getByPlaceholder('Rechercher un client…').fill('Camille');
    await reception.getByRole('button').filter({ hasText: 'Exemple Camille' }).first().click();
    const scroller = reception.locator('.overflow-y-auto').first();
    const scroll = await scroller.evaluate(e => {
      e.scrollTop = e.scrollHeight;
      return { top: e.scrollTop, height: e.clientHeight, total: e.scrollHeight };
    });
    assert.ok(scroll.top > 0 && scroll.total > scroll.height, 'Long reception form scrolls internally');
    const clipped = await reception.locator('input,button,textarea,select').evaluateAll(elements => elements
      .filter(e => e.getClientRects().length).map(e => ({ label: e.textContent.trim().slice(0, 40), x: e.getBoundingClientRect().x, right: e.getBoundingClientRect().right }))
      .filter(e => e.x < 0 || e.right > window.innerWidth + 1));
    assert.deepEqual(clipped, [], 'Long reception controls stay within mobile viewport');
    await f.page.screenshot({ path: path.join(output, 'reception-long-mobile.png') });
    await f.page.keyboard.press('Escape');
    observations.push({ test: 'reception-short-long-scroll-three-close-methods', pass: true });
    await f.page.goto(base + '/settings');
    await f.page.getByRole('heading', { name: 'Départs' }).waitFor();
    await f.page.waitForTimeout(350);
    const settingsNav = f.page.getByRole('navigation', { name: 'Paramètres', exact: true });
    const compressedTabs = await settingsNav.getByRole('button').evaluateAll(buttons => buttons.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent));
    assert.deepEqual(compressedTabs, [], 'Settings labels do not overlap on mobile');
    await settingsNav.getByRole('button').last().scrollIntoViewIfNeeded();
    assert.ok(await settingsNav.evaluate(e => e.scrollLeft > 0), 'All settings tabs remain reachable by horizontal scrolling');
    await settingsNav.evaluate(e => { e.scrollLeft = 0; });
    observations.push({ test: 'mobile-settings-labels-and-horizontal-navigation', pass: true });
    await f.page.screenshot({ path: path.join(output, 'settings-mobile.png'), fullPage: true });
    await f.page.setViewportSize({ width: 1440, height: 1000 });
    await f.page.goto(base + '/');
    await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
    await f.page.getByRole('button', { name: 'Passer en mode sombre', exact: true }).click();
    await f.page.waitForTimeout(350);
    await f.page.screenshot({ path: path.join(output, 'staff-dashboard-dark.png'), fullPage: true });
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
    assert.equal(f.networkDenied.length, 0, f.networkDenied.join('\n'));
    observations.push({ test: 'staff-no-runtime-errors', pass: true });
    await f.context.close();

    f = await setup(browser, 'client');
    await f.page.setViewportSize({ width: 390, height: 844 });
    await f.page.goto(base + '/suivi/fixture-public-token-123456789');
    await f.page.getByText('EXP-TEST-001', { exact: true }).waitFor();
    await f.page.getByText('Devis reçu — en attente de paiement', { exact: true }).waitFor();
    await f.page.getByText('Cartons et mesures', { exact: true }).click();
    await f.page.getByText('Colis sortant 1 · 30 × 20 × 20 cm · 5 kg', { exact: true }).waitFor();
    await f.page.getByText('Parcours du colis', { exact: true }).click();
    const timeline = f.page.getByRole('list', { name: 'Progression du colis' });
    assert.equal(await timeline.locator('li').count(), 8, 'All eight lifecycle phases remain available');
    assert.ok(await timeline.evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'Public timeline wraps without horizontal scrolling');
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Public tracking fits the mobile screen');
    await f.page.screenshot({ path: path.join(output, 'tracking-public-mobile.png'), fullPage: true });
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
    assert.equal(f.networkDenied.length, 0, f.networkDenied.join('\n'));
    observations.push({ test: 'public-tracking-payment-status-and-mobile-timeline', pass: true });
    await f.context.close();

    f = await setup(browser, 'directeur', { failTable: 'factures' });
    await f.login();
    await f.page.getByRole('alert').filter({ hasText: 'Chargement impossible' }).waitFor();
    assert.equal(await f.page.getByText('EXP-TEST-001', { exact: true }).count(), 0);
    observations.push({ test: 'failed-related-data-no-demo-fallback', pass: true });
    await f.context.close();
  } catch (error) {
    observations.push({ test: 'failure', message: error.stack });
    const failedPage = browser.contexts().flatMap(context => context.pages()).pop();
    if (failedPage) await failedPage.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (!process.exitCode) await fs.rm(path.join(output, 'failure.png'), { force: true });
    await fs.writeFile(
      path.join(output, 'browser-results.json'),
      JSON.stringify(observations, null, 2),
    );
    console.log(JSON.stringify(observations, null, 2));
  }
}
module.exports = { setup, fixtures, ids: { A, C, P, F, L, S }, base };
if (require.main === module) main();
