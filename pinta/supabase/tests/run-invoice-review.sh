#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_INVOICE_REVIEW_DB_CONTAINER:-pinta-invoice-review-db}
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
sql < "$root/tests/invoice-review.sql"
sql < "$root/tests/invoice-context-permissions.sql"
sql < "$root/tests/ocr-document-guard.sql"
sql < "$root/tests/preparation-workspace.sql"
sql < "$root/tests/regressions.sql"
sql < "$root/tests/invoice-review-concurrency.sql"
review() {
 sql <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','ea000000-0000-4000-8000-000000000001',true);
SELECT save_invoice_review(id,token,fichier_url,'[{"desc":"Verified once","qte":1,"prix":100,"cat":"ea000000-0000-4000-8000-000000000004"}]',100,'Vendor') FROM invoice_review_race;
SELECT pg_sleep(0.2);
COMMIT;
SQL
}
review & first_pid=$!
review & second_pid=$!
set +e
wait "$first_pid";first_status=$?
wait "$second_pid";second_status=$?
set -e
if ! { [ "$first_status" -eq 0 ] && [ "$second_status" -eq 3 ]; } && ! { [ "$first_status" -eq 3 ] && [ "$second_status" -eq 0 ]; }; then
 printf 'FAIL: concurrent invoice review must have exactly one success and one conflict\n' >&2
 exit 1
fi
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM lignes WHERE facture_id='ea000000-0000-4000-8000-000000000005')<>1
 OR (SELECT count(*) FROM audit_actions WHERE colis_id='ea000000-0000-4000-8000-000000000003' AND action='invoice_review_confirmed')<>1
 THEN RAISE EXCEPTION 'FAIL: concurrent review duplicated invoice articles or confirmations';END IF;
 RAISE NOTICE 'PASS: two real concurrent reviewers yield one atomic confirmation, one explicit conflict and one article';
END; $$;
SQL
# Two operators may try to keep different originals for the same repeated scan.
# The shared copy token permits one decision, with neither file nor line removed.
sql <<'SQL'
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES
('ea000000-0000-4000-8000-000000000007','ea000000-0000-4000-8000-000000000003','Repeated scan',100,'ea000000-0000-4000-8000-000000000003/copy.jpg',true),
('ea000000-0000-4000-8000-000000000008','ea000000-0000-4000-8000-000000000003','Other original',100,'ea000000-0000-4000-8000-000000000003/other.pdf',true);
INSERT INTO lignes(colis_id,facture_id,description,qte,prix_unitaire,categorie_id) VALUES('ea000000-0000-4000-8000-000000000003','ea000000-0000-4000-8000-000000000007','Copy article to preserve',1,100,'ea000000-0000-4000-8000-000000000004');
CREATE TABLE invoice_duplicate_race AS SELECT 'ea000000-0000-4000-8000-000000000007'::uuid AS copy_id,invoice_review_token('ea000000-0000-4000-8000-000000000007') AS copy_token,
 'ea000000-0000-4000-8000-000000000005'::uuid AS original_a,invoice_review_token('ea000000-0000-4000-8000-000000000005') AS token_a,
 'ea000000-0000-4000-8000-000000000008'::uuid AS original_b,invoice_review_token('ea000000-0000-4000-8000-000000000008') AS token_b;
GRANT SELECT ON invoice_duplicate_race TO authenticated;
SQL
classify_copy() {
 sql <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','ea000000-0000-4000-8000-000000000001',true);
SELECT classify_invoice_duplicate(copy_id,original_$1,copy_token,token_$1) FROM invoice_duplicate_race;
SELECT pg_sleep(0.2);
COMMIT;
SQL
}
classify_copy a & first_pid=$!
classify_copy b & second_pid=$!
set +e
wait "$first_pid";first_status=$?
wait "$second_pid";second_status=$?
set -e
if ! { [ "$first_status" -eq 0 ] && [ "$second_status" -eq 3 ]; } && ! { [ "$first_status" -eq 3 ] && [ "$second_status" -eq 0 ]; }; then
 printf 'FAIL: concurrent duplicate removal must have exactly one success and one conflict\n' >&2
 exit 1
fi
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM audit_actions WHERE colis_id='ea000000-0000-4000-8000-000000000003' AND action='invoice_duplicate_classified' AND after_data->>'proof'='manual')<>1
 OR (SELECT count(*) FROM lignes WHERE facture_id='ea000000-0000-4000-8000-000000000007')<>1
 OR NOT EXISTS(SELECT 1 FROM factures WHERE id='ea000000-0000-4000-8000-000000000007' AND duplicate_of_facture_id IN ('ea000000-0000-4000-8000-000000000005','ea000000-0000-4000-8000-000000000008'))
 OR EXISTS(SELECT 1 FROM factures WHERE id IN ('ea000000-0000-4000-8000-000000000005','ea000000-0000-4000-8000-000000000008') AND duplicate_of_facture_id IS NOT NULL)
 THEN RAISE EXCEPTION 'FAIL: concurrent duplicate classification overwrote a decision or destroyed article history';END IF;
 RAISE NOTICE 'PASS: competing manual duplicate decisions produce one original, one audit and one explicit conflict with articles preserved';
END; $$;
SQL
