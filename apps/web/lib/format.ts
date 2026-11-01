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

/** La fonte dall'URL: il link va chiamato col nome del sito che apre davvero. */
export function sourceDaUrl(url: string, ripiego: string): string {
  const host = url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)?.[1]?.toLowerCase() ?? "";
  const nota = Object.entries(HOST_FONTE).find(([h]) => host.endsWith(h));
  return nota ? nota[1] : ripiego;
}

const HOST_FONTE: Record<string, string> = {
  "apartmentadvisor.com": "apartmentadvisor",
  "trulia.com": "trulia",
  "craigslist.org": "craigslist",
  "streeteasy.com": "streeteasy",
  "zillow.com": "zillow",
  "apartments.com": "apartments",
  "verisresidential.com": "curato",
  "newportrentals.com": "curato",
};

export function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    apartmentadvisor: "ApartmentAdvisor",
    trulia: "Trulia",
    craigslist: "Craigslist",
    streeteasy: "StreetEasy",
    zillow: "Zillow",
    apartments: "Apartments.com",
    renthop: "RentHop",
    curato: "sito dell'edificio",
    sample: "Esempio",
  };
  return map[source] ?? source;
}
