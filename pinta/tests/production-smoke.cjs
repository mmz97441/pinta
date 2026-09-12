/* Production smoke: public GET/HEAD only. Login failures are browser fixtures.
 * No dotenv, credentials, persisted browser profile, authenticated API or mutation.
 * Usage: node tests/production-smoke.cjs --url https://expedile.app
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const ID = '00000000-0000-4000-8000-000000000000';
const ROUTES = ['/', '/travail', '/equipe', '/conversations', '/departs', '/plus', '/colis', `/colis/${ID}`, '/clients', '/clients/new', `/clients/${ID}`, '/devis', '/settings', '/notifications', '/profil', '/password', '/suivi/pinta-smoke-invalid-token'];
const FIXTURE_EMAIL = 'production-smoke@example.invalid';
const FIXTURE_PASSWORD = 'fixture-never-sent-to-server';

function parseOrigin(value) {
  const url = new URL(value);
  assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Use an origin without credentials, query or path.');
  assert(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)), 'HTTPS required except for local fixtures.');
  return url.origin;
}

function allowPublicRead(method, address, origin) {
  const url = new URL(address);
  return ['GET', 'HEAD'].includes(method) && url.origin === origin && (
    ROUTES.includes(url.pathname) || /^\/assets\/[\w./-]+$/.test(url.pathname) ||
    ['/index.html', '/favicon.svg'].includes(url.pathname)
  );
}

async function run(options) {
  const origin = parseOrigin(options.url);
  const out = path.resolve(options.out || '/tmp/pinta-production-smoke');
  const report = { startedAt: new Date().toISOString(), origin, policy: 'Public HTTP GET only; browser login is intercepted locally; no real API verification.', checks: [], browser: options.httpOnly ? 'not-run' : 'pending' };
  await fs.mkdir(out, { recursive: true });
  let browser;
  try {
    let home = '';
    for (const route of ROUTES) {
      const response = await fetch(origin + route, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { accept: 'text/html' } });
      assert.equal(response.status, 200, `HTTP route ${route} must return 200`);
      assert.match(response.headers.get('content-type') || '', /text\/html/i, `HTML expected for ${route}`);
      const html = await response.text();
      assert.match(html, /<div\s+id=["']root["']/i, `React root missing for ${route}`);
      assert.match(html, /\/assets\/[^"']+\.js/i, `Built Vite entry missing for ${route}`);
      if (route === '/') home = html;
      report.checks.push({ check: 'spa-route', path: route, status: response.status });
    }
    const assets = [...new Set([...home.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1]))];
    assert(assets.some((asset) => asset.endsWith('.js')), 'At least one built JavaScript asset is required.');
    for (const asset of assets) {
      const url = new URL(asset, origin);
      assert.equal(url.origin, origin, 'Assets must be served from the application origin.');
      assert(allowPublicRead('GET', url.href, origin), 'Only allowlisted static asset paths may be fetched.');
      const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, `Asset ${url.pathname} must return 200`);
      assert.doesNotMatch(response.headers.get('content-type') || '', /text\/html/i, `Asset ${url.pathname} must not return SPA HTML`);
      await response.body?.cancel();
      report.checks.push({ check: 'asset', path: url.pathname, status: response.status });
    }
    const missing = '/assets/pinta-smoke-deliberately-missing.js';
    const missingResponse = await fetch(origin + missing, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    assert.equal(missingResponse.status, 404, 'An absent asset must return 404, not the SPA entry.');
    assert.doesNotMatch(await missingResponse.text(), /<div\s+id=["']root["']/i, 'Absent asset must not return the SPA document.');
    report.checks.push({ check: 'missing-asset', status: 404 });

    if (!options.httpOnly) {
      const { chromium } = require('playwright');
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
      let fixtureEnabled = false;
      let rejectedLogins = 0;
      let blockedRequests = 0;
      let pageErrors = 0;
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (fixtureEnabled && request.method() === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
          let body;
          try { body = request.postDataJSON(); } catch { /* Never forward malformed payloads. */ }
          if (body?.email === FIXTURE_EMAIL && body?.password === FIXTURE_PASSWORD) {
            rejectedLogins++;
            return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' }) });
          }
        }
        if (allowPublicRead(request.method(), request.url(), origin)) return route.continue();
        blockedRequests++;
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      page.on('pageerror', () => { pageErrors++; });
      page.setDefaultTimeout(15000);
      for (const route of ['/', `/colis/${ID}`, '/password']) {
        await page.goto(origin + route, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Connexion', exact: true }).waitFor();
        assert.equal(await page.getByRole('alert').count(), 0, 'Anonymous login screen must have no configuration or startup error.');
      }
      await page.goto(origin, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Connexion', exact: true }).waitFor();
      await page.screenshot({ path: path.join(out, 'login-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, 'Mobile login must not overflow horizontally.');
      await page.screenshot({ path: path.join(out, 'login-mobile.png'), fullPage: true });
      fixtureEnabled = true;
      await page.getByLabel('Email', { exact: true }).fill(FIXTURE_EMAIL);
      await page.getByLabel('Mot de passe', { exact: true }).fill(FIXTURE_PASSWORD);
      await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Email ou mot de passe incorrect.' }).waitFor();
      assert.equal(rejectedLogins, 1, 'Exactly one locally intercepted rejected login is expected.');
      assert.equal(pageErrors, 0, 'Browser runtime errors detected.');
      report.browser = { status: 'passed', fixtureLoginRejected: true, realLoginAttempts: 0, blockedRequests, runtimeErrors: pageErrors };
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    // Never log response bodies, request credentials, browser storage or environment.
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    await browser?.close();
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.status.toUpperCase()}: ${report.checks.length} HTTP checks; report ${path.join(out, 'report.json')}`);
    if (report.status === 'failed') console.error(report.error);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    assert.equal(parseOrigin('https://expedile.app'), 'https://expedile.app');
    assert.throws(() => parseOrigin('https://user:password@expedile.app'));
    assert.throws(() => parseOrigin('https://expedile.app?token=secret'));
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(allowPublicRead(method, 'https://expedile.app/', 'https://expedile.app'), false);
    assert.equal(allowPublicRead('GET', 'https://other.example/assets/app.js', 'https://expedile.app'), false);
    assert.equal(allowPublicRead('GET', 'https://expedile.app/api/delete', 'https://expedile.app'), false);
    assert.equal(allowPublicRead('GET', 'https://expedile.app/assets/app.js', 'https://expedile.app'), true);
    console.log('PASS: origin and network safety guards; no network request performed.');
  } else if (!args.includes('--url') || args.includes('--help')) {
    console.log('Usage: node tests/production-smoke.cjs --url https://expedile.app [--out /tmp/pinta-production-smoke] [--http-only]\n       node tests/production-smoke.cjs --self-test\nPublic reads only. Rejected login is a local browser fixture, never sent to Supabase.');
    if (!args.includes('--help')) process.exitCode = 1;
  } else {
    run({ url: args[args.indexOf('--url') + 1], out: args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined, httpOnly: args.includes('--http-only') }).catch(() => { console.error('Smoke could not start; check the origin and output directory.'); process.exitCode = 1; });
  }
}
