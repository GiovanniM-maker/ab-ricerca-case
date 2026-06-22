"""Fonde gli snapshot delle fonti nel listings.json che il frontend (Vercel) legge.

Flusso della mattina:
    python -m rental_radar.run --source craigslist --url "..."      # -> craigslist.snapshot.json
    python -m rental_radar.run --source apartmentadvisor --url "..." # -> apartmentadvisor.snapshot.json
    python -m rental_radar.aggregate craigslist.snapshot.json apartmentadvisor.snapshot.json
    git add -A && git commit -m "crawl $(date +%F)" && git push   # Vercel ridepoia

Tiene solo gli annunci geocodificati (servono lat/lng). Dedup per chiave fonte e per
indirizzo+prezzo. La cronologia git diventa lo storico prezzi.
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "apps" / "web" / "public" / "data" / "listings.json"


def _id(item: dict) -> str:
    sid = item.get("source_id") or item.get("source_url") or json.dumps(item, sort_keys=True)
    return f"{item.get('source','?')}-{hashlib.sha1(str(sid).encode()).hexdigest()[:10]}"


def _dedup_key(item: dict) -> str:
    addr = (item.get("address_raw") or "").lower().strip()
    return f"{addr}|{item.get('price')}"


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("Uso: python -m rental_radar.aggregate <snapshot.json> [snapshot2.json ...]")

    seen_keys: set[str] = set()
    seen_ids: set[str] = set()
    out: list[dict] = []

    for path in sys.argv[1:]:
        items = json.loads(Path(path).read_text())
        for it in items:
            if it.get("lat") is None or it.get("lng") is None:
                continue  # senza posizione non è mostrabile
            lid = _id(it)
            if lid in seen_ids:
                continue
            dk = _dedup_key(it)
            if dk in seen_keys and it.get("address_raw"):
                continue
            seen_ids.add(lid)
            seen_keys.add(dk)
            out.append({
                "id": lid,
                "source": it.get("source"),
                "sourceUrl": it.get("source_url"),
                "title": it.get("title"),
                "price": it.get("price"),
                "currency": it.get("currency", "USD"),
                "type": it.get("type"),
                "furnished": it.get("furnished"),
                "sqft": it.get("sqft"),
                "lat": it["lat"],
                "lng": it["lng"],
                "photos": it.get("photos", []),
            })

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "note": "Generato da rental_radar.aggregate. Il tier è calcolato dal frontend.",
        "listings": out,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(f"✓ {len(out)} annunci -> {OUT}")


if __name__ == "__main__":
    main()
