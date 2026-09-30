import { admin, fail, HttpError, json, postOnly, requireUser, uuid } from '../_shared/http.ts';
import { hashPaymentReturnToken } from '../_shared/paymentReturnToken.ts';

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

Deno.serve(async (req: Request) => {
  const early = postOnly(req); if (early) return privateResponse(early);
  try {
    let body;
    try { body = await req.json(); } catch { throw new HttpError(400, 'Lien de paiement invalide'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Lien de paiement invalide');
    const db = admin();
    let tokenHash: string | null = null;
    let actorId: string | null = null;
    let colisId: string | null = null;
    if (Object.prototype.hasOwnProperty.call(body, 'token')) {
      if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw new HttpError(400, 'Lien de paiement invalide');
      tokenHash = await hashPaymentReturnToken(body.token);
    } else {
      if (!uuid(body.colisId)) throw new HttpError(400, 'Lien de paiement invalide');
      const user = await requireUser(req, db);
      actorId = user.id;
      colisId = body.colisId;
    }
    const result = await db.rpc('get_payment_return', { p_token_hash: tokenHash, p_colis_id: colisId, p_actor_id: actorId });
    if (result.error) {
      const codes: Record<string, number> = { P0401: 401, P0403: 403, P0404: 404, P0410: 410 };
      const status = codes[result.error.code];
      if (status) throw new HttpError(status, status === 410 ? 'Ce lien a expiré. Connectez-vous à votre espace client.' : status === 401 ? 'Connexion requise' : 'Ce lien de paiement est indisponible pour ce compte.');
      // Do not log database details: they could contain the capability hash.
      throw new HttpError(503, 'La vérification du paiement est momentanément indisponible. Réessayez dans quelques instants.');
    }
    if (!result.data) throw new HttpError(404, 'Ce lien de paiement est indisponible.');
    return privateResponse(json(result.data));
  } catch (error) { return privateResponse(fail(error)); }
});
