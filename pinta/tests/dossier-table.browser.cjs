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
  && request.path.startsWith('/rest/v1/') && !['/refresh_staff_work_actions','/get_reception_dates'].some(rpc=>request.path.endsWith(rpc)));
const orderedIds = f => rows(f).evaluateAll(elements => elements.map(node => node.dataset.dossierRow || node.dataset.dossierCard));
const allIds = async f => (await rows(f).evaluateAll(elements => elements.map(node => node.dataset.dossierRow || node.dataset.dossierCard))).sort();
const reply = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
function arrivalDatesFixture(f) {
  const evidence=value=>value?{receivedAt:value,source:'server'}:null;
  const dates=[['2026-09-29T08:00:00Z','2026-10-02T08:00:00Z'],['2026-09-30T07:00:00Z','2026-09-30T08:00:00Z'],[null,null],['2026-09-29T06:00:00Z',null],['2026-09-30T21:30:00Z','2026-09-30T21:45:00Z'],[null,null]];
  f.tables.colis.forEach((parcel,index)=>{parcel.reception_dates=dates[index].map(evidence);parcel.date_reception='2026-09-08T08:00:00Z';});
}

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
  const parcel = (id, ref, changes = {}) => ({...structuredClone(original), id, ref, dims_par_colis:structuredClone(boxes), reception_dates:boxes.map(()=>({receivedAt:'2026-09-08T08:00:00Z',source:'server'})), responsible_staff_id:B, ...changes});
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
  await closeColumnFilter(f);
  const button=f.page.locator('[aria-label="Vues du tableau"]').getByRole('button',{name:label,exact:true});
  await button.click();
  await f.page.waitForURL(url => (url.searchParams.get('table') || 'daily') === value);
  await button.evaluate(node => new Promise(resolve => { const check=()=>node.getAttribute('aria-pressed')==='true'?resolve():requestAnimationFrame(check);check(); }));
}
async function selectScope(f,label,value) {
  await closeColumnFilter(f);
  const button=f.page.locator('[aria-label="Choisir les tâches affichées"]').getByRole('button',{name:label,exact:true});
  await button.click();
  await f.page.waitForURL(url => (url.searchParams.get('tasks') || 'all') === value);
  await button.evaluate(node => new Promise(resolve => { const check=()=>node.getAttribute('aria-pressed')==='true'?resolve():requestAnimationFrame(check);check(); }));
}
async function assertNoBusinessChange(f,before) {
  assert.deepEqual(f.tables.colis,before); assert.equal(f.claims.length,0); assert.deepEqual(businessWrites(f),[]);
}
async function waitIds(f, expected) {
  await f.page.waitForFunction(expected => {
    const current=[...document.querySelectorAll('[data-dossier-row]')].filter(node=>node.getBoundingClientRect().width>0).map(node=>node.dataset.dossierRow).sort();
    return JSON.stringify(current)===JSON.stringify(expected);
  }, [...expected].sort());
  assert.deepEqual(await allIds(f),[...expected].sort());
}
const columnDialog = f => f.page.getByRole('dialog',{name:/^Filtrer /});
async function closeColumnFilter(f) {
  const dialog=columnDialog(f);
  if(await dialog.isVisible().catch(()=>false)){await dialog.press('Escape');await dialog.waitFor({state:'hidden'});}
}
async function openColumnFilter(f,key) {
  await closeColumnFilter(f);
  const header=f.page.locator(`th[data-column="${key}"] .dossier-table-filter`);
  if(await header.isVisible().catch(()=>false))await header.click();
  else {
    await f.page.getByRole('button',{name:/^Filtres par colonne/}).click();
    await columnDialog(f).locator(`[data-column-choice="${key}"]`).click();
  }
  const dialog=columnDialog(f);await dialog.getByRole('combobox',{name:/^Condition pour /}).waitFor();return dialog;
}
async function filterColumn(f,key,mode,value='') {
  let options=await openColumnFilter(f,key);
  const condition=options.getByRole('combobox',{name:/^Condition pour /});
  const label=(await condition.getAttribute('aria-label')).slice('Condition pour '.length);
  await condition.selectOption(mode);
  if(!['empty','filled'].includes(mode))await options.getByLabel(`Filtrer : ${label}`,{exact:true}).fill(value);
  await options.getByRole('button',{name:'Appliquer le filtre',exact:true}).click();
  await f.page.waitForURL(url=>url.searchParams.has(`col.${key}`));
  await options.waitFor({state:'hidden'});
  // Reopening proves the filter was retained after the compact editor closed.
  options=await openColumnFilter(f,key);await options.getByRole('button',{name:'Effacer ce filtre',exact:true}).waitFor();
  return options;
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
    await scenario('last-reception-column-sorts-proven-dates-and-keeps-incomplete-history-explicit',async f=>{
      arrivalDatesFixture(f);const before=structuredClone(f.tables.colis);await open(f);
      for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures']]) {
        await selectPreset(f,label,view);
        assert.match(await cell(f,P,'receivedAt').innerText(),/02\/10\/2026/);
        assert.match(await cell(f,P5,'receivedAt').innerText(),/01\/10\/2026/,'The shared Réunion timezone determines the displayed date.');
        assert.match(await cell(f,P4,'receivedAt').innerText(),/29\/09\/2026.*1\s*\/\s*2 cartons datés/s);
        for(const id of [P3,P6]){assert.equal(await cell(f,id,'receivedAt').locator('time').count(),0);assert.doesNotMatch(await cell(f,id,'receivedAt').innerText(),/08\/09\/2026/);}
        const button=f.page.locator('th[data-column="receivedAt"] .dossier-table-sort');
        if(new URL(f.page.url()).searchParams.get('sort')==='receivedAt')await f.page.locator('th[data-column="ref"] .dossier-table-sort').click();
        await button.click();await f.page.waitForURL(url=>url.searchParams.get('sort')==='receivedAt'&&url.searchParams.get('dir')==='asc');
        await f.page.locator('th[data-column="receivedAt"][aria-sort="ascending"]').waitFor();
        assert.deepEqual((await orderedIds(f)).slice(0,4),[P4,P2,P5,P]);assert.deepEqual((await orderedIds(f)).slice(4).sort(),[P3,P6]);
        await button.click();await f.page.waitForURL(url=>url.searchParams.get('dir')==='desc');
        await f.page.locator('th[data-column="receivedAt"][aria-sort="descending"]').waitFor();
        assert.deepEqual((await orderedIds(f)).slice(0,4),[P,P5,P2,P4]);assert.deepEqual((await orderedIds(f)).slice(4).sort(),[P3,P6]);
      }
      await f.page.getByRole('button',{name:/^Filtres et options/}).click();const downloadPromise=f.page.waitForEvent('download');await f.page.getByRole('button',{name:'Exporter 6 dossiers filtrés',exact:true}).click();
      const file=await downloadPromise,book=XLSX.read(await fs.readFile(await file.path()),{type:'buffer'}),exported=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});const dateColumn=exported[0].indexOf('Dernière réception');
      assert.equal(exported.find(line=>line[0]==='EXP-TAB005')[dateColumn],'01/10/2026');assert.match(exported.find(line=>line[0]==='EXP-TAB004')[dateColumn],/29\/09\/2026.*1\s*\/\s*2 cartons datés/);
      assert.doesNotMatch(exported.find(line=>line[0]==='EXP-TAB003')[dateColumn],/08\/09\/2026/);
      await assertNoBusinessChange(f,before);
    });
    await scenario('last-reception-filter-matches-the-displayed-last-date-not-an-earlier-carton',async f=>{
      arrivalDatesFixture(f);const before=structuredClone(f.tables.colis);await open(f);
      let options=await filterColumn(f,'receivedAt','max','2026-09-29');await waitIds(f,[P4]);
      assert.equal(await row(f,P).count(),0,'An expedition whose first carton arrived on29/09 but last on02/10 is not labelled a last reception before30/09.');
      options=await filterColumn(f,'receivedAt','min','2026-10-01');await waitIds(f,[P,P5]);
      options=await filterColumn(f,'receivedAt','contains','30/09/2026');await waitIds(f,[P2]);
      options=await filterColumn(f,'receivedAt','empty');await waitIds(f,[P3,P6]);
      await options.getByRole('button',{name:'Effacer ce filtre',exact:true}).click();await options.waitFor({state:'hidden'});await waitIds(f,[P,P2,P3,P4,P5,P6]);
      await assertNoBusinessChange(f,before);
    });
    for(const width of [1440,390])for(const dark of [false,true])await scenario(`compact-column-dialog-keyboard-focus-and-layout-${width}-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width,height:width===390?844:1000});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      const before=structuredClone(f.tables.colis);await open(f);
      const trigger=width===1440?f.page.getByRole('button',{name:'Filtrer la colonne Client',exact:true}):f.page.getByRole('button',{name:/^Filtres par colonne/});
      const openDialog=async()=>{await trigger.click();if(width===390)await columnDialog(f).locator('[data-column-choice="client"]').click();const dialog=columnDialog(f);await dialog.getByLabel('Filtrer : Client',{exact:true}).waitFor();return dialog;};
      let dialog=await openDialog();const bounds=await dialog.boundingBox(),anchor=await trigger.boundingBox();
      assert.ok(bounds.width<=342&&bounds.x>=10&&bounds.x+bounds.width<=width-10,'The compact dialog stays inside the viewport.');
      if(width===1440){assert.ok(Math.abs(bounds.x-anchor.x)<=2&&bounds.y>=anchor.y+anchor.height,'Desktop filtering opens beside the selected column.');const action=await cell(f,P,'action').boundingBox();assert.ok(bounds.x+bounds.width<action.x,'The compact dialog does not cover the action column.');}
      await dialog.getByLabel('Filtrer : Client',{exact:true}).fill('discard-this-filter');await dialog.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.equal(await trigger.evaluate(node=>document.activeElement===node),true);assert.equal(new URL(f.page.url()).searchParams.has('col.client'),false);
      dialog=await openDialog();await f.page.mouse.click(4,4);await dialog.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(node=>document.activeElement===node),true);
      dialog=await openDialog();await dialog.getByLabel('Filtrer : Client',{exact:true}).fill('Camille');
      const apply=dialog.getByRole('button',{name:'Appliquer le filtre',exact:true});await apply.focus();await apply.press('Enter');await dialog.waitFor({state:'hidden'});await f.page.waitForURL(url=>url.searchParams.has('col.client'));
      assert.equal(await trigger.evaluate(node=>document.activeElement===node),true);await waitIds(f,[P,P2,P3,P4,P5,P6]);
      dialog=await openDialog();const axe=await new AxeBuilder({page:f.page}).include('[data-testid="column-filter-dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
      await f.page.screenshot({path:`${output}/compact-filter-${width}-${dark?'dark':'light'}.png`,fullPage:true});
      await dialog.getByRole('button',{name:'Effacer ce filtre',exact:true}).click();await dialog.waitFor({state:'hidden'});await f.page.waitForURL(url=>!url.searchParams.has('col.client'));
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await assertNoBusinessChange(f,before);
    });
    await scenario('personal-column-visibility-clears-hidden-filter-and-sort-and-preserves-widths',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);
      const resize=f.page.getByRole('separator',{name:'Redimensionner Référence',exact:true});await resize.focus();await resize.press('Shift+ArrowRight');
      const options=await filterColumn(f,'casier','contains','A-03');await options.press('Escape');await options.waitFor({state:'hidden'});
      await f.page.locator('th[data-column="casier"] .dossier-table-sort').click();await f.page.waitForURL(url=>url.searchParams.get('sort')==='casier');
      await f.page.getByRole('button',{name:'Colonnes',exact:true}).click();let dialog=f.page.getByRole('dialog',{name:'Colonnes affichées',exact:true});
      const reference=dialog.getByRole('checkbox',{name:'Afficher Référence',exact:true});assert.equal(await reference.isChecked(),true);assert.equal(await reference.isDisabled(),true);
      await dialog.getByRole('checkbox',{name:'Afficher Casier',exact:true}).uncheck();await dialog.getByRole('checkbox',{name:'Afficher Dernière réception',exact:true}).uncheck();await dialog.getByRole('button',{name:'Terminer',exact:true}).click();
      await f.page.waitForURL(url=>!url.searchParams.has('col.casier')&&!url.searchParams.has('sort'));assert.equal(await f.page.locator('th[data-column="casier"]').count(),0);assert.equal(await f.page.locator('th[data-column="receivedAt"]').count(),0);
      await f.page.reload();await row(f,P).waitFor();assert.equal(await f.page.locator('th[data-column="casier"]').count(),0);assert.equal(Number(await resize.getAttribute('aria-valuenow')),210);
      await f.page.getByRole('button',{name:/^Filtres et options/}).click();const downloaded=f.page.waitForEvent('download');await f.page.getByRole('button',{name:'Exporter 6 dossiers filtrés',exact:true}).click();const file=await downloaded;const book=XLSX.read(await fs.readFile(await file.path()),{type:'buffer'});const records=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
      assert.equal(records[0].includes('Casier'),false);assert.equal(records[0].includes('Dernière réception'),false);assert.equal(records[0][0],'Référence');
      await f.page.getByRole('button',{name:'Fermer les filtres',exact:true}).click();await selectPreset(f,'Paiements','payments');assert.equal(await f.page.locator('th[data-column="receivedAt"]').count(),1);
      await selectPreset(f,'Travail quotidien','daily');assert.equal(await f.page.locator('th[data-column="receivedAt"]').count(),0);
      await f.page.getByRole('button',{name:'Colonnes',exact:true}).click();dialog=f.page.getByRole('dialog',{name:'Colonnes affichées',exact:true});await dialog.getByRole('button',{name:'Rétablir les colonnes',exact:true}).click();await dialog.getByRole('button',{name:'Terminer',exact:true}).click();
      await f.page.locator('th[data-column="casier"]').waitFor();assert.equal(Number(await resize.getAttribute('aria-valuenow')),210,'Restoring visible columns does not erase personal widths.');await assertNoBusinessChange(f,before);
    });
    await scenario('mobile-column-choices-keep-reference-and-filter-only-visible-data',async f=>{
      await f.page.setViewportSize({width:390,height:844});const before=structuredClone(f.tables.colis);await open(f);
      await f.page.getByRole('button',{name:'Colonnes',exact:true}).click();const dialog=f.page.getByRole('dialog',{name:'Colonnes affichées',exact:true});
      for(const label of ['Client','Paiement','Action'])await dialog.getByRole('checkbox',{name:`Afficher ${label}`,exact:true}).uncheck();await dialog.getByRole('button',{name:'Terminer',exact:true}).click();
      assert.equal(await row(f,P2).locator('[data-column="client"]').count(),0);assert.equal(await row(f,P2).getByRole('button',{name:'Continuer',exact:true}).count(),0);await row(f,P2).getByRole('button',{name:'EXP-TAB002',exact:true}).waitFor();
      await f.page.getByRole('button',{name:/^Filtres par colonne/}).click();assert.equal(await columnDialog(f).locator('[data-column-choice="paymentState"]').count(),0);assert.equal(await columnDialog(f).locator('[data-column-choice="client"]').count(),0);await columnDialog(f).press('Escape');
      await f.page.reload();await row(f,P2).waitFor();assert.equal(await row(f,P2).locator('[data-column="client"]').count(),0);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await assertNoBusinessChange(f,before);
    });
    await scenario('new-payment-status-and-optimized-dimensions-never-invent-ready-or-paid-data',async f=>{
      const prepared=f.tables.colis.find(item=>item.id===P5);
      prepared.final_packages=[{dimL:31,dimW:22,dimH:13,poids:2},{dimL:19.5,dimW:17,dimH:11,poids:1}];prepared.outgoing_parcel_count=2;
      const before=structuredClone(f.tables.colis);await open(f);
      for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures']]) {
        await selectPreset(f,label,view);
        assert.equal((await cell(f,P4,'paymentState').innerText()).trim(),'Paiement partiel');
        assert.equal((await cell(f,P4,'statusLabel').innerText()).trim(),'Paiement partiel','A stale paye status cannot disguise an incomplete payment.');
        assert.equal((await cell(f,P5,'paymentState').innerText()).trim(),'Payé');
        assert.equal((await cell(f,P5,'statusLabel').innerText()).trim(),'Payé');
        if(view!=='payments') {
          for(const id of [P,P2,P6])assert.equal((await cell(f,id,'optimizedDimensions').innerText()).trim(),'','Absent or stale preparation leaves a truly empty cell.');
          const dimensions=await cell(f,P5,'optimizedDimensions').innerText();
          assert.match(dimensions,/Colis 1 : 31 × 22 × 13 cm/);assert.match(dimensions,/Colis 2 : 19,5 × 17 × 11 cm/);
          assert.doesNotMatch(dimensions,/40 × 30 × 20/,'Reception dimensions are never substituted.');
        }
      }
      await assertNoBusinessChange(f,before);
    });
    await scenario('every-data-column-has-a-usable-filter-from-its-heading',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);
      for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures']]) {
        await selectPreset(f,label,view);
        const table=f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true});
        const columns=await table.locator('thead th[data-column] .dossier-table-sort').evaluateAll(buttons=>buttons.map(button=>({key:button.closest('th').dataset.column,label:button.textContent.trim()})));
        assert.ok(columns.length>=8);
        for(const column of columns) {
          const heading=table.locator(`th[data-column="${column.key}"]`);
          await heading.getByRole('button',{name:`Filtrer la colonne ${column.label}`,exact:true}).click();
          const options=columnDialog(f);
          assert.equal(await f.page.getByRole('dialog',{name:`Filtrer ${column.label}`,exact:true}).isVisible(),true);
          // Every current and future data column must expose a real filter; P5 has a value in every view.
          await filterColumn(f,column.key,'filled');await row(f,P5).waitFor();
          assert.equal(await heading.getByRole('button',{name:`Filtrer la colonne ${column.label}`,exact:true}).getAttribute('aria-pressed'),'true');
          assert.ok(await rows(f).count()>0);assert.equal(await row(f,P5).count(),1);
          await options.getByRole('button',{name:'Effacer ce filtre',exact:true}).click();
          await f.page.waitForURL(url=>!url.searchParams.has(`col.${column.key}`));await waitIds(f,[P,P2,P3,P4,P5,P6]);
          await options.waitFor({state:'hidden'});
        }
      }
      await assertNoBusinessChange(f,before);
    });
    await scenario('column-filters-match-real-task-owner-payments-and-only-current-measurements',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);
      let options=await filterColumn(f,'owner','contains','Vous');await waitIds(f,[P2]);
      await options.getByRole('button',{name:'Effacer ce filtre',exact:true}).click();await waitIds(f,[P,P2,P3,P4,P5,P6]);
      options=await filterColumn(f,'optimizedDimensions','empty');await waitIds(f,[P,P2,P6]);
      await options.getByRole('button',{name:'Effacer ce filtre',exact:true}).click();await waitIds(f,[P,P2,P3,P4,P5,P6]);
      await selectPreset(f,'Paiements','payments');await filterColumn(f,'remaining','min','1');await waitIds(f,[P4]);
      assert.equal((await cell(f,P4,'paymentState').innerText()).trim(),'Paiement partiel');
      options=await filterColumn(f,'requested','min','90');await waitIds(f,[P4]);
      assert.equal(new URL(f.page.url()).searchParams.get('col.remaining'),JSON.stringify({mode:'min',value:'1'}));
      await f.page.reload();await row(f,P4).waitFor();await waitIds(f,[P4]);
      await f.page.getByRole('button',{name:/^Filtres et options/}).click();
      const downloadPromise=f.page.waitForEvent('download');await f.page.getByRole('button',{name:'Exporter 1 dossiers filtrés',exact:true}).click();
      const download=await downloadPromise;const book=XLSX.read(await fs.readFile(await download.path()),{type:'buffer'});
      const data=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
      assert.equal(data.length,2);assert.equal(data[1][0],'EXP-TAB004');assert.equal(data[1][data[0].indexOf('Paiement')],'Paiement partiel');
      await f.page.getByRole('button',{name:'Fermer les filtres',exact:true}).click();
      await f.page.getByRole('button',{name:'Retirer les filtres',exact:true}).click();await waitIds(f,[P,P2,P3,P4,P5,P6]);
      assert.equal([...new URL(f.page.url()).searchParams.keys()].some(key=>key.startsWith('col.')),false);
      await assertNoBusinessChange(f,before);
    });
    await scenario('date-and-numeric-filter-boundaries-are-inclusive-and-combine-with-task-scope',async f=>{
      Object.assign(f.tables.colis.find(item=>item.id===P5),{devis_envoye_le:'2026-09-10T08:00:00Z'});
      Object.assign(f.tables.colis.find(item=>item.id===P6),{devis_envoye_le:'2026-09-20T08:00:00Z'});
      const before=structuredClone(f.tables.colis);await open(f);await selectPreset(f,'Paiements','payments');
      let options=await filterColumn(f,'sentAt','min','2026-09-20');await waitIds(f,[P4,P6]);
      options=await filterColumn(f,'paid','max','30');await waitIds(f,[P4]);
      await options.getByRole('button',{name:'Effacer ce filtre',exact:true}).click();await waitIds(f,[P4,P6]);
      options=await filterColumn(f,'sentAt','max','2026-09-20');await waitIds(f,[P5,P6]);
      await selectScope(f,'Mes tâches','mine');await waitIds(f,[]);
      await f.page.getByText('Aucune tâche ne vous est attribuée dans cette sélection.',{exact:true}).waitFor();
      await assertNoBusinessChange(f,before);
    });
    await scenario('hidden-foreign-or-invalid-column-filters-cannot-hide-permitted-dossiers',async f=>{
      const before=structuredClone(f.tables.colis);
      const query=new URLSearchParams({'col.remaining':JSON.stringify({mode:'min',value:'999'}),'col.secret':'{"mode":"contains","value":"hidden"}','col.ref':'broken'});
      await open(f,query.toString());await waitIds(f,[P,P2,P3,P4,P5,P6]);
      await f.page.waitForURL(url=>![...url.searchParams.keys()].some(key=>key.startsWith('col.')));
      await selectPreset(f,'Paiements','payments');await filterColumn(f,'requested','min','50');await waitIds(f,[P4,P5,P6]);
      await selectPreset(f,'Travail quotidien','daily');await waitIds(f,[P,P2,P3,P4,P5,P6]);
      await f.page.waitForURL(url=>!url.searchParams.has('col.requested'));
      await assertNoBusinessChange(f,before);
    });
    await scenario('forced-finance-column-filter-does-not-grant-finance-access',async f=>{
      const before=structuredClone(f.tables.colis);
      await open(f,new URLSearchParams({table:'payments','col.paid':JSON.stringify({mode:'min',value:'50'})}).toString());
      await waitIds(f,[P,P2,P3,P4,P5,P6]);await f.page.waitForURL(url=>!url.searchParams.has('col.paid'));
      await f.page.getByRole('button',{name:/^Filtres par colonne/}).click();
      const values=await columnDialog(f).locator('[data-column-choice]').evaluateAll(buttons=>buttons.map(button=>button.dataset.columnChoice));
      assert.equal(values.includes('paid'),false);assert.equal(values.includes('requested'),false);assert.equal(await f.page.locator('th[data-column="paid"]').count(),0);
      await assertNoBusinessChange(f,before);
    },{restricted:true});
    await scenario('column-widths-resize-by-mouse-and-keyboard-and-keep-sticky-identities-aligned',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);
      const separator=f.page.getByRole('separator',{name:'Redimensionner Référence',exact:true});
      const initial=Number(await separator.getAttribute('aria-valuenow'));
      await separator.focus();await separator.press('ArrowRight');await separator.press('Shift+ArrowRight');
      await f.page.waitForFunction(()=>document.querySelector('[aria-label="Redimensionner Référence"]').getAttribute('aria-valuenow')==='220');
      assert.equal(Number(await separator.getAttribute('aria-valuenow')),initial+60);
      const bbox=await separator.boundingBox();await f.page.mouse.move(bbox.x+bbox.width/2,bbox.y+bbox.height/2);await f.page.mouse.down();await f.page.mouse.move(bbox.x+bbox.width/2+35,bbox.y+bbox.height/2,{steps:5});await f.page.mouse.up();
      const resized=Number(await separator.getAttribute('aria-valuenow'));assert.ok(Math.abs(resized-(initial+95))<=1);
      const ref=cell(f,P,'ref'),client=cell(f,P,'client');const beforeScroll=[await ref.boundingBox(),await client.boundingBox()];
      assert.ok(Math.abs(beforeScroll[0].width-resized)<=2);assert.ok(Math.abs(beforeScroll[1].x-beforeScroll[0].x-beforeScroll[0].width)<=2,'Client begins precisely after the resized reference.');
      const scroller=f.page.getByRole('region',{name:'Tableau des dossiers',exact:true});await scroller.evaluate(node=>{node.scrollLeft=500;});
      await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      for(const [i,target] of [ref,client].entries())assert.ok(Math.abs((await target.boundingBox()).x-beforeScroll[i].x)<=2);
      await f.page.reload();await row(f,P).waitFor();assert.equal(Number(await separator.getAttribute('aria-valuenow')),resized);
      await selectPreset(f,'Paiements','payments');assert.equal(Number(await separator.getAttribute('aria-valuenow')),initial,'Widths are separate for each view.');
      await selectPreset(f,'Travail quotidien','daily');assert.equal(Number(await separator.getAttribute('aria-valuenow')),resized);
      await separator.focus();await separator.press('End');assert.equal(Number(await separator.getAttribute('aria-valuenow')),600);
      assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).getAttribute('data-unpin-ref'),'true','An oversized reference stops pinning over the whole usable table.');
      await separator.press('Enter');assert.equal(Number(await separator.getAttribute('aria-valuenow')),initial);
      const actionResize=f.page.getByRole('separator',{name:'Redimensionner Action',exact:true});
      await actionResize.focus();await actionResize.press('End');assert.equal(Number(await actionResize.getAttribute('aria-valuenow')),280,'The action column has a useful upper bound instead of hiding the central data.');
      const clientResize=f.page.getByRole('separator',{name:'Redimensionner Client',exact:true});await clientResize.focus();await clientResize.press('End');
      assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).getAttribute('data-unpin-client'),'true');
      await clientResize.press('Enter');await actionResize.focus();await actionResize.press('Enter');
      // A wide reference must release Client even when the two widths total less than 600px.
      await separator.focus();await separator.press('Home');for(let step=0;step<5;step++)await separator.press('Shift+ArrowRight');await separator.press('ArrowRight');
      await clientResize.focus();await clientResize.press('Home');
      assert.equal(Number(await separator.getAttribute('aria-valuenow')),400);assert.equal(Number(await clientResize.getAttribute('aria-valuenow')),140);
      const table=f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true});
      assert.equal(await table.getAttribute('data-unpin-ref'),'true');assert.equal(await table.getAttribute('data-unpin-client'),'true');
      await scroller.evaluate(node=>{node.scrollLeft=0;});await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const action=cell(f,P,'action'),wideBefore=[await ref.boundingBox(),await client.boundingBox(),await action.boundingBox()];
      await scroller.evaluate(node=>{node.scrollLeft=300;});await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const wideAfter=[await ref.boundingBox(),await client.boundingBox(),await action.boundingBox()];
      for(let i=0;i<2;i++)assert.ok(Math.abs(wideBefore[i].x-wideAfter[i].x-300)<=2,'Both oversized identity columns scroll together instead of leaving Client floating.');
      assert.ok(Math.abs(wideBefore[2].x-wideAfter[2].x)<=2&&wideAfter[2].x>=220&&wideAfter[2].x+wideAfter[2].width<=1440,'The action stays pinned and visible after releasing the identity columns.');
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await assertNoBusinessChange(f,before);
    });
    await scenario('column-width-preferences-remain-private-after-switching-account-in-the-same-browser',async f=>{
      await open(f);const separator=f.page.getByRole('separator',{name:'Redimensionner Référence',exact:true});
      await separator.focus();await separator.press('Shift+ArrowRight');await f.page.waitForFunction(()=>document.querySelector('[aria-label="Redimensionner Référence"]').getAttribute('aria-valuenow')==='210');
      const savedA=await f.page.evaluate(id=>localStorage.getItem(`expedile:table-widths:v1:${encodeURIComponent(id)}:daily`),ids.A);assert.equal(JSON.parse(savedA).ref,210);
      await f.page.getByRole('button',{name:'Colonnes',exact:true}).click();let visibility=f.page.getByRole('dialog',{name:'Colonnes affichées',exact:true});await visibility.getByRole('checkbox',{name:'Afficher Client',exact:true}).uncheck();await visibility.getByRole('button',{name:'Terminer',exact:true}).click();
      const hiddenA=await f.page.evaluate(id=>localStorage.getItem(`expedile:table-columns:v1:${encodeURIComponent(id)}:daily`),ids.A);assert.ok(JSON.parse(hiddenA).includes('client'));
      await f.page.getByRole('button',{name:'Se déconnecter',exact:true}).filter({visible:true}).click();await f.page.getByLabel('Email',{exact:true}).waitFor();
      f.tables.profiles.push({id:B,nom:'Madly',role:'directeur',actif:true});
      const user={id:B,aud:'authenticated',role:'authenticated',email:'madly@example.test',user_metadata:{},created_at:new Date().toISOString()};
      const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:B,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
      await f.context.route('**/auth/v1/token**',route=>reply(route,{access_token:token,refresh_token:'test-b',token_type:'bearer',expires_in:3600,user}));
      await f.context.route('**/auth/v1/user',route=>reply(route,user));
      await f.login();await open(f);assert.equal(Number(await separator.getAttribute('aria-valuenow')),160,'The new account does not inherit the previous user’s width.');
      assert.equal(await f.page.locator('th[data-column="client"]').count(),1,'The new account does not inherit hidden columns.');
      await f.page.getByRole('button',{name:'Colonnes',exact:true}).click();visibility=f.page.getByRole('dialog',{name:'Colonnes affichées',exact:true});await visibility.getByRole('checkbox',{name:'Afficher Casier',exact:true}).uncheck();await visibility.getByRole('button',{name:'Terminer',exact:true}).click();
      await separator.focus();await separator.press('ArrowRight');await f.page.waitForFunction(()=>document.querySelector('[aria-label="Redimensionner Référence"]').getAttribute('aria-valuenow')==='170');
      const values=await f.page.evaluate(({a,b})=>({a:localStorage.getItem(`expedile:table-widths:v1:${encodeURIComponent(a)}:daily`),b:localStorage.getItem(`expedile:table-widths:v1:${encodeURIComponent(b)}:daily`)}),{a:ids.A,b:B});
      assert.equal(values.a,savedA);assert.equal(JSON.parse(values.b).ref,170);assert.equal(f.claims.length,0);assert.deepEqual(businessWrites(f),[]);
      const hidden=await f.page.evaluate(({a,b})=>({a:localStorage.getItem(`expedile:table-columns:v1:${encodeURIComponent(a)}:daily`),b:localStorage.getItem(`expedile:table-columns:v1:${encodeURIComponent(b)}:daily`)}),{a:ids.A,b:B});assert.equal(hidden.a,hiddenA);assert.ok(JSON.parse(hidden.b).includes('casier'));assert.equal(JSON.parse(hidden.b).includes('client'),false);
    });
    for(const dark of [false,true])await scenario(`mobile-column-filter-reset-and-width-editor-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width:390,height:844});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      const before=structuredClone(f.tables.colis);await open(f);
      const options=await filterColumn(f,'paymentState','contains','partiel');await waitIds(f,[P4]);
      assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).count(),0);
      await options.getByText('Largeur des colonnes sur ordinateur',{exact:true}).click();
      const width=options.getByLabel('Largeur de Paiement',{exact:true});await width.fill('300');await width.press('Enter');
      assert.equal(await width.inputValue(),'300');await options.getByRole('button',{name:'Rétablir les largeurs',exact:true}).click();
      await f.page.waitForFunction(()=>document.querySelector('[aria-label="Largeur de Paiement"]')?.value==='155');assert.equal(await width.inputValue(),'155');
      await options.getByRole('button',{name:'Fermer',exact:true}).click();await row(f,P4).waitFor();
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await f.page.screenshot({path:`${output}/mobile-column-filter-${dark?'dark':'light'}.png`,fullPage:true});
      await f.page.getByRole('button',{name:'Retirer les filtres',exact:true}).click();await waitIds(f,[P,P2,P3,P4,P5,P6]);
      await assertNoBusinessChange(f,before);
    });
    await scenario('sorting-every-displayed-data-column-is-keyboard-accessible-and-read-only',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);
      for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures']]) {
        await selectPreset(f,label,view);
        const table=f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true});
        // Discover displayed data columns so a future column cannot escape this contract.
        const keys=await table.locator('thead th[data-column]').evaluateAll(headers=>headers.map(h=>h.dataset.column).filter(key=>!['action','select'].includes(key)));
        assert.ok(keys.length>=6);
        for(const key of keys) {
          const header=table.locator(`th[data-column="${key}"]`),button=header.locator('.dossier-table-sort');
          assert.equal(await button.count(),1,`${view}/${key} has a native sort button`);
          for(const direction of ['asc','desc']) {
            // Reset to a different key first: the next activation must mean ascending.
            if(direction==='asc'&&new URL(f.page.url()).searchParams.get('sort')===key) {
              const other=keys.find(value=>value!==key);await table.locator(`th[data-column="${other}"]`).locator('.dossier-table-sort').click();
            }
            await button.focus();await button.press(direction==='asc'?'Enter':'Space');
            await f.page.waitForURL(url=>url.searchParams.get('sort')===key&&url.searchParams.get('dir')===direction);
            await header.evaluate((node,value)=>new Promise(resolve=>{const check=()=>node.getAttribute('aria-sort')===value?resolve():requestAnimationFrame(check);check();}),direction==='asc'?'ascending':'descending');
            assert.equal(await table.locator('th[aria-sort="ascending"],th[aria-sort="descending"]').count(),1);
            assert.deepEqual(await allIds(f),[P,P2,P3,P4,P5,P6].sort());
          }
        }
        assert.equal(await table.locator('th[data-column="action"]').getByRole('button').count(),0);
        assert.equal(await table.locator('th[data-column="select"]').getAttribute('aria-sort'),null);
      }
      await assertNoBusinessChange(f,before);
    });
    await scenario('sorting-real-numbers-natural-shelf-names-and-dates-keeps-unknowns-last',async f=>{
      const parcels=f.tables.colis;
      parcels.forEach((parcel,index)=>{parcel.casier=['A-2','A-10','A-1',null,'',null][index];});
      Object.assign(parcels[4],{devis_total:9,paiement_montant:9,devis_envoye_le:'2026-09-10T08:00:00Z'});
      Object.assign(parcels[5],{devis_total:80,paiement_montant:80,devis_envoye_le:'2026-09-20T08:00:00Z'});
      const before=structuredClone(parcels);await open(f);
      const sort=async(key,direction)=>{
        if(await f.page.getByRole('combobox',{name:'Tri par défaut',exact:true}).count()===0)await f.page.getByRole('button',{name:/^Filtres et options/}).click();
        await f.page.getByRole('combobox',{name:'Tri par défaut',exact:true}).selectOption(`column:${key}:${direction}`);
        await f.page.waitForURL(url=>url.searchParams.get('sort')===key&&url.searchParams.get('dir')===direction);
      };
      for(const [direction,expected] of [['asc',[P3,P,P2]],['desc',[P2,P,P3]]]) {
        await sort('casier',direction);assert.deepEqual((await orderedIds(f)).slice(0,3),expected);
        assert.deepEqual((await orderedIds(f)).slice(3).sort(),[P4,P5,P6].sort());
      }
      await selectPreset(f,'Paiements','payments');
      for(const key of ['requested','sentAt'])for(const [direction,expected] of [['asc',[P5,P6,P4]],['desc',[P4,P6,P5]]]) {
        await sort(key,direction);assert.deepEqual((await orderedIds(f)).slice(0,3),expected,`${key} sorts real numbers/dates, not their formatted labels`);
        assert.deepEqual((await orderedIds(f)).slice(3).sort(),[P,P2,P3].sort(),`${key}: unknowns stay last even descending`);
      }
      await sort('requested','desc');await f.page.reload();await row(f,P4).waitFor();assert.deepEqual((await orderedIds(f)).slice(0,3),[P4,P6,P5]);
      await selectPreset(f,'Départs','departures');assert.equal(new URL(f.page.url()).searchParams.get('sort'),'requested');
      assert.equal(await f.page.locator('thead th[aria-sort="descending"]').count(),0,'An unrelated view does not pretend to sort an invisible amount.');
      await selectPreset(f,'Paiements','payments');assert.deepEqual((await orderedIds(f)).slice(0,3),[P4,P6,P5]);
      if(await f.page.getByRole('button',{name:'Fermer les filtres',exact:true}).count())await f.page.getByRole('button',{name:'Fermer les filtres',exact:true}).click();await f.page.screenshot({path:`${output}/payments-sorted-descending.png`,fullPage:true});
      await assertNoBusinessChange(f,before);
    });
    await scenario('mobile-sort-menu-offers-all-data-columns-in-every-view-and-both-directions',async f=>{
      await f.page.setViewportSize({width:390,height:844});const before=structuredClone(f.tables.colis);await open(f);
      for(const [label,view,keys] of [
        ['Travail quotidien','daily',['ref','client','receivedAt','statusLabel','paymentState','statut','owner','casier','cartons','optimizedDimensions']],
        ['Paiements','payments',['ref','client','receivedAt','statusLabel','paymentState','requested','paid','remaining','sentAt']],
        ['Départs','departures',['ref','client','receivedAt','statusLabel','paymentState','departure','destination','packages','readiness','optimizedDimensions']],
      ]) {
        await selectPreset(f,label,view);
        if(await f.page.getByRole('combobox',{name:'Tri par défaut',exact:true}).count()===0)await f.page.getByRole('button',{name:/^Filtres et options/}).click();
        const menu=f.page.getByRole('combobox',{name:'Tri par défaut',exact:true});
        const available=await menu.locator('option').evaluateAll(options=>options.map(option=>option.value).filter(value=>value.startsWith('column:')));
        for(const key of keys)for(const direction of ['asc','desc']) {
          assert.ok(available.includes(`column:${key}:${direction}`));await menu.selectOption(`column:${key}:${direction}`);
          await f.page.waitForURL(url=>url.searchParams.get('sort')===key&&url.searchParams.get('dir')===direction);
        }
        await menu.selectOption('column:ref:desc');await f.page.waitForURL(url=>url.searchParams.get('sort')==='ref'&&url.searchParams.get('dir')==='desc');
        assert.deepEqual(await orderedIds(f),[P6,P5,P4,P3,P2,P],'Mobile cards follow the chosen descending order.');
        assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).count(),0);
        assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
        await f.page.getByRole('button',{name:'Fermer les filtres',exact:true}).click();
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
      const expected={daily:['Référence','Client','Dernière réception','Statut du dossier','Paiement','Travail à faire','Qui s’en occupe','Casier','Cartons reçus','Dimensions optimisées'],payments:['Référence','Client','Dernière réception','Statut du dossier','Paiement','Demandé','Payé','Reste à payer','Devis envoyé le'],departures:['Référence','Client','Dernière réception','Statut du dossier','Paiement','Départ prévu','Destination','Colis à expédier','Prêt à partir ?','Dimensions optimisées']};
      for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures']]) {
        await selectPreset(f,label,view);
        const downloaded=f.page.waitForEvent('download');await f.page.getByRole('button',{name:'Exporter 6 dossiers filtrés',exact:true}).click();
        const download=await downloaded;assert.equal(await download.failure(),null);
        const visibleReferences=await rows(f).locator('[data-column="ref"] .dossier-table-reference').allTextContents();
        const workbook=XLSX.read(await fs.readFile(await download.path()),{type:'buffer'});
        const data=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1});
        assert.deepEqual(data[0],expected[view]);assert.deepEqual(data.slice(1).map(line=>line[0]),visibleReferences,'Excel follows the visible row order.');assert.equal(data.length,7);assert.equal(new Set(data.slice(1).map(line=>line[0])).size,6);
        if(view==='payments') {
          const unknown=data.find(line=>line[0]==='EXP-TAB001'),partial=data.find(line=>line[0]==='EXP-TAB004');
          assert.equal(unknown[data[0].indexOf('Demandé')],'À calculer');assert.deepEqual(['Demandé','Payé','Reste à payer'].map(label=>partial[data[0].indexOf(label)]),[100,30,70]);
        }
        if(view==='daily')assert.equal(data.find(line=>line[0]==='EXP-TAB002')[data[0].indexOf('Qui s’en occupe')],'Vous');
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
      await open(f,'sort=ref&dir=desc');await selectScope(f,'Mes tâches','mine');await selectPreset(f,'Paiements','payments');
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
        const separators=await row(f,P2).locator('td[data-column]').evaluateAll(cells=>cells.map(node=>{const style=getComputedStyle(node);return {column:node.dataset.column,width:parseFloat(style.borderRightWidth),color:style.borderRightColor,background:style.backgroundColor};}));
        assert.ok(separators.length>=10);assert.ok(separators.every(line=>line.width>=1&&line.color!=='rgba(0, 0, 0, 0)'&&line.color!==line.background),'Every desktop cell retains a visible vertical separator in both themes.');
        const primary=row(f,P2).getByRole('button',{name:'Continuer',exact:true});
        const initialAction=await primary.boundingBox();assert.ok(initialAction.x>=220&&initialAction.x+initialAction.width<=width,'The primary action is visible at the initial horizontal position.');
        await selectPreset(f,'Paiements','payments');
        // A narrower desktop still uses the table and genuinely needs horizontal scrolling.
        await f.page.setViewportSize({width:1280,height:1000});
        const ref=cell(f,P,'ref'),client=cell(f,P,'client');await ref.waitFor();await client.waitFor();
        const action=cell(f,P,'action');const before=[await ref.boundingBox(),await client.boundingBox(),await action.boundingBox()];
        const scroll=await ref.evaluate(node=>{let el=node.parentElement;while(el&&!(el.scrollWidth>el.clientWidth+5&&/(auto|scroll)/.test(getComputedStyle(el).overflowX)))el=el.parentElement;if(!el)return null;el.scrollLeft=el.scrollWidth;return {left:el.scrollLeft,max:el.scrollWidth-el.clientWidth};});
        assert.ok(scroll&&scroll.left>20,'The payment table actually scrolls horizontally.');
        await ref.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        const after=[await ref.boundingBox(),await client.boundingBox(),await action.boundingBox()];
        for(let i=0;i<3;i++)assert.ok(Math.abs(after[i].x-before[i].x)<=2,`Sticky ${['EXP','Client','Action'][i]} remains fixed while the other columns scroll.`);
        assert.ok(after[2].x+after[2].width<=1280&&after[2].x>=after[1].x+after[1].width,'Pinned action stays visible without covering the fixed client identity.');
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
