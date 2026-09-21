-- Editing a previous task is a local draft until this explicit atomic command.
-- No correction sends a message, grants consent, or changes an EXP reference.
ALTER TABLE colis ADD COLUMN consent_request_version integer NOT NULL DEFAULT 0 CHECK(consent_request_version>=0);


ALTER TABLE payment_intents ADD COLUMN provider_cancelled_at timestamptz;
ALTER TABLE legacy_payplug_payments ADD COLUMN provider_cancelled_at timestamptz;
CREATE OR REPLACE FUNCTION guard_legacy_payplug_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Le registre PayPlug historique est fermé après migration'; END IF;
 IF (to_jsonb(NEW)-ARRAY['invalidated_at','invalidation_reason','verified_at','provider_verification','provider_cancelled_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['invalidated_at','invalidation_reason','verified_at','provider_verification','provider_cancelled_at']) THEN RAISE EXCEPTION 'Les références historiques sont immuables'; END IF;
 IF OLD.invalidated_at IS NOT NULL AND (NEW.invalidated_at,NEW.invalidation_reason) IS DISTINCT FROM (OLD.invalidated_at,OLD.invalidation_reason) THEN RAISE EXCEPTION 'Un lien historique invalidé ne peut plus être réactivé'; END IF;
 IF OLD.verified_at IS NOT NULL AND (NEW.verified_at,NEW.provider_verification) IS DISTINCT FROM (OLD.verified_at,OLD.provider_verification) THEN RAISE EXCEPTION 'La première vérification fournisseur est immuable'; END IF;
 IF NEW.provider_cancelled_at IS DISTINCT FROM OLD.provider_cancelled_at AND (current_user NOT IN ('postgres','supabase_admin') OR OLD.provider_cancelled_at IS NOT NULL) THEN RAISE EXCEPTION 'La preuve d’annulation est réservée au service et immuable'; END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION record_payplug_cancellation(p_colis_id uuid,p_provider_id text,p_payment jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; i payment_intents; l legacy_payplug_payments; stamp timestamptz:=clock_timestamp();
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service de paiement requis' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.paiement_date IS NOT NULL OR c.paiement_montant IS NOT NULL THEN RAISE EXCEPTION 'Dossier absent ou déjà payé' USING ERRCODE='22023'; END IF;
 IF p_payment->>'object' IS DISTINCT FROM 'payment' OR p_payment->>'id' IS DISTINCT FROM p_provider_id OR p_payment->'is_paid' IS DISTINCT FROM 'false'::jsonb OR p_payment#>>'{failure,code}' IS DISTINCT FROM 'aborted' OR p_payment->>'currency' IS DISTINCT FROM 'EUR' OR jsonb_typeof(p_payment->'amount') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payment->'is_live') IS DISTINCT FROM 'boolean' OR (p_payment->'amount_refunded' IS NOT NULL AND p_payment->'amount_refunded' IS DISTINCT FROM '0'::jsonb) THEN RAISE EXCEPTION 'Annulation PayPlug non prouvée' USING ERRCODE='22023'; END IF;
 SELECT * INTO i FROM payment_intents WHERE provider_id=p_provider_id AND colis_id=c.id FOR UPDATE;
 IF FOUND THEN
  IF i.status IN ('creating','paid') OR (p_payment->>'amount')::numeric<>i.amount_cents OR (p_payment->>'is_live')::boolean IS DISTINCT FROM i.provider_is_live OR p_payment#>>'{metadata,colis_id}' IS DISTINCT FROM c.id::text OR p_payment#>>'{metadata,intent_id}' IS DISTINCT FROM i.id::text OR p_payment#>>'{metadata,quote_version}' IS DISTINCT FROM i.quote_version::text THEN RAISE EXCEPTION 'Référence de l’annulation incompatible' USING ERRCODE='22023'; END IF;
  UPDATE payment_intents SET provider_cancelled_at=coalesce(provider_cancelled_at,stamp) WHERE id=i.id RETURNING provider_cancelled_at INTO stamp;
 ELSE
  SELECT * INTO l FROM legacy_payplug_payments WHERE provider_id=p_provider_id AND colis_id=c.id FOR UPDATE;
  IF NOT FOUND OR l.observed_payment_date IS NOT NULL OR l.observed_payment_amount IS NOT NULL OR (p_payment->'metadata') ? 'intent_id' OR (p_payment->'metadata') ? 'quote_version' OR (p_payment->>'amount')::numeric<>l.amount_cents OR p_payment->'is_live' IS DISTINCT FROM 'true'::jsonb OR p_payment#>>'{metadata,colis_id}' IS DISTINCT FROM c.id::text OR p_payment#>>'{metadata,colis_ref}' IS DISTINCT FROM l.colis_ref OR (p_payment#>>'{metadata,client_id}' IS NOT NULL AND p_payment#>>'{metadata,client_id}'<>l.client_id::text) OR lower(trim(p_payment#>>'{billing,email}')) IS DISTINCT FROM l.billing_email THEN RAISE EXCEPTION 'Référence historique de l’annulation incompatible' USING ERRCODE='22023'; END IF;
  UPDATE legacy_payplug_payments SET provider_cancelled_at=coalesce(provider_cancelled_at,stamp) WHERE provider_id=l.provider_id RETURNING provider_cancelled_at INTO stamp;
 END IF;
 RETURN jsonb_build_object('providerId',p_provider_id,'cancelledAt',stamp);
END; $$;
REVOKE ALL ON FUNCTION record_payplug_cancellation(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION record_payplug_cancellation(uuid,text,jsonb) TO service_role;

CREATE FUNCTION stamp_colis_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond'); RETURN NEW; END; $$;
DROP TRIGGER trg_colis_updated ON colis;
CREATE TRIGGER trg_colis_updated BEFORE UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION stamp_colis_revision();

CREATE FUNCTION guard_consent_request_version() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin') AND auth.role() IS DISTINCT FROM 'service_role' THEN
  IF TG_OP='INSERT' AND NEW.consent_request_version<>0 OR TG_OP='UPDATE' AND NEW.consent_request_version IS DISTINCT FROM OLD.consent_request_version THEN
   RAISE EXCEPTION 'La version de la demande est gérée par la commande de correction' USING ERRCODE='42501';
  END IF;
 END IF;
 -- Identity changes create a new generation, even when A later becomes A again.
 IF TG_OP='UPDATE' AND (NEW.nb_colis,NEW.trackings,NEW.trackings_detail) IS DISTINCT FROM (OLD.nb_colis,OLD.trackings,OLD.trackings_detail) THEN
  NEW.consent_request_version:=OLD.consent_request_version+1;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER aa_guard_consent_request_version BEFORE INSERT OR UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION guard_consent_request_version();

CREATE FUNCTION stamp_consent_request_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.template IN ('demande_feu_vert','relance_feu_vert') AND NEW.type='staff' THEN
  NEW.request_snapshot:=coalesce(NEW.request_snapshot,'{}'::jsonb)||jsonb_build_object('consent_request_version',(SELECT consent_request_version FROM colis WHERE id=NEW.colis_id));
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER stamp_consent_request_version BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION stamp_consent_request_version();

CREATE FUNCTION cancel_previous_consent_requests() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.consent_request_version IS DISTINCT FROM OLD.consent_request_version THEN
  UPDATE notification_outbox o SET status='cancelled',last_error='Une nouvelle demande d’accord remplace cette version'
  FROM messages m WHERE o.message_id=m.id AND o.colis_id=NEW.id AND o.status IN ('pending','blocked','manual','failed')
   AND m.template IN ('demande_feu_vert','relance_feu_vert')
   AND coalesce(m.request_snapshot->>'consent_request_version','0')<>NEW.consent_request_version::text;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER cancel_previous_consent_requests AFTER UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION cancel_previous_consent_requests();

-- A corrected scale/ruler value does not change the physical carton set.
CREATE OR REPLACE FUNCTION invalidate_preparation_composition() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF current_user IN ('postgres','supabase_admin') AND current_setting('expedile.measure_correction',true)='reception'
  AND (NEW.nb_colis,NEW.trackings_detail,NEW.trackings) IS NOT DISTINCT FROM (OLD.nb_colis,OLD.trackings_detail,OLD.trackings) THEN RETURN NEW; END IF;
 IF (NEW.nb_colis,NEW.dims_par_colis,NEW.trackings_detail,NEW.trackings) IS DISTINCT FROM (OLD.nb_colis,OLD.dims_par_colis,OLD.trackings_detail,OLD.trackings) THEN
  IF OLD.paiement_date IS NOT NULL THEN RAISE EXCEPTION 'La composition d’un dossier payé est figée'; END IF;
  NEW.preparation_composition_version:=OLD.preparation_composition_version+1;
  NEW.final_measurements_version:=NULL; NEW.final_measurements_at:=NULL; NEW.outgoing_parcel_count:=NULL;
  NEW.devis_total:=NULL; NEW.devis_snapshot:=NULL; NEW.devis_brouillon:=true;
  NEW.payplug_payment_id:=NULL; NEW.payplug_payment_url:=NULL;
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION correct_colis_task(p_colis_id uuid,p_task text,p_values jsonb,p_expected_updated_at timestamptz,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; previous colis; boxes jsonb; old_boxes jsonb; count_boxes integer; weight numeric; longest numeric; widest numeric; highest numeric;
 permission text; changed boolean:=true; invalidated jsonb:='[]'; old_revert text; old_correction text;
BEGIN
 permission:=CASE p_task WHEN 'reception' THEN 'perm_colis_mesurer' WHEN 'preparation' THEN 'perm_colis_preparer' WHEN 'accord' THEN 'perm_colis_demander_feuvert' WHEN 'devis' THEN 'perm_colis_calculer_devis' END;
 IF permission IS NULL THEN RAISE EXCEPTION 'Tâche de correction inconnue' USING ERRCODE='22023'; END IF;
 IF NOT has_permission('perm_colis_revenir_arriere') OR NOT has_permission(permission) THEN RAISE EXCEPTION 'Droits de correction et de réalisation de cette tâche requis' USING ERRCODE='42501'; END IF;
 IF p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'Version du dossier requise' USING ERRCODE='40001'; END IF;
 IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Motif de correction requis (3 à 500 caractères)' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k<>ALL(CASE WHEN p_task IN ('reception','preparation') THEN ARRAY['boxes'] ELSE ARRAY[]::text[] END)) THEN RAISE EXCEPTION 'Valeurs de correction invalides' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable' USING ERRCODE='P0002'; END IF;
 IF c.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Le dossier a changé. Votre saisie doit être comparée à la version enregistrée.' USING ERRCODE='40001'; END IF;
 IF c.archive OR c.paiement_date IS NOT NULL OR c.paiement_montant IS NOT NULL OR c.date_expedition IS NOT NULL
  OR c.statut NOT IN ('receptionne','mesure','attente_feu_vert','autorise','refuse_client','en_preparation','devis_envoye','attente_paiement')
  OR EXISTS(SELECT 1 FROM paiements WHERE colis_id=c.id AND statut='confirme')
  OR EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status='paid')
  OR EXISTS(SELECT 1 FROM envois WHERE id=c.envoi_id AND (departed_at IS NOT NULL OR manifest_version>0)) THEN
  RAISE EXCEPTION 'Correction réservée aux dossiers ouverts, non payés et non partis' USING ERRCODE='22023';
 END IF;
 previous:=c;
 IF p_task IN ('preparation','devis') AND (c.statut NOT IN ('autorise','en_preparation','devis_envoye','attente_paiement') OR c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert OR c.produit_interdit) THEN RAISE EXCEPTION 'Accord client actuel et préparation autorisée requis' USING ERRCODE='22023'; END IF;
 IF p_task IN ('reception','preparation') THEN
  boxes:=p_values->'boxes';
  IF jsonb_typeof(boxes) IS DISTINCT FROM 'array' OR jsonb_array_length(boxes) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(boxes) WHERE NOT reception_box_measured(value) OR EXISTS(SELECT 1 FROM jsonb_object_keys(value) k WHERE k<>ALL(ARRAY['dimL','dimW','dimH','poids']))) THEN RAISE EXCEPTION 'Longueur, largeur, hauteur et poids positifs requis pour chaque colis' USING ERRCODE='22023'; END IF;
  SELECT jsonb_agg(jsonb_build_object('dimL',(value->>'dimL')::numeric,'dimW',(value->>'dimW')::numeric,'dimH',(value->>'dimH')::numeric,'poids',(value->>'poids')::numeric) ORDER BY ord) INTO boxes FROM jsonb_array_elements(boxes) WITH ORDINALITY a(value,ord);
  count_boxes:=jsonb_array_length(boxes);
  IF p_task='reception' THEN
   IF count_boxes<>reception_carton_count(c.nb_colis,c.trackings_detail,c.trackings,c.dims_par_colis) THEN RAISE EXCEPTION 'La correction conserve les mêmes cartons. Utilisez la réception pour ajouter un carton.' USING ERRCODE='22023'; END IF;
   old_boxes:=CASE WHEN jsonb_typeof(c.dims_par_colis)='array' AND jsonb_array_length(c.dims_par_colis)>0 THEN c.dims_par_colis ELSE jsonb_build_array(jsonb_build_object('dimL',c.dim_l,'dimW',c.dim_w,'dimH',c.dim_h,'poids',c.poids)) END;
  ELSE
   old_boxes:=coalesce(c.final_packages,jsonb_build_array(jsonb_build_object('dimL',c.fin_l,'dimW',c.fin_w,'dimH',c.fin_h,'poids',c.fin_p)));
  END IF;
  IF jsonb_typeof(old_boxes)='array' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old_boxes) WHERE NOT reception_box_measured(value)) THEN
   SELECT jsonb_agg(jsonb_build_object('dimL',(value->>'dimL')::numeric,'dimW',(value->>'dimW')::numeric,'dimH',(value->>'dimH')::numeric,'poids',(value->>'poids')::numeric) ORDER BY ord) INTO old_boxes FROM jsonb_array_elements(old_boxes) WITH ORDINALITY a(value,ord);
  END IF;
  changed:=boxes IS DISTINCT FROM old_boxes OR p_task='preparation' AND (c.final_measurements_version IS DISTINCT FROM c.preparation_composition_version OR c.outgoing_parcel_count IS DISTINCT FROM count_boxes OR c.final_measurements_at IS NULL);
  SELECT sum((value->>'poids')::numeric),max((value->>'dimL')::numeric),max((value->>'dimW')::numeric),max((value->>'dimH')::numeric) INTO weight,longest,widest,highest FROM jsonb_array_elements(boxes);
 ELSIF p_task='devis' THEN
  changed:=c.devis_total IS NOT NULL OR c.devis_snapshot->'inputs' IS NOT NULL OR c.payplug_payment_id IS NOT NULL OR c.payplug_payment_url IS NOT NULL OR c.statut IN ('devis_envoye','attente_paiement');
 ELSE
  changed:=c.statut NOT IN ('receptionne','mesure') OR c.feu_vert IS DISTINCT FROM 'en_attente'::statut_feu_vert OR c.feu_vert_date IS NOT NULL OR c.attente_client_date IS NOT NULL OR c.demande_feu_vert_envoyee_at IS NOT NULL;
 END IF;
 IF NOT changed THEN RETURN jsonb_build_object('colis',to_jsonb(c),'changed',false,'invalidated','[]'::jsonb); END IF;
 IF EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status='creating') THEN RAISE EXCEPTION 'Un lien de paiement est en cours de création. Réessayez après sa création.' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND provider_id IS NOT NULL AND provider_cancelled_at IS NULL)
 OR EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND provider_cancelled_at IS NULL)
 OR (c.payplug_payment_url IS NOT NULL AND c.payplug_payment_id IS NULL)
 OR (c.payplug_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND provider_id=c.payplug_payment_id AND provider_cancelled_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND provider_id=c.payplug_payment_id AND provider_cancelled_at IS NOT NULL)) THEN RAISE EXCEPTION 'Annulez d’abord le lien de paiement auprès du fournisseur avant de corriger ce dossier.' USING ERRCODE='22023'; END IF;
 IF c.devis_total>0 THEN
  INSERT INTO quote_versions(colis_id,version,snapshot,total,created_by) VALUES(c.id,c.quote_version,coalesce(c.devis_snapshot,to_jsonb(c)),c.devis_total,auth.uid()) ON CONFLICT(colis_id,version) DO NOTHING;
 END IF;
 IF c.devis_total IS NOT NULL OR c.devis_snapshot->'inputs' IS NOT NULL OR c.statut IN ('devis_envoye','attente_paiement') THEN invalidated:=invalidated||'"devis"'::jsonb; END IF;
 IF c.payplug_payment_id IS NOT NULL OR c.payplug_payment_url IS NOT NULL OR EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status IN ('creating','pending')) THEN invalidated:=invalidated||'"paiement"'::jsonb; END IF;
 IF p_task='accord' THEN invalidated:=invalidated||'"accord"'::jsonb; END IF;
 old_revert:=current_setting('expedile.revert',true);old_correction:=current_setting('expedile.measure_correction',true);
 PERFORM set_config('expedile.revert','allowed',true);
 PERFORM set_config('expedile.measure_correction',CASE WHEN p_task='reception' THEN 'reception' ELSE '' END,true);
 UPDATE colis SET
  dims_par_colis=CASE WHEN p_task='reception' THEN boxes ELSE dims_par_colis END,
  dim_l=CASE WHEN p_task='reception' THEN longest ELSE dim_l END,dim_w=CASE WHEN p_task='reception' THEN widest ELSE dim_w END,dim_h=CASE WHEN p_task='reception' THEN highest ELSE dim_h END,poids=CASE WHEN p_task='reception' THEN weight ELSE poids END,
  final_packages=CASE WHEN p_task='preparation' THEN boxes ELSE final_packages END,
  fin_l=CASE WHEN p_task='preparation' THEN longest ELSE fin_l END,fin_w=CASE WHEN p_task='preparation' THEN widest ELSE fin_w END,fin_h=CASE WHEN p_task='preparation' THEN highest ELSE fin_h END,fin_p=CASE WHEN p_task='preparation' THEN weight ELSE fin_p END,
  outgoing_parcel_count=CASE WHEN p_task='preparation' THEN count_boxes ELSE outgoing_parcel_count END,
  final_measurements_version=CASE WHEN p_task='preparation' THEN preparation_composition_version ELSE final_measurements_version END,
  final_measurements_at=CASE WHEN p_task='preparation' THEN clock_timestamp() ELSE final_measurements_at END,
  statut=CASE WHEN p_task='accord' THEN CASE WHEN (reception_carton_count(nb_colis,trackings_detail,trackings,dims_par_colis)=1 AND (dims_par_colis IS NULL OR dims_par_colis='[]'::jsonb) AND reception_box_measured(jsonb_build_object('dimL',dim_l,'dimW',dim_w,'dimH',dim_h,'poids',poids))) OR reception_carton_count(nb_colis,trackings_detail,trackings,dims_par_colis)=coalesce(jsonb_array_length(dims_par_colis),0) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(dims_par_colis,'[]')) WHERE NOT reception_box_measured(value)) THEN 'mesure'::statut_colis ELSE 'receptionne'::statut_colis END
   WHEN p_task IN ('preparation','devis') OR statut IN ('devis_envoye','attente_paiement') THEN 'en_preparation'::statut_colis WHEN p_task='reception' AND statut='receptionne' THEN 'mesure'::statut_colis ELSE statut END,
  feu_vert=CASE WHEN p_task='accord' THEN 'en_attente'::statut_feu_vert ELSE feu_vert END,
  feu_vert_date=CASE WHEN p_task='accord' THEN NULL ELSE feu_vert_date END,
  attente_client_date=CASE WHEN p_task='accord' THEN NULL ELSE attente_client_date END,attente_client_motif=CASE WHEN p_task='accord' THEN NULL ELSE attente_client_motif END,attente_client_until=CASE WHEN p_task='accord' THEN NULL ELSE attente_client_until END,
  demande_feu_vert_envoyee_at=CASE WHEN p_task='accord' THEN NULL ELSE demande_feu_vert_envoyee_at END,
  consent_request_version=consent_request_version+CASE WHEN p_task='accord' THEN 1 ELSE 0 END,
  devis_total=NULL,devis_snapshot=NULL,devis_brouillon=true,payplug_payment_id=NULL,payplug_payment_url=NULL
 WHERE id=c.id RETURNING * INTO c;
 PERFORM set_config('expedile.revert',coalesce(old_revert,''),true);PERFORM set_config('expedile.measure_correction',coalesce(old_correction,''),true);
 UPDATE payment_intents SET status='superseded',updated_at=clock_timestamp() WHERE colis_id=c.id AND status IN ('creating','pending');
 UPDATE notification_outbox o SET status='cancelled',last_error='Le devis a été retiré pour correction' FROM messages m
 WHERE o.message_id=m.id AND o.colis_id=c.id AND o.status IN ('pending','blocked','manual','failed') AND m.template IN ('devis_final','relance_paiement');
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,before_data,after_data) VALUES(c.id,auth.uid(),coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),(SELECT nom FROM staff_users WHERE auth_id=auth.uid()),'Équipe'),'correction_'||p_task,trim(p_reason),to_jsonb(previous),to_jsonb(c));
 RETURN jsonb_build_object('colis',to_jsonb(c),'changed',true,'invalidated',invalidated,'retiredPaymentId',previous.payplug_payment_id);
END; $$;
REVOKE ALL ON FUNCTION correct_colis_task(uuid,text,jsonb,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION correct_colis_task(uuid,text,jsonb,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION telegram_client_decision(p_colis_id uuid,p_action text,p_chat_id text,p_message_id text) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; snap jsonb;
BEGIN
 SELECT c1.* INTO c FROM colis c1 JOIN clients cl ON cl.id=c1.client_id WHERE c1.id=p_colis_id AND cl.telegram_chat_id=p_chat_id FOR UPDATE OF c1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ce dossier ne correspond pas à votre compte'; END IF;
 SELECT request_snapshot INTO snap FROM messages WHERE colis_id=c.id AND telegram_msg_id=p_message_id AND template IN ('demande_feu_vert','relance_feu_vert') ORDER BY created_at DESC LIMIT 1;
 IF snap IS NULL OR jsonb_build_object('trackings',snap->'trackings','trackings_detail',snap->'trackings_detail','nb_colis',snap->'nb_colis') IS DISTINCT FROM jsonb_build_object('trackings',c.trackings,'trackings_detail',c.trackings_detail,'nb_colis',c.nb_colis)
  OR coalesce(snap->>'consent_request_version','0')<>c.consent_request_version::text THEN RAISE EXCEPTION 'Cette demande a été remplacée. Utilisez la nouvelle demande de préparation.' USING ERRCODE='40001'; END IF;
 RETURN _apply_client_decision(c.id,p_action,c.updated_at,NULL,NULL,'Client (Telegram)');
END; $$;

CREATE OR REPLACE FUNCTION client_decision(p_colis_id uuid,p_action text,p_expected_updated_at timestamptz DEFAULT NULL,p_wait_until timestamptz DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; result jsonb;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id AND (client_id=auth_client_id() OR has_permission('perm_colis_valider_feuvert')) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Accès refusé'; END IF;
 IF p_expected_updated_at IS NULL AND c.consent_request_version>0 THEN RAISE EXCEPTION 'Rechargez la nouvelle demande avant de répondre.' USING ERRCODE='40001'; END IF;
 c:=_apply_client_decision(p_colis_id,p_action,p_expected_updated_at,p_wait_until,p_reason,coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),'Client'));
 IF is_staff() THEN RETURN to_jsonb(c); END IF;
 SELECT to_jsonb(v) INTO result FROM client_colis v WHERE id=c.id; RETURN result;
END; $$;

-- Lock in the same order as corrections, and never book a superseded payment.
CREATE OR REPLACE FUNCTION confirm_payplug_payment(p_provider_id text,p_colis_id uuid,p_quote_version integer,p_amount_cents integer,p_currency text) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE intent payment_intents; c colis;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 SELECT * INTO intent FROM payment_intents WHERE provider_id=p_provider_id FOR UPDATE;
 IF NOT FOUND OR intent.colis_id<>p_colis_id OR intent.quote_version<>p_quote_version OR intent.amount_cents<>p_amount_cents OR intent.currency<>p_currency OR p_currency<>'EUR' THEN RAISE EXCEPTION 'Référence de paiement incohérente'; END IF;
 IF intent.status='superseded' THEN RAISE EXCEPTION 'Paiement d’un devis retiré : rapprochement nécessaire' USING ERRCODE='22023'; END IF;
 c:=_record_payment(p_colis_id,p_amount_cents/100.0,'payplug',p_provider_id,p_provider_id,p_quote_version);
 UPDATE payment_intents SET status='paid',updated_at=now() WHERE id=intent.id;
 RETURN c;
END; $$;

CREATE OR REPLACE FUNCTION save_preparation_measurements(p_colis_id uuid,p_final_packages jsonb,p_expected_updated_at timestamptz,p_expected_composition_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; real_weight numeric; max_l numeric; max_w numeric; max_h numeric;
BEGIN
 IF NOT has_permission('perm_colis_preparer') THEN RAISE EXCEPTION 'Permission préparation requise' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.statut NOT IN ('en_preparation','devis_envoye','attente_paiement') OR c.paiement_date IS NOT NULL OR c.archive OR c.produit_interdit OR c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN RAISE EXCEPTION 'Un dossier autorisé et impayé, non archivé et sans produit interdit, en préparation est requis'; END IF;
 IF p_expected_updated_at IS NULL OR p_expected_composition_version IS NULL OR c.updated_at IS DISTINCT FROM p_expected_updated_at OR c.preparation_composition_version IS DISTINCT FROM p_expected_composition_version THEN
  RAISE EXCEPTION 'Le dossier ou ses cartons ont changé. Reprenez la version enregistrée avant de sauvegarder.' USING ERRCODE='40001';
 END IF;
 IF c.devis_total IS NOT NULL OR c.devis_snapshot->'inputs' IS NOT NULL OR c.payplug_payment_id IS NOT NULL OR c.payplug_payment_url IS NOT NULL OR EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status IN ('creating','pending')) THEN RAISE EXCEPTION 'Utilisez la correction de préparation pour modifier les mesures après enregistrement du devis.' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_final_packages) IS DISTINCT FROM 'array' OR jsonb_array_length(p_final_packages) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_final_packages) WHERE NOT reception_box_measured(value)) THEN RAISE EXCEPTION 'Mesurez longueur, largeur, hauteur et poids positifs de chaque colis sortant'; END IF;
 SELECT jsonb_agg(jsonb_build_object('dimL',(value->>'dimL')::numeric,'dimW',(value->>'dimW')::numeric,'dimH',(value->>'dimH')::numeric,'poids',(value->>'poids')::numeric) ORDER BY position) INTO p_final_packages FROM jsonb_array_elements(p_final_packages) WITH ORDINALITY AS boxes(value,position);
 SELECT sum((value->>'poids')::numeric),max((value->>'dimL')::numeric),max((value->>'dimW')::numeric),max((value->>'dimH')::numeric) INTO real_weight,max_l,max_w,max_h FROM jsonb_array_elements(p_final_packages);
 UPDATE colis SET final_packages=p_final_packages,fin_l=max_l,fin_w=max_w,fin_h=max_h,fin_p=real_weight,
  outgoing_parcel_count=jsonb_array_length(p_final_packages),final_measurements_version=preparation_composition_version,final_measurements_at=now(),
  devis_total=NULL,devis_snapshot=NULL,devis_brouillon=true,payplug_payment_id=NULL,payplug_payment_url=NULL,
  statut=CASE WHEN statut IN ('devis_envoye','attente_paiement') THEN 'en_preparation'::statut_colis ELSE statut END
 WHERE id=c.id RETURNING * INTO c;
 RETURN jsonb_build_object('colis',to_jsonb(c));
END; $$;

CREATE OR REPLACE FUNCTION revert_colis(p_colis_id uuid,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; target statut_colis;
BEGIN
 IF NOT has_permission('perm_colis_revenir_arriere') THEN RAISE EXCEPTION 'Permission correction requise'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable'; END IF;
 IF p_expected_updated_at IS NOT NULL AND c.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'Le dossier a changé. Rechargez-le.'; END IF;
 IF c.statut NOT IN ('expedie','transit','dedouanement','arrive','livraison') THEN RAISE EXCEPTION 'Utilisez la correction ciblée de la tâche pour reprendre un dossier avant départ.' USING ERRCODE='22023'; END IF;
 target:=(CASE c.statut::text WHEN 'mesure' THEN 'receptionne' WHEN 'attente_feu_vert' THEN 'mesure' WHEN 'autorise' THEN 'attente_feu_vert' WHEN 'en_preparation' THEN 'autorise' WHEN 'devis_envoye' THEN 'en_preparation' WHEN 'attente_paiement' THEN 'devis_envoye' WHEN 'expedie' THEN 'paye' WHEN 'transit' THEN 'expedie' WHEN 'dedouanement' THEN 'transit' WHEN 'arrive' THEN 'dedouanement' WHEN 'livraison' THEN 'arrive' ELSE NULL END)::statut_colis;
 IF target IS NULL THEN RAISE EXCEPTION 'Ce statut ne permet pas de retour arrière'; END IF;
 PERFORM set_config('expedile.revert','allowed',true);
 UPDATE colis SET statut=target,
  devis_total=CASE WHEN target IN ('receptionne','mesure','attente_feu_vert','autorise','en_preparation') THEN NULL ELSE devis_total END,
  devis_snapshot=CASE WHEN target IN ('receptionne','mesure','attente_feu_vert','autorise','en_preparation') THEN NULL ELSE devis_snapshot END,
  feu_vert=CASE WHEN target IN ('receptionne','mesure','attente_feu_vert') THEN 'en_attente'::statut_feu_vert ELSE feu_vert END
 WHERE id=c.id RETURNING * INTO c;
 PERFORM set_config('expedile.revert','',true);
 INSERT INTO audit_actions(colis_id,user_id,action,detail) VALUES(c.id,auth.uid(),'correction_statut','Retour contrôlé vers '||target::text);
 RETURN c;
END; $$;

DROP FUNCTION queue_message(uuid,text,text,text,jsonb,text);
CREATE FUNCTION queue_message(p_colis_id uuid,p_text text,p_template text DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_reply_markup jsonb DEFAULT NULL,p_canal text DEFAULT 'telegram',p_expected_consent_version integer DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; cl clients; m messages; ob notification_outbox; snap jsonb; invoice_requested boolean;
BEGIN
 IF auth.role()<>'service_role' AND NOT has_permission(CASE WHEN p_canal='email' THEN 'perm_comm_email' WHEN p_canal='portal' THEN 'perm_comm_message_libre' ELSE 'perm_comm_telegram' END) THEN RAISE EXCEPTION 'Permission communication requise'; END IF;
 IF p_canal NOT IN ('telegram','email','portal') OR length(trim(p_text))=0 OR length(p_text)>4096 THEN RAISE EXCEPTION 'Message invalide (1 à 4096 caractères)'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Colis introuvable'; END IF;
 SELECT * INTO cl FROM clients WHERE id=c.client_id;
 IF p_canal='portal' AND cl.user_id IS NULL THEN RAISE EXCEPTION 'Activez l’accès client avant d’envoyer un message dans son espace' USING ERRCODE='22023'; END IF;
 IF p_canal='telegram' AND cl.telegram_chat_id IS NULL THEN RAISE EXCEPTION 'Telegram doit être lié au compte client'; END IF;
 IF p_template IN ('demande_feu_vert','relance_feu_vert') AND ((p_expected_consent_version IS NULL AND c.consent_request_version>0) OR (p_expected_consent_version IS NOT NULL AND p_expected_consent_version<>c.consent_request_version)) THEN RAISE EXCEPTION 'La demande a changé. Préparez un nouvel aperçu avant de l’envoyer.' USING ERRCODE='40001'; END IF;
 IF p_idempotency_key IS NOT NULL THEN
  SELECT * INTO ob FROM notification_outbox WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN SELECT * INTO m FROM messages WHERE id=ob.message_id; IF m.colis_id<>c.id OR (p_template IN ('demande_feu_vert','relance_feu_vert') AND coalesce(m.request_snapshot->>'consent_request_version','0')<>c.consent_request_version::text) THEN RAISE EXCEPTION 'Cette clé désigne une ancienne demande.' USING ERRCODE='40001'; END IF; RETURN jsonb_build_object('message',to_jsonb(m),'outbox',to_jsonb(ob)); END IF;
 END IF;
 IF p_template IN ('demande_feu_vert','relance_feu_vert') THEN
  snap:=jsonb_build_object('trackings',c.trackings,'trackings_detail',c.trackings_detail,'nb_colis',c.nb_colis);
  IF p_template='demande_feu_vert' THEN
   WITH current_invoices AS (
    SELECT f.* FROM factures f WHERE f.colis_id=c.id AND f.duplicate_of_facture_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)
   )
   SELECT NOT EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NULL)
     OR EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NOT NULL)
   INTO invoice_requested;
   snap:=snap||jsonb_build_object('invoice_requested',invoice_requested);
  END IF;
 END IF;
 INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,statut,canal,template,request_snapshot)
 VALUES(c.id,'staff',auth.uid(),coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),'Expedîle'),p_text,
 CASE WHEN p_canal='portal' THEN 'envoye'::statut_message ELSE 'envoi'::statut_message END,p_canal,p_template,snap) RETURNING * INTO m;
 INSERT INTO notification_outbox(message_id,client_id,colis_id,quote_version,canal,reply_markup,idempotency_key,status)
 VALUES(m.id,cl.id,c.id,c.quote_version,p_canal,p_reply_markup,p_idempotency_key,CASE p_canal WHEN 'email' THEN 'manual' WHEN 'portal' THEN 'sent' ELSE 'pending' END) RETURNING * INTO ob;
 IF cl.user_id IS NOT NULL THEN INSERT INTO notifications(user_id,titre,msg,colis_id,type) VALUES(cl.user_id,'Un message pour '||c.ref,p_text,c.id,'message'); END IF;
 RETURN jsonb_build_object('message',to_jsonb(m),'outbox',to_jsonb(ob));
END; $$;


REVOKE ALL ON FUNCTION queue_message(uuid,text,text,text,jsonb,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION queue_message(uuid,text,text,text,jsonb,text,integer) TO authenticated,service_role;

CREATE OR REPLACE VIEW client_colis WITH (security_barrier=true) AS
 SELECT id,client_id,ref,statut,desc_contenu,valeur_declaree,trackings,trackings_detail,date_reception,
 dim_l,dim_w,dim_h,poids,nb_colis,dims_par_colis,fin_l,fin_w,fin_h,fin_p,poids_facturable,feu_vert,feu_vert_date,
 attente_client_motif,attente_client_date,attente_client_until,est_min,est_max,devis_brouillon,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_transport END AS devis_transport,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_om END AS devis_om,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_omr END AS devis_omr,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_tva END AS devis_tva,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_total END AS devis_total,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN avant_optim_transport END AS avant_optim_transport,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN avant_optim_total END AS avant_optim_total,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN economie END AS economie,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN devis_snapshot END AS devis_snapshot,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN payplug_payment_url END AS payplug_payment_url,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN frais_divers ELSE '[]'::jsonb END AS frais_divers,
 CASE WHEN NOT devis_brouillon AND devis_envoye_le IS NOT NULL THEN mode_paiement_pro END AS mode_paiement_pro,
 quote_version,devis_envoye_le,paiement_montant,paiement_date,envoi_id,date_expedition,date_livraison,photo_reception_url,photo_prep,archive,created_at,updated_at,
 statut_updated_at,conversation_statut,conversation_version,conversation_updated_at,conversation_opened_at,conversation_resolved_at,demande_feu_vert_envoyee_at,
 final_packages,final_measurements_at,final_measurements_version,preparation_composition_version,outgoing_parcel_count,consent_request_version
 FROM colis WHERE client_id=auth_client_id();
