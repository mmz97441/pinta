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
   OR position('Mesurer puis' IN pg_get_functiondef('public._reception_work_hint(colis)'::regprocedure))>0 THEN RAISE EXCEPTION 'Rehearsal rollback failed'; END IF;
   RAISE NOTICE 'PASS: preflight accepts the reviewed baseline; the rehearsal keeps business data and rolls back'; END \$\$;"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql(True))'; } | sql
  sql -c "DO \$\$ BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261007000001' AND name='consent_relance_followup') OR to_regprocedure('public._consent_followup_until(colis)') IS NULL THEN RAISE EXCEPTION 'Release transaction not applied'; END IF; RAISE NOTICE 'PASS: the registering release transaction applies the migration'; END \$\$;"
  { printf 'BEGIN;\n'; release 'print(release.POST_CHECKS_SQL)'; printf 'ROLLBACK;\n'; } | sql
  # Applied, the preflight refuses a second run and the verify checks see the release objects.
  release 'print(release.PREFLIGHT_SQL)' | docker exec -i "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 > "$logs/after.json"
  release 'import json;current=json.load(open(sys.argv[2]));problems=release.baseline_problems(current);triggers={item["name"]:item["definition"] for item in current["triggers"] if item["name"] in release.TRIGGERS};sys.exit(0 if any("already registered" in p for p in problems) and triggers==release.TRIGGERS and len(current["existing_new_objects"])==5 else 1)' "$logs/after.json"
  continue
 ;; esac
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1; done
sql < "$root/tests/consent-relance-followup.sql"
sql < "$root/tests/departure-any-step.sql"
sql < "$root/tests/staff-work-actions.sql"
sql < "$root/tests/task-corrections.sql"
sql < "$root/tests/regressions.sql"
# Two real sessions: a relance is queued while the delivery failure of the earlier request is recorded. The failure
# waits for the dossier (one lock order: dossier, then tasks), then reads the committed relance: the latest message
# decides and the relance is followed up, never overwritten by a synchronisation computed before it.
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
# The relance holds the dossier and its task rows (its trigger synced them) until it commits.
attempt=0
until [ "$(value "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(3)%' AND state='active'")" = '1' ]; do attempt=$((attempt+1));if [ "$attempt" -ge 100 ]; then cat "$logs"/*.log;exit 1;fi;sleep 0.05;done
failure & second=$!
attempt=0
until [ "$(value "SELECT count(*) FROM pg_locks WHERE NOT granted AND locktype='transactionid'")" = '1' ]; do attempt=$((attempt+1));if [ "$attempt" -ge 60 ]; then cat "$logs"/*.log;exit 1;fi;sleep 0.05;done
set +e
wait "$first"; first_result=$?
wait "$second"; second_result=$?
set -e
if [ "$first_result,$second_result" != '0,0' ]; then cat "$logs"/*.log; exit 1; fi
sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='cf930000-0000-4000-8000-000000000001' AND kind='reception' AND state='waiting' AND blocked_reason='Accord client attendu' AND action_hint IS NULL)
  OR (SELECT status FROM notification_outbox WHERE idempotency_key='crf-race-request')<>'failed' OR (SELECT status FROM notification_outbox WHERE idempotency_key='crf-race-relance')<>'pending' THEN
  RAISE EXCEPTION 'The concurrent failure and relance lost the follow-up of the latest message';
 END IF;
 RAISE NOTICE 'PASS: a relance and the failure of the earlier request recorded concurrently: both commit, the relance is followed up';
END $$;
SQL
