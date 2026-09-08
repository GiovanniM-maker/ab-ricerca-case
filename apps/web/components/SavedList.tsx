"use client";

/**
 * La wishlist: da vedere sopra, gia' viste sotto.
 *
 * Non riusa ListingCard di proposito. Meta' delle case che ti interessavano,
 * col tempo, spariscono dal crawl — le hanno affittate — e di quelle non esiste
 * piu' una ScoredListing da mostrare: esiste la copia che abbiamo salvato. E
 * quando rileggi la wishlist non stai piu' scegliendo case, stai rileggendo i
 * tuoi appunti: la nota conta piu' della foto, e si modifica sul posto invece
 * di aprire la scheda intera.
 */

import { useState } from "react";
import type { ScoredListing } from "@/lib/listings";
import type { Salvata, Stato } from "@/lib/wishlist";
import { rifSalvata } from "@/lib/wishlist";
import { formatPrice, formatDistance } from "@/lib/format";
import { TIERS, OUT_META } from "@/lib/types";

type Props = {
  salvate: Salvata[];
  /** le stesse case nel crawl di oggi, se ci sono ancora */
  vive: Map<string, ScoredListing>;
  onStato: (rif: string, stato: Stato) => void;
  onNota: (rif: string, nota: string) => void;
  onRimuovi: (rif: string) => void;
};

function Riga({
  s,
  vivo,
  onStato,
  onNota,
  onRimuovi,
}: {
  s: Salvata;
  vivo: ScoredListing | undefined;
  onStato: (stato: Stato) => void;
  onNota: (nota: string) => void;
  onRimuovi: () => void;
}) {
  const [aperta, setAperta] = useState(false);
  const [bozza, setBozza] = useState(s.nota);
  const [imgOk, setImgOk] = useState(true);

  const meta = s.scheda.tier === "out" ? OUT_META : TIERS[s.scheda.tier];
  const prezzoOra = vivo?.price ?? null;
  const cambiato = prezzoOra != null && s.scheda.price != null && prezzoOra !== s.scheda.price;

  const salvaNota = () => {
    if (bozza !== s.nota) onNota(bozza);
  };

  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
      <button
        type="button"
        onClick={() => setAperta((v) => !v)}
        className="flex w-full items-stretch gap-3 text-left transition hover:bg-neutral-800/40"
      >
        <div className="relative h-[4.5rem] w-24 shrink-0 overflow-hidden bg-gradient-to-br from-neutral-800 to-neutral-900">
          {s.scheda.photo && imgOk ? (
            <img
              src={s.scheda.photo}
              alt={s.scheda.title}
              loading="lazy"
              onError={() => setImgOk(false)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-neutral-700">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" />
                <path d="M9 22V12h6v10" />
              </svg>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 py-2 pr-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-neutral-100">{s.scheda.title}</h3>
            <div className="whitespace-nowrap text-right text-sm font-bold text-neutral-100">
              {formatPrice(prezzoOra ?? s.scheda.price)}
            </div>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
            <span className="rounded-full px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: meta.color }}>
              {meta.label}
            </span>
            {s.scheda.neighborhood && <span>{s.scheda.neighborhood}</span>}
            {vivo && <span>{formatDistance(vivo.distanceM)} da Flatiron</span>}
            {/* Il prezzo di allora e' il motivo per cui salviamo una copia. */}
            {cambiato && (
              <span className={prezzoOra! < s.scheda.price! ? "text-emerald-400" : "text-amber-400"}>
                era {formatPrice(s.scheda.price)}
              </span>
            )}
            {!vivo && (
              <span className="rounded-full border border-neutral-700 px-1.5 py-0.5 text-neutral-500">
                non più in elenco
              </span>
            )}
          </div>

          {s.nota && !aperta && (
            <p className="mt-1 truncate text-[11px] italic text-neutral-500">{s.nota}</p>
          )}
        </div>
      </button>

      {aperta && (
        <div className="border-t border-neutral-800 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["da_vedere", "Da vedere"],
                ["vista", "Vista"],
              ] as [Stato, string][]
            ).map(([st, label]) => (
              <button
                key={st}
                type="button"
                onClick={() => onStato(st)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  s.stato === st
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                    : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {label}
              </button>
            ))}
            <a
              href={s.scheda.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800"
            >
              Annuncio →
            </a>
            <button
              type="button"
              onClick={onRimuovi}
              className="ml-auto text-xs text-neutral-500 transition hover:text-neutral-300"
            >
              Togli
            </button>
          </div>

          <textarea
            value={bozza}
            onChange={(e) => setBozza(e.target.value)}
            onBlur={salvaNota}
            rows={3}
            placeholder={
              s.stato === "vista" ? "Che impressione ti ha fatto?" : "Cosa vuoi ricordarti di chiedere?"
            }
            className="mt-2.5 w-full resize-y rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none transition placeholder:text-neutral-600 focus:border-neutral-600"
          />
          <div className="mt-1 text-[11px] text-neutral-600">
            {s.vistaIl
              ? `Vista il ${new Date(s.vistaIl).toLocaleDateString("it-IT")}`
              : `Salvata il ${new Date(s.salvataIl).toLocaleDateString("it-IT")}`}
          </div>
        </div>
      )}
    </article>
  );
}

export default function SavedList({ salvate, vive, onStato, onNota, onRimuovi }: Props) {
  const daVedere = salvate.filter((s) => s.stato === "da_vedere");
  const viste = salvate.filter((s) => s.stato === "vista");

  if (!salvate.length) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-neutral-400">Non hai ancora salvato nessuna casa.</p>
        <p className="mt-1 text-xs text-neutral-600">
          Nell&apos;elenco, il segnalibro su una scheda la mette qui.
        </p>
      </div>
    );
  }

  const Sezione = ({ titolo, righe }: { titolo: string; righe: Salvata[] }) =>
    righe.length ? (
      <section className="mb-5">
        <h2 className="mb-2 text-[11px] uppercase tracking-wide text-neutral-500">
          {titolo} ({righe.length})
        </h2>
        <div className="space-y-2">
          {righe.map((s) => {
            const rif = rifSalvata(s);
            return (
              <Riga
                key={rif}
                s={s}
                vivo={vive.get(rif) ?? vive.get(s.listingId)}
                onStato={(st) => onStato(rif, st)}
                onNota={(n) => onNota(rif, n)}
                onRimuovi={() => onRimuovi(rif)}
              />
            );
          })}
        </div>
      </section>
    ) : null;

  return (
    <>
      <Sezione titolo="Da vedere" righe={daVedere} />
      <Sezione titolo="Viste" righe={viste} />
    </>
  );
}
