import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { admin, fail, HttpError, json, postOnly, requireUser, throwDb, trustedStoragePath, uuid } from '../_shared/http.ts';
import { processQuoteWithdrawal } from '../_shared/quoteWithdrawal.ts';

// D3, client portal: one already uploaded file becomes an invoice of the client's
// dossier. On a sent quote the old PayPlug link is cancelled before the quote is
// withdrawn; until then the quote stays payable and the portal hides its link.
const MAX_BYTES = 20 * 1024 * 1024;  // same limit as the portal upload
const UPDATING = ['pending', 'processing', 'busy', 'needs_review'];
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req: Request) => {
  const early = postOnly(req); if (early) return early;
  try {
    const db = admin(); const user = await requireUser(req, db);
    if (user.role !== 'client') throw new HttpError(403, 'Dépôt réservé à l’espace client.');
    let body: any;
    try { body = await req.json(); } catch { throw new HttpError(400, 'La demande est illisible. Réessayez.'); }
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const { colisId, fileName, vendor, replacesFactureId } = input;
    if (!uuid(colisId) || typeof input.path !== 'string' || typeof fileName !== 'string' || !fileName.trim()
      || vendor != null && (typeof vendor !== 'string' || vendor.length > 200) || replacesFactureId != null && !uuid(replacesFactureId)) {
      throw new HttpError(400, 'Document, dossier et nom de fichier valides requis.');
    }
    if (fileName.length > 200) throw new HttpError(400, 'Le nom du fichier est trop long (200 caractères au plus). Renommez-le puis réessayez.');
    const path = trustedStoragePath(input.path, 'factures', colisId);
    if (!/\.(pdf|jpe?g|png|webp)$/i.test(path)) throw new HttpError(400, 'Envoyez une facture PDF, JPEG, PNG ou WebP.');
    // Ownership before the service reads the file (the deposit command checks it again).
    const dossier = await db.from('colis').select('id,client_id').eq('id', colisId).maybeSingle(); throwDb(dossier);
    const owner = dossier.data ? await db.from('clients').select('user_id').eq('id', dossier.data.client_id).maybeSingle() : { data: null, error: null };
    throwDb(owner);
    if (!owner.data || owner.data.user_id !== user.id) throw new HttpError(403, 'Ce dossier ne correspond pas à votre compte.');
    // Size from the stored object's metadata before the service loads it into memory (the bucket has no size limit yet).
    const slash = path.lastIndexOf('/'); const folder = path.slice(0, slash); const objectName = path.slice(slash + 1);
    const listing = await db.storage.from('factures').list(folder, { search: objectName, limit: 100 });
    if (listing.error) throw listing.error;
    const object = (listing.data || []).find((item: { name?: string }) => item?.name === objectName);
    if (!object) throw new HttpError(400, 'Document introuvable dans votre dossier. Envoyez-le de nouveau.');
    if (Number(object.metadata?.size) > MAX_BYTES) throw new HttpError(400, 'Le document dépasse 20 Mo.');
    const download = await db.storage.from('factures').download(path);
    if (download.error || !download.data) throw new HttpError(400, 'Document introuvable dans votre dossier. Envoyez-le de nouveau.');
    if (download.data.size > MAX_BYTES) throw new HttpError(400, 'Le document dépasse 20 Mo.');
    const sha256 = hex(await crypto.subtle.digest('SHA-256', await download.data.arrayBuffer()));
    // A byte-identical copy of a validated invoice changes nothing: no invoice, no withdrawal.
    const precheck = await db.rpc('client_document_precheck', { p_colis_id: colisId, p_user_id: user.id, p_path: path, p_sha256: sha256 });
    if (precheck.error) { if (precheck.error.code === '42501') throw new HttpError(403, 'Ce dossier ne correspond pas à votre compte.'); throw precheck.error; }
    if (precheck.data?.identicalTo) return json({ ok: true, status: 'duplicate', ...(typeof precheck.data.quoteSent === 'boolean' ? { quoteSent: precheck.data.quoteSent } : {}) });
    const scoped = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: `Bearer ${user.token}` } }, auth: { persistSession: false },
    });
    // Idempotent on the path: a retry after a lost response returns the same invoice.
    const deposit = await scoped.rpc('deposit_client_invoice', { p_colis_id: colisId, p_path: path, p_file_name: fileName.trim(),
      p_vendor: typeof vendor === 'string' && vendor.trim() ? vendor.trim() : null, p_replaces_facture_id: replacesFactureId || null });
    if (deposit.error) {
      // Only the business reason (22023) is shown to the client; any other database text stays in the logs.
      if (deposit.error.code === '42501') throw new HttpError(403, 'Ce dossier ne correspond pas à votre compte.');
      if (deposit.error.code === '22023') throw new HttpError(409, deposit.error.message || 'Le dépôt n’a pas été enregistré. Réessayez.');
      console.error('Client invoice deposit refused', deposit.error.code, deposit.error.message);
      throw new HttpError(500, 'Le dépôt n’a pas été enregistré. Réessayez.');
    }
    const data = deposit.data || {};
    let status = data.status === 'frozen' ? 'frozen' : data.status === 'withdrawn' ? 'quote_withdrawn' : data.status === 'intake' ? 'received_pending' : 'added';
    let linkCancelled: boolean | undefined;
    if (data.status === 'intake' && uuid(data.withdrawalId)) {
      // The invoice is saved: processing can change what the client is told, never fail the deposit.
      const outcome = await processQuoteWithdrawal(db, data.withdrawalId, { deadline: Date.now() + 20000 }).catch(() => null);
      status = !outcome || UPDATING.includes(outcome.status) ? 'received_pending' : outcome.status === 'withdrawn' ? 'quote_withdrawn' : outcome.status === 'paid' ? 'paid' : 'added';
      if (outcome?.status === 'withdrawn') linkCancelled = outcome.linkCancelled === true;
    } else if (data.status === 'withdrawn' && uuid(data.withdrawalId)) {
      const row = await db.from('quote_withdrawals').select('link_cancelled').eq('id', data.withdrawalId).maybeSingle();
      if (!row.error && row.data) linkCancelled = row.data.link_cancelled === true;
    }
    // No PayPlug detail reaches the client.
    // The frozen reason (payment, departure, closed) chooses the client wording: never « paid » without a payment.
    return json({ ok: true, status, ...(status === 'frozen' && typeof data.reason === 'string' ? { reason: data.reason } : {}),
      ...(data.facture ? { facture: data.facture } : {}), ...(linkCancelled === undefined ? {} : { linkCancelled }) });
  } catch (error) { return fail(error); }
});
