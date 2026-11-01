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


def _num(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return int(n) if n == int(n) else n


def _data(v) -> str | None:
    """Data ISO (YYYY-MM-DD) da un valore che puo' essere data o datetime."""
    m = re.match(r"\d{4}-\d{2}-\d{2}", str(v or ""))
    return m.group(0) if m else None


_NO_FEE = re.compile(r"\bno[- ]?fee\b", re.I)


def campi_dettaglio(listing: Listing, testo: str) -> None:
    """Pubblicazione e No Fee dal JSON di dettaglio che leggiamo gia' per i
    servizi (nessuna richiesta in piu'). Non sovrascrive quello della ricerca."""
    try:
        prop = json.loads(testo)["pageProps"]["initialPageState"]["activeProperty"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return
    raw = listing.raw if listing.raw is not None else {}
    listing.raw = raw
    unita = prop.get("listedUnits") or []
    if not raw.get("pubblicata"):
        date_ = [_data(u.get("activatedAt")) for u in unita]
        date_ = [d for d in date_ if d] or [d for d in [_data(prop.get("activatedAt"))] if d]
        if date_:
            raw["pubblicata"] = min(date_)
    if not raw.get("disponibile"):
        date_ = [d for d in (_data(u.get("availableFrom")) for u in unita) if d]
        if date_:
            raw["disponibile"] = min(date_)
    if raw.get("baths") is None:
        b = [x for x in (_num(u.get("bathroomCount")) for u in unita) if x is not None]
        if b:
            raw["baths"] = min(b)
    voci = list(prop.get("amenities") or []) + [prop.get("description") or ""]
    voci += [a for u in unita for a in (u.get("amenities") or [])]
    voci += [u.get("description") or "" for u in unita]
    if any(isinstance(v, str) and _NO_FEE.search(v) for v in voci):
        raw["noFee"] = True


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
        # minSqFt/maxSqFt ci sono nella risposta di ricerca (~63% dei risultati):
        # prendiamo il minimo, coerente con minRent.
        sqft=int(e["minSqFt"]) if e.get("minSqFt") else (int(e["maxSqFt"]) if e.get("maxSqFt") else None),
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
            # campi pubblici, gia' nella risposta di ricerca (minimi, come minRent)
            "baths": _num(e.get("minBathroomCount")),
            "disponibile": _data(e.get("minAvailableFrom")),
        },
    )


# I servizi non stanno nella risposta di ricerca — li ho cercati, non ci sono
# proprio come campo. Stanno nel dettaglio, e Next.js lo serve anche come JSON:
# 69 KB invece dei 167 della pagina, con dentro lo stesso "normalizedAmenities".
# Il buildId cambia a ogni loro rilascio, quindi va riletto dalla pagina di
# ricerca che scarichiamo comunque.
_BUILD = re.compile(r'"buildId"\s*:\s*"([^"]+)"')
_NORM = re.compile(r'"normalizedAmenities"\s*:\s*\[([^\]]*)\]')


def build_id(html: str) -> str | None:
    m = _BUILD.search(html)
    return m.group(1) if m else None


# Il palazzo dichiara i servizi per tutti; il testo della singola unita' dice
# com'e' davvero (304 W 30 St: "washer-dryer-in-unit" sull'edificio, e nella
# descrizione una stanza con il bagno in comune). Qui si legge quel testo.
_UNITA_FRASE = re.compile(r"[.!?;\n]+")
_UNITA_LAVATRICE = re.compile(
    r"(washer|w/d|laundry)[^.]{0,40}\bin[- ]?(the )?(unit|apartment|residence|home)\b"
    r"|\bin[- ]?(unit|apartment|home)\b[^.]{0,20}(washer|w/d|laundry)", re.I)
# "Laundry room in the apartment building" e' il palazzo, "hookups" sono solo gli
# attacchi (come SOLO_ATTACCHI in listings.ts): nessuno dei due e' una lavatrice.
_UNITA_NON_IN_CASA = re.compile(
    r"\b(building|complex|basement|community|shared|common|coin|hook[- ]?ups?|room)\b", re.I)
_NEGAZIONE = re.compile(r"\b(no|not|without|never|private)\b", re.I)
_UNITA_LAVANDERIA_EDIFICIO = re.compile(
    r"(laundry|washers?( and dryers?)?)[^.]{0,30}\b(building|complex|basement|on[- ]?site|every floor|each floor)\b"
    r"|\b(shared|common|coin)[- ](laundry|washers?)|laundry (room|facilit)", re.I)
_UNITA_BAGNO_CONDIVISO = re.compile(
    r"\bshared (bath|bathroom|kitchen)\b|\bshares? (a |the )?(bath|bathroom)\b|\bbath(room)? (is )?shared\b", re.I)


def _frasi(testo: str) -> list[str]:
    return [f for f in _UNITA_FRASE.split(testo) if f.strip()]


def _dice_bagno_condiviso(testo: str) -> bool:
    # Scarta una casa: nel dubbio ("Private bath, not shared") non lo dice.
    return any(_UNITA_BAGNO_CONDIVISO.search(f) and not _NEGAZIONE.search(f) for f in _frasi(testo))


def _dice_lavatrice(testo: str) -> bool:
    return any(_UNITA_LAVATRICE.search(f) and not _UNITA_NON_IN_CASA.search(f)
               and not _NEGAZIONE.search(f) for f in _frasi(testo))


def segnali_unita(descrizioni: list[str]) -> list[str]:
    """Che cosa dicono i testi delle unita', come voci in piu' fra i servizi.

    Bagno condiviso e lavatrice valgono solo se lo dicono TUTTE le unita'
    dell'annuncio: con unita' diverse la casa resta "da verificare".
    """
    testi = [d for d in descrizioni if d and d.strip()]
    if not testi:
        return []
    segni = []
    if all(_dice_bagno_condiviso(t) for t in testi):
        segni.append("unita:bagno-condiviso")
    if all(_dice_lavatrice(t) for t in testi):
        segni.append("unita:lavatrice")
    elif not any(_dice_lavatrice(t) for t in testi) and any(
            _UNITA_LAVANDERIA_EDIFICIO.search(t) for t in testi):
        segni.append("unita:lavanderia-edificio")
    return segni


def _descrizioni(testo: str) -> list[str]:
    """I testi delle unita' dell'annuncio, dal JSON del dettaglio."""
    try:
        prop = json.loads(testo)["pageProps"]["initialPageState"]["activeProperty"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return []
    return [u.get("description") or "" for u in prop.get("listedUnits") or []]


def amenities_of(listing: Listing, build: str) -> list[str]:
    """I servizi normalizzati di un annuncio, dal JSON della pagina di dettaglio.

    Il vocabolario e' loro e sta in minuscolo con i trattini: washer-dryer,
    washer-dryer-in-unit, dishwasher, elevator... A noi interessano i primi due,
    e il terzo e' proprio quello da non confondere. In coda i segni letti dal
    testo delle unita' (segnali_unita).
    """
    slug = listing.source_url.rstrip("/").rsplit("/", 1)[-1]
    url = f"{ORIGIN}/_next/data/{build}/details/{slug}.json?listingId={slug}"
    testo = _get(url)
    campi_dettaglio(listing, testo)
    return sorted({
        v.strip().strip('"')
        for blob in _NORM.findall(testo)
        for v in blob.split(",")
        if v.strip().strip('"')
    }) + segnali_unita(_descrizioni(testo))


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
