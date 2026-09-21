-- Committed fixtures exclusively inside the disposable test container.
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO auth.users(id,email) VALUES('cb000000-0000-4000-8000-000000000001','correction-race@example.test'),('cb000000-0000-4000-8000-000000000002','client-race@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES('cb100000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001','Race operator','correction-race@example.test','directeur',false);
INSERT INTO clients(id,user_id,nom,cp) VALUES('cb200000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000002','Race client','97400');
INSERT INTO colis(id,client_id,statut,nb_colis,dims_par_colis,dim_l,dim_w,dim_h,poids,feu_vert)
 VALUES('cb300000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001','mesure',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]',40,30,20,4,'en_attente'),
 ('cb300000-0000-4000-8000-000000000002','cb200000-0000-4000-8000-000000000001','attente_feu_vert',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]',40,30,20,4,'en_attente');
CREATE TABLE correction_race_versions AS SELECT id,updated_at FROM colis WHERE id IN ('cb300000-0000-4000-8000-000000000001','cb300000-0000-4000-8000-000000000002');
GRANT SELECT ON correction_race_versions TO authenticated;
