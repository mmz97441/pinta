#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scripts="$root/../scripts/deployment"
container=${PINTA_CONSENT_REPLY_DB_CONTAINER:-pinta-consent-reply-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-consent-reply.XXXXXX")
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
# The production script only builds SQL here: no credential, no network, nothing runs at import.
release() { python3 -B -c "import sys;sys.path.insert(0,sys.argv[1]);import consent_reply20261006 as release;$1" "$scripts" "${2:-}"; }
preflight() { release 'print(release.PREFLIGHT_SQL)' | docker exec -i "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 > "$logs/$1.json"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi; done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 case "$migration_name" in 20261006000002_consent_reply.sql)
  # Release rehearsal on this exact baseline, lot 3a registered first as in production: preflight hashes,
  # rolled-back transaction, then the registering transaction; a second preflight refuses to apply again.
  sql -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);"
  preflight refused-before-3a
  release 'import json;problems=release.baseline_problems(json.load(open(sys.argv[2])));sys.exit(0 if any("apply it first" in p for p in problems) else 1)' "$logs/refused-before-3a.json"
  sql -c "INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('20261006000001','departure_any_step');"
  preflight before
  release 'import json;problems=release.baseline_problems(json.load(open(sys.argv[2])));print("\n".join(problems));sys.exit(1 if problems else 0)' "$logs/before.json"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql())'; } | sql
  sql -c "DO \$\$ BEGIN IF position('feu_vert_recu_facture' IN pg_get_functiondef('public.register_telegram_document(uuid,text,text)'::regprocedure))>0 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261006000002') THEN RAISE EXCEPTION 'Rehearsal rollback failed'; END IF; RAISE NOTICE 'PASS: preflight accepts the reviewed baseline; the rehearsal keeps business data and templates, then rolls back'; END \$\$;"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql(True))'; } | sql
  sql -c "DO \$\$ BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261006000002' AND name='consent_reply') OR position('feu_vert_recu_facture' IN pg_get_functiondef('public.register_telegram_document(uuid,text,text)'::regprocedure))=0 THEN RAISE EXCEPTION 'Release transaction not applied'; END IF; RAISE NOTICE 'PASS: the registering release transaction applies the migration'; END \$\$;"
  { printf 'BEGIN;\n'; release 'print(release.POST_CHECKS_SQL)'; printf 'ROLLBACK;\n'; } | sql
  preflight after
  release 'import json;problems=release.baseline_problems(json.load(open(sys.argv[2])));sys.exit(0 if "version already registered" in problems and "the confirmation filter is already present" in problems else 1)' "$logs/after.json"
  continue
 ;; esac
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1; done
sql < "$root/tests/consent-reply.sql"
# The existing requested-invoice cases, unchanged, on the new command.
sql < "$root/tests/telegram-requested-invoice.sql"
