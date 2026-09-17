const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const path=require('node:path');const esbuild=require('../../node_modules/esbuild');
let bundle;
async function endpoint({role='directeur',active=true,permission=true,status='unassigned',file={file_id:'fixture',file_size:100},provider}={}){
 if(!bundle){const result=await esbuild.build({entryPoints:[path.resolve(__dirname,'../functions/telegram-inbox-document/index.ts')],bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'mock',setup(b){b.onResolve({filter:/^https:\/\/esm.sh/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=()=>globalThis.db;',loader:'js'}));}}]});bundle=result.outputFiles[0].text;}
 const calls=[];const db={auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},rpc:async()=>({data:permission,error:null}),from(table){const q={select(){return q;},eq(){return q;},single:async()=>({data:table==='profiles'?{id:'actor',role,actif:active}:table==='staff_users'?{id:'staff',role,actif:true}:table==='staff_permissions'?{staff_id:'staff',perm_comm_telegram:permission}:{id:'aaaaaaaa-1111-4111-8111-111111111111',status,payload:{document:file}},error:null}),maybeSingle:async()=>({data:{id:'staff',role,actif:true},error:null})};return q;}};
 let handler;vm.runInNewContext(bundle,{db,Deno:{env:{get:key=>key==='TELEGRAM_BOT_TOKEN'?'private-token':undefined},serve:fn=>handler=fn},Request,Response,URL,Uint8Array,AbortSignal,console:{error(){}},fetch:async(url,opts)=>{calls.push({url,opts});return provider?provider(url,opts):url.includes('/getFile')?Response.json({ok:true,result:{file_path:'documents/sample.pdf'}}):new Response('%PDF-1.7\nfixture');}});
 return {handler,calls};
}
const req=(token=true)=>new Request('https://example.invalid/test',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify({inboxId:'aaaaaaaa-1111-4111-8111-111111111111'})});
test('preview denies anonymous, inactive and client accounts before provider access',async()=>{for(const opt of [{token:false},{role:'client'},{active:false}]){const e=await endpoint(opt);const response=await e.handler(req(opt.token!==false));assert.ok([401,403].includes(response.status));assert.equal(e.calls.length,0);}});
test('preview rejects assigned or oversized documents without fetching provider',async()=>{for(const opt of [{status:'assigned'},{file:{file_id:'fixture',file_size:11*1024*1024}}]){const e=await endpoint(opt);assert.ok([400,409].includes((await e.handler(req())).status));assert.equal(e.calls.length,0);}});
test('authorized read returns PDF bytes with no cache and no provider secret',async()=>{const e=await endpoint({role:'preparateur',permission:true});const response=await e.handler(req());assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/pdf');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(await response.text(),'%PDF-1.7\nfixture');assert.equal(e.calls.length,2);assert.ok(e.calls.every(c=>!c.url.includes('sendMessage')));});

test('staff without Telegram permission is refused before any provider call',async()=>{
 const e=await endpoint({role:'preparateur',permission:false});const response=await e.handler(req());
 assert.equal(response.status,403);assert.match((await response.json()).error,/Permission insuffisante/);assert.equal(e.calls.length,0);
});
test('stream exceeding 10 MiB is cancelled even when Telegram announces a small file',async()=>{
 let cancelled=false;
 const e=await endpoint({file:{file_id:'fixture',file_size:100},provider:async url=>{
  if(url.includes('/getFile'))return Response.json({ok:true,result:{file_path:'documents/sample.pdf',file_size:100}});
  return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(6*1024*1024));controller.enqueue(new Uint8Array(6*1024*1024));},cancel(){cancelled=true;}}));
 }});
 const response=await e.handler(req());assert.equal(response.status,400);const payload=await response.json();assert.match(payload.error,/dépasse 10 Mo/);assert.equal(cancelled,true);assert.equal(e.calls.length,2);assert.ok(!JSON.stringify(payload).includes('private-token'));
});
