import { throwDb } from './http.ts';
export async function processOcrQueue(db:any) {
  if (!Deno.env.get('ANTHROPIC_API_KEY') || !Deno.env.get('ANTHROPIC_MODEL')) return { processed:0,configured:false };
  throwDb(await db.from('ocr_jobs').update({status:'pending'}).eq('status','processing').lt('locked_at',new Date(Date.now()-300000).toISOString()));
  const candidates=await db.from('ocr_jobs').select('*').eq('status','pending').lte('available_at',new Date().toISOString()).order('created_at').limit(2);throwDb(candidates);
  let processed=0;const started=Date.now();
  for(const job of candidates.data){
    if(Date.now()-started>55000)break;
    const claimed=await db.from('ocr_jobs').update({status:'processing',locked_at:new Date().toISOString(),attempts:job.attempts+1}).eq('facture_id',job.facture_id).eq('status','pending').select().maybeSingle();throwDb(claimed);if(!claimed.data)continue;
    try {
      const response=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ocr-facture`,{method:'POST',headers:{Authorization:`Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify({factureId:job.facture_id,colisId:job.colis_id,action:'extract'}),signal:AbortSignal.timeout(65000)});
      const result=await response.json();if(!response.ok || !result.success)throw new Error(result.error || 'Analyse impossible');
      throwDb(await db.from('ocr_jobs').update({status:'review',last_error:null}).eq('facture_id',job.facture_id));
      throwDb(await db.from('factures').update({ocr_status:result.extraction.status,ocr_error:null}).eq('id',job.facture_id));processed++;
    }catch(error){
      const message=error instanceof Error?error.message:'Analyse impossible';
      throwDb(await db.from('ocr_jobs').update({status:job.attempts+1>=3?'failed':'pending',last_error:message,available_at:new Date(Date.now()+900000).toISOString()}).eq('facture_id',job.facture_id));
      throwDb(await db.from('factures').update({ocr_status:'failed',ocr_error:message}).eq('id',job.facture_id));
    }
  }
  return {processed,configured:true};
}
