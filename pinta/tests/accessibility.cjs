const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, ids, base } = require('./browser-regression.cjs');
const output = process.env.PINTA_A11Y_OUT || path.resolve(__dirname, '../../docs/verification-ux-ui-2026-09-10');
(async () => {
 await fs.mkdir(output, { recursive: true });
 const browser = await chromium.launch({ headless: true });
 const checks = [];
 try {
  for (const role of ['directeur', 'client']) {
   const f = await setup(browser, role);
   await f.login();
   const routes = role === 'directeur' ? ['/', '/colis', '/colis/' + ids.P, '/clients', '/settings'] : ['/', '/colis/' + ids.P, '/profil'];
   for (const theme of ['light', 'dark']) {
    await f.page.evaluate(theme => localStorage.setItem('expedile-theme', theme), theme);
    for (const mobile of [false, true]) {
    await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    for (const route of routes) {
     await f.page.goto(base + route);
     await f.page.waitForTimeout(400);
     const result = await new AxeBuilder({ page: f.page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
     checks.push({ role, route, mobile, theme, violations: result.violations.map(v => ({ id:v.id, impact:v.impact, description:v.description, help:v.help, nodes:v.nodes.map(n=>({ target:n.target, summary:n.failureSummary })) })), overflow: await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) });
    }
   }
   }
   await f.context.close();
  }
 } finally { await browser.close(); }
 const failures = checks.filter(c=>c.violations.length || c.overflow);
 await fs.writeFile(path.join(output,'accessibility-results.json'),JSON.stringify({ checks, failed:failures.length, status:failures.length?'failed':'passed', limitations:'Automated checks on fixtures; not an accessibility certification.' },null,2));
 console.log(JSON.stringify({checks:checks.length,failed:failures.length,issues:failures.map(c=>({role:c.role,route:c.route,mobile:c.mobile,theme:c.theme,overflow:c.overflow,rules:c.violations.map(v=>v.id)}))},null,2));
 if(failures.length) process.exitCode=1;
})().catch(error=>{ console.error(error.message);process.exitCode=1; });
