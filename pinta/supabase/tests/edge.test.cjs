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
test('Protected functions deny missing or forged user sessions even without old shared secret',async()=>{
 for(const name of ['send-telegram','payplug-create','create-staff-user','invite-client-user','telegram-inbox-assign','relances-auto']){
  const noToken=await handler(name,{db:database()});assert.equal((await noToken(req({}))).status,401,name);
  const invalid=await handler(name,{db:database({},undefined,null)});assert.equal((await invalid(req({}, {authorization:'Bearer forged'}))).status,401,name);
 }
});
test('Scoped cron secret permits only the worker and never accepts empty or incorrect secrets',async()=>{
 let checkedUser=0;
 const db={auth:{getUser:async()=>{checkedUser++;return{data:{user:null},error:{message:'invalid'}};}},from(table){
  const result={data:table==='app_settings'?{value:{relancesActivesDepuis:'2026-09-10T12:00:00Z'}}:[],error:null};
  const q={};for(const method of ['select','update','eq','in','lt','lte','gt','order','limit'])q[method]=()=>q;
  q.maybeSingle=async()=>result;q.then=(yes,no)=>Promise.resolve(result).then(yes,no);return q;
 }};
 const run=await handler('relances-auto',{db,env:{RELANCES_CRON_SECRET:'scoped-cron-fixture'}});
 assert.equal((await run(req({},{authorization:'Bearer scoped-cron-fixture'}))).status,200);
 assert.equal(checkedUser,0);
 assert.equal((await run(req({},{authorization:'Bearer wrong'}))).status,401);
 const missing=await handler('relances-auto',{db,env:{RELANCES_CRON_SECRET:''}});
 assert.equal((await missing(req({}))).status,401);
 const other=await handler('send-telegram',{db,env:{RELANCES_CRON_SECRET:'scoped-cron-fixture'}});
 assert.equal((await other(req({},{authorization:'Bearer scoped-cron-fixture'}))).status,401);
});
test('Editable metadata cannot turn a canonical client into staff',async()=>{
 const db=database({profiles:{id:'10000000-0000-4000-8000-000000000001',role:'client',actif:true}},undefined,{id:'10000000-0000-4000-8000-000000000001',user_metadata:{role:'directeur'}});
 const run=await handler('send-telegram',{db});assert.equal((await run(req({chatId:'123',text:'attack'},{authorization:'Bearer client'}))).status,403);
});
test('the reminder worker excludes archived dossiers even when their reminder date is due',async()=>{
 const archived={id:'archived',client_id:'fixture-client',archive:true,statut:'attente_feu_vert',demande_feu_vert_envoyee_at:new Date(Date.now()-4*86400000).toISOString()};
 const db={rpc:async()=>{throw new Error('No archived customer should enter reminder generation');},from(table){
  const filters=[];const q={};
  for(const method of ['select','update','lt','lte','gt','order','limit'])q[method]=()=>q;
  q.eq=(key,value)=>{filters.push(row=>row[key]===value);return q;};
  q.in=(key,values)=>{filters.push(row=>values.includes(row[key]));return q;};
  const resolve=()=>({data:table==='app_settings'?{value:{relancesActivesDepuis:new Date(Date.now()-30*86400000).toISOString(),relancesFeuVert:'J+2'}}:table==='colis'?[archived].filter(row=>filters.every(filter=>filter(row))):[],error:null});
  q.maybeSingle=async()=>resolve();q.then=(yes,no)=>Promise.resolve(resolve()).then(yes,no);return q;
 }};
 const run=await handler('relances-auto',{db,env:{RELANCES_CRON_SECRET:'scoped-cron-fixture'}});
 const response=await run(req({},{authorization:'Bearer scoped-cron-fixture'}));
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.scanned,0);assert.equal(result.queued,0);
});
test('Reminder fallback queues every physical carton with its supplier, including cartons without tracking',async()=>{
 const client={id:'fixture-client',prenom:'Camille',nom:'Exemple',cp:'97400',type:'particulier',telegram_chat_id:'fixture-chat'};
 const colis={id:'fixture-colis',client_id:client.id,ref:'QA-CARTONS',archive:false,statut:'attente_feu_vert',nb_colis:3,
  demande_feu_vert_envoyee_at:new Date(Date.now()-4*86400000).toISOString(),
  trackings:['SUIVI-A'],trackings_detail:[{number:'SUIVI-A',fournisseur:'Fournisseur A'},{number:'',fournisseur:'Fournisseur B'},{number:'',fournisseur:''}],
  dims_par_colis:Array.from({length:3},()=>({dimL:20,dimW:30,dimH:40,poids:2}))};
 const queued=[];
 const db={rpc:async(name,args)=>{
  if(name==='client_has_open_conversation')return{data:false,error:null};
  assert.equal(name,'queue_message');queued.push(args);return{data:{id:'fixture-message'},error:null};
 },from(table){
  assert.ok(['app_settings','colis','clients','notification_outbox','message_templates'].includes(table),`Unexpected table: ${table}`);
  const filters=[];const q={};
  for(const method of ['select','update','lt','lte','gte','order','limit'])q[method]=()=>q;
  q.eq=(key,value)=>{filters.push(row=>row[key]===value);return q;};
  q.in=(key,values)=>{filters.push(row=>values.includes(row[key]));return q;};
  q.gt=(key,value)=>{filters.push(row=>row[key]>value);return q;};
  const resolve=(single=false)=>({data:table==='app_settings'?{value:{relancesActivesDepuis:new Date(Date.now()-30*86400000).toISOString(),relancesFeuVert:'J+2',diviseurVolumetrique:6000}}
   :table==='clients'?client:table==='colis'?[colis].filter(row=>filters.every(filter=>filter(row))):single?null:[],error:null});
  q.single=q.maybeSingle=async()=>resolve(true);q.then=(yes,no)=>Promise.resolve(resolve()).then(yes,no);return q;
 }};
 const run=await handler('relances-auto',{db,env:{RELANCES_CRON_SECRET:'scoped-cron-fixture'}});
 const response=await run(req({},{authorization:'Bearer scoped-cron-fixture'}));
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.scanned,1);assert.equal(result.queued,1);assert.equal(queued.length,1);
 const message=queued[0];assert.equal(message.p_colis_id,colis.id);assert.equal(message.p_template,'relance_feu_vert');
 assert.match(message.p_text,/Bonjour Camille,/);
 assert.match(message.p_text,/Votre dossier QA-CARTONS contient 3 carton\(s\) :\n1\. Fournisseur A — SUIVI-A\n2\. Fournisseur B — Sans numéro de suivi\n3\. Sans numéro de suivi\n/);
 assert.doesNotMatch(message.p_text,/\{\{/);
 assert.equal(message.p_reply_markup.inline_keyboard[0][0].callback_data,`fv_oui_${colis.id}`);
});
test('Telegram webhook fails closed when secret is absent or invalid',async()=>{
 assert.equal((await(await handler('telegram-webhook'))(req({update_id:1}))).status,503);
 assert.equal((await(await handler('telegram-webhook',{env:{TELEGRAM_WEBHOOK_SECRET:'test-secret'}}))(req({update_id:1}))).status,401);
});
test('Telegram duplicate update is acknowledged without side effects',async()=>{
 let calls=0;const db=database({},(name)=>{assert.equal(name,'claim_telegram_update');calls++;return{data:'done',error:null};});
 const run=await handler('telegram-webhook',{env:{TELEGRAM_WEBHOOK_SECRET:'test-secret'},db});
 const response=await run(req({update_id:12},{'X-Telegram-Bot-Api-Secret-Token':'test-secret'}));assert.equal(response.status,200);assert.equal(calls,1);assert.equal((await response.json()).duplicate,true);
});
test('Official minimal PayPlug notification retrieves provider resource before payment mutation',async()=>{
 let fetched=0,confirmed=0;const id='pay_abc123';const colisId='30000000-0000-4000-8000-000000000001';
 const db=database({},(name,args)=>{assert.equal(name,'confirm_payplug_payment');assert.equal(args.p_amount_cents,4321);assert.equal(args.p_quote_version,2);assert.equal(args.p_currency,'EUR');confirmed++;return{data:{id:colisId},error:null};});
 const run=await handler('payplug-webhook',{env:{PAYPLUG_SECRET_KEY:'sk_test_fixture',PAYPLUG_MODE:'test'},db,fetch:async(url,options)=>{fetched++;assert.equal(url,`https://api.payplug.com/v1/payments/${id}`);assert.equal(options.headers.Authorization,'Bearer sk_test_fixture');return Response.json({id,object:'payment',is_live:false,is_paid:true,amount:4321,currency:'EUR',metadata:{colis_id:colisId,quote_version:'2'}});}});
 const response=await run(req({id,object:'payment',is_live:false}));assert.equal(response.status,200);assert.equal(fetched,1);assert.equal(confirmed,1);
});
test('Forged body payment fields cannot bypass unpaid provider result',async()=>{
 const run=await handler('payplug-webhook',{env:{PAYPLUG_SECRET_KEY:'sk_test_fixture',PAYPLUG_MODE:'test'},fetch:async()=>Response.json({id:'pay_abc123',object:'payment',is_live:false,is_paid:false})});
 const response=await run(req({id:'pay_abc123',object:'payment',is_paid:true,amount:99999,metadata:{colis_id:'forged'}}));assert.equal(response.status,200);assert.equal((await response.json()).action,'not_paid');
});
test('PayPlug wrong currency and live mode never mutate payment state',async()=>{
 for(const patch of [{is_live:true},{currency:'USD'}]){
  const run=await handler('payplug-webhook',{env:{PAYPLUG_SECRET_KEY:'sk_test_fixture',PAYPLUG_MODE:'test'},fetch:async()=>Response.json({id:'pay_abc123',object:'payment',is_live:false,is_paid:true,amount:123,currency:'EUR',metadata:{colis_id:'30000000-0000-4000-8000-000000000001',quote_version:'1'},...patch})});
  assert.equal((await run(req({id:'pay_abc123',object:'payment'}))).status,400);
 }
});
test('PayPlug unavailable API keeps webhook retryable and no invoice is marked paid',async()=>{
 const run=await handler('payplug-webhook',{env:{PAYPLUG_SECRET_KEY:'sk_test_fixture',PAYPLUG_MODE:'test'},fetch:async()=>new Response('',{status:503})});assert.equal((await run(req({id:'pay_abc123',object:'payment'}))).status,502);
});
test('OCR rejects arbitrary URL-only requests before any external download',async()=>{
 const db=database({profiles:{id:'10000000-0000-4000-8000-000000000001',role:'directeur',actif:true}});
 const run=await handler('ocr-facture',{db});assert.equal((await run(req({imageUrl:'http://metadata.internal/secrets'},{authorization:'Bearer director'}))).status,400);
});
