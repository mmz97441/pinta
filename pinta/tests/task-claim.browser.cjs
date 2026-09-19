/* Claiming work is tested against isolated fixtures; no client or provider is contacted. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');

const output = process.env.PINTA_TASK_CLAIM_OUT || '/tmp/pinta-task-claim';
const B = '88888888-1111-4111-8111-111111111111';
const TASK = '77777777-0000-4000-8000-000000000001';
const OLD_QUOTE = '77777777-0000-4000-8000-000000000002';
const results = [];
const claimButton = root => root.getByRole('button', { name: 'Prendre cette tâche', exact: true });
const ownership = f => f.page.getByRole('region', { name: 'Prise en charge de la tâche', exact: true });
const taskRow = f => f.page.locator(`[data-work-action="${TASK}"]`);

async function fixture(browser, { restricted = false, unavailable = false, otherOwner = false, conflict = false, holdClaimResponse = false } = {}) {
  const f = await setup(browser, restricted ? 'preparateur' : 'directeur');
  f.page.setDefaultTimeout(10000);
  if (restricted) {
    const permissions = { id: 'prep-only', staff_id: ids.S, perm_colis_preparer: true };
    f.tables.staff_permissions = [permissions];
    f.tables.staff_users[0].staff_permissions = permissions;
  }
  f.tables.staff_users.push({ id: B, auth_id: B, nom: 'Madly', role: 'directeur', actif: true, staff_permissions: {} });
  f.tables.staff_work_preferences = [{
    staff_id: ids.A, missions: ['reception', 'preparation', 'communication', 'documents', 'departures', 'coordination'],
    active_mission: null, density: 'comfortable', available: !unavailable, version: 1,
  }];
  // Reproduces the reported regression: old preparation/quote data must not hide
  // the current reception task after a return to waiting for client consent.
  Object.assign(f.tables.colis[0], {
    statut: 'attente_feu_vert', feu_vert: 'en_attente',
    feu_vert_date: null, demande_feu_vert_envoyee_at: '2026-09-18T02:06:00Z',
    dims_par_colis: [{ dimL: 40, dimW: 30, dimH: 20, poids: 1.5 }, { dimL: 40, dimW: 30, dimH: 20, poids: 1.5 }],
    devis_envoye_le: '2026-09-17T02:06:00Z', devis_brouillon: true, devis_total: 0,
    responsible_staff_id: B,
  });
  f.tables.staff_work_actions = [{
    id: TASK, colis_id: ids.P, kind: 'reception', state: 'waiting',
    assignee_id: otherOwner ? B : null, blocked_reason: 'Accord client attendu',
    waiting_reason: null, review_at: null, version: 4,
    created_at: '2026-09-18T02:06:00Z', updated_at: '2026-09-18T02:06:00Z',
  }, {
    id: OLD_QUOTE, colis_id: ids.P, kind: 'quote', state: 'done',
    assignee_id: null, version: 2, created_at: '2026-09-16T02:06:00Z',
  }];
  f.claimCalls = [];
  let recordClaim;
  f.claimReceived = new Promise(resolve => { recordClaim = resolve; });
  const releaseClaimResponse = new Promise(resolve => { f.releaseClaimResponse = resolve; });
  f.originalColis = structuredClone(f.tables.colis);
  await f.context.route('**/rest/v1/rpc/mutate_staff_work_action', async route => {
    const input = route.request().postDataJSON();
    f.claimCalls.push(input);
    const task = f.tables.staff_work_actions.find(item => item.id === input.p_action_id);
    if (conflict) {
      task.assignee_id = B;
      task.version += 1;
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({
        code: '40001', message: 'Cette tâche a changé. Actualisez avant de réessayer.',
      }) });
      return;
    }
    if (input.p_command !== 'claim' || !task || task.assignee_id || input.p_expected_version !== task.version) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '40001', message: 'Prise en charge concurrente ou commande inattendue.' }) });
      return;
    }
    task.assignee_id = ids.A;
    task.version += 1;
    recordClaim();
    if (holdClaimResponse) await releaseClaimResponse;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(task) });
  });
  return f;
}

function assertPreserved(f, expectedOwner = ids.A) {
  assert.equal(f.claimCalls.length, 1, 'Exactly one explicit claim request');
  assert.deepEqual(f.claimCalls[0], { p_action_id: TASK, p_command: 'claim', p_expected_version: 4, p_payload: {} });
  const task = f.tables.staff_work_actions.find(item => item.id === TASK);
  assert.equal(task.assignee_id, expectedOwner);
  assert.equal(task.state, 'waiting', 'Taking responsibility does not start waiting work');
  assert.equal(task.blocked_reason, 'Accord client attendu', 'Claiming never grants client consent');
  assert.deepEqual(f.tables.colis, f.originalColis, 'Dossier, consent, measurements and referent remain unchanged');
  assert.equal(f.tables.staff_work_actions.find(item => item.id === OLD_QUOTE).state, 'done');
}

async function openSplit(f) {
  await f.page.goto(`${base}/colis?dossier=${ids.P}`);
  await f.page.getByRole('region', { name: 'Dossier EXP-TEST-001', exact: true }).waitFor();
  await ownership(f).waitFor();
}

async function openDetail(f) {
  await f.page.goto(`${base}/colis/${ids.P}?section=accord`);
  await f.page.getByTestId('dossier-task-header').waitFor();
  await ownership(f).waitFor();
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function scenario(name, run, options) {
    if (process.env.PINTA_TASK_CLAIM_FILTER && !name.includes(process.env.PINTA_TASK_CLAIM_FILTER)) return;
    const f = await fixture(browser, options);
    try {
      await f.login();
      await f.page.getByRole('heading', { name: 'Mon travail', exact: true }).waitFor();
      await run(f);
      assert.deepEqual(f.errors, [], 'No runtime errors');
      assert.deepEqual(f.networkDenied, [], 'No external business calls');
      assert.equal(f.requests.some(request => /\/(queue_message|client_decision|save_quote|save_invoice_review|save_preparation_measurements)$/.test(request.path)), false, 'Claiming does not message a client or advance the business workflow');
      results.push({ test: name, pass: true });
    } catch (error) {
      process.exitCode = 1;
      results.push({ test: name, pass: false, error: error.stack });
      await f.page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, `${name}-failure.txt`), await f.page.locator('body').innerText().catch(() => ''));
    } finally {
      await f.context.close();
      console.log(JSON.stringify(results.at(-1)));
    }
  }
  try {
    await scenario('waiting-unassigned-visible-in-pool-and-one-click-claim', async f => {
      await f.page.goto(`${base}/?section=pool`);
      await f.page.getByRole('region', { name: 'À prendre', exact: true }).waitFor();
      await taskRow(f).waitFor();
      await taskRow(f).getByText('Accord client attendu', { exact: false }).first().waitFor();
      assert.equal(await claimButton(taskRow(f)).isEnabled(), true);
      await claimButton(taskRow(f)).click();
      await f.page.waitForURL(url => url.pathname === `/colis/${ids.P}` && url.searchParams.get('section') === 'accord');
      assert.equal(new URL(f.page.url()).searchParams.get('action'), TASK);
      await ownership(f).getByText('Vous vous en occupez', { exact: true }).waitFor();
      assertPreserved(f);
      await f.page.goto(`${base}/?section=waiting`);
      await taskRow(f).waitFor();
      await taskRow(f).getByText('En attente', { exact: true }).waitFor();
      assert.equal(await claimButton(taskRow(f)).count(), 0);
      await f.page.goto(`${base}/?section=pool`);
      assert.equal(await taskRow(f).count(), 0);
    });

    await scenario('split-direct-claim-stays-in-dossier-and-persists-after-reload', async f => {
      await openSplit(f);
      const before = f.page.url();
      assert.equal(f.claimCalls.length, 0, 'Consultation never claims');
      await claimButton(ownership(f)).click();
      await ownership(f).getByText('Vous vous en occupez', { exact: true }).waitFor();
      assert.equal(f.page.url(), before);
      assert.equal(await claimButton(ownership(f)).count(), 0);
      assertPreserved(f);
      await f.page.reload();
      await ownership(f).getByText('Vous vous en occupez', { exact: true }).waitFor();
      assert.equal(f.claimCalls.length, 1);
    });

    await scenario('refresh-removes-pool-row-before-claim-response-without-losing-success', async f => {
      await f.page.goto(`${base}/?section=pool`);
      await taskRow(f).waitFor();
      await claimButton(taskRow(f)).click();
      await f.claimReceived;
      try {
        await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await taskRow(f).waitFor({ state: 'hidden' });
        assert.equal(new URL(f.page.url()).searchParams.get('section'), 'pool', 'The RPC response is still pending');
      } finally { f.releaseClaimResponse(); }
      await f.page.waitForURL(url => url.pathname === `/colis/${ids.P}` && url.searchParams.get('section') === 'accord');
      await f.page.getByText('Tâche prise en charge. Elle reste en attente.', { exact: true }).waitFor();
      await ownership(f).getByText('Vous vous en occupez', { exact: true }).waitFor();
      assertPreserved(f);
    }, { holdClaimResponse: true });

    await scenario('full-detail-one-click-claim-does-not-start-or-approve', async f => {
      await openDetail(f);
      const before = f.page.url();
      await claimButton(ownership(f)).click();
      await ownership(f).getByText('Vous vous en occupez', { exact: true }).waitFor();
      assert.equal(f.page.url(), before);
      assertPreserved(f);
    });

    await scenario('finished-quote-screen-never-claims-the-reception-task', async f => {
      await f.page.goto(`${base}/colis/${ids.P}?section=devis`);
      await f.page.getByTestId('dossier-task-header').waitFor();
      assert.equal(await ownership(f).count(), 0, 'A quote screen cannot claim a different active task');
      assert.equal(f.claimCalls.length, 0);
      assert.equal(f.tables.staff_work_actions.find(item => item.id === TASK).assignee_id, null);
      assert.deepEqual(f.tables.colis, f.originalColis);
    });

    await scenario('colleagues-task-shows-owner-without-steal-button', async f => {
      await openSplit(f);
      await ownership(f).getByText('Pris en charge par Madly', { exact: true }).waitFor();
      assert.equal(await claimButton(ownership(f)).count(), 0);
      await openDetail(f);
      await ownership(f).getByText('Pris en charge par Madly', { exact: true }).waitFor();
      assert.equal(await claimButton(ownership(f)).count(), 0);
      assert.equal(f.claimCalls.length, 0);
    }, { otherOwner: true });

    await scenario('concurrent-claim-shows-error-and-refreshes-colleague-without-retry', async f => {
      await openSplit(f);
      const before = f.page.url();
      await claimButton(ownership(f)).click();
      await f.page.getByRole('alert').filter({ hasText: /tâche a changé/ }).first().waitFor();
      await ownership(f).getByText('Pris en charge par Madly', { exact: true }).waitFor();
      assert.equal(await claimButton(ownership(f)).count(), 0);
      assert.equal(f.page.url(), before);
      assertPreserved(f, B);
    }, { conflict: true });

    await scenario('reception-permission-required-even-when-dossier-is-visible', async f => {
      await openDetail(f);
      assert.equal(await claimButton(ownership(f)).count(), 0);
      await f.page.goto(`${base}/?section=pool`);
      assert.equal(await taskRow(f).count(), 0);
      assert.equal(f.claimCalls.length, 0);
    }, { restricted: true });

    await scenario('split-selects-authorized-task-without-claiming-forbidden-reception', async f => {
      const preparation = '77777777-0000-4000-8000-000000000003';
      f.tables.staff_work_actions.push({
        id: preparation, colis_id: ids.P, kind: 'preparation', state: 'waiting',
        assignee_id: null, blocked_reason: 'Accord client requis', version: 1,
        created_at: '2026-09-18T02:06:00Z',
      });
      await openSplit(f);
      const panel = f.page.getByRole('region', { name: 'Dossier EXP-TEST-001', exact: true });
      await panel.getByRole('button', { name: 'Préparer les colis', exact: true }).waitFor();
      await claimButton(ownership(f)).click();
      await ownership(f).getByText('Vous vous en occupez', { exact: true }).waitFor();
      assert.deepEqual(f.claimCalls, [{ p_action_id: preparation, p_command: 'claim', p_expected_version: 1, p_payload: {} }]);
      assert.equal(f.tables.staff_work_actions.find(item => item.id === preparation).assignee_id, ids.A);
      assert.equal(f.tables.staff_work_actions.find(item => item.id === preparation).state, 'waiting');
      assert.equal(f.tables.staff_work_actions.find(item => item.id === TASK).assignee_id, null);
      assert.deepEqual(f.tables.colis, f.originalColis);
      await panel.getByRole('button', { name: 'Préparer les colis', exact: true }).click();
      await f.page.waitForURL(url => url.pathname === `/colis/${ids.P}` && url.searchParams.get('section') === 'preparation' && url.searchParams.get('action') === preparation);
      await ownership(f).getByText('Vous vous en occupez', { exact: true }).waitFor();
    }, { restricted: true });

    await scenario('unavailable-user-cannot-claim-waiting-task', async f => {
      await openDetail(f);
      const button = claimButton(ownership(f));
      if (await button.count()) assert.equal(await button.isDisabled(), true);
      await ownership(f).getByText(/indisponibilit|disponible/i).waitFor();
      assert.equal(f.claimCalls.length, 0);
    }, { unavailable: true });

    for (const mobile of [false, true]) await scenario(`one-click-claim-accessibility-${mobile ? 'mobile' : 'desktop'}`, async f => {
      await f.page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      if (mobile) await openDetail(f); else await openSplit(f);
      const button = claimButton(ownership(f));
      await button.scrollIntoViewIfNeeded();
      const bounds = await button.boundingBox();
      assert.ok(bounds.width >= 44 && bounds.height >= 44, 'Claim control has a usable touch target');
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'No horizontal overflow');
      const axe = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
      await f.page.screenshot({ path: path.join(output, `${mobile ? 'mobile-detail' : 'desktop-split'}.png`), fullPage: true });
      await button.focus();
      await f.page.keyboard.press('Enter');
      await ownership(f).getByText('Vous vous en occupez', { exact: true }).waitFor();
      assertPreserved(f);
    });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
