"use client";

/**
 * Le case salvate: quelle che voglio vedere e quelle gia' viste, con la nota.
 *
 * Due principi che spiegano tutto il resto del file.
 *
 * 1. Si salva una COPIA della scheda, non un puntatore. Una casa che ti
 *    interessava sparisce dal crawl esattamente quando la affittano, ed e'
 *    allora che vuoi ancora poter leggere cos'era e cosa ne pensavi. La copia
 *    serve anche a mostrare "era 3.200, ora 3.050".
 *
 * 2. Il browser e' sempre la copia di lavoro, Supabase la verita' condivisa fra
 *    i tuoi dispositivi. Si legge prima da localStorage — la lista compare
 *    subito, e continua a funzionare se sei sceso in metropolitana o se il
 *    progetto free e' andato in pausa per inattivita' — e poi si riallinea.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseConfigurato } from "./supabase";
import type { ScoredListing } from "./listings";
import type { TierId } from "./types";

export type Stato = "da_vedere" | "vista";

/** La copia della scheda: quel tanto che basta a ridisegnarla senza il crawl. */
export interface SchedaSalvata {
  title: string;
  price: number | null;
  priceFrom?: boolean;
  type: string | null;
  sqft: number | null;
  furnished: boolean | null;
  lat: number;
  lng: number;
  photo: string | null;
  sourceUrl: string;
  sources: string[];
  neighborhood: string | null;
  tier: TierId;
}

export interface Salvata {
  /** indirizzo normalizzato: l'aggancio che sopravvive ai cambi di fonte */
  chiave: string | null;
  /** ripiego per il ~7% di schede senza civico, dove la chiave non esiste */
  listingId: string;
  stato: Stato;
  nota: string;
  scheda: SchedaSalvata;
  salvataIl: string;
  vistaIl: string | null;
  aggiornataIl: string;
}

const CHIAVE_LOCALE = "flatiron:salvate:v1";

/** Come si chiama questa casa per la wishlist. */
export function rifDi(l: { chiave?: string | null; id: string | number }): string {
  return l.chiave ?? String(l.id);
}

/** Identita' di una riga salvata, con la stessa regola. */
export function rifSalvata(s: Salvata): string {
  return s.chiave ?? s.listingId;
}

function copiaDi(l: ScoredListing): SchedaSalvata {
  return {
    title: l.title,
    price: l.price,
    priceFrom: l.priceFrom,
    type: l.type,
    sqft: l.sqft,
    furnished: l.furnished,
    lat: l.lat,
    lng: l.lng,
    photo: l.photos?.[0] ?? null,
    sourceUrl: l.sourceUrl,
    sources: l.sources ?? [l.source],
    neighborhood: l.neighborhood,
    tier: l.tier,
  };
}

// ---------------------------------------------------------------- deposito

function leggiLocale(): Salvata[] {
  try {
    const s = localStorage.getItem(CHIAVE_LOCALE);
    return s ? (JSON.parse(s) as Salvata[]) : [];
  } catch {
    return []; // spazio esaurito, dati corrotti, modalita' privata: pazienza
  }
}

function scriviLocale(righe: Salvata[]): void {
  try {
    localStorage.setItem(CHIAVE_LOCALE, JSON.stringify(righe));
  } catch {
    /* la copia locale e' una comodita': se non entra, si continua col remoto */
  }
}

type RigaRemota = {
  rif: string;
  chiave: string | null;
  listing_id: string;
  stato: Stato;
  nota: string | null;
  scheda: SchedaSalvata;
  salvata_il: string;
  vista_il: string | null;
  aggiornata_il: string;
};

const daRemota = (r: RigaRemota): Salvata => ({
  chiave: r.chiave,
  listingId: r.listing_id,
  stato: r.stato,
  nota: r.nota ?? "",
  scheda: r.scheda,
  salvataIl: r.salvata_il,
  vistaIl: r.vista_il,
  aggiornataIl: r.aggiornata_il,
});

/**
 * `conTs`: inviare anche aggiornata_il. La colonna c'e' nel tipo RigaRemota e
 * viene letta (select *), ma db/schema.sql non contiene la tabella `salvate`:
 * non si puo' confermare che esista ne' che un trigger la valorizzi. Si invia
 * quindi solo dopo averla vista in una riga remota (vedi sincronizza).
 */
const aRemota = (s: Salvata, conTs = false) => ({
  rif: rifSalvata(s),
  chiave: s.chiave,
  listing_id: s.listingId,
  stato: s.stato,
  nota: s.nota || null,
  scheda: s.scheda,
  salvata_il: s.salvataIl,
  vista_il: s.vistaIl,
  ...(conTs ? { aggiornata_il: s.aggiornataIl } : {}),
});

// ------------------------------------------------- fusione e cancellazioni

/** Una cancellazione locale non (ancora) confermata dal server. */
export interface Tombstone {
  rif: string;
  il: string;
}

const CHIAVE_TOMBSTONE = "flatiron:salvate:cancellate:v1";

function leggiTombstone(): Tombstone[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHIAVE_TOMBSTONE) ?? "[]");
    return Array.isArray(v) ? v.filter((t) => t && typeof t.rif === "string") : [];
  } catch {
    return [];
  }
}

function scriviTombstone(t: Tombstone[]): void {
  try {
    localStorage.setItem(CHIAVE_TOMBSTONE, JSON.stringify(t));
  } catch {
    /* come per le salvate: comodita', non obbligo */
  }
}

const quando = (s: string | null | undefined): number => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? NaN : t;
};

/** Il momento dell'ultima modifica di una riga; per i dati vecchi, il salvataggio. */
const tsRiga = (s: Salvata) => quando(s.aggiornataIl ?? s.salvataIl);

export interface Fusione {
  finali: Salvata[];
  /** righe locali piu' recenti (o solo locali): da scrivere sul server */
  daSpingere: Salvata[];
  /** rif da cancellare sul server (tombstone ancora valide) */
  daCancellare: string[];
  /** tombstone superate da una riga remota piu' recente: da dimenticare */
  scartate: string[];
}

/**
 * Last write wins per rif. Funzione pura.
 * - solo remota: resta; solo locale: resta e va su;
 * - entrambe: vince la piu' recente per aggiornataIl; pari o senza data valida
 *   sul lato remoto: vince la remota (non si sovrascrive cio' che non si sa
 *   datare);
 * - tombstone: la riga remota non ricompare, salvo che sia stata riscritta
 *   DOPO la cancellazione (altro dispositivo): allora vince e la tombstone cade.
 */
export function fondi(locali: Salvata[], remote: Salvata[], tombstone: Tombstone[]): Fusione {
  const morti = new Map(tombstone.map((t) => [t.rif, quando(t.il)]));
  const perRif = new Map<string, Salvata>();
  const daCancellare: string[] = [];
  const scartate: string[] = [];

  for (const r of remote) {
    const rif = rifSalvata(r);
    if (morti.has(rif)) {
      const tm = morti.get(rif)!;
      if (quando(r.aggiornataIl) > tm) scartate.push(rif); // riscritta dopo la cancellazione
      else {
        daCancellare.push(rif);
        continue;
      }
    }
    perRif.set(rif, r);
  }
  const daSpingere: Salvata[] = [];
  for (const l of locali) {
    const rif = rifSalvata(l);
    if (morti.has(rif) && !scartate.includes(rif)) continue; // cancellata qui
    const r = perRif.get(rif);
    if (!r || tsRiga(l) > quando(r.aggiornataIl)) { // remota senza data: vince la remota
      perRif.set(rif, l);
      daSpingere.push(l);
    }
  }
  const finali = [...perRif.values()].sort((a, b) => (a.salvataIl < b.salvataIl ? 1 : -1));
  return { finali, daSpingere, daCancellare, scartate };
}

/** Quel tanto del client Supabase che serve alla sincronizzazione (finto nei test). */
export interface DbSalvate {
  select(): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  upsert(righe: object[]): PromiseLike<{ error: { message: string } | null }>;
  cancella(rif: string): PromiseLike<{ error: { message: string } | null }>;
}

export interface EsitoSincronizzazione {
  finali: Salvata[] | null; // null: select fallita, non si tocca niente
  tombstone: Tombstone[]; // quelle ancora da ritentare
  colonnaTs: boolean;
  errore: string | null;
}

/**
 * Login: prima si LEGGE, si fonde, poi si scrive solo cio' che vince. Cosi' un
 * dispositivo con copia vecchia non sovrascrive il server (C4) e una casa
 * tolta offline non ricompare (C9). `locali` e' una funzione: va letta dopo la
 * select, per non perdere quello che l'utente ha toccato nel frattempo.
 */
export async function sincronizza(
  db: DbSalvate,
  locali: () => Salvata[],
  tombstone: Tombstone[]
): Promise<EsitoSincronizzazione> {
  const { data, error } = await db.select();
  if (error || !data) {
    return { finali: null, tombstone, colonnaTs: false, errore: error?.message ?? null };
  }
  const righe = data as RigaRemota[];
  // Con 0 righe remote non si sa: si omette e, se c'e' un default/trigger, ci
  // pensa lui. Se la colonna c'e' ma non e' valorizzata, daRemota da' undefined
  // e tsRiga lo legge come "non databile".
  const colonnaTs = righe.some((r) => r.aggiornata_il != null);
  const f = fondi(locali(), righe.map(daRemota), tombstone);

  let errMsg: string | null = null;
  // Restano solo le tombstone la cui cancellazione e' ancora da riuscire: se la
  // riga non e' piu' sul server, o una riga piu' recente l'ha superata, cadono.
  const tombstoneResidue: Tombstone[] = [];
  for (const rif of f.daCancellare) {
    const r = await db.cancella(rif).then(
      (x) => x,
      () => ({ error: { message: "rete" } })
    );
    if (r.error) {
      errMsg = r.error.message;
      const t = tombstone.find((x) => x.rif === rif);
      if (t) tombstoneResidue.push(t);
    }
  }

  if (f.daSpingere.length) {
    const r = await db.upsert(f.daSpingere.map((s) => aRemota(s, colonnaTs))).then(
      (x) => x,
      () => ({ error: { message: "rete" } })
    );
    if (r.error) errMsg = r.error.message;
  }
  return { finali: f.finali, tombstone: tombstoneResidue, colonnaTs, errore: errMsg };
}

// ------------------------------------------------------------------- hook

export interface Wishlist {
  salvate: Salvata[];
  pronta: boolean;
  /** email di chi ha fatto login, null se la wishlist vive solo qui */
  utente: string | null;
  /** true quando c'e' un progetto configurato e si puo' fare login */
  sincronizzabile: boolean;
  errore: string | null;
  salva: (l: ScoredListing, stato?: Stato) => void;
  cambiaStato: (rif: string, stato: Stato) => void;
  scriviNota: (rif: string, nota: string) => void;
  rimuovi: (rif: string) => void;
  entra: (email: string, password: string) => Promise<string>;
  registra: (email: string, password: string) => Promise<string>;
  esci: () => Promise<void>;
}

export function useWishlist(): Wishlist {
  const [salvate, setSalvate] = useState<Salvata[]>([]);
  const [pronta, setPronta] = useState(false);
  const [utente, setUtente] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  // Le scritture remote non devono bloccare l'interfaccia: si aggiorna subito
  // lo stato locale e si spinge al DB per conto proprio. Questo ref tiene la
  // versione corrente per i push, senza rimontare i callback a ogni modifica.
  const correnti = useRef<Salvata[]>([]);
  correnti.current = salvate;
  // true solo dopo aver visto aggiornata_il in una riga remota (vedi aRemota)
  const colonnaTs = useRef(false);

  const applica = useCallback((agg: (v: Salvata[]) => Salvata[]) => {
    setSalvate((v) => {
      const nuove = agg(v);
      scriviLocale(nuove);
      return nuove;
    });
  }, []);

  /** Manda una riga al DB. Silenzioso se non c'e' sessione: resta locale. */
  const spingi = useCallback(async (s: Salvata) => {
    if (!supabase || !utente) return;
    try {
      const { error } = await supabase
        .from("salvate")
        .upsert(aRemota(s, colonnaTs.current), { onConflict: "user_id,rif" });
      if (error) setErrore(error.message);
    } catch {
      // La casa e' gia' salvata nel browser: la sincronizzazione riparte alla
      // prossima apertura. Fermare l'interfaccia per una rete ballerina
      // sarebbe peggio del problema.
    }
  }, [utente]);

  // primo caricamento: locale subito, remoto appena si sa chi sei
  useEffect(() => {
    setSalvate(leggiLocale());
    setPronta(true);
    if (!supabase) return;
    // Il .catch non e' di cortesia: senza, una rete assente rifiuta la
    // promise e nessuno la raccoglie. E la rete assente qui e' la normalita' —
    // questa app la apri camminando per strada o in metropolitana.
    supabase.auth
      .getSession()
      .then(({ data }) => setUtente(data.session?.user.email ?? null))
      .catch(() => setUtente(null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sessione) => {
      setUtente(sessione?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // appena c'e' una sessione: porta su quello che era rimasto qui, poi allinea
  useEffect(() => {
    if (!supabase || !utente) return;
    let vivo = true;
    (async () => {
      const db: DbSalvate = {
        select: () => supabase!.from("salvate").select("*"),
        upsert: (righe) => supabase!.from("salvate").upsert(righe, { onConflict: "user_id,rif" }),
        cancella: (rif) => supabase!.from("salvate").delete().eq("rif", rif),
      };
      const esito = await sincronizza(db, () => correnti.current, leggiTombstone());
      if (!vivo) return;
      if (esito.errore) setErrore(esito.errore);
      if (!esito.finali) return; // select fallita: si tiene quello che c'e' qui
      colonnaTs.current = esito.colonnaTs;
      scriviTombstone(esito.tombstone);
      setSalvate(esito.finali);
      scriviLocale(esito.finali);
    })().catch(() => {
      // Rete caduta a meta' sincronizzazione: si tiene quello che c'e' nel
      // browser. Non e' un errore da mostrare — le case salvate sono tutte
      // li' e l'allineamento riparte da solo alla prossima apertura.
      if (vivo) setErrore(null);
    });
    return () => {
      vivo = false;
    };
  }, [utente]);

  const salva = useCallback(
    (l: ScoredListing, stato: Stato = "da_vedere") => {
      const ora = new Date().toISOString();
      const riga: Salvata = {
        chiave: l.chiave ?? null,
        listingId: String(l.id),
        stato,
        nota: "",
        scheda: copiaDi(l),
        salvataIl: ora,
        vistaIl: stato === "vista" ? ora : null,
        aggiornataIl: ora,
      };
      applica((v) => [riga, ...v.filter((x) => rifSalvata(x) !== rifDi(l))]);
      // risalvata dopo una cancellazione non riuscita: la tombstone non vale piu'
      scriviTombstone(leggiTombstone().filter((t) => t.rif !== rifDi(l)));
      void spingi(riga);
    },
    [applica, spingi]
  );

  const modifica = useCallback(
    (rif: string, patch: (s: Salvata) => Salvata) => {
      let toccata: Salvata | null = null;
      applica((v) =>
        v.map((s) => {
          if (rifSalvata(s) !== rif) return s;
          toccata = { ...patch(s), aggiornataIl: new Date().toISOString() };
          return toccata;
        })
      );
      if (toccata) void spingi(toccata);
    },
    [applica, spingi]
  );

  const cambiaStato = useCallback(
    (rif: string, stato: Stato) =>
      modifica(rif, (s) => ({
        ...s,
        stato,
        // La data della visita si scrive una volta sola: tornare su "da vedere"
        // e poi di nuovo su "vista" non deve riscrivere quando l'hai vista.
        vistaIl: stato === "vista" ? s.vistaIl ?? new Date().toISOString() : s.vistaIl,
      })),
    [modifica]
  );

  const scriviNota = useCallback(
    (rif: string, nota: string) => modifica(rif, (s) => ({ ...s, nota })),
    [modifica]
  );

  const rimuovi = useCallback(
    (rif: string) => {
      const s = correnti.current.find((x) => rifSalvata(x) === rif);
      applica((v) => v.filter((x) => rifSalvata(x) !== rif));
      if (!supabase || !s) return;
      // Tombstone PRIMA del delete: se la rete cade, o non c'e' sessione, al
      // prossimo login la casa non deve ricomparire.
      const altre = leggiTombstone().filter((t) => t.rif !== rif);
      scriviTombstone([...altre, { rif, il: new Date().toISOString() }]);
      if (!utente) return;
      const fatto = (ok: boolean, msg?: string) => {
        if (ok) scriviTombstone(leggiTombstone().filter((t) => t.rif !== rif));
        else if (msg) setErrore(msg);
      };
      void Promise.resolve(supabase.from("salvate").delete().eq("rif", rif)).then(
        ({ error }) => fatto(!error, error?.message),
        () => fatto(false) // rete caduta: la tombstone resta e si ritenta al login
      );
    },
    [applica, utente]
  );

/**
 * Traduce gli errori che contano. supabase-js gli errori di rete li RESTITUISCE
 * invece di lanciarli, quindi il try/catch non li vede: senza questa riga, chi
 * prova ad accedere in metropolitana si legge "Failed to fetch".
 */
function inItaliano(messaggio: string): string {
  if (/failed to fetch|networkerror|fetch failed|load failed/i.test(messaggio)) {
    return "Non riesco a raggiungere il server. Controlla la connessione e riprova.";
  }
  if (/invalid login/i.test(messaggio)) {
    // Supabase da' lo stesso errore per password sbagliata e utente
    // inesistente, apposta: distinguerli aiuterebbe chi prova le email altrui.
    return "Email o password non corrispondono. Se e' la prima volta, usa «Crea account».";
  }
  if (/already registered/i.test(messaggio)) return "Questo account esiste gia': usa «Accedi».";
  if (/password should be at least/i.test(messaggio)) {
    return "La password e' troppo corta: servono almeno sei caratteri.";
  }
  return messaggio;
}

  // Email e password invece del link per email. Il link era piu' sicuro sulla
  // carta, ma andava aperto su OGNI dispositivo, e il piano gratuito manda
  // pochissime email all'ora: due telefoni in un pomeriggio e resti fuori.
  const entra = useCallback(async (email: string, password: string) => {
    if (!supabase) return "Sincronizzazione non configurata.";
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error ? inItaliano(error.message) : "";
    } catch {
      return "Non riesco a raggiungere il server. Riprova fra poco.";
    }
  }, []);

  const registra = useCallback(async (email: string, password: string) => {
    if (!supabase) return "Sincronizzazione non configurata.";
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return inItaliano(error.message);
      // Se il progetto chiede la conferma via email, l'utente esiste ma non ha
      // sessione: senza questo messaggio sembrerebbe che non sia successo nulla.
      return data.session
        ? ""
        : "Account creato. Conferma dalla mail che ti e' arrivata, poi accedi.";
    } catch {
      return "Non riesco a raggiungere il server. Riprova fra poco.";
    }
  }, []);

  const esci = useCallback(async () => {
    await supabase?.auth.signOut();
    setUtente(null);
  }, []);

  return useMemo(
    () => ({
      salvate,
      pronta,
      utente,
      sincronizzabile: supabaseConfigurato,
      errore,
      salva,
      cambiaStato,
      scriviNota,
      rimuovi,
      entra,
      registra,
      esci,
    }),
    [salvate, pronta, utente, errore, salva, cambiaStato, scriviNota, rimuovi, entra, registra, esci]
  );
}

/** Indice per ritrovare in fretta se una casa e' salvata (per chiave o per id). */
export function indice(salvate: Salvata[]): Map<string, Salvata> {
  const m = new Map<string, Salvata>();
  for (const s of salvate) {
    m.set(rifSalvata(s), s);
    // Anche sotto l'id: una riga salvata prima che il crawl emettesse le chiavi
    // ha chiave null, e va ritrovata lo stesso quando la casa ora ce l'ha.
    m.set(s.listingId, s);
  }
  return m;
}
