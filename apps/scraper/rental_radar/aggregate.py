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
# Per il solo tie-break di _segna_curati ("a parita' di data vince chi ha una
# fonte viva"): sono le fonti che il giro NON riscarica con costanza e che
# quindi perdono contro una scheda con una fonte fresca. NON e' lo stesso
# insieme di FONTI_COL_BROWSER in apps/web/lib/config.ts (streeteasy, zillow,
# apartments), che decide la scadenza e il peso del dato vecchio: li' anche
# "apartments" e' a intermittenza; qui e' volutamente la fonte che vince.
# "curato" e' la scheda manuale, che non si riscarica mai.
FONTI_FERME = {"streeteasy", "zillow", "curato"}
CURATI = ROOT / "apps" / "scraper" / "curati.json"
LETTI = json.loads((ROOT / "apps" / "web" / "lib" / "affitto_letti.json").read_text())
_LETTI_TITOLO = re.compile(LETTI["titolo"], re.I)
_LETTI_URL = re.compile(LETTI["url"], re.I)

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


# ---- indirizzo canonico (solo per riconoscere i doppioni) --------------------
# NON e' la chiave pubblicata. `_norm_address` resta com'era: la chiave esce nel
# JSON e la wishlist salva `chiave||id` (lib/wishlist.ts, rifDi): cambiarla per
# le case esistenti farebbe perdere le case salvate. Questa forma canonica serve
# solo a confrontare due schede nello stesso giro e a non alterare nulla di cio'
# che e' pubblicato.
_PREFISSO_TITOLO = re.compile(r"^\s*rental open house at\s+", re.I)
_PREFISSO_UNITA = re.compile(r"^\s*(?:unit|apt\.?|apartment|ste|suite)\s+#?(?P<u>[\w-]+)\s+at\s+", re.I)
_CIVICO = re.compile(r"^\d+[a-z]?(?:-\d+)?\b")
_CANON_TOKEN = {
    "street": "st", "st": "st", "str": "st",
    "place": "pl", "pl": "pl",
    "avenue": "ave", "ave": "ave", "av": "ave",
    "road": "rd", "rd": "rd",
    "boulevard": "blvd", "blvd": "blvd",
    "drive": "dr", "dr": "dr",
    "lane": "ln", "ln": "ln",
    "court": "ct", "ct": "ct",
    "square": "sq", "sq": "sq",
    "terrace": "ter", "ter": "ter",
    "parkway": "pkwy", "pkwy": "pkwy",
    "west": "w", "w": "w",
    "east": "e", "e": "e",
    "north": "n", "n": "n",
    "south": "s", "s": "s",
}


def pulisci_titolo(titolo: str | None) -> str | None:
    """Toglie "Rental open house at" dal titolo pubblicato."""
    if not titolo:
        return titolo
    return _PREFISSO_TITOLO.sub("", titolo).strip()


def _canon_address(testo: str | None) -> tuple[str, str] | None:
    """(via canonica, interno) oppure None se non c'e' un civico in testa.

    "Rental open house at 776 Sixth Avenue #17A" e "776 sixth ave" -> ("776 sixth ave", "17a").
    "Unit 2112 at 10 Halletts Point" -> ("10 halletts point", "2112").
    """
    if not testo:
        return None
    t = testo.split(",")[0].lower().strip()
    t = _PREFISSO_TITOLO.sub("", t)
    unita = ""
    m = _PREFISSO_UNITA.match(t)
    if m:
        unita = re.sub(r"[^a-z0-9]", "", m.group("u"))
        t = t[m.end():]
    m = _UNIT.search(t)
    if m:
        unita = unita or re.sub(r"[^a-z0-9]", "", t[m.start():].split("|")[0])
        t = t[: m.start()]
    t = _ORDINAL.sub(r"\1", t)
    t = _PUNCT.sub("", t)
    t = re.sub(r"\s+", " ", t).strip()
    if not _CIVICO.match(t):
        return None
    return " ".join(_CANON_TOKEN.get(w, w) for w in t.split()), unita


def _canon_scheda(l: dict) -> tuple[str, str] | None:
    """Canonico di una scheda gia' pubblicata: dalla chiave ("via|interno"), se
    manca dal titolo."""
    ch = l.get("chiave")
    if ch:
        via, _, unita = ch.partition("|")
        c = _canon_address(via)
        if c:
            return c[0], unita and re.sub(r"[^a-z0-9]", "", unita) or c[1]
    return _canon_address(l.get("title"))


def _sqft_valida(v) -> int | None:
    """Metratura credibile per un appartamento: 80..20000 sqft, altrimenti nulla."""
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if 80 <= n <= 20000 else None


def _id(item: dict) -> str:
    sid = item.get("source_id") or item.get("source_url") or json.dumps(item, sort_keys=True)
    return f"{item.get('source','?')}-{hashlib.sha1(str(sid).encode()).hexdigest()[:10]}"


def _to_public(item: dict) -> dict:
    # ApartmentAdvisor pubblica minRent: per un palazzo con piu' unita' e' un
    # prezzo "a partire da", non il prezzo di quell'appartamento. Va detto.
    raw = item.get("raw") or {}
    unit_count = raw.get("unitCount") or 1
    extra = {}
    # campi opzionali: ci sono solo se la fonte li ha dichiarati
    if raw.get("baths") is not None:
        extra["baths"] = raw["baths"]
    if raw.get("disponibile"):
        extra["disponibile"] = raw["disponibile"]
    if raw.get("pubblicata"):
        extra["pubblicata"] = raw["pubblicata"]
    if raw.get("noFee"):
        extra["noFee"] = True
    return {**extra,
        "id": _id(item),
        "source": item.get("source"),
        "sourceUrl": item.get("source_url"),
        "title": pulisci_titolo(item.get("title")),
        "price": item.get("price"),
        "priceFrom": bool(item.get("price") and unit_count > 1),
        "currency": item.get("currency", "USD"),
        "type": item.get("type"),
        "furnished": item.get("furnished"),
        "sqft": _sqft_valida(item.get("sqft")),
        "lat": item["lat"],
        "lng": item["lng"],
        "photos": item.get("photos", []),
        "amenities": item.get("amenities", []),
        "sources": [item.get("source")],
    }


def _merge(into: dict, other: dict) -> None:
    """Combina `other` in `into`: riempie i campi mancanti, prezzo minimo, furnished OR."""
    # Il prezzo minimo ha senso fra fonti diverse dello STESSO giro: e' il "da"
    # di un palazzo con piu' unita'. Fra ieri e oggi no: se oggi il prezzo e'
    # salito, il minimo terrebbe quello di ieri e mostreremmo un affitto che
    # non esiste piu'. Sulla prima cosa fresca che tocca una casa riportata,
    # quindi, il dato di oggi sostituisce invece di fondersi.
    if into.pop("_riportata", False):
        for f in ("price", "priceFrom", "title", "photos", "type", "sqft", "furnished",
                  "baths", "disponibile", "pubblicata", "noFee"):
            if other.get(f) not in (None, "", []):
                into[f] = other[f]
        into.setdefault("sources", [])
        src = other.get("source")
        if src and src not in into["sources"]:
            into["sources"].append(src)
        return
    if into.get("price") and other.get("price"):
        if into["price"] != other["price"]:
            # prezzi diversi per la stessa chiave: quello mostrato e' il minimo
            into["priceFrom"] = True
        into["price"] = min(into["price"], other["price"])
    else:
        into["price"] = into.get("price") or other.get("price")
    if other.get("priceFrom"):
        into["priceFrom"] = True
    for f in ("type", "sqft", "title", "baths", "disponibile", "pubblicata"):
        if into.get(f) in (None, "") and other.get(f) not in (None, ""):
            into[f] = other[f]
    if other.get("noFee"):
        into["noFee"] = True
    if other.get("furnished"):  # un solo "sì" basta
        into["furnished"] = True
    elif into.get("furnished") is None:
        into["furnished"] = other.get("furnished")
    if not into.get("photos") and other.get("photos"):
        into["photos"] = other["photos"]
    # I servizi si sommano invece di sostituirsi: fonti diverse ne elencano
    # pezzi diversi dello stesso edificio, e tenerne una sola sarebbe uno spreco.
    if other.get("amenities"):
        seen = {a.lower() for a in into.get("amenities", [])}
        into["amenities"] = into.get("amenities", []) + [
            a for a in other["amenities"] if a.lower() not in seen
        ]
    src = other.get("source")
    if src and src not in into["sources"]:
        into["sources"].append(src)


def _riporta(precedenti: list[dict], aggiornate: set[str]) -> list[dict]:
    """Le case del giro precedente che nessuno degli snapshot di oggi copre.

    Serve al crawl automatico su GitHub Actions, che raggiunge solo le fonti
    aperte: senza questo ogni notte cancellerebbe le ~885 case di Trulia e dei
    tre siti anti-bot, che solo il Mac sa scaricare.

    La regola sta tutta in una riga: una casa si porta avanti se ha ALMENO UNA
    fonte che oggi non abbiamo interrogato. Se invece tutte le sue fonti sono
    state riguardate e lei non c'e' piu', e' sparita davvero — l'hanno
    affittata — e sparisce anche dall'elenco. Cosi' la lista si accorcia quando
    deve, invece di riempirsi di fantasmi.
    """
    return [
        l
        for l in precedenti
        if not set(l.get("sources") or [l.get("source")]).issubset(aggiornate)
    ]


def _affitta_letti(l: dict) -> bool:
    return bool(
        _LETTI_TITOLO.search(l.get("title") or "")
        or _LETTI_URL.search(l.get("sourceUrl") or "")
        or "unita:bagno-condiviso" in (l.get("amenities") or [])
    )


def _vicino(l: dict, ed: dict) -> bool:
    # 300 m: le fonti mettono lo stesso palazzo su punti diversi della mappa
    return abs(l["lat"] - ed["lat"]) < 0.003 and abs(l["lng"] - ed["lng"]) < 0.0035


def _stessa_casa(a: dict, b: dict) -> bool:
    """Conservativa: stesso indirizzo canonico, stesso prezzo, stessa tipologia
    (se entrambe la dicono), stessa unita' o unita' assente, posizione vicina."""
    if a.get("curato") or b.get("curato"):
        return False
    ca, cb = _canon_scheda(a), _canon_scheda(b)
    if not ca or not cb or ca[0] != cb[0]:
        return False
    if ca[1] and cb[1] and ca[1] != cb[1]:
        return False
    if not a.get("price") or a.get("price") != b.get("price"):
        return False
    if a.get("type") and b.get("type") and a["type"] != b["type"]:
        return False
    # ~150 m: abbastanza per due fonti sullo stesso palazzo, non per due palazzi
    return abs(a["lat"] - b["lat"]) < 0.0015 and abs(a["lng"] - b["lng"]) < 0.0018


def _fondi_doppioni(listings: list[dict]) -> tuple[list[dict], int]:
    """Fonde le schede che sono la stessa casa vista da due fonti.

    La chiave pubblicata della scheda che resta NON cambia. Quella assorbita
    finisce in `chiaviVecchie` (sua chiave e suo id), cosi' chi l'aveva salvata
    nella wishlist (`chiave||id`) puo' ritrovarla.
    """
    fuori: list[dict] = []
    fusi = 0
    for l in listings:
        gemella = next((t for t in fuori if _stessa_casa(t, l)), None)
        if gemella is None:
            fuori.append(l)
            continue
        # resta quella con una chiave vera, a parita' la prima
        tenuta, persa = (l, gemella) if (l.get("chiave") and not gemella.get("chiave")) else (gemella, l)
        _merge(tenuta, persa)
        tenuta["visto"] = max(tenuta.get("visto") or "", persa.get("visto") or "") or None
        vecchie = list(tenuta.get("chiaviVecchie") or []) + list(persa.get("chiaviVecchie") or [])
        vecchie += [x for x in (persa.get("chiave"), persa.get("id")) if x]
        tenuta["chiaviVecchie"] = [x for i, x in enumerate(vecchie)
                                   if x not in (tenuta.get("chiave"), tenuta.get("id")) and x not in vecchie[:i]]
        if tenuta is l:
            fuori[fuori.index(gemella)] = l
        fusi += 1
    return fuori, fusi


def rifinisci(listings: list[dict]) -> tuple[list[dict], dict]:
    """Pulizie finali, valide anche per le schede riportate da ieri.

    Ritorna le schede e i conteggi di cosa e' stato toccato."""
    conta = {"titoli_puliti": 0, "sqft_azzerate": 0, "titolo_vuoto": 0, "doppioni_fusi": 0}
    out = []
    for l in listings:
        if not l.get("curato") and not (l.get("title") or "").strip():
            conta["titolo_vuoto"] += 1  # scheda senza titolo: non si sa che casa sia
            continue
        t = pulisci_titolo(l.get("title"))
        if t != l.get("title"):
            l["title"] = t
            conta["titoli_puliti"] += 1
        sq = _sqft_valida(l.get("sqft"))
        if sq != l.get("sqft"):
            conta["sqft_azzerate"] += 1
            l["sqft"] = sq
        out.append(l)
    out, conta["doppioni_fusi"] = _fondi_doppioni(out)
    return out, conta


def _segna_curati(listings: list[dict], edifici: list[dict], oggi: str) -> list[dict]:
    """Gli edifici segnalati a mano: una scheda sola, la piu' fresca, marcata.

    Zillow e Apartments danno lo stesso palazzo su due punti diversi e l'indirizzo
    non basta a fonderli. Se nessuna fonte lo ha, la scheda nasce senza prezzo:
    meglio un edificio da guardare a mano che un edificio che manca.
    """
    for ed in edifici:
        nome = ed["nome"].lower()
        gemelle = [l for l in listings if nome in (l.get("title") or "").lower() and _vicino(l, ed)]
        if gemelle:
            # a parita' di data vince chi ha una fonte che oggi viene riscaricata
            tenuta = max(gemelle, key=lambda l: (
                l.get("visto") or "",
                not set(l.get("sources") or []) <= FONTI_FERME,
                l.get("source") != "curato",
            ))
            listings = [l for l in listings if l is tenuta or l not in gemelle]
            tenuta["curato"] = True
            if tenuta.get("source") == "curato":
                tenuta["visto"] = oggi
            continue
        listings.append({
            "id": f"curato-{hashlib.sha1(ed['nome'].encode()).hexdigest()[:10]}",
            "source": "curato",
            "sourceUrl": ed["url"],
            "title": ed["nome"],
            "price": None,
            "priceFrom": False,
            "currency": "USD",
            "type": None,
            "furnished": None,
            "sqft": None,
            "lat": ed["lat"],
            "lng": ed["lng"],
            "photos": [],
            "amenities": [],
            "sources": ["curato"],
            "chiave": None,
            "visto": oggi,
            "curato": True,
        })
    return listings


def main() -> None:
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    # --su-quelle-di-ieri: fondi sopra il listings.json gia' pubblicato invece
    # che sul vuoto. Il crawl completo dal Mac NON lo usa: li' le fonti ci sono
    # tutte e ricostruire da zero e' piu' pulito.
    sopra = "--su-quelle-di-ieri" in sys.argv
    if not argv:
        sys.exit(
            "Uso: python -m rental_radar.aggregate <snapshot.json> [...] "
            "[--su-quelle-di-ieri]"
        )

    by_key: dict[str, dict] = {}
    order: list[str] = []
    # id o chiave -> la chiave con cui la casa sta davvero in by_key
    alias: dict[str, str] = {}

    # Il giorno in cui una casa e' stata vista l'ultima volta su una fonte. Le
    # case riportate da ieri si tengono il loro: e' cosi' che il frontend
    # riconosce quelle che nessuno riguarda da troppo e le toglie da "Tutte".
    oggi = datetime.now(timezone.utc).date().isoformat()

    if sopra and OUT.exists():
        vecchio = json.loads(OUT.read_text())
        # Le schede scritte prima che esistesse "visto" prendono la data del
        # file che le conteneva: e' l'ultima volta che le sappiamo vive.
        visto_prima = (vecchio.get("generatedAt") or oggi)[:10]
        # dal NOME del file ("trulia.snapshot.json" -> "trulia"): ricavarla dal
        # contenuto significherebbe non riconoscere una fonte il cui snapshot e'
        # vuoto, e quindi riportarne le case come se non l'avessimo guardata.
        fonti_di_oggi = {Path(p).name.split(".")[0] for p in argv}
        # --parziali=a,b: fonti che hanno negato l'accesso a meta' giro. Quello
        # che hanno dato aggiorna le schede, le altre restano con la loro data.
        fonti_di_oggi -= {
            f
            for a in sys.argv[1:]
            if a.startswith("--parziali=")
            for f in a.split("=", 1)[1].split(",")
        }
        tenute = _riporta(vecchio.get("listings", []), fonti_di_oggi)
        print(
            f"↺ tengo {len(tenute)} case su {len(vecchio.get('listings', []))} "
            f"dalle fonti non interrogate oggi ({', '.join(sorted(fonti_di_oggi))} sono nuove)"
        )
        for l in tenute:
            key = l.get("chiave") or l["id"]
            if key not in by_key:
                by_key[key] = {**l, "visto": l.get("visto") or visto_prima, "_riportata": True}
                order.append(key)
                # Anche sotto l'id, non solo sotto la chiave. Le schede
                # pubblicate prima che esistesse il campo "chiave" ce l'hanno a
                # None e si indicizzano sull'id: senza questo alias la versione
                # fresca della stessa casa, che una chiave ce l'ha, non le
                # riconoscerebbe e finiremmo con due schede per lo stesso
                # palazzo. Ne avevo contate 12 alla prima prova.
                alias[l["id"]] = key

    for path in argv:
        for it in json.loads(Path(path).read_text()):
            if it.get("lat") is None or it.get("lng") is None:
                continue
            addr = _norm_address(it.get("address_raw"))
            key = addr or _id(it)
            # Si cerca per chiave E per id, in entrambi gli indici: una casa
            # riportata da ieri sta sotto il suo vecchio id, e dopo aver
            # adottato una chiave e' raggiungibile solo dall'alias. Cercando
            # solo per id, la seconda unita' dello stesso palazzo non la
            # trovava e si creava una scheda gemella.
            esistente = key if key in by_key else (alias.get(key) or alias.get(_id(it)))
            if esistente:
                vecchia = by_key[esistente]
                _merge(vecchia, _to_public(it))
                vecchia["visto"] = oggi
                # e da ora in poi la casa ha una chiave vera — ma solo se
                # nessun altro la sta gia' usando. Due unita' dello stesso
                # palazzo arrivate separate dal file di ieri hanno lo stesso
                # indirizzo normalizzato: dando la chiave a entrambe avrebbero
                # la stessa identita', e la wishlist non saprebbe piu' quale
                # delle due hai salvato. Chi resta senza tiene la sua identita'
                # per id, e al primo crawl completo si fondono da sole.
                if not vecchia.get("chiave") and addr and addr not in alias and addr not in by_key:
                    vecchia["chiave"] = addr
                    alias[addr] = esistente
            else:
                rec = _to_public(it)
                # La chiave di merge esce anche nel JSON pubblico: e' l'unico
                # aggancio stabile fra un crawl e il successivo. L'id porta il
                # nome della fonte che ha visto per prima quell'indirizzo, e
                # quando quella fonte perde l'annuncio mentre un'altra ce l'ha
                # ancora, l'id della stessa identica casa cambia: fra due crawl
                # ne evapora il 4-6%, contro il 3% delle chiavi. Chi salva una
                # casa deve poterla ritrovare domani.
                # Resta None per le schede senza civico (~7%): li' non c'e' che
                # l'id, e chi legge deve ripiegare su quello.
                rec["chiave"] = addr
                rec["visto"] = oggi
                by_key[key] = rec
                order.append(key)
                alias[rec["id"]] = key

    listings = [{k: v for k, v in by_key[key].items() if k != "_riportata"} for key in order]
    listings = [l for l in listings if not _affitta_letti(l)]
    listings, conta = rifinisci(listings)
    print("  pulizie: " + ", ".join(f"{k}={v}" for k, v in conta.items()))
    if CURATI.exists():
        listings = _segna_curati(listings, json.loads(CURATI.read_text())["edifici"], oggi)
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
