import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { admin, fail, HttpError, json, postOnly, requireStaff, throwDb, uuid } from '../_shared/http.ts';
import { requirePayplugCreationMode } from '../_shared/payplugMode.ts';

const taskPermissions: Record<string, string> = {
  reception: 'perm_colis_mesurer', preparation: 'perm_colis_preparer',
  accord: 'perm_colis_demander_feuvert', devis: 'perm_colis_calculer_devis',
};
const openStates = ['receptionne','mesure','attente_feu_vert','autorise','refuse_client','en_preparation','devis_envoye','attente_paiement'];
const boxKeys = ['dimL','dimW','dimH','poids'];
function measuredBoxes(value: unknown, allowExtraKeys = false): Array<Record<string, number>> | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  if (value.some(box => !box || typeof box !== 'object' || Array.isArray(box)
    || !allowExtraKeys && Object.keys(box).some(key => !boxKeys.includes(key))
    || boxKeys.some(key => !['string','number'].includes(typeof box[key])
      || !/^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$/.test(String(box[key]))
      || !Number.isFinite(Number(box[key])) || Number(box[key]) <= 0))) return null;
  return value.map(box => Object.fromEntries(boxKeys.map(key => [key, Number(box[key])])));
}
function preflightValues(colis: any, task: string, values: Record<string, unknown>) {
  if (Object.keys(values).some(key => key !== 'boxes' || !['reception','preparation'].includes(task))) throw new HttpError(400, 'Valeurs de correction invalides.');
  if (['preparation','devis'].includes(task) && (!['autorise','en_preparation','devis_envoye','attente_paiement'].includes(colis.statut) || colis.feu_vert !== 'autorise' || colis.produit_interdit)) throw new HttpError(409, 'L’accord client actuel et une préparation autorisée sont requis.');
  if (['reception','preparation'].includes(task)) {
    const boxes = measuredBoxes(values.boxes);
    if (!boxes) throw new HttpError(400, 'Renseignez longueur, largeur, hauteur et poids positifs pour chaque colis.');
    if (task === 'reception') {
      const count = Math.max(1, Number(colis.nb_colis) || 0, colis.trackings_detail?.length || 0,
        colis.trackings?.filter((tracking: unknown) => typeof tracking === 'string' && tracking.trim()).length || 0, colis.dims_par_colis?.length || 0);
      if (boxes.length !== count) throw new HttpError(400, 'La correction conserve les mêmes cartons. Utilisez la réception pour ajouter un carton.');
    }
    const previous = task === 'reception'
      ? (colis.dims_par_colis?.length ? colis.dims_par_colis : [{ dimL:colis.dim_l,dimW:colis.dim_w,dimH:colis.dim_h,poids:colis.poids }])
      : (colis.final_packages || [{ dimL:colis.fin_l,dimW:colis.fin_w,dimH:colis.fin_h,poids:colis.fin_p }]);
    return JSON.stringify(boxes) === JSON.stringify(measuredBoxes(previous, true))
      && (task !== 'preparation' || colis.final_measurements_version === colis.preparation_composition_version
        && colis.outgoing_parcel_count === boxes.length && Boolean(colis.final_measurements_at));
  }
  if (task === 'devis') return colis.devis_total == null && !Object.hasOwn(colis.devis_snapshot || {}, 'inputs')
    && !colis.payplug_payment_id && !colis.payplug_payment_url && !['devis_envoye','attente_paiement'].includes(colis.statut);
  return ['receptionne','mesure'].includes(colis.statut) && colis.feu_vert === 'en_attente'
    && !colis.feu_vert_date && !colis.attente_client_date && !colis.demande_feu_vert_envoyee_at;
}

function instant(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  // PostgreSQL timestamps retain microseconds; Date alone discards the final three.
  const fraction = (value.match(/\.(\d+)/)?.[1] || '').padEnd(6,'0');
  return `${Date.parse(value)}:${fraction.slice(3)}`;
}

function verifyPayment(payment: any, link: any, colis: any, expectedLive: boolean) {
  if (!payment || typeof payment !== 'object' || payment.id !== link.provider_id || payment.object !== 'payment' || payment.is_live !== expectedLive
    || payment.currency !== 'EUR' || !Number.isInteger(payment.amount) || payment.amount !== link.amount_cents
    || payment.metadata?.colis_id !== colis.id) throw new HttpError(409, 'Le paiement fournisseur ne correspond pas à ce dossier, à son montant ou au mode attendu.');
  if (payment.is_paid !== false || (payment.amount_refunded ?? 0) !== 0) throw new HttpError(409, 'Un paiement reçu ou remboursé est signalé. La correction est bloquée ; aucun remboursement ne sera effectué.');
  if (link.kind === 'modern') {
    if (link.provider_is_live !== expectedLive || payment.metadata?.intent_id !== link.id
      || String(payment.metadata?.quote_version) !== String(link.quote_version)) throw new HttpError(409, 'Le paiement ne correspond pas à la version du devis enregistrée.');
  } else if (payment.metadata?.colis_ref !== link.colis_ref || Object.hasOwn(payment.metadata, 'quote_version')
    || Object.hasOwn(payment.metadata, 'intent_id') || typeof payment.billing?.email !== 'string'
    || payment.metadata?.client_id != null && payment.metadata.client_id !== link.client_id
    || payment.billing.email.trim().toLowerCase() !== link.billing_email.trim().toLowerCase()) {
    throw new HttpError(409, 'L’identité du paiement historique doit être vérifiée avant de retirer son lien.');
  }
}

Deno.serve(async (req: Request) => {
  const early = postOnly(req); if (early) return early;
  const cancelledIds: string[] = [];
  let db: any; let colisId: string | undefined;
  try {
    db = admin(); const user = await requireStaff(req, 'perm_colis_revenir_arriere', db);
    let body: any;
    try { body = await req.json(); } catch { throw new HttpError(400, 'La demande de correction est illisible. Réessayez.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'La demande de correction est invalide.');
    const { task, values, expectedUpdatedAt, reason } = body; colisId = body.colisId;
    if (!uuid(colisId) || typeof task !== 'string' || !Object.hasOwn(taskPermissions, task) || !values || typeof values !== 'object' || Array.isArray(values)
      || !instant(expectedUpdatedAt)
      || typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) throw new HttpError(400, 'Vérifiez le dossier, la tâche, les mesures et le motif de correction.');
    await requireStaff(req, taskPermissions[task], db);
    const scoped = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: `Bearer ${user.token}` } }, auth: { persistSession: false },
    });
    const found = await db.from('colis').select('*').eq('id', colisId).single(); throwDb(found);
    const colis = found.data;
    if (!colis) throw new HttpError(404, 'Dossier introuvable.');
    if (instant(colis.updated_at) !== instant(expectedUpdatedAt)) return json({ ok:false,code:'40001',error:'Le dossier a changé. Votre saisie est conservée ; comparez-la à la version enregistrée.' },409);
    if (colis.archive || colis.paiement_date || colis.paiement_montant != null || colis.date_expedition || !openStates.includes(colis.statut)) throw new HttpError(409, 'La correction est réservée aux dossiers ouverts, non payés et non partis.');
    const unchanged = preflightValues(colis, task, values);
    const [intentsResult, paidResult, legacyResult] = await Promise.all([
      db.from('payment_intents').select('*').eq('colis_id', colisId),
      db.from('paiements').select('id').eq('colis_id', colisId).eq('statut','confirme').limit(1),
      db.from('legacy_payplug_payments').select('*').eq('colis_id', colisId),
    ]); [intentsResult, paidResult, legacyResult].forEach(throwDb);
    const intents = intentsResult.data || []; const legacy = legacyResult.data || [];
    if (paidResult.data?.length || intents.some((intent: any) => intent.status === 'paid')
      || legacy.some((link: any) => link.observed_payment_date || link.observed_payment_amount != null)) throw new HttpError(409, 'Un règlement est déjà enregistré. La correction est bloquée.');
    if (colis.envoi_id) {
      const departure = await db.from('envois').select('departed_at,manifest_version').eq('id',colis.envoi_id).maybeSingle(); throwDb(departure);
      if (departure.data?.departed_at || departure.data?.manifest_version > 0) throw new HttpError(409, 'Ce dossier appartient à un départ déjà confirmé.');
    }
    if (!unchanged) {
      if (intents.some((intent: any) => intent.status === 'creating')) throw new HttpError(409, 'Un lien de paiement est en cours de création. Attendez sa confirmation avant de corriger le dossier.');
      const links = [...intents.filter((intent: any) => intent.provider_id).map((intent: any) => ({...intent,kind:'modern'})),
        ...legacy.map((link: any) => ({...link,kind:'legacy'}))];
      if (colis.payplug_payment_id && !links.some(link => link.provider_id === colis.payplug_payment_id)
        || colis.payplug_payment_url && !colis.payplug_payment_id) throw new HttpError(409, 'Le lien de paiement actuel n’a pas de référence vérifiable. Faites vérifier ce lien avant de corriger.');
      for (const link of links) {
        if (link.provider_cancelled_at) { cancelledIds.push(link.provider_id); continue; }
        const key = Deno.env.get('PAYPLUG_SECRET_KEY')?.trim();
        if (!key) throw new HttpError(503, 'PayPlug doit être configuré pour retirer l’ancien lien de paiement.');
        const expectedLive = requirePayplugCreationMode(key);
        if (link.kind === 'legacy' && !expectedLive) throw new HttpError(409, 'Ce lien historique doit être rapproché manuellement avant de corriger le dossier dans cet environnement de test.');
        if (!/^pay_[a-zA-Z0-9]+$/.test(link.provider_id)) throw new HttpError(409, 'Référence PayPlug non reconnue.');
        const url = `https://api.payplug.com/v1/payments/${encodeURIComponent(link.provider_id)}`;
        const headers = { Authorization:`Bearer ${key}`,'PayPlug-Version':'2019-08-06','Content-Type':'application/json' };
        let response: Response;
        try { response = await fetch(url,{headers,signal:AbortSignal.timeout(15000)}); }
        catch { throw new HttpError(502, 'PayPlug n’a pas confirmé l’état de l’ancien lien. La correction n’est pas enregistrée ; réessayez.'); }
        if (!response.ok) throw new HttpError(502, 'Impossible de vérifier l’ancien paiement auprès de PayPlug.');
        let payment = await response.json(); verifyPayment(payment,link,colis,expectedLive);
        if (payment.failure?.code !== 'aborted') {
          if (payment.failure) throw new HttpError(409, 'Ce paiement fournisseur est déjà en échec. Faites vérifier sa clôture avant de corriger le dossier.');
          try { response = await fetch(url,{method:'PATCH',headers,body:JSON.stringify({aborted:true}),signal:AbortSignal.timeout(15000)}); }
          catch { throw new HttpError(502, 'L’annulation PayPlug n’a pas été confirmée. Votre correction n’est pas enregistrée ; réessayez pour vérifier le lien.'); }
          if (!response.ok) throw new HttpError(502, 'PayPlug n’a pas confirmé l’annulation. Vérifiez si le client a payé, puis réessayez.');
          payment = await response.json(); verifyPayment(payment,link,colis,expectedLive);
          if (payment.failure?.code !== 'aborted') throw new HttpError(502, 'PayPlug n’a pas confirmé que l’ancien lien est annulé. La correction n’est pas enregistrée.');
        }
        cancelledIds.push(link.provider_id);
        const proof = await db.rpc('record_payplug_cancellation', { p_colis_id:colisId,p_provider_id:link.provider_id,p_payment:payment });
        throwDb(proof);
      }
    }
    const correction = await scoped.rpc('correct_colis_task', {
      p_colis_id:colisId,p_task:task,p_values:values,p_expected_updated_at:expectedUpdatedAt,p_reason:reason.trim(),
    });
    if (correction.error) {
      const error: any = new HttpError(correction.error.code === '42501' ? 403 : 409, correction.error.message || 'La correction n’a pas pu être enregistrée. Votre saisie est conservée.');
      error.code = correction.error.code; throw error;
    }
    return json({ ...correction.data, paymentLinkCancelled:cancelledIds.length > 0 });
  } catch (error) {
    if (cancelledIds.length && db && colisId) {
      // The provider link is gone even if the dossier CAS failed. Never clear a
      // replacement link or overwrite the colleague's measurements/status.
      let cleanupFailed = false;
      try {
        const cleaned = await db.from('colis').update({payplug_payment_url:null}).eq('id',colisId).in('payplug_payment_id',cancelledIds).select('id');
        cleanupFailed = Boolean(cleaned.error);
      } catch { cleanupFailed = true; }
      const extra = cleanupFailed ? ' L’affichage du lien doit aussi être actualisé.' : '';
      return json({ok:false,code:(error as any)?.code || null,paymentLinkCancelled:true,correctionSaved:false,
        error:`Un ancien lien de paiement est désactivé, mais la correction n’est pas enregistrée. Votre saisie est conservée.${extra} ${error instanceof HttpError ? error.message : 'Réessayez après avoir actualisé le dossier.'}`},error instanceof HttpError ? error.status : 500);
    }
    if (error instanceof HttpError && (error as any).code) return json({ok:false,error:error.message,code:(error as any).code},error.status);
    return fail(error);
  }
});
