#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scripts="$root/../scripts/deployment"
container=${PINTA_CONSENT_FOLLOWUP_DB_CONTAINER:-pinta-consent-relance-followup-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-consent-relance-followup.XXXXXX")
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
value() { docker exec "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 -c "$1"; }
# Waits (up to $2 × 50 ms) until the query $1 returns $3.
until_value() { attempt=0; until [ "$(value "$1")" = "$3" ]; do attempt=$((attempt+1));if [ "$attempt" -ge "$2" ]; then cat "$logs"/*.log;exit 1;fi;sleep 0.05;done; }
# The production script only builds SQL here: no credential, no network, nothing runs at import.
release() { python3 -B -c "import sys;sys.path.insert(0,sys.argv[1]);import consent_relance_followup20261007 as release;$1" "$scripts" "${2:-}"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi; done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 case "$migration_name" in 20261007000001_consent_relance_followup.sql)
  # Release rehearsal on this exact baseline: preflight hashes, rolled-back transaction, then the registering transaction.
  sql -c 'CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);'
  release 'print(release.PREFLIGHT_SQL)' | docker exec -i "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 > "$logs/preflight.json"
  release 'import json;problems=release.baseline_problems(json.load(open(sys.argv[2])));print("\n".join(problems));sys.exit(1 if problems else 0)' "$logs/preflight.json"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql())'; } | sql
  sql -c "DO \$\$ BEGIN IF to_regprocedure('public._consent_followup_until(colis)') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname LIKE 'z_sync_consent%')
   OR to_regclass('public.notification_outbox_message_id') IS NOT NULL OR position('Mesurer puis' IN pg_get_functiondef('public._reception_work_hint(colis)'::regprocedure))>0 THEN RAISE EXCEPTION 'Rehearsal rollback failed'; END IF;
   RAISE NOTICE 'PASS: preflight accepts the reviewed baseline; the rehearsal keeps business data and rolls back'; END \$\$;"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql(True))'; } | sql
  sql -c "DO \$\$ BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261007000001' AND name='consent_relance_followup') OR to_regprocedure('public._consent_followup_until(colis)') IS NULL
   OR to_regclass('public.notification_outbox_message_id') IS NULL THEN RAISE EXCEPTION 'Release transaction not applied'; END IF; RAISE NOTICE 'PASS: the registering release transaction applies the migration'; END \$\$;"
  { printf 'BEGIN;\n'; release 'print(release.POST_CHECKS_SQL)'; printf 'ROLLBACK;\n'; } | sql
  # Applied, the preflight refuses a second run and the verify checks see the release objects.
  release 'print(release.PREFLIGHT_SQL)' | docker exec -i "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 > "$logs/after.json"
  release 'import json;current=json.load(open(sys.argv[2]));problems=release.baseline_problems(current);triggers={item["name"]:item["definition"] for item in current["triggers"] if item["name"] in release.TRIGGERS};sys.exit(0 if any("already registered" in p for p in problems) and triggers==release.TRIGGERS and sorted(item.split(" ",1)[0] for item in current["existing_new_objects"])==sorted(["function"]*len(release.NEW_FUNCTIONS)+["trigger"]*len(release.TRIGGERS)+["index"]*len(release.NEW_INDEXES)) and all("index "+name in current["existing_new_objects"] for name in release.NEW_INDEXES) else 1)' "$logs/after.json"
  continue
 ;; esac
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1; done
sql < "$root/tests/consent-relance-followup.sql"
sql < "$root/tests/departure-any-step.sql"
sql < "$root/tests/staff-work-actions.sql"
sql < "$root/tests/task-corrections.sql"
sql < "$root/tests/regressions.sql"

# ── Two real sessions (1): a relance is queued while the delivery failure of the earlier request is recorded. ──
# The failure never waits for the dossier the relance holds (its trigger skips a dossier held by a command); the
# relance's own synchronisation decides: the latest message is the relance, still to deliver, and the follow-up holds.
sql <<'SQL'
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('cf900000-0000-4000-8000-000000000001','crf-race@example.test','{"nom":"Direction course"}');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES('cf910000-0000-4000-8000-000000000001','cf900000-0000-4000-8000-000000000001','Direction course','crf-race@example.test','directeur',false);
INSERT INTO clients(id,nom,cp,email,telegram_chat_id) VALUES('cf920000-0000-4000-8000-000000000001','Client course','97400','crf-race-client@example.test','9101');
INSERT INTO envois(id,destination_code,date_depart,statut,loading_closes_at) VALUES('cf940000-0000-4000-8000-000000000001','974',(now() AT TIME ZONE 'Europe/Paris')::date+5,'pret',now()+interval '36 hours');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,nb_colis,dim_l,dim_w,dim_h,poids) VALUES('cf930000-0000-4000-8000-000000000001','cf920000-0000-4000-8000-000000000001','CRF-RACE','attente_feu_vert','en_attente','cf940000-0000-4000-8000-000000000001',1,40,30,20,5);
INSERT INTO messages(id,colis_id,type,auteur_nom,texte,statut,canal,template,created_at) VALUES('cf950000-0000-4000-8000-000000000001','cf930000-0000-4000-8000-000000000001','staff','Équipe','Bonjour, pouvons-nous préparer vos cartons ?','envoi','telegram','demande_feu_vert',now()-interval '2 hours');
INSERT INTO notification_outbox(message_id,client_id,colis_id,canal,status,idempotency_key) VALUES('cf950000-0000-4000-8000-000000000001','cf920000-0000-4000-8000-000000000001','cf930000-0000-4000-8000-000000000001','telegram','sending','crf-race-request');
SQL
relance() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/relance.log" 2>&1 <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','cf900000-0000-4000-8000-000000000001',true);
SELECT queue_message('cf930000-0000-4000-8000-000000000001','Bonjour, votre accord est toujours attendu.','relance_feu_vert','crf-race-relance',NULL,'telegram');
SELECT pg_sleep(3);
COMMIT;
SQL
}
failure() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/failure.log" 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
UPDATE notification_outbox SET status='failed',last_error='Telegram n’a pas confirmé la livraison du message' WHERE idempotency_key='crf-race-request';
COMMIT;
SQL
}
relance & first=$!
# The relance holds the dossier and its task rows (its triggers synced them) until it commits.
until_value "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(3)%' AND state='active'" 100 1
failure & second=$!
set +e
wait "$second"; second_result=$?
# Recorded while the relance still holds the dossier: the failure did not wait for it.
held=$(value "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(3)%' AND state='active'")
wait "$first"; first_result=$?
set -e
if [ "$first_result,$second_result,$held" != '0,0,1' ]; then cat "$logs"/*.log; exit 1; fi
sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='cf930000-0000-4000-8000-000000000001' AND kind='reception' AND state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL AND due_at=(SELECT loading_closes_at FROM envois WHERE id='cf940000-0000-4000-8000-000000000001'))
  OR (SELECT status FROM notification_outbox WHERE idempotency_key='crf-race-request')<>'failed' OR (SELECT status FROM notification_outbox WHERE idempotency_key='crf-race-relance')<>'pending' THEN
  RAISE EXCEPTION 'The concurrent failure and relance lost the follow-up of the latest message';
 END IF;
 RAISE NOTICE 'PASS: a relance and the failure of the earlier request recorded concurrently: the failure never waits for the dossier, both commit, the relance still to deliver holds';
END $$;
SQL

# ── Two real sessions (2): the send-telegram retry of a failed request while a command holds the dossier and changes
# its cartons (cancel_previous_consent_requests cancels the request's outbox row). With the dossier locked by the
# delivery trigger this order deadlocked (40P01); the retry now skips the held dossier: both commit, no deadlock. ──
sql <<'SQL'
INSERT INTO clients(id,nom,cp,email,telegram_chat_id) VALUES('cf920000-0000-4000-8000-000000000002','Client retry','97400','crf-retry@example.test','9102');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,nb_colis,dim_l,dim_w,dim_h,poids) VALUES('cf930000-0000-4000-8000-000000000002','cf920000-0000-4000-8000-000000000002','CRF-RETRY','attente_feu_vert','en_attente','cf940000-0000-4000-8000-000000000001',1,40,30,20,5);
INSERT INTO messages(id,colis_id,type,auteur_nom,texte,statut,canal,template,created_at) VALUES('cf950000-0000-4000-8000-000000000002','cf930000-0000-4000-8000-000000000002','staff','Équipe','Bonjour, pouvons-nous préparer vos cartons ?','echec','telegram','demande_feu_vert',now()-interval '1 hour');
INSERT INTO notification_outbox(message_id,client_id,colis_id,canal,status,idempotency_key) VALUES('cf950000-0000-4000-8000-000000000002','cf920000-0000-4000-8000-000000000002','cf930000-0000-4000-8000-000000000002','telegram','failed','crf-retry-request');
SQL
cartons() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/cartons.log" 2>&1 <<'SQL'
BEGIN;
SELECT 1 FROM colis WHERE id='cf930000-0000-4000-8000-000000000002' FOR UPDATE;
SELECT pg_sleep(3.1);
UPDATE colis SET nb_colis=nb_colis+1 WHERE id='cf930000-0000-4000-8000-000000000002';
COMMIT;
SQL
}
retry() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/retry.log" 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
UPDATE notification_outbox SET status='pending',available_at=now(),last_error=NULL WHERE idempotency_key='crf-retry-request' AND status='failed';
SELECT pg_sleep(5.1);
COMMIT;
SQL
}
cartons & first=$!
until_value "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(3.1)%' AND state='active'" 100 1
retry & second=$!
# The retry's update returns while the dossier is still held (it sleeps holding its outbox row) …
until_value "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(5.1)%' AND state='active'" 100 1
held=$(value "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(3.1)%' AND state='active'")
# … then the carton change waits for that row: the order that used to close the cycle.
until_value "SELECT count(*) FROM pg_locks WHERE NOT granted AND locktype='transactionid'" 140 1
set +e
wait "$first"; first_result=$?
wait "$second"; second_result=$?
set -e
if [ "$first_result,$second_result,$held" != '0,0,1' ] || grep -q 'deadlock' "$logs/cartons.log" "$logs/retry.log"; then cat "$logs"/*.log; exit 1; fi
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT (status,last_error) IS DISTINCT FROM ('cancelled','Une nouvelle demande d’accord remplace cette version') FROM notification_outbox WHERE idempotency_key='crf-retry-request')
  OR NOT EXISTS(SELECT 1 FROM staff_work_actions w JOIN colis c ON c.id=w.colis_id WHERE w.colis_id='cf930000-0000-4000-8000-000000000002' AND w.kind='reception' AND w.state='ready'
   AND w.action_hint IS NOT DISTINCT FROM _reception_work_hint(c) AND w.action_hint='Relancer le client avant la clôture du départ') THEN
  RAISE EXCEPTION 'The retry and the carton change did not both apply';
 END IF;
 RAISE NOTICE 'PASS: a retry of a failed request and a carton change of its dossier: no deadlock, both commit, the old request is cancelled and the relance is due';
END $$;
SQL

# ── Two real sessions (3): the relances-auto stale-send sweep (one multi-row UPDATE) while a command holds dossier X
# and a work-list refresh holds the tasks of dossier Y, then touches X's outbox row the sweep holds. The sweep skips
# X, its re-sync of Y is the deadlock victim and is only reported: the sweep commits as a whole, the other session
# too, and the next refresh brings both relances back. ──
sql <<'SQL'
INSERT INTO clients(id,nom,cp,email,telegram_chat_id) VALUES('cf920000-0000-4000-8000-000000000003','Client sweep','97400','crf-sweep@example.test','9103');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,nb_colis,dim_l,dim_w,dim_h,poids) VALUES
 ('cf930000-0000-4000-8000-000000000031','cf920000-0000-4000-8000-000000000003','CRF-SWEEP-X','attente_feu_vert','en_attente','cf940000-0000-4000-8000-000000000001',1,40,30,20,5),
 ('cf930000-0000-4000-8000-000000000032','cf920000-0000-4000-8000-000000000003','CRF-SWEEP-Y','attente_feu_vert','en_attente','cf940000-0000-4000-8000-000000000001',1,40,30,20,5);
INSERT INTO messages(id,colis_id,type,auteur_nom,texte,statut,canal,template,created_at) VALUES
 ('cf950000-0000-4000-8000-000000000031','cf930000-0000-4000-8000-000000000031','staff','Équipe','Bonjour, pouvons-nous préparer vos cartons ?','envoi','telegram','demande_feu_vert',now()-interval '20 minutes'),
 ('cf950000-0000-4000-8000-000000000032','cf930000-0000-4000-8000-000000000032','staff','Équipe','Bonjour, pouvons-nous préparer vos cartons ?','envoi','telegram','demande_feu_vert',now()-interval '20 minutes');
INSERT INTO notification_outbox(message_id,client_id,colis_id,canal,status,locked_at,idempotency_key) VALUES
 ('cf950000-0000-4000-8000-000000000031','cf920000-0000-4000-8000-000000000003','cf930000-0000-4000-8000-000000000031','telegram','sending',now()-interval '10 minutes','crf-sweep-x'),
 ('cf950000-0000-4000-8000-000000000032','cf920000-0000-4000-8000-000000000003','cf930000-0000-4000-8000-000000000032','telegram','sending',now()-interval '10 minutes','crf-sweep-y');
DO $$ BEGIN
 IF (SELECT count(*) FROM staff_work_actions WHERE colis_id IN ('cf930000-0000-4000-8000-000000000031','cf930000-0000-4000-8000-000000000032') AND kind='reception' AND state='waiting' AND action_hint IS NULL)<>2 THEN
  RAISE EXCEPTION 'The deliveries in progress should hold both relances'; END IF;
END $$;
SQL
holder() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/holder.log" 2>&1 <<'SQL'
BEGIN;
SET LOCAL deadlock_timeout='10s';
SELECT 1 FROM colis WHERE id='cf930000-0000-4000-8000-000000000031' FOR UPDATE;
SELECT 1 FROM staff_work_actions WHERE colis_id='cf930000-0000-4000-8000-000000000032' FOR UPDATE;
DO $$ BEGIN FOR i IN 1..400 LOOP EXIT WHEN EXISTS(SELECT 1 FROM pg_locks WHERE NOT granted AND locktype='transactionid'); PERFORM pg_sleep(0.025); END LOOP; END $$;
UPDATE notification_outbox SET last_error='Vérifié par l’équipe' WHERE idempotency_key='crf-sweep-x';
COMMIT;
SQL
}
sweep() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/sweep.log" 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
UPDATE notification_outbox SET status='failed',last_error='Envoi interrompu : vérifier Telegram avant de renvoyer' WHERE status='sending' AND locked_at<now()-interval '5 minutes';
COMMIT;
SQL
}
holder & first=$!
until_value "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'DO \$\$ BEGIN FOR i IN 1..400%' AND state='active'" 100 1
sweep & second=$!
set +e
wait "$second"; second_result=$?
wait "$first"; first_result=$?
set -e
if [ "$first_result,$second_result" != '0,0' ] || ! grep -q '(40P01)' "$logs/sweep.log"; then cat "$logs"/*.log; exit 1; fi
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM notification_outbox WHERE idempotency_key IN ('crf-sweep-x','crf-sweep-y') AND status='failed')<>2
  OR (SELECT count(*) FROM staff_work_actions WHERE colis_id IN ('cf930000-0000-4000-8000-000000000031','cf930000-0000-4000-8000-000000000032') AND kind='reception' AND state='waiting' AND action_hint IS NULL)<>2 THEN
  RAISE EXCEPTION 'The sweep did not record both failures, or a skipped re-sync ran anyway';
 END IF;
 RAISE NOTICE 'PASS: the stale-send sweep commits as a whole: a held dossier is skipped, a deadlock of one re-sync is only reported';
END $$;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','cf900000-0000-4000-8000-000000000001',true);
SELECT refresh_staff_work_actions();
COMMIT;
DO $$ BEGIN
 IF (SELECT count(*) FROM staff_work_actions WHERE colis_id IN ('cf930000-0000-4000-8000-000000000031','cf930000-0000-4000-8000-000000000032') AND kind='reception' AND state='ready'
   AND action_hint='Relancer le client avant la clôture du départ')<>2 THEN
  RAISE EXCEPTION 'The refresh did not bring both relances back';
 END IF;
 RAISE NOTICE 'PASS: the next refresh brings back the relances whose re-sync was skipped';
END $$;
SQL

# ── The preflight's inlined reports agree with the release functions on committed dossiers of every state. ──
sql <<'SQL'
INSERT INTO clients(id,nom,cp,email,telegram_chat_id) VALUES('cf920000-0000-4000-8000-000000000004','Client rapports','97400','crf-reports@example.test','9104');
INSERT INTO envois(id,destination_code,date_depart,statut,loading_closes_at) VALUES
 ('cf940000-0000-4000-8000-000000000041','974',(now() AT TIME ZONE 'Europe/Paris')::date+20,'planifie',now()-interval '1 hour'),
 ('cf940000-0000-4000-8000-000000000042','974',(now() AT TIME ZONE 'Europe/Paris')::date+21,'planifie',now()+interval '30 hours'),
 ('cf940000-0000-4000-8000-000000000043','974',(now() AT TIME ZONE 'Europe/Paris')::date+8,'pret',now()+interval '30 hours');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,depart_souhaite,nb_colis,dim_l,dim_w,dim_h,poids)
 SELECT ('cf930000-0000-4000-8000-0000000000'||n)::uuid,'cf920000-0000-4000-8000-000000000004','CRF-P'||n,s::statut_colis,CASE WHEN s='attente_feu_vert' THEN 'en_attente'::statut_feu_vert END,e::uuid,d,1,40,30,20,5
 FROM (VALUES (41,'attente_feu_vert','cf940000-0000-4000-8000-000000000001',NULL::date),(42,'attente_feu_vert','cf940000-0000-4000-8000-000000000001',NULL),
  (43,'attente_feu_vert','cf940000-0000-4000-8000-000000000001',NULL),(44,'attente_feu_vert','cf940000-0000-4000-8000-000000000001',NULL),
  (45,'attente_feu_vert','cf940000-0000-4000-8000-000000000001',NULL),(46,'attente_feu_vert','cf940000-0000-4000-8000-000000000001',NULL),
  (47,'mesure',NULL,(now() AT TIME ZONE 'Europe/Paris')::date+20),(48,'mesure',NULL,(now() AT TIME ZONE 'Europe/Paris')::date+21),
  (49,'mesure','cf940000-0000-4000-8000-000000000043',NULL)) v(n,s,e,d);
INSERT INTO messages(id,colis_id,type,auteur_nom,texte,statut,canal,template,created_at)
 SELECT ('cf950000-0000-4000-8000-0000000000'||n)::uuid,('cf930000-0000-4000-8000-0000000000'||n)::uuid,'staff','Équipe','Bonjour','envoi',canal,template,now()-age::interval
 FROM (VALUES (41,'telegram','demande_feu_vert','30 hours'),(42,'telegram','relance_feu_vert','23 hours'),(43,'email','relance_feu_vert','2 hours'),
  (44,'telegram','demande_feu_vert','30 hours'),(45,'telegram','demande_feu_vert','3 hours'),(46,'telegram','demande_feu_vert','30 hours')) v(n,canal,template,age);
INSERT INTO notification_outbox(message_id,client_id,colis_id,canal,status,sent_at,available_at,idempotency_key)
 SELECT ('cf950000-0000-4000-8000-0000000000'||n)::uuid,'cf920000-0000-4000-8000-000000000004',('cf930000-0000-4000-8000-0000000000'||n)::uuid,canal,status,sent_at,available_at,'crf-report-'||n
 FROM (VALUES (41,'telegram','sent',now()-interval '2 hours',now()),(42,'telegram','pending',NULL,now()+interval '90 minutes'),(43,'email','manual',NULL,now()),
  (44,'telegram','sent',now()-interval '30 hours',now()),(45,'telegram','failed',NULL,now()),(46,'telegram','sent',now()-interval '30 hours',now())) v(n,canal,status,sent_at,available_at);
-- P46: a client message with a consent template after the request delivered 30 hours ago.
INSERT INTO messages(colis_id,type,auteur_nom,texte,template) VALUES('cf930000-0000-4000-8000-000000000046','client','Client','ok','relance_feu_vert');
SELECT set_config('expedile.confirm_departure','allowed',true);
UPDATE envois SET statut='archive' WHERE id='cf940000-0000-4000-8000-000000000043';
SQL
release 'print(release.PREFLIGHT_SQL)' | docker exec -i "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 > "$logs/reports.json"
value "SELECT json_build_object(
 'followed',(SELECT coalesce(json_agg(c.ref ORDER BY c.ref),'[]') FROM colis c WHERE NOT c.archive AND c.statut='attente_feu_vert' AND c.attente_client_date IS NULL AND _consent_followup_until(c) IS NOT NULL),
 'held',(SELECT coalesce(json_agg(c.ref ORDER BY c.ref),'[]') FROM colis c WHERE NOT c.archive AND c.statut='attente_feu_vert' AND c.attente_client_date IS NULL AND _consent_followup_until(c)='infinity'),
 'closed_wishes',(SELECT coalesce(json_agg(c.ref ORDER BY c.ref),'[]') FROM colis c WHERE NOT c.archive AND c.statut IN ('receptionne','mesure','attente_feu_vert') AND c.envoi_id IS NULL AND c.depart_souhaite IS NOT NULL AND _colis_departure_closing(c) IS NULL),
 'closed_assigned',(SELECT coalesce(json_agg(c.ref ORDER BY c.ref),'[]') FROM colis c WHERE NOT c.archive AND c.statut IN ('receptionne','mesure','attente_feu_vert') AND c.envoi_id IS NOT NULL AND _colis_departure_closing(c) IS NULL),
 'client_templates',(SELECT count(*) FROM messages WHERE type<>'staff' AND template IN ('demande_feu_vert','relance_feu_vert')))" > "$logs/functions.json"
release 'import json
reports=json.load(open(sys.argv[2]))["reports"];functions=json.load(open(sys.argv[2].replace("reports.json","functions.json")))
got={"followed":sorted(item["ref"] for item in reports["followed_up_consents"]),"held":sorted(reports["held_until_delivery"]),
 "closed_wishes":sorted(item["ref"] for item in reports["wish_days_with_closed_departure"]),"closed_assigned":sorted(item["ref"] for item in reports["closed_assigned_departures"]),
 "client_templates":reports["client_consent_messages_ignored"]}
expected={key:(sorted(value) if isinstance(value,list) else value) for key,value in functions.items()}
print(json.dumps(got,ensure_ascii=False))
sys.exit(0 if got==expected and {"CRF-P41","CRF-P42","CRF-P43"}<=set(got["followed"]) and not {"CRF-P44","CRF-P45","CRF-P46"}&set(got["followed"]) and "CRF-P42" in got["held"]
 and "CRF-P47" in got["closed_wishes"] and "CRF-P48" not in got["closed_wishes"] and "CRF-P49" in got["closed_assigned"] and got["client_templates"]>=1 else 1)' "$logs/reports.json"
sql -c "DO \$\$ BEGIN RAISE NOTICE 'PASS: the preflight reports inline the release rules (follow-up, delivery hold, closed desired days and departures, client templates)'; END \$\$;"
