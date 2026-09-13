#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_OWNER_DB_CONTAINER:-pinta-migration-owners-db}
# No external database URL: this regression owns its disposable, networkless DB.
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1' EXIT
attempt=0
until docker exec "$container" pg_isready -U postgres > /dev/null 2>&1; do
 attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1
done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN; CREATE ROLE fixture_authenticator NOLOGIN NOINHERIT; GRANT authenticated TO fixture_authenticator;'
for migration in "$root"/migrations/*.sql; do
 case ${migration##*/} in 202609*) ;; *) sql -1 < "$migration";; esac
done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
sql -1 <<'SQL'
ALTER TABLE colis ADD COLUMN IF NOT EXISTS archive boolean;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS lu boolean DEFAULT false;
INSERT INTO clients(id,nom,cp,email) VALUES('b2000000-0000-4000-8000-000000000001','Owner fixture','97400','owner-fixture@example.test');
INSERT INTO colis(id,client_id,statut,archive) VALUES('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','attente_feu_vert',NULL);
INSERT INTO messages(colis_id,type,texte,lu) VALUES('b3000000-0000-4000-8000-000000000001','client','Historical unresolved question',true);
SQL
for migration in "$root"/migrations/202609*.sql; do
 # Match the actual Management API/restoration owner, without any JWT role.
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1
done
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='save_quote(uuid,jsonb,timestamptz)'::regprocedure)<>'supabase_admin' THEN RAISE EXCEPTION 'Unexpected command owner'; END IF;
 IF NOT (SELECT archive=false AND conversation_statut='a_traiter' FROM colis WHERE id='b3000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Historical normalization or conversation backfill failed'; END IF;
 RAISE NOTICE 'PASS: supabase_admin normalizes historical NULL archives and backfills read but unresolved conversations without a JWT';
END; $$;
BEGIN;
SET SESSION AUTHORIZATION fixture_authenticator;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN EXECUTE 'SET ROLE supabase_admin'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: authenticated cannot impersonate the trusted database owner'; RETURN; END;
 RAISE EXCEPTION 'Authenticated impersonated supabase_admin';
END; $$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
ROLLBACK;
SQL
for test in regressions conversations ocr-document-guard work-action-origin reception-measurements; do sql < "$root/tests/$test.sql"; done
PINTA_DB_CONTAINER="$container" node "$root/tests/reception-quote-parity.mjs"
