"""Connettore Trulia — legge __NEXT_DATA__ (props.searchData.homes).

Copre i buchi di ApartmentAdvisor: oltre a prezzo/coordinate/foto fornisce
- floorSpace -> sqft
- furnished come TAG strutturato (tags[].formattedName == "FURNISHED")

Solo stdlib. NB: Trulia è del gruppo Zillow: da alcuni IP può rispondere 403
(anti-bot). In quel caso si passa per Firecrawl, ma il parsing del JSON resta questo.
"""

from __future__ import annotations

import json
import re
import urllib.request

from rental_radar.models import Listing
from rental_radar.sources.registry import url_for

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
ORIGIN = "https://www.trulia.com"
_NEXT = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)
_NUM = re.compile(r"\d[\d,]*")


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "replace")


def _first_int(s: str | None) -> int | None:
    if not s:
        return None
    m = _NUM.search(s)
    return int(m.group(0).replace(",", "")) if m else None


def _is_furnished(home: dict) -> bool:
    for key in ("tags", "fullTags", "markerTags"):
        for t in home.get(key) or []:
            if str(t.get("formattedName", "")).upper() == "FURNISHED":
                return True
    return False


def _bedroom_type(home: dict) -> str | None:
    b = home.get("bedrooms") or {}
    # unità singola: {"value": N}; edificio: {"min": N, "max": M}
    n = b.get("value")
    if n is None:
        n = b.get("min")
    if n is None:
        n = b.get("max")
    if n is None:
        return None
    return "studio" if n == 0 else f"{int(n)}br"


def _photo(home: dict) -> list[str]:
    url = (((home.get("media") or {}).get("heroImage") or {}).get("url") or {})
    u = url.get("medium") or url.get("small")
    return [u] if u else []


def _to_listing(home: dict) -> Listing | None:
    loc = home.get("location") or {}
    coords = loc.get("coordinates") or {}
    lat, lng = coords.get("latitude"), coords.get("longitude")
    if lat is None or lng is None:
        return None
    rel = home.get("url") or ""
    return Listing(
        source="trulia",
        source_id=home.get("providerListingId") or home.get("typedHomeId"),
        source_url=ORIGIN + rel if rel.startswith("/") else (rel or ORIGIN),
        title=loc.get("communityLocation") or loc.get("partialLocation") or loc.get("streetAddress"),
        price=_first_int((home.get("price") or {}).get("formattedPrice")),
        type=_bedroom_type(home),
        furnished=_is_furnished(home),
        sqft=_first_int((home.get("floorSpace") or {}).get("formattedDimension")),
        address_raw=loc.get("fullLocation"),
        lat=lat,
        lng=lng,
        photos=_photo(home),
        raw={"providerListingId": home.get("providerListingId")},
    )


def parse_listings(html: str) -> list[Listing]:
    m = _NEXT.search(html)
    if not m:
        return []
    data = json.loads(m.group(1))
    homes = (((data.get("props") or {}).get("searchData") or {}).get("homes")) or []
    out: list[Listing] = []
    for h in homes:
        lst = _to_listing(h)
        if lst:
            out.append(lst)
    return out


def fetch_listings(url: str | None = None) -> list[Listing]:
    return parse_listings(_get(url or url_for("trulia")))


if __name__ == "__main__":
    items = fetch_listings()
    print(f"{len(items)} annunci")
    for it in items[:8]:
        f = "arred" if it.furnished else "-"
        print(f"  {it.price or 0:>6} | {it.type or '?':<6} | {str(it.sqft or '?'):>5}ft | {f:<5} | {it.title}")
