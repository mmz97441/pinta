BEGIN;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE FUNCTION team_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label;END IF;RAISE NOTICE 'PASS: %',label;END; $$;
CREATE FUNCTION team_reject(command text,label text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE command;EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>expected THEN RAISE EXCEPTION 'FAIL wrong error % for %: %',SQLSTATE,label,SQLERRM;END IF;RAISE NOTICE 'PASS rejected: % (%)',label,SQLERRM;RETURN;END;RAISE EXCEPTION 'FAIL accepted: %',label;END; $$;
INSERT INTO auth.users(id,email) VALUES
 ('ee100000-0000-4000-8000-000000000001','team-director@example.test'),
 ('ee100000-0000-4000-8000-000000000002','team-alex@example.test'),
 ('ee100000-0000-4000-8000-000000000003','team-sam@example.test'),
 ('ee100000-0000-4000-8000-000000000004','team-client@example.test');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES
 ('ee200000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000001','Direction','team-director@example.test','directeur',false),
 ('ee200000-0000-4000-8000-000000000002','ee100000-0000-4000-8000-000000000002','Alex','team-alex@example.test','preparateur',false),
 ('ee200000-0000-4000-8000-000000000003','ee100000-0000-4000-8000-000000000003','Sam','team-sam@example.test','preparateur',false);
INSERT INTO staff_permissions(staff_id,perm_colis_preparer,perm_factures_valider,perm_colis_calculer_devis) VALUES
 ('ee200000-0000-4000-8000-000000000002',true,false,false),
 ('ee200000-0000-4000-8000-000000000003',true,true,false);
INSERT INTO clients(id,user_id,nom,cp,type) VALUES('ee300000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000004','Client équipe','97400','particulier');
INSERT INTO colis(id,client_id,statut,feu_vert,nb_colis,dims_par_colis) VALUES
 ('ee400000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000001','autorise','autorise',1,'[{"dimL":40,"dimW":30,"dimH":20,"poids":4}]'),
 ('ee400000-0000-4000-8000-000000000002','ee300000-0000-4000-8000-000000000001','attente_feu_vert','en_attente',1,'[{"dimL":30,"dimW":30,"dimH":20,"poids":3}]');
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES('ee500000-0000-4000-8000-000000000001','ee400000-0000-4000-8000-000000000001','À vérifier',20,'team-fixture.pdf',false);
SELECT set_config('test.team_preparation',(SELECT id::text FROM staff_work_actions WHERE colis_id='ee400000-0000-4000-8000-000000000001' AND kind='preparation'),true);
SELECT set_config('test.team_documents',(SELECT id::text FROM staff_work_actions WHERE colis_id='ee400000-0000-4000-8000-000000000001' AND kind='documents'),true);
SELECT set_config('test.team_quote',(SELECT id::text FROM staff_work_actions WHERE colis_id='ee400000-0000-4000-8000-000000000001' AND kind='quote'),true);
SELECT set_config('test.team_original',(SELECT to_jsonb(c)::text FROM colis c WHERE id='ee400000-0000-4000-8000-000000000001'),true);
SELECT set_config('test.team_invoice',(SELECT to_jsonb(f)::text FROM factures f WHERE id='ee500000-0000-4000-8000-000000000001'),true);
SELECT team_assert(NOT has_function_privilege('anon','mutate_staff_work_action(uuid,text,integer,jsonb)','EXECUTE'),'anonymous caller cannot take tasks');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000004',true);
SELECT team_reject($q$SELECT mutate_staff_work_action(current_setting('test.team_preparation')::uuid,'take',1)$q$,'client cannot take staff work','42501');
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
SELECT team_reject($q$SELECT mutate_staff_work_action(current_setting('test.team_documents')::uuid,'take',(SELECT version FROM staff_work_actions WHERE id=current_setting('test.team_documents')::uuid))$q$,'preparation-only permission cannot take invoices','42501');
SELECT team_reject($q$SELECT mutate_staff_work_action(current_setting('test.team_preparation')::uuid,'take',NULL)$q$,'taking requires the displayed version','40001');
SELECT team_assert((mutate_staff_work_action(current_setting('test.team_preparation')::uuid,'take',1)).state='in_progress','one command starts a free ready task');
SELECT team_assert((SELECT assignee_id=auth.uid() AND started_at IS NOT NULL AND version=2 FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid),'one command assigns actor and advances version exactly once');
SELECT team_assert((SELECT to_jsonb(c)=current_setting('test.team_original')::jsonb FROM colis c WHERE id='ee400000-0000-4000-8000-000000000001'),'taking preserves whole dossier including consent, reception, preparation, quote and referent');
SELECT team_assert((SELECT to_jsonb(f)=current_setting('test.team_invoice')::jsonb FROM factures f WHERE id='ee500000-0000-4000-8000-000000000001'),'taking preserves invoice content and verification');
SELECT team_assert((SELECT count(*)=1 FROM audit_actions WHERE colis_id='ee400000-0000-4000-8000-000000000001' AND action='work_action_take' AND detail::jsonb#>>'{before,state}'='ready' AND detail::jsonb#>>'{after,state}'='in_progress'),'taking records one complete audit event');
SELECT team_reject($q$SELECT mutate_staff_work_action(current_setting('test.team_preparation')::uuid,'take',1)$q$,'stale double click cannot execute twice','40001');
SELECT team_reject($q$SELECT mutate_staff_work_action(current_setting('test.team_preparation')::uuid,'take',2)$q$,'already started task is continued without another take','22023');
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000003',true);
SELECT team_reject($q$SELECT mutate_staff_work_action(current_setting('test.team_preparation')::uuid,'take',2)$q$,'another collaborator cannot steal with a fresh version','40001');
SELECT team_assert((mutate_staff_work_action(current_setting('test.team_documents')::uuid,'take',(SELECT version FROM staff_work_actions WHERE id=current_setting('test.team_documents')::uuid))).state='in_progress','second collaborator can independently start invoices on same dossier');
SELECT team_assert((SELECT count(*)=2 FROM staff_work_actions WHERE colis_id='ee400000-0000-4000-8000-000000000001' AND state='in_progress'),'independent preparation and document work run together');
SELECT team_assert((SELECT state='waiting' AND assignee_id IS NULL FROM staff_work_actions WHERE id=current_setting('test.team_quote')::uuid),'parallel work does not prematurely unblock the quote');
RESET ROLE;
SELECT team_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE colis_id::text LIKE 'ee400000%') AND NOT EXISTS(SELECT 1 FROM messages WHERE colis_id::text LIKE 'ee400000%') AND NOT EXISTS(SELECT 1 FROM notification_outbox WHERE colis_id::text LIKE 'ee400000%'),'taking parallel tasks queues no internal or external notification');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000001',true);
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'take',version) FROM staff_work_actions WHERE colis_id='ee400000-0000-4000-8000-000000000002' AND kind='reception'$q$,'even direction cannot start a customer wait','22023');
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'take',version) FROM staff_work_actions WHERE id=current_setting('test.team_quote')::uuid$q$,'missing preparation blocks quote take','22023');
SELECT mutate_staff_work_action(id,'claim',version) FROM staff_work_actions WHERE id=current_setting('test.team_quote')::uuid;
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
SELECT mutate_staff_work_action(id,'wait',version,'{"reason":"Vérifier une protection","review_at":"2099-01-01T00:00:00Z"}') FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid;
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'take',version) FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid$q$,'taking cannot erase a voluntary pause','22023');
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'start',version) FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid$q$,'legacy start cannot erase a voluntary pause','22023');
SELECT team_assert((SELECT state='waiting' AND waiting_reason='Vérifier une protection' AND review_at='2099-01-01T00:00:00Z' FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid),'failed starts preserve reason, review date and owner');
SELECT mutate_staff_work_action(id,'resume',version) FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid;
SELECT team_assert((mutate_staff_work_action(current_setting('test.team_preparation')::uuid,'take',(SELECT version FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid))).state='in_progress','ready work already assigned to oneself starts in one command');
-- A ready relay is accepted and started atomically; a waiting relay stays waiting.
RESET ROLE;
INSERT INTO colis(id,client_id,statut,feu_vert) VALUES('ee400000-0000-4000-8000-000000000003','ee300000-0000-4000-8000-000000000001','autorise','autorise');
SELECT set_config('test.team_relay',(SELECT id::text FROM staff_work_actions WHERE colis_id='ee400000-0000-4000-8000-000000000003' AND kind='preparation'),true);
SET LOCAL ROLE authenticated;
SELECT mutate_staff_work_action(id,'claim',version) FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid;
SELECT mutate_staff_work_action(id,'handoff',version,'{"staff_id":"ee100000-0000-4000-8000-000000000003","note":"Reprendre le contrôle du carton"}') FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid;
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000003',true);
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'accept',version,'{"start":"true"}') FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid$q$,'accept-and-start rejects malformed start flag','22023');
SELECT mutate_staff_work_action(id,'accept',version,'{"start":true}') FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid;
SELECT team_assert((SELECT state='in_progress' AND assignee_id=auth.uid() AND version=4 AND handoff_to IS NULL AND handoff_note='Reprendre le contrôle du carton' FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid),'accept-and-open assigns and starts ready work with one version change');
SELECT mutate_staff_work_action(id,'wait',version,'{"reason":"Protection attendue"}') FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid;
SELECT mutate_staff_work_action(id,'handoff',version,'{"staff_id":"ee100000-0000-4000-8000-000000000002","note":"Surveiller la réception de la protection"}') FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid;
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'accept',version,'{"start":true}') FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid$q$,'accept-and-start cannot bypass waiting','22023');
SELECT team_assert((SELECT assignee_id='ee100000-0000-4000-8000-000000000003' AND state='waiting' AND handoff_to=auth.uid() AND version=6 FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid),'failed accept-and-start leaves full handoff and owner intact');
SELECT mutate_staff_work_action(id,'accept',version) FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid;
SELECT team_assert((SELECT assignee_id=auth.uid() AND state='waiting' AND waiting_reason='Protection attendue' AND handoff_to IS NULL AND handoff_note='Surveiller la réception de la protection' FROM staff_work_actions WHERE id=current_setting('test.team_relay')::uuid),'accepting follow-up preserves wait and instruction');
-- The recipient sees the instruction after accepting, navigating, and refreshing.
SELECT mutate_staff_work_action(id,'handoff',version,'{"staff_id":"ee100000-0000-4000-8000-000000000003","note":"Carton fragile dans le casier A"}') FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid;
SELECT team_assert((SELECT assignee_id=auth.uid() FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid),'proposed handoff keeps the current owner');
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000003',true);
SELECT mutate_staff_work_action(id,'accept',version) FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid;
SELECT team_assert((SELECT assignee_id=auth.uid() AND handoff_to IS NULL AND handoff_note='Carton fragile dans le casier A' AND accepted_handoff_note=handoff_note FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid),'accepted instruction remains visible on the assigned task');
RESET ROLE;
SELECT sync_staff_work_actions('ee400000-0000-4000-8000-000000000001');
SELECT team_assert((SELECT handoff_note='Carton fragile dans le casier A' AND state='in_progress' FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid),'task reprojection preserves accepted instruction and current work');
SET LOCAL ROLE authenticated;
SELECT mutate_staff_work_action(id,'handoff',version,'{"staff_id":"ee100000-0000-4000-8000-000000000002","note":"Nouvelle proposition non acceptée"}') FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid;
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
SELECT mutate_staff_work_action(id,'reject',version) FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid;
SELECT team_assert((SELECT assignee_id='ee100000-0000-4000-8000-000000000003' AND handoff_to IS NULL AND handoff_note='Carton fragile dans le casier A' FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid),'refused later handoff restores prior accepted context without changing owner');
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000003',true);
SELECT save_preparation_measurements(id,'[{"dimL":20,"dimW":20,"dimH":20,"poids":2}]',updated_at,preparation_composition_version) FROM colis WHERE id='ee400000-0000-4000-8000-000000000001';
SELECT team_assert((SELECT state='done' AND handoff_note IS NULL AND accepted_handoff_note IS NULL AND assignee_id=auth.uid() FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid),'successful business save completes preparation and clears active instruction without forgetting actor');
SELECT team_assert((SELECT state='waiting' AND blocked_reason='Documents à valider' AND assignee_id='ee100000-0000-4000-8000-000000000001' FROM staff_work_actions WHERE id=current_setting('test.team_quote')::uuid),'quote now clearly waits for invoices and keeps assigned colleague');
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'take',version) FROM staff_work_actions WHERE id=current_setting('test.team_preparation')::uuid$q$,'completed business task cannot be reopened by take','22023');
RESET ROLE;
UPDATE factures SET valide=true WHERE id='ee500000-0000-4000-8000-000000000001';
SELECT team_assert((SELECT state='done' AND assignee_id='ee100000-0000-4000-8000-000000000003' FROM staff_work_actions WHERE id=current_setting('test.team_documents')::uuid),'invoice business completion keeps attribution history');
SELECT team_assert((SELECT state='ready' AND blocked_reason IS NULL AND assignee_id='ee100000-0000-4000-8000-000000000001' FROM staff_work_actions WHERE id=current_setting('test.team_quote')::uuid),'last prerequisite automatically exposes quote to its existing assignee');
SELECT team_assert((SELECT dims_par_colis=current_setting('test.team_original')::jsonb->'dims_par_colis' AND fin_p=2 AND devis_total IS NULL AND feu_vert='autorise' FROM colis WHERE id='ee400000-0000-4000-8000-000000000001'),'workflow preserves received measurements, separate optimized weight, consent and absent quote');
SELECT team_assert(NOT EXISTS(SELECT 1 FROM messages WHERE colis_id::text LIKE 'ee400000%') AND NOT EXISTS(SELECT 1 FROM notification_outbox WHERE colis_id::text LIKE 'ee400000%'),'taking, relaying and completing work queues no external message');
SELECT team_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE colis_id::text LIKE 'ee400000%' AND (type<>'work_action' OR user_id='ee100000-0000-4000-8000-000000000004')),'only targeted internal handoff notifications exist');

-- Availability is checked again on the server, including after a relay proposal.
RESET ROLE;
INSERT INTO colis(id,client_id,statut,feu_vert) VALUES('ee400000-0000-4000-8000-000000000004','ee300000-0000-4000-8000-000000000001','autorise','autorise');
SELECT set_config('test.team_available',(SELECT id::text FROM staff_work_actions WHERE colis_id='ee400000-0000-4000-8000-000000000004' AND kind='preparation'),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
SELECT save_staff_work_preferences('{"available":false}',NULL);
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'take',version) FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid$q$,'unavailable staff cannot take new work via direct RPC','22023');
SELECT save_staff_work_preferences('{"available":true,"absent_until":"2099-01-01T00:00:00Z"}',(SELECT version FROM staff_work_preferences WHERE staff_id=auth.uid()));
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'take',version) FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid$q$,'future absence also prevents new take','22023');
SELECT team_assert((SELECT version=1 AND assignee_id IS NULL AND state='ready' FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid),'unavailable attempts leave free work untouched');
SELECT save_staff_work_preferences('{"absent_until":"2000-01-01T00:00:00Z"}',(SELECT version FROM staff_work_preferences WHERE staff_id=auth.uid()));
SELECT mutate_staff_work_action(id,'take',version) FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid;
SELECT team_assert((SELECT version=2 AND assignee_id=auth.uid() AND state='in_progress' FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid),'expired absence permits taking new work');
SELECT mutate_staff_work_action(id,'wait',version,'{"reason":"Contrôle à reprendre"}') FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid;
SELECT save_staff_work_preferences('{"available":false}',(SELECT version FROM staff_work_preferences WHERE staff_id=auth.uid()));
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'resume',version,'{"start":"yes"}') FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid$q$,'resume-and-start requires a boolean start flag','22023');
SELECT mutate_staff_work_action(id,'resume',version,'{"start":true}') FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid;
SELECT team_assert((SELECT version=4 AND state='in_progress' AND assignee_id=auth.uid() AND waiting_reason IS NULL AND review_at IS NULL FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid),'owner can atomically lift manual wait and continue despite unavailable setting');
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'resume',version,'{"start":true}') FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid$q$,'already lifted wait cannot be resumed again','22023');
SELECT mutate_staff_work_action(id,'wait',version,'{"reason":"Nouvelle pause"}') FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid;
SELECT mutate_staff_work_action(id,'resume',version) FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid;
SELECT mutate_staff_work_action(id,'take',version) FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid;
SELECT team_assert((SELECT state='in_progress' AND assignee_id=auth.uid() FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid),'unavailable owner may also continue their own ready task');
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000003',true);
SELECT save_staff_work_preferences('{"available":false}',NULL);
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'handoff',version,'{"staff_id":"ee100000-0000-4000-8000-000000000003","note":"Reprendre le contrôle"}') FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid$q$,'relay rejects newly unavailable recipient','22023');
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000003',true);
SELECT save_staff_work_preferences('{"available":true,"absent_until":"2099-01-01T00:00:00Z"}',(SELECT version FROM staff_work_preferences WHERE staff_id=auth.uid()));
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'handoff',version,'{"staff_id":"ee100000-0000-4000-8000-000000000003","note":"Reprendre le contrôle"}') FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid$q$,'relay rejects recipient absent until a future date','22023');
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000003',true);
SELECT save_staff_work_preferences('{"absent_until":null}',(SELECT version FROM staff_work_preferences WHERE staff_id=auth.uid()));
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
SELECT mutate_staff_work_action(id,'handoff',version,'{"staff_id":"ee100000-0000-4000-8000-000000000003","note":"Reprendre le contrôle"}') FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid;
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000003',true);
SELECT save_staff_work_preferences('{"available":false}',(SELECT version FROM staff_work_preferences WHERE staff_id=auth.uid()));
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'accept',version,'{"start":true}') FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid$q$,'accept-and-start rechecks availability after the proposal','22023');
SELECT team_assert((SELECT assignee_id='ee100000-0000-4000-8000-000000000002' AND handoff_to=auth.uid() AND handoff_note='Reprendre le contrôle' FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid),'failed acceptance preserves original owner and relay instruction');
SELECT save_staff_work_preferences('{"available":true}',(SELECT version FROM staff_work_preferences WHERE staff_id=auth.uid()));
SELECT mutate_staff_work_action(id,'accept',version,'{"start":true}') FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid;
SELECT team_assert((SELECT assignee_id=auth.uid() AND state='in_progress' AND handoff_to IS NULL FROM staff_work_actions WHERE id=current_setting('test.team_available')::uuid),'becoming available permits atomic relay acceptance');
SELECT set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000001',true);
SELECT mutate_staff_work_action(id,'claim',version) FROM staff_work_actions WHERE colis_id='ee400000-0000-4000-8000-000000000002' AND kind='reception';
SELECT team_reject($q$SELECT mutate_staff_work_action(id,'resume',version,'{"start":true}') FROM staff_work_actions WHERE colis_id='ee400000-0000-4000-8000-000000000002' AND kind='reception'$q$,'resume-and-start cannot bypass customer agreement','22023');
RESET ROLE;
ROLLBACK;
