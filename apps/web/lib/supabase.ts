import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase, o null se il progetto non e' configurato.
 *
 * Null non e' un errore: senza queste due variabili l'app funziona lo stesso e
 * la wishlist resta nel browser (vedi wishlist.ts). E' il comportamento che
 * vogliamo — una casa salvata non deve sparire perche' una variabile d'ambiente
 * manca su un'anteprima di Vercel.
 *
 * La chiave e' "publishable": e' fatta per stare nel browser, dove chiunque puo'
 * leggerla. A proteggere i dati sono le policy RLS sulla tabella, non il
 * segreto della chiave. La `service_role` invece scavalca le RLS: non va mai
 * nel frontend ne' nel repo, che per giunta e' pubblico.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;

export const supabaseConfigurato = Boolean(supabase);
