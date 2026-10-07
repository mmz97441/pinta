#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scripts="$root/../scripts/deployment"
container=${PINTA_LOADING_CHECKS_DB_CONTAINER:-pinta-loading-checks-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-loading-checks.XXXXXX")
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
value() { docker exec "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 -c "$1"; }
# The production script only builds SQL here: no credential, no network, nothing runs at import.
release() { python3 -B -c "import sys;sys.path.insert(0,sys.argv[1]);import departure_loading_checks20261007 as release;$1" "$scripts" "${2:-}"; }
preflight() { release 'print(release.PREFLIGHT_SQL)' | docker exec -i "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 > "$logs/$1.json"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi; done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 case "$migration_name" in 20261007000004_departure_loading_checks.sql)
  # Rows the preflight must report without changing them: a departure leaving today (Paris) with a paid dossier of two
  # parcels, a paid legacy single measure, a dossier not prepared yet and a cancelled one; a later departure with an
  # unpaid prepared dossier.
  sql <<'SQL'
INSERT INTO clients(id,nom,cp,email) VALUES('1d200000-0000-4000-8000-000000000001','Client contrôle','97400','release-loading@example.test');
INSERT INTO envois(id,ref,destination_code,date_depart,statut) VALUES
 ('1d400000-0000-4000-8000-000000000001','REL-TODAY','974',(now() AT TIME ZONE 'Europe/Paris')::date,'planifie'),
 ('1d400000-0000-4000-8000-000000000002','REL-LATER','974',(now() AT TIME ZONE 'Europe/Paris')::date+7,'planifie');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,fin_l,fin_w,fin_h,fin_p,final_packages,outgoing_parcel_count,preparation_composition_version,final_measurements_version,devis_total,devis_snapshot,paiement_montant,paiement_date) VALUES
 ('1d300000-0000-4000-8000-000000000001','1d200000-0000-4000-8000-000000000001','REL-TWO','paye','autorise','1d400000-0000-4000-8000-000000000001',40,30,30,19.5,
  '[{"dimL":40,"dimW":30,"dimH":30,"poids":12},{"dimL":30,"dimW":30,"dimH":20,"poids":7.5}]',2,1,1,140,'{"inputs":{"destination":{"code":"974"}}}',140,now()),
 ('1d300000-0000-4000-8000-000000000002','1d200000-0000-4000-8000-000000000001','REL-LEGACY','paye','autorise','1d400000-0000-4000-8000-000000000001',20,20,20,2,
  NULL,NULL,0,0,20,'{"destination":{"code":"974"}}',20,now()),
 ('1d300000-0000-4000-8000-000000000004','1d200000-0000-4000-8000-000000000001','REL-UNPAID','en_preparation','autorise','1d400000-0000-4000-8000-000000000002',20,20,20,2,
  '[{"dimL":20,"dimW":20,"dimH":20,"poids":2}]',1,1,1,NULL,NULL,NULL,NULL);
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id) VALUES
 ('1d300000-0000-4000-8000-000000000003','1d200000-0000-4000-8000-000000000001','REL-UNPREPARED','autorise','autorise','1d400000-0000-4000-8000-000000000001'),
 ('1d300000-0000-4000-8000-000000000005','1d200000-0000-4000-8000-000000000001','REL-CANCELLED','annule',NULL,'1d400000-0000-4000-8000-000000000001');
SQL
  # Supabase gives the API roles every privilege on the tables and functions it creates (default privileges): the
  # release's REVOKEs must win over them, as in production.
  sql -c 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;'
  # Release rehearsal on this exact baseline: preflight report, rolled-back transaction, then the registering transaction;
  # a second preflight refuses to apply again and reports the same departures.
  sql -c 'CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);'
  preflight before
  release 'import json;problems=release.baseline_problems(json.load(open(sys.argv[2])));print("\n".join(problems));sys.exit(1 if problems else 0)' "$logs/before.json"
  release 'import json
current=json.load(open(sys.argv[2]))
expected={"open_departures_with_dossiers":2,"dossiers_to_check":3,"parcels_to_check":4,"legacy_single_parcel_dossiers":1,"dossiers_not_prepared":1,
 "departures_today":[{"ref":"REL-TODAY","dossiers":3,"parcels":3,"paid":2}]}
if current["reports"]!=expected: sys.exit("FAIL: unexpected preflight report "+json.dumps(current["reports"]))
if release.summary(current)["parcels_to_check_today"]!=3 or [d["ref"] for d in current["departures"]]!=["REL-TODAY","REL-LATER"]: sys.exit("FAIL: unexpected summary or private list")
if any(r["md5"]!=e for r in current["relied"] for s,e in release.REPORTED.items() if r["signature"]==s): sys.exit("FAIL: relied functions differ from the reviewed replay")
print("PASS: the preflight reports the departures to control without changing them")' "$logs/before.json"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql())'; } | sql
  sql -c "DO \$\$ BEGIN IF to_regclass('public.departure_loading_checks') IS NOT NULL OR to_regprocedure('public.record_loading_check(uuid,uuid,integer,integer,text)') IS NOT NULL
   OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261007000004')
   OR md5(pg_get_functiondef('public.confirm_departure(uuid,jsonb,timestamptz,text)'::regprocedure))<>'c6dd19d1055cbd98cf517dc173600849' THEN RAISE EXCEPTION 'Rehearsal rollback failed'; END IF;
   RAISE NOTICE 'PASS: preflight accepts the reviewed baseline; the rehearsal keeps business data and rolls back'; END \$\$;"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql(True))'; } | sql
  sql -c "DO \$\$ BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261007000004' AND name='departure_loading_checks')
   OR to_regclass('public.departure_loading_checks') IS NULL OR position('loading_check:incomplete' IN pg_get_functiondef('public.confirm_departure(uuid,jsonb,timestamptz,text)'::regprocedure))=0 THEN
   RAISE EXCEPTION 'Release transaction not applied'; END IF; RAISE NOTICE 'PASS: the registering release transaction applies the migration'; END \$\$;"
  { printf 'BEGIN;\n'; release 'print(release.POST_CHECKS_SQL)'; printf 'ROLLBACK;\n'; } | sql
  preflight after
  release 'import json
before,after=(json.load(open(path)) for path in sys.argv[2].split(","))
problems=release.baseline_problems(after)
if "version already registered" not in problems or not any(p.startswith("objects of this release already exist") for p in problems) or not any("confirm_departure" in p for p in problems): sys.exit("FAIL: second preflight "+repr(problems))
if after["reports"]!=before["reports"] or after["departures"]!=before["departures"]: sys.exit("FAIL: the release changed the reported departures")
print("PASS: a second preflight refuses to apply again; the reported departures are unchanged")' "$logs/before.json,$logs/after.json"
  sql -c "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated,service_role;
   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon,authenticated,service_role;
   DELETE FROM colis WHERE id::text LIKE '1d300000-%'; DELETE FROM envois WHERE id::text LIKE '1d400000-%'; DELETE FROM clients WHERE id::text LIKE '1d200000-%';"
  continue
 ;; esac
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1; done
sql < "$root/tests/loading-checks.sql"
# Existing suites confirming a departure, on the controlled schema: they record their checks first.
sql < "$root/tests/staff-work-actions.sql"
sql < "$root/tests/customs-quote.sql"

# Real sessions, committed fixtures: the scans and the confirmation lock the departure, then the dossier, in one order.
sql <<'SQL'
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('1e000000-0000-4000-8000-000000000001','race-loading-a@example.test','{"nom":"Course A"}'),
 ('1e000000-0000-4000-8000-000000000002','race-loading-b@example.test','{"nom":"Course B"}');
INSERT INTO staff_users(id,auth_id,nom,prenom,email,role,must_change_password) VALUES
 ('1e100000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000001','Course','Anne','race-loading-a@example.test','directeur',false),
 ('1e100000-0000-4000-8000-000000000002','1e000000-0000-4000-8000-000000000002','Course','Bruno','race-loading-b@example.test','directeur',false);
INSERT INTO clients(id,nom,cp,email) VALUES('1e200000-0000-4000-8000-000000000001','Client course','97400','race-loading-client@example.test');
INSERT INTO envois(id,ref,destination_code,date_depart,statut) VALUES
 ('1e400000-0000-4000-8000-000000000001','RACE-1','974',(now() AT TIME ZONE 'Europe/Paris')::date,'planifie'),
 ('1e400000-0000-4000-8000-000000000002','RACE-2','974',(now() AT TIME ZONE 'Europe/Paris')::date,'planifie'),
 ('1e400000-0000-4000-8000-000000000003','RACE-3','974',(now() AT TIME ZONE 'Europe/Paris')::date+7,'planifie');
INSERT INTO colis(id,client_id,ref,statut,feu_vert,envoi_id,fin_l,fin_w,fin_h,fin_p,final_packages,outgoing_parcel_count,preparation_composition_version,final_measurements_version,devis_total,devis_snapshot,paiement_montant,paiement_date)
SELECT ('1e300000-0000-4000-8000-00000000000'||n)::uuid,'1e200000-0000-4000-8000-000000000001','RACE-'||n,'paye','autorise',envoi::uuid,20,20,20,2,
 CASE WHEN n=5 THEN '[{"dimL":20,"dimW":20,"dimH":20,"poids":1},{"dimL":20,"dimW":20,"dimH":20,"poids":1}]' ELSE '[{"dimL":20,"dimW":20,"dimH":20,"poids":2}]' END::jsonb,
 CASE WHEN n=5 THEN 2 ELSE 1 END,1,1,20,'{"inputs":{"destination":{"code":"974"}}}',20,now()
FROM (VALUES (1,'1e400000-0000-4000-8000-000000000001'),(2,'1e400000-0000-4000-8000-000000000001'),(3,'1e400000-0000-4000-8000-000000000002'),
 (5,'1e400000-0000-4000-8000-000000000003')) f(n,envoi);
SQL
as_staff() { printf "BEGIN;\nSET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','%s',true);\n" "$1"; }
session() { docker exec -i "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/$1.log" 2>&1; }
sleeping() { attempt=0; until [ "$(value "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(5)%' AND state='active' AND pid<>pg_backend_pid()")" = '1' ]; do attempt=$((attempt+1));if [ "$attempt" -ge 200 ]; then cat "$logs"/*.log;exit 1;fi;sleep 0.05;done; }
waiting() { attempt=0; until [ "$(value "SELECT count(*) FROM pg_locks WHERE NOT granted")" -ge 1 ]; do attempt=$((attempt+1));if [ "$attempt" -ge 100 ]; then cat "$logs"/*.log;exit 1;fi;sleep 0.05;done; }
anne=1e000000-0000-4000-8000-000000000001; bruno=1e000000-0000-4000-8000-000000000002
{ as_staff "$anne"; printf "SELECT record_loading_check('1e400000-0000-4000-8000-000000000001','1e300000-0000-4000-8000-000000000001',1,1,'scan');\nSELECT record_loading_check('1e400000-0000-4000-8000-000000000002','1e300000-0000-4000-8000-000000000003',1,1,'scan');\nCOMMIT;\n"; } | session setup

# The confirmation carries the versions the screen read (the API role reads no table here).
loaded() { value "SELECT jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at,'outgoing_parcel_count',outgoing_parcel_count) ORDER BY ref) FROM colis WHERE envoi_id='$1'"; }
confirm_sql() { printf "SELECT (confirm_departure('%s','%s','%s')).statut;\n" "$1" "$(loaded "$1")" "$(value "SELECT updated_at FROM envois WHERE id='$1'")"; }

# 1. A confirmation started during a scan waits for it, then counts it.
first_confirmation=$(confirm_sql 1e400000-0000-4000-8000-000000000001)
{ as_staff "$anne"; printf "SELECT (record_loading_check('1e400000-0000-4000-8000-000000000001','1e300000-0000-4000-8000-000000000002',1,1,'camera'))->>'status';\nSELECT pg_sleep(5);\nCOMMIT;\n"; } | session scan-first & scan=$!
sleeping
{ as_staff "$bruno"; printf '%s\nCOMMIT;\n' "$first_confirmation"; } | session confirm-second & confirm=$!
waiting
set +e
wait "$scan"; scan_result=$?
wait "$confirm"; confirm_result=$?
set -e
if [ "$scan_result,$confirm_result" != '0,0' ] || ! grep -qx 'recorded' "$logs/scan-first.log" || ! grep -qx 'parti' "$logs/confirm-second.log"; then cat "$logs"/*.log; exit 1; fi
sql -c "DO \$\$ BEGIN IF (SELECT jsonb_agg(i#>>'{loading_checks,0,method}' ORDER BY i#>>'{colis,ref}') FROM departure_manifests m CROSS JOIN LATERAL jsonb_array_elements(m.snapshot->'items') i WHERE m.envoi_id='1e400000-0000-4000-8000-000000000001')<>'[\"scan\",\"camera\"]' THEN
 RAISE EXCEPTION 'The confirmation did not see the scan it waited for'; END IF; RAISE NOTICE 'PASS: a confirmation started during a scan waits for it, then keeps it in the manifest'; END \$\$;"

# 2. A scan started during a confirmation waits for it, then is refused: the departure has left.
second_confirmation=$(confirm_sql 1e400000-0000-4000-8000-000000000002)
{ as_staff "$anne"; printf '%s\nSELECT pg_sleep(5);\nCOMMIT;\n' "$second_confirmation"; } | session confirm-first & confirm=$!
sleeping
{ as_staff "$bruno"; printf "SELECT record_loading_check('1e400000-0000-4000-8000-000000000002','1e300000-0000-4000-8000-000000000003',1,1,'camera');\nCOMMIT;\n"; } | session scan-second & scan=$!
waiting
set +e
wait "$confirm"; confirm_result=$?
wait "$scan"; scan_result=$?
set -e
if [ "$confirm_result,$scan_result" != '0,3' ] || ! grep -q 'loading_check:departure_closed' "$logs/scan-second.log"; then cat "$logs"/*.log; exit 1; fi
sql -c "DO \$\$ BEGIN IF (SELECT count(*) FROM departure_loading_checks WHERE envoi_id='1e400000-0000-4000-8000-000000000002')<>1
 OR (SELECT method FROM departure_loading_checks WHERE envoi_id='1e400000-0000-4000-8000-000000000002')<>'scan' THEN RAISE EXCEPTION 'A check was written into a confirmed departure'; END IF;
 RAISE NOTICE 'PASS: a scan started during a confirmation waits for it, then is refused: the departure has left'; END \$\$;"

# 3. The same label scanned at once on two devices is recorded once, with the first scan's who and when.
{ as_staff "$anne"; printf "SELECT (record_loading_check('1e400000-0000-4000-8000-000000000003','1e300000-0000-4000-8000-000000000005',1,2,'scan'))->>'status';\nSELECT pg_sleep(5);\nCOMMIT;\n"; } | session first-device & first=$!
sleeping
{ as_staff "$bruno"; printf "SELECT (record_loading_check('1e400000-0000-4000-8000-000000000003','1e300000-0000-4000-8000-000000000005',1,2,'camera'))->>'status';\nCOMMIT;\n"; } | session second-device & second=$!
waiting
set +e
wait "$first"; first_result=$?
wait "$second"; second_result=$?
set -e
if [ "$first_result,$second_result" != '0,0' ] || ! grep -qx 'recorded' "$logs/first-device.log" || ! grep -qx 'already' "$logs/second-device.log"; then cat "$logs"/*.log; exit 1; fi
sql -c "DO \$\$ BEGIN IF (SELECT count(*) FROM departure_loading_checks WHERE colis_id='1e300000-0000-4000-8000-000000000005')<>1
 OR (SELECT checked_by<>'$anne' OR method<>'scan' FROM departure_loading_checks WHERE colis_id='1e300000-0000-4000-8000-000000000005') THEN RAISE EXCEPTION 'A concurrent scan duplicated or rewrote the check'; END IF;
 RAISE NOTICE 'PASS: the same label scanned at once on two devices is recorded once, with the first scan'; END \$\$;"
