GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO auth.users(id,email) VALUES('ef100000-0000-4000-8000-000000000001','take-race-a@example.test'),('ef100000-0000-4000-8000-000000000002','take-race-b@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('ef200000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000001','Take A','take-race-a@example.test','preparateur',false),
 ('ef200000-0000-4000-8000-000000000002','ef100000-0000-4000-8000-000000000002','Take B','take-race-b@example.test','preparateur',false);
INSERT INTO staff_permissions(staff_id,perm_colis_preparer,perm_factures_valider) VALUES('ef200000-0000-4000-8000-000000000001',true,true),('ef200000-0000-4000-8000-000000000002',true,true);
INSERT INTO clients(id,nom,cp,email) VALUES('ef300000-0000-4000-8000-000000000001','Take race fixture','97400','take-race-client@example.test');
INSERT INTO colis(id,client_id,statut,feu_vert) VALUES
 ('ef400000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000001','autorise','autorise'),
 ('ef400000-0000-4000-8000-000000000002','ef300000-0000-4000-8000-000000000001','autorise','autorise');
INSERT INTO factures(colis_id,vendeur,montant,fichier_url,valide) VALUES('ef400000-0000-4000-8000-000000000002','Invoice race',10,'take-race.pdf',false);
