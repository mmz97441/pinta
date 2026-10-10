#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scripts="$root/../scripts/deployment"
container=${PINTA_RETENTION_DB_CONTAINER:-pinta-retention-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-retention.XXXXXX")
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
# The production script only builds SQL here: no credential, no network, nothing runs at import.
release() { python3 -B -c "import sys;sys.path.insert(0,sys.argv[1]);import retention20261010 as release;$1" "$scripts" "${2:-}"; }
preflight() { release 'print(release.PREFLIGHT_SQL)' | docker exec -i "$container" psql -Atq -U postgres -v ON_ERROR_STOP=1 > "$logs/$1.json"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
# Supabase gives the API roles every privilege on the tables its owners create (default privileges): the migrations'
# REVOKEs, and this release's, must win over them, as in production.
sql -c 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;'
for migration in "$root"/migrations/*.sql; do migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi; done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 case "$migration_name" in 20261010000001_history_retention.sql)
  # Shapes the release must handle: the audit key cascading (as on a fresh replay of 20260910000001), the key of
  # client_inbox.colis_id missing with an orphan row (the preflight must refuse it), and history the preflight reports
  # without changing it: a paid dossier with its link, payment, status change, message, delivery and journal entry; a
  # dossier without history on a planned departure; a departure that left before the manifests; a client whose only
  # history is a message.
  sql <<'SQL'
ALTER TABLE audit_actions DROP CONSTRAINT audit_actions_colis_id_fkey,
 ADD CONSTRAINT audit_actions_colis_id_fkey FOREIGN KEY (colis_id) REFERENCES colis(id) ON DELETE CASCADE;
ALTER TABLE client_inbox DROP CONSTRAINT client_inbox_colis_id_fkey;
INSERT INTO clients(id,nom,cp,email,telegram_chat_id) VALUES('b9200000-0000-4000-8000-000000000001','Client contrôle','97400','release-retention@example.test','CHAT-REL-1'),
 ('b9200000-0000-4000-8000-000000000002','Client message seul','97400','release-retention-inbox@example.test','CHAT-REL-2');
INSERT INTO envois(id,ref,destination_code,date_depart,statut) VALUES
 ('b9400000-0000-4000-8000-000000000001','REL-LEGACY','974',(now() AT TIME ZONE 'Europe/Paris')::date-30,'planifie'),
 ('b9400000-0000-4000-8000-000000000002','REL-PLANNED','974',(now() AT TIME ZONE 'Europe/Paris')::date+14,'planifie');
SELECT set_config('expedile.confirm_departure','allowed',false);
UPDATE envois SET statut='parti' WHERE id='b9400000-0000-4000-8000-000000000001';
SELECT set_config('expedile.confirm_departure','',false);
INSERT INTO colis(id,client_id,ref,statut,feu_vert,devis_total,devis_transport,quote_version,paiement_montant,paiement_date) VALUES
 ('b9300000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001','REL-PAID','paye','autorise',40,40,1,40,now());
INSERT INTO colis(id,client_id,ref,statut,envoi_id) VALUES('b9300000-0000-4000-8000-000000000002','b9200000-0000-4000-8000-000000000001','REL-FRESH','receptionne','b9400000-0000-4000-8000-000000000002');
INSERT INTO payment_intents(colis_id,quote_version,provider_id,payment_url,amount_cents,status,provider_is_live)
 VALUES('b9300000-0000-4000-8000-000000000001',1,'pay_releaseRetention','https://secure.payplug.com/pay/release',4000,'paid',false);
INSERT INTO paiements(colis_id,client_id,montant,methode,reference,statut,provider_id,quote_version,confirme_le)
 VALUES('b9300000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001',40,'payplug','pay_releaseRetention','confirme','pay_releaseRetention',1,now());
INSERT INTO logs_statut(colis_id,ancien_statut,nouveau_statut) VALUES('b9300000-0000-4000-8000-000000000001','attente_paiement','paye');
INSERT INTO messages(id,colis_id,type,auteur_nom,texte,statut,canal) VALUES('b9500000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001','staff','Équipe','Votre paiement est bien reçu.','envoye','telegram');
INSERT INTO notification_outbox(message_id,client_id,colis_id,canal,status,sent_at) VALUES('b9500000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001','telegram','sent',now());
INSERT INTO audit_actions(colis_id,user_nom,action,detail) VALUES('b9300000-0000-4000-8000-000000000001','Mise en service','release_fixture','Entrée de contrôle');
INSERT INTO client_inbox(id,client_id,texte,telegram_update_id,payload,colis_id) VALUES('b9600000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000002','Bonjour',990001,
 '{"message_id":1,"text":"Bonjour"}','b9300000-0000-4000-8000-0000000000ff');
SQL
  sql -c 'CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);'
  # An orphan row: the preflight refuses (the key the release adds would fail), and the release itself would fail.
  preflight orphan
  release 'import json
problems=release.baseline_problems(json.load(open(sys.argv[2])))
if problems!=["orphan rows (a key cannot be added): client_inbox.colis_id=1"]: sys.exit("FAIL: preflight with an orphan "+repr(problems))
print("PASS: the preflight refuses an orphan history row")' "$logs/orphan.json"
  if { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql())'; } | sql 2> "$logs/orphan.log"; then echo 'FAIL: the release passed over an orphan row'; exit 1; fi
  grep -q 'client_inbox_colis_id_fkey' "$logs/orphan.log" || { cat "$logs/orphan.log"; exit 1; }
  # The team puts the message back to the inbox; then the reviewed baseline is accepted.
  sql -c "UPDATE client_inbox SET colis_id=NULL WHERE id='b9600000-0000-4000-8000-000000000001'"
  preflight before
  release 'import json;problems=release.baseline_problems(json.load(open(sys.argv[2])));print("\n".join(problems));sys.exit(1 if problems else 0)' "$logs/before.json"
  release 'import json
current=json.load(open(sys.argv[2]))
reports=current["reports"]
expected={"keys_replaced":["audit_actions.colis_id (c)","com_log.colis_id (n)","logs_statut.colis_id (c)","messages.colis_id (c)","paiements.colis_id (c)",
 "reception_append_receipts.colis_id (c)"],"keys_added":["client_inbox.colis_id"],"dossiers":2,"dossiers_with_history":1,"clients_with_dossiers":1,
 "clients_with_other_history_only":1,"departures_left_without_departed_at":1,"departures_open_with_dossiers":1,"checks_of_confirmed_departures":0,
 "paid_links":1,"final_deliveries":1,"withdrawals_recorded":0,"inbox_attached":0}
if reports!=expected: sys.exit("FAIL: unexpected preflight report "+json.dumps(reports,ensure_ascii=False))
privileges=current["api_privileges"]
if privileges["paiements"]["service_role"]!=["DELETE","TRUNCATE","UPDATE"] or privileges["messages"]["authenticated"]!=["DELETE","TRUNCATE","UPDATE"]:
 sys.exit("FAIL: the production-like privileges are not reported "+json.dumps(privileges))
if any(r["md5"]!=release.UNCHANGED_SOURCE[r["signature"]] for r in current["relied"]): sys.exit("FAIL: relied writers differ from the reviewed replay")
print("PASS: the preflight reports the keys to replace and to add, the privileges to revoke and the history to protect, without changing it")' "$logs/before.json"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql())'; } | sql
  sql -c "DO \$\$ BEGIN IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN ('retention_guard','retention_truncate')) OR to_regprocedure('public._retention_truncate()') IS NOT NULL
   OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261010000001')
   OR (SELECT confdeltype FROM pg_constraint WHERE conname='audit_actions_colis_id_fkey')<>'c' OR EXISTS(SELECT 1 FROM pg_constraint WHERE conname='client_inbox_colis_id_fkey')
   OR NOT has_table_privilege('service_role','paiements','UPDATE') THEN RAISE EXCEPTION 'Rehearsal rollback failed'; END IF;
   RAISE NOTICE 'PASS: preflight accepts the reviewed baseline; the rehearsal keeps business data and rolls back'; END \$\$;"
  { printf 'SET ROLE supabase_admin;\n'; release 'print(release.transaction_sql(True))'; } | sql
  sql -c "DO \$\$ BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261010000001' AND name='history_retention')
   OR (SELECT confdeltype FROM pg_constraint WHERE conname='audit_actions_colis_id_fkey')<>'r' OR (SELECT confdeltype FROM pg_constraint WHERE conname='client_inbox_colis_id_fkey')<>'r'
   OR (SELECT count(*) FROM pg_trigger WHERE tgname IN ('retention_guard','retention_truncate'))<>30 THEN RAISE EXCEPTION 'Release transaction not applied'; END IF;
   RAISE NOTICE 'PASS: the registering release transaction applies the migration'; END \$\$;"
  { printf 'BEGIN;\n'; release 'print(release.POST_CHECKS_SQL)'; printf 'ROLLBACK;\n'; } | sql
  preflight after
  release 'import json
before,after=(json.load(open(path)) for path in sys.argv[2].split(","))
problems=release.baseline_problems(after)
if "version already registered" not in problems or not any(p.startswith("objects of this release already exist") for p in problems): sys.exit("FAIL: second preflight "+repr(problems))
if after["rows"]!=before["rows"] or after["reports"]["keys_replaced"] or after["reports"]["keys_added"] or any(k["on_delete"] not in ("r","a") for k in after["keys"]):
 sys.exit("FAIL: the release changed rows or left a history key cascading")
if any(after["api_privileges"][t][r] for t in release.APPEND_ONLY for r in release.API_ROLES) or any("DELETE" in after["api_privileges"][t][r] for t in release.GUARDED for r in release.API_ROLES):
 sys.exit("FAIL: privileges left to the API roles "+json.dumps(after["api_privileges"]))
print("PASS: a second preflight refuses to apply again; rows unchanged, every history key RESTRICT or NO ACTION, privileges revoked")' "$logs/before.json,$logs/after.json"
  # What carries no history can still go: the fresh dossier, then its planned departure (the suites below plan their own).
  sql -c "UPDATE colis SET envoi_id=NULL WHERE id='b9300000-0000-4000-8000-000000000002'; DELETE FROM colis WHERE id='b9300000-0000-4000-8000-000000000002';
   DELETE FROM envois WHERE id='b9400000-0000-4000-8000-000000000002';"
  continue
 ;; esac
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1; done
sql < "$root/tests/retention.sql"
# Existing suites on the guarded schema with production-like privileges: payments read back, status journal and
# conversations (regressions), loading control with its cascades before the confirmation (loading-checks).
sql < "$root/tests/regressions.sql"
sql < "$root/tests/payment-return.sql"
sql < "$root/tests/loading-checks.sql"
# verify after the suites: the post checks hold (the recorded payment of the release fixture is probed), and refuse a
# guard switched off.
{ printf 'BEGIN;\n'; release 'print(release.POST_CHECKS_SQL)'; printf 'ROLLBACK;\n'; } | sql
if { printf 'BEGIN;\nALTER TABLE paiements DISABLE TRIGGER retention_guard;\n'; release 'print(release.POST_CHECKS_SQL)'; printf 'ROLLBACK;\n'; } | sql 2> "$logs/drift.log"; then
 echo 'FAIL: verify accepted a disabled guard'; exit 1; fi
grep -q 'The row guards differ from the reviewed ones' "$logs/drift.log" || { cat "$logs/drift.log"; exit 1; }
sql -c "DO \$\$ BEGIN RAISE NOTICE 'PASS: verify holds after the suites, and refuses a guard switched off'; END \$\$;"
