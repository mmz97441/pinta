/* Integrated team recipes: synthetic users/documents, all remote requests mocked. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, base, ids } = require('./browser-regression.cjs');
const out = process.env.PINTA_TEAM_SIMPLICITY_OUT || '/tmp/pinta-team-simplicity';
const results = [];
(async () => {
 await fs.mkdir(out,{recursive:true}); const browser = await chromium.launch();
 async function scenario(name,run) {
  const f=await setup(browser,'directeur');f.page.setDefaultTimeout(8000);
  f.tables.staff_work_preferences=[{staff_id:ids.A,missions:['reception','preparation','communication','documents','departures'],density:'comfortable',available:true,version:1}];
  f.tables.staff_work_actions=[{id:'prepare',colis_id:ids.P,kind:'preparation',state:'ready',assignee_id:ids.A,version:1,created_at:new Date().toISOString()}];
  try { await run(f); assert.deepEqual(f.errors,[]);assert.deepEqual(f.networkDenied,[]);results.push({name,ok:true}); }
  catch(error){results.push({name,ok:false,error:error.stack});await fs.writeFile(path.join(out,name+'.txt'),await f.page.locator('body').innerText());}
  await f.page.screenshot({path:path.join(out,name+'.png'),fullPage:true});await f.context.close();
 }
 await scenario('mobile-task-visible-and-conversations-direct',async f=>{
  await f.page.setViewportSize({width:390,height:844});await f.login();
  const row=f.page.locator('[data-work-action="prepare"]');await row.waitFor();
  const box=await row.boundingBox(); assert.ok(box.y+box.height<780,`first complete task ends at ${box.y+box.height}`);
  const conversation=f.page.getByRole('button',{name:'Conversations',exact:true});await conversation.click();
  await f.page.waitForURL(/\/conversations/);assert.equal(f.requests.some(r=>r.path.endsWith('/mutate_staff_work_action')),false);
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 });
 await scenario('reply-draft-survives-navigation-reload-and-enter',async f=>{
  f.tables.colis[0].conversation_statut='a_traiter';await f.login();
  await f.page.goto(`${base}/conversations?dossier=${ids.P}`);
  let field=f.page.getByLabel('Votre réponse au client',{exact:true});await field.fill('Bonjour,\nVoici les informations.');await field.press('Enter');
  assert.equal(f.requests.filter(r=>r.path.endsWith('/queue_message')).length,0);
  await f.page.goto(base+'/');await f.page.goto(`${base}/conversations?dossier=${ids.P}`);
  field=f.page.getByLabel('Votre réponse au client',{exact:true});assert.match(await field.inputValue(),/Bonjour,\nVoici les informations\./);
  await f.page.reload();assert.match(await field.inputValue(),/Voici les informations/);
  await f.page.getByRole('button',{name:'Effacer le brouillon',exact:true}).click();
  await f.page.getByRole('dialog').getByRole('button',{name:'Annuler',exact:true}).click();assert.match(await field.inputValue(),/Bonjour/);
 });
 await scenario('preview-primary-action-and-prepared-weight-agree',async f=>{
  f.tables.colis[0].conversation_statut='a_traiter';f.tables.colis[0].statut='en_preparation';f.tables.colis[0].fin_p=3;
  f.tables.colis[0].final_packages=[{dimL:30,dimW:20,dimH:10,poids:3},{dimL:20,dimW:20,dimH:20,poids:5}];f.tables.colis[0].outgoing_parcel_count=2;
  await f.login();await f.page.goto(`${base}/colis?dossier=${ids.P}`);
  const panel=f.page.getByRole('region',{name:'Dossier EXP-TEST-001',exact:true});await panel.waitFor();
  await panel.getByText(/Après optimisation : 2 colis · 8 kg/).waitFor();
  await panel.getByRole('button',{name:'Répondre au client',exact:true}).click();await f.page.waitForURL(/\/conversations\?/);
 });
 await scenario('team-filters-and-clear-selection',async f=>{
  f.tables.staff_work_actions.push({id:'blocked',colis_id:ids.P,kind:'documents',state:'ready',assignee_id:null,version:1,blocked_reason:'Facture manquante'});
  await f.page.setViewportSize({width:390,height:844});await f.login();await f.page.goto(base+'/equipe');
  await f.page.getByRole('button',{name:'À débloquer (1)',exact:true}).click();
  await f.page.waitForURL(url => url.searchParams.get('exception') === 'blocked');
  await f.page.waitForFunction(() => document.querySelectorAll('[data-work-action]').length === 1);
  assert.equal(await f.page.locator('[data-work-action]').count(),1);
  await f.page.getByLabel('Rechercher une EXP ou un client').fill('EXP-TEST-001');
  await f.page.getByRole('button',{name:'Afficher toutes les tâches',exact:true}).click();await f.page.waitForFunction(() => document.querySelectorAll('[data-work-action]').length === 2);assert.equal(await f.page.locator('[data-work-action]').count(),2);
 });
 await scenario('departure-ready-blocked-selection-survives-return',async f=>{
  const departure='99999999-1111-4111-8111-111111111111', second='88888888-1111-4111-8111-111111111111';
  f.tables.envois=[{id:departure,ref:'DEP-RECETTE',date:'2099-09-20',statut:'planifie',destination_code:'974',updated_at:'2026-09-17T10:00:00Z'}];
  Object.assign(f.tables.colis[0],{envoi_id:departure,statut:'paye',outgoing_parcel_count:1,fin_l:30,fin_w:20,fin_h:10,fin_p:3,final_packages:[{dimL:30,dimW:20,dimH:10,poids:3}]});
  f.tables.colis.push({...f.tables.colis[0],id:second,ref:'EXP-BLOQUE',statut:'attente_paiement'});
  await f.login();await f.page.goto(base+'/departs');await f.page.getByRole('button',{name:'Vérifier et confirmer le chargement',exact:true}).click();
  const review=f.page.getByRole('region',{name:'Vérifier le chargement',exact:true});await review.getByRole('heading',{name:'Prêts à charger (1)'}).waitFor();await review.getByRole('heading',{name:'À débloquer (1)'}).waitFor();
  await review.getByRole('checkbox',{name:/EXP-TEST-001/}).check();
  await review.getByRole('link',{name:'Vérifier le paiement',exact:true}).click();
  const returnTo=new URL(f.page.url()).searchParams.get('returnTo');assert.ok(returnTo.includes('loading='));await f.page.goto(base+returnTo);
  await review.getByRole('checkbox',{name:/EXP-TEST-001/}).waitFor();assert.equal(await review.getByRole('checkbox',{name:/EXP-TEST-001/}).isChecked(),true);
  assert.equal(f.requests.some(r=>r.path.endsWith('/confirm_departure')),false);
 });
 await scenario('inbox-document-preview-before-confirmed-assignment',async f=>{
  const inbox='aaaaaaaa-1111-4111-8111-111111111111';f.tables.client_inbox=[{id:inbox,client_id:ids.C,status:'unassigned',texte:'Facture pour mes achats',payload:{document:{file_id:'fixture',file_name:'facture.pdf',mime_type:'application/pdf'}}}];
  let previewCalls=0;await f.page.route('**/functions/v1/telegram-inbox-document',async route=>{previewCalls++;const {jsPDF}=require('jspdf');const pdf=new jsPDF();pdf.text('Document fictif a rattacher',20,20);await route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from(pdf.output('arraybuffer'))});});
  await f.login();await f.page.goto(`${base}/conversations?inbox=${inbox}`);
  await f.page.getByRole('button',{name:'Voir le document avant de le rattacher'}).click();await f.page.locator('canvas[data-rendered="true"]').waitFor();assert.equal(previewCalls,1);
  await f.page.getByLabel('Dossier du client').selectOption(ids.P);await f.page.getByRole('button',{name:'Rattacher au dossier',exact:true}).click();await f.page.getByRole('dialog').getByText(/EXP-TEST-001/).waitFor();
  await f.page.getByRole('dialog').getByRole('button',{name:'Annuler',exact:true}).click();assert.equal(f.requests.some(r=>r.path.endsWith('/telegram-inbox-assign')),false);
 });
 for(const width of [1440,390]) await scenario(`dossier-70-of-90-scroll-restored-${width}`,async f=>{
  f.tables.colis=Array.from({length:90},(_,index)=>({...f.tables.colis[0],id:`73333333-3333-4333-8333-${String(100000000000+index)}`,ref:`EXP-LIST-${String(index+1).padStart(3,'0')}`}));
  const selected=f.tables.colis[69];await f.page.setViewportSize({width,height:1000});await f.login();await f.page.goto(`${base}/colis?sort=ref&dir=asc`);
  const table=f.page.locator('table'),list=table.locator('..');const target=width===1440?table.getByRole('button',{name:selected.ref,exact:true}):list.locator('article').getByRole('button',{name:selected.ref,exact:true});
  await target.scrollIntoViewIfNeeded();const before=await list.evaluate(element=>element.scrollTop);assert.ok(before>1500);await target.click();const panel=f.page.getByRole(width===1440?'region':'dialog',{name:`Dossier ${selected.ref}`,exact:true});await panel.waitFor();
  await panel.getByRole('button',{name:'Fermer le dossier',exact:true}).click();await target.waitFor();assert.ok(Math.abs((await list.evaluate(element=>element.scrollTop))-before)<2,'Closing the preview restores the 70th dossier position');
  await target.click();await panel.waitFor();if(width===1440){await list.evaluate(element=>{element.scrollTop=1700;});await f.page.waitForTimeout(150);}const compactBefore=await list.evaluate(element=>element.scrollTop);
  await panel.locator('button.bg-slate-900').click();await f.page.getByRole('button',{name:'Retour à la liste de travail',exact:true}).click();await panel.waitFor();
  if(width===1440)assert.ok(Math.abs((await list.evaluate(element=>element.scrollTop))-compactBefore)<2,'Full task returns to the separate compact-list scroll position');
  await panel.getByRole('button',{name:'Fermer le dossier',exact:true}).click();await target.waitFor();assert.ok(Math.abs((await list.evaluate(element=>element.scrollTop))-before)<2,'The original table/card position survives full-task navigation');
  assert.equal(f.requests.some(request=>/queue_message|save_quote|save_preparation_measurements/.test(request.path)),false,'Navigation never changes the dossier or sends a message');
 });
 await browser.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));for(const r of results)console.log(r.ok?'PASS':'FAIL',r.name,r.error?.split('\n').slice(0,3).join('\n')||'');if(results.some(r=>!r.ok))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
