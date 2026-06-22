"""Geocoding indirizzi USA via US Census Geocoder — gratis, senza API key.

Usato per le fonti HTML che danno solo l'indirizzo testuale (non lat/lng).
Cache su file per non ripetere chiamate sullo stesso indirizzo.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path(__file__).resolve().parent / ".geocode_cache.json"
BASE = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"


def _load_cache() -> dict[str, list[float] | None]:
    if CACHE.exists():
        return json.loads(CACHE.read_text())
    return {}


def _save_cache(cache: dict) -> None:
    CACHE.write_text(json.dumps(cache, indent=0))


def geocode(address: str, cache: dict | None = None) -> tuple[float, float] | None:
    """Ritorna (lat, lng) oppure None. Memoizza su file."""
    own = cache is None
    cache = _load_cache() if own else cache
    if address in cache:
        hit = cache[address]
        return (hit[0], hit[1]) if hit else None

    params = urllib.parse.urlencode({
        "address": address,
        "benchmark": "Public_AR_Current",
        "format": "json",
    })
    try:
        with urllib.request.urlopen(f"{BASE}?{params}", timeout=20) as resp:
            data = json.loads(resp.read())
        m = data["result"]["addressMatches"]
        result = [m[0]["coordinates"]["y"], m[0]["coordinates"]["x"]] if m else None
    except Exception:
        result = None

    cache[address] = result
    if own:
        _save_cache(cache)
    return (result[0], result[1]) if result else None
