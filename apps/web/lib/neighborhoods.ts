export interface Neighborhood {
  name: string;
  /** [south, north, west, east] */
  bbox: [number, number, number, number];
  /** Se true, un punto dentro Manhattan NON appartiene a quest'area (borough esterni). */
  excludeManhattan?: boolean;
}

/**
 * Contorno approssimato dell'isola di Manhattan, in [lng, lat].
 * Serve a impedire che i box larghi dei borough (Brooklyn, Queens, Bronx)
 * inghiottano Manhattan: i rettangoli da soli non separano le due sponde
 * dell'East River.
 */
const MANHATTAN_OUTLINE: [number, number][] = [
  // sponda ovest (Hudson), da sud a nord
  [-74.0175, 40.7005],
  [-74.0140, 40.7110],
  [-74.0110, 40.7280],
  [-74.0095, 40.7430],
  [-74.0085, 40.7560],
  [-73.9995, 40.7700],
  [-73.9860, 40.7900],
  [-73.9730, 40.8100],
  [-73.9600, 40.8340],
  [-73.9460, 40.8550],
  [-73.9330, 40.8720],
  // punta nord (Inwood)
  [-73.9220, 40.8790],
  [-73.9100, 40.8730],
  // sponda est (Harlem River / East River), da nord a sud
  [-73.9280, 40.8450],
  [-73.9340, 40.8150],
  [-73.9340, 40.7960],
  [-73.9370, 40.7820],
  [-73.9420, 40.7740],
  [-73.9490, 40.7650],
  [-73.9600, 40.7540],
  [-73.9680, 40.7430],
  [-73.9720, 40.7330],
  [-73.9720, 40.7230],
  [-73.9760, 40.7130],
  [-73.9890, 40.7080],
  [-74.0080, 40.7020],
];

function pointInPolygon(lng: number, lat: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function inManhattan(lat: number, lng: number): boolean {
  return pointInPolygon(lng, lat, MANHATTAN_OUTLINE);
}

export const NEIGHBORHOODS: Neighborhood[] = [
  // --- Manhattan, da sud a nord ---
  { name: "Financial District", bbox: [40.700, 40.715, -74.019, -74.004] },
  { name: "Lower Manhattan", bbox: [40.700, 40.722, -74.020, -73.997] },
  { name: "Tribeca", bbox: [40.714, 40.727, -74.014, -74.004] },
  { name: "SoHo", bbox: [40.720, 40.730, -74.006, -73.996] },
  { name: "Lower East Side", bbox: [40.712, 40.722, -73.995, -73.976] },
  { name: "East Village", bbox: [40.721, 40.733, -73.992, -73.974] },
  { name: "Greenwich Village", bbox: [40.726, 40.740, -74.008, -73.992] },
  { name: "Gramercy", bbox: [40.730, 40.741, -73.992, -73.976] },
  { name: "Flatiron", bbox: [40.736, 40.747, -73.998, -73.982] },
  { name: "Chelsea", bbox: [40.739, 40.757, -74.012, -73.988] },
  { name: "Murray Hill", bbox: [40.742, 40.755, -73.986, -73.969] },
  { name: "Midtown", bbox: [40.748, 40.766, -73.996, -73.970] },
  { name: "Turtle Bay", bbox: [40.750, 40.760, -73.975, -73.963] },
  { name: "Hell's Kitchen", bbox: [40.755, 40.775, -74.005, -73.986] },
  { name: "Upper West Side", bbox: [40.771, 40.800, -73.990, -73.968] },
  { name: "Upper East Side", bbox: [40.762, 40.800, -73.965, -73.940] },
  { name: "East Harlem", bbox: [40.784, 40.812, -73.950, -73.929] },
  { name: "Harlem", bbox: [40.800, 40.835, -73.958, -73.930] },
  { name: "Washington Heights", bbox: [40.835, 40.875, -73.950, -73.925] },

  // --- Fuori Manhattan ---
  { name: "Brooklyn Heights", bbox: [40.690, 40.703, -73.999, -73.988] },
  { name: "Long Island City", bbox: [40.735, 40.762, -73.958, -73.930], excludeManhattan: true },
  { name: "Jersey City", bbox: [40.680, 40.745, -74.090, -74.030] },
  { name: "Hoboken", bbox: [40.735, 40.760, -74.040, -74.020] },
  // Comuni NJ sulla sponda a nord di Hoboken (Weehawken, Union City,
  // West New York, North Bergen, Guttenberg)
  { name: "North Hudson (NJ)", bbox: [40.745, 40.820, -74.050, -73.995] },

  // --- Borough interi: box larghi, ma esclusi da Manhattan ---
  { name: "Brooklyn", bbox: [40.570, 40.739, -74.045, -73.833], excludeManhattan: true },
  { name: "Queens", bbox: [40.540, 40.800, -73.962, -73.700], excludeManhattan: true },
  { name: "The Bronx", bbox: [40.785, 40.915, -73.933, -73.765], excludeManhattan: true },
  { name: "Staten Island", bbox: [40.495, 40.651, -74.260, -74.050] },
];

export function neighborhoodsOf(lat: number, lng: number): string[] {
  const manhattan = inManhattan(lat, lng);
  return NEIGHBORHOODS.filter(({ bbox: [south, north, west, east], excludeManhattan }) => {
    if (lat < south || lat > north || lng < west || lng > east) return false;
    if (excludeManhattan && manhattan) return false;
    return true;
  }).map((n) => n.name);
}
