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
// Computed WCAG contrast in the page: colours composited over every ancestor background, opacity included.
function installContrast() {
  const rgba=value=>{const n=value.match(/[\d.]+/g)?.map(Number)||[];return n.length>=3?[...n.slice(0,3),n[3]??1]:[0,0,0,0];};
  const over=(fg,bg)=>[...fg.slice(0,3).map((channel,i)=>channel*fg[3]+bg[i]*(1-fg[3])),1];
  const background=element=>{const chain=[];for(let n=element;n&&n.nodeType===1;n=n.parentElement)chain.push(rgba(getComputedStyle(n).backgroundColor));return chain.reverse().reduce((bg,color)=>over(color,bg),[255,255,255,1]);};
  const luminance=rgb=>rgb.slice(0,3).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const opacity=element=>{let value=1;for(let n=element;n&&n.nodeType===1;n=n.parentElement)value*=parseFloat(getComputedStyle(n).opacity);return value;};
  const ink=(element,color)=>{const bg=background(element),fg=rgba(color);return contrast(over([...fg.slice(0,3),fg[3]*opacity(element)],bg),bg);};
  window.__pintaContrast={rgba,background,contrast,ink,text:element=>ink(element,getComputedStyle(element).color)};
}
// Two frames, then every hover/selection transition finished: colours are sampled at rest.
const settle = async f => {await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await f.page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));};
const noPageOverflow = async f => assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
function arrivalDatesFixture(f) {
  const evidence=value=>value?{receivedAt:value,source:'server'}:null;
  const dates=[['2026-09-29T08:00:00Z','2026-10-02T08:00:00Z'],['2026-09-30T07:00:00Z','2026-09-30T08:00:00Z'],[null,null],['2026-09-29T06:00:00Z',null],['2026-09-30T21:30:00Z','2026-09-30T21:45:00Z'],[null,null]];
  f.tables.colis.forEach((parcel,index)=>{parcel.reception_dates=dates[index].map(evidence);parcel.date_reception='2026-09-08T08:00:00Z';});
}

async function fixture(browser, options = {}) {
  const f = await setup(browser, options.restricted ? 'preparateur' : 'directeur');
  f.page.setDefaultTimeout(10000);await f.context.addInitScript(installContrast);
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
// Toolbar: « Filtres » toggles the inline panel; « Affichage » opens a modal
// dialog holding columns, layout, text size, grouping, sort and export.
const filtersButton = f => f.page.getByRole('button',{name:/^Filtres(?: · \d+)?$/});
const displayButton = f => f.page.getByRole('button',{name:'Affichage',exact:true});
const displayDialog = f => f.page.getByRole('dialog',{name:'Affichage',exact:true});
async function openDisplay(f) {
  await closeColumnFilter(f);const dialog=displayDialog(f);
  if(!await dialog.isVisible().catch(()=>false))await displayButton(f).click();
  await dialog.waitFor();return dialog;
}
async function closeDisplay(f) {
  const dialog=displayDialog(f);
  if(await dialog.isVisible().catch(()=>false)){await dialog.getByRole('button',{name:'Fermer l’affichage',exact:true}).click();await dialog.waitFor({state:'hidden'});}
}
async function openFilters(f) {
  await closeDisplay(f);const button=filtersButton(f);
  if(await button.getAttribute('aria-expanded')!=='true')await button.click();
  const panel=f.page.getByRole('group',{name:'Filtres des dossiers',exact:true});await panel.waitFor();return panel;
}
const columnFiltersEntry = f => f.page.getByRole('group',{name:'Filtres des dossiers',exact:true}).getByRole('button',{name:/^Filtres par colonne(?: · \d+)?$/});
async function openColumnChooser(f) {
  await openFilters(f);await columnFiltersEntry(f).click();
  const dialog=f.page.getByRole('dialog',{name:'Filtrer une colonne',exact:true});await dialog.waitFor();return dialog;
}
async function openVisibleColumns(f) {
  const display=await openDisplay(f);await display.getByRole('button',{name:'Colonnes',exact:true}).click();await display.waitFor({state:'hidden'});
  const dialog=f.page.getByRole('dialog',{name:'Colonnes affichées',exact:true});await dialog.waitFor();return dialog;
}
async function exportFiltered(f,count) {
  const display=await openDisplay(f);const downloaded=f.page.waitForEvent('download');
  await display.getByRole('button',{name:`Exporter ${count} dossiers filtrés`,exact:true}).click();
  const file=await downloaded;assert.equal(await file.failure(),null);
  assert.equal(await display.isVisible(),true,'Exporting keeps « Affichage » open.');await closeDisplay(f);
  const book=XLSX.read(await fs.readFile(await file.path()),{type:'buffer'});
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
}
async function selectPreset(f,label,value) {
  await closeColumnFilter(f);await closeDisplay(f);
  const button=f.page.locator('[aria-label="Vues du tableau"]').getByRole('button',{name:label,exact:true});
  await button.click();
  await f.page.waitForURL(url => (url.searchParams.get('table') || 'daily') === value);
  await button.evaluate(node => new Promise(resolve => { const check=()=>node.getAttribute('aria-pressed')==='true'?resolve():requestAnimationFrame(check);check(); }));
}
async function selectScope(f,label,value) {
  await closeColumnFilter(f);await closeDisplay(f);
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
  else await (await openColumnChooser(f)).locator(`[data-column-choice="${key}"]`).click();
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
      const exported=await exportFiltered(f,6);const dateColumn=exported[0].indexOf('Dernière réception');
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
      // On a phone the column filters are reached from the inline « Filtres » panel, which stays open.
      if(width===390)await openFilters(f);
      const trigger=width===1440?f.page.getByRole('button',{name:'Filtrer la colonne Client',exact:true}):columnFiltersEntry(f);
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
      let dialog=await openVisibleColumns(f);
      const reference=dialog.getByRole('checkbox',{name:'Afficher Référence',exact:true});assert.equal(await reference.isChecked(),true);assert.equal(await reference.isDisabled(),true);
      await dialog.getByRole('checkbox',{name:'Afficher Casier',exact:true}).uncheck();await dialog.getByRole('checkbox',{name:'Afficher Dernière réception',exact:true}).uncheck();await dialog.getByRole('button',{name:'Terminer',exact:true}).click();
      await f.page.waitForURL(url=>!url.searchParams.has('col.casier')&&!url.searchParams.has('sort'));assert.equal(await f.page.locator('th[data-column="casier"]').count(),0);assert.equal(await f.page.locator('th[data-column="receivedAt"]').count(),0);
      await f.page.reload();await row(f,P).waitFor();assert.equal(await f.page.locator('th[data-column="casier"]').count(),0);assert.equal(Number(await resize.getAttribute('aria-valuenow')),190);
      const records=await exportFiltered(f,6);
      assert.equal(records[0].includes('Casier'),false);assert.equal(records[0].includes('Dernière réception'),false);assert.equal(records[0][0],'Référence');
      await selectPreset(f,'Paiements','payments');assert.equal(await f.page.locator('th[data-column="receivedAt"]').count(),1);
      await selectPreset(f,'Travail quotidien','daily');assert.equal(await f.page.locator('th[data-column="receivedAt"]').count(),0);
      dialog=await openVisibleColumns(f);await dialog.getByRole('button',{name:'Rétablir les colonnes',exact:true}).click();await dialog.getByRole('button',{name:'Terminer',exact:true}).click();
      await f.page.locator('th[data-column="casier"]').waitFor();assert.equal(Number(await resize.getAttribute('aria-valuenow')),190,'Restoring visible columns does not erase personal widths.');await assertNoBusinessChange(f,before);
    });
    await scenario('mobile-column-choices-keep-reference-and-filter-only-visible-data',async f=>{
      await f.page.setViewportSize({width:390,height:844});const before=structuredClone(f.tables.colis);await open(f);
      const dialog=await openVisibleColumns(f);
      for(const label of ['Client','Paiement','Action'])await dialog.getByRole('checkbox',{name:`Afficher ${label}`,exact:true}).uncheck();await dialog.getByRole('button',{name:'Terminer',exact:true}).click();
      assert.equal(await row(f,P2).locator('[data-column="client"]').count(),0);assert.equal(await row(f,P2).getByRole('button',{name:'Continuer',exact:true}).count(),0);await row(f,P2).getByRole('button',{name:'EXP-TAB002',exact:true}).waitFor();
      await openColumnChooser(f);assert.ok(await columnDialog(f).locator('[data-column-choice]').count()>0);assert.equal(await columnDialog(f).locator('[data-column-choice="paymentState"]').count(),0);assert.equal(await columnDialog(f).locator('[data-column-choice="client"]').count(),0);await columnDialog(f).press('Escape');
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
        const columns=await table.locator('thead th[data-column] .dossier-table-sort').evaluateAll(buttons=>buttons.map(button=>({key:button.closest('th').dataset.column,label:button.closest('th').dataset.columnLabel,visible:button.textContent.trim(),name:button.getAttribute('aria-label')})));
        assert.ok(columns.length>=8);
        for(const column of columns) {
          // A short visible heading keeps the full column name for every command and dialog.
          assert.equal(column.name,column.label);assert.ok(column.visible&&column.visible.split(/\s+/).every(word=>column.label.toLocaleLowerCase('fr').includes(word.toLocaleLowerCase('fr'))),`${column.key}: “${column.visible}” is part of “${column.label}”.`);
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
      const data=await exportFiltered(f,1);
      assert.equal(data.length,2);assert.equal(data[1][0],'EXP-TAB004');assert.equal(data[1][data[0].indexOf('Paiement')],'Paiement partiel');
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
      await selectPreset(f,'Paiements','payments');await filterColumn(f,'paid','min','20');await waitIds(f,[P4,P5,P6]);
      await selectPreset(f,'Travail quotidien','daily');await waitIds(f,[P,P2,P3,P4,P5,P6]);
      await f.page.waitForURL(url=>!url.searchParams.has('col.paid'));
      await assertNoBusinessChange(f,before);
    });
    await scenario('forced-finance-column-filter-does-not-grant-finance-access',async f=>{
      const before=structuredClone(f.tables.colis);
      await open(f,new URLSearchParams({table:'payments','col.paid':JSON.stringify({mode:'min',value:'50'})}).toString());
      await waitIds(f,[P,P2,P3,P4,P5,P6]);await f.page.waitForURL(url=>!url.searchParams.has('col.paid'));
      await openColumnChooser(f);
      const values=await columnDialog(f).locator('[data-column-choice]').evaluateAll(buttons=>buttons.map(button=>button.dataset.columnChoice));
      assert.equal(values.includes('paid'),false);assert.equal(values.includes('requested'),false);assert.equal(await f.page.locator('th[data-column="paid"]').count(),0);
      // Without perm_export_colis, the open « Affichage » dialog offers every reading setting but no export.
      const display=await openDisplay(f);await display.getByRole('combobox',{name:'Tri par défaut',exact:true}).waitFor();
      assert.equal(await display.getByRole('button',{name:/^Export/}).count(),0);assert.equal(await display.getByText(/^Export/).count(),0);await closeDisplay(f);
      await assertNoBusinessChange(f,before);
    },{restricted:true});
    await scenario('column-widths-resize-by-mouse-and-keyboard-and-keep-sticky-identities-aligned',async f=>{
      const before=structuredClone(f.tables.colis);await open(f);
      const separator=f.page.getByRole('separator',{name:'Redimensionner Référence',exact:true});
      const initial=Number(await separator.getAttribute('aria-valuenow'));
      await separator.focus();await separator.press('ArrowRight');await separator.press('Shift+ArrowRight');
      await f.page.waitForFunction(()=>document.querySelector('[aria-label="Redimensionner Référence"]').getAttribute('aria-valuenow')==='200');
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
      const usable=await f.page.getByRole('region',{name:'Tableau des dossiers',exact:true}).boundingBox();const pinnedRef=await cell(f,P,'ref').evaluate(n=>getComputedStyle(n).position==='sticky');if(pinnedRef){const actionWidth=(await cell(f,P,'action').boundingBox()).width;assert.ok(usable.width-600-actionWidth-40>=300,'Keeping a wide reference fixed must leave real room for the other data.');}
      await separator.press('Enter');assert.equal(Number(await separator.getAttribute('aria-valuenow')),initial);
      const actionResize=f.page.getByRole('separator',{name:'Redimensionner Action',exact:true});
      await actionResize.focus();await actionResize.press('End');assert.equal(Number(await actionResize.getAttribute('aria-valuenow')),280,'The action column has a useful upper bound instead of hiding the central data.');
      const clientResize=f.page.getByRole('separator',{name:'Redimensionner Client',exact:true});await clientResize.focus();await clientResize.press('End');
      assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).getAttribute('data-unpin-client'),'true');
      await clientResize.press('Enter');await actionResize.focus();await actionResize.press('Enter');
      // Narrowing the usable area releases fixed identities before they cover the data.
      await f.page.setViewportSize({width:1280,height:1000});await separator.focus();await separator.press('End');await actionResize.focus();await actionResize.press('End');
      await clientResize.focus();await clientResize.press('Home');
      assert.equal(Number(await separator.getAttribute('aria-valuenow')),600);assert.equal(Number(await clientResize.getAttribute('aria-valuenow')),96);
      const table=f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true});
      assert.equal(await table.getAttribute('data-unpin-ref'),'true');assert.equal(await table.getAttribute('data-unpin-client'),'true');
      await scroller.evaluate(node=>{node.scrollLeft=0;});await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const action=cell(f,P,'action'),wideBefore=[await ref.boundingBox(),await client.boundingBox(),await action.boundingBox()];
      await scroller.evaluate(node=>{node.scrollLeft=300;});await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const wideAfter=[await ref.boundingBox(),await client.boundingBox(),await action.boundingBox()];
      for(let i=0;i<2;i++)assert.ok(Math.abs(wideBefore[i].x-wideAfter[i].x-300)<=2,'Both oversized identity columns scroll together instead of leaving Client floating.');
      assert.ok(Math.abs(wideBefore[2].x-wideAfter[2].x)<=2&&wideAfter[2].x>=220&&wideAfter[2].x+wideAfter[2].width<=1280,'The action stays pinned and visible after releasing the identity columns.');
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await assertNoBusinessChange(f,before);
    });
    await scenario('column-width-preferences-remain-private-after-switching-account-in-the-same-browser',async f=>{
      await open(f);const separator=f.page.getByRole('separator',{name:'Redimensionner Référence',exact:true});
      await separator.focus();await separator.press('Shift+ArrowRight');await f.page.waitForFunction(()=>document.querySelector('[aria-label="Redimensionner Référence"]').getAttribute('aria-valuenow')==='190');
      const savedA=await f.page.evaluate(id=>localStorage.getItem(`expedile:table-widths:v1:${encodeURIComponent(id)}:daily`),ids.A);assert.equal(JSON.parse(savedA).ref,190);
      let visibility=await openVisibleColumns(f);await visibility.getByRole('checkbox',{name:'Afficher Client',exact:true}).uncheck();await visibility.getByRole('button',{name:'Terminer',exact:true}).click();
      const hiddenA=await f.page.evaluate(id=>localStorage.getItem(`expedile:table-columns:v1:${encodeURIComponent(id)}:daily`),ids.A);assert.ok(JSON.parse(hiddenA).includes('client'));
      await f.page.getByRole('button',{name:'Se déconnecter',exact:true}).filter({visible:true}).click();await f.page.getByLabel('Email',{exact:true}).waitFor();
      f.tables.profiles.push({id:B,nom:'Madly',role:'directeur',actif:true});
      const user={id:B,aud:'authenticated',role:'authenticated',email:'madly@example.test',user_metadata:{},created_at:new Date().toISOString()};
      const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:B,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
      await f.context.route('**/auth/v1/token**',route=>reply(route,{access_token:token,refresh_token:'test-b',token_type:'bearer',expires_in:3600,user}));
      await f.context.route('**/auth/v1/user',route=>reply(route,user));
      await f.login();await open(f);assert.equal(Number(await separator.getAttribute('aria-valuenow')),140,'The new account does not inherit the previous user’s width.');
      assert.equal(await f.page.locator('th[data-column="client"]').count(),1,'The new account does not inherit hidden columns.');
      visibility=await openVisibleColumns(f);await visibility.getByRole('checkbox',{name:'Afficher Casier',exact:true}).uncheck();await visibility.getByRole('button',{name:'Terminer',exact:true}).click();
      await separator.focus();await separator.press('ArrowRight');await f.page.waitForFunction(()=>document.querySelector('[aria-label="Redimensionner Référence"]').getAttribute('aria-valuenow')==='150');
      const values=await f.page.evaluate(({a,b})=>({a:localStorage.getItem(`expedile:table-widths:v1:${encodeURIComponent(a)}:daily`),b:localStorage.getItem(`expedile:table-widths:v1:${encodeURIComponent(b)}:daily`)}),{a:ids.A,b:B});
      assert.equal(values.a,savedA);assert.equal(JSON.parse(values.b).ref,150);assert.equal(f.claims.length,0);assert.deepEqual(businessWrites(f),[]);
      const hidden=await f.page.evaluate(({a,b})=>({a:localStorage.getItem(`expedile:table-columns:v1:${encodeURIComponent(a)}:daily`),b:localStorage.getItem(`expedile:table-columns:v1:${encodeURIComponent(b)}:daily`)}),{a:ids.A,b:B});assert.equal(hidden.a,hiddenA);assert.ok(JSON.parse(hidden.b).includes('casier'));assert.equal(JSON.parse(hidden.b).includes('client'),false);
    });
    for(const dark of [false,true])await scenario(`mobile-column-filter-reset-and-width-editor-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width:390,height:844});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      const before=structuredClone(f.tables.colis);await open(f);
      const options=await filterColumn(f,'paymentState','contains','partiel');await waitIds(f,[P4]);
      assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).count(),0);
      const width=options.getByLabel('Largeur de Paiement',{exact:true});await width.fill('300');await width.press('Enter');
      assert.equal(await width.inputValue(),'300');await options.getByRole('button',{name:'Rétablir les largeurs',exact:true}).click();
      await f.page.waitForFunction(()=>document.querySelector('[aria-label="Largeur de Paiement"]')?.value==='140');assert.equal(await width.inputValue(),'140');
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
        const display=await openDisplay(f);
        await display.getByRole('combobox',{name:'Tri par défaut',exact:true}).selectOption(`column:${key}:${direction}`);
        await f.page.waitForURL(url=>url.searchParams.get('sort')===key&&url.searchParams.get('dir')===direction);
        assert.equal(await display.isVisible(),true,'Choosing a sort keeps « Affichage » open.');
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
      await sort('sentAt','desc');await f.page.reload();await row(f,P4).waitFor();assert.deepEqual((await orderedIds(f)).slice(0,3),[P4,P6,P5]);
      await selectPreset(f,'Départs','departures');assert.equal(new URL(f.page.url()).searchParams.get('sort'),'sentAt');
      assert.equal(await f.page.locator('thead th[aria-sort="descending"]').count(),0,'An unrelated view does not pretend to sort an invisible quote-sent date.');
      await selectPreset(f,'Paiements','payments');assert.deepEqual((await orderedIds(f)).slice(0,3),[P4,P6,P5]);
      await closeDisplay(f);await f.page.screenshot({path:`${output}/payments-sorted-descending.png`,fullPage:true});
      await assertNoBusinessChange(f,before);
    });
    await scenario('mobile-sort-menu-offers-all-data-columns-in-every-view-and-both-directions',async f=>{
      await f.page.setViewportSize({width:390,height:844});const before=structuredClone(f.tables.colis);await open(f);
      for(const [label,view,keys] of [
        ['Travail quotidien','daily',['ref','client','receivedAt','statusLabel','paymentState','statut','owner','casier','cartons','optimizedDimensions','optimizedWeight','requested']],
        ['Paiements','payments',['ref','client','receivedAt','statusLabel','paymentState','requested','paid','remaining','sentAt']],
        ['Départs','departures',['ref','client','receivedAt','statusLabel','paymentState','departure','destination','packages','readiness','optimizedDimensions','optimizedWeight','requested']],
      ]) {
        await selectPreset(f,label,view);
        const menu=(await openDisplay(f)).getByRole('combobox',{name:'Tri par défaut',exact:true});
        const available=await menu.locator('option').evaluateAll(options=>options.map(option=>option.value).filter(value=>value.startsWith('column:')));
        for(const key of keys)for(const direction of ['asc','desc']) {
          assert.ok(available.includes(`column:${key}:${direction}`));await menu.selectOption(`column:${key}:${direction}`);
          await f.page.waitForURL(url=>url.searchParams.get('sort')===key&&url.searchParams.get('dir')===direction);
        }
        await menu.selectOption('column:ref:desc');await f.page.waitForURL(url=>url.searchParams.get('sort')==='ref'&&url.searchParams.get('dir')==='desc');
        assert.deepEqual(await orderedIds(f),[P6,P5,P4,P3,P2,P],'Mobile cards follow the chosen descending order.');
        assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).count(),0);
        assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
        await closeDisplay(f);
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
      // Count every element (button, tab, link or text) of the view strip, so a new widget role cannot make this pass vacuously.
      const views=f.page.locator('[aria-label="Vues du tableau"]');
      assert.deepEqual(await views.getByRole('button').allTextContents(),['Travail quotidien','Départs']);
      assert.equal(await views.evaluate(node=>[node,...node.querySelectorAll('*')].filter(item=>/Paiements/i.test(`${item.textContent} ${item.getAttribute('aria-label')||''} ${item.getAttribute('title')||''}`)).length),0);
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
    for(const dark of [false,true])await scenario(`phone-bulk-status-is-chosen-then-applied-explicitly-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width:390,height:844});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      await open(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
      for(const [id,ref] of [[P4,'EXP-TAB004'],[P5,'EXP-TAB005']])await row(f,id).getByRole('checkbox',{name:`Sélectionner le dossier ${ref}`,exact:true}).check();
      const bar=f.page.getByRole('group',{name:'Actions sur la sélection',exact:true});await bar.getByText('2 dossiers sélectionnés',{exact:true}).waitFor();
      const select=bar.getByRole('combobox',{name:'Changer le statut',exact:true}),apply=bar.getByRole('button',{name:'Appliquer',exact:true});
      assert.equal(await apply.isDisabled(),true,'Nothing to apply before a status is chosen.');
      const edge=await select.evaluate(node=>window.__pintaContrast.ink(node.parentElement,getComputedStyle(node).borderTopColor));assert.ok(edge>=3,`The status field keeps a 3:1 edge on the bar (${edge.toFixed(2)}).`);
      for(const control of [select,apply]){const box=await control.boundingBox();assert.ok(box.height>=44&&box.x>=0&&box.x+box.width<=391,'The picker fits the phone with 44px targets.');}
      const statusWrites=()=>f.requests.filter(request=>request.method==='PATCH'&&request.path==='/rest/v1/colis');
      // A keystroke on the closed select (typeahead, arrows) changes its value: it must not run anything.
      await select.focus();await f.page.keyboard.press('a');await select.selectOption('transit');
      await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.deepEqual(statusWrites(),[],'Choosing a status never changes a dossier.');assert.equal(await select.inputValue(),'transit');
      await apply.click();await bar.waitFor({state:'hidden'});
      const writes=statusWrites();assert.equal(writes.length,2,'Exactly one update per selected dossier.');
      assert.deepEqual(writes.map(request=>request.input.statut),['transit','transit']);
      assert.deepEqual(f.tables.colis.filter(parcel=>parcel.statut==='transit').map(parcel=>parcel.id).sort(),[P4,P5].sort());
      assert.equal(f.claims.length,0);
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
      const toggle=filtersButton(f);assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await f.page.getByRole('dialog').count(),0,'The filters panel is inline, never modal.');
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
      await open(f);
      const expected={daily:['Référence','Client','Dernière réception','Statut du dossier','Paiement','Travail à faire','Qui s’en occupe','Casier','Cartons reçus','Dimensions finales','Poids final (kg)','Prix du devis'],payments:['Référence','Client','Dernière réception','Statut du dossier','Paiement','Demandé','Payé','Reste à payer','Devis envoyé le'],departures:['Référence','Client','Dernière réception','Statut du dossier','Paiement','Départ prévu','Destination','Colis à expédier','Prêt à partir ?','Dimensions finales','Poids final (kg)','Prix du devis']};
      for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures']]) {
        await selectPreset(f,label,view);
        const data=await exportFiltered(f,6);
        const visibleReferences=await rows(f).locator('[data-column="ref"] .dossier-table-reference').allTextContents();
        assert.deepEqual(data[0],expected[view]);
        // Short visible headings never leak into the export: it keeps every full column label.
        const headings=await f.page.locator('thead th[data-column-label]:not([data-column="action"])').evaluateAll(nodes=>nodes.map(node=>({label:node.dataset.columnLabel,visible:node.querySelector('.dossier-table-sort')?.textContent.trim()})));
        assert.deepEqual(headings.map(item=>item.label),expected[view],`${view}: export headers equal the full labels of the visible columns, in order.`);
        if(view==='daily')assert.ok(headings.some(item=>item.visible!==item.label),'The daily view really displays at least one short heading.');assert.deepEqual(data.slice(1).map(line=>line[0]),visibleReferences,'Excel follows the visible row order.');assert.equal(data.length,7);assert.equal(new Set(data.slice(1).map(line=>line[0])).size,6);
        if(view==='payments') {
          const unknown=data.find(line=>line[0]==='EXP-TAB001'),partial=data.find(line=>line[0]==='EXP-TAB004');
          assert.equal(unknown[data[0].indexOf('Demandé')],'À calculer');assert.deepEqual(['Demandé','Payé','Reste à payer'].map(label=>partial[data[0].indexOf(label)]),[100,30,70]);
        }
        if(view==='daily')assert.equal(data.find(line=>line[0]==='EXP-TAB002')[data[0].indexOf('Qui s’en occupe')],'Vous');
      }
      assert.equal(f.claims.length,0);assert.deepEqual(businessWrites(f),[]);
    });
    await scenario('financial-view-does-not-grant-financial-export-permission',async f=>{
      await open(f);let display=await openDisplay(f);
      await display.getByRole('button',{name:'Exporter 6 dossiers filtrés',exact:true}).waitFor();
      await selectPreset(f,'Paiements','payments');
      // The menu is open while counting, so the absence of an export command is real.
      display=await openDisplay(f);await display.getByRole('combobox',{name:'Tri par défaut',exact:true}).waitFor();
      assert.equal(await display.getByRole('button',{name:/^Export/}).count(),0);assert.equal(await f.page.getByRole('button',{name:/^Exporter/}).count(),0);
      await closeDisplay(f);
      await row(f,P4).getByRole('checkbox',{name:'Sélectionner le dossier EXP-TAB004',exact:true}).check();
      await f.page.getByRole('group',{name:'Actions sur la sélection',exact:true}).waitFor();
      assert.equal(await f.page.getByRole('button',{name:/^Exporter/}).count(),0);
      display=await openDisplay(f);assert.equal(await display.getByRole('button',{name:/^Export/}).count(),0);await closeDisplay(f);
      assert.deepEqual(businessWrites(f),[]);
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
    for(const [width,height] of [[1440,1000],[390,844],[320,568]])for(const dark of [false,true])await scenario(`toolbar-filters-panel-and-display-dialog-${width}-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width,height});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      const before=structuredClone(f.tables.colis);await open(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
      const phone=width<640,filters=filtersButton(f),display=displayButton(f);
      const count=f.page.getByRole('status').filter({hasText:/^\d+ dossiers?$/});
      const assertCount=async()=>{const n=await rows(f).count();assert.equal((await count.innerText()).trim(),`${n} ${n>1?'dossiers':'dossier'}`,'The count names exactly the dossiers displayed.');};
      await assertCount();
      for(const button of [filters,display]){const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44,'Toolbar buttons keep a 44px target.');}
      // On a phone both buttons are icons; their accessible names stay complete.
      assert.equal((await filters.innerText()).trim(),phone?'':'Filtres');assert.equal((await display.innerText()).trim(),phone?'':'Affichage');
      // aria-controls names the panel only while it exists (a dangling IDREF is invalid).
      assert.equal(await filters.getAttribute('aria-label'),'Filtres');assert.equal(await filters.getAttribute('aria-controls'),null);assert.equal(await filters.getAttribute('aria-expanded'),'false');
      assert.equal(await f.page.locator('#dossier-filters-panel').count(),0);
      // « Filtres »: an inline panel with the work filters and the column-filter entry only.
      await filters.click();assert.equal(await filters.getAttribute('aria-expanded'),'true');
      const panel=f.page.getByRole('group',{name:'Filtres des dossiers',exact:true});await panel.waitFor();assert.equal(await panel.getAttribute('id'),'dossier-filters-panel');assert.equal(await filters.getAttribute('aria-controls'),'dossier-filters-panel');
      assert.equal(await f.page.getByRole('dialog').count(),0,'The filters panel is not modal.');
      for(const name of ['File de travail','Étape','Responsable de la tâche','Destination'])assert.equal(await panel.getByRole('combobox',{name,exact:true}).count(),1,`${name} stays in Filtres.`);
      await panel.getByRole('button',{name:'Inclure les archives',exact:true}).waitFor();
      // A work queue never lists archives, so no toggle may claim to include them.
      const queue=panel.getByRole('combobox',{name:'File de travail',exact:true});
      await queue.selectOption('preparation');await f.page.waitForURL(url=>url.searchParams.get('work')==='preparation');
      assert.equal(await panel.getByRole('button',{name:/archives/i}).count(),0,'No archives toggle under a work queue.');
      await queue.selectOption('');await f.page.waitForURL(url=>!url.searchParams.has('work'));
      await panel.getByRole('button',{name:'Inclure les archives',exact:true}).waitFor();
      const entry=panel.getByRole('button',{name:'Filtres par colonne',exact:true});assert.equal((await entry.innerText()).trim(),'Filtres par colonne','The visible entry text is its accessible name at every width.');
      assert.equal(await entry.getAttribute('aria-haspopup'),'dialog');
      for(const name of ['Tri par défaut','Regrouper les dossiers','Affichage des dossiers'])assert.equal(await f.page.getByRole('combobox',{name,exact:true}).count(),0,`${name} lives in Affichage only.`);
      assert.equal(await f.page.getByRole('button',{name:/^Export/}).count(),0);
      await panel.getByRole('combobox',{name:'Destination',exact:true}).selectOption('974');
      await f.page.getByRole('button',{name:'Filtres · 1',exact:true}).waitFor();
      const active=f.page.getByRole('group',{name:'Filtres actifs',exact:true}),chips=active.getByRole('button',{name:/^Retirer le filtre /});
      assert.equal(await chips.count(),1);assert.equal((await filters.locator('.dossier-toolbar-badge').innerText()).trim(),'1');await assertCount();
      await panel.getByRole('combobox',{name:'Responsable de la tâche',exact:true}).selectOption('mine');
      await f.page.getByRole('button',{name:'Filtres · 2',exact:true}).waitFor();assert.equal(await chips.count(),2,'The button count equals the active filter chips.');
      assert.equal((await filters.locator('.dossier-toolbar-badge').innerText()).trim(),'2');await assertCount();
      // Clearing every filter also folds the panel, as before the redesign.
      await active.getByRole('button',{name:'Retirer les filtres',exact:true}).click();
      await f.page.getByRole('button',{name:'Filtres',exact:true}).waitFor();assert.equal(await filters.locator('.dossier-toolbar-badge').count(),0);await waitIds(f,[P,P2,P3,P4,P5,P6]);await assertCount();
      await panel.waitFor({state:'hidden'});assert.equal(await filters.getAttribute('aria-expanded'),'false');
      await filters.click();await panel.getByRole('button',{name:'Fermer les filtres',exact:true}).click();await panel.waitFor({state:'hidden'});assert.equal(await filters.getAttribute('aria-expanded'),'false');
      // « Affichage »: a keyboard-operable dialog that holds every reading and organisation preference.
      assert.equal(await display.getAttribute('aria-haspopup'),'dialog');assert.equal(await display.getAttribute('aria-expanded'),'false');
      await display.focus();await f.page.keyboard.press('Enter');const dialog=displayDialog(f);await dialog.waitFor();
      assert.equal(await display.getAttribute('aria-expanded'),'true');assert.equal(await display.getAttribute('aria-controls'),'dossier-display-dialog');assert.equal(await dialog.getAttribute('id'),'dossier-display-dialog');
      assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true,'Keyboard focus moves into Affichage.');
      const columns=dialog.getByRole('button',{name:'Colonnes',exact:true});assert.equal(await columns.getAttribute('aria-haspopup'),'dialog');
      await dialog.getByText(/^\d+ sur \d+ colonnes affichées$/).waitFor();
      for(const text of ['Colonnes','Affichage des dossiers','Taille du texte','Regrouper','Tri par défaut'])assert.ok(await dialog.getByText(text,{exact:true}).count()>=1,`Affichage shows « ${text} ».`);
      // WCAG 2.5.3: every visible field label is part of its control's accessible name.
      for(const field of await dialog.locator('label.dossier-display-field').evaluateAll(nodes=>nodes.map(node=>({visible:node.querySelector('span').textContent.trim(),name:node.querySelector('select').getAttribute('aria-label')}))))assert.ok(field.name.startsWith(field.visible),`« ${field.visible} » is in the name « ${field.name} ».`);
      const layout=dialog.getByRole('combobox',{name:'Affichage des dossiers',exact:true}),size=dialog.getByRole('spinbutton',{name:'Taille du texte des dossiers',exact:true}),group=dialog.getByRole('combobox',{name:'Regrouper les dossiers',exact:true}),sort=dialog.getByRole('combobox',{name:'Tri par défaut',exact:true});
      assert.deepEqual(await layout.locator('option').evaluateAll(options=>options.map(option=>option.value)),['auto','table','cards']);
      const exportButton=dialog.getByRole('button',{name:'Exporter 6 dossiers filtrés',exact:true});
      const controls=[columns,layout,dialog.getByRole('button',{name:'Réduire le texte des dossiers',exact:true}),size,dialog.getByRole('button',{name:'Agrandir le texte des dossiers',exact:true}),group,sort,exportButton];
      // Editable fields keep a visible edge (3:1) in both themes: « html.dark input/select » cannot reset it.
      for(const field of [layout,size,group,sort]){const edge=await field.evaluate(node=>({name:node.getAttribute('aria-label'),ratio:window.__pintaContrast.ink(node.parentElement,getComputedStyle(node).borderTopColor)}));assert.ok(edge.ratio>=3,`« ${edge.name} » keeps a 3:1 border (${edge.ratio.toFixed(2)}).`);}
      const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,'Affichage fits inside the viewport.');
      if(width>=768){const anchor=await display.boundingBox();assert.ok(Math.abs(box.x+box.width-anchor.x-anchor.width)<=2,'On a large screen Affichage hangs under its button, right edges aligned.');}
      const scrolling=await dialog.evaluate(node=>({overflow:getComputedStyle(node).overflowY,scrolls:node.scrollHeight>node.clientHeight+1}));
      assert.ok(['auto','scroll'].includes(scrolling.overflow),'Affichage scrolls inside itself.');if(height<=568)assert.equal(scrolling.scrolls,true,'The short phone really needs the internal scroll.');
      for(const control of controls){
        await control.scrollIntoViewIfNeeded();const b=await control.boundingBox();
        assert.ok(b.height>=44&&b.x>=box.x-1&&b.x+b.width<=box.x+box.width+1&&b.y>=0&&b.y+b.height<=height+1,'Every Affichage control is reachable inside the dialog.');
        assert.ok(await control.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))>=14,'Affichage controls keep a fixed readable size.');
      }
      await noPageOverflow(f);
      // Changing a setting keeps the dialog open.
      await group.selectOption('statut');await f.page.waitForURL(url=>url.searchParams.get('view')==='statut');assert.equal(await dialog.isVisible(),true);
      await group.selectOption('priority');await f.page.waitForURL(url=>(url.searchParams.get('view')||'priority')==='priority');assert.equal(await dialog.isVisible(),true);
      // Escape first undoes a typed size, then closes and returns focus to the trigger.
      await size.fill('17');await size.press('Escape');assert.equal(await size.inputValue(),'12');assert.equal(await dialog.isVisible(),true,'Escape in a dirty size field does not close Affichage.');
      await size.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.equal(await display.evaluate(node=>node===document.activeElement),true,'Escape returns focus to Affichage.');assert.equal(await display.getAttribute('aria-expanded'),'false');
      assert.ok([null,'12'].includes(await f.page.evaluate(id=>localStorage.getItem(`expedile:table-text:v1:${id}:daily`),ids.A)),'An abandoned size is never saved.');
      await display.click();await dialog.waitFor();await f.page.mouse.click(2,height-2);await dialog.waitFor({state:'hidden'});
      assert.equal(await display.evaluate(node=>node===document.activeElement),true,'A backdrop click returns focus to Affichage.');
      await display.click();await dialog.waitFor();
      const axe=await new AxeBuilder({page:f.page}).include('[data-testid="display-options-dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
      await f.page.screenshot({path:`${output}/display-dialog-${width}-${dark?'dark':'light'}.png`});
      await dialog.getByRole('button',{name:'Fermer l’affichage',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await display.evaluate(node=>node===document.activeElement),true);
      // « Colonnes » replaces Affichage with the visibility dialog; closing it returns to Affichage.
      await display.click();await columns.click();await dialog.waitFor({state:'hidden'});
      const visibility=f.page.getByRole('dialog',{name:'Colonnes affichées',exact:true});await visibility.waitFor();await visibility.press('Escape');await visibility.waitFor({state:'hidden'});
      assert.equal(await display.evaluate(node=>node===document.activeElement),true);
      await noPageOverflow(f);await assertNoBusinessChange(f,before);
    });
    for(const width of [1440,320])for(const dark of [false,true])await scenario(`view-tabs-press-exactly-one-view-and-scroll-inside-their-strip-${width}-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width,height:width===320?568:1000});await f.page.emulateMedia({reducedMotion:'reduce'});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      await open(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
      const strip=f.page.locator('[aria-label="Vues du tableau"]');assert.equal(await strip.getAttribute('role'),'group');
      if(width===320){const overflow=await strip.evaluate(node=>({style:getComputedStyle(node).overflowX,scrolls:node.scrollWidth>node.clientWidth+1}));assert.ok(['auto','scroll'].includes(overflow.style)&&overflow.scrolls,'At 320px the tabs really overflow and scroll inside their own strip.');}
      for(const [label,value] of [['Départs','departures'],['Paiements','payments'],['Travail quotidien','daily']]) {
        await selectPreset(f,label,value);await settle(f);
        const states=await strip.getByRole('button').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,pressed:button.getAttribute('aria-pressed')})));
        assert.deepEqual(states.filter(item=>item.pressed==='true').map(item=>item.text),[label],'Exactly one view is pressed, and its text is the bare label.');
        assert.ok(states.every(item=>item.pressed==='true'||item.pressed==='false'));
        const tab=strip.getByRole('button',{name:label,exact:true}),t=await tab.boundingBox(),s=await strip.boundingBox();
        assert.ok(t.x>=s.x-1&&t.x+t.width<=s.x+s.width+1,`${label}: the selected view is scrolled fully into its strip.`);
        if(width===320&&value==='departures')assert.ok(await strip.evaluate(node=>node.scrollLeft)>0,'Selecting the last view scrolls the strip, not the page.');
        const underline=await tab.evaluate(node=>{const C=window.__pintaContrast,style=getComputedStyle(node);const color=/inset/.test(style.boxShadow)?style.boxShadow.match(/rgba?\([^)]*\)/)?.[0]:parseFloat(style.borderBottomWidth)>=2?style.borderBottomColor:null;return color?C.ink(node,color):0;});
        assert.ok(underline>=3,`${label}: the selected underline reaches 3:1 (${underline.toFixed(2)}).`);
        assert.ok(await tab.evaluate(node=>window.__pintaContrast.text(node))>=4.5);
        await noPageOverflow(f);
      }
    });
    for(const dark of [false,true])await scenario(`table-header-pills-and-actions-keep-meaning-and-contrast-${dark?'dark':'light'}`,async f=>{
      // P5 becomes my own ready task: the shared TaskTakeButton then offers « Continuer ».
      f.tables.staff_work_actions.find(action=>action.colis_id===P5).assignee_id=ids.A;
      await f.page.setViewportSize({width:1440,height:1000});await f.page.emulateMedia({reducedMotion:'reduce'});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      const before=structuredClone(f.tables.colis);await open(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
      const table=f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true});
      // A short heading keeps every command named with the full label.
      const received=table.locator('th[data-column="receivedAt"]');assert.equal(await received.getAttribute('data-column-label'),'Dernière réception');
      assert.equal((await received.locator('.dossier-table-sort').textContent()).trim(),'Réception');assert.equal(await received.locator('.dossier-table-sort').getAttribute('aria-label'),'Dernière réception');
      assert.equal(await received.locator('.dossier-table-heading-text').getAttribute('title'),'Dernière réception');
      await received.getByRole('button',{name:'Filtrer la colonne Dernière réception',exact:true}).waitFor();await table.getByRole('separator',{name:'Redimensionner Dernière réception',exact:true}).waitFor();
      // Quiet header filters: never hidden, 24×44 target, icon at least 3:1.
      const probeFilters=()=>table.locator('thead .dossier-table-filter').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect(),s=getComputedStyle(button);return {key:button.closest('th').dataset.column,width:r.width,height:r.height,ratio:window.__pintaContrast.text(button),pressed:button.getAttribute('aria-pressed'),visible:s.visibility!=='hidden'&&s.display!=='none',color:s.color,background:s.backgroundColor,dot:getComputedStyle(button,'::after').content};}));
      await f.page.mouse.move(0,0);await settle(f);let headerFilters=await probeFilters();assert.ok(headerFilters.length>=8);
      for(const item of headerFilters){assert.ok(item.visible&&item.width>=24&&item.height>=44,`${item.key}: quiet filter keeps its target.`);assert.ok(item.ratio>=3,`${item.key}: idle filter icon ${item.ratio.toFixed(2)}:1.`);assert.equal(item.pressed,'false');}
      const idle=headerFilters.find(item=>item.key==='client');
      const options=await filterColumn(f,'client','contains','Camille');await options.press('Escape');await options.waitFor({state:'hidden'});await f.page.mouse.move(0,0);await settle(f);
      headerFilters=await probeFilters();const pressed=headerFilters.find(item=>item.key==='client');
      assert.equal(pressed.pressed,'true');assert.ok(pressed.ratio>=3);assert.ok(pressed.color!==idle.color||pressed.background!==idle.background,'An active column filter looks different from an idle one.');
      assert.ok(pressed.dot&&pressed.dot!=='none','An active column filter shows its marker.');
      await f.page.getByRole('button',{name:'Retirer les filtres',exact:true}).click();await waitIds(f,[P,P2,P3,P4,P5,P6]);
      // Pills: exact label, deliberate tone; a partial payment is never green.
      for(const [id,key,label,tone] of [[P4,'paymentState','Paiement partiel','waiting'],[P4,'statusLabel','Paiement partiel','waiting'],[P5,'paymentState','Payé','done'],[P5,'statusLabel','Payé','done'],[P3,'statusLabel',null,'waiting'],[P,'statusLabel',null,'neutral']]) {
        const pill=cell(f,id,key).locator('.dossier-pill');assert.equal(await pill.count(),1);
        const text=(await pill.innerText()).trim();assert.equal(text,(await cell(f,id,key).innerText()).trim(),'The pill holds the whole cell text, with no hidden prefix.');
        if(label)assert.equal(text,label);assert.equal(await pill.getAttribute('data-tone'),tone,`${id}/${key}: “${text}” uses the ${tone} tone.`);
      }
      const pillRatios=async id=>{await settle(f);return row(f,id).locator('.dossier-pill').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,ratio:window.__pintaContrast.text(node)})));};
      const assertPills=async(state,ids)=>{for(const id of ids){const values=await pillRatios(id);assert.ok(values.length>=2);assert.deepEqual(values.filter(item=>item.ratio<4.5),[],`${state}: pill text keeps 4.5:1.`);}};
      await f.page.mouse.move(0,0);await assertPills('normal',[P,P2,P3,P4,P5,P6]);
      for(const id of [P,P3,P4,P5]){await cell(f,id,'client').hover();await assertPills('hover',[id]);}
      for(const id of [P4,P5])await row(f,id).getByRole('checkbox',{name:/^Sélectionner le dossier /}).check();
      await f.page.mouse.move(0,0);await assertPills('selected',[P4,P5]);for(const id of [P4,P5]){await cell(f,id,'client').hover();await assertPills('selected-hover',[id]);}
      await f.page.getByRole('button',{name:'Désélectionner tout',exact:true}).click();await f.page.mouse.move(0,0);
      // Actions: « Continuer » filled, « Je m’en occupe » outlined, « Consulter » quiet; all legible.
      const probe=locator=>locator.evaluate(node=>{const s=getComputedStyle(node),C=window.__pintaContrast;return {kind:node.dataset.takeKind||null,background:s.backgroundColor,alpha:C.rgba(s.backgroundColor)[3],border:parseFloat(s.borderTopWidth),borderColor:s.borderTopColor,borderRatio:C.ink(node.parentElement,s.borderTopColor),ratio:C.text(node),height:node.getBoundingClientRect().height,justify:s.justifyContent};});
      await settle(f);
      const ownTake=await probe(row(f,P5).getByRole('button',{name:'Continuer',exact:true})),ownOpen=await probe(row(f,P2).getByRole('button',{name:'Continuer',exact:true})),claim=await probe(take(f)),consult=await probe(row(f,P3).getByRole('button',{name:'Consulter',exact:true}));
      assert.equal(ownTake.kind,'continue');assert.equal(claim.kind,'claim');
      for(const item of [ownTake,ownOpen])assert.ok(item.alpha===1&&item.background===ownOpen.background,`Both « Continuer » buttons are filled alike (${ownTake.background} / ${ownOpen.background}).`);
      assert.equal(claim.alpha,0,'« Je m’en occupe » is outlined, not filled.');assert.ok(claim.border>=1&&claim.borderRatio>=3,'Its outline is visible.');
      assert.notEqual(consult.borderColor,claim.borderColor,'« Consulter » stays visibly quieter than the claim outline.');
      for(const item of [ownTake,ownOpen,claim,consult]){assert.ok(item.ratio>=4.5,`Action text ${item.ratio.toFixed(2)}:1.`);assert.ok(item.height>=44);assert.equal(item.justify,'center');}
      await noPageOverflow(f);
      // The same TaskTakeButton keeps its own filled style in Mon travail.
      await f.page.goto(`${base}/?section=pool`);const work=f.page.locator(`[data-work-action="${RECEIVE}"]`).getByRole('button',{name:'Je m’en occupe',exact:true});await work.waitFor();
      const workStyle=await probe(work);assert.equal(workStyle.kind,'claim');assert.equal(workStyle.alpha,1,'Mon travail keeps a filled claim button.');assert.equal(workStyle.border,0);assert.ok(workStyle.ratio>=4.5);
      await assertNoBusinessChange(f,before);
    });
    for(const width of [1440,390])for(const dark of [false,true])await scenario(`table-readable-and-accessible-${width}-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width,height:width===390?844:1000});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      await open(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
      await row(f,P2).waitFor();assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      if(width===390){
        const action=await row(f,P2).getByRole('button',{name:'Continuer',exact:true}).boundingBox();
        const bottomNav=await f.page.getByRole('button',{name:'Dossiers',exact:true}).locator('..').boundingBox();
        assert.ok(action.y>=0&&action.y+action.height<=bottomNav.y-12,`The first primary action is fully visible before scrolling, 12px above the navigation (${action.y+action.height} <= ${bottomNav.y-12}).`);
      }
      if(width===1440) {
        const separatorStyle=nodes=>nodes.map(node=>{const style=getComputedStyle(node);return {column:node.dataset.column,width:parseFloat(style.borderRightWidth),color:style.borderRightColor,background:style.backgroundColor,ratio:window.__pintaContrast.ink(node,style.borderRightColor)};});
        const separators=await row(f,P2).locator('td[data-column]').evaluateAll(separatorStyle),headings=await f.page.locator('thead th[data-column]').evaluateAll(separatorStyle);
        assert.ok(separators.length>=10);assert.equal(headings.length,separators.length);
        // A real 1px border (not a shadow) whose colour differs measurably from the cell, on body and header cells.
        assert.deepEqual([...separators,...headings].filter(line=>!(line.width>=1&&line.color!=='rgba(0, 0, 0, 0)'&&line.color!==line.background&&line.ratio>=1.25)),[],'Every desktop cell retains a visible vertical separator in both themes.');
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
