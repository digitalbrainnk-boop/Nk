# Garde Multi-Lignes en marche : relance le serveur s'il s'arrête de façon anormale.
# Utilisé par la commande « lignes » et par le démarrage automatique (Termux:Boot).
#   sh scripts/termux-run.sh
# Codes de sortie du serveur : 0 = arrêt normal, 3 = déjà lancé, 130/143 = Ctrl+C / arrêt demandé.
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP" || exit 1
fails=0
while :; do
  started=$(date +%s)
  node "$APP/server.js"
  code=$?
  case "$code" in
    0|3|130|143) exit "$code" ;;
  esac
  # Plantages répétés en moins d'une minute : on patiente plus longtemps.
  if [ $(( $(date +%s) - started )) -lt 60 ]; then fails=$((fails + 1)); else fails=0; fi
  wait=${RESTART_DELAY:-5}
  [ "$fails" -ge 5 ] && wait=60
  echo "$(date '+%H:%M:%S') Multi-Lignes s'est arrêté (code $code) : redémarrage dans ${wait} s…"
  sleep "$wait"
done
