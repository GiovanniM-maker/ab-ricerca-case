#!/usr/bin/env bash
# Crawl di tutte le fonti stdlib (no Firecrawl) -> listings.json
#   bash crawl-all.sh
set -uo pipefail
cd "$(dirname "$0")"

# Isocrone sempre allineate al punto di ancoraggio in data/flatiron.json
python3 ../../tools/generate_isochrones.py || echo "  (isocrone: errore, uso quelle esistenti)"

# Stazioni metro: servono a misurare la distanza casa-fermata nel punteggio
python3 ../../tools/generate_subway_stations.py || echo "  (stazioni: errore, uso quelle esistenti)"

# ApartmentAdvisor: tutta l'area dei 3 tier (~1700 case)
python3 -m rental_radar.run --source apartmentadvisor || echo "  (ApartmentAdvisor: errore, salto)"

# Trulia: Flatiron (aggiunge sqft + furnished)
python3 -m rental_radar.run --source trulia || echo "  (Trulia non raggiungibile: salto)"

# Craigslist: sezione appartamenti nell'area di Flatiron
python3 -m rental_radar.run --source craigslist || echo "  (Craigslist non raggiungibile: salto)"

# Fondi tutti gli snapshot disponibili (merge per edificio)
SNAPS=""
for s in apartmentadvisor trulia craigslist; do
  [ -f "${s}.snapshot.json" ] && SNAPS="$SNAPS ${s}.snapshot.json"
done
python3 -m rental_radar.aggregate $SNAPS

echo
echo "Fatto. Pubblica con:"
echo "  git add -A && git commit -m \"crawl $(date +%F)\" && git push"
