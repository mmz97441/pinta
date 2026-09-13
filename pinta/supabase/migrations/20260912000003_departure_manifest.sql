-- Physical outgoing cartons are distinct from received cartons and EXP dossiers.
ALTER TABLE colis ADD COLUMN outgoing_parcel_count integer CHECK(outgoing_parcel_count>0);
ALTER TABLE envois ADD COLUMN loading_closes_at timestamptz,ADD COLUMN departed_at timestamptz,ADD COLUMN manifest_version integer NOT NULL DEFAULT 0;
CREATE TABLE departure_manifests (
 envoi_id uuid PRIMARY KEY REFERENCES envois(id) ON DELETE RESTRICT,version integer NOT NULL DEFAULT 1,
 confirmed_at timestamptz NOT NULL DEFAULT now(),confirmed_by uuid NOT NULL REFERENCES profiles(id),snapshot jsonb NOT NULL
);
ALTER TABLE departure_manifests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON departure_manifests FROM anon,authenticated;

DROP POLICY IF EXISTS "Envois: logisticien+ CRUD" ON envois;
DROP POLICY IF EXISTS "Envois: staff voit" ON envois;
CREATE POLICY envois_read_permission ON envois FOR SELECT TO authenticated USING(has_permission('perm_envois_voir'));
CREATE POLICY envois_create_permission ON envois FOR INSERT TO authenticated WITH CHECK(has_permission('perm_envois_creer'));
CREATE POLICY envois_update_permission ON envois FOR UPDATE TO authenticated USING(has_permission('perm_envois_modifier')) WITH CHECK(has_permission('perm_envois_modifier'));
CREATE POLICY envois_delete_permission ON envois FOR DELETE TO authenticated USING(has_permission('perm_envois_modifier') AND statut IN ('planifie','prochain') AND NOT EXISTS(SELECT 1 FROM colis WHERE envoi_id=envois.id));

CREATE FUNCTION guard_departure_changes() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE trusted boolean:=current_user IN ('postgres','supabase_admin') OR auth.role()='service_role';
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.departed_at IS NOT NULL OR OLD.manifest_version>0 THEN RAISE EXCEPTION 'Un départ confirmé doit rester dans l’historique' USING ERRCODE='22023'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NOT trusted AND NOT has_permission('perm_envois_creer') THEN RAISE EXCEPTION 'Permission de création d’envoi requise' USING ERRCODE='42501'; END IF;
  IF NEW.statut NOT IN ('planifie','prochain','en_cours','en_preparation','pret') THEN RAISE EXCEPTION 'Créez un départ à planifier' USING ERRCODE='22023'; END IF;
  IF NEW.departed_at IS NOT NULL OR NEW.manifest_version<>0 THEN RAISE EXCEPTION 'Confirmez le départ avec son chargement' USING ERRCODE='22023'; END IF;
 ELSE
  IF NOT trusted AND NOT has_permission('perm_envois_modifier') THEN RAISE EXCEPTION 'Permission de modification d’envoi requise' USING ERRCODE='42501'; END IF;
  IF (NEW.departed_at,NEW.manifest_version) IS DISTINCT FROM (OLD.departed_at,OLD.manifest_version) AND NOT (trusted AND current_setting('expedile.confirm_departure',true)='allowed') THEN RAISE EXCEPTION 'Utilisez la confirmation du chargement' USING ERRCODE='42501'; END IF;
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
   IF NEW.statut='parti' AND NOT (trusted AND current_setting('expedile.confirm_departure',true)='allowed') THEN RAISE EXCEPTION 'Confirmez le départ et ses dossiers embarqués' USING ERRCODE='22023'; END IF;
   IF OLD.statut='archive' OR (OLD.statut='arrive' AND NEW.statut<>'archive') OR (OLD.statut='parti' AND NEW.statut NOT IN ('arrive','archive')) THEN RAISE EXCEPTION 'Ce départ ne peut pas revenir à un état précédent' USING ERRCODE='22023'; END IF;
  END IF;
  IF OLD.departed_at IS NOT NULL AND (NEW.destination_code,NEW.date_depart,NEW.loading_closes_at) IS DISTINCT FROM (OLD.destination_code,OLD.date_depart,OLD.loading_closes_at) THEN RAISE EXCEPTION 'Destination et dates du chargement confirmé sont figées' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_departure_changes BEFORE INSERT OR UPDATE OR DELETE ON envois FOR EACH ROW EXECUTE FUNCTION guard_departure_changes();

CREATE FUNCTION valid_departure_for_colis(p_envoi_id uuid,p_client_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM envois e JOIN clients cl ON cl.id=p_client_id WHERE e.id=p_envoi_id
 AND e.destination_code=left(cl.cp,3) AND e.statut IN ('planifie','prochain','en_cours','en_preparation','pret') AND e.departed_at IS NULL
 AND e.date_depart>=(now() AT TIME ZONE 'Europe/Paris')::date AND (e.loading_closes_at IS NULL OR e.loading_closes_at>now()));
$$;
REVOKE ALL ON FUNCTION valid_departure_for_colis(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION valid_departure_for_colis(uuid,uuid) TO authenticated;
CREATE FUNCTION guard_colis_departure() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE trusted boolean:=current_user IN ('postgres','supabase_admin') OR auth.role()='service_role';
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.envoi_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM envois e WHERE e.id=NEW.envoi_id AND e.destination_code=CASE WHEN NEW.paiement_date IS NOT NULL THEN coalesce(NEW.devis_snapshot#>>'{inputs,destination,code}',NEW.devis_snapshot->'destination'->>'code',left((SELECT cp FROM clients WHERE id=NEW.client_id),3)) ELSE left((SELECT cp FROM clients WHERE id=NEW.client_id),3) END AND e.statut IN ('planifie','prochain','en_cours','en_preparation','pret') AND e.date_depart>=(now() AT TIME ZONE 'Europe/Paris')::date AND e.departed_at IS NULL AND (e.loading_closes_at IS NULL OR e.loading_closes_at>now())) THEN RAISE EXCEPTION 'Départ incompatible, passé ou clôturé' USING ERRCODE='22023'; END IF;
  IF NEW.envoi_id IS NOT NULL AND NOT trusted AND NOT has_permission('perm_colis_affecter_envoi') THEN RAISE EXCEPTION 'Permission d’affectation à un envoi requise' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.envoi_id IS DISTINCT FROM OLD.envoi_id THEN
  IF OLD.date_expedition IS NOT NULL THEN RAISE EXCEPTION 'Le départ d’un dossier déjà expédié est figé' USING ERRCODE='22023'; END IF;
  IF NOT trusted AND NOT has_permission(CASE WHEN OLD.envoi_id IS NULL THEN 'perm_colis_affecter_envoi' ELSE 'perm_envois_reaffecter' END) THEN RAISE EXCEPTION 'Permission d’affectation ou de réaffectation requise' USING ERRCODE='42501'; END IF;
  IF NEW.envoi_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM envois e WHERE e.id=NEW.envoi_id AND e.destination_code=CASE WHEN NEW.paiement_date IS NOT NULL THEN coalesce(NEW.devis_snapshot#>>'{inputs,destination,code}',NEW.devis_snapshot->'destination'->>'code',left((SELECT cp FROM clients WHERE id=NEW.client_id),3)) ELSE left((SELECT cp FROM clients WHERE id=NEW.client_id),3) END AND e.statut IN ('planifie','prochain','en_cours','en_preparation','pret') AND e.date_depart>=(now() AT TIME ZONE 'Europe/Paris')::date AND e.departed_at IS NULL AND (e.loading_closes_at IS NULL OR e.loading_closes_at>now())) THEN RAISE EXCEPTION 'Départ incompatible, passé ou clôturé' USING ERRCODE='22023'; END IF;
 END IF;
 IF NOT trusted AND (NEW.date_expedition,NEW.date_livraison) IS DISTINCT FROM (OLD.date_expedition,OLD.date_livraison) THEN RAISE EXCEPTION 'Les dates métier suivent les confirmations de statut' USING ERRCODE='42501'; END IF;
 IF NEW.statut='expedie' AND OLD.statut<>'expedie' THEN
  IF NOT (trusted AND current_setting('expedile.confirm_departure',true)='allowed') AND NOT (trusted AND current_setting('expedile.revert',true)='allowed' AND OLD.date_expedition IS NOT NULL) THEN RAISE EXCEPTION 'Confirmez l’embarquement depuis le départ commun' USING ERRCODE='22023'; END IF;
  NEW.date_expedition:=coalesce(OLD.date_expedition,clock_timestamp());
 END IF;
 IF NEW.statut='livre' AND OLD.statut<>'livre' THEN NEW.date_livraison:=coalesce(OLD.date_livraison,clock_timestamp()); END IF;
 IF NEW.outgoing_parcel_count IS DISTINCT FROM OLD.outgoing_parcel_count AND NOT trusted THEN RAISE EXCEPTION 'Confirmez les colis sortants avec leurs mesures de préparation' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_colis_departure BEFORE INSERT OR UPDATE ON colis FOR EACH ROW EXECUTE FUNCTION guard_colis_departure();

CREATE FUNCTION assign_colis_departure(p_colis_id uuid,p_envoi_id uuid,p_expected_updated_at timestamptz) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; old_envoi uuid;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable' USING ERRCODE='P0002'; END IF;
 IF NOT has_permission(CASE WHEN c.envoi_id IS NULL THEN 'perm_colis_affecter_envoi' ELSE 'perm_envois_reaffecter' END) THEN RAISE EXCEPTION 'Permission d’affectation ou de réaffectation requise' USING ERRCODE='42501'; END IF;
 IF p_expected_updated_at IS NULL OR p_expected_updated_at<>c.updated_at THEN RAISE EXCEPTION 'Le dossier a changé. Rechargez-le.' USING ERRCODE='40001'; END IF;
 IF c.statut IN ('expedie','transit','dedouanement','arrive','livraison','livre','annule') OR c.archive THEN RAISE EXCEPTION 'Ce dossier ne peut plus être affecté' USING ERRCODE='22023'; END IF;
 old_envoi:=c.envoi_id;
 UPDATE colis SET envoi_id=p_envoi_id WHERE id=c.id RETURNING * INTO c;
 INSERT INTO audit_actions(colis_id,user_id,action,detail) VALUES(c.id,auth.uid(),'departure_assignment',jsonb_build_object('before',old_envoi,'after',p_envoi_id)::text);
 RETURN c;
END; $$;
REVOKE ALL ON FUNCTION assign_colis_departure(uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION assign_colis_departure(uuid,uuid,timestamptz) TO authenticated;

CREATE FUNCTION confirm_departure(p_envoi_id uuid,p_loaded jsonb,p_expected_updated_at timestamptz,p_deferred_reason text DEFAULT NULL) RETURNS envois LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e envois;c colis;item jsonb;items jsonb:='[]';deferred jsonb:='[]';excluded jsonb:='[]';ids uuid[];count_out integer;depart_time timestamptz:=clock_timestamp();
BEGIN
 IF NOT (has_permission('perm_envois_modifier') AND has_permission('perm_colis_expedier')) THEN RAISE EXCEPTION 'Permissions de modification du départ et d’expédition requises' USING ERRCODE='42501'; END IF;
 IF p_loaded IS NULL OR jsonb_typeof(p_loaded)<>'array' OR jsonb_array_length(p_loaded)=0 THEN RAISE EXCEPTION 'Sélectionnez les dossiers effectivement embarqués' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM envois WHERE id=p_envoi_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Départ introuvable' USING ERRCODE='P0002'; END IF;
 IF e.departed_at IS NOT NULL OR e.statut NOT IN ('planifie','prochain','en_cours','en_preparation','pret') THEN RAISE EXCEPTION 'Ce départ est déjà confirmé ou clos' USING ERRCODE='22023'; END IF;
 IF p_expected_updated_at IS NULL OR e.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'Le départ a changé. Rechargez le chargement.' USING ERRCODE='40001'; END IF;
 IF e.date_depart IS NULL OR e.date_depart<>(now() AT TIME ZONE 'Europe/Paris')::date THEN RAISE EXCEPTION 'La confirmation doit avoir lieu à la date prévue du départ. Corrigez sa date si nécessaire.' USING ERRCODE='22023'; END IF;
 SELECT array_agg((v->>'id')::uuid) INTO ids FROM jsonb_array_elements(p_loaded) v;
 IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) OR array_position(ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Dossiers embarqués invalides ou dupliqués' USING ERRCODE='22023'; END IF;
 -- Lock all attached dossiers before deciding either loading or explicit deferral.
 PERFORM 1 FROM colis WHERE envoi_id=e.id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM unnest(ids) x WHERE NOT EXISTS(SELECT 1 FROM colis WHERE id=x AND envoi_id=e.id)) THEN RAISE EXCEPTION 'Un dossier sélectionné n’appartient plus à ce départ' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM colis WHERE envoi_id=e.id AND NOT(id=ANY(ids)) AND statut NOT IN ('annule','livre','expedie','transit','dedouanement','arrive','livraison') AND date_expedition IS NULL) THEN
  IF NOT has_permission('perm_envois_reaffecter') THEN RAISE EXCEPTION 'Permission de réaffectation requise pour reporter les autres dossiers' USING ERRCODE='42501'; END IF;
  IF nullif(trim(p_deferred_reason),'') IS NULL THEN RAISE EXCEPTION 'Expliquez le report des dossiers non embarqués' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'ref',ref,'reason',p_deferred_reason)),'[]') INTO deferred FROM colis WHERE envoi_id=e.id AND NOT(id=ANY(ids)) AND statut NOT IN ('annule','livre','expedie','transit','dedouanement','arrive','livraison') AND date_expedition IS NULL;
  UPDATE colis SET envoi_id=NULL WHERE envoi_id=e.id AND NOT(id=ANY(ids)) AND statut NOT IN ('annule','livre','expedie','transit','dedouanement','arrive','livraison') AND date_expedition IS NULL;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'ref',ref,'statut',statut,'reason','Dossier historique ou annulé : hors chargement')),'[]') INTO excluded FROM colis WHERE envoi_id=e.id AND NOT(id=ANY(ids));
 PERFORM set_config('expedile.confirm_departure','allowed',true);
 FOR item IN SELECT value FROM jsonb_array_elements(p_loaded) LOOP
  SELECT * INTO c FROM colis WHERE id=(item->>'id')::uuid;
  IF item->>'updated_at' IS NULL OR (item->>'updated_at')::timestamptz<>c.updated_at THEN RAISE EXCEPTION 'Le dossier % a changé. Rechargez le chargement.',c.ref USING ERRCODE='40001'; END IF;
  IF c.archive OR c.statut<>'paye' OR c.paiement_date IS NULL OR coalesce(c.paiement_montant,0)<coalesce(c.devis_total,0) OR coalesce(c.devis_total,0)<=0 THEN RAISE EXCEPTION '% : paiement confirmé et complet requis avant départ',c.ref USING ERRCODE='22023'; END IF;
  IF coalesce(c.devis_snapshot#>>'{inputs,destination,code}',c.devis_snapshot->'destination'->>'code',left((SELECT cp FROM clients WHERE id=c.client_id),3)) IS DISTINCT FROM e.destination_code THEN RAISE EXCEPTION '% : destination incompatible',c.ref USING ERRCODE='22023'; END IF;
  IF NOT coalesce(c.fin_l>0 AND c.fin_w>0 AND c.fin_h>0 AND c.fin_p>0,false) THEN RAISE EXCEPTION '% : mesures finales manquantes',c.ref USING ERRCODE='22023'; END IF;
  IF coalesce(to_jsonb(c)->'final_packages','null'::jsonb)<>'null'::jsonb AND jsonb_typeof(to_jsonb(c)->'final_packages')<>'array' THEN RAISE EXCEPTION '% : mesures sortantes invalides',c.ref USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(to_jsonb(c)->'final_packages')='array' AND jsonb_array_length(to_jsonb(c)->'final_packages')>0 THEN
   IF jsonb_typeof(to_jsonb(c)->'final_packages')<>'array' OR jsonb_array_length(to_jsonb(c)->'final_packages')=0 OR c.outgoing_parcel_count IS DISTINCT FROM jsonb_array_length(to_jsonb(c)->'final_packages') OR (to_jsonb(c)->>'preparation_composition_version') IS DISTINCT FROM (to_jsonb(c)->>'final_measurements_version') THEN RAISE EXCEPTION '% : préparation sortante à vérifier',c.ref USING ERRCODE='22023'; END IF;
  ELSIF coalesce((item->>'outgoing_parcel_count')::integer,c.outgoing_parcel_count) IS DISTINCT FROM 1 THEN RAISE EXCEPTION '% : les mesures historiques décrivent un seul colis ; vérifiez physiquement ce colis avant confirmation',c.ref USING ERRCODE='22023';
  END IF;
  count_out:=coalesce((item->>'outgoing_parcel_count')::integer,c.outgoing_parcel_count);
  IF count_out IS NULL OR count_out<=0 THEN RAISE EXCEPTION '% : confirmez le nombre de colis physiques sortants',c.ref USING ERRCODE='22023'; END IF;
  IF c.outgoing_parcel_count IS NOT NULL AND count_out<>c.outgoing_parcel_count THEN RAISE EXCEPTION '% : le nombre sortant ne correspond plus à la préparation',c.ref USING ERRCODE='40001'; END IF;
  UPDATE colis SET statut='expedie',date_expedition=depart_time,outgoing_parcel_count=count_out WHERE id=c.id RETURNING * INTO c;
  items:=items||jsonb_build_array(jsonb_build_object('legacy_measurements_confirmed',coalesce(jsonb_array_length(nullif(to_jsonb(c)->'final_packages','null'::jsonb)),0)=0,'colis',to_jsonb(c),'client',(SELECT to_jsonb(cl) FROM clients cl WHERE id=c.client_id),
   'lignes',coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM lignes l WHERE l.colis_id=c.id AND (l.facture_id IS NULL OR EXISTS(SELECT 1 FROM factures f WHERE f.id=l.facture_id AND f.valide AND nullif(trim(f.rejet_motif),'') IS NULL))),'[]'),
   'factures',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM factures f WHERE f.colis_id=c.id AND f.valide AND nullif(trim(f.rejet_motif),'') IS NULL),'[]'),
   'categories',coalesce((SELECT jsonb_agg(to_jsonb(cat)) FROM categories cat WHERE cat.id IN(SELECT categorie_id FROM lignes WHERE colis_id=c.id)),'[]')));
 END LOOP;
 UPDATE envois SET statut='parti',departed_at=depart_time,manifest_version=1,nb_colis=cardinality(ids),poids_total=(SELECT sum((i->'colis'->>'fin_p')::numeric) FROM jsonb_array_elements(items) i),volume_total=(SELECT sum(CASE WHEN jsonb_typeof(i->'colis'->'final_packages')='array' AND jsonb_array_length(i->'colis'->'final_packages')>0 THEN (SELECT sum((b->>'dimL')::numeric*(b->>'dimW')::numeric*(b->>'dimH')::numeric/1000000.0) FROM jsonb_array_elements(i->'colis'->'final_packages') b) ELSE (i->'colis'->>'fin_l')::numeric*(i->'colis'->>'fin_w')::numeric*(i->'colis'->>'fin_h')::numeric/1000000.0 END) FROM jsonb_array_elements(items) i) WHERE id=e.id RETURNING * INTO e;
 INSERT INTO departure_manifests(envoi_id,confirmed_at,confirmed_by,snapshot) VALUES(e.id,depart_time,auth.uid(),jsonb_build_object('envoi',to_jsonb(e),'confirmed_at',depart_time,'items',items,'deferred',deferred,'excluded',excluded));
 PERFORM set_config('expedile.confirm_departure','',true);
 INSERT INTO audit_actions(user_id,action,detail) VALUES(auth.uid(),'departure_confirmed',jsonb_build_object('envoi_id',e.id,'loaded_ids',ids,'legacy_measurements_confirmed_ids',(SELECT coalesce(jsonb_agg(i->'colis'->>'id'),'[]') FROM jsonb_array_elements(items) i WHERE (i->>'legacy_measurements_confirmed')::boolean),'deferred',deferred,'excluded',excluded,'physical_parcels',(SELECT sum((i->'colis'->>'outgoing_parcel_count')::integer) FROM jsonb_array_elements(items) i))::text);
 RETURN e;
END; $$;
REVOKE ALL ON FUNCTION confirm_departure(uuid,jsonb,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION confirm_departure(uuid,jsonb,timestamptz,text) TO authenticated;
CREATE FUNCTION get_departure_manifest(p_envoi_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE manifest jsonb;
BEGIN
 IF NOT has_permission('perm_envois_voir') THEN RAISE EXCEPTION 'Permission de consultation des envois requise' USING ERRCODE='42501'; END IF;
 SELECT snapshot INTO manifest FROM departure_manifests WHERE envoi_id=p_envoi_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Le chargement de ce départ n’a pas été confirmé. Aucun manifeste historique fiable n’est disponible.' USING ERRCODE='P0002'; END IF;
 RETURN manifest;
END; $$;
REVOKE ALL ON FUNCTION get_departure_manifest(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION get_departure_manifest(uuid) TO authenticated;

-- Revalidate an existing assignment on every renewed client agreement.
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
  SELECT id INTO departure FROM envois WHERE destination_code=dest AND statut IN ('planifie','prochain') AND date_depart>=minimum_depart AND (loading_closes_at IS NULL OR loading_closes_at>now()) ORDER BY date_depart,id LIMIT 1;
  UPDATE colis SET statut='autorise',feu_vert='autorise',feu_vert_date=now(),attente_client_motif=NULL,attente_client_date=NULL,attente_client_until=NULL,envoi_id=CASE WHEN valid_departure_for_colis(envoi_id,client_id) THEN envoi_id ELSE departure END,next_action_source='system',next_action='Préparer le colis',next_action_at=NULL WHERE id=c.id RETURNING * INTO c;
 ELSIF p_action='wait' THEN
  UPDATE colis SET attente_client_motif=coalesce(nullif(trim(p_reason),''),'Attend d’autres colis'),attente_client_date=now(),attente_client_until=p_wait_until,next_action_source='system',next_action='Attente volontaire du client',next_action_at=p_wait_until WHERE id=c.id RETURNING * INTO c;
  UPDATE notification_outbox SET status='cancelled' WHERE colis_id=c.id AND status IN ('pending','blocked') AND message_id IN (SELECT id FROM messages WHERE template='relance_feu_vert');
 ELSE
  UPDATE colis SET statut='refuse_client',feu_vert='refuse',feu_vert_date=now(),attente_client_motif=NULL,attente_client_date=NULL,attente_client_until=NULL,next_action_source='system',next_action='Contacter le client pour la suite',next_action_at=NULL WHERE id=c.id RETURNING * INTO c;
 END IF;
 INSERT INTO messages(colis_id,type,auteur_id,auteur_nom,texte,canal,template) VALUES(c.id,'client',auth.uid(),p_actor,CASE p_action WHEN 'approve' THEN 'Accord de préparation enregistré pour ce dossier et ses cartons actuels.' WHEN 'wait' THEN 'Attente volontaire enregistrée. Les relances sont suspendues.' ELSE 'Préparation refusée. Notre équipe vous recontactera.' END,'portal','client_decision_'||p_action);
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail) VALUES(c.id,auth.uid(),p_actor,'client_decision',p_action);
 SELECT * INTO c FROM colis WHERE id=c.id;
 RETURN c;
END; $$;


-- A real loading deadline participates in work ordering without inventing a time.
CREATE FUNCTION sync_departure_work_deadline() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; BEGIN
 IF (NEW.loading_closes_at,NEW.date_depart,NEW.statut) IS DISTINCT FROM (OLD.loading_closes_at,OLD.date_depart,OLD.statut) THEN
  FOR target IN SELECT id FROM colis WHERE envoi_id=NEW.id AND NOT archive LOOP PERFORM sync_staff_work_actions(target); END LOOP;
 END IF; RETURN NEW; END; $$;
CREATE TRIGGER z_sync_departure_work_deadline AFTER UPDATE OF loading_closes_at,date_depart,statut ON envois FOR EACH ROW EXECUTE FUNCTION sync_departure_work_deadline();
CREATE OR REPLACE FUNCTION sync_staff_work_actions(p_colis_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; open_case boolean; final_ready boolean; docs_ready boolean; documents_present boolean; has_contact boolean; is_pro boolean; d timestamptz;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id;
 IF NOT FOUND THEN RETURN; END IF;
 open_case:=NOT c.archive AND c.statut NOT IN ('livre','annule');
 final_ready:=coalesce(c.fin_l>0 AND c.fin_w>0 AND c.fin_h>0 AND c.fin_p>0,false)
  AND (NOT (to_jsonb(c)?'preparation_composition_version') OR (to_jsonb(c)->>'preparation_composition_version') IS NOT DISTINCT FROM (to_jsonb(c)->>'final_measurements_version'));
 SELECT EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND coalesce(trim(fichier_url),'')<>''),
  EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND valide AND nullif(trim(rejet_motif),'') IS NULL AND coalesce(trim(fichier_url),'')<>'')
  AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND NOT valide AND nullif(trim(rejet_motif),'') IS NULL)
 INTO documents_present,docs_ready;
 SELECT user_id IS NOT NULL OR telegram_chat_id IS NOT NULL,type='pro' INTO has_contact,is_pro FROM clients WHERE id=c.client_id;
 d:=CASE WHEN c.next_action_source='manual' THEN c.next_action_at END;
 IF c.envoi_id IS NOT NULL THEN d:=least(d,(SELECT loading_closes_at FROM envois WHERE id=c.envoi_id AND departed_at IS NULL)); END IF;
 PERFORM _sync_staff_work_action(c.id,'reception',open_case AND c.statut IN ('receptionne','mesure','attente_feu_vert'),CASE WHEN c.statut='attente_feu_vert' AND (c.attente_client_until IS NULL OR c.attente_client_until>now()) THEN CASE WHEN c.attente_client_date IS NOT NULL THEN 'Attente volontaire du client' ELSE 'Accord client attendu' END END,coalesce(c.attente_client_until,d));
 UPDATE staff_work_actions SET action_hint=CASE WHEN c.statut='attente_feu_vert' AND c.attente_client_until<=now() THEN 'Réexaminer l’attente client' ELSE NULL END WHERE colis_id=c.id AND kind='reception' AND action_hint IS DISTINCT FROM CASE WHEN c.statut='attente_feu_vert' AND c.attente_client_until<=now() THEN 'Réexaminer l’attente client' ELSE NULL END;
 PERFORM _sync_staff_work_action(c.id,'preparation',open_case AND c.statut IN ('autorise','en_preparation') AND NOT final_ready,
  CASE WHEN c.produit_interdit THEN 'Contenu à vérifier avant préparation' WHEN c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN 'Accord client requis' END,d);
 PERFORM _sync_staff_work_action(c.id,'documents',open_case AND c.statut IN ('receptionne','mesure','attente_feu_vert','autorise','en_preparation') AND NOT docs_ready,
  CASE WHEN NOT documents_present THEN 'Facture attendue du client' END,d);
 PERFORM _sync_staff_work_action(c.id,'conversation',NOT c.archive AND (c.conversation_statut<>'termine' OR (open_case AND NOT has_contact)),CASE WHEN c.conversation_statut='attente_client' AND has_contact THEN 'Réponse attendue du client' END,d);
 UPDATE staff_work_actions SET action_hint=CASE WHEN NOT has_contact THEN 'Accès client à activer' ELSE NULL END WHERE colis_id=c.id AND kind='conversation' AND action_hint IS DISTINCT FROM CASE WHEN NOT has_contact THEN 'Accès client à activer' ELSE NULL END;
 PERFORM _sync_staff_work_action(c.id,'quote',open_case AND c.statut IN ('autorise','en_preparation') AND c.paiement_date IS NULL,
  CASE WHEN c.produit_interdit THEN 'Contenu à vérifier avant le devis' WHEN c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN 'Accord client requis' WHEN NOT final_ready THEN 'Mesures finales après optimisation requises' WHEN NOT docs_ready AND NOT is_pro THEN 'Documents à valider' END,d);
 PERFORM _sync_staff_work_action(c.id,'departure',open_case AND c.statut='paye',NULL,d);
 PERFORM _sync_staff_work_action(c.id,'correction',open_case AND (c.statut='refuse_client' OR c.produit_interdit OR (c.next_action_source='manual' AND nullif(trim(c.next_action),'') IS NOT NULL)),NULL,d);
END; $$;

-- Confirmed departure totals describe the frozen manifest, including after archives.
CREATE OR REPLACE FUNCTION fn_update_envoi_aggregats()
RETURNS TRIGGER AS $$
BEGIN
  -- Recalculer l'ancien envoi si changement
  IF OLD.envoi_id IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.envoi_id IS DISTINCT FROM NEW.envoi_id) THEN
    UPDATE envois SET
      nb_colis = (SELECT COUNT(*) FROM colis WHERE envoi_id = OLD.envoi_id),
      poids_total = COALESCE((SELECT SUM(COALESCE(poids_facturable, poids, 0)) FROM colis WHERE envoi_id = OLD.envoi_id), 0),
      volume_total = COALESCE((SELECT SUM(
        CASE WHEN fin_l IS NOT NULL THEN (fin_l * fin_w * fin_h) / 1000000.0
             WHEN dim_l IS NOT NULL THEN (dim_l * dim_w * dim_h) / 1000000.0
             ELSE 0 END
      ) FROM colis WHERE envoi_id = OLD.envoi_id), 0)
    WHERE id = OLD.envoi_id AND departed_at IS NULL;
  END IF;

  -- Recalculer le nouvel envoi
  IF TG_OP != 'DELETE' AND NEW.envoi_id IS NOT NULL THEN
    UPDATE envois SET
      nb_colis = (SELECT COUNT(*) FROM colis WHERE envoi_id = NEW.envoi_id),
      poids_total = COALESCE((SELECT SUM(COALESCE(poids_facturable, poids, 0)) FROM colis WHERE envoi_id = NEW.envoi_id), 0),
      volume_total = COALESCE((SELECT SUM(
        CASE WHEN fin_l IS NOT NULL THEN (fin_l * fin_w * fin_h) / 1000000.0
             WHEN dim_l IS NOT NULL THEN (dim_l * dim_w * dim_h) / 1000000.0
             ELSE 0 END
      ) FROM colis WHERE envoi_id = NEW.envoi_id), 0)
    WHERE id = NEW.envoi_id AND departed_at IS NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp;
