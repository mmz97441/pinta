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
const readOnlyRpcs = new Set(['/rest/v1/rpc/refresh_staff_work_actions','/rest/v1/rpc/get_invoice_review_context','/rest/v1/rpc/get_reception_dates']);
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
function datedCartons(f) {
  paid(f);const parcel=f.tables.colis[0];parcel.nb_colis=4;
  parcel.dims_par_colis=Array.from({length:4},()=>({dimL:30,dimW:20,dimH:10,poids:1}));
  parcel.trackings=['TEST-001','TEST-003'];
  parcel.trackings_detail=[{number:'TEST-001',fournisseur:'Boutique A'},{number:'',fournisseur:'Boutique B'},{number:'TEST-003',fournisseur:'Boutique C'},{number:'',fournisseur:''}];
  parcel.date_reception='2026-09-08T08:00:00Z';
  parcel.reception_dates=[{receivedAt:'2026-09-29T07:00:00Z',source:'server'},{receivedAt:'2026-09-30T21:30:00Z',source:'append_receipt'},null,{receivedAt:'2026-10-01T06:00:00Z',source:'append_receipt'}];
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
      assert.match(await overview(f).locator('[data-overview="invoices"]').innerText(),/2/);assert.doesNotMatch(await overview(f).locator('[data-overview="invoices"]').innerText(),/3 facture/);
      assert.equal(await overview(f).getByRole('button',{name:/Corriger.*mesures|Modifier.*mesures/i}).count(),0,'Paid measurements stay protected.');
      unchanged(f,before);
    });
    await scenario('tracking-summary-shows-first-two-and-expands-the-other-cartons-inline',async f=>{
      paid(f);const parcel=f.tables.colis[0];parcel.nb_colis=3;parcel.dims_par_colis.push({dimL:20,dimW:20,dimH:20,poids:1});parcel.trackings.push('TEST-003');parcel.trackings_detail.push({number:'TEST-003',fournisseur:'Boutique C'});
      const before=originals(f);await f.login();await open(f);
      const trackings=overview(f).locator('[data-overview="trackings"]');assert.match(await trackings.innerText(),/TEST-001/);assert.match(await trackings.innerText(),/TEST-002/);assert.doesNotMatch(await trackings.innerText(),/TEST-003/);
      await trackings.locator('summary').filter({hasText:'Voir l’autre carton'}).click();
      await trackings.getByText('TEST-003',{exact:true}).waitFor();assert.equal(await f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true}).count(),0);unchanged(f,before);
    });
    for(const width of [1440,390])await scenario(`individual-arrival-dates-include-untracked-and-extra-cartons-${width}`,async f=>{
      datedCartons(f);const before=originals(f);await f.page.setViewportSize({width,height:width===390?844:1000});await f.login();await open(f);
      const arrivals=overview(f).locator('[data-overview="trackings"]');
      const carton=n=>arrivals.locator(`[data-received-carton="${n}"]`);
      assert.match(await arrivals.innerText(),/Arrivées à l’entrepôt/);
      assert.match(await carton(1).innerText(),/Carton 1.*TEST-001.*29\/09\/2026/s);
      assert.match(await carton(2).innerText(),/Carton 2.*01\/10\/2026/s,'The untracked carton keeps its position and its own arrival date in the Réunion timezone.');
      assert.doesNotMatch(await carton(2).innerText(),/TEST-001|TEST-003|08\/09\/2026/);
      assert.equal(await carton(3).isVisible(),false);
      const url=f.page.url();await arrivals.locator('summary').filter({hasText:'Voir les 2 autres cartons'}).click();
      await carton(3).waitFor();await carton(4).waitFor();
      assert.match(await carton(3).innerText(),/TEST-003/);assert.match(await carton(3).innerText(),/Date non renseignée/);assert.equal(await carton(3).locator('time').count(),0,'A dossier date never invents an arrival for a carton with no evidence.');
      assert.match(await carton(4).innerText(),/Carton 4.*01\/10\/2026/s);assert.equal(f.page.url(),url);
      assert.equal(await f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true}).count(),0);
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await arrivals.scrollIntoViewIfNeeded();await f.page.screenshot({path:`${output}/carton-arrival-dates-${width}.png`,fullPage:true});
      unchanged(f,before);
    });
    await scenario('legacy-cartons-without-evidence-never-copy-the-dossier-arrival-date',async f=>{
      datedCartons(f);f.tables.colis[0].reception_dates=[null,null,null,null];const before=originals(f);await f.login();await open(f);
      const arrivals=overview(f).locator('[data-overview="trackings"]');await arrivals.locator('summary').filter({hasText:'Voir les 2 autres cartons'}).click();
      for(let number=1;number<=4;number++){
        const carton=arrivals.locator(`[data-received-carton="${number}"]`);assert.match(await carton.innerText(),/Date non renseignée/);assert.equal(await carton.locator('time').count(),0);
      }
      assert.doesNotMatch(await arrivals.innerText(),/08\/09\/2026/);unchanged(f,before);
    });
    await scenario('historical-date-read-failure-keeps-cartons-visible-and-explains-recovery',async f=>{
      datedCartons(f);f.tables.colis[0].reception_dates=null;
      await f.context.route('**/rest/v1/rpc/get_reception_dates',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Dates indisponibles pour cet essai.'})}));
      const before=originals(f);await f.login();await open(f);
      const arrivals=overview(f).locator('[data-overview="trackings"]');
      await arrivals.getByRole('status').filter({hasText:'Anciennes dates indisponibles. Actualisez le dossier.'}).waitFor();
      assert.match(await arrivals.innerText(),/Carton 1/);assert.match(await arrivals.innerText(),/Carton 2/);assert.match(await arrivals.innerText(),/Date non renseignée/);
      assert.doesNotMatch(await arrivals.innerText(),/08\/09\/2026/);unchanged(f,before);
    });
    // Final review P4b: the heading's page links wrap together (never « Historique » alone)
    // and carry no external-link arrow; an assigned departure is planned until the expedition step.
    for(const width of [1280,1024,390])await scenario(`heading-links-wrap-together-and-an-assigned-departure-is-planned-${width}`,async f=>{
      received(f);const envoi='e7000000-0000-4000-8000-000000000001';
      f.tables.envois=[{id:envoi,ref:'ENV-TEST-1',date_depart:'2099-01-08',destination_code:'974',statut:'planifie',mode_transport:'aerien',loading_closes_at:null,departed_at:null,manifest_version:0,updated_at:'2026-10-01T08:00:00Z'}];
      f.tables.colis[0].envoi_id=envoi;const before=originals(f);
      await f.page.setViewportSize({width,height:width<768?844:800});await f.login();await open(f,'accord');
      const links=await overview(f).locator('.dossier-overview-links button').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {top:Math.round(box.top),text:node.textContent.trim()};}));
      assert.deepEqual(links.map(link=>link.text),['Aller à l’étape ouverte','Historique']);
      assert.equal(new Set(links.map(link=>link.top)).size,1,`The two page links share their line: ${JSON.stringify(links)}`);
      assert.equal(await overview(f).locator('.dossier-overview-link svg').count(),0,'In-page links: no external-link arrow.');
      const expedition=step(f,'expedition');
      assert.equal(await expedition.getAttribute('data-state'),'planned');
      assert.equal((await expedition.locator('.dossier-overview-step-state').innerText()).trim(),'Prévu le jeudi 8 janvier 2099');
      assert.match(await expedition.getByRole('button').getAttribute('aria-label'),/^Consulter l’étape Expédition — Prévu le jeudi 8 janvier 2099$/);
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await overview(f).screenshot({path:`${output}/overview-heading-planned-${width}.png`});
      unchanged(f,before);
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
    // « Modifier » next to Casier edits in place, like the Départ field (final review P4b): no panel opens.
    const casierGeometry=scope=>scope.locator('.dossier-casier-editor').evaluate(node=>{
      const rect=selector=>node.querySelector(selector).getBoundingClientRect();const label=rect('label.dossier-departure-label'),field=rect('.dossier-casier-input');
      return {labelLeft:label.left,fieldLeft:field.left,labelBottom:label.bottom,fieldTop:field.top,targets:[...node.querySelectorAll('button, label.dossier-casier-all')].map(item=>{const box=item.getBoundingClientRect();return [Math.round(box.width),Math.round(box.height)];})};
    });
    const assertCasierLayout=geometry=>{
      assert.ok(Math.abs(geometry.labelLeft-geometry.fieldLeft)<=2&&geometry.labelBottom<=geometry.fieldTop+1,`The label sits right above its field (${JSON.stringify(geometry)}).`);
      assert.ok(geometry.targets.every(([width,height])=>width>=44&&height>=44),`44px targets: ${JSON.stringify(geometry.targets)}`);
    };
    const focusInCasierEditor=f=>f.page.waitForFunction(()=>document.activeElement?.tagName==='INPUT'&&Boolean(document.activeElement.closest('.dossier-casier-editor')));
    await scenario('casier-edit-opens-in-place-and-persists-without-reopening-paid-steps',async f=>{
      paid(f);const before=structuredClone(f.tables.colis[0]);await f.login();await open(f);
      const edit=overview(f).getByRole('button',{name:'Modifier le casier du dossier',exact:true});
      await edit.click();assert.equal(await edit.getAttribute('aria-expanded'),'true');
      const input=overview(f).getByLabel('Casier du dossier',{exact:true});await input.waitFor();await focusInCasierEditor(f);
      assert.equal(await f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true}).count(),0,'Edited in place: no panel opens.');
      assertCasierLayout(await casierGeometry(overview(f)));
      assert.equal(await input.inputValue(),'A-03');await input.fill('B-12');await overview(f).getByRole('button',{name:'Enregistrer le casier',exact:true}).click();
      await input.waitFor({state:'detached'});
      await f.page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Modifier le casier du dossier');
      await overview(f).locator('[data-overview="casier"]').getByText('B-12',{exact:true}).waitFor();
      assert.equal(f.tables.colis[0].casier,'B-12');assert.equal(f.tables.colis[0].statut,'paye');assert.deepEqual(f.tables.colis[0].final_packages,before.final_packages);assert.deepEqual(f.tables.colis[0].dims_par_colis,before.dims_par_colis);
      assert.equal(businessWrites(f).length,1);assert.equal(businessWrites(f)[0].method,'PATCH');assert.equal(businessWrites(f)[0].path,'/rest/v1/colis');
      // Escape and « Annuler » close the editor without writing, the focus back on « Modifier ».
      for(const close of ['Escape','Annuler']){
        await edit.click();await input.waitFor();await input.fill('Z-99');
        if(close==='Escape')await input.press('Escape');else await overview(f).getByRole('button',{name:'Annuler la modification du casier',exact:true}).click();
        await input.waitFor({state:'detached'});
        await f.page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Modifier le casier du dossier');
      }
      // Saving the same casier writes nothing.
      await edit.click();await input.waitFor();await overview(f).getByRole('button',{name:'Enregistrer le casier',exact:true}).click();await input.waitFor({state:'detached'});
      assert.equal(businessWrites(f).length,1);assert.equal(f.tables.colis[0].casier,'B-12');assert.equal(f.tables.colis[0].casier_historique.length,1);
      await f.page.reload();await overview(f).getByText('B-12',{exact:true}).waitFor();
    });
    // A lowercase letter typed in the middle of the casier stays where it is typed (capitals as typed).
    await scenario('casier-typing-in-the-middle-keeps-the-caret-there',async f=>{
      paid(f);await f.login();await open(f);
      await overview(f).getByRole('button',{name:'Modifier le casier du dossier',exact:true}).click();
      const input=overview(f).getByLabel('Casier du dossier',{exact:true});await input.waitFor();await focusInCasierEditor(f);
      const state=()=>input.evaluate(node=>({value:node.value,caret:node.selectionStart}));
      await input.evaluate(node=>node.setSelectionRange(1,1));
      await f.page.keyboard.type('x');assert.deepEqual(await state(),{value:'AX-03',caret:2});
      await f.page.keyboard.type('y');assert.deepEqual(await state(),{value:'AXY-03',caret:3});
      await input.evaluate(node=>node.setSelectionRange(1,1));await f.page.keyboard.type('Z');assert.deepEqual(await state(),{value:'AZXY-03',caret:2});
      await overview(f).getByRole('button',{name:'Enregistrer le casier',exact:true}).click();await input.waitFor({state:'detached'});
      assert.equal(f.tables.colis[0].casier,'AZXY-03');
    });
    await scenario('casier-failed-save-keeps-draft-and-retry-does-not-duplicate-history',async f=>{
      paid(f);let fail=true;let attempts=0;
      await f.context.route('**/rest/v1/colis?*',route=>{if(route.request().method()==='PATCH'&&route.request().postDataJSON()?.casier){attempts++;if(fail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Enregistrement indisponible pour cet essai.'})});}return route.fallback();});
      await f.login();await open(f);await overview(f).getByRole('button',{name:'Modifier le casier du dossier',exact:true}).click();
      const input=overview(f).getByLabel('Casier du dossier',{exact:true});await input.fill('D-08');
      const save=overview(f).getByRole('button',{name:'Enregistrer le casier',exact:true});
      await save.click();const refusal=overview(f).locator('.dossier-casier-editor [role="alert"]');await refusal.waitFor();
      assert.match(await refusal.innerText(),/^Casier non enregistré : /);assert.equal(await input.getAttribute('aria-invalid'),'true');
      assert.equal(await input.inputValue(),'D-08');assert.equal(f.tables.colis[0].casier,'A-03');fail=false;
      await save.click();await input.waitFor({state:'detached'});
      assert.equal(attempts,2);assert.equal(f.tables.colis[0].casier,'D-08');assert.equal(f.tables.colis[0].casier_historique.length,1);
    });
    // The details panel keeps its own casier editor: label above the field, and the
    // panel above the phone/tablet bottom navigation, even with the keyboard open.
    for(const [width,height,dark] of [[1440,900,false],[390,498,false],[390,498,true],[768,604,false]])await scenario(`casier-editor-in-the-details-panel-lines-up-above-the-navigation-${width}x${height}-${dark?'dark':'light'}`,async f=>{
      paid(f);f.tables.colis[0].casier_historique=[{casier:'A-01',date:'2026-09-20T08:00:00Z'}];
      await f.page.setViewportSize({width,height});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);await f.login();await open(f);
      await f.page.getByTestId('dossier-task-header').getByRole('button',{name:/^Détails/}).click();
      const dialog=f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true});
      const covered=selector=>f.page.evaluate(selector=>{const node=document.querySelector(selector);const box=node.getBoundingClientRect();const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return !(hit&&(node===hit||node.contains(hit)||hit.contains(node)));},selector);
      // The bottom navigation (phones and tablets) is under the panel while it is open.
      const navigation=await f.page.evaluate(()=>{const bar=[...document.querySelectorAll('body *')].find(node=>getComputedStyle(node).position==='fixed'&&!node.closest('[data-testid="dossier-context"]')&&node.getBoundingClientRect().bottom>=innerHeight-1&&node.getBoundingClientRect().height>30&&node.getBoundingClientRect().height<120);if(!bar)return null;const box=bar.getBoundingClientRect();const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return {underPanel:Boolean(hit?.closest('[data-testid="dossier-context"]'))};});
      if(width<1024)assert.deepEqual(navigation,{underPanel:true},'The panel covers the bottom navigation.');
      await dialog.getByRole('button',{name:'Modifier le casier',exact:true}).click();
      const input=dialog.getByLabel('Casier du dossier',{exact:true});await input.waitFor();await focusInCasierEditor(f);
      assertCasierLayout(await casierGeometry(dialog));
      for(const selector of ['[data-testid="dossier-context"] .dossier-casier-input','[data-testid="dossier-context"] [aria-label="Enregistrer le casier"]','[data-testid="dossier-context"] [aria-label="Annuler la modification du casier"]'])assert.equal(await covered(selector),false,`${selector} stays uncovered.`);
      // The last line of the panel can always be reached.
      await dialog.locator('.dossier-context-scroll').evaluate(node=>{node.scrollTop=node.scrollHeight;});
      assert.equal(await covered('[data-testid="dossier-context"] label.dossier-casier-all'),false,'« Appliquer à tous les colis » stays reachable.');
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await f.page.screenshot({path:`${output}/casier-panel-${width}x${height}-${dark?'dark':'light'}.png`});
      await input.fill('B-12');await dialog.getByRole('button',{name:'Enregistrer le casier',exact:true}).click();
      await dialog.getByRole('status').filter({hasText:'Casier B-12 enregistré.'}).waitFor();
      // The confirmation toast is a success, painted above the panel (never hidden under it).
      const toast=f.page.locator('[data-toast]').filter({hasText:'Casier B-12 enregistré.'});await toast.waitFor();
      assert.equal(await toast.getAttribute('data-toast'),'success');
      await toast.evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished)));
      assert.equal(await toast.evaluate(node=>{const box=node.getBoundingClientRect();const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return node.contains(hit);}),true,'The toast is above the details panel.');
      await f.page.screenshot({path:`${output}/casier-panel-toast-${width}x${height}-${dark?'dark':'light'}.png`});
      await f.page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Modifier le casier');
      assert.equal(f.tables.colis[0].casier,'B-12');assert.equal(f.tables.colis[0].casier_historique.length,2);
      const axe=await new AxeBuilder({page:f.page}).include('[data-testid="dossier-context"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
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
    // Who changed the status: the trigger records user_id (none for a server job).
    for(const dark of [false,true])await scenario(`history-names-who-changed-the-status-and-stays-readable-${dark?'dark':'light'}`,async f=>{
      paid(f);f.tables.clients[0].user_id='c1a1e000-0000-4000-8000-000000000001';
      const log=(n,from,to,fields)=>({id:`log-${n}`,colis_id:ids.P,ancien_statut:from,nouveau_statut:to,user_nom:null,created_at:`2026-09-1${n}T08:00:00Z`,...fields});
      f.tables.logs_statut=[
        log(1,'receptionne','mesure',{user_id:ids.A}),
        log(2,'mesure','attente_feu_vert',{user_id:null}),
        log(3,'attente_feu_vert','autorise',{user_id:'c1a1e000-0000-4000-8000-000000000001'}),
        log(4,'autorise','en_preparation',{user_id:'99999999-9999-4999-8999-999999999999'}),
        log(5,'en_preparation','devis_envoye',{user_id:null,user_nom:'Import 2025'}),
      ];
      await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);await f.login();await open(f);
      await overview(f).getByRole('button',{name:'Consulter l’historique du dossier',exact:true}).click();
      const dialog=f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true});const history=dialog.getByTestId('dossier-history');await history.waitFor();
      // Newest first: a recorded name, a colleague missing from the team list, the client, a server job, a colleague.
      assert.deepEqual(await history.locator('[data-history-author]').allInnerTexts(),['Import 2025','Membre de l’équipe','Exemple Camille (client)','Système','Test Camille']);
      assert.doesNotMatch(await history.innerText(),/(^|\n)\s*—\s*:/,'No entry without an author.');
      const look=await history.evaluate(node=>{
        const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
        const lum=color=>color.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
        const paint=element=>{for(let n=element;n;n=n.parentElement){const parts=getComputedStyle(n).backgroundColor.match(/[\d.]+/g).map(Number);if(parts.length<4||parts[3]>.5)return parts.slice(0,3);}return [255,255,255];};
        const chips=[...node.querySelectorAll('.rounded-full')].filter(chip=>chip.textContent.trim()).map(chip=>({text:chip.textContent.trim(),background:lum(rgb(getComputedStyle(chip).backgroundColor)),ratio:ratio(rgb(getComputedStyle(chip).color),rgb(getComputedStyle(chip).backgroundColor))}));
        const entry=node.querySelector('[data-history-entry]'),bullet=entry.querySelector('[aria-hidden="true"]'),card=paint(node);
        return {chips,separator:ratio(rgb(getComputedStyle(entry).borderBottomColor),card),separatorLight:lum(rgb(getComputedStyle(entry).borderBottomColor)),bullet:ratio(rgb(getComputedStyle(bullet).backgroundColor),card)};
      });
      assert.equal(look.chips.length,10);
      for(const chip of look.chips){assert.ok(chip.ratio>=4.5,`${chip.text}: ${chip.ratio.toFixed(2)}:1`);if(dark)assert.ok(chip.background<.1,`${chip.text}: a dark chip in dark mode, never a bright pill.`);}
      assert.ok(look.bullet>=3,`Bullet ${look.bullet.toFixed(2)}:1 against the card.`);
      if(dark)assert.ok(look.separatorLight<.1,'The separator is a dark line in dark mode, never a bright white rule.');
      await dialog.screenshot({path:`${output}/history-${dark?'dark':'light'}.png`});
      const axe=await new AxeBuilder({page:f.page}).include('[data-testid="dossier-context"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
      assert.deepEqual(businessWrites(f),[]);
    });
    await scenario('a-failed-history-read-is-an-error-with-a-retry-never-an-empty-journal',async f=>{
      paid(f);let fail=true;
      await f.context.route('**/rest/v1/logs_statut?*',route=>fail?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Historique indisponible pour cet essai.'})}):route.fallback());
      await f.login();await open(f);await overview(f).getByRole('button',{name:'Consulter l’historique du dossier',exact:true}).click();
      const dialog=f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true});
      await dialog.getByRole('alert').filter({hasText:'L’historique n’a pas pu être chargé'}).waitFor();
      assert.equal(await dialog.getByText('Aucun événement enregistré.',{exact:true}).count(),0);
      fail=false;await dialog.getByRole('button',{name:'Réessayer',exact:true}).click();
      await dialog.getByText('Aucun événement enregistré.',{exact:true}).waitFor();
    });
    await scenario('restricted-worker-cannot-open-financial-or-invoice-details-through-overview',async f=>{
      paid(f);const rights={id:'overview-rights',staff_id:ids.S,perm_colis_preparer:true};f.tables.staff_permissions=[rights];f.tables.staff_users[0].staff_permissions=rights;
      await f.login();await open(f,'preparation');
      for(const id of ['documents','devis','paiement']) {assert.equal(await step(f,id).getAttribute('data-state'),'restricted');assert.equal(await step(f,id).getByRole('button').count(),0);}
      assert.doesNotMatch(await overview(f).innerText(),/100[,.]00\s*€/);assert.deepEqual(businessWrites(f),[]);
    },'preparateur');
    for(const dark of [false,true])await scenario(`status-colours-have-readable-contrast-and-do-not-replace-labels-${dark?'dark':'light'}`,async f=>{
      received(f);await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);await f.login();
      const seen=new Set();
      for(const state of ['waiting','current','review','unknown']){
        const parcel=f.tables.colis[0];
        if(state==='waiting')Object.assign(parcel,{statut:'attente_feu_vert',demande_feu_vert_envoyee_at:'2026-10-01T08:00:00Z'});
        if(state==='current')Object.assign(parcel,{statut:'autorise',feu_vert:'autorise',feu_vert_date:'2026-10-01T09:00:00Z'});
        if(state==='review')Object.assign(parcel,{final_packages:[{dimL:35,dimW:25,dimH:20,poids:2.5}],outgoing_parcel_count:1,preparation_composition_version:2,final_measurements_version:1});
        if(state==='unknown')Object.assign(parcel,{statut:'paye',quote_version:1,devis_brouillon:false,devis_total:100,paiement_montant:100,paiement_date:'2026-10-01T09:00:00Z',final_packages:[],final_measurements_version:null});
        await open(f,state==='waiting'?'accord':'preparation');
        const evidence=await overview(f).locator('[data-step]').evaluateAll(nodes=>{
          const luminance=rgb=>{const channels=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>{const v=c/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
          return nodes.map(node=>{const box=node.firstElementChild,label=box.querySelector('.dossier-overview-step-state'),style=getComputedStyle(box);const a=luminance(getComputedStyle(label).color),b=luminance(style.backgroundColor);return {state:node.dataset.state,text:label.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),icon:!!label.querySelector('svg')};});
        });
        assert.ok(evidence.some(item=>item.state===state),`Fixture presents ${state}`);
        for(const item of evidence){seen.add(item.state);assert.ok(item.ratio>=4.5,`${item.state} actual text contrast ${item.ratio.toFixed(2)}:1`);assert.ok(item.text.trim()&&item.icon,'Status remains understandable without colour.');}
      }
      for(const state of ['done','waiting','current','review','unknown','upcoming'])assert.ok(seen.has(state));
      assert.deepEqual(businessWrites(f),[]);
    });
    for(const width of [1440,768,390,320])for(const dark of [false,true])await scenario(`overview-accessible-${width}-${dark?'dark':'light'}`,async f=>{
      paid(f);
      if([320,768].includes(width)){f.tables.clients[0].nom='Nom de client composé particulièrement long pour vérifier la lisibilité';f.tables.colis[0].trackings_detail[0].number='TRACKING'+('1234567890'.repeat(12));}
      await f.page.setViewportSize({width,height:width<=390?844:1000});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);await f.login();await open(f);
      assert.equal(await overview(f).getByRole('navigation',{name:'Parcours du dossier',exact:true}).locator('[data-step]').count(),8);
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      const geometry=await overview(f).getByRole('navigation',{name:'Parcours du dossier',exact:true}).evaluate(node=>{
        const buttons=[...node.querySelectorAll('[data-step] button')];
        return {height:node.getBoundingClientRect().height,buttons:buttons.map(button=>{const r=button.getBoundingClientRect();const c=getComputedStyle(button);return {top:Math.round(r.top),width:r.width,height:r.height,color:c.color,background:c.backgroundColor,state:button.parentElement.dataset.state};})};
      });
      assert.equal(new Set(geometry.buttons.map(button=>button.top)).size,width===1440?1:width===768?2:4,'Eight steps use one desktop row, two tablet rows or four phone rows.');
      assert.ok(geometry.buttons.every(button=>button.height>=44&&button.width>=44),'Compact steps retain touch targets.');
      if(width===1440)assert.ok(geometry.height<=80,`The desktop path remains compact (${geometry.height}px).`);
      const done=geometry.buttons.find(button=>button.state==='done'),other=geometry.buttons.find(button=>button.state!=='done');
      assert.ok(done&&other);assert.notEqual(done.background,other.background,'Completed steps are distinguishable while text/icons remain visible.');
      await step(f,'documents').getByRole('button').click();await f.page.waitForURL(url=>url.searchParams.get('section')==='documents');
      const context=overview(f).locator('[data-overview="opened-step"]');await context.filter({hasText:/Factures.*2/s}).waitFor();assert.match(await context.innerText(),/Factures.*2/s);
      assert.equal(await step(f,'documents').getByRole('button').getAttribute('aria-describedby'),await context.getAttribute('id'));
      assert.equal(await step(f,'documents').getByRole('button').evaluate(node=>getComputedStyle(node).backgroundColor),done.background,'Opening a completed step preserves its factual colour.');
      if([320,768].includes(width))for(const id of ['reception','accord','preparation','documents','devis','paiement','expedition','livraison']){
        await step(f,id).getByRole('button').click();await f.page.waitForURL(url=>url.searchParams.get('section')===id);
        assert.equal(f.tables.colis[0].statut,'paye');assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      }
      const axe=await new AxeBuilder({page:f.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
      await overview(f).evaluate(node=>{for(let parent=node.parentElement;parent;parent=parent.parentElement)parent.scrollTop=0;});
      await f.page.screenshot({path:`${output}/overview-${width}-${dark?'dark':'light'}.png`,fullPage:true});assert.deepEqual(businessWrites(f),[]);
    });
  } finally {await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
