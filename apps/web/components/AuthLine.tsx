"use client";

/**
 * Una riga sola per l'accesso, in cima alla wishlist.
 *
 * Sta qui e non nell'intestazione dell'app perche' e' l'unico punto in cui
 * conta: sfogliare le case non richiede di essere nessuno, salvarle su piu'
 * dispositivi si'. Chi non fa login continua ad avere la sua wishlist, solo
 * su questo browser — e il messaggio glielo dice, invece di lasciarlo credere
 * che sia sincronizzata.
 */

import { useState } from "react";

type Props = {
  utente: string | null;
  sincronizzabile: boolean;
  errore: string | null;
  onEntra: (email: string) => Promise<string>;
  onEsci: () => void;
};

export default function AuthLine({ utente, sincronizzabile, errore, onEntra, onEsci }: Props) {
  const [apri, setApri] = useState(false);
  const [email, setEmail] = useState("");
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [attesa, setAttesa] = useState(false);

  if (!sincronizzabile) {
    return (
      <p className="mb-3 text-[11px] text-neutral-600">
        Salvate su questo browser. La sincronizzazione fra telefono e computer non è configurata.
      </p>
    );
  }

  if (utente) {
    return (
      <p className="mb-3 flex items-center gap-2 text-[11px] text-neutral-600">
        <span className="truncate">Sincronizzate come {utente}</span>
        <button onClick={onEsci} className="shrink-0 underline-offset-2 hover:text-neutral-400 hover:underline">
          esci
        </button>
        {errore && <span className="ml-auto shrink-0 text-amber-500">{errore}</span>}
      </p>
    );
  }

  return (
    <div className="mb-3">
      {!apri ? (
        <p className="text-[11px] text-neutral-600">
          Salvate solo su questo browser.{" "}
          <button
            onClick={() => setApri(true)}
            className="text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline"
          >
            Accedi per ritrovarle sul telefono
          </button>
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setAttesa(true);
            setMessaggio(await onEntra(email.trim()));
            setAttesa(false);
          }}
          className="flex gap-2"
        >
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="la tua email"
            className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
          />
          <button
            type="submit"
            disabled={attesa}
            className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-50"
          >
            {attesa ? "…" : "Invia"}
          </button>
        </form>
      )}
      {messaggio && <p className="mt-1.5 text-[11px] text-neutral-500">{messaggio}</p>}
    </div>
  );
}
