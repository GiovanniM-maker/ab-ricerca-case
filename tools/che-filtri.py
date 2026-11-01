#!/usr/bin/env python3
"""Cerca, in una pagina di ricerca, il filtro «lavatrice» del sito.

Perche' il filtro e non i servizi. Avevo scritto uno strumento che cercava le
parole della lavanderia dentro le pagine salvate, dando per scontato che i
servizi fossero li'. Non ci sono: in 673 KB di Zillow la parola "laundry"
compare UNA volta, e non in un annuncio — nel nome di un filtro. Le pagine di
ricerca elencano case, non dotazioni; le dotazioni stanno nel dettaglio, una
pagina per casa.

Ma quel filtro e' la risposta. Rifare la stessa ricerca chiedendo «solo con
lavatrice in casa» torna un elenco piu' corto — su Zillow 14866 affitti
diventano 5943 — e chi resta dentro la lavatrice ce l'ha perche' lo dice il
sito, non perche' l'ho indovinato con un'espressione regolare. Due pagine di
ricerca invece di ottocento pagine di dettaglio.

Zillow e' fatto. Questo strumento serve per le altre: trova come si chiama il
filtro, cosi' lo si scrive in browser/targets.json e il crawl lo usa.

    python3 tools/che-filtri.py           # tutte le fonti che si possono guardare
    python3 tools/che-filtri.py trulia    # una sola

Trulia e StreetEasy vanno guardate DAL TUO MAC: da un IP di datacenter
rispondono 403 prima ancora di arrivare al sito. Niente esce da qui: lo script
legge e stampa, non manda nulla da nessuna parte.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = ROOT / "apps" / "scraper" / "browser" / "pages"

# "dishwasher" resta fuori: contiene "washer" ed e' la trappola in cui il
# punteggio e' gia' caduto una volta, regalando punti di lavanderia a 164 case
# che avevano solo la lavastoviglie.
LAVANDERIA = re.compile(r"\b(laundry|washer|dryer|w/d)\b", re.I)

# I nomi che un filtro puo' avere attorno a se'. Su Zillow era
# "onlyRentalInUnitLaundry" con "shortId":"lau", ed e' bastato leggerlo.
NOMI = re.compile(
    r'\\?"(?:id|shortId|name|key|slug|filterType|param|value|urlName)\\?"\s*:\s*\\?"([^"\\]{2,48})',
    re.I,
)


def pagina_di(fonte: str) -> list[tuple[str, str]]:
    """(nome, html) da esaminare: dal disco se il browser le salva, o dalla rete."""
    cartella = PAGES / fonte
    if cartella.is_dir():
        # Le pagine filtrate non servono: cerchiamo il filtro, non il risultato.
        trovate = [f for f in sorted(cartella.glob("*.html")) if not f.name.startswith("filtro-")]
        if trovate:
            return [(f.name, f.read_text(encoding="utf-8", errors="replace"))
                    for f in trovate[:2]]

    import urllib.request

    sys.path.insert(0, str(ROOT / "apps" / "scraper"))
    from rental_radar.sources.registry import url_for

    url = url_for(fonte)
    if not url:
        print(f"  Non so da che URL partire per «{fonte}»: non e' in registry.py,")
        print("  e non ci sono pagine salvate dal browser.")
        return []
    ua = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        with urllib.request.urlopen(req, timeout=30) as r:
            return [("(scaricata ora)", r.read().decode("utf-8", "replace"))]
    except Exception as e:
        print(f"  {fonte} non risponde: {type(e).__name__} {e}")
        print("  Se sei sul Mac e dice 403, il sito blocca anche te: apri la")
        print("  ricerca in Chrome, salva la pagina e rimettila in browser/pages/.")
        return []


def guarda(fonte: str) -> None:
    print(f"\n{'=' * 64}\n{fonte}")
    for nome, html in pagina_di(fonte):
        colpi = list(LAVANDERIA.finditer(html))
        print(f"  {nome}  ·  {len(html) // 1024} KB  ·  {len(colpi)} parole di lavanderia")
        if not colpi:
            print("    Nessuna: il filtro non e' in questa pagina, o ha un altro nome.")
            continue
        visti: set[str] = set()
        for m in colpi[:14]:
            a, b = max(0, m.start() - 220), min(len(html), m.end() + 90)
            intorno = html[a:b]
            # Il contesto dice se siamo in un filtro o in un annuncio; i nomi
            # dicono che stringa andra' scritta in targets.json.
            nomi = [n for n in NOMI.findall(intorno) if "laundr" in n.lower()
                    or re.fullmatch(r"[a-z]{2,5}", n)]
            frammento = re.sub(r"\s+", " ", intorno).strip()
            if frammento in visti:
                continue
            visti.add(frammento)
            print(f"    …{frammento[-190:]}…")
            if nomi:
                print(f"      candidati: {', '.join(dict.fromkeys(nomi))}")


def main() -> None:
    fonti = sys.argv[1:]
    if not fonti:
        salvate = {p.name for p in PAGES.iterdir() if p.is_dir()} if PAGES.exists() else set()
        fonti = sorted(salvate | {"trulia"})
    for f in fonti:
        guarda(f)
    print(f"\n{'=' * 64}")
    print("Copiami l'output. Dal nome del filtro ricavo l'URL della ricerca")
    print("filtrata, lo metto in targets.json e il crawl fa il resto.")


if __name__ == "__main__":
    main()
