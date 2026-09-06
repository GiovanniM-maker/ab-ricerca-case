#!/usr/bin/env python3
"""Riceve dall'estensione le pagine che il browser ha davvero visto.

L'estensione gira nel Chrome normale — nessuna porta di debug, nessuna
automazione da riconoscere — e manda qui l'HTML. Noi lo scriviamo dove il
parser lo cerca gia', cosi' il resto della pipeline non cambia di una riga.

    python3 tools/collector.py          # resta in ascolto su 127.0.0.1:8787
    python3 tools/collector.py --once   # si spegne appena l'estensione ha finito

Ascolta solo su 127.0.0.1: non e' raggiungibile da fuori dal Mac.
"""

from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
BROWSER = ROOT / "apps" / "scraper" / "browser"
PAGES = BROWSER / "pages"
BLOCKED = BROWSER / "blocked"
TARGETS = json.loads((BROWSER / "targets.json").read_text())

PORT = 8787
finished = threading.Event()

# Gli stessi criteri di common.mjs: una pagina di risultati vera sta sui
# 300 KB - 1,8 MB, e sotto i 20 KB e' un muro, un redirect o una pagina vuota.
MIN_SIZE = 20_000
MARKS = (
    "px-captcha",
    "please verify you are a human",
    "access to this page has been denied",
    "are you a robot",
    "captcha-delivery",
    "attention required",
    "request unsuccessful",
    "unusual traffic",
)


def is_blocked(html: str) -> bool:
    low = html.lower()
    return len(html) < MIN_SIZE or any(m in low for m in MARKS)


def page_url(base: str, cfg: dict, n: int) -> str | None:
    if n == 1:
        return base
    if cfg.get("pathPage"):
        return base.rstrip("/") + cfg["pathPage"].replace("{n}", str(n))
    if cfg.get("pageParam"):
        return base + ("&" if "?" in base else "?") + f"{cfg['pageParam']}={n}"
    return None


def slug_for(base: str) -> str:
    tail = base.split("//", 1)[-1].split("/", 1)[-1] if "//" in base else base
    out = "".join(c if c.isalnum() else "-" for c in tail).strip("-")
    return out or "home"


def targets() -> list[dict]:
    out = []
    for source, cfg in TARGETS.items():
        if source.startswith("_"):
            continue
        for base in cfg["searches"]:
            for n in range(1, cfg.get("pages", 1) + 1):
                url = page_url(base, cfg, n)
                if url:
                    out.append({"source": source, "url": url, "slug": slug_for(base), "n": n})
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, obj: dict, code: int = 200) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        # L'estensione chiama da un'origine chrome-extension://
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send({})

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/targets":
            t = targets()
            print(f"→ l'estensione ha chiesto la lista: {len(t)} pagine")
            self._send(t)
        elif path == "/health":
            self._send({"ok": True})
        else:
            self._send({"error": "non trovato"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        if u.path == "/done":
            print("✓ l'estensione ha finito")
            finished.set()
            return self._send({"ok": True})
        if u.path != "/save":
            return self._send({"error": "non trovato"}, 404)

        q = parse_qs(u.query)
        source = (q.get("source") or [""])[0]
        slug = (q.get("slug") or ["pagina"])[0]
        n = (q.get("n") or ["1"])[0]
        length = int(self.headers.get("Content-Length") or 0)
        html = self.rfile.read(length).decode("utf-8", "replace")

        if source not in TARGETS:
            return self._send({"saved": False, "reason": "fonte sconosciuta"}, 400)

        if is_blocked(html):
            BLOCKED.mkdir(parents=True, exist_ok=True)
            (BLOCKED / f"{source}-{slug}-{n}.html").write_text(html)
            print(f"  ⚠︎  {source} {slug} p{n}: muro ({len(html) // 1024} KB)")
            return self._send({"saved": False, "reason": "blocked"})

        out = PAGES / source
        out.mkdir(parents=True, exist_ok=True)
        (out / f"{slug}-{n}.html").write_text(html)
        print(f"  ✓ {source} {slug} p{n} ({len(html) // 1024} KB)")
        self._send({"saved": True})

    def log_message(self, *args) -> None:
        pass  # il nostro log basta e avanza


def main() -> None:
    once = "--once" in sys.argv
    srv = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Raccoglitore in ascolto su http://127.0.0.1:{PORT}")
    print("Ora apri Chrome e clicca l'icona Flatiron Radar → «Scarica le case».")
    if once:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        # Un tetto comunque: se l'estensione non parte non restiamo qui per sempre.
        finished.wait(timeout=45 * 60)
        srv.shutdown()
    else:
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nChiuso.")


if __name__ == "__main__":
    main()
