GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO auth.users(id,email) VALUES('df100000-0000-4000-8000-000000000001','owner-race-a@example.test'),('df100000-0000-4000-8000-000000000002','owner-race-b@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('df200000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001','Owner race A','owner-race-a@example.test','directeur',false),
 ('df200000-0000-4000-8000-000000000002','df100000-0000-4000-8000-000000000002','Owner race B','owner-race-b@example.test','directeur',false);
INSERT INTO clients(id,nom,cp) VALUES('df300000-0000-4000-8000-000000000001','Ownership concurrency','97400');
INSERT INTO colis(id,client_id,statut,feu_vert) VALUES
 ('df400000-0000-4000-8000-000000000001','df300000-0000-4000-8000-000000000001','autorise','autorise'),
 ('df400000-0000-4000-8000-000000000002','df300000-0000-4000-8000-000000000001','autorise','autorise'),
 ('df400000-0000-4000-8000-000000000003','df300000-0000-4000-8000-000000000001','autorise','autorise');
INSERT INTO categories(id,label) VALUES('df600000-0000-4000-8000-000000000001','Ownership race category');
INSERT INTO taux_categories(categorie_id,destination_code,om,omr) VALUES('df600000-0000-4000-8000-000000000001','974',0,0);
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES('df500000-0000-4000-8000-000000000001','df400000-0000-4000-8000-000000000003','Concurrent invoice',20,'df400000-0000-4000-8000-000000000003/invoice.pdf',false);
INSERT INTO storage.objects(bucket_id,name) VALUES('factures','df400000-0000-4000-8000-000000000003/invoice.pdf');
UPDATE staff_work_actions SET assignee_id='df100000-0000-4000-8000-000000000001' WHERE colis_id::text LIKE 'df400000%' AND kind='preparation';
UPDATE staff_work_actions SET assignee_id='df100000-0000-4000-8000-000000000002' WHERE colis_id='df400000-0000-4000-8000-000000000003' AND kind='documents';
CREATE TABLE owner_race_versions AS SELECT c.id,c.updated_at,c.preparation_composition_version,
 (SELECT invoice_review_token(id) FROM factures WHERE colis_id=c.id LIMIT 1) invoice_token FROM colis c WHERE c.id::text LIKE 'df400000%';
GRANT SELECT ON owner_race_versions TO authenticated;
