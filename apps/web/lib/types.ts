export type TierId = "walk30" | "transit30" | "transit45" | "out";

export interface TierMeta {
  id: TierId;
  label: string;
  color: string;
}

export const TIERS: Record<Exclude<TierId, "out">, TierMeta> = {
  walk30: { id: "walk30", label: "≤ 30 min a piedi", color: "#16a34a" },
  transit30: { id: "transit30", label: "≤ 30 min coi mezzi", color: "#2563eb" },
  transit45: { id: "transit45", label: "≤ 45 min coi mezzi", color: "#9333ea" },
};

export const OUT_META: TierMeta = {
  id: "out",
  label: "fuori area",
  color: "#9ca3af",
};

/** Annuncio normalizzato (allineato a db/schema.sql). */
export interface Listing {
  id: number | string;
  source: string;
  sourceUrl: string;
  title: string;
  price: number | null;
  /** true se il prezzo e' un "a partire da" (piu' unita' nello stesso palazzo). */
  priceFrom?: boolean;
  currency: string;
  type: string | null;
  furnished: boolean | null;
  sqft: number | null;
  lat: number;
  lng: number;
  tier: TierId;
  travelMinutes?: number | null;
  photos: string[];
  sources?: string[];
}
