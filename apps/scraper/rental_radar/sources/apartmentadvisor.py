"""Connettore ApartmentAdvisor — usa l'API di ricerca interna (/service/search).

La pagina SSR incorpora solo ~12 risultati "above the fold"; gli altri li carica
via POST a /service/search. Noi facciamo lo stesso: leggiamo i parametri di ricerca
dal JSON della pagina (geoID, location) e chiamiamo l'API → TUTTE le ~55 proprietà,
con coordinate precise. Solo stdlib (urllib + json): niente Firecrawl, niente LLM,
niente geocoding.
"""

from __future__ import annotations

import json
import re
import urllib.request

from rental_radar.models import Listing
from rental_radar.sources.registry import url_for

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
ORIGIN = "https://www.apartmentadvisor.com"
DETAILS = ORIGIN + "/details/"
SEARCH_API = ORIGIN + "/service/search"
_NEXT = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "replace")


def _post_json(url: str, body: dict, referer: str) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"User-Agent": UA, "Content-Type": "application/json", "Referer": referer},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def _bedroom_type(e: dict) -> str | None:
    n = e.get("maxBedroomCount")
    if n is None:
        return None
    return "studio" if n == 0 else f"{int(n)}br"


def _to_listing(e: dict) -> Listing | None:
    addr = e.get("address") or {}
    lat, lng = addr.get("latitude"), addr.get("longitude")
    if lat is None or lng is None:
        return None
    pid = e.get("publicID")
    photo = (e.get("firstPhoto") or {}).get("baseUrl")
    address_raw = ", ".join(
        x for x in (addr.get("address1"), addr.get("city"), addr.get("state")) if x
    )
    rent = e.get("minRent") or e.get("maxRent")
    return Listing(
        source="apartmentadvisor",
        source_id=pid,
        source_url=DETAILS + pid if pid else ORIGIN,
        title=(addr.get("address1") or "").title() or None,
        price=int(rent) if rent else None,
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
            "maxBathroomCount": e.get("maxBathroomCount"),
            "unitCount": e.get("unitCount"),
            "availableFrom": e.get("minAvailableFrom"),
        },
    )


def _search_params(html: str) -> dict:
    """Estrae i parametri di ricerca (geoID, location, ...) dal JSON della pagina."""
    m = _NEXT.search(html)
    if not m:
        raise RuntimeError("__NEXT_DATA__ non trovato nella pagina")
    data = json.loads(m.group(1))
    offr = data["props"]["pageProps"]["initialPageState"]["onlyForFetchingResults"]
    params = dict(offr["initialCannedSearch"])
    params["pageSize"] = 90  # una pagina basta per Flatiron
    params["page"] = 0
    return params


def _paginate(params: dict, referer: str, max_pages: int = 40) -> list[Listing]:
    out: list[Listing] = []
    page = 0
    while page < max_pages:
        params["page"] = page
        resp = _post_json(SEARCH_API, dict(params), referer=referer)
        for e in resp.get("results", []):
            lst = _to_listing(e)
            if lst:
                out.append(lst)
        if page + 1 >= (resp.get("pageCount") or 1):
            break
        page += 1
    return out


def fetch_listings(url: str | None = None) -> list[Listing]:
    """Ricerca canonica su Flatiron (~55 case, tutte walk30)."""
    search_url = url or url_for("apartmentadvisor")
    html = _get(search_url)
    return _paginate(_search_params(html), referer=search_url)


def fetch_listings_bbox(
    south: float, north: float, west: float, east: float
) -> list[Listing]:
    """Tutte le case dentro un bounding box (per coprire l'intera area dei 3 tier).

    Restituisce TUTTO ciò che sta nel rettangolo: il filtro per isocrona/tier va
    fatto a valle (run.py) con il classificatore.
    """
    mid_lat = (south + north) / 2
    mid_lng = (west + east) / 2
    params = {
        "canonicalSearch": False,
        "location": {"latitude": mid_lat, "longitude": mid_lng},
        "boundingBox": {
            "latitude": {"min": south, "max": north},
            "longitude": {"min": west, "max": east},
            "midpoint": {"latitude": mid_lat, "longitude": mid_lng},
        },
        "filterState": {},
        "page": 0,
        "pageSize": 90,
        "preferFeatured": False,
        "featuredOnly": False,
        "numSponsored": 0,
        "includePrivate": False,
    }
    return _paginate(params, referer=url_for("apartmentadvisor"))


if __name__ == "__main__":
    items = fetch_listings()
    print(f"{len(items)} annunci")
    for it in items[:8]:
        print(f"  {it.price or 0:>6} | {it.type or '?':<7} | {it.lat:.4f},{it.lng:.4f} | {it.title}")
