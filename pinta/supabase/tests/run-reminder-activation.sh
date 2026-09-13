#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_DB_CONTAINER:-pinta-finalisation-db}
# Exercise the actual migration twice in a rolled-back local transaction.
{
 cat <<'SQL'
BEGIN;
UPDATE app_settings SET value=value||'{"relancesActivesDepuis":"2026-09-01T00:00:00Z"}'::jsonb WHERE key='business';
SQL
 cat "$root/migrations/20260910000013_reminders_activation.sql"
 cat <<'SQL'
DO $$ BEGIN
 IF (SELECT value->>'relancesActivesDepuis' FROM app_settings WHERE key='business')<>'2026-09-01T00:00:00Z' THEN RAISE EXCEPTION 'Existing activation was overwritten'; END IF;
 RAISE NOTICE 'PASS: configured reminder activation is preserved';
END; $$;
UPDATE app_settings SET value=value-'relancesActivesDepuis' WHERE key='business';
SQL
 cat "$root/migrations/20260910000013_reminders_activation.sql"
 cat <<'SQL'
DO $$ BEGIN
 IF (SELECT (value->>'relancesActivesDepuis')::timestamptz FROM app_settings WHERE key='business') IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Missing activation not initialized at deployment'; END IF;
 RAISE NOTICE 'PASS: missing reminder activation uses deployment timestamp';
END; $$;
ROLLBACK;
SQL
} | docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1
