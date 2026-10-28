#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_RECEPTION_VALIDATION_DB_CONTAINER:-pinta-reception-validation-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-reception-validation.XXXXXX")
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
# Supabase gives the API roles every privilege on the tables and functions its owners create (default privileges): the
# migration's REVOKEs must win over them, as in production.
sql -c 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;'
for migration in "$root"/migrations/*.sql; do migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi; done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1; done
sql < "$root/tests/reception-validation.sql"
# Concurrent sessions need committed dossiers, entered by a team member so that their cartons carry a server date.
sql <<'SQL'
GRANT USAGE ON SCHEMA public,auth TO authenticated;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('f2000000-0000-4000-8000-000000000001','rv-race@example.test','{"nom":"Course"}');
INSERT INTO staff_users(auth_id,nom,email,role,must_change_password) VALUES('f2000000-0000-4000-8000-000000000001','Course','rv-race@example.test','directeur',false);
INSERT INTO clients(id,nom,prenom,cp,type,telegram_chat_id) VALUES('f2100000-0000-4000-8000-000000000001','Course','Léa','97400','particulier','CHAT-RV-RACE');
BEGIN;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
INSERT INTO colis(id,client_id,ref,statut,nb_colis,trackings_detail,dims_par_colis) VALUES
 ('f2200000-0000-4000-8000-000000000001','f2100000-0000-4000-8000-000000000001','EXP-RV-RACE','mesure',1,'[{"number":"RACE-1"}]','[{"dimL":10,"dimW":20,"dimH":30,"poids":1}]'),
 ('f2200000-0000-4000-8000-000000000002','f2100000-0000-4000-8000-000000000001','EXP-RV-REPLAY','mesure',1,'[{"number":"REPLAY-1"}]','[{"dimL":10,"dimW":20,"dimH":30,"poids":1}]');
COMMIT;
INSERT INTO storage.objects(bucket_id,name) VALUES('photos-colis','f2200000-0000-4000-8000-000000000001/carton-abime.jpg');
SQL
race() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/$1.log" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000001',true);
SELECT validate_reception('f2100000-0000-4000-8000-000000000001','[{"colisId":"$2","fromCarton":1,"throughCarton":1}]',true,'telegram','arrivee_colis','Bonjour Léa, votre colis est arrivé.','$3');
SELECT pg_sleep(0.2);
COMMIT;
SQL
}
# Two validations of the same carton: one commits, the other finds it validated (40001: its list is out of date).
race first f2200000-0000-4000-8000-000000000001 f2300000-0000-4000-8000-000000000001 & first=$!
race second f2200000-0000-4000-8000-000000000001 f2300000-0000-4000-8000-000000000002 & second=$!
set +e
wait "$first"; first_status=$?
wait "$second"; second_status=$?
set -e
if ! { [ "$first_status" -eq 0 ] && [ "$second_status" -eq 3 ]; } && ! { [ "$first_status" -eq 3 ] && [ "$second_status" -eq 0 ]; }; then cat "$logs"/*.log; exit 1; fi
if ! grep -q '40001: Des cartons de ce dossier ont été validés entre-temps' "$logs/first.log" "$logs/second.log"; then cat "$logs"/*.log; exit 1; fi
# The same request twice at once (a lost response retried): both succeed, the second reuses the first.
race replay_first f2200000-0000-4000-8000-000000000002 f2300000-0000-4000-8000-000000000003 & first=$!
race replay_second f2200000-0000-4000-8000-000000000002 f2300000-0000-4000-8000-000000000003 & second=$!
wait "$first"
wait "$second"
if ! grep -q '"reused": true' "$logs/replay_first.log" "$logs/replay_second.log"; then cat "$logs"/replay_*.log; exit 1; fi
# The same photo recorded twice at once (a lost answer retried): both succeed, one row, the second reuses the first.
photo() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/$1.log" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000001',true);
SELECT add_reception_photo('f2200000-0000-4000-8000-000000000001',1,'f2200000-0000-4000-8000-000000000001/carton-abime.jpg');
SELECT pg_sleep(0.2);
COMMIT;
SQL
}
photo photo_first & first=$!
photo photo_second & second=$!
wait "$first"
wait "$second"
if ! grep -q '"reused": true' "$logs/photo_first.log" "$logs/photo_second.log"; then cat "$logs"/photo_*.log; exit 1; fi
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM reception_validation_items WHERE colis_id='f2200000-0000-4000-8000-000000000001')<>1
  OR (SELECT count(*) FROM messages WHERE colis_id='f2200000-0000-4000-8000-000000000001' AND template='arrivee_colis')<>1
  OR (SELECT count(*) FROM notification_outbox WHERE colis_id='f2200000-0000-4000-8000-000000000001')<>1
  OR (SELECT count(*) FROM audit_actions WHERE colis_id='f2200000-0000-4000-8000-000000000001' AND action='reception_validated')<>1 THEN
  RAISE EXCEPTION 'FAIL: concurrent validations of one carton recorded it twice or sent two notices'; END IF;
 RAISE NOTICE 'PASS: two concurrent validations of one carton: one commits with one notice, the other is refused (40001)';
 IF (SELECT count(*) FROM reception_validations WHERE request_id='f2300000-0000-4000-8000-000000000003')<>1
  OR (SELECT count(*) FROM reception_validation_items WHERE colis_id='f2200000-0000-4000-8000-000000000002')<>1
  OR (SELECT count(*) FROM messages WHERE colis_id='f2200000-0000-4000-8000-000000000002' AND template='arrivee_colis')<>1
  OR (SELECT count(*) FROM audit_actions WHERE colis_id='f2200000-0000-4000-8000-000000000002' AND action='reception_validated')<>1 THEN
  RAISE EXCEPTION 'FAIL: the same request sent twice at once was recorded twice'; END IF;
 RAISE NOTICE 'PASS: the same request sent twice at once: both succeed, one validation and one notice';
 IF (SELECT count(*) FROM reception_photos WHERE colis_id='f2200000-0000-4000-8000-000000000001')<>1
  OR (SELECT count(*) FROM audit_actions WHERE colis_id='f2200000-0000-4000-8000-000000000001' AND action='reception_photo_added')<>1 THEN
  RAISE EXCEPTION 'FAIL: the same photo sent twice at once was recorded twice'; END IF;
 RAISE NOTICE 'PASS: the same photo sent twice at once: both succeed, one photo and one journal entry';
END $$;
SQL
