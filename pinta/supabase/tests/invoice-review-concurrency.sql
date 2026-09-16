-- Persistent fixture in the disposable test database, for two real DB sessions.
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO auth.users(id,email) VALUES('ea000000-0000-4000-8000-000000000001','concurrent-review@example.test');
INSERT INTO staff_users(auth_id,nom,email,role,must_change_password) VALUES('ea000000-0000-4000-8000-000000000001','Review concurrent','concurrent-review@example.test','directeur',false);
INSERT INTO clients(id,nom,cp,type) VALUES('ea000000-0000-4000-8000-000000000002','Review race','97400','particulier');
INSERT INTO colis(id,client_id,statut,feu_vert) VALUES('ea000000-0000-4000-8000-000000000003','ea000000-0000-4000-8000-000000000002','en_preparation','autorise');
INSERT INTO categories(id,label) VALUES('ea000000-0000-4000-8000-000000000004','Concurrent category');
INSERT INTO taux_categories(categorie_id,destination_code,om,omr) VALUES('ea000000-0000-4000-8000-000000000004','974',10,2.5);
INSERT INTO factures(id,colis_id,vendeur,fichier_url) VALUES('ea000000-0000-4000-8000-000000000005','ea000000-0000-4000-8000-000000000003','Vendor','ea000000-0000-4000-8000-000000000003/doc.pdf');
INSERT INTO storage.objects(bucket_id,name) VALUES('factures','ea000000-0000-4000-8000-000000000003/doc.pdf');
CREATE TABLE invoice_review_race AS SELECT id,invoice_review_token(id) AS token,fichier_url FROM factures WHERE id='ea000000-0000-4000-8000-000000000005';
GRANT SELECT ON invoice_review_race TO authenticated;
