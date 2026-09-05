"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  /** Testo del valore selezionato, mostrato accanto all'etichetta. */
  value?: string | null;
  children: React.ReactNode;
  width?: string;
};

/**
 * Bottone filtro con pannello a tendina (pattern Zillow/Airbnb):
 * tiene la barra compatta invece di sparpagliare decine di chip.
 */
export default function FilterPopover({ label, value, children, width = "w-72" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = Boolean(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
          active
            ? "border-white bg-white text-neutral-900"
            : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800"
        }`}
      >
        {label}
        {value && <span className="max-w-[9rem] truncate opacity-70">· {value}</span>}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 4.5 6 8.5 10 4.5" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute left-0 z-50 mt-2 ${width} rounded-2xl border border-neutral-700 bg-neutral-900 p-3 shadow-2xl shadow-black/60`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
