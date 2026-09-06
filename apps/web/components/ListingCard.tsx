"use client";

import { useState } from "react";
import type { ScoredListing } from "@/lib/listings";
import { formatPrice, formatDistance, tierMeta, sourceLabel } from "@/lib/format";

type Props = {
  listing: ScoredListing;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
};

export default function ListingCard({ listing, selected, onSelect, onOpen }: Props) {
  const [imgOk, setImgOk] = useState(true);
  const meta = tierMeta(listing.tier);
  const photo = listing.photos?.[0];

  return (
    <article
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`group cursor-pointer overflow-hidden rounded-2xl border bg-neutral-900 transition-all duration-200 hover:border-neutral-600 ${
        selected
          ? "border-white shadow-[0_0_0_1px_rgba(255,255,255,0.4)]"
          : "border-neutral-800"
      }`}
    >
      {/* Foto */}
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-neutral-800 to-neutral-900">
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
          style={{ backgroundColor: meta.color }}
        >
          {meta.label}
        </span>

        {/* prezzo */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          {listing.priceFrom && (
            <span className="mr-1 text-sm font-medium text-white/70">da</span>
          )}
          <span className="text-lg font-bold text-white">{formatPrice(listing.price)}</span>
          <span className="text-sm font-medium text-white/70">/mese</span>
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
          {/* anche "Arredato" sta nel corpo: sulla foto si scontrava con il
              badge del tier sulle card strette, come gia' il quartiere */}
          {listing.furnished && (
            <span className="rounded-full bg-neutral-800 px-2 py-0.5 font-medium text-neutral-200">
              Arredato
            </span>
          )}
          {listing.type && <span>{listing.type.toUpperCase()}</span>}
          {listing.sqft && (
            <>
              <span className="text-neutral-700">·</span>
              <span>{listing.sqft} ft²</span>
            </>
          )}
          <span className="text-neutral-700">·</span>
          <span>{formatDistance(listing.distanceM)} da Flatiron</span>
        </div>

        {/* convenienza */}
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300"
              style={{ width: `${Math.round(listing.convenienza * 100)}%` }}
            />
          </div>
          <span className="text-[11px] font-medium tabular-nums text-neutral-500">
            {Math.round(listing.convenienza * 100)}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {/* La scheda completa si apriva solo col doppio clic: sul telefono
              non e' un gesto che qualcuno prova, e nulla diceva che ci fosse
              dell'altro da vedere. Il doppio clic resta, ma ora c'e' anche un
              bottone. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white"
          >
            Dettagli
          </button>

          {/* tag fonte: apre l'annuncio originale senza passare dal dettaglio */}
          <a
            href={listing.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white"
          >
            Vedi su {sourceLabel((listing.sources ?? [listing.source])[0])}
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4.5 2h5.5v5.5M10 2 2.5 9.5" />
            </svg>
          </a>
        </div>
      </div>
    </article>
  );
}
