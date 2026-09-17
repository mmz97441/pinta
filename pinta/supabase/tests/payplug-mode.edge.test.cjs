const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const esbuild = require('../../node_modules/esbuild');
const root = path.resolve(__dirname, '../functions');
const bundles = new Map();
async function handler(name, {env = {}, db = {}, fetch = async () => { throw new Error('Unexpected network request'); }} = {}) {
  if (!bundles.has(name)) {
    const result = await esbuild.build({ entryPoints:[path.join(root,name,'index.ts')],bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'mock-supabase',setup(build){build.onResolve({filter:/^https:\/\/esm.sh\/@supabase\//},()=>({path:'supabase',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=()=>globalThis.__db;',loader:'js'}));}}] });
    bundles.set(name,result.outputFiles[0].text);
  }
  let serve;
  const context={__db:db,Deno:{env:{get:key=>env[key]},serve:fn=>{serve=fn;}},Request,Response,URL,TextEncoder,Uint8Array,ArrayBuffer,AbortSignal,crypto:webcrypto,fetch,btoa:(s)=>Buffer.from(s,'binary').toString('base64'),console:{log(){},warn(){},error(){}},setTimeout,clearTimeout};
  vm.runInNewContext(bundles.get(name),context);return serve;
}
const req=(body,headers={})=>new Request('http://localhost/functions/test',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
function database(tables={}, rpc=()=>({data:null,error:null}), authUser={id:'10000000-0000-4000-8000-000000000001',email:'staff@example.test'}) {
 return {auth:{getUser:async()=>authUser?({data:{user:authUser},error:null}):({data:{user:null},error:{message:'invalid'}})},rpc:async(name,args)=>rpc(name,args),from(table){let filters={};let mutation;const q={select(){return q;},eq(k,v){filters[k]=v;return q;},in(){return q;},update(value){mutation=value;return q;},insert(value){mutation=value;return q;},single:async()=>resolve(),maybeSingle:async()=>resolve(),then(a,b){return Promise.resolve(resolve()).then(a,b)}};function resolve(){return typeof tables[table]==='function'?tables[table]({filters,mutation}):{data:tables[table]||null,error:null};}return q;}};
}

const colisId = '30000000-0000-4000-8000-000000000001';
const common = { APP_URL: 'https://app.example.test', SUPABASE_URL: 'https://fixture.supabase.co' };
const payment = { id: 'pay_modeFixture', object: 'payment', is_live: true, is_paid: true, amount: 4000, currency: 'EUR', metadata: { colis_id: colisId, quote_version: '2' } };
function staffDb(old = null, mutations = []) {
 return database({ profiles: { id: 'staff', role: 'directeur', actif: true },
  colis: ({ mutation }) => { if (mutation) mutations.push(['colis', mutation]); return { data: { id: colisId, client_id: 'client', ref: 'EXP', devis_total: 40, quote_version: 2, statut: 'en_preparation' }, error: null }; },
  clients: { nom: 'Example', prenom: 'Camille', email: 'camille@example.test', adresse: '1 rue Exemple', ville: 'Saint-Denis', cp: '97400', type: 'particulier' },
  payment_intents: ({ mutation }) => { if (mutation) { mutations.push(['intent', mutation]); return { data: { id: 'intent', ...mutation }, error: null }; } return { data: old, error: null }; },
 });
}
test('creation refuses a test key in live/default mode before intent creation or any provider call', async () => {
 for (const mode of [undefined, 'live', 'invalid']) {
  const mutations = []; const run = await handler('payplug-create', { env: { ...common, PAYPLUG_SECRET_KEY: 'sk_test_fixture', ...(mode ? { PAYPLUG_MODE: mode } : {}) }, db: staffDb(null, mutations) });
  const response = await run(req({ colisId }, { authorization: 'Bearer staff' }));
  assert.equal(response.status, 503); assert.equal(mutations.length, 0);
 }
});
test('pending test or unknown-mode intents cannot be reused by a live checkout', async () => {
 for (const flag of [false, null]) {
  const run = await handler('payplug-create', { env: { ...common, PAYPLUG_SECRET_KEY: 'sk_live_fixture', PAYPLUG_MODE: 'live' }, db: staffDb({ id: 'intent', provider_is_live: flag, payment_url: 'https://secure.payplug.com/test', status: 'pending' }) });
  assert.equal((await run(req({ colisId }, { authorization: 'Bearer staff' }))).status, 409);
 }
});
test('explicit test mode creates a simulated payment with the test key and retains its mode', async () => {
 const mutations = []; let requests = 0;
 const run = await handler('payplug-create', { env: { ...common, PAYPLUG_SECRET_KEY: 'sk_test_fixture', PAYPLUG_MODE: 'test' }, db: staffDb(null, mutations), fetch: async (_url, options) => {
  requests++; const sent = JSON.parse(options.body);
  assert.equal(options.headers.Authorization, 'Bearer sk_test_fixture');
  return Response.json({ ...payment, is_live: false, metadata: sent.metadata, hosted_payment: { payment_url: 'https://secure.payplug.com/test-fixture' } });
 } });
 const response = await run(req({ colisId }, { authorization: 'Bearer staff' }));
 assert.equal(response.status, 200); assert.equal(requests, 1);
 assert.equal(mutations[0][1].provider_is_live, false);
 assert.equal((await response.json()).paymentUrl, 'https://secure.payplug.com/test-fixture');
});
test('test mode refuses a live key before creating an intent or calling the provider', async () => {
 const mutations = [];
 const run = await handler('payplug-create', { env: { ...common, PAYPLUG_SECRET_KEY: 'sk_live_fixture', PAYPLUG_MODE: 'test' }, db: staffDb(null, mutations) });
 assert.equal((await run(req({ colisId }, { authorization: 'Bearer staff' }))).status, 503);
 assert.equal(mutations.length, 0);
});
test('modern simulated payment notification is accepted only in the explicit test environment', async () => {
 let calls = 0;
 const run = await handler('payplug-webhook', { env: { PAYPLUG_SECRET_KEY: 'sk_test_fixture', PAYPLUG_MODE: 'test' }, db: database({}, (name, args) => {
  calls++; assert.equal(name, 'confirm_payplug_payment'); assert.equal(args.p_provider_id, payment.id);
  return { data: { id: colisId }, error: null };
 }), fetch: async () => Response.json({ ...payment, is_live: false }) });
 assert.equal((await run(req({ id: payment.id, object: 'payment' }))).status, 200);
 assert.equal(calls, 1);
});
test('live creation records provider mode and validates the returned resource before linking', async () => {
 for (const returnedMode of [true, false]) {
  const mutations = []; const run = await handler('payplug-create', { env: { ...common, PAYPLUG_SECRET_KEY: 'sk_live_fixture', PAYPLUG_MODE: 'live' }, db: staffDb(null, mutations), fetch: async (_url, options) => {
   const sent = JSON.parse(options.body); return Response.json({ ...payment, is_live: returnedMode, metadata: sent.metadata, hosted_payment: { payment_url: 'https://secure.payplug.com/live-fixture' } });
  } });
  const response = await run(req({ colisId }, { authorization: 'Bearer staff' }));
  assert.equal(response.status, returnedMode ? 200 : 502); assert.equal(mutations[0][1].provider_is_live, true);
  assert.equal(mutations.some(([table]) => table === 'colis'), returnedMode);
 }
});
test('live webhook never sends a modern test resource to the payment confirmation command', async () => {
 let calls = 0;
 const run = await handler('payplug-webhook', { env: { PAYPLUG_SECRET_KEY: 'sk_test_fixture', PAYPLUG_MODE: 'live' }, db: database({}, () => { calls++; return { data: {}, error: null }; }), fetch: async () => Response.json({ ...payment, is_live: false }) });
 assert.equal((await run(req({ id: payment.id, object: 'payment' }))).status, 409); assert.equal(calls, 0);
});
test('historical test resources use acknowledgement-only endpoint, never a modern or live legacy credit command', async () => {
 for (const alreadyPaid of [true, false]) {
  const run = await handler('payplug-webhook', { env: { PAYPLUG_SECRET_KEY: 'sk_test_fixture', PAYPLUG_MODE: 'live' }, db: database({}, (name) => { assert.equal(name, 'ack_legacy_test_payplug_payment'); return alreadyPaid ? { data: { id: colisId, alreadyPaid: true }, error: null } : { data: null, error: { message: 'Test cannot create a receipt' } }; }), fetch: async () => Response.json({ ...payment, is_live: false, billing: { email: 'legacy@example.test' }, metadata: { colis_id: colisId, colis_ref: 'EXP' } }) });
  const response = await run(req({ id: payment.id, object: 'payment' })); assert.equal(response.status, alreadyPaid ? 200 : 409);
  if (alreadyPaid) { const result = await response.json(); assert.equal(result.paymentMode, 'test'); assert.equal(result.financialConfirmation, false); }
 }
});
test('modern live resources retain exact provider verification and normal confirmation', async () => {
 let called = false;
 const run = await handler('payplug-webhook', { env: { PAYPLUG_SECRET_KEY: 'sk_live_fixture', PAYPLUG_MODE: 'live' }, db: database({}, (name,args) => { called = true; assert.equal(name, 'confirm_payplug_payment'); assert.equal(args.p_provider_id, payment.id); return { data: { id: colisId }, error: null }; }), fetch: async () => Response.json(payment) });
 assert.equal((await run(req({ id: payment.id, object: 'payment' }))).status, 200); assert.equal(called, true);
});

test('a refunded modern resource cannot produce a first full receipt', async () => {
 let calls = 0;
 const run = await handler('payplug-webhook', { env: { PAYPLUG_SECRET_KEY: 'sk_live_fixture', PAYPLUG_MODE: 'live' }, db: database({}, () => { calls++; return { data: {}, error: null }; }), fetch: async () => Response.json({ ...payment, amount_refunded: 4000 }) });
 assert.equal((await run(req({ id: payment.id, object: 'payment' }))).status, 409); assert.equal(calls, 0);
});
