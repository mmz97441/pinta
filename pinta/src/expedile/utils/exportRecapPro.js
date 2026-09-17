import * as XLSX from 'xlsx';
import { getDestByCP } from '../constants/index.js';
import { excludedInvoiceIds } from '../domain/invoiceDocuments.js';
import { measureShipment, roundMoney } from '../domain/quote.js';
import { quotePresentation } from '../domain/clientJourney.js';

export const CLIENT_PAYMENT_LABELS = { colis: 'À chaque expédition', compte: 'Paiement en compte', '30j': 'Paiement à 30 jours', '30_jours': 'Paiement à 30 jours', fin_mois: 'Paiement en fin de mois', fin_de_mois: 'Paiement en fin de mois', virement: 'Virement bancaire', especes: 'Espèces' };
export const clientPaymentLabel = client => CLIENT_PAYMENT_LABELS[client.modePaiement || client.methodePaiement] || 'Modalité à préciser';
export function monthlyProDossiers(client, dossiers, month, year) {
  return dossiers.filter(dossier => {
    const date = new Date(dossier.paiementDate || dossier.dateReception);
    return dossier.clientId === client.id && ['paye','expedie','transit','dedouanement','arrive','livraison','livre'].includes(dossier.statut) && date.getMonth() === month && date.getFullYear() === year;
  });
}
// The same saved quote presentation as the client and PDF. Legacy multi-package
// weights are recomputed only when no saved billable weight exists.
export function proRecapDossier(dossier) {
  const snapshot = dossier.devisSnapshot || dossier.quoteSnapshot;
  const saved = quotePresentation(dossier).colis;
  const boxes = saved.finalPackages?.length ? saved.finalPackages : [{ dimL:saved.finL,dimW:saved.finW,dimH:saved.finH,poids:saved.finP }];
  const excluded = excludedInvoiceIds(dossier.factures);
  const lines = snapshot?.inputs?.lines?.length ? snapshot.inputs.lines.map(line => ({ desc:line.description,qte:line.quantity,prix:line.unitPrice }))
    : (dossier.lignes || []).filter(line => !excluded.has(line.factureId || line.facture_id));
  const weight = Number(saved.poidsFact) > 0 ? Number(saved.poidsFact) : measureShipment(boxes, snapshot?.inputs?.volumetricDivisor || 5000)?.billableWeight;
  return { ...saved, lines, packageCount:boxes.every(box => Number(box.poids)>0) ? boxes.length : null, billableWeight:weight ?? null, fees:(saved.fraisDivers || []).reduce((sum,fee)=>sum+Number(fee.montant||0),0) };
}
function allocate(amount, lines) {
  const total = lines.reduce((sum,line)=>sum+Number(line.qte||0)*Number(line.prix||0),0);
  let allocated=0;
  return lines.map((line,index)=>{
    const cents = index===lines.length-1 ? Math.round(Number(amount||0)*100)-allocated : total>0 ? Math.round(Number(amount||0)*100*Number(line.qte||0)*Number(line.prix||0)/total) : 0;
    allocated+=cents; return cents/100;
  });
}
export function buildProRecapWorkbook(client,dossiers,month,year) {
  const filtered=monthlyProDossiers(client,dossiers,month,year).map(proRecapDossier);
  if(!filtered.length) return null;
  const money = value => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(value||0));
  const fields=[['Transport (€)','devisTransport'],['OM (€)','devisOM'],['OMR (€)','devisOMR'],['TVA (€)','devisTVA'],['Frais divers (€)','fees'],['Total TTC (€)','devisTotal']];
  const recap=filtered.map(c=>({ 'Référence':c.ref,'Description':c.desc||'','Date réception':c.dateReception?new Date(c.dateReception).toLocaleDateString('fr-FR'):'','Date paiement':c.paiementDate?new Date(c.paiementDate).toLocaleDateString('fr-FR'):'','Colis préparés':c.packageCount??'Non renseigné','Poids fact. (kg)':c.billableWeight==null?'Non renseigné':roundMoney(c.billableWeight),...Object.fromEntries(fields.map(([label,key])=>[label,Number(c[key]||0)])) }));
  const totals={'Référence':'TOTAL','Description':`${filtered.length} expédition(s)`,...Object.fromEntries(fields.map(([label,key])=>[label,roundMoney(filtered.reduce((sum,c)=>sum+Number(c[key]||0),0))]))};
  const articles=filtered.flatMap(c=>{
    const parts={transport:allocate(c.devisTransport,c.lines),taxes:allocate(Number(c.devisOM||0)+Number(c.devisOMR||0),c.lines),tva:allocate(c.devisTVA,c.lines),fees:allocate(c.fees,c.lines)};
    return c.lines.map((line,i)=>({'Réf. expédition':c.ref,'Article':line.desc,'Qté':line.qte,'Prix achat unitaire (€)':Number(line.prix),'Prix achat total (€)':roundMoney(Number(line.qte)*Number(line.prix)),'Transport prorata (€)':parts.transport[i],'Taxes prorata (€)':parts.taxes[i],'TVA prorata (€)':parts.tva[i],'Frais prorata (€)':parts.fees[i],'COÛT DE REVIENT (€)':roundMoney(Number(line.qte)*Number(line.prix)+parts.transport[i]+parts.taxes[i]+parts.tva[i]+parts.fees[i])}));
  });
  const dest=getDestByCP(client.cp);
  const period=new Date(year,month,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
  const summary=[['Client',client.nomFamille ? [client.prenom,client.nomFamille].filter(Boolean).join(' ') : client.nom],['Destination',dest.nom],['Période',period],['Règle de période','Date de paiement ; date de réception si aucun paiement daté'],['Nombre d’expéditions',filtered.length],['Méthode de paiement',clientPaymentLabel(client)],...fields.map(([label])=>[label,money(totals[label])])].map(([Champ,Valeur])=>({Champ,Valeur}));
  const workbook=XLSX.utils.book_new();
  for(const [name,rows] of [['Récap colis',[...recap,{},totals]],['Coût de revient',articles],['Résumé facturation',summary]]){
    if(!rows.length)continue;
    const sheet=XLSX.utils.json_to_sheet(rows);sheet['!cols']=Object.keys(rows[0]).map(key=>({wch:Math.max(key.length,18)+2}));XLSX.utils.book_append_sheet(workbook,sheet,name);
  }
  return {workbook,count:filtered.length};
}
export function exportRecapProExcel(client,dossiers,month,year) {
  const result=buildProRecapWorkbook(client,dossiers,month,year);if(!result)return 0;
  XLSX.writeFile(result.workbook,`recap-pro-${(client.nomFamille||client.nom||'client').replace(/[^a-zA-Z0-9]/g,'_')}-${year}-${String(month+1).padStart(2,'0')}.xlsx`);
  return result.count;
}
