BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE FUNCTION ready_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label;END IF;RAISE NOTICE 'PASS: %',label;END; $$;
CREATE FUNCTION ready_reject(command text,label text,expected text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE command;EXCEPTION WHEN OTHERS THEN IF expected IS NOT NULL AND SQLSTATE<>expected THEN RAISE EXCEPTION 'FAIL wrong error % for %: %',SQLSTATE,label,SQLERRM;END IF;RAISE NOTICE 'PASS rejected: % (%)',label,SQLERRM;RETURN;END;RAISE EXCEPTION 'FAIL accepted: %',label;END; $$;
INSERT INTO auth.users(id,email) VALUES('dd000000-0000-4000-8000-000000000001','readiness-director@example.test'),('dd000000-0000-4000-8000-000000000002','readiness-preparer@example.test'),('dd000000-0000-4000-8000-000000000003','readiness-quote@example.test'),('dd000000-0000-4000-8000-000000000004','readiness-client@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('dd100000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000001','Direction','readiness-director@example.test','directeur',false),
 ('dd100000-0000-4000-8000-000000000002','dd000000-0000-4000-8000-000000000002','Préparation','readiness-preparer@example.test','preparateur',false),
 ('dd100000-0000-4000-8000-000000000003','dd000000-0000-4000-8000-000000000003','Devis','readiness-quote@example.test','preparateur',false);
INSERT INTO staff_permissions(staff_id,perm_colis_preparer,perm_colis_calculer_devis) VALUES
 ('dd100000-0000-4000-8000-000000000002',true,false),('dd100000-0000-4000-8000-000000000003',false,true);
INSERT INTO clients(id,user_id,nom,cp,type) VALUES('dd200000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000004','Client particulier','97400','particulier'),('dd200000-0000-4000-8000-000000000002',NULL,'Client professionnel','97400','pro');
INSERT INTO colis(id,client_id,statut,feu_vert,nb_colis,dims_par_colis,final_packages,fin_l,fin_w,fin_h,fin_p,outgoing_parcel_count,final_measurements_version,final_measurements_at) VALUES
 ('dd300000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000001','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now()),
 ('dd300000-0000-4000-8000-000000000002','dd200000-0000-4000-8000-000000000002','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
 ('dd300000-0000-4000-8000-000000000003','dd200000-0000-4000-8000-000000000002','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]',NULL,10,10,10,2,1,0,NULL),
 ('dd300000-0000-4000-8000-000000000004','dd200000-0000-4000-8000-000000000002','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,NULL,0,now());
INSERT INTO categories(id,label) VALUES('dd400000-0000-4000-8000-000000000001','Readiness category');
INSERT INTO taux_categories(categorie_id,destination_code,om,omr) VALUES('dd400000-0000-4000-8000-000000000001','974',10,2.5);
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES('dd500000-0000-4000-8000-000000000001','dd300000-0000-4000-8000-000000000001','Facture vérifiée',100,'readiness.pdf',true);
INSERT INTO lignes(id,colis_id,facture_id,description,qte,prix_unitaire,categorie_id) VALUES('dd600000-0000-4000-8000-000000000001','dd300000-0000-4000-8000-000000000001','dd500000-0000-4000-8000-000000000001','Article vérifié',1,100,'dd400000-0000-4000-8000-000000000001');
INSERT INTO customs_tariffs(id,code,label,destination_code,om,omr,source_id,source_label,source_url,source_date,page,source_status) VALUES('readiness-reference','00999997','Code test reprise','974',10,2.5,'readiness-fixture','Référence fictive','https://example.test/tariff.pdf','2026-01-01',1,'reference');
UPDATE tarifs SET base=10,par_kg=5 WHERE destination_code='974';UPDATE destinations SET tva=8.5 WHERE code='974';
CREATE TEMP TABLE ready_original AS SELECT to_jsonb(c) row FROM colis c WHERE id='dd300000-0000-4000-8000-000000000001';
CREATE TEMP TABLE ready_invoice AS SELECT to_jsonb(f) row FROM factures f WHERE id='dd500000-0000-4000-8000-000000000001';
GRANT SELECT ON ready_original,ready_invoice TO authenticated;
CREATE FUNCTION ready_quote(id uuid,particular boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$ SELECT save_quote(c.id,CASE WHEN particular THEN '{"devisTransport":20,"devisOM":12,"devisOMR":3,"devisTVA":2.98,"devisTotal":37.98}'::jsonb ELSE '{"devisTransport":20,"devisOM":0,"devisOMR":0,"devisTVA":0,"devisTotal":20,"modePaiementPro":"virement"}'::jsonb END,c.updated_at) FROM colis c WHERE c.id=$1 $$;
SELECT ready_assert((SELECT preparation_measurements_ready(c) FROM colis c WHERE id='dd300000-0000-4000-8000-000000000001'),'same composition with certified packages is ready after agreement');
SELECT ready_assert((SELECT preparation_measurements_ready(c) FROM colis c WHERE id='dd300000-0000-4000-8000-000000000003'),'certified legacy scalar package with exact count stays usable without invented timestamp');
SELECT ready_assert((SELECT NOT preparation_measurements_ready(c) FROM colis c WHERE id='dd300000-0000-4000-8000-000000000004'),'positive dimensions and version do not replace absent outgoing count');
SELECT ready_assert((SELECT NOT preparation_measurements_ready(jsonb_populate_record(c,'{"final_packages":[]}'::jsonb)) FROM colis c WHERE id='dd300000-0000-4000-8000-000000000001'),'explicit empty package array is incomplete, not a scalar fallback');
SELECT ready_assert((SELECT NOT preparation_measurements_ready(jsonb_populate_record(c,'{"final_measurements_version":null}'::jsonb)) FROM colis c WHERE id='dd300000-0000-4000-8000-000000000001'),'uncertified legacy version cannot become ready');
SELECT ready_assert((SELECT NOT preparation_measurements_ready(jsonb_populate_record(c,'{"final_measurements_version":2}'::jsonb)) FROM colis c WHERE id='dd300000-0000-4000-8000-000000000001'),'stale composition certificate stays incomplete');
SELECT ready_assert((SELECT NOT preparation_measurements_ready(jsonb_populate_record(c,'{"final_packages":[{"dimL":10,"dimW":0,"dimH":10,"poids":2}]}'::jsonb)) FROM colis c WHERE id='dd300000-0000-4000-8000-000000000001'),'zero package coordinate cannot be ready');
SELECT ready_assert(EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='dd300000-0000-4000-8000-000000000001' AND kind='quote' AND state='ready') AND NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='dd300000-0000-4000-8000-000000000001' AND kind='preparation' AND state<>'done'),'certified authorised dossier exposes quote rather than redundant preparation');
SELECT ready_assert(EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='dd300000-0000-4000-8000-000000000004' AND kind='preparation' AND state='ready') AND EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='dd300000-0000-4000-8000-000000000004' AND kind='quote' AND blocked_reason='Mesures finales après optimisation requises'),'missing outgoing count keeps preparation actionable and quote blocked');
SELECT ready_assert((SELECT to_jsonb(c)=r.row FROM colis c,ready_original r WHERE c.id='dd300000-0000-4000-8000-000000000001'),'readiness and task consultation do not advance or update dossier');
-- Replay the migration's projection for an old false-ready task with a colleague and a voluntary pause.
CREATE TEMP TABLE ready_count_before AS SELECT to_jsonb(c) row FROM colis c WHERE id='dd300000-0000-4000-8000-000000000004';
UPDATE staff_work_actions SET assignee_id='dd000000-0000-4000-8000-000000000003',state='ready',blocked_reason=NULL,waiting_reason='Attendre le retour du collègue',review_at=now()+interval '1 day',due_at_source='manual',due_at=now()+interval '2 days' WHERE colis_id='dd300000-0000-4000-8000-000000000004' AND kind='quote';
UPDATE staff_work_actions SET state='done' WHERE colis_id='dd300000-0000-4000-8000-000000000004' AND kind='preparation';
SELECT sync_staff_work_actions(id) FROM colis WHERE NOT archive AND statut IN ('autorise','en_preparation') AND id='dd300000-0000-4000-8000-000000000004';
SELECT ready_assert(EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='dd300000-0000-4000-8000-000000000004' AND kind='quote' AND state='waiting' AND assignee_id='dd000000-0000-4000-8000-000000000003' AND waiting_reason='Attendre le retour du collègue' AND review_at=now()+interval '1 day' AND due_at_source='manual' AND due_at=now()+interval '2 days' AND blocked_reason IS NOT NULL),'readiness reprojection preserves ownership, voluntary pause and manual due date');
SELECT ready_assert(EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='dd300000-0000-4000-8000-000000000004' AND kind='preparation' AND state='ready') AND (SELECT to_jsonb(c)=b.row FROM colis c,ready_count_before b WHERE c.id='dd300000-0000-4000-8000-000000000004'),'reprojection reopens incomplete preparation without modifying dossier');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','dd000000-0000-4000-8000-000000000002',true);
SELECT ready_reject($q$SELECT ready_quote('dd300000-0000-4000-8000-000000000001',true)$q$,'preparation-only operator cannot calculate a quote');
SELECT ready_reject($q$SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]','2000-01-01',preparation_composition_version) FROM colis WHERE id='dd300000-0000-4000-8000-000000000002'$q$,'preparation after agreement still requires current dossier CAS','40001');
SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM colis WHERE id='dd300000-0000-4000-8000-000000000002';
SELECT ready_assert((SELECT statut='en_preparation' AND preparation_measurements_ready(c) AND devis_total IS NULL FROM colis c WHERE id='dd300000-0000-4000-8000-000000000002'),'preparation-only operator saves directly after agreement without invoices or quote rights');
SELECT set_config('request.jwt.claim.sub','dd000000-0000-4000-8000-000000000003',true);
SELECT ready_reject($q$SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM colis WHERE id='dd300000-0000-4000-8000-000000000001'$q$,'quote-only operator cannot modify physical measures','42501');
SELECT ready_reject($q$SELECT save_quote(id,'{}','2000-01-01') FROM colis WHERE id='dd300000-0000-4000-8000-000000000001'$q$,'quote still rejects stale open dossier version');
SELECT ready_reject($q$SELECT ready_quote('dd300000-0000-4000-8000-000000000004')$q$,'quote cannot calculate when outgoing count missing');
RESET ROLE;
UPDATE colis SET outgoing_parcel_count=1,final_measurements_version=99 WHERE id='dd300000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT ready_reject($q$SELECT ready_quote('dd300000-0000-4000-8000-000000000004')$q$,'stale physical certification still blocks quote with exact outgoing count');
RESET ROLE;
UPDATE colis SET final_measurements_version=preparation_composition_version,client_id='dd200000-0000-4000-8000-000000000001' WHERE id='dd300000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT ready_reject($q$SELECT ready_quote('dd300000-0000-4000-8000-000000000004',true)$q$,'authorised status never bypasses required reviewed invoices');
SELECT ready_quote('dd300000-0000-4000-8000-000000000001',true);
SELECT ready_assert((SELECT statut='en_preparation' AND devis_total=37.98 AND final_packages=r.row->'final_packages' AND dims_par_colis=r.row->'dims_par_colis' AND consent_request_version=(r.row->>'consent_request_version')::integer FROM colis c,ready_original r WHERE c.id='dd300000-0000-4000-8000-000000000001'),'quote-only operator saves from authorised status without preparer permission or physical rewrite');
SELECT ready_assert((SELECT to_jsonb(f)=r.row FROM factures f,ready_invoice r WHERE f.id='dd500000-0000-4000-8000-000000000001'),'quote continuation preserves reviewed invoice');
SELECT ready_reject($q$SELECT save_quote(id,'{"finalPackages":[{"dimL":10,"dimW":10,"dimH":10,"poids":3}],"devisTransport":25,"devisOM":0,"devisOMR":0,"devisTVA":0,"devisTotal":25,"modePaiementPro":"virement"}',updated_at) FROM colis WHERE id='dd300000-0000-4000-8000-000000000003'$q$,'quote-only operator cannot replace canonical legacy weight');
SELECT ready_assert((SELECT fin_p=2 AND final_packages IS NULL AND statut='autorise' FROM colis WHERE id='dd300000-0000-4000-8000-000000000003'),'failed legacy rewrite preserves physical data and status');
SELECT ready_quote('dd300000-0000-4000-8000-000000000003');
SELECT ready_assert((SELECT statut='en_preparation' AND devis_total=20 FROM colis WHERE id='dd300000-0000-4000-8000-000000000003'),'legacy certified scalar package can continue to saved quote');
SELECT ready_assert(NOT EXISTS(SELECT 1 FROM messages WHERE colis_id::text LIKE 'dd300000%') AND NOT EXISTS(SELECT 1 FROM notifications WHERE colis_id::text LIKE 'dd300000%'),'preparation and quote saves do not send messages or notifications');
-- Exact renewed agreement path retains physical certification and permits the next quote.
SELECT set_config('request.jwt.claim.sub','dd000000-0000-4000-8000-000000000001',true);
SELECT correct_colis_task(id,'accord','{}',updated_at,'Demander un nouvel accord') FROM colis WHERE id='dd300000-0000-4000-8000-000000000001';
UPDATE colis SET statut='attente_feu_vert' WHERE id='dd300000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','dd000000-0000-4000-8000-000000000004',true);
SELECT client_decision(id,'approve',updated_at) FROM client_colis WHERE id='dd300000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','dd000000-0000-4000-8000-000000000003',true);
SELECT ready_assert((SELECT statut='autorise' AND consent_request_version=1 AND preparation_measurements_ready(c) FROM colis c WHERE id='dd300000-0000-4000-8000-000000000001'),'renewed client agreement remains authorised with prior physical certification');
SELECT ready_quote('dd300000-0000-4000-8000-000000000001',true);
SELECT ready_assert((SELECT statut='en_preparation' AND devis_total=37.98 AND final_packages=r.row->'final_packages' FROM colis c,ready_original r WHERE c.id='dd300000-0000-4000-8000-000000000001'),'quote continues after renewed agreement without requiring repeat preparation');
RESET ROLE;
-- A valid code selection is also an explicit quote task, not an implicit preparation write.
SELECT set_config('expedile.revert','allowed',true);
UPDATE colis SET statut='autorise' WHERE id='dd300000-0000-4000-8000-000000000001';
SELECT set_config('expedile.revert','',true);
SET LOCAL ROLE authenticated;
SELECT save_quote_customs(id,jsonb_build_array(jsonb_build_object('lineId','dd600000-0000-4000-8000-000000000001','tariffId','readiness-reference','override',NULL)),updated_at) FROM colis WHERE id='dd300000-0000-4000-8000-000000000001';
SELECT ready_assert((SELECT statut='en_preparation' AND final_packages=r.row->'final_packages' FROM colis c,ready_original r WHERE c.id='dd300000-0000-4000-8000-000000000001'),'quote-only customs save is allowed after agreement and preserves preparation');
RESET ROLE;
UPDATE colis SET feu_vert='en_attente' WHERE id='dd300000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT ready_reject($q$SELECT ready_quote('dd300000-0000-4000-8000-000000000002')$q$,'missing current agreement blocks quote despite physical measures');
SELECT set_config('request.jwt.claim.sub','dd000000-0000-4000-8000-000000000002',true);
SELECT ready_reject($q$SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM colis WHERE id='dd300000-0000-4000-8000-000000000002'$q$,'missing current agreement still blocks preparation');
RESET ROLE;
UPDATE colis SET feu_vert='autorise',paiement_date=now(),paiement_montant=20 WHERE id='dd300000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT ready_reject($q$SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM colis WHERE id='dd300000-0000-4000-8000-000000000002'$q$,'paid dossier still blocks preparation');
SELECT set_config('request.jwt.claim.sub','dd000000-0000-4000-8000-000000000003',true);
SELECT ready_reject($q$SELECT ready_quote('dd300000-0000-4000-8000-000000000002')$q$,'paid dossier still blocks quote');
RESET ROLE;
-- Ambiguous historical quote inputs require an explicit correction, not silent replacement.
UPDATE colis SET outgoing_parcel_count=NULL,devis_total=NULL,devis_snapshot='{"inputs":{"legacy":"old quote"}}' WHERE id='dd300000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','dd000000-0000-4000-8000-000000000002',true);
SELECT ready_reject($q$SELECT save_preparation_measurements(id,final_packages,updated_at,preparation_composition_version) FROM colis WHERE id='dd300000-0000-4000-8000-000000000004'$q$,'incomplete certificate with historical quote needs explicit correction','22023');
SELECT ready_reject($q$SELECT correct_colis_task(id,'preparation',jsonb_build_object('boxes',final_packages),updated_at,'Confirmer les colis préparés') FROM colis WHERE id='dd300000-0000-4000-8000-000000000004'$q$,'preparer cannot silently bypass correction permission','42501');
SELECT set_config('request.jwt.claim.sub','dd000000-0000-4000-8000-000000000001',true);
SELECT correct_colis_task(id,'preparation',jsonb_build_object('boxes',final_packages),updated_at,'Confirmer les colis préparés après reprise') FROM colis WHERE id='dd300000-0000-4000-8000-000000000004';
SELECT ready_assert((SELECT preparation_measurements_ready(c) AND statut='en_preparation' AND devis_total IS NULL AND final_packages='[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]'::jsonb FROM colis c WHERE id='dd300000-0000-4000-8000-000000000004'),'authorised corrector can certify preserved measurements despite historical quote inputs');
ROLLBACK;
