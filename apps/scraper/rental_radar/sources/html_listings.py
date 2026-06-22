"""Estrattore HTML generico basato su Firecrawl + schema.

Un solo estrattore per piu' fonti (ApartmentAdvisor, Craigslist, RentHop): si passa
l'URL della pagina di ricerca e Firecrawl restituisce gli annunci secondo lo schema.
Per-sito serve solo l'URL e il nome fonte, non selettori fragili.
"""

from __future__ import annotations

from urllib.parse import urljoin

from rental_radar.firecrawl_client import FirecrawlClient
from rental_radar.models import Listing

# Schema dei campi che vogliamo estratti dalla pagina di ricerca.
LISTINGS_SCHEMA = {
    "type": "object",
    "properties": {
        "listings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "price_per_month_usd": {"type": "number"},
                    "address": {"type": "string", "description": "indirizzo completo se disponibile"},
                    "property_type": {"type": "string", "description": "studio, 1br, 2br, ..."},
                    "bedrooms": {"type": "number"},
                    "square_feet": {"type": "number"},
                    "furnished": {"type": "boolean"},
                    "url": {"type": "string", "description": "link all'annuncio"},
                    "photo_url": {"type": "string"},
                },
            },
        }
    },
}

PROMPT = (
    "Estrai TUTTI gli annunci di affitto a lungo termine presenti nella pagina. "
    "Per ognuno cattura prezzo mensile, indirizzo piu' preciso possibile, tipologia, "
    "camere, metratura, se arredato, link all'annuncio e prima foto. "
    "Ignora annunci sponsorizzati di altre zone e contenuti non immobiliari."
)


def _norm_type(item: dict) -> str | None:
    t = item.get("property_type")
    if t:
        return str(t).lower().strip()
    beds = item.get("bedrooms")
    if beds == 0:
        return "studio"
    if isinstance(beds, (int, float)) and beds >= 1:
        return f"{int(beds)}br"
    return None


def extract_listings(
    search_url: str,
    source: str,
    client: FirecrawlClient | None = None,
) -> list[Listing]:
    client = client or FirecrawlClient()
    data = client.scrape_json(search_url, LISTINGS_SCHEMA, PROMPT)
    out: list[Listing] = []
    for item in data.get("listings", []):
        url = item.get("url") or search_url
        if url and url.startswith("/"):
            url = urljoin(search_url, url)
        price = item.get("price_per_month_usd")
        sqft = item.get("square_feet")
        out.append(
            Listing(
                source=source,
                source_url=url,
                title=item.get("title"),
                price=int(price) if isinstance(price, (int, float)) else None,
                type=_norm_type(item),
                furnished=item.get("furnished"),
                sqft=int(sqft) if isinstance(sqft, (int, float)) else None,
                address_raw=item.get("address"),
                photos=[item["photo_url"]] if item.get("photo_url") else [],
                raw=item,
            )
        )
    return out
