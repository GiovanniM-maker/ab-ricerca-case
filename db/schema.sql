-- Flatiron Rental Radar — schema Postgres
-- Compatibile con Supabase/Neon free tier. PostGIS è opzionale: la classificazione
-- in tier avviene a livello applicativo (point-in-polygon su GeoJSON), ma PostGIS
-- abilita query geospaziali native (distanze, ordinamenti per vicinanza).

-- create extension if not exists postgis;  -- abilitare su Supabase se disponibile

create table if not exists listings (
    id            bigint generated always as identity primary key,
    source        text        not null,           -- 'craigslist' | 'streeteasy' | ...
    source_id     text,                            -- id annuncio sul sito (per dedup)
    source_url    text        not null,
    title         text,
    price         integer,                         -- USD/mese, intero
    currency      text        not null default 'USD',
    type          text,                            -- 'studio' | '1br' | '2br' | ...
    furnished     boolean,
    sqft          integer,
    address_raw   text,                            -- indirizzo testuale da geocodificare
    lat           double precision,
    lng           double precision,
    geocoded      boolean     not null default false,
    tier          text,                            -- 'walk30' | 'transit30' | 'transit45' | 'out'
    travel_minutes integer,                        -- opzionale: minuti reali (se calcolati)
    photos        text[]      not null default '{}',
    raw_json      jsonb,
    first_seen    timestamptz not null default now(),
    last_seen     timestamptz not null default now(),

    unique (source, source_id)
);

create index if not exists idx_listings_tier   on listings (tier);
create index if not exists idx_listings_price  on listings (price);
create index if not exists idx_listings_active on listings (last_seen);
-- create index if not exists idx_listings_geom on listings using gist (
--     st_setsrid(st_makepoint(lng, lat), 4326)
-- );  -- abilitare con PostGIS

-- Storico prezzi: una riga ogni volta che il prezzo di un annuncio cambia.
create table if not exists price_history (
    id          bigint generated always as identity primary key,
    listing_id  bigint      not null references listings (id) on delete cascade,
    price       integer     not null,
    observed_at timestamptz not null default now()
);

create index if not exists idx_price_history_listing on price_history (listing_id);
