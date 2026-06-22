"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { FLATIRON } from "@/lib/config";
import { classify, loadIsochrones, type IsochroneSet } from "@/lib/geo";
import { TIERS, OUT_META, type TierId } from "@/lib/types";

// MapLibre usa `window`: niente SSR.
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const EMPTY: IsochroneSet = { walk30: null, transit30: null, transit45: null };

function tierMeta(id: TierId) {
  return id === "out" ? OUT_META : TIERS[id];
}

export default function Home() {
  const [iso, setIso] = useState<IsochroneSet>(EMPTY);
  const [marker, setMarker] = useState({ lat: 40.7359, lng: -73.9911 }); // Union Sq area
  const [address, setAddress] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    loadIsochrones().then(setIso);
  }, []);

  const tier: TierId = useMemo(
    () => classify(marker.lat, marker.lng, iso),
    [marker, iso]
  );
  const meta = tierMeta(tier);

  async function geocode() {
    if (!address.trim()) return;
    setGeocoding(true);
    setGeoError(null);
    try {
      // US Census Geocoder — gratis, senza API key.
      const url =
        "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
        `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
      const res = await fetch(url);
      const data = await res.json();
      const match = data?.result?.addressMatches?.[0];
      if (!match) {
        setGeoError("Indirizzo non trovato dal geocoder Census.");
        return;
      }
      setMarker({ lat: match.coordinates.y, lng: match.coordinates.x });
    } catch {
      setGeoError("Geocoding non riuscito (rete/CORS). Clicca sulla mappa.");
    } finally {
      setGeocoding(false);
    }
  }

  return (
    <main className="flex h-screen w-screen flex-col md:flex-row">
      {/* Pannello laterale */}
      <aside className="w-full shrink-0 space-y-5 overflow-y-auto border-b border-gray-200 bg-white p-5 md:w-96 md:border-b-0 md:border-r">
        <header>
          <h1 className="text-xl font-bold">Flatiron Rental Radar</h1>
          <p className="text-sm text-gray-500">
            Fase 1 — isocrone &amp; classificazione. Clicca sulla mappa o trascina
            il pin nero per vedere in che tier cade un punto.
          </p>
        </header>

        {/* Geocoding indirizzo */}
        <div className="space-y-2">
          <label className="text-sm font-semibold">Prova un indirizzo</label>
          <div className="flex gap-2">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && geocode()}
              placeholder="es. 100 W 20th St, New York, NY"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <button
              onClick={geocode}
              disabled={geocoding}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {geocoding ? "…" : "Vai"}
            </button>
          </div>
          {geoError && <p className="text-xs text-red-600">{geoError}</p>}
        </div>

        {/* Risultato classificazione */}
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">
            Tier del punto selezionato
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: meta.color }}
            />
            <span className="text-lg font-semibold">{meta.label}</span>
          </div>
          <p className="mt-1 font-mono text-xs text-gray-500">
            {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
          </p>
        </div>

        {/* Legenda */}
        <div className="space-y-2">
          <p className="text-sm font-semibold">Legenda tier</p>
          {Object.values(TIERS).map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: t.color }}
              />
              {t.label}
            </div>
          ))}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: OUT_META.color }}
            />
            {OUT_META.label}
          </div>
        </div>

        <p className="rounded bg-amber-50 p-3 text-xs text-amber-800">
          ⚠️ Le isocrone &quot;mezzi&quot; sono <b>approssimazioni</b> provvisorie.
          Vanno rigenerate con dati di transito reali (OpenTripPlanner + GTFS MTA).
          Vedi <code>PROJECT.md</code>.
        </p>
      </aside>

      {/* Mappa */}
      <div className="relative h-full w-full flex-1">
        <MapView
          iso={iso}
          marker={marker}
          onPick={(lat, lng) => setMarker({ lat, lng })}
        />
      </div>
    </main>
  );
}
