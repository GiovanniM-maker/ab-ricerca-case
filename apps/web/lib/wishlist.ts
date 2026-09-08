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

const aRemota = (s: Salvata) => ({
  rif: rifSalvata(s),
  chiave: s.chiave,
  listing_id: s.listingId,
  stato: s.stato,
  nota: s.nota || null,
  scheda: s.scheda,
  salvata_il: s.salvataIl,
  vista_il: s.vistaIl,
});

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
  entra: (email: string) => Promise<string>;
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
        .upsert(aRemota(s), { onConflict: "user_id,rif" });
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
      const locali = correnti.current;
      if (locali.length) {
        const { error } = await supabase
          .from("salvate")
          .upsert(locali.map(aRemota), { onConflict: "user_id,rif" });
        // Un conflitto qui non e' fatale: la riga remota e' comunque piu'
        // aggiornata di quella locale se e' stata scritta da un altro telefono.
        if (error && vivo) setErrore(error.message);
      }
      const { data, error } = await supabase.from("salvate").select("*");
      if (!vivo) return;
      if (error) return setErrore(error.message);
      const righe = (data as RigaRemota[]).map(daRemota);
      setSalvate(righe);
      scriviLocale(righe);
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
      if (supabase && utente && s) {
        void supabase
          .from("salvate")
          .delete()
          .eq("rif", rif)
          .then(({ error }) => error && setErrore(error.message));
      }
    },
    [applica, utente]
  );

  const entra = useCallback(async (email: string) => {
    if (!supabase) return "Sincronizzazione non configurata.";
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      return error ? error.message : "Ti ho mandato un link per email: aprilo da qui.";
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
      esci,
    }),
    [salvate, pronta, utente, errore, salva, cambiaStato, scriviNota, rimuovi, entra, esci]
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
