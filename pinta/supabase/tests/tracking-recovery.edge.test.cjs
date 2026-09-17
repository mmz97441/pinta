const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const vm=require('node:vm');
const esbuild=require('../../node_modules/esbuild');
let bundle;
async function handler({link={id:'link',client_id:'client'},linkError=null,clientError=null}={}){
 if(!bundle){const result=await esbuild.build({entryPoints:[path.join(__dirname,'../functions/get-tracking/index.ts')],bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'mock-db',setup(build){build.onResolve({filter:/^https:\/\/esm.sh\/@supabase\//},()=>({path:'supabase',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=()=>globalThis.__db;',loader:'js'}));}}]});bundle=result.outputFiles[0].text;}
 let serve;const db={from(table){const q={select(){return q;},eq(){return q;},maybeSingle:async()=>table==='share_links'?{data:link,error:linkError}:{data:null,error:clientError}};return q;}};
 vm.runInNewContext(bundle,{__db:db,Deno:{env:{get:()=>''},serve:fn=>{serve=fn;}},Request,Response,URL,console:{error(){}}});return serve;
}
const request=()=>new Request('https://fixture.example/functions/get-tracking?token=synthetic-token-at-least-20');
test('database failures are retryable without leaking internal diagnostics or requesting a replacement link',async()=>{
 for(const failure of [{linkError:{message:'private-table-error'}},{clientError:{message:'private-client-error'}}]){
  const response=await(await handler(failure))(request());assert.equal(response.status,500);const body=await response.json();assert.equal(body.ok,false);assert.match(body.error,/momentanément indisponible/);assert.doesNotMatch(body.error,/private-|introuvable|révoqué/);
 }
});
test('missing and revoked links retain non-retryable HTTP states',async()=>{
 assert.equal((await(await handler({link:null}))(request())).status,404);
 assert.equal((await(await handler({link:{revoked_at:'2026-09-17'}}))(request())).status,410);
 assert.equal((await(await handler())(new Request('https://fixture.example/?token=short'))).status,400);
});
