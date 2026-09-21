const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('../../node_modules/esbuild');

const colisId = '30000000-0000-4000-8000-000000000001';
const staffId = '10000000-0000-4000-8000-000000000001';
const updatedAt = '2026-09-20T07:00:00.123456+00:00';
const clone = value => JSON.parse(JSON.stringify(value));
const box = { dimL:30,dimW:20,dimH:10,poids:2 };
const baseColis = { id:colisId,ref:'EXP-FIXTURE',updated_at:updatedAt,statut:'attente_paiement',feu_vert:'autorise',devis_total:40,
  quote_version:2,archive:false,nb_colis:1,dims_par_colis:[box],final_packages:[box],final_measurements_version:1,preparation_composition_version:1,
  payplug_payment_id:'pay_fixture',payplug_payment_url:'https://secure.payplug.com/fixture' };
const baseIntent = { id:'intent-fixture',colis_id:colisId,quote_version:2,provider_id:'pay_fixture',amount_cents:4000,currency:'EUR',status:'pending',provider_is_live:false };
const basePayment = { id:'pay_fixture',object:'payment',is_live:false,is_paid:false,amount:4000,currency:'EUR',amount_refunded:0,
  metadata:{colis_id:colisId,intent_id:baseIntent.id,quote_version:'2'},failure:null };
const env = { SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'anon-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',PAYPLUG_SECRET_KEY:'sk_test_fixture',PAYPLUG_MODE:'test' };
let bundle;

async function fixture(options = {}) {
  if (!bundle) {
    const result = await esbuild.build({entryPoints:[path.resolve(__dirname,'../functions/correct-colis-task/index.ts')],bundle:true,write:false,format:'iife',platform:'browser',plugins:[{
      name:'isolated-supabase',setup(build){
        build.onResolve({filter:/^https:\/\/esm.sh\/@supabase\//},()=>({path:'supabase',namespace:'mock'}));
        build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=(url,key,options)=>globalThis.__client(key,options);',loader:'js'}));
      },
    }]});
    bundle=result.outputFiles[0].text;
  }
  const tables = {
    profiles:[{id:staffId,role:options.role || 'operateur',actif:true}],
    staff_users:[{id:'staff-fixture',auth_id:staffId,actif:true}],
    staff_permissions:[{staff_id:'staff-fixture',perm_colis_revenir_arriere:true,perm_colis_mesurer:true,perm_colis_preparer:true,perm_colis_demander_feuvert:true,perm_colis_calculer_devis:true,...options.permissions}],
    colis:[{...clone(baseColis),...options.colis}],
    staff_work_actions:clone(options.workActions || []),
    payment_intents:clone(options.intents ?? [baseIntent]),
    legacy_payplug_payments:clone(options.legacy || []),paiements:clone(options.paiements || []),envois:clone(options.envois || []),
  };
  const calls=[]; const writes=[]; const provider=[]; const state={tables,calls,writes,provider};
  function query(table) {
    const filters=[]; let update; let single=false; let limit;
    const q={select(){return q;},eq(key,value){filters.push(row=>row[key]===value);return q;},in(key,values){filters.push(row=>values.includes(row[key]));return q;},
      update(value){update=clone(value);return q;},limit(value){limit=value;return q;},single(){single=true;return Promise.resolve(resolve());},maybeSingle(){single=true;return Promise.resolve(resolve());},
      then(yes,no){return Promise.resolve().then(resolve).then(yes,no)}};
    function resolve(){
      const rows=(tables[table] || []).filter(row=>filters.every(fn=>fn(row))).slice(0,limit);
      if(update){writes.push({table,value:update,ids:rows.map(row=>row.id)});if(options.cleanupError) return {data:null,error:{message:'cleanup failed'}};rows.forEach(row=>Object.assign(row,update));}
      return {data:clone(single?(rows[0] ?? null):rows),error:null};
    }
    return q;
  }
  const auth={getUser:async token=>({data:{user:token==='staff-jwt'?{id:staffId,email:'staff@example.test'}:null},error:null})};
  function client(key,config) {
    const scoped=key==='anon-fixture';
    assert.ok(scoped || key==='service-fixture');
    if(scoped) assert.equal(config.global.headers.Authorization,'Bearer staff-jwt');
    return {auth,from:query,rpc:async(name,args)=>{
      calls.push({name,args:clone(args),scoped});
      if(name==='record_payplug_cancellation'){
        assert.equal(scoped,false);
        assert.equal(args.p_colis_id,colisId); assert.equal(args.p_payment.failure.code,'aborted');assert.equal(args.p_payment.is_paid,false);
        if(options.proofError) return {data:null,error:{message:'proof failed'}};
        [...tables.payment_intents,...tables.legacy_payplug_payments].filter(row=>row.provider_id===args.p_provider_id).forEach(row=>{row.provider_cancelled_at='2026-09-20T07:01:00Z';});
        return {data:{providerId:args.p_provider_id},error:null};
      }
      assert.equal(name,'correct_colis_task');assert.equal(scoped,true,'The business command must retain the staff JWT');
      if(options.rpc) return options.rpc(args,state);
      return {data:{colis:tables.colis[0],changed:!options.unchanged,invalidated:[]},error:null};
    }};
  }
  let serve;
  const context={__client:client,Deno:{env:{get:key=>({...env,...options.env})[key]},serve:fn=>{serve=fn;}},Request,Response,URL,AbortSignal,console:{error(){},warn(){},log(){}},
    fetch:async(url,config)=>{
      provider.push({url,method:config.method || 'GET',body:config.body && JSON.parse(config.body)});
      assert.match(url,/^https:\/\/api\.payplug\.com\/v1\/payments\/pay_[a-zA-Z0-9]+$/);
      assert.equal(config.headers['PayPlug-Version'],'2019-08-06');
      assert.equal(config.headers.Authorization,`Bearer ${({...env,...options.env}).PAYPLUG_SECRET_KEY}`);
      if(config.method==='PATCH') assert.deepEqual(JSON.parse(config.body),{aborted:true});
      if(options.fetch) return options.fetch(url,config,state);
      const payment=clone(options.payment || basePayment);
      if(config.method==='PATCH') payment.failure={code:'aborted'};
      return Response.json(payment);
    }};
  vm.runInNewContext(bundle,context);
  state.run=async(body={},authorization='Bearer staff-jwt')=>{
    const response=await serve(new Request('https://fixture/functions/v1/correct-colis-task',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authorization},body:JSON.stringify({colisId,task:'devis',values:{},expectedUpdatedAt:updatedAt,reason:'Correction vérifiée',...body})}));
    return {status:response.status,body:await response.json()};
  };
  return state;
}

test('no payment link calls only the staff-scoped correction command',async()=>{
  const f=await fixture({colis:{payplug_payment_id:null,payplug_payment_url:null},intents:[]});
  const result=await f.run();assert.equal(result.status,200);assert.equal(result.body.paymentLinkCancelled,false);
  assert.deepEqual(f.calls.map(x=>[x.name,x.scoped]),[['correct_colis_task',true]]);assert.equal(f.provider.length,0);
});
test('unpaid modern link is verified, aborted, attested, then corrected with staff JWT',async()=>{
  const f=await fixture();const result=await f.run();assert.equal(result.status,200);assert.equal(result.body.paymentLinkCancelled,true);
  assert.deepEqual(f.provider.map(x=>x.method),['GET','PATCH']);
  assert.deepEqual(f.calls.map(x=>[x.name,x.scoped]),[['record_payplug_cancellation',false],['correct_colis_task',true]]);
  assert.equal(f.calls[1].args.p_expected_updated_at,updatedAt);assert.equal(f.writes.length,0);
});
test('confirmed provider abort is recovered after a timeout and the proof makes retries idempotent',async()=>{
  let first=true;
  const f=await fixture({fetch:async(_url,config)=>{
    if(config.method==='PATCH'){first=false;throw new Error('response timeout');}
    return Response.json({...basePayment,failure:first?null:{code:'aborted'}});
  }});
  const unknown=await f.run();assert.equal(unknown.status,502);assert.equal(f.calls.length,0);assert.match(unknown.body.error,/pas été confirmée/);
  assert.equal((await f.run()).status,200);assert.deepEqual(f.provider.map(x=>x.method),['GET','PATCH','GET']);
  assert.equal((await f.run()).status,200);assert.equal(f.provider.length,3);assert.equal(f.calls.filter(x=>x.name==='record_payplug_cancellation').length,1);
});
test('already recorded proof skips provider access even with no configured key',async()=>{
  const f=await fixture({intents:[{...baseIntent,provider_cancelled_at:'2026-09-20T07:01:00Z'}],env:{PAYPLUG_SECRET_KEY:''}});
  assert.equal((await f.run()).status,200);assert.equal(f.provider.length,0);assert.equal(f.calls.length,1);
});
test('permissions for both correction and chosen task are enforced before provider access',async()=>{
  for(const options of [{permissions:{perm_colis_revenir_arriere:false}},{permissions:{perm_colis_calculer_devis:false}},{role:'client'}]){
    const f=await fixture(options);assert.equal((await f.run()).status,403);assert.equal(f.provider.length,0);assert.equal(f.calls.length,0);
  }
  const f=await fixture();assert.equal((await f.run({},'')).status,401);
});
test('transferred quote or correction refuses before contacting the payment provider',async()=>{
  for (const kind of ['quote','correction']) {
    const f=await fixture({workActions:[{colis_id:colisId,kind,state:'in_progress',assignee_id:'another-staff'}]});
    const result=await f.run();assert.equal(result.status,409);assert.equal(result.body.code,'40001');
    assert.equal(f.provider.length,0);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
  }
});
test('a transfer during provider verification prevents the cancellation request',async()=>{
  const f=await fixture({fetch:async(_url,_config,state)=>{
    state.tables.staff_work_actions.push({colis_id:colisId,kind:'quote',state:'in_progress',assignee_id:'another-staff'});
    return Response.json(basePayment);
  }});
  const result=await f.run();assert.equal(result.status,409);assert.equal(result.body.code,'40001');
  assert.deepEqual(f.provider.map(call=>call.method),['GET']);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
});
test('another task owner or historical task never prevents an authorized quote correction',async()=>{
  const f=await fixture({colis:{payplug_payment_id:null,payplug_payment_url:null},intents:[],workActions:[
    {colis_id:colisId,kind:'documents',state:'in_progress',assignee_id:'another-staff'},
    {colis_id:colisId,kind:'quote',state:'done',assignee_id:'another-staff'},
  ]});
  assert.equal((await f.run()).status,200);assert.equal(f.calls.length,1);assert.equal(f.provider.length,0);
});
test('stale dossier comparison retains PostgreSQL microsecond precision before side effects',async()=>{
  const f=await fixture();const result=await f.run({expectedUpdatedAt:'2026-09-20T07:00:00.123455Z'});
  assert.equal(result.status,409);assert.equal(result.body.code,'40001');assert.equal(f.provider.length,0);assert.equal(f.calls.length,0);
});
test('archived, paid, departed, manifested and creating-payment dossiers cannot be changed',async()=>{
  for(const options of [{colis:{archive:true}},{colis:{paiement_date:'2026-09-20'}},{colis:{paiement_montant:0}},{colis:{date_expedition:'2026-09-20'}},
    {intents:[{...baseIntent,status:'paid'}]},{paiements:[{id:'paid',colis_id:colisId,statut:'confirme'}]},
    {legacy:[{provider_id:'pay_fixture',colis_id:colisId,observed_payment_date:'2026-09-20'}]},
    {colis:{envoi_id:'departure'},envois:[{id:'departure',manifest_version:1}]},{intents:[{...baseIntent,status:'creating'}]}]){
    const f=await fixture(options);assert.equal((await f.run()).status,409);assert.equal(f.provider.length,0);assert.equal(f.calls.length,0);
  }
});
test('invalid measurements and composition changes are rejected before retiring a payable link',async()=>{
  for(const values of [{boxes:[{...box,poids:true}]},{boxes:[{...box,poids:' 2 '}]},{boxes:[{...box,extra:1}]},{boxes:[box,box]},{boxes:[{...box,poids:0}]}]){
    const f=await fixture();assert.equal((await f.run({task:'reception',values})).status,400);assert.equal(f.provider.length,0);assert.equal(f.calls.length,0);
  }
});
test('unchanged measurements retain an existing payment link and ignore empty tracking slots',async()=>{
  const f=await fixture({colis:{dims_par_colis:[{...box,source:'historical'}],trackings:['TRACK','',' ']},unchanged:true});
  const result=await f.run({task:'reception',values:{boxes:[{...box,poids:'2.0'}]}});
  assert.equal(result.status,200);assert.equal(result.body.changed,false);assert.equal(f.provider.length,0);assert.equal(f.calls.length,1);
});
test('identical prepared boxes only retain a payment link when their full certification is current',async()=>{
  for(const certificate of [
    {outgoing_parcel_count:1,final_measurements_at:'2026-09-20T07:00:00Z'},
    {outgoing_parcel_count:2,final_measurements_at:'2026-09-20T07:00:00Z'},
    {outgoing_parcel_count:1,final_measurements_at:null},
  ]){
    const unchanged=certificate.outgoing_parcel_count===1 && Boolean(certificate.final_measurements_at);
    const f=await fixture({colis:certificate,unchanged});
    const result=await f.run({task:'preparation',values:{boxes:[box]}});
    assert.equal(result.status,200);assert.equal(result.body.changed,!unchanged);
    assert.equal(f.provider.length,unchanged?0:2);
    assert.equal(f.calls.filter(x=>x.name==='record_payplug_cancellation').length,unchanged?0:1);
  }
});
test('a saved quote input snapshot still needs payment cancellation even if its displayed total is empty',async()=>{
  for(const inputs of [{finP:2},null]){
    const f=await fixture({colis:{statut:'en_preparation',devis_total:null,devis_snapshot:{inputs},payplug_payment_id:null,payplug_payment_url:null}});
    assert.equal((await f.run()).status,200);assert.deepEqual(f.provider.map(x=>x.method),['GET','PATCH']);
    assert.equal(f.calls[0].name,'record_payplug_cancellation');assert.equal(f.calls.at(-1).name,'correct_colis_task');
  }
});
test('provider identity, amount, currency, version and mode mismatches cannot be aborted',async()=>{
  for(const payment of [{...basePayment,id:'pay_other'},{...basePayment,amount:4001},{...basePayment,currency:'USD'},{...basePayment,is_live:true},
    {...basePayment,metadata:{...basePayment.metadata,colis_id:'other'}},{...basePayment,metadata:{...basePayment.metadata,intent_id:'other'}},
    {...basePayment,metadata:{...basePayment.metadata,quote_version:'1'}},{...basePayment,metadata:{...basePayment.metadata,quote_version:'02'}}]){
    const f=await fixture({payment});assert.equal((await f.run()).status,409);assert.deepEqual(f.provider.map(x=>x.method),['GET']);assert.equal(f.calls.length,0);
  }
  const f=await fixture({env:{PAYPLUG_SECRET_KEY:'sk_live_fixture'}});assert.equal((await f.run()).status,503);assert.equal(f.provider.length,0);
});
test('paid or refunded provider resources never reach abort, proof, refund or correction',async()=>{
  for(const payment of [{...basePayment,is_paid:true},{...basePayment,amount_refunded:1}]){
    const f=await fixture({payment});assert.equal((await f.run()).status,409);assert.deepEqual(f.provider.map(x=>x.method),['GET']);assert.equal(f.calls.length,0);
  }
});
test('an unconfirmed abort, paid race, failed resource or provider outage never produces cancellation proof',async()=>{
  for(const scenario of ['paid-race','no-abort','already-failed','get-timeout','provider-error']){
    const f=await fixture({fetch:async(_url,config)=>{
      if(scenario==='get-timeout') throw new Error('timeout');
      if(scenario==='provider-error') return new Response('{}',{status:503});
      if(scenario==='already-failed') return Response.json({...basePayment,failure:{code:'expired'}});
      return Response.json({...basePayment,is_paid:scenario==='paid-race' && config.method==='PATCH'});
    }});
    const result=await f.run();assert.ok([409,502].includes(result.status),scenario);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
  }
});
test('legacy resources require historical identity and can be closed in their verified live mode',async()=>{
  const legacy={provider_id:'pay_fixture',colis_id:colisId,colis_ref:'EXP-FIXTURE',amount_cents:4000,currency:'EUR',billing_email:'legacy@example.test'};
  const payment={...basePayment,is_live:true,metadata:{colis_id:colisId,colis_ref:'EXP-FIXTURE'},billing:{email:'LEGACY@example.test'}};
  const f=await fixture({intents:[],legacy:[legacy],payment,env:{PAYPLUG_MODE:'live',PAYPLUG_SECRET_KEY:'sk_live_fixture'}});
  assert.equal((await f.run()).status,200);assert.deepEqual(f.provider.map(x=>x.method),['GET','PATCH']);
  const mismatch=await fixture({intents:[],legacy:[legacy],payment:{...payment,billing:{email:'other@example.test'}},env:{PAYPLUG_MODE:'live',PAYPLUG_SECRET_KEY:'sk_live_fixture'}});
  assert.equal((await mismatch.run()).status,409);assert.equal(mismatch.provider.length,1);assert.equal(mismatch.calls.length,0);
  const wrongEnvironment=await fixture({intents:[],legacy:[legacy]});assert.equal((await wrongEnvironment.run()).status,409);assert.equal(wrongEnvironment.provider.length,0);
});
test('unknown current payment references cannot be retired or silently forgotten',async()=>{
  for(const colis of [{payplug_payment_id:'pay_unknown'},{payplug_payment_id:null}]){
    const f=await fixture({colis});assert.equal((await f.run()).status,409);assert.equal(f.provider.length,0);assert.equal(f.calls.length,0);
  }
});
test('successful provider abort followed by SQL conflict is explicit and clears only the obsolete URL',async()=>{
  for(const replacement of [false,true]){
    const f=await fixture({rpc:async(_args,state)=>{
      Object.assign(state.tables.colis[0],{fin_p:7,updated_at:'2026-09-20T07:02:00Z',...(replacement?{payplug_payment_id:'pay_replacement',payplug_payment_url:'https://secure.payplug.com/new'}:{})});
      return {data:null,error:{code:'40001',message:'Le dossier a changé.'}};
    }});
    const result=await f.run();assert.equal(result.status,409);assert.equal(result.body.code,'40001');assert.equal(result.body.paymentLinkCancelled,true);assert.equal(result.body.correctionSaved,false);
    assert.match(result.body.error,/désactivé.*pas enregistrée.*saisie est conservée/);
    assert.equal(f.tables.colis[0].fin_p,7);assert.equal(f.tables.colis[0].updated_at,'2026-09-20T07:02:00Z');
    assert.equal(f.tables.colis[0].payplug_payment_url,replacement?'https://secure.payplug.com/new':null);
    assert.deepEqual(f.writes[0].value,{payplug_payment_url:null});
  }
});
test('proof persistence failure reports the already aborted link without pretending the correction saved',async()=>{
  const f=await fixture({proofError:true,cleanupError:true});const result=await f.run();
  assert.equal(result.status,500);assert.equal(result.body.paymentLinkCancelled,true);assert.equal(result.body.correctionSaved,false);
  assert.match(result.body.error,/affichage du lien doit aussi être actualisé/);assert.equal(f.calls.length,1);
});
test('superseded but still payable versions are aborted as well as the current link',async()=>{
  const old={...baseIntent,id:'intent-old',provider_id:'pay_old',quote_version:1,status:'superseded'};
  const f=await fixture({intents:[old,baseIntent],fetch:async(url,config)=>{
    const isOld=url.endsWith('pay_old');return Response.json({...basePayment,id:isOld?'pay_old':'pay_fixture',
      metadata:{colis_id:colisId,intent_id:isOld?'intent-old':baseIntent.id,quote_version:isOld?'1':'2'},failure:config.method==='PATCH'?{code:'aborted'}:null});
  }});
  assert.equal((await f.run()).status,200);assert.deepEqual(f.provider.map(x=>x.method),['GET','PATCH','GET','PATCH']);
  assert.equal(f.calls.filter(x=>x.name==='record_payplug_cancellation').length,2);assert.equal(f.calls.at(-1).name,'correct_colis_task');
});
