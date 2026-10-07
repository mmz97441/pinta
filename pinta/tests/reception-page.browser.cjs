/* Full-page reception, entirely isolated from real clients and services. */
const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, ids, base } = require('./browser-regression.cjs');
const out = process.env.PINTA_RECEPTION_OUT || '/tmp/pinta-reception-page';
// « layout » runs only the phone/tablet/desktop layout scenario.
const only = process.env.PINTA_RECEPTION_FILTER || '';
async function measures(page, number, values) {
  for (const [index, label] of ['Longueur', 'Largeur', 'Hauteur', 'Poids'].entries()) await page.getByLabel(`${label} à réception (${label === 'Poids' ? 'kg' : 'cm'}) · carton ${number}`, { exact: true }).fill(String(values[index]));
}

// The préparateur works standing, phone or tablet in hand; the keyboard leaves
// about 500 px (phone) and 604 px (tablet) of visible height.
const LAYOUTS = [
  { width: 390, height: 844, keyboard: 500 },
  { width: 768, height: 1024, keyboard: 604 },
  { width: 1440, height: 1000, keyboard: null },
];
const OPEN_EXPEDITIONS = [
  ['EXP-ACC001', 'C-001', 'receptionne', 'Réceptionné'],
  ['EXP-ACC002', 'C-002', 'mesure', 'Mesuré à réception'],
  ['EXP-ACC003', 'C-003', 'attente_feu_vert', 'En attente d\'accord client'],
  ['EXP-ACC009', 'C-009', 'autorise', 'Autorisation reçue'],
];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
/** Phones and tablets: touch events, so the final press is a real tap. */
const touchBrowser = browser => new Proxy(browser, { get(target, property) {
  if (property === 'newContext') return (options = {}) => target.newContext({ ...options, hasTouch: true, isMobile: true });
  const value = target[property];
  return typeof value === 'function' ? value.bind(target) : value;
} });

/** Each open expedition: its reference, locker and status, and where « Ajouter ici » sits. */
function choiceLayout(region) {
  return region.locator('.reception-choice').evaluateAll(cards => cards.map(card => {
    const lines = node => {
      let most = 0;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        most = Math.max(most, new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size);
      }
      return most;
    };
    const box = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width }; };
    const action = card.querySelector('.reception-choice-action');
    const tokens = [...card.querySelectorAll('.reception-token')].filter(node => node !== action)
      .map(node => ({ text: node.textContent.trim(), lines: lines(node), clipped: node.scrollWidth > node.clientWidth + 1, ...box(node) }));
    return { card: box(card), info: box(card.firstElementChild), action: { text: action.textContent.trim(), lines: lines(action), ...box(action) }, tokens };
  }));
}

/** The focused entry, the sticky actions and whether anything covers the entry. */
function focusGeometry(page) {
  return page.evaluate(() => {
    const box = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width }; };
    const field = document.activeElement;
    const footer = document.querySelector('.reception-footer');
    const buttons = [...footer.querySelectorAll('button')].filter(button => /^(Enregistrer et ajouter un carton|Terminer la réception)$/.test(button.textContent.trim())).map(box);
    const summary = footer.querySelector('[aria-live="polite"]');
    const rect = field.getBoundingClientRect();
    const covering = [[rect.left + 4, rect.top + 4], [rect.left + rect.width / 2, rect.top + rect.height / 2], [rect.right - 4, rect.bottom - 4]]
      .map(([x, y]) => document.elementFromPoint(x, y)).filter(hit => hit !== field)
      .map(hit => hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}` : 'outside the viewport');
    return { label: field.getAttribute('aria-label') || field.id, field: box(field), footer: box(footer), compact: footer.dataset.compact === 'true', buttons, summaryHeight: summary.getBoundingClientRect().height,
      scrollMargin: parseFloat(getComputedStyle(field).scrollMarginBottom) || 0, covering, overflowX: document.documentElement.scrollWidth > innerWidth + 1 };
  });
}

function assertUncovered(geometry, context) {
  assert.deepEqual(geometry.covering, [], `${context}: ${geometry.label} is visible, not covered`);
  assert.ok(geometry.field.bottom <= geometry.footer.top + 0.5, `${context}: ${geometry.label} stays above the actions (${geometry.field.bottom} > ${geometry.footer.top})`);
  assert.ok(geometry.scrollMargin >= geometry.footer.height, `${context}: scroll-margin-bottom ${geometry.scrollMargin} covers the actions ${geometry.footer.height}`);
}

async function layoutScenario(browser, { width, height, keyboard }, dark) {
  const theme = dark ? 'dark' : 'light';
  const tag = `${width}-${theme}`;
  const touch = width < 1024;
  const f = await setup(touch ? touchBrowser(browser) : browser, 'directeur');
  f.page.setDefaultTimeout(10000);
  await f.page.setViewportSize({ width, height });
  await f.page.addInitScript(isDark => { localStorage.setItem('expedile-theme', isDark ? 'dark' : 'light'); }, dark);
  const template = f.tables.colis[0];
  OPEN_EXPEDITIONS.forEach(([ref, casier, statut], index) => f.tables.colis.push({ ...structuredClone(template), id: `77777777-0000-4000-8000-00000000010${index}`, ref, casier, statut,
    desc_contenu: `Achats du dossier 00${index + 1}`, feu_vert: statut === 'autorise' ? 'autorise' : 'en_attente', dims_par_colis: [{ dimL: 40, dimW: 30, dimH: 20, poids: 2 }, { dimL: 30, dimW: 20, dimH: 10, poids: 1 }] }));
  const axe = async state => {
    const result = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${tag} ${state}: no accessibility violation`);
  };
  await f.login();
  await f.page.goto(`${base}/reception`);
  const region = f.page.getByRole('region', { name: 'Réceptionner des cartons', exact: true });
  await region.getByLabel('Client', { exact: true }).waitFor();
  await f.page.waitForFunction(isDark => document.documentElement.classList.contains('dark') === isDark, dark);
  // Nothing typed yet: no draft to keep or erase.
  assert.equal(await region.getByText('Brouillon conservé dans cet onglet.', { exact: true }).count(), 0, `${tag}: no draft notice before anything is typed`);
  assert.equal(await region.getByRole('button', { name: 'Effacer le brouillon', exact: true }).count(), 0);

  await region.getByLabel('Client', { exact: true }).fill('Camille');
  await region.getByRole('button').filter({ hasText: 'Exemple Camille' }).first().click();
  await region.getByText('Ce client a 5 expéditions ouvertes', { exact: true }).waitFor();
  assert.equal(await region.getByText('2 cartons déjà rattachés', { exact: true }).count(), 5);
  assert.doesNotMatch(await region.innerText(), /\(s\)/, `${tag}: plurals are written out, never « (s) »`);
  await region.locator('.reception-choice').first().scrollIntoViewIfNeeded();
  await settle(f.page);
  const cards = await choiceLayout(region);
  assert.equal(cards.length, 5);
  const expected = [['EXP-TEST-001', 'A-03', 'En cours de préparation'], ...OPEN_EXPEDITIONS.map(([ref, casier, , label]) => [ref, casier, label])];
  for (const [index, card] of cards.entries()) {
    assert.deepEqual(card.tokens.map(token => token.text), expected[index], `${tag}: reference, locker and status of card ${index + 1}`);
    for (const token of card.tokens) {
      assert.equal(token.lines, 1, `${tag}: « ${token.text} » never breaks inside a word`);
      assert.equal(token.clipped, false, `${tag}: « ${token.text} » fits its box`);
      assert.ok(token.left >= card.card.left - 0.5 && token.right <= card.card.right + 0.5, `${tag}: « ${token.text} » stays inside its card`);
    }
    for (const [i, a] of card.tokens.entries()) for (const b of card.tokens.slice(i + 1)) {
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      assert.equal(overlap, false, `${tag}: « ${a.text} » and « ${b.text} » do not overlap`);
    }
    assert.equal(card.action.lines, 1, `${tag}: « Ajouter ici » on one line`);
    if (width < 640) {
      assert.ok(card.action.top >= card.info.bottom - 0.5, `${tag}: « Ajouter ici » goes below the expedition under 640 px`);
      assert.ok(card.action.width >= card.info.width - 1, `${tag}: « Ajouter ici » spans the card under 640 px`);
    } else {
      assert.ok(card.action.left >= card.info.right - 0.5, `${tag}: « Ajouter ici » stays beside the expedition from 640 px`);
      const [first] = card.tokens;
      assert.ok(card.tokens.every(token => token.top < first.bottom && token.bottom > first.top), `${tag}: reference, locker and status share one line, as before`);
    }
  }
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${tag}: no horizontal scroll`);
  await f.page.screenshot({ path: path.join(out, `layout-${tag}-choices.png`) });
  await axe('open expeditions');

  await region.getByRole('button', { name: 'Créer une nouvelle expédition (nouveau EXP)', exact: true }).click();
  // Neutral placeholders: units, never numbers that could pass for a measure.
  const placeholders = await region.locator('input[aria-label$="à réception (cm) · carton 1"], input[aria-label$="à réception (kg) · carton 1"]').evaluateAll(nodes => nodes.map(node => node.placeholder));
  assert.deepEqual(placeholders, ['cm', 'cm', 'cm', 'kg'], `${tag}: measurement placeholders`);
  await region.getByLabel('Casier', { exact: false }).fill('C-77');
  await region.getByText('Brouillon conservé dans cet onglet.', { exact: true }).waitFor();
  await region.getByRole('button', { name: 'Effacer le brouillon', exact: true }).waitFor();
  await region.getByText('0 / 1 carton mesuré à réception', { exact: false }).waitFor();

  const weight = region.getByLabel('Poids à réception (kg) · carton 1', { exact: true });
  await weight.click();
  await settle(f.page);
  let geometry = await focusGeometry(f.page);
  assert.equal(geometry.compact, false, `${tag}: full actions on a tall screen`);
  assert.ok(geometry.summaryHeight > 20, `${tag}: the summary shows on a tall screen`);
  assertUncovered(geometry, `${tag} tall`);
  if (keyboard) {
    // The keyboard opens: only the visible height changes.
    await f.page.setViewportSize({ width, height: keyboard });
    await f.page.waitForFunction(() => document.querySelector('.reception-footer')?.dataset.compact === 'true');
    await settle(f.page);
    geometry = await focusGeometry(f.page);
    assert.ok(geometry.footer.height <= 80, `${tag} keyboard: one compact row of actions (${geometry.footer.height} px)`);
    assert.equal(geometry.buttons.length, 2);
    assert.ok(Math.abs(geometry.buttons[0].top - geometry.buttons[1].top) < 1, `${tag} keyboard: both actions on one row`);
    assert.ok(geometry.buttons.every(button => button.height >= 44), `${tag} keyboard: 44 px targets`);
    assert.equal(geometry.overflowX, false);
    assertUncovered(geometry, `${tag} keyboard`);
    // What a browser does after resizing: reveal the focused entry.
    await f.page.evaluate(() => document.activeElement.scrollIntoView({ block: 'nearest' }));
    await settle(f.page);
    assertUncovered(await focusGeometry(f.page), `${tag} keyboard after reveal`);
    await f.page.screenshot({ path: path.join(out, `layout-${tag}-keyboard.png`) });
    // axe measures the unobscured part of each target: scan once the actions rest
    // at the end of the form instead of half-covering whatever scrolls under them.
    await f.page.evaluate(() => {
      for (let node = document.querySelector('.reception-footer').parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) { node.scrollTop = node.scrollHeight; return; }
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await settle(f.page);
    await f.page.screenshot({ path: path.join(out, `layout-${tag}-keyboard-end.png`) });
    await axe('keyboard height');
    for (const label of ['Longueur à réception (cm) · carton 1', 'Largeur à réception (cm) · carton 1', 'Hauteur à réception (cm) · carton 1', 'Numéro de suivi · carton 1', 'Casier']) {
      await region.getByLabel(label, { exact: label !== 'Casier' }).first().focus();
      await settle(f.page);
      assertUncovered(await focusGeometry(f.page), `${tag} keyboard`);
    }
    // The keyboard closes: the summary returns.
    await f.page.setViewportSize({ width, height });
    await f.page.waitForFunction(() => document.querySelector('.reception-footer')?.dataset.compact !== 'true');
    await weight.focus();
    await settle(f.page);
    geometry = await focusGeometry(f.page);
    assert.ok(geometry.summaryHeight > 20, `${tag}: the summary returns once the keyboard closes`);
    assertUncovered(geometry, `${tag} keyboard closed`);
    await f.page.setViewportSize({ width, height: keyboard });
    await f.page.waitForFunction(() => document.querySelector('.reception-footer')?.dataset.compact === 'true');
  }
  if (width < 640) assert.ok(geometry.buttons[1].top >= geometry.buttons[0].bottom, `${tag}: stacked full-width actions on a tall phone, as before`);
  else assert.ok(Math.abs(geometry.buttons[0].top - geometry.buttons[1].top) < 1, `${tag}: actions side by side, as before`);
  // Typing the last measure then tapping « Terminer » directly, keyboard still open.
  await measures(region, 1, [41, 31, 21, 2.6]);
  assert.equal(await weight.evaluate(node => node === document.activeElement), true);
  const finish = region.getByRole('button', { name: 'Terminer la réception', exact: true });
  if (touch) await finish.tap(); else await finish.click();
  await f.page.getByRole('heading', { name: 'Réception enregistrée', exact: true }).waitFor();
  const created = f.tables.colis.filter(row => !row.ref || !/^EXP-(TEST|ACC)/.test(row.ref));
  assert.equal(created.length, 1, `${tag}: one expedition created by a single tap`);
  assert.deepEqual(created[0].dims_par_colis, [{ dimL: 41, dimW: 31, dimH: 21, poids: 2.6 }]);
  assert.equal(created[0].casier, 'C-77');
  assert.deepEqual(f.errors, []);
  await f.context.close();
  return { viewport: `${width}x${height}`, keyboard: keyboard ? `${width}x${keyboard}` : null, theme, pass: true,
    scenarios: ['no-draft-notice-before-typing', 'open-expeditions-whole-words', keyboard ? 'compact-actions-with-keyboard' : 'full-actions', 'focused-entry-never-covered', 'neutral-placeholders', 'french-plurals', 'finish-tap-with-keyboard-open', 'axe'] };
}

async function run() {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    if (!only || only === 'layout') for (const layout of LAYOUTS) for (const dark of [false, true]) results.push(await layoutScenario(browser, layout, dark));
    if (!only) for (const mobile of [false, true]) for (const dark of [false, true]) {
      const f = await setup(browser, 'directeur');
      f.page.setDefaultTimeout(10000);
      await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      await f.page.addInitScript(dark => { localStorage.setItem('expedile-theme', dark ? 'dark' : 'light'); }, dark);
      // Existing dossier has two measured boxes, a distinct optimized package, and invoices.
      f.tables.colis[0].dims_par_colis = [{ dimL: 40, dimW: 30, dimH: 20, poids: 2 }, { dimL: 20, dimW: 10, dimH: 10, poids: 1 }];
      let conflict = false, loseResponse = false, counter = 0;
      const receipts = new Map();
      await f.context.route('**/rest/v1/rpc/append_reception_cartons', async route => {
        const input = route.request().postDataJSON();
        f.requests.push({ method: 'POST', path: '/rest/v1/rpc/append_reception_cartons', input });
        const current = f.tables.colis.find(item => item.id === input.p_colis_id);
        if (receipts.has(input.p_request_id)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ colis: current, reused: true }) });
        if (conflict || input.p_expected_updated_at !== current.updated_at) { conflict = false; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '40001', message: 'Le dossier a changé. Actualisez sans perdre votre saisie.' }) }); }
        const next = input.p_cartons.map(box => Object.fromEntries(['dimL', 'dimW', 'dimH', 'poids'].map(key => [key, Number(box[key])])));
        current.dims_par_colis = [...(current.dims_par_colis || []), ...next];
        current.nb_colis += next.length;
        current.trackings = [...current.trackings, ...input.p_cartons.map(box => box.tracking).filter(Boolean)];
        current.trackings_detail = [...current.trackings_detail, ...input.p_cartons.map(box => ({ number: box.tracking || '', fournisseur: box.fournisseur || '' }))];
        current.casier = input.p_casier || current.casier;
        current.statut = 'mesure'; current.feu_vert = 'en_attente';
        current.preparation_composition_version = (current.preparation_composition_version || 1) + 1;
        current.final_measurements_version = null;
        current.updated_at = `2026-10-01T10:00:${String(++counter).padStart(2, '0')}Z`;
        receipts.set(input.p_request_id, true);
        if (loseResponse) { loseResponse = false; return route.abort('failed'); }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ colis: current }) });
      });
      await f.login();
      await f.page.goto(`${base}/reception?dossier=${ids.P}&returnTo=%2Fcolis`);
      const region = f.page.getByRole('region', { name: 'Réceptionner des cartons', exact: true });
      await region.waitFor();
      assert.equal(await f.page.getByRole('dialog').count(), 0, 'Reception is a page, not a focus-trapping modal');
      await region.getByRole('heading', { name: 'Carton 3', exact: true }).waitFor();
      // Opened on its dossier with nothing typed: no draft notice yet.
      assert.equal(await region.getByText('Brouillon conservé dans cet onglet.', { exact: true }).count(), 0, 'No draft notice before anything is typed');
      assert.equal(await region.getByRole('button', { name: 'Effacer le brouillon', exact: true }).count(), 0);
      await region.getByRole('button', { name: 'Enregistrer et ajouter un carton', exact: true }).click();
      await region.getByRole('alert').filter({ hasText: /Carton 3/ }).waitFor();
      assert.equal(f.requests.filter(r => r.path.endsWith('append_reception_cartons')).length, 0, 'Incomplete measurements never reach the server');
      await measures(region, 3, [50, 30, 20, 2.5]);
      await region.getByText('Brouillon conservé dans cet onglet.', { exact: true }).waitFor();
      await f.page.reload();
      await region.waitFor();
      assert.equal(await region.getByLabel('Longueur à réception (cm) · carton 3').inputValue(), '50', 'Draft survives reload');
      conflict = true;
      await region.getByRole('button', { name: 'Enregistrer et ajouter un carton', exact: true }).click();
      await region.getByRole('alert').filter({ hasText: 'Le dossier a changé' }).waitFor();
      assert.equal(await region.getByLabel('Poids à réception (kg) · carton 3').inputValue(), '2.5');
      assert.equal(f.tables.colis[0].nb_colis, 2, 'Failed append leaves persisted boxes unchanged');
      await region.getByRole('button', { name: 'Actualiser le dossier sans perdre ma saisie' }).click();
      await region.getByRole('button', { name: 'Enregistrer et ajouter un carton', exact: true }).click();
      await region.getByRole('heading', { name: 'Carton 4', exact: true }).waitFor();
      await region.getByRole('status').filter({ hasText: 'Carton 3 enregistré · EXP-TEST-001 · Casier A-03' }).waitFor();
      assert.equal(f.tables.colis.length, 1, 'Appending does not create another EXP');
      assert.equal(f.tables.colis[0].nb_colis, 3);
      assert.equal(f.tables.colis[0].fin_p, 3, 'Reception weight never overwrites optimized weight');
      assert.equal(await region.getByLabel('Poids à réception (kg) · carton 4').inputValue(), '', 'Next carton starts empty');
      // Leaving and reopening the same route retains the EXP and carton numbering.
      await region.getByRole('button', { name: 'Retour à ma liste, conserver le brouillon' }).click();
      await f.page.goto(`${base}/reception?dossier=${ids.P}&returnTo=%2Fcolis`);
      await region.getByRole('heading', { name: 'Carton 4', exact: true }).waitFor();
      await measures(region, 4, [15, 12, 10, 0.75]);
      const axe = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], 'No accessibility violations on reception');
      await f.page.screenshot({ path: path.join(out, `reception-${mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
      loseResponse = true;
      await region.getByRole('button', { name: 'Terminer la réception', exact: true }).click();
      await region.getByRole('button', { name: 'Vérifier l’enregistrement', exact: true }).waitFor();
      assert.equal(f.tables.colis[0].nb_colis, 4, 'Server committed even though the response was lost');
      assert.equal(await region.getByLabel('Poids à réception (kg) · carton 4').isDisabled(), true, 'Uncertain receipt cannot be changed before verification');
      await f.page.reload();
      await region.getByRole('button', { name: 'Vérifier l’enregistrement', exact: true }).click();
      await f.page.getByRole('heading', { name: 'Réception enregistrée', exact: true }).waitFor();
      await f.page.getByRole('status').filter({ hasText: 'Carton 4 enregistré · EXP-TEST-001 · Casier A-03' }).waitFor();
      assert.equal(f.tables.colis[0].nb_colis, 4);
      assert.ok(!f.requests.some(r => /queue_message|send-telegram|send-email/.test(r.path)), 'Reception never notifies the client');
      await f.page.getByRole('button', { name: 'Ouvrir le dossier EXP-TEST-001', exact: true }).click();
      await f.page.waitForURL(`**/colis/${ids.P}?*`);
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'), '/colis');
      assert.deepEqual(f.errors, []);
      results.push({ mobile, dark, pass: true, scenarios: ['required-measures', 'same-exp-append', 'continuous-numbering', 'draft-reload', 'draft-back', 'conflict-retains-input', 'separate-optimized-measures', 'finish-confirmation', 'lost-response-idempotent-replay-after-reload', 'no-notification', 'axe'] });
      await f.context.close();
    }
    // Several open dossiers require an explicit choice before receiving another box.
    if (!only) {
    const f = await setup(browser, 'directeur');
    f.page.setDefaultTimeout(10000);
    f.tables.colis.push({ ...f.tables.colis[0], id: '77777777-7777-4777-8777-777777777777', ref: 'EXP-TEST-002', casier: 'B-04' });
    let creationOutage = false;
    await f.context.route('**/rest/v1/colis*', async route => {
      if (route.request().method() !== 'POST') { if (creationOutage && new URL(route.request().url()).searchParams.has('id')) return route.abort('failed'); return route.fallback(); }
      const input = route.request().postDataJSON();
      f.requests.push({ method: 'POST', path: '/rest/v1/colis', input });
      const row = { ...input, id: input.id, ref: 'EXP-NEW123', updated_at: '2026-10-01T11:00:00Z', created_at: '2026-10-01T11:00:00Z' };
      f.tables.colis.push(row);
      creationOutage = true;
      return route.abort('failed');
    });
    await f.login();
    await f.page.goto(`${base}/reception?client=${ids.C}`);
    const region = f.page.getByRole('region', { name: 'Réceptionner des cartons', exact: true });
    await region.getByText('Ce client a 2 expéditions ouvertes', { exact: true }).waitFor();
    assert.equal(await region.getByRole('button', { name: 'Effacer le brouillon', exact: true }).count(), 0, 'Opened on its client with nothing typed: no draft notice');
    assert.equal(await region.getByLabel('Longueur à réception (cm) · carton 1').count(), 0, 'No entry until the expedition is chosen');
    await region.getByRole('button').filter({ hasText: 'EXP-TEST-002' }).click();
    await region.getByRole('heading', { name: 'Carton 3', exact: true }).waitFor();
    await region.getByRole('button', { name: 'Changer', exact: true }).click();
    await region.getByRole('button', { name: 'Créer une nouvelle expédition (nouveau EXP)', exact: true }).click();
    await region.getByLabel('Casier', { exact: false }).fill('C-05');
    await measures(region, 1, [20, 20, 20, 1]);
    await region.getByRole('button', { name: 'Enregistrer et ajouter un carton', exact: true }).click();
    await region.getByRole('button', { name: 'Vérifier l’enregistrement', exact: true }).waitFor();
    assert.equal(f.tables.colis.length, 3, 'Creation committed before the response was lost');
    assert.equal(await region.getByLabel('Client', { exact: true }).isDisabled(), true);
    creationOutage = false;
    await f.page.reload();
    await region.getByRole('button', { name: 'Vérifier l’enregistrement', exact: true }).click();
    await region.getByRole('heading', { name: 'Carton 2', exact: true }).waitFor();
    await region.getByRole('status').filter({ hasText: 'Carton 1 enregistré · EXP-NEW123 · Casier C-05' }).waitFor();
    assert.equal(f.requests.filter(r => r.path === '/rest/v1/colis' && r.method === 'POST').length, 1);
    await region.getByRole('button', { name: 'Terminer la réception', exact: true }).click();
    await f.page.getByRole('heading', { name: 'Réception enregistrée', exact: true }).waitFor();
    assert.equal(f.tables.colis.at(-1).nb_colis, 1, 'Finish after continue saves no empty carton');
    await f.page.getByRole('button', { name: 'Réceptionner pour un autre client', exact: true }).click();
    await region.waitFor();
    assert.equal(await region.getByLabel('Client', { exact: true }).inputValue(), '');
    await region.getByLabel('Client', { exact: true }).fill('Camille');
    await region.getByRole('button').filter({ hasText: 'Exemple' }).first().click();
    await region.getByRole('button').filter({ hasText: 'EXP-NEW123' }).click();
    await measures(region, 2, [30, 30, 30, 2]);
    await region.getByRole('button', { name: 'Effacer le brouillon', exact: true }).click();
    await region.getByRole('button', { name: 'Oui, effacer le brouillon', exact: true }).click();
    await f.page.reload();
    await region.waitFor();
    assert.equal(await region.getByLabel('Client', { exact: true }).inputValue(), '', 'Discard stays discarded after reload');
    assert.equal(await region.getByLabel('Poids à réception (kg) · carton 2').count(), 0);
    assert.equal(await region.getByRole('button', { name: 'Effacer le brouillon', exact: true }).count(), 0, 'No draft notice once the draft is erased');
    assert.ok(!f.requests.some(r => /queue_message|send-telegram|send-email/.test(r.path)));
    assert.deepEqual(f.errors, []);
    results.push({ pass: true, scenarios: ['multiple-explicit-choice', 'new-reception', 'new-exp-continue', 'creation-lost-response-reload-same-exp', 'finish-without-empty-carton', 'another-client', 'explicit-draft-discard'] });
    await f.context.close();
    }
  } catch(error) {
    results.push({ pass: false, error: error.stack });
    const page = browser.contexts().flatMap(context => context.pages()).at(-1);
    await page?.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); }
}
run();
