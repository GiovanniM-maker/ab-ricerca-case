import {
  BUDGET_MAX,
  FLATIRON,
  FONTI_COL_BROWSER,
  GIORNI_PER_DATO_VECCHIO,
  GIORNI_PER_PERSA,
  MOLTIPLICATORE_DATO_VECCHIO,
} from "./config";
import { classify, type IsochroneSet } from "./geo";
import type { Listing, TierId } from "./types";
import { nearestStationM, transitAccessScore, type Station } from "./subway";
import { inManhattan, neighborhoodsOf } from "./neighborhoods";
import affittoLetti from "./affitto_letti.json";
import priceFloors from "./price_floors.json";

export type RawListing = Omit<Listing, "tier">;

export interface ScoredListing extends Listing {
  distanceM: number;
  convenienza: number; // 0..1, più alto = più conveniente
  /** metri dalla metro piu' vicina (null per chi arriva a piedi: non serve) */
  stationM: number | null;
  /** quartiere piu' specifico che contiene la casa */
  neighborhood: string | null;
  /** dove sta la lavanderia: il requisito che decide se la casa vale */
  lavanderia: Lavanderia;
  /** lavatrice in casa dichiarata per tutto il palazzo, non per questa unita' */
  lavanderiaDaVerificare: boolean;
  /** le righe che sommate danno il punteggio (0..100): e' la spiegazione per casa */
  componenti: ComponentePunteggio[];
}

/**
 * Un contributo al punteggio, in punti su 100: la somma delle righe (con la riga
 * "Dato vecchio", negativa) e' il punteggio mostrato, a meno dell'arrotondamento.
 * `max` e' quanto potrebbe valere al meglio: serve a dire "forte" o "debole".
 */
export interface ComponentePunteggio {
  chiave: "prezzo" | "vicinanza" | "spazio" | "servizi" | "lavatrice" | "foto" | "arredata" | "vecchio";
  label: string;
  punti: number;
  max: number;
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

/**
 * Dov'e' la lavatrice — il fattore che decide se una casa vale la pena.
 *
 * A New York fare il bucato fuori casa vuol dire passarci i sabati. Chi ci
 * abita lo mette davanti alla portineria, davanti alla palestra, davanti a
 * quasi tutto: in casa e' il massimo, nell'edificio si accetta, altrimenti
 * l'appartamento si scarta.
 *
 * "sconosciuta" non e' "assente", ed e' la differenza piu' importante di
 * questo file. Il 56% delle nostre schede elenca i servizi (1.368 su 2.454,
 * misura sul listings.json del 01/11), ma l'elenco puo' essere tagliato:
 * Apartments.com si ferma a sette voci. Una casa senza lavanderia fra quelle
 * non e' una casa senza lavanderia: e' un elenco tagliato. Dedurre l'assenza da un silenzio del genere nasconderebbe
 * proprio le case buone.
 */
export type Lavanderia = "in-casa" | "edificio" | "assente" | "sconosciuta";

// \b e' tutto il segreto della correzione: "Dishwasher" contiene "washer" ma
// non ha un confine di parola davanti. Prima passava, e 164 case prendevano i
// punti della lavatrice per avere la lavastoviglie.
const PAROLA_LAVANDERIA = /\b(laundry|washer|dryer|w\/d)\b/i;
const IN_CASA = /\b(in[- ]?unit|in[- ]?suite|in[- ]?apartment)\b/i;
const NELL_EDIFICIO = /\b(bldg|building|on[- ]?site|facilit|room|shared|common|basement)\b/i;
const NESSUNA = /\bno\b[^.]{0,20}\b(laundry|washer|dryer)\b/i;
// "w/d hookups" vuol dire che gli attacchi ci sono e la macchina la compri tu:
// non e' una lavatrice. Se un giorno decidi che vale, e' questa riga da togliere.
const SOLO_ATTACCHI = /\bhook[- ]?ups?\b/i;

// Segni letti dal testo delle unita' (scraper, sources/apartmentadvisor.py).
const UNITA_LAVATRICE = "unita:lavatrice";
const UNITA_LAVANDERIA_EDIFICIO = "unita:lavanderia-edificio";
const UNITA_BAGNO_CONDIVISO = "unita:bagno-condiviso";

/** Che cosa dice UNA voce dell'elenco sulla lavanderia. */
function leggiVoce(a: string): Lavanderia {
  if (!PAROLA_LAVANDERIA.test(a)) return "sconosciuta";
  // L'ordine conta: "no laundry on site" contiene "laundry on site", e se
  // guardassimo prima l'edificio leggeremmo un'assenza come una presenza.
  if (NESSUNA.test(a) || SOLO_ATTACCHI.test(a)) return "assente";
  if (IN_CASA.test(a)) return "in-casa";
  // Una lavanderia senza indicazione di dove sia la diamo per condominiale:
  // promuoverla a "in casa" farebbe promettere alla scheda piu' di quel che sa.
  return "edificio";
}

/** I servizi da mostrare: i segni dello scraper non sono per chi legge. */
export function serviziVisibili(amenities?: string[] | null): string[] {
  return (amenities ?? []).filter((a) => !a.startsWith("unita:"));
}

/** Dove sta la lavanderia, letta dall'elenco dei servizi. */
export function lavanderiaDi(amenities?: string[] | null): Lavanderia {
  if (!amenities?.length) return "sconosciuta"; // nessuno ce l'ha detto
  // Il testo della singola unita' batte quello che dichiara il palazzo.
  if (amenities.includes(UNITA_LAVATRICE)) return "in-casa";
  if (amenities.includes(UNITA_LAVANDERIA_EDIFICIO)) return "edificio";
  // Si guarda voce per voce e vince la migliore. Craigslist elenca sia
  // "w/d in unit" sia altre righe sulla lavanderia, e una prova positiva non
  // deve essere cancellata da una negativa che parla d'altro.
  const ordine: Lavanderia[] = ["in-casa", "edificio", "assente"];
  const lette = amenities.map(leggiVoce);
  for (const livello of ordine) if (lette.includes(livello)) return livello;
  return "sconosciuta"; // l'elenco c'e' ma non parla di lavanderia
}

/** Quanto vale la lavanderia dentro il punteggio servizi. */
const PESO_LAVANDERIA: Record<Lavanderia, number> = {
  "in-casa": 0, // conta col premio a parte, sotto
  edificio: 0.8,
  assente: 0,
  sconosciuta: 0,
};

// La lavatrice in casa e' il requisito che decide: un premio a parte, fuori dai
// servizi. 0.12 equivale a circa 1.800 $ di affitto sui prezzi del 01/11 (fra
// 2.200 e 3.600 $): tanto, ma sotto i 2.000 $, che sarebbero troppi. Niente premio
// se la dichiara solo l'edificio: 304 W 30 St finiva primo cosi'.
const PREMIO_LAVATRICE = 0.12;

// Gli altri servizi dell'edificio. Il portiere non c'e' piu': valeva piu' di
// tutto, ma chi vive a New York lo mette molto dopo il bucato — e nei nostri
// dati compare due volte in tutto, contro le ottantasei della lavatrice.
const SERVICES: { key: RegExp; value: number }[] = [
  { key: /\bpackage\b/i, value: 0.5 },
  { key: /\belevator\b/i, value: 0.6 },
  { key: /\b(gym|fitness)\b/i, value: 0.4 },
  { key: /\bstorage\b/i, value: 0.3 },
  { key: /\broof\b/i, value: 0.3 },
];
/** Somma di servizi oltre la quale il punteggio e' pieno. */
const SERVICES_MAX = 2.5;

/** Da 0 a 1 in base ai servizi, con la lavanderia in cima. */
export function servicesScore(amenities?: string[] | null): number {
  if (!amenities?.length) return 0;
  let sum = PESO_LAVANDERIA[lavanderiaDi(amenities)];
  for (const { key, value } of SERVICES) {
    if (amenities.some((a) => key.test(a))) sum += value;
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
 * Prezzo minimo credibile per tipologia. Sta in un JSON perche' lo legge anche
 * il report del crawl (tools/crawl_report.py): se le due soglie divergessero,
 * il report proporrebbe come "occasioni" proprio gli annunci che il sito nasconde.
 */
const PRICE_FLOORS: Record<string, number> = priceFloors.floors;

/** false se l'annuncio ha un prezzo implausibile per la sua tipologia (civetta). */
export function isPlausibleListing(l: RawListing): boolean {
  const floor = PRICE_FLOORS[l.type ?? ""] ?? 0;
  return (l.price == null || l.price >= floor) && !isAffittoLetti(l) && !isFuoriZona(l);
}

// Il link dice lo stato: 8831 E Times Sq Cir e' in Alaska, geocodificata su Times Square.
const STATO_FUORI_ZONA = /-(?!ny-|nj-)[a-z]{2}-\d{5}(?:[/?#]|$)/i;
// Il titolo dice un altro borough mentre le coordinate cadono a Manhattan.
const ALTROVE_NEL_TITOLO = /\b(brooklyn|bronx|queens)\b|\b1(?:04|12|13|14)\d{2}\b/i;

/** true se l'annuncio dichiara un luogo diverso da dove l'abbiamo messo. */
export function isFuoriZona(
  l: Pick<RawListing, "title" | "sourceUrl" | "lat" | "lng">
): boolean {
  if (STATO_FUORI_ZONA.test(l.sourceUrl ?? "")) return true;
  return ALTROVE_NEL_TITOLO.test(l.title ?? "") && inManhattan(l.lat, l.lng);
}

const LETTI_TITOLO = new RegExp(affittoLetti.titolo, "i");
const LETTI_URL = new RegExp(affittoLetti.url, "i");

/** true per chi affitta letti o stanze (FOUND Study, coliving, dormitori). */
export function isAffittoLetti(
  l: Pick<RawListing, "title" | "sourceUrl"> & { amenities?: string[] | null }
): boolean {
  return (
    LETTI_TITOLO.test(l.title ?? "") ||
    LETTI_URL.test(l.sourceUrl ?? "") ||
    !!l.amenities?.includes(UNITA_BAGNO_CONDIVISO)
  );
}

/**
 * false se costa piu' del budget: quelle case non entrano in "Tutte". Non si
 * scartano al caricamento perche' una casa salvata prima del tetto, se e'
 * ancora online, non deve risultare persa.
 */
export function isInBudget(l: RawListing): boolean {
  return l.price == null || l.price <= BUDGET_MAX;
}

/**
 * false se nessuna fonte la mostra da piu' di GIORNI_PER_PERSA giorni: e'
 * stata affittata o tolta dal sito. Si conta dal giorno del file e non da
 * oggi: se il crawl si fermasse per una settimana, l'elenco invecchierebbe
 * tutto insieme invece di svuotarsi.
 */
export function isAncoraOnline(l: RawListing, generatedAt?: string): boolean {
  if (!l.visto || !generatedAt) return true; // schede di prima del campo
  if (fermaDal(l, generatedAt)) return true; // nessuno la puo' ricontrollare: resta, con l'avviso sulla card
  const giorni = (Date.parse(generatedAt.slice(0, 10)) - Date.parse(l.visto)) / 86_400_000;
  return !(giorni > GIORNI_PER_PERSA);
}

/**
 * Il giorno dell'ultimo dato vero, se tutte le fonti della casa sono ferme.
 * La card lo dice: quella casa non e' stata ricontrollata da allora.
 */
export function fermaDal(
  l: Pick<RawListing, "source" | "sources" | "visto">,
  generatedAt?: string
): string | null {
  if (!l.visto || !generatedAt) return null;
  const fonti = l.sources?.length ? l.sources : [l.source];
  if (!fonti.every((f) => FONTI_COL_BROWSER.includes(f))) return null;
  const giorni = (Date.parse(generatedAt.slice(0, 10)) - Date.parse(l.visto)) / 86_400_000;
  return giorni >= GIORNI_PER_DATO_VECCHIO ? l.visto : null;
}

/** Quando e' stato generato il file letto da loadListings (ISO, UTC), per dirlo in testata. */
let generatoIl: string | null = null;
export function generatedAtCaricato(): string | null {
  return generatoIl;
}

export async function loadListings(): Promise<RawListing[]> {
  try {
    const res = await fetch("/data/listings.json");
    if (!res.ok) return [];
    const data = await res.json();
    generatoIl = typeof data.generatedAt === "string" ? data.generatedAt : null;
    return (data.listings ?? [])
      .filter(
        (l: RawListing) =>
          isPlausibleListing(l) && isAncoraOnline(l, data.generatedAt)
      )
      .map((l: RawListing) => ({ ...l, datoDel: fermaDal(l, data.generatedAt) }));
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

  // Massimo dello spazio = 95° percentile, non il massimo: una sqft anomala
  // (282 S 5 St: 78.840) schiaccerebbe lo spaceScore di tutte le altre.
  const sqfts = withTier
    .map((l) => l.sqft ?? 0)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  const minS = Math.min(...sqfts, 0);
  const maxS = sqfts.length
    ? Math.max(sqfts[Math.min(sqfts.length - 1, Math.floor(0.95 * (sqfts.length - 1)))], 1)
    : 1;

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

    const spaceScore = l.sqft ? Math.min(1, Math.max(0, norm(l.sqft, minS, maxS))) : 0.5;
    const furnScore = l.furnished ? 1 : 0;
    const photoScore = l.photos?.length ? 1 : 0;
    const servScore = servicesScore(l.amenities);
    const lavanderia = lavanderiaDi(l.amenities);
    // Il palazzo con piu' unita' dichiara la lavatrice per l'intero edificio
    // (304 W 30 St): non sappiamo se sta in QUESTO appartamento.
    const lavanderiaDaVerificare =
      lavanderia === "in-casa" && !!l.priceFrom && !l.amenities?.includes(UNITA_LAVATRICE);
    const premio = lavanderia === "in-casa" && !lavanderiaDaVerificare ? PREMIO_LAVATRICE : 0;
    // Si divide per restare fra 0 e 1: la barra della card e' una percentuale.
    const base =
      (weights.price * priceScore +
        weights.time * timeScore +
        weights.space * spaceScore +
        weights.furnished * furnScore +
        weights.photo * photoScore +
        weights.services * servScore +
        premio) /
      (1 + PREMIO_LAVATRICE);
    // Dato non ricontrollato da giorni: la casa resta in elenco ma scende.
    const vecchio = !!l.datoDel;
    const convenienza = vecchio ? base * MOLTIPLICATORE_DATO_VECCHIO : base;

    // La spiegazione per casa: ogni riga e' un contributo in punti su 100, con
    // gli stessi pesi e la stessa divisione di sopra; la riga "Dato vecchio"
    // toglie la differenza, quindi la somma torna al punteggio.
    const punti = (peso: number, valore: number) => (peso * valore * 100) / (1 + PREMIO_LAVATRICE);
    const massimo = (peso: number) => (peso * 100) / (1 + PREMIO_LAVATRICE);
    const componenti: ComponentePunteggio[] = [
      { chiave: "prezzo", label: "Prezzo", punti: punti(weights.price, priceScore), max: massimo(weights.price) },
      { chiave: "vicinanza", label: "Vicinanza", punti: punti(weights.time, timeScore), max: massimo(weights.time) },
      { chiave: "spazio", label: "Spazio", punti: punti(weights.space, spaceScore), max: massimo(weights.space) },
      { chiave: "servizi", label: "Servizi", punti: punti(weights.services, servScore), max: massimo(weights.services) },
      { chiave: "lavatrice", label: "Lavatrice", punti: punti(1, premio), max: massimo(PREMIO_LAVATRICE) },
      { chiave: "foto", label: "Foto", punti: punti(weights.photo, photoScore), max: massimo(weights.photo) },
    ];
    // "Arredata" pesa un punto: compare solo quando c'e', per non allungare l'elenco.
    if (furnScore) {
      componenti.push({ chiave: "arredata", label: "Arredata", punti: punti(weights.furnished, 1), max: massimo(weights.furnished) });
    }
    if (vecchio) {
      componenti.push({
        chiave: "vecchio",
        label: "Dato vecchio",
        punti: -(base - convenienza) * 100,
        max: 0,
      });
    }
    // NEIGHBORHOODS e' ordinato dal piu' specifico al piu' generico,
    // quindi il primo match e' il quartiere giusto da mostrare.
    const neighborhood = neighborhoodsOf(l.lat, l.lng)[0] ?? null;
    return { ...l, convenienza, stationM, neighborhood, lavanderia, lavanderiaDaVerificare, componenti };
  });
}
