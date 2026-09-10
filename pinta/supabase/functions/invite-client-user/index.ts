import { admin, fail, HttpError, json, postOnly, requireStaff, throwDb, uuid } from '../_shared/http.ts';

Deno.serve(async (req:Request)=>{
 const early=postOnly(req); if(early)return early;
 try{
  const db=admin();await requireStaff(req,'perm_clients_creer',db);
  const {clientId}=await req.json();if(!uuid(clientId))throw new HttpError(400,'Client requis');
  const client=await db.from('clients').select('id,email,user_id,nom,prenom').eq('id',clientId).single();throwDb(client);
  if(client.data.user_id)return json({success:true,already_active:true,userId:client.data.user_id});
  if(!client.data.email?.includes('@'))throw new HttpError(400,'Renseignez l’email du client avant son invitation');
  const appUrl=Deno.env.get('APP_URL');if(!appUrl || !/^https:\/\//.test(appUrl))throw new HttpError(503,'APP_URL doit être configurée');
  const email=client.data.email.trim().toLowerCase();
  let user:any=null;
  for(let page=1;!user;page++){
   const found=await db.auth.admin.listUsers({page,perPage:200});if(found.error)throw found.error;
   user=found.data.users.find((u:any)=>u.email?.toLowerCase()===email);
   if(found.data.users.length<200)break;
  }
  const existing=!!user;
  if(user){
   const profile=await db.from('profiles').select('role,actif').eq('id',user.id).single();throwDb(profile);
   if(profile.data.role!=='client' || !profile.data.actif)throw new HttpError(409,'Cet email appartient à un compte équipe ou inactif. Utilisez une autre adresse client.');
  }else{
   const invited=await db.auth.admin.inviteUserByEmail(email,{redirectTo:`${appUrl.replace(/\/$/,'')}/password`,data:{nom:client.data.nom,prenom:client.data.prenom}});
   if(invited.error || !invited.data.user)throw new HttpError(400,invited.error?.message || 'Invitation impossible');
   user=invited.data.user;
  }
  const linked=await db.rpc('link_client_account',{p_client_id:clientId,p_user_id:user.id});
  if(linked.error)throw new HttpError(409,linked.error.message);
  return json({success:true,userId:user.id,invitation_sent:!existing,existing_account:existing});
 }catch(error){return fail(error);}
});
