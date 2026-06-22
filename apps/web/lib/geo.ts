import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { TierId } from "./types";

export type IsochroneSet = {
  walk30: Feature<Polygon | MultiPolygon> | null;
  transit30: Feature<Polygon | MultiPolygon> | null;
  transit45: Feature<Polygon | MultiPolygon> | null;
};

/**
 * Classifica un punto nel tier PIÙ STRETTO che lo contiene.
 * walk30 ⊂ transit30 ⊂ transit45, quindi si controlla dal più stretto al più largo.
 * Questo è il cuore della Fase 1: nessun routing server, solo point-in-polygon.
 */
export function classify(lat: number, lng: number, iso: IsochroneSet): TierId {
  const p = point([lng, lat]); // GeoJSON è [lng, lat]
  if (iso.walk30 && booleanPointInPolygon(p, iso.walk30)) return "walk30";
  if (iso.transit30 && booleanPointInPolygon(p, iso.transit30)) return "transit30";
  if (iso.transit45 && booleanPointInPolygon(p, iso.transit45)) return "transit45";
  return "out";
}

/** Carica i 3 GeoJSON dalla cartella public/data. */
export async function loadIsochrones(): Promise<IsochroneSet> {
  const fetchFeature = async (
    name: string
  ): Promise<Feature<Polygon | MultiPolygon> | null> => {
    try {
      const res = await fetch(`/data/${name}.geojson`);
      if (!res.ok) return null;
      const fc = await res.json();
      return fc.features?.[0] ?? null;
    } catch {
      return null;
    }
  };

  const [walk30, transit30, transit45] = await Promise.all([
    fetchFeature("iso_walk30"),
    fetchFeature("iso_transit30"),
    fetchFeature("iso_transit45"),
  ]);

  return { walk30, transit30, transit45 };
}
