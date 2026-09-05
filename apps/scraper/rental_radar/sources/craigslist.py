"""Connettore Craigslist — sezione appartamenti (newyork.craigslist.org/search/apa).

Craigslist serve una lista statica (titolo, prezzo, link) + un blocco JSON-LD
(coordinate precise, camere, indirizzo). Li unisco per titolo → annuncio completo.
Solo stdlib. Filtro di distanza attorno a Flatiron; il tier lo assegna run.py.

Note: molti post Craigslist espongono lat/lng solo se chi pubblica abilita la mappa;
quelli senza coordinate vengono scartati a valle (servono per il tier).
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request

from rental_radar.models import Listing

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
ORIGIN = "https://newyork.craigslist.org"
SEARCH = ORIGIN + "/search/apa"
FLAT_LAT, FLAT_LNG = 40.7411, -73.9897

_LDJSON = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.S)
_RESULT = re.compile(
    r'<li class="cl-static-search-result"[^>]*title="(?P<title>[^"]*)">.*?'
    r'<a href="(?P<url>[^"]+)".*?'
    r'<div class="price">(?P<price>[^<]*)</div>',
    re.S,
)


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "replace")


def _price(s: str) -> int | None:
    m = re.search(r"[\d,]+", s or "")
    return int(m.group(0).replace(",", "")) if m else None


def _bedroom_type(n) -> str | None:
    if n is None:
        return None
    try:
        n = int(n)
    except (TypeError, ValueError):
        return None
    return "studio" if n == 0 else f"{n}br"


def _geo_by_name(html: str) -> dict[str, dict]:
    """dict: titolo annuncio -> {lat, lng, beds, locality} dal JSON-LD."""
    out: dict[str, dict] = {}
    for block in _LDJSON.findall(html):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        items = data.get("itemListElement") if isinstance(data, dict) else None
        if not items:
            continue
        for it in items:
            obj = it.get("item", it)
            name = obj.get("name")
            if not name or obj.get("latitude") is None:
                continue
            out[name] = {
                "lat": obj.get("latitude"),
                "lng": obj.get("longitude"),
                "beds": obj.get("numberOfBedrooms"),
                "locality": (obj.get("address") or {}).get("addressLocality"),
            }
    return out


def parse_listings(html: str) -> list[Listing]:
    geo = _geo_by_name(html)
    out: list[Listing] = []
    seen: set[str] = set()
    for m in _RESULT.finditer(html):
        title = m.group("title").strip()
        url = m.group("url")
        g = geo.get(title)
        if not g or g["lat"] is None:
            continue  # senza coordinate non è classificabile
        pid_m = re.search(r"/([0-9]+)\.html$", url) or re.search(r"/([A-Za-z0-9]+)$", url)
        sid = pid_m.group(1) if pid_m else url
        if sid in seen:
            continue
        seen.add(sid)
        out.append(Listing(
            source="craigslist",
            source_id=sid,
            source_url=url,
            title=title,
            price=_price(m.group("price")),
            type=_bedroom_type(g["beds"]),
            furnished=None,
            sqft=None,
            address_raw=g.get("locality"),
            lat=g["lat"],
            lng=g["lng"],
            photos=[],
        ))
    return out


def fetch_listings(search_distance_mi: float = 6.0) -> list[Listing]:
    params = urllib.parse.urlencode({
        "lat": FLAT_LAT,
        "lon": FLAT_LNG,
        "search_distance": search_distance_mi,
    })
    return parse_listings(_get(f"{SEARCH}?{params}"))


if __name__ == "__main__":
    items = fetch_listings()
    print(f"{len(items)} appartamenti con coordinate")
    for it in items[:8]:
        print(f"  {it.price or 0:>6} | {it.type or '?':<6} | {it.lat:.4f},{it.lng:.4f} | {it.title[:50]}")
