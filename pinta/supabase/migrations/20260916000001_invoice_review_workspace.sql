-- A review is an explicit, atomic staff action. Copies remain auditable documents.
ALTER TABLE factures ADD COLUMN duplicate_of_facture_id uuid REFERENCES factures(id),
 ADD COLUMN duplicate_marked_at timestamptz, ADD COLUMN duplicate_marked_by uuid REFERENCES profiles(id),
 ADD CONSTRAINT invoice_duplicate_not_self CHECK(duplicate_of_facture_id IS DISTINCT FROM id);
ALTER TABLE ocr_extractions ADD COLUMN document_storage_identity text;
ALTER TABLE audit_actions ADD COLUMN before_data jsonb, ADD COLUMN after_data jsonb;
CREATE TABLE invoice_review_drafts (
 facture_id uuid PRIMARY KEY REFERENCES factures(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, saved_by uuid REFERENCES profiles(id), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE invoice_review_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invoice_review_drafts FROM PUBLIC,anon,authenticated;

-- Reads object metadata, never a public URL or the bytes of all invoices.
CREATE FUNCTION invoice_storage_identity(p_file_url text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_object('id',o.id,'name',o.name,'version',to_jsonb(o)->'version','updated_at',to_jsonb(o)->'updated_at','metadata',to_jsonb(o)->'metadata')::text)
 FROM storage.objects o WHERE o.bucket_id='factures' AND o.name=p_file_url
$$;
REVOKE ALL ON FUNCTION invoice_storage_identity(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION invoice_storage_identity(text) TO service_role;

CREATE FUNCTION invoice_review_token(p_facture_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_object('invoice',to_jsonb(f)-ARRAY['ocr_status','ocr_error','telegram_msg_id'],
  'storage',invoice_storage_identity(f.fichier_url),
  'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM lignes l WHERE l.facture_id=f.id),'[]'),
  'extraction',(SELECT to_jsonb(e)-'document_storage_identity' FROM ocr_extractions e WHERE e.facture_id=f.id AND e.document_file_url=f.fichier_url ORDER BY e.created_at DESC,e.id LIMIT 1),
  'draft',(SELECT to_jsonb(d) FROM invoice_review_drafts d WHERE d.facture_id=f.id))::text)
 FROM factures f WHERE f.id=p_facture_id
$$;
REVOKE ALL ON FUNCTION invoice_review_token(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION get_invoice_review_context(p_colis_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_staff() OR NOT (has_permission('perm_factures_voir') OR has_permission('perm_factures_valider') OR has_permission('perm_factures_modifier_articles')) THEN RAISE EXCEPTION 'Accès factures requis' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM colis WHERE id=p_colis_id) THEN RAISE EXCEPTION 'Dossier introuvable'; END IF;
 RETURN jsonb_build_object('invoices',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'factureId',f.id,'reviewToken',invoice_review_token(f.id),'extraction',to_jsonb(e),
  'draft',(SELECT payload FROM invoice_review_drafts d WHERE d.facture_id=f.id),
  'documentHash',e.document_hash,'duplicateCandidateIds',coalesce((
   SELECT jsonb_agg(other.id ORDER BY other.created_at,other.id) FROM factures other
   WHERE other.colis_id=f.colis_id AND other.id<>f.id AND other.duplicate_of_facture_id IS NULL AND other.rejet_motif IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=other.id)
   AND EXISTS(SELECT 1 FROM ocr_extractions oe WHERE oe.facture_id=other.id AND oe.document_file_url=other.fichier_url AND (oe.document_storage_identity IS NULL OR oe.document_storage_identity=invoice_storage_identity(other.fichier_url)) AND oe.document_hash=e.document_hash)), '[]')) ORDER BY f.created_at,f.id)
  FROM factures f LEFT JOIN LATERAL (SELECT * FROM ocr_extractions current_e WHERE current_e.facture_id=f.id AND current_e.document_file_url=f.fichier_url AND (current_e.document_storage_identity IS NULL OR current_e.document_storage_identity=invoice_storage_identity(f.fichier_url)) ORDER BY current_e.created_at DESC,current_e.id LIMIT 1) e ON true WHERE f.colis_id=p_colis_id),'[]'),
  'unlinkedLines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at,l.id) FROM lignes l WHERE l.colis_id=p_colis_id AND l.facture_id IS NULL),'[]'));
END; $$;
REVOKE ALL ON FUNCTION get_invoice_review_context(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION get_invoice_review_context(uuid) TO authenticated;

-- Serialize all document/article writers with review/save_quote/payment commands.
CREATE FUNCTION guard_invoice_review_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; invoice_id uuid; before_duplicate uuid; after_duplicate uuid;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.colis_id ELSE NEW.colis_id END;
 PERFORM 1 FROM colis WHERE id=target FOR UPDATE;
 IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND NEW.colis_id IS DISTINCT FROM OLD.colis_id THEN RAISE EXCEPTION 'Le rattachement du document ou de l’article à son dossier est figé'; END IF;
 IF TG_TABLE_NAME='lignes' THEN
  invoice_id:=CASE WHEN TG_OP='DELETE' THEN OLD.facture_id ELSE NEW.facture_id END;
  IF EXISTS(SELECT 1 FROM factures WHERE id=invoice_id AND duplicate_of_facture_id IS NOT NULL)
   OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM factures WHERE id=OLD.facture_id AND duplicate_of_facture_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'Cette facture est classée en doublon. Restaurez-la avant de modifier ses articles';
  END IF;
  IF invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM factures WHERE id=invoice_id AND colis_id=target) THEN RAISE EXCEPTION 'La facture et les articles doivent appartenir au même dossier'; END IF;
 ELSE
  IF TG_OP='DELETE' THEN
   IF OLD.duplicate_of_facture_id IS NOT NULL THEN RAISE EXCEPTION 'Une copie classée en doublon reste dans l’historique. Restaurez-la avant toute autre action'; END IF;
   RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.duplicate_of_facture_id IS NOT NULL AND NEW.duplicate_of_facture_id IS NOT NULL
   AND (to_jsonb(NEW)-ARRAY['ocr_status','ocr_error','telegram_msg_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['ocr_status','ocr_error','telegram_msg_id']) THEN
   RAISE EXCEPTION 'Cette facture est classée en doublon. Restaurez-la avant de la modifier';
  END IF;
  IF TG_OP='UPDATE' AND NEW.fichier_url IS DISTINCT FROM OLD.fichier_url AND EXISTS(SELECT 1 FROM factures WHERE duplicate_of_facture_id=OLD.id) THEN RAISE EXCEPTION 'Restaurez les copies classées en doublon avant de remplacer le document original'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER a_guard_invoice_review_state BEFORE INSERT OR UPDATE OR DELETE ON factures FOR EACH ROW EXECUTE FUNCTION guard_invoice_review_state();
CREATE TRIGGER a_guard_invoice_review_state BEFORE INSERT OR UPDATE OR DELETE ON lignes FOR EACH ROW EXECUTE FUNCTION guard_invoice_review_state();
-- A caller cannot invent a duplicate by writing the new columns directly.
CREATE FUNCTION guard_invoice_duplicate_columns() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.duplicate_of_facture_id IS NOT NULL) OR (TG_OP='UPDATE' AND (NEW.duplicate_of_facture_id,NEW.duplicate_marked_at,NEW.duplicate_marked_by) IS DISTINCT FROM (OLD.duplicate_of_facture_id,OLD.duplicate_marked_at,OLD.duplicate_marked_by)) THEN
  IF current_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'Utilisez la commande de classement des doublons' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_invoice_duplicate_columns BEFORE INSERT OR UPDATE ON factures FOR EACH ROW EXECUTE FUNCTION guard_invoice_duplicate_columns();

CREATE FUNCTION save_invoice_review(p_facture_id uuid,p_expected_review_token text,p_expected_file_url text,p_lines jsonb,p_total numeric,p_vendeur text,p_extraction_id uuid DEFAULT NULL,p_confirm boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f factures; c colis; e ocr_extractions; item jsonb; subtotal numeric; result jsonb; old_data jsonb; destination text;
BEGIN
 p_confirm:=coalesce(p_confirm,true);
 IF NOT has_permission('perm_factures_modifier_articles') OR (p_confirm AND NOT has_permission('perm_factures_valider')) THEN RAISE EXCEPTION 'Permission de modification des articles et de validation requise' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable'; END IF;
 SELECT * INTO f FROM factures WHERE id=p_facture_id FOR UPDATE;
 IF c.paiement_date IS NOT NULL OR c.archive OR c.statut IN ('paye','expedie','livre','annule') THEN RAISE EXCEPTION 'Les factures de ce dossier sont figées'; END IF;
 IF f.duplicate_of_facture_id IS NOT NULL THEN RAISE EXCEPTION 'Restaurez cette copie avant de la vérifier'; END IF;
 IF EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id) THEN RAISE EXCEPTION 'Cette facture a été remplacée. Vérifiez le document corrigé.'; END IF;
 IF f.rejet_motif IS NOT NULL THEN RAISE EXCEPTION 'Une facture à corriger doit être remplacée par le document corrigé'; END IF;
 PERFORM 1 FROM ocr_extractions WHERE facture_id=f.id ORDER BY id FOR UPDATE;
 IF p_expected_review_token IS NULL OR p_expected_review_token IS DISTINCT FROM invoice_review_token(f.id) THEN RAISE EXCEPTION 'La facture ou ses articles ont changé. Rechargez la vérification pour retrouver les modifications de votre collègue.' USING ERRCODE='40001'; END IF;
 IF coalesce(trim(p_expected_file_url),'')='' OR f.fichier_url IS DISTINCT FROM p_expected_file_url OR invoice_storage_identity(f.fichier_url) IS NULL THEN RAISE EXCEPTION 'Le document a changé ou est indisponible. Rechargez la facture.' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines)>200 OR length(coalesce(p_vendeur,''))>500 OR p_total::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Données de vérification invalides'; END IF;
 IF p_extraction_id IS NOT NULL THEN
  SELECT * INTO e FROM ocr_extractions WHERE id=p_extraction_id AND facture_id=f.id FOR UPDATE;
  IF NOT FOUND OR e.document_file_url IS DISTINCT FROM f.fichier_url OR (p_confirm AND e.document_storage_identity IS DISTINCT FROM invoice_storage_identity(f.fichier_url)) THEN RAISE EXCEPTION 'L’analyse ne correspond plus au document. Rechargez son analyse avant validation.' USING ERRCODE='40001'; END IF;
 END IF;
 IF NOT p_confirm THEN
  INSERT INTO invoice_review_drafts(facture_id,payload,saved_by) VALUES(f.id,jsonb_build_object('lines',p_lines,'total',p_total,'vendeur',p_vendeur,'extractionId',p_extraction_id),auth.uid())
  ON CONFLICT(facture_id) DO UPDATE SET payload=excluded.payload,saved_by=excluded.saved_by,updated_at=clock_timestamp();
  RETURN jsonb_build_object('success',true,'confirmed',false,'facture',to_jsonb(f),'reviewToken',invoice_review_token(f.id));
 END IF;
 IF jsonb_array_length(p_lines)=0 OR p_total IS NULL OR p_total<=0 OR round(p_total,2)<>p_total OR nullif(trim(p_vendeur),'') IS NULL THEN RAISE EXCEPTION 'Indiquez le vendeur, un total positif et au moins un article'; END IF;
 SELECT left(cp,3) INTO destination FROM clients WHERE id=c.client_id;
 FOR item IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF nullif(trim(item->>'desc'),'') IS NULL OR length(item->>'desc')>1000 OR (item->>'qte') IS NULL OR (item->>'qte')::numeric::text IN ('NaN','Infinity','-Infinity') OR (item->>'qte')::numeric NOT BETWEEN 1 AND 100000 OR (item->>'qte')::numeric<>trunc((item->>'qte')::numeric)
   OR (item->>'prix') IS NULL OR (item->>'prix')::numeric::text IN ('NaN','Infinity','-Infinity') OR (item->>'prix')::numeric<0 OR round((item->>'prix')::numeric,2)<>(item->>'prix')::numeric
   OR NOT EXISTS(SELECT 1 FROM categories cat JOIN taux_categories t ON t.categorie_id=cat.id AND t.destination_code=destination WHERE cat.id=(item->>'cat')::uuid AND t.om>=0 AND t.omr>=0)
  THEN RAISE EXCEPTION 'Vérifiez la description, la quantité, le prix et la catégorie de chaque article'; END IF;
 END LOOP;
 SELECT sum((value->>'qte')::numeric*(value->>'prix')::numeric) INTO subtotal FROM jsonb_array_elements(p_lines);
 IF abs(subtotal-p_total)>0.02 THEN RAISE EXCEPTION 'Le total des articles ne correspond pas au total HT de la facture'; END IF;
 old_data:=jsonb_build_object('facture',to_jsonb(f),'articles',coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM lignes l WHERE l.facture_id=f.id),'[]'));
 DELETE FROM lignes WHERE facture_id=f.id;
 INSERT INTO lignes(colis_id,facture_id,ocr_extraction_id,description,qte,prix_unitaire,categorie_id)
 SELECT f.colis_id,f.id,p_extraction_id,trim(value->>'desc'),(value->>'qte')::integer,(value->>'prix')::numeric,(value->>'cat')::uuid FROM jsonb_array_elements(p_lines);
 UPDATE factures SET vendeur=trim(p_vendeur),montant=p_total,valide=true,valide_par=auth.uid(),valide_le=clock_timestamp(),ocr_status=CASE WHEN p_extraction_id IS NOT NULL THEN 'confirmed' ELSE ocr_status END,ocr_error=NULL WHERE id=f.id RETURNING * INTO f;
 IF p_extraction_id IS NOT NULL THEN UPDATE ocr_extractions SET status='confirmed',lines=p_lines,total=p_total,vendeur=trim(p_vendeur),confirmed_at=clock_timestamp(),confirmed_by=auth.uid() WHERE id=p_extraction_id; END IF;
 DELETE FROM invoice_review_drafts WHERE facture_id=f.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'desc',description,'qte',qte,'prix',prix_unitaire,'cat',categorie_id) ORDER BY created_at,id),'[]') INTO result FROM lignes WHERE facture_id=f.id;
 INSERT INTO audit_actions(colis_id,user_id,action,detail,before_data,after_data) VALUES(f.colis_id,auth.uid(),'invoice_review_confirmed','Facture et articles vérifiés ensemble',old_data,jsonb_build_object('facture',to_jsonb(f),'articles',result));
 RETURN jsonb_build_object('success',true,'confirmed',true,'facture',to_jsonb(f),'insertedLignes',result,'reviewToken',invoice_review_token(f.id));
END; $$;
REVOKE ALL ON FUNCTION save_invoice_review(uuid,text,text,jsonb,numeric,text,uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION save_invoice_review(uuid,text,text,jsonb,numeric,text,uuid,boolean) TO authenticated;

CREATE FUNCTION classify_invoice_duplicate(p_facture_id uuid,p_original_facture_id uuid,p_expected_review_token text,p_expected_original_review_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f factures; original factures; c colis; e ocr_extractions; oe ocr_extractions;
BEGIN
 IF NOT has_permission('perm_factures_valider') THEN RAISE EXCEPTION 'Permission validation facture requise' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;
 IF NOT FOUND OR c.paiement_date IS NOT NULL OR c.archive OR c.statut IN ('paye','expedie','livre','annule') THEN RAISE EXCEPTION 'Dossier figé ou introuvable'; END IF;
 PERFORM 1 FROM factures WHERE id IN (p_facture_id,p_original_facture_id) ORDER BY id FOR UPDATE;
 SELECT * INTO f FROM factures WHERE id=p_facture_id; SELECT * INTO original FROM factures WHERE id=p_original_facture_id;
 IF original.id IS NULL OR original.id=f.id OR original.colis_id<>f.colis_id OR original.duplicate_of_facture_id IS NOT NULL OR original.rejet_motif IS NOT NULL OR f.duplicate_of_facture_id IS NOT NULL OR f.rejet_motif IS NOT NULL OR EXISTS(SELECT 1 FROM factures WHERE duplicate_of_facture_id=f.id OR replaces_facture_id IN (f.id,original.id)) THEN RAISE EXCEPTION 'Choisissez deux factures actives distinctes du même dossier'; END IF;
 IF p_expected_review_token IS NULL OR p_expected_original_review_token IS NULL OR p_expected_review_token IS DISTINCT FROM invoice_review_token(f.id) OR p_expected_original_review_token IS DISTINCT FROM invoice_review_token(original.id) THEN RAISE EXCEPTION 'Une facture a changé. Rechargez la comparaison.' USING ERRCODE='40001'; END IF;
 SELECT * INTO e FROM ocr_extractions WHERE facture_id=f.id AND document_file_url=f.fichier_url AND document_storage_identity=invoice_storage_identity(f.fichier_url) ORDER BY created_at DESC LIMIT 1;
 SELECT * INTO oe FROM ocr_extractions WHERE facture_id=original.id AND document_file_url=original.fichier_url AND document_storage_identity=invoice_storage_identity(original.fichier_url) ORDER BY created_at DESC LIMIT 1;
 IF e.id IS NULL OR oe.id IS NULL OR e.document_hash IS DISTINCT FROM oe.document_hash THEN RAISE EXCEPTION 'Vérifiez les deux documents : seuls deux fichiers strictement identiques peuvent être classés en doublon'; END IF;
 UPDATE factures SET duplicate_of_facture_id=original.id,duplicate_marked_at=clock_timestamp(),duplicate_marked_by=auth.uid() WHERE id=f.id RETURNING * INTO f;
 DELETE FROM invoice_review_drafts WHERE facture_id=f.id;
 INSERT INTO audit_actions(colis_id,user_id,action,detail,after_data) VALUES(f.colis_id,auth.uid(),'invoice_duplicate_classified','Copie identique exclue du devis ; fichier et articles conservés',jsonb_build_object('factureId',f.id,'originalFactureId',original.id,'documentHash',e.document_hash));
 RETURN jsonb_build_object('success',true,'facture',to_jsonb(f),'reviewToken',invoice_review_token(f.id));
END; $$;
CREATE FUNCTION restore_invoice_duplicate(p_facture_id uuid,p_expected_review_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f factures; c colis; original_id uuid;
BEGIN
 IF NOT has_permission('perm_factures_valider') THEN RAISE EXCEPTION 'Permission validation facture requise' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;
 IF NOT FOUND OR c.paiement_date IS NOT NULL OR c.archive OR c.statut IN ('paye','expedie','livre','annule') THEN RAISE EXCEPTION 'Dossier figé ou introuvable'; END IF;
 SELECT * INTO f FROM factures WHERE id=p_facture_id FOR UPDATE;
 IF f.duplicate_of_facture_id IS NULL THEN RAISE EXCEPTION 'Cette facture n’est pas classée en doublon'; END IF;
 IF p_expected_review_token IS NULL OR p_expected_review_token IS DISTINCT FROM invoice_review_token(f.id) THEN RAISE EXCEPTION 'La facture a changé. Rechargez la vérification.' USING ERRCODE='40001'; END IF;
 original_id:=f.duplicate_of_facture_id;
 UPDATE factures SET duplicate_of_facture_id=NULL,duplicate_marked_at=NULL,duplicate_marked_by=NULL,valide=false,valide_par=NULL,valide_le=NULL WHERE id=f.id RETURNING * INTO f;
 INSERT INTO audit_actions(colis_id,user_id,action,detail,after_data) VALUES(f.colis_id,auth.uid(),'invoice_duplicate_restored','Facture restaurée : nouvelle vérification requise',jsonb_build_object('factureId',f.id,'originalFactureId',original_id));
 RETURN jsonb_build_object('success',true,'facture',to_jsonb(f),'reviewToken',invoice_review_token(f.id));
END; $$;
REVOKE ALL ON FUNCTION classify_invoice_duplicate(uuid,uuid,text,text),restore_invoice_duplicate(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION classify_invoice_duplicate(uuid,uuid,text,text),restore_invoice_duplicate(uuid,text) TO authenticated;

-- Copies never count as unreviewed invoices or as taxable merchandise.
-- Prepared physical packages are priced as max(sum real weight, sum volumetric weight).
-- Preserve the separation between reception measurements and the optimised final package.
-- Historical incomplete reception data may not produce an invented optimisation saving.
CREATE OR REPLACE FUNCTION save_quote(p_colis_id uuid,p_snapshot jsonb,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; q quote_versions; total numeric; destination text; client_kind type_client; tariff tarifs; divisor numeric; pf numeric; transport numeric; om numeric:=0; omr numeric:=0; tva numeric:=0; fees numeric:=0; merchandise numeric; fl numeric; fw numeric; fh numeric; fp numeric; fee_rows jsonb; component text; before_pf numeric; before_transport numeric; before_om numeric:=0; before_omr numeric:=0; before_tva numeric:=0; before_total numeric; saving numeric:=0; original_boxes jsonb; original_count integer; original_complete boolean; prepared_boxes jsonb; final_volume numeric;
BEGIN
 IF NOT has_permission('perm_colis_calculer_devis') THEN RAISE EXCEPTION 'Permission devis requise'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.statut NOT IN ('en_preparation','devis_envoye','attente_paiement') OR c.archive OR c.produit_interdit OR c.paiement_date IS NOT NULL OR c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN RAISE EXCEPTION 'Préparation autorisée d’un dossier impayé, non archivé et sans produit interdit requise'; END IF;
 IF p_expected_updated_at IS NULL OR c.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'Dossier modifié par un collègue. Rechargez le devis.'; END IF;
 SELECT left(cp,3),type INTO destination,client_kind FROM clients WHERE id=c.client_id;
 -- Frozen commercial identity comes from the database, never an arbitrary caller snapshot.
 p_snapshot:=jsonb_set(p_snapshot,'{inputs}',coalesce(p_snapshot->'inputs','{}'::jsonb)||jsonb_build_object(
  'client',(SELECT jsonb_build_object('id',cl.id,'type',cl.type,'nom',coalesce(cl.nom,'')||CASE WHEN coalesce(cl.prenom,'')<>'' THEN ' '||cl.prenom ELSE '' END,'email',coalesce(cl.email,''),'abonnement',coalesce(cl.abonnement,'freemium')) FROM clients cl WHERE cl.id=c.client_id),
  'destination',(SELECT jsonb_build_object('code',d.code,'nom',d.nom,'tva',CASE WHEN client_kind='pro' THEN 0 ELSE d.tva END) FROM destinations d WHERE d.code=destination)));
 SELECT * INTO tariff FROM tarifs WHERE destination_code=destination AND actif ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND OR tariff.base<0 OR tariff.par_kg<0 THEN RAISE EXCEPTION 'Tarif de destination absent ou invalide'; END IF;
 SELECT coalesce((value->>'diviseurVolumetrique')::numeric,5000) INTO divisor FROM app_settings WHERE key='business'; divisor:=coalesce(divisor,5000);
 IF c.final_measurements_version IS DISTINCT FROM c.preparation_composition_version THEN RAISE EXCEPTION 'Enregistrez les nouvelles mesures après optimisation pour la composition actuelle'; END IF;
 prepared_boxes:=coalesce(nullif(p_snapshot->'finalPackages','null'::jsonb),p_snapshot->'inputs'->'finalPackages',c.final_packages);
 IF prepared_boxes IS NULL THEN prepared_boxes:=jsonb_build_array(jsonb_build_object('dimL',coalesce((p_snapshot->>'finL')::numeric,c.fin_l),'dimW',coalesce((p_snapshot->>'finW')::numeric,c.fin_w),'dimH',coalesce((p_snapshot->>'finH')::numeric,c.fin_h),'poids',coalesce((p_snapshot->>'finP')::numeric,c.fin_p))); END IF;
 IF jsonb_typeof(prepared_boxes) IS DISTINCT FROM 'array' OR jsonb_array_length(prepared_boxes) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(prepared_boxes) WHERE NOT reception_box_measured(value)) OR divisor<=0 THEN RAISE EXCEPTION 'Mesures de chaque colis optimisé requises'; END IF;
 SELECT jsonb_agg(jsonb_build_object('dimL',(value->>'dimL')::numeric,'dimW',(value->>'dimW')::numeric,'dimH',(value->>'dimH')::numeric,'poids',(value->>'poids')::numeric) ORDER BY position) INTO prepared_boxes FROM jsonb_array_elements(prepared_boxes) WITH ORDINALITY AS boxes(value,position);
 IF c.outgoing_parcel_count IS DISTINCT FROM jsonb_array_length(prepared_boxes) THEN RAISE EXCEPTION 'Confirmez les colis physiques dans la sauvegarde de préparation avant de calculer le devis'; END IF;
 IF c.final_packages IS NOT NULL AND prepared_boxes IS DISTINCT FROM c.final_packages THEN RAISE EXCEPTION 'Enregistrez les mesures modifiées avant de calculer le devis'; END IF;
 SELECT max((value->>'dimL')::numeric),max((value->>'dimW')::numeric),max((value->>'dimH')::numeric),sum((value->>'poids')::numeric),sum((value->>'dimL')::numeric*(value->>'dimW')::numeric*(value->>'dimH')::numeric/divisor) INTO fl,fw,fh,fp,final_volume FROM jsonb_array_elements(prepared_boxes);
 pf:=greatest(fp,final_volume); transport:=round(tariff.base+pf*tariff.par_kg,2);
 fee_rows:=coalesce(p_snapshot->'fraisDivers',p_snapshot->'inputs'->'fees',c.frais_divers,'[]'::jsonb);
 IF jsonb_typeof(fee_rows)<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(fee_rows) WHERE coalesce(trim(value->>'libelle'),'')='' OR (value->>'montant')::numeric IS NULL OR (value->>'montant')::numeric<0 OR (value->>'montant')::numeric='NaN'::numeric) THEN RAISE EXCEPTION 'Frais invalides'; END IF;
 SELECT coalesce(sum(round((value->>'montant')::numeric,2)),0) INTO fees FROM jsonb_array_elements(fee_rows);
 IF client_kind='particulier' THEN
  IF NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND valide AND rejet_motif IS NULL AND duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=factures.id)) OR EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND rejet_motif IS NULL AND duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=factures.id) AND (NOT valide OR coalesce(trim(fichier_url),'')='' OR montant<=0)) THEN RAISE EXCEPTION 'Toutes les factures doivent être vérifiées et leurs documents joints'; END IF;
  IF NOT EXISTS(SELECT 1 FROM lignes WHERE colis_id=c.id AND (facture_id IS NULL OR EXISTS(SELECT 1 FROM factures source WHERE source.id=lignes.facture_id AND source.colis_id=c.id AND source.rejet_motif IS NULL AND source.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=source.id)))) OR EXISTS(SELECT 1 FROM lignes l LEFT JOIN taux_categories t ON t.categorie_id=l.categorie_id AND t.destination_code=destination WHERE l.colis_id=c.id AND (l.facture_id IS NULL OR EXISTS(SELECT 1 FROM factures source WHERE source.id=l.facture_id AND source.colis_id=c.id AND source.rejet_motif IS NULL AND source.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=source.id))) AND (t.id IS NULL OR t.om<0 OR t.omr<0 OR l.qte<=0 OR l.prix_unitaire<0)) THEN RAISE EXCEPTION 'Articles, catégories et taux de destination requis'; END IF;
  SELECT sum(qte*prix_unitaire) INTO merchandise FROM lignes WHERE colis_id=c.id AND (facture_id IS NULL OR EXISTS(SELECT 1 FROM factures source WHERE source.id=lignes.facture_id AND source.colis_id=c.id AND source.rejet_motif IS NULL AND source.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=source.id)));
  IF merchandise<=0 THEN RAISE EXCEPTION 'Valeur des marchandises positive requise'; END IF;
  SELECT round(sum((l.qte*l.prix_unitaire+transport*l.qte*l.prix_unitaire/merchandise)*t.om/100),2),round(sum((l.qte*l.prix_unitaire+transport*l.qte*l.prix_unitaire/merchandise)*t.omr/100),2) INTO om,omr FROM lignes l JOIN taux_categories t ON t.categorie_id=l.categorie_id AND t.destination_code=destination WHERE l.colis_id=c.id AND (l.facture_id IS NULL OR EXISTS(SELECT 1 FROM factures source WHERE source.id=l.facture_id AND source.colis_id=c.id AND source.rejet_motif IS NULL AND source.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=source.id)));
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
 p_snapshot:=jsonb_set(p_snapshot,'{amounts}',coalesce(p_snapshot->'amounts','{}'::jsonb)||jsonb_build_object('transport',transport,'om',om,'omr',omr,'tva',tva,'total',total,'fees',fees,'realWeight',fp,'volumetricWeight',final_volume,'billableWeight',pf,'merchandiseValue',round(coalesce(merchandise,0),2)));
 -- A before/after comparison requires measurements for every received physical carton.
 -- The scalar max L/W/H fields are a display summary and are valid as a fallback only for one legacy carton.
 original_count:=reception_carton_count(c.nb_colis,c.trackings_detail,c.trackings,c.dims_par_colis);
 original_boxes:=CASE WHEN jsonb_array_length(coalesce(c.dims_par_colis,'[]'))>0 THEN c.dims_par_colis WHEN original_count=1 THEN jsonb_build_array(jsonb_build_object('dimL',c.dim_l,'dimW',c.dim_w,'dimH',c.dim_h,'poids',c.poids)) ELSE '[]'::jsonb END;
 original_complete:=jsonb_array_length(original_boxes)=original_count AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(original_boxes) WHERE NOT reception_box_measured(value));
 IF original_complete THEN
  SELECT jsonb_agg(jsonb_build_object('dimL',(value->>'dimL')::numeric,'dimW',(value->>'dimW')::numeric,'dimH',(value->>'dimH')::numeric,'poids',(value->>'poids')::numeric) ORDER BY position) INTO original_boxes FROM jsonb_array_elements(original_boxes) WITH ORDINALITY AS boxes(value,position);
 END IF;
 p_snapshot:=jsonb_set(p_snapshot,'{inputs}',coalesce(p_snapshot->'inputs','{}'::jsonb)||jsonb_build_object('finalPackages',prepared_boxes,'finalBox',CASE WHEN jsonb_array_length(prepared_boxes)=1 THEN prepared_boxes->0 ELSE 'null'::jsonb END,'originalBoxes',CASE WHEN original_complete THEN original_boxes ELSE '[]'::jsonb END));
 IF original_complete THEN
  SELECT greatest(sum((value->>'poids')::numeric),sum((value->>'dimL')::numeric*(value->>'dimW')::numeric*(value->>'dimH')::numeric/divisor)) INTO before_pf FROM jsonb_array_elements(original_boxes);
  before_transport:=round(tariff.base+before_pf*tariff.par_kg,2);
  IF client_kind='particulier' THEN
   SELECT round(sum((l.qte*l.prix_unitaire+before_transport*l.qte*l.prix_unitaire/merchandise)*t.om/100),2),round(sum((l.qte*l.prix_unitaire+before_transport*l.qte*l.prix_unitaire/merchandise)*t.omr/100),2) INTO before_om,before_omr FROM lignes l JOIN taux_categories t ON t.categorie_id=l.categorie_id AND t.destination_code=destination WHERE l.colis_id=c.id AND (l.facture_id IS NULL OR EXISTS(SELECT 1 FROM factures source WHERE source.id=l.facture_id AND source.colis_id=c.id AND source.rejet_motif IS NULL AND source.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=source.id)));
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
  fin_l=fl,fin_w=fw,fin_h=fh,fin_p=fp,final_packages=prepared_boxes
 WHERE id=c.id RETURNING * INTO c;
 SELECT * INTO q FROM quote_versions WHERE colis_id=c.id AND version=c.quote_version;
 RETURN jsonb_build_object('colis',to_jsonb(c),'quote',to_jsonb(q));
END; $$;


CREATE OR REPLACE FUNCTION sync_staff_work_actions(p_colis_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; open_case boolean; final_ready boolean; docs_ready boolean; documents_present boolean; has_contact boolean; is_pro boolean; d timestamptz;
BEGIN
 SELECT * INTO c FROM colis WHERE id=p_colis_id;
 IF NOT FOUND THEN RETURN; END IF;
 open_case:=NOT c.archive AND c.statut NOT IN ('livre','annule');
 final_ready:=coalesce(c.fin_l>0 AND c.fin_w>0 AND c.fin_h>0 AND c.fin_p>0,false)
  AND (NOT (to_jsonb(c)?'preparation_composition_version') OR (to_jsonb(c)->>'preparation_composition_version') IS NOT DISTINCT FROM (to_jsonb(c)->>'final_measurements_version'));
 SELECT EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=factures.id) AND coalesce(trim(fichier_url),'')<>''),
  EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=factures.id) AND valide AND nullif(trim(rejet_motif),'') IS NULL AND coalesce(trim(fichier_url),'')<>'')
  AND NOT EXISTS(SELECT 1 FROM factures WHERE colis_id=c.id AND duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=factures.id) AND NOT valide AND nullif(trim(rejet_motif),'') IS NULL)
 INTO documents_present,docs_ready;
 SELECT user_id IS NOT NULL OR telegram_chat_id IS NOT NULL,type='pro' INTO has_contact,is_pro FROM clients WHERE id=c.client_id;
 d:=CASE WHEN c.next_action_source='manual' THEN c.next_action_at END;
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
