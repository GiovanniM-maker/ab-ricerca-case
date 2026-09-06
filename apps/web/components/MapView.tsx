"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import { FLATIRON } from "@/lib/config";
import { TIERS, OUT_META } from "@/lib/types";
import type { IsochroneSet } from "@/lib/geo";
import type { ScoredListing } from "@/lib/listings";

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
};

function fc(feat: Feature<Polygon | MultiPolygon> | null) {
  return { type: "FeatureCollection" as const, features: feat ? [feat] : [] };
}

function listingsFC(listings: ScoredListing[]): FeatureCollection {
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
      },
    })),
  };
}

export default function MapView({ iso, listings, selectedId, onSelect }: Props) {
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
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
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
      if (pins) return pins.setData(listingsFC(listingsRef.current));

      map.addSource("listings", { type: "geojson", data: listingsFC(listingsRef.current) });
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
        .setPopup(new maplibregl.Popup().setText(FLATIRON.label))
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
  }, [iso, listings]);

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
    const sel = listings.find((l) => l.id === selectedId);
    if (sel) map.flyTo({ center: [sel.lng, sel.lat], zoom: 14, speed: 0.8 });
  }, [selectedId, listings]);

  return <div ref={containerRef} className="h-full w-full" />;
}
