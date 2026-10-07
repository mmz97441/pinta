/* Client portal and public pages: loading, failures, navigation, notifications,
   profile, public tracking and payment return, in light and dark, at 390 and
   1440 px, with axe. Fictitious data only; every remote request is intercepted. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');

const output = process.env.PINTA_CLIENT_PORTAL_OUT || '/tmp/pinta-client-portal';
const only = (process.env.PINTA_CLIENT_PORTAL_ONLY || '').split(',').filter(Boolean);
const MATRIX = [[390, 'light'], [390, 'dark'], [1440, 'light'], [1440, 'dark']];
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, retry-after' };
const UNAVAILABLE = 'Nous n’arrivons pas à afficher vos expéditions pour le moment. Vos colis sont bien pris en charge : réessayez dans un instant.';
const QUOTED = '73333333-3333-4333-8333-333333333301';
const results = [];
const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
const minutesAgo = minutes => new Date(Date.now() - minutes * 60000).toISOString();

/* Contrast helpers, installed in every page of the context. */
const HELPERS = `
window.__portal = (() => {
  const parse = value => { const m = String(value).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const channel = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const luminance = rgb => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const over = (top, bottom) => { const a = top[3]; return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1]; };
  const ratio = (a, b) => { const l1 = luminance(a), l2 = luminance(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  /** Candidate backgrounds behind an element (every stop of a gradient). */
  function backgrounds(element) {
    const layers = [];
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      const image = style.backgroundImage;
      if (image && image.includes('gradient')) { layers.push({ stops: (image.match(/rgba?\\([^)]+\\)/g) || []).map(parse) }); break; }
      const color = parse(style.backgroundColor);
      if (color && color[3] > 0) { layers.push({ color }); if (color[3] >= 1) break; }
    }
    let bases = [[255, 255, 255, 1]];
    const last = layers[layers.length - 1];
    if (last && last.stops) { bases = last.stops.map(stop => over(stop, [255, 255, 255, 1])); layers.pop(); }
    return bases.map(baseColor => layers.reduceRight((below, layer) => over(layer.color, below), baseColor));
  }
  function contrast(element, colorElement = element) {
    const fg = parse(getComputedStyle(colorElement).color);
    const results = backgrounds(element).map(bg => ratio(over(fg, bg), bg));
    return Math.min(...results);
  }
  function backgroundLuminance(element) { return Math.max(...backgrounds(element).map(luminance)); }
  /** Typography of visible text: spaces before « : ; ! ? », inside « », straight apostrophes, « ... ». */
  function typography(root = document.body) {
    const issues = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue; const parent = walker.currentNode.parentElement;
      if (!text || !text.trim() || !parent || !parent.getClientRects().length || ['SCRIPT', 'STYLE'].includes(parent.tagName)) continue;
      if (/ [:;!?»]|« /.test(text) || /[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ]/.test(text) || /\\.\\.\\./.test(text)) issues.push(text.trim().slice(0, 90));
    }
    return issues;
  }
  return { contrast, backgroundLuminance, typography, parse, ratio, luminance };
})();`;

/** A browser whose contexts are touch devices (pointer: coarse). */
function touchBrowser(browser) {
  return new Proxy(browser, { get(target, prop) {
    if (prop === 'newContext') return (options = {}) => target.newContext({ ...options, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
  } });
}

async function session(browser, { role = 'client', width = 390, theme = 'light', login = true } = {}) {
  const f = await setup(browser, role);
  f.page.setDefaultTimeout(15000);
  f.width = width; f.theme = theme;
  await f.context.addInitScript(value => { try { localStorage.setItem('expedile-theme', value); } catch { /* storage blocked */ } }, theme);
  await f.context.addInitScript(HELPERS);
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  await f.page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  if (login) await f.login();
  return f;
}

/** 503 with an immediate Retry-After: the client's own retries end quickly. */
async function failing(f, pattern, { body = { message: 'Indisponibilité simulée' } } = {}) {
  const state = { on: true, calls: 0 };
  await f.context.route(pattern, route => {
    if (!state.on || route.request().method() === 'OPTIONS') return route.fallback();
    state.calls++;
    return route.fulfill({ status: 503, contentType: 'application/json', headers: { ...CORS, 'retry-after': '0' }, body: JSON.stringify(body) });
  });
  return state;
}

/** Holds matching requests until released. */
async function gated(f, pattern, predicate = () => true) {
  let release; const gate = new Promise(resolve => { release = resolve; });
  await f.context.route(pattern, async route => { if (predicate(route.request())) await gate; return route.fallback(); });
  return release;
}

async function axe(page, label) {
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target.join(' ')).slice(0, 4) })), [], `axe: ${label}`);
}
async function noOverflow(page, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal scroll`);
}
async function typographyOk(page, label, root = 'body') {
  const issues = await page.evaluate(selector => window.__portal.typography(document.querySelector(selector)), root);
  assert.deepEqual(issues, [], `${label}: French typography`);
}
const shot = (f, name, options = {}) => f.page.screenshot({ path: path.join(output, `${name}-${f.width}-${f.theme}.png`), fullPage: true, ...options });
const navLink = (f, name) => f.page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name });

async function scenario(name, run) {
  if (only.length && !only.some(prefix => name.startsWith(prefix))) return;
  const started = Date.now();
  let f;
  try {
    f = await run();
    if (f) {
      assert.deepEqual(f.errors, [], `${name}: no page error`);
      assert.deepEqual(f.networkDenied, [], `${name}: no unexpected request`);
      assert.equal(f.requests.some(request => request.path.endsWith('/queue_message')), false, `${name}: no message sent`);
    }
    results.push({ test: name, pass: true, ms: Date.now() - started });
  } catch (error) {
    process.exitCode = 1;
    results.push({ test: name, pass: false, error: error.stack });
    const page = f?.page || error.page;
    if (page) await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
  } finally {
    await f?.context.close().catch(() => {});
  }
}

/** Two published quotes, a pause and a delivered expedition around the fixture dossier. */
function multiFixture(f) {
  const [first] = f.tables.colis;
  const row = (id, ref, values) => ({ ...first, id, ref, ...values });
  f.tables.colis.push(
    row(QUOTED, 'EXP-TEST-003', { desc_contenu: 'Console de jeux', statut: 'devis_envoye', devis_brouillon: false, devis_envoye_le: '2026-10-02T09:30:00Z', devis_total: 87.5, devis_transport: 60, payplug_payment_url: 'https://secure.payplug.example/pay/fictif', quote_version: 2, updated_at: '2026-10-03T10:00:00Z' }),
    row('73333333-3333-4333-8333-333333333302', 'EXP-TEST-004', { desc_contenu: 'Pièces vélo, selle, guidon et deux chambres à air de rechange pour l’hiver', statut: 'en_preparation', feu_vert: 'autorise', updated_at: '2026-10-01T09:00:00Z' }),
    row('73333333-3333-4333-8333-333333333303', 'EXP-TEST-006', { desc_contenu: 'Cadeaux de Noël', attente_client_date: '2026-09-30T08:00:00Z', attente_client_motif: 'J’attends encore deux commandes', attente_client_until: '2026-10-20', updated_at: '2026-09-30T08:00:00Z' }),
  );
  f.tables.factures.push(...['73333333-3333-4333-8333-333333333301', '73333333-3333-4333-8333-333333333302', '73333333-3333-4333-8333-333333333303'].map((colisId, index) => ({ ...f.tables.factures[0], id: `84444444-4444-4444-8444-44444444440${index}`, colis_id: colisId })));
}

function notificationFixture(f) {
  f.tables.notifications = [
    { id: 'n-message', user_id: ids.A, titre: 'Un message pour EXP-TEST-001', msg: 'Bonjour Camille,\n\nVos 2 cartons sont bien arrivés à notre entrepôt de Paris.\n\nCarton 1 : 40 × 30 × 20 cm · 3,4 kg\nCarton 2 : 35 × 25 × 25 cm · 2,8 kg\n\nPouvez-vous nous confirmer que nous pouvons préparer l’envoi ? Vous pouvez aussi attendre d’autres achats.\n\nL’équipe Expedîle', lu: false, colis_id: ids.P, type: 'message', created_at: minutesAgo(50) },
    { id: 'n-carton', user_id: ids.A, titre: 'Un nouveau carton est arrivé', msg: 'Vous pouvez vérifier vos cartons et choisir de préparer ou de continuer à attendre.', lu: false, colis_id: ids.P, type: 'feu_vert', created_at: minutesAgo(5 * 60 + 2) },
    { id: 'n-paiement', user_id: ids.A, titre: 'Paiement reçu', msg: 'Votre paiement est enregistré.', lu: true, colis_id: ids.P, type: 'paiement', created_at: minutesAgo(4 * 24 * 60 + 3) },
    { id: 'n-bienvenue', user_id: ids.A, titre: 'Bienvenue sur Expedîle', msg: 'Votre espace est prêt.', lu: true, colis_id: null, type: null, created_at: '2026-09-01T08:00:00Z' },
  ];
}

const MANDATORY_COLUMNS = { prenom: 'prénom', nom: 'nom', email: 'email', tel: 'téléphone', adresse_ligne1: 'adresse', cp: 'code postal', ville: 'ville' };
/** update_client_profile, with the mandatory-details guard (SQLSTATE 23514) and
    the effect of invalidate_modern_quotes_on_client_change. `calls.refuse` forces one refusal. */
async function profileCommand(f) {
  const calls = [];
  await f.context.route('**/rest/v1/rpc/update_client_profile', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const input = route.request().postDataJSON(); calls.push(input);
    const client = f.tables.clients[0];
    const erased = Object.keys(MANDATORY_COLUMNS).find(column => String(client[column] ?? '').trim() && column in input.p_changes && !String(input.p_changes[column] ?? '').trim());
    const refusal = calls.refuse || (erased && { code: '23514', message: `Le ${MANDATORY_COLUMNS[erased]} est obligatoire pour un compte client : il ne peut pas être effacé.` });
    if (refusal) { calls.refuse = null; return route.fulfill({ status: 400, contentType: 'application/json', headers: CORS, body: JSON.stringify({ details: null, hint: null, ...refusal }) }); }
    const previous = String(client.cp || '').slice(0, 3);
    Object.assign(client, input.p_changes);
    if (String(client.cp || '').slice(0, 3) !== previous) for (const parcel of f.tables.colis.filter(item => item.client_id === client.id && !item.paiement_date && (item.devis_total != null || item.payplug_payment_url))) {
      Object.assign(parcel, { devis_total: null, devis_snapshot: null, devis_brouillon: true, payplug_payment_url: null, statut: ['devis_envoye', 'attente_paiement'].includes(parcel.statut) ? 'en_preparation' : parcel.statut, updated_at: new Date().toISOString() });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(client) });
  });
  return calls;
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    // 1. A failed load of the expeditions is never an empty account.
    for (const [width, theme] of MATRIX) await scenario(`dossiers-unavailable-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme, login: false });
      const colis = await failing(f, '**/rest/v1/client_colis*');
      await f.login();
      const page = f.page;
      const error = page.getByTestId('client-dossiers-error');
      await error.waitFor();
      assert.equal(normalize(await error.innerText()).includes(normalize(UNAVAILABLE)), true, 'reassuring message');
      for (const text of ['Préparer ma première expédition', 'Aucune action attendue de votre part.']) assert.equal(await page.getByText(text, { exact: true }).count(), 0, `home: no « ${text} »`);
      const retry = error.getByRole('button', { name: 'Réessayer', exact: true });
      const box = await retry.boundingBox(); assert.ok(box.height >= 44, 'retry: 44 px');
      await axe(page, `home error ${width} ${theme}`); await noOverflow(page, 'home error'); await typographyOk(page, 'home error', 'main');
      await shot(f, 'dossiers-unavailable-home');
      await navLink(f, /^Expéditions/).click();
      await page.getByRole('heading', { name: 'Mes expéditions', exact: true }).waitFor(); await error.waitFor();
      assert.equal(await page.getByRole('button', { name: /^À faire/ }).count(), 0, 'list: no empty filters');
      assert.equal(await page.getByText(/Aucune expédition ne correspond/).count(), 0, 'list: no empty state');
      await shot(f, 'dossiers-unavailable-list');
      await navLink(f, 'Profil').click();
      await page.getByRole('heading', { name: 'Mes coordonnées' }).waitFor(); await error.first().waitFor();
      const profileText = await page.locator('main').innerText();
      assert.doesNotMatch(profileText, /\b0 (dossier|expédition)/, 'profile: no « 0 »');
      assert.match(profileText, /Vos expéditions s’afficheront ici dès que possible\./);
      await shot(f, 'dossiers-unavailable-profile');
      await page.goto(`${base}/colis/${ids.P}`);
      await error.waitFor();
      assert.equal(await page.getByText('Expédition introuvable', { exact: true }).count(), 0, 'detail: not reported as missing');
      colis.on = false;
      await error.getByRole('button', { name: 'Réessayer', exact: true }).click();
      await page.getByRole('region', { name: 'État actuel et prochaine étape', exact: true }).waitFor();
      await navLink(f, 'Accueil').click();
      await page.getByRole('button').filter({ hasText: 'EXP-TEST-001' }).waitFor();
      assert.equal(await error.count(), 0, 'recovered after retry');
      return f;
    });

    // 2. Secondary reads never hide the expeditions; each failure stays in its own area.
    for (const [width, theme] of [[390, 'dark'], [1440, 'light']]) await scenario(`secondary-failures-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme, login: false });
      const notifications = await failing(f, '**/rest/v1/notifications*');
      for (const table of ['tarifs', 'envois', 'app_settings', 'message_templates', 'categories']) await failing(f, `**/rest/v1/${table}*`);
      await f.login();
      const page = f.page;
      await page.getByRole('button').filter({ hasText: 'EXP-TEST-001' }).waitFor();
      await page.getByRole('heading', { name: 'À faire par vous', exact: true }).waitFor();
      assert.equal(await page.getByTestId('client-dossiers-error').count(), 0, 'dossiers shown');
      assert.equal(await page.getByRole('alert').filter({ hasText: /Chargement impossible|Indisponibilité/ }).count(), 0, 'no technical banner');
      await navLink(f, /^Notifications/).click();
      const alert = page.getByRole('alert').filter({ hasText: 'Nous n’arrivons pas à afficher vos notifications pour le moment.' });
      await alert.waitFor();
      assert.doesNotMatch(await alert.innerText(), /Indisponibilité simulée/, 'no technical detail');
      await axe(page, `notifications error ${width} ${theme}`);
      await shot(f, 'secondary-failures-notifications');
      notifications.on = false;
      await alert.getByRole('button', { name: 'Réessayer', exact: true }).click();
      await page.getByRole('button', { name: /Bienvenue/ }).waitFor();
      assert.equal(await alert.count(), 0, 'notifications recovered');
      return f;
    });

    // 3. The staff loading keeps its all-or-nothing behaviour.
    await scenario('staff-loading-unchanged', async () => {
      const f = await session(browser, { role: 'directeur', width: 1440, theme: 'light', login: false });
      await failing(f, '**/rest/v1/notifications*');
      await f.page.goto(base);
      await f.page.getByLabel('Email', { exact: true }).fill('audit@example.test');
      await f.page.getByLabel('Mot de passe', { exact: true }).fill('test-password-long');
      await f.page.getByRole('button', { name: 'Se connecter', exact: true }).click();
      await f.page.getByRole('alert').filter({ hasText: 'Chargement impossible' }).waitFor();
      await f.page.getByRole('button', { name: 'Réessayer', exact: true }).waitFor();
      return f;
    });

    // 4. Hovered surfaces stay in the theme.
    for (const theme of ['dark', 'light']) await scenario(`hover-${theme}`, async () => {
      const f = await session(browser, { width: 1440, theme });
      const page = f.page;
      const card = page.getByRole('button').filter({ hasText: 'EXP-TEST-001' });
      await card.hover(); await page.waitForTimeout(250);
      const values = await card.evaluate(element => { const spans = element.querySelectorAll('span.block'); return { title: window.__portal.contrast(spans[0]), desc: window.__portal.contrast(spans[1]), bg: window.__portal.backgroundLuminance(element) }; });
      assert.ok(values.title >= 4.5 && values.desc >= 4.5, `hovered card text ${JSON.stringify(values)}`);
      if (theme === 'dark') assert.ok(values.bg < 0.2, `hovered card stays dark ${values.bg}`);
      await card.click();
      const back = page.getByRole('button', { name: /^Retour à mes (colis|expéditions)$/ });
      await back.hover(); await page.waitForTimeout(250);
      const backValues = await back.evaluate(element => ({ icon: window.__portal.contrast(element, element.querySelector('svg')), bg: window.__portal.backgroundLuminance(element) }));
      assert.ok(backValues.icon >= 3, `hovered back button icon ${JSON.stringify(backValues)}`);
      if (theme === 'dark') assert.ok(backValues.bg < 0.2, `hovered back button stays dark ${backValues.bg}`);
      return f;
    });

    // 5. The onboarding guide covers the whole screen from the profile.
    for (const [width, theme] of MATRIX) await scenario(`guide-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme });
      const page = f.page;
      await page.goto(`${base}/profil`);
      const open = page.getByRole('button', { name: 'Revoir le guide de démarrage' });
      const overlay = page.getByTestId('onboarding-overlay');
      const dialog = page.getByRole('dialog');
      for (const close of ['escape', 'skip', 'backdrop']) {
        await open.scrollIntoViewIfNeeded(); await open.click(); await dialog.waitFor();
        const geometry = await overlay.evaluate(element => {
          const r = element.getBoundingClientRect(); const d = element.querySelector('[role="dialog"]').getBoundingClientRect();
          const covered = (x, y) => element.contains(document.elementFromPoint(x, y));
          const visible = name => { const button = [...element.querySelectorAll('button')].find(item => item.textContent.trim().startsWith(name)); const b = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)); };
          return { parent: element.parentElement === document.body, rect: [r.left, r.top, r.width, r.height].map(Math.round), viewport: [0, 0, document.documentElement.clientWidth, innerHeight], dialogInside: d.top >= 0 && d.bottom <= innerHeight + 1, header: covered(innerWidth / 2, 20), bottom: covered(innerWidth / 2, innerHeight - 10), skip: visible('Passer'), next: visible('Suivant') };
        });
        assert.equal(geometry.parent, true, 'rendered on document.body');
        assert.deepEqual(geometry.rect, geometry.viewport, 'overlay sized to the viewport');
        assert.ok(geometry.dialogInside && geometry.header && geometry.bottom && geometry.skip && geometry.next, JSON.stringify(geometry));
        if (close === 'escape') {
          for (const step of [1, 2, 3]) {
            await axe(page, `guide step ${step} ${width} ${theme}`);
            if (step === 1) await shot(f, 'guide', { fullPage: false });
            if (step < 3) await dialog.getByRole('button', { name: /^Suivant/ }).click();
          }
          await page.keyboard.press('Escape');
        } else if (close === 'skip') await dialog.getByRole('button', { name: /^Passer/ }).click();
        else await page.mouse.click(5, 5);
        await dialog.waitFor({ state: 'detached' });
      }
      return f;
    });

    // 6. Contrast of the identity marks and accessible pages, both themes and widths.
    for (const [width, theme] of MATRIX) await scenario(`pages-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme, login: false });
      multiFixture(f); notificationFixture(f);
      await f.login();
      const page = f.page;
      const toggle = page.getByRole('button', { name: theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre' });
      const header = await page.evaluate(() => { const toggleButton = document.querySelector('header button[aria-label^="Passer en mode"]'); const avatar = document.querySelector('header a[aria-label^="Mon profil"] span[aria-hidden="true"]'); return { toggle: window.__portal.contrast(toggleButton, toggleButton.querySelector('svg')), avatar: window.__portal.contrast(avatar), initial: avatar.textContent.trim() }; });
      assert.ok(header.toggle >= 3, `theme toggle icon ${header.toggle}`);
      assert.ok(header.avatar >= 4.5, `header avatar ${header.avatar}`);
      assert.equal(header.initial, 'C', 'initial of the first name');
      assert.equal(await toggle.count(), 1);
      for (const [route, heading] of [['/', 'Bonjour Camille'], ['/colis', 'Mes expéditions'], ['/notifications', 'Notifications'], ['/profil', 'Camille Exemple']]) {
        if (route === '/') await navLink(f, 'Accueil').click(); else await navLink(f, route === '/colis' ? /^Expéditions/ : route === '/notifications' ? /^Notifications/ : 'Profil').click();
        await page.getByRole('heading', { level: 1, name: heading, exact: true }).waitFor();
        await page.waitForTimeout(150);
        await axe(page, `${route} ${width} ${theme}`); await noOverflow(page, route);
        // Notification texts are written by the server; the page's own wording is checked on its empty state.
        if (route !== '/notifications') {
          await typographyOk(page, route, 'main');
          assert.doesNotMatch(await page.locator('main').innerText(), /\bdossiers?\b/i, `${route}: « expédition » vocabulary`);
        }
        await shot(f, `page-${route === '/' ? 'home' : route.slice(1)}`);
      }
      const avatar = await page.evaluate(() => { const element = document.querySelector('main header [aria-hidden="true"]'); return { ratio: window.__portal.contrast(element), text: element.textContent.trim() }; });
      assert.ok(avatar.ratio >= 4.5, `profile avatar ${avatar.ratio}`); assert.equal(avatar.text, 'C');
      await page.getByText(/expéditions en cours/).first().waitFor();
      // A quote of « Mes documents » opens inside the portal: a chevron, not an external-link icon.
      await page.getByText('Mes documents', { exact: true }).click();
      const quoteRow = page.getByRole('button').filter({ hasText: 'EXP-TEST-003' }).last();
      await quoteRow.waitFor();
      assert.deepEqual(await quoteRow.evaluate(element => [...element.querySelectorAll('svg')].map(svg => svg.getAttribute('class')).filter(name => /chevron-right|external-link/.test(name)).map(name => name.match(/lucide-(chevron-right|external-link)/)[1])), ['chevron-right']);
      return f;
    });

    // 7. Notifications: kept line breaks, readable times, a clear unread state.
    for (const [width, theme] of MATRIX) await scenario(`notifications-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme, login: false });
      notificationFixture(f);
      await f.login();
      const page = f.page;
      await navLink(f, /^Notifications/).click();
      await page.getByRole('heading', { level: 1, name: 'Notifications', exact: true }).waitFor();
      await page.getByText('2 non lues', { exact: true }).waitFor();
      const items = page.locator('li.notification-item');
      assert.equal(await items.count(), 4);
      const long = items.filter({ hasText: 'Un message pour EXP-TEST-001' });
      const message = long.locator('p[id$="-message"]');
      assert.equal(await message.evaluate(element => getComputedStyle(element).whiteSpace), 'pre-line');
      assert.ok(await message.evaluate(element => element.scrollHeight > element.clientHeight + 1), 'long message clamped');
      assert.equal(await items.filter({ hasText: 'Paiement reçu' }).getByRole('button', { name: 'Lire la suite' }).count(), 0, 'short message: no « Lire la suite »');
      const more = long.getByRole('button', { name: 'Lire la suite' });
      await more.click();
      await long.getByRole('button', { name: 'Réduire' }).waitFor();
      assert.ok(await message.evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'whole message readable');
      assert.match(await message.innerText(), /L’équipe Expedîle$/);
      const times = await items.locator('time').allInnerTexts();
      assert.deepEqual(times.slice(0, 3), ['il y a 50\u00a0min', 'il y a 5\u00a0h', 'il y a 4\u00a0j'], `relative times ${JSON.stringify(times)}`);
      const unread = items.first();
      const marks = async () => unread.evaluate(element => { const label = [...element.querySelectorAll('span')].find(item => item.textContent.trim() === 'Nouveau'); const dot = label.querySelector('span'); return { shadow: getComputedStyle(element).boxShadow, label: window.__portal.contrast(label), dot: window.__portal.ratio(window.__portal.parse(getComputedStyle(dot).backgroundColor), window.__portal.parse(getComputedStyle(element).backgroundColor)), bg: getComputedStyle(element).backgroundColor }; });
      const before = await marks();
      await unread.hover(); await page.waitForTimeout(250);
      const during = await marks();
      for (const state of [before, during]) { assert.match(state.shadow, /inset/, 'accent kept'); assert.ok(state.label >= 4.5 && state.dot >= 3, `unread marks ${JSON.stringify(state)}`); }
      const readBackground = await items.filter({ hasText: 'Paiement reçu' }).evaluate(element => getComputedStyle(element).backgroundColor);
      assert.notEqual(before.bg, readBackground, 'unread background differs from read');
      const icons = await items.evaluateAll(nodes => nodes.map(node => { const tile = node.querySelector('span[aria-hidden="true"]'); const svg = tile.querySelector('svg'); return { color: getComputedStyle(svg).color, ratio: window.__portal.contrast(tile, svg) }; }));
      for (const icon of icons) { assert.notEqual(icon.color, 'rgb(124, 58, 237)', 'no violet'); assert.ok(icon.ratio >= 3, `icon tile ${JSON.stringify(icon)}`); }
      // Notification texts come from the server; the page's own wording is checked on the empty state.
      await axe(page, `notifications ${width} ${theme}`); await noOverflow(page, 'notifications');
      await shot(f, 'notifications');
      await long.getByRole('button', { name: /Un message pour EXP-TEST-001/ }).click();
      await page.waitForURL(url => url.pathname === `/colis/${ids.P}` && url.searchParams.get('panel') === 'messages' && url.searchParams.get('notification') === 'n-message');
      return f;
    });
    for (const [width, theme] of [[390, 'light'], [1440, 'dark']]) await scenario(`notifications-empty-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme, login: false });
      f.tables.notifications = [];
      await f.login();
      const page = f.page;
      await navLink(f, 'Notifications').click();
      await page.getByRole('heading', { name: 'Aucune notification pour le moment', exact: true }).waitFor();
      await axe(page, `notifications empty ${width} ${theme}`); await typographyOk(page, 'notifications empty', 'main');
      await shot(f, 'notifications-empty');
      await page.getByRole('link', { name: 'Recevoir aussi mes nouvelles sur Telegram' }).click();
      await page.waitForURL(url => url.pathname === '/profil' && url.hash === '#telegram-title');
      const heading = page.getByRole('heading', { name: 'Recevoir mes nouvelles sur Telegram' });
      await heading.waitFor();
      assert.ok(await heading.evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'Telegram section in view');
      f.tables.clients[0].telegram_chat_id = 'fixture-chat';
      await page.reload(); await page.getByRole('heading', { name: 'Mes coordonnées' }).waitFor();
      await navLink(f, 'Notifications').click();
      await page.getByRole('link', { name: 'Voir mes expéditions' }).waitFor();
      return f;
    });

    // 8. Profile: the error under its field, client wording, territory change confirmed.
    for (const [width, theme] of MATRIX) await scenario(`profile-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme, login: false });
      multiFixture(f);
      f.tables.clients[0].tel = '0692 12 34 56';
      const calls = await profileCommand(f);
      await f.login();
      const page = f.page;
      await navLink(f, 'Profil').click();
      await page.getByRole('heading', { level: 1, name: 'Camille Exemple', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Modifier', exact: true }).click();
      const save = page.getByRole('button', { name: 'Enregistrer', exact: true });
      /** The message under the field, the field focused and described by it. */
      const fieldError = async (key, pattern) => {
        const message = page.locator(`#profile-${key}-error`);
        await message.waitFor();
        assert.match(normalize(await message.innerText()), pattern);
        const placement = await page.evaluate(id => { const input = document.getElementById(`profile-${id}`).getBoundingClientRect(); const text = document.getElementById(`profile-${id}-error`).getBoundingClientRect(); return { below: text.top >= input.bottom - 1 && text.top - input.bottom < 40, inView: text.top >= 0 && text.bottom <= innerHeight, focused: document.activeElement?.id, invalid: document.getElementById(`profile-${id}`).getAttribute('aria-invalid'), describedBy: document.getElementById(`profile-${id}`).getAttribute('aria-describedby') }; }, key);
        assert.deepEqual(placement, { below: true, inView: true, focused: `profile-${key}`, invalid: 'true', describedBy: `profile-${key}-error` }, key);
      };
      const cp = page.locator('#profile-cp');
      await cp.fill('974'); await save.click();
      await fieldError('cp', /code postal à cinq chiffres d’une destination desservie : Guadeloupe \(971\), Martinique \(972\), La Réunion \(974\) ou Mayotte \(976\)\./);
      await axe(page, `profile invalid ${width} ${theme}`);
      await shot(f, 'profile-invalid', { fullPage: false });
      await cp.fill('75001'); await save.click();
      await fieldError('cp', /destination desservie/);
      await cp.fill('97410');
      // A filled mandatory detail cannot be emptied; the phone needs nine digits.
      await page.locator('#profile-prenom').fill(''); await save.click();
      await fieldError('prenom', /^Votre prénom ne peut pas être effacé : il est nécessaire à vos expéditions\.$/);
      await page.locator('#profile-prenom').fill('Camille');
      await page.locator('#profile-ville').fill(''); await save.click();
      await fieldError('ville', /^Votre ville ne peut pas être effacée : elle est nécessaire à la livraison\.$/);
      await page.locator('#profile-ville').fill('Saint-Pierre');
      await page.locator('#profile-tel').fill('0692 12'); await save.click();
      await fieldError('tel', /au moins 9 chiffres/);
      await page.locator('#profile-tel').fill('+262 692 12 34 56');
      assert.equal(calls.length, 0, 'nothing sent while a field is refused');
      // A refusal of the server (SQLSTATE 23514) is shown under its field, never as a success.
      calls.refuse = { code: '23514', message: 'Le téléphone est obligatoire pour un compte client : il ne peut pas être effacé.' };
      await save.click();
      await fieldError('tel', /^Votre téléphone ne peut pas être effacé : il est nécessaire à la livraison\.$/);
      await page.getByRole('alert').filter({ hasText: 'Vos coordonnées n’ont pas été enregistrées.' }).waitFor();
      assert.equal(await page.getByText('Vos informations sont enregistrées.').count(), 0, 'no success after a refusal');
      assert.equal(await save.isVisible(), true, 'the form stays open');
      assert.equal(calls.length, 1);
      await save.click();
      await page.getByRole('status').filter({ hasText: 'Vos informations sont enregistrées.' }).waitFor();
      assert.equal(await page.getByText('Client mis à jour').count(), 0, 'no staff wording');
      assert.equal(calls.length, 2); assert.deepEqual([calls[1].p_changes.cp, calls[1].p_changes.ville, calls[1].p_changes.tel], ['97410', 'Saint-Pierre', '+262 692 12 34 56']);
      // An account created before the rule: the missing phone is asked for, not « erased ».
      f.tables.clients[0].tel = null;
      await page.reload(); await page.getByRole('heading', { name: 'Mes coordonnées' }).waitFor();
      // The read view says what is missing and opens the form, instead of a dry « Non renseigné ».
      assert.equal(await page.getByText('Non renseigné', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Téléphone à compléter : il est nécessaire à la livraison.', exact: true }).click(); await save.click();
      await fieldError('tel', /^Indiquez un téléphone, mobile ou fixe : il est nécessaire à la livraison\.$/);
      await page.locator('#profile-tel').fill('0262 12 34 56');
      // A new territory withdraws the open quote: the client confirms it knowingly.
      await cp.fill('97200');
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const text = normalize(await dialog.innerText());
      for (const part of ['Changer la destination de votre envoi ?', 'La Réunion → Martinique', 'EXP-TEST-003', 'retiré avec son lien de paiement', 'un devis mis à jour', 'Aucun règlement n’est demandé d’ici là.']) assert.ok(text.includes(part), `confirmation mentions « ${part} »: ${text}`);
      await axe(page, `territory confirmation ${width} ${theme}`);
      await shot(f, 'profile-territory', { fullPage: false });
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
      assert.equal(calls.length, 2, 'cancel saves nothing');
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await dialog.getByRole('button', { name: 'Confirmer ma nouvelle adresse', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Vos informations sont enregistrées.' }).waitFor();
      assert.equal(calls.length, 3); assert.equal(calls[2].p_changes.cp, '97200');
      await page.getByText(/Martinique/).first().waitFor();
      await navLink(f, 'Accueil').click();
      const card = page.getByRole('button').filter({ hasText: 'EXP-TEST-003' });
      await card.filter({ hasText: 'Devis en cours de révision' }).waitFor();
      assert.equal(await card.filter({ hasText: /Devis\s*:/ }).count(), 0, 'withdrawn quote no longer shown');
      return f;
    });

    // 9. Titles, headings, plurals and initials.
    for (const [width, theme] of [[390, 'light'], [1440, 'dark']]) await scenario(`structure-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme, login: false });
      const page = f.page;
      await page.goto(base);
      await page.getByRole('heading', { level: 1, name: 'Connexion', exact: true }).waitFor();
      assert.equal(await page.title(), 'Connexion — Expedîle');
      await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click();
      await page.getByRole('heading', { level: 1, name: 'Mot de passe oublié', exact: true }).waitFor();
      assert.equal(await page.title(), 'Mot de passe oublié — Expedîle');
      await page.getByRole('button', { name: 'Retour à la connexion' }).click();
      await f.login();
      const titles = [['/colis', /^Expéditions/, 'Mes expéditions — Expedîle'], ['/notifications', /^Notifications/, 'Notifications — Expedîle'], ['/profil', 'Profil', 'Mon profil — Expedîle'], ['/', 'Accueil', 'Mon espace — Expedîle']];
      for (const [route, label, title] of titles) {
        await navLink(f, label).click(); await page.waitForURL(url => url.pathname === route);
        await page.waitForFunction(expected => document.title === expected, title);
      }
      assert.equal(new Set(titles.map(item => item[2])).size, titles.length, 'one title per screen');
      await navLink(f, 'Profil').click();
      await page.getByRole('heading', { level: 1, name: 'Camille Exemple', exact: true }).waitFor();
      assert.equal(await navLink(f, 'Expéditions (1 action attendue)').count(), 1, 'singular action');
      assert.equal(await navLink(f, 'Notifications (1 non lue)').count(), 1, 'singular unread');
      await page.getByRole('link', { name: 'Mon profil · Camille', exact: true }).getByText('C', { exact: true }).waitFor();
      await page.goto(`${base}/colis/${ids.P}`);
      await page.getByRole('region', { name: 'État actuel et prochaine étape', exact: true }).waitFor();
      assert.equal(await page.title(), 'Expédition EXP-TEST-001 — Expedîle');
      await page.goto(`${base}/password`);
      await page.getByRole('heading', { level: 1, name: 'Modifier mon mot de passe', exact: true }).waitFor();
      assert.equal(await page.title(), 'Mot de passe — Expedîle');
      await axe(page, `password ${width} ${theme}`);
      f.tables.notifications.push({ ...f.tables.notifications[0], id: 'n-second', titre: 'Deuxième nouvelle' });
      f.tables.colis.push({ ...f.tables.colis[0], id: '73333333-3333-4333-8333-333333333399', ref: 'EXP-TEST-099' });
      await page.goto(`${base}/notifications`);
      await page.getByRole('heading', { level: 1, name: 'Notifications', exact: true }).waitFor();
      assert.equal(await navLink(f, 'Notifications (2 non lues)').count(), 1, 'plural unread');
      assert.equal(await navLink(f, 'Expéditions (2 actions attendues)').count(), 1, 'plural actions');
      await page.goto(`${base}/colis/aaaaaaaa-0000-4000-8000-000000000999`);
      await page.getByRole('heading', { level: 1, name: 'Expédition introuvable', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Retour à mes expéditions' }).click();
      await page.waitForURL(url => url.pathname === '/colis');
      return f;
    });

    // 10. Skeletons shaped like each screen; an opened expedition stays displayed while it refreshes.
    for (const [width, theme] of [[390, 'light'], [1440, 'dark']]) await scenario(`loading-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme });
      const page = f.page;
      for (const [route, view] of [['/', 'home'], ['/colis', 'list'], ['/profil', 'profile'], ['/notifications', 'notifications']]) {
        const release = await gated(f, '**/rest/v1/client_colis*');
        await page.goto(base + route, { waitUntil: 'commit' });
        const skeleton = page.getByTestId(`client-skeleton-${view}`);
        await skeleton.waitFor();
        assert.equal(await page.locator('main .grid-cols-2 .h-28').count(), 0, `${route}: not the generic grid`);
        assert.equal(await page.getByRole('navigation', { name: 'Navigation principale' }).count(), 1, `${route}: portal navigation shown`);
        if (route === '/') await shot(f, 'loading-home', { fullPage: false });
        release();
        await skeleton.waitFor({ state: 'detached' });
      }
      await page.goto(base + '/');
      const card = page.getByRole('button').filter({ hasText: 'EXP-TEST-001' });
      await card.waitFor();
      const release = await gated(f, '**/rest/v1/client_colis*', request => new URL(request.url()).searchParams.get('id') === `eq.${ids.P}`);
      await card.click();
      await page.getByRole('region', { name: 'État actuel et prochaine étape', exact: true }).waitFor({ timeout: 3000 });
      assert.equal(await page.getByTestId('client-skeleton-detail').count(), 0, 'no skeleton over a known expedition');
      release();
      const publicRelease = await gated(f, '**/functions/v1/get-tracking*');
      await page.goto(`${base}/suivi/fixture-public-token-123456789`, { waitUntil: 'commit' });
      await page.getByTestId('public-tracking-skeleton').waitFor();
      assert.equal(await page.locator('.animate-spin').count(), 0, 'no lone spinner');
      await shot(f, 'loading-public', { fullPage: false });
      publicRelease();
      await page.getByRole('heading', { level: 1 }).waitFor();
      return f;
    });

    // 11. Desktop navigation, aligned cards and a readable public journey.
    for (const [width, theme] of [[390, 'light'], [1440, 'light'], [1440, 'dark']]) await scenario(`layout-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme, login: false });
      multiFixture(f);
      await f.login();
      const page = f.page;
      const nav = page.getByRole('navigation', { name: 'Navigation principale' });
      assert.equal(await nav.count(), 1, 'one visible navigation');
      const placement = await nav.evaluate(element => { const r = element.getBoundingClientRect(); return { inHeader: !!element.closest('header'), bottom: Math.round(r.bottom), width: Math.round(r.width) }; });
      if (width >= 1024) assert.equal(placement.inHeader, true, 'desktop navigation in the header');
      else assert.deepEqual([placement.inHeader, placement.bottom], [false, 844], 'mobile tab bar at the bottom');
      assert.equal(await nav.getByRole('link').count(), 4);
      if (width >= 1024) {
        const rows = await page.locator('section[aria-labelledby="client-home-todo"] .grid > button').evaluateAll(cards => cards.map(card => ({ top: Math.round(card.getBoundingClientRect().top), title: Math.round(card.querySelector('span.block').getBoundingClientRect().top), height: Math.round(card.getBoundingClientRect().height) })));
        const firstRow = rows.filter(item => item.top === rows[0].top);
        assert.ok(firstRow.length === 2, `two cards side by side ${JSON.stringify(rows)}`);
        assert.ok(Math.abs(firstRow[0].title - firstRow[1].title) <= 1 && firstRow[0].height === firstRow[1].height, `titles aligned ${JSON.stringify(firstRow)}`);
      }
      await nav.getByRole('link', { name: /^Expéditions/ }).click();
      await page.waitForURL(url => url.pathname === '/colis');
      await page.getByRole('heading', { level: 1, name: 'Mes expéditions', exact: true }).waitFor();
      await nav.locator('a[aria-current="page"][href="/colis"]').waitFor();
      assert.equal(await nav.locator('a[aria-current="page"]').count(), 1, 'one current page');
      await axe(page, `list ${width} ${theme}`);
      await shot(f, 'layout-list');
      return f;
    });

    // 12. Public tracking: saved theme, app logo, one heading, readable descriptions and journey.
    for (const [width, theme] of MATRIX) await scenario(`public-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme, login: false });
      const page = f.page;
      const long = 'Livres, jouets et petits accessoires de cuisine pour toute la famille, emballés séparément pour éviter la casse pendant le transport';
      await f.context.route('**/functions/v1/get-tracking*', route => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, expediteur: 'Camille E.', destination: { cp: '97400', ville: 'Saint-Denis' }, colis: [
        { ref: 'EXP-TEST-001', desc: long, statut: 'transit', receivedCount: 2, outgoingParcelCount: 1, preparedPackages: [{ L: 30, W: 20, H: 20, P: 5 }], dateReception: '2026-09-08T08:00:00Z', dateExpedition: '2026-10-03T06:00:00Z', paiementDate: '2026-10-02T19:00:00Z' },
        { ref: 'EXP-TEST-005', desc: 'Pièces vélo', statut: 'attente_paiement', receivedCount: 1, dateReception: '2026-10-01T08:00:00Z', devisEnvoyeLe: '2026-10-02T09:00:00Z', eta: '2026-10-14' },
      ] }) }));
      await page.goto(`${base}/suivi/fixture-public-token-123456789`);
      await page.getByRole('heading', { level: 1, name: 'Suivi des expéditions', exact: true }).waitFor();
      assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), theme === 'dark', 'saved theme applied');
      assert.equal(await page.title(), 'Suivi d’expédition — Expedîle');
      const logo = await page.locator('header b').evaluate(element => ({ text: element.textContent, accent: element.querySelector('span').textContent, background: window.__portal.backgroundLuminance(element), contrast: window.__portal.contrast(element) }));
      assert.deepEqual([logo.text, logo.accent], ['EXPÉDÎLE', 'ÎLE']); assert.ok(logo.background < 0.1 && logo.contrast >= 4.5, 'navy header like the app');
      const transit = page.getByRole('article', { name: 'EXP-TEST-001' });
      const chip = normalize(await transit.getByText(/^Étape \d sur 8/).innerText());
      assert.equal(chip, 'Étape 5 sur 8 · Transport');
      await transit.getByRole('heading', { name: 'Colis en transit', exact: true }).waitFor();
      const description = transit.getByText(long, { exact: true });
      assert.ok(await description.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && getComputedStyle(element).textOverflow !== 'ellipsis' && getComputedStyle(element).whiteSpace !== 'nowrap'), 'description wraps');
      await transit.getByText('Parcours du colis', { exact: true }).click();
      const steps = transit.getByRole('list', { name: 'Progression du colis' }).locator('li');
      assert.equal(await steps.count(), 8);
      const geometry = await steps.evaluateAll(items => items.map(item => { const r = item.getBoundingClientRect(); const spans = item.querySelectorAll(':scope > span'); const label = spans[1].getBoundingClientRect(); const state = spans[2].getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), separated: label.right <= state.left + 1, current: item.getAttribute('aria-current') }; }));
      assert.equal(new Set(geometry.map(item => item.left)).size, 1, 'single column');
      assert.ok(geometry.every((item, index) => item.separated && (index === 0 || item.top > geometry[index - 1].top)), JSON.stringify(geometry));
      assert.equal(geometry.findIndex(item => item.current === 'step'), 4, 'current step matches the chip');
      await axe(page, `public ${width} ${theme}`); await noOverflow(page, 'public'); await typographyOk(page, 'public', 'main');
      await shot(f, 'public');
      return f;
    });

    // 13. Login copy, without real-time promise or operator marketing.
    for (const [width, theme] of MATRIX) await scenario(`login-${width}-${theme}`, async () => {
      const f = await session(browser, { width, theme, login: false });
      const page = f.page;
      await page.goto(base);
      await page.getByRole('heading', { level: 1, name: 'Connexion', exact: true }).waitFor();
      const text = await page.locator('body').innerText();
      assert.doesNotMatch(text, /temps réel|un seul outil|plateforme logistique/i);
      if (width >= 768) assert.match(normalize(text), /Retrouvez vos expéditions, donnez votre accord de préparation/);
      await axe(page, `login ${width} ${theme}`); await typographyOk(page, 'login');
      await shot(f, 'login', { fullPage: false });
      return f;
    });

    // 14. Payment return: inclusive wording and a way back to the client space.
    for (const theme of ['light', 'dark']) await scenario(`payment-return-${theme}`, async () => {
      const f = await session(browser, { width: 390, theme, login: false });
      await f.context.route('**/functions/v1/get-payment-return', route => route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
        : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, status: 'pending', reference: 'EXP-TEST-001', amountCents: 8750, currency: 'EUR', isLive: true, shipment: {} }) }));
      await f.page.goto(`${base}/paiement/retour?token=${'a'.repeat(64)}&payment=cancelled`);
      await f.page.getByRole('heading', { name: 'Paiement à vérifier', exact: true }).waitFor();
      await f.page.getByText('Vous avez quitté la page de paiement. Aucun règlement n’est encore confirmé ici. Nous vérifions son état.', { exact: true }).waitFor();
      assert.equal(await f.page.getByText(/Vous êtes revenu/).count(), 0);
      assert.equal(await f.page.getByRole('link', { name: 'Retour à mon espace client' }).getAttribute('href'), '/');
      await axe(f.page, `payment return ${theme}`);
      await shot(f, 'payment-return');
      return f;
    });

    // 15. Touch screens: 16 px fields (no iOS zoom), words broken only when needed.
    await scenario('touch-fields-and-wrapping', async () => {
      const device = touchBrowser(browser);
      const f = await session(device, { width: 390, theme: 'light', login: false });
      Object.assign(f.tables.clients[0], { email: 'camille.exemple-avec-une-adresse-tres-longue@exemple-de-domaine-particulierement-long.test', prenom: 'Marie-Camille-Joséphine-Anne-Sophie' });
      await f.login();
      const page = f.page;
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'coarse pointer emulated');
      await navLink(f, 'Profil').tap();
      await page.getByRole('heading', { name: 'Mes coordonnées' }).waitFor();
      await noOverflow(page, 'long name and email');
      await page.getByRole('button', { name: 'Modifier', exact: true }).tap();
      const sizes = await page.locator('main input, main select, main textarea').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => parseFloat(getComputedStyle(node).fontSize)));
      assert.ok(sizes.length >= 8 && sizes.every(size => size >= 16), `profile fields ${sizes}`);
      assert.equal(await page.locator('button').first().evaluate(element => getComputedStyle(element).overflowWrap), 'break-word');
      await noOverflow(page, 'profile form');
      assert.deepEqual([f.errors, f.networkDenied], [[], []]);
      await f.context.close();
      const staff = await session(device, { role: 'directeur', width: 390, theme: 'light' });
      await staff.page.goto(`${base}/settings`);
      const section = staff.page.getByLabel('Rubrique', { exact: true });
      await section.waitFor();
      assert.ok(await section.evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 16), 'staff select 16 px');
      return staff;
    });
    // Reception choices at 390: references, casier chips and status pills stay whole (the chips wrap instead).
    for (const theme of ['light', 'dark']) await scenario(`touch-reception-chips-${theme}`, async () => {
      const accords = require('./dossier-accords.browser.cjs');
      const f = await accords.fixture(touchBrowser(browser), { role: 'directeur', width: 390, height: 844, theme });
      f.width = 390; f.theme = theme;
      await f.login();
      await f.page.goto(`${base}/reception?client=${accords.CLIENT.payet}&returnTo=%2F`);
      const region = f.page.getByRole('region', { name: 'Réceptionner des cartons', exact: true });
      const choices = region.getByRole('button').filter({ hasText: /^EXP-ACC00\d/ });
      await choices.first().waitFor();
      const chips = await choices.evaluateAll(nodes => nodes.slice(0, 3).map(node => {
        const row = node.querySelector('.flex.items-center');
        return [...row.children].map(item => { const style = getComputedStyle(item); const lines = Math.round(item.getBoundingClientRect().height / ((parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom))); return { text: item.textContent.trim(), lines, spill: item.scrollWidth > item.clientWidth + 1 }; });
      }));
      for (const item of chips.flat()) assert.ok(item.lines <= 1 && !item.spill, `whole chip ${JSON.stringify(item)}`);
      await noOverflow(f.page, 'reception choices');
      await choices.first().scrollIntoViewIfNeeded();
      await shot(f, 'reception-chips', { fullPage: false });
      return f;
    });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'client-portal-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.map(({ error, ...rest }) => ({ ...rest, ...(error ? { error: error.split('\n').slice(0, 6).join('\n') } : {}) })), null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
