BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE FUNCTION edit_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
CREATE FUNCTION edit_fingerprint() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM colis c),(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM lignes l),
  (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM payment_intents i),(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_actions a),
  (SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM quote_versions q),(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM messages m),
  (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM notifications n),(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM notification_outbox o),
  (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM staff_work_actions w));
$$;
CREATE FUNCTION edit_reject(command text,label text,code text DEFAULT '22023') RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_data jsonb:=edit_fingerprint();
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>code THEN RAISE EXCEPTION 'FAIL wrong code % for %: %',SQLSTATE,label,SQLERRM; END IF;
  PERFORM edit_assert(edit_fingerprint()=before_data,label||' rejects without any mutation'); RETURN;
 END;
 RAISE EXCEPTION 'FAIL accepted: %',label;
END; $$;
INSERT INTO auth.users(id,email) VALUES('ef000000-0000-4000-8000-000000000001','financial-edit-director@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES('ef100000-0000-4000-8000-000000000001','ef000000-0000-4000-8000-000000000001','Direction test','financial-edit-director@example.test','directeur',false);
INSERT INTO clients(id,nom,cp,type) VALUES('ef200000-0000-4000-8000-000000000001','Client pro test','97400','pro'),('ef200000-0000-4000-8000-000000000002','Client checkout test','97400','particulier');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,nb_colis,dims_par_colis) VALUES('ef300000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000001','EXP-EDIT','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]');
INSERT INTO categories(id,label) VALUES('ef400000-0000-4000-8000-000000000001','Edit tests');
INSERT INTO lignes(id,colis_id,description,qte,prix_unitaire,categorie_id) VALUES('ef500000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000001','Test article',1,100,'ef400000-0000-4000-8000-000000000001');
INSERT INTO customs_tariffs(id,code,label,destination_code,om,omr,source_id,source_label,source_url,source_date,page,source_status) VALUES('edit-reference','00999996','Test taux','974',10,2.5,'edit-fixture','Fictif','https://example.test/tariff.pdf','2026-01-01',1,'reference');
UPDATE tarifs SET base=10,par_kg=5 WHERE destination_code='974';
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','ef000000-0000-4000-8000-000000000001',true);
CREATE FUNCTION edit_save(kind text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c colis; BEGIN SELECT * INTO c FROM colis WHERE id='ef300000-0000-4000-8000-000000000001';
 CASE kind WHEN 'preparation' THEN PERFORM save_preparation_measurements(c.id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',c.updated_at,c.preparation_composition_version);
 WHEN 'customs' THEN PERFORM save_quote_customs(c.id,'[{"lineId":"ef500000-0000-4000-8000-000000000001","tariffId":"edit-reference","override":null}]',c.updated_at);
 WHEN 'quote' THEN PERFORM save_quote(c.id,'{"devisTransport":20,"devisOM":0,"devisOMR":0,"devisTVA":0,"devisTotal":20,"modePaiementPro":"virement"}',c.updated_at); END CASE;
END; $$;
SET LOCAL ROLE authenticated;
SELECT edit_save('preparation');
SELECT edit_assert((SELECT fin_p=2 AND statut='en_preparation' AND devis_total IS NULL FROM colis WHERE ref='EXP-EDIT'),'first optimization without invoice stays available');
SELECT edit_save('customs');
SELECT edit_save('quote');
SELECT edit_save('quote');
SELECT edit_assert((SELECT devis_total=20 FROM colis WHERE ref='EXP-EDIT'),'first quote and draft recalculation stay available without a link');
RESET ROLE;
-- Matrix of financial evidence, with every RPC tested against the same state.
-- Each exception subtransaction rolls back its synthetic proof after assertions.
DO $$
DECLARE proof text; kind text;
BEGIN
 FOREACH proof IN ARRAY ARRAY['amount','payment','intent_paid','legacy','shipping','creating','pending','failed_provider','orphan_url'] LOOP
  BEGIN
   IF proof IN ('amount','zero') THEN UPDATE colis SET paiement_montant=CASE proof WHEN 'zero' THEN 0 ELSE 5 END WHERE ref='EXP-EDIT';
   ELSIF proof='payment' THEN INSERT INTO paiements(colis_id,client_id,montant,statut) VALUES('ef300000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000001',5,'confirme');
   ELSIF proof='intent_paid' THEN INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status) SELECT id,quote_version,2000,'paid' FROM colis WHERE ref='EXP-EDIT';
   ELSIF proof='legacy' THEN
    ALTER TABLE legacy_payplug_payments DISABLE TRIGGER guard_legacy_payplug_snapshot;
    INSERT INTO legacy_payplug_payments(provider_id,colis_id,client_id,colis_ref,amount_cents,billing_email,quote_snapshot,observed_payment_amount,provider_cancelled_at)
     SELECT 'pay_editLegacy',id,client_id,ref,2000,'fixture@example.test','{}',0,now() FROM colis WHERE ref='EXP-EDIT';
    ALTER TABLE legacy_payplug_payments ENABLE TRIGGER guard_legacy_payplug_snapshot;
   ELSIF proof='shipping' THEN UPDATE colis SET date_expedition=now() WHERE ref='EXP-EDIT';
   ELSIF proof IN ('creating','pending','failed_provider') THEN
    INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status,provider_id,payment_url)
     SELECT id,quote_version,2000,CASE WHEN proof='failed_provider' THEN 'failed' ELSE proof END,CASE WHEN proof<>'creating' THEN 'pay_guard' END,CASE WHEN proof='pending' THEN 'https://example.test/active' END FROM colis WHERE ref='EXP-EDIT';
   ELSE UPDATE colis SET payplug_payment_url='https://example.test/unidentified' WHERE ref='EXP-EDIT'; END IF;
   FOREACH kind IN ARRAY ARRAY['preparation','customs','quote'] LOOP
    PERFORM edit_reject(format('SELECT edit_save(%L)',kind),proof||' / '||kind,CASE WHEN proof='creating' THEN '40001' ELSE '22023' END);
   END LOOP;
   RAISE SQLSTATE 'Z0001';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
  END;
 END LOOP;
END; $$;
-- A provider cancellation proof permits the explicit correction, then saves.
INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status,provider_id,payment_url,provider_cancelled_at)
 SELECT id,quote_version,2000,'pending','pay_cancelledEdit','https://example.test/cancelled',now() FROM colis WHERE ref='EXP-EDIT';
SET LOCAL ROLE authenticated;
SELECT correct_colis_task(id,'devis','{}',updated_at,'Corriger le tarif avant paiement') FROM colis WHERE ref='EXP-EDIT';
SELECT edit_save('preparation');SELECT edit_save('customs');SELECT edit_save('quote');
SELECT edit_assert((SELECT devis_total=20 AND payplug_payment_url IS NULL FROM colis WHERE ref='EXP-EDIT'),'provider-cancelled correction permits further preparation and quote saves');
RESET ROLE;
SELECT edit_assert(NOT has_function_privilege('authenticated','reserve_payplug_intent(uuid,integer,integer,boolean,text,timestamptz)','EXECUTE') AND NOT has_function_privilege('anon','reserve_payplug_intent(uuid,integer,integer,boolean,text,timestamptz)','EXECUTE') AND has_function_privilege('service_role','reserve_payplug_intent(uuid,integer,integer,boolean,text,timestamptz)','EXECUTE'),'reservation has service-only execution grants');
SELECT edit_assert(NOT has_function_privilege('authenticated','_assert_unpaid_dossier(uuid)','EXECUTE') AND NOT has_function_privilege('service_role','_assert_quote_editable(uuid)','EXECUTE') AND NOT has_function_privilege('anon','_assert_quote_editable(uuid)','EXECUTE'),'private guards are inaccessible directly');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,devis_total,quote_version,final_packages,fin_l,fin_w,fin_h,fin_p,outgoing_parcel_count,final_measurements_version,final_measurements_at)
 VALUES('ef300000-0000-4000-8000-000000000002','ef200000-0000-4000-8000-000000000002','EXP-RESERVE','en_preparation','autorise',40,2,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now());
CREATE FUNCTION edit_reserve(version integer DEFAULT 2,amount integer DEFAULT 4000,live boolean DEFAULT false,hash text DEFAULT repeat('a',64)) RETURNS payment_intents LANGUAGE sql AS $$ SELECT reserve_payplug_intent('ef300000-0000-4000-8000-000000000002',version,amount,live,hash,now()+interval '90 days'); $$;
SELECT edit_reject('SELECT edit_reserve()','SQL role alone does not replace service JWT','42501');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE change text; BEGIN
 FOREACH change IN ARRAY ARRAY['feu_vert=''en_attente''','produit_interdit=true','final_measurements_version=99'] LOOP
  BEGIN
   EXECUTE 'UPDATE colis SET '||change||' WHERE ref=''EXP-RESERVE''';
   PERFORM edit_reject('SELECT edit_reserve()',change,'40001');
   RAISE SQLSTATE 'Z0001';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END;
 END LOOP;
END; $$;
SELECT edit_reject('SELECT edit_reserve(1)','stale quote version','40001');
SELECT edit_reject('SELECT edit_reserve(2,3900)','stale amount','40001');
SELECT edit_reject('SELECT edit_reserve(2,4000,false,NULL)','missing token hash');
SELECT edit_reject('SELECT edit_reserve(2,4000,NULL)','unknown mode');
SELECT edit_reserve();
SELECT edit_assert((SELECT count(*)=1 AND bool_and(status='creating' AND provider_is_live=false AND return_token_hash=repeat('a',64)) FROM payment_intents WHERE colis_id='ef300000-0000-4000-8000-000000000002'),'first reservation persists one test intent and only token hash');
SELECT edit_reject('SELECT edit_reserve()','double reservation','40001');
UPDATE payment_intents SET status='failed' WHERE colis_id='ef300000-0000-4000-8000-000000000002';
SELECT edit_reserve(2,4000,false,repeat('b',64));
SELECT edit_assert((SELECT count(*)=1 AND bool_and(return_token_hash=repeat('b',64)) FROM payment_intents WHERE colis_id='ef300000-0000-4000-8000-000000000002'),'failed reservation without provider resource can retry once');
UPDATE payment_intents SET status='pending',provider_id='pay_reservedEdit',payment_url='https://example.test/reserved' WHERE colis_id='ef300000-0000-4000-8000-000000000002';
CREATE TEMP TABLE pending_before AS SELECT edit_fingerprint() data;
SELECT edit_reserve(2,4000,false,repeat('c',64));
SELECT edit_assert((SELECT data=edit_fingerprint() FROM pending_before),'pending link reuse never rotates token or writes data');
SELECT edit_reject('SELECT edit_reserve(2,4000,true)','different payment mode');
UPDATE payment_intents SET provider_cancelled_at=now() WHERE colis_id='ef300000-0000-4000-8000-000000000002';
SELECT edit_reject('SELECT edit_reserve()','cancelled link cannot be reused','40001');
UPDATE colis SET paiement_montant=5 WHERE ref='EXP-RESERVE';
SELECT edit_reject('SELECT edit_reserve()','partial payment blocks new reservation');
SELECT edit_assert(NOT EXISTS(SELECT 1 FROM messages WHERE colis_id::text LIKE 'ef300000%') AND NOT EXISTS(SELECT 1 FROM notifications WHERE colis_id::text LIKE 'ef300000%'),'all financial commands send no notification');
ROLLBACK;
