/* Real browser, fixture-only APIs: no provider message, payment or production data. */
const AxeBuilder = require('@axe-core/playwright').default;
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setup, ids, base } = require('./browser-regression.cjs');
const output = process.env.PINTA_PREPARATION_OUT || path.resolve(__dirname, '../../docs/verification-organisation-preparation-client-2026-09-12');
const results=[];
async function navigate(page, destination) { await page.evaluate(to => { window.history.pushState({},'',to); window.dispatchEvent(new PopStateEvent('popstate')); },destination); }
async function editPreparation(f) { const edit=f.page.getByRole('button',{name:'Modifier les mesures',exact:true}); if(await edit.isVisible()) await edit.click(); await f.page.getByRole('button',{name:'Enregistrer les mesures de préparation',exact:true}).waitFor(); }
async function ready(f) { await f.login(); await f.page.goto(`${base}/colis/${ids.P}?section=preparation`); await f.page.getByTestId('dossier-task-workspace').waitFor(); await editPreparation(f); }
async function chooseSection(f, name) { await f.page.getByLabel('Tâche du dossier',{exact:true}).selectOption(name); }
async function staffFixture(browser) {
 const f=await setup(browser,'directeur'); const c=f.tables.colis[0]; c.preparation_composition_version=0;c.final_measurements_version=0;c.final_packages=[{dimL:30,dimW:20,dimH:20,poids:3}]; c.outgoing_parcel_count=1;
 await f.context.route('**/rest/v1/rpc/save_preparation_measurements',async route=>{
  const input=route.request().postDataJSON(); f.requests.push({path:'/rest/v1/rpc/save_preparation_measurements',input});
  if(input.p_expected_updated_at !== c.updated_at || input.p_expected_composition_version !== c.preparation_composition_version) return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Le dossier ou ses cartons ont changé. Reprenez la version enregistrée.',code:'40001'})});
  c.final_packages=input.p_final_packages.map(box=>Object.fromEntries(Object.entries(box).map(([key,value])=>[key,Number(value)])));
  Object.assign(c,{fin_l:Math.max(...c.final_packages.map(b=>b.dimL)),fin_w:Math.max(...c.final_packages.map(b=>b.dimW)),fin_h:Math.max(...c.final_packages.map(b=>b.dimH)),fin_p:c.final_packages.reduce((sum,b)=>sum+b.poids,0),outgoing_parcel_count:c.final_packages.length,final_measurements_version:c.preparation_composition_version,final_measurements_at:new Date().toISOString(),updated_at:new Date().toISOString(),devis_total:null,devis_brouillon:true});
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({colis:c})});
 });return f;
}
(async()=>{
 const browser=await chromium.launch({headless:true});await fs.mkdir(output,{recursive:true});let f;
 try{
  f=await staffFixture(browser);f.tables.factures=[];f.tables.lignes=[];await ready(f);
  await f.page.getByLabel('Poids réel · colis sortant 1 (kg)',{exact:true}).fill('4');
  await f.page.getByRole('button',{name:'Enregistrer les mesures de préparation',exact:true}).click();
  await f.page.getByRole('region',{name:'Relais après préparation',exact:true}).waitFor();
  assert.equal(f.tables.colis[0].fin_p,4);assert.equal(f.requests.filter(r=>r.path.endsWith('/save_quote')).length,0);
  await chooseSection(f,'devis');
  assert.equal(await f.page.getByRole('button',{name:'Enregistrer et vérifier le devis',exact:true}).isDisabled(),true);
  await chooseSection(f,'preparation');
  await f.page.reload();await f.page.getByTestId('dossier-task-workspace').waitFor();await editPreparation(f);await f.page.getByLabel('Poids réel · colis sortant 1 (kg)',{exact:true}).waitFor();assert.equal(await f.page.getByLabel('Poids réel · colis sortant 1 (kg)',{exact:true}).inputValue(),'4');
  results.push({test:'measure-only save persists without documents and cannot publish an incomplete quote',pass:true});
  // A local draft retains the exact original version when another person changes the record.
  await f.page.getByLabel('Poids réel · colis sortant 1 (kg)',{exact:true}).fill('5');
  await navigate(f.page,'/');await f.page.getByRole('heading',{name:'Mon travail',exact:true}).waitFor();
  f.tables.colis[0].updated_at=new Date(Date.parse(f.tables.colis[0].updated_at)+60000).toISOString();f.tables.colis[0].final_packages[0].poids=9;f.tables.colis[0].fin_p=9;
  await navigate(f.page,`/colis/${ids.P}?section=preparation`);await f.page.getByRole('button',{name:'Recharger et remplacer mon brouillon'}).waitFor();
  assert.equal(await f.page.getByLabel('Poids réel · colis sortant 1 (kg)',{exact:true}).inputValue(),'5');
  assert.equal(await f.page.getByRole('button',{name:'Enregistrer les mesures de préparation',exact:true}).isDisabled(),true);
  await f.page.getByRole('button',{name:'Recharger et remplacer mon brouillon'}).click();await editPreparation(f);assert.equal(await f.page.getByLabel('Poids réel · colis sortant 1 (kg)',{exact:true}).inputValue(),'9');
  results.push({test:'draft survives SPA navigation and detects a colleague version without overwriting it',pass:true});
  assert.deepEqual(f.errors,[]);await f.context.close();
  f=await staffFixture(browser);await ready(f);
  await f.page.getByRole('button',{name:'+ Ajouter un colis après optimisation',exact:true}).click();
  for(const [label,value] of [['Longueur','10'],['Largeur','40'],['Hauteur','10'],['Poids réel','1']]) await f.page.getByLabel(`${label} · colis sortant 2 (${label==='Poids réel'?'kg':'cm'})`,{exact:true}).fill(value);
  await f.page.getByRole('button',{name:'Enregistrer les mesures de préparation',exact:true}).click();await f.page.getByRole('region',{name:'Relais après préparation',exact:true}).waitFor();
  assert.equal(f.tables.colis[0].outgoing_parcel_count,2);
  await chooseSection(f,'devis');
  await f.page.getByRole('button',{name:'Enregistrer et vérifier le devis',exact:true}).click();await f.page.getByRole('button',{name:'Envoyer le devis au client',exact:true}).waitFor();
  const saved=f.requests.find(r=>r.path.endsWith('/save_quote'));assert.equal(saved.input.p_snapshot.inputs.finalPackages.length,2);assert.equal(saved.input.p_snapshot.amounts.volumetricWeight,3.2);assert.equal(saved.input.p_snapshot.amounts.billableWeight,4);
  results.push({test:'two optimised physical parcels save once and prepare a publishable quote with summed volumes',pass:true});
  await chooseSection(f,'preparation');
  for(const theme of ['light','dark']) for(const width of [1440,390]){await f.page.evaluate(value=>document.documentElement.classList.toggle('dark',value==='dark'),theme);await f.page.setViewportSize({width,height:1000});await f.page.screenshot({path:path.join(output,`preparation-${theme}-${width}.png`),fullPage:true,animations:'disabled'});assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
   const axe=await new AxeBuilder({page:f.page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze(); results.push({test:`preparation accessibility ${theme} ${width}`,pass:axe.violations.length===0,violations:axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))});
  }
  results.push({test:'preparation desktop and mobile have no horizontal overflow',pass:true});assert.deepEqual(f.errors,[]);await f.context.close();
  f=await staffFixture(browser);const paid=f.tables.colis[0];Object.assign(paid,{statut:'paye',paiement_date:'2026-09-10T09:00:00Z',paiement_montant:68.50,devis_total:68.50,devis_brouillon:false,devis_snapshot:{inputs:{destination:{code:'974'}}},envoi_id:'old'});f.tables.clients[0].cp='97600';
  f.tables.envois=[{id:'good',ref:'Good',date_depart:'2099-09-12',statut:'planifie',destination_code:'974'},{id:'old',ref:'Old',date_depart:'2000-09-12',statut:'planifie',destination_code:'974'},{id:'arrived',date_depart:'2099-09-12',statut:'arrive',destination_code:'974'},{id:'other-destination',date_depart:'2099-09-12',statut:'planifie',destination_code:'976'},{id:'closed',date_depart:'2099-09-12',statut:'planifie',destination_code:'974',loading_closes_at:'2000-09-12T00:00:00Z'}];
  let assignment;await f.context.route('**/rest/v1/rpc/assign_colis_departure',async route=>{assignment=route.request().postDataJSON();paid.envoi_id=assignment.p_envoi_id;paid.updated_at=new Date().toISOString();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(paid)});});
  await f.login();await f.page.goto(`${base}/colis/${ids.P}`);const departure=f.page.getByLabel('Départ de cette expédition',{exact:true});await departure.waitFor();assert.deepEqual(await departure.locator('option').evaluateAll(options=>options.map(option=>option.value)),['','old','good']);assert.match(await f.page.locator('body').innerText(),/Affectation à revoir/);await departure.selectOption('good');await f.page.getByText('Départ enregistré.',{exact:true}).waitFor();assert.equal(assignment.p_colis_id,ids.P);assert.equal(assignment.p_envoi_id,'good');assert.ok(assignment.p_expected_updated_at);assert.equal(await f.page.getByRole('button',{name:'Vérifier le départ et son manifeste',exact:true}).isEnabled(),true);results.push({test:'departure assignment uses paid destination, excludes closed or stale departures and persists through the atomic command',pass:true});assert.deepEqual(f.errors,[]);await f.context.close();
  f=await setup(browser,'client');const initial=f.tables.colis[0];initial.attente_client_date='2026-09-01T08:00:00Z';initial.attente_client_until='2026-09-02T08:00:00Z';initial.attente_client_motif='Autre achat à recevoir';
  f.tables.colis.push({...initial,id:'73333333-3333-4333-8333-333333333333',ref:'EXP-REVISION',statut:'devis_envoye',attente_client_date:null,devis_brouillon:true,devis_total:null});
  await f.login();await f.page.getByRole('heading',{name:'À faire par vous',exact:true}).waitFor();
  const waiting=f.page.getByRole('region',{name:'En attente à votre demande',exact:true});assert.match(await waiting.innerText(),/EXP-TEST-001/);
  const team=f.page.getByRole('region',{name:'Nous nous en occupons',exact:true});assert.match(await team.innerText(),/EXP-REVISION/);assert.doesNotMatch(await team.innerText(),/Payer/);
  await f.page.setViewportSize({width:390,height:844});await f.page.screenshot({path:path.join(output,'client-home-mobile.png'),fullPage:true,animations:'disabled'});assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  const clientAxe=await new AxeBuilder({page:f.page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();results.push({test:'client home accessibility mobile',pass:clientAxe.violations.length===0,violations:clientAxe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))});
  await navigate(f.page,'/colis');await f.page.getByRole('heading',{name:'Mes expéditions',exact:true}).waitFor();await f.page.getByText('Autres filtres',{exact:true}).click();await f.page.getByRole('button',{name:/Attente demandée/}).click();assert.match(await f.page.locator('body').innerText(),/EXP-TEST-001/);assert.doesNotMatch(await f.page.locator('body').innerText(),/Votre accord est attendu/);
  results.push({test:'client home and list preserve expired deliberate waits and never request withdrawn quote payment',pass:true});
  assert.deepEqual(f.errors,[]);await f.context.close();
 }catch(error){results.push({test:'failure',pass:false,error:error.stack});if(f?.page&&!f.page.isClosed())await f.page.screenshot({path:path.join(output,'failure.png'),fullPage:true,animations:'disabled'});process.exitCode=1;}
 finally{if(results.some(result=>!result.pass))process.exitCode=1;await browser.close();await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}
})();
