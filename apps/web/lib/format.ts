import { TIERS, OUT_META, type TierId } from "./types";

export function formatPrice(price: number | null): string {
  if (!price) return "Prezzo n/d";
  return `$${price.toLocaleString("en-US")}`;
}

export function formatType(type: string | null): string {
  if (!type) return "—";
  if (type === "studio") return "Studio";
  const m = type.match(/^(\d+)br$/);
  return m ? `${m[1]} camera${m[1] === "1" ? "" : "e"}` : type;
}

export function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

export function tierMeta(id: TierId) {
  return id === "out" ? OUT_META : TIERS[id];
}

export function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    apartmentadvisor: "ApartmentAdvisor",
    trulia: "Trulia",
    craigslist: "Craigslist",
    streeteasy: "StreetEasy",
    zillow: "Zillow",
    apartments: "Apartments.com",
    renthop: "RentHop",
    sample: "Esempio",
  };
  return map[source] ?? source;
}
