"use client";

import { useEffect, useState } from "react";
import type { ScoredListing } from "@/lib/listings";
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
};

export default function ListingDetail({ listing, onClose }: Props) {
  const [imgOk, setImgOk] = useState(true);

  useEffect(() => {
    setImgOk(true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listing, onClose]);

  if (!listing) return null;
  const meta = tierMeta(listing.tier);
  const photo = listing.photos?.[0];

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-xl bg-neutral-50 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-neutral-900">{value}</div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* foto */}
        <div className="relative aspect-[16/10] bg-gradient-to-br from-neutral-100 to-neutral-200">
          {photo && imgOk ? (
            <img
              src={photo}
              alt={listing.title}
              onError={() => setImgOk(false)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-neutral-300">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" />
                <path d="M9 22V12h6v10" />
              </svg>
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow-sm transition hover:bg-white"
            aria-label="Chiudi"
          >
            ✕
          </button>
          <span
            className="absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-semibold text-white shadow-sm"
            style={{ backgroundColor: meta.color }}
          >
            {meta.label}
          </span>
        </div>

        {/* corpo */}
        <div className="space-y-4 overflow-y-auto p-5" style={{ maxHeight: "calc(90vh - 25vw)" }}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold text-neutral-900">{listing.title}</h2>
            <div className="whitespace-nowrap text-right">
              <span className="text-xl font-bold text-neutral-900">{formatPrice(listing.price)}</span>
              <span className="text-sm text-neutral-400">/mese</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stat label="Tipologia" value={formatType(listing.type)} />
            <Stat label="Superficie" value={listing.sqft ? `${listing.sqft} ft²` : "n/d"} />
            <Stat label="Arredato" value={listing.furnished == null ? "n/d" : listing.furnished ? "Sì" : "No"} />
            <Stat label="Distanza" value={formatDistance(listing.distanceM)} />
          </div>

          <div className="rounded-xl border border-neutral-100 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-neutral-700">Convenienza</span>
              <span className="font-semibold text-emerald-600">
                {Math.round(listing.convenienza * 100)}/100
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                style={{ width: `${Math.round(listing.convenienza * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              Combina prezzo, vicinanza, spazio e arredamento.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400">
              Fonte: {(listing.sources ?? [listing.source]).map(sourceLabel).join(", ")}
            </span>
            <a
              href={listing.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700"
            >
              Vedi annuncio →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
