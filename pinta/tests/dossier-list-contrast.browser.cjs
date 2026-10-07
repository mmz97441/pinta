/* Computed contrast through actual hover, selection and keyboard navigation.
 * Fixtures only: list interaction must never write business data. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_LIST_CONTRAST_OUT || '/tmp/pinta-dossier-list-contrast';
const results = [];
async function measure(locator) {
  // Let reduced-motion transitions reach their painted value before sampling.
  await locator.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return locator.evaluate(root => {
    const rgba = value => { const n = value.match(/[\d.]+/g)?.map(Number) || []; return n.length >= 3 ? [...n.slice(0, 3), n[3] ?? 1] : [0, 0, 0, 0]; };
    const over = (fg, bg) => [...fg.slice(0, 3).map((channel, i) => channel * fg[3] + bg[i] * (1 - fg[3])), 1];
    const background = element => { const chain = []; for (let n = element; n; n = n.parentElement) chain.push(rgba(getComputedStyle(n).backgroundColor)); return chain.reverse().reduce((bg, color) => over(color, bg), [255, 255, 255, 1]); };
    const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const contrast = (first, second) => { const a = luminance(first), b = luminance(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
    const text = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const parent = node.parentElement;
      if (!parent.getClientRects().length || getComputedStyle(parent).visibility === 'hidden') continue;
      const bg = background(parent), fg = over(rgba(getComputedStyle(parent).color), bg);
      text.push({ text: node.textContent.trim(), ratio: contrast(fg, bg), foreground: fg, background: bg });
    }
    if (root.tagName === 'SELECT') { const bg = background(root); const fg = over(rgba(getComputedStyle(root).color), bg); text.push({ text: root.selectedOptions[0]?.textContent || '', ratio: contrast(fg, bg), foreground: fg, background: bg }); }
    const surface = root.tagName === 'TR' ? root.querySelector('td') : root;
    const focused = root.matches(':focus-visible') ? root : root.querySelector(':focus-visible'), bg = background(surface);
    return { text, background: bg, luminance: luminance(bg), selected: root.dataset.selected, shadow: getComputedStyle(surface).boxShadow,
      focus: focused ? { color: getComputedStyle(focused).outlineColor, width: getComputedStyle(focused).outlineWidth, ratio: contrast(rgba(getComputedStyle(focused).outlineColor), background(focused)) } : null };
  });
}
// The keyboard focus ring as painted, against what lies beyond it and against the gap inside it:
// a screenshot read back in the page (a gradient, such as the navigation's, has no single colour).
async function paintedRing(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async png => {
    const element = document.activeElement, style = getComputedStyle(element), box = element.getBoundingClientRect();
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const scale = image.naturalWidth / innerWidth;
    const at = (x, y) => [...context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data].slice(0, 3);
    const luminance = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const width = parseFloat(style.outlineWidth) || 0, offset = parseFloat(style.outlineOffset) || 0, y = box.top + box.height / 2;
    // The left and right sides at mid-height (one may be clipped): the better one is the ring that shows.
    const sides = [[-1, box.left], [1, box.right]].map(([sign, edge]) => {
      const ring = at(edge + sign * (offset + width / 2), y), beyond = at(edge + sign * (offset + width + 2), y), gap = offset >= 2 ? at(edge + sign * offset / 2, y) : beyond;
      return Math.min(contrast(ring, beyond), contrast(ring, gap));
    });
    return { name: (element.getAttribute('aria-label') || element.textContent || '').trim(), color: style.outlineColor, style: style.outlineStyle, width, ratio: Math.max(...sides) };
  }, png);
}
const NAVY = 'rgb(27, 58, 75)', GOLD = 'rgb(216, 170, 66)', DARK_GOLD = 'rgb(232, 199, 121)';
async function keyboardFocus(page, locator) { await locator.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); }
async function checkRing(page, locator, expected, label, samples) {
  await keyboardFocus(page, locator);
  const ring = await paintedRing(page);
  assert.equal(ring.style, 'solid', `${label}: a ring`); assert.ok(ring.width >= 2, `${label}: 2 px or more`);
  assert.equal(ring.color, expected, `${label}: ${expected}`);
  assert.ok(ring.ratio >= 3, `${label}: the ring keeps 3:1 against what surrounds it (${ring.ratio.toFixed(2)})`);
  samples.push({ state: `focus-ring ${label}`, ...ring });
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      const f = await setup(browser, 'directeur'); f.page.setDefaultTimeout(10000);
      const name = `${width}-${theme}`;
      try {
        await f.page.setViewportSize({ width, height: 1000 }); await f.page.emulateMedia({ reducedMotion: 'reduce' }); await f.login();
        await f.page.evaluate(value => localStorage.setItem('expedile-theme', value), theme); await f.page.goto(base + '/colis');
        await f.page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
        const row = () => f.page.locator(width === 1440 ? `[data-dossier-row="${ids.P}"]:visible` : `[data-dossier-card="${ids.P}"]`);
        await row().waitFor({ state: 'visible' }); const samples = [];
        async function check(state, focus = false) {
          const sample = await measure(row());
          assert.ok(sample.text.length >= 5, `${name}/${state}: dossier content measured`);
          assert.deepEqual(sample.text.filter(item => item.ratio < 4.5).map(item => ({ text: item.text, ratio: item.ratio })), [], `${name}/${state}: text contrast >= 4.5:1`);
          assert.ok(theme === 'dark' ? sample.luminance < .15 : sample.luminance > .75, `${name}/${state}: surface retains theme`);
          if (focus) { assert.ok(sample.focus, `${name}/${state}: focus visible`); assert.ok(parseFloat(sample.focus.width) >= 2); assert.ok(sample.focus.ratio >= 3, `${name}/${state}: focus contrast >= 3:1`); assert.notEqual(sample.shadow, 'none'); }
          samples.push({ state, ...sample }); return sample;
        }
        await f.page.mouse.move(0, 0); const normal = await check('normal');
        await row().hover(); const hovered = await check('hover'); assert.notDeepEqual(hovered.background, normal.background, `${name}: perceptible hover`);
        await f.page.mouse.move(0, 0); await f.page.keyboard.press('Tab'); await row().getByRole('button', { name: 'EXP-TEST-001', exact: true }).focus(); await check('focus', true);
        // Select through the real checkbox of what the person sees: the table row, or the card on a phone (44 px box).
        await row().getByRole('checkbox', { name: 'Sélectionner le dossier EXP-TEST-001', exact: true }).check();
        await row().waitFor({ state: 'visible' }); await f.page.mouse.move(0, 0); await f.page.evaluate(() => document.activeElement?.blur());
        const selected = await check('selected'); assert.equal(selected.selected, 'true'); assert.notDeepEqual(selected.background, normal.background, `${name}: perceptible selection`);
        await row().hover(); const selectedHover = await check('selected-hover'); assert.deepEqual(selectedHover.background, selected.background, `${name}: hover preserves selection`);
        await f.page.mouse.move(0, 0); await f.page.keyboard.press('Tab'); await row().getByRole('button', { name: 'EXP-TEST-001', exact: true }).focus(); await check('selected-focus', true);
        await f.page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
        // A warning or a failure in the selection bar (the labels' outcome carries data-tone) reads apart
        // from its neutral hints: the amber or red block, its text at 4.5:1, its icon in the same colour.
        const bulkBar = f.page.getByRole('group', { name: 'Actions sur la sélection', exact: true });
        for (const tone of ['warning', 'error']) {
          await bulkBar.evaluate((bar, tone) => { for (const value of ['', tone]) { const note = document.createElement('p'); note.className = 'dossier-bulk-note'; if (value) note.dataset.tone = value; note.dataset.probe = value || 'neutral'; note.innerHTML = '<svg width="16" height="16" aria-hidden="true"></svg><span>Aucune étiquette à imprimer.</span>'; bar.appendChild(note); } }, tone);
          const note = bulkBar.locator(`[data-probe="${tone}"]`), sample = await measure(note);
          assert.ok(sample.text.length && sample.text.every(item => item.ratio >= 4.5), `${name}: ${tone} note text >= 4.5:1`);
          const look = await note.evaluate(node => { const style = getComputedStyle(node), neutral = getComputedStyle(node.parentElement.querySelector('[data-probe="neutral"]')); return { border: style.borderTopWidth, edge: style.borderTopColor, fill: style.backgroundColor, color: style.color, icon: getComputedStyle(node.querySelector('svg')).color, neutralColor: neutral.color, neutralFill: neutral.backgroundColor }; });
          assert.equal(look.border, '1px', `${name}: ${tone} note has an edge`); assert.notEqual(look.edge, look.fill, `${name}: ${tone} edge shows on its fill`);
          assert.notEqual(look.fill, look.neutralFill, `${name}: ${tone} note has its own fill`); assert.notEqual(look.color, look.neutralColor, `${name}: ${tone} note does not read as a neutral hint`);
          assert.equal(look.icon, look.color, `${name}: ${tone} icon in the note's colour`);
          samples.push({ state: `bulk-note-${tone}`, ...sample, look }); await bulkBar.evaluate(bar => bar.querySelectorAll('[data-probe]').forEach(node => node.remove()));
        }
        // One focus ring rule (brand.css): navy on the light surfaces of the light theme, gold on the navy
        // navigation; gold everywhere in the dark theme.
        if (width === 1440) {
          await checkRing(f.page, f.page.getByRole('button', { name: 'Affichage', exact: true }), theme === 'dark' ? DARK_GOLD : NAVY, 'toolbar button', samples);
          await checkRing(f.page, f.page.locator('.staff-sidebar').getByRole('button', { name: 'Départs', exact: true }), theme === 'dark' ? DARK_GOLD : GOLD, 'navigation link', samples);
          await f.page.screenshot({ path: path.join(output, `${name}-sidebar-ring.png`), clip: { x: 0, y: 0, width: 260, height: 420 } });
          await f.page.evaluate(() => document.activeElement?.blur());
        }
        if (width === 1440) {
          // « Tri par défaut » now lives in the « Affichage » dialog, which stays open after a change.
          await f.page.getByRole('button', { name: 'Affichage', exact: true }).click();
          const display = f.page.getByRole('dialog', { name: 'Affichage', exact: true }); await display.waitFor();
          const sorting = display.getByRole('combobox', { name: 'Tri par défaut', exact: true });
          await sorting.selectOption('date_desc'); assert.equal(await sorting.inputValue(), 'date_desc'); assert.equal(await display.isVisible(), true);
          await sorting.hover(); const sample = await measure(sorting);
          assert.ok(sample.text.length > 0 && sample.text.every(item => item.ratio >= 4.5), `${name}: sorting control contrast`); assert.ok(theme === 'dark' ? sample.luminance < .15 : sample.luminance > .75);
          await f.page.keyboard.press('Tab'); await sorting.focus();
          const focus = await measure(sorting); assert.ok(focus.focus && parseFloat(focus.focus.width) >= 2 && focus.focus.ratio >= 3, `${name}: sorting keyboard focus remains visible`);
          samples.push({ state: 'sort-control-hover', ...sample }, { state: 'sort-control-focus', ...focus });
        }
        if (width === 390) {
          // A dialog outside the work area (ConfirmDialog, beside the navigation): the same ring on its light panel.
          await f.page.goto(base + '/plus'); await f.page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
          const dialog = f.page.getByRole('dialog', { name: 'Se déconnecter ?', exact: true }); await dialog.waitFor();
          await checkRing(f.page, dialog.getByRole('button', { name: 'Annuler', exact: true }), theme === 'dark' ? DARK_GOLD : NAVY, 'confirmation dialog button', samples);
          await f.page.screenshot({ path: path.join(output, `${name}-dialog-ring.png`) });
          await f.page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        }
        assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
        // Loading the signed-in app synchronizes its work queue. No list
        // interaction may issue an assignment, document or dossier write.
        assert.deepEqual(f.requests.filter(request => ['POST', 'PATCH', 'DELETE'].includes(request.method) && request.path.startsWith('/rest/v1/') && !['/rest/v1/rpc/refresh_staff_work_actions','/rest/v1/rpc/get_reception_dates'].includes(request.path)).map(request => ({ path: request.path, input: request.input })), [], 'List interaction does not write business data');
        assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        results.push({ name, pass: true, samples }); console.log('PASS', name);
      } catch (error) { results.push({ name, pass: false, error: error.stack }); process.exitCode = 1; await f.page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {}); console.error('FAIL', name, error.message); }
      finally { await f.context.close(); }
    }
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
