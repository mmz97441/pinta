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
// The analysis gate is computed in SQL (invoice_analysis_gate: validated without an open modification,
// inactive copy, frozen dossier). These tests set its answer, one per call, and check what the function does.
const ALLOWED = { allowed: true, reason: null };
async function resumeFixture({ role = 'preparateur', permissions = { perm_factures_valider: true }, extraction = true, storedBytes = 'current document', storedIdentity = 'object-version-1', afterIdentity = 'object-version-1', gate = () => ALLOWED, env: extraEnv = {}, fetch } = {}) {
  let mutations = 0; let downloads = 0; let gates = 0; const writes = [];
  const bytes = new TextEncoder().encode(storedBytes);
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const db = database({
    profiles: { id: '10000000-0000-4000-8000-000000000001', role, actif: true },
    staff_users: { id: 'staff', actif: true }, staff_permissions: permissions,
    factures: ({ mutation }) => { if (mutation) writes.push(['factures', mutation]); return { data: { id: factureId, colis_id: colisId, fichier_url: `${colisId}/doc.pdf` }, error: null }; },
    ocr_jobs: ({ mutation }) => { if (mutation) writes.push(['ocr_jobs', mutation]); return { data: null, error: null }; },
    categories: [{ id: 'cat-clothes', label: 'Vêtements' }],
    ocr_extractions: ({ filters, mutation }) => { if (mutation) mutations++; if (filters.facture_id) { assert.equal(filters.facture_id, factureId); assert.equal(filters.document_hash, hash); } return { data: extraction ? { id: '50000000-0000-4000-8000-000000000001', facture_id: factureId, document_hash: hash, document_file_url: `${colisId}/doc.pdf`, document_storage_identity: mutation?.document_storage_identity ?? storedIdentity, status: 'review', total: 10, lines: [{ desc: 'Article', qte: 1, prix: 10, cat: null }] } : null, error: null }; },
  });
  let identityReads = 0;
  db.rpc = async (name, args) => {
    if (name === 'invoice_analysis_gate') { assert.equal(args.p_facture_id, factureId); return { data: gate(++gates), error: null }; }
    assert.equal(name, 'invoice_storage_identity'); return { data: ++identityReads === 1 ? 'object-version-1' : afterIdentity, error: null };
  };
  db.storage = { from: (bucket) => ({ download: async (path) => { downloads++; assert.equal(bucket, 'factures'); assert.equal(path, `${colisId}/doc.pdf`); return { data: new Blob([bytes]), error: null }; } }) };
  const run = await handler('ocr-facture', { env: { ...env, ...extraEnv }, db, ...(fetch ? { fetch } : {}) });
  return { run, db, hash, mutations: () => mutations, downloads: () => downloads, gates: () => gates, writes };
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


test('OCR resume binds historical analysis only after rehashing its current storage object', async () => {
  const f = await resumeFixture({ storedIdentity: null });
  const response = await f.run(req({ colisId, factureId, action: 'resume' }, { authorization: 'Bearer validator' }));
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.extraction.document_storage_identity, 'object-version-1');
  assert.equal(f.mutations(), 1);
});

test('OCR resume refuses an object replaced during download before writing a trusted proof', async () => {
  const f = await resumeFixture({ storedIdentity: null, afterIdentity: 'object-version-2' });
  const response = await f.run(req({ colisId, factureId, action: 'resume' }, { authorization: 'Bearer validator' }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changé/);
  assert.equal(f.mutations(), 0);
});

const blocked = reason => () => ({ allowed: false, reason });
test('a validated invoice without an open modification is never analysed: no download, no write (D1)', async () => {
  for (const [action, permissions] of [['resume', { perm_factures_valider: true }], ['extract', { perm_factures_ocr: true }]]) {
    const f = await resumeFixture({ permissions, gate: blocked('validated') });
    const response = await f.run(req({ colisId, factureId, action }, { authorization: 'Bearer validator' }));
    assert.equal(response.status, 409, action); const body = await response.json();
    assert.equal(body.error, 'Facture validée : ouvrez « Modifier la vérification » pour relancer son analyse.'); assert.equal(body.hint, 'analysis_not_allowed:validated');
    assert.equal(f.downloads(), 0); assert.equal(f.mutations(), 0); assert.equal(f.writes.length, 0);
  }
});

test('« Modifier la vérification » reopens the analysis of a validated invoice', async () => {
  const f = await resumeFixture();  // the gate allows it once the modification draft exists
  const response = await f.run(req({ colisId, factureId, action: 'resume' }, { authorization: 'Bearer validator' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).extraction.status, 'review'); assert.equal(f.gates(), 1);
});

test('a frozen or inactive invoice refuses staff and is skipped by the worker, before any download (D4)', async () => {
  for (const [reason, text] of [['frozen', /Paiement ou départ enregistré/], ['inactive', /retirée, remplacée ou à corriger/]]) {
    const staff = await resumeFixture({ permissions: { perm_factures_ocr: true }, gate: blocked(reason) });
    const refused = await staff.run(req({ colisId, factureId, action: 'extract' }, { authorization: 'Bearer analyst' }));
    assert.equal(refused.status, 409); assert.match((await refused.json()).error, text); assert.equal(staff.downloads(), 0);
    const worker = await resumeFixture({ gate: blocked(reason), env: { SUPABASE_SERVICE_ROLE_KEY: 'service-fixture' } });
    const skipped = await worker.run(req({ colisId, factureId, action: 'extract' }, { authorization: 'Bearer service-fixture' }));
    assert.equal(skipped.status, 200); assert.deepEqual(await skipped.json(), { success: true, skipped: reason });
    assert.equal(worker.downloads(), 0); assert.equal(worker.writes.length, 0); assert.equal(worker.mutations(), 0);
  }
});

test('a validation or payment during the analysis stops the next write', async () => {
  // Resume must stamp a historical analysis: the gate is checked again just before.
  const resume = await resumeFixture({ storedIdentity: null, gate: call => call === 1 ? ALLOWED : { allowed: false, reason: 'validated' } });
  const refused = await resume.run(req({ colisId, factureId, action: 'resume' }, { authorization: 'Bearer validator' }));
  assert.equal(refused.status, 409); assert.equal(resume.mutations(), 0); assert.equal(resume.gates(), 2);
  // An automated extraction answered by the provider writes nothing once the dossier is frozen meanwhile.
  let provider = 0;
  const extract = await resumeFixture({ extraction: false, gate: call => call === 1 ? ALLOWED : { allowed: false, reason: 'frozen' },
    env: { SUPABASE_SERVICE_ROLE_KEY: 'service-fixture', ANTHROPIC_API_KEY: 'anthropic-fixture', ANTHROPIC_MODEL: 'model-fixture' },
    fetch: async () => { provider++; return Response.json({ content: [{ type: 'text', text: JSON.stringify({ vendeur: 'Boutique', total_ht: 10, par_categorie: [{ categorie: 'Vêtements', nb_articles: 1, total_ht: 10, detail: 'T-shirt' }] }) }] }); } });
  const skipped = await extract.run(req({ colisId, factureId, action: 'extract' }, { authorization: 'Bearer service-fixture' }));
  assert.deepEqual(await skipped.json(), { success: true, skipped: 'frozen' }); assert.equal(provider, 1);
  assert.equal(extract.mutations(), 0); assert.equal(extract.writes.length, 0);
  // The database guard gives the same answer if the race is lost after the last check.
  const raced = await resumeFixture({ storedIdentity: null });
  raced.db.from = ((from) => (table) => table === 'ocr_extractions' ? { ...from(table), update: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { code: '22023', message: 'figé', hint: 'invoices_frozen:payment' } }) }) }) }) }) }) } : from(table))(raced.db.from.bind(raced.db));
  const lost = await raced.run(req({ colisId, factureId, action: 'resume' }, { authorization: 'Bearer validator' }));
  assert.equal(lost.status, 409); assert.equal((await lost.json()).hint, 'analysis_not_allowed:frozen');
});

// ---- OCR worker (relances-auto) ---------------------------------------------------------------
let queueBundle;
async function worker({ jobs, gate = () => ALLOWED, ocr, refuseFactures = () => null }) {
  queueBundle ||= (await esbuild.build({ entryPoints: [path.join(root, '_shared/ocrQueue.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', plugins: [{ name: 'mock-supabase', setup(build) {
    build.onResolve({ filter: /^https:\/\/esm.sh\/@supabase\// }, () => ({ path: 'supabase', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClient=()=>{throw new Error("No external database");};', loader: 'js' }));
  } }] })).outputFiles[0].text;
  const writes = []; const requests = [];
  const db = { rpc: async (name, args) => { assert.equal(name, 'invoice_analysis_gate'); return { data: gate(args.p_facture_id), error: null }; },
    from(table) {
      const filters = []; let mutation; const rows = table === 'ocr_jobs' ? jobs : [];
      const q = { select: () => q, order: () => q, limit: () => q, update(value) { mutation = value; return q; },
        lt(k, v) { filters.push(row => row[k] != null && row[k] < v); return q; }, lte(k, v) { filters.push(row => row[k] != null && row[k] <= v); return q; },
        eq(k, v) { filters.push(row => row[k] === v); return q; }, maybeSingle: async () => resolve(true), then: (yes, no) => Promise.resolve(resolve(false)).then(yes, no) };
      function resolve(single) {
        if (table === 'factures' && mutation) { const error = refuseFactures(mutation); writes.push({ table, mutation, refused: Boolean(error) }); return { data: null, error }; }
        const matched = rows.filter(row => filters.every(fn => fn(row)));
        if (mutation) { writes.push({ table, mutation, ids: matched.map(row => row.facture_id) }); matched.forEach(row => Object.assign(row, mutation)); }
        return { data: single ? matched[0] ?? null : matched, error: null };
      }
      return q;
    } };
  const module = { exports: {} };
  vm.runInNewContext(queueBundle, { module, exports: module.exports, Deno: { env: { get: key => ({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm', SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture' })[key] } },
    fetch: async (url, options) => { const body = JSON.parse(options.body); requests.push(body.factureId); return ocr(body.factureId); }, Response, AbortSignal, Date, console: { log() {}, warn() {}, error() {} } });
  return { result: await module.exports.processOcrQueue(db), writes, requests };
}
const job = (id) => ({ facture_id: id, colis_id: colisId, status: 'pending', attempts: 0, available_at: '2026-01-01T00:00:00Z' });
const secondInvoice = '40000000-0000-4000-8000-000000000002';

test('the worker records a skipped job for a validated or frozen invoice, without analysing or writing the invoice', async () => {
  const jobs = [job(factureId)];
  const run = await worker({ jobs, gate: () => ({ allowed: false, reason: 'validated' }), ocr: () => { throw new Error('No analysis expected'); } });
  assert.equal(run.requests.length, 0); assert.equal(jobs[0].status, 'skipped'); assert.equal(jobs[0].last_error, 'Analyse non lancée : facture déjà validée');
  assert.equal(run.writes.some(w => w.table === 'factures'), false); assert.equal(run.result.processed, 0);
});

test('an analysis skipped by ocr-facture is recorded as skipped, without writing the invoice', async () => {
  const jobs = [job(factureId)];
  const run = await worker({ jobs, ocr: () => Response.json({ success: true, skipped: 'frozen' }) });
  assert.deepEqual(run.requests, [factureId]); assert.equal(jobs[0].status, 'skipped'); assert.equal(jobs[0].last_error, 'Analyse non lancée : dossier payé, parti ou clos');
  assert.equal(run.writes.some(w => w.table === 'factures'), false);
});

test('a freeze refusing the failure status on the invoice does not stop the worker loop', async () => {
  const jobs = [job(factureId), job(secondInvoice)];
  const run = await worker({ jobs, refuseFactures: mutation => mutation.ocr_status === 'failed' ? { code: '22023', message: 'figé', hint: 'invoices_frozen:payment' } : null,
    ocr: id => id === factureId ? Response.json({ success: false, error: 'Analyse impossible' }, { status: 502 }) : Response.json({ success: true, extraction: { status: 'review' } }) });
  assert.deepEqual(run.requests, [factureId, secondInvoice]); assert.equal(jobs[0].status, 'pending'); assert.equal(jobs[0].last_error, 'Analyse impossible');
  assert.equal(jobs[1].status, 'review'); assert.equal(run.result.processed, 1);
  assert.deepEqual(run.writes.filter(w => w.table === 'factures').map(w => [w.mutation.ocr_status, w.refused]), [['failed', true], ['review', false]]);
});
