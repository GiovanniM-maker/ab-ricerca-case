"use client";

import { useState } from "react";
import type { ScoredListing } from "@/lib/listings";
import { formatPrice, formatDistance, tierMeta } from "@/lib/format";

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
      className={`group cursor-pointer overflow-hidden rounded-2xl border bg-white transition-all duration-200 hover:shadow-lg ${
        selected ? "border-neutral-900 shadow-md ring-1 ring-neutral-900" : "border-neutral-200"
      }`}
    >
      {/* Foto */}
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-neutral-100 to-neutral-200">
        {photo && imgOk ? (
          <img
            src={photo}
            alt={listing.title}
            loading="lazy"
            onError={() => setImgOk(false)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-300">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" />
              <path d="M9 22V12h6v10" />
            </svg>
          </div>
        )}

        {/* badge tier */}
        <span
          className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur"
          style={{ backgroundColor: meta.color }}
        >
          {meta.label}
        </span>

        {/* arredato */}
        {listing.furnished && (
          <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-neutral-700 shadow-sm">
            Arredato
          </span>
        )}

        {/* prezzo */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
          <span className="text-lg font-bold text-white">{formatPrice(listing.price)}</span>
          <span className="text-sm font-medium text-white/80">/mese</span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3.5">
        <h3 className="truncate text-sm font-semibold text-neutral-900">{listing.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
          {listing.type && <span>{listing.type.toUpperCase()}</span>}
          {listing.sqft && (
            <>
              <span className="text-neutral-300">·</span>
              <span>{listing.sqft} ft²</span>
            </>
          )}
          <span className="text-neutral-300">·</span>
          <span>{formatDistance(listing.distanceM)} da Flatiron</span>
        </div>

        {/* convenienza */}
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600"
              style={{ width: `${Math.round(listing.convenienza * 100)}%` }}
            />
          </div>
          <span className="text-[11px] font-medium tabular-nums text-neutral-400">
            {Math.round(listing.convenienza * 100)}
          </span>
        </div>
      </div>
    </article>
  );
}
