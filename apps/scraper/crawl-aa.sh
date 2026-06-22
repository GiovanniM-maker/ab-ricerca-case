#!/usr/bin/env bash
# Crawl ApartmentAdvisor (solo stdlib, niente Firecrawl) -> listings.json
#   ./crawl-aa.sh
set -euo pipefail
cd "$(dirname "$0")"

python3 -m rental_radar.run --source apartmentadvisor
python3 -m rental_radar.aggregate apartmentadvisor.snapshot.json

echo
echo "Fatto. Pubblica con:"
echo "  git add -A && git commit -m \"crawl $(date +%F)\" && git push"
