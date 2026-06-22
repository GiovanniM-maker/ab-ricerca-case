#!/usr/bin/env python3
"""Genera i poligoni isocroni attorno a Flatiron e li salva come GeoJSON.

Output: apps/web/public/data/iso_walk30.geojson
        apps/web/public/data/iso_transit30.geojson
        apps/web/public/data/iso_transit45.geojson

DUE MODALITÀ
------------
1) APPROSSIMATA (default, nessuna dipendenza, nessuna rete):
   genera poligoni geodetici (cerchio per il walking, ellisse allungata sull'asse
   nord-sud delle metro per il transit). Servono come PLACEHOLDER per sviluppare
   l'app: la forma è plausibile ma NON è basata su dati di transito reali.

2) WALKING REALE via OpenRouteService (opzionale):
   se la variabile d'ambiente ORS_API_KEY è impostata, il tier `walk30` viene
   generato con l'isocrona pedonale reale di ORS (free tier). I tier transit
   restano approssimati: per quelli serve OpenTripPlanner + GTFS MTA (vedi sotto).

PER LE ISOCRONE TRANSIT REALI
-----------------------------
Il transito dipende dagli orari MTA. Strada consigliata, una tantum e in locale:
  - scarica il GTFS MTA (subway+bus) e l'estratto OSM di NYC
  - avvia OpenTripPlanner, costruisci il grafo
  - chiedi le isochrone (LIsochrone / Traveltime surface) per 30 e 45 min
    all'orario di riferimento in data/flatiron.json (arrive_by)
  - salva i poligoni risultanti al posto di quelli generati qui.
L'app NON cambia: continua a fare point-in-polygon su questi stessi file.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANCHOR_FILE = ROOT / "data" / "flatiron.json"
OUT_DIR = ROOT / "apps" / "web" / "public" / "data"

EARTH_R = 6371000.0  # metri


def destination(lat: float, lng: float, bearing_deg: float, dist_m: float) -> tuple[float, float]:
    """Punto a distanza `dist_m` e rotta `bearing_deg` da (lat,lng) — formula geodetica."""
    br = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lng1 = math.radians(lng)
    dr = dist_m / EARTH_R
    lat2 = math.asin(
        math.sin(lat1) * math.cos(dr) + math.cos(lat1) * math.sin(dr) * math.cos(br)
    )
    lng2 = lng1 + math.atan2(
        math.sin(br) * math.sin(dr) * math.cos(lat1),
        math.cos(dr) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), math.degrees(lng2)


def ellipse_polygon(
    lat: float,
    lng: float,
    radius_ns_m: float,
    radius_ew_m: float,
    steps: int = 96,
) -> list[list[float]]:
    """Anello [lng,lat] di un'ellisse geodetica (semiasse N-S e E-O distinti)."""
    ring: list[list[float]] = []
    for i in range(steps + 1):
        ang = 2 * math.pi * i / steps  # 0 = nord, senso orario
        # punto sull'ellisse in metri, poi proiettato con bearing/distanza
        north = radius_ns_m * math.cos(ang)
        east = radius_ew_m * math.sin(ang)
        dist = math.hypot(north, east)
        bearing = (math.degrees(math.atan2(east, north))) % 360
        plat, plng = destination(lat, lng, bearing, dist)
        ring.append([round(plng, 6), round(plat, 6)])
    return ring


def feature(ring: list[list[float]], props: dict) -> dict:
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def fc(feat: dict) -> dict:
    return {"type": "FeatureCollection", "features": [feat]}


def try_ors_walking(lat: float, lng: float, minutes: int) -> dict | None:
    """Isocrona pedonale reale via OpenRouteService, se ORS_API_KEY è presente."""
    key = os.environ.get("ORS_API_KEY")
    if not key:
        return None
    try:
        import urllib.request

        url = "https://api.openrouteservice.org/v2/isochrones/foot-walking"
        body = json.dumps(
            {"locations": [[lng, lat]], "range": [minutes * 60], "range_type": "time"}
        ).encode()
        req = urllib.request.Request(
            url, data=body, headers={"Authorization": key, "Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        feat = data["features"][0]
        feat["properties"] = {
            "tier": "walk30",
            "label": f"≤ {minutes} min a piedi",
            "mode": "walking",
            "minutes": minutes,
            "source": "openrouteservice",
            "approx": False,
        }
        return {"type": "FeatureCollection", "features": [feat]}
    except Exception as e:  # rete assente / quota: si ricade sull'approssimazione
        print(f"  ORS non disponibile ({e}); uso approssimazione.")
        return None


def main() -> None:
    anchor = json.loads(ANCHOR_FILE.read_text())["anchor"]
    lat, lng = anchor["lat"], anchor["lng"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # --- walk30 -----------------------------------------------------------
    # ~30 min a piedi: a Manhattan ~2.4 km lungo le strade; con detour della
    # griglia il raggio in linea d'aria è ~1.7 km. Leggermente più esteso N-S
    # (isolati corti) che E-O (avenue larghe).
    ors = try_ors_walking(lat, lng, 30)
    walk_path = OUT_DIR / "iso_walk30.geojson"
    if ors:
        walk_path.write_text(json.dumps(ors, indent=2))
        print(f"walk30  -> {walk_path}  (OpenRouteService, reale)")
    else:
        ring = ellipse_polygon(lat, lng, radius_ns_m=1850, radius_ew_m=1550)
        walk_path.write_text(
            json.dumps(
                fc(feature(ring, {
                    "tier": "walk30", "label": "≤ 30 min a piedi", "mode": "walking",
                    "minutes": 30, "source": "approx", "approx": True,
                })),
                indent=2,
            )
        )
        print(f"walk30  -> {walk_path}  (approssimato)")

    # --- transit30 --------------------------------------------------------
    # Coi mezzi in 30 min si copre buona parte di Manhattan e si entra in
    # Brooklyn/Queens lungo le linee: forma allungata sull'asse N-S delle metro.
    ring = ellipse_polygon(lat, lng, radius_ns_m=5200, radius_ew_m=3000)
    (OUT_DIR / "iso_transit30.geojson").write_text(
        json.dumps(
            fc(feature(ring, {
                "tier": "transit30", "label": "≤ 30 min coi mezzi", "mode": "transit",
                "minutes": 30, "source": "approx", "approx": True,
            })),
            indent=2,
        )
    )
    print("transit30 -> iso_transit30.geojson  (approssimato — sostituire con OTP)")

    # --- transit45 --------------------------------------------------------
    ring = ellipse_polygon(lat, lng, radius_ns_m=8500, radius_ew_m=5200)
    (OUT_DIR / "iso_transit45.geojson").write_text(
        json.dumps(
            fc(feature(ring, {
                "tier": "transit45", "label": "≤ 45 min coi mezzi", "mode": "transit",
                "minutes": 45, "source": "approx", "approx": True,
            })),
            indent=2,
        )
    )
    print("transit45 -> iso_transit45.geojson  (approssimato — sostituire con OTP)")


if __name__ == "__main__":
    main()
