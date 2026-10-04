import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { admin, fail, HttpError, json, postOnly, requireStaff, throwDb, uuid } from '../_shared/http.ts';
import { cancelPayplugLinks, compensateCancelledLinks, loadPaymentLinks } from '../_shared/payplugCancel.ts';
import { instant } from '../_shared/revision.ts';
import { assertTaskOwner } from '../_shared/taskOwner.ts';

const taskPermissions: Record<string, string> = {
  reception: 'perm_colis_mesurer', preparation: 'perm_colis_preparer',
  accord: 'perm_colis_demander_feuvert', devis: 'perm_colis_calculer_devis',
};
const openStates = ['receptionne','mesure','attente_feu_vert','autorise','refuse_client','en_preparation','devis_envoye','attente_paiement'];
const boxKeys = ['dimL','dimW','dimH','poids'];
const checkTaskOwner = (db: any, colisId: string, task: string, staffId: string) =>
  assertTaskOwner(db, colisId, [task === 'accord' ? 'reception' : task === 'devis' ? 'quote' : task, 'correction'], staffId);
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
    // Refuse an already transferred task before touching its payment provider.
    // SQL checks again under lock; an external cancellation cannot share that
    // transaction, so the existing cancellation proof/cleanup remains required.
    await checkTaskOwner(db, colisId, task, user.id);
    const [{ intents, legacy }, paidResult] = await Promise.all([
      loadPaymentLinks(db, colisId),
      db.from('paiements').select('id').eq('colis_id', colisId).eq('statut','confirme').limit(1),
    ]); throwDb(paidResult);
    if (paidResult.data?.length || intents.some((intent: any) => intent.status === 'paid')
      || legacy.some((link: any) => link.observed_payment_date || link.observed_payment_amount != null)) throw new HttpError(409, 'Un règlement est déjà enregistré. La correction est bloquée.');
    if (colis.envoi_id) {
      const departure = await db.from('envois').select('departed_at,manifest_version').eq('id',colis.envoi_id).maybeSingle(); throwDb(departure);
      if (departure.data?.departed_at || departure.data?.manifest_version > 0) throw new HttpError(409, 'Ce dossier appartient à un départ déjà confirmé.');
    }
    if (!unchanged) await cancelPayplugLinks(db, colis, { intents, legacy }, {
      context: 'correction', cancelledIds, beforePatch: () => checkTaskOwner(db, colisId as string, task, user.id),
    });
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
      const { cleanupFailed } = await compensateCancelledLinks(db, colisId, cancelledIds);
      const extra = cleanupFailed ? ' L’affichage du lien doit aussi être actualisé.' : '';
      return json({ok:false,code:(error as any)?.code || null,paymentLinkCancelled:true,correctionSaved:false,
        error:`Un ancien lien de paiement est désactivé, mais la correction n’est pas enregistrée. Votre saisie est conservée.${extra} ${error instanceof HttpError ? error.message : 'Réessayez après avoir actualisé le dossier.'}`},error instanceof HttpError ? error.status : 500);
    }
    if (error instanceof HttpError && (error as any).code) return json({ok:false,error:error.message,code:(error as any).code},error.status);
    return fail(error);
  }
});
