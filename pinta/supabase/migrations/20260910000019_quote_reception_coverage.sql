-- Preserve the separation between reception measurements and the optimised final package.
-- Historical incomplete reception data may not produce an invented optimisation saving.
CREATE OR REPLACE FUNCTION save_quote(p_colis_id uuid,p_snapshot jsonb,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c colis; q quote_versions; total numeric; destination text; client_kind type_client; tariff tarifs; divisor numeric; pf numeric; transport numeric; om numeric:=0; omr numeric:=0; tva numeric:=0; fees numeric:=0; merchandise numeric; fl numeric; fw numeric; fh numeric; fp numeric; fee_rows jsonb; component text; before_pf numeric; before_transport numeric; before_om numeric:=0; before_omr numeric:=0; before_tva numeric:=0; before_total numeric; saving numeric:=0; original_boxes jsonb; original_count integer; original_complete boolean;
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
 -- A before/after comparison requires measurements for every received physical carton.
 -- The scalar max L/W/H fields are a display summary and are valid as a fallback only for one legacy carton.
 original_count:=reception_carton_count(c.nb_colis,c.trackings_detail,c.trackings,c.dims_par_colis);
 original_boxes:=CASE WHEN jsonb_array_length(coalesce(c.dims_par_colis,'[]'))>0 THEN c.dims_par_colis WHEN original_count=1 THEN jsonb_build_array(jsonb_build_object('dimL',c.dim_l,'dimW',c.dim_w,'dimH',c.dim_h,'poids',c.poids)) ELSE '[]'::jsonb END;
 original_complete:=jsonb_array_length(original_boxes)=original_count AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(original_boxes) WHERE NOT reception_box_measured(value));
 IF original_complete THEN
  SELECT jsonb_agg(jsonb_build_object('dimL',(value->>'dimL')::numeric,'dimW',(value->>'dimW')::numeric,'dimH',(value->>'dimH')::numeric,'poids',(value->>'poids')::numeric) ORDER BY position) INTO original_boxes FROM jsonb_array_elements(original_boxes) WITH ORDINALITY AS boxes(value,position);
 END IF;
 p_snapshot:=jsonb_set(p_snapshot,'{inputs}',coalesce(p_snapshot->'inputs','{}'::jsonb)||jsonb_build_object('originalBoxes',CASE WHEN original_complete THEN original_boxes ELSE '[]'::jsonb END));
 IF original_complete THEN
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
