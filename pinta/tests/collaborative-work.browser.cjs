/* Two isolated staff sessions, strict work commands, no customer or payment provider. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const B = '88888888-1111-4111-8111-111111111111';
const PREP = '77777777-0000-4000-8000-000000000001';
const DOCS = '77777777-0000-4000-8000-000000000002';
const QUOTE = '77777777-0000-4000-8000-000000000003';
const RECEIPT = '77777777-0000-4000-8000-000000000004';
const output = process.env.PINTA_COLLABORATIVE_OUT || '/tmp/pinta-collaborative-work';
const results = [];
const row = (f,id) => f.page.locator(`[data-work-action="${id}"]`);
const owner = f => f.page.getByRole('region', { name: 'Prise en charge de la tâche', exact: true });
const copy = value => structuredClone(value);

async function identity(f,id,name) {
  if (id === ids.A) return;
  const user = { id, aud:'authenticated', role:'authenticated', email:'colleague@example.test', user_metadata:{}, created_at:new Date().toISOString() };
  const token = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
  const session = { access_token:token,refresh_token:'test',token_type:'bearer',expires_in:3600,user };
  f.tables.profiles.push({id,nom:name,role:'directeur',actif:true});
  await f.context.route('**/auth/v1/token*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)}));
  await f.context.route('**/auth/v1/user',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)}));
}
async function fixture(browser,{mobile=false,readyQuote=false,holdAccept=false}={}) {
  const first=await setup(browser,'directeur'),second=await setup(browser,'directeur');
  first.tables.staff_users.push({id:B,auth_id:B,nom:'Madly',role:'directeur',actif:true,staff_permissions:{}});
  first.tables.staff_work_preferences=[ids.A,B].map(staff_id=>({staff_id,missions:['reception','preparation','communication','documents','departures','coordination'],active_mission:null,density:'comfortable',available:true,version:1}));
  const saved=first.tables.colis[0];
  Object.assign(saved,{statut:'en_preparation',feu_vert:'autorise',dims_par_colis:[{dimL:40,dimW:30,dimH:20,poids:1.5},{dimL:40,dimW:30,dimH:20,poids:1.5}],final_packages:[],final_measurements_version:null,final_measurements_at:null,outgoing_parcel_count:null,commentaire_preparation:'Protéger les objets fragiles.'});
  const make=(id,kind,state,assignee_id,extra={})=>({id,colis_id:ids.P,kind,state,assignee_id,version:1,created_at:'2026-09-21T08:00:00Z',updated_at:'2026-09-21T08:00:00Z',...extra});
  first.tables.staff_work_actions=[make(PREP,'preparation','ready',null),make(DOCS,'documents',readyQuote?'done':'in_progress',B),make(QUOTE,'quote','waiting',null,{blocked_reason:readyQuote?'Mesures de préparation à enregistrer':'Mesures et factures à vérifier'}),make(RECEIPT,'reception','done',ids.A)];
  if(!readyQuote) first.tables.factures[0].valide=false;
  for(const key of Object.keys(first.tables))second.tables[key]=first.tables[key];
  await identity(second,B,'Madly');
  const commands=[],errors=[],initialBusiness=copy([first.tables.colis,first.tables.factures,first.tables.lignes,first.tables.messages]);
  let acceptReceived, releaseAccept;
  const accepted = new Promise(resolve=>{acceptReceived=resolve;});
  const acceptGate = new Promise(resolve=>{releaseAccept=resolve;});
  const fixtures=[first,second];
  for(const [index,f] of fixtures.entries()){
    const me=index===0?ids.A:B;f.page.setDefaultTimeout(10000);
    await f.page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});
    await f.context.route('**/rest/v1/rpc/mutate_staff_work_action',async route=>{
      const input=route.request().postDataJSON(), action=first.tables.staff_work_actions.find(item=>item.id===input.p_action_id);
      commands.push({me,kind:'work',input:copy(input)});
      try{
        if(!action||action.version!==input.p_expected_version) return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001',message:'Cette tâche a changé. Madly ou Camille s’en occupe déjà.'})});
        if(input.p_command==='take'){
          assert.equal(action.state,'ready','Only genuinely ready work may be taken');assert.ok(!action.blocked_reason&&!action.waiting_reason);assert.ok(!action.assignee_id||action.assignee_id===me,'Cannot steal another operator’s task');
          action.assignee_id=me;action.state='in_progress';
        }else if(input.p_command==='handoff'){
          assert.equal(action.assignee_id,me);assert.ok(input.p_payload.note.trim());action.handoff_to=input.p_payload.staff_id;action.handoff_note=input.p_payload.note;
        }else if(input.p_command==='accept'){
          assert.equal(action.handoff_to,me);action.assignee_id=me;action.handoff_to=null;
        }else throw new Error('Unexpected work command '+input.p_command);
        action.version++;action.updated_at=new Date().toISOString();
        if(input.p_command==='accept'&&holdAccept){acceptReceived();await acceptGate;}
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(action)});
      }catch(error){errors.push(error.stack);return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:error.message})});}
    });
    await f.context.route('**/rest/v1/rpc/save_preparation_measurements',async route=>{
      const input=route.request().postDataJSON();commands.push({me,kind:'measure',input:copy(input)});
      try{
        assert.equal(input.p_expected_updated_at,saved.updated_at);assert.equal(input.p_expected_composition_version,saved.preparation_composition_version);
        assert.ok(input.p_final_packages.every(box=>[box.dimL,box.dimW,box.dimH,box.poids].every(value=>Number.isFinite(Number(value))&&Number(value)>0)));
        saved.final_packages=copy(input.p_final_packages);saved.final_measurements_version=saved.preparation_composition_version;saved.final_measurements_at=new Date().toISOString();saved.outgoing_parcel_count=input.p_final_packages.length;saved.updated_at=new Date().toISOString();
        Object.assign(first.tables.staff_work_actions.find(a=>a.id===PREP),{state:'done',version:3});
        Object.assign(first.tables.staff_work_actions.find(a=>a.id===QUOTE),readyQuote?{state:'ready',blocked_reason:null}:{state:'waiting',blocked_reason:'Factures à vérifier par Madly'});
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({colis:saved})});
      }catch(error){errors.push(error.stack);return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:error.message})});}
    });
  }
  return {first,second,fixtures,commands,errors,initialBusiness,saved,accepted,releaseAccept};
}
async function detail(f,section='preparation',action=PREP){await f.page.goto(`${base}/colis/${ids.P}?${new URLSearchParams({section,action,returnTo:'/?section=pool'})}`);await f.page.getByTestId('dossier-task-header').waitFor();}
async function browse(f){const summary=f.page.locator('summary').filter({hasText:'Parcourir les étapes'});if(await summary.count()&&!(await summary.locator('..').getAttribute('open')!==null))await summary.click();}
async function fillMeasures(f){for(const[label,unit,value]of[['Longueur','cm',32],['Largeur','cm',21],['Hauteur','cm',18],['Poids réel','kg',2.7]])await f.page.getByLabel(`${label} · colis sortant 1 (${unit})`,{exact:true}).fill(String(value));}
function noMessages(s){for(const f of s.fixtures){assert.equal(f.requests.some(r=>/\/(queue_message|client_decision|create-payment|confirm_departure)$/.test(r.path)),false);assert.deepEqual(f.networkDenied,[]);assert.deepEqual(f.errors,[]);}assert.deepEqual(s.errors,[]);assert.deepEqual(s.first.tables.messages,[]);}
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true});
  async function scenario(name,run,options={}){
    if(process.env.PINTA_COLLABORATIVE_FILTER&&!name.includes(process.env.PINTA_COLLABORATIVE_FILTER))return;
    const s=await fixture(browser,options);try{await s.first.login();await s.second.login();await run(s);noMessages(s);results.push({test:name,pass:true});}
    catch(error){process.exitCode=1;results.push({test:name,pass:false,error:error.stack});await s.first.page.screenshot({path:`${output}/${name}.png`,fullPage:true}).catch(()=>{});await fs.writeFile(`${output}/${name}.txt`,await s.first.page.locator('body').innerText().catch(()=>''));}
    finally{for(const f of s.fixtures)await f.context.close();console.log(JSON.stringify(results.at(-1)));}
  }
  try{
    await scenario('two-colleagues-taking-one-task-keeps-one-owner-and-independent-task',async s=>{
      await detail(s.first);await detail(s.second);
      await Promise.all(s.fixtures.map(f=>owner(f).getByRole('button',{name:'Je m’en occupe',exact:true}).click()));
      assert.equal(s.commands.length,2);assert.ok(s.commands.every(c=>c.input.p_command==='take'));
      const task=s.first.tables.staff_work_actions.find(a=>a.id===PREP);assert.equal(task.state,'in_progress');assert.equal(task.version,2);
      const loser=task.assignee_id===ids.A?s.second:s.first;
      await loser.page.getByRole('alert').filter({hasText:/tâche a changé/}).first().waitFor();
      await owner(loser).getByText(/Camille|Madly/).waitFor();assert.equal(await owner(loser).getByRole('button',{name:'Je m’en occupe',exact:true}).count(),0);
      assert.equal(s.first.tables.staff_work_actions.find(a=>a.id===DOCS).assignee_id,B);assert.equal(s.first.tables.staff_work_actions.find(a=>a.id===DOCS).state,'in_progress');
      assert.deepEqual([s.first.tables.colis,s.first.tables.factures,s.first.tables.lignes,s.first.tables.messages],s.initialBusiness);
    });
    await scenario('blocked-work-has-no-take-button-and-viewing-never-reserves',async s=>{
      await s.first.page.goto(base+'/?section=pool');await row(s.first,PREP).waitFor();assert.equal(await row(s.first,QUOTE).count(),0);
      await row(s.first,PREP).getByRole('link',{name:/^Ouvrir /}).click();await s.first.page.getByTestId('dossier-task-header').waitFor();assert.equal(s.commands.length,0);
      await detail(s.first,'devis',QUOTE);await owner(s.first).getByText(/Mesures et factures à vérifier/).waitFor();assert.equal(await owner(s.first).getByRole('button',{name:'Je m’en occupe',exact:true}).count(),0);
      assert.equal(s.commands.length,0);
    });
    for(const mobile of [false,true]) await scenario(`completed-preparation-explains-colleague-work-${mobile?'mobile':'desktop'}`,async s=>{
      await detail(s.first);await owner(s.first).getByRole('button',{name:'Je m’en occupe',exact:true}).click();await owner(s.first).getByText('Vous vous en occupez',{exact:true}).waitFor();
      await fillMeasures(s.first);await s.first.page.getByRole('button',{name:'Enregistrer l’optimisation',exact:true}).click();
      const after=s.first.page.getByRole('navigation',{name:'Après cette tâche',exact:true});await after.getByText(/Madly/).first().waitFor();await after.getByText(/Factures|factures/).first().waitFor();
      assert.deepEqual(s.saved.dims_par_colis,s.initialBusiness[0][0].dims_par_colis);assert.equal(Number(s.saved.final_packages[0].poids),2.7);assert.equal(s.saved.feu_vert,'autorise');
      assert.equal(s.first.tables.staff_work_actions.find(a=>a.id===DOCS).assignee_id,B);assert.equal(s.first.tables.staff_work_actions.find(a=>a.id===QUOTE).state,'waiting');
      assert.equal(await s.first.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await s.first.page.screenshot({path:`${output}/completion-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    },{mobile});
    await scenario('completed-preparation-releases-quote-to-pool-without-invented-owner',async s=>{
      await detail(s.first);await owner(s.first).getByRole('button',{name:'Je m’en occupe',exact:true}).click();await fillMeasures(s.first);await s.first.page.getByRole('button',{name:'Enregistrer l’optimisation',exact:true}).click();
      const after=s.first.page.getByRole('navigation',{name:'Après cette tâche',exact:true});await after.getByText(/devis/i).first().waitFor();await after.getByText(/prendre|disponible/i).first().waitFor();
      const quote=s.first.tables.staff_work_actions.find(a=>a.id===QUOTE);assert.equal(quote.state,'ready');assert.equal(quote.assignee_id,null);
      await s.second.page.goto(base+'/?section=pool');await row(s.second,QUOTE).getByRole('button',{name:'Je m’en occupe',exact:true}).waitFor();assert.equal(s.commands.filter(c=>c.kind==='work').length,1);
    },{readyQuote:true});
    await scenario('team-priorities-separate-ready-work-waits-and-active-colleagues',async s=>{
      await s.first.page.goto(base+'/equipe');
      const ready=s.first.page.getByRole('region',{name:'Prêt à prendre',exact:true});await ready.locator(`[data-work-action="${PREP}"]`).waitFor();
      assert.equal(await row(s.first,QUOTE).count(),0);assert.equal(await row(s.first,DOCS).count(),0);
      await s.first.page.getByRole('navigation',{name:'Priorités de l’équipe',exact:true}).getByRole('button',{name:'En attente (1)',exact:true}).click();
      await row(s.first,QUOTE).getByText(/Mesures et factures à vérifier/).waitFor();assert.equal(await row(s.first,QUOTE).getByRole('button',{name:'Je m’en occupe',exact:true}).count(),0);
      await s.first.page.getByRole('button',{name:'Tout le travail (3)',exact:true}).click();await row(s.first,DOCS).getByText(/Madly/).waitFor();
      assert.equal(await row(s.first,RECEIPT).count(),0,'Completed work stays in dossier history rather than daily workload');
      assert.equal(s.commands.length,0);await s.first.page.screenshot({path:`${output}/team-priorities.png`,fullPage:true});
    });
    await scenario('shared-dossier-summary-shows-completed-work-owners-and-specific-blockers',async s=>{
      await detail(s.first);await s.first.page.getByRole('button',{name:'Détails du dossier',exact:true}).click();
      await s.first.page.getByRole('dialog', { name: 'Contexte du dossier' }).getByRole('button', { name: 'Équipe', exact: true }).click();
      const summary=s.first.page.getByRole('region',{name:'Suivi partagé du dossier',exact:true});await summary.waitFor();
      const completed=summary.locator('[data-dossier-work="reception"]');await completed.getByText('Terminé',{exact:true}).waitFor();await completed.getByText('Vous',{exact:true}).waitFor();
      await summary.locator('[data-dossier-work="documents"]').getByText('Madly',{exact:true}).waitFor();
      await summary.locator('[data-dossier-work="quote"]').getByText(/Mesures et factures à vérifier/).waitFor();
      assert.equal(await summary.getByRole('button',{name:'Je m’en occupe',exact:true}).count(),0,'Task commands are secondary in shared summary');
      assert.equal(s.commands.length,0);await s.first.page.screenshot({path:`${output}/shared-dossier-summary.png`,fullPage:true});
    });
    await scenario('viewing-colleagues-preparation-is-readonly-but-own-invoice-work-remains-available',async s=>{
      const preparation=s.first.tables.staff_work_actions.find(a=>a.id===PREP),documents=s.first.tables.staff_work_actions.find(a=>a.id===DOCS);
      preparation.assignee_id=B;preparation.state='in_progress';documents.assignee_id=ids.A;
      await detail(s.first);await owner(s.first).getByText('Pris en charge par Madly',{exact:true}).waitFor();
      const measureSave=s.first.page.getByRole('button',{name:'Enregistrer l’optimisation',exact:true});
      if(await measureSave.count())assert.equal(await measureSave.isDisabled(),true,'A colleague’s assigned work is read-only');
      const measure=s.first.page.getByLabel('Longueur · colis sortant 1 (cm)',{exact:true});
      if(await measure.count())assert.equal(await measure.isEditable(),false,'Viewing never exposes an editable colleague measurement');
      await detail(s.first,'documents',DOCS);await owner(s.first).getByText('Vous vous en occupez',{exact:true}).waitFor();
      const add=s.first.page.locator('summary').filter({hasText:'Ajouter un achat supplémentaire sans facture reliée'});await add.click();
      const description=s.first.page.getByLabel('Description du nouvel article',{exact:true});assert.equal(await description.isEditable(),true,'Invoice work stays independent of the preparation owner');
      await description.fill('Achat à vérifier par mon équipe');assert.equal(s.commands.length,0);
    });
    await scenario('unsaved-invoice-article-blocks-handoff-after-return-to-the-list',async s=>{
      s.first.tables.staff_work_actions.find(a=>a.id===DOCS).assignee_id=ids.A;
      await detail(s.first,'documents',DOCS);await s.first.page.locator('summary').filter({hasText:'Ajouter un achat supplémentaire sans facture reliée'}).click();
      await s.first.page.getByLabel('Description du nouvel article',{exact:true}).fill('Article non enregistré à conserver');
      await s.first.page.getByRole('button',{name:'Retour à la liste de travail',exact:true}).click();await s.first.page.getByRole('navigation',{name:'Mes tâches',exact:true}).getByRole('button',{name:/À faire/}).click();
      const task=row(s.first,DOCS);await task.getByRole('button',{name:'Options',exact:true}).click();await task.getByRole('button',{name:'Remettre à disposition',exact:true}).click();
      await task.getByRole('alert').filter({hasText:/Enregistrez ou annulez vos saisies/}).waitFor();assert.equal(s.commands.length,0);
      await task.getByRole('button',{name:'Continuer',exact:true}).click();const add=s.first.page.locator('summary').filter({hasText:'Ajouter un achat supplémentaire sans facture reliée'});
      if(!(await s.first.page.getByLabel('Description du nouvel article',{exact:true}).isVisible()))await add.click();
      assert.equal(await s.first.page.getByLabel('Description du nouvel article',{exact:true}).inputValue(),'Article non enregistré à conserver');
      assert.deepEqual(s.first.tables.lignes,s.initialBusiness[2]);
    });
    await scenario('unsaved-measures-block-handoff-on-task-and-after-return-to-work-list',async s=>{
      await detail(s.first);await owner(s.first).getByRole('button',{name:'Je m’en occupe',exact:true}).click();await fillMeasures(s.first);
      await owner(s.first).getByRole('button',{name:'Options',exact:true}).click();await owner(s.first).getByRole('button',{name:'Passer à un collègue',exact:true}).click();
      await owner(s.first).getByLabel('Passer à').selectOption(B);await owner(s.first).getByLabel('Consigne pour la reprise').fill('Ne pas perdre les nouvelles mesures.');
      await owner(s.first).getByRole('button',{name:'Proposer le relais',exact:true}).click();await owner(s.first).getByRole('alert').filter({hasText:/Enregistrez ou annulez vos saisies/}).waitFor();
      assert.equal(s.commands.filter(c=>c.kind==='work').length,1);assert.equal(await s.first.page.getByLabel('Longueur · colis sortant 1 (cm)',{exact:true}).inputValue(),'32');
      assert.equal(await owner(s.first).getByLabel('Consigne pour la reprise').inputValue(),'Ne pas perdre les nouvelles mesures.');
      await s.first.page.getByRole('button',{name:'Retour à la liste de travail',exact:true}).click();await s.first.page.getByRole('navigation',{name:'Mes tâches',exact:true}).getByRole('button',{name:/À faire/}).click();
      const task=row(s.first,PREP);await task.getByRole('button',{name:'Options',exact:true}).click();await task.getByRole('button',{name:'Remettre à disposition',exact:true}).click();
      await task.getByRole('alert').filter({hasText:/Enregistrez ou annulez vos saisies/}).waitFor();assert.equal(s.commands.filter(c=>c.kind==='work').length,1);
      await task.getByRole('button',{name:'Continuer',exact:true}).click();assert.equal(await s.first.page.getByLabel('Longueur · colis sortant 1 (cm)',{exact:true}).inputValue(),'32');
      assert.deepEqual([s.first.tables.colis,s.first.tables.factures,s.first.tables.lignes,s.first.tables.messages],s.initialBusiness);
    });
    await scenario('handoff-keeps-owner-until-accepted-and-delivers-the-saved-instructions',async s=>{
      await detail(s.first);await owner(s.first).getByRole('button',{name:'Je m’en occupe',exact:true}).click();
      await owner(s.first).getByRole('button',{name:'Options',exact:true}).click();await owner(s.first).getByRole('button',{name:'Passer à un collègue',exact:true}).click();
      await owner(s.first).getByLabel('Passer à').selectOption(B);await owner(s.first).getByLabel('Consigne pour la reprise').fill('Vérifier la protection du carton fragile avant fermeture.');
      await owner(s.first).getByRole('button',{name:'Proposer le relais',exact:true}).click();await owner(s.first).getByText(/Relais proposé à Madly/).waitFor();
      const task=s.first.tables.staff_work_actions.find(a=>a.id===PREP);assert.equal(task.assignee_id,ids.A);assert.equal(task.handoff_to,B);
      await s.second.page.goto(base+'/?section=now');const relay=s.second.page.getByRole('region',{name:'Relais à accepter',exact:true});
      await relay.getByText(/Vérifier la protection du carton fragile/).waitFor();await relay.getByRole('button',{name:'Accepter et ouvrir',exact:true}).click();
      await s.second.page.waitForURL(url=>url.pathname===`/colis/${ids.P}`&&url.searchParams.get('section')==='preparation');
      await owner(s.second).getByText('Vous vous en occupez',{exact:true}).waitFor();await owner(s.second).getByText(/Vérifier la protection du carton fragile/).waitFor();
      assert.equal(task.assignee_id,B);assert.equal(task.handoff_to,null);assert.equal(task.state,'in_progress');assert.ok(task.handoff_note);
      await s.first.page.reload();await owner(s.first).getByText('Pris en charge par Madly',{exact:true}).waitFor();
      assert.deepEqual([s.first.tables.colis,s.first.tables.factures,s.first.tables.lignes,s.first.tables.messages],s.initialBusiness,'Assignment does not save or validate business data');
    });
    await scenario('colleagues-conversation-is-readable-without-sending-or-closing-their-work',async s=>{
      const conversation='77777777-0000-4000-8000-000000000005';s.first.tables.colis[0].conversation_statut='a_traiter';s.first.tables.colis[0].conversation_version=1;
      s.first.tables.staff_work_actions.push({id:conversation,colis_id:ids.P,kind:'conversation',state:'in_progress',assignee_id:B,version:1,created_at:'2026-09-21T08:00:00Z'});
      await s.first.page.goto(`${base}/conversations?dossier=${ids.P}&action=${conversation}`);await s.first.page.getByRole('log',{name:'Messages avec le client',exact:true}).waitFor();
      const reply=s.first.page.getByLabel('Votre réponse au client',{exact:true});if(await reply.count())assert.equal(await reply.isEditable(),false);
      const send=s.first.page.getByRole('button',{name:'Envoyer le message',exact:true});if(await send.count())assert.equal(await send.isDisabled(),true);
      await s.first.page.locator('summary').filter({hasText:'Gérer le suivi'}).click();assert.equal(await s.first.page.getByRole('button',{name:'Marquer comme traité',exact:true}).count(),0);
      await s.second.page.goto(`${base}/conversations?dossier=${ids.P}&action=${conversation}`);const ownReply=s.second.page.getByLabel('Votre réponse au client',{exact:true});await ownReply.fill('Brouillon du collègue qui suit la conversation.');
      assert.equal(await s.second.page.getByRole('button',{name:'Envoyer le message',exact:true}).isEnabled(),true);
      await s.second.page.locator('summary').filter({hasText:'Gérer le suivi'}).click();assert.equal(await s.second.page.getByRole('button',{name:'Marquer comme traité',exact:true}).isEnabled(),true);
      assert.equal(s.commands.length,0);assert.equal(s.fixtures.some(f=>f.requests.some(r=>r.path.endsWith('/set_conversation_state'))),false);assert.equal(s.first.tables.colis[0].conversation_statut,'a_traiter');
    });
    await scenario('late-handoff-acceptance-never-pulls-operator-back-from-another-screen',async s=>{
      const task=s.first.tables.staff_work_actions.find(a=>a.id===PREP);Object.assign(task,{state:'in_progress',assignee_id:ids.A,handoff_to:B,handoff_note:'Consigne enregistrée à reprendre.'});
      await s.second.page.goto(base+'/?section=now');await s.second.page.getByRole('region',{name:'Relais à accepter',exact:true}).getByRole('button',{name:'Accepter et ouvrir',exact:true}).click();await s.accepted;
      const response=s.second.page.waitForResponse(response=>response.url().endsWith('/mutate_staff_work_action'));
      try{
        await s.second.page.getByRole('button',{name:'Clients',exact:true}).click();await s.second.page.getByRole('heading',{name:'Clients',exact:true}).waitFor();
      }finally{s.releaseAccept();}
      await response;
      await s.second.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(new URL(s.second.page.url()).pathname,'/clients');assert.equal(task.assignee_id,B);assert.equal(task.handoff_to,null);
      assert.equal(await s.second.page.getByText('Relais accepté. La consigne et les informations enregistrées sont disponibles.',{exact:true}).count(),0,'An obsolete task response does not show success on another screen');
    },{holdAccept:true});
    await scenario('step-browsing-preserves-local-draft-and-every-business-state',async s=>{
      await detail(s.first);await fillMeasures(s.first);await browse(s.first);
      const select=s.first.page.getByLabel('Tâche du dossier',{exact:true});await select.selectOption('accord');await select.selectOption('preparation');
      assert.equal(await s.first.page.getByLabel('Longueur · colis sortant 1 (cm)',{exact:true}).inputValue(),'32');assert.equal(await s.first.page.getByLabel('Poids réel · colis sortant 1 (kg)',{exact:true}).inputValue(),'2.7');
      assert.equal(s.commands.length,0);assert.deepEqual([s.first.tables.colis,s.first.tables.factures,s.first.tables.lignes,s.first.tables.messages],s.initialBusiness);
    });
  }finally{await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
