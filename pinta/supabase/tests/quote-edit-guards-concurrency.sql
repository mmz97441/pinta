GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
INSERT INTO auth.users(id,email) VALUES('ee000000-0000-4000-8000-000000000001','financial-race@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES('ee100000-0000-4000-8000-000000000001','ee000000-0000-4000-8000-000000000001','Direction race','financial-race@example.test','directeur',false);
INSERT INTO clients(id,nom,cp,type) VALUES('ee200000-0000-4000-8000-000000000001','Client race','97400','particulier');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,devis_total,quote_version,nb_colis,dims_par_colis,final_packages,fin_l,fin_w,fin_h,fin_p,outgoing_parcel_count,final_measurements_version,final_measurements_at)
 SELECT ('ee300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ee200000-0000-4000-8000-000000000001','EXP-RACE-'||n,'en_preparation','autorise',40,2,1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now() FROM generate_series(1,3) n;
CREATE TABLE quote_guard_race_versions AS SELECT id,updated_at,quote_version,to_jsonb(c) original FROM colis c WHERE id::text LIKE 'ee300000%';
GRANT SELECT ON quote_guard_race_versions TO authenticated;
