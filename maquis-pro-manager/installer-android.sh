#!/data/data/com.termux/files/usr/bin/bash
# MAQUIS PRO MANAGER en TEST sur un téléphone Android (application Termux, depuis F-Droid).
# Dans Termux, collez cette ligne puis Entrée :
#   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/ccr-98ef2a93-v667hk/maquis-pro-manager/installer-android.sh | bash
# Ensuite, il suffit de taper « maquis » dans Termux.
set -e
BRANCHE="${MAQUIS_BRANCHE:-ccr-98ef2a93-v667hk}"
SOURCE="$HOME/maquis-source"
APP="$SOURCE/maquis-pro-manager"
DONNEES="$HOME/maquis-donnees"

echo "=== Installation de MAQUIS PRO MANAGER (3 à 10 minutes) ==="
OFFICIEL="deb https://packages.termux.dev/apt/termux-main stable main"
install_paquets() {
  apt-get update -y && apt-get install -y -o Dpkg::Options::="--force-confnew" "$@"
}
if ! install_paquets nodejs-lts git procps curl; then
  echo "Passage au serveur officiel Termux…"
  rm -f "$PREFIX/etc/termux/chosen_mirrors"
  echo "$OFFICIEL" > "$PREFIX/etc/apt/sources.list"
  install_paquets nodejs-lts git procps curl || install_paquets nodejs git procps curl
fi
# Il faut Node 22.13 ou plus récent (base de données intégrée).
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "Node $(node -v) est trop ancien : installation de la version la plus récente…"
  install_paquets nodejs
fi
# cloudflared : crée un lien https temporaire et gratuit pour tester depuis d'autres téléphones.
install_paquets cloudflared || echo "⚠️  cloudflared non installé : l'application marchera sur ce téléphone seulement (pas de lien pour les autres)."

if [ -d "$SOURCE/.git" ]; then
  echo "Mise à jour…"
  git -C "$SOURCE" fetch --depth 1 origin "$BRANCHE"
  git -C "$SOURCE" reset --hard FETCH_HEAD
else
  git clone --depth 1 -b "$BRANCHE" https://github.com/digitalbrainnk-boop/Nk.git "$SOURCE"
fi
cd "$APP"
npm install --no-audit --no-fund
mkdir -p "$DONNEES"
[ -f .env ] || printf 'DATA_DIR=%s\nPORT=3100\n' "$DONNEES" > .env

cat > "$PREFIX/bin/maquis" <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
# maquis          démarre l'application (et le lien pour les autres téléphones)
# maquis lien     affiche le lien à ouvrir sur les autres téléphones
# maquis code     affiche le code d'installation (création du compte propriétaire)
# maquis maj      installe la dernière version (les données sont conservées)
# maquis arret    arrête l'application
APP="$HOME/maquis-source/maquis-pro-manager"
DONNEES="$HOME/maquis-donnees"
PORT=3100
lien() { grep -o 'https://[-a-z0-9]*\.trycloudflare\.com' "$DONNEES/tunnel.log" 2>/dev/null | head -1; }
case "$1" in
  lien) L=$(lien); if [ -n "$L" ]; then echo "$L"; else echo "Pas de lien pour le moment : tapez « maquis » pour démarrer."; fi; exit ;;
  code) cat "$DONNEES/CODE-INSTALLATION.txt" 2>/dev/null || echo "Le compte propriétaire est déjà créé (ou l'application n'a jamais démarré)."; exit ;;
  arret) pkill -f "maquis-pro-manager/serveur.js"; pkill -f "cloudflared tunnel --url http://localhost:$PORT"; echo "Arrêté."; exit ;;
  maj)
    pkill -f "maquis-pro-manager/serveur.js"; pkill -f "cloudflared tunnel --url http://localhost:$PORT"
    curl -fsSL "https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/${MAQUIS_BRANCHE:-ccr-98ef2a93-v667hk}/maquis-pro-manager/installer-android.sh" | bash
    exit ;;
esac
cd "$APP" || exit 1
termux-wake-lock 2>/dev/null || true
pkill -f "maquis-pro-manager/serveur.js" 2>/dev/null
pkill -f "cloudflared tunnel --url http://localhost:$PORT" 2>/dev/null
sleep 1
node --disable-warning=ExperimentalWarning --env-file-if-exists=.env "$APP/serveur.js" >> "$DONNEES/serveur.log" 2>&1 &
SERVEUR=$!
trap 'kill $SERVEUR $TUNNEL 2>/dev/null; termux-wake-unlock 2>/dev/null; echo; echo "MAQUIS PRO MANAGER arrêté."' EXIT
for i in $(seq 1 30); do curl -fs "http://localhost:$PORT/health" >/dev/null 2>&1 && break; sleep 1; done
if ! curl -fs "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "❌ L'application n'a pas démarré. Dernières lignes du journal :"; tail -20 "$DONNEES/serveur.log"; exit 1
fi
L=""
if command -v cloudflared >/dev/null 2>&1; then
  : > "$DONNEES/tunnel.log"
  cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate >> "$DONNEES/tunnel.log" 2>&1 &
  TUNNEL=$!
  echo "Création du lien pour les autres téléphones…"
  for i in $(seq 1 40); do L=$(lien); [ -n "$L" ] && break; sleep 1; done
fi
clear
echo "================ MAQUIS PRO MANAGER — TEST ================"
echo
echo " Sur CE téléphone :      http://localhost:$PORT"
if [ -n "$L" ]; then
  echo " Sur les AUTRES appareils (et pour installer l'application) :"
  echo "     $L"
  echo "   (ce lien change à chaque démarrage : tapez « maquis lien » pour le revoir)"
else
  echo " Pas de lien pour les autres téléphones (internet ou cloudflared indisponible)."
fi
[ -f "$DONNEES/CODE-INSTALLATION.txt" ] && echo && echo " $(head -1 "$DONNEES/CODE-INSTALLATION.txt")"
echo
echo " Laissez Termux ouvert et le téléphone en charge. CTRL + C pour arrêter."
echo "==========================================================="
(sleep 2; termux-open-url "${L:-http://localhost:$PORT}" 2>/dev/null) &
wait $SERVEUR
EOS
chmod +x "$PREFIX/bin/maquis"

echo
echo "=== Installé ! Tapez « maquis » pour démarrer (c'est parti tout de suite). ==="
sleep 2
exec maquis
