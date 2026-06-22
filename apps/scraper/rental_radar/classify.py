"""Assegna il tier a un punto, riusando gli stessi GeoJSON del frontend.

Frontend (Turf) e ingest (qui) leggono gli STESSI file di isocrone, così la
classificazione è sempre coerente. Nessuna dipendenza richiesta: ray casting puro.
"""

from __future__ import annotations

import json
from pathlib import Path

# apps/scraper/rental_radar/classify.py -> repo root
ROOT = Path(__file__).resolve().parents[3]
ISO_DIR = ROOT / "apps" / "web" / "public" / "data"

# dal più stretto al più largo: una casa cade nel primo che la contiene
TIER_ORDER = ["walk30", "transit30", "transit45"]


def _rings(path: Path) -> list[list[tuple[float, float]]]:
    """Estrae gli anelli esterni (lng,lat) dal primo feature di un GeoJSON."""
    if not path.exists():
        return []
    geom = json.loads(path.read_text())["features"][0]["geometry"]
    if geom["type"] == "Polygon":
        polys = [geom["coordinates"]]
    elif geom["type"] == "MultiPolygon":
        polys = geom["coordinates"]
    else:
        return []
    return [[(x, y) for x, y in poly[0]] for poly in polys]


def _point_in_ring(lng: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    """Ray casting standard."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def tiers_bbox(iso_dir: Path = ISO_DIR) -> tuple[float, float, float, float]:
    """Bounding box (south, north, west, east) che racchiude tutti i tier.

    Coincide col bbox del tier più largo (transit45). Serve a interrogare le fonti
    su tutta l'area utile, prima di filtrare per isocrona.
    """
    lats: list[float] = []
    lngs: list[float] = []
    for tier in TIER_ORDER:
        for ring in _rings(iso_dir / f"iso_{tier}.geojson"):
            for x, y in ring:
                lngs.append(x)
                lats.append(y)
    return min(lats), max(lats), min(lngs), max(lngs)


class TierClassifier:
    def __init__(self, iso_dir: Path = ISO_DIR):
        self._rings = {
            tier: _rings(iso_dir / f"iso_{tier}.geojson") for tier in TIER_ORDER
        }

    def classify(self, lat: float, lng: float) -> str:
        for tier in TIER_ORDER:
            for ring in self._rings[tier]:
                if _point_in_ring(lng, lat, ring):
                    return tier
        return "out"


if __name__ == "__main__":
    c = TierClassifier()
    # smoke test: Flatiron stesso deve essere walk30
    print("Flatiron ->", c.classify(40.7411, -73.9897))
    print("Brooklyn far ->", c.classify(40.650, -73.950))
