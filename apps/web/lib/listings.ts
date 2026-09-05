import { FLATIRON } from "./config";
import { classify, type IsochroneSet } from "./geo";
import type { Listing, TierId } from "./types";

export type RawListing = Omit<Listing, "tier">;

export interface ScoredListing extends Listing {
  distanceM: number;
  convenienza: number; // 0..1, più alto = più conveniente
}

/** Pesi del punteggio convenienza (regolabili dall'UI). */
export interface Weights {
  price: number;
  time: number;
  space: number;
  furnished: number;
  /** Premia gli annunci con foto: quelli senza sono spesso civetta o incompleti. */
  photo: number;
}

// I quattro pesi originali riscalati a 0.85, piu' 0.15 per la foto: mantiene il
// loro equilibrio relativo e fa scendere gli annunci senza immagini.
export const DEFAULT_WEIGHTS: Weights = {
  price: 0.34,
  time: 0.3,
  space: 0.13,
  furnished: 0.08,
  photo: 0.15,
};

// quanto "vale" il tier sul tempo (walk30 = migliore)
const TIER_TIME_SCORE: Record<TierId, number> = {
  walk30: 1,
  transit30: 0.66,
  transit45: 0.33,
  out: 0,
};

export function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function loadListings(): Promise<RawListing[]> {
  try {
    const res = await fetch("/data/listings.json");
    if (!res.ok) return [];
    const data = await res.json();
    return data.listings ?? [];
  } catch {
    return [];
  }
}

/** Classifica, calcola distanza e punteggio convenienza (normalizzato sul set). */
export function scoreListings(
  raw: RawListing[],
  iso: IsochroneSet,
  weights: Weights = DEFAULT_WEIGHTS
): ScoredListing[] {
  const withTier = raw.map((l) => ({
    ...l,
    tier: classify(l.lat, l.lng, iso),
    distanceM: haversineM(FLATIRON.lat, FLATIRON.lng, l.lat, l.lng),
  }));

  const prices = withTier.map((l) => l.price ?? 0).filter((p) => p > 0);
  const sqfts = withTier.map((l) => l.sqft ?? 0).filter((s) => s > 0);
  const minP = Math.min(...prices, 0);
  const maxP = Math.max(...prices, 1);
  const minS = Math.min(...sqfts, 0);
  const maxS = Math.max(...sqfts, 1);

  const norm = (v: number, lo: number, hi: number) =>
    hi > lo ? (v - lo) / (hi - lo) : 0;

  return withTier.map((l) => {
    const priceScore = l.price ? 1 - norm(l.price, minP, maxP) : 0.5;
    const timeScore = TIER_TIME_SCORE[l.tier];
    const spaceScore = l.sqft ? norm(l.sqft, minS, maxS) : 0.5;
    const furnScore = l.furnished ? 1 : 0;
    const photoScore = l.photos?.length ? 1 : 0;
    const convenienza =
      weights.price * priceScore +
      weights.time * timeScore +
      weights.space * spaceScore +
      weights.furnished * furnScore +
      weights.photo * photoScore;
    return { ...l, convenienza };
  });
}
