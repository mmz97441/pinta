BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE FUNCTION work_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL %',label; END IF;RAISE NOTICE 'PASS %',label;END; $$;
CREATE FUNCTION work_reject(command text,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE command;EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS reject % [%]',label,SQLSTATE;RETURN;END;RAISE EXCEPTION 'FAIL accepted %',label;END; $$;
INSERT INTO auth.users(id,email) VALUES
 ('e1000000-0000-4000-8000-000000000001','director-work@example.test'),('e1000000-0000-4000-8000-000000000002','prep-a@example.test'),
 ('e1000000-0000-4000-8000-000000000003','prep-b@example.test'),('e1000000-0000-4000-8000-000000000004','log-work@example.test'),('e1000000-0000-4000-8000-000000000005','client-work@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Direction','director-work@example.test','directeur',false),
 ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','Alex','prep-a@example.test','preparateur',false),
 ('e2000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000003','Sam','prep-b@example.test','preparateur',false),
 ('e2000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000004','Logistique','log-work@example.test','logisticien',false);
INSERT INTO staff_permissions(staff_id,perm_colis_preparer,perm_envois_voir,perm_colis_affecter_envoi,perm_envois_modifier,perm_envois_reaffecter) VALUES
 ('e2000000-0000-4000-8000-000000000002',true,false,false,false,false),('e2000000-0000-4000-8000-000000000003',true,false,false,false,false),('e2000000-0000-4000-8000-000000000004',false,true,true,false,false);
INSERT INTO clients(id,user_id,nom,cp,email) VALUES('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000005','Client','97400','client-work@example.test');
INSERT INTO clients(id,nom,cp,email) VALUES('e3000000-0000-4000-8000-000000000002','Sans accès','97400','no-access@example.test');
INSERT INTO colis(id,client_id,statut,feu_vert) VALUES
 ('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','autorise','autorise'),
 ('e4000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001','autorise','autorise'),
 ('e4000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000001','livre','autorise'),
 ('e4000000-0000-4000-8000-000000000004','e3000000-0000-4000-8000-000000000002','mesure',NULL);
SELECT set_config('test.action',(SELECT id::text FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000001' AND kind='preparation'),true);
SELECT work_assert((SELECT state='ready' FROM staff_work_actions WHERE id=current_setting('test.action')::uuid),'Preparation ready despite missing invoice');
SELECT work_assert((SELECT state='waiting' AND blocked_reason='Facture attendue du client' FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000001' AND kind='documents'),'Documents await customer independently');
SELECT work_assert((SELECT state='waiting' FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000001' AND kind='quote'),'Quote waits for measurements and invoice');
SELECT work_assert((SELECT action_hint='Accès client à activer' AND state='ready' FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000004' AND kind='conversation'),'Missing client channel is actionable');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000005',true);
SELECT work_assert((SELECT count(*)=0 FROM staff_work_actions),'Client cannot read internal actions');
SELECT work_assert((SELECT count(*)=0 FROM staff_work_preferences),'Client cannot read availability/preferences');
SELECT work_reject($q$SELECT mutate_staff_work_action(current_setting('test.action')::uuid,'claim',1)$q$,'Client cannot claim');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
SELECT work_assert((mutate_staff_work_action(current_setting('test.action')::uuid,'claim',1)).assignee_id=auth.uid(),'First owner claims atomically');
SELECT work_assert((SELECT responsible_staff_id IS NULL FROM colis WHERE id='e4000000-0000-4000-8000-000000000001'),'Action ownership does not change dossier referent');
SELECT work_reject($q$INSERT INTO staff_work_actions(colis_id,kind) VALUES('e4000000-0000-4000-8000-000000000002','correction')$q$,'Direct action creation denied');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000003',true);
SELECT work_reject($q$SELECT mutate_staff_work_action(current_setting('test.action')::uuid,'claim',1)$q$,'Stale second claimant rejected');
SELECT work_reject($q$SELECT mutate_staff_work_action(current_setting('test.action')::uuid,'claim',2)$q$,'Current version cannot steal action');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
SELECT work_assert((mutate_staff_work_action(current_setting('test.action')::uuid,'start',2)).state='in_progress','Owner starts preparation');
SELECT work_assert((mutate_staff_work_action(current_setting('test.action')::uuid,'handoff',3,'{"staff_id":"e1000000-0000-4000-8000-000000000003","note":"Cartons au casier A"}')).assignee_id=auth.uid(),'Requested handoff keeps original owner');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000003',true);
SELECT work_assert(EXISTS(SELECT 1 FROM notifications WHERE user_id='e1000000-0000-4000-8000-000000000003' AND type='work_action'),'Handoff sends targeted notification');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
SELECT work_reject($q$SELECT mutate_staff_work_action(current_setting('test.action')::uuid,'accept',4)$q$,'Sender cannot accept own outgoing handoff');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000003',true);
SELECT work_assert((mutate_staff_work_action(current_setting('test.action')::uuid,'accept',4)).assignee_id=auth.uid(),'Named recipient accepts transfer');
SELECT work_assert((mutate_staff_work_action(current_setting('test.action')::uuid,'wait',5,'{"reason":"Contrôle emballage","review_at":"2099-01-01T00:00:00Z"}')).state='waiting','Owner records separate waiting reason');
SELECT work_assert((mutate_staff_work_action(current_setting('test.action')::uuid,'resume',6)).state='ready','Manual wait can resume');
SELECT work_reject($q$SELECT mutate_staff_work_action(current_setting('test.action')::uuid,'reassign',7,'{"staff_id":"e1000000-0000-4000-8000-000000000002","reason":"Remplacement"}')$q$,'Non-direction cannot force reassignment');
SELECT work_assert((mutate_staff_work_action(current_setting('test.action')::uuid,'release',7)).assignee_id IS NULL,'Explicit release returns common queue');
SELECT work_reject($q$SELECT mutate_staff_work_action(current_setting('test.action')::uuid,'done',8)$q$,'Cannot fake completion outside business command');
SELECT work_assert((save_staff_work_preferences('{"missions":["preparation","documents"],"active_mission":null,"available":false}',NULL)).available=false,'Personal missions and absence saved');
SELECT work_reject($q$SELECT save_staff_work_preferences('{"available":true}',NULL)$q$,'Stale preferences rejected');
SELECT work_assert(NOT has_permission('perm_factures_valider'),'Document mission never grants document permission');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
SELECT work_reject($q$SELECT mutate_staff_work_action(current_setting('test.action')::uuid,'reassign',8,'{"staff_id":"e1000000-0000-4000-8000-000000000002"}')$q$,'Forced assignment requires reason');
SELECT work_assert((mutate_staff_work_action(current_setting('test.action')::uuid,'reassign',8,'{"staff_id":"e1000000-0000-4000-8000-000000000002","reason":"Absence de Sam"}')).assignee_id='e1000000-0000-4000-8000-000000000002','Direction can reassign with trace');
SELECT work_assert(EXISTS(SELECT 1 FROM audit_actions WHERE action='work_action_reassign' AND detail::jsonb->>'reason'='Absence de Sam'),'Reassignment reason audited');
SELECT work_reject($q$SELECT queue_message('e4000000-0000-4000-8000-000000000004','Bonjour',NULL,NULL,NULL,'portal')$q$,'Portal cannot falsely deliver to unlinked client');
RESET ROLE;
UPDATE clients SET telegram_chat_id='work-linked' WHERE id='e3000000-0000-4000-8000-000000000002';
SELECT work_assert((SELECT state='done' FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000004' AND kind='conversation'),'Linking client channel resolves access action');

-- Waiting review and manual task promises survive unrelated dossier updates.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
SELECT mutate_staff_work_action(current_setting('test.action')::uuid,'wait',9,'{"reason":"Contrôle emballage","review_at":"2099-01-01T00:00:00Z"}');
RESET ROLE;
UPDATE staff_work_actions SET review_at=now()-interval '1 minute' WHERE id=current_setting('test.action')::uuid;
SET LOCAL ROLE authenticated;
SELECT refresh_staff_work_actions();
SELECT work_assert((SELECT state='ready' AND waiting_reason IS NULL FROM staff_work_actions WHERE id=current_setting('test.action')::uuid),'Expired manual wait returns to ready without business approval');
SELECT mutate_staff_work_action(current_setting('test.action')::uuid,'start',11,'{"due_at":"2099-02-01T12:00:00Z"}');
RESET ROLE;
UPDATE colis SET notes_internes='Information sans effet sur la promesse' WHERE id='e4000000-0000-4000-8000-000000000001';
SELECT work_assert((SELECT due_at='2099-02-01T12:00:00Z' AND due_at_source='manual' FROM staff_work_actions WHERE id=current_setting('test.action')::uuid),'A dossier refresh preserves explicit task deadline');
INSERT INTO colis(id,client_id,statut,feu_vert,attente_client_date,attente_client_until) VALUES('e4000000-0000-4000-8000-000000000007','e3000000-0000-4000-8000-000000000001','attente_feu_vert','en_attente',now()-interval '2 days',now()-interval '1 day');
UPDATE colis SET attente_client_date=now()-interval '2 days',attente_client_until=now()-interval '1 day' WHERE id='e4000000-0000-4000-8000-000000000007';
SELECT work_assert((SELECT state='ready' AND action_hint='Réexaminer l’attente client' FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000007' AND kind='reception'),'Expired customer wait creates review action');
SELECT work_assert((SELECT feu_vert='en_attente' FROM colis WHERE id='e4000000-0000-4000-8000-000000000007'),'Review deadline never grants customer consent');

-- Taking responsibility for a customer wait must not start the business work.
INSERT INTO colis(id,client_id,statut,feu_vert,responsible_staff_id) VALUES
 ('e4000000-0000-4000-8000-000000000009','e3000000-0000-4000-8000-000000000001','attente_feu_vert','en_attente','e1000000-0000-4000-8000-000000000002');
SELECT set_config('test.waiting_action',(SELECT id::text FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000009' AND kind='reception'),true);
SELECT set_config('test.waiting_before',(SELECT to_jsonb(a)::text FROM staff_work_actions a WHERE id=current_setting('test.waiting_action')::uuid),true);
SELECT set_config('test.waiting_dossier',(SELECT to_jsonb(c)::text FROM colis c WHERE id='e4000000-0000-4000-8000-000000000009'),true);
SELECT work_assert((SELECT state='waiting' AND assignee_id IS NULL AND blocked_reason='Accord client attendu' FROM staff_work_actions WHERE id=current_setting('test.waiting_action')::uuid),'Customer wait is unassigned and remains a genuine business blockage');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
SELECT work_reject($q$SELECT mutate_staff_work_action(current_setting('test.waiting_action')::uuid,'claim',(current_setting('test.waiting_before')::jsonb->>'version')::integer)$q$,'Preparation permission does not allow claiming customer agreement work');
SELECT work_assert((SELECT to_jsonb(a)=current_setting('test.waiting_before')::jsonb FROM staff_work_actions a WHERE id=current_setting('test.waiting_action')::uuid),'Unauthorized claim leaves the waiting task untouched');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
SELECT work_assert((mutate_staff_work_action(current_setting('test.waiting_action')::uuid,'claim',(current_setting('test.waiting_before')::jsonb->>'version')::integer)).assignee_id=auth.uid(),'Eligible staff can take responsibility for a blocked customer wait');
SELECT work_assert((SELECT (to_jsonb(a)-ARRAY['assignee_id','version','updated_at'])=(current_setting('test.waiting_before')::jsonb-ARRAY['assignee_id','version','updated_at']) AND version=(current_setting('test.waiting_before')::jsonb->>'version')::integer+1 FROM staff_work_actions a WHERE id=current_setting('test.waiting_action')::uuid),'Claim preserves waiting state, blockage, dates and all business prerequisites');
SELECT work_assert((SELECT to_jsonb(c)=current_setting('test.waiting_dossier')::jsonb FROM colis c WHERE id='e4000000-0000-4000-8000-000000000009'),'Claim changes neither customer agreement nor dossier referent, measurements or status');
SELECT work_reject($q$SELECT mutate_staff_work_action(current_setting('test.waiting_action')::uuid,'start',(SELECT version FROM staff_work_actions WHERE id=current_setting('test.waiting_action')::uuid))$q$,'Taking a waiting task does not authorize starting without customer agreement');
SELECT work_assert((SELECT state='waiting' AND assignee_id=auth.uid() AND started_at IS NULL FROM staff_work_actions WHERE id=current_setting('test.waiting_action')::uuid),'Rejected start keeps claimed customer wait assigned and unstarted');
SELECT work_assert(EXISTS(SELECT 1 FROM audit_actions WHERE colis_id='e4000000-0000-4000-8000-000000000009' AND action='work_action_claim' AND user_id=auth.uid() AND detail::jsonb#>>'{after,state}'='waiting'),'Claiming customer wait records the actor and preserved waiting state');
RESET ROLE;
SELECT work_assert(NOT EXISTS(SELECT 1 FROM messages WHERE colis_id='e4000000-0000-4000-8000-000000000009') AND NOT EXISTS(SELECT 1 FROM notifications WHERE colis_id='e4000000-0000-4000-8000-000000000009') AND NOT EXISTS(SELECT 1 FROM notification_outbox WHERE colis_id='e4000000-0000-4000-8000-000000000009'),'Claiming an unassigned wait queues no customer or colleague notification');

-- Pro transport quotes have distinct commercial prerequisites from customs documents.
INSERT INTO clients(id,nom,cp,email,type) VALUES('e3000000-0000-4000-8000-000000000003','Pro transport','97400','pro-work@example.test','pro');
INSERT INTO colis(id,client_id,statut,feu_vert) VALUES('e4000000-0000-4000-8000-000000000008','e3000000-0000-4000-8000-000000000003','en_preparation','autorise');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
SELECT save_preparation_measurements('e4000000-0000-4000-8000-000000000008','[{"dimL":20,"dimW":20,"dimH":20,"poids":1}]',(SELECT updated_at FROM colis WHERE id='e4000000-0000-4000-8000-000000000008'),0);
SELECT work_assert((SELECT state='ready' AND blocked_reason IS NULL FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000008' AND kind='quote'),'Prepared pro transport quote is actionable without tax documents');
SELECT work_assert((SELECT state='waiting' AND blocked_reason='Facture attendue du client' FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000008' AND kind='documents'),'Pro document work remains separate from transport quote readiness');
RESET ROLE;
UPDATE colis SET produit_interdit=true WHERE id='e4000000-0000-4000-8000-000000000008';
SELECT work_assert((SELECT state='waiting' AND blocked_reason='Contenu à vérifier avant le devis' FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000008' AND kind='quote'),'Pro quote also respects declared operational content blockage');
UPDATE colis SET produit_interdit=false,feu_vert='refuse' WHERE id='e4000000-0000-4000-8000-000000000008';
SELECT work_assert((SELECT state='waiting' AND blocked_reason='Accord client requis' FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000008' AND kind='quote'),'Quote action never bypasses refused client consent');
UPDATE colis SET feu_vert='autorise' WHERE id='e4000000-0000-4000-8000-000000000008';
UPDATE clients SET type='particulier' WHERE id='e3000000-0000-4000-8000-000000000003';
SELECT work_assert((SELECT state='waiting' AND blocked_reason='Documents à valider' FROM staff_work_actions WHERE colis_id='e4000000-0000-4000-8000-000000000008' AND kind='quote'),'Changing client kind recalculates quote prerequisites immediately');

-- Separate scheduling / assignment permissions, immutable grouped departure.
INSERT INTO envois(id,destination_code,date_depart,statut) VALUES
 ('e5000000-0000-4000-8000-000000000001','974',(now() AT TIME ZONE 'Europe/Paris')::date,'planifie'),
 ('e5000000-0000-4000-8000-000000000002','974',(now() AT TIME ZONE 'Europe/Paris')::date+7,'planifie'),
 ('e5000000-0000-4000-8000-000000000003','974',(now() AT TIME ZONE 'Europe/Paris')::date-1,'planifie'),
 ('e5000000-0000-4000-8000-000000000004','971',(now() AT TIME ZONE 'Europe/Paris')::date+7,'planifie');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000004',true);
SELECT work_assert((assign_colis_departure('e4000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001',(SELECT updated_at FROM colis WHERE id='e4000000-0000-4000-8000-000000000001'))).envoi_id='e5000000-0000-4000-8000-000000000001','Initial assignment permitted with dedicated flag');
SELECT work_reject($q$SELECT assign_colis_departure('e4000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000002',(SELECT updated_at FROM colis WHERE id='e4000000-0000-4000-8000-000000000001'))$q$,'Reassignment denied without finer flag');
SELECT work_reject($q$UPDATE colis SET envoi_id=NULL WHERE id='e4000000-0000-4000-8000-000000000001'$q$,'Direct reassign bypass also denied');
WITH changed AS(UPDATE envois SET notes='forbidden' WHERE id='e5000000-0000-4000-8000-000000000001' RETURNING id) SELECT work_assert((SELECT count(*)=0 FROM changed),'Removed edit permission prevents envoi update');
SELECT work_reject($q$INSERT INTO envois(destination_code,date_depart) VALUES('974',current_date+9)$q$,'Missing creation permission enforced');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
SELECT work_reject($q$SELECT assign_colis_departure('e4000000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-000000000003',(SELECT updated_at FROM colis WHERE id='e4000000-0000-4000-8000-000000000002'))$q$,'Past departure assignment rejected');
SELECT work_reject($q$SELECT assign_colis_departure('e4000000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-000000000004',(SELECT updated_at FROM colis WHERE id='e4000000-0000-4000-8000-000000000002'))$q$,'Wrong destination assignment rejected');
SELECT work_reject($q$UPDATE envois SET statut='parti' WHERE id='e5000000-0000-4000-8000-000000000001'$q$,'Direct departure status bypass rejected');
SELECT work_reject($q$SELECT confirm_departure('e5000000-0000-4000-8000-000000000001',jsonb_build_array(jsonb_build_object('id','e4000000-0000-4000-8000-000000000001','updated_at',(SELECT updated_at FROM colis WHERE id='e4000000-0000-4000-8000-000000000001'),'outgoing_parcel_count',1)),(SELECT updated_at FROM envois WHERE id='e5000000-0000-4000-8000-000000000001'))$q$,'Unpaid dossier cannot ship');
RESET ROLE;
-- Historical paid dossier fixture has one already-measured physical outgoing package.
INSERT INTO colis(id,client_id,statut,feu_vert,envoi_id,fin_l,fin_w,fin_h,fin_p,outgoing_parcel_count,devis_total,devis_snapshot,paiement_montant,paiement_date) VALUES
 ('e4000000-0000-4000-8000-000000000005','e3000000-0000-4000-8000-000000000001','paye','autorise','e5000000-0000-4000-8000-000000000001',20,20,20,2,1,20,'{"destination":{"code":"974"}}',20,now());
INSERT INTO colis(id,client_id,statut,envoi_id) VALUES('e4000000-0000-4000-8000-000000000006','e3000000-0000-4000-8000-000000000001','annule','e5000000-0000-4000-8000-000000000001');
UPDATE clients SET cp='97100' WHERE id='e3000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
SELECT work_reject($q$SELECT confirm_departure('e5000000-0000-4000-8000-000000000001',jsonb_build_array(jsonb_build_object('id','e4000000-0000-4000-8000-000000000005','updated_at',(SELECT updated_at FROM colis WHERE id='e4000000-0000-4000-8000-000000000005'),'outgoing_parcel_count',1)),(SELECT updated_at FROM envois WHERE id='e5000000-0000-4000-8000-000000000001'))$q$,'Unloaded dossiers require explicit deferral reason');
SELECT work_assert((confirm_departure('e5000000-0000-4000-8000-000000000001',jsonb_build_array(jsonb_build_object('id','e4000000-0000-4000-8000-000000000005','updated_at',(SELECT updated_at FROM colis WHERE id='e4000000-0000-4000-8000-000000000005'),'outgoing_parcel_count',1)),(SELECT updated_at FROM envois WHERE id='e5000000-0000-4000-8000-000000000001'),'Préparation non terminée')).statut='parti','Atomic departure confirms paid dossier and explicit deferral');
SELECT work_assert((SELECT statut='expedie' AND date_expedition IS NOT NULL FROM colis WHERE id='e4000000-0000-4000-8000-000000000005'),'Loaded dossier receives shipping status and date');
SELECT work_assert((SELECT envoi_id IS NULL AND statut='autorise' FROM colis WHERE id='e4000000-0000-4000-8000-000000000001'),'Deferred dossier keeps preparation state and clears old departure');
SELECT work_assert(jsonb_array_length(get_departure_manifest('e5000000-0000-4000-8000-000000000001')->'items')=1,'Manifest includes only loaded dossiers');
SELECT work_assert(jsonb_array_length(get_departure_manifest('e5000000-0000-4000-8000-000000000001')->'deferred')=1,'Manifest retains explicit deferred list');
SELECT work_assert(jsonb_array_length(get_departure_manifest('e5000000-0000-4000-8000-000000000001')->'excluded')=1,'Cancelled historical dossier is excluded instead of falsely deferred');
SELECT work_assert((SELECT envoi_id='e5000000-0000-4000-8000-000000000001' FROM colis WHERE id='e4000000-0000-4000-8000-000000000006'),'Cancelled historical association is preserved');
SELECT work_assert(get_departure_manifest('e5000000-0000-4000-8000-000000000001')#>>'{envoi,destination_code}'='974','Paid destination snapshot survives later client postcode change');
SELECT work_assert((get_departure_manifest('e5000000-0000-4000-8000-000000000001')#>>'{items,0,legacy_measurements_confirmed}')::boolean,'Legacy one-package confirmation is explicit in frozen manifest');

SELECT work_reject($q$UPDATE envois SET statut='planifie' WHERE id='e5000000-0000-4000-8000-000000000001'$q$,'Confirmed departure cannot move backward');
UPDATE colis SET archive=true WHERE id='e4000000-0000-4000-8000-000000000005';
SELECT work_assert(jsonb_array_length(get_departure_manifest('e5000000-0000-4000-8000-000000000001')->'items')=1,'Archiving dossier does not alter historical manifest');
SELECT work_assert((SELECT nb_colis=1 AND poids_total=2 FROM envois WHERE id='e5000000-0000-4000-8000-000000000001'),'Confirmed dossier count and physical weight remain frozen after archive');
UPDATE colis SET statut='transit' WHERE id='e4000000-0000-4000-8000-000000000005';
UPDATE colis SET statut='arrive' WHERE id='e4000000-0000-4000-8000-000000000005';
UPDATE colis SET statut='livraison' WHERE id='e4000000-0000-4000-8000-000000000005';
UPDATE colis SET statut='livre' WHERE id='e4000000-0000-4000-8000-000000000005';
SELECT work_assert((SELECT date_livraison IS NOT NULL AND date_expedition IS NOT NULL FROM colis WHERE id='e4000000-0000-4000-8000-000000000005'),'Delivery captures business date without erasing shipping date');
RESET ROLE;
-- Telegram correlation follows explicit reply across closed and active dossiers.
INSERT INTO messages(colis_id,type,texte,telegram_msg_id) VALUES('e4000000-0000-4000-8000-000000000003','staff','Ancien dossier livré','9001');
SELECT work_assert(resolve_telegram_message_colis('e3000000-0000-4000-8000-000000000001','9001',NULL)->>'id'='e4000000-0000-4000-8000-000000000003','Reply points to delivered dossier despite active dossier');
SELECT work_assert(resolve_telegram_message_colis('e3000000-0000-4000-8000-000000000002','9001',NULL) IS NULL,'Reply cannot cross customer ownership');
SELECT work_assert(resolve_telegram_message_colis('e3000000-0000-4000-8000-000000000001','missing',NULL) IS NULL,'Unresolved explicit reply never falls back to unrelated active dossier');
SELECT work_assert(resolve_telegram_message_colis('e3000000-0000-4000-8000-000000000001','9001',(SELECT ref FROM colis WHERE id='e4000000-0000-4000-8000-000000000002')) IS NULL,'Contradictory explicit reference requires attribution');
INSERT INTO messages(id,colis_id,type,texte,attachment_path,attachment_name,attachment_type) VALUES
 ('e6000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000005','client','Pièce après paiement','e4000000-0000-4000-8000-000000000005/telegram_1.pdf','preuve.pdf','application/pdf'),
 ('e6000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000002','client','Facture à vérifier','e4000000-0000-4000-8000-000000000002/telegram_2.pdf','facture.pdf','application/pdf');
SELECT work_assert((SELECT conversation_statut='a_traiter' AND NOT archive AND paiement_date IS NOT NULL FROM colis WHERE id='e4000000-0000-4000-8000-000000000005'),'Paid attachment creates visible conversation without altering payment');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
SELECT work_reject($q$SELECT import_conversation_invoice('e6000000-0000-4000-8000-000000000001')$q$,'Paid conversation document cannot change paid invoice');
SELECT work_assert((import_conversation_invoice('e6000000-0000-4000-8000-000000000002')).valide=false,'Explicit document import creates pending invoice');
SELECT import_conversation_invoice('e6000000-0000-4000-8000-000000000002');
SELECT work_assert((SELECT count(*)=1 FROM factures WHERE colis_id='e4000000-0000-4000-8000-000000000002'),'Repeated import cannot duplicate invoice');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000005',true);
SELECT work_reject($q$SELECT get_departure_manifest('e5000000-0000-4000-8000-000000000001')$q$,'Client cannot read manifest of other clients');
SELECT work_assert(NOT has_function_privilege('authenticated','resolve_telegram_message_colis(uuid,text,text)','EXECUTE'),'Telegram routing helper restricted to webhook service');
RESET ROLE;
ROLLBACK;
