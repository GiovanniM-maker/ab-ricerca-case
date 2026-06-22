"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import { FLATIRON } from "@/lib/config";
import { TIERS, OUT_META } from "@/lib/types";
import type { IsochroneSet } from "@/lib/geo";
import type { ScoredListing } from "@/lib/listings";

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [FLATIRON.lng, FLATIRON.lat],
      zoom: 12,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      // isocrone (dal più largo al più stretto)
      (
        [
          ["transit45", iso.transit45],
          ["transit30", iso.transit30],
          ["walk30", iso.walk30],
        ] as const
      ).forEach(([id, feat]) => {
        map.addSource(id, { type: "geojson", data: fc(feat) });
        map.addLayer({
          id: `${id}-fill`,
          type: "fill",
          source: id,
          paint: { "fill-color": TIERS[id].color, "fill-opacity": 0.1 },
        });
        map.addLayer({
          id: `${id}-line`,
          type: "line",
          source: id,
          paint: { "line-color": TIERS[id].color, "line-width": 1.5, "line-dasharray": [2, 1] },
        });
      });

      // annunci
      map.addSource("listings", { type: "geojson", data: listingsFC(listings) });
      map.addLayer({
        id: "listings-circles",
        type: "circle",
        source: "listings",
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "id"], selectedId ?? "__none__"],
            11,
            7,
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
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

      // destinazione Flatiron
      new maplibregl.Marker({ color: "#dc2626" })
        .setLngLat([FLATIRON.lng, FLATIRON.lat])
        .setPopup(new maplibregl.Popup().setText("Flatiron (destinazione)"))
        .addTo(map);

      readyRef.current = true;
    });

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // aggiorna i pin quando cambiano gli annunci
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("listings") as maplibregl.GeoJSONSource | undefined;
    src?.setData(listingsFC(listings));
  }, [listings]);

  // evidenzia + centra il selezionato
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (map.getLayer("listings-circles")) {
      map.setPaintProperty("listings-circles", "circle-radius", [
        "case",
        ["==", ["get", "id"], selectedId ?? "__none__"],
        11,
        7,
      ]);
    }
    const sel = listings.find((l) => l.id === selectedId);
    if (sel) map.flyTo({ center: [sel.lng, sel.lat], zoom: 14, speed: 0.8 });
  }, [selectedId, listings]);

  return <div ref={containerRef} className="h-full w-full" />;
}
