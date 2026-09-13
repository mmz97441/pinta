-- All commands are transactional; PUBLIC execution of sensitive helpers is revoked below.
CREATE OR REPLACE FUNCTION fn_valider_transition_statut() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE allowed text[];
BEGIN
 IF OLD.statut=NEW.statut THEN RETURN NEW; END IF;
 IF current_user IN ('postgres','supabase_admin') AND current_setting('expedile.revert',true)='allowed' THEN RETURN NEW; END IF;
 IF NEW.statut='receptionne' AND OLD.statut IN ('mesure','attente_feu_vert','autorise') AND (NEW.trackings,NEW.nb_colis,NEW.trackings_detail) IS DISTINCT FROM (OLD.trackings,OLD.nb_colis,OLD.trackings_detail) AND NEW.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert AND (has_permission('perm_colis_receptionner') OR auth.role()='service_role') THEN RETURN NEW; END IF;
 IF NEW.statut='annule' AND OLD.statut NOT IN ('livre','annule') THEN RETURN NEW; END IF;
 allowed:=CASE OLD.statut::text
 WHEN 'receptionne' THEN ARRAY['mesure','attente_feu_vert'] WHEN 'mesure' THEN ARRAY['attente_feu_vert']
 WHEN 'attente_feu_vert' THEN ARRAY['autorise','refuse_client'] WHEN 'refuse_client' THEN ARRAY['attente_feu_vert']
 WHEN 'autorise' THEN ARRAY['en_preparation'] WHEN 'en_preparation' THEN ARRAY['devis_envoye']
 WHEN 'devis_envoye' THEN ARRAY['attente_paiement','paye','en_preparation'] WHEN 'attente_paiement' THEN ARRAY['paye','en_preparation']
 WHEN 'paye' THEN ARRAY['expedie'] WHEN 'expedie' THEN ARRAY['transit'] WHEN 'transit' THEN ARRAY['dedouanement','arrive']
 WHEN 'dedouanement' THEN ARRAY['arrive'] WHEN 'arrive' THEN ARRAY['livraison'] WHEN 'livraison' THEN ARRAY['livre'] ELSE ARRAY[]::text[] END;
 IF NOT NEW.statut::text=ANY(allowed) THEN RAISE EXCEPTION 'Transition invalide : % → %',OLD.statut,NEW.statut; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION acquire_colis_lock(p_colis_id uuid) RETURNS colis_locks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result colis_locks;
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Accès équipe requis'; END IF;
 INSERT INTO colis_locks(colis_id,staff_id,staff_nom) SELECT p_colis_id,id,concat_ws(' ',prenom,nom) FROM profiles WHERE id=auth.uid()
 ON CONFLICT(colis_id) DO UPDATE SET staff_id=excluded.staff_id,staff_nom=excluded.staff_nom,locked_at=now()
 WHERE colis_locks.staff_id=auth.uid() OR colis_locks.locked_at<now()-interval '5 minutes';
 SELECT * INTO result FROM colis_locks WHERE colis_id=p_colis_id; RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION release_colis_lock(p_colis_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ DELETE FROM colis_locks WHERE colis_id=p_colis_id AND staff_id=auth.uid(); $$;

CREATE OR REPLACE FUNCTION create_telegram_invitation(p_client_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''); exp timestamptz:=now()+interval '24 hours';
BEGIN
 IF NOT(is_staff() OR p_client_id=auth_client_id()) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
 IF NOT EXISTS(SELECT 1 FROM clients WHERE id=p_client_id) THEN RAISE EXCEPTION 'Client introuvable'; END IF;
 UPDATE telegram_invitations SET used_at=now() WHERE client_id=p_client_id AND used_at IS NULL;
 INSERT INTO telegram_invitations(token,client_id,expires_at,created_by) VALUES(t,p_client_id,exp,auth.uid());
 RETURN jsonb_build_object('token',t,'expires_at',exp,'url','https://t.me/Expedilebot?start='||t);
END; $$;
CREATE OR REPLACE FUNCTION consume_telegram_invitation(p_token text,p_chat_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv telegram_invitations; cl clients;
BEGIN
 SELECT * INTO inv FROM telegram_invitations WHERE token=p_token AND used_at IS NULL AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation expirée ou déjà utilisée'; END IF;
 SELECT * INTO cl FROM clients WHERE id=inv.client_id FOR UPDATE;
 IF cl.telegram_chat_id IS NOT NULL AND cl.telegram_chat_id<>p_chat_id THEN RAISE EXCEPTION 'Un compte Telegram est déjà lié. Contactez notre équipe.'; END IF;
 IF EXISTS(SELECT 1 FROM clients WHERE telegram_chat_id=p_chat_id AND id<>cl.id) THEN RAISE EXCEPTION 'Ce compte Telegram est déjà lié'; END IF;
 UPDATE clients SET telegram_chat_id=p_chat_id WHERE id=cl.id;
 UPDATE telegram_invitations SET used_at=now() WHERE token=p_token;
 RETURN jsonb_build_object('id',cl.id,'prenom',cl.prenom,'nom',cl.nom);
END; $$;

CREATE OR REPLACE FUNCTION queue_message(p_colis_id uuid,p_text text,p_template text DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_reply_markup jsonb DEFAULT NULL,p_canal text DEFAULT 'telegram') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; cl clients; m messages; ob notification_outbox;
BEGIN
 IF auth.role()<>'service_role' AND NOT has_permission(CASE WHEN p_canal='email' THEN 'perm_comm_email' ELSE 'perm_comm_telegram' END) THEN RAISE EXCEPTION 'Permission communication requise'; END IF;
 IF p_canal NOT IN ('telegram','email','portal') OR length(trim(p_text))=0 OR length(p_text)>4096 THEN RAISE EXCEPTION 'Message invalide (1 à 4096 caractères)'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Colis introuvable'; END IF;
 SELECT * INTO cl FROM clients WHERE id=c.client_id;
 IF p_canal='telegram' AND cl.telegram_chat_id IS NULL THEN RAISE EXCEPTION 'Telegram doit être lié au compte client'; END IF;
 IF p_idempotency_key IS NOT NULL THEN
  SELECT * INTO ob FROM notification_outbox WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN SELECT * INTO m FROM messages WHERE id=ob.message_id; RETURN jsonb_build_object('message',to_jsonb(m),'outbox',to_jsonb(ob)); END IF;
 END IF;
 INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,statut,canal,template,request_snapshot)
 VALUES(c.id,'staff',auth.uid(),coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),'Expedîle'),p_text,
 CASE WHEN p_canal='portal' THEN 'envoye'::statut_message ELSE 'envoi'::statut_message END,p_canal,p_template,
 CASE WHEN p_template IN ('demande_feu_vert','relance_feu_vert') THEN jsonb_build_object('trackings',c.trackings,'trackings_detail',c.trackings_detail,'nb_colis',c.nb_colis) ELSE NULL END) RETURNING * INTO m;
 INSERT INTO notification_outbox(message_id,client_id,colis_id,quote_version,canal,reply_markup,idempotency_key,status)
 VALUES(m.id,cl.id,c.id,c.quote_version,p_canal,p_reply_markup,p_idempotency_key,CASE p_canal WHEN 'email' THEN 'manual' WHEN 'portal' THEN 'sent' ELSE 'pending' END) RETURNING * INTO ob;
 IF cl.user_id IS NOT NULL THEN INSERT INTO notifications(user_id,titre,msg,colis_id,type) VALUES(cl.user_id,'Un message pour '||c.ref,p_text,c.id,'message'); END IF;
 RETURN jsonb_build_object('message',to_jsonb(m),'outbox',to_jsonb(ob));
END; $$;

CREATE OR REPLACE FUNCTION _apply_client_decision(p_colis_id uuid,p_action text,p_expected_updated_at timestamptz,p_wait_until timestamptz,p_reason text,p_actor text) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; dest text; departure uuid; paris timestamp:=now() AT TIME ZONE 'Europe/Paris'; minimum_depart date;
BEGIN
 IF p_action NOT IN ('approve','wait','refuse') THEN RAISE EXCEPTION 'Décision invalide'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.statut<>'attente_feu_vert' THEN RAISE EXCEPTION 'Cette demande ne peut plus être modifiée'; END IF;
 IF p_expected_updated_at IS NOT NULL AND c.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'Le dossier a changé. Rechargez avant de confirmer.'; END IF;
 IF p_wait_until IS NOT NULL AND p_wait_until<=now() THEN RAISE EXCEPTION 'La date de reprise doit être future'; END IF;
 IF p_action='approve' THEN
  SELECT left(cp,3) INTO dest FROM clients WHERE id=c.client_id;
  minimum_depart:=date_trunc('week',paris)::date+4;
  IF extract(isodow FROM paris)>3 OR (extract(isodow FROM paris)=3 AND paris::time>=time '17:00') THEN minimum_depart:=minimum_depart+7; END IF;
  SELECT id INTO departure FROM envois WHERE destination_code=dest AND statut IN ('planifie','prochain') AND date_depart>=minimum_depart ORDER BY date_depart,id LIMIT 1;
  UPDATE colis SET statut='autorise',feu_vert='autorise',feu_vert_date=now(),attente_client_motif=NULL,attente_client_date=NULL,attente_client_until=NULL,envoi_id=coalesce(envoi_id,departure),next_action='Préparer le colis',next_action_at=now() WHERE id=c.id RETURNING * INTO c;
 ELSIF p_action='wait' THEN
  UPDATE colis SET attente_client_motif=coalesce(nullif(trim(p_reason),''),'Attend d’autres colis'),attente_client_date=now(),attente_client_until=p_wait_until,next_action='Attente volontaire du client',next_action_at=p_wait_until WHERE id=c.id RETURNING * INTO c;
  UPDATE notification_outbox SET status='cancelled' WHERE colis_id=c.id AND status='pending' AND message_id IN (SELECT id FROM messages WHERE template='relance_feu_vert');
 ELSE
  UPDATE colis SET statut='refuse_client',feu_vert='refuse',feu_vert_date=now(),attente_client_motif=NULL,attente_client_date=NULL,attente_client_until=NULL,next_action='Contacter le client pour la suite',next_action_at=now() WHERE id=c.id RETURNING * INTO c;
 END IF;
 INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,canal) VALUES(c.id,'client',auth.uid(),p_actor,CASE p_action WHEN 'approve' THEN 'Accord de préparation enregistré pour ce dossier et ses cartons actuels.' WHEN 'wait' THEN 'Attente volontaire enregistrée. Les relances sont suspendues.' ELSE 'Préparation refusée. Notre équipe vous recontactera.' END,'portal');
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail) VALUES(c.id,auth.uid(),p_actor,'client_decision',p_action);
 RETURN c;
END; $$;
CREATE OR REPLACE FUNCTION client_decision(p_colis_id uuid,p_action text,p_expected_updated_at timestamptz DEFAULT NULL,p_wait_until timestamptz DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM colis WHERE id=p_colis_id AND (client_id=auth_client_id() OR has_permission('perm_colis_valider_feuvert'))) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
 RETURN _apply_client_decision(p_colis_id,p_action,p_expected_updated_at,p_wait_until,p_reason,coalesce((SELECT nom FROM profiles WHERE id=auth.uid()),'Client'));
END; $$;
CREATE OR REPLACE FUNCTION telegram_client_decision(p_colis_id uuid,p_action text,p_chat_id text,p_message_id text) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; snap jsonb;
BEGIN
 SELECT c1.* INTO c FROM colis c1 JOIN clients cl ON cl.id=c1.client_id WHERE c1.id=p_colis_id AND cl.telegram_chat_id=p_chat_id FOR UPDATE OF c1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ce dossier ne correspond pas à votre compte'; END IF;
 SELECT request_snapshot INTO snap FROM messages WHERE colis_id=c.id AND telegram_msg_id=p_message_id AND template IN ('demande_feu_vert','relance_feu_vert') ORDER BY created_at DESC LIMIT 1;
 IF snap IS NULL OR snap<>jsonb_build_object('trackings',c.trackings,'trackings_detail',c.trackings_detail,'nb_colis',c.nb_colis) THEN RAISE EXCEPTION 'Les cartons du dossier ont changé. Demandez une nouvelle demande à notre équipe.'; END IF;
 RETURN _apply_client_decision(c.id,p_action,c.updated_at,NULL,NULL,'Client (Telegram)');
END; $$;

CREATE OR REPLACE FUNCTION version_quote() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (NEW.devis_transport,NEW.devis_om,NEW.devis_omr,NEW.devis_tva,NEW.devis_total,NEW.devis_snapshot) IS DISTINCT FROM (OLD.devis_transport,OLD.devis_om,OLD.devis_omr,OLD.devis_tva,OLD.devis_total,OLD.devis_snapshot) THEN
  IF OLD.paiement_date IS NOT NULL THEN RAISE EXCEPTION 'Un devis payé ne peut plus être modifié'; END IF;
  NEW.quote_version:=OLD.quote_version+1; NEW.devis_snapshot:=coalesce(NEW.devis_snapshot,'{}'::jsonb)||jsonb_build_object('createdAt',now(),'version',NEW.quote_version); NEW.payplug_payment_id:=NULL; NEW.payplug_payment_url:=NULL;
  UPDATE payment_intents SET status='superseded',updated_at=now() WHERE colis_id=NEW.id AND status IN ('creating','pending');
  IF NEW.devis_total>0 THEN
   INSERT INTO quote_versions(colis_id,version,snapshot,total,created_by) VALUES(NEW.id,NEW.quote_version,coalesce(NEW.devis_snapshot,to_jsonb(NEW)),NEW.devis_total,auth.uid());
  END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER version_quote BEFORE UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION version_quote();
CREATE OR REPLACE FUNCTION save_quote(p_colis_id uuid,p_snapshot jsonb,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; q quote_versions; total numeric; destination text; client_kind type_client; tariff tarifs; divisor numeric; pf numeric; transport numeric; om numeric:=0; omr numeric:=0; tva numeric:=0; fees numeric:=0; merchandise numeric; fl numeric; fw numeric; fh numeric; fp numeric; fee_rows jsonb; component text; before_pf numeric; before_transport numeric; before_om numeric:=0; before_omr numeric:=0; before_tva numeric:=0; before_total numeric; saving numeric:=0; original_boxes jsonb;
BEGIN
 IF NOT has_permission('perm_colis_calculer_devis') THEN RAISE EXCEPTION 'Permission devis requise'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.statut NOT IN ('en_preparation','devis_envoye','attente_paiement') THEN RAISE EXCEPTION 'Préparation du dossier requise'; END IF;
 IF p_expected_updated_at IS NOT NULL AND c.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'Dossier modifié par un collègue. Rechargez le devis.'; END IF;
 SELECT left(cp,3),type INTO destination,client_kind FROM clients WHERE id=c.client_id;
 SELECT * INTO tariff FROM tarifs WHERE destination_code=destination AND actif ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND OR tariff.base<0 OR tariff.par_kg<0 THEN RAISE EXCEPTION 'Tarif de destination absent ou invalide'; END IF;
 SELECT coalesce((value->>'diviseurVolumetrique')::numeric,5000) INTO divisor FROM app_settings WHERE key='business'; divisor:=coalesce(divisor,5000);
 fl:=coalesce((p_snapshot->>'finL')::numeric,c.fin_l);fw:=coalesce((p_snapshot->>'finW')::numeric,c.fin_w);fh:=coalesce((p_snapshot->>'finH')::numeric,c.fin_h);fp:=coalesce((p_snapshot->>'finP')::numeric,c.fin_p);
 IF fl IS NULL OR fw IS NULL OR fh IS NULL OR fp IS NULL OR fl<=0 OR fw<=0 OR fh<=0 OR fp<=0 OR divisor<=0 OR fl='NaN'::numeric OR fw='NaN'::numeric OR fh='NaN'::numeric OR fp='NaN'::numeric THEN RAISE EXCEPTION 'Dimensions et poids positifs requis'; END IF;
 pf:=greatest(fp,fl*fw*fh/divisor); transport:=round(tariff.base+pf*tariff.par_kg,2);
 fee_rows:=coalesce(p_snapshot->'fraisDivers',p_snapshot->'inputs'->'fees',c.frais_divers,'[]'::jsonb);
 IF jsonb_typeof(fee_rows)<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(fee_rows) WHERE coalesce(trim(value->>'libelle'),'')='' OR (value->>'montant')::numeric IS NULL OR (value->>'montant')::numeric<0 OR (value->>'montant')::numeric='NaN'::numeric) THEN RAISE EXCEPTION 'Frais invalides'; END IF;
 SELECT coalesce(sum(round((value->>'montant')::numeric,2)),0) INTO fees FROM jsonb_array_elements(fee_rows);
 IF client_kind='particulier' THEN
  IF NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND valide AND rejet_motif IS NULL) OR EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND rejet_motif IS NULL AND (NOT valide OR coalesce(trim(fichier_url),'')='' OR montant<=0)) THEN RAISE EXCEPTION 'Toutes les factures doivent être vérifiées et leurs documents joints'; END IF;
  IF NOT EXISTS(SELECT 1 FROM lignes WHERE colis_id=c.id) OR EXISTS(SELECT 1 FROM lignes l LEFT JOIN taux_categories t ON t.categorie_id=l.categorie_id AND t.destination_code=destination WHERE l.colis_id=c.id AND (t.id IS NULL OR t.om<0 OR t.omr<0 OR l.qte<=0 OR l.prix_unitaire<0)) THEN RAISE EXCEPTION 'Articles, catégories et taux de destination requis'; END IF;
  SELECT sum(qte*prix_unitaire) INTO merchandise FROM lignes WHERE colis_id=c.id;
  IF merchandise<=0 THEN RAISE EXCEPTION 'Valeur des marchandises positive requise'; END IF;
  SELECT round(sum((l.qte*l.prix_unitaire+transport*l.qte*l.prix_unitaire/merchandise)*t.om/100),2),round(sum((l.qte*l.prix_unitaire+transport*l.qte*l.prix_unitaire/merchandise)*t.omr/100),2) INTO om,omr FROM lignes l JOIN taux_categories t ON t.categorie_id=l.categorie_id AND t.destination_code=destination WHERE l.colis_id=c.id;
  SELECT round((transport+om+omr)*d.tva/100,2) INTO tva FROM destinations d WHERE d.code=destination AND d.actif;
  IF tva IS NULL OR tva<0 THEN RAISE EXCEPTION 'TVA de destination absente'; END IF;
 END IF;
 FOREACH component IN ARRAY ARRAY['devisTransport','devisOM','devisOMR','devisTVA','devisTotal'] LOOP
  IF (p_snapshot->>component)::numeric IS NULL OR (p_snapshot->>component)::numeric<0 OR (p_snapshot->>component)::numeric='NaN'::numeric THEN RAISE EXCEPTION 'Composante de devis invalide : %',component; END IF;
 END LOOP;
 IF abs((p_snapshot->>'devisTransport')::numeric-transport)>0.01 OR abs((p_snapshot->>'devisOM')::numeric-om)>0.01 OR abs((p_snapshot->>'devisOMR')::numeric-omr)>0.01 OR abs((p_snapshot->>'devisTVA')::numeric-tva)>0.01 OR abs((p_snapshot->>'devisTotal')::numeric-(transport+om+omr+tva+fees))>0.01 THEN RAISE EXCEPTION 'Le devis ne correspond plus aux tarifs, dimensions ou articles enregistrés. Recalculez-le.'; END IF;
 -- Normalize the frozen financial snapshot so PDFs and payment can never disagree.
 total:=transport+om+omr+tva+fees;
 p_snapshot:=p_snapshot || jsonb_build_object('devisTransport',transport,'devisOM',om,'devisOMR',omr,'devisTVA',tva,'devisTotal',total,'poidsFact',round(pf,2));
 p_snapshot:=jsonb_set(p_snapshot,'{amounts}',coalesce(p_snapshot->'amounts','{}'::jsonb)||jsonb_build_object('transport',transport,'om',om,'omr',omr,'tva',tva,'total',total,'fees',fees,'realWeight',fp,'volumetricWeight',fl*fw*fh/divisor,'billableWeight',pf,'merchandiseValue',round(coalesce(merchandise,0),2)));
 original_boxes:=CASE WHEN jsonb_array_length(coalesce(c.dims_par_colis,'[]'))>0 THEN c.dims_par_colis ELSE jsonb_build_array(jsonb_build_object('dimL',c.dim_l,'dimW',c.dim_w,'dimH',c.dim_h,'poids',c.poids)) END;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(original_boxes) WHERE coalesce((value->>'dimL')::numeric,0)<=0 OR coalesce((value->>'dimW')::numeric,0)<=0 OR coalesce((value->>'dimH')::numeric,0)<=0 OR coalesce((value->>'poids')::numeric,0)<=0) THEN
  SELECT greatest(sum((value->>'poids')::numeric),sum((value->>'dimL')::numeric*(value->>'dimW')::numeric*(value->>'dimH')::numeric/divisor)) INTO before_pf FROM jsonb_array_elements(original_boxes);
  before_transport:=round(tariff.base+before_pf*tariff.par_kg,2);
  IF client_kind='particulier' THEN
   SELECT round(sum((l.qte*l.prix_unitaire+before_transport*l.qte*l.prix_unitaire/merchandise)*t.om/100),2),round(sum((l.qte*l.prix_unitaire+before_transport*l.qte*l.prix_unitaire/merchandise)*t.omr/100),2) INTO before_om,before_omr FROM lignes l JOIN taux_categories t ON t.categorie_id=l.categorie_id AND t.destination_code=destination WHERE l.colis_id=c.id;
   SELECT round((before_transport+before_om+before_omr)*d.tva/100,2) INTO before_tva FROM destinations d WHERE d.code=destination;
  END IF;
  before_total:=before_transport+before_om+before_omr+before_tva+fees;saving:=greatest(0,before_total-total);
  p_snapshot:=jsonb_set(p_snapshot,'{before}',coalesce(nullif(p_snapshot->'before','null'::jsonb),'{}'::jsonb)||jsonb_build_object('transport',before_transport,'om',before_om,'omr',before_omr,'tva',before_tva,'fees',fees,'total',before_total,'billableWeight',before_pf));
 ELSE p_snapshot:=jsonb_set(p_snapshot,'{before}','null'); END IF;
 p_snapshot:=p_snapshot||jsonb_build_object('avantOptimTransport',coalesce(before_transport,0),'avantOptimTotal',coalesce(before_total,0),'economie',saving,'savings',saving);
 IF client_kind='pro' AND coalesce(p_snapshot->>'modePaiementPro',c.mode_paiement_pro,'') NOT IN ('virement','especes','30_jours','fin_de_mois') THEN RAISE EXCEPTION 'Modalité de règlement professionnel requise'; END IF;
 IF total IS NULL OR total<=0 OR total='NaN'::numeric THEN RAISE EXCEPTION 'Total du devis invalide'; END IF;
 UPDATE colis SET devis_snapshot=p_snapshot,devis_brouillon=true,poids_facturable=round(pf,2),frais_divers=fee_rows,mode_paiement_pro=coalesce(p_snapshot->>'modePaiementPro',mode_paiement_pro),
  devis_transport=(p_snapshot->>'devisTransport')::numeric,devis_om=(p_snapshot->>'devisOM')::numeric,devis_omr=(p_snapshot->>'devisOMR')::numeric,devis_tva=(p_snapshot->>'devisTVA')::numeric,devis_total=total,
  avant_optim_transport=(p_snapshot->>'avantOptimTransport')::numeric,avant_optim_total=(p_snapshot->>'avantOptimTotal')::numeric,economie=coalesce((p_snapshot->>'economie')::numeric,0),
  fin_l=coalesce((p_snapshot->>'finL')::numeric,fin_l),fin_w=coalesce((p_snapshot->>'finW')::numeric,fin_w),fin_h=coalesce((p_snapshot->>'finH')::numeric,fin_h),fin_p=coalesce((p_snapshot->>'finP')::numeric,fin_p)
 WHERE id=c.id RETURNING * INTO c;
 SELECT * INTO q FROM quote_versions WHERE colis_id=c.id AND version=c.quote_version;
 RETURN jsonb_build_object('colis',to_jsonb(c),'quote',to_jsonb(q));
END; $$;

CREATE OR REPLACE FUNCTION _record_payment(p_colis_id uuid,p_amount numeric,p_method text,p_reference text,p_provider_id text,p_quote_version integer) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Colis introuvable'; END IF;
 IF p_provider_id IS NOT NULL AND EXISTS(SELECT 1 FROM paiements WHERE provider_id=p_provider_id AND statut='confirme') THEN RETURN c; END IF;
 IF c.paiement_date IS NOT NULL THEN
  IF p_provider_id IS NOT NULL OR p_amount<>c.paiement_montant THEN RAISE EXCEPTION 'Un autre paiement existe déjà pour ce dossier : rapprochement requis'; END IF;
  RETURN c;
 END IF;
 IF c.statut NOT IN ('devis_envoye','attente_paiement') OR c.devis_total IS NULL OR p_amount<>c.devis_total OR p_quote_version<>c.quote_version THEN RAISE EXCEPTION 'Le paiement ne correspond pas au devis actif'; END IF;
 INSERT INTO paiements(colis_id,client_id,montant,methode,reference,statut,confirme_par,confirme_le,provider_id,quote_version) VALUES(c.id,c.client_id,p_amount,p_method,p_reference,'confirme',auth.uid(),now(),p_provider_id,p_quote_version);
 UPDATE colis SET statut='paye',paiement_montant=p_amount,paiement_date=now(),paiement_methode=p_method,paiement_reference=p_reference,devis_brouillon=false WHERE id=c.id RETURNING * INTO c;
 IF (SELECT type FROM clients WHERE id=c.client_id)='particulier' THEN UPDATE clients SET points=points+floor(coalesce(c.devis_transport,0)/10)::integer WHERE id=c.client_id; END IF;
 IF EXISTS(SELECT 1 FROM clients WHERE id=c.client_id AND user_id IS NOT NULL) THEN INSERT INTO notifications(user_id,titre,msg,colis_id,type) SELECT user_id,'Paiement reçu',c.ref||' : votre paiement est enregistré.',c.id,'paiement' FROM clients WHERE id=c.client_id; END IF;
 RETURN c;
END; $$;
CREATE OR REPLACE FUNCTION mark_manual_payment(p_colis_id uuid,p_amount numeric,p_method text DEFAULT 'manuel',p_reference text DEFAULT NULL) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v integer;
BEGIN
 IF NOT has_permission('perm_colis_confirmer_paiement') THEN RAISE EXCEPTION 'Permission paiement requise'; END IF;
 SELECT quote_version INTO v FROM colis WHERE id=p_colis_id;
 RETURN _record_payment(p_colis_id,p_amount,p_method,p_reference,NULL,v);
END; $$;
CREATE OR REPLACE FUNCTION confirm_payplug_payment(p_provider_id text,p_colis_id uuid,p_quote_version integer,p_amount_cents integer,p_currency text) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE intent payment_intents; c colis;
BEGIN
 SELECT * INTO intent FROM payment_intents WHERE provider_id=p_provider_id FOR UPDATE;
 IF NOT FOUND OR intent.colis_id<>p_colis_id OR intent.quote_version<>p_quote_version OR intent.amount_cents<>p_amount_cents OR intent.currency<>p_currency OR p_currency<>'EUR' THEN RAISE EXCEPTION 'Référence de paiement incohérente'; END IF;
 c:=_record_payment(p_colis_id,p_amount_cents/100.0,'payplug',p_provider_id,p_provider_id,p_quote_version);
 UPDATE payment_intents SET status='paid',updated_at=now() WHERE id=intent.id;
 RETURN c;
END; $$;

-- A packet receipt invalidates the old decision snapshot and resumes the conversation,
-- without authorizing the additional packet silently or inventing a date of dispatch.
CREATE OR REPLACE FUNCTION resume_wait_on_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target colis; cl clients;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.trackings,NEW.nb_colis,NEW.trackings_detail) IS NOT DISTINCT FROM (OLD.trackings,OLD.nb_colis,OLD.trackings_detail) THEN RETURN NEW; END IF;
 SELECT * INTO cl FROM clients WHERE id=NEW.client_id;
 FOR target IN SELECT * FROM colis WHERE client_id=NEW.client_id AND statut='attente_feu_vert' AND attente_client_date IS NOT NULL LOOP
  UPDATE colis SET attente_client_motif=NULL,attente_client_date=NULL,attente_client_until=NULL,demande_feu_vert_envoyee_at=NULL,next_action='Nouveau carton : renouveler la demande de préparation',next_action_at=now() WHERE id=target.id;
  IF cl.user_id IS NOT NULL THEN INSERT INTO notifications(user_id,titre,msg,colis_id,type) VALUES(cl.user_id,'Un nouveau carton est arrivé','Vous pouvez vérifier les cartons et choisir de préparer ou continuer à attendre.',target.id,'feu_vert'); END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER resume_wait_on_receipt AFTER INSERT OR UPDATE OF trackings,nb_colis,trackings_detail ON colis FOR EACH ROW EXECUTE FUNCTION resume_wait_on_receipt();

-- Privileged helpers can only be reached through verified Edge Functions/service role.
REVOKE ALL ON FUNCTION consume_telegram_invitation(text,text),telegram_client_decision(uuid,text,text,text),_apply_client_decision(uuid,text,timestamptz,timestamptz,text,text),_record_payment(uuid,numeric,text,text,text,integer),confirm_payplug_payment(text,uuid,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION consume_telegram_invitation(text,text),telegram_client_decision(uuid,text,text,text),confirm_payplug_payment(text,uuid,integer,integer,text) TO service_role;
REVOKE ALL ON FUNCTION acquire_colis_lock(uuid),release_colis_lock(uuid),create_telegram_invitation(uuid),client_decision(uuid,text,timestamptz,timestamptz,text),save_quote(uuid,jsonb,timestamptz),mark_manual_payment(uuid,numeric,text,text),queue_message(uuid,text,text,text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION acquire_colis_lock(uuid),release_colis_lock(uuid),create_telegram_invitation(uuid),client_decision(uuid,text,timestamptz,timestamptz,text),save_quote(uuid,jsonb,timestamptz),mark_manual_payment(uuid,numeric,text,text),queue_message(uuid,text,text,text,jsonb,text) TO authenticated,service_role;
