-- Committed fixtures for the real concurrent sessions of run-invoice-quote-rules.sh (D2/D3 races).
BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;
REVOKE ALL ON invoice_review_drafts FROM authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON quote_withdrawals FROM authenticated,service_role;
INSERT INTO auth.users(id,email) VALUES('a8000000-0000-4000-8000-000000000001','iqr-race-director@example.test'),('a8000000-0000-4000-8000-000000000002','iqr-race-client@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES('a8100000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','Direction course','iqr-race-director@example.test','directeur',false);
INSERT INTO clients(id,user_id,nom,prenom,cp,type,telegram_chat_id) VALUES('a8200000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000002','Client course','Lina','97400','particulier','CHAT-IQR-RACE');
INSERT INTO categories(id,label) VALUES('a8400000-0000-4000-8000-000000000001','Course IQR');
INSERT INTO taux_categories(categorie_id,destination_code,om,omr) VALUES('a8400000-0000-4000-8000-000000000001','974',10,2.5);
-- Dossier n: validated invoice with its article, a calculated quote of 40 EUR, sent; with or without a pending link.
CREATE FUNCTION iqr_race_dossier(n integer,linked boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE d uuid:=('a8300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; v uuid:=gen_random_uuid();
BEGIN
 INSERT INTO colis(id,client_id,ref,statut,feu_vert,nb_colis,dims_par_colis,final_packages,fin_l,fin_w,fin_h,fin_p,outgoing_parcel_count,final_measurements_version,final_measurements_at)
 VALUES(d,'a8200000-0000-4000-8000-000000000001','IQR-RACE-'||n,'en_preparation','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now());
 INSERT INTO storage.objects(bucket_id,name) SELECT 'factures',d||'/'||f FROM unnest(ARRAY['valide.pdf','late.pdf','late2.pdf']) f;
 INSERT INTO factures(id,colis_id,vendeur,montant,valide,fichier_url) VALUES(v,d,'Vendeur',100,true,d||'/valide.pdf');
 INSERT INTO lignes(colis_id,facture_id,description,qte,prix_unitaire,categorie_id) VALUES(d,v,'Article',1,100,'a8400000-0000-4000-8000-000000000001');
 UPDATE colis SET devis_total=40,devis_transport=20,devis_om=12,devis_omr=3,devis_tva=5,devis_snapshot='{"inputs":{"marker":"race"}}',devis_brouillon=false WHERE id=d;
 UPDATE colis SET statut='devis_envoye' WHERE id=d;
 IF linked THEN
  INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status,provider_id,payment_url,provider_is_live)
   SELECT id,quote_version,4000,'pending','pay_iqrRace'||n,'https://example.test/race'||n,false FROM colis WHERE id=d;
  UPDATE colis SET payplug_payment_id='pay_iqrRace'||n,payplug_payment_url='https://example.test/race'||n WHERE id=d;
 END IF;
 RETURN d;
END $$;
CREATE FUNCTION iqr_race_prove(d uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i payment_intents;
BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 FOR i IN SELECT * FROM payment_intents WHERE colis_id=d AND provider_id IS NOT NULL AND provider_cancelled_at IS NULL LOOP
  PERFORM record_payplug_cancellation(d,i.provider_id,jsonb_build_object('object','payment','id',i.provider_id,'is_paid',false,'failure',jsonb_build_object('code','aborted'),
   'currency','EUR','amount',i.amount_cents,'is_live',false,'metadata',jsonb_build_object('colis_id',d,'intent_id',i.id,'quote_version',i.quote_version)));
 END LOOP;
 PERFORM set_config('request.jwt.claim.role','',true);
END $$;
-- 1 withdrawal then payment; 2 payment then withdrawal; 3 two deposits; 4 completion then staff;
-- 5 staff then completion; 6 two claims; 7 withdrawal then reservation; 8 reservation then withdrawal.
SELECT iqr_race_dossier(n,n IN (1,2,3,4,5,6)) FROM generate_series(1,8) n;
SELECT iqr_race_prove(id) FROM colis WHERE id IN ('a8300000-0000-4000-8000-000000000001','a8300000-0000-4000-8000-000000000004','a8300000-0000-4000-8000-000000000005');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','a8000000-0000-4000-8000-000000000002',true);
SELECT deposit_client_invoice(d,d||'/late.pdf','late.pdf') FROM unnest('{a8300000-0000-4000-8000-000000000004,a8300000-0000-4000-8000-000000000005,a8300000-0000-4000-8000-000000000006}'::uuid[]) d;   -- clients never read raw dossiers
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',true),set_config('request.jwt.claim.sub','',true);
CREATE TABLE iqr_race_baseline AS SELECT id,updated_at,quote_version,payplug_payment_id,(SELECT w.id FROM quote_withdrawals w WHERE w.colis_id=c.id) AS withdrawal_id FROM colis c WHERE id::text LIKE 'a8300000%';
GRANT SELECT ON iqr_race_baseline TO authenticated,service_role;
COMMIT;
