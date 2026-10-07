/* End of a paid subscription: its last day is included, on Paris time, whatever the
 * device's time zone (here Réunion, already the next day at 21:30 UTC). The dossier's
 * quote gate and the portal's home notice follow domain/clientPlan.js, like the « P »
 * of the dossier list. Synthetic data only: setup() mocks every request, so nothing
 * reaches Supabase, Telegram or PayPlug. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_SUBSCRIPTION_END_OUT || '/tmp/pinta-subscription-end';
const results = [];

// Polls a state instead of reading it once: CI browsers are slower.
async function until(read, expected, message, timeout = 10000) {
  const end = Date.now() + timeout;
  let value;
  do { value = await read(); if (value === expected) return; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < end);
  assert.equal(value, expected, message);
}

async function scenario(browser, name, { role, now, client }, run) {
  const f = await setup(browser, role, { timezoneId: 'Indian/Reunion' });
  f.page.setDefaultTimeout(10000);
  await f.page.clock.setFixedTime(new Date(now));
  f.server.now = () => Date.parse(now);
  Object.assign(f.tables.clients[0], client);
  try {
    await f.login(); await run(f);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []);
    results.push({ test: name, pass: true });
  } catch (error) {
    process.exitCode = 1; results.push({ test: name, pass: false, error: error.stack });
    await f.page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {});
  } finally { await f.context.close(); console.log(JSON.stringify(results[results.length - 1])); }
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    // The quote can be saved on the last day (23:30 in Paris), not from the next day (00:30).
    const monthly = { abonnement: 'premium_mensuel', abonnement_debut: '2026-09-08', abonnement_fin: '2026-10-07' };
    const note = 'Abonnement expiré : régularisez l’offre du client avant l’envoi.';
    for (const [now, ended] of [['2026-10-07T21:30:00Z', false], ['2026-10-07T22:30:00Z', true]]) {
      await scenario(browser, `quote-gate-${ended ? 'from-the-next-day' : 'on-the-last-day'}`, { role: 'directeur', now, client: monthly }, async f => {
        await f.page.goto(`${base}/colis/${ids.P}?section=devis`);
        const workspace = f.page.getByTestId('dossier-task-workspace');
        await workspace.waitFor();
        const save = f.page.getByRole('button', { name: 'Enregistrer et vérifier le devis', exact: true });
        await save.waitFor();
        if (ended) await workspace.getByText(note, { exact: true }).waitFor();
        await until(() => save.isDisabled(), ended, ended ? 'An ended subscription blocks the quote.' : 'The last day is still within the subscription.');
        assert.equal(await workspace.getByText(note, { exact: true }).count(), ended ? 1 : 0);
        await f.page.screenshot({ path: `${output}/quote-gate-${ended ? 'next-day' : 'last-day'}.png`, fullPage: true });
      });
    }
    // The portal's home notice, at noon on 7 October in Paris.
    const NOON = '2026-10-07T12:00:00Z';
    const renew = 'Contactez l’équipe pour son renouvellement.';
    for (const [abonnement, end, text] of [
      ['premium_mensuel', '2026-10-07', `Votre abonnement Premium Mensuel se termine aujourd’hui. ${renew}`],
      ['premium_mensuel', '2026-10-06', `Votre abonnement Premium Mensuel a pris fin le 6 octobre. ${renew}`],
      ['premium_annuel', '2026-10-10', `Votre abonnement Premium Annuel se termine le 10 octobre, dans 3 jours. ${renew}`],
      ['premium_annuel', '2026-11-07', null],
      ['freemium', '2026-10-06', null],
    ]) {
      await scenario(browser, `portal-notice-${abonnement}-${end}`, { role: 'client', now: NOON, client: { abonnement, abonnement_debut: '2026-01-01', abonnement_fin: end } }, async f => {
        await f.page.getByRole('heading', { level: 1, name: /^Bonjour/ }).waitFor();
        const notice = f.page.locator('aside').filter({ hasText: 'Votre abonnement' });
        if (text) {
          await notice.waitFor();
          assert.equal((await notice.innerText()).replace(/\s+/g, ' ').trim(), text);
        } else {
          await f.page.getByRole('heading', { level: 1, name: /^Bonjour/ }).waitFor();
          assert.equal(await notice.count(), 0, 'No notice more than 30 days ahead, nor for Freemium.');
        }
      });
    }
  } finally { await browser.close(); }
  if (results.some(result => !result.pass)) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
