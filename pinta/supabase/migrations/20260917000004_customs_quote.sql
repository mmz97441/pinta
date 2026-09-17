-- A classification belongs to this dossier's quote, never to the global category.
-- Source editions are append-only; importing a new edition never rewrites past quotes.
CREATE TABLE customs_tariffs (
 id text PRIMARY KEY, code text NOT NULL CHECK(code ~ '^[0-9]{8}([0-9]{2})?$'), label text NOT NULL CHECK(length(trim(label))>0),
 destination_code text NOT NULL REFERENCES destinations(code),
 om numeric(7,4) CHECK(om BETWEEN 0 AND 100), omr numeric(7,4) CHECK(omr BETWEEN 0 AND 100),
 source_id text NOT NULL, source_label text NOT NULL, source_url text NOT NULL,
 source_date date NOT NULL, page integer NOT NULL CHECK(page>0),
 source_status text NOT NULL CHECK(source_status IN ('historical','reference')),
 notes text, conditions text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customs_tariffs_destination_code ON customs_tariffs(destination_code,code);
ALTER TABLE customs_tariffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customs_tariffs FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION guard_customs_catalogue_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Une édition douanière est immuable. Importez une nouvelle référence.'; END; $$;
CREATE TRIGGER guard_customs_catalogue_immutable BEFORE UPDATE OR DELETE ON customs_tariffs FOR EACH ROW EXECUTE FUNCTION guard_customs_catalogue_immutable();

CREATE FUNCTION customs_search_text(p_text text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT translate(replace(replace(lower(regexp_replace(coalesce(p_text,''),E'-[ \t]*[\r\n]+[ \t]*','','g')),'œ','oe'),'æ','ae'),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc')
$$;
REVOKE ALL ON FUNCTION customs_search_text(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION search_customs_tariffs(p_query text,p_destination text,p_limit integer DEFAULT 20)
RETURNS SETOF customs_tariffs LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE query_text text; compact_code text;
BEGIN
 IF NOT is_staff() OR NOT (has_permission('perm_colis_calculer_devis') OR has_permission('perm_factures_voir') OR has_permission('perm_factures_modifier_articles')) THEN RAISE EXCEPTION 'Permission de consultation douanière requise' USING ERRCODE='42501'; END IF;
 IF p_destination IS NULL OR length(coalesce(p_query,''))>200 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Recherche douanière invalide'; END IF;
 query_text:=customs_search_text(trim(coalesce(p_query,'')));
 compact_code:=CASE WHEN query_text ~ '^[0-9[:space:]]+$' THEN regexp_replace(query_text,'[[:space:]]','','g') ELSE NULL END;
 RETURN QUERY SELECT t.* FROM customs_tariffs t WHERE t.destination_code=p_destination
  AND CASE WHEN compact_code IS NOT NULL THEN position(compact_code IN t.code)>0 ELSE NOT EXISTS(SELECT 1 FROM regexp_split_to_table(query_text,'\s+') term WHERE term<>'' AND position(term IN customs_search_text(t.code||' '||t.label||' '||coalesce(t.notes,'')||' '||coalesce(t.conditions,'')))=0) END
  ORDER BY t.code,t.source_date DESC,t.id LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION search_customs_tariffs(text,text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION search_customs_tariffs(text,text,integer) TO authenticated;

ALTER TABLE lignes ADD COLUMN custom_duty jsonb CHECK(custom_duty IS NULL OR jsonb_typeof(custom_duty)='object');
CREATE FUNCTION customs_line_fingerprint(p_line lignes) RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_object('id',p_line.id,'colis',p_line.colis_id,'facture',p_line.facture_id,
  'description',p_line.description,'quantity',p_line.qte,'price',p_line.prix_unitaire,'category',p_line.categorie_id)::text)
$$;
REVOKE ALL ON FUNCTION customs_line_fingerprint(lignes) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION guard_line_customs() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.custom_duty IS NOT NULL) OR (TG_OP='UPDATE' AND NEW.custom_duty IS DISTINCT FROM OLD.custom_duty) THEN
  IF current_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'Utilisez la correction douanière du devis' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.custom_duty IS NOT NULL AND
  (NEW.description,NEW.qte,NEW.prix_unitaire,NEW.categorie_id,NEW.facture_id,NEW.colis_id) IS DISTINCT FROM
  (OLD.description,OLD.qte,OLD.prix_unitaire,OLD.categorie_id,OLD.facture_id,OLD.colis_id) THEN
  NEW.custom_duty:=OLD.custom_duty||jsonb_build_object('stale',true,'invalidatedReason','article_changed');
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_line_customs BEFORE INSERT OR UPDATE ON lignes FOR EACH ROW EXECUTE FUNCTION guard_line_customs();

-- Without a saved quote, the older invalidation trigger did not advance the
-- dossier version when an article changed. Customs CAS must cover this case.
CREATE FUNCTION touch_customs_dossier_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE colis SET updated_at=clock_timestamp() WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.colis_id ELSE NEW.colis_id END;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER z_touch_customs_dossier_revision AFTER INSERT OR UPDATE OR DELETE ON lignes FOR EACH ROW EXECUTE FUNCTION touch_customs_dossier_revision();

CREATE FUNCTION save_quote_customs(p_colis_id uuid,p_changes jsonb,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; l lignes; tariff customs_tariffs; item jsonb; duty jsonb; previous jsonb:='[]'; following jsonb:='[]'; destination text; rate_om numeric; rate_omr numeric; reason text; changed boolean:=false;
BEGIN
 IF NOT has_permission('perm_colis_calculer_devis') THEN RAISE EXCEPTION 'Permission devis requise' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.statut NOT IN ('en_preparation','devis_envoye','attente_paiement') OR c.archive OR c.produit_interdit OR c.paiement_date IS NOT NULL OR c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN RAISE EXCEPTION 'Préparation autorisée d’un dossier impayé et ouvert requise'; END IF;
 IF p_expected_updated_at IS NULL OR c.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Le dossier a changé. Rechargez avant de corriger les taux.' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Sélectionnez de 1 à 200 articles'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_changes) v WHERE jsonb_typeof(v) IS DISTINCT FROM 'object' OR nullif(v->>'lineId','') IS NULL)
  OR (SELECT count(DISTINCT v->>'lineId') FROM jsonb_array_elements(p_changes) v)<>jsonb_array_length(p_changes) THEN RAISE EXCEPTION 'Articles absents ou répétés'; END IF;
 SELECT left(cp,3) INTO destination FROM clients WHERE id=c.client_id;
 PERFORM 1 FROM lignes WHERE colis_id=c.id ORDER BY id FOR UPDATE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  SELECT * INTO l FROM lignes WHERE id=(item->>'lineId')::uuid AND colis_id=c.id;
  IF NOT FOUND OR (l.facture_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM factures f WHERE f.id=l.facture_id AND f.colis_id=c.id AND f.valide AND f.rejet_motif IS NULL AND f.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id))) THEN RAISE EXCEPTION 'Choisissez un article actif et vérifié de ce dossier'; END IF;
  duty:=NULL;
  IF item->>'tariffId' IS NULL THEN
   IF NOT item ? 'tariffId' OR coalesce(item->'override','null'::jsonb)<>'null'::jsonb THEN RAISE EXCEPTION 'Référence douanière requise ou retour explicite à la catégorie'; END IF;
  ELSE
   SELECT * INTO tariff FROM customs_tariffs WHERE id=item->>'tariffId' AND destination_code=destination;
   IF NOT FOUND THEN RAISE EXCEPTION 'Cette référence douanière ne correspond pas à la destination'; END IF;
   rate_om:=tariff.om;rate_omr:=tariff.omr;reason:=NULL;
   IF coalesce(item->'override','null'::jsonb)<>'null'::jsonb THEN
    IF jsonb_typeof(item->'override') IS DISTINCT FROM 'object' OR jsonb_typeof(item#>'{override,om}') IS DISTINCT FROM 'number' OR jsonb_typeof(item#>'{override,omr}') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Deux taux numériques explicites sont requis'; END IF;
    rate_om:=(item#>>'{override,om}')::numeric;rate_omr:=(item#>>'{override,omr}')::numeric;reason:=trim(item#>>'{override,reason}');
    IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Expliquez la correction en 3 à 500 caractères ; ce motif figure dans le devis'; END IF;
   END IF;
   IF rate_om IS NULL OR rate_omr IS NULL OR rate_om NOT BETWEEN 0 AND 100 OR rate_omr NOT BETWEEN 0 AND 100 OR rate_om<>round(rate_om,4) OR rate_omr<>round(rate_omr,4) THEN RAISE EXCEPTION 'Deux taux de 0 à 100 %%, à quatre décimales maximum, sont requis. Vérifiez les conditions de cette référence.'; END IF;
   duty:=jsonb_build_object('tariffId',tariff.id,'code',tariff.code,'label',tariff.label,'destination',destination,
    'baseRates',jsonb_build_object('om',tariff.om,'omr',tariff.omr),'rates',jsonb_build_object('om',rate_om,'omr',rate_omr),
    'source',jsonb_build_object('id',tariff.source_id,'label',tariff.source_label,'url',tariff.source_url,'date',tariff.source_date,'page',tariff.page,'status',tariff.source_status),
    'notes',tariff.notes,'conditions',tariff.conditions,'overrideReason',reason,'fingerprint',customs_line_fingerprint(l));
  END IF;
  IF l.custom_duty IS DISTINCT FROM duty THEN
   previous:=previous||jsonb_build_array(jsonb_build_object('lineId',l.id,'customDuty',l.custom_duty));
   UPDATE lignes SET custom_duty=duty WHERE id=l.id;
   following:=following||jsonb_build_array(jsonb_build_object('lineId',l.id,'customDuty',duty));changed:=true;
  END IF;
 END LOOP;
 IF changed THEN
  -- Also advance the dossier CAS when no quote has been calculated yet.
  UPDATE colis SET devis_brouillon=true,payplug_payment_id=NULL,payplug_payment_url=NULL,
   statut=CASE WHEN statut IN ('devis_envoye','attente_paiement') THEN 'en_preparation'::statut_colis ELSE statut END,updated_at=clock_timestamp() WHERE id=c.id;
  INSERT INTO audit_actions(colis_id,user_id,action,detail,before_data,after_data) VALUES(c.id,auth.uid(),'quote_customs_saved','Classification et taux du devis corrigés ; catalogue préservé',previous,following);
 END IF;
 SELECT * INTO c FROM colis WHERE id=c.id;
 RETURN jsonb_build_object('colis',to_jsonb(c),'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'custom_duty',custom_duty) ORDER BY id),'[]') FROM lignes WHERE colis_id=c.id));
END; $$;
REVOKE ALL ON FUNCTION save_quote_customs(uuid,jsonb,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION save_quote_customs(uuid,jsonb,timestamptz) TO authenticated;

-- Internal canonical source, shared by the quote's current and before-optimisation calculations.
CREATE FUNCTION quote_customs_lines(p_colis_id uuid,p_destination text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l lignes; cat categories; old_rate taux_categories; duty jsonb; rate_om numeric; rate_omr numeric; result jsonb:='[]';
BEGIN
 FOR l IN SELECT line.* FROM lignes line WHERE line.colis_id=p_colis_id AND (line.facture_id IS NULL OR EXISTS(
  SELECT 1 FROM factures f WHERE f.id=line.facture_id AND f.colis_id=p_colis_id AND f.rejet_motif IS NULL AND f.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id))) ORDER BY line.id LOOP
  SELECT * INTO cat FROM categories WHERE id=l.categorie_id;
  duty:=l.custom_duty;
  IF duty IS NOT NULL THEN
   IF duty->>'stale'='true' OR duty->>'destination' IS DISTINCT FROM p_destination OR duty->>'fingerprint' IS DISTINCT FROM customs_line_fingerprint(l) THEN RAISE EXCEPTION 'La classification douanière de « % » doit être vérifiée à nouveau',l.description; END IF;
   IF NOT EXISTS(SELECT 1 FROM customs_tariffs t WHERE t.id=duty->>'tariffId' AND t.destination_code=p_destination) OR jsonb_typeof(duty#>'{rates,om}') IS DISTINCT FROM 'number' OR jsonb_typeof(duty#>'{rates,omr}') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Classification douanière incomplète'; END IF;
   rate_om:=(duty#>>'{rates,om}')::numeric;rate_omr:=(duty#>>'{rates,omr}')::numeric;
  ELSE
   SELECT * INTO old_rate FROM taux_categories WHERE categorie_id=l.categorie_id AND destination_code=p_destination;
   rate_om:=old_rate.om;rate_omr:=old_rate.omr;
  END IF;
  IF rate_om IS NULL OR rate_omr IS NULL OR rate_om NOT BETWEEN 0 AND 100 OR rate_omr NOT BETWEEN 0 AND 100 OR l.qte<=0 OR l.prix_unitaire<0 THEN RAISE EXCEPTION 'Articles, classifications et taux de destination requis'; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('id',l.id,'factureId',l.facture_id,'description',l.description,'quantity',l.qte,'unitPrice',l.prix_unitaire,'categoryId',cat.id,'categoryLabel',cat.label,'rates',jsonb_build_object('om',rate_om,'omr',rate_omr))||CASE WHEN duty IS NOT NULL THEN jsonb_build_object('customDuty',duty) ELSE '{}'::jsonb END);
 END LOOP;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION quote_customs_lines(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Server calculation retains the preparation, document, quote-version and payment gates.
CREATE OR REPLACE FUNCTION save_quote(p_colis_id uuid,p_snapshot jsonb,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; q quote_versions; total numeric; destination text; client_kind type_client; tariff tarifs; divisor numeric; pf numeric; transport numeric; om numeric:=0; omr numeric:=0; tva numeric:=0; fees numeric:=0; merchandise numeric; fl numeric; fw numeric; fh numeric; fp numeric; fee_rows jsonb; component text; before_pf numeric; before_transport numeric; before_om numeric:=0; before_omr numeric:=0; before_tva numeric:=0; before_total numeric; saving numeric:=0; original_boxes jsonb; original_count integer; original_complete boolean; prepared_boxes jsonb; final_volume numeric; canonical_lines jsonb:='[]'; canonical_tax_lines jsonb:='[]';
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
  canonical_lines:=quote_customs_lines(c.id,destination);
  IF jsonb_array_length(canonical_lines)=0 THEN RAISE EXCEPTION 'Articles vérifiés requis'; END IF;
  SELECT sum((v->>'quantity')::numeric*(v->>'unitPrice')::numeric) INTO merchandise FROM jsonb_array_elements(canonical_lines) v;
  IF merchandise<=0 THEN RAISE EXCEPTION 'Valeur des marchandises positive requise'; END IF;
  SELECT round(sum(((v->>'quantity')::numeric*(v->>'unitPrice')::numeric+transport*(v->>'quantity')::numeric*(v->>'unitPrice')::numeric/merchandise)*(v#>>'{rates,om}')::numeric/100),2),
   round(sum(((v->>'quantity')::numeric*(v->>'unitPrice')::numeric+transport*(v->>'quantity')::numeric*(v->>'unitPrice')::numeric/merchandise)*(v#>>'{rates,omr}')::numeric/100),2) INTO om,omr FROM jsonb_array_elements(canonical_lines) v;
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
 -- Freeze verified per-line evidence; caller-supplied labels, rates and provenance are not authoritative.
 p_snapshot:=jsonb_set(p_snapshot,'{inputs,lines}',canonical_lines);
 SELECT coalesce(jsonb_agg(v||jsonb_build_object('value',val,'transportShare',share,'cif',val+share,'om',(val+share)*(v#>>'{rates,om}')::numeric/100,'omr',(val+share)*(v#>>'{rates,omr}')::numeric/100)),'[]') INTO canonical_tax_lines
 FROM (SELECT v,(v->>'quantity')::numeric*(v->>'unitPrice')::numeric val,transport*(v->>'quantity')::numeric*(v->>'unitPrice')::numeric/merchandise share FROM jsonb_array_elements(canonical_lines) v) computed;
 p_snapshot:=jsonb_set(p_snapshot,'{amounts,taxLines}',canonical_tax_lines);
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
   SELECT round(sum(((v->>'quantity')::numeric*(v->>'unitPrice')::numeric+before_transport*(v->>'quantity')::numeric*(v->>'unitPrice')::numeric/merchandise)*(v#>>'{rates,om}')::numeric/100),2),
    round(sum(((v->>'quantity')::numeric*(v->>'unitPrice')::numeric+before_transport*(v->>'quantity')::numeric*(v->>'unitPrice')::numeric/merchandise)*(v#>>'{rates,omr}')::numeric/100),2) INTO before_om,before_omr FROM jsonb_array_elements(canonical_lines) v;
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

-- Rechecking an invoice never silently inherits or discards its previous customs decision.
CREATE OR REPLACE FUNCTION save_invoice_review(p_facture_id uuid,p_expected_review_token text,p_expected_file_url text,p_lines jsonb,p_total numeric,p_vendeur text,p_extraction_id uuid DEFAULT NULL,p_confirm boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f factures; c colis; e ocr_extractions; item jsonb; subtotal numeric; result jsonb; old_data jsonb; destination text; customs_were_reviewed boolean;
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
 SELECT EXISTS(SELECT 1 FROM lignes WHERE facture_id=f.id AND custom_duty IS NOT NULL) INTO customs_were_reviewed;
 DELETE FROM lignes WHERE facture_id=f.id;
 INSERT INTO lignes(colis_id,facture_id,ocr_extraction_id,description,qte,prix_unitaire,categorie_id,custom_duty)
 SELECT f.colis_id,f.id,p_extraction_id,trim(value->>'desc'),(value->>'qte')::integer,(value->>'prix')::numeric,(value->>'cat')::uuid,CASE WHEN customs_were_reviewed THEN jsonb_build_object('stale',true,'invalidatedReason','invoice_review_changed') ELSE NULL END FROM jsonb_array_elements(p_lines);
 UPDATE factures SET vendeur=trim(p_vendeur),montant=p_total,valide=true,valide_par=auth.uid(),valide_le=clock_timestamp(),ocr_status=CASE WHEN p_extraction_id IS NOT NULL THEN 'confirmed' ELSE ocr_status END,ocr_error=NULL WHERE id=f.id RETURNING * INTO f;
 IF p_extraction_id IS NOT NULL THEN UPDATE ocr_extractions SET status='confirmed',lines=p_lines,total=p_total,vendeur=trim(p_vendeur),confirmed_at=clock_timestamp(),confirmed_by=auth.uid() WHERE id=p_extraction_id; END IF;
 DELETE FROM invoice_review_drafts WHERE facture_id=f.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'desc',description,'qte',qte,'prix',prix_unitaire,'cat',categorie_id,'customDuty',custom_duty) ORDER BY created_at,id),'[]') INTO result FROM lignes WHERE facture_id=f.id;
 INSERT INTO audit_actions(colis_id,user_id,action,detail,before_data,after_data) VALUES(f.colis_id,auth.uid(),'invoice_review_confirmed','Facture et articles vérifiés ensemble',old_data,jsonb_build_object('facture',to_jsonb(f),'articles',result));
 RETURN jsonb_build_object('success',true,'confirmed',true,'facture',to_jsonb(f),'insertedLignes',result,'reviewToken',invoice_review_token(f.id));
END; $$;

-- Exported customs evidence comes from the paid quote when available.
CREATE OR REPLACE FUNCTION confirm_departure(p_envoi_id uuid,p_loaded jsonb,p_expected_updated_at timestamptz,p_deferred_reason text DEFAULT NULL) RETURNS envois LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
   'lignes',coalesce((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('custom_duty',coalesce((SELECT v->'customDuty' FROM jsonb_array_elements(coalesce(c.devis_snapshot#>'{inputs,lines}','[]')) v WHERE v->>'id'=l.id::text LIMIT 1),l.custom_duty))) FROM lignes l WHERE l.colis_id=c.id AND (l.facture_id IS NULL OR EXISTS(SELECT 1 FROM factures f WHERE f.id=l.facture_id AND f.valide AND nullif(trim(f.rejet_motif),'') IS NULL AND f.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)))),'[]'),
   'factures',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM factures f WHERE f.colis_id=c.id AND f.valide AND nullif(trim(f.rejet_motif),'') IS NULL AND f.duplicate_of_facture_id IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)),'[]'),
   'categories',coalesce((SELECT jsonb_agg(to_jsonb(cat)) FROM categories cat WHERE cat.id IN(SELECT categorie_id FROM lignes WHERE colis_id=c.id)),'[]')));
 END LOOP;
 UPDATE envois SET statut='parti',departed_at=depart_time,manifest_version=1,nb_colis=cardinality(ids),poids_total=(SELECT sum((i->'colis'->>'fin_p')::numeric) FROM jsonb_array_elements(items) i),volume_total=(SELECT sum(CASE WHEN jsonb_typeof(i->'colis'->'final_packages')='array' AND jsonb_array_length(i->'colis'->'final_packages')>0 THEN (SELECT sum((b->>'dimL')::numeric*(b->>'dimW')::numeric*(b->>'dimH')::numeric/1000000.0) FROM jsonb_array_elements(i->'colis'->'final_packages') b) ELSE (i->'colis'->>'fin_l')::numeric*(i->'colis'->>'fin_w')::numeric*(i->'colis'->>'fin_h')::numeric/1000000.0 END) FROM jsonb_array_elements(items) i) WHERE id=e.id RETURNING * INTO e;
 INSERT INTO departure_manifests(envoi_id,confirmed_at,confirmed_by,snapshot) VALUES(e.id,depart_time,auth.uid(),jsonb_build_object('envoi',to_jsonb(e),'confirmed_at',depart_time,'items',items,'deferred',deferred,'excluded',excluded));
 PERFORM set_config('expedile.confirm_departure','',true);
 INSERT INTO audit_actions(user_id,action,detail) VALUES(auth.uid(),'departure_confirmed',jsonb_build_object('envoi_id',e.id,'loaded_ids',ids,'legacy_measurements_confirmed_ids',(SELECT coalesce(jsonb_agg(i->'colis'->>'id'),'[]') FROM jsonb_array_elements(items) i WHERE (i->>'legacy_measurements_confirmed')::boolean),'deferred',deferred,'excluded',excluded,'physical_parcels',(SELECT sum((i->'colis'->>'outgoing_parcel_count')::integer) FROM jsonb_array_elements(items) i))::text);
 RETURN e;
END; $$;
