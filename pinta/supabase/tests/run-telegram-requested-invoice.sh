#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_TELEGRAM_INVOICE_DB_CONTAINER:-pinta-telegram-invoice-db}
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1' EXIT
attempt=0
until docker exec "$container" pg_isready -U postgres > /dev/null 2>&1; do
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
# Reapplying the isolated additive fix is safe, including its grants.
{ printf 'SET ROLE supabase_admin;\n';cat "$root/migrations/20260914000001_telegram_requested_invoice.sql"; } | sql -1
sql < "$root/tests/telegram-requested-invoice.sql"
# Two independent deliveries race to fulfil one invoice request. The dossier
# lock permits one invoice and keeps the other document in the conversation.
sql <<'SQL'
INSERT INTO clients(id,nom,prenom,cp,type) VALUES('d2100000-0000-4000-8000-000000000001','Concurrence facture','Test','97400','particulier');
INSERT INTO colis(id,client_id,statut,feu_vert) VALUES('d2200000-0000-4000-8000-000000000001','d2100000-0000-4000-8000-000000000001','autorise','autorise');
INSERT INTO messages(colis_id,type,canal,template,statut,texte,created_at)
VALUES('d2200000-0000-4000-8000-000000000001','staff','telegram','facture_manquante','envoye','Demande test',now()-interval '1 hour');
INSERT INTO messages(id,colis_id,type,canal,texte,attachment_path,attachment_type)
VALUES('d2300000-0000-4000-8000-000000000001','d2200000-0000-4000-8000-000000000001','client','telegram','Facture A','d2200000-0000-4000-8000-000000000001/a.pdf','application/pdf'),
('d2300000-0000-4000-8000-000000000002','d2200000-0000-4000-8000-000000000001','client','telegram','Facture B','d2200000-0000-4000-8000-000000000001/b.pdf','application/pdf');
SQL
register() {
 sql <<SQL
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT register_requested_invoice('$1');
SELECT pg_sleep(0.2);
COMMIT;
SQL
}
register d2300000-0000-4000-8000-000000000001 & first_pid=$!
register d2300000-0000-4000-8000-000000000002 & second_pid=$!
wait "$first_pid"
wait "$second_pid"
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM factures WHERE colis_id='d2200000-0000-4000-8000-000000000001')<>1
 OR (SELECT count(*) FROM audit_actions WHERE colis_id='d2200000-0000-4000-8000-000000000001' AND action='telegram_requested_invoice')<>1
 OR (SELECT count(*) FROM messages WHERE colis_id='d2200000-0000-4000-8000-000000000001' AND attachment_path IS NOT NULL)<>2
 THEN RAISE EXCEPTION 'FAIL: concurrent documents did not fulfil exactly one request'; END IF;
 RAISE NOTICE 'PASS: two concurrent documents create one requested invoice, one audit, and preserve both attachments';
END; $$;
SQL
