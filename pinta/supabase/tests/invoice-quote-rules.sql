-- D1-D4 (2026-10-04): validated invoices, sent quotes, late client invoices and the payment freeze.
-- Every refusal asserts SQLSTATE, HINT prefix and an unchanged fingerprint of every business table involved.
BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
-- T6 before the broad legacy test grants below: the migration's own table privileges.
DO $$ BEGIN
 IF has_table_privilege('authenticated','quote_withdrawals','INSERT') OR has_table_privilege('authenticated','quote_withdrawals','UPDATE')
  OR has_table_privilege('authenticated','quote_withdrawals','DELETE') OR has_table_privilege('service_role','quote_withdrawals','UPDATE')
  OR has_table_privilege('anon','quote_withdrawals','SELECT') OR NOT has_table_privilege('authenticated','quote_withdrawals','SELECT')
  OR NOT has_table_privilege('service_role','quote_withdrawals','SELECT')
  OR has_table_privilege('authenticated','quote_withdrawals','TRIGGER') OR has_table_privilege('authenticated','quote_withdrawals','REFERENCES')
  OR has_table_privilege('service_role','quote_withdrawals','TRIGGER') OR has_table_privilege('service_role','quote_withdrawals','REFERENCES')
  OR has_table_privilege('service_role','quote_withdrawals','INSERT') OR has_table_privilege('authenticated','quote_withdrawals','TRUNCATE') THEN RAISE EXCEPTION 'FAIL: quote_withdrawals table privileges'; END IF;
 RAISE NOTICE 'PASS: quote_withdrawals is readable (RLS) but never writable by API roles';
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;
-- Production keeps these revoked even under broad table grants.
REVOKE ALL ON invoice_review_drafts FROM authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON quote_withdrawals FROM authenticated,service_role;

CREATE FUNCTION iqr_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
CREATE FUNCTION iqr_fingerprint() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM colis c),(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM factures f),
  (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM lignes l),(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM ocr_extractions e),
  (SELECT jsonb_agg(to_jsonb(d) ORDER BY facture_id) FROM invoice_review_drafts d),(SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM quote_withdrawals w),
  (SELECT jsonb_agg(to_jsonb(j) ORDER BY facture_id) FROM ocr_jobs j),(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM payment_intents i),
  (SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM quote_versions q),(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_actions a),
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM messages m),(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM notifications n),
  (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM notification_outbox o),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM staff_work_actions s))
$$;
CREATE FUNCTION iqr_reject(command text,label text,code text DEFAULT '22023',hint_prefix text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_data jsonb:=iqr_fingerprint(); hint text;
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
  IF SQLSTATE<>code THEN RAISE EXCEPTION 'FAIL wrong code % for %: % [%]',SQLSTATE,label,SQLERRM,hint; END IF;
  IF hint_prefix IS NOT NULL AND coalesce(hint,'') NOT LIKE hint_prefix||'%' THEN RAISE EXCEPTION 'FAIL wrong hint "%" for %: %',hint,label,SQLERRM; END IF;
  IF iqr_fingerprint()<>before_data THEN RAISE EXCEPTION 'FAIL % changed data',label; END IF;
  RAISE NOTICE 'PASS rejected: % [% %]',label,SQLSTATE,coalesce(hint,''); RETURN;
 END;
 RAISE EXCEPTION 'FAIL accepted: %',label;
END $$;
-- Session identity for one step: database role and JWT claims together.
CREATE FUNCTION iqr_as(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role',CASE who WHEN 'postgres' THEN '' WHEN 'service' THEN 'service_role' WHEN 'anon' THEN 'anon' ELSE 'authenticated' END,true);
 PERFORM set_config('request.jwt.claim.sub',CASE who WHEN 'director' THEN 'a7000000-0000-4000-8000-000000000001' WHEN 'editor' THEN 'a7000000-0000-4000-8000-000000000002'
  WHEN 'colleague' THEN 'a7000000-0000-4000-8000-000000000003' WHEN 'client' THEN 'a7000000-0000-4000-8000-000000000004' WHEN 'client_b' THEN 'a7000000-0000-4000-8000-000000000005' ELSE '' END,true);
 IF who<>'postgres' THEN EXECUTE format('SET LOCAL ROLE %I',CASE who WHEN 'service' THEN 'service_role' WHEN 'anon' THEN 'anon' ELSE 'authenticated' END); END IF;
END $$;

INSERT INTO auth.users(id,email) VALUES('a7000000-0000-4000-8000-000000000001','iqr-director@example.test'),('a7000000-0000-4000-8000-000000000002','iqr-editor@example.test'),
 ('a7000000-0000-4000-8000-000000000003','iqr-colleague@example.test'),('a7000000-0000-4000-8000-000000000004','iqr-client@example.test'),('a7000000-0000-4000-8000-000000000005','iqr-client-b@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('a7100000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','Direction IQR','iqr-director@example.test','directeur',false),
 ('a7100000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000002','Articles IQR','iqr-editor@example.test','preparateur',false),
 ('a7100000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000003','Collègue IQR','iqr-colleague@example.test','directeur',false);
INSERT INTO staff_permissions(staff_id,perm_factures_voir,perm_factures_modifier_articles,perm_factures_ajouter,perm_factures_refuser,perm_factures_valider,perm_colis_revenir_arriere)
 VALUES('a7100000-0000-4000-8000-000000000002',true,true,false,false,false,false);
INSERT INTO clients(id,user_id,nom,prenom,cp,type,telegram_chat_id) VALUES
 ('a7200000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000004','Client IQR','Flavie','97400','particulier','CHAT-IQR-A'),
 ('a7200000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000005','Autre client IQR','Noa','97400','particulier','CHAT-IQR-B'),
 ('a7200000-0000-4000-8000-000000000003',NULL,'Pro IQR','Sam','97400','pro',NULL);
INSERT INTO categories(id,label) VALUES('a7400000-0000-4000-8000-000000000001','IQR catégorie');
INSERT INTO taux_categories(categorie_id,destination_code,om,omr) VALUES('a7400000-0000-4000-8000-000000000001','974',10,2.5);
INSERT INTO customs_tariffs(id,code,label,destination_code,om,omr,source_id,source_label,source_url,source_date,page,source_status)
 VALUES('iqr-reference','00999997','Test IQR','974',10,2.5,'iqr-fixture','Fictif','https://example.test/iqr.pdf','2026-01-01',1,'reference');
UPDATE tarifs SET base=10,par_kg=5 WHERE destination_code='974';

-- A measured dossier: validated invoice V (article, analysis), unvalidated U (analysis), copy X of V,
-- a conversation attachment, a Telegram attachment, a calculated quote, then the requested payment state.
CREATE FUNCTION iqr_dossier(p_ref text,p_state text DEFAULT 'open',p_client uuid DEFAULT 'a7200000-0000-4000-8000-000000000001') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE d uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); suffix text:=lower(replace(p_ref,'-',''));
 cat uuid:='a7400000-0000-4000-8000-000000000001';
BEGIN
 INSERT INTO colis(id,client_id,ref,statut,feu_vert,nb_colis,dims_par_colis,final_packages,fin_l,fin_w,fin_h,fin_p,outgoing_parcel_count,final_measurements_version,final_measurements_at)
 VALUES(d,p_client,p_ref,'en_preparation','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]','[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',10,10,10,2,1,0,now());
 INSERT INTO storage.objects(bucket_id,name) SELECT 'factures',d||'/'||n FROM unnest(ARRAY['valide.pdf','u.pdf','copie.pdf','late.pdf','late2.pdf','late3.pdf','conv.pdf','tg.pdf','tg2.pdf','tg3.pdf']) n;
 INSERT INTO factures(id,colis_id,vendeur,montant,valide,fichier_url,fichier_nom) VALUES
  (v,d,'Vendeur validé',100,false,d||'/valide.pdf','valide.pdf'),(u,d,'Document à vérifier',0,false,d||'/u.pdf','u.pdf');
 INSERT INTO ocr_extractions(facture_id,document_hash,document_file_url,lines,total,vendeur) VALUES
  (v,repeat('a',64),d||'/valide.pdf',jsonb_build_array(jsonb_build_object('desc','Article validé','qte',1,'prix',100,'cat',cat)),100,'Vendeur validé'),
  (u,repeat('c',64),d||'/u.pdf',jsonb_build_array(jsonb_build_object('desc','Proposé','qte',1,'prix',10,'cat',cat)),10,'Proposé');
 INSERT INTO lignes(colis_id,facture_id,description,qte,prix_unitaire,categorie_id) VALUES(d,v,'Article validé',1,100,cat);
 UPDATE factures SET valide=true WHERE id=v;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom,duplicate_of_facture_id) VALUES(d,'Copie',100,false,d||'/copie.pdf','copie.pdf',v);
 INSERT INTO messages(colis_id,type,canal,texte,attachment_path,attachment_name,attachment_type) VALUES(d,'client','portal','Pièce jointe',d||'/conv.pdf','conv.pdf','application/pdf');
 INSERT INTO messages(colis_id,type,canal,texte,attachment_path,attachment_name,attachment_type,telegram_event_key)
 VALUES(d,'client','telegram','Document reçu',d||'/tg.pdf','tg.pdf','application/pdf','iqr:tg:'||d),(d,'client','telegram','Autre document',d||'/tg2.pdf','tg2.pdf','application/pdf','iqr:tg2:'||d);
 UPDATE colis SET conversation_statut='termine' WHERE id=d;
 UPDATE colis SET devis_total=40,devis_transport=20,devis_om=12,devis_omr=3,devis_tva=5,devis_snapshot='{"inputs":{"marker":"quote"}}',devis_brouillon=false WHERE id=d;
 IF p_state IN ('sent','attente','sent_nolink') THEN UPDATE colis SET statut='devis_envoye' WHERE id=d; END IF;
 IF p_state IN ('sent','attente') THEN
  INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status,provider_id,payment_url,provider_is_live)
   SELECT id,quote_version,4000,'pending','pay_'||suffix,'https://example.test/'||suffix,false FROM colis WHERE id=d;
  UPDATE colis SET payplug_payment_id='pay_'||suffix,payplug_payment_url='https://example.test/'||suffix WHERE id=d;
 END IF;
 IF p_state='attente' THEN UPDATE colis SET statut='attente_paiement' WHERE id=d; END IF;
 IF p_state='orphan' THEN
  INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status,provider_id,payment_url,provider_is_live)
   SELECT id,quote_version,4000,'superseded','pay_'||suffix,'https://example.test/'||suffix,false FROM colis WHERE id=d;
 END IF;
 IF p_state='creating' THEN INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status,provider_is_live) SELECT id,quote_version,4000,'creating',false FROM colis WHERE id=d; END IF;
 IF p_state='legacy' THEN
  ALTER TABLE legacy_payplug_payments DISABLE TRIGGER guard_legacy_payplug_snapshot;
  INSERT INTO legacy_payplug_payments(provider_id,colis_id,client_id,colis_ref,amount_cents,billing_email,quote_snapshot)
   SELECT 'pay_'||suffix,id,client_id,ref,4000,'iqr-legacy@example.test','{}' FROM colis WHERE id=d;
  ALTER TABLE legacy_payplug_payments ENABLE TRIGGER guard_legacy_payplug_snapshot;
 END IF;
 IF p_state='orphan_url' THEN UPDATE colis SET payplug_payment_url='https://example.test/orphan-'||suffix WHERE id=d; END IF;
 RETURN d;
END $$;
CREATE FUNCTION iqr_v(d uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM factures WHERE colis_id=d AND fichier_url=d||'/valide.pdf' $$;
CREATE FUNCTION iqr_u(d uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM factures WHERE colis_id=d AND fichier_url=d||'/u.pdf' $$;
CREATE FUNCTION iqr_x(d uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM factures WHERE colis_id=d AND fichier_url=d||'/copie.pdf' $$;
CREATE FUNCTION iqr_tok(f uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT invoice_review_token(f) $$;
CREATE FUNCTION iqr_lines(price numeric DEFAULT 10) RETURNS text LANGUAGE sql AS $$ SELECT jsonb_build_array(jsonb_build_object('desc','Article','qte',1,'prix',price,'cat','a7400000-0000-4000-8000-000000000001'))::text $$;
-- PayPlug cancellation proofs, recorded by the payment service for every link of the dossier.
CREATE FUNCTION iqr_prove(d uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i payment_intents; l legacy_payplug_payments; previous text:=current_setting('request.jwt.claim.role',true);
BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 FOR i IN SELECT * FROM payment_intents WHERE colis_id=d AND provider_id IS NOT NULL AND provider_cancelled_at IS NULL LOOP
  PERFORM record_payplug_cancellation(d,i.provider_id,jsonb_build_object('object','payment','id',i.provider_id,'is_paid',false,'failure',jsonb_build_object('code','aborted'),
   'currency','EUR','amount',i.amount_cents,'is_live',coalesce(i.provider_is_live,false),'metadata',jsonb_build_object('colis_id',d,'intent_id',i.id,'quote_version',i.quote_version)));
 END LOOP;
 FOR l IN SELECT * FROM legacy_payplug_payments WHERE colis_id=d AND provider_cancelled_at IS NULL LOOP
  PERFORM record_payplug_cancellation(d,l.provider_id,jsonb_build_object('object','payment','id',l.provider_id,'is_paid',false,'failure',jsonb_build_object('code','aborted'),
   'currency','EUR','amount',l.amount_cents,'is_live',true,'metadata',jsonb_build_object('colis_id',d,'colis_ref',l.colis_ref),'billing',jsonb_build_object('email',l.billing_email)));
 END LOOP;
 PERFORM set_config('request.jwt.claim.role',coalesce(previous,''),true);
END $$;
-- Literal 2026-10-03 predicate of _assert_unpaid_dossier, copied for the equivalence check (T0).
CREATE FUNCTION iqr_literal_frozen(c colis) RETURNS boolean LANGUAGE sql AS $$
 SELECT c.archive OR c.statut NOT IN ('receptionne','mesure','attente_feu_vert','autorise','refuse_client','en_preparation','devis_envoye','attente_paiement')
  OR c.paiement_date IS NOT NULL OR c.paiement_montant IS NOT NULL OR c.date_expedition IS NOT NULL
  OR EXISTS(SELECT 1 FROM paiements WHERE colis_id=c.id AND statut='confirme')
  OR EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=c.id AND status='paid')
  OR EXISTS(SELECT 1 FROM legacy_payplug_payments WHERE colis_id=c.id AND (observed_payment_date IS NOT NULL OR observed_payment_amount IS NOT NULL))
  OR EXISTS(SELECT 1 FROM envois WHERE id=c.envoi_id AND (departed_at IS NOT NULL OR manifest_version>0)) $$;
CREATE FUNCTION iqr_apply_proof(d uuid,proof text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e uuid;
BEGIN
 PERFORM set_config('expedile.revert','allowed',true);PERFORM set_config('expedile.confirm_departure','allowed',true);
 CASE proof
  WHEN 'amount' THEN UPDATE colis SET paiement_montant=5 WHERE id=d;
  WHEN 'date' THEN UPDATE colis SET paiement_date=now() WHERE id=d;
  WHEN 'payment' THEN INSERT INTO paiements(colis_id,client_id,montant,statut) SELECT id,client_id,5,'confirme' FROM colis WHERE id=d;
  WHEN 'intent_paid' THEN INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status) SELECT id,quote_version+50,4000,'paid' FROM colis WHERE id=d;
  WHEN 'legacy' THEN
   ALTER TABLE legacy_payplug_payments DISABLE TRIGGER guard_legacy_payplug_snapshot;
   INSERT INTO legacy_payplug_payments(provider_id,colis_id,client_id,colis_ref,amount_cents,billing_email,quote_snapshot,observed_payment_amount,provider_cancelled_at)
    SELECT 'pay_iqrObserved'||left(replace(id::text,'-',''),8),id,client_id,ref,4000,'iqr-legacy@example.test','{}',0,now() FROM colis WHERE id=d;
   ALTER TABLE legacy_payplug_payments ENABLE TRIGGER guard_legacy_payplug_snapshot;
  WHEN 'shipping' THEN UPDATE colis SET date_expedition=now() WHERE id=d;
  WHEN 'departed','manifest' THEN
   INSERT INTO envois(destination_code,date_depart,statut) VALUES('974',(now() AT TIME ZONE 'Europe/Paris')::date+3,'planifie') RETURNING id INTO e;
   UPDATE colis SET envoi_id=e WHERE id=d;
   IF proof='departed' THEN UPDATE envois SET departed_at=now() WHERE id=e; ELSE UPDATE envois SET manifest_version=1 WHERE id=e; END IF;
  WHEN 'archive' THEN UPDATE colis SET conversation_statut='termine',archive=true WHERE id=d;
  ELSE UPDATE colis SET statut=proof::statut_colis WHERE id=d;
 END CASE;
 PERFORM set_config('expedile.revert','',true);PERFORM set_config('expedile.confirm_departure','',true);
END $$;
-- Every invoice write, by every actor, with current tokens computed by the database owner.
CREATE FUNCTION iqr_frozen_operations(d uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v uuid:=iqr_v(d); u uuid:=iqr_u(d); x uuid:=iqr_x(d); l uuid; e ocr_extractions; m uuid; ua timestamptz;
BEGIN
 SELECT id INTO l FROM lignes WHERE facture_id=v; SELECT * INTO e FROM ocr_extractions WHERE facture_id=u; SELECT id INTO m FROM messages WHERE colis_id=d AND attachment_path=d||'/conv.pdf';
 SELECT updated_at INTO ua FROM colis WHERE id=d;
 RETURN jsonb_build_array(
  jsonb_build_object('who','director','label','review draft','command',format('SELECT save_invoice_review(%L,%L,%L,%L,10,%L,NULL,false)',u,invoice_review_token(u),d||'/u.pdf',iqr_lines(),'V')),
  jsonb_build_object('who','director','label','review confirm','command',format('SELECT save_invoice_review(%L,%L,%L,%L,10,%L,NULL,true)',u,invoice_review_token(u),d||'/u.pdf',iqr_lines(),'V')),
  jsonb_build_object('who','director','label','classify','command',format('SELECT classify_invoice_duplicate(%L,%L,%L,%L)',u,v,invoice_review_token(u),invoice_review_token(v))),
  jsonb_build_object('who','director','label','restore','command',format('SELECT restore_invoice_duplicate(%L,%L)',x,invoice_review_token(x))),
  jsonb_build_object('who','director','label','import conversation','command',format('SELECT import_conversation_invoice(%L)',m)),
  jsonb_build_object('who','director','label','legacy OCR confirmation','command',format('SELECT confirm_ocr_extraction_current(%L,%L,%L)',e.id,e.document_file_url,e.document_hash)),
  jsonb_build_object('who','director','label','open modification','command',format('SELECT open_invoice_modification(%L,%L)',v,invoice_review_token(v))),
  jsonb_build_object('who','director','label','close modification','command',format('SELECT close_invoice_modification(%L,%L)',v,invoice_review_token(v))),
  jsonb_build_object('who','director','label','withdraw for documents','command',format('SELECT withdraw_quote_for_documents(%L,%L,%L)',d,ua,'manual_articles')),
  jsonb_build_object('who','director','label','staff invoice insert','command',format('INSERT INTO factures(colis_id,vendeur,montant,fichier_url) VALUES(%L,%L,0,%L)',d,'Nouveau',d||'/new.pdf')),
  jsonb_build_object('who','director','label','staff vendor update','command',format('UPDATE factures SET vendeur=%L WHERE id=%L','Autre',u)),
  jsonb_build_object('who','director','label','staff document replacement','command',format('UPDATE factures SET fichier_url=%L WHERE id=%L',d||'/autre.pdf',u)),
  jsonb_build_object('who','director','label','staff correction request','command',format('UPDATE factures SET rejet_motif=%L WHERE id=%L','Illisible',u)),
  jsonb_build_object('who','director','label','staff OCR-only update','command',format('UPDATE factures SET ocr_status=%L,ocr_error=%L WHERE id=%L','failed','x',u)),
  jsonb_build_object('who','director','label','staff invoice delete','command',format('DELETE FROM factures WHERE id=%L',u)),
  jsonb_build_object('who','client','label','client invoice insert','command',format('INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url) VALUES(%L,%L,0,false,%L)',d,'Client',d||'/client.pdf')),
  jsonb_build_object('who','service','label','service Telegram insert','command',format('INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,telegram_event_key) VALUES(%L,%L,0,false,%L,%L)',d,'Telegram',d||'/svc.pdf','iqr:svc:'||d)),
  jsonb_build_object('who','service','label','service OCR-only update','command',format('UPDATE factures SET ocr_status=%L WHERE id=%L','review',u)),
  jsonb_build_object('who','service','label','service vendor update','command',format('UPDATE factures SET vendeur=%L WHERE id=%L','Service',u)),
  jsonb_build_object('who','service','label','service invoice delete','command',format('DELETE FROM factures WHERE id=%L',u)),
  jsonb_build_object('who','postgres','label','owner vendor update','command',format('UPDATE factures SET vendeur=%L WHERE id=%L','Maintenance',u)),
  jsonb_build_object('who','director','label','article insert','command',format('INSERT INTO lignes(colis_id,description,qte,prix_unitaire,categorie_id) VALUES(%L,%L,1,5,%L)',d,'Manuel','a7400000-0000-4000-8000-000000000001')),
  jsonb_build_object('who','director','label','article update','command',format('UPDATE lignes SET qte=2 WHERE id=%L',l)),
  jsonb_build_object('who','director','label','article delete','command',format('DELETE FROM lignes WHERE id=%L',l)),
  jsonb_build_object('who','service','label','analysis insert','command',format('INSERT INTO ocr_extractions(facture_id,document_hash,document_file_url,lines,total) VALUES(%L,%L,%L,%L,0)',u,repeat('b',64),d||'/u.pdf','[]')),
  jsonb_build_object('who','service','label','analysis update','command',format('UPDATE ocr_extractions SET status=%L WHERE id=%L','review',e.id)),
  jsonb_build_object('who','service','label','draft insert','command',format('INSERT INTO invoice_review_drafts(facture_id,payload) VALUES(%L,%L)',v,'{}')),
  jsonb_build_object('who','service','label','draft update','command',format('UPDATE invoice_review_drafts SET payload=%L WHERE facture_id=%L','{"x":1}',u)),
  jsonb_build_object('who','service','label','draft delete','command',format('DELETE FROM invoice_review_drafts WHERE facture_id=%L',u)));
END $$;

-- T0 + T1 + D4 Telegram and portal outcomes: every proof, every operation.
SELECT iqr_dossier('IQR-FROZEN');
INSERT INTO invoice_review_drafts(facture_id,payload) SELECT iqr_u(id),'{"lines":[]}' FROM colis WHERE ref='IQR-FROZEN';
SELECT iqr_assert((SELECT _dossier_frozen_reason(c) IS NULL AND NOT coalesce(iqr_literal_frozen(c),false) FROM colis c WHERE ref='IQR-FROZEN'),'T0 clean dossier is not frozen under both predicates');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-FROZEN'); proof text; op jsonb; result jsonb; code text; message text;
BEGIN
 FOREACH proof IN ARRAY ARRAY['amount','date','payment','intent_paid','legacy','shipping','departed','manifest','archive','paye','expedie','transit','dedouanement','arrive','livraison','livre','annule'] LOOP
  BEGIN
   PERFORM iqr_apply_proof(d,proof);
   PERFORM iqr_assert((SELECT _dossier_frozen_reason(c) IS NOT NULL AND coalesce(iqr_literal_frozen(c),false) FROM colis c WHERE id=d),'T0 equivalence: '||proof||' -> '||(SELECT _dossier_frozen_reason(c) FROM colis c WHERE id=d));
   BEGIN PERFORM _assert_unpaid_dossier(d); RAISE EXCEPTION 'FAIL: unpaid assertion accepted %',proof;
   EXCEPTION WHEN SQLSTATE '22023' THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
    PERFORM iqr_assert(message='Un paiement ou un départ est enregistré, ou le dossier est fermé. Les mesures et le devis sont en lecture seule.','T0 _assert_unpaid_dossier keeps code and message: '||proof);
   END;
   FOR op IN SELECT value FROM jsonb_array_elements(iqr_frozen_operations(d)) LOOP
    PERFORM iqr_as(op->>'who');
    PERFORM iqr_reject(op->>'command',proof||' / '||(op->>'label'),'22023','invoices_frozen:');
    PERFORM iqr_as('postgres');
   END LOOP;
   PERFORM iqr_as('service');
   result:=register_telegram_document((SELECT id FROM messages WHERE colis_id=d AND attachment_path=d||'/tg.pdf'),NULL,repeat('e',64));
   PERFORM iqr_assert(result->>'status'='frozen' AND result->>'ref'='IQR-FROZEN' AND result->>'prenom'='Flavie','T1 Telegram registration answers frozen without failing the webhook: '||proof);
   PERFORM iqr_assert((register_requested_invoice((SELECT id FROM messages WHERE colis_id=d AND attachment_path=d||'/tg.pdf'),NULL)).id IS NULL,'T1 legacy Telegram wrapper returns no invoice: '||proof);
   PERFORM iqr_as('client');
   result:=deposit_client_invoice(d,d||'/late.pdf','late.pdf');
   PERFORM iqr_as('postgres');
   PERFORM iqr_assert(result->>'status'='frozen' AND NOT EXISTS(SELECT 1 FROM factures WHERE fichier_url=d||'/late.pdf')
    AND (SELECT count(*)=1 FROM messages WHERE colis_id=d AND attachment_path=d||'/late.pdf' AND type='client' AND canal='portal' AND template='client_document'),'T1 portal deposit keeps the file as one client message: '||proof);
   RAISE SQLSTATE 'Z0001';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
  END;
 END LOOP;
END $$;
-- The frozen portal deposit is idempotent by path.
DO $$ DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-FROZEN'); result jsonb; BEGIN
 PERFORM iqr_apply_proof(d,'amount');
 PERFORM iqr_as('client');
 result:=deposit_client_invoice(d,d||'/late.pdf','late.pdf'); result:=deposit_client_invoice(d,d||'/late.pdf','late.pdf');
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert(result->>'status'='frozen' AND result->>'reason'='payment' AND (SELECT count(*)=1 FROM messages WHERE attachment_path=d||'/late.pdf'),'T1 repeated frozen deposit stores one conversation message');
 RAISE SQLSTATE 'Z0001';
EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END $$;

-- T2: a locked quote refuses every staff write; drafts of unvalidated invoices and OCR bookkeeping stay possible.
CREATE FUNCTION iqr_locked_operations(d uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v uuid:=iqr_v(d); u uuid:=iqr_u(d); x uuid:=iqr_x(d); l uuid; e ocr_extractions; m uuid;
BEGIN
 SELECT id INTO l FROM lignes WHERE facture_id=v; SELECT * INTO e FROM ocr_extractions WHERE facture_id=u; SELECT id INTO m FROM messages WHERE colis_id=d AND attachment_path=d||'/conv.pdf';
 RETURN jsonb_build_array(
  jsonb_build_object('label','staff invoice insert','command',format('INSERT INTO factures(colis_id,vendeur,montant,fichier_url) VALUES(%L,%L,0,%L)',d,'Nouveau',d||'/new.pdf')),
  jsonb_build_object('label','staff vendor update','command',format('UPDATE factures SET vendeur=%L WHERE id=%L','Autre',u)),
  jsonb_build_object('label','staff document replacement','command',format('UPDATE factures SET fichier_url=%L WHERE id=%L',d||'/late3.pdf',u)),
  jsonb_build_object('label','staff correction request','command',format('UPDATE factures SET rejet_motif=%L WHERE id=%L','Illisible',u)),
  jsonb_build_object('label','staff invoice delete','command',format('DELETE FROM factures WHERE id=%L',u)),
  jsonb_build_object('label','article insert','command',format('INSERT INTO lignes(colis_id,description,qte,prix_unitaire,categorie_id) VALUES(%L,%L,1,5,%L)',d,'Manuel','a7400000-0000-4000-8000-000000000001')),
  jsonb_build_object('label','article update','command',format('UPDATE lignes SET qte=2 WHERE id=%L',l)),
  jsonb_build_object('label','article delete','command',format('DELETE FROM lignes WHERE id=%L',l)),
  jsonb_build_object('label','review confirm','command',format('SELECT save_invoice_review(%L,%L,%L,%L,10,%L,NULL,true)',u,invoice_review_token(u),d||'/u.pdf',iqr_lines(),'V')),
  jsonb_build_object('label','draft on a validated invoice','command',format('SELECT save_invoice_review(%L,%L,%L,%L,100,%L,NULL,false)',v,invoice_review_token(v),d||'/valide.pdf',iqr_lines(100),'V')),
  jsonb_build_object('label','classify','command',format('SELECT classify_invoice_duplicate(%L,%L,%L,%L)',u,v,invoice_review_token(u),invoice_review_token(v))),
  jsonb_build_object('label','restore','command',format('SELECT restore_invoice_duplicate(%L,%L)',x,invoice_review_token(x))),
  jsonb_build_object('label','import conversation','command',format('SELECT import_conversation_invoice(%L)',m)),
  jsonb_build_object('label','legacy OCR confirmation','command',format('SELECT confirm_ocr_extraction_current(%L,%L,%L)',e.id,e.document_file_url,e.document_hash)),
  jsonb_build_object('label','open modification','command',format('SELECT open_invoice_modification(%L,%L)',v,invoice_review_token(v))));
END $$;
DO $$
DECLARE state text; d uuid; op jsonb; before_quote jsonb;
BEGIN
 FOREACH state IN ARRAY ARRAY['sent','attente','sent_nolink','orphan','creating','legacy','orphan_url'] LOOP
  d:=iqr_dossier('IQR-LOCK-'||state,state,CASE WHEN state='sent_nolink' THEN 'a7200000-0000-4000-8000-000000000003'::uuid ELSE 'a7200000-0000-4000-8000-000000000001'::uuid END);
  PERFORM iqr_assert((SELECT _quote_locked(c) AND _dossier_frozen_reason(c) IS NULL FROM colis c WHERE id=d),'T2 locked and unfrozen: '||state);
  FOR op IN SELECT value FROM jsonb_array_elements(iqr_locked_operations(d)) LOOP
   PERFORM iqr_as('director');
   PERFORM iqr_reject(op->>'command',state||' / '||(op->>'label'),'22023','quote_withdrawal_required');
   PERFORM iqr_as('postgres');
  END LOOP;
  SELECT jsonb_build_object('colis',(SELECT to_jsonb(c)-'updated_at'-'conversation_statut'-'conversation_version'-'conversation_updated_at'-'conversation_opened_at' FROM colis c WHERE id=d),
   'intents',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM payment_intents i WHERE colis_id=d)) INTO before_quote;
  PERFORM iqr_as('director');
  PERFORM save_invoice_review(iqr_u(d),iqr_tok(iqr_u(d)),d||'/u.pdf',iqr_lines()::jsonb,10,'Brouillon',NULL,false);
  PERFORM iqr_as('service');
  UPDATE factures SET ocr_status='review',ocr_error=NULL WHERE id=iqr_u(d);
  PERFORM iqr_as('postgres');
  PERFORM iqr_assert(EXISTS(SELECT 1 FROM invoice_review_drafts WHERE facture_id=iqr_u(d)) AND (SELECT ocr_status='review' FROM factures WHERE id=iqr_u(d))
   AND before_quote=jsonb_build_object('colis',(SELECT to_jsonb(c)-'updated_at'-'conversation_statut'-'conversation_version'-'conversation_updated_at'-'conversation_opened_at' FROM colis c WHERE id=d),
    'intents',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM payment_intents i WHERE colis_id=d)),'T2 draft of an unvalidated invoice and OCR bookkeeping keep the quote untouched: '||state);
 END LOOP;
END $$;
-- Regression: customs revision of a sent professional quote without link still saves and withdraws exactly as before.
DO $$ DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-LOCK-sent_nolink'); version integer; BEGIN
 SELECT quote_version INTO version FROM colis WHERE id=d;
 PERFORM iqr_as('director');
 PERFORM save_quote_customs(d,jsonb_build_array(jsonb_build_object('lineId',(SELECT id FROM lignes WHERE colis_id=d),'tariffId','iqr-reference','override',NULL)),(SELECT updated_at FROM colis WHERE id=d));
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((SELECT statut='en_preparation' AND devis_total IS NULL AND devis_brouillon AND quote_version=version+1 FROM colis WHERE id=d)
  AND (SELECT custom_duty->>'tariffId'='iqr-reference' FROM lignes WHERE colis_id=d) AND NOT EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id=d),'T2 regression: customs revision of a sent pro quote without link saves and withdraws as before');
END $$;

-- T3: the D2 command.
SELECT iqr_dossier('IQR-PERM','sent');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-PERM'); action text; stale text;
BEGIN
 stale:=format('%L',(SELECT updated_at-interval '1 second' FROM colis WHERE id=d));
 PERFORM iqr_as('editor');
 FOREACH action IN ARRAY ARRAY['open_modification','manual_articles'] LOOP
  PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%s,%L)',d,stale,action),'T3 modify-articles permission alone passes for '||action,'40001');
 END LOOP;
 FOREACH action IN ARRAY ARRAY['replace_document','add_document','import_attachment','request_correction','classify_duplicate','restore_duplicate'] LOOP
  PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%s,%L)',d,stale,action),'T3 extra permission required for '||action,'42501');
 END LOOP;
 PERFORM iqr_as('postgres');
 UPDATE staff_permissions SET perm_factures_ajouter=true,perm_factures_refuser=true,perm_factures_valider=true WHERE staff_id='a7100000-0000-4000-8000-000000000002';
 PERFORM iqr_as('editor');
 FOREACH action IN ARRAY ARRAY['replace_document','add_document','import_attachment','request_correction','classify_duplicate','restore_duplicate'] LOOP
  PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%s,%L)',d,stale,action),'T3 action permission accepted without perm_colis_revenir_arriere: '||action,'40001');
 END LOOP;
 PERFORM iqr_as('postgres');
 UPDATE staff_permissions SET perm_factures_modifier_articles=false WHERE staff_id='a7100000-0000-4000-8000-000000000002';
 PERFORM iqr_as('editor');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%s,%L)',d,stale,'add_document'),'T3 every action requires perm_factures_modifier_articles','42501');
 PERFORM iqr_as('client');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%s,%L)',d,stale,'manual_articles'),'T3 client cannot withdraw a quote','42501');
 PERFORM iqr_as('postgres');
 UPDATE staff_permissions SET perm_factures_modifier_articles=true WHERE staff_id='a7100000-0000-4000-8000-000000000002';
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L)',d,(SELECT updated_at FROM colis WHERE id=d),'unknown'),'T3 unknown action','22023');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L,%L)',d,(SELECT updated_at FROM colis WHERE id=d),'manual_articles','ab'),'T3 reason too short','22023');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L,%L)',d,(SELECT updated_at FROM colis WHERE id=d),'manual_articles',repeat('x',501)),'T3 reason too long','22023');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L)',d,(SELECT updated_at-interval '1 microsecond' FROM colis WHERE id=d),'manual_articles'),'T3 CAS at microsecond precision','40001');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,NULL,%L)',d,'manual_articles'),'T3 CAS cannot be omitted','40001');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L)',d,(SELECT updated_at FROM colis WHERE id=d),'manual_articles'),'T3 missing PayPlug proof','22023','link_cancellation_required');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L,NULL,%L)',d,(SELECT updated_at FROM colis WHERE id=d),'replace_document',(SELECT iqr_v(id) FROM colis WHERE ref='IQR-FROZEN')),'T3 invoice of another dossier','22023');
 PERFORM iqr_as('postgres');
 UPDATE staff_work_actions SET assignee_id='a7000000-0000-4000-8000-000000000003',state='in_progress' WHERE colis_id=d AND kind='documents';
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L)',d,(SELECT updated_at FROM colis WHERE id=d),'manual_articles'),'T3 documents task owned by a colleague','40001');
 PERFORM iqr_as('postgres');
 UPDATE staff_work_actions SET assignee_id=NULL,state='ready' WHERE colis_id=d AND kind='documents';
 INSERT INTO staff_work_actions(colis_id,kind,state,assignee_id) VALUES(d,'correction','in_progress','a7000000-0000-4000-8000-000000000003')
  ON CONFLICT(colis_id,kind) DO UPDATE SET state='in_progress',assignee_id='a7000000-0000-4000-8000-000000000003';
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L)',d,(SELECT updated_at FROM colis WHERE id=d),'manual_articles'),'T3 correction task owned by a colleague','40001');
 PERFORM iqr_as('postgres');
 DELETE FROM staff_work_actions WHERE colis_id=d AND kind='correction';
 -- A creating intent of another version: the withdrawal core answers 40001 payment_link_creating after the proofs.
 PERFORM iqr_prove(d);
 INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status,provider_is_live) SELECT id,quote_version+20,4000,'creating',false FROM colis WHERE id=d;
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L)',d,(SELECT updated_at FROM colis WHERE id=d),'manual_articles'),'T3 payment link being created','40001','payment_link_creating');
 PERFORM iqr_as('postgres');
END $$;

-- T3: a withdrawal after proofs, with queued quote messages and an open client request absorbed.
SELECT iqr_dossier('IQR-WITHDRAW','sent');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-WITHDRAW'); c colis; before colis; result jsonb; tpl text; st text; m uuid; request uuid;
BEGIN
 SELECT * INTO c FROM colis WHERE id=d;
 FOREACH tpl IN ARRAY ARRAY['devis_final','devis_final_pro','relance_paiement','demande_feu_vert'] LOOP
  FOREACH st IN ARRAY ARRAY['pending','blocked','manual','failed','sending','sent'] LOOP
   INSERT INTO messages(colis_id,type,texte,statut,canal,template) VALUES(d,'staff','Message '||tpl,'envoi','telegram',tpl) RETURNING id INTO m;
   INSERT INTO notification_outbox(message_id,client_id,colis_id,quote_version,canal,status,idempotency_key) VALUES(m,c.client_id,d,c.quote_version,'telegram',st,'iqr-'||tpl||'-'||st);
  END LOOP;
 END LOOP;
 PERFORM iqr_as('client');
 result:=deposit_client_invoice(d,d||'/late.pdf','late.pdf');
 PERFORM iqr_as('postgres');
 request:=(result->>'withdrawalId')::uuid;
 PERFORM iqr_assert(result->>'status'='intake' AND request IS NOT NULL,'T3 setup: an open client request exists before the staff withdrawal');
 PERFORM iqr_prove(d);
 SELECT * INTO before FROM colis WHERE id=d;
 PERFORM iqr_as('director');
 result:=withdraw_quote_for_documents(d,before.updated_at,'replace_document',NULL,iqr_u(d));
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((result->>'changed')::boolean AND result->'withdrawal'->>'status'='withdrawn' AND result->'withdrawal'->>'source'='staff' AND result->'withdrawal'->>'action'='replace_document'
  AND result->'withdrawal'->>'client_message_status'='not_required' AND result->'withdrawal'->'facture_ids'=jsonb_build_array(iqr_u(d)) AND result->'reviewToken'='null'::jsonb
  AND (result->'withdrawal'->>'link_cancelled')::boolean AND result->'withdrawal'->>'reason'='Remplacement d’un document après l’envoi du devis','T3 staff row withdrawn with default reason and cancelled link');
 PERFORM iqr_assert((SELECT statut='en_preparation' AND devis_total IS NULL AND devis_brouillon AND payplug_payment_id IS NULL AND payplug_payment_url IS NULL AND quote_version=before.quote_version+1 FROM colis WHERE id=d)
  AND result->'colis'->>'statut'='en_preparation','T3 dossier back to preparation, quote versioned and cleared');
 PERFORM iqr_assert(NOT EXISTS(SELECT 1 FROM payment_intents WHERE colis_id=d AND status IN ('creating','pending')) AND EXISTS(SELECT 1 FROM quote_versions WHERE colis_id=d AND version=before.quote_version AND total=40),'T3 intents superseded and withdrawn version kept');
 PERFORM iqr_assert((SELECT bool_and(CASE WHEN m.template IN ('devis_final','devis_final_pro','relance_paiement') AND split_part(o.idempotency_key,'-',array_length(string_to_array(o.idempotency_key,'-'),1)) IN ('pending','blocked','manual','failed') THEN o.status='cancelled' AND o.last_error='Devis retiré : un nouveau devis sera envoyé'
   ELSE o.status=split_part(o.idempotency_key,'-',array_length(string_to_array(o.idempotency_key,'-'),1)) END) FROM notification_outbox o JOIN messages m ON m.id=o.message_id WHERE o.colis_id=d AND o.idempotency_key LIKE 'iqr-%'),'T3 queued quote and reminder messages cancelled; sending, sent and other templates untouched');
 PERFORM iqr_assert((SELECT status='withdrawn' AND client_message_status='pending' AND withdrawn_quote_version=before.quote_version AND previous_statut='devis_envoye' AND link_cancelled FROM quote_withdrawals WHERE id=request),'T3 open client request absorbed with its client message pending');
 PERFORM iqr_assert((SELECT before_data->>'statut'='devis_envoye' AND after_data->>'statut'='en_preparation' AND after_data->>'withdrawalId'=result->'withdrawal'->>'id' AND user_id='a7000000-0000-4000-8000-000000000001'
  FROM audit_actions WHERE colis_id=d AND action='quote_withdrawn'),'T3 audit keeps actor, before and after');
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L)',d,before.updated_at,'replace_document'),'T3 replay with the old version','40001');
 result:=withdraw_quote_for_documents(d,(SELECT updated_at FROM colis WHERE id=d),'replace_document');
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert(NOT (result->>'changed')::boolean AND result->'withdrawal'='null'::jsonb AND (SELECT count(*)=1 FROM audit_actions WHERE colis_id=d AND action='quote_withdrawn'),'T3 replay on the current version changes nothing');
 PERFORM iqr_as('director');
 UPDATE factures SET fichier_url=d||'/late3.pdf' WHERE id=iqr_u(d);
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((SELECT count(*)=1 FROM factures WHERE colis_id=d AND fichier_url=d||'/late3.pdf') AND iqr_u(d) IS NULL,'T3 the existing action runs after the withdrawal');
END $$;

-- T3: open_modification seeds the draft from the validated values; import_attachment is atomic and announced.
SELECT iqr_dossier('IQR-OPEN','sent'),iqr_dossier('IQR-IMPORT','attente');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-OPEN'); i uuid:=(SELECT id FROM colis WHERE ref='IQR-IMPORT'); result jsonb; again jsonb; m uuid; v uuid;
BEGIN
 v:=iqr_v(d);
 PERFORM iqr_prove(d);
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L,NULL,%L,%L)',d,(SELECT updated_at FROM colis WHERE id=d),'open_modification',v,'stale-token'),'T3 open_modification checks the review token before withdrawing','40001');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L,NULL,%L,%L)',d,(SELECT updated_at FROM colis WHERE id=d),'open_modification',iqr_u(d),iqr_tok(iqr_u(d))),'T3 open_modification requires a validated active invoice','22023');
 result:=withdraw_quote_for_documents(d,(SELECT updated_at FROM colis WHERE id=d),'open_modification',NULL,v,iqr_tok(v));
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((result->>'changed')::boolean AND result->>'reviewToken'=invoice_review_token(v) AND result->'withdrawal'->>'action'='open_modification'
  AND (SELECT payload=jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('desc','Article validé','qte',1,'prix',100.00,'cat','a7400000-0000-4000-8000-000000000001')),'total',100,'vendeur','Vendeur validé','extractionId',NULL)
   AND saved_by='a7000000-0000-4000-8000-000000000001' FROM invoice_review_drafts WHERE facture_id=v),'T3 withdrawal opens the modification seeded from the validated lines, with the matching token');
 PERFORM iqr_assert((SELECT valide FROM factures WHERE id=v) AND (SELECT count(*)=1 FROM lignes WHERE facture_id=v) AND (SELECT count(*)=1 FROM audit_actions WHERE colis_id=d AND action='invoice_modification_opened'),'T3 the validated invoice and its article stay unchanged');
 UPDATE invoice_review_drafts SET payload=payload||'{"edited":true}' WHERE facture_id=v;
 PERFORM iqr_as('director');
 again:=open_invoice_modification(v,iqr_tok(v));
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert(NOT (again->>'created')::boolean AND (again->'draft'->>'edited')::boolean AND (SELECT count(*)=1 FROM audit_actions WHERE colis_id=d AND action='invoice_modification_opened'),'T3 an existing draft is kept');
 -- import_attachment: withdrawal, invoice and the D3 message state in one command.
 SELECT id INTO m FROM messages WHERE colis_id=i AND attachment_path=i||'/conv.pdf';
 PERFORM iqr_prove(i);
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT withdraw_quote_for_documents(%L,%L,%L,NULL,NULL,NULL,%L)',i,(SELECT updated_at FROM colis WHERE id=i),'import_attachment',(SELECT id FROM messages WHERE colis_id=d AND attachment_path=d||'/conv.pdf')),'T3 import requires a message of this dossier','22023');
 result:=withdraw_quote_for_documents(i,(SELECT updated_at FROM colis WHERE id=i),'import_attachment',NULL,NULL,NULL,m);
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((result->>'changed')::boolean AND result->'withdrawal'->>'source'='conversation_import' AND result->'withdrawal'->>'client_message_status'='pending'
  AND result->'withdrawal'->'facture_ids'=jsonb_build_array(result->'facture'->>'id') AND result->'facture'->>'fichier_url'=i||'/conv.pdf' AND NOT (result->'facture'->>'valide')::boolean
  AND result->'withdrawal'->>'previous_statut'='attente_paiement','T3 import withdraws, inserts the invoice and records a pending client message');
 PERFORM iqr_assert((SELECT status='pending' FROM ocr_jobs WHERE facture_id=(result->'facture'->>'id')::uuid) AND (SELECT statut='en_preparation' FROM colis WHERE id=i),'T3 imported invoice is queued for analysis on the withdrawn dossier');
END $$;

-- T4: late client invoice through the portal.
SELECT iqr_dossier('IQR-PORTAL','sent'),iqr_dossier('IQR-OLDPORTAL','sent');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-PORTAL'); old uuid:=(SELECT id FROM colis WHERE ref='IQR-OLDPORTAL'); result jsonb; second jsonb; w quote_withdrawals; before colis; view_row record; a staff_work_actions;
BEGIN
 SELECT * INTO before FROM colis WHERE id=d;
 PERFORM iqr_as('client_b');
 PERFORM iqr_reject(format('SELECT deposit_client_invoice(%L,%L,%L)',d,d||'/late.pdf','late.pdf'),'T4 another client cannot deposit','42501');
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT deposit_client_invoice(%L,%L,%L)',d,d||'/late.pdf','late.pdf'),'T4 staff cannot use the client deposit','42501');
 PERFORM iqr_as('client');
 PERFORM iqr_reject(format('SELECT deposit_client_invoice(%L,%L,%L)',d,old||'/late.pdf','late.pdf'),'T4 path outside the dossier','22023');
 PERFORM iqr_reject(format('SELECT deposit_client_invoice(%L,%L,%L)',d,d||'/absent.pdf','absent.pdf'),'T4 path absent from storage','22023');
 PERFORM iqr_reject(format('SELECT deposit_client_invoice(%L,%L,%L)',d,d||'/../late.pdf','late.pdf'),'T4 traversal path','22023');
 result:=deposit_client_invoice(d,d||'/late.pdf','late.pdf');
 PERFORM iqr_as('postgres');
 SELECT * INTO w FROM quote_withdrawals WHERE id=(result->>'withdrawalId')::uuid;
 PERFORM iqr_assert(result->>'status'='intake' AND NOT (result->'facture'->>'valide')::boolean AND result->'facture'->>'vendeur'='late.pdf' AND result->'facture'->>'ocr_status'='pending','T4 deposit inserts an unvalidated invoice queued for analysis');
 PERFORM iqr_assert((SELECT statut='devis_envoye' AND devis_total=40 AND payplug_payment_url=before.payplug_payment_url AND quote_version=before.quote_version FROM colis WHERE id=d)
  AND (SELECT status='pending' AND provider_cancelled_at IS NULL FROM payment_intents WHERE colis_id=d),'T4 quote and payment link untouched until PayPlug confirms');
 PERFORM iqr_assert(w.status='pending' AND w.source='portal' AND w.facture_ids=ARRAY[(result->'facture'->>'id')::uuid] AND w.quote_version=before.quote_version AND w.requested_by='a7000000-0000-4000-8000-000000000004'
  AND w.client_message_status='not_required' AND w.closed_at IS NULL,'T4 one pending request carries the invoice');
 PERFORM iqr_assert(EXISTS(SELECT 1 FROM messages WHERE colis_id=d AND type='client' AND template='client_document' AND texte='Document reçu : late.pdf') AND (SELECT conversation_statut='a_traiter' FROM colis WHERE id=d)
  AND EXISTS(SELECT 1 FROM audit_actions WHERE colis_id=d AND action='late_invoice_received' AND after_data->>'withdrawalId'=w.id::text),'T4 client message, open conversation and audit');
 SELECT * INTO a FROM staff_work_actions WHERE colis_id=d AND kind='documents';
 PERFORM iqr_assert(a.state='waiting' AND a.blocked_reason='Annulation de l’ancien lien de paiement en cours' AND a.action_hint='Vérifier la nouvelle facture puis renvoyer le devis'
  AND a.priority_reason='Facture reçue après l’envoi du devis' AND a.priority_until=w.created_at+interval '7 days' AND a.priority_by IS NULL,'T4 documents task blocked by the cancellation in progress, with hint and system priority');
 PERFORM iqr_as('client');
 SELECT payplug_payment_url,quote_update_pending,devis_total INTO view_row FROM client_colis WHERE id=d;
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert(view_row.payplug_payment_url IS NULL AND view_row.quote_update_pending AND view_row.devis_total=40,'T4 client view hides the old link and shows the update in progress');
 PERFORM iqr_as('client');
 second:=deposit_client_invoice(d,d||'/late2.pdf','late2.pdf','Boutique');
 result:=deposit_client_invoice(d,d||'/late.pdf','late.pdf');
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert(second->>'withdrawalId'=w.id::text AND second->'facture'->>'vendeur'='Boutique' AND (SELECT cardinality(facture_ids)=2 FROM quote_withdrawals WHERE id=w.id)
  AND (SELECT count(*)=1 FROM quote_withdrawals WHERE colis_id=d),'T4 a second file joins the same open request');
 PERFORM iqr_assert(result->>'status'='intake' AND (SELECT count(*)=1 FROM factures WHERE fichier_url=d||'/late.pdf'),'T4 a retry with the same path returns the same invoice');
 -- An old portal bundle inserting directly behaves the same.
 PERFORM iqr_as('client');
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom) VALUES(old,'Ancien portail',0,false,old||'/late.pdf','late.pdf');
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((SELECT status='pending' AND source='portal' AND cardinality(facture_ids)=1 FROM quote_withdrawals WHERE colis_id=old) AND (SELECT statut='devis_envoye' AND devis_total=40 FROM colis WHERE id=old),'T4 a direct client insert opens the same request');
 -- Identical file pre-check (service).
 PERFORM iqr_as('service');
 result:=client_document_precheck(d,'a7000000-0000-4000-8000-000000000004',d||'/late3.pdf',repeat('a',64));
 second:=client_document_precheck(d,'a7000000-0000-4000-8000-000000000004',d||'/late3.pdf',repeat('a',64));
 PERFORM iqr_assert(result->>'identicalTo'=iqr_v(d)::text AND jsonb_typeof(result->'quoteSent')='boolean' AND second=result,'T4 identical bytes of a validated invoice are recognised');
 PERFORM iqr_assert((client_document_precheck(d,'a7000000-0000-4000-8000-000000000004',d||'/late3.pdf',repeat('f',64)))->'identicalTo'='null'::jsonb,'T4 other bytes are not identical');
 PERFORM iqr_reject(format('SELECT client_document_precheck(%L,%L,%L,%L)',d,'a7000000-0000-4000-8000-000000000005',d||'/late3.pdf',repeat('a',64)),'T4 pre-check refuses another client','42501');
 PERFORM iqr_reject(format('SELECT client_document_precheck(%L,%L,%L,%L)',d,'a7000000-0000-4000-8000-000000000004',d||'/late3.pdf','ABC'),'T4 pre-check refuses a malformed hash','22023');
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((SELECT count(*)=1 FROM audit_actions WHERE colis_id=d AND action='client_invoice_identical_ignored' AND after_data->>'path'=d||'/late3.pdf' AND after_data->>'originalId'=iqr_v(d)::text),'T4 identical document audited once, nothing inserted');
END $$;

-- T4: an unlocked dossier keeps the plain deposit; a client replaces a rejected invoice.
SELECT iqr_dossier('IQR-PLAIN','open');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-PLAIN'); result jsonb; u uuid;
BEGIN
 u:=iqr_u(d);
 UPDATE factures SET rejet_motif='Page manquante' WHERE id=u;
 PERFORM iqr_as('client');
 PERFORM iqr_reject(format('SELECT deposit_client_invoice(%L,%L,%L,NULL,%L)',d,d||'/late2.pdf','late2.pdf',iqr_v(d)),'T4 only a rejected invoice of the dossier can be replaced','22023');
 result:=deposit_client_invoice(d,d||'/late.pdf','correction.pdf',NULL,u);
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert(result->>'status'='added' AND result->'withdrawalId'='null'::jsonb AND (result->'facture'->>'replaces_facture_id')::uuid=u AND result->'facture'->>'fichier_nom'='correction.pdf'
  AND NOT EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id=d) AND (SELECT devis_total IS NULL FROM colis WHERE id=d),'T4 unlocked dossier: plain deposit, replacement kept, unsent quote reset as before');
END $$;

-- T4: Telegram registration and the « Oui » confirmation.
SELECT iqr_dossier('IQR-TG','sent'),iqr_dossier('IQR-TG-OPEN','open'),iqr_dossier('IQR-TG-CONFIRM','sent');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-TG'); o uuid:=(SELECT id FROM colis WHERE ref='IQR-TG-OPEN'); k uuid:=(SELECT id FROM colis WHERE ref='IQR-TG-CONFIRM');
 tg uuid; tg2 uuid; result jsonb; again jsonb; invoice factures;
BEGIN
 SELECT id INTO tg FROM messages WHERE colis_id=d AND attachment_path=d||'/tg.pdf'; SELECT id INTO tg2 FROM messages WHERE colis_id=d AND attachment_path=d||'/tg2.pdf';
 -- An explicit reply to the delivered invoice request (the one-document rule only applies to unthreaded files).
 INSERT INTO messages(colis_id,type,canal,template,statut,texte,telegram_msg_id,created_at) VALUES(d,'staff','telegram','facture_manquante','envoye','Merci pour la facture','IQR-REQ-1',now()-interval '2 hours');
 PERFORM iqr_as('client');
 PERFORM iqr_reject(format('SELECT register_telegram_document(%L,NULL,NULL)',tg),'T6 Telegram registration is service only','42501');
 PERFORM iqr_as('service');
 PERFORM iqr_reject(format('SELECT register_telegram_document(%L,NULL,%L)',tg,'not-a-hash'),'T4 malformed SHA-256','22023');
 result:=register_telegram_document(tg2,NULL,repeat('a',64));
 PERFORM iqr_assert(result->>'status'='identical' AND result->>'originalId'=iqr_v(d)::text AND (result->>'quoteSent')::boolean IS NOT NULL AND NOT EXISTS(SELECT 1 FROM factures WHERE fichier_url=d||'/tg2.pdf'),'T4 identical Telegram document is not inserted');
 PERFORM iqr_assert((register_telegram_document(tg,NULL,repeat('d',64)))->>'status'='ask_client','T4 an unthreaded file after earlier invoices keeps the one-document rule and asks the client');
 result:=register_telegram_document(tg,'IQR-REQ-1',repeat('d',64));
 PERFORM iqr_assert(result->>'status'='registered' AND result->>'ref'='IQR-TG' AND result->>'prenom'='Flavie' AND result->>'withdrawalStatus'='pending'
  AND (SELECT source='telegram' AND status='pending' AND facture_ids=ARRAY[(result->>'factureId')::uuid] FROM quote_withdrawals WHERE id=(result->>'withdrawalId')::uuid),'T4 requested invoice registered and request opened on the locked quote');
 again:=register_telegram_document(tg,'IQR-REQ-1',repeat('d',64));
 PERFORM iqr_assert(again->>'factureId'=result->>'factureId' AND again->>'withdrawalId'=result->>'withdrawalId' AND (SELECT count(*)=1 FROM factures WHERE fichier_url=d||'/tg.pdf'),'T4 webhook retry is idempotent');
 PERFORM iqr_assert((register_requested_invoice(tg,'IQR-REQ-1')).id::text=result->>'factureId' AND (register_requested_invoice(tg)).id::text=result->>'factureId','T4 legacy wrappers return the registered invoice');
 -- An unrelated document on a locked quote, then on an unlocked dossier.
 INSERT INTO messages(colis_id,type,canal,texte,attachment_path,attachment_name,attachment_type,telegram_event_key) VALUES(k,'client','telegram','Photo',k||'/tg3.pdf','tg3.pdf','application/pdf','iqr:tg3:'||k);
 result:=register_telegram_document((SELECT id FROM messages WHERE colis_id=k AND attachment_path=k||'/tg3.pdf'),NULL,repeat('d',64));
 PERFORM iqr_assert(result->>'status'='ask_client' AND result->>'prenom'='Flavie' AND NOT EXISTS(SELECT 1 FROM factures WHERE fichier_url=k||'/tg3.pdf'),'T4 unrelated document on a locked quote asks the client');
 result:=register_telegram_document((SELECT id FROM messages WHERE colis_id=o AND attachment_path=o||'/tg.pdf'),NULL,repeat('d',64));
 PERFORM iqr_assert(result->>'status'='not_invoice','T4 unrelated document on an unlocked dossier stays in the conversation');
 PERFORM iqr_reject(format('SELECT register_late_invoice_from_message(%L,%L)',(SELECT id FROM messages WHERE colis_id=k AND attachment_path=k||'/tg3.pdf'),'CHAT-IQR-B'),'T4 « Oui » from another chat','42501');
 result:=register_late_invoice_from_message((SELECT id FROM messages WHERE colis_id=k AND attachment_path=k||'/tg3.pdf'),'CHAT-IQR-A');
 again:=register_late_invoice_from_message((SELECT id FROM messages WHERE colis_id=k AND attachment_path=k||'/tg3.pdf'),'CHAT-IQR-A');
 PERFORM iqr_assert(result->>'status'='registered' AND again->>'factureId'=result->>'factureId' AND (SELECT source='telegram' AND status='pending' FROM quote_withdrawals WHERE id=(result->>'withdrawalId')::uuid)
  AND (SELECT count(*)=1 FROM audit_actions WHERE colis_id=k AND action='telegram_late_invoice_confirmed'),'T4 « Oui » registers the invoice once and opens the request');
 -- A stale « Oui »: no quote left to update (unlocked dossier), then a quote sent after the document arrived.
 result:=register_late_invoice_from_message((SELECT id FROM messages WHERE colis_id=o AND attachment_path=o||'/tg2.pdf'),'CHAT-IQR-A');
 PERFORM iqr_assert(result->>'status'='stale' AND NOT EXISTS(SELECT 1 FROM factures WHERE fichier_url=o||'/tg2.pdf') AND NOT EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id=o),'T4 « Oui » on an unlocked dossier registers nothing');
 PERFORM iqr_as('postgres');
 -- Simulated time: a recorded message is final since 20261010000001, so it is moved back with triggers off.
 SET LOCAL session_replication_role='replica';
 UPDATE messages SET created_at=now()-interval '1 day' WHERE colis_id=d AND attachment_path=d||'/tg2.pdf';
 SET LOCAL session_replication_role='origin';
 PERFORM iqr_as('service');
 result:=register_late_invoice_from_message((SELECT id FROM messages WHERE colis_id=d AND attachment_path=d||'/tg2.pdf'),'CHAT-IQR-A');
 PERFORM iqr_assert(result->>'status'='stale' AND NOT EXISTS(SELECT 1 FROM factures WHERE fichier_url=d||'/tg2.pdf'),'T4 « Oui » about a document older than the sent quote registers nothing');
 PERFORM iqr_as('postgres');
END $$;

-- T4: processing the request (claim, release with backoff, completion, message state).
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-PORTAL'); w quote_withdrawals; claimed jsonb; result jsonb; before colis; sent_message uuid; failed boolean:=false; a staff_work_actions;
BEGIN
 SELECT * INTO before FROM colis WHERE id=d;
 SELECT * INTO w FROM quote_withdrawals WHERE colis_id=d;
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT claim_quote_withdrawal(%L)',w.id),'T6 claim is service only','42501');
 PERFORM iqr_as('service');
 claimed:=claim_quote_withdrawal(w.id);
 PERFORM iqr_assert(claimed->>'status'='processing' AND (claimed->>'attempts')::integer=1 AND claim_quote_withdrawal(w.id) IS NULL,'T4 claim takes the row once');
 BEGIN PERFORM complete_quote_withdrawal(w.id);
 EXCEPTION WHEN SQLSTATE '22023' THEN failed:=true; END;
 PERFORM iqr_assert(failed AND (SELECT status='processing' FROM quote_withdrawals WHERE id=w.id) AND (SELECT statut='devis_envoye' FROM colis WHERE id=d),'T4 completion without PayPlug proof fails and keeps the row processing');
 result:=release_quote_withdrawal(w.id,'retry','PayPlug indisponible');
 PERFORM iqr_assert(result->>'status'='pending' AND result->>'last_error'='PayPlug indisponible' AND (result->>'next_attempt_at')::timestamptz BETWEEN clock_timestamp()+interval '4 minutes' AND clock_timestamp()+interval '6 minutes'
  AND result->'locked_at'='null'::jsonb,'T4 retry backs off five minutes');
 PERFORM iqr_as('postgres');
 UPDATE quote_withdrawals SET next_attempt_at=clock_timestamp()+interval '1 day' WHERE id<>w.id AND status='pending';   -- other dossiers of this suite wait
 PERFORM iqr_as('service');
 PERFORM iqr_assert(claim_quote_withdrawal() IS NULL,'T4 the sweep does not claim a row before its next attempt');
 claimed:=claim_quote_withdrawal(w.id);
 PERFORM iqr_assert((claimed->>'attempts')::integer=2,'T4 an explicit claim does not wait for the backoff');
 PERFORM iqr_as('postgres');
 PERFORM iqr_prove(d);
 PERFORM iqr_as('service');
 result:=complete_quote_withdrawal(w.id);
 PERFORM iqr_assert(result->>'status'='withdrawn' AND result->'withdrawal'->>'client_message_status'='pending' AND (result->'withdrawal'->>'link_cancelled')::boolean
  AND (result->'withdrawal'->>'withdrawn_quote_version')::integer=before.quote_version AND result->'colis'->>'statut'='en_preparation','T4 completion withdraws after the proof and leaves the client message pending');
 PERFORM iqr_assert((complete_quote_withdrawal(w.id))->>'status'='withdrawn' AND (SELECT count(*)=1 FROM audit_actions WHERE colis_id=d AND action='quote_withdrawn'),'T4 a second completion is idempotent');
 PERFORM iqr_assert((release_quote_withdrawal(w.id,'retry','late'))->>'status'='withdrawn','T4 a late release never reopens a completed row');
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((SELECT count(*)=0 FROM payment_intents WHERE colis_id=d AND status IN ('pending','creating')),'T4 the old intent is superseded');
 SELECT * INTO a FROM staff_work_actions WHERE colis_id=d AND kind='documents';
 PERFORM iqr_assert(a.state<>'done' AND a.blocked_reason IS NULL AND a.action_hint='Vérifier la nouvelle facture puis renvoyer le devis' AND a.priority_reason='Facture reçue après l’envoi du devis','T4 after the withdrawal the new invoice is actionable with hint and priority');
 PERFORM iqr_as('client');
 PERFORM iqr_assert((SELECT quote_update_pending AND payplug_payment_url IS NULL FROM client_colis WHERE id=d),'T4 the portal keeps showing the update until the new quote');
 PERFORM iqr_as('service');
 INSERT INTO messages(colis_id,type,texte,statut,canal,template) VALUES(d,'staff','Votre facture est bien reçue','envoye','telegram','facture_apres_devis') RETURNING id INTO sent_message;
 PERFORM iqr_reject(format('SELECT mark_quote_withdrawal_message(%L,%s,%L)',d,before.quote_version,'unknown'),'T4 unknown message state','22023');
 PERFORM mark_quote_withdrawal_message(d,before.quote_version,'sent',sent_message);
 PERFORM iqr_assert((SELECT bool_and(q.client_message_status='sent' AND q.message_id=sent_message) FROM quote_withdrawals q WHERE q.colis_id=d),'T4 every row of the withdrawn version follows the delivered message');
 PERFORM mark_quote_withdrawal_message(d,before.quote_version,'failed');
 PERFORM iqr_assert((SELECT bool_and(client_message_status='sent') FROM quote_withdrawals WHERE colis_id=d),'T4 a delivered message is never downgraded');
 PERFORM iqr_as('postgres');
 INSERT INTO messages(colis_id,type,canal,texte,attachment_path,attachment_name,attachment_type,telegram_event_key) VALUES(d,'client','telegram','Photo',d||'/tg3.pdf','tg3.pdf','image/png','iqr:tg3:'||d);
 PERFORM iqr_assert((SELECT NOT _quote_locked(c) FROM colis c WHERE id=d),'T4 setup: the withdrawn quote is no longer locked');
 PERFORM iqr_as('service');
 PERFORM iqr_assert((register_telegram_document((SELECT id FROM messages WHERE colis_id=d AND attachment_path=d||'/tg3.pdf'),NULL,repeat('d',64)))->>'status'='ask_client','T4 after the withdrawal, while the update is open, an unrelated document still asks the client');
 PERFORM iqr_as('postgres');
 -- A new quote is sent: the request closes, the hint and the system priority are cleared.
 UPDATE colis SET devis_total=55,devis_transport=25,devis_snapshot='{"inputs":{"marker":"new"}}',devis_brouillon=false WHERE id=d;
 UPDATE colis SET statut='devis_envoye' WHERE id=d;
 PERFORM iqr_assert((SELECT bool_and(closed_at IS NOT NULL AND closed_reason='new_quote_sent') FROM quote_withdrawals WHERE colis_id=d),'T4 sending the new quote closes the request');
 PERFORM iqr_assert(NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id=d AND kind IN ('documents','quote') AND (action_hint IS NOT NULL OR priority_reason IS NOT NULL OR priority_until IS NOT NULL)),'T4 hint and system priority cleared');
 PERFORM iqr_as('client');
 PERFORM iqr_assert((SELECT NOT quote_update_pending AND devis_total=55 FROM client_colis WHERE id=d),'T4 the portal shows the new quote');
 PERFORM iqr_as('postgres');
END $$;

-- T4: superseded and paid outcomes; a pending message becomes skipped; the payment booked while pending.
SELECT iqr_dossier('IQR-SUPERSEDED','sent'),iqr_dossier('IQR-PAIDLATE','sent'),iqr_dossier('IQR-BOOKED','sent'),iqr_dossier('IQR-SKIP','sent');
DO $$
DECLARE s uuid:=(SELECT id FROM colis WHERE ref='IQR-SUPERSEDED'); p uuid:=(SELECT id FROM colis WHERE ref='IQR-PAIDLATE'); b uuid:=(SELECT id FROM colis WHERE ref='IQR-BOOKED'); k uuid:=(SELECT id FROM colis WHERE ref='IQR-SKIP');
 result jsonb; w uuid; intent payment_intents; a staff_work_actions;
BEGIN
 PERFORM iqr_as('client');
 PERFORM deposit_client_invoice(s,s||'/late.pdf','late.pdf'); PERFORM deposit_client_invoice(p,p||'/late.pdf','late.pdf');
 PERFORM deposit_client_invoice(b,b||'/late.pdf','late.pdf'); PERFORM deposit_client_invoice(k,k||'/late.pdf','late.pdf');
 PERFORM iqr_as('postgres');
 UPDATE colis SET devis_total=41 WHERE id=s;
 PERFORM iqr_as('service');
 result:=complete_quote_withdrawal((SELECT id FROM quote_withdrawals WHERE colis_id=s));
 PERFORM iqr_assert(result->>'status'='superseded' AND result->'withdrawal'->>'closed_reason'='superseded' AND result->'withdrawal'->>'closed_at' IS NOT NULL,'T4 a changed quote version supersedes the request');
 PERFORM iqr_as('postgres');
 UPDATE colis SET paiement_montant=40 WHERE id=p;
 PERFORM iqr_as('service');
 result:=complete_quote_withdrawal((SELECT id FROM quote_withdrawals WHERE colis_id=p));
 PERFORM iqr_assert(result->>'status'='paid' AND result->'withdrawal'->>'closed_reason'='paid','T4 a frozen dossier closes the request as paid');
 SELECT * INTO intent FROM payment_intents WHERE colis_id=b;
 PERFORM confirm_payplug_payment(intent.provider_id,b,intent.quote_version,4000,'EUR');
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((SELECT statut='paye' FROM colis WHERE id=b) AND (SELECT status='paid' AND closed_reason='paid' AND closed_at IS NOT NULL FROM quote_withdrawals WHERE colis_id=b),'T4 a payment booked while the request is pending closes it as paid');
 SELECT * INTO a FROM staff_work_actions WHERE colis_id=b AND kind='documents';
 PERFORM iqr_assert(a.action_hint IS NULL AND a.priority_reason IS NULL,'T4 the paid dossier keeps no late-invoice hint');
 PERFORM iqr_as('client');
 PERFORM iqr_assert((deposit_client_invoice(b,b||'/late2.pdf','late2.pdf'))->>'status'='frozen','T4 invoices are frozen after the booked payment');
 PERFORM iqr_as('director');
 PERFORM iqr_assert((SELECT value->'lock'->'withdrawal'->>'status'='paid' FROM (SELECT get_invoice_review_context(b) AS value) x),'T4 the review context still shows the paid request');
 PERFORM iqr_as('postgres');
 -- Pending D3 message, then a new quote: skipped.
 PERFORM iqr_prove(k);
 PERFORM iqr_as('service');
 PERFORM claim_quote_withdrawal((SELECT id FROM quote_withdrawals WHERE colis_id=k));
 PERFORM complete_quote_withdrawal((SELECT id FROM quote_withdrawals WHERE colis_id=k));
 PERFORM iqr_as('postgres');
 UPDATE colis SET devis_total=50,devis_snapshot='{"inputs":{"marker":"new"}}',devis_brouillon=false WHERE id=k;
 UPDATE colis SET statut='devis_envoye' WHERE id=k;
 PERFORM iqr_assert((SELECT client_message_status='skipped' AND closed_reason='new_quote_sent' FROM quote_withdrawals WHERE colis_id=k),'T4 a still pending client message is skipped once the new quote is sent');
END $$;

-- Backoff to needs_review, staff re-arm and reclaim of a stuck row.
SELECT iqr_dossier('IQR-BACKOFF','sent');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-BACKOFF'); w uuid; result jsonb; a staff_work_actions;
BEGIN
 PERFORM iqr_as('client');
 w:=(deposit_client_invoice(d,d||'/late.pdf','late.pdf')->>'withdrawalId')::uuid;
 PERFORM iqr_as('postgres');
 UPDATE quote_withdrawals SET status='processing',attempts=5,locked_at=clock_timestamp() WHERE id=w;
 PERFORM iqr_as('service');
 result:=release_quote_withdrawal(w,'retry','PayPlug indisponible');
 PERFORM iqr_assert(result->>'status'='pending' AND (result->>'next_attempt_at')::timestamptz BETWEEN clock_timestamp()+interval '59 minutes' AND clock_timestamp()+interval '61 minutes','T4 fifth attempt backs off one hour');
 PERFORM iqr_as('postgres');
 UPDATE quote_withdrawals SET status='processing',attempts=6,locked_at=clock_timestamp() WHERE id=w;
 PERFORM iqr_as('service');
 result:=release_quote_withdrawal(w,'retry','Toujours indisponible');
 PERFORM iqr_assert(result->>'status'='needs_review' AND claim_quote_withdrawal(w) IS NULL,'T4 after six attempts the request needs review and is not claimed automatically');
 PERFORM iqr_as('postgres');
 SELECT * INTO a FROM staff_work_actions WHERE colis_id=d AND kind='documents';
 PERFORM iqr_assert(a.state='waiting' AND a.blocked_reason='Ancien lien de paiement à vérifier dans PayPlug' AND a.action_hint IS NOT NULL,'T4 needs_review shows the PayPlug verification task');
 PERFORM iqr_as('client');
 PERFORM iqr_assert((SELECT quote_update_pending AND payplug_payment_url IS NULL FROM client_colis WHERE id=d),'T4 the portal keeps hiding the old link while staff verify it');
 PERFORM iqr_as('service');
 result:=claim_quote_withdrawal(w,true);
 PERFORM iqr_assert(result->>'status'='processing' AND (result->>'attempts')::integer=1 AND result->'last_error'='null'::jsonb,'T4 a staff retry re-arms the request');
 PERFORM iqr_as('postgres');
 UPDATE quote_withdrawals SET locked_at=clock_timestamp()-interval '6 minutes' WHERE id=w;
 UPDATE quote_withdrawals SET next_attempt_at=clock_timestamp()+interval '1 day' WHERE id<>w AND status='pending';
 PERFORM iqr_as('service');
 result:=claim_quote_withdrawal();
 PERFORM iqr_assert(result->>'id'=w::text AND (result->>'attempts')::integer=2,'T4 a stuck processing row is reclaimed by the sweep');
 result:=release_quote_withdrawal(w,'review','Montant différent chez PayPlug');
 PERFORM iqr_assert(result->>'status'='needs_review' AND result->>'last_error'='Montant différent chez PayPlug','T4 a mismatch goes to review');
 PERFORM iqr_reject(format('SELECT release_quote_withdrawal(%L,%L,NULL)',w,'other'),'T4 unknown release outcome','22023');
 PERFORM iqr_as('postgres');
END $$;

-- Round 2 (PAY-R2-01): a request left open across a quote correction never absorbs a later invoice nor hides the new link.
SELECT iqr_dossier('IQR-STALEREQ','sent');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-STALEREQ'); w uuid; fresh quote_withdrawals; result jsonb; v integer;
BEGIN
 PERFORM iqr_as('client');
 w:=(deposit_client_invoice(d,d||'/late.pdf','late.pdf')->>'withdrawalId')::uuid;
 PERFORM iqr_as('service');
 PERFORM claim_quote_withdrawal(w);
 PERFORM release_quote_withdrawal(w,'review','PayPlug ne répond pas');
 PERFORM iqr_as('postgres');
 PERFORM iqr_prove(d);
 PERFORM iqr_as('director');
 PERFORM correct_colis_task(d,'devis','{}',(SELECT updated_at FROM colis WHERE id=d),'Correction du devis');
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((SELECT statut='en_preparation' FROM colis WHERE id=d) AND (SELECT status='needs_review' AND closed_at IS NULL FROM quote_withdrawals WHERE id=w),'R2 setup: the correction leaves the request of the old version open');
 -- The new quote is sent with a new link (end state of the send path).
 UPDATE colis SET devis_total=55,devis_transport=30,devis_om=12,devis_omr=3,devis_tva=10,devis_snapshot='{"inputs":{"marker":"new"}}',devis_brouillon=false WHERE id=d;
 UPDATE colis SET statut='devis_envoye',devis_envoye_le=now() WHERE id=d RETURNING quote_version INTO v;
 INSERT INTO payment_intents(colis_id,quote_version,amount_cents,status,provider_id,payment_url,provider_is_live) VALUES(d,v,5500,'pending','pay_iqrstalenew','https://example.test/iqrstalenew',false);
 UPDATE colis SET payplug_payment_id='pay_iqrstalenew',payplug_payment_url='https://example.test/iqrstalenew' WHERE id=d;
 PERFORM iqr_assert((SELECT status='superseded' AND closed_reason='superseded' AND closed_at IS NOT NULL FROM quote_withdrawals WHERE id=w),'R2 sending the new quote supersedes the request of the old version');
 PERFORM iqr_as('client');
 PERFORM iqr_assert((SELECT NOT quote_update_pending AND payplug_payment_url='https://example.test/iqrstalenew' FROM client_colis WHERE id=d),'R2 the portal shows the new quote link once it is sent');
 result:=deposit_client_invoice(d,d||'/late2.pdf','late2.pdf');
 PERFORM iqr_as('postgres');
 SELECT * INTO fresh FROM quote_withdrawals WHERE id=(result->>'withdrawalId')::uuid;
 PERFORM iqr_assert(fresh.id<>w AND fresh.status='pending' AND fresh.quote_version=v AND cardinality(fresh.facture_ids)=1
  AND (SELECT cardinality(facture_ids)=1 FROM quote_withdrawals WHERE id=w),'R2 a late invoice on the new quote opens a fresh request at the current version');
 PERFORM iqr_prove(d);
 PERFORM iqr_as('service');
 PERFORM claim_quote_withdrawal(fresh.id);
 result:=complete_quote_withdrawal(fresh.id);
 PERFORM iqr_assert(result->>'status'='withdrawn' AND result->'colis'->>'statut'='en_preparation' AND result->'colis'->'payplug_payment_url'='null'::jsonb
  AND (result->'withdrawal'->>'withdrawn_quote_version')::integer=v,'R2 processing the fresh request withdraws the new quote and its link');
 PERFORM iqr_as('postgres');
 -- A still open request of an older version is superseded by the next client invoice (pending variant, no new quote sent yet).
 UPDATE colis SET devis_total=60,devis_snapshot='{"inputs":{"marker":"third"}}',devis_brouillon=false WHERE id=d;
 UPDATE colis SET statut='devis_envoye' WHERE id=d;
 UPDATE quote_withdrawals SET status='pending',closed_at=NULL,closed_reason=NULL WHERE id=w;   -- as if it had been left open
 PERFORM iqr_as('client');
 result:=deposit_client_invoice(d,d||'/late3.pdf','late3.pdf');
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((SELECT status='superseded' AND cardinality(facture_ids)=1 FROM quote_withdrawals WHERE id=w)
  AND (SELECT quote_version=(SELECT quote_version FROM colis WHERE id=d) FROM quote_withdrawals WHERE id=(result->>'withdrawalId')::uuid),'R2 a stale open request is superseded instead of absorbing the next invoice');
END $$;

-- Review findings (2026-10-04): PayPlug « paid » alone, the read-only pre-check of a withdrawal, the stored object limits.
SELECT iqr_dossier('IQR-PAIDREVIEW','sent'),iqr_dossier('IQR-PREFLIGHT','sent');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-PAIDREVIEW'); p uuid:=(SELECT id FROM colis WHERE ref='IQR-PREFLIGHT'); w uuid; result jsonb;
 pv uuid; pu uuid; dv uuid; pv_tok text; pu_tok text; d_conv uuid; p_conv uuid;
BEGIN
 pv:=iqr_v(p); pu:=iqr_u(p); dv:=iqr_v(d); pv_tok:=iqr_tok(pv); pu_tok:=iqr_tok(pu);
 SELECT id INTO d_conv FROM messages WHERE colis_id=d AND attachment_path=d||'/conv.pdf'; SELECT id INTO p_conv FROM messages WHERE colis_id=p AND attachment_path=p||'/conv.pdf';
 PERFORM iqr_as('client');
 w:=(deposit_client_invoice(d,d||'/late.pdf','late.pdf')->>'withdrawalId')::uuid;
 PERFORM iqr_as('service');
 PERFORM claim_quote_withdrawal(w);
 result:=release_quote_withdrawal(w,'paid','Un paiement est signalé chez PayPlug pour ce devis.');
 PERFORM iqr_assert(result->>'status'='needs_review' AND result->'closed_at'='null'::jsonb AND result->'closed_reason'='null'::jsonb
  AND result->>'last_error' LIKE 'Paiement signalé chez PayPlug mais non enregistré%','PAY-1 PayPlug « paid » without a booked payment leaves the request for reconciliation');
 PERFORM iqr_as('client');
 PERFORM iqr_assert((SELECT quote_update_pending AND payplug_payment_url IS NULL FROM client_colis WHERE id=d),'PAY-1 the old link stays masked while the payment is reconciled');
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((SELECT state<>'done' FROM staff_work_actions WHERE colis_id=d AND kind='documents'),'PAY-1 the late invoice stays in the task projection');
 UPDATE colis SET paiement_montant=40 WHERE id=d;
 PERFORM iqr_as('service');
 PERFORM claim_quote_withdrawal(w,true);
 result:=release_quote_withdrawal(w,'paid',NULL);
 PERFORM iqr_assert(result->>'status'='paid' AND result->>'closed_reason'='paid','PAY-1 a booked payment closes the request as paid');
 -- SEC-1: the read-only pre-check refuses an invalid follow-up before any PayPlug call, and changes nothing.
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT withdraw_quote_preflight(%L,%L,%L,%L)',p,'open_modification',pv,pv_tok),'SEC-1 pre-check is service only','42501');
 PERFORM iqr_as('service');
 PERFORM iqr_reject(format('SELECT withdraw_quote_preflight(%L,%L,%L,%L)',p,'open_modification',pv,'stale-token'),'SEC-1 stale review token','40001');
 PERFORM iqr_reject(format('SELECT withdraw_quote_preflight(%L,%L,%L,NULL)',p,'open_modification',pv),'SEC-1 missing review token','40001');
 PERFORM iqr_reject(format('SELECT withdraw_quote_preflight(%L,%L,%L,%L)',p,'open_modification',pu,pu_tok),'SEC-1 unvalidated invoice','22023');
 PERFORM iqr_reject(format('SELECT withdraw_quote_preflight(%L,%L,%L)',p,'replace_document',dv),'SEC-1 invoice of another dossier','22023');
 PERFORM iqr_reject(format('SELECT withdraw_quote_preflight(%L,%L,NULL,NULL,%L)',p,'import_attachment',d_conv),'SEC-1 attachment of another dossier','22023');
 PERFORM iqr_reject(format('SELECT withdraw_quote_preflight(%L,%L)',gen_random_uuid(),'manual_articles'),'SEC-1 unknown dossier','22023');
 PERFORM iqr_assert(withdraw_quote_preflight(p,'open_modification',pv,pv_tok) AND withdraw_quote_preflight(p,'manual_articles')
  AND withdraw_quote_preflight(p,'import_attachment',NULL,NULL,p_conv),'SEC-1 a valid follow-up passes the pre-check');
 -- SEC-3: the stored object's size and type are checked by the deposit command itself.
 PERFORM iqr_as('postgres');
 UPDATE storage.objects SET metadata=jsonb_build_object('size',20971521,'mimetype','application/pdf') WHERE bucket_id='factures' AND name=p||'/late2.pdf';
 UPDATE storage.objects SET metadata=jsonb_build_object('size',1000,'mimetype','text/html') WHERE bucket_id='factures' AND name=p||'/late3.pdf';
 UPDATE storage.objects SET metadata=jsonb_build_object('size',1000,'mimetype','application/pdf') WHERE bucket_id='factures' AND name=p||'/late.pdf';
 PERFORM iqr_as('client');
 PERFORM iqr_reject(format('SELECT deposit_client_invoice(%L,%L,%L)',p,p||'/late2.pdf','late2.pdf'),'SEC-3 object over 20 MB','22023');
 PERFORM iqr_reject(format('SELECT deposit_client_invoice(%L,%L,%L)',p,p||'/late3.pdf','late3.pdf'),'SEC-3 object stored as HTML','22023');
 PERFORM iqr_assert((deposit_client_invoice(p,p||'/late.pdf','late.pdf'))->>'status'='intake','SEC-3 a PDF within the limit is accepted');
 PERFORM iqr_as('postgres');
END $$;

-- T5: D1, the analysis gate and the review context.
SELECT iqr_dossier('IQR-D1','open');
DO $$
DECLARE d uuid:=(SELECT id FROM colis WHERE ref='IQR-D1'); v uuid; u uuid; result jsonb; ctx jsonb; inv jsonb; copy_id uuid; validated_id uuid; fresh_id uuid;
BEGIN
 v:=iqr_v(d); u:=iqr_u(d);
 PERFORM iqr_as('service');
 PERFORM iqr_reject(format('INSERT INTO ocr_extractions(facture_id,document_hash,document_file_url,lines,total) VALUES(%L,%L,%L,%L,0)',v,repeat('9',64),d||'/valide.pdf','[]'),'T5 no new analysis of a validated invoice without modification','22023','analysis_not_allowed:validated');
 PERFORM iqr_assert((invoice_analysis_gate(v))=jsonb_build_object('allowed',false,'reason','validated','colisId',d) AND (invoice_analysis_gate(u))->>'allowed'='true'
  AND (invoice_analysis_gate(iqr_x(d)))->>'reason'='inactive' AND (invoice_analysis_gate(gen_random_uuid()))=jsonb_build_object('allowed',false,'reason','missing'),'T5 analysis gate for validated, unvalidated, copy and missing invoices');
 result:=invoice_lock_state(d);
 PERFORM iqr_assert(result->'frozenReason'='null'::jsonb AND NOT (result->>'quoteLocked')::boolean AND NOT (result->>'quoteSent')::boolean AND NOT (result->>'creating')::boolean
  AND result->>'statut'='en_preparation' AND (result->>'updatedAt')::timestamptz=(SELECT updated_at FROM colis WHERE id=d),'T5 lock state read model');
 PERFORM iqr_as('director');
 PERFORM iqr_reject(format('SELECT invoice_lock_state(%L)',d),'T6 lock state is service only','42501');
 PERFORM iqr_reject(format('SELECT invoice_analysis_gate(%L)',v),'T6 analysis gate is service only','42501');
 ctx:=get_invoice_review_context(d);
 SELECT value INTO inv FROM jsonb_array_elements(ctx->'invoices') WHERE value->>'factureId'=v::text;
 PERFORM iqr_assert(inv->'extraction'='null'::jsonb AND inv->>'documentHash'=repeat('a',64) AND NOT (inv->>'analysisAllowed')::boolean AND inv->>'analysisBlockedReason'='validated','T5 validated invoice without draft: no proposals, hash kept');
 SELECT value INTO inv FROM jsonb_array_elements(ctx->'invoices') WHERE value->>'factureId'=u::text;
 PERFORM iqr_assert(inv->'extraction'->>'document_hash'=repeat('c',64) AND (inv->>'analysisAllowed')::boolean AND inv->'analysisBlockedReason'='null'::jsonb,'T5 unvalidated invoice keeps its proposals');
 PERFORM iqr_assert(ctx->'lock'->'frozenReason'='null'::jsonb AND NOT (ctx->'lock'->>'quoteLocked')::boolean AND ctx->'lock'->'withdrawal'='null'::jsonb,'T5 lock summary of an open dossier');
 PERFORM iqr_reject(format('SELECT open_invoice_modification(%L,%L)',u,iqr_tok(u)),'T5 only a validated invoice is modified','22023');
 PERFORM iqr_reject(format('SELECT open_invoice_modification(%L,%L)',v,'stale'),'T5 stale token','40001');
 result:=open_invoice_modification(v,iqr_tok(v));
 PERFORM iqr_assert((result->>'created')::boolean AND result->>'reviewToken'=iqr_tok(v),'T5 « Modifier la vérification » opens a server draft');
 SELECT value INTO inv FROM jsonb_array_elements(get_invoice_review_context(d)->'invoices') WHERE value->>'factureId'=v::text;
 PERFORM iqr_assert(inv->'extraction'->>'document_hash'=repeat('a',64) AND (inv->>'analysisAllowed')::boolean AND inv->'draft'->'lines'->0->>'desc'='Article validé','T5 the open modification shows the proposals and the draft');
 PERFORM iqr_as('service');
 INSERT INTO ocr_extractions(facture_id,document_hash,document_file_url,lines,total) VALUES(v,repeat('9',64),d||'/valide.pdf','[]',0);
 PERFORM iqr_as('director');
 result:=close_invoice_modification(v,iqr_tok(v));
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((result->>'closed')::boolean AND NOT EXISTS(SELECT 1 FROM invoice_review_drafts WHERE facture_id=v) AND (SELECT count(*)=1 FROM audit_actions WHERE colis_id=d AND action='invoice_modification_closed') AND (SELECT valide FROM factures WHERE id=v),'T5 closing deletes the draft and keeps the validated version');
 -- Regression: confirming an unvalidated invoice with its analysis works without any saved draft.
 DELETE FROM invoice_review_drafts WHERE facture_id=u;
 UPDATE ocr_extractions SET document_storage_identity=invoice_storage_identity(document_file_url) WHERE facture_id=u;
 PERFORM iqr_as('director');
 result:=save_invoice_review(u,iqr_tok(u),d||'/u.pdf',iqr_lines()::jsonb,10,'Fournisseur',(SELECT id FROM ocr_extractions WHERE facture_id=u),true);
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert((result->>'confirmed')::boolean AND (SELECT status='confirmed' FROM ocr_extractions WHERE facture_id=u) AND (SELECT valide AND ocr_status='confirmed' FROM factures WHERE id=u),'T5 regression: confirmation with an analysis and without draft succeeds');
 -- Queue: validated invoices and copies are never analysed automatically.
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url) VALUES(d,'Déjà validée',10,true,d||'/late.pdf') RETURNING id INTO validated_id;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,duplicate_of_facture_id) VALUES(d,'Copie',10,false,d||'/late2.pdf',v) RETURNING id INTO copy_id;
 INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url) VALUES(d,'Nouvelle',0,false,d||'/late3.pdf') RETURNING id INTO fresh_id;
 PERFORM iqr_assert(NOT EXISTS(SELECT 1 FROM ocr_jobs WHERE facture_id IN (validated_id,copy_id)) AND (SELECT status='pending' FROM ocr_jobs WHERE facture_id=fresh_id)
  AND (SELECT ocr_status IS NULL FROM factures WHERE id=validated_id),'T5 the OCR queue skips validated invoices and copies');
 UPDATE ocr_jobs SET status='skipped',last_error='Analyse non lancée : validated' WHERE facture_id=fresh_id;
 PERFORM iqr_assert((SELECT status='skipped' FROM ocr_jobs WHERE facture_id=fresh_id),'T5 the worker can record a skipped job');
 -- A frozen dossier hides every proposal.
 UPDATE colis SET paiement_montant=1 WHERE id=d;
 PERFORM iqr_as('director');
 ctx:=get_invoice_review_context(d);
 PERFORM iqr_as('postgres');
 PERFORM iqr_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->'invoices') x WHERE x.value->'extraction'<>'null'::jsonb OR (x.value->>'analysisAllowed')::boolean)
  AND ctx->'lock'->>'frozenReason'='payment' AND (SELECT value->>'analysisBlockedReason' FROM jsonb_array_elements(ctx->'invoices') WHERE value->>'factureId'=fresh_id::text)='frozen','T5 a frozen dossier hides every analysis');
END $$;

-- T6: internal helpers and service commands.
DO $$
DECLARE fn text; role_name text;
BEGIN
 FOREACH fn IN ARRAY ARRAY['_dossier_frozen_reason(colis)','_frozen_message(text)','_live_payment_link(colis)','_quote_locked(colis)','_invoice_analysis_reason(factures)',
  '_identical_validated_invoice(uuid,text)','_late_invoice_open(uuid)','_late_invoice_withdrawal(factures)','_assert_invoices_editable(uuid,boolean)','_open_late_invoice_request(colis,uuid,text)',
  '_withdraw_quote(colis,text,text,text,uuid,uuid[])','_assert_withdrawal_followup(uuid,text,uuid,text,uuid)','_open_invoice_modification(uuid,text)','_import_conversation_attachment(uuid,uuid)','guard_invoice_lock()','guard_invoice_analysis()',
  '_assert_unpaid_dossier(uuid)','close_quote_withdrawals()'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_function_privilege(role_name,fn,'EXECUTE') THEN RAISE EXCEPTION 'FAIL: % can execute %',role_name,fn; END IF;
  END LOOP;
  IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid=fn::regprocedure) THEN RAISE EXCEPTION 'FAIL: % must be SECURITY DEFINER with search_path',fn; END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['invoice_lock_state(uuid)','invoice_analysis_gate(uuid)','client_document_precheck(uuid,uuid,text,text)','withdraw_quote_preflight(uuid,text,uuid,text,uuid)','register_telegram_document(uuid,text,text)',
  'register_late_invoice_from_message(uuid,text)','claim_quote_withdrawal(uuid,boolean)','release_quote_withdrawal(uuid,text,text)','complete_quote_withdrawal(uuid)',
  'mark_quote_withdrawal_message(uuid,integer,text,uuid,text)'] LOOP
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR NOT has_function_privilege('service_role',fn,'EXECUTE')
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid=fn::regprocedure) THEN RAISE EXCEPTION 'FAIL: service command grants %',fn; END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['open_invoice_modification(uuid,text)','close_invoice_modification(uuid,text)','withdraw_quote_for_documents(uuid,timestamptz,text,text,uuid,text,uuid)',
  'deposit_client_invoice(uuid,text,text,text,uuid)'] LOOP
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE') OR NOT has_function_privilege('authenticated',fn,'EXECUTE')
   OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid=fn::regprocedure) THEN RAISE EXCEPTION 'FAIL: authenticated command grants %',fn; END IF;
 END LOOP;
 IF has_function_privilege('authenticated','register_requested_invoice(uuid,text)','EXECUTE') OR NOT has_function_privilege('service_role','register_requested_invoice(uuid,text)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: legacy Telegram wrapper keeps its service-only ACL'; END IF;
 RAISE NOTICE 'PASS: helpers private, service commands service-only, staff and client commands authenticated-only, all SECURITY DEFINER with search_path';
END $$;
SELECT iqr_as('client');
SELECT iqr_assert((SELECT count(*)=0 FROM quote_withdrawals),'T6 a client reads no withdrawal request');
SELECT iqr_reject($q$INSERT INTO quote_withdrawals(colis_id,source,quote_version,reason) SELECT id,'portal',1,'Forgé' FROM colis LIMIT 1$q$,'T6 a client cannot write a withdrawal request','42501');
SELECT iqr_as('director');
SELECT iqr_assert((SELECT count(*)>0 FROM quote_withdrawals),'T6 staff read withdrawal requests');
SELECT iqr_reject($q$UPDATE quote_withdrawals SET status='withdrawn'$q$,'T6 staff cannot write withdrawal requests directly','42501');
SELECT iqr_as('postgres');
ROLLBACK;
