#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_CORRECTION_DB_CONTAINER:-pinta-task-corrections-db}
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1;fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do case ${migration##*/} in 202609*) ;; *) sql -1 < "$migration";; esac;done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/202609*.sql; do { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1;done
sql < "$root/tests/task-corrections.sql"
# Real concurrent database sessions: one correction wins; the stale draft survives as a conflict.
sql < "$root/tests/task-corrections-concurrency.sql"
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-correction-race.XXXXXX")
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
correct_race() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/$1.log" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','cb000000-0000-4000-8000-000000000001',true);
SELECT correct_colis_task(id,'reception','{"boxes":[{"dimL":40,"dimW":30,"dimH":20,"poids":$2}]}',updated_at,'Correction collègue $1') FROM correction_race_versions WHERE id='cb300000-0000-4000-8000-000000000001';
SELECT pg_sleep(0.3);
COMMIT;
SQL
}
correct_race a 5 & a=$!
correct_race b 6 & b=$!
set +e
wait "$a"; ra=$?
wait "$b"; rb=$?
set -e
if [ "$ra,$rb" != '0,3' ] && [ "$ra,$rb" != '3,0' ]; then cat "$logs/a.log" "$logs/b.log";exit 1;fi
if ! grep -q '40001' "$logs/a.log" "$logs/b.log"; then cat "$logs/a.log" "$logs/b.log";exit 1;fi
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM audit_actions WHERE colis_id='cb300000-0000-4000-8000-000000000001' AND action='correction_reception')<>1 THEN RAISE EXCEPTION 'Exactly one correction must win'; END IF;
 RAISE NOTICE 'PASS two real concurrent corrections have one CAS winner';
END; $$;
SQL
# A client decision waits behind a new agreement generation, then must fail even with legacy NULL CAS.
(
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 > "$logs/renew.log" 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','cb000000-0000-4000-8000-000000000001',true);
SELECT correct_colis_task(id,'accord','{}',updated_at,'Nouvelle demande volontaire') FROM colis WHERE id='cb300000-0000-4000-8000-000000000002';
SELECT pg_advisory_xact_lock(9020001);
SELECT pg_sleep(1);
UPDATE colis SET statut='attente_feu_vert' WHERE id='cb300000-0000-4000-8000-000000000002';
COMMIT;
SQL
) & renew=$!
ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
 ready=$(docker exec "$container" psql -Atq -U postgres -c "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=9020001 AND granted")
 [ "$ready" = 1 ] && break
 sleep 0.05
done
[ "$ready" = 1 ] || { cat "$logs/renew.log";exit 1; }
set +e
docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/client.log" 2>&1 <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','cb000000-0000-4000-8000-000000000002',true);
SELECT client_decision('cb300000-0000-4000-8000-000000000002','approve',NULL);
COMMIT;
SQL
client_result=$?
wait "$renew"; renew_result=$?
set -e
if [ "$client_result,$renew_result" != '3,0' ] || ! grep -q '40001' "$logs/client.log"; then cat "$logs/client.log" "$logs/renew.log";exit 1;fi
sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM colis WHERE id='cb300000-0000-4000-8000-000000000002' AND statut='attente_feu_vert' AND feu_vert='en_attente' AND consent_request_version=1) THEN RAISE EXCEPTION 'Concurrent old decision changed new agreement'; END IF;
 RAISE NOTICE 'PASS concurrent legacy client decision cannot approve renewed generation';
END; $$;
SQL
