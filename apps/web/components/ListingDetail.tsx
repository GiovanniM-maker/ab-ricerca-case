"use client";

import { useEffect, useRef, useState } from "react";
import type { ScoredListing } from "@/lib/listings";
import type { Salvata, Stato } from "@/lib/wishlist";
import {
  formatPrice,
  formatType,
  formatDistance,
  tierMeta,
  sourceLabel,
} from "@/lib/format";

type Props = {
  listing: ScoredListing | null;
  onClose: () => void;
  /** la riga della wishlist per questa casa, null se non e' salvata */
  salvata: Salvata | null;
  onStato: (stato: Stato) => void;
  onNota: (nota: string) => void;
  onRimuovi: () => void;
};

export default function ListingDetail({
  listing,
  onClose,
  salvata,
  onStato,
  onNota,
  onRimuovi,
}: Props) {
  const [imgOk, setImgOk] = useState(true);
  // La nota si scrive qui e si salva da sola poco dopo che hai smesso di
  // digitare: un bottone "salva" su un campo del genere si dimentica, e la
  // nota che pensavi di aver scritto non c'e' piu'.
  const [bozza, setBozza] = useState("");
  const [salvataOra, setSalvataOra] = useState(false);
  const primoRender = useRef(true);

  useEffect(() => {
    setImgOk(true);
    setBozza(salvata?.nota ?? "");
    primoRender.current = true;
  }, [listing, salvata?.nota]);

  useEffect(() => {
    // Non scrivere al montaggio: sovrascriverebbe la nota con se stessa a ogni
    // apertura della scheda, e ogni apertura sarebbe una scrittura sul DB.
    if (primoRender.current) {
      primoRender.current = false;
      return;
    }
    if (bozza === (salvata?.nota ?? "")) return;
    const t = setTimeout(() => {
      onNota(bozza);
      setSalvataOra(true);
      setTimeout(() => setSalvataOra(false), 1800);
    }, 700);
    return () => clearTimeout(t);
  }, [bozza, salvata?.nota, onNota]);

  useEffect(() => {
    if (!listing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Prevent the page behind the modal from scrolling while it's open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [listing, onClose]);

  if (!listing) return null;
  const meta = tierMeta(listing.tier);
  const photo = listing.photos?.[0];

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-xl bg-neutral-800/60 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-neutral-100">{value}</div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-neutral-800 bg-neutral-900 shadow-2xl sm:my-auto sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* foto */}
        <div className="relative h-52 w-full shrink-0 overflow-hidden bg-gradient-to-br from-neutral-800 to-neutral-900 sm:aspect-[16/10] sm:h-auto">
          {photo && imgOk ? (
            <img
              src={photo}
              alt={listing.title}
              onError={() => setImgOk(false)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-neutral-700">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" />
                <path d="M9 22V12h6v10" />
              </svg>
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-950/80 text-neutral-200 shadow-sm backdrop-blur transition hover:bg-neutral-950"
            aria-label="Chiudi"
          >
            ✕
          </button>
          <span
            className="absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-semibold text-white shadow-lg"
            style={{ backgroundColor: meta.color }}
          >
            {meta.label}
          </span>
        </div>

        {/* corpo */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold text-neutral-50">{listing.title}</h2>
            <div className="whitespace-nowrap text-right">
              {listing.priceFrom && (
                <span className="mr-1 text-sm text-neutral-500">da</span>
              )}
              <span className="text-xl font-bold text-neutral-50">{formatPrice(listing.price)}</span>
              <span className="text-sm text-neutral-500">/mese</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stat label="Tipologia" value={formatType(listing.type)} />
            <Stat label="Superficie" value={listing.sqft ? `${listing.sqft} ft²` : "n/d"} />
            <Stat label="Arredato" value={listing.furnished == null ? "n/d" : listing.furnished ? "Sì" : "No"} />
            <Stat label="Distanza" value={formatDistance(listing.distanceM)} />
            {listing.stationM != null && (
              <div className="col-span-2">
                <Stat label="Metro più vicina" value={formatDistance(listing.stationM)} />
              </div>
            )}
          </div>

          {/* Servizi dell'edificio: la portineria che ritira i pacchi pesa nel
              punteggio, quindi va anche mostrata — un numero che sale senza
              dire perche' non serve a decidere. */}
          {!!listing.amenities?.length && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">
                Servizi
              </div>
              <div className="flex flex-wrap gap-1.5">
                {listing.amenities.slice(0, 12).map((a) => (
                  <span
                    key={a}
                    className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* La wishlist. Due livelli e una nota: prima della visita la nota
              e' un promemoria di cosa chiedere, dopo e' l'impressione che
              altrimenti si confonde con quella delle altre nove case viste. */}
          <div className="rounded-xl border border-neutral-800 p-3">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["da_vedere", "Da vedere"],
                  ["vista", "Vista"],
                ] as [Stato, string][]
              ).map(([s, label]) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onStato(s)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    salvata?.stato === s
                      ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                      : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                  }`}
                >
                  {label}
                </button>
              ))}
              {salvata && (
                <button
                  type="button"
                  onClick={onRimuovi}
                  className="ml-auto text-xs text-neutral-500 transition hover:text-neutral-300"
                >
                  Togli
                </button>
              )}
            </div>

            {salvata && (
              <>
                <textarea
                  value={bozza}
                  onChange={(e) => setBozza(e.target.value)}
                  rows={3}
                  placeholder={
                    salvata.stato === "vista"
                      ? "Che impressione ti ha fatto?"
                      : "Cosa vuoi ricordarti di chiedere?"
                  }
                  className="mt-2.5 w-full resize-y rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none transition placeholder:text-neutral-600 focus:border-neutral-600"
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-600">
                  <span>
                    {salvata.vistaIl
                      ? `Vista il ${new Date(salvata.vistaIl).toLocaleDateString("it-IT")}`
                      : `Salvata il ${new Date(salvata.salvataIl).toLocaleDateString("it-IT")}`}
                  </span>
                  <span className={salvataOra ? "text-emerald-500" : "opacity-0"}>
                    nota salvata
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-neutral-300">Convenienza</span>
              <span className="font-semibold text-emerald-400">
                {Math.round(listing.convenienza * 100)}/100
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300"
                style={{ width: `${Math.round(listing.convenienza * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Combina prezzo, vicinanza (a piedi vale piu' dei mezzi, e per gli altri
              conta quanto dista la metro), spazio, servizi e foto.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-neutral-500">
              Fonte: {(listing.sources ?? [listing.source]).map(sourceLabel).join(", ")}
            </span>
            <a
              href={listing.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200"
            >
              Vedi annuncio →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
