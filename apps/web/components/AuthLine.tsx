"use client";

/**
 * L'accesso, in cima alla wishlist.
 *
 * Sta qui e non nell'intestazione dell'app perche' e' l'unico punto in cui
 * conta: sfogliare le case non richiede di essere nessuno, ritrovarle sul
 * telefono si'. Chi non entra continua ad avere la sua wishlist, solo su
 * questo browser — e il messaggio glielo dice, invece di lasciarlo credere
 * che sia sincronizzata.
 *
 * Email e password, non il link per email: quello andava aperto su ogni
 * dispositivo e il piano gratuito ne manda pochissime all'ora.
 */

import { useState } from "react";

type Props = {
  utente: string | null;
  sincronizzabile: boolean;
  errore: string | null;
  onEntra: (email: string, password: string) => Promise<string>;
  onRegistra: (email: string, password: string) => Promise<string>;
  onEsci: () => void;
};

export default function AuthLine({
  utente,
  sincronizzabile,
  errore,
  onEntra,
  onRegistra,
  onEsci,
}: Props) {
  const [apri, setApri] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        <button
          onClick={onEsci}
          className="shrink-0 underline-offset-2 hover:text-neutral-400 hover:underline"
        >
          esci
        </button>
        {errore && <span className="ml-auto shrink-0 text-amber-500">{errore}</span>}
      </p>
    );
  }

  const manda = async (azione: (e: string, p: string) => Promise<string>) => {
    if (!email.trim() || !password) {
      return setMessaggio("Servono email e password.");
    }
    setAttesa(true);
    // Stringa vuota = e' andata: la riga qui sopra cambia da sola e non serve
    // dire altro. Tutto il resto e' qualcosa che devi leggere.
    const esito = await azione(email.trim(), password);
    setMessaggio(esito || null);
    if (!esito) setPassword("");
    setAttesa(false);
  };

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
          onSubmit={(e) => {
            e.preventDefault();
            void manda(onEntra);
          }}
          className="space-y-2"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              autoComplete="username"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email"
              className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
            />
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={attesa}
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-50"
            >
              {attesa ? "…" : "Accedi"}
            </button>
            {/* La prima volta l'account non c'e'. Due bottoni distinti perche'
                Supabase da' lo stesso errore per "password sbagliata" e "utente
                inesistente": indovinare quale dei due sia porterebbe a creare
                un secondo account su un'email scritta male. */}
            <button
              type="button"
              disabled={attesa}
              onClick={() => void manda(onRegistra)}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-300 transition hover:bg-neutral-800 disabled:opacity-50"
            >
              Crea account
            </button>
            <button
              type="button"
              onClick={() => setApri(false)}
              className="ml-auto text-[11px] text-neutral-600 hover:text-neutral-400"
            >
              annulla
            </button>
          </div>
        </form>
      )}
      {messaggio && <p className="mt-1.5 text-[11px] text-neutral-500">{messaggio}</p>}
    </div>
  );
}
