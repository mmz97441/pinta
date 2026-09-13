import { admin, fail, HttpError, json, postOnly, requireStaff, throwDb, uuid } from '../_shared/http.ts';
import { saveIncoming } from '../_shared/telegramIncoming.ts';
Deno.serve(async (req:Request)=>{
 const early=postOnly(req);if(early)return early;
 try{
  const db=admin();await requireStaff(req,'perm_comm_telegram',db);
  const {inboxId,colisId}=await req.json();if(!uuid(inboxId)||!uuid(colisId))throw new HttpError(400,'Message et dossier requis');
  const inbox=await db.from('client_inbox').select('*').eq('id',inboxId).single();throwDb(inbox);
  if(inbox.data.status==='assigned')return json({success:true,colisId:inbox.data.colis_id,reused:true});
  const colis=await db.from('colis').select('id,ref,client_id').eq('id',colisId).eq('client_id',inbox.data.client_id).single();throwDb(colis);
  const client=await db.from('clients').select('id,nom,prenom').eq('id',inbox.data.client_id).single();throwDb(client);
  const claim=await db.rpc('claim_inbox_assignment',{p_inbox_id:inboxId,p_colis_id:colisId});throwDb(claim);
  if(claim.data.status!=='assigned'){
   try{await saveIncoming(db,client.data,colis.data,inbox.data.payload,inbox.data.telegram_update_id);}
   catch(error){
    if(error instanceof HttpError&&error.status===400){
     throwDb(await db.from('client_inbox').update({status:'unassigned',payload:{...inbox.data.payload,intake_error:error.message},texte:`${colis.data.ref} — ${error.message}`}).eq('id',inboxId));
    }
    throw error;
   }
  }
  throwDb(await db.from('client_inbox').update({colis_id:colisId,status:'assigned'}).eq('id',inboxId).eq('status','assigning'));
  return json({success:true,colisId});
 }catch(error){return fail(error);}
});
