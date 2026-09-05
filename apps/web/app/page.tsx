"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { loadIsochrones, type IsochroneSet } from "@/lib/geo";
import {
  loadListings,
  scoreListings,
  type RawListing,
  type ScoredListing,
} from "@/lib/listings";
import { TIERS, type TierId } from "@/lib/types";
import { NEIGHBORHOODS, neighborhoodsOf } from "@/lib/neighborhoods";
import { FLATIRON } from "@/lib/config";
import ListingCard from "@/components/ListingCard";
import ListingDetail from "@/components/ListingDetail";
import FilterPopover from "@/components/FilterPopover";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const EMPTY: IsochroneSet = { walk30: null, transit30: null, transit45: null };
type SortKey = "convenienza" | "price" | "distance";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "convenienza", label: "Convenienza" },
  { key: "price", label: "Prezzo" },
  { key: "distance", label: "Vicinanza" },
];
const PAGE = 30;

/** Riga cliccabile dentro un pannello filtro. */
function Row({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition ${
        on ? "bg-neutral-800 text-white" : "text-neutral-300 hover:bg-neutral-800/60"
      }`}
    >
      <span className="flex items-center gap-2">{children}</span>
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
          on ? "border-white bg-white text-neutral-900" : "border-neutral-600"
        }`}
      >
        {on ? "✓" : ""}
      </span>
    </button>
  );
}

/** Pill di un filtro attivo, rimovibile. */
function Pill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      className="flex items-center gap-1 rounded-full bg-neutral-800 px-2.5 py-1 text-[11px] font-medium text-neutral-200 transition hover:bg-neutral-700"
    >
      {label}
      <span className="text-neutral-500">✕</span>
    </button>
  );
}

export default function Home() {
  const [iso, setIso] = useState<IsochroneSet>(EMPTY);
  const [raw, setRaw] = useState<RawListing[]>([]);
  const [loading, setLoading] = useState(true);

  const [sort, setSort] = useState<SortKey>("convenienza");
  const [activeTiers, setActiveTiers] = useState<Set<TierId>>(
    new Set(["walk30", "transit30", "transit45"])
  );
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [furnishedOnly, setFurnishedOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [activeNeighborhoods, setActiveNeighborhoods] = useState<Set<string>>(new Set());
  const [hoodQuery, setHoodQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [detail, setDetail] = useState<ScoredListing | null>(null);
  const [mobileMap, setMobileMap] = useState(false);

  useEffect(() => {
    Promise.all([loadIsochrones(), loadListings()]).then(([i, l]) => {
      setIso(i);
      setRaw(l);
      setLoading(false);
    });
  }, []);

  const scored = useMemo(() => scoreListings(raw, iso), [raw, iso]);

  const { types, priceCap } = useMemo(() => {
    const t = new Set<string>();
    let cap = 0;
    for (const l of scored) {
      if (l.type) t.add(l.type);
      if (l.price && l.price > cap) cap = l.price;
    }
    const order = (x: string) => (x === "studio" ? 0 : parseInt(x) || 99);
    return { types: [...t].sort((a, b) => order(a) - order(b)), priceCap: cap };
  }, [scored]);

  const visible = useMemo(() => {
    const filtered = scored.filter(
      (l) =>
        activeTiers.has(l.tier) &&
        (activeTypes.size === 0 || (l.type && activeTypes.has(l.type))) &&
        (!furnishedOnly || l.furnished === true) &&
        (maxPrice == null || (l.price ?? Infinity) <= maxPrice) &&
        (activeNeighborhoods.size === 0 ||
          neighborhoodsOf(l.lat, l.lng).some((n) => activeNeighborhoods.has(n)))
    );
    filtered.sort((a, b) => {
      if (sort === "price") return (a.price ?? Infinity) - (b.price ?? Infinity);
      if (sort === "distance") return a.distanceM - b.distanceM;
      return b.convenienza - a.convenienza;
    });
    return filtered;
  }, [scored, activeTiers, activeTypes, furnishedOnly, maxPrice, activeNeighborhoods, sort]);

  useEffect(
    () => setLimit(PAGE),
    [activeTiers, activeTypes, furnishedOnly, maxPrice, activeNeighborhoods, sort]
  );

  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  }

  const openDetail = (id: string | number) => {
    const l = visible.find((x) => x.id === id) ?? scored.find((x) => x.id === id);
    if (l) setDetail(l);
  };

  const resetAll = () => {
    setActiveTiers(new Set(["walk30", "transit30", "transit45"]));
    setActiveTypes(new Set());
    setFurnishedOnly(false);
    setMaxPrice(null);
    setActiveNeighborhoods(new Set());
  };

  const tiersFiltered = activeTiers.size < 3;
  const hasFilters =
    tiersFiltered ||
    activeTypes.size > 0 ||
    furnishedOnly ||
    maxPrice != null ||
    activeNeighborhoods.size > 0;

  const hoodList = NEIGHBORHOODS.filter((n) =>
    n.name.toLowerCase().includes(hoodQuery.toLowerCase())
  );

  return (
    <main className="flex h-[100dvh] w-screen flex-col bg-neutral-950 md:flex-row">
      {/* Sidebar */}
      <aside
        className={`flex w-full shrink-0 flex-col bg-neutral-950 md:w-[30rem] md:border-r md:border-neutral-800 ${
          mobileMap ? "hidden md:flex" : "flex"
        }`}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-neutral-800 bg-neutral-950/95 px-5 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-xl font-bold tracking-tight text-neutral-50">
              Flatiron <span className="text-emerald-400">Radar</span>
            </h1>
            <span className="whitespace-nowrap text-sm font-medium text-neutral-400">
              {loading ? "…" : `${visible.length} case`}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            Tempo reale di arrivo a {FLATIRON.label}
          </p>

          {/* Barra filtri compatta */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FilterPopover
              label="Ordina"
              value={SORTS.find((s) => s.key === sort)!.label}
              width="w-48"
            >
              <div className="space-y-0.5">
                {SORTS.map((s) => (
                  <Row key={s.key} on={sort === s.key} onClick={() => setSort(s.key)}>
                    {s.label}
                  </Row>
                ))}
              </div>
            </FilterPopover>

            <FilterPopover
              label="Tempo"
              value={tiersFiltered ? `${activeTiers.size}/3` : null}
              width="w-60"
            >
              <div className="space-y-0.5">
                {Object.values(TIERS).map((t) => (
                  <Row
                    key={t.id}
                    on={activeTiers.has(t.id)}
                    onClick={() => setActiveTiers(toggle(activeTiers, t.id))}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: t.color }}
                    />
                    {t.label}
                  </Row>
                ))}
              </div>
            </FilterPopover>

            <FilterPopover
              label="Quartiere"
              value={
                activeNeighborhoods.size === 0
                  ? null
                  : activeNeighborhoods.size === 1
                  ? [...activeNeighborhoods][0]
                  : `${activeNeighborhoods.size} selezionati`
              }
            >
              <input
                value={hoodQuery}
                onChange={(e) => setHoodQuery(e.target.value)}
                placeholder="Cerca quartiere…"
                className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
              />
              <div className="max-h-64 space-y-0.5 overflow-y-auto">
                {hoodList.map((n) => (
                  <Row
                    key={n.name}
                    on={activeNeighborhoods.has(n.name)}
                    onClick={() => setActiveNeighborhoods(toggle(activeNeighborhoods, n.name))}
                  >
                    {n.name}
                  </Row>
                ))}
                {hoodList.length === 0 && (
                  <p className="px-2.5 py-2 text-sm text-neutral-500">Nessun risultato</p>
                )}
              </div>
            </FilterPopover>

            <FilterPopover
              label="Prezzo"
              value={maxPrice ? `≤ $${maxPrice.toLocaleString()}` : null}
              width="w-64"
            >
              <div className="px-1">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-neutral-400">Massimo</span>
                  <span className="font-semibold text-neutral-100">
                    {maxPrice ? `$${maxPrice.toLocaleString()}` : "Qualsiasi"}
                  </span>
                </div>
                <input
                  type="range"
                  min={1000}
                  max={priceCap || 20000}
                  step={250}
                  value={maxPrice ?? (priceCap || 20000)}
                  onChange={(e) => setMaxPrice(Number(e.target.value))}
                  className="h-1 w-full cursor-pointer accent-emerald-400"
                />
                {maxPrice != null && (
                  <button
                    onClick={() => setMaxPrice(null)}
                    className="mt-2 text-xs text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline"
                  >
                    Rimuovi limite
                  </button>
                )}
              </div>
            </FilterPopover>

            <FilterPopover
              label="Tipo"
              value={
                activeTypes.size || furnishedOnly
                  ? `${activeTypes.size + (furnishedOnly ? 1 : 0)}`
                  : null
              }
              width="w-56"
            >
              <div className="space-y-0.5">
                {types.map((ty) => (
                  <Row
                    key={ty}
                    on={activeTypes.has(ty)}
                    onClick={() => setActiveTypes(toggle(activeTypes, ty))}
                  >
                    {ty.toUpperCase()}
                  </Row>
                ))}
                <div className="my-1 h-px bg-neutral-800" />
                <Row on={furnishedOnly} onClick={() => setFurnishedOnly((v) => !v)}>
                  Solo arredati
                </Row>
              </div>
            </FilterPopover>
          </div>

          {/* Filtri attivi */}
          {hasFilters && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {tiersFiltered &&
                [...activeTiers].map((t) => (
                  <Pill
                    key={t}
                    label={TIERS[t as Exclude<TierId, "out">].label}
                    onRemove={() => setActiveTiers(toggle(activeTiers, t))}
                  />
                ))}
              {[...activeNeighborhoods].map((n) => (
                <Pill
                  key={n}
                  label={n}
                  onRemove={() => setActiveNeighborhoods(toggle(activeNeighborhoods, n))}
                />
              ))}
              {[...activeTypes].map((t) => (
                <Pill
                  key={t}
                  label={t.toUpperCase()}
                  onRemove={() => setActiveTypes(toggle(activeTypes, t))}
                />
              ))}
              {furnishedOnly && <Pill label="Arredati" onRemove={() => setFurnishedOnly(false)} />}
              {maxPrice != null && (
                <Pill
                  label={`≤ $${maxPrice.toLocaleString()}`}
                  onRemove={() => setMaxPrice(null)}
                />
              )}
              <button
                onClick={resetAll}
                className="ml-1 text-[11px] font-medium text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
              >
                Azzera
              </button>
            </div>
          )}
        </div>

        {/* Lista card */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-[16/13] animate-pulse rounded-2xl bg-neutral-800" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-neutral-400">Nessuna casa con questi filtri.</p>
              {hasFilters && (
                <button
                  onClick={resetAll}
                  className="mt-2 text-sm font-medium text-emerald-400 hover:underline"
                >
                  Azzera i filtri
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {visible.slice(0, limit).map((l) => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    selected={l.id === selectedId}
                    onSelect={() => setSelectedId(l.id)}
                    onOpen={() => openDetail(l.id)}
                  />
                ))}
              </div>
              {limit < visible.length && (
                <button
                  onClick={() => setLimit((n) => n + PAGE)}
                  className="mt-4 w-full rounded-full border border-neutral-700 bg-neutral-900 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-neutral-800"
                >
                  Mostra altre ({visible.length - limit})
                </button>
              )}
              <div className="h-20 md:h-2" />
            </>
          )}
        </div>
      </aside>

      {/* Mappa */}
      <div className={`relative h-full w-full flex-1 ${mobileMap ? "block" : "hidden md:block"}`}>
        <MapView
          iso={iso}
          listings={visible}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            openDetail(id);
          }}
        />
      </div>

      {/* Toggle mappa/lista su mobile */}
      <button
        onClick={() => setMobileMap((v) => !v)}
        className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-neutral-900 shadow-xl md:hidden"
      >
        {mobileMap ? "☰ Lista" : "◵ Mappa"}
      </button>

      <ListingDetail listing={detail} onClose={() => setDetail(null)} />
    </main>
  );
}
