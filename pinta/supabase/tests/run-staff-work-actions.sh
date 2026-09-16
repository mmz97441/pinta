#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_STAFF_WORK_DB_CONTAINER:-pinta-staff-work-db}
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do
 attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1
done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do
 case ${migration##*/} in 202609*) ;; *) sql -1 < "$migration";; esac
done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/202609*.sql; do
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1
done
sql < "$root/tests/staff-work-actions.sql"
# Two real PostgreSQL sessions race for the same version; exactly one may win.
sql < "$root/tests/staff-work-concurrency.sql"
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-work-race.XXXXXX")
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
claim() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 > "$logs/$1.log" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','$2',true);
SELECT mutate_staff_work_action((SELECT id FROM staff_work_actions WHERE colis_id='f7400000-0000-4000-8000-000000000001' AND kind='preparation'),'claim',1);
SELECT pg_sleep(0.5);
COMMIT;
SQL
}
claim a f7100000-0000-4000-8000-000000000001 & pid_a=$!
claim b f7100000-0000-4000-8000-000000000002 & pid_b=$!
set +e
wait "$pid_a"; result_a=$?
wait "$pid_b"; result_b=$?
set -e
if [ "$result_a,$result_b" != '0,3' ] && [ "$result_a,$result_b" != '3,0' ]; then
 cat "$logs/a.log" "$logs/b.log"
 exit 1
fi
sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='f7400000-0000-4000-8000-000000000001' AND kind='preparation' AND version=2 AND assignee_id IN ('f7100000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000002')) THEN RAISE EXCEPTION 'Concurrent claim did not produce exactly one owner'; END IF;
 RAISE NOTICE 'PASS Real two-session concurrent claim has exactly one winner';
END; $$;
SQL
