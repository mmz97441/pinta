/* Operations audit O01–O21: fictitious providers intercepted by shared fixtures. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setup, base, ids } = require('./browser-regression.cjs');
const { fixture, B } = require('./invoice-workspace.cjs');
const output = process.env.PINTA_OPERATIONS_OUT || '/tmp/pinta-operations-simplicity';
const region = f => f.page.getByTestId('dossier-task-workspace');
const mutations = f => f.requests.filter(request => /\/(save_quote|confirm_quote|queue_message|save_invoice_review|save_preparation_measurements|transition_colis|revert_colis|assign_colis_departure|mark_manual_payment)$/.test(request.path));
const noNotification = f => assert.equal(f.requests.some(request => /\/(queue_message|send-telegram|send-email)$/.test(request.path)), false);
const box = { dimL: 40, dimW: 30, dimH: 20, poids: 3 };
async function open(f, task) { await f.page.goto(`${base}/colis/${ids.P}?section=${task}&returnTo=%2F%3Fmission%3Ddocuments`); await region(f).waitFor(); }
async function measure(dialog, number) { for (const [label, unit, value] of [['Longueur','cm','20'],['Largeur','cm','30'],['Hauteur','cm','40'],['Poids','kg','2']]) await dialog.getByLabel(`${label} à réception (${unit}) · carton ${number}`, { exact: true }).fill(value); }
async function audit(f, name, include = '[data-testid="dossier-task-workspace"]') {
 const result = await new AxeBuilder({ page: f.page }).include(include).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 assert.deepEqual(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
 assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
 await f.page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
(async () => {
 await fs.mkdir(output, { recursive: true }); const browser = await chromium.launch({ headless: true }); const results = [];
 async function scenario(name, action, options = {}) {
  if (process.env.PINTA_OPERATIONS_FILTER && !name.includes(process.env.PINTA_OPERATIONS_FILTER)) return;
  const f = options.invoice ? await fixture(browser, { category:'cat-test', ...options.invoice }) : await setup(browser, options.role || 'directeur');
  f.page.setDefaultTimeout(10000); const invalidDom=[]; f.page.on('console',message=>{if(/validateDOMNesting/.test(message.text())) invalidDom.push(message.text());});
  try { await f.login(); await action(f); assert.deepEqual(invalidDom, []); assert.deepEqual(f.errors, []); assert.deepEqual(f.networkDenied, []); results.push({ test: name, pass:true }); }
  catch(error) { process.exitCode=1; results.push({ test:name, pass:false, error:error.stack }); await f.page.screenshot({path:`${output}/${name}-failure.png`,fullPage:true}).catch(()=>{}); await fs.writeFile(`${output}/${name}-failure.txt`,await f.page.locator('body').innerText().catch(()=>'')); }
  finally { await f.context.close(); }
 }
 try {
  for (const mobile of [false,true]) await scenario(`receipt-measures-first-and-reference-${mobile?'mobile':'desktop'}`, async f => {
   await f.page.setViewportSize(mobile ? {width:390,height:844} : {width:1440,height:1000});
   Object.assign(f.tables.colis[0],{ statut:'autorise', nb_colis:2, dims_par_colis:[box,box] });
   await f.page.goto(`${base}/?mission=reception`);
   await f.page.getByRole('button',{name:'Réceptionner des cartons',exact:true}).filter({visible:true}).first().click();
   const dialog=f.page.getByRole('dialog',{name:'Réceptionner des cartons',exact:true});
   await dialog.getByPlaceholder('Rechercher un client…').fill('Camille');
   await dialog.getByRole('button').filter({hasText:/Exemple/}).first().click();
   await dialog.getByRole('button').filter({hasText:'EXP-TEST-001'}).click();
   await dialog.getByRole('heading',{name:'Carton 3',exact:true}).waitFor();
   assert.match(await dialog.innerText(),/0 \/ 1 carton/);
   assert.equal(await dialog.getByLabel('Numéro de suivi · carton 3',{exact:true}).isVisible(),false);
   assert.equal(await dialog.locator('#reception-casier-existing').isVisible(),false);
   const save=dialog.getByRole('button',{name:'Enregistrer le carton dans EXP-TEST-001',exact:true});
   await save.click(); await dialog.getByRole('alert').filter({hasText:/longueur à réception/}).waitFor();
   assert.equal(f.tables.colis.length,1);
   await measure(dialog,3); assert.match(await dialog.innerText(),/1 \/ 1 carton/);
   await audit(f,`receipt-${mobile?'mobile':'desktop'}`,'[role="dialog"]');
   await save.click(); await dialog.waitFor({state:'hidden'});
   await f.page.waitForURL(url=>url.searchParams.get('section')==='accord');
   assert.equal(f.tables.colis.length,1); assert.equal(f.tables.colis[0].ref,'EXP-TEST-001'); assert.equal(f.tables.colis[0].nb_colis,3);
   assert.deepEqual(f.tables.colis[0].dims_par_colis.slice(0,2),[box,box]);
   assert.deepEqual(f.tables.colis[0].dims_par_colis[2],{dimL:20,dimW:30,dimH:40,poids:2});
   noNotification(f);
  });
  await scenario('receipt-photo-incident-and-scanner-controls-remain-reachable',async f=>{
   await f.page.goto(base); await f.page.getByRole('button',{name:'Réceptionner des cartons',exact:true}).filter({visible:true}).first().click();
   const dialog=f.page.getByRole('dialog',{name:'Réceptionner des cartons',exact:true});await dialog.getByPlaceholder('Rechercher un client…').fill('Camille');await dialog.getByRole('button').filter({hasText:/Exemple/}).first().click();
   await dialog.getByRole('button',{name:'+ Ajouter un carton',exact:true}).click();
   const first=dialog.getByRole('region',{name:'Carton 1',exact:true}),second=dialog.getByRole('region',{name:'Carton 2',exact:true});
   await second.locator('summary').filter({hasText:'Fournisseur et suivi'}).click(); await first.locator('summary').filter({hasText:'Fournisseur et suivi'}).click();
   await first.getByLabel('Numéro de suivi · carton 1',{exact:true}).fill('SCAN-FIRST');await first.getByLabel('Numéro de suivi · carton 1',{exact:true}).press('Enter');
   assert.equal(await second.getByLabel('Numéro de suivi · carton 2',{exact:true}).evaluate(node=>node===document.activeElement),true);
   await dialog.locator('summary').filter({hasText:'Compléments de réception'}).click();
   const camera=dialog.locator('input[type="file"][capture="environment"]'),file=dialog.getByLabel('Choisir une photo de réception',{exact:true});assert.equal(await camera.count(),1);assert.equal(await file.getAttribute('capture'),null);
   await file.setInputFiles({name:'reception-test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6f0kAAAAASUVORK5CYII=','base64')});
   await dialog.getByRole('img',{name:'Photo réception',exact:true}).waitFor();await dialog.getByText('Remplacer la photo',{exact:true}).waitFor();
   await dialog.locator('button[aria-pressed]').first().click(); await dialog.locator('summary').filter({hasText:'Compléments de réception'}).click();
   await dialog.getByRole('alert').filter({hasText:'Incident à vérifier'}).waitFor();noNotification(f);assert.equal(f.tables.colis.length,1);
  });
  await scenario('received-and-prepared-multiple-parcels-have-exact-totals',async f=>{
   Object.assign(f.tables.colis[0],{dims_par_colis:[box,box],nb_colis:2,final_packages:[box,{...box,poids:5}],fin_p:3});
   await open(f,'preparation');
   await f.page.getByRole('button',{name:/^Détails/}).click();
   const panel=f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true});
   await panel.getByText('Poids total préparé : 8.00 kg',{exact:true}).waitFor();
   assert.match(await panel.innerText(),/2 colis préparés/); assert.match(await panel.innerText(),/Casier.*6.00 kg reçus/);
   assert.equal(await panel.getByRole('button',{name:'Inviter sur Telegram',exact:true}).count(),0);
   assert.equal(await panel.getByText('Comprendre le poids facturable',{exact:true}).locator('..').evaluate(node=>node.open),false);
   await audit(f,'multi-parcels-context','[data-testid="dossier-context"]'); assert.deepEqual(mutations(f),[]);
  });
  await scenario('receipt-completion-closes-context-and-stale-preparation-is-labelled',async f=>{
   Object.assign(f.tables.colis[0],{statut:'receptionne',final_packages:[box,{...box,poids:5}],preparation_composition_version:2,final_measurements_version:1,dims_par_colis:[]});
   await open(f,'accord');await f.page.getByRole('button',{name:/^Détails/}).click();const context=f.page.getByRole('dialog',{name:'Contexte du dossier',exact:true});
   await context.getByRole('status').filter({hasText:'Mesures précédentes à revoir'}).waitFor();assert.match(await context.innerText(),/Poids des mesures précédentes : 8.00 kg/);assert.equal(await context.getByText('Poids total préparé : 8.00 kg',{exact:true}).count(),0);
   await context.getByRole('button',{name:'Compléter les mesures à réception',exact:true}).click();await context.waitFor({state:'hidden'});
   await region(f).getByRole('button',{name:'Enregistrer les mesures de réception',exact:true}).waitFor();assert.equal(new URL(f.page.url()).searchParams.get('section'),'reception');assert.deepEqual(mutations(f),[]);
  });
  await scenario('correction-describes-real-quote-invalidation-without-navigation-mutation',async f=>{
   Object.assign(f.tables.colis[0],{devis_total:70,devis_snapshot:{amounts:{total:70}}});
   await open(f,'devis');
   await f.page.getByRole('button',{name:'Revenir aux factures',exact:true}).click();
   await f.page.getByLabel('Tâche du dossier',{exact:true}).selectOption('devis');
   assert.deepEqual(mutations(f),[]);
   await region(f).getByRole('button',{name:'Corrections',exact:true}).click();
   await region(f).getByRole('button',{name:/^Corriger l’étape vers/}).click();
   const confirmation=f.page.getByRole('dialog').filter({hasText:/Le total et la version enregistrée du devis seront effacés/});
   await confirmation.waitFor(); assert.match(await confirmation.innerText(),/cartons, mesures et factures sont conservés/);
   await confirmation.getByRole('button',{name:'Annuler',exact:true}).click();
   assert.equal(f.tables.colis[0].statut,'en_preparation'); assert.deepEqual(mutations(f),[]);
   await region(f).getByRole('button',{name:'Archiver',exact:true}).click();
   await f.page.getByRole('dialog').filter({hasText:/masqué des listes courantes/}).getByRole('button',{name:'Annuler',exact:true}).click();
   assert.equal(!!f.tables.colis[0].archive,false);
  });
  await scenario('archive-and-cancel-permissions-remain-distinct',async f=>{
   const permission={id:'restricted-permission',staff_id:ids.S,perm_colis_annuler:true};f.tables.staff_permissions=[permission];f.tables.staff_users[0].staff_permissions=permission;
   await open(f,'preparation');await region(f).getByRole('button',{name:'Corrections',exact:true}).click();
   assert.equal(await region(f).getByRole('button',{name:'Annuler l’expédition…',exact:true}).isVisible(),true);
   assert.equal(await region(f).getByRole('button',{name:'Archiver',exact:true}).count(),0);assert.equal(await region(f).getByRole('button',{name:/Corriger l’étape vers/}).count(),0);assert.deepEqual(mutations(f),[]);
  },{role:'preparateur'});
  await scenario('preparation-comment-draft-survives-leaving-task-without-saving',async f=>{
   await open(f,'preparation'); await region(f).locator('summary').filter({hasText:'Consignes facultatives'}).click();
   await region(f).getByLabel('Commentaire de préparation',{exact:true}).fill('Ne pas plier cet achat fragile');
   await f.page.getByRole('button',{name:'Retour à la liste de travail',exact:true}).click(); await f.page.waitForURL(url=>url.pathname==='/');
   await f.page.goBack(); await region(f).waitFor(); await region(f).locator('summary').filter({hasText:'Consignes facultatives'}).click();
   assert.equal(await region(f).getByLabel('Commentaire de préparation',{exact:true}).inputValue(),'Ne pas plier cet achat fragile');
   assert.notEqual(f.tables.colis[0].commentaire_preparation,'Ne pas plier cet achat fragile'); assert.deepEqual(mutations(f),[]);
  });
  await scenario('customer-requested-wait-is-distinct-from-no-answer',async f=>{
   Object.assign(f.tables.colis[0],{statut:'attente_feu_vert',feu_vert:'en_attente',attente_client_date:'2026-09-16T09:00:00Z',attente_client_motif:'Un achat supplémentaire arrive',demande_feu_vert_envoyee_at:'2026-09-15T09:00:00Z'});
   await open(f,'accord'); assert.match(await region(f).innerText(),/souhaite attendre d’autres cartons/); assert.match(await region(f).innerText(),/Dernière demande/); assert.match(await region(f).innerText(),/Un achat supplémentaire arrive/);
   assert.equal(await region(f).getByRole('button',{name:'Préparer une relance',exact:true}).count(),0); noNotification(f);
  });
  await scenario('manual-request-preview-shows-recipient-and-email-draft',async f=>{
   Object.assign(f.tables.colis[0],{statut:'mesure',dims_par_colis:[box,box]});
   await open(f,'accord'); await region(f).getByRole('button',{name:'Préparer la demande au client',exact:true}).click();
   await region(f).getByLabel('Canal de notification',{exact:true}).selectOption('email');
   assert.match(await region(f).innerText(),/Destinataire :/); assert.match(await region(f).innerText(),/ouvre un brouillon/);
   assert.equal(await region(f).getByRole('button',{name:'Ouvrir le brouillon email',exact:true}).isEnabled(),true);
   noNotification(f); assert.deepEqual(mutations(f),[]);
  });
  await scenario('quote-summary-distinguishes-estimate-and-saved-draft',async f=>{
   await open(f,'devis'); const summary=region(f).getByLabel('Résumé du devis',{exact:true});
   await summary.waitFor(); assert.match(await summary.innerText(),/Estimation · prête à vérifier/);
   const taxes=region(f).locator('details').filter({has:f.page.locator('summary').filter({hasText:'Détail des taxes'})});
   assert.equal(await taxes.evaluate(node=>node.open),false);
   await region(f).getByRole('button',{name:'Enregistrer et vérifier le devis',exact:true}).click();
   await summary.getByText('Brouillon enregistré',{exact:true}).waitFor();
   await region(f).getByRole('button',{name:'Envoyer le devis au client',exact:true}).waitFor();
   assert.match(await region(f).getByTestId('quote-action-bar').innerText(),/Camille|Exemple/); noNotification(f);
   await audit(f,'quote-summary');
  });
  await scenario('payment-link-is-readable-and-professional-confirmation-is-explicit',async f=>{
   Object.assign(f.tables.colis[0],{statut:'devis_envoye',devis_total:70,devis_envoye_le:'2026-09-16T09:00:00Z',payplug_payment_url:'https://payment.invalid/fictitious'});
   await open(f,'paiement');
   assert.equal(await region(f).getByRole('link',{name:'Ouvrir le lien de paiement',exact:true}).getAttribute('href'),'https://payment.invalid/fictitious');
   assert.equal(await region(f).getByText('https://payment.invalid/fictitious',{exact:true}).count(),0);
   assert.match(await region(f).innerText(),/Devis envoyé le/);
   f.tables.clients[0].type='pro'; f.tables.colis[0].mode_paiement_pro='virement'; await open(f,'paiement');
   await region(f).getByRole('button',{name:'Confirmer réception du paiement',exact:true}).click();
   const dialog=f.page.getByRole('dialog').filter({hasText:'Confirmer le règlement reçu ?'}); await dialog.waitFor();
   assert.match(await dialog.innerText(),/70[.,]00/); assert.match(await dialog.innerText(),/Virement bancaire/);
   await dialog.getByRole('button',{name:'Annuler',exact:true}).click(); assert.equal(f.tables.colis[0].statut,'devis_envoye'); noNotification(f);
  });
  await scenario('departure-immediate-save-failure-keeps-persisted-assignment',async f=>{
   const paid=f.tables.colis[0]; Object.assign(paid,{statut:'paye',paiement_date:'2026-09-16T09:00:00Z',paiement_montant:70,devis_total:70,devis_brouillon:false,devis_snapshot:{inputs:{destination:{code:'974'}}},envoi_id:'old'});
   f.tables.envois=[{id:'old',date_depart:'2099-09-12',statut:'planifie',destination_code:'974'},{id:'next',date_depart:'2099-09-19',statut:'planifie',destination_code:'974',loading_closes_at:'2099-09-18T12:00:00Z'},{id:'wrong',date_depart:'2099-09-19',statut:'planifie',destination_code:'976'}];
   let fail=true; const calls=[];
   await f.context.route('**/rest/v1/rpc/assign_colis_departure',async route=>{const input=route.request().postDataJSON();calls.push(input);if(fail){fail=false;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001',message:'Départ modifié par un collègue. Réessayez après vérification.'})});} paid.envoi_id=input.p_envoi_id;paid.updated_at='2026-09-17T12:00:00Z';return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(paid)});});
   await open(f,'expedition'); const select=region(f).getByLabel('Départ de cette expédition',{exact:true});
   assert.deepEqual(await select.locator('option').evaluateAll(rows=>rows.map(row=>row.value)),['','old','next']);
   assert.equal(await select.locator(':scope > :not(option)').count(),0);
   assert.match(await region(f).innerText(),/s’enregistre immédiatement/);await select.selectOption('next');
   await region(f).getByRole('alert').filter({hasText:'Départ modifié par un collègue'}).waitFor();
   assert.equal(await select.inputValue(),'old'); assert.equal(paid.envoi_id,'old');
   await select.selectOption('next');await region(f).getByRole('status').filter({hasText:'Départ enregistré.'}).waitFor();
   assert.equal(paid.envoi_id,'next');assert.equal(calls.length,2);assert.ok(calls[1].p_expected_updated_at);noNotification(f);
  });
  await scenario('delivery-before-arrival-shows-transport-link-and-no-transition',async f=>{
   Object.assign(f.tables.colis[0],{statut:'transit'}); await open(f,'livraison');
   await region(f).getByRole('heading',{name:'Livraison non commencée',exact:true}).waitFor();
   assert.equal(await region(f).getByRole('button',{name:'Passer en dédouanement',exact:true}).count(),0);
   await region(f).getByRole('button',{name:'Voir le transport',exact:true}).click();
   await region(f).getByRole('button',{name:'Passer en dédouanement',exact:true}).waitFor();
   assert.equal(await region(f).getByRole('button',{name:'Arrivé directement (sans dédouanement)',exact:true}).isVisible(),false); assert.deepEqual(mutations(f),[]);
  });
  await scenario('delivery-confirmation-covers-entire-expedition-without-notification',async f=>{
   Object.assign(f.tables.colis[0],{statut:'livraison',final_packages:[box,{...box,poids:5}]}); await open(f,'livraison');
   await region(f).getByRole('button',{name:'Confirmer la livraison',exact:true}).click();
   const dialog=f.page.getByRole('dialog').filter({hasText:/tous les colis préparés/}); await dialog.waitFor();
   assert.equal(f.tables.colis[0].statut,'livraison');
   await dialog.getByRole('button',{name:'Confirmer la livraison',exact:true}).click();
   await region(f).getByRole('heading',{name:'Livraison terminée',exact:true}).waitFor(); assert.equal(f.tables.colis[0].statut,'livre'); noNotification(f);
  });
  for(const mobile of [false,true]) await scenario(`long-invoice-focus-and-draft-${mobile?'mobile':'desktop'}`,async f=>{
   await f.page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});
   if(mobile) await f.page.evaluate(()=>localStorage.setItem('expedile-theme','dark'));
   const record=f.records.get(B); record.extraction.lines=Array.from({length:20},(_,i)=>({desc:`Article fictif ${i+1}`,qte:1,prix:1,cat:i===18?null:'cat-test'}));record.extraction.total=20;
   await open(f,'documents'); await f.page.getByLabel('Aller à un article',{exact:true}).waitFor();
   assert.equal(await f.page.getByRole('button',{name:'Retirer cette facture en double',exact:true}).isVisible(),false);
   assert.equal(await f.page.getByLabel('Description de l’article 2',{exact:true}).isVisible(),false);
   assert.equal(await f.page.getByLabel('Catégorie de l’article 19',{exact:true}).isVisible(),true);
   await f.page.getByLabel('Aller à un article',{exact:true}).selectOption('19');
   await f.page.getByLabel('Description de l’article 20',{exact:true}).fill('Article revu conservé');
   if(mobile){await f.page.getByRole('tab',{name:'Voir la facture',exact:true}).click();await f.page.getByRole('tab',{name:'Vérifier les articles',exact:true}).click();}
   assert.equal(await f.page.getByLabel('Description de l’article 20',{exact:true}).inputValue(),'Article revu conservé');
   await f.page.getByLabel('Catégorie de l’article 19',{exact:true}).selectOption('cat-test');
   await f.page.getByRole('button',{name:'Enregistrer le brouillon',exact:true}).click();
   await f.page.getByTestId('invoice-header-feedback').filter({hasText:/Brouillon/}).waitFor();
   assert.equal(f.calls.filter(call=>call.kind==='save').length,1); assert.equal(f.calls.find(call=>call.kind==='save').input.p_confirm,false);
   assert.equal(f.tables.factures.find(invoice=>invoice.id===B).valide,false);
   await audit(f,`long-invoice-${mobile?'mobile':'desktop'}`,'#quote-documents'); noNotification(f);
   await f.page.locator('#quote-documents').evaluate(node=>node.scrollIntoView({block:'start'})); await f.page.screenshot({path:`${output}/invoice-top-${mobile?'mobile-dark':'desktop-light'}.png`});
  },{invoice:{}});
  await scenario('invoice-correction-saves-once-and-manual-message-can-retry',async f=>{
   f.tables.clients[0].user_id=ids.C;const queue=[];let fail=true;
   await f.context.route('**/rest/v1/rpc/queue_message',async route=>{const input=route.request().postDataJSON();queue.push(input);if(fail){fail=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Transmission interrompue pour cet essai'})});}const message={id:'correction-message',colis_id:ids.P,type:'staff',canal:input.p_canal,texte:input.p_text,created_at:new Date().toISOString()};f.tables.messages.push(message);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({message,outbox:{id:'fictitious'}})});});
   await open(f,'documents');await region(f).getByRole('button',{name:'Demander une correction au client',exact:true}).click();
   await f.page.getByLabel('Motif de correction',{exact:true}).fill('Il manque la deuxième page');await f.page.getByRole('button',{name:'Enregistrer la correction',exact:true}).click();
   const prepare=f.page.getByRole('button',{name:'Préparer la demande de correction',exact:true});await prepare.waitFor();assert.equal(queue.length,0);assert.equal(f.tables.factures.find(invoice=>invoice.id===B).rejet_motif,'Il manque la deuxième page');
   await prepare.click();const message=region(f).getByRole('region',{name:'Vérification de la facture',exact:true}).getByRole('region',{name:'Notification au client',exact:true});
   await message.getByLabel('Canal de notification',{exact:true}).selectOption('portal');const text=await message.getByLabel('Message à envoyer au client',{exact:true}).inputValue();assert.match(text,/Il manque la deuxième page/);assert.match(text,/EXP-TEST-001/);assert.match(text,/scelleuse.pdf/);
   await message.getByRole('button',{name:'Envoyer ce message',exact:true}).click();await message.getByRole('alert').filter({hasText:'Transmission interrompue'}).waitFor();
   await message.getByRole('button',{name:'Réessayer cet envoi',exact:true}).click();await message.getByRole('status').filter({hasText:'Message disponible dans l’espace client.'}).waitFor();
   assert.equal(queue.length,2);assert.deepEqual(queue[1],queue[0]);assert.equal(f.mutations.filter(item=>item.path.endsWith('/factures')&&item.method==='PATCH').length,1);assert.equal(f.tables.messages.length,1);
  },{invoice:{}});
  await scenario('invoice-atomic-validation-auto-next-keeps-manual-purchase',async f=>{
   await open(f,'documents'); const manual=f.tables.lignes.filter(line=>!line.facture_id); assert.equal(manual.length,1);
   await f.page.getByRole('button',{name:'Valider et passer à la suivante',exact:true}).click();
   await f.page.waitForFunction(id=>document.querySelector('select[aria-label="Facture à vérifier"]')?.value!==id,B);
   assert.equal(f.calls.filter(call=>call.kind==='save').length,1); assert.equal(f.tables.lignes.filter(line=>line.facture_id===B).length,1);
   assert.deepEqual(f.tables.lignes.filter(line=>!line.facture_id),manual);
   await region(f).getByText('Achats supplémentaires sans facture reliée',{exact:true}).waitFor(); noNotification(f);
  },{invoice:{unlinked:true}});
 } finally { await browser.close(); await fs.writeFile(`${output}/results.json`,JSON.stringify(results,null,2)); console.log(JSON.stringify(results,null,2)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
