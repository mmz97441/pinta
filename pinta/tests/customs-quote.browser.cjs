const { openTaskNavigation } = require('./task-navigation.helper.cjs');
/* Customs UI on synthetic dossiers only: every external API is intercepted. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_CUSTOMS_OUT || '/tmp/pinta-customs-quote';
const T = '84444444-4444-4444-8444-444444444441';
const catalog = [
  { id:T,code:'01012100',label:'Chevaux reproducteurs de race pure',om:10,omr:2.5,destination_code:'974',source_id:'2026',source_label:'Tarif officiel fictif 2026',source_url:'https://example.test/tarif.pdf',source_date:'2026-01-01',source_status:'reference',page:7 },
  { id:'84444444-4444-4444-8444-444444444442',code:'01012100',label:'Variante sous condition particulière',om:0,omr:0,destination_code:'974',conditions:'Exclusivement pour les reproducteurs certifiés.',source_id:'2026',source_label:'Tarif officiel fictif 2026',source_date:'2026-01-01',source_status:'reference',page:8 },
  { id:'84444444-4444-4444-8444-444444444443',code:'0101210090',label:'Autre sous-position à vérifier',om:null,omr:null,destination_code:'974',source_id:'2024',source_label:'Tarif historique fictif 2024',source_date:'2024-01-01',source_status:'historical',notes:'Taux non déterminé dans la ligne source.',page:9 },
];
const mapped = row => ({tariffId:row.id,code:row.code,label:row.label,destination:row.destination_code,baseRates:{om:row.om,omr:row.omr},rates:{om:row.om,omr:row.omr},source:{id:row.source_id,label:row.source_label,url:row.source_url,date:row.source_date,status:row.source_status,page:row.page},notes:row.notes||'',conditions:row.conditions||'',overrideReason:null,fingerprint:'fixture-'+row.id});
const panel = f => f.page.getByRole('region',{name:'Classement douanier du devis',exact:true});
const mainSave = f => f.page.getByRole('button',{name:'Enregistrer et vérifier le devis',exact:true});
const apply = f => panel(f).getByRole('button',{name:'Appliquer au devis',exact:true});
const writes = f => f.requests.filter(r=>['POST','PATCH','DELETE'].includes(r.method)&&/\/(factures|lignes|categories|taux_categories|save_quote|queue_message)$/.test(r.path));
async function fixture(browser,options={}) {
 const f=await setup(browser,options.role||'directeur');f.page.setDefaultTimeout(10000);
 if(options.permissions){const row={id:'customs-permission',staff_id:ids.S,...options.permissions};f.tables.staff_permissions=[row];f.tables.staff_users[0].staff_permissions=row;}
 f.calls=[];f.control={fail:false,suggestFail:false,suggestDelay:false,pendingSuggestions:[]};
 const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 await f.context.route('**/rest/v1/rpc/suggest_customs_tariffs',async route=>{
  const input=route.request().postDataJSON();f.calls.push({kind:'suggest',input});
  const response=input.p_items.map(item=>({lineId:item.lineId,candidates:(typeof options.suggestions==='function'?options.suggestions(item):options.suggestions?catalog:[]).map(row=>({...row,matchReason:'Mots du libellé à vérifier dans le catalogue.'})),status:options.suggestions?'suggestions':'no_match',notice:options.noMatchNotice||null,requiresReview:true}));
  if(f.control.suggestDelay)await new Promise(resolve=>f.control.pendingSuggestions.push(resolve));
  if(f.control.suggestFail){f.control.suggestFail=false;return reply(route,{message:'Recherche momentanément indisponible.'},503);}
  return reply(route,response);
 });
 await f.context.route('**/rest/v1/rpc/search_customs_tariffs',route=>{const input=route.request().postDataJSON();f.calls.push({kind:'search',input});return reply(route,catalog.filter(row=>row.destination_code===input.p_destination));});
 await f.context.route('**/functions/v1/correct-colis-task',route=>{
  const input=route.request().postDataJSON();f.calls.push({kind:'reopen',input});const row=f.tables.colis.find(p=>p.id===input.colisId);
  assert.equal(input.task,'devis');assert.equal(input.expectedUpdatedAt,row.updated_at);
  Object.assign(row,{updated_at:new Date(Math.max(Date.now(),Date.parse(row.updated_at))+1000).toISOString(),statut:'en_preparation',devis_total:null,devis_snapshot:null,devis_brouillon:true,payplug_payment_url:null,payplug_payment_id:null});
  return reply(route,{colis:row,changed:true,invalidated:['devis']});
 });
 await f.context.route('**/rest/v1/rpc/save_quote_customs',route=>{
  const input=route.request().postDataJSON();f.calls.push({kind:'save',input});const row=f.tables.colis.find(p=>p.id===input.p_colis_id);
  if(f.control.fail){f.control.fail=false;return reply(route,{message:'Erreur réseau simulée. Votre saisie est conservée.'},503);}
  if(f.control.bumpOnSave){f.control.bumpOnSave=false;row.updated_at=new Date(Date.now()+60000).toISOString();}
  if(input.p_expected_updated_at!==row.updated_at)return reply(route,{code:'40001',message:'Le dossier a changé. Actualisez avant de poursuivre.'},409);
  for(const change of input.p_changes){const line=f.tables.lignes.find(l=>l.id===change.lineId);const tariff=catalog.find(t=>t.id===change.tariffId);line.custom_duty={...mapped(tariff),rates:change.override?{om:change.override.om,omr:change.override.omr}:{om:tariff.om,omr:tariff.omr},overrideReason:change.override?.reason||null};}
  Object.assign(row,{updated_at:new Date(Math.max(Date.now(),Date.parse(row.updated_at))+1000).toISOString(),statut:'en_preparation',devis_total:null,devis_snapshot:null,devis_brouillon:true,payplug_payment_url:null});
  return reply(route,{colis:row,lines:f.tables.lignes.filter(l=>l.colis_id===row.id)});
 });
 return f;
}
async function open(f){await f.login();await f.page.goto(`${base}/colis/${ids.P}?section=devis`);await panel(f).waitFor();}
async function edit(f){await panel(f).getByRole('button',{name:'Classer l’article 1',exact:true}).click();}
async function choose(f,index=0){await panel(f).getByLabel('Rechercher un code ou un libellé douanier',{exact:true}).fill(catalog[index].code);await panel(f).getByRole('button',{name:'Rechercher la nomenclature',exact:true}).click();await panel(f).getByRole('button',{name:`Choisir ${catalog[index].code} — ${catalog[index].label}`,exact:true}).click();}
async function saved(f){await panel(f).getByRole('status').filter({hasText:'Classement douanier enregistré.'}).waitFor();}
async function updateOther(f){await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));}
const results=[];
(async()=>{await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true});async function scenario(name,options,run){if(process.env.PINTA_CUSTOMS_FILTER&&!name.includes(process.env.PINTA_CUSTOMS_FILTER))return;const f=await fixture(browser,options);try{await run(f);assert.deepEqual(f.errors,[]);assert.deepEqual(f.networkDenied,[]);assert.equal(f.requests.some(r=>r.path.endsWith('/queue_message')),false);results.push({test:name,pass:true});}catch(e){results.push({test:name,pass:false,error:e.stack});process.exitCode=1;await f.page.screenshot({path:`${output}/${name}.png`,fullPage:true}).catch(()=>{});await fs.writeFile(`${output}/${name}.txt`,await f.page.locator('body').innerText().catch(()=>''));}finally{await f.context.close();}}
try{
 for(const mobile of [false,true])await scenario(`direct-rate-correction-opens-recorded-values-and-saves-only-this-quote-${mobile?'mobile':'desktop'}`,{},async f=>{
  const mappedDuty=mapped(catalog[0]);f.tables.lignes[0].custom_duty=mappedDuty;
  const original={invoice:structuredClone(f.tables.factures),catalog:structuredClone(f.tables.taux_categories),category:structuredClone(f.tables.categories),measures:structuredClone(f.tables.colis[0].final_packages)};
  await f.page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});await open(f);
  await panel(f).getByRole('button',{name:'Corriger les taux OM et OMR de l’article 1',exact:true}).click();
  const om=panel(f).getByLabel('Taux OM (%)',{exact:true}),omr=panel(f).getByLabel('Taux OMR (%)',{exact:true});await om.waitFor();
  assert.equal(await om.inputValue(),'10');assert.equal(await omr.inputValue(),'2.5');
  await f.page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Taux OM (%)');
  assert.equal(await panel(f).getByRole('search').count(),0,'Correcting known rates does not require another catalogue search.');
  assert.equal(f.calls.filter(call=>['search','save','reopen'].includes(call.kind)).length,0);
  await om.fill('0');await om.press('Tab');assert.equal(await omr.evaluate(node=>document.activeElement===node),true);
  await omr.fill('3.125');await omr.press('Tab');
  const reason=panel(f).getByLabel('Motif de la correction douanière');assert.equal(await reason.evaluate(node=>document.activeElement===node),true);
  await reason.fill('Taux vérifiés pour cette expédition uniquement.');
  await f.page.screenshot({path:`${output}/direct-rate-correction-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  if(mobile){
   await reason.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const focused=await reason.evaluate(node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,visible:node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
   const nav=await f.page.getByRole('button',{name:'Dossiers',exact:true}).locator('..').boundingBox();
   assert.ok(focused.visible&&focused.top>=44&&focused.bottom<=nav.y,'The correction reason reached with Tab remains fully visible; the quote bar must not cover it.');
   await reason.press('Tab');await f.page.keyboard.press('Tab');
   assert.equal(await apply(f).evaluate(node=>document.activeElement===node),true,'Keyboard progression reaches the explicit apply action.');
   const action=await apply(f).evaluate(node=>{const r=node.getBoundingClientRect();return {bottom:r.bottom,visible:node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
   assert.ok(action.visible&&action.bottom<=nav.y,'Applying the correction is reachable above the mobile navigation.');
  }
  assert.equal(await mainSave(f).isDisabled(),true);
  await apply(f).click();await saved(f);
  const command=f.calls.filter(call=>call.kind==='save');assert.equal(command.length,1);assert.equal(command[0].input.p_changes[0].tariffId,T);
  assert.deepEqual(command[0].input.p_changes[0].override,{om:0,omr:3.125,reason:'Taux vérifiés pour cette expédition uniquement.'});
  assert.equal(f.tables.lignes[0].custom_duty.code,mappedDuty.code);assert.deepEqual(f.tables.lignes[0].custom_duty.rates,{om:0,omr:3.125});
  assert.deepEqual(f.tables.factures,original.invoice);assert.deepEqual(f.tables.taux_categories,original.catalog);assert.deepEqual(f.tables.categories,original.category);assert.deepEqual(f.tables.colis[0].final_packages,original.measures);
  assert.equal(f.tables.colis[0].devis_total,null);assert.equal(await mainSave(f).isEnabled(),true);assert.deepEqual(writes(f),[]);
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 });
 await scenario('overview-quote-shortcut-opens-saved-draft-editor-without-withdrawing-or-resaving',{},async f=>{
  f.tables.lignes[0].custom_duty=mapped(catalog[0]);await open(f);await mainSave(f).click();
  await f.page.getByRole('button',{name:'Envoyer le devis au client',exact:true}).waitFor();const before=structuredClone(f.tables.colis[0]);const count=f.requests.filter(r=>r.path.endsWith('/save_quote')).length;
  await f.page.getByTestId('dossier-overview').getByRole('button',{name:'Modifier le devis et les taux',exact:true}).click();await panel(f).waitFor();await mainSave(f).waitFor();
  assert.equal(f.calls.filter(c=>['save','reopen'].includes(c.kind)).length,0);assert.equal(f.requests.filter(r=>r.path.endsWith('/save_quote')).length,count);assert.deepEqual(f.tables.colis[0],before);
  await panel(f).getByRole('button',{name:'Corriger les taux OM et OMR de l’article 1',exact:true}).click();await panel(f).getByLabel('Taux OM (%)',{exact:true}).waitFor();assert.equal(await panel(f).getByLabel('Taux OM (%)',{exact:true}).inputValue(),'10');
 });
 await scenario('direct-rate-correction-keeps-existing-override-and-unsaved-draft',{},async f=>{
  f.tables.lignes[0].custom_duty={...mapped(catalog[0]),rates:{om:7,omr:1.25},overrideReason:'Correction déjà vérifiée.'};
  await open(f);const shortcut=panel(f).getByRole('button',{name:'Corriger les taux OM et OMR de l’article 1',exact:true});await shortcut.click();
  const om=panel(f).getByLabel('Taux OM (%)',{exact:true});await om.waitFor();assert.equal(await om.inputValue(),'7');
  assert.equal(await panel(f).getByLabel('Taux OMR (%)',{exact:true}).inputValue(),'1.25');assert.equal(await panel(f).getByLabel('Motif de la correction douanière').inputValue(),'Correction déjà vérifiée.');
  await om.fill('8');await panel(f).getByLabel('Motif de la correction douanière').fill('Brouillon à conserver lors du retour.');
  await f.page.getByRole('tab',{name:/^Conversation/}).click();await panel(f).waitFor({state:'hidden'});
  await f.page.getByRole('tab',{name:'Colis',exact:true}).click();await panel(f).waitFor();await shortcut.click();await om.waitFor();
  assert.equal(await om.inputValue(),'8');assert.equal(await panel(f).getByLabel('Motif de la correction douanière').inputValue(),'Brouillon à conserver lors du retour.');
  assert.equal(f.tables.lignes[0].custom_duty.rates.om,7);assert.equal(f.calls.filter(call=>['save','reopen'].includes(call.kind)).length,0);assert.deepEqual(writes(f),[]);
 });
 await scenario('renewed-agreement-allows-stale-customs-correction-before-quote',{},async f=>{
  const row=f.tables.colis[0];Object.assign(row,{statut:'autorise',feu_vert:'autorise'});
  f.tables.lignes[0].custom_duty={...mapped(catalog[0]),stale:true};
  const measures=structuredClone(row.final_packages),receipt=structuredClone(row.dims_par_colis);
  await open(f);assert.equal(row.statut,'autorise');assert.equal(f.calls.filter(c=>c.kind==='save').length,0);
  assert.equal(await mainSave(f).isDisabled(),true);await edit(f);await choose(f);await apply(f).click();await saved(f);
  assert.equal(row.statut,'en_preparation');assert.deepEqual(row.final_packages,measures);assert.deepEqual(row.dims_par_colis,receipt);
  assert.equal(f.calls.filter(c=>c.kind==='save').length,1);assert.equal(await mainSave(f).isEnabled(),true);assert.deepEqual(writes(f),[]);
 });
 await scenario('search-choice-save-quote-preserves-invoice-and-global-catalogue',{},async f=>{
  await open(f);const original=structuredClone(f.tables.factures);await edit(f);assert.equal(await mainSave(f).isDisabled(),true);
  const query=panel(f).getByLabel('Rechercher un code ou un libellé douanier',{exact:true});await query.fill('chevaux');await query.press('Enter');await panel(f).getByRole('list',{name:'Résultats de nomenclature'}).waitFor();assert.equal(f.calls.filter(c=>c.kind==='save').length,0);await panel(f).getByRole('button',{name:`Choisir ${catalog[0].code} — ${catalog[0].label}`,exact:true}).click();assert.equal(await mainSave(f).isDisabled(),true);await apply(f).click();await saved(f);assert.equal(f.tables.lignes[0].custom_duty.code,'01012100');assert.deepEqual(f.tables.factures,original);assert.deepEqual(writes(f),[]);assert.equal(await mainSave(f).isEnabled(),true);
  await mainSave(f).click();await f.page.getByRole('button',{name:'Envoyer le devis au client',exact:true}).waitFor();const request=f.requests.find(r=>r.path.endsWith('/save_quote'));assert.equal(request.input.p_snapshot.inputs.lines[0].customDuty.code,'01012100');assert.equal(f.calls.find(c=>c.kind==='search').input.p_query,'chevaux');
 });
 await scenario('manual-rates-require-two-values-and-public-reason-zero-is-valid',{},async f=>{
  await open(f);const amountBefore=await f.page.locator('[aria-label="Résumé du devis"]').innerText();await edit(f);await choose(f);await panel(f).getByRole('button',{name:'Corriger les taux pour ce devis'}).click();await panel(f).getByLabel('Taux OM (%)',{exact:true}).fill('-1');await apply(f).click();await panel(f).getByRole('alert').filter({hasText:'entre 0 et 100'}).waitFor();assert.equal(f.calls.filter(c=>c.kind==='save').length,0);await panel(f).getByLabel('Taux OM (%)',{exact:true}).fill('0');await panel(f).getByLabel('Taux OMR (%)',{exact:true}).fill('3.125');await apply(f).click();await panel(f).getByRole('alert').filter({hasText:'motif'}).waitFor();await panel(f).getByLabel('Motif de la correction douanière').fill('Taux confirmé pour cet article.');await apply(f).click();await saved(f);assert.deepEqual(f.tables.lignes[0].custom_duty.rates,{om:0,omr:3.125});assert.notEqual(await f.page.locator('[aria-label="Résumé du devis"]').innerText(),amountBefore);await f.page.reload();await panel(f).getByText(/Enregistré : OM 0 % · OMR 3,125 %/).waitFor();assert.equal(f.calls.find(c=>c.kind==='save').input.p_changes[0].override.reason,'Taux confirmé pour cet article.');assert.deepEqual(writes(f),[]);
  await edit(f);await panel(f).getByRole('button',{name:'Reprendre les taux du référentiel'}).click();await apply(f).click();await saved(f);assert.deepEqual(f.tables.lignes[0].custom_duty.rates,{om:10,omr:2.5});assert.equal(f.calls.filter(c=>c.kind==='save')[1].input.p_changes[0].override,null);
 });
 await scenario('conditional-variant-requires-human-confirmation',{},async f=>{
  await open(f);await edit(f);await choose(f,1);await panel(f).getByText(/Conditions d’application : Exclusivement/).waitFor();await apply(f).click();await panel(f).getByRole('alert').filter({hasText:'Confirmez'}).waitFor();assert.equal(f.calls.filter(c=>c.kind==='save').length,0);await panel(f).getByRole('checkbox',{name:/J’ai vérifié/}).check();await apply(f).click();await saved(f);assert.equal(f.tables.lignes[0].custom_duty.tariffId,catalog[1].id);assert.equal(f.tables.lignes[0].custom_duty.rates.om,0);
 });
 await scenario('historical-ten-digit-code-with-unknown-rates-needs-manual-proof',{},async f=>{
  await open(f);await edit(f);await choose(f,2);await panel(f).getByText(/Source historique/).waitFor();await panel(f).getByRole('checkbox',{name:/J’ai vérifié/}).check();await apply(f).click();await panel(f).getByRole('alert').filter({hasText:'Les taux de cette référence'}).waitFor();assert.equal(f.calls.filter(c=>c.kind==='save').length,0);await panel(f).getByRole('button',{name:'Corriger les taux pour ce devis'}).click();await panel(f).getByLabel('Taux OM (%)',{exact:true}).fill('1');await panel(f).getByLabel('Taux OMR (%)',{exact:true}).fill('0');await panel(f).getByLabel('Motif de la correction douanière').fill('Référence vérifiée pour ce devis.');await apply(f).click();await saved(f);assert.equal(f.tables.lignes[0].custom_duty.code,'0101210090');assert.equal(await mainSave(f).isEnabled(),true);
 });
 await scenario('draft-survives-task-switch-and-network-error',{},async f=>{
  await open(f);await edit(f);await choose(f);await panel(f).getByRole('button',{name:'Corriger les taux pour ce devis'}).click();await panel(f).getByLabel('Taux OM (%)',{exact:true}).fill('7');await panel(f).getByLabel('Motif de la correction douanière').fill('Correction conservée pendant vérification.');await openTaskNavigation(f);await f.page.getByLabel('Tâche du dossier',{exact:true}).selectOption('documents');await openTaskNavigation(f);await f.page.getByLabel('Tâche du dossier',{exact:true}).selectOption('devis');await panel(f).getByLabel('Taux OM (%)',{exact:true}).waitFor();assert.equal(await panel(f).getByLabel('Taux OM (%)',{exact:true}).inputValue(),'7');assert.equal(await mainSave(f).isDisabled(),true);f.control.fail=true;await apply(f).click();await panel(f).getByRole('alert').filter({hasText:'Erreur réseau'}).waitFor();assert.equal(await panel(f).getByLabel('Taux OM (%)',{exact:true}).inputValue(),'7');await apply(f).click();await saved(f);assert.equal(f.calls.filter(c=>c.kind==='save').length,2);assert.equal(f.tables.lignes[0].custom_duty.rates.om,7);assert.deepEqual(writes(f),[]);
 });
 await scenario('colleague-classification-conflict-preserves-local-draft',{},async f=>{
  await open(f);await edit(f);await choose(f);f.tables.lignes[0].custom_duty={...mapped(catalog[0]),rates:{om:15,omr:2.5},overrideReason:'Correction du collègue'};f.tables.colis[0].updated_at=new Date(Date.now()+60000).toISOString();await updateOther(f);await panel(f).getByRole('alert').filter({hasText:'Le dossier a changé'}).waitFor();assert.equal(await apply(f).isDisabled(),true);assert.equal(await panel(f).getByRole('button',{name:'Conserver ma saisie et réessayer'}).count(),0);await panel(f).getByText(/Enregistré : OM 15/).waitFor();await panel(f).getByText(/Choisi : 01012100/).waitFor();assert.equal(f.calls.filter(c=>c.kind==='save').length,0);await panel(f).getByRole('button',{name:'Abandonner la saisie',exact:true}).click();await f.page.getByRole('dialog').getByRole('button',{name:'Annuler',exact:true}).click();await panel(f).getByText(/Modification non enregistrée/).waitFor();assert.equal(f.tables.lignes[0].custom_duty.rates.om,15);
 });
 await scenario('server-cas-conflict-needs-refresh-and-explicit-retry',{},async f=>{
  await open(f);await edit(f);await choose(f);const originalVersion=f.tables.colis[0].updated_at;f.control.bumpOnSave=true;await apply(f).click();await panel(f).getByRole('alert').filter({hasText:'Le dossier a changé. Votre saisie'}).waitFor();assert.equal(await apply(f).isDisabled(),true);assert.equal(f.calls.filter(c=>c.kind==='save').length,1);await panel(f).getByRole('button',{name:'Actualiser sans perdre ma saisie'}).click();await panel(f).getByRole('button',{name:'Conserver ma saisie et réessayer'}).click();assert.equal(f.calls.filter(c=>c.kind==='save').length,1);await apply(f).click();await saved(f);const calls=f.calls.filter(c=>c.kind==='save');assert.equal(calls.length,2);assert.equal(calls[0].input.p_expected_updated_at,originalVersion);assert.notEqual(calls[1].input.p_expected_updated_at,originalVersion);assert.deepEqual(writes(f),[]);
 });
 await scenario('parallel-fee-draft-survives-customs-save-with-new-version',{},async f=>{
  await open(f);await f.page.getByText('Ajouter un frais',{exact:true}).click();await f.page.getByLabel('Libellé du frais').fill('Emballage');await f.page.getByLabel('Montant du frais').fill('7');await f.page.getByRole('button',{name:'Ajouter le frais',exact:true}).click();await edit(f);await choose(f);await apply(f).click();await saved(f);const savedVersion=f.tables.colis[0].updated_at;assert.equal(await mainSave(f).isEnabled(),true);await mainSave(f).click();await f.page.getByRole('button',{name:'Envoyer le devis au client',exact:true}).waitFor();const quote=f.requests.find(r=>r.path.endsWith('/save_quote')).input;assert.equal(quote.p_expected_updated_at,savedVersion);assert.equal(quote.p_snapshot.inputs.fees[0].montant,7);assert.equal(quote.p_snapshot.inputs.lines[0].customDuty.code,'01012100');
 });
 await scenario('published-quote-reclassification-requires-withdrawal-confirmation',{},async f=>{
  Object.assign(f.tables.colis[0],{statut:'devis_envoye',devis_total:77,devis_brouillon:false,payplug_payment_id:'fixture-unpaid',payplug_payment_url:'https://example.test/payment'});
  const before=structuredClone(f.tables.colis[0]);await f.login();await f.page.goto(`${base}/colis/${ids.P}?section=devis`);
  await f.page.getByRole('heading',{name:'Devis enregistré',exact:true}).waitFor();assert.equal(await panel(f).count(),0);
  const reopen=f.page.getByRole('region',{name:'Reprise du devis',exact:true});await reopen.getByRole('button',{name:'Modifier le devis',exact:true}).click();await reopen.getByText(/lien de paiement seront retirés/).waitFor();
  await reopen.getByRole('button',{name:'Annuler',exact:true}).click();assert.equal(f.calls.filter(c=>c.kind==='reopen'||c.kind==='save').length,0);assert.deepEqual(f.tables.colis[0],before);
  await reopen.getByRole('button',{name:'Modifier le devis',exact:true}).click();await reopen.getByRole('button',{name:'Reprendre le devis',exact:true}).click();await panel(f).waitFor();
  assert.equal(f.calls.filter(c=>c.kind==='reopen').length,1);assert.equal(f.tables.colis[0].payplug_payment_url,null);
  await edit(f);await choose(f);await apply(f).click();await saved(f);await mainSave(f).waitFor();assert.equal(f.tables.colis[0].statut,'en_preparation');assert.equal(f.calls.filter(c=>c.kind==='save').length,1);assert.deepEqual(writes(f),[]);
 });
 await scenario('calculator-without-invoice-permission-can-classify-mobile', {role:'preparateur',permissions:{perm_colis_calculer_devis:true,perm_factures_voir:false,perm_factures_modifier_articles:false,perm_factures_valider:false}},async f=>{
  await f.page.setViewportSize({width:390,height:844});await open(f);await edit(f);await choose(f);assert.equal(await f.page.getByTestId('documents-task').count(),0);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await panel(f).getByText(/Choisi : 01012100/).scrollIntoViewIfNeeded();await f.page.screenshot({path:`${output}/customs-edit-mobile.png`});await apply(f).click();await saved(f);const axe=await new AxeBuilder({page:f.page}).include('#quote-customs').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);await panel(f).scrollIntoViewIfNeeded();await f.page.screenshot({path:`${output}/customs-mobile.png`});
 });
 await scenario('other-destination-explains-unavailable-catalogue-without-reunion-fallback',{},async f=>{
  f.tables.clients[0].cp='97200';await open(f);await panel(f).getByText(/Aucun barème douanier n’est chargé pour cette destination/).waitFor();await edit(f);await panel(f).getByLabel('Rechercher un code ou un libellé douanier').fill('cheval');await panel(f).getByRole('button',{name:'Rechercher la nomenclature'}).click();await panel(f).getByRole('status').filter({hasText:'Aucun résultat'}).waitFor();assert.equal(f.calls.find(c=>c.kind==='search').input.p_destination,'972');assert.equal(f.calls.filter(c=>c.kind==='save').length,0);assert.equal(f.calls.filter(c=>c.kind==='suggest').length,0);assert.deepEqual(writes(f),[]);
 });
 await scenario('read-only-and-paid-dossier-never-offer-editing',{role:'preparateur',permissions:{perm_colis_calculer_devis:false,perm_finances_voir_total:true}},async f=>{
  f.tables.lignes[0].custom_duty=mapped(catalog[0]);await open(f);assert.equal(await panel(f).getByRole('button',{name:'Classer l’article 1',exact:true}).count(),0);f.tables.staff_permissions[0].perm_colis_calculer_devis=true;Object.assign(f.tables.colis[0],{statut:'paye',devis_total:77,devis_brouillon:false,paiement_date:new Date().toISOString(),paiement_montant:77});await f.page.reload();
  await f.page.getByRole('heading',{name:'Devis enregistré',exact:true}).waitFor();assert.equal(await panel(f).count(),0);assert.equal(await f.page.getByRole('button',{name:'Modifier le devis',exact:true}).count(),0);assert.equal(await mainSave(f).count(),0);assert.equal(f.calls.filter(c=>['save','suggest','reopen'].includes(c.kind)).length,0);
 });

 await scenario('paid-quote-consults-frozen-rates-even-when-live-article-rates-have-changed',{},async f=>{
  f.tables.lignes[0].custom_duty=mapped(catalog[0]);await open(f);await mainSave(f).click();await f.page.getByRole('button',{name:'Envoyer le devis au client',exact:true}).waitFor();
  const frozenSnapshot=structuredClone(f.tables.colis[0].devis_snapshot);assert.ok(frozenSnapshot?.inputs?.lines?.length);
  f.tables.lignes[0].custom_duty={...mapped(catalog[0]),rates:{om:25,omr:8},overrideReason:'Valeurs courantes différentes du devis payé.'};
  Object.assign(f.tables.colis[0],{statut:'paye',paiement_montant:f.tables.colis[0].devis_total,paiement_date:'2026-10-01T08:00:00Z',devis_brouillon:false});
  const before=structuredClone(f.tables.colis[0]);await f.page.reload();await f.page.getByRole('heading',{name:'Devis enregistré',exact:true}).waitFor();
  assert.equal(await panel(f).count(),0);const frozen=f.page.getByLabel('Articles et taux enregistrés',{exact:true});await frozen.locator('summary').click();
  assert.match(await frozen.innerText(),/01012100/);assert.match(await frozen.innerText(),/OM\s*:?\s*10\s*%/);assert.match(await frozen.innerText(),/OMR\s*:?\s*2[,.]5\s*%/);
  assert.doesNotMatch(await frozen.innerText(),/OM\s*:?\s*25\s*%/);assert.doesNotMatch(await frozen.innerText(),/OMR\s*:?\s*8\s*%/);
  assert.deepEqual(f.tables.colis[0],before);assert.deepEqual(f.tables.colis[0].devis_snapshot,frozenSnapshot);assert.equal(await mainSave(f).count(),0);assert.equal(f.calls.filter(c=>['save','reopen'].includes(c.kind)).length,0);
  assert.equal(f.requests.filter(r=>r.path.endsWith('/save_quote')).length,1,'Only the deliberate initial draft save wrote a quote.');
 });
 for(const [name,proof] of [['partial-payment-without-date',{paiement_montant:10,paiement_date:null}],['recorded-zero-payment',{paiement_montant:0,paiement_date:null}],['departure-before-status-refresh',{date_expedition:'2026-10-01T08:00:00Z'}]])await scenario(`direct-quote-edit-query-cannot-bypass-${name}`,{},async f=>{
  f.tables.lignes[0].custom_duty=mapped(catalog[0]);Object.assign(f.tables.colis[0],{statut:'devis_envoye',devis_total:77,quote_version:1,devis_brouillon:false,...proof});
  const before=structuredClone(f.tables.colis[0]);await f.login();await f.page.goto(`${base}/colis/${ids.P}?section=devis&modifier=devis`);
  await f.page.getByRole('heading',{name:'Devis enregistré',exact:true}).waitFor();assert.equal(await panel(f).count(),0);
  assert.equal(await f.page.getByTestId('dossier-overview').getByRole('button',{name:'Modifier le devis et les taux',exact:true}).count(),0);
  assert.equal(await panel(f).getByRole('button',{name:/Corriger les taux|Classer l’article/}).count(),0);assert.equal(await mainSave(f).count(),0);
  assert.equal(f.calls.filter(c=>['save','suggest','reopen'].includes(c.kind)).length,0);assert.deepEqual(f.tables.colis[0],before);assert.deepEqual(writes(f),[]);
 });
 await scenario('suggestions-automatic-read-only-until-explicit-choice',{suggestions:true},async f=>{
  f.tables.taux_categories[0].om=20;f.control.suggestDelay=true;await open(f);
  await panel(f).getByRole('status').filter({hasText:'Recherche de propositions douanières'}).waitFor();
  assert.equal(await mainSave(f).isEnabled(),true);assert.equal(f.calls.filter(c=>c.kind==='search'||c.kind==='save').length,0);
  const before=await f.page.locator('[aria-label="Résumé du devis"]').innerText();
  f.control.suggestDelay=false;f.control.pendingSuggestions.splice(0).forEach(resolve=>resolve());
  const proposals=panel(f).getByRole('group',{name:'Propositions pour l’article 1',exact:true});await proposals.waitFor();
  await proposals.getByText('OM externe : 10 % · OMR externe : 2,5 %',{exact:true}).waitFor();
  assert.equal(await proposals.getByRole('button',{name:/Utiliser la proposition/}).count(),1);
  assert.equal(await mainSave(f).isEnabled(),true);assert.equal(await apply(f).count(),0);
  assert.equal(await f.page.locator('[aria-label="Résumé du devis"]').innerText(),before);assert.equal(f.tables.lignes[0].custom_duty,undefined);
  assert.equal(await f.page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
  assert.equal(f.calls.filter(c=>c.kind==='suggest').length,1);assert.deepEqual(f.calls.find(c=>c.kind==='suggest').input.p_items,[{lineId:ids.L,description:'Article vérifié'}]);
  await proposals.scrollIntoViewIfNeeded();await f.page.screenshot({path:`${output}/suggestions-desktop.png`});
  await proposals.getByRole('button',{name:/Utiliser la proposition/}).click();
  await panel(f).getByText('Choisi : 01012100 · Chevaux reproducteurs de race pure',{exact:true}).waitFor();
  assert.equal(await mainSave(f).isDisabled(),true);assert.equal(f.calls.filter(c=>c.kind==='save').length,0);
  await apply(f).click();await saved(f);assert.equal(f.calls.filter(c=>c.kind==='save').length,1);assert.equal(f.tables.lignes[0].custom_duty.tariffId,T);assert.notEqual(await f.page.locator('[aria-label="Résumé du devis"]').innerText(),before);assert.deepEqual(writes(f),[]);
 });
 await scenario('suggestions-alternatives-keyboard-conditional-mobile',{suggestions:true},async f=>{
  await f.page.setViewportSize({width:390,height:844});await open(f);
  const proposals=panel(f).getByRole('group',{name:'Propositions pour l’article 1',exact:true});await proposals.waitFor();
  assert.equal(await proposals.getByRole('button',{name:/Utiliser la proposition/}).count(),1);
  const alternatives=proposals.locator('summary').filter({hasText:'2 autres propositions à comparer'});await alternatives.focus();await alternatives.press('Enter');
  await proposals.getByText(/Conditions à vérifier : Exclusivement/).waitFor();await proposals.getByText('OM externe : à renseigner · OMR externe : à renseigner',{exact:true}).waitFor();
  await proposals.getByText('Source historique à vérifier.',{exact:true}).waitFor();
  assert.equal(await proposals.getByRole('button',{name:/Utiliser la proposition/}).count(),3);
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  const axe=await new AxeBuilder({page:f.page}).include('#quote-customs').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
  await alternatives.scrollIntoViewIfNeeded();await f.page.screenshot({path:`${output}/suggestions-mobile.png`});
  await f.page.setViewportSize({width:320,height:740});assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await proposals.getByRole('button',{name:`Utiliser la proposition ${catalog[1].code} — ${catalog[1].label}`,exact:true}).click();
  await apply(f).click();await panel(f).getByRole('alert').filter({hasText:'Confirmez'}).waitFor();assert.equal(f.calls.filter(c=>c.kind==='save').length,0);
  await panel(f).getByRole('checkbox',{name:/J’ai vérifié/}).check();await apply(f).click();await saved(f);assert.equal(f.tables.lignes[0].custom_duty.tariffId,catalog[1].id);
 });
 await scenario('suggestions-no-match-keeps-business-notice-and-search',{noMatchNotice:'Plusieurs produits semblent regroupés : vérifiez les articles séparément.'},async f=>{
  await open(f);await panel(f).getByText('Plusieurs produits semblent regroupés : vérifiez les articles séparément.',{exact:true}).waitFor();
  assert.equal(await panel(f).getByRole('button',{name:/Utiliser la proposition/}).count(),0);assert.equal(await mainSave(f).isEnabled(),true);
  await edit(f);await choose(f);await apply(f).click();await saved(f);assert.equal(f.calls.filter(c=>c.kind==='search').length,1);assert.deepEqual(writes(f),[]);
 });
 await scenario('suggestions-error-explicit-retry-never-becomes-no-match',{suggestions:true},async f=>{
  f.control.suggestFail=true;await open(f);await panel(f).getByRole('alert').filter({hasText:'recherche automatique est momentanément indisponible'}).waitFor();
  assert.equal(await panel(f).getByText(/Aucune correspondance suffisamment précise/).count(),0);assert.equal(await mainSave(f).isEnabled(),true);assert.equal(f.calls.filter(c=>c.kind==='suggest').length,1);
  await panel(f).getByRole('button',{name:'Réessayer les propositions',exact:true}).click();await panel(f).getByRole('group',{name:'Propositions pour l’article 1',exact:true}).waitFor();
  assert.equal(f.calls.filter(c=>c.kind==='suggest').length,2);assert.equal(f.calls.filter(c=>c.kind==='save').length,0);assert.deepEqual(writes(f),[]);
 });
 await scenario('suggestions-confirmed-override-excluded-and-stale-explicit-reset',{suggestions:true},async f=>{
  const old={...mapped(catalog[0]),rates:{om:7,omr:1},overrideReason:'Ancien taux corrigé pour cet article.'};f.tables.lignes[0].custom_duty=structuredClone(old);await open(f);
  assert.equal(f.calls.filter(c=>c.kind==='suggest').length,0);assert.equal(await panel(f).getByRole('button',{name:/Utiliser la proposition/}).count(),0);
  f.tables.lignes[0].custom_duty.stale=true;f.tables.colis[0].updated_at=new Date(Date.now()+60000).toISOString();await updateOther(f);
  await panel(f).getByRole('group',{name:'Propositions pour l’article 1',exact:true}).waitFor();await panel(f).getByRole('button',{name:/Utiliser la proposition/}).click();
  const dialog=f.page.getByRole('dialog');await dialog.getByText(/anciens taux et leur motif restent enregistrés/).waitFor();await dialog.getByRole('button',{name:'Annuler',exact:true}).click();
  assert.deepEqual(f.tables.lignes[0].custom_duty.rates,old.rates);assert.equal(await apply(f).count(),0);
  await panel(f).getByRole('button',{name:/Utiliser la proposition/}).click();await dialog.getByRole('button',{name:'Vérifier la nouvelle proposition',exact:true}).click();
  await panel(f).getByText('Référentiel : OM 10 % · OMR 2,5 %',{exact:true}).waitFor();assert.equal(await panel(f).getByLabel('Taux OM (%)',{exact:true}).count(),0);
  assert.deepEqual(f.tables.lignes[0].custom_duty.rates,old.rates);assert.equal(f.calls.filter(c=>c.kind==='save').length,0);
  await apply(f).click();await saved(f);assert.deepEqual(f.tables.lignes[0].custom_duty.rates,{om:10,omr:2.5});assert.equal(f.tables.lignes[0].custom_duty.overrideReason,null);
 });

 await scenario('suggestions-confirmation-refuses-colleague-description-change',{suggestions:true},async f=>{
  f.tables.lignes[0].custom_duty={...mapped(catalog[0]),rates:{om:7,omr:1},overrideReason:'Ancien taux corrigé.',stale:true};await open(f);
  await panel(f).getByRole('button',{name:/Utiliser la proposition/}).click();const dialog=f.page.getByRole('dialog');await dialog.getByRole('button',{name:'Vérifier la nouvelle proposition',exact:true}).waitFor();
  f.tables.lignes[0].description='Description modifiée par le collègue';f.tables.colis[0].updated_at=new Date(Date.now()+60000).toISOString();await updateOther(f);await panel(f).getByText('1. Description modifiée par le collègue',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Vérifier la nouvelle proposition',exact:true}).click();await panel(f).getByRole('alert').filter({hasText:'L’article ou sa destination a changé'}).waitFor();
  assert.equal(await apply(f).count(),0);assert.equal(await panel(f).getByText(/Modification non enregistrée/).count(),0);assert.equal(f.calls.filter(c=>c.kind==='save').length,0);assert.deepEqual(f.tables.lignes[0].custom_duty.rates,{om:7,omr:1});assert.deepEqual(writes(f),[]);
 });
 await scenario('suggestions-late-response-preserves-draft-and-abandon-restarts',{suggestions:true},async f=>{
  f.control.suggestDelay=true;await open(f);await panel(f).getByRole('status').filter({hasText:'Recherche de propositions douanières'}).waitFor();
  await edit(f);await choose(f);await panel(f).getByRole('button',{name:'Corriger les taux pour ce devis'}).click();await panel(f).getByLabel('Taux OM (%)',{exact:true}).fill('7');await panel(f).getByLabel('Motif de la correction douanière').fill('Correction locale à conserver.');
  f.control.suggestDelay=false;f.control.pendingSuggestions.splice(0).forEach(resolve=>resolve());
  await openTaskNavigation(f);await f.page.getByLabel('Tâche du dossier',{exact:true}).selectOption('documents');await openTaskNavigation(f);await f.page.getByLabel('Tâche du dossier',{exact:true}).selectOption('devis');
  await panel(f).getByLabel('Taux OM (%)',{exact:true}).waitFor();assert.equal(await panel(f).getByLabel('Taux OM (%)',{exact:true}).inputValue(),'7');assert.equal(await panel(f).getByRole('button',{name:/Utiliser la proposition/}).count(),0);assert.equal(await mainSave(f).isDisabled(),true);
  const previous=f.calls.filter(c=>c.kind==='suggest').length;await panel(f).getByRole('button',{name:'Abandonner la saisie',exact:true}).click();await f.page.getByRole('dialog').getByRole('button',{name:'Abandonner la saisie',exact:true}).click();
  await panel(f).getByRole('group',{name:'Propositions pour l’article 1',exact:true}).waitFor();assert.equal(f.calls.filter(c=>c.kind==='suggest').length,previous+1);assert.equal(await mainSave(f).isEnabled(),true);assert.equal(f.calls.filter(c=>c.kind==='save').length,0);assert.equal(f.tables.lignes[0].custom_duty,undefined);
 });
 await scenario('suggestions-description-revision-ignores-obsolete-response',{suggestions:item=>item.description==='Description révisée'?[catalog[1]]:[catalog[0]]},async f=>{
  f.control.suggestDelay=true;await open(f);await panel(f).getByRole('status').filter({hasText:'Recherche de propositions douanières'}).waitFor();
  f.tables.lignes[0].description='Description révisée';f.tables.colis[0].updated_at=new Date(Date.now()+60000).toISOString();f.control.suggestDelay=false;await updateOther(f);
  await panel(f).getByRole('button',{name:`Utiliser la proposition ${catalog[1].code} — ${catalog[1].label}`,exact:true}).waitFor();
  f.control.pendingSuggestions.splice(0).forEach(resolve=>resolve());await f.page.waitForResponse(response=>response.url().includes('/suggest_customs_tariffs')&&response.request().postDataJSON().p_items[0].description==='Article vérifié');
  await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await panel(f).getByRole('button',{name:`Utiliser la proposition ${catalog[0].code} — ${catalog[0].label}`,exact:true}).count(),0);assert.equal(f.calls.filter(c=>c.kind==='suggest').length,2);assert.equal(await mainSave(f).isEnabled(),true);assert.deepEqual(writes(f),[]);
 });
 await scenario('suggestions-batches-fifty-articles-without-saving',{suggestions:true},async f=>{
  const first=f.tables.lignes[0];f.tables.lignes=Array.from({length:51},(_,i)=>({...first,id:`94444444-4444-4444-8444-${String(i+1).padStart(12,'0')}`,description:`Article ${i+1} à vérifier`}));f.tables.factures[0].montant=5100;
  await open(f);await panel(f).getByRole('group',{name:'Propositions pour l’article 51',exact:true}).waitFor();
  const requests=f.calls.filter(c=>c.kind==='suggest');assert.deepEqual(requests.map(c=>c.input.p_items.length),[50,1]);assert.equal(new Set(requests.flatMap(c=>c.input.p_items.map(item=>item.lineId))).size,51);
  assert.equal(await panel(f).getByRole('button',{name:/Utiliser la proposition/}).count(),51);assert.equal(await apply(f).count(),0);assert.equal(f.calls.filter(c=>c.kind==='save').length,0);assert.equal(f.tables.lignes.some(line=>line.custom_duty),false);assert.deepEqual(writes(f),[]);
 });
 // ── « Devis enregistré » in detail: weights, taxes, fees and each article's share ──
 // The quote of 7 October: one parcel of 40 × 35 × 10 cm and 1,9 kg, two articles (16,64 € classified
 // 01012100 at OM 10 % / OMR 2,5 %; 9,92 € in a category coded 39241000 at OM 5 % / OMR 2,5 %), 25 € + 5 €/kg.
 const plain=text=>String(text).replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim();
 const savedQuote=f=>f.page.getByRole('group',{name:'Devis enregistré',exact:true});
 const amount=text=>Number(text.replace(/[^\d,]/g,'').replace(',','.'));
 function sevenOctober(f,{fees=[]}={}){
  Object.assign(f.tables.colis[0],{final_packages:[{dimL:40,dimW:35,dimH:10,poids:1.9}],fin_l:40,fin_w:35,fin_h:10,fin_p:1.9,frais_divers:fees});
  f.tables.categories.push({id:'cat-vaisselle',label:'Vaisselle plastique',code_hs:'39241000',position:2});
  f.tables.taux_categories.push({id:'rate-vaisselle',categorie_id:'cat-vaisselle',destination_code:'974',om:5,omr:2.5});
  f.tables.factures[0].montant=26.56;const line=f.tables.lignes[0];
  f.tables.lignes=[{...line,description:'Mini scelleuse',qte:1,prix_unitaire:16.64,custom_duty:mapped(catalog[0])},{...line,id:'55555555-5555-4555-8555-555555555556',description:'Organisateur évier',qte:1,prix_unitaire:9.92,categorie_id:'cat-vaisselle'}];
 }
 // Every detail of the saved quote opened, then read once they all are.
 async function openAll(f,group){
  for(const summary of await group.locator('summary').all())await summary.click();
  await f.page.waitForFunction(()=>[...document.querySelectorAll('[aria-label="Devis enregistré"] details')].every(node=>node.open));
 }
 // A saved quote read back as the server froze it: one parcel of 30 × 20 × 20 cm and 3 kg (real weight
 // retained), 25 € + 5 €/kg; article 1 classified 01012100 with rates corrected to OM 2 % / OMR 1 %,
 // article 2 in the base category, which has no HS code. `total` is the recorded devis_total.
 function frozenQuote(total=46.98){
  const duty={...mapped(catalog[0]),rates:{om:2,omr:1},overrideReason:'Taux réduits justifiés par le certificat d’origine.'};
  const lines=[
   {id:ids.L,factureId:ids.F,description:'Mini scelleuse',quantity:1,unitPrice:30,categoryId:'cat-test',categoryLabel:'Divers',rates:{om:2,omr:1},customDuty:duty},
   {id:'55555555-5555-4555-8555-555555555557',factureId:ids.F,description:'Organisateur évier',quantity:2,unitPrice:5,categoryId:'cat-test',categoryLabel:'Divers',rates:{om:5,omr:2.5}},
  ];
  const taxLines=[{...lines[0],value:30,transportShare:30,cif:60,om:1.2,omr:0.6},{...lines[1],value:10,transportShare:10,cif:20,om:1,omr:0.5}];
  return {statut:'devis_envoye',devis_total:total,quote_version:1,devis_brouillon:false,devis_envoye_le:'2026-10-07T08:00:00Z',devis_snapshot:{schemaVersion:1,currency:'EUR',mode:'final',
   inputs:{client:{type:'particulier'},destination:{code:'974',tva:8.5},tarif:{base:25,parKg:5},volumetricDivisor:5000,finalPackages:[{dimL:30,dimW:20,dimH:20,poids:3}],lines,fees:[]},
   amounts:{transport:40,om:2.2,omr:1.1,tva:3.68,fees:0,total:46.98,realWeight:3,volumetricWeight:2.4,billableWeight:3,merchandiseValue:40,taxLines},savings:0}};
 }
 // The deliberate save of the draft, then the quote sent: the dossier shows its saved quote.
 async function saveAndSend(f){
  await f.login();await f.page.goto(`${base}/colis/${ids.P}?section=devis`);await mainSave(f).click();
  await f.page.getByRole('button',{name:'Envoyer le devis au client',exact:true}).waitFor();assert.ok(f.tables.colis[0].devis_snapshot?.amounts);
  Object.assign(f.tables.colis[0],{statut:'devis_envoye',devis_brouillon:false,devis_envoye_le:'2026-10-07T08:00:00Z'});
  await f.page.reload();await f.page.getByRole('heading',{name:'Devis enregistré',exact:true}).waitFor();await savedQuote(f).waitFor();
 }
 for(const mobile of [false,true])for(const dark of [false,true])await scenario(`saved-quote-details-weights-taxes-fees-and-article-shares-${mobile?'390':'1440'}-${dark?'dark':'light'}`,{},async f=>{
  // The computer view has a fee; the phone view has none.
  sevenOctober(f,{fees:mobile?[]:[{libelle:'Emballage renforcé',montant:4}]});
  await f.page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
  await saveAndSend(f);await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
  const group=savedQuote(f);
  // Folded: the amounts only.
  assert.match(plain(await group.innerText()),mobile?/^Transport 39,00 € Comprendre le calcul du transport Taxes 10,88 € Détail des taxes Frais convenus Aucun frais Total 49,88 € Articles et taux enregistrés \(2\)$/:/^Transport 39,00 € Comprendre le calcul du transport Taxes 10,88 € Détail des taxes Frais convenus 4,00 € Détail des frais Total 53,88 € Articles et taux enregistrés \(2\)$/);
  assert.doesNotMatch(plain(await group.innerText()),/0,00 €/,'No « 0,00 € » line for a quote without fees.');
  for(const summary of await group.locator('summary').all()){const box=await summary.boundingBox();assert.ok(box.height>=44,'Each detail opens from a 44 px target.');await summary.click();}
  await f.page.waitForFunction(()=>[...document.querySelectorAll('[aria-label="Devis enregistré"] details')].every(node=>node.open));
  const text=plain(await group.innerText());
  for(const expected of [
   'Transport 39,00 € Comprendre le calcul du transport Poids réel 1,9 kg Poids volumétrique 2,8 kg 40 × 35 × 10 cm · réel 1,9 kg · vol. 2,8 kg Poids volumétrique = longueur × largeur × hauteur ÷ 5 000 Poids retenu 2,8 kg (le plus lourd : volumétrique) Tarif : 25,00 € + 5,00 € par kg',
   'Taxes 10,88 € Détail des taxes Octroi de mer 5,33 € Octroi de mer régional 1,64 € TVA 8,5 % 3,91 € sur 45,97 € (transport + octroi de mer + octroi de mer régional)',
   mobile?'Frais convenus Aucun frais Total 49,88 €':'Frais convenus 4,00 € Détail des frais Emballage renforcé 4,00 € Total 53,88 €',
   'Articles et taux enregistrés (2) Le transport est réparti selon la valeur des articles (quantité × prix unitaire HT). Les montants sont arrondis au centime ; leur somme correspond aux totaux du devis.',
   'Mini scelleuse Code SH 01012100 · Chevaux reproducteurs de race pure 1 × 16,64 € HT = 16,64 € Part de transport 24,43 € · Base OM / OMR 41,07 € OM 10 % : 4,11 € · OMR 2,5 % : 1,03 €',
   'Organisateur évier Code SH 39241000 · Vaisselle plastique 1 × 9,92 € HT = 9,92 € Part de transport 14,57 € · Base OM / OMR 24,49 € OM 5 % : 1,22 € · OMR 2,5 % : 0,61 €',
  ])assert.ok(text.includes(expected),`« ${expected} » in « ${text} »`);
  // The shares shown add up exactly to the totals shown.
  const sum=pattern=>Math.round([...text.matchAll(pattern)].reduce((total,match)=>total+amount(match[1]),0)*100)/100;
  assert.equal(sum(/Part de transport ([\d,]+) €/g),39);assert.equal(sum(/OM [\d,]+ % : ([\d,]+) €/g),5.33);assert.equal(sum(/OMR [\d,]+ % : ([\d,]+) €/g),1.64);
  // The TVA base named is the sum of the amounts it names: transport 39,00 + OM 5,33 + OMR 1,64.
  assert.equal(Math.round((amount(text.match(/^Transport ([\d,]+) €/)[1])+amount(text.match(/Octroi de mer ([\d,]+) €/)[1])+amount(text.match(/Octroi de mer régional ([\d,]+) €/)[1]))*100)/100,amount(text.match(/TVA [\d,]+ % [\d,]+ € sur ([\d,]+) €/)[1]));
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  const axe=await new AxeBuilder({page:f.page}).include('[aria-label="Devis enregistré"][role="group"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
  // A viewport tall enough for the whole opened quote: the page scrolls inside its own frame.
  const height=Math.ceil((await group.boundingBox()).height)+400;await f.page.setViewportSize(mobile?{width:390,height:Math.max(844,height)}:{width:1440,height:Math.max(1000,height)});
  await group.scrollIntoViewIfNeeded();await group.screenshot({path:`${output}/saved-quote-${mobile?'390':'1440'}-${dark?'dark':'light'}.png`});
  assert.equal(f.requests.filter(r=>r.path.endsWith('/save_quote')).length,1,'Reading the saved quote writes nothing.');
 });
 await scenario('saved-quote-of-a-professional-client-has-transport-and-fees-without-taxes',{},async f=>{
  f.tables.clients[0].type='pro';Object.assign(f.tables.colis[0],{frais_divers:[{libelle:'Palette',montant:12}],mode_paiement_pro:'virement'});
  await saveAndSend(f);const group=savedQuote(f);
  await openAll(f,group);
  const text=plain(await group.innerText());
  assert.ok(text.includes('Transport 40,00 € Comprendre le calcul du transport Poids réel 3 kg Poids volumétrique 2,4 kg 30 × 20 × 20 cm · réel 3 kg · vol. 2,4 kg'),text);
  assert.ok(text.includes('Poids retenu 3 kg (le plus lourd : réel)'),text);
  assert.ok(text.includes('Devis professionnel : transport et frais, sans taxes. Frais convenus 12,00 € Détail des frais Palette 12,00 € Total 52,00 €'),text);
  assert.doesNotMatch(text,/Taxes|Octroi|TVA|Articles et taux/);
 });
 await scenario('saved-quote-without-amounts-keeps-the-short-summary',{},async f=>{
  Object.assign(f.tables.colis[0],{statut:'devis_envoye',devis_total:77,quote_version:1,devis_brouillon:false,devis_envoye_le:'2026-10-07T08:00:00Z',devis_snapshot:{inputs:{lines:[{id:ids.L,description:'Article vérifié',quantity:1,unitPrice:100,rates:{om:10,omr:2.5}}]}}});
  await f.login();await f.page.goto(`${base}/colis/${ids.P}?section=devis`);await f.page.getByRole('heading',{name:'Devis enregistré',exact:true}).waitFor();
  const group=savedQuote(f);await openAll(f,group);
  assert.equal(plain(await group.innerText()),'Total 77,00 € Articles et taux enregistrés (1) Article vérifié 1 × 100,00 € HT OM : 10 % · OMR : 2,5 % Valeurs conservées avec ce devis.');
 });
 for(const dark of [false,true])await scenario(`saved-quote-names-a-missing-hs-code-and-keeps-the-rate-correction-390-${dark?'dark':'light'}`,{},async f=>{
  Object.assign(f.tables.colis[0],frozenQuote());const before=structuredClone(f.tables.colis[0]);
  await f.page.setViewportSize({width:390,height:844});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);
  await f.login();await f.page.goto(`${base}/colis/${ids.P}?section=devis`);await f.page.getByRole('heading',{name:'Devis enregistré',exact:true}).waitFor();
  await f.page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,dark);
  const group=savedQuote(f);await openAll(f,group);
  const text=plain(await group.innerText());
  for(const expected of [
   'Transport 40,00 € Comprendre le calcul du transport Poids réel 3 kg Poids volumétrique 2,4 kg 30 × 20 × 20 cm · réel 3 kg · vol. 2,4 kg Poids volumétrique = longueur × largeur × hauteur ÷ 5 000 Poids retenu 3 kg (le plus lourd : réel) Tarif : 25,00 € + 5,00 € par kg',
   'Taxes 6,98 € Détail des taxes Octroi de mer 2,20 € Octroi de mer régional 1,10 € TVA 8,5 % 3,68 € sur 43,30 € (transport + octroi de mer + octroi de mer régional)',
   'Frais convenus Aucun frais Total 46,98 € Articles et taux enregistrés (2)',
   'Mini scelleuse Code SH 01012100 · Chevaux reproducteurs de race pure 1 × 30,00 € HT = 30,00 € Part de transport 30,00 € · Base OM / OMR 60,00 € OM 2 % : 1,20 € · OMR 1 % : 0,60 € Motif de correction : Taux réduits justifiés par le certificat d’origine.',
   'Organisateur évier Code SH à renseigner · Divers 2 × 5,00 € HT = 10,00 € Part de transport 10,00 € · Base OM / OMR 20,00 € OM 5 % : 1,00 € · OMR 2,5 % : 0,50 €',
  ])assert.ok(text.includes(expected),`« ${expected} » in « ${text} »`);
  assert.doesNotMatch(text,/faites vérifier/,'Consistent totals raise no warning.');
  // The missing code is marked with its warning icon, readable in both themes.
  const missing=group.getByText('Code SH à renseigner · Divers',{exact:true});assert.equal(await missing.count(),1);
  assert.equal(await missing.locator('xpath=..').locator('svg').count(),1);
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  const axe=await new AxeBuilder({page:f.page}).include('[aria-label="Devis enregistré"][role="group"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
  assert.deepEqual(f.tables.colis[0],before);assert.deepEqual(writes(f),[]);
 });
 await scenario('saved-quote-warns-when-the-recorded-total-differs-from-its-detail',{},async f=>{
  Object.assign(f.tables.colis[0],frozenQuote(47.98));
  await f.login();await f.page.goto(`${base}/colis/${ids.P}?section=devis`);await f.page.getByRole('heading',{name:'Devis enregistré',exact:true}).waitFor();
  const group=savedQuote(f);await group.getByRole('status').filter({hasText:'faites vérifier ce devis'}).waitFor();
  assert.ok(plain(await group.innerText()).includes('Total 47,98 € Le détail enregistré totalise 46,98 € : faites vérifier ce devis avant tout règlement.'),'The recorded total stays shown beside the warning.');
  assert.deepEqual(writes(f),[]);
 });
}finally{await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}})().catch(e=>{console.error(e);process.exitCode=1;});
