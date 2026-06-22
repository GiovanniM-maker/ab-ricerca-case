#!/usr/bin/env python3
"""Verifica di copertura RentCast su Flatiron — SENZA dipendenze (solo stdlib).

Scopo: capire se RentCast ha abbastanza annunci di affitto su Flatiron per essere
la fonte primaria, e se espone davvero lat/lng precise.

USO (in locale, dove la rete non è limitata):
    export RENTCAST_API_KEY="la_tua_key"
    python3 apps/scraper/verify_rentcast.py
    # opzionale: raggio in miglia (default 0.6) e n. risultati di esempio
    python3 apps/scraper/verify_rentcast.py 0.8 50

Consuma 1 sola chiamata API (su 50/mese del free tier).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request

FLATIRON_LAT = 40.741112
FLATIRON_LNG = -73.989723
BASE = "https://api.rentcast.io/v1/listings/rental/long-term"


def main() -> None:
    key = os.environ.get("RENTCAST_API_KEY")
    if not key:
        sys.exit("❌ Imposta RENTCAST_API_KEY prima di lanciare lo script.")

    radius = sys.argv[1] if len(sys.argv) > 1 else "0.6"
    limit = sys.argv[2] if len(sys.argv) > 2 else "50"

    params = urllib.parse.urlencode({
        "latitude": FLATIRON_LAT,
        "longitude": FLATIRON_LNG,
        "radius": radius,
        "status": "Active",
        "limit": limit,
        "offset": 0,
    })
    req = urllib.request.Request(
        f"{BASE}?{params}",
        headers={"X-Api-Key": key, "Accept": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"❌ HTTP {e.code}: {e.read().decode()[:300]}")
    except Exception as e:
        sys.exit(f"❌ Errore di rete: {e}")

    items = data if isinstance(data, list) else data.get("listings", data.get("data", []))
    n = len(items)
    with_coords = sum(1 for it in items if it.get("latitude") and it.get("longitude"))

    print(f"\n=== RentCast — Flatiron, raggio {radius} mi ===")
    print(f"Annunci restituiti      : {n}")
    print(f"…con lat/lng precise     : {with_coords}/{n}")
    print(f"…con prezzo              : {sum(1 for it in items if it.get('price'))}/{n}")
    print(f"…con sqft                : {sum(1 for it in items if it.get('squareFootage'))}/{n}")

    print("\n--- primi 3 esempi ---")
    for it in items[:3]:
        print(json.dumps({
            "address": it.get("formattedAddress"),
            "lat": it.get("latitude"),
            "lng": it.get("longitude"),
            "price": it.get("price"),
            "type": it.get("propertyType"),
            "beds": it.get("bedrooms"),
            "sqft": it.get("squareFootage"),
        }, ensure_ascii=False))

    # salva la risposta grezza per non sprecare un'altra chiamata in analisi
    out = os.path.join(os.path.dirname(__file__), "rentcast_sample.json")
    with open(out, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"\n💾 Risposta grezza salvata in {out} (riusala senza nuove chiamate).")


if __name__ == "__main__":
    main()
