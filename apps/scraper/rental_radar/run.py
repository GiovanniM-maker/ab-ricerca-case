"""Pipeline end-to-end per una fonte HTML via Firecrawl.

  fetch (Firecrawl) -> geocode (Census, se manca lat/lng) -> classify (tier) -> output

USO:
    python -m rental_radar.run --source craigslist \\
        --url "https://newyork.craigslist.org/search/mnh/aap?..."

Richiede un'istanza Firecrawl raggiungibile (FIRECRAWL_API_URL[/KEY]).
Per ora stampa e salva uno snapshot JSON; la scrittura su DB arriva subito dopo.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from rental_radar.classify import TierClassifier
from rental_radar.geocode import geocode
from rental_radar.sources.html_listings import extract_listings
from rental_radar.sources.registry import url_for


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="nome fonte, es. apartmentadvisor")
    ap.add_argument("--url", default=None, help="URL ricerca (default: dal registro)")
    ap.add_argument("--out", default=None, help="file snapshot (default: <source>.snapshot.json)")
    args = ap.parse_args()

    url = args.url or url_for(args.source)
    if not url:
        raise SystemExit(
            f"Nessun URL per '{args.source}'. Passa --url o aggiungilo a sources/registry.py"
        )

    print(f"→ Fetch da {args.source} … ({url})")
    listings = extract_listings(url, args.source)
    print(f"  {len(listings)} annunci estratti")

    classifier = TierClassifier()
    geo_cache: dict = {}
    for lst in listings:
        if not lst.geocoded and lst.address_raw:
            coords = geocode(lst.address_raw, geo_cache)
            if coords:
                lst.lat, lst.lng = coords
        if lst.geocoded:
            lst.tier = classifier.classify(lst.lat, lst.lng)
        else:
            lst.tier = "out"  # senza posizione non classificabile

    tiers = Counter(l.tier for l in listings)
    geocoded = sum(1 for l in listings if l.geocoded)
    print(f"  geocodificati: {geocoded}/{len(listings)}")
    print(f"  per tier: {dict(tiers)}")

    out = Path(args.out or f"{args.source}.snapshot.json")
    out.write_text(json.dumps([asdict(l) for l in listings], indent=2, ensure_ascii=False))
    print(f"💾 snapshot -> {out}")


if __name__ == "__main__":
    main()
