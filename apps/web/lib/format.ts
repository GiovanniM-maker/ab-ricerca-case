import { TIERS, OUT_META, type TierId } from "./types";

export function formatPrice(price: number | null): string {
  if (!price) return "Prezzo n/d";
  return `$${price.toLocaleString("en-US")}`;
}

/** Un solo formato per la tipologia, ovunque: "Monolocale", "1 camera", "2 camere". */
export function formatType(type: string | null): string {
  if (!type) return "—";
  if (type === "studio") return "Monolocale";
  const m = type.match(/^(\d+)br$/);
  return m ? `${m[1]} camer${m[1] === "1" ? "a" : "e"}` : type;
}

/** "1 casa", "35 case": il plurale giusto, che "1 case" non lo e'. */
export function nCase(n: number): string {
  return `${n.toLocaleString("it-IT")} ${n === 1 ? "casa" : "case"}`;
}

/**
 * Un giorno in italiano ("6 set"). Le date YYYY-MM-DD (visto, datoDel) sono
 * giorni di calendario, non istanti: new Date("2026-09-06") e' la mezzanotte UTC
 * e a New York stampava il 5. Si formattano quindi in UTC, cosi' il giorno e'
 * lo stesso ovunque. Un timestamp vero (ISO con l'ora) resta nel fuso di chi guarda.
 */
export function formatGiorno(
  s: string,
  opz: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
): string {
  const soloGiorno = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("it-IT", soloGiorno ? { ...opz, timeZone: "UTC" } : opz);
}

/** "1 nov, 13:31 (ora di Roma)" da un timestamp ISO: l'ora e' di Roma anche se si guarda da New York. */
export function formatAggiornato(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const giorno = d.toLocaleDateString("it-IT", { day: "numeric", month: "short", timeZone: "Europe/Rome" });
  const ora = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
  return `${giorno}, ${ora} (ora di Roma)`;
}

/** Colore del badge del tier: il verde della mappa (#16a34a) con testo bianco non arriva a 4,5:1. */
export function tierBadgeColor(id: TierId): string {
  return id === "walk30" ? "#15803d" : tierMeta(id).color;
}

// I servizi arrivano dalle fonti in inglese, in forme diverse ("washer-dryer-in-unit",
// "Fitness Center"). Si confrontano in minuscolo; cio' che non e' nel dizionario
// resta com'e': meglio un termine inglese che uno inventato.
const SERVIZI_IT: Record<string, string> = {
  dishwasher: "Lavastoviglie",
  "hardwood-floors": "Parquet",
  "hardwood floors": "Parquet",
  "fitness-center": "Palestra",
  "fitness center": "Palestra",
  balcony: "Balcone",
  "washer-dryer": "Lavatrice e asciugatrice",
  "washer-dryer-in-unit": "Lavatrice e asciugatrice in casa",
  "in unit washer & dryer": "Lavatrice e asciugatrice in casa",
  "w/d in unit": "Lavatrice e asciugatrice in casa",
  "washer-dryer-hookup": "Attacchi per lavatrice",
  "w/d hookups": "Attacchi per lavatrice",
  elevator: "Ascensore",
  parking: "Parcheggio",
  "air-conditioning": "Aria condizionata",
  "air conditioning": "Aria condizionata",
  garage: "Garage",
  pool: "Piscina",
  dogs: "Cani ammessi",
  cats: "Gatti ammessi",
  "pets allowed": "Animali ammessi",
  patio: "Patio",
  yard: "Giardino",
  "garbage-disposal": "Tritarifiuti",
  furnished: "Arredato",
  "no laundry on site": "Senza lavanderia",
  doorman: "Portiere",
  "laundry in bldg": "Lavanderia nell'edificio",
  "laundry on site": "Lavanderia nell'edificio",
  kitchen: "Cucina",
  refrigerator: "Frigorifero",
  "walk-in closets": "Cabina armadio",
  "maintenance on site": "Manutenzione in loco",
  "high-speed internet": "Internet veloce",
  grill: "Barbecue",
  "stainless steel appliances": "Elettrodomestici in acciaio",
  "package service": "Ritiro pacchi",
  lounge: "Sala comune",
  clubhouse: "Sala comune",
  "controlled access": "Accesso controllato",
  concierge: "Concierge",
  "business center": "Business center",
  "ev charging": "Ricarica auto elettriche",
  microwave: "Microonde",
  heat: "Riscaldamento",
  playground: "Area giochi",
};

/** Il servizio in italiano, e senza doppioni (due voci possono dire la stessa cosa). */
export function serviziInItaliano(voci: string[]): string[] {
  const visti = new Set<string>();
  const out: string[] = [];
  for (const v of voci) {
    const t = SERVIZI_IT[v.trim().toLowerCase()] ?? v;
    if (!visti.has(t)) {
      visti.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Il testo della lavanderia: uno solo per card e dettaglio, perche' prima la
 * stessa casa diceva "da verificare" in elenco e "In casa" nella scheda.
 * "sconosciuta" qui ha un testo, e' la card a non mostrarla.
 */
export function testoLavanderia(
  lav: "in-casa" | "edificio" | "assente" | "sconosciuta",
  daVerificare: boolean
): string {
  if (daVerificare) return "Dichiarata dal palazzo, da verificare";
  switch (lav) {
    case "in-casa":
      return "Lavatrice in casa";
    case "edificio":
      return "Lavanderia nell'edificio";
    case "assente":
      return "Senza lavanderia";
    default:
      return "Non indicata dalla fonte";
  }
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
