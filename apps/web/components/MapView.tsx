"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import { FLATIRON } from "@/lib/config";
import { TIERS, OUT_META } from "@/lib/types";
import type { IsochroneSet } from "@/lib/geo";
import type { ScoredListing } from "@/lib/listings";
import { rifDi } from "@/lib/wishlist";

// CARTO ha iniziato a chiedere una chiave e serve mattonelle con scritto
// "API KEY REQUIRED" sopra tutta la citta'. Esri Dark Gray e' scuro di suo e
// non chiede chiavi, quindi resta nello spirito "tutto gratuito" del progetto.
const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: "raster",
      // Attenzione all'ordine: Esri usa {z}/{y}/{x}, non {z}/{x}/{y}.
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "© Esri · © OpenStreetMap",
    },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
};

type Props = {
  iso: IsochroneSet;
  listings: ScoredListing[];
  selectedId: string | number | null;
  onSelect: (id: string | number) => void;
  /** i "rif" delle case salvate: quelle prendono un alone */
  salvate: Set<string>;
  /**
   * Firma dei filtri attivi: quando cambia, la mappa si adatta ai risultati.
   * Non cambia con l'ordinamento ne' con la selezione di una casa.
   */
  fitKey: string;
};

const NOMI_TIER = [
  { id: "walk30", label: "≤ 30 min a piedi", color: TIERS.walk30.color },
  { id: "transit30", label: "≤ 30 min coi mezzi", color: TIERS.transit30.color },
  { id: "transit45", label: "≤ 45 min coi mezzi", color: TIERS.transit45.color },
] as const;

function fc(feat: Feature<Polygon | MultiPolygon> | null) {
  return { type: "FeatureCollection" as const, features: feat ? [feat] : [] };
}

function listingsFC(listings: ScoredListing[], salvate: Set<string>): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: listings.map((l) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [l.lng, l.lat] },
      properties: {
        id: l.id,
        tier: l.tier,
        color: l.tier === "out" ? OUT_META.color : TIERS[l.tier].color,
        title: l.title,
        price: l.price ?? 0,
        // Sta nel dato e non in un livello a parte con un filtro per id:
        // cosi' l'alone segue i pallini a ogni setData senza doversi
        // ricostruire, e non puo' finire fuori sincrono con loro.
        salvata: salvate.has(rifDi(l)) || salvate.has(String(l.id)),
      },
    })),
  };
}

export default function MapView({ iso, listings, selectedId, onSelect, salvate, fitKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // I gestori della mappa vivono fuori dal ciclo di React: leggono da qui per
  // avere sempre l'ultimo valore invece di quello catturato al montaggio.
  const isoRef = useRef(iso);
  isoRef.current = iso;
  const listingsRef = useRef(listings);
  listingsRef.current = listings;
  const salvateRef = useRef(salvate);
  salvateRef.current = salvate;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const selezionataPrima = useRef<string | number | null>(null);
  const applyRef = useRef<(() => void) | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: [FLATIRON.lng, FLATIRON.lat],
      zoom: 12,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    /**
     * Crea le sorgenti la prima volta, poi si limita ad aggiornarle.
     *
     * Prima le sorgenti nascevano dentro map.on("load") con i valori catturati
     * al montaggio, cioe' vuoti: se i dati arrivavano PRIMA che la mappa fosse
     * pronta, l'effetto di aggiornamento usciva subito (mappa non pronta) e poi
     * il load ci metteva dentro l'array vuoto. Nessuno rimediava piu', e la
     * mappa restava senza pallini. Le isocrone stavano anche peggio: per loro
     * un effetto di aggiornamento non esisteva proprio.
     */
    const applyData = () => {
      const map = mapRef.current;
      if (!map) return;
      try {
        addOrUpdate(map);
      } catch {
        // "Style is not done loading": lo stile non e' ancora pronto.
        // Non e' un errore da segnalare, e' solo troppo presto: ci riprova
        // il tentativo periodico qui sotto.
      }
    };

    const addOrUpdate = (map: maplibregl.Map) => {

      ([
        ["transit45", isoRef.current.transit45],
        ["transit30", isoRef.current.transit30],
        ["walk30", isoRef.current.walk30],
      ] as const).forEach(([id, feat]) => {
        const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
        if (src) return src.setData(fc(feat));
        map.addSource(id, { type: "geojson", data: fc(feat) });
        map.addLayer({
          id: `${id}-fill`,
          type: "fill",
          source: id,
          paint: { "fill-color": TIERS[id].color, "fill-opacity": 0.14 },
        });
        map.addLayer({
          id: `${id}-line`,
          type: "line",
          source: id,
          paint: { "line-color": TIERS[id].color, "line-width": 2, "line-opacity": 0.9, "line-dasharray": [2, 1] },
        });
      });

      const pins = map.getSource("listings") as maplibregl.GeoJSONSource | undefined;
      if (pins) return pins.setData(listingsFC(listingsRef.current, salvateRef.current));

      map.addSource("listings", {
        type: "geojson",
        data: listingsFC(listingsRef.current, salvateRef.current),
      });

      // L'alone va PRIMA dei pallini, cosi' resta sotto e non ne copre il colore
      // del tier, che e' l'informazione principale.
      map.addLayer({
        id: "salvate-alone",
        type: "circle",
        source: "listings",
        filter: ["==", ["get", "salvata"], true],
        paint: {
          // Anello pieno e ben visibile: nella vista "Tutte" e' l'unico segno
          // di quali pallini hai gia' messo da parte.
          "circle-radius": 14,
          "circle-color": "#10b981",
          "circle-opacity": 0.18,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#34d399",
        },
      });
      map.addLayer({
        id: "listings-circles",
        type: "circle",
        source: "listings",
        paint: {
          "circle-radius": ["case", ["==", ["get", "id"], selectedRef.current ?? "__none__"], 13, 7],
          "circle-color": [
            "case",
            ["==", ["get", "id"], selectedRef.current ?? "__none__"],
            "#f59e0b",
            ["get", "color"],
          ],
          "circle-stroke-width": ["case", ["==", ["get", "id"], selectedRef.current ?? "__none__"], 3, 2],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "id"], selectedRef.current ?? "__none__"],
            "#ffffff",
            "#0a0a0a",
          ],
        },
        layout: {
          "circle-sort-key": ["case", ["==", ["get", "id"], selectedRef.current ?? "__none__"], 1, 0],
        },
      });

      map.on("click", "listings-circles", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id != null) onSelectRef.current(id);
      });
      map.on("mouseenter", "listings-circles", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "listings-circles", () => {
        map.getCanvas().style.cursor = "";
      });
    };
    applyRef.current = applyData;

    // MapLibre considera lo stile "caricato" solo quando lo sono anche le
    // mattonelle dello sfondo. Agganciando i pallini a quel momento, uno
    // sfondo lento o irraggiungibile faceva sparire le case: i dati sono
    // nostri e locali, non devono dipendere da un CDN di mappe. Riproviamo
    // finche' non entrano, e ci fermiamo appena ci siamo riusciti.
    const retry = setInterval(() => {
      applyData();
      if (mapRef.current?.getLayer("listings-circles")) clearInterval(retry);
    }, 300);
    retryRef.current = retry;

    // Non ci appendiamo a un solo evento. "load" e' quello canonico, ma se
    // per qualsiasi motivo non scatta (mattonelle che non arrivano, stile
    // lento) la mappa resterebbe vuota per sempre. applyData e' idempotente:
    // guarda se la sorgente c'e' gia' e nel caso si limita ad aggiornarla,
    // quindi chiamarla piu' volte non costa nulla.
    map.on("styledata", applyData);
    map.on("idle", applyData);

    map.on("load", () => {
      // destinazione (punto di ancoraggio)
      new maplibregl.Marker({ color: "#dc2626" })
        .setLngLat([FLATIRON.lng, FLATIRON.lat])
        .setPopup(new maplibregl.Popup({ closeButton: true }).setText(FLATIRON.label))
        .addTo(map);

      applyData();
      readyRef.current = true;
    });

    return () => {
      if (retryRef.current) clearInterval(retryRef.current);
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ripassa i dati quando arrivano. Se la mappa non e' ancora pronta non
  // serve fare nulla: al termine del caricamento chiama lei la stessa funzione.
  useEffect(() => {
    applyRef.current?.();
  }, [iso, listings, salvate]);

  // evidenzia + centra il selezionato
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (map.getLayer("listings-circles")) {
      const isSelected = ["==", ["get", "id"], selectedId ?? "__none__"] as maplibregl.ExpressionSpecification;
      map.setPaintProperty("listings-circles", "circle-radius", [
        "case",
        isSelected,
        13,
        7,
      ]);
      map.setPaintProperty("listings-circles", "circle-color", [
        "case",
        isSelected,
        "#f59e0b",
        ["get", "color"],
      ]);
      map.setPaintProperty("listings-circles", "circle-stroke-width", [
        "case",
        isSelected,
        3,
        2,
      ]);
      map.setPaintProperty("listings-circles", "circle-stroke-color", [
        "case",
        isSelected,
        "#ffffff",
        "#0a0a0a",
      ]);
      map.setLayoutProperty("listings-circles", "circle-sort-key", [
        "case",
        isSelected,
        1,
        0,
      ]);
    }
    // Si centra solo quando CAMBIA la selezione: prima ripartiva a ogni cambio
    // di elenco e annullava l'adattamento ai filtri.
    if (selectedId !== selezionataPrima.current) {
      selezionataPrima.current = selectedId;
      const sel = listings.find((l) => l.id === selectedId);
      if (sel) map.flyTo({ center: [sel.lng, sel.lat], zoom: 14, speed: 0.8 });
    }
  }, [selectedId, listings]);

  // Adatta la mappa ai risultati quando cambiano i filtri (non al primo
  // caricamento, che resta sull'area intera, ne' quando cambia l'ordinamento).
  const fitPrima = useRef(fitKey);
  const fitInSospeso = useRef(false);
  const adatta = () => {
    const map = mapRef.current;
    const el = containerRef.current;
    const elenco = listingsRef.current;
    if (!map || !el || !elenco.length) return;
    // Mappa nascosta (telefono, vista lista): si rimanda a quando ha una misura.
    if (el.clientWidth === 0 || el.clientHeight === 0) {
      fitInSospeso.current = true;
      return;
    }
    fitInSospeso.current = false;
    const b = new maplibregl.LngLatBounds();
    for (const l of elenco) b.extend([l.lng, l.lat]);
    map.fitBounds(b, { padding: 70, maxZoom: 15, duration: 600 });
  };
  const adattaRef = useRef(adatta);
  adattaRef.current = adatta;

  useEffect(() => {
    if (fitKey === fitPrima.current) return;
    fitPrima.current = fitKey;
    adattaRef.current();
  }, [fitKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (fitInSospeso.current) adattaRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Legenda: conta i pallini per fascia di tempo sull'elenco mostrato.
  const conteggi = { walk30: 0, transit30: 0, transit45: 0 } as Record<string, number>;
  for (const l of listings) if (l.tier in conteggi) conteggi[l.tier]++;

  return (
    <div className="relative h-full w-full">
      {/* Il canvas non si naviga da tastiera: la lista accanto ha le stesse case. */}
      <div
        ref={containerRef}
        className="h-full w-full"
        role="region"
        aria-label="Mappa delle case. Le stesse case sono nella lista, con tutti i dettagli"
      />
      {/* Legenda: senza, i colori dei pallini non si spiegavano da nessuna parte. */}
      <div className="pointer-events-none absolute bottom-8 left-3 z-10 rounded-xl border border-neutral-700 bg-neutral-900/90 px-3 py-2 text-[11px] text-neutral-200 shadow-lg backdrop-blur">
        <ul className="space-y-1">
          {NOMI_TIER.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full border border-neutral-950"
                style={{ background: t.color }}
              />
              <span>{t.label}</span>
              <span className="ml-auto pl-3 tabular-nums text-neutral-400">{conteggi[t.id]}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 border-t border-neutral-700 pt-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-emerald-400 bg-emerald-500/20" />
            <span>Salvata</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500" />
            <span>Selezionata</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" />
            <span>Flatiron</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
