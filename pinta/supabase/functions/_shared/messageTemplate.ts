import { HttpError } from './http.ts';
export function renderMessage(body:string,client:any,colis:any,destination:any,settings:any,lines:any[]=[],invoices:any[]=[]) {
 const money=(n:unknown)=>typeof n==='number'||(typeof n==='string' && n!=='')?`${Number(n).toFixed(2)} €`:'À calculer';
 const divisor=Number(settings.volumetricDivisor ?? settings.diviseurVolumetrique ?? 5000);
 const dims=(l:any,w:any,h:any)=>l&&w&&h?`${l}×${w}×${h} cm`:'À mesurer';
 const volume=(l:any,w:any,h:any)=>l&&w&&h?`${(l*w*h/divisor).toFixed(2)} kg`:'À mesurer';
 const detail=colis.trackings_detail || [],trackings=(colis.trackings || []).filter(Boolean),original=colis.dims_par_colis || [];
 const count=Math.max(Number(colis.nb_colis)||0,detail.length,trackings.length,original.length,1);
 const known=new Set(detail.map((item:any)=>item.number).filter(Boolean)),remaining=trackings.filter((number:string)=>!known.has(number));
 const manifest=Array.from({length:count},(_,i)=>detail[i] || {number:remaining.shift()||'',fournisseur:''});
 const cartons=manifest.map((item:any,i:number)=>`${i+1}. ${[item.fournisseur||item.vendeur,item.number||item.tracking||item.numero||'Sans numéro de suivi'].filter(Boolean).join(' — ')}`).join('\n');
 const boxes=original.length?original:count===1?[{dimL:colis.dim_l,dimW:colis.dim_w,dimH:colis.dim_h,poids:colis.poids}]:[];
 const complete=boxes.length===count && divisor>0 && Number.isFinite(divisor) && boxes.every((box:any)=>box && ['dimL','dimW','dimH','poids'].every(key=>Number.isFinite(Number(box[key])) && Number(box[key])>0));
 const beforeReal=complete?boxes.reduce((sum:number,box:any)=>sum+Number(box.poids),0):null;
 const beforeVolume=complete?boxes.reduce((sum:number,box:any)=>sum+Number(box.dimL)*Number(box.dimW)*Number(box.dimH)/divisor,0):null;
 const receivedDimensions=complete?boxes.map((box:any,i:number)=>`${count>1?`Carton ${i+1} : `:''}${Number(box.dimL)}×${Number(box.dimW)}×${Number(box.dimH)} cm`).join('\n'):'À mesurer';
 const docs=invoices.filter((f)=>!f.rejet_motif);const documents=client.type==='pro'?'Aucun justificatif bloquant pour le transport professionnel':!docs.length?'Facture(s) d’achat à joindre':docs.some((f)=>!f.valide)?'Facture(s) en cours de vérification':'Justificatifs reçus et vérifiés';
 const vars:Record<string,unknown>={
  prenom:client.prenom||client.nom,nom_complet:[client.prenom,client.nom].filter(Boolean).join(' '),destination:destination?.nom||'',destination_flag:destination?.flag||'',
  ref:colis.ref,desc:colis.desc_contenu||'',casier:colis.casier||'',nb_cartons:count,liste_cartons:cartons,
  dims_brutes:receivedDimensions,poids_brut:beforeReal!==null?`${beforeReal} kg`:'À peser',poids_vol_avant:beforeVolume!==null?`${beforeVolume.toFixed(2)} kg`:'À mesurer',
  dims_finales:dims(colis.fin_l,colis.fin_w,colis.fin_h),poids_vol_apres:volume(colis.fin_l,colis.fin_w,colis.fin_h),poids_facturable:colis.poids_facturable?`${colis.poids_facturable} kg`:'À calculer',
  transport:money(colis.devis_transport),om:money(colis.devis_om),omr:money(colis.devis_omr),taxes:colis.devis_total?money(Number(colis.devis_om||0)+Number(colis.devis_omr||0)):'À calculer',tva:money(colis.devis_tva),taux_tva:client.type==='pro'?'0%':`${destination?.tva??0}%`,total:money(colis.devis_total),economie:money(colis.economie),
  frais_divers:(colis.frais_divers||[]).map((f:any)=>`${f.libelle||f.label||'Frais'} : ${money(f.montant)}`).join('\n'),
  contenu_declare:lines.map((l)=>`${l.description} × ${l.qte} — ${money(l.qte*l.prix_unitaire)}`).join('\n'),
  date_expedition:colis.date_expedition?new Date(colis.date_expedition).toLocaleDateString('fr-FR',{timeZone:'Europe/Paris'}):'Voir le suivi',motif_rejet:invoices.find((f)=>f.rejet_motif)?.rejet_motif||'Document à vérifier',
  documents_attendus:documents,lien_espace:`${(Deno.env.get('APP_URL')||'').replace(/\/$/,'')}/colis/${colis.id}`,lien_paiement:colis.payplug_payment_url||'Disponible dans votre espace après finalisation du devis',
 };
 return body.replace(/\{\{(\w+)\}\}/g,(_,key)=>{if(!(key in vars))throw new HttpError(422,`Variable de message inconnue : ${key}`);return String(vars[key]??'');});
}
