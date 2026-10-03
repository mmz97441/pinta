import { admin, fail, HttpError, json, postOnly, requireStaff, throwDb, uuid } from '../_shared/http.ts';
import { requirePayplugCreationMode } from '../_shared/payplugMode.ts';
import { createPaymentReturnToken } from '../_shared/paymentReturnToken.ts';

Deno.serve(async (req: Request) => {
  const early = postOnly(req); if (early) return early;
  try {
    const db = admin(); await requireStaff(req, 'perm_colis_envoyer_devis', db);
    const key = Deno.env.get('PAYPLUG_SECRET_KEY')?.trim();
    const appUrl = Deno.env.get('APP_URL');
    if (!key || !appUrl || !/^https:\/\//.test(appUrl)) throw new HttpError(503, 'PayPlug et APP_URL doivent être configurés');
    const expectedLive = requirePayplugCreationMode(key);
    const { colisId } = await req.json(); if (!uuid(colisId)) throw new HttpError(400, 'Identifiant de dossier requis');
    const found = await db.from('colis').select('id,ref,client_id,devis_total,quote_version,statut,paiement_date').eq('id', colisId).single(); throwDb(found);
    const colis = found.data;
    if (colis.paiement_date || !['en_preparation','devis_envoye','attente_paiement'].includes(colis.statut) || !Number.isFinite(Number(colis.devis_total)) || Number(colis.devis_total) <= 0 || colis.quote_version < 1) throw new HttpError(409, 'Un devis actif non payé est requis');
    const customer = await db.from('clients').select('nom,prenom,email,adresse,adresse_ligne1,adresse_ligne2,cp,ville,commune,type').eq('id', colis.client_id).single(); throwDb(customer);
    const client = customer.data;
    if (client.type === 'pro') throw new HttpError(409, 'Le règlement professionnel se confirme depuis le dossier');
    const address = client.adresse_ligne1 || client.adresse;
    const city = client.commune || client.ville;
    if (!client.nom || !client.email || !address || !city || !client.cp) throw new HttpError(400, 'Complétez le nom, l’email et l’adresse de facturation du client avant le paiement');
    const amount = Math.round(Number(colis.devis_total) * 100);
    const returnToken = await createPaymentReturnToken();
    // Serialize reservation with corrections and quote saves. The RPC verifies
    // current amount/version and every payment proof while holding the dossier.
    const reserved = await db.rpc('reserve_payplug_intent', {
      p_colis_id: colisId, p_quote_version: colis.quote_version, p_amount_cents: amount, p_is_live: expectedLive,
      p_return_token_hash: returnToken.hash, p_return_token_expires_at: returnToken.expiresAt,
    });
    if (reserved.error && ['40001', '22023', '23505'].includes(reserved.error.code)) throw new HttpError(409, reserved.error.message || 'Le dossier a changé. Actualisez avant de réessayer.');
    if (reserved.error?.code === '42501') throw new HttpError(403, 'Création du paiement non autorisée');
    throwDb(reserved);
    if (!reserved.data?.id) throw new HttpError(409, 'Réservation du paiement indisponible. Actualisez le dossier.');
    if (reserved.data.status === 'pending') return json({ success: true, paymentId: reserved.data.provider_id, paymentUrl: reserved.data.payment_url, amount: amount / 100, reused: true });
    if (reserved.data.status !== 'creating') throw new HttpError(409, 'Un paiement est déjà en traitement. Vérifiez son état.');
    const country = ({ '974':'RE','976':'YT','971':'GP','972':'MQ' } as Record<string,string>)[client.cp.slice(0,3)] || 'FR';
    const billing = { first_name: client.prenom || client.nom, last_name: client.nom, email: client.email.trim(), address1: address, ...(client.adresse_ligne2 ? { address2: client.adresse_ligne2 } : {}), postcode: client.cp, city, country, language: 'fr' };
    const returnUrl = `${appUrl.replace(/\/$/, '')}/paiement/retour?token=${returnToken.token}`;
    const response = await fetch('https://api.payplug.com/v1/payments', {
      method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'PayPlug-Version': '2019-08-06' },
      body: JSON.stringify({ amount, currency: 'EUR', billing, shipping: { ...billing, delivery_type: 'BILLING' },
        hosted_payment: { return_url: returnUrl, cancel_url: `${returnUrl}&payment=cancelled` },
        notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/payplug-webhook`, metadata: { colis_id: colisId, quote_version: String(colis.quote_version), intent_id: reserved.data.id } }),
    });
    if (!response.ok) {
      if ([400,401,403,422].includes(response.status)) throwDb(await db.from('payment_intents').update({ status: 'failed' }).eq('id', reserved.data.id));
      throw new HttpError(502, 'PayPlug n’a pas accepté ce paiement. Vérifiez les coordonnées et la configuration du compte.');
    }
    const payment = await response.json();
    if (!payment.id || !payment.hosted_payment?.payment_url) throw new HttpError(502, 'PayPlug n’a pas retourné de lien de paiement');
    if (payment.object !== 'payment' || payment.is_live !== expectedLive || payment.amount !== amount || payment.currency !== 'EUR' || payment.metadata?.colis_id !== colisId || Number(payment.metadata?.quote_version) !== colis.quote_version || payment.metadata?.intent_id !== reserved.data.id || !/^https:\/\//.test(payment.hosted_payment.payment_url)) throw new HttpError(502, 'Le paiement créé ne correspond pas au devis ou au mode attendu. Aucun lien ne sera transmis ; vérification nécessaire.');
    // Conditional update protects against a quote changed during the provider request.
    const saved = await db.from('payment_intents').update({ provider_id: payment.id, payment_url: payment.hosted_payment.payment_url, status: 'pending', updated_at: new Date().toISOString() }).eq('id', reserved.data.id).eq('status', 'creating').select().maybeSingle(); throwDb(saved);
    if (!saved.data) throw new HttpError(409, 'Le devis a changé pendant la création du lien. Recalculez le devis.');
    const linked = await db.from('colis').update({ payplug_payment_id: payment.id, payplug_payment_url: payment.hosted_payment.payment_url }).eq('id', colisId).eq('quote_version', colis.quote_version).select('id').maybeSingle(); throwDb(linked);
    if (!linked.data) throw new HttpError(409, 'Le devis a changé, ce lien ne sera pas envoyé');
    return json({ success: true, paymentId: payment.id, paymentUrl: payment.hosted_payment.payment_url, amount: amount / 100 });
  } catch (error) { return fail(error); }
});
