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
    # Zillow chiama il canone baseRent; Apartments.com, che usa JSON-LD,
    # mette una forbice (lowPrice/highPrice o "$1,500 - $3,000").
    "baserent", "lowprice", "minprice", "pricerange", "rentrange",
)
BED_KEYS = (
    "bedrooms", "beds", "bedroomcount", "bedcount", "bed", "numbedrooms",
    "numberofrooms", "numberofbedrooms",
)
SQFT_KEYS = ("sqft", "squarefeet", "livingarea", "size", "squarefootage", "areasqft")
URL_KEYS = (
    "url", "detailurl", "hdpurl", "permalink", "path", "urlpath", "uri",
    "href", "listingurl", "link",
)
PHOTO_KEYS = (
    "imgsrc", "imageurl", "image", "images", "photo", "photos", "thumbnail",
    "heroimageurl", "photourl", "media",
)
ADDR_KEYS = (
    "address", "addressstreet", "streetaddress", "formattedaddress", "fulladdress",
    "displayaddress", "street", "addressline1", "buildingname", "title", "name",
)
ID_KEYS = ("id", "listingid", "zpid", "rentalid", "propertyid")

# Un percorso di dettaglio: "/building/100-w-24-st/12b". Serve quando il campo
# del link ha un nome che non conosciamo.
_PATH = re.compile(r"^/[a-z0-9][\w\-/.]{5,}$", re.I)
# Un indirizzo americano: numero civico seguito da parole. "310 W 20 St".
_ADDR = re.compile(r"^\d+[\w\-]*\s+[A-Za-z]")
FURN_KEYS = ("furnished", "isfurnished")


# --------------------------------------------------------------------------
# 1. tirare fuori ogni JSON annidato nella pagina
# --------------------------------------------------------------------------

def _balanced(s: str, start: int, max_len: int = 8_000_000) -> str | None:
    """Ritaglia l'oggetto/array JSON che inizia a `start`, contando le parentesi.

    Salta virgolette e escape, altrimenti una graffa dentro una stringa
    ("Apt {2}") sballerebbe il conteggio.
    """
    open_c = s[start]
    close_c = "}" if open_c == "{" else "]"
    depth = 0
    in_str = False
    esc = False
    for i in range(start, min(len(s), start + max_len)):
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


# Attributi HTML che contengono JSON: data-listing="{...}". Apartments.com
# mette li' i suoi annunci, uno per scheda, senza passare da nessuno <script>.
_DATA_ATTR = re.compile(r'data-[\w-]*\s*=\s*(["\'])(\s*(?:\{|&\#?\w+;\s*\{).*?)\1', re.S)


def _attr_blobs(html: str) -> list:
    """JSON annidato negli attributi data-*, con le entita' HTML sciolte."""
    from html import unescape

    out = []
    for _, raw in _DATA_ATTR.findall(html):
        txt = unescape(raw).strip()
        if not txt.startswith("{"):
            continue
        try:
            out.append(json.loads(txt))
        except ValueError:
            pass
    return out


# RentHop non ha JSON da nessuna parte: mette ogni campo in un attributo
# separato sullo stesso tag (data-latlng, data-price, data-address).
_TAG_WITH_DATA = re.compile(r"<[a-z][^>]*\sdata-(?:latlng|price|address)[^>]*>", re.I)
_ONE_ATTR = re.compile(r'data-([\w-]+)\s*=\s*"([^"]*)"')


def _tag_attrs(html: str) -> list[dict]:
    """Annunci ricavati dagli attributi data-* di uno stesso tag.

    I pezzi possono stare su tag diversi della stessa scheda (le coordinate
    sul marcatore della mappa, il prezzo sulla card), percio' uniamo quelli
    che dichiarano lo stesso identificativo.
    """
    from html import unescape

    by_id: dict[str, dict] = {}
    loose: list[dict] = []
    for tag in _TAG_WITH_DATA.findall(html):
        d = {k.lower(): unescape(v) for k, v in _ONE_ATTR.findall(tag)}
        if not d:
            continue
        latlng = d.pop("latlng", "")
        if "," in latlng:
            a, b = latlng.split(",")[:2]
            d["latitude"], d["longitude"] = a.strip(), b.strip()
        key = d.get("list-id") or d.get("listing-id") or d.get("alias") or d.get("address")
        if key:
            by_id.setdefault(key, {}).update(d)
        else:
            loose.append(d)
    return list(by_id.values()) + loose


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


# Quanto lontano risalire per trovare l'oggetto che racchiude una chiave.
WINDOW = 20_000

_NEXT_F = re.compile(r'self\.__next_f\.push\(\s*\[\s*1\s*,\s*"')


def _flight(html: str) -> str:
    """Ricompone il payload di Next.js App Router.

    Le app Next moderne non mettono piu' i dati in un unico __NEXT_DATA__: li
    spediscono a pezzi con self.__next_f.push([1,"..."]), ognuno una stringa
    JSON da riunire. Cercare i dati nei singoli <script> non trova nulla, ed e'
    esattamente il caso di StreetEasy.
    """
    parts = []
    for m in _NEXT_F.finditer(html):
        lit = _balanced_string(html, m.end() - 1)
        if not lit:
            continue
        try:
            parts.append(json.loads(lit))
        except ValueError:
            pass
    return "".join(parts)


def _objects_near(text: str, needles: tuple[str, ...]) -> list[dict]:
    """Oggetti-annuncio individuati a partire da una chiave, ovunque si trovino.

    Il payload ricomposto non e' JSON valido nel suo insieme (e' una sequenza
    di frammenti numerati), quindi non si puo' caricare tutto e poi navigarlo:
    si parte dalla chiave e si risale alla graffa che la racchiude.

    E si risale piu' di un livello. Le coordinate stanno spesso in un oggetto
    annidato tutto loro ({"latitude":.., "longitude":..}) mentre prezzo,
    indirizzo e link sono nel genitore: fermandosi al primo si otterrebbero
    due numeri e nient'altro. Saliamo finche' non troviamo l'oggetto che ha
    anche un prezzo, e se non c'e' teniamo il piu' interno.
    """
    out: list[dict] = []
    spans: list[tuple[int, int]] = []

    def enclosing(i: int) -> tuple[dict, tuple[int, int]] | None:
        # Finestra stretta di proposito: un oggetto-annuncio sta in pochi KB,
        # e senza un tetto ogni tentativo andato storto scandirebbe mezzo
        # payload. Con 79 pagine da mezzo mega la differenza e' fra due minuti
        # e un'ora.
        j = i
        limit = max(0, i - WINDOW)
        best = None
        for _ in range(8):
            j = text.rfind("{", limit, j)
            if j < 0:
                break
            frag = _balanced(text, j, WINDOW)
            if not frag or j + len(frag) <= i:
                continue  # non racchiude la chiave: sali ancora
            try:
                obj = json.loads(frag)
            except ValueError:
                continue
            if not isinstance(obj, dict):
                continue
            span = (j, j + len(frag))
            if best is None:
                best = (obj, span)  # ripiego: il piu' interno
            if _price(obj) is not None:
                return obj, span
        return best

    for needle in needles:
        start = 0
        while True:
            i = text.find(needle, start)
            if i < 0:
                break
            start = i + len(needle)
            if any(a <= i < b for a, b in spans):
                continue  # gia' dentro un oggetto che abbiamo preso
            hit = enclosing(i)
            if hit:
                out.append(hit[0])
                spans.append(hit[1])
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
        # Il segno meno va incluso: le longitudini di New York sono tutte
        # negative, e senza questo "-73.99" diventava +73.99, cioe' Pechino.
        # Non emergeva finche' i numeri arrivavano gia' numerici dal JSON.
        m = re.search(r"-?\d[\d,]*(?:\.\d+)?", v)
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
    for key in ("offers", "pricing", "rentrange", "pricerange", "mainentity"):
        inner = _pick(d, (key,))
        if isinstance(inner, list) and inner and isinstance(inner[0], dict):
            inner = inner[0]
        if isinstance(inner, dict):
            v = _num(_pick(inner, PRICE_KEYS + ("min", "low")))
            if v is not None:
                return v
            # JSON-LD annida ancora: offers.offers[0].price
            deeper = _pick(inner, ("offers", "itemoffered"))
            if isinstance(deeper, list) and deeper and isinstance(deeper[0], dict):
                deeper = deeper[0]
            if isinstance(deeper, dict):
                v = _num(_pick(deeper, PRICE_KEYS + ("min", "low")))
                if v is not None:
                    return v
    return None


def _coords(d: dict, depth: int = 0) -> tuple[float, float] | None:
    """Coordinate dell'oggetto, cercate anche nei sotto-oggetti.

    Prima guardavamo un solo livello sotto, e non bastava: Apartments.com le
    mette in mainEntity.geo.latitude, cioe' due livelli piu' in basso, e
    l'annuncio veniva scartato pur avendo prezzo e indirizzo. I nomi dei
    contenitori cambiano da un portale all'altro (latLong, geo, geoPoint...),
    lat e lng no: quindi si scende, senza elencarli.
    """
    lat = _num(_pick(d, LAT_KEYS))
    lng = _num(_pick(d, LNG_KEYS))
    if lat is None or lng is None:
        if depth >= 3:
            return None
        for inner in d.values():
            if isinstance(inner, dict):
                got = _coords(inner, depth + 1)
                if got:
                    return got
        return None
    s, n, w, e = NYC
    if not (s <= lat <= n and w <= lng <= e):
        return None
    return lat, lng


def _pick_shaped(d: dict, rx: re.Pattern, maxlen: int = 120) -> str | None:
    """Primo valore stringa che ha la forma cercata.

    I nomi dei campi cambiano da un portale all'altro e da un restyling
    all'altro; la forma di un indirizzo o di un percorso no. Quando la
    ricerca per nome fallisce, si riconosce il valore invece della chiave.
    """
    for v in d.values():
        if isinstance(v, str) and len(v) <= maxlen and rx.match(v):
            return v
    return None


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

    skipped = 0
    for f in files:
        html = f.read_text("utf-8", "replace")
        # Le pagine-muro pesano pochi KB: sono state salvate da versioni del
        # crawler con un controllo piu' permissivo. Nessun elenco di case e'
        # cosi' piccolo, quindi non c'e' rischio di scartare roba buona.
        if len(html) < 20_000:
            skipped += 1
            continue

        raw: list[dict] = []
        for blob in _blobs(html) + _attr_blobs(html):
            _walk(blob, raw)
        raw += _tag_attrs(html)
        # Next.js App Router spedisce i dati a pezzi via self.__next_f: li
        # ricomponiamo e ci cerchiamo dentro gli oggetti con coordinate.
        flight = _flight(html)
        if flight:
            raw += _objects_near(flight, ('"latitude"', '"lat"'))
        # Rete di sicurezza sull'HTML grezzo. Girava solo se i passaggi
        # precedenti non avevano trovato NIENTE, ma su Zillow i blob rendono
        # una frazione degli annunci: il resto si perdeva in silenzio. I
        # duplicati non sono un problema, piu' avanti si fondono per URL.
        raw += _objects_near(html, ('"latitude"',))

        for d in raw:
            # _objects_near risale ai genitori e puo' restituire oggetti che
            # non hanno ne' coordinate ne' prezzo (il centro della mappa, per
            # dire): qui si scarta, non si da' per scontato.
            coords = _coords(d)
            if coords is None:
                continue
            lat, lng = coords
            price = _price(d)
            if not price or price < 200 or price > 200_000:
                continue  # prezzi di vendita o placeholder: non sono affitti

            url = _pick(d, URL_KEYS)
            if not isinstance(url, str):
                url = _pick_shaped(d, _PATH) or ""
            if url.startswith("/"):
                url = origin + url
            if not url.startswith("http"):
                url = origin

            addr = _pick(d, ADDR_KEYS)
            if isinstance(addr, dict):
                addr = _pick(addr, ADDR_KEYS)
            if not isinstance(addr, str):
                addr = _pick_shaped(d, _ADDR)

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

    if skipped:
        print(f"  ({skipped} pagine scartate: troppo piccole, sono muri o vuote)")
    return list(by_key.values())


def _inspect(source: str) -> None:
    """Cosa c'e' davvero nelle pagine salvate: utile quando un sito cambia forma."""
    folder = PAGES / source
    files = sorted(folder.glob("*.html")) if folder.exists() else []
    print(f"{source}: {len(files)} pagine in {folder}")
    for f in files:
        html = f.read_text("utf-8", "replace")
        if len(html) < 20_000:
            print(f"  {f.name}: {len(html)//1024} KB — muro o pagina vuota, scartata")
            continue
        blobs = _blobs(html) + _attr_blobs(html)
        found: list[dict] = []
        for b in blobs:
            _walk(b, found)
        found += _tag_attrs(html)
        flight = _flight(html)
        if flight:
            found += _objects_near(flight, ('"latitude"', '"lat"'))
        if not found:
            found += _objects_near(html, ('"latitude"',))
        keys = sorted({k for d in found[:20] for k in d if isinstance(k, str)})[:40]
        print(f"  {f.name}: {len(html)//1024} KB · {len(blobs)} blob · {len(flight)} B flight · {len(found)} oggetti")
        if found:
            print(f"    campi: {', '.join(keys)}")


def _sample(source: str, n: int = 2) -> None:
    """Stampa per intero i primi oggetti trovati: quando l'estrazione da zero
    senza un errore, il modo piu' rapido per capire perche' e' guardarli."""
    folder = PAGES / source
    for f in sorted(folder.glob("*.html")):
        html = f.read_text("utf-8", "replace")
        if len(html) < 20_000:
            continue
        found: list[dict] = []
        for b in _blobs(html) + _attr_blobs(html):
            _walk(b, found)
        found += _tag_attrs(html)
        if not found:
            flight = _flight(html)
            found = _objects_near(flight or html, ('"latitude"',))
        print(f"\n=== {f.name}: {len(found)} oggetti ===")
        for d in found[:n]:
            print(json.dumps(d, ensure_ascii=False)[:1200])
            print(f"  -> coords={_coords(d)}  prezzo={_price(d)}")
        return
    print("Nessuna pagina utilizzabile.")


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "streeteasy"
    if "--sample" in sys.argv:
        _sample(arg)
    else:
        _inspect(arg)
