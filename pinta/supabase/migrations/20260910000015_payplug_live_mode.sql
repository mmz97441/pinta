-- Never infer provider mode from an existing hosted URL or historical status.
-- Unknown modes are retained for reconciliation, never silently reused.
ALTER TABLE payment_intents ADD COLUMN provider_is_live boolean;

-- Already paid historical test rows remain historical observations. New legacy
-- receipts require an actual live resource, even for service-role callers.
CREATE OR REPLACE FUNCTION confirm_legacy_payplug_payment(p_payment jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE legacy legacy_payplug_payments; c colis; cl clients; already_paid boolean:=false;
BEGIN
 IF p_payment->>'object' IS DISTINCT FROM 'payment' OR p_payment->'is_paid' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(p_payment->'is_live') IS DISTINCT FROM 'boolean' OR p_payment->>'currency' IS DISTINCT FROM 'EUR'
  OR jsonb_typeof(p_payment->'amount') IS DISTINCT FROM 'number'
  OR p_payment->'amount_refunded' IS DISTINCT FROM '0'::jsonb
  OR (p_payment->'metadata') ? 'quote_version' OR (p_payment->'metadata') ? 'intent_id'
  THEN RAISE EXCEPTION 'Ressource PayPlug historique invalide'; END IF;
 SELECT * INTO legacy FROM legacy_payplug_payments WHERE provider_id=p_payment->>'id';
 IF NOT FOUND THEN RAISE EXCEPTION 'Lien historique absent du registre de migration'; END IF;
 -- Lock in the same order as customer edits and dossier invalidation.
 SELECT * INTO cl FROM clients WHERE id=legacy.client_id FOR UPDATE;
 SELECT * INTO c FROM colis WHERE id=legacy.colis_id FOR UPDATE;
 SELECT * INTO legacy FROM legacy_payplug_payments WHERE provider_id=p_payment->>'id' FOR UPDATE;
 IF legacy.invalidated_at IS NOT NULL OR c.id IS NULL OR c.client_id<>legacy.client_id
  OR c.quote_version<>0 OR _legacy_payplug_quote_snapshot(c) IS DISTINCT FROM legacy.quote_snapshot
  OR EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id OR provider_id=legacy.provider_id)
  THEN RAISE EXCEPTION 'Le devis historique a changé : rapprochement requis'; END IF;
 IF p_payment->'metadata'->>'colis_id' IS DISTINCT FROM legacy.colis_id::text
  OR p_payment->'metadata'->>'colis_ref' IS DISTINCT FROM legacy.colis_ref
  OR ((p_payment->'metadata') ? 'client_id' AND p_payment->'metadata'->>'client_id' IS DISTINCT FROM legacy.client_id::text)
  OR (p_payment->>'amount')::numeric<>legacy.amount_cents
  OR lower(trim(p_payment->'billing'->>'email')) IS DISTINCT FROM legacy.billing_email
  THEN RAISE EXCEPTION 'Montant, client ou références historiques incompatibles'; END IF;
 IF c.paiement_date IS NOT NULL THEN
  IF c.paiement_montant*100<>legacy.amount_cents THEN RAISE EXCEPTION 'Montant du règlement existant incompatible'; END IF;
  IF legacy.observed_payment_date IS NOT NULL AND c.paiement_date=legacy.observed_payment_date AND c.paiement_montant=legacy.observed_payment_amount THEN
   already_paid:=true; -- Acknowledge only; never invent an additional historical ledger entry.
  ELSIF EXISTS(SELECT 1 FROM paiements WHERE provider_id=legacy.provider_id AND colis_id=c.id AND statut='confirme' AND montant*100=legacy.amount_cents) THEN
   already_paid:=true;
  ELSE RAISE EXCEPTION 'Un autre règlement existe : rapprochement requis'; END IF;
 ELSE
  IF legacy.observed_payment_date IS NOT NULL OR c.statut NOT IN ('devis_envoye','attente_paiement') THEN RAISE EXCEPTION 'État du devis historique incompatible'; END IF;
  IF p_payment->'is_live' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Un paiement PayPlug de test ne constitue pas un encaissement réel'; END IF;
  c:=_record_payment(c.id,legacy.amount_cents/100.0,'payplug',legacy.provider_id,legacy.provider_id,0);
 END IF;
 IF legacy.verified_at IS NULL THEN
  UPDATE legacy_payplug_payments SET verified_at=now(),provider_verification=p_payment WHERE provider_id=legacy.provider_id;
 END IF;
 RETURN jsonb_build_object('id',c.id,'alreadyPaid',already_paid,'legacy',true,'paymentMode',CASE WHEN p_payment->'is_live'='true'::jsonb THEN 'live' ELSE 'test' END,'financialConfirmation',p_payment->'is_live'='true'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION confirm_legacy_payplug_payment(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION confirm_legacy_payplug_payment(jsonb) TO service_role;

-- A distinct endpoint makes deployment safe: an older schema cannot accidentally
-- accept a simulated receipt while the Edge function has already been updated.
CREATE FUNCTION ack_legacy_test_payplug_payment(p_payment jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF p_payment->'is_live' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Ressource de test historique requise'; END IF;
 result:=confirm_legacy_payplug_payment(p_payment);
 IF result->'alreadyPaid' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Aucun encaissement historique à reconnaître'; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION ack_legacy_test_payplug_payment(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ack_legacy_test_payplug_payment(jsonb) TO service_role;
