-- Compatibility is restricted to provider links that already exist at this migration.
-- This migration records evidence; it never marks a dossier paid or inserts a payment.
CREATE TABLE legacy_payplug_payments (
 provider_id text PRIMARY KEY CHECK(provider_id ~ '^pay_[a-zA-Z0-9]+$'),
 colis_id uuid NOT NULL UNIQUE REFERENCES colis(id),
 client_id uuid NOT NULL REFERENCES clients(id),
 colis_ref text NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents>0),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
 billing_email text NOT NULL CHECK(length(trim(billing_email))>0),
 quote_snapshot jsonb NOT NULL,
 observed_payment_date timestamptz,
 observed_payment_amount numeric(10,2),
 captured_at timestamptz NOT NULL DEFAULT now(),
 invalidated_at timestamptz,
 invalidation_reason text,
 verified_at timestamptz,
 provider_verification jsonb
);
ALTER TABLE legacy_payplug_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON legacy_payplug_payments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON legacy_payplug_payments TO service_role;

CREATE FUNCTION _legacy_payplug_quote_snapshot(c colis) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT jsonb_build_object(
  'id',c.id,'ref',c.ref,'client_id',c.client_id,'quote_version',c.quote_version,
  'payplug_payment_id',c.payplug_payment_id,'devis_snapshot',c.devis_snapshot,'devis_brouillon',c.devis_brouillon,
  'devis_transport',c.devis_transport,'devis_om',c.devis_om,'devis_omr',c.devis_omr,'devis_tva',c.devis_tva,'devis_total',c.devis_total,
  'fin_l',c.fin_l,'fin_w',c.fin_w,'fin_h',c.fin_h,'fin_p',c.fin_p,
  'dim_l',c.dim_l,'dim_w',c.dim_w,'dim_h',c.dim_h,'poids',c.poids,'dims_par_colis',c.dims_par_colis,
  'trackings',c.trackings,'trackings_detail',c.trackings_detail,'nb_colis',c.nb_colis,
  'frais_divers',c.frais_divers,'mode_paiement_pro',c.mode_paiement_pro
 )
$$;
REVOKE ALL ON FUNCTION _legacy_payplug_quote_snapshot(colis) FROM PUBLIC,anon,authenticated;

INSERT INTO legacy_payplug_payments(provider_id,colis_id,client_id,colis_ref,amount_cents,billing_email,quote_snapshot,observed_payment_date,observed_payment_amount)
 SELECT c.payplug_payment_id,c.id,c.client_id,c.ref,(c.devis_total*100)::integer,
  -- The historical creator removed '+' characters before calling PayPlug.
  lower(replace(trim(cl.email),'+','')),_legacy_payplug_quote_snapshot(c),c.paiement_date,c.paiement_montant
 FROM colis c JOIN clients cl ON cl.id=c.client_id
 WHERE c.payplug_payment_id ~ '^pay_[a-zA-Z0-9]+$' AND c.quote_version=0 AND c.devis_snapshot IS NULL
  AND NOT c.devis_brouillon AND c.devis_total>0 AND c.devis_total*100<=2147483647
  AND length(trim(coalesce(cl.email,'')))>0
  AND NOT EXISTS(SELECT 1 FROM payment_intents i WHERE i.colis_id=c.id OR i.provider_id=c.payplug_payment_id)
  AND ((c.statut IN ('devis_envoye','attente_paiement') AND c.paiement_date IS NULL AND c.paiement_montant IS NULL)
    OR (c.statut IN ('paye','expedie','transit','dedouanement','arrive','livraison','livre') AND c.paiement_date IS NOT NULL AND c.paiement_montant=c.devis_total));

CREATE FUNCTION guard_legacy_payplug_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Le registre PayPlug historique est fermé après migration'; END IF;
 IF (to_jsonb(NEW)-ARRAY['invalidated_at','invalidation_reason','verified_at','provider_verification']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['invalidated_at','invalidation_reason','verified_at','provider_verification']) THEN RAISE EXCEPTION 'Les références historiques sont immuables'; END IF;
 IF OLD.invalidated_at IS NOT NULL AND (NEW.invalidated_at,NEW.invalidation_reason) IS DISTINCT FROM (OLD.invalidated_at,OLD.invalidation_reason) THEN RAISE EXCEPTION 'Un lien historique invalidé ne peut plus être réactivé'; END IF;
 IF OLD.verified_at IS NOT NULL AND (NEW.verified_at,NEW.provider_verification) IS DISTINCT FROM (OLD.verified_at,OLD.provider_verification) THEN RAISE EXCEPTION 'La première vérification fournisseur est immuable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_legacy_payplug_snapshot BEFORE INSERT OR UPDATE OR DELETE ON legacy_payplug_payments FOR EACH ROW EXECUTE FUNCTION guard_legacy_payplug_snapshot();

CREATE FUNCTION invalidate_legacy_payplug() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='colis' THEN
  IF _legacy_payplug_quote_snapshot(NEW) IS DISTINCT FROM _legacy_payplug_quote_snapshot(OLD)
     OR (NEW.statut IS DISTINCT FROM OLD.statut AND NEW.statut IN ('annule','en_preparation','refuse_client','receptionne','mesure','attente_feu_vert','autorise')) THEN
   UPDATE legacy_payplug_payments SET invalidated_at=now(),invalidation_reason='Dossier ou devis modifié après migration' WHERE colis_id=NEW.id AND invalidated_at IS NULL;
  END IF;
 ELSIF (NEW.cp,NEW.type) IS DISTINCT FROM (OLD.cp,OLD.type) THEN
  UPDATE legacy_payplug_payments SET invalidated_at=now(),invalidation_reason='Destination ou type du client modifié après migration' WHERE client_id=NEW.id AND invalidated_at IS NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER invalidate_legacy_payplug AFTER UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION invalidate_legacy_payplug();
CREATE TRIGGER invalidate_legacy_payplug_client AFTER UPDATE OF cp,type ON clients FOR EACH ROW EXECUTE FUNCTION invalidate_legacy_payplug();

-- Moving a document used to invalidate only NEW.colis_id, leaving its old quote alive.
-- No application workflow moves these records; corrections use a new upload/article.
CREATE FUNCTION guard_document_dossier_reassignment() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.colis_id IS DISTINCT FROM OLD.colis_id THEN RAISE EXCEPTION 'Une facture ou un article ne peut pas changer de dossier'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_document_dossier_reassignment BEFORE UPDATE OF colis_id ON factures FOR EACH ROW EXECUTE FUNCTION guard_document_dossier_reassignment();
CREATE TRIGGER guard_document_dossier_reassignment BEFORE UPDATE OF colis_id ON lignes FOR EACH ROW EXECUTE FUNCTION guard_document_dossier_reassignment();

CREATE FUNCTION confirm_legacy_payplug_payment(p_payment jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
  c:=_record_payment(c.id,legacy.amount_cents/100.0,'payplug',legacy.provider_id,legacy.provider_id,0);
 END IF;
 IF legacy.verified_at IS NULL THEN
  UPDATE legacy_payplug_payments SET verified_at=now(),provider_verification=p_payment WHERE provider_id=legacy.provider_id;
 END IF;
 RETURN jsonb_build_object('id',c.id,'alreadyPaid',already_paid,'legacy',true);
END; $$;
REVOKE ALL ON FUNCTION confirm_legacy_payplug_payment(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION confirm_legacy_payplug_payment(jsonb) TO service_role;
