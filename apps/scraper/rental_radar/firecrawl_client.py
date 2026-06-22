"""Wrapper sottile su Firecrawl (self-hosted o cloud).

Funziona con entrambi: cambia solo base URL e (per il cloud) la API key.
  - self-hosted (Docker sul tuo Mac): FIRECRAWL_API_URL=http://localhost:3002
  - cloud:                            FIRECRAWL_API_URL=https://api.firecrawl.dev
                                      FIRECRAWL_API_KEY=fc-...

Usa l'endpoint /v1/scrape con format "json" + schema: l'estrazione LLM restituisce
direttamente i campi che ci servono, così non scriviamo selettori per ogni sito.

NB: l'estrazione "json" richiede che l'istanza Firecrawl abbia un LLM configurato
(es. OPENAI_API_KEY nell'env del container Firecrawl self-hosted). Se non c'è, usa
scrape_markdown() e si parsa a valle.
"""

from __future__ import annotations

import os

import httpx


class FirecrawlClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, timeout: float = 120.0):
        self.base_url = (base_url or os.environ.get("FIRECRAWL_API_URL", "https://api.firecrawl.dev")).rstrip("/")
        self.api_key = api_key or os.environ.get("FIRECRAWL_API_KEY")
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def scrape_json(self, url: str, schema: dict, prompt: str | None = None) -> dict:
        """Scrape di una pagina con estrazione strutturata secondo `schema`."""
        body: dict = {
            "url": url,
            "formats": ["json"],
            "jsonOptions": {"schema": schema},
            "onlyMainContent": True,
        }
        if prompt:
            body["jsonOptions"]["prompt"] = prompt
        with httpx.Client(timeout=self.timeout) as c:
            r = c.post(f"{self.base_url}/v1/scrape", headers=self._headers(), json=body)
            r.raise_for_status()
            data = r.json()
        return data.get("data", {}).get("json", {})

    def scrape_markdown(self, url: str) -> str:
        """Fallback: pagina come markdown pulito (nessun LLM richiesto)."""
        body = {"url": url, "formats": ["markdown"], "onlyMainContent": True}
        with httpx.Client(timeout=self.timeout) as c:
            r = c.post(f"{self.base_url}/v1/scrape", headers=self._headers(), json=body)
            r.raise_for_status()
            return r.json().get("data", {}).get("markdown", "")
