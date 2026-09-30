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

const colisId='30000000-0000-4000-8000-000000000001';
const token='ab'.repeat(32);
const receipt={ok:true,status:'pending',reference:'EXP-RETURN',amountCents:4000,currency:'EUR',paidAt:null,isLive:false,shipment:{status:'unavailable',departureDate:null,departedAt:null,deliveredAt:null}};
const sha=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
test('capability works without session and is hashed before the only read-only RPC',async()=>{
 let calls=0;
 const run=await handler('get-payment-return',{db:database({},(name,args)=>{
  calls++;assert.equal(name,'get_payment_return');assert.equal(args.p_token_hash,sha(token));assert.equal(args.p_colis_id,null);assert.equal(args.p_actor_id,null);
  return {data:receipt,error:null};
 },null)});
 const res=await run(req({token,colisId,actorId:'forged',payment:'returned'}));
 assert.equal(res.status,200);assert.deepEqual(await res.json(),receipt);assert.equal(calls,1);
 assert.match(res.headers.get('cache-control'),/no-store/);assert.equal(res.headers.get('referrer-policy'),'no-referrer');
});
test('a forged or empty token never falls back to dossier access even with a session',async()=>{
 let calls=0;const run=await handler('get-payment-return',{db:database({},()=>{calls++;return {data:receipt};})});
 for(const invalid of ['',null,{},'z'.repeat(64),'ab','a'.repeat(10000)]) assert.equal((await run(req({token:invalid,colisId},{authorization:'Bearer valid'}))).status,400);
 assert.equal(calls,0);
});
test('legacy return requires a verified JWT and passes only its verified actor',async()=>{
 const actor='10000000-0000-4000-8000-000000000001';let calls=0;
 const db=database({profiles:{id:actor,role:'client',actif:true}},(name,args)=>{
  calls++;assert.equal(name,'get_payment_return');assert.equal(args.p_actor_id,actor);assert.equal(args.p_colis_id,colisId);assert.equal(args.p_token_hash,null);return {data:receipt,error:null};
 });const run=await handler('get-payment-return',{db});
 assert.equal((await run(req({colisId}))).status,401);
 assert.equal((await run(req({colisId,actorId:'forged'},{authorization:'Bearer client'}))).status,200);assert.equal(calls,1);
 const invalid=await handler('get-payment-return',{db:database({},()=>{throw new Error('unauthorized RPC');},null)});
 assert.equal((await invalid(req({colisId},{authorization:'Bearer forged'}))).status,401);
});
test('SQL ownership/expiry errors are generic and do not leak references or hashes',async()=>{
 for(const [code,status] of Object.entries({P0401:401,P0403:403,P0404:404,P0410:410,XX000:503})){
  const run=await handler('get-payment-return',{db:database({},()=>({data:null,error:{code,message:`SECRET ${token} EXP-PRIVATE`}}))});
  const res=await run(req({token}));assert.equal(res.status,status);assert.match(res.headers.get('cache-control'),/no-store/);
  assert.doesNotMatch(await res.text(),/SECRET|EXP-PRIVATE|ababab/);
 }
});
test('browser cancellation cannot override delayed authoritative payment and polling is read-only',async()=>{
 let paid=false;let calls=0;
 const run=await handler('get-payment-return',{db:database({},name=>{assert.equal(name,'get_payment_return');calls++;return {data:{...receipt,status:paid?'paid':'pending',paidAt:paid?'2026-09-30T10:00:00Z':null},error:null};})});
 assert.equal((await (await run(req({token,payment:'returned',paid:true}))).json()).status,'pending');
 paid=true;
 assert.equal((await (await run(req({token,payment:'cancelled',paid:false}))).json()).status,'paid');assert.equal(calls,2);
});
test('legacy staff and client sessions receive the same customer projection',async()=>{
 const results=[];
 for(const role of ['client','directeur']){
  const run=await handler('get-payment-return',{db:database({profiles:{id:'actor',role,actif:true}},()=>({data:receipt,error:null}))});
  results.push(await (await run(req({colisId},{authorization:'Bearer user'}))).json());
 }assert.deepEqual(results[0],results[1]);assert.equal(Object.keys(results[0]).sort().join(','),'amountCents,currency,isLive,ok,paidAt,reference,shipment,status');
});
test('return endpoint rejects GET and malformed JSON with private response headers',async()=>{
 const run=await handler('get-payment-return');
 assert.equal((await run(new Request('http://localhost',{method:'GET'}))).status,405);
 const invalid=await run(new Request('http://localhost',{method:'POST',body:'{'}));assert.equal(invalid.status,400);assert.equal(invalid.headers.get('referrer-policy'),'no-referrer');
});

function checkoutDb(old=null,mutations=[]){
 return database({profiles:{id:'staff',role:'directeur',actif:true},
  colis:({mutation})=>{if(mutation)mutations.push(['colis',mutation]);return {data:{id:colisId,client_id:'client',ref:'EXP',devis_total:40,quote_version:2,statut:'en_preparation'},error:null};},
  clients:{nom:'Example',prenom:'Camille',email:'camille@example.test',adresse:'1 rue Exemple',ville:'Saint-Denis',cp:'97400',type:'particulier'},
  payment_intents:({mutation})=>{if(mutation){mutations.push(['intent',mutation]);return {data:{id:'intent',...mutation},error:null};}return {data:old,error:null};}
 });
}
const env={APP_URL:'https://app.example.test/',SUPABASE_URL:'https://fixture.supabase.co',PAYPLUG_SECRET_KEY:'sk_test_fixture',PAYPLUG_MODE:'test'};
test('new checkout stores only a scoped hash and puts a 256-bit token in customer return and cancellation URLs',async()=>{
 const mutations=[];let raw;
 const run=await handler('payplug-create',{env,db:checkoutDb(null,mutations),fetch:async(_url,options)=>{
  const sent=JSON.parse(options.body);const returned=new URL(sent.hosted_payment.return_url);const cancel=new URL(sent.hosted_payment.cancel_url);
  assert.equal(returned.pathname,'/paiement/retour');raw=returned.searchParams.get('token');assert.match(raw,/^[a-f0-9]{64}$/);
  assert.equal(cancel.searchParams.get('token'),raw);assert.equal(cancel.searchParams.get('payment'),'cancelled');assert.equal(returned.searchParams.has('colisId'),false);
  assert.equal(mutations[0][1].return_token_hash,sha(raw));assert.notEqual(mutations[0][1].return_token_hash,raw);
  const days=(Date.parse(mutations[0][1].return_token_expires_at)-Date.now())/86400000;assert.ok(days>89.99&&days<=90.01);
  return Response.json({id:'pay_fixture',object:'payment',amount:4000,currency:'EUR',is_live:false,metadata:sent.metadata,hosted_payment:{payment_url:'https://secure.payplug.com/fixture'}});
 }});
 const res=await run(req({colisId},{authorization:'Bearer staff'}));assert.equal(res.status,200);
 assert.ok(!JSON.stringify(mutations).includes(raw));assert.ok(!(await res.text()).includes(raw));
});
test('an existing pending hosted link is reused without rotating tokens, making duplicates or contacting PayPlug',async()=>{
 for(const fields of [{},{return_token_hash:sha(token),return_token_expires_at:'2026-12-01T10:00:00Z'}]){
  const mutations=[];const run=await handler('payplug-create',{env,db:checkoutDb({id:'intent',provider_is_live:false,status:'pending',provider_id:'pay_existing',payment_url:'https://secure.payplug.com/existing',...fields},mutations)});
  const res=await run(req({colisId},{authorization:'Bearer staff'}));assert.equal(res.status,200);assert.equal((await res.json()).reused,true);assert.equal(mutations.length,0);
 }
});
