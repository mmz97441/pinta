const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const esbuild=require('../../node_modules/esbuild');
let bundle;
async function webhook(db,fetch){
 if(!bundle){bundle=(await esbuild.build({entryPoints:[path.join(__dirname,'../functions/telegram-webhook/index.ts')],bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'test-db',setup(build){build.onResolve({filter:/^https:\/\/esm.sh\/@supabase\//},()=>({path:'db',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=()=>globalThis.__db;',loader:'js'}));}}]})).outputFiles[0].text;}
 let run;vm.runInNewContext(bundle,{__db:db,Deno:{env:{get:key=>({TELEGRAM_WEBHOOK_SECRET:'test-secret',TELEGRAM_BOT_TOKEN:'test-token'}[key])},serve:fn=>{run=fn;}},Request,Response,URL,TextEncoder,Uint8Array,ArrayBuffer,AbortSignal,crypto:webcrypto,fetch,btoa:s=>Buffer.from(s,'binary').toString('base64'),console:{log(){},warn(){},error(){}},setTimeout,clearTimeout});return run;
}
async function scenario({attachment=false,unsupported=false,reply=false,ambiguous=false,ackFails=false}={}){
 const selected={id:'fixture-selected',ref:'EXP-PAID',statut:'paye',paiement_date:'2026-09-01'};
 const writes=[],rpcCalls=[],providerCalls=[];
 const db={rpc:async(name,args)=>{rpcCalls.push({name,args});if(name==='claim_telegram_update')return{data:'claimed',error:null};assert.equal(name,'resolve_telegram_message_colis');return{data:ambiguous?null:selected,error:null};},
 storage:{from(bucket){assert.equal(bucket,'factures');return{upload:async(file,bytes,options)=>{writes.push({table:'storage',file,bytes:bytes.byteLength,options});return{data:{},error:null};}};}},
 from(table){let mutation;const q={};for(const key of ['select','eq','in','not','order','limit'])q[key]=()=>q;
 q.upsert=q.update=value=>{mutation=value;return q;};const resolve=()=>{
  if(table==='clients')return{data:{id:'fixture-client',prenom:'Camille',nom:'Exemple'},error:null};
  if(table==='colis')return{data:[{id:'unrelated-active',ref:'EXP-ACTIVE',statut:'autorise'}],error:null};
  if(table==='factures')throw new Error('A Telegram document must not write quote invoices automatically');
  writes.push({table,mutation});return{data:null,error:null};
 };q.single=q.maybeSingle=async()=>resolve();q.then=(yes,no)=>Promise.resolve(resolve()).then(yes,no);return q;}};
 const fetch=async(url,options)=>{providerCalls.push({url,options});if(url.includes('/getFile'))return Response.json({ok:true,result:{file_path:unsupported?'documents/archive.zip':'documents/document.pdf'}});if(url.includes('/file/bot'))return new Response('SYNTHETIC PDF');if(ackFails)throw new Error('Synthetic unavailable acknowledgement');return Response.json({ok:true,result:{message_id:999}});};
 const run=await webhook(db,fetch);const message={message_id:123,chat:{id:42,type:'private'},from:{id:42},...(attachment?{caption:'Document complémentaire',document:{file_id:'test-file',file_size:13,file_name:unsupported?'archive.zip':'document.pdf'}}:{text:'Ma réponse'}),...(reply?{reply_to_message:{message_id:90}}:{})};
 const response=await run(new Request('http://localhost/test',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':'test-secret'},body:JSON.stringify({update_id:1001,message})}));return{response,writes,rpcCalls,providerCalls};
}
test('Actual webhook delegates explicit reply routing before considering the only active dossier',async()=>{
 const result=await scenario({reply:true});assert.equal(result.response.status,200);const lookup=result.rpcCalls.find(x=>x.name==='resolve_telegram_message_colis');assert.equal(lookup.args.p_reply_message_id,'90');assert.equal(lookup.args.p_client_id,'fixture-client');const message=result.writes.find(x=>x.table==='messages').mutation;assert.equal(message.colis_id,'fixture-selected');assert.equal(result.writes.some(x=>x.table==='client_inbox'),false);
});
test('Actual webhook stores paid attachment as readable conversation document without invoice mutation',async()=>{
 const result=await scenario({attachment:true});assert.equal(result.response.status,200);assert.equal(result.writes.filter(x=>x.table==='storage').length,1);const message=result.writes.find(x=>x.table==='messages').mutation;assert.equal(message.colis_id,'fixture-selected');assert.equal(message.attachment_path,'fixture-selected/telegram_1001.pdf');assert.equal(message.attachment_name,'document.pdf');assert.equal(message.attachment_type,'application/pdf');assert.match(message.texte,/Document reçu/);assert.equal(result.writes.find(x=>x.table==='telegram_updates').mutation.status,'done');
});
test('Ambiguous explicit routing creates durable inbox instead of selecting unrelated active dossier',async()=>{
 const result=await scenario({reply:true,ambiguous:true});assert.equal(result.response.status,200);assert.equal(result.writes.some(x=>x.table==='messages'),false);assert.equal(result.writes.filter(x=>x.table==='client_inbox').length,1);assert.equal(result.writes.find(x=>x.table==='telegram_updates').mutation.status,'done');
});
test('Unsupported attachment remains a durable team request and does not loop webhook retries',async()=>{
 const result=await scenario({attachment:true,unsupported:true});assert.equal(result.response.status,200);const inbox=result.writes.find(x=>x.table==='client_inbox').mutation;assert.match(inbox.texte,/EXP-PAID/);assert.match(inbox.payload.intake_error,/PDF/);assert.equal(result.writes.some(x=>x.table==='storage'),false);assert.equal(result.writes.find(x=>x.table==='telegram_updates').mutation.status,'done');
});
test('A failed acknowledgement does not replay the already persisted client message',async()=>{
 const result=await scenario({ackFails:true});assert.equal(result.response.status,200);assert.equal(result.writes.filter(x=>x.table==='messages').length,1);assert.equal(result.writes.find(x=>x.table==='telegram_updates').mutation.status,'done');
});
