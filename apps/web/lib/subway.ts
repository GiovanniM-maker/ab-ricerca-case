/** Stazione metro: [lat, lng]. */
export type Station = [number, number];

export async function loadStations(): Promise<Station[]> {
  try {
    const res = await fetch("/data/subway_stations.json");
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// Alle latitudini di NYC un grado di longitudine vale ~0.757 di uno di latitudine.
const M_PER_DEG_LAT = 111_320;
const LNG_SCALE = Math.cos((40.74 * Math.PI) / 180);

/**
 * Metri in linea d'aria dalla stazione piu' vicina.
 * Proiezione equirettangolare: su scala urbana l'errore e' trascurabile ed e'
 * molto piu' veloce dell'haversine, con ~1800 case x ~500 stazioni per passata.
 */
export function nearestStationM(
  lat: number,
  lng: number,
  stations: Station[]
): number | null {
  if (!stations.length) return null;
  let best = Infinity;
  for (let i = 0; i < stations.length; i++) {
    const dLat = stations[i][0] - lat;
    const dLng = (stations[i][1] - lng) * LNG_SCALE;
    const d2 = dLat * dLat + dLng * dLng;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best) * M_PER_DEG_LAT;
}

/** ~5 minuti a piedi: la metro e' praticamente sotto casa. */
const ACCESS_GOOD_M = 400;
/** ~15 minuti a piedi: ogni spostamento inizia con una camminata seria. */
const ACCESS_BAD_M = 1200;

/**
 * Quanto e' comodo raggiungere la metro, da 0 a 1.
 * Conta solo per le case che NON sono a distanza pedonale dalla destinazione:
 * per quelle, i minuti "porta-stazione" fanno parte del viaggio vero.
 */
export function transitAccessScore(distanceM: number | null): number {
  if (distanceM == null) return 0.6; // sconosciuta: né premiata né punita troppo
  if (distanceM <= ACCESS_GOOD_M) return 1;
  if (distanceM >= ACCESS_BAD_M) return 0;
  return 1 - (distanceM - ACCESS_GOOD_M) / (ACCESS_BAD_M - ACCESS_GOOD_M);
}
