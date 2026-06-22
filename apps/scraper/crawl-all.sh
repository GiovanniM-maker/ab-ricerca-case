#!/usr/bin/env bash
# Crawl di tutte le fonti stdlib (no Firecrawl) -> listings.json
#   ./crawl-all.sh
set -euo pipefail
cd "$(dirname "$0")"

# ApartmentAdvisor: tutta l'area dei 3 tier (~1700 case)
python3 -m rental_radar.run --source apartmentadvisor

# Trulia: Flatiron (aggiunge sqft + furnished)
python3 -m rental_radar.run --source trulia || echo "  (Trulia non raggiungibile: salto)"

# Fondi tutti gli snapshot disponibili
python3 -m rental_radar.aggregate apartmentadvisor.snapshot.json trulia.snapshot.json

echo
echo "Fatto. Pubblica con:"
echo "  git add -A && git commit -m \"crawl $(date +%F)\" && git push"
