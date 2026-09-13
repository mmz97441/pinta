GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO auth.users(id,email) VALUES('f7100000-0000-4000-8000-000000000001','race-a@example.test'),('f7100000-0000-4000-8000-000000000002','race-b@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','Race A','race-a@example.test','preparateur',false),
 ('f7200000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000002','Race B','race-b@example.test','preparateur',false);
INSERT INTO staff_permissions(staff_id,perm_colis_preparer) VALUES('f7200000-0000-4000-8000-000000000001',true),('f7200000-0000-4000-8000-000000000002',true);
INSERT INTO clients(id,nom,cp,email) VALUES('f7300000-0000-4000-8000-000000000001','Race fixture','97400','race-client@example.test');
INSERT INTO colis(id,client_id,statut,feu_vert) VALUES('f7400000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000001','autorise','autorise');
