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
import { TIERS, OUT_META, type TierId } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const EMPTY: IsochroneSet = { walk30: null, transit30: null, transit45: null };
type SortKey = "convenienza" | "price" | "distance";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "convenienza", label: "Convenienza" },
  { key: "price", label: "Prezzo" },
  { key: "distance", label: "Vicinanza" },
];

function tierMeta(id: TierId) {
  return id === "out" ? OUT_META : TIERS[id];
}

export default function Home() {
  const [iso, setIso] = useState<IsochroneSet>(EMPTY);
  const [raw, setRaw] = useState<RawListing[]>([]);
  const [sort, setSort] = useState<SortKey>("convenienza");
  const [activeTiers, setActiveTiers] = useState<Set<TierId>>(
    new Set(["walk30", "transit30", "transit45"])
  );
  const [selectedId, setSelectedId] = useState<string | number | null>(null);

  useEffect(() => {
    loadIsochrones().then(setIso);
    loadListings().then(setRaw);
  }, []);

  const scored: ScoredListing[] = useMemo(
    () => scoreListings(raw, iso),
    [raw, iso]
  );

  const visible = useMemo(() => {
    const filtered = scored.filter((l) => activeTiers.has(l.tier));
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "price") return (a.price ?? Infinity) - (b.price ?? Infinity);
      if (sort === "distance") return a.distanceM - b.distanceM;
      return b.convenienza - a.convenienza;
    });
    return sorted;
  }, [scored, activeTiers, sort]);

  function toggleTier(t: TierId) {
    setActiveTiers((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  return (
    <main className="flex h-screen w-screen flex-col md:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-gray-200 bg-white md:w-[26rem] md:border-b-0 md:border-r">
        <header className="border-b border-gray-100 p-4">
          <h1 className="text-xl font-bold">Flatiron Rental Radar</h1>
          <p className="text-sm text-gray-500">
            {visible.length} case · ordinate per tempo reale di arrivo a Flatiron
          </p>
        </header>

        {/* Controlli */}
        <div className="space-y-3 border-b border-gray-100 p-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Ordina per
            </p>
            <div className="flex gap-1.5">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    sort === s.key
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Tier
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.values(TIERS).map((t) => (
                <button
                  key={t.id}
                  onClick={() => toggleTier(t.id)}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
                  style={{
                    borderColor: t.color,
                    background: activeTiers.has(t.id) ? t.color : "transparent",
                    color: activeTiers.has(t.id) ? "white" : t.color,
                  }}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      background: activeTiers.has(t.id) ? "white" : t.color,
                    }}
                  />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 && (
            <p className="p-4 text-sm text-gray-500">
              Nessuna casa con questi filtri.
            </p>
          )}
          {visible.map((l) => {
            const meta = tierMeta(l.tier);
            const selected = l.id === selectedId;
            return (
              <button
                key={l.id}
                onClick={() => setSelectedId(l.id)}
                className={`block w-full border-b border-gray-100 p-4 text-left transition hover:bg-gray-50 ${
                  selected ? "bg-blue-50" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{l.title}</span>
                  <span className="whitespace-nowrap font-semibold">
                    {l.price ? `$${l.price.toLocaleString()}` : "—"}
                    <span className="text-xs font-normal text-gray-400">/mese</span>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-white"
                    style={{ background: meta.color }}
                  >
                    {meta.label}
                  </span>
                  {l.type && <span className="uppercase">{l.type}</span>}
                  {l.furnished != null && (
                    <span>{l.furnished ? "arredato" : "non arredato"}</span>
                  )}
                  {l.sqft && <span>{l.sqft} ft²</span>}
                  <span>{(l.distanceM / 1000).toFixed(1)} km</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.round(l.convenienza * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">
                    conv. {Math.round(l.convenienza * 100)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <p className="border-t border-gray-100 bg-amber-50 p-3 text-xs text-amber-800">
          ⚠️ Dati di esempio · isocrone &quot;mezzi&quot; approssimate. Il crawl
          reale rigenera <code>listings.json</code>. Vedi <code>PROJECT.md</code>.
        </p>
      </aside>

      <div className="relative h-full w-full flex-1">
        <MapView
          iso={iso}
          listings={visible}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </main>
  );
}
