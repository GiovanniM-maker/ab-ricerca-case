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
from datetime import date

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
                "baths": obj.get("numberOfBathroomsTotal"),
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
            raw=_raw_lista(title, g),
        ))
    return out


_NO_FEE = re.compile(r"\bno[- ]?fee\b", re.I)


def _num(v) -> float | None:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return int(n) if n == int(n) else n


def _raw_lista(title: str, g: dict) -> dict:
    """Campi che la lista gia' dice, senza altre richieste: bagni dal JSON-LD
    (se presenti) e "No Fee" quando lo scrive il titolo."""
    raw: dict = {}
    baths = _num(g.get("baths"))
    if baths is not None:
        raw["baths"] = baths
    if _NO_FEE.search(title or ""):
        raw["noFee"] = True
    return raw


# Craigslist e' l'unica fonte che dice dove sta la lavanderia con parole sue,
# sempre le stesse, e che dice anche quando NON c'e'. E' la controprova che
# altrove ci manca: ovunque, il silenzio poteva voler dire entrambe le cose.
_LAVANDERIA = re.compile(
    r"(w/d in unit|laundry in bldg|laundry on site|no laundry on site|w/d hookups)",
    re.I,
)


def amenities_of(listing: Listing) -> list[str]:
    """I servizi dichiarati nella pagina di dettaglio di un annuncio.

    Cerca in tutta la pagina e non solo nel riquadro degli attributi: Craigslist
    cambia spesso il contorno HTML, mentre queste cinque diciture sono un
    vocabolario chiuso suo e non compaiono per caso.
    """
    html = _get(listing.source_url)
    _campi_dettaglio(listing, html)
    return sorted({m.group(1).lower() for m in _LAVANDERIA.finditer(html)})


_POSTED = re.compile(r'posted:\s*<time[^>]*datetime="(\d{4}-\d{2}-\d{2})')
_BATH = re.compile(r"\b\d+\s*BR\s*/\s*(\d+(?:\.\d+)?)\s*Ba\b", re.I)
_BROKER_FEE = re.compile(r"broker fee details:.{0,200}?\bno[- ]?fee\b", re.I | re.S)
_DISP_ADESSO = re.compile(r'class="attr important available-now"', re.I)
_DISP_DATA = re.compile(
    r'class="attr important[^"]*">\s*available\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})\b', re.I)
_MESI = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def _campi_dettaglio(listing: Listing, html: str, oggi: date | None = None) -> None:
    """Bagni, pubblicazione, disponibilita' e No Fee dalla pagina che leggiamo
    comunque per i servizi: nessuna richiesta in piu'. Non sovrascrive la lista."""
    oggi = oggi or date.today()
    raw = listing.raw if listing.raw is not None else {}
    listing.raw = raw
    m = _BATH.search(html)
    if m and raw.get("baths") is None:
        raw["baths"] = _num(m.group(1))
    m = _POSTED.search(html)
    if m and not raw.get("pubblicata"):
        raw["pubblicata"] = m.group(1)
    if _BROKER_FEE.search(html):
        raw["noFee"] = True
    if not raw.get("disponibile"):
        d = _DISP_DATA.search(html)
        mese = _MESI.get(d.group(1)[:3].lower()) if d else None
        if mese:
            giorno = int(d.group(2))
            try:
                data = date(oggi.year, mese, giorno)
                if (oggi - data).days > 60:  # "Jan 5" letto a dicembre = anno dopo
                    data = date(oggi.year + 1, mese, giorno)
                raw["disponibile"] = data.isoformat()
            except ValueError:
                pass
        elif _DISP_ADESSO.search(html):
            # "available now": libera dal giorno in cui l'abbiamo letta
            raw["disponibile"] = oggi.isoformat()


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
