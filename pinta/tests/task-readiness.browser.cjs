const { openTaskNavigation } = require('./task-navigation.helper.cjs');
/* End-to-end task readiness with strict, isolated business-command fixtures.
 * These checks verify the UI's requests; SQL/Edge suites establish real server guards. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids, scanLoading } = require('./browser-regression.cjs');
const { fixture: invoicesFixture, C } = require('./invoice-workspace.cjs');
const { waitForCurrentInvoice } = require('./invoice-list.helper.cjs');
const output = process.env.PINTA_TASK_READINESS_OUT || '/tmp/pinta-task-readiness';
const TASK = '77777777-0000-4000-8000-000000000001';
const DEPARTURE = '88888888-2222-4222-8222-222222222222';
const TEST_DAY = new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Paris'});
const box = { dimL:30,dimW:20,dimH:20,poids:3 };
const received = [{ dimL:40,dimW:30,dimH:20,poids:1.5 }, { dimL:35,dimW:25,dimH:15,poids:1.5 }];
const clone = value => structuredClone(value);
const workspace = f => f.page.getByTestId('dossier-task-workspace');
const taskSelect = f => f.page.getByLabel('Tâche du dossier',{exact:true});
const quoteSave = f => workspace(f).getByRole('button',{name:'Enregistrer et vérifier le devis',exact:true});
const boxesValid = boxes => Array.isArray(boxes) && boxes.length > 0 && boxes.length <= 100 && boxes.every(item=>['dimL','dimW','dimH','poids'].every(key=>Number.isFinite(Number(item[key])) && Number(item[key])>0));
function certified(row) {
  const boxes = row.final_packages == null ? [{dimL:row.fin_l,dimW:row.fin_w,dimH:row.fin_h,poids:row.fin_p}] : row.final_packages;
  return row.preparation_composition_version != null && row.final_measurements_version === row.preparation_composition_version && boxesValid(boxes) && row.outgoing_parcel_count === boxes.length;
}
function advance(row) { row.updated_at=new Date(Math.max(Date.now(),Date.parse(row.updated_at) || 0)+1000).toISOString(); }
function action(f, kind, state='ready') {
  f.tables.staff_work_actions=[{id:TASK,colis_id:ids.P,kind,state,assignee_id:ids.A,version:1,created_at:'2026-09-01T08:00:00Z',updated_at:'2026-09-01T08:00:00Z'}];
}
async function fixture(browser, options={}) {
  const f=options.invoices?await invoicesFixture(browser,{category:'cat-test'}):await setup(browser,options.permissions?'preparateur':'directeur');
  f.page.setDefaultTimeout(10000); f.commands=[];f.protocolErrors=[];
  const row=f.tables.colis[0];Object.assign(row,{statut:'autorise',feu_vert:'autorise',dims_par_colis:clone(received),consent_request_version:0,...options.colis});
  if(options.permissions){const rights={id:'task-rights',staff_id:ids.S,...options.permissions};f.tables.staff_permissions=[rights];f.tables.staff_users[0].staff_permissions=rights;}
  f.tables.staff_work_preferences[0].active_mission=null;
  f.tables.clients[0].user_id=ids.A;
  const rights=permission=>!options.permissions || options.permissions[permission]===true;
  const answer=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  const guarded=run=>async route=>{try{return await run(route);}catch(error){f.protocolErrors.push(error.message);return answer(route,{code:'22023',message:error.message},400);}};
  await f.page.addInitScript(()=>{window.__opened=[];window.open=(...args)=>{window.__opened.push(args);return null;};});
  await f.context.route('**/rest/v1/colis*',guarded(async route=>{
    if(route.request().method()!=='PATCH') return route.fallback();
    const input=route.request().postDataJSON(),url=new URL(route.request().url());f.commands.push({kind:'patch',input:clone(input)});
    assert.equal(url.searchParams.get('updated_at'),`eq.${row.updated_at}`,'Every dossier write carries its exact revision');
    if(input.statut && input.statut!==row.statut){
      const allowed={receptionne:['mesure'],mesure:['attente_feu_vert'],autorise:['en_preparation'],en_preparation:['devis_envoye'],expedie:['transit'],transit:['dedouanement','arrive'],dedouanement:['arrive'],arrive:['livraison'],livraison:['livre']};
      assert.ok(allowed[row.statut]?.includes(input.statut),`Illegal status ${row.statut} → ${input.statut}`);
      if(input.statut==='mesure'){assert.ok(rights('perm_colis_mesurer'));assert.ok(boxesValid(input.dims_par_colis));}
      if(input.statut==='attente_feu_vert') assert.ok(rights('perm_colis_demander_feuvert'));
      if(input.statut==='en_preparation') assert.ok(rights('perm_colis_preparer'));
      if(input.statut==='devis_envoye'){assert.ok(rights('perm_colis_envoyer_devis'));assert.ok(row.devis_total>0 && row.quote_version>0 && certified(row));input.devis_envoye_le=new Date().toISOString();}
      if(input.statut==='livre') input.date_livraison=new Date().toISOString();
    }
    Object.assign(row,input);advance(row);return answer(route,[row]);
  }));
  await f.context.route('**/rest/v1/rpc/*',guarded(async route=>{
    const kind=new URL(route.request().url()).pathname.split('/').pop(),input=route.request().postDataJSON();
    // The confirmed manifest is the mock's (browser-regression.cjs), with the loading checks it froze.
    if(!['save_quote','save_preparation_measurements','queue_message','client_decision','mark_manual_payment','assign_colis_departure','confirm_departure'].includes(kind)) return route.fallback();
    f.commands.push({kind,input:clone(input)});
    if(kind==='save_preparation_measurements'){
      assert.ok(rights('perm_colis_preparer'));assert.equal(row.feu_vert,'autorise');assert.ok(['autorise','en_preparation'].includes(row.statut));assert.equal(input.p_expected_updated_at,row.updated_at);assert.equal(input.p_expected_composition_version,row.preparation_composition_version);assert.ok(boxesValid(input.p_final_packages));
      const boxes=input.p_final_packages.map(item=>Object.fromEntries(['dimL','dimW','dimH','poids'].map(key=>[key,Number(item[key])])));Object.assign(row,{statut:'en_preparation',final_packages:boxes,outgoing_parcel_count:boxes.length,final_measurements_version:row.preparation_composition_version,final_measurements_at:new Date().toISOString(),fin_l:Math.max(...boxes.map(b=>+b.dimL)),fin_w:Math.max(...boxes.map(b=>+b.dimW)),fin_h:Math.max(...boxes.map(b=>+b.dimH)),fin_p:boxes.reduce((sum,b)=>sum+ +b.poids,0)});advance(row);return answer(route,{colis:row});
    }
    if(kind==='save_quote'){
      assert.ok(rights('perm_colis_calculer_devis'));assert.ok(['autorise','en_preparation'].includes(row.statut));assert.equal(row.feu_vert,'autorise');assert.ok(!row.archive && !row.paiement_date);assert.equal(input.p_expected_updated_at,row.updated_at);assert.ok(certified(row),'Quote requires the complete current preparation certificate');
      if(f.tables.clients[0].type!=='pro') assert.ok(f.tables.factures.length && f.tables.factures.every(invoice=>invoice.valide && invoice.montant>0 && invoice.fichier_url),'Quote requires reviewed source invoices');
      assert.ok(input.p_snapshot.amounts.total>0);assert.deepEqual(input.p_snapshot.inputs.finalPackages,row.final_packages??[{dimL:row.fin_l,dimW:row.fin_w,dimH:row.fin_h,poids:row.fin_p}]);
      const mapping={devisTransport:'devis_transport',devisOM:'devis_om',devisOMR:'devis_omr',devisTVA:'devis_tva',devisTotal:'devis_total',poidsFact:'poids_facturable',fraisDivers:'frais_divers',modePaiementPro:'mode_paiement_pro'};
      for(const [key,dest] of Object.entries(mapping)) if(input.p_snapshot[key]!==undefined) row[dest]=input.p_snapshot[key];
      Object.assign(row,{statut:'en_preparation',devis_snapshot:input.p_snapshot,devis_brouillon:true,quote_version:row.quote_version+1});advance(row);return answer(route,{colis:row,quote:{version:row.quote_version}});
    }
    if(kind==='queue_message'){
      if(['demande_feu_vert','relance_feu_vert'].includes(input.p_template)){assert.ok(['mesure','attente_feu_vert'].includes(row.statut));assert.equal(input.p_expected_consent_version,row.consent_request_version);row.statut='attente_feu_vert';advance(row);}
      if(input.p_template==='devis_final'){assert.equal(row.statut,'devis_envoye');assert.equal(row.devis_brouillon,false);}
      assert.ok(['portal','email'].includes(input.p_canal),'This fixture never calls a notification provider');
      const message={id:crypto.randomUUID(),colis_id:row.id,template:input.p_template,texte:input.p_text,type:'staff',canal:input.p_canal,statut:input.p_canal==='portal'?'envoye':'brouillon',created_at:new Date().toISOString()};f.tables.messages.push(message);
      return answer(route,{message,outbox:{id:crypto.randomUUID()}});
    }
    if(kind==='client_decision'){
      assert.equal(row.statut,'attente_feu_vert');assert.equal(input.p_expected_updated_at,row.updated_at);
      if(input.p_action==='wait') Object.assign(row,{attente_client_date:new Date().toISOString(),attente_client_motif:input.p_reason,attente_client_until:input.p_wait_until});
      else Object.assign(row,{statut:input.p_action==='approve'?'autorise':'refuse_client',feu_vert:input.p_action==='approve'?'autorise':'refuse',feu_vert_date:new Date().toISOString()});
      advance(row);return answer(route,row);
    }
    if(kind==='mark_manual_payment'){
      assert.ok(rights('perm_colis_confirmer_paiement'));assert.equal(f.tables.clients[0].type,'pro');assert.equal(row.statut,'devis_envoye');assert.equal(input.p_amount,row.devis_total);
      Object.assign(row,{statut:'paye',paiement_date:new Date().toISOString(),paiement_montant:input.p_amount});advance(row);return answer(route,row);
    }
    if(kind==='assign_colis_departure'){
      assert.equal(row.statut,'paye');assert.ok(row.paiement_date);assert.equal(input.p_expected_updated_at,row.updated_at);assert.equal(input.p_envoi_id,DEPARTURE);row.envoi_id=DEPARTURE;advance(row);return answer(route,row);
    }
    assert.equal(kind,'confirm_departure');assert.equal(row.statut,'paye');assert.ok(certified(row));assert.equal(input.p_expected_updated_at,f.tables.envois[0].updated_at);
    assert.equal(f.tables.envois[0].date_depart,TEST_DAY,'The actual departure is confirmed on its scheduled day');
    assert.deepEqual(input.p_loaded,[{id:row.id,updated_at:row.updated_at,outgoing_parcel_count:row.outgoing_parcel_count}]);
    // The mock confirms as the server does, the mandatory loading control included (every parcel scanned or counted).
    const confirmed=f.rpc('confirm_departure',input);return answer(route,confirmed.body,confirmed.status);
  }));
  await f.context.route('**/functions/v1/correct-colis-task',guarded(async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, OPTIONS'}});
    const input=route.request().postDataJSON();f.commands.push({kind:'correct_colis_task',input:clone(input)});
    assert.ok(rights('perm_colis_revenir_arriere')&&rights('perm_colis_preparer'));assert.equal(input.task,'preparation');assert.equal(input.expectedUpdatedAt,row.updated_at);assert.equal(row.feu_vert,'autorise');assert.ok(!row.archive&&!row.paiement_date);assert.ok(boxesValid(input.values.boxes));
    Object.assign(row,{statut:'en_preparation',final_packages:clone(input.values.boxes),outgoing_parcel_count:input.values.boxes.length,final_measurements_version:row.preparation_composition_version,final_measurements_at:new Date().toISOString(),devis_total:null,devis_snapshot:null,devis_brouillon:true});advance(row);
    return answer(route,{colis:row,changed:true,invalidated:['devis']});
  }));
  return f;
}
async function open(f,task){await f.page.goto(`${base}/colis/${ids.P}?section=${task}&returnTo=%2F%3Fmission%3Ddocuments`);await workspace(f).waitFor();}
async function fromWork(f,kind){action(f,kind);await f.page.goto(`${base}/?section=now`);const item=f.page.locator(`[data-work-action="${TASK}"]`);await item.waitFor();await item.getByRole('link').first().click();await workspace(f).waitFor();}
async function capture(f,name,mobile){await f.page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`No horizontal overflow on ${name}`);await f.page.screenshot({path:`${output}/${mobile?'mobile':'desktop'}-${name}.png`,fullPage:true,animations:'disabled'});}
async function allScreensReadOnly(f){const snapshot=JSON.stringify([f.tables.colis,f.tables.factures,f.tables.messages]),count=f.commands.length;for(const task of ['reception','accord','preparation','documents','devis','paiement','expedition','livraison']){await openTaskNavigation(f);await taskSelect(f).selectOption(task);await f.page.waitForURL(url=>url.searchParams.get('section')===task);}assert.equal(JSON.stringify([f.tables.colis,f.tables.factures,f.tables.messages]),snapshot);assert.equal(f.commands.length,count);}

(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true}),results=[];
  async function scenario(name,run,options={}){
    if(process.env.PINTA_TASK_READINESS_FILTER&&!name.includes(process.env.PINTA_TASK_READINESS_FILTER)) return;
    const f=await fixture(browser,options);try{await f.page.setViewportSize(options.mobile?{width:390,height:844}:{width:1440,height:1000});await f.login();await run(f);assert.deepEqual(f.protocolErrors,[]);assert.deepEqual(f.errors,[]);assert.deepEqual(f.networkDenied,[]);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);results.push({test:name,pass:true});}
    catch(error){process.exitCode=1;results.push({test:name,pass:false,error:error.stack});await f.page.screenshot({path:`${output}/${name}.png`,fullPage:true}).catch(()=>{});await fs.writeFile(`${output}/${name}.txt`,await f.page.locator('body').innerText().catch(()=>''));}
    finally{await f.context.close();console.log(JSON.stringify(results.at(-1)));}
  }
  try{
    for(const mobile of [false,true])await scenario(`complete-receipt-client-approval-invoices-preparation-payment-delivery-${mobile?'mobile':'desktop'}`,async f=>{
      const row=f.tables.colis[0];Object.assign(row,{statut:'receptionne',feu_vert:'en_attente',final_packages:[],fin_l:null,fin_w:null,fin_h:null,fin_p:null,final_measurements_version:null,final_measurements_at:null,outgoing_parcel_count:null,mode_paiement_pro:'virement'});
      f.tables.clients[0].type='pro';
      await f.page.clock.setFixedTime(new Date(`${TEST_DAY}T12:00:00Z`));
      f.tables.envois=[{id:DEPARTURE,ref:'VOL-TEST',destination_code:'974',date_depart:TEST_DAY,statut:'planifie',updated_at:'2026-09-21T08:00:00Z',manifest_version:0}];
      const client=await setup(browser,'client');
      for(const key of ['colis','clients','factures','lignes','envois','messages'])client.tables[key]=f.tables[key];
      client.page.setDefaultTimeout(10000);await client.page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});
      await client.page.clock.setFixedTime(new Date(`${TEST_DAY}T12:00:00Z`));
      await client.context.route('**/rest/v1/rpc/client_decision',async route=>{
        const input=route.request().postDataJSON();assert.equal(row.statut,'attente_feu_vert');assert.equal(input.p_expected_updated_at,row.updated_at);assert.equal(input.p_action,'approve');
        f.commands.push({kind:'client_decision',input:clone(input)});Object.assign(row,{statut:'autorise',feu_vert:'autorise',feu_vert_date:new Date().toISOString()});advance(row);
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(row)});
      });
      try{
        await fromWork(f,'reception');assert.equal(new URL(f.page.url()).searchParams.get('section'),'reception');
        await capture(f,'01-reception',mobile);await workspace(f).getByRole('button',{name:'Enregistrer les mesures de réception',exact:true}).click();await workspace(f).getByRole('heading',{name:'Réception enregistrée',exact:true}).waitFor();assert.equal(row.statut,'mesure');assert.equal(f.tables.messages.length,0);
        // Documents are genuinely validated before approval; this neither grants consent nor measures outgoing parcels.
        await fromWork(f,'documents');await f.page.getByRole('button',{name:'Valider et passer à la suivante',exact:true}).waitFor();await capture(f,'04-factures',mobile);await f.page.getByRole('button',{name:'Valider et passer à la suivante',exact:true}).click();await waitForCurrentInvoice(f.page,C);
        await f.page.getByRole('button',{name:'Terminer la vérification',exact:true}).click();await f.page.getByText('Factures vérifiées',{exact:true}).waitFor();assert.equal(row.statut,'mesure');assert.equal(row.final_measurements_version,null);assert.ok(f.tables.factures.every(invoice=>invoice.valide));
        await fromWork(f,'reception');assert.equal(new URL(f.page.url()).searchParams.get('section'),'accord');
        await capture(f,'02-accord',mobile);await workspace(f).getByLabel('Message à envoyer au client',{exact:true}).waitFor();await workspace(f).getByLabel('Canal de notification',{exact:true}).selectOption('portal');
        await workspace(f).getByRole('button',{name:'Envoyer la demande d’accord',exact:true}).click();await workspace(f).getByText('Message disponible dans l’espace client.',{exact:true}).waitFor();assert.equal(row.statut,'attente_feu_vert');
        await client.login();await client.page.goto(`${base}/colis/${ids.P}`);await client.page.getByRole('button',{name:'Autoriser la préparation',exact:true}).waitFor();await capture(client,'client-accord',mobile);await client.page.getByRole('button',{name:'Autoriser la préparation',exact:true}).click();await client.page.getByRole('dialog').getByRole('button',{name:'J’autorise la préparation',exact:true}).click();await client.page.getByRole('heading',{name:'Votre accord est enregistré',exact:true}).waitFor();assert.equal(row.statut,'autorise');
        await fromWork(f,'preparation');assert.equal(await workspace(f).getByRole('button',{name:'Commencer la préparation',exact:true}).count(),0);
        for(const [label,unit,value] of [['Longueur','cm',30],['Largeur','cm',20],['Hauteur','cm',20],['Poids réel','kg',3]])await f.page.getByLabel(`${label} · colis sortant 1 (${unit})`,{exact:true}).fill(String(value));
        await capture(f,'03-preparation',mobile);await workspace(f).getByRole('button',{name:'Enregistrer l’optimisation',exact:true}).click();await workspace(f).getByRole('region',{name:'Relais après préparation',exact:true}).waitFor();assert.ok(certified(row));assert.deepEqual(row.dims_par_colis,received);
        await fromWork(f,'quote');assert.equal(await quoteSave(f).isEnabled(),true);await capture(f,'05-devis',mobile);await quoteSave(f).click();await workspace(f).getByRole('button',{name:'Envoyer le devis au client',exact:true}).click();await workspace(f).getByRole('heading',{name:'Devis enregistré',exact:true}).waitFor();assert.equal(row.statut,'devis_envoye');assert.equal(row.devis_brouillon,false);
        await openTaskNavigation(f);await taskSelect(f).selectOption('paiement');await capture(f,'06-paiement',mobile);await workspace(f).getByRole('button',{name:'Confirmer réception du paiement',exact:true}).click();await f.page.getByRole('dialog').getByRole('button',{name:'Confirmer le paiement reçu',exact:true}).click();await workspace(f).getByRole('heading',{name:'Paiement confirmé',exact:true}).waitFor();assert.equal(row.statut,'paye');assert.equal(row.paiement_montant,row.devis_total);
        await fromWork(f,'departure');await capture(f,'07-expedition',mobile);await workspace(f).getByRole('group',{name:'Affecter à un départ',exact:true}).locator(`[data-shortcut][data-envoi="${DEPARTURE}"]`).click();await workspace(f).getByText('Départ enregistré.',{exact:true}).waitFor();
        // Loading control (2026-10-07): the parcel is scanned before the confirmation, here through the mocked command.
        scanLoading(f,DEPARTURE,[ids.P]);
        await workspace(f).getByRole('button',{name:'Vérifier le départ et son manifeste',exact:true}).click();await f.page.getByRole('button',{name:'Vérifier et confirmer le chargement',exact:true}).click();await f.page.getByRole('checkbox',{name:/EXP-TEST-001/}).check();
        await f.page.getByRole('button',{name:'Confirmer le départ de 1 expédition',exact:true}).click();await f.page.getByRole('region',{name:'Manifeste confirmé',exact:true}).waitFor();assert.equal(row.statut,'expedie');
        assert.deepEqual(f.tables.departure_manifests[0].snapshot.items[0].loading_checks.map(check=>[check.colis_id,check.parcel_index,check.parcel_count,check.method,check.checked_by]),[[row.id,1,1,'scan',ids.A]],'The manifest keeps the loading check');
        await open(f,'expedition');await workspace(f).getByRole('button',{name:'Confirmer le départ en vol',exact:true}).click();await workspace(f).getByRole('button',{name:'Passer en dédouanement',exact:true}).click();await workspace(f).getByRole('button',{name:/^Confirmer l[’']arrivée à destination$/}).click();
        await workspace(f).getByRole('heading',{name:'Transport arrivé à destination',exact:true}).waitFor();assert.equal(row.statut,'arrive');assert.equal(await workspace(f).getByRole('button',{name:'Lancer la livraison',exact:true}).count(),0,'Transport history does not expose a delivery command');
        await openTaskNavigation(f);await taskSelect(f).selectOption('livraison');await capture(f,'08-livraison',mobile);await workspace(f).getByRole('button',{name:'Lancer la livraison',exact:true}).click();await workspace(f).getByRole('button',{name:'Confirmer la livraison',exact:true}).click();await f.page.getByRole('dialog').getByRole('button',{name:'Confirmer la livraison',exact:true}).click();await workspace(f).getByRole('heading',{name:'Livraison terminée',exact:true}).waitFor();assert.equal(row.statut,'livre');assert.ok(row.date_livraison);
        await client.page.reload();await client.page.getByRole('heading',{name:'Colis livré',exact:true}).waitFor();await capture(client,'client-livre',mobile);assert.equal(await client.page.getByRole('button',{name:/^Payer /}).count(),0);assert.deepEqual(client.errors,[]);assert.deepEqual(client.networkDenied,[]);
        await allScreensReadOnly(f);assert.equal(f.commands.filter(c=>c.kind==='save_quote').length,1);assert.equal(f.commands.filter(c=>c.kind==='mark_manual_payment').length,1);assert.equal(f.commands.filter(c=>c.kind==='confirm_departure').length,1);assert.equal(f.tables.messages.length,2,'Only the operator’s explicit approval request and quote notification were queued');
      }finally{await client.context.close();}
    },{mobile,invoices:true});
    for(const mobile of [false,true]) await scenario(`quote-only-operator-opens-ready-authorised-work-${mobile?'mobile':'desktop'}`,async f=>{
      const receipt=clone(f.tables.colis[0].dims_par_colis);await fromWork(f,'quote');assert.equal(new URL(f.page.url()).searchParams.get('section'),'devis');await quoteSave(f).waitFor();assert.equal(await quoteSave(f).isEnabled(),true);
      assert.equal(await workspace(f).getByRole('button',{name:'Commencer la préparation',exact:true}).count(),0);await quoteSave(f).click();await f.page.getByRole('button',{name:'Modifier le brouillon',exact:true}).waitFor();
      assert.equal(f.commands.filter(c=>c.kind==='save_quote').length,1);assert.equal(f.commands.filter(c=>['patch','save_preparation_measurements','queue_message'].includes(c.kind)).length,0);assert.equal(f.tables.colis[0].statut,'en_preparation');assert.deepEqual(f.tables.colis[0].dims_par_colis,receipt);
    },{mobile,permissions:{perm_colis_calculer_devis:true,perm_finances_voir_total:true},colis:{devis_envoye_le:'2025-06-01T08:00:00Z',devis_brouillon:true,devis_total:null}});
    for(const invalid of ['missing-count','wrong-count','stale-version','explicit-empty']) await scenario(`incomplete-certificate-${invalid}-opens-preparation-before-quote`,async f=>{
      const row=f.tables.colis[0];if(invalid==='missing-count') row.outgoing_parcel_count=null;if(invalid==='wrong-count')row.outgoing_parcel_count=2;if(invalid==='stale-version')row.final_measurements_version=0;if(invalid==='explicit-empty')row.final_packages=[];
      await fromWork(f,'quote');await workspace(f).getByRole('heading',{name:'Préparation à terminer avant le devis',exact:true}).waitFor();assert.equal(await quoteSave(f).count(),0);assert.equal(f.commands.length,0);
      await workspace(f).getByRole('button',{name:'Ouvrir l’optimisation',exact:true}).click();assert.equal(new URL(f.page.url()).searchParams.get('section'),'preparation');
      await f.page.getByLabel('Longueur · colis sortant 1 (cm)',{exact:true}).waitFor();
      for(const [label,unit,value] of [['Longueur','cm',30],['Largeur','cm',20],['Hauteur','cm',20],['Poids réel','kg',3]])await f.page.getByLabel(`${label} · colis sortant 1 (${unit})`,{exact:true}).fill(String(value));
      await workspace(f).getByRole('button',{name:'Enregistrer l’optimisation',exact:true}).click();await workspace(f).getByRole('region',{name:'Relais après préparation',exact:true}).waitFor();
      assert.ok(certified(row));await openTaskNavigation(f);await taskSelect(f).selectOption('devis');assert.equal(await quoteSave(f).isEnabled(),true);await quoteSave(f).click();await workspace(f).getByRole('button',{name:'Modifier le brouillon',exact:true}).waitFor();assert.equal(f.commands.filter(c=>c.kind==='save_quote').length,1);
    },{colis:{statut:'en_preparation'}});
    await scenario('preparation-only-role-saves-without-invoices-and-never-enters-quote',async f=>{
      f.tables.factures=[];f.tables.lignes=[];await fromWork(f,'preparation');assert.equal(await workspace(f).getByRole('button',{name:'Commencer la préparation',exact:true}).count(),0);
      await f.page.getByLabel('Longueur · colis sortant 1 (cm)',{exact:true}).waitFor();for(const [label,unit,value] of [['Longueur','cm',30],['Largeur','cm',20],['Hauteur','cm',20],['Poids réel','kg',3]])await f.page.getByLabel(`${label} · colis sortant 1 (${unit})`,{exact:true}).fill(String(value));
      await workspace(f).getByRole('button',{name:'Enregistrer l’optimisation',exact:true}).click();await workspace(f).getByRole('region',{name:'Relais après préparation',exact:true}).waitFor();assert.ok(certified(f.tables.colis[0]));
      assert.equal(await taskSelect(f).locator('option[value="devis"]').count(),0);assert.equal(f.commands.filter(c=>['save_quote','queue_message'].includes(c.kind)).length,0);
    },{permissions:{perm_colis_preparer:true},colis:{final_packages:[],final_measurements_version:null,outgoing_parcel_count:null}});
    await scenario('historical-snapshot-can-certify-identical-preserved-measurements',async f=>{
      const before=clone(f.tables.colis[0].final_packages);await fromWork(f,'preparation');
      const revision=f.page.getByTestId('shipment-revision-preparation');await revision.getByRole('button',{name:'Modifier',exact:true}).click();
      const save=revision.getByRole('button',{name:/Enregistrer/});assert.equal(await save.isEnabled(),true,'Missing certificate is a real change even when measurements are identical');await save.click();
      const confirmation=f.page.getByRole('dialog');if(await confirmation.count())await confirmation.getByRole('button',{name:/Confirmer|Enregistrer/}).click();
      await revision.getByRole('button',{name:'Modifier',exact:true}).waitFor();assert.deepEqual(f.tables.colis[0].final_packages,before);assert.ok(certified(f.tables.colis[0]));assert.equal(f.commands.filter(c=>c.kind==='correct_colis_task').length,1);assert.equal(f.commands.filter(c=>c.kind==='queue_message').length,0);
    },{colis:{devis_snapshot:{inputs:{finalPackages:[box]},amounts:{total:70}},devis_total:70,outgoing_parcel_count:null}});
    await scenario('historical-measurements-require-correction-right-before-recertification',async f=>{
      await fromWork(f,'preparation');const revision=f.page.getByTestId('shipment-revision-preparation');await revision.waitFor();
      assert.equal(await revision.getByRole('button',{name:'Modifier',exact:true}).count(),0);assert.match(await workspace(f).innerText(),/consulter.*sans les modifier|collègue|habilitée/);assert.equal(f.commands.length,0);
    },{permissions:{perm_colis_preparer:true},colis:{devis_snapshot:{inputs:{finalPackages:[box]},amounts:{total:70}},devis_total:70,outgoing_parcel_count:null}});
    await scenario('preparation-corrector-without-quote-right-gets-an-accessible-next-step',async f=>{
      await fromWork(f,'preparation');const revision=f.page.getByTestId('shipment-revision-preparation');await revision.getByRole('button',{name:'Modifier',exact:true}).click();await revision.getByRole('button',{name:'Enregistrer',exact:true}).click();
      await f.page.getByText(/Mesures après optimisation enregistrées/).waitFor();assert.ok(certified(f.tables.colis[0]));
      assert.equal(await workspace(f).getByRole('button',{name:/^(Voir|Ouvrir) le devis$/}).count(),0);assert.equal(await taskSelect(f).locator('option[value="devis"]').count(),0);
      assert.equal(f.commands.filter(c=>c.kind==='correct_colis_task').length,1);assert.equal(f.commands.filter(c=>['save_quote','queue_message'].includes(c.kind)).length,0);
    },{permissions:{perm_colis_preparer:true,perm_colis_revenir_arriere:true},colis:{devis_snapshot:{inputs:{finalPackages:[box]},amounts:{total:70}},devis_total:70,outgoing_parcel_count:null}});
    await scenario('ready-physical-preparation-with-missing-invoices-opens-real-document-task',async f=>{
      f.tables.factures=[];f.tables.lignes=[];await fromWork(f,'quote');await workspace(f).getByRole('heading',{name:'Factures à vérifier avant le devis',exact:true}).waitFor();assert.equal(await quoteSave(f).count(),0);
      await workspace(f).getByRole('button',{name:'Vérifier les factures d’achat',exact:true}).click();assert.equal(new URL(f.page.url()).searchParams.get('section'),'documents');await f.page.getByTestId('documents-task').getByText('Aucune facture enregistrée.',{exact:true}).waitFor();assert.equal(f.commands.length,0);
    });
    const senderRights={perm_colis_calculer_devis:true,perm_colis_envoyer_devis:true,perm_finances_voir_total:true};
    await scenario('send-only-role-reviews-saved-quote-without-editable-money-or-payment-method',async f=>{
      f.tables.clients[0].type='pro';Object.assign(f.tables.colis[0],{mode_paiement_pro:'virement',frais_divers:[{libelle:'Protection',montant:3}]});
      await fromWork(f,'quote');await quoteSave(f).click();await workspace(f).getByRole('button',{name:'Modifier le brouillon',exact:true}).waitFor();const saved=clone(f.tables.colis[0].devis_snapshot);
      senderRights.perm_colis_calculer_devis=false;f.tables.staff_permissions[0].perm_colis_calculer_devis=false;
      await fromWork(f,'quote');const send=workspace(f).getByRole('button',{name:'Envoyer le devis au client',exact:true});await send.waitFor();assert.equal(await send.isEnabled(),true);
      assert.equal(await workspace(f).getByRole('button',{name:'Modifier le brouillon',exact:true}).count(),0);assert.equal(await workspace(f).getByRole('button',{name:'Retirer Protection',exact:true}).count(),0);
      assert.equal(await workspace(f).getByLabel('Libellé du frais',{exact:true}).count(),0);assert.equal(await workspace(f).getByLabel('Montant du frais',{exact:true}).count(),0);assert.equal(await workspace(f).locator('select').count(),0);
      await send.click();await workspace(f).getByRole('heading',{name:'Devis enregistré',exact:true}).waitFor();assert.equal(f.tables.colis[0].statut,'devis_envoye');assert.deepEqual(f.tables.colis[0].devis_snapshot,saved);
      assert.equal(f.commands.filter(c=>c.kind==='save_quote').length,1);assert.equal(f.commands.filter(c=>c.kind==='queue_message').length,1);
    },{permissions:senderRights});
    await scenario('certified-null-legacy-packages-use-one-scalar-box-without-artificial-preparation',async f=>{
      await fromWork(f,'quote');assert.equal(await quoteSave(f).isEnabled(),true);await quoteSave(f).click();await workspace(f).getByRole('button',{name:'Modifier le brouillon',exact:true}).waitFor();
      assert.equal(f.commands.filter(command=>command.kind==='save_quote').length,1);assert.equal(f.commands.filter(command=>['patch','save_preparation_measurements'].includes(command.kind)).length,0);
    },{colis:{final_packages:null,outgoing_parcel_count:1}});
    for(const state of ['mesure','attente_feu_vert','refuse_client']) await scenario(`old-preparation-and-quote-never-bypass-${state}`,async f=>{
      Object.assign(f.tables.colis[0],{statut:state,feu_vert:state==='refuse_client'?'refuse':'en_attente',devis_envoye_le:'2025-06-01T08:00:00Z',devis_total:null,devis_brouillon:true,...(state==='attente_feu_vert'?{attente_client_date:'2025-06-01T08:00:00Z',attente_client_until:'2025-06-02T08:00:00Z'}:{})});
      await open(f,'accord');await allScreensReadOnly(f);await openTaskNavigation(f);await taskSelect(f).selectOption('devis');assert.equal(await quoteSave(f).count(),0);assert.equal(f.commands.length,0);
      await openTaskNavigation(f);await taskSelect(f).selectOption('preparation');assert.equal(await workspace(f).getByRole('button',{name:'Commencer la préparation',exact:true}).count(),0);assert.equal(await workspace(f).getByRole('button',{name:'Enregistrer l’optimisation',exact:true}).count(),0);
    });
    for(const closed of ['archive','paid'])await scenario(`read-only-navigation-for-${closed}-dossier`,async f=>{
      Object.assign(f.tables.colis[0],closed==='archive'?{archive:true}:{statut:'paye',paiement_date:'2026-09-18T08:00:00Z',paiement_montant:70,devis_total:70});await open(f,'reception');await allScreensReadOnly(f);assert.equal(f.commands.length,0);
      await openTaskNavigation(f);await taskSelect(f).selectOption('preparation');assert.equal(await workspace(f).getByRole('button',{name:'Modifier',exact:true}).count(),0);await openTaskNavigation(f);await taskSelect(f).selectOption('devis');assert.equal(await quoteSave(f).count() ? await quoteSave(f).isEnabled() : false,false);
    });
  }finally{await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
