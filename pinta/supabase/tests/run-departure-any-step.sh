#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scripts="$root/../scripts/deployment"
container=${PINTA_DEPARTURE_ANY_STEP_DB_CONTAINER:-pinta-departure-any-step-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-departure-any-step.XXXXXX")
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
value() { docker exec "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 -c "$1"; }
# The production script only builds SQL here: no credential, no network, nothing runs at import.
release() { python3 -B -c "import sys;sys.path.insert(0,sys.argv[1]);import departure_any_step20261006 as release;$1" "$scripts" "${2:-}"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi; done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 case "$migration_name" in 20261006000001_departure_any_step.sql)
  # Release rehearsal on this exact baseline: preflight hashes, rolled-back transaction, then the registering transaction.
  sql -c 'CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);'
  release 'print(release.PREFLIGHT_SQL)' | docker exec -i "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 > "$logs/preflight.json"
  release 'import json;problems=release.baseline_problems(json.load(open(sys.argv[2])));print("\n".join(problems));sys.exit(1 if problems else 0)' "$logs/preflight.json"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql())'; } | sql
  sql -c "DO \$\$ BEGIN IF to_regprocedure('public.set_colis_departure_wish(uuid,date,timestamptz)') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.colis'::regclass AND attname='depart_souhaite' AND NOT attisdropped) THEN RAISE EXCEPTION 'Rehearsal rollback failed'; END IF; RAISE NOTICE 'PASS: preflight accepts the reviewed baseline; the rehearsal keeps business data and rolls back'; END \$\$;"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql(True))'; } | sql
  sql -c "DO \$\$ BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261006000001' AND name='departure_any_step') OR to_regprocedure('public.create_departure_for_colis(uuid,date,timestamptz)') IS NULL THEN RAISE EXCEPTION 'Release transaction not applied'; END IF; RAISE NOTICE 'PASS: the registering release transaction applies the migration'; END \$\$;"
  { printf 'BEGIN;\n'; release 'print(release.POST_CHECKS_SQL)'; printf 'ROLLBACK;\n'; } | sql
  continue
 ;; esac
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1; done
sql < "$root/tests/departure-any-step.sql"
sql < "$root/tests/regressions.sql"
sql < "$root/tests/staff-work-actions.sql"
sql < "$root/tests/task-corrections.sql"
# Two real sessions create the same missing departure for two dossiers: one departure, both dossiers on it.
sql <<'SQL'
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('db000000-0000-4000-8000-000000000001','das-race@example.test','{"nom":"Direction course"}');
INSERT INTO staff_users(id,auth_id,nom,email,role,must_change_password) VALUES('db100000-0000-4000-8000-000000000001','db000000-0000-4000-8000-000000000001','Direction course','das-race@example.test','directeur',false);
INSERT INTO clients(id,nom,cp,email) VALUES('db200000-0000-4000-8000-000000000001','Client course','97400','das-race-client@example.test');
INSERT INTO colis(id,client_id,ref,statut) VALUES('db300000-0000-4000-8000-000000000001','db200000-0000-4000-8000-000000000001','DAS-RACE-1','receptionne'),
 ('db300000-0000-4000-8000-000000000002','db200000-0000-4000-8000-000000000001','DAS-RACE-2','receptionne');
SQL
day=$(value "SELECT ((now() AT TIME ZONE 'Europe/Paris')::date+40)::text")
race() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/$1.log" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','db000000-0000-4000-8000-000000000001',true);
SELECT create_departure_for_colis('$2','$day','$(value "SELECT updated_at FROM colis WHERE id='$2'")');
SELECT pg_sleep($3);
COMMIT;
SQL
}
race first db300000-0000-4000-8000-000000000001 4 & first=$!
attempt=0
until [ "$(value "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted")" = '1' ]; do attempt=$((attempt+1));if [ "$attempt" -ge 100 ]; then cat "$logs"/*.log;exit 1;fi;sleep 0.05;done
race second db300000-0000-4000-8000-000000000002 0 & second=$!
attempt=0
until [ "$(value "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted")" = '1' ]; do attempt=$((attempt+1));if [ "$attempt" -ge 50 ]; then cat "$logs"/*.log;exit 1;fi;sleep 0.05;done
set +e
wait "$first"; first_result=$?
wait "$second"; second_result=$?
set -e
if [ "$first_result,$second_result" != '0,0' ]; then cat "$logs"/*.log; exit 1; fi
sql <<SQL
DO \$\$ BEGIN
 IF (SELECT count(*) FROM envois WHERE destination_code='974' AND date_depart='$day')<>1
  OR (SELECT count(DISTINCT envoi_id) FROM colis WHERE id IN ('db300000-0000-4000-8000-000000000001','db300000-0000-4000-8000-000000000002') AND envoi_id IS NOT NULL)<>1
  OR (SELECT nb_colis FROM envois WHERE destination_code='974' AND date_depart='$day')<>2
  OR (SELECT count(*) FILTER (WHERE (detail::jsonb->>'created')::boolean) FROM audit_actions WHERE action='departure_create' AND colis_id::text LIKE 'db300000%')<>1 THEN
  RAISE EXCEPTION 'Concurrent creations duplicated or lost the departure';
 END IF;
 RAISE NOTICE 'PASS: two concurrent creations share one departure for the destination and day';
END \$\$;
SQL
