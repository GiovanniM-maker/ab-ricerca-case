#!/usr/bin/env bash
# Flusso completo della mattina per UNA fonte.
#   ./crawl.sh apartmentadvisor
# Richiede Firecrawl raggiungibile (FIRECRAWL_API_URL, default localhost:3002).
set -euo pipefail

SOURCE="${1:-apartmentadvisor}"
cd "$(dirname "$0")"

export FIRECRAWL_API_URL="${FIRECRAWL_API_URL:-http://localhost:3002}"
echo "Firecrawl: $FIRECRAWL_API_URL · fonte: $SOURCE"

python3 -m rental_radar.run --source "$SOURCE"
python3 -m rental_radar.aggregate "${SOURCE}.snapshot.json"

echo
echo "Fatto. Controlla apps/web/public/data/listings.json, poi pubblica:"
echo "  git add -A && git commit -m \"crawl $(date +%F)\" && git push"
