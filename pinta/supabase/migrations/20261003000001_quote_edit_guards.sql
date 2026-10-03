-- Financial edits and payment reservation share the dossier row lock. No data
-- rewrite, provider call, mode change, payment confirmation or notification.
CREATE FUNCTION _assert_unpaid_dossier(p_colis_id uuid) RETURNS colis
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable.' USING ERRCODE='22023'; END IF;
 IF c.archive OR c.statut NOT IN ('receptionne','mesure','attente_feu_vert','autorise','refuse_client','en_preparation','devis_envoye','attente_paiement')
  OR c.paiement_date IS NOT NULL OR c.paiement_montant IS NOT NULL OR c.date_expedition IS NOT NULL
  OR EXISTS(SELECT 1 FROM paiements WHERE colis_id=c.id AND statut='confirme')
  OR EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status='paid')
  OR EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND (observed_payment_date IS NOT NULL OR observed_payment_amount IS NOT NULL))
  OR EXISTS(SELECT 1 FROM envois WHERE id=c.envoi_id AND (departed_at IS NOT NULL OR manifest_version>0)) THEN
  RAISE EXCEPTION 'Un paiement ou un départ est enregistré, ou le dossier est fermé. Les mesures et le devis sont en lecture seule.' USING ERRCODE='22023';
 END IF;
 RETURN c;
END; $$;
REVOKE ALL ON FUNCTION _assert_unpaid_dossier(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION _assert_quote_editable(p_colis_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis;
BEGIN
 c:=_assert_unpaid_dossier(p_colis_id);
 IF EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status='creating') THEN
  RAISE EXCEPTION 'Un lien de paiement est en cours de création. Vérifiez son état avant de modifier le dossier.' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND provider_cancelled_at IS NULL AND (provider_id IS NOT NULL OR payment_url IS NOT NULL OR status='pending'))
  OR EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND provider_cancelled_at IS NULL)
  OR (c.payplug_payment_url IS NOT NULL AND c.payplug_payment_id IS NULL)
  OR (c.payplug_payment_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND provider_id=c.payplug_payment_id AND provider_cancelled_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND provider_id=c.payplug_payment_id AND provider_cancelled_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'Utilisez Modifier pour annuler d’abord le lien de paiement, puis corriger le dossier.' USING ERRCODE='22023';
 END IF;
END; $$;
REVOKE ALL ON FUNCTION _assert_quote_editable(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve command-specific permissions, colleague ownership, CAS, calculations
-- and audit. Insert before the SELECT so its existing FOUND check stays intact.
DO $$
DECLARE signature text; definition text; anchor text:=' SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'save_preparation_measurements(uuid,jsonb,timestamp with time zone,integer)',
  'save_quote_customs(uuid,jsonb,timestamp with time zone)',
  'save_quote(uuid,jsonb,timestamp with time zone)'
 ] LOOP
  definition:=pg_get_functiondef(('public.'||signature)::regprocedure);
  IF position('_assert_staff_task_owner(' IN definition)=0 OR position('_assert_quote_editable(' IN definition)>0
   OR (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
   RAISE EXCEPTION 'Unexpected definition for financial edit guard: %',signature;
  END IF;
  EXECUTE replace(definition,anchor,' PERFORM _assert_quote_editable(p_colis_id);'||E'\n'||anchor);
 END LOOP;
END; $$;

-- Called only by the authenticated, permission-checked checkout Edge function.
-- Hold dossier -> intent locks, matching correction and payment confirmation.
-- A correction that commits first changes the quote version; a reservation that
-- commits first leaves creating, which corrections must never invalidate.
CREATE FUNCTION reserve_payplug_intent(
 p_colis_id uuid,p_quote_version integer,p_amount_cents integer,p_is_live boolean,
 p_return_token_hash text,p_return_token_expires_at timestamptz
) RETURNS payment_intents LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; i payment_intents;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service de paiement requis.' USING ERRCODE='42501'; END IF;
 c:=_assert_unpaid_dossier(p_colis_id);
 IF c.statut NOT IN ('en_preparation','devis_envoye','attente_paiement') OR c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert OR c.produit_interdit
  OR NOT preparation_measurements_ready(c) OR c.devis_total IS NULL OR c.devis_total<=0
  OR p_quote_version IS NULL OR p_quote_version<1 OR c.quote_version IS DISTINCT FROM p_quote_version
  OR p_amount_cents IS NULL OR p_amount_cents<=0 OR round(c.devis_total*100)::bigint<>p_amount_cents THEN
  RAISE EXCEPTION 'Le devis a changé. Actualisez le dossier avant de créer le lien de paiement.' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM clients WHERE id=c.client_id AND type='pro') THEN RAISE EXCEPTION 'Le règlement professionnel se confirme depuis le dossier.' USING ERRCODE='22023'; END IF;
 IF p_is_live IS NULL OR p_return_token_hash IS NULL OR p_return_token_hash !~ '^[0-9a-f]{64}$'
  OR p_return_token_expires_at IS NULL OR p_return_token_expires_at<=now() OR p_return_token_expires_at>now()+interval '91 days' THEN
  RAISE EXCEPTION 'Paramètres du retour de paiement invalides.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO i FROM payment_intents WHERE colis_id=c.id AND quote_version=c.quote_version FOR UPDATE;
 IF FOUND THEN
  IF i.provider_is_live IS DISTINCT FROM p_is_live THEN RAISE EXCEPTION 'Le mode de l’ancien lien doit être vérifié. Établissez une nouvelle version du devis.' USING ERRCODE='22023'; END IF;
  IF i.status='pending' AND i.provider_id IS NOT NULL AND i.payment_url LIKE 'https://%' AND i.provider_cancelled_at IS NULL
   AND i.amount_cents=p_amount_cents AND i.currency='EUR' THEN RETURN i; END IF;
  IF i.status<>'failed' OR i.provider_id IS NOT NULL OR i.payment_url IS NOT NULL OR i.provider_cancelled_at IS NOT NULL THEN
   RAISE EXCEPTION 'Un paiement pour ce devis est déjà en traitement. Vérifiez son état avant de réessayer.' USING ERRCODE='40001';
  END IF;
 END IF;
 PERFORM _assert_quote_editable(c.id);
 IF i.id IS NULL THEN
  INSERT INTO payment_intents(colis_id,quote_version,amount_cents,currency,status,provider_is_live,return_token_hash,return_token_expires_at)
   VALUES(c.id,c.quote_version,p_amount_cents,'EUR','creating',p_is_live,p_return_token_hash,p_return_token_expires_at) RETURNING * INTO i;
 ELSE
  UPDATE payment_intents SET status='creating',amount_cents=p_amount_cents,currency='EUR',updated_at=now(),
   return_token_hash=p_return_token_hash,return_token_expires_at=p_return_token_expires_at WHERE id=i.id RETURNING * INTO i;
 END IF;
 RETURN i;
END; $$;
REVOKE ALL ON FUNCTION reserve_payplug_intent(uuid,integer,integer,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION reserve_payplug_intent(uuid,integer,integer,boolean,text,timestamptz) TO service_role;
