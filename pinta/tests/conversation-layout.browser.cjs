/* Full workspace conversation: synthetic messages only; every transport intercepted. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const output = process.env.PINTA_CONVERSATION_LAYOUT_OUT || '/tmp/pinta-conversation-layout';
const results=[];
const log=f=>f.page.getByRole('log',{name:'Messages avec le client',exact:true});
const reply=f=>f.page.getByLabel('Votre réponse au client',{exact:true});
const tab=(f,name)=>f.page.getByRole('tab',{name:name==='Colis'?'Colis':/^Conversation/,exact:name==='Colis'});
const messageReads=f=>f.requests.filter(request=>request.path==='/rest/v1/messages'&&request.method==='PATCH');
function fixture(f){
  f.tables.clients[0].user_id='client-fixture';
  Object.assign(f.tables.colis[0],{conversation_statut:'a_traiter',conversation_version:1});
  f.tables.staff_work_actions.push({id:'77777777-0000-4000-8000-000000000010',colis_id:ids.P,kind:'conversation',state:'in_progress',assignee_id:ids.A,version:1,created_at:'2026-10-01T06:00:00Z'});
  f.tables.messages=Array.from({length:25},(_,i)=>({id:`layout-message-${i}`,colis_id:ids.P,type:i%2?'staff':'client',auteur_nom:i%2?'Marie Exemple':'Camille Exemple',texte:`Échange ${i+1} : merci de conserver les achats ensemble. ${i===15?'REFERENCE'+('1234567890'.repeat(20)):''}`,lu:true,created_at:`2026-10-01T06:${String(i).padStart(2,'0')}:00Z`}));
}
async function open(f){await f.page.goto(`${base}/colis/${ids.P}?section=preparation&onglet=conversation`);await reply(f).waitFor();await log(f).getByText(/^Échange 25 :/).waitFor();}
async function main(){
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true});
  async function scenario(name,run){
    if(process.env.PINTA_CONVERSATION_LAYOUT_FILTER&&!name.includes(process.env.PINTA_CONVERSATION_LAYOUT_FILTER))return;
    const f=await setup(browser,'directeur');f.page.setDefaultTimeout(12000);fixture(f);const before=structuredClone(f.tables.colis);
    try{await run(f);assert.deepEqual(f.tables.colis,f.expectedServerColis||before);assert.deepEqual(f.errors,[]);assert.deepEqual(f.networkDenied,[]);
      const writes=f.requests.filter(r=>['POST','PATCH','DELETE'].includes(r.method)&&r.path.startsWith('/rest/v1/')&&!['/rest/v1/rpc/refresh_staff_work_actions','/rest/v1/rpc/get_invoice_review_context','/rest/v1/rpc/get_reception_dates','/rest/v1/messages'].includes(r.path));
      assert.deepEqual(writes,[],'Reading, resizing and drafting never send, claim, notify or advance a task.');
      assert.equal(f.requests.some(r=>/\/(queue_message|send-email|send-telegram)$/.test(r.path)),false);results.push({test:name,pass:true});
    }catch(error){process.exitCode=1;results.push({test:name,pass:false,error:error.stack});await f.page.screenshot({path:`${output}/${name}-failure.png`,fullPage:true}).catch(()=>{});await fs.writeFile(`${output}/${name}-failure.txt`,await f.page.locator('body').innerText().catch(()=>''));}
    finally{await f.context.close();console.log(JSON.stringify(results.at(-1)));}
  }
  try{
    for(const width of [1920,1440,768,390,320])for(const dark of [false,true])await scenario(`conversation-uses-workspace-and-keeps-composer-visible-${width}-${dark?'dark':'light'}`,async f=>{
      const height=width<640?844:1000;await f.page.setViewportSize({width,height});await f.context.addInitScript(dark=>localStorage.setItem('expedile-theme',dark?'dark':'light'),dark);await f.login();await open(f);
      const panel=f.page.getByRole('tabpanel',{name:/^Conversation/}),chat=panel.locator('.dossier-conversation__chat');
      const panelBox=await panel.boundingBox(),chatBox=await chat.boundingBox(),logBox=await log(f).boundingBox(),replyBox=await reply(f).boundingBox();
      const send=f.page.getByRole('button',{name:'Envoyer le message',exact:true});const sendBox=await send.boundingBox();
      assert.ok(chatBox.width>=panelBox.width-(width>=1024?65:width>=640?49:33),'Chat occupies the available width with only the page gutters.');
      if(width===1920)assert.ok(chatBox.width>1500,'Wide screens are no longer limited to a narrow centered chat.');
      assert.ok(chatBox.height>=320,'Short screens retain the usable conversation minimum.');
      assert.ok(logBox.height>=96,'History keeps useful reading space.');assert.ok(sendBox.height>=44);
      if(width<640)assert.ok(replyBox.width>=chatBox.width*.8,'The phone composer has useful writing width.');
      const bottom=width<1024?(await f.page.getByRole('button',{name:'Dossiers',exact:true}).locator('..').boundingBox()).y:height;
      const history=await panel.locator('summary').filter({hasText:'Ce qui a déjà été fait'}).boundingBox();
      assert.ok(replyBox.y>=0&&sendBox.y+sendBox.height<=bottom,`Composer and send action are above navigation (${sendBox.y+sendBox.height} <= ${bottom}).`);
      assert.ok(history.y+history.height<=bottom,'The collapsed dossier history remains reachable without covering the composer.');
      assert.ok(bottom-history.y-history.height<=40,'The available height is used, without a large empty area below the chat.');
      assert.ok(history.y-chatBox.y-chatBox.height<=24,'The chat grows down to the history control.');
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      const overflow=await log(f).evaluate(node=>({scroll:node.scrollHeight,visible:node.clientHeight,overflow:getComputedStyle(node).overflowY}));
      assert.ok(overflow.scroll>overflow.visible*2&&['auto','scroll'].includes(overflow.overflow));
      await log(f).evaluate(node=>{node.scrollTop=node.scrollHeight;});
      const topBefore=await log(f).evaluate(node=>node.scrollTop);const composerBefore=await reply(f).boundingBox();
      await log(f).hover();await f.page.mouse.wheel(0,-240);await f.page.waitForFunction(()=>document.querySelector('[role="log"]').scrollTop<document.querySelector('[role="log"]').scrollHeight-document.querySelector('[role="log"]').clientHeight-20);
      assert.ok(await log(f).evaluate(node=>node.scrollTop)<topBefore);const composerAfter=await reply(f).boundingBox();
      assert.ok(Math.abs(composerBefore.y-composerAfter.y)<=1,'Scrolling messages does not move the response field.');
      const audit=await new AxeBuilder({page:f.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
      await f.page.screenshot({path:`${output}/conversation-${width}-${dark?'dark':'light'}.png`,fullPage:true});
    });
    await scenario('short-screen-expanded-controls-keep-keyboard-composer-and-send-reachable',async f=>{
      await f.page.setViewportSize({width:390,height:568});await f.login();await open(f);
      // The status bar's task options expand in place, above the history and the reply.
      await f.page.locator('#conversation-client .chat-status').getByRole('button',{name:'Options',exact:true}).click();
      await f.page.getByRole('button',{name:'Mettre en attente',exact:true}).waitFor();
      await reply(f).fill('Brouillon conservé sur un écran court.');
      const send=f.page.getByRole('button',{name:'Envoyer le message',exact:true});await send.focus();await send.scrollIntoViewIfNeeded();
      // While typing on a short phone the bottom bar steps aside: then the screen's own bottom is the limit.
      const navButton=f.page.getByRole('button',{name:'Dossiers',exact:true});
      const action=await send.boundingBox(),nav=await navButton.count()?await navButton.locator('..').boundingBox():{y:await f.page.evaluate(()=>innerHeight)};
      const ancestors=await send.evaluate(node=>{const result=[];for(let p=node;p;p=p.parentElement){const r=p.getBoundingClientRect(),c=getComputedStyle(p);result.push({tag:p.tagName,id:p.id,class:p.className,y:r.y,height:r.height,scrollTop:p.scrollTop,client:p.clientHeight,total:p.scrollHeight,overflow:c.overflowY});}return result;});
      assert.ok(action.y>=48&&action.y+action.height<=nav.y,'The short-screen fallback scroll reaches the whole send button above navigation: '+JSON.stringify({action,nav,ancestors}));
      assert.equal(await send.isEnabled(),true);await reply(f).focus();await reply(f).scrollIntoViewIfNeeded();
      assert.equal(await reply(f).inputValue(),'Brouillon conservé sur un écran court.');assert.equal(f.tables.messages.length,25);
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    });
    await scenario('tab-switch-and-reload-preserve-one-draft-without-sending',async f=>{
      await f.login();await open(f);await reply(f).fill('Je conserve cette réponse sans l’envoyer.');
      await tab(f,'Colis').click();await log(f).waitFor({state:'hidden'});assert.equal(await log(f).count(),0);assert.equal(await f.page.locator('#dossier-panel-conversation').getAttribute('hidden'),'');
      assert.equal(await f.page.locator('#dossier-panel-conversation').evaluate(node=>getComputedStyle(node).display),'none','Flex styling never overrides hidden.');
      await tab(f,'Conversation').click();assert.equal(await reply(f).inputValue(),'Je conserve cette réponse sans l’envoyer.');
      assert.equal(await f.page.locator('textarea[id^="staff-message-"]').count(),1);
      await f.page.reload();await reply(f).waitFor();assert.equal(await reply(f).inputValue(),'Je conserve cette réponse sans l’envoyer.');
      assert.equal(f.tables.messages.length,25);
    });
    await scenario('hidden-conversation-never-consumes-an-incoming-message',async f=>{
      await f.login();await open(f);await tab(f,'Colis').click();await log(f).waitFor({state:'hidden'});const before=messageReads(f).length;
      f.tables.colis[0].updated_at='2099-10-01T07:00:00Z';f.expectedServerColis=structuredClone(f.tables.colis);
      f.tables.messages.push({...f.tables.messages[0],id:'layout-later',texte:'Une facture vient d’être déposée.',lu:false,created_at:'2026-10-01T07:00:00Z'});
      await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await tab(f,'Conversation').getByLabel('1 messages non lus',{exact:true}).waitFor();
      assert.equal(messageReads(f).length,before);assert.equal(f.tables.messages.at(-1).lu,false);
      await tab(f,'Conversation').click();await log(f).getByText('Une facture vient d’être déposée.',{exact:true}).waitFor();
      await f.page.waitForFunction(()=>!document.querySelector('[aria-label="1 messages non lus"]'));
      assert.equal(f.tables.messages.at(-1).lu,true);
      // The expected updated_at change comes from the simulated server refresh.
    });
  }finally{await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
