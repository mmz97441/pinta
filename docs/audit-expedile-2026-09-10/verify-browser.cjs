const { chromium } = require(process.env.PINTA_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const out = process.env.PINTA_AUDIT_OUT || __dirname;
const base = process.env.PINTA_AUDIT_URL || 'http://127.0.0.1:4175';
const authId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const parcelId = '33333333-3333-4333-8333-333333333333';
const observations = [];
async function scenario(browser, role) {
  const context = await browser.newContext({viewport:{width:1440,height:1000}, locale:'fr-FR'});
  await context.routeWebSocket('**/*', socket => socket.close());
  const requests = [], errors = [];
  const user = {id:authId, aud:'authenticated',role:'authenticated',email:'audit@example.test',user_metadata:{role,nom:'Audit',prenom:'Camille'},created_at:new Date().toISOString()};
  const token = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:authId,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.audit';
  const tables = {
    clients:[{id:clientId,nom:'Exemple',prenom:'Camille',email:'camille@example.test',cp:'97400',ville:'Saint-Denis',type:'particulier',abonnement:'freemium',created_at:'2026-09-01T08:00:00Z'}],
    colis:[{id:parcelId,client_id:clientId,ref:'EXP-AUDIT-001',statut:'en_preparation',desc_contenu:'Achats fictifs',trackings:['TEST-001','TEST-002'],casier:'A-03',date_reception:'2026-09-08T08:00:00Z',created_at:'2026-09-08T08:00:00Z',dim_l:40,dim_w:30,dim_h:20,poids:3,fin_l:30,fin_w:20,fin_h:20,fin_p:3,feu_vert:'autorise',archive:false}],
    factures:[{id:'44444444-4444-4444-8444-444444444444',colis_id:parcelId,vendeur:'Vendeur fictif',montant:100,valide:true}],
    lignes:[{id:'55555555-5555-4555-8555-555555555555',colis_id:parcelId,description:'Article fictif',qte:1,prix_unitaire:100,categorie_id:'cat-audit'}],
    categories:[{id:'cat-audit',label:'Divers',position:1}],
    taux_categories:[{categorie_id:'cat-audit',destination_code:'974',om:10,omr:2.5}],
    tarifs:[{destination_code:'974',base:25,par_kg:5,actif:true}],
    staff_users:[{id:'66666666-6666-4666-8666-666666666666',auth_id:authId,role,nom:'Audit',prenom:'Camille',actif:true,must_change_password:false,staff_permissions:[]}],
    envois:[],messages:[],notifications:[]
  };
  await context.route('**/*',async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.origin===base && !url.pathname.startsWith('/api/')) return route.continue();
    requests.push({method:req.method(),path:url.pathname,...(req.method()==='PATCH'&&url.pathname.endsWith('/colis')?{body:req.postDataJSON()}:{})});
    let body={};
    if(url.pathname.includes('/auth/v1/token')) body={access_token:token,refresh_token:'audit',token_type:'bearer',expires_in:3600,user};
    else if(url.pathname.includes('/auth/v1/user')) body=user;
    else if(url.pathname.includes('/rest/v1/')) {
      const table=url.pathname.split('/').pop();
      body=tables[table]||[];
      if(req.method()==='POST') {
        const input=req.postDataJSON();
        body={id:crypto.randomUUID(),...input};
        if(table==='envois')tables.envois.push(body);
      } else if(req.headers().accept?.includes('vnd.pgrst.object')) body=body[0]||null;
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'access-control-allow-origin':'*'}});
  });
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.screenshot({path:out+'/login-'+role+'.png',fullPage:true});
  await page.locator('input[type=email]').fill('audit@example.test');
  await page.locator('input[type=password]').fill('fictitious-test-password');
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await page.getByRole('heading',{name:'Tableau de bord',exact:true}).waitFor();
  await page.screenshot({path:out+'/dashboard-'+role+'.png',fullPage:true});
  observations.push({test:'login-role-'+role,staffDashboardVisible:true,errors:[...errors]});
  if(role==='directeur') {
    await page.getByRole('button',{name:'Paramètres',exact:true}).first().click();
    observations.push({test:'open-settings-creates-departures',postCount:requests.filter(r=>r.method==='POST'&&r.path.endsWith('/envois')).length});
    const tabs=await page.getByRole('button').allTextContents();
    observations.push({test:'settings-buttons',labels:tabs.filter(x=>/template|message|modèle/i.test(x))});
    await page.getByRole('button',{name:/Templates/}).first().click();
    const original=await page.locator('textarea').first().inputValue();
    await page.locator('textarea').first().fill('AUDIT TEST — message temporaire');
    const before=requests.length;
    await page.getByRole('button',{name:'Sauvegarder',exact:true}).click();
    observations.push({test:'template-save',feedback:await page.getByRole('button',{name:/Sauvegardé/}).isVisible(),networkRequests:requests.slice(before)});
    await page.getByRole('button',{name:'Colis',exact:true}).first().click();
    await page.screenshot({path:out+'/colis-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'Paramètres',exact:true}).first().click();
    await page.getByRole('button',{name:/Templates/}).first().click();
    observations.push({test:'template-remount',originalRestored:(await page.locator('textarea').first().inputValue())===original});
    await page.getByRole('button',{name:'Colis',exact:true}).first().click();
    await page.getByText('EXP-AUDIT-001',{exact:true}).first().click();
    await page.screenshot({path:out+'/colis-detail-desktop.png',fullPage:true});
    await page.locator('input[type="number"][value="3"]').first().fill('5');
    const calculated=page.waitForRequest(req=>req.method()==='PATCH'&&req.url().includes('/rest/v1/colis')&&req.postDataJSON()?.devis_total!==undefined);
    await page.getByRole('button',{name:'Prévisualiser le devis',exact:true}).click();
    const calculationRequest=await calculated;
    observations.push({test:'quote-after-weight-change',newWeight:5,expectedTransport:50,actualTransport:calculationRequest.postDataJSON().devis_transport});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:out+'/colis-detail-mobile.png',fullPage:true});
    observations.push({test:'mobile-overflow',width:390,scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth)});
    observations.push({test:'open-settings-final-post-count',count:requests.filter(r=>r.method==='POST'&&r.path.endsWith('/envois')).length});
  }
  await page.reload();
  await page.locator('input[type=email]').waitFor();
  observations.push({test:'session-reload-'+role,loginVisible:true,errors});
  await context.close();
}
(async()=>{
  await fs.mkdir(out,{recursive:true});
  const browser=await chromium.launch({headless:true});
  try {await scenario(browser,'client'); await scenario(browser,'directeur');}
  catch(e){observations.push({test:'harness-error',message:e.message});process.exitCode=1;}
  finally {await browser.close(); await fs.writeFile(out+'/browser-results.json',JSON.stringify(observations,null,2)); console.log(JSON.stringify(observations,null,2));}
})();
