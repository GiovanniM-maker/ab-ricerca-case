# Scraper / Data ingestion

Raccoglie annunci di affitto, li geocodifica, assegna il **tier** (point-in-polygon
sulle isocrone) e li scrive nel DB. **Non gira su Vercel**: si esegue dal Mac o da
una GitHub Action schedulata.

## Fonti (ordine dato dalla ricerca)

| Priorità | Fonte | Tipo | Note |
|----------|-------|------|------|
| **1** | **RentCast API** | API JSON ufficiale | lat/lng precise, free 50 call/mese, query per raggio. **Punto di partenza.** |
| 2 | ApartmentAdvisor | HTML | indirizzo testuale → geocoding US Census. Low-rate, cache aggressiva. |
| 3 | Craigslist / RentHop | HTML / feed | supplemento rumoroso, dedup necessaria. |

> StreetEasy/Zillow NON come fonte primaria: blindati e ToS anti-scraping. Solo
> benchmark manuale.

## Setup

```bash
cd apps/scraper
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # inserisci RENTCAST_API_KEY e DATABASE_URL
```

## Pipeline (Fase 2)

```
fetch (per fonte) → normalize → geocode (se serve) → classify (tier) → dedup → upsert DB
```

- **classify**: usa gli stessi GeoJSON del frontend (`apps/web/public/data/iso_*.geojson`)
  così frontend e ingest concordano sempre sul tier.
- **dedup**: chiave primaria `source+source_id`; chiave secondaria
  `indirizzo_normalizzato + unit + prezzo` (±3%).
- **budget RentCast**: con 50 call/mese conviene 1 fetch/giorno con
  `includeTotalCount=true` e scaricare i dettagli solo se il count cambia.

## Stato
Scaffold pronto. I connettori sono stub (Fase 2): da implementare `sources/rentcast.py`
per primo.
