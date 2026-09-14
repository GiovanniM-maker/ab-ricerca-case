#!/usr/bin/env python3
"""Che cosa dicono, sui servizi, le pagine che il browser ha salvato.

A cosa serve. I parser di Craigslist e ApartmentAdvisor hanno funzionato al
primo colpo perche' li ho scritti DOPO aver guardato il dato vero. Per
StreetEasy e Zillow quel dato sta solo sul Mac — le pagine sono gitignorate,
pesano centinaia di KB l'una e contengono i cookie della tua sessione — quindi
questo script guarda al posto mio e stampa un riassunto corto, senza mandare
niente da nessuna parte.

    python3 tools/che-servizi.py            # tutte le fonti salvate
    python3 tools/che-servizi.py streeteasy # una sola

Stampa, per ogni fonte: quante pagine ci sono, quante parlano di lavanderia, in
che forma (JSON-LD? dati di Next.js? attributi HTML?) e qualche esempio vero
delle diciture usate. Copiami l'output e ci scrivo il parser sopra.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

PAGES = Path(__file__).resolve().parents[1] / "apps" / "scraper" / "browser" / "pages"

# Le parole che cerchiamo. "dishwasher" e' esclusa apposta: contiene "washer" ed
# e' la trappola in cui il punteggio era gia' caduto una volta.
LAVANDERIA = re.compile(r"\b(laundry|washer|dryer|w/d)\b", re.I)

# Dove puo' stare il dato. Sapere in quale dei tre cambia completamente il
# parser da scrivere, quindi si contano separatamente.
CONTENITORI = {
    "JSON-LD (amenityFeature)": re.compile(r"amenityFeature", re.I),
    "dati Next.js (self.__next_f)": re.compile(r"self\.__next_f"),
    "dati Next.js (__NEXT_DATA__)": re.compile(r"__NEXT_DATA__"),
    "attributi data-* nell'HTML": re.compile(r'data-[a-z-]*amenit', re.I),
}


def campioni(html: str, quanti: int = 6) -> list[str]:
    """Pezzetti di testo attorno alle parole della lavanderia."""
    out: list[str] = []
    for m in LAVANDERIA.finditer(html):
        a, b = max(0, m.start() - 55), min(len(html), m.end() + 55)
        frammento = re.sub(r"\s+", " ", html[a:b]).strip()
        if frammento not in out:
            out.append(frammento)
        if len(out) >= quanti:
            break
    return out


def chiavi_json(html: str) -> Counter:
    """Nomi di campo che compaiono accanto a una parola di lavanderia.

    Serve a capire COME si chiama il campo da leggere: "amenities",
    "normalizedAmenities", "laundryType"... senza doverlo indovinare.
    """
    c: Counter = Counter()
    for m in LAVANDERIA.finditer(html):
        prima = html[max(0, m.start() - 250) : m.start()]
        # Le virgolette possono essere sfuggite: nei dati di Next.js il JSON
        # viaggia dentro una stringa, e i campi si scrivono \"laundryType\":.
        # Cercando solo quelle normali si perdeva proprio il contenitore piu'
        # probabile per StreetEasy e Zillow.
        trovate = re.findall(r'\\?"([A-Za-z_][A-Za-z0-9_]{2,40})\\?"\s*:', prima)
        for k in trovate[-3:]:
            c[k] += 1
    return c


def pagine_di(fonte: str) -> list[tuple[str, str]]:
    """(nome, html) delle pagine da esaminare per questa fonte.

    Quasi tutte le fonti hanno pagine salvate dal browser. Trulia no: la scarica
    il Mac al volo, e da un IP di datacenter risponde 403 — percio' l'unico
    posto dove si puo' guardare e' qui, mentre gira sul tuo computer.
    """
    cartella = PAGES / fonte
    if cartella.is_dir():
        return [(f.name, f.read_text(encoding="utf-8", errors="replace"))
                for f in sorted(cartella.glob("*.html"))]
    if fonte == "trulia":
        import urllib.request
        from rental_radar.sources.registry import url_for

        url = url_for("trulia")
        ua = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=30) as r:
                return [("(scaricata ora)", r.read().decode("utf-8", "replace"))]
        except Exception as e:
            print(f"  Trulia non risponde da qui: {type(e).__name__} {e}")
            return []
    return []


def guarda(fonte: str) -> None:
    files = pagine_di(fonte)
    print(f"\n{'=' * 62}\n{fonte}: {len(files)} pagine")
    if not files:
        # Il consiglio giusto dipende dalla fonte: Trulia non passa dal browser,
        # e dirti di rilanciare l'estensione ti manderebbe a sbattere.
        print("  (Trulia non ha risposto: riprova piu' tardi)" if fonte == "trulia"
              else "  (niente — lancia il crawl col browser, poi rifai questo)")
        return

    con_lav = 0
    contenitori: Counter = Counter()
    chiavi: Counter = Counter()
    esempi: list[str] = []

    for nome, html in files:
        quante = len(LAVANDERIA.findall(html))
        if quante:
            con_lav += 1
            chiavi.update(chiavi_json(html))
            if len(esempi) < 6:
                esempi += [e for e in campioni(html) if e not in esempi][:3]
        for nome, rx in CONTENITORI.items():
            if rx.search(html):
                contenitori[nome] += 1
        print(f"  {nome:<44} {len(html) // 1024:>5} KB · {quante:>3} parole di lavanderia")

    print(f"\n  pagine che ne parlano: {con_lav}/{len(files)}")
    if contenitori:
        print("  contenitori presenti:")
        for nome, n in contenitori.most_common():
            print(f"    {n:>3}/{len(files)}  {nome}")
    if chiavi:
        print("  campi JSON vicini alla lavanderia (i piu' probabili da leggere):")
        for k, n in chiavi.most_common(12):
            print(f"    {n:>4}  {k}")
    if esempi:
        print("  com'e' scritto:")
        for e in esempi:
            print(f"    …{e[:130]}…")


def main() -> None:
    if not PAGES.exists():
        sys.exit(f"Non trovo {PAGES}. Lancia prima il crawl col browser.")
    # rental_radar sta in apps/scraper: serve per la parte di Trulia.
    # PAGES e' .../apps/scraper/browser/pages, quindi due livelli sopra.
    sys.path.insert(0, str(PAGES.parents[1]))
    # Trulia va sempre guardata: non ha pagine salvate, si scarica al volo.
    fonti = sys.argv[1:] or sorted(
        {p.name for p in PAGES.iterdir() if p.is_dir()} | {"trulia"}
    )
    for f in fonti:
        guarda(f)
    print(f"\n{'=' * 62}\nCopia tutto questo e mandamelo: ci scrivo il parser sopra.")


if __name__ == "__main__":
    main()
