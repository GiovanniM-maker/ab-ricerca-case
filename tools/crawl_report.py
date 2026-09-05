#!/usr/bin/env python3
"""Riepilogo leggibile di un crawl: quante case per fonte, quante nuove, quante sparite.

Lo chiama crawl.command a fine giro. Confronta il listings.json appena scritto
con la versione precedente presa da git, cosi' il numero che conta davvero —
"stamattina cosa e' cambiato" — non va cercato a mano nel diff.

    python3 tools/crawl_report.py
"""

from __future__ import annotations

import json
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LISTINGS = ROOT / "apps" / "web" / "public" / "data" / "listings.json"
SCRAPER = ROOT / "apps" / "scraper"


def _load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text()).get("listings", [])
    except ValueError:
        return []


def _previous() -> list[dict]:
    """La versione di listings.json committata prima di questo crawl."""
    try:
        rel = LISTINGS.relative_to(ROOT)
        out = subprocess.run(
            ["git", "show", f"HEAD:{rel.as_posix()}"],
            cwd=ROOT, capture_output=True, text=True, timeout=30,
        )
        if out.returncode:
            return []
        return json.loads(out.stdout).get("listings", [])
    except Exception:
        return []


def _key(l: dict) -> str:
    return l.get("sourceUrl") or f"{l.get('lat')},{l.get('lng')},{l.get('price')}"


# Stesse soglie del sito: senza, il report segnalerebbe come occasioni proprio
# gli annunci civetta che il frontend nasconde.
_FLOORS = json.loads((ROOT / "apps" / "web" / "lib" / "price_floors.json").read_text())["floors"]


def _plausible(l: dict) -> bool:
    price = l.get("price")
    return price is None or price >= _FLOORS.get(l.get("type") or "", 0)


def main() -> None:
    now = _load(LISTINGS)
    if not now:
        print("\n⚠︎  Nessun listings.json: il crawl non ha prodotto niente.")
        return

    print("\n" + "─" * 58)
    print("RIEPILOGO")
    print("─" * 58)

    # per fonte, dagli snapshot grezzi (prima del merge)
    print("\nPagine grezze per fonte:")
    for snap in sorted(SCRAPER.glob("*.snapshot.json")):
        try:
            rows = json.loads(snap.read_text())
        except ValueError:
            continue
        name = snap.name.replace(".snapshot.json", "")
        tiers = Counter(r.get("tier") for r in rows)
        detail = " · ".join(f"{t} {tiers[t]}" for t in ("walk30", "transit30", "transit45") if tiers[t])
        print(f"  {name:<18} {len(rows):>5}   {detail}")

    # Schede finali dopo il merge. Il tier non e' nel file: lo ricava il
    # frontend dalle isocrone, quindi lo rifacciamo qui con lo stesso
    # classificatore e gli stessi GeoJSON, altrimenti i due numeri divergono.
    import sys

    sys.path.insert(0, str(SCRAPER))
    from rental_radar.classify import TierClassifier

    clf = TierClassifier()
    # Il sito nasconde le civette, quindi il conteggio deve fare lo stesso:
    # altrimenti il numero qui non corrisponde a quello che poi vedi a schermo.
    shown = [l for l in now if _plausible(l)]
    bait = len(now) - len(shown)
    tiers = Counter(clf.classify(l.get("lat"), l.get("lng")) for l in shown)

    print(f"\nSchede pubblicate: {len(shown)}" + (f"   ({bait} civetta scartate)" if bait else ""))
    for t, label in (("walk30", "≤30 min a piedi"), ("transit30", "≤30 min coi mezzi"),
                     ("transit45", "≤45 min coi mezzi")):
        print(f"  {label:<20} {tiers[t]}")

    withphoto = sum(1 for l in shown if l.get("photos"))
    withsqft = sum(1 for l in shown if l.get("sqft"))
    print(f"\nCopertura dati:  foto {withphoto}/{len(shown)}   metratura {withsqft}/{len(shown)}")

    # cosa e' cambiato rispetto all'ultimo crawl committato
    prev = _previous()
    if prev:
        old = {_key(l) for l in prev}
        new = {_key(l) for l in now}
        added = new - old
        gone = old - new
        print(f"\nRispetto a ieri:  +{len(added)} nuove   -{len(gone)} sparite   ({len(prev)} → {len(now)})")

        fresh = [l for l in now if _key(l) in added and l.get("price") and _plausible(l)]
        fresh.sort(key=lambda l: l["price"])
        if fresh:
            print("\nLe 5 novita' piu' economiche:")
            for l in fresh[:5]:
                price = f"${l['price']:,}"
                tier = clf.classify(l.get("lat"), l.get("lng"))
                print(f"  {price:>9}/mese  {tier:<10} {(l.get('title') or '')[:40]}")
    else:
        print("\n(primo crawl: nessun confronto)")

    print("─" * 58)


if __name__ == "__main__":
    main()
