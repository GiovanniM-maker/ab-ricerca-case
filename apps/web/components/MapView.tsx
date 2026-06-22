"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import { FLATIRON } from "@/lib/config";
import { TIERS } from "@/lib/types";
import type { IsochroneSet } from "@/lib/geo";

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
  marker: { lat: number; lng: number };
  onPick: (lat: number, lng: number) => void;
};

function fc(feat: Feature<Polygon | MultiPolygon> | null) {
  return {
    type: "FeatureCollection" as const,
    features: feat ? [feat] : [],
  };
}

export default function MapView({ iso, marker, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // init mappa una sola volta
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
      // isocrone: dal tier più largo al più stretto, così il piccolo sta sopra
      (
        [
          ["transit45", iso.transit45],
          ["transit30", iso.transit30],
          ["walk30", iso.walk30],
        ] as const
      ).forEach(([id, feat]) => {
        const color = TIERS[id].color;
        map.addSource(id, { type: "geojson", data: fc(feat) });
        map.addLayer({
          id: `${id}-fill`,
          type: "fill",
          source: id,
          paint: { "fill-color": color, "fill-opacity": 0.15 },
        });
        map.addLayer({
          id: `${id}-line`,
          type: "line",
          source: id,
          paint: { "line-color": color, "line-width": 2 },
        });
      });

      // marker fisso Flatiron (rosso)
      new maplibregl.Marker({ color: "#dc2626" })
        .setLngLat([FLATIRON.lng, FLATIRON.lat])
        .setPopup(new maplibregl.Popup().setText("Flatiron (destinazione)"))
        .addTo(map);

      // marker di test trascinabile
      const m = new maplibregl.Marker({ color: "#111827", draggable: true })
        .setLngLat([marker.lng, marker.lat])
        .addTo(map);
      m.on("dragend", () => {
        const { lng, lat } = m.getLngLat();
        onPickRef.current(lat, lng);
      });
      markerRef.current = m;
    });

    // click sulla mappa = sposta il marker di test
    map.on("click", (e) => {
      onPickRef.current(e.lngLat.lat, e.lngLat.lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sincronizza posizione marker quando cambia da fuori (click/geocoding)
  useEffect(() => {
    markerRef.current?.setLngLat([marker.lng, marker.lat]);
  }, [marker.lat, marker.lng]);

  return <div ref={containerRef} className="h-full w-full" />;
}
