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
  await open(f);await edit(f);await choose(f);await panel(f).getByRole('button',{name:'Corriger les taux pour ce devis'}).click();await panel(f).getByLabel('Taux OM (%)',{exact:true}).fill('7');await panel(f).getByLabel('Motif de la correction douanière').fill('Correction conservée pendant vérification.');await f.page.getByLabel('Tâche du dossier',{exact:true}).selectOption('documents');await f.page.getByLabel('Tâche du dossier',{exact:true}).selectOption('devis');await panel(f).getByLabel('Taux OM (%)',{exact:true}).waitFor();assert.equal(await panel(f).getByLabel('Taux OM (%)',{exact:true}).inputValue(),'7');assert.equal(await mainSave(f).isDisabled(),true);f.control.fail=true;await apply(f).click();await panel(f).getByRole('alert').filter({hasText:'Erreur réseau'}).waitFor();assert.equal(await panel(f).getByLabel('Taux OM (%)',{exact:true}).inputValue(),'7');await apply(f).click();await saved(f);assert.equal(f.calls.filter(c=>c.kind==='save').length,2);assert.equal(f.tables.lignes[0].custom_duty.rates.om,7);assert.deepEqual(writes(f),[]);
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
  Object.assign(f.tables.colis[0],{statut:'devis_envoye',devis_total:77,devis_brouillon:false,payplug_payment_url:'https://example.test/payment'});await open(f);await edit(f);await choose(f);await apply(f).click();const dialog=f.page.getByRole('dialog');await dialog.getByText(/lien de paiement seront retirés/).waitFor();await dialog.getByRole('button',{name:'Annuler',exact:true}).click();assert.equal(f.calls.filter(c=>c.kind==='save').length,0);await apply(f).click();await dialog.getByRole('button',{name:'Retirer le devis et appliquer',exact:true}).click();await mainSave(f).waitFor();assert.equal(f.tables.colis[0].statut,'en_preparation');assert.equal(f.tables.colis[0].payplug_payment_url,null);assert.deepEqual(writes(f),[]);
 });
 await scenario('calculator-without-invoice-permission-can-classify-mobile', {role:'preparateur',permissions:{perm_colis_calculer_devis:true,perm_factures_voir:false,perm_factures_modifier_articles:false,perm_factures_valider:false}},async f=>{
  await f.page.setViewportSize({width:390,height:844});await open(f);await edit(f);await choose(f);assert.equal(await f.page.getByTestId('documents-task').count(),0);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await panel(f).getByText(/Choisi : 01012100/).scrollIntoViewIfNeeded();await f.page.screenshot({path:`${output}/customs-edit-mobile.png`});await apply(f).click();await saved(f);const axe=await new AxeBuilder({page:f.page}).include('#quote-customs').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);await panel(f).scrollIntoViewIfNeeded();await f.page.screenshot({path:`${output}/customs-mobile.png`});
 });
 await scenario('other-destination-explains-unavailable-catalogue-without-reunion-fallback',{},async f=>{
  f.tables.clients[0].cp='97200';await open(f);await panel(f).getByText(/Aucun barème douanier n’est chargé pour cette destination/).waitFor();await edit(f);await panel(f).getByLabel('Rechercher un code ou un libellé douanier').fill('cheval');await panel(f).getByRole('button',{name:'Rechercher la nomenclature'}).click();await panel(f).getByRole('status').filter({hasText:'Aucun résultat'}).waitFor();assert.equal(f.calls.find(c=>c.kind==='search').input.p_destination,'972');assert.equal(f.calls.filter(c=>c.kind==='save').length,0);assert.equal(f.calls.filter(c=>c.kind==='suggest').length,0);assert.deepEqual(writes(f),[]);
 });
 await scenario('read-only-and-paid-dossier-never-offer-editing',{role:'preparateur',permissions:{perm_colis_calculer_devis:false,perm_finances_voir_total:true}},async f=>{
  f.tables.lignes[0].custom_duty=mapped(catalog[0]);await open(f);assert.equal(await panel(f).getByRole('button',{name:'Classer l’article 1',exact:true}).count(),0);f.tables.staff_permissions[0].perm_colis_calculer_devis=true;Object.assign(f.tables.colis[0],{statut:'paye',paiement_date:new Date().toISOString(),paiement_montant:77});await f.page.reload();await panel(f).waitFor();assert.equal(await panel(f).getByRole('button',{name:'Classer l’article 1',exact:true}).count(),0);assert.equal(f.calls.filter(c=>c.kind==='save').length,0);assert.equal(f.calls.filter(c=>c.kind==='suggest').length,0);
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
  const alternatives=proposals.locator('summary').filter({hasText:'2 autre(s) proposition(s) à comparer'});await alternatives.focus();await alternatives.press('Enter');
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
  await f.page.getByLabel('Tâche du dossier',{exact:true}).selectOption('documents');await f.page.getByLabel('Tâche du dossier',{exact:true}).selectOption('devis');
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
}finally{await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}})().catch(e=>{console.error(e);process.exitCode=1;});
