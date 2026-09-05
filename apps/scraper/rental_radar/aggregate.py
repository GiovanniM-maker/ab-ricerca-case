"""Fonde gli snapshot delle fonti nel listings.json che il frontend (Vercel) legge.

Flusso della mattina:
    python -m rental_radar.run --source apartmentadvisor
    python -m rental_radar.run --source trulia
    python -m rental_radar.aggregate apartmentadvisor.snapshot.json trulia.snapshot.json
    git add -A && git commit -m "crawl $(date +%F)" && git push   # Vercel ridepoia

Dedup/merge per edificio: la stessa casa vista da piu' fonti diventa UNA scheda,
combinando i campi (es. sqft/furnished di Trulia su una casa di ApartmentAdvisor).
Tiene solo gli annunci geocodificati. La cronologia git e' lo storico prezzi.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "apps" / "web" / "public" / "data" / "listings.json"

_ORDINAL = re.compile(r"\b(\d+)(?:st|nd|rd|th)\b")
_UNIT = re.compile(r"\s*(#|\bapt\b|\bunit\b|\bste\b).*$", re.I)
_PUNCT = re.compile(r"[.,]")


def _norm_address(address_raw: str | None) -> str | None:
    """Chiave di merge: via normalizzata + interno, se presente.

    L'interno fa parte della chiave apposta: unita' diverse dello stesso palazzo
    sono annunci diversi, con prezzi diversi. Fonderle darebbe una scheda che
    mostra il titolo di un'unita' e il prezzo di un'altra.

    Ritorna None se non c'è un civico (es. solo "Brooklyn"): in quel caso l'annuncio
    non è mergeabile per indirizzo e resta unico (fallback su id).
    """
    if not address_raw:
        return None
    street = address_raw.split(",")[0].lower().strip()

    m = _UNIT.search(street)
    unit = ""
    if m:
        unit = re.sub(r"[^a-z0-9]", "", street[m.start():])
        street = street[: m.start()]

    street = _ORDINAL.sub(r"\1", street)  # "16th" -> "16"
    street = _PUNCT.sub("", street)
    street = re.sub(r"\s+", " ", street).strip()
    if not re.search(r"\d", street):  # nessun civico -> non mergeabile
        return None
    return f"{street}|{unit}" if unit else street


def _id(item: dict) -> str:
    sid = item.get("source_id") or item.get("source_url") or json.dumps(item, sort_keys=True)
    return f"{item.get('source','?')}-{hashlib.sha1(str(sid).encode()).hexdigest()[:10]}"


def _to_public(item: dict) -> dict:
    # ApartmentAdvisor pubblica minRent: per un palazzo con piu' unita' e' un
    # prezzo "a partire da", non il prezzo di quell'appartamento. Va detto.
    unit_count = (item.get("raw") or {}).get("unitCount") or 1
    return {
        "id": _id(item),
        "source": item.get("source"),
        "sourceUrl": item.get("source_url"),
        "title": item.get("title"),
        "price": item.get("price"),
        "priceFrom": bool(item.get("price") and unit_count > 1),
        "currency": item.get("currency", "USD"),
        "type": item.get("type"),
        "furnished": item.get("furnished"),
        "sqft": item.get("sqft"),
        "lat": item["lat"],
        "lng": item["lng"],
        "photos": item.get("photos", []),
        "sources": [item.get("source")],
    }


def _merge(into: dict, other: dict) -> None:
    """Combina `other` in `into`: riempie i campi mancanti, prezzo minimo, furnished OR."""
    if into.get("price") and other.get("price"):
        if into["price"] != other["price"]:
            # prezzi diversi per la stessa chiave: quello mostrato e' il minimo
            into["priceFrom"] = True
        into["price"] = min(into["price"], other["price"])
    else:
        into["price"] = into.get("price") or other.get("price")
    if other.get("priceFrom"):
        into["priceFrom"] = True
    for f in ("type", "sqft", "title"):
        if into.get(f) in (None, "") and other.get(f) not in (None, ""):
            into[f] = other[f]
    if other.get("furnished"):  # un solo "sì" basta
        into["furnished"] = True
    elif into.get("furnished") is None:
        into["furnished"] = other.get("furnished")
    if not into.get("photos") and other.get("photos"):
        into["photos"] = other["photos"]
    src = other.get("source")
    if src and src not in into["sources"]:
        into["sources"].append(src)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("Uso: python -m rental_radar.aggregate <snapshot.json> [snapshot2.json ...]")

    by_key: dict[str, dict] = {}
    order: list[str] = []

    for path in sys.argv[1:]:
        for it in json.loads(Path(path).read_text()):
            if it.get("lat") is None or it.get("lng") is None:
                continue
            key = _norm_address(it.get("address_raw")) or _id(it)
            if key in by_key:
                _merge(by_key[key], _to_public(it))
            else:
                by_key[key] = _to_public(it)
                order.append(key)

    listings = [by_key[k] for k in order]
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "note": "Generato da rental_radar.aggregate. Il tier è calcolato dal frontend.",
        "count": len(listings),
        "listings": listings,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(f"✓ {len(listings)} schede (merge per edificio) -> {OUT}")


if __name__ == "__main__":
    main()
