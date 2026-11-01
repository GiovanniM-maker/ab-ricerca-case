"use client";

import { useState } from "react";
import type { ScoredListing } from "@/lib/listings";
import {
  formatPrice,
  formatDistance,
  formatGiorno,
  formatType,
  testoLavanderia,
  tierBadgeColor,
  tierMeta,
  sourceDaUrl,
  sourceLabel,
} from "@/lib/format";
import type { Stato } from "@/lib/wishlist";
import type { Lavanderia } from "@/lib/listings";

/** Come si colora la lavanderia. "sconosciuta" non compare: sarebbe
 *  un'etichetta su molte schede che non dice niente. Il testo e' di
 *  testoLavanderia, lo stesso della scheda di dettaglio. */
const LAVANDERIA: Partial<Record<Lavanderia, string>> = {
  "in-casa": "border-sky-500/60 bg-sky-500/15 text-sky-300",
  edificio: "border-sky-800 bg-sky-950/60 text-sky-400/90",
  assente: "border-neutral-700 bg-neutral-900 text-neutral-400",
};

type Props = {
  listing: ScoredListing;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  /** null se la casa non e' fra le salvate */
  stato: Stato | null;
  onSalva: () => void;
};

/** Le due righe in cui la casa va meglio (rispetto al massimo possibile): la ragione in breve. */
function ragioni(l: ScoredListing): string {
  return l.componenti
    .filter((c) => c.max >= 5 && c.punti > 0)
    .map((c) => ({ label: c.label, forza: c.punti / c.max }))
    .filter((c) => c.forza >= 0.7)
    .sort((x, y) => y.forza - x.forza)
    .slice(0, 2)
    .map((c) => c.label.toLowerCase())
    .join(", ");
}

export default function ListingCard({
  listing,
  selected,
  onSelect,
  onOpen,
  stato,
  onSalva,
}: Props) {
  const [imgOk, setImgOk] = useState(true);
  const meta = tierMeta(listing.tier);
  const photo = listing.photos?.[0];
  const dalGiorno = listing.datoDel;
  const punteggio = Math.round(listing.convenienza * 100);
  const perche = ragioni(listing);

  // Il clic sulla card apre il dettaglio e porta la mappa sulla casa. L'annuncio
  // esterno si apre solo da "Vedi su…": un tocco sul corpo della card e' il
  // gesto per scorrere, non deve lanciare un'altra scheda del browser.
  const apri = () => {
    onSelect();
    onOpen();
  };

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`${listing.title}, ${formatPrice(listing.price)} al mese. Apri i dettagli`}
      onClick={apri}
      onKeyDown={(e) => {
        // Solo se il tasto e' sulla card: Invio su "Salva" deve salvare e basta.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          apri();
        }
      }}
      className={`group cursor-pointer overflow-hidden rounded-2xl border bg-neutral-900 transition-all duration-200 hover:border-neutral-600 ${
        selected
          ? "border-white shadow-[0_0_0_1px_rgba(255,255,255,0.4)]"
          : "border-neutral-800"
      }`}
    >
      {/* Foto: sul telefono piu' bassa, perche' ne devono entrare di piu' */}
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-neutral-800 to-neutral-900 max-sm:aspect-auto max-sm:h-32">
        {photo && imgOk ? (
          <img
            src={photo}
            alt={listing.title}
            loading="lazy"
            onError={() => setImgOk(false)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-700">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" />
              <path d="M9 22V12h6v10" />
            </svg>
          </div>
        )}

        {/* badge tier */}
        <span
          className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow-lg"
          style={{ backgroundColor: tierBadgeColor(listing.tier) }}
        >
          {meta.label}
        </span>

        {/* prezzo */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-3 pt-8">
          {listing.priceFrom && (
            <span
              className="mr-1 cursor-help text-sm font-medium text-white/80 underline decoration-dotted underline-offset-2"
              title="Prezzo minimo del palazzo, non di questa unità"
            >
              da
            </span>
          )}
          <span className="text-lg font-bold text-white">{formatPrice(listing.price)}</span>
          <span className="text-sm font-medium text-white/80">/mese</span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3.5">
        <h3 className="truncate text-sm font-semibold text-neutral-100">{listing.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
          {/* tag quartiere: sta nel corpo e non sulla foto, dove si scontrava
              con il badge del tier su card strette */}
          {listing.neighborhood && (
            <span className="rounded-full border border-neutral-600 px-2 py-0.5 font-semibold text-neutral-200">
              {listing.neighborhood}
            </span>
          )}
          {/* La lavanderia sta per prima fra le informazioni: e' il requisito
              che fa scartare una casa a prescindere dal resto. */}
          {LAVANDERIA[listing.lavanderia] && (
            <span
              className={`rounded-full border px-2 py-0.5 font-medium ${
                LAVANDERIA[listing.lavanderia]
              }`}
            >
              {testoLavanderia(listing.lavanderia, listing.lavanderiaDaVerificare)}
            </span>
          )}
          {listing.curato && (
            <span className="rounded-full border border-emerald-500/60 bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300">
              Segnalata
            </span>
          )}
          {dalGiorno && (
            <span
              className="rounded-full border border-amber-700 bg-amber-950/60 px-2 py-0.5 font-medium text-amber-400"
              title="Nessuna fonte ha ricontrollato questa casa dopo quel giorno"
            >
              Dato del {formatGiorno(dalGiorno)}
            </span>
          )}
          {/* anche "Arredato" sta nel corpo: sulla foto si scontrava con il
              badge del tier sulle card strette, come gia' il quartiere */}
          {listing.furnished && (
            <span className="rounded-full bg-neutral-800 px-2 py-0.5 font-medium text-neutral-200">
              Arredato
            </span>
          )}
          {/* niente "·" a mano: sul telefono restava appeso a fine riga */}
          {listing.type && <span>{formatType(listing.type)}</span>}
          {listing.sqft && <span>{listing.sqft} ft²</span>}
          <span>{formatDistance(listing.distanceM)} da Flatiron</span>
        </div>

        {/* convenienza: con l'etichetta e le due ragioni migliori; il perche'
            completo e' nella scheda di dettaglio */}
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span
              title={listing.componenti
                .map((c) => `${c.label} ${c.punti >= 0 ? "+" : ""}${c.punti.toFixed(0)}`)
                .join(", ")}
            >
              <span className="font-medium text-neutral-300">Convenienza</span>
              {perche && <span> · forte su {perche}</span>}
            </span>
            <span className="font-semibold tabular-nums text-neutral-200">{punteggio}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300"
              style={{ width: `${punteggio}%` }}
            />
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2 max-sm:gap-2.5">
          {/* Salva. Il segnalibro pieno dice a colpo d'occhio quali case hai
              gia' messo da parte mentre scorri l'elenco intero. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSalva();
            }}
            aria-pressed={stato !== null}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition max-sm:px-3.5 max-sm:py-2.5 max-sm:text-xs ${
              stato
                ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                : "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800 hover:text-white"
            }`}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill={stato ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="1.6"
              className="max-sm:h-3 max-sm:w-3"
            >
              <path d="M3 1.5h6v9L6 8.25 3 10.5v-9Z" strokeLinejoin="round" />
            </svg>
            {stato === "vista" ? "Visitata" : stato ? "Da visitare" : "Salva"}
          </button>

          {/* "Dettagli" resta: e' la via esplicita, anche se ora la card intera apre la scheda. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              apri();
            }}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white max-sm:px-3.5 max-sm:py-2.5 max-sm:text-xs"
          >
            Dettagli
          </button>

          {/* tag fonte: l'unica via verso l'annuncio originale dalla card */}
          <a
            href={listing.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white max-sm:px-3.5 max-sm:py-2.5 max-sm:text-xs"
          >
            Vedi su {sourceLabel(sourceDaUrl(listing.sourceUrl, listing.source))}
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4.5 2h5.5v5.5M10 2 2.5 9.5" />
            </svg>
          </a>
        </div>
      </div>
    </article>
  );
}
