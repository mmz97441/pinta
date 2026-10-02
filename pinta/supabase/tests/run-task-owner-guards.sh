#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_OWNER_GUARD_DB_CONTAINER:-pinta-task-owner-guards-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-task-owner.XXXXXX")
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
sql < "$root/tests/task-owner-guards.sql"
sql < "$root/tests/task-readiness.sql"
sql < "$root/tests/invoice-review.sql"
sql < "$root/tests/task-corrections.sql"
sql < "$root/tests/task-owner-guards-concurrency.sql"
wait_lock() {
 attempt=0
 while [ "$(docker exec "$container" psql -Atq -U postgres -c "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND granted")" != '1' ]; do
  attempt=$((attempt+1));if [ "$attempt" -ge 40 ]; then cat "$logs"/*.log; exit 1; fi;sleep 0.05
 done
}
session() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/$1.log" 2>&1; }
# The transfer wins the race: an editor with an unchanged dossier version is rejected.
session transfer <<'SQL' &
BEGIN;
SET LOCAL statement_timeout='5s'; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','df100000-0000-4000-8000-000000000002',true);
SELECT mutate_staff_work_action(id,'reassign',version,'{"staff_id":"df100000-0000-4000-8000-000000000002","reason":"Relais de travail"}') FROM staff_work_actions WHERE colis_id='df400000-0000-4000-8000-000000000001' AND kind='preparation';
SELECT pg_advisory_xact_lock(93001); SELECT pg_sleep(1);
COMMIT;
SQL
transfer_pid=$!
wait_lock 93001
set +e
session stale_save <<'SQL'
BEGIN;
SET LOCAL statement_timeout='5s'; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','df100000-0000-4000-8000-000000000001',true);
SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM owner_race_versions WHERE id='df400000-0000-4000-8000-000000000001';
COMMIT;
SQL
stale_result=$?
set -e
wait "$transfer_pid"
if [ "$stale_result" -ne 3 ] || ! grep -q '40001:' "$logs/stale_save.log"; then cat "$logs/transfer.log" "$logs/stale_save.log"; exit 1; fi
sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='df400000-0000-4000-8000-000000000001' AND kind='preparation' AND assignee_id='df100000-0000-4000-8000-000000000002') OR EXISTS(SELECT 1 FROM colis WHERE id='df400000-0000-4000-8000-000000000001' AND fin_p IS NOT NULL) THEN RAISE EXCEPTION 'Stale owner changed preparation after transfer'; END IF;
 RAISE NOTICE 'PASS: concurrent transfer wins; stale save rejected without deadlock or measurement change';
END; $$;
SQL
# Reverse ordering: completed work is saved once; an older reassignment cannot take it.
session first_save <<'SQL' &
BEGIN;
SET LOCAL statement_timeout='5s'; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','df100000-0000-4000-8000-000000000001',true);
SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM owner_race_versions WHERE id='df400000-0000-4000-8000-000000000002';
SELECT pg_advisory_xact_lock(93002); SELECT pg_sleep(1);
COMMIT;
SQL
save_pid=$!
wait_lock 93002
set +e
session late_transfer <<'SQL'
BEGIN;
SET LOCAL statement_timeout='5s'; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','df100000-0000-4000-8000-000000000002',true);
SELECT mutate_staff_work_action(id,'reassign',1,'{"staff_id":"df100000-0000-4000-8000-000000000002","reason":"Relais trop tardif"}') FROM staff_work_actions WHERE colis_id='df400000-0000-4000-8000-000000000002' AND kind='preparation';
COMMIT;
SQL
late_result=$?
set -e
wait "$save_pid"
if [ "$late_result" -ne 3 ] || ! grep -q '40001:' "$logs/late_transfer.log"; then cat "$logs/first_save.log" "$logs/late_transfer.log"; exit 1; fi
sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='df400000-0000-4000-8000-000000000002' AND kind='preparation' AND state='done' AND assignee_id='df100000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Late transfer changed completed owner'; END IF;
 RAISE NOTICE 'PASS: concurrent business save wins; late reassignment rejected without deadlock';
END; $$;
SQL
# Two different owners finish different tasks of the same dossier successfully.
session parallel_preparation <<'SQL' &
BEGIN;
SET LOCAL statement_timeout='5s'; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','df100000-0000-4000-8000-000000000001',true);
SELECT save_preparation_measurements(id,'[{"dimL":10,"dimW":10,"dimH":10,"poids":2}]',updated_at,preparation_composition_version) FROM owner_race_versions WHERE id='df400000-0000-4000-8000-000000000003';
SELECT pg_advisory_xact_lock(93003); SELECT pg_sleep(1);
COMMIT;
SQL
parallel_pid=$!
wait_lock 93003
session parallel_documents <<'SQL'
BEGIN;
SET LOCAL statement_timeout='5s'; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','df100000-0000-4000-8000-000000000002',true);
SELECT save_invoice_review('df500000-0000-4000-8000-000000000001',invoice_token,'df400000-0000-4000-8000-000000000003/invoice.pdf','[{"desc":"Article concurrent","qte":1,"prix":20,"cat":"df600000-0000-4000-8000-000000000001"}]',20,'Concurrent invoice',NULL,true) FROM owner_race_versions WHERE id='df400000-0000-4000-8000-000000000003';
COMMIT;
SQL
wait "$parallel_pid"
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM staff_work_actions WHERE colis_id='df400000-0000-4000-8000-000000000003' AND kind IN ('preparation','documents') AND state='done')<>2 OR NOT EXISTS(SELECT 1 FROM staff_work_actions WHERE colis_id='df400000-0000-4000-8000-000000000003' AND kind='quote' AND state='ready') THEN RAISE EXCEPTION 'Independent owners could not complete parallel work'; END IF;
 IF NOT EXISTS(SELECT 1 FROM factures WHERE id='df500000-0000-4000-8000-000000000001' AND valide) OR NOT EXISTS(SELECT 1 FROM colis WHERE id='df400000-0000-4000-8000-000000000003' AND fin_p=2) THEN RAISE EXCEPTION 'Parallel work results missing'; END IF;
 RAISE NOTICE 'PASS: independent preparation and invoice owners both save; quote becomes ready';
END; $$;
SQL
