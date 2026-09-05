import { FLATIRON } from "./config";
import { classify, type IsochroneSet } from "./geo";
import type { Listing, TierId } from "./types";
import { nearestStationM, transitAccessScore, type Station } from "./subway";
import { neighborhoodsOf } from "./neighborhoods";

export type RawListing = Omit<Listing, "tier">;

export interface ScoredListing extends Listing {
  distanceM: number;
  convenienza: number; // 0..1, più alto = più conveniente
  /** metri dalla metro piu' vicina (null per chi arriva a piedi: non serve) */
  stationM: number | null;
  /** quartiere piu' specifico che contiene la casa */
  neighborhood: string | null;
}

/** Pesi del punteggio convenienza (regolabili dall'UI). */
export interface Weights {
  price: number;
  time: number;
  space: number;
  furnished: number;
  /** Premia gli annunci con foto: quelli senza sono spesso civetta o incompleti. */
  photo: number;
  /** Servizi dell'edificio: portineria che ritira i pacchi, ascensore, lavanderia… */
  services: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  price: 0.34,
  time: 0.3,
  space: 0.1,
  furnished: 0.01,
  photo: 0.15,
  services: 0.1,
};

// Servizi dell'edificio e quanto valgono. La portineria vale piu' di tutto:
// a NYC significa avere qualcuno che ritira e tiene le consegne.
const SERVICES: { key: string; value: number }[] = [
  { key: "doorman", value: 1 },
  { key: "concierge", value: 1 },
  { key: "package", value: 0.8 },
  { key: "elevator", value: 0.6 },
  { key: "washer", value: 0.6 },
  { key: "laundry", value: 0.5 },
  { key: "gym", value: 0.4 },
  { key: "fitness", value: 0.4 },
  { key: "storage", value: 0.3 },
  { key: "roof", value: 0.3 },
];
/** Somma di servizi oltre la quale il punteggio e' pieno. */
const SERVICES_MAX = 2.5;

/** Da 0 a 1 in base ai servizi dell'edificio. */
export function servicesScore(amenities?: string[] | null): number {
  if (!amenities?.length) return 0;
  const norm = amenities.map((a) => a.toLowerCase());
  let sum = 0;
  for (const { key, value } of SERVICES) {
    if (norm.some((a) => a.includes(key))) sum += value;
  }
  return Math.min(1, sum / SERVICES_MAX);
}

// Quanto "vale" il tier sul tempo. Andare a piedi non e' solo veloce: e' gratis,
// senza attese, cambi o affollamento. Percio' il salto tra piedi e mezzi e' molto
// piu' marcato del semplice divario di minuti.
const TIER_TIME_SCORE: Record<TierId, number> = {
  walk30: 1,
  transit30: 0.5,
  transit45: 0.2,
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

/**
 * Prezzo minimo credibile per tipologia (intero appartamento, area entro 45 min
 * da Flatiron). Sotto queste cifre l'annuncio non e' un affitto reale: in pratica
 * sono esche, subentri di contratto, stanze singole o locali commerciali.
 * Volutamente prudenti, per non scartare veri affitti economici in periferia.
 */
const PRICE_FLOORS: Record<string, number> = {
  studio: 1200,
  "1br": 1400,
  "2br": 1700,
  "3br": 2100,
  "4br": 2500,
  "5br": 2500,
  "6br": 2500,
};

/** false se l'annuncio ha un prezzo implausibile per la sua tipologia (civetta). */
export function isPlausibleListing(l: RawListing): boolean {
  const floor = PRICE_FLOORS[l.type ?? ""] ?? 0;
  return l.price == null || l.price >= floor;
}

export async function loadListings(): Promise<RawListing[]> {
  try {
    const res = await fetch("/data/listings.json");
    if (!res.ok) return [];
    const data = await res.json();
    return (data.listings ?? []).filter(isPlausibleListing);
  } catch {
    return [];
  }
}

/** Classifica, calcola distanza e punteggio convenienza (normalizzato sul set). */
export function scoreListings(
  raw: RawListing[],
  iso: IsochroneSet,
  stations: Station[] = [],
  weights: Weights = DEFAULT_WEIGHTS
): ScoredListing[] {
  const withTier = raw.map((l) => ({
    ...l,
    tier: classify(l.lat, l.lng, iso),
    distanceM: haversineM(FLATIRON.lat, FLATIRON.lng, l.lat, l.lng),
  }));

  const sqfts = withTier.map((l) => l.sqft ?? 0).filter((s) => s > 0);
  const minS = Math.min(...sqfts, 0);
  const maxS = Math.max(...sqfts, 1);

  const norm = (v: number, lo: number, hi: number) =>
    hi > lo ? (v - lo) / (hi - lo) : 0;

  // Il prezzo si normalizza per PERCENTILE, non min-max: con affitti da $1.400 a
  // $65.000 un solo attico schiaccerebbe tutti gli altri nello stesso punteggio
  // (fra il 1o e il 3o quartile ballavano meno di 2 punti su 100).
  const sortedPrices = withTier
    .map((l) => l.price ?? 0)
    .filter((p) => p > 0)
    .sort((a, b) => a - b);

  /** frazione di annunci non piu' cari di `v` (0 = il piu' economico, 1 = il piu' caro) */
  const pricePercentile = (v: number) => {
    if (!sortedPrices.length) return 0.5;
    let lo = 0;
    let hi = sortedPrices.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedPrices[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo / sortedPrices.length;
  };

  return withTier.map((l) => {
    const priceScore = l.price ? 1 - pricePercentile(l.price) : 0.5;

    // Chi arriva a piedi non usa i mezzi: la fermata non c'entra. Per tutti gli
    // altri, i minuti casa-fermata fanno parte del viaggio e pesano fino al 40%
    // del punteggio tempo.
    const walking = l.tier === "walk30";
    const stationM = walking ? null : nearestStationM(l.lat, l.lng, stations);
    let timeScore = TIER_TIME_SCORE[l.tier];
    if (!walking && l.tier !== "out") {
      timeScore *= 0.6 + 0.4 * transitAccessScore(stationM);
    }

    const spaceScore = l.sqft ? norm(l.sqft, minS, maxS) : 0.5;
    const furnScore = l.furnished ? 1 : 0;
    const photoScore = l.photos?.length ? 1 : 0;
    const servScore = servicesScore(l.amenities);
    const convenienza =
      weights.price * priceScore +
      weights.time * timeScore +
      weights.space * spaceScore +
      weights.furnished * furnScore +
      weights.photo * photoScore +
      weights.services * servScore;
    // NEIGHBORHOODS e' ordinato dal piu' specifico al piu' generico,
    // quindi il primo match e' il quartiere giusto da mostrare.
    const neighborhood = neighborhoodsOf(l.lat, l.lng)[0] ?? null;
    return { ...l, convenienza, stationM, neighborhood };
  });
}
