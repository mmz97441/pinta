import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { clientJourney } from '../src/expedile/domain/clientJourney.js';
const bundle = await build({entryPoints:[new URL('../supabase/functions/_shared/publicTracking.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent'});
const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports});
const facts = row => JSON.parse(JSON.stringify(module.exports.publicTrackingFacts(row)));

test('public tracking describes a valid quote without exposing its amount or snapshot',()=>{
 const result=facts({statut:'devis_envoye',devis_total:68.50,devis_brouillon:false,devis_snapshot:{inputs:{client:{email:'private@example.test'}}}});
 assert.equal(result.quoteNeedsReview,false);assert.equal(clientJourney({statut:'devis_envoye',...result}).quoteNeedsReview,false);
 assert.match(clientJourney({statut:'devis_envoye',...result}).label,/paiement/);
 for(const key of ['devisTotal','devis_total','devis_snapshot','payplug_payment_url'])assert.equal(key in result,false);
 assert.ok(!JSON.stringify(result).includes('private@example.test'));
});
test('public tracking identifies an actually withdrawn quote through a dedicated boolean',()=>{
 const result=facts({statut:'en_preparation',devis_envoye_le:'2026-09-01',devis_total:null,devis_brouillon:true});
 assert.equal(result.quoteNeedsReview,true);assert.match(clientJourney({statut:'en_preparation',...result}).label,/révision/);
});
test('public tracking preserves each received and outgoing physical unit without a fictitious aggregate box',()=>{
 const result=facts({nb_colis:3,dims_par_colis:[{dimL:40,dimW:10,dimH:10,poids:1},null,{dimL:10,dimW:40,dimH:10,poids:2}],final_packages:[{dimL:30,dimW:20,dimH:10,poids:1},{dimL:10,dimW:40,dimH:10,poids:2}],outgoing_parcel_count:2,preparation_composition_version:1,final_measurements_version:1,fin_l:30,fin_w:40,fin_h:10,fin_p:3});
 assert.equal(result.receivedCount,3);assert.equal(result.receptionCartons[1],null);assert.equal(result.receptionCartons[2].P,2);assert.equal(result.preparedPackages.length,2);assert.equal(result.preparedPackages[0].W,20);assert.equal('dims' in result,false);
});
test('public tracking suppresses stale final measures and never splits legacy maxima across unknown cartons',()=>{
 const result=facts({nb_colis:2,dim_l:80,dim_w:70,dim_h:60,poids:25,final_packages:[{dimL:40,dimW:30,dimH:20,poids:3}],outgoing_parcel_count:null,preparation_composition_version:2,final_measurements_version:1});
 assert.equal(result.preparationNeedsReview,true);assert.deepEqual(result.preparedPackages,[]);assert.deepEqual(result.receptionCartons,[null,null]);assert.equal(result.outgoingParcelCount,null);
});
