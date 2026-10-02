/* Principal dossier table: synthetic data only; no provider or production call.
 * The mock controls command results. SQL suites prove server permissions/locking. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const XLSX = require('xlsx');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_DOSSIER_TABLE_OUT || '/tmp/pinta-dossier-table';
const B = '88888888-1111-4111-8111-111111111111';
const D = '88888888-2222-4222-8222-222222222222';
const P = ids.P;
const parcelId = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actionId = n => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P2 = parcelId(2), P3 = parcelId(3), P4 = parcelId(4), P5 = parcelId(5), P6 = parcelId(6);
const RECEIVE = actionId(1), PREPARE = actionId(2), DOCUMENTS = actionId(3), WAIT = actionId(4);
const results = [];
const row = (f, id) => f.page.locator(`[data-dossier-row="${id}"]:visible, [data-dossier-card="${id}"]:visible`).first();
const rows = f => f.page.locator('[data-dossier-row]:visible, [data-dossier-card]:visible');
const cell = (f, id, column) => row(f, id).locator(`[data-column="${column}"]`);
const take = f => row(f, P).getByRole('button', { name: 'Je m’en occupe', exact: true });
const businessWrites = f => f.requests.filter(request => ['POST', 'PATCH', 'DELETE'].includes(request.method)
  && request.path.startsWith('/rest/v1/') && !request.path.endsWith('/refresh_staff_work_actions'));
const allIds = async f => (await rows(f).evaluateAll(elements => elements.map(node => node.dataset.dossierRow || node.dataset.dossierCard))).sort();
const reply = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function fixture(browser, options = {}) {
  const f = await setup(browser, options.restricted ? 'preparateur' : 'directeur');
  f.page.setDefaultTimeout(10000);
  f.tables.staff_users.push({ id: B, auth_id: B, nom: 'Madly', role: 'directeur', actif: true, staff_permissions: {} });
  if (options.restricted) {
    const rights = { id: 'table-permissions', staff_id: ids.S, perm_colis_preparer: true, ...(options.financeReadNoExport ? { perm_finances_voir_total: true, perm_export_colis: true, perm_finances_exporter: false } : {}) };
    f.tables.staff_permissions = [rights]; f.tables.staff_users[0].staff_permissions = rights;
  }
  f.tables.staff_work_preferences[0].active_mission = null;
  f.tables.staff_work_preferences[0].available = !options.unavailable;
  f.tables.clients[0].user_id = ids.C;
  const original = structuredClone(f.tables.colis[0]);
  const boxes = [{dimL:40,dimW:30,dimH:20,poids:1.5},{dimL:35,dimW:25,dimH:20,poids:1.5}];
  const parcel = (id, ref, changes = {}) => ({...structuredClone(original), id, ref, dims_par_colis:structuredClone(boxes), responsible_staff_id:B, ...changes});
  f.tables.colis = [
    parcel(P, 'EXP-TAB001', {statut:'mesure',feu_vert:'en_attente',final_packages:[],fin_l:null,fin_w:null,fin_h:null,fin_p:null,final_measurements_version:null,outgoing_parcel_count:0,devis_total:0,quote_version:0,responsible_staff_id:ids.A}),
    parcel(P2, 'EXP-TAB002', {statut:'autorise',final_packages:[],fin_l:null,fin_w:null,fin_h:null,fin_p:null,final_measurements_version:null,outgoing_parcel_count:0,devis_total:0,quote_version:0}),
    parcel(P3, 'EXP-TAB003', {statut:'attente_feu_vert',feu_vert:'en_attente',demande_feu_vert_envoyee_at:'2026-10-01T08:00:00Z',devis_total:0,quote_version:0,responsible_staff_id:ids.A}),
    parcel(P4, 'EXP-TAB004', {statut:'paye',quote_version:1,devis_brouillon:false,devis_envoye_le:'2026-10-01T08:00:00Z',devis_total:100,devis_transport:80,devis_om:10,devis_omr:5,devis_tva:5,paiement_montant:30,paiement_date:'2026-10-01T10:00:00Z',envoi_id:D}),
    parcel(P5, 'EXP-TAB005', {statut:'paye',quote_version:1,devis_brouillon:false,devis_envoye_le:'2026-10-01T08:00:00Z',devis_total:100,paiement_montant:100,paiement_date:'2026-10-01T10:00:00Z',envoi_id:D}),
    parcel(P6, 'EXP-TAB006', {statut:'paye',quote_version:1,devis_brouillon:false,devis_envoye_le:'2026-10-01T08:00:00Z',devis_total:100,paiement_montant:100,paiement_date:'2026-10-01T10:00:00Z',envoi_id:D,preparation_composition_version:2,final_measurements_version:1}),
  ];
  const invoice = structuredClone(f.tables.factures[0]), line = structuredClone(f.tables.lignes[0]);
  f.tables.factures = f.tables.colis.map((parcel, i) => ({...invoice,id:`invoice-${i}`,colis_id:parcel.id}));
  f.tables.lignes = f.tables.colis.map((parcel, i) => ({...line,id:`line-${i}`,colis_id:parcel.id,facture_id:`invoice-${i}`}));
  f.tables.envois = [{id:D,ref:'DEP-QA-01',destination_code:'974',date_depart:'2099-10-03',statut:'planifie',updated_at:'2026-10-01T08:00:00Z'}];
  const work = (id, colisId, kind, changes = {}) => ({id,colis_id:colisId,kind,state:'ready',assignee_id:null,version:4,created_at:'2026-10-01T08:00:00Z',updated_at:'2026-10-01T08:00:00Z',...changes});
  f.tables.staff_work_actions = [
    work(RECEIVE,P,'reception'),
    work(PREPARE,P2,'preparation',{state:'in_progress',assignee_id:ids.A}),
    work(DOCUMENTS,P2,'documents',{state:'in_progress',assignee_id:B}),
    work(WAIT,P3,'reception',{state:'waiting',blocked_reason:'Accord du client attendu'}),
    work(actionId(5),P4,'departure',{state:'waiting',blocked_reason:'Règlement à compléter'}),
    work(actionId(6),P5,'departure',{assignee_id:B}),
    work(actionId(7),P6,'departure',{state:'waiting',blocked_reason:'Optimisation à revoir'}),
  ];
  f.claims = []; f.claimConflict = Boolean(options.conflict); f.failWork = Boolean(options.failWork); f.holdClaim = false;
  let releaseClaim; const claimGate = new Promise(resolve => { releaseClaim = resolve; }); f.releaseClaim = releaseClaim;
  await f.context.route('**/rest/v1/staff_work_actions?*', route => f.failWork ? reply(route,{message:'Tâches indisponibles pour cet essai.'},503) : route.fallback());
  await f.context.route('**/rest/v1/rpc/mutate_staff_work_action', async route => {
    const input = route.request().postDataJSON(); f.claims.push(input);
    const action = f.tables.staff_work_actions.find(item => item.id === input.p_action_id);
    if (f.claimConflict) {
      action.assignee_id = B; action.version++;
      return reply(route,{code:'40001',message:'Un collègue vient de prendre cette tâche. Actualisez.'},409);
    }
    assert.equal(input.p_command, 'take'); assert.equal(input.p_expected_version, action.version);
    assert.equal(action.state, 'ready'); assert.equal(action.blocked_reason || null, null);
    assert.ok(!action.assignee_id || action.assignee_id === ids.A);
    action.assignee_id=ids.A; action.state='in_progress'; action.version++;
    if (f.holdClaim) await claimGate;
    return reply(route,action).catch(() => {});
  });
  return f;
}

async function open(f, query = '') {
  await f.page.goto(`${base}/colis${query ? '?' + query : ''}`);
  await f.page.getByLabel('Rechercher ou scanner un colis',{exact:true}).waitFor();
  if (!f.failWork) await row(f,P).waitFor();
}
async function selectPreset(f,label,value) {
  const button=f.page.locator('[aria-label="Vues du tableau"]').getByRole('button',{name:label,exact:true});
  await button.click();
  await f.page.waitForURL(url => (url.searchParams.get('table') || 'daily') === value);
  await button.evaluate(node => new Promise(resolve => { const check=()=>node.getAttribute('aria-pressed')==='true'?resolve():requestAnimationFrame(check);check(); }));
}
async function selectScope(f,label,value) {
  const button=f.page.locator('[aria-label="Choisir les tâches affichées"]').getByRole('button',{name:label,exact:true});
  await button.click();
  await f.page.waitForURL(url => (url.searchParams.get('tasks') || 'all') === value);
  await button.evaluate(node => new Promise(resolve => { const check=()=>node.getAttribute('aria-pressed')==='true'?resolve():requestAnimationFrame(check);check(); }));
}
async function assertNoBusinessChange(f,before) {
  assert.deepEqual(f.tables.colis,before); assert.equal(f.claims.length,0); assert.deepEqual(businessWrites(f),[]);
}

async function main() {
  await fs.mkdir(output,{recursive:true}); const browser = await chromium.launch({headless:true});
  async function scenario(name,run,options={}) {
    if(process.env.PINTA_DOSSIER_TABLE_FILTER && !name.includes(process.env.PINTA_DOSSIER_TABLE_FILTER))return;
    const f=await fixture(browser,options);
    try {
      await f.login(); await run(f); assert.deepEqual(f.errors,[]); assert.deepEqual(f.networkDenied,[]);
      assert.equal(f.requests.some(request=>/\/(queue_message|send-telegram|send-email|save_quote|save_preparation_measurements|assign_colis_departure)$/.test(request.path)),false,'Table navigation and taking a task never notify or validate a business step.');
      results.push({test:name,pass:true});
    } catch(error) {
      process.exitCode=1;results.push({test:name,pass:false,error:error.stack});
      await f.page.screenshot({path:`${output}/${name}-failure.png`,fullPage:true}).catch(()=>{});
      await fs.writeFile(`${output}/${name}-failure.txt`,await f.page.locator('body').innerText().catch(()=>''));
    } finally { f.releaseClaim();await f.context.close();console.log(JSON.stringify(results.at(-1))); }
  }
  try {
    await scenario('presets-change-columns-without-filtering-or-duplicating-expeditions',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);
      const expected=[P,P2,P3,P4,P5,P6].sort();assert.deepEqual(await allIds(f),expected);
      for(const [label,value] of [['Paiements','payments'],['Départs','departures'],['Travail quotidien','daily']]) {
        await selectPreset(f,label,value);assert.deepEqual(await allIds(f),expected,`${label} keeps the same expeditions`);
        assert.equal(await rows(f).count(),6,'Parallel tasks do not create duplicate EXP rows');
      }
      await assertNoBusinessChange(f,before);
    });
    await scenario('mine-uses-task-owner-not-general-dossier-contact',async f=>{
      await open(f);await selectScope(f,'Mes tâches','mine');
      assert.deepEqual(await allIds(f),[P2]);
      assert.equal(await row(f,P2).getByRole('button',{name:'Continuer',exact:true}).count(),1);
      assert.match(await row(f,P2).innerText(),/Optimis/);assert.match(await row(f,P2).innerText(),/Vous|Camille/);
      assert.equal(await row(f,P).count(),0,'A dossier with me as general contact does not become my reception task.');
      assert.equal(f.claims.length,0);
    });
    await scenario('mine-keeps-owned-waiting-work-and-presets-do-not-reassign-it',async f=>{
      f.tables.staff_work_actions.find(action=>action.id===WAIT).assignee_id=ids.A;
      await open(f);await selectScope(f,'Mes tâches','mine');
      for(const [label,value] of [['Paiements','payments'],['Départs','departures'],['Travail quotidien','daily']]) {
        await selectPreset(f,label,value);assert.deepEqual(await allIds(f),[P2,P3].sort());
        assert.equal(await row(f,P2).getByRole('button',{name:'Continuer',exact:true}).count(),1);
        assert.equal(await row(f,P3).getByRole('button',{name:'Consulter',exact:true}).count(),1);
      }
      assert.match(await row(f,P3).innerText(),/Accord du client attendu|Accord client attendu/);assert.equal(f.claims.length,0);
    });
    await scenario('pool-only-has-free-ready-permitted-work-not-client-waits',async f=>{
      await open(f);await selectScope(f,'À prendre','pool');assert.deepEqual(await allIds(f),[P]);
      assert.equal(await take(f).isEnabled(),true);assert.equal(await row(f,P3).count(),0);
      assert.equal(await row(f,P4).count(),0);assert.equal(f.claims.length,0);
    });
    await scenario('own-parallel-task-continues-in-its-real-workspace-without-claiming-colleague-work',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);await selectScope(f,'Mes tâches','mine');
      const list=f.page.url();await row(f,P2).getByRole('button',{name:'Continuer',exact:true}).click();
      await f.page.waitForURL(url=>url.pathname===`/colis/${P2}`&&url.searchParams.get('section')==='preparation');
      assert.equal(new URL(f.page.url()).searchParams.get('action'),PREPARE);
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'),new URL(list).pathname+new URL(list).search);
      await f.page.getByLabel('Poids réel · colis sortant 1 (kg)',{exact:true}).waitFor();
      assert.equal(f.tables.staff_work_actions.find(action=>action.id===DOCUMENTS).assignee_id,B);
      await assertNoBusinessChange(f,before);
    });
    await scenario('explicit-take-is-one-atomic-command-and-opens-reception-agreement',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);await selectScope(f,'À prendre','pool');
      await take(f).evaluate(button=>{button.click();button.click();});
      await f.page.waitForURL(url=>url.pathname===`/colis/${P}`&&url.searchParams.get('section')==='accord');
      assert.equal(new URL(f.page.url()).searchParams.get('action'),RECEIVE);
      assert.deepEqual(f.claims,[{p_action_id:RECEIVE,p_command:'take',p_expected_version:4,p_payload:{}}]);
      assert.equal(f.tables.staff_work_actions[0].state,'in_progress');assert.equal(f.tables.staff_work_actions[0].assignee_id,ids.A);
      assert.deepEqual(f.tables.colis,before);assert.deepEqual(f.tables.messages,[]);
    });
    await scenario('late-claim-response-never-navigates-away-from-new-selection',async f=>{
      await open(f);f.holdClaim=true;await take(f).click();
      await f.page.waitForFunction(() => [...document.querySelectorAll('button')].some(button=>button.textContent.includes('Ouverture…')));
      await selectPreset(f,'Paiements','payments');const requestedUrl=f.page.url();f.releaseClaim();
      await f.page.waitForTimeout(200);
      assert.equal(f.page.url(),requestedUrl);assert.equal(f.claims.length,1);
      assert.equal(f.tables.staff_work_actions[0].assignee_id,ids.A);
    });
    await scenario('consulting-colleague-task-never-takes-it',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);
      await row(f,P5).getByRole('button',{name:'Consulter',exact:true}).click();
      await f.page.getByTestId('dossier-task-header').waitFor();assert.equal(new URL(f.page.url()).pathname,`/colis/${P5}`);
      assert.equal(f.tables.staff_work_actions.find(action=>action.colis_id===P5).assignee_id,B);await assertNoBusinessChange(f,before);
    });
    await scenario('claim-conflict-retains-colleague-and-never-retries-automatically',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);await take(f).click();
      await f.page.getByRole('alert').filter({hasText:'Un collègue vient de prendre cette tâche'}).first().waitFor();
      await row(f,P).getByText(/Madly/).first().waitFor();assert.equal(await take(f).count(),0);
      assert.equal(new URL(f.page.url()).pathname,'/colis');assert.equal(f.claims.length,1);assert.deepEqual(f.tables.colis,before);
    },{conflict:true});
    await scenario('payments-show-uncalculated-and-partial-balance-truthfully',async f=>{
      await open(f);await selectPreset(f,'Paiements','payments');
      assert.match(await row(f,P).innerText(),/À calculer/);
      assert.doesNotMatch(await cell(f,P,'requested').innerText(),/0[,.]00\s*€/,'Initial zero is not presented as an established invoice.');
      const partial=await row(f,P4).innerText();assert.match(partial,/Paiement partiel/);assert.match(partial,/100[,.]00/);assert.match(partial,/30[,.]00/);assert.match(partial,/70[,.]00/);
      assert.match(await row(f,P5).innerText(),/Payé|Réglé/);assert.equal(f.claims.length,0);
    });
    await scenario('departure-readiness-rejects-stale-optimisation-and-partial-payment',async f=>{
      await open(f);await selectPreset(f,'Départs','departures');
      assert.match(await row(f,P5).innerText(),/Prêt/);assert.match(await row(f,P5).innerText(),/Prévu le 03\/10\/2099/);
      assert.doesNotMatch(await row(f,P6).innerText(),/Prêt(?:\s|$)/);assert.match(await row(f,P6).innerText(),/Optimisation|mesur/i);
      assert.doesNotMatch(await row(f,P4).innerText(),/Prêt(?:\s|$)/);assert.match(await row(f,P4).innerText(),/Règlement|Paiement|paiement/);
      assert.match(await row(f,P).innerText(),/À planifier/);assert.equal(f.claims.length,0);
    });
    await scenario('restricted-permission-cannot-take-reception-visible-in-all-dossiers',async f=>{
      await open(f);assert.equal(await take(f).count(),0);await selectScope(f,'À prendre','pool');
      assert.equal(await row(f,P).count(),0);assert.equal(f.claims.length,0);
    },{restricted:true});
    await scenario('finance-preset-permissions-cannot-be-bypassed-through-the-url',async f=>{
      await open(f,'table=payments');
      assert.equal(await f.page.getByRole('button',{name:'Paiements',exact:true}).count(),0);
      assert.equal(await cell(f,P,'requested').count(),0);
      await f.page.getByText(/montants.*autorisation|financ.*autorisation|accès.*financ|pas.*autorisé|pas.*accès/i).first().waitFor();
      assert.equal(f.claims.length,0);
    },{restricted:true});
    await scenario('hidden-selected-dossier-is-removed-before-any-bulk-command',async f=>{
      await open(f);await row(f,P).getByRole('checkbox',{name:'Sélectionner le dossier EXP-TAB001',exact:true}).check();
      await f.page.getByText('1 dossier sélectionné',{exact:true}).waitFor();
      assert.equal(await row(f,P).getByRole('checkbox',{name:'Sélectionner le dossier EXP-TAB001',exact:true}).isChecked(),true);
      assert.equal(await row(f,P).getAttribute('data-selected'),'true');
      await f.page.getByLabel('Rechercher ou scanner un colis',{exact:true}).fill('EXP-TAB002');
      await row(f,P2).waitFor();await f.page.getByText('1 dossier sélectionné',{exact:true}).waitFor({state:'hidden'});
      assert.equal(await row(f,P).count(),0);assert.equal(f.claims.length,0);assert.deepEqual(businessWrites(f),[]);
    });
    await scenario('unavailable-person-keeps-owned-work-but-cannot-take-pool-work',async f=>{
      await open(f);if(await take(f).count())assert.equal(await take(f).isDisabled(),true);
      await selectScope(f,'Mes tâches','mine');assert.deepEqual(await allIds(f),[P2]);
      await selectScope(f,'À prendre','pool');assert.equal(await rows(f).count(),0);assert.equal(f.claims.length,0);
    },{unavailable:true});
    await scenario('work-loading-failure-is-visible-and-cannot-advertise-a-false-free-task',async f=>{
      await open(f);await f.page.getByRole('alert').filter({hasText:/Tâches indisponibles|Impossible.*tâches|charg.*tâches|tâches n’ont pas pu/i}).first().waitFor();
      assert.equal(await f.page.getByRole('button',{name:'Je m’en occupe',exact:true}).count(),0);
      f.failWork=false;await f.page.getByRole('button',{name:/Réessayer.*tâches|Actualiser.*tâches|Recharger les tâches|Réessayer/}).filter({visible:true}).first().click();
      await take(f).waitFor();assert.equal(f.claims.length,0);
    },{failWork:true});
    await scenario('mobile-open-filters-leave-dossiers-clickable-and-keyboard-controls-visible',async f=>{
      await f.page.setViewportSize({width:390,height:844});await open(f);
      await f.page.getByRole('button',{name:/^Filtres et options/}).click();
      const close=f.page.getByRole('button',{name:'Fermer les filtres',exact:true});
      await f.page.keyboard.press('Tab');await close.focus();
      await close.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      const header=await close.locator('xpath=ancestor::header[1]').boundingBox();const control=await close.boundingBox();
      assert.ok(header.height<=844*.55+2,'The open options cannot consume the whole mobile viewport.');
      assert.ok(control.y>=header.y&&control.y+control.height<=header.y+header.height+1,'The last keyboard control can be brought into the visible header.');
      await row(f,P2).getByRole('button',{name:'EXP-TAB002',exact:true}).click();
      await f.page.getByTestId('dossier-task-header').waitFor();assert.equal(new URL(f.page.url()).pathname,`/colis/${P2}`);
      assert.equal(f.claims.length,0);assert.deepEqual(businessWrites(f),[]);
    });
    await scenario('unavailability-link-directly-opens-the-announced-preferences',async f=>{
      await open(f);await selectScope(f,'À prendre','pool');
      await f.page.getByRole('button',{name:'Modifier ma disponibilité dans Mon travail',exact:true}).click();
      await f.page.waitForURL(url=>url.pathname==='/'&&url.searchParams.get('preferences')==='1');
      const preferences=f.page.getByRole('form',{name:'Mes missions et disponibilité',exact:true});await preferences.waitFor();
      assert.equal(await preferences.getByRole('checkbox',{name:'Disponible pour prendre de nouvelles tâches',exact:true}).isChecked(),false);
      assert.equal(f.claims.length,0);assert.deepEqual(businessWrites(f),[]);
    },{unavailable:true});
    await scenario('excel-download-matches-visible-preset-and-recorded-amounts',async f=>{
      await open(f);await f.page.getByRole('button',{name:/^Filtres et options/}).click();
      const expected={daily:['Référence','Client','Travail à faire','Qui s’en occupe','Casier','Cartons reçus'],payments:['Référence','Client','Demandé','Payé','Reste à payer','Devis envoyé le'],departures:['Référence','Client','Départ prévu','Destination','Colis à expédier','Prêt à partir ?']};
      for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures']]) {
        await selectPreset(f,label,view);
        const downloaded=f.page.waitForEvent('download');await f.page.getByRole('button',{name:'Exporter 6 dossiers filtrés',exact:true}).click();
        const download=await downloaded;assert.equal(await download.failure(),null);
        const workbook=XLSX.read(await fs.readFile(await download.path()),{type:'buffer'});
        const data=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1});
        assert.deepEqual(data[0],expected[view]);assert.equal(data.length,7);assert.equal(new Set(data.slice(1).map(line=>line[0])).size,6);
        if(view==='payments') {
          const unknown=data.find(line=>line[0]==='EXP-TAB001'),partial=data.find(line=>line[0]==='EXP-TAB004');
          assert.equal(unknown[2],'À calculer');assert.deepEqual(partial.slice(2,5),[100,30,70]);
        }
        if(view==='daily')assert.equal(data.find(line=>line[0]==='EXP-TAB002')[3],'Vous');
      }
      assert.equal(f.claims.length,0);assert.deepEqual(businessWrites(f),[]);
    });
    await scenario('financial-view-does-not-grant-financial-export-permission',async f=>{
      await open(f);await f.page.getByRole('button',{name:/^Filtres et options/}).click();
      await f.page.getByRole('button',{name:'Exporter 6 dossiers filtrés',exact:true}).waitFor();
      await selectPreset(f,'Paiements','payments');assert.equal(await f.page.getByRole('button',{name:/^Exporter/}).count(),0);
      await row(f,P4).getByRole('checkbox',{name:'Sélectionner le dossier EXP-TAB004',exact:true}).check();
      assert.equal(await f.page.getByRole('button',{name:/^Exporter/}).count(),0);assert.deepEqual(businessWrites(f),[]);
    },{restricted:true,financeReadNoExport:true});
    await scenario('filters-and-scroll-survive-opening-and-returning-from-an-expedition',async f=>{
      for(let i=20;i<80;i++) {
        const parcel={...structuredClone(f.tables.colis[1]),id:parcelId(i),ref:`EXP-SCR${i}`,created_at:'2026-10-01T08:00:00Z'};f.tables.colis.push(parcel);
        f.tables.staff_work_actions.push({...f.tables.staff_work_actions[1],id:actionId(i),colis_id:parcel.id});
      }
      await open(f);await selectScope(f,'Mes tâches','mine');await selectPreset(f,'Paiements','payments');
      await f.page.getByLabel('Rechercher ou scanner un colis',{exact:true}).fill('Camille');
      await f.page.waitForURL(url=>url.searchParams.get('q')==='Camille');
      const listUrl=f.page.url();const target=row(f,parcelId(60));await target.scrollIntoViewIfNeeded();
      const position=await target.evaluate(node=>{let el=node.parentElement;while(el&&!(el.scrollHeight>el.clientHeight+5&&/(auto|scroll)/.test(getComputedStyle(el).overflowY)))el=el.parentElement;return {top:el?.scrollTop||0,ref:node.getAttribute('data-dossier-row')||node.getAttribute('data-dossier-card')};});
      assert.ok(position.top>100,'The list was actually scrolled before opening a dossier.');
      await target.getByRole('button',{name:'EXP-SCR60',exact:true}).click();await f.page.getByTestId('dossier-task-header').waitFor();
      assert.equal(new URL(f.page.url()).searchParams.get('returnTo'),new URL(listUrl).pathname+new URL(listUrl).search);
      await f.page.getByRole('button',{name:'Retour à la liste de travail',exact:true}).click();await f.page.waitForURL(listUrl);
      await target.waitFor();
      const restored=await target.evaluate(node=>{let el=node.parentElement;while(el&&!(el.scrollHeight>el.clientHeight+5&&/(auto|scroll)/.test(getComputedStyle(el).overflowY)))el=el.parentElement;return el?.scrollTop||0;});
      assert.ok(Math.abs(restored-position.top)<=3,`List scroll restored (${position.top} → ${restored}).`);assert.equal(f.claims.length,0);
    });
    await scenario('mobile-primary-action-keeps-space-with-alternative-platform-fonts',async f=>{
      await f.page.setViewportSize({width:390,height:844});await open(f);
      for(const family of ['Arial','Verdana']) {
        await f.page.addStyleTag({content:`.dossier-list { font-family: ${family}, sans-serif !important; }`});
        await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const action=await row(f,P2).getByRole('button',{name:'Continuer',exact:true}).boundingBox();
        const navigation=await f.page.getByRole('button',{name:'Dossiers',exact:true}).locator('..').boundingBox();
        assert.ok(action.y+action.height<=navigation.y-12,`${family} preserves at least 12px before the mobile navigation (${action.y+action.height} <= ${navigation.y-12}).`);
        assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      }
      assert.deepEqual(businessWrites(f),[]);
    });
    for(const width of [1440,390])for(const dark of [false,true])await scenario(`table-readable-and-accessible-${width}-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width,height:width===390?844:1000});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      await open(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
      await row(f,P2).waitFor();assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      if(width===390){
        const action=await row(f,P2).getByRole('button',{name:'Continuer',exact:true}).boundingBox();
        const bottomNav=await f.page.getByRole('button',{name:'Dossiers',exact:true}).locator('..').boundingBox();
        assert.ok(action.y>=0&&action.y+action.height<=bottomNav.y,`The first primary action is fully visible before scrolling (${action.y+action.height} <= ${bottomNav.y}).`);
      }
      if(width===1440) {
        await selectPreset(f,'Paiements','payments');
        // A narrower desktop still uses the table and genuinely needs horizontal scrolling.
        await f.page.setViewportSize({width:1280,height:1000});
        const ref=cell(f,P,'ref'),client=cell(f,P,'client');await ref.waitFor();await client.waitFor();
        const before=[await ref.boundingBox(),await client.boundingBox()];
        const scroll=await ref.evaluate(node=>{let el=node.parentElement;while(el&&!(el.scrollWidth>el.clientWidth+5&&/(auto|scroll)/.test(getComputedStyle(el).overflowX)))el=el.parentElement;if(!el)return null;el.scrollLeft=el.scrollWidth;return {left:el.scrollLeft,max:el.scrollWidth-el.clientWidth};});
        assert.ok(scroll&&scroll.left>20,'The payment table actually scrolls horizontally.');
        await ref.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        const after=[await ref.boundingBox(),await client.boundingBox()];
        for(let i=0;i<2;i++)assert.ok(Math.abs(after[i].x-before[i].x)<=2,`Sticky ${i===0?'EXP':'Client'} remains fixed while the other columns scroll.`);
        await f.page.setViewportSize({width,height:1000});
      }
      const audit=await new AxeBuilder({page:f.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
      await f.page.screenshot({path:`${output}/table-${width}-${dark?'dark':'light'}.png`,fullPage:true});
      if(width===1440){await selectPreset(f,'Travail quotidien','daily');await f.page.screenshot({path:`${output}/daily-${width}-${dark?'dark':'light'}.png`,fullPage:true});}
      assert.deepEqual(businessWrites(f),[]);
    });
  } finally {await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
