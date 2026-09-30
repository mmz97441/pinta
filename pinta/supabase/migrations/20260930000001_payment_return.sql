-- A checkout return is a read-only receipt, never evidence of payment.
-- Only a hash of the 256-bit capability is persisted, scoped to one quote intent.
ALTER TABLE public.payment_intents
 ADD COLUMN return_token_hash text,
 ADD COLUMN return_token_expires_at timestamptz,
 ADD CONSTRAINT payment_intents_return_token_pair CHECK (
  (return_token_hash IS NULL AND return_token_expires_at IS NULL)
  OR (return_token_hash IS NOT NULL AND return_token_hash ~ '^[a-f0-9]{64}$' AND return_token_expires_at IS NOT NULL)
 );
CREATE UNIQUE INDEX payment_intents_return_token_unique
 ON public.payment_intents(return_token_hash) WHERE return_token_hash IS NOT NULL;

-- Service-only: the Edge endpoint verifies any legacy JWT and passes its actor.
-- Anonymous visitors must present an unexpired capability; an invalid capability
-- must never fall back to a dossier identifier or a signed-in staff session.
CREATE FUNCTION public.get_payment_return(
 p_token_hash text DEFAULT NULL, p_colis_id uuid DEFAULT NULL, p_actor_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=public,pg_temp AS $$
DECLARE
 i payment_intents; c colis; e envois; legacy legacy_payplug_payments;
 actor profiles; result_status text:='unavailable'; cents integer; live boolean;
 paid_at timestamptz; departure_date date; departed_at timestamptz; delivered_at timestamptz;
BEGIN
 IF p_token_hash IS NOT NULL THEN
  IF p_token_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Lien indisponible' USING ERRCODE='P0404'; END IF;
  SELECT * INTO i FROM payment_intents WHERE return_token_hash=p_token_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lien indisponible' USING ERRCODE='P0404'; END IF;
  IF i.return_token_expires_at IS NULL OR i.return_token_expires_at<=now() THEN
   RAISE EXCEPTION 'Ce lien a expiré' USING ERRCODE='P0410';
  END IF;
  SELECT * INTO c FROM colis WHERE id=i.colis_id;
 ELSE
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'Connexion requise' USING ERRCODE='P0401'; END IF;
  SELECT * INTO actor FROM profiles WHERE id=p_actor_id AND actif;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accès non autorisé' USING ERRCODE='P0403'; END IF;
  SELECT * INTO c FROM colis WHERE id=p_colis_id;
  -- Do not disclose whether another client's identifier exists.
  IF c.id IS NULL OR NOT (
   (actor.role='client' AND EXISTS(SELECT 1 FROM clients WHERE id=c.client_id AND user_id=actor.id))
   OR actor.role IN ('directeur','vice_directeur')
   OR (actor.role<>'client' AND EXISTS(
    SELECT 1 FROM staff_users s JOIN staff_permissions sp ON sp.staff_id=s.id
    WHERE s.auth_id=actor.id AND s.actif
     AND (sp.perm_finances_voir_total OR sp.perm_colis_envoyer_devis OR sp.perm_colis_confirmer_paiement)
   ))
  ) THEN RAISE EXCEPTION 'Accès non autorisé' USING ERRCODE='P0403'; END IF;
  -- Old links contain no intent identity: show the authenticated dossier's
  -- current quote, or its last obsolete intent when there is no replacement.
  SELECT * INTO i FROM payment_intents WHERE colis_id=c.id
   ORDER BY (quote_version=c.quote_version) DESC,quote_version DESC,created_at DESC LIMIT 1;
 END IF;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Lien indisponible' USING ERRCODE='P0404'; END IF;

 IF i.id IS NOT NULL THEN
  cents:=i.amount_cents; live:=i.provider_is_live;
  IF i.status='superseded' OR i.quote_version<>c.quote_version THEN result_status:='superseded';
  ELSIF i.status='paid' AND c.paiement_date IS NOT NULL AND c.paiement_montant*100=i.amount_cents
   AND i.currency='EUR' AND live IS NOT NULL AND EXISTS (
    SELECT 1 FROM paiements p WHERE p.provider_id=i.provider_id AND p.colis_id=c.id
     AND p.client_id=c.client_id AND p.quote_version=i.quote_version
     AND p.statut='confirme' AND p.montant*100=i.amount_cents
   ) THEN result_status:='paid'; paid_at:=c.paiement_date;
  ELSIF i.provider_cancelled_at IS NOT NULL THEN result_status:='cancelled';
  ELSIF i.status IN ('creating','pending') AND c.statut<>'annule' THEN result_status:='pending';
  END IF;
 ELSE
  -- Historical provider links require the already verified provider evidence.
  -- An old paid date alone, a browser query, or a manually entered amount is
  -- never sufficient to confirm that a PayPlug checkout succeeded.
  SELECT * INTO legacy FROM legacy_payplug_payments WHERE colis_id=c.id;
  IF legacy.provider_id IS NOT NULL THEN
   cents:=legacy.amount_cents;
   IF jsonb_typeof(legacy.provider_verification->'is_live')='boolean' THEN
    live:=(legacy.provider_verification->>'is_live')::boolean;
   END IF;
   IF legacy.invalidated_at IS NOT NULL OR c.quote_version<>0 THEN result_status:='superseded';
   ELSIF legacy.verified_at IS NOT NULL AND live IS NOT NULL AND legacy.provider_verification->'is_paid'='true'::jsonb
    AND c.paiement_date IS NOT NULL AND c.paiement_montant*100=legacy.amount_cents
    AND (EXISTS(SELECT 1 FROM paiements p WHERE p.provider_id=legacy.provider_id AND p.colis_id=c.id
      AND p.client_id=c.client_id AND p.statut='confirme' AND p.montant*100=legacy.amount_cents)
     OR (c.paiement_date=legacy.observed_payment_date AND c.paiement_montant=legacy.observed_payment_amount))
    THEN result_status:='paid'; paid_at:=c.paiement_date;
   ELSIF c.paiement_date IS NULL AND c.statut<>'annule' THEN result_status:='pending';
   END IF;
  END IF;
 END IF;

 -- An obsolete checkout must not inherit shipment promises from a newer quote.
 IF result_status='paid' THEN
 SELECT * INTO e FROM envois WHERE id=c.envoi_id;
 departed_at:=c.date_expedition; delivered_at:=c.date_livraison;
 IF e.id IS NOT NULL AND c.statut<>'annule' THEN
  IF e.departed_at IS NOT NULL AND c.date_expedition IS NOT NULL THEN departure_date:=e.date_depart;
  ELSIF e.departed_at IS NULL AND e.statut IN ('planifie','prochain','en_cours','en_preparation','pret')
   AND e.date_depart>=(now() AT TIME ZONE 'Europe/Paris')::date THEN departure_date:=e.date_depart;
  END IF;
 END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'status',result_status,'reference',c.ref,
  'amountCents',cents,'currency','EUR','paidAt',paid_at,'isLive',live,
  'shipment',jsonb_build_object('status',CASE WHEN result_status='paid' THEN c.statut::text ELSE 'unavailable' END,'departureDate',departure_date,
   'departedAt',departed_at,'deliveredAt',delivered_at));
END; $$;
REVOKE ALL ON FUNCTION public.get_payment_return(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_return(text,uuid,uuid) TO service_role;
