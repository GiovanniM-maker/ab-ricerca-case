"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { loadIsochrones, type IsochroneSet } from "@/lib/geo";
import {
  generatedAtCaricato,
  isInBudget,
  loadListings,
  scoreListings,
  type RawListing,
  type ScoredListing,
} from "@/lib/listings";
import { TIERS, type TierId } from "@/lib/types";
import { NEIGHBORHOODS, neighborhoodsOf } from "@/lib/neighborhoods";
import { FLATIRON } from "@/lib/config";
import { loadStations, type Station } from "@/lib/subway";
import ListingCard from "@/components/ListingCard";
import ListingDetail from "@/components/ListingDetail";
import FilterPopover, { chipClasse } from "@/components/FilterPopover";
import { formatAggiornato, formatType, nCase } from "@/lib/format";
import SavedList from "@/components/SavedList";
import AuthLine from "@/components/AuthLine";
import { useWishlist, indice, rifDi, rifSalvata } from "@/lib/wishlist";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-neutral-900 text-sm text-neutral-400">
      Carico la mappa…
    </div>
  ),
});

const EMPTY: IsochroneSet = { walk30: null, transit30: null, transit45: null };
type SortKey = "convenienza" | "price" | "distance";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "convenienza", label: "Convenienza" },
  { key: "price", label: "Prezzo" },
  { key: "distance", label: "Vicinanza" },
];
const PAGE = 30;

// Il bucato: a New York chi ci abita lo mette davanti a quasi tutto, perche'
// senza lavatrice i sabati se ne vanno in lavanderia. Piu' livelli e non due,
// perche' "non lo sappiamo" e' il caso piu' frequente: solo il 56% delle schede
// (1.368 su 2.454, misura sul listings.json del 01/11) elenca i servizi, e
// filtrare come se il silenzio fosse un'assenza nasconderebbe case a caso.
type FiltroLavanderia = "tutte" | "in-casa" | "da-verificare" | "almeno-edificio";
const LAVANDERIE: { key: FiltroLavanderia; label: string }[] = [
  { key: "tutte", label: "Tutte" },
  { key: "in-casa", label: "Lavatrice in casa" },
  { key: "da-verificare", label: "Dichiarata dal palazzo, da verificare" },
  { key: "almeno-edificio", label: "Almeno nell'edificio" },
];

interface Filtri {
  tiers: Set<TierId>;
  types: Set<string>;
  furnished: boolean;
  maxPrice: number | null;
  hoods: Set<string>;
  lav: FiltroLavanderia;
  soloAgg: boolean;
}
type Gruppo = keyof Filtri;

/** Una casa passa i filtri? `escludi` salta un gruppo: serve per i conteggi
 *  ("quante ne avrei se togliessi questo") e per i suggerimenti a elenco vuoto. */
function passa(
  l: ScoredListing,
  f: Filtri,
  hoodsDi: Map<string | number, string[]>,
  escludi?: Gruppo
): boolean {
  if (escludi !== "tiers" && !f.tiers.has(l.tier)) return false;
  if (escludi !== "types" && f.types.size > 0 && !(l.type && f.types.has(l.type))) return false;
  if (escludi !== "furnished" && f.furnished && l.furnished !== true) return false;
  if (escludi !== "maxPrice" && f.maxPrice != null && (l.price ?? Infinity) > f.maxPrice) return false;
  if (
    escludi !== "hoods" &&
    f.hoods.size > 0 &&
    !(hoodsDi.get(l.id) ?? []).some((n) => f.hoods.has(n))
  )
    return false;
  if (escludi !== "lav" && f.lav !== "tutte") {
    const dv = !!l.lavanderiaDaVerificare;
    if (f.lav === "in-casa" && !(l.lavanderia === "in-casa" && !dv)) return false;
    if (f.lav === "da-verificare" && !(l.lavanderia === "in-casa" && dv)) return false;
    if (f.lav === "almeno-edificio" && !(l.lavanderia === "in-casa" || l.lavanderia === "edificio"))
      return false;
  }
  if (escludi !== "soloAgg" && f.soloAgg && l.datoDel) return false;
  return true;
}

const NJ = ["Newport", "Harsimus Cove", "Jersey City", "Hoboken", "North Hudson (NJ)"];
const BK = ["Brooklyn Heights", "Brooklyn"];
const ALTRI = ["Long Island City", "Queens", "The Bronx", "Staten Island"];
function gruppoQuartiere(n: string): string {
  if (NJ.includes(n)) return "New Jersey";
  if (BK.includes(n)) return "Brooklyn";
  if (ALTRI.includes(n)) return "Altri";
  return "Manhattan";
}
const GRUPPI_ORDINE = ["Manhattan", "New Jersey", "Brooklyn", "Altri"];

/** Riga cliccabile dentro un pannello filtro. */
function Row({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition ${
        on ? "bg-neutral-800 text-white" : "text-neutral-300 hover:bg-neutral-800/60"
      }`}
    >
      <span className="flex items-center gap-2">{children}</span>
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
          on ? "border-white bg-white text-neutral-900" : "border-neutral-600"
        }`}
      >
        {on ? "✓" : ""}
      </span>
    </button>
  );
}

/** Pill di un filtro attivo, rimovibile. */
function Pill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-neutral-800 px-2.5 py-1 text-[11px] font-medium text-neutral-200 transition hover:bg-neutral-700"
    >
      {label}
      <span className="text-neutral-400">✕</span>
    </button>
  );
}

export default function Home() {
  const [iso, setIso] = useState<IsochroneSet>(EMPTY);
  const [raw, setRaw] = useState<RawListing[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);

  const [sort, setSort] = useState<SortKey>("convenienza");
  const [activeTiers, setActiveTiers] = useState<Set<TierId>>(
    new Set(["walk30", "transit30", "transit45"])
  );
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [furnishedOnly, setFurnishedOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [activeNeighborhoods, setActiveNeighborhoods] = useState<Set<string>>(new Set());
  const [hoodQuery, setHoodQuery] = useState("");
  const [lavanderia, setLavanderia] = useState<FiltroLavanderia>("tutte");
  const [soloAggiornati, setSoloAggiornati] = useState(false);
  const listaRef = useRef<HTMLDivElement>(null);
  const [mostraSu, setMostraSu] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [detail, setDetail] = useState<ScoredListing | null>(null);
  const [mobileMap, setMobileMap] = useState(false);
  // "salvate" non e' un filtro sull'elenco: le case che hai salvato e che nel
  // frattempo sono state affittate non stanno piu' in listings.json, e sono
  // proprio quelle che vuoi ancora poter rileggere. E' un'altra vista.
  const [vista, setVista] = useState<"tutte" | "salvate">("tutte");

  const wl = useWishlist();
  // Un doppione fuso tiene le chiavi di chi ha assorbito: chi l'aveva salvato
  // sotto quelle deve ritrovarlo salvato.
  const salvateIdx = useMemo(() => {
    const idx = indice(wl.salvate);
    for (const l of raw) {
      for (const v of l.chiaviVecchie ?? []) {
        const s = idx.get(v);
        if (s && !idx.has(rifDi(l))) idx.set(rifDi(l), s);
      }
    }
    return idx;
  }, [wl.salvate, raw]);

  useEffect(() => {
    Promise.all([loadIsochrones(), loadListings(), loadStations()]).then(
      ([i, l, s]) => {
        setIso(i);
        setRaw(l);
        setStations(s);
        setLoading(false);
      }
    );
  }, []);

  // Tutto quello che e' ancora online, anche sopra budget: serve solo a
  // ritrovare le salvate. "Tutte" parte da `scored`, gia' dentro il budget, e
  // il punteggio prezzo si misura fra le case che possiamo davvero pagare.
  const online = useMemo(
    () => scoreListings(raw, iso, stations),
    [raw, iso, stations]
  );
  const scored = useMemo(
    () => scoreListings(raw.filter(isInBudget), iso, stations),
    [raw, iso, stations]
  );

  const { types, priceCap } = useMemo(() => {
    const t = new Set<string>();
    let cap = 0;
    for (const l of scored) {
      if (l.type) t.add(l.type);
      if (l.price && l.price > cap) cap = l.price;
    }
    const order = (x: string) => (x === "studio" ? 0 : parseInt(x) || 99);
    return { types: [...t].sort((a, b) => order(a) - order(b)), priceCap: cap };
  }, [scored]);

  // Quartieri di ogni casa, calcolati una volta: servono al filtro e ai conteggi.
  const hoodsDi = useMemo(() => {
    const m = new Map<string | number, string[]>();
    for (const l of scored) m.set(l.id, neighborhoodsOf(l.lat, l.lng));
    return m;
  }, [scored]);

  const visible = useMemo(() => {
    const f: Filtri = {
      tiers: activeTiers,
      types: activeTypes,
      furnished: furnishedOnly,
      maxPrice,
      hoods: activeNeighborhoods,
      lav: lavanderia,
      soloAgg: soloAggiornati,
    };
    const filtered = scored.filter((l) => passa(l, f, hoodsDi));
    filtered.sort((a, b) => {
      if (sort === "price") return (a.price ?? Infinity) - (b.price ?? Infinity);
      if (sort === "distance") return a.distanceM - b.distanceM;
      return b.convenienza - a.convenienza;
    });
    return filtered;
  }, [scored, hoodsDi, activeTiers, activeTypes, furnishedOnly, maxPrice, activeNeighborhoods, lavanderia, soloAggiornati, sort]);

  // Conteggi accanto alle voci: quante case avrei scegliendola, con gli altri
  // filtri come sono ora.
  const conteggi = useMemo(() => {
    const f: Filtri = {
      tiers: activeTiers,
      types: activeTypes,
      furnished: furnishedOnly,
      maxPrice,
      hoods: activeNeighborhoods,
      lav: lavanderia,
      soloAgg: soloAggiornati,
    };
    const lav: Record<FiltroLavanderia, number> = {
      tutte: 0,
      "in-casa": 0,
      "da-verificare": 0,
      "almeno-edificio": 0,
    };
    const hood = new Map<string, number>();
    for (const l of scored) {
      if (passa(l, f, hoodsDi, "lav")) {
        lav.tutte++;
        const dv = !!l.lavanderiaDaVerificare;
        if (l.lavanderia === "in-casa" && !dv) lav["in-casa"]++;
        if (l.lavanderia === "in-casa" && dv) lav["da-verificare"]++;
        if (l.lavanderia === "in-casa" || l.lavanderia === "edificio") lav["almeno-edificio"]++;
      }
      if (passa(l, f, hoodsDi, "hoods")) {
        for (const n of hoodsDi.get(l.id) ?? []) hood.set(n, (hood.get(n) ?? 0) + 1);
      }
    }
    return { lav, hood };
  }, [scored, hoodsDi, activeTiers, activeTypes, furnishedOnly, maxPrice, activeNeighborhoods, lavanderia, soloAggiornati]);

  useEffect(
    () => setLimit(PAGE),
    [activeTiers, activeTypes, furnishedOnly, maxPrice, activeNeighborhoods, lavanderia, soloAggiornati, sort]
  );

  // "Torna su": compare quando la lista e' scesa di qualche schermata.
  useEffect(() => {
    const el = listaRef.current;
    if (!el) return;
    const on = () => setMostraSu(el.scrollTop > 800);
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [vista, loading]);

  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  }

  const openDetail = (id: string | number) => {
    const l = visible.find((x) => x.id === id) ?? online.find((x) => x.id === id);
    if (l) setDetail(l);
  };

  const resetAll = () => {
    setActiveTiers(new Set(["walk30", "transit30", "transit45"]));
    setActiveTypes(new Set());
    setFurnishedOnly(false);
    setMaxPrice(null);
    setActiveNeighborhoods(new Set());
    setLavanderia("tutte");
    setSoloAggiornati(false);
  };

  const tiersFiltered = activeTiers.size < 3;
  const hasFilters =
    tiersFiltered ||
    activeTypes.size > 0 ||
    furnishedOnly ||
    maxPrice != null ||
    lavanderia !== "tutte" ||
    soloAggiornati ||
    activeNeighborhoods.size > 0;
  // Quanti gruppi di filtri sono accesi: il numero sul pulsante "Filtri" e la
  // soglia sotto cui le pill sono rumore (con un filtro solo il chip lo dice gia').
  const nAttivi =
    (tiersFiltered ? 1 : 0) +
    (activeTypes.size > 0 || furnishedOnly ? 1 : 0) +
    (maxPrice != null ? 1 : 0) +
    (lavanderia !== "tutte" ? 1 : 0) +
    (soloAggiornati ? 1 : 0) +
    (activeNeighborhoods.size > 0 ? 1 : 0);

  // Il fit della mappa segue i filtri e la vista, non l'ordinamento.
  const fitKey = [
    vista,
    [...activeTiers].sort().join(","),
    [...activeTypes].sort().join(","),
    furnishedOnly,
    maxPrice,
    [...activeNeighborhoods].sort().join(","),
    lavanderia,
    soloAggiornati,
  ].join("|");

  // A elenco vuoto: quale filtro, tolto da solo, riporta delle case.
  const suggerimenti = useMemo(() => {
    if (loading || visible.length > 0 || !hasFilters) return [];
    const f: Filtri = {
      tiers: activeTiers,
      types: activeTypes,
      furnished: furnishedOnly,
      maxPrice,
      hoods: activeNeighborhoods,
      lav: lavanderia,
      soloAgg: soloAggiornati,
    };
    const voci: { g: Gruppo; testo: string; togli: () => void }[] = [];
    if (maxPrice != null)
      voci.push({ g: "maxPrice", testo: `≤ $${maxPrice.toLocaleString()}`, togli: () => setMaxPrice(null) });
    if (lavanderia !== "tutte")
      voci.push({
        g: "lav",
        testo: LAVANDERIE.find((x) => x.key === lavanderia)!.label,
        togli: () => setLavanderia("tutte"),
      });
    if (activeNeighborhoods.size > 0)
      voci.push({ g: "hoods", testo: "il quartiere", togli: () => setActiveNeighborhoods(new Set()) });
    if (activeTypes.size > 0)
      voci.push({ g: "types", testo: "la tipologia", togli: () => setActiveTypes(new Set()) });
    if (furnishedOnly)
      voci.push({ g: "furnished", testo: "Solo arredati", togli: () => setFurnishedOnly(false) });
    if (soloAggiornati)
      voci.push({ g: "soloAgg", testo: "Solo dati aggiornati", togli: () => setSoloAggiornati(false) });
    if (tiersFiltered)
      voci.push({
        g: "tiers",
        testo: "il tempo",
        togli: () => setActiveTiers(new Set(["walk30", "transit30", "transit45"])),
      });
    return voci
      .map((v) => ({ ...v, n: scored.filter((l) => passa(l, f, hoodsDi, v.g)).length }))
      .filter((v) => v.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, visible.length, hasFilters, scored, hoodsDi, activeTiers, activeTypes, furnishedOnly, maxPrice, activeNeighborhoods, lavanderia, soloAggiornati, tiersFiltered]);

  const hoodList = NEIGHBORHOODS.filter((n) =>
    n.name.toLowerCase().includes(hoodQuery.toLowerCase())
  );
  const aggiornatoIl = generatedAtCaricato();

  // Le salvate ritrovate nel crawl di oggi. Si cerca su tutto `online` e non
  // sui filtrati: una casa salvata resta tua anche quando i filtri correnti, o
  // il budget, la escludono, e senza questo finirebbe fra le perse per sbaglio.
  const vive = useMemo(() => {
    const m = new Map<string, ScoredListing>();
    for (const l of online) {
      m.set(rifDi(l), l);
      m.set(String(l.id), l);
      for (const v of l.chiaviVecchie ?? []) m.set(v, l);
    }
    return m;
  }, [online]);

  const rifSalvati = useMemo(
    () => new Set(wl.salvate.flatMap((s) => [rifSalvata(s), s.listingId])),
    [wl.salvate]
  );

  // In vista "Salvate" la mappa mostra solo le tue case: vederle disegnate
  // sulla citta' e' meta' del motivo per cui una wishlist serve. Quelle
  // sparite dal crawl non hanno un pallino — non sappiamo piu' che tier
  // abbiano oggi — ma restano nell'elenco a sinistra.
  const salvateVive = useMemo(
    () =>
      wl.salvate
        .map((s) => vive.get(rifSalvata(s)) ?? vive.get(s.listingId))
        .filter((l): l is ScoredListing => Boolean(l)),
    [wl.salvate, vive]
  );

  /** Segnalibro: salva, oppure toglie se c'era gia'. */
  const toggleSalva = (l: ScoredListing) => {
    const s = salvateIdx.get(rifDi(l)) ?? salvateIdx.get(String(l.id));
    if (!s) return wl.salva(l);
    // Una nota e' lavoro tuo: non la si butta per un tocco di troppo.
    if (s.nota && !confirm("Questa casa ha una nota. La tolgo lo stesso?")) return;
    wl.rimuovi(rifSalvata(s));
  };

  // I corpi dei filtri: gli stessi nei popover (schermi larghi) e nel foglio
  // "Filtri" (telefono), cosi' non si scrivono due volte.
  const corpoTempo = (
    <div className="space-y-0.5">
      {Object.values(TIERS).map((t) => (
        <Row key={t.id} on={activeTiers.has(t.id)} onClick={() => setActiveTiers(toggle(activeTiers, t.id))}>
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
          {t.label}
        </Row>
      ))}
    </div>
  );

  const corpoQuartiere = (
    <>
      <input
        value={hoodQuery}
        onChange={(e) => setHoodQuery(e.target.value)}
        placeholder="Cerca quartiere…"
        aria-label="Cerca quartiere"
        className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
      />
      <div className="max-h-64 space-y-0.5 overflow-y-auto">
        {GRUPPI_ORDINE.map((g) => {
          const voci = hoodList.filter((n) => gruppoQuartiere(n.name) === g);
          if (voci.length === 0) return null;
          return (
            <div key={g}>
              <p className="px-2.5 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {g}
              </p>
              {voci.map((n) => (
                <Row
                  key={n.name}
                  on={activeNeighborhoods.has(n.name)}
                  onClick={() => setActiveNeighborhoods(toggle(activeNeighborhoods, n.name))}
                >
                  {n.name}
                  <span className="text-xs tabular-nums text-neutral-400">
                    {conteggi.hood.get(n.name) ?? 0}
                  </span>
                </Row>
              ))}
            </div>
          );
        })}
        {hoodList.length === 0 && <p className="px-2.5 py-2 text-sm text-neutral-400">Nessun risultato</p>}
      </div>
    </>
  );

  const corpoPrezzo = (
    <div className="px-1">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-neutral-400">Massimo</span>
        <span className="font-semibold text-neutral-100">
          {maxPrice ? `$${maxPrice.toLocaleString()}` : "Qualsiasi"}
        </span>
      </div>
      <input
        type="range"
        aria-label="Prezzo massimo"
        min={1000}
        max={priceCap || 20000}
        step={250}
        value={maxPrice ?? (priceCap || 20000)}
        onChange={(e) => setMaxPrice(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-emerald-400"
      />
      <p className="mt-2 text-xs text-neutral-400">{nCase(visible.length)} con i filtri attuali</p>
      {maxPrice != null && (
        <button
          onClick={() => setMaxPrice(null)}
          className="mt-2 text-xs text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline"
        >
          Rimuovi limite
        </button>
      )}
    </div>
  );

  const corpoTipo = (
    <div className="space-y-0.5">
      {types.map((ty) => (
        <Row key={ty} on={activeTypes.has(ty)} onClick={() => setActiveTypes(toggle(activeTypes, ty))}>
          {formatType(ty)}
        </Row>
      ))}
      <div className="my-1 h-px bg-neutral-800" />
      <Row on={furnishedOnly} onClick={() => setFurnishedOnly((v) => !v)}>
        Solo arredati
      </Row>
    </div>
  );

  const corpoLavanderia = (
    <>
      <div className="space-y-0.5">
        {LAVANDERIE.map((v) => (
          <Row key={v.key} on={lavanderia === v.key} onClick={() => setLavanderia(v.key)}>
            {v.label}
            <span className="text-xs tabular-nums text-neutral-400">{conteggi.lav[v.key]}</span>
          </Row>
        ))}
      </div>
      {/* Detto qui, dove serve: chi sceglie "lavatrice in casa" vede l'elenco
          crollare e deve sapere che non e' perche' le case non ce l'hanno, ma
          perche' le fonti non lo dicono. */}
      <p className="mt-2 border-t border-neutral-800 pt-2 text-[11px] leading-snug text-neutral-400">
        Il 56% delle schede dichiara i servizi (1.368 su 2.454). Filtrando qui sparisce
        anche chi la lavatrice ce l&apos;ha ma non l&apos;ha scritto.
      </p>
    </>
  );

  const corpoDati = (
    <div className="space-y-0.5">
      <Row on={soloAggiornati} onClick={() => setSoloAggiornati((v) => !v)}>
        Solo dati aggiornati
      </Row>
      <p className="px-2.5 pt-1 text-[11px] leading-snug text-neutral-400">
        Nasconde le case che nessuna fonte ha ricontrollato di recente. Senza questo filtro restano
        in elenco, con un punteggio ridotto.
      </p>
    </div>
  );

  const etichettaQuartiere =
    activeNeighborhoods.size === 0
      ? null
      : activeNeighborhoods.size === 1
        ? [...activeNeighborhoods][0]
        : `${activeNeighborhoods.size} selezionati`;
  const etichettaTipo =
    activeTypes.size || furnishedOnly ? `${activeTypes.size + (furnishedOnly ? 1 : 0)}` : null;
  const etichettaLav = lavanderia === "tutte" ? null : LAVANDERIE.find((x) => x.key === lavanderia)!.label;

  const ordina = (
    <FilterPopover label="Ordina" ordina value={SORTS.find((x) => x.key === sort)!.label} width="w-48">
      <div className="space-y-0.5">
        {SORTS.map((x) => (
          <Row key={x.key} on={sort === x.key} onClick={() => setSort(x.key)}>
            {x.label}
          </Row>
        ))}
      </div>
    </FilterPopover>
  );

  const sezione = (titolo: string, corpo: React.ReactNode) => (
    <div className="mb-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{titolo}</p>
      {corpo}
    </div>
  );

  return (
    <main className="flex h-[100dvh] w-screen flex-col bg-neutral-950 md:flex-row">
      {/* Sidebar. min-h-0 + flex-1: sul telefono l'aside e' alto quanto lo
          schermo e scorre solo la lista, cosi' la barra dei filtri resta ferma. */}
      <aside
        className={`relative min-h-0 w-full shrink-0 flex-col bg-neutral-950 max-md:flex-1 md:w-[30rem] md:border-r md:border-neutral-800 ${
          mobileMap ? "hidden md:flex" : "flex"
        }`}
      >
        {/* relative+z-30: backdrop-blur crea uno stacking context, senza questo
            le tendine dei filtri finiscono sotto le card della lista */}
        <div className="relative z-30 shrink-0 border-b border-neutral-800 bg-neutral-950/95 px-5 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-xl font-bold tracking-tight text-neutral-50">
              Flatiron <span className="text-emerald-400">Radar</span>
            </h1>
            <span className="whitespace-nowrap text-sm font-medium text-neutral-400" aria-live="polite">
              {loading
                ? "…"
                : vista === "salvate"
                  ? `${wl.salvate.length} ${wl.salvate.length === 1 ? "salvata" : "salvate"}`
                  : nCase(visible.length)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-neutral-400">
            Tempo di arrivo stimato a {FLATIRON.label}
          </p>
          {aggiornatoIl && formatAggiornato(aggiornatoIl) && (
            <p className="truncate text-xs text-neutral-400">
              Dati aggiornati {formatAggiornato(aggiornatoIl)}
            </p>
          )}

          {/* Tutte / Salvate. Sono due insiemi diversi, non un filtro: fra le
              salvate ci sono case che dall'elenco sono sparite. */}
          <div className="mt-3 flex w-full gap-1 rounded-full bg-neutral-900 p-1">
            {(
              [
                ["tutte", "Tutte"],
                ["salvate", `Salvate${wl.salvate.length ? ` (${wl.salvate.length})` : ""}`],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setVista(v)}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition max-sm:py-2.5 ${
                  vista === v
                    ? "bg-neutral-100 text-neutral-900"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {vista === "tutte" && (
            <>
              {/* Telefono: una barra sola, "Filtri · N" apre un foglio con tutti i
                  filtri, accanto "Ordina". Dal tablet in su restano i chip. */}
              <div className="mt-3 flex items-center gap-2 sm:hidden">
                <FilterPopover label="Filtri" value={nAttivi ? String(nAttivi) : null} width="w-72">
                  <div>
                    {sezione("Prezzo", corpoPrezzo)}
                    {sezione("Lavanderia", corpoLavanderia)}
                    {sezione("Quartiere", corpoQuartiere)}
                    {sezione("Tempo", corpoTempo)}
                    {sezione("Tipo", corpoTipo)}
                    {sezione("Dati", corpoDati)}
                    {hasFilters && (
                      <button
                        onClick={resetAll}
                        className="text-sm font-medium text-emerald-400 hover:underline"
                      >
                        Azzera i filtri
                      </button>
                    )}
                  </div>
                </FilterPopover>
                {ordina}
              </div>

              <div className="mt-3 hidden flex-wrap items-center gap-2 sm:flex">
                <FilterPopover label="Prezzo" value={maxPrice ? `≤ $${maxPrice.toLocaleString()}` : null} width="w-64">
                  {corpoPrezzo}
                </FilterPopover>
                <FilterPopover label="Lavanderia" value={etichettaLav} width="w-72">
                  {corpoLavanderia}
                </FilterPopover>
                <FilterPopover label="Quartiere" value={etichettaQuartiere}>
                  {corpoQuartiere}
                </FilterPopover>
                <FilterPopover
                  label="Tempo"
                  value={tiersFiltered ? `${activeTiers.size}/3` : null}
                  width="w-60"
                >
                  {corpoTempo}
                </FilterPopover>
                <FilterPopover label="Tipo" value={etichettaTipo} width="w-56">
                  {corpoTipo}
                </FilterPopover>
                <button
                  type="button"
                  onClick={() => setSoloAggiornati((v) => !v)}
                  aria-pressed={soloAggiornati}
                  title="Nasconde le case che nessuna fonte ha ricontrollato di recente"
                  className={chipClasse(soloAggiornati)}
                >
                  Solo dati aggiornati
                </button>
              </div>

              {/* Filtri attivi: con un filtro solo il chip lo dice gia', le pill
                  servono da due in su. "Azzera" c'e' sempre. */}
              {hasFilters && (
                <div className="no-scrollbar -mx-5 mt-2 flex items-center gap-1.5 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                  {nAttivi >= 2 && (
                    <>
                      {tiersFiltered &&
                        [...activeTiers].map((t) => (
                          <Pill
                            key={t}
                            label={TIERS[t as Exclude<TierId, "out">].label}
                            onRemove={() => setActiveTiers(toggle(activeTiers, t))}
                          />
                        ))}
                      {[...activeNeighborhoods].map((n) => (
                        <Pill key={n} label={n} onRemove={() => setActiveNeighborhoods(toggle(activeNeighborhoods, n))} />
                      ))}
                      {[...activeTypes].map((t) => (
                        <Pill key={t} label={formatType(t)} onRemove={() => setActiveTypes(toggle(activeTypes, t))} />
                      ))}
                      {furnishedOnly && <Pill label="Arredati" onRemove={() => setFurnishedOnly(false)} />}
                      {lavanderia !== "tutte" && (
                        <Pill
                          label={LAVANDERIE.find((x) => x.key === lavanderia)!.label}
                          onRemove={() => setLavanderia("tutte")}
                        />
                      )}
                      {soloAggiornati && <Pill label="Solo dati aggiornati" onRemove={() => setSoloAggiornati(false)} />}
                      {maxPrice != null && (
                        <Pill label={`≤ $${maxPrice.toLocaleString()}`} onRemove={() => setMaxPrice(null)} />
                      )}
                    </>
                  )}
                  <button
                    onClick={resetAll}
                    className="ml-1 shrink-0 whitespace-nowrap text-[11px] font-medium text-neutral-400 underline-offset-2 hover:text-neutral-300 hover:underline max-sm:py-1.5"
                  >
                    Azzera
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Lista card */}
        <div ref={listaRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {vista === "salvate" ? (
            <SavedList
              salvate={wl.salvate}
              vive={vive}
              onStato={wl.cambiaStato}
              onNota={wl.scriviNota}
              onRimuovi={wl.rimuovi}
              sotto={
                <AuthLine
                  utente={wl.utente}
                  sincronizzabile={wl.sincronizzabile}
                  errore={wl.errore}
                  onEntra={wl.entra}
                  onRegistra={wl.registra}
                  onEsci={wl.esci}
                />
              }
            />
          ) : loading ? (
            <div role="status" aria-label="Carico le case" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-[16/13] animate-pulse rounded-2xl bg-neutral-800" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-neutral-400">Nessuna casa con questi filtri.</p>
              {suggerimenti.length > 0 && (
                <div className="mt-3 flex flex-col items-center gap-1.5">
                  {suggerimenti.map((v) => (
                    <button
                      key={v.g}
                      onClick={v.togli}
                      className="rounded-full border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-200 transition hover:bg-neutral-800"
                    >
                      Togli {v.testo} → {nCase(v.n)}
                    </button>
                  ))}
                </div>
              )}
              {hasFilters && (
                <button
                  onClick={resetAll}
                  className="mt-2 text-sm font-medium text-emerald-400 hover:underline"
                >
                  Azzera i filtri
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Ordina sul desktop sta qui, sopra le card che riordina; sul
                  telefono e' nella barra dei filtri. */}
              <div className="mb-3 flex items-center justify-between max-sm:hidden">
                <span className="text-xs text-neutral-400">
                  Ordinate per {SORTS.find((x) => x.key === sort)!.label.toLowerCase()}
                </span>
                {ordina}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {visible.slice(0, limit).map((l) => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    selected={l.id === selectedId}
                    onSelect={() => setSelectedId(l.id)}
                    onOpen={() => openDetail(l.id)}
                    stato={
                      (salvateIdx.get(rifDi(l)) ?? salvateIdx.get(String(l.id)))?.stato ?? null
                    }
                    onSalva={() => toggleSalva(l)}
                  />
                ))}
              </div>
              {limit < visible.length && (
                <button
                  onClick={() => setLimit((n) => n + PAGE)}
                  className="mt-4 w-full rounded-full border border-neutral-700 bg-neutral-900 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-neutral-800"
                >
                  Mostra altre {Math.min(PAGE, visible.length - limit)} · restano {nCase(visible.length - limit)}
                </button>
              )}
              <div className="h-20 md:h-2" />
            </>
          )}
        </div>

        {mostraSu && vista === "tutte" && (
          <button
            onClick={() => listaRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="absolute bottom-20 right-4 z-30 rounded-full border border-neutral-600 bg-neutral-900/95 px-3.5 py-2.5 text-xs font-semibold text-neutral-100 shadow-lg backdrop-blur hover:bg-neutral-800 md:bottom-4"
          >
            ↑ Torna su
          </button>
        )}
      </aside>

      {/* Mappa */}
      <div className={`relative h-full w-full flex-1 ${mobileMap ? "block" : "hidden md:block"}`}>
        <MapView
          iso={iso}
          listings={vista === "salvate" ? salvateVive : visible}
          salvate={rifSalvati}
          selectedId={selectedId}
          fitKey={fitKey}
          onSelect={(id) => {
            setSelectedId(id);
            openDetail(id);
          }}
        />
      </div>

      {/* Toggle mappa/lista su mobile */}
      <button
        onClick={() => setMobileMap((v) => !v)}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-xs font-semibold text-neutral-900 shadow-xl md:hidden"
      >
        {mobileMap ? "☰ Lista" : "◵ Mappa"}
      </button>

      <ListingDetail
        listing={detail}
        onClose={() => setDetail(null)}
        salvata={
          detail
            ? salvateIdx.get(rifDi(detail)) ?? salvateIdx.get(String(detail.id)) ?? null
            : null
        }
        onStato={(stato) => {
          if (!detail) return;
          const s = salvateIdx.get(rifDi(detail)) ?? salvateIdx.get(String(detail.id));
          // Scegliere "Vista" su una casa mai salvata la salva gia' vista:
          // chiedere prima di salvarla sarebbe un passaggio in piu' per nulla.
          s ? wl.cambiaStato(rifSalvata(s), stato) : wl.salva(detail, stato);
        }}
        onNota={(nota) => {
          if (!detail) return;
          const s = salvateIdx.get(rifDi(detail)) ?? salvateIdx.get(String(detail.id));
          if (s) wl.scriviNota(rifSalvata(s), nota);
        }}
        onRimuovi={() => {
          if (!detail) return;
          const s = salvateIdx.get(rifDi(detail)) ?? salvateIdx.get(String(detail.id));
          if (s) wl.rimuovi(rifSalvata(s));
        }}
      />
    </main>
  );
}
