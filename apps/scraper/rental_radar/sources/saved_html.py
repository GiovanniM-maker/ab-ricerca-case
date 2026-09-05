"""Estrae annunci dalle pagine HTML salvate da browser/fetch.mjs.

I siti che bloccano gli script (StreetEasy, Zillow, Apartments.com, RentHop)
vengono scaricati con un browser vero sul Mac; qui li leggiamo da disco. Cosi'
il parsing resta dov'e' tutto il resto: Python stdlib, nessuna dipendenza.

Il parser e' volutamente GENERICO. Ogni sito incapsula i risultati in un blob
JSON diverso (__NEXT_DATA__, Apollo, JSON.parse inline, JSON-LD) e la forma
cambia ogni pochi mesi. Invece di inseguire i loro nomi di campo, cerchiamo la
cosa che non possono cambiare: un oggetto con delle coordinate dentro New York.
Da li' raccogliamo prezzo, stanze, metratura e link guardando fra i nomi di
campo che i portali usano davvero.

Diagnostica:
    python3 -m rental_radar.sources.saved_html streeteasy
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from rental_radar.models import Listing

# apps/scraper/rental_radar/sources/saved_html.py -> apps/scraper
SCRAPER = Path(__file__).resolve().parents[2]
PAGES = SCRAPER / "browser" / "pages"

ORIGINS = {
    "streeteasy": "https://streeteasy.com",
    "zillow": "https://www.zillow.com",
    "apartments": "https://www.apartments.com",
    "renthop": "https://www.renthop.com",
}

# Area larga attorno a New York: serve solo a distinguere delle coordinate vere
# da un numero qualsiasi. Il filtro per tier vero e' in run.py.
NYC = (40.35, 41.15, -74.55, -73.55)  # south, north, west, east

_SCRIPT = re.compile(r"<script[^>]*>(.*?)</script>", re.S | re.I)
_JSON_PARSE = re.compile(r'JSON\.parse\(\s*"')

LAT_KEYS = ("latitude", "lat")
LNG_KEYS = ("longitude", "longitude_", "lng", "lon", "long")
PRICE_KEYS = (
    "price", "unformattedprice", "neteffectiveprice", "monthlyrent", "rent",
    "minrent", "rentprice", "priceforhdp", "listedprice", "askingprice",
)
BED_KEYS = (
    "bedrooms", "beds", "bedroomcount", "bedcount", "bed", "numbedrooms",
    "numberofrooms", "numberofbedrooms",
)
SQFT_KEYS = ("sqft", "squarefeet", "livingarea", "size", "squarefootage", "areasqft")
URL_KEYS = ("url", "detailurl", "hdpurl", "permalink", "path", "href", "listingurl", "link")
PHOTO_KEYS = (
    "imgsrc", "imageurl", "image", "images", "photo", "photos", "thumbnail",
    "heroimageurl", "photourl", "media",
)
ADDR_KEYS = (
    "address", "addressstreet", "streetaddress", "formattedaddress", "fulladdress",
    "displayaddress", "title", "name",
)
ID_KEYS = ("id", "listingid", "zpid", "rentalid", "propertyid")
FURN_KEYS = ("furnished", "isfurnished")


# --------------------------------------------------------------------------
# 1. tirare fuori ogni JSON annidato nella pagina
# --------------------------------------------------------------------------

def _balanced(s: str, start: int) -> str | None:
    """Ritaglia l'oggetto/array JSON che inizia a `start`, contando le parentesi.

    Salta virgolette e escape, altrimenti una graffa dentro una stringa
    ("Apt {2}") sballerebbe il conteggio.
    """
    open_c = s[start]
    close_c = "}" if open_c == "{" else "]"
    depth = 0
    in_str = False
    esc = False
    for i in range(start, min(len(s), start + 8_000_000)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return s[start : i + 1]
    return None


def _blobs(html: str) -> list:
    """Tutti i JSON plausibili dentro i tag <script> della pagina."""
    out = []
    for body in _SCRIPT.findall(html):
        body = body.strip()
        if not body:
            continue

        # a) lo script E' JSON: __NEXT_DATA__, application/ld+json
        if body[0] in "{[":
            try:
                out.append(json.loads(body))
                continue
            except ValueError:
                pass

        # b) JSON.parse("...") — Next/Zillow serializzano cosi'
        for m in _JSON_PARSE.finditer(body):
            lit = _balanced_string(body, m.end() - 1)
            if lit is None:
                continue
            try:
                out.append(json.loads(json.loads(lit)))
            except ValueError:
                pass

        # c) window.__QUALCOSA__ = {...}
        for m in re.finditer(r"=\s*([\{\[])", body):
            frag = _balanced(body, m.start(1))
            if not frag or len(frag) < 200:
                continue
            try:
                out.append(json.loads(frag))
            except ValueError:
                pass
    return out


def _balanced_string(s: str, start: int) -> str | None:
    """Ritaglia il letterale di stringa che inizia alla virgoletta in `start`."""
    esc = False
    for i in range(start + 1, len(s)):
        c = s[i]
        if esc:
            esc = False
        elif c == "\\":
            esc = True
        elif c == '"':
            return s[start : i + 1]
    return None


# --------------------------------------------------------------------------
# 2. riconoscere gli oggetti-annuncio
# --------------------------------------------------------------------------

def _num(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = re.search(r"\d[\d,]*(?:\.\d+)?", v)
        if m:
            try:
                return float(m.group(0).replace(",", ""))
            except ValueError:
                return None
    return None


def _pick(d: dict, keys: tuple[str, ...]):
    """Primo valore non vuoto fra `keys` (confronto case-insensitive)."""
    low = {k.lower(): v for k, v in d.items() if isinstance(k, str)}
    for k in keys:
        v = low.get(k)
        if v not in (None, "", [], {}):
            return v
    return None


def _price(d: dict) -> float | None:
    """Prezzo, anche quando sta in un sotto-oggetto (JSON-LD lo mette in offers)."""
    v = _num(_pick(d, PRICE_KEYS))
    if v is not None:
        return v
    for key in ("offers", "pricing", "rentrange", "pricerange"):
        inner = _pick(d, (key,))
        if isinstance(inner, list) and inner and isinstance(inner[0], dict):
            inner = inner[0]
        if isinstance(inner, dict):
            v = _num(_pick(inner, PRICE_KEYS + ("min", "low")))
            if v is not None:
                return v
    return None


def _coords(d: dict) -> tuple[float, float] | None:
    """Coordinate dell'oggetto, anche annidate in latLong/location/coordinate."""
    lat = _num(_pick(d, LAT_KEYS))
    lng = _num(_pick(d, LNG_KEYS))
    if lat is None or lng is None:
        for key in ("latlong", "latlng", "location", "coordinates", "geo", "point"):
            inner = _pick(d, (key,))
            if isinstance(inner, dict):
                lat = _num(_pick(inner, LAT_KEYS))
                lng = _num(_pick(inner, LNG_KEYS))
                if lat is not None and lng is not None:
                    break
    if lat is None or lng is None:
        return None
    s, n, w, e = NYC
    if not (s <= lat <= n and w <= lng <= e):
        return None
    return lat, lng


def _photos(d: dict) -> list[str]:
    v = _pick(d, PHOTO_KEYS)
    urls: list[str] = []
    if isinstance(v, str):
        urls = [v]
    elif isinstance(v, dict):
        urls = [x for x in v.values() if isinstance(x, str) and x.startswith("http")]
    elif isinstance(v, list):
        for x in v:
            if isinstance(x, str):
                urls.append(x)
            elif isinstance(x, dict):
                u = _pick(x, PHOTO_KEYS + ("src", "url", "href"))
                if isinstance(u, str):
                    urls.append(u)
    return [u for u in urls if u.startswith("http")][:5]


def _bed_type(d: dict) -> str | None:
    n = _num(_pick(d, BED_KEYS))
    if n is None:
        return None
    return "studio" if n < 1 else f"{int(n)}br"


def _walk(node, found: list[dict], depth: int = 0) -> None:
    """Scende in tutto il JSON raccogliendo gli oggetti con coordinate NYC."""
    if depth > 30:
        return
    if isinstance(node, dict):
        if _coords(node) and _price(node) is not None:
            found.append(node)
        for v in node.values():
            _walk(v, found, depth + 1)
    elif isinstance(node, list):
        for v in node:
            _walk(v, found, depth + 1)


# --------------------------------------------------------------------------
# 3. API della fonte
# --------------------------------------------------------------------------

def fetch_listings(source: str) -> list[Listing]:
    """Legge browser/pages/<source>/*.html e ne ricava gli annunci."""
    folder = PAGES / source
    files = sorted(folder.glob("*.html")) if folder.exists() else []
    if not files:
        raise SystemExit(
            f"Nessuna pagina in {folder}.\n"
            f"Scaricale prima dal tuo Mac con:\n"
            f"  cd apps/scraper/browser && node fetch.mjs --login {source} && node fetch.mjs {source}"
        )

    origin = ORIGINS.get(source, "")
    by_key: dict[str, Listing] = {}

    for f in files:
        html = f.read_text("utf-8", "replace")
        raw: list[dict] = []
        for blob in _blobs(html):
            _walk(blob, raw)

        for d in raw:
            lat, lng = _coords(d)  # type: ignore[misc]
            price = _price(d)
            if not price or price < 200 or price > 200_000:
                continue  # prezzi di vendita o placeholder: non sono affitti

            url = _pick(d, URL_KEYS)
            url = url if isinstance(url, str) else ""
            if url.startswith("/"):
                url = origin + url
            if not url.startswith("http"):
                url = origin

            addr = _pick(d, ADDR_KEYS)
            if isinstance(addr, dict):
                addr = _pick(addr, ADDR_KEYS)
            addr = addr if isinstance(addr, str) else None

            sid = _pick(d, ID_KEYS)
            furn = _pick(d, FURN_KEYS)
            sqft = _num(_pick(d, SQFT_KEYS))

            key = url if url != origin else f"{lat:.5f},{lng:.5f},{int(price)}"
            prev = by_key.get(key)
            if prev and (prev.sqft or not sqft):
                continue

            by_key[key] = Listing(
                source=source,
                source_url=url,
                source_id=str(sid) if sid is not None else None,
                title=addr,
                price=int(price),
                type=_bed_type(d),
                furnished=bool(furn) if isinstance(furn, bool) else None,
                sqft=int(sqft) if sqft and 80 <= sqft <= 20_000 else None,
                address_raw=addr,
                lat=lat,
                lng=lng,
                photos=_photos(d),
            )

    return list(by_key.values())


def _inspect(source: str) -> None:
    """Cosa c'e' davvero nelle pagine salvate: utile quando un sito cambia forma."""
    folder = PAGES / source
    files = sorted(folder.glob("*.html")) if folder.exists() else []
    print(f"{source}: {len(files)} pagine in {folder}")
    for f in files:
        html = f.read_text("utf-8", "replace")
        blobs = _blobs(html)
        found: list[dict] = []
        for b in blobs:
            _walk(b, found)
        keys = sorted({k for d in found[:20] for k in d if isinstance(k, str)})
        print(f"  {f.name}: {len(html)//1024} KB · {len(blobs)} blob · {len(found)} con coordinate")
        if found:
            print(f"    campi: {', '.join(keys[:22])}")


if __name__ == "__main__":
    _inspect(sys.argv[1] if len(sys.argv) > 1 else "streeteasy")
