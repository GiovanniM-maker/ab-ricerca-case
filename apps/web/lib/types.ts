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
  /** servizi dell'edificio: portineria, ascensore, lavanderia… */
  amenities?: string[];
  sources?: string[];
  /**
   * Indirizzo normalizzato, la stessa chiave con cui l'aggregatore fonde le
   * fonti ("133 w 22|4b"). E' l'aggancio con cui le case salvate si ritrovano
   * nel crawl del giorno dopo: sopravvive ai cambi di fonte, cosa che l'id non
   * fa. Assente per le schede senza civico e per i listings.json generati
   * prima di questo campo: in quei casi si ripiega sull'id.
   */
  chiave?: string | null;
}
