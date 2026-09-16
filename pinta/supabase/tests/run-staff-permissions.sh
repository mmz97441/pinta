#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_STAFF_PERMISSIONS_DB_CONTAINER:-pinta-staff-permissions-db}
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
sql < "$root/tests/staff-permissions.sql"
# Exercise the actual conditional publication block with an existing membership,
# no publication, and a publication for all tables. All changes are rolled back.
publication_sql() { sed -n '/^DO \$\$/,$p' "$root/migrations/20260912000001_staff_permission_save.sql"; }
{
 printf 'BEGIN;\n'
 publication_sql
 cat <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename IN ('staff_users','staff_permissions'))<>2 THEN RAISE EXCEPTION 'Duplicate publication setup changed membership'; END IF;
 RAISE NOTICE 'PASS: existing Realtime memberships are safe to repeat';
END; $$;
DROP PUBLICATION supabase_realtime;
SQL
 publication_sql
 cat <<'SQL'
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN RAISE EXCEPTION 'Missing publication was unexpectedly created'; END IF;
 RAISE NOTICE 'PASS: environments without Realtime do not block the migration';
END; $$;
CREATE PUBLICATION supabase_realtime FOR ALL TABLES;
SQL
 publication_sql
 cat <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND puballtables) THEN RAISE EXCEPTION 'All-table publication was changed'; END IF;
 RAISE NOTICE 'PASS: existing all-table publication remains unchanged';
END; $$;
ROLLBACK;
SQL
} | sql
