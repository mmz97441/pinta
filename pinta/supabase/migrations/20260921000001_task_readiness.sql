-- A renewed agreement does not erase a preparation that still describes the same cartons.
-- Reading a task never advances a dossier; each successful explicit command does so atomically.
CREATE FUNCTION preparation_measurements_ready(c colis) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
BEGIN
 IF c.preparation_composition_version IS NULL OR c.final_measurements_version IS NULL
  OR c.final_measurements_version<>c.preparation_composition_version THEN RETURN false; END IF;
 IF c.final_packages IS NULL OR c.final_packages='null'::jsonb THEN
  RETURN coalesce(c.outgoing_parcel_count=1 AND reception_box_measured(jsonb_build_object('dimL',c.fin_l,'dimW',c.fin_w,'dimH',c.fin_h,'poids',c.fin_p)),false);
 END IF;
 IF jsonb_typeof(c.final_packages)<>'array' THEN RETURN false; END IF;
 IF jsonb_array_length(c.final_packages) NOT BETWEEN 1 AND 100 OR c.outgoing_parcel_count IS DISTINCT FROM jsonb_array_length(c.final_packages) THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.final_packages) b WHERE NOT reception_box_measured(b));
END; $$;
REVOKE ALL ON FUNCTION preparation_measurements_ready(colis) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION preparation_measurements_ready(colis) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION save_preparation_measurements(p_colis_id uuid,p_final_packages jsonb,p_expected_updated_at timestamptz,p_expected_composition_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; real_weight numeric; max_l numeric; max_w numeric; max_h numeric;
BEGIN
 IF NOT has_permission('perm_colis_preparer') THEN RAISE EXCEPTION 'Permission préparation requise' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.statut NOT IN ('autorise','en_preparation','devis_envoye','attente_paiement') OR c.paiement_date IS NOT NULL OR c.archive OR c.produit_interdit OR c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN RAISE EXCEPTION 'Un dossier autorisé et impayé, non archivé et sans produit interdit, en préparation est requis'; END IF;
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
  statut=CASE WHEN statut IN ('autorise','devis_envoye','attente_paiement') THEN 'en_preparation'::statut_colis ELSE statut END
 WHERE id=c.id RETURNING * INTO c;
 RETURN jsonb_build_object('colis',to_jsonb(c));
END; $$;


CREATE OR REPLACE FUNCTION save_quote_customs(p_colis_id uuid,p_changes jsonb,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; l lignes; tariff customs_tariffs; item jsonb; duty jsonb; previous jsonb:='[]'; following jsonb:='[]'; destination text; rate_om numeric; rate_omr numeric; reason text; changed boolean:=false;
BEGIN
 IF NOT has_permission('perm_colis_calculer_devis') THEN RAISE EXCEPTION 'Permission devis requise' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.statut NOT IN ('autorise','en_preparation','devis_envoye','attente_paiement') OR c.archive OR c.produit_interdit OR c.paiement_date IS NOT NULL OR c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN RAISE EXCEPTION 'Préparation autorisée d’un dossier impayé et ouvert requise'; END IF;
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
   statut=CASE WHEN statut IN ('autorise','devis_envoye','attente_paiement') THEN 'en_preparation'::statut_colis ELSE statut END,updated_at=clock_timestamp() WHERE id=c.id;
  INSERT INTO audit_actions(colis_id,user_id,action,detail,before_data,after_data) VALUES(c.id,auth.uid(),'quote_customs_saved','Classification et taux du devis corrigés ; catalogue préservé',previous,following);
 END IF;
 SELECT * INTO c FROM colis WHERE id=c.id;
 RETURN jsonb_build_object('colis',to_jsonb(c),'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'custom_duty',custom_duty) ORDER BY id),'[]') FROM lignes WHERE colis_id=c.id));
END; $$;

CREATE OR REPLACE FUNCTION save_quote(p_colis_id uuid,p_snapshot jsonb,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c colis; q quote_versions; total numeric; destination text; client_kind type_client; tariff tarifs; divisor numeric; pf numeric; transport numeric; om numeric:=0; omr numeric:=0; tva numeric:=0; fees numeric:=0; merchandise numeric; fl numeric; fw numeric; fh numeric; fp numeric; fee_rows jsonb; component text; before_pf numeric; before_transport numeric; before_om numeric:=0; before_omr numeric:=0; before_tva numeric:=0; before_total numeric; saving numeric:=0; original_boxes jsonb; original_count integer; original_complete boolean; prepared_boxes jsonb; final_volume numeric; canonical_lines jsonb:='[]'; canonical_tax_lines jsonb:='[]';
BEGIN
 IF NOT has_permission('perm_colis_calculer_devis') THEN RAISE EXCEPTION 'Permission devis requise'; END IF;
 SELECT * INTO c FROM colis WHERE id=p_colis_id FOR UPDATE;
 IF NOT FOUND OR c.statut NOT IN ('autorise','en_preparation','devis_envoye','attente_paiement') OR c.archive OR c.produit_interdit OR c.paiement_date IS NOT NULL OR c.feu_vert IS DISTINCT FROM 'autorise'::statut_feu_vert THEN RAISE EXCEPTION 'Préparation autorisée d’un dossier impayé, non archivé et sans produit interdit requise'; END IF;
 IF p_expected_updated_at IS NULL OR c.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'Dossier modifié par un collègue. Rechargez le devis.'; END IF;
 SELECT left(cp,3),type INTO destination,client_kind FROM clients WHERE id=c.client_id;
 -- Frozen commercial identity comes from the database, never an arbitrary caller snapshot.
 p_snapshot:=jsonb_set(p_snapshot,'{inputs}',coalesce(p_snapshot->'inputs','{}'::jsonb)||jsonb_build_object(
  'client',(SELECT jsonb_build_object('id',cl.id,'type',cl.type,'nom',coalesce(cl.nom,'')||CASE WHEN coalesce(cl.prenom,'')<>'' THEN ' '||cl.prenom ELSE '' END,'email',coalesce(cl.email,''),'abonnement',coalesce(cl.abonnement,'freemium')) FROM clients cl WHERE cl.id=c.client_id),
  'destination',(SELECT jsonb_build_object('code',d.code,'nom',d.nom,'tva',CASE WHEN client_kind='pro' THEN 0 ELSE d.tva END) FROM destinations d WHERE d.code=destination)));
 SELECT * INTO tariff FROM tarifs WHERE destination_code=destination AND actif ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND OR tariff.base<0 OR tariff.par_kg<0 THEN RAISE EXCEPTION 'Tarif de destination absent ou invalide'; END IF;
 SELECT coalesce((value->>'diviseurVolumetrique')::numeric,5000) INTO divisor FROM app_settings WHERE key='business'; divisor:=coalesce(divisor,5000);
 IF NOT preparation_measurements_ready(c) THEN RAISE EXCEPTION 'Enregistrez les mesures après optimisation et le nombre de colis pour la composition actuelle'; END IF;
 prepared_boxes:=coalesce(nullif(p_snapshot->'finalPackages','null'::jsonb),nullif(p_snapshot->'inputs'->'finalPackages','null'::jsonb),nullif(c.final_packages,'null'::jsonb));
 IF prepared_boxes IS NULL THEN prepared_boxes:=jsonb_build_array(jsonb_build_object('dimL',coalesce((p_snapshot->>'finL')::numeric,c.fin_l),'dimW',coalesce((p_snapshot->>'finW')::numeric,c.fin_w),'dimH',coalesce((p_snapshot->>'finH')::numeric,c.fin_h),'poids',coalesce((p_snapshot->>'finP')::numeric,c.fin_p))); END IF;
 IF jsonb_typeof(prepared_boxes) IS DISTINCT FROM 'array' OR jsonb_array_length(prepared_boxes) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(prepared_boxes) WHERE NOT reception_box_measured(value)) OR divisor<=0 THEN RAISE EXCEPTION 'Mesures de chaque colis optimisé requises'; END IF;
 SELECT jsonb_agg(jsonb_build_object('dimL',(value->>'dimL')::numeric,'dimW',(value->>'dimW')::numeric,'dimH',(value->>'dimH')::numeric,'poids',(value->>'poids')::numeric) ORDER BY position) INTO prepared_boxes FROM jsonb_array_elements(prepared_boxes) WITH ORDINALITY AS boxes(value,position);
 IF c.outgoing_parcel_count IS DISTINCT FROM jsonb_array_length(prepared_boxes) THEN RAISE EXCEPTION 'Confirmez les colis physiques dans la sauvegarde de préparation avant de calculer le devis'; END IF;
 IF nullif(c.final_packages,'null'::jsonb) IS NOT NULL AND prepared_boxes IS DISTINCT FROM c.final_packages THEN RAISE EXCEPTION 'Enregistrez les mesures modifiées avant de calculer le devis'; END IF;
 IF nullif(c.final_packages,'null'::jsonb) IS NULL AND prepared_boxes IS DISTINCT FROM jsonb_build_array(jsonb_build_object('dimL',c.fin_l,'dimW',c.fin_w,'dimH',c.fin_h,'poids',c.fin_p)) THEN RAISE EXCEPTION 'Enregistrez les mesures modifiées avant de calculer le devis'; END IF;
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
 UPDATE colis SET statut=CASE WHEN statut='autorise' THEN 'en_preparation'::statut_colis ELSE statut END,devis_snapshot=p_snapshot,devis_brouillon=true,poids_facturable=round(pf,2),frais_divers=fee_rows,mode_paiement_pro=coalesce(p_snapshot->>'modePaiementPro',mode_paiement_pro),
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
 final_ready:=preparation_measurements_ready(c);
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

-- Reproject open work only; no dossier, notification or client decision is changed.
SELECT sync_staff_work_actions(id) FROM colis WHERE NOT archive AND statut IN ('autorise','en_preparation');
