#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_ADMIN_DB_CONTAINER:-pinta-admin-simplification-db}
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1)); if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do case ${migration##*/} in 202609*) ;; *) sql -1 < "$migration";; esac;done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/202609*.sql; do { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1;done
sql < "$root/tests/admin-simplification.sql"
sql < "$root/tests/client-outgoing-tracking.sql"
# Two real sessions editing the same tariff baseline: one commit, one conflict.
sql <<'SQL'
INSERT INTO auth.users(id,email) VALUES('fa400000-0000-4000-8000-000000000001','admin-race@example.test');
INSERT INTO staff_users(auth_id,nom,email,role) VALUES('fa400000-0000-4000-8000-000000000001','Admin race','admin-race@example.test','directeur');
CREATE TABLE admin_tariff_race AS SELECT jsonb_object_agg(destination_code,jsonb_build_object('base',base,'parKg',par_kg)) baseline FROM tarifs WHERE actif;
GRANT SELECT ON admin_tariff_race TO authenticated;
SQL
race() { sql <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','fa400000-0000-4000-8000-000000000001',true);
SELECT save_admin_tariffs(jsonb_set(baseline,'{974,base}','67'),baseline) FROM admin_tariff_race;
SELECT pg_sleep(0.2);
COMMIT;
SQL
}
race & first=$!
race & second=$!
set +e
wait "$first"; first_status=$?
wait "$second"; second_status=$?
set -e
if ! { [ "$first_status" -eq 0 ] && [ "$second_status" -eq 3 ]; } && ! { [ "$first_status" -eq 3 ] && [ "$second_status" -eq 0 ]; }; then printf 'FAIL tariff race: %s %s\n' "$first_status" "$second_status" >&2; exit 1;fi
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM audit_actions WHERE user_id='fa400000-0000-4000-8000-000000000001' AND action='admin_tariffs_saved')<>1 THEN RAISE EXCEPTION 'FAIL concurrent duplicate writes'; END IF;
 RAISE NOTICE 'PASS: concurrent tariff sessions produce exactly one commit, one explicit conflict';
END; $$;
SQL
