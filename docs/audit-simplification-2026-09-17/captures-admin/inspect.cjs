const root='/Users/niceguillaume/pinta/pinta';
const {chromium}=require(root+'/node_modules/playwright');
const AxeBuilder=require(root+'/node_modules/@axe-core/playwright').default;
const {setup,base,ids}=require(root+'/tests/browser-regression.cjs');
const fs=require('node:fs/promises');
const out='/tmp/pinta-audit-simple-admin';
const evidence=[];
async function snapshot(f,name,axe=false){
 await f.page.waitForTimeout(250);
 const text=await f.page.locator('body').innerText();
 const layout=await f.page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,scrollWidth:document.documentElement.scrollWidth,inputs:[...document.querySelectorAll('input,select,textarea')].filter(x=>x.getBoundingClientRect().width>0).map(x=>({tag:x.tagName,label:x.getAttribute('aria-label')||x.labels?.[0]?.innerText||'',placeholder:x.placeholder,type:x.type,value:x.value})),smallButtons:[...document.querySelectorAll('button,a')].filter(x=>{let r=x.getBoundingClientRect();return r.width>0&&r.height>0&&(r.height<40||r.width<40)}).map(x=>({text:x.innerText||x.getAttribute('aria-label'),height:Math.round(x.getBoundingClientRect().height),width:Math.round(x.getBoundingClientRect().width)}))}));
 let violations=[];
 if(axe)try{violations=(await new AxeBuilder({page:f.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));}catch(e){violations=[{error:e.message}]}
 await f.page.screenshot({path:`${out}/${name}.png`,fullPage:true});
 await fs.writeFile(`${out}/${name}.txt`,text);
 evidence.push({name,url:f.page.url(),...layout,violations});
 console.log(name,JSON.stringify({overflow:layout.overflow,inputs:layout.inputs.length,violations:violations.map(v=>v.id),errors:f.errors}));
}
async function main(){const browser=await chromium.launch({headless:true});const f=await setup(browser,'directeur'); f.page.setDefaultTimeout(7000);
 f.tables.clients.push({...f.tables.clients[0],id:'22222222-2222-4222-8222-222222222223',nom:'Entreprise Exemple',prenom:'Julie',type:'pro',email:'pro@example.test',raison_sociale:'Entreprise Exemple',siret:'12345678912345',mode_paiement:'mensuel'});
 f.tables.staff_users.push({id:'66666666-6666-4666-8666-666666666667',auth_id:'11111111-1111-4111-8111-111111111112',nom:'Martin',prenom:'Lou',email:'lou@example.test',role:'preparateur',actif:true,must_change_password:false,staff_permissions:[{staff_id:'66666666-6666-4666-8666-666666666667',perm_factures_voir:true,perm_colis_preparer:true}]});
 f.tables.staff_permissions.push({staff_id:'66666666-6666-4666-8666-666666666667',perm_factures_voir:true,perm_colis_preparer:true});
 try{
 await f.login();
 for(const [url,name] of [['/clients','clients-desktop'],['/clients/new','client-create-desktop'],[`/clients/${ids.C}`,'client-summary-desktop'],['/clients/22222222-2222-4222-8222-222222222223','client-pro-desktop'],['/devis','estimate-empty-desktop'],['/plus','more-desktop'],['/password','password-desktop']]){await f.page.goto(base+url);await snapshot(f,name,true);}
 await f.page.goto(base+`/clients/${ids.C}`);
 for(const [label,name] of [['Coordonnées','client-contact-desktop'],['Abonnement et administration','client-admin-desktop']]){await f.page.getByRole('button',{name:label,exact:true}).click();await snapshot(f,name,true);}
 await f.page.goto(base+'/settings');
 for(const [label,name] of [['Départs','settings-departures'],['Tarifs','settings-rates'],['Catégories','settings-categories'],['Équipe et accès','settings-users'],['Telegram','settings-telegram'],['Messages','settings-templates'],['Règles métier','settings-business'],['Produits interdits','settings-forbidden']]){await f.page.getByRole('navigation',{name:'Paramètres',exact:true}).getByRole('button',{name:label,exact:true}).click();await snapshot(f,name,true);}
 await f.page.getByRole('navigation',{name:'Paramètres',exact:true}).getByRole('button',{name:'Équipe et accès',exact:true}).click();
 await f.page.getByRole('group',{name:'Utilisateurs de l’équipe'}).getByRole('button',{name:/Lou|Martin/}).click();await snapshot(f,'settings-permissions-preparer',true);
 await f.page.getByRole('button',{name:/Nouvel utilisateur/}).click();await snapshot(f,'settings-user-create',true);
 await f.page.setViewportSize({width:390,height:844});
 for(const [url,name] of [['/clients','clients-mobile'],['/clients/new','client-create-mobile'],[`/clients/${ids.C}`,'client-summary-mobile'],['/devis','estimate-empty-mobile'],['/plus','more-mobile'],['/password','password-mobile']]){await f.page.goto(base+url);await snapshot(f,name,true);}
 await f.page.goto(base+'/settings');
 for(const [label,name] of [['Tarifs','settings-rates-mobile'],['Catégories','settings-categories-mobile'],['Équipe et accès','settings-users-mobile'],['Messages','settings-templates-mobile'],['Règles métier','settings-business-mobile']]){await f.page.getByRole('navigation',{name:'Paramètres',exact:true}).getByRole('button',{name:label,exact:true}).click();await snapshot(f,name,true);}
 }finally{await fs.writeFile(out+'/evidence.json',JSON.stringify({evidence,errors:f.errors,networkDenied:f.networkDenied,requests:f.requests},null,2));await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
