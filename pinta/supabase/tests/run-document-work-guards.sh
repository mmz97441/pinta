#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_DB_CONTAINER:-pinta-finalisation-db}
database=${PINTA_TEST_DATABASE:-postgres}
for test in ocr-document-guard work-action-origin; do
 docker exec -i "$container" psql -q -U postgres -d "$database" -v ON_ERROR_STOP=1 < "$root/tests/$test.sql" > /dev/null
done
