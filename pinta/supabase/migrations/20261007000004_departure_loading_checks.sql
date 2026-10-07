-- Loading control of each departure (user decision 2026-10-07: « nous devons aussi avant ou pendant pouvoir vérifier que
-- tous les colis qui sont affectés au départ sont bien remis au transporteur, soit via un scan à la volée, soit via une
-- vérification au comptage. Mais je préférerais un scan des différents QR codes ou codes-barres. »).
-- Every outgoing parcel carries a label (100 × 150 mm) whose QR code and barcode hold « EXP-2YE537-1-2 »: the dossier
-- reference, the parcel's position and the dossier's number of outgoing parcels (src/expedile/domain/parcelCode.js).
-- Before or while the parcels are handed to the carrier, the team checks each one: its label scanned (handheld scanner or
-- tablet camera), or the dossier's parcels counted by hand. The checks are stored here, shared between devices, with who
-- and when. The control is mandatory: confirm_departure accepts a dossier as loaded only when every one of its outgoing
-- parcels was checked for this departure on its current labels, and the confirmed manifest keeps those checks as evidence.
-- A dossier not fully checked is deferred with a reason, as before.
-- Expected parcels: those of the current preparation (outgoing_parcel_count, kept equal to final_packages by
-- save_preparation_measurements), or one parcel for a legacy dossier whose single final measures predate the per-parcel
-- list (as the loading screen and confirm_departure count it). A label printed for another count is refused as stale;
-- checks recorded on another count stop counting and give way to the next valid check of that dossier.
-- Commands (SECURITY DEFINER, fixed search_path, EXECUTE for authenticated only): record_loading_check (one scanned
-- label), record_loading_count (the dossier's parcels counted by hand), clear_loading_checks (redo a dossier's control),
-- get_loading_checks (the departure's checks, for every device). Refusals raise a French message, shown as it is, with a
-- HINT loading_check:<reason> the screen maps: SQLSTATE 42501 permission, P0002 not found, 40001 the screen is out of
-- date, 22023 otherwise. Locks follow confirm_departure's order: the departure (FOR KEY SHARE, so it cannot be confirmed
-- meanwhile), then the dossier (FOR UPDATE, one check at a time per dossier). A check changes neither the dossier nor the
-- departure, so their versions stay valid for the confirmation. No business row is rewritten: a new table, private
-- helpers, the commands, and confirm_departure replaced whole (copy of 2026-09-17 plus the control and its evidence).

CREATE TABLE departure_loading_checks (
 envoi_id uuid NOT NULL REFERENCES envois(id) ON DELETE CASCADE,
 colis_id uuid NOT NULL REFERENCES colis(id) ON DELETE CASCADE,
 parcel_index integer NOT NULL,
 parcel_count integer NOT NULL,
 method text NOT NULL CHECK(method IN ('scan','camera','count')),
 checked_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(envoi_id,colis_id,parcel_index),
 CHECK(parcel_index BETWEEN 1 AND parcel_count)
);
CREATE INDEX departure_loading_checks_colis ON departure_loading_checks(colis_id);
COMMENT ON TABLE departure_loading_checks IS 'Contrôle du chargement : chaque colis sortant scanné ou compté pour un départ, par qui et quand ; écrit uniquement par les commandes de contrôle.';
-- Written and read through the commands only: no policy, no privilege for the API roles.
ALTER TABLE departure_loading_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON departure_loading_checks FROM PUBLIC,anon,authenticated;

-- Outgoing parcels a loading check expects, NULL while nothing is ready to load (same count as the loading screen).
CREATE FUNCTION _loading_expected_parcels(c colis) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(c.final_packages)='array' AND jsonb_array_length(c.final_packages)>0 THEN c.outgoing_parcel_count
  WHEN coalesce(c.fin_l>0 AND c.fin_w>0 AND c.fin_h>0 AND c.fin_p>0,false) THEN coalesce(c.outgoing_parcel_count,1) END
$$;
-- Name of the staff member who checked a parcel, « Prénom Nom » as the team screens show it.
CREATE FUNCTION _loading_checker_name(p_user uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT nullif(btrim(concat_ws(' ',s.prenom,s.nom)),'') FROM staff_users s WHERE s.auth_id=p_user),
  (SELECT nullif(btrim(concat_ws(' ',p.prenom,p.nom)),'') FROM profiles p WHERE p.id=p_user),'Membre de l’équipe')
$$;
-- One check as the commands return it and the manifest keeps it.
CREATE FUNCTION _loading_check_json(k departure_loading_checks) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('colis_id',k.colis_id,'parcel_index',k.parcel_index,'parcel_count',k.parcel_count,'method',k.method,
  'checked_by',k.checked_by,'checked_by_name',_loading_checker_name(k.checked_by),'checked_at',k.checked_at)
$$;
-- The dossier a check is written for, locked in confirm_departure's order (departure, then dossier) and validated: an open
-- departure that has not left, the dossier assigned to it, neither shipped, cancelled nor archived, and (p_prepared) with
-- its outgoing parcels known.
CREATE FUNCTION _loading_check_target(p_envoi_id uuid,p_colis_id uuid,p_prepared boolean) RETURNS colis LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e envois; c colis;
BEGIN
 SELECT * INTO e FROM envois WHERE id=p_envoi_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Départ introuvable' USING ERRCODE='P0002',HINT='loading_check:departure_not_found'; END IF;
 IF e.departed_at IS NOT NULL OR e.statut NOT IN ('planifie','prochain','en_cours','en_preparation','pret') THEN
  RAISE EXCEPTION 'Ce départ est déjà confirmé ou clos : son contrôle du chargement ne peut plus changer.' USING ERRCODE='22023',HINT='loading_check:departure_closed';
 END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable' USING ERRCODE='P0002',HINT='loading_check:dossier_not_found'; END IF;
 IF c.envoi_id IS DISTINCT FROM e.id THEN
  RAISE EXCEPTION '% n’est pas affecté à ce départ : ne chargez pas ses colis. Actualisez le chargement.',c.ref USING ERRCODE='40001',HINT='loading_check:not_assigned';
 END IF;
 IF coalesce(c.archive,false) OR c.date_expedition IS NOT NULL OR c.statut IN ('expedie','transit','dedouanement','arrive','livraison','livre','annule') THEN
  RAISE EXCEPTION '% est déjà expédié, annulé ou archivé : il ne fait plus partie de ce chargement.',c.ref USING ERRCODE='22023',HINT='loading_check:dossier_closed';
 END IF;
 IF p_prepared AND _loading_expected_parcels(c) IS NULL THEN
  RAISE EXCEPTION '% : ses colis sortants ne sont pas encore préparés. Terminez sa préparation avant de contrôler son chargement.',c.ref USING ERRCODE='22023',HINT='loading_check:not_prepared';
 END IF;
 RETURN c;
END; $$;

-- A check vouches for the parcels of the current preparation, handed over for this departure. A dossier that leaves the
-- departure (reassigned, deferred at confirmation, detached) or is prepared again loses its checks: an older check never
-- vouches for other boxes or another departure. The confirmed manifest has already kept the evidence of loaded dossiers.
CREATE FUNCTION _loading_checks_forget() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 DELETE FROM departure_loading_checks k WHERE k.colis_id=NEW.id
  AND (k.envoi_id IS DISTINCT FROM NEW.envoi_id
   OR OLD.final_measurements_version IS DISTINCT FROM NEW.final_measurements_version
   OR OLD.preparation_composition_version IS DISTINCT FROM NEW.preparation_composition_version);
 RETURN NULL;
END; $$;
CREATE TRIGGER colis_loading_checks_forget AFTER UPDATE OF envoi_id,final_measurements_version,preparation_composition_version ON colis
 FOR EACH ROW WHEN (OLD.envoi_id IS DISTINCT FROM NEW.envoi_id OR OLD.final_measurements_version IS DISTINCT FROM NEW.final_measurements_version
  OR OLD.preparation_composition_version IS DISTINCT FROM NEW.preparation_composition_version)
 EXECUTE FUNCTION _loading_checks_forget();

-- One label scanned (handheld scanner or camera) for a dossier of the departure. Returns {status 'recorded'|'already',
-- checked, expected, check}: a label scanned again keeps its first check (who, when, method).
CREATE FUNCTION record_loading_check(p_envoi_id uuid,p_colis_id uuid,p_parcel_index integer,p_parcel_count integer,p_method text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; expected integer; added integer; k departure_loading_checks;
BEGIN
 IF NOT has_permission('perm_colis_expedier') THEN RAISE EXCEPTION 'Permission d’expédition requise pour contrôler le chargement' USING ERRCODE='42501',HINT='loading_check:permission'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('scan','camera') THEN
  RAISE EXCEPTION 'Contrôle inconnu : scannez l’étiquette, ou comptez les colis du dossier.' USING ERRCODE='22023',HINT='loading_check:invalid_method';
 END IF;
 IF p_parcel_index IS NULL OR p_parcel_count IS NULL OR p_parcel_index<1 OR p_parcel_index>p_parcel_count THEN
  RAISE EXCEPTION 'Étiquette illisible : numéro de colis invalide. Scannez-la à nouveau.' USING ERRCODE='22023',HINT='loading_check:invalid_label';
 END IF;
 c:=_loading_check_target(p_envoi_id,p_colis_id,true);
 expected:=_loading_expected_parcels(c);
 IF p_parcel_count<>expected THEN
  RAISE EXCEPTION 'Étiquette périmée : ce dossier compte maintenant % colis. Réimprimez ses étiquettes.',expected USING ERRCODE='22023',HINT='loading_check:stale_label';
 END IF;
 -- Checks of another count describe older labels: the current labels replace them.
 DELETE FROM departure_loading_checks WHERE envoi_id=p_envoi_id AND colis_id=c.id AND parcel_count<>expected;
 INSERT INTO departure_loading_checks(envoi_id,colis_id,parcel_index,parcel_count,method,checked_by,checked_at)
 VALUES(p_envoi_id,c.id,p_parcel_index,expected,p_method,auth.uid(),now()) ON CONFLICT (envoi_id,colis_id,parcel_index) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 SELECT * INTO k FROM departure_loading_checks WHERE envoi_id=p_envoi_id AND colis_id=c.id AND parcel_index=p_parcel_index;
 RETURN jsonb_build_object('status',CASE WHEN added=1 THEN 'recorded' ELSE 'already' END,
  'checked',(SELECT count(*) FROM departure_loading_checks WHERE envoi_id=p_envoi_id AND colis_id=c.id AND parcel_count=expected),
  'expected',expected,'check',_loading_check_json(k));
END; $$;

-- The dossier's parcels counted by hand: accepted only when the count matches; every parcel not yet checked is recorded
-- with the method 'count' (a scanned parcel keeps its scan). Returns {status 'recorded'|'already', checked, expected, added}.
CREATE FUNCTION record_loading_count(p_envoi_id uuid,p_colis_id uuid,p_counted integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; expected integer; added integer;
BEGIN
 IF NOT has_permission('perm_colis_expedier') THEN RAISE EXCEPTION 'Permission d’expédition requise pour contrôler le chargement' USING ERRCODE='42501',HINT='loading_check:permission'; END IF;
 IF p_counted IS NULL OR p_counted<0 THEN RAISE EXCEPTION 'Indiquez le nombre de colis comptés.' USING ERRCODE='22023',HINT='loading_check:invalid_count'; END IF;
 c:=_loading_check_target(p_envoi_id,p_colis_id,true);
 expected:=_loading_expected_parcels(c);
 IF p_counted<>expected THEN
  RAISE EXCEPTION 'Comptage différent : % compte % colis, vous en avez compté %. Recomptez ses colis, ou reportez-le.',c.ref,expected,p_counted USING ERRCODE='22023',HINT='loading_check:count_mismatch';
 END IF;
 DELETE FROM departure_loading_checks WHERE envoi_id=p_envoi_id AND colis_id=c.id AND parcel_count<>expected;
 INSERT INTO departure_loading_checks(envoi_id,colis_id,parcel_index,parcel_count,method,checked_by,checked_at)
 SELECT p_envoi_id,c.id,i,expected,'count',auth.uid(),now() FROM generate_series(1,expected) i ON CONFLICT (envoi_id,colis_id,parcel_index) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 RETURN jsonb_build_object('status',CASE WHEN added>0 THEN 'recorded' ELSE 'already' END,
  'checked',(SELECT count(*) FROM departure_loading_checks WHERE envoi_id=p_envoi_id AND colis_id=c.id AND parcel_count=expected),
  'expected',expected,'added',added);
END; $$;

-- Redo a dossier's control (a wrong parcel scanned, a recount): its checks for this departure are removed and audited.
-- Returns {status 'cleared'|'none', cleared, checked, expected}.
CREATE FUNCTION clear_loading_checks(p_envoi_id uuid,p_colis_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; cleared integer; removed jsonb;
BEGIN
 IF NOT has_permission('perm_colis_expedier') THEN RAISE EXCEPTION 'Permission d’expédition requise pour contrôler le chargement' USING ERRCODE='42501',HINT='loading_check:permission'; END IF;
 c:=_loading_check_target(p_envoi_id,p_colis_id,false);
 WITH gone AS (DELETE FROM departure_loading_checks k WHERE k.envoi_id=p_envoi_id AND k.colis_id=c.id RETURNING k.parcel_index,_loading_check_json(k) AS evidence)
 SELECT count(*),coalesce(jsonb_agg(evidence ORDER BY parcel_index),'[]') INTO cleared,removed FROM gone;
 IF cleared>0 THEN
  INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,before_data)
  VALUES(c.id,auth.uid(),_loading_checker_name(auth.uid()),'loading_checks_cleared',jsonb_build_object('envoi_id',p_envoi_id,'cleared',cleared)::text,removed);
 END IF;
 RETURN jsonb_build_object('status',CASE WHEN cleared>0 THEN 'cleared' ELSE 'none' END,'cleared',cleared,'checked',0,'expected',_loading_expected_parcels(c));
END; $$;

-- The checks of the dossiers currently assigned to the departure, for every device of the team.
CREATE FUNCTION get_loading_checks(p_envoi_id uuid)
RETURNS TABLE(colis_id uuid,parcel_index integer,parcel_count integer,method text,checked_by uuid,checked_by_name text,checked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT has_permission('perm_envois_voir') THEN RAISE EXCEPTION 'Permission de consultation des envois requise' USING ERRCODE='42501',HINT='loading_check:permission'; END IF;
 IF NOT EXISTS(SELECT 1 FROM envois e WHERE e.id=p_envoi_id) THEN RAISE EXCEPTION 'Départ introuvable' USING ERRCODE='P0002',HINT='loading_check:departure_not_found'; END IF;
 RETURN QUERY SELECT k.colis_id,k.parcel_index,k.parcel_count,k.method,k.checked_by,_loading_checker_name(k.checked_by),k.checked_at
  FROM departure_loading_checks k JOIN colis c ON c.id=k.colis_id AND c.envoi_id=k.envoi_id
  WHERE k.envoi_id=p_envoi_id ORDER BY k.colis_id,k.parcel_index;
END; $$;

-- Confirmation (copy of 2026-09-17: every guard, lock, version check, the Paris day, the writes, the audit and the manifest)
-- plus the mandatory loading control: each loaded dossier needs all its parcels checked for this departure on its current
-- count, otherwise « Contrôle incomplet » (scan or count them, or defer the dossier); each manifest item keeps its checks.
CREATE OR REPLACE FUNCTION confirm_departure(p_envoi_id uuid,p_loaded jsonb,p_expected_updated_at timestamptz,p_deferred_reason text DEFAULT NULL) RETURNS envois LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e envois;c colis;item jsonb;items jsonb:='[]';deferred jsonb:='[]';excluded jsonb:='[]';ids uuid[];count_out integer;depart_time timestamptz:=clock_timestamp();checked_count integer;checks jsonb;
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
  -- Loading control (2026-10-07): every outgoing parcel scanned or counted for this departure, on its current labels.
  SELECT count(*),coalesce(jsonb_agg(_loading_check_json(k) ORDER BY k.parcel_index),'[]') INTO checked_count,checks
   FROM departure_loading_checks k WHERE k.envoi_id=e.id AND k.colis_id=c.id AND k.parcel_count=count_out;
  IF checked_count<count_out THEN RAISE EXCEPTION 'Contrôle incomplet : % (%/% colis %). Scannez ou comptez ses colis, ou reportez-le.',c.ref,checked_count,count_out,CASE WHEN count_out>1 THEN 'vérifiés' ELSE 'vérifié' END
   USING ERRCODE='22023',HINT='loading_check:incomplete',DETAIL=jsonb_build_object('colis_id',c.id,'ref',c.ref,'checked',checked_count,'expected',count_out)::text; END IF;
  UPDATE colis SET statut='expedie',date_expedition=depart_time,outgoing_parcel_count=count_out WHERE id=c.id RETURNING * INTO c;
  items:=items||jsonb_build_array(jsonb_build_object('legacy_measurements_confirmed',coalesce(jsonb_array_length(nullif(to_jsonb(c)->'final_packages','null'::jsonb)),0)=0,'colis',to_jsonb(c),'client',(SELECT to_jsonb(cl) FROM clients cl WHERE id=c.client_id),
   'lignes',coalesce((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('custom_duty',coalesce((SELECT v->'customDuty' FROM jsonb_array_elements(coalesce(c.devis_snapshot#>'{inputs,lines}','[]')) v WHERE v->>'id'=l.id::text LIMIT 1),l.custom_duty))) FROM lignes l WHERE l.colis_id=c.id AND (l.facture_id IS NULL OR EXISTS(SELECT 1 FROM factures f WHERE f.id=l.facture_id AND f.valide AND nullif(trim(f.rejet_motif),'') IS NULL AND f.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)))),'[]'),
   'factures',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM factures f WHERE f.colis_id=c.id AND f.valide AND nullif(trim(f.rejet_motif),'') IS NULL AND f.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)),'[]'),
   'categories',coalesce((SELECT jsonb_agg(to_jsonb(cat)) FROM categories cat WHERE cat.id IN(SELECT categorie_id FROM lignes WHERE colis_id=c.id)),'[]'),
   'loading_checks',checks));
 END LOOP;
 UPDATE envois SET statut='parti',departed_at=depart_time,manifest_version=1,nb_colis=cardinality(ids),poids_total=(SELECT sum((i->'colis'->>'fin_p')::numeric) FROM jsonb_array_elements(items) i),volume_total=(SELECT sum(CASE WHEN jsonb_typeof(i->'colis'->'final_packages')='array' AND jsonb_array_length(i->'colis'->'final_packages')>0 THEN (SELECT sum((b->>'dimL')::numeric*(b->>'dimW')::numeric*(b->>'dimH')::numeric/1000000.0) FROM jsonb_array_elements(i->'colis'->'final_packages') b) ELSE (i->'colis'->>'fin_l')::numeric*(i->'colis'->>'fin_w')::numeric*(i->'colis'->>'fin_h')::numeric/1000000.0 END) FROM jsonb_array_elements(items) i) WHERE id=e.id RETURNING * INTO e;
 INSERT INTO departure_manifests(envoi_id,confirmed_at,confirmed_by,snapshot) VALUES(e.id,depart_time,auth.uid(),jsonb_build_object('envoi',to_jsonb(e),'confirmed_at',depart_time,'items',items,'deferred',deferred,'excluded',excluded));
 PERFORM set_config('expedile.confirm_departure','',true);
 INSERT INTO audit_actions(user_id,action,detail) VALUES(auth.uid(),'departure_confirmed',jsonb_build_object('envoi_id',e.id,'loaded_ids',ids,'legacy_measurements_confirmed_ids',(SELECT coalesce(jsonb_agg(i->'colis'->>'id'),'[]') FROM jsonb_array_elements(items) i WHERE (i->>'legacy_measurements_confirmed')::boolean),'deferred',deferred,'excluded',excluded,'physical_parcels',(SELECT sum((i->'colis'->>'outgoing_parcel_count')::integer) FROM jsonb_array_elements(items) i))::text);
 RETURN e;
END; $$;

REVOKE ALL ON FUNCTION record_loading_check(uuid,uuid,integer,integer,text),record_loading_count(uuid,uuid,integer),clear_loading_checks(uuid,uuid),get_loading_checks(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION record_loading_check(uuid,uuid,integer,integer,text),record_loading_count(uuid,uuid,integer),clear_loading_checks(uuid,uuid),get_loading_checks(uuid) TO authenticated;
REVOKE ALL ON FUNCTION _loading_expected_parcels(colis),_loading_checker_name(uuid),_loading_check_json(departure_loading_checks),_loading_check_target(uuid,uuid,boolean),_loading_checks_forget() FROM PUBLIC,anon,authenticated,service_role;
