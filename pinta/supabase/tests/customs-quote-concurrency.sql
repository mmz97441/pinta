-- Fixtures only in the dedicated throw-away container owned by run-customs-quote.
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO auth.users(id,email) VALUES('fd100000-0000-4000-8000-000000000001','customs-race@example.test');
INSERT INTO staff_users(auth_id,nom,email,role) VALUES('fd100000-0000-4000-8000-000000000001','Customs race','customs-race@example.test','directeur');
INSERT INTO clients(id,nom,cp,type) VALUES('fd200000-0000-4000-8000-000000000001','Customs race','97400','particulier');
INSERT INTO colis(id,client_id,statut,feu_vert) VALUES('fd300000-0000-4000-8000-000000000001','fd200000-0000-4000-8000-000000000001','en_preparation','autorise');
INSERT INTO categories(id,label) VALUES('fd400000-0000-4000-8000-000000000001','Customs race');
INSERT INTO taux_categories(categorie_id,destination_code,om,omr) VALUES('fd400000-0000-4000-8000-000000000001','974',10,2.5);
INSERT INTO lignes(id,colis_id,description,qte,prix_unitaire,categorie_id) VALUES('fd600000-0000-4000-8000-000000000001','fd300000-0000-4000-8000-000000000001','Concurrent article',1,100,'fd400000-0000-4000-8000-000000000001');
INSERT INTO customs_tariffs(id,code,label,destination_code,om,omr,source_id,source_label,source_url,source_date,page,source_status) VALUES('race-test-p1-r1','85167970','Concurrent test','974',20,3,'race-test','Race test reference','https://example.test/customs.pdf','2025-12-18',1,'reference');
CREATE TABLE customs_race_baseline AS SELECT id,updated_at FROM colis WHERE id='fd300000-0000-4000-8000-000000000001';
GRANT SELECT ON customs_race_baseline TO authenticated;
