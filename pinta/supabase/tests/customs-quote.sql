BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
-- Even legacy broad grants cannot permit catalogue writes or direct line overrides.
CREATE FUNCTION customs_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF;RAISE NOTICE 'PASS: %',label;END; $$;
CREATE FUNCTION customs_reject(command text,label text,expected text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE command;EXCEPTION WHEN OTHERS THEN IF expected IS NOT NULL AND SQLSTATE<>expected THEN RAISE EXCEPTION 'FAIL wrong error % for %: %',SQLSTATE,label,SQLERRM;END IF;RAISE NOTICE 'PASS rejected: %',label;RETURN;END;RAISE EXCEPTION 'FAIL accepted: %',label;END; $$;
SELECT customs_assert((SELECT count(*)=10790 FROM customs_tariffs WHERE source_id='reunion-2026-dcp2026-0296'),'official reference contains exactly 10790 distinct printed rows');
SELECT customs_assert((SELECT count(*)=2 FROM customs_tariffs WHERE source_id='reunion-2026-dcp2026-0296' AND (om IS NULL OR omr IS NULL)),'two ambiguous printed rates stay NULL');
SELECT customs_assert((SELECT count(*)=27 FROM customs_tariffs WHERE source_id='reunion-2026-dcp2026-0296' AND length(code)=10),'all 27 ten-digit printed variants are preserved');
SELECT customs_assert(EXISTS(SELECT 1 FROM customs_tariffs WHERE source_id='reunion-2026-dcp2026-0296' AND code='01012100'),'nomenclature keeps exact leading zero codes');
SELECT customs_assert((SELECT min(page)=26 AND max(page)=346 AND bool_and(source_date='2026-06-05'::date) FROM customs_tariffs WHERE source_id='reunion-2026-dcp2026-0296'),'consolidated June source keeps publication date and exact PDF page coverage');
SELECT customs_assert((SELECT count(*)=2 AND count(*) FILTER(WHERE om=3 AND omr=2)=1 AND count(*) FILTER(WHERE om=0 AND omr=0 AND conditions LIKE 'EX :%' AND page=136)=1 FROM customs_tariffs WHERE source_id='reunion-2026-dcp2026-0296' AND code='30063000'),'June radiopharmaceutical exception preserves general rates and explicit zero-rate variant');
INSERT INTO auth.users(id,email) VALUES('fc100000-0000-4000-8000-000000000001','customs-quote@example.test'),('fc100000-0000-4000-8000-000000000002','customs-reader@example.test'),('fc100000-0000-4000-8000-000000000003','customs-client@example.test'),('fc100000-0000-4000-8000-000000000004','customs-director@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role) VALUES
('fc110000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','Quote operator','customs-quote@example.test','preparateur'),
('fc110000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000002','Documents operator','customs-reader@example.test','preparateur'),
('fc110000-0000-4000-8000-000000000004','fc100000-0000-4000-8000-000000000004','Direction','customs-director@example.test','directeur');
INSERT INTO staff_permissions(staff_id,perm_colis_calculer_devis,perm_factures_voir,perm_factures_modifier_articles) VALUES
('fc110000-0000-4000-8000-000000000001',true,false,false),('fc110000-0000-4000-8000-000000000002',false,true,true);
INSERT INTO clients(id,user_id,nom,cp,type) VALUES('fc200000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000003','Customs client','97400','particulier');
INSERT INTO colis(id,client_id,statut,nb_colis,dims_par_colis,feu_vert) VALUES
('fc300000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','en_preparation',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":3}]','autorise'),
('fc300000-0000-4000-8000-000000000002','fc200000-0000-4000-8000-000000000001','en_preparation',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":3}]','autorise');
INSERT INTO categories(id,label) VALUES('fc400000-0000-4000-8000-000000000001','Legacy customs category');
INSERT INTO taux_categories(categorie_id,destination_code,om,omr) VALUES('fc400000-0000-4000-8000-000000000001','974',10,2.5);
UPDATE tarifs SET base=10,par_kg=5 WHERE destination_code='974';UPDATE destinations SET tva=8.5 WHERE code='974';
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES
('fc500000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000001','Original',100,'fc300000-0000-4000-8000-000000000001/original.pdf',true),
('fc500000-0000-4000-8000-000000000002','fc300000-0000-4000-8000-000000000001','Copy',100,'fc300000-0000-4000-8000-000000000001/copy.pdf',true);
INSERT INTO storage.objects(bucket_id,name) SELECT 'factures',fichier_url FROM factures WHERE colis_id='fc300000-0000-4000-8000-000000000001';
INSERT INTO lignes(id,colis_id,facture_id,description,qte,prix_unitaire,categorie_id) VALUES
('fc600000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','Original invoice description',1,100,'fc400000-0000-4000-8000-000000000001'),
('fc600000-0000-4000-8000-000000000002','fc300000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000002','Excluded copy',1,100,'fc400000-0000-4000-8000-000000000001'),
('fc600000-0000-4000-8000-000000000003','fc300000-0000-4000-8000-000000000002',NULL,'Other dossier',1,100,'fc400000-0000-4000-8000-000000000001');
UPDATE factures SET duplicate_of_facture_id='fc500000-0000-4000-8000-000000000001' WHERE id='fc500000-0000-4000-8000-000000000002';
INSERT INTO customs_tariffs(id,code,label,destination_code,om,omr,source_id,source_label,source_url,source_date,page,source_status,conditions) VALUES
('test-p410-r1','00999997','Official test designation','974',20,3,'test-reference','Test reference','https://example.test/customs.pdf','2025-12-18',410,'reference',NULL),
('test-p411-r1','00999997','Official conditional variant','974',NULL,NULL,'test-reference','Test reference','https://example.test/customs.pdf','2025-12-18',411,'reference','Verify the printed exception'),
('test-p412-r1','0099999701',E'Vêtement en fibres arti-\nficielles, œillets — ten digit variant','974',0,0,'test-reference','Test reference','https://example.test/customs.pdf','2025-12-18',412,'reference',NULL),
('test-p413-r1','00999997','Other destination','972',10,2.5,'test-reference','Test reference','https://example.test/customs.pdf','2025-12-18',413,'reference',NULL);
CREATE FUNCTION customs_change(tariff text DEFAULT 'test-p410-r1',ov jsonb DEFAULT NULL,line_id uuid DEFAULT 'fc600000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_array(jsonb_build_object('lineId',line_id,'tariffId',tariff,'override',ov)) $$;
CREATE FUNCTION customs_save(tariff text DEFAULT 'test-p410-r1',ov jsonb DEFAULT NULL,line_id uuid DEFAULT 'fc600000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT save_quote_customs(id,customs_change(tariff,ov,line_id),updated_at) FROM colis WHERE id='fc300000-0000-4000-8000-000000000001' $$;
CREATE FUNCTION customs_quote(om numeric,omr numeric,tva numeric,total numeric) RETURNS jsonb LANGUAGE sql AS $$ SELECT save_quote(id,jsonb_build_object('devisTransport',20,'devisOM',om,'devisOMR',omr,'devisTVA',tva,'devisTotal',total,'inputs',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('description','FORGED','rates',jsonb_build_object('om',99,'omr',99))))),updated_at) FROM colis WHERE id='fc300000-0000-4000-8000-000000000001' $$;
SELECT customs_assert(NOT has_function_privilege('anon','save_quote_customs(uuid,jsonb,timestamptz)','EXECUTE') AND NOT has_function_privilege('authenticated','quote_customs_lines(uuid,text)','EXECUTE'),'anonymous and direct internal helper denied');
SELECT customs_reject($q$UPDATE customs_tariffs SET om=0 WHERE id='test-p410-r1'$q$,'even catalogue owner cannot rewrite an edition');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000003',true);
SELECT customs_reject($q$SELECT search_customs_tariffs('00999997','974')$q$,'client cannot search staff tariff reference','42501');
SELECT customs_reject($q$SELECT save_quote_customs('fc300000-0000-4000-8000-000000000001',customs_change(),now())$q$,'client cannot correct quote tax','42501');
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000002',true);
SELECT customs_assert((SELECT count(*)=3 FROM search_customs_tariffs('00999997','974')),'reader sees same-code exceptions and ten-digit codes, destination scoped');
SELECT customs_assert((SELECT count(*)=1 FROM search_customs_tariffs('vetement artificielles oeillet','974')),'search ignores accents, ligatures and source line-break hyphenation');
SELECT customs_assert((SELECT count(*)=3 FROM search_customs_tariffs('00 99 99 97','974')),'search accepts spaced customs codes');
SELECT customs_assert(EXISTS(SELECT 1 FROM search_customs_tariffs('vetement','974') WHERE source_id='reunion-2026-dcp2026-0296'),'real reference is searchable without French accents');
SELECT customs_reject($q$SELECT customs_save()$q$,'article editor without quote permission cannot override rates','42501');
SELECT customs_reject($q$UPDATE lignes SET custom_duty='{"rates":{"om":0,"omr":0}}' WHERE id='fc600000-0000-4000-8000-000000000001'$q$,'direct override denied even with article permission and broad grants','42501');
SELECT customs_reject($q$INSERT INTO customs_tariffs SELECT 'forged',code,label,destination_code,0,0,source_id,source_label,source_url,source_date,page,source_status,notes,conditions,created_at FROM search_customs_tariffs('00999997','974',1)$q$,'catalogue RLS denies forged rows even with broad grants','42501');
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
SELECT customs_reject($q$SELECT save_quote_customs('fc300000-0000-4000-8000-000000000001',NULL,now())$q$,'null changes rejected');
SELECT customs_reject($q$SELECT save_quote_customs('fc300000-0000-4000-8000-000000000001',customs_change(),NULL)$q$,'null expected revision rejected','40001');
SELECT customs_reject($q$SELECT save_quote_customs('fc300000-0000-4000-8000-000000000001',customs_change(),'2000-01-01')$q$,'stale expected revision rejected','40001');
SELECT customs_reject($q$SELECT customs_save('test-p413-r1')$q$,'reference from other destination rejected');
SELECT customs_reject($q$SELECT customs_save('test-p410-r1',NULL,'fc600000-0000-4000-8000-000000000003')$q$,'article from other dossier rejected');
SELECT customs_reject($q$SELECT customs_save('test-p410-r1',NULL,'fc600000-0000-4000-8000-000000000002')$q$,'excluded duplicate cannot acquire tax decision');
SELECT customs_reject($q$SELECT customs_save('test-p411-r1')$q$,'ambiguous source does not invent zero rates');
SELECT customs_reject($q$SELECT customs_save('test-p410-r1','{"om":0,"reason":"Checked"}')$q$,'incomplete override rejected');
SELECT customs_reject($q$SELECT customs_save('test-p410-r1','{"om":0,"omr":0,"reason":""}')$q$,'override requires public factual reason');
SELECT customs_reject($q$SELECT customs_save('test-p410-r1','{"om":101,"omr":0,"reason":"Checked"}')$q$,'out of range override rejected');
SELECT customs_reject($q$SELECT customs_save('test-p410-r1','{"om":"NaN","omr":0,"reason":"Checked"}')$q$,'nonnumeric override rejected');
SELECT customs_reject($q$SELECT save_quote_customs(id,customs_change()||customs_change('test-p413-r1',NULL,'fc600000-0000-4000-8000-000000000003'),updated_at) FROM colis WHERE id='fc300000-0000-4000-8000-000000000001'$q$,'invalid second item rolls back all classifications');
SELECT customs_assert((SELECT custom_duty IS NULL FROM lignes WHERE id='fc600000-0000-4000-8000-000000000001'),'failed batch has no partial classification');
SELECT customs_save();
SELECT customs_assert((SELECT custom_duty->>'code'='00999997' AND custom_duty->>'label'='Official test designation' AND custom_duty#>>'{source,page}'='410' AND custom_duty#>>'{rates,om}'='20.0000' FROM lignes WHERE id='fc600000-0000-4000-8000-000000000001'),'server supplies code, designation, rates and provenance');
SELECT customs_assert((SELECT valide AND montant=100 FROM factures WHERE id='fc500000-0000-4000-8000-000000000001') AND (SELECT description='Original invoice description' AND qte=1 AND prix_unitaire=100 FROM lignes WHERE id='fc600000-0000-4000-8000-000000000001'),'classification preserves invoice approval and commercial articles');
SELECT customs_assert((SELECT om=10 AND omr=2.5 FROM taux_categories WHERE categorie_id='fc400000-0000-4000-8000-000000000001' AND destination_code='974'),'classification never modifies category tax rates');
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000004',true);
SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM colis WHERE id='fc300000-0000-4000-8000-000000000001';
SELECT customs_quote(24,3.6,4.05,51.65);
SELECT customs_assert((SELECT devis_total=51.65 AND (devis_snapshot#>>'{before,om}')::numeric=26.8 AND (devis_snapshot#>>'{amounts,merchandiseValue}')::numeric=100 FROM colis WHERE id='fc300000-0000-4000-8000-000000000001'),'SQL current and before quote use selected rates, excluding duplicate merchandise');
SELECT customs_assert((SELECT devis_snapshot#>>'{inputs,lines,0,description}'='Original invoice description' AND devis_snapshot#>>'{inputs,lines,0,customDuty,code}'='00999997' AND (devis_snapshot#>>'{amounts,taxLines,0,om}')::numeric=24 FROM colis WHERE id='fc300000-0000-4000-8000-000000000001'),'forged snapshot detail is replaced by canonical persisted evidence');
SELECT customs_reject($q$SELECT customs_quote(12,3,2.98,37.98)$q$,'old category total cannot bypass chosen tariff');
RESET ROLE;
UPDATE colis SET statut='devis_envoye',devis_brouillon=false WHERE id='fc300000-0000-4000-8000-000000000001';
INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status) SELECT id,quote_version,5165,'pending' FROM colis WHERE id='fc300000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT customs_save('test-p410-r1','{"om":5,"omr":0,"reason":"Taux vérifié pour ce devis"}');
SELECT customs_assert((SELECT devis_total IS NULL AND devis_brouillon AND statut='en_preparation' AND payplug_payment_url IS NULL FROM colis WHERE id='fc300000-0000-4000-8000-000000000001'),'published quote is invalidated by explicit correction');
SELECT customs_assert((SELECT status='superseded' FROM payment_intents WHERE colis_id='fc300000-0000-4000-8000-000000000001'),'previous payment intent superseded');
SELECT customs_quote(6,0,2.21,28.21);
SELECT customs_assert((SELECT (devis_snapshot#>>'{inputs,lines,0,customDuty,baseRates,om}')::numeric=20 AND (devis_snapshot#>>'{inputs,lines,0,rates,om}')::numeric=5 FROM colis WHERE id='fc300000-0000-4000-8000-000000000001'),'snapshot freezes reference and override separately');
SELECT customs_save('test-p411-r1','{"om":0,"omr":0,"reason":"Exonération vérifiée pour cet article"}');
SELECT customs_quote(0,0,1.70,21.70);
SELECT customs_assert((SELECT custom_duty#>'{baseRates,om}'='null'::jsonb AND (custom_duty#>>'{rates,om}')::numeric=0 FROM lignes WHERE id='fc600000-0000-4000-8000-000000000001'),'explicit exemption differs from missing printed rate');
SELECT customs_save(NULL,NULL);
SELECT customs_quote(12,3,2.98,37.98);
SELECT customs_assert((SELECT custom_duty IS NULL FROM lignes WHERE id='fc600000-0000-4000-8000-000000000001'),'explicit clear restores unchanged legacy category');
SELECT customs_save();
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000002',true);
UPDATE lignes SET description='Corrected article description' WHERE id='fc600000-0000-4000-8000-000000000001';
SELECT customs_assert((SELECT custom_duty->>'stale'='true' AND custom_duty->>'code'='00999997' FROM lignes WHERE id='fc600000-0000-4000-8000-000000000001'),'article edit preserves decision evidence marked stale');
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000004',true);
SELECT customs_reject($q$SELECT customs_quote(24,3.6,4.05,51.65)$q$,'stale article classification blocks quote without silent category fallback');
SELECT customs_save();
SELECT save_invoice_review(f.id,v->>'reviewToken',f.fichier_url,'[{"desc":"Reviewed invoice again","qte":1,"prix":100,"cat":"fc400000-0000-4000-8000-000000000001"}]',100,'Verified vendor') FROM factures f CROSS JOIN LATERAL jsonb_array_elements(get_invoice_review_context(f.colis_id)->'invoices') v WHERE f.id='fc500000-0000-4000-8000-000000000001' AND v->>'factureId'=f.id::text;
SELECT customs_assert((SELECT custom_duty->>'stale'='true' AND custom_duty->>'invalidatedReason'='invoice_review_changed' FROM lignes WHERE facture_id='fc500000-0000-4000-8000-000000000001'),'invoice revalidation with new article IDs requires fresh customs choice');
SELECT customs_reject($q$SELECT customs_quote(12,3,2.98,37.98)$q$,'recreated invoice articles cannot silently fall back to legacy rates');
SELECT customs_save('test-p410-r1',NULL,(SELECT id FROM lignes WHERE facture_id='fc500000-0000-4000-8000-000000000001'));
RESET ROLE;
UPDATE clients SET cp='97200' WHERE id='fc200000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT customs_reject($q$SELECT customs_quote(24,3.6,4.05,51.65)$q$,'destination change requires a new destination-specific choice');
RESET ROLE;
UPDATE clients SET cp='97400' WHERE id='fc200000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT customs_quote(24,3.6,4.05,51.65);
RESET ROLE;
UPDATE colis SET statut='devis_envoye',devis_brouillon=false WHERE id='fc300000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT mark_manual_payment(id,devis_total) FROM colis WHERE id='fc300000-0000-4000-8000-000000000001';
SELECT customs_reject($q$SELECT customs_save('test-p410-r1','{"om":0,"omr":0,"reason":"Forbidden paid correction"}',(SELECT id FROM lignes WHERE facture_id='fc500000-0000-4000-8000-000000000001'))$q$,'paid quote classification cannot change');
RESET ROLE;
SELECT customs_assert((SELECT count(*)>2 FROM quote_versions WHERE colis_id='fc300000-0000-4000-8000-000000000001') AND EXISTS(SELECT 1 FROM quote_versions WHERE colis_id='fc300000-0000-4000-8000-000000000001' AND (snapshot#>>'{inputs,lines,0,customDuty,rates,om}')::numeric=5),'previous quote customs evidence survives later corrections');
SELECT customs_assert(EXISTS(SELECT 1 FROM audit_actions WHERE colis_id='fc300000-0000-4000-8000-000000000001' AND action='quote_customs_saved' AND before_data IS NOT NULL AND after_data IS NOT NULL AND user_id IS NOT NULL),'customs decisions retain before/after and actor audit');
INSERT INTO envois(id,ref,destination_code,statut,date_depart) VALUES('fc700000-0000-4000-8000-000000000001','CUSTOMS-DEPARTURE','974','planifie',(now() AT TIME ZONE 'Europe/Paris')::date);
UPDATE colis SET envoi_id='fc700000-0000-4000-8000-000000000001' WHERE id='fc300000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT confirm_departure(e.id,(SELECT jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at,'outgoing_parcel_count',outgoing_parcel_count)) FROM colis WHERE envoi_id=e.id),e.updated_at) FROM envois e WHERE e.id='fc700000-0000-4000-8000-000000000001';
SELECT customs_assert((SELECT jsonb_array_length(snapshot#>'{items,0,lignes}')=1 AND snapshot#>>'{items,0,lignes,0,custom_duty,code}'='00999997' AND jsonb_array_length(snapshot#>'{items,0,factures}')=1 FROM (SELECT get_departure_manifest('fc700000-0000-4000-8000-000000000001') snapshot) manifest),'departure manifest freezes paid customs classification and excludes duplicate source');
RESET ROLE;
UPDATE profiles SET actif=false WHERE id='fc100000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
SELECT customs_reject($q$SELECT search_customs_tariffs('00999997','974')$q$,'inactive profile cannot consult retained tariff permission','42501');
SELECT customs_reject($q$SELECT save_quote_customs('fc300000-0000-4000-8000-000000000001',customs_change(),now())$q$,'inactive profile cannot mutate despite retained quote permission','42501');
RESET ROLE;
ROLLBACK;
