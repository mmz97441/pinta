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
const factureId = '40000000-0000-4000-8000-000000000001';
const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'anon' };
async function resumeFixture({ role = 'preparateur', permissions = { perm_factures_valider: true }, extraction = true, storedBytes = 'current document' } = {}) {
  let mutations = 0;
  const bytes = new TextEncoder().encode(storedBytes);
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const db = database({
    profiles: { id: '10000000-0000-4000-8000-000000000001', role, actif: true },
    staff_users: { id: 'staff', actif: true }, staff_permissions: permissions,
    factures: { id: factureId, colis_id: colisId, fichier_url: `${colisId}/doc.pdf` },
    ocr_extractions: ({ filters, mutation }) => { if (mutation) mutations++; if (filters.facture_id) { assert.equal(filters.facture_id, factureId); assert.equal(filters.document_hash, hash); } return { data: extraction ? { id: '50000000-0000-4000-8000-000000000001', facture_id: factureId, document_hash: hash, document_file_url: `${colisId}/doc.pdf`, status: 'review', total: 10, lines: [{ desc: 'Article', qte: 1, prix: 10, cat: null }] } : null, error: null }; },
  });
  db.storage = { from: (bucket) => ({ download: async (path) => { assert.equal(bucket, 'factures'); assert.equal(path, `${colisId}/doc.pdf`); return { data: new Blob([bytes]), error: null }; } }) };
  const run = await handler('ocr-facture', { env, db });
  return { run, db, hash, mutations: () => mutations };
}

test('OCR resume allows validators, hashes the current document and returns staged analysis without writes or provider calls', async () => {
  const f = await resumeFixture();
  const response = await f.run(req({ colisId, factureId, action: 'resume' }, { authorization: 'Bearer validator' }));
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.extraction.status, 'review'); assert.equal(body.reused, true); assert.equal(body.insertedLignes.length, 0); assert.equal(f.mutations(), 0);
});

test('OCR resume has no fallback extraction for a replacement document', async () => {
  const f = await resumeFixture({ extraction: false, storedBytes: 'replacement document' });
  const response = await f.run(req({ colisId, factureId, action: 'resume' }, { authorization: 'Bearer validator' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).extraction, null);
});

test('OCR resume requires either OCR or validation permission, never a client role', async () => {
  for (const options of [{ permissions: {} }, { role: 'client' }]) {
    const f = await resumeFixture(options);
    const response = await f.run(req({ colisId, factureId, action: 'resume' }, { authorization: 'Bearer user' }));
    assert.equal(response.status, 403);
  }
  const f = await resumeFixture({ permissions: { perm_factures_ocr: true } });
  assert.equal((await f.run(req({ colisId, factureId, action: 'resume' }, { authorization: 'Bearer analyst' }))).status, 200);
});

test('OCR confirmation transmits the verified file version to the transactional command', async () => {
  const fixture = await resumeFixture(); let called = false;
  fixture.db.rpc = async (name, args) => {
    called = true; assert.equal(name, 'confirm_ocr_extraction_current');
    assert.equal(args.p_expected_file_url, `${colisId}/doc.pdf`);
    assert.equal(args.p_expected_document_hash, fixture.hash);
    assert.equal(args.p_extraction_id, '50000000-0000-4000-8000-000000000001');
    return { data: { success: true, insertedLignes: [] }, error: null };
  };
  const response = await fixture.run(req({ colisId, factureId, action: 'confirm', extractionId: '50000000-0000-4000-8000-000000000001' }, { authorization: 'Bearer validator' }));
  assert.equal(response.status, 200); assert.equal(called, true);
});
