import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { admin, fail, HttpError, json, postOnly, requireStaff, throwDb, uuid } from '../_shared/http.ts';
import { cancelPayplugLinks, compensateCancelledLinks, linksUpToVersion, loadPaymentLinks, PayplugCancelError } from '../_shared/payplugCancel.ts';
import { deliverWithdrawalMessages, processQuoteWithdrawal } from '../_shared/quoteWithdrawal.ts';
import { instant } from '../_shared/revision.ts';
import { assertTaskOwner } from '../_shared/taskOwner.ts';

// D2: an invoice action on a sent quote first withdraws it. PayPlug cancels the
// old link (proof stored) before the database withdraws and versions the quote;
// a payment made before that abort is booked normally and freezes the dossier.
const actionPermissions: Record<string, string | null> = {
  open_modification: null, manual_articles: null,
  replace_document: 'perm_factures_ajouter', add_document: 'perm_factures_ajouter', import_attachment: 'perm_factures_ajouter',
  request_correction: 'perm_factures_refuser', classify_duplicate: 'perm_factures_valider', restore_duplicate: 'perm_factures_valider',
};
// Same texts as the database guard (_frozen_message).
const frozenText: Record<string, string> = {
  payment: 'Un paiement est enregistré pour ce dossier : factures, articles et analyses sont figés. Ils restent consultables.',
  departure: 'Ce dossier est parti : factures, articles et analyses sont figés. Ils restent consultables.',
  closed: 'Ce dossier est clos : factures, articles et analyses restent consultables.',
};
const OWNER = 'Ces pièces sont suivies par un collègue. Actualisez le dossier et organisez un relais avant de retirer le devis.';

Deno.serve(async (req: Request) => {
  const early = postOnly(req); if (early) return early;
  const cancelledIds: string[] = []; const abortedIds: string[] = [];
  let db: any; let colisId: string | undefined;
  try {
    db = admin(); const user = await requireStaff(req, 'perm_factures_modifier_articles', db);
    let body: any;
    try { body = await req.json(); } catch { throw new HttpError(400, 'La demande de retrait est illisible. Réessayez.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'La demande de retrait est invalide.');
    const { action } = body;
    if (typeof action !== 'string' || action !== 'retry' && !Object.hasOwn(actionPermissions, action)) throw new HttpError(400, 'Action de retrait inconnue.');
    // Every permission is checked before PayPlug is contacted (SQL checks them again).
    const extra = actionPermissions[action]; if (extra) await requireStaff(req, extra, db);
    if (!uuid(body.colisId)) throw new HttpError(400, 'Dossier requis.');
    colisId = body.colisId;
    if (action === 'retry') {
      if (!uuid(body.withdrawalId)) throw new HttpError(400, 'Demande de retrait requise.');
      const found = await db.from('quote_withdrawals').select('id').eq('id', body.withdrawalId).eq('colis_id', colisId).maybeSingle(); throwDb(found);
      if (!found.data) throw new HttpError(404, 'Cette demande de retrait n’existe pas pour ce dossier. Actualisez le dossier.');
      // Starts with a PayPlug read; a request left for review is reopened by this explicit action.
      return json({ ok: true, withdrawal: await processQuoteWithdrawal(db, body.withdrawalId, { rearm: true, deadline: Date.now() + 25000 }) });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : body.reason == null ? '' : null;
    if (!instant(body.expectedUpdatedAt) || reason === null || reason && (reason.length < 3 || reason.length > 500)
      || body.factureId != null && !uuid(body.factureId) || body.messageId != null && !uuid(body.messageId)
      || body.expectedReviewToken != null && typeof body.expectedReviewToken !== 'string'
      || action === 'open_modification' && !uuid(body.factureId) || action === 'import_attachment' && !uuid(body.messageId)) {
      throw new HttpError(400, 'Vérifiez le dossier, la pièce concernée et le motif du retrait (3 à 500 caractères).');
    }
    const found = await db.from('colis').select('*').eq('id', colisId).maybeSingle(); throwDb(found);
    const colis = found.data;
    if (!colis) throw new HttpError(404, 'Dossier introuvable.');
    if (instant(colis.updated_at) !== instant(body.expectedUpdatedAt)) return json({ ok:false, code:'40001', error:'Le dossier a changé. Actualisez puis réessayez.' }, 409);
    const state = await db.rpc('invoice_lock_state', { p_colis_id: colisId }); throwDb(state);
    const lock = state.data || {};
    if (lock.frozenReason) return json({ ok:false, code:'22023', hint:`invoices_frozen:${lock.frozenReason}`, error: frozenText[lock.frozenReason] || frozenText.closed }, 409);
    await assertTaskOwner(db, colisId as string, ['documents', 'correction'], user.id, OWNER);
    // The follow-up's own preconditions (invoice of this dossier, review token, attachment) before any PayPlug call:
    // an invalid request never costs the client a live payment link.
    const preflight = await db.rpc('withdraw_quote_preflight', { p_colis_id: colisId, p_action: action, p_facture_id: body.factureId || null,
      p_expected_review_token: body.expectedReviewToken ?? null, p_message_id: body.messageId || null });
    if (preflight.error) {
      if (!['22023', '40001'].includes(preflight.error.code)) throwDb(preflight);
      return json({ ok:false, code:preflight.error.code, ...(preflight.error.hint ? { hint:preflight.error.hint } : {}), error:preflight.error.message }, 409);
    }
    if (lock.quoteLocked) {
      try {
        // Only this quote's links and older ones; the owner is checked again right before each abort.
        await cancelPayplugLinks(db, colis, linksUpToVersion(await loadPaymentLinks(db, colis.id), colis.quote_version), {
          context: 'withdrawal', cancelledIds, abortedIds, beforePatch: () => assertTaskOwner(db, colis.id, ['documents', 'correction'], user.id, OWNER),
        });
      } catch (error) {
        if (!(error instanceof PayplugCancelError)) throw error;
        // Nothing withdrawn. A link already attested stays attested; its stale URL is cleared.
        if (cancelledIds.length) await compensateCancelledLinks(db, colis.id, cancelledIds);
        return json({ ok:false, error:error.message, code: error.kind === 'creating' ? '40001' : `payplug_${error.kind}`,
          ...(error.kind === 'creating' ? { hint:'payment_link_creating' } : {}),
          ...(abortedIds.length ? { paymentLinkCancelled:true } : {}), ...(error.kind === 'proof' ? { withdrawalSaved:false } : {}) }, error.status);
      }
    }
    const scoped = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: `Bearer ${user.token}` } }, auth: { persistSession: false },
    });
    const withdrawal = await scoped.rpc('withdraw_quote_for_documents', {
      p_colis_id: colisId, p_expected_updated_at: body.expectedUpdatedAt, p_action: action, p_reason: reason || null,
      p_facture_id: body.factureId || null, p_expected_review_token: body.expectedReviewToken ?? null, p_message_id: body.messageId || null,
    });
    if (withdrawal.error) {
      const error: any = new HttpError(withdrawal.error.code === '42501' ? 403 : 409, withdrawal.error.message || 'Le retrait du devis n’a pas été enregistré.');
      error.code = withdrawal.error.code; error.hint = withdrawal.error.hint; throw error;
    }
    const data = withdrawal.data || {};
    // D3 message (conversation import, or an absorbed client request): after the commit, once per withdrawn version.
    const message = data.changed ? await deliverWithdrawalMessages(db, colis.id) : null;
    return json({ ok:true, changed: data.changed === true, colis: data.colis ?? null, withdrawal: data.withdrawal ?? null,
      ...(data.reviewToken ? { reviewToken: data.reviewToken } : {}), ...(data.facture ? { facture: data.facture } : {}),
      paymentLinkCancelled: cancelledIds.length > 0, ...(message ? { message } : {}) });
  } catch (error) {
    const code = (error as any)?.code ?? null; const hint = (error as any)?.hint ?? null;
    if (cancelledIds.length && db && colisId) {
      // The provider link is gone even if the dossier changed meanwhile: never clear a replacement link.
      const { cleanupFailed } = await compensateCancelledLinks(db, colisId, cancelledIds);
      // Links attested by an earlier attempt: nothing was cancelled by this request, report the refusal itself.
      if (!abortedIds.length && error instanceof HttpError && code) return json({ ok:false, error:error.message, code, ...(hint ? { hint } : {}) }, error.status);
      const extra = cleanupFailed ? ' L’affichage du lien doit aussi être actualisé.' : '';
      return json({ ok:false, code, hint, paymentLinkCancelled:true, withdrawalSaved:false,
        error:`L’ancien lien de paiement est annulé, mais le retrait du devis n’est pas enregistré.${extra} ${error instanceof HttpError ? error.message : 'Actualisez le dossier puis réessayez.'}` }, error instanceof HttpError ? error.status : 500);
    }
    if (error instanceof HttpError && code) return json({ ok:false, error:error.message, code, ...(hint ? { hint } : {}) }, error.status);
    return fail(error);
  }
});
