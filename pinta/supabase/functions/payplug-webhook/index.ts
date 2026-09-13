import { admin, fail, HttpError, json, uuid } from '../_shared/http.ts';
import { payplugMode, payplugKeyMode } from '../_shared/payplugMode.ts';

// PayPlug notifications contain an untrusted resource ID. Authenticity is established
// by retrieving that resource using our secret API key, as required by PayPlug's API.
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const key = Deno.env.get('PAYPLUG_SECRET_KEY')?.trim();
    if (!key) throw new HttpError(503, 'Paiement non configuré');
    const mode = payplugMode();
    const keyMode = payplugKeyMode(key);
    const notification = await req.json();
    if (notification.object !== 'payment' || typeof notification.id !== 'string' || !/^pay_[a-zA-Z0-9]+$/.test(notification.id)) throw new HttpError(400, 'Notification de paiement invalide');
    const response = await fetch(`https://api.payplug.com/v1/payments/${encodeURIComponent(notification.id)}`, { headers: { Authorization: `Bearer ${key}`, 'PayPlug-Version': '2019-08-06' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new HttpError(502, 'Impossible de vérifier ce paiement auprès de PayPlug');
    const payment = await response.json();
    const expectedLive = keyMode === 'live';
    if (payment.id !== notification.id || payment.object !== 'payment' || payment.is_live !== expectedLive || (typeof notification.is_live === 'boolean' && notification.is_live !== payment.is_live)) throw new HttpError(400, 'Mode ou référence du paiement incompatible');
    if (payment.is_paid !== true) return json({ received: true, action: 'not_paid' });
    if (!uuid(payment.metadata?.colis_id) || !Number.isInteger(payment.amount) || payment.amount <= 0 || payment.currency !== 'EUR') throw new HttpError(400, 'Montant, devise ou devis de paiement invalide');
    const db = admin();
    // Only resources created by the old integration lack a quote version. Their
    // provider ID, customer and original quote must match the closed migration registry.
    const hasVersion = Object.prototype.hasOwnProperty.call(payment.metadata, 'quote_version');
    if (!hasVersion) {
      if (payment.is_live && mode !== 'live') throw new HttpError(409, 'Un règlement réel ne peut pas être confirmé dans cet environnement de test.');
      if (Object.prototype.hasOwnProperty.call(payment.metadata, 'intent_id') || typeof payment.metadata.colis_ref !== 'string' || !payment.metadata.colis_ref || typeof payment.billing?.email !== 'string' || !payment.billing.email.trim()) throw new HttpError(400, 'Références du paiement historique incomplètes');
      if ((payment.amount_refunded ?? 0) !== 0) throw new HttpError(409, 'Paiement historique remboursé : rapprochement nécessaire');
      const legacy = await db.rpc(payment.is_live ? 'confirm_legacy_payplug_payment' : 'ack_legacy_test_payplug_payment', { p_payment: {
        id: payment.id, object: payment.object, is_live: payment.is_live, is_paid: payment.is_paid,
        amount: payment.amount, amount_refunded: 0, currency: payment.currency, billing: { email: payment.billing.email },
        metadata: payment.metadata,
      } });
      if (legacy.error) throw new HttpError(409, 'Ce lien historique nécessite une vérification. Aucun nouveau règlement n’a été enregistré.');
      return json({ success: true, colisId: legacy.data.id, amount: payment.amount / 100, legacy: true, alreadyPaid: legacy.data.alreadyPaid, paymentMode: payment.is_live ? 'live' : 'test', financialConfirmation: payment.is_live === true });
    }
    if ((payment.amount_refunded ?? 0) !== 0) throw new HttpError(409, 'Un remboursement est signalé : vérification du règlement nécessaire. Aucun nouveau règlement n’a été enregistré.');
    if (payment.is_live !== (mode === 'live')) throw new HttpError(409, 'Le paiement reçu est dans un mode incompatible. Aucun règlement réel n’a été enregistré.');
    if (!Number.isInteger(Number(payment.metadata.quote_version)) || Number(payment.metadata.quote_version) < 1) throw new HttpError(400, 'Version du devis de paiement invalide');
    const result = await db.rpc('confirm_payplug_payment', { p_provider_id: payment.id, p_colis_id: payment.metadata.colis_id, p_quote_version: Number(payment.metadata.quote_version), p_amount_cents: payment.amount, p_currency: payment.currency });
    if (result.error) throw new HttpError(409, 'Paiement reçu : rapprochement avec le devis nécessaire');
    return json({ success: true, colisId: result.data.id, amount: payment.amount / 100 });
  } catch (error) { return fail(error); }
});
