export interface Neighborhood {
  name: string;
  bbox: [number, number, number, number]; // [south, north, west, east]
}

export const NEIGHBORHOODS: Neighborhood[] = [
  { name: "Financial District", bbox: [40.700, 40.715, -74.019, -74.004] },
  { name: "Tribeca", bbox: [40.714, 40.727, -74.014, -74.004] },
  { name: "SoHo", bbox: [40.720, 40.730, -74.006, -73.996] },
  { name: "Lower East Side", bbox: [40.712, 40.722, -73.995, -73.976] },
  { name: "East Village", bbox: [40.721, 40.733, -73.992, -73.974] },
  { name: "Greenwich Village", bbox: [40.726, 40.740, -74.008, -73.992] },
  { name: "Lower Manhattan", bbox: [40.700, 40.722, -74.020, -73.997] },
  { name: "Turtle Bay", bbox: [40.750, 40.760, -73.975, -73.963] },
  { name: "Upper East Side", bbox: [40.762, 40.800, -73.965, -73.943] },
  { name: "Upper West Side", bbox: [40.771, 40.800, -73.990, -73.960] },
  { name: "Harlem", bbox: [40.800, 40.835, -73.958, -73.930] },
  { name: "The Bronx", bbox: [40.785, 40.915, -73.933, -73.765] },
  { name: "Brooklyn Heights", bbox: [40.690, 40.703, -73.999, -73.988] },
  { name: "Long Island City", bbox: [40.735, 40.762, -73.960, -73.930] },
  { name: "Jersey City", bbox: [40.680, 40.745, -74.090, -74.030] },
  { name: "Hoboken", bbox: [40.735, 40.760, -74.040, -74.020] },
  // Borough interi: volutamente ampi, si sovrappongono ai quartieri sopra
  // (un annuncio a Brooklyn Heights risulta anche "Brooklyn").
  { name: "Brooklyn", bbox: [40.570, 40.740, -74.045, -73.833] },
  { name: "Queens", bbox: [40.540, 40.800, -73.962, -73.700] },
  { name: "Staten Island", bbox: [40.495, 40.651, -74.260, -74.050] },
];

export function neighborhoodsOf(lat: number, lng: number): string[] {
  return NEIGHBORHOODS.filter(
    ({ bbox: [south, north, west, east] }) =>
      lat >= south && lat <= north && lng >= west && lng <= east
  ).map((n) => n.name);
}
