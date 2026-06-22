# Flatiron Rental Radar — Documento di architettura

> Un "Booking verticale": aggregatore personale di annunci di **affitto a lungo
> termine** centrato su una singola zona — il **Flatiron District, Manhattan (NYC)** —
> che ordina le case in base al **tempo reale di raggiungimento** della zona, non
> alla distanza in linea d'aria.

## 1. Obiettivo

La mattina apro l'app, vedo le case disponibili clusterizzate per quanto realmente
ci metto ad arrivare a Flatiron, con tipo (arredato o no), prezzo, foto e link.

### I tre tier temporali
| Tier | Significato | Mezzo |
|------|-------------|-------|
| `walk30`     | raggiungo Flatiron in ≤ 30 min **a piedi** | walking |
| `transit30`  | raggiungo Flatiron in ≤ 30 min **coi mezzi** | metro + bus |
| `transit45`  | raggiungo Flatiron in ≤ 45 min **coi mezzi** | metro + bus |
| `out`        | fuori da tutti i tier | — |

Una casa cade nel tier **più stretto** che la contiene (una casa raggiungibile a
piedi in 25 min è `walk30`, anche se è ovviamente anche `transit30`).

## 2. L'intuizione chiave (perché tutto sta nel free-tier)

Flatiron è un **punto fisso** e i tier sono **fissi**. Quindi le isocrone (i poligoni
"tutti i punti da cui arrivo in ≤ X minuti") si calcolano **una volta sola, offline**,
e si congelano come GeoJSON nel repo.

In produzione **non serve nessun motore di routing acceso**: classificare una casa
diventa un banale test *point-in-polygon* (`turf.booleanPointInPolygon`), che gira in
millisecondi dentro una serverless function di Vercel o persino nel browser.

Conseguenza: niente server sempre acceso → tutto resta nel **free-tier**.

## 3. Architettura — "git come database"

```
  [Mac / locale — la mattina]                 [Vercel free tier]
  ┌────────────────────────────┐              ┌─────────────────────────┐
  │ CRAWL                       │              │ Next.js app (statica)   │
  │ Firecrawl → geocode →       │  git push    │ • fetch listings.json   │
  │ classify (tier) →           │ ───────────► │ • classify (Turf)       │
  │ aggregate → listings.json   │  (redeploy   │ • mappa + lista         │
  └────────────┬───────────────┘   automatico)│   filtrabile            │
               │ commit                        └─────────────────────────┘
               ▼
   apps/web/public/data/listings.json   ← il "DB" è un file versionato
   apps/web/public/data/iso_*.geojson   ← isocrone congelate (Fase 1)
```

Il database **è il repo git**. Ogni mattina il crawl rigenera `listings.json`, lo si
committa e si pusha: Vercel ridepoia in automatico e serve il nuovo snapshot dalla
CDN. Nessun Postgres, nessuna API route, nessun server sempre acceso → tutto gratis.

**Bonus:** la cronologia git è lo **storico prezzi gratuito**. `git diff` su
`listings.json` mostra case comparse/sparite e variazioni di prezzo: niente tabella
dedicata.

### Perché queste scelte
- **git-as-DB**: snapshot giornaliero versionato, zero infrastruttura, free-tier puro.
- **Isocrone offline** → niente routing server in produzione.
- **US Census Geocoder**: gratis, senza API key, per le fonti con solo indirizzo.
- **Firecrawl** (in locale): estrazione via schema, un solo codice per più fonti HTML.
- **Next.js + MapLibre** su Vercel: front statico, deploy gratuito su push.
- Il **crawl NON gira su Vercel**: gira sul Mac la mattina e pusha il risultato.

> `db/schema.sql` resta come opzione "fase futura" se un giorno servirà un DB vero
> (volumi alti, query complesse). Per l'MVP NON serve.

## 4. Vincoli scelti (decisioni prese)
- **Fonti**: approccio *ibrido pragmatico*. Fonte primaria individuata:
  **RentCast API** (JSON ufficiale, lat/lng precise, query per raggio, free 50
  call/mese). Fonti secondarie HTML: ApartmentAdvisor, Craigslist/RentHop.
  StreetEasy/Zillow solo benchmark manuale (blindati + ToS anti-scraping).
- **Budget**: zero, tutto free-tier / self-hosted una tantum.
- **Tipo affitto**: **lease a lungo termine** (no Airbnb/breve termine).
- **Deploy**: Vercel, uso personale, sempre nel free-tier.

## 5. Il punteggio "convenienza"
Trasparente e regolabile con pesi (normalizzazione 0–1 sul set corrente):

```
convenienza = w_prezzo·(1 - prezzo_norm)
            + w_tempo ·(1 - tempo_norm)
            + w_spazio·spazio_norm
            + w_arred ·arredato_bonus
```
Default: prezzo 40%, tempo 35%, spazio 15%, arredato 10%. Gli slider li espone il
frontend. "Conveniente" = miglior compromesso, non solo "economico".

## 6. Modello dati (vedi `db/schema.sql`)
`listings`: id, source, source_url, title, price, currency, type, furnished, sqft,
lat, lng, address_raw, geocoded, tier, travel_minutes, photos[], first_seen,
last_seen, raw_json. Indice geografico su (lat,lng). Storico prezzi a parte.

## 7. Stato di avanzamento
- [x] **Fase 0** — Scaffold monorepo, schema DB, config Flatiron, docs.
- [x] **Fase 1** — Isocrone (GeoJSON) + `classify()` + mappa interattiva.
- [ ] **Fase 2** — Scraper prima fonte → geocode → DB.
- [ ] **Fase 3** — Frontend lista filtrabile + pulsantino + deploy Vercel.
- [ ] **Fase 4** — Seconda fonte, scheduler Actions, alert.

> ⚠️ **Nota sulle isocrone attuali**: i GeoJSON in `apps/web/public/data/` sono
> **approssimazioni geometriche** generate da `tools/generate_isochrones.py` senza
> dati di transito reali. Vanno **rigenerate** con OpenTripPlanner (GTFS MTA) o un
> servizio di isocrone transit prima di considerare i tier "mezzi" affidabili.
> L'architettura (carica GeoJSON → point-in-polygon) è invece definitiva: cambia
> solo il *dato*, non il codice.
