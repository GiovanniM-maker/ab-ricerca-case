"""I servizi dell'edificio, presi dalle pagine di dettaglio e ricordati.

Perche' esiste questo file: la lavanderia decide se una casa vale la pena, ma
nessuna delle pagine di ricerca la dice. Sta solo nel dettaglio, una pagina per
annuncio — 1660 per ApartmentAdvisor. Scaricarle tutte ogni mattina sarebbe
un'ora di rete per ripetere quello che gia' sapevamo: i servizi di un palazzo
non cambiano da un giorno all'altro.

Quindi si ricordano. La cache sta nel repo perche' il crawl gira in due posti —
il tuo Mac e GitHub Actions — e senza un posto condiviso il runner ripartirebbe
ogni volta da zero. E' un file di testo di qualche centinaio di KB: per git non
e' niente, e la sua storia racconta anche quando un palazzo aggiunge la
lavanderia.

Ogni giro ha un tetto di richieste nuove. La prima volta ci vogliono quattro o
cinque giri per riempire il catalogo; dopo, si paga solo per le case comparse
nel frattempo.
"""

from __future__ import annotations

import json
import random
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable

from rental_radar.models import Listing

CACHE = Path(__file__).resolve().parents[1] / "servizi-cache.json"

# Un palazzo non cambia i servizi in un mese. Riguardarli piu' spesso sarebbe
# rete buttata; molto piu' di rado, ci perderemmo le ristrutturazioni.
VALIDA_GIORNI = 30
# Un annuncio che non risponde (scaduto, rimosso) non va ritentato domani: si
# riprende fra una settimana, cosi' non mangia il tetto tutte le mattine.
RIPROVA_FALLITI_GIORNI = 7
# Ogni quante pagine nuove si scrive su disco. La cache si salvava solo alla
# fine, e un giro interrotto a meta' — timeout di CI, rete caduta, Mac chiuso —
# buttava via tutte le pagine gia' scaricate. Salvare ogni tanto costa una
# scrittura da poche centinaia di KB e rende il lavoro non sorvegliato ripartibile.
SALVA_OGNI = 25


def _carica() -> dict[str, dict]:
    try:
        return json.loads(CACHE.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _salva(c: dict[str, dict]) -> None:
    CACHE.write_text(json.dumps(c, indent=0, sort_keys=True, ensure_ascii=False))


def _scaduta(voce: dict) -> bool:
    giorni = RIPROVA_FALLITI_GIORNI if voce.get("ko") else VALIDA_GIORNI
    try:
        quando = datetime.fromisoformat(voce["il"]).date()
    except (KeyError, ValueError):
        return True
    return date.today() - quando > timedelta(days=giorni)


def arricchisci(
    listings: Iterable[Listing],
    fonte: str,
    leggi_uno: Callable[[Listing], list[str]],
    max_nuovi: int = 400,
    pausa: tuple[float, float] = (1.2, 2.8),
) -> tuple[int, int]:
    """Riempie `amenities` leggendo il dettaglio, con cache e tetto di richieste.

    `leggi_uno` riceve un annuncio e torna la lista dei suoi servizi; se solleva
    un'eccezione, l'annuncio finisce fra i falliti e si riprova la settimana
    dopo. Torna (quanti presi dalla rete, quanti serviti dalla cache).
    """
    cache = _carica()
    dal_web = dalla_cache = 0
    oggi = date.today().isoformat()

    for l in listings:
        chiave = f"{fonte}:{l.source_id or l.source_url}"
        voce = cache.get(chiave)
        if voce and not _scaduta(voce):
            if voce.get("a"):
                l.amenities = list(voce["a"])
            dalla_cache += 1
            continue
        if dal_web >= max_nuovi:
            continue  # il tetto e' per oggi: domani si riprende da qui
        try:
            servizi = leggi_uno(l)
            cache[chiave] = {"a": servizi, "il": oggi}
            if servizi:
                l.amenities = servizi
        except Exception:
            # Non sappiamo se l'annuncio e' sparito o se la rete ha singhiozzato,
            # e non importa: in entrambi i casi si riprova fra una settimana.
            cache[chiave] = {"a": [], "il": oggi, "ko": True}
        dal_web += 1
        if dal_web % SALVA_OGNI == 0:
            _salva(cache)
        # Un ritmo umano: queste pagine le stiamo chiedendo una per una.
        time.sleep(random.uniform(*pausa))

    _salva(cache)
    return dal_web, dalla_cache
