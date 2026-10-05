#!/bin/bash
# Edge functions of the invoice, quote and payment rules (D1-D4, 2026-10-04).
# Run ONLY after `invoice_quote_rules20261004.py apply` and `verify` succeeded, and only with the user's go-ahead.
# Usage, from the pinta/ folder:  bash scripts/deployment/edge_invoice_quote_rules20261004.sh [backup|deploy|compare]
#   backup   download the deployed sources into .deployment-backups/<lot>/edge-before (read-only for production)
#   deploy   deploy the functions in order (writes to production)
#   compare  download into edge-after and compare every file with the local sources (SHA-256)
# Requires `supabase login` (Supabase CLI) and Docker for bundling. Secrets and PAYPLUG_MODE are never touched.
set -euo pipefail
cd "$(dirname "$0")/../.."
REF=bqprktzehuhplpqjgjaz
LOT=../.deployment-backups/2026-10-04-invoice-quote-rules
# Order: background workers first, then commands, then Telegram, then the public tracking.
FUNCTIONS="relances-auto ocr-facture correct-colis-task invoice-quote-withdrawal client-invoice-deposit telegram-webhook telegram-inbox-assign telegram-inbox-document send-telegram get-tracking"

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
  *) echo "Usage: bash scripts/deployment/edge_invoice_quote_rules20261004.sh [backup|deploy|compare]"; exit 2 ;;
esac
