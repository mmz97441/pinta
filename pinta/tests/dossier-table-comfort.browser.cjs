/* Browser contract for final facts and individual reading comfort.
 * Every business transport is intercepted; no real notification/payment/login. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const XLSX = require('xlsx');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_TABLE_COMFORT_OUT || '/tmp/pinta-dossier-table-comfort';
const results = [];
const parcelId = n => n === 1 ? ids.P : `93000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const colleague = '94000000-1111-4111-8111-111111111111';
const viewLabels = {daily:'Travail quotidien',payments:'Paiements',departures:'Départs'};
const row = (f,n) => f.page.locator(`[data-dossier-row="${parcelId(n)}"]:visible`).first();
const cell = (f,n,key) => row(f,n).locator(`[data-column="${key}"]`);
const readonly = ['/refresh_staff_work_actions','/get_reception_dates'];
const businessWrites = f => f.requests.filter(r => ['POST','PATCH','DELETE'].includes(r.method) && r.path.startsWith('/rest/v1/') && !readonly.some(s => r.path.endsWith(s)));
const respond = (route,data) => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
async function fixture(browser,{restricted=false,readMoney=false}={}) {
 const f=await setup(browser,restricted?'preparateur':'directeur');f.page.setDefaultTimeout(10000);
 f.tables.staff_users.push({id:colleague,auth_id:colleague,nom:'Madly',role:'directeur',actif:true,staff_permissions:{}});
 if(restricted){const permissions={id:'comfort-rights',staff_id:ids.S,perm_colis_preparer:true,perm_export_colis:true,perm_finances_voir_total:readMoney,perm_finances_exporter:false};f.tables.staff_permissions=[permissions];f.tables.staff_users[0].staff_permissions=permissions;}
 f.tables.staff_work_actions=[{id:'95000000-0000-4000-8000-000000000001',colis_id:ids.P,kind:'reception',state:'ready',assignee_id:null,version:1,created_at:'2026-10-02T08:00:00Z',updated_at:'2026-10-02T08:00:00Z'}];f.tables.staff_work_preferences[0].active_mission=null;
 const original=structuredClone(f.tables.colis[0]);
 const common={...original,statut:'en_preparation',devis_total:0,devis_brouillon:true,quote_version:0,devis_snapshot:null,devis_envoye_le:null,paiement_montant:null,paiement_date:null,
  dims_par_colis:[{dimL:90,dimW:80,dimH:70,poids:90},{dimL:80,dimW:70,dimH:60,poids:80}],
  reception_dates:[{receivedAt:'2026-10-01T08:00:00Z',source:'server'},{receivedAt:'2026-10-02T08:00:00Z',source:'append_receipt'}],
  final_packages:[{dimL:30,dimW:20,dimH:10,poids:1.25},{dimL:50,dimW:40,dimH:30,poids:2.5}],outgoing_parcel_count:2,fin_l:999,fin_w:999,fin_h:999,fin_p:999,preparation_composition_version:1,final_measurements_version:1};
 const parcel=(n,extra={})=>({...structuredClone(common),id:parcelId(n),ref:`EXP-CFT00${n}`,...extra});
 f.tables.colis=[
  parcel(1,{statut:'mesure',final_packages:[],outgoing_parcel_count:1,final_measurements_version:1}),
  parcel(2),
  parcel(3,{preparation_composition_version:2,final_measurements_version:1}),
  parcel(4,{devis_total:89.5,quote_version:1,devis_brouillon:false,devis_snapshot:{amounts:{total:89.5}}}),
  parcel(5,{statut:'paye',devis_total:999.99,quote_version:1,devis_brouillon:false,devis_snapshot:{amounts:{total:120}},devis_envoye_le:'2026-10-02T08:00:00Z',paiement_montant:120,paiement_date:'2026-10-02T09:00:00Z'}),
  parcel(6,{quote_version:1,devis_total:0,devis_brouillon:false,devis_snapshot:{amounts:{total:0}}}),
 ];
 const inv=structuredClone(f.tables.factures[0]),line=structuredClone(f.tables.lignes[0]);
 f.tables.factures=f.tables.colis.map((p,i)=>({...inv,id:`comfort-invoice-${i}`,colis_id:p.id}));
 f.tables.lignes=f.tables.colis.map((p,i)=>({...line,id:`comfort-line-${i}`,colis_id:p.id,facture_id:`comfort-invoice-${i}`}));
 f.before=structuredClone(f.tables.colis);return f;
}
async function open(f,view='daily') {await f.page.goto(`${base}/colis?table=${view}`);await row(f,1).waitFor();}
// « Affichage » (modal) holds columns, layout, text size, grouping, sort and export;
// it must be closed before acting on the page behind it.
const displayDialog=f=>f.page.getByRole('dialog',{name:'Affichage',exact:true});
async function openDisplay(f){const dialog=displayDialog(f);if(!await dialog.isVisible().catch(()=>false))await f.page.getByRole('button',{name:'Affichage',exact:true}).click();await dialog.waitFor();return dialog;}
async function closeDisplay(f){const dialog=displayDialog(f);if(await dialog.isVisible().catch(()=>false)){await dialog.getByRole('button',{name:'Fermer l’affichage',exact:true}).click();await dialog.waitFor({state:'hidden'});}}
const sizeInput=async f=>(await openDisplay(f)).getByRole('spinbutton',{name:'Taille du texte des dossiers',exact:true});
const layoutSelect=async f=>(await openDisplay(f)).getByRole('combobox',{name:'Affichage des dossiers',exact:true});
async function openVisibleColumns(f){const display=await openDisplay(f);await display.getByRole('button',{name:'Colonnes',exact:true}).click();await display.waitFor({state:'hidden'});const dialog=f.page.getByRole('dialog',{name:'Colonnes affichées',exact:true});await dialog.waitFor();return dialog;}
async function openColumnChooser(f){await closeDisplay(f);const toggle=f.page.getByRole('button',{name:/^Filtres(?: · \d+)?$/});if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await f.page.getByRole('group',{name:'Filtres des dossiers',exact:true}).getByRole('button',{name:/^Filtres par colonne(?: · \d+)?$/}).click();const dialog=f.page.getByRole('dialog',{name:'Filtrer une colonne',exact:true});await dialog.waitFor();return dialog;}
async function preset(f,view) {await closeDisplay(f);const button=f.page.locator('[aria-label="Vues du tableau"]').getByRole('button',{name:viewLabels[view],exact:true});await button.click();await f.page.waitForFunction(label=>document.querySelector(`[aria-label="Vues du tableau"] button[aria-pressed="true"]`)?.textContent===label,viewLabels[view]);}
async function download(f) {
 const display=await openDisplay(f),controls=display.getByRole('button',{name:/^Exporter 6 dossiers filtrés$/});
 const pending=f.page.waitForEvent('download');await controls.click();const file=await pending;assert.equal(await file.failure(),null);await closeDisplay(f);
 const workbook=XLSX.read(await fs.readFile(await file.path()),{type:'buffer'});
 return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,defval:''});
}
async function setTextSize(f,value) {const input=await sizeInput(f);await input.fill(String(value));await input.press('Enter');await closeDisplay(f);}
async function noGlobalOverflow(f) {assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
async function noMutation(f) {assert.deepEqual(f.tables.colis,f.before);assert.deepEqual(businessWrites(f),[]);assert.equal(f.requests.some(r=>/\/(queue_message|send-email|send-telegram|payplug-create-payment)$/.test(r.path)),false);}
async function main(){
 await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true});
 async function scenario(name,run,options={}){
  if(process.env.PINTA_TABLE_COMFORT_FILTER&&!name.includes(process.env.PINTA_TABLE_COMFORT_FILTER))return;
  const f=await fixture(browser,options);
  try{await f.login();await run(f);await noMutation(f);assert.deepEqual(f.errors,[]);assert.deepEqual(f.networkDenied,[]);results.push({test:name,pass:true});}
  catch(error){process.exitCode=1;results.push({test:name,pass:false,error:error.stack});await f.page.screenshot({path:`${output}/${name}-failure.png`,fullPage:true}).catch(()=>{});await fs.writeFile(`${output}/${name}-failure.txt`,await f.page.locator('body').innerText().catch(()=>''));}
  finally{await f.context.close();console.log(JSON.stringify(results.at(-1)));}
 }
 try{

  for(const view of ['daily','departures'])await scenario(`final-dimensions-and-weight-are-certified-and-independent-${view}`,async f=>{
   await open(f,view);
   for(const n of [1,3]){assert.equal((await cell(f,n,'optimizedDimensions').innerText()).trim(),'');assert.equal((await cell(f,n,'optimizedWeight').innerText()).trim(),'');}
   const dimensions=await cell(f,2,'optimizedDimensions').innerText();assert.match(dimensions,/Colis 1 : 30 × 20 × 10 cm/);assert.match(dimensions,/Colis 2 : 50 × 40 × 30 cm/);
   assert.doesNotMatch(dimensions,/90 × 80|999/);assert.match(await cell(f,2,'optimizedWeight').innerText(),/3,75/);assert.doesNotMatch(await cell(f,2,'optimizedWeight').innerText(),/170|999/);
   const data=await download(f),weight=data[0].indexOf('Poids final (kg)'),dims=data[0].indexOf('Dimensions finales');assert.ok(weight>=0&&dims>=0);
   assert.equal(data.find(r=>r[0]==='EXP-CFT002')[weight],3.75);for(const n of [1,3]){const record=data.find(r=>r[0]===`EXP-CFT00${n}`);assert.equal(record[weight],'');assert.equal(record[dims],'');}
  });
  for(const view of ['daily','departures'])await scenario(`quote-price-preserves-zero-draft-and-paid-snapshot-${view}`,async f=>{
   await open(f,view);assert.match(await cell(f,1,'requested').innerText(),/À calculer/);assert.doesNotMatch(await cell(f,1,'requested').innerText(),/0,00/);
   assert.match(await cell(f,4,'requested').innerText(),/89,50/);assert.match(await cell(f,4,'requested').innerText(),/Brouillon/);
   assert.match(await cell(f,5,'requested').innerText(),/120,00/);assert.match(await cell(f,5,'requested').innerText(),/À revoir/);assert.doesNotMatch(await cell(f,5,'requested').innerText(),/999,99/);
   assert.match(await cell(f,6,'requested').innerText(),/0,00/);
   const data=await download(f),price=data[0].indexOf('Prix du devis');assert.ok(price>=0);
   assert.match(data.find(r=>r[0]==='EXP-CFT004')[price],/^89,50\s*€ · Brouillon$/);assert.match(data.find(r=>r[0]==='EXP-CFT005')[price],/^120,00\s*€ · À revoir$/);assert.match(data.find(r=>r[0]==='EXP-CFT006')[price],/^0,00\s*€ · Brouillon$/);assert.equal(data.find(r=>r[0]==='EXP-CFT001')[price],'À calculer');
   await preset(f,'payments');assert.doesNotMatch(await cell(f,4,'requested').innerText(),/89,50/,'A saved draft is not an amount already requested from the client.');assert.doesNotMatch(await cell(f,5,'requested').innerText(),/999,99|120,00/,'A conflicting ledger still requires checking in payment controls.');
  });
  await scenario('finance-denied-hides-price-from-cells-column-choices-filters-and-export',async f=>{
   for(const view of ['daily','departures']){
    await open(f,view);assert.equal(await f.page.locator('th[data-column="requested"]').count(),0);assert.equal(await cell(f,4,'requested').count(),0);
    let dialog=await openVisibleColumns(f);assert.ok(await dialog.getByRole('checkbox',{name:/^Afficher /}).count()>0);assert.equal(await dialog.getByLabel('Afficher Prix du devis',{exact:true}).count(),0);await dialog.press('Escape');
    dialog=await openColumnChooser(f);assert.ok(await dialog.locator('[data-column-choice]').count()>0);assert.equal(await dialog.locator('[data-column-choice="requested"]').count(),0);await dialog.press('Escape');
    const data=await download(f);assert.equal(data[0].includes('Prix du devis'),false);assert.equal(JSON.stringify(data).includes('999.99'),false);assert.equal(JSON.stringify(data).includes('89.5'),false);
   }
   await f.page.goto(`${base}/colis?table=daily&sort=requested&dir=desc&${new URLSearchParams({'col.requested':JSON.stringify({mode:'min',value:'1'})})}`);await row(f,1).waitFor();await f.page.waitForURL(url=>!url.searchParams.has('col.requested'));assert.equal(await f.page.locator('tr[data-dossier-row]').count(),6,'A forced financial filter cannot disclose or hide dossiers for a role without finance access.');
  },{restricted:true});
  await scenario('financial-read-permission-does-not-leak-prices-through-daily-or-departure-export',async f=>{
   for(const view of ['daily','departures']){await open(f,view);assert.match(await cell(f,4,'requested').innerText(),/89,50/);const data=await download(f);assert.equal(data[0].includes('Prix du devis'),false);assert.equal(JSON.stringify(data).includes('89.5'),false);}
  },{restricted:true,readMoney:true});
  await scenario('weight-and-quote-price-support-real-numeric-sort-and-filter',async f=>{
   f.tables.colis[3].final_packages=[{dimL:10,dimW:10,dimH:10,poids:12}];f.tables.colis[3].outgoing_parcel_count=1;f.before=structuredClone(f.tables.colis);await open(f);
   const weight=f.page.locator('th[data-column="optimizedWeight"]');await weight.locator('.dossier-table-sort').click();await weight.locator('..').locator('[aria-sort="ascending"]').waitFor();
   const order=await f.page.locator('tr[data-dossier-row]').evaluateAll(nodes=>nodes.map(n=>n.dataset.dossierRow));assert.ok(order.indexOf(parcelId(2))<order.indexOf(parcelId(4)));assert.deepEqual(order.slice(-2).sort(),[parcelId(1),parcelId(3)].sort());
   await weight.getByRole('button',{name:'Filtrer la colonne Poids final (kg)',exact:true}).click();const dialog=f.page.getByRole('dialog',{name:'Filtrer Poids final (kg)',exact:true});await dialog.getByLabel('Condition pour Poids final (kg)',{exact:true}).selectOption('min');await dialog.getByLabel('Filtrer : Poids final (kg)',{exact:true}).fill('10');await dialog.getByRole('button',{name:'Appliquer le filtre',exact:true}).click();
   await f.page.waitForFunction(()=>document.querySelectorAll('tr[data-dossier-row]').length===1);assert.equal(await row(f,4).count(),1);
  });
  for(const width of [1440,1280])for(const dark of [false,true])await scenario(`horizontal-controls-stay-reachable-and-synchronize-${width}-${dark?'dark':'light'}`,async f=>{
   await f.page.setViewportSize({width,height:900});await f.context.addInitScript(d=>localStorage.setItem('expedile-theme',d?'dark':'light'),dark);await open(f);
   const scroll=f.page.getByRole('region',{name:'Tableau des dossiers',exact:true}),slider=f.page.getByRole('slider',{name:'Défilement horizontal des dossiers',exact:true}),right=f.page.getByRole('button',{name:'Faire défiler les colonnes vers la droite',exact:true}),left=f.page.getByRole('button',{name:'Faire défiler les colonnes vers la gauche',exact:true});
   await slider.waitFor();await f.page.screenshot({path:`${output}/compact-initial-${width}-${dark?'dark':'light'}.png`,fullPage:true});const initial=await scroll.evaluate(n=>n.scrollLeft);assert.equal(initial,0);assert.equal(await left.isDisabled(),true);
   const controls=[slider,right,left];for(const control of controls){const b=await control.boundingBox();assert.ok(b.height>=44&&b.y>=0&&b.y+b.height<900,'Horizontal navigation remains visible and touchable above the scrolling rows.');}
   await right.click();await f.page.waitForFunction(()=>document.querySelector('[aria-label="Tableau des dossiers"]').scrollLeft>0);assert.ok(Number(await slider.inputValue())>0);
   await slider.focus();await slider.press('End');await f.page.waitForFunction(()=>{const el=document.querySelector('[aria-label="Tableau des dossiers"]');return el.scrollLeft>=el.scrollWidth-el.clientWidth-2;});assert.equal(await right.isDisabled(),true);
   await slider.press('Home');await f.page.waitForFunction(()=>document.querySelector('[aria-label="Tableau des dossiers"]').scrollLeft===0);assert.equal(await left.isDisabled(),true);
   await scroll.evaluate(n=>{n.scrollLeft=200;});await f.page.waitForFunction(()=>Number(document.querySelector('[aria-label="Défilement horizontal des dossiers"]').value)>0);
   const action=await cell(f,2,'action').boundingBox();assert.ok(action.x>=0&&action.x+action.width<=width+1);await noGlobalOverflow(f);
   await slider.focus();await slider.press('End');await f.page.setViewportSize({width,height:1000});await f.page.screenshot({path:`${output}/horizontal-${width}-${dark?'dark':'light'}.png`,fullPage:true});
  });
  await scenario('text-size-is-personal-per-view-and-preserves-width-and-column-choices',async f=>{
   await open(f);let size=await sizeInput(f);assert.equal(await size.inputValue(),'12');await size.fill('20');await size.press('Enter');await closeDisplay(f);
   const separator=f.page.getByRole('separator',{name:'Redimensionner Référence',exact:true});await separator.focus();await separator.press('Shift+ArrowRight');
   const columns=await openVisibleColumns(f);await columns.getByLabel('Afficher Client',{exact:true}).uncheck();await columns.getByRole('button',{name:'Terminer',exact:true}).click();
   await f.page.reload();await row(f,1).waitFor();size=await sizeInput(f);assert.equal(await size.inputValue(),'20');await closeDisplay(f);assert.equal(await separator.getAttribute('aria-valuenow'),'190');assert.equal(await f.page.locator('th[data-column="client"]').count(),0);
   await preset(f,'departures');size=await sizeInput(f);assert.equal(await size.inputValue(),'12');await size.fill('15');await size.press('Enter');await preset(f,'daily');size=await sizeInput(f);assert.equal(await size.inputValue(),'20');
   const stored=await f.page.evaluate(id=>({daily:localStorage.getItem(`expedile:table-text:v1:${id}:daily`),departures:localStorage.getItem(`expedile:table-text:v1:${id}:departures`)}),ids.A);assert.equal(Number(stored.daily),20);assert.equal(Number(stored.departures),15);
   await (await layoutSelect(f)).selectOption('cards');await closeDisplay(f);await f.page.getByRole('button',{name:'Se déconnecter',exact:true}).filter({visible:true}).click();await f.page.getByLabel('Email',{exact:true}).waitFor();f.tables.profiles.push({id:colleague,nom:'Madly',role:'directeur',actif:true});
   const user={id:colleague,aud:'authenticated',role:'authenticated',email:'madly@example.test',user_metadata:{},created_at:new Date().toISOString()},token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:colleague,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
   await f.context.route('**/auth/v1/token**',route=>respond(route,{access_token:token,refresh_token:'comfort-test',token_type:'bearer',expires_in:3600,user}));await f.context.route('**/auth/v1/user',route=>respond(route,user));await f.login();await open(f);assert.equal(await (await layoutSelect(f)).inputValue(),'auto','The next account does not inherit the previous account’s forced card layout.');size=await sizeInput(f);assert.equal(await size.inputValue(),'12');await size.fill('15');await size.press('Enter');await closeDisplay(f);
   assert.equal(await f.page.evaluate(id=>localStorage.getItem(`expedile:table-text:v1:${id}:daily`),ids.A),stored.daily);assert.equal(await separator.getAttribute('aria-valuenow'),'140');assert.equal(await f.page.locator('th[data-column="client"]').count(),1);
  });
  for(const width of [320,390])for(const dark of [false,true])await scenario(`large-text-cards-are-readable-and-operable-${width}-${dark?'dark':'light'}`,async f=>{
   await f.page.setViewportSize({width,height:width===1024?900:844});await f.context.addInitScript(d=>localStorage.setItem('expedile-theme',d?'dark':'light'),dark);f.tables.clients[0].nom='Exemple-NomFamilialTrèsLongSansEspace';f.tables.clients[0].prenom='Camille';await open(f);
   const size=await sizeInput(f);await size.fill('20');await size.press('Enter');await closeDisplay(f);await f.page.locator(`[data-dossier-card="${parcelId(2)}"]`).waitFor();assert.equal(await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).isVisible(),false);assert.equal(await f.page.getByRole('slider',{name:'Défilement horizontal des dossiers',exact:true}).isVisible().catch(()=>false),false);
   assert.equal(await row(f,1).locator('.dossier-table-client-name').evaluate(n=>n.scrollWidth>n.clientWidth+1),false,'A long client name must wrap inside its card rather than being clipped by the list.');
   const ref=cell(f,2,'ref').getByRole('button',{name:'EXP-CFT002',exact:true});assert.ok(await ref.evaluate(n=>parseFloat(getComputedStyle(n).fontSize))>=20,'The reading preference changes the actual dossier text.');
   const primary=cell(f,1,'action').getByRole('button',{name:'Je m’en occupe',exact:true});await primary.scrollIntoViewIfNeeded();const b=await primary.boundingBox();assert.ok(b.width>=44&&b.height>=44);assert.ok(b.x>=0&&b.x+b.width<=width+1);
   assert.equal(await primary.evaluate(n=>n.scrollWidth>n.clientWidth+1),false,'Taking a task remains readable at the largest dossier text size.');await primary.focus();assert.equal(await primary.evaluate(n=>n===document.activeElement),true);await noGlobalOverflow(f);
   const audit=await new AxeBuilder({page:f.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
   await f.page.screenshot({path:`${output}/large-text-${width}-${dark?'dark':'light'}.png`,fullPage:true});
  });

  await scenario('text-size-free-input-accepts-intermediate-digits-and-bounds-with-readable-controls',async f=>{
   await open(f);const display=await openDisplay(f),input=display.getByRole('spinbutton',{name:'Taille du texte des dossiers',exact:true}),smaller=display.getByRole('button',{name:'Réduire le texte des dossiers',exact:true}),larger=display.getByRole('button',{name:'Agrandir le texte des dossiers',exact:true});
   // Never under 11px: a smaller size is not readable.
   assert.equal(await input.getAttribute('min'),'11');assert.equal(await input.getAttribute('max'),'20');assert.equal(await input.inputValue(),'12');
   const name=row(f,1).locator('.dossier-table-client-name');const font=()=>name.evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert.equal(await font(),12);
   await input.fill('');await input.pressSequentially('1');assert.equal(await input.inputValue(),'1');assert.equal(await font(),12,'Typing the first digit does not save or clamp an incomplete preference.');await input.pressSequentially('3');await input.press('Enter');assert.equal(await input.inputValue(),'13');assert.equal(await font(),13);
   await input.fill('17');await input.press('Escape');assert.equal(await input.inputValue(),'13');assert.equal(await font(),13);assert.equal(await display.isVisible(),true,'Escape undoes the typed size without closing Affichage.');await input.fill('');await input.press('Tab');assert.equal(await input.inputValue(),'13');
   await input.fill('2');await input.press('Enter');assert.equal(await input.inputValue(),'11');assert.equal(await smaller.isDisabled(),true);assert.equal(await font(),11);
   for(const control of [input,smaller,larger]){const b=await control.boundingBox();assert.ok(b.width>=44&&b.height>=44);assert.ok(await control.evaluate(n=>parseFloat(getComputedStyle(n).fontSize))>=12,'Tiny dossier text does not shrink its own controls.');}
   const action=cell(f,1,'action').getByRole('button',{name:'Je m’en occupe',exact:true});assert.ok((await action.boundingBox()).height>=44);await f.page.screenshot({path:`${output}/compact-text-11.png`,fullPage:true});await larger.click();await f.page.waitForFunction(()=>document.querySelector('[aria-label="Taille du texte des dossiers"]').value==='12');assert.equal(await input.inputValue(),'12');assert.equal(await font(),12);await smaller.click();await f.page.waitForFunction(()=>document.querySelector('[aria-label="Taille du texte des dossiers"]').value==='11');assert.equal(await input.inputValue(),'11');assert.equal(await font(),11);
   await input.fill('99');await input.press('Enter');assert.equal(await input.inputValue(),'20');assert.equal(await larger.isDisabled(),true);assert.equal(await font(),20);assert.equal(await display.isVisible(),true,'Every size change keeps Affichage open.');await noGlobalOverflow(f);await f.page.screenshot({path:`${output}/compact-text-20.png`,fullPage:true});
  });
  await scenario('every-column-width-is-editable-directly-without-opening-a-filter',async f=>{
   await open(f);const table=f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true});
   const descriptors=await table.locator('thead th[data-column]').evaluateAll(nodes=>nodes.filter(n=>n.dataset.column!=='select').map(n=>({key:n.dataset.column,label:n.querySelector('[role="separator"]')?.getAttribute('aria-label').replace('Redimensionner ','')})));
   const dialog=await openVisibleColumns(f);
   const expected={};for(const {key,label} of descriptors){const input=dialog.getByRole('spinbutton',{name:`Largeur de ${label}`,exact:true});await input.scrollIntoViewIfNeeded();const initial=Number(await input.inputValue());expected[key]=initial+10;await input.fill(String(initial+10));await input.press('Enter');assert.equal(Number(await input.inputValue()),initial+10);assert.ok((await input.boundingBox()).height>=44);}
   await dialog.getByRole('button',{name:'Terminer',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await f.page.getByRole('dialog',{name:/^Filtrer /}).count(),0);
   for(const {key,label} of descriptors){const grip=table.getByRole('separator',{name:`Redimensionner ${label}`,exact:true});assert.equal(Number(await grip.getAttribute('aria-valuenow')),expected[key]);assert.ok(Math.abs((await table.locator(`th[data-column="${key}"]`).boundingBox()).width-expected[key])<=2);await grip.focus();await grip.press('ArrowRight');expected[key]+=10;await grip.evaluate((node,value)=>new Promise(resolve=>{const check=()=>Number(node.getAttribute('aria-valuenow'))===value?resolve():requestAnimationFrame(check);check();}),expected[key]);for(const other of descriptors)assert.equal(Number(await table.getByRole('separator',{name:`Redimensionner ${other.label}`,exact:true}).getAttribute('aria-valuenow')),expected[other.key],'Changing a grip alters only its own column.');}
   await f.page.reload();await row(f,1).waitFor();for(const {key,label} of descriptors)assert.equal(Number(await table.getByRole('separator',{name:`Redimensionner ${label}`,exact:true}).getAttribute('aria-valuenow')),expected[key]);
   await noGlobalOverflow(f);await f.page.setViewportSize({width:390,height:844});await openVisibleColumns(f);const clientWidth=dialog.getByRole('spinbutton',{name:'Largeur de Client',exact:true});
   // Cards on the phone: widths belong to the table, none is offered.
   assert.equal(await dialog.getByRole('spinbutton').count(),0,'No table-only width in cards.');await dialog.press('Escape');
   await (await layoutSelect(f)).selectOption('table');await closeDisplay(f);
   await openVisibleColumns(f);await clientWidth.scrollIntoViewIfNeeded();const box=await clientWidth.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844);await f.page.screenshot({path:`${output}/compact-width-options-390.png`,fullPage:true});await dialog.press('Escape');
   await (await layoutSelect(f)).selectOption('auto');await closeDisplay(f);await noGlobalOverflow(f);
  });
  for(const width of [768,1024])await scenario(`responsive-tablet-layout-and-explicit-cards-${width}`,async f=>{
   await f.page.setViewportSize({width,height:900});await open(f);let layout=await layoutSelect(f);const table=f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true});assert.equal(await layout.inputValue(),'auto');await table.waitFor();
   await layout.selectOption('cards');await f.page.locator(`[data-dossier-card="${parcelId(1)}"]`).waitFor();assert.equal(await table.isVisible(),false);assert.equal(await displayDialog(f).isVisible(),true,'Choosing a layout keeps Affichage open.');
   await f.page.reload();await row(f,1).waitFor();layout=await layoutSelect(f);assert.equal(await layout.inputValue(),'cards');
   // One choice for the whole list: « Départs » and « Accords clients » show cards too.
   await preset(f,'departures');layout=await layoutSelect(f);assert.equal(await layout.inputValue(),'cards','Cards in Travail quotidien are cards in Départs.');assert.equal(await table.isVisible(),false);await f.page.locator(`[data-dossier-card="${parcelId(1)}"]`).waitFor();
   await preset(f,'daily');layout=await layoutSelect(f);assert.equal(await layout.inputValue(),'cards');
   await layout.selectOption('auto');await table.waitFor();await closeDisplay(f);await noGlobalOverflow(f);
  });
  for(const width of [320,390])for(const dark of [false,true])await scenario(`phone-can-explicitly-use-the-table-without-pinned-overlays-${width}-${dark?'dark':'light'}`,async f=>{
   await f.page.setViewportSize({width,height:844});await f.context.addInitScript(d=>localStorage.setItem('expedile-theme',d?'dark':'light'),dark);await open(f);await (await layoutSelect(f)).selectOption('table');await closeDisplay(f);const table=f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true});await table.waitFor();
   const slider=f.page.getByRole('slider',{name:'Défilement horizontal des dossiers',exact:true});await slider.waitFor();const ref=cell(f,1,'ref'),client=cell(f,1,'client'),action=cell(f,1,'action');
   for(const target of [ref,client,action])assert.notEqual(await target.evaluate(n=>getComputedStyle(n).position),'sticky','On a phone a fixed identity or action must not obscure the data area.');
   await slider.focus();await slider.press('End');const command=action.getByRole('button',{name:'Je m’en occupe',exact:true});await command.scrollIntoViewIfNeeded();const b=await command.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+1);assert.ok(b.height>=44);await noGlobalOverflow(f);
   await f.page.screenshot({path:`${output}/forced-table-${width}-${dark?'dark':'light'}.png`,fullPage:true});await f.page.reload();await table.waitFor();assert.equal(await (await layoutSelect(f)).inputValue(),'table');
  });
  await scenario('large-text-and-wide-columns-keep-scroll-controls-and-action-accessible',async f=>{
   await f.page.setViewportSize({width:1280,height:900});await open(f);await setTextSize(f,20);
   for(const label of ['Référence','Client','Travail à faire']){const resize=f.page.getByRole('separator',{name:`Redimensionner ${label}`,exact:true});await resize.focus();await resize.press('End');}
   const narrow=f.page.getByRole('separator',{name:'Redimensionner Poids final (kg)',exact:true});await narrow.focus();await narrow.press('Home');
   const actionWidth=f.page.getByRole('separator',{name:'Redimensionner Action',exact:true});await actionWidth.focus();await actionWidth.press('Home');await f.page.waitForFunction(()=>document.querySelector('[aria-label="Redimensionner Action"]').getAttribute('aria-valuenow')==='132');
   const filters=f.page.locator('.dossier-table-filter');assert.ok(await filters.count()>0);for(const button of await filters.all()){assert.match(await button.getAttribute('aria-label'),/^Filtrer la colonne /);assert.equal(await button.evaluate(n=>n.scrollWidth>n.clientWidth+1),false,'A narrow column keeps a named filter command instead of a clipped word.');}
   const slider=f.page.getByRole('slider',{name:'Défilement horizontal des dossiers',exact:true});await slider.focus();await slider.press('End');await noGlobalOverflow(f);const action=await cell(f,2,'action').boundingBox();assert.ok(action.x>=0&&action.x+action.width<=1281);
   const consult=cell(f,2,'action').getByRole('button',{name:'Consulter',exact:true});const fontChecks=[];
   for(const family of ['', 'Arial, sans-serif', '"DejaVu Sans", sans-serif', 'monospace']){
    const word=await consult.evaluate((button,family)=>{
     button.style.fontFamily=family;
     const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);let node;
     while((node=walker.nextNode())){
      const start=node.textContent.indexOf('Consulter');if(start<0)continue;
      const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+'Consulter'.length);
      const lines=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0),outer=button.getBoundingClientRect(),style=getComputedStyle(button);
      return {lines:lines.length,contained:lines.every(r=>r.left>=outer.left&&r.right<=outer.right+1),font:parseFloat(style.fontSize),family:style.fontFamily,height:outer.height,textWidth:range.getBoundingClientRect().width,buttonWidth:outer.width};
     }return null;
    },family);
    assert.ok(word,'The consultation button keeps its full visible label.');
    assert.equal(word.lines,1,`Consulter stays a whole word at 20 px in a 132 px Action column (${family||'application font'}).`);
    assert.equal(word.contained,true,`Consulter stays inside its button with ${family||'the application font'}.`);
    assert.equal(word.font,20);assert.ok(word.height>=44);fontChecks.push(word);
   }
   await consult.evaluate(button=>button.style.removeProperty('font-family'));
   await fs.writeFile(`${output}/action-font-checks.json`,JSON.stringify({columnWidth:132,fontSize:20,checks:fontChecks},null,2));
   await f.page.screenshot({path:`${output}/compact-wide-columns-20.png`,fullPage:true});
   // A 1280px screen at 125% browser zoom has a 1024 CSS-pixel viewport.
   await f.page.setViewportSize({width:1024,height:720});await f.page.getByRole('table',{name:'Dossiers d’expédition',exact:true}).waitFor();await noGlobalOverflow(f);assert.equal(await (await sizeInput(f)).inputValue(),'20');
  });
 }finally{await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
