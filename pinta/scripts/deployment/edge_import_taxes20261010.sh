#!/bin/bash
# Edge functions of the quote wording « Estimation des taxes à l'importation » (2026-10-10).
# The shared message renderer gains the variable {{estimation_taxes}} (_shared/importTaxes.ts, new) and new default
# texts (_shared/messageDefaults.ts, _shared/messageTemplate.ts). Deploy these functions BEFORE the frontend, so a
# server-sent template using the new variable is never refused as unknown. Run only with the user's go-ahead.
# Usage, from the pinta/ folder:  bash scripts/deployment/edge_import_taxes20261010.sh [backup|deploy|compare]
#   backup   download the deployed sources into .deployment-backups/<lot>/edge-before (read-only for production)
#   deploy   deploy the functions in order (writes to production)
#   compare  download into edge-after and compare every file with the committed sources (git HEAD)
# Requires `supabase login` (Supabase CLI) and Docker for bundling. Secrets and PAYPLUG_MODE are never touched.
#
# Functions deployed: every function whose bundle includes a changed _shared file, from the static imports (transitively):
#   _shared/importTaxes.ts (new), _shared/messageDefaults.ts, _shared/messageTemplate.ts
#     <- relances-auto, invoice-quote-withdrawal, client-invoice-deposit, telegram-inbox-assign, telegram-webhook
# The other functions keep their deployed bundle (identical to the repository on 2026-10-10, compare_edge_sources.cjs).
set -euo pipefail
cd "$(dirname "$0")/../.."
REF=bqprktzehuhplpqjgjaz
LOT=../.deployment-backups/2026-10-10-import-taxes
# Order: background worker first, then commands, then Telegram.
FUNCTIONS="relances-auto invoice-quote-withdrawal client-invoice-deposit telegram-inbox-assign telegram-webhook"

download() { # $1 = target folder (edge-before | edge-after)
  local dir="$LOT/$1"; mkdir -p "$dir/supabase"; chmod 700 "$LOT" "$dir"
  for fn in $FUNCTIONS; do
    if supabase --workdir "$dir" functions download "$fn" --project-ref "$REF" >/dev/null 2>"$dir/$fn.download.log"; then echo "downloaded  $fn"
    else echo "not found   $fn (new function, or see $dir/$fn.download.log)"; fi
  done
}

case "${1:-}" in
  backup) download edge-before ;;
  deploy)
    [ -d "$LOT/edge-before/supabase/functions" ] || { echo "Run 'backup' first."; exit 1; }
    for fn in $FUNCTIONS; do echo "== deploy $fn"; supabase functions deploy "$fn" --project-ref "$REF"; done ;;
  compare)
    download edge-after
    status=0
    # The download can be re-emitted by the Deno bundler: compare transpiled code, not bytes (see compare_edge_sources.cjs).
    node scripts/deployment/compare_edge_sources.cjs "$LOT/edge-after/supabase/functions" HEAD || status=1
    for fn in $FUNCTIONS; do [ -f "$LOT/edge-after/supabase/functions/$fn/index.ts" ] || { echo "MISSING     $fn"; status=1; }; done
    exit $status ;;
  *) echo "Usage: bash scripts/deployment/edge_import_taxes20261010.sh [backup|deploy|compare]"; exit 2 ;;
esac
