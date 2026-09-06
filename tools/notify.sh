#!/bin/bash
# Avvisi del crawl: notifica sul Mac + notifica sul telefono.
#
#   source tools/notify.sh   →   notify "Titolo" "Messaggio"
#
# Sul telefono passiamo da ntfy.sh: niente account, niente chiavi, gratis.
# Il "topic" e' semplicemente un nome segreto: chi lo conosce riceve i
# messaggi, quindi viene generato a caso e tenuto FUORI dal repo.

NOTIFY_CONF="${NOTIFY_CONF:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/notify.conf}"

if [ -f "$NOTIFY_CONF" ]; then
  . "$NOTIFY_CONF"
else
  NTFY_TOPIC="flatiron-radar-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 12)"
  printf 'NTFY_TOPIC=%s\n' "$NTFY_TOPIC" > "$NOTIFY_CONF"
  echo "  Canale notifiche creato: $NTFY_TOPIC"
  echo "  Sul telefono installa l'app ntfy e iscriviti a questo nome."
fi

notify() {
  local title="$1" msg="$2"
  # sul Mac
  osascript -e "display notification \"${msg//\"/}\" with title \"${title//\"/}\" sound name \"Glass\"" \
    >/dev/null 2>&1 || true
  # sul telefono (e leggibile anche da chi segue il progetto)
  [ -n "${NTFY_TOPIC:-}" ] && curl -s -m 10 \
    -H "Title: ${title//$'\n'/ }" \
    -d "${msg}" "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null 2>&1 || true
}
