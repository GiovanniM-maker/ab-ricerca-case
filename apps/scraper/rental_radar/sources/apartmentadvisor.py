"""Connettore ApartmentAdvisor — legge il JSON incorporato (__NEXT_DATA__).

Niente Firecrawl, niente LLM, niente geocoding: la pagina di ricerca incorpora un
JSON Next.js con TUTTI gli annunci e le COORDINATE PRECISE. Bastano urllib + json
(solo stdlib), quindi gira ovunque.

Struttura: props.pageProps.initialPageState.entities = dict di case, ognuna con
address{address1,city,state,latitude,longitude}, minRent/maxRent, min/maxBedroomCount,
propertyType, publicID, firstPhoto, priceRating.
"""

from __future__ import annotations

import json
import re
import urllib.request

from rental_radar.models import Listing
from rental_radar.sources.registry import url_for

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
DETAILS = "https://www.apartmentadvisor.com/details/"
_NEXT = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "replace")


def _bedroom_type(e: dict) -> str | None:
    n = e.get("maxBedroomCount")
    if n is None:
        return None
    return "studio" if n == 0 else f"{int(n)}br"


def parse_listings(html: str) -> list[Listing]:
    m = _NEXT.search(html)
    if not m:
        return []
    data = json.loads(m.group(1))
    try:
        ents = data["props"]["pageProps"]["initialPageState"]["entities"]
    except KeyError:
        return []

    out: list[Listing] = []
    for e in ents.values():
        addr = e.get("address") or {}
        lat, lng = addr.get("latitude"), addr.get("longitude")
        if lat is None or lng is None:
            continue
        pid = e.get("publicID")
        photo = (e.get("firstPhoto") or {}).get("baseUrl")
        address_raw = ", ".join(
            x for x in (addr.get("address1"), addr.get("city"), addr.get("state")) if x
        )
        out.append(Listing(
            source="apartmentadvisor",
            source_id=pid,
            source_url=DETAILS + pid if pid else "https://www.apartmentadvisor.com",
            title=(addr.get("address1") or "").title() or None,
            price=e.get("minRent") or e.get("maxRent"),
            type=_bedroom_type(e),
            furnished=None,  # non esposto a livello di ricerca
            sqft=None,
            address_raw=address_raw,
            lat=lat,
            lng=lng,
            photos=[photo] if photo else [],
            raw={
                "priceRating": e.get("priceRating"),
                "priceDropPercent": e.get("priceDropPercent"),
                "minBathroomCount": e.get("minBathroomCount"),
                "propertyType": e.get("propertyType"),
                "availableFrom": e.get("minAvailableFrom"),
            },
        ))
    return out


def fetch_listings(url: str | None = None) -> list[Listing]:
    return parse_listings(fetch_html(url or url_for("apartmentadvisor")))


if __name__ == "__main__":
    items = fetch_listings()
    print(f"{len(items)} annunci")
    for it in items[:5]:
        print(f"  {it.price:>6} | {it.type:<7} | {it.lat:.4f},{it.lng:.4f} | {it.title}")
