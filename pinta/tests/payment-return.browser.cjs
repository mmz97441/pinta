/* Payment-return checks use only fictional data. All remote requests are intercepted. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const AxeBuilder = require('@axe-core/playwright').default;
const { setup, base, ids } = require('./browser-regression.cjs');

const output = process.env.PINTA_PAYMENT_RETURN_OUT || '/tmp/pinta-payment-return';
const tokenA = 'a'.repeat(64);
const tokenB = 'b'.repeat(64);
const observations = [];

function payment(overrides = {}) {
  return {
    ok: true,
    status: 'paid',
    reference: 'EXP-TEST-001',
    amountCents: 5506,
    currency: 'EUR',
    paidAt: '2026-09-30T08:15:00Z',
    isLive: true,
    shipment: { status: 'paye', departureDate: null, departedAt: null, deliveredAt: null },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function prepare(browser, role = null) {
  const f = await setup(browser, role || 'client');
  f.page.setDefaultTimeout(10000);
  // A new tab shares an actual signed-in browser session. Closing the original
  // page prevents its normal refreshes from being confused with this public page.
  if (role) {
    await f.login();
    await f.page.close();
    f.page = await f.context.newPage();
    f.page.setDefaultTimeout(10000);
    f.page.on('pageerror', error => f.errors.push(error.message));
  }
  f.requests.length = 0;
  f.errors.length = 0;
  f.networkDenied.length = 0;
  f.paymentCalls = [];
  f.forbidden = [];
  f.businessBefore = structuredClone(f.tables);
  f.respond = async () => ({ body: payment() });
  await f.context.route('**/rest/v1/**', async route => {
    f.forbidden.push({ method: route.request().method(), path: new URL(route.request().url()).pathname });
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'The payment return must not load the staff/client workspace.' }) });
  });
  await f.context.route('**/functions/v1/get-payment-return', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    }
    const call = { method: request.method(), input: request.postDataJSON(), headers: request.headers() };
    f.paymentCalls.push(call);
    const reply = await f.respond(call, f.paymentCalls.length);
    await route.fulfill({
      status: reply.status || 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
      body: JSON.stringify(reply.body),
    }).catch(error => {
      // An abandoned token must abort its in-flight verification. Some browser
      // versions reject fulfillment of that deliberately cancelled request.
      if (!/closed|aborted|Invalid InterceptionId/i.test(error.message)) throw error;
    });
  });
  return f;
}

async function open(f, suffix = `?token=${tokenA}`) {
  await f.page.goto(`${base}/paiement/retour${suffix}`);
}

async function navigate(f, destination) {
  await f.page.evaluate(to => {
    history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, destination);
}

async function assertClientOnly(f) {
  assert.equal(await f.page.locator('aside').count(), 0, 'A payment return never renders the staff sidebar.');
  for (const name of [/Je m.en occupe/i, /Affecter.*départ/i, /Réceptionner des cartons/i, /Mon travail/i]) {
    assert.equal(await f.page.getByRole('button', { name }).count(), 0, `No staff command ${name}`);
    assert.equal(await f.page.getByRole('link', { name }).count(), 0, `No staff destination ${name}`);
  }
  assert.equal(await f.page.getByTestId('dossier-task-header').count(), 0);
  assert.deepEqual(f.forbidden, [], 'The payment return stays outside AppProvider and its business-data loading.');
  assert.deepEqual(f.errors, [], 'No unhandled browser error.');
  assert.deepEqual(f.networkDenied, [], 'No unexpected external requests.');
  assert.deepEqual(f.tables, f.businessBefore, 'Opening or retrying the return page must not mutate local business fixtures.');
  assert.equal(f.requests.some(request => !request.path.startsWith('/auth/v1/')), false,
    'No payment creation, staff action or customer notification is requested by this screen.');
  for (const call of f.paymentCalls) {
    assert.equal(call.method, 'POST');
    assert.equal(call.headers.referer, undefined, 'The private return token is not sent as an HTTP referrer.');
  }
}

async function confirmed(f, { test = false, reference = 'EXP-TEST-001' } = {}) {
  await f.page.getByRole('heading', { name: test ? 'Paiement de test confirmé' : 'Paiement reçu', exact: true }).waitFor();
  await f.page.getByText(`Envoi ${reference}`, { exact: true }).waitFor();
  assert.equal(await f.page.getByRole('button', { name: /^Payer/ }).count(), 0, 'A receipt never offers a second payment.');
}

async function verifyAccessibly(f) {
  const result = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(result.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) })), []);
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'The payment return fits the viewport.');
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, role = null) {
    if (process.env.PINTA_PAYMENT_RETURN_FILTER && !name.includes(process.env.PINTA_PAYMENT_RETURN_FILTER)) return;
    const f = await prepare(browser, role);
    try {
      await run(f);
      await assertClientOnly(f);
      observations.push({ test: name, pass: true, checks: f.paymentCalls.length });
    } catch (error) {
      process.exitCode = 1;
      observations.push({ test: name, pass: false, error: error.stack, calls: f.paymentCalls.map(({ input }) => input), forbidden: f.forbidden });
      await f.page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {});
      await fs.writeFile(`${output}/${name}-failure.txt`, await f.page.locator('body').innerText().catch(() => ''));
    } finally {
      await f.context.close();
    }
  }
  try {
    for (const role of [null, 'client', 'directeur']) {
      await scenario(`receipt-is-public-and-customer-only-with-${role || 'no'}-session`, async f => {
        await open(f); await confirmed(f);
        assert.deepEqual(f.paymentCalls.map(call => call.input), [{ token: tokenA }]);
        const text = await f.page.getByRole('main', { name: 'Retour de paiement' }).innerText();
        assert.match(text, /55,06\s*€\s*reçus/);
        assert.match(text, /Confirmé le 30 septembre 2026/);
        assert.match(text, /Vous n’avez rien d’autre à faire pour le paiement/);
        await f.page.getByRole('region', { name: 'Suite de votre envoi' }).getByRole('heading', { name: 'Prochaine étape : le départ de votre envoi', exact: true }).waitFor();
        assert.match(text, /La date apparaîtra ici dès qu’elle sera confirmée/);
        assert.equal(await f.page.getByRole('button', { name: /Se connecter/ }).count(), 0);
        assert.equal(f.requests.filter(request => request.path.includes('/auth/v1/token')).length, 0, 'A public return does not require signing in.');
        await f.page.screenshot({ path: `${output}/receipt-${role || 'anonymous'}.png`, fullPage: true });
      }, role);
    }

    await scenario('pending-returned-query-does-not-confirm-until-server-does', async f => {
      await f.page.clock.install();
      f.respond = async (_call, count) => ({ body: count === 1 ? payment({ status: 'pending', paidAt: null, shipment: { status: 'attente_paiement' } }) : payment() });
      await open(f, `?token=${tokenA}&payment=returned`);
      await f.page.getByRole('heading', { name: 'Confirmation du paiement en cours', exact: true }).waitFor();
      assert.equal(await f.page.getByRole('heading', { name: 'Paiement reçu', exact: true }).count(), 0);
      assert.equal(await f.page.getByRole('region', { name: 'Suite de votre envoi' }).count(), 0);
      await f.page.getByText(/Ne payez pas une seconde fois\./).waitFor();
      assert.equal(f.paymentCalls.length, 1);
      await f.page.clock.runFor(3100);
      await confirmed(f); assert.equal(f.paymentCalls.length, 2);
      await f.page.clock.runFor(20000);
      assert.equal(f.paymentCalls.length, 2, 'Automatic polling stops once payment is confirmed.');
    });

    await scenario('cancelled-query-never-overrides-server-confirmed-payment', async f => {
      await open(f, `?token=${tokenA}&payment=cancelled`); await confirmed(f);
      assert.equal(await f.page.getByRole('heading', { name: 'Paiement à vérifier', exact: true }).count(), 0);
      assert.deepEqual(f.paymentCalls[0].input, { token: tokenA }, 'A cancellation query is not sent as an instruction to the server.');
    });

    await scenario('cancelled-query-pending-explains-verification-without-false-cancellation', async f => {
      f.respond = async () => ({ body: payment({ status: 'pending', paidAt: null }) });
      await open(f, `?token=${tokenA}&payment=cancelled`);
      await f.page.getByRole('heading', { name: 'Paiement à vérifier', exact: true }).waitFor();
      await f.page.getByText('Vous êtes revenu de la page de paiement. Aucun règlement n’est encore confirmé ici. Nous vérifions son état.', { exact: true }).waitFor();
      assert.equal(await f.page.getByRole('heading', { name: 'Ce lien de paiement est fermé', exact: true }).count(), 0);
      assert.equal(await f.page.getByRole('region', { name: 'Suite de votre envoi' }).count(), 0);
    });

    await scenario('pending-polling-is-bounded-and-manual-retry-does-not-repay', async f => {
      await f.page.clock.install();
      let ready = false;
      f.respond = async () => ({ body: ready ? payment() : payment({ status: 'pending', paidAt: null }) });
      await open(f); await f.page.getByRole('heading', { name: 'Confirmation du paiement en cours', exact: true }).waitFor();
      for (let count = 2; count <= 6; count++) {
        await f.page.clock.runFor(3100);
        await f.page.waitForFunction(() => document.body.innerText.includes('Vérifier le paiement'));
        assert.equal(f.paymentCalls.length, count);
      }
      await f.page.getByText(/La confirmation prend plus de temps que prévu/).waitFor();
      await f.page.clock.runFor(30000); assert.equal(f.paymentCalls.length, 6);
      ready = true;
      await f.page.getByRole('button', { name: 'Vérifier le paiement', exact: true }).click();
      await confirmed(f); assert.equal(f.paymentCalls.length, 7);
    });

    await scenario('verification-service-error-has-safe-retry-and-no-false-receipt', async f => {
      f.respond = async (_call, count) => count === 1 ? { status: 503, body: { ok: false, error: 'Provider unavailable' } } : { body: payment() };
      await open(f); await f.page.getByRole('heading', { name: 'Vérification indisponible', exact: true }).waitFor();
      assert.equal(await f.page.getByRole('heading', { name: 'Paiement reçu', exact: true }).count(), 0);
      assert.equal(await f.page.getByText('Provider unavailable', { exact: true }).count(), 0, 'Provider internals are not shown to the customer.');
      await f.page.getByText(/Réessayez sans effectuer un nouveau paiement/).waitFor();
      await f.page.getByRole('button', { name: 'Réessayer la vérification', exact: true }).click();
      await confirmed(f); assert.equal(f.paymentCalls.length, 2);
    });

    for (const afterPending of [false, true]) {
      await scenario(`${afterPending ? 'pending-poll' : 'initial-verification'}-network-timeout-releases-retry-without-repayment`, async f => {
        await f.page.clock.install();
        const entered = deferred(), release = deferred();
        const blockedCall = afterPending ? 2 : 1;
        f.respond = async (_call, count) => {
          if (afterPending && count === 1) return { body: payment({ status: 'pending', paidAt: null }) };
          if (count === blockedCall) {
            entered.resolve(); await release.promise;
            return { body: payment({ reference: 'EXP-STALE-RESPONSE' }) };
          }
          return { body: payment() };
        };
        try {
          await open(f);
          if (afterPending) {
            await f.page.getByRole('heading', { name: 'Confirmation du paiement en cours', exact: true }).waitFor();
            await f.page.clock.runFor(3100);
          }
          await entered.promise;
          await f.page.clock.runFor(15100);
          await f.page.getByRole('heading', { name: 'Vérification indisponible', exact: true }).waitFor();
          assert.equal(await f.page.getByRole('heading', { name: 'Paiement reçu', exact: true }).count(), 0);
          const retry = f.page.getByRole('button', { name: 'Réessayer la vérification', exact: true });
          assert.equal(await retry.isEnabled(), true, 'The customer can recover from a stalled network request.');
          if (afterPending) assert.match(decodeURIComponent(await f.page.getByRole('link', { name: 'Contacter l’équipe', exact: true }).getAttribute('href')), /EXP-TEST-001/, 'The known shipment reference is retained for support.');
          await retry.click(); await confirmed(f);
          release.resolve(); await f.page.waitForTimeout(100);
          await confirmed(f);
          assert.equal(await f.page.getByText('Envoi EXP-STALE-RESPONSE', { exact: true }).count(), 0, 'The timed-out response cannot overwrite the successful retry.');
          assert.equal(f.paymentCalls.length, blockedCall + 1);
          assert.ok(f.paymentCalls.every(call => JSON.stringify(call.input) === JSON.stringify({ token: tokenA })));
        } finally { release.resolve(); }
      });
    }

    for (const [name, suffix] of [['missing', ''], ['invalid', '?token=not-a-valid-token']]) {
      await scenario(`${name}-token-stays-public-and-offers-help-without-fetch`, async f => {
        await open(f, suffix); await f.page.getByRole('heading', { name: 'Vérification indisponible', exact: true }).waitFor();
        await f.page.getByText('Ce lien ne permet pas de retrouver votre paiement. Contactez notre équipe.', { exact: true }).waitFor();
        assert.equal(f.paymentCalls.length, 0);
        assert.equal(await f.page.getByRole('button').count(), 0);
        assert.match(await f.page.getByRole('link', { name: 'Contacter l’équipe', exact: true }).getAttribute('href'), /^mailto:/);
      });
    }

    for (const status of [404, 410]) {
      await scenario(`unknown-or-expired-token-${status}-cannot-leak-a-receipt`, async f => {
        f.respond = async () => ({ status, body: { ok: false, error: 'Internal payment lookup detail must not be displayed' } });
        await open(f); await f.page.getByRole('heading', { name: 'Vérification indisponible', exact: true }).waitFor();
        assert.equal(await f.page.getByText('Envoi EXP-TEST-001', { exact: true }).count(), 0);
        assert.equal(await f.page.getByRole('button').count(), 0);
        assert.equal(await f.page.getByText(/Internal payment lookup/).count(), 0);
        await f.page.getByRole('link', { name: 'Contacter l’équipe', exact: true }).waitFor();
      });
    }

    await scenario('paid-with-unknown-mode-or-currency-fails-closed', async f => {
      f.respond = async () => ({ body: payment({ isLive: null }) });
      await open(f); await f.page.getByRole('heading', { name: 'Vérification indisponible', exact: true }).waitFor();
      assert.equal(await f.page.getByRole('heading', { name: 'Paiement reçu', exact: true }).count(), 0);
      assert.equal(await f.page.getByText('Envoi EXP-TEST-001', { exact: true }).count(), 0);
      f.respond = async () => ({ body: payment({ currency: 'USD' }) });
      await f.page.getByRole('button', { name: 'Réessayer la vérification', exact: true }).click();
      await f.page.getByRole('button', { name: 'Réessayer la vérification', exact: true }).waitFor();
      assert.equal(await f.page.getByRole('heading', { name: 'Paiement reçu', exact: true }).count(), 0);
      assert.equal(f.paymentCalls.length, 2);
    });

    await scenario('changing-token-discards-late-success-from-the-previous-shipment', async f => {
      const entered = deferred(), release = deferred(), completed = deferred();
      f.respond = async call => {
        if (call.input.token === tokenA) { entered.resolve(); await release.promise; completed.resolve(); return { body: payment() }; }
        return { body: payment({ reference: 'EXP-SECOND', amountCents: 8100 }) };
      };
      await open(f); await entered.promise;
      await navigate(f, `/paiement/retour?token=${tokenB}`);
      await confirmed(f, { reference: 'EXP-SECOND' });
      release.resolve(); await completed.promise;
      await f.page.waitForTimeout(100);
      await confirmed(f, { reference: 'EXP-SECOND' });
      assert.equal(await f.page.getByText('Envoi EXP-TEST-001', { exact: true }).count(), 0);
      assert.match(await f.page.getByRole('main').innerText(), /81,00\s*€/);
      assert.deepEqual(f.paymentCalls.map(call => call.input), [{ token: tokenA }, { token: tokenB }]);
    });

    await scenario('test-confirmation-never-claims-a-real-charge', async f => {
      f.respond = async () => ({ body: payment({ isLive: false }) });
      await open(f); await confirmed(f, { test: true });
      await f.page.getByText('La simulation de paiement a bien été enregistrée. Aucun règlement réel n’a été encaissé.', { exact: true }).waitFor();
      assert.match(await f.page.getByRole('main').innerText(), /55,06\s*€\s*simulés/);
      assert.equal(await f.page.getByRole('heading', { name: 'Paiement reçu', exact: true }).count(), 0);
    });

    await scenario('pending-test-mode-remains-explicit', async f => {
      f.respond = async () => ({ body: payment({ isLive: false, status: 'pending', paidAt: null }) });
      await open(f); await f.page.getByRole('heading', { name: 'Confirmation du paiement en cours', exact: true }).waitFor();
      await f.page.getByText('Mode test · aucun règlement réel', { exact: true }).waitFor();
    });

    await scenario('assigned-departure-is-distinct-from-delivery-and-can-refresh', async f => {
      f.respond = async () => ({ body: payment({ shipment: { status: 'paye', departureDate: '2030-10-04', departedAt: null, deliveredAt: null } }) });
      await open(f); await confirmed(f);
      await f.page.getByRole('heading', { name: 'Départ prévu le 4 octobre 2030', exact: true }).waitFor();
      await f.page.getByText(/Il s’agit de la date de départ, pas de livraison\./).waitFor();
      f.respond = async () => ({ body: payment({ shipment: { status: 'transit', departureDate: '2030-10-04', departedAt: '2030-10-04T10:00:00Z', deliveredAt: null } }) });
      await f.page.getByRole('button', { name: 'Actualiser le suivi', exact: true }).click();
      await f.page.getByRole('heading', { name: 'Votre envoi a pris le départ', exact: true }).waitFor();
      assert.equal(await f.page.getByRole('heading', { name: 'Départ prévu le 4 octobre 2030', exact: true }).count(), 0);
      f.respond = async () => ({ body: payment({ shipment: { status: 'livre', departureDate: '2030-10-04', departedAt: '2030-10-04T10:00:00Z', deliveredAt: '2030-10-09T10:00:00Z' } }) });
      await f.page.getByRole('button', { name: 'Actualiser le suivi', exact: true }).click();
      await f.page.getByRole('heading', { name: 'Votre envoi est livré', exact: true }).waitFor();
      await f.page.getByText('Livraison confirmée le 9 octobre 2030.', { exact: true }).waitFor();
      assert.equal(f.paymentCalls.length, 3);
    });

    for (const [status, heading] of [['superseded', 'Ce lien correspond à un ancien devis'], ['cancelled', 'Ce lien de paiement est fermé'], ['unavailable', 'Paiement à vérifier avec notre équipe']]) {
      await scenario(`server-${status}-does-not-present-a-paid-receipt`, async f => {
        f.respond = async () => ({ body: payment({ status, paidAt: null, amountCents: null }) });
        await open(f, `?token=${tokenA}&payment=returned`);
        await f.page.getByRole('heading', { name: heading, exact: true }).waitFor();
        assert.equal(await f.page.getByRole('heading', { name: 'Paiement reçu', exact: true }).count(), 0);
        assert.equal(await f.page.getByRole('region', { name: 'Suite de votre envoi' }).count(), 0);
        assert.doesNotMatch(await f.page.getByRole('main').innerText(), /NaN|undefined|null/);
        await f.page.getByRole('link', { name: 'Contacter l’équipe', exact: true }).waitFor();
      });
    }

    for (const role of ['client', 'directeur']) {
      await scenario(`legacy-return-with-${role}-session-uses-authenticated-receipt-only`, async f => {
        await f.page.goto(`${base}/colis/${ids.P}?payment=returned`); await confirmed(f);
        assert.deepEqual(f.paymentCalls.map(call => call.input), [{ colisId: ids.P }]);
        const bearer = f.paymentCalls[0].headers.authorization.split(' ')[1];
        assert.equal(JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url')).sub, ids.A, 'Legacy links carry the existing verified session, not an anonymous key.');
      }, role);
    }

    await scenario('legacy-malformed-dossier-id-stays-outside-staff-workspace', async f => {
      await f.page.goto(`${base}/colis/not-a-dossier-id?payment=returned`);
      await f.page.getByRole('heading', { name: 'Vérification indisponible', exact: true }).waitFor();
      assert.equal(f.paymentCalls.length, 0);
      assert.equal(await f.page.getByRole('button').count(), 0);
      await f.page.getByRole('link', { name: 'Contacter l’équipe', exact: true }).waitFor();
    }, 'directeur');

    await scenario('legacy-anonymous-login-stays-on-receipt-and-preserves-failed-input', async f => {
      await f.page.goto(`${base}/colis/${ids.P}?payment=cancelled`);
      await f.page.getByRole('heading', { name: 'Retrouver votre confirmation', exact: true }).waitFor();
      assert.equal(f.paymentCalls.length, 0);
      let failures = 1;
      await f.context.route('**/auth/v1/token**', async route => {
        if (!failures--) return route.fallback();
        f.requests.push({ path: '/auth/v1/token', method: 'POST', input: route.request().postDataJSON() });
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) });
      });
      await f.page.getByLabel('Email', { exact: true }).fill('audit@example.test');
      await f.page.getByLabel('Mot de passe', { exact: true }).fill('test-password-long');
      await f.page.getByRole('button', { name: 'Se connecter et vérifier', exact: true }).click();
      await f.page.getByRole('alert').filter({ hasText: 'Connexion impossible.' }).waitFor();
      assert.equal(await f.page.getByLabel('Email', { exact: true }).inputValue(), 'audit@example.test');
      assert.equal(await f.page.getByLabel('Mot de passe', { exact: true }).inputValue(), 'test-password-long');
      assert.equal(f.paymentCalls.length, 0);
      await f.page.getByRole('button', { name: 'Se connecter et vérifier', exact: true }).click();
      await confirmed(f);
      assert.match(f.page.url(), /payment=cancelled$/);
      assert.deepEqual(f.paymentCalls.map(call => call.input), [{ colisId: ids.P }]);
      assert.equal(await f.page.getByLabel('Mot de passe', { exact: true }).count(), 0);
    });

    await scenario('legacy-forbidden-account-offers-inline-account-change', async f => {
      f.respond = async (_call, count) => count === 1 ? { status: 403, body: { ok: false, error: 'Actor forbidden' } } : { body: payment() };
      await f.page.goto(`${base}/colis/${ids.P}?payment=returned`);
      await f.page.getByRole('heading', { name: 'Vérification indisponible', exact: true }).waitFor();
      assert.equal(await f.page.getByText('Envoi EXP-TEST-001', { exact: true }).count(), 0);
      await f.page.getByRole('button', { name: 'Utiliser un autre compte', exact: true }).click();
      await f.page.getByLabel('Email', { exact: true }).fill('audit@example.test');
      await f.page.getByLabel('Mot de passe', { exact: true }).fill('test-password-long');
      await f.page.getByRole('button', { name: 'Se connecter et vérifier', exact: true }).click();
      await confirmed(f); assert.equal(f.paymentCalls.length, 2);
    }, 'client');

    await scenario('paid-refresh-and-reload-never-create-payment-or-send-notifications', async f => {
      await open(f); await confirmed(f);
      await f.page.getByRole('button', { name: 'Actualiser le suivi', exact: true }).click();
      await f.page.getByRole('button', { name: 'Actualiser le suivi', exact: true }).waitFor();
      await f.page.reload(); await confirmed(f);
      assert.equal(f.paymentCalls.length, 3);
      assert.equal(await f.page.getByRole('button').count(), 1);
      assert.deepEqual(f.paymentCalls.map(call => call.input), Array(3).fill({ token: tokenA }));
    });

    for (const theme of ['light', 'dark']) {
      await scenario(`receipt-mobile-${theme}-is-readable-accessible-and-no-overflow`, async f => {
        await f.context.addInitScript(theme => localStorage.setItem('expedile-theme', theme), theme);
        await f.page.setViewportSize({ width: 390, height: 844 });
        await open(f); await confirmed(f);
        assert.equal(await f.page.locator('html').evaluate(element => element.classList.contains('dark')), theme === 'dark');
        await verifyAccessibly(f);
        await f.page.screenshot({ path: `${output}/receipt-mobile-${theme}.png`, fullPage: true });
      });
    }
  } finally {
    await browser.close();
    await fs.writeFile(`${output}/payment-return-results.json`, JSON.stringify(observations, null, 2));
    console.log(JSON.stringify(observations, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
