import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildProRecapWorkbook, proRecapDossier, clientPaymentLabel } from '../src/expedile/utils/exportRecapPro.js';
const client = { id: 'c', nom: 'Exemple Camille', prenom: 'Camille', cp:'97400', modePaiement:'30j' };
const box = poids => ({dimL:20,dimW:20,dimH:20,poids});
const parcel = { id:'p', ref:'EXP-QA', clientId:'c', statut:'paye', paiementDate:'2026-09-17T12:00:00Z', dateReception:'2026-09-15', finP:3, finalPackages:[box(3),box(4)], devisTotal:17.77, devisTransport:10.01,devisOM:5.01,devisOMR:0,devisTVA:2.75, lignes:[{desc:'Original',qte:1,prix:10,factureId:'one'},{desc:'Duplicate',qte:1,prix:14.3,factureId:'copy'},{desc:'Replaced',qte:1,prix:9,factureId:'old'}],factures:[{id:'one',replacesFactureId:'old'},{id:'old'},{id:'copy',duplicateOfId:'one'}] };
test('pro export includes active articles only, grouped prepared weight and exact payment terms',()=>{
 const data=proRecapDossier(parcel);assert.equal(data.billableWeight,7);assert.equal(data.packageCount,2);assert.deepEqual(data.lines.map(l=>l.desc),['Original']);
 const result=buildProRecapWorkbook(client,[parcel],8,2026);assert.equal(result.count,1);
 const recap=XLSX.utils.sheet_to_json(result.workbook.Sheets['Récap colis']);assert.equal(recap[0]['Poids fact. (kg)'],7);
 const articles=XLSX.utils.sheet_to_json(result.workbook.Sheets['Coût de revient']);assert.equal(articles.length,1);assert.equal(articles[0]['Transport prorata (€)'],10.01);assert.equal(articles[0]['COÛT DE REVIENT (€)'],27.77);
 const summary=XLSX.utils.sheet_to_json(result.workbook.Sheets['Résumé facturation']);assert.equal(summary.find(r=>r.Champ==='Client').Valeur,'Exemple Camille');assert.equal(summary.find(r=>r.Champ==='Méthode de paiement').Valeur,'Paiement à 30 jours');
});
test('saved quote remains authoritative for weight, amounts and article allocation totals',()=>{
 const snapshot={inputs:{finalPackages:[box(2),box(5)],lines:[{description:'A',quantity:1,unitPrice:1},{description:'B',quantity:1,unitPrice:1},{description:'C',quantity:1,unitPrice:1}],volumetricDivisor:5000,fees:[]},amounts:{transport:10,om:0,omr:0,tva:0,total:10,billableWeight:7}};
 const result=buildProRecapWorkbook(client,[{...parcel,poidsFact:999,devisTotal:999,devisSnapshot:snapshot}],8,2026);
 const recap=XLSX.utils.sheet_to_json(result.workbook.Sheets['Récap colis']);assert.equal(recap[0]['Poids fact. (kg)'],7);assert.equal(recap[0]['Total TTC (€)'],10);
 const articles=XLSX.utils.sheet_to_json(result.workbook.Sheets['Coût de revient']);assert.equal(articles.reduce((sum,l)=>sum+Math.round(l['Transport prorata (€)']*100),0),1000);
});
test('billing period excludes unpaid, other clients and other months',()=>{assert.equal(buildProRecapWorkbook(client,[{...parcel,statut:'devis_envoye'}],8,2026),null);assert.equal(buildProRecapWorkbook(client,[parcel],7,2026),null);assert.equal(clientPaymentLabel({methodePaiement:'30_jours'}),'Paiement à 30 jours');assert.equal(clientPaymentLabel({modePaiement:'fin_mois'}),'Paiement en fin de mois');});
