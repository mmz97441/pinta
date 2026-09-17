const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('../../node_modules/esbuild');
let compiled;
async function setup({open=true,template='relance_feu_vert',outboxStatus='pending',parcelStatus='attente_feu_vert',recentSentAt=null,archive=false,idempotencyKey='operator-message'}={}) {
  compiled ||= (await esbuild.build({entryPoints:[path.join(__dirname,'../functions/_shared/telegram.ts')],bundle:true,write:false,format:'cjs',platform:'node',plugins:[{name:'mock-supabase',setup(build){
    build.onResolve({filter:/^https:\/\/esm.sh\/\@supabase\//},()=>({path:'supabase',namespace:'mock'}));
    build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=()=>{throw new Error("No external database");};',loader:'js'}));
  }}]})).outputFiles[0].text;
  const snapshot={trackings:['BOX'],trackings_detail:[],nb_colis:1};
  const rows={
    notification_outbox:{id:'outbox',message_id:'message',colis_id:'parcel',client_id:'client',quote_version:1,status:outboxStatus,attempts:0,idempotency_key:idempotencyKey},
    messages:{id:'message',texte:'Synthetic message',template,statut:'envoi',request_snapshot:snapshot},
    clients:{id:'client',telegram_chat_id:'fixture-chat'},
    colis:{id:'parcel',statut:parcelStatus,archive,attente_client_date:null,quote_version:1,...snapshot},
  };
  let requests=0,checks=0;
  const db={rpc:async(name,args)=>{assert.equal(name,'client_has_open_conversation');assert.equal(args.p_client_id,'client');checks++;return{data:open,error:null};},from(table){
    const filters=[];let patch;
    const q={select(){return q;},update(value){patch=value;return q;},eq(key,value){filters.push(row=>row[key]===value);return q;},in(key,values){filters.push(row=>values.includes(row[key]));return q;},gte(key,value){filters.push(row=>row[key]>=value);return q;},order(){return q;},limit(){return q;},is(key,value){filters.push(row=>(row[key]??null)===value);return q;},single:async()=>resolve(),maybeSingle:async()=>resolve(),then(yes,no){return Promise.resolve(resolve()).then(yes,no);}};
    function resolve(){const candidates=[rows[table]];if(table==='notification_outbox'&&recentSentAt)candidates.push({id:'recent',client_id:'client',status:'sent',sent_at:recentSentAt,'messages.template':'relance_feu_vert'});const row=candidates.find(item=>item&&filters.every(filter=>filter(item)));if(!row)return{data:null,error:null};if(patch)Object.assign(row,patch);return{data:{...row},error:null};}
    return q;
  }};
  const moduleObject={exports:{}};
  vm.runInNewContext(compiled,{module:moduleObject,exports:moduleObject.exports,Deno:{env:{get:key=>key==='TELEGRAM_BOT_TOKEN'?'fixture-token':undefined}},fetch:async()=>{requests++;return Response.json({ok:true,result:{message_id:12}});},Date,Response,Headers,AbortSignal,console});
  return{run:()=>moduleObject.exports.dispatchOutbox(db,'outbox'),rows,get requests(){return requests;},get checks(){return checks;}};
}
test('a queued reminder is blocked before provider delivery when a read but unresolved question exists',async()=>{
  const fixture=await setup();const result=await fixture.run();
  assert.equal(result.status,'blocked');assert.equal(fixture.requests,0);assert.equal(fixture.checks,1);
  assert.equal(fixture.rows.notification_outbox.status,'blocked');assert.equal(fixture.rows.messages.statut,'envoi');
});
test('an explicitly handled conversation allows a blocked reminder to be checked and delivered once',async()=>{
  const fixture=await setup({open:false,outboxStatus:'blocked'});
  assert.equal((await fixture.run()).status,'sent');assert.equal(fixture.requests,1);
  assert.equal((await fixture.run()).status,'sent');assert.equal(fixture.requests,1);
});
test('payment reminders are also blocked by unresolved conversation work',async()=>{
  const fixture=await setup({template:'relance_paiement',parcelStatus:'devis_envoye'});
  assert.equal((await fixture.run()).status,'blocked');assert.equal(fixture.requests,0);
});
test('staff can answer while reminders remain suspended',async()=>{
  const fixture=await setup({template:null});
  assert.equal((await fixture.run()).status,'sent');assert.equal(fixture.requests,1);assert.equal(fixture.checks,0);
});
test('a completed payment cancels an old reminder even after its conversation is handled',async()=>{
  const fixture=await setup({open:false,template:'relance_paiement',parcelStatus:'paye',outboxStatus:'blocked'});
  assert.equal((await fixture.run()).status,'cancelled');assert.equal(fixture.requests,0);
});
test('releasing several held reminders cannot send a second follow-up within 24 hours',async()=>{
  const fixture=await setup({open:false,outboxStatus:'blocked',recentSentAt:new Date(Date.now()-3600000).toISOString()});
  assert.equal((await fixture.run()).status,'scheduled');assert.equal(fixture.requests,0);
  assert.equal(fixture.rows.notification_outbox.status,'pending');assert.ok(Date.parse(fixture.rows.notification_outbox.available_at)>Date.now());
});
test('archiving after queueing cancels both preparation and payment reminders before delivery',async()=>{
  for(const template of ['demande_feu_vert','relance_feu_vert','relance_paiement']) {
    const fixture=await setup({open:false,archive:true,template,parcelStatus:template==='relance_paiement'?'devis_envoye':'attente_feu_vert'});
    assert.equal((await fixture.run()).status,'cancelled');assert.equal(fixture.requests,0);
    assert.equal(fixture.rows.notification_outbox.status,'cancelled');
  }
});

test('historical automatic reminders are cancelled before provider access while operator reminders still work',async()=>{
 const automatic=await setup({open:false,idempotencyKey:'reminder:parcel:version:2'});
 assert.equal((await automatic.run()).status,'cancelled');assert.equal(automatic.requests,0);assert.equal(automatic.checks,0);
 const explicit=await setup({open:false,idempotencyKey:'manual-reminder-by-staff'});
 assert.equal((await explicit.run()).status,'sent');assert.equal(explicit.requests,1);
});
