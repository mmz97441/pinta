#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_QUOTE_GUARD_DB_CONTAINER:-pinta-quote-edit-guards-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-quote-edit.XXXXXX")
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
sql < "$root/tests/quote-edit-guards.sql"
sql < "$root/tests/task-readiness.sql"
sql < "$root/tests/task-corrections.sql"
sql < "$root/tests/quote-edit-guards-concurrency.sql"
wait_lock() {
 attempt=0
 while [ "$(docker exec "$container" psql -Atq -U postgres -c "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND granted")" != '1' ]; do
  attempt=$((attempt+1));if [ "$attempt" -ge 40 ]; then cat "$logs"/*.log; exit 1; fi;sleep 0.05
 done
}
session() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/$1.log" 2>&1; }
expect_conflict() { if [ "$1" -ne 3 ] || ! grep -q '40001:' "$logs/$2.log"; then cat "$logs"/*.log; exit 1; fi; }
# Correction holds the dossier first: a checkout using the previous quote fails.
session correction_first <<'SQL' &
BEGIN;
SET LOCAL statement_timeout='5s'; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','ee000000-0000-4000-8000-000000000001',true);
SELECT correct_colis_task(id,'preparation','{"boxes":[{"dimL":10,"dimW":10,"dimH":10,"poids":3}]}',updated_at,'Corriger avant de payer') FROM quote_guard_race_versions WHERE id='ee300000-0000-4000-8000-000000000001';
SELECT pg_advisory_xact_lock(94001);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 94001
set +e
session stale_checkout <<'SQL'
BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT reserve_payplug_intent('ee300000-0000-4000-8000-000000000001',2,4000,false,repeat('a',64),now()+interval '90 days');COMMIT;
SQL
result=$?;set -e;wait "$first";expect_conflict "$result" stale_checkout
sql <<'SQL'
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM payment_intents WHERE colis_id='ee300000-0000-4000-8000-000000000001') OR NOT EXISTS(SELECT 1 FROM colis WHERE id='ee300000-0000-4000-8000-000000000001' AND fin_p=3 AND devis_total IS NULL) THEN RAISE EXCEPTION 'FAIL correction first race'; END IF;
 RAISE NOTICE 'PASS: correction commits first, stale payment reservation rejected without intent or deadlock';END;$$;
SQL
# Reservation first: corrections must preserve the pending provider creation.
session checkout_first <<'SQL' &
BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT reserve_payplug_intent('ee300000-0000-4000-8000-000000000002',2,4000,false,repeat('b',64),now()+interval '90 days');
SELECT pg_advisory_xact_lock(94002);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 94002
set +e
session late_correction <<'SQL'
BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','ee000000-0000-4000-8000-000000000001',true);
SELECT correct_colis_task(id,'preparation','{"boxes":[{"dimL":10,"dimW":10,"dimH":10,"poids":3}]}',updated_at,'Correction trop tardive') FROM quote_guard_race_versions WHERE id='ee300000-0000-4000-8000-000000000002';COMMIT;
SQL
result=$?;set -e;wait "$first";expect_conflict "$result" late_correction
sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM colis c JOIN quote_guard_race_versions v USING(id) WHERE c.id='ee300000-0000-4000-8000-000000000002' AND to_jsonb(c)=v.original) OR (SELECT count(*) FROM payment_intents WHERE colis_id='ee300000-0000-4000-8000-000000000002' AND status='creating')<>1 OR EXISTS(SELECT 1 FROM audit_actions WHERE colis_id='ee300000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'FAIL reservation first race'; END IF;
 RAISE NOTICE 'PASS: reservation commits first, late correction rejected with unchanged dossier and no correction audit';END;$$;
SQL
# Two callers cannot both proceed to an external provider request.
session reservation_one <<'SQL' &
BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT reserve_payplug_intent('ee300000-0000-4000-8000-000000000003',2,4000,false,repeat('c',64),now()+interval '90 days');
SELECT pg_advisory_xact_lock(94003);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 94003
set +e
session reservation_two <<'SQL'
BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT reserve_payplug_intent('ee300000-0000-4000-8000-000000000003',2,4000,false,repeat('d',64),now()+interval '90 days');COMMIT;
SQL
result=$?;set -e;wait "$first";expect_conflict "$result" reservation_two
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM payment_intents WHERE colis_id='ee300000-0000-4000-8000-000000000003')<>1 OR NOT EXISTS(SELECT 1 FROM payment_intents WHERE colis_id='ee300000-0000-4000-8000-000000000003' AND return_token_hash=repeat('c',64)) THEN RAISE EXCEPTION 'FAIL concurrent reservation duplication'; END IF;
 RAISE NOTICE 'PASS: concurrent checkout reserves exactly once without rotating the winning return token';END;$$;
SQL
