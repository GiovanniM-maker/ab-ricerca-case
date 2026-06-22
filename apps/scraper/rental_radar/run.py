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

from rental_radar.classify import TierClassifier, tiers_bbox
from rental_radar.geocode import geocode
from rental_radar.sources import apartmentadvisor
from rental_radar.sources.registry import url_for


def fetch(source: str, url: str, area: bool):
    """Sceglie il connettore. ApartmentAdvisor: parser dedicato (no Firecrawl).

    `area=True` interroga tutta l'area dei 3 tier (bbox), non solo Flatiron.
    """
    if source == "apartmentadvisor":
        if area:
            south, north, west, east = tiers_bbox()
            return apartmentadvisor.fetch_listings_bbox(south, north, west, east)
        return apartmentadvisor.fetch_listings(url)
    # fonti HTML generiche via Firecrawl (import lazy: richiede httpx)
    from rental_radar.sources.html_listings import extract_listings

    return extract_listings(url, source)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="nome fonte, es. apartmentadvisor")
    ap.add_argument("--url", default=None, help="URL ricerca (default: dal registro)")
    ap.add_argument("--out", default=None, help="file snapshot (default: <source>.snapshot.json)")
    ap.add_argument(
        "--canonical",
        action="store_true",
        help="usa la ricerca di quartiere (solo Flatiron) invece dell'area dei 3 tier",
    )
    args = ap.parse_args()

    url = args.url or url_for(args.source)
    if not url:
        raise SystemExit(
            f"Nessun URL per '{args.source}'. Passa --url o aggiungilo a sources/registry.py"
        )

    area = not args.canonical
    print(f"→ Fetch da {args.source} … ({'area 3-tier' if area else url})")
    listings = fetch(args.source, url, area)
    print(f"  {len(listings)} annunci grezzi")

    classifier = TierClassifier()
    geo_cache: dict = {}
    for lst in listings:
        if not lst.geocoded and lst.address_raw:
            coords = geocode(lst.address_raw, geo_cache)
            if coords:
                lst.lat, lst.lng = coords
        lst.tier = classifier.classify(lst.lat, lst.lng) if lst.geocoded else "out"

    # tieni solo le case dentro uno dei 3 tier (scarta "out")
    kept = [l for l in listings if l.tier != "out"]
    listings = kept

    tiers = Counter(l.tier for l in listings)
    print(f"  in-tier: {len(listings)} · per tier: {dict(tiers)}")

    out = Path(args.out or f"{args.source}.snapshot.json")
    out.write_text(json.dumps([asdict(l) for l in listings], indent=2, ensure_ascii=False))
    print(f"💾 snapshot -> {out}")


if __name__ == "__main__":
    main()
