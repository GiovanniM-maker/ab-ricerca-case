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

## 6-bis. La wishlist (l'unica cosa che non sta in git)

Le case salvate hanno due livelli — **da vedere** e **viste** — e una **nota**.
Sono l'unico dato del progetto che **non** può stare nel repo: il repo è
pubblico, e "che impressione mi aveva fatto" è la cosa più personale che ci sia
qui dentro. Vivono su **Supabase** (org `Flat Iron`, piano free), tabella
`public.salvate`, protetta da RLS: ogni riga è visibile solo a chi l'ha scritta.
Accesso con magic link via email. Nessuna route server: PostgREST *è* l'API, il
frontend resta la Next.js statica di sempre.

Due decisioni che spiegano il resto:

- **Si salva una copia della scheda, non un puntatore.** Una casa che ti
  interessava sparisce dal crawl esattamente quando la affittano, ed è allora
  che vuoi ancora poter rileggere cos'era e cosa ne pensavi. La copia regala
  anche il confronto "era 3.200, ora 3.050".
- **L'aggancio al crawl del giorno dopo è l'indirizzo normalizzato** (campo
  `chiave` in `listings.json`), non l'`id`. L'id porta il nome della fonte che
  ha visto per prima quell'indirizzo: quando quella fonte perde l'annuncio ma
  un'altra ce l'ha ancora, l'id della stessa casa cambia. Misurato sugli
  snapshot in git: fra due crawl evapora il 4-6% degli id contro il 3% delle
  chiavi. Per il ~7% di schede senza civico la chiave non esiste e si ripiega
  sull'id: per questo la riga salvata ne tiene entrambi.

`localStorage` fa da copia di lavoro: la lista compare subito, e continua a
leggersi offline o se il progetto free va in pausa per inattività (succede dopo
7 giorni senza traffico; una riga in `crawl.command` lo tiene sveglio).

Configurazione: `NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` su Vercel. Senza, l'app funziona lo
stesso e la wishlist resta sul singolo browser. La `service_role` key non entra
mai nel frontend né nel repo.

## 6-ter. Chi scarica cosa, e da dove

Misurato provando le fonti da un IP di datacenter (uguale a quello di GitHub
Actions):

| fonte | da datacenter | dal Mac | dove gira |
|---|---|---|---|
| ApartmentAdvisor | 1665 ✓ | 1638 | **GitHub Actions**, ogni mattina |
| Craigslist | 189 ✓ | 194 | **GitHub Actions**, ogni mattina |
| Trulia | **0** ✗ | 94 | Mac |
| StreetEasy, Zillow, Apartments.com | bloccati | 835 | Mac, estensione Chrome |

`.github/workflows/crawl.yml` copre il ~68% delle case senza che tu tocchi
niente. Il resto resta al doppio clic: Trulia rifiuta gli IP dei datacenter, e
gli altri tre passano solo dall'estensione dentro il Chrome vero e loggato —
un browser in cloud è il profilo preciso che quei sistemi cercano.

Due difese aggiunte per rendere sicuro il crawl non sorvegliato:

- **`run.py` non sovrascrive uno snapshot buono con uno vuoto.** Una fonte che
  smette di rispondere finiva "senza errori" con zero annunci, e la fusione
  cancellava in silenzio tutte le sue case: successo apparente, danno reale.
  Sotto un quinto del giro precedente si ferma e esce con errore.
- **`aggregate.py --su-quelle-di-ieri`** fonde sopra il `listings.json`
  pubblicato. Regola: una casa si porta avanti se ha almeno una fonte che oggi
  non è stata interrogata; se invece tutte le sue fonti sono state riguardate e
  lei non c'è più, è sparita davvero e se ne va. Così la lista si accorcia
  quando deve, invece di riempirsi di fantasmi. Il crawl completo dal Mac non
  usa l'opzione: lì le fonti ci sono tutte e ricostruire da zero è più pulito.

## 7. Stato di avanzamento
- [x] **Fase 0** — Scaffold monorepo, schema DB, config Flatiron, docs.
- [x] **Fase 1** — Isocrone (GeoJSON) + `classify()` + mappa interattiva.
- [x] **Fase 2** — Crawling fonti → classify → `listings.json` (git-as-DB).
  - ApartmentAdvisor (API interna): ~1680 case su tutti e 3 i tier.
  - Trulia (`__NEXT_DATA__`): core Flatiron, aggiunge `sqft` + `furnished`.
  - Aggregatore con merge per edificio (cross-fonte).
- [ ] **Fase 3** — Frontend lista filtrabile + deploy Vercel.
- [ ] **Fase 4** — Estensione fonti via Firecrawl (siti blindati), alert.

### Copertura dati (stato attuale)
| Campo | Copertura | Note |
|-------|-----------|------|
| prezzo, posizione, link | ~100% | core completo |
| tipo (studio/1br/…) | ~99% | |
| foto | ~64% | non tutte le fonti la espongono |
| sqft, furnished | basso | solo Trulia; limitato dall'anti-bot al core Flatiron |

> **Fonti blindate** (StreetEasy, Zillow, Apartments.com, Realtor, HotPads,
> RentHop): rispondono 403/Captcha a richieste dirette. Per integrarle serve
> **Firecrawl self-hosted** (headless) con un LLM configurato. Non incluse finché
> non c'è quella configurazione.

> ⚠️ **Nota sulle isocrone attuali**: i GeoJSON in `apps/web/public/data/` sono
> **approssimazioni geometriche** generate da `tools/generate_isochrones.py` senza
> dati di transito reali. Vanno **rigenerate** con OpenTripPlanner (GTFS MTA) o un
> servizio di isocrone transit prima di considerare i tier "mezzi" affidabili.
> L'architettura (carica GeoJSON → point-in-polygon) è invece definitiva: cambia
> solo il *dato*, non il codice.
