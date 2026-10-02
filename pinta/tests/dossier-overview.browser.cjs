/* Dossier facts and step navigation. Synthetic data and intercepted transports only. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_DOSSIER_OVERVIEW_OUT || '/tmp/pinta-dossier-overview';
const results = [];
const overview = f => f.page.getByTestId('dossier-overview');
const step = (f,id) => overview(f).locator(`[data-step="${id}"]`);
// The invoice context RPC is SQL STABLE: its POST only reads review evidence.
const readOnlyRpcs = new Set(['/rest/v1/rpc/refresh_staff_work_actions','/rest/v1/rpc/get_invoice_review_context']);
const businessWrites = f => f.requests.filter(request => ['POST','PATCH','DELETE'].includes(request.method) && request.path.startsWith('/rest/v1/') && !readOnlyRpcs.has(request.path));
const originals = f => ({colis:structuredClone(f.tables.colis),factures:structuredClone(f.tables.factures),lignes:structuredClone(f.tables.lignes)});
function unchanged(f, before) { assert.deepEqual(originals(f),before); assert.deepEqual(businessWrites(f),[]); }
function paid(f) {
  Object.assign(f.tables.colis[0],{statut:'paye',quote_version:1,devis_total:100,devis_brouillon:false,devis_envoye_le:'2026-10-01T08:00:00Z',paiement_montant:100,paiement_date:'2026-10-01T09:00:00Z',
    dims_par_colis:[{dimL:40,dimW:30,dimH:20,poids:2},{dimL:30,dimW:20,dimH:15,poids:1}],
    final_packages:[{dimL:35,dimW:25,dimH:20,poids:2.5}],fin_l:35,fin_w:25,fin_h:20,fin_p:2.5,nb_colis:2,outgoing_parcel_count:1,
    preparation_composition_version:1,final_measurements_version:1,final_measurements_at:'2026-10-01T07:00:00Z',feu_vert:'autorise',feu_vert_date:'2026-10-01T06:00:00Z'});
  const invoice={...f.tables.factures[0],id:'44444444-4444-4444-8444-444444444442',fichier_nom:'facture-2.pdf',montant:50};
  f.tables.factures.push(invoice,{...invoice,id:'44444444-4444-4444-8444-444444444443',fichier_nom:'copie.pdf',duplicate_of_facture_id:invoice.id});
  f.tables.lignes.push({...f.tables.lignes[0],id:'55555555-5555-4555-8555-555555555552',facture_id:invoice.id,prix_unitaire:50});
  f.tables.staff_work_actions=[];
}
function received(f) {
  paid(f);Object.assign(f.tables.colis[0],{statut:'mesure',feu_vert:'en_attente',feu_vert_date:null,devis_total:0,quote_version:0,devis_envoye_le:null,paiement_montant:null,paiement_date:null,
    final_packages:[],outgoing_parcel_count:0,final_measurements_version:null,final_measurements_at:null,fin_l:null,fin_w:null,fin_h:null,fin_p:null});
}
async function open(f, section='expedition') {await f.page.goto(`${base}/colis/${ids.P}?section=${section}`);await overview(f).waitFor();}
async function main() {
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true});
  async function scenario(name,run,role='directeur') {
    if(process.env.PINTA_DOSSIER_OVERVIEW_FILTER&&!name.includes(process.env.PINTA_DOSSIER_OVERVIEW_FILTER))return;
    const f=await setup(browser,role);f.page.setDefaultTimeout(12000);
    try {await run(f);assert.deepEqual(f.errors,[]);assert.deepEqual(f.networkDenied,[]);assert.equal(f.requests.some(request=>/\/(queue_message|send-email|send-telegram)$/.test(request.path)),false);results.push({test:name,pass:true});}
    catch(error){process.exitCode=1;results.push({test:name,pass:false,error:error.stack});await f.page.screenshot({path:`${output}/${name}-failure.png`,fullPage:true}).catch(()=>{});await fs.writeFile(`${output}/${name}-failure.txt`,await f.page.locator('body').innerText().catch(()=>''));}
    finally{await f.context.close();console.log(JSON.stringify(results.at(-1)));}
  }
  try {
    await scenario('paid-dossier-retains-reception-optimisation-and-current-invoices-as-separate-facts',async f=>{
      paid(f);const before=originals(f);await f.login();await open(f);
      const text=await overview(f).innerText();assert.match(text,/A-03/);assert.match(text,/2.*carton/);assert.match(text,/3[,.]0*\s*kg|3\s*kg/);assert.match(text,/2[,.]5(?:0)?\s*kg/);assert.match(text,/TEST-001/);assert.match(text,/TEST-002/);
      assert.equal(await step(f,'reception').getAttribute('data-state'),'done');assert.equal(await step(f,'preparation').getAttribute('data-state'),'done');assert.equal(await step(f,'paiement').getAttribute('data-state'),'done');
      assert.match(await step(f,'documents').innerText(),/2/);assert.doesNotMatch(await step(f,'documents').innerText(),/3 facture/);
      assert.equal(await overview(f).getByRole('button',{name:/Corriger.*mesures|Modifier.*mesures/i}).count(),0,'Paid measurements stay protected.');
      unchanged(f,before);
    });
    await scenario('tracking-summary-shows-first-two-and-opens-the-complete-received-manifest',async f=>{
      paid(f);const parcel=f.tables.colis[0];parcel.nb_colis=3;parcel.dims_par_colis.push({dimL:20,dimW:20,dimH:20,poids:1});parcel.trackings.push('TEST-003');parcel.trackings_detail.push({number:'TEST-003',fournisseur:'Boutique C'});
      const before=originals(f);await f.login();await open(f);
      const trackings=overview(f).locator('[data-overview="trackings"]');assert.match(await trackings.innerText(),/TEST-001/);assert.match(await trackings.innerText(),/TEST-002/);assert.doesNotMatch(await trackings.innerText(),/TEST-003/);
      await trackings.getByRole('button',{name:'Consulter les 3 suivis reçus',exact:true}).click();
      await f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true}).getByText('TEST-003',{exact:true}).waitFor();unchanged(f,before);
    });
    await scenario('future-step-navigation-is-consultation-and-keeps-the-real-business-stage',async f=>{
      received(f);const before=originals(f);await f.login();await open(f,'accord');
      for(const id of ['preparation','documents','devis','paiement','expedition','livraison','reception','accord']) {
        await step(f,id).getByRole('button').click();
        await f.page.waitForURL(url=>url.searchParams.get('section')===id&&url.hash==='#dossier-work');
        await f.page.getByTestId('dossier-task-workspace').waitFor();
        assert.equal(f.tables.colis[0].statut,'mesure');
        assert.notEqual(await step(f,'paiement').getAttribute('data-state'),'done');
      }
      unchanged(f,before);
    });
    await scenario('paid-status-never-manufactures-missing-preparation-or-received-invoices',async f=>{
      paid(f);f.tables.colis[0].preparation_composition_version=2;f.tables.factures=[];f.tables.lignes=[];
      const before=originals(f);await f.login();await open(f);
      assert.notEqual(await step(f,'preparation').getAttribute('data-state'),'done');assert.notEqual(await step(f,'documents').getAttribute('data-state'),'done');
      assert.match(await overview(f).innerText(),/vérifier|confirmer|périm|manquant|compléter/i);unchanged(f,before);
    });
    await scenario('casier-edit-opens-directly-and-persists-without-reopening-paid-steps',async f=>{
      paid(f);const before=structuredClone(f.tables.colis[0]);await f.login();await open(f);
      await overview(f).getByRole('button',{name:/Modifier le casier/}).click();
      const dialog=f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true});const input=dialog.getByLabel('Casier du dossier',{exact:true});await input.waitFor();
      await f.page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Casier du dossier');
      assert.equal(await input.inputValue(),'A-03');await input.fill('B-12');await dialog.getByRole('button',{name:'Enregistrer le casier',exact:true}).click();
      await input.waitFor({state:'hidden'});
      await f.page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Modifier le casier');
      await dialog.getByRole('button',{name:'Fermer le contexte du dossier',exact:true}).click();
      await f.page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Modifier le casier du dossier');
      assert.equal(f.tables.colis[0].casier,'B-12');assert.equal(f.tables.colis[0].statut,'paye');assert.deepEqual(f.tables.colis[0].final_packages,before.final_packages);assert.deepEqual(f.tables.colis[0].dims_par_colis,before.dims_par_colis);
      assert.equal(businessWrites(f).length,1);assert.equal(businessWrites(f)[0].method,'PATCH');assert.equal(businessWrites(f)[0].path,'/rest/v1/colis');
      await f.page.reload();await overview(f).getByText('B-12',{exact:true}).waitFor();
    });
    await scenario('casier-failed-save-keeps-draft-and-retry-does-not-duplicate-history',async f=>{
      paid(f);let fail=true;let attempts=0;
      await f.context.route('**/rest/v1/colis?*',route=>{if(route.request().method()==='PATCH'&&route.request().postDataJSON()?.casier){attempts++;if(fail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Enregistrement indisponible pour cet essai.'})});}return route.fallback();});
      await f.login();await open(f);await overview(f).getByRole('button',{name:/Modifier le casier/}).click();
      const dialog=f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true});const input=dialog.getByLabel('Casier du dossier',{exact:true});await input.fill('D-08');
      await dialog.getByRole('button',{name:'Enregistrer le casier',exact:true}).click();await f.page.getByText(/Casier non enregistré/).first().waitFor();
      assert.equal(await input.inputValue(),'D-08');assert.equal(f.tables.colis[0].casier,'A-03');fail=false;
      await dialog.getByRole('button',{name:'Enregistrer le casier',exact:true}).click();await input.waitFor({state:'hidden'});
      assert.equal(attempts,2);assert.equal(f.tables.colis[0].casier,'D-08');assert.equal(f.tables.colis[0].casier_historique.length,1);
    });
    await scenario('history-opens-the-journal-directly-without-mutating-the-dossier',async f=>{
      paid(f);const before=originals(f);await f.login();await open(f);
      await overview(f).getByRole('button',{name:'Consulter l’historique du dossier',exact:true}).click();
      const dialog=f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true});
      await dialog.getByRole('heading',{name:'Historique du dossier',exact:true}).waitFor();
      assert.equal(await dialog.getByRole('button',{name:'Historique',exact:true}).getAttribute('aria-current'),'page');
      await dialog.getByText('Aucun événement enregistré.',{exact:true}).waitFor();
      await dialog.getByRole('button',{name:'Fermer le contexte du dossier',exact:true}).click();
      await f.page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Consulter l’historique du dossier');
      unchanged(f,before);
    });
    await scenario('restricted-worker-cannot-open-financial-or-invoice-details-through-overview',async f=>{
      paid(f);const rights={id:'overview-rights',staff_id:ids.S,perm_colis_preparer:true};f.tables.staff_permissions=[rights];f.tables.staff_users[0].staff_permissions=rights;
      await f.login();await open(f,'preparation');
      for(const id of ['documents','devis','paiement']) {assert.equal(await step(f,id).getAttribute('data-state'),'restricted');assert.equal(await step(f,id).getByRole('button').count(),0);}
      assert.doesNotMatch(await overview(f).innerText(),/100[,.]00\s*€/);assert.deepEqual(businessWrites(f),[]);
    },'preparateur');
    for(const width of [1440,768,390,320])for(const dark of [false,true])await scenario(`overview-accessible-${width}-${dark?'dark':'light'}`,async f=>{
      paid(f);
      if([320,768].includes(width)){f.tables.clients[0].nom='Nom de client composé particulièrement long pour vérifier la lisibilité';f.tables.colis[0].trackings_detail[0].number='TRACKING'+('1234567890'.repeat(12));}
      await f.page.setViewportSize({width,height:width<=390?844:1000});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);await f.login();await open(f);
      assert.equal(await overview(f).getByRole('navigation',{name:'Parcours du dossier',exact:true}).locator('[data-step]').count(),8);
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      if([320,768].includes(width))for(const id of ['reception','accord','preparation','documents','devis','paiement','expedition','livraison']){
        await step(f,id).getByRole('button').click();await f.page.waitForURL(url=>url.searchParams.get('section')===id);
        assert.equal(f.tables.colis[0].statut,'paye');assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      }
      const axe=await new AxeBuilder({page:f.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
      await f.page.screenshot({path:`${output}/overview-${width}-${dark?'dark':'light'}.png`,fullPage:true});assert.deepEqual(businessWrites(f),[]);
    });
  } finally {await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
