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

## Fonti HTML via Firecrawl

Le fonti HTML (ApartmentAdvisor, Craigslist, RentHop) usano **Firecrawl** come motore:
si passa l'URL di ricerca + uno schema dei campi, l'estrazione LLM restituisce gli
annunci → niente selettori per-sito fragili.

```bash
# self-hosted (Docker sul tuo Mac, default localhost:3002)
export FIRECRAWL_API_URL="http://localhost:3002"
# oppure cloud:
# export FIRECRAWL_API_URL="https://api.firecrawl.dev"
# export FIRECRAWL_API_KEY="fc-..."

python -m rental_radar.run --source craigslist \
  --url "https://newyork.craigslist.org/search/mnh/aap?..."
```

Pipeline: `extract (Firecrawl) → geocode (US Census, se manca lat/lng) → classify
(tier) → snapshot JSON` (la scrittura su DB è il passo successivo).

> ⚠️ L'estrazione strutturata richiede un LLM configurato nell'istanza Firecrawl
> (es. `OPENAI_API_KEY` nel container self-hosted). Senza, usare `scrape_markdown()`
> e parsare a valle.

## Runbook locale — ApartmentAdvisor (prima fonte)

ApartmentAdvisor incorpora un JSON (`__NEXT_DATA__`) con TUTTI gli annunci e le
**coordinate precise**: il connettore dedicato lo legge con la sola stdlib →
**niente Firecrawl, niente LLM, niente geocoding, nessuna dipendenza da installare**.

```bash
cd apps/scraper
python3 -m rental_radar.run --source apartmentadvisor   # -> apartmentadvisor.snapshot.json
python3 -m rental_radar.aggregate apartmentadvisor.snapshot.json   # -> listings.json
git add -A && git commit -m "crawl $(date +%F)" && git push   # Vercel ridepoia
```

oppure tutto in uno: `./crawl-aa.sh`.

> Firecrawl serve solo per le fonti **senza** JSON incorporato (Craigslist, RentHop):
> in quel caso vale la nota sull'LLM (Ollama/OpenAI) più sotto.

## Flusso della mattina ("git come DB")

Niente database: il crawl rigenera `apps/web/public/data/listings.json`, lo si
committa e si pusha → Vercel ridepoia da solo e serve lo snapshot.

```bash
# 1) crawl di una o più fonti (Firecrawl in locale)
python -m rental_radar.run --source craigslist --url "https://newyork.craigslist.org/search/mnh/aap?..."

# 2) fondi gli snapshot nel listings.json che legge il frontend
python -m rental_radar.aggregate craigslist.snapshot.json

# 3) pubblica: il push fa partire il redeploy su Vercel
git add -A && git commit -m "crawl $(date +%F)" && git push
```

La cronologia git è lo **storico prezzi gratuito** (`git diff` su `listings.json`).

## Stato
Scaffold pronto. Implementati: connettore HTML/Firecrawl (`sources/html_listings.py`),
pipeline (`run.py`), aggregatore → `listings.json` (`aggregate.py`), geocoding Census,
classificatore tier. Da fare: connettore RentCast (`sources/rentcast.py`).
