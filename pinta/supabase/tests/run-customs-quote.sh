#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_CUSTOMS_DB_CONTAINER:-pinta-customs-quote-db}
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
sql < "$root/tests/customs-quote.sql"
sql < "$root/tests/customs-suggestions.sql"
sql < "$root/tests/invoice-review.sql"
sql < "$root/tests/invoice-context-permissions.sql"
sql < "$root/tests/preparation-workspace.sql"
sql < "$root/tests/regressions.sql"
PINTA_DB_CONTAINER="$container" node "$root/tests/quote-parity.mjs"
PINTA_DB_CONTAINER="$container" node "$root/tests/reception-quote-parity.mjs"
PINTA_DB_CONTAINER="$container" node "$root/tests/customs-quote-parity.mjs"
sql < "$root/tests/customs-quote-concurrency.sql"
race() { sql <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','fd100000-0000-4000-8000-000000000001',true);
SELECT save_quote_customs(id,'[{"lineId":"fd600000-0000-4000-8000-000000000001","tariffId":"race-test-p1-r1","override":null}]',updated_at) FROM customs_race_baseline;
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
if ! { [ "$first_status" -eq 0 ] && [ "$second_status" -eq 3 ]; } && ! { [ "$first_status" -eq 3 ] && [ "$second_status" -eq 0 ]; }; then printf 'FAIL customs race: %s %s\n' "$first_status" "$second_status" >&2; exit 1;fi
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM audit_actions WHERE user_id='fd100000-0000-4000-8000-000000000001' AND action='quote_customs_saved')<>1 THEN RAISE EXCEPTION 'FAIL concurrent duplicate customs writes'; END IF;
 RAISE NOTICE 'PASS: concurrent customs sessions produce exactly one commit, one explicit conflict';
END; $$;
-- An article edited while no quote exists must still invalidate a colleague's CAS.
UPDATE customs_race_baseline SET updated_at=(SELECT updated_at FROM colis WHERE id=customs_race_baseline.id);
UPDATE lignes SET description='Concurrent article revised' WHERE id='fd600000-0000-4000-8000-000000000001';
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','fd100000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN
  PERFORM save_quote_customs(id,'[{"lineId":"fd600000-0000-4000-8000-000000000001","tariffId":"race-test-p1-r1","override":null}]',updated_at) FROM customs_race_baseline;
 EXCEPTION WHEN serialization_failure THEN RAISE NOTICE 'PASS: article edit before first quote invalidates customs CAS';RETURN;
 END;
 RAISE EXCEPTION 'FAIL stale article basis accepted';
END; $$;
ROLLBACK;
SQL
# Record measured performance, without a timing-sensitive assertion in CI.
docker exec -i "$container" psql -X -q -U postgres -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','fd100000-0000-4000-8000-000000000001',true);
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM search_customs_tariffs('vetement coton','974',20);
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM search_customs_tariffs('85 16 79 70','974',20);
ROLLBACK;
SQL
