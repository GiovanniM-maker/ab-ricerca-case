# Flatiron Rental Radar

Aggregatore personale di annunci di affitto a lungo termine attorno al **Flatiron
District (Manhattan, NYC)**, clusterizzati per **tempo reale di raggiungimento**
(a piedi / mezzi) invece che per distanza in linea d'aria.

📄 Architettura e razionale completi: **[PROJECT.md](./PROJECT.md)**

## Struttura del repo (monorepo)

```
.
├── PROJECT.md            # documento di architettura
├── apps/
│   ├── web/              # Next.js + MapLibre (frontend + API) — deploy su Vercel
│   └── scraper/          # Python + Playwright (Fase 2) — gira fuori da Vercel
├── tools/
│   └── generate_isochrones.py   # genera i poligoni isocroni (GeoJSON)
├── db/
│   └── schema.sql        # schema Postgres/PostGIS
└── data/
    └── flatiron.json     # punto di ancoraggio + parametri tier
```

## Avvio rapido (frontend — Fase 1)

```bash
cd apps/web
npm install
npm run dev
# apri http://localhost:3000
```

Vedrai la mappa di Flatiron con i 3 poligoni isocroni e un pin di test che mostra
in che tier cade un indirizzo.

## Rigenerare le isocrone

```bash
python3 tools/generate_isochrones.py
```

> ⚠️ Le isocrone attuali sono **approssimazioni geometriche** (placeholder).
> Vanno sostituite con poligoni reali da OpenTripPlanner (GTFS MTA) per i tier
> "mezzi". Vedi commenti nel file dello script.

## Stato

Fase 0 ✅ · Fase 1 ✅ · Fase 2 (scraper) ⏳ · Fase 3 (lista+deploy) ⏳
