"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  label: string;
  /** Testo del valore selezionato, mostrato accanto all'etichetta. */
  value?: string | null;
  children: React.ReactNode;
  width?: string;
};

/**
 * Bottone filtro con pannello (pattern dei portali immobiliari):
 * - desktop: tendina ancorata al bottone
 * - mobile: bottom sheet a tutta larghezza, montato in portal su <body>
 *   (la testata usa backdrop-blur, che creerebbe un containing block e
 *   romperebbe un position:fixed annidato).
 */
export default function FilterPopover({ label, value, children, width = "w-72" }: Props) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = Boolean(value);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // chiusura con Escape (sempre) e click fuori (solo tendina desktop)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    if (isMobile) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = prev;
      };
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, isMobile]);

  const trigger = (
    <button
      onClick={() => setOpen((o) => !o)}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium transition sm:py-1.5 ${
        active
          ? "border-white bg-white text-neutral-900"
          : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800"
      }`}
    >
      {label}
      {value && <span className="max-w-[8rem] truncate opacity-70">· {value}</span>}
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
  );

  const sheet =
    open && isMobile && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[60] flex flex-col justify-end sm:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <div className="relative max-h-[80dvh] w-full overflow-hidden rounded-t-3xl border-t border-neutral-700 bg-neutral-900 pb-[env(safe-area-inset-bottom)] shadow-2xl">
              <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
                <span className="text-sm font-semibold text-neutral-100">{label}</span>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-neutral-900"
                >
                  Fatto
                </button>
              </div>
              <div className="max-h-[65dvh] overflow-y-auto overscroll-contain p-3">{children}</div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={ref} className="relative">
      {trigger}
      {open && !isMobile && (
        <div
          className={`absolute left-0 z-50 mt-2 ${width} rounded-2xl border border-neutral-700 bg-neutral-900 p-3 shadow-2xl shadow-black/60`}
        >
          {children}
        </div>
      )}
      {sheet}
    </div>
  );
}
