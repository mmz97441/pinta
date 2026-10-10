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
  const f = await setup(browser, options.restricted ? 'preparateur' : 'directeur', { device: options.device || {} });
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
  // A full working list (the toast tests): more dossiers like the first one, without a task.
  for (let n = 0; n < (options.more || 0); n++) f.tables.colis.push(parcel(parcelId(100 + n), `EXP-LIST${String(100 + n)}`, {statut:'mesure',feu_vert:'en_attente',final_packages:[],fin_l:null,fin_w:null,fin_h:null,fin_p:null,final_measurements_version:null,outgoing_parcel_count:0,devis_total:0,quote_version:0}));
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
  await display.getByRole('button',{name:count===1?'Exporter 1 dossier filtré':`Exporter ${count} dossiers filtrés`,exact:true}).click();
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
  if(mode==='is')await options.getByLabel(`Filtrer : ${label}`,{exact:true}).selectOption(value);
  else if(!['empty','filled'].includes(mode))await options.getByLabel(`Filtrer : ${label}`,{exact:true}).fill(value);
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
      // The one view that lists fewer dossiers: « Accords clients » keeps those whose consent is to obtain (measured P, awaiting P3).
      await selectPreset(f,'Accords clients','accords');await waitIds(f,[P,P3]);
      assert.equal(await rows(f).count(),2,'No duplicate row either');
      await selectPreset(f,'Travail quotidien','daily');await waitIds(f,[P,P2,P3,P4,P5,P6]);
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
        // « Départs » groups by departure (DEP-QA-01: P4–P6, then the dossiers without a
        // departure): the sort applies inside each group, unknown dates last in each.
        if(view==='departures'){assert.deepEqual(await orderedIds(f),[P4,P5,P6,P2,P,P3]);assert.match(await f.page.locator('.dossier-meta-sort').innerText(),/ · dans chaque groupe$/);}
        else{assert.deepEqual((await orderedIds(f)).slice(0,4),[P4,P2,P5,P]);assert.deepEqual((await orderedIds(f)).slice(4).sort(),[P3,P6]);}
        await button.click();await f.page.waitForURL(url=>url.searchParams.get('dir')==='desc');
        await f.page.locator('th[data-column="receivedAt"][aria-sort="descending"]').waitFor();
        if(view==='departures')assert.deepEqual(await orderedIds(f),[P5,P4,P6,P,P2,P3]);
        else{assert.deepEqual((await orderedIds(f)).slice(0,4),[P,P5,P2,P4]);assert.deepEqual((await orderedIds(f)).slice(4).sort(),[P3,P6]);}
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
    // The Action column is pinned to the right edge: it is resized from its left border, which follows the pointer
    // (dragging it left widens the column, right narrows it), never from a handle stuck against the window.
    for(const dark of [false,true])await scenario(`pinned-action-column-resizes-from-its-left-border-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width:1440,height:1000});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      const before=structuredClone(f.tables.colis);await open(f);
      const head=f.page.locator('thead th[data-column="action"]'),handle=f.page.getByRole('separator',{name:'Redimensionner Action',exact:true});
      await handle.waitFor();
      const box=async()=>{const [th,grip]=await Promise.all([head.boundingBox(),handle.boundingBox()]);return{th,grip,width:Number(await handle.getAttribute('aria-valuenow'))};};
      let m=await box();
      assert.ok(Math.abs(m.grip.x+m.grip.width/2-m.th.x)<=1,'The handle straddles the left border of the pinned column.');
      assert.ok(m.th.x+m.th.width<=1441&&m.th.x+m.th.width>=1439,'The column stays pinned to the right edge.');
      // Scrolled to its end, the last column's border is Action's: a press up to 9 px either side of it
      // resizes Action, never the column under it (whose border would slide under Action).
      const scroller=f.page.getByRole('region',{name:'Tableau des dossiers',exact:true});
      await scroller.evaluate(node=>{node.scrollLeft=node.scrollWidth;});await f.page.waitForFunction(()=>document.querySelector('.dossier-list-main')?.dataset.moreRight===undefined);await settle(f);
      m=await box();
      const owners=await f.page.evaluate(([x,y])=>[-9,-5,-1,0,1,5,9].map(dx=>document.elementFromPoint(x+dx,y)?.closest('.dossier-table-resize')?.getAttribute('aria-label')||null),[m.th.x,m.th.y+m.th.height/2]);
      assert.deepEqual(owners,Array(7).fill('Redimensionner Action'),'The shared border has one handle.');
      // The keyboard still reaches the last column's own handle there: Action's steps aside, so its focus shows.
      const lastColumn=await f.page.evaluate(()=>{const heads=[...document.querySelectorAll('thead th[data-column]')];return heads[heads.length-2].dataset.columnLabel;});
      const lastHandle=f.page.getByRole('separator',{name:`Redimensionner ${lastColumn}`,exact:true});
      await handle.focus();await f.page.keyboard.press('Shift+Tab');
      for(let i=0;i<3&&!await lastHandle.evaluate(node=>node===document.activeElement);i++)await f.page.keyboard.press('Shift+Tab');
      assert.equal(await lastHandle.evaluate(node=>node===document.activeElement),true,'Shift+Tab from Action reaches the last column’s handle.');
      const shown=await lastHandle.evaluate(node=>{const r=node.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return top===node||node.contains(top);});
      assert.equal(shown,true,'Its focused handle shows on top.');
      await f.page.evaluate(()=>document.activeElement?.blur());await scroller.evaluate(node=>{node.scrollLeft=0;});await settle(f);m=await box();
      assert.ok(Math.abs(m.grip.x+m.grip.width/2-m.th.x)<=1,'Once the focus has left, Action’s handle straddles its border again.');
      // A press focuses a handle, never as a keyboard focus, even right after a key: the table does not scroll under
      // the pointer (a border 5 px from the pinned client column), and Action keeps the shared border afterwards.
      const near=await scroller.evaluate(node=>{const client=node.querySelector('thead th[data-column="client"]').getBoundingClientRect(),border=node.querySelector('thead th[data-column="statut"]').getBoundingClientRect().right;node.scrollLeft+=border-client.right-5;return node.scrollLeft;});await settle(f);
      const statutHandle=await f.page.getByRole('separator',{name:'Redimensionner Travail à faire',exact:true}).boundingBox();
      await f.page.mouse.move(statutHandle.x+statutHandle.width-2,statutHandle.y+statutHandle.height/2);await f.page.mouse.down();await settle(f);
      assert.equal(await f.page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Redimensionner Travail à faire');
      assert.equal(await scroller.evaluate(node=>node.scrollLeft),near,'A press on a handle never scrolls the table.');
      await f.page.mouse.up();
      await scroller.evaluate(node=>{node.scrollLeft=node.scrollWidth;});await f.page.waitForFunction(()=>document.querySelector('.dossier-list-main')?.dataset.moreRight===undefined);await settle(f);m=await box();
      assert.deepEqual(await f.page.evaluate(([x,y])=>[-9,-5,-1,0,1,5,9].map(dx=>document.elementFromPoint(x+dx,y)?.closest('.dossier-table-resize')?.getAttribute('aria-label')||null),[m.th.x,m.th.y+m.th.height/2]),Array(7).fill('Redimensionner Action'),'Another handle taken by the pointer leaves the shared border to Action.');
      await f.page.evaluate(()=>document.activeElement?.blur());await scroller.evaluate(node=>{node.scrollLeft=0;});await settle(f);m=await box();
      const drag=async dx=>{const start=m.grip.x+m.grip.width/2,y=m.grip.y+m.grip.height/2;await f.page.mouse.move(start,y);await f.page.mouse.down();await f.page.mouse.move(start+dx/2,y);await f.page.mouse.move(start+dx,y);await f.page.mouse.up();};
      const initial=m.width,left=m.th.x;
      await drag(-60);await f.page.waitForFunction(width=>Number(document.querySelector('[aria-label="Redimensionner Action"]').getAttribute('aria-valuenow'))===width,initial+60);
      m=await box();assert.ok(Math.abs(m.th.x-(left-60))<=1,'Dragging the border left widens the column under the pointer.');
      await drag(200);await f.page.waitForFunction(()=>document.querySelector('[aria-label="Redimensionner Action"]').getAttribute('aria-valuenow')==='132');
      m=await box();assert.ok(Math.abs(m.th.x+m.th.width-1440)<=1&&Math.abs(m.th.width-132)<=1,'Dragging it right narrows the column down to its readable minimum.');
      // The arrow keys move the border the same way.
      await handle.focus();await handle.press('ArrowLeft');await f.page.waitForFunction(()=>document.querySelector('[aria-label="Redimensionner Action"]').getAttribute('aria-valuenow')==='142');
      await handle.press('ArrowRight');await f.page.waitForFunction(()=>document.querySelector('[aria-label="Redimensionner Action"]').getAttribute('aria-valuenow')==='132');
      // The title clears the handle, and the button stays whole and clickable at the minimum.
      const [title,grip]=await Promise.all([head.locator('.dossier-table-heading-text').boundingBox(),handle.boundingBox()]);
      assert.ok(title.x>=grip.x+grip.width,'« Action » starts after the handle.');
      const button=cell(f,P,'action').getByRole('button').first();const b=await button.boundingBox();
      assert.ok(b.height>=44&&b.x>=m.th.x&&b.x+b.width<=m.th.x+m.th.width+1);
      assert.equal(await button.evaluate(n=>n.scrollWidth>n.clientWidth+1),false);
      await f.page.screenshot({path:`${output}/pinned-action-resize-${dark?'dark':'light'}.png`});
      await assertNoBusinessChange(f,before);
    });
    // The client's offer before the name: « P » Premium, « F » Freemium, an ended Premium marked as such
    // (in words too, readable without hovering); a dossier without a known client shows no offer.
    for(const width of [1440,390])for(const dark of [false,true])await scenario(`client-offer-reads-p-or-f-before-the-name-${width}-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width,height:width===390?844:1000});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      const base=f.tables.clients[0];
      Object.assign(base,{abonnement:'premium_annuel',abonnement_debut:'2026-01-01',abonnement_fin:'2099-12-31'});
      const free={...structuredClone(base),id:'c1000000-0000-4000-8000-000000000002',ref:'CLI-FREE',nom:'Freemium',prenom:'Fanny',user_id:null,abonnement:'freemium',abonnement_debut:null,abonnement_fin:null};
      const ended={...structuredClone(base),id:'c1000000-0000-4000-8000-000000000003',ref:'CLI-ENDED',nom:'Ancien',prenom:'Paul',user_id:null,abonnement:'premium_mensuel',abonnement_debut:'2019-01-01',abonnement_fin:'2020-01-31'};
      f.tables.clients.push(free,ended);
      f.tables.colis.find(item=>item.id===P2).client_id=free.id;f.tables.colis.find(item=>item.id===P3).client_id=ended.id;f.tables.colis.find(item=>item.id===P4).client_id=null;
      const before=structuredClone(f.tables.colis);await open(f);
      const badge=id=>row(f,id).locator('.plan-badge');
      for(const [id,letter,name] of [[P,'P','Forfait Premium annuel'],[P2,'F','Forfait Freemium'],[P3,'P','Forfait Premium mensuel terminé le 31 janvier 2020']]){
        await badge(id).waitFor();
        assert.equal((await badge(id).textContent()).trim(),letter,`${id} reads ${letter}`);
        assert.equal(await row(f,id).getByRole('img',{name,exact:true}).count(),1,`${id}: « ${name} » for screen readers and on hover`);
        assert.equal(await badge(id).getAttribute('title'),name);
      }
      await settle(f);
      for(const id of [P,P2,P3]){
        assert.ok(await badge(id).evaluate(node=>window.__pintaContrast.text(node))>=4.5,`${id}: the letter keeps 4.5:1`);
        assert.ok(await badge(id).evaluate(node=>parseFloat(getComputedStyle(node).fontSize))>=12,`${id}: the letter is never under 12px`);
      }
      // Readable without hovering: an ended Premium says so under the name, at 4.5:1.
      const endedLine=row(f,P3).locator('.dossier-table-plan-ended');
      assert.equal((await endedLine.innerText()).trim(),'Premium mensuel terminé le 31 janvier 2020');
      assert.ok(await endedLine.evaluate(node=>window.__pintaContrast.text(node))>=4.5);
      for(const id of [P,P2])assert.equal(await row(f,id).locator('.dossier-table-plan-ended').count(),0);
      // An unknown client: no offer is invented.
      assert.equal(await badge(P4).count(),0);
      assert.equal((await cell(f,P4,'client').innerText()).trim(),'Client non renseigné');
      // Before the name's first letter, on the same line.
      const [b,first]=await Promise.all([badge(P).boundingBox(),row(f,P).locator('.dossier-table-client-name').evaluate(node=>{const range=document.createRange();range.setStart(node.firstChild,0);range.setEnd(node.firstChild,1);const r=range.getBoundingClientRect();return{x:r.x,y:r.y,height:r.height};})]);
      assert.ok(b.x+b.width<=first.x+1,'The badge comes before the name.');
      assert.ok(Math.abs((b.y+b.height/2)-(first.y+first.height/2))<6,'Badge and first letter share the line.');
      // A click on the badge opens the dossier like the rest of its row: the same hand over it; a card keeps the arrow.
      const table=await row(f,P).evaluate(node=>node.tagName==='TR');
      assert.equal(await badge(P).evaluate(node=>getComputedStyle(node).cursor),table?'pointer':'default');
      if(table)assert.equal(await row(f,P).evaluate(node=>getComputedStyle(node).cursor),'pointer');
      await noPageOverflow(f);
      await f.page.screenshot({path:`${output}/client-offer-${width}-${dark?'dark':'light'}.png`});
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
        assert.equal((await cell(f,P4,'paymentState').innerText()).trim(),'Non payé','Until it is fully paid, a shipment is « Non payé ».');
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
      // P5's saved quote (transport, OM, OMR, TVA): « Transport » and « Taxes calculées » have a value for it too.
      Object.assign(f.tables.colis.find(item=>item.id===P5),{devis_snapshot:{version:1,amounts:{total:100,transport:80,om:10,omr:5,tva:5},inputs:{client:{type:'particulier'}}}});
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
      assert.equal((await cell(f,P4,'paymentState').innerText()).trim(),'Non payé');
      options=await filterColumn(f,'requested','min','90');await waitIds(f,[P4]);
      assert.equal(new URL(f.page.url()).searchParams.get('col.remaining'),JSON.stringify({mode:'min',value:'1'}));
      await f.page.reload();await row(f,P4).waitFor();await waitIds(f,[P4]);
      const data=await exportFiltered(f,1);
      assert.equal(data.length,4);assert.equal(data[1][0],'EXP-TAB004');assert.equal(data[1][data[0].indexOf('Paiement')],'Non payé');
      // Without a saved quote, its transport and taxes are « À vérifier » (never its raw transport of 80 €).
      assert.deepEqual(['Transport','Taxes calculées'].map(label=>data[1][data[0].indexOf(label)]),['À vérifier','À vérifier']);
      // The one dossier's amounts are also its total, after one empty row; its transport and taxes are « À vérifier », so is not their total.
      assert.deepEqual(data[2],[]);assert.deepEqual(['Total','Demandé','Transport','Taxes calculées','Payé','Reste à payer'].map((label,index)=>index?data[3][data[0].indexOf(label)]:data[3][0]),['Total',100,'Non renseigné','Non renseigné',30,70]);
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
      // The list measures its new width after the resize (ResizeObserver): let React commit it first.
      await f.page.waitForFunction(()=>document.querySelector('table.dossier-data-table')?.dataset.unpinRef==='true').catch(()=>{});
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
      // « Paiement » reads Payé or Non payé, and its filter takes one exact value: « Payé » never keeps « Non payé ».
      let options=await filterColumn(f,'paymentState','is','Payé');await waitIds(f,[P5,P6].sort());
      await options.getByRole('button',{name:'Fermer',exact:true}).click();await options.waitFor({state:'hidden'});
      options=await filterColumn(f,'paymentState','is','Non payé');await waitIds(f,[P,P2,P3,P4].sort());
      assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).count(),0);
      // Cards have no column width: the filter offers none (it belongs to the table).
      assert.equal(await options.getByLabel('Largeur de Paiement',{exact:true}).count(),0,'No table-only width in cards.');
      assert.equal(await options.getByRole('button',{name:'Rétablir les largeurs',exact:true}).count(),0);
      await options.getByRole('button',{name:'Fermer',exact:true}).click();await row(f,P4).waitFor();
      // The phone sheet of Filtres closes before acting on the list behind it.
      await f.page.getByRole('dialog',{name:'Filtres',exact:true}).getByRole('button',{name:'Fermer les filtres',exact:true}).click();
      // With the table chosen on the same phone, the width editor is there and fits.
      let display=await openDisplay(f);await display.getByRole('combobox',{name:'Affichage des dossiers',exact:true}).selectOption('table');await closeDisplay(f);
      options=await openColumnFilter(f,'paymentState');const width=options.getByLabel('Largeur de Paiement',{exact:true});await width.fill('300');await width.press('Enter');
      assert.equal(await width.inputValue(),'300');await options.getByRole('button',{name:'Rétablir les largeurs',exact:true}).click();
      await f.page.waitForFunction(()=>document.querySelector('[aria-label="Largeur de Paiement"]')?.value==='140');assert.equal(await width.inputValue(),'140');
      const editor=await width.boundingBox();assert.ok(editor.x>=0&&editor.x+editor.width<=390,'The width editor fits the phone.');
      await options.getByRole('button',{name:'Fermer',exact:true}).click();
      display=await openDisplay(f);await display.getByRole('combobox',{name:'Affichage des dossiers',exact:true}).selectOption('auto');await closeDisplay(f);await row(f,P4).waitFor();
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
        ['Travail quotidien','daily',['ref','client','receivedAt','statusLabel','paymentState','statut','owner','casier','cartons','optimizedDimensions','optimizedWeight','requested','transport','taxes']],
        ['Paiements','payments',['ref','client','receivedAt','statusLabel','paymentState','requested','transport','taxes','paid','remaining','sentAt']],
        ['Départs','departures',['ref','client','receivedAt','statusLabel','paymentState','departure','destination','packages','readiness','optimizedDimensions','optimizedWeight','requested','transport','taxes']],
      ]) {
        await selectPreset(f,label,view);
        const menu=(await openDisplay(f)).getByRole('combobox',{name:'Tri par défaut',exact:true});
        const available=await menu.locator('option').evaluateAll(options=>options.map(option=>option.value).filter(value=>value.startsWith('column:')));
        for(const key of keys)for(const direction of ['asc','desc']) {
          assert.ok(available.includes(`column:${key}:${direction}`));await menu.selectOption(`column:${key}:${direction}`);
          await f.page.waitForURL(url=>url.searchParams.get('sort')===key&&url.searchParams.get('dir')===direction);
        }
        await menu.selectOption('column:ref:desc');await f.page.waitForURL(url=>url.searchParams.get('sort')==='ref'&&url.searchParams.get('dir')==='desc');
        // The address changes before the cards are drawn again: read them once they follow it (CI read the previous order once).
        const descending=[P6,P5,P4,P3,P2,P];let order=await orderedIds(f);
        for(let wait=0;wait<60&&JSON.stringify(order)!==JSON.stringify(descending);wait++){await f.page.waitForTimeout(50);order=await orderedIds(f);}
        assert.deepEqual(order,descending,'Mobile cards follow the chosen descending order.');
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
      assert.match(await row(f,P).innerText(),/À choisir/);assert.doesNotMatch(await row(f,P).innerText(),/À planifier/);assert.equal(f.claims.length,0);
    });
    await scenario('restricted-permission-cannot-take-reception-visible-in-all-dossiers',async f=>{
      await open(f);assert.equal(await take(f).count(),0);await selectScope(f,'À prendre','pool');
      assert.equal(await row(f,P).count(),0);assert.equal(f.claims.length,0);
    },{restricted:true});
    await scenario('finance-preset-permissions-cannot-be-bypassed-through-the-url',async f=>{
      await open(f,'table=payments');
      // Count every element (button, tab, link or text) of the view strip, so a new widget role cannot make this pass vacuously.
      const views=f.page.locator('[aria-label="Vues du tableau"]');
      assert.deepEqual(await views.getByRole('button').allTextContents(),['Travail quotidien','Départs','Accords clients']);
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
      // Two shipped dossiers: « En vol » (the pill of « transit ») is their one valid next step.
      for(const id of [P4,P5])Object.assign(f.tables.colis.find(parcel=>parcel.id===id),{statut:'expedie',date_expedition:'2026-10-02T06:00:00Z'});
      await f.page.setViewportSize({width:390,height:844});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      await open(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
      for(const [id,ref] of [[P4,'EXP-TAB004'],[P5,'EXP-TAB005']])await row(f,id).getByRole('checkbox',{name:`Sélectionner le dossier ${ref}`,exact:true}).check();
      const bar=f.page.getByRole('group',{name:'Actions sur la sélection',exact:true});await bar.getByText('2 dossiers sélectionnés',{exact:true}).waitFor();
      const select=bar.getByRole('combobox',{name:'Changer le statut',exact:true}),apply=bar.getByRole('button',{name:'Appliquer',exact:true});
      assert.equal(await apply.isDisabled(),true,'Nothing to apply before a status is chosen.');
      const edge=await select.evaluate(node=>window.__pintaContrast.ink(node.parentElement,getComputedStyle(node).borderTopColor));assert.ok(edge>=3,`The status field keeps a 3:1 edge on the bar (${edge.toFixed(2)}).`);
      for(const control of [select,apply]){const box=await control.boundingBox();assert.ok(box.height>=44&&box.x>=0&&box.x+box.width<=391,'The picker fits the phone with 44px targets.');}
      const statusWrites=()=>f.requests.filter(request=>request.method==='PATCH'&&request.path==='/rest/v1/colis');
      // Only the valid next step is offered, in the order of the chain.
      assert.deepEqual(await select.locator('option').evaluateAll(options=>options.map(option=>option.value)),['','transit']);
      // A keystroke on the closed select (typeahead, arrows) changes its value: it must not run anything.
      await select.focus();await f.page.keyboard.press('a');await select.selectOption('transit');
      await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.deepEqual(statusWrites(),[],'Choosing a status never changes a dossier.');assert.equal(await select.inputValue(),'transit');
      // « Appliquer » asks to confirm, with the dossiers and the target status.
      await apply.click();const confirm=f.page.getByRole('dialog',{name:'Passer à « En vol »',exact:true});await confirm.waitFor();
      assert.deepEqual(await confirm.locator('[data-bulk-item] .dossier-bulk-ref').allTextContents(),['EXP-TAB004','EXP-TAB005']);
      assert.deepEqual(statusWrites(),[],'Nothing is written before the confirmation.');
      const frame=await confirm.boundingBox();assert.ok(frame.x>=0&&frame.x+frame.width<=391&&frame.y>=0&&frame.y+frame.height<=845,'The confirmation fits the phone.');
      await confirm.getByRole('button',{name:'Passer à « En vol »',exact:true}).click();
      await f.page.getByRole('dialog',{name:'Résultat du changement de statut',exact:true}).getByText('2 dossiers passés à « En vol ».',{exact:true}).waitFor();
      await bar.waitFor({state:'hidden'});
      await f.page.getByRole('dialog',{name:'Résultat du changement de statut',exact:true}).getByRole('button',{name:'Fermer',exact:true}).click();
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
    for(const [width,height] of [[390,844],[844,390]])for(const dark of [false,true])await scenario(`mobile-filters-open-as-a-sheet-whose-close-stays-in-view-${width}x${height}-${dark?'dark':'light'}`,async f=>{
      // On a phone, upright or on its side, « Filtres » rises as a sheet: its close button never leaves the screen.
      await f.page.setViewportSize({width,height});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      await open(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
      const toggle=filtersButton(f);assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await toggle.getAttribute('aria-haspopup'),'dialog');
      const sheet=f.page.getByRole('dialog',{name:'Filtres',exact:true}),close=sheet.getByRole('button',{name:'Fermer les filtres',exact:true});
      const assertCloseInView=async state=>{const box=await close.boundingBox();assert.ok(box&&box.width>=44&&box.height>=44&&box.y>=0&&box.y+box.height<=height&&box.x>=0&&box.x+box.width<=width,`${state}: the close button stays on screen (${JSON.stringify(box)}).`);};
      await toggle.click();await sheet.waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
      const frame=await sheet.boundingBox();assert.ok(frame.y>=0&&Math.abs(frame.y+frame.height-height)<=1&&frame.x<=1&&frame.width>=width-1,'The sheet rises from the bottom edge at full width.');
      await sheet.getByRole('group',{name:'Filtres des dossiers',exact:true}).waitFor();assert.equal(await sheet.getByRole('combobox').count(),4);
      await assertCloseInView('open');
      // Scrolled to its end, the heading and its close button stay in view.
      await sheet.evaluate(node=>{node.scrollTop=node.scrollHeight;});await sheet.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      await assertCloseInView('scrolled');await sheet.getByRole('button',{name:/^Voir /}).scrollIntoViewIfNeeded();
      if(height<500)assert.equal(await sheet.evaluate(node=>node.scrollHeight>node.clientHeight+1),true,'On its side the phone really needs the sheet to scroll.');
      const axe=await new AxeBuilder({page:f.page}).include('[data-testid="filters-sheet"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
      await f.page.screenshot({path:`${output}/filters-sheet-${width}x${height}-${dark?'dark':'light'}.png`});
      // Escape, the backdrop, the close button and « Voir les … dossiers » each close it and give the focus back.
      await f.page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});assert.equal(await toggle.evaluate(node=>node===document.activeElement),true,'Escape returns the focus to Filtres.');
      await toggle.click();await sheet.waitFor();await f.page.mouse.click(Math.round(width/2),8);await sheet.waitFor({state:'hidden'});assert.equal(await toggle.evaluate(node=>node===document.activeElement),true,'The backdrop closes it.');
      await toggle.click();await sheet.waitFor();await close.click();await sheet.waitFor({state:'hidden'});assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      await toggle.click();await sheet.waitFor();await sheet.getByRole('button',{name:'Voir les 6 dossiers',exact:true}).click();await sheet.waitFor({state:'hidden'});
      // Closed, the dossiers stay a tap away.
      await row(f,P2).getByRole('button',{name:'EXP-TAB002',exact:true}).click();
      await f.page.getByTestId('dossier-task-header').waitFor();assert.equal(new URL(f.page.url()).pathname,`/colis/${P2}`);
      assert.equal(f.claims.length,0);assert.deepEqual(businessWrites(f),[]);
    });
    for(const [width,height] of [[390,844],[844,390]])for(const dark of [false,true])await scenario(`phone-header-scrolls-away-and-the-search-stays-pinned-${width}x${height}-${dark?'dark':'light'}`,async f=>{
      for(let i=20;i<32;i++) f.tables.colis.push({...structuredClone(f.tables.colis[1]),id:parcelId(i),ref:`EXP-LONG${i}`});
      await f.page.setViewportSize({width,height});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      await open(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
      const page=f.page.locator('.dossier-list'),search=f.page.getByLabel('Rechercher ou scanner un colis',{exact:true}),title=f.page.getByRole('heading',{name:'Dossiers d’expédition',exact:true});
      assert.equal(await page.evaluate(node=>getComputedStyle(node).overflowY),'auto','The whole list page scrolls on a phone.');
      // On its side, « Automatique » shows cards too.
      assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).isVisible(),false);await row(f,P).waitFor();
      await page.evaluate(node=>{node.scrollTop=node.scrollHeight;});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const top=(await page.boundingBox()).y,searchBox=await search.boundingBox(),titleBox=await title.boundingBox();
      assert.ok(titleBox.y+titleBox.height<=top+1,'The title and the tabs scrolled away with the dossiers.');
      assert.ok(searchBox.y>=top-1&&searchBox.y+searchBox.height<=height,'The search stays pinned at the top.');
      assert.equal(await f.page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest('input')?.getAttribute('aria-label'),[searchBox.x+searchBox.width/2,searchBox.y+searchBox.height/2]),'Rechercher ou scanner un colis','Nothing covers the pinned search.');
      // The dossiers get most of the screen once the header is gone.
      const pinned=await f.page.locator('.dossier-toolbar-bar').boundingBox();const listArea=(top+(await page.evaluate(node=>node.clientHeight)))-(pinned.y+pinned.height);
      assert.ok(listArea>=(height<500?120:500),`The dossiers keep ${Math.round(listArea)}px of the screen.`);
      await f.page.screenshot({path:`${output}/phone-header-scrolled-${width}x${height}-${dark?'dark':'light'}.png`});
      await search.fill('EXP-LONG25');await row(f,parcelId(25)).waitFor();await noPageOverflow(f);
      const axe=await new AxeBuilder({page:f.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
      assert.deepEqual(businessWrites(f),[]);
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
      const expected={daily:['Référence','Client','Dernière réception','Statut du dossier','Paiement','Travail à faire','Qui s’en occupe','Casier','Cartons reçus','Dimensions finales','Poids final (kg)','Prix du devis','Transport','Taxes calculées'],payments:['Référence','Client','Dernière réception','Statut du dossier','Paiement','Demandé','Transport','Taxes calculées','Payé','Reste à payer','Devis envoyé le'],departures:['Référence','Client','Dernière réception','Statut du dossier','Paiement','Départ prévu','Destination','Colis à expédier','Prêt à partir ?','Dimensions finales','Poids final (kg)','Prix du devis','Transport','Taxes calculées']};
      for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures']]) {
        await selectPreset(f,label,view);
        const data=await exportFiltered(f,6);
        const visibleReferences=await rows(f).locator('[data-column="ref"] .dossier-table-reference').allTextContents();
        assert.deepEqual(data[0],expected[view]);
        // Short visible headings never leak into the export: it keeps every full column label.
        const headings=await f.page.locator('thead th[data-column-label]:not([data-column="action"])').evaluateAll(nodes=>nodes.map(node=>({label:node.dataset.columnLabel,visible:node.querySelector('.dossier-table-sort')?.textContent.trim()})));
        assert.deepEqual(headings.map(item=>item.label),expected[view],`${view}: export headers equal the full labels of the visible columns, in order.`);
        if(view==='daily')assert.ok(headings.some(item=>item.visible!==item.label),'The daily view really displays at least one short heading.');assert.deepEqual(data.slice(1,7).map(line=>line[0]),visibleReferences,'Excel follows the visible row order.');assert.equal(new Set(data.slice(1,7).map(line=>line[0])).size,6);
        // The six dossiers, one empty row, then the « Total » of the numeric columns: nothing else.
        assert.equal(data.length,9);assert.deepEqual(data[7],[]);assert.equal(data[8][0],'Total');
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
      // « Filtres »: the work filters and the column-filter entry only; inline on a
      // computer, in a sheet on a phone (its close button never leaves the screen).
      await filters.click();assert.equal(await filters.getAttribute('aria-expanded'),'true');
      const panel=f.page.getByRole('group',{name:'Filtres des dossiers',exact:true});await panel.waitFor();assert.equal(await panel.getAttribute('id'),'dossier-filters-panel');assert.equal(await filters.getAttribute('aria-controls'),'dossier-filters-panel');
      if(phone)assert.equal(await f.page.getByRole('dialog',{name:'Filtres',exact:true}).locator('#dossier-filters-panel').count(),1,'On a phone the panel is in its sheet.');
      else assert.equal(await f.page.getByRole('dialog').count(),0,'The filters panel is not modal.');
      for(const name of ['File de travail','Étape','Responsable de la tâche','Destination'])assert.equal(await panel.getByRole('combobox',{name,exact:true}).count(),1,`${name} stays in Filtres.`);
      await panel.getByRole('button',{name:'Inclure les archives',exact:true}).waitFor();
      // A work queue never lists archives, so no toggle may claim to include them.
      const queue=panel.getByRole('combobox',{name:'File de travail',exact:true});
      await queue.selectOption('preparation');await f.page.waitForURL(url=>url.searchParams.get('work')==='preparation');
      // The URL changes before React re-renders the panel: wait for the toggle to leave, then prove it is gone.
      await panel.getByRole('button',{name:/archives/i}).waitFor({state:'detached'});
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
      // Clearing every filter also folds the panel, as before the redesign (the sheet clears them from inside).
      await (phone?panel.getByRole('button',{name:'Retirer tous les filtres',exact:true}):active.getByRole('button',{name:'Retirer les filtres',exact:true})).click();
      await f.page.getByRole('button',{name:'Filtres',exact:true}).waitFor();assert.equal(await filters.locator('.dossier-toolbar-badge').count(),0);await waitIds(f,[P,P2,P3,P4,P5,P6]);await assertCount();
      await panel.waitFor({state:'hidden'});assert.equal(await filters.getAttribute('aria-expanded'),'false');
      await filters.click();await f.page.getByRole('button',{name:'Fermer les filtres',exact:true}).click();await panel.waitFor({state:'hidden'});assert.equal(await filters.getAttribute('aria-expanded'),'false');
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
      await group.selectOption('none');await f.page.waitForURL(url=>url.searchParams.get('view')==='none');assert.equal(await dialog.isVisible(),true);
      // Escape first undoes a typed size, then closes and returns focus to the trigger.
      // The list opens at 12px on a computer and 14px below 1024px.
      const defaultSize=width<1024?'14':'12';
      await size.fill('17');await size.press('Escape');assert.equal(await size.inputValue(),defaultSize);assert.equal(await dialog.isVisible(),true,'Escape in a dirty size field does not close Affichage.');
      await size.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.equal(await display.evaluate(node=>node===document.activeElement),true,'Escape returns focus to Affichage.');assert.equal(await display.getAttribute('aria-expanded'),'false');
      assert.ok([null,defaultSize].includes(await f.page.evaluate(id=>localStorage.getItem(`expedile:table-text:v1:${id}:daily`),ids.A)),'An abandoned size is never saved.');
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
    for(const width of [1440,390,320])for(const dark of [false,true])await scenario(`view-tabs-press-exactly-one-view-and-stay-visible-${width}-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width,height:width===320?568:width===390?844:1000});await f.page.emulateMedia({reducedMotion:'reduce'});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
      await open(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
      const strip=f.page.locator('[aria-label="Vues du tableau"]');assert.equal(await strip.getAttribute('role'),'group');
      // Every view is visible without scrolling the strip: on a phone the tabs wrap onto a second line.
      assert.equal(await strip.evaluate(node=>node.scrollWidth>node.clientWidth+1),false,'No view hides past the edge of the strip.');
      for(const tab of await strip.getByRole('button').all()){const t=await tab.boundingBox();assert.ok(t.x>=0&&t.x+t.width<=width&&t.height>=44,`${await tab.textContent()} is whole and touchable.`);assert.equal(await tab.evaluate(node=>node.scrollWidth>node.clientWidth+1),false);}
      if(width<=390){const rows=new Set(await strip.getByRole('button').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().top))));assert.ok(rows.size>=2,'On a phone the four views wrap onto two lines.');}
      for(const [label,value] of [['Accords clients','accords'],['Départs','departures'],['Paiements','payments'],['Travail quotidien','daily']]) {
        await selectPreset(f,label,value);await settle(f);
        const states=await strip.getByRole('button').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,pressed:button.getAttribute('aria-pressed')})));
        assert.deepEqual(states.filter(item=>item.pressed==='true').map(item=>item.text),[label],'Exactly one view is pressed, and its text is the bare label.');
        assert.ok(states.every(item=>item.pressed==='true'||item.pressed==='false'));
        const tab=strip.getByRole('button',{name:label,exact:true}),t=await tab.boundingBox(),s=await strip.boundingBox();
        assert.ok(t.x>=s.x-1&&t.x+t.width<=s.x+s.width+1,`${label}: the selected view is fully inside its strip.`);
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
      for(const [id,key,label,tone] of [[P4,'paymentState','Non payé','neutral'],[P4,'statusLabel','Paiement partiel','waiting'],[P5,'paymentState','Payé','done'],[P5,'statusLabel','Payé','done'],[P3,'statusLabel',null,'waiting'],[P,'statusLabel',null,'neutral']]) {
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
    // ── Final review (P4a) ────────────────────────────────────────────────────
    const theme = (f,dark)=>f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
    const waitTheme = (f,dark)=>f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
    const axeClean = async (f,include)=>{let builder=new AxeBuilder({page:f.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']);if(include)builder=builder.include(include);const audit=await builder.analyze();assert.deepEqual(audit.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);};
    const sizeOf = width=>({width,height:width===390?844:width===1280?800:900});
    for(const width of [1440,1280,390])for(const dark of [false,true])await scenario(`a-failed-dossier-load-shows-its-reason-and-a-retry-never-an-empty-list-${width}-${dark?'dark':'light'}`,async f=>{
      f.failColis=true;
      await f.context.route('**/rest/v1/colis?*',route=>f.failColis&&route.request().method()==='GET'?reply(route,{message:'Indisponibilité simulée'},503):route.fallback());
      await f.page.setViewportSize(sizeOf(width));await theme(f,dark);
      await f.page.goto(`${base}/colis`);await f.page.getByLabel('Rechercher ou scanner un colis',{exact:true}).waitFor();await waitTheme(f,dark);
      const region=f.page.getByRole('region',{name:'Tableau des dossiers',exact:true});
      const problem=region.getByRole('alert');await problem.waitFor();
      assert.match(await problem.innerText(),/Les dossiers n’ont pas pu être chargés\./);assert.match(await problem.innerText(),/Motif : Indisponibilité simulée/);
      // One failure, said once: the shell's banner steps aside for the list's own message.
      assert.doesNotMatch(await problem.innerText(),/Chargement impossible/);
      assert.equal(await f.page.getByRole('alert').filter({hasText:'Indisponibilité simulée'}).count(),1,'One message for one failure.');
      assert.equal(await f.page.getByRole('button',{name:'Réessayer',exact:true}).filter({visible:true}).count(),1,'One « Réessayer ».');
      // Never « 0 dossier » nor « Aucun dossier ne correspond à ces filtres »: the list is unknown.
      assert.equal(await f.page.locator('.dossier-meta-count').count(),0,'No count while the dossiers are unknown.');
      assert.equal(await f.page.getByText(/^0 dossier/).count(),0);assert.equal(await f.page.getByText(/Aucun dossier ne correspond/).count(),0);
      // The stage filter does not count unknown dossiers either.
      await f.page.getByRole('button',{name:/^Filtres/}).click();
      assert.deepEqual(await f.page.getByRole('combobox',{name:'Étape',exact:true}).locator('option').evaluateAll(options=>options.filter(option=>/\(\d+\)/.test(option.textContent)).length),0);
      await (width===390?f.page.getByRole('dialog',{name:'Filtres',exact:true}).getByRole('button',{name:'Fermer les filtres',exact:true}):f.page.getByRole('button',{name:'Fermer les filtres',exact:true})).click();
      const retry=region.getByRole('button',{name:'Réessayer',exact:true});const box=await retry.boundingBox();assert.ok(box.height>=44&&box.width>=44);
      const frame=await problem.boundingBox();assert.ok(frame.x>=15.5&&frame.x+frame.width<=sizeOf(width).width-15.5,`The message keeps its side margins (${JSON.stringify(frame)}).`);
      await axeClean(f);await f.page.screenshot({path:`${output}/load-failed-${width}-${dark?'dark':'light'}.png`});
      // The data come back: the list shows them, with their count.
      f.failColis=false;await retry.click();await row(f,P).waitFor();
      await f.page.getByRole('status').filter({hasText:/^6 dossiers$/}).waitFor();assert.equal(await region.getByRole('alert').count(),0);
      assert.deepEqual(businessWrites(f),[]);
    });
    const shipped=(f,statuses)=>{for(const [id,statut] of Object.entries(statuses))Object.assign(f.tables.colis.find(parcel=>parcel.id===id),{statut,date_expedition:'2026-10-02T06:00:00Z'});f.tables.staff_work_actions=f.tables.staff_work_actions.filter(action=>!Object.keys(statuses).includes(action.colis_id));};
    const bar=f=>f.page.getByRole('group',{name:'Actions sur la sélection',exact:true});
    const check=(f,id,ref)=>row(f,id).getByRole('checkbox',{name:`Sélectionner le dossier ${ref}`,exact:true}).check();
    const uncheck=(f,id,ref)=>row(f,id).getByRole('checkbox',{name:`Sélectionner le dossier ${ref}`,exact:true}).uncheck();
    const offeredStatuses=f=>bar(f).getByRole('group',{name:'Passer la sélection à l’étape suivante',exact:true}).getByRole('button').allTextContents().catch(()=>[]);
    for(const width of [1440,1280])for(const dark of [false,true])await scenario(`bulk-status-offers-only-the-valid-next-step-confirms-the-list-and-reports-each-refusal-${width}-${dark?'dark':'light'}`,async f=>{
      // P4, P5 shipped; P6 in transit; P2 before its departure.
      shipped(f,{[P4]:'expedie',[P5]:'expedie',[P6]:'transit'});
      // The server mirrors the transition guard, and a colleague's version conflict.
      const allowed={expedie:['transit'],transit:['dedouanement','arrive'],dedouanement:['arrive'],arrive:['livraison'],livraison:['livre']};f.refuse=null;f.patchUrls=[];
      await f.context.route('**/rest/v1/colis?*',async route=>{
        const request=route.request();if(request.method()!=='PATCH')return route.fallback();f.patchUrls.push(request.url());
        const id=new URL(request.url()).searchParams.get('id')?.replace(/^eq\./,''),parcel=f.tables.colis.find(item=>item.id===id),input=request.postDataJSON();
        if(f.refuse===id)return reply(route,{code:'P0001',message:`Transition invalide : ${parcel.statut} → ${input.statut}`},400);
        if(input.statut&&!(allowed[parcel.statut]||[]).includes(input.statut))return reply(route,{code:'P0001',message:`Transition invalide : ${parcel.statut} → ${input.statut}`},400);
        return route.fallback();
      });
      await f.page.setViewportSize(sizeOf(width));await theme(f,dark);await open(f);await waitTheme(f,dark);
      // Shipped dossiers: « En vol », and nothing else.
      await check(f,P4,'EXP-TAB004');await check(f,P5,'EXP-TAB005');await bar(f).getByText('2 dossiers sélectionnés',{exact:true}).waitFor();
      assert.deepEqual(await offeredStatuses(f),['En vol']);
      // Shipped + in transit: no common step, and the bar says why.
      await check(f,P6,'EXP-TAB006');assert.deepEqual(await offeredStatuses(f),[]);
      await bar(f).getByText('Étapes différentes : sélectionnez des dossiers au même statut pour les faire avancer ensemble.',{exact:true}).waitFor();
      // Before the departure: never a bulk status.
      await uncheck(f,P4,'EXP-TAB004');await uncheck(f,P5,'EXP-TAB005');assert.deepEqual(await offeredStatuses(f),['En dédouanement','Arrivé destination'],'In the order of the chain.');
      await check(f,P2,'EXP-TAB002');assert.deepEqual(await offeredStatuses(f),[]);
      await bar(f).getByText('Avant le départ, un dossier avance par son parcours : pas de statut groupé.',{exact:true}).waitFor();
      await bar(f).getByRole('button',{name:'Désélectionner tout',exact:true}).click();
      // Confirm first: the dossiers and the target status; cancelling writes nothing.
      await check(f,P4,'EXP-TAB004');await check(f,P5,'EXP-TAB005');
      await bar(f).getByRole('button',{name:'En vol',exact:true}).click();
      const dialog=f.page.getByRole('dialog',{name:'Passer à « En vol »',exact:true});await dialog.waitFor();
      assert.match(await dialog.innerText(),/Ces 2 dossiers passeront à « En vol » :/);
      assert.deepEqual(await dialog.locator('[data-bulk-item] .dossier-bulk-ref').allTextContents(),['EXP-TAB004','EXP-TAB005']);
      assert.equal(await dialog.getByRole('button',{name:'Annuler',exact:true}).evaluate(node=>node===document.activeElement),true,'The safe choice has the focus.');
      await axeClean(f,'[data-testid="bulk-status-dialog"]');
      await f.page.screenshot({path:`${output}/bulk-confirm-${width}-${dark?'dark':'light'}.png`});
      for(const close of ['Escape','backdrop','X','Annuler']){
        if(close!=='Escape'||await dialog.isHidden())await bar(f).getByRole('button',{name:'En vol',exact:true}).click();await dialog.waitFor();
        if(close==='Escape')await f.page.keyboard.press('Escape');else if(close==='backdrop')await f.page.mouse.click(4,4);
        else if(close==='X')await dialog.getByRole('button',{name:'Fermer sans changer le statut',exact:true}).click();else await dialog.getByRole('button',{name:'Annuler',exact:true}).click();
        await dialog.waitFor({state:'hidden'});
      }
      assert.deepEqual(f.patchUrls,[],'Closing the confirmation writes nothing.');
      // Confirmed: one write after the other, each with its version; a refusal keeps its reason.
      f.refuse=P5;const versions={[P4]:f.tables.colis.find(item=>item.id===P4).updated_at,[P5]:f.tables.colis.find(item=>item.id===P5).updated_at};
      await bar(f).getByRole('button',{name:'En vol',exact:true}).click();await dialog.waitFor();
      await dialog.getByRole('button',{name:'Passer à « En vol »',exact:true}).click();
      const result=f.page.getByRole('dialog',{name:'Résultat du changement de statut',exact:true});await result.waitFor();
      await result.getByText('1 dossier passé à « En vol » · 1 dossier non modifié, resté sélectionné.',{exact:true}).waitFor();
      assert.equal(await f.page.locator('[data-toast]').count(),0,'The dialog states the result: no toast repeats it under its backdrop.');
      assert.equal(await result.locator(`[data-bulk-item="${P4}"] .dossier-bulk-result`).innerText(),'Passé à « En vol »');
      assert.equal(await result.locator(`[data-bulk-item="${P5}"] .dossier-bulk-result`).innerText(),'Non modifié : Passage de « Expédié » à « En vol » refusé par le serveur.');
      assert.deepEqual(f.patchUrls.map(url=>{const query=new URL(url).searchParams;return [query.get('id'),query.get('updated_at')];}),[[`eq.${P4}`,`eq.${versions[P4]}`],[`eq.${P5}`,`eq.${versions[P5]}`]],'One write after the other, each with the version the person confirmed.');
      assert.deepEqual(f.requests.filter(request=>request.method==='PATCH'&&request.path==='/rest/v1/colis').map(request=>request.input),[{statut:'transit'}],'The refused write changed nothing.');
      assert.equal(f.tables.colis.find(item=>item.id===P4).statut,'transit');assert.equal(f.tables.colis.find(item=>item.id===P5).statut,'expedie');
      await axeClean(f,'[data-testid="bulk-status-dialog"]');await f.page.screenshot({path:`${output}/bulk-result-${width}-${dark?'dark':'light'}.png`});
      await result.getByRole('button',{name:'Fermer',exact:true}).click();await result.waitFor({state:'hidden'});
      // The refused dossier stays selected; the changed one is not.
      await bar(f).getByText('1 dossier sélectionné',{exact:true}).waitFor();
      assert.equal(await row(f,P5).getAttribute('data-selected'),'true');assert.equal(await row(f,P4).getAttribute('data-selected'),'false');
      assert.equal(f.claims.length,0);
    });
    await scenario('bulk-status-with-many-dossiers-scrolls-inside-its-confirmation-and-paid-dossiers-point-to-the-departure',async f=>{
      for(let i=40;i<70;i++) f.tables.colis.push({...structuredClone(f.tables.colis[4]),id:parcelId(i),ref:`EXP-SHIP${i}`,statut:'expedie',date_expedition:'2026-10-02T06:00:00Z'});
      await f.page.setViewportSize({width:1280,height:700});await open(f);
      // Paid dossiers: « Expédié » is confirmed from the departure, never a bulk write.
      await check(f,P5,'EXP-TAB005');await check(f,P6,'EXP-TAB006');
      assert.deepEqual(await offeredStatuses(f),[]);
      await bar(f).getByText('« Expédié » se confirme au chargement de leur départ.',{exact:false}).waitFor();
      await bar(f).getByRole('button',{name:'Ouvrir les départs',exact:true}).waitFor();
      await bar(f).getByRole('button',{name:'Désélectionner tout',exact:true}).click();
      await f.page.getByLabel('Rechercher ou scanner un colis',{exact:true}).fill('EXP-SHIP');await row(f,parcelId(45)).waitFor();
      await f.page.getByRole('checkbox',{name:'Sélectionner tous les dossiers affichés',exact:true}).check();
      await bar(f).getByText('30 dossiers sélectionnés',{exact:true}).waitFor();
      await bar(f).getByRole('button',{name:'En vol',exact:true}).click();
      const dialog=f.page.getByRole('dialog',{name:'Passer à « En vol »',exact:true});await dialog.waitFor();
      assert.equal(await dialog.locator('[data-bulk-item]').count(),30);
      const frame=await dialog.boundingBox();assert.ok(frame.y>=0&&frame.y+frame.height<=700,'The long confirmation fits the screen.');
      assert.equal(await dialog.evaluate(node=>node.scrollHeight>node.clientHeight+1),true,'Its list scrolls inside.');
      await dialog.evaluate(node=>{node.scrollTop=node.scrollHeight;});const close=await dialog.getByRole('button',{name:'Fermer sans changer le statut',exact:true}).boundingBox();assert.ok(close.y>=frame.y-1,'The close button stays in view.');
      await f.page.screenshot({path:`${output}/bulk-confirm-long-1280.png`});
      await f.page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.deepEqual(businessWrites(f),[]);
    });
    // Two Escape presses with no click between are not cancellable: the browser itself
    // would close the dialog. It stays while the changes are written, and the next change opens.
    for(const dark of [false,true])await scenario(`two-escapes-during-a-bulk-change-never-close-it-nor-block-the-next-one-${dark?'dark':'light'}`,async f=>{
      shipped(f,{[P4]:'expedie',[P5]:'expedie'});
      let release;const gate=new Promise(resolve=>{release=resolve;});
      await f.context.route('**/rest/v1/colis?*',async route=>{if(route.request().method()==='PATCH')await gate;return route.fallback();});
      await theme(f,dark);await open(f);await waitTheme(f,dark);
      await check(f,P4,'EXP-TAB004');await check(f,P5,'EXP-TAB005');
      await bar(f).getByRole('button',{name:'En vol',exact:true}).click();
      const dialog=f.page.getByRole('dialog',{name:'Passer à « En vol »',exact:true});await dialog.waitFor();
      await dialog.getByRole('button',{name:'Passer à « En vol »',exact:true}).click();
      await dialog.getByRole('status').filter({hasText:/^Mise à jour 1 sur 2/}).waitFor();
      await f.page.keyboard.press('Escape');await f.page.keyboard.press('Escape');
      await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await f.page.locator('#dossier-bulk-dialog').evaluate(node=>node.open),true,'The dialog stays open while the changes are written.');
      await dialog.getByRole('status').filter({hasText:/^Mise à jour/}).waitFor();
      release();
      const result=f.page.getByRole('dialog',{name:'Résultat du changement de statut',exact:true});
      await result.getByText('2 dossiers passés à « En vol ».',{exact:true}).waitFor();
      await axeClean(f,'[data-testid="bulk-status-dialog"]');
      await result.getByRole('button',{name:'Fermer',exact:true}).click();await result.waitFor({state:'hidden'});
      assert.deepEqual(f.tables.colis.filter(parcel=>[P4,P5].includes(parcel.id)).map(parcel=>parcel.statut),['transit','transit']);
      // The next bulk change opens as usual: nothing is left blocked.
      await check(f,P4,'EXP-TAB004');await check(f,P5,'EXP-TAB005');
      assert.deepEqual(await offeredStatuses(f),['En dédouanement','Arrivé destination']);
      await bar(f).getByRole('button',{name:'Arrivé destination',exact:true}).click();
      const next=f.page.getByRole('dialog',{name:'Passer à « Arrivé destination »',exact:true});await next.waitFor();
      await next.getByRole('button',{name:'Annuler',exact:true}).click();await next.waitFor({state:'hidden'});
      assert.equal(f.claims.length,0);
    });
    await scenario('bulk-status-is-not-offered-to-a-role-without-the-permission',async f=>{
      shipped(f,{[P4]:'expedie',[P5]:'expedie'});
      await open(f);await check(f,P4,'EXP-TAB004');await check(f,P5,'EXP-TAB005');await bar(f).getByText('2 dossiers sélectionnés',{exact:true}).waitFor();
      assert.equal(await bar(f).getByRole('button',{name:'En vol',exact:true}).count(),0,'No status the role cannot use, not even disabled.');
      assert.equal(await bar(f).getByRole('combobox',{name:'Changer le statut',exact:true}).count(),0);
      assert.equal(await bar(f).locator('button:disabled').count(),0);
      await bar(f).getByText('Aucune action groupée n’est ouverte à votre rôle.',{exact:true}).waitFor();
      assert.deepEqual(businessWrites(f),[]);
    },{restricted:true});
    for(const width of [1440,1280,390])await scenario(`selecting-a-row-never-moves-the-rows-${width}`,async f=>{
      await f.page.setViewportSize(sizeOf(width));await open(f);
      // The first two dossiers on screen, the first one centred so no click needs to scroll.
      const firstId=await rows(f).nth(0).evaluate(node=>node.dataset.dossierRow||node.dataset.dossierCard),secondId=await rows(f).nth(1).evaluate(node=>node.dataset.dossierRow||node.dataset.dossierCard);
      const first=row(f,firstId).locator('input[type="checkbox"]'),second=row(f,secondId).locator('input[type="checkbox"]');
      await first.evaluate(node=>node.scrollIntoView({block:'center'}));await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const before=await second.boundingBox(),rowsBefore=await rows(f).evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().top)));
      await first.check();await bar(f).waitFor();
      await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.deepEqual(await rows(f).evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().top))),rowsBefore,'Checking a row moves no row.');
      // A quick second click lands on the dossier that was under the pointer. On a phone a card is
      // taller than the space left above the bar: the same checkbox is clicked again.
      const [probe,probeId,probeBox]=width===390?[first,firstId,await first.boundingBox()]:[second,secondId,before];
      const target=await f.page.evaluate(([x,y])=>{const node=document.elementFromPoint(x,y);return node?.closest('[data-dossier-row]')?.dataset.dossierRow||node?.closest('[data-dossier-card]')?.dataset.dossierCard||null;},[probeBox.x+probeBox.width/2,probeBox.y+probeBox.height/2]);
      assert.equal(target,probeId,'The point under the checkbox is still that dossier.');
      await f.page.mouse.click(probeBox.x+probeBox.width/2,probeBox.y+probeBox.height/2);
      if(width===390){assert.equal(await probe.isChecked(),false);await bar(f).waitFor({state:'hidden'});await first.check();await second.evaluate(node=>node.scrollIntoView({block:'center'}));await second.check();}
      else assert.equal(await probe.isChecked(),true);
      await bar(f).getByText('2 dossiers sélectionnés',{exact:true}).waitFor();
      const area=await f.page.getByRole('region',{name:'Tableau des dossiers',exact:true}).boundingBox(),floating=await bar(f).boundingBox();
      assert.ok(floating.x>=0&&floating.x+floating.width<=width&&floating.y+floating.height<=sizeOf(width).height,'The bar floats inside the screen.');
      if(width>=1024)assert.ok(floating.y+floating.height<=area.y+area.height+1,'It floats over the list.');
      // The last dossier can still be scrolled clear of the bar.
      const scroller=width===390?f.page.locator('.dossier-list'):f.page.getByRole('region',{name:'Tableau des dossiers',exact:true});
      await scroller.evaluate(node=>{node.scrollTop=node.scrollHeight;});await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const last=await rows(f).last().boundingBox(),barNow=await bar(f).boundingBox();assert.ok(last.y+last.height<=barNow.y+1,`The last dossier ends above the bar (${last.y+last.height} <= ${barNow.y}).`);
      await f.page.screenshot({path:`${output}/selection-floating-${width}.png`});
      assert.deepEqual(businessWrites(f),[]);
    });
    for(const dark of [false,true])await scenario(`headers-read-whole-with-a-wide-fallback-font-in-every-tab-${dark?'dark':'light'}`,async f=>{
      await theme(f,dark);
      await f.context.addInitScript(()=>{const install=()=>{const style=document.createElement('style');style.textContent='body, body * { font-family: Verdana, "DejaVu Sans", sans-serif !important; }';document.head.appendChild(style);};if(document.head)install();else document.addEventListener('DOMContentLoaded',install);});
      for(const width of [1440,1280]){
        await f.page.setViewportSize(sizeOf(width));
        for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures'],['Accords clients','accords']]){
          await f.page.goto(`${base}/colis?table=${view}`);await rows(f).first().waitFor();await waitTheme(f,dark);
          const cut=await f.page.locator('table.dossier-data-table thead .dossier-table-heading-text').evaluateAll(nodes=>nodes.filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>`${node.textContent} ${node.scrollWidth}>${node.clientWidth}`));
          assert.deepEqual(cut,[],`${label} at ${width}px: every heading reads whole.`);
          if(view==='daily'&&width===1440)await f.page.screenshot({path:`${output}/wide-font-headers-${dark?'dark':'light'}.png`});
        }
      }
    });
    const textSize=(f,size)=>f.context.addInitScript(([id,size])=>{for(const view of ['daily','payments','departures','accords'])localStorage.setItem(`expedile:table-text:v1:${encodeURIComponent(id)}:${view}`,String(size));},[ids.A,size]);
    const TOUCH={hasTouch:true,isMobile:true};
    // Every heading reads whole in every tab: on a touch tablet at its 14 px default (the touch heading
    // shows its sort arrow and wraps between words) and at 20 px on a computer.
    for(const [label,width,size,device] of [['tablet-14px',1024,null,TOUCH],['desktop-20px',1440,20,{}]])await scenario(`headings-read-whole-${label}`,async f=>{
      if(size)await textSize(f,size);
      await f.page.setViewportSize({width,height:width===1024?768:900});
      for(const [name,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures'],['Accords clients','accords']]){
        await f.page.goto(`${base}/colis?table=${view}`);await rows(f).first().waitFor();await settle(f);
        assert.equal(await f.page.evaluate(()=>getComputedStyle(document.querySelector('.dossier-list')).getPropertyValue('--dossier-text-size').trim()),`${size||14}px`);
        const cut=await f.page.locator('table.dossier-data-table thead .dossier-table-heading-text').evaluateAll(nodes=>nodes.filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>`${node.textContent} ${node.scrollWidth}>${node.clientWidth}`));
        assert.deepEqual(cut,[],`${name}: every heading reads whole.`);
        if(view==='daily'){const head=await f.page.locator('table.dossier-data-table thead').boundingBox();await f.page.screenshot({path:`${output}/headings-${label}.png`,clip:{x:0,y:head.y,width,height:head.height}});}
      }
      if(size){
        // A column its heading holds wider than its saved width follows the pointer from the first pixel.
        await f.page.goto(`${base}/colis?table=daily`);await rows(f).first().waitFor();await settle(f);
        const owner=f.page.locator('thead th[data-column="owner"]'),grip=f.page.getByRole('separator',{name:'Redimensionner Qui s’en occupe',exact:true});
        await owner.evaluate(th=>{document.getElementById('dossier-table-scroll').scrollLeft=th.offsetLeft-400;});await settle(f);
        const drawn=(await owner.boundingBox()).width,saved=Number(await grip.getAttribute('aria-valuenow'));
        assert.ok(drawn>saved+1,`At ${size} px « Qui s’en occupe » is drawn at ${drawn} px, wider than its saved ${saved} px.`);
        const g=await grip.boundingBox(),x=g.x+g.width/2,y=g.y+g.height/2;
        await f.page.mouse.move(x,y);await f.page.mouse.down();await f.page.mouse.move(x+10,y);await f.page.mouse.move(x+20,y);await settle(f);
        assert.ok(Math.abs((await owner.boundingBox()).width-(drawn+20))<=1,'Its border follows the pointer at once.');
        await f.page.mouse.up();
      }
      assert.deepEqual(businessWrites(f),[]);
    },{device});
    // « Je m’en occupe » wraps on two lines in the 140 px Action column: room above and below its text at the
    // 14 px of a touch tablet and at 20 px, never a descender on the button's border.
    for(const [label,width,size,device] of [['tablet-14px',1024,null,TOUCH],['desktop-20px',1440,20,{}]])await scenario(`the-claim-button-keeps-room-around-its-two-lines-${label}`,async f=>{
      if(size)await textSize(f,size);
      await f.page.setViewportSize({width,height:width===1024?768:900});await open(f);
      const claim=take(f);await claim.waitFor();await settle(f);
      const m=await claim.evaluate(node=>{const style=getComputedStyle(node),r=node.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);
        const rects=[...range.getClientRects()].filter(rect=>rect.width>0&&rect.height>0);
        return{font:parseFloat(style.fontSize),lines:new Set(rects.map(rect=>Math.round(rect.top))).size,top:Math.min(...rects.map(rect=>rect.top))-r.top-parseFloat(style.borderTopWidth),
          bottom:r.bottom-parseFloat(style.borderBottomWidth)-Math.max(...rects.map(rect=>rect.bottom)),height:r.height,overflow:node.scrollHeight>node.clientHeight};});
      assert.equal(m.font,size||14);assert.equal(m.lines,2,'Two lines in the narrow column.');
      assert.ok(m.top>=4&&m.bottom>=4,`Room above and below the text (${m.top.toFixed(1)} / ${m.bottom.toFixed(1)} px).`);
      assert.equal(m.overflow,false,'Nothing overflows the button.');assert.ok(m.height>=44);
      const box=await cell(f,P,'action').boundingBox();await f.page.screenshot({path:`${output}/claim-button-${label}.png`,clip:{x:box.x-4,y:box.y-4,width:box.width+8,height:box.height+8}});
      assert.deepEqual(businessWrites(f),[]);
    },{device});
    // ── Keyboard focus is never hidden (WCAG 2.4.11) ─────────────────────────
    // Every keyboard stop through the dossiers while the selection bar floats over the list's bottom: the
    // focused control's centre is never under the bar (a 1024 × 768 tablet, a phone and its cards).
    for(const width of [1024,390])await scenario(`keyboard-focus-never-lands-under-the-selection-bar-${width}`,async f=>{
      await f.page.setViewportSize({width,height:width===390?844:768});await open(f);
      for(const [id,ref] of [[P4,'EXP-TAB004'],[P5,'EXP-TAB005'],[P,'EXP-TAB001'],[P6,'EXP-TAB006']]){const box=row(f,id).getByRole('checkbox',{name:`Sélectionner le dossier ${ref}`,exact:true});await box.scrollIntoViewIfNeeded();await box.check();}
      await bar(f).getByText('4 dossiers sélectionnés',{exact:true}).waitFor();
      await f.page.evaluate(()=>{document.getElementById('dossier-table-scroll').scrollTop=0;document.querySelector('.dossier-list').scrollTop=0;});
      await rows(f).first().locator('input[type="checkbox"]').focus();
      const under=[];let stops=0;
      for(let i=0;i<90;i++){
        await f.page.keyboard.press('Tab');
        const stop=await f.page.evaluate(()=>{const el=document.activeElement;if(!el?.closest('[data-dossier-row],[data-dossier-card]'))return null;
          const r=el.getBoundingClientRect(),b=document.querySelector('.dossier-bulk-bar').getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
          return{name:`${(el.getAttribute('aria-label')||el.innerText||'').trim().slice(0,40)} (${Math.round(y)} in ${Math.round(b.top)}–${Math.round(b.bottom)})`,under:x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom};});
        if(!stop)break;stops++;if(stop.under)under.push(stop.name);
      }
      assert.ok(stops>=40,`${stops} keyboard stops through the dossiers.`);
      assert.deepEqual(under,[],'No focused control sits under the selection bar.');
      assert.deepEqual(businessWrites(f),[]);
    },{more:14});
    // Forward through the table, then scrolled sideways and the whole way back from its last dossier: every
    // focused control shows (never entirely under the sticky heading row or a pinned column), and a control of
    // a pinned column never scrolls the table sideways, nor one of the heading row up or down.
    for(const [width,dark] of [[1440,false],[1024,true]])await scenario(`keyboard-focus-is-never-hidden-under-the-sticky-heading-or-the-pinned-columns-${width}-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width,height:width===1024?768:900});await theme(f,dark);await open(f);await waitTheme(f,dark);
      const stop=()=>f.page.evaluate(()=>{
        const scroller=document.getElementById('dossier-table-scroll'),el=document.activeElement;
        if(!el||el===scroller||!scroller.contains(el))return null;
        const r=el.getBoundingClientRect();
        const shows=[[.5,.5],[.15,.25],[.85,.25],[.15,.75],[.85,.75]].some(([px,py])=>{const x=r.left+r.width*px,y=r.top+r.height*py;if(x<0||y<0||x>=innerWidth||y>=innerHeight)return false;const top=document.elementFromPoint(x,y);return top===el||el.contains(top)||(top?.tagName==='LABEL'&&top.contains(el));});
        let pinnedX=false,pinnedY=false;
        for(let node=el;node&&node!==scroller;node=node.parentElement){const style=getComputedStyle(node);if(style.position!=='sticky')continue;if(style.left!=='auto'||style.right!=='auto')pinnedX=true;if(style.top!=='auto')pinnedY=true;}
        return{name:(el.getAttribute('aria-label')||el.innerText||'').trim().slice(0,40),shows,pinnedX,pinnedY,left:scroller.scrollLeft,top:scroller.scrollTop};
      });
      const walk=async back=>{
        const hidden=[],moved=[];let count=0,previous=await f.page.evaluate(()=>{const scroller=document.getElementById('dossier-table-scroll');return{left:scroller.scrollLeft,top:scroller.scrollTop};});
        for(let i=0;i<160;i++){
          await f.page.keyboard.press(back?'Shift+Tab':'Tab');
          const now=await stop();if(!now)break;count++;
          if(!now.shows)hidden.push(now.name);
          if(now.pinnedX&&Math.abs(now.left-previous.left)>1||now.pinnedY&&Math.abs(now.top-previous.top)>1)moved.push(`${now.name} (${Math.round(now.left-previous.left)}, ${Math.round(now.top-previous.top)})`);
          previous=now;
        }
        return{hidden,moved,count};
      };
      const scroller=f.page.getByRole('region',{name:'Tableau des dossiers',exact:true});
      await scroller.focus();let result=await walk(false);
      assert.ok(result.count>=60,`${result.count} stops forward.`);
      assert.deepEqual(result.hidden,[],'Forward: every focused control shows.');assert.deepEqual(result.moved,[],'Forward: no pinned control scrolls the table.');
      await scroller.evaluate(node=>{node.scrollTop=node.scrollHeight;node.scrollLeft=200;});await settle(f);
      await f.page.locator('tbody tr[data-dossier-row]:last-child td[data-column="action"] button').first().focus();
      result=await walk(true);
      assert.ok(result.count>=60,`${result.count} stops back.`);
      assert.deepEqual(result.hidden,[],'Back: every focused control shows.');assert.deepEqual(result.moved,[],'Back: no pinned control scrolls the table.');
      await f.page.screenshot({path:`${output}/keyboard-focus-table-${width}-${dark?'dark':'light'}.png`});
      assert.deepEqual(businessWrites(f),[]);
    },{more:14});
    // A table narrower than the list has nothing sliding under Action: its handle is on its right border, like
    // the others'. Widened until the table overflows, Action gets pinned mid-drag and the drag keeps its direction.
    await scenario('a-table-narrower-than-the-list-resizes-action-from-its-right-border-and-a-drag-keeps-its-direction',async f=>{
      await f.page.setViewportSize({width:1920,height:1000});await open(f,'table=payments');
      const head=f.page.locator('thead th[data-column="action"]'),handle=f.page.getByRole('separator',{name:'Redimensionner Action',exact:true});
      // A list 60 px wider than the table, whatever the fonts.
      const room=await f.page.evaluate(()=>{const scroller=document.getElementById('dossier-table-scroll');return{table:scroller.querySelector('table.dossier-data-table').getBoundingClientRect().width,list:scroller.clientWidth};});
      await f.page.setViewportSize({width:Math.ceil(1920-room.list+room.table+60),height:1000});
      await f.page.waitForFunction(()=>{const scroller=document.getElementById('dossier-table-scroll');return scroller.scrollWidth<=scroller.clientWidth+1&&!document.querySelector('thead th[data-column="action"]').dataset.resizeEdge;});
      const [th,grip]=await Promise.all([head.boundingBox(),handle.boundingBox()]);
      assert.ok(Math.abs(grip.x+grip.width-(th.x+th.width))<=1,'The handle sits on the right border.');
      const initial=Number(await handle.getAttribute('aria-valuenow')),y=grip.y+grip.height/2;let x=grip.x+grip.width/2;
      await f.page.mouse.move(x,y);await f.page.mouse.down();
      for(let step=0;step<5;step++){x+=20;await f.page.mouse.move(x,y);await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
      await f.page.mouse.up();
      await f.page.waitForFunction(width=>document.querySelector('[aria-label="Redimensionner Action"]').getAttribute('aria-valuenow')===String(width),initial+100);
      await f.page.waitForFunction(()=>document.querySelector('thead th[data-column="action"]').dataset.resizeEdge==='start');
      assert.deepEqual(businessWrites(f),[]);
    });
    for(const dark of [false,true])await scenario(`columns-sliding-under-the-pinned-action-are-covered-or-faded-1280-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width:1280,height:800});await theme(f,dark);await open(f);await waitTheme(f,dark);
      const scroller=f.page.getByRole('region',{name:'Tableau des dossiers',exact:true});
      const edge=()=>f.page.evaluate(()=>{const scroll=document.getElementById('dossier-table-scroll'),action=document.querySelector('thead th[data-column="action"]');const boundary=action.getBoundingClientRect().left;
        const cut=[...document.querySelectorAll('thead th[data-column]')].filter(th=>!['select','action'].includes(th.dataset.column)).map(th=>({key:th.dataset.column,rect:th.getBoundingClientRect()})).find(item=>item.rect.left<boundary-.5&&item.rect.right>boundary+.5);
        const cell=document.querySelector('tbody tr[data-dossier-row] td[data-column="action"]'),before=getComputedStyle(cell,'::before');
        return {visible:cut?Math.round(boundary-cut.rect.left):0,key:cut?.key,cover:parseFloat(getComputedStyle(scroll).getPropertyValue('--dossier-edge-cover')),width:parseFloat(before.width),content:before.content,shadow:getComputedStyle(cell).boxShadow};});
      for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Départs','departures']]){
        await selectPreset(f,label,view);await scroller.evaluate(node=>{node.scrollLeft=0;});await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const state=await edge();
        assert.notEqual(state.content,'none',`${label}: the pinned action marks the columns under it.`);assert.match(state.shadow,/rgba?\(/,`${label}: a shadow on its left edge.`);
        // A sliver is covered whole (no header-less strip, no cut word); a wider part fades out.
        if(state.visible>0&&state.visible<48)assert.ok(state.cover>=state.visible&&state.width>=state.visible,`${label}: the ${state.visible}px sliver of ${state.key} is covered (${state.cover}px).`);
        else if(state.visible>=48)assert.ok(state.cover===0&&state.width>=28,`${label}: ${state.key} fades out (${state.width}px).`);
        else assert.ok(state.width>=8,`${label}: a soft edge.`);
        await f.page.screenshot({path:`${output}/edge-${view}-1280-${dark?'dark':'light'}.png`});
        // Scrolled to the end, nothing is hidden any more.
        await scroller.evaluate(node=>{node.scrollLeft=node.scrollWidth;});await f.page.waitForFunction(()=>document.querySelector('.dossier-list-main')?.dataset.moreRight===undefined);
      }
      assert.deepEqual(businessWrites(f),[]);
    });
    for(const width of [1440,1280,768])await scenario(`cards-fill-the-width-in-columns-and-leave-out-empty-facts-${width}`,async f=>{
      await f.page.setViewportSize({width,height:900});await open(f);
      const display=await openDisplay(f);await display.getByRole('combobox',{name:'Affichage des dossiers',exact:true}).selectOption('cards');await closeDisplay(f);
      await f.page.locator(`[data-dossier-card="${P}"]`).waitFor();
      const columns=await f.page.locator('.dossier-card-list').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);
      assert.equal(columns,width===1440?3:2,`${width}px: ${columns} columns of cards.`);
      // Labels sit near their values in a card of normal width.
      const card=await f.page.locator(`[data-dossier-card="${P}"]`).boundingBox();assert.ok(card.width<=620,`A card stays readable (${Math.round(card.width)}px).`);
      // No « Poids final (kg) » before the optimisation; it shows once optimised.
      assert.equal(await f.page.locator(`[data-dossier-card="${P}"] .dossier-table-card-facts [data-column="optimizedWeight"]`).count(),0);
      assert.equal(await f.page.locator(`[data-dossier-card="${P}"] .dossier-table-card-facts [data-column="optimizedDimensions"]`).count(),0);
      assert.equal(await f.page.locator(`[data-dossier-card="${P5}"] .dossier-table-card-facts [data-column="optimizedWeight"]`).count(),1);
      for(const box of await f.page.locator('[data-dossier-card] .dossier-table-card-heading .dossier-table-checkbox').all()){const b=await box.boundingBox();assert.ok(b.width>=44&&b.height>=44,'Card checkboxes keep a 44 × 44 px target.');}
      // « Cartes » is one choice for the whole list.
      await selectPreset(f,'Départs','departures');await f.page.locator(`[data-dossier-card="${P}"]`).waitFor();assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).isVisible(),false);
      await selectPreset(f,'Accords clients','accords');await f.page.locator(`[data-dossier-card="${P}"]`).waitFor();
      await noPageOverflow(f);await axeClean(f);await f.page.screenshot({path:`${output}/cards-grid-${width}.png`});
      assert.deepEqual(businessWrites(f),[]);
    });
    for(const dark of [false,true])await scenario(`a-task-the-dossier-outgrew-is-refreshed-from-its-cell-${dark?'dark':'light'}`,async f=>{
      // A preparation task left on a paid dossier: « Le dossier a changé. Actualisez les tâches. »
      f.tables.staff_work_actions.push({id:actionId(30),colis_id:P5,kind:'preparation',state:'ready',assignee_id:null,version:1,created_at:'2026-10-01T08:00:00Z',updated_at:'2026-10-01T08:00:00Z'});
      f.tables.staff_work_actions=f.tables.staff_work_actions.filter(action=>!(action.colis_id===P5&&action.kind==='departure'));
      await theme(f,dark);await open(f);await waitTheme(f,dark);
      const cell=row(f,P5).locator('[data-column="statut"]');await cell.getByText('Le dossier a changé. Actualisez les tâches.',{exact:true}).waitFor();
      const refresh=cell.getByRole('button',{name:'Actualiser les tâches',exact:true});const box=await refresh.boundingBox();assert.ok(box.height>=44);
      await axeClean(f,`tr[data-dossier-row="${P5}"]`);
      // The server drops the outgrown task: refreshing right there clears the message, without opening the dossier.
      f.tables.staff_work_actions=f.tables.staff_work_actions.filter(action=>action.id!==actionId(30));
      const reads=f.requests.filter(request=>request.path.includes('staff_work_actions')).length;
      await refresh.click();await cell.getByText('Le dossier a changé. Actualisez les tâches.',{exact:true}).waitFor({state:'detached'});
      assert.ok(f.requests.filter(request=>request.path.includes('staff_work_actions')).length>reads,'The tasks were really reloaded.');
      assert.equal(new URL(f.page.url()).pathname,'/colis','The row did not open.');assert.equal(f.claims.length,0);assert.deepEqual(businessWrites(f),[]);
    });
    await scenario('the-sort-menu-has-no-duplicate-and-no-jargon',async f=>{
      await open(f);
      for(const [label,view] of [['Travail quotidien','daily'],['Paiements','payments'],['Accords clients','accords']]){
        await selectPreset(f,label,view);const menu=(await openDisplay(f)).getByRole('combobox',{name:'Tri par défaut',exact:true});
        const options=await menu.locator('option').evaluateAll(nodes=>nodes.map(node=>node.textContent));
        assert.equal(options.some(text=>/FIFO|'/.test(text)),false,`${label}: no jargon, typographic apostrophes (${options.join(' | ')}).`);
        const meaning=text=>text.replace(/[()·]/g,' ').replace(/\s+/g,' ').trim().toLocaleLowerCase('fr');
        assert.equal(new Set(options.map(meaning)).size,options.length,`${label}: every order appears once.`);
        assert.ok(options.includes('Plus ancien d’abord')&&options.includes('Plus récent d’abord'));
        await closeDisplay(f);
      }
    });
    for(const width of [1440,1280,390])for(const dark of [false,true])await scenario(`empty-lists-are-illustrated-and-say-what-hides-the-dossiers-${width}-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize(sizeOf(width));await theme(f,dark);await open(f);await waitTheme(f,dark);
      const region=f.page.getByRole('region',{name:'Tableau des dossiers',exact:true}),empty=region.locator('.dossier-empty');
      // A search alone names the searched text.
      await f.page.getByLabel('Rechercher ou scanner un colis',{exact:true}).fill('zzz-inconnu');
      await empty.getByText('Aucun dossier ne correspond à « zzz-inconnu ».',{exact:true}).waitFor();
      assert.equal(await empty.locator('svg').count(),1,'An illustrated empty state.');
      assert.deepEqual(await empty.getByRole('button').allTextContents(),['Effacer la recherche']);
      await axeClean(f);await f.page.screenshot({path:`${output}/empty-search-${width}-${dark?'dark':'light'}.png`});
      await empty.getByRole('button',{name:'Effacer la recherche',exact:true}).click();await row(f,P).waitFor();
      // « Mes tâches » shows in its own control only: no chip, no « Filtres 1 », one action.
      f.tables.staff_work_actions=f.tables.staff_work_actions.map(action=>({...action,assignee_id:action.assignee_id===ids.A?B:action.assignee_id}));
      await f.page.goto(`${base}/colis?tasks=mine`);await empty.getByText('Aucune tâche ne vous est attribuée dans cette sélection.',{exact:true}).waitFor();
      assert.equal(await f.page.getByRole('group',{name:'Filtres actifs',exact:true}).count(),0,'The scope is not a filter chip.');
      assert.equal(await filtersButton(f).getAttribute('aria-label'),'Filtres','Nor counted on Filtres.');
      assert.deepEqual(await empty.getByRole('button').allTextContents(),['Voir tous les dossiers'],'One action, not repeated.');
      await f.page.screenshot({path:`${output}/empty-mine-${width}-${dark?'dark':'light'}.png`});
      await empty.getByRole('button',{name:'Voir tous les dossiers',exact:true}).click();await f.page.waitForURL(url=>!url.searchParams.has('tasks'));await row(f,P).waitFor();
      assert.deepEqual(businessWrites(f),[]);
    });
    for(const dark of [false,true])await scenario(`payments-show-nothing-paid-before-a-quote-and-keep-rows-short-${dark?'dark':'light'}`,async f=>{
      await theme(f,dark);await open(f,'table=payments');await waitTheme(f,dark);
      // Nothing is due yet: no « 0,00 € » beside « À calculer ».
      assert.equal((await cell(f,P,'requested').innerText()).trim(),'À calculer');assert.equal((await cell(f,P,'paid').innerText()).trim(),'—');
      assert.match(await cell(f,P4,'paid').innerText(),/30,00/,'A recorded payment still shows.');
      // The task above the button is one line: it never makes the amounts' row tall.
      const title=row(f,P).locator('[data-column="action"] .dossier-table-action-title');
      const lines=await title.evaluate(node=>Math.round(node.getBoundingClientRect().height/parseFloat(getComputedStyle(node).lineHeight)));assert.equal(lines,1);
      assert.equal(await title.getAttribute('title'),(await title.textContent()).trim(),'Its full wording stays available.');
      await axeClean(f);assert.deepEqual(businessWrites(f),[]);
    });
    for(const width of [1440,390])await scenario(`a-group-checkbox-shows-a-partial-selection-${width}`,async f=>{
      await f.page.setViewportSize(sizeOf(width));await open(f,'view=statut');
      const group=f.page.getByRole('checkbox',{name:'Sélectionner le groupe Payé',exact:true}).filter({visible:true});await group.waitFor();
      await check(f,P5,'EXP-TAB005');
      assert.equal(await group.evaluate(node=>node.indeterminate),true,'Part of the group: a mixed checkbox.');
      assert.match(await group.ariaSnapshot(),/checked=mixed/);
      if(width===1440){const all=f.page.getByRole('checkbox',{name:'Sélectionner tous les dossiers affichés',exact:true});assert.equal(await all.evaluate(node=>node.indeterminate),true);}
      await group.click();assert.equal(await group.evaluate(node=>node.indeterminate),false);assert.equal(await group.isChecked(),true,'A click selects the whole group.');
      for(const id of [P4,P5,P6])assert.equal(await row(f,id).getAttribute('data-selected'),'true');
      // Audited with the list at rest: scrolled to clear the total pinned to its bottom, the list leaves a group
      // heading half under the pinned column headings, which axe would count as a target beside their checkbox.
      await f.page.locator('#dossier-table-scroll').evaluate(node=>{node.scrollTop=0;});
      await axeClean(f);assert.deepEqual(businessWrites(f),[]);
    });
    await scenario('touch-screens-read-at-14px-without-resize-grips-over-the-filters',async f=>{
      // A touch tablet in landscape: Chromium's touch emulation sets pointer: coarse.
      const cdp=await f.context.newCDPSession(f.page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
      await f.page.setViewportSize({width:1280,height:900});await open(f);
      assert.equal(await f.page.evaluate(()=>matchMedia('(pointer: coarse)').matches),true);
      const size=await (await openDisplay(f)).getByRole('spinbutton',{name:'Taille du texte des dossiers',exact:true}).inputValue();assert.equal(size,'14','A touch screen opens the list at 14px.');
      assert.equal(await (await openDisplay(f)).getByRole('spinbutton',{name:'Taille du texte des dossiers',exact:true}).getAttribute('min'),'11');await closeDisplay(f);
      assert.equal(await f.page.locator('.dossier-table-resize').evaluateAll(nodes=>nodes.filter(node=>getComputedStyle(node).display!=='none').length),0,'No resize grip under the fingers.');
      // Every filter in view (left of the pinned action) answers the finger across its whole target.
      const actionLeft=(await f.page.locator('thead th[data-column="action"]').boundingBox()).x;let checked=0;
      for(const filter of await f.page.locator('thead .dossier-table-filter').all()){
        const box=await filter.boundingBox();if(!box||box.x+box.width>actionLeft-1)continue;checked++;
        const hit=await filter.evaluate(node=>{const r=node.getBoundingClientRect();const points=[r.left+2,r.right-2].map(x=>document.elementFromPoint(x,r.top+r.height/2));return points.every(point=>point===node||node.contains(point));});
        assert.equal(hit,true,'The whole filter target answers the finger.');
      }
      assert.ok(checked>=4,`${checked} filters checked.`);
      // Widths stay editable from « Colonnes ».
      const display=await openDisplay(f);await display.getByRole('button',{name:'Colonnes',exact:true}).click();
      await f.page.getByRole('dialog',{name:'Colonnes affichées',exact:true}).getByRole('spinbutton',{name:'Largeur de Client',exact:true}).waitFor();
      assert.deepEqual(businessWrites(f),[]);
    });
    for(const dark of [false,true])await scenario(`a-phone-opens-the-list-at-14px-and-the-columns-dialog-of-cards-offers-no-width-${dark?'dark':'light'}`,async f=>{
      await f.page.setViewportSize({width:390,height:844});await theme(f,dark);await open(f);await waitTheme(f,dark);
      const display=await openDisplay(f);assert.equal(await display.getByRole('spinbutton',{name:'Taille du texte des dossiers',exact:true}).inputValue(),'14');
      assert.ok(await row(f,P).locator('.dossier-table-client-name').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))>=14);
      await display.getByRole('button',{name:'Colonnes',exact:true}).click();const columns=f.page.getByRole('dialog',{name:'Colonnes affichées',exact:true});await columns.waitFor();
      assert.equal(await columns.getByRole('spinbutton').count(),0,'Cards: no table-only width.');assert.equal(await columns.getByRole('button',{name:'Rétablir les largeurs',exact:true}).count(),0);
      assert.match(await columns.innerText(),/informations affichées sur chaque carte/);
      await axeClean(f,'[data-testid="column-filter-dialog"]');await f.page.screenshot({path:`${output}/columns-cards-390-${dark?'dark':'light'}.png`});
      await columns.press('Escape');assert.deepEqual(businessWrites(f),[]);
    });
    // ── Toasts over the list: never over a command, never swallowing its first click ──
    // A real message of the list: the archives cannot be read (a refused read, never retried).
    const failArchives = f => f.context.route('**/rest/v1/colis?*', route => new URL(route.request().url()).searchParams.get('archive') === 'eq.true' && route.request().method() === 'GET'
      ? reply(route, { message: 'Archives indisponibles (essai)' }, 500) : route.fallback());
    const archivesToast = f => f.page.locator('[data-toast="error"]').filter({ hasText: 'Les archives n’ont pas pu être chargées. Archives indisponibles (essai)' });
    // What the shown toast hides: each command or clickable row whose visible part (inside its
    // scrolling list) it overlaps, and whether the centre of that visible part is under it.
    const toastCover = f => f.page.evaluate(() => {
      const toast = document.querySelector('[data-toast]');
      if (!toast || getComputedStyle(toast).visibility === 'hidden') return null;
      const box = toast.getBoundingClientRect();
      const covered = [];
      for (const control of document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], tr[data-dossier-row]')) {
        if (toast.contains(control)) continue;
        const r = control.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        let part = { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight) };
        for (let parent = control.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
          const clip = parent.getBoundingClientRect();
          part = { left: Math.max(part.left, clip.left), top: Math.max(part.top, clip.top), right: Math.min(part.right, clip.right), bottom: Math.min(part.bottom, clip.bottom) };
        }
        if (part.right - part.left < 1 || part.bottom - part.top < 1) continue;
        if (part.right <= box.left || part.left >= box.right || part.bottom <= box.top || part.top >= box.bottom) continue;
        const x = (part.left + part.right) / 2, y = (part.top + part.bottom) / 2;
        toast.style.visibility = 'hidden';
        const under = document.elementFromPoint(x, y);
        toast.style.visibility = '';
        if (!under || !(control === under || control.contains(under))) continue;
        const top = document.elementFromPoint(x, y);
        covered.push({ name: (control.getAttribute('aria-label') || control.textContent).trim().replace(/\s+/g, ' ').slice(0, 40), centreHidden: Boolean(top && toast.contains(top)) });
      }
      return { placement: toast.dataset.placement, box: [box.left, box.top, box.width, box.height].map(Math.round), covered };
    });
    const toastSettled = f => f.page.locator('[data-toast]').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    for (const [width, dark, collapse] of [[1440, false, true], [1440, true, true], [1280, false, false], [768, false, false], [768, true, false]]) await scenario(`a-toast-never-hides-a-command-or-a-clickable-row-and-the-first-click-opens-the-dossier-${width}${collapse ? 'c' : ''}-${dark ? 'dark' : 'light'}`, async f => {
      await failArchives(f);
      await f.page.setViewportSize(width === 768 ? { width, height: 1024 } : sizeOf(width));await theme(f,dark);await open(f);await waitTheme(f,dark);
      if (collapse) await f.page.getByRole('button',{name:'Réduire la navigation',exact:true}).click();
      await filtersButton(f).click();
      await f.page.getByRole('button',{name:'Inclure les archives',exact:true}).click();
      await archivesToast(f).waitFor();
      // The filters close: the page changes under the toast, which moves clear of it.
      await filtersButton(f).click();
      await f.page.getByRole('group',{name:'Filtres des dossiers',exact:true}).waitFor({state:'hidden'});
      await toastSettled(f);
      // Polled: the toast moves on the frame after the page changed (slower machines included).
      const settled = state => state && state.covered.every(item => !item.centreHidden) && (!collapse || (state.placement === 'top-end' && !state.covered.length)) && (width !== 1280 || state.placement === 'rail');
      let cover;
      for (const until = Date.now() + 4000; Date.now() < until;) { cover = await toastCover(f); if (settled(cover)) break; await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve))); }
      assert.ok(cover, 'The message is shown.');
      assert.deepEqual(cover.covered.filter(item => item.centreHidden), [], `No command, nor clickable row, has its centre under the toast (${JSON.stringify(cover)}).`);
      // Desktop, navigation folded: the corner beside the heading's text (a block heading is not its text).
      if (collapse) { assert.equal(cover.placement, 'top-end'); assert.deepEqual(cover.covered, [], 'Nothing at all under the toast.'); }
      if (width === 1280) assert.equal(cover.placement, 'rail', 'The free space of the navigation column.');
      await axeClean(f);
      await f.page.screenshot({path:`${output}/toast-over-list-${width}${collapse ? 'c' : ''}-${dark?'dark':'light'}.png`});
      // The first click on the lowest visible dossier (where a toast used to sit) opens it.
      const last = await f.page.evaluate(() => {
        const nav = document.querySelector('[data-staff-bottom-nav]'), floor = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
        const list = document.querySelector('#dossier-table-scroll')?.getBoundingClientRect();
        // The total pinned to the bottom of the list covers the rows passing under it.
        const total = document.querySelector('tfoot th[scope="row"]'), pinned = total && getComputedStyle(total).position === 'sticky' && getComputedStyle(total).bottom !== 'auto' ? total.getBoundingClientRect().top : Infinity;
        const rows = [...document.querySelectorAll('tr[data-dossier-row]')].map(row => ({ id: row.dataset.dossierRow, box: row.getBoundingClientRect() }))
          .filter(row => row.box.height && row.box.top >= (list?.top || 0) && row.box.bottom <= Math.min(floor, list?.bottom || innerHeight, pinned));
        const lowest = rows[rows.length - 1];
        const ref = lowest && document.querySelector(`tr[data-dossier-row="${lowest.id}"] [data-column="client"]`)?.getBoundingClientRect();
        return lowest && { id: lowest.id, x: ref.left + ref.width / 2, y: ref.top + ref.height / 2 };
      });
      assert.ok(last, 'A whole row in view.');
      if (width === 768) await f.page.touchscreen.tap(last.x, last.y); else await f.page.mouse.click(last.x, last.y);
      await f.page.waitForURL(url => url.pathname === `/colis/${last.id}`, { timeout: 5000 });
      assert.deepEqual(businessWrites(f),[]);
    }, { more: 18, device: width === 768 ? { hasTouch: true, isMobile: true } : {} });
    // A phone: the message of an action taken in the filters sheet (a modal dialog) waits behind
    // it, never drawn under its backdrop; then, once the person scrolls the list under it, the
    // toast moves off the commands or closes, and the first tap on « Consulter » opens the dossier.
    for (const dark of [false, true]) await scenario(`a-phone-toast-waits-behind-the-filters-sheet-then-never-swallows-a-tap-after-a-scroll-390-${dark ? 'dark' : 'light'}`, async f => {
      await failArchives(f);
      await f.page.setViewportSize({width:390,height:844});await theme(f,dark);await open(f);await waitTheme(f,dark);
      await filtersButton(f).click();
      const sheet = f.page.getByTestId('filters-sheet');await sheet.waitFor();
      await sheet.getByRole('button',{name:'Inclure les archives',exact:true}).click();
      await f.page.locator('[data-toast]').waitFor({state:'attached'});
      await sheet.getByRole('button',{name:'Inclure les archives',exact:true}).waitFor();
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await f.page.locator('[data-toast]').evaluate(node => getComputedStyle(node).visibility), 'hidden', 'Behind the modal sheet: not drawn under its backdrop.');
      await f.page.screenshot({path:`${output}/toast-behind-sheet-390-${dark?'dark':'light'}.png`});
      await sheet.getByRole('button',{name:/^Voir/}).click();await sheet.waitFor({state:'hidden'});
      await archivesToast(f).waitFor();
      await toastSettled(f);
      const shown = await toastCover(f);
      assert.deepEqual(shown.covered.filter(item => item.centreHidden), [], `Shown once the sheet is closed, over no command (${JSON.stringify(shown)}).`);
      await axeClean(f);
      await f.page.screenshot({path:`${output}/toast-after-sheet-390-${dark?'dark':'light'}.png`});
      // The person scrolls the list (a wheel here, a finger on a phone) under the toast.
      const list = await f.page.locator('[data-dossier-card]:visible').first().boundingBox();
      await f.page.mouse.move(195, list.y + 40);
      for (let step = 0; step < 6; step++) { await f.page.mouse.wheel(0, 120); await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
      let after;
      for (const until = Date.now() + 4000; Date.now() < until;) { after = await toastCover(f); if (!after || after.covered.every(item => !item.centreHidden)) break; await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve))); }
      assert.ok(!after || after.covered.every(item => !item.centreHidden), `After the scroll, the toast hides no command: moved or closed (${JSON.stringify(after)}).`);
      // The « Consulter » nearest the bottom of the screen: one tap opens its dossier.
      const target = await f.page.evaluate(() => {
        const nav = document.querySelector('[data-staff-bottom-nav]').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('[data-dossier-card] [data-column="action"] button')].map(button => ({ button, box: button.getBoundingClientRect() }))
          .filter(item => item.box.height && item.box.top >= 60 && item.box.bottom <= nav.top);
        const lowest = buttons[buttons.length - 1];
        return lowest && { id: lowest.button.closest('[data-dossier-card]').dataset.dossierCard, x: lowest.box.left + lowest.box.width / 2, y: lowest.box.top + lowest.box.height / 2 };
      });
      assert.ok(target, 'A « Consulter » in view.');
      await f.page.touchscreen.tap(target.x, target.y);
      await f.page.waitForURL(url => url.pathname === `/colis/${target.id}`, { timeout: 5000 });
      assert.deepEqual(businessWrites(f),[]);
    }, { more: 18, device: { hasTouch: true, isMobile: true } });
    // The bulk result dialog states the result itself: no toast repeats it under its backdrop
    // (a click on such a toast closed the dialog and lost the per-dossier reasons).
    for (const dark of [false, true]) await scenario(`the-bulk-result-dialog-is-the-only-report-no-toast-under-it-390-${dark ? 'dark' : 'light'}`, async f => {
      shipped(f,{[P4]:'expedie',[P5]:'expedie'});
      await f.page.setViewportSize({width:390,height:844});await theme(f,dark);await open(f);await waitTheme(f,dark);
      await check(f,P4,'EXP-TAB004');await check(f,P5,'EXP-TAB005');
      await bar(f).getByRole('combobox',{name:'Changer le statut',exact:true}).selectOption('transit');
      await bar(f).getByRole('button',{name:'Appliquer',exact:true}).click();
      const dialog=f.page.getByRole('dialog',{name:'Passer à « En vol »',exact:true});await dialog.waitFor();
      await dialog.getByRole('button',{name:'Passer à « En vol »',exact:true}).click();
      const result=f.page.getByRole('dialog',{name:'Résultat du changement de statut',exact:true});
      await result.getByRole('status').filter({hasText:'2 dossiers passés à « En vol ».'}).waitFor();
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await f.page.locator('[data-toast]').count(), 0, 'No toast under the result dialog.');
      // A tap on the summary keeps the dialog and its reasons.
      const summary = await result.getByRole('status').boundingBox();
      await f.page.touchscreen.tap(summary.x + summary.width / 2, summary.y + summary.height / 2);
      assert.equal(await f.page.locator('#dossier-bulk-dialog').evaluate(node => node.open), true);
      await axeClean(f,'[data-testid="bulk-status-dialog"]');
      await f.page.screenshot({path:`${output}/bulk-result-no-toast-390-${dark?'dark':'light'}.png`});
      await result.getByRole('button',{name:'Fermer',exact:true}).click();await result.waitFor({state:'hidden'});
      assert.equal(await f.page.locator('[data-toast]').count(), 0, 'Nor once it is closed: the result was read in the dialog.');
    }, { device: { hasTouch: true, isMobile: true } });
    // ── Volumetric weight in « Dimensions finales » ───────────────────────────
    // P5: two outgoing parcels (31 × 22 × 13 cm and 19,5 × 17 × 11 cm); P4: one
    // parcel of 30 × 20 × 20 cm. The app's divisor is 5000 unless said otherwise.
    const twoParcels = f => Object.assign(f.tables.colis.find(item=>item.id===P5),{final_packages:[{dimL:31,dimW:22,dimH:13,poids:2},{dimL:19.5,dimW:17,dimH:11,poids:1}],outgoing_parcel_count:2});
    const plain = value => String(value).replace(/[\u00a0\u202f]/g,' ').trim();
    const dimensionsText = async (f,id) => plain(await cell(f,id,'optimizedDimensions').innerText());
    const businessSettings = f => f.tables.app_settings.find(item=>item.key==='business').value;
    const P5_DIMENSIONS = 'Colis 1 : 31 × 22 × 13 cm · 1,77 kg vol.\nColis 2 : 19,5 × 17 × 11 cm · 0,73 kg vol.\nTotal : 2,5 kg vol.';
    // Where the parts of each line fall in a cell or a card: numbers cut across two
    // lines, parts outside the box, and parts drawn on more than one line.
    const dimensionsLayout = (f,selector) => f.page.locator(selector).first().evaluate(box => {
      const lines = range => new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size;
      const style = getComputedStyle(box), outer = box.getBoundingClientRect();
      const left = outer.left + parseFloat(style.paddingLeft) - 1, right = outer.right - parseFloat(style.paddingRight) + 1;
      const split = [], walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const match of node.textContent.matchAll(/\d+(?:,\d+)?/g)) {
        const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
        if (lines(range) > 1) split.push(match[0]);
      }
      const parts = [...box.querySelectorAll('.dossier-table-keep')].map(part => { const range = document.createRange(); range.selectNodeContents(part); const rect = part.getBoundingClientRect(); return { text: part.textContent, lines: lines(range), outside: rect.left < left || rect.right > right }; });
      return { split, outside: parts.filter(part => part.outside).map(part => part.text), wrapped: parts.filter(part => part.lines > 1).map(part => part.text), parts: parts.length,
        volumetricContrast: Math.min(...[...box.querySelectorAll('.dossier-table-volumetric')].map(part => window.__pintaContrast.text(part))) };
    });
    await scenario('dimensions-show-the-volumetric-weight-of-each-parcel-and-their-total-in-cells-and-export',async f=>{
      twoParcels(f);const before=structuredClone(f.tables.colis);await open(f);
      for(const [label,view] of [['Travail quotidien','daily'],['Départs','departures']]){
        await selectPreset(f,label,view);
        assert.equal(await dimensionsText(f,P5),P5_DIMENSIONS,'Each parcel: L × l × h ÷ 5000, then the total of the unrounded weights.');
        assert.equal(await dimensionsText(f,P4),'30 × 20 × 20 cm · 2,4 kg vol.','One parcel keeps no « Colis 1 : » and no total.');
        assert.equal(plain(await cell(f,P5,'optimizedWeight').innerText()),'3','« Poids (kg) » keeps the real weight.');
        for(const id of [P,P2,P6])assert.equal(await dimensionsText(f,id),'','Before or after a stale preparation: still nothing.');
      }
      await selectPreset(f,'Travail quotidien','daily');
      const data=await exportFiltered(f,6),dims=data[0].indexOf('Dimensions finales');
      assert.equal(plain(data.find(record=>record[0]==='EXP-TAB005')[dims]),P5_DIMENSIONS,'The export carries the text of the cell.');
      assert.equal(plain(data.find(record=>record[0]==='EXP-TAB004')[dims]),'30 × 20 × 20 cm · 2,4 kg vol.');
      // « Contient » finds what the cell shows.
      await filterColumn(f,'optimizedDimensions','contains','2,5 kg vol');await waitIds(f,[P5]);
      await assertNoBusinessChange(f,before);
    });
    await scenario('the-volumetric-divisor-is-the-configured-one-or-the-one-of-the-saved-quote-of-these-parcels',async f=>{
      twoParcels(f);businessSettings(f).diviseurVolumetrique=6000;
      // P4's saved quote priced exactly its parcel with a divisor of 4000: that is what was billed.
      const quoted=f.tables.colis.find(item=>item.id===P4);quoted.devis_snapshot={inputs:{volumetricDivisor:4000,finalPackages:[{dimL:30,dimW:20,dimH:20,poids:3}]},amounts:{total:100}};
      await open(f);
      assert.equal(await dimensionsText(f,P5),'Colis 1 : 31 × 22 × 13 cm · 1,48 kg vol.\nColis 2 : 19,5 × 17 × 11 cm · 0,61 kg vol.\nTotal : 2,09 kg vol.','The configured divisor (6000) without a saved quote.');
      assert.equal(await dimensionsText(f,P4),'30 × 20 × 20 cm · 3 kg vol.','The saved quote’s divisor (4000) for the parcels it priced.');
      assert.match(await cell(f,P4,'optimizedDimensions').locator('.dossier-table-dimensions').getAttribute('title'),/÷ 4\s?000, diviseur du devis enregistré$/);
      // Another parcel than the quoted one: the configured divisor again.
      quoted.devis_snapshot.inputs.finalPackages=[{dimL:30,dimW:20,dimH:21,poids:3}];await f.page.reload();await row(f,P4).waitFor();
      await f.page.waitForFunction(id=>/ 2\skg vol\.$/.test(document.querySelector(`tr[data-dossier-row="${id}"] [data-column="optimizedDimensions"]`)?.innerText.trim()),P4);
      assert.equal(await dimensionsText(f,P4),'30 × 20 × 20 cm · 2 kg vol.');
      // An invalid divisor: the dimensions alone, never « NaN ».
      businessSettings(f).diviseurVolumetrique=0;await f.page.reload();await row(f,P5).waitFor();
      await f.page.waitForFunction(id=>{const node=document.querySelector(`tr[data-dossier-row="${id}"] [data-column="optimizedDimensions"]`);return Boolean(node?.innerText.trim())&&!node.innerText.includes('vol.');},P5);
      assert.equal(await dimensionsText(f,P5),'Colis 1 : 31 × 22 × 13 cm\nColis 2 : 19,5 × 17 × 11 cm');
      assert.equal(await dimensionsText(f,P4),'30 × 20 × 20 cm');
      assert.doesNotMatch(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).innerText(),/NaN|undefined|Infinity/);
      assert.deepEqual(businessWrites(f),[]);
    });
    for(const dark of [false,true])await scenario(`dimensions-break-between-their-parts-never-inside-a-number-${dark?'dark':'light'}`,async f=>{
      // Widths are checked with a wide fallback font, as the Linux CI draws them.
      await f.context.addInitScript(()=>{const install=()=>{const style=document.createElement('style');style.textContent='body, body * { font-family: Verdana, "DejaVu Sans", sans-serif !important; }';document.head.appendChild(style);};if(document.head)install();else document.addEventListener('DOMContentLoaded',install);});
      twoParcels(f);await theme(f,dark);const before=structuredClone(f.tables.colis);await open(f);await waitTheme(f,dark);
      const resize=f.page.getByRole('separator',{name:'Redimensionner Dimensions finales',exact:true});
      const size=await openDisplay(f).then(dialog=>dialog.getByRole('spinbutton',{name:'Taille du texte des dossiers',exact:true}));await closeDisplay(f);
      const selector=`tr[data-dossier-row="${P5}"] td[data-column="optimizedDimensions"]`;
      for(const text of [11,12,14,16,20])for(const width of [190,110]){
        await openDisplay(f);await size.fill(String(text));await size.press('Enter');await closeDisplay(f);
        await f.page.waitForFunction(text=>getComputedStyle(document.querySelector('.dossier-data-table')).fontSize===`${text}px`,text);
        await resize.focus();await resize.press(width===110?'Home':'Enter');
        await f.page.waitForFunction(width=>document.querySelector('[aria-label="Redimensionner Dimensions finales"]')?.getAttribute('aria-valuenow')===String(width),width);
        // Drawn at that width, or as wide as its heading needs at this text size: the narrowest
        // saved width never cuts « Dimensions » (at rest: a focused heading also shows its sort arrow).
        await resize.evaluate(node=>node.blur());
        const drawn=await f.page.locator('th[data-column="optimizedDimensions"]').evaluate(th=>{const heading=th.querySelector('.dossier-table-heading-text');return{width:Math.round(th.getBoundingClientRect().width),whole:heading.scrollWidth<=heading.clientWidth+1};});
        assert.ok(drawn.width>=width&&drawn.width<=Math.max(width,240)&&drawn.whole,`${text} px, ${width} px: drawn ${drawn.width} px with its heading whole.`);
        const layout=await dimensionsLayout(f,selector);
        assert.equal(layout.parts,8);assert.deepEqual(layout.split,[],`${text} px, ${width} px: no number is cut.`);assert.deepEqual(layout.outside,[],`${text} px, ${width} px: every part stays in its cell.`);
        // The default width keeps each part whole up to 16 px; larger text or a narrower column may break a part after a « × » or before « vol. ».
        if(width===190&&text<=16)assert.deepEqual(layout.wrapped,[],`${text} px in the default column: lines break only between their parts.`);
        assert.ok(layout.volumetricContrast>=4.5,`The volumetric weights stay readable (${layout.volumetricContrast.toFixed(2)}:1).`);
        if([12,20].includes(text))await f.page.locator(selector).screenshot({path:`${output}/dimensions-${text}px-${width}-${dark?'dark':'light'}.png`});
      }
      await resize.press('Enter');
      // Phone cards: the same lines beside a whole « Dimensions finales » label.
      await f.page.setViewportSize({width:390,height:844});const card=`[data-dossier-card="${P5}"] .dossier-table-card-facts [data-column="optimizedDimensions"]`;
      for(const text of [14,20]){
        await openDisplay(f);await size.fill(String(text));await size.press('Enter');await closeDisplay(f);
        await f.page.locator(card).waitFor();await f.page.waitForFunction(text=>getComputedStyle(document.querySelector('.dossier-table-card')).fontSize===`${text}px`,text);
        assert.equal(plain(await f.page.locator(`${card} dd`).innerText()),P5_DIMENSIONS);
        const layout=await dimensionsLayout(f,`${card} dd`);assert.deepEqual(layout.split,[]);assert.deepEqual(layout.outside,[]);
        const label=await f.page.locator(`${card} dt`).evaluate(node=>{const range=document.createRange(),text=node.firstChild;range.setStart(text,0);range.setEnd(text,'Dimensions'.length);return new Set([...range.getClientRects()].filter(rect=>rect.width>0).map(rect=>Math.round(rect.top))).size;});
        assert.equal(label,1,`${text} px: « Dimensions » is never cut.`);await noPageOverflow(f);
        // A viewport tall enough for the whole card: the list scrolls inside its own frame.
        const whole=f.page.locator(`[data-dossier-card="${P5}"]`);await f.page.setViewportSize({width:390,height:Math.max(844,Math.ceil((await whole.boundingBox()).height)+400)});
        await whole.scrollIntoViewIfNeeded();await whole.screenshot({path:`${output}/dimensions-card-${text}px-390-${dark?'dark':'light'}.png`});await f.page.setViewportSize({width:390,height:844});
      }
      await axeClean(f,`[data-dossier-card="${P5}"]`);
      await assertNoBusinessChange(f,before);
    });
  } finally {await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
