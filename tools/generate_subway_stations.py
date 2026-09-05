#!/usr/bin/env python3
"""Scarica le stazioni metro MTA e le salva compatte per il frontend.

Output: apps/web/public/data/subway_stations.json  ->  [[lat, lng], ...]

Serve a misurare quanto una casa e' lontana dalla fermata piu' vicina: per gli
annunci raggiungibili solo coi mezzi, avere la metro sotto casa o a 15 minuti
non e' affatto la stessa cosa.

Fonte: MTA Subway Stations (data.ny.gov, dataset 39hk-dx4f).
"""

from __future__ import annotations

import csv
import io
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "web" / "public" / "data" / "subway_stations.json"
URL = "https://data.ny.gov/api/views/39hk-dx4f/rows.csv?accessType=DOWNLOAD"


def main() -> None:
    with urllib.request.urlopen(URL, timeout=60) as resp:
        text = resp.read().decode("utf-8", "replace")

    rows = list(csv.DictReader(io.StringIO(text)))
    seen: set[tuple[float, float]] = set()
    stations: list[list[float]] = []
    for r in rows:
        try:
            lat = round(float(r["GTFS Latitude"]), 5)
            lng = round(float(r["GTFS Longitude"]), 5)
        except (KeyError, TypeError, ValueError):
            continue
        if (lat, lng) in seen:
            continue
        seen.add((lat, lng))
        stations.append([lat, lng])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(stations, separators=(",", ":")))
    print(f"✓ {len(stations)} stazioni -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
