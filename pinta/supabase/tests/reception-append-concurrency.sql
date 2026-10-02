INSERT INTO auth.users(id,email) VALUES('eb100000-0000-4000-8000-000000000001','append-race@example.test');
INSERT INTO staff_users(auth_id,nom,email,role,must_change_password) VALUES('eb100000-0000-4000-8000-000000000001','Receipt race','append-race@example.test','directeur',false);
INSERT INTO clients(id,nom,cp,type) VALUES('eb300000-0000-4000-8000-000000000001','Receipt race','97400','pro');
INSERT INTO colis(id,client_id,ref,statut,nb_colis,dims_par_colis,trackings_detail) VALUES
 ('eb400000-0000-4000-8000-000000000001','eb300000-0000-4000-8000-000000000001','EXP-APPEND-RACE','mesure',1,'[{"dimL":10,"dimW":20,"dimH":30,"poids":1}]','[{"number":""}]'),
 ('eb400000-0000-4000-8000-000000000002','eb300000-0000-4000-8000-000000000001','EXP-APPEND-REPLAY','mesure',1,'[{"dimL":10,"dimW":20,"dimH":30,"poids":1}]','[{"number":""}]');
CREATE TABLE append_race_baseline AS SELECT id,updated_at FROM colis WHERE id::text LIKE 'eb400000%';
GRANT SELECT ON append_race_baseline TO authenticated;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
