#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_INVOICE_QUOTE_DB_CONTAINER:-pinta-invoice-quote-rules-db}
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-invoice-quote.XXXXXX")
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi; done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1; done
sql < "$root/tests/invoice-quote-rules.sql"
sql < "$root/tests/invoice-quote-rules-concurrency.sql"
wait_lock() {
 attempt=0
 while [ "$(docker exec "$container" psql -Atq -U postgres -c "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND granted")" != '1' ]; do
  attempt=$((attempt+1));if [ "$attempt" -ge 40 ]; then cat "$logs"/*.log; exit 1; fi;sleep 0.05
 done
}
session() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/$1.log" 2>&1; }
expect_error() { if [ "$1" -ne 3 ] || ! grep -q "$3" "$logs/$2.log"; then cat "$logs"/*.log; exit 1; fi; }
expect_success() { if [ "$1" -ne 0 ] || { [ -n "${3:-}" ] && ! grep -q "$3" "$logs/$2.log"; }; then cat "$logs"/*.log; exit 1; fi; }
staff="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','a8000000-0000-4000-8000-000000000001',true);"
client="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','a8000000-0000-4000-8000-000000000002',true);"
service="SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',true);"
# (a1) The withdrawal (after its PayPlug proof) commits first: the late payment confirmation of the old intent is refused.
session withdrawal_first <<SQL &
BEGIN;SET LOCAL statement_timeout='5s';$staff
SELECT withdraw_quote_for_documents(id,updated_at,'manual_articles') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000001';
SELECT pg_advisory_xact_lock(96001);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 96001
set +e
session late_payment <<SQL
BEGIN;SET LOCAL statement_timeout='5s';$service
SELECT confirm_payplug_payment(payplug_payment_id,id,quote_version,4000,'EUR') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000001';COMMIT;
SQL
result=$?;set -e;wait "$first";expect_error "$result" late_payment '22023:'
# (a2) The payment commits first: the withdrawal finds the dossier frozen and changes nothing.
session payment_first <<SQL &
BEGIN;SET LOCAL statement_timeout='5s';$service
SELECT confirm_payplug_payment(payplug_payment_id,id,quote_version,4000,'EUR') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000002';
SELECT pg_advisory_xact_lock(96002);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 96002
set +e
session late_withdrawal <<SQL
BEGIN;SET LOCAL statement_timeout='5s';$staff
SELECT withdraw_quote_for_documents(id,updated_at,'manual_articles') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000002';COMMIT;
SQL
result=$?;set -e;wait "$first";expect_error "$result" late_withdrawal 'invoices_frozen:payment'
# (b) Two concurrent client deposits share one open request.
session deposit_one <<SQL &
BEGIN;SET LOCAL statement_timeout='5s';$client
SELECT deposit_client_invoice('a8300000-0000-4000-8000-000000000003','a8300000-0000-4000-8000-000000000003/late.pdf','late.pdf');
SELECT pg_advisory_xact_lock(96003);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 96003
set +e
session deposit_two <<SQL
BEGIN;SET LOCAL statement_timeout='5s';$client
SELECT deposit_client_invoice('a8300000-0000-4000-8000-000000000003','a8300000-0000-4000-8000-000000000003/late2.pdf','late2.pdf');COMMIT;
SQL
result=$?;set -e;wait "$first";expect_success "$result" deposit_two
# (c1) The completion commits first: the staff withdrawal on the previous version loses its CAS.
session completion_first <<SQL &
BEGIN;SET LOCAL statement_timeout='5s';$service
SELECT complete_quote_withdrawal(withdrawal_id) FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000004';
SELECT pg_advisory_xact_lock(96004);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 96004
set +e
session late_staff <<SQL
BEGIN;SET LOCAL statement_timeout='5s';$staff
SELECT withdraw_quote_for_documents(id,updated_at,'manual_articles') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000004';COMMIT;
SQL
result=$?;set -e;wait "$first";expect_error "$result" late_staff '40001:'
# (c2) The staff withdrawal commits first and absorbs the request: the completion is idempotent.
session staff_first <<SQL &
BEGIN;SET LOCAL statement_timeout='5s';$staff
SELECT withdraw_quote_for_documents(id,updated_at,'manual_articles') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000005';
SELECT pg_advisory_xact_lock(96005);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 96005
set +e
session late_completion <<SQL
BEGIN;SET LOCAL statement_timeout='5s';$service
SELECT 'COMPLETION-'||(complete_quote_withdrawal(withdrawal_id)->>'status') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000005';COMMIT;
SQL
result=$?;set -e;wait "$first";expect_success "$result" late_completion 'COMPLETION-withdrawn'
# (d) Two processors claim the same request: one claim, the other skips it without waiting.
session claim_one <<SQL &
BEGIN;SET LOCAL statement_timeout='5s';$service
SELECT claim_quote_withdrawal(withdrawal_id) FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000006';
SELECT pg_advisory_xact_lock(96006);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 96006
set +e
session claim_two <<SQL
BEGIN;SET LOCAL statement_timeout='5s';$service
SELECT CASE WHEN claim_quote_withdrawal(withdrawal_id) IS NULL THEN 'SECOND-CLAIM-SKIPPED' ELSE 'SECOND-CLAIM-TAKEN' END FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000006';COMMIT;
SQL
result=$?;set -e;wait "$first";expect_success "$result" claim_two 'SECOND-CLAIM-SKIPPED'
# (e1) The withdrawal commits first: a payment reservation of the old quote is refused.
session withdraw_before_checkout <<SQL &
BEGIN;SET LOCAL statement_timeout='5s';$staff
SELECT withdraw_quote_for_documents(id,updated_at,'manual_articles') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000007';
SELECT pg_advisory_xact_lock(96007);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 96007
set +e
session late_checkout <<SQL
BEGIN;SET LOCAL statement_timeout='5s';$service
SELECT reserve_payplug_intent(id,quote_version,4000,false,repeat('a',64),now()+interval '90 days') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000007';COMMIT;
SQL
result=$?;set -e;wait "$first";expect_error "$result" late_checkout '40001:'
# (e2) The reservation commits first: the withdrawal waits for the link being created.
session checkout_first <<SQL &
BEGIN;SET LOCAL statement_timeout='5s';$service
SELECT reserve_payplug_intent(id,quote_version,4000,false,repeat('b',64),now()+interval '90 days') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000008';
SELECT pg_advisory_xact_lock(96008);SELECT pg_sleep(1);COMMIT;
SQL
first=$!;wait_lock 96008
set +e
session late_withdrawal_after_checkout <<SQL
BEGIN;SET LOCAL statement_timeout='5s';$staff
SELECT withdraw_quote_for_documents(id,updated_at,'manual_articles') FROM iqr_race_baseline WHERE id='a8300000-0000-4000-8000-000000000008';COMMIT;
SQL
result=$?;set -e;wait "$first";expect_error "$result" late_withdrawal_after_checkout 'payment_link_creating'
sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM colis WHERE id='a8300000-0000-4000-8000-000000000001' AND statut='en_preparation' AND paiement_date IS NULL)
  OR EXISTS(SELECT 1 FROM paiements WHERE colis_id='a8300000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL (a1) withdrawal first'; END IF;
 IF NOT EXISTS(SELECT 1 FROM colis WHERE id='a8300000-0000-4000-8000-000000000002' AND statut='paye')
  OR EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id='a8300000-0000-4000-8000-000000000002')
  OR EXISTS(SELECT 1 FROM audit_actions WHERE colis_id='a8300000-0000-4000-8000-000000000002' AND action='quote_withdrawn') THEN RAISE EXCEPTION 'FAIL (a2) payment first'; END IF;
 IF (SELECT count(*) FROM quote_withdrawals WHERE colis_id='a8300000-0000-4000-8000-000000000003')<>1
  OR NOT EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id='a8300000-0000-4000-8000-000000000003' AND status='pending' AND cardinality(facture_ids)=2)
  OR (SELECT count(*) FROM factures WHERE colis_id='a8300000-0000-4000-8000-000000000003' AND NOT valide)<>2 THEN RAISE EXCEPTION 'FAIL (b) concurrent deposits'; END IF;
 IF (SELECT count(*) FROM audit_actions WHERE colis_id='a8300000-0000-4000-8000-000000000004' AND action='quote_withdrawn')<>1
  OR (SELECT count(*) FROM quote_withdrawals WHERE colis_id='a8300000-0000-4000-8000-000000000004')<>1
  OR NOT EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id='a8300000-0000-4000-8000-000000000004' AND status='withdrawn' AND client_message_status='pending') THEN RAISE EXCEPTION 'FAIL (c1) completion first'; END IF;
 IF (SELECT count(*) FROM audit_actions WHERE colis_id='a8300000-0000-4000-8000-000000000005' AND action='quote_withdrawn')<>1
  OR (SELECT count(DISTINCT withdrawn_quote_version) FROM quote_withdrawals WHERE colis_id='a8300000-0000-4000-8000-000000000005')<>1
  OR (SELECT count(*) FROM quote_withdrawals WHERE colis_id='a8300000-0000-4000-8000-000000000005' AND client_message_status='pending')<>1
  OR (SELECT count(*) FROM quote_withdrawals WHERE colis_id='a8300000-0000-4000-8000-000000000005' AND status='withdrawn')<>2 THEN RAISE EXCEPTION 'FAIL (c2) staff first'; END IF;
 IF NOT EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id='a8300000-0000-4000-8000-000000000006' AND status='processing' AND attempts=1) THEN RAISE EXCEPTION 'FAIL (d) one claim'; END IF;
 IF EXISTS(SELECT 1 FROM payment_intents WHERE colis_id='a8300000-0000-4000-8000-000000000007')
  OR NOT EXISTS(SELECT 1 FROM colis WHERE id='a8300000-0000-4000-8000-000000000007' AND statut='en_preparation') THEN RAISE EXCEPTION 'FAIL (e1) withdrawal before checkout'; END IF;
 IF NOT EXISTS(SELECT 1 FROM colis c JOIN iqr_race_baseline b USING(id) WHERE c.id='a8300000-0000-4000-8000-000000000008' AND c.statut='devis_envoye' AND c.updated_at=b.updated_at)
  OR (SELECT count(*) FROM payment_intents WHERE colis_id='a8300000-0000-4000-8000-000000000008' AND status='creating')<>1
  OR EXISTS(SELECT 1 FROM quote_withdrawals WHERE colis_id='a8300000-0000-4000-8000-000000000008') THEN RAISE EXCEPTION 'FAIL (e2) checkout before withdrawal'; END IF;
 RAISE NOTICE 'PASS: real sessions serialise withdrawals with payments, deposits, completions, claims and reservations';
END $$;
SQL
