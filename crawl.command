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

# Tutto quel che segue finisce sia a schermo che nel log.
exec > >(tee "$LOG") 2>&1

hr()  { printf '─%.0s' {1..58}; echo; }
step() { echo; hr; echo "  $1"; hr; }
ok()   { echo "  ✓ $1"; }
warn() { echo "  ⚠︎  $1"; }

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
for s in $OPEN_SOURCES; do
  if [ -f "$s.snapshot.json" ]; then
    ok "$s — $(grep -o 'in-tier: [0-9]*' "$LOGDIR/.$s.out" | tail -1 | tr -d 'a-z-: ') case"
  else
    warn "$s non raggiungibile"
    tail -2 "$LOGDIR/.$s.out" | sed 's/^/      /'
  fi
  rm -f "$LOGDIR/.$s.out"
done

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
  node fetch.mjs --all

  # Chi resiste anche a Playwright lo ritentiamo con Chrome vero: e' un
  # processo lanciato normalmente, senza la trentina di switch da automazione
  # che sono essi stessi un'impronta riconoscibile.
  if [ -f .needs-login ]; then
    echo
    echo "  Ritento con Chrome vero: $(tr '\n' ' ' < .needs-login)"
    node fetch-cdp.mjs $(cat .needs-login) || true
    # Le fonti che ora hanno pagine sono risolte: non chiedere il login per quelle.
    STILL=""
    for s in $(cat .needs-login); do
      [ -d "pages/$s" ] || STILL="$STILL $s"
    done
    NEEDS_LOGIN="$STILL"
  fi

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
  echo; read -n 1 -s -r -p "  Premi un tasto per chiudere…"; exit 1
fi
python3 -m rental_radar.aggregate $SNAPS

# ------------------------------------------------------------------ riepilogo
step "5/6  Cos'e' cambiato"
cd "$ROOT" || exit 1
python3 tools/crawl_report.py

# ------------------------------------------------------------------ pubblica
step "6/6  Pubblico su Vercel"
if git diff --quiet -- apps/web/public/data/; then
  ok "nessuna novita': niente da pubblicare"
else
  git add -A
  git commit -q -m "crawl $(date +%F)" && ok "commit fatto"
  for try in 1 2 3 4; do
    if git push -q origin "$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null; then
      ok "pubblicato — Vercel si aggiorna fra un paio di minuti"
      break
    fi
    [ "$try" = "4" ] && warn "push fallito 4 volte: rilancia a mano con  git push"
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
  echo "  Si risolve loggandosi una volta: si apre una finestra vera, ti logghi"
  echo "  (o risolvi il captcha) e da domani il crawl la riusa da solo."
  echo
  read -n 1 -r -p "  Vuoi farlo ora? [s/N] " ANS; echo
  if [[ "$ANS" =~ ^[sSyY]$ ]]; then
    cd "$BROWSER" || exit 1
    for s in $NEEDS_LOGIN; do node fetch.mjs --login "$s"; done
    echo
    echo "  Fatto. Rilancia il crawl per prendere anche quei siti."
  fi
fi

# Col doppio clic la finestra si chiuderebbe subito portandosi via il riepilogo.
echo
read -n 1 -s -r -p "  Premi un tasto per chiudere…"
echo
