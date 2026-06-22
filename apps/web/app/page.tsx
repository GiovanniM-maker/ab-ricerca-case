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
        (maxPrice == null || (l.price ?? Infinity) <= maxPrice)
    );
    filtered.sort((a, b) => {
      if (sort === "price") return (a.price ?? Infinity) - (b.price ?? Infinity);
      if (sort === "distance") return a.distanceM - b.distanceM;
      return b.convenienza - a.convenienza;
    });
    return filtered;
  }, [scored, activeTiers, activeTypes, furnishedOnly, maxPrice, sort]);

  useEffect(() => setLimit(PAGE), [activeTiers, activeTypes, furnishedOnly, maxPrice, sort]);

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
    <main className="flex h-screen w-screen flex-col bg-neutral-50 md:flex-row">
      {/* Sidebar */}
      <aside
        className={`flex w-full shrink-0 flex-col bg-neutral-50 md:w-[30rem] md:border-r md:border-neutral-200 ${
          mobileMap ? "hidden md:flex" : "flex"
        }`}
      >
        {/* Header + filtri */}
        <div className="shrink-0 border-b border-neutral-200 bg-white/80 px-5 pb-4 pt-5 backdrop-blur">
          <div className="flex items-baseline justify-between">
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Flatiron <span className="text-emerald-600">Radar</span>
            </h1>
            <span className="text-sm text-neutral-400">
              {loading ? "…" : `${visible.length} case`}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-400">
            Affitti ordinati per tempo reale di arrivo a Flatiron
          </p>

          {/* sort */}
          <div className="mt-3 flex gap-1.5">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  sort === s.key
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
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
            {types.map((ty) => {
              const on = activeTypes.has(ty);
              return (
                <button
                  key={ty}
                  onClick={() => setActiveTypes(toggle(activeTypes, ty))}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    on ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {ty.toUpperCase()}
                </button>
              );
            })}
            <button
              onClick={() => setFurnishedOnly((v) => !v)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                furnishedOnly ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              Arredati
            </button>
          </div>

          {/* prezzo max */}
          <div className="mt-3 flex items-center gap-3">
            <span className="text-xs text-neutral-400">Max</span>
            <input
              type="range"
              min={1000}
              max={priceCap || 20000}
              step={250}
              value={maxPrice ?? (priceCap || 20000)}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer accent-neutral-900"
            />
            <span className="w-20 text-right text-xs font-medium tabular-nums text-neutral-600">
              {maxPrice ? `$${maxPrice.toLocaleString()}` : "Qualsiasi"}
            </span>
          </div>
        </div>

        {/* Lista card */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-[16/13] animate-pulse rounded-2xl bg-neutral-200" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-400">
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
                  className="mt-4 w-full rounded-full border border-neutral-300 bg-white py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
                >
                  Mostra altre ({visible.length - limit})
                </button>
              )}
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

      {/* Toggle mappa mobile */}
      <button
        onClick={() => setMobileMap((v) => !v)}
        className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg md:hidden"
      >
        {mobileMap ? "Lista" : "Mappa"}
      </button>

      <ListingDetail listing={detail} onClose={() => setDetail(null)} />
    </main>
  );
}
