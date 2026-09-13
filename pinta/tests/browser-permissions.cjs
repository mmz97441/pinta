/* Permission persistence regression. Every backend/provider request uses local fixtures. */
const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const { setup, base, ids } = require('./browser-regression.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = process.env.PINTA_PERMISSIONS_OUT || path.resolve(__dirname, '../../docs/verification-permissions-2026-09-12');
const TARGET = '77777777-7777-4777-8777-777777777777';
const TARGET_AUTH = '88888888-8888-4888-8888-888888888888';
const SECOND = '99999999-9999-4999-8999-999999999999';
let categories, keys;
const results = [];
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(browser, { relation = 'object', initial = {}, role = 'directeur' } = {}) {
  const f = await setup(browser, role);
  f.page.setDefaultTimeout(12000);
  const permissions = overrides => Object.fromEntries(keys.map(key => [key, Object.hasOwn(overrides, key) && overrides[key] === null ? null : overrides[key] === true]));
  const row = (id, values) => ({ id: id === TARGET ? '70000000-0000-4000-8000-000000000001' : id === SECOND ? '70000000-0000-4000-8000-000000000002' : '70000000-0000-4000-8000-000000000003', staff_id: id, ...permissions(values) });
  const records = new Map();
  const user = { id: TARGET, auth_id: TARGET_AUTH, nom: 'Mesures', prenom: 'Alex', email: 'alex@example.test', role: 'preparateur', actif: true, must_change_password: false };
  const other = { id: SECOND, auth_id: '90000000-0000-4000-8000-000000000001', nom: 'Transport', prenom: 'Jo', email: 'jo@example.test', role: 'logisticien', actif: true, must_change_password: false };
  f.tables.staff_users.push(user, other);
  const write = (id, value) => {
    const item = f.tables.staff_users.find(candidate => candidate.id === id);
    records.set(id, value == null ? null : clone(value));
    item.staff_permissions = value == null ? null : relation === 'array' ? [clone(value)] : clone(value);
    f.tables.staff_permissions = [...records.values()].filter(Boolean).map(clone);
  };
  write(TARGET, relation === 'null' ? null : row(TARGET, initial));
  write(SECOND, row(SECOND, {}));
  // An explicit false row must not reduce the role's immutable full-access rule.
  write(ids.S, row(ids.S, role === 'directeur' ? {} : initial));
  const calls = [], directWrites = [], accessReads = [];
  f.page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/rest/v1/staff_users' && request.method() === 'GET') accessReads.push(url.search);
    if (['/rest/v1/staff_permissions', '/rest/v1/staff_users'].includes(url.pathname) && request.method() !== 'GET') directWrites.push({ method: request.method(), path: url.pathname });
  });
  const control = { failNext: null, gate: null };
  await f.context.route('**/rest/v1/rpc/save_staff_permissions', async route => {
    const payload = route.request().postDataJSON(); calls.push(clone(payload));
    const gate = control.gate;
    if (gate) { gate.entered.resolve(); await gate.release.promise; control.gate = null; }
    let failure = control.failNext; control.failNext = null;
    const staff = f.tables.staff_users.find(item => item.id === payload.p_staff_id);
    const patch = payload.p_permissions;
    const current = records.get(payload.p_staff_id);
    const baseline = payload.p_expected_permissions;
    if (!failure && (!staff || !patch || typeof patch !== 'object' || Array.isArray(patch) || Object.entries(patch).some(([key, value]) => !keys.includes(key) || typeof value !== 'boolean'))) failure = { code: '22023', message: 'Permission ou valeur invalide.' };
    if (!failure && baseline !== null && (typeof baseline !== 'object' || Array.isArray(baseline) || Object.keys(patch).some(key => typeof baseline?.[key] !== 'boolean'))) failure = { code: '22023', message: 'Une valeur de référence booléenne est requise pour chaque permission modifiée.' };
    if (!failure && ['directeur', 'vice_directeur'].includes(staff.role)) failure = { code: '42501', message: 'Les accès de direction sont fixes.' };
    if (!failure && (baseline === null ? current !== null : current === null || Object.keys(patch).some(key => baseline[key] !== (current[key] === true)))) failure = { code: '40001', message: 'Les permissions ont été modifiées par un autre administrateur. Rechargez avant de recommencer.' };
    if (failure) return route.fulfill({ status: failure.code === '40001' ? 409 : 500, contentType: 'application/json', body: JSON.stringify(failure) });
    const saved = { ...(current || row(payload.p_staff_id, {})), ...patch };
    write(payload.p_staff_id, saved);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) });
  });
  return { ...f, calls, directWrites, accessReads, records, write, control };
}
async function openPermissions(f, userName = 'Alex Mesures') {
  await f.page.goto(`${base}/settings`);
  await f.page.getByRole('button', { name: 'Équipe et accès', exact: true }).click();
  await selectUser(f, userName);
}
async function selectUser(f, name) {
  await f.page.getByRole('group', { name: 'Utilisateurs de l’équipe', exact: true }).getByRole('button').filter({ hasText: name }).click();
}
const check = (f, label) => f.page.getByRole('checkbox', { name: label, exact: true });
const save = f => f.page.getByRole('button', { name: 'Enregistrer les permissions', exact: true });
const bar = f => f.page.getByRole('region', { name: 'Enregistrement des permissions', exact: true });
async function saved(f) { await f.page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Enregistrer les permissions'); return button && button.disabled && !document.body.innerText.includes('Enregistrement…'); }); }
async function noWrites(f, expectedRPCs = 0) { assert.equal(f.calls.length, expectedRPCs, 'Only an explicit save may write permissions'); assert.deepEqual(f.directWrites, [], 'Permissions must use the transactional RPC, never direct table writes'); }

async function main() {
  ({ PERMISSION_CATEGORIES: categories } = await import('../src/expedile/constants/permissions.js'));
  keys = categories.flatMap(category => category.permissions.map(permission => permission.key));
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const scenario = async (name, options, action) => {
    if (process.env.PINTA_PERMISSIONS_FILTER && !name.includes(process.env.PINTA_PERMISSIONS_FILTER)) return;
    const f = await fixture(browser, options);
    try {
      await f.login();
      const detail = await action(f);
      assert.deepEqual(f.errors, [], 'No uncaught application exception');
      assert.deepEqual(f.networkDenied, [], 'No unexpected provider request');
      assert.deepEqual(f.directWrites, [], 'No direct permission mutation');
      results.push({ test: name, pass: true, rpcCalls: f.calls.length, ...detail });
    } catch (error) {
      await f.page.screenshot({ path: path.join(out, `${name}-failure.png`), fullPage: true }).catch(() => {});
      results.push({ test: name, pass: false, error: error.stack, rpcCalls: f.calls, pageErrors: f.errors, unexpectedNetwork: f.networkDenied });
      process.exitCode = 1;
    } finally {
      f.control.gate?.release.resolve();
      await f.context.close();
    }
    console.log(JSON.stringify(results.at(-1)));
  };
  try {
    await scenario('object-relation-false-persist-reload-double-save', { initial: { perm_colis_mesurer: true } }, async f => {
      await openPermissions(f);
      assert.equal(await check(f, 'Mesurer / peser').isChecked(), true, 'One-to-one relation object must preserve a stored true');
      assert.equal(await check(f, 'Calculer le devis').isChecked(), false);
      await f.page.screenshot({ path: path.join(out, 'desktop-permissions-object.png') });
      await check(f, 'Mesurer / peser').uncheck();
      await noWrites(f);
      assert.equal(f.records.get(TARGET).perm_colis_mesurer, true, 'Editing the draft does not modify persistence');
      const gate = { entered: deferred(), release: deferred() }; f.control.gate = gate;
      await save(f).evaluate(button => { button.click(); button.click(); });
      await gate.entered.promise;
      assert.equal(f.calls.length, 1, 'Two clicks during the same task produce one RPC');
      assert.equal(await bar(f).getByRole('button', { name: 'Enregistrement…', exact: true }).isDisabled(), true);
      assert.deepEqual(f.calls[0].p_permissions, { perm_colis_mesurer: false });
      assert.equal(f.calls[0].p_expected_permissions.perm_colis_mesurer, true);
      const readsBefore = f.accessReads.length;
      const refreshedAccess = f.page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/rest/v1/staff_users');
      gate.release.resolve(); await refreshedAccess; await saved(f);
      assert.equal(f.records.get(TARGET).perm_colis_mesurer, false);
      assert.ok(f.accessReads.length > readsBefore, 'Successful save refreshes application access before a manual reload');
      await f.page.waitForFunction(() => !document.body.innerText.includes('Enregistrement en cours'));
      await openPermissions(f);
      assert.equal(await check(f, 'Mesurer / peser').isChecked(), false, 'False survives a fresh page load');
      return { explicitFalse: true, sameTaskDoubleClickRPCs: 1, accessReadCountBeforeRelease: readsBefore, accessReadsAfterSaveAndReload: f.accessReads.length };
    });

    await scenario('array-relation-compatibility', { relation: 'array', initial: { perm_clients_voir: true } }, async f => {
      await openPermissions(f);
      assert.equal(await check(f, 'Voir les clients').isChecked(), true);
      await check(f, 'Mesurer / peser').check(); await noWrites(f);
      await save(f).click(); await saved(f);
      assert.deepEqual(f.calls[0].p_permissions, { perm_colis_mesurer: true });
      assert.equal(f.calls[0].p_expected_permissions.perm_colis_mesurer, false);
      await openPermissions(f); assert.equal(await check(f, 'Mesurer / peser').isChecked(), true);
      return { arrayCompatibility: true };
    });

    await scenario('missing-row-null-baseline-no-invented-defaults', { relation: 'null' }, async f => {
      await openPermissions(f);
      assert.equal(await f.page.getByRole('checkbox').evaluateAll(items => items.filter(item => item.checked).length), 0);
      await check(f, 'Mesurer / peser').check(); await noWrites(f);
      await save(f).click(); await saved(f);
      assert.equal(f.calls[0].p_expected_permissions, null);
      assert.deepEqual(f.calls[0].p_permissions, { perm_colis_mesurer: true });
      assert.equal(f.records.get(TARGET).perm_colis_mesurer, true);
      assert.equal(f.records.get(TARGET).perm_colis_calculer_devis, false);
      await openPermissions(f); assert.equal(await check(f, 'Mesurer / peser').isChecked(), true);
      return { missingRowCreatedWithOneExplicitPermission: true };
    });

    await scenario('historical-null-flag-uses-false-baseline', { initial: { perm_colis_mesurer: null } }, async f => {
      await openPermissions(f);
      assert.equal(f.records.get(TARGET).perm_colis_mesurer, null);
      assert.equal(await check(f, 'Mesurer / peser').isChecked(), false);
      await check(f, 'Mesurer / peser').check(); await noWrites(f);
      await save(f).click(); await saved(f);
      assert.equal(f.calls[0].p_expected_permissions.perm_colis_mesurer, false, 'A null flag means false, unlike a missing permission row');
      assert.equal(f.records.get(TARGET).perm_colis_mesurer, true);
      return { historicalNullNormalizedToBooleanBaseline: true };
    });

    await scenario('category-tout-aucun-one-rpc-per-save', {}, async f => {
      await openPermissions(f);
      const category = f.page.getByRole('region', { name: 'Colis', exact: true });
      const colisKeys = categories.find(item => item.key === 'colis').permissions.map(item => item.key);
      await category.getByRole('button', { name: 'Tout', exact: true }).click(); await noWrites(f);
      assert.equal(await category.getByRole('checkbox').evaluateAll(items => items.every(item => item.checked)), true);
      await save(f).click(); await saved(f);
      assert.deepEqual(f.calls[0].p_permissions, Object.fromEntries(colisKeys.map(key => [key, true])));
      await category.getByRole('button', { name: 'Aucun', exact: true }).click(); await noWrites(f, 1);
      assert.equal(await category.getByRole('checkbox').evaluateAll(items => items.every(item => !item.checked)), true);
      await save(f).click(); await saved(f); await noWrites(f, 2);
      assert.deepEqual(f.calls[1].p_permissions, Object.fromEntries(colisKeys.map(key => [key, false])));
      return { categorySize: colisKeys.length, localBatchActions: 2, atomicSaves: 2 };
    });

    await scenario('conflict-preserves-draft-until-explicit-reload', {}, async f => {
      await openPermissions(f); await check(f, 'Mesurer / peser').check();
      // A concurrent administrator changed that same permission after this draft was opened.
      f.write(TARGET, { ...f.records.get(TARGET), perm_colis_mesurer: true });
      await save(f).click();
      const alert = f.page.getByRole('alert').filter({ hasText: /modifi|administrateur|conflit/i }); await alert.waitFor();
      assert.equal(await check(f, 'Mesurer / peser').isChecked(), true);
      assert.equal(await save(f).isDisabled(), false, 'Rejected save must retain pending changes');
      await selectUser(f, 'Jo Transport'); await selectUser(f, 'Alex Mesures');
      await alert.waitFor(); assert.equal(await check(f, 'Mesurer / peser').isChecked(), true);
      assert.equal(f.calls.length, 1);
      await f.page.getByRole('button', { name: 'Recharger et remplacer ce brouillon', exact: true }).click();
      await saved(f); assert.equal(await check(f, 'Mesurer / peser').isChecked(), true, 'Explicit reload uses the real concurrent value');
      return { conflictVisible: true, draftRetainedAcrossSelection: true, explicitReload: true };
    });

    await scenario('unrelated-concurrent-permission-is-preserved', {}, async f => {
      await openPermissions(f); await check(f, 'Mesurer / peser').check();
      f.write(TARGET, { ...f.records.get(TARGET), perm_clients_voir: true });
      await save(f).click(); await saved(f);
      assert.deepEqual(f.calls[0].p_permissions, { perm_colis_mesurer: true });
      assert.equal(f.records.get(TARGET).perm_clients_voir, true);
      assert.equal(await check(f, 'Voir les clients').isChecked(), true, 'Server response preserves and displays the independent change');
      return { changedKeysOnly: true, independentAdministratorChangePreserved: true };
    });

    await scenario('server-error-retains-draft-and-retry', {}, async f => {
      await openPermissions(f); await check(f, 'Mesurer / peser').check();
      f.control.failNext = { code: 'XX000', message: 'Échec de sauvegarde simulé pour la recette' };
      await save(f).click(); await f.page.getByRole('alert').filter({ hasText: /Échec de sauvegarde simulé/ }).waitFor();
      assert.equal(await check(f, 'Mesurer / peser').isChecked(), true); assert.equal(f.records.get(TARGET).perm_colis_mesurer, false);
      assert.doesNotMatch(await f.page.locator('body').innerText(), /Permissions enregistrées/);
      assert.equal(await save(f).isDisabled(), false);
      await save(f).click(); await saved(f);
      assert.equal(f.records.get(TARGET).perm_colis_mesurer, true);
      assert.deepEqual(f.calls[0], f.calls[1], 'Retry sends the original draft and baseline');
      return { failureNeverDisplayedAsSuccess: true, retryPreservesPayload: true };
    });

    await scenario('successful-save-refresh-failure-retries-read-only', {}, async f => {
      await openPermissions(f); await check(f, 'Mesurer / peser').check();
      let failAccessReads = true;
      await f.context.route('**/rest/v1/staff_users*', async route => {
        if (failAccessReads && route.request().method() === 'GET') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Actualisation indisponible pour la recette' }) });
        return route.fallback();
      });
      await save(f).click();
      await f.page.getByRole('alert').filter({ hasText: 'Permissions enregistrées. Actualisation à réessayer' }).waitFor();
      assert.equal(f.records.get(TARGET).perm_colis_mesurer, true, 'The RPC really saved before the independent refresh failed');
      assert.equal(await save(f).isDisabled(), true, 'A successful mutation must not be offered again');
      assert.equal(f.calls.length, 1);
      failAccessReads = false;
      await f.page.getByRole('button', { name: 'Réessayer l’actualisation des accès', exact: true }).click();
      await f.page.getByRole('status').filter({ hasText: 'Permissions enregistrées et accès actualisés.' }).waitFor();
      assert.equal(f.calls.length, 1, 'Refresh recovery must never repeat the save RPC');
      assert.equal(await check(f, 'Mesurer / peser').isChecked(), true);
      return { persistedBeforeRefreshFailure: true, refreshRetryWrites: 0 };
    });

    await scenario('per-user-drafts-and-direction-fixed-access', {}, async f => {
      await openPermissions(f); await check(f, 'Mesurer / peser').check();
      await selectUser(f, 'Jo Transport'); assert.equal(await check(f, 'Mesurer / peser').isChecked(), false);
      await check(f, 'Voir les envois').check();
      await selectUser(f, 'Alex Mesures'); assert.equal(await check(f, 'Mesurer / peser').isChecked(), true); assert.equal(await check(f, 'Voir les envois').isChecked(), false);
      await noWrites(f); await save(f).click(); await saved(f);
      assert.equal(f.calls[0].p_staff_id, TARGET);
      await selectUser(f, 'Jo Transport'); assert.equal(await check(f, 'Voir les envois').isChecked(), true);
      assert.equal(f.records.get(SECOND).perm_envois_voir, false, 'Saving Alex never writes Jo’s draft');
      await f.page.getByRole('button', { name: 'Messages', exact: true }).click();
      await f.page.getByRole('button', { name: 'Équipe et accès', exact: true }).click();
      await selectUser(f, 'Jo Transport'); assert.equal(await check(f, 'Voir les envois').isChecked(), true, 'A settings-tab change must retain unsaved values');
      await selectUser(f, 'Test Camille'); await f.page.getByText('Accès total lié au rôle', { exact: false }).waitFor();
      assert.equal(await f.page.getByRole('checkbox').count(), 0);
      if (await save(f).count()) assert.equal(await save(f).isDisabled(), true, 'Immutable direction rights cannot be edited');
      await noWrites(f, 1);
      return { draftsIsolatedByUser: true, settingsTabRetainsDraft: true, directionImmutable: true };
    });

    await scenario('mobile-save-accessible-after-long-permission-scroll', {}, async f => {
      await f.page.setViewportSize({ width: 390, height: 844 }); await openPermissions(f);
      await check(f, 'Mesurer / peser').check();
      await f.page.getByRole('checkbox').last().scrollIntoViewIfNeeded();
      const buttonBox = await save(f).boundingBox();
      assert.ok(buttonBox && buttonBox.y >= 0 && buttonBox.y + buttonBox.height <= 844 && buttonBox.width >= 44 && buttonBox.height >= 44, JSON.stringify(buttonBox));
      assert.equal(await save(f).evaluate(button => { const rect = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }), true, 'The mobile navigation must not cover the save action');
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await f.page.locator('button button').count(), 0, 'Category actions must not be nested inside another button');
      await f.page.screenshot({ path: path.join(out, 'mobile-permissions-save.png') });
      await save(f).click(); await saved(f); assert.equal(f.records.get(TARGET).perm_colis_mesurer, true);
      return { viewport: '390×844', saveButton: buttonBox, noHorizontalOverflow: true };
    });

    await scenario('connected-worker-permissions-refresh-on-window-focus', { role: 'preparateur', initial: { perm_colis_receptionner: true } }, async f => {
      const create = f.page.getByRole('button', { name: 'Réceptionner des cartons', exact: true }); await create.waitFor();
      f.write(ids.S, { ...f.records.get(ids.S), perm_colis_receptionner: false });
      const read = f.page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/rest/v1/staff_users');
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await read;
      await create.waitFor({ state: 'hidden' });
      assert.equal(f.calls.length, 0, 'Refresh does not write permissions');
      f.write(ids.S, { ...f.records.get(ids.S), perm_colis_receptionner: true });
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await create.waitFor();
      return { revokedPermissionImmediatelyHiddenAfterFocus: true, restoredPermissionVisibleAfterFocus: true };
    });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ base, passed: results.filter(result => result.pass).length, total: results.length, results }, null, 2));
    console.log(`Permissions browser regression: ${results.filter(result => result.pass).length}/${results.length} passed.`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
