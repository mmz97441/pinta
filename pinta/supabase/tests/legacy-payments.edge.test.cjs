const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('../../node_modules/esbuild');
const colisId = '30000000-0000-4000-8000-000000000001';
const legacyPayment = { id: 'pay_legacyPending', object: 'payment', is_live: true, is_paid: true, amount: 3798, currency: 'EUR', billing: { email: 'buyerlegacy@example.test' }, metadata: { colis_id: colisId, colis_ref: 'EXP-LEGACY' } };
let bundled;
async function handler(payment, rpc) {
  if (!bundled) bundled = (await build({ entryPoints: [path.join(__dirname, '../functions/payplug-webhook/index.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', plugins: [{ name: 'mock-supabase', setup(builder) {
    builder.onResolve({ filter: /^https:\/\/esm.sh\/@supabase\// }, () => ({ path: 'db', namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClient=()=>globalThis.db;', loader: 'js' }));
  } }] })).outputFiles[0].text;
  let serve;
  const calls = [];
  vm.runInNewContext(bundled, { db: { rpc: async (name, args) => { calls.push({ name, args }); return rpc ? rpc(name, args) : { data: { id: colisId, alreadyPaid: false }, error: null }; } }, Deno: { env: { get: (key) => key === 'PAYPLUG_SECRET_KEY' ? 'sk_live_fixture' : undefined }, serve: (fn) => { serve = fn; } }, Request, Response, URL, AbortSignal, console: { error() {} }, fetch: async (url, options) => {
    assert.equal(url, 'https://api.payplug.com/v1/payments/pay_legacyPending');
    assert.equal(options.headers.Authorization, 'Bearer sk_live_fixture');
    return Response.json(payment);
  } });
  return { calls, run: (extra = {}) => serve(new Request('http://localhost/webhook', { method: 'POST', body: JSON.stringify({ id: 'pay_legacyPending', object: 'payment', ...extra }) })) };
}
test('legacy payment uses retrieved provider resource and the restricted legacy command', async () => {
  const { calls, run } = await handler(legacyPayment);
  const response = await run({ amount: 1, metadata: { colis_id: 'forged' }, billing: { email: 'forged@example.test' } });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'confirm_legacy_payplug_payment');
  assert.equal(calls[0].args.p_payment.amount, 3798);
  assert.equal(calls[0].args.p_payment.metadata.colis_id, colisId);
  assert.equal(calls[0].args.p_payment.billing.email, legacyPayment.billing.email);
});
test('already paid legacy notification is acknowledged without requesting another payment command', async () => {
  const { calls, run } = await handler(legacyPayment, () => ({ data: { id: colisId, alreadyPaid: true }, error: null }));
  const response = await run(); assert.equal(response.status, 200);
  assert.equal((await response.json()).alreadyPaid, true); assert.equal(calls.length, 1);
});
test('legacy missing metadata, billing identity or a modern intent never reaches compatibility command', async () => {
  for (const patch of [{ metadata: { colis_id: colisId } }, { billing: {} }, { metadata: { ...legacyPayment.metadata, intent_id: 'modern-intent' } }, { metadata: { ...legacyPayment.metadata, quote_version: 0 } }, { metadata: { ...legacyPayment.metadata, quote_version: null } }]) {
    const { calls, run } = await handler({ ...legacyPayment, ...patch });
    assert.equal((await run()).status, 400); assert.equal(calls.length, 0);
  }
});
test('legacy unknown provider or changed snapshot remains a reconciliation error', async () => {
  const { calls, run } = await handler(legacyPayment, () => ({ data: null, error: { message: 'Unregistered or superseded legacy link' } }));
  assert.equal((await run()).status, 409); assert.equal(calls.length, 1);
});
test('versioned payment retains the modern command and cannot fall back when rejected', async () => {
  const { calls, run } = await handler({ ...legacyPayment, metadata: { colis_id: colisId, quote_version: '2' } }, () => ({ data: null, error: { message: 'Wrong modern intent' } }));
  assert.equal((await run()).status, 409); assert.equal(calls.length, 1); assert.equal(calls[0].name, 'confirm_payplug_payment');
});
test('unpaid, wrong currency and wrong mode legacy resources never invoke a payment command', async () => {
  for (const patch of [{ is_paid: false }, { currency: 'USD' }, { is_live: false }]) {
    const { calls, run } = await handler({ ...legacyPayment, ...patch });
    assert.equal((await run()).status, patch.is_paid === false ? 200 : 400); assert.equal(calls.length, 0);
  }
});
test('refunded legacy resources require reconciliation and never record a new receipt', async () => {
  const { calls, run } = await handler({ ...legacyPayment, amount_refunded: 3798 });
  assert.equal((await run()).status, 409); assert.equal(calls.length, 0);
});
