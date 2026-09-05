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
import ListingCard from "@/components/ListingCard";
import ListingDetail from "@/components/ListingDetail";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const EMPTY: IsochroneSet = { walk30: null, transit30: null, transit45: null };
type SortKey = "convenienza" | "price" | "distance";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "convenienza", label: "Convenienza" },
  { key: "price", label: "Prezzo" },
  { key: "distance", label: "Vicinanza" },
];
const PAGE = 30;

const chip = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-xs font-medium transition ${
    on ? "bg-white text-neutral-900" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
  }`;

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

  return (
    <main className="flex h-[100dvh] w-screen flex-col bg-neutral-950 md:flex-row">
      {/* Sidebar */}
      <aside
        className={`flex w-full shrink-0 flex-col bg-neutral-950 md:w-[30rem] md:border-r md:border-neutral-800 ${
          mobileMap ? "hidden md:flex" : "flex"
        }`}
      >
        {/* Header + filtri */}
        <div className="shrink-0 border-b border-neutral-800 bg-neutral-950/90 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-baseline justify-between">
            <h1 className="text-xl font-bold tracking-tight text-neutral-50">
              Flatiron <span className="text-emerald-400">Radar</span>
            </h1>
            <span className="text-sm text-neutral-500">
              {loading ? "…" : `${visible.length} case`}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">
            Affitti ordinati per tempo reale di arrivo a Flatiron
          </p>

          {/* sort */}
          <div className="mt-3 flex gap-1.5">
            {SORTS.map((s) => (
              <button key={s.key} onClick={() => setSort(s.key)} className={chip(sort === s.key)}>
                {s.label}
              </button>
            ))}
          </div>

          {/* tier */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.values(TIERS).map((t) => {
              const on = activeTiers.has(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTiers(toggle(activeTiers, t.id))}
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition"
                  style={{
                    borderColor: t.color,
                    background: on ? t.color : "transparent",
                    color: on ? "white" : t.color,
                  }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: on ? "white" : t.color }}
                  />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* type + furnished */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {types.map((ty) => (
              <button
                key={ty}
                onClick={() => setActiveTypes(toggle(activeTypes, ty))}
                className={chip(activeTypes.has(ty))}
              >
                {ty.toUpperCase()}
              </button>
            ))}
            <button onClick={() => setFurnishedOnly((v) => !v)} className={chip(furnishedOnly)}>
              Arredati
            </button>
          </div>

          {/* prezzo max */}
          <div className="mt-3 flex items-center gap-3">
            <span className="text-xs text-neutral-500">Max</span>
            <input
              type="range"
              min={1000}
              max={priceCap || 20000}
              step={250}
              value={maxPrice ?? (priceCap || 20000)}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer accent-emerald-400"
            />
            <span className="w-20 text-right text-xs font-medium tabular-nums text-neutral-300">
              {maxPrice ? `$${maxPrice.toLocaleString()}` : "Qualsiasi"}
            </span>
          </div>

          {/* quartiere */}
          <div className="mt-3">
            <span className="text-xs text-neutral-500">Quartiere</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {NEIGHBORHOODS.map((n) => (
                <button
                  key={n.name}
                  onClick={() => setActiveNeighborhoods(toggle(activeNeighborhoods, n.name))}
                  className={chip(activeNeighborhoods.has(n.name))}
                >
                  {n.name}
                </button>
              ))}
            </div>
          </div>
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
            <p className="py-10 text-center text-sm text-neutral-500">
              Nessuna casa con questi filtri.
            </p>
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
