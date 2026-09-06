#!/bin/bash
# Flatiron Radar — il crawl del mattino, in un doppio clic.
#
# Fa tutto il giro: aggiorna il codice, scarica dai siti aperti e da quelli
# anti-bot col browser vero, fonde, pubblica su Vercel e ti dice cos'e'
# cambiato. Se un sito ha bisogno che ti logghi, te lo chiede a fine giro.
#
# Doppio clic dal Finder, oppure  bash crawl.command  da terminale.

cd "$(dirname "$0")" || exit 1

# Lanciato dal Finder, uno script eredita un PATH minimo: node e python di
# Homebrew non ci sarebbero. Senza questa riga funziona da terminale e fallisce
# col doppio clic, che e' il modo peggiore di rompersi.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

ROOT="$(pwd)"
LOGDIR="$ROOT/logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/crawl-$(date +%Y-%m-%d-%H%M).log"
START=$(date +%s)
# Segnatempo del giro. Serve un file che NON venga piu' toccato: il log lo e'
# di continuo (ci scriviamo dentro fino all'ultima riga), quindi confrontarsi
# con lui faceva sembrare vecchio ogni snapshot appena scritto.
STAMP="$LOGDIR/.inizio-giro"
: > "$STAMP"

# Tutto quel che segue finisce sia a schermo che nel log.
exec > >(tee "$LOG") 2>&1

hr()  { printf '─%.0s' {1..58}; echo; }
# Avvisi sul Mac e sul telefono: il crawl dura una decina di minuti e l'idea
# e' che tu faccia altro, anche lontano dalla scrivania.
. "$ROOT/tools/notify.sh"
step() { echo; hr; echo "  $1"; hr; }
ok()   { echo "  ✓ $1"; }
warn() { echo "  ⚠︎  $1"; }

notify "Flatiron Radar" "Crawl avviato. Ti avviso quando ho finito."
echo "FLATIRON RADAR — crawl del $(date '+%d/%m/%Y alle %H:%M')"
echo "log: $LOG"

# ---------------------------------------------------------------- prerequisiti
for cmd in git python3; do
  command -v "$cmd" >/dev/null || { echo "Manca '$cmd'. Installalo e riprova."; exit 1; }
done
HAVE_NODE=1
command -v node >/dev/null || { HAVE_NODE=0; warn "node non trovato: salto i siti col browser"; }

# ------------------------------------------------------------ codice aggiornato
step "1/6  Aggiorno il codice"
git pull --rebase --autostash origin "$(git rev-parse --abbrev-ref HEAD)" && ok "codice aggiornato" \
  || warn "git pull fallito: vado avanti col codice che ho"

# ------------------------------------------------------- siti aperti (parallelo)
step "2/6  Siti aperti"
cd "$ROOT/apps/scraper" || exit 1

python3 "$ROOT/tools/generate_isochrones.py"      >/dev/null 2>&1 && ok "isocrone" || warn "isocrone: uso le esistenti"
python3 "$ROOT/tools/generate_subway_stations.py" >/dev/null 2>&1 && ok "stazioni metro" || warn "stazioni: uso le esistenti"

# In parallelo: sono tre attese di rete indipendenti, in fila ci mettono il
# triplo del tempo senza alcun vantaggio.
OPEN_SOURCES="apartmentadvisor trulia craigslist"
for s in $OPEN_SOURCES; do
  ( python3 -m rental_radar.run --source "$s" >"$LOGDIR/.$s.out" 2>&1 ) &
done
wait
# Attenzione a cosa si guarda: se una fonte fallisce, il suo snapshot di ieri
# e' ancora li'. Controllando solo che il file esista, un errore passerebbe per
# successo e la fusione userebbe dati vecchi senza dirlo. Serve che il file sia
# stato scritto DA QUESTO giro.
STALE=""
for s in $OPEN_SOURCES; do
  if [ "$s.snapshot.json" -nt "$STAMP" ]; then
    ok "$s — $(grep -o 'in-tier: [0-9]*' "$LOGDIR/.$s.out" | tail -1 | tr -d 'a-z-: ') case"
  elif [ -f "$s.snapshot.json" ]; then
    warn "$s non ha risposto: resta il dato del giro precedente"
    STALE="$STALE $s"
    tail -2 "$LOGDIR/.$s.out" | sed 's/^/      /'
  else
    warn "$s non raggiungibile e non ho niente di suo"
    tail -2 "$LOGDIR/.$s.out" | sed 's/^/      /'
  fi
  rm -f "$LOGDIR/.$s.out"
done
[ -n "$STALE" ] && notify "Flatiron Radar" "Fonti mute, uso dati vecchi:$STALE"

# --------------------------------------------------------- siti dietro anti-bot
step "3/6  Siti col browser (StreetEasy, Zillow, Apartments, RentHop)"
BROWSER="$ROOT/apps/scraper/browser"
NEEDS_LOGIN=""

if [ "$HAVE_NODE" = "1" ]; then
  cd "$BROWSER" || exit 1
  if [ ! -d node_modules ]; then
    echo "  Prima volta: installo Playwright…"
    npm install --silent && npx playwright install chromium
  fi
  rm -f .needs-login
  # Niente browser pilotati: PerimeterX e DataDome riconoscono un Chrome
  # aperto al debug remoto, al punto che li' dentro il "press and hold" non
  # passa nemmeno facendolo a mano. L'estensione gira nel Chrome normale,
  # non apre porte e non pilota niente: non c'e' nulla da riconoscere.
  python3 -u "$ROOT/tools/collector.py" --once &
  COLLECTOR=$!
  sleep 2
  notify "Flatiron Radar" "Apri Chrome e clicca l'icona Flatiron Radar per StreetEasy, Zillow, Apartments e RentHop."
  echo "  In attesa dell'estensione (fino a 25 minuti)…"
  echo "  → apri Chrome, clicca l'icona Flatiron Radar, poi «Scarica le case»"
  # Aspettiamo che finisca, ma non per sempre: se oggi non ti va, il crawl
  # pubblica lo stesso quello che le fonti aperte hanno dato.
  ( sleep 1500; kill "$COLLECTOR" 2>/dev/null ) &
  TIMER=$!
  wait "$COLLECTOR" 2>/dev/null
  kill "$TIMER" 2>/dev/null

  for s in streeteasy zillow apartments renthop; do
    [ -d "pages/$s" ] || NEEDS_LOGIN="$NEEDS_LOGIN $s"
  done

  cd "$ROOT/apps/scraper" || exit 1
  for s in streeteasy zillow apartments renthop; do
    [ -d "browser/pages/$s" ] && python3 -m rental_radar.run --source "$s" 2>&1 | tail -2
  done
else
  warn "salto (node mancante)"
fi

# ------------------------------------------------------------------ fusione
step "4/6  Fondo le fonti"
cd "$ROOT/apps/scraper" || exit 1
SNAPS=""
for s in apartmentadvisor trulia craigslist streeteasy zillow apartments renthop; do
  [ -f "${s}.snapshot.json" ] && SNAPS="$SNAPS ${s}.snapshot.json"
done
if [ -z "$SNAPS" ]; then
  echo; echo "  Nessuna fonte ha risposto. Niente da pubblicare."
  notify "Flatiron Radar" "Nessuna fonte ha risposto: crawl fallito."
  echo; read -t 300 -n 1 -s -r -p "  Premi un tasto per chiudere…"; exit 1
fi
python3 -m rental_radar.aggregate $SNAPS

# ------------------------------------------------------------------ riepilogo
step "5/6  Cos'e' cambiato"
cd "$ROOT" || exit 1
# Il riepilogo va anche su file e viene committato: e' il modo in cui il
# risultato di stamattina arriva a chi non era davanti allo schermo.
python3 tools/crawl_report.py | tee logs/ultimo-crawl.txt

# ------------------------------------------------------------------ pubblica
step "6/6  Pubblico su Vercel"
if git diff --quiet -- apps/web/public/data/; then
  ok "nessuna novita': niente da pubblicare"
  notify "Flatiron Radar" "Crawl finito: nessuna novita' oggi."
else
  git add -A
  git commit -q -m "crawl $(date +%F)" && ok "commit fatto"
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  for try in 1 2 3 4; do
    # Se nel frattempo e' arrivato altro codice, il push viene rifiutato:
    # ripeterlo uguale non puo' funzionare, bisogna prima riallinearsi.
    [ "$try" -gt 1 ] && git pull --rebase --autostash -q origin "$BRANCH" 2>/dev/null
    if git push -q origin "$BRANCH" 2>/dev/null; then
      ok "pubblicato — Vercel si aggiorna fra un paio di minuti"
      SUMMARY="$(grep -E "Schede pubblicate|Rispetto a ieri" logs/ultimo-crawl.txt | tr '\n' ' ')"
      notify "Flatiron Radar" "Pubblicato. ${SUMMARY:-crawl completato}"
      break
    fi
    [ "$try" = "4" ] && { warn "push fallito 4 volte: rilancia a mano con  git push"; \
      notify "Flatiron Radar" "Crawl finito ma la pubblicazione e' fallita."; }
    warn "push rifiutato, mi riallineo e riprovo ($try/4)"
    sleep $((2 ** try))
  done
fi

echo
hr
printf "  Finito in %s min %s sec.\n" $(( ($(date +%s) - START) / 60 )) $(( ($(date +%s) - START) % 60 ))
echo "  https://ab-ricerca-case.vercel.app"
hr

# -------------------------------------------------- login mancanti, se servono
if [ -n "$NEEDS_LOGIN" ]; then
  echo
  echo "  Questi siti ti hanno bloccato:"
  for s in $NEEDS_LOGIN; do echo "    · $s"; done
  echo
  echo "  Il crawl ha aspettato dieci minuti che risolvessi la verifica."
  echo "  Se non eri al computer, basta rilanciare. Se invece il muro resta"
  echo "  anche stando li', l'ultima carta e' navigare tu e farmi salvare le"
  echo "  schede aperte:"
  echo
  echo "    cd apps/scraper/browser && node fetch-cdp.mjs --manual"
  notify "Flatiron Radar" "Non sono entrato in:$NEEDS_LOGIN. Rilancia quando puoi."
fi

# Col doppio clic la finestra si chiuderebbe subito portandosi via il riepilogo,
# ma non deve nemmeno restare aperta all'infinito: il senso e' che tu faccia
# altro mentre gira, e il riepilogo resta comunque nel log e su Vercel.
echo
read -t 600 -n 1 -s -r -p "  Premi un tasto per chiudere (si chiude da sola fra 10 min)…"
echo
