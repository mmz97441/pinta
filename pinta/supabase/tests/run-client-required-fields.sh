#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scripts="$root/../scripts/deployment"
container=${PINTA_CLIENT_REQUIRED_FIELDS_DB_CONTAINER:-pinta-client-required-fields-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-client-required-fields.XXXXXX")
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
# The production script only builds SQL here: no credential, no network, nothing runs at import.
release() { python3 -B -c "import sys;sys.path.insert(0,sys.argv[1]);import client_required_fields20261007 as release;$1" "$scripts" "${2:-}"; }
preflight() { release 'print(release.PREFLIGHT_SQL)' | docker exec -i "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 > "$logs/$1.json"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi; done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 case "$migration_name" in 20261007000003_client_required_fields.sql)
  # The INSERT privilege production gives the API roles (Supabase default privileges), used by the functional post check
  # and revoked below, and clients written before the rule that the preflight must report without changing them:
  # complete; incomplete; invalid email, phone and destination (pro); landline only with a malformed postcode and an
  # address only in the legacy column.
  sql <<'SQL'
GRANT INSERT ON clients TO authenticated,service_role;
INSERT INTO clients(id,nom,prenom,email,tel,tel_fixe,adresse,cp,ville,type) VALUES
 ('7c900000-0000-4000-8000-000000000001','Payet','Flavie','flavie.payet@example.test','0692 12 34 56',NULL,'12 rue des Lilas','97400','Saint-Denis','particulier'),
 ('7c900000-0000-4000-8000-000000000002','Ancien',NULL,NULL,NULL,NULL,NULL,'97400',NULL,'particulier'),
 ('7c900000-0000-4000-8000-000000000003','Hoarau','Léa','lea-sans-arobase','0692',NULL,'Chemin des Roses','75011','Paris','pro'),
 ('7c900000-0000-4000-8000-000000000004','Grondin','Marc','marc@example.test',NULL,'0262 41 00 00','5 chemin Bœuf Mort','9741','Saint-Pierre','pro');
SET session_replication_role=replica;
UPDATE clients SET adresse_ligne1=NULL WHERE id='7c900000-0000-4000-8000-000000000004';
RESET session_replication_role;
SQL
  # Release rehearsal on this exact baseline: preflight report, rolled-back transaction, then the registering transaction;
  # a second preflight refuses to apply again and reports the same clients, never rewritten.
  sql -c 'CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);'
  preflight before
  release 'import json;problems=release.baseline_problems(json.load(open(sys.argv[2])));print("\n".join(problems));sys.exit(1 if problems else 0)' "$logs/before.json"
  release 'import json
reports=json.load(open(sys.argv[2]))["reports"]
expected={"clients":4,"complete":1,"incomplete":3,"incomplete_with_portal_account":0,"incomplete_by_type":{"particulier":1,"pro":2},
 "missing":{"prenom":1,"nom":0,"email":1,"telephone":1,"adresse":1,"cp":0,"ville":1},
 "invalid":{"email":1,"telephone":1,"cp_format":1,"cp_destination":1},"landline_only":1,"address_only_in_legacy_column":1}
if reports!=expected: sys.exit("FAIL: unexpected preflight report "+json.dumps(reports))
print("PASS: the preflight reports the incomplete clients per field without changing them")' "$logs/before.json"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql())'; } | sql
  sql -c "DO \$\$ BEGIN IF to_regprocedure('public.guard_client_required_fields()') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='z_guard_client_required_fields') OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261007000003') THEN RAISE EXCEPTION 'Rehearsal rollback failed'; END IF; RAISE NOTICE 'PASS: preflight accepts the reviewed baseline; the rehearsal keeps business data and rolls back'; END \$\$;"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql(True))'; } | sql
  sql -c "DO \$\$ BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261007000003' AND name='client_required_fields') OR to_regprocedure('public.guard_client_required_fields()') IS NULL THEN RAISE EXCEPTION 'Release transaction not applied'; END IF; RAISE NOTICE 'PASS: the registering release transaction applies the migration'; END \$\$;"
  { printf 'BEGIN;\n'; release 'print(release.POST_CHECKS_SQL)'; printf 'ROLLBACK;\n'; } | sql
  preflight after
  release 'import json
before,after=(json.load(open(path)) for path in sys.argv[2].split(","))
problems=release.baseline_problems(after)
if "version already registered" not in problems or not any(p.startswith("objects of this release already exist") for p in problems): sys.exit("FAIL: second preflight "+repr(problems))
if after["reports"]!=before["reports"] or after["incomplete_clients"]!=before["incomplete_clients"]: sys.exit("FAIL: the release changed the reported clients")
print("PASS: a second preflight refuses to apply again; the reported clients are unchanged")' "$logs/before.json,$logs/after.json"
  sql -c "DELETE FROM clients WHERE id::text LIKE '7c900000-%'; REVOKE INSERT ON clients FROM authenticated,service_role;"
  continue
 ;; esac
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1; done
sql < "$root/tests/client-required-fields.sql"
# Existing suites writing clients, on the guarded schema: portal profile (regressions), fixtures written by the owner
# while request claims are still set (staff-work-actions), subscription command on an incomplete client
# (admin-simplification), address synchronisation (preparation-workspace).
sql < "$root/tests/regressions.sql"
sql < "$root/tests/staff-work-actions.sql"
sql < "$root/tests/admin-simplification.sql"
sql < "$root/tests/preparation-workspace.sql"
