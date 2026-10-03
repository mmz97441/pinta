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
        // Select through the real checkbox before resizing to mobile cards.
        if (width === 390) await f.page.setViewportSize({ width: 1440, height: 1000 });
        await f.page.getByRole('checkbox', { name: 'Sélectionner le dossier EXP-TEST-001', exact: true }).filter({ visible: true }).check();
        if (width === 390) await f.page.setViewportSize({ width, height: 1000 });
        await row().waitFor({ state: 'visible' }); await f.page.mouse.move(0, 0); await f.page.evaluate(() => document.activeElement?.blur());
        const selected = await check('selected'); assert.equal(selected.selected, 'true'); assert.notDeepEqual(selected.background, normal.background, `${name}: perceptible selection`);
        await row().hover(); const selectedHover = await check('selected-hover'); assert.deepEqual(selectedHover.background, selected.background, `${name}: hover preserves selection`);
        await f.page.mouse.move(0, 0); await f.page.keyboard.press('Tab'); await row().getByRole('button', { name: 'EXP-TEST-001', exact: true }).focus(); await check('selected-focus', true);
        await f.page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
        if (width === 1440) {
          await f.page.getByRole('button', { name: /^Filtres et options/ }).click();
          const sorting = f.page.getByRole('combobox', { name: 'Tri par défaut', exact: true });
          await sorting.selectOption('date_desc'); assert.equal(await sorting.inputValue(), 'date_desc');
          await sorting.hover(); const sample = await measure(sorting);
          assert.ok(sample.text.length > 0 && sample.text.every(item => item.ratio >= 4.5), `${name}: sorting control contrast`); assert.ok(theme === 'dark' ? sample.luminance < .15 : sample.luminance > .75);
          await f.page.keyboard.press('Tab'); await sorting.focus();
          const focus = await measure(sorting); assert.ok(focus.focus && parseFloat(focus.focus.width) >= 2 && focus.focus.ratio >= 3, `${name}: sorting keyboard focus remains visible`);
          samples.push({ state: 'sort-control-hover', ...sample }, { state: 'sort-control-focus', ...focus });
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
