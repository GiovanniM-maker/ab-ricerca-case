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


def _id(item: dict) -> str:
    sid = item.get("source_id") or item.get("source_url") or json.dumps(item, sort_keys=True)
    return f"{item.get('source','?')}-{hashlib.sha1(str(sid).encode()).hexdigest()[:10]}"


def _to_public(item: dict) -> dict:
    # ApartmentAdvisor pubblica minRent: per un palazzo con piu' unita' e' un
    # prezzo "a partire da", non il prezzo di quell'appartamento. Va detto.
    unit_count = (item.get("raw") or {}).get("unitCount") or 1
    return {
        "id": _id(item),
        "source": item.get("source"),
        "sourceUrl": item.get("source_url"),
        "title": item.get("title"),
        "price": item.get("price"),
        "priceFrom": bool(item.get("price") and unit_count > 1),
        "currency": item.get("currency", "USD"),
        "type": item.get("type"),
        "furnished": item.get("furnished"),
        "sqft": item.get("sqft"),
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
        for f in ("price", "priceFrom", "title", "photos", "type", "sqft", "furnished"):
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
    for f in ("type", "sqft", "title"):
        if into.get(f) in (None, "") and other.get(f) not in (None, ""):
            into[f] = other[f]
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

    if sopra and OUT.exists():
        vecchio = json.loads(OUT.read_text())
        # dal NOME del file ("trulia.snapshot.json" -> "trulia"): ricavarla dal
        # contenuto significherebbe non riconoscere una fonte il cui snapshot e'
        # vuoto, e quindi riportarne le case come se non l'avessimo guardata.
        fonti_di_oggi = {Path(p).name.split(".")[0] for p in argv}
        tenute = _riporta(vecchio.get("listings", []), fonti_di_oggi)
        print(
            f"↺ tengo {len(tenute)} case su {len(vecchio.get('listings', []))} "
            f"dalle fonti non interrogate oggi ({', '.join(sorted(fonti_di_oggi))} sono nuove)"
        )
        for l in tenute:
            key = l.get("chiave") or l["id"]
            if key not in by_key:
                by_key[key] = {**l, "_riportata": True}
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
                by_key[key] = rec
                order.append(key)
                alias[rec["id"]] = key

    listings = [{k: v for k, v in by_key[key].items() if k != "_riportata"} for key in order]
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
