#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_TEAM_TASK_DB_CONTAINER:-pinta-team-task-start-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-team-task.XXXXXX")
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi; done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1; done
sql < "$root/tests/team-task-start.sql"
# Existing commands and handoffs remain backward compatible.
sql < "$root/tests/staff-work-actions.sql"
sql < "$root/tests/team-task-start-concurrency.sql"
take() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 > "$logs/$1.log" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','$2',true);
SELECT mutate_staff_work_action((SELECT id FROM staff_work_actions WHERE colis_id='ef400000-0000-4000-8000-000000000001' AND kind='preparation'),'take',1);
SELECT pg_sleep(0.5);
COMMIT;
SQL
}
take a ef100000-0000-4000-8000-000000000001 & pid_a=$!
take b ef100000-0000-4000-8000-000000000002 & pid_b=$!
set +e
wait "$pid_a"; result_a=$?
wait "$pid_b"; result_b=$?
set -e
if [ "$result_a,$result_b" != '0,3' ] && [ "$result_a,$result_b" != '3,0' ]; then cat "$logs/a.log" "$logs/b.log"; exit 1; fi
sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='ef400000-0000-4000-8000-000000000001' AND kind='preparation' AND version=2 AND state='in_progress' AND started_at IS NOT NULL AND assignee_id IN ('ef100000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000002')) THEN RAISE EXCEPTION 'Concurrent take must assign and start exactly once'; END IF;
 IF (SELECT count(*) FROM audit_actions WHERE colis_id='ef400000-0000-4000-8000-000000000001' AND action='work_action_take')<>1 THEN RAISE EXCEPTION 'Concurrent take created duplicate events'; END IF;
 RAISE NOTICE 'PASS: simultaneous take has exactly one assigned, started and audited winner';
END; $$;
SQL
# Hold a preparation row and the dossier row in one session. Independent invoice
# take must finish before these locks are released: taking never locks the dossier.
docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 > "$logs/held.log" 2>&1 <<'SQL' &
BEGIN;
SELECT id FROM colis WHERE id='ef400000-0000-4000-8000-000000000002' FOR NO KEY UPDATE;
SELECT id FROM staff_work_actions WHERE colis_id='ef400000-0000-4000-8000-000000000002' AND kind='preparation' FOR UPDATE;
SELECT pg_advisory_xact_lock(9212026);
SELECT pg_sleep(4);
COMMIT;
SQL
held_pid=$!
attempt=0
while [ "$(docker exec "$container" psql -Atq -U postgres -c "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=9212026 AND granted")" != '1' ]; do
 attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then cat "$logs/held.log"; exit 1; fi;sleep 0.1
done
sql <<'SQL'
BEGIN;
SET LOCAL lock_timeout='250ms';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000002',true);
SELECT mutate_staff_work_action(id,'take',version) FROM staff_work_actions WHERE colis_id='ef400000-0000-4000-8000-000000000002' AND kind='documents';
COMMIT;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='ef400000-0000-4000-8000-000000000002' AND kind='documents' AND state='in_progress') THEN RAISE EXCEPTION 'Independent invoice task must start while dossier and preparation are locked'; END IF;
 RAISE NOTICE 'PASS: taking independent invoice work never locks preparation or its dossier';
END; $$;
SQL
wait "$held_pid"
